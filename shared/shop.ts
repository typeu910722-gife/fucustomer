// 商城: cosmetics (bought with 薪資點數 earned by playing) and paid packs (store types for free play / own store /
// multiplayer, plus a supporter pack). No ads, no loot boxes, nothing that changes gameplay numbers.
// Real-money prices are display strings only (TBD: the store platform sets the final price); see docs/MONETIZATION.md.
// Pure data + functions so it can be unit-tested and shared by the client, the server and the simulation.
import type { CareerProfile } from './career.ts';

export type CosmeticSlot = 'hat' | 'uniform' | 'tag' | 'sign' | 'mat' | 'mascot';
/** What other players can see on your character (sent in create/join, shown in PlayerSnap). */
export type WearSlot = 'hat' | 'uniform' | 'tag';
export const WEAR_SLOTS: WearSlot[] = ['hat', 'uniform', 'tag'];
export const DECOR_SLOTS: CosmeticSlot[] = ['sign', 'mat', 'mascot'];

export const SLOT_INFO: Record<CosmeticSlot, { name: string; icon: string }> = {
  hat: { name: '帽子', icon: '🧢' }, uniform: { name: '圍裙', icon: '🦺' }, tag: { name: '名牌', icon: '📛' },
  sign: { name: '燈牌', icon: '💡' }, mat: { name: '地墊', icon: '🟥' }, mascot: { name: '櫃台公仔', icon: '🐱' },
};

export interface Cosmetic {
  id: string; name: string; icon: string; slot: CosmeticSlot; desc: string;
  /** Price in 薪資點數 (the career wallet). Omitted = premium only. */
  price?: number;
  /** Premium only: which pack grants it (bought with real money later). */
  pack?: string;
  /** Free reward, cannot be bought: a 常客奧客 arc id (regulars.ts), or `store:<level>` for a 店面等級 reward (progression.ts). */
  reward?: string;
  /** Main colour (UI preview + 3D). */
  color: number;
  /** Second colour (patterns, trims). */
  color2?: number;
}

