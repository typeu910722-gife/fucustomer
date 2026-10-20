// 咖啡廳: pour-over coffee and waffles made to order, cakes in the fridge, four tables and a window bar.
import { MapDef, box } from './types.ts';
import { COFFEE_BOX, CORNER_PLANT, MEAL_BOX, STD_FRONT, STD_SPAWNS, WEST_TABLES, WEST_TABLE_SPOTS } from './common.ts';

export const CAFE: MapDef = {
  id: 'cafe', name: '咖啡廳', icon: '☕', desc: '手沖咖啡、鬆餅現做，蛋糕在冰箱。桌子不多，有人點一杯就坐一整天。',
  sign: { text: '慢慢咖啡 SLOW CAFE', bg: '#5c3d2e' }, poster: ['用餐限時', '90 分鐘'],
  theme: { floor: 'wood', floorColor: [168, 124, 92], wall: 0xf8f1e7, wainscot: 0x8d6e63, accent: 0x2f9e44, counter: 0x5c3d2e, shelf: 0x8d6e63 },
  products: {
    drinks: { name: '瓶裝飲料', price: 8, boxCost: 24, color: 0x20c997, palette: [0x20c997, 0xfab005, 0xf8f9fa], shape: 'bottle' },
    snacks: { name: '餅乾', price: 6, boxCost: 18, color: 0xc68642, palette: [0xc68642, 0xe8b04b, 0x8d6e63], shape: 'box' },
    bento: { name: '蛋糕', price: 12, boxCost: 36, color: 0xf783ac, palette: [0xfff0f6, 0xf783ac, 0x8d6e63], shape: 'flat' },
  },
  shelves: [
    { product: 'drinks', box: box(22.9, 2, 23.8, 7, 2.0, 'fridge') },
    { product: 'snacks', box: box(8.5, 3.6, 13.5, 4.5, 1.3, 'shelf') },
    { product: 'bento', box: box(0, 6.2, 0.9, 10.6, 1.8, 'fridge') },
  ],
  ...STD_FRONT,
  coffee: { food: '手沖咖啡', station: '手沖吧台', verb: '沖咖啡', icon: '☕', price: 12, box: COFFEE_BOX },
  meal: { food: '鬆餅', station: '鬆餅機', verb: '烤鬆餅', icon: '🧇', price: 15, uses: '蛋糕', box: MEAL_BOX },
  foodChance: 0.65, goalScale: 0.95,
  decor: [...WEST_TABLES, box(5, 15.3, 9.5, 15.7, 1.1, 'bar'), CORNER_PLANT],
  karens: ['squatter'],
  campSpots: [...WEST_TABLE_SPOTS, { x: 6, z: 14.7 }, { x: 8, z: 14.7 }],
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 5.4, z: 9.3 }, { x: 11, z: 9 }, { x: 18, z: 6 }, { x: 10, z: 12.5 }],
};
