# SynthDoor Terminal Emulator

A browser-based, canvas-rendered terminal emulator for connecting to DOS-era BBS and text-game servers over WebSocket. Designed to work directly with the SynthDoor Node.js backend (`websocket.js`), but compatible with any server that speaks Telnet-over-WebSocket and emits CP437/ANSI data.

---

## Quick Start

Copy all files in this directory into the `web/public/` folder that `websocket.js` serves statically. Navigate to `http://localhost:8080` (or whatever port the server is configured on), click **CONNECT**, and enter the WebSocket URL.

All files are plain ES modules — no build step, no bundler, no npm.

---

## File Overview

| File | Role |
|---|---|
| `index.html` | HTML shell, DOM structure, module entry point |
| `style.css` | All visual styling |
| `app.js` | Application controller — wires everything together |
| `terminal.js` | Terminal state, ANSI parser, Telnet filter, screen buffer |
| `renderer.js` | Canvas drawing engine |
| `font.js` | IBM VGA ROM font bitmap data and sprite-sheet builder |
| `connection.js` | WebSocket transport with sub-protocol negotiation |
| `music.js` | ANSI music parser and Web Audio playback |

---

## Mouse & Scrollwheel Navigation

SynthDoor features a highly interactive terminal canvas designed to make navigating modern BBSes and terminal applications intuitive without requiring a keyboard. 

### Clicking & Interacting
* **Smart URL Detection:** Single-clicking any detected URL in the terminal will safely open it in a new browser tab.
* **Menu Quick-Select (Lone Alphanumeric):** Single-clicking a "lone" alphanumeric character (a letter or number surrounded by spaces/borders, typical of BBS menus) will automatically type that character to the server. 
  * *Double-Tap to Enter:* If you click the same lone character a second time without moving your mouse off it, the terminal will send an `Enter` keystroke instead.
* **Quick Enter:** Clicking anywhere else on the terminal canvas (empty space or non-interactive text) will send an `Enter` keystroke to the server.
* **Summon Keyboard (Mobile/Touch):** Tapping or double-clicking the terminal canvas focuses a hidden input field, forcing mobile devices to display their on-screen keyboard.

### Selecting, Copying & Pasting
* **Auto-Copy:** Click and drag across the terminal to highlight text. When you release the mouse button, the selected text is automatically copied to your system clipboard.
* **Quick Paste:** Right-clicking anywhere on the terminal canvas reads your system clipboard and pastes the contents directly to the server.

### Scrolling & History
* **Scrollback Buffer:** If terminal output has scrolled off the screen, using your mouse wheel will smoothly scroll up and down through the local history. A temporary indicator will appear in the corner showing how many lines back you are. 
* **Arrow Key Emulation:** If you are at the bottom of the screen (in "live view") with no scrollback active, scrolling the mouse wheel up or down will send `Up Arrow` and `Down Arrow` keystrokes to the server. This is highly useful for navigating server-side menus or message readers. *(Note: This is automatically throttled to prevent flooding the server with keystrokes).*
* **Scrollbar:** You can click and drag the scrollbar thumb on the right side of the screen, or click the scrollbar track to jump to a specific point in the history.
* **Touch Swiping:** On mobile/touch devices, swiping up and down on the canvas will smoothly navigate the scrollback buffer.

## Architecture

Data flows in one direction through a pipeline, with user input flowing the other way:

```
WebSocket frame
      │
      ▼
 WSConnection          ← decodes binary / base64 / plain frames into Uint8Array
      │
      ▼
 TelnetFilter          ← strips IAC negotiation bytes; responds to DO/WILL
      │
      ▼
 ANSIParser            ← state machine; interprets escape sequences
      │
      ▼
 Terminal              ← owns the screen buffer; executes cursor/erase/scroll ops
      │
      ▼
 Renderer              ← reads Terminal cells; blits glyphs to <canvas>
      │
      ▼
  <canvas>             ← visible to the user
```

User input flows in reverse: keyboard/touch events in `app.js` → `WSConnection.sendString()` → WebSocket frame to server.

---

## File-by-File Details

### `index.html`

The DOM skeleton. Defines:

