const HIT_PHRASES = ["BULLSEYE!", "HIT!", "GOTCHA!", "YEEHAW!", "RIGHT ON!"];
const MISS_PHRASES = ["MISS", "DURN!", "DAGNAB IT", "NUTS!"];

const texts = [];
const particles = [];
const flashes = [];
const rings = [];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function spawnHitText(x, y) {
  texts.push({
    x,
    y,
    vy: -90,
    life: 0.95,
    max: 0.95,
    text: pick(HIT_PHRASES),
    color: "#a83828",
    size: 38,
    style: "rye",
  });
}

export function spawnMissText(x, y) {
  texts.push({
    x,
    y,
    vy: -55,
    life: 0.7,
    max: 0.7,
    text: pick(MISS_PHRASES),
    color: "#5a3a22",
    size: 24,
    style: "fell",
  });
}

export function spawnShatter(x, y) {
  // Mix of metallic shrapnel + dust
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + Math.random() * 0.4;
    const sp = 200 + Math.random() * 320;
    const isShrapnel = Math.random() < 0.45;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.55 + Math.random() * 0.55,
      max: 1,
      color: isShrapnel ? "#c8c0a8" : "#b07848",
      size: isShrapnel ? 3 + Math.random() * 4 : 5 + Math.random() * 7,
      gravity: isShrapnel ? 480 : 220,
    });
  }
  // Yellow/orange sparks
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 280 + Math.random() * 220;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.22 + Math.random() * 0.25,
      max: 1,
      color: "#ffd060",
      size: 2 + Math.random() * 2.5,
      gravity: 0,
    });
  }
}

export function spawnMuzzleFlash(x, y) {
  flashes.push({ x, y, life: 0.18, max: 0.18, radius: 64 });
}

// A quick expanding ring at the crosshair — foveal confirmation that a shot
// actually fired, drawn where the player is looking (not at the bottom edge).
export function spawnFireRing(x, y) {
  rings.push({ x, y, life: 0.22, max: 0.22, r0: 8, r1: 46 });
}

export function updateVFX(dt) {
  for (const t of texts) {
    t.y += t.vy * dt;
    t.vy += 80 * dt;
    t.life -= dt;
  }
  for (let i = texts.length - 1; i >= 0; i--) {
    if (texts[i].life <= 0) texts.splice(i, 1);
  }

  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.94;
    p.vy = p.vy * 0.94 + (p.gravity || 0) * dt;
    p.life -= dt;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].life <= 0) particles.splice(i, 1);
  }

  for (const f of flashes) f.life -= dt;
  for (let i = flashes.length - 1; i >= 0; i--) {
    if (flashes[i].life <= 0) flashes.splice(i, 1);
  }

  for (const r of rings) r.life -= dt;
  for (let i = rings.length - 1; i >= 0; i--) {
    if (rings[i].life <= 0) rings.splice(i, 1);
  }
}

export function drawVFX(ctx) {
  // Particles
  for (const p of particles) {
    const a = Math.max(0, p.life / p.max);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Muzzle flashes
  for (const f of flashes) {
    const a = f.life / f.max;
    const r = f.radius * a;
    const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
    grad.addColorStop(0, `rgba(255, 240, 180, ${0.9 * a})`);
    grad.addColorStop(0.4, `rgba(255, 160, 80, ${0.5 * a})`);
    grad.addColorStop(1, "rgba(255, 80, 40, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fire rings — expanding, fading circle at the aim point on every shot
  for (const r of rings) {
    const p = 1 - r.life / r.max; // 0 -> 1 over the ring's life
    const radius = r.r0 + (r.r1 - r.r0) * p;
    ctx.globalAlpha = Math.max(0, 1 - p);
    ctx.strokeStyle = "#ffe6a0";
    ctx.lineWidth = 3 * (1 - p) + 1;
    ctx.beginPath();
    ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Floating text
  ctx.textAlign = "center";
  for (const t of texts) {
    const a = Math.max(0, t.life / t.max);
    ctx.font =
      t.style === "rye"
        ? `${t.size}px "Rye", "Georgia", serif`
        : `italic ${t.size}px "IM Fell English", "Georgia", serif`;
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(t.text, t.x + 2, t.y + 2);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}
