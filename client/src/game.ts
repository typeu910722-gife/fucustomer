// In-game controller: first-person movement with local collision, interaction targeting,
// server-confirmed actions, HUD, overlays and snapshot handling.
import * as THREE from 'three';
import {
  INPUT_RATE, INTERACT_RANGE, KAREN_INFO, PRODUCT_INFO, QUICK_MESSAGES, RUN_SPEED, WALK_SPEED, shelfCapacity, EYE_HEIGHT,
} from '../../shared/constants.ts';
import { COFFEE_MACHINE, CRATES, MICROWAVE, MOP_RACK, REGISTERS, SHELVES, AABB, clampToStore, resolveCollision } from '../../shared/map.ts';
import type { ShiftResult } from '../../shared/career.ts';
import { BOSS_HOW, BOSS_PHASES } from '../../shared/constants.ts';
import { Tutorial, TutorialView } from './tutorial.ts';
import type { ActKind, ClientMsg, CustomerSnap, GameEvent, LobbyState, ServerMsg, Snapshot, Target } from '../../shared/protocol.ts';
import { audio } from './audio.ts';
import { Input } from './input.ts';
import { Minimap } from './minimap.ts';
import type { GameConnection, NetStatus } from './net.ts';
import { StoreView } from './render.ts';
import { Settings, saveCoopSave, saveLastSession, saveSettings, saveSoloSave } from './storage.ts';
import * as UI from './ui.ts';
import { desktop } from './platform.ts';

type Overlay = 'none' | 'pause' | 'shop' | 'quick' | 'summary' | 'settings' | 'help';

interface Candidate {
  label: string; target: Target; primary?: ActKind; alt?: ActKind; altLabel?: string; reason?: string;
  box?: AABB; point?: { x: number; z: number; r: number; h: number };
}

