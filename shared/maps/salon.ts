// 美髮院: hair products on the walls, a shampoo basin and a styling chair behind the counter, a waiting bench.
// "Prepared food" here is a service: 洗頭 and 剪髮造型 (the customer waits at the pickup spot for it).
import { MapDef, box } from './types.ts';
import { COFFEE_BOX, CORNER_PLANT, MEAL_BOX, STD_FRONT, STD_SPAWNS } from './common.ts';

export const SALON: MapDef = {
  id: 'salon', name: '美髮院', icon: '💇', desc: '洗頭、剪髮造型要現做，順便賣洗髮精和髮蠟。有人會拿明星照片說要一模一樣。',
  sign: { text: '剪刀手 HAIR', bg: '#7048e8' }, poster: ['照片僅供參考', '臉型因人而異'],
  theme: { floor: 'tile', floorColor: [236, 232, 244], wall: 0xf3f0ff, wainscot: 0x9775fa, accent: 0x7048e8, counter: 0x212529, shelf: 0xd0bfff },
  products: {
    drinks: { name: '洗髮精', price: 12, boxCost: 36, color: 0x9775fa, palette: [0xe5dbff, 0x9775fa, 0x63e6be, 0xffffff], shape: 'bottle' },
    snacks: { name: '護髮膜', price: 9, boxCost: 27, color: 0x63e6be, palette: [0x96f2d7, 0xffc9c9, 0xffec99], shape: 'box' },
    bento: { name: '髮蠟', price: 11, boxCost: 33, color: 0x495057, palette: [0x343a40, 0xf08c00, 0x868e96], shape: 'box' },
  },
  shelves: [
    { product: 'drinks', box: box(22.9, 2, 23.8, 7.6, 2.0, 'wallshelf') },
    { product: 'snacks', box: box(8.5, 4.2, 13.5, 5.1, 1.4, 'shelf') },
    { product: 'bento', box: box(0, 6.2, 0.9, 10.8, 1.8, 'wallshelf') },
  ],
  ...STD_FRONT,
  coffee: { food: '洗頭', station: '洗頭台', verb: '洗頭', icon: '🚿', price: 14, box: COFFEE_BOX },
  meal: { food: '剪髮造型', station: '造型椅', verb: '剪頭髮', icon: '✂️', price: 26, uses: '髮蠟', box: MEAL_BOX },
  foodChance: 0.6, goalScale: 1.4,
  decor: [box(3, 8, 7.5, 8.5, 0.9, 'bar'), box(5.6, 13.6, 6.4, 14.4, 1.8, 'mannequin'), box(7.6, 13.6, 8.4, 14.4, 1.8, 'mannequin'), CORNER_PLANT],
  karens: ['photo'],
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 5, z: 10 }, { x: 11, z: 8 }, { x: 18, z: 6 }, { x: 10, z: 12.5 }],
};
