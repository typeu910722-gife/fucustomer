// 店面等級・連鎖分店・我的紀錄: small HTML pieces used by the free-play picker, the nightly summary and the career screens.
import {
  BRANCH_COST, BRANCH_LEVEL_REQ, BRANCH_MAX, BRANCH_SHIFTS_PER_DAY, LEVEL_UNLOCKS, STORE_MAX_LEVEL, STREAK_RATING, branchIncome, canOpenBranch,
  allStoreProgs, levelInfo, levelOf, nextUnlock, type BranchPay, type DayReport, type StoreProg,
} from '../../shared/progression.ts';
import type { CareerProfile } from '../../shared/career.ts';
import { MAPS, getMap } from '../../shared/maps/index.ts';
import { PRODUCT_INFO } from '../../shared/constants.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Level badge + XP bar (`own`: shows the branch unlock too). */
export function levelBarHtml(prog: StoreProg | null | undefined, own = false, compact = false) {
  const li = levelInfo(prog?.xp ?? 0);
  const next = nextUnlock(li.level, own);
  return `<div class="slevel ${compact ? 'compact' : ''}" data-slevel="${li.level}">
    <div class="slevel-head"><span class="slevel-badge">Lv${li.level}</span><b>${esc(li.title)}</b>
      <span class="muted">${li.level >= STORE_MAX_LEVEL ? '已達最高等級' : `${li.into}/${li.need} XP`}</span></div>
    <div class="bar"><i style="width:${li.pct}%;background:var(--warn)"></i></div>
    ${!compact && next ? `<span class="muted slevel-next">Lv${next.level} 解鎖：${next.icon} ${esc(next.name)}</span>` : ''}
  </div>`;
}

const RECORD_NAME = { revenue: '單日營收', karens: '單日處理奧客', streak: '連續好評' } as const;

/** Between-days panel: today's XP, level-ups and unlocks, new records, tonight's event, branch income. */
export function summaryProgHtml(prog: StoreProg, r: DayReport | null, own: boolean, pays: BranchPay[] = []) {
  if (!r) return `<h3>🏪 店面等級</h3>${levelBarHtml(prog, own)}`;
  const ups = r.levels.length ? `<div class="levelup slevel-up">🎉 店面升級！Lv${r.level}「${esc(levelInfo(prog.xp).title)}」</div>` : '';
  const unl = r.unlocked.map(u => `<div class="slevel-unlock">🔓 ${u.icon} <b>${esc(u.name)}</b><span class="muted">${esc(u.desc)}</span></div>`).join('');
  const recs = r.records.map(k => `<span class="tag ok">🏅 新紀錄：${RECORD_NAME[k]}</span>`).join(' ');
  const ev = r.event ? `<div class="slevel-event">${r.event.icon} <b>${esc(r.event.name)}</b>　${esc(r.event.text)}<span class="muted">（${[r.event.money ? `+$${r.event.money}` : '', r.event.rating ? `口碑 +${r.event.rating}` : ''].filter(Boolean).join('、')}）</span></div>` : '';
  const sup = r.supplier ? `<div class="muted">📦 廠商熟客：多送一箱${esc(PRODUCT_INFO[r.supplier].name)}（倉庫 +6）</div>` : '';
  const br = pays.length ? `<div class="muted">🏬 分店入帳 +$${pays.reduce((n, x) => n + x.amount, 0)}（存款）：${pays.map(x => `${esc(x.name)}「${esc(x.line)}」—店長${esc(x.manager)}`).join('　')}</div>` : '';
  return `<h3>🏪 店面等級 <span class="tag">+${r.xp} XP</span>${r.streak >= 2 ? ` <span class="tag">🔥 連續好評 ${r.streak} 天</span>` : ''}</h3>
    ${ups}${levelBarHtml(prog, own)}${unl}${recs ? `<div>${recs}</div>` : ''}${ev}${sup}${br}`;
}

