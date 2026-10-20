// DOM menus: main menu, lobby, settings, in-game overlays (pause, shop, summary, quick messages).
import { MAPS } from '../../shared/maps/index.ts';
import { KAREN_INFO, MAX_PLAYERS, PRODUCT_INFO, PRODUCTS, QUICK_MESSAGES, UPGRADES, UPGRADE_IDS, shelfCapacity } from '../../shared/constants.ts';
import type { LobbyState, Snapshot, StoreSave } from '../../shared/protocol.ts';
import type { Settings } from './storage.ts';

const root = () => document.getElementById('ui')!;
export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const PLATFORM_ICON: Record<string, string> = { ios: '📱iOS', android: '📱Android', 'steam-pc': '🖥Steam', web: '🌐網頁', 'web-mobile': '📱網頁', solo: '' };

export function show(html: string, cls = 'screen') {
  root().innerHTML = `<div class="${cls}" id="screen">${html}</div>`;
  return root().firstElementChild as HTMLElement;
}
export function hide() { root().innerHTML = ''; }
export function isOpen() { return root().childElementCount > 0; }
function on(id: string, ev: string, fn: (e: Event) => void) { document.getElementById(id)?.addEventListener(ev, fn); }
function val(id: string) { return (document.getElementById(id) as HTMLInputElement).value; }

export interface MainMenuHandlers {
  career(): void;
  solo(fresh: boolean): void; create(continueCoop: boolean, map?: string): void; join(code: string): void; rejoin(): void; settings(): void;
  quit?(): void;
  /** First launch: jump straight into career shift 1-1. */
  firstDay?(): void;
  setName(n: string): void;
}

export function mainMenu(s: Settings, h: MainMenuHandlers, info: { soloSave: StoreSave | null; coopSave: StoreSave | null; canRejoin: string | null; server: string; platform: string; error?: string }) {
  const floaters = ['🧃', '🍙', '🥤', '🧋', '🍗', '👕', '🛒', '🧾', '🍞', '☕', '📦', '🧹'];
  show(`
    <div class="bgfx">${floaters.map((f, i) => `<span style="left:${(i * 83) % 100}%;animation-duration:${14 + (i * 7) % 11}s;animation-delay:-${(i * 5) % 14}s">${f}</span>`).join('')}</div>
    <div class="ts">
      <div class="ts-left">
        <div class="logo"><span class="l1">奧客</span><span class="l2">退散！</span><small>FUCUSTOMER</small></div>
        <div class="tagline">打工人認真上班，順便把奧客請出門</div>
        <div class="mascots"><span class="bob">🧑‍🍳</span><span class="vs">VS</span><span class="bob d">😤</span><span class="bob">🤳</span><span class="bob d">👑</span></div>
        <div class="ts-name">🪪<input type="text" id="m-name" maxlength="16" placeholder="你的名字" value="${esc(s.name)}" aria-label="你的名字"></div>
      </div>
      <div class="card">
        ${info.canRejoin ? `<button class="btn good" id="m-rejoin">🔌 重新連線到房間 ${esc(info.canRejoin)}</button>` : ''}
        ${h.firstDay ? `<div class="welcome"><b>👋 第一次來上班？</b><span>從第一天開始，會一步一步教你。</span><button class="btn good" id="m-first">▶ 開始第一天上班</button></div>` : ''}
        <button class="btn primary hero" id="m-career">🧑‍💼 職涯模式<span class="sub">從工讀生一路升到開自己的店</span></button>
        <button class="btn warn" id="m-solo-new">🗺 自由營業<span class="sub">${MAPS.length} 種店面：${MAPS.map(m => m.icon).join('')}</span></button>
        <div class="sectlabel">👥 多人合作（最多 ${MAX_PLAYERS} 人・測試中）</div>
        <div class="mp">
          <select id="m-map" aria-label="店面種類">${MAPS.map(m => `<option value="${m.id}">${m.icon} ${esc(m.name)}</option>`).join('')}</select>
          <button class="btn info" id="m-create">建立房間</button>
          <input type="text" class="code" id="m-code" maxlength="5" placeholder="房間碼" autocomplete="off" autocapitalize="characters">
          <button class="btn" id="m-join">加入</button>
        </div>
        ${info.coopSave ? `<label class="muted"><input type="checkbox" id="m-coop-cont" checked> 延續上次合作店面（第 ${info.coopSave.day} 天）</label>` : ''}
        <div class="err" id="m-err">${esc(info.error ?? '')}</div>
        <div class="ts-foot">
          <button class="btn small" id="m-settings">⚙ 設定</button>
          ${h.quit ? '<button class="btn small" id="m-quit">離開</button>' : ''}
          <span class="muted">伺服器 ${esc(info.server)}・${esc(info.platform)}</span>
        </div>
      </div>
    </div>`, 'screen title-bg');
  const name = () => { const n = val('m-name').trim(); h.setName(n); return n; };
  on('m-name', 'change', name);
  on('m-career', 'click', () => { name(); h.career(); });
  on('m-solo-new', 'click', () => { name(); h.solo(true); });
  on('m-create', 'click', () => { name(); h.create(!!(document.getElementById('m-coop-cont') as HTMLInputElement | null)?.checked, val('m-map') || undefined); });
  on('m-join', 'click', () => { name(); const c = val('m-code').trim().toUpperCase(); if (c.length < 5) { document.getElementById('m-err')!.textContent = '請輸入 5 碼房間碼'; return; } h.join(c); });
  on('m-code', 'keydown', e => { if ((e as KeyboardEvent).key === 'Enter') document.getElementById('m-join')!.click(); });
  on('m-rejoin', 'click', () => { name(); h.rejoin(); });
  on('m-settings', 'click', () => h.settings());
  on('m-quit', 'click', () => h.quit?.());
  on('m-first', 'click', () => { name(); h.firstDay?.(); });
}

