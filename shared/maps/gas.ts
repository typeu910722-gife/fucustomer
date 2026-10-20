// 加油站: the forecourt shop — motor oil, snacks and wiper blades, a coffee machine, an ATM and a tyre display.
import { MapDef, box } from './types.ts';
import { COFFEE_BOX, CORNER_PLANT, STD_FRONT, STD_SPAWNS } from './common.ts';

export const GAS: MapDef = {
  id: 'gas', name: '加油站', icon: '⛽', desc: '加油站的小店：機油、零食、雨刷，還有現煮咖啡。結帳時總有人要你順便擦車窗。',
  sign: { text: '油速 GAS & GO', bg: '#2b8a3e' }, poster: ['加滿', '自助擦窗'],
  theme: { floor: 'concrete', floorColor: [200, 204, 196], wall: 0xebfbee, wainscot: 0x2f9e44, accent: 0xfab005, counter: 0x2b8a3e, shelf: 0x868e96 },
  products: {
    drinks: { name: '機油', price: 15, boxCost: 45, color: 0xfab005, palette: [0xfab005, 0x212529, 0xe03131], shape: 'bottle' },
    snacks: { name: '零食', price: 6, boxCost: 18, color: 0xf08c00, palette: [0xf5b83f, 0xe8590c, 0xd6336c, 0x7048e8], shape: 'box' },
    bento: { name: '雨刷', price: 12, boxCost: 36, color: 0x495057, palette: [0x343a40, 0x868e96, 0x1c7ed6], shape: 'flat' },
  },
  shelves: [
    { product: 'drinks', box: box(9, 3.4, 15, 4.3, 1.6, 'shelf') },
    { product: 'snacks', box: box(9, 6.9, 15, 7.8, 1.6, 'shelf') },
    { product: 'bento', box: box(22.9, 2, 23.8, 8, 2.0, 'wallshelf') },
  ],
  ...STD_FRONT,
  coffee: { food: '熱咖啡', station: '咖啡機', verb: '煮咖啡', icon: '☕', price: 9, box: COFFEE_BOX },
  meal: null, foodChance: 0.3, goalScale: 1.1,
  decor: [box(0, 7.5, 0.6, 10.5, 1.2, 'atm'), box(7.2, 13.8, 8.2, 14.8, 0.9, 'pump'), CORNER_PLANT],
  karens: ['wiper'],
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 8, z: 10 }, { x: 18, z: 6 }, { x: 5, z: 9 }, { x: 12, z: 12 }],
};
