// MediaPipe Hands gives 21 landmarks per hand. This module turns those raw
// points into a rich state object: per-finger biomechanical curl angles
// (using PIP + DIP joints), palm orientation, hand scale, and stable thumb
// trigger metrics. Landmarks are smoothed with a One-Euro filter to cut the
// jitter inherent in real-time hand tracking.

export const L = {
  WRIST: 0,
  THUMB:  { CMC: 1, MCP: 2, IP: 3,  TIP: 4  },
  INDEX:  { MCP: 5, PIP: 6, DIP: 7, TIP: 8  },
  MIDDLE: { MCP: 9, PIP: 10,DIP: 11,TIP: 12 },
  RING:   { MCP: 13,PIP: 14,DIP: 15,TIP: 16 },
  PINKY:  { MCP: 17,PIP: 18,DIP: 19,TIP: 20 },
};

export const FINGERS = {
  thumb:  [L.THUMB.CMC,  L.THUMB.MCP,  L.THUMB.IP,  L.THUMB.TIP ],
  index:  [L.INDEX.MCP,  L.INDEX.PIP,  L.INDEX.DIP, L.INDEX.TIP ],
  middle: [L.MIDDLE.MCP, L.MIDDLE.PIP, L.MIDDLE.DIP,L.MIDDLE.TIP],
  ring:   [L.RING.MCP,   L.RING.PIP,   L.RING.DIP,  L.RING.TIP  ],
  pinky:  [L.PINKY.MCP,  L.PINKY.PIP,  L.PINKY.DIP, L.PINKY.TIP ],
};

/* ---------- 3D vector helpers (z=0 if 2D) ---------- */

function sub3(a, b)  { return { x: a.x-b.x, y: a.y-b.y, z: (a.z||0)-(b.z||0) }; }
function dot3(a, b)  { return a.x*b.x + a.y*b.y + (a.z||0)*(b.z||0); }
function cross3(a, b){
  return {
    x: a.y*(b.z||0) - (a.z||0)*b.y,
    y: (a.z||0)*b.x - a.x*(b.z||0),
    z: a.x*b.y - a.y*b.x,
  };
}
function mag3(v) { return Math.hypot(v.x, v.y, v.z||0); }
function norm3(v){ const m = mag3(v); return m === 0 ? v : { x: v.x/m, y: v.y/m, z: (v.z||0)/m }; }

function angleBetween(a, b) {
  const ma = mag3(a), mb = mag3(b);
  if (ma === 0 || mb === 0) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot3(a, b) / (ma * mb))));
}

/* ---------- One-Euro filter (Casiez 2012) ---------- */

export class OneEuro {
  constructor(minCutoff = 1.5, beta = 0.04, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = 0;
    this.lastT = null;
  }
  alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(x, t) {
    if (this.x === null) { this.x = x; this.lastT = t; return x; }
    const dt = Math.max(0.001, (t - this.lastT) / 1000);
    const dx = (x - this.x) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    this.dx = aD * dx + (1 - aD) * this.dx;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = this.alpha(cutoff, dt);
    this.x = a * x + (1 - a) * this.x;
    this.lastT = t;
    return this.x;
  }
  reset() { this.x = null; this.dx = 0; this.lastT = null; }
}

export class HandSmoother {
  constructor(minCutoff = 1.5, beta = 0.04) {
    this.fx = []; this.fy = []; this.fz = [];
    for (let i = 0; i < 21; i++) {
      this.fx.push(new OneEuro(minCutoff, beta));
      this.fy.push(new OneEuro(minCutoff, beta));
      this.fz.push(new OneEuro(minCutoff, beta));
    }
  }
  smooth(landmarks, t) {
    const out = [];
    for (let i = 0; i < 21; i++) {
      const lm = landmarks[i];
      out.push({
        x: this.fx[i].filter(lm.x, t),
        y: this.fy[i].filter(lm.y, t),
        z: this.fz[i].filter(lm.z || 0, t),
      });
    }
    return out;
  }
  reset() {
    for (let i = 0; i < 21; i++) {
      this.fx[i].reset();
      this.fy[i].reset();
      this.fz[i].reset();
    }
  }
}

/* ---------- Biomechanical metrics ---------- */

/**
 * Finger curl as the sum of (π − jointAngle) at the PIP and DIP joints.
 * Range: ~0 (perfectly straight) to ~3.0 (fully curled into a fist).
 * Rotation- and translation-invariant — purely a function of joint angles.
 */
