// 存檔備份 screen (from 設定): export progress as a FUC1- code (copy / .txt download) and import one on another
// device. Encoding, validation and what is (not) included live in shared/savecode.ts.
// 雲端備份 (Google sign-in only) sits at the top: upload / restore (same comparison + double confirm as an import) / delete.
import { MAX_CODE_LEN, type SavePayload, type SaveSummary, applySave, exportSaveCode, parseSaveCode, summarizeStore } from '../../shared/savecode.ts';
import type { CloudEntry } from '../../shared/cloudsave.ts';
import { confirmTwice, esc, screenToken, show } from './ui.ts';
import { isNative } from './platform.ts';
import { loadAccount } from './account.ts';
import { cloudDelete, cloudDownload, cloudUpload, loadCloudPrefs, saveCloudPrefs, snapshotStorage as snapshot } from './cloudsave.ts';

const fmtDate = (t: number) => {
  if (!t) return '—';
  const d = new Date(t), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function compare(cur: SaveSummary, inc: SaveSummary, label = '存檔碼') {
  const rows: [string, string, string][] = [
    ['職級', `Lv.${cur.level} ${cur.rank}`, `Lv.${inc.level} ${inc.rank}`],
    ['星數', `★ ${cur.stars}`, `★ ${inc.stars}`],
    ['薪資點數', `💰 ${cur.wallet}`, `💰 ${inc.wallet}`],
    ['上班次數', `${cur.shifts}`, `${inc.shifts}`],
    ['成就', `${cur.achievements}`, `${inc.achievements}`],
    ['外觀', `${cur.cosmetics} 件`, `${inc.cosmetics} 件`],
    ['自由營業存檔', `${cur.soloSaves} 間`, `${inc.soloSaves} 間`],
    ['自己的店', cur.ownStore ? '有' : '沒有', inc.ownStore ? '有' : '沒有'],
    ['最高店面等級', cur.storeLevel ? `Lv${cur.storeLevel}` : '—', inc.storeLevel ? `Lv${inc.storeLevel}` : '—'],
    ['分店', `${cur.branches} 間`, `${inc.branches} 間`],
  ];
  return `<table class="bk-cmp"><tr><th></th><th>這台裝置（會被覆蓋）</th><th>${label}</th></tr>
    ${rows.map(([k, a, b]) => `<tr><td>${k}</td><td>${esc(a)}</td><td><b>${esc(b)}</b></td></tr>`).join('')}</table>`;
}

async function copyText(text: string, ta: HTMLTextAreaElement): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try { ta.focus(); ta.select(); return document.execCommand('copy'); } catch { return false; }
}

/** Writes a validated payload over this device's progress (keeps the account and this device's paid packs) and reloads. */
function applyAndReload(payload: SavePayload, res: HTMLElement, what: string) {
  const { set, remove } = applySave(payload, snapshot());
  try {
    for (const k of remove) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(set)) localStorage.setItem(k, v);
  } catch { res.innerHTML = `<p class="bk-err">❌ 無法寫入存檔（儲存空間已滿或被瀏覽器封鎖）。</p>`; return; }
  res.innerHTML = `<p>✅ ${what}完成，重新載入中…</p>`;
  setTimeout(() => location.reload(), 300);
}

function cloudSection(): string {
  if (!loadAccount()) {
    return `<h3>☁ 雲端備份</h3>
      <p class="muted" id="bk-cloud-need">雲端備份需要 Google 登入：回主選單，在證照那裡按「用 Google 登入」。沒登入也可以用下面的存檔碼備份。</p>`;
  }
  const p = loadCloudPrefs();
  return `<h3>☁ 雲端備份</h3>
    <div class="muted" id="bk-cloud-last">${p.lastUpload ? `上次上傳：${fmtDate(p.lastUpload)}${p.lastLevel ? `（Lv.${p.lastLevel}）` : ''}` : '這台裝置還沒上傳過'}</div>
    <div class="row">
      <button class="btn small good" id="bk-up">☁ 上傳到雲端</button>
      <button class="btn small info" id="bk-down">☁ 從雲端還原</button>
      <button class="btn small" id="bk-del">刪除雲端存檔</button>
    </div>
    <label class="chk"><input type="checkbox" id="bk-auto" ${p.auto ? 'checked' : ''}> 每天打烊存檔後自動上傳（最多每 10 分鐘一次）</label>
    <div id="bk-cres"></div>
    <p class="muted">雲端只放一份最新存檔和前一份；每個帳號每天最多上傳 20 次。付費擴充包不會跟著雲端存檔走（請用商城的「恢復購買」）。</p>`;
}

