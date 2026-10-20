// Career screens: rank card, chapter map, skill trees, gear shop and the post-shift result.
import {
  ABILITY_INFO, ABILITY_LEVEL, Ability, CHAPTERS, CareerProfile, GEAR, GEAR_IDS, GEAR_MAX, GearId, MAX_LEVEL, RANKS, Reward, SKILLS,
  SKILL_MAX, ShiftResult, SkillTree, buyGear, chapterUnlocked, expToNext, findShift, gearPrice, rankOf, sanitizeProfile, shiftUnlocked,
  ENDLESS_ID, endlessUnlocked, DAILY_ID, DAILY_MODS, dailyPlan, dailyUnlocked, localDate,
  spendSkill,
} from '../../shared/career.ts';
import { ACHIEVEMENTS, Achievement } from '../../shared/achievements.ts';
import { STORE_FUND, STORE_RESERVE, WAGES, WageMode, canOpenStore, closeStore, hireStaff, openStore, staffPace, withdraw } from '../../shared/ownstore.ts';
import { defaultSave } from '../../shared/sim.ts';
import { MAPS, getMap } from '../../shared/maps/index.ts';
import { KAREN_INFO } from '../../shared/constants.ts';
import { confirmTwice, esc, show } from './ui.ts';
import { takeReports, syncStore, uploadStore } from './friends.ts';
import { lockedPack, ownStoreLockHtml, shopHtml, wireShop } from './shop-ui.ts';
import { dexHtml, dexSwitch } from './dex-ui.ts';

const KEY = 'fucustomer.career.v1';
export function loadProfile(): CareerProfile {
  try { return sanitizeProfile(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return sanitizeProfile(null); }
}
export function saveProfile(p: CareerProfile) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } }

type Tab = 'chapters' | 'store' | 'skills' | 'gear' | 'shop' | 'free' | 'achievements' | 'dex' | 'stats';
export interface CareerHandlers { play(shiftId: string): void; back(): void; enterStore(): void; opened(): void; raid(code: string): void; freePlay(): void }

const stars = (n: number, max = 3) => '★'.repeat(n) + '<span class="dim">' + '★'.repeat(max - n) + '</span>';

function rankCard(p: CareerProfile) {
  const need = expToNext(p.level);
  const pct = p.level >= MAX_LEVEL ? 100 : Math.min(100, (p.exp / need) * 100);
  const nextRank = RANKS.find(r => r.from > p.level);
  return `
    <div class="rankcard">
      <div class="row" style="gap:8px;width:100%;flex-wrap:nowrap"><div class="rankbadge">Lv.${p.level}</div>
        <div class="wallet">💰 ${p.wallet}<small>存款</small></div></div>
      <div class="rankname">${rankOf(p.level)}</div>${p.title ? `<span class="tag ok">${esc(p.title)}</span>` : ''}
      <div class="bar big" style="width:100%"><i style="width:${pct}%;background:var(--warn)"></i></div>
      <div class="muted">${p.level >= MAX_LEVEL ? '已達最高職級' : `EXP ${p.exp} / ${need}`}${nextRank ? `<br>Lv.${nextRank.from} 晉升「${nextRank.name}」` : ''}</div>
    </div>`;
}

