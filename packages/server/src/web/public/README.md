# SynthDoor Terminal Emulator

A browser-based, canvas-rendered terminal emulator for connecting to SynthDoor BBS over WebSocket. Designed to work directly with the SynthDoor Node.js backend (`websocket.js`), but compatible with any server that speaks Telnet-over-WebSocket and emits CP437/ANSI data.

---

## Quick Start

Copy all files in this directory into the `web/public/` folder that `websocket.js` serves statically. Navigate to `http://localhost:8080` (or whatever port the server is configured on) and the terminal will connect automatically.

All files are plain ES modules — no build step, no bundler, no npm.

---

## File Overview

| File | Role |
|---|---|
| `index.html` | HTML shell, DOM structure, module entry point |
| `style.css` | All visual styling |
| `app.js` | Application controller — wires everything together |
| `terminal.js` | Terminal state, ANSI parser, Telnet filter, screen buffer |
| `sbansi-decoder.js` | Decodes the server's SBANSI binary opcode stream back to ANSI/CP437 |
| `renderer.js` | Canvas drawing engine |
| `font.js` | IBM VGA ROM font bitmap data and sprite-sheet builder |
| `connection.js` | WebSocket transport (binary frames) |
| `music.js` | ANSI music parser and Web Audio playback |

---

## Mouse & Scrollwheel Navigation

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
* **Arrow Key Emulation:** If you are at the bottom of the screen (in "live view") with no scrollback active, scrolling the mouse wheel up or down will send `Up Arrow` and `Down Arrow` keystrokes to the server. This is useful for navigating server-side menus or message readers. *(Note: This is throttled to prevent flooding the server with keystrokes.)*
* **Scrollbar:** You can click and drag the scrollbar thumb on the right side of the screen, or click the scrollbar track to jump to a specific point in the history.
* **Touch Swiping:** On mobile/touch devices, swiping up and down on the canvas will smoothly navigate the scrollback buffer.

---

## Architecture

Data flows in one direction through a pipeline, with user input flowing the other way:

```
WebSocket frame (binary)
      │
      ▼
 WSConnection          ← unwraps ArrayBuffer into Uint8Array
      │
      ▼
 SBANSIDecoder         ← reverses the server's SBANSI binary opcode
      │                  encoding, restoring the original ANSI/CP437
      │                  byte stream (including embedded Telnet IAC)
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

**Order matters: SBANSIDecoder must run before TelnetFilter.** The server-side
encoder escapes its own opcode-range bytes (`0x00`–`0x06`, `0x0E`–`0x16`, `0x1B`)
by prefixing them with `OP_LITERAL` (`0x00`), so an IAC sequence like
`IAC WILL ECHO` (`0xFF 0xFB 0x01`) becomes `0xFF 0xFB 0x00 0x01` on the wire.
A TelnetFilter that saw the wire bytes first would consume `0xFF 0xFB 0x00` as a
complete `IAC WILL <opt=0>` command and swallow the `0x00` that was actually
`OP_LITERAL`'s marker, desyncing the decoder. Decoding first restores the
original byte stream, after which TelnetFilter sees a well-formed IAC sequence
it can recognise.

---

## File-by-File Details

### `index.html`

The DOM skeleton. Defines:

- `#titlebar` — connection status, server label, and toolbar buttons (CONNECT, DISCONNECT, music toggle, scale toggle, render toggle).
- `#terminal-area` — flex row containing `#canvas-wrap` (the terminal canvas and scrollback indicator) and `#scrollbar` (the scroll position indicator on the right edge).
- `#mobile-toolbar` — row of buttons for ESC, TAB, CTRL, arrow keys, function keys, etc. Shown only on narrow/touch screens via CSS media query.
- `#hidden-input` — a `position: fixed; top: -9999px` text input. Receiving focus causes mobile OSes to raise the virtual keyboard. Keydown and `input` events are forwarded to the WebSocket as terminal input.
- `#conn-modal` — the connection dialog (URL field), shown only when `AUTOCONNECT` is false.

The module entry point is a single inline `<script type="module">` that imports and instantiates `App` from `app.js`.

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

The top-level controller. Instantiated once on page load. Owns no terminal logic itself; its job is wiring and event handling.

**Configuration (`window.SYNTHDOOR_CONFIG`):**
All runtime options are read from `window.SYNTHDOOR_CONFIG` in `index.html`. Supported keys:

| Key | Default | Description |
|---|---|---|
| `NAME` | `'SYNTHDOOR'` | Display name shown in the title bar |
| `WSURL` | `'auto'` | WebSocket URL; `'auto'` uses the serving host |
| `AUTOCONNECT` | `true` | Connect immediately on page load |
| `TERMSIZE` | `'80x25'` | Terminal dimensions (fixed; server is 80×25) |
| `SCROLLBACK` | `5000` | Lines kept in the scrollback buffer |
| `SCALING` | `'any'` | Canvas scaling mode: `'integer'`, `'integerish'`, `'any'`, `'fit'` |
| `SCALINGCAP` | `3` | Maximum scale multiplier |
| `IMAGERENDERING` | `'pixelated'` | CSS `image-rendering` on the canvas element |
| `WHEEL_THROTTLE_MS` | `80` | Minimum ms between wheel-generated arrow key sends |

