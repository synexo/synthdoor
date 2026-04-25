# CP437/ANSI Image Converter — Full Implementation Specification

## Overview

An interactive terminal application that converts any source image to true BBS-style CP437/ANSI art,
rendered in 16-color foreground / 8-color background ANSI escape sequences, targeting an 80×24
terminal. The user loads an image by URL, sees an immediate conversion at default settings, and
interactively tunes the output via keyboard controls with live re-render on every change.

---

## Output Constraints

- **Terminal dimensions**: 80 columns × 24 rows (fixed)
- **Color model**: 16-color foreground (CGA colors 0–15), 8-color background (CGA colors 0–7)
- **Character set**: CP437 block characters only — no text, no line-drawing, no Unicode
- **ANSI escape format**: Standard `ESC[{attr};{fg};{bg}m` sequences, no 256-color or truecolor tricks
- **Output format**: Raw `.ANS` byte stream to terminal stdout; also saveable to `.ANS` file

### CP437 Block Characters in Use

| Char | CP437 Code | Role |
|------|-----------|------|
| `█`  | 219       | Full block — solid FG color |
| `▀`  | 223       | Upper half block — vertical split |
| `▄`  | 220       | Lower half block — vertical split |
| `▌`  | 221       | Left half block — horizontal split |
| `▐`  | 222       | Right half block — horizontal split |
| `░`  | 176       | Light shade (~25% FG over BG) |
| `▒`  | 177       | Medium shade (~50% FG over BG) |
| `▓`  | 178       | Dark shade (~75% FG over BG) |
| ` `  | 32        | Space — solid BG color |

---

## CGA Palette

### Foreground (16 colors)

| Index | Name         | Hex       |
|-------|--------------|-----------|
| 0     | Black        | #000000   |
| 1     | Dark Blue    | #0000AA   |
| 2     | Dark Green   | #00AA00   |
| 3     | Dark Cyan    | #00AAAA   |
| 4     | Dark Red     | #AA0000   |
| 5     | Dark Magenta | #AA00AA   |
| 6     | Brown        | #AA5500   |
| 7     | Light Gray   | #AAAAAA   |
| 8     | Dark Gray    | #555555   |
| 9     | Bright Blue  | #5555FF   |
| 10    | Bright Green | #55FF55   |
| 11    | Bright Cyan  | #55FFFF   |
| 12    | Bright Red   | #FF5555   |
| 13    | Bright Magenta | #FF55FF |
| 14    | Yellow       | #FFFF55   |
| 15    | White        | #FFFFFF   |

### Background (8 colors)
Colors 0–7 only (dark half of foreground palette). No bright backgrounds in standard ANSI.

---

## Logical Resolution Model

Each 80×24 terminal cell maps to a 2×2 block of logical pixels in a 160×48 grid.
Within each cell, exactly one character strategy is chosen — these are mutually exclusive:

- **Vertical split** (`▀`/`▄`): top 2 logical pixels one color, bottom 2 another → effective 80×48
- **Horizontal split** (`▌`/`▐`): left 2 pixels one color, right 2 another → effective 160×24
- **Shade blend** (`░`/`▒`/`▓`): full cell blended color at 25/50/75% FG:BG ratio → 80×24
- **Solid** (`█`/` `): single color, full cell → 80×24

---

## Rendering Pipeline

### Stage 1 — Image Acquisition & Viewport
- Load source image from URL via HTTP
- Apply zoom and pan to define the source region of interest
- Aspect ratio of CP437 cell is approximately 1:2 (width:height) based on 8×16 glyph dimensions
- Scale source region to 160×48 logical pixels using Lanczos resampling
- If source aspect ratio does not fill 80×24 terminal cells: letterbox (horizontal bars)
  or pillarbox (vertical bars) with user-configurable fill color and fill character

### Stage 2 — Pre-processing
Apply in order, all adjustable via knobs:
1. Color temperature shift (cool/warm)
2. Brightness adjustment
3. Contrast adjustment
4. Saturation adjustment
5. Optional sharpening pre-pass (unsharp mask, mild)
6. Optional sub-representable detail smoothing (blur fine texture below cell scale)