/** `focus`: for the shop tab, a pack id (or filter) to jump to. */
export function careerScreen(p: CareerProfile, h: CareerHandlers, tab: Tab = 'chapters', focus?: string) {
  const tabs: [Tab, string][] = [['chapters', '📖 主線'], ['store', p.store ? `🏪 ${esc(p.store.name)}` : '🏪 我的店'], ['skills', `🧠 技能${p.skillPoints ? ` (${p.skillPoints})` : ''}`], ['gear', '🧰 裝備'], ['shop', '🛍 商城'], ['free', '🗺 自由營業'], ['achievements', `🏆 成就 ${p.achievements.length}/${ACHIEVEMENTS.length}`], ['stats', '📊 紀錄']];
  show(`
    <div class="card wide career">
      <div class="c-side">
        ${rankCard(p)}
        <div class="tabs">${tabs.map(([t, l]) => `<button class="tab ${t === tab || (t === 'achievements' && tab === 'dex') ? 'on' : ''}" data-tab="${t}">${l}</button>`).join('')}</div>
        <button class="btn small" id="c-back">← 主選單</button>
      </div>
      <div class="c-main" id="c-body">${tab === 'chapters' ? chaptersHtml(p) : tab === 'skills' ? skillsHtml(p) : tab === 'gear' ? gearHtml(p) : tab === 'shop' ? shopHtml(p, focus) : tab === 'store' ? storeHtml(p) : tab === 'achievements' ? achievementsHtml(p) : tab === 'dex' ? dexHtml(p) : statsHtml(p)}</div>
    </div>`);
  document.getElementById('c-back')!.onclick = () => h.back();
  if (tab === 'shop') wireShop(p, saveProfile, f => careerScreen(p, h, 'shop', f));
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => { b.onclick = () => (b.dataset.tab === 'free' ? h.freePlay() : careerScreen(p, h, b.dataset.tab as Tab)); });
  document.querySelectorAll<HTMLButtonElement>('[data-play]').forEach(b => { b.onclick = () => h.play(b.dataset.play!); });
  document.querySelectorAll<HTMLButtonElement>('[data-skill]').forEach(b => { b.onclick = () => { if (spendSkill(p, b.dataset.skill as SkillTree)) saveProfile(p); careerScreen(p, h, 'skills'); }; });
  const redraw = () => { saveProfile(p); careerScreen(p, h, 'store'); };
  const on = (id: string, fn: () => void) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('st-open', () => {
    const name = (document.getElementById('st-name') as HTMLInputElement).value;
    const all = (document.getElementById('st-all') as HTMLInputElement | null)?.checked;
    const map = (document.querySelector('input[name="st-map"]:checked') as HTMLInputElement | null)?.value ?? 'convenience';
    const pack = lockedPack(p, map, 'own'); if (pack) return careerScreen(p, h, 'shop', pack.id); // premium store: go to its pack
    if (openStore(p, name, all ? p.wallet : STORE_FUND, defaultSave(), map)) { saveProfile(p); h.opened(); }
  });
  on('st-enter', () => h.enterStore());
  on('st-withdraw', () => { withdraw(p); redraw(); });
  on('st-hire', () => { hireStaff(p); redraw(); });
  const closeBtn = document.getElementById('st-close') as HTMLButtonElement | null;
  if (closeBtn) closeBtn.onclick = () => confirmTwice(closeBtn, '再按一次收店（現金回到存款）', () => { closeStore(p); redraw(); });
  document.querySelectorAll<HTMLInputElement>('[name="st-wage"]').forEach(r => { r.onchange = () => { if (p.store) { p.store.wage = r.value as WageMode; redraw(); } }; });
  // friends: share the store code, lock the door, collect damage reports, go raid a friend
  const msg = (t: string) => { const el = document.getElementById('st-msg'); if (el) el.textContent = t; };
  on('st-upload', async () => {
    if (!p.store) return; msg('上傳中…');
    const r = await uploadStore(p.store);
    if (!r.ok) return msg(r.error);
    const prof = loadProfile(); if (!prof.store) return;
    prof.store.online = { code: r.data.code, token: r.data.token, locked: false };
    saveProfile(prof); careerScreen(prof, h, 'store');
  });
  on('st-lock', async () => {
    if (!p.store?.online) return;
    p.store.online.locked = !p.store.online.locked; saveProfile(p);
    const r = await syncStore(p.store);
    if (!r.ok) { p.store.online.locked = !p.store.online.locked; saveProfile(p); return msg(r.error); }
    careerScreen(p, h, 'store');
  });
  on('st-reports', async () => {
    if (!p.store?.online) return; msg('查詢中…');
    const r = await takeReports(p.store);
    if (!r.ok) return msg(r.error);
    if (!r.data.length) return msg('沒有人來搗亂過 👍');
    const lossM = r.data.reduce((n, x) => n + x.money, 0), lossR = r.data.reduce((n, x) => n + x.rating, 0);
    const st = p.store;
    st.save = { ...st.save, money: st.save.money - lossM, rating: Math.max(0, Math.round((st.save.rating - lossR) * 100) / 100) };
    saveProfile(p); void syncStore(st);
    careerScreen(p, h, 'store');
    msg(r.data.map(x => `${x.outside ? '🚪 在門外丟垃圾' : '😈 進店搗亂'}：${x.raider}（−$${x.money}${x.rating ? `、口碑 −${x.rating}` : ''}）`).join('　'));
  });
  on('st-raid', () => {
    const code = (document.getElementById('st-raid-code') as HTMLInputElement).value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return msg('店碼是 6 碼英數字');
    if (p.store?.online?.code === code) return msg('這是你自己的店 😅');
    h.raid(code);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-gear]').forEach(b => { b.onclick = () => { if (buyGear(p, b.dataset.gear as GearId)) saveProfile(p); careerScreen(p, h, 'gear'); }; });
}

