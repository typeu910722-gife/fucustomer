// Store-signature karens ("招牌奧客"): every store type has its own karen. They are data on top of a few
// behaviour templates implemented in sim.ts (sigSpawn / sigUpdate / sigAct), so adding one is mostly writing an entry here.
//
// Templates (what the karen does → how you deal with it):
//   till   – shops normally, then blocks the register at checkout until you do the action (maybe holding an item)
//   haggle – blocks the register and argues; his heat climbs by itself, each "hold firm" press cools him down,
//            or give in with the alternative (costs money). Heat 100 = he makes a scene
//   camp   – walks to a spot (a shelf or one of the map's campSpots) and squats there; a periodic effect hurts the store
//   roam   – wanders from shelf to shelf with a periodic effect (optionally runs away from you like the 直播客)
//   redo   – waits for prepared food and rejects the first deliveries; an explanation action settles it
//   sneak  – hidden until you are close (like 偷吃奧客): stuffs goods into a bag; if he gets away the store pays
//   refund – stands at the service desk demanding a refund for something he broke; inspect it or just refund
// Effects (every `every` seconds while active, also +1 chaos): stock = takes an item off a shelf, mess = a spill,
// money = costs the till `drain`, aura = customers near him lose patience faster, queue = everyone in line does.

export type SigTpl = 'till' | 'haggle' | 'camp' | 'roam' | 'redo' | 'sneak' | 'refund';
export type SigNeed = 'mop' | 'coffee' | 'meal' | 'box';
export type SigEffect = 'stock' | 'mess' | 'money' | 'aura' | 'queue';

export interface SigKarenDef {
  name: string; icon: string;
  /** Warning toast / intro card text, and the "how to handle" line (intro card, help screen, alert bar). */
  hint: string; how: string;
  /** Short overhead label, e.g. "🧴 狂用試用品". */
  tag: string;
  tpl: SigTpl;
  /** Main action label (ActKind 'sigAct'), how many times it must be done, channel seconds per press. */
  act: string; presses?: number; dur?: number;
  /** The main action only works while holding this (consumed unless it is the mop). */
  need?: SigNeed;
  /** Optional second choice (ActKind 'sigAlt'): label, item it needs (consumed) and/or money it costs. */
  alt?: string; altNeed?: 'coffee' | 'meal'; altCost?: number;
  /** Seconds he keeps it up before the store loses (default 70). */
  life?: number;
  every?: number; effects?: SigEffect[]; drain?: number; aura?: number;
  /** camp/sneak: where to squat (default 'camp' = the map's campSpots). sit = sits down there. */
  spot?: 'shelf' | 'camp'; sit?: boolean;
  /** After a non-final press he moves on to another spot (you have to find him again). */
  relocate?: boolean;
  /** roam: runs away when a worker comes close. */
  flee?: boolean;
  /** Only visible within 4 m (or with the CCTV upgrade). */
  hidden?: boolean;
  /** After being handled he buys something and queues to pay. */
  buys?: boolean;
  /** redo: which prepared food he wants and how many deliveries he rejects. */
  food?: 'coffee' | 'meal'; rejects?: number;
  /** haggle: starting heat, heat per second, heat removed per press. */
  heat?: number; heatRate?: number; heatDrop?: number;
  /** Money lost if he gets his way (refund forced / bag walks out). */
  failMoney?: number;
  /** Toasts: after each non-final press (`{n}` = presses left), on success, on failure. */
  step?: string; ok: string; fail: string;
  /** Status shown before he can be handled (e.g. still shopping). */
  wait?: string;
}