- `#titlebar` — connection status, server label, and toolbar buttons (CONNECT, DISCONNECT, iCE toggle, music toggle).
- `#terminal-area` — flex row containing `#canvas-wrap` (the terminal canvas and scrollback indicator) and `#scrollbar` (the scroll position indicator on the right edge).
- `#mobile-toolbar` — row of buttons for ESC, TAB, CTRL, arrow keys, function keys, etc. Shown only on narrow/touch screens via CSS media query.
- `#hidden-input` — a `position: fixed; top: -9999px` text input. Receiving focus causes mobile OSes to raise the virtual keyboard. Keydown and `input` events are forwarded to the WebSocket as terminal input.
- `#conn-modal` — the connection dialog (URL field, terminal size selector).

The module entry point is a single inline `<script type="module">` that imports and instantiates `App` from `app.js`. No other scripts.

---

### `style.css`

Pure CSS with no preprocessor. Uses CSS custom properties (`--bg`, `--chrome`, `--border`, `--accent`, `--accent2`, `--sb-w`, etc.) defined on `:root` for easy theming.

Key layout decisions:

- `#app` is a column flex container filling the viewport. `#terminal-area` takes `flex: 1` and `min-height: 0` so it can shrink without overflowing.
- `#terminal-area` is a row flex container. `#canvas-wrap` takes `flex: 1`; `#scrollbar` has a fixed width of `--sb-w` (12 px).
- `#terminal-canvas` uses `image-rendering: pixelated` to prevent sub-pixel smoothing when the canvas is scaled up by CSS.
- The scrollbar thumb transitions color on hover/active to give clear drag feedback. The entire scrollbar fades to 25% opacity when no scrollback exists (`.active` class toggled by JS).
- `@media (max-width: 900px), (pointer: coarse)` reveals `#mobile-toolbar`.

---

### `app.js` — `class App`

The top-level controller. Instantiated once on `DOMContentLoaded`. Owns no terminal logic itself; its job is wiring and event handling.

**Initialization (`_init`):**
Calls `renderer.init()` (async — waits for the font sheet to build), then binds all event listeners, scales the canvas, starts the render/blink loops, and shows the connection modal.

**Data pipeline wiring:**
```js
conn.onData   = (bytes) => telnet.process(bytes)
telnet.onData = (bytes) => { parser.feed(bytes); term.scanURLs(); dirty = true; }
telnet.onSend = (bytes) => conn.sendBytes(bytes)     // Telnet WILL/WONT responses
term.onSend   = (str)   => conn.sendString(str)      // DSR cursor position reports
term.onANSIMusic = (str) => music.play(str)
```

**Render loop (`_startLoops`):**
A `requestAnimationFrame` loop calls `renderer.drawFrame()` whenever `_dirty` is set. A 530 ms `setInterval` toggles `_cursorOn` and `_blinkPhase` to drive cursor blink and text blink simultaneously.

**Canvas scaling (`_scaleCanvas`):**
Computes the largest integer-ish scale factor that fits the terminal grid inside `#canvas-wrap` (capped at 2×), then sets the canvas's CSS `width`/`height` accordingly. The canvas's pixel dimensions (`canvas.width`, `canvas.height`) remain fixed at `cols × CHAR_W` by `rows × CHAR_H` — scaling is purely presentational via CSS.

**Mouse handling (`_bindCanvas`):**
- `mousedown` / `mousemove` / `mouseup`: implements drag selection. Normalises `clientX/Y` to `[col, row]` via `_pixelToCell`, which divides by `CHAR_W * scale` and `CHAR_H * scale`.
- Selection text is written to the clipboard on `mouseup` via `navigator.clipboard.writeText`.
- `contextmenu` (right-click): reads from `navigator.clipboard.readText` and sends the text over the WebSocket as a paste.
- `wheel`: calls `term.scrollbackUp/Down`, invalidates the renderer, and shows the scrollback indicator.
- `click`: checks `term.getURLAt(col, row)` and opens URLs in a new tab.

**Keyboard handling (`_handleKeydown`, `_keyToSequence`):**
Maps `KeyboardEvent.key` strings to the correct ANSI escape sequences (VT100/xterm convention). Ctrl+letter combinations produce control characters (charCode − 64). Any keypress while scrolled back snaps the view to live.

**Scrollbar (`_bindScrollbar`, `_updateScrollbarThumb`):**
The thumb's `top` and `height` are recalculated every animation frame from `term.scrollbackLength` and `term._scrollOffset`. Track clicks jump the scroll position; thumb drag uses a `_sbDragStartOffset` reference value to compute delta-lines from mouse delta-pixels, both mouse and touch.

