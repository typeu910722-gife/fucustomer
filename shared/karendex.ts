// 「全台奧客圖鑑」: 記者小林's write-up for every karen kind (unlocked once you have handled that kind at least once),
// plus the short after-story lines shown in game after a store-signature karen is dealt with.
// Pure data + helpers; the handled counts live in the career profile (CareerProfile.dex).
import { GEN_KINDS, type GenKind, type KarenKind } from './constants.ts';
import { SIG_KINDS, type SigKind } from './sigkarens.ts';

export type DexSpeaker = 'boss' | 'fen' | 'lin';
export interface DexLine { who: DexSpeaker; text: string }
export const DEX_SPEAKER: Record<DexSpeaker, { name: string; icon: string }> = {
  boss: { name: '錢董', icon: '🤑' }, fen: { name: '阿芬姐', icon: '👩‍🦱' }, lin: { name: '記者小林', icon: '🎤' },
};

export interface DexEntry {
  icon: string;
  /** Where you meet him (store name or "各種店"). */
  where: string;
  /** 記者小林's short write-up. */
  note: string;
}

/** Every karen kind in display order: the classic ones, then one per store. */
export const DEX_ORDER: KarenKind[] = ['cutter', 'rager', 'streamer', 'hog', 'litterer', 'charger', 'custom', 'fickle', 'tryhard', 'boss', ...SIG_KINDS, ...GEN_KINDS];

