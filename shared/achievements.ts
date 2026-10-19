// Achievements are derived from the career profile, so they can be (re)checked at any time and
// reported to a store platform (Steam, Game Center, Play Games) without a separate save format.
import { CHAPTERS, ENDLESS_ID, type CareerProfile, type ShiftResult } from './career.ts';

export interface Achievement { id: string; name: string; desc: string; check: (p: CareerProfile, r?: ShiftResult) => boolean }

const cleared = (p: CareerProfile, id: string) => (p.clears[id] ?? 0) > 0;
const chapterDone = (p: CareerProfile, ch: number) => CHAPTERS[ch - 1]?.shifts.every(s => cleared(p, s.id)) ?? false;
const totalStars = (p: CareerProfile) => Object.values(p.stars).reduce((a, b) => a + b, 0);

/** IDs are stable API names (use the same ones in the Steamworks partner site). */
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'FIRST_SHIFT', name: '第一天上班', desc: '完成第一個班次', check: p => p.stats.wins >= 1 },
  { id: 'FIRST_THROW', name: '請你出去', desc: '第一次把奧客丟出門', check: p => p.stats.ejected >= 1 },
  { id: 'CH1', name: '試用期結束', desc: '通關第 1 章', check: p => chapterDone(p, 1) },
  { id: 'CH2', name: '正職到手', desc: '通關第 2 章', check: p => chapterDone(p, 2) },
  { id: 'CH3', name: '大夜班生存者', desc: '通關第 3 章', check: p => chapterDone(p, 3) },
  { id: 'CH4', name: '店長候補', desc: '通關第 4 章', check: p => chapterDone(p, 4) },
  { id: 'CH5', name: '區域督導', desc: '通關第 5 章', check: p => chapterDone(p, 5) },
  { id: 'BOSS', name: '奧客剋星', desc: '擊敗奧客之王', check: p => cleared(p, '6-3') },
  { id: 'LV10', name: '熟練店員', desc: '職級達到 Lv10', check: p => p.level >= 10 },
  { id: 'LV20', name: '資深店員', desc: '職級達到 Lv20', check: p => p.level >= 20 },
  { id: 'LV30', name: '終極打工人', desc: '職級達到 Lv30', check: p => p.level >= 30 },
  { id: 'KARENS_100', name: '退散百人斬', desc: '累計處理 100 位奧客', check: p => p.stats.karens >= 100 },
  { id: 'SERVED_1000', name: '千人服務', desc: '累計服務 1000 位客人', check: p => p.stats.served >= 1000 },
  { id: 'STARS_60', name: '星星收藏家', desc: '累計取得 60 顆星', check: p => totalStars(p) >= 60 },
  { id: 'PERFECT', name: '完美班次', desc: '任一班次拿到 3 星', check: p => Object.values(p.stars).some(s => s >= 3) },
  { id: 'COMBO_5', name: '連送五人', desc: '一個班次內連續送走 5 位奧客', check: (_p, r) => (r?.maxCombo ?? 0) >= 5 },
  { id: 'ENDLESS_1600', name: '夜班傳說', desc: '無限夜班拿到 1600 分', check: p => p.endlessBest >= 1600 },
  { id: 'ENDLESS_PLAYED', name: '還沒下班', desc: '挑戰一次無限夜班', check: (p, r) => p.endlessBest > 0 || r?.shiftId === ENDLESS_ID },
];

export function unlockedAchievements(p: CareerProfile, r?: ShiftResult): string[] {
  return ACHIEVEMENTS.filter(a => a.check(p, r)).map(a => a.id);
}
