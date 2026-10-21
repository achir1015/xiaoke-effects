// 多國語言：繁中、簡中、英、日、韓、西、法、義、葡（巴西）、俄、土、越、阿拉伯
// 每個語言兩個檔案：介面字串 js/lang/xx.js、特效名稱 js/lang-fx/xx.js，切換時才載入；缺少的字串依序退回英文、繁中。
import zhTW from './lang/zh-TW.js';
import fxTW from './lang-fx/zh-TW.js';

export const LANGS = [
  { code: 'zh-TW', name: '繁體中文' }, { code: 'zh-CN', name: '简体中文' }, { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' }, { code: 'ko', name: '한국어' }, { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' }, { code: 'it', name: 'Italiano' }, { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'ru', name: 'Русский' }, { code: 'tr', name: 'Türkçe' }, { code: 'vi', name: 'Tiếng Việt' }, { code: 'ar', name: 'العربية' },
];

const base = { ...fxTW, ...zhTW };
const dicts = { 'zh-TW': base };
let cur = 'zh-TW';
const listeners = new Set();

function detect() {
  try { const s = localStorage.getItem('xke.lang'); if (s && LANGS.some(l => l.code === s)) return s; } catch { }
  const nav = (navigator.languages || [navigator.language || 'zh-TW']).map(x => x.toLowerCase());
  for (const n of nav) {
    if (n.startsWith('zh')) return /cn|sg|hans/.test(n) ? 'zh-CN' : 'zh-TW';
    if (n.startsWith('pt')) return 'pt-BR';
    const hit = LANGS.find(l => l.code === n.slice(0, 2));
    if (hit) return hit.code;
  }
  return 'zh-TW';
}

async function loadOne(code) {
  const get = async p => { try { return (await import(p)).default; } catch (e) { console.warn('lang', p, e); return {}; } };
  const [ui, fx] = await Promise.all([get(`./lang/${code}.js`), get(`./lang-fx/${code}.js`)]);
  return { ...fx, ...ui };
}
async function load(code) {
  if (!dicts[code]) dicts[code] = await loadOne(code);
  if (code !== 'en' && !dicts.en) dicts.en = await loadOne('en');
}

function apply() {
  document.documentElement.lang = cur;
  document.documentElement.dir = cur === 'ar' ? 'rtl' : 'ltr';
}

export function t(key, vars) {
  let s = dicts[cur]?.[key] ?? dicts.en?.[key] ?? base[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}
export const has = key => key in base;
export const getLang = () => cur;
export async function setLang(code) {
  await load(code);
  cur = code;
  try { localStorage.setItem('xke.lang', code); } catch { }
  apply();
  listeners.forEach(f => f(code));
}
export const onLangChange = fn => (listeners.add(fn), () => listeners.delete(fn));

cur = detect();
await load(cur);
apply();