**Data pipeline wiring:**
```js
conn.onData      = (bytes) => {
  const ansi = decoder.decode(bytes)
  telnet.process(ansi)
}
telnet.onData    = (bytes) => { parser.feed(bytes); term.scanURLs(); dirty = true; }
telnet.onSend    = (bytes) => conn.sendBytes(bytes)   // Telnet WONT/DONT responses
term.onSend      = (str)   => conn.sendString(str)    // DSR cursor position reports
term.onANSIMusic = (str)   => music.play(str)
```

**Render loop (`_startLoops`):**
A `requestAnimationFrame` loop calls `renderer.drawFrame()` whenever `_dirty` is set. A 530 ms `setInterval` toggles `_cursorOn` and `_blinkPhase` to drive cursor blink and text blink simultaneously.

**Canvas scaling (`_scaleCanvas`):**
Computes the best scale factor to fit the 80×25 terminal grid inside `#canvas-wrap` according to the active `SCALING` mode, capped at `SCALINGCAP`. The canvas's pixel dimensions remain fixed at `cols × CHAR_W` by `rows × CHAR_H` — scaling is purely presentational via CSS `width`/`height`.

**Mouse handling (`_bindCanvas`):**
- `mousedown` / `mousemove` / `mouseup`: implements drag selection. Normalises `clientX/Y` to `[col, row]` via `_pixelToCell`, which divides by `CHAR_W * scale` and `CHAR_H * scale`.
- Selection text is written to the clipboard on `mouseup` via `navigator.clipboard.writeText`.
- `contextmenu` (right-click): reads from `navigator.clipboard.readText` and sends the text over the WebSocket as a paste.
- `wheel`: calls `term.scrollbackUp/Down` when scrollback exists, or sends arrow key sequences in live view.
- `click`: checks `term.getURLAt(col, row)` and opens URLs in a new tab.

**Keyboard handling (`_handleKeydown`, `_keyToSequence`):**
Maps `KeyboardEvent.key` strings to the correct ANSI escape sequences (VT100/xterm convention). Ctrl+letter combinations produce control characters (charCode − 64). Any keypress while scrolled back snaps the view to live.

**Scrollbar (`_bindScrollbar`, `_updateScrollbarThumb`):**
The thumb's `top` and `height` are recalculated every animation frame from `term.scrollbackLength` and `term._scrollOffset`. Track clicks jump the scroll position; thumb drag computes delta-lines from mouse delta-pixels, for both mouse and touch.

**Mobile CTRL latch (`_ctrlMode`):**
The CTRL toolbar button toggles `_ctrlMode`. The next printable character sent is converted to a control character (e.g. CTRL+C → `\x03`) before the latch is cleared.

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
| `blink` | bool | SGR blink (hides glyph on blink-off phase) |
| `dirty` | bool | Set whenever content changes; cleared by renderer after drawing |

`Cell.set()` does a change-check before writing and sets `dirty` only when something actually changed, avoiding unnecessary redraws.

#### `class ScreenBuffer`

A flat `Cell[]` array of length `cols × rows`. Provides `get(col, row)`, `clearAll()`, `markAllDirty()`, and `snapshotRow(row)` (used to save lines into the scrollback buffer before they scroll off the top).

#### `class TelnetFilter`

A five-state machine (`DATA`, `IAC`, `CMD`, `SB`, `SB_IAC`) that processes the
SBANSI-decoded byte stream and strips Telnet IAC negotiation sequences before
the ANSI parser sees them.

- Responds to `DO <opt>` with `WONT <opt>` and to `WILL <opt>` with `DONT <opt>`, politely declining all options.
- Emits filtered data bytes via `onData` callback and Telnet responses via `onSend` callback.
- Sits AFTER SBANSIDecoder in the pipeline: the decoder restores the original
  ANSI/CP437 byte stream (which may include raw IAC sequences emitted by the
  server or proxied through bbs-client) and TelnetFilter then sees a clean
  byte stream where `0xFF` reliably introduces an IAC sequence.

#### `class ANSIParser`

A four-state machine (`NORMAL`, `ESC`, `CSI`, `MUSIC`) that interprets ANSI/VT100 escape sequences and calls methods on a `Terminal` instance.

**States:**

- `NORMAL` — bytes are either C0 control codes (tab, LF, CR, BS, BEL) or CP437 printable characters forwarded to `terminal.putChar()`.
- `ESC` — saw `0x1B`. Next byte selects a two-character sequence: `[` enters CSI, `7`/`8` save/restore cursor, `M` reverse index, `c` full reset, etc.
- `CSI` — accumulates parameter bytes (`0x30`–`0x3F`) and intermediate bytes (`0x20`–`0x2F`) until a final byte (`0x40`–`0x7E`) arrives. The final byte is dispatched via `_dispatchCSI`.
- `MUSIC` — entered when `ESC [ M` arrives with no parameters. Accumulates bytes into a music string until a terminator (`0x0E`, `0x1E`, NUL, or BEL) arrives, then calls `terminal.onANSIMusic`.

`_dispatchCSI` returns `true` when it changes the parser state (to `MUSIC`), signalling the caller not to reset it to `NORMAL`.

**Supported CSI sequences:** CUU/D/F/B (cursor move), CHA, CUP/HVP (cursor position), ED/EL (erase), IL/DL/ICH/DCH (insert/delete), SU/SD (scroll), SGR (attributes), DECSTBM (scroll region), DSR (device status), SM/RM (mode set/reset including DECTCEM cursor visibility and IRM insert mode).

#### `class Terminal`