### Stage 3 — Color Space Conversion
- Convert all 160×48 logical pixels to Oklab color space
- Pre-compute Oklab coordinates for all 16 CGA foreground colors
- Pre-compute Oklab coordinates for all 8 CGA background colors
- Build perceptual distance lookup table for all 128 FG×BG combinations

### Stage 4 — Per-Cell Evaluation (80×24 cells)

For each terminal cell:

#### 4a. Cell Analysis
- Extract 2×2 logical pixel block in Oklab
- Compute mean color, variance, and dominant gradient direction
  (vertical, horizontal, diagonal/mixed)

#### 4b. Strategy Scoring
Evaluate all candidate strategies — score each as sum of per-logical-pixel
perceptual distance (Oklab) between rendered result and source:

**Solid candidates**: `█` and ` `
- Brute-force all 16 FG options (for `█`) and 8 BG options (for ` `)
- Score = sum of distances from all 4 logical pixels to the single rendered color

**Vertical split candidates**: `▀`, `▄`
- For each of 128 FG×BG combos: top 2px = one color, bottom 2px = other
- Both orientations evaluated; best wins

**Horizontal split candidates**: `▌`, `▐`
- For each of 128 FG×BG combos: left 2px = one color, right 2px = other
- Both orientations evaluated; best wins

**Shade candidates**: `░`, `▒`, `▓`
- For each of 128 FG×BG combos: all 4px = lerp(BG, FG, coverage)
  where coverage = 0.25 / 0.50 / 0.75
- Score = sum of distances from all 4 logical pixels to the blended color

#### 4c. Strategy Selection
Apply adjusted scoring with knob-driven penalties:

```
adjusted_score_shade  = raw_score_shade  + (cell_variance × shade_bias_weight)
adjusted_score_vsplit = raw_score_vsplit + (horizontal_gradient_strength × split_direction_penalty)
adjusted_score_hsplit = raw_score_hsplit + (vertical_gradient_strength × split_direction_penalty)
adjusted_score_solid  = raw_score_solid
```

Pick the strategy+character+FG+BG combination with lowest adjusted score.

When edge enhancement is active: cells on detected edges are penalized toward
higher FG/BG contrast pairs (Sobel pre-pass on source image).

#### 4d. Error Diffusion
- Compute residual error (source - rendered) in Oklab per logical pixel
- For split characters: propagate per-half error to spatially appropriate neighbors
  (top-half error → upward and lateral neighbors; bottom-half → downward and lateral)
- For shade/solid: propagate single blended error uniformly
- Kernel: Floyd-Steinberg by default; optionally Jarvis-Judice-Ninke
  (JJN preferred in red/orange/brown regions when Faithful→PixelArt >= 3)

### Stage 5 — Output Encoding
- Emit ANSI escape sequences: `ESC[{attr};3{fg};4{bg}m{char}`
- Run-length optimize: suppress redundant attribute changes between adjacent cells
- Emit cursor reset and clear before frame
- Flush complete frame atomically to avoid tearing

---

## Aspect Ratio & Letterbox/Pillarbox

- CP437 cell aspect ratio: 8px wide × 16px tall = 1:2
- Terminal canvas: 80×24 cells = 640×384 effective pixels
- Source image is scaled to fit within 640×384 maintaining aspect ratio
- Unfilled regions are filled with:
  - **Fill color**: user-selectable from CGA 8 background colors (cycles through all 8)
  - **Fill character**: user-selectable from { space, `█`, `░`, `▒`, `▓` }
  - Fill is rendered as solid cells with fill character as both FG and BG effectively

---

## Zoom & Pan

- **Zoom levels**: stepped or continuous float ≥ 1.0
  - At 1.0: entire source image mapped to viewport
  - At 2.0: quarter of source image fills viewport at 2× detail
  - At 4.0: one sixteenth of source image at 4× detail
- **Pan**: X and Y offset into source image, clamped to valid range for current zoom
- Pan step size scales with zoom level (larger steps when zoomed out)
- Every zoom/pan change triggers immediate re-render

---

## Interactive Controls

All controls trigger immediate re-render. No separate render key needed.