function chaptersHtml(p: CareerProfile) {
  // the first playable, not-yet-cleared shift is highlighted as "next"
  let next = '';
  for (const c of CHAPTERS) for (const s of c.shifts) if (!next && !p.stars[s.id] && shiftUnlocked(p, s.id).ok) next = s.id;
  const endless = endlessUnlocked(p)
    ? `<div class="chapter endless"><div class="chhead"><b>🌙 無限夜班</b><span class="muted">通關後的挑戰模式</span><span class="tag ok">最高分 ${p.endlessBest}</span></div>
        <div class="muted story">客人和奧客越來越多，撐越久分數越高。隨時可以從選單「下班結算」。</div>
        <button class="btn primary" data-play="${ENDLESS_ID}">開始無限夜班</button></div>`
    : `<div class="chapter locked"><div class="chhead"><b>🌙 無限夜班</b></div><div class="muted story">🔒 擊敗第 6 章「奧客之王」後解鎖</div></div>`;
  return dailyHtml(p) + CHAPTERS.map(c => {
    const open = chapterUnlocked(p, c.n);
    const got = c.shifts.reduce((n, s) => n + (p.stars[s.id] ?? 0), 0);
    return `
      <div class="chapter ${open.ok ? '' : 'locked'}">
        <div class="chhead"><b>第 ${c.n} 章・${esc(c.title)}</b><span class="muted">${esc(c.place)}</span><span class="tag">★ ${got}/${c.shifts.length * 3}</span></div>
        <div class="muted story">${open.ok ? esc(c.story) : `🔒 ${esc(open.why ?? '')}`}</div>
        ${open.ok ? `<div class="shifts">${c.shifts.map(s => {
          const u = shiftUnlocked(p, s.id);
          const st = p.stars[s.id] ?? 0;
          const ks = s.karens.map(k => KAREN_INFO[k].name).join('、') || '無奧客';
          return `<button class="shiftbtn ${s.id === next ? 'next' : ''}" data-play="${s.id}" ${u.ok ? '' : 'disabled'}>
            <span class="sid">${s.id}${s.map ? ` ${getMap(s.map).icon}` : ''}</span><b>${esc(s.title)}</b><span class="stars">${stars(st)}</span>
            <small>${s.length} 秒・目標 $${s.goal}・${esc(ks)}</small></button>`;
        }).join('')}</div>` : ''}
      </div>`;
  }).join('') + endless;
}

/** The pay slip: wage, sales bonus, the boss's cut (with his excuse), tips you keep, and any court fine. */
function payHtml(r: Reward) {
  const pay = r.pay;
  if (!pay) return '';
  const row = (k: string, v: number, cls = '') => `<div class="stat"><span>${k}</span><b class="${cls}">${v < 0 ? '−' : '+'}$${Math.abs(v)}</b></div>`;
  return `<div class="paylist">
    ${row('時薪', pay.wage)}${row('營業獎金', pay.bonus)}
    ${row(`🤑 錢董硬凹：${esc(pay.cutReason)}`, -pay.cut, 'neg')}
    ${row('💵 小費（自己的）', pay.tips, 'pos')}${pay.extra ? row('阿芬姐偷塞的退散獎金', pay.extra, 'pos') : ''}
    ${r.court ? row(`⚖ 法院罰款${r.court.fine === 0 ? '（無罪）' : ''}`, -r.court.fine, 'neg') : ''}
  </div>`;
}

