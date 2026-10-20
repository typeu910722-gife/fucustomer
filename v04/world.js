/* BYE KARENS! 0.3 — dependency-free simulation; coordinates in metres. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const EXIT = Object.freeze({ x1: 11.65, x2: 15.65, z: 13.25, x: 13.65 });
  const FIXTURES = Object.freeze([
    { x: 4.5, z: 4.3, w: 2.7, d: 1.35, h: 1.65, kind: 'shelf' },
    { x: 8.6, z: 4.3, w: 2.7, d: 1.35, h: 1.65, kind: 'shelf' },
    { x: 4.5, z: 7.8, w: 2.7, d: 1.35, h: 1.65, kind: 'shelf' },
    { x: 8.6, z: 7.8, w: 2.7, d: 1.35, h: 1.65, kind: 'shelf' },
    { x: 16.95, z: 5.8, w: 1.25, d: 8.9, h: 2.65, kind: 'fridge' },
    { x: 3.4, z: 10.9, w: 4.9, d: 1.1, h: 1.1, kind: 'counter' },
    { x: 1.1, z: 4.3, w: 1.2, d: 3.9, h: 1.25, kind: 'coffee' },
    { x: 13.7, z: 1.05, w: 3.2, d: .9, h: 1.15, kind: 'prep' },
    { x: 16.9, z: 11.7, w: .75, d: .75, h: .7, kind: 'delivery' }
  ]);
  const WAYPOINTS = [
    [2.2, 2], [6.45, 2], [10.8, 2], [14, 2.1], [14, 5.8], [11.35, 6],
    [6.55, 6], [2.35, 6.5], [2.3, 8.9], [6.45, 9.6], [10.4, 9.65],
    [14, 9.8], [10.2, 11.8], [7.3, 11.8]
  ];
  function blocked(x, z, r = 0.25, y = 0) {
    if (x < r + 0.22 || x > 17.78 - r || z < r + 0.22 || z > 13.57 - r) return true;
    return FIXTURES.some(b => y < b.h && x > b.x - b.w / 2 - r && x < b.x + b.w / 2 + r && z > b.z - b.d / 2 - r && z < b.z + b.d / 2 + r);
  }
  function moveBody(body, dx, dz, radius = 0.25, y = 0) {
    // Substeps prevent tunnelling at low frame rates and during fast throws.
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.13));
    let hitX = false, hitZ = false;
    for (let i = 0; i < steps; i++) {
      if (!blocked(body.x + dx / steps, body.z, radius, y)) body.x += dx / steps; else hitX = true;
      if (!blocked(body.x, body.z + dz / steps, radius, y)) body.z += dz / steps; else hitZ = true;
    }
    return { hitX, hitZ };
  }
  function lineOfSight(a, b) {
    const n = Math.ceil(dist(a, b) / 0.16);
    for (let i = 1; i < n; i++) if (blocked(a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n, 0.02)) return false;
    return true;
  }
  // A small grid keeps customers on real aisles instead of walking through shelves.
  function pathTo(from, to) {
    const width = 36, height = 28;
    const ix = x => clamp(Math.floor(x * 2), 0, width - 1), iz = z => clamp(Math.floor(z * 2), 0, height - 1);
    const first = iz(from.z) * width + ix(from.x), goal = iz(to.z) * width + ix(to.x);
    const queue = [first], parent = new Int16Array(width * height).fill(-1);
    parent[first] = first;
    for (let qi = 0; qi < queue.length && parent[goal] === -1; qi++) {
      const v = queue[qi], x = v % width, z = Math.floor(v / width);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, next = nz * width + nx;
        if (nx < 0 || nz < 0 || nx >= width || nz >= height || parent[next] !== -1 || blocked((nx + .5) / 2, (nz + .5) / 2, .24)) continue;
        parent[next] = v; queue.push(next);
      }
    }
    if (parent[goal] === -1) return [];
    const path = [];
    for (let v = goal; v !== first; v = parent[v]) path.push({ x: (v % width + .5) / 2, z: (Math.floor(v / width) + .5) / 2 });
    path.reverse();
    path.push({ x: to.x, z: to.z });
    return path;
  }
  class World {
    constructor(seed = Date.now()) { this.seed = seed >>> 0; this.reset(); this.state = 'ready'; }
    random() { this.seed = (1664525 * this.seed + 1013904223) >>> 0; return this.seed / 4294967296; }
    reset() {
      this.state = 'playing'; this.time = 90; this.money = 0; this.chaos = 0; this.burst = 0;
      this.served = 0; this.ejected = 0; this.cool = 0; this.spawn = 4.8; this.elapsed = 0; this.nextId = 0;
      this.player = { x: 10.65, z: 11.2, yaw: 0, pitch: 0, bob: 0, moving: 0, stamina: 100 };
      this.customers = []; this.particles = []; this.rings = []; this.events = []; this.held = null;
      this.shake = 0; this.flash = 0; this.hit = 0; this.spin = 0; this.swing = 0; this.combo = 0; this.comboTime = 0;
      this.addCustomer(false, 10.6, 9.55, true);
      this.addCustomer(true, 13.1, 9.7, true);
      this.addCustomer(false, 6.5, 6.1);
      this.addCustomer(false, 11.3, 3);
      this.addCustomer(true, 2.4, 8.9);
      this.addCustomer(false, 14, 5.9);
      this.emit('hint', '綠色顧客按「服務」，紅色奧客抓起後往發光出口投擲。');
    }
    emit(type, text = '', at = null, value = 0) { this.events.push({ type, text, at: at ? { x: at.x, z: at.z, y: 2.1 + (at.y || 0) } : null, value }); }
    addCustomer(karen = this.random() < .4, x = 13.7, z = 12.3, stay = false) {
      const c = { id: ++this.nextId, x, z, y: 0, yaw: Math.PI, karen, state: 'walking', patience: karen ? 13 : 31,
        timer: 3.5, walk: this.random() * 6, wait: stay ? 10 : this.random() * 3, path: [], vx: 0, vz: 0, vy: 0,
        flying: 0, turn: 0, variant: Math.floor(this.random() * 4), phrase: Math.floor(this.random() * 4) };
      this.customers.push(c); return c;
    }
    target() {
      const p = this.player, fx = Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      return this.customers.filter(c => c !== this.held && c.state === 'walking' && !c.flying && dist(p, c) < 2.35)
        .map(c => ({ c, d: dist(p, c), dot: ((c.x - p.x) * fx + (c.z - p.z) * fz) / Math.max(.01, dist(p, c)) }))
        .filter(t => t.dot > .68 && lineOfSight(p, t.c)).sort((a, b) => (a.d - a.dot * 1.2) - (b.d - b.dot * 1.2))[0]?.c || null;
    }
    particlesAt(x, y, z, color, n = 20, power = 2) {
      for (let i = 0; i < n; i++) {
        const a = this.random() * TAU, speed = .7 + this.random() * power;
        this.particles.push({ x, y, z, vx: Math.sin(a) * speed, vz: Math.cos(a) * speed, vy: 1 + this.random() * 3,
          color, life: .6 + this.random() * .5, size: .025 + this.random() * .045, angle: this.random() * TAU });
      }
      if (this.particles.length > 240) this.particles.splice(0, this.particles.length - 240);
    }
    eject(c, ultimate = false) {
      if (c.state === 'removed') return;
      c.state = 'removed'; if (this.held === c) this.held = null;
      if (c.karen) {
        this.ejected++; this.chaos = clamp(this.chaos - 7, 0, 100); this.burst = clamp(this.burst + (ultimate ? 0 : 25), 0, 100);
        this.combo = this.comboTime > 0 ? this.combo + 1 : 1; this.comboTime = 5;
        this.emit('eject', this.combo > 1 ? `${this.combo} 連送！奧客退散！` : '奧客退散！', c);
        this.particlesAt(c.x, 1.2, Math.min(13.1, c.z), '#ffae5c', 32, 3);
      } else { this.chaos = clamp(this.chaos + 20, 0, 100); this.hit = .9; this.emit('mistake', '誤丟一般顧客！混亂 +20', c); }
      this.shake = .22;
    }
    action(name) {
      if (this.state !== 'playing') return;
      const p = this.player, c = this.target();
      if (name === 'serve') {
        if (!c) { this.emit('hint', '面向並靠近顧客，距離要在 2.3 公尺內。'); return; }
        if (this.held) { this.emit('hint', '先放開手上的顧客。'); return; }
        this.swing = .3;
        if (c.karen) { this.money += 5; this.chaos = clamp(this.chaos + 3, 0, 100); this.emit('serve', '忍耐服務 +$5 · 混亂 +3', c, 5); }
        else { this.money += 15; this.served++; this.chaos = clamp(this.chaos - 2, 0, 100); this.emit('serve', '+$15 謝謝，辛苦了！', c, 15); this.particlesAt(c.x, 1.2, c.z, '#79efc5', 18, 1); }
        c.state = 'leaving'; c.path = pathTo(c, { x: EXIT.x, z: 12.8 });
      }
      if (name === 'grab') {
        if (this.held) {
          const thrown = this.held; this.held = null;
          thrown.state = 'walking'; thrown.flying = 2.8; thrown.y = .62;
          const lift = clamp(p.pitch, -.25, .55);
          thrown.vx = Math.sin(p.yaw) * 11.5; thrown.vz = -Math.cos(p.yaw) * 11.5; thrown.vy = 3.6 + lift * 5;
          this.burst = clamp(this.burst + 4, 0, 100); this.swing = .5; this.shake = .17;
          this.emit('throw', '對準橘色發光出口，讓奧客飛出店外！', thrown);
          this.particlesAt(thrown.x, 1.1, thrown.z, '#ffffff', 10, 1.5);
        } else if (c) {
          this.held = c; c.state = 'held'; c.path = [];
          this.emit('grab', c.karen ? '抓到了！轉向發光出口，再按一次「投出」。' : '這是一般顧客；誤丟會增加混亂！', c);
        } else this.emit('hint', '準星對準身前的顧客，再按「抓／丟」。');
      }
      if (name === 'spin') {
        if (this.cool > 0) { this.emit('hint', `拖把旋風冷卻中，還需 ${Math.ceil(this.cool)} 秒。`); return; }
        this.cool = this.spinCooldown || 5; this.spin = .85; this.shake = .25; this.burst = clamp(this.burst + 12, 0, 100);
        this.rings.push({ x: p.x, z: p.z, r: .2, life: .8, color: '#7bf6e0' });
        let count = 0;
        for (const n of this.customers) if (n !== this.held && n.state === 'walking' && dist(n, p) < (this.spinRange || 3.2) && lineOfSight(p, n)) {
          const d = Math.max(.1, dist(n, p)); n.vx = (n.x - p.x) / d * 7; n.vz = (n.z - p.z) / d * 7; n.vy = 3.8; n.y = .3; n.flying = 1.8; count++;
          if (!n.karen) { this.chaos = clamp(this.chaos + 4, 0, 100); this.hit = .5; }
        }
        this.particlesAt(p.x, .4, p.z, '#73f5dd', 45, 4); this.emit('spin', count ? `拖把旋風！擊退 ${count} 位顧客。` : '拖把旋風！附近的顧客會被擊退。');
      }
      if (name === 'ultimate') {
        if (this.burst < 100) { this.emit('hint', '爆發值集滿 100 才能使出「全店退散」。'); return; }
        const targets = this.customers.filter(n => n.karen && n.state !== 'removed' && n.state !== 'leaving');
        if (!targets.length) { this.emit('hint', '店內沒有奧客，保留爆發值等待下一波。'); return; }
        this.burst = 0; this.flash = 1; this.shake = .65;
        targets.forEach(n => this.eject(n, true)); this.shake = .65;
        this.chaos = clamp(this.chaos - 15, 0, 100); this.rings.push({ x: p.x, z: p.z, r: .3, life: 1.5, color: '#ffbd7b' });
        this.emit('ultimate', '全 店 奧 客 退 散 ！');
      }
      if (this.chaos >= 100) this.finish();
    }
    finish() { if (this.state !== 'playing') return; this.state = 'ended'; this.won = this.money >= 150 && this.chaos < 100; this.held = null; this.emit('end', this.won ? '下班快樂！' : '這一班，還有進步空間。'); }
    step(dt, input = {}) {
      if (this.state !== 'playing') return;
      dt = clamp(dt, 0, .05); this.elapsed += dt; this.time = Math.max(0, this.time - dt);
      this.cool = Math.max(0, this.cool - dt); this.shake = Math.max(0, this.shake - dt); this.flash = Math.max(0, this.flash - dt * 1.8);
      this.hit = Math.max(0, this.hit - dt); this.spin = Math.max(0, this.spin - dt); this.swing = Math.max(0, this.swing - dt);
      this.comboTime -= dt;
      const p = this.player;
      p.yaw += (input.turn || 0) * dt * 2.1;
      let forward = clamp(input.forward || 0, -1, 1), side = clamp(input.side || 0, -1, 1), len = Math.hypot(forward, side);
      if (len > 1) { forward /= len; side /= len; }
      const sprint = input.sprint && p.stamina > 3 && len > .05;
      p.stamina = clamp(p.stamina + (sprint ? -25 : 17) * dt, 0, 100);
      const speed = (sprint ? 4.2 : 2.85) * (this.speedMultiplier || 1);
      moveBody(p, (Math.sin(p.yaw) * forward + Math.cos(p.yaw) * side) * speed * dt,
        (-Math.cos(p.yaw) * forward + Math.sin(p.yaw) * side) * speed * dt, .26);
      p.moving += ((len > .05 ? 1 : 0) - p.moving) * Math.min(1, dt * 10);
      p.bob += dt * (sprint ? 13 : 9) * Math.min(1, len);
      this.spawn -= dt;
      if (this.spawn <= 0) {
        this.spawn = this.time < 30 ? 4.1 : 4.8;
        if (this.customers.filter(n => n.state === 'walking' || n.state === 'held').length < 11) this.addCustomer();
      }
      for (const c of this.customers) {
        if (c.state === 'removed') continue;
        if (c === this.held) {
          let offset = .94, side = .24;
          if (blocked(p.x + Math.sin(p.yaw) * offset + Math.cos(p.yaw) * side, p.z - Math.cos(p.yaw) * offset + Math.sin(p.yaw) * side, .22)) { offset = .38; side = 0; }
          c.x = p.x + Math.sin(p.yaw) * offset + Math.cos(p.yaw) * side; c.z = p.z - Math.cos(p.yaw) * offset + Math.sin(p.yaw) * side;
          c.y = .16; c.yaw = p.yaw; c.turn = 0; continue;
        }
        if (c.flying > 0) {
          c.flying -= dt; c.vy -= 7.8 * dt; c.y += c.vy * dt; c.turn += dt * 10;
          const old = { x: c.x, z: c.z }, dx = c.vx * dt, dz = c.vz * dt;
          // Evaluate the segment at the doorway before the shop's outer wall collision.
          if (dz > 0 && old.z <= EXIT.z && old.z + dz >= EXIT.z) {
            const crossing = old.x + dx * (EXIT.z - old.z) / dz;
            if (crossing > EXIT.x1 && crossing < EXIT.x2) { c.x = crossing; c.z = EXIT.z; this.eject(c); continue; }
          }
          const collision = moveBody(c, dx, dz, .22, c.y);
          if (collision.hitX) c.vx *= -.42;
          if (collision.hitZ) c.vz *= -.42;
          if ((collision.hitX || collision.hitZ) && Math.hypot(c.vx, c.vz) > 1.2) {
            this.particlesAt(c.x, Math.max(.2, c.y + .8), c.z, '#ffd69a', 7, 1); this.emit('impact');
          }
          c.vx *= Math.pow(.62, dt); c.vz *= Math.pow(.62, dt);
          if (c.y < 0) { c.y = 0; c.vy *= -.26; c.vx *= .7; c.vz *= .7; }
          if (c.flying <= 0 || (c.y === 0 && Math.hypot(c.vx, c.vz) < .7)) {
            c.flying = 0; c.y = 0; c.turn = 0;
            // An airborne throw may land on a shelf. Relocate only to a nearby free aisle.
            if (blocked(c.x, c.z, .25)) {
              const free = WAYPOINTS.map(([x, z]) => ({ x, z })).sort((a, b) => dist(a, c) - dist(b, c))[0];
              c.x = free.x; c.z = free.z;
            }
            c.path = []; c.wait = 1.5;
          }
          continue;
        }
        c.y = 0;
        if (c.state === 'leaving') {
          if (!c.path.length && dist(c, { x: EXIT.x, z: 12.8 }) < .7) { c.state = 'removed'; continue; }
        } else {
          c.patience -= dt;
          if (c.patience < 0) {
            if (c.karen) {
              c.timer -= dt;
              if (c.timer <= 0) { c.timer = 4.5; this.chaos = clamp(this.chaos + 4, 0, 100); this.hit = .2; this.emit('angry', '奧客在鬧場！混亂 +4', c); this.particlesAt(c.x, 1.6, c.z, '#ff775c', 6, .7); }
            } else { this.chaos = clamp(this.chaos + 7, 0, 100); c.state = 'leaving'; c.path = pathTo(c, { x: EXIT.x, z: 12.8 }); this.emit('lost', '顧客等太久離開了 · 混亂 +7', c); }
          }
          c.wait -= dt;
          if (!c.path.length && c.wait <= 0) {
            const spot = WAYPOINTS[Math.floor(this.random() * WAYPOINTS.length)]; c.path = pathTo(c, { x: spot[0], z: spot[1] }); c.wait = 5 + this.random() * 6;
          }
        }
        if (c.path.length) {
          const t = c.path[0], d = dist(c, t);
          if (d < .13) c.path.shift();
          else {
            const speed = c.state === 'leaving' ? 1.35 : .65;
            const reach = Math.min(d, dt * speed);
            moveBody(c, (t.x - c.x) / d * reach, (t.z - c.z) / d * reach, .24);
            c.yaw = Math.atan2(t.x - c.x, -(t.z - c.z)); c.walk += dt * 8;
          }
        }
      }
      this.customers = this.customers.filter(c => c.state !== 'removed');
      for (const p of this.particles) {
        p.life -= dt; p.vy -= dt * 5; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < .04) { p.y = .04; p.vy *= -.3; }
        p.angle += dt * 5;
      }
      this.particles = this.particles.filter(p => p.life > 0);
      this.rings.forEach(r => { r.life -= dt; r.r += dt * 10; }); this.rings = this.rings.filter(r => r.life > 0);
      if (this.time <= 0 || this.chaos >= 100) this.finish();
    }
  }
  root.BKCore = { World, FIXTURES, WAYPOINTS, EXIT, blocked, moveBody, lineOfSight, pathTo, clamp, dist };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BKCore;
})(globalThis);
