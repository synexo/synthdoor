# SynthDoor Menu System

> **Reference guide for operators and developers.**
> Covers the YAML schema, navigation, ANSI art, colours, nesting, and extension.

---

## Overview

The SynthDoor menu system replaces the original single-level game picker with a
fully configurable, nestable menu hierarchy defined in YAML files.  Key
behaviours:

- After a game exits, the player is **returned to the menu** they came from.
- Menus can be **nested** to any practical depth (limit: 8 levels).
- The top-level menu (`top.yaml`) is **auto-generated** from discovered games on
  first run, then written to disk for the operator to customise.
- Any menu can optionally display a **CP437 ANSI art file** behind or instead of
  the standard item list.
- A **goodbye screen** is shown whenever a player exits, with an optional custom
  ANSI art override.
- **Direct-launch** paths (rlogin `ServerUser`, `default_game` in config) are
  completely unaffected — they bypass the menu system entirely and disconnect
  cleanly when the game exits.

---

## Directory Layout

```
config/
  menus/
    top.yaml          ← top-level menu (auto-generated if absent)
    utils.yaml        ← example sub-menu
    goodbye.yaml      ← goodbye screen config (optional)
    art/
      goodbye.ans     ← default goodbye art (CP437 ANSI)
      top_menu.ans    ← your custom top-menu art (optional)
      *.ans           ← any additional art files
```

The menus directory path defaults to `<project-root>/config/menus`.  Override
it in `synthdoor.conf`:

```ini
menus_dir = /path/to/your/menus
```

---

## Schema Reference

Every menu file is a YAML document with the following top-level fields.  All
fields are optional unless noted.

```yaml
# ── Display ──────────────────────────────────────────────────────────────────

title: "SynthDoor BBS"
# Text shown in the full-width title bar (row 1).
# null or omitted → default "SYNTHDOOR" bar.

statusbar: "Use arrows/numbers to select.  Q = quit"
# Text shown in the protected status bar (row 25).
# The renderer prepends a single space automatically.

ansifile: "art/top_menu.ans"
# CP437 ANSI art file rendered into rows 2-24 (between title and status bars).
# Path is relative to config/menus/art/ unless absolute.
# When set: standard item highlight and auto-layout are SUPPRESSED.
# Navigation is key-press only (numbers / letter shortcuts).
# Mutually exclusive with underlay (ansifile wins if both are set).

underlay: "art/top_menu.ans"
# CP437 ANSI art file drawn into rows 2-24 as a BACKGROUND LAYER.
# Unlike ansifile, the standard arrow-selectable item list is still rendered
# on top of the art.  Useful for decorative backgrounds.
# Mutually exclusive with ansifile.

columns: 1
# Number of columns for the auto-layout item list (1-4).
# Items are distributed left-first (top-to-bottom within each column).
# Ignored when ansifile is set.

# ── Colour overrides ─────────────────────────────────────────────────────────

colors:
  title_fg:      BRIGHT_WHITE   # title bar foreground
  title_bg:      BLUE           # title bar background
  normal_fg:     WHITE          # unselected item text
  normal_bg:     BLACK          # unselected item background
  selected_fg:   BLACK          # highlighted item text
  selected_bg:   CYAN           # highlighted item background
  number_fg:     BRIGHT_YELLOW  # key prefix ("1.") unselected
  border_fg:     CYAN           # box border (reserved for future box rendering)
  statusbar_fg:  BLACK          # status bar foreground
  statusbar_bg:  CYAN           # status bar background
# All color fields are optional.  Omitted fields fall back to the built-in
# theme defaults (shown above).
# Accepted values: any Color constant name (case-insensitive), or an integer
# 0-15.  See packages/engine/src/constants.js for the full list.

# ── Selections ───────────────────────────────────────────────────────────────

selections:
  - key: "1"
    text: "Meteoroid"
    type: game
    target: meteoroid
```

---

## Selection Fields

Each entry in the `selections` list has:

