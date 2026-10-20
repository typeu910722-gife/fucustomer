// Shared pieces for maps that use the standard front: counter and two registers in the south-east, the queue snaking
// along the east wall behind a rope, pickup and complaint spots next to the counter (same as 便利商店).
import { MapDef, box } from './types.ts';

export const STD_FRONT: Pick<MapDef, 'counter' | 'registers' | 'pickup' | 'complaint' | 'outlet' | 'chargeSpot' | 'queue' | 'rope'> = {
  counter: box(15, 11, 21, 11.8, 1.05, 'counter'),
  registers: [
    { idx: 0, x: 16.5, z: 11.4, cashier: { x: 16.5, z: 10.3 }, customer: { x: 16.5, z: 12.5 } },
    { idx: 1, x: 19.2, z: 11.4, cashier: { x: 19.2, z: 10.3 }, customer: { x: 19.2, z: 12.5 } },
  ],
  pickup: { x: 14.2, z: 11.6 }, complaint: { x: 13.2, z: 13.2 },
  outlet: { x: 3.2, z: 16 }, chargeSpot: { x: 3.2, z: 15.2 },
  queue: [
    { x: 17.85, z: 13.6 }, { x: 18.9, z: 14.4 }, { x: 19.9, z: 14.4 }, { x: 20.9, z: 14.4 }, { x: 21.9, z: 14.4 },
    { x: 22.9, z: 13.8 }, { x: 22.9, z: 12.9 }, { x: 22.9, z: 12.0 }, { x: 21.9, z: 12.4 }, { x: 22.2, z: 15.3 },
    { x: 21.2, z: 15.3 }, { x: 20.2, z: 15.3 },
  ],
  rope: { x0: 18.2, x1: 22.2, z: 13.85 },
};
/** Station footprints behind the counter (the worker stands at z 10.0, between them and the counter). */
export const COFFEE_BOX = box(15.1, 8.6, 16.1, 9.4, 1.0, 'coffee');
export const MEAL_BOX = box(17.4, 8.6, 19.2, 9.4, 1.0, 'microwave');
/** The plant in the south-east corner next to the queue. */
export const CORNER_PLANT = box(23.4, 13.5, 24, 15.5, 1.3, 'plant');
export const STD_SPAWNS = [{ x: 18, z: 9.9 }, { x: 12, z: 9.5 }, { x: 4, z: 6.4 }, { x: 18, z: 6 }, { x: 10, z: 11 }];
/** Four café tables west of the shop floor and the spots next to them (for 坐整天 / 熟度魔人 style karens). */
export const WEST_TABLES = [
  box(3.2, 7.4, 4.4, 8.6, 0.75, 'table'), box(3.2, 10.0, 4.4, 11.2, 0.75, 'table'),
  box(6.4, 7.4, 7.6, 8.6, 0.75, 'table'), box(6.4, 10.0, 7.6, 11.2, 0.75, 'table'),
];
export const WEST_TABLE_SPOTS = [{ x: 5.4, z: 8.0 }, { x: 5.4, z: 10.6 }, { x: 8.4, z: 8.0 }, { x: 8.4, z: 10.6 }];
