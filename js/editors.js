// 屬性值編輯器（時間軸、屬性面板、效果控制共用）
import { S, comp, changed, history, edit } from './state.js';
import { rawAt, setValue, animated, toggleStopwatch, keyIndexAt, removeKey, setKey, hasExpr } from './anim.js';
import { h, clone, rgbaToHex } from './util.js';
import { scrub, colorInput, sel } from './ui.js';
import { fmt } from './props.js';
import { ic } from './icons.js';
import { t } from './i18n.js';
import { evaluator } from './render.js';

const lt = l => S.time - l.start;
// 目前（含表達式）的值
export function curVal(l, node) {
  const c = comp();
  if (hasExpr(node.prop) && c) { try { return evaluator(S.project, c, l, S.time)(node.prop, node.path); } catch { } }
  return rawAt(node.prop, lt(l));
}
const begin = label => { history.checkpoint(label); S.uiDrag = true; };
const commit = (final) => { if (final) S.uiDrag = false; changed(final ? 'value' : 'drag'); };

// 數值編輯器：回傳元素，el.refresh() 更新顯示
export function valueEditor(l, node, opts = {}) {
  const p = node.prop, ty = node.type;
  const get = () => rawAt(p, lt(l));
  const put = (v, final) => { setValue(p, lt(l), v); commit(final); };
  const wrap = h('span', { class: 'pv-ed' });
  const refreshers = [];
  const scr = (getter, setter, o = {}) => { const s = scrub({ get: getter, set: setter, begin: () => begin('value'), ...o }); refreshers.push(s.refresh); return s; };
  if (ty === 'num' || ty === 'pct' || ty === 'angle') {
    const step = node.step || (ty === 'angle' ? 1 : ty === 'pct' ? 0.5 : Math.max(0.1, ((node.max ?? 100) - (node.min ?? 0)) / 400));
    wrap.append(scr(() => curVal(l, node), (v, f) => put(v, f), { step, min: node.min, max: node.max, fmt: v => fmt(ty, v, node.unit) }));
    if (opts.slider && node.max != null && node.min != null && ty !== 'angle') {
      const r = h('input', { type: 'range', min: node.min, max: node.max, step: node.step || (node.max - node.min) / 200, value: get() });
      r.addEventListener('pointerdown', () => begin('value'));
      r.addEventListener('input', () => put(+r.value, false));
      r.addEventListener('change', () => put(+r.value, true));
      refreshers.push(() => { r.value = curVal(l, node); });
      wrap.append(r);
    }
  } else if (ty === 'vec2' || ty === 'vec3' || ty === 'scale' || ty === 'scale3') {
    const n = ty === 'vec3' || ty === 'scale3' ? 3 : 2;
    const isScale = ty.startsWith('scale');
    if (isScale) {
      const link = h('button', { class: 'icon' + (l.__unlinked?.[node.path] ? '' : ' on'), title: t('constrain') }, ic('link'));
      link.addEventListener('click', () => { l.__unlinked ||= {}; l.__unlinked[node.path] = !l.__unlinked[node.path]; link.classList.toggle('on'); });
      Object.defineProperty(l, '__unlinked', { value: l.__unlinked || {}, enumerable: false, configurable: true, writable: true });
      wrap.append(link);
    }
    for (let i = 0; i < n; i++) {
      wrap.append(scr(() => (curVal(l, node) || [])[i] ?? 0, (v, f) => {
        const cur = clone(get());
        if (isScale && !l.__unlinked?.[node.path]) { const k = cur[i] ? v / cur[i] : 1; for (let j = 0; j < n; j++) cur[j] = j === i ? v : cur[j] * k; }
        else cur[i] = v;
        put(cur, f);
      }, { step: isScale ? 0.5 : 1, fmt: v => fmt(isScale ? 'pct' : 'num', v) }));
    }
  } else if (ty === 'color') {
    const ci = colorInput(() => curVal(l, node), (v, f, first) => { if (first) begin('color'); put(v, f); });
    refreshers.push(ci.refresh);
    wrap.append(ci);
    if (opts.alpha) wrap.append(scr(() => (curVal(l, node)[3] ?? 1) * 100, (v, f) => { const c = clone(get()); c[3] = Math.max(0, Math.min(100, v)) / 100; put(c, f); }, { min: 0, max: 100, clampMax: true, fmt: v => fmt('pct', v) }));
  } else if (ty === 'text') {
    const ta = h('textarea', { rows: 2 });
    ta.value = get() ?? '';
    ta.addEventListener('focus', () => history.checkpoint('text'));
    ta.addEventListener('input', () => { setValue(p, lt(l), ta.value); if (l.type === 'text') l.name = (ta.value.split('\n')[0] || l.name).slice(0, 24); changed('text'); });
    ta.addEventListener('keydown', e => e.stopPropagation());
    refreshers.push(() => { if (document.activeElement !== ta) ta.value = get() ?? ''; });
    wrap.append(ta);
    wrap.style.flex = '1';
  } else if (ty === 'select') {
    const s = sel(node.options.map(o => [o, t(`fxo.${node.fx}.${node.pid}.${o}`)]), get(), v => edit('value', () => setValue(p, lt(l), v)));
    refreshers.push(() => { s.value = get(); });
    wrap.append(s);
  } else if (ty === 'bool') {
    const cb = h('input', { type: 'checkbox', checked: !!get() });
    cb.addEventListener('change', () => edit('value', () => setValue(p, lt(l), cb.checked)));
    refreshers.push(() => { cb.checked = !!get(); });
    wrap.append(cb);
  } else if (ty === 'layerRef') {
    const c = comp();
    const s = sel([['', t('none')], ...c.layers.filter(x => x !== l).map(x => [x.id, x.name])], get(), v => edit('value', () => setValue(p, lt(l), v)));
    wrap.append(s);
  } else if (ty === 'path') {
    wrap.append(h('span', { class: 'dim small' }, t('pathHint')));
  }
  wrap.refresh = () => refreshers.forEach(f => f());
  return wrap;
}

