// 審訊: what happens after the police take you in. Pure logic (random source injected) so it can be tested.
// All judges are fictional; the tone is comedy/satire.
import type { CareerProfile, Incident } from './career.ts';

export type JudgeKind = 'fair' | 'dino' | 'sleepy';
export const JUDGES: Record<JudgeKind, { name: string; icon: string; intro: string }> = {
  fair: { name: '周法官', icon: '👩‍⚖️', intro: '明理法官。看證據、聽說明，誠實配合可以爭取最低罰款。' },
  dino: { name: '龍法官', icon: '🦖', intro: '人稱「恐龍法官」。判決常常讓人看不懂……但你還有別的路。' },
  sleepy: { name: '吳法官', icon: '😴', intro: '開庭五分鐘就睡著的法官。判決全看運氣。' },
};

/** Police come when anyone was hit without cause, or the person hit had connections. */
export function needsCourt(incidents: Incident[] | undefined) { return !!incidents?.some(i => !i.legal || i.vip); }
/** Every incident in the case was self-defence (only "connections" made it a case). */
export function allJustified(incidents: Incident[]) { return incidents.every(i => i.legal); }

/** Fine before the judge has a say. Self-defence counts for nothing; hitting an ordinary customer is worst. */
export function baseFine(incidents: Incident[], chapter: number) {
  let f = 0;
  for (const i of incidents) {
    if (i.legal) continue;
    f += i.normal ? 250 : 100;
    if (i.vip) f += 100;
  }
  return Math.round(f * (1 + 0.15 * (chapter - 1)));
}
export const minFine = (base: number) => Math.round(base * 0.4);

export function pickJudge(rng: () => number): JudgeKind {
  const r = rng();
  return r < 0.5 ? 'fair' : r < 0.8 ? 'dino' : 'sleepy';
}

export interface Answer { text: string; mod: number; note: string }
export interface Question { q: string; answers: Answer[] }
/** The fair judge's three questions. `mod` moves the fine (−0.15 = 15% lower). */
export function questions(incidents: Incident[]): Question[] {
  const someJustified = incidents.some(i => i.legal);
  return [
    { q: '被告，你當時為什麼動手？', answers: [
      { text: '我承認，是我太衝動了。', mod: -0.15, note: '法官點點頭：「肯面對就好。」' },
      { text: '是他先失控的！', mod: someJustified ? -0.1 : 0.15, note: someJustified ? '法官：「監視器確實拍到對方失控。」' : '法官皺眉：「監視器可不是這樣拍的。」' },
      { text: '我什麼都不記得了。', mod: 0.1, note: '法官：「那我幫你記得。」' },
    ] },
    { q: '你有什麼話想對被害人說？', answers: [
      { text: '對不起，我願意道歉。', mod: -0.15, note: '被害人勉強接受了道歉。' },
      { text: '他活該。', mod: 0.25, note: '旁聽席一片譁然。' },
      { text: '……（沉默）', mod: 0, note: '法庭安靜了三秒。' },
    ] },
    { q: '你願意去上情緒管理課程嗎？', answers: [
      { text: '願意。', mod: -0.1, note: '法官：「很好，下次換個方式處理。」' },
      { text: '不行，我要上班賺錢。', mod: 0.05, note: '法官嘆氣：「打工人真辛苦……但規定就是規定。」' },
    ] },
  ];
}

export interface Verdict { fine: number; text: string }

export function fairVerdict(incidents: Incident[], chapter: number, mods: number[]): Verdict {
  const base = baseFine(incidents, chapter);
  if (base === 0) return { fine: 0, text: '經查屬正當防衛，對方有沒有背景都一樣。本庭判決：無罪。' };
  const m = mods.reduce((a, b) => a + b, 0);
  const fine = Math.max(minFine(base), Math.round(base * (1 + m * 1.5))); // fully honest answers reach the minimum
  return { fine, text: fine === minFine(base) ? `念在你誠實配合，本庭從輕量刑：罰款 $${fine}。` : `本庭判決：罰款 $${fine}。` };
}

