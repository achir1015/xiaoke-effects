# After Effects 專案（.aep）→ 小柯特效專案（.xke）轉換器
# 用法：python desktop/aep2xke.py 專案.aep [輸出.xke] [--photos 素材資料夾] [--max 1600]
#       桌面版 App 的「檔案 ▸ 匯入 After Effects 專案」也是呼叫這裡的 convert()
# 需要：pip install py-aep pillow
# 轉換內容：合成、巢狀合成、純色／空物件／調整圖層、圖片素材（內嵌，自動縮小）、文字、攝影機、燈光、
#           變形（含方向 Orientation、分離 XYZ 位置）、關鍵影格（線性／貝茲緩動／保持）、表達式、遮罩、
#           混合模式、軌道遮罩、時間重映射、常用效果（發光、模糊、漸層、擦除、填色、圓形、鏡頭光暈、碎形雜訊…）
#           「描邊」效果（沿遮罩畫線）會轉成形狀圖層＋修剪路徑，保留寫字般的生長動畫
import sys, os, io, json, math, base64, random, string, argparse
import py_aep

def _lenient_strings():
    # 舊版 AE（CS5.5 以前）專案裡的文字不一定是 UTF-8（例如 ™ 是 0x99）：解不開時改用 Windows 西歐編碼，不讓整個轉換失敗
    try:
        from py_aep.binary import scalar_chunks as sc
    except Exception:
        return
    base = sc._StringChunkBase
    if getattr(base, '_xke_lenient', False): return

    def read(cls, fp, size, *, chunk_type='', **kwargs):
        raw = sc.read_bytes(fp, size)
        try:
            v = raw.decode(cls._ENCODING)
        except UnicodeDecodeError:
            v = raw.decode('cp1252', 'replace')
        return cls(chunk_type=chunk_type, value=v)
    base.read = classmethod(read)
    base._xke_lenient = True
    # 舊版的素材設定區塊（opti）比較短：讀不懂就保留原始資料（純色顏色會用預設值）
    try:
        from py_aep.binary import footage_chunks as fc
        from py_aep.binary.bin_utils import read_bytes
        opti = fc.OptiChunk.read.__func__

        def read_opti(cls, fp, size, *, chunk_type='', **kwargs):
            pos = fp.tell()
            try:
                return opti(cls, fp, size, chunk_type=chunk_type, **kwargs)
            except OSError:
                fp.seek(pos)
                return fc.OptiChunk(chunk_type=chunk_type, data=read_bytes(fp, size))
        fc.OptiChunk.read = classmethod(read_opti)
    except Exception:
        pass
    # CS4 以前的專案：項目／圖層名稱放在 idta／ldta 的固定欄位裡，沒有 Utf8 區塊
    try:
        from py_aep.parsers import item as pi, layer as pl
        from py_aep.binary.scalar_chunks import Utf8Chunk

        def name_from(chunks):
            for c in chunks:
                if c.chunk_type == 'idta':
                    raw = getattr(c, '_reserved_18', b'') or b''
                    return raw.split(b'\x00')[0].decode('utf-8', 'replace')
                if c.chunk_type == 'ldta':
                    return str(getattr(c, 'layer_name', '') or '')
            return ''

        def lenient_find(mod):
            find0 = mod.find_by_type

            def find_by_type(chunks, chunk_type):
                try:
                    return find0(chunks=chunks, chunk_type=chunk_type)
                except Exception:
                    if chunk_type == 'Utf8':
                        return Utf8Chunk(chunk_type='Utf8', value=name_from(chunks))
                    raise
            mod.find_by_type = find_by_type
        lenient_find(pi); lenient_find(pl)
    except Exception:
        pass
    # 舊版的算圖佇列格式不同：讀不懂就當成空的（轉換用不到）
    try:
        from py_aep.parsers import project as pp2
        rq = pp2.parse_render_queue

        def parse_render_queue(root_chunks, project):
            try:
                return rq(root_chunks, project)
            except Exception:
                return rq([c for c in root_chunks if getattr(c, 'list_type', None) != 'LRdr'], project)
        pp2.parse_render_queue = parse_render_queue
    except Exception:
        pass
    # 舊版沒有的專案設定區塊：補預設值
    try:
        from py_aep.parsers import project as pp
        find = pp.find_by_type
        defaults = {'acer': lambda: sc.U1Chunk(chunk_type='acer', value=1), 'adfr': lambda: sc.F8Chunk(chunk_type='adfr', value=30.0)}

        def find_by_type(chunks, chunk_type):
            try:
                return find(chunks=chunks, chunk_type=chunk_type)
            except Exception:
                if chunk_type in defaults: return defaults[chunk_type]()
                raise
        pp.find_by_type = find_by_type
    except Exception:
        pass

_lenient_strings()

def uid(p=''):
    return p + ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(8))

def g(o, n, d=None):
    try:
        return getattr(o, n)
    except Exception:
        return d

def num(v):
    if isinstance(v, bool): return v
    if isinstance(v, (int, float)): return round(float(v), 5) if math.isfinite(v) else 0
    if isinstance(v, (list, tuple)): return [num(x) for x in v]
    return v

LABELS = ['#c7484a', '#e3b33f', '#5e8fd9', '#d97ad9', '#61bf8d', '#d98d3c', '#8d6fd9', '#5cc2c9', '#b5b5b5', '#a8865c']
BLEND = {'NORMAL': 'normal', 'DISSOLVE': 'dissolve', 'DANCING_DISSOLVE': 'dissolve', 'DARKEN': 'darken', 'MULTIPLY': 'multiply', 'LINEAR_BURN': 'linearBurn',
         'COLOR_BURN': 'colorBurn', 'CLASSIC_COLOR_BURN': 'colorBurn', 'ADD': 'add', 'LIGHTEN': 'lighten', 'SCREEN': 'screen', 'LINEAR_DODGE': 'linearDodge',
         'COLOR_DODGE': 'colorDodge', 'CLASSIC_COLOR_DODGE': 'colorDodge', 'OVERLAY': 'overlay', 'SOFT_LIGHT': 'softLight', 'HARD_LIGHT': 'hardLight',
         'LINEAR_LIGHT': 'linearLight', 'VIVID_LIGHT': 'vividLight', 'PIN_LIGHT': 'pinLight', 'HARD_MIX': 'hardMix', 'DIFFERENCE': 'difference',
         'CLASSIC_DIFFERENCE': 'difference', 'EXCLUSION': 'exclusion', 'HUE': 'hue', 'SATURATION': 'saturation', 'COLOR': 'color', 'LUMINOSITY': 'luminosity',
         'LIGHTER_COLOR': 'lighterColor', 'DARKER_COLOR': 'darkerColor', 'SUBTRACT': 'subtract', 'DIVIDE': 'divide'}
MATTE = {'ALPHA': 'alpha', 'ALPHA_INVERTED': 'alphaInv', 'LUMA': 'luma', 'LUMA_INVERTED': 'lumaInv'}
MASKMODE = {'ADD': 'add', 'SUBTRACT': 'subtract', 'INTERSECT': 'intersect', 'DIFFERENCE': 'difference', 'NONE': 'none', 'LIGHTEN': 'add', 'DARKEN': 'intersect'}
INTERP = {6612: 'linear', 6613: 'bezier', 6614: 'hold'}

