/* Mixed-mode management: orders, work stations, messes, events and a saved career. */
(function (root) {
  'use strict';
  const { World: BaseWorld, EXIT, clamp, dist, blocked, pathTo, lineOfSight } = root.BKCore;
  const ITEMS = Object.freeze({ snack: { name: '零食', icon: '▣', price: 15 }, coffee: { name: '咖啡', icon: '☕', price: 25 }, meal: { name: '熱便當', icon: '♨', price: 35 } });
  const TYPES = Object.freeze({ picky: { name: '挑剔客', description: '耐心短，鬧場更頻繁', variant: 0 }, litterer: { name: '亂丟客', description: '定時製造髒污', variant: 2 }, cutter: { name: '插隊客', description: '急躁，會影響附近客人', variant: 1 }, streamer: { name: '直播客', description: '持續降低周圍客人的耐心', variant: 3 } });
  const STATIONS = Object.freeze([
    { id: 'coffee', x: 2.05, z: 3.45, y: 2.25, title: '咖啡機', action: '沖一杯咖啡', icon: '☕', key: 'coffee', duration: 3.2 },
    { id: 'meal', x: 13.7, z: 1.95, y: 2.05, title: '微波爐', action: '加熱便當', icon: '♨', key: 'meal', duration: 4.2 },
    { id: 'shelf', x: 8.6, z: 5.3, y: 1.95, title: '零食貨架', action: '拿取零食', icon: '▣', key: 'snack', duration: 0 },
    { id: 'delivery', x: 16.1, z: 11.7, y: 1.6, title: '補貨箱', action: '搬起補貨箱', icon: '▤', duration: 0 }
  ]);
  const UPGRADES = Object.freeze([
    { key: 'shoes', name: '輕量工作鞋', icon: '↗', base: 100, detail: '每級移動速度 +8%' },
    { key: 'mop', name: '旋風拖把', icon: '〰', base: 100, detail: '每級範圍 +0.35m、冷卻 -0.5 秒' },
    { key: 'machine', name: '極速餐飲設備', icon: '☕', base: 120, detail: '每級製作餐飲時間 -14%' },
    { key: 'cleaner', name: '強效清潔組', icon: '✧', base: 80, detail: '每級清潔時間 -18%' },
    { key: 'guard', name: '夜班保全', icon: '♜', base: 150, detail: '自動請走靠近出口的奧客；升級縮短巡邏間隔' }
  ]);
  function normalizeProfile(value) {
    const v = value && typeof value === 'object' ? value : {}, upgrades = {};
    for (const u of UPGRADES) upgrades[u.key] = clamp(Math.floor(Number(v.upgrades?.[u.key]) || 0), 0, 3);
    return { version: 1, day: clamp(Math.floor(Number(v.day) || 1), 1, 99), wallet: clamp(Math.floor(Number(v.wallet ?? 120) || 0), 0, 999999), shifts: Math.max(0, Math.floor(Number(v.shifts) || 0)), wins: Math.max(0, Math.floor(Number(v.wins) || 0)), upgrades };
  }
  function upgradePrice(profile, key) { const u = UPGRADES.find(u => u.key === key); return !u || profile.upgrades[key] >= 3 ? null : Math.ceil(u.base * [1, 1.7, 2.7][profile.upgrades[key]]); }
  function buyUpgrade(profile, key) { const price = upgradePrice(profile, key); if (price === null || profile.wallet < price) return false; profile.wallet -= price; profile.upgrades[key]++; return true; }
  class ShopWorld extends BaseWorld {
    constructor(seed, profile) { super(seed); this.profile = normalizeProfile(profile); this.configure(); this.state = 'ready'; }
    reset() { super.reset(); if (this.profile) this.configure(); }
    configure() {
      const day = this.profile.day, u = this.profile.upgrades;
      this.shiftLength = 120; this.time = this.shiftLength; this.goal = 180 + Math.min(8, day - 1) * 20; this.reputation = 90;
      this.spinCooldown = 5 - u.mop * .5; this.spinRange = 3.2 + u.mop * .35; this.speedMultiplier = 1 + u.shoes * .08;
      this.shop = { inventory: [], stock: { snack: 6, coffee: 5, meal: 4 }, crate: false, messes: [], job: null, cleaned: 0, refilled: 0, completed: 0, event: null, nextEvent: 32, dirtyTimer: 0, slipTimer: 0, guardTimer: Math.max(12, 36 - u.guard * 6), settlement: null };
      this.power = 1;
      for (const c of this.customers) this.setupCustomer(c);
      this.customers[0].order = 'snack'; this.customers[0].wait = 22;
      // One visible spill makes cleaning discoverable on the very first shift.
      this.addMess(11.35, 7.3, false);
      this.events = []; this.emit('hint', '先到標記「▣」的貨架拿零食，再交給眼前的顧客。E／互動可操作設備或清潔。');
    }
    setupCustomer(c) {
      c.kind = c.karen ? Object.keys(TYPES)[Math.floor(this.random() * 4)] : null;
      if (c.karen) c.variant = TYPES[c.kind].variant;
      const r = this.random(); c.order = r < .44 ? 'snack' : r < .77 ? 'coffee' : 'meal';
      c.patience = c.karen ? c.kind === 'picky' ? 12 : 17 : 57 + this.random() * 13; c.maxPatience = c.patience;
      c.behavior = 6 + this.random() * 4; c._missed = false; return c;
    }
    addCustomer(...args) { return this.setupCustomer(super.addCustomer(...args)); }
    targetStation() {
      const p = this.player, fx = Math.sin(p.yaw), fz = -Math.cos(p.yaw), candidates = [];
      for (const s of STATIONS) {
        const d = dist(p, s), dot = ((s.x - p.x) * fx + (s.z - p.z) * fz) / Math.max(.01, d);
        if (d < 2.15 && (dot > .38 || d < .45) && lineOfSight(p, s)) candidates.push({ ...s, distance: d, score: d - dot * .4 });
      }
      for (const mess of this.shop.messes) {
        const d = dist(p, mess), dot = ((mess.x - p.x) * fx + (mess.z - p.z) * fz) / Math.max(.01, d);
        if (d < 1.9 && (dot > .15 || d < .6) && lineOfSight(p, mess)) candidates.push({ id: 'clean', title: '打翻的飲料', action: '拖地清潔', x: mess.x, z: mess.z, y: .3, duration: 1.4, mess, distance: d, score: d - .1 });
      }
      return candidates.sort((a, b) => a.score - b.score)[0] || null;
    }
    focus() {
      const c = this.target(), s = this.targetStation();
      if (c && (!s || dist(c, this.player) < s.distance + .35)) return { customer: c };
      return s ? { station: s } : null;
    }
    addMess(x, z, announce = true) {
      if (!this.shop || this.shop.messes.length >= 9 || blocked(x, z, .1) || this.shop.messes.some(m => Math.hypot(m.x - x, m.z - z) < .65)) return false;
      this.shop.messes.push({ id: ++this.nextId, x, z, phase: this.random() * 6 });
      if (announce) { this.emit('mess', '有人把飲料打翻了！對準地面髒污按「互動」清潔。'); this.particlesAt(x, .12, z, '#c8a279', 8, .5); }
      return true;
    }
    cancelJob(text = '工作已取消，原料已歸還。') {
      const j = this.shop.job; if (!j) return;
      if (j.reserved) this.shop.stock[j.reserved]++;
      this.shop.job = null; this.emit('hint', text);
    }
    startJob(s) {
      const shop = this.shop, u = this.profile.upgrades;
      if (this.held) { this.emit('hint', '先放開抓住的顧客，再操作設備。'); return; }
      if (s.id === 'clean') {
        shop.job = { ...s, elapsed: 0, total: s.duration * (1 - u.cleaner * .18), label: '拖地清潔中', reserved: null }; this.emit('work', '正在清潔；走太遠或再按互動會取消。'); return;
      }
      if (s.id === 'delivery') {
        if (shop.crate) { this.emit('hint', '補貨箱已在手上，帶到「▣」零食貨架按互動補貨。'); return; }
        shop.crate = true; this.emit('pickup', '搬起補貨箱！帶到「▣」貨架，可補滿三類商品。'); return;
      }
      if (shop.crate) {
        if (s.id !== 'shelf') { this.emit('hint', '先把補貨箱搬到「▣」貨架，再製作餐飲。'); return; }
        shop.job = { ...s, elapsed: 0, total: 2, label: '貨架補貨中', refill: true }; return;
      }
      if (shop.inventory.length >= 2) { this.emit('hint', '雙手已滿（2 格）。先交付訂單，或按 G／放下丟棄一份商品。'); return; }
      if (shop.stock[s.key] <= 0) { this.emit('hint', `${ITEMS[s.key].name}缺貨！到出口右側搬補貨箱，再到「▣」貨架補貨。`); return; }
      shop.stock[s.key]--;
      if (!s.duration) { shop.inventory.push(s.key); this.emit('pickup', `拿到${ITEMS[s.key].name}，帶給需要的顧客。`); return; }
      shop.job = { ...s, elapsed: 0, total: s.duration * (1 - u.machine * .14), label: s.id === 'coffee' ? '咖啡萃取中' : '便當加熱中', reserved: s.key };
      this.emit('work', shop.job.label + '，留在設備旁等待完成。');
    }
    completeJob() {
      const shop = this.shop, j = shop.job; if (!j) return;
      if (j.id === 'clean') {
        shop.messes = shop.messes.filter(m => m.id !== j.mess.id); shop.cleaned++; this.chaos = clamp(this.chaos - 4, 0, 100); this.reputation = clamp(this.reputation + 1, 0, 100); this.money += 2;
        this.particlesAt(j.x, .12, j.z, '#b9f1e1', 22, 1.5); this.emit('clean', '地板亮晶晶！混亂 -4、整理獎金 +$2');
      } else if (j.refill) {
        shop.stock = { snack: 9, coffee: 9, meal: 9 }; shop.crate = false; shop.refilled++; this.emit('refill', '補貨完成！零食、咖啡與便當原料各補到 9 份。'); this.particlesAt(j.x, 1, j.z, '#f2ce8b', 18, 1);
      } else {
        shop.inventory.push(j.key); this.emit('pickup', `${ITEMS[j.key].name}好了！帶到顧客面前按「交付」。`);
      }
      shop.job = null;
    }
    action(name) {
      if (this.state !== 'playing') return;
      const shop = this.shop;
      if (name === 'drop') {
        if (shop.job) { this.cancelJob(); return; }
        if (shop.crate) { shop.crate = false; this.emit('hint', '補貨箱已放回原處。'); return; }
        const item = shop.inventory.shift();
        if (item) { this.chaos = clamp(this.chaos + 1, 0, 100); this.addMess(this.player.x + Math.sin(this.player.yaw) * .6, this.player.z - Math.cos(this.player.yaw) * .6, false); this.emit('hint', `丟棄${ITEMS[item].name}，混亂 +1。`); }
        else this.emit('hint', '目前沒有攜帶商品。');
        return;
      }
      if (name === 'serve' || name === 'interact') {
        if (shop.job) { this.cancelJob(); return; }
        const focus = this.focus();
        if (!focus) { this.emit('hint', '對準近處顧客、設備、補貨箱或地板髒污，按「互動」。'); return; }
        if (focus.station) { this.startJob(focus.station); return; }
        const c = focus.customer;
        if (this.held) { this.emit('hint', '先放開抓住的顧客。'); return; }
        if (shop.crate) { this.emit('hint', '先到貨架補貨，或按 G／放下把補貨箱放回原處。'); return; }
        if (!c.karen) {
          const index = shop.inventory.indexOf(c.order);
          if (index < 0) { this.emit('hint', `客人 #${c.id} 要${ITEMS[c.order].name}！先到對應設備準備；拿錯商品不會自動扣掉。`); return; }
          shop.inventory.splice(index, 1); this.money += ITEMS[c.order].price; this.served++; shop.completed++; this.reputation = clamp(this.reputation + 2, 0, 100); this.chaos = clamp(this.chaos - 3, 0, 100);
          c.state = 'leaving'; c.path = pathTo(c, { x: EXIT.x, z: 12.8 }); this.swing = .25;
          this.particlesAt(c.x, 1.4, c.z, '#9befc5', 19, 1); this.emit('serve', `${ITEMS[c.order].name}交付完成！+$${ITEMS[c.order].price}`, c, ITEMS[c.order].price); return;
        }
        // Keeping a customer calm is an alternative to throwing them out.
        this.money += 5; this.chaos = clamp(this.chaos - 2, 0, 100); this.reputation = clamp(this.reputation + 1, 0, 100);
        c.state = 'leaving'; c.path = pathTo(c, { x: EXIT.x, z: 12.8 }); this.emit('serve', '冷靜溝通成功 +$5 · 混亂 -2', c, 5); return;
      }
      if (name === 'grab' && shop.crate) { this.emit('hint', '正搬著補貨箱，先完成補貨或按「放下」。'); return; }
      if (shop.job) this.cancelJob('工作中斷，原料已歸還。');
      super.action(name);
    }
    eject(c, ultimate = false) { const wasRemoved = c.state === 'removed'; super.eject(c, ultimate); if (this.shop && !wasRemoved) this.reputation = clamp(this.reputation + (c.karen ? 1 : -15), 0, 100); }
    beginEvent() {
      const kind = this.random() < .5 ? 'rush' : 'outage';
      this.shop.event = { kind, remaining: kind === 'rush' ? 14 : 11, pulse: 0 };
      this.emit('event', kind === 'rush' ? '晚餐尖峰！接下來 14 秒人潮增加。' : '突然停電！備用照明啟動，11 秒後恢復。');
    }
    finish() {
      if (this.state !== 'playing') return;
      // BaseWorld can call finish during a movement tick or an ultimate.
      if (this.shop?.job) this.cancelJob('本班結束，未完成製作的原料已歸還。');
      this.state = 'ended'; this.won = this.money >= (this.goal || 180) && this.chaos < 100 && this.reputation > 0; this.held = null;
      if (this.profile && !this.shop.settlement) {
        const base = Math.floor(this.money * .18), bonus = this.won ? 80 : 15, service = this.served * 3 + this.ejected * 4 + this.shop.cleaned * 2 + this.shop.refilled * 4;
        const earned = base + bonus + service; this.profile.wallet += earned; this.profile.shifts++; if (this.won) { this.profile.wins++; this.profile.day++; }
        this.shop.settlement = { base, bonus, service, earned, completedDay: this.won ? this.profile.day - 1 : this.profile.day };
      }
      this.emit('end', this.won ? '下班快樂！領薪、升級，下一班再戰。' : '這班辛苦了，領取薪資後再挑戰。');
    }
    step(dt, input = {}) {
      if (this.state !== 'playing') return;
      dt = clamp(dt, 0, .05); const s = this.shop, u = this.profile.upgrades;
      this.speedMultiplier = (1 + u.shoes * .08) * (s.crate ? .82 : 1) * (s.slipTimer > 0 ? .42 : 1);
      if (s.job && dist(this.player, s.job) > 2.65) this.cancelJob('離開設備太遠，工作取消、原料已歸還。');
      super.step(dt, input); if (this.state !== 'playing') return;
      s.slipTimer = Math.max(0, s.slipTimer - dt);
      if (s.job) { s.job.elapsed += dt; if (s.job.elapsed >= s.job.total) this.completeJob(); }
      for (const c of this.customers) {
        if (c.state === 'leaving' && !c.karen && c.patience < 0 && !c._missed) { c._missed = true; this.reputation = clamp(this.reputation - 6, 0, 100); }
        if (c.state !== 'walking' || c.flying || !c.karen) continue;
        c.behavior -= dt;
        if (c.kind === 'streamer') for (const n of this.customers) if (!n.karen && n.state === 'walking' && dist(c, n) < 3) n.patience -= dt * .35;
        if (c.behavior <= 0) {
          c.behavior = c.kind === 'picky' ? 7 : 10;
          if (c.kind === 'litterer') this.addMess(c.x + .45, c.z);
          if (c.kind === 'cutter') {
            const n = this.customers.find(n => !n.karen && n.state === 'walking' && dist(n, c) < 4); if (n) n.patience -= 4;
            c.path = pathTo(c, { x: 10.6, z: 9.5 });
          }
          if (c.kind === 'picky' && c.patience < 0) { this.chaos = clamp(this.chaos + 2, 0, 100); this.emit('angry', '挑剔客又在找麻煩！混亂 +2', c); }
        }
      }
      s.dirtyTimer += dt;
      if (s.dirtyTimer >= 8) { s.dirtyTimer = 0; this.chaos = clamp(this.chaos + s.messes.length, 0, 100); }
      if (s.slipTimer === 0 && this.player.stamina > 50 && input.sprint && s.messes.some(m => dist(m, this.player) < .5)) { s.slipTimer = .65; this.player.stamina -= 28; this.hit = .25; this.emit('hint', '踩到飲料滑了一下！對準髒污按互動拖乾淨。'); }
      s.nextEvent -= dt;
      if (s.nextEvent <= 0 && !s.event) { this.beginEvent(); s.nextEvent = 42; }
      if (s.event) {
        s.event.remaining -= dt; this.power = s.event.kind === 'outage' ? .35 : 1;
        if (s.event.kind === 'rush') { s.event.pulse -= dt; if (s.event.pulse <= 0) { s.event.pulse = 2.8; if (this.customers.filter(c => c.state === 'walking').length < 12) this.addCustomer(this.random() < .25); } }
        if (s.event.remaining <= 0) { s.event = null; this.power = 1; this.emit('hint', '突發狀況結束，夜班繼續。'); }
      }
      if (u.guard > 0) {
        s.guardTimer -= dt;
        if (s.guardTimer <= 0) {
          s.guardTimer = Math.max(12, 36 - u.guard * 6);
          const c = this.customers.filter(c => c.karen && c.state === 'walking' && c !== this.held && dist(c, { x: EXIT.x, z: EXIT.z }) < 5.5).sort((a, b) => a.patience - b.patience)[0];
          if (c) { this.eject(c); this.emit('hint', '夜班保全協助請走了一位靠近出口的奧客。'); }
        }
      }
      if (this.chaos >= 100 || this.reputation <= 0) this.finish();
    }
  }
  root.BKShop = { World: ShopWorld, ITEMS, TYPES, STATIONS, UPGRADES, normalizeProfile, upgradePrice, buyUpgrade };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BKShop;
})(globalThis);
