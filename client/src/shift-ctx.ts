// Per-shift context the menu sets before a game starts. Kept in its own tiny module (no three.js) so the
// main menu can set it without downloading the 3D game code, which is loaded on demand (see main.ts).
import type { Loadout } from '../../shared/shop.ts';

/** 常客奧客 (shared/regulars.ts): the named regular expected in this shift — set by the career flow before the game starts. */
export interface ShiftRegular {
  kind: string; name: string; icon: string; bubbles: string[]; handled: string;
  /** Pre-shift dialogue card (shown in the store during the short prep, once per stage). */
  pre?: { title: string; lines: { icon: string; name: string; text: string }[] };
}
export type StoryLine = { icon: string; name: string; text: string };

export const shiftCtx: {
  regular: ShiftRegular | null;
  /** A story scene played as speech bubbles inside the store (no modal); consumed once by the next game. */
  story: StoryLine[] | null;
  /** 商城 store decorations to build (free play / your own store only; null for career shifts and other people's stores). */
  decor: Loadout | null;
} = { regular: null, story: null, decor: null };

export function setShiftRegular(r: ShiftRegular | null) { shiftCtx.regular = r; }
export function setShiftStory(lines: StoryLine[] | null) { shiftCtx.story = lines; }
export function setStoreDecor(l: Loadout | null) { shiftCtx.decor = l; }