export function settingsMenu(s: Settings, onDone: (s: Settings) => void, overlay = false) {
  show(`
    <div class="card">
      <h2>⚙ 設定</h2>
      <label class="field">畫質（手機建議「低」，玩法完全相同）
        <select id="s-q"><option value="low">低（省電）</option><option value="medium">中</option><option value="high">高（陰影）</option></select></label>
      <label class="field">視角靈敏度 <span id="s-sens-v"></span><input type="range" id="s-sens" min="0.2" max="3" step="0.1" value="${s.sensitivity}"></label>
      <label class="field">視野 FOV <span id="s-fov-v"></span><input type="range" id="s-fov" min="60" max="100" step="1" value="${s.fov}"></label>
      <label class="field">音效音量<input type="range" id="s-vol" min="0" max="1" step="0.05" value="${s.volume}"></label>
      <label class="field">音樂音量<input type="range" id="s-music" min="0" max="1" step="0.05" value="${s.music}"></label>
      <label class="field">幀率上限（手機建議 30，較省電）
        <select id="s-fps-cap"><option value="0">不限制</option><option value="60">60 FPS</option><option value="30">30 FPS</option></select></label>
      <label class="muted"><input type="checkbox" id="s-adapt" ${s.adaptive ? 'checked' : ''}> 自動調整解析度（卡頓時自動降低）</label><br>
      <label class="muted"><input type="checkbox" id="s-inv" ${s.invertY ? 'checked' : ''}> 反轉 Y 軸</label><br>
      <label class="muted"><input type="checkbox" id="s-fps" ${s.showFps ? 'checked' : ''}> 顯示 FPS</label>
      <label class="field">自訂伺服器（留空使用預設）<input type="text" id="s-url" placeholder="wss://example.com/ws" value="${esc(s.serverUrl)}"></label>
      <button class="btn primary" id="s-ok">完成</button>
    </div>`, overlay ? 'screen overlay' : 'screen');
  (document.getElementById('s-q') as HTMLSelectElement).value = s.quality;
  (document.getElementById('s-fps-cap') as HTMLSelectElement).value = String(s.fpsCap ?? 0);
  const upd = () => { document.getElementById('s-sens-v')!.textContent = val('s-sens'); document.getElementById('s-fov-v')!.textContent = val('s-fov'); };
  upd(); on('s-sens', 'input', upd); on('s-fov', 'input', upd);
  on('s-ok', 'click', () => {
    onDone({
      ...s, quality: val('s-q') as Settings['quality'], sensitivity: Number(val('s-sens')), fov: Number(val('s-fov')), volume: Number(val('s-vol')), music: Number(val('s-music')), fpsCap: Number(val('s-fps-cap')), adaptive: (document.getElementById('s-adapt') as HTMLInputElement).checked,
      invertY: (document.getElementById('s-inv') as HTMLInputElement).checked, showFps: (document.getElementById('s-fps') as HTMLInputElement).checked,
      serverUrl: val('s-url').trim(),
    });
  });
}

