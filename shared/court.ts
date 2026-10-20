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

// ---------------- 監視器 evidence ----------------
// A store with the 監視器 upgrade (own store saves) records every hit; the level goes with each incident (sim.ts
// camTag). Level 0 = only the store's old potato-quality camera: the classic behaviour. The camera is honest both
// ways: footage of self-defence gets you off, footage of you hitting first makes it worse.
/** Camera level that recorded this case (0–2). */
export function cameraLevel(incidents: Incident[]) { return incidents.reduce((m, i) => Math.max(m, Math.min(2, Math.max(0, Math.round(i.cam ?? 0)))), 0); }
/** provoked = every hit was self-defence (only "connections" made it a case); unprovoked = none was; mixed = some. */
export type CaseKind = 'provoked' | 'unprovoked' | 'mixed';
export function caseKind(incidents: Incident[]): CaseKind {
  const n = incidents.filter(i => i.legal).length;
  return n === incidents.length ? 'provoked' : n === 0 ? 'unprovoked' : 'mixed';
}
/** Unprovoked hits caught on camera: the fine for that hit is this much higher (Lv0, Lv1, Lv2). */
export const CAMERA_HONESTY = [1, 1.15, 1.3];
/** Chance the police drop a self-defence case after watching the footage (Lv0, Lv1, Lv2). */
export const CAMERA_DISMISS = [0, 0.6, 0.8];
/** 恐龍法官 vs 全程錄影 (Lv2 「當庭播放錄影」): chance it works for a self-defence case / a mixed case. */
export const FOOTAGE_WIN = { provoked: 0.9, mixed: 0.75 };

export interface PoliceReview { dismissed: boolean; text: string }
/** At the police station, with a camera: the officers watch the footage first. null = no camera upgrade. */
export function policeReview(incidents: Incident[], rng: () => number): PoliceReview | null {
  const cam = cameraLevel(incidents);
  if (!cam) return null;
  const k = caseKind(incidents);
  if (k === 'provoked') {
    if (rng() < CAMERA_DISMISS[cam]) return { dismissed: true, text: cam >= 2 ? '警察看完全程錄影（還有收音）：「對方先失控，你才出手。有背景也沒用，這叫正當防衛。」不起訴，回去上班吧！' : '警察看完監視器畫面：「對方先動手的嘛。」把筆錄撕掉了。不起訴！' };
    return { dismissed: false, text: '警察看完畫面直點頭……但對方的叔叔連打了三通電話，還是得走一趟法院。（監視器畫面已列為證據）' };
  }
  if (k === 'mixed') return { dismissed: false, text: '監視器拍到有幾次確實是對方先失控，但另外幾次……就不太好說了。畫面已列為證據。' };
  return { dismissed: false, text: cam >= 2 ? `警察調出全程錄影：連你出手前小聲說「等這天很久了」都有收音。誠實的監視器讓罰款基準 +${Math.round((CAMERA_HONESTY[cam] - 1) * 100)}%。` : `警察調出監視器：4K 高畫質，連你出手前捲袖子都拍得一清二楚。誠實的監視器讓罰款基準 +${Math.round((CAMERA_HONESTY[cam] - 1) * 100)}%。` };
}

/** Fine before the judge has a say. Self-defence counts for nothing; hitting an ordinary customer is worst; an
 *  unprovoked hit caught on the store's 監視器 costs more (the footage doesn't lie). */
export function baseFine(incidents: Incident[], chapter: number) {
  let f = 0;
  for (const i of incidents) {
    if (i.legal) continue;
    f += ((i.normal ? 250 : 100) + (i.vip ? 100 : 0)) * CAMERA_HONESTY[cameraLevel([i])];
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
  const cam = cameraLevel(incidents) > 0;
  const blame: Answer = cam
    ? { text: '是他先失控的！', mod: someJustified ? -0.2 : 0.3, note: someJustified ? '法官看了店裡的監視器：「畫面很清楚，確實是對方先失控。」' : '法官把螢幕轉向你：「這台監視器是 4K 的喔。」' }
    : { text: '是他先失控的！', mod: someJustified ? -0.1 : 0.15, note: someJustified ? '法官：「監視器確實拍到對方失控。」' : '法官皺眉：「監視器可不是這樣拍的。」' };
  return [
    { q: '被告，你當時為什麼動手？', answers: [
      { text: '我承認，是我太衝動了。', mod: -0.15, note: '法官點點頭：「肯面對就好。」' },
      blame,
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

export type Protest = 'accept' | 'stream' | 'appeal' | 'cctv' | 'footage' | 'faint';
export const PROTESTS: Record<Protest, { label: string; desc: string }> = {
  accept: { label: '😔 認罰', desc: '乖乖繳罰款' },
  stream: { label: '📱 當庭開直播', desc: '輿論壓力：55% 改判最低罰款，45% 被認定藐視法庭（+50%）' },
  appeal: { label: '📄 提出上訴', desc: '付律師費 $80，換一位法官重審（只能一次）' },
  cctv: { label: '📹 調出監視器畫面', desc: '如果每一筆事件其實都佔理，直接無罪；否則反而對你不利（+10%）' },
  footage: { label: '🎬 當庭播放全程錄影', desc: '監視器 Lv2：佔理的話龍法官多半只能認輸；不佔理……錄影可是很誠實的' },
  faint: { label: '😵 當庭裝暈', desc: '30% 延期審理（罰款減半），70% 被識破（+20%）' },
};
/** What the player can do against the 恐龍法官. With 監視器 Lv2 the full recording replaces the old camera's stills. */
export function protestOptions(incidents: Incident[], appealed: boolean): Protest[] {
  const lv2 = cameraLevel(incidents) >= 2;
  return (Object.keys(PROTESTS) as Protest[]).filter(k => (k !== 'appeal' || !appealed) && (lv2 ? k !== 'cctv' : k !== 'footage'));
}
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
    case 'footage': {
      const k = caseKind(incidents);
      if (k === 'provoked') {
        if (rng() < FOOTAGE_WIN.provoked) return { fine: 0, text: '法警把電視推進法庭，全程錄影從頭播到尾：對方先失控，你才出手。旁聽席起立鼓掌，連龍法官都看到擦眼淚。判決撤銷：無罪！' };
        return { fine: v.fine, text: `龍法官：「這影片是直的，本庭只看橫的。」不予採納，維持罰款 $${v.fine}。` };
      }
      if (k === 'mixed') {
        if (rng() < FOOTAGE_WIN.mixed) return { fine: minFine(base), text: `錄影證明好幾次都是對方先動手。龍法官看得目瞪口呆，只好改判最低罰款 $${minFine(base)}。` };
        return { fine: Math.round(v.fine * 1.1), text: `錄影播到一半，剛好是你先出手的那一段。龍法官：「停！就這段。」罰款變成 $${Math.round(v.fine * 1.1)}。` };
      }
      const f = Math.round(v.fine * 1.5);
      return { fine: f, text: `全程錄影，還有收音：全場聽到你出手前大喊「我忍你很久了！」龍法官：「謝謝被告主動提供證據。」罰款加重到 $${f}。` };
    }
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
