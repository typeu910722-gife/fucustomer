// In-game controller: first-person movement with local collision, interaction targeting,
// server-confirmed actions, HUD, overlays and snapshot handling.
import * as THREE from 'three';
import {
  FOOD_INFO, INPUT_RATE, INTERACT_RANGE, KAREN_INFO, PRODUCT_INFO, PRODUCTS, QUICK_ICONS, QUICK_MESSAGES, QUICK_MIN_GAP_MS, RUN_SPEED, WALK_SPEED, shelfCapacity, EYE_HEIGHT,
} from '../../shared/constants.ts';
import { applyMap, CURRENT_MAP, COFFEE_MACHINE, CRATES, MICROWAVE, MOP_RACK, REGISTERS, SHELVES, AABB, clampToStore, resolveCollision } from '../../shared/map.ts';
import type { ShiftResult } from '../../shared/career.ts';
import { BOSS_HOW, BOSS_PHASES, EMPTY_SHELF_GRACE } from '../../shared/constants.ts';
import { NEAR_EMPTY, ShelfWatch } from './shelfwatch.ts';
import { NEED_LABEL, SIG_KARENS, SigNeed, isSig, sigWaitReason } from '../../shared/sigkarens.ts';
import { DEX_SPEAKER, aftermathLine } from '../../shared/karendex.ts';
import { COINS, bagmanAtDoor, changeDue, changeOptions } from '../../shared/genkarens.ts';
import { Tutorial, TutorialView } from './tutorial.ts';
import type { ActKind, ClientMsg, CustomerSnap, GameEvent, LobbyState, ServerMsg, Snapshot, Target } from '../../shared/protocol.ts';
import { audio } from './audio.ts';
import { Input } from './input.ts';
import { Minimap } from './minimap.ts';
import type { GameConnection, NetStatus } from './net.ts';
import { StoreView, setNamedRegular } from './render.ts';
import { Settings, loadFlags, saveCoopSave, saveFlags, saveLastSession, saveSettings, saveSoloSave } from './storage.ts';
import { maybeAutoBackup } from './cloudsave.ts';
import * as UI from './ui.ts';
import { desktop } from './platform.ts';
import { inputMode, keyOf, padStyle, rumble, setRumble } from './pad.ts';
import { BTN, actionLabel, controlsLine, promptDevice, promptKey, qteGlyph, qteHelp, setControlsContext } from './padmap.ts';
import { EmoteWheel } from './emote-wheel.ts';
import { JuiceKind, RateLimit, TimeWarp, juiceProfile, stampText, throwStrength } from './juice.ts';
import { STORE_D } from '../../shared/map.ts';

// 常客奧客 / in-store story / 商城 decor for this shift: set by the menu before the game starts (shift-ctx.ts)
import { shiftCtx } from './shift-ctx.ts';
export type { ShiftRegular } from './shift-ctx.ts';

type Overlay = 'none' | 'pause' | 'shop' | 'quick' | 'summary' | 'settings' | 'help' | 'team';

interface Candidate {
  label: string; target: Target; primary?: ActKind; alt?: ActKind; altLabel?: string; reason?: string;
  box?: AABB; point?: { x: number; z: number; r: number; h: number };
}