const $ = (id: string) => document.getElementById(id)!;
const fmtClock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let ridCounter = 0;
const newRid = () => `${Date.now().toString(36)}${(ridCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class Game {
  selfId = '';
  code = '';
  started = false;
  snap: Snapshot | null = null;
  lobby: LobbyState | null = null;
  private view: StoreView;
  private input: Input;
  private minimap: Minimap;
  private pos = { x: 18, z: 9.5 };
  private yaw = Math.PI;
  private pitch = 0;
  private bob = 0;
  private stepT = 0;
  private sendT = 0;
  private seq = 0;
  private overlay: Overlay = 'none';
  private target: Candidate | null = null;
  private lastActAt = 0;
  private raf = 0;
  private last = performance.now();
  private hudT = 0;
  private fpsFrames = 0; private fpsT = 0;
  private shopKey = '';
  private summaryKey = '';
  private corrections = 0;
  private status: NetStatus = 'connecting';
  private destroyed = false;
  private feed: { text: string; until: number }[] = [];
  private lastPhase = '';
  private stamina = 100;
  private slipT = 0;
  private hintUntil = 0;
  private resultSeen = false;
  finalResult: ShiftResult | null = null;
  private tutorial: Tutorial | null = null;
  private tut: TutorialView | null = null;

  constructor(private conn: GameConnection, private settings: Settings, private touch: boolean, private onExit: (reason?: string, result?: ShiftResult | null) => void) {
    const canvas = $('view') as HTMLCanvasElement;
    this.view = new StoreView(canvas, settings.quality, settings.fov);
    this.view.setQuality(settings.quality);
    this.input = new Input(canvas, touch);
    this.minimap = new Minimap($('minimap') as HTMLCanvasElement);
    conn.onMessage = m => this.onMessage(m);
    conn.onStatus = (s, d) => this.onStatus(s, d);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVis);
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.raf = requestAnimationFrame(this.frame);
    audio.unlock();
  }

  private onResize = () => this.view.resize();
  private onVis = () => {
    if (this.conn.solo && this.started) {
      if (document.hidden) { this.conn.send({ type: 'pause', paused: true }); audio.suspend(); }
      else { if (this.overlay !== 'pause') this.conn.send({ type: 'pause', paused: false }); audio.resume(); }
    } else if (document.hidden) audio.suspend(); else audio.resume();
  };
  private onLockChange = () => {
    // Losing pointer lock (Esc in browser) opens the menu on desktop.
    if (!this.touch && this.started && !this.input.locked && this.overlay === 'none' && !this.input.usingGamepad) this.openOverlay('pause');
  };

  /** Android back button: open the pause menu, or step back out of a menu. */
  back() {
    if (!this.started) return;
    if (this.overlay === 'none') this.openOverlay('pause');
    else if (this.overlay === 'settings' || this.overlay === 'help') this.openOverlay('pause');
    else if (this.overlay !== 'summary') this.closeOverlay();
  }
  /** App sent to the background: show the pause menu so play doesn't resume by surprise. */
  appPaused() { if (this.started && this.overlay === 'none') this.openOverlay('pause'); }

  send(m: ClientMsg) { this.conn.send(m); }

  // ---------------- network ----------------
  private onMessage(m: ServerMsg) {
    switch (m.type) {
      case 'welcome':
        this.selfId = m.playerId; this.code = m.code;
        if (!m.solo) desktop?.setPresence(m.code);
        if (!m.solo && 'url' in this.conn) {
          saveLastSession({ code: m.code, token: m.token, name: this.settings.name, url: (this.conn as unknown as { url: string }).url, at: Date.now() });
        }
        if (m.reconnected) this.toast('🔌 已重新連線，世界狀態已同步', 'good');
        break;
      case 'lobby':
        this.lobby = m.lobby;
        if (!m.lobby.started) this.showLobby();
        break;
      case 'snap': this.onSnap(m.s); break;
      case 'events': for (const e of m.list) this.onEvent(e); break;
      case 'actResult':
        if (!m.ok && m.reason) { this.toast(m.reason, 'bad', 1600); audio.play('error'); }
        if (this.overlay === 'shop' || this.overlay === 'summary') { this.shopKey = ''; this.summaryKey = ''; }
        break;
      case 'save':
        if (this.conn.solo) saveSoloSave(m.save); else saveCoopSave(m.save);
        break;
      case 'error':
        if (m.code === 'not_ready') this.toast(m.message, 'bad');
        else if (!this.started) this.exit(m.message);
        break;
      case 'closed':
        this.toast('伺服器維護中，嘗試重新連線…', 'bad', 5000);
        break;
    }
  }

  private onStatus(s: NetStatus, detail?: string) {
    this.status = s;
    const el = $('netstatus');
    if (s === 'online') el.classList.add('hidden');
    else if (s === 'offline') { saveLastSession(null); this.exit(detail ?? '連線中斷'); }
    else if (this.started) { el.classList.remove('hidden'); el.textContent = detail ?? '連線中…'; }
  }

  private showLobby() {
    if (!this.lobby || this.started) return;
    UI.lobbyScreen(this.lobby, this.selfId, {
      ready: r => this.send({ type: 'ready', ready: r }),
      start: () => this.send({ type: 'start' }),
      leave: () => { saveLastSession(null); this.exit(); },
      copy: () => { void navigator.clipboard?.writeText(this.lobby!.code); this.toast('已複製房間碼', 'good'); },
    });
  }

  private onSnap(s: Snapshot) {
    const first = !this.snap;
    this.snap = s;
    const me = s.players.find(p => p.id === this.selfId);
    if (!me) return;
    if (!this.started) {
      this.started = true;
      UI.hide();
      $('hud').classList.remove('hidden');
      if (this.touch) { $('touch').classList.remove('hidden'); document.body.classList.add('touch'); }
      else this.input.lock();
      audio.setMusicVolume(this.settings.music);
      audio.startMusic(s.shift.endless ? 7 : s.shift.boss ? 6 : s.shift.mode === 'shift' ? s.shift.chapter : 0);
    }
    if (first || !this.started) { this.pos = { x: me.x, z: me.z }; this.yaw = me.yaw; }
    // server reconciliation (the server clamps speed and resolves collisions)
    const err = Math.hypot(me.x - this.pos.x, me.z - this.pos.z);
    if (err > 1.5) { if (++this.corrections > 2) { this.pos = { x: me.x, z: me.z }; this.corrections = 0; } } else this.corrections = 0;
    if (s.result && !this.resultSeen) {
      this.resultSeen = true; this.finalResult = s.result;
      this.toast(s.result.won ? '🎉 下班囉！' : '😵 ' + s.result.failReason, s.result.won ? 'good' : 'bad');
      setTimeout(() => this.exit(), 1400);
    }
    if (s.phase !== this.lastPhase) {
      if (s.phase === 'summary' && s.shift.mode === 'day') this.openOverlay('summary');
      else if (this.lastPhase === 'summary' && this.overlay === 'summary') this.closeOverlay();
      this.lastPhase = s.phase;
    }
    if (this.overlay === 'shop') this.renderShop();
    if (this.overlay === 'summary') this.renderSummary();
  }

  private onEvent(e: GameEvent) {
    switch (e.e) {
      case 'toast': this.toast(e.text, e.tone ?? 'info'); break;
      case 'sfx': audio.play(e.name, e.x, e.z); if (e.name === 'clean' && e.x !== undefined) this.view.burst(e.x, e.z!, 0x99e9f2); break;
      case 'money': this.view.floatText(`+$${e.amount}`, e.x, e.z); this.view.burst(e.x, e.z, 0xffd43b, 10); break;
      case 'karen': audio.play('karen'); break;
      case 'quick': this.addFeed(`💬 ${e.from}：${e.text}`); audio.play('quick'); break;
      case 'phase':
        if (e.phase === 'prep' && this.snap && this.snap.shift.mode !== 'shift') this.toast(`☀ 第 ${e.day} 天・開店準備：採購(B)、補貨、升級，按 Enter 準備開店`, 'info', 5000);
        break;
      case 'hint': this.showHint(e.text); break;
      case 'fx':
        if (e.name === 'eject') { this.view.shockwave(e.x, e.z - 0.3, 0xff922b, 2.5); this.view.floatText(e.combo && e.combo > 1 ? `${e.combo} 連送！` : '退散！', e.x, e.z - 0.6, '#ffa94d'); this.view.burst(e.x, e.z - 0.4, 0xff922b, 26); this.view.shake = 0.25; if (e.combo && e.combo > 1) this.showCombo(e.combo); }
        else if (e.name === 'ultimate') { this.flash(false); this.view.shake = 0.65; this.view.burst(e.x, e.z, 0xffd43b, 40); this.view.shockwave(e.x, e.z, 0xffd43b, 6); }
        else if (e.name === 'spin') { this.view.burst(e.x, e.z, 0x63e6be, 30); this.view.shake = 0.2; this.view.shockwave(e.x, e.z, 0x63e6be, 3.2); }
        else if (e.name === 'mistake') { this.flash(true); this.view.shake = 0.4; }
        else if (e.name === 'impact') this.view.burst(e.x, e.z, 0xffd69a, 6);
        else if (e.name === 'throw') this.view.shake = 0.15;
        break;
    }
  }

  // ---------------- UI helpers ----------------
  toast(text: string, tone: 'good' | 'bad' | 'info' = 'info', ms = 2800) {
    const box = $('toasts');
    const d = document.createElement('div'); d.className = `toast ${tone}`; d.textContent = text;
    box.appendChild(d);
    while (box.childElementCount > 3) box.firstElementChild!.remove();
    setTimeout(() => d.remove(), ms);
  }
  private showHint(text: string) {
    const el = $('hintbar'); el.textContent = '💡 ' + text; el.classList.remove('hidden');
    this.hintUntil = performance.now() + 7000;
  }
  private flash(red: boolean) {
    const f = $('flash'); f.classList.toggle('red', red); f.style.opacity = red ? '0.45' : '0.85';
    setTimeout(() => { f.style.opacity = '0'; }, 160);
  }
  private comboTimer = 0;
  private showCombo(n: number) {
    const el = $('combo'); el.textContent = `${n} 連送！`; el.classList.remove('hidden');
    clearTimeout(this.comboTimer); this.comboTimer = window.setTimeout(() => el.classList.add('hidden'), 1600);
  }
  private addFeed(text: string) { this.feed.push({ text, until: performance.now() + 7000 }); if (this.feed.length > 5) this.feed.shift(); }

  private openOverlay(o: Overlay) {
    this.overlay = o;
    this.input.enabled = false;
    this.input.unlock();
    if (this.conn.solo && (o === 'pause' || o === 'settings' || o === 'help')) this.send({ type: 'pause', paused: true });
    this.shopKey = ''; this.summaryKey = '';
    switch (o) {
      case 'pause': UI.pauseMenu(this.conn.solo, this.code, {
        endShift: this.snap?.shift.endless ? () => { this.send({ type: 'endShift' }); this.closeOverlay(); } : undefined,
        resume: () => this.closeOverlay(),
        settings: () => this.openOverlay('settings'),
        help: () => this.openOverlay('help'),
        leave: () => { if (!this.conn.solo) saveLastSession(null); this.exit(); },
      }); break;
      case 'settings': UI.settingsMenu(this.settings, s => { this.applySettings(s); this.openOverlay('pause'); }, true); break;
      case 'help': UI.helpScreen(() => this.openOverlay('pause')); break;
      case 'quick': UI.quickMenu(i => { this.send({ type: 'quick', msg: i }); this.closeOverlay(); }, () => this.closeOverlay()); break;
      case 'shop': UI.show(`<div class="card wide"><div id="shop-body"></div><button class="btn primary" id="shop-close">關閉 (B)</button></div>`, 'screen overlay');
        $('shop-close').addEventListener('click', () => this.closeOverlay());
        this.renderShop(); break;
      case 'summary': UI.show(`<div class="card wide" id="sum-body"></div>`, 'screen overlay'); this.renderSummary(); break;
    }
  }

  private closeOverlay() {
    if (this.overlay === 'summary' && this.snap?.phase === 'summary') return; // must ready up
    this.overlay = 'none';
    UI.hide();
    this.input.enabled = true;
    this.input.clearPresses();
    if (this.conn.solo) this.send({ type: 'pause', paused: false });
    if (!this.touch) this.input.lock();
  }

  private applySettings(s: Settings) {
    this.settings = s; saveSettings(s);
    this.view.setQuality(s.quality);
    this.view.camera.fov = s.fov; this.view.camera.updateProjectionMatrix();
    audio.setVolume(s.volume); audio.setMusicVolume(s.music);
  }

  private wireShopButtons(container: HTMLElement) {
    container.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach(b => b.addEventListener('click', () => { this.send({ type: 'buy', rid: newRid(), item: b.dataset.buy! }); b.disabled = true; }));
    container.querySelectorAll<HTMLButtonElement>('[data-upg]').forEach(b => b.addEventListener('click', () => { this.send({ type: 'buy', rid: newRid(), item: 'upg_' + b.dataset.upg, level: Number(b.dataset.lv) }); b.disabled = true; }));
  }

  private renderShop() {
    const s = this.snap; if (!s) return;
    const allow = s.phase === 'prep' || s.phase === 'summary';
    const key = JSON.stringify([s.money, s.backstock, s.shelves, s.upgrades, allow]);
    if (key === this.shopKey) return;
    this.shopKey = key;
    const body = document.getElementById('shop-body'); if (!body) return;
    const scroll = body.parentElement!.scrollTop;
    body.innerHTML = UI.shopHtml(s, allow);
    this.wireShopButtons(body);
    body.parentElement!.scrollTop = scroll;
  }

  private renderSummary() {
    const s = this.snap; if (!s) return;
    const key = JSON.stringify([s.money, s.upgrades, s.backstock, s.players.map(p => p.ready + p.name)]);
    if (key === this.summaryKey) return;
    this.summaryKey = key;
    const body = document.getElementById('sum-body'); if (!body) return;
    const scroll = body.scrollTop;
    body.innerHTML = UI.summaryHtml(s, this.selfId);
    const shop = document.getElementById('sum-shop')!;
    shop.innerHTML = UI.shopHtml(s, true);
    this.wireShopButtons(shop);
    const me = s.players.find(p => p.id === this.selfId);
    $('sum-ready').addEventListener('click', () => this.send({ type: 'ready', ready: !me?.ready }));
    body.scrollTop = scroll;
  }

  // ---------------- targeting ----------------
  private candidates(s: Snapshot): Candidate[] {
    const me = s.players.find(p => p.id === this.selfId)!;
    const held = me.held;
    const out: Candidate[] = [];
    const cap = shelfCapacity(s.upgrades.shelves);
    for (const r of REGISTERS) {
      if (r.idx === 1 && !s.upgrades.register2) continue;
      const waiting = s.customers.find(c => c.state === 'atRegister' && Math.abs(c.x - r.customer.x) < 0.7 && Math.abs(c.z - r.customer.z) < 0.7);
      const box = { x0: r.x - 0.3, x1: r.x + 0.3, z0: r.z - 0.25, z1: r.z + 0.25, h: 1.4, kind: 'register' };
      out.push(waiting
        ? (this.pos.z > 11.2 ? { label: '收銀台', reason: '請繞到櫃台內側結帳', target: { t: 'register', idx: r.idx }, box }
          : { label: `結帳（${waiting.items} 件${waiting.kind === 'cutter' && !waiting.resolved ? '・⚠插隊奧客' : ''}）`, primary: 'checkout', target: { t: 'register', idx: r.idx }, box })
        : { label: `收銀台 ${r.idx + 1}`, reason: '目前沒有顧客等結帳', target: { t: 'register', idx: r.idx }, box });
    }
    const foodSlot = me.grabbing == null && (!held || ((held.kind === 'coffee' || held.kind === 'meal') && !me.held2));
    const sells = (f: 'coffee' | 'meal') => s.shift.foods.includes(f);
    if (sells('coffee')) out.push(!foodSlot ? { label: '咖啡機', reason: '雙手已滿（最多兩份餐點）', target: { t: 'coffee' }, box: COFFEE_MACHINE }
      : { label: '煮咖啡', primary: 'brew', target: { t: 'coffee' }, box: COFFEE_MACHINE });
    if (sells('meal')) out.push(!foodSlot ? { label: '微波爐', reason: '雙手已滿（最多兩份餐點）', target: { t: 'microwave' }, box: MICROWAVE }
      : s.backstock.bento <= 0 ? { label: '微波爐', reason: '便當缺貨，按 B 採購', target: { t: 'microwave' }, box: MICROWAVE }
      : { label: `加熱便當（倉庫 ${s.backstock.bento}）`, primary: 'heat', target: { t: 'microwave' }, box: MICROWAVE });
    for (const c of CRATES) {
      const name = PRODUCT_INFO[c.product].name;
      const t: Target = { t: 'crate', product: c.product };
      if (held?.kind === 'box' && held.product === c.product) out.push({ label: `放回${name}貨箱`, primary: 'returnBox', target: t, box: c.box });
      else if (held) out.push({ label: `${name}貨箱`, reason: '手上有東西', target: t, box: c.box });
      else if (s.backstock[c.product] <= 0) out.push({ label: `${name}貨箱`, reason: '倉庫沒貨了，按 B 採購', target: t, box: c.box });
      else out.push({ label: `拿${name}貨箱（倉庫 ${s.backstock[c.product]}）`, primary: 'takeBox', target: t, box: c.box });
    }
    for (const sh of SHELVES) {
      const name = PRODUCT_INFO[sh.product].name;
      const t: Target = { t: 'shelf', product: sh.product };
      const info = `${name}貨架 ${s.shelves[sh.product]}/${cap}`;
      if (held?.kind === 'box' && held.product === sh.product) out.push(s.shelves[sh.product] >= cap ? { label: info, reason: '貨架已滿', target: t, box: sh.box } : { label: `上架（${info}）`, primary: 'stock', target: t, box: sh.box });
      else if (held?.kind === 'box') out.push({ label: info, reason: '商品種類不符', target: t, box: sh.box });
      else out.push({ label: info, reason: s.shelves[sh.product] < cap / 3 ? '快沒貨了！去倉庫拿貨箱' : undefined, target: t, box: sh.box });
    }
    if (held?.kind === 'mop') out.push({ label: '放回拖把', primary: 'returnMop', target: { t: 'mop' }, box: MOP_RACK });
    else if (held) out.push({ label: '拖把架', reason: '手上有東西', target: { t: 'mop' }, box: MOP_RACK });
    else out.push(s.mopsOnRack > 0 ? { label: '拿拖把', primary: 'takeMop', target: { t: 'mop' }, box: MOP_RACK } : { label: '拖把架', reason: '拖把都被拿走了', target: { t: 'mop' }, box: MOP_RACK });
    for (const c of s.customers) {
      const cand = this.customerCandidate(c, [held?.kind ?? null, me.held2?.kind ?? null], s.money);
      if (cand) out.push(cand);
    }
    for (const sp of s.spills) out.push(held?.kind === 'mop' ? { label: '清理髒污', primary: 'clean', target: { t: 'spill', id: sp.id }, point: { x: sp.x, z: sp.z, r: 0.55, h: 0 } }
      : { label: '髒污', reason: '需要拖把（西側牆邊）', target: { t: 'spill', id: sp.id }, point: { x: sp.x, z: sp.z, r: 0.55, h: 0 } });
    for (const it of s.items) {
      const name = it.held.kind === 'box' ? `${PRODUCT_INFO[it.held.product].name}貨箱` : it.held.kind === 'mop' ? '拖把' : '咖啡';
      out.push(held ? { label: name, reason: '手上有東西', target: { t: 'item', id: it.id }, point: { x: it.x, z: it.z, r: 0.45, h: 0.3 } }
        : { label: `撿起${name}`, primary: 'pickup', target: { t: 'item', id: it.id }, point: { x: it.x, z: it.z, r: 0.45, h: 0.3 } });
    }
    return out;
  }

  private customerCandidate(c: CustomerSnap, hands: (string | null)[], money: number): Candidate | null {
    const pos = this.view.customerWorldPos(c.id) ?? c;
    const point = { x: pos.x, z: pos.z, r: 0.45, h: 1.8 };
    const t: Target = { t: 'customer', id: c.id };
    if (c.state === 'leaving' || c.flying || c.held) return null;
    if (c.kind === 'boss' && !c.resolved) {
      const ph = `奧客之王・${BOSS_PHASES[c.phase]}`;
      if (c.phase === 1) return ['queue', 'toRegister', 'atRegister'].includes(c.state) ? { label: `請${ph}排隊`, primary: 'askQueue', target: t, point } : { label: ph, reason: '他正衝向隊伍最前面', target: t, point };
      if (c.phase === 2) return c.state === 'complain' ? { label: `安撫${ph}（怒氣 ${c.anger}）`, primary: 'calm', target: t, point } : { label: ph, reason: '正走向服務台', target: t, point };
      if (c.phase === 3) return { label: `制止${ph}`, primary: 'stopFilm', target: t, point };
      if (c.phase === 4) return { label: ph, reason: '先處理他叫來的小弟！', target: t, point };
      return { label: ph, reason: '抓起來丟出門，或全店退散！', target: t, point };
    }
    if (c.kind !== 'normal' && !c.resolved && c.revealed) {
      const name = KAREN_INFO[c.kind].name;
      if (c.kind === 'rager') return c.state === 'complain' ? { label: `安撫${name}（怒氣 ${c.anger}）`, primary: 'calm', alt: 'coupon', altLabel: money >= 30 ? '發折價券 $30' : undefined, target: t, point } : { label: name, reason: '正走向服務台', target: t, point };
      if (c.kind === 'cutter') return ['queue', 'toRegister', 'atRegister'].includes(c.state) ? { label: `請${name}重新排隊`, primary: 'askQueue', target: t, point } : { label: name, reason: '還在挑商品', target: t, point };
      if (c.kind === 'streamer') return { label: `請${name}停止拍攝`, primary: 'stopFilm', target: t, point };
      if (c.kind === 'hog') return { label: `請${name}先結帳`, primary: 'checkBag', target: t, point };
      if (c.kind === 'litterer') return { label: `請${name}不要亂丟`, primary: 'stopLitter', target: t, point };
    }
    if (c.state === 'waitFood' && c.want) {
      const name = c.want === 'meal' ? '熱便當' : '咖啡';
      return hands.includes(c.want) ? { label: `交付${name}`, primary: 'deliver', target: t, point }
        : { label: `等${name}的顧客`, reason: c.want === 'meal' ? '去微波爐加熱便當' : '去咖啡機煮一杯', target: t, point };
    }
    if (this.canGrab() && c.kind === 'normal') return { label: '一般顧客', reason: '別亂丟一般顧客喔', target: t, point };
    if (c.state === 'atRegister') return { label: '等結帳的顧客', reason: '到櫃台內側對收銀機互動', target: t, point };
    return null;
  }

  private canGrab() { return !!this.snap?.shift.abilities.includes('grab'); }
  private karenTarget(s: Snapshot): CustomerSnap | null {
    // grab/throw aims at the nearest customer in front of the crosshair (karens first)
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let best: CustomerSnap | null = null, bs = Infinity;
    for (const c of s.customers) {
      if (c.held || c.flying || c.state === 'leaving') continue;
      const px = c.x - this.pos.x, pz = c.z - this.pos.z;
      const along = px * fx + pz * fz, perp = Math.abs(px * fz - pz * fx);
      if (along < -0.2 || along > 2.4 || perp > 0.7) continue;
      const score = along + perp + (c.kind === 'normal' ? 1.5 : 0);
      if (score < bs) { bs = score; best = c; }
    }
    return best;
  }

  private pickTarget(s: Snapshot): Candidate | null {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const ox = this.pos.x, oz = this.pos.z;
    const range = INTERACT_RANGE + 0.3;
    let best: Candidate | null = null, bestT = Infinity;
    const eyeDirY = Math.sin(this.pitch);
    for (const c of this.candidates(s)) {
      let t = Infinity;
      if (c.box) {
        const pad = 0.15;
        const b = { x0: c.box.x0 - pad, x1: c.box.x1 + pad, z0: c.box.z0 - pad, z1: c.box.z1 + pad };
        t = rayBox(ox, oz, fx, fz, b);
      } else if (c.point) {
        const px = c.point.x - ox, pz = c.point.z - oz;
        const along = px * fx + pz * fz;
        const perp = Math.abs(px * fz - pz * fx);
        const r = c.point.r + (c.point.h === 0 && eyeDirY < -0.35 ? 0.25 : 0);
        if (along > -0.2 && perp < r) t = Math.max(0, along - 0.3);
        // looking up/down filter: floor items need the player to look somewhat down when far
        if (c.point.h === 0 && along > 1.2 && eyeDirY > 0.2) t = Infinity;
      }
      if (t <= range && t < bestT) { bestT = t; best = c; }
    }
    return best;
  }

  // ---------------- frame ----------------
  private perfT = 0; private perfFrames = 0;
  private frame = (now: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) return; // never render in the background (battery)
    const cap = this.settings.fpsCap ?? 0;
    if (cap > 0 && now - this.last < 1000 / cap - 2) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // dynamic resolution: drop pixel ratio when the device can't keep up, raise it again when it can
    if (this.settings.adaptive !== false && this.started) {
      this.perfT += dt; this.perfFrames++;
      if (this.perfT >= 2) {
        const fps = this.perfFrames / this.perfT, target = cap > 0 ? cap : 60;
        if (fps < target * 0.75 && this.view.resScale > 0.5) this.view.setResolutionScale(this.view.resScale - 0.1);
        else if (fps > target * 0.95 && this.view.resScale < 1) this.view.setResolutionScale(this.view.resScale + 0.05);
        this.perfT = 0; this.perfFrames = 0;
      }
    }
    this.input.update(dt);
    const s = this.snap;
    if (!this.started || !s) { this.view.render(); return; }
    const me = s.players.find(p => p.id === this.selfId);
    if (!me) { this.view.render(); return; }

    // global hotkeys
    if (this.input.consume('menu')) { if (this.overlay === 'none') this.openOverlay('pause'); else if (this.overlay !== 'summary') this.closeOverlay(); }
    if (this.input.consume('shop')) { if (this.overlay === 'none') this.openOverlay('shop'); else if (this.overlay === 'shop') this.closeOverlay(); }
    if (this.input.consume('quick')) { if (this.overlay === 'none') this.openOverlay('quick'); else if (this.overlay === 'quick') this.closeOverlay(); }

    if (this.overlay === 'none') {
      const look = this.input.takeLook();
      const sens = 0.0024 * this.settings.sensitivity;
      this.yaw -= look.dx * sens;
      this.pitch += (this.settings.invertY ? look.dy : -look.dy) * sens;
      this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));
      // movement relative to view
      const mv = this.input.move;
      const sh = s.shift;
      const wantsRun = this.input.run && Math.hypot(mv.x, mv.y) > 0.05 && this.stamina > 3;
      this.stamina = Math.max(0, Math.min(sh.staminaMax, this.stamina + (wantsRun ? -25 : 17 * sh.staminaRegen) * dt));
      this.slipT = Math.max(0, this.slipT - dt);
      if (wantsRun && this.slipT === 0 && this.stamina > 30 && s.spills.some(sp => Math.hypot(sp.x - this.pos.x, sp.z - this.pos.z) < 0.5)) {
        this.slipT = 0.65; this.stamina -= 28; this.view.shake = 0.3; this.showHint('踩到髒污滑了一跤！拿拖把把它拖乾淨。'); audio.play('splat');
      }
      const carrying = me.held?.kind === 'box' || me.grabbing != null ? 0.85 : 1;
      const speed = (wantsRun ? RUN_SPEED : WALK_SPEED) * sh.speed * carrying * (this.slipT > 0 ? 0.42 : 1);
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
      const dx = (fx * mv.y + rx * mv.x) * speed * dt, dz = (fz * mv.y + rz * mv.x) * speed * dt;
      const moving = Math.hypot(dx, dz) > 1e-4;
      if (moving) {
        let p = resolveCollision(this.pos.x + dx, this.pos.z + dz);
        p = clampToStore(p.x, p.z);
        this.pos = p;
        this.bob += dt * (this.input.run ? 13 : 9);
        this.stepT -= dt;
        if (this.stepT <= 0) { audio.play('step'); this.stepT = this.input.run ? 0.3 : 0.45; }
      }
      // actions
      this.target = this.pickTarget(s);
      const busy = !!me.busy;
      if (this.input.consume('interact') || (this.input.holdInteract && !busy && now - this.lastActAt > 650)) {
        if (this.target?.primary && !busy) {
          this.send({ type: 'act', rid: newRid(), kind: this.target.primary, target: this.target.target });
          this.lastActAt = now;
        } else if (this.target?.reason && now - this.lastActAt > 650) { this.lastActAt = now; }
      }
      if (this.input.consume('alt')) {
        if (this.target?.alt && this.target.altLabel) this.send({ type: 'act', rid: newRid(), kind: this.target.alt, target: this.target.target });
        else if (me.held) this.send({ type: 'drop', rid: newRid() });
      }
      if (this.input.consume('drop') && (me.held || me.held2 || me.grabbing != null || me.busy)) this.send({ type: 'drop', rid: newRid() });
      if (this.input.consume('grab')) {
        if (!this.canGrab()) this.toast('「抓起／投擲」在 Lv.11 資深店員解鎖', 'info', 1800);
        else if (me.grabbing != null) this.send({ type: 'throw', rid: newRid(), yaw: this.yaw, pitch: this.pitch });
        else { const k = this.karenTarget(s); if (k) this.send({ type: 'act', rid: newRid(), kind: 'grab', target: { t: 'customer', id: k.id } }); else this.toast('準星對準身前的顧客再抓', 'info', 1400); }
      }
      if (this.input.consume('spin')) this.send({ type: 'spin', rid: newRid() });
      if (this.input.consume('ultimate')) this.send({ type: 'ultimate', rid: newRid() });
      if (this.input.consume('ping')) this.doPing();
      if (this.input.consume('ready') && (s.phase === 'prep' || s.phase === 'summary')) this.send({ type: 'ready', ready: !me.ready });
      for (let i = 1; i <= 6; i++) if (this.input.consume(`q${i}` as 'q1')) this.send({ type: 'quick', msg: i - 1 });
    } else {
      this.input.takeLook();
      this.target = null;
      if (this.overlay === 'quick') for (let i = 1; i <= 6; i++) if (this.input.consume(`q${i}` as 'q1')) { this.send({ type: 'quick', msg: i - 1 }); this.closeOverlay(); }
    }

    // send position at INPUT_RATE
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / INPUT_RATE;
      this.send({ type: 'input', x: this.pos.x, z: this.pos.z, yaw: this.yaw, pitch: this.pitch, seq: this.seq++ });
    }

    audio.listener = { x: this.pos.x, z: this.pos.z };
    this.view.update(s, this.selfId, dt, () => null);
    this.view.setCamera(this.pos.x, this.pos.z, this.yaw, this.pitch, this.bob, me.held);
    this.view.setSecondHand(me.held2);
    const tb = this.target?.box ? new THREE.Box3(new THREE.Vector3(this.target.box.x0, 0, this.target.box.z0), new THREE.Vector3(this.target.box.x1, this.target.box.h ?? 1.5, this.target.box.z1))
      : this.target?.point ? new THREE.Box3(new THREE.Vector3(this.target.point.x - 0.35, 0, this.target.point.z - 0.35), new THREE.Vector3(this.target.point.x + 0.35, Math.max(0.15, this.target.point.h), this.target.point.z + 0.35)) : null;
    this.view.setHighlight(tb);
    if (!this.tutorial && s.shift.id === '1-1') this.tutorial = new Tutorial(this.touch);
    this.tut = this.tutorial ? this.tutorial.update(s, me, this.pos, now) : null;
    this.view.setGuide(this.tut?.target ?? null);
    this.view.render();
    this.minimap.draw(s, this.selfId, { x: this.pos.x, z: this.pos.z, yaw: this.yaw }, now / 1000, this.tut?.target ?? null);

    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.1; this.updateHud(s, me); }
    this.fpsFrames++; this.fpsT += dt;
    if (this.fpsT >= 1) { $('fps').textContent = this.settings.showFps ? `${this.fpsFrames} FPS` : ''; this.fpsFrames = 0; this.fpsT = 0; }
  };

  private doPing() {
    let x: number, z: number;
    const tp = this.target?.point ?? (this.target?.box ? { x: (this.target.box.x0 + this.target.box.x1) / 2, z: (this.target.box.z0 + this.target.box.z1) / 2 } : null);
    if (tp) { x = tp.x; z = tp.z; }
    else {
      const dirY = Math.sin(this.pitch);
      const horiz = Math.cos(this.pitch);
      const dist = dirY < -0.05 ? Math.min(20, EYE_HEIGHT / -dirY * horiz) : 6;
      x = this.pos.x + Math.sin(this.yaw) * dist; z = this.pos.z + Math.cos(this.yaw) * dist;
    }
    this.send({ type: 'ping', x, z });
  }

  private updateHud(s: Snapshot, me: Snapshot['players'][number]) {
    $('h-day').textContent = `第 ${s.day} 天`;
    $('h-clock').textContent = s.phase === 'prep' ? `準備 ${fmtSec(s.phaseLeft)}` : s.phase === 'closing' ? `打烊中 ${fmtSec(s.phaseLeft)}` : s.phase === 'summary' ? '日結' : `🕒 ${fmtClock(s.clock)}`;
    $('h-money').textContent = `💰 $${s.money}`;
    $('h-rating').textContent = `★ ${s.rating.toFixed(1)}`;
    $('h-players').textContent = `👥 ${s.players.filter(p => p.connected).length}/5`;
    const cap = shelfCapacity(s.upgrades.shelves);
    $('h-stock').innerHTML = (['drinks', 'snacks', 'bento'] as const).map(p => {
      const r = s.shelves[p] / cap;
      return `<div class="stockrow"><span>${PRODUCT_INFO[p].name}</span><span>${s.shelves[p]}/${cap}・倉 ${s.backstock[p]}</span></div><div class="bar"><i style="width:${r * 100}%;background:${r < 0.3 ? '#ff6b6b' : '#4dabf7'}"></i></div>`;
    }).join('') + `<div class="stockrow"><span>🧹 拖把</span><span>${s.mopsOnRack}/2</span></div><div class="stockrow"><span>💧 髒污</span><span>${s.spills.length}</span></div>`;
    $('h-team').innerHTML = s.players.map(p => {
      const held = p.held ? (p.held.kind === 'box' ? '📦' : p.held.kind === 'coffee' ? '☕' : '🧹') : '';
      const st = !p.connected ? '📶' : p.away ? '💤' : p.busy ? '⏳' : '';
      return `<div class="stockrow"><span style="color:#${p.color.toString(16).padStart(6, '0')}">● ${UI.esc(p.name)}${p.id === this.selfId ? '（你）' : ''}</span><span>${held}${st}${(s.phase === 'prep' || s.phase === 'summary') ? (p.ready ? '✅' : '') : ''}</span></div>`;
    }).join('');
    // prompt
    const pr = $('prompt');
    if (this.overlay !== 'none') pr.innerHTML = '';
    else if (me.busy) pr.innerHTML = '';
    else if (this.target) {
      const key = this.touch ? '互動' : this.input.usingGamepad ? 'A' : 'E';
      const altKey = this.touch ? '次要' : this.input.usingGamepad ? 'X' : 'F';
      pr.innerHTML = (this.target.primary ? `<span class="key">${key}</span>${UI.esc(this.target.label)}` : UI.esc(this.target.label))
        + (this.target.reason ? `<div class="sub">${UI.esc(this.target.reason)}</div>` : '')
        + (this.target.altLabel ? `<div class="sub"><span class="key">${altKey}</span>${UI.esc(this.target.altLabel)}</div>` : '');
    } else pr.innerHTML = me.held ? `<div class="sub">${this.touch ? '「放下」' : this.input.usingGamepad ? 'B' : 'Q'} 放下手上物品</div>` : '';
    const prog = $('progress');
    if (me.busy) { prog.classList.remove('hidden'); (prog.firstElementChild as HTMLElement).style.width = `${me.busy.p * 100}%`; } else prog.classList.add('hidden');
    // touch contextual buttons
    if (this.touch) {
      $('t-alt').classList.toggle('hidden', !this.target?.altLabel);
      $('t-item').classList.toggle('hidden', !me.held);
      $('t-interact').textContent = this.target?.primary ? shortLabel(this.target.primary) : '互動';
    }
    // karen alert
    const karens = s.customers.filter(c => c.kind !== 'normal' && !c.resolved && c.revealed && c.state !== 'leaving');
    const al = $('alert');
    const boss = karens.find(k => k.kind === 'boss');
    if (boss) {
      al.classList.remove('hidden');
      al.innerHTML = `👑 奧客之王 第 ${boss.phase}/5 階段「${BOSS_PHASES[boss.phase]}」${boss.phase === 2 ? `（怒氣 ${boss.anger}）` : ''}<div style="font-size:13px;font-weight:600">${BOSS_HOW[boss.phase]}</div>`;
    } else if (karens.length) {
      const k = karens[0];
      const info = KAREN_INFO[k.kind as keyof typeof KAREN_INFO];
      al.classList.remove('hidden');
      al.innerHTML = `⚠ ${info.name}${k.kind === 'rager' ? `（怒氣 ${k.anger}/100）` : ''}${karens.length > 1 ? ` 等 ${karens.length} 個事件` : ''}<div style="font-size:13px;font-weight:600">${info.how}</div>`;
    } else al.classList.add('hidden');
    // phase banner
    const pb = $('phasebanner');
    if (s.phase === 'prep' && s.shift.mode === 'shift') {
      const html = `<button class="btn small good" id="pb-ready">▶ 開始上班${this.touch ? '' : ' [Enter]'}（<span id="pb-left"></span>）</button>`;
      if (pb.dataset.k !== html) {
        pb.dataset.k = html; pb.innerHTML = html;
        document.getElementById('pb-ready')!.addEventListener('click', () => this.send({ type: 'ready', ready: true }));
      }
      $('pb-left').textContent = String(Math.ceil(s.phaseLeft));
    } else if (s.phase === 'prep') {
      const ready = s.players.filter(p => p.ready).length, total = s.players.filter(p => p.connected).length;
      const html = `<button class="btn small ${me.ready ? '' : 'good'}" id="pb-ready">${me.ready ? '取消準備' : '準備開店'}（${ready}/${total}）${this.touch ? '' : ' [Enter]'}</button><button class="btn small" id="pb-shop">🛒 採購/升級${this.touch ? '' : ' [B]'}</button>`;
      if (pb.dataset.k !== html) {
        pb.dataset.k = html; pb.innerHTML = html;
        document.getElementById('pb-ready')!.addEventListener('click', () => this.send({ type: 'ready', ready: !this.snap?.players.find(p => p.id === this.selfId)?.ready }));
        document.getElementById('pb-shop')!.addEventListener('click', () => this.openOverlay('shop'));
      }
    } else if (pb.dataset.k) { pb.dataset.k = ''; pb.innerHTML = ''; }
    // chaos warning vignette
    const vg = $('vignette');
    const danger = Math.max(0, (s.chaos - 55) / 45);
    vg.style.opacity = danger > 0 ? String(0.35 + danger * 0.65) : '0';
    vg.classList.toggle('pulse', s.chaos >= 80);
    // shift HUD
    const shiftMode = s.shift.mode === 'shift';
    $('shiftbar').classList.toggle('hidden', !shiftMode);
    document.body.classList.toggle('shiftmode', shiftMode);
    if (shiftMode) {
      $('sb-title').textContent = `${s.shift.id}・${s.shift.title}`;
      $('sb-extra').textContent = `口碑 ★${s.rating.toFixed(1)}・現金 $${s.money}`;
      const elapsed = Math.round(s.shift.length - s.phaseLeft);
      $('sb-time').textContent = s.phase === 'prep' ? `準備 ${Math.ceil(s.phaseLeft)}` : s.phase !== 'open' ? '收尾中' : s.shift.endless ? `🌙 已撐 ${elapsed} 秒` : `⏱ ${Math.ceil(s.phaseLeft)} 秒`;
      const rev = s.dayStats.revenue;
      $('sb-money').textContent = s.shift.endless ? `$${rev}・分數約 ${rev + s.dayStats.ejected * 10 + s.dayStats.karensResolved * 15 + Math.max(0, elapsed)}` : `$${rev} / $${s.shift.goal}`;
      ($('sb-moneybar') as HTMLElement).style.width = s.shift.endless ? '100%' : `${Math.min(100, rev / s.shift.goal * 100)}%`;
      ($('sb-moneybar') as HTMLElement).style.background = rev >= s.shift.goal ? '#51cf66' : '#4dabf7';
      $('sb-chaos').textContent = `${s.chaos}%`;
      ($('sb-chaosbar') as HTMLElement).style.width = `${s.chaos}%`;
      $('h-day').textContent = s.shift.endless ? '無限夜班' : `第 ${s.shift.chapter} 章`;
    }
    const hasUlt = s.shift.abilities.includes('ultimate');
    $('burst').classList.toggle('hidden', !hasUlt);
    if (hasUlt) {
      $('burst-num').textContent = `${s.burst}/100`;
      ($('burst-bar') as HTMLElement).style.width = `${s.burst}%`;
      $('burst').classList.toggle('full', s.burst >= 100);
      $('burst-hint').textContent = s.burst >= 100 ? `按 ${this.touch ? '「退散」' : 'R'} 全店奧客退散！` : '請出門 +25・旋風 +12・投擲 +4';
    }
    (($('stamina').firstElementChild) as HTMLElement).style.width = `${this.stamina / s.shift.staminaMax * 100}%`;
    (($('stamina').firstElementChild) as HTMLElement).style.background = this.stamina < 25 ? '#ff6b6b' : '#69db7c';
    const es = $('eventstrip');
    if (s.event) { es.classList.remove('hidden'); es.textContent = s.event.kind === 'outage' ? `⚡ 停電中 ${Math.ceil(s.event.left)}s` : `🚶 尖峰人潮 ${Math.ceil(s.event.left)}s`; } else es.classList.add('hidden');
    if (this.tut) {
      const hb = $('hintbar'); hb.classList.remove('hidden');
      hb.textContent = `📘 教學 ${Math.min(this.tut.step, this.tut.total)}/${this.tut.total}：${this.tut.text}`;
    } else if (performance.now() > this.hintUntil) $('hintbar').classList.add('hidden');
    if (this.touch) {
      const ab = s.shift.abilities;
      $('t-grab').classList.toggle('hidden', !ab.includes('grab'));
      $('t-grab').textContent = me.grabbing != null ? '丟出' : '抓起';
      $('t-spin').classList.toggle('hidden', !ab.includes('spin'));
      $('t-spin').textContent = me.spinCd > 0 ? `${Math.ceil(me.spinCd)}` : '旋風';
      $('t-ult').classList.toggle('hidden', !ab.includes('ultimate'));
      $('t-ult').classList.toggle('active', s.burst >= 100);
      $('t-item').classList.toggle('hidden', !me.held && !me.held2 && me.grabbing == null);
    }
    if (me.grabbing != null) pr.innerHTML = `<span class="key">${this.touch ? '丟出' : this.input.usingGamepad ? 'Y' : '空白'}</span>對準發光的出口丟出去！<div class="sub">${this.touch ? '「放下」' : 'G'} 放開</div>`;
    // feed
    const t = performance.now();
    this.feed = this.feed.filter(f => f.until > t);
    $('feed').innerHTML = this.feed.map(f => `<div class="feedline">${UI.esc(f.text)}</div>`).join('');
  }

  exit(reason?: string) {
    if (this.destroyed) return;
    this.destroyed = true;
    desktop?.setPresence(null);
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVis);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.input.unlock();
    this.conn.close();
    audio.stopMusic();
    $('hud').classList.add('hidden'); $('touch').classList.add('hidden'); $('netstatus').classList.add('hidden');
    document.body.classList.remove('shiftmode');
    this.view.renderer.dispose();
    this.onExit(reason, this.finalResult);
  }
}

function shortLabel(k: ActKind) {
  const m: Partial<Record<ActKind, string>> = { checkout: '結帳', brew: '煮咖啡', deliver: '交付', takeBox: '拿貨', stock: '上架', returnBox: '放回', takeMop: '拿拖把', returnMop: '放回', clean: '清理', calm: '安撫', coupon: '折價券', askQueue: '請排隊', stopFilm: '制止', checkBag: '請結帳', pickup: '撿起' };
  return m[k] ?? '互動';
}

/** 2D ray vs AABB; returns distance or Infinity. */
function rayBox(ox: number, oz: number, dx: number, dz: number, b: { x0: number; x1: number; z0: number; z1: number }) {
  let tmin = -Infinity, tmax = Infinity;
  for (const [o, d, lo, hi] of [[ox, dx, b.x0, b.x1], [oz, dz, b.z0, b.z1]] as const) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  }
  if (tmax < Math.max(0, tmin)) return Infinity;
  return Math.max(0, tmin);
}

export { QUICK_MESSAGES };