| Field    | Required | Description |
|----------|----------|-------------|
| `key`    | yes      | Key the user presses.  Case-insensitive string (`"1"`, `"a"`, `"x"`). |
| `text`   | yes      | Display label shown in the menu list. |
| `type`   | yes      | `game`, `menu`, or `action` — see below. |
| `target` | yes*     | Destination.  Meaning depends on `type`. |
| `inline` | no       | Inline nested `MenuDef` (type:menu only).  Overrides `target`. |
| `colors` | no       | Per-item colour overrides.  Same keys as the top-level `colors` block. |

\* `target` is required for all types except `type: menu` when `inline` is set.

---

## Selection Types

### `type: game`

Launches a registered SynthDoor game.  `target` must be the game's `GAME_NAME`
(the value returned by `static get GAME_NAME()`).

```yaml
- key: "1"
  text: "Meteoroid"
  type: game
  target: meteoroid
```

When the game exits, the player is returned to the menu that contained this
selection.

---

### `type: menu`

Navigates to a sub-menu.  Two styles:

**External file reference** — `target` is the YAML filename without the `.yaml`
extension.  The file must exist in `config/menus/`.

```yaml
- key: "2"
  text: "Utilities"
  type: menu
  target: utils         # loads config/menus/utils.yaml
```

**Inline nested menu** — the full menu definition is embedded under `inline:`.
The `target` field is ignored when `inline` is present.

```yaml
- key: "2"
  text: "Utilities"
  type: menu
  inline:
    title: "Utilities"
    statusbar: "Select a utility.  Q = back"
    columns: 1
    selections:
      - key: "1"
        text: "High Scores"
        type: game
        target: some-game
      - key: "q"
        text: "Back"
        type: action
        target: back
```

Both styles can be mixed within a single file.  Nesting is limited to 8 levels
deep to prevent runaway recursion.

---

### `type: action`

Triggers a built-in navigation action.

| `target`      | Behaviour |
|---------------|-----------|
| `exit`        | Show goodbye screen, then disconnect. |
| `back`        | Return to the parent menu.  At the root menu, equivalent to `exit`. |
| `disconnect`  | Disconnect immediately without a goodbye screen. |

```yaml
- key: "q"
  text: "Goodbye"
  type: action
  target: exit
```

---

## Navigation Keys

| Key            | Behaviour |
|----------------|-----------|
| Arrow UP / DOWN | Move selection highlight (auto-layout and underlay modes) |
| Number/letter  | Jump directly to the matching `key` entry |
| Enter or Space | Confirm the highlighted selection |
| Q              | If no selection has `key: "q"`, synthesises a `back` action |
| Escape         | Always synthesises a `back` action |

In **ANSI art mode** (`ansifile` set), the highlight and arrow keys are
suppressed.  Only direct key presses work.

---

## Column Layout

When `columns` is 2 or more, items fill **left-to-right, top-to-bottom within
each column** (left-first fill):

```
columns: 2, 5 items:

  Column 1    Column 2
  ─────────   ─────────
  1. Item A   4. Item D
  2. Item B   5. Item E
  3. Item C
```

The screen width is divided equally between columns.  A 2-character gutter
separates each column.

---

## ANSI Art Files

Art files must be CP437-encoded `.ans` files.  They are rendered into rows 2-24
(the 23 rows between the title bar and status bar).  Row 1 (title) and row 25
(status bar) are always drawn by the renderer and cannot be overridden by art.

### `ansifile` (full replacement)

The art completely replaces the auto-layout item list.  No highlight is drawn.
Keys defined in `selections` still work — pressing the matching key navigates
as normal.  The art is expected to contain its own visual labels for each option.

### `underlay` (background layer)

The art is drawn first; then the standard numbered, arrow-selectable item list
is rendered on top.  This lets you have a decorative background without giving
up the standard navigation UX.

**Future enhancement:** adding `x`/`y` fields to individual selections will allow
item labels to be positioned at arbitrary coordinates over the art, enabling
fully custom layouts while retaining standard navigation.

---

## Colour Reference

All colour values in the `colors` block use the names from
`packages/engine/src/constants.js`:

