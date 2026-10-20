// Game-wide tuning values shared by server, solo simulation and client.
import { SIG_KARENS, SIG_KINDS, type SigKind } from './sigkarens.ts';

export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 5;
/** 電腦店員補位 (multiplayer lobby option): at most this many server-run bots fill free slots. */
export const MAX_FILL_BOTS = 2;
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

export type Product = 'drinks' | 'snacks' | 'bento' | 'extra';
/** Every product slot. 'extra' is an optional fourth line that only some maps stock (MapDef.products.extra). */
export const ALL_PRODUCTS: Product[] = ['drinks', 'snacks', 'bento', 'extra'];
/** Product lines of the active map. Live: map.ts applyMap() adds 'extra' on maps that sell a fourth line. */
export const PRODUCTS: Product[] = ['drinks', 'snacks', 'bento'];
/** Stock levels given as input (shift starts, saves): the optional 'extra' line defaults to the drinks level. */
export type StockIn = Record<Exclude<Product, 'extra'>, number> & { extra?: number };

export const PRODUCT_INFO: Record<Product, { name: string; price: number; boxCost: number; color: number }> = {
  drinks: { name: '飲料', price: 8, boxCost: 24, color: 0x3fa7f5 },
  snacks: { name: '零食', price: 6, boxCost: 18, color: 0xf5b83f },
  bento: { name: '便當', price: 14, boxCost: 42, color: 0x7bd36a },
  extra: { name: '飲料', price: 8, boxCost: 24, color: 0x3fa7f5 },
};
/** Prepared food: names and prices come from the active map (see map.ts applyMap). */
export const FOOD_INFO = {
  coffee: { name: '咖啡', station: '咖啡機', verb: '煮咖啡', icon: '☕', price: 10 },
  meal: { name: '熱便當', station: '微波爐', verb: '加熱便當', icon: '🍱', price: 18, uses: '便當' },
};
export const BOX_SIZE = 6;
/** Seconds a shelf may stand empty before customers who find it bare cost rating/chaos (they only grumble before that). */
export const EMPTY_SHELF_GRACE = 10;
export const COFFEE_PRICE = 10;
export const MEAL_PRICE = 18;
export const BURST_MAX = 100;
export const CHAOS_MAX = 100;

export type UpgradeId = 'register2' | 'scanner' | 'coffee' | 'shelves' | 'camera' | 'mopbot' | 'ads' | 'selfcheck' | 'mat' | 'doorbell' | 'lounge';
export interface UpgradeDef {
  name: string; desc: string; costs: number[]; icon: string;
  /** What each level does (index = level - 1), shown in the between-days upgrade panel. */
  levels?: string[];
}
export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  register2: { icon: '🧾', name: '第二收銀台', desc: '開放第二台收銀機，隊伍消化更快', costs: [300] },
  scanner: { icon: '📟', name: '快速掃碼機', desc: '結帳時間縮短', costs: [180, 320] },
  coffee: { icon: '☕', name: '咖啡機升級', desc: '煮咖啡時間縮短', costs: [200, 360] },
  shelves: { icon: '🧊', name: '加大貨架／大冰箱', desc: '每個貨架可放更多商品', costs: [220, 400], levels: ['每格貨架 +5（15 個）', '每格貨架 +10（20 個）'] },
  camera: { icon: '📹', name: '監視器', desc: '偷吃奧客現形、怒氣上升較慢；在自己的店出手被報警時，畫面就是證據（佔理多半不起訴；先動手的話……監視器很誠實）', costs: [350, 520], levels: ['偷吃奧客現形、怒氣上升 -30%、正當防衛 60% 直接不起訴', '再加：安撫／勸導速度 +25%、不起訴 80%、法庭可「播放全程錄影」'] },
  mopbot: { icon: '🤖', name: '掃地機器人', desc: '每隔一段時間自動清掉一灘髒污', costs: [420] },
  ads: { icon: '🪧', name: '廣告看板', desc: '顧客來店頻率提高', costs: [160, 300, 480] },
  selfcheck: { icon: '🏧', name: '自助結帳機', desc: '排隊中買 2 件以下的客人會自己去自助結帳（沒有小費）', costs: [380, 600], levels: ['每 22 秒自助結帳一位', '每 14 秒自助結帳一位'] },
  mat: { icon: '🟫', name: '防滑地墊', desc: '客人打翻東西時比較不會弄髒地板', costs: [150, 280], levels: ['髒污 -25%', '髒污 -40%'] },
  doorbell: { icon: '🔔', name: '自動門鈴', desc: '「叮咚～歡迎光臨」客人進門心情比較好、比較有耐心', costs: [200, 360], levels: ['一般客人耐心 +8%、心情 +8', '一般客人耐心 +16%、心情 +16'] },
  lounge: { icon: '🛋', name: '員工休息室', desc: '店員（小陳／電腦店員）動作更快；自己開店時員工每天心情 +3', costs: [260, 450], levels: ['店員移動 +8%', '店員移動 +16%'] },
};
export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

export function shelfCapacity(level: number) { return 10 + level * 5; }
/** 防滑地墊: share of spills that never happen (capped at 40%). */
export function matSkip(level: number) { return Math.min(0.4, [0, 0.25, 0.4][level] ?? 0.4); }
/** 自助結帳機: seconds between self-checkouts (0 = no machine). */
export function selfcheckEvery(level: number) { return level <= 0 ? 0 : level === 1 ? 22 : 14; }
/** 自動門鈴: patience multiplier and mood bonus for ordinary customers. */
export function doorbellBoost(level: number) { const l = Math.max(0, Math.min(2, level)); return { patience: 1 + 0.08 * l, mood: 8 * l }; }
/** 員工休息室: movement multiplier for clerk bots (小陳 / fill-in bots). */
export function loungePace(level: number) { return 1 + 0.08 * Math.max(0, Math.min(2, level)); }
/** 監視器 level 2: calming / talking actions are this much faster. */
export function cameraCalm(level: number) { return level >= 2 ? 1.25 : 1; }
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

/** Preset callouts / emotes (no free text): keys 1–8, the T / View wheel. Index = the wire value of a 'quick' message. */
export const QUICK_MESSAGES = ['需要支援收銀！', '我去補貨', '奧客在門口！', '幫我開門', '謝啦！', '讚！', '哭啊…', '下班囉～'];
/** Icon shown in the wheel and in the bubble over the sender (same order as QUICK_MESSAGES). */
export const QUICK_ICONS = ['🧾', '📦', '🚨', '🚪', '🙏', '👍', '😭', '🌙'];
/** Server-side emote limit per player: at most QUICK_BURST messages in QUICK_WINDOW_MS, and QUICK_MIN_GAP_MS apart. */
export const QUICK_BURST = 3, QUICK_WINDOW_MS = 6000, QUICK_MIN_GAP_MS = 600;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
