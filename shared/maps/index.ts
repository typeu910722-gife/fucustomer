// Map registry. To add a store type: copy one of the map files, change it, and add it to MAPS below.
// `npm test` checks every registered map (no blocked spots, every shelf and register reachable, a bot can run a day).
import { CONVENIENCE } from './convenience.ts';
import { BREAKFAST } from './breakfast.ts';
import { BOBA } from './boba.ts';
import { CLOTHING } from './clothing.ts';
import { CHICKEN } from './chicken.ts';
import { DRUGSTORE } from './drugstore.ts';
import { BOOKSTORE } from './bookstore.ts';
import { BAKERY } from './bakery.ts';
import { SUPERMARKET } from './supermarket.ts';
import { PETSHOP } from './petshop.ts';
import { CAFE } from './cafe.ts';
import { CINEMA } from './cinema.ts';
import { HOTPOT } from './hotpot.ts';
import { GAS } from './gas.ts';
import { GYM } from './gym.ts';
import { STEAK } from './steak.ts';
import { ELECTRONICS } from './electronics.ts';
import { SALON } from './salon.ts';
import { POST } from './post.ts';
import { PHARMACY } from './pharmacy.ts';
import { HOTEL } from './hotel.ts';
import type { MapDef } from './types.ts';

export const MAPS: MapDef[] = [
  CONVENIENCE, BREAKFAST, BOBA, CLOTHING, CHICKEN,
  // 第 8–10 章的店（各有一位招牌奧客，見 shared/sigkarens.ts）
  DRUGSTORE, BOOKSTORE, BAKERY, SUPERMARKET, PETSHOP, CAFE,
  CINEMA, HOTPOT, GAS, GYM, STEAK,
  ELECTRONICS, SALON, POST, PHARMACY, HOTEL,
];
export const DEFAULT_MAP = CONVENIENCE.id;
export function getMap(id: string | undefined): MapDef { return MAPS.find(m => m.id === id) ?? CONVENIENCE; }
export type { MapDef } from './types.ts';