export const DEX: Record<KarenKind, DexEntry> = {
  cutter: { icon: '🚶', where: '各種店', note: '常見於收銀台前三公尺。口頭禪「我只買一瓶水」，但手上永遠是一整籃。被請去排隊時會突然對手機很有興趣。' },
  rager: { icon: '😤', where: '各種店', note: '拿著發票從三個月前開始講起。怒氣條是真的會滿的，記者親眼看過一瓶醬油飛過貨架。折價券是最有效的鎮定劑。' },
  streamer: { icon: '📱', where: '各種店', note: '「家人們看這間店！」鏡頭比人先進門。撞翻貨架時會說「這段剪掉」。追他的時候，觀眾人數會上升。' },
  hog: { icon: '🍙', where: '各種店', note: '在貨架後面安靜進食的高手，嘴角的海苔是唯一證據。被抓到時會說「我是在試味道」。' },
  litterer: { icon: '🗑', where: '各種店', note: '走到哪丟到哪，宛如在店裡撒麵包屑做記號。據說是怕迷路。垃圾桶就在旁邊，他從來沒看過。' },
  charger: { icon: '🔌', where: '各種店', note: '一條延長線走天下。手機 3%、行動電源 2%、筆電 0%，全部要在你們店裡充滿。電費單是他留下的紀念品。' },
  custom: { icon: '🥪', where: '早餐店、雞排店', note: '「蛋不要、醬換、改內用……啊不對改外帶。」點餐單寫到背面還不夠。複誦一次是唯一解藥。' },
  fickle: { icon: '🧋', where: '手搖飲店', note: '半糖少冰改微糖去冰改無糖常溫。第一杯做好之前，他自己也不知道要什麼。' },
  tryhard: { icon: '👕', where: '服飾店', note: '一次帶十二件進試衣間，出來時穿著自己的衣服、地上多了十一件。據說他只是想吹冷氣。' },
  boss: { icon: '👑', where: '錢董的總公司', note: '傳說中集插隊、大鬧、直播於一身的男人。記者追了三年才拍到正面。被打工人請出門那天，全台店員都放了煙火。' },
  sampler: { icon: '🧴', where: '藥妝店', note: '一隻手擦乳液、一隻手噴香水、臉上還敷著試用面膜。離開時比進來時香三倍，購物籃是空的。' },
  reader: { icon: '📚', where: '書店', note: '自備小板凳、保溫瓶和書籤。已經在店裡看完三套武俠小說，最近開始看食譜，似乎準備長住。' },
  toucher: { icon: '🥐', where: '麵包店', note: '堅持「不捏一下怎麼知道軟不軟」。夾子在他眼裡是裝飾品。被他摸過的菠蘿麵包都有指紋。' },
  taster: { icon: '🍢', where: '超市', note: '把試吃台當成自助餐，一根牙籤可以用一整個下午。阿姨切香腸的速度跟不上他吃的速度。' },
  dogfeed: { icon: '🐶', where: '寵物店', note: '狗狗其實很乖，問題是主人。拆一包、餵一口、說「牠不喜歡」，下一包。狗狗看起來很尷尬。' },
  squatter: { icon: '☕', where: '咖啡廳', note: '一杯美式、三個插座、八小時。筆電上開著二十個分頁，其中一個是「如何讓店員不敢趕我」。' },
  kicker: { icon: '🎬', where: '電影院', note: '用腳打拍子、用手機開擴音，開場前就把劇情講完。坐他前面的人都練就了不回頭的定力。' },
  packer: { icon: '🥡', where: '火鍋吃到飽', note: '包包裡永遠有三個保鮮盒和一卷保鮮膜。他的名言：「吃到飽，也包括明天的早餐。」' },
  wiper: { icon: '⛽', where: '加油站', note: '加 100 元的油，要求擦前窗、後窗、後照鏡，還問能不能順便打蠟。雨刷是他自己的，雨水是天的，服務是你的。' },
  benchhog: { icon: '🏋', where: '健身房', note: '在臥推椅上一組做 12 下，中間休息 15 分鐘看短影音。毛巾掛在三台器材上「佔位」。' },
  doneness: { icon: '🥩', where: '牛排館', note: '點五分熟，端上來說太生；重煎之後說太熟。記者懷疑他心中的五分熟是一種哲學概念。' },
  refry: { icon: '🍗', where: '雞排店', note: '咬一口說不夠酥，要求「回鍋再炸一次」。據說他家的雞排都炸三次，變成雞排脆片。' },
  unboxer: { icon: '📦', where: '3C 賣場', note: '耳機用了半個月、摔過兩次、外殼有牙印，堅持是「開箱就壞」。發票保存得比耳機好。' },
  photo: { icon: '💇', where: '美髮沙龍', note: '手機裡存著韓星照片，要求「剪成一模一樣」。設計師剪得很像，只是臉不一樣。' },
  coins: { icon: '🪙', where: '郵局', note: '存了三年的一元硬幣，選在月初最忙的時候一次寄出。數零錢時會在旁邊幫忙「一、二……啊數到哪了」。' },
  rx: { icon: '💊', where: '藥局', note: '自稱「我自己就是半個醫生」，資歷是看過三集醫療劇。處方箋在他眼中只是一張紙。' },
  upgrader: { icon: '🏨', where: '飯店', note: '住標準房、要總統套房、自稱「我是你們的 VIP」。會員卡是另一家飯店的。' },
  lottery: { icon: '🧾', where: '各種店・單月 25 號後特別多', note: '錢包裡的發票比鈔票多，一張一張對到最後兩碼才肯讓位。記者問他中過什麼，他說「中過兩百，那天我請全家吃雞排」。' },
  change: { icon: '🪙', where: '各種店', note: '找零一定要攤在櫃台上一枚一枚數，數到一半會說「等一下，重來」。一次找剛好的店員，她會默默記住你的臉。' },
  bagman: { icon: '🛍', where: '各種店', note: '「袋子不是免費的嗎？」一次抽二十個，順便把架上的東西也裝進去。在店裡永遠在「看看而已」，只有走到門口才會心虛。' },
  toilet: { icon: '🚽', where: '各種店・遊覽車停靠站', note: '領隊舉著小旗子：「這間有廁所！」三十秒後整團排到門口。馬桶的極限是四個人，他們是第五個。' },
};

