// 電影院 lobby: popcorn machine and hot-dog grill, soda fridge, candy island, rows of waiting seats.
import { MapDef, box } from './types.ts';
import { COFFEE_BOX, CORNER_PLANT, MEAL_BOX, STD_FRONT, STD_SPAWNS } from './common.ts';

export const CINEMA: MapDef = {
  id: 'cinema', name: '電影院', icon: '🎬', desc: '電影院大廳的賣店：爆米花、熱狗現做，等候區一排排座位。有人一坐下就開始踢椅背。',
  sign: { text: '星光影城 CINEMA', bg: '#212529' }, poster: ['請勿錄影', '請勿踢椅背'],
  theme: { floor: 'tile', floorColor: [92, 60, 70], wall: 0x2b2d42, wainscot: 0xc92a2a, accent: 0xfcc419, counter: 0xc92a2a, shelf: 0x495057 },
  products: {
    drinks: { name: '汽水', price: 8, boxCost: 24, color: 0xe03131, palette: [0xe03131, 0x1c7ed6, 0xfcc419, 0xf8f9fa], shape: 'cup' },
    snacks: { name: '零嘴糖果', price: 6, boxCost: 18, color: 0xf783ac, palette: [0xf783ac, 0xfcc419, 0x74c0fc, 0x8ce99a], shape: 'box' },
    bento: { name: '熱狗麵包', price: 9, boxCost: 27, color: 0xe8590c, palette: [0xffd8a8, 0xe8590c, 0xfff3bf], shape: 'flat' },
  },
  shelves: [
    { product: 'drinks', box: box(22.9, 2, 23.8, 7, 2.0, 'fridge') },
    { product: 'snacks', box: box(8.5, 4.2, 13.5, 5.1, 1.3, 'shelf') },
    { product: 'bento', box: box(0, 6.2, 0.9, 10.6, 1.8, 'fridge') },
  ],
  ...STD_FRONT,
  coffee: { food: '爆米花', station: '爆米花機', verb: '爆一桶', icon: '🍿', price: 12, box: COFFEE_BOX },
  meal: { food: '熱狗', station: '熱狗機', verb: '烤熱狗', icon: '🌭', price: 14, uses: '熱狗麵包', box: MEAL_BOX },
  foodChance: 0.65, goalScale: 0.9,
  decor: [box(13.8, 14.7, 16.6, 15.2, 0.6, 'bar'), box(3, 8.2, 8, 8.7, 0.6, 'bar'), box(3, 11.2, 8, 11.7, 0.6, 'bar'), CORNER_PLANT],
  karens: ['kicker'],
  campSpots: [{ x: 14.6, z: 14.1 }, { x: 15.9, z: 14.1 }, { x: 5, z: 9.3 }, { x: 6.8, z: 12.3 }],
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 5.5, z: 10 }, { x: 11, z: 8 }, { x: 18, z: 6 }, { x: 9.5, z: 13 }],
};
