// 檢查每個語言檔是否涵蓋程式用到的所有字串（介面 js/lang、特效 js/lang-fx）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(root, 'js', f), 'utf8')).join('\n');
const used = new Set([...src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)].map(m => m[1]).filter(k => !k.endsWith('_') && !k.endsWith('.')));
const load = async p => (await import(pathToFileURL(p).href)).default;
const zh = { ...(await load(path.join(root, 'js/lang-fx/zh-TW.js'))), ...(await load(path.join(root, 'js/lang/zh-TW.js'))) };
// 動態組合的字串：以這些字首開頭的 key 都要有
const dyn = Object.keys(zh).filter(k => /^(blend|matte|mask|kind|type|light|shape|based|rshape|ta|tool|tpl|pcat|preset|fmt|fmtNote|status|q|cap|ws|lib|lw)_/.test(k) || /^fx[a-z]*\./.test(k));
for (const k of dyn) used.add(k);
const miss0 = [...used].filter(k => !(k in zh));
if (miss0.length) console.log('zh-TW MISSING:', miss0.join(' '));
let bad = miss0.length ? 1 : 0;
for (const f of fs.readdirSync(path.join(root, 'js/lang'))) {
  const d = { ...(await load(path.join(root, 'js/lang-fx', f)).catch(() => ({}))), ...(await load(path.join(root, 'js/lang', f))) };
  const miss = [...used].filter(k => !(k in d));
  const extra = Object.keys(d).filter(k => !(k in zh));
  console.log(f.padEnd(10), Object.keys(d).length, miss.length ? 'MISSING(' + miss.length + '): ' + miss.slice(0, 40).join(' ') : 'ok', extra.length ? ' EXTRA: ' + extra.join(' ') : '');
  if (miss.length) bad++;
}
process.exit(bad ? 1 : 0);
