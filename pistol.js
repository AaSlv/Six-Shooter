import { HandSmoother, computeHandState, OneEuro, L } from "./handModel.js";
import { config } from "./config.js";

/**
 * pistol.js — v2 gesture layer.
 *
 * What changed vs v1 (and why — from measured recordings):
 *  - Gestures read RAW landmarks. The landmark One-Euro filter delayed the
 *    thumb press (a 150 ms press reached ~47% of its travel in simulation).
 *    Smoothed landmarks are kept only for drawing the skeleton.
 *  - Pose = "index extended" only, measured with an extension ratio and
 *    calibrated to the player's hand. The old rule (middle/ring/pinky curl
 *    > 1.5) was satisfied in 0% of recorded frames.
 *  - Trigger = one normalized "press depth" (0 = thumb up, 1 = thumb down),
 *    built from the calibrated fold + angle signals, with a median-of-3
 *    filter and a fire/re-arm state machine with hysteresis.
 *  - Aim = position of a stable palm point (default) — pressing the thumb
 *    doesn't move it. The old finger-direction aim is still available.
 *  - A short tracking dropout no longer resets the trigger or the aim.
 */

/* ---------- Calibration ---------- */

// Defaults come from a recorded session (thumb up: fold ≈ 1.2, angle ≈ 0.9;
// thumb down: fold ≈ 0.5, angle ≈ 0.25). Calibration replaces them.
export const DEFAULT_CALIB = {
  foldUp: 1.2,
  foldDown: 0.5,
  angleUp: 0.9,
  angleDown: 0.25,
  wFold: 1,
  wAngle: 1,
  indexExt: 1.8,
  palm: { x: 0.5, y: 0.55 },
};

