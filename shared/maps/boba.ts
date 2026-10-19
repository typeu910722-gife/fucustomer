// 手搖飲店: most customers want a freshly shaken drink; long counter at the back, the shop floor is small.
import { MapDef, box } from './types.ts';

export const BOBA: MapDef = {
  id: 'boba', name: '手搖飲店', icon: '🧋', desc: '大部分客人都要現做手搖茶。長長的吧台在後面，店面小、排隊長。',
  sign: { text: '珍奶研究所 BOBA LAB', bg: '#0ca678' }, poster: ['全糖去冰', '奧客少冰'],
  theme: { floor: 'concrete', floorColor: [214, 218, 214], wall: 0xe6fcf5, wainscot: 0x20c997, accent: 0x087f5b, counter: 0xf8f9fa, shelf: 0x96f2d7 },
  products: {
    drinks: { name: '瓶裝茶', price: 9, boxCost: 27, color: 0x37b24d, palette: [0x8ce99a, 0xffd8a8, 0xe9ecef, 0x63e6be], shape: 'bottle' },
    snacks: { name: '雞蛋糕', price: 6, boxCost: 18, color: 0xf59f00, palette: [0xffd43b, 0xf59f00, 0xffe8a1], shape: 'box' },
    bento: { name: '鮮奶', price: 11, boxCost: 33, color: 0x4dabf7, palette: [0xf8f9fa, 0xd0ebff, 0xe7f5ff], shape: 'box' },
  },
  shelves: [
    { product: 'drinks', box: box(22.9, 3, 23.8, 9, 2.0, 'fridge') },
    { product: 'snacks', box: box(2.8, 9.4, 7.6, 10.2, 1.3, 'shelf') },
    { product: 'bento', box: box(0, 6, 0.9, 11, 1.9, 'fridge') },
  ],
  counter: box(8.5, 6, 19.5, 6.8, 1.05, 'counter'),
  registers: [
    { idx: 0, x: 12, z: 6.4, cashier: { x: 12, z: 5.3 }, customer: { x: 12, z: 7.6 } },
    { idx: 1, x: 16, z: 6.4, cashier: { x: 16, z: 5.3 }, customer: { x: 16, z: 7.6 } },
  ],
  coffee: { food: '手搖茶', station: '搖杯台', verb: '搖一杯', icon: '🧋', price: 12, box: box(10, 3.2, 12, 4.0, 1.0, 'coffee') },
  meal: { food: '熱珍奶', station: '鮮奶加熱機', verb: '煮熱珍奶', icon: '🥛', price: 16, uses: '鮮奶', box: box(14, 3.2, 15.6, 4.0, 1.0, 'microwave') },
  foodChance: 0.75,
  pickup: { x: 18.6, z: 7.6 }, complaint: { x: 9.6, z: 8.2 },
  outlet: { x: 3.2, z: 16 }, chargeSpot: { x: 3.2, z: 15.2 },
  queue: [
    { x: 14, z: 8.7 }, { x: 14, z: 9.7 }, { x: 14, z: 10.7 }, { x: 14.2, z: 11.7 }, { x: 15.2, z: 12.4 },
    { x: 16.2, z: 12.4 }, { x: 17.2, z: 12.4 }, { x: 18.2, z: 12.4 }, { x: 19.2, z: 12.4 }, { x: 20.2, z: 12.4 },
    { x: 21.2, z: 12.4 }, { x: 21.2, z: 13.4 },
  ],
  decor: [box(15, 15.2, 20.5, 15.7, 1.1, 'bar'), box(23.4, 13.5, 24, 15.5, 1.3, 'plant')],
  playerSpawns: [{ x: 12, z: 5.0 }, { x: 16, z: 5.0 }, { x: 10, z: 5.0 }, { x: 18, z: 5.0 }, { x: 8, z: 8 }],
  wander: [{ x: 5, z: 12.5 }, { x: 9, z: 12 }, { x: 18, z: 10 }, { x: 4, z: 8 }],
};
