// 超市: drinks and fresh food in fridges along both walls, snacks on an island, a deli counter, sample stands.
import { MapDef, box } from './types.ts';
import { CORNER_PLANT, MEAL_BOX, STD_FRONT, STD_SPAWNS } from './common.ts';

export const SUPERMARKET: MapDef = {
  id: 'supermarket', name: '超市', icon: '🛒', desc: '飲料、零食、生鮮，熟食櫃現裝便當，走道上擺滿試吃台。有人會一攤一攤吃過去。',
  sign: { text: '全聯盟超市 MART', bg: '#1971c2' }, poster: ['試吃', '一人一份'],
  theme: { floor: 'tile', floorColor: [228, 232, 228], wall: 0xe7f5ff, wainscot: 0x1971c2, accent: 0xf03e3e, counter: 0x1971c2, shelf: 0x868e96 },
  products: {
    drinks: { name: '飲料', price: 7, boxCost: 21, color: 0x3fa7f5, palette: [0x3fa7f5, 0xe03131, 0x2f9e44, 0xf08c00], shape: 'can' },
    snacks: { name: '零食', price: 6, boxCost: 18, color: 0xf5b83f, palette: [0xf5b83f, 0xe8590c, 0xd6336c, 0x7048e8], shape: 'box' },
    bento: { name: '生鮮', price: 13, boxCost: 39, color: 0x51cf66, palette: [0x51cf66, 0xff8787, 0xffd43b, 0xf8f9fa], shape: 'flat' },
  },
  shelves: [
    { product: 'drinks', box: box(22.9, 2, 23.8, 8, 2.0, 'fridge') },
    { product: 'snacks', box: box(8.5, 3.4, 14.5, 4.3, 1.7, 'shelf') },
    { product: 'bento', box: box(0, 6.2, 0.9, 10.8, 1.8, 'fridge') },
  ],
  ...STD_FRONT,
  coffee: null,
  meal: { food: '熟食便當', station: '熟食櫃', verb: '裝便當', icon: '🍱', price: 16, uses: '生鮮', box: MEAL_BOX },
  foodChance: 0.3, goalScale: 1.05,
  decor: [box(8.8, 6.6, 10, 7.6, 0.9, 'sample'), box(12.6, 6.6, 13.8, 7.6, 0.9, 'sample'), box(4.2, 9, 5.4, 10, 0.9, 'sample'), CORNER_PLANT],
  karens: ['taster'],
  campSpots: [{ x: 9.4, z: 8.2 }, { x: 13.2, z: 8.2 }, { x: 4.8, z: 10.6 }, { x: 11.2, z: 7.1 }],
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 7, z: 11 }, { x: 18, z: 6 }, { x: 11.2, z: 9 }, { x: 12, z: 12.5 }],
};