Owns and mutates the `ScreenBuffer`. Implements all the operations called by `ANSIParser` plus scrollback management, URL scanning, and copy text extraction.

**Cursor and wrap:** The terminal uses the **immediate (eager) wrap** convention
common to DOS-era BBS clients: as soon as a printable character lands in
column 79 (the last column), the cursor advances to column 0 of the next row
immediately, scrolling if necessary. This matches the de-facto standard that
classic BBS games rely on (writing full-width rows then using `ESC[A` to back
up over the just-wrapped row works correctly). The `_wrapPending` flag is
unused and kept at `false`; the deferred-wrap / "Last Column Flag" model used
by xterm and other modern terminals is **not** what this client implements.
See the project-root `CLAUDE.md` rule 6 for the rationale and the implications
for game authors.

**Scroll region:** `_scrollTop` and `_scrollBottom` (set by DECSTBM `ESC [ r`) constrain scrolling to a sub-region of the screen. `_doScrollUp` pushes the top line into the scrollback buffer only when `_scrollTop === 0` (the full viewport is scrolling), preventing partial-screen scroll regions from polluting the scrollback.

**Scrollback:** `_scrollback` is a `Cell`-snapshot array (max `MAX_SCROLLBACK` rows). `_scrollOffset` tracks how many lines back from live the view is. `getDisplayCells()` returns either the live `screen.cells` array directly (when `_scrollOffset === 0`) or synthesises a flat array from the appropriate scrollback slice plus live rows, so the renderer always receives the same shape of data regardless of scroll state.

The scrollback ring is populated by three mechanisms, each preserving history that would otherwise be lost:

