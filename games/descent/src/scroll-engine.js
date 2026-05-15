'use strict';

/**
 * scroll-engine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ScrollEngine — Hardware-accelerated vertical scrolling for SynthDoor games.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CORE ABSTRACTION: SIMULATION SPACE vs DISPLAY SPACE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The game runs in SIMULATION SPACE. The engine translates to DISPLAY SPACE.
 *
 * SIMULATION SPACE
 *   - Fixed coordinate grid. Objects have integer (simCol, simRow) positions.
 *   - simRow=0 is the "top" of the play area; simRow=rows-1 is the bottom.
 *   - Coordinates never shift. When the scroll advances, the collision terrain
 *     shifts in display space, but the game's coordinate system stays fixed.
 *   - The game is unaware of terminal rows, scroll offset, ghost tracking,
 *     or any rendering concern. It just maintains object positions and calls
 *     engine.collision(simCol, simRow) to check terrain.
 *   - Simulation can run at any rate. It is correct regardless of render rate.
 *
 * DISPLAY SPACE
 *   - Terminal rows 1..rows. Shifted by the scroll offset.
 *   - The engine maintains scrollOffset (how many rows have scrolled so far).
 *   - To convert: termRow = simRow - scrollOffset + rows
 *     (objects near simRow=0 appear near the top of screen after many scrolls)
 *   - The engine draws everything; the game never writes to the terminal.
 *
 * WHY THIS SOLVES THE COLLISION PROBLEM
 *   Previously: player col/row were terminal coordinates. When the scroll
 *   shifted the collision map, the player could be "inside" a wall in map
 *   space while appearing fine in terminal space. The two coordinate systems
 *   were conflated.
 *   Now: player col/row are simulation coordinates. The collision map is also
 *   indexed by simulation coordinates (via scrollOffset). A wall at sim row R
 *   is always at sim row R regardless of how much has scrolled. No desync.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW SIMULATION COORDINATES WORK WITH SCROLLING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Think of the world as an infinite vertical strip scrolling past a viewport.
 * The viewport shows rows (scrollOffset)..(scrollOffset + rows - 1) of the
 * world. As the game progresses, scrollOffset increases by 1 each scroll tick.
 *
 * The collision map is a ring buffer of `rows` entries. Entry [i] holds the
 * terrain for world row (scrollOffset + i). When a scroll fires:
 *   - scrollOffset++
 *   - collisionMap shifts (old top row falls off, new bottom row added)
 *   - A NEW row of terrain is generated for the new bottom
 *
 * An object at simRow R is on screen when:
 *   scrollOffset <= R < scrollOffset + rows
 * Its terminal row is: R - scrollOffset + 1  (1-based)
 *
 * The game creates objects at a simRow in the current bottom of the viewport
 * (scrollOffset + rows - 1) so they appear at the bottom of the screen.
 * As scrollOffset increases each scroll tick, all objects' VISUAL positions
 * rise — but their simRow is fixed. The engine handles the display mapping.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * GHOST TRACKING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The engine tracks where it drew each object last render cycle (_lastDrawn).
 * On the next render, it first erases every previously-drawn position (by
 * repainting background), then draws objects at their new positions.
 * The game is completely unaware of this. It just says "player at col 40, row 5".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DIVISORS — all in same units: simulation ticks between updates
 * ═══════════════════════════════════════════════════════════════════════════
 *   SCROLL_DIVISOR — sim ticks between scroll ticks
 *   RENDER_DIVISOR — sim ticks between render frames (objects + HUD)
 *   HUD_DIVISOR    — sim ticks between HUD content rebuilds
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ENTITY INTERFACE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * All entities have:
 *   simCol: number   — simulation column (0-based, 0=left inner edge)
 *   simRow: number   — simulation row (absolute world row)
 *   sprite: [{dx, dy, ch, colorCode}]  — plain chars + ANSI color
 *   state:  ENTITY_STATE
 *   id:     number   — assigned by engine
 *
 * Scroll entities live in sim space. Their simRow is fixed; as scrollOffset
 * increases they visually rise until they scroll off the top.
 * Overlay entities (player, bullets) also use simRow but are drawn relative
 * to the viewport: they stay visually fixed as long as the game keeps their
 * simRow updated to compensate for scroll. OR — simpler — overlay entities
 * use a VIEWPORT-RELATIVE row (0=top of screen) stored in simRow, and the
 * engine treats them differently from scroll entities.
 *
 * SIMPLER MODEL USED HERE:
 * Overlay objects store their position as viewport rows (1-based, like terminal
 * rows) in .row/.col. The engine draws them at exactly those coordinates.
 * Scroll objects store absolute sim rows in .simRow/.simCol. The engine
 * converts simRow to termRow = simRow - scrollOffset + 1.
 * The game uses engine.getCollisionAtSim(simCol, simRow) for terrain,
 * and engine.getBottomSimRow() to get where to spawn new scroll objects.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * write() vs writeRaw() — ALWAYS SEPARATED
 * ═══════════════════════════════════════════════════════════════════════════
 *   write(str)    — CP437 encoder. Plain content characters only.
 *   writeRaw(str) — Raw bytes. ANSI escape sequences only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const LAYER = {
  EMPTY:              0,
  SCROLL_BACKGROUND:  1,
  SCROLL_ENVIRONMENT: 2,
  SCROLL_OBJECT:      3,
  OVERLAY_HUD:        4,
  OVERLAY_OBJECT:     5,
};

const ENTITY_STATE = {
  SCROLL:  'scroll',
  OVERLAY: 'overlay',
  DEAD:    'dead',
};

class ScrollEngine {
  /**
   * @param {Terminal} terminal
   * @param {object}   opts
   * @param {number}   [opts.rows=24]
   * @param {number}   [opts.totalWidth=79]
   * @param {boolean}  [opts.borderCols=false]
   * @param {string}   [opts.borderChar='\u2551']
   * @param {string}   [opts.borderColor='\x1b[0;34m']
   * @param {number}   [opts.scrollDivisor=1]   sim ticks per scroll tick
   * @param {number}   [opts.renderDivisor=2]   sim ticks per render frame
   * @param {number}   [opts.hudDivisor=20]      sim ticks per HUD rebuild
   * @param {Function} opts.rowGenerator   (innerWidth, scrollTick, engine) => {chars, colorCode, environment}
   * @param {string}   [opts.defaultBg='\x1b[0m']
   */
  constructor(terminal, opts = {}) {
    this.terminal      = terminal;
    this.rows          = opts.rows          ?? 24;
    this.totalWidth    = opts.totalWidth    ?? 79;
    this.borderCols    = opts.borderCols    ?? false;
    this.borderChar    = opts.borderChar    ?? '\u2551';
    this.borderColor   = opts.borderColor   ?? '\x1b[0;34m';
    this.scrollDivisor = Math.max(1, Math.floor(opts.scrollDivisor ?? 1));
    this.renderDivisor = Math.max(1, Math.floor(opts.renderDivisor ?? 2));
    this.hudDivisor    = Math.max(1, Math.floor(opts.hudDivisor    ?? 20));
    this.rowGenerator  = opts.rowGenerator  ?? (() => this._emptyRow());
    this.defaultBg     = opts.defaultBg     ?? '\x1b[0m';

    this.innerWidth     = this.borderCols ? this.totalWidth - 2 : this.totalWidth;
    this._innerColStart = this.borderCols ? 2 : 1;
    this._innerColEnd   = this._innerColStart + this.innerWidth - 1;

    // scrollOffset: how many scroll ticks have fired.
    // Sim row R is on screen when scrollOffset <= R < scrollOffset + rows.
    // Terminal row = R - scrollOffset + 1
    this.scrollOffset = 0;

    // scrollMap[i]: terrain row for world row (scrollOffset + i)
    // { chars[], colorCode, environment[] }
    this.scrollMap    = [];
    // collisionMap[i][c]: LAYER value for sim row (scrollOffset+i), inner col c
    this.collisionMap = [];

    // Entities
    this.scrollObjects  = [];  // live in sim space, visual position derived from scrollOffset
    this.overlayObjects = [];  // live in viewport space (.row/.col = terminal row/col 1-based)

    // HUD lines: Map<termRow, { str, colorCode, _prev }>
    this.hudLines = new Map();

    // Last drawn positions — engine tracks this, game never needs to
    // _lastDrawn: Map<entityId, [{termRow, termCol}]>
    this._lastDrawn   = new Map();
    this._nextId      = 1;

    this._simTick     = 0;
    this._scrollTick  = 0;
    this._didScrollThisFrame = false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  init(clearScreen = true) {
    if (clearScreen) {
      this.terminal.writeRaw('\x1b[?25l');
      this.terminal.writeRaw('\x1b[0m');
      this.terminal.clearScreen();
    }

    this.scrollOffset = 0;
    this.scrollMap    = [];
    this.collisionMap = [];

    for (let r = 0; r < this.rows; r++) {
      this.scrollMap.push(this._emptyRow());
      this.collisionMap.push(new Array(this.innerWidth).fill(LAYER.EMPTY));
    }

    for (let r = 0; r < this.rows; r++) {
      this._writeFullRow(r + 1, this.scrollMap[r]);
    }

    return this;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SIMULATION TICK — advance physics, maybe scroll, maybe render
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * tick()
   * ──────
   * Advance one simulation tick. The game calls this once per sim step.
   * The engine internally decides when to scroll and when to render.
   *
   * Returns { scrolled, rendered } so the game can know what happened,
   * but the game should not need to react to these for simulation purposes —
   * only for bookkeeping (e.g. incrementing score on scroll).
   */
  tick() {
    this._simTick++;
    this._didScrollThisFrame = false;

    // ── Scroll ──────────────────────────────────────────────────────────────
    if (this._simTick % this.scrollDivisor === 0) {
      this._doScroll();
    }

    // ── Render ──────────────────────────────────────────────────────────────
    const doRender = (this._simTick % this.renderDivisor === 0);
    const doHUD    = (this._simTick % this.hudDivisor === 0);

    if (doRender || this._didScrollThisFrame) {
      this._render(doHUD);
    }

    return { scrolled: this._didScrollThisFrame, rendered: doRender };
  }

  /**
   * _doScroll()
   * ────────────
   * Fire one hardware scroll tick internally.
   */
  _doScroll() {
    const rowData = this.rowGenerator(this.innerWidth, this._scrollTick, this);

    // Write new bottom row + trigger hardware scroll
    this.terminal.writeRaw(`\x1b[${this.rows + 1};1H${rowData.colorCode || this.defaultBg}`);
    this.terminal.write(this._buildContentString(rowData.chars));
    this.terminal.writeRaw('\r\n');

    // Advance scrollOffset
    this.scrollOffset++;

    // Shift maps
    this.scrollMap.shift();
    this.scrollMap.push(rowData);
    this.collisionMap.shift();

    const envRow = new Array(this.innerWidth).fill(LAYER.EMPTY);
    if (rowData.environment) {
      for (let x = 0; x < this.innerWidth; x++) {
        envRow[x] = rowData.environment[x] ?? LAYER.EMPTY;
      }
    }
    this.collisionMap.push(envRow);

    // Re-stamp scroll objects
    for (const obj of this.scrollObjects) {
      if (obj.state !== ENTITY_STATE.DEAD) this._stampToMap(obj, LAYER.SCROLL_OBJECT);
    }

    this._scrollTick++;
    this._didScrollThisFrame = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER — owned entirely by the engine
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * _render(doHUD)
   * ──────────────
   * The engine reads current entity positions and redraws the screen.
   * Erases previous positions, draws new positions, updates HUD.
   * The game never calls this — it happens automatically inside tick().
   */
  _render(doHUD) {
    // 1. Erase all previously drawn entity positions
    //    After a scroll, all previous draw positions shifted up by 1.
    //    We erase at (prevTermRow - scrollDelta) where scrollDelta is 1 if
    //    scroll just fired, 0 otherwise. Simpler: always erase at the
    //    position that was drawn, adjusted for scroll shift.
    this._eraseAll();

    // 2. Draw scroll objects at their current sim-to-terminal mapped positions
    this._drawScrollObjects();

    // 3. Draw overlay objects at their viewport positions
    this._drawOverlayObjects();

    // 4. HUD
    if (doHUD || this._didScrollThisFrame) this._drawOverlayHUD();
  }

  /**
   * _eraseAll()
   * ────────────
   * Erase every cell that was drawn last render cycle.
   * If a scroll happened since last render, each ghost is 1 row higher
   * (terminal row decreased by 1 due to hardware scroll).
   * The engine adjusts for this automatically.
   */
  _eraseAll() {
    if (this._lastDrawn.size === 0) return;

    // How many scroll ticks fired since last render?
    // We track this as _scrollsSinceLastRender
    const shift = this._scrollsSinceRender || 0;

    for (const [id, cells] of this._lastDrawn) {
      for (const cell of cells) {
        const ghostRow = cell.termRow - shift;
        if (ghostRow < 1 || ghostRow > this.rows) continue;

        // What background should be here?
        const mapRow = ghostRow - 1;
        const bgColor = this.scrollMap[mapRow]?.colorCode || this.defaultBg;
        let   bgChar;

        // Border column?
        if (this.borderCols && (cell.termCol === 1 || cell.termCol === this.totalWidth)) {
          bgChar = this.borderChar;
          this.terminal.writeRaw(`\x1b[${ghostRow};${cell.termCol}H${this.borderColor}`);
        } else {
          const mapCol = cell.termCol - this._innerColStart;
          bgChar = this.scrollMap[mapRow]?.chars?.[mapCol] || ' ';
          this.terminal.writeRaw(`\x1b[${ghostRow};${cell.termCol}H${bgColor}`);
        }
        this.terminal.write(bgChar);
      }
    }

    this._lastDrawn.clear();
    this._scrollsSinceRender = 0;
  }

  /**
   * _drawScrollObjects()
   * ─────────────────────
   * Draw all live scroll objects. Map their simRow to terminal row.
   * simRow→termRow: termRow = simRow - scrollOffset + 1
   * Objects off-screen (termRow < 1 or > rows) are skipped.
   * Objects with termRow < 1 have scrolled off the top → mark dead.
   */
  _drawScrollObjects() {
    for (const obj of this.scrollObjects) {
      if (obj.state === ENTITY_STATE.DEAD) continue;

      const termRow = obj.simRow - this.scrollOffset + 1;
      const termCol = obj.simCol + this._innerColStart;

      if (termRow < 1) { obj.state = ENTITY_STATE.DEAD; continue; }
      if (termRow > this.rows) continue;

      const drawn = [];
      for (const cell of obj.sprite) {
        const r = termRow + (cell.dy || 0);
        const c = termCol + (cell.dx || 0);
        if (r < 1 || r > this.rows || c < this._innerColStart || c > this._innerColEnd) continue;
        this.terminal.writeRaw(`\x1b[${r};${c}H${cell.colorCode || this.defaultBg}`);
        this.terminal.write(cell.ch);
        drawn.push({ termRow: r, termCol: c });
      }
      if (drawn.length) this._lastDrawn.set(obj.id, drawn);
    }
  }

  /**
   * _drawOverlayObjects()
   * ──────────────────────
   * Draw all live overlay objects at their .row/.col (viewport coordinates).
   */
  _drawOverlayObjects() {
    for (const obj of this.overlayObjects) {
      if (obj.state === ENTITY_STATE.DEAD) continue;

      const drawn = [];
      for (const cell of obj.sprite) {
        const r = obj.row + (cell.dy || 0);
        const c = obj.col + (cell.dx || 0);
        if (r < 1 || r > this.rows || c < 1 || c > this.totalWidth) continue;
        this.terminal.writeRaw(`\x1b[${r};${c}H${cell.colorCode || this.defaultBg}`);
        this.terminal.write(cell.ch);
        drawn.push({ termRow: r, termCol: c });
      }
      if (drawn.length) this._lastDrawn.set(obj.id, drawn);
    }
  }

  /**
   * _drawOverlayHUD()
   * ──────────────────
   * Delta-render HUD. After a scroll, forces full redraw of row 1.
   */
  _drawOverlayHUD() {
    for (const [row, line] of this.hudLines) {
      const next = line.str;
      const prev = line._prev;

      if (this._didScrollThisFrame || prev === null) {
        this.terminal.writeRaw(`\x1b[${row};1H${line.colorCode || this.defaultBg}`);
        this.terminal.write(next);
        line._prev = next;
        continue;
      }
      if (next === prev) continue;

      // Delta: only changed spans
      const len = Math.max(next.length, prev.length);
      let i = 0;
      while (i < len) {
        const nc = i < next.length ? next[i] : ' ';
        const pc = i < prev.length ? prev[i] : ' ';
        if (nc === pc) { i++; continue; }
        const spanStart = i;
        let span = '';
        while (i < len) {
          const nc2 = i < next.length ? next[i] : ' ';
          const pc2 = i < prev.length ? prev[i] : ' ';
          if (nc2 === pc2) break;
          span += nc2; i++;
        }
        this.terminal.writeRaw(`\x1b[${row};${1 + spanStart}H${line.colorCode || this.defaultBg}`);
        this.terminal.write(span);
      }
      line._prev = next;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COLLISION — in simulation space
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * getCollisionAt(simCol, simRow)
   * ───────────────────────────────
   * Query terrain collision at simulation coordinates.
   * simCol: 0-based column within the play area
   * simRow: absolute world row (same space as entity.simRow)
   *
   * Returns LAYER constant. Out-of-bounds simCol → SCROLL_ENVIRONMENT (wall).
   * simRow outside current viewport → LAYER.EMPTY.
   */
  getCollisionAt(simCol, simRow) {
    const mapIdx = simRow - this.scrollOffset;
    if (mapIdx < 0 || mapIdx >= this.rows)     return LAYER.EMPTY;
    if (simCol < 0 || simCol >= this.innerWidth) return LAYER.SCROLL_ENVIRONMENT;
    return this.collisionMap[mapIdx]?.[simCol] ?? LAYER.EMPTY;
  }

  /**
   * getCollisionAtViewport(col, row)
   * ─────────────────────────────────
   * Query collision using viewport coordinates (1-based terminal row/col).
   * For overlay objects (player, bullets) whose position is in viewport space.
   * col: 1-based terminal column
   * row: 1-based terminal row
   */
  getCollisionAtViewport(col, row) {
    const simCol = col - this._innerColStart;
    const simRow = this.scrollOffset + (row - 1);
    return this.getCollisionAt(simCol, simRow);
  }

  /**
   * entityAtViewport(col, row)
   * ────────────────────────────
   * Return the live SCROLL_OBJECT whose simRow maps to the given viewport row,
   * at the given viewport column. Returns null if none found.
   */
  entityAtViewport(col, row) {
    const simCol = col - this._innerColStart;
    const simRow = this.scrollOffset + (row - 1);
    const mapIdx = row - 1;
    if (mapIdx < 0 || mapIdx >= this.rows) return null;
    if (this.collisionMap[mapIdx]?.[simCol] !== LAYER.SCROLL_OBJECT) return null;
    for (const obj of this.scrollObjects) {
      if (obj.state !== ENTITY_STATE.DEAD &&
          obj.simCol === simCol && obj.simRow === simRow) return obj;
    }
    return null;
  }

  /**
   * getBottomSimRow()
   * ─────────────────
   * Returns the simulation row corresponding to the bottom of the screen.
   * Use this to spawn new scroll objects so they appear at the bottom.
   */
  getBottomSimRow() {
    return this.scrollOffset + this.rows - 1;
  }

  /**
   * getViewportCol(simCol)
   * getViewportRow(simRow)
   * Convert sim coords back to viewport coords (for game logic that needs it).
   */
  getViewportCol(simCol) { return simCol + this._innerColStart; }
  getViewportRow(simRow) { return simRow - this.scrollOffset + 1; }

  // ═══════════════════════════════════════════════════════════════════════════
  // ENTITY MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * addScrollObject(entity)
   * ────────────────────────
   * Register an entity that lives in sim space.
   * entity must have: { simCol, simRow, sprite, hitbox? }
   * Engine assigns entity.id and entity.state.
   *
   * simCol: 0-based inner play column
   * simRow: absolute world row — use engine.getBottomSimRow() for bottom spawn
   */
  addScrollObject(entity) {
    entity.id    = this._nextId++;
    entity.state = ENTITY_STATE.SCROLL;
    this.scrollObjects.push(entity);
    this._stampToMap(entity, LAYER.SCROLL_OBJECT);
    return entity;
  }

  /**
   * addOverlayObject(entity)
   * ─────────────────────────
   * Register an entity that lives in viewport space.
   * entity must have: { col, row, sprite, hitbox? }
   * col/row are 1-based terminal coordinates (viewport space, never scroll-shifted).
   */
  addOverlayObject(entity) {
    entity.id    = this._nextId++;
    entity.state = ENTITY_STATE.OVERLAY;
    this.overlayObjects.push(entity);
    return entity;
  }

  /**
   * promoteToOverlay(entity)
   * ─────────────────────────
   * Convert a scroll object to an overlay object.
   * Calculates current viewport row from simRow and scrollOffset.
   */
  promoteToOverlay(entity) {
    const idx = this.scrollObjects.indexOf(entity);
    if (idx === -1) return;
    entity.col   = entity.simCol + this._innerColStart;
    entity.row   = entity.simRow - this.scrollOffset + 1;
    entity.state = ENTITY_STATE.OVERLAY;
    this.scrollObjects.splice(idx, 1);
    this._clearFromMap(entity);
    this.overlayObjects.push(entity);
  }

  /**
   * killScrollObject(entity)
   * ─────────────────────────
   * Mark a scroll object dead and immediately clear its collision map cell.
   */
  killScrollObject(entity) {
    entity.state = ENTITY_STATE.DEAD;
    this._clearFromMap(entity);
  }

  removeDeadEntities() {
    this.scrollObjects  = this.scrollObjects.filter(e => e.state !== ENTITY_STATE.DEAD);
    this.overlayObjects = this.overlayObjects.filter(e => e.state !== ENTITY_STATE.DEAD);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HUD
  // ═══════════════════════════════════════════════════════════════════════════

  setHUDLine(row, str, colorCode) {
    const existing = this.hudLines.get(row);
    if (existing) {
      existing.str       = str;
      existing.colorCode = colorCode;
    } else {
      this.hudLines.set(row, { str, colorCode, _prev: null });
    }
  }

  clearHUD() { this.hudLines.clear(); }

  // ═══════════════════════════════════════════════════════════════════════════
  // DIVISOR CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  setScrollDivisor(d) { this.scrollDivisor = Math.max(1, Math.floor(d)); }
  setRenderDivisor(d) { this.renderDivisor = Math.max(1, Math.floor(d)); }
  setHudDivisor(d)    { this.hudDivisor    = Math.max(1, Math.floor(d)); }

  destroy() {
    this.terminal.writeRaw('\x1b[?25h');
    this.terminal.writeRaw('\x1b[0m');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  _emptyRow() {
    return {
      chars:       new Array(this.innerWidth).fill(' '),
      colorCode:   this.defaultBg,
      environment: new Array(this.innerWidth).fill(LAYER.EMPTY),
    };
  }

  _buildContentString(chars) {
    const inner = chars.join('').substring(0, this.innerWidth);
    return this.borderCols ? this.borderChar + inner + this.borderChar : inner;
  }

  _writeFullRow(termRow, rowData) {
    this.terminal.writeRaw(`\x1b[${termRow};1H`);
    if (this.borderCols) {
      this.terminal.writeRaw(this.borderColor);
      this.terminal.write(this.borderChar);
      this.terminal.writeRaw(rowData.colorCode || this.defaultBg);
      this.terminal.write(rowData.chars.join('').substring(0, this.innerWidth));
      this.terminal.writeRaw(this.borderColor);
      this.terminal.write(this.borderChar);
    } else {
      this.terminal.writeRaw(rowData.colorCode || this.defaultBg);
      this.terminal.write(rowData.chars.join('').substring(0, this.innerWidth));
    }
  }

  _stampToMap(entity, layer) {
    const cells = entity.hitbox || entity.sprite;
    for (const c of cells) {
      const mc = entity.simCol + (c.dx || 0);
      const mr = entity.simRow - this.scrollOffset;  // index into collisionMap
      const my = mr + (c.dy || 0);
      if (my >= 0 && my < this.rows && mc >= 0 && mc < this.innerWidth) {
        if (!this.collisionMap[my]) this.collisionMap[my] = [];
        this.collisionMap[my][mc] = layer;
      }
    }
  }

  _clearFromMap(entity) {
    const cells = entity.hitbox || entity.sprite;
    for (const c of cells) {
      const mc = entity.simCol + (c.dx || 0);
      const mr = entity.simRow - this.scrollOffset;
      const my = mr + (c.dy || 0);
      if (my >= 0 && my < this.rows && mc >= 0 && mc < this.innerWidth) {
        if (this.collisionMap[my]) this.collisionMap[my][mc] = LAYER.EMPTY;
      }
    }
  }
}

// Track scroll count between renders in _doScroll
const _origDoScroll = ScrollEngine.prototype._doScroll;
ScrollEngine.prototype._doScroll = function() {
  _origDoScroll.call(this);
  this._scrollsSinceRender = (this._scrollsSinceRender || 0) + 1;
};

module.exports = ScrollEngine;
module.exports.LAYER        = LAYER;
module.exports.ENTITY_STATE = ENTITY_STATE;
