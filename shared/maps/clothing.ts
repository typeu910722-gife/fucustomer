// 服飾店: clothes racks and an accessories wall; no food at all, but higher prices and fitting rooms.
import { MapDef, box } from './types.ts';

export const CLOTHING: MapDef = {
  id: 'clothing', name: '服飾店', icon: '👕', desc: '不賣吃的，單價高。上衣、褲子掛在衣架上，包包配件在牆上，旁邊有試衣間。',
  sign: { text: 'URBAN 潮衣所', bg: '#212529' }, poster: ['NEW ARRIVAL', '奧客退散 SALE'],
  theme: { floor: 'wood', floorColor: [120, 98, 82], wall: 0xf8f9fa, wainscot: 0x343a40, accent: 0xe64980, counter: 0x212529, shelf: 0x495057 },
  products: {
    drinks: { name: '上衣', price: 22, boxCost: 66, color: 0xe64980, palette: [0xf8f9fa, 0x212529, 0xe64980, 0x4dabf7, 0xfcc419], shape: 'shirt' },
    snacks: { name: '褲子', price: 28, boxCost: 84, color: 0x364fc7, palette: [0x364fc7, 0x212529, 0xadb5bd, 0x8d6e63], shape: 'pants' },
    bento: { name: '包包配件', price: 35, boxCost: 105, color: 0xf08c00, palette: [0xf08c00, 0x862e9c, 0x212529, 0xc92a2a], shape: 'bag' },
  },
  shelves: [
    { product: 'drinks', box: box(8.5, 3.6, 14.5, 4.4, 1.7, 'rack') },
    { product: 'snacks', box: box(8.5, 7.2, 14.5, 8.0, 1.7, 'rack') },
    { product: 'bento', box: box(22.9, 2, 23.8, 8, 2.0, 'wallshelf') },
  ],
  counter: box(15, 11, 21, 11.8, 1.05, 'counter'),
  registers: [
    { idx: 0, x: 16.5, z: 11.4, cashier: { x: 16.5, z: 10.3 }, customer: { x: 16.5, z: 12.5 } },
    { idx: 1, x: 19.2, z: 11.4, cashier: { x: 19.2, z: 10.3 }, customer: { x: 19.2, z: 12.5 } },
  ],
  coffee: null, meal: null, foodChance: 0, goalScale: 2.7,
  pickup: { x: 14.2, z: 11.6 }, complaint: { x: 13.2, z: 13.2 },
  outlet: { x: 3.2, z: 16 }, chargeSpot: { x: 3.2, z: 15.2 },
  queue: [
    { x: 17.85, z: 13.6 }, { x: 18.9, z: 14.4 }, { x: 19.9, z: 14.4 }, { x: 20.9, z: 14.4 }, { x: 21.9, z: 14.4 },
    { x: 22.9, z: 13.8 }, { x: 22.9, z: 12.9 }, { x: 22.9, z: 12.0 }, { x: 21.9, z: 12.4 }, { x: 22.2, z: 15.3 },
    { x: 21.2, z: 15.3 }, { x: 20.2, z: 15.3 },
  ],
  decor: [
    box(1.0, 6.4, 3.0, 8.4, 2.3, 'fitting'), box(1.0, 8.8, 3.0, 10.8, 2.3, 'fitting'),
    box(5.6, 13.6, 6.4, 14.4, 1.8, 'mannequin'), box(7.6, 13.6, 8.4, 14.4, 1.8, 'mannequin'),
    box(23.4, 13.5, 24, 15.5, 1.3, 'plant'),
  ],
  rope: { x0: 18.2, x1: 22.2, z: 13.85 },
  karens: ['tryhard'],
  tryOnSpots: [{ x: 3.7, z: 7.4 }, { x: 3.7, z: 9.8 }],
  playerSpawns: [{ x: 18, z: 9.5 }, { x: 12, z: 9.5 }, { x: 5, z: 7 }, { x: 18, z: 6 }, { x: 8, z: 11 }],
  wander: [{ x: 6, z: 10 }, { x: 18, z: 6 }, { x: 11.5, z: 10 }, { x: 12, z: 12 }],
};
