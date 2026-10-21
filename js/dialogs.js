// 對話框：合成設定、純色設定、圖層設定、新專案（範本）、算繪輸出、快捷鍵、關於
import { S, bus, comp, edit } from './state.js';
import { h, timecode, parseTimecode, rgbaToHex, hexToRgba, download, fmtBytes } from './util.js';
import { t } from './i18n.js';
import { modal, toast, sel } from './ui.js';
import { APP_VERSION } from './updater.js';
import { FORMATS } from './panels.js';

const PRESETS = [
  ['HD 1080p', 1920, 1080], ['HD 720p', 1280, 720], ['4K UHD', 3840, 2160], ['Vertical 9:16', 1080, 1920], ['Square 1:1', 1080, 1080], ['Portrait 4:5', 1080, 1350], ['Cinema 2.39:1', 1920, 804],
];

export async function compSettingsDialog(c) {
  const v = c ? { ...c } : { name: t('comp') + ' ' + (S.project.comps.length + 1), w: 1920, h: 1080, fps: 30, duration: 10, bg: [0.05, 0.06, 0.08, 1], motionBlur: false, shutter: 180, samples: 8 };
  const name = h('input', { value: v.name });
  const w = h('input', { type: 'number', value: v.w, min: 16, max: 8192 }), hh = h('input', { type: 'number', value: v.h, min: 16, max: 8192 });
  const preset = sel([['', t('custom')], ...PRESETS.map(([n, a, b]) => [`${a}x${b}`, `${n} (${a}×${b})`])], `${v.w}x${v.h}`, x => { if (!x) return; const [a, b] = x.split('x'); w.value = a; hh.value = b; });
  const fps = sel(['12', '15', '23.976', '24', '25', '29.97', '30', '48', '50', '60'].map(x => [x, x]), String(v.fps), () => { });
  fps.value = String(v.fps);
  const dur = h('input', { value: timecode(v.duration, v.fps) });
  const bg = h('input', { type: 'color', value: rgbaToHex(v.bg) });
  const mb = h('input', { type: 'checkbox', checked: v.motionBlur });
  const shutter = h('input', { type: 'number', value: v.shutter, min: 0, max: 720 }), samples = h('input', { type: 'number', value: v.samples, min: 2, max: 64 });
  const body = h('div', { class: 'form' },
    h('label', null, t('compName')), name,
    h('label', null, t('preset')), preset,
    h('label', null, t('size')), h('div', { class: 'row2' }, w, '×', hh, ' px'),
    h('label', null, t('frameRate')), h('div', { class: 'row2' }, fps, ' fps'),
    h('label', null, t('duration')), h('div', { class: 'row2' }, dur, h('span', { class: 'dim small' }, t('timeHint'))),
    h('label', null, t('bgColor')), bg,
    h('label', null, t('motionBlur')), h('div', { class: 'row2' }, mb, t('enable'), ' · ', t('shutterAngle'), shutter, '° · ', t('samples'), samples));
  let out = null;
  const r = await modal(c ? t('compSettings') : t('newComp'), body, [{ label: t('cancel'), value: null }, { label: t('ok'), primary: true, run: () => {
    const f = parseFloat(fps.value) || 30;
    const d = parseTimecode(dur.value, f);
    if (!d || d <= 0) { toast(t('badDuration'), 'warn'); return false; }
    out = { name: name.value || 'Comp', w: Math.max(16, Math.round(+w.value) & ~1), h: Math.max(16, Math.round(+hh.value) & ~1), fps: f, duration: Math.min(3600, d), bg: hexToRgba(bg.value), motionBlur: mb.checked, shutter: +shutter.value || 180, samples: Math.max(2, +samples.value || 8) };
  }, value: 'ok' }]);
  return r === 'ok' ? out : null;
}