const DINO_REASONS = ['你的表情不夠悔改', '便利商店的燈太亮影響本庭判斷', '奧客的叔叔是我高中同學的鄰居', '你穿制服出庭不尊重法庭', '本庭今天心情不好', '你的名字筆畫太多'];
export function dinoVerdict(incidents: Incident[], chapter: number, rng: () => number): Verdict {
  const base = Math.max(baseFine(incidents, chapter), Math.round(120 * (1 + 0.15 * (chapter - 1))));
  const fine = Math.round(base * (1.3 + 0.7 * rng()));
  return { fine, text: `因為「${DINO_REASONS[Math.floor(rng() * DINO_REASONS.length)]}」，本庭判決：罰款 $${fine}！` };
}

export function sleepyVerdict(incidents: Incident[], chapter: number, rng: () => number): Verdict {
  const base = baseFine(incidents, chapter);
  if (base === 0) return { fine: 0, text: '（法官醒來）嗯……正當防衛……無罪……zzz' };
  const fine = Math.round(base * (0.3 + rng() * 1.4));
  return { fine, text: `（法官揉揉眼睛）呃……罰款 $${fine}……退庭。zzz` };
}

export type Protest = 'accept' | 'stream' | 'appeal' | 'cctv' | 'faint';
export const PROTESTS: Record<Protest, { label: string; desc: string }> = {
  accept: { label: '😔 認罰', desc: '乖乖繳罰款' },
  stream: { label: '📱 當庭開直播', desc: '輿論壓力：55% 改判最低罰款，45% 被認定藐視法庭（+50%）' },
  appeal: { label: '📄 提出上訴', desc: '付律師費 $80，換一位法官重審（只能一次）' },
  cctv: { label: '📹 調出監視器畫面', desc: '如果每一筆事件其實都佔理，直接無罪；否則反而對你不利（+10%）' },
  faint: { label: '😵 當庭裝暈', desc: '30% 延期審理（罰款減半），70% 被識破（+20%）' },
};
export const APPEAL_COST = 80;

export interface ProtestOutcome { fine: number; text: string; appeal?: boolean }
export function protest(kind: Protest, v: Verdict, incidents: Incident[], chapter: number, rng: () => number): ProtestOutcome {
  const base = baseFine(incidents, chapter);
  switch (kind) {
    case 'accept': return { fine: v.fine, text: '你默默繳了罰款。' };
    case 'stream':
      if (rng() < 0.55) return { fine: minFine(base), text: `直播瞬間破萬人觀看，記者小林也趕來了。迫於輿論，法院改判罰款 $${minFine(base)}。` };
      return { fine: Math.round(v.fine * 1.5), text: `法警沒收了你的手機：「藐視法庭！」罰款加重到 $${Math.round(v.fine * 1.5)}。` };
    case 'appeal': return { fine: v.fine, text: `你請了律師（$${APPEAL_COST}），案子發回重審……`, appeal: true };
    case 'cctv':
      if (allJustified(incidents)) return { fine: 0, text: '監視器清楚拍到對方先失控。全場安靜。判決撤銷：無罪！' };
      return { fine: Math.round(v.fine * 1.1), text: `監視器……拍到你先動手。罰款變成 $${Math.round(v.fine * 1.1)}。` };
    case 'faint':
      if (rng() < 0.3) return { fine: Math.round(v.fine * 0.5), text: `你應聲倒地，救護車都來了。案子延期，最後只罰 $${Math.round(v.fine * 0.5)}。` };
      return { fine: Math.round(v.fine * 1.2), text: `法官：「你剛剛偷看了一眼。」罰款加到 $${Math.round(v.fine * 1.2)}。` };
  }
}

/** Pays the fine from savings (never below zero) and records the trial. Returns what was actually paid. */
export function payFine(p: CareerProfile, fine: number, extraCost = 0): number {
  const total = Math.max(0, Math.round(fine + extraCost));
  const paid = Math.min(p.wallet, total);
  p.wallet -= paid;
  p.court.trials++; p.court.fines += paid; if (fine === 0) p.court.acquittals++;
  return paid;
}