/** After-story lines once a signature karen has been dealt with: 2–3 success lines and one for failure. */
export const AFTERMATH: Record<SigKind, { ok: DexLine[]; fail: DexLine }> = {
  sampler: {
    ok: [
      { who: 'fen', text: '試用品收好了。下次他再來，我們就把試用品換成「試看品」——只能看。' },
      { who: 'boss', text: '試用品也是錢！收回來的那半瓶乳液，下禮拜當員工福利發給你。' },
      { who: 'lin', text: '小林筆記：掃貨客離店時全身香噴噴，經過的路人都回頭了。' },
    ],
    fail: { who: 'boss', text: '試用品被用光了？好，這個月的「試用品損耗」我記在你的薪水單上。' },
  },
  reader: {
    ok: [
      { who: 'fen', text: '他終於買了一本……是他看了整整三天、已經看完的那本。' },
      { who: 'boss', text: '書店不是圖書館！但他買了，所以今天的冷氣費算他贊助。' },
      { who: 'lin', text: '小林筆記：白看書魔人結帳時問「有沒有會員價」。沒有。' },
    ],
    fail: { who: 'fen', text: '他看完整套就走了，還在最後一本夾了書籤……他明天還要來。' },
  },
  toucher: {
    ok: [
      { who: 'fen', text: '他用夾子夾麵包的樣子好認真，像在夾娃娃機。' },
      { who: 'boss', text: '夾子很便宜，麵包很貴。記住這句話，這是我創業三十年的心得。' },
      { who: 'lin', text: '小林筆記：拿到夾子之後，他對每個麵包都說了「不好意思」。' },
    ],
    fail: { who: 'boss', text: '一整排都被摸過？……那就打折賣給員工，從你薪水扣。' },
  },
  taster: {
    ok: [
      { who: 'fen', text: '他走了，試吃台阿姨終於可以坐下來喝口水。' },
      { who: 'lin', text: '小林筆記：試吃狂離開前，把牙籤整齊地插回杯子裡。很有禮貌的吃光。' },
      { who: 'boss', text: '一人一份！說得好！下次也這樣跟你的加薪申請說。' },
    ],
    fail: { who: 'boss', text: '試吃台被吃光了……乾脆明天試吃改成「試聞」。' },
  },
  dogfeed: {
    ok: [
      { who: 'fen', text: '狗狗叼著試吃包去結帳，主人跟在後面，看起來比較像狗在遛人。' },
      { who: 'lin', text: '小林筆記：狗狗臨走前對店員搖了尾巴。是本日唯一的好評。' },
    ],
    fail: { who: 'fen', text: '地上那攤……拖把在西邊。對，又是你。' },
  },
  squatter: {
    ok: [
      { who: 'fen', text: '他收筆電的時候說「明天見」。……他是認真的。' },
      { who: 'boss', text: '翻桌率回來了！那個插座從今天起改成投幣式。' },
      { who: 'lin', text: '小林筆記：一杯坐整天的客人，筆電桌布是「把每一天都過成假日」。' },
    ],
    fail: { who: 'boss', text: '一杯咖啡坐九小時，時薪比你還高。……別這樣看我。' },
  },
  kicker: {
    ok: [
      { who: 'fen', text: '他終於坐好了。旁邊的觀眾自動幫你鼓掌。' },
      { who: 'lin', text: '小林筆記：踢椅背大叔掛電話前說了「我在看電影，很忙」。' },
      { who: 'boss', text: '安靜下來就好。那張被踢歪的椅子，維修費我先記著。' },
    ],
    fail: { who: 'fen', text: '整場都在吵……我建議下一場直接幫他開「導演講評版」。' },
  },
  packer: {
    ok: [
      { who: 'fen', text: '三個保鮮盒都結帳了。他還問我們有沒有賣保鮮盒。' },
      { who: 'boss', text: '吃到飽是「吃」到飽，不是「帶」到飽。這句我要做成貼紙。' },
      { who: 'lin', text: '小林筆記：偷打包客被抓到後，默默把蓋子蓋得更緊了。' },
    ],
    fail: { who: 'boss', text: '他帶走的肉夠開一家分店……損失算你們這一班的。' },
  },
  wiper: {
    ok: [
      { who: 'fen', text: '車窗亮到可以當鏡子，他還對著車窗整理了一下頭髮。' },
      { who: 'boss', text: '擦得好！以後擦窗服務一次十塊……錢歸公司，手是你的。' },
      { who: 'lin', text: '小林筆記：免費擦車哥開走時按了兩聲喇叭，疑似道謝。' },
    ],
    fail: { who: 'boss', text: '油錢沒付就開走？車牌記下來了吧？沒有？……好，扣你薪水。' },
  },
  benchhog: {
    ok: [
      { who: 'fen', text: '器材霸主讓出來了，排隊的人一秒衝上去，比他一整天做的還多下。' },
      { who: 'lin', text: '小林筆記：他離開時說「我只是在練耐心」。' },
      { who: 'boss', text: '器材要給付錢的人用！……他有付月費？那就讓他再做一組。開玩笑的。' },
    ],
    fail: { who: 'fen', text: '他練完走了，會員退了三個。我們的業績也跟著深蹲了。' },
  },
  doneness: {
    ok: [
      { who: 'fen', text: '他說「這才叫五分熟」。那份的熟度其實跟第一份一模一樣。' },
      { who: 'boss', text: '重煎的肉成本誰付？他付了？好，那今天他是貴賓。' },
      { who: 'lin', text: '小林筆記：熟度魔人吃完後在問卷上寫「七分滿意」。' },
    ],
    fail: { who: 'boss', text: '他說要上網給一星？……那我們先給自己五星，平均一下。' },
  },
  refry: {
    ok: [
      { who: 'fen', text: '現炸的雞排一咬，聲音大到整條街都聽到了。' },
      { who: 'lin', text: '小林筆記：回鍋魔人滿意地說「這才是雞排」，然後要了一包番茄醬。' },
      { who: 'boss', text: '再炸一次可以，油錢要算。……這次就算了，他有付錢。' },
    ],
    fail: { who: 'fen', text: '他說「那我不要了」……那塊雞排，我們晚點分著吃吧。' },
  },
  unboxer: {
    ok: [
      { who: 'fen', text: '耳機上有齒痕耶。他家的狗應該也很喜歡這副耳機。' },
      { who: 'lin', text: '小林筆記：拆封退貨王離開前問「那可以保固嗎」。保固不含被狗咬。' },
      { who: 'boss', text: '退款？不退！退款我會心痛，我心痛就會扣薪水。做得好。' },
    ],
    fail: { who: 'boss', text: '全額退款？那副耳機……放到員工福利區，一副八十。' },
  },
  photo: {
    ok: [
      { who: 'fen', text: '他對著鏡子自拍了二十張，還說要推薦給朋友。朋友們，請不要帶照片來。' },
      { who: 'lin', text: '小林筆記：照片魔人最後滿意了。照片上的明星應該不會知道這件事。' },
      { who: 'boss', text: '剪了三次只收一次的錢？……下次照片魔人一律收「臉型調整費」。' },
    ],
    fail: { who: 'fen', text: '他說要上網爆料……爆料內容是「剪得跟照片不像」。嗯，因為臉不一樣。' },
  },
  coins: {
    ok: [
      { who: 'fen', text: '一共兩百三十七個一元，剛剛好。阿伯說下次帶五元的，比較快。' },
      { who: 'lin', text: '小林筆記：一袋零錢阿伯臨走前塞了一顆糖給店員。是一元硬幣形狀的巧克力。' },
      { who: 'boss', text: '零錢也是錢！數完的硬幣拿去銀行換，手續費……你付。' },
    ],
    fail: { who: 'fen', text: '他說明天再來寄。我已經開始練數零錢了。' },
  },
  rx: {
    ok: [
      { who: 'fen', text: '他說要去看醫生了。很好，這才是今天最好的處方。' },
      { who: 'lin', text: '小林筆記：無處方硬要藥的客人走前問「醫生那邊要掛號嗎」。要。' },
      { who: 'boss', text: '藥師執照是你的，罰單也會是你的。做得對。……雖然少賺一筆。' },
    ],
    fail: { who: 'lin', text: '小林筆記：他大吵的影片已經十萬觀看，留言都在稱讚店員很冷靜。' },
  },
  upgrader: {
    ok: [
      { who: 'fen', text: '他住進標準房，十分鐘後打來說「這間其實也不錯」。' },
      { who: 'lin', text: '小林筆記：硬要升等的 VIP，會員卡背面寫著另一家飯店的名字。' },
      { who: 'boss', text: '總統套房是留給真的總統的！……還有付得起的人。' },
    ],
    fail: { who: 'boss', text: '他要寫負評？那我們回覆「歡迎您再來，我們會準備總統套房的照片給您看」。' },
  },
};