export function lobbyScreen(l: LobbyState, selfId: string, h: { ready(r: boolean): void; start(): void; leave(): void; copy(): void }) {
  const me = l.players.find(p => p.id === selfId);
  const isHost = l.hostId === selfId;
  const others = l.players.filter(p => p.id !== l.hostId && p.connected);
  const canStart = others.every(p => p.ready);
  show(`
    <div class="card">
      <h2>等候室</h2>
      <div class="muted" style="text-align:center">房間碼（手機、電腦、Steam 都輸入這組）</div>
      <div class="bigcode" id="l-code">${esc(l.code)}</div>
      <div class="row"><button class="btn small" id="l-copy">複製房間碼</button></div>
      <div class="muted">人數 ${l.players.length}/${l.max}・第 ${l.day} 天</div>
      <ul class="players">
        ${l.players.map(p => `<li><span class="dot" style="background:${hex(p.color)}"></span><b style="flex:1">${esc(p.name)}${p.id === selfId ? '（你）' : ''}</b>
          ${p.id === l.hostId ? '<span class="tag">👑 房主</span>' : ''}<span class="tag">${PLATFORM_ICON[p.platform] ?? esc(p.platform)}</span>
          ${!p.connected ? '<span class="tag off">斷線</span>' : p.id === l.hostId ? '' : p.ready ? '<span class="tag ok">已準備</span>' : '<span class="tag">未準備</span>'}</li>`).join('')}
      </ul>
      ${isHost
        ? `<button class="btn primary" id="l-start" ${canStart ? '' : 'disabled'}>${canStart ? '開始營業' : '等待所有人準備…'}</button>`
        : `<button class="btn ${me?.ready ? '' : 'good'}" id="l-ready">${me?.ready ? '取消準備' : '準備'}</button>`}
      <button class="btn" id="l-leave">離開房間</button>
    </div>`);
  on('l-start', 'click', () => h.start());
  on('l-ready', 'click', () => h.ready(!me?.ready));
  on('l-leave', 'click', () => h.leave());
  on('l-copy', 'click', () => h.copy());
}

export function message(title: string, body: string, btn = '確定', onOk?: () => void) {
  show(`<div class="card"><h2>${esc(title)}</h2><p>${esc(body)}</p><button class="btn primary" id="msg-ok">${esc(btn)}</button></div>`);
  on('msg-ok', 'click', () => { hide(); onOk?.(); });
}

export function pauseMenu(solo: boolean, code: string, h: { resume(): void; settings(): void; leave(): void; help(): void; endShift?: () => void }) {
  show(`
    <div class="card">
      <h2>選單</h2>
      ${solo ? '<p class="muted">單人遊戲已暫停。</p>' : `<p class="muted">⚠ 多人營業中：開選單<b>不會暫停</b>，隊友與顧客持續行動。房間碼 <b>${esc(code)}</b></p>`}
      <button class="btn primary" id="p-resume">回到遊戲</button>
      ${h.endShift ? '<button class="btn good" id="p-end">🌙 下班結算分數</button>' : ''}
      <button class="btn" id="p-help">玩法說明</button>
      <button class="btn" id="p-settings">設定</button>
      <button class="btn" id="p-leave">${solo ? '離開（本班不結算）' : '離開房間'}</button>
    </div>`, 'screen overlay');
  on('p-resume', 'click', () => h.resume());
  if (h.endShift) on('p-end', 'click', () => h.endShift!());
  on('p-settings', 'click', () => h.settings());
  on('p-leave', 'click', () => h.leave());
  on('p-help', 'click', () => h.help());
}

