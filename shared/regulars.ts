// 常客奧客: eight named regulars who keep coming back across shifts, chapters and stores. Each arc has four stages told in
// short dialogue cards before and after a shift, plus speech bubbles while the regular is in the store. Clearing a stage
// = winning a shift in which you dealt with that regular; the last stage ends the arc with a free cosmetic and an
// achievement. Career-only (solo shifts, the daily and the weekly challenge). Pure data + functions (unit-tested).
// All characters are fictional.
import type { CareerProfile, ShiftConfig, ShiftResult } from './career.ts';
import type { KarenKind } from './constants.ts';
import { CAST, type Speaker } from './story.ts';

export interface ArcLine { who: Speaker | 'npc'; text: string }
export interface ArcStage {
  title: string;
  /** Needs this chapter open (the daily / weekly count as the chapter their difficulty comes from). */
  minChapter: number;
  pre: ArcLine[];
  /** What the regular says in the store (speech bubbles). */
  bubbles: string[];
  /** Said when you deal with them. */
  handled: string;
  post: ArcLine[];
}
export interface ArcDef {
  id: string; name: string; icon: string; kind: KarenKind; blurb: string;
  stages: ArcStage[];
  /**
   * Only once this shift has a star (= the next chapter is open, like chapterUnlocked in career.ts): for a regular tied to
   * a later chapter's store karen, who could otherwise walk into an early daily / weekly at that store.
   */
  opensAfter?: string;
  /** Where to meet them, when that is not the main story (shown on the career page). */
  where?: string;
  /** Arc payoff: a cosmetic (granted free) and an achievement id. */
  reward: { cosmetic: string; achievement: string; title: string };
}
export interface ArcState { stage: number; seen: number; at: number }

/** Shifts that must pass between two stages of the same arc (so a regular "comes back" rather than staying). */
export const ARC_GAP = 2;