export async function solidDialog(c) {
  const name = h('input', { value: t('solidName') });
  const w = h('input', { type: 'number', value: c.w }), hh = h('input', { type: 'number', value: c.h });
  const col = h('input', { type: 'color', value: '#d93d40' });
  const body = h('div', { class: 'form' }, h('label', null, t('name')), name, h('label', null, t('size')), h('div', { class: 'row2' }, w, '×', hh, h('button', { class: 'ghost small', onclick: () => { w.value = c.w; hh.value = c.h; } }, t('compSize'))), h('label', null, t('pColor')), col);
  let out = null;
  const r = await modal(t('newSolid'), body, [{ label: t('cancel') }, { label: t('ok'), primary: true, value: 'ok', run: () => { out = { name: name.value, w: Math.max(1, +w.value), h: Math.max(1, +hh.value), color: hexToRgba(col.value) }; } }]);
  return r === 'ok' ? out : null;
}

export async function layerSettingsDialog(l) {
  const name = h('input', { value: l.name });
  const kids = [h('label', null, t('name')), name];
  let w, hh, col;
  if (l.type === 'solid') { w = h('input', { type: 'number', value: l.solid.w }); hh = h('input', { type: 'number', value: l.solid.h }); col = h('input', { type: 'color', value: rgbaToHex(l.solid.color.v) }); kids.push(h('label', null, t('size')), h('div', { class: 'row2' }, w, '×', hh), h('label', null, t('pColor')), col); }
  const label = h('input', { type: 'color', value: l.label });
  kids.push(h('label', null, t('labelColor')), label);
  const r = await modal(t('layerSettings'), h('div', { class: 'form' }, kids), [{ label: t('cancel') }, { label: t('ok'), primary: true, value: 'ok' }]);
  if (r !== 'ok') return;
  edit('layerSettings', () => {
    l.name = name.value || l.name; l.label = label.value;
    if (l.type === 'solid') { l.solid.w = Math.max(1, +w.value); l.solid.h = Math.max(1, +hh.value); l.solid.color.v = hexToRgba(col.value); }
  });
}

// 新專案：範本畫廊
export async function newProjectDialog() {
  const { TEMPLATES, thumbFor } = await import('./templates.js');
  let pick = null;
  const grid = h('div', { class: 'tplgrid' });
  const r = modal(t('newProject'), h('div', null, h('p', { class: 'dim small', style: { marginTop: 0 } }, t('newProjectHint')), grid), [{ label: t('cancel') }], { wide: true, onOpen: (box, close) => {
    for (const tp of TEMPLATES) {
      const b = h('button', { class: 'tpl' }, thumbFor(tp.id), h('b', null, t('tpl_' + tp.id)), h('span', null, t('tpl_' + tp.id + '_d')));
      b.addEventListener('click', () => { pick = tp.id; close('pick'); });
      grid.append(b);
    }
  } });
  return (await r) === 'pick' ? pick : null;
}

// 算繪輸出設定（單一合成）
export async function exportDialog(c, startFormat = 'mp4') {
  const fmt = sel(FORMATS.map(f => [f, t('fmt_' + f)]), startFormat, () => upd());
  const res = sel([['1', `${t('full')} (${c.w}×${c.h})`], ['0.5', `${t('half')} (${Math.round(c.w / 2)}×${Math.round(c.h / 2)})`], ['0.25', `${t('quarter')}`], ['2', `200% (${c.w * 2}×${c.h * 2})`]], '1', () => { });
  const q = sel([['low', t('q_low')], ['medium', t('q_medium')], ['high', t('q_high')], ['max', t('q_max')]], 'high', () => { });
  const range = sel([['work', `${t('workArea')} (${timecode(c.workIn, c.fps)} – ${timecode(c.workOut, c.fps)})`], ['full', t('fullComp')]], c.workIn > 0 || c.workOut < c.duration ? 'work' : 'full', () => { });
  const note = h('p', { class: 'small dim' });
  const upd = () => { note.textContent = t('fmtNote_' + fmt.value); };
  upd();
  const body = h('div', { class: 'form' }, h('label', null, t('format')), fmt, h('label', null, t('resolution')), res, h('label', null, t('quality')), q, h('label', null, t('range')), range, h('div', { class: 'full' }, note));
  const r = await modal(t('renderComp', { name: c.name }), body, [{ label: t('cancel') }, { label: t('addToRQ'), value: 'rq' }, { label: t('renderNow'), primary: true, value: 'go' }]);
  if (!r || r === t('cancel')) return null;
  return { action: r, format: fmt.value, res: +res.value, quality: q.value, range: range.value };
}