function storeHtml(p: CareerProfile) {
  const hist = p.storeHistory;
  const histLine = hist.opened ? `<p class="muted">開過 ${hist.opened} 家店・收掉 ${hist.closed} 家・倒閉賠掉 $${hist.lost}${hist.lastReason ? `（上次：${esc(hist.lastReason)}）` : ''}</p>` : '';
  const st = p.store;
  if (!st) {
    const can = canOpenStore(p);
    if (!can.ok) return `<div class="chapter locked"><div class="chhead"><b>🏪 自己開店</b></div>
      <div class="muted story">🔒 ${esc(can.why ?? '')}</div>
      <p class="muted">開店基金 $${STORE_FUND}。目前存款 $${p.wallet}。開店後要付租金、進貨、員工薪水；連續 3 天打烊時現金為負或口碑見底（≤0.5）就會倒閉，投入的錢全部賠光。</p></div>${friendsHtml(p)}${histLine}`;
    return `<div class="chapter daily"><div class="chhead"><b>🏪 自己開店</b><span class="tag ok">存款 $${p.wallet}</span></div>
      <p>夢想的時刻到了。用存款開一家自己的店——這次換你當老闆。</p>
      <label class="field">店名<input id="st-name" maxlength="16" placeholder="我的便利商店"></label>
      <p class="muted">要開哪一種店？</p>
      <div class="grid2">${MAPS.map((m, i) => `<label class="shopitem"><b><input type="radio" name="st-map" value="${m.id}" ${i === 0 ? 'checked' : ''}> ${m.icon} ${esc(m.name)}${ownStoreLockHtml(p, m.id)}</b><span class="muted">${esc(m.desc)}</span></label>`).join('')}</div>
      <label class="muted"><input type="checkbox" id="st-all"> 投入全部存款（$${p.wallet}）；不勾選只投入開店基金 $${STORE_FUND}</label>
      <p class="muted">⚠ 有機會倒閉：連續 3 天打烊時現金為負或口碑見底 → 店收掉，投入的錢沒了。</p>
      <button class="btn primary" id="st-open">開店！</button></div>${friendsHtml(p)}${histLine}`;
  }
  const s = st.save, staff = st.staff;
  const mood = staff.quit ? '已辭職' : staff.mood >= 70 ? '😄 很有幹勁' : staff.mood >= 40 ? '🙂 普通' : staff.mood >= 20 ? '😒 很不爽' : '😡 快辭職了';
  const mp = getMap(st.map);
  return `<div class="chapter daily"><div class="chhead"><b>${mp.icon} ${esc(st.name)}</b><span class="muted">${esc(mp.name)}・第 ${s.day} 天</span>
      ${st.negDays ? `<span class="tag" style="background:#c92a2a">⚠ 經營危機 ${st.negDays}/3 天</span>` : ''}</div>
    <div class="grid2"><div>
      <div class="stat"><span>店裡現金</span><b>$${s.money}</b></div><div class="stat"><span>口碑</span><b>★ ${s.rating.toFixed(2)}</b></div>
      <div class="stat"><span>投入資本</span><b>$${st.invested}</b></div></div><div>
      <div class="stat"><span>最佳單日</span><b>$${st.bestDay}</b></div><div class="stat"><span>已提領</span><b>$${st.withdrawn}</b></div>
      <div class="stat"><span>員工 ${esc(staff.name)}</span><b>${staff.quit ? '已辭職' : `${mood}（${staff.mood}）`}</b></div></div></div>
    <h3>怎麼給員工薪水？</h3>
    <div class="grid2">${(Object.keys(WAGES) as WageMode[]).map(w => `<label class="shopitem"><b><input type="radio" name="st-wage" value="${w}" ${st.wage === w ? 'checked' : ''}> ${WAGES[w].label}</b><span class="muted">${esc(WAGES[w].desc)}</span></label>`).join('')}</div>
    <p class="muted">員工速度目前 ×${staffPace(staff.mood).toFixed(1)}。薪水在每天打烊結算時從店裡現金扣。</p>
    <div class="row">
      <button class="btn primary" id="st-enter">▶ 進店營業</button>
      <button class="btn" id="st-withdraw" ${s.money > STORE_RESERVE ? '' : 'disabled'}>💰 提領 $${Math.max(0, s.money - STORE_RESERVE)} 到存款</button>
      ${staff.quit ? `<button class="btn" id="st-hire" ${s.money >= 150 ? '' : 'disabled'}>📋 招募新員工（$150）</button>` : ''}
      <button class="btn small" id="st-close">收店</button>
    </div></div>${friendsHtml(p)}${histLine}`;
}

