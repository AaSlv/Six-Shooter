import {
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs";

import {
  detectPistolPose,
  updateTrigger,
  triggerDebug,
  getAimPoint,
  getCalib,
  processFrame,
  resetTrigger,
  resetAim,
} from "./pistol.js";
import { initGame, updateGame, drawGame, fireShot, getCanvas, setPaused } from "./game.js";
import { initAudio } from "./audio.js";
import { initMenu, menuIsOpen } from "./menu.js";
import { config, saveConfig } from "./config.js";
import {
  createCalibration,
  calibrationFrame,
  calibrationView,
  createTest,
  testShot,
  testTick,
  testView,
  testResults,
} from "./session.js";

const video = document.getElementById("webcam");
const overlay = document.getElementById("webcam-overlay");
const overlayCtx = overlay.getContext("2d");
const statusEl = document.getElementById("status");
const startOverlay = document.getElementById("start-overlay");
const startBtn = document.getElementById("start-btn");
const menuBtn = document.getElementById("menu-btn");
const coachEl = document.getElementById("coach");
const coachTitle = document.getElementById("coach-title");
const coachText = document.getElementById("coach-text");
const coachBig = document.getElementById("coach-big");

const dbg = {
  depth: document.getElementById("dbg-depth"),
  thumbFold: document.getElementById("dbg-thumb-fold"),
  thumbAngle: document.getElementById("dbg-thumb-angle"),
  index: document.getElementById("dbg-index"),
  pose: document.getElementById("dbg-pose"),
  trigger: document.getElementById("dbg-trigger"),
  calib: document.getElementById("dbg-calib"),
  aim: document.getElementById("dbg-aim"),
  log: document.getElementById("dbg-log"),
};

let handLandmarker = null;
let vision = null;
let lastVideoTime = -1;

// The last state is kept briefly so the skeleton/aim don't flicker on render
// frames without a new detection (camera ~30 fps vs display ~60 fps).
let lastState = null;
let lastStateTime = 0;
const STATE_TIMEOUT_MS = 250;

// Active calibration or trigger test (or null).
let session = null;
let sessionEndedAt = 0;

async function loadModel() {
  statusEl.textContent = "Loadin' the iron...";
  vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
    // Defaults are 0.5. The recordings lost the hand in ~25% of frames;
    // lower thresholds keep tracking through motion blur and partial views.
    minHandDetectionConfidence: 0.35,
    minHandPresenceConfidence: 0.35,
    minTrackingConfidence: 0.35,
  });
}

async function startCamera() {
  statusEl.textContent = "Eyein' the camera...";
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((r) => (video.onloadedmetadata = r));
  await video.play();
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
}

/* ---------- Sessions (calibration / trigger test) ---------- */

function startCalibration() {
  session = createCalibration(performance.now());
  resetTrigger();
  setPaused(true);
}

function startTest() {
  session = createTest(performance.now());
  resetTrigger();
  setPaused(true);
}

function endSession() {
  session = null;
  sessionEndedAt = performance.now();
  coachEl.classList.add("hidden");
  if (!menuIsOpen()) setPaused(false);
}

// Results / "calibrated" screens stay up until a key or 6 s.
window.addEventListener("keydown", (e) => {
  if (!session) return;
  const finished =
    (session.kind === "test" && session.done) ||
    (session.kind === "calibration" && (session.phase === "done" || session.phase === "failed"));
  const k = e.key.toLowerCase();
  if (finished && k !== "t" && k !== "c") endSession();
});

function renderCoach(view) {
  coachEl.classList.remove("hidden");
  coachTitle.textContent = view.title;
  coachText.textContent = view.text;
  coachBig.textContent = view.big;
  coachBig.classList.toggle("fire", view.big === "FIRE!");
}

/* ---------- Hand visualization on the webcam overlay ---------- */