**Mobile CTRL latch (`_ctrlMode`):**
The CTRL toolbar button toggles `_ctrlMode`. The next printable character sent is converted to a control character (e.g. CTRL+C → `\x03`) before being cleared.

---

### `terminal.js` — four exported classes

#### `CP437` (array constant)

A 256-entry array mapping CP437 byte values (0–255) to their Unicode equivalents. Used only for copy/paste (`getSelectionText`) and URL scanning — never for rendering, which works directly on byte values.

#### `class Cell`

One character cell on the screen. Properties:

| Property | Type | Meaning |
|---|---|---|
| `ch` | 0–255 | CP437 glyph byte |
| `fg` | 0–15 | Foreground palette index |
| `bg` | 0–15 | Background palette index |
| `bold` | bool | SGR bold (maps fg 0–7 → 8–15 at render time) |
| `blink` | bool | SGR blink (hides glyph on blink-off phase, or unused in iCE mode) |
| `dirty` | bool | Set whenever content changes; cleared by renderer after drawing |

`Cell.set()` does a change-check before writing and sets `dirty` only when something actually changed, avoiding unnecessary redraws.

#### `class ScreenBuffer`

A flat `Cell[]` array of length `cols × rows`. Provides `get(col, row)`, `clearAll()`, `markAllDirty()`, and `snapshotRow(row)` (used to save lines into the scrollback buffer before they scroll off the top).

#### `class TelnetFilter`

A five-state machine (`DATA`, `IAC`, `CMD`, `SB`, `SB_IAC`) that processes raw WebSocket bytes and strips Telnet IAC negotiation sequences before the ANSI parser sees them.

- Responds to `DO NAWS` (0xFD 0x1F) with `WILL NAWS` (0xFB 0x1F) — the server uses this to know a terminal is connected.
- Responds to other `DO <opt>` with `WONT <opt>` and to `WILL <opt>` with `DONT <opt>`, politely declining all other options.
- Emits filtered data bytes via `onData` callback and Telnet responses via `onSend` callback.

#### `class ANSIParser`

A four-state machine (`NORMAL`, `ESC`, `CSI`, `MUSIC`) that interprets ANSI/VT100 escape sequences and calls methods on a `Terminal` instance.

**States:**

- `NORMAL` — bytes are either C0 control codes (tab, LF, CR, BS, BEL) or CP437 printable characters forwarded to `terminal.putChar()`.
- `ESC` — saw `0x1B`. Next byte selects a two-character sequence: `[` enters CSI, `7`/`8` save/restore cursor, `M` reverse index, `c` full reset, etc.
- `CSI` — accumulates parameter bytes (`0x30`–`0x3F`) and intermediate bytes (`0x20`–`0x2F`) until a final byte (`0x40`–`0x7E`) arrives. The final byte is dispatched via `_dispatchCSI`.
- `MUSIC` — entered when `ESC [ M` arrives with no parameters. Accumulates bytes into a music string until a terminator (`0x0E`, `0x1E`, NUL, or BEL) arrives, then calls `terminal.onANSIMusic`.

**ANSI music state-change protocol:** `_dispatchCSI` returns `true` when it changes the parser state (to `MUSIC`), so the caller knows not to reset it to `NORMAL`. This is the fix for the bug where music sequences were previously printed as literal characters.

**Supported CSI sequences:** CUU/D/F/B (cursor move), CHA, CUP/HVP (cursor position), ED/EL (erase), IL/DL/ICH/DCH (insert/delete), SU/SD (scroll), SGR (attributes), DECSTBM (scroll region), DSR (device status), SM/RM (mode set/reset including DECTCEM cursor visibility and IRM insert mode).

#### `class Terminal`

Owns and mutates the `ScreenBuffer`. Implements all the operations called by `ANSIParser` plus scrollback management, URL scanning, and copy text extraction.

**Cursor and wrap:** The `_wrapPending` flag implements the standard "deferred wrap" behaviour — reaching column 79 sets the flag rather than immediately advancing to column 0, row+1. The wrap happens on the *next* `putChar`, so writing exactly 80 characters to a line does not add a spurious blank line.

**Scroll region:** `_scrollTop` and `_scrollBottom` (set by DECSTBM `ESC [ r`) constrain scrolling to a sub-region of the screen. `_doScrollUp` pushes the top line of the scroll region into the scrollback buffer only when `_scrollTop === 0` (the full viewport is scrolling), preventing partial-screen scroll regions from polluting the scrollback.

