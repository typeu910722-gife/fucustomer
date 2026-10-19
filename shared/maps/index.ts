// Map registry. To add a store type: copy one of the map files, change it, and add it to MAPS below.
// `npm test` checks every registered map (no blocked spots, every shelf and register reachable, a bot can run a day).
import { CONVENIENCE } from './convenience.ts';
import { BREAKFAST } from './breakfast.ts';
import { BOBA } from './boba.ts';
import { CLOTHING } from './clothing.ts';
import { CHICKEN } from './chicken.ts';
import type { MapDef } from './types.ts';

export const MAPS: MapDef[] = [CONVENIENCE, BREAKFAST, BOBA, CLOTHING, CHICKEN];
export const DEFAULT_MAP = CONVENIENCE.id;
export function getMap(id: string | undefined): MapDef { return MAPS.find(m => m.id === id) ?? CONVENIENCE; }
export type { MapDef } from './types.ts';
