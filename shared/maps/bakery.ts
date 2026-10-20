// 麵包店: bread and cakes on two low islands (take a tray and tongs!), milk fridge, coffee machine, two tables.
import { MapDef, box } from './types.ts';
import { COFFEE_BOX, CORNER_PLANT, STD_FRONT, STD_SPAWNS } from './common.ts';

export const BAKERY: MapDef = {
  id: 'bakery', name: '麵包店', icon: '🥐', desc: '麵包和蛋糕擺在中島，請用夾子和托盤。旁邊有鮮奶冰箱和咖啡機。',
  sign: { text: '麥香烘焙 BAKERY', bg: '#a0522d' }, poster: ['請用夾子', '不要用手摸'],
  theme: { floor: 'wood', floorColor: [206, 166, 120], wall: 0xfff8eb, wainscot: 0xd9a066, accent: 0xa0522d, counter: 0xa0522d, shelf: 0xd9a066 },
  products: {
    drinks: { name: '鮮奶', price: 7, boxCost: 21, color: 0x74c0fc, palette: [0xf8f9fa, 0xd0ebff, 0xffe8cc], shape: 'bottle' },
    snacks: { name: '麵包', price: 6, boxCost: 18, color: 0xe8b04b, palette: [0xe8b04b, 0xc68642, 0xf4d6a0, 0xffe3a3], shape: 'box' },
    bento: { name: '蛋糕', price: 14, boxCost: 42, color: 0xf783ac, palette: [0xfff0f6, 0xf783ac, 0x8d6e63, 0xfff3bf], shape: 'flat' },
  },
  shelves: [
    { product: 'drinks', box: box(22.9, 2, 23.8, 7, 2.0, 'fridge') },
    { product: 'snacks', box: box(8.5, 3.4, 14.5, 4.3, 1.1, 'shelf') },
    { product: 'bento', box: box(8.5, 6.9, 14.5, 7.8, 1.1, 'shelf') },
  ],
  ...STD_FRONT,
  coffee: { food: '咖啡', station: '咖啡機', verb: '煮咖啡', icon: '☕', price: 8, box: COFFEE_BOX },
  meal: null, foodChance: 0.3, goalScale: 0.85,
  decor: [box(3.2, 8, 4.4, 9.2, 0.75, 'bakecase'), box(3.2, 11, 4.4, 12.2, 0.75, 'bakecase'), CORNER_PLANT],
  karens: ['toucher'],
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 7, z: 10 }, { x: 18, z: 6 }, { x: 5.5, z: 13 }, { x: 12, z: 12 }],
};