**Scrollback:** `_scrollback` is a `Cell`-snapshot array (max 2000 rows). `_scrollOffset` tracks how many lines back from live the view is. `getDisplayCells()` returns either the live `screen.cells` array directly (when `_scrollOffset === 0`) or synthesises a flat array from the appropriate scrollback slice plus live rows, so the renderer always receives the same shape of data regardless of scroll state.

**URL scanning (`scanURLs`):** Iterates every row of the live screen, converts bytes to Unicode via the `CP437` table, and runs a `/https?:\/\/[^\s\x00-\x1F\x7F]*/g` regex. Results are stored in `_urls` as `{row, col, len, url}` objects. Called after every data batch and used by `app.js` for hover cursor and click-to-open.

**iCE colours:** The `iceColors` flag is passed from `app.js` to the renderer at draw time. It has no effect on the stored cell data — both modes store the full `fg`/`bg`/`blink` values; the renderer interprets them differently depending on the flag.

---

### `renderer.js` — `class Renderer`

Draws the terminal to an HTML5 `<canvas>`. The canvas pixel dimensions are always exactly `cols × CHAR_W` by `rows × CHAR_H`; CSS `width`/`height` scale it for display.

**Font sheet cache (`_tintedSheets`):**
There are at most 16 × 16 = 256 possible foreground/background colour combinations. For each combination encountered, a dedicated `OffscreenCanvas` is built and cached under an 8-bit key `(fg << 4) | bg`. Each sheet is `256 × CHAR_W` pixels wide and `CHAR_H` pixels tall — all 256 glyphs side by side, pre-tinted in the target fg/bg colours.

**Tinting pipeline (`_buildSheet`):**
1. Create a canvas filled with `bgColor`.
2. Create a second canvas filled with `fgColor`, then use `globalCompositeOperation = 'destination-in'` to draw the white-on-transparent master font sheet onto it. `destination-in` multiplies destination alpha by source alpha, so only pixels where the glyph bitmap is opaque survive — now coloured in `fgColor`.
3. Composite the fg-masked canvas over the bg canvas with `source-over`. Result: every glyph in the sheet has correct bg-coloured background and fg-coloured pixel strokes.

Drawing a cell is then a single `ctx.drawImage(tintedSheet, ch * CHAR_W, 0, CHAR_W, CHAR_H, x, y, CHAR_W, CHAR_H)` call.

**Dirty-cell cache (`_lastDrawn`):**
A packed `Int32Array` of length `cols × rows`. Each entry stores `ch | (fg << 8) | (bg << 12)` for the cell as last drawn. A cell is skipped if its packed value matches and neither `cell.dirty` nor the force-redraw flag is set.

**Artifact-free cursor and selection:**
The `_prevCursorCol/Row` fields track where the cursor was drawn last frame. At the start of every frame, both the old cursor position and the new cursor position are added to a `Uint8Array force` bitset, as are all cells within the current selection region. Cells in the force set are always redrawn from clean data before the cursor overlay or selection overlay is applied. This prevents the inverted cursor pixels and the semi-transparent selection highlight from accumulating across frames.

**Three-phase draw order per frame:**
1. Dirty-or-forced cell pass (draws all 80×25 cells that need updating, including cursor/selection cells).
2. Cursor draw (inverts fg/bg of the cursor cell and blits it on top).
3. Selection overlay (a single semi-transparent `fillRect` or trio of rects drawn with `source-over` on top of the freshly-drawn cells).

---

### `font.js`

**`VGA_FONT_8x16` (Uint8Array, 4096 bytes):**
The IBM VGA BIOS ROM font, encoded as 256 glyphs × 16 bytes. Each byte is one row of 8 pixels; bit 7 is the leftmost pixel. This is the public-domain transcription of the actual PC BIOS font. All 256 CP437 code points are represented, including the full set of box-drawing and block-graphics characters.

**`buildFontSheet(CHAR_W, CHAR_H)` → `OffscreenCanvas`:**
Renders all 256 glyphs side by side onto a single `OffscreenCanvas` (`256 × 8 = 2048` px wide, `16` px tall) using `putImageData` for pixel-exact placement. Each lit pixel is written as `RGBA(255, 255, 255, 255)`; dark pixels remain `(0, 0, 0, 0)` (fully transparent). This white-on-transparent sheet is the input to `renderer.js`'s tinting pipeline. It is built once during `renderer.init()` and never redrawn.

