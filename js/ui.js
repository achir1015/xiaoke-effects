// 介面元件：下拉選單、對話框、提示、可拖曳數值
import { h, clamp, rgbaToHex, hexToRgba } from './util.js';
import { t } from './i18n.js';

// ---- 下拉選單 ----
// items：[{ label, key, run, checked, disabled, sub:[...] } | '-']
let openMenu = null;
export function closeMenus() { openMenu?.forEach(m => m.remove()); openMenu = null; document.querySelectorAll('.menu-btn.open').forEach(b => b.classList.remove('open')); }
export function dropdown(items, x, y, opts = {}) {
  if (!opts.child) closeMenus();
  openMenu ||= [];
  const m = h('div', { class: 'dropdown', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.append(h('hr')); continue; }
    const row = h('div', { class: 'mi' + (it.disabled ? ' dis' : '') + (it.sub ? ' sub' : ''), role: 'menuitem' },
      h('span', { class: 'chk' }, it.checked ? '✓' : ''), h('span', null, it.label), it.key ? h('span', { class: 'k' }, it.key) : null);
    if (it.sub) {
      let child = null;
      const show = () => {
        if (child?.isConnected) return;
        openMenu.filter(x => x.dataset.level > (opts.level || 0)).forEach(x => { x.remove(); });
        openMenu = openMenu.filter(x => x.isConnected);
        const r = row.getBoundingClientRect();
        child = dropdown(typeof it.sub === 'function' ? it.sub() : it.sub, r.right - 2, r.top - 4, { child: true, level: (opts.level || 0) + 1 });
      };
      row.addEventListener('pointerenter', show);
      row.addEventListener('click', e => { e.stopPropagation(); show(); });
    } else {
      row.addEventListener('pointerenter', () => { openMenu.filter(x => x.dataset.level > (opts.level || 0)).forEach(x => x.remove()); openMenu = openMenu.filter(x => x.isConnected); });
      row.addEventListener('click', e => { e.stopPropagation(); closeMenus(); it.run?.(); });
    }
    m.append(row);
  }
  m.dataset.level = opts.level || 0;
  document.body.append(m);
  openMenu.push(m);
  const r = m.getBoundingClientRect();
  m.style.left = clamp(x, 4, innerWidth - r.width - 4) + 'px';
  m.style.top = clamp(y, 4, innerHeight - r.height - 4) + 'px';
  return m;
}
addEventListener('pointerdown', e => { if (openMenu && !e.target.closest('.dropdown') && !e.target.closest('.menu-btn')) closeMenus(); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
export const menuOpen = () => !!openMenu?.length;

// ---- 對話框 ----
export function modal(title, body, buttons = [], opts = {}) {
  return new Promise(resolve => {
    const bg = h('div', { class: 'modal-bg' });
    const close = v => { bg.remove(); removeEventListener('keydown', onKey, true); resolve(v); };
    const foot = h('footer');
    for (const b of buttons) foot.append(h('button', { class: b.primary ? 'primary' : '', onclick: async () => { if (b.run) { const r = await b.run(); if (r === false) return; } close(b.value ?? b.label); } }, b.label));
    const box = h('div', { class: 'modal' + (opts.wide ? ' wide' : '') }, h('header', null, h('span', { class: 'grow' }, title), h('button', { class: 'icon', 'aria-label': t('close'), onclick: () => close(null) }, '✕')), h('div', { class: 'mb' }, body), buttons.length ? foot : null);
    bg.append(box);
    bg.addEventListener('pointerdown', e => { if (e.target === bg && !opts.sticky) close(null); });
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && !e.target.matches('textarea')) { const p = buttons.find(b => b.primary); if (p) { e.preventDefault(); e.stopPropagation(); foot.querySelector('.primary')?.click(); } }
      e.stopPropagation();
    };
    addEventListener('keydown', onKey, true);
    document.body.append(bg);
    setTimeout(() => box.querySelector('input,select,textarea')?.focus(), 30);
    opts.onOpen?.(box, close);
  });
}
export async function confirmBox(msg, ok = t('ok')) { return (await modal(t('confirm'), h('p', null, msg), [{ label: t('cancel'), value: false }, { label: ok, primary: true, value: true }])) === true; }
export async function promptBox(title, value = '', opts = {}) {
  const inp = opts.multiline ? h('textarea', { rows: 4, style: { width: '100%' } }, value) : h('input', { value, style: { width: '100%' } });
  const r = await modal(title, h('div', null, opts.hint ? h('p', { class: 'dim small' }, opts.hint) : null, inp), [{ label: t('cancel'), value: null }, { label: t('ok'), primary: true, run: () => { inp._v = inp.value; } , value: 'ok' }]);
  return r === 'ok' ? inp._v : null;
}

