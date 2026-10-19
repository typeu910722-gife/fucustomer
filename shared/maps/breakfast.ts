// 早餐店: bread, soy-milk tea and cold sandwiches; a black-tea urn and a griddle for toasted sandwiches; a few tables.
import { MapDef, box } from './types.ts';

export const BREAKFAST: MapDef = {
  id: 'breakfast', name: '早餐店', icon: '🍳', desc: '一早最忙的地方。吐司、豆漿紅茶、冷藏三明治，紅茶機煮奶茶、煎台壓熱吐司。',
  sign: { text: '晨光早餐 Morning', bg: '#f08c00' }, poster: ['早安！', '奧客請先排隊'],
  theme: { floor: 'wood', floorColor: [196, 150, 104], wall: 0xfff3d6, wainscot: 0xf59f00, accent: 0xe8590c, counter: 0xa0522d, shelf: 0xb08968 },
  products: {
    drinks: { name: '豆漿紅茶', price: 7, boxCost: 21, color: 0xd9480f, palette: [0xfff4e6, 0xd9480f, 0xffe8cc, 0x8d6e63], shape: 'bottle' },
    snacks: { name: '吐司麵包', price: 5, boxCost: 15, color: 0xe8b04b, palette: [0xe8b04b, 0xf4d6a0, 0xc68642, 0xffe3a3], shape: 'box' },
    bento: { name: '三明治', price: 12, boxCost: 36, color: 0x74b816, palette: [0xfff9db, 0x94d82d, 0xffc9c9, 0xffe066], shape: 'flat' },
  },
  shelves: [
    { product: 'drinks', box: box(22.9, 2, 23.8, 7.6, 2.0, 'fridge') },
    { product: 'snacks', box: box(8.5, 4.2, 13.5, 5.1, 1.4, 'shelf') },
    { product: 'bento', box: box(0, 6.2, 0.9, 10.8, 1.8, 'fridge') },
  ],
  counter: box(15, 11, 21, 11.8, 1.05, 'counter'),
  registers: [
    { idx: 0, x: 16.5, z: 11.4, cashier: { x: 16.5, z: 10.3 }, customer: { x: 16.5, z: 12.5 } },
    { idx: 1, x: 19.2, z: 11.4, cashier: { x: 19.2, z: 10.3 }, customer: { x: 19.2, z: 12.5 } },
  ],
  coffee: { food: '奶茶', station: '紅茶機', verb: '泡奶茶', icon: '🥤', price: 9, box: box(15.1, 8.6, 16.1, 9.4, 1.0, 'coffee') },
  meal: { food: '熱壓吐司', station: '煎台', verb: '壓熱吐司', icon: '🍳', price: 16, uses: '三明治', box: box(17.3, 8.6, 19.3, 9.4, 1.0, 'microwave') },
  foodChance: 0.55,
  pickup: { x: 14.2, z: 11.6 }, complaint: { x: 13.2, z: 13.2 },
  outlet: { x: 3.2, z: 16 }, chargeSpot: { x: 3.2, z: 15.2 },
  queue: [
    { x: 17.85, z: 13.6 }, { x: 18.9, z: 14.4 }, { x: 19.9, z: 14.4 }, { x: 20.9, z: 14.4 }, { x: 21.9, z: 14.4 },
    { x: 22.9, z: 13.8 }, { x: 22.9, z: 12.9 }, { x: 22.9, z: 12.0 }, { x: 21.9, z: 12.4 }, { x: 22.2, z: 15.3 },
    { x: 21.2, z: 15.3 }, { x: 20.2, z: 15.3 },
  ],
  decor: [
    box(3.2, 7.4, 4.4, 8.6, 0.75, 'table'), box(3.2, 10.0, 4.4, 11.2, 0.75, 'table'),
    box(6.4, 7.4, 7.6, 8.6, 0.75, 'table'), box(6.4, 10.0, 7.6, 11.2, 0.75, 'table'),
    box(23.4, 13.5, 24, 15.5, 1.3, 'plant'),
  ],
  rope: { x0: 18.2, x1: 22.2, z: 13.85 },
  karens: ['custom'],
  playerSpawns: [{ x: 18, z: 9.8 }, { x: 16, z: 9.8 }, { x: 11, z: 9 }, { x: 18, z: 6 }, { x: 9, z: 12 }],
  wander: [{ x: 5.4, z: 9.3 }, { x: 11, z: 9 }, { x: 18, z: 6 }, { x: 10, z: 12.5 }],
};
