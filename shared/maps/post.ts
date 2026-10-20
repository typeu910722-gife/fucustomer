// 郵局: stamps and envelopes on the wall, boxes on an island, writing desks and an ATM.
import { MapDef, box } from './types.ts';
import { CORNER_PLANT, STD_FRONT, STD_SPAWNS } from './common.ts';

export const POST: MapDef = {
  id: 'post', name: '郵局', icon: '🏤', desc: '寄包裹、買郵票、紙箱，旁邊有寫字檯和提款機。櫃台前常有人掏出一整袋零錢。',
  sign: { text: '中華郵差 POST', bg: '#2b8a3e' }, poster: ['請抽號碼牌', '零錢請先整理'],
  theme: { floor: 'tile', floorColor: [226, 230, 222], wall: 0xebfbee, wainscot: 0x2f9e44, accent: 0x2b8a3e, counter: 0x2f9e44, shelf: 0x868e96 },
  products: {
    drinks: { name: '郵票信封', price: 5, boxCost: 15, color: 0x2f9e44, palette: [0xf8f9fa, 0x2f9e44, 0xfab005], shape: 'flat' },
    snacks: { name: '包裝紙箱', price: 8, boxCost: 24, color: 0xc68642, palette: [0xc68642, 0xe8b04b], shape: 'box' },
    bento: { name: '明信片禮盒', price: 12, boxCost: 36, color: 0x1c7ed6, palette: [0x1c7ed6, 0xf783ac, 0x94d82d], shape: 'box' },
  },
  shelves: [
    { product: 'drinks', box: box(0, 6.2, 0.9, 10.8, 1.6, 'wallshelf') },
    { product: 'snacks', box: box(8.5, 4, 14, 4.9, 1.4, 'shelf') },
    { product: 'bento', box: box(22.9, 2, 23.8, 8, 2.0, 'wallshelf') },
  ],
  ...STD_FRONT,
  coffee: null, meal: null, foodChance: 0, goalScale: 0.8,
  decor: [box(4, 8, 5.2, 9.2, 0.9, 'table'), box(4, 11, 5.2, 12.2, 0.9, 'table'), box(23.4, 9, 24, 11, 1.2, 'atm'), CORNER_PLANT],
  karens: ['coins'],
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 7, z: 10 }, { x: 11, z: 8 }, { x: 18, z: 6 }, { x: 12, z: 12.5 }],
};
