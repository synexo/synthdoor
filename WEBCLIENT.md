# Web Client — ANSI Handler Coverage and Known Gaps

The web terminal in `packages/server/src/web/public/terminal.js` is an implementation of a BBS-era ANSI client written for SynthDoor. It
targets the subset of ECMA-48, DEC VT100/VT102, and historical
DOS/BBS-ANSI conventions that classic BBS door games depend on. It does
not implement the full surface of any one terminal — modern terminal
emulators have grown far beyond what BBS games use, and this client
focuses on what's actually exercised in practice.

This document catalogues every place our handler set differs from what a
BBS door game might expect — what we don't implement, what we implement
incompletely, and what we do differently from what the long history of
ANSI BBS clients has taught authors to assume. It's intended as a
maintainer's reference: if a particular BBS or game misbehaves, this is
the first place to check.

## How to read this document

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

## End-of-line wrap behaviour

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

## C0 Control characters

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

## Fp / Fe / Fs Escape Sequences (single-byte ESC + ...)

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

## CSI Cursor Movement

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

## CSI Erase / Insert / Delete

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

## CSI Scrolling Margins, Cursor Save/Restore

| Sequence | Conventional meaning | Web client | Status |
|----------|---------------------|------------|--------|
| `CSI Pn1;Pn2 r` (DECSTBM) | Set scroll region top/bottom; cursor to (1,1) of screen | Sets scroll region; cursor to top of scroll region unconditionally | **Divergence (low impact).** We always move to the top of the new scroll region after DECSTBM. Conventional behaviour is to move to (1,1) of the physical screen unless origin mode is on. |
| `CSI s` (SCOSC) | Save cursor position | Saves `cx, cy` | Match (in default mode). Some terminals overload `CSI s` as "set left/right margins" under a private mode; we don't implement that mode. |
| `CSI u` (SCORC) | Restore cursor position | Restores `cx, cy` | Match. |

---

## CSI Modes (SM / RM / DECSET / DECRST)

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

## CSI Device Reports

| Sequence | Conventional meaning | Web client | Status |
|----------|---------------------|------------|--------|
| `CSI Ps c` (DA) | Device Attributes query | Reply `CSI ?1;0c` (plain VT100 with no options) | **Divergence (plausible impact).** Some BBSes vary their feature set based on the DA reply — for example, they may probe for vendor-specific extension support before sending sixel, custom fonts, or 256-colour SGR. Those BBSes will see us as a plain VT100 and fall back to a reduced feature set. No known classic door game does this. |
| `CSI 5 n` (DSR status) | "Are you OK?" — reply `CSI 0 n` | Same | Match. |
| `CSI 6 n` (DSR cursor) | Cursor position request — reply `CSI row;col R` | Same | Match. (Some conventions report position relative to scroll region when origin mode is on. We don't implement origin mode, so this is moot.) |
| `CSI 255 n` | Terminal-size query — reply as if cursor were at bottom-right | Not handled | **Divergence (low impact).** BBSes probing terminal size this way get no reply. |
| `CSI ? Ps n` / `CSI = Ps n` | Various vendor-extension status reports | Not handled | **Not handled.** |

---

## CSI Tab Stops

| Sequence | Conventional meaning | Web client | Status |
|----------|---------------------|------------|--------|
| `ESC H` (HTS) | Set tab stop at current column | Not handled | **Not handled (low impact).** We use fixed multiples of 8. |
| `ESC J` (VTS) | Set line tab stop | Not handled | **Not handled (low impact).** |
| `CSI Ps g` (TBC) | Clear tab stops | Not handled | **Not handled (low impact).** |
| `CSI Pn SP d` (TSR) | Remove specific tab stop | Not handled | **Not handled (low impact).** |

No known classic BBS or door game customises tab stops.

---

## SGR (Select Graphic Rendition) — `CSI Ps … m`

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

## ANSI Music

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

## DCS / OSC / APC strings

| String type | Conventional uses | Web client |
|-------------|------------------|------------|
| `ESC P … ST` (DCS) | Sixel images, loadable fonts, status string requests, macro definitions | **Not handled.** No DCS parser. |
| `ESC ] … ST` (OSC) | Palette redefinition (OSC 4), default fg/bg query (OSC 10/11), hyperlinks (OSC 8) | **Not handled.** No OSC parser. |
| `ESC _ … ST` (APC) | Vendor-specific extensions: file transfer, image caching, audio synthesis, font loading | **Not handled.** No APC parser. |

OSC 8 (hyperlinks) is an emerging convention in modern BBSes — links in
message areas and the like. Worth being aware of if it becomes
desirable.

---

## What's implemented correctly

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

## Priorities if any divergence needs addressing

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
