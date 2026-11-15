let audioCtx = null;
let masterGain = null;
let volume = 0.7;
let noiseBuffer = null;

function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = volume;
    masterGain.connect(audioCtx.destination);
  }
  // Browsers start the context "suspended" until a user gesture; without this
  // resume() the whole game can be silent. Cheap to call repeatedly.
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function dest() {
  getCtx();
  return masterGain;
}

// One reusable white-noise buffer, shaped per-SFX with gain envelopes —
// avoids allocating a fresh AudioBuffer on every shot.
function getNoise() {
  if (!noiseBuffer) {
    const ctx = getCtx();
    noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

export function initAudio() {
  getCtx();
  getNoise();
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (masterGain) masterGain.gain.value = volume;
}

export function playShoot() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  // Cap-gun crack: bandpassed noise burst with a sharp attack/decay envelope.
  // A brighter, snappier crack than the dull miss "phut" so a fired shot is
  // always audibly distinct.
  const noise = ctx.createBufferSource();
  noise.buffer = getNoise();
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1500;
  filter.Q.value = 0.9;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.6, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  noise.connect(filter).connect(ng).connect(dest());
  noise.start(t);
  noise.stop(t + 0.08);

  // Body thump
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.07);
  gain.gain.setValueAtTime(0.3, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  osc.connect(gain).connect(dest());
  osc.start(t);
  osc.stop(t + 0.11);
}

export function playHit() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  // Tin-can "ting": bright triangle that decays fast
  const osc = ctx.createOscillator();
  const og = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(1400, t);
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.18);
  og.gain.setValueAtTime(0.32, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
  osc.connect(og).connect(dest());
  osc.start(t);
  osc.stop(t + 0.34);

  // Sparkly upper harmonic
  const osc2 = ctx.createOscillator();
  const og2 = ctx.createGain();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(2200, t);
  osc2.frequency.exponentialRampToValueAtTime(1500, t + 0.15);
  og2.gain.setValueAtTime(0.18, t);
  og2.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  osc2.connect(og2).connect(dest());
  osc2.start(t);
  osc2.stop(t + 0.24);
}

export function playMiss() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  // Dull "phut" — a missed shot kicking up dust
  const noise = ctx.createBufferSource();
  noise.buffer = getNoise();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 600;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.28, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  noise.connect(filter).connect(ng).connect(dest());
  noise.start(t);
  noise.stop(t + 0.18);
}