def ename(e):
    return str(getattr(e, 'name', e)).split('.')[-1]

# ---------- 屬性與關鍵影格 ----------
def P(v):
    return {'v': v}

def unwrap_angles(keys):
    # 烘焙的方向角在 ±180° 之間跳動時，逐分量取最接近前一格的角度，避免插值時整圈亂轉
    prev = None
    for k in keys:
        v = k['v']
        if prev is not None and isinstance(v, list):
            k['v'] = v = [x + 360 * round((p - x) / 360) for x, p in zip(v, prev)]
        prev = v

def ease_ctrl(speed, infl, dt, dv, out):
    x = max(0.01, min(1.0, infl / 100.0))
    y = 0 if abs(dv) < 1e-9 else speed * x * dt / dv
    y = max(-2.0, min(3.0, y))
    return [round(x, 4), round(y, 4)] if out else [round(1 - x, 4), round(1 - y, 4)]

def vdist(a, b):
    if isinstance(a, list) and isinstance(b, list):
        return math.sqrt(sum((float(x) - float(y)) ** 2 for x, y in zip(a, b)))
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return float(b) - float(a)
    return 0

def conv_prop(p, start=0.0, f=None, angles=False):
    """AE 屬性 → {v, k?, x?}；f 用來轉換數值（例如百分比、顏色）"""
    f = f or (lambda v: v)
    out = {'v': f(num(g(p, 'value')))}
    keys = g(p, 'keyframes') or []
    if keys:
        ks = []
        for k in keys:
            ks.append({'t': round(float(k.time) - start, 5), 'v': f(num(k.value)), '_k': k})
        if angles: unwrap_angles(ks)
        spatial = bool(g(p, 'is_spatial'))
        for i, k in enumerate(ks):
            ak = k.pop('_k')
            oi = INTERP.get(int(g(ak, 'out_interpolation_type', 6613) or 6613), 'bezier')
            k['ti'] = oi
            nxt = ks[i + 1] if i + 1 < len(ks) else None
            prv = ks[i - 1] if i > 0 else None
            oe = g(ak, 'out_temporal_ease') or []
            ie = g(ak, 'in_temporal_ease') or []
            if nxt and oi == 'bezier' and oe:
                dv = vdist(k['v'], nxt['v'])
                if spatial: dv = abs(dv)
                if isinstance(k['v'], list) and not spatial and oe:
                    # 多維非空間屬性：用變化最大的分量
                    j = max(range(len(k['v'])), key=lambda j: abs(nxt['v'][j] - k['v'][j]) if j < len(nxt['v']) else 0)
                    dv = nxt['v'][j] - k['v'][j]; e = oe[min(j, len(oe) - 1)]
                else:
                    e = oe[0]
                k['eo'] = ease_ctrl(float(e.speed), float(e.influence), nxt['t'] - k['t'], dv, True)
            if prv and ie:
                pi = prv.get('ti')
                if pi == 'bezier' or INTERP.get(int(g(ak, 'in_interpolation_type', 6613) or 6613)) == 'bezier':
                    dv = vdist(prv['v'], k['v'])
                    if spatial: dv = abs(dv)
                    if isinstance(k['v'], list) and not spatial:
                        j = max(range(len(k['v'])), key=lambda j: abs(k['v'][j] - prv['v'][j]) if j < len(prv['v']) else 0)
                        dv = k['v'][j] - prv['v'][j]; e = ie[min(j, len(ie) - 1)]
                    else:
                        e = ie[0]
                    k['ei'] = ease_ctrl(float(e.speed), float(e.influence), k['t'] - prv['t'], dv, False)
                if pi == 'linear' or INTERP.get(int(g(ak, 'in_interpolation_type', 6613) or 6613)) == 'linear':
                    k['ei'] = [2 / 3, 2 / 3]
            if oi == 'linear': k['eo'] = [1 / 3, 1 / 3]
        out['k'] = ks
        out['v'] = ks[0]['v']
    ex = g(p, 'expression') if g(p, 'expression_enabled') else None
    if ex:
        out['x'] = ex.replace('\r\n', '\n').replace('\r', '\n')
    return out

def child(group, mn):
    if group is None: return None
    try:
        return group.property(mn)
    except Exception:
        return None

# ---------- 效果 ----------
EN_NAMES = {'ADBE Glo2': 'Glow', 'ADBE Fast Blur': 'Fast Blur', 'ADBE Gaussian Blur 2': 'Gaussian Blur', 'ADBE Ramp': 'Gradient Ramp', 'ADBE Linear Wipe': 'Linear Wipe',
            'ADBE Fill': 'Fill', 'ADBE Circle': 'Circle', 'ADBE Lens Flare': 'Lens Flare', 'ADBE Fractal Noise': 'Fractal Noise', 'ADBE Turbulent Displace': 'Turbulent Displace',
            'ADBE HUE SATURATION': 'Hue/Saturation', 'ADBE Tint': 'Tint', 'ADBE Easy Levels2': 'Levels', 'ADBE Drop Shadow': 'Drop Shadow', 'ADBE Slider Control': 'Slider Control',
            'ADBE Angle Control': 'Angle Control', 'ADBE Point Control': 'Point Control', 'ADBE Color Control': 'Color Control', 'ADBE Checkbox Control': 'Checkbox Control',
            'ADBE Brightness & Contrast 2': 'Brightness & Contrast', 'ADBE Corner Pin': 'Corner Pin', 'ADBE Geometry2': 'Transform', 'ADBE Exposure2': 'Exposure', 'ADBE PhotoFilterPS': 'Photo Filter', 'ADBE Tritone': 'Tritone', 'ADBE Bevel Alpha': 'Bevel Alpha', 'ADBE Invert': 'Invert', 'ADBE Venetian Blinds': 'Venetian Blinds', 'ADBE Radial Wipe': 'Radial Wipe'}