1. **Natural scroll-up** (`_doScrollUp`): when content scrolls past the top of the visible screen (rows pushed off the top by a `\n` at the bottom or a `\r\n`-driven scroll), the displaced row is snapshotted into scrollback. Only fires when `_scrollTop === 0` so partial-screen scroll regions don't pollute history.
2. **Snapshot on `ESC[2J`** (full-screen clear, `eraseDisplay(2)`): every visible row is snapshotted into scrollback **before** the cells are cleared. Without this, a screen full of content the user is currently looking at would vanish silently the moment a clear arrived (which happens on every `setMode(FIXED)` transition and at many BBS menu / banner / game boundaries).
3. **`ESC[3J` is a no-op** (`eraseDisplay(3)`): the xterm "erase saved lines" extension is intentionally ignored. Honouring it would wipe scrollback on every `setMode(FIXED)` transition (the engine's screen layer emits `ESC[3J` as part of its enter sequence), destroying exactly the history the user most wants to scroll back to. SyncTerm takes the same position; matching that gives consistent behaviour across the two clients.

These three together mean scrollback accumulates a continuous chronological record across SCROLL-mode activity, FIXED-mode app transitions, and screen-clearing menus — including the final visible state of a FIXED-mode game (preserved when the post-game SCROLL output naturally scrolls the game's last frame off the top, line by line).

**URL scanning (`scanURLs`):** Iterates every row of the live screen, converts bytes to Unicode via the `CP437` table, and runs a `/https?:\/\/[^\s\x00-\x1F\x7F]*/g` regex. Results are stored in `_urls` as `{row, col, len, url}` objects. Called after every data batch and used by `app.js` for hover cursor and click-to-open.

---

### `sbansi-decoder.js` — `class SBANSIDecoder`

Reverses the server-side SBANSI binary opcode encoder, restoring the original
ANSI/CP437 byte stream the engine emitted. SBANSI is a compact wire encoding
for the most common ANSI sequences (cursor moves, erase, SGR, etc.) — a
single-byte opcode stands in for a multi-byte CSI. Bytes outside the opcode
range pass through unchanged; opcode-range bytes occurring as content are
escaped with `OP_LITERAL` (`0x00`). See `packages/server/src/transports/sbansi-spec.js`
for the full wire format.

Two parser states plus a passthrough for verbatim ANSI sequences:

- **`D_BIN`** — looking for opcodes. Most bytes pass through; specific values
  trigger dispatch (e.g. `0x05` → emit `\x1B[2J`, `0x0E` → emit `\x1B[0m`).
  `0x1B` enters passthrough.
- **`D_AWAIT_*`** — multi-byte opcodes (MOVE_ABS, LITERAL, SGR variants) park
  here for their argument bytes.
- **`D_ANSI_PASSTHROUGH`** — copies a complete ANSI escape sequence verbatim
  to the output. Sub-state tracks ESC vs. CSI vs. MUSIC (`ESC [ M`) so the
  decoder knows when the sequence terminates and it can return to `D_BIN`.

**Malformed-CSI handling matters.** Some BBSes emit partial CSI sequences as
part of terminal-detection probes (e.g. `ESC [ ! <BS>` — the `<BS>` is a C0
control byte that doesn't belong in a CSI body). The decoder's passthrough
state, when it sees a body byte that's neither parameter nor intermediate nor
terminator, exits passthrough and resumes `D_BIN` decoding. The byte itself
has already been pushed to the output verbatim (matching the encoder's
malformed-CSI behaviour). Without this, the decoder would stay stuck in CSI
state until something in `0x40`–`0x7E` arrived, swallowing subsequent SBANSI
opcodes as raw CSI-body bytes and corrupting the rendering downstream.

---

### `renderer.js` — `class Renderer`

Draws the terminal to an HTML5 `<canvas>`. The canvas pixel dimensions are always exactly `cols × CHAR_W` by `rows × CHAR_H`; CSS `width`/`height` scale it for display.

**Font sheet cache (`_tintedSheets`):**
There are at most 16 × 16 = 256 possible foreground/background colour combinations. For each combination encountered, a dedicated `OffscreenCanvas` is built and cached under an 8-bit key `(fg << 4) | bg`. Each sheet is `256 × CHAR_W` pixels wide and `CHAR_H` pixels tall — all 256 glyphs side by side, pre-tinted in the target fg/bg colours.

**Tinting pipeline (`_buildSheet`):**
1. Create a canvas filled with `bgColor`.
2. Create a second canvas filled with `fgColor`, then use `globalCompositeOperation = 'destination-in'` to draw the white-on-transparent master font sheet onto it. `destination-in` keeps only pixels where the glyph bitmap is opaque — now coloured in `fgColor`.
3. Composite the fg-masked canvas over the bg canvas with `source-over`. Result: every glyph has a correct bg-coloured background and fg-coloured pixel strokes.

Drawing a cell is then a single `ctx.drawImage(tintedSheet, ch * CHAR_W, 0, CHAR_W, CHAR_H, x, y, CHAR_W, CHAR_H)` call.

**Dirty-cell cache (`_lastDrawn`):**
A packed `Int32Array` of length `cols × rows`. Each entry stores `ch | (fg << 8) | (bg << 12)` for the cell as last drawn. A cell is skipped if its packed value matches and neither `cell.dirty` nor the force-redraw flag is set.

**Artifact-free cursor and selection:**
`_prevCursorCol/Row` tracks where the cursor was drawn last frame. At the start of every frame, both the old and new cursor positions are added to a `Uint8Array force` bitset, as are all cells within the current selection region. Cells in the force set are always redrawn from clean cell data before the cursor overlay or selection overlay is applied, preventing accumulated pixel artifacts across frames.

**Three-phase draw order per frame:**
1. Dirty-or-forced cell pass (redraws all cells that need updating).
2. Cursor draw (inverts fg/bg of the cursor cell and blits it on top).
3. Selection overlay (a semi-transparent `fillRect` drawn with `source-over` over the freshly-drawn cells).

---

### `font.js`

**`VGA_FONT_8x16` (Uint8Array, 4096 bytes):**
A custom 8×16 bitmap font encoding all 256 CP437 code points. It is derived from the IBM VGA BIOS ROM font but redrawn for pixel-perfect rendering at 8 pixels wide: box-drawing characters are geometrically symmetric (2-pixel-wide lines centered on the 8-pixel grid), and intersection glyphs use bitwise masks to preserve the hollow cores of double lines when crossed by single lines. All 256 glyphs are included, covering the full set of box-drawing, block-graphics, and special characters.

**`buildFontSheet(CHAR_W, CHAR_H)` → `OffscreenCanvas`:**
Renders all 256 glyphs side by side onto a single `OffscreenCanvas` (2048 px wide, 16 px tall) using `putImageData` for pixel-exact placement. Each lit pixel is `RGBA(255, 255, 255, 255)`; dark pixels remain fully transparent. This white-on-transparent sheet is the input to `renderer.js`'s tinting pipeline. It is built once during `renderer.init()` and never redrawn.

---

### `connection.js` — `class WSConnection`

Manages one WebSocket connection at a time. Accepts `onData` and `onStatus` callbacks at construction.

Binary WebSocket frames (`ArrayBuffer`) are used exclusively. CP437 bytes `0x80`–`0xFF` are preserved correctly because they travel as opaque binary data and never pass through a UTF-8 text codec.

`sendString(str)` converts a JS string to `Uint8Array` by taking `charCodeAt(i) & 0xFF` — correct for ANSI escape sequences and key codes.

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

**Playback:** Notes are scheduled ahead of time onto the Web Audio `AudioContext` clock using `OscillatorNode` (square wave, matching the PC Speaker timbre) with a short linear-ramp amplitude envelope (3 ms attack, 5 ms decay). The `AudioContext` is created lazily on first `play()` call and resumed if the browser suspended it due to autoplay policy.

---

## Adding Features

**New ANSI sequences:** Add a `case 0xXX:` to `_dispatchCSI` in `terminal.js` and implement the corresponding method on `Terminal`.

**New colour modes:** The VGA palette is defined in `renderer.js` as `VGA_PALETTE`. The tinted-sheet cache is keyed on the 4-bit fg and bg indices, so adding a 256-colour mode would require either expanding the cache key or switching to a different rendering path for 256-colour cells.

**Font swap:** Replace `VGA_FONT_8x16` in `font.js` with any other 8×16 bitmap font using the same encoding (one byte per row, MSB = leftmost pixel). `CHAR_W` and `CHAR_H` are passed to `buildFontSheet` and exported from `renderer.js`, so changing the glyph size propagates automatically.

**Custom server URL:** Set `WSURL` in `window.SYNTHDOOR_CONFIG` in `index.html`.

---

## Known Limitations

- ANSI music `N1`–`N84` (absolute MIDI note numbers) are recognised but not played; they are silently skipped.
- The 256-colour and 24-bit colour SGR modes (`38;5;n` / `48;5;n` and `38;2;r;g;b` / `48;2;r;g;b`) map to the nearest VGA 4-bit index rather than rendering the actual colour.
- Mouse reporting sequences (e.g. `ESC [ ? 1000 h`) are not sent to the server; mouse interaction is local-only (selection, URL click, scrollback).

## ANSI Handler Coverage and Known Gaps

### How to read this document

- **Match** — handler matches the behaviour that BBS authors typically
  assume. (We may diverge on edge cases not noted here; this list isn't
  exhaustive proof of equivalence.)
- **Divergence (plausible impact)** — we know we're different from
  classic BBS-ANSI expectations, and the difference could be visible in
  the wild.
- **Divergence (low impact)** — we know we're different, but in a
  corner case unlikely to be exercised by a real BBS.
- **Not handled** — we silently drop the sequence. This is the
  conventional behaviour for unsupported BBS-ANSI sequences and isn't
  strictly a divergence, but it's listed so a maintainer can see at a
  glance what isn't covered.

---

### End-of-line wrap behaviour

**Match.** We default to eager-wrap semantics: when a printable
character is written to the last column, the cursor immediately moves
to column 1 of the next line (scrolling if at the bottom of the scroll
region), before the next byte is processed. This is what classic BBS
door games and DOS-era ANSI clients assume, and it's what our terminal
does after the wrap-semantics fix.

**Divergence (documented gap):** Some BBS protocols define an opt-in
"deferred wrap" mode (the cursor sticks at column 79 until the next
character) toggled by a vendor-specific CSI. We don't implement that
opt-in — we are always in eager-wrap mode. No known door game depends
on this. See `CLAUDE.md` Rule 6 for the per-game implications.

DECAWM (`CSI ?7l`/`?7h`, auto-wrap off/on) **is** honoured. With
auto-wrap off, writes to the last column overwrite in place and the
cursor does not advance.

---

### C0 Control characters

Sub-0x20 control bytes that the terminal interprets, with anything not
listed being treated as a CP437 printable byte (the historical BBS
convention).

| Byte | Conventional BBS meaning | Web client | Status |
|------|-------------------------|------------|--------|
| `0x00` NUL | Doorway-mode literal-next escape; otherwise no-op | Ignored | **Divergence (low impact).** Doorway mode is not implemented. |
| `0x07` BEL | Audible bell | Calls `bell()` (no-op) | Match (no audio integration in the web client). |
| `0x08` BS | Non-destructive backspace; clamps at column 1 | `cursorLeft(1)` clamping at column 0 | Match. |
| `0x09` HT | Advance to next tab stop; on classic BBS clients, wraps to the next line (with scroll) if past the last stop | Jumps to next multiple of 8, capped at `cols-1`; does **not** wrap to next line | **Divergence (low impact).** Tab near the right margin doesn't wrap. Almost no BBS uses tab that way. |
| `0x0A` LF | Move to same column of next row; scroll if at bottom | Same | Match. |
| `0x0B` VT | Display as CP437 glyph ♂ (BBS art convention) | Treated as line-feed | **Divergence (plausible impact).** ANSI art files that contain VT as a graphic character will scroll instead of rendering the glyph. |
| `0x0C` FF | Display as CP437 glyph ♀ (BBS art convention) | Treated as line-feed | **Divergence (plausible impact).** Same family as VT. |
| `0x0D` CR | Move to column 1 of current line | Same | Match. |
| `0x0E` SO | Display as CP437 glyph ♫ | Display as CP437 glyph | Match. |
| `0x0F` SI | Display as CP437 glyph ☼ | Display as CP437 glyph | Match. |
| `0x1B` ESC | Introduces a control sequence | Same | Match. |

---

### Fp / Fe / Fs Escape Sequences (single-byte ESC + ...)

Two-byte ESC sequences (ESC followed by one byte in specific ranges).
These are the C1 control set, the standardised single control functions,
and DEC's private cursor save/restore.

| Sequence | Conventional meaning | Web client | Status |
|----------|---------------------|------------|--------|
| `ESC 7` (DECSC) | Save cursor position | Saves `cx, cy` only | Match for position. Some BBS clients also save SGR state on DECSC; door games rarely depend on that. |
| `ESC 8` (DECRC) | Restore cursor position | Restores `cx, cy` | Match for position. |
| `ESC c` (RIS) | Reset terminal to initial state | Full reset including SGR, scroll region, modes, cursor visibility | Match. |
| `ESC D` (IND) | Index — move down one line, scrolling if needed | Same as LF | Match. |
| `ESC E` (NEL) | Next line — CR then LF | Same | Match. |
| `ESC M` (RI) | Reverse index — move up one line, reverse-scrolling if at top | Same | Match. |
| `ESC P … ST` (DCS) | Begins a Device Control String (sixel images, loadable fonts, etc.) | Dropped | **Not handled.** No DCS parser. Modern BBSes using sixel or custom font upload will not render those. |
| `ESC ] … ST` (OSC) | Begins an Operating System Command (palette redefinition, hyperlinks, default colour queries) | Dropped | **Not handled.** OSC 8 hyperlinks and OSC 4 palette sequences are ignored. |
| `ESC ^ … ST` (PM) | Privacy Message string | Dropped | **Not handled.** PM is conventionally ignored anyway. |
| `ESC _ … ST` (APC) | Application Program Command — vendor-specific extensions | Dropped | **Not handled.** Vendor APCs (audio synthesis, image cache, file transfer extensions) are ignored. |
| `ESC \` (ST) | String terminator | Dropped — no string state to terminate | Match. |
| Other Fe / Fs | Reserved; conventionally dropped | Dropped | Match. |

---

### CSI Cursor Movement

| Sequence | Conventional meaning | Web client | Status |
|----------|---------------------|------------|--------|
| `CSI Pn A` (CUU) | Cursor Up N rows, clamp at screen top | Up N rows, clamp at `_scrollTop` | **Divergence (low impact).** Clamps at the scroll-region top instead of the physical screen top. Visible only when a BBS sets a scroll region and then sends CUU to leave it. |
| `CSI Pn B` (CUD) | Cursor Down N rows, clamp at screen bottom | Down N rows, clamp at `_scrollBottom` | **Divergence (low impact).** Same family as CUU. |
| `CSI Pn C` (CUF) | Cursor Right N cols | Right N cols, clamp at `cols-1` | Match. |
| `CSI Pn D` (CUB) | Cursor Left N cols | Left N cols, clamp at 0 | Match. |
| `CSI Pn E` (CNL) | Cursor Next Line — down N then to column 1 | Same | Match. |
| `CSI Pn F` (CPL) | Cursor Previous Line — up N then to column 1 | Same | Match. |
| `CSI Pn G` (CHA) | Move to column N of current row | `cursorCol(N-1)` | Match. |
| `CSI Pn1;Pn2 H` (CUP) | Absolute cursor position (row N1, col N2) | `cursorPos(N1-1, N2-1)` | Match. |
| `CSI Pn1;Pn2 f` (HVP) | Absolute cursor position — alternate form of CUP | Same as CUP | Match. |
| `CSI Pn I` (CHT) | Forward to N-th next tab stop | Dropped | **Not handled (low impact).** Alternate form of multiple HT; rare. |
| `CSI Pn Y` (CVT) | Move to next line tabulation stop | Dropped | **Not handled (low impact).** Line tabs aren't implemented. |
| `CSI Pn Z` (CBT) | Backward to N-th previous tab stop | `cursorBackTab(n)` — multiples of 8 | Match for default tab stops. We don't track settable tab stops, but no known door game uses settable tabs. |
| ``CSI Pn ` `` (HPA) | Column position absolute | Dropped | **Not handled (low impact).** Alternate form of CHA. |
| `CSI Pn a` (HPR) | Column position forward | Dropped | **Not handled (low impact).** Alternate form of CUF. |
| `CSI Pn j` (HPB) | Column position backward | Dropped | **Not handled (low impact).** Alternate form of CUB. |
| `CSI Pn d` (VPA) | Line position absolute | Dropped | **Not handled (low impact).** Alternate form of "go to row N, keep column." |
| `CSI Pn e` (VPR) | Line position forward | Dropped | **Not handled (low impact).** Alternate form of CUD. |
| `CSI Pn k` (VPB) | Line position backward | Dropped | **Not handled (low impact).** Alternate form of CUU. |

---

### CSI Erase / Insert / Delete

| Sequence | Conventional meaning | Web client | Status |
|----------|---------------------|------------|--------|
| `CSI Ps J` (ED) | Erase in page: 0=cur→end, 1=cur→start, 2=screen + home cursor | Same; 3 also handled as "erase scrollback" | Match for 0/1/2. Mode 3 is an xterm-style scrollback clear used internally by the engine; harmless to BBSes that don't send it. |
| `CSI Ps K` (EL) | Erase in line: 0/1/2 | Same | Match. |
| `CSI Pn @` (ICH) | Insert N characters at cursor | `insertChars(n)` | Match. |
| `CSI Pn L` (IL) | Insert N lines. Conventionally no-op if cursor outside scroll region | Always acts | **Divergence (low impact).** Calling IL with the cursor outside the scroll region acts when conventional BBS behaviour would no-op. Rare. |
| `CSI Pn M` (DL) | Delete N lines. Conventionally no-op if cursor outside scroll region | Always acts when params non-empty | **Divergence (low impact).** Same family as IL. Note: `CSI M` with no parameters dispatches as ANSI music — see "ANSI music" below. |
| `CSI Pn P` (DCH) | Delete N characters. Conventionally no-op if cursor outside scroll region | Always acts | **Divergence (low impact).** Same family. |
| `CSI Pn X` (ECH) | Erase N characters; stops at end of line | Same | Match. |
| `CSI Pn S` (SU) | Scroll up N lines within scroll region | `scrollUp(n)` | Match. |
| `CSI Pn T` (SD) | Scroll down N lines within scroll region | `scrollDown(n)` | Match. |
| `CSI Pn b` (REP) | Repeat previous graphic character N times | Dropped | **Not handled (low impact).** Some character generators use it; no known door game does. |

---

### CSI Scrolling Margins, Cursor Save/Restore

| Sequence | Conventional meaning | Web client | Status |
|----------|---------------------|------------|--------|
| `CSI Pn1;Pn2 r` (DECSTBM) | Set scroll region top/bottom; cursor to (1,1) of screen | Sets scroll region; cursor to top of scroll region unconditionally | **Divergence (low impact).** We always move to the top of the new scroll region after DECSTBM. Conventional behaviour is to move to (1,1) of the physical screen unless origin mode is on. |
| `CSI s` (SCOSC) | Save cursor position | Saves `cx, cy` | Match (in default mode). Some terminals overload `CSI s` as "set left/right margins" under a private mode; we don't implement that mode. |
| `CSI u` (SCORC) | Restore cursor position | Restores `cx, cy` | Match. |

---

### CSI Modes (SM / RM / DECSET / DECRST)

Mode-setting sequences. We implement a small subset; modes not listed
here are silently dropped.

| Mode | Conventional meaning | Web client | Status |
|------|---------------------|------------|--------|
| `4 h/l` (IRM) | Insert / replace mode | `_insertMode` flag | Match. |
| `?6 h/l` (DECOM) | Origin mode — position params relative to scroll region | Not handled | **Divergence (plausible impact).** Cursor positioning and DSR cursor reports never respect origin mode. BBSes that combine DECOM with scroll regions will mis-position. |
| `?7 h/l` (DECAWM) | Auto-wrap on/off | `_autoWrap` flag | Match. |
| `?25 h/l` (DECTCEM) | Cursor visibility | `cursorVisible` flag | Match. |
| `?9` / `?1000..1006` | Mouse-reporting modes | Not handled | **Not handled (no impact for door games).** Door games don't use mouse. |
| `?31, 32, 33, 34, 35` | Various bright-bit / blink-bit alternate-font interpretations | Not handled | **Not handled (low impact).** Rare vendor-specific extensions. |
| `?67` | Backspace key sends BS vs DEL | Not handled | **Not handled (input-side concern).** Not the web client's role. |
| `?80` | Sixel scrolling behaviour | Not handled | **Not handled.** No sixel support exists. |
| `?2004` | Bracketed paste mode | Not handled | **Not handled (no impact).** |
| `=4 h/l`, `=5 h` | Vendor extension to toggle deferred-wrap (LCF) mode | Not handled | **Documented gap.** See "End-of-line wrap behaviour" above. |
| `=255 h/l` | DoorWay mode — when set, NUL escapes the next byte as a literal CP437 glyph, allowing ESC and other control bytes to appear in ANSI art | Not handled | **Divergence (plausible impact).** ANSI art using DoorWay mode to embed ESC bytes as graphics will be mis-parsed. |

---

### CSI Device Reports

| Sequence | Conventional meaning | Web client | Status |
|----------|---------------------|------------|--------|
| `CSI Ps c` (DA) | Device Attributes query | Reply `CSI ?1;0c` (plain VT100 with no options) | **Divergence (plausible impact).** Some BBSes vary their feature set based on the DA reply — for example, they may probe for vendor-specific extension support before sending sixel, custom fonts, or 256-colour SGR. Those BBSes will see us as a plain VT100 and fall back to a reduced feature set. No known classic door game does this. |
| `CSI 5 n` (DSR status) | "Are you OK?" — reply `CSI 0 n` | Same | Match. |
| `CSI 6 n` (DSR cursor) | Cursor position request — reply `CSI row;col R` | Same | Match. (Some conventions report position relative to scroll region when origin mode is on. We don't implement origin mode, so this is moot.) |
| `CSI 255 n` | Terminal-size query — reply as if cursor were at bottom-right | Not handled | **Divergence (low impact).** BBSes probing terminal size this way get no reply. |
| `CSI ? Ps n` / `CSI = Ps n` | Various vendor-extension status reports | Not handled | **Not handled.** |

---

### CSI Tab Stops

| Sequence | Conventional meaning | Web client | Status |
|----------|---------------------|------------|--------|
| `ESC H` (HTS) | Set tab stop at current column | Not handled | **Not handled (low impact).** We use fixed multiples of 8. |
| `ESC J` (VTS) | Set line tab stop | Not handled | **Not handled (low impact).** |
| `CSI Ps g` (TBC) | Clear tab stops | Not handled | **Not handled (low impact).** |
| `CSI Pn SP d` (TSR) | Remove specific tab stop | Not handled | **Not handled (low impact).** |

No known classic BBS or door game customises tab stops.

---

### SGR (Select Graphic Rendition) — `CSI Ps … m`

The most-used CSI by a wide margin. Most parameters are implemented.
Divergences:

| Parameter | Conventional meaning | Web client | Status |
|-----------|---------------------|------------|--------|
| `0` | Reset all attributes to defaults | `fg=7, bg=0`, bold/blink/reverse off | Match. |
| `1` | Bold / bright intensity | `bold=true` | Match. |
| `2` | Dim intensity (typically aliased to "not bold" in BBS practice since there's no separate dim state) | `bold=false` | Match. |
| `5` / `6` | Slow / fast blink (BBS practice treats both the same) | `blink=true` | Match. |
| `7` | Reverse video (typically a state flag, applied at render time) | **Swap-on-set:** swaps `fgColor` ↔ `bgColor` and sets a reverse flag | **Divergence (plausible impact).** Some terminals treat reverse as a render-time flag, so subsequent fg/bg changes apply to the "logical" foreground/background and reverse is applied at draw time. We apply the swap at set-time, so an SGR 7 followed by an SGR 31 (red fg) places red in whichever slot is currently "active" after the swap. The visible result differs only when a BBS sets reverse and then changes colours; this pattern is uncommon. |
| `8` | Concealed (fg = bg, text invisible) | Not handled | **Divergence (low impact).** Concealed text displays normally. Very rare in BBS use. |
| `22, 25, 27` | Reset bold / blink / reverse | Match | Match. |
| `30-37` | Set foreground colour 0-7 | Match | Match. |
| `38;5;n` | XTerm 256-colour palette foreground | `idx & 15` — truncates to 16 colours | **Divergence (plausible impact).** Any BBS using 256-colour SGR will see wrong colours. The web client deliberately targets 16-colour BBS art. |
| `38;2;r;g;b` | 24-bit truecolour foreground | Params consumed, colour unchanged | **Divergence (plausible impact).** Truecolour sequences are silently ignored. |
| `39` | Default foreground | `fg=7` (white) | Match. |
| `40-47` | Set background colour 0-7 | Match | Match. |
| `48;5;n` / `48;2;r;g;b` | Palette / truecolour background | Truncated / discarded | **Divergence (plausible impact).** Same as 38 family. |
| `49` | Default background | `bg=0` (black) | Match. |
| `90-97` | Aixterm bright foreground (palette index 8-15) | Maps to fg 8-15 | Match for the common BBS interpretation. Some terminals gate this behind a private mode; we don't gate it. |
| `100-107` | Aixterm bright background | Maps to bg 8-15 | Match for the common BBS interpretation. Same gating note. |

---

### ANSI Music

ANSI music is a BBS extension where a music notation string is embedded
in the byte stream, conventionally framed by `CSI |` (sometimes `CSI N`
or `CSI M`) and terminated by SO (0x0E). Different terminals recognise
different introducer sequences.

**Web client behaviour:**

- Recognises `CSI M` with no parameters as a music introducer
  unconditionally.
- Does **not** recognise `CSI |` or `CSI N` as music introducers.
- When a music sequence is parsed, fires the `onANSIMusic` callback with
  the music string. Audio playback is a separate integration; this
  module only parses.

**Divergence (plausible impact):** BBSes that send music via `CSI |`
(historically the most common introducer) will not have their music
detected. ANSI music is rare on modern BBSes.

---

### DCS / OSC / APC strings

| String type | Conventional uses | Web client |
|-------------|------------------|------------|
| `ESC P … ST` (DCS) | Sixel images, loadable fonts, status string requests, macro definitions | **Not handled.** No DCS parser. |
| `ESC ] … ST` (OSC) | Palette redefinition (OSC 4), default fg/bg query (OSC 10/11), hyperlinks (OSC 8) | **Not handled.** No OSC parser. |
| `ESC _ … ST` (APC) | Vendor-specific extensions: file transfer, image caching, audio synthesis, font loading | **Not handled.** No APC parser. |

OSC 8 (hyperlinks) is an emerging convention in modern BBSes — links in
message areas and the like. Worth being aware of if it becomes
desirable.

---

### What's implemented correctly

For balance — these are the sequences and behaviours that have been
verified to work in practice across classic BBS door games (Renegade,
Mystic, SBBS, SMASHIM, LORD, TradeWars 2002, Usurper, and others):

- Eager-wrap end-of-line behaviour.
- CR / LF / BS / Tab within line.
- CSI A/B/C/D cursor movement.
- CSI H/f absolute positioning.
- CSI J/K erase modes 0/1/2.
- CSI L/M/P/X/@/S/T insert / delete / scroll.
- CSI m SGR for 16-colour foreground/background, bold, blink, reverse,
  reset.
- CSI r scroll region.
- CSI s/u save/restore cursor (position only).
- CSI ?25 cursor visibility.
- CSI ?7 auto-wrap.
- CSI 4 insert mode.
- CSI 5n / 6n device status reports.
- ESC 7/8 save/restore cursor.
- ESC D/E/M index / next-line / reverse-index.
- ESC c full reset.

This covers every CSI sequence observed in practice during testing.

---

### Priorities if any divergence needs addressing

If a real-world BBS exposes one of the documented divergences and we
decide to close the gap, the rough order of value-per-effort:

1. **VT (0x0B) and FF (0x0C) as glyphs.** Small change — one line in the
   NORMAL-state switch in `_consume`. Fixes ANSI art rendering for files
   that use these as graphic characters.
2. **256-colour SGR (38;5;n / 48;5;n).** Significant change — requires
   expanding the cell colour model from 4-bit to 8-bit and either
   implementing the full xterm 256-colour palette or mapping to closest
   16-colour. Worth it only if modern BBS art with 256-colour palettes
   becomes important.
3. **DECOM (origin mode, `?6 h/l`).** Modest change — wire an
   `_originMode` flag into `cursorPos` and `deviceStatus`. Only matters
   for BBSes that combine origin mode with scroll regions.
4. **DoorWay mode (`CSI =255 h/l`).** Modest change — implement NUL as
   literal-next escape inside `_consume`. Only matters for ANSI art with
   embedded ESC bytes drawn as graphics.
5. **Deferred-wrap (LCF) opt-in (`CSI =4h`/`=4l`/`=5h`).** Modest change
   — re-enable the `_wrapPending` machinery in `putChar` and gate it on
   a new `_lcfMode` flag. Likely never needed for door-game use.
6. **DA reply matching the host the BBS expects.** Trivial change to the
   `CSI c` handler. Only worth it if a BBS gates features on DA reply.
7. **Reverse video (SGR 7) as a flag instead of swap-on-set.** Modest
   change to `sgr()` and the cell render path. Subtle; could regress
   existing behaviour for BBSes that depend on the swap-on-set
   convention.
8. **OSC 8 hyperlinks.** New feature, not a fix. Useful for modernising
   the experience.
9. **Sixel / DCS / APC support.** Large new feature work; only relevant
   if graphics-capable BBSes become a target.

Everything else is low enough impact that it's not worth chasing
preemptively. Add to this list if a specific BBS demonstrates a problem.

