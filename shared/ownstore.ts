// 自己開店: after the main story you can sink your savings into your own store.
// Runs on the business-day loop (rent, stock, upgrades, daily settlement); now you are the boss.
import { CareerProfile, abilitiesAt, modsFor, ShiftConfig } from './career.ts';
import type { StoreSave } from './protocol.ts';

/** Savings needed to open a store: roughly 10 late-game shifts of take-home pay. */
export const STORE_FUND = 2500;
/** Cash kept in the till when you withdraw profits. */
export const STORE_RESERVE = 400;

export type WageMode = 'kind' | 'fair' | 'stingy';
export const WAGES: Record<WageMode, { label: string; pay: number; mood: number; desc: string }> = {
  kind: { label: '😇 佛心老闆', pay: 140, mood: 12, desc: '日薪 $140。員工心情變好、做事更快' },
  fair: { label: '🙂 照規定給', pay: 90, mood: 2, desc: '日薪 $90。普普通通' },
  stingy: { label: '🤑 黑心老闆', pay: 40, mood: -18, desc: '日薪 $40。省錢，但員工越做越慢，心情歸零就辭職' },
};

export interface OwnStore {
  name: string; invested: number; save: StoreSave; days: number; negDays: number;
  staff: { name: string; mood: number; quit: boolean }; wage: WageMode; bestDay: number; withdrawn: number;
  /** Which kind of store (map id). */
  map: string;
}
export interface StoreHistory { opened: number; closed: number; lost: number; lastReason: string }

export function emptyHistory(): StoreHistory { return { opened: 0, closed: 0, lost: 0, lastReason: '' }; }

export function canOpenStore(p: CareerProfile): { ok: boolean; why?: string } {
  if (p.store) return { ok: false, why: '你已經有一家店了' };
  if (!(p.stars['6-3'] > 0)) return { ok: false, why: '先通過第 6 章，向錢董遞出辭職信' };
  if (p.wallet < STORE_FUND) return { ok: false, why: `開店基金不足：還差 $${STORE_FUND - p.wallet}` };
  return { ok: true };
}

/** Moves `capital` from savings into the new store's till. */
export function openStore(p: CareerProfile, name: string, capital: number, base: StoreSave, map = 'convenience'): OwnStore | null {
  if (!canOpenStore(p).ok) return null;
  const cap = Math.min(p.wallet, Math.max(STORE_FUND, Math.floor(capital)));
  p.wallet -= cap;
  const store: OwnStore = {
    name: (name.trim() || '我的便利商店').slice(0, 16), invested: cap,
    save: { ...base, day: 1, money: cap, rating: 3 },
    days: 0, negDays: 0, staff: { name: '小陳', mood: 70, quit: false }, wage: 'fair', bestDay: 0, withdrawn: 0, map,
  };
  p.store = store;
  p.storeHistory.opened++;
  return store;
}

/** How fast the employee works (bot movement multiplier) at a given mood. */
export function staffPace(mood: number) { return mood >= 70 ? 1.1 : mood >= 40 ? 1 : mood >= 20 ? 0.7 : 0.5; }

/** Business-day config for your own store (career skills and gear still apply; staff wage is charged each night). */
export function ownStoreConfig(p: CareerProfile, base: ShiftConfig): ShiftConfig {
  const st = p.store!;
  return {
    ...base, title: st.name, abilities: abilitiesAt(p.level), mods: modsFor(p),
    karens: ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger'], maxKarens: 2, maxCustomers: 9,
    staffWage: st.staff.quit ? 0 : WAGES[st.wage].pay, map: st.map,
  };
}

export interface DayOutcome { bankrupt: boolean; reason: string; quit: boolean; profit: number }

/** Called with each nightly save. Updates staff mood, the losing-streak counter, and closes the store when it goes under. */
export function settleStoreDay(p: CareerProfile, save: StoreSave): DayOutcome {
  const st = p.store;
  if (!st) return { bankrupt: false, reason: '', quit: false, profit: 0 };
  const profit = save.money - st.save.money;
  st.days++;
  st.bestDay = Math.max(st.bestDay, profit);
  let quit = false;
  if (!st.staff.quit) {
    st.staff.mood = Math.max(0, Math.min(100, st.staff.mood + WAGES[st.wage].mood));
    if (st.staff.mood <= 0) { st.staff.quit = true; quit = true; }
  }
  // a bad night: the till is in the red or nobody wants to shop here any more; three in a row and it's over
  const bad = save.money < 0 || save.rating <= 0.5;
  st.negDays = bad ? st.negDays + 1 : 0;
  const reason = st.negDays >= 3 ? (save.money < 0 ? '連續 3 天現金為負' : '連續 3 天口碑見底，沒有客人上門') : '';
  if (reason) {
    p.storeHistory.closed++; p.storeHistory.lost += st.invested; p.storeHistory.lastReason = reason;
    p.store = null;
    return { bankrupt: true, reason, quit, profit };
  }
  st.save = save;
  return { bankrupt: false, reason: '', quit, profit };
}

/** Takes cash out of the till into personal savings, keeping a reserve for rent and stock. */
export function withdraw(p: CareerProfile): number {
  const st = p.store; if (!st) return 0;
  const amt = Math.max(0, st.save.money - STORE_RESERVE);
  st.save = { ...st.save, money: st.save.money - amt };
  st.withdrawn += amt; p.wallet += amt;
  return amt;
}

/** Closing on your own terms: whatever cash is left comes back to savings. */
export function closeStore(p: CareerProfile): number {
  const st = p.store; if (!st) return 0;
  const back = Math.max(0, st.save.money);
  p.wallet += back;
  p.storeHistory.closed++; p.storeHistory.lastReason = '自己收掉了';
  p.store = null;
  return back;
}

/** Hire someone new after the last employee quit (costs a signing bonus). */
export function hireStaff(p: CareerProfile): boolean {
  const st = p.store; if (!st || !st.staff.quit || st.save.money < 150) return false;
  st.save = { ...st.save, money: st.save.money - 150 };
  st.staff = { name: ['阿豪', '小美', '阿凱', '佳佳'][st.days % 4], mood: 60, quit: false };
  return true;
}