const $ = (id: string) => document.getElementById(id)!;
// (the 跨年夜 clock runs past midnight: 24:10 shows as 00:10)
const fmtClock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
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
  private flags = loadFlags();
  private shelfWatch = new ShelfWatch();
  private shelfGuide: { x: number; z: number } | null = null;
  private stockHtml = '';
  private teamHtml = '';
  private introTimers: number[] = [];
  /** T / View: the 8-slot quick message wheel (multiplayer). */
  private wheel: EmoteWheel;
  private lastQuickAt = 0;
  /** Recent quick messages received (sender id, text) — read by the browser tests. */
  quickLog: { id: string; text: string; at: number }[] = [];
  /** After a reconnect, take the server's position on the next snapshot (no rubber-banding back). */
  private resyncPos = false;
  private lastHostId = '';

  constructor(private conn: GameConnection, private settings: Settings, private touch: boolean, private onExit: (reason?: string, result?: ShiftResult | null) => void) {
    const canvas = $('view') as HTMLCanvasElement;
    this.view = new StoreView(canvas, settings.quality, settings.fov);
    setNamedRegular(null); // a new shift: no named regular has walked in yet
    this.view.setQuality(settings.quality); this.view.setMaxScale(settings.renderScale);
    this.input = new Input(canvas, touch);
    this.input.padSens = settings.padSens; this.input.padInvertY = settings.padInvertY; setRumble(settings.rumble);
    this.view.shakeScale = settings.shake !== false && !settings.reduceMotion ? 1 : 0;
    $('helpkeys').textContent = controlsLine(inputMode(), padStyle());
    this.minimap = new Minimap($('minimap') as HTMLCanvasElement);
    conn.onMessage = m => this.onMessage(m);
    conn.onStatus = (s, d) => this.onStatus(s, d);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVis);
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('pointerlockerror', () => this.showHint('這個頁面不能鎖定滑鼠：按住滑鼠左鍵拖曳來轉動視角。'), { once: true });
    $('tutskip').onclick = () => this.skipTutorial();
    this.wheel = new EmoteWheel(document.body, i => { this.sendQuick(i); this.closeOverlay(); }, () => this.closeOverlay());
    this.raf = requestAnimationFrame(this.frame);
    audio.unlock();
  }

  private onResize = () => this.view.resize();
  private onKey = (e: KeyboardEvent) => { if (e.code === 'KeyK' && this.tut && this.overlay === 'none') this.skipTutorial(); };

  /** In-store story bubbles (setShiftStory): one line every few seconds in the speech-bubble slot while the player moves. */
  private playStoryBubbles() {
    const lines = shiftCtx.story; shiftCtx.story = null;
    if (!lines?.length) return;
    lines.forEach((l, i) => this.introTimers.push(window.setTimeout(() => this.bubble(l.icon, l.name, l.text, false, 0), 700 + i * 3800)));
  }
  /** Controls hint: only what this shift can use (no grab before Lv.11, no shop / social keys in a solo shift…). */
  private ctlKey = '';
  private refreshControls(s: Snapshot) {
    const ctx = { abilities: s.shift.abilities, alt: !(s.shift.mode === 'shift' && s.shift.chapter <= 1), social: !this.conn.solo, shop: s.shift.mode !== 'shift', ready: s.shift.mode !== 'shift' || s.phase === 'prep' };
    const k = JSON.stringify(ctx);
    if (k === this.ctlKey) return;
    this.ctlKey = k; setControlsContext(ctx);
    $('helpkeys').textContent = controlsLine(inputMode(), padStyle());
  }
  private karenStamps = 0;
  private autoReady = false;
  private goalCheered = false;
  /** Early payoffs: 退散 stamp for karens handled in chapter 1, and a ★ cheer the moment the shift goal is reached. */
  private cheer(s: Snapshot) {
    if (this.goalCheered || s.shift.mode !== 'shift' || s.shift.endless || s.raid || !(s.shift.goal > 0) || s.phase !== 'open') return;
    if (s.dayStats.revenue < s.shift.goal) return;
    this.goalCheered = true;
    this.stamp('★ 達標！', 'big');
    this.toast(`★ 營業額達標！撐到下班就拿到第一顆星${s.shift.chapter <= 1 ? '（多賺一點還有 ★★）' : ''}`, 'good', 3600);
    this.view.burst(this.pos.x + Math.sin(this.yaw) * 1.5, this.pos.z + Math.cos(this.yaw) * 1.5, 0xffd43b, 18);
  }

  /** Tutorial skipped (or finished): never shown again on this device. */
  private skipTutorial() {
    this.flags.tutorialDone = true; saveFlags(this.flags);
    this.tutorial = null; this.tut = null; this.view.setGuide(null);
    $('tutskip').classList.add('hidden'); $('hintbar').classList.add('hidden');
  }

  /** First time in a store type: what it sells, what the two stations make, and its signature karens. */
  private introduceStore() {
    const m = CURRENT_MAP;
    if (m.id === 'convenience' || this.flags.seenMaps.includes(m.id)) return;
    this.flags.seenMaps.push(m.id); saveFlags(this.flags);
    const st = [m.coffee && FOOD_INFO.coffee, m.meal && FOOD_INFO.meal].filter(Boolean) as (typeof FOOD_INFO.coffee)[];
    const karens = (m.karens ?? []).filter(k => k in KAREN_INFO).map(k => KAREN_INFO[k as keyof typeof KAREN_INFO]);
    const card = $('introcard');
    card.innerHTML = `<div class="muted">第一次來這間店</div><h3>${m.icon} ${UI.esc(m.name)}</h3>
      <p>貨架：${PRODUCTS.map(p => UI.esc(PRODUCT_INFO[p].name)).join('、')}</p>
      ${st.length ? `<p>工作站：${st.map(f => `${f.icon} ${UI.esc(f.station)}（${UI.esc(f.verb)}）`).join('、')}</p>` : '<p>這間店不賣現做的東西，專心顧貨架和收銀。</p>'}
      ${karens.map(k => `<p class="how">招牌奧客「${UI.esc(k.name)}」：${UI.esc(k.how)}</p>`).join('')}`;
    card.classList.remove('hidden');
    this.introTimers.push(window.setTimeout(() => card.classList.add('hidden'), 9000));
  }

  /** First time a karen type shows up: a short card explaining how to deal with it (solo pauses for 2 s). */
  private introduceKaren(kind: string) {
    if (kind === 'boss' || this.flags.seenKarens.includes(kind) || !(kind in KAREN_INFO)) return;
    this.flags.seenKarens.push(kind); saveFlags(this.flags);
    // first shift: the tutorial line already says what to do (no card, no pause in the middle of learning)
    if (this.tutorial) return;
    const info = KAREN_INFO[kind as keyof typeof KAREN_INFO];
    const card = $('introcard');
    card.innerHTML = `<div class="muted">新奧客出現！</div><h3>⚠ ${UI.esc(info.name)}</h3><p>${UI.esc(info.hint)}</p><p class="how">處理方法：${UI.esc(info.how)}</p>`;
    card.classList.remove('hidden');
    const pause = this.conn.solo && this.overlay === 'none';
    if (pause) this.send({ type: 'pause', paused: true });
    this.introTimers.push(window.setTimeout(() => { if (pause && this.overlay === 'none') this.send({ type: 'pause', paused: false }); }, 2000));
    this.introTimers.push(window.setTimeout(() => card.classList.add('hidden'), 4200));
  }
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
    else if (this.overlay === 'settings' || this.overlay === 'help' || this.overlay === 'team') this.openOverlay('pause');
    else if (this.overlay !== 'summary') this.closeOverlay();
  }
  /** App sent to the background: show the pause menu so play doesn't resume by surprise. */
  appPaused() { if (this.started && this.overlay === 'none') this.openOverlay('pause'); }

  private myName() { return this.snap?.players.find(p => p.id === this.selfId)?.name ?? ''; }

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
        if (m.reconnected && this.started) {
          const held = this.snap?.players.find(p => p.id === m.playerId)?.held;
          this.toast(`✅ 已回到店裡${held ? '（手上的東西還在）' : ''}`, 'good', 3200);
        } else if (m.reconnected) UI.lobbyFlash('✅ 已重新連上等候室');
        else if (this.started) this.toast('⌛ 保留時間已過：你以新店員的身分回到店裡（手上的東西沒了）', 'info', 4500);
        if (this.started) this.resyncPos = true;
        break;
      case 'lobby':
        if (this.lastHostId && this.lastHostId !== m.lobby.hostId && m.lobby.hostId === this.selfId) {
          if (this.started) this.toast('👑 你現在是房主了', 'info', 3500); else UI.lobbyFlash('👑 你現在是房主：可以開始營業、改設定、踢人');
        }
        this.lastHostId = m.lobby.hostId;
        this.lobby = m.lobby;
        // the host switched the store type in the lobby: rebuild the 3D store before the game starts
        if (!m.lobby.started && !this.started && m.lobby.map && m.lobby.map !== CURRENT_MAP.id) this.switchMap(m.lobby.map);
        if (!m.lobby.started) this.showLobby();
        else if (this.overlay === 'team') this.renderTeam();
        break;
      case 'snap': this.onSnap(m.s); break;
      case 'events': for (const e of m.list) this.onEvent(e); break;
      case 'actResult':
        if (!m.ok && m.reason) { this.toast(m.reason, 'bad', 1600); audio.play('error'); }
        if (this.overlay === 'shop' || this.overlay === 'summary') { this.shopKey = ''; this.summaryKey = ''; }
        break;
      case 'save':
        if ('onSave' in this.conn && (this.conn as { onSave?: unknown }).onSave) { /* own store: saved by its owner */ }
        else if (this.conn.solo) saveSoloSave(m.save, CURRENT_MAP.id); else saveCoopSave(m.save);
        maybeAutoBackup(); // 雲端備份 (opt-in, signed in, at most every 10 minutes)
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
    else if (this.started) { el.classList.remove('hidden'); el.style.whiteSpace = 'pre-line'; el.textContent = detail ?? '連線中…'; }
    else UI.lobbyNet(s === 'reconnecting' ? detail ?? '重新連線中…' : '');
    if (this.started && this.overlay === 'team') this.renderTeam();
  }

  /** Mid-shift 「隊友」 panel. Ping-only updates (every ≤ 2 s) patch the ping tags so a half-confirmed button survives. */
  private teamKey = '';
  private renderTeam() {
    const l = this.lobby; if (!l) return;
    // the idle-host vote fields only matter to the others (a redraw would disarm a half-confirmed host button)
    const host = l.hostId === this.selfId;
    const key = JSON.stringify({ ...l, players: l.players.map(p => ({ ...p, ping: undefined, afkVote: host ? undefined : p.afkVote })), ...(host ? { hostAfk: undefined, afkVotes: undefined, afkNeed: undefined } : {}) }) + this.selfId + (this.status === 'reconnecting');
    if (key === this.teamKey && document.querySelector('.teamcard')) { UI.lobbyPings(l); return; }
    this.teamKey = key;
    UI.teamPanel(l, this.selfId, {
      back: () => this.openOverlay('pause'),
      kick: id => this.send({ type: 'kick', id }),
      makeHost: id => this.send({ type: 'host', id }),
      addBot: () => this.send({ type: 'bot', op: 'add' }),
      removeBot: id => this.send({ type: 'bot', op: 'remove', id }),
      vote: yes => this.send({ type: 'voteHost', yes }),
    }, this.status === 'reconnecting');
  }

  private switchMap(id: string) {
    applyMap(id);
    const canvas = $('view') as HTMLCanvasElement;
    this.view.renderer.dispose();
    this.view = new StoreView(canvas, this.settings.quality, this.settings.fov);
    this.view.setQuality(this.settings.quality); this.view.setMaxScale(this.settings.renderScale);
    this.view.shakeScale = this.settings.shake !== false && !this.settings.reduceMotion ? 1 : 0;
  }

  private lobbyKey = '';
  private showLobby() {
    if (!this.lobby || this.started) return;
    // only pings changed (refreshed every few seconds): patch them instead of redrawing the whole screen
    const key = JSON.stringify({ ...this.lobby, players: this.lobby.players.map(p => ({ ...p, ping: undefined })) }) + this.selfId;
    if (key === this.lobbyKey && document.getElementById('l-code')) { UI.lobbyPings(this.lobby); return; }
    this.lobbyKey = key;
    UI.lobbyScreen(this.lobby, this.selfId, {
      ready: r => this.send({ type: 'ready', ready: r }),
      start: () => this.send({ type: 'start' }),
      leave: () => { saveLastSession(null); this.exit(); },
      copy: () => { void navigator.clipboard?.writeText(this.lobby!.code); this.toast('已複製房間碼', 'good'); },
      config: (map, difficulty, bots) => this.send({ type: 'lobbyCfg', map, difficulty, bots }),
      kick: id => this.send({ type: 'kick', id }),
      makeHost: id => this.send({ type: 'host', id }),
    }, this.status === 'reconnecting');
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
      UI.ensureLobbyCss(); // team-list ping bars
      if (this.touch) { $('touch').classList.remove('hidden'); document.body.classList.add('touch'); }
      else this.input.lock();
      audio.setMusicVolume(this.settings.music);
      audio.startMusic(s.shift.endless ? 7 : s.shift.boss ? 6 : s.shift.mode === 'shift' ? (s.shift.chapter <= 7 ? s.shift.chapter : 1 + (s.shift.chapter - 1) % 5) : 0);
      audio.startStoreAmbience(CURRENT_MAP.id);
      if (!s.raid) this.introduceStore();
      this.showArcCard();
      this.playStoryBubbles();
    }
    if (first || !this.started) { this.pos = { x: me.x, z: me.z }; this.yaw = me.yaw; }
    else if (this.resyncPos) { this.resyncPos = false; this.pos = { x: me.x, z: me.z }; this.corrections = 0; }
    // 打擊感: someone just grabbed a customer → squash-stretch, 嘿咻, camera dip (snapshots carry who holds whom)
    for (const p of s.players) {
      const was = this.grabSeen.get(p.id);
      if (p.grabbing != null && p.grabbing !== was && !first) this.onGrab(p.id === this.selfId, p.grabbing, p.x, p.z);
      this.grabSeen.set(p.id, p.grabbing ?? null);
    }
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
      case 'toast':
        this.toast(e.text, e.tone ?? 'info');
        // chapter 1: every karen handled gets the 退散 stamp (the very first one big)
        if (e.karen && e.ok !== false && this.snap?.shift.mode === 'shift' && this.snap.shift.chapter <= 1) this.stamp(stampText('eject'), this.karenStamps++ === 0 ? 'big' : '');
        if (e.karen) this.karenOutcome(e.ok !== false, e.kid);
        if (e.karen && this.regularId !== null && e.kid === this.regularId && shiftCtx.regular) this.regularSays(e.ok !== false ? shiftCtx.regular.handled : shiftCtx.regular.bubbles[1] ?? shiftCtx.regular.bubbles[0], e.ok === false);
        else if (e.karen) this.aftermath(e.karen, e.ok !== false, e.kid ?? 0);
        break;
      case 'sfx':
        audio.play(e.name, e.x, e.z);
        if (e.name === 'clean' && e.x !== undefined) this.view.burst(e.x, e.z!, 0x99e9f2);
        else if (e.name === 'deliver' && e.x !== undefined) this.sparkle(e.x, e.z!); // served: soft chime + sparkles
        break;
      case 'money': this.view.floatText(`+$${e.amount}`, e.x, e.z); this.view.burst(e.x, e.z, 0xffd43b, 10); break;
      case 'karen':
        audio.play('karen'); audio.karenSting(e.kind); this.introduceKaren(e.kind);
        // the first karen of the regular's kind is the regular: name tag + speech bubbles
        if (shiftCtx.regular && this.regularId === null && e.kind === shiftCtx.regular.kind) {
          const r = shiftCtx.regular; this.regularId = e.id;
          setNamedRegular({ id: e.id, label: `${r.icon} ${r.name}` });
          this.regularSays(r.bubbles[0]);
          if (r.bubbles[1]) this.afTimers.push(window.setTimeout(() => { if (this.regularId === e.id && this.snap?.customers.some(c => c.id === e.id && !c.resolved)) this.regularSays(r.bubbles[1]); }, 12000));
        }
        break;
      case 'quick': {
        const ico = e.msg !== undefined ? QUICK_ICONS[e.msg] ?? '💬' : '💬';
        this.quickLog.push({ id: e.id ?? '', text: e.text, at: performance.now() }); if (this.quickLog.length > 12) this.quickLog.shift();
        this.addFeed(`${ico} ${e.from}：${e.text}`);
        if (e.id && e.id !== this.selfId) this.view.say(e.id, `${ico} ${e.text}`);
        audio.play('quick');
        break;
      }
      case 'phase':
        if (e.phase === 'prep' && this.snap && this.snap.shift.mode !== 'shift') this.toast(`☀ 第 ${e.day} 天・開店準備：採購(${keyOf('shop')})、補貨、升級，按 ${keyOf('ready')} 準備開店`, 'info', 5000);
        break;
      case 'hint': if (!this.tut) this.showHint(e.text); break; // the tutorial line already says it (no competing text)
      case 'fx': this.onFx(e); break;
    }
  }

  // ---------------- 打擊感 (juice) ----------------
  private warp = new TimeWarp();
  private grabSeen = new Map<string, number | null>();
  private sadLimit = new RateLimit(2500);
  private lastThrowPitch = 0;

  /** Applies hit-stop / slow-mo / shake / kick / flash / rumble for an action; returns its strength (distance falloff). */
  private juice(kind: JuiceKind, x: number, z: number, mine: boolean): number {
    const pr = juiceProfile(kind, Math.hypot(x - this.pos.x, z - this.pos.z), mine, { shake: this.settings.shake !== false, reduceMotion: !!this.settings.reduceMotion });
    const now = performance.now();
    this.warp.stop(pr.hitStop, now);
    this.warp.slow(pr.slowMo, pr.slowScale, now);
    if (pr.shake > 0) this.view.shake = Math.max(this.view.shake, pr.shake);
    if (pr.kick || pr.dip) this.view.punch(pr.kick, pr.dip);
    if (pr.flash) this.flash(pr.flash === 2);
    if (pr.rumble[2] > 0 && pr.rumble[0] + pr.rumble[1] > 0.05) rumble(pr.rumble[0], pr.rumble[1], pr.rumble[2]);
    return pr.k;
  }

  private onGrab(mine: boolean, id: number, px: number, pz: number) {
    this.view.squash(id);
    const k = this.juice('grab', px, pz, mine);
    const c = this.view.customerPos(id);
    audio.play('heave', c?.x ?? px, c?.z ?? pz, k);
  }

  // ---------------- 找零計較姐: the exact-change quick-time prompt ----------------
  private qte: { id: number; look: number; until: number; total: number; el: HTMLElement; dev: string; secs: number } | null = null;
  /** Opens the prompt: three handfuls of coins, pick the one that adds up to her change
   *  (keys 1–3, D-pad ← ↑ → on a pad, click / tap). The pad does nothing else while it is open (input.qteActive). */
  openChangePrompt(id: number) {
    const c = this.snap?.customers.find(x => x.id === id);
    if (!c || this.qte) return;
    ensureQteStyle();
    const opts = changeOptions(c.look), total = 5, due = changeDue(c.look);
    const el = document.createElement('div'); el.id = 'qte';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', `找零：應找 ${due} 元，選出剛好的那一把零錢`);
    el.innerHTML = `<div class="qte-title">🪙 應找 <b>$${due}</b>：哪一把零錢剛剛好？</div>
      <div class="qte-opts">${opts.map((o, i) => `<button class="qte-opt" data-qte="${i}" aria-label="第 ${i + 1} 把：${o.counts.map((k, j) => (k ? `${COINS[j]} 元 ${k} 個` : '')).filter(Boolean).join('、')}"><kbd class="qte-key" aria-hidden="true"></kbd><span class="qte-coins">${o.counts.map((k, j) => (k ? `<span class="coin c${COINS[j]}">${COINS[j]}</span>×${k}` : '')).filter(Boolean).join(' ')}</span></button>`).join('')}</div>
      <div class="qte-bar" role="progressbar" aria-label="剩餘時間" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${total}"><i></i></div>
      <div class="qte-foot"><span class="qte-time" aria-hidden="true">⏱ ${total.toFixed(1)} 秒</span><span class="qte-help"></span></div>`;
    ($('hud') ?? document.body).appendChild(el);
    el.querySelectorAll<HTMLButtonElement>('[data-qte]').forEach(b => {
      // pointerdown as well as click: on a phone the tap must not wait for a click that a moving thumb can cancel
      const pick = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); this.answerChange(Number(b.dataset.qte)); };
      b.addEventListener('pointerdown', ev => { if ((ev as PointerEvent).pointerType === 'touch') pick(ev); });
      b.onclick = pick;
    });
    this.qte = { id, look: c.look, until: performance.now() + total * 1000, total, el, dev: '', secs: -1 };
    this.input.qteActive = true;
    this.qteLabels();
  }
  /** Key / D-pad / touch badges on the handfuls + the help line, for the device the player is using right now. */
  private qteLabels() {
    const q = this.qte; if (!q) return;
    const dev = promptDevice(inputMode(), this.touch), style = padStyle();
    if (q.dev === dev + style) return;
    q.dev = dev + style;
    q.el.dataset.dev = dev;
    q.el.querySelectorAll<HTMLElement>('.qte-key').forEach((k, i) => { k.textContent = qteGlyph(i, dev, style); });
    const help = q.el.querySelector('.qte-help'); if (help) help.textContent = qteHelp(dev, style);
  }
  private answerChange(opt: number) {
    const q = this.qte; if (!q) return;
    this.send({ type: 'act', rid: newRid(), kind: 'exactChange', target: { t: 'customer', id: q.id }, opt });
    this.closeChangePrompt();
  }
  private closeChangePrompt() { this.qte?.el.remove(); this.qte = null; this.input.qteActive = false; }
  private changePromptFrame(s: Snapshot) {
    const q = this.qte!;
    const c = s.customers.find(x => x.id === q.id);
    if (!c || c.resolved || c.state !== 'atRegister') { this.closeChangePrompt(); return; }
    for (let i = 1; i <= 3; i++) if (this.input.consume(`q${i}` as 'q1')) { this.answerChange(i - 1); return; }
    const left = (q.until - performance.now()) / 1000;
    if (left <= 0) { this.answerChange(-1); return; }
    this.qteLabels();
    const bar = q.el.querySelector<HTMLElement>('.qte-bar i'); if (bar) bar.style.width = `${Math.max(0, left / q.total) * 100}%`;
    const tenths = Math.ceil(left * 10) / 10;
    if (tenths !== q.secs) {
      q.secs = tenths;
      const t = q.el.querySelector('.qte-time'); if (t) t.textContent = `⏱ ${tenths.toFixed(1)} 秒`;
      q.el.querySelector('.qte-bar')?.setAttribute('aria-valuenow', String(Math.ceil(left)));
      q.el.classList.toggle('low', left < 1.5); // last moments: the bar turns red AND the timer text says so (not colour alone)
    }
  }

  /** 發票對獎魔人 escort cue: how far you are from him and which way, while he walks to the 對獎機 (≤ 3.2 m keeps him going). */
  private escortCue(s: Snapshot) {
    let el = document.getElementById('escortcue');
    const c = s.customers.find(x => x.kind === 'lottery' && x.state === 'toKiosk' && !x.resolved);
    if (!c || this.overlay !== 'none') { el?.classList.add('hidden'); return; }
    ensureQteStyle();
    if (!el) { el = document.createElement('div'); el.id = 'escortcue'; el.setAttribute('role', 'status'); ($('hud') ?? document.body).appendChild(el); }
    const p = this.view.customerWorldPos(c.id) ?? c;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
    const near = d < ESCORT_NEAR;
    const mate = !near && s.players.some(pl => pl.id !== this.selfId && Math.hypot(pl.x - p.x, pl.z - p.z) < ESCORT_NEAR);
    // arrow on screen: forward = up (yaw convention of the movement code: forward (sin, cos), right (−cos, sin))
    const fwd = dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw), right = -dx * Math.cos(this.yaw) + dz * Math.sin(this.yaw);
    const deg = Math.round(Math.atan2(right, fwd) * 180 / Math.PI / 15) * 15;
    const state = near ? 'ok' : mate ? 'mate' : 'far';
    const text = near ? `🧾 陪著走 ✔ ${d.toFixed(1)} 公尺` : mate ? '🧾 隊友陪著他走' : `⚠ 跟上！離他 ${Math.round(d)} 公尺`;
    const html = `<span class="ec-arrow" style="transform:rotate(${deg}deg)" aria-hidden="true">⬆</span><span class="ec-txt">${text}</span>`;
    el.classList.remove('hidden');
    if (el.dataset.state !== state) el.dataset.state = state;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  private onFx(e: Extract<GameEvent, { e: 'fx' }>) {
    const mine = !!e.by && e.by === this.myName();
    const reduce = !!this.settings.reduceMotion;
    switch (e.name) {
      case 'fireworks':
        // 跨年夜 midnight: fireworks in the sky outside the front windows
        this.view.fireworks(reduce);
        this.stamp('🎉 新年快樂！', 'big');
        break;
      case 'eject': {
        const k = this.juice('eject', e.x, e.z, mine);
        const combo = e.combo ?? 0;
        this.view.shockwave(e.x, e.z - 0.3, 0xff922b, 2.5);
        this.view.floatText(combo > 1 ? `${combo} 連送！` : '退散！', e.x, e.z - 0.6, '#ffa94d');
        this.view.burst(e.x, e.z - 0.4, 0xff922b, Math.round(26 * k));
        // lands on the pavement outside: cartoon star + dust, door bell, the crowd goes "ooh"
        this.view.impactStar(e.x, STORE_D + 1.1, k);
        audio.play('star', e.x, e.z, k); audio.play('dust', e.x, e.z, k);
        audio.play('ding', e.x, e.z, k);
        if (combo >= 2 || mine) audio.play('ooh', e.x, e.z, k * (combo >= 2 ? 1 : 0.7));
        if (mine || k >= 0.75) this.stamp(stampText('eject', combo), mine ? '' : 'small');
        if (combo > 1) this.showCombo(combo);
        break;
      }
      case 'ultimate': {
        this.juice('ultimate', e.x, e.z, mine);
        this.view.burst(e.x, e.z, 0xffd43b, 40); this.view.shockwave(e.x, e.z, 0xffd43b, 6);
        audio.play('bassdrop');
        this.stamp(stampText('ultimate'), 'big');
        break;
      }
      case 'spin': {
        const k = this.juice('spin', e.x, e.z, mine);
        this.view.burst(e.x, e.z, 0x63e6be, Math.round(30 * k)); this.view.shockwave(e.x, e.z, 0x63e6be, 3.2);
        this.view.tumble(1.6);
        audio.play('rise', e.x, e.z, k);
        if ((mine || this.nearMe(e.x, e.z)) && !reduce) this.speedLines();
        break;
      }
      case 'throw': {
        const k = this.juice('throw', e.x, e.z, mine);
        audio.play('whoosh', e.x, e.z, mine ? throwStrength(this.lastThrowPitch) : k);
        break;
      }
      case 'mistake':
        this.juice('mistake', e.x, e.z, true); // a store-wide blunder: everyone feels it
        this.sad(e.x, e.z);
        break;
      case 'impact': this.view.burst(e.x, e.z, 0xffd69a, 6); break;
      case 'hit': {
        const k = this.juice('hit', e.x, e.z, mine);
        this.view.burst(e.x, e.z, 0xfff3bf, Math.round(14 * k)); this.view.floatText('啪！', e.x, e.z, '#fff3bf');
        audio.play('slap', e.x, e.z, k);
        if (mine) this.stamp(stampText('hit'), 'hit');
        if (e.report && (mine || k >= 0.75)) audio.play('siren', e.x, e.z, k); // this one gets reported…
        break;
      }
      case 'shove':
        if (e.by === this.myName()) { this.juice('shove', e.x, e.z, true); this.stamina = Math.max(0, this.stamina - 25); }
        break;
    }
  }

  /** A karen was dealt with (toast carries karen/ok): soft chime + sparkles, or a (rate-limited) sad trombone. */
  private karenOutcome(ok: boolean, kid?: number) {
    const c = kid !== undefined ? this.snap?.customers.find(cc => cc.id === kid) : undefined;
    const x = c?.x ?? this.pos.x, z = c?.z ?? this.pos.z;
    if (ok) { audio.play('chime', x, z); this.sparkle(x, z); }
    else this.sad(x, z);
  }
  private sparkle(x: number, z: number) { this.view.burst(x, z, 0xfff3bf, 8); this.view.burst(x, z, 0x99e9f2, 4); }
  private sad(x: number, z: number) { if (this.sadLimit.ok('sad', performance.now())) audio.play('trombone', x, z); }

  /** Big rubber-stamp text in the middle of the screen (reused element; the animation restarts). */
  private stamp(text: string, variant: '' | 'small' | 'big' | 'hit') {
    const el = $('stamp');
    el.textContent = text;
    el.className = variant;
    void el.offsetWidth; // restart the CSS animation
    if (!this.settings.reduceMotion) el.classList.add('go'); // 減少動態效果: the stamp just appears, no zoom
    if (variant !== 'small') audio.play('stamp');
    clearTimeout(this.stampTimer); this.stampTimer = window.setTimeout(() => el.classList.add('hidden'), variant === 'big' ? 1400 : 900);
  }
  private stampTimer = 0;
  private speedTimer = 0;
  private speedLines() {
    const el = $('speedlines');
    el.className = ''; void el.offsetWidth; el.classList.add('go');
    clearTimeout(this.speedTimer); this.speedTimer = window.setTimeout(() => el.classList.add('hidden'), 650);
  }

  private nearMe(x: number, z: number) { return Math.hypot(x - this.pos.x, z - this.pos.z) < 2.5; }
  // ---------------- UI helpers ----------------
  toast(text: string, tone: 'good' | 'bad' | 'info' = 'info', ms = 2800) {
    const box = $('toasts');
    const d = document.createElement('div'); d.className = `toast ${tone}`; d.textContent = text;
    box.appendChild(d);
    while (box.childElementCount > 3) box.firstElementChild!.remove();
    setTimeout(() => d.remove(), ms);
  }
  private afTimers: number[] = [];
  /** Customer id of this shift's named regular (常客奧客), once they walk in. */
  private regularId: number | null = null;
  /** 常客奧客: today's chapter of their story, as a card at the side of the store while the shift gets ready. */
  private showArcCard() {
    const pre = shiftCtx.regular?.pre; if (!pre) return;
    const el = $('arccard');
    el.innerHTML = `<div class="ac-title">${UI.esc(pre.title)}</div>` + pre.lines.map(l => `<p>${UI.esc(l.icon)} <b>${UI.esc(l.name)}</b>：${UI.esc(l.text)}</p>`).join('');
    el.className = '';
    this.introTimers.push(window.setTimeout(() => el.classList.add('fade'), 14000), window.setTimeout(() => el.classList.add('hidden'), 14600));
  }
  private regularSays(text: string, fail = false) {
    const r = shiftCtx.regular; if (!r) return;
    this.bubble(r.icon, r.name, text, fail, 300);
  }
  /** After-story bubble (錢董 / 阿芬姐 / 記者小林) a moment after a signature karen is dealt with. */
  private aftermath(kind: string, ok: boolean, seed: number) {
    const l = aftermathLine(kind, ok, seed);
    if (!l) return;
    const sp = DEX_SPEAKER[l.who];
    this.bubble(sp.icon, sp.name, l.text, !ok, 1100);
  }
  /** Speech bubble at the left edge (after-story lines, 常客奧客). */
  private bubble(icon: string, name: string, text: string, fail: boolean, delay: number) {
    for (const t of this.afTimers) clearTimeout(t);
    const el = $('aftermath');
    this.afTimers = [window.setTimeout(() => {
      el.innerHTML = '';
      const ico = document.createElement('div'); ico.className = 'af-ico'; ico.textContent = icon;
      const txt = document.createElement('div'); txt.className = 'af-txt';
      const who = document.createElement('b'); who.className = 'af-who'; who.textContent = name;
      txt.append(who, document.createTextNode(text));
      el.append(ico, txt);
      el.className = fail ? 'fail' : '';
      // restart the pop-in animation
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
      this.afTimers.push(window.setTimeout(() => el.classList.add('fade'), 5200), window.setTimeout(() => el.classList.add('hidden'), 5700));
    }, delay)];
  }
  /** Empty / low shelf: short rate-limited toast for a low shelf, guide arrow to the crate, and a one-time tip (chapters 1–3). */
  private shelfWarnings(s: Snapshot, me: Snapshot['players'][number]) {
    const now = performance.now();
    const ch = this.shelfWatch.update(s, now);
    for (const p of ch.low) {
      if (s.backstock[p] > 0) this.toast(`⚠ ${PRODUCT_INFO[p].name}貨架快空了（剩 ${s.shelves[p]}），去倉庫拿${PRODUCT_INFO[p].name}貨箱`, 'info', 2200);
    }
    if (ch.empty.length && !this.tut && s.shift.mode === 'shift' && s.shift.chapter <= 3 && !this.flags.shelfTipDone) {
      this.flags.shelfTipDone = true; saveFlags(this.flags);
      this.showHint(`貨架空了！${EMPTY_SHELF_GRACE} 秒內補上就不扣口碑：跟著黃色箭頭到倉庫拿貨箱，再對貨架按 ${this.touch ? '「互動」' : keyOf('interact')} 上架`);
    }
    this.shelfGuide = this.tut ? null : this.shelfWatch.guide(s, me, now);
  }

  private showHint(text: string) {
    const el = $('hintbar'); el.textContent = '💡 ' + text; el.classList.remove('hidden');
    this.hintUntil = performance.now() + 7000;
  }
  private flash(red: boolean) {
    if (this.settings.reduceMotion) return;
    const f = $('flash'); f.classList.toggle('red', red); f.style.opacity = red ? '0.45' : '0.85';
    setTimeout(() => { f.style.opacity = '0'; }, 160);
  }
  private comboTimer = 0;
  private showCombo(n: number) {
    const el = $('combo'); el.textContent = `${n} 連送！`; el.classList.remove('hidden', 'pop'); void el.offsetWidth; if (!this.settings.reduceMotion) el.classList.add('pop');
    clearTimeout(this.comboTimer); this.comboTimer = window.setTimeout(() => el.classList.add('hidden'), 1600);
  }
  private addFeed(text: string) { this.feed.push({ text, until: performance.now() + 7000 }); if (this.feed.length > 5) this.feed.shift(); }

  private openOverlay(o: Overlay) {
    this.overlay = o;
    this.input.enabled = false;
    if (o !== 'quick') this.input.unlock(); // the wheel points with the captured mouse
    if (this.conn.solo && (o === 'pause' || o === 'settings' || o === 'help' || o === 'team')) this.send({ type: 'pause', paused: true });
    this.shopKey = ''; this.summaryKey = '';
    switch (o) {
      case 'pause': UI.pauseMenu(this.conn.solo, this.code, {
        endShift: this.snap?.shift.endless ? () => { this.send({ type: 'endShift' }); this.closeOverlay(); } : undefined,
        resume: () => this.closeOverlay(),
        settings: () => this.openOverlay('settings'),
        help: () => this.openOverlay('help'),
        leave: () => { if (!this.conn.solo) saveLastSession(null); this.exit(); },
        team: !this.conn.solo && this.lobby ? () => this.openOverlay('team') : undefined,
        teamNote: this.lobby?.hostAfk && this.lobby.hostId !== this.selfId ? '房主沒動作，可投票' : undefined,
      }); break;
      case 'team': this.teamKey = ''; this.renderTeam(); break;
      case 'settings': UI.settingsMenu(this.settings, s => { this.applySettings(s); this.openOverlay('pause'); }, true); break;
      case 'help': UI.helpScreen(() => this.openOverlay('pause')); break;
      case 'quick': {
        const pad = this.input.usingGamepad;
        this.wheel.open(pad && this.input.padDown(BTN.VIEW), pad ? `搖桿選、放開 ${actionLabel('quick', 'pad', padStyle())} 或按 ${actionLabel('interact', 'pad', padStyle())} 送出` : this.touch ? '點一下送出' : '1–8 直接送・移動滑鼠選、左鍵送出・T 關閉');
        this.input.takeWheel();
        break;
      }
      case 'shop': UI.show(`<div class="card wide"><h2>🛒 採購・升級</h2><div id="shop-body"></div><button class="btn primary" id="shop-close">關閉${this.touch ? '' : ' (B)'}</button></div>`, 'screen overlay');
        $('shop-close').addEventListener('click', () => this.closeOverlay());
        this.renderShop(); break;
      case 'summary': UI.show(`<div class="card wide" id="sum-body"></div>`, 'screen overlay'); this.renderSummary(); break;
    }
  }

  private closeOverlay() {
    if (this.overlay === 'summary' && this.snap?.phase === 'summary') return; // must ready up
    const wasWheel = this.overlay === 'quick';
    this.overlay = 'none';
    this.wheel.close();
    if (!wasWheel) UI.hide();
    this.input.enabled = true;
    this.input.clearPresses();
    if (this.conn.solo) this.send({ type: 'pause', paused: false });
    if (!this.touch) this.input.lock();
  }

  private applySettings(s: Settings) {
    this.settings = s; saveSettings(s);
    this.view.setQuality(s.quality);
    this.view.camera.fov = s.fov; this.view.camera.updateProjectionMatrix();
    audio.setMaster(s.master); audio.setVolume(s.volume); audio.setMusicVolume(s.music);
    this.view.setMaxScale(s.renderScale);
    this.input.padSens = s.padSens; this.input.padInvertY = s.padInvertY; setRumble(s.rumble);
    this.view.shakeScale = s.shake !== false && !s.reduceMotion ? 1 : 0;
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
    if (me.raider) {
      // raiding a friend's store: knock things off shelves and heckle customers (G throws trash)
      for (const sh of SHELVES) out.push(s.shelves[sh.product] > 0
        ? { label: `😈 打翻${PRODUCT_INFO[sh.product].name}`, primary: 'knock', target: { t: 'shelf', product: sh.product }, box: sh.box }
        : { label: `${PRODUCT_INFO[sh.product].name}貨架`, reason: '已經空了', target: { t: 'shelf', product: sh.product }, box: sh.box });
      for (const c of s.customers) {
        if (c.kind !== 'normal' || c.state === 'leaving' || c.flying || c.held) continue;
        const pos = this.view.customerWorldPos(c.id) ?? c;
        out.push({ label: '😈 嗆這位客人', primary: 'heckle', target: { t: 'customer', id: c.id }, point: { x: pos.x, z: pos.z, r: 0.45, h: 1.8 } });
      }
      return out;
    }
    const cap = shelfCapacity(s.upgrades.shelves);
    for (const r of REGISTERS) {
      if (r.idx === 1 && !s.upgrades.register2) continue;
      const waiting = s.customers.find(c => c.state === 'atRegister' && Math.abs(c.x - r.customer.x) < 0.7 && Math.abs(c.z - r.customer.z) < 0.7);
      const box = { x0: r.x - 0.3, x1: r.x + 0.3, z0: r.z - 0.25, z1: r.z + 0.25, h: 1.4, kind: 'register' };
      // tutorial: the 插隊 karen at the till can be told to queue from behind the counter (the lesson, not a fail)
      const cut = waiting && this.tut && waiting.kind === 'cutter' && !waiting.resolved ? waiting : null;
      if (cut && this.pos.z <= 11.2) { out.push({ label: '請插隊奧客重新排隊', primary: 'askQueue', target: { t: 'customer', id: cut.id }, box: { x0: r.x - 0.3, x1: r.x + 0.3, z0: r.z - 0.25, z1: r.z + 0.25, h: 1.4, kind: 'register' } }); continue; }
      out.push(waiting
        ? (this.pos.z > 11.2 ? { label: '收銀台', reason: '請繞到櫃台內側結帳', target: { t: 'register', idx: r.idx }, box }
          : { label: `結帳（${waiting.items} 件${waiting.kind === 'cutter' && !waiting.resolved ? '・⚠插隊奧客' : ''}）`, primary: 'checkout', target: { t: 'register', idx: r.idx }, box })
        : { label: `收銀台 ${r.idx + 1}`, reason: '目前沒有顧客等結帳', target: { t: 'register', idx: r.idx }, box });
    }
    const foodSlot = me.grabbing == null && (!held || ((held.kind === 'coffee' || held.kind === 'meal') && !me.held2));
    const sells = (f: 'coffee' | 'meal') => s.shift.foods.includes(f);
    const F = FOOD_INFO;
    if (sells('coffee')) out.push(!foodSlot ? { label: F.coffee.station, reason: '雙手已滿（最多兩份餐點）', target: { t: 'coffee' }, box: COFFEE_MACHINE }
      : { label: F.coffee.verb, primary: 'brew', target: { t: 'coffee' }, box: COFFEE_MACHINE });
    if (sells('meal')) out.push(!foodSlot ? { label: F.meal.station, reason: '雙手已滿（最多兩份餐點）', target: { t: 'microwave' }, box: MICROWAVE }
      : s.backstock.bento <= 0 ? { label: F.meal.station, reason: `${F.meal.uses}缺貨，按 B 採購`, target: { t: 'microwave' }, box: MICROWAVE }
      : { label: `${F.meal.verb}（倉庫 ${s.backstock.bento}）`, primary: 'heat', target: { t: 'microwave' }, box: MICROWAVE });
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
      const name = it.held.kind === 'box' ? `${PRODUCT_INFO[it.held.product].name}貨箱` : it.held.kind === 'mop' ? '拖把' : FOOD_INFO[it.held.kind === 'meal' ? 'meal' : 'coffee'].name;
      out.push(held ? { label: name, reason: '手上有東西', target: { t: 'item', id: it.id }, point: { x: it.x, z: it.z, r: 0.45, h: 0.3 } }
        : { label: `撿起${name}`, primary: 'pickup', target: { t: 'item', id: it.id }, point: { x: it.x, z: it.z, r: 0.45, h: 0.3 } });
    }
    return out;
  }

  private customerCandidate(c: CustomerSnap, hands: (string | null)[], money: number): Candidate | null {
    const cand = this.baseCandidate(c, hands, money);
    if (!cand || c.kind === 'normal' || c.resolved) return cand;
    const tags = [c.violent ? '🤬 失控（出手算正當防衛）' : '', c.vip ? '💼 有背景' : '', c.heavy && !(c.stun > 0) ? '🏋 抓不動' : '', c.stun > 0 ? '💫 暈了' : ''].filter(Boolean);
    return tags.length ? { ...cand, label: `${cand.label}・${tags.join('・')}` } : cand;
  }
  private baseCandidate(c: CustomerSnap, hands: (string | null)[], money: number): Candidate | null {
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
      if (c.kind === 'custom') return c.state === 'atRegister' ? { label: `對${name}複誦點單`, primary: 'repeatOrder', target: t, point } : { label: name, reason: '他還在挑，到收銀台才會開始改單', target: t, point };
      if (c.kind === 'fickle') {
        if (c.state !== 'waitFood') return { label: name, reason: '正走向取餐區', target: t, point };
        return hands.includes(c.want ?? '') ? { label: `交付${FOOD_INFO.coffee.name}（${c.phase ? '第二杯' : '第一杯'}）`, primary: 'deliver', alt: 'recommend', altLabel: '推薦招牌', target: t, point }
          : { label: `向${name}推薦招牌`, primary: 'recommend', target: t, point };
      }
      if (c.kind === 'tryhard') return c.state === 'tryon' ? { label: `請${name}限試穿 3 件`, primary: 'limitTry', target: t, point } : { label: name, reason: '正走向試衣間', target: t, point };
      if (c.kind === 'lottery') {
        if (c.state === 'atRegister') return { label: `帶${name}去對獎機`, primary: 'escort', target: t, point };
        if (c.state === 'toKiosk') return { label: name, reason: '跟在他旁邊（3 公尺內）一起走到對獎機', target: t, point };
        return { label: name, reason: '他還在挑，到收銀台才會掏出發票', target: t, point };
      }
      if (c.kind === 'change') return c.state === 'atRegister'
        ? { label: `陪${name}數零錢${c.phase ? `（又數錯 ${c.phase} 次）` : ''}`, primary: 'countChange', alt: 'exactChange', altLabel: '找剛好的零錢（快）', target: t, point }
        : { label: name, reason: '她還在挑，到收銀台才會開始數零錢', target: t, point };
      if (c.kind === 'bagman') {
        if (bagmanAtDoor(c)) return { label: `在門口攔下${name}檢查袋子`, primary: 'stopBag', target: t, point };
        return { label: `🛍 ${name}`, reason: c.state === 'toExit' ? '還沒到門口！先去門口等他' : '他裝作在逛，等他提著袋子走到門口再攔', target: t, point };
      }
      if (c.kind === 'toilet') {
        const leader = c.phase === 1;
        if (c.state !== 'toToilet' && c.state !== 'toilet') return { label: name, reason: '正衝向廁所', target: t, point };
        return { label: leader ? `🚩 對領隊說「廁所限消費使用」` : `請這位團員先消費（只走他一個）`, primary: 'toiletRule', target: t, point };
      }
      if (isSig(c.kind)) return sigCandidate(c, hands, money, t, point);
      if (c.kind === 'charger') {
        const treat = hands.includes('coffee') ? `請他喝${FOOD_INFO.coffee.name}` : undefined;
        return c.state === 'charge'
          ? { label: `拔掉${name}的插頭${c.phase ? '（再一次！）' : ''}`, primary: 'unplug', alt: 'treat', altLabel: treat, target: t, point }
          : treat ? { label: name, primary: 'treat', target: t, point } : { label: name, reason: '正走向門口的插座', target: t, point };
      }
    }
    if (c.state === 'waitFood' && c.want) {
      const name = FOOD_INFO[c.want].name;
      return hands.includes(c.want) ? { label: `交付${name}`, primary: 'deliver', target: t, point }
        : { label: `等${name}的顧客`, reason: `去${FOOD_INFO[c.want].station}${FOOD_INFO[c.want].verb}`, target: t, point };
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
  private perfT = 0; private perfFrames = 0; private lastRaw = 0;
  private frame = (now: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) return; // never render in the background (battery)
    const cap = this.settings.fpsCap ?? 0;
    if (cap > 0 && now - this.last < 1000 / cap - 2) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const prevRaw = this.lastRaw; this.lastRaw = now;
    // dynamic resolution: drop pixel ratio when the device can't keep up, raise it again when it can
    // (a one-off hitch — shader compile, a customer spawning, GC — is left out so it doesn't drop the resolution)
    const avgMs = this.perfFrames >= 5 ? this.perfT * 1000 / this.perfFrames : Infinity;
    if (this.settings.adaptive !== false && this.started && now - prevRaw < Math.max(250, avgMs * 4)) {
      this.perfT += dt; this.perfFrames++;
      if (this.perfT >= 2) {
        const fps = this.perfFrames / this.perfT, target = cap > 0 ? cap : 60;
        if (fps < target * 0.75 && this.view.resScale > 0.5) this.view.setResolutionScale(this.view.resScale - 0.1);
        else if (fps > target * 0.95 && this.view.resScale < this.view.maxScale) this.view.setResolutionScale(this.view.resScale + 0.05);
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
    if (this.input.consume('quick') && !this.conn.solo) {
      if (this.overlay === 'none') this.openOverlay('quick');
      else if (this.overlay === 'quick') { if (this.wheel.sel !== null && !this.touch) this.sendQuick(this.wheel.sel); this.closeOverlay(); } // T again sends what the mouse points at
    }

    if (this.overlay === 'none') {
      const look = this.input.takeLook();
      const sens = 0.0024 * this.settings.sensitivity;
      this.yaw -= look.dx * sens + look.pdx * 0.0024;
      this.pitch += (this.settings.invertY ? look.dy : -look.dy) * sens - look.pdy * 0.0024;
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
      // while the connection is down you stay put (the server keeps your spot; no snapping back afterwards)
      const moving = Math.hypot(dx, dz) > 1e-4 && (this.conn.solo || this.status === 'online');
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
        if (this.target?.alt === 'exactChange' && this.target.target.t === 'customer') this.openChangePrompt(this.target.target.id);
        else if (this.target?.alt && this.target.altLabel) this.send({ type: 'act', rid: newRid(), kind: this.target.alt, target: this.target.target });
        else if (me.held) this.send({ type: 'drop', rid: newRid() });
      }
      if (this.input.consume('drop') && (me.held || me.held2 || me.grabbing != null || me.busy || me.raider)) this.send({ type: 'drop', rid: newRid() });
      if (this.input.consume('grab')) {
        if (!this.canGrab()) this.toast('「抓起／投擲」在 Lv.11 資深店員解鎖', 'info', 1800);
        else if (me.grabbing != null) { this.lastThrowPitch = this.pitch; this.send({ type: 'throw', rid: newRid(), yaw: this.yaw, pitch: this.pitch }); }
        else { const k = this.karenTarget(s); if (k) this.send({ type: 'act', rid: newRid(), kind: 'grab', target: { t: 'customer', id: k.id } }); else this.toast('準星對準身前的顧客再抓', 'info', 1400); }
      }
      if (this.input.consume('spin')) this.send({ type: 'spin', rid: newRid() });
      if (this.input.consume('hit')) {
        if (!s.shift.abilities.includes('hit')) this.toast('「出手」在 Lv.6 正職店員解鎖', 'info', 1800);
        else if (me.grabbing != null) this.toast('先把抓著的人丟出去', 'info', 1200);
        else { const k = this.karenTarget(s); if (k) this.send({ type: 'hit', rid: newRid(), id: k.id }); else this.toast('準星對準身前的人再出手', 'info', 1200); }
      }
      if (this.input.consume('ultimate')) this.send({ type: 'ultimate', rid: newRid() });
      if (this.input.consume('ping')) this.doPing();
      if (this.input.consume('skip')) { if (this.tut) this.skipTutorial(); else if (!this.conn.solo) this.openOverlay('quick'); }
      if (this.input.consume('ready') && (s.phase === 'prep' || s.phase === 'summary')) this.send({ type: 'ready', ready: !me.ready });
      if (this.qte) this.changePromptFrame(s);
      for (let i = 1; i <= QUICK_MESSAGES.length; i++) if (this.input.consume(`q${i}` as 'q1')) this.sendQuick(i - 1);
    } else {
      this.input.takeLook();
      this.target = null;
      if (this.overlay === 'quick') this.wheelFrame();
    }

    // send position at INPUT_RATE
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / INPUT_RATE;
      this.send({ type: 'input', x: this.pos.x, z: this.pos.z, yaw: this.yaw, pitch: this.pitch, seq: this.seq++ });
    }

    audio.listener = { x: this.pos.x, z: this.pos.z };
    // hit-stop freezes the rendered world for a few frames; slow-mo scales effect/animation time
    // (positions stay server-authoritative: this is a visual effect only)
    const ts = this.warp.scale(now);
    this.view.tickCamera(dt, me.grabbing != null);
    if (ts > 0) this.view.update(s, this.selfId, dt * ts, () => null);
    this.view.setCamera(this.pos.x, this.pos.z, this.yaw, this.pitch, this.bob, me.held);
    this.view.setSecondHand(me.held2);
    const tb = this.target?.box ? new THREE.Box3(new THREE.Vector3(this.target.box.x0, 0, this.target.box.z0), new THREE.Vector3(this.target.box.x1, this.target.box.h ?? 1.5, this.target.box.z1))
      : this.target?.point ? new THREE.Box3(new THREE.Vector3(this.target.point.x - 0.35, 0, this.target.point.z - 0.35), new THREE.Vector3(this.target.point.x + 0.35, Math.max(0.15, this.target.point.h), this.target.point.z + 0.35)) : null;
    this.view.setHighlight(tb);
    if (!this.tutorial && s.shift.id === '1-1' && !this.flags.tutorialDone) this.tutorial = new Tutorial(this.touch, () => keyOf('interact'));
    this.tut = this.tutorial ? this.tutorial.update(s, me, this.pos, now) : null;
    // first shift: reaching the till during the prep seconds opens the store (no waiting, no extra button)
    if (this.tut?.ready && s.phase === 'prep' && !me.ready && this.conn.solo && !this.autoReady) { this.autoReady = true; this.send({ type: 'ready', ready: true }); }
    this.view.setGuide(this.tut?.target ?? this.shelfGuide);
    this.view.render();
    this.minimap.draw(s, this.selfId, { x: this.pos.x, z: this.pos.z, yaw: this.yaw }, now / 1000, this.tut?.target ?? this.shelfGuide);

    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.1; this.updateHud(s, me); }
    this.fpsFrames++; this.fpsT += dt;
    if (this.fpsT >= 1) { $('fps').textContent = this.settings.showFps ? `${this.fpsFrames} FPS` : ''; this.fpsFrames = 0; this.fpsT = 0; }
  };

  /** Preset callout / emote (multiplayer; solo has nobody to tell). A short client-side gap; the server rate-limits too. */
  private sendQuick(i: number) {
    const t = performance.now();
    if (this.conn.solo || t - this.lastQuickAt < QUICK_MIN_GAP_MS) return;
    this.lastQuickAt = t;
    this.send({ type: 'quick', msg: i });
  }

  /** The emote wheel is open: number keys, mouse / stick pointing, click / A / letting go of View. */
  private wheelFrame() {
    const w = this.wheel;
    for (let i = 1; i <= QUICK_MESSAGES.length; i++) if (this.input.consume(`q${i}` as 'q1')) { this.sendQuick(i - 1); this.closeOverlay(); return; }
    const m = this.input.takeWheel(); w.mouse(m.dx, m.dy);
    const { padL: l, padR: r } = this.input;
    const st = Math.hypot(r.x, r.y) > Math.hypot(l.x, l.y) ? r : l;
    w.stick(st.x, st.y);
    const send = () => { if (w.sel !== null) this.sendQuick(w.sel); this.closeOverlay(); };
    if (this.input.consume('interact')) { send(); return; }
    if (this.input.consume('drop') || this.input.consume('menu')) { this.closeOverlay(); return; }
    // hold View, point with a stick, let go: sent
    if (w.byPad && !this.input.padDown(BTN.VIEW)) { if (w.sel !== null) { send(); return; } w.byPad = false; }
  }

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
    this.refreshControls(s);
    this.cheer(s);
    $('h-day').textContent = `第 ${s.day} 天`;
    $('h-clock').textContent = s.phase === 'prep' ? `準備 ${fmtSec(s.phaseLeft)}` : s.phase === 'closing' ? `打烊中 ${fmtSec(s.phaseLeft)}` : s.phase === 'summary' ? '日結' : `🕒 ${fmtClock(s.clock)}`;
    $('h-money').textContent = `💰 $${s.money}`;
    $('h-rating').textContent = `★ ${s.rating.toFixed(1)}`;
    const nBots = s.players.filter(p => p.bot).length;
    $('h-players').textContent = `👥 ${s.players.filter(p => p.connected && !p.bot).length}/5${nBots ? ` +🤖${nBots}` : ''}`;
    const cap = shelfCapacity(s.upgrades.shelves);
    this.shelfWarnings(s, me);
    const nowMs = performance.now();
    const stockHtml = PRODUCTS.map(p => {
      const r = s.shelves[p] / cap;
      // empty / nearly empty shelves flash; an empty one shows how long until bare-shelf customers cost rating
      const warn = (s.phase === 'open' || s.phase === 'closing') && !s.raid && s.shelves[p] <= NEAR_EMPTY;
      const g = this.shelfWatch.isEmpty(p) ? this.shelfWatch.graceLeft(p, nowMs) : -1;
      const tag = g < 0 ? '' : g > 0 ? `<b class="shelfwarn">空了！${g}s</b>` : '<b class="shelfwarn">空架扣口碑中</b>';
      // low / empty is said with a symbol too, not only the red bar (色盲友善)
      const lvlMark = s.shelves[p] <= 0 ? '<i class="lvl" title="空了">✖</i>' : r < 0.3 ? '<i class="lvl" title="快空了">▼</i>' : '';
      return `<div class="stockrow${warn ? ' warn' : ''}"><span>${PRODUCT_INFO[p].name}${tag}</span><span>${lvlMark}${s.shelves[p]}/${cap}・倉 ${s.backstock[p]}</span></div><div class="bar${warn ? ' warn' : ''}"><i class="${r < 0.3 ? 'low' : 'ok'}" style="width:${r * 100}%"></i></div>`;
    }).join('') + `<div class="stockrow"><span>🧹 拖把</span><span>${s.mopsOnRack}/2</span></div><div class="stockrow"><span>💧 髒污</span><span>${s.spills.length}</span></div>`;
    // only touch the DOM when something changed (keeps the empty-shelf flash animation running smoothly)
    if (stockHtml !== this.stockHtml) { this.stockHtml = stockHtml; $('h-stock').innerHTML = stockHtml; }
    // team list: pings come with the lobby updates (≤ every 2 s); the DOM is only touched when the text changes
    const lp = new Map((this.lobby?.players ?? []).map(p => [p.id, p]));
    const teamHtml = s.players.map(p => {
      const held = p.held ? (p.held.kind === 'box' ? '📦' : p.held.kind === 'coffee' ? '☕' : '🧹') : '';
      const recon = !p.connected || (p.id === this.selfId && this.status === 'reconnecting');
      const st = recon ? '' : p.away ? '💤' : p.busy ? '🛠' : '';
      const ping = this.conn.solo || p.bot ? undefined : lp.get(p.id)?.ping;
      const net = recon ? '<span class="trecon">🔄 重連中…</span>'
        : ping !== undefined ? `<span class="tping" title="延遲 ${ping} ms・${UI.pingWord(ping)}">📶${ping}ms${UI.pingBars(ping)}</span>` : '';
      const crown = !this.conn.solo && this.lobby?.hostId === p.id ? '👑' : '';
      return `<div class="stockrow" data-pid="${UI.esc(p.id)}"><span><span class="dot" style="display:inline-block;width:11px;height:11px;vertical-align:-1px;background:#${p.color.toString(16).padStart(6, '0')}"></span> ${crown}${UI.esc(p.name)}${p.id === this.selfId ? '（你）' : ''}</span><span>${held}${st}${(s.phase === 'prep' || s.phase === 'summary') ? (p.ready ? '✅' : '⏳') : ''}${net}</span></div>`;
    }).join('');
    if (teamHtml !== this.teamHtml) { this.teamHtml = teamHtml; $('h-team').innerHTML = teamHtml; }
    // prompt
    const pr = $('prompt');
    if (this.overlay !== 'none') pr.innerHTML = '';
    else if (me.busy || this.qte) pr.innerHTML = ''; // (the exact-change prompt says everything itself)
    else if (this.target) {
      // key chip: the key / pad glyph, or on touch the text of the button to press (same words as on the button)
      const dev = promptDevice(inputMode(), this.touch), style = padStyle();
      const key = promptKey('interact', dev, style, this.target.primary ? shortLabel(this.target.primary, this.target.target, this.snap) : '互動');
      const altKey = promptKey('alt', dev, style, this.target.alt ? shortLabel(this.target.alt, this.target.target, this.snap) : '次要');
      pr.innerHTML = (this.target.primary ? `<span class="key">${key}</span>${UI.esc(this.target.label)}` : UI.esc(this.target.label))
        + (this.target.reason ? `<div class="sub">${UI.esc(this.target.reason)}</div>` : '')
        + (this.target.altLabel ? `<div class="sub"><span class="key">${altKey}</span>${UI.esc(this.target.altLabel)}</div>` : '');
    } else pr.innerHTML = me.held ? `<div class="sub">${this.touch ? '「放下」' : keyOf('drop')} 放下手上物品</div>` : '';
    const prog = $('progress');
    if (me.busy) { prog.classList.remove('hidden'); (prog.firstElementChild as HTMLElement).style.width = `${me.busy.p * 100}%`; } else prog.classList.add('hidden');
    // touch contextual buttons
    if (this.touch) {
      $('t-alt').classList.toggle('hidden', !this.target?.altLabel);
      const al = this.target?.altLabel && this.target.alt ? shortLabel(this.target.alt, this.target.target, this.snap) : '次要';
      if ($('t-alt').textContent !== al) { $('t-alt').textContent = al; $('t-alt').classList.toggle('long', al.length > 3); }
      $('t-item').classList.toggle('hidden', !me.held);
      const tl = this.target?.primary ? shortLabel(this.target.primary, this.target.target, this.snap) : '互動';
      $('t-interact').textContent = tl;
      $('t-interact').classList.toggle('long', tl.length > 4);
    }
    this.escortCue(s);
    // karen alert
    // (a 借廁所大隊 counts once: its followers are part of the leader's karen)
    const karens = s.customers.filter(c => c.kind !== 'normal' && !c.resolved && c.revealed && c.state !== 'leaving' && !(c.kind === 'toilet' && c.phase === 2));
    const al = $('alert');
    const boss = karens.find(k => k.kind === 'boss');
    if (boss) {
      al.classList.remove('hidden');
      al.innerHTML = `👑 奧客之王 第 ${boss.phase}/5 階段「${BOSS_PHASES[boss.phase]}」${boss.phase === 2 ? `（怒氣 ${boss.anger}）` : ''}<div style="font-size:13px;font-weight:600">${BOSS_HOW[boss.phase]}</div>`;
    } else if (karens.length && !this.tut?.urgent) { // (the tutorial's urgent line already names the karen)
      const k = karens[0];
      const info = KAREN_INFO[k.kind as keyof typeof KAREN_INFO];
      al.classList.remove('hidden');
      al.innerHTML = `⚠ ${info.name}${k.kind === 'rager' ? `（怒氣 ${k.anger}/100）` : ''}${karens.length > 1 ? ` 等 ${karens.length} 個事件` : ''}<div style="font-size:13px;font-weight:600">${info.how}</div>`;
    } else al.classList.add('hidden');
    // phase banner
    const pb = $('phasebanner');
    if (s.phase === 'prep' && s.shift.mode === 'shift' && this.tut) {
      // first shift: the tutorial line is the only instruction (walking to the till starts the shift)
      if (pb.dataset.k) { pb.dataset.k = ''; pb.innerHTML = ''; }
    } else if (s.phase === 'prep' && s.shift.mode === 'shift') {
      const html = `<button class="btn small good" id="pb-ready">▶ 開始上班${this.touch ? '' : ` [${keyOf('ready')}]`}（<span id="pb-left"></span>）</button>`;
      if (pb.dataset.k !== html) {
        pb.dataset.k = html; pb.innerHTML = html;
        document.getElementById('pb-ready')!.addEventListener('click', () => this.send({ type: 'ready', ready: true }));
      }
      $('pb-left').textContent = String(Math.ceil(s.phaseLeft));
    } else if (s.phase === 'prep') {
      const ready = s.players.filter(p => p.ready).length, total = s.players.filter(p => p.connected).length;
      const html = `<button class="btn small ${me.ready ? '' : 'good'}" id="pb-ready">${me.ready ? '取消準備' : '準備開店'}（${ready}/${total}）${this.touch ? '' : ` [${keyOf('ready')}]`}</button><button class="btn small" id="pb-shop">🛒 採購/升級${this.touch ? '' : ` [${keyOf('shop')}]`}</button>`;
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
      $('sb-title').textContent = /^\d-\d$/.test(s.shift.id) ? `${s.shift.id}・${s.shift.title}` : s.shift.title;
      $('sb-extra').textContent = `口碑 ★${s.rating.toFixed(1)}・現金 $${s.money}`;
      const elapsed = Math.round(s.shift.length - s.phaseLeft);
      $('sb-time').textContent = s.phase === 'prep' ? `準備 ${Math.ceil(s.phaseLeft)}` : s.phase !== 'open' ? '收尾中' : s.shift.endless ? `🌙 已撐 ${elapsed} 秒` : `⏱ ${Math.ceil(s.phaseLeft)} 秒`;
      const rev = s.dayStats.revenue;
      $('sb-money').textContent = s.shift.endless ? `$${rev}・分數約 ${rev + s.dayStats.ejected * 10 + s.dayStats.karensResolved * 15 + Math.max(0, elapsed)}` : `$${rev} / $${s.shift.goal}`;
      ($('sb-moneybar') as HTMLElement).style.width = s.shift.endless ? '100%' : `${Math.min(100, rev / s.shift.goal * 100)}%`;
      $('sb-moneybar').classList.toggle('done', !s.shift.endless && rev >= s.shift.goal); // goal reached: stripes + ✓ text, not just green
      if (!s.shift.endless && rev >= s.shift.goal) $('sb-money').textContent += ' ✓達標';
      document.body.classList.toggle('raid', !!s.raid);
      if (s.raid) {
        // raid: the bar shows how close the clerk is to throwing you out
        $('sb-extra').textContent = `😈 搗亂分數 ${s.raid.score}`;
        $('sb-chaoslabel').textContent = '👀 店員注意';
        $('sb-chaos').textContent = s.raid.watched >= 0.7 ? '🚨 快被抓了！' : s.raid.watched > 0 ? '👀 被盯上了' : '✔ 安全';
        $('sb-chaosbar').classList.toggle('crit', s.raid.watched >= 0.7);
        ($('sb-chaosbar') as HTMLElement).style.width = `${Math.round(s.raid.watched * 100)}%`;
      } else {
        $('sb-chaoslabel').textContent = '混亂度';
        $('sb-chaos').textContent = `${s.chaos >= 80 ? '🔥 ' : s.chaos >= 55 ? '⚠ ' : ''}${s.chaos}%`;
        $('sb-chaosbar').classList.toggle('crit', s.chaos >= 80);
        ($('sb-chaosbar') as HTMLElement).style.width = `${s.chaos}%`;
      }
      $('h-day').textContent = s.shift.endless ? '無限夜班' : `第 ${s.shift.chapter} 章`;
    }
    const hasUlt = s.shift.abilities.includes('ultimate');
    $('burst').classList.toggle('hidden', !hasUlt);
    if (hasUlt) {
      $('burst-num').textContent = `${s.burst}/100`;
      ($('burst-bar') as HTMLElement).style.width = `${s.burst}%`;
      $('burst').classList.toggle('full', s.burst >= 100);
      $('burst-hint').textContent = s.burst >= 100 ? `按 ${this.touch ? '「退散」' : keyOf('ultimate')} 全店奧客退散！` : '請出門 +25・旋風 +12・投擲 +4';
    }
    (($('stamina').firstElementChild) as HTMLElement).style.width = `${this.stamina / s.shift.staminaMax * 100}%`;
    ($('stamina').firstElementChild as HTMLElement).classList.toggle('low', this.stamina < 25); // colour + stripes (色盲友善)
    const es = $('eventstrip');
    if (s.event) { es.classList.remove('hidden'); es.textContent = s.event.kind === 'outage' ? `⚡ 停電中 ${Math.ceil(s.event.left)}s` : `🚶 尖峰人潮 ${Math.ceil(s.event.left)}s`; } else es.classList.add('hidden');
    if (s.raid && s.phase === 'open') {
      const hb = $('hintbar'); hb.classList.remove('hidden');
      hb.textContent = this.touch ? '😈「互動」打翻商品／嗆客人、「丟垃圾」亂丟垃圾，別讓店員靠近太久' : `😈 ${keyOf('interact')} 打翻商品／嗆客人、${keyOf('drop')} 亂丟垃圾，別讓店員靠近太久`;
    } else if (this.tut) {
      const hb = $('hintbar'); hb.classList.remove('hidden');
      hb.textContent = this.tut.urgent ? this.tut.text : `📘 教學 ${Math.min(this.tut.step, this.tut.total)}/${this.tut.total}：${this.tut.text}`;
      hb.classList.toggle('urgent', !!this.tut.urgent);
      const finished = this.tut.step >= this.tut.total;
      $('tutskip').classList.toggle('hidden', finished);
      $('tutskip').textContent = this.touch ? '跳過教學' : `跳過教學（${keyOf('skip')}）`;
      if (finished && !this.flags.tutorialDone) { this.flags.tutorialDone = true; saveFlags(this.flags); }
    } else { $('tutskip').classList.add('hidden'); if (performance.now() > this.hintUntil) $('hintbar').classList.add('hidden'); }
    if (this.touch) {
      const ab = s.shift.abilities;
      $('t-grab').classList.toggle('hidden', !ab.includes('grab'));
      $('t-hit').classList.toggle('hidden', !ab.includes('hit'));
      $('t-grab').textContent = me.grabbing != null ? '丟出' : '抓起';
      $('t-spin').classList.toggle('hidden', !ab.includes('spin'));
      $('t-spin').textContent = me.spinCd > 0 ? `${Math.ceil(me.spinCd)}` : '旋風';
      $('t-ult').classList.toggle('hidden', !ab.includes('ultimate'));
      $('t-ult').classList.toggle('active', s.burst >= 100);
      $('t-item').classList.toggle('hidden', !me.held && !me.held2 && me.grabbing == null && !me.raider);
      $('t-item').textContent = me.raider && !me.held ? '丟垃圾' : '放下';
    }
    if (me.grabbing != null) pr.innerHTML = `<span class="key">${this.touch ? '丟出' : keyOf('grab')}</span>對準發光的出口丟出去！<div class="sub">${this.touch ? '「放下」' : keyOf('drop')} 放開</div>`;
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
    window.removeEventListener('keydown', this.onKey);
    for (const t of this.introTimers) clearTimeout(t);
    for (const t of this.afTimers) clearTimeout(t);
    setControlsContext(null);
    this.wheel.el.remove();
    $('aftermath').classList.add('hidden');
    $('introcard').classList.add('hidden'); $('tutskip').classList.add('hidden'); $('arccard').classList.add('hidden');
    this.input.unlock();
    this.conn.close();
    audio.stopMusic();
    audio.stopStoreAmbience();
    $('hud').classList.add('hidden'); $('touch').classList.add('hidden'); $('netstatus').classList.add('hidden');
    document.body.classList.remove('shiftmode', 'raid');
    this.view.renderer.dispose();
    this.onExit(reason, this.finalResult);
  }
}

