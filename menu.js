import { config, saveConfig, resetConfig } from "./config.js";
import { setPaused, setTargetCount } from "./game.js";
import { setVolume } from "./audio.js";

let menuEl = null;
let isOpen = false;
let actions = { calibrate: () => {}, test: () => {} };

// `handlers` = { calibrate, test } from main.js.
export function initMenu(handlers = {}) {
  actions = { ...actions, ...handlers };
  menuEl = document.getElementById("menu-overlay");

  document.getElementById("menu-btn").addEventListener("click", openMenu);
  document.getElementById("menu-close").addEventListener("click", closeMenu);
  document.getElementById("menu-reset").addEventListener("click", () => {
    resetConfig();
    syncControls();
    applyConfig();
    applyDebugVisibility();
  });
  document.getElementById("menu-calibrate").addEventListener("click", () => {
    closeMenu();
    actions.calibrate();
  });
  document.getElementById("menu-test").addEventListener("click", () => {
    closeMenu();
    actions.test();
  });

  bindRadio("aim-mode", (v) => { config.aimAssist.mode = v; });
  bindRadio("aim-control", (v) => { config.aim.mode = v; });

  bindRange("aim-range", "range-value", (v) => `${v}%`, (v) => {
    config.aim.range = v / 100;
  });
  bindRange("snap-radius", "radius-value", (v) => `${v}`, (v) => {
    config.aimAssist.radius = v;
  });
  bindRange("target-count", "count-value", (v) => `${v}`, (v) => {
    config.targets.count = v;
    setTargetCount(v);
  });
  bindRange("target-speed", "speed-value", (v) => `${(v / 100).toFixed(2)}×`, (v) => {
    config.targets.speedMultiplier = v / 100;
  });
  bindRange("audio-volume", "volume-value", (v) => `${v}%`, (v) => {
    config.audio.volume = v / 100;
    setVolume(v / 100);
  });
  bindRange("trigger-sensitivity", "trigger-value", (v) => `${v}%`, (v) => {
    config.trigger.sensitivity = v / 100;
  });

  const debugToggle = document.getElementById("debug-toggle");
  debugToggle.addEventListener("change", () => {
    config.ui.showDebug = debugToggle.checked;
    applyDebugVisibility();
    saveConfig();
  });

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (e.key === "Escape" || k === "m") {
      e.preventDefault();
      isOpen ? closeMenu() : openMenu();
    } else if (!isOpen && k === "c") {
      actions.calibrate();
    } else if (!isOpen && k === "t") {
      actions.test();
    }
  });

  syncControls();
  applyConfig();
  applyDebugVisibility();
}

export function menuIsOpen() {
  return isOpen;
}

function bindRadio(name, onChange) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((el) => {
    el.addEventListener("change", () => {
      if (el.checked) {
        onChange(el.value);
        saveConfig();
      }
    });
  });
}

function bindRange(inputId, displayId, format, onChange) {
  const input = document.getElementById(inputId);
  const display = document.getElementById(displayId);
  input.addEventListener("input", () => {
    const v = parseInt(input.value, 10);
    onChange(v);
    display.textContent = format(v);
    saveConfig();
  });
}

function setRange(inputId, displayId, value, format) {
  document.getElementById(inputId).value = value;
  document.getElementById(displayId).textContent = format(value);
}

function setRadio(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((r) => {
    r.checked = r.value === value;
  });
}

function syncControls() {
  setRadio("aim-mode", config.aimAssist.mode);
  setRadio("aim-control", config.aim.mode);
  setRange("aim-range", "range-value", Math.round(config.aim.range * 100), (v) => `${v}%`);
  setRange("snap-radius", "radius-value", config.aimAssist.radius, (v) => `${v}`);
  setRange("target-count", "count-value", config.targets.count, (v) => `${v}`);
  setRange("target-speed", "speed-value", Math.round(config.targets.speedMultiplier * 100), (v) => `${(v / 100).toFixed(2)}×`);
  setRange("audio-volume", "volume-value", Math.round(config.audio.volume * 100), (v) => `${v}%`);
  setRange("trigger-sensitivity", "trigger-value", Math.round(config.trigger.sensitivity * 100), (v) => `${v}%`);
  document.getElementById("debug-toggle").checked = !!config.ui.showDebug;
}

function applyConfig() {
  setTargetCount(config.targets.count);
  setVolume(config.audio.volume);
}

function applyDebugVisibility() {
  const panel = document.getElementById("debug-panel");
  if (config.ui.showDebug) panel.classList.remove("hidden");
  else panel.classList.add("hidden");
}

function openMenu() {
  if (!menuEl) return;
  isOpen = true;
  menuEl.classList.remove("hidden");
  setPaused(true);
  document.getElementById("menu-close").focus();
}

function closeMenu() {
  if (!menuEl) return;
  isOpen = false;
  menuEl.classList.add("hidden");
  setPaused(false);
  document.getElementById("menu-btn").focus();
}
