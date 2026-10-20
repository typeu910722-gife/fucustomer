// A store map ("地圖"): floor plan, what it sells, its two food stations, colours and signs.
// Every map shares the same shell: a 24 × 16 m room, the front door at x 10.5–13.5 on the south wall,
// the stockroom with three stock crates in the north-west corner and the mop rack on the west wall.
// Units are metres; x grows to the east, z to the south (the door side).
import type { Product } from '../constants.ts';

export interface Box { x0: number; z0: number; x1: number; z1: number; h: number; kind: string }
export interface Pt { x: number; z: number }

/** How a product looks on the shelf. */
export type ProductShape = 'can' | 'bottle' | 'box' | 'flat' | 'cup' | 'shirt' | 'pants' | 'bag';

export interface MapProduct {
  name: string; price: number; boxCost: number;
  /** Label colour (also the minimap colour). */
  color: number;
  /** Colours the individual items are drawn in. */
  palette: number[];
  shape: ProductShape;
}

export interface MapStation {
  /** What the customer waits for, e.g. 咖啡 / 奶茶 / 手搖茶. */
  food: string;
  /** The machine, e.g. 咖啡機 / 紅茶機. */
  station: string;
  /** Action label, e.g. 煮咖啡 / 搖一杯. */
  verb: string;
  icon: string;
  price: number;
  /** Footprint. The worker stands on its south side (z1 + 0.6), so leave that free. */
  box: Box;
}

export interface MapDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Storefront sign and the poster on the back wall. */
  sign: { text: string; bg: string };
  poster: [string, string];
  theme: {
    floor: 'tile' | 'wood' | 'concrete';
    /** Base floor colour (tiles are shaded around it). */
    floorColor: [number, number, number];
    wall: number; wainscot: number; accent: number; counter: number; shelf: number;
  };
  /**
   * The product lines (internal slots drinks / snacks / bento, plus an optional fourth line 'extra' that gets its own
   * shelf and a fourth stock crate in the stockroom).
   */
  products: Record<Exclude<Product, 'extra'>, MapProduct> & { extra?: MapProduct };
  /**
   * Shelves, one per product line (including 'extra' when the map has it). kind: 'shelf' or 'rack' = free-standing, long along x (browsed from north and south);
   * 'fridge' or 'wallshelf' = against the east or west wall, long along z (browsed from the open side).
   */
  shelves: { product: Product; box: Box }[];
  /** Counter, long along x. Cashiers stand north of it, customers south. */
  counter: Box;
  /** Two registers: x on the counter, cashier spot north, customer spot south. */
  registers: [RegisterDef, RegisterDef];
  /** Food stations; null = this store sells no prepared food (e.g. a clothes shop). */
  coffee: MapStation | null;
  meal: (MapStation & { /** what the station uses up from the bento stock */ uses: string }) | null;
  /** Daily-challenge goals are multiplied by this (shops with pricier goods earn more per customer). Default 1. */
  goalScale?: number;
  /** Share of customers who also want prepared food. */
  foodChance: number;
  /** Where customers wait for their food, and where angry customers complain. */
  pickup: Pt; complaint: Pt;
  /** Wall socket the 充電霸王 squats at (south wall) and where he sits. */
  outlet: Pt; chargeSpot: Pt;
  /** Queue positions, first one nearest the registers. */
  queue: Pt[];
  /**
   * Extra furniture (solid: every box blocks movement). kind: 'table' | 'plant' | 'atm' | 'display' | 'fitting' | 'mannequin' | 'bar',
   * or a store-specific prop drawn by client/src/decor.ts: 'beauty' (cosmetics tester), 'readtable', 'bakecase', 'sample' (試吃台),
   * 'petpen', 'cages', 'cafetable', 'seats' (cinema row), 'hotpot', 'pump', 'treadmill', 'bench', 'bike', 'dumbbells', 'dining',
   * 'demo' (3C demo table), 'tvwall', 'mirrors' (salon station), 'dryer', 'writedesk', 'parcel', 'bpmeter', 'medcase', 'lobby', 'luggage'.
   * Chairs / sofas of table-like props are drawn just outside the box (like the stools of 'table') and do not block.
   */
  decor: Box[];
  /** Optional queue rope: posts from x0 to x1 at z. */
  rope?: { x0: number; x1: number; z: number };
  /** Karens that only show up in this kind of store (added to the usual mix in free play, own store and daily). */
  karens?: import('../constants.ts').KarenKind[];
  /** Where 試穿狂 stands (in front of a fitting room); needed only if the map uses that karen. */
  tryOnSpots?: Pt[];
  /** Where squatting store karens (試吃狂, 一杯坐整天, 器材霸主…) settle in: next to tables, sample stands, machines. Default: wander spots. */
  campSpots?: Pt[];
  playerSpawns: Pt[];
  /** Open floor spots where wandering karens stroll to. */
  wander: Pt[];
}
export interface RegisterDef { idx: number; x: number; z: number; cashier: Pt; customer: Pt }

export const box = (x0: number, z0: number, x1: number, z1: number, h: number, kind: string): Box => ({ x0, z0, x1, z1, h, kind });