PCT = lambda v: v * 100
# 每個效果：工具效果 id、{AE 參數序號: (工具參數 id, 轉換)}，參數名稱（給表達式改寫用）
EFX = {
    'ADBE Glo2': ('glow', {2: ('glowThreshold', lambda v: v / 2.55), 3: ('glowRadius', None), 4: ('glowIntensity', None), 7: ('glowColors', lambda v: 'abColors' if v == 2 else 'originalColors'), 12: ('colorA', None), 13: ('colorB', None)},
                  {'Glow Threshold': 'glowThreshold', 'Glow Radius': 'glowRadius', 'Glow Intensity': 'glowIntensity'}),
    'ADBE Fast Blur': ('gaussianBlur', {1: ('blurriness', None), 2: ('dimensions', lambda v: {1: 'both', 2: 'horizontal', 3: 'vertical'}.get(int(v), 'both')), 3: ('repeatEdgePixels', bool)}, {'Blurriness': 'blurriness'}),
    'ADBE Gaussian Blur 2': ('gaussianBlur', {1: ('blurriness', None), 2: ('dimensions', lambda v: {1: 'both', 2: 'horizontal', 3: 'vertical'}.get(int(v), 'both')), 3: ('repeatEdgePixels', bool)}, {'Blurriness': 'blurriness'}),
    'ADBE Ramp': ('gradientRamp', {1: ('startOfRamp', None), 2: ('startColor', None), 3: ('endOfRamp', None), 4: ('endColor', None), 5: ('rampShape', lambda v: 'radial' if int(v) == 2 else 'linear'), 6: ('rampScatter', None), 7: ('blendWithOriginal', None)},
                  {'Start of Ramp': 'startOfRamp', 'End of Ramp': 'endOfRamp'}),
    'ADBE Linear Wipe': ('linearWipe', {1: ('transitionCompletion', None), 2: ('wipeAngle', None), 3: ('feather', None)}, {'Transition Completion': 'transitionCompletion'}),
    'ADBE Fill': ('fill', {2: ('color', None), 5: ('opacity', PCT)}, {'Color': 'color'}),
    'ADBE Circle': ('circle', {1: ('center', None), 2: ('radius', None), 6: ('feather', None), 9: ('invertCircle', bool), 10: ('color', None), 11: ('opacity', None)}, {'Center': 'center', 'Radius': 'radius'}),
    'ADBE Lens Flare': ('lensFlare', {1: ('flareCenter', None), 2: ('flareBrightness', None), 4: ('lensType', lambda v: {1: 'zoom50_300', 2: 'prime35', 3: 'prime105'}.get(int(v), 'zoom50_300')), 3: ('blendWithOriginal', None)},
                        {'Flare Center': 'flareCenter', 'Flare Brightness': 'flareBrightness'}),
    'ADBE Fractal Noise': ('fractalNoise', {1: ('fractalType', lambda v: 'turbulent' if int(v) in (2, 3, 4, 5, 6, 7, 8) else 'basic'), 3: ('invert', bool), 4: ('contrast', None), 5: ('brightness', None), 9: ('uniformScaling', bool), 10: ('scale', None), 11: ('scaleWidth', None), 12: ('scaleHeight', None), 15: ('complexity', None), 23: ('evolution', None), 29: ('opacity', None)},
                           {'Evolution': 'evolution', 'Contrast': 'contrast', 'Brightness': 'brightness'}),
    'ADBE Turbulent Displace': ('turbulentDisplace', {1: ('displacement', lambda v: {1: 'turbulent', 4: 'twist', 5: 'horizontal', 6: 'vertical'}.get(int(v), 'turbulent')), 2: ('amount', None), 3: ('size', None), 5: ('complexity', None), 6: ('evolution', None)},
                                {'Evolution': 'evolution', 'Amount': 'amount', 'Size': 'size'}),
    'ADBE HUE SATURATION': ('hueSaturation', {4: ('masterHue', None), 5: ('masterSaturation', None), 6: ('masterLightness', None), 7: ('colorize', bool), 8: ('colorizeHue', None), 9: ('colorizeSaturation', None), 10: ('colorizeLightness', None)}, {}),
    'ADBE Tint': ('tint', {1: ('mapBlackTo', None), 2: ('mapWhiteTo', None), 3: ('amountToTint', None)}, {'Amount to Tint': 'amountToTint'}),
    'ADBE Easy Levels2': ('levels', {3: ('inputBlack', lambda v: v * 255 if v <= 1 else v), 4: ('inputWhite', lambda v: v * 255 if v <= 1 else v), 5: ('gamma', None), 6: ('outputBlack', lambda v: v * 255 if v <= 1 else v), 7: ('outputWhite', lambda v: v * 255 if v <= 1 else v)}, {}),
    'ADBE Drop Shadow': ('dropShadow', {1: ('shadowColor', None), 2: ('opacity', None), 3: ('direction', lambda v: v - 45), 4: ('distance', None), 5: ('size', lambda v: v / 2), 6: ('shadowOnly', bool)}, {}),
    'ADBE Corner Pin': ('cornerPin', {1: ('upperLeft', None), 2: ('upperRight', None), 3: ('lowerLeft', None), 4: ('lowerRight', None)},
                        {'Upper Left': 'upperLeft', 'Upper Right': 'upperRight', 'Lower Left': 'lowerLeft', 'Lower Right': 'lowerRight'}),
    'ADBE Geometry2': ('transform', {1: ('anchorPoint', None), 2: ('position', None), 3: ('scale', None), 5: ('skew', None), 6: ('skewAxis', None), 7: ('rotation', None), 8: ('opacity', None)},
                       {'Anchor Point': 'anchorPoint', 'Position': 'position', 'Scale Height': 'scale', 'Rotation': 'rotation', 'Opacity': 'opacity'}),
    'ADBE Exposure2': ('exposure', {3: ('exposure', None), 4: ('offset', None), 5: ('gammaCorrection', None)}, {'Exposure': 'exposure'}),
    'ADBE PhotoFilterPS': ('photoFilter', {2: ('color', None), 3: ('density', None), 4: ('preserveLuminosity', bool)}, {'Density': 'density'}),
    'ADBE Tritone': ('tritone', {1: ('highlights', None), 2: ('midtones', None), 3: ('shadows', None), 4: ('blendWithOriginal', None)}, {}),
    'ADBE Bevel Alpha': ('bevelAlpha', {1: ('edgeThickness', None), 2: ('lightAngle', None), 3: ('lightColor', None), 4: ('lightIntensity', None)}, {}),
    'ADBE Slider Control': ('sliderControl', {1: ('slider', None)}, {'Slider': 'slider'}),
    'ADBE Angle Control': ('angleControl', {1: ('angle', None)}, {'Angle': 'angle'}),
    'ADBE Point Control': ('pointControl', {1: ('point', None)}, {'Point': 'point'}),
    'ADBE Color Control': ('colorControl', {1: ('color', None)}, {'Color': 'color'}),
    'ADBE Checkbox Control': ('checkboxControl', {1: ('checkbox', bool)}, {'Checkbox': 'checkbox'}),
    'ADBE Brightness & Contrast 2': ('brightnessContrast', {1: ('brightness', None), 2: ('contrast', None)}, {}),
}
SKIPPED = {}
VIDEO_EXT = {'.mp4', '.mov', '.m4v', '.webm'}            # 瀏覽器（WebView2／Qt WebEngine）能播的 H.264／VP9 影片
AUDIO_EXT = {'.mp3', '.wav', '.m4a', '.aac', '.ogg'}
MEDIA_MIME = {'.mp4': 'video/mp4', '.mov': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
              '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg'}
OTHER_MEDIA = {'.avi', '.mxf', '.wmv', '.flv', '.mkv', '.aif', '.aiff', '.mpg', '.mpeg'}

def color4(v):
    if isinstance(v, list) and len(v) == 3: return v + [1]
    if isinstance(v, list) and len(v) == 4: return v[:3] + [1]
    return v

