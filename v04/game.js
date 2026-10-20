(function () {
  'use strict';
  const $ = id => document.getElementById(id), { FIXTURES, EXIT, clamp, dist } = BKCore;
  const { World, ITEMS, TYPES, STATIONS, UPGRADES, upgradePrice, buyUpgrade } = BKShop;
  const canvas = $('scene'), keys = new Set();
  let world, renderer, last = 0, previousLock = false, lookPointer = null, joystickPointer = null;
  let shopReturn = 'menu';
  let joy = { forward: 0, side: 0 }, sprintTouch = false, hintUntil = 0, bannerUntil = 0, allowPortrait = false, helpReturn = 'menu';
  const floats = [];
  const coarse = matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 1;
  const readSaved = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (_) { return fallback; } };
  const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* Private mode still plays without persistence. */ } };
  let settings = Object.assign({ sensitivity: 1, quality: 'auto', muted: false, reduceMotion: matchMedia('(prefers-reduced-motion:reduce)').matches, touch: coarse }, readSaved('byekarens-fps-settings', {}));
  settings.sensitivity = clamp(Number(settings.sensitivity) || 1, .4, 2);
  if (!['auto', 'high', 'low'].includes(settings.quality)) settings.quality = 'auto';
  let best = readSaved('byekarens-fps-best', { money: 0, ejected: 0, shifts: 0 });
  if (!best || typeof best !== 'object') best = { money: 0, ejected: 0, shifts: 0 };
  class Sound {
    constructor() { this.ctx = null; this.lastImpact = 0; }
    unlock() {
      try {
        if (!this.ctx) {
          const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return;
          this.ctx = new Audio(); this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
          this.hum = this.ctx.createOscillator(); this.hum.type = 'sine'; this.hum.frequency.value = 67;
          this.humGain = this.ctx.createGain(); this.humGain.gain.value = .008;
          this.hum.connect(this.humGain); this.humGain.connect(this.master); this.hum.start();
        }
        this.ctx.resume().catch(() => {}); this.sync();
      } catch (_) { /* Sound is optional; never block gameplay on an audio policy. */ }
    }
    sync() { if (!this.ctx) return; this.master.gain.setTargetAtTime(settings.muted ? 0 : .28, this.ctx.currentTime, .03); this.humGain.gain.setTargetAtTime(world?.state === 'playing' ? .008 : 0, this.ctx.currentTime, .03); }
    tone(freq, start, duration, type = 'sine', volume = .22, endFreq = freq) {
      if (!this.ctx || settings.muted) return;
      const t = this.ctx.currentTime + start, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
      g.gain.setValueAtTime(.001, t); g.gain.exponentialRampToValueAtTime(volume, t + .012); g.gain.exponentialRampToValueAtTime(.001, t + duration);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + duration + .02);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    }
    noise(duration, volume = .2, lowpass = 1500) {
      if (!this.ctx || settings.muted) return;
      const c = this.ctx, buffer = c.createBuffer(1, Math.ceil(c.sampleRate * duration), c.sampleRate), v = buffer.getChannelData(0);
      for (let i = 0; i < v.length; i++) v[i] = (Math.random() * 2 - 1) * (1 - i / v.length);
      const src = c.createBufferSource(), g = c.createGain(), filter = c.createBiquadFilter();
      src.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = lowpass; g.gain.value = volume;
      src.connect(filter); filter.connect(g); g.connect(this.master); src.start();
      src.onended = () => { src.disconnect(); filter.disconnect(); g.disconnect(); };
    }
    play(type) {
      if (!this.ctx || settings.muted) return;
      if (type === 'serve') { this.tone(740, 0, .11, 'sine', .25); this.tone(1110, .09, .18, 'sine', .2); }
      if (type === 'grab') this.tone(150, 0, .13, 'triangle', .23, 260);
      if (type === 'throw') { this.noise(.22, .3, 2200); this.tone(330, 0, .23, 'triangle', .15, 80); }
      if (type === 'spin') { this.noise(.6, .27, 1400); this.tone(170, 0, .48, 'sine', .17, 600); }
      if (type === 'eject') { [440, 554, 659, 880].forEach((f, i) => this.tone(f, i * .065, .19, 'triangle', .22)); }
      if (type === 'ultimate') { this.noise(.8, .38, 1000); [110, 220, 440, 880].forEach((f, i) => this.tone(f, i * .07, .5, 'triangle', .25)); }
      if (type === 'impact' && this.ctx.currentTime - this.lastImpact > .1) { this.lastImpact = this.ctx.currentTime; this.noise(.08, .22, 600); this.tone(100, 0, .1, 'triangle', .17, 40); }
      if (type === 'mistake' || type === 'lost') { this.tone(180, 0, .19, 'triangle', .16, 110); }
      if (type === 'end') { const notes = world.won ? [523, 659, 784, 1046] : [330, 294, 220]; notes.forEach((f, i) => this.tone(f, i * .15, .35, 'triangle', .2)); }
      if (type === 'start') { this.tone(659, 0, .14); this.tone(880, .14, .24); }
    }
  }
  const sound = new Sound();
  function hint(text, seconds = 4.5) { $('hint').textContent = text; hintUntil = performance.now() / 1000 + seconds; $('hint').style.opacity = '1'; }
  function resetInput() { keys.clear(); joy = { forward: 0, side: 0 }; sprintTouch = false; joystickPointer = lookPointer = null; $('stick').style.transform = ''; $('sprintBtn').classList.remove('active'); }
  function exitPointer() { if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock(); }
  function saveSettings() { store('byekarens-fps-settings', settings); }
  function applySettings() {
    document.body.classList.toggle('touch', !!settings.touch);
    $('showTouch').checked = !!settings.touch; $('reduceMotion').checked = !!settings.reduceMotion;
    $('sensitivity').value = settings.sensitivity; $('sensitivityValue').textContent = Number(settings.sensitivity).toFixed(1);
    $('quality').value = settings.quality; $('soundBtn').classList.toggle('muted', !!settings.muted);
    $('soundBtn').textContent = settings.muted ? '♪̸' : '♫'; $('soundBtn').setAttribute('aria-label', settings.muted ? '開啟音效' : '關閉音效');
    if (renderer) { renderer.quality = settings.quality; renderer.reduceMotion = settings.reduceMotion; renderer.resize(); }
    sound.sync();
  }
  function updateBest() { $('bestScore').textContent = best.shifts > 0 ? `最佳營業額 $${best.money || 0} · 最多退散 ${best.ejected || 0} 位` : '祝你準時下班。'; }
  function updateCareerUI() {
    $('careerDay').textContent = `● 第 ${world.profile.day} 班 · 薪資 ${world.profile.wallet} 點`;
    $('menuGoal').textContent = '$' + (180 + Math.min(8, world.profile.day - 1) * 20);
    $('shiftDay').textContent = String(world.profile.day).padStart(3, '0');
    $('goalValue').textContent = ' / ' + world.goal;
  }
  function renderUpgradeShop() {
    const container = $('upgradeList'); container.textContent = ''; $('walletValue').textContent = world.profile.wallet;
    for (const u of UPGRADES) {
      const level = world.profile.upgrades[u.key], price = upgradePrice(world.profile, u.key), row = document.createElement('div'); row.className = 'upgrade-row';
      const details = document.createElement('div'); details.className = 'upgrade-detail'; details.innerHTML = `<b><i>${u.icon}</i>${u.name} <em>Lv.${level} / 3</em></b><small>${u.detail}</small>`;
      const button = document.createElement('button'); button.textContent = price === null ? '已滿級' : `${price} 點升級`; button.disabled = price === null || world.profile.wallet < price;
      button.setAttribute('aria-label', `${u.name}，目前等級 ${level}，${price === null ? '已滿級' : '花費 ' + price + ' 點'}`);
      button.addEventListener('click', () => {
        if (!['ready', 'ended'].includes(world.state)) return;
        if (!buyUpgrade(world.profile, u.key)) return;
        store('byekarens-career-v1', world.profile); $('shopMessage').textContent = `${u.name}升到 Lv.${world.profile.upgrades[u.key]}，下一班起生效。`; sound.unlock(); sound.play('serve'); renderUpgradeShop(); updateCareerUI();
      }); row.appendChild(details); row.appendChild(button); container.appendChild(row);
    }
  }
  function openUpgrade() {
    if (!['ready', 'ended'].includes(world.state)) return;
    shopReturn = world.state === 'ended' ? 'resultMenu' : 'menu'; $(shopReturn).classList.add('hidden'); $('upgradeMenu').classList.remove('hidden');
    $('shopMessage').textContent = `已完成 ${world.profile.shifts} 班，通關 ${world.profile.wins} 班。裝備最多升到 Lv.3。`; renderUpgradeShop();
  }
  function updateBusinessHUD() {
    const shop = world.shop, focus = world.focus(), c = focus?.customer, station = focus?.station;
    $('inventoryText').textContent = shop.crate ? '▤ 補貨箱 → 帶到 ▣ 貨架' : shop.inventory.length ? shop.inventory.map(k => ITEMS[k].icon + ' ' + ITEMS[k].name).join(' · ') : '空手 · 可拿 2 份商品';
    $('stockText').textContent = `庫存 ▣ ${shop.stock.snack} · ☕ ${shop.stock.coffee} · ♨ ${shop.stock.meal}`;
    $('reputation').textContent = Math.round(world.reputation); $('dropBtn').style.opacity = shop.inventory.length || shop.crate || shop.job ? '1' : '.45';
    const pending = world.customers.filter(n => !n.karen && n.state === 'walking').sort((a, b) => a.patience - b.patience);
    $('orderCount').textContent = pending.length;
    $('orderList').innerHTML = pending.length ? pending.slice(0, 3).map(n => `<span class="${n.patience < 16 ? 'urgent' : ''}"><b>#${n.id} ${ITEMS[n.order].icon} ${ITEMS[n.order].name}</b><em>${Math.max(0, Math.ceil(n.patience))}s</em></span>`).join('') : '<small>目前沒有待完成訂單</small>';
    $('eventStrip').classList.toggle('hidden', !shop.event);
    if (shop.event) { $('eventName').textContent = shop.event.kind === 'rush' ? '尖峰人潮' : '停電 · 備用照明'; $('eventTime').textContent = Math.ceil(shop.event.remaining) + 's'; }
    $('jobPanel').classList.toggle('hidden', !shop.job); $('hud').classList.toggle('working', !!shop.job);
    if (shop.job) { $('jobName').textContent = shop.job.label; $('jobTime').textContent = Math.max(0, shop.job.total - shop.job.elapsed).toFixed(1) + 's'; $('jobBar').style.width = shop.job.elapsed / shop.job.total * 100 + '%'; }
    const prompt = $('targetPrompt');
    if (!world.held) {
      prompt.style.opacity = focus ? '1' : '0'; prompt.classList.toggle('angry', !!c?.karen);
      $('crosshair').className = c?.karen ? 'target-red' : focus ? 'target-green' : '';
      if (c) {
        $('targetType').textContent = c.karen ? TYPES[c.kind].name : `客人 #${c.id} · ${ITEMS[c.order].name}`;
        $('targetText').textContent = c.karen ? '互動安撫，或抓起請出門' : shop.inventory.includes(c.order) ? `交付 +$${ITEMS[c.order].price}` : `先準備${ITEMS[c.order].name}`;
        $('targetDistance').textContent = dist(c, world.player).toFixed(1) + 'm';
      } else if (station) {
        $('targetType').textContent = station.title; $('targetText').textContent = shop.crate && station.id === 'shelf' ? '補滿三類商品' : station.action;
        $('targetDistance').textContent = station.distance.toFixed(1) + 'm';
      }
    }
    $('interactLabel').textContent = shop.job ? '取消' : c ? c.karen ? '安撫' : '交付' : station?.id === 'clean' ? '拖地' : '互動';
    $('serveBtn').querySelector('small').textContent = shop.job ? '原料歸還' : c ? c.karen ? '+$5' : ITEMS[c.order].icon + ' ' + ITEMS[c.order].name : station?.id === 'delivery' ? '搬起箱子' : '設備／顧客';
  }
  function hideMenus() { for (const id of ['menu', 'pauseMenu', 'helpMenu', 'resultMenu', 'upgradeMenu']) $(id).classList.add('hidden'); }
  function start() {
    if (!renderer) return;
    world.reset(); updateCareerUI(); hideMenus(); document.body.classList.remove('in-menu'); resetInput();
    floats.splice(0).forEach(f => f.el.remove()); bannerUntil = 0; $('banner').classList.remove('visible');
    sound.unlock(); sound.play('start'); sound.sync(); canvas.focus({ preventScroll: true });
    renderer.resize(); updateRotate();
  }
  function pause() {
    if (world.state !== 'playing') return;
    world.state = 'paused'; resetInput(); exitPointer(); $('pauseMenu').classList.remove('hidden'); document.body.classList.add('in-menu'); sound.sync();
  }
  function resume() {
    if (world.state !== 'paused') return;
    world.state = 'playing'; $('pauseMenu').classList.add('hidden'); document.body.classList.remove('in-menu'); resetInput(); sound.unlock(); canvas.focus({ preventScroll: true });
  }
  function showResults() {
    resetInput(); exitPointer(); hideMenus(); $('resultMenu').classList.remove('hidden'); document.body.classList.add('in-menu'); sound.sync();
    $('resultEyebrow').textContent = world.won ? 'SHIFT COMPLETE' : 'SHIFT REPORT';
    $('resultMark').textContent = world.won ? '✓' : '↻'; $('resultTitle').textContent = world.won ? '奧客退散，平安下班。' : '這一班，有點混亂。';
    $('resultDescription').textContent = world.reputation <= 0 ? '店面口碑見底。多完成訂單，別誤傷一般客人。' : world.chaos >= 100 ? '混亂已達上限。早點服務客人、留意紅色雷達點。' : world.won ? '營業目標達成！明天再繼續保持微笑。' : `距離目標還差 $${Math.max(0, world.goal - world.money)}，記得多服務綠色顧客。`;
    $('resultMoney').textContent = '$' + world.money; $('resultServed').textContent = world.served; $('resultEjected').textContent = world.ejected; $('resultChaos').textContent = Math.round(world.chaos) + '%';
    const salary = world.shop.settlement;
    $('salaryReport').textContent = `本班薪資 +${salary.earned} 點 · 錢包 ${world.profile.wallet} 點\n清潔 ${world.shop.cleaned} 次 · 補貨 ${world.shop.refilled} 次 · 口碑 ${Math.round(world.reputation)}`;
    $('againBtn').textContent = world.won ? '下一班 →' : '再挑戰這一班 →';
    store('byekarens-career-v1', world.profile); updateCareerUI();
    best.money = Math.max(Number(best.money) || 0, world.money); best.ejected = Math.max(Number(best.ejected) || 0, world.ejected); best.shifts = (Number(best.shifts) || 0) + 1;
    store('byekarens-fps-best', best); updateBest();
  }
  function openHelp() {
    helpReturn = world.state === 'ready' ? 'menu' : 'pauseMenu';
    if (world.state === 'playing') pause();
    $(helpReturn).classList.add('hidden'); $('helpMenu').classList.remove('hidden'); document.body.classList.add('in-menu');
  }
  function updateRotate() {
    const portrait = (coarse || settings.touch) && window.innerHeight > window.innerWidth && !allowPortrait;
    $('rotateNotice').classList.toggle('hidden', !portrait);
    if (portrait && world?.state === 'playing') pause();
  }
  function action(name) { if (world?.state !== 'playing') return; sound.unlock(); world.action(name); }
  function look(dx, dy) {
    if (world?.state !== 'playing') return;
    world.player.yaw += dx * .004 * settings.sensitivity;
    world.player.pitch = clamp(world.player.pitch - dy * .0032 * settings.sensitivity, -.72, .7);
  }
  function processEvents(now) {
    for (const e of world.events.splice(0)) {
      sound.play(['pickup', 'refill', 'clean'].includes(e.type) ? 'serve' : e.type);
      if (e.type === 'end') { showResults(); continue; }
      if (e.text) hint(e.text, e.type === 'angry' ? 2 : 4.5);
      if (['ultimate', 'eject', 'event'].includes(e.type)) { $('banner').textContent = e.text; $('banner').classList.add('visible'); bannerUntil = now + (e.type === 'ultimate' ? 1.7 : 1.05); }
      if (e.at && ['serve', 'eject', 'angry', 'mistake', 'lost'].includes(e.type)) {
        const el = document.createElement('div'); el.className = 'float-text'; el.textContent = e.type === 'serve' ? `+$${e.value}` : e.type === 'eject' ? '奧客退散！' : e.type === 'angry' ? '混亂 +4' : e.text;
        el.style.color = e.type === 'serve' ? '#b6ffcb' : e.type === 'eject' ? '#ffcc91' : '#ffab90'; $('floatLayer').appendChild(el);
        floats.push({ el, at: e.at, start: now });
        if (floats.length > 12) floats.shift().el.remove();
      }
    }
  }
  const map = $('minimap'), mctx = map.getContext('2d');
  function minimap(now) {
    const ctx = mctx, scale = 15.6, ox = 9.6, oz = 7.8;
    ctx.clearRect(0, 0, 300, 234); ctx.save(); ctx.translate(ox, oz); ctx.scale(scale, scale);
    ctx.fillStyle = '#294b49'; ctx.fillRect(0, 0, 18, 14); ctx.strokeStyle = '#639184'; ctx.lineWidth = .09; ctx.strokeRect(.15, .15, 17.7, 13.55);
    ctx.strokeStyle = '#34564f'; ctx.lineWidth = .035; for (let x = 2; x < 18; x += 2) { ctx.beginPath(); ctx.moveTo(x, .3); ctx.lineTo(x, 13.5); ctx.stroke(); }
    for (const b of FIXTURES) {
      ctx.fillStyle = b.kind === 'fridge' ? '#669c93' : b.kind === 'counter' ? '#a28f65' : '#688d72';
      ctx.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d);
      if (b.kind === 'shelf') { ctx.fillStyle = '#abc295'; ctx.fillRect(b.x - b.w / 2, b.z - .08, b.w, .16); }
    }
    ctx.strokeStyle = '#ffbe7b'; ctx.lineWidth = .24; ctx.beginPath(); ctx.moveTo(EXIT.x1, 13.65); ctx.lineTo(EXIT.x2, 13.65); ctx.stroke();
    ctx.fillStyle = '#ffbc78'; ctx.beginPath(); ctx.moveTo(EXIT.x, 13.45); ctx.lineTo(EXIT.x - .25, 12.95); ctx.lineTo(EXIT.x + .25, 12.95); ctx.fill();
    for (const station of STATIONS) {
      ctx.fillStyle = station.id === 'delivery' ? '#e5bc77' : '#d9e2c0'; ctx.beginPath(); ctx.arc(station.x, station.z, .38, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#264b43'; ctx.font = '700 .55px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(station.id === 'coffee' ? 'C' : station.id === 'meal' ? 'M' : station.id === 'shelf' ? 'S' : 'B', station.x, station.z + .02);
    }
    for (const mess of world.shop.messes) { ctx.fillStyle = '#dbaf79'; ctx.fillRect(mess.x - .13, mess.z - .13, .26, .26); }
    const p = world.player;
    ctx.fillStyle = '#c6f2d920'; ctx.beginPath(); ctx.moveTo(p.x, p.z); for (let a = -.62; a <= .63; a += .09) ctx.lineTo(p.x + Math.sin(p.yaw + a) * 2.8, p.z - Math.cos(p.yaw + a) * 2.8); ctx.closePath(); ctx.fill();
    for (const c of world.customers) {
      ctx.fillStyle = c.state === 'leaving' ? '#98b1a0' : c.karen ? '#ff8c72' : '#9df0b9';
      ctx.beginPath(); ctx.arc(c.x, c.z, c === world.held ? .25 : .19, 0, Math.PI * 2); ctx.fill();
      if (c.karen && c.patience < 0 && c.state === 'walking') { ctx.strokeStyle = '#ff93728a'; ctx.lineWidth = .05; ctx.beginPath(); ctx.arc(c.x, c.z, .26 + (now * .8 % 1) * .4, 0, Math.PI * 2); ctx.stroke(); }
      if (c.flying) { ctx.strokeStyle = '#fac497'; ctx.lineWidth = .06; ctx.beginPath(); ctx.moveTo(c.x, c.z); ctx.lineTo(c.x - c.vx * .07, c.z - c.vz * .07); ctx.stroke(); }
    }
    ctx.translate(p.x, p.z); ctx.rotate(p.yaw); ctx.fillStyle = '#fff4d8'; ctx.shadowColor = '#dcfff1'; ctx.shadowBlur = 7;
    ctx.beginPath(); ctx.moveTo(0, -.38); ctx.lineTo(.25, .25); ctx.lineTo(0, .12); ctx.lineTo(-.25, .25); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function updateHUD(now) {
    $('time').innerHTML = Math.ceil(world.time) + '<span>s</span>'; $('timeBar').style.width = world.time / world.shiftLength * 100 + '%';
    $('time').style.color = world.time < 20 ? '#ffab86' : '';
    $('money').textContent = world.money; $('moneyBar').style.width = Math.min(100, world.money / world.goal * 100) + '%';
    $('chaos').innerHTML = Math.round(world.chaos) + '<span>%</span>'; $('chaosBar').style.width = world.chaos + '%';
    $('chaos').style.color = world.chaos > 70 ? '#ff8d74' : '';
    $('burstNum').textContent = Math.floor(world.burst); $('burstBar').style.width = world.burst + '%';
    document.querySelector('.burst-panel').classList.toggle('ready', world.burst >= 100); $('ultimateBtn').classList.toggle('ready', world.burst >= 100);
    $('ultimateBtn').setAttribute('aria-disabled', String(world.burst < 100)); $('ultLabel').textContent = world.burst >= 100 ? '立即釋放' : `集氣 ${Math.floor(world.burst)}%`;
    $('burstHint').textContent = world.burst >= 100 ? '按 R 或「全店退散」釋放' : '送走奧客 +25 · 旋風 +12';
    $('spinLabel').textContent = world.cool > 0 ? Math.ceil(world.cool) + 's' : '就緒'; $('spinBtn').classList.toggle('cooldown', world.cool > 0);
    const held = world.held, c = world.target();
    $('grabLabel').textContent = held ? '投出！' : '抓／丟'; $('grabSub').textContent = held ? '對準發光出口' : '靠近顧客';
    $('objectiveText').textContent = held ? '對準橘色發光出口，再按「投出！」' : world.money >= world.goal ? '營業目標達成！維持秩序，撐到下班。' : `第 ${String(world.shop.settlement?.completedDay || world.profile.day)} 班 · 目標 $${world.goal}，完成訂單、維持店面。`;
    const prompt = $('targetPrompt'); prompt.style.opacity = c || held ? '1' : '0'; prompt.classList.toggle('angry', !!(held?.karen || c?.karen));
    $('crosshair').className = c ? c.karen ? 'target-red' : 'target-green' : '';
    if (c) { $('targetType').textContent = c.karen ? '奧客 · 請出店外' : '一般顧客'; $('targetText').textContent = c.karen ? '抓起 → 往出口投出' : '服務 +$15'; $('targetDistance').textContent = dist(c, world.player).toFixed(1) + 'm'; }
    if (held) { $('targetType').textContent = held.karen ? '已抓住奧客' : '這是一般顧客'; $('targetText').textContent = '再次按下，往出口投出'; $('targetDistance').textContent = ''; }
    $('serveBtn').style.boxShadow = c && !c.karen && !held ? '0 0 22px #a4f3bd50' : '';
    $('serveBtn').querySelector('small').textContent = c?.karen ? '+$5' : '+$15';
    const player = world.player;
    $('staminaBar').style.width = player.stamina + '%'; $('stamina').style.opacity = player.stamina < 98 ? '1' : '0';
    $('damage').style.opacity = settings.reduceMotion ? '0' : String(world.hit * .4); $('flash').style.opacity = settings.reduceMotion ? '0' : String(world.flash * .75);
    $('speedlines').style.opacity = settings.reduceMotion ? '0' : sprintTouch || keys.has('Shift') ? String(player.moving * .65) : '0';
    $('hint').style.opacity = now < hintUntil ? '1' : '0';
    if (now > bannerUntil) $('banner').classList.remove('visible');
    const marker = $('exitMarker'), point = renderer.project(EXIT.x, 2.1, EXIT.z - .1);
    const doorD = Math.hypot(player.x - EXIT.x, player.z - EXIT.z);
    if (held || point && doorD < 6 && point.x > 0 && point.x < renderer.width) {
      let x = point?.x, y = point?.y;
      if (!point || point.x < 40 || point.x > renderer.width - 40) {
        const a = Math.atan2(EXIT.x - player.x, -(EXIT.z - player.z)) - player.yaw;
        x = Math.atan2(Math.sin(a), Math.cos(a)) > 0 ? renderer.width - 45 : 45; y = renderer.height * .48;
      }
      marker.style.left = clamp(x, 45, renderer.width - 45) + 'px'; marker.style.top = clamp(y, 118, renderer.height - 145) + 'px'; marker.style.opacity = '1';
      $('exitDistance').textContent = doorD.toFixed(1) + 'm';
    } else marker.style.opacity = '0';
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i], age = now - f.start;
      if (age > 1.25) { f.el.remove(); floats.splice(i, 1); continue; }
      const pt = renderer.project(f.at.x, f.at.y + age * .35, f.at.z);
      if (pt) { f.el.style.display = ''; f.el.style.left = pt.x + 'px'; f.el.style.top = pt.y + 'px'; f.el.style.opacity = String(Math.min(1, (1.25 - age) * 2)); }
      else f.el.style.display = 'none';
    }
    updateBusinessHUD();
    minimap(now);
  }
  function setupInput() {
    const normalKey = e => e.key.length === 1 ? e.key.toLowerCase() : e.key;
    document.addEventListener('keydown', e => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const k = normalKey(e);
      if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
      keys.add(k);
      if (e.repeat) return;
      if (k === 'p' || k === 'Escape') { if (!$('helpMenu').classList.contains('hidden')) { $('closeHelpBtn').click(); return; } if (world.state === 'playing') pause(); else if (world.state === 'paused' && $('rotateNotice').classList.contains('hidden')) resume(); return; }
      if (k === 'g') action('drop'); if (k === 'e') action('serve'); if (k === ' ') action('grab'); if (k === 'q') action('spin'); if (k === 'r') action('ultimate');
    });
    document.addEventListener('keyup', e => keys.delete(normalKey(e)));
    const joystick = $('joystick');
    function updateStick(e) {
      const r = joystick.getBoundingClientRect(), radius = r.width * .32;
      let x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2, len = Math.hypot(x, y);
      if (len > radius) { x *= radius / len; y *= radius / len; }
      $('stick').style.transform = `translate(${x}px,${y}px)`;
      const force = Math.hypot(x, y) / radius, remap = force < .12 ? 0 : (force - .12) / .88;
      joy.side = len > 0 ? x / Math.max(.001, Math.hypot(x, y)) * remap : 0;
      joy.forward = len > 0 ? -y / Math.max(.001, Math.hypot(x, y)) * remap : 0;
    }
    joystick.addEventListener('pointerdown', e => { if (world.state !== 'playing' || joystickPointer !== null) return; e.preventDefault(); joystickPointer = e.pointerId; joystick.setPointerCapture(e.pointerId); updateStick(e); });
    joystick.addEventListener('pointermove', e => { if (e.pointerId === joystickPointer) { e.preventDefault(); updateStick(e); } });
    const releaseJoy = e => { if (e.pointerId !== joystickPointer) return; joystickPointer = null; joy.side = joy.forward = 0; $('stick').style.transform = ''; };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => joystick.addEventListener(ev, releaseJoy));
    const sprint = $('sprintBtn');
    sprint.addEventListener('pointerdown', e => { if (world.state !== 'playing') return; e.preventDefault(); sprintTouch = true; sprint.classList.add('active'); sprint.setPointerCapture(e.pointerId); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => sprint.addEventListener(ev, () => { sprintTouch = false; sprint.classList.remove('active'); }));
    document.querySelectorAll('[data-act]').forEach(b => {
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); action(b.dataset.act); });
      b.addEventListener('click', e => { if (e.detail === 0) action(b.dataset.act); });
    });
    for (const area of [canvas, $('lookArea')]) {
      area.addEventListener('pointerdown', e => {
        if (world.state !== 'playing' || e.button !== 0 || lookPointer) return;
        e.preventDefault(); sound.unlock();
        if (document.pointerLockElement === canvas) { action('grab'); return; }
        lookPointer = { id: e.pointerId, x: e.clientX, y: e.clientY }; area.setPointerCapture(e.pointerId);
        if (e.pointerType === 'mouse' && !settings.touch && canvas.requestPointerLock) {
          try { const p = canvas.requestPointerLock(); if (p?.catch) p.catch(() => hint('按住滑鼠拖曳即可轉頭；WASD 移動。')); } catch (_) { /* Drag-to-look stays available. */ }
        }
      });
      area.addEventListener('pointermove', e => {
        if (!lookPointer || lookPointer.id !== e.pointerId || document.pointerLockElement === canvas) return;
        e.preventDefault(); look(e.clientX - lookPointer.x, e.clientY - lookPointer.y); lookPointer.x = e.clientX; lookPointer.y = e.clientY;
      });
      const releaseLook = e => { if (lookPointer?.id === e.pointerId) lookPointer = null; };
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => area.addEventListener(ev, releaseLook));
      area.addEventListener('contextmenu', e => e.preventDefault());
    }
    document.addEventListener('mousemove', e => { if (document.pointerLockElement === canvas) look(e.movementX || 0, e.movementY || 0); });
    document.addEventListener('pointerlockchange', () => { const locked = document.pointerLockElement === canvas; lookPointer = null; if (previousLock && !locked && world.state === 'playing') pause(); previousLock = locked; });
    document.addEventListener('pointerlockerror', () => hint('滑鼠鎖定不可用，按住畫面拖曳轉頭即可。'));
    window.addEventListener('blur', () => { resetInput(); pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { resetInput(); pause(); } });
  }
  function setupMenus() {
    $('startBtn').addEventListener('click', start); $('againBtn').addEventListener('click', start); $('restartBtn').addEventListener('click', start);
    $('shopBtn').addEventListener('click', openUpgrade); $('resultShopBtn').addEventListener('click', openUpgrade);
    $('closeShopBtn').addEventListener('click', () => { $('upgradeMenu').classList.add('hidden'); $(shopReturn).classList.remove('hidden'); updateCareerUI(); });
    $('pauseBtn').addEventListener('click', pause); $('resumeBtn').addEventListener('click', resume);
    $('homeBtn').addEventListener('click', () => { world.reset(); world.state = 'ready'; world.events = []; hideMenus(); $('menu').classList.remove('hidden'); document.body.classList.add('in-menu'); sound.sync(); });
    $('helpBtn').addEventListener('click', openHelp); $('closeHelpBtn').addEventListener('click', () => { $('helpMenu').classList.add('hidden'); $(helpReturn).classList.remove('hidden'); });
    $('soundBtn').addEventListener('click', () => { settings.muted = !settings.muted; sound.unlock(); applySettings(); saveSettings(); });
    $('fullscreenBtn').addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) { await document.exitFullscreen(); return; }
        if (!document.documentElement.requestFullscreen) { hint('此瀏覽器不支援遊戲全螢幕。可隱藏網址列或加入主畫面，擴大遊戲區域。', 7); return; }
        await document.documentElement.requestFullscreen();
        if (coarse && screen.orientation?.lock) screen.orientation.lock('landscape').catch(() => {});
      } catch (_) { hint('請橫放手機；遊戲已按視窗大小滿版顯示。'); }
    });
    document.addEventListener('fullscreenchange', () => renderer?.resize());
    $('sensitivity').addEventListener('input', e => { settings.sensitivity = Number(e.target.value); $('sensitivityValue').textContent = settings.sensitivity.toFixed(1); saveSettings(); });
    $('quality').addEventListener('change', e => { settings.quality = e.target.value; applySettings(); saveSettings(); });
    $('reduceMotion').addEventListener('change', e => { settings.reduceMotion = e.target.checked; applySettings(); saveSettings(); });
    $('showTouch').addEventListener('change', e => { settings.touch = e.target.checked; applySettings(); saveSettings(); resetInput(); updateRotate(); });
    $('portraitBtn').addEventListener('click', () => { allowPortrait = true; updateRotate(); });
    $('reloadBtn').addEventListener('click', () => location.reload());
    window.addEventListener('resize', () => { renderer?.resize(); updateRotate(); });
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); pause(); $('fatalMessage').textContent = '繪圖連線暫時中斷，請按重新載入。可以先關閉其他分頁，或改用「流暢優先」。'; $('fatal').classList.remove('hidden'); });
  }
  function frame(timestamp) {
    const now = timestamp / 1000, dt = last ? Math.min(.05, now - last) : 0; last = now;
    try {
      const forward = joy.forward + (keys.has('w') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('s') || keys.has('ArrowDown') ? 1 : 0);
      const side = joy.side + (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
      world.step(dt, { forward, side, turn: (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0), sprint: sprintTouch || keys.has('Shift') });
      processEvents(now); renderer.render(world, now); updateHUD(now);
    } catch (error) { console.error(error); $('fatalMessage').textContent = '遊戲畫面遇到問題，請重新載入頁面。'; $('fatal').classList.remove('hidden'); return; }
    requestAnimationFrame(frame);
  }
  try {
    document.body.classList.add('in-menu'); world = new World(undefined, readSaved('byekarens-career-v1', null)); renderer = new BKRenderer.Renderer(canvas);
    applySettings(); updateBest(); updateCareerUI(); setupInput(); setupMenus(); updateRotate();
    $('loading').classList.add('hidden'); requestAnimationFrame(frame);
  } catch (error) {
    console.error(error); $('loading').classList.add('hidden'); $('fatalMessage').textContent = error.message; $('fatal').classList.remove('hidden'); $('reloadBtn').onclick = () => location.reload();
  }
})();