const FINGER_BONES = {
  thumb: [[0, 1], [1, 2], [2, 3], [3, 4]],
  index: [[5, 6], [6, 7], [7, 8]],
  middle: [[9, 10], [10, 11], [11, 12]],
  ring: [[13, 14], [14, 15], [15, 16]],
  pinky: [[17, 18], [18, 19], [19, 20]],
};
const PALM_BONES = [[0, 5], [5, 9], [9, 13], [13, 17], [0, 17]];
const TIPS = new Set([4, 8, 12, 16, 20]);

function drawHandSkeleton(ctx, state, w, h, isPistol, depth) {
  const lm = state.drawLandmarks || state.landmarks;
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);

  ctx.strokeStyle = "rgba(244, 234, 212, 0.55)";
  ctx.lineWidth = 1.5;
  for (const [a, b] of PALM_BONES) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  }
  for (const [name, bones] of Object.entries(FINGER_BONES)) {
    // Index: green when the pose is valid. Thumb: red as it presses.
    if (name === "index") ctx.strokeStyle = isPistol ? "#7fff7f" : "#d6bd92";
    else if (name === "thumb") ctx.strokeStyle = `rgb(255, ${Math.round(234 - 160 * depth)}, ${Math.round(212 - 160 * depth)})`;
    else ctx.strokeStyle = "rgba(244, 234, 212, 0.45)";
    ctx.lineWidth = name === "index" || name === "thumb" ? 3 : 2;
    for (const [a, b] of bones) {
      ctx.beginPath();
      ctx.moveTo(lm[a].x * w, lm[a].y * h);
      ctx.lineTo(lm[b].x * w, lm[b].y * h);
      ctx.stroke();
    }
  }
  for (let i = 0; i < lm.length; i++) {
    ctx.fillStyle = TIPS.has(i) ? "#f4d058" : "rgba(244, 234, 212, 0.7)";
    ctx.beginPath();
    ctx.arc(lm[i].x * w, lm[i].y * h, TIPS.has(i) ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ---------- Session log (L to start/stop, Space = "I meant to shoot") ---------- */

// Records every fresh frame at camera rate and downloads a CSV on stop.
// Pressing Space (other hand) each time you intend to shoot gives the ground
// truth needed to count missed and unwanted shots.
let log = null;
let intentPending = false;

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && log) {
    e.preventDefault();
    intentPending = true;
  }
  if (e.key.toLowerCase() === "l" && !menuIsOpen()) {
    if (!log) {
      log = { t0: performance.now(), rows: [] };
      statusEl.textContent = "Recording log... Space each time you mean to shoot. L to stop.";
    } else {
      downloadLog(log);
      log = null;
      statusEl.textContent = "Log saved. Pistol up. (M menu · C calibrate · T test · L log)";
    }
  }
});