/** After-story lines for the general karens (round 27), same shape as AFTERMATH. */
export const GEN_AFTERMATH: Record<GenKind, { ok: DexLine[]; fail: DexLine }> = {
  lottery: {
    ok: [
      { who: 'fen', text: '他在對獎機前站了二十分鐘，最後中了兩百，開心到請我們喝飲料。……用那兩百。' },
      { who: 'lin', text: '小林筆記：發票對獎魔人的錢包裡，發票按月份用迴紋針夾好。比我的報稅資料還整齊。' },
      { who: 'boss', text: '對獎機是我花錢裝的！……他中獎有抽成嗎？沒有？那至少讓他買瓶水。' },
    ],
    fail: { who: 'boss', text: '從收銀機兌獎？兩百塊是公司的錢！……下次對獎機前面貼一張「店員陪同服務」。' },
  },
  change: {
    ok: [
      { who: 'fen', text: '一次找剛好，她說要給我們五顆星。……她手機上是一顆星的評論草稿，剛剛刪掉了。' },
      { who: 'lin', text: '小林筆記：找零計較姐離開前把每一枚硬幣都翻成正面放進錢包。' },
      { who: 'boss', text: '找零就是要準！少一塊是客訴，多一塊是我的血。' },
    ],
    fail: { who: 'fen', text: '她數到第三次還是說不對……後來發現是她自己口袋多放了一枚五十。' },
  },
  bagman: {
    ok: [
      { who: 'fen', text: '阿伯的袋子裡有八個購物袋、兩包泡麵和一支我們的原子筆。原子筆我收回來了。' },
      { who: 'boss', text: '袋子一個一塊！……好啦今天算他便宜，商品照原價。' },
      { who: 'lin', text: '小林筆記：被攔下時阿伯說「我是要拿去結帳啊」，手已經在推門了。' },
    ],
    fail: { who: 'boss', text: '他拎著我們的袋子裝我們的東西走了？……明天門口裝一個會叫的門。' },
  },
  toilet: {
    ok: [
      { who: 'fen', text: '一整團每人買一瓶水，今天的業績突然好看了。廁所……還是要通一下。' },
      { who: 'lin', text: '小林筆記：領隊收起小旗子說「下一站有免費廁所」，團員一起嘆氣。' },
      { who: 'boss', text: '廁所限消費使用！這句話我要做成霓虹燈。' },
    ],
    fail: { who: 'fen', text: '水淹到貨架前面了。拖把在西邊……對，兩支都要拿。' },
  },
};