export const ARCS: ArcDef[] = [
  {
    id: 'auntie', name: '集點王阿姨', icon: '🧓', kind: 'cutter',
    blurb: '每天同一個時間來，每天都說「我只有一瓶」。',
    reward: { cosmetic: 'tag_points', achievement: 'ARC_AUNTIE', title: '集點卡滿了' },
    stages: [
      {
        title: '老客人', minChapter: 1,
        pre: [
          { who: 'npc', text: '少年欸，我是這裡的老客人，讓我先結一下啦，我只有一瓶養樂多。' },
          { who: 'fen', text: '那是王阿姨。每天這個時間來，每天都說她只有一瓶。' },
          { who: 'me', text: '……她手上有六瓶。' },
        ],
        bubbles: ['我是老客人啦，先讓我結～', '我只有一瓶！……六瓶也是一瓶一瓶買的啊'],
        handled: '好啦好啦，我排就是了。你這孩子很有原則喔。',
        post: [
          { who: 'npc', text: '明天我還會來。你給我記住，我是王阿姨。' },
          { who: 'fen', text: '她記住你了。這不知道是好事還是壞事。' },
        ],
      },
      {
        title: '過期的點數', minChapter: 2,
        pre: [
          { who: 'npc', text: '這張集點卡是 2019 年的，你們換系統又不是我的錯，點數要算給我！' },
          { who: 'boss', text: '集點卡？我們從來沒有發過集點卡。' },
          { who: 'me', text: '那這張是……隔壁那家的？' },
        ],
        bubbles: ['點數不算，我就排在最前面不走！', '我在這裡集了十年點數耶！'],
        handled: '……好啦，那你幫我蓋一個新的章。',
        post: [
          { who: 'npc', text: '我把你們的新集點卡收好了，滿十點換一顆茶葉蛋喔。' },
          { who: 'me', text: '（我們有賣茶葉蛋嗎？）' },
        ],
      },
      {
        title: '媽媽團', minChapter: 3,
        pre: [
          { who: 'npc', text: '我今天帶社區媽媽團來，大家都是老客人，所以全部都可以先結。' },
          { who: 'lin', text: '一次十二位王阿姨等級的客人……這可以寫一整版。' },
          { who: 'fen', text: '排隊動線拉好。你處理阿姨，其他的交給我。' },
        ],
        bubbles: ['我們媽媽團是團購！團購可以插隊！', '姐妹們，這個店員很兇喔～但人很好'],
        handled: '好啦，媽媽們排好。……欸，他有在聽我們講話耶。',
        post: [
          { who: 'npc', text: '其實啊……我先生住院，我每天來，是因為這裡有人會跟我說話。' },
          { who: 'me', text: '阿姨，那您每天來，排隊的時候我們聊天。' },
          { who: 'npc', text: '你這孩子。' },
        ],
      },
      {
        title: '集滿十點', minChapter: 5,
        pre: [
          { who: 'npc', text: '我的集點卡滿了！今天我要換東西。……不是換茶葉蛋。' },
          { who: 'fen', text: '她手上拿的那是什麼？毛線？' },
        ],
        bubbles: ['先讓我結，我有東西要送你！', '排隊？好，我排。我學會了。'],
        handled: '我排完了喔！你看，阿姨也是會排隊的。',
        post: [
          { who: 'npc', text: '這個名牌是我用你們的集點卡改的，上面寫你的名字。謝謝你每天都讓我排隊。' },
          { who: 'fen', text: '十年來第一次，王阿姨乖乖排到最後。' },
          { who: 'lin', text: '「插隊阿姨的最後一張集點卡」——這篇我要寫成溫馨版。' },
        ],
      },
    ],
  },
  {
    id: 'kai', name: '直播主阿凱', icon: '🤳', kind: 'streamer',
    blurb: '訂閱 87 人的直播主，夢想是「在便利商店被店員趕出去」。',
    reward: { cosmetic: 'sign_live', achievement: 'ARC_KAI', title: '轉型成功' },
    stages: [
      {
        title: '開台', minChapter: 3,
        pre: [
          { who: 'npc', text: '哈囉各位寶寶！今天我們來挑戰「在便利商店被店員趕出去」！' },
          { who: 'lin', text: '這個人叫阿凱，訂閱 87 人。' },
          { who: 'me', text: '……87 人也是觀眾。' },
        ],
        bubbles: ['寶寶們看！店員來了！', '留言刷一波「店員好兇」！'],
        handled: '好啦我關台……寶寶們下次見～',
        post: [
          { who: 'npc', text: '欸！剛剛那段被你制止的影片，觀看次數破萬了！' },
          { who: 'me', text: '……我不想紅。' },
        ],
      },
      {
        title: '爆紅之後', minChapter: 3,
        pre: [
          { who: 'npc', text: '各位寶寶，我又來了！上一集爆了，今天拍續集「店員的逆襲」！' },
          { who: 'boss', text: '流量就是錢！讓他拍！……但不要拍到我的扣薪單。' },
        ],
        bubbles: ['續集開拍！店員看這裡！', '抖內破百我就去拍收銀機！'],
        handled: '收到收到，我去門口拍就好。',
        post: [
          { who: 'lin', text: '阿凱的頻道破一萬訂閱了。標題是「史上最有原則的店員」。' },
          { who: 'me', text: '我的臉可以打馬賽克嗎？' },
        ],
      },
      {
        title: '粉絲見面會', minChapter: 4,
        pre: [
          { who: 'npc', text: '今天粉絲見面會辦在你們店！買一瓶飲料就能跟店員合照！' },
          { who: 'fen', text: '這不是我們辦的活動吧？' },
          { who: 'me', text: '沒有人問過我啊！' },
        ],
        bubbles: ['見面會開始！店員在那邊！', '寶寶們不要擠，排隊跟店員合照！'],
        handled: '對不起啦，我下次會先問。……真的。',
        post: [
          { who: 'npc', text: '我想了一下，我拍的都是別人的困擾。下一集我想拍「店員的一天」，認真的那種。' },
          { who: 'fen', text: '讓他拍吧。至少他學會先問了。' },
        ],
      },
      {
        title: '店員的一天', minChapter: 5,
        pre: [
          { who: 'npc', text: '今天不搗亂。我只想記錄你們怎麼處理奧客——可以嗎？' },
          { who: 'me', text: '……先說好，拍到奧客要打馬賽克。' },
        ],
        bubbles: ['我今天是來學習的！', '寶寶們安靜，店員在工作！'],
        handled: '這段太好了，我要拿來當片頭。',
        post: [
          { who: 'npc', text: '影片上架了，留言都在說「謝謝所有服務業」。這個 LIVE 燈牌送你，掛在店門口。' },
          { who: 'lin', text: '從亂拍到拍紀錄片……阿凱轉型成功。' },
        ],
      },
    ],
  },
  {
    id: 'zhang', name: '退貨張伯', icon: '👴', kind: 'rager',
    blurb: '喝一半的飲料也要退。退休前在工廠做了四十年品管。',
    reward: { cosmetic: 'uni_qc', achievement: 'ARC_ZHANG', title: '品管合格' },
    stages: [
      {
        title: '喝一半的退貨', minChapter: 2,
        pre: [
          { who: 'npc', text: '這瓶飲料不好喝，我要退。' },
          { who: 'me', text: '伯伯，您喝了一半了。' },
          { who: 'npc', text: '就是喝了一半才知道不好喝啊！' },
        ],
        bubbles: ['我要退貨！叫你們店長出來！', '喝一半才知道不好喝，這很合理！'],
        handled: '……哼，算你講得有道理。',
        post: [{ who: 'fen', text: '那是張伯。退休前好像在工廠做品管，什麼都要挑毛病。' }],
      },
      {
        title: '發票對不起來', minChapter: 3,
        pre: [
          { who: 'npc', text: '你的發票寫「飲料」，我買的是「綠茶」！這是虛偽不實！' },
          { who: 'boss', text: '他上次也這樣說，結果我送了他一包衛生紙。' },
          { who: 'me', text: '所以他又來了。' },
        ],
        bubbles: ['發票寫錯就是詐欺！', '我要打電話申訴！'],
        handled: '好吧，品名欄位長度有限，我接受。',
        post: [{ who: 'npc', text: '你解釋得很清楚。比你們老闆清楚多了。' }],
      },
      {
        title: '陳情書', minChapter: 4,
        pre: [
          { who: 'npc', text: '我寫好陳情書了，一式三份。一份給你，一份給消基會，一份給我自己留念。' },
          { who: 'lin', text: '張伯的陳情書寫得比我的新聞稿還好。' },
        ],
        bubbles: ['陳情書第三頁第二點！你看了沒？', '我做了四十年品管！'],
        handled: '……你看完了？整份？年輕人很少有耐心看完。',
        post: [
          { who: 'npc', text: '我以前在工廠，一個瑕疵都不會放過。退休之後……沒有東西可以檢查了。' },
          { who: 'me', text: '伯伯，那您幫我們檢查貨架好了。過期的、擺錯的，您一定看得出來。' },
        ],
      },
      {
        title: '品管合格', minChapter: 6,
        pre: [
          { who: 'npc', text: '我來報到了。今天幫你們全店品管。' },
          { who: 'fen', text: '他帶了放大鏡跟夾板……他是認真的。' },
        ],
        bubbles: ['這排標價歪了 2 毫米！', '不合格！……我是說那瓶，不是你。'],
        handled: '這家店，品管合格。',
        post: [
          { who: 'npc', text: '這件背心是我以前在工廠穿的。上面的「品管合格」章，送你。' },
          { who: 'boss', text: '你們兩個不要再來找我了。' },
          { who: 'fen', text: '張伯說他明天還要來檢查冰箱溫度。' },
        ],
      },
    ],
  },
  {
    id: 'vicky', name: '插座姐 Vicky', icon: '💻', kind: 'charger',
    blurb: '數位遊牧工作者。她的「充一下」通常是三個小時。',
    reward: { cosmetic: 'mascot_plug', achievement: 'ARC_VICKY', title: '找到插座' },
    stages: [
      {
        title: '只是充一下', minChapter: 4,
        pre: [
          { who: 'npc', text: '我只是充一下電，十分鐘就好。……我的十分鐘是比較長的那種。' },
          { who: 'fen', text: '門口的插座又被佔了。' },
        ],
        bubbles: ['我在開會，不要拔！', '十分鐘！真的十分鐘！'],
        handled: '好啦……那我去咖啡廳。他們插座比較多。',
        post: [{ who: 'me', text: '她走的時候說「下次帶延長線」。我希望她是開玩笑的。' }],
      },
      {
        title: '延長線', minChapter: 5,
        pre: [
          { who: 'npc', text: '我帶了延長線！一個插座、六個孔，這叫資源共享。' },
          { who: 'boss', text: '電費！電費！誰來付電費！' },
        ],
        bubbles: ['六孔延長線，大家一起充！', '這是共享經濟！'],
        handled: '好啦好啦，我收起來。你們老闆的臉好可怕。',
        post: [{ who: 'npc', text: '其實我在做一個 App，叫「哪裡有插座」。你們店是第一名……負評的那種。' }],
      },
      {
        title: '線上會議', minChapter: 5,
        pre: [
          { who: 'npc', text: '我今天要跟投資人開線上會議，在你們店。因為這裡的網路……啊你們沒有 Wi-Fi？' },
          { who: 'lin', text: '在便利商店門口募資，這是一種勇氣。' },
        ],
        bubbles: ['投資人在線上！拜託小聲一點！', '我的簡報只剩 3% 電！'],
        handled: '……投資人說，我連插座都不會找，怎麼做插座 App。',
        post: [
          { who: 'npc', text: '募資失敗了。' },
          { who: 'me', text: '我請你喝杯咖啡吧。插座……給你十分鐘。真的十分鐘。' },
          { who: 'npc', text: '……謝謝。' },
        ],
      },
      {
        title: '找到插座', minChapter: 6,
        pre: [
          { who: 'npc', text: '我的 App 上線了！第一個合作店家是你們。門口那個插座，電費我付。' },
          { who: 'boss', text: '她付電費？那讓她充！充到天荒地老！' },
        ],
        bubbles: ['今天我是付費會員！', '這次真的只充十分鐘。'],
        handled: '我說到做到吧？十分鐘。',
        post: [
          { who: 'npc', text: '這個插頭公仔送你，放在櫃台。每個奧客都有一個還沒找到插座的故事。' },
          { who: 'fen', text: '……這句話可以印在員工手冊上。' },
        ],
      },
    ],
  },
  // ---- round 30: four more regulars (three of the 通用新奧客 and one later-chapter store karen) ----
  {
    id: 'lotto', name: '對獎阿公', icon: '🎟️', kind: 'lottery',
    where: '特殊營業日「跨年夜」，或有「發票對獎魔人」的每日／每週挑戰',
    blurb: '每期都來對發票，三十年沒中過。口袋裡的發票比他的年紀還多。',
    reward: { cosmetic: 'hat_lotto', achievement: 'ARC_LOTTO', title: '中了兩百' },
    stages: [
      {
        title: '一疊發票', minChapter: 2,
        pre: [
          { who: 'npc', text: '少年欸，幫我對一下。這疊是今年的，那袋是去年的，車上還有。' },
          { who: 'fen', text: '那是對獎阿公。三十年沒中過，但他相信下一張就會中。' },
          { who: 'me', text: '……阿公，對獎機在旁邊。' },
        ],
        bubbles: ['等一下，這張 7 號……啊不是。', '後面的不要催，好運會被催走！'],
        handled: '好啦，去對獎機。機器比較不會搶我的運。',
        post: [
          { who: 'npc', text: '又沒中。沒關係，沒中代表運氣還存著。' },
          { who: 'me', text: '（這是什麼理財觀念。）' },
        ],
      },
      {
        title: '差一個號碼', minChapter: 3,
        pre: [
          { who: 'npc', text: '你看！特別獎一千萬，我只差一個號碼！一定是你們發票機印錯！' },
          { who: 'boss', text: '印錯？那我們是不是要賠他一千萬？' },
          { who: 'fen', text: '老闆，冷靜。差一個號碼就是沒中。' },
        ],
        bubbles: ['把發票機叫出來對質！', '差一個號碼！一個！'],
        handled: '……你說得對，差一個就是沒中。我這輩子都差一個。',
        post: [
          { who: 'npc', text: '我年輕的時候，也是差一點就跟她告白。' },
          { who: 'me', text: '……阿公，您這期還有兩疊沒對。' },
          { who: 'npc', text: '對喔！人生還有兩疊！' },
        ],
      },
      {
        title: '中了兩百', minChapter: 4,
        pre: [
          { who: 'npc', text: '中了！中了！兩百塊！三十年來第一次！' },
          { who: 'lin', text: '「三十年的等待，換來兩百元」——這標題我寫定了。' },
          { who: 'fen', text: '他要是在門口放鞭炮，你負責滅火。' },
        ],
        bubbles: ['中獎了！大家都來看！', '這張我要裱框！……不行，要換錢。'],
        handled: '好，好，我去對獎機領。要排隊？我排！中獎的人排得起！',
        post: [
          { who: 'npc', text: '這兩百塊，我不存了。下次來，我要請你們。' },
          { who: 'boss', text: '請客？那他會買我們店的東西吧？' },
          { who: 'me', text: '老闆，你的重點永遠在這裡。' },
        ],
      },
      {
        title: '阿公請客', minChapter: 5,
        pre: [
          { who: 'npc', text: '兩百塊，一塊都沒花。今天全部花在這裡。' },
          { who: 'fen', text: '他拿著一個紅包袋……還有一頂帽子？' },
        ],
        bubbles: ['今天我請客！店員優先！', '這次不對獎了，直接結帳！'],
        handled: '四瓶飲料、四顆茶葉蛋，兩百塊剛剛好。三十年，剛剛好。',
        post: [
          { who: 'npc', text: '這頂帽子是用三十年的發票紅包袋縫的。中獎的運，分你一半。' },
          { who: 'lin', text: '阿公說，人生不用中頭獎，中兩百就很好了。' },
          { who: 'me', text: '……阿公，下期記得直接去對獎機。' },
        ],
      },
    ],
  },
  {
    id: 'meiling', name: '找零姐美玲', icon: '🪙', kind: 'change',
    where: '特殊營業日「跨年夜」，或有「找零計較姐」的每日／每週挑戰',
    blurb: '找零要一個一個數給她看，數錯要重來。口頭禪是「一塊錢也是錢」。',
    reward: { cosmetic: 'tag_coin', achievement: 'ARC_MEILING', title: '一塊都沒錯' },
    stages: [
      {
        title: '一塊錢也是錢', minChapter: 3,
        pre: [
          { who: 'npc', text: '你找我 37 塊，數給我看。一個一個。慢慢來，我不趕。' },
          { who: 'fen', text: '她不趕，後面二十個人在趕。' },
          { who: 'me', text: '一、二、三……' },
        ],
        bubbles: ['錯了，重來！從一開始！', '一塊錢也是錢！'],
        handled: '嗯，37 塊，一塊不少。你數得比上一個店員好。',
        post: [
          { who: 'npc', text: '我女兒也在找打工。她要是像你這樣數錢，我就放心了。' },
          { who: 'fen', text: '……千萬不要讓她女兒來我們店。拜託。' },
        ],
      },
      {
        title: '亮亮的硬幣', minChapter: 3,
        pre: [
          { who: 'npc', text: '這個十塊好舊，我要新的。有沒有今年鑄的？' },
          { who: 'boss', text: '硬幣還分新舊？那舊的我留著，新的給她。' },
          { who: 'me', text: '老闆，錢就是錢。' },
        ],
        bubbles: ['這枚背面刮到了，換一枚！', '我要亮亮的那種！'],
        handled: '好啦，舊的也是錢。……但下次我要亮的。',
        post: [
          { who: 'npc', text: '對了，我女兒下禮拜要去面試。不知道是哪一家店。' },
          { who: 'fen', text: '（拜託不是我們。拜託不是我們。）' },
        ],
      },
      {
        title: '新人是她女兒', minChapter: 4,
        pre: [
          { who: 'fen', text: '今天有新人報到，叫小美。' },
          { who: 'npc', text: '小美！媽媽來看你了！找零要一個一個數喔！' },
          { who: 'me', text: '……是我們。' },
        ],
        bubbles: ['小美，數大聲一點！', '我不是奧客，我是家長！'],
        handled: '好啦，我去後面排。小美，媽媽在看喔。',
        post: [
          { who: 'npc', text: '她從小就怕數錢。我每天要人家數給我看，其實是想學怎麼教她。' },
          { who: 'fen', text: '……原來是在備課。' },
          { who: 'me', text: '阿姨，小美很快就會數了。我教她。' },
        ],
      },
      {
        title: '一塊都沒錯', minChapter: 5,
        pre: [
          { who: 'npc', text: '今天小美第一次自己顧收銀。我是來結帳的——普通客人。' },
          { who: 'fen', text: '她帶了一整袋零錢。普通客人。' },
        ],
        bubbles: ['一個一個數，媽媽不趕。', '……不要跟她說我在哭。'],
        handled: '一塊都沒錯。……一塊都沒錯。',
        post: [
          { who: 'npc', text: '這個名牌是用小美第一天找給我的一塊錢做的。送你，你是她師父。' },
          { who: 'fen', text: '找零姐今天一次都沒有叫人重數。' },
          { who: 'lin', text: '「全台最嚴格的找零客，也是最溫柔的家長」——這篇我要寫。' },
        ],
      },
    ],
  },
  {
    id: 'bags', name: '袋子伯阿土', icon: '🛍️', kind: 'bagman',
    where: '特殊營業日「颱風夜」，或有「免費袋子阿伯」的每日／每週挑戰',
    blurb: '「袋子是免費的吧？」每次走都帶一大綑。沒有人知道那些袋子去哪了。',
    reward: { cosmetic: 'mascot_dragon', achievement: 'ARC_BAGS', title: '回收藝術家' },
    stages: [
      {
        title: '袋子是免費的吧', minChapter: 2,
        pre: [
          { who: 'npc', text: '這袋子是免費的吧？我拿幾個。……幾十個。' },
          { who: 'me', text: '阿伯，袋子一個一塊。' },
          { who: 'npc', text: '那我拿的這些，算是幫你們整理。' },
        ],
        bubbles: ['我只是幫你們整理袋子！', '這個也可以裝……這個也可以裝……'],
        handled: '好啦，袋子還你。……這個綠色的我真的很需要。',
        post: [
          { who: 'fen', text: '他說他需要綠色的。只要綠色的。' },
          { who: 'me', text: '……他在收集顏色？' },
        ],
      },
      {
        title: '一百個紅袋子', minChapter: 3,
        pre: [
          { who: 'npc', text: '我需要一百個紅色袋子，急用。我可以拿三十個藍色的跟你換。' },
          { who: 'boss', text: '用袋子換袋子？那我……等等，這樣我有賺嗎？' },
          { who: 'fen', text: '老闆，你沒賺。' },
        ],
        bubbles: ['紅色！只要紅色的！', '一百個，一個都不能少！'],
        handled: '好吧，不拿了。……那你們的回收箱可以給我看一下嗎？',
        post: [
          { who: 'lin', text: '我跟蹤……我是說，我採訪了一下。他把袋子全部搬進社區活動中心。' },
          { who: 'me', text: '活動中心？他在裡面做什麼？' },
        ],
      },
      {
        title: '閒人勿進', minChapter: 4,
        pre: [
          { who: 'npc', text: '開展前最後一週！我缺黃色的。全台北的黃色袋子都在你們這了。' },
          { who: 'lin', text: '活動中心門口貼了一張紙：「閒人勿進，藝術創作中」。' },
          { who: 'fen', text: '袋子伯是……藝術家？' },
        ],
        bubbles: ['黃色！給我黃色！這是為了藝術！', '不要問，開展就知道！'],
        handled: '好，好，用買的。藝術家也是要付錢的。……一塊對吧？',
        post: [
          { who: 'npc', text: '我以前是刻布袋戲偶的。退休之後什麼都想做，可是材料太貴了。' },
          { who: 'me', text: '阿伯，回收箱的袋子以後都留給你。' },
          { who: 'npc', text: '你這個少年。開展第一張邀請卡，給你。' },
        ],
      },
      {
        title: '回收藝術展', minChapter: 5,
        pre: [
          { who: 'npc', text: '今天開展！我來邀請你們——順便拿幾個袋子。最後幾個，真的。' },
          { who: 'fen', text: '他還是要拿袋子。' },
        ],
        bubbles: ['開展了！邀請卡在袋子裡！', '最後一個袋子！神龍就差眼睛！'],
        handled: '好啦，這個我付錢。神龍的眼睛，用買的才有誠意。',
        post: [
          { who: 'npc', text: '展名叫「奧客退散」，三千個袋子做的神龍。這隻小的給你們，放在櫃台。' },
          { who: 'lin', text: '展場排隊排到門外。袋子伯說，那些全是你們店的袋子。' },
          { who: 'boss', text: '那門票收入是不是要分我？' },
        ],
      },
    ],
  },
  {
    // 一杯坐整天 is the café's own karen (chapter 8): they only come once chapter 8 is open
    id: 'couple', name: '網紅情侶', icon: '💔', kind: 'squatter', opensAfter: '7-6',
    where: '第 8 章開放後：咖啡廳「筆電森林」或咖啡廳的每日／每週挑戰',
    blurb: '點一杯咖啡、兩根吸管，坐一整天拍分手影片。拍完再拍復合。',
    reward: { cosmetic: 'uni_love', achievement: 'ARC_COUPLE', title: '百年好合' },
    stages: [
      {
        title: '分手直播', minChapter: 3,
        pre: [
          { who: 'npc', text: '我們要在這裡拍分手影片。一杯咖啡，兩根吸管。燈光可以幫我們調暗一點嗎？' },
          { who: 'fen', text: '一杯咖啡，兩個位子，拍一整天。' },
          { who: 'me', text: '……分手也要佔位子？' },
        ],
        bubbles: ['小婷：你從來不幫我按讚！', '阿哲：卡！店員入鏡了，重來！'],
        handled: '好啦，我們去外面分。……外面光線比較好。',
        post: [
          { who: 'lin', text: '分手影片上傳了，標題「在咖啡廳被店員趕出去的那天，我們分手了」。' },
          { who: 'me', text: '我沒有趕，我是提醒用餐限時。' },
        ],
      },
      {
        title: '復合直播', minChapter: 4,
        pre: [
          { who: 'npc', text: '我們復合了！今天在同一個位子拍復合。那天的店員可以入鏡嗎？你是見證人。' },
          { who: 'boss', text: '入鏡要收出場費吧！' },
          { who: 'fen', text: '他們又只點了一杯。' },
        ],
        bubbles: ['小婷：那天你說的話，我都記得。', '阿哲：店員再走過來一次，這次慢動作！'],
        handled: '好啦，我們續一杯。……兩根吸管。',
        post: [
          { who: 'npc', text: '復合影片的觀看是分手的十倍。網友都說「店員才是主角」。' },
          { who: 'me', text: '我只是想收桌子。' },
        ],
      },
      {
        title: '求婚企劃', minChapter: 5,
        pre: [
          { who: 'npc', text: '阿哲（小聲）：我要求婚。戒指藏在她那杯咖啡的奶泡裡，你們要配合我。' },
          { who: 'fen', text: '戒指放奶泡裡？她喝下去怎麼辦？' },
          { who: 'me', text: '……那就變成急診室企劃了。' },
        ],
        bubbles: ['阿哲：還不能收杯子！戒指在裡面！', '小婷：這杯奶泡怎麼特別重？'],
        handled: '小婷：……我願意。可是你先把戒指從奶泡裡撈出來。',
        post: [
          { who: 'npc', text: '小婷：我們想在這裡辦一個小小的婚禮。一張桌子，一整天。' },
          { who: 'boss', text: '一整天？包場費！' },
          { who: 'fen', text: '老闆，這次讓他們坐。' },
        ],
      },
      {
        title: '百年好合', minChapter: 6,
        pre: [
          { who: 'npc', text: '今天是我們的婚禮！賓客只有三位：你、阿芬姐、記者小林。咖啡我們點了……三杯！' },
          { who: 'lin', text: '史上第一次，他們點了超過一杯。' },
          { who: 'fen', text: '眼眶有點濕……一定是咖啡機的蒸氣。' },
        ],
        bubbles: ['小婷：今天不拍片，只過日子。', '阿哲：謝謝你每次都來提醒我們。'],
        handled: '好，用餐限時，我們知道。這次吃完就走。',
        post: [
          { who: 'npc', text: '這兩件情侶圍裙，是我們拍第一支影片時穿的。分過手，也和好過，送你。' },
          { who: 'lin', text: '「一杯坐整天的情侶，終於坐到了終點」——明天頭版。' },
          { who: 'me', text: '……祝你們百年好合。用餐限時一百年。' },
        ],
      },
    ],
  },
];
export const ARC_BY_ID: Record<string, ArcDef> = Object.fromEntries(ARCS.map(a => [a.id, a]));