function downloadLog(lg) {
  const head = "t_ms,hand,depth,fold,angle,index_ext,pose,armed,fired,intent";
  const csv = [head, ...lg.rows.map((r) => r.join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `six-shooter-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  a.click();
}

/* ---------- Debug panel ---------- */

function updateDebugPanel(state, isPistol, firedRecently) {
  if (!config.ui.showDebug) return;
  const tdbg = triggerDebug();
  dbg.calib.textContent = config.calib ? "yes" : "no (defaults)";
  dbg.aim.textContent = config.aim.mode;
  dbg.log.textContent = log ? `recording ${((performance.now() - log.t0) / 1000).toFixed(0)} s` : "off (L)";
  if (!state) {
    for (const k of ["depth", "thumbFold", "thumbAngle", "index"]) dbg[k].textContent = "—";
    dbg.pose.textContent = "no hand";
    dbg.trigger.textContent = "—";
    return;
  }
  dbg.depth.textContent = tdbg.depth.toFixed(2);
  dbg.thumbFold.textContent = state.thumb.foldRatio.toFixed(2);
  dbg.thumbAngle.textContent = `${state.thumb.angle.toFixed(2)} rad`;
  dbg.index.textContent = `${state.ext.index.toFixed(2)} / ${getCalib().indexExt.toFixed(2)}`;
  dbg.pose.textContent = isPistol ? "PISTOL" : "no pose";
  dbg.trigger.textContent = firedRecently ? "FIRE!" : tdbg.armed ? "armed" : "waiting release";
}

/* ---------- Main loop ---------- */

let lastFireFlash = 0;

function loop(now) {
  // 1. Detect only when the camera produced a new frame.
  let freshFrame = false;
  let freshState = null;
  if (handLandmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = handLandmarker.detectForVideo(video, now);
    const raw = result.landmarks && result.landmarks.length > 0 ? result.landmarks[0] : null;
    freshFrame = true;
    freshState = processFrame(raw, now);
    if (freshState) {
      lastState = freshState;
      lastStateTime = now;
    }
  }

  // 3. Cached state for drawing; trigger runs on fresh frames only.
  if (lastState && now - lastStateTime > STATE_TIMEOUT_MS) lastState = null;
  const state = lastState;

  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  let aim = null;
  let isPistol = false;
  let didFire = false;

  if (state) {
    isPistol = detectPistolPose(state, now);
    aim = getAimPoint(state, getCanvas(), now, video);
  }

  const calibrating = session && session.kind === "calibration";
  if (freshFrame && calibrating) calibrationFrame(session, freshState, now);
  if (freshFrame && freshState && !calibrating) {
    didFire = updateTrigger(freshState, isPistol, now);
  }
  if (log && freshFrame) {
    const s = freshState;
    const td = triggerDebug();
    log.rows.push([
      Math.round(now - log.t0),
      s ? 1 : 0,
      s ? td.depth.toFixed(3) : "",
      s ? s.thumb.foldRatio.toFixed(3) : "",
      s ? s.thumb.angle.toFixed(3) : "",
      s ? s.ext.index.toFixed(3) : "",
      isPistol ? 1 : 0,
      td.armed ? 1 : 0,
      didFire ? 1 : 0,
      intentPending ? 1 : 0,
    ]);
    intentPending = false;
  }
  if (state) drawHandSkeleton(overlayCtx, state, overlay.width, overlay.height, isPistol, triggerDebug().depth);

  // 4. Sessions
  if (session) {
    if (session.kind === "calibration") {
      if (session.phase === "done" && session.result && !session.saved) {
        config.calib = session.result.calib;
        saveConfig();
        resetAim();
        session.saved = true;
        console.log("[six-shooter] calibration", session.result);
      }
      renderCoach(calibrationView(session, now));
      if ((session.phase === "done" || session.phase === "failed") && now - session.phaseStart > 6000) endSession();
    } else {
      if (didFire) testShot(session, now);
      testTick(session, now);
      renderCoach(testView(session, now));
      if (session.done && !session.logged) {
        session.logged = true;
        console.log("[six-shooter] trigger test", JSON.stringify(testResults(session)));
      }
    }
  }

  // 5. Game
  updateGame(now, aim, isPistol);
  if (didFire) {
    lastFireFlash = now;
    if (!session) fireShot(aim);
  }
  drawGame(now, aim, isPistol);

  updateDebugPanel(state, isPistol, now - lastFireFlash < 150);
  requestAnimationFrame(loop);
}

async function start() {
  startBtn.disabled = true;
  startBtn.textContent = "MOSEYIN'...";
  initAudio(); // inside the click gesture, so audio isn't suspended
  try {
    await loadModel();
    await startCamera();
    initGame();
    initMenu({ calibrate: startCalibration, test: startTest });
    statusEl.textContent = "Pistol up. Press thumb down to fire. (M menu · C calibrate · T test · L log)";
    startOverlay.classList.add("hidden");
    menuBtn.classList.add("visible");
    if (!config.calib) startCalibration(); // first run: calibrate to this hand
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Trouble: " + err.message;
    startBtn.disabled = false;
    startBtn.textContent = "RETRY";
  }
}

startBtn.addEventListener("click", start);