### 1. The Historical Problem: 8-dot vs. 9-dot VGA hardware
The original IBM VGA text mode resolution was 720x400, resulting in a character cell that was **9 pixels wide** by 16 pixels high. However, to save ROM space, the actual font stored in the BIOS was only **8 pixels wide**. 

To fill that missing 9th pixel column, the VGA hardware would normally just pad a blank column. But for characters in the `0xC0` to `0xDF` range (the box-drawing characters), the hardware intercepted the signal and **duplicated the 8th pixel column into the 9th column**.

Because the original font was designed knowing it would be stretched to 9 pixels, the lines inside the 8x16 ROM are completely asymmetrical. When modern canvases or emulators render this font purely as an 8x16 image without that 9th-pixel hardware stretch, the center points don't line up, lines look uneven, and corners miss each other by exactly 1 pixel.

### 2. Strategy Phase 1: Establishing Perfect Symmetry
In an 8-pixel wide grid, **there is no true center pixel** (columns are 0 through 7, so the exact center is the line between column 3 and 4). 

If you draw a 1-pixel wide line in column 3, it's slightly to the left. If you draw it in column 4, it's slightly to the right. Therefore, to make perfectly intersecting geometric lines, **single lines must be exactly 2 pixels wide**.

I mapped the entire box-drawing system to these strict boundaries:

**Vertical Placement (X-axis):**
*   **Single Vertical (`0x18`):** `0001 1000` (Columns 3 & 4)
*   **Double Vertical (`0x66`):** `0110 0110` (Cols 1,2 and Cols 5,6. The gap is exactly Cols 3,4).

**Horizontal Placement (Y-axis):**
*   **Single Horizontal:** Rows 7 & 8 (The exact middle of 0-15)
*   **Double Horizontal:** Rows 5,6 (Top) and Rows 9,10 (Bottom). The gap is exactly Rows 7,8.

*Notice the magic here:* The 2-pixel single line fits **exactly** inside the 2-pixel gap of the double line. 

### 3. Strategy Phase 2: Fixing the "Bleeding" Corners
In standard fonts, if you just draw a horizontal line and a vertical line until they hit the center, they overlap. On single lines, this is fine. On double lines, this results in the lines "spiking" into the hollow interior of the corner.

To fix the double corners, I applied a strict **Bounding Box Rule**: A line must completely stop at the outer boundary of its perpendicular neighbor.
*   If a double vertical line hits a top corner, it stops exactly at Row 6. 
*   If a double horizontal line hits that same corner, it stops exactly at Col 2.
*   The corner itself is left completely empty (`0x00`), resulting in a perfect, continuous hollow square joint.

### 4. Strategy Phase 3: The Masking Rule for Intersections
This was the final piece of the puzzle (and what caused the bug in the previous iteration). 

When a **Single Line** intersects a **Double Line** (e.g., `╫` or `╪`), who "wins" the empty space in the middle of the intersection? If you just draw the single line all the way through, it places a solid block right in the middle of the double line's hollow core.

The strategy here is **"Hollow Core Precedence."** To make it look like a physical pipe crossing another pipe, the double line's empty core must never be drawn over. I used bitwise masks to "punch out" the center of the single lines.

**Example 1: Single Horizontal crossing Double Vertical (`╫` 0xD7)**
*   The Double Vertical lines live at `0x66` (`01100110`), leaving cols 3 and 4 empty.
*   The Single Horizontal line normally draws a solid `0xFF` (`11111111`) across rows 7 and 8.
*   **The Fix:** I changed rows 7 and 8 from `0xFF` to `0xE7`.
*   Binary `0xE7` is `1110 0111`. 
*   By setting columns 3 and 4 to `0`, the horizontal line halts exactly at the double line's outer wall, leaving the vertical hollow gap perfectly unbroken.

**Example 2: Single Vertical crossing Double Horizontal (`╪` 0xD8)**
*   The Double Horizontal gaps live at rows 7 and 8.
*   The Single Vertical normally writes `0x18` (`00011000`) all the way down the glyph.
*   **The Fix:** On rows 7 and 8, instead of drawing the vertical line, I set the bytes to `0x00`. 
*   This cuts a 2-pixel gap straight through the vertical line, allowing the horizontal double-line's hollow core to flow left-to-right entirely uninterrupted.