/** 我的紀錄: every store you have run, with its level and personal bests. */
export function recordsHtml(p: CareerProfile) {
  const rows = allStoreProgs(p);
  const kind = { free: '自由營業', own: '我的店', branch: '分店' } as const;
  const body = rows.length ? rows.map(r => {
    const m = getMap(r.map);
    return `<div class="shopitem recrow"><b>${m.icon} ${esc(r.name)} <span class="tag">${kind[r.kind]}</span></b>
      ${levelBarHtml(r.prog, r.kind === 'own', true)}
      <div class="recgrid"><span>💰 最佳單日營收<b>$${r.prog.bestRevenue}</b></span><span>😤 單日最多奧客<b>${r.prog.bestKarens}</b></span>
        <span>🔥 最長連續好評<b>${r.prog.bestStreak} 天</b></span><span>📅 營業天數<b>${r.prog.days}</b></span></div></div>`;
  }).join('') : '<p class="muted">還沒有紀錄。去自由營業或自己的店做完一天，就會開始記錄。</p>';
  return `<div class="chapter" id="my-records"><div class="chhead"><b>🏆 我的紀錄</b><span class="muted">各店最佳成績（連續好評＝打烊時口碑 ${STREAK_RATING}★ 以上的連續天數）</span></div>
    <div class="grid2">${body}</div></div>`;
}

/** Own-store tab: the store level, every unlock, and the 連鎖分店 section. */
export function chainHtml(p: CareerProfile, locked: (map: string) => boolean) {
  const st = p.store; if (!st) return '';
  const lv = levelOf(st.prog?.xp ?? 0);
  const branches = st.branches ?? [];
  const n = branches.length;
  const list = branches.map((b, i) => {
    const m = getMap(b.map), blv = levelOf(b.prog.xp);
    return `<div class="shopitem branch"><b>${m.icon} ${esc(b.name)} <span class="tag">店長${esc(b.manager)}</span></b>
      ${levelBarHtml(b.prog, false, true)}
      <span class="muted">每次你在別處上完一班 +$${branchIncome(blv)}（每天最多 ${BRANCH_SHIFTS_PER_DAY} 次）・累計 $${b.earned}・分店現金 $${b.save.money}</span>
      ${b.log.length ? `<div class="branchlog">${b.log.slice(0, 3).map(l => `<div>📬 ${esc(l)}</div>`).join('')}</div>` : ''}
      <button class="btn small" data-branch-play="${i}">▶ 去分店巡店</button></div>`;
  }).join('');
  let open = '';
  if (n >= BRANCH_MAX) open = `<p class="muted">已經開滿 ${BRANCH_MAX} 間分店。連鎖帝國完成！</p>`;
  else if (lv < BRANCH_LEVEL_REQ[n]) open = `<p class="muted">🔒 第 ${n + 1} 間分店：總店升到 Lv${BRANCH_LEVEL_REQ[n]} 後開放（目前 Lv${lv}），開店費 $${BRANCH_COST[n]}（從存款付）。</p>`;
  else {
    const choices = MAPS.filter(m => m.id !== st.map && !branches.some(b => b.map === m.id));
    open = `<p>開第 ${n + 1} 間分店：開店費 <b>$${BRANCH_COST[n]}</b>（從存款付，存款 $${p.wallet}）。分店由店長顧，不用付薪水也不會倒閉；你在別處上班時，分店每班會匯一點錢回來。</p>
      <label class="field">分店名<input id="br-name" maxlength="16" placeholder="${esc(st.name.slice(0, 8))} 分店"></label>
      <div class="grid2">${choices.map((m, i) => `<label class="shopitem"><b><input type="radio" name="br-map" value="${m.id}" ${i === 0 ? 'checked' : ''} ${locked(m.id) ? 'disabled' : ''}> ${m.icon} ${esc(m.name)}${locked(m.id) ? ' 🔒' : ''}</b></label>`).join('')}</div>
      <button class="btn primary" id="br-open" ${canOpenBranch(st, p.wallet, choices.find(m => !locked(m.id))?.id ?? '', false).ok ? '' : 'disabled'}>🏬 開分店（$${BRANCH_COST[n]}）</button>`;
  }
  const unlocks = LEVEL_UNLOCKS.map(u => `<span class="tag ${lv >= u.level ? 'ok' : ''}" title="${esc(u.desc)}">Lv${u.level} ${u.icon} ${esc(u.name)}</span>`).join(' ');
  return `<div class="chapter" id="chain"><div class="chhead"><b>🏪 店面等級</b></div>${levelBarHtml(st.prog, true)}
      <div class="unlocklist">${unlocks}</div></div>
    <div class="chapter" id="branches"><div class="chhead"><b>🏬 連鎖分店 ${n}/${BRANCH_MAX}</b></div>${list ? `<div class="grid2">${list}</div>` : ''}${open}<div class="muted" id="br-msg"></div></div>`;
}
