// 「全台奧客圖鑑」 page in the career screen: every karen kind, 記者小林's write-up once you've handled it.
import type { CareerProfile } from '../../shared/career.ts';
import { KAREN_INFO } from '../../shared/constants.ts';
import { DEX, DEX_ORDER, dexCount } from '../../shared/karendex.ts';
import { SIG_KINDS, isSig } from '../../shared/sigkarens.ts';
import { ACHIEVEMENTS } from '../../shared/achievements.ts';
import { esc } from './ui.ts';

/** Switch between the achievement list and the 圖鑑 (both live under the 🏆 tab). */
export function dexSwitch(p: CareerProfile, on: 'achievements' | 'dex') {
  const b = (t: string, label: string) => `<button class="btn small ${t === on ? 'primary' : ''}" data-tab="${t}">${label}</button>`;
  return `<div class="row dexswitch">${b('achievements', `🏆 成就 ${p.achievements.length}/${ACHIEVEMENTS.length}`)}${b('dex', `📖 全台奧客圖鑑 ${dexCount(p.dex)}/${DEX_ORDER.length}`)}</div>`;
}

export function dexHtml(p: CareerProfile) {
  const all = dexCount(p.dex), sig = dexCount(p.dex, true);
  const card = (k: string) => {
    const d = DEX[k as keyof typeof DEX], n = p.dex[k] ?? 0, got = n > 0;
    const name = KAREN_INFO[k as keyof typeof KAREN_INFO].name;
    return `<div class="dexcard ${got ? 'got' : 'locked'} ${isSig(k) ? 'sig' : ''}">
      <div class="dexico"><span>${d.icon}</span></div>
      <div class="dexbody"><b>${got ? esc(name) : '？？？'}</b><span class="dexwhere">${esc(d.where)}${got ? `・處理 ${n} 次` : ''}</span>
      <p>${got ? `🎤 ${esc(d.note)}` : `🔒 還沒處理過。小林：「去${esc(d.where === '各種店' ? '店裡' : d.where)}上班，遇到就知道了。」`}</p></div></div>`;
  };
  const core = DEX_ORDER.filter(k => !isSig(k)), sigs = DEX_ORDER.filter(k => isSig(k));
  return `${dexSwitch(p, 'dex')}
    <div class="dexhead"><span>🎤 記者小林的專題報導・處理過一次就會寫進來</span>
      <span class="tag ${sig >= SIG_KINDS.length ? 'ok' : ''}">招牌奧客 ${sig}/${SIG_KINDS.length}</span><span class="tag">全部 ${all}/${DEX_ORDER.length}</span></div>
    <h3>經典奧客</h3><div class="dexgrid">${core.map(card).join('')}</div>
    <h3>各店招牌奧客</h3><div class="dexgrid">${sigs.map(card).join('')}</div>`;
}
