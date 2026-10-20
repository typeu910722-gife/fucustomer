// Fills the SteamPipe templates with the App ID / Depot ID from desktop/steam.config.json (the single place to set them).
// Usage: node steam/make-vdf.mjs            → writes steam/build/app_build_<APPID>.vdf + depot_build_<DEPOTID>.vdf
//        node steam/make-vdf.mjs 1234560    → use this App ID instead (depot = App ID + 1 unless depotId is set)
// Content root: release/desktop/win-unpacked (made by `npm run desktop:win`). Nothing secret is written.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const cfg = JSON.parse(readFileSync(path.join(ROOT, 'desktop/steam.config.json'), 'utf8'));
const appId = Number(process.argv[2] || cfg.appId) || 0;
if (!appId) { console.error('還沒有 App ID：請先在 desktop/steam.config.json 填入 "appId"（或執行 node steam/make-vdf.mjs <AppID>）'); process.exit(1); }
const depotId = Number(cfg.depotId) || appId + 1;
const version = JSON.parse(readFileSync(path.join(ROOT, 'desktop/package.json'), 'utf8')).version;
const content = path.join(ROOT, 'release/desktop/win-unpacked');
if (!existsSync(path.join(content, 'FUCustomer.exe'))) console.warn('注意：還沒有 Windows 版建置（release/desktop/win-unpacked/FUCustomer.exe），請先執行 npm run desktop:win');
const OUT = path.join(HERE, 'build');
mkdirSync(OUT, { recursive: true });
const fill = s => s.replaceAll('__APPID__', String(appId)).replaceAll('__DEPOTID__', String(depotId))
  .replaceAll('__VERSION__', version).replaceAll('__CONTENT_ROOT__', content.replaceAll('\\', '/'));
const app = path.join(OUT, `app_build_${appId}.vdf`);
writeFileSync(app, fill(readFileSync(path.join(HERE, 'app_build_TEMPLATE.vdf'), 'utf8')));
writeFileSync(path.join(OUT, `depot_build_${depotId}.vdf`), fill(readFileSync(path.join(HERE, 'depot_build_TEMPLATE.vdf'), 'utf8')));
console.log(`App ${appId} / Depot ${depotId} / v${version}`);
console.log('寫好了：', app);
console.log(`上傳指令（在你自己的電腦執行，密碼只在 steamcmd 裡輸入）：\n  steamcmd +login <你的Steam帳號> +run_app_build "${app}" +quit`);