By abandoning the original, distorted IBM bytes and completely recalculating the hex codes based on these strict X/Y alignments and intersection masks, the font now renders geometrically perfect UI boxes regardless of scaling or composition.

---

### `connection.js` — `class WSConnection`

Manages one WebSocket connection at a time. Accepts `onData` and `onStatus` callbacks at construction.

**Sub-protocol negotiation:**
The WebSocket is opened with `['binary', 'base64', 'plain']` as the requested sub-protocols. The server (`websocket.js`) selects `binary` if supported, then `base64`, then `plain`. The negotiated protocol is read from `ws.protocol` on `open` and used for all subsequent encode/decode operations.

**Encoding (critical detail):**
CP437 bytes `0x80`–`0xFF` must never pass through `TextEncoder` (UTF-8), which would expand them into two-byte sequences. The three protocols handle this as follows:

| Protocol | Outgoing | Incoming |
|---|---|---|
| `binary` | Send raw `ArrayBuffer` | Receive `ArrayBuffer`, wrap in `Uint8Array` |
| `base64` | `btoa(latin1-string)` | `atob(string)`, extract char codes |
| `plain` | Latin1 string (each char = one byte) | `TextDecoder('latin1')` or raw char codes |

`sendString(str)` converts a JS string to `Uint8Array` by taking `charCodeAt(i) & 0xFF` — correct for ANSI escape sequences where all bytes are below `0x80`, and for any case where a latin1 encoding is intended.

---

### `music.js` — `class ANSIMusic`

Parses ANSI music strings (the `ESC [ M ... <terminator>` sequence originating from IBM BASIC's `PLAY` command) and plays them via the Web Audio API.

**Syntax supported:**
- `T<n>` — tempo in BPM (32–255)
- `O<n>` — octave (0–6)
- `L<n>` — default note length (1=whole, 2=half, 4=quarter, 8=eighth, etc.)
- `A`–`G` — note names, with optional `#`/`+` (sharp) or `-` (flat) accidental, optional per-note length override, optional `.` for dotted duration
- `P` — rest, with optional length and dot
- `MN`/`ML`/`MS` — normal (87.5% duty), legato (100%), staccato (50%)
- `>`/`<` — octave up/down

**Playback:** Notes are scheduled ahead of time onto the Web Audio `AudioContext` clock using `OscillatorNode` (square wave, matching the PC Speaker timbre) with a short linear-ramp amplitude envelope (3 ms attack, 5 ms decay). The `AudioContext` is created lazily on first `play()` call and resumed if the browser suspended it due to autoplay policy. A `setTimeout` clears the `_playing` flag after the last note finishes.

---

## Adding Features

**New ANSI sequences:** Add a `case 0xXX:` to `_dispatchCSI` in `terminal.js` and implement the corresponding method on `Terminal`.

**New colour modes:** The VGA palette is defined in `renderer.js` as `VGA_PALETTE`. The tinted-sheet cache is keyed on the 4-bit fg and bg indices, so adding a 256-colour mode would require either expanding the cache key or switching to a different rendering path for 256-colour cells.

**Font swap:** Replace `VGA_FONT_8x16` in `font.js` with any other 8×16 bitmap font using the same encoding (one byte per row, MSB = leftmost pixel). `CHAR_W` and `CHAR_H` are passed to `buildFontSheet` and exported from `renderer.js`, so changing the glyph size propagates automatically.

**Custom server URL default:** Change the `value` attribute on `#ws-url` in `index.html`.

**Terminal size presets:** Add `<option>` elements to `#term-size` in `index.html`. The `change` handler in `app.js` reads the `cols x rows` value string and calls `term.resize()` and `renderer.resize()`.

---

## Known Limitations

- ANSI music `N1`–`N84` (absolute MIDI note numbers) are recognised but not played; they are silently skipped.
- The 256-colour and 24-bit colour SGR modes (`38;5;n` / `48;5;n` and `38;2;r;g;b` / `48;2;r;g;b`) map to the nearest VGA 4-bit index rather than rendering the actual colour.
- Mouse reporting sequences (e.g. `ESC [ ? 1000 h`) are not sent to the server; mouse interaction is local-only (selection, URL click, scrollback).
- NAWS (window-size reporting) sends `WILL NAWS` during Telnet negotiation but does not send the actual `SB NAWS` subnegotiation frame with the current dimensions.