export function shortcutsDialog() {
  const rows = [
    ['Space', t('playPause')], ['Home / End', t('firstLastFrame')], ['PageUp / PageDown', t('prevNextFrame')], ['Shift + PageUp/Down', t('jump10')], ['J / K', t('prevNextKey')],
    ['I / O', t('goLayerInOut')], ['B / N', t('workAreaInOut')], ['[ / ]', t('moveLayerInOut')], ['Alt + [ / ]', t('trimLayer')], ['Ctrl+Shift+D', t('splitLayer')],
    ['V', t('tool_select')], ['H', t('tool_hand')], ['Z', t('tool_zoom')], ['W', t('tool_rotate')], ['Y', t('tool_anchor')], ['Q', t('tool_shapes')], ['G', t('tool_pen')], ['Ctrl+T', t('tool_text')], ['C', t('tool_orbit')],
    ['P / S / R / T / A', t('revealProps')], ['M / E / L / F', t('revealMore')], ['U', t('revealAnimated')], ['Shift + P…', t('revealAdd')],
    ['Alt+Shift+P / S / R / T', t('addKeyShortcut')], ['F9', t('easyEase')], ['Shift+F9 / Ctrl+Shift+F9', t('easeIn') + ' / ' + t('easeOut')], ['Ctrl+Alt+H', t('hold')], ['Alt+Shift+=', t('addExpression')],
    ['Ctrl+Y', t('newSolid')], ['Ctrl+Alt+Shift+T', t('newText')], ['Ctrl+Alt+Shift+Y', t('newNull')], ['Ctrl+Alt+Y', t('newAdjust')], ['Ctrl+Alt+Shift+C', t('newCamera')], ['Ctrl+Shift+C', t('precompose')],
    ['Ctrl+D', t('duplicate')], ['Ctrl+C / X / V', t('copyCutPaste')], ['Delete', t('delete')], ['Ctrl+Z / Ctrl+Shift+Z', t('undo') + ' / ' + t('redo')], ['Ctrl+A / F2', t('selectAll') + ' / ' + t('deselect')],
    ['Ctrl+] / Ctrl+[', t('forwardBackward')], ['Ctrl+Shift+] / [', t('frontBack')], ['Shift+= / Shift+-', t('blendNextPrev')], ['Ctrl+Alt+F', t('fitToComp')], ['Ctrl+Alt+Home', t('centerAnchor')], ['Ctrl+Alt+T', t('timeRemap')],
    ['Ctrl+K', t('compSettings')], ['Ctrl+N', t('newComp')], ['Ctrl+I', t('import')], ['Ctrl+S', t('save')], ['Ctrl+O', t('open')], ['Ctrl+M', t('renderAction')], ['Ctrl+Shift+/', t('addToRQ')],
    ['Ctrl+Alt+S', t('snapshot')], ["'", t('showGrid')], ['Shift+F3', t('graphEditor')], ['. / , ', t('zoomInOut')], ['Shift+/', t('fitView')], ['Ctrl+Shift+E', t('removeAllFx')], ['Ctrl+Alt+Shift+E', t('applyLastFx')],
  ];
  modal(t('shortcuts'), h('div', { class: 'sclist' }, rows.flatMap(([k, d]) => [h('span', { class: 'kbd' }, k), h('span', null, d)])), [{ label: t('close'), primary: true }], { wide: true });
}