export function getCalib() {
  return config.calib || DEFAULT_CALIB;
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function quantile(a, q) {
  const s = [...a].sort((x, y) => x - y);
  if (!s.length) return NaN;
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
function robustSd(a) {
  return (quantile(a, 0.75) - quantile(a, 0.25)) / 1.35;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Build a calibration from samples recorded with the thumb UP and DOWN.
 * Each sample: { fold, angle, indexExt, px, py }.
 * Returns { ok, calib, reason, sep } — sep = separation (d') per signal.
 */
export function computeCalibration(up, down) {
  if (up.length < 15 || down.length < 15) {
    return { ok: false, reason: "not enough frames with the hand visible" };
  }
  const col = (arr, k) => arr.map((s) => s[k]);
  const sep = (u, d) => {
    const spread = (robustSd(u) + robustSd(d)) / 2 + 0.02;
    return (median(u) - median(d)) / spread;
  };
  const dFold = sep(col(up, "fold"), col(down, "fold"));
  const dAngle = sep(col(up, "angle"), col(down, "angle"));
  const wFold = Math.max(0, dFold);
  const wAngle = Math.max(0, dAngle);
  if (Math.max(wFold, wAngle) < 1.5) {
    return {
      ok: false,
      sep: { fold: dFold, angle: dAngle },
      reason: "thumb up and thumb down looked too similar",
    };
  }
  return {
    ok: true,
    sep: { fold: dFold, angle: dAngle },
    calib: {
      foldUp: median(col(up, "fold")),
      foldDown: median(col(down, "fold")),
      angleUp: median(col(up, "angle")),
      angleDown: median(col(down, "angle")),
      // A signal that doesn't separate gets weight 0 instead of adding noise.
      wFold: wFold >= 1 ? wFold : 0,
      wAngle: wAngle >= 1 ? wAngle : 0,
      indexExt: median(col(up, "indexExt")),
      palm: { x: median(col(up, "px")), y: median(col(up, "py")) },
    },
  };
}

/** Raw sample for calibration from a state. */
export function sampleOf(state) {
  return {
    fold: state.thumb.foldRatio,
    angle: state.thumb.angle,
    indexExt: state.ext.index,
    px: state.palmPoint.x,
    py: state.palmPoint.y,
  };
}

/* ---------- Frame processing ---------- */

const drawSmoother = new HandSmoother(1.7, 0.35);
const LOST_RESET_MS = 600;
let lostSince = null;

/** Process one detection result. Returns a state, or null if no hand. */
export function processFrame(rawLandmarks, t) {
  if (!rawLandmarks) {
    if (lostSince === null) lostSince = t;
    if (t - lostSince > LOST_RESET_MS) {
      drawSmoother.reset();
      resetTrigger();
      resetAim();
    }
    return null;
  }
  lostSince = null;
  const state = computeHandState(rawLandmarks); // gestures: raw landmarks
  state.drawLandmarks = drawSmoother.smooth(rawLandmarks, t); // display only
  return state;
}

/* ---------- Pose ---------- */

const POSE_GRACE_MS = 300;
let poseOn = false;
let lastPoseTime = -Infinity;

/** Index extended (relative to the calibrated hand), with hysteresis. */
export function detectPistolPose(state, t) {
  if (!state) return false;
  const need = getCalib().indexExt;
  const e = state.ext.index;
  poseOn = poseOn ? e >= 0.7 * need : e >= 0.8 * need;
  if (poseOn) lastPoseTime = t;
  return poseOn || t - lastPoseTime <= POSE_GRACE_MS;
}

/* ---------- Trigger ---------- */

/** 0 = thumb up (calibrated), 1 = thumb fully down (calibrated). */
export function pressDepth(state) {
  const c = getCalib();
  const f = clamp01((c.foldUp - state.thumb.foldRatio) / (c.foldUp - c.foldDown || 1));
  const a = clamp01((c.angleUp - state.thumb.angle) / (c.angleUp - c.angleDown || 1));
  const w = c.wFold + c.wAngle;
  return w > 0 ? (c.wFold * f + c.wAngle * a) / w : f;
}

export function triggerThresholds() {
  const s = clamp01(config.trigger.sensitivity);
  const fire = 0.75 - 0.3 * s; // 0.75 (strict) .. 0.45 (sensitive); 0.6 at 50%
  return { fire, rearm: fire - 0.25 };
}

const COOLDOWN_MS = 120;
// Relative press/release (v2.1). In play the thumb often doesn't return all
// the way up between shots (recorded: ~19% of the time stuck "waiting
// release"), so a release now also counts when depth falls RELEASE_DROP below
// the peak of the press, and a press must rise PRESS_RISE above the lowest
// point since the last release.
const PRESS_RISE = 0.25;
const RELEASE_DROP = 0.3;
let armed = true;
let belowCount = 0;
let depthHist = [];
let lastShot = -Infinity;
let lastDepth = 0;
let valley = 0;
let peak = 0;

export function resetTrigger() {
  armed = true;
  belowCount = 0;
  depthHist = [];
  valley = 0;
  peak = 0;
}

export function triggerDebug() {
  return { depth: lastDepth, armed };
}

/**
 * Call ONLY on frames with fresh landmarks. Returns true on a shot.
 * Fires when the median-of-3 depth crosses `fire`; re-arms after it stays
 * under `rearm` for 2 frames. A press made without the pose is consumed
 * (no delayed shot when the pose comes back mid-press).
 */
export function updateTrigger(state, poseOk, t) {
  depthHist.push(pressDepth(state));
  if (depthHist.length > 3) depthHist.shift();
  const d = median(depthHist);
  lastDepth = d;
  const { fire, rearm } = triggerThresholds();

  if (armed) {
    valley = Math.min(valley, d);
    if (d >= fire && d - valley >= PRESS_RISE && t - lastShot >= COOLDOWN_MS) {
      armed = false;
      belowCount = 0;
      peak = d;
      if (poseOk) {
        lastShot = t;
        return true;
      }
    }
    return false;
  }
  peak = Math.max(peak, d);
  belowCount = d <= rearm || peak - d >= RELEASE_DROP ? belowCount + 1 : 0;
  if (belowCount >= 2) {
    armed = true;
    valley = d;
  }
  return false;
}

/* ---------- Aim ---------- */

const aimFilterX = new OneEuro(1.2, 0.01);
const aimFilterY = new OneEuro(1.2, 0.01);

export function resetAim() {
  aimFilterX.reset();
  aimFilterY.reset();
}

/**
 * mode "position" (default): a stable palm point, relative to where the hand
 *   was held during calibration, maps to the screen. Same gain on both axes.
 * mode "direction": v1 behaviour — where the index finger points.
 */
export function getAimPoint(state, canvas, t, video) {
  if (!state) return null;
  const W = canvas.width;
  const H = canvas.height;
  let rawX, rawY;

  if (config.aim.mode === "direction") {
    const lm = state.landmarks;
    const dx = -(lm[L.INDEX.TIP].x - lm[L.INDEX.MCP].x);
    const dy = lm[L.INDEX.TIP].y - lm[L.INDEX.MCP].y;
    const scale = (W + H) * 2.0;
    rawX = W / 2 + dx * scale;
    rawY = H - 40 + dy * scale;
  } else {
    const c = getCalib();
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const rangePx = config.aim.range * vw; // hand travel (camera px) for half the screen width
    const gain = W / 2 / rangePx;
    const dxPx = -(state.palmPoint.x - c.palm.x) * vw; // mirrored
    const dyPx = (state.palmPoint.y - c.palm.y) * vh;
    rawX = W / 2 + dxPx * gain;
    rawY = H / 2 + dyPx * gain;
  }

  rawX = Math.max(0, Math.min(W, rawX));
  rawY = Math.max(0, Math.min(H, rawY));
  return { x: aimFilterX.filter(rawX, t), y: aimFilterY.filter(rawY, t) };
}