const C = (c: Cosmetic) => c;
export const COSMETICS: Cosmetic[] = [
  // ---- hats ----
  C({ id: 'hat_cap', name: '紅色棒球帽', icon: '🧢', slot: 'hat', price: 300, color: 0xe03131, color2: 0xffffff, desc: '經典打工帽，帽簷可以擋奧客的口水' }),
  C({ id: 'hat_beanie', name: '毛線帽', icon: '🧶', slot: 'hat', price: 250, color: 0x5c940d, color2: 0xf8f9fa, desc: '大夜班冷氣太強必備' }),
  C({ id: 'hat_party', name: '派對尖帽', icon: '🥳', slot: 'hat', price: 400, color: 0xcc5de8, color2: 0xffd43b, desc: '慶祝今天沒有人要找店長' }),
  C({ id: 'hat_chef', name: '大廚高帽', icon: '👨‍🍳', slot: 'hat', price: 500, color: 0xffffff, color2: 0xff6b6b, desc: '很高，客人遠遠就知道你在哪' }),
  C({ id: 'hat_cat', name: '貓耳髮箍', icon: '🐱', slot: 'hat', price: 600, color: 0x343a40, color2: 0xffa8a8, desc: '奧客看到也會心軟一秒' }),
  C({ id: 'hat_crown', name: '紙皇冠', icon: '👑', slot: 'hat', price: 900, color: 0xfcc419, color2: 0xe03131, desc: '「顧客是皇帝」？今天你才是' }),
  C({ id: 'hat_gold', name: '金色店長帽', icon: '🎩', slot: 'hat', pack: 'pack_supporter', color: 0xfab005, color2: 0x1b1f3b, desc: '贊助者限定。謝謝你支持獨立小遊戲！' }),
  // ---- uniforms (apron colour / pattern) ----
  C({ id: 'uni_navy', name: '深藍圍裙', icon: '🟦', slot: 'uniform', price: 200, color: 0x364fc7, desc: '沉穩、耐髒、看起來很專業' }),
  C({ id: 'uni_pink', name: '粉紅圍裙', icon: '🩷', slot: 'uniform', price: 200, color: 0xf783ac, desc: '可愛到奧客不好意思兇你' }),
  C({ id: 'uni_black', name: '黑色圍裙', icon: '⬛', slot: 'uniform', price: 300, color: 0x2b2b33, desc: '咖啡廳師傅的氣場' }),
  C({ id: 'uni_stripe', name: '條紋圍裙', icon: '🍬', slot: 'uniform', price: 450, color: 0xe03131, color2: 0xffffff, desc: '紅白條紋，糖果店風' }),
  C({ id: 'uni_check', name: '格紋圍裙', icon: '🧺', slot: 'uniform', price: 450, color: 0x2f9e44, color2: 0xd3f9d8, desc: '野餐墊配色，麵包店最愛' }),
  C({ id: 'uni_dots', name: '點點圍裙', icon: '🟡', slot: 'uniform', price: 450, color: 0xfab005, color2: 0xffffff, desc: '黃底白點，很有精神' }),
  C({ id: 'uni_neon', name: '霓虹夜班圍裙', icon: '🌃', slot: 'uniform', pack: 'pack_nightlife', color: 0x1b1f3b, color2: 0x22b8cf, desc: '夜生活擴充包附贈。黑底霓虹線條' }),
  // ---- name tags ----
  C({ id: 'tag_wood', name: '木頭名牌', icon: '🪵', slot: 'tag', price: 150, color: 0xb07d48, color2: 0x5c3d1e, desc: '手作感，文青店必備' }),
  C({ id: 'tag_star', name: '星星名牌', icon: '⭐', slot: 'tag', price: 300, color: 0xffd43b, color2: 0xf08c00, desc: '名字前面多一顆星' }),
  C({ id: 'tag_heart', name: '愛心名牌', icon: '💗', slot: 'tag', price: 300, color: 0xff8fab, color2: 0xd6336c, desc: '服務業的笑容，貼在胸口' }),
  C({ id: 'tag_pro', name: '專業服務名牌', icon: '🎖', slot: 'tag', pack: 'pack_services', color: 0x1c7ed6, color2: 0xffffff, desc: '生活服務擴充包附贈' }),
  C({ id: 'tag_gold', name: '金色贊助名牌', icon: '🏅', slot: 'tag', pack: 'pack_supporter', color: 0xfab005, color2: 0xfff3bf, desc: '贊助者限定，證照上也會有金色徽章' }),
  // ---- store decorations (free play / own store) ----
  C({ id: 'sign_open', name: '「營業中」燈牌', icon: '💡', slot: 'sign', price: 350, color: 0xff6b6b, color2: 0xfff5f5, desc: '掛在門邊的霓虹燈牌' }),
  C({ id: 'sign_coffee', name: '咖啡杯燈牌', icon: '☕', slot: 'sign', price: 350, color: 0x22b8cf, color2: 0xe3fafc, desc: '藍色霓虹咖啡杯' }),
  C({ id: 'mat_welcome', name: '歡迎光臨地墊', icon: '🟥', slot: 'mat', price: 200, color: 0xc92a2a, color2: 0xffe3e3, desc: '門口的紅色地墊' }),
  C({ id: 'mat_paw', name: '貓掌地墊', icon: '🐾', slot: 'mat', price: 250, color: 0x845ef7, color2: 0xf3f0ff, desc: '踩上去心情會變好（大概）' }),
  C({ id: 'mascot_cat', name: '招財貓', icon: '🐱', slot: 'mascot', price: 500, color: 0xffffff, color2: 0xe03131, desc: '放在櫃台，揮手招客' }),
  C({ id: 'mascot_duck', name: '小黃鴨', icon: '🦆', slot: 'mascot', price: 300, color: 0xffd43b, color2: 0xf76707, desc: '櫃台上的療癒小鴨' }),
  // ---- 常客奧客 story rewards (free, granted when an arc ends; see shared/regulars.ts) ----
  C({ id: 'tag_points', name: '王阿姨的集點卡名牌', icon: '🎫', slot: 'tag', reward: 'auntie', color: 0xffa94d, color2: 0xe8590c, desc: '王阿姨用集點卡改的名牌，背面還有十個章' }),
  C({ id: 'sign_live', name: '「LIVE」直播燈牌', icon: '🔴', slot: 'sign', reward: 'kai', color: 0xff4d6d, color2: 0xffffff, desc: '直播主阿凱送的燈牌。開店就是開台' }),
  C({ id: 'uni_qc', name: '品管合格背心', icon: '✅', slot: 'uniform', reward: 'zhang', color: 0x2b8a3e, desc: '張伯在工廠穿了四十年的背心' }),
  C({ id: 'mascot_plug', name: '插頭公仔', icon: '🔌', slot: 'mascot', reward: 'vicky', color: 0xf8f9fa, color2: 0x495057, desc: 'Vicky 送的。每個奧客都有一個還沒找到插座的故事' }),
  C({ id: 'hat_lotto', name: '中獎紅包帽', icon: '🧧', slot: 'hat', reward: 'lotto', color: 0xe03131, color2: 0xfcc419, desc: '對獎阿公用三十年的發票紅包袋縫的。中兩百的運，分你一半' }),
  C({ id: 'tag_coin', name: '一元硬幣名牌', icon: '🪙', slot: 'tag', reward: 'meiling', color: 0xadb5bd, color2: 0xfab005, desc: '找零姐用小美第一天找的一塊錢做的。一塊都沒錯' }),
  C({ id: 'mascot_dragon', name: '塑膠袋神龍公仔', icon: '🐉', slot: 'mascot', reward: 'bags', color: 0x40c057, color2: 0xfab005, desc: '袋子伯「奧客退散」展的迷你版。全身都是你們店的袋子' }),
  C({ id: 'uni_love', name: '情侶款圍裙', icon: '💞', slot: 'uniform', reward: 'couple', color: 0xf06595, color2: 0xffffff, desc: '網紅情侶拍第一支影片時穿的。分過手，也和好過' }),
  // ---- 店面等級 rewards (free, granted when any of your stores reaches the level; see shared/progression.ts) ----
  C({ id: 'sign_local', name: '「在地推薦」燈牌', icon: '🪧', slot: 'sign', reward: 'store:3', color: 0x51cf66, color2: 0xebfbee, desc: '店面 Lv3 獎勵。里長親自掛上去的（他堅持）' }),
  C({ id: 'mat_carpet', name: '排隊名店紅地毯', icon: '🟥', slot: 'mat', reward: 'store:6', color: 0xa61e4d, color2: 0xfab005, desc: '店面 Lv6 獎勵。每位客人進門都像走星光大道' }),
  C({ id: 'mascot_trophy', name: '金獎盃公仔', icon: '🏆', slot: 'mascot', reward: 'store:8', color: 0xfab005, color2: 0x5c3d1e, desc: '店面 Lv8 獎勵。「年度最耐奧店家」，評審是你自己' }),
  C({ id: 'sign_legend', name: '「傳說名店」金色燈牌', icon: '🌟', slot: 'sign', reward: 'store:10', color: 0xfab005, color2: 0xfff3bf, desc: '店面 Lv10 獎勵。傳說的證明，奧客看到會先排好隊' }),
  C({ id: 'mascot_cactus', name: '小仙人掌', icon: '🌵', slot: 'mascot', price: 250, color: 0x40c057, color2: 0xe8590c, desc: '很好養，比奧客好溝通' }),
];
export const COSMETIC_BY_ID: Record<string, Cosmetic> = Object.fromEntries(COSMETICS.map(c => [c.id, c]));
export const getCosmetic = (id: string | null | undefined): Cosmetic | null => (id ? COSMETIC_BY_ID[id] ?? null : null);

