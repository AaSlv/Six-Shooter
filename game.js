import { playHit, playMiss, playShoot } from "./audio.js";
import {
  spawnHitText,
  spawnMissText,
  spawnShatter,
  spawnMuzzleFlash,
  spawnFireRing,
  updateVFX,
  drawVFX,
} from "./vfx.js";
import { config } from "./config.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let targets = [];
let dust = [];
let vultures = [];
let cacti = [];
let score = 0;
let nextId = 0;
let snappedId = null;
let snappedSinceMs = 0;
let computedAim = null;
let lastUpdate = performance.now();
let paused = false;
let desiredCount = 6;
let lastFireMs = -1e9; // timestamp of the last shot, for the bullet-path flash

// The gunslinger stands just below the bottom-center edge; the laser and
// muzzle flash originate here.
function originX() { return canvas.width / 2; }
function originY() { return canvas.height - 40; }

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

export function getCanvas() {
  return canvas;
}

export function setPaused(v) {
  paused = !!v;
}

export function setTargetCount(n) {
  desiredCount = Math.max(1, Math.min(20, n | 0));
  while (targets.length > desiredCount) targets.pop();
}

export function initGame() {
  resize();
  window.addEventListener("resize", () => {
    resize();
    initDust();
    initVultures();
    initCacti();
  });
  targets = [];
  desiredCount = config.targets.count;
  while (targets.length < desiredCount) spawnTarget();
  initDust();
  initVultures();
  initCacti();
}

function initDust() {
  dust = [];
  for (let i = 0; i < 140; i++) {
    dust.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: 8 + Math.random() * 28,
      vy: -2 + Math.random() * 4,
      size: 0.5 + Math.random() * 2.2,
      alpha: 0.10 + Math.random() * 0.35,
    });
  }
}

function initVultures() {
  vultures = [];
  for (let i = 0; i < 3; i++) {
    vultures.push({
      cx: canvas.width * (0.18 + i * 0.32),
      cy: canvas.height * (0.16 + Math.random() * 0.06),
      rx: 90 + Math.random() * 60,
      ry: 38 + Math.random() * 18,
      angle: Math.random() * Math.PI * 2,
      speed: 0.18 + Math.random() * 0.15,
      flap: Math.random() * Math.PI * 2,
    });
  }
}

function initCacti() {
  cacti = [];
  // Place cacti at the horizon line, in front of the mesas
  const horizonY = canvas.height * 0.66;
  const positions = [0.08, 0.19, 0.42, 0.55, 0.74, 0.91];
  for (const p of positions) {
    cacti.push({
      x: canvas.width * p + (Math.random() - 0.5) * 30,
      y: horizonY + Math.random() * 4,
      scale: 0.7 + Math.random() * 0.6,
      flip: Math.random() < 0.5,
    });
  }
}

function spawnTarget() {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const margin = 80;
  const edge = Math.floor(Math.random() * 4);
  let x, y;
  if (edge === 0)      { x = -margin;             y = Math.random() * canvas.height; }
  else if (edge === 1) { x = canvas.width + margin;y = Math.random() * canvas.height; }
  else if (edge === 2) { x = Math.random() * canvas.width; y = -margin; }
  else                 { x = Math.random() * canvas.width; y = canvas.height + margin; }

  const tx = cx + (Math.random() - 0.5) * canvas.width * 0.5;
  const ty = cy + (Math.random() - 0.5) * canvas.height * 0.5;
  const dx = tx - x;
  const dy = ty - y;
  const len = Math.hypot(dx, dy) || 1;
  const baseSpeed = 80 + Math.random() * 90;

  targets.push({
    id: nextId++,
    x,
    y,
    vx: (dx / len) * baseSpeed,
    vy: (dy / len) * baseSpeed,
    radius: 28 + Math.random() * 14,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 9,
    style: Math.floor(Math.random() * CAN_PALETTES.length),
  });
}

/* ---------- Aim assist (with snap hysteresis to stop oscillation) ---------- */