### Viewport Navigation
| Key         | Action |
|-------------|--------|
| Arrow Up / Numpad 8    | Pan up |
| Arrow Down / Numpad 2  | Pan down |
| Arrow Left / Numpad 4  | Pan left |
| Arrow Right / Numpad 6 | Pan right |
| Numpad + / =           | Zoom in |
| Numpad - / -           | Zoom out |
| Numpad 5 / Home        | Reset viewport (zoom=1, pan=center) |

### Color Pre-processing
| Key  | Action |
|------|--------|
| O    | Contrast down |
| P    | Contrast up |
| K    | Saturation down |
| L    | Saturation up |
| ,    | Brightness down |
| .    | Brightness up |
| [    | Color temperature cooler |
| ]    | Color temperature warmer |

### Conversion Quality
| Key  | Action |
|------|--------|
| E    | Dither strength down |
| R    | Dither strength up |
| Z    | Shade bias down (more splits / blocky) |
| X    | Shade bias up (more shades / smooth) |
| N    | Edge enhancement down |
| M    | Edge enhancement up |
| F    | Faithful→PixelArt step down |
| G    | Faithful→PixelArt step up |

### Letterbox / Pillarbox
| Key  | Action |
|------|--------|
| V    | Cycle fill color (cycles through 8 CGA BG colors) |
| B    | Cycle fill character (space → █ → ░ → ▒ → ▓ → space) |

### Presets
| Key  | Action |
|------|--------|
| Tab  | Cycle through named presets |

### Application
| Key      | Action |
|----------|--------|
| S        | Save current frame to .ANS file (prompts for filename) |
| Q        | Quit |
| H        | Display full help screen (all key bindings) |
| ?  or /  | Display current knob values overlay (HUD) |

---

## Knob Definitions & Ranges

| Knob | Range | Default | Step | Notes |
|------|-------|---------|------|-------|
| Contrast | 0.0–2.0 | 1.0 | 0.1 | Applied to source before conversion |
| Saturation | 0.0–2.0 | 1.1 | 0.1 | Slight boost default helps CGA mapping |
| Brightness | -0.5–0.5 | 0.0 | 0.05 | |
| Color Temperature | -1.0–1.0 | 0.0 | 0.1 | Negative=cool, positive=warm |
| Dither Strength | 0.0–1.0 | 0.75 | 0.05 | Error diffusion propagation weight |
| Shade Bias | 0.0–1.0 | 0.5 | 0.1 | 0=prefer splits, 1=prefer shades |
| Edge Enhancement | 0.0–1.0 | 0.2 | 0.1 | |
| Faithful→PixelArt | 1–5 | 2 | 1 step | See mode table below |
| Zoom | 1.0–8.0 | 1.0 | 0.25 | |
| Pan X | 0–100% | 50% | varies | Relative to source image |
| Pan Y | 0–100% | 50% | varies | |
| Fill Color | 0–7 | 0 (Black) | cycle | CGA background colors |
| Fill Character | 5 options | Space | cycle | space/█/░/▒/▓ |

---

## Faithful → Pixel Art Mode Steps

| Level | Name | Behavior |
|-------|------|----------|
| 1 | Faithful | Pure Oklab nearest-color + full error diffusion. No artistic processing. |
| 2 | Naturalistic | Mild edge contrast boost. Hue-preserving tiebreak in reds. JJN in warm regions. |
| 3 | Interpreted | Edge enhancement active. Structured dither in gradient regions. Shade chars used for AA. |
| 4 | Stylized | Region coherence pass. Sub-representable detail smoothed. Strong edge contrast. |
| 5 | Pixel Art | Full region coherence. Structured dither only. Maximum edge preservation. Intentional simplification of fine detail. |

---

## Color Accuracy: Red Region Handling

The CGA red cluster (`#AA0000`, `#FF5555`, `#AA5500`) is handled with special care:

- All color matching uses Oklab distance, not RGB Euclidean — this correctly separates
  dark red, bright red, and brown in perceptual space
- When selecting between candidates within the red/orange/brown hue range, apply a
  hue-angle preserving tiebreak: prefer the candidate that minimizes hue shift over
  one that minimizes total Oklab distance but changes hue significantly
- At Faithful→PixelArt level ≥ 2: use JJN diffusion kernel instead of Floyd-Steinberg
  in cells whose dominant hue falls in the red-orange-brown range (hue angle 0°–50° and 330°–360°)
  to spread red errors more gracefully

