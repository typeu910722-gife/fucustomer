// Achievements are derived from the career profile, so they can be (re)checked at any time and
// reported to a store platform (Steam, Game Center, Play Games) without a separate save format.
import { CHAPTERS, ENDLESS_ID, type CareerProfile, type ShiftResult } from './career.ts';
import { dexCount } from './karendex.ts';
import { SIG_KINDS } from './sigkarens.ts';
import { arcDone } from './regulars.ts';
import { bestStreakAll, branchCount, maxStoreLevel } from './progression.ts';

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
  { id: 'ATLAS', name: '全台奧客圖鑑', desc: '通關第 10 章，見過每一種店的招牌奧客', check: p => chapterDone(p, 10) },
  { id: 'DEX_ALL', name: '圖鑑全收集', desc: `每一種店的招牌奧客（${SIG_KINDS.length} 種）都至少處理過一次`, check: p => dexCount(p.dex, true) >= SIG_KINDS.length },
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
  { id: 'DAILY_FIRST', name: '今日任務', desc: '完成一次每日挑戰', check: p => p.daily.wins >= 1 },
  { id: 'DAILY_STREAK_3', name: '全勤獎', desc: '連續 3 天完成每日挑戰', check: p => p.daily.streak >= 3 },
  // 常客奧客 story arcs (regulars.ts)
  { id: 'ARC_AUNTIE', name: '集點卡滿了', desc: '完成「集點王阿姨」的故事', check: p => arcDone(p, 'auntie') },
  { id: 'ARC_KAI', name: '轉型成功', desc: '完成「直播主阿凱」的故事', check: p => arcDone(p, 'kai') },
  { id: 'ARC_ZHANG', name: '品管合格', desc: '完成「退貨張伯」的故事', check: p => arcDone(p, 'zhang') },
  { id: 'ARC_VICKY', name: '找到插座', desc: '完成「插座姐 Vicky」的故事', check: p => arcDone(p, 'vicky') },
  // 每週挑戰 (weekly.ts)
  { id: 'WEEKLY_BADGE', name: '本週全制霸', desc: '一週內完成每週挑戰的 3 個目標，拿到週章', check: p => p.weekly.badges.length >= 1 },
  { id: 'WEEKLY_BADGE_4', name: '月月不缺席', desc: '收集 4 枚每週挑戰週章', check: p => p.weekly.badges.length >= 4 },
  // 店面等級・連鎖分店・個人紀錄 (progression.ts)
  { id: 'STORE_LV5', name: '區域名店', desc: '任何一間店（自由營業或自己開的店）升到 Lv5', check: p => maxStoreLevel(p) >= 5 },
  { id: 'STORE_LV10', name: '傳說名店', desc: '任何一間店升到 Lv10', check: p => maxStoreLevel(p) >= 10 },
  { id: 'BRANCH_1', name: '連鎖起步', desc: '開第一間分店', check: p => branchCount(p) >= 1 },
  { id: 'BRANCH_3', name: '連鎖帝國', desc: '同時擁有 3 間分店', check: p => branchCount(p) >= 3 },
  { id: 'STREAK_7', name: '一週好評', desc: '同一間店連續 7 天打烊時口碑 3★ 以上', check: p => bestStreakAll(p) >= 7 },
  { id: 'STREAK_30', name: '好評一整個月', desc: '同一間店連續 30 天打烊時口碑 3★ 以上', check: p => bestStreakAll(p) >= 30 },
];

/** Records newly earned achievements in the profile and returns them (in list order). */
export function updateAchievements(p: CareerProfile, r?: ShiftResult): Achievement[] {
  const have = new Set(p.achievements);
  const fresh = ACHIEVEMENTS.filter(a => !have.has(a.id) && a.check(p, r));
  for (const a of fresh) p.achievements.push(a.id);
  return fresh;
}

export function unlockedAchievements(p: CareerProfile, r?: ShiftResult): string[] {
  return ACHIEVEMENTS.filter(a => a.check(p, r)).map(a => a.id);
}
