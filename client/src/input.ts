// Unified input: keyboard + mouse (pointer lock), gamepad, and multi-touch virtual controls.
export type Action = 'interact' | 'alt' | 'drop' | 'ping' | 'menu' | 'quick' | 'shop' | 'ready' | 'tab' | 'grab' | 'spin' | 'ultimate' | 'hit'
  | 'q1' | 'q2' | 'q3' | 'q4' | 'q5' | 'q6';

export class Input {
  move = { x: 0, y: 0 };
  run = false;
  lookDX = 0; lookDY = 0;
  enabled = true;
  usingGamepad = false;
  private keys = new Set<string>();
  private pressed = new Set<Action>();
  private touchRunToggle = false;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private padPrev: boolean[] = [];
  holdInteract = false;
  private lockAt = 0;
  /** The page isn't allowed to capture the mouse (e.g. shown inside another site's frame): look by dragging instead. */
  lockBlocked = false;

  constructor(private canvas: HTMLCanvasElement, public touch: boolean) {
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); });
    canvas.addEventListener('mousedown', e => {
      if (this.touch) return;
      if (!this.locked && !this.lockBlocked) { if (this.enabled) this.lock(); return; }
      if (e.button === 0) { this.pressed.add('interact'); this.holdInteract = true; }
      if (e.button === 2) this.pressed.add('alt');
      if (e.button === 1) { this.pressed.add('ping'); e.preventDefault(); }
    });
    window.addEventListener('mouseup', e => { if (e.button === 0) this.holdInteract = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.lockAt = performance.now(); });
    document.addEventListener('pointerlockerror', () => { this.lockBlocked = true; });
    document.addEventListener('mousemove', e => {
      if (!this.enabled) return;
      if (!this.locked) {
        // fallback: hold a mouse button and drag to look around
        if (this.lockBlocked && e.buttons !== 0 && Math.abs(e.movementX) < 250 && Math.abs(e.movementY) < 250) { this.lookDX += e.movementX; this.lookDY += e.movementY; }
        return;
      }
      // Browsers can report one huge jump right after pointer lock engages; drop it.
      if (performance.now() - this.lockAt < 150 || Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
      this.lookDX += e.movementX; this.lookDY += e.movementY;
    });
    if (touch) this.setupTouch();
  }

  get locked() { return document.pointerLockElement === this.canvas; }
  lock() { if (!this.touch && !this.lockBlocked) { try { const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined; r?.catch?.(() => { this.lockBlocked = true; }); } catch { this.lockBlocked = true; } } }
  unlock() { if (this.locked) document.exitPointerLock(); }

  private onKey(e: KeyboardEvent, down: boolean) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = e.code;
    if (down) {
      if (!this.keys.has(k)) {
        const map: Record<string, Action> = {
          KeyE: 'interact', KeyF: 'alt', KeyG: 'drop', KeyV: 'ping', Escape: 'menu', KeyP: 'menu', KeyT: 'quick', KeyB: 'shop', Enter: 'ready', Tab: 'tab',
          Space: 'grab', KeyQ: 'spin', KeyR: 'ultimate', KeyX: 'hit',
          Digit1: 'q1', Digit2: 'q2', Digit3: 'q3', Digit4: 'q4', Digit5: 'q5', Digit6: 'q6',
        };
        const a = map[k];
        if (a) { this.pressed.add(a); if (k === 'Tab' || k === 'Space') e.preventDefault(); }
        if (k === 'KeyE') this.holdInteract = true;
      }
      this.keys.add(k);
      this.usingGamepad = false;
    } else {
      this.keys.delete(k);
      if (k === 'KeyE') this.holdInteract = false;
    }
  }

  private setupTouch() {
    const left = document.getElementById('t-left')!;
    const right = document.getElementById('t-right')!;
    const stick = document.getElementById('t-stick')!;
    const knob = document.getElementById('t-knob')!;
    const R = 55;
    left.addEventListener('pointerdown', e => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId; this.stickOrigin = { x: e.clientX, y: e.clientY };
      left.setPointerCapture(e.pointerId);
      stick.classList.remove('hidden'); stick.style.left = e.clientX + 'px'; stick.style.top = e.clientY + 'px';
      knob.style.transform = 'translate(0px,0px)';
    });
    left.addEventListener('pointermove', e => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.stickOrigin.x, dy = e.clientY - this.stickOrigin.y;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      this.stickVec = { x: dx / R, y: -dy / R };
      knob.style.transform = `translate(${dx}px,${dy}px)`;
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null; this.stickVec = { x: 0, y: 0 }; stick.classList.add('hidden');
    };
    left.addEventListener('pointerup', endStick); left.addEventListener('pointercancel', endStick);
    right.addEventListener('pointerdown', e => {
      if (this.lookId !== null) return;
      this.lookId = e.pointerId; this.lookLast = { x: e.clientX, y: e.clientY };
      right.setPointerCapture(e.pointerId);
    });
    right.addEventListener('pointermove', e => {
      if (e.pointerId !== this.lookId || !this.enabled) return;
      this.lookDX += (e.clientX - this.lookLast.x) * 1.6; this.lookDY += (e.clientY - this.lookLast.y) * 1.6;
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e: PointerEvent) => { if (e.pointerId === this.lookId) this.lookId = null; };
    right.addEventListener('pointerup', endLook); right.addEventListener('pointercancel', endLook);

    const bind = (id: string, a: Action | 'run') => {
      const el = document.getElementById(id)!;
      el.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        if (a === 'run') { this.touchRunToggle = !this.touchRunToggle; el.classList.toggle('active', this.touchRunToggle); return; }
        this.pressed.add(a);
        if (a === 'interact') this.holdInteract = true;
        el.classList.add('active');
      });
      const up = () => { el.classList.remove('active'); if (a === 'interact') this.holdInteract = false; if (a === 'run') el.classList.toggle('active', this.touchRunToggle); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    };
    bind('t-interact', 'interact'); bind('t-item', 'drop'); bind('t-alt', 'alt'); bind('t-run', 'run');
    bind('t-ping', 'ping'); bind('t-chat', 'quick'); bind('t-menu', 'menu'); bind('t-shop', 'shop');
    bind('t-grab', 'grab'); bind('t-spin', 'spin'); bind('t-ult', 'ultimate'); bind('t-hit', 'hit');
  }

  /** Call once per frame. dt in seconds. */
  update(dt: number) {
    let x = 0, y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    let run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (this.touch) { x += this.stickVec.x; y += this.stickVec.y; run = run || this.touchRunToggle || Math.hypot(this.stickVec.x, this.stickVec.y) > 0.97 && false; }
    // gamepad (standard mapping)
    const pads = navigator.getGamepads?.() ?? [];
    const gp = [...pads].find(p => p && p.connected);
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      const lx = dz(gp.axes[0] ?? 0), ly = dz(gp.axes[1] ?? 0), rx = dz(gp.axes[2] ?? 0), ry = dz(gp.axes[3] ?? 0);
      if (lx || ly || rx || ry) this.usingGamepad = true;
      x += lx; y -= ly;
      this.lookDX += rx * 900 * dt; this.lookDY += ry * 700 * dt;
      const b = gp.buttons.map(bt => bt.pressed);
      const edge = (i: number, a: Action) => { if (b[i] && !this.padPrev[i]) { this.pressed.add(a); this.usingGamepad = true; } };
      edge(0, 'interact'); edge(1, 'drop'); edge(2, 'alt'); edge(3, 'grab'); edge(5, 'spin'); edge(4, 'ultimate'); edge(7, 'hit'); edge(9, 'menu'); edge(8, 'quick');
      edge(12, 'ping'); edge(13, 'shop'); edge(15, 'ready');
      if (b[0]) this.holdInteract = true; else if (this.padPrev[0]) this.holdInteract = false;
      run = run || !!b[10] || !!b[6];
      this.padPrev = b;
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.move = this.enabled ? { x, y } : { x: 0, y: 0 };
    this.run = run;
  }

  consume(a: Action) { const had = this.pressed.has(a); this.pressed.delete(a); return had; }
  clearPresses() { this.pressed.clear(); this.lookDX = 0; this.lookDY = 0; }
  takeLook() { const r = { dx: this.lookDX, dy: this.lookDY }; this.lookDX = 0; this.lookDY = 0; return r; }
}
