// 3C 賣場: accessories and earphones on islands, laptops on the wall, demo tables by the window. Expensive goods.
import { MapDef, box } from './types.ts';
import { CORNER_PLANT, STD_FRONT, STD_SPAWNS } from './common.ts';

export const ELECTRONICS: MapDef = {
  id: 'electronics', name: '3C 賣場', icon: '📱', desc: '手機配件、耳機、筆電平板，單價最高。服務台常有人拿著拆過的東西來退。',
  sign: { text: '極速 3C MEGA', bg: '#1864ab' }, poster: ['拆封商品', '恕不退換'],
  theme: { floor: 'concrete', floorColor: [206, 212, 220], wall: 0xe7f5ff, wainscot: 0x1c7ed6, accent: 0x1864ab, counter: 0x343a40, shelf: 0x495057 },
  products: {
    drinks: { name: '手機配件', price: 18, boxCost: 54, color: 0x339af0, palette: [0x339af0, 0x212529, 0xf8f9fa, 0xff8787], shape: 'box' },
    snacks: { name: '耳機', price: 26, boxCost: 78, color: 0x212529, palette: [0x212529, 0xf8f9fa, 0x845ef7, 0x20c997], shape: 'box' },
    bento: { name: '筆電平板', price: 40, boxCost: 120, color: 0x868e96, palette: [0xadb5bd, 0x343a40, 0xdee2e6], shape: 'flat' },
  },
  shelves: [
    { product: 'drinks', box: box(8.5, 3.4, 14.5, 4.3, 1.6, 'shelf') },
    { product: 'snacks', box: box(8.5, 6.9, 14.5, 7.8, 1.4, 'shelf') },
    { product: 'bento', box: box(22.9, 2, 23.8, 8, 2.0, 'wallshelf') },
  ],
  ...STD_FRONT,
  coffee: null, meal: null, foodChance: 0, goalScale: 2.6,
  decor: [box(3.4, 8, 4.6, 9.2, 0.9, 'display'), box(3.4, 11, 4.6, 12.2, 0.9, 'display'), box(0, 7.5, 0.6, 10.5, 1.2, 'atm'), CORNER_PLANT],
  karens: ['unboxer'],
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 8, z: 10 }, { x: 18, z: 6 }, { x: 6.5, z: 12.5 }, { x: 12, z: 12 }],
};
