// Game-wide tuning values shared by server, solo simulation and client.
import { SIG_KARENS, SIG_KINDS, type SigKind } from './sigkarens.ts';

export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 5;
export const TICK_RATE = 20; // simulation ticks per second
export const SNAPSHOT_RATE = 12; // snapshots per second sent to clients
export const INPUT_RATE = 15; // client position updates per second

export const PLAYER_RADIUS = 0.3;
export const WALK_SPEED = 3.6;
export const RUN_SPEED = 5.6;
export const INTERACT_RANGE = 2.1; // client-side targeting range
export const SERVER_INTERACT_RANGE = 2.8; // server tolerance (latency slack)
export const EYE_HEIGHT = 1.62;

export const RECONNECT_GRACE_GAME_S = 120;
export const RECONNECT_GRACE_LOBBY_S = 45;

export type Product = 'drinks' | 'snacks' | 'bento';
export const PRODUCTS: Product[] = ['drinks', 'snacks', 'bento'];

export const PRODUCT_INFO: Record<Product, { name: string; price: number; boxCost: number; color: number }> = {
  drinks: { name: '飲料', price: 8, boxCost: 24, color: 0x3fa7f5 },
  snacks: { name: '零食', price: 6, boxCost: 18, color: 0xf5b83f },
  bento: { name: '便當', price: 14, boxCost: 42, color: 0x7bd36a },
};
/** Prepared food: names and prices come from the active map (see map.ts applyMap). */
export const FOOD_INFO = {
  coffee: { name: '咖啡', station: '咖啡機', verb: '煮咖啡', icon: '☕', price: 10 },
  meal: { name: '熱便當', station: '微波爐', verb: '加熱便當', icon: '🍱', price: 18, uses: '便當' },
};
export const BOX_SIZE = 6;
export const COFFEE_PRICE = 10;
export const MEAL_PRICE = 18;
export const BURST_MAX = 100;
export const CHAOS_MAX = 100;

export type UpgradeId = 'register2' | 'scanner' | 'coffee' | 'shelves' | 'camera' | 'mopbot' | 'ads';
export interface UpgradeDef { name: string; desc: string; costs: number[] }
export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  register2: { name: '第二收銀台', desc: '開放第二台收銀機，隊伍消化更快', costs: [300] },
  scanner: { name: '快速掃碼機', desc: '結帳時間縮短', costs: [180, 320] },
  coffee: { name: '咖啡機升級', desc: '煮咖啡時間縮短', costs: [200, 360] },
  shelves: { name: '加大貨架', desc: '每個貨架可放更多商品', costs: [220, 400] },
  camera: { name: '監視器', desc: '偷吃奧客直接顯示，奧客怒氣上升較慢', costs: [350] },
  mopbot: { name: '掃地機器人', desc: '每隔一段時間自動清掉一灘髒污', costs: [420] },
  ads: { name: '廣告看板', desc: '顧客來店頻率提高', costs: [160, 300, 480] },
};
export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

export function shelfCapacity(level: number) { return 10 + level * 5; }
export function checkoutTime(level: number) { return [1.4, 0.95, 0.6][level] ?? 0.6; }
export function brewTime(level: number) { return [3.0, 2.0, 1.2][level] ?? 1.2; }
export function heatTime(level: number) { return [4.0, 2.8, 1.8][level] ?? 1.8; }

export const DAY_OPEN_SECONDS = 300; // real seconds for 08:00 → 22:00
export const OPEN_MINUTE = 8 * 60;
export const CLOSE_MINUTE = 22 * 60;
export const PREP_SECONDS = 60;
export const CLOSING_MAX_SECONDS = 60;
export const DAILY_RENT = 60;

export type KarenKind = 'cutter' | 'rager' | 'streamer' | 'hog' | 'litterer' | 'charger' | 'custom' | 'fickle' | 'tryhard' | 'boss' | SigKind;
const BASE_KAREN_INFO: Record<Exclude<KarenKind, SigKind>, { name: string; hint: string; how: string }> = {
  cutter: { name: '插隊奧客', hint: '有人插隊！其他顧客耐心快速下降', how: '靠近按互動「請排隊」' },
  rager: { name: '退貨大鬧', hint: '客訴怒氣上升中！滿了會砸店', how: '互動「安撫」（可多人同時），或次要鍵發折價券 $30' },
  streamer: { name: '直播亂拍', hint: '直播客到處拍片撞翻商品，會躲人', how: '追上並互動「請停止拍攝」' },
  hog: { name: '偷吃奧客', hint: '有人在貨架偷吃！（監視器可直接看見）', how: '靠近互動「請先結帳」' },
  litterer: { name: '亂丟客', hint: '有人邊走邊亂丟垃圾，髒污越來越多', how: '靠近互動「請勿亂丟」，或直接請出門' },
  charger: { name: '充電霸王', hint: '有人霸佔門口插座充電，電費一直跳、店裡越來越亂', how: '互動「拔插頭」（要拔兩次），或拿咖啡給他「請他喝咖啡」讓他開心離開' },
  custom: { name: '客製魔人', hint: '到了收銀台還一直改單：不加蛋、換醬、改內用……後面的人都卡住了', how: '靠近互動「複誦點單」讓他確認一次，就能正常結帳' },
  fickle: { name: '改單達人', hint: '飲料做好了又要改甜度冰塊，一杯接一杯', how: '再做一杯給他（第二杯就收），或互動「推薦招牌」讓他直接決定' },
  tryhard: { name: '試穿狂', hint: '霸佔試衣間試穿一大堆，衣服丟得到處都是', how: '靠近互動「限試穿 3 件」，他就會挑一件去結帳' },
  boss: { name: '奧客之王', hint: '傳說中的奧客之王駕到！他會分階段鬧事', how: '依階段處理：請排隊→安撫→制止拍攝→清掉小弟→丟出門或全店退散' },
};
/** Every karen's name, warning and how to handle it (store-signature karens come from sigkarens.ts). */
export const KAREN_INFO = {
  ...BASE_KAREN_INFO,
  ...Object.fromEntries(SIG_KINDS.map(k => [k, { name: SIG_KARENS[k].name, hint: SIG_KARENS[k].hint, how: SIG_KARENS[k].how }])),
} as Record<KarenKind, { name: string; hint: string; how: string }>;

export const BOSS_PHASES = ['', '插隊霸王', '退貨暴君', '直播帝王', '召喚小弟', '強弩之末'];
export const BOSS_HOW = ['', '靠近按互動「請排隊」（或丟出門）', '持續安撫到怒氣歸零（或丟出門）', '追上制止拍攝 2 次（或丟出門）', '先處理掉他叫來的小弟', '抓起丟出門，或全店退散收尾！'];

export const PLAYER_COLORS = [0xff6b6b, 0x4dabf7, 0x51cf66, 0xfcc419, 0xcc5de8];

export const QUICK_MESSAGES = ['需要支援收銀！', '我去補貨', '奧客出現！', '我去清潔', '收到！', '幫我顧櫃台'];

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