/** 發票對獎魔人 keeps walking while a worker is this close (same distance as escortPaused in shared/sim.ts). */
const ESCORT_NEAR = 3.2;

/** Styles of the exact-change prompt + the escort cue (injected once; kept here so the page shell stays untouched). */
function ensureQteStyle() {
  if (document.getElementById('qte-style')) return;
  const st = document.createElement('style'); st.id = 'qte-style';
  st.textContent = `#qte { position: absolute; left: 0; right: 0; margin: 0 auto; bottom: 22%; width: min(560px, 92vw); background: var(--cream, #fff6e5); color: var(--ink, #2a1f3d);
    border: 4px solid var(--ink, #2a1f3d); box-shadow: 0 7px 0 var(--ink, #2a1f3d); border-radius: 20px; padding: 10px 14px; z-index: 9; text-align: center; animation: pop .25s both; pointer-events: auto; }
  #qte .qte-title { font-weight: 900; font-size: 18px; } #qte .qte-title b { color: #e8590c; font-size: 22px; }
  #qte .qte-opts { display: flex; gap: 8px; margin: 8px 0 6px; flex-wrap: wrap; justify-content: center; }
  #qte .qte-opt { flex: 1 1 150px; min-height: 48px; border: 3px solid var(--ink, #2a1f3d); border-radius: 14px; background: #fff; color: var(--ink, #2a1f3d); font: inherit; font-weight: 800; cursor: pointer; padding: 6px; line-height: 1.6;
    display: flex; align-items: center; justify-content: center; gap: 4px; touch-action: manipulation; }
  #qte .qte-opt:hover, #qte .qte-opt:focus-visible { background: #fff3bf; }
  #qte kbd { flex: none; background: var(--ink, #2a1f3d); color: #fff; border-radius: 6px; padding: 0 6px; margin-right: 4px; font: inherit; font-size: 15px; white-space: nowrap; }
  #qte .qte-coins { display: inline; }
  #qte .coin { display: inline-block; min-width: 26px; height: 26px; border-radius: 50%; background: #fcc419; border: 2px solid #b08900; font-size: 11px; line-height: 22px; margin: 0 1px; }
  #qte .coin.c50 { background: #ffd43b; min-width: 30px; height: 30px; line-height: 26px; } #qte .coin.c1 { background: #dee2e6; border-color: #868e96; }
  #qte .qte-bar { height: 8px; border-radius: 4px; background: #e9ecef; overflow: hidden; border: 2px solid var(--ink, #2a1f3d); } #qte .qte-bar i { display: block; height: 100%; background: #f59f00; width: 100%; }
  #qte.low .qte-bar i { background: #e03131; } #qte.low .qte-time { color: #c92a2a; } #qte.low .qte-time::after { content: '・快！'; }
  #qte .qte-foot { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; margin-top: 4px; } #qte .qte-time { font-weight: 900; font-size: 14px; white-space: nowrap; }
  #qte .qte-help { opacity: .8; }
  /* phone: a compact card in the top-middle, clear of the joystick (bottom left) and the action buttons (bottom right) */
  body.touch #qte { left: 22%; right: auto; margin: 0; bottom: auto; top: calc(58px + var(--safe-t, 0px)); width: 44vw; padding: 6px 8px; border-radius: 16px; box-shadow: 0 5px 0 var(--ink, #2a1f3d); }
  body.touch #qte .qte-title { font-size: 15px; } body.touch #qte .qte-title b { font-size: 18px; }
  body.touch #qte .qte-opts { flex-wrap: nowrap; gap: 6px; margin: 5px 0 4px; }
  body.touch #qte .qte-opt { flex: 1 1 0; min-height: 64px; min-width: 56px; flex-direction: column; gap: 0; padding: 3px 2px; line-height: 1.35; font-size: 12px; }
  body.touch #qte kbd { margin: 0; font-size: 12px; }
  body.touch #qte .coin { min-width: 22px; height: 22px; line-height: 18px; font-size: 10px; } body.touch #qte .coin.c50 { min-width: 24px; height: 24px; line-height: 20px; }
  #escortcue { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -100%); display: flex; align-items: center; gap: 8px; padding: 4px 14px 5px 8px; border-radius: 999px; font-weight: 900; font-size: 18px;
    background: rgba(255,246,229,.94); color: var(--ink, #2a1f3d); border: 3px solid var(--ink, #2a1f3d); box-shadow: 0 4px 0 rgba(42,31,61,.6); white-space: nowrap; pointer-events: none; }
  #escortcue .ec-arrow { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--ink, #2a1f3d); color: #fff; font-size: 17px; transition: transform .15s; }
  #escortcue[data-state="far"] { background: #ffe3e3; border-color: #c92a2a; color: #c92a2a; animation: ecpulse .5s infinite alternate; }
  @keyframes ecpulse { to { scale: 1.08; } }
  #escortcue[data-state="far"] .ec-arrow { background: #c92a2a; }
  #escortcue[data-state="ok"] .ec-arrow { background: #2b8a3e; }
  body.reduce-motion #escortcue { animation: none !important; }
  body.touch #escortcue { top: 36%; font-size: 16px; }`;
  document.head.appendChild(st);
}

