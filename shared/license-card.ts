// Public 高級社畜證照 fields shared by the Node server (server/auth.ts) and the Cloudflare LicenseDO.
// Weekly badges are sent as ISO week ids only ("2026-W43"); the client turns each into its icon + name with
// weekBadge() (shared/weekly.ts), so a card can never carry free text/HTML through this field.
const WEEK_ID = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
/** Newest badges kept on the public card. */
export const CARD_WEEK_BADGES_MAX = 8;
/** Upper bound for the badge count (10 years of weeks, same cap as the profile). */
export const CARD_WEEK_BADGE_COUNT_MAX = 520;

/** Cleans a list of week ids: valid ids only, de-duplicated, sorted, newest {@link CARD_WEEK_BADGES_MAX}; null if not a list. */
export function cleanWeekBadges(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > CARD_WEEK_BADGE_COUNT_MAX) return null;
  return [...new Set(v.filter((w): w is string => typeof w === 'string' && WEEK_ID.test(w)))].sort().slice(-CARD_WEEK_BADGES_MAX);
}
/** Applies `weekBadges` / `weekBadgeCount` from an update body onto a stored card (bad values are ignored). */
export function applyWeekBadges(r: { weekBadges?: string[]; weekBadgeCount?: number }, b: Record<string, unknown>) {
  if ('weekBadges' in b) { const w = cleanWeekBadges(b.weekBadges); if (w) r.weekBadges = w; }
  if ('weekBadgeCount' in b && typeof b.weekBadgeCount === 'number' && Number.isFinite(b.weekBadgeCount)) {
    r.weekBadgeCount = Math.round(Math.min(CARD_WEEK_BADGE_COUNT_MAX, Math.max(0, b.weekBadgeCount)));
  }
  // the count can't be lower than the badges actually listed
  if (r.weekBadges && (r.weekBadgeCount ?? 0) < r.weekBadges.length) r.weekBadgeCount = r.weekBadges.length;
}
/** The public view of the badge fields (old cards without them: none). */
export function viewWeekBadges(r: { weekBadges?: unknown; weekBadgeCount?: unknown }): { weekBadges: string[]; weekBadgeCount: number } {
  const weekBadges = cleanWeekBadges(r.weekBadges) ?? [];
  const n = typeof r.weekBadgeCount === 'number' && Number.isFinite(r.weekBadgeCount) ? Math.round(Math.min(CARD_WEEK_BADGE_COUNT_MAX, Math.max(0, r.weekBadgeCount))) : 0;
  return { weekBadges, weekBadgeCount: Math.max(n, weekBadges.length) };
}