// 碼錶（開關動畫）
export function stopwatch(l, node) {
  const b = h('span', { class: 'watch' + (animated(node.prop) ? ' on' : ''), title: t('stopwatch') }, ic('stopwatch'));
  b.addEventListener('click', e => {
    e.stopPropagation();
    if (e.altKey) { edit('expr', () => { node.prop.x = node.prop.x ? undefined : 'value'; if (!node.prop.x) delete node.prop.x; else node.prop.xon = true; }); return; }
    edit('stopwatch', () => toggleStopwatch(node.prop, lt(l)));
  });
  return b;
}

// ◀ ◆ ▶：前一個／加入或移除／下一個關鍵影格
export function keyNav(l, node, setTime) {
  const p = node.prop;
  const at = keyIndexAt(p, lt(l)) >= 0;
  const prev = h('span', { title: t('prevKey') }, '◀'), mid = h('span', { class: 'd' + (at ? ' on' : ''), title: t('addRemoveKey') }, '◆'), next = h('span', { title: t('nextKey') }, '▶');
  prev.addEventListener('click', e => { e.stopPropagation(); const ks = (p.k || []).filter(k => k.t < lt(l) - 1e-6); if (ks.length) setTime(ks[ks.length - 1].t + l.start); });
  next.addEventListener('click', e => { e.stopPropagation(); const ks = (p.k || []).filter(k => k.t > lt(l) + 1e-6); if (ks.length) setTime(ks[0].t + l.start); });
  mid.addEventListener('click', e => { e.stopPropagation(); edit('key', () => { if (keyIndexAt(p, lt(l)) >= 0) { const v = rawAt(p, lt(l)); removeKey(p, lt(l)); if (!p.k) p.v = v; } else setKey(p, lt(l), clone(rawAt(p, lt(l)))); }); });
  const wrap = h('span', { class: 'kn' }, animated(p) ? [prev, mid, next] : []);
  wrap.refresh = () => mid.classList.toggle('on', keyIndexAt(p, lt(l)) >= 0);
  return wrap;
}

// 表達式編輯框
export function exprBox(l, node) {
  const p = node.prop;
  const ta = h('textarea', { spellcheck: false });
  ta.value = p.x || '';
  const err = h('div', { class: 'err' });
  const on = h('input', { type: 'checkbox', checked: p.xon !== false, title: t('exprEnable') });
  on.addEventListener('change', () => edit('expr', () => { p.xon = on.checked; }));
  ta.addEventListener('focus', () => history.checkpoint('expr'));
  ta.addEventListener('input', () => { p.x = ta.value; changed('expr'); });
  ta.addEventListener('keydown', e => e.stopPropagation());
  const box = h('div', { class: 'exprbox' }, h('div', { class: 'small dim', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, on, t('expression'), h('button', { class: 'ghost small', onclick: () => edit('expr', () => { delete p.x; delete p.xon; }) }, t('remove'))), ta, err);
  box.refresh = () => { err.textContent = p.__err ? '⚠ ' + p.__err : ''; };
  box.refresh();
  return box;
}
