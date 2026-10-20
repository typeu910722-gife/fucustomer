// 書店: magazines and stationery on the walls, novels on an island, a reading corner and a pour-over coffee bar.
import { MapDef, box } from './types.ts';
import { COFFEE_BOX, CORNER_PLANT, STD_FRONT, STD_SPAWNS } from './common.ts';

export const BOOKSTORE: MapDef = {
  id: 'bookstore', name: '書店', icon: '📚', desc: '雜誌、小說、文具禮品，角落有閱讀桌和手沖咖啡。總有人坐在地上看到打烊。',
  sign: { text: '翻頁書店 PAGES', bg: '#5c940d' }, poster: ['書是用來買的', '不是用來翻皺的'],
  theme: { floor: 'wood', floorColor: [176, 136, 98], wall: 0xf4fce3, wainscot: 0x74b816, accent: 0x5c940d, counter: 0x8d6e63, shelf: 0x8d6e63 },
  products: {
    drinks: { name: '雜誌', price: 8, boxCost: 24, color: 0xf03e3e, palette: [0xf03e3e, 0x1c7ed6, 0xfab005, 0xf8f9fa], shape: 'flat' },
    snacks: { name: '小說', price: 12, boxCost: 36, color: 0x5c940d, palette: [0x2b8a3e, 0x862e9c, 0xe8590c, 0x1864ab, 0xf8f9fa], shape: 'box' },
    bento: { name: '文具禮品', price: 10, boxCost: 30, color: 0xfab005, palette: [0xfab005, 0xff8787, 0x74c0fc, 0x8ce99a], shape: 'box' },
  },
  shelves: [
    { product: 'drinks', box: box(0, 6.2, 0.9, 10.8, 2.0, 'wallshelf') },
    { product: 'snacks', box: box(8.5, 3.6, 14, 4.5, 1.9, 'shelf') },
    { product: 'bento', box: box(22.9, 2, 23.8, 8, 2.0, 'wallshelf') },
  ],
  ...STD_FRONT,
  coffee: { food: '手沖咖啡', station: '咖啡吧', verb: '沖咖啡', icon: '☕', price: 9, box: COFFEE_BOX },
  meal: null, foodChance: 0.3, goalScale: 1.05,
  decor: [box(3.4, 9.6, 4.6, 10.8, 0.75, 'table'), box(6.4, 9.6, 7.6, 10.8, 0.75, 'table'), CORNER_PLANT],
  karens: ['reader'],
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 5, z: 8 }, { x: 18, z: 6 }, { x: 11, z: 8.5 }, { x: 12, z: 12 }],
};