| Name             | ANSI code |
|------------------|-----------|
| `BLACK`          | 0  |
| `RED`            | 1  |
| `GREEN`          | 2  |
| `YELLOW`         | 3  |
| `BLUE`           | 4  |
| `MAGENTA`        | 5  |
| `CYAN`           | 6  |
| `WHITE`          | 7  |
| `DARK_GRAY`      | 8  |
| `BRIGHT_RED`     | 9  |
| `BRIGHT_GREEN`   | 10 |
| `BRIGHT_YELLOW`  | 11 |
| `BRIGHT_BLUE`    | 12 |
| `BRIGHT_MAGENTA` | 13 |
| `BRIGHT_CYAN`    | 14 |
| `BRIGHT_WHITE`   | 15 |

Integer values 0-15 are also accepted directly.

Background colours are limited to 0-7 (standard ANSI does not support bright
backgrounds on most BBS clients).

---

## Goodbye Screen

The goodbye screen is shown whenever a player triggers an `exit` action from
any menu.  It is **not** shown for `disconnect` actions or when direct-launch
paths (rlogin, `default_game`) exit.

### Configuration

`config/menus/goodbye.yaml` controls the goodbye screen.  It follows the same
schema as any other menu definition, but has no `selections`.

```yaml
# config/menus/goodbye.yaml
title: "GOODBYE"
statusbar: " Thank you for visiting SynthDoor BBS!"
ansifile: "goodbye.ans"    # relative to config/menus/art/
```

If `goodbye.yaml` does not exist, a built-in CP437 box art goodbye screen is
shown.  A default `goodbye.ans` art file ships with SynthDoor in
`config/menus/art/goodbye.ans`.

To use the built-in box art instead of the `.ans` file:

```yaml
# goodbye.yaml
title: "GOODBYE"
statusbar: " Thank you for visiting SynthDoor BBS!"
# (no ansifile — built-in screen is used)
```

---

## Auto-Generated `top.yaml`

If `config/menus/top.yaml` does not exist when the server starts, SynthDoor
automatically generates one from the list of discovered games and writes it to
disk.  A prominent log message is emitted:

```
╔══════════════════════════════════════════════════════════════╗
║  MENU SYSTEM: top.yaml not found — auto-generated.           ║
║  Created: /path/to/config/menus/top.yaml                     ║
║  Edit this file to customise your top-level menu.            ║
║  See docs/MENU.md for the full schema reference.             ║
╚══════════════════════════════════════════════════════════════╝
```

The generated file always includes a `q` / Goodbye / exit entry.  Edit the file
freely — it will not be regenerated as long as it exists.

To force regeneration: delete `top.yaml` and restart the server.

---

## Interaction with `default_game` and Direct Launch

These paths **bypass the menu system entirely**:

| Path | Behaviour |
|------|-----------|
| `default_game = meteoroid` in `synthdoor.conf` | Launches meteoroid directly.  Disconnects when game exits.  No menu. |
| rlogin `ServerUser = meteoroid` | Launches meteoroid directly.  Disconnects when game exits.  No menu. |
| rlogin `ServerUser = <recovery code>` + `TermType = meteoroid` | Silent BBS login, launches game.  Disconnects on exit. |

The menu session only activates when no specific game is requested and
`default_game` is not set (or the named game is not found).

---

## Jumping Between Games

The `MenuSession` maintains an internal navigation stack.  Any code that holds
a reference to the running session can push a new context with `session.jump()`:

```javascript
// From within a game that has access to the session:
const { GameContext } = require('../server/src/menu-session');
session.jump(new GameContext(router.getGame('meteoroid')));
```

