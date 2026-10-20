// 牛排館: self-serve soup and bread bar, a griddle and a tea urn behind the counter, four tables.
import { MapDef, box } from './types.ts';
import { COFFEE_BOX, CORNER_PLANT, MEAL_BOX, STD_FRONT, STD_SPAWNS, westTables, WEST_TABLE_SPOTS } from './common.ts';

export const STEAK: MapDef = {
  id: 'steak', name: '牛排館', icon: '🥩', desc: '平價牛排館：鐵板現煎，濃湯麵包自助。總有人說「這哪是五分熟」。',
  sign: { text: '鐵板王 STEAK HOUSE', bg: '#862e9c' }, poster: ['五分熟', '就是五分熟'],
  theme: { floor: 'wood', floorColor: [150, 104, 78], wall: 0xfff4e6, wainscot: 0x862e9c, accent: 0xe8590c, counter: 0x5c3d2e, shelf: 0x8d6e63 },
  products: {
    drinks: { name: '瓶裝飲料', price: 7, boxCost: 21, color: 0x1c7ed6, palette: [0x1c7ed6, 0xe03131, 0xfab005], shape: 'bottle' },
    snacks: { name: '濃湯麵包', price: 6, boxCost: 18, color: 0xe8b04b, palette: [0xe8b04b, 0xffe8a1, 0xc68642], shape: 'box' },
    bento: { name: '冷凍牛排', price: 16, boxCost: 48, color: 0xc92a2a, palette: [0xc92a2a, 0xffa8a8, 0x862e9c], shape: 'flat' },
  },
  shelves: [
    { product: 'drinks', box: box(22.9, 2, 23.8, 7, 2.0, 'fridge') },
    { product: 'snacks', box: box(8.5, 4.2, 13.5, 5.1, 1.3, 'shelf') },
    { product: 'bento', box: box(0, 6.2, 0.9, 10.6, 1.8, 'fridge') },
  ],
  ...STD_FRONT,
  coffee: { food: '紅茶', station: '紅茶桶', verb: '倒紅茶', icon: '🥤', price: 6, box: COFFEE_BOX },
  meal: { food: '鐵板牛排', station: '鐵板', verb: '煎牛排', icon: '🥩', price: 28, uses: '冷凍牛排', box: MEAL_BOX },
  foodChance: 0.7, goalScale: 1.05,
  decor: [...westTables('dining'), CORNER_PLANT],
  karens: ['doneness'],
  campSpots: WEST_TABLE_SPOTS,
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 5.4, z: 9.3 }, { x: 11, z: 9 }, { x: 18, z: 6 }, { x: 10, z: 12.5 }],
};