/** Friend stores (needs a game server): share your store code, lock the door, raid a friend. */
function friendsHtml(p: CareerProfile) {
  const st = p.store, on = st?.online;
  const mine = !st ? '' : !on
    ? `<p>把店上傳到遊戲伺服器，拿到 6 碼店碼，好友就能來搗亂（你也能去他們的店）。</p><button class="btn" id="st-upload">📤 取得店碼</button>`
    : `<div class="row" style="align-items:center"><span>店碼 <b class="code">${esc(on.code)}</b></span>
        <span class="tag ${on.locked ? 'ok' : ''}" style="flex:0 0 auto;${on.locked ? '' : 'background:#c92a2a'}">${on.locked ? '🔒 店門已鎖' : '🔓 店門沒鎖'}</span></div>
      <p class="muted">${on.locked ? '鎖著的店，好友只能在門外丟垃圾（損失很小）。' : '⚠ 沒鎖門：好友可以衝進店裡搗亂，打翻商品、嗆客人、亂丟垃圾。下線前記得鎖門！'}</p>
      <div class="row"><button class="btn ${on.locked ? '' : 'good'}" id="st-lock">${on.locked ? '🔓 開門營業' : '🔒 鎖店門'}</button><button class="btn" id="st-reports">📬 搗亂報告</button></div>`;
  return `<div class="chapter"><div class="chhead"><b>👥 好友的店</b><span class="muted">需要連線到遊戲伺服器（測試中）</span></div>
    ${mine}
    <p class="muted" style="margin-top:10px">輸入好友的店碼，去他的店搗亂 90 秒：打翻商品、嗆客人、亂丟垃圾，別被店員盯太久。搗亂分數會變成一點零用錢。</p>
    <div class="row"><input type="text" class="code" id="st-raid-code" maxlength="6" placeholder="店碼" autocomplete="off" autocapitalize="characters"><button class="btn" id="st-raid" style="flex:0 0 140px">😈 去搗亂</button></div>
    <div class="muted" id="st-msg"></div></div>`;
}

function dailyHtml(p: CareerProfile) {
  if (!dailyUnlocked(p)) return `<div class="chapter locked"><div class="chhead"><b>📅 每日挑戰</b></div><div class="muted story">🔒 通過第 1 章「店長來巡店」後解鎖</div></div>`;
  const today = localDate();
  const plan = dailyPlan(p, today);
  const d = p.daily.date === today ? p.daily : { best: 0, rewarded: false };
  const dm = getMap(plan.map);
  return `<div class="chapter daily"><div class="chhead"><b>📅 每日挑戰・${today}</b><span class="muted">今天在：${dm.icon} ${esc(dm.name)}</span>
      <span class="tag ${d.rewarded ? 'ok' : ''}">${d.rewarded ? '✅ 今日獎勵已領' : '🎁 今日獎勵未領'}</span>${p.daily.streak ? `<span class="tag">🔥 連續 ${p.daily.streak} 天</span>` : ''}</div>
    <div class="muted story">${plan.mods.map(m => `<b>${DAILY_MODS[m].name}</b>：${DAILY_MODS[m].desc}`).join('　')}${d.best ? `　・今日最佳 $${d.best}` : ''}</div>
    <button class="btn primary" data-play="${DAILY_ID}">開始今日挑戰</button></div>`;
}