def conv_effect(e, start, tool_params):
    mn = e.match_name
    spec = EFX.get(mn)
    if not spec:
        SKIPPED[mn] = SKIPPED.get(mn, 0) + 1
        return None
    tid, pmap, names = spec
    params = {}
    for p in e.properties:
        pm = p.match_name
        if not pm.startswith(mn + '-'): continue
        try: idx = int(pm.rsplit('-', 1)[1])
        except ValueError: continue
        if idx not in pmap: continue
        pid, fn = pmap[idx]
        defs = tool_params.get(tid, {})
        typ = defs.get(pid)
        def f(v, fn=fn, typ=typ):
            if v is None: return v
            if fn: v = fn(v)
            if typ == 'color': v = color4(v)
            if typ == 'bool': v = bool(v)
            return v
        params[pid] = conv_prop(p, start, f)
    if tid == 'fractalNoise': params.setdefault('animate', P(False))   # AE 的演化只靠關鍵影格／表達式
    if tid in ('sliderControl', 'angleControl', 'pointControl', 'colorControl', 'checkboxControl'):
        name = e.name
    else:
        name = EN_NAMES.get(mn, e.name)
    return {'id': uid('e'), 'type': tid, 'on': bool(g(e, 'enabled', True)), 'params': params, 'collapse': False, 'name': name, '_names': names}

# ---------- 遮罩 ----------
def shape_pts(s, k=1.0):
    vs = g(s, 'vertices') or []; ins = g(s, 'in_tangents') or []; outs = g(s, 'out_tangents') or []
    pts = []
    for i, v in enumerate(vs):
        it = ins[i] if i < len(ins) else [0, 0]; ot = outs[i] if i < len(outs) else [0, 0]
        pts.append([round(v[0] * k, 3), round(v[1] * k, 3), round(it[0] * k, 3), round(it[1] * k, 3), round(ot[0] * k, 3), round(ot[1] * k, 3)])
    return {'closed': bool(g(s, 'closed', True)), 'pts': pts}

def conv_masks(l, start, k=1.0):
    out = []
    mp = child(l, 'ADBE Mask Parade')
    if not mp: return out
    for i, m in enumerate(mp.properties):
        path = child(m, 'ADBE Mask Shape')
        pr = conv_prop(path, start, lambda s: shape_pts(s, k) if not isinstance(s, dict) else s)
        fe = child(m, 'ADBE Mask Feather'); op = child(m, 'ADBE Mask Opacity'); ex = child(m, 'ADBE Mask Offset')
        out.append({'id': uid('m'), 'name': m.name, 'mode': MASKMODE.get(ename(g(m, 'mask_mode', 'ADD')), 'add'), 'inverted': bool(g(m, 'inverted', False)), 'on': True,
                    'path': pr, 'feather': conv_prop(fe, start, lambda v: v[0] * k if isinstance(v, list) else v) if fe else P(0),
                    'opacity': conv_prop(op, start) if op else P(100), 'expansion': conv_prop(ex, start, lambda v: v * k) if ex else P(0), 'color': LABELS[i % len(LABELS)]})
    return out

# ---------- 變形 ----------
def conv_transform(l, start, is3d, k=1.0):
    tg = child(l, 'ADBE Transform Group')
    tr = {'anchor': P([0, 0, 0]), 'position': P([0, 0, 0]), 'scale': P([100, 100, 100]), 'rotation': P(0), 'rotX': P(0), 'rotY': P(0), 'opacity': P(100)}
    if not tg: return tr
    a = child(tg, 'ADBE Anchor Point')
    if a: tr['anchor'] = conv_prop(a, start, lambda v: [x * k for x in v] + [0] * (3 - len(v)) if isinstance(v, list) else v)
    pos = child(tg, 'ADBE Position')
    if pos and g(pos, 'dimensions_separated'):
        # 分離的 X/Y/Z：合成一個位置（用表達式把三個值組合起來最準，但先用關鍵影格最多的那個時間點取樣）
        xs = [child(tg, n) for n in ('ADBE Position_0', 'ADBE Position_1', 'ADBE Position_2')]
        parts = [conv_prop(x, start) if x else P(0) for x in xs]
        times = sorted({kk['t'] for pp in parts for kk in pp.get('k', [])})
        if times:
            ks = []
            for t in times:
                ks.append({'t': t, 'v': [sample(pp, t) for pp in parts], 'ti': 'linear', 'eo': [1 / 3, 1 / 3], 'ei': [2 / 3, 2 / 3]})
            tr['position'] = {'v': ks[0]['v'], 'k': ks}
        else:
            tr['position'] = P([pp['v'] for pp in parts])
    elif pos:
        tr['position'] = conv_prop(pos, start, lambda v: v + [0] * (3 - len(v)) if isinstance(v, list) else v)
    s = child(tg, 'ADBE Scale')
    if s: tr['scale'] = conv_prop(s, start, lambda v: [x / k for x in v[:2]] + [v[2] if len(v) > 2 else 100] if isinstance(v, list) else v)
    if is3d:
        o = child(tg, 'ADBE Orientation')
        if o:
            op = conv_prop(o, start, angles=True)
            if op.get('k') or any(abs(x) > 1e-6 for x in (op['v'] or [0, 0, 0])) or op.get('x'): tr['orient'] = op
        for n, kk in (('ADBE Rotate X', 'rotX'), ('ADBE Rotate Y', 'rotY'), ('ADBE Rotate Z', 'rotation')):
            r = child(tg, n)
            if r: tr[kk] = conv_prop(r, start)
    else:
        r = child(tg, 'ADBE Rotate Z')
        if r: tr['rotation'] = conv_prop(r, start)
    op = child(tg, 'ADBE Opacity')
    if op: tr['opacity'] = conv_prop(op, start)
    return tr

def sample(pp, t):
    ks = pp.get('k')
    if not ks: return pp['v']
    if t <= ks[0]['t']: return ks[0]['v']
    for a, b in zip(ks, ks[1:]):
        if a['t'] <= t <= b['t']:
            if a.get('ti') == 'hold': return a['v']
            u = (t - a['t']) / ((b['t'] - a['t']) or 1)
            return a['v'] + (b['v'] - a['v']) * u
    return ks[-1]['v']

# ---------- 文字 ----------
SHAPES = {1: 'square', 2: 'rampUp', 3: 'rampDown', 4: 'triangle', 5: 'round', 6: 'smooth'}
BASED = {1: 'chars', 2: 'charsNoSpace', 3: 'words', 4: 'lines'}
TEXT_PROPS = {'ADBE Text Position 3D': ('position', lambda v: v[:2]), 'ADBE Text Opacity': ('opacity', None), 'ADBE Text Rotation': ('rotation', None),
              'ADBE Text Scale 3D': ('scale', lambda v: v[:2]), 'ADBE Text Tracking Amount': ('tracking', None), 'ADBE Text Fill Color': ('fill', color4),
              'ADBE Text Blur': ('blur', lambda v: v[0] if isinstance(v, list) else v)}

def lead_ratio(doc, eff):
    # 行距：自動行距＝1.2 倍；py_aep 讀到的固定行距有時明顯偏小（單位不同），太小就用 1.2 倍
    ld = float(g(doc, 'leading') or 0)
    if g(doc, 'auto_leading') or ld <= 0: return 1.2
    r = ld / max(1, eff)
    return round(r, 3) if r >= 0.8 else 1.2