export function aboutDialog() {
  modal(t('about'), h('div', null,
    h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } }, h('img', { src: 'icons/icon-192.png', width: 72, height: 72, style: { borderRadius: '16px' } }), h('div', null, h('b', { style: { fontSize: '17px' } }, t('appName')), h('div', { class: 'dim' }, 'v' + APP_VERSION))),
    h('p', null, t('aboutText')),
    h('p', { class: 'small dim' }, t('aboutCredits')),
    h('ul', { class: 'small' },
      h('li', null, h('a', { href: 'https://github.com/storytold/effectcraft', target: '_blank', rel: 'noopener', style: { color: 'var(--acc2)' } }, 'EffectCraft'), ' — MIT / Apache-2.0'),
      h('li', null, 'mediabunny — MPL-2.0'), h('li', null, 'gifenc — MIT'), h('li', null, 'lottie-web — MIT'), h('li', null, 'Google Fonts — OFL'))),
  [{ label: t('close'), primary: true }]);
}

// 匯出到小柯影音剪輯助手：選大小、範圍、透明背景；下面列出已經送過去的動畫（可刪除）
export async function toVideoDialog(c) {
  const { listShared, deleteShared, sharedMode, sameSiteAsVideo } = await import('./shared.js');
  const name = h('input', { value: c.name, style: { width: '100%' }, onkeydown: e => e.stopPropagation() });
  const sizes = [['720', `720p（${Math.round(c.w * 720 / c.h)}×720）`], ['1080', `1080p（${Math.round(c.w * 1080 / c.h)}×1080）`], ['full', `${t('full')}（${c.w}×${c.h}）`], ['half', `${t('half')}（${Math.round(c.w / 2)}×${Math.round(c.h / 2)}）`]];
  const size = sel(sizes, c.h > 1080 ? '1080' : 'full', () => { });
  const range = sel([['work', `${t('workArea')}（${timecode(c.workIn, c.fps)} – ${timecode(c.workOut, c.fps)}）`], ['full', t('fullComp')]], c.workIn > 0 || c.workOut < c.duration ? 'work' : 'full', () => { });
  const alpha = h('input', { type: 'checkbox', checked: true });
  const mode = sharedMode();
  const where = h('p', { class: 'small dim' }, t('tvWhere_' + mode));
  if (mode === 'idb' && !sameSiteAsVideo()) where.append(h('br'), h('span', { style: { color: 'var(--warn)' } }, t('tvNotOnline')));
  const list = h('div', { class: 'list', style: { maxHeight: '180px', border: '1px solid var(--line)', borderRadius: '6px' } });
  const fill = async () => {
    list.innerHTML = '';
    let items = [];
    try { items = await listShared(); } catch (e) { console.warn(e); }
    if (!items.length) { list.append(h('div', { class: 'empty small' }, t('tvEmpty'))); return; }
    for (const it of items) {
      list.append(h('div', { class: 'row' },
        it.thumb ? h('img', { src: it.thumb, style: { width: '48px', height: '27px', objectFit: 'contain', background: '#000', borderRadius: '3px' } }) : h('span', null, '🎬'),
        h('span', { class: 'nm' }, it.name), h('span', { class: 'ty' }, `${(it.dur || 0).toFixed(1)}s${it.alpha ? ' · ' + t('tvAlpha') : ''}`),
        h('button', { class: 'icon', title: t('delete'), onclick: async () => { await deleteShared(it); fill(); } }, '✕')));
    }
  };
  fill();
  const body = h('div', null,
    h('p', { class: 'dim small', style: { marginTop: 0 } }, t('tvIntro')),
    h('div', { class: 'form' }, h('label', null, t('name')), name, h('label', null, t('size')), size, h('label', null, t('range')), range,
      h('label', null, t('tvBackground')), h('label', { class: 'small' }, alpha, ' ', t('tvTransparent'))),
    where, h('div', { class: 'small', style: { margin: '10px 0 4px', fontWeight: 600 } }, t('tvExisting')), list);
  let out = null;
  const r = await modal(t('tvTitle'), body, [{ label: t('cancel') }, { label: t('tvSend'), primary: true, value: 'go', run: () => {
    const target = size.value === 'full' ? 1 : size.value === 'half' ? 0.5 : Math.min(2, +size.value / c.h);
    out = { name: name.value.trim() || c.name, res: target, range: range.value, alpha: alpha.checked };
  } }], { wide: true });
  return r === 'go' ? out : null;
}