export function helpScreen(onBack: () => void) {
  show(`
    <div class="card wide">
      <h2>玩法說明</h2>
      <p><b>營業循環：</b>開店準備（採購、補貨、升級）→ 開門營業 08:00–22:00 → 打烊 → 日結 → 升級 → 下一天。</p>
      <div class="grid2">
        <div class="shopitem"><b>💳 收銀</b>走到櫃台內側面對收銀機按互動。顧客耐心用完會生氣離開、扣評價。</div>
        <div class="shopitem"><b>☕ 咖啡</b>在咖啡機互動煮咖啡，拿去「取餐區」交給等咖啡的顧客。</div>
        <div class="shopitem"><b>📦 補貨</b>倉庫（左上）拿貨箱，對同類貨架互動上架。貨架空了顧客會不滿。倉庫存貨不夠要採購（B）。</div>
        <div class="shopitem"><b>🧹 清潔</b>西側牆拿拖把，對地上髒污互動。髒污會持續拉低評價。</div>
      </div>
      <h3>奧客事件</h3>
      <div class="grid2">
        ${Object.values(KAREN_INFO).map(k => `<div class="shopitem"><b>${k.name}</b>${k.hint}<br><span class="muted">處理：${k.how}</span></div>`).join('')}
      </div>
      <h3>操作</h3>
      <p class="muted">電腦：WASD 移動、Shift 跑（耗體力）、滑鼠視角、左鍵/E 互動、右鍵/F 次要、G 放下、空白鍵 抓起/丟出、Q 拖把旋風、R 全店退散、V 標記、T 快捷訊息、B 採購、Enter 準備、Esc/P 選單。<br>
      手把：左搖桿移動、右搖桿視角、A 互動、X 次要、B 放下、Y 抓/丟、RB 旋風、LB 全店退散、L3/LT 跑、十字上 標記、十字下 採購、十字右 準備、Start 選單。<br>
      手機：左半邊拖曳＝搖桿、右半邊拖曳＝視角，右側按鈕互動／放下／抓丟／旋風／退散。</p>
      <p class="muted">抓起奧客後轉向發光出口丟出去，飛過門線才算送走；誤丟一般顧客會大扣分。混亂度滿 100% 或口碑歸零就提早下班。</p>
      <button class="btn primary" id="h-back">返回</button>
    </div>`, 'screen overlay');
  on('h-back', 'click', onBack);
}

export function quickMenu(onPick: (i: number) => void, onClose: () => void) {
  show(`<div class="card" id="quickmenu"><h2>快捷訊息</h2>
    ${QUICK_MESSAGES.map((m, i) => `<button class="btn" data-q="${i}">${i + 1}. ${esc(m)}</button>`).join('')}
    <button class="btn small" id="qm-close">關閉</button></div>`, 'screen overlay');
  root().querySelectorAll<HTMLButtonElement>('[data-q]').forEach(b => b.addEventListener('click', () => onPick(Number(b.dataset.q))));
  on('qm-close', 'click', onClose);
}

/** Shop: stock purchases any time; upgrades only during prep/summary. Re-rendered on snapshot changes. */
export function shopHtml(s: Snapshot, allowUpgrades: boolean) {
  const cap = shelfCapacity(s.upgrades.shelves);
  return `
    <h3>📦 採購貨箱（每箱 6 個，送到倉庫）　💰 $${s.money}</h3>
    <div class="grid2">${PRODUCTS.map(p => `<div class="shopitem"><b>${PRODUCT_INFO[p].name}</b>
      <span class="muted">售價 $${PRODUCT_INFO[p].price}/個・倉庫 ${s.backstock[p]}・貨架 ${s.shelves[p]}/${cap}</span>
      <button class="btn small" data-buy="stock_${p}" ${s.money < PRODUCT_INFO[p].boxCost ? 'disabled' : ''}>買一箱 $${PRODUCT_INFO[p].boxCost}</button></div>`).join('')}</div>
    <h3>🔧 設備升級 ${allowUpgrades ? '' : '<span class="muted">（營業中無法施工，開店前或日結時可升級）</span>'}</h3>
    <div class="grid2">${UPGRADE_IDS.map(u => {
      const d = UPGRADES[u]; const lv = s.upgrades[u]; const max = lv >= d.costs.length; const cost = d.costs[lv];
      return `<div class="shopitem"><b>${d.name} <span class="tag">Lv ${lv}/${d.costs.length}</span></b><span class="muted">${d.desc}</span><br>
        <button class="btn small" data-upg="${u}" data-lv="${lv}" ${max || !allowUpgrades || s.money < cost ? 'disabled' : ''}>${max ? '已滿級' : `升級 $${cost}`}</button></div>`;
    }).join('')}</div>`;
}

