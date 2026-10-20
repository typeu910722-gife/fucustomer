// Difficulty for the multiplayer business day (打工人的號角). Career shifts have their own fixed tuning.
import type { ShiftConfig } from './career.ts';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'hell';
export const DIFFICULTY_IDS: Difficulty[] = ['easy', 'normal', 'hard', 'hell'];
export const DIFFICULTIES: Record<Difficulty, { name: string; icon: string; desc: string }> = {
  easy: { name: '佛系', icon: '🍵', desc: '客人少、耐心多、奧客很少' },
  normal: { name: '普通', icon: '🙂', desc: '一般營業日' },
  hard: { name: '血汗', icon: '🔥', desc: '客人多、沒耐心，奧客一次來兩個' },
  hell: { name: '地獄', icon: '💀', desc: '尖峰不停、奧客三連發，祝你平安下班' },
};

export const isDifficulty = (d: unknown): d is Difficulty => typeof d === 'string' && (DIFFICULTY_IDS as string[]).includes(d);

/** Scales the business-day config: customer flow, patience, karen frequency and how many at once. */
export function withDifficulty(cfg: ShiftConfig, d: Difficulty = 'normal'): ShiftConfig {
  const k = { easy: { spawn: 1.3, karen: 1.6, max: 1, patience: 1.3, anger: 0.8, cust: 0 }, normal: { spawn: 1, karen: 1, max: 1, patience: 1, anger: 1, cust: 0 },
    hard: { spawn: 0.8, karen: 0.7, max: 2, patience: 0.85, anger: 1.2, cust: 2 }, hell: { spawn: 0.65, karen: 0.5, max: 3, patience: 0.7, anger: 1.4, cust: 3 } }[d];
  return {
    ...cfg, spawnEvery: cfg.spawnEvery * k.spawn, karenEvery: cfg.karenEvery * k.karen, maxKarens: Math.max(cfg.maxKarens, k.max), maxCustomers: cfg.maxCustomers + k.cust,
    firstKaren: cfg.firstKaren * Math.min(1, k.karen), mods: { ...cfg.mods, patience: cfg.mods.patience * k.patience, angerRate: cfg.mods.angerRate * k.anger },
  };
}