let toastTm = null;
export function toast(msg, kind = '', ms = 2600) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  document.body.append(el);
  clearTimeout(toastTm);
  toastTm = setTimeout(() => el.remove(), ms);
}

// ---- 可拖曳的數值（像 After Effects 的藍色數字）----
// opts：{ get, set(v, final), begin, step, min, max, fmt, parse }
export function scrub(opts) {
  const el = h('span', { class: 'scrub', tabindex: 0 });
  const show = () => { el.textContent = opts.fmt ? opts.fmt(opts.get()) : String(opts.get()); };
  show();
  let sx = 0, sv = 0, moved = false, pid = null;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    pid = e.pointerId; el.setPointerCapture(pid);
    sx = e.clientX; sv = opts.get(); moved = false;
  });
  el.addEventListener('pointermove', e => {
    if (pid !== e.pointerId) return;
    const dx = e.clientX - sx;
    if (!moved && Math.abs(dx) < 3) return;
    if (!moved) { moved = true; opts.begin?.(); }
    const k = (opts.step || 1) * (e.shiftKey ? 10 : e.ctrlKey || e.metaKey ? 0.1 : 1);
    let v = sv + dx * k;
    if (opts.min != null && !opts.unbounded) v = Math.max(opts.min, v);
    if (opts.max != null && opts.clampMax) v = Math.min(opts.max, v);
    opts.set(v, false); show();
  });
  const up = e => {
    if (pid !== e.pointerId) return;
    pid = null;
    if (moved) { opts.set(opts.get(), true); show(); }
    else edit();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); edit(); } });
  function edit() {
    const inp = h('input', { class: 'scrubin', value: String(+(+opts.get()).toFixed(3)) });
    el.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const fin = ok => {
      if (done) return; done = true;
      if (ok) {
        let v = opts.parse ? opts.parse(inp.value) : parseFloat(inp.value);
        if (v != null && isFinite(v)) { opts.begin?.(); if (opts.min != null) v = Math.max(opts.min, v); if (opts.max != null && opts.clampMax) v = Math.min(opts.max, v); opts.set(v, true); }
      }
      inp.replaceWith(el); show();
    };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Tab') fin(true); if (e.key === 'Escape') fin(false); });
    inp.addEventListener('blur', () => fin(true));
  }
  el.refresh = show;
  return el;
}

export function colorInput(get, set) {
  const inp = h('input', { type: 'color', value: rgbaToHex(get()) });
  let began = false;
  inp.addEventListener('input', () => { set(hexToRgba(inp.value, get()[3] ?? 1), false, !began); began = true; });
  inp.addEventListener('change', () => { set(hexToRgba(inp.value, get()[3] ?? 1), true, !began); began = false; });
  inp.refresh = () => { inp.value = rgbaToHex(get()); };
  return inp;
}

export function sel(options, value, onchange, attrs = {}) {
  const s = h('select', attrs, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  s.addEventListener('change', () => onchange(s.value));
  s.addEventListener('keydown', e => e.stopPropagation());
  return s;
}

// 拖曳分隔線改變面板大小
export function splitter(el, axis, get, set) {
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const s0 = axis === 'x' ? e.clientX : e.clientY, v0 = get();
    const mv = ev => set(v0 + ((axis === 'x' ? ev.clientX : ev.clientY) - s0));
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
}

// 讀取檔案
export function pickFiles(accept, multiple = true) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    i.addEventListener('change', () => { res([...i.files]); i.remove(); });
    document.body.append(i); i.click();
    setTimeout(() => { if (!i.files?.length) { } }, 0);
  });
}
