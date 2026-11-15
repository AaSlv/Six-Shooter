// v3 key: v2 settings (e.g. a stale sensitivity) are not carried over.
const STORAGE_KEY = "six-shooter-config-v3";

const defaults = {
  aimAssist: {
    mode: "snap", // "snap" | "pull" | "off"
    radius: 110,
    pullStrength: 0.7,
  },
  aim: {
    mode: "position", // "position" (palm, v2) | "direction" (index finger, v1)
    range: 0.15, // fraction of camera width the palm travels for half the screen
  },
  targets: {
    count: 6,
    speedMultiplier: 1.0,
  },
  trigger: {
    // 0..1 — higher = a shallower thumb press fires. See triggerThresholds().
    sensitivity: 0.5,
  },
  // Set by the calibration step (pistol.js computeCalibration). null = use
  // DEFAULT_CALIB until the player calibrates.
  calib: null,
  audio: {
    volume: 0.7,
  },
  ui: {
    showDebug: false,
  },
};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Clamp/whitelist every value coming out of localStorage so a corrupted or
// hand-edited store can't push out-of-range values into gameplay.
function clampNum(v, lo, hi, fallback) {
  return typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
}

function validCalib(c) {
  if (!c || typeof c !== "object") return null;
  const nums = ["foldUp", "foldDown", "angleUp", "angleDown", "wFold", "wAngle", "indexExt"];
  for (const k of nums) if (typeof c[k] !== "number" || !isFinite(c[k])) return null;
  if (!c.palm || !isFinite(c.palm.x) || !isFinite(c.palm.y)) return null;
  if (c.foldUp <= c.foldDown && c.angleUp <= c.angleDown) return null;
  return c;
}

function sanitize(cfg) {
  const d = defaults;
  if (!["snap", "pull", "off"].includes(cfg.aimAssist.mode)) cfg.aimAssist.mode = d.aimAssist.mode;
  cfg.aimAssist.radius = clampNum(cfg.aimAssist.radius, 40, 220, d.aimAssist.radius);
  cfg.aimAssist.pullStrength = clampNum(cfg.aimAssist.pullStrength, 0, 1, d.aimAssist.pullStrength);
  if (!["position", "direction"].includes(cfg.aim.mode)) cfg.aim.mode = d.aim.mode;
  cfg.aim.range = clampNum(cfg.aim.range, 0.06, 0.35, d.aim.range);
  cfg.targets.count = Math.round(clampNum(cfg.targets.count, 1, 20, d.targets.count));
  cfg.targets.speedMultiplier = clampNum(cfg.targets.speedMultiplier, 0.5, 2.0, d.targets.speedMultiplier);
  cfg.trigger.sensitivity = clampNum(cfg.trigger.sensitivity, 0, 1, d.trigger.sensitivity);
  cfg.calib = validCalib(cfg.calib);
  cfg.audio.volume = clampNum(cfg.audio.volume, 0, 1, d.audio.volume);
  cfg.ui.showDebug = !!cfg.ui.showDebug;
  return cfg;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return deepClone(defaults);
    const stored = JSON.parse(raw);
    const merged = deepClone(defaults);
    for (const k of Object.keys(merged)) {
      if (k === "calib") merged.calib = stored.calib ?? null;
      else if (typeof merged[k] === "object" && merged[k] !== null && stored[k]) {
        merged[k] = { ...merged[k], ...stored[k] };
      }
    }
    return sanitize(merged);
  } catch {
    return deepClone(defaults);
  }
}

export const config = load();

export function saveConfig() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

// Reset settings but keep the player's calibration.
export function resetConfig() {
  const calib = config.calib;
  Object.assign(config, deepClone(defaults));
  config.calib = calib;
  saveConfig();
}