/** Paid packs (real money, later). `stores` = map ids that need the pack for free play / own store / hosting multiplayer. */
export interface Pack {
  id: string; name: string; icon: string; desc: string;
  stores: string[];
  /** Cosmetic ids that come with the pack. */
  items: string[];
  /** Display only — final price is whatever the store platform shows. TBD. */
  price: string;
}
export const PRICE_NOTE = '價格未定，以上架平台顯示為準';
export const PACKS: Pack[] = [
  { id: 'pack_nightlife', name: '夜生活擴充包', icon: '🌃', desc: '電影院、火鍋吃到飽、加油站、健身房、牛排館：自由營業、自己開店、多人開房都能選。附贈霓虹夜班圍裙。', stores: ['cinema', 'hotpot', 'gas', 'gym', 'steak'], items: ['uni_neon'], price: 'NT$90（暫定，以上架平台為準）' },
  { id: 'pack_services', name: '生活服務擴充包', icon: '🏥', desc: '3C 賣場、美髮院、郵局、藥局、飯店：自由營業、自己開店、多人開房都能選。附贈專業服務名牌。', stores: ['electronics', 'salon', 'post', 'pharmacy', 'hotel'], items: ['tag_pro'], price: 'NT$90（暫定，以上架平台為準）' },
  { id: 'pack_supporter', name: '贊助者包', icon: '💛', desc: '支持開發！金色贊助名牌＋金色店長帽，高級社畜證照會出現金色贊助徽章。不影響遊戲平衡。', stores: [], items: ['tag_gold', 'hat_gold'], price: 'NT$150（暫定，以上架平台為準）' },
];
export const PACK_BY_ID: Record<string, Pack> = Object.fromEntries(PACKS.map(p => [p.id, p]));
/** Stores that are always free in every mode (the original five + the chapter-8 stores). */
export const FREE_STORES = ['convenience', 'breakfast', 'boba', 'clothing', 'chicken', 'drugstore', 'bookstore', 'bakery', 'supermarket', 'petshop', 'cafe'];

/** The pack a store type belongs to, or null when it is free. */
export function packForStore(mapId: string): Pack | null { return PACKS.find(p => p.stores.includes(mapId)) ?? null; }

/**
 * Where a store is played. The career main story (and its daily challenge), raiding a friend's store and joining
 * someone else's room are always free; only free play, your own store and hosting a multiplayer room need the pack.
 */
