// 雞排店: fried chicken stand — a black-tea urn and a deep fryer behind the counter, standing bar by the window.
// (Made by copying convenience.ts and following docs/MAPS.md.)
import { MapDef, box } from './types.ts';

export const CHICKEN: MapDef = {
  id: 'chicken', name: '雞排店', icon: '🍗', desc: '宵夜聖地。現炸雞排、古早味紅茶，冷凍炸物也賣。客人常常「不要切、不要辣」。',
  sign: { text: '大雞排 BIG CHICKEN', bg: '#e03131' }, poster: ['不要切', '不要辣'],
  theme: { floor: 'tile', floorColor: [222, 206, 188], wall: 0xfff9db, wainscot: 0xf03e3e, accent: 0xfab005, counter: 0xc92a2a, shelf: 0x868e96 },
  products: {
    drinks: { name: '罐裝飲料', price: 8, boxCost: 24, color: 0x1c7ed6, palette: [0x1c7ed6, 0xe03131, 0x37b24d, 0xf59f00], shape: 'can' },
    snacks: { name: '泡麵零嘴', price: 6, boxCost: 18, color: 0xf08c00, palette: [0xf08c00, 0xffd43b, 0xe8590c, 0xc92a2a], shape: 'box' },
    bento: { name: '冷凍炸物', price: 13, boxCost: 39, color: 0x74c0fc, palette: [0xe7f5ff, 0xa5d8ff, 0xffe8cc], shape: 'flat' },
  },
  shelves: [
    { product: 'drinks', box: box(22.9, 2, 23.8, 7, 2.0, 'fridge') },
    { product: 'snacks', box: box(8.5, 4.5, 14, 5.4, 1.5, 'shelf') },
    { product: 'bento', box: box(0, 6.2, 0.9, 10.6, 1.6, 'fridge') },
  ],
  counter: box(15, 11, 21, 11.8, 1.05, 'counter'),
  registers: [
    { idx: 0, x: 16.5, z: 11.4, cashier: { x: 16.5, z: 10.3 }, customer: { x: 16.5, z: 12.5 } },
    { idx: 1, x: 19.2, z: 11.4, cashier: { x: 19.2, z: 10.3 }, customer: { x: 19.2, z: 12.5 } },
  ],
  coffee: { food: '古早味紅茶', station: '紅茶桶', verb: '倒紅茶', icon: '🥤', price: 8, box: box(15.1, 8.6, 16.1, 9.4, 1.0, 'coffee') },
  meal: { food: '現炸雞排', station: '炸鍋', verb: '下鍋炸雞排', icon: '🍗', price: 20, uses: '冷凍炸物', box: box(17.2, 8.5, 19.4, 9.4, 1.0, 'microwave') },
  foodChance: 0.7,
  pickup: { x: 14.2, z: 11.6 }, complaint: { x: 13.2, z: 13.2 },
  outlet: { x: 3.2, z: 16 }, chargeSpot: { x: 3.2, z: 15.2 },
  queue: [
    { x: 17.85, z: 13.6 }, { x: 18.9, z: 14.4 }, { x: 19.9, z: 14.4 }, { x: 20.9, z: 14.4 }, { x: 21.9, z: 14.4 },
    { x: 22.9, z: 13.8 }, { x: 22.9, z: 12.9 }, { x: 22.9, z: 12.0 }, { x: 21.9, z: 12.4 }, { x: 22.2, z: 15.3 },
    { x: 21.2, z: 15.3 }, { x: 20.2, z: 15.3 },
  ],
  decor: [box(5, 15.3, 9.5, 15.7, 1.1, 'bar'), box(23.4, 13.5, 24, 15.5, 1.3, 'plant')],
  rope: { x0: 18.2, x1: 22.2, z: 13.85 },
  karens: ['custom'],
  playerSpawns: [{ x: 18, z: 9.9 }, { x: 12, z: 9.5 }, { x: 4, z: 7 }, { x: 18, z: 6 }, { x: 8, z: 11 }],
  wander: [{ x: 6, z: 12 }, { x: 18, z: 6 }, { x: 11, z: 8 }, { x: 12, z: 12 }],
};
