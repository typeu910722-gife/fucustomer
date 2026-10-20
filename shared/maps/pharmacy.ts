// 藥局: vitamins and cold medicine on islands, masks on the wall, a blood-pressure corner.
import { MapDef, box } from './types.ts';
import { CORNER_PLANT, STD_FRONT, STD_SPAWNS } from './common.ts';

export const PHARMACY: MapDef = {
  id: 'pharmacy', name: '藥局', icon: '💊', desc: '維他命、感冒成藥、口罩。處方藥一定要處方箋——但總有人覺得「不用啦」。',
  sign: { text: '健康藥局 PHARMACY', bg: '#0c8599' }, poster: ['處方藥', '請出示處方箋'],
  theme: { floor: 'tile', floorColor: [232, 240, 240], wall: 0xe3fafc, wainscot: 0x15aabf, accent: 0x0c8599, counter: 0xf8f9fa, shelf: 0x99e9f2 },
  products: {
    drinks: { name: '維他命', price: 15, boxCost: 45, color: 0xfab005, palette: [0xfab005, 0xf8f9fa, 0xff922b], shape: 'bottle' },
    snacks: { name: '感冒成藥', price: 11, boxCost: 33, color: 0x15aabf, palette: [0x15aabf, 0xf8f9fa, 0xe03131], shape: 'box' },
    bento: { name: '口罩', price: 6, boxCost: 18, color: 0x74c0fc, palette: [0xd0ebff, 0xf8f9fa, 0xffc9c9], shape: 'flat' },
  },
  shelves: [
    { product: 'drinks', box: box(9, 3.4, 15, 4.3, 1.7, 'shelf') },
    { product: 'snacks', box: box(9, 6.9, 15, 7.8, 1.7, 'shelf') },
    { product: 'bento', box: box(22.9, 2, 23.8, 8, 2.0, 'wallshelf') },
  ],
  ...STD_FRONT,
  coffee: null, meal: null, foodChance: 0, goalScale: 1.2,
  decor: [box(3.4, 8.4, 4.6, 9.6, 0.8, 'table'), box(7.2, 13.8, 8.2, 14.8, 0.9, 'display'), CORNER_PLANT],
  karens: ['rx'],
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 8, z: 10 }, { x: 18, z: 6 }, { x: 5, z: 11.5 }, { x: 12, z: 12 }],
};
