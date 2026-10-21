// "Link via browser": Google refuses to sign in inside the iOS/Android app's WebView, so the app signs in through the
// system browser instead.
//   App:     POST /api/auth/link/start → { code, pollToken } → opens LINK_WEB_BASE#link=CODE in the browser and polls
//            /api/auth/link/poll with the poll token (the token never leaves the app; the code alone gets nothing).
//   Browser: the page sees #link=CODE, the player signs in with Google as usual and confirms → /api/auth/link/complete
//            mints a NEW session for that licence, which the app picks up on its next poll.
import { completeAppLink, LINK_WEB_BASE, loadAccount, pollAppLink, renderGoogleButton, startAppLink, type LicenseCard } from './account.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** "k7q4mz" → "K7Q-4MZ"; '' when it can't be a link code (same rule as the server). */
export function normalizeLinkCode(v: string): string {
  const c = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 6 && [...c].every(ch => ALPHABET.includes(ch)) ? c.slice(0, 3) + '-' + c.slice(3) : '';
}

/** A full-screen card above whatever screen is showing (independent of ui.ts's screen root). */
function overlay(): HTMLElement {
  document.getElementById('applink')?.remove();
  const el = document.createElement('div');
  el.id = 'applink'; el.className = 'screen overlay'; el.style.zIndex = '60';
  document.body.appendChild(el);
  return el;
}

/** Opens the system browser (Custom Tab / SFSafariViewController via @capacitor/browser), falling back to window.open. */
async function openExternal(url: string) {
  try { const { Browser } = await import('@capacitor/browser'); await Browser.open({ url }); }
  catch { window.open(url, '_system'); }
}

// ---------------- app side ----------------
export function renderAppLinkButton(el: HTMLElement, onSignedIn: (card: LicenseCard) => void) {
  el.innerHTML = '<button class="btn small info" id="m-applink">🌐 用瀏覽器登入 Google</button>';
  el.querySelector('button')!.addEventListener('click', () => void appLinkCard(onSignedIn));
}

export async function appLinkCard(onSignedIn: (card: LicenseCard) => void) {
  const box = overlay();
  const close = () => box.remove();
  const render = (html: string) => { box.innerHTML = `<div class="card" style="max-width:420px;text-align:center">${html}</div>`; box.querySelector('#al-cancel')?.addEventListener('click', close); };
  render('<h2>🌐 用瀏覽器登入</h2><p class="muted">準備中…</p><button class="btn small" id="al-cancel" data-back>取消</button>');
  const s = await startAppLink();
  if (!box.isConnected) return;
  if (!s.ok) { render(`<h2>🌐 用瀏覽器登入</h2><div class="err">${esc(s.error)}</div><button class="btn small" id="al-cancel" data-back>關閉</button>`); return; }
  const { code, pollToken } = s.data;
  const url = `${LINK_WEB_BASE}#link=${encodeURIComponent(code)}`;
  const until = Date.now() + s.data.expiresIn * 1000;
  render(`<h2>🌐 用瀏覽器登入</h2>
    <p class="muted">App 裡沒辦法直接用 Google 登入，所以改用瀏覽器。瀏覽器會顯示同一組代碼：</p>
    <div style="font-size:34px;font-weight:900;letter-spacing:4px;margin:8px 0" id="al-code">${esc(code)}</div>
    <p id="al-status">⏳ 等待瀏覽器登入…</p>
    <p class="muted" style="font-size:12px">代碼 10 分鐘內有效，只能用一次。</p>
    <div class="row"><button class="btn small info" id="al-open">再開一次瀏覽器</button><button class="btn small" id="al-cancel" data-back>取消</button></div>`);
  box.querySelector('#al-open')?.addEventListener('click', () => void openExternal(url));
  void openExternal(url);
  const status = (t: string) => { const e = box.querySelector('#al-status'); if (e) e.textContent = t; };
  let busy = false;
  const tick = async () => {
    if (!box.isConnected || busy) return;
    if (Date.now() > until) { stop(); status('⌛ 代碼過期了，請關掉再按一次登入'); return; }
    busy = true;
    const r = await pollAppLink(pollToken);
    busy = false;
    if (!box.isConnected) return stop();
    if (!r.ok) { if (/過期/.test(r.error)) { stop(); status('⌛ 代碼過期了，請關掉再按一次登入'); } else status('⏳ ' + r.error + '（繼續等待…）'); return; }
    if ('session' in r.data) { stop(); close(); onSignedIn(r.data.card); }
  };
  const timer = window.setInterval(() => void tick(), 2500);
  const onVisible = () => { if (document.visibilityState === 'visible') void tick(); }; // back from the browser: check right away
  document.addEventListener('visibilitychange', onVisible);
  function stop() { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); }
}

// ---------------- web side: …/#link=CODE ----------------
export function webLinkCard(raw: string) {
  const code = normalizeLinkCode(raw);
  const box = overlay();
  const close = () => { box.remove(); if (/link=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); };
  const render = (html: string) => {
    box.innerHTML = `<div class="card" style="max-width:440px;text-align:center"><h2>📲 把登入帶回 App</h2>${html}</div>`;
    box.querySelector('#al-cancel')?.addEventListener('click', close);
  };
  if (!code) { render('<div class="err">代碼格式不對，請回到 App 重新按登入。</div><button class="btn small" id="al-cancel" data-back>關閉</button>'); return; }
  const head = `<div style="font-size:30px;font-weight:900;letter-spacing:4px;margin:6px 0">代碼 ${esc(code)}</div>
    <p class="muted" style="font-size:13px">請確認 App 上顯示的是同一組代碼。只有在你自己剛剛從 App 按下登入時才繼續，別幫別人傳來的代碼登入。</p>`;
  const step = () => {
    const a = loadAccount();
    if (!a) {
      render(`${head}<p>先用 Google 登入：</p><div id="al-google" style="display:flex;justify-content:center;min-height:40px"></div><div class="err" id="al-err"></div><button class="btn small" id="al-cancel" data-back>取消</button>`);
      const g = box.querySelector<HTMLElement>('#al-google')!;
      void renderGoogleButton(g, () => step(), m => { const e = box.querySelector('#al-err'); if (e) e.textContent = m; });
      return;
    }
    render(`${head}<p>已登入證照 <b>${esc(a.no)}</b>，要把這個登入帶給 App 嗎？</p><div class="err" id="al-err"></div>
      <div class="row"><button class="btn good" id="al-go">✅ 帶回 App</button><button class="btn small" id="al-cancel" data-back>取消</button></div>`);
    const go = box.querySelector<HTMLButtonElement>('#al-go')!;
    go.addEventListener('click', async () => {
      go.disabled = true;
      const r = await completeAppLink(code);
      if (!r.ok) { if (/重新登入/.test(r.error)) step(); const e = box.querySelector('#al-err'); if (e) e.textContent = r.error; go.disabled = false; return; }
      history.replaceState(null, '', location.pathname + location.search); // a reload shouldn't offer the used code again
      render(`<p style="font-size:22px;font-weight:900">✅ 完成，回到 App 吧</p><p class="muted">App 會在幾秒內自動登入證照 ${esc(r.data.no)}。這個分頁可以關掉了。</p><button class="btn small" id="al-cancel" data-back>關閉</button>`);
    });
  };
  step();
}

/** Called once at start-up (web only): show the card when the page was opened as …#link=CODE. */
export function checkLinkHash() {
  const m = /[#&]link=([^&]+)/.exec(location.hash);
  if (m) webLinkCard(decodeURIComponent(m[1]));
}