When the pushed game exits, the stack unwinds back to the caller's context.
This facility is the foundation for future "go to game" slash commands in
multi-user areas (e.g. a teleconference game's `/game meteoroid` command).

---

## Complete Examples

### Simple single-file menu with all games

```yaml
# config/menus/top.yaml
title: "My BBS"
statusbar: "Select a game or press Q to quit."
columns: 1

selections:
  - key: "1"
    text: "Meteoroid — Space Shooter"
    type: game
    target: meteoroid

  - key: "2"
    text: "Tetris"
    type: game
    target: tetris

  - key: "q"
    text: "Goodbye"
    type: action
    target: exit
```

---

### Two-column layout with custom colours

```yaml
title: "GAME PALACE BBS"
statusbar: "Choose your game.  ESC = back."
columns: 2

colors:
  title_fg:    BRIGHT_YELLOW
  title_bg:    RED
  selected_fg: BRIGHT_WHITE
  selected_bg: BLUE
  number_fg:   BRIGHT_CYAN

selections:
  - key: "1"
    text: "Meteoroid"
    type: game
    target: meteoroid

  - key: "2"
    text: "Tetris"
    type: game
    target: tetris

  - key: "3"
    text: "Daily Horoscope"
    type: game
    target: daily-horoscope

  - key: "4"
    text: "Eliza"
    type: game
    target: eliza

  - key: "q"
    text: "Goodbye"
    type: action
    target: exit
```

---

### Top menu with nested sub-menus (all inline)

```yaml
title: "SynthDoor BBS"
statusbar: "Select an option."
columns: 1

selections:
  - key: "1"
    text: "Games"
    type: menu
    inline:
      title: "Games"
      statusbar: "Choose a game.  Q = back."
      columns: 2
      selections:
        - key: "1"
          text: "Meteoroid"
          type: game
          target: meteoroid
        - key: "2"
          text: "Tetris"
          type: game
          target: tetris
        - key: "q"
          text: "Back"
          type: action
          target: back

  - key: "2"
    text: "Utilities"
    type: menu
    target: utils          # loads config/menus/utils.yaml

  - key: "q"
    text: "Goodbye"
    type: action
    target: exit
```

---

### ANSI art top menu

```yaml
title: "GALACTIC BBS"
statusbar: "Press a number key to select."
ansifile: "art/galactic_top.ans"   # art has numbered labels baked in

selections:
  - key: "1"
    text: "Meteoroid"    # text is unused for display in ansifile mode
    type: game
    target: meteoroid
  - key: "2"
    text: "Tetris"
    type: game
    target: tetris
  - key: "q"
    text: "Goodbye"
    type: action
    target: exit
```

---

### ANSI art as underlay (art + standard nav)

```yaml
title: "GALACTIC BBS"
statusbar: "Use arrows to select, Enter to confirm."
underlay: "art/galactic_bg.ans"    # drawn behind items, not instead of them
columns: 1

colors:
  normal_bg:   BLACK    # keep item backgrounds solid so text is readable
  selected_bg: BLUE

selections:
  - key: "1"
    text: "Meteoroid"
    type: game
    target: meteoroid
  - key: "q"
    text: "Goodbye"
    type: action
    target: exit
```

---

## Adding `js-yaml`

The menu loader requires `js-yaml` for full YAML support (inline nesting,
colour blocks).  If it is not installed, a minimal built-in parser is used that
handles the simple flat format produced by auto-generation, but will not parse
inline nested menus or colour blocks.

Install it:

```bash
npm install js-yaml
```

Add it to `package.json` dependencies:

```json
"dependencies": {
  "js-yaml": "^4.1.0"
}
```

---

## Extension Notes for Developers

The schema and renderer are designed to be extended without breaking existing
menu files:

- **New colour keys** can be added to the `colors` block at any time.  The
  loader preserves all recognised colour keys; unrecognised keys are silently
  ignored.
- **New selection types** (e.g. `door`, `url`, `command`) can be added by
  extending `MenuSession._handleSelection()`.  The loader preserves unknown
  types and stores unrecognised selection fields in `sel._extra`.
- **Per-item hotspot coordinates** for ANSI art menus: add `x` and `y` fields
  to a selection.  They will be stored in `sel._extra.x` / `sel._extra.y` and
  can be read by the renderer when positioning highlighted items over art.
- **Live reload**: call `loader.clearCache()` and then `loader.load('top')` to
  reload menus without restarting the server.  A future admin command could
  expose this.
- **Underlay hotspot mode**: when `underlay` is set and selections have `x`/`y`
  fields, the renderer can position individual items at specific screen coordinates
  instead of using auto-layout.  The plumbing for this is in place (coordinates
  survive in `_extra`); the renderer needs a mode branch to use them.