function achievementsHtml(p: CareerProfile) {
  const have = new Set(p.achievements);
  return `${dexSwitch(p, 'achievements')}<p class="muted">已解鎖 ${have.size} / ${ACHIEVEMENTS.length}</p>
    <div class="grid2">${ACHIEVEMENTS.map(a => `<div class="shopitem ach ${have.has(a.id) ? 'got' : 'locked'}"><b>${have.has(a.id) ? '🏆' : '🔒'} ${esc(a.name)}</b><span class="muted">${esc(a.desc)}</span></div>`).join('')}</div>`;
}

function achHtml(fresh: Achievement[]) {
  return fresh.map((a, i) => `<div class="achpop" style="animation-delay:${0.6 + i * 0.35}s">🏆 解鎖成就：<b>${esc(a.name)}</b><small>${esc(a.desc)}</small></div>`).join('');
}

function skillsHtml(p: CareerProfile) {
  const abil = (Object.keys(ABILITY_LEVEL) as Ability[]).map(a => `<div class="shopitem ${p.level >= ABILITY_LEVEL[a] ? '' : 'locked'}"><b>${p.level >= ABILITY_LEVEL[a] ? '✅' : '🔒'} ${ABILITY_INFO[a].name}</b><span class="muted">${ABILITY_INFO[a].desc}・Lv.${ABILITY_LEVEL[a]}（${rankOf(ABILITY_LEVEL[a])}）解鎖</span></div>`).join('');
  return `
    <p class="muted">每升一級獲得 1 點技能點。剩餘：<b>${p.skillPoints}</b> 點</p>
    <div class="grid2">${(Object.keys(SKILLS) as SkillTree[]).map(t => `
      <div class="shopitem"><b>${SKILLS[t].icon} ${SKILLS[t].name} <span class="tag">${p.skills[t]}/${SKILL_MAX}</span></b>
        <div class="bar"><i style="width:${p.skills[t] * 10}%"></i></div>
        <span class="muted">每點：${SKILLS[t].perPoint}</span><br>
        <button class="btn small" data-skill="${t}" ${p.skillPoints > 0 && p.skills[t] < SKILL_MAX ? '' : 'disabled'}>＋ 加點</button></div>`).join('')}</div>
    <h3>職級能力</h3><div class="grid2">${abil}</div>`;
}

function gearHtml(p: CareerProfile) {
  return `<p class="muted">用上班賺的薪資點數購買，永久生效。目前 💰 ${p.wallet}</p>
    <div class="grid2">${GEAR_IDS.map(g => {
      const lv = p.gear[g], price = gearPrice(g, lv);
      return `<div class="shopitem"><b>${GEAR[g].icon} ${GEAR[g].name} <span class="tag">Lv ${lv}/${GEAR_MAX}</span></b><span class="muted">${GEAR[g].detail}</span><br>
        <button class="btn small" data-gear="${g}" ${price !== null && p.wallet >= price ? '' : 'disabled'}>${price === null ? '已滿級' : `升級 💰${price}`}</button></div>`;
    }).join('')}</div>`;
}

function statsHtml(p: CareerProfile) {
  const s = p.stats;
  const totalStars = Object.values(p.stars).reduce((a, b) => a + b, 0);
  const maxStars = CHAPTERS.reduce((n, c) => n + c.shifts.length * 3, 0);
  return `<div class="grid2"><div>
      <div class="stat"><span>上班次數</span><b>${s.shifts}</b></div><div class="stat"><span>成功下班</span><b>${s.wins}</b></div>
      <div class="stat"><span>服務顧客</span><b>${s.served}</b></div><div class="stat"><span>累計營業額</span><b>$${s.revenue}</b></div></div><div>
      <div class="stat"><span>處理奧客</span><b>${s.karens}</b></div><div class="stat"><span>請出門</span><b>${s.ejected}</b></div>
      <div class="stat"><span>主線星數</span><b>★ ${totalStars}/${maxStars}</b></div><div class="stat"><span>職級</span><b>${rankOf(p.level)} Lv.${p.level}</b></div></div></div>
    <div class="grid2"><div><div class="stat"><span>💰 存款</span><b>$${p.wallet}</b></div><div class="stat"><span>⚖ 被帶去審訊</span><b>${p.court.trials} 次</b></div></div>
      <div><div class="stat"><span>罰款總額</span><b>$${p.court.fines}</b></div><div class="stat"><span>無罪</span><b>${p.court.acquittals} 次</b></div></div></div>`;
}