export type PlayMode = 'story' | 'daily' | 'free' | 'own' | 'host' | 'joinRoom' | 'raid';
export function storeLocked(mapId: string, mode: PlayMode, entitlements: readonly string[]): Pack | null {
  if (mode !== 'free' && mode !== 'own' && mode !== 'host') return null;
  const pack = packForStore(mapId);
  return pack && !entitlements.includes(pack.id) ? pack : null;
}

// ---------------- profile state ----------------
export type Loadout = Partial<Record<CosmeticSlot, string>>;
export interface ShopState {
  /** Cosmetics bought with 薪資點數. Pack items are not listed here; they come from `entitlements`. */
  owned: string[];
  equipped: Loadout;
  /** Pack ids bought with real money (granted only by a platform purchase/restore). */
  entitlements: string[];
}
export function newShop(): ShopState { return { owned: [], equipped: {}, entitlements: [] }; }

export function sanitizeShop(v: unknown): ShopState {
  const s = newShop();
  if (!v || typeof v !== 'object') return s;
  const o = v as Partial<ShopState>;
  // points items and story rewards (premium pack items come from entitlements, never from this list)
  if (Array.isArray(o.owned)) s.owned = [...new Set(o.owned.filter((id): id is string => typeof id === 'string' && (getCosmetic(id)?.price !== undefined || !!getCosmetic(id)?.reward)))];
  if (Array.isArray(o.entitlements)) s.entitlements = [...new Set(o.entitlements.filter((id): id is string => typeof id === 'string' && !!PACK_BY_ID[id]))];
  if (o.equipped && typeof o.equipped === 'object') {
    for (const [slot, id] of Object.entries(o.equipped)) {
      const c = typeof id === 'string' ? getCosmetic(id) : null;
      // premium items stay equipped even without the pack right now (e.g. a QA unlock); effectiveLoadout() filters them
      if (c && c.slot === slot) s.equipped[c.slot] = c.id;
    }
  }
  return s;
}

/** Does the player have this cosmetic (bought with points, or through a pack)? */
export function ownsCosmetic(p: CareerProfile, id: string, entitlements: readonly string[] = p.shop.entitlements): boolean {
  const c = getCosmetic(id); if (!c) return false;
  return c.pack ? entitlements.includes(c.pack) : p.shop.owned.includes(id);
}

export type BuyResult = { ok: true } | { ok: false; why: 'unknown' | 'premium' | 'owned' | 'poor' | 'story' };
/** Buys a points-priced cosmetic with the career wallet (薪資點數). Premium items can't be bought this way. */
export function buyCosmetic(p: CareerProfile, id: string): BuyResult {
  const c = getCosmetic(id);
  if (!c) return { ok: false, why: 'unknown' };
  if (c.reward) return { ok: false, why: 'story' };
  if (c.price === undefined) return { ok: false, why: 'premium' };
  if (p.shop.owned.includes(id)) return { ok: false, why: 'owned' };
  if (p.wallet < c.price) return { ok: false, why: 'poor' };
  p.wallet -= c.price; p.shop.owned.push(id);
  return { ok: true };
}

/** Equips an owned cosmetic in its slot (null id + slot = take off). */
export function equipCosmetic(p: CareerProfile, id: string | null, slot?: CosmeticSlot, entitlements: readonly string[] = p.shop.entitlements): boolean {
  if (id === null) { if (!slot) return false; delete p.shop.equipped[slot]; return true; }
  const c = getCosmetic(id);
  if (!c || !ownsCosmetic(p, id, entitlements)) return false;
  p.shop.equipped[c.slot] = c.id;
  return true;
}

/** What is actually worn/placed: equipped items the player really has. */
export function effectiveLoadout(p: CareerProfile, entitlements: readonly string[] = p.shop.entitlements): Loadout {
  const out: Loadout = {};
  for (const [slot, id] of Object.entries(p.shop.equipped)) if (id && ownsCosmetic(p, id, entitlements)) out[slot as CosmeticSlot] = id;
  return out;
}

/** Wearables sent to other players. */
export type Outfit = Partial<Record<WearSlot, string>>;
export function outfitOf(l: Loadout): Outfit {
  const o: Outfit = {};
  for (const s of WEAR_SLOTS) if (l[s]) o[s] = l[s];
  return o;
}
/** Server-side check of an outfit received from a client: known ids in the right slot, nothing else. */
export function sanitizeOutfit(v: unknown): Outfit | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o: Outfit = {};
  for (const s of WEAR_SLOTS) {
    const id = (v as Record<string, unknown>)[s];
    const c = typeof id === 'string' ? getCosmetic(id) : null;
    if (c && c.slot === s) o[s] = c.id;
  }
  return Object.keys(o).length ? o : undefined;
}

/** Supporter badge on the licence card. */
export const isSupporter = (entitlements: readonly string[]) => entitlements.includes('pack_supporter');