def conv_text(l, start):
    tp = child(l, 'ADBE Text Properties')
    td = child(tp, 'ADBE Text Document')
    doc = g(td, 'value')
    text = (g(doc, 'text') or '').replace('\r', '\n')
    size = float(g(doc, 'font_size') or 72)
    vs = float(g(doc, 'vertical_scale') or 1) or 1
    hs = float(g(doc, 'horizontal_scale') or 1) or 1
    fill = color4(num(g(doc, 'fill_color') or [1, 1, 1]))
    just = ename(g(doc, 'justification', 'LEFT_JUSTIFY'))
    align = 'center' if 'CENTER' in just else 'right' if 'RIGHT' in just else 'left'
    tx = {'text': P(text), 'font': g(doc, 'font') or 'Arial', 'weight': 700, 'italic': False, 'caps': bool(g(doc, 'all_caps')), 'size': P(round(size * vs, 2)),
          'fill': P(fill), 'fillOn': bool(g(doc, 'apply_fill', True)), 'stroke': P(color4(num(g(doc, 'stroke_color') or [0, 0, 0]))),
          'strokeW': P(float(g(doc, 'stroke_width') or 0) * vs / 2 if g(doc, 'apply_stroke') else 0), 'strokeOver': bool(g(doc, 'stroke_over_fill')),
          'tracking': P(float(g(doc, 'tracking') or 0)), 'leading': P(lead_ratio(doc, size * vs)),
          'align': align, 'vAlign': 'baseline', 'boxW': 0, 'animators': []}
    if abs(hs - vs) > 0.01:
        tx['animators'].append({'id': uid('a'), 'name': 'AE 水平縮放', 'on': True, 'props': {'scale': P([round(hs / vs * 100, 2), 100])},
                                'range': {'start': P(0), 'end': P(100), 'offset': P(0), 'shape': 'square', 'basedOn': 'chars', 'smooth': P(100), 'amount': P(100), 'randomize': False}})
    anims = child(tp, 'ADBE Text Animators')
    for an in (anims.properties if anims else []):
        props = {}
        ap = child(an, 'ADBE Text Animator Properties')
        for p in (ap.properties if ap else []):
            m = TEXT_PROPS.get(p.match_name)
            if m and (g(p, 'is_modified', True) or g(p, 'keyframes') or g(p, 'expression_enabled')): props[m[0]] = conv_prop(p, start, m[1])
        if not props: continue
        rng = {'start': P(0), 'end': P(100), 'offset': P(0), 'shape': 'square', 'basedOn': 'chars', 'smooth': P(100), 'amount': P(100), 'randomize': False}
        sels = child(an, 'ADBE Text Selectors')
        sel = sels.properties[0] if sels and sels.num_properties else None
        if sel is not None:
            for mn, kk in (('ADBE Text Percent Start', 'start'), ('ADBE Text Percent End', 'end'), ('ADBE Text Percent Offset', 'offset')):
                q = child(sel, mn)
                if q: rng[kk] = conv_prop(q, start)
            adv = child(sel, 'ADBE Text Range Advanced')
            if adv:
                sh = child(adv, 'ADBE Text Range Shape'); bt = child(adv, 'ADBE Text Range Type2'); am = child(adv, 'ADBE Text Selector Max Amount'); rd = child(adv, 'ADBE Text Randomize Order')
                if sh: rng['shape'] = SHAPES.get(int(g(sh, 'value') or 1), 'square')
                if bt: rng['basedOn'] = BASED.get(int(g(bt, 'value') or 1), 'chars')
                if am: rng['amount'] = conv_prop(am, start)
                if rd: rng['randomize'] = bool(g(rd, 'value'))
        tx['animators'].append({'id': uid('a'), 'name': an.name, 'on': True, 'props': props, 'range': rng})
    return tx

# ---------- 描邊效果 → 形狀圖層 ----------
def stroke_to_shapes(l, start, eff):
    mp = child(l, 'ADBE Mask Parade')
    masks = list(mp.properties) if mp else []
    vals = {}
    for p in eff.properties:
        try: vals[int(p.match_name.rsplit('-', 1)[1])] = p
        except Exception: pass
    which = int(g(vals.get(1), 'value') or 1); all_m = bool(g(vals.get(10), 'value'))
    use = masks if all_m else masks[which - 1:which]
    col = color4(num(g(vals.get(2), 'value') or [1, 1, 1]))
    width = conv_prop(vals[3], start) if 3 in vals else P(10)
    st = conv_prop(vals[8], start) if 8 in vals else P(0)
    en = conv_prop(vals[9], start) if 9 in vals else P(100)
    op = conv_prop(vals[5], start, PCT) if 5 in vals else P(100)
    items = []
    for m in use:
        path = conv_prop(child(m, 'ADBE Mask Shape'), start, lambda s: shape_pts(s) if not isinstance(s, dict) else s)
        items.append(shape_item('path', path, col, width, st, en, op))
    return items

def shape_item(kind, path, col, width, st, en, op):
    return {'id': uid('s'), 'kind': kind, 'name': 'Stroke', 'visible': True, 'size': P([400, 300]), 'round': P(0), 'pos': P([0, 0]), 'rot': P(0), 'scl': P([100, 100]),
            'points': P(5), 'outerR': P(200), 'innerR': P(90), 'outerRound': P(0), 'innerRound': P(0), 'path': path,
            'fill': {'on': False, 'type': 'solid', 'color': P(col), 'color2': P(col), 'opacity': P(100), 'gStart': P([-200, 0]), 'gEnd': P([200, 0])},
            'stroke': {'on': True, 'color': P(col), 'width': width, 'opacity': op, 'cap': 'round', 'join': 'round', 'dash': P(0), 'gap': P(0)},
            'trim': {'on': True, 'start': st, 'end': en, 'offset': P(0)},
            'repeater': {'on': False, 'copies': P(3), 'offset': P([150, 0]), 'rot': P(0), 'scale': P([100, 100]), 'startOp': P(100), 'endOp': P(100)},
            'zigzag': {'on': False, 'size': P(10), 'ridges': P(10), 'smooth': False}, 'wiggle': {'on': False, 'size': P(20), 'detail': P(4), 'speed': P(2)}}