export function arcState(p: CareerProfile, id: string): ArcState { return p.arcs[id] ?? { stage: 0, seen: 0, at: 0 }; }
export const arcDone = (p: CareerProfile, id: string) => arcState(p, id).stage >= (ARC_BY_ID[id]?.stages.length ?? 0);

/** Speaker name / icon for an arc line. */
export function arcSpeaker(arc: ArcDef, who: ArcLine['who']) { return who === 'npc' ? { name: arc.name, icon: arc.icon } : CAST[who]; }

export interface ArcPick { arc: ArcDef; stage: number }
/**
 * Which regular (if any) shows up in this shift: the shift must already have that kind of karen (the daily / weekly
 * move them to the front so they arrive first), the stage's chapter must be reached, and a few shifts must have passed
 * since their last visit. Never in the first shift, a boss shift, endless or a raid. The arc furthest behind goes first.
 */
export function pickArc(p: CareerProfile, cfg: ShiftConfig): ArcPick | null {
  if (cfg.boss || cfg.endless || cfg.raid || cfg.mode !== 'shift' || cfg.id === '1-1') return null;
  let best: ArcPick | null = null;
  for (const arc of ARCS) {
    const st = arcState(p, arc.id);
    if (st.stage >= arc.stages.length) continue;
    if (st.stage > 0 && p.stats.shifts - st.at < ARC_GAP) continue;
    if (arc.stages[st.stage].minChapter > cfg.chapter) continue;
    if (arc.opensAfter && !p.stars[arc.opensAfter]) continue;
    if (!cfg.karens.includes(arc.kind)) continue;
    if (!best || st.stage < best.stage) best = { arc, stage: st.stage };
  }
  return best;
}