function hash(n: number) { let h = (n | 0) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); return (h ^ (h >>> 15)) >>> 0; }

/** The after-story line for this karen (seed = his id, so every client picks the same one), or null for the classic karens. */
export function aftermathLine(kind: string, ok: boolean, seed = 0): DexLine | null {
  const a = (AFTERMATH as Record<string, { ok: DexLine[]; fail: DexLine }>)[kind] ?? (GEN_AFTERMATH as Record<string, { ok: DexLine[]; fail: DexLine }>)[kind];
  if (!a) return null;
  return ok ? a.ok[hash(seed) % a.ok.length] : a.fail;
}

/** Formats a line for a toast / bubble: "🤑 錢董：……". */
export function lineText(l: DexLine) { return `${DEX_SPEAKER[l.who].icon} ${DEX_SPEAKER[l.who].name}：${l.text}`; }

const KIND_RE = /^[a-z]{2,16}$/;
/** Sanitizes a handled-count record (unknown kinds dropped, counts clamped). Missing / old saves → {}. */
export function sanitizeDex(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  const known = new Set<string>(DEX_ORDER);
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (!KIND_RE.test(k) || !known.has(k) || typeof n !== 'number' || !Number.isFinite(n)) continue;
    const c = Math.max(0, Math.min(1e6, Math.floor(n)));
    if (c) out[k] = c;
  }
  return out;
}

/** Adds a shift's handled counts (kind → number) into a dex record. */
export function addHandled(dex: Record<string, number>, handled: Record<string, number> | undefined) {
  if (!handled) return;
  const clean = sanitizeDex(handled);
  for (const [k, n] of Object.entries(clean)) dex[k] = Math.min(1e6, (dex[k] ?? 0) + n);
}

/** How many entries are unlocked; `sig` = only the store-signature karens. */
export function dexCount(dex: Record<string, number>, sig = false) {
  return (sig ? SIG_KINDS : DEX_ORDER).filter(k => (dex[k] ?? 0) > 0).length;
}
