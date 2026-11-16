# Six-Shooter

A browser-based gesture-controlled shooter with a dusty Western theme. Make a pistol with your hand, aim at the flying tin cans, and press your thumb down to fire.

## Stack

- **MediaPipe Tasks Vision** (HandLandmarker) — 21-landmark hand tracking, loaded from CDN
- **Canvas 2D** — game rendering + hand skeleton overlay
- **Web Audio API** — synthesised cap-gun / metal-ting / dust-thud SFX
- Plain ES modules — no build step

## Run it

The page must be served over `http://localhost` (or HTTPS) so the camera will turn on — opening `index.html` via `file://` will not work.

**Option A — VS Code Live Server** (recommended)

1. Open the `pistol-shooter/` folder in VS Code
2. Install the "Live Server" extension if you don't have it
3. Right-click `index.html` → **Open with Live Server**

**Option B — Python**

```bash
cd pistol-shooter
python3 -m http.server 8080
# then open http://localhost:8080
```

**Option C — Node**

```bash
cd pistol-shooter
npx serve
```

Click **DRAW**, allow camera access, and play.

## Controls

- **Pistol pose**: index finger out. The other fingers can be curled (one-finger pistol) or the middle finger out (two-finger gun) — only the index is checked.
- **Fire**: with your thumb up, press it down toward your index finger. One press = one shot; lift the thumb to re-arm.
- **Aim** (default *Hand Position*): move your whole hand — the crosshair follows your palm, so pressing the thumb doesn't move it. *Finger Direction* (the v1 behaviour) is still in Settings.
- **Keys**: `M` / `Esc` menu · `C` calibrate · `T` trigger test · `L` start/stop a session log.

## Calibration and trigger test (v2)

On the first run the game asks you to hold the pistol for ~3 s with the **thumb up**, then ~3 s with the **thumb down**. It saves your hand's own values (thumb fold and angle, index extension, where you hold the hand) and builds every threshold from them. Recalibrate with `C` if you change seat, camera or lighting.

`T` runs a measured test: 30 s holding still (every shot is a false shot), then 20 *FIRE!* cues every 2.5 s. The result — false shots, detected cues, extra shots and median delay — is shown on screen and logged to the console.

`L` records every camera frame (press depth, thumb fold/angle, index extension, pose, trigger state, shots) while you play normally; press `Space` with the other hand each time you *mean* to shoot. Press `L` again to download the CSV — it shows exactly which intended shots were missed and which shots were unwanted.

## Hand tracking pipeline

The previous version made decisions from a few hand-picked landmark distances. This version walks every frame through a richer pipeline:

1. **All 21 MediaPipe landmarks** are smoothed individually with a per-axis **One-Euro filter** (`handModel.js`). One-Euro is the standard adaptive low-pass for noisy real-time signals — it keeps slow motion stable while staying responsive to fast moves.
2. **Per-finger biomechanical curl** is computed from the angles at the PIP and DIP joints (`fingerCurl()`). The metric is `(π − pipAngle) + (π − dipAngle)` and is rotation- and translation-invariant. Range: ~0 (straight) to ~3.0 (fully curled).
3. **Hand scale** — distance between INDEX_MCP and PINKY_MCP — is used to normalise other distances so thresholds work regardless of how close the hand is to the camera.
4. **Palm normal** is the cross-product of two palm-spanning vectors. Available for future features (orientation-based aim, recoil-recovery detection, etc.).
5. **Trigger uses two independent signals**, plus their velocity:
   - Thumb angle vs. index direction (`thumb.angle`)
   - Thumb-tip-to-INDEX_MCP distance, normalised by palm width (`thumb.foldRatio`)
   Fires on the rising edge of "pressed", which is true when *either* signal crosses its absolute threshold **or** is dropping fast toward the pressed region — so a snappy trigger flick that never quite reaches the static threshold still registers. Re-arms when either signal returns past its release threshold. All thresholds scale with the **Trigger Sensitivity** setting.

Toggle **Show Hand Sensor Readout** in the menu to see all of the above values live, plus pose state and trigger arming, while you play.

## Settings menu

| Setting | What it does |
|---|---|
| Aim Assist | Hard Snap (crosshair jumps to nearest target) / Soft Pull (drifts toward it) / Off |
| Snap / Pull Radius | How close your aim needs to be for the assist to engage |
| Tin Cans on Screen | How many cans are kept in the air at once (2–8) |
| Target Speed | Multiplier on can speed (0.5×–2.0×) |
| Volume | Master volume |
| Trigger Sensitivity | How easily the thumb-down fire gesture registers — raise it if shots aren't firing, lower it if they fire on their own |
| Show Hand Sensor Readout | Toggles the live-tracking debug panel |

Settings persist via `localStorage` between sessions.

## File map

| File | Purpose |
|---|---|
| `index.html` | DOM scaffolding: canvas, webcam, start screen, settings menu, debug panel |
| `styles.css` | Western/saloon styling + debug panel + menu |
| `main.js` | MediaPipe init, camera setup, render loop, colour-coded skeleton overlay, debug panel updates |
| `handModel.js` | One-Euro filter, biomechanical curl/angle math, hand state assembly |
| `pistol.js` | Pose detection, two-signal thumb-down trigger, aim-point mapping (uses `handModel.js`) |
| `game.js` | Tin-can spawning/movement, hit detection, aim assist (snap/pull/off), drawing background + cans + crosshair |
| `vfx.js` | Floating HIT/MISS phrases, shrapnel + dust + spark particles, muzzle flash |
| `audio.js` | Synthesized SFX with master volume |
| `config.js` | Settings state with localStorage persistence |
| `menu.js` | Settings UI wiring + pause control |

## Tuning

Most feel knobs live at the top of their respective files:

- `pistol.js` → `thresholds()` — maps the **Trigger Sensitivity** setting (0–1) onto the fire/rearm angle & fold thresholds and the press-velocity thresholds. `COOLDOWN_MS` is the minimum gap between shots.
- `handModel.js` → `HandSmoother(minCutoff, beta)` constructor args — smoothing strength. Higher `minCutoff` = more responsive but jitterier; higher `beta` = more reactive to fast motion (raised to 0.35 so quick trigger flicks aren't smoothed away).
- `handModel.js` → `isExtended` / `isCurled` thresholds inside `computeHandState()` — what counts as a finger being out vs. curled.

## Next ideas

- Round timer + high-score table
- Combo multiplier for consecutive hits
- A wider variety of targets (bottles, sheriff stars, swinging saloon doors)
- Per-player calibration step that records "neutral pistol pose" and "thumb fully pressed" to set personalised thresholds
- Two-handed mode (akimbo)