export function resultScreen(r: ShiftResult, reward: Reward, p: CareerProfile, fresh: Achievement[], h: { retry(): void; next(id: string | null): void; career(): void }) {
  if (r.shiftId === ENDLESS_ID) return endlessResult(r, reward, p, fresh, h);
  if (r.shiftId === DAILY_ID) return dailyResult(r, reward, p, fresh, h);
  const f = findShift(r.shiftId)!;
  const idx = f.chapter.shifts.findIndex(s => s.id === r.shiftId);
  let nextId: string | null = f.chapter.shifts[idx + 1]?.id ?? CHAPTERS.find(c => c.n === f.chapter.n + 1)?.shifts[0]?.id ?? null;
  if (nextId && !shiftUnlocked(p, nextId).ok) nextId = null;
  const lvl = reward.levels.length ? `<div class="levelup">🎉 升級！Lv.${reward.levels[reward.levels.length - 1]}「${rankOf(reward.levels[reward.levels.length - 1])}」・技能點 +${reward.levels.length}</div>` : '';
  const newAbil = (Object.keys(ABILITY_LEVEL) as Ability[]).filter(a => reward.levels.includes(ABILITY_LEVEL[a]));
  show(`
    <div class="card wide result ${r.won ? 'won' : 'lost'}">
      <div class="muted">${f.chapter.n}-${idx + 1}・${esc(f.shift.title)}</div>
      <h1 class="title">${r.won ? '下班快樂！' : '這班辛苦了'}</h1>
      <div class="bigstars">${[1, 2, 3].map(i => `<span class="${i <= reward.stars ? 'on' : ''}" style="animation-delay:${i * 0.25}s">★</span>`).join('')}</div>
      ${r.won ? '' : `<p class="err" style="text-align:center">${esc(r.failReason)}</p>`}
      <div class="grid2">
        <div>
          <div class="stat"><span>營業額 / 目標</span><b>$${r.revenue} / $${r.goal}</b></div>
          <div class="stat"><span>口碑</span><b>★ ${r.rating.toFixed(2)}</b></div>
          <div class="stat"><span>混亂度</span><b>${r.chaos}%</b></div>
          <div class="stat"><span>服務顧客</span><b>${r.served}</b></div>
        </div>
        <div>
          <div class="stat"><span>奧客處理 成功/失敗</span><b>${r.karensResolved} / ${r.karensFailed}</b></div>
          <div class="stat"><span>請出門 / 最高連送</span><b>${r.ejected} / ${r.maxCombo}</b></div>
          <div class="stat"><span>生氣離開</span><b>${r.angryLeft}</b></div>
          <div class="stat"><span>清潔</span><b>${r.cleaned}</b></div>
        </div>
      </div>
      ${payHtml(reward)}
      <div class="reward">EXP +${reward.exp}${reward.firstClear ? '（首次通關）' : ''}　💰 存款 +${reward.wallet - (reward.court?.fine ?? 0)}</div>
      ${lvl}
      ${newAbil.map(a => `<div class="levelup">🔓 新能力：${ABILITY_INFO[a].name} — ${ABILITY_INFO[a].desc}</div>`).join('')}
      ${achHtml(fresh)}
      <p class="muted" style="text-align:center">★1 達成營業額・★2 口碑 3.5 以上且混亂低於 60%・★3 營業額達 130% 且奧客零失誤、生氣離開不超過 1 人</p>
      <div class="row">
        <button class="btn" id="r-retry">🔁 再挑戰</button>
        ${nextId ? `<button class="btn primary" id="r-next">下一班 ▶</button>` : ''}
        <button class="btn" id="r-career">回職涯</button>
      </div>
    </div>`);
  document.getElementById('r-retry')!.onclick = () => h.retry();
  document.getElementById('r-career')!.onclick = () => h.career();
  const nb = document.getElementById('r-next'); if (nb) nb.onclick = () => h.next(nextId);
}

