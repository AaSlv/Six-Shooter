import { computeCalibration, sampleOf } from "./pistol.js";

/**
 * session.js — the calibration step and the trigger test.
 * Pure state machines (no DOM): main.js feeds them frames and shots and
 * renders what view() returns. Times are in ms (performance.now()).
 */

/* ---------- Calibration ---------- */

const CAL_SETTLE_MS = 1200; // time to get into position (not recorded)
const CAL_RECORD_MS = 2000; // recorded

export function createCalibration(t0) {
  return {
    kind: "calibration",
    phase: "up", // "up" -> "down" -> "done" | "failed"
    phaseStart: t0,
    up: [],
    down: [],
    result: null,
  };
}

/** Feed one fresh frame. `state` may be null (no hand). */
export function calibrationFrame(cal, state, t) {
  if (cal.phase !== "up" && cal.phase !== "down") return cal;
  const el = t - cal.phaseStart;
  if (state && el >= CAL_SETTLE_MS) cal[cal.phase].push(sampleOf(state));
  if (el >= CAL_SETTLE_MS + CAL_RECORD_MS) {
    if (cal.phase === "up") {
      cal.phase = "down";
      cal.phaseStart = t;
    } else {
      cal.result = computeCalibration(cal.up, cal.down);
      cal.phase = cal.result.ok ? "done" : "failed";
      cal.phaseStart = t;
    }
  }
  return cal;
}

export function calibrationView(cal, t) {
  const el = t - cal.phaseStart;
  const total = CAL_SETTLE_MS + CAL_RECORD_MS;
  const left = Math.max(0, Math.ceil((total - el) / 1000));
  if (cal.phase === "up") {
    return {
      title: "CALIBRATION 1/2",
      text: "Make the pistol where you will play. Thumb UP. Hold still.",
      big: el < CAL_SETTLE_MS ? "get ready" : `${left}`,
    };
  }
  if (cal.phase === "down") {
    return {
      title: "CALIBRATION 2/2",
      text: "Same pistol. Press the thumb DOWN and hold it there.",
      big: el < CAL_SETTLE_MS ? "get ready" : `${left}`,
    };
  }
  if (cal.phase === "done") {
    return { title: "CALIBRATED", text: "Press T for the trigger test, or just play.", big: "" };
  }
  return {
    title: "CALIBRATION FAILED",
    text: `${cal.result.reason}. Press C to try again (keep the whole hand in the camera).`,
    big: "",
  };
}

/* ---------- Trigger test ---------- */

export const TEST = {
  stillMs: 30000, // hold the pistol, thumb up: every shot is a false fire
  cueCount: 20,
  cueEveryMs: 2500,
  firstCueMs: 2000, // after the still phase ends
  winBeforeMs: 300, // a shot this early still counts for the cue
  winAfterMs: 1200, // ... and this late
};

export function createTest(t0) {
  const cuedStart = t0 + TEST.stillMs;
  const cues = [];
  for (let i = 0; i < TEST.cueCount; i++) {
    cues.push({ t: cuedStart + TEST.firstCueMs + i * TEST.cueEveryMs, hitAt: null });
  }
  return {
    kind: "test",
    t0,
    cuedStart,
    end: cues[cues.length - 1].t + TEST.winAfterMs + 300,
    cues,
    falseStill: 0,
    extraCued: 0,
    done: false,
  };
}

export function testShot(test, t) {
  if (test.done) return;
  if (t < test.cuedStart) {
    test.falseStill++;
    return;
  }
  const cue = test.cues.find(
    (c) => c.hitAt === null && t >= c.t - TEST.winBeforeMs && t <= c.t + TEST.winAfterMs
  );
  if (cue) cue.hitAt = t;
  else test.extraCued++;
}

export function testTick(test, t) {
  if (!test.done && t >= test.end) test.done = true;
  return test;
}

export function testResults(test) {
  const hits = test.cues.filter((c) => c.hitAt !== null);
  const lat = hits.map((c) => c.hitAt - c.t).sort((a, b) => a - b);
  const med = lat.length ? lat[Math.floor((lat.length - 1) / 2)] : null;
  return {
    stillSeconds: TEST.stillMs / 1000,
    falseWhileStill: test.falseStill,
    detected: hits.length,
    cues: test.cues.length,
    extraShots: test.extraCued,
    medianLatencyMs: med === null ? null : Math.round(med),
  };
}

export function testView(test, t) {
  if (test.done) {
    const r = testResults(test);
    return {
      title: "TRIGGER TEST — RESULTS",
      text:
        `Still ${r.stillSeconds} s: ${r.falseWhileStill} false shots · ` +
        `Cued: ${r.detected}/${r.cues} detected · ${r.extraShots} extra shots` +
        (r.medianLatencyMs !== null ? ` · median delay ${r.medianLatencyMs} ms` : "") +
        ". Press T to repeat, any other key to play.",
      big: "",
    };
  }
  if (t < test.cuedStart) {
    const left = Math.ceil((test.cuedStart - t) / 1000);
    return {
      title: "TRIGGER TEST 1/2",
      text: "Hold the pistol, thumb UP. Don't shoot.",
      big: `${left}`,
    };
  }
  const idx = test.cues.findIndex((c) => t < c.t + TEST.winAfterMs);
  const cue = test.cues[Math.max(0, idx)];
  const showFire = idx >= 0 && t >= cue.t && t < cue.t + 450;
  const n = test.cues.filter((c) => c.t <= t).length;
  return {
    title: "TRIGGER TEST 2/2",
    text: `Shoot once each time you see FIRE! — cue ${Math.min(n, test.cues.length)}/${test.cues.length}`,
    big: showFire ? "FIRE!" : "",
  };
}