# ---------- 圖層 ----------
class Conv:
    def __init__(self, app, photos=None, maxpx=1600, tool_params=None):
        self.app = app; self.photos = photos; self.maxpx = maxpx; self.tp = tool_params or {}
        self.comp_ids = {}; self.foot = {}; self.footage = []; self.lab = 0; self.missing = []
        self.index = {}; self.unsupported = []; self.progress = None; self.done = 0; self.total = 1; self.raw = {}; self.media = {}

    def label(self):
        self.lab += 1
        return LABELS[self.lab % len(LABELS)]

    def footage_for(self, item):
        if item.id in self.foot: return self.foot[item.id]
        ms = g(item, 'main_source'); path = str(g(ms, 'file') or '') or self.raw.get(item.id, {}).get('path', '')
        base = os.path.basename(path.replace('\\', '/'))
        # 原本的路徑找不到時，用檔名在 .aep 所在資料夾（含子資料夾）與使用者指定的資料夾裡找
        cands = [path, self.index.get(base.lower())]
        if self.photos: cands.append(os.path.join(self.photos, base))
        real = next((c for c in cands if c and os.path.isfile(c)), None)
        rec = None
        ext = os.path.splitext(real or base)[1].lower()
        if real and ext in OTHER_MEDIA:
            self.unsupported.append(base); real = None
        if real and (ext in VIDEO_EXT or ext in AUDIO_EXT):
            # 影片／音訊不內嵌（常常好幾百 MB）：記下路徑，桌面版匯入時直接從硬碟讀
            rec = {'id': uid('f'), 'name': item.name or base, 'kind': 'audio' if ext in AUDIO_EXT else 'video', 'blobKey': uid('b'),
                   'size': os.path.getsize(real), 'type': MEDIA_MIME.get(ext, 'video/mp4'), 'w': g(item, 'width') or 0, 'h': g(item, 'height') or 0,
                   'duration': round(float(g(item, 'duration') or 0), 4), '_k': 1.0}
            if ext in VIDEO_EXT and g(item, 'frame_rate'): rec['fps'] = round(float(item.frame_rate), 3)
            self.footage.append(rec); self.media[rec['id']] = real
            self.foot[item.id] = rec
            return rec
        im = None
        if real:
            from PIL import Image
            try:
                im = Image.open(real); im.load()
            except Exception:
                self.unsupported.append(base); im = None
        if im is not None:
            w0, h0 = im.size
            k = min(1.0, self.maxpx / max(w0, h0))
            if k < 1: im = im.resize((max(1, round(w0 * k)), max(1, round(h0 * k))), Image.LANCZOS)
            buf = io.BytesIO()
            if im.mode in ('RGBA', 'LA', 'P'):
                im.convert('RGBA').save(buf, 'PNG'); mime = 'image/png'
            else:
                im.convert('RGB').save(buf, 'JPEG', quality=88); mime = 'image/jpeg'
            data = buf.getvalue()
            rec = {'id': uid('f'), 'name': item.name or base, 'kind': 'image', 'blobKey': uid('b'), 'size': len(data), 'type': mime, 'w': im.size[0], 'h': im.size[1],
                   'data': 'data:' + mime + ';base64,' + base64.b64encode(data).decode(), '_k': im.size[0] / w0}
            self.footage.append(rec)
        elif base not in self.unsupported:
            self.missing.append(path)
        self.foot[item.id] = rec
        return rec

    def comp(self, c):
        if c.id in self.comp_ids: return self.comp_ids[c.id]
        cid = uid('c'); self.comp_ids[c.id] = cid
        bg = num(g(c, 'bg_color') or [0, 0, 0])
        out = {'id': cid, 'name': c.name, 'w': c.width, 'h': c.height, 'fps': round(float(c.frame_rate), 3), 'duration': round(float(c.duration), 4),
               'bg': color4(bg), 'layers': [], 'workIn': round(float(g(c, 'work_area_start') or 0), 4), 'workOut': round(float(g(c, 'work_area_start') or 0) + float(g(c, 'work_area_duration') or c.duration), 4),
               'markers': [], 'motionBlur': False, 'shutter': 180, 'samples': 8, 'folder': None}
        self.comps.append(out)
        self.done += 1
        if self.progress: self.progress(self.done, self.total)
        ids = {}
        layers = list(c.layers)
        for l in layers: ids[l.index] = uid('l')
        for l in layers:
            try:
                L = self.layer(l, c, out, ids)
            except Exception as e:
                print('  ! 圖層', c.name, '/', g(l, 'name'), '：', repr(e)[:160])
                L = None
            if L: out['layers'].append(L)
        return cid

    def layer(self, l, c, comp_out, ids):
        typ = type(l).__name__
        start = float(g(l, 'start_time') or 0)
        stretch = float(g(l, 'stretch') or 100) or 100
        is3d = True if typ in ('CameraLayer', 'LightLayer') else bool(g(l, 'three_d_layer'))
        L = {'id': ids[l.index], 'type': 'solid', 'name': l.name, 'label': self.label(), 'in': round(float(l.in_point), 5), 'out': round(float(l.out_point), 5), 'start': round(start, 5),
             'speed': round(100 / stretch, 5), 'visible': bool(g(l, 'enabled', True)), 'solo': False, 'locked': False, 'shy': bool(g(l, 'shy')), 'audioOn': True, 'threeD': is3d,
             'motionBlur': bool(g(l, 'motion_blur')), 'collapse': bool(g(l, 'collapse_transformation')), 'blend': BLEND.get(ename(g(l, 'blending_mode', 'NORMAL')), 'normal'),
             'parent': ids.get(l.parent.index) if g(l, 'parent') else None, 'matte': 'none', 'matteLayer': None, 'preserveAlpha': bool(g(l, 'preserve_transparency')),
             'quality': 'best', 'effects': [], 'masks': [], 'styles': []}
        tm = MATTE.get(ename(g(l, 'track_matte_type', 'NO_TRACK_MATTE')))
        if tm:
            L['matte'] = tm
            ml = g(l, 'track_matte_layer')
            L['matteLayer'] = ids.get(ml.index) if ml is not None else ids.get(l.index - 1)
        k = 1.0
        src = g(l, 'source')
        if typ == 'CameraLayer':
            L['type'] = 'camera'   # AE 攝影機預設朝向目標點；py_aep 讀舊專案的自動定向旗標不可靠，一律當雙節點
            co = child(l, 'ADBE Camera Options Group')
            zoom = child(co, 'ADBE Camera Zoom'); poi = child(child(l, 'ADBE Transform Group'), 'ADBE Anchor Point')
            L['camera'] = {'zoom': conv_prop(zoom, start) if zoom else P(c.width * 1.3889), 'poi': conv_prop(poi, start) if poi else P([c.width / 2, c.height / 2, 0]),
                           'twoNode': True, 'dof': False, 'focus': P(1000), 'aperture': P(25), 'blur': P(100)}
            L['transform'] = conv_transform(l, start, True)
            L['transform']['anchor'] = P([0, 0, 0])
            return L
        if typ == 'LightLayer':
            L['type'] = 'light'
            lo = child(l, 'ADBE Light Options Group')
            kind = {'PARALLEL': 'parallel', 'SPOT': 'spot', 'POINT': 'point', 'AMBIENT': 'ambient'}.get(ename(g(l, 'light_type', 'POINT')), 'point')
            gp = lambda mn, d, f=None: conv_prop(child(lo, mn), start, f) if child(lo, mn) else P(d)
            poi = child(child(l, 'ADBE Transform Group'), 'ADBE Anchor Point')
            L['light'] = {'kind': kind, 'color': gp('ADBE Light Color', [1, 1, 1, 1], color4), 'intensity': gp('ADBE Light Intensity', 100), 'poi': conv_prop(poi, start) if poi else P([960, 540, 0]),
                          'cone': gp('ADBE Light Cone Angle', 90), 'feather': gp('ADBE Light Cone Feather 2', 50), 'shadows': False, 'ambient': P(20)}
            L['transform'] = conv_transform(l, start, True)
            L['transform']['anchor'] = P([0, 0, 0])
            return L
        if typ == 'TextLayer':
            L['type'] = 'text'
            L['text'] = conv_text(l, start)
        elif typ == 'ShapeLayer':
            print('  ! 形狀圖層尚未支援，略過：', l.name); return None
        elif src is not None and type(src).__name__ == 'CompItem':
            L['type'] = 'precomp'; L['comp'] = self.comp(src); L['collapseT'] = bool(g(l, 'collapse_transformation'))
        elif src is not None:
            ms = g(src, 'main_source'); stype = type(ms).__name__
            if g(l, 'null_layer'):
                L['type'] = 'null'
            elif g(l, 'adjustment_layer'):
                L['type'] = 'adjust'
            elif stype == 'SolidSource' or g(ms, 'color') is not None or 'solid' in self.raw.get(src.id, {}):
                col = g(ms, 'color') if g(ms, 'color') is not None else self.raw.get(src.id, {}).get('solid', [1, 1, 1])
                L['type'] = 'solid'; L['solid'] = {'w': src.width, 'h': src.height, 'color': P(color4(num(list(col))))}
            else:
                f = self.footage_for(src)
                if not f:
                    L['type'] = 'solid'; L['solid'] = {'w': src.width or 100, 'h': src.height or 100, 'color': P([0.5, 0.5, 0.5, 1])}; L['name'] += '（找不到素材）'
                else:
                    L['type'] = f['kind']; L['source'] = f['id']; k = f['_k']
                    if f['kind'] != 'image': L['audio'] = {'level': P(0)}
        else:
            L['type'] = 'null'
        L['transform'] = conv_transform(l, start, is3d, k)
        if L['type'] in ('null', 'adjust'):
            pass
        L['masks'] = conv_masks(l, start, k)
        # 效果與圖層樣式
        ep = child(l, 'ADBE Effect Parade')
        stroke_items = []
        plugin_only = 0
        for e in (ep.properties if ep else []):
            if e.match_name == 'ADBE Stroke' and L['masks']:
                paint = None
                for p in e.properties:
                    if p.match_name == 'ADBE Stroke-0007': paint = int(g(p, 'value') or 1)
                stroke_items += stroke_to_shapes(l, start, e)
                if paint and paint >= 2:      # 在透明背景上／顯示原始圖層以外：只留描邊
                    L['_strokeOnly'] = True
                continue
            fx = conv_effect(e, start, self.tp)
            if fx: L['effects'].append(fx)
            elif e.match_name not in ('ADBE Effect Built In Params',): plugin_only = plugin_only + 1
        # 純色圖層只掛了工具沒有的效果（Optical Flares、Particular 等外掛產生畫面用的）：直接畫會變成一整片色塊，先隱藏
        if plugin_only and not L['effects'] and L['type'] in ('solid', 'adjust') and not stroke_items:
            L['visible'] = False
            L['name'] = (L['name'] or 'Plugin') + '（外掛效果，已隱藏）'
        if stroke_items:
            if L.get('_strokeOnly') or L['type'] == 'solid':
                L['type'] = 'shape'; L['shapes'] = stroke_items; L.pop('solid', None); L['masks'] = []
            else:
                print('  ! 描邊效果疊在原圖上，先只轉描邊：', l.name)
        L.pop('_strokeOnly', None)
        ls = child(l, 'ADBE Layer Styles')
        if ls:
            for st in ls.properties:
                if st.match_name == 'strokeStyle/enablePropertyGroup' or 'stroke' in st.match_name.lower():
                    if not g(st, 'enabled', True): continue
                    vals = {p.match_name: p for p in st.properties}
                    col = next((v for kk, v in vals.items() if kk.endswith('color')), None); size = next((v for kk, v in vals.items() if kk.endswith('size')), None)
                    if col or size:
                        L['effects'].append({'id': uid('e'), 'type': 'stroke', 'on': True, 'collapse': False, 'name': 'Stroke',
                                             'params': {'color': conv_prop(col, start, color4) if col else P([1, 1, 1, 1]), 'size': conv_prop(size, start) if size else P(3), 'position': P('outside'), 'opacity': P(100)}})
        tr = child(l, 'ADBE Time Remapping')
        if tr is not None and g(l, 'time_remap_enabled'):
            L['timeRemap'] = {'on': True, 'p': conv_prop(tr, start)}
        if not L['name']:
            L['name'] = (g(src, 'name') or self.raw.get(src.id, {}).get('name', '') if src is not None else '') or {'camera': 'Camera', 'light': 'Light', 'text': 'Text', 'null': 'Null'}.get(L['type'], '')
            if not L['name'] and L['type'] in ('image', 'video', 'audio'):
                L['name'] = next((f['name'] for f in self.footage if f['id'] == L.get('source')), 'Footage')
            L['name'] = L['name'] or L['type']
        return L

    def run(self):
        self.comps = []
        comps = list(self.app.project.compositions)
        self.total = len(comps)
        for c in comps: self.comp(c)
        # 表達式：效果名稱與參數名稱換成工具的 id
        names = {}
        for c in self.comps:
            for L in c['layers']:
                for e in L.get('effects', []):
                    names.update(e.pop('_names', {}))
        import re
        def fix(s):
            def rep(m):
                n = m.group(2)
                return m.group(1) + '"' + names.get(n, n) + '")'
            return re.sub(r'(effect\([^)]*\)\()"([^"]+)"\)', rep, s)
        def walk(o):
            if isinstance(o, dict):
                if isinstance(o.get('x'), str): o['x'] = fix(o['x'])
                for v in o.values(): walk(v)
            elif isinstance(o, list):
                for v in o: walk(v)
        walk(self.comps)
        for f in self.footage: f.pop('_k', None)
        main = max(self.comps, key=lambda c: (len(c['layers']) > 0, c['duration'] * (2 if c['name'].upper().startswith('FINAL') else 1)))
        return {'format': 'xiaoke-effects', 'version': 1, 'name': os.path.splitext(os.path.basename(self.app.project.file or 'AE'))[0] if isinstance(g(self.app.project, 'file'), str) else 'AE',
                'comps': self.comps, 'footage': self.footage, 'folders': [], 'activeComp': main['id'], 'renderQueue': []}