function wireCloud($: <T extends HTMLElement>(id: string) => T | null) {
  const cres = $<HTMLDivElement>('bk-cres');
  if (!cres) return;
  const last = $('bk-cloud-last')!;
  const busy = (on: boolean) => { for (const id of ['bk-up', 'bk-down', 'bk-del']) { const b = $<HTMLButtonElement>(id); if (b) b.disabled = on; } };
  $('bk-up')?.addEventListener('click', async () => {
    busy(true); cres.innerHTML = '<p class="muted">上傳中…</p>';
    const alive = screenToken();
    const r = await cloudUpload();
    if (!alive()) return; // left the backup screen meanwhile (the upload itself still happened)
    busy(false);
    if (!r.ok) { cres.innerHTML = `<p class="bk-err">❌ ${esc(r.error)}</p>`; return; }
    last.textContent = `上次上傳：${fmtDate(r.data.at)}（Lv.${r.data.summary.level}）`;
    cres.innerHTML = `<p>✅ 已上傳到雲端（今天第 ${r.data.used}/${r.data.max} 次）。</p>`;
  });
  const showEntry = (e: CloudEntry, prev: CloudEntry | null) => {
    const parsed = parseSaveCode(e.code);
    if (!parsed.ok) { cres.innerHTML = `<p class="bk-err">❌ 雲端存檔讀不出來：${esc(parsed.error)}</p>`; return; }
    cres.innerHTML = `
      <p class="muted">雲端存檔上傳時間：${fmtDate(e.at)}</p>
      ${compare(summarizeStore(snapshot()), parsed.summary, '雲端存檔')}
      <p class="bk-warn">⚠ 還原會<b>覆蓋這台裝置的進度</b>（職涯、自由營業存檔、設定），無法復原。Google 登入和已購買的擴充包會保留。</p>
      <div class="row"><button class="btn primary" id="bk-capply">用雲端存檔覆蓋並重新載入</button>
      ${prev ? `<button class="btn small" id="bk-cprev">改看上一份（${fmtDate(prev.at)}）</button>` : ''}</div>`;
    $<HTMLButtonElement>('bk-capply')!.addEventListener('click', ev => confirmTwice(ev.currentTarget as HTMLButtonElement, '再按一次確定覆蓋', () => applyAndReload(parsed.payload, cres, '還原')));
    $('bk-cprev')?.addEventListener('click', () => { if (prev) showEntry(prev, null); });
  };
  $('bk-down')?.addEventListener('click', async () => {
    busy(true); cres.innerHTML = '<p class="muted">讀取雲端存檔中…</p>';
    const alive = screenToken();
    const r = await cloudDownload();
    if (!alive()) return; // left meanwhile: never offer a restore on a screen the player is no longer on
    busy(false);
    if (!r.ok && r.status === 404) { last.textContent = '雲端上沒有存檔'; cres.innerHTML = '<p class="muted">☁ 雲端上還沒有存檔，先按「上傳到雲端」。</p>'; return; }
    if (!r.ok) { cres.innerHTML = `<p class="bk-err">❌ ${esc(r.error)}</p>`; return; }
    last.textContent = `上次上傳：${fmtDate(r.data.latest.at)}（Lv.${r.data.latest.summary.level}）`;
    showEntry(r.data.latest, r.data.prev);
  });
  $<HTMLButtonElement>('bk-del')?.addEventListener('click', ev => confirmTwice(ev.currentTarget as HTMLButtonElement, '再按一次刪除雲端存檔', async () => {
    busy(true);
    const alive = screenToken();
    const r = await cloudDelete();
    if (!alive()) return;
    busy(false);
    if (!r.ok) { cres.innerHTML = `<p class="bk-err">❌ ${esc(r.error)}</p>`; return; }
    last.textContent = '雲端上沒有存檔';
    cres.innerHTML = `<p>✅ ${r.data.deleted ? '雲端存檔已刪除（這台裝置的進度不受影響）。' : '雲端上本來就沒有存檔。'}</p>`;
  }));
  $<HTMLInputElement>('bk-auto')?.addEventListener('change', e => {
    const on = (e.target as HTMLInputElement).checked;
    saveCloudPrefs({ auto: on });
    cres.innerHTML = `<p class="muted">${on ? '已開啟：每天打烊存檔後會自動上傳（最多每 10 分鐘一次）。' : '已關閉自動上傳。'}</p>`;
  });
}

