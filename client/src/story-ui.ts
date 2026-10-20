// Dialogue scenes and the courtroom (審訊) screens.
import { CAST, SCENES } from '../../shared/story.ts';
import type { Incident } from '../../shared/career.ts';
import {
  APPEAL_COST, JUDGES, JudgeKind, PROTESTS, Protest, Verdict, allJustified, baseFine, dinoVerdict, fairVerdict, pickJudge,
  protest, questions, sleepyVerdict,
} from '../../shared/court.ts';
import { esc, show } from './ui.ts';
import { audio } from './audio.ts';

/** Plays a dialogue scene line by line (click / Enter / Space to continue, or skip). */
export function playScene(id: string, done: () => void) {
  const sc = SCENES[id];
  if (!sc) { done(); return; }
  playLines(sc.title, sc.lines.map(l => ({ ...CAST[l.who], text: l.text, me: l.who === 'me' })), done);
}

export interface DialogLine { icon: string; name: string; text: string; me?: boolean }
/** Dialogue cards from any cast (story scenes, 常客奧客 arcs). `cls` tags the card (e.g. 'arc'). */
export function playLines(title: string, lines: DialogLine[], done: () => void, cls = '') {
  if (!lines.length) { done(); return; }
  let i = 0;
  const onKey = (e: KeyboardEvent) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); next(); } else if (e.code === 'Escape') finish(); };
  const finish = () => { window.removeEventListener('keydown', onKey); done(); };
  const next = () => { i++; if (i >= lines.length) finish(); else render(); };
  const render = () => {
    const l = lines[i];
    show(`
      <div class="card wide scene ${cls}">
        <div class="muted">${esc(title)}</div>
        <div class="dialog ${l.me ? 'me' : ''}">
          <div class="portrait">${esc(l.icon)}</div>
          <div class="bubble"><b>${esc(l.name)}</b><p>${esc(l.text)}</p></div>
        </div>
        <div class="row"><button class="btn small" id="sc-skip">跳過</button><button class="btn primary" id="sc-next">${i + 1 < lines.length ? '繼續 ▶' : '好'}</button></div>
        <div class="muted" style="text-align:center">${i + 1} / ${lines.length}</div>
      </div>`);
    document.getElementById('sc-next')!.onclick = next;
    document.getElementById('sc-skip')!.onclick = finish;
  };
  window.addEventListener('keydown', onKey);
  render();
}

export interface CourtResult { fine: number; extraCost: number; judge: JudgeKind; text: string }

