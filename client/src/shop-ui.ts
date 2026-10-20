// 🛍 商城 tab of the career screen: cosmetics bought with 薪資點數 (try on in a 3D preview, buy, equip) and the paid packs
// (store types for free play / own store / hosting multiplayer, supporter pack). Real payments are not wired yet:
// buying a pack asks the platform adapter (billing.ts), which answers 「付款功能準備中」.
import type { CareerProfile } from '../../shared/career.ts';
import {
  COSMETICS, Cosmetic, CosmeticSlot, DECOR_SLOTS, Loadout, PACKS, PACK_BY_ID, PRICE_NOTE, SLOT_INFO, buyCosmetic, effectiveLoadout,
  equipCosmetic, getCosmetic, outfitOf, ownsCosmetic, storeLocked, type Pack, type PlayMode,
} from '../../shared/shop.ts';
import { getMap } from '../../shared/maps/index.ts';
import { billing, devShop, entitlementsFor } from './billing.ts';
import { mountPreview } from './cosmetics.ts';
import { esc } from './ui.ts';

type Filter = 'all' | 'hat' | 'uniform' | 'tag' | 'decor' | 'packs';
const FILTERS: [Filter, string][] = [['all', '全部'], ['hat', '🧢 帽子'], ['uniform', '🦺 圍裙'], ['tag', '📛 名牌'], ['decor', '🏪 店面裝飾'], ['packs', '🎁 擴充包']];
let filter: Filter = 'all';
let trying: Loadout = {};
let preview: ReturnType<typeof mountPreview> = null;
let lastMsg = '';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const inFilter = (c: Cosmetic) => filter === 'all' || (filter === 'decor' ? DECOR_SLOTS.includes(c.slot) : c.slot === filter);

/** The pack that blocks this store in this mode for this player (null = playable). */
export function lockedPack(p: CareerProfile, mapId: string, mode: PlayMode): Pack | null { return storeLocked(mapId, mode, entitlementsFor(p)); }

function itemHtml(p: CareerProfile, c: Cosmetic, ents: string[]) {
  const own = ownsCosmetic(p, c.id, ents);
  const on = p.shop.equipped[c.slot] === c.id && own;
  const pack = c.pack ? PACK_BY_ID[c.pack] : null;
  let act: string;
  if (on) act = `<span class="tag ok">✅ 使用中</span><button class="btn small" data-cos-off="${c.slot}">卸下</button>`;
  else if (own) act = `<button class="btn small info" data-cos-eq="${c.id}">${DECOR_SLOTS.includes(c.slot) ? '擺上' : '穿上'}</button>`;
  else if (c.price !== undefined) act = `<button class="btn small primary" data-cos-buy="${c.id}" ${p.wallet >= c.price ? '' : 'disabled'}>💰 ${c.price}</button>`;
  else act = `<span class="tag lock">🔒限定</span><button class="btn small purple" data-pack-buy="${pack?.id ?? ''}">${esc(pack?.name ?? '')}</button>`;
  return `<div class="shopitem cos ${on ? 'on' : ''} ${trying[c.slot] === c.id ? 'trying' : ''}" data-try="${c.id}">
    <div class="cos-icon" style="--c:${hex(c.color)}">${c.icon}</div>
    <div class="cos-info"><b>${esc(c.name)}</b><span class="muted">${SLOT_INFO[c.slot].name}・${esc(c.desc)}</span>
      <div class="cos-act">${act}</div></div></div>`;
}

function packHtml(p: CareerProfile, k: Pack, ents: string[], focus?: string) {
  const bought = p.shop.entitlements.includes(k.id), dev = !bought && ents.includes(k.id);
  const stores = k.stores.map(id => { const m = getMap(id); return `<span class="tag">${m.icon} ${esc(m.name)}</span>`; }).join('');
  const items = k.items.map(id => { const c = getCosmetic(id); return c ? `<span class="tag">${c.icon} ${esc(c.name)}</span>` : ''; }).join('');
  return `<div class="shopitem pack ${focus === k.id ? 'focus' : ''}" id="pack-${k.id}">
    <b>${k.icon} ${esc(k.name)} ${bought ? '<span class="tag ok">✅ 已擁有</span>' : dev ? '<span class="tag ok">🧪 測試解鎖</span>' : '<span class="tag lock">🔒限定</span>'}</b>
    <span class="muted">${esc(k.desc)}</span>
    ${stores ? `<div class="pack-tags">${stores}</div>` : ''}<div class="pack-tags">${items}</div>
    <div class="row pack-buy"><span class="price">${esc(k.price)}</span>${bought ? '' : `<button class="btn small primary" data-pack-buy="${k.id}">購買</button>`}</div></div>`;
}