function applyAimAssist(rawAim, isPistol, now) {
  if (!rawAim || !isPistol || config.aimAssist.mode === "off") {
    snappedId = null;
    return rawAim;
  }
  const radius = config.aimAssist.radius;

  // Distance to current snap target (if any)
  const current = snappedId !== null ? targets.find((t) => t.id === snappedId) : null;
  const currentDist = current
    ? Math.hypot(current.x - rawAim.x, current.y - rawAim.y)
    : Infinity;

  // Find the closest target in radius (could be the current one)
  let nearest = null;
  let nearestDist = radius;
  for (const t of targets) {
    const d = Math.hypot(t.x - rawAim.x, t.y - rawAim.y);
    if (d < nearestDist) { nearestDist = d; nearest = t; }
  }

  // Hysteresis: keep the current target unless a) it's clearly out of range
  // (>1.3× radius) or b) another target is significantly closer (<0.7× the
  // current distance). Without this, the snap flickers between two cans
  // whose snap regions overlap.
  if (current && currentDist <= radius * 1.3) {
    if (nearest && nearest.id !== current.id && nearestDist < currentDist * 0.7) {
      snappedId = nearest.id;
      snappedSinceMs = now;
    } else {
      snappedId = current.id;
    }
  } else {
    snappedId = nearest ? nearest.id : null;
    if (snappedId !== null) snappedSinceMs = now;
  }

  if (snappedId === null) return rawAim;
  const target = targets.find((t) => t.id === snappedId);
  if (!target) { snappedId = null; return rawAim; }

  if (config.aimAssist.mode === "snap") {
    return { x: target.x, y: target.y };
  }
  if (config.aimAssist.mode === "pull") {
    const s = config.aimAssist.pullStrength;
    return {
      x: rawAim.x + (target.x - rawAim.x) * s,
      y: rawAim.y + (target.y - rawAim.y) * s,
    };
  }
  return rawAim;
}

/* ---------- Update loop ---------- */

export function updateGame(now, rawAim, isPistol) {
  const dt = Math.min(0.05, (now - lastUpdate) / 1000);
  lastUpdate = now;

  computedAim = applyAimAssist(rawAim, isPistol, now);

  if (paused) return;

  const speedMul = config.targets.speedMultiplier;
  for (const t of targets) {
    t.x += t.vx * dt * speedMul;
    t.y += t.vy * dt * speedMul;
    t.rotation += t.rotSpeed * dt;
  }
  targets = targets.filter(
    (t) =>
      t.x > -260 &&
      t.x < canvas.width + 260 &&
      t.y > -260 &&
      t.y < canvas.height + 260
  );
  while (targets.length < desiredCount) spawnTarget();

  // Dust
  for (const d of dust) {
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (d.x > canvas.width + 20) {
      d.x = -20;
      d.y = Math.random() * canvas.height;
    }
  }

  // Vultures circle slowly
  for (const v of vultures) {
    v.angle += v.speed * dt;
    v.flap += dt * 5;
  }

  updateVFX(dt);
}

// Same assist as applyAimAssist, but stateless (no snap hysteresis), used to
// resolve a shot from a past aim point without disturbing the live crosshair.
function assistForShot(aim) {
  if (!aim || config.aimAssist.mode === "off") return aim;
  const radius = config.aimAssist.radius;
  let nearest = null;
  let nearestDist = radius;
  for (const t of targets) {
    const d = Math.hypot(t.x - aim.x, t.y - aim.y);
    if (d < nearestDist) { nearestDist = d; nearest = t; }
  }
  if (!nearest) return aim;
  if (config.aimAssist.mode === "snap") return { x: nearest.x, y: nearest.y };
  const s = config.aimAssist.pullStrength;
  return {
    x: aim.x + (nearest.x - aim.x) * s,
    y: aim.y + (nearest.y - aim.y) * s,
  };
}

// pastAim (optional): where the crosshair was just before the trigger press.
// When given, the shot is resolved from it instead of the current crosshair,
// because pressing the thumb moves the hand and drifts the live aim.
export function fireShot(rawAim, pastAim = null) {
  if (paused) return;
  playShoot();
  lastFireMs = performance.now();
  spawnMuzzleFlash(originX(), originY());

  const aim = pastAim ? assistForShot(pastAim) : computedAim || rawAim;
  if (!aim) return;

  // A burst of confirmation right at the crosshair, where the player is
  // actually looking.
  spawnFireRing(aim.x, aim.y);

  // Hit test against an ellipse matching the drawn can (rotated into the
  // can's local frame), not a plain circle — the sprite is taller than wide,
  // so a circle made top/bottom shots miss unfairly.
  let hit = null;
  let nearestNorm = Infinity;
  for (const t of targets) {
    const dx = aim.x - t.x;
    const dy = aim.y - t.y;
    const cos = Math.cos(-t.rotation);
    const sin = Math.sin(-t.rotation);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    const hw = t.radius * 0.75; // half-width  (sprite drawn at 0.65·r + margin)
    const hh = t.radius * 1.0; //  half-height (sprite drawn at 0.85·r + margin)
    const norm = (lx * lx) / (hw * hw) + (ly * ly) / (hh * hh);
    if (norm <= 1 && norm < nearestNorm) {
      hit = t;
      nearestNorm = norm;
    }
  }

  if (hit) {
    score += 100;
    document.getElementById("score").textContent = "BOUNTY: " + score;
    spawnHitText(hit.x, hit.y);
    spawnShatter(hit.x, hit.y);
    playHit();
    targets = targets.filter((t) => t.id !== hit.id);
    snappedId = null;
    while (targets.length < desiredCount) spawnTarget();
  } else {
    spawnMissText(aim.x, aim.y);
    playMiss();
  }
}