/** Police → case → judge → (questions | absurd verdict + protest | sleepy verdict) → final fine. */
export function courtScreen(incidents: Incident[], chapter: number, done: (r: CourtResult) => void, rng: () => number = Math.random) {
  let extraCost = 0, appealed = false, coughed = false;
  const facts = incidents.map(i => `<li class="${i.legal ? 'ok' : 'bad'}">${i.legal ? '✅ 佔理' : '❌ 不佔理'}・${esc(i.who)}：${esc(i.why)}${i.vip ? '（💼 有背景）' : ''}</li>`).join('');
  const header = (j: JudgeKind | null) => `<div class="court-head"><span class="judge">${j ? JUDGES[j].icon : '👮'}</span><div><b>${j ? `審訊・${JUDGES[j].name}` : '警察局'}</b><div class="muted">${j ? esc(JUDGES[j].intro) : '有人報案說你在店裡動手打人'}</div></div></div>`;
  const finish = (fine: number, text: string, judge: JudgeKind) => {
    audio.play(fine === 0 ? 'win' : 'lose');
    show(`<div class="card wide court">${header(judge)}
      <div class="verdict ${fine === 0 ? 'free' : ''}">${esc(text)}</div>
      <div class="reward">${fine === 0 ? '無罪！不用繳罰款' : `罰款 $${fine}${extraCost ? `＋律師費 $${extraCost}` : ''}（從存款扣）`}</div>
      <button class="btn primary" id="ct-done">離開法院</button></div>`);
    document.getElementById('ct-done')!.onclick = () => done({ fine, extraCost, judge, text });
  };
  const verdictScreen = (judge: JudgeKind, v: Verdict) => {
    if (judge === 'fair') return finish(v.fine, v.text, judge);
    if (judge === 'sleepy') {
      show(`<div class="card wide court">${header(judge)}<div class="verdict">${esc(v.text)}</div>
        <div class="row"><button class="btn" id="ct-accept">😔 接受</button>${coughed ? '' : '<button class="btn primary" id="ct-cough">😤 大聲咳嗽叫醒他，重新宣判</button>'}</div></div>`);
      document.getElementById('ct-accept')!.onclick = () => finish(v.fine, v.text, judge);
      const c = document.getElementById('ct-cough'); if (c) c.onclick = () => { coughed = true; verdictScreen(judge, sleepyVerdict(incidents, chapter, rng)); };
      return;
    }
    // 恐龍法官: the verdict is absurd, so the player gets to fight back
    const opts = (Object.keys(PROTESTS) as Protest[]).filter(k => k !== 'appeal' || !appealed);
    show(`<div class="card wide court">${header(judge)}<div class="verdict bad">🦖 ${esc(v.text)}</div>
      <p class="muted">你要怎麼做？</p>
      <div class="grid2">${opts.map(k => `<button class="btn protest" data-p="${k}"><b>${PROTESTS[k].label}</b><small>${esc(PROTESTS[k].desc)}</small></button>`).join('')}</div></div>`);
    document.querySelectorAll<HTMLButtonElement>('[data-p]').forEach(b => {
      b.onclick = () => {
        const out = protest(b.dataset.p as Protest, v, incidents, chapter, rng);
        if (out.appeal) { appealed = true; extraCost += APPEAL_COST; return trial(rng() < 0.6 ? 'fair' : 'sleepy', out.text); }
        finish(out.fine, out.text, judge);
      };
    });
  };
  const trial = (judge: JudgeKind, preface = '') => {
    if (judge === 'fair') {
      const qs = questions(incidents); const mods: number[] = [];
      const ask = (k: number, note = preface) => {
        if (k >= qs.length) return verdictScreen(judge, fairVerdict(incidents, chapter, mods));
        show(`<div class="card wide court">${header(judge)}${note ? `<div class="muted note">${esc(note)}</div>` : ''}
          <div class="question">「${esc(qs[k].q)}」</div>
          <div class="answers">${qs[k].answers.map((a, i) => `<button class="btn" data-a="${i}">${esc(a.text)}</button>`).join('')}</div></div>`);
        document.querySelectorAll<HTMLButtonElement>('[data-a]').forEach(b => {
          b.onclick = () => { const a = qs[k].answers[Number(b.dataset.a)]; mods.push(a.mod); ask(k + 1, a.note); };
        });
      };
      return ask(0);
    }
    const v = judge === 'dino' ? dinoVerdict(incidents, chapter, rng) : sleepyVerdict(incidents, chapter, rng);
    if (preface) {
      show(`<div class="card wide court">${header(judge)}<div class="muted note">${esc(preface)}</div><button class="btn primary" id="ct-go">開庭</button></div>`);
      document.getElementById('ct-go')!.onclick = () => verdictScreen(judge, v);
    } else verdictScreen(judge, v);
  };
  // 1) police + case facts
  const base = baseFine(incidents, chapter);
  show(`<div class="card wide court">${header(null)}
    <p>案情：</p><ul class="facts">${facts}</ul>
    <p class="muted">${allJustified(incidents) ? '每一筆都是正當防衛，只是對方有背景……你是佔理的一方。' : `依規定可能罰款約 $${base}。`}</p>
    <button class="btn primary" id="ct-next">前往法院 ▶</button></div>`);
  document.getElementById('ct-next')!.onclick = () => {
    const j = pickJudge(rng);
    show(`<div class="card wide court">${header(j)}<p>今天的法官是……<b>${JUDGES[j].icon} ${JUDGES[j].name}</b></p><button class="btn primary" id="ct-go">開庭</button></div>`);
    document.getElementById('ct-go')!.onclick = () => trial(j);
  };
}