function fingerCurl(lm, [mcp, pip, dip, tip]) {
  const pipAng = angleBetween(sub3(lm[mcp], lm[pip]), sub3(lm[dip], lm[pip]));
  const dipAng = angleBetween(sub3(lm[pip], lm[dip]), sub3(lm[tip], lm[dip]));
  return (Math.PI - pipAng) + (Math.PI - dipAng);
}

/* ---------- Hand state ---------- */

export function computeHandState(landmarks) {
  const lm = landmarks;

  const curls = {
    thumb:  fingerCurl(lm, FINGERS.thumb),
    index:  fingerCurl(lm, FINGERS.index),
    middle: fingerCurl(lm, FINGERS.middle),
    ring:   fingerCurl(lm, FINGERS.ring),
    pinky:  fingerCurl(lm, FINGERS.pinky),
  };

  // Hand scale: distance INDEX_MCP ↔ PINKY_MCP. A stable, hand-size invariant
  // unit we can normalize other distances by.
  const palmWidth = mag3(sub3(lm[L.INDEX.MCP], lm[L.PINKY.MCP]));

  // Palm normal vector — which way the palm faces.
  const v1 = sub3(lm[L.INDEX.MCP], lm[L.WRIST]);
  const v2 = sub3(lm[L.PINKY.MCP], lm[L.WRIST]);
  const palmNormal = norm3(cross3(v1, v2));

  // Two independent signals for thumb-down trigger:
  //   1. Angle between the index direction and the thumb direction.
  //      Up: ≈ 90° (1.5 rad). Pressed down: ≈ 30–45° (0.5–0.8 rad).
  //   2. Fold ratio: thumb-tip distance to INDEX_MCP, normalized by palm
  //      width. Up: ≈ 1.0+. Pressed down: ≈ 0.4–0.6.
  // pistol.js fires when EITHER signal crosses its threshold or drops fast
  // (see detectFire) — two signals so a noisy reading on one still lets the
  // other catch the press.
  const thumbAngle = angleBetween(
    sub3(lm[L.INDEX.TIP], lm[L.INDEX.MCP]),
    sub3(lm[L.THUMB.TIP], lm[L.THUMB.MCP])
  );
  const thumbFoldRatio = palmWidth > 0
    ? mag3(sub3(lm[L.THUMB.TIP], lm[L.INDEX.MCP])) / palmWidth
    : 1;

  // Curl thresholds: extended/curled. Tuned empirically on smoothed values.
  // NOTE (v2): these joint-angle curls are kept for display only. Recordings
  // showed curled fingers pointing at the camera read ~0.6–0.8 (never > 1.5),
  // so pose detection now uses `ext` below instead.
  const isExtended = (c) => c < 0.6;
  const isCurled   = (c) => c > 1.5;

  // Extension ratio: distance(tip, wrist) / distance(MCP, wrist).
  // Extended finger ≈ 1.7–2.1, curled ≈ 0.8–1.2. Unlike joint angles, this
  // stays readable when a curled finger points toward the camera.
  const extRatio = (mcp, tip) => {
    const base = mag3(sub3(lm[mcp], lm[L.WRIST]));
    return base > 0 ? mag3(sub3(lm[tip], lm[L.WRIST])) / base : 0;
  };
  const ext = {
    index:  extRatio(L.INDEX.MCP,  L.INDEX.TIP),
    middle: extRatio(L.MIDDLE.MCP, L.MIDDLE.TIP),
    ring:   extRatio(L.RING.MCP,   L.RING.TIP),
    pinky:  extRatio(L.PINKY.MCP,  L.PINKY.TIP),
  };

  // Stable palm point for position-based aiming: wrist + index MCP + pinky
  // MCP. None of these move when the thumb presses, so the shot doesn't
  // drag the crosshair.
  const palmPoint = {
    x: (lm[L.WRIST].x + lm[L.INDEX.MCP].x + lm[L.PINKY.MCP].x) / 3,
    y: (lm[L.WRIST].y + lm[L.INDEX.MCP].y + lm[L.PINKY.MCP].y) / 3,
  };

  return {
    landmarks: lm,
    palmWidth,
    palmNormal,
    palmPoint,
    ext,
    curls,
    fingers: {
      thumb:  { extended: isExtended(curls.thumb),  curled: isCurled(curls.thumb)  },
      index:  { extended: isExtended(curls.index),  curled: isCurled(curls.index)  },
      middle: { extended: isExtended(curls.middle), curled: isCurled(curls.middle) },
      ring:   { extended: isExtended(curls.ring),   curled: isCurled(curls.ring)   },
      pinky:  { extended: isExtended(curls.pinky),  curled: isCurled(curls.pinky)  },
    },
    thumb: {
      angle: thumbAngle,
      foldRatio: thumbFoldRatio,
      curl: curls.thumb,
    },
  };
}
