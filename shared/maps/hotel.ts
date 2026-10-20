// 飯店櫃台: the lobby — water and souvenirs, a welcome-tea urn, lobby tables and big plants.
import { MapDef, box } from './types.ts';
import { COFFEE_BOX, CORNER_PLANT, STD_FRONT, STD_SPAWNS } from './common.ts';

export const HOTEL: MapDef = {
  id: 'hotel', name: '飯店櫃台', icon: '🏨', desc: '飯店大廳的櫃台和小賣店：礦泉水、伴手禮、紀念品，迎賓茶現泡。總有人硬要免費升等。',
  sign: { text: '晶華大飯店 GRAND', bg: '#5f3dc4' }, poster: ['今日客滿', '恕無升等'],
  theme: { floor: 'tile', floorColor: [230, 222, 206], wall: 0xfff9db, wainscot: 0x5f3dc4, accent: 0xfab005, counter: 0x5c3d2e, shelf: 0x8d6e63 },
  products: {
    drinks: { name: '礦泉水', price: 6, boxCost: 18, color: 0x74c0fc, palette: [0xd0ebff, 0x74c0fc, 0xf8f9fa], shape: 'bottle' },
    snacks: { name: '伴手禮', price: 16, boxCost: 48, color: 0xe03131, palette: [0xe03131, 0xfab005, 0xf8f9fa], shape: 'box' },
    bento: { name: '紀念品', price: 20, boxCost: 60, color: 0x5f3dc4, palette: [0x5f3dc4, 0xfab005, 0x20c997], shape: 'bag' },
  },
  shelves: [
    { product: 'drinks', box: box(22.9, 2, 23.8, 6, 2.0, 'fridge') },
    { product: 'snacks', box: box(8.5, 4, 14, 4.9, 1.3, 'shelf') },
    { product: 'bento', box: box(0, 6.2, 0.9, 10.8, 1.8, 'wallshelf') },
  ],
  ...STD_FRONT,
  coffee: { food: '迎賓茶', station: '茶水台', verb: '泡迎賓茶', icon: '🍵', price: 8, box: COFFEE_BOX },
  meal: null, foodChance: 0.3, goalScale: 1.2,
  decor: [box(3.4, 8.4, 4.6, 9.6, 0.75, 'table'), box(3.4, 11, 4.6, 12.2, 0.75, 'table'), box(0.2, 14.2, 0.9, 15.4, 1.3, 'plant'), box(6.4, 14.4, 7.2, 15.2, 1.3, 'plant'), CORNER_PLANT],
  karens: ['upgrader'],
  playerSpawns: STD_SPAWNS,
  wander: [{ x: 7, z: 10 }, { x: 18, z: 6 }, { x: 5.5, z: 13 }, { x: 12, z: 12 }],
};
