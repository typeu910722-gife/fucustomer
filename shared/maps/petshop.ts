// 寵物店: pet food cans and treats on islands, kibble on the wall, a pet-bed display.
import { MapDef, box } from './types.ts';
import { CORNER_PLANT, STD_FRONT, STD_SPAWNS } from './common.ts';

export const PETSHOP: MapDef = {
  id: 'petshop', name: '寵物店', icon: '🐶', desc: '寵物罐頭、狗零食、飼料。不賣人吃的。常有人牽著狗沿路拆零食給牠試吃。',
  sign: { text: '毛孩樂園 PET LAND', bg: '#f08c00' }, poster: ['零食請先結帳', '毛孩請牽好'],
  theme: { floor: 'wood', floorColor: [214, 180, 140], wall: 0xfff9db, wainscot: 0xf59f00, accent: 0xe8590c, counter: 0xf8f9fa, shelf: 0xffd8a8 },
  products: {
    drinks: { name: '寵物罐頭', price: 9, boxCost: 27, color: 0xe8590c, palette: [0xe8590c, 0x1c7ed6, 0x37b24d, 0xfab005], shape: 'can' },
    snacks: { name: '狗零食', price: 7, boxCost: 21, color: 0xf59f00, palette: [0xf59f00, 0xd9480f, 0xffe066], shape: 'box' },
    bento: { name: '飼料', price: 16, boxCost: 48, color: 0x5c940d, palette: [0x5c940d, 0xe8590c, 0x1864ab], shape: 'bag' },
  },
  shelves: [
    { product: 'drinks', box: box(8.5, 3.4, 14.5, 4.3, 1.5, 'shelf') },
    { product: 'snacks', box: box(8.5, 6.9, 14.5, 7.8, 1.5, 'shelf') },
    { product: 'bento', box: box(22.9, 2, 23.8, 8, 2.0, 'wallshelf') },
  ],
  ...STD_FRONT,
  coffee: null, meal: null, foodChance: 0, goalScale: 1.0,
  decor: [box(3.4, 8.4, 4.6, 9.6, 0.5, 'petpen'), box(7.2, 13.8, 8.2, 14.8, 0.9, 'cages'), box(0.2, 14.2, 0.9, 15.4, 1.2, 'plant'), CORNER_PLANT],
  karens: ['dogfeed'],
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 8, z: 10 }, { x: 18, z: 6 }, { x: 5, z: 11.5 }, { x: 12, z: 12 }],
};