export function shopHtml(p: CareerProfile, focus?: string): string {
  if (focus && PACK_BY_ID[focus]) filter = 'packs';
  else if (focus && FILTERS.some(([f]) => f === focus)) filter = focus as Filter;
  const ents = entitlementsFor(p);
  const wearing = effectiveLoadout(p, ents);
  const chips = (Object.keys(SLOT_INFO) as CosmeticSlot[]).map(s => { const c = getCosmetic(wearing[s]); return `<span class="tag" title="${SLOT_INFO[s].name}">${c ? c.icon : '・'} ${SLOT_INFO[s].name}</span>`; }).join('');
  const list = filter === 'packs' ? '' : `<div class="cosgrid">${COSMETICS.filter(inFilter).map(c => itemHtml(p, c, ents)).join('')}</div>`;
  const packs = filter === 'packs' || filter === 'all'
    ? `<h3>🎁 擴充包（真錢購買・${esc(PRICE_NOTE)}）</h3><div class="cosgrid packs">${PACKS.map(k => packHtml(p, k, ents, focus)).join('')}</div>
       <p class="muted">📖 主線劇情永遠免費：擴充包裡的店，在主線第 9、10 章上班時都玩得到；加入朋友開的房間也不用買。擴充包只影響「自由營業／自己開店／自己開房」能不能選這些店，不影響能力數值。</p>
       <div class="row"><button class="btn small" id="shop-restore">🔄 恢復購買</button></div>`
    : '';
  return `${devShop() ? '<div class="devbanner">🧪 測試模式（網址有 ?devshop=1）：所有擴充包暫時解鎖，不會存進存檔</div>' : ''}
    <div class="shopwrap">
      <div class="shop-prev">
        <canvas id="shop-canvas"></canvas>
        <div class="muted shop-hint">點商品可以先試穿・拖曳旋轉</div>
        <div class="pack-tags">${chips}</div>
        <div class="wallet-line">💰 ${p.wallet} <small>薪資點數（上班賺的）</small></div>
      </div>
      <div class="shop-list">
        <div class="tabs shopfilters">${FILTERS.map(([f, l]) => `<button class="tab ${f === filter ? 'on' : ''}" data-shop-filter="${f}">${l}</button>`).join('')}</div>
        <div class="shop-msg" id="shop-msg">${esc(lastMsg)}</div>
        ${list}${packs}
      </div>
    </div>`;
}

/** Hooks up the shop tab after the career screen is shown. `redraw(focus)` re-renders the tab. */
export function wireShop(p: CareerProfile, save: (p: CareerProfile) => void, redraw: (focus?: string) => void) {
  const ents = entitlementsFor(p);
  const msg = (t: string) => { lastMsg = t; const el = document.getElementById('shop-msg'); if (el) el.textContent = t; };
  lastMsg = '';
  const wear = () => ({ ...effectiveLoadout(p, ents), ...trying });
  const canvas = document.getElementById('shop-canvas') as HTMLCanvasElement | null;
  preview?.dispose(); preview = null;
  if (canvas) { const l = wear(); preview = mountPreview(canvas, outfitOf(l), l.mascot); }
  document.querySelector('.pack.focus')?.scrollIntoView({ block: 'center' });
  document.querySelectorAll<HTMLButtonElement>('[data-shop-filter]').forEach(b => { b.onclick = () => { filter = b.dataset.shopFilter as Filter; redraw(); }; });
  document.querySelectorAll<HTMLElement>('[data-try]').forEach(el => {
    el.onclick = e => {
      if ((e.target as HTMLElement).closest('button')) return;
      const c = getCosmetic(el.dataset.try); if (!c) return;
      trying = { ...trying, [c.slot]: c.id };
      document.querySelectorAll(`.cos.trying`).forEach(x => { if (getCosmetic((x as HTMLElement).dataset.try)?.slot === c.slot) x.classList.remove('trying'); });
      el.classList.add('trying');
      const l = wear(); preview?.update(outfitOf(l), l.mascot);
      msg(`試穿：${c.icon} ${c.name}${ownsCosmetic(p, c.id, ents) ? '' : '（還沒擁有）'}`);
    };
  });
  const done = (text: string) => { trying = {}; save(p); redraw(); msg(text); };
  document.querySelectorAll<HTMLButtonElement>('[data-cos-buy]').forEach(b => {
    b.onclick = () => {
      const c = getCosmetic(b.dataset.cosBuy)!;
      const r = buyCosmetic(p, c.id);
      if (!r.ok) return msg(r.why === 'poor' ? `薪資點數不夠（還差 ${c.price! - p.wallet}），再去上幾班吧` : '買不了');
      equipCosmetic(p, c.id, undefined, ents);
      done(`買到了 ${c.icon} ${c.name}，已經${DECOR_SLOTS.includes(c.slot) ? '擺上' : '穿上'}！`);
    };
  });
  document.querySelectorAll<HTMLButtonElement>('[data-cos-eq]').forEach(b => { b.onclick = () => { const c = getCosmetic(b.dataset.cosEq)!; if (equipCosmetic(p, c.id, undefined, ents)) done(`${c.icon} ${c.name} 使用中`); }; });
  document.querySelectorAll<HTMLButtonElement>('[data-cos-off]').forEach(b => { b.onclick = () => { equipCosmetic(p, null, b.dataset.cosOff as CosmeticSlot); done('已卸下'); }; });
  document.querySelectorAll<HTMLButtonElement>('[data-pack-buy]').forEach(b => {
    b.onclick = async () => {
      const pack = PACK_BY_ID[b.dataset.packBuy ?? '']; if (!pack) return;
      b.disabled = true;
      const r = await billing().purchase(pack.id);
      b.disabled = false;
      if (!r.ok) return msg(`${pack.icon} ${pack.name}：${r.message}`);
      p.shop.entitlements = [...new Set([...p.shop.entitlements, ...r.entitlements])];
      done(`感謝購買 ${pack.icon} ${pack.name}！`);
    };
  });
  const rs = document.getElementById('shop-restore') as HTMLButtonElement | null;
  if (rs) rs.onclick = async () => {
    const r = await billing().restore();
    if (!r.ok) return msg(r.message);
    p.shop.entitlements = [...new Set([...p.shop.entitlements, ...r.entitlements])];
    done(r.entitlements.length ? '已恢復購買' : '沒有找到之前的購買');
  };
}

/** Lock badge for the own-store picker. */
export function ownStoreLockHtml(p: CareerProfile, mapId: string) {
  const k = lockedPack(p, mapId, 'own');
  return k ? ` <span class="tag lock">🔒 ${esc(k.name)}</span>` : '';
}