export function backupScreen(onBack: () => void) {
  const code = exportSaveCode(snapshot());
  const cur = summarizeStore(snapshot());
  show(`
    <div class="card bk">
      <div class="row"><h2>💾 存檔備份</h2><button class="btn small" id="bk-back">← 返回設定</button></div>
      ${cloudSection()}
      <p class="muted">不用帳號也能換裝置（網頁版、Android、Windows 互通）：把存檔碼複製起來，到另一台裝置的「設定 → 存檔備份」貼上。</p>
      <h3>📤 匯出這台裝置的進度</h3>
      <div class="muted">目前：Lv.${cur.level} ${esc(cur.rank)}・★ ${cur.stars}・💰 ${cur.wallet}</div>
      <textarea id="bk-out" class="bk-code" readonly rows="3">${esc(code)}</textarea>
      <div class="row">
        <button class="btn small good" id="bk-copy">📋 複製存檔碼</button>
        ${isNative ? '' : '<button class="btn small" id="bk-dl">⬇ 下載 .txt</button>'}
      </div>
      <div class="muted" id="bk-msg1">${isNative ? 'App 版請按複製，貼到記事本或傳訊息給自己保存。' : ''}</div>
      <p class="muted">不包含：Google 登入狀態、自訂伺服器、付費擴充包（擴充包請在新裝置用商城的「恢復購買」）。</p>
      <h3>📥 匯入存檔碼</h3>
      <textarea id="bk-in" class="bk-code" rows="3" placeholder="在這裡貼上 FUC1- 開頭的存檔碼"></textarea>
      <div class="row">
        <button class="btn small info" id="bk-check">檢查存檔碼</button>
        ${isNative ? '' : '<label class="btn small" id="bk-file-l">📂 讀取 .txt<input type="file" id="bk-file" accept=".txt,text/plain" hidden></label>'}
      </div>
      <div id="bk-res"></div>
    </div>`);
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const out = $<HTMLTextAreaElement>('bk-out')!, inp = $<HTMLTextAreaElement>('bk-in')!, res = $<HTMLDivElement>('bk-res')!;
  $('bk-back')?.addEventListener('click', onBack);
  wireCloud($);
  $('bk-copy')?.addEventListener('click', async () => {
    const alive = screenToken();
    const ok = await copyText(code, out);
    if (!alive()) return; // #bk-msg1 is gone once the player left
    $('bk-msg1')!.textContent = ok ? '✅ 已複製！貼到記事本、雲端或傳給自己保存。' : '無法自動複製，請長按上面的存檔碼全選後複製。';
  });
  $('bk-dl')?.addEventListener('click', () => {
    const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([code + '\n'], { type: 'text/plain' }));
    a.download = `fucustomer-save-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    $('bk-msg1')!.textContent = '✅ 已下載存檔檔案。';
  });
  $<HTMLInputElement>('bk-file')?.addEventListener('change', async e => {
    const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
    if (f.size > MAX_CODE_LEN) { res.innerHTML = `<p class="bk-err">❌ 檔案太大了，這不是存檔檔案。</p>`; return; }
    const alive = screenToken();
    const text = await f.text();
    if (!alive()) return;
    inp.value = text; check();
  });
  const check = () => {
    const r = parseSaveCode(inp.value);
    if (!r.ok) { res.innerHTML = `<p class="bk-err">❌ ${esc(r.error)}</p>`; return; }
    res.innerHTML = `
      <p class="muted">存檔碼建立時間：${fmtDate(r.summary.at)}</p>
      ${compare(summarizeStore(snapshot()), r.summary)}
      <p class="bk-warn">⚠ 匯入會<b>覆蓋這台裝置的進度</b>（職涯、自由營業存檔、設定），無法復原。Google 登入和已購買的擴充包會保留。</p>
      <button class="btn primary" id="bk-apply">覆蓋並重新載入</button>`;
    $<HTMLButtonElement>('bk-apply')!.addEventListener('click', e => confirmTwice(e.currentTarget as HTMLButtonElement, '再按一次確定覆蓋', () => applyAndReload(r.payload, res, '匯入')));
  };
  $('bk-check')?.addEventListener('click', check);
}