/* ---------- Drawing ---------- */

export function drawGame(now, rawAim, isPistol) {
  drawBackground(now);

  // Cans (sort by y for a tiny depth feel)
  const sorted = [...targets].sort((a, b) => a.y - b.y);
  for (const t of sorted) drawTinCan(t);

  drawVFX(ctx);

  if (computedAim) {
    if (isPistol) drawBulletPath(computedAim, now);
    drawCrosshair(computedAim, isPistol, snappedId !== null);
  }
}

function drawBackground(now) {
  const w = canvas.width;
  const h = canvas.height;

  // Sky-to-sand gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#3a2818");
  grad.addColorStop(0.45, "#7a5028");
  grad.addColorStop(0.65, "#b78554");
  grad.addColorStop(1, "#8a5a30");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Sun (warm glow up-right)
  drawSun();

  // Vultures
  drawVultures();

  // Distant rolling hills (very faint)
  ctx.fillStyle = "rgba(40, 22, 12, 0.4)";
  for (let i = 0; i < 5; i++) {
    const cx = w * (i / 4);
    const r = w * 0.18;
    ctx.beginPath();
    ctx.ellipse(cx, h * 0.66 + 8, r, h * 0.04, 0, 0, Math.PI, true);
    ctx.fill();
  }

  // Mesas (closer than hills, darker)
  ctx.fillStyle = "rgba(30, 16, 8, 0.7)";
  drawMesa(w * 0.04, h * 0.62, w * 0.18, h * 0.07);
  drawMesa(w * 0.22, h * 0.65, w * 0.12, h * 0.05);
  drawMesa(w * 0.40, h * 0.63, w * 0.14, h * 0.06);
  drawMesa(w * 0.62, h * 0.63, w * 0.22, h * 0.08);
  drawMesa(w * 0.86, h * 0.66, w * 0.16, h * 0.05);

  // Horizon line
  ctx.strokeStyle = "rgba(20, 10, 4, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.66);
  ctx.lineTo(w, h * 0.66);
  ctx.stroke();

  // Cacti at horizon
  for (const c of cacti) drawCactus(c);

  // Drifting dust motes
  for (const d of dust) {
    ctx.globalAlpha = d.alpha;
    ctx.fillStyle = "#e8d8b0";
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Vignette
  const vg = ctx.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.4,
    w / 2, h / 2, Math.max(w, h) * 0.7
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

function drawSun() {
  const w = canvas.width;
  const h = canvas.height;
  const x = w * 0.78;
  const y = h * 0.30;
  const r = Math.min(w, h) * 0.07;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
  grad.addColorStop(0, "rgba(255, 230, 160, 0.55)");
  grad.addColorStop(0.45, "rgba(255, 180, 100, 0.25)");
  grad.addColorStop(1, "rgba(255, 140, 60, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(x - r * 2.5, y - r * 2.5, r * 5, r * 5);
  ctx.fillStyle = "rgba(255, 230, 170, 0.8)";
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

function drawVultures() {
  ctx.fillStyle = "rgba(20, 10, 4, 0.75)";
  for (const v of vultures) {
    const x = v.cx + Math.cos(v.angle) * v.rx;
    const y = v.cy + Math.sin(v.angle) * v.ry;
    const flap = Math.sin(v.flap) * 4;
    const w = 14;
    ctx.beginPath();
    ctx.moveTo(x - w, y - flap * 0.4);
    ctx.quadraticCurveTo(x - w * 0.4, y + flap, x, y);
    ctx.quadraticCurveTo(x + w * 0.4, y + flap, x + w, y - flap * 0.4);
    ctx.lineTo(x + w * 0.7, y + 1);
    ctx.lineTo(x, y + 2);
    ctx.lineTo(x - w * 0.7, y + 1);
    ctx.closePath();
    ctx.fill();
  }
}

function drawMesa(x, y, w, h) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w * 0.1, y - h);
  ctx.lineTo(x + w * 0.85, y - h);
  ctx.lineTo(x + w, y);
  ctx.closePath();
  ctx.fill();
}

function drawCactus(c) {
  ctx.save();
  ctx.translate(c.x, c.y);
  if (c.flip) ctx.scale(-1, 1);
  const s = c.scale;
  ctx.fillStyle = "rgba(28, 18, 10, 0.85)";
  // Trunk
  ctx.fillRect(-3 * s, -60 * s, 6 * s, 60 * s);
  ctx.beginPath();
  ctx.arc(0, -60 * s, 3 * s, 0, Math.PI, true);
  ctx.fill();
  // Right arm
  ctx.fillRect(3 * s, -38 * s, 16 * s, 5 * s);
  ctx.fillRect(15 * s, -38 * s, 5 * s, 22 * s);
  ctx.beginPath();
  ctx.arc(17.5 * s, -38 * s, 2.5 * s, 0, Math.PI, true);
  ctx.fill();
  // Left arm (smaller, shorter)
  ctx.fillRect(-18 * s, -28 * s, 15 * s, 5 * s);
  ctx.fillRect(-18 * s, -28 * s, 5 * s, 14 * s);
  ctx.beginPath();
  ctx.arc(-15.5 * s, -28 * s, 2.5 * s, 0, Math.PI, true);
  ctx.fill();
  ctx.restore();
}

const CAN_PALETTES = [
  { body: "#c8bea0", label: "#9a3c2a", trim: "#5a1a0a", rim: "#a89870" },
  { body: "#c8bea0", label: "#d8b450", trim: "#7a5a14", rim: "#a89870" },
  { body: "#c8bea0", label: "#e6dcc0", trim: "#5a3a22", rim: "#a89870" },
];

function drawTinCan(t) {
  const w = t.radius * 1.3;
  const h = t.radius * 1.7;
  const p = CAN_PALETTES[t.style] || CAN_PALETTES[0];

  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.rotation);

  // Body
  ctx.fillStyle = p.body;
  ctx.fillRect(-w / 2, -h / 2, w, h);

  // Cylindrical shading
  const shade = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  shade.addColorStop(0, "rgba(0, 0, 0, 0.20)");
  shade.addColorStop(0.18, "rgba(255, 255, 255, 0.35)");
  shade.addColorStop(0.42, "rgba(255, 255, 255, 0)");
  shade.addColorStop(0.85, "rgba(0, 0, 0, 0.20)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.32)");
  ctx.fillStyle = shade;
  ctx.fillRect(-w / 2, -h / 2, w, h);

  // Label band
  ctx.fillStyle = p.label;
  ctx.fillRect(-w / 2, -h * 0.22, w, h * 0.44);
  ctx.fillStyle = p.trim;
  ctx.fillRect(-w / 2, -h * 0.22, w, 2);
  ctx.fillRect(-w / 2, h * 0.22 - 2, w, 2);

  // Star mark
  ctx.fillStyle = p.trim;
  ctx.font = `bold ${Math.floor(h * 0.22)}px "Georgia", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("★", 0, 0);

  // Rims
  ctx.fillStyle = p.rim;
  ctx.beginPath();
  ctx.ellipse(0, -h / 2, w / 2, w * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#3a2818";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#7a6a52";
  ctx.beginPath();
  ctx.ellipse(0, -h / 2 + 1, w * 0.42, w * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = p.rim;
  ctx.beginPath();
  ctx.ellipse(0, h / 2, w / 2, w * 0.16, 0, 0, Math.PI, false);
  ctx.fill();
  ctx.strokeStyle = "#3a2818";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, h / 2, w / 2, w * 0.16, 0, 0, Math.PI, false);
  ctx.stroke();

  ctx.strokeStyle = "#3a2818";
  ctx.lineWidth = 2;
  ctx.strokeRect(-w / 2, -h / 2, w, h);

  ctx.restore();
}

/* ---------- Aiming visuals (origin = bottom-center of screen) ---------- */

function drawBulletPath(aim, now) {
  const ox = originX();
  const oy = originY();

  // Brighten/thicken the laser for a moment after a shot so it reads as a
  // discharge, not just a static aiming line.
  const sinceFire = now - lastFireMs;
  const flash = Math.max(0, 1 - sinceFire / 150); // 1 -> 0 over 150ms

  ctx.save();
  ctx.setLineDash([7, 6]);
  ctx.lineDashOffset = -now * 0.06;
  ctx.strokeStyle = `rgba(255, 244, 200, ${0.55 + 0.45 * flash})`;
  ctx.lineWidth = 1.8 + 2.6 * flash;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(aim.x, aim.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // A small "anchor" pip at the origin so the laser feels rooted at center
  ctx.fillStyle = "rgba(244, 234, 212, 0.5)";
  ctx.beginPath();
  ctx.arc(ox, oy, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCrosshair(point, isPistol, snapped) {
  ctx.save();
  ctx.translate(point.x, point.y);
  const color = snapped ? "#a83828" : isPistol ? "#f4ead4" : "#d6bd92";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  const r = 18;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r - 6, 0); ctx.lineTo(-r + 4, 0);
  ctx.moveTo(r + 6, 0);  ctx.lineTo(r - 4, 0);
  ctx.moveTo(0, -r - 6); ctx.lineTo(0, -r + 4);
  ctx.moveTo(0, r + 6);  ctx.lineTo(0, r - 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, Math.PI * 2);
  ctx.fill();

  if (snapped) {
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r + 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}