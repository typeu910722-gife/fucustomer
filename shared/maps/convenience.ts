// 便利商店 — the original map (career mode is set here).
import { MapDef, box } from './types.ts';

export const CONVENIENCE: MapDef = {
  id: 'convenience', name: '便利商店', icon: '🏪', desc: '24 小時營業。飲料、零食、便當，還有咖啡機和微波爐。',
  sign: { text: '奧客退散 FUCustomer', bg: '#ff6b6b' }, poster: ['顧客至上', '但奧客退散'],
  theme: { floor: 'tile', floorColor: [232, 228, 218], wall: 0xf8f0e3, wainscot: 0x63b7a6, accent: 0xff6b6b, counter: 0x8d6e63, shelf: 0x868e96 },
  products: {
    drinks: { name: '飲料', price: 8, boxCost: 24, color: 0x3fa7f5, palette: [0x3fa7f5, 0xe03131, 0x2f9e44, 0xf08c00, 0xf8f9fa], shape: 'can' },
    snacks: { name: '零食', price: 6, boxCost: 18, color: 0xf5b83f, palette: [0xf5b83f, 0xe8590c, 0xd6336c, 0x7048e8, 0xfcc419], shape: 'box' },
    bento: { name: '便當', price: 14, boxCost: 42, color: 0x7bd36a, palette: [0x7bd36a, 0xfff3bf, 0xffa8a8, 0x96f2d7], shape: 'flat' },
  },
  shelves: [
    { product: 'drinks', box: box(9, 3.4, 15, 4.3, 1.9, 'shelf') },
    { product: 'snacks', box: box(9, 6.9, 15, 7.8, 1.6, 'shelf') },
    { product: 'bento', box: box(22.9, 2, 23.8, 8, 2.0, 'fridge') },
  ],
  counter: box(15, 11, 21, 11.8, 1.05, 'counter'),
  registers: [
    { idx: 0, x: 16.5, z: 11.4, cashier: { x: 16.5, z: 10.3 }, customer: { x: 16.5, z: 12.5 } },
    { idx: 1, x: 19.2, z: 11.4, cashier: { x: 19.2, z: 10.3 }, customer: { x: 19.2, z: 12.5 } },
  ],
  coffee: { food: '咖啡', station: '咖啡機', verb: '煮咖啡', icon: '☕', price: 10, box: box(15.1, 8.6, 16.1, 9.4, 1.0, 'coffee') },
  meal: { food: '熱便當', station: '微波爐', verb: '加熱便當', icon: '🍱', price: 18, uses: '便當', box: box(17.7, 8.7, 18.6, 9.4, 1.0, 'microwave') },
  foodChance: 0.35,
  pickup: { x: 14.2, z: 11.6 }, complaint: { x: 13.2, z: 13.2 },
  outlet: { x: 3.2, z: 16 }, chargeSpot: { x: 3.2, z: 15.2 },
  queue: [
    { x: 17.85, z: 13.6 }, { x: 18.9, z: 14.4 }, { x: 19.9, z: 14.4 }, { x: 20.9, z: 14.4 }, { x: 21.9, z: 14.4 },
    { x: 22.9, z: 13.8 }, { x: 22.9, z: 12.9 }, { x: 22.9, z: 12.0 }, { x: 21.9, z: 12.4 }, { x: 22.2, z: 15.3 },
    { x: 21.2, z: 15.3 }, { x: 20.2, z: 15.3 },
  ],
  decor: [box(0, 7.5, 0.6, 10.5, 1.2, 'atm'), box(23.4, 13.5, 24, 15.5, 1.3, 'plant'), box(7.2, 13.8, 8.2, 14.8, 0.9, 'display')],
  rope: { x0: 18.2, x1: 22.2, z: 13.85 },
  playerSpawns: [{ x: 18, z: 9.9 }, { x: 12, z: 9.5 }, { x: 4, z: 7 }, { x: 18, z: 6 }, { x: 8, z: 11 }],
  wander: [{ x: 8, z: 10 }, { x: 18, z: 6 }, { x: 5, z: 9 }, { x: 12, z: 12 }],
};