---

## Named Presets

| Name | F→PA | Contrast | Saturation | Dither | Shade Bias | Edge Enh. |
|------|------|----------|------------|--------|------------|-----------|
| Photo | 1 | 1.1 | 1.2 | 0.85 | 0.5 | 0.1 |
| Graphic | 3 | 1.2 | 1.4 | 0.6 | 0.3 | 0.6 |
| Portrait | 2 | 1.0 | 1.1 | 0.75 | 0.6 | 0.2 |
| Line Art | 4 | 1.3 | 1.0 | 0.4 | 0.2 | 0.9 |
| Pixel Art | 5 | 1.1 | 1.3 | 0.5 | 0.4 | 0.7 |

---

## Status / HUD Overlay

Triggered by `?` or `/`. Displays current knob values in a compact overlay
rendered as ANSI text within the terminal frame. Dismissed by same key or any
navigation key.

Example layout (rendered top-right corner):
```
┌─ IMG2ANS ──────────────────┐
│ Preset : Photo              │
│ F→PA   : 2 Naturalistic     │
│ Contrast: 1.1  Bright: 0.0  │
│ Sat    : 1.2   Temp  : 0.0  │
│ Dither : 0.85  Shade : 0.5  │
│ Edge   : 0.1   Zoom  : 1.0  │
│ Fill   : Black / Space      │
│ Pan    : 50% / 50%          │
└─────────────────────────────┘
```

---

## Save Format

`S` prompts the user to enter a filename (using `terminal.readLine()`), then saves
the current rendered frame as a `.ANS` file to local disk.

- Filename: user-supplied base name + `.ans` extension auto-appended if not present
- Saved to: `games/img2ansi/output/` directory (created on first save if absent)
- Content: raw ANSI escape sequences exactly as emitted to terminal for the current frame
- Includes SAUCE record header (standard ANS metadata):
  - Width: 80, Height: 24
  - Title: user-supplied filename
  - Author, Group fields: blank (or pulled from synthdoor username)
  - ANSiFlags byte reflecting rendering info

### Future Save Extensions (not yet implemented)

Two directions are planned for a future release — implement only one:

**Option A — YMODEM transfer**: Initiate a YMODEM-G or YMODEM batch transfer of the
saved `.ANS` file directly over the telnet/rlogin connection, allowing BBS clients
with YMODEM receive support (SyncTERM, NetRunner, etc.) to download the file.

**Option B — HTTP download via public directory**: Copy the saved `.ANS` file into
the SynthDoor server's existing static public web directory (the same path used by
the WebSocket/HTTP transport for browser delivery), then display a download URL to
the user in the terminal. The URL would be derived from the server's configured
hostname/port + public path. No additional server infrastructure required.

---

## Engine Integration Notes

- Language: Node.js (same runtime as all SynthDoor games)
- Game lives at `games/img2ansi/src/index.js`, extends `GameBase`
- `screen.setMode(Screen.FIXED)` — full 80×24 framebuffer, flush() diffs only dirty cells
- `screen.putChar(col, row, ch, fg, bg)` is the sole output primitive per cell
- `screen.flush()` called once per render — never per cell
- `screen.statusBar(text, fg, bg)` for the persistent key hint line (row 25)
- Arrow keys and numpad 2/4/6/8 arrive as `UP`/`DOWN`/`LEFT`/`RIGHT` action events automatically
- Character keys arrive via `terminal.on('key', handler)`
- Two separate named listeners per screen: `onAction` for directions, `onKey` for chars
- Always `removeListener` both handlers when leaving a screen or overlay
- `terminal.readLine()` used for filename prompt in Save flow
- `Utils.fetchText(url)` / raw `fetch(url).arrayBuffer()` for image loading
- `dirty` flag pattern: any knob change sets `dirty = true`; render loop checks and resets
- Terminal raw mode, cursor hide, and screen setup handled by engine (`setMode(FIXED)`)
- No frame buffering needed beyond what `screen.flush()` provides
- SAUCE record written manually as binary trailer appended to .ANS file output

**Key binding conflicts resolved at init:**
- `this.input.unbind('H')` and `this.input.unbind('h')` — default was LEFT (vim); we use H for Help
- `this.input.unbind('S')` and `this.input.unbind('s')` — default was DOWN (WASD); we use S for Save
- `Q` / `q` → QUIT action — correct, leave as-is
- `w` / `W` → UP (WASD) — leave; arrows and numpad handle pan, no conflict

---

## Implementation Language & Dependencies

- **Runtime**: Node.js (SynthDoor engine)
- **Image loading**: Jimp (pure JS, no native deps) — `npm install jimp` at synthdoor root
- **HTTP image fetch**: raw `fetch(url, { signal: AbortSignal.timeout(8000) })` + `.arrayBuffer()`
- **Oklab conversion**: implemented as pure math helpers in-file (no external dep needed)
- **ANSI output**: `screen.putChar()` + `screen.flush()` — no manual escape construction
- **File I/O**: Node.js built-in `fs` module for saving .ANS to disk
- **CP437 characters**: referenced via `CP437.*` engine constants and Unicode equivalents

---

## Application Flow

```
start
  │
  ▼
Splash screen (Draw.ansiArt from configurable .ANS file constant)
  │  any key
  ▼
URL entry screen  ← ─────────────────────────────────────┐
  │  user enters image URL                                │
  ▼                                                       │
Load & convert image → show at default settings          │
  │                                                       │
  ▼                                                       │
Interactive tuning loop (knobs, pan, zoom, live re-render)│
  │  Q pressed                                            │
  ▼                                                       │
"Convert another image? (Y/N)"  ──── Y ─────────────────┘
  │  N
  ▼
Clean exit (scroll mode, show cursor, reset attrs)
```

- Splash screen ANS file path stored as a top-of-file constant `SPLASH_ANS_PATH`
- If splash file is missing, fall back gracefully to a plain text title screen
- URL entry uses `terminal.readLine()` with a clearly drawn input box
- "Convert another?" prompt uses `terminal.askYesNo()` or manual Y/N key handler
- On N: `screen.setMode(Screen.SCROLL)`, print farewell line, exit `run()`

---

## Input Format Support

| Format | Support | Dependency |
|--------|---------|------------|
| JPEG   | ✅ Full | Jimp (bundled) |
| PNG    | ✅ Full | Jimp (bundled) — alpha composited against fill color |
| GIF    | ✅ First frame only | Jimp (bundled) — animated GIFs use frame 1, documented behavior |
| TIFF   | ✅ Full | Jimp (bundled) |
| BMP    | ✅ Full | Jimp (bundled) |
| WebP   | ❌ Not yet | Planned future addition via Sharp or @jsquash/webp |
| AVIF/HEIC | ❌ Not yet | Planned future addition via Sharp |

### Transparency Handling
PNG and GIF alpha channels are composited against the current letterbox/pillarbox
fill color before Oklab conversion. Formula per pixel:
```
r = alpha * pixel.r + (1 - alpha) * fillColor.r
g = alpha * pixel.g + (1 - alpha) * fillColor.g
b = alpha * pixel.b + (1 - alpha) * fillColor.b
```
Ensures transparent regions map cleanly to the fill color rather than corrupting
the color distance calculations.

---

## Code Structure (top of file)

Following Meteoroid/Triangulum conventions, constants appear in clearly sectioned
blocks before the class definition:

```
// TIMING
// LAYOUT  
// CGA PALETTE (hex values + Oklab pre-computed)
// KNOB DEFAULTS & RANGES
// KNOB STEP SIZES
// FILL CHARACTER CYCLE
// PRESET DEFINITIONS
// BLOCK CHARACTER STRATEGIES
// MATH HELPERS (Oklab, clamp, lerp, sleep)
// class Img2Ansi extends GameBase
//   run()
//   _urlEntryScreen()
//   _mainLoop()
//   _handleKey() / _handleAction()
//   _render()              ← triggers conversion + screen.flush()
//   _convert()             ← full pipeline: load→preprocess→oklab→cells→diffuse
//   _evaluateCell()        ← per-cell strategy scoring
//   _drawHud()             ← ? overlay
//   _drawHelp()            ← H screen
//   _saveAnsi()            ← S save flow
//   _drawStatusBar()       ← persistent row 25 key hints
//   Math helpers inline
```