/** Interaction prompt for a store-signature karen, built from its data (sigkarens.ts). */
function sigCandidate(c: CustomerSnap, hands: (string | null)[], money: number, t: Target, point: Candidate['point']): Candidate {
  const d = SIG_KARENS[c.kind as keyof typeof SIG_KARENS];
  const wait = sigWaitReason(c.kind, c.state);
  if (wait) return { label: d.name, reason: wait, target: t, point };
  const needName = (n: SigNeed) => n === 'coffee' ? FOOD_INFO.coffee.name || NEED_LABEL.coffee : n === 'meal' ? FOOD_INFO.meal.name || NEED_LABEL.meal : NEED_LABEL[n];
  const presses = d.presses ?? 1;
  const count = presses > 1 ? `（${Math.min(c.phase, presses - 1) + 1}/${presses}）` : '';
  const heat = d.tpl === 'haggle' ? `・火氣 ${c.anger}` : '';
  const altOk = d.alt && (!d.altNeed || hands.includes(d.altNeed)) && (!d.altCost || money >= d.altCost);
  const alt = altOk ? { alt: 'sigAlt' as ActKind, altLabel: d.alt } : {};
  // 照片魔人 style: holding what he ordered → hand it over, the explanation is the second choice
  if (d.tpl === 'redo' && hands.includes(c.want ?? '')) return { label: `交付${FOOD_INFO[c.want!].name}（第 ${c.phase + 1} 次）`, primary: 'deliver', alt: 'sigAct', altLabel: d.act, target: t, point };
  if (d.need && !hands.includes(d.need)) {
    if (altOk) return { label: `${d.alt}（${d.name}）`, primary: 'sigAlt', target: t, point };
    return { label: d.name, reason: `先拿${needName(d.need)}過來，再「${d.act}」`, target: t, point };
  }
  return { label: `${d.act}${count}${heat}`, primary: 'sigAct', ...alt, target: t, point };
}

