// 健身房 front shop: sports drinks, protein bars and powder, a shaker bar, and the weight machines on the west side.
import { MapDef, box } from './types.ts';
import { COFFEE_BOX, CORNER_PLANT, STD_FRONT, STD_SPAWNS } from './common.ts';

export const GYM: MapDef = {
  id: 'gym', name: '健身房', icon: '🏋', desc: '櫃台賣運動飲料、蛋白棒、高蛋白，旁邊就是器材區。有人一組做半小時、霸佔器材滑手機。',
  sign: { text: '鐵人健身 IRON GYM', bg: '#343a40' }, poster: ['器材請輪流', '一組不要做半小時'],
  theme: { floor: 'concrete', floorColor: [120, 124, 130], wall: 0xf1f3f5, wainscot: 0x343a40, accent: 0xfd7e14, counter: 0x343a40, shelf: 0x495057 },
  products: {
    drinks: { name: '運動飲料', price: 8, boxCost: 24, color: 0x22b8cf, palette: [0x22b8cf, 0xfd7e14, 0x94d82d], shape: 'bottle' },
    snacks: { name: '蛋白棒', price: 7, boxCost: 21, color: 0xa9e34b, palette: [0xa9e34b, 0x8d6e63, 0xfcc419], shape: 'box' },
    bento: { name: '高蛋白粉', price: 20, boxCost: 60, color: 0xfd7e14, palette: [0x212529, 0xfd7e14, 0xf8f9fa], shape: 'can' },
  },
  shelves: [
    { product: 'drinks', box: box(22.9, 2, 23.8, 7, 2.0, 'fridge') },
    { product: 'snacks', box: box(9, 3.4, 14, 4.3, 1.4, 'shelf') },
    { product: 'bento', box: box(0, 6.2, 0.9, 10.8, 1.8, 'wallshelf') },
  ],
  ...STD_FRONT,
  coffee: { food: '高蛋白飲', station: '搖搖杯台', verb: '搖一杯', icon: '🥤', price: 12, box: COFFEE_BOX },
  meal: null, foodChance: 0.35, goalScale: 1.1,
  decor: [
    box(3, 7.8, 4.4, 9, 0.9, 'treadmill'), box(3, 10.6, 4.4, 11.8, 0.9, 'bench'),
    box(6.2, 7.8, 7.6, 9, 0.9, 'bike'), box(6.2, 10.6, 7.6, 11.8, 0.9, 'dumbbells'), CORNER_PLANT,
  ],
  karens: ['benchhog'],
  campSpots: [{ x: 3.7, z: 9.6 }, { x: 6.9, z: 9.6 }, { x: 3.7, z: 12.4 }, { x: 6.9, z: 12.4 }],
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 5.3, z: 10.2 }, { x: 11, z: 8 }, { x: 18, z: 6 }, { x: 10, z: 12.5 }],
};