function dailyResult(r: ShiftResult, reward: Reward, p: CareerProfile, fresh: Achievement[], h: { retry(): void; career(): void }) {
  const lvl = reward.levels.length ? `<div class="levelup">🎉 升級！Lv.${reward.levels[reward.levels.length - 1]}「${rankOf(reward.levels[reward.levels.length - 1])}」</div>` : '';
  const rewardLine = reward.daily?.already ? '今日獎勵已經領過了（成績仍會記錄）' : `EXP +${reward.exp}　💰 +${reward.wallet}`;
  show(`
    <div class="card wide result ${r.won ? 'won' : 'lost'}">
      <div class="muted">📅 每日挑戰・${esc(r.date ?? '')}</div>
      <h1 class="title">${r.won ? (reward.newBest ? '今日新紀錄！' : '挑戰成功！') : '差一點！'}</h1>
      <div class="bigstars">${[1, 2, 3].map(i => `<span class="${i <= reward.stars ? 'on' : ''}" style="animation-delay:${i * 0.25}s">★</span>`).join('')}</div>
      ${r.won ? '' : `<p class="err" style="text-align:center">${esc(r.failReason)}</p>`}
      <div class="grid2">
        <div><div class="stat"><span>營業額 / 目標</span><b>$${r.revenue} / $${r.goal}</b></div><div class="stat"><span>今日最佳</span><b>$${p.daily.best}</b></div></div>
        <div><div class="stat"><span>奧客處理 成功/失敗</span><b>${r.karensResolved} / ${r.karensFailed}</b></div><div class="stat"><span>連續完成</span><b>🔥 ${p.daily.streak} 天</b></div></div>
      </div>
      <div class="reward">${rewardLine}</div>
      ${lvl}${achHtml(fresh)}
      <div class="row"><button class="btn" id="r-retry">🔁 再挑戰（刷新紀錄）</button><button class="btn primary" id="r-career">回職涯</button></div>
    </div>`);
  document.getElementById('r-retry')!.onclick = () => h.retry();
  document.getElementById('r-career')!.onclick = () => h.career();
}

function endlessResult(r: ShiftResult, reward: Reward, p: CareerProfile, fresh: Achievement[], h: { retry(): void; career(): void }) {
  const lvl = reward.levels.length ? `<div class="levelup">🎉 升級！Lv.${reward.levels[reward.levels.length - 1]}「${rankOf(reward.levels[reward.levels.length - 1])}」</div>` : '';
  show(`
    <div class="card wide result won">
      <div class="muted">🌙 無限夜班</div>
      <h1 class="title">${reward.newBest ? '新紀錄！' : '下班了'}</h1>
      <div class="bigstars">${[1, 2, 3].map(i => `<span class="${i <= reward.stars ? 'on' : ''}" style="animation-delay:${i * 0.25}s">★</span>`).join('')}</div>
      <div class="reward" style="font-size:34px">分數 ${r.score ?? 0}</div>
      <p class="muted" style="text-align:center">${esc(r.failReason)}・最高分 ${p.endlessBest}</p>
      <div class="grid2">
        <div><div class="stat"><span>營業額</span><b>$${r.revenue}</b></div><div class="stat"><span>服務顧客</span><b>${r.served}</b></div></div>
        <div><div class="stat"><span>請出門 / 最高連送</span><b>${r.ejected} / ${r.maxCombo}</b></div><div class="stat"><span>處理奧客</span><b>${r.karensResolved}</b></div></div>
      </div>
      <div class="reward">EXP +${reward.exp}　💰 +${reward.wallet}</div>
      ${lvl}
      ${achHtml(fresh)}
      <p class="muted" style="text-align:center">★1 800 分・★2 1600 分・★3 3000 分</p>
      <div class="row"><button class="btn primary" id="r-retry">🔁 再來一夜</button><button class="btn" id="r-career">回職涯</button></div>
    </div>`);
  document.getElementById('r-retry')!.onclick = () => h.retry();
  document.getElementById('r-career')!.onclick = () => h.career();
}
