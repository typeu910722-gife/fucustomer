// Main story: short dialogue scenes at the start and end of each chapter (played once, skippable).
// All characters and companies are fictional.

export const CAST = {
  me: { name: '你', icon: '🧑' },
  boss: { name: '錢董', icon: '🤑' },
  fen: { name: '阿芬姐', icon: '👩‍🦱' },
  lin: { name: '記者小林', icon: '🎤' },
  king: { name: '奧客之王', icon: '👑' },
  cop: { name: '警察', icon: '👮' },
} as const;
export type Speaker = keyof typeof CAST;
export interface Line { who: Speaker; text: string }
/** `inStore`: played as speech bubbles inside the store while the player can already move (no modal cards). */
export interface Scene { id: string; title: string; lines: Line[]; inStore?: boolean }

export const SCENES: Record<string, Scene> = {
  // the very first scene plays inside the store (bubbles) so a new player is walking within seconds
  'ch1-intro': { id: 'ch1-intro', title: '第 1 章・巷口小店', inStore: true, lines: [
    { who: 'me', text: '存款 $87，房租下週到期。打工存錢，總有一天開自己的店！' },
    { who: 'boss', text: '新來的？我錢董。時薪照規定給，扣薪也照規定扣。' },
    { who: 'fen', text: '我阿芬。顧客至上，但奧客……你等一下就懂了。' },
  ] },
  'ch1-outro': { id: 'ch1-outro', title: '試用期結束', lines: [
    { who: 'boss', text: '試用期過了，恭喜轉正。對了，這個月扣「制服清潔費」跟「收銀短少」。' },
    { who: 'me', text: '收銀明明沒有少……' },
    { who: 'fen', text: '噓，小費才是你的。還有：奧客先失控、先推你，你才能「出手」，那叫正當防衛。' },
    { who: 'fen', text: '你先動手，或打到有背景的人……警察會來找你。' },
  ] },
  'ch2-intro': { id: 'ch2-intro', title: '第 2 章・深夜班', lines: [
    { who: 'boss', text: '24 小時店缺大夜。時薪加 20，但凌晨的電費要分攤一下。' },
    { who: 'me', text: '分攤……電費？' },
    { who: 'fen', text: '半夜的奧客比較兇。有些人戴金錶、講電話很大聲——那種多半「有背景」，盡量別碰。' },
  ] },
  'ch2-outro': { id: 'ch2-outro', title: '天亮了', lines: [
    { who: 'me', text: '（存摺餘額：比上個月多一點點。）' },
    { who: 'boss', text: '你表現不錯，所以——車站店交給你。業績做起來，我就加薪。' },
    { who: 'fen', text: '他每個人都這樣說。' },
  ] },
  'ch3-intro': { id: 'ch3-intro', title: '第 3 章・車站店', lines: [
    { who: 'fen', text: '車站店人多，有些奧客塊頭大到抓不動。先出手把他揍暈，或用拖把旋風轉暈，再抓起來丟出去。' },
    { who: 'me', text: '這份工作的職務說明裡沒有寫這個……' },
    { who: 'boss', text: '職務說明？那是什麼？' },
  ] },
  'ch3-outro': { id: 'ch3-outro', title: '升職', lines: [
    { who: 'boss', text: '恭喜升副店長！薪水不變，但責任加倍。' },
    { who: 'lin', text: '你好，我是地方記者小林。聽說這家店的老闆……很會扣薪水？有需要可以找我。' },
  ] },
  'ch4-intro': { id: 'ch4-intro', title: '第 4 章・觀光旗艦店', lines: [
    { who: 'boss', text: '旗艦店兩台收銀機，觀光客多。業績不好的話，你這個副店長……' },
    { who: 'fen', text: '門口插座最近常被人霸佔充電，電費又會算到我們頭上。拔兩次插頭，或請他喝杯咖啡就好。' },
  ] },
  'ch4-outro': { id: 'ch4-outro', title: '評鑑通過', lines: [
    { who: 'boss', text: '評鑑通過了。很好，店長的位子……就先給你試做。' },
    { who: 'me', text: '（存摺越來越厚了。離開店的目標，好像沒那麼遠。）' },
  ] },
  'ch5-intro': { id: 'ch5-intro', title: '第 5 章・跨年夜美食街', lines: [
    { who: 'boss', text: '跨年夜，所有奧客一次到齊。這是你的升職考核。' },
    { who: 'fen', text: '撐過今晚，你就是真正的店長了。' },
  ] },
  'ch5-outro': { id: 'ch5-outro', title: '新年快樂', lines: [
    { who: 'lin', text: '新年快樂！聽說「奧客之王」要來你們總公司了……全台灣的店員都在等著看。' },
    { who: 'boss', text: '你去處理。處理好了，年終……再說。' },
  ] },
  'ch6-intro': { id: 'ch6-intro', title: '第 6 章・奧客之王', lines: [
    { who: 'king', text: '我買一瓶水要用十種優惠、插隊、退貨、開直播、再叫小弟來助陣。這就是我的人生。' },
    { who: 'fen', text: '他會分五個階段鬧事。一關一關破。他失控的時候，出手算正當防衛。' },
    { who: 'me', text: '來吧。為了我的店。' },
  ] },
  'ch6-outro': { id: 'ch6-outro', title: '結局：辭職信', lines: [
    { who: 'king', text: '……你，是第一個讓我退散的店員。' },
    { who: 'boss', text: '幹得好！這個月扣——' },
    { who: 'me', text: '錢董，這是我的辭職信。我要用自己存的錢，開自己的店。' },
    { who: 'fen', text: '去吧。記得開店也會倒閉，別把錢一次花光。還有，下班前記得鎖門。' },
    { who: 'lin', text: '「便利商店打工人勇退奧客之王，自立門戶」——明天頭版就是你。' },
  ] },
  'ch7-intro': { id: 'ch7-intro', title: '第 7 章・轉職之路', lines: [
    { who: 'fen', text: '別急著開店。早餐店、手搖飲、服飾店、雞排店……每一種店的奧客都不一樣。先去見習。' },
    { who: 'me', text: '改單、改甜度、試穿一百件……聽起來都很可怕。' },
    { who: 'lin', text: '我正在做專題「全台奧客圖鑑」，你去哪我就跟去哪。' },
  ] },
  'ch7-outro': { id: 'ch7-outro', title: '圖鑑才寫了四頁', lines: [
    { who: 'me', text: '早餐店、手搖飲、服飾店、雞排店都走過一輪了。我好像知道自己想開哪一種店了。' },
    { who: 'lin', text: '等等！我的「全台奧客圖鑑」才寫了四頁。藥妝店、書店、電影院、郵局……每一種店都有自己的招牌奧客。' },
    { who: 'fen', text: '想開店隨時可以去「我的店」分頁。不過多看幾種店，開店時才不會被嚇到。' },
  ] },
  'ch8-intro': { id: 'ch8-intro', title: '第 8 章・商圈見習週', lines: [
    { who: 'fen', text: '這週我幫你排了商圈見習：藥妝店、書店、麵包店、超市、寵物店、咖啡廳，一天一間。' },
    { who: 'lin', text: '每間店我都採訪好了。藥妝店的試用品、書店坐地上看書的、麵包店用手摸的……你負責處理，我負責拍照。' },
    { who: 'boss', text: '（打電話來）聽說你在別人的店打工？哼，我的店也缺人，時薪照舊，扣薪……也照舊。' },
    { who: 'me', text: '錢董，我現在是去學東西的。不用扣了，謝謝。' },
  ] },
  'ch8-outro': { id: 'ch8-outro', title: '圖鑑第二集', lines: [
    { who: 'lin', text: '「試吃狂、狗狗試吃團、一杯坐整天」——第二集的稿子寫好了！讀者留言都說「我們店也有」。' },
    { who: 'fen', text: '你發現了嗎？每種店的奧客都不一樣，可是處理的道理是一樣的：先看懂他要什麼。' },
    { who: 'me', text: '有的要遞夾子、有的要續杯、有的只要好好說兩次。……我好像越來越會了。' },
    { who: 'lin', text: '那接下來去晚上的店。電影院、吃到飽、加油站——夜生活的奧客，才是真正的大魔王。' },
  ] },
  'ch9-intro': { id: 'ch9-intro', title: '第 9 章・夜生活', lines: [
    { who: 'lin', text: '晚上的店我都約好了：電影院、火鍋吃到飽、加油站、健身房、牛排館，最後回雞排店吃宵夜。' },
    { who: 'fen', text: '吃到飽要注意偷打包的，他們不會讓你看見。加油站拖把記得帶著，有人會要你擦車窗。' },
    { who: 'me', text: '……用拖把擦車窗？' },
    { who: 'fen', text: '別問。客人開心就好。' },
  ] },
  'ch9-outro': { id: 'ch9-outro', title: '宵夜時間', lines: [
    { who: 'me', text: '（雞排店打烊，三個人坐在路邊吃雞排。）' },
    { who: 'lin', text: '回鍋魔人說他下次還要來。我想他是喜歡你。' },
    { who: 'fen', text: '我做了十年才知道一件事：大部分客人都是好人，只是有時候累了。真正的奧客，是少數。' },
    { who: 'boss', text: '（打電話來）總公司說要做「全台奧客圖鑑」聯名活動，在我的店辦。你……要不要回來幫忙一天？時薪照舊。' },
  ] },
  'ch10-intro': { id: 'ch10-intro', title: '第 10 章・全台奧客圖鑑', lines: [
    { who: 'lin', text: '最後幾頁：3C 賣場的拆封退貨、美髮院的照片魔人、郵局的一袋零錢、藥局、飯店。寫完就出版！' },
    { who: 'fen', text: '出版那天，錢董要在店裡辦簽書會。他說圖鑑裡的奧客都會「被邀請」來。' },
    { who: 'me', text: '把全台灣最難搞的奧客找到同一間店……這不是簽書會，這是期末考。' },
  ] },
  'ch10-outro': { id: 'ch10-outro', title: '結局：我的店', lines: [
    { who: 'lin', text: '《全台奧客圖鑑》第一刷賣完了！封面人物——就是你。' },
    { who: 'boss', text: '幹得好！要不要回來當我的合夥人？分紅照……照規定給。' },
    { who: 'me', text: '錢董，謝謝。可是我想開自己的店。我知道每一種店的奧客長什麼樣子了。' },
    { who: 'fen', text: '去吧。記得：開店會倒閉，員工要照顧，下班要鎖門。還有——奧客退散。' },
  ] },
  'store-open': { id: 'store-open', title: '開幕', lines: [
    { who: 'me', text: '鐵門拉起來的聲音，從來沒有這麼好聽過。這是我的店。' },
    { who: 'fen', text: '恭喜！記得：現在付薪水的是你。對員工好一點，他們做事才會用心。' },
    { who: 'lin', text: '開幕快樂！我會寫一篇報導……如果你哪天倒閉，我也會寫。' },
    { who: 'boss', text: '（打電話來）聽說你開店了？哼，撐不過一個月的。' },
  ] },
  'store-bankrupt': { id: 'store-bankrupt', title: '倒閉', lines: [
    { who: 'me', text: '……鐵門拉下來了。投進去的錢，全部沒了。' },
    { who: 'lin', text: '「打工人創業夢碎」……抱歉，這是我的工作。但我相信你會再站起來。' },
    { who: 'fen', text: '我當年也倒過一次。回來打工吧，重新存，下一次會更好。' },
    { who: 'boss', text: '（打電話來）缺人喔，時薪照舊。扣薪……也照舊。' },
  ] },
  'first-court': { id: 'first-court', title: '警察來了', lines: [
    { who: 'cop', text: '店員先生／小姐，有人報案說你在店裡動手打人。麻煩跟我們走一趟。' },
    { who: 'fen', text: '別緊張。誠實說明就好。如果遇到「恐龍法官」……你也可以做點不一樣的事。' },
  ] },
};

/** End-of-shift hook on the result screen (won shifts of the first chapter): a teaser for tomorrow. */
export const SHIFT_HOOKS: Record<string, Line & { bye: string }> = {
  '1-1': { who: 'fen', text: '第一天就撐過來了，不錯喔。明天這個時間王阿姨會來，她會說她「只有一瓶」。', bye: '明天見！' },
  '1-2': { who: 'boss', text: '還行。明天客人會打翻東西，拖把記得帶——清潔費我照扣。', bye: '明天見。' },
};

/** Scene to show before starting a shift (chapter intro on its first shift). */
export function sceneBefore(shiftId: string): string | null {
  const m = /^(\d+)-1$/.exec(shiftId);
  return m ? `ch${m[1]}-intro` : null;
}
/** Scene to show after winning a shift (chapter outro after its last shift). */
export function sceneAfter(shiftId: string, lastShiftOfChapter: Record<number, string>): string | null {
  const ch = Number(shiftId.split('-')[0]);
  return lastShiftOfChapter[ch] === shiftId ? `ch${ch}-outro` : null;
}