const DEFS = {
  sampler: {
    name: '試用品掃貨客', icon: '🧴', tag: '🧴 狂用試用品', tpl: 'roam',
    hint: '每個試用品都要擦一輪，貨架越來越少、地上都是乳液', how: '追上去互動「收走試用品」，他會換一排繼續試，要收兩次',
    act: '收走試用品', presses: 2, dur: 0.9, life: 70, every: 5, effects: ['stock', 'mess'],
    step: '「好啦最後一個」……他跑去另一排了，再收 {n} 次', ok: '收走了試用品，掃貨客摸摸鼻子走了', fail: '🧴 試用品被掃光，地上一片乳液，掃貨客滿意地走了',
  },
  reader: {
    name: '白看書魔人', icon: '📚', tag: '📚 坐地上看書', tpl: 'camp', spot: 'shelf', sit: true,
    hint: '坐在書架前的地上一本接一本看，書都被翻皺了賣不出去', how: '互動「請他到櫃台結帳」（要講久一點），他會買走手上那本',
    act: '請他到櫃台結帳', dur: 2.0, life: 80, every: 8, effects: ['stock'], buys: true,
    ok: '請白看書魔人去結帳，他買下翻皺的那本', fail: '📚 白看書魔人看完一整套就走了，書都皺了',
  },
  toucher: {
    name: '徒手摸麵包', icon: '🥐', tag: '🥐 用手摸麵包', tpl: 'roam', flee: true,
    hint: '不用夾子，每個麵包都用手捏一下，摸過的只能丟掉；你一靠近他就閃人', how: '追上他互動「遞夾子托盤」，他就會乖乖挑一個去結帳',
    act: '遞夾子托盤', dur: 0.8, life: 70, every: 4, effects: ['stock'], buys: true,
    ok: '遞上夾子托盤，徒手摸麵包客乖乖夾了一個去結帳', fail: '🥐 一整排麵包都被摸過了，只能報廢',
  },
  taster: {
    name: '試吃狂', icon: '🍢', tag: '🍢 試吃第 N 輪', tpl: 'camp', relocate: true,
    hint: '站在試吃台吃了一輪又一輪，試吃品成本一直燒', how: '互動「一人一份喔」，他會換到下一個試吃台，再請一次就走',
    act: '一人一份喔', presses: 2, dur: 0.8, life: 70, every: 4, effects: ['money'], drain: 3,
    step: '他走去下一個試吃台了！再請 {n} 次', ok: '試吃狂吃不到，拎著購物籃走了', fail: '🍢 試吃狂把試吃台吃光才走，試吃成本爆表',
  },
  dogfeed: {
    name: '狗狗試吃團', icon: '🐶', tag: '🐶 讓狗試吃', tpl: 'roam', need: 'box',
    hint: '牽著狗沿著貨架拆零食讓狗試吃，狗還順便在地上尿尿', how: '從倉庫拿一箱貨（任何一種）去給他「遞一包試吃包」，他就會買下帶走',
    act: '遞一包試吃包', life: 70, every: 5, effects: ['stock', 'mess'], buys: true,
    ok: '遞上試吃包，狗狗試吃團開心地拿去結帳', fail: '🐶 狗吃飽了、地也尿濕了，主人說「牠不喜歡」就走了',
  },
  squatter: {
    name: '一杯坐整天', icon: '☕', tag: '☕ 一杯坐整天', tpl: 'camp', sit: true,
    hint: '點一杯坐一整天，霸佔座位插著筆電，翻桌率掉光光', how: '互動「提醒用餐限時」兩次，或拿一杯咖啡給他「幫他續杯」（算一筆生意）',
    act: '提醒用餐限時', presses: 2, dur: 1.0, alt: '幫他續杯', altNeed: 'coffee', life: 90, every: 5, effects: ['money'], drain: 2,
    step: '「再五分鐘就好」……再提醒 {n} 次', ok: '一杯坐整天的客人收筆電去結帳了', fail: '☕ 他坐到打烊才走，整天只賺一杯的錢',
  },
  kicker: {
    name: '踢椅背大叔', icon: '🎬', tag: '🎬 踢椅背講電話', tpl: 'camp', sit: true,
    hint: '坐在等候區踢椅背、大聲講電話，旁邊的客人都快抓狂了', how: '互動「請他坐好小聲」兩次；他附近的客人耐心掉得特別快',
    act: '請他坐好小聲', presses: 2, dur: 1.0, life: 75, every: 5, effects: ['aura'], aura: 3.5,
    step: '他安靜了三秒又開始踢……再請 {n} 次', ok: '踢椅背大叔終於坐好、掛掉電話了', fail: '🎬 踢椅背大叔吵完整場才走，大家都在客訴',
  },
  packer: {
    name: '偷打包客', icon: '🥡', tag: '🥡 偷偷打包', tpl: 'sneak', spot: 'shelf', hidden: true,
    hint: '吃到飽還不夠，偷偷把肉盤和火鍋料塞進保鮮盒（要靠近才看得到）', how: '靠近互動「檢查打包盒」，他就得把打包的東西拿去結帳',
    act: '檢查打包盒', dur: 1.0, life: 60, every: 4, effects: ['stock'], buys: true,
    ok: '抓到偷打包客！他只好把保鮮盒拿去結帳', fail: '🥡 偷打包客提著三個保鮮盒走出店門，損失算店裡的',
  },
  wiper: {
    name: '免費擦車哥', icon: '⛽', tag: '⛽ 要免費擦車', tpl: 'till', need: 'mop',
    hint: '結帳時硬要你幫他擦車窗才肯付錢，後面的車都在按喇叭', how: '去西側牆邊拿拖把，拿著拖把對他互動「幫他擦車窗」',
    act: '幫他擦車窗', dur: 2.0, life: 45, wait: '他還在挑東西，結帳時才會開始要求',
    ok: '車窗擦得亮晶晶，免費擦車哥終於付錢了', fail: '⛽ 免費擦車哥罵「服務這麼差」，油錢不付就開走了',
  },
  benchhog: {
    name: '器材霸主', icon: '🏋', tag: '🏋 霸佔器材', tpl: 'camp',
    hint: '霸佔器材滑手機，一組做半小時，排隊的人全部等到不耐煩', how: '互動「請他讓出器材」三次（他會一直說「再一組就好」）',
    act: '請他讓出器材', presses: 3, dur: 0.7, life: 70, every: 6, effects: ['queue'],
    step: '「再一組就好」……還要再請 {n} 次', ok: '器材霸主終於讓出器材了', fail: '🏋 器材霸主練完才走，排隊的人都氣跑了',
  },
  doneness: {
    name: '熟度魔人', icon: '🥩', tag: '🥩 這哪是五分熟', tpl: 'camp', sit: true, need: 'meal',
    hint: '坐在位子上大罵「這哪是五分熟」，旁邊的客人都聽得很煩', how: '到鐵板重煎一份，拿著熱騰騰的那份對他互動「送上重煎的」（他會付錢）',
    act: '送上重煎的', life: 75, every: 5, effects: ['aura'], aura: 3.2, buys: true,
    ok: '重煎的端上桌，熟度魔人說「這才叫五分熟」', fail: '🥩 熟度魔人拍桌走人，還說要上網給一星',
  },
  refry: {
    name: '回鍋魔人', icon: '🍗', tag: '🍗 要再炸一次', tpl: 'till', need: 'meal',
    hint: '結帳時說雞排不夠酥，要你「再回鍋炸一次」才肯付錢', how: '到炸鍋炸一份，拿著現炸的對他互動「換一塊現炸的」（他會付這份的錢）',
    act: '換一塊現炸的', life: 50, wait: '他還在挑，結帳時才會開始挑剔',
    ok: '現炸的酥到掉渣，回鍋魔人滿意付錢', fail: '🍗 回鍋魔人說「那我不要了」，排隊的人白等了',
  },
  unboxer: {
    name: '拆封退貨王', icon: '📦', tag: '📦 拆封要退貨', tpl: 'refund',
    hint: '拿著用了半個月、自己摔壞的耳機在服務台要求全額退費', how: '互動「檢查拆封痕跡」兩次（找到摔痕他就沒話說），或直接退款 $40 打發他',
    act: '檢查拆封痕跡', presses: 2, dur: 1.4, alt: '直接退款 $40', altCost: 40, life: 45, failMoney: 80,
    step: '找到一道刮痕了……再檢查 {n} 次', ok: '「這是人為摔壞喔」——拆封退貨王無話可說地走了', fail: '📦 拆封退貨王鬧到店長出面，被迫全額退款',
  },
  photo: {
    name: '照片魔人', icon: '💇', tag: '💇 要跟照片一模一樣', tpl: 'redo', food: 'meal', rejects: 2,
    hint: '拿著明星照片說要一模一樣，剪好兩次都說「不像」', how: '一直重做到第三次他才接受；或互動「拿照片比對」跟他說明（要講久一點）',
    act: '拿照片比對', dur: 2.2, wait: '正走向等候區',
    step: '「這跟照片不像啊！」……再重做一次（還要 {n} 次）', ok: '照片魔人看著鏡子說：「嗯……其實還不錯」', fail: '💇 照片魔人等不到他要的髮型，說要上網爆料',
  },
  coins: {
    name: '一袋零錢阿伯', icon: '🪙', tag: '🪙 一袋零錢', tpl: 'till', presses: 3,
    hint: '寄個包裹拿出一整袋一元硬幣，要你當場數，後面整排都在等', how: '對他互動「幫他數零錢」三次（每數完一袋他又倒出一袋）',
    act: '幫他數零錢', dur: 1.2, life: 50, wait: '他還在填單，到櫃台才會掏出零錢',
    step: '數完一袋……他又倒出一袋！再數 {n} 次', ok: '零錢數完了，一袋零錢阿伯開心地說「剛剛好」', fail: '🪙 零錢數不完，阿伯說「那明天再來寄」，整排人白等',
  },
  rx: {
    name: '無處方硬要藥', icon: '💊', tag: '💊 不用處方啦', tpl: 'haggle', presses: 2,
    hint: '堅持不用處方箋就要買抗生素，越講越大聲（看他頭上的火氣）', how: '互動「堅持要處方箋」兩次讓他冷靜，或「推薦成藥」讓他買別的；火氣滿了會大鬧',
    act: '堅持要處方箋', dur: 1.2, alt: '推薦成藥', heat: 30, heatRate: 3, heatDrop: 35, wait: '他還在藥架前面，到櫃台才會開始',
    step: '他稍微冷靜了……再堅持 {n} 次', ok: '無處方硬要藥的客人說「好啦我去看醫生」', fail: '💊 他在藥局大吼大叫，被其他客人錄影上傳',
  },
  upgrader: {
    name: '硬要升等', icon: '🏨', tag: '🏨 硬要免費升等', tpl: 'haggle', presses: 3,
    hint: '在櫃台堅持「我是你們的 VIP」要免費升等總統套房，越講火氣越大', how: '互動「說明今天客滿」三次，或「送早餐券」$25 打發他；火氣滿了會大鬧',
    act: '說明今天客滿', dur: 1.0, alt: '送早餐券 $25', altCost: 25, heat: 35, heatRate: 2.5, heatDrop: 25, wait: '他還在大廳晃，到櫃台才會開始',
    step: '他翻了個白眼……再說明 {n} 次', ok: '硬要升等的客人勉強接受了標準房', fail: '🏨 硬要升等的客人在大廳大鬧，說要寫負評',
  },
} satisfies Record<string, SigKarenDef>;

