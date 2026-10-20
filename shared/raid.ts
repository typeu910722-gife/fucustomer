// Raiding a friend's store: a 90-second round in a copy of their store where you are the troublemaker.
import type { ShiftConfig } from './career.ts';
import { dayConfig } from './sim.ts';

export interface FriendStoreView { code: string; name: string; map: string; rating: number; locked: boolean; shelves: Record<string, number> }

export const RAID_SECONDS = 90;
/** Score for throwing trash at a locked door (all you can do when it's locked). */
export const OUTSIDE_SCORE = 20;

export function buildRaidConfig(v: FriendStoreView): ShiftConfig {
  const base = dayConfig();
  const sh = (k: string, d: number) => Math.max(0, Math.min(20, Math.round(v.shelves[k] ?? d)));
  return {
    ...base, mode: 'shift', id: 'raid', title: `😈 搗亂：${v.name}`, chapter: 1, length: RAID_SECONDS, goal: 0,
    karens: [], spawnEvery: 4.5, maxCustomers: 10, abilities: [], map: v.map, events: [],
    start: { money: 0, rating: Math.max(0.5, Math.min(5, v.rating)), backstock: { drinks: 30, snacks: 30, bento: 24 }, shelves: { drinks: sh('drinks', 8), snacks: sh('snacks', 8), bento: sh('bento', 6) } },
    hints: ['你是來搗亂的：E 打翻商品或嗆客人、G 亂丟垃圾。別讓店員在你旁邊待太久，不然會被請出去。'],
    raid: { store: v.code },
  };
}

/** What the raider earns from the round (a little pocket money, so raiding a friend is worth it). */
export const raidReward = (score: number) => Math.min(80, Math.round(score * 0.1));