def tool_param_types(fx_js):
    # 讀工具的 fx.js，取得每個效果參數的型別（color/bool/…）
    import re
    src = open(fx_js, encoding='utf8').read()
    out = {}
    for m in re.finditer(r"^E\('(\w+)', '\w+', \[(.*?)\],", src, re.M | re.S):
        tid, body = m.group(1), m.group(2)
        out[tid] = {}
        for pm in re.finditer(r"(num|px|pct|ang|col|pt|bool|sel)\('(\w+)'", body):
            out[tid][pm.group(2)] = {'col': 'color', 'bool': 'bool', 'pt': 'point', 'sel': 'select'}.get(pm.group(1), 'number')
    return out

def raw_footage(aep):
    """直接掃描 RIFX：素材項目 id → {'path', 'solid': [r,g,b], 'name'}（舊版專案 py_aep 讀不到素材路徑與純色顏色時用）"""
    import struct, re
    b = open(aep, 'rb').read()
    out = {}

    def chunks(off, end):
        while off + 8 <= end:
            cid = b[off:off + 4]; size = struct.unpack('>I', b[off + 4:off + 8])[0]
            yield cid, off + 8, size
            off += 8 + size + (size & 1)

    def scan(off, end, info):
        # 收集這個項目底下的 alas／opti（遇到巢狀的 Item 就換新的項目）
        for cid, do, size in chunks(off, end):
            if cid == b'LIST':
                lt = b[do:do + 4]
                if lt == b'Item': item(do + 4, do + size)
                elif lt != b'btdk': scan(do + 4, do + size, info)
            elif info is not None and cid == b'alas':
                raw = b[do:do + size]
                m = re.search(rb'"fullpath"\s*:\s*"((?:[^"\\]|\\.)*)"', raw)
                if m:
                    info['path'] = json.loads(b'"' + m.group(1) + b'"')
                else:
                    m = re.search(rb'([A-Za-z]:\\[^\x00]+|/(?:Users|Volumes)/[^\x00]+)', raw)
                    if m: info['path'] = m.group(1).decode('utf-8', 'replace')
                    else:
                        # AE 7 的舊 Mac 式路徑「:C::資料夾:Photos:檔名.jpg」：只要最後的檔名（之後用檔名找）
                        m = re.search(rb':([^:\x00]+\.[A-Za-z0-9]{2,5})\x00', raw)
                        if m: info['path'] = m.group(1).decode('utf-8', 'replace')
            elif info is not None and cid == b'opti' and b[do:do + 4] == b'Soli' and size >= 26:
                a, r, gg, bl = struct.unpack('>4f', b[do + 10:do + 26])
                info['solid'] = [r, gg, bl]
                nm = b[do + 26:do + min(size, 26 + 256)].split(b'\x00')[0]
                info['name'] = nm.decode('utf-8', 'replace')

    def item(off, end):
        info, iid = {}, None
        for cid, do, size in chunks(off, end):
            if cid == b'idta' and size >= 20:
                iid = struct.unpack('>I', b[do + 16:do + 20])[0]; break
        scan(off, end, info)
        if iid is not None and info: out[iid] = info

    scan(12, len(b), None)
    return out