export type SigKind = keyof typeof DEFS;
export const SIG_KARENS: Record<SigKind, SigKarenDef> = DEFS;
export const SIG_KINDS = Object.keys(SIG_KARENS) as SigKind[];
export function isSig(k: string): k is SigKind { return Object.prototype.hasOwnProperty.call(SIG_KARENS, k); }
export function sigDef(k: string): SigKarenDef | null { return isSig(k) ? SIG_KARENS[k] : null; }

/** The state a signature karen must be in before his action works (null = ready). Shared by sim, bot and client. */
export function sigWaitReason(kind: string, state: string): string | null {
  const d = sigDef(kind);
  if (!d) return '不需要';
  switch (d.tpl) {
    case 'till': case 'haggle': return state === 'atRegister' ? null : d.wait ?? '他還在挑商品';
    case 'camp': case 'sneak': return state === 'camp' || state === 'charge' ? null : '他還在找位置';
    case 'roam': return state === 'wander' || state === 'flee' ? null : '他正在走動';
    case 'redo': return state === 'waitFood' ? null : d.wait ?? '正走向取餐區';
    case 'refund': return state === 'complain' ? null : '正走向服務台';
  }
}
/** Items each "need" refers to, as labels. */
export const NEED_LABEL: Record<SigNeed, string> = { mop: '拖把', coffee: '飲料', meal: '熱食', box: '一箱貨' };