/**
 * The daily / weekly and the 特殊營業日 (shift ids "sp-…") put the regular first so they are the first karen through the
 * door (career shifts keep their order).
 */
export function arcConfig(cfg: ShiftConfig, pick: ArcPick): ShiftConfig {
  if (cfg.id === 'daily' || cfg.id === 'weekly' || cfg.id.startsWith('sp-')) cfg.karens = [pick.arc.kind, ...cfg.karens.filter(k => k !== pick.arc.kind)];
  return cfg;
}

/** The pre-shift card is shown once per stage. Returns its lines (and records it) or null when already seen. */
export function takePreScene(p: CareerProfile, pick: ArcPick): ArcLine[] | null {
  const st = { ...arcState(p, pick.arc.id) };
  if (st.seen > pick.stage) return null;
  st.seen = pick.stage + 1;
  p.arcs[pick.arc.id] = st;
  return pick.arc.stages[pick.stage].pre;
}

export interface ArcOutcome { advanced: boolean; completed: boolean; post: ArcLine[]; cosmetic?: string }
/** After the shift: a won shift where you dealt with the regular clears the stage; the last stage grants the cosmetic. */
export function finishArc(p: CareerProfile, pick: ArcPick, r: ShiftResult): ArcOutcome {
  const st = { ...arcState(p, pick.arc.id) };
  const none: ArcOutcome = { advanced: false, completed: false, post: [] };
  if (st.stage !== pick.stage || !r.won || (r.handled?.[pick.arc.kind] ?? 0) < 1) return none;
  st.stage++; st.seen = Math.max(st.seen, st.stage); st.at = p.stats.shifts;
  p.arcs[pick.arc.id] = st;
  const completed = st.stage >= pick.arc.stages.length;
  if (completed && !p.shop.owned.includes(pick.arc.reward.cosmetic)) p.shop.owned.push(pick.arc.reward.cosmetic);
  return { advanced: true, completed, post: pick.arc.stages[pick.stage].post, cosmetic: completed ? pick.arc.reward.cosmetic : undefined };
}