class TooOld(Exception):
    """讀不懂的舊版 AE 專案"""

def file_index(dirs):
    # 素材資料夾：連同子資料夾一起找（檔名不分大小寫）
    index = {}
    for d in dirs:
        if not d or not os.path.isdir(d): continue
        for root, sub, files in os.walk(d):
            sub[:] = [x for x in sub if not x.startswith('.')]
            for f in files: index.setdefault(f.lower(), os.path.join(root, f))
    return index

def module_comps(proj, cap=24):
    """適合做成動畫模組的合成：成品主合成（用到最多巢狀合成的那個，拆掉只包一層的輸出尺寸外殼），
    以及它直接用到、和它一樣大、一般混合模式、有實際內容的場景合成（光暈之類的疊加層不算）"""
    byid = {c['id']: c for c in proj['comps']}
    used = {l['comp'] for c in proj['comps'] for l in c['layers'] if l.get('type') == 'precomp'}

    def tree(c, seen=None):
        seen = seen if seen is not None else set()
        for l in c['layers']:
            k = byid.get(l.get('comp')) if l.get('type') == 'precomp' else None
            if k and k['id'] not in seen:
                seen.add(k['id']); tree(k, seen)
        return seen

    def unwrap(c):
        seen = set()
        while len(c['layers']) == 1 and c['layers'][0].get('type') == 'precomp' and c['layers'][0].get('comp') in byid and c['id'] not in seen:
            seen.add(c['id']); c = byid[c['layers'][0]['comp']]
        return c
    mains = []
    for c in proj['comps']:
        if c['id'] in used: continue
        m = unwrap(c)
        if len(m['layers']) >= 2 and m not in mains: mains.append(m)
    if not mains: return []
    size = {m['id']: len(tree(m)) for m in mains}
    mains.sort(key=lambda m: (-size[m['id']], -m['duration']))
    best = mains[0]; inside = tree(best)
    keep = [best] + [m for m in mains[1:] if size[m['id']] >= max(1, size[best['id']] * 0.5) and m['id'] not in inside][:3]
    out = []
    for m in keep:
        out.append(m['id'])
        for l in sorted(m['layers'], key=lambda l: l.get('start', 0)):
            k = byid.get(l.get('comp')) if l.get('type') == 'precomp' else None
            if not k or k['id'] in out: continue
            if k['w'] != m['w'] or k['h'] != m['h'] or k['duration'] < 1 or len(k['layers']) < 2: continue
            if l.get('blend', 'normal') != 'normal' or l.get('matte', 'none') != 'none': continue
            out.append(k['id'])
    return out[:cap]

def convert(aep, out=None, photos=None, maxpx=1600, fx_js=None, progress=None):
    """轉換一個 .aep；回傳報告 {out, name, comps, footage, size, missing, unsupported, skipped, modules}"""
    SKIPPED.clear()
    aep = os.path.abspath(aep)
    out = out or os.path.splitext(aep)[0] + '.xke'
    here = os.path.dirname(os.path.abspath(__file__))
    fx_js = fx_js or next((p for p in (os.path.join(here, '..', 'js', 'fx.js'), os.path.join(here, 'web', 'js', 'fx.js')) if os.path.isfile(p)), None)
    folder = os.path.dirname(aep)
    index = file_index([photos, folder])
    try:
        app = py_aep.parse(aep)
    except Exception as e:
        # 太舊的格式（AE CS4 以前）讀不懂：請使用者先用 AE 另存新檔
        raise TooOld(f'{type(e).__name__}: {e}') from e
    def run(idx):
        cv = Conv(app, photos, maxpx, tool_param_types(fx_js) if fx_js else {})
        cv.index = idx; cv.progress = progress
        try: cv.raw = raw_footage(aep)
        except Exception: cv.raw = {}
        return cv, cv.run()
    cv, proj = run(index)
    if cv.missing and not photos:
        # 素材常放在專案資料夾的上一層：用上一層再找一次
        more = file_index([os.path.dirname(folder)])
        miss = {os.path.basename(m.replace('\\', '/')).lower() for m in cv.missing}
        if any(k in more for k in miss):
            SKIPPED.clear()
            cv, proj = run({**more, **index})
    proj['name'] = os.path.splitext(os.path.basename(aep))[0]
    with open(out, 'w', encoding='utf8') as f:
        json.dump(proj, f, ensure_ascii=False, separators=(',', ':'))
    return {'out': out, 'name': proj['name'], 'comps': len(proj['comps']), 'footage': len(proj['footage']), 'size': os.path.getsize(out),
            'missing': sorted({os.path.basename(m.replace('\\', '/')) for m in cv.missing}), 'unsupported': sorted(set(cv.unsupported)),
            'skipped': dict(SKIPPED), 'modules': module_comps(proj), 'media': dict(cv.media)}

def main():
    ap = argparse.ArgumentParser(description='After Effects .aep → 小柯特效 .xke')
    ap.add_argument('aep'); ap.add_argument('out', nargs='?')
    ap.add_argument('--photos', help='素材資料夾（原始路徑找不到時，用檔名在這裡找）')
    ap.add_argument('--max', type=int, default=1600, help='圖片最長邊（像素），預設 1600')
    a = ap.parse_args()
    r = convert(a.aep, a.out, a.photos, a.max)
    print(f"完成：{r['out']}  合成 {r['comps']} 個、素材 {r['footage']} 個、{r['size'] / 1e6:.1f} MB、可做成模組 {len(r['modules'])} 個")
    if r['missing']: print('找不到的素材：', *r['missing'], sep='\n  ')
    if r['unsupported']: print('還不支援的素材（影片／音訊等）：', *r['unsupported'], sep='\n  ')
    if r['skipped']: print('略過（工具沒有對應）的效果：', ', '.join(f'{k}×{v}' for k, v in r['skipped'].items()))

if __name__ == '__main__':
    main()
