// 火鍋吃到飽: self-serve meat fridge and hot-pot ingredients, soup station and soft-serve machine, lots of tables.
import { MapDef, box } from './types.ts';
import { COFFEE_BOX, CORNER_PLANT, MEAL_BOX, STD_FRONT, STD_SPAWNS, westTables } from './common.ts';

export const HOTPOT: MapDef = {
  id: 'hotpot', name: '火鍋吃到飽', icon: '🍲', desc: '自助拿肉盤和火鍋料，湯底台現煮、冰淇淋機自己擠。小心有人偷偷打包。',
  sign: { text: '鍋霸吃到飽 HOTPOT', bg: '#c92a2a' }, poster: ['吃到飽', '不是帶到飽'],
  theme: { floor: 'tile', floorColor: [214, 200, 188], wall: 0xfff5f5, wainscot: 0xc92a2a, accent: 0xf08c00, counter: 0x5c3d2e, shelf: 0x868e96 },
  products: {
    drinks: { name: '飲料', price: 7, boxCost: 21, color: 0x1c7ed6, palette: [0x1c7ed6, 0xe03131, 0x37b24d, 0xf59f00], shape: 'can' },
    snacks: { name: '火鍋料', price: 8, boxCost: 24, color: 0xffa94d, palette: [0xffe8cc, 0xffa94d, 0xfff3bf, 0xffc9c9], shape: 'box' },
    bento: { name: '肉盤', price: 15, boxCost: 45, color: 0xe03131, palette: [0xffa8a8, 0xff8787, 0xfff5f5], shape: 'flat' },
  },
  shelves: [
    { product: 'drinks', box: box(22.9, 2, 23.8, 7, 2.0, 'fridge') },
    { product: 'snacks', box: box(8.5, 4, 14, 4.9, 1.3, 'shelf') },
    { product: 'bento', box: box(0, 6.2, 0.9, 10.6, 1.8, 'fridge') },
  ],
  ...STD_FRONT,
  coffee: { food: '冰淇淋', station: '冰淇淋機', verb: '擠冰淇淋', icon: '🍦', price: 6, box: COFFEE_BOX },
  meal: { food: '火鍋套餐', station: '湯底台', verb: '煮一鍋', icon: '🍲', price: 24, uses: '肉盤', box: MEAL_BOX },
  foodChance: 0.6, goalScale: 1.05,
  decor: [...westTables('hotpot'), CORNER_PLANT],
  karens: ['packer'],
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 5.4, z: 9.3 }, { x: 11, z: 9 }, { x: 18, z: 6 }, { x: 10, z: 12.5 }],
};