/** Text for the round touch button: short, at most two short lines. */
function shortLabel(k: ActKind, target?: Target, s?: Snapshot | null) {
  if ((k === 'sigAct' || k === 'sigAlt') && target?.t === 'customer' && s) {
    const c = s.customers.find(x => x.id === target.id);
    const d = c && isSig(c.kind) ? SIG_KARENS[c.kind as keyof typeof SIG_KARENS] : null;
    const text = d ? (k === 'sigAct' ? d.act : d.alt ?? '') : '';
    if (text) return text.length > 8 ? text.slice(0, 7) + '…' : text;
  }
  const m: Partial<Record<ActKind, string>> = {
    knock: '打翻', heckle: '嗆人', checkout: '結帳', brew: FOOD_INFO.coffee.verb, heat: FOOD_INFO.meal.verb, deliver: '交付', takeBox: '拿貨', stock: '上架', returnBox: '放回',
    takeMop: '拿拖把', returnMop: '放回', clean: '清理', calm: '安撫', coupon: '折價券', askQueue: '請排隊', stopFilm: '制止', checkBag: '請結帳', pickup: '撿起',
    stopLitter: '請撿垃圾', unplug: '拔插頭', treat: '請喝', repeatOrder: '複誦點單', recommend: '推薦招牌', limitTry: '限試穿', grab: '抓起', sigAct: '處理', sigAlt: '另一招',
    escort: '帶去對獎', countChange: '陪她數', exactChange: '找剛好', stopBag: '攔下', toiletRule: '限消費',
  };
  const t = m[k] ?? '互動';
  return t.length > 8 ? t.slice(0, 7) + '…' : t;
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