export function summaryHtml(s: Snapshot, selfId: string) {
  const d = s.dayStats;
  const me = s.players.find(p => p.id === selfId);
  const ratingDelta = s.rating - d.ratingStart;
  return `
    <h2>🌙 第 ${s.day} 天日結</h2>
    <div class="grid2">
      <div>
        <div class="stat"><span>營業收入</span><b>$${d.revenue}</b></div>
        <div class="stat"><span>　其中小費</span><b>$${d.tips}</b></div>
        <div class="stat"><span>每日獎勵（評價＋奧客處理）</span><b>+$${d.bonus}</b></div>
        <div class="stat"><span>支出（進貨＋租金＋員工薪水）</span><b>-$${d.expenses}</b></div>
        <div class="stat"><span>現金</span><b>$${s.money}</b></div>
      </div>
      <div>
        <div class="stat"><span>服務顧客</span><b>${d.served}</b></div>
        <div class="stat"><span>生氣離開</span><b>${d.angryLeft}</b></div>
        <div class="stat"><span>奧客處理 成功/失敗</span><b>${d.karensResolved} / ${d.karensFailed}</b></div>
        <div class="stat"><span>清潔髒污</span><b>${d.spillsCleaned}</b></div>
        <div class="stat"><span>評價</span><b>★${s.rating.toFixed(2)} (${ratingDelta >= 0 ? '+' : ''}${ratingDelta.toFixed(2)})</b></div>
      </div>
    </div>
    <h3>隊伍</h3>
    <div>${s.players.map(p => `<span class="tag" style="margin:2px;display:inline-block"><span class="dot" style="display:inline-block;width:10px;height:10px;background:${hex(p.color)}"></span> ${esc(p.name)} ${p.ready ? '✅' : '⏳'}</span>`).join('')}</div>
    <div id="sum-shop"></div>
    <button class="btn ${me?.ready ? '' : 'primary'}" id="sum-ready">${me?.ready ? '等待隊友…（取消準備）' : `準備開始第 ${s.day + 1} 天`}</button>`;
}

/** Free play: pick a store type. Each map keeps its own save. */
export function mapPicker(saves: Record<string, StoreSave | null>, h: { play(map: string, fresh: boolean): void; back(): void }) {
  show(`<div class="card wide"><div class="row" style="align-items:center"><h2 style="flex:1;margin:0">選擇店面</h2><button class="btn small" id="mp-back" style="flex:0">← 主選單</button></div>
    <p class="muted">每種店賣的東西、擺設和工作站都不一樣。各自有獨立的存檔。</p>
    <div class="grid2">${MAPS.map(m => {
      const sv = saves[m.id];
      const foods = [m.coffee && `${m.coffee.icon}${m.coffee.food}`, m.meal && `${m.meal.icon}${m.meal.food}`].filter(Boolean).join('、') || '不賣吃的';
      return `<div class="shopitem mapcard"><b style="font-size:20px">${m.icon} ${esc(m.name)}</b>
        <span class="muted">${esc(m.desc)}</span>
        <span class="muted">商品：${(['drinks', 'snacks', 'bento'] as const).map(p => esc(m.products[p].name)).join('、')}・現做：${esc(foods)}</span>
        <div class="row">${sv ? `<button class="btn primary" data-map-cont="${m.id}">繼續（第 ${sv.day} 天）</button>` : ''}
        <button class="btn ${sv ? '' : 'primary'}" data-map="${m.id}">${sv ? '重新開店' : '開店營業'}</button></div></div>`;
    }).join('')}</div></div>`);
  document.getElementById('mp-back')!.onclick = () => h.back();
  document.querySelectorAll<HTMLButtonElement>('[data-map-cont]').forEach(b => { b.onclick = () => h.play(b.dataset.mapCont!, false); });
  document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => {
    b.onclick = () => (saves[b.dataset.map!] ? confirmTwice(b, '再按一次：覆蓋這間店的進度', () => h.play(b.dataset.map!, true)) : h.play(b.dataset.map!, true));
  });
}

/** In-page confirmation (works where dialogs are blocked): the first press arms the button, the second one acts. */
export function confirmTwice(btn: HTMLButtonElement, armedLabel: string, act: () => void) {
  if (btn.dataset.armed === '1') { act(); return; }
  btn.dataset.armed = '1'; btn.dataset.label = btn.textContent ?? '';
  btn.textContent = armedLabel; btn.classList.add('armed');
  window.setTimeout(() => { if (btn.isConnected && btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = btn.dataset.label ?? ''; btn.classList.remove('armed'); } }, 4000);
}
