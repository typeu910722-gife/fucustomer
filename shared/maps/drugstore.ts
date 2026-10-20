// 藥妝店: skincare, face masks and make-up on islands and a wall unit; testers everywhere. No food, pricier goods.
import { MapDef, box } from './types.ts';
import { CORNER_PLANT, STD_FRONT, STD_SPAWNS } from './common.ts';

export const DRUGSTORE: MapDef = {
  id: 'drugstore', name: '藥妝店', icon: '💄', desc: '保養品、面膜、彩妝一排排，到處都是試用品。不賣吃的，單價偏高。',
  sign: { text: '美麗藥妝 BEAUTY', bg: '#d6336c' }, poster: ['試用品', '請酌量使用'],
  theme: { floor: 'tile', floorColor: [240, 234, 238], wall: 0xfff0f6, wainscot: 0xf783ac, accent: 0xd6336c, counter: 0xf8f9fa, shelf: 0xfcc2d7 },
  products: {
    drinks: { name: '保養品', price: 14, boxCost: 42, color: 0xf783ac, palette: [0xfff0f6, 0xf783ac, 0xe599f7, 0xffffff], shape: 'bottle' },
    snacks: { name: '面膜', price: 9, boxCost: 27, color: 0x74c0fc, palette: [0xa5d8ff, 0xb2f2bb, 0xffec99, 0xfcc2d7], shape: 'flat' },
    bento: { name: '彩妝', price: 18, boxCost: 54, color: 0xc2255c, palette: [0xc2255c, 0x212529, 0xf08c00, 0x862e9c], shape: 'box' },
  },
  shelves: [
    { product: 'drinks', box: box(8.5, 3.4, 14.5, 4.3, 1.8, 'shelf') },
    { product: 'snacks', box: box(8.5, 6.9, 14.5, 7.8, 1.6, 'shelf') },
    { product: 'bento', box: box(22.9, 2, 23.8, 8, 2.0, 'wallshelf') },
  ],
  ...STD_FRONT,
  coffee: null, meal: null, foodChance: 0, goalScale: 1.35,
  decor: [box(7.2, 13.8, 8.2, 14.8, 0.9, 'beauty'), box(3.6, 8.4, 4.8, 9.6, 0.9, 'beauty'), CORNER_PLANT],
  karens: ['sampler'],
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 8, z: 10 }, { x: 18, z: 6 }, { x: 5, z: 11.5 }, { x: 12, z: 12 }],
};
