(function (global) {
  'use strict';

  // The document is deliberately plain data: the same schema drives preview,
  // undo, local recovery and portable project files.
  const TEXT_STYLE_DEFAULTS = Object.freeze({
    textOpacity: 1, textStrokeEnabled: false, textStrokeWidth: 2, textStrokeColor: '#111111',
    textGlowEnabled: false, textGlow: 12, textGlowColor: '#d4ff75',
    textShadowEnabled: false, textShadowBlur: 12, textShadowX: 4, textShadowY: 6,
    textShadowColor: '#000000', textShadowOpacity: .6
  });
  const STYLE_NUMBERS = { textOpacity:[0,1], textStrokeWidth:[0,12], textGlow:[0,40], textShadowBlur:[0,40], textShadowX:[-50,50], textShadowY:[-50,50], textShadowOpacity:[0,1] };
  const STYLE_BOOLEANS = ['textStrokeEnabled','textGlowEnabled','textShadowEnabled'];
  const STYLE_COLORS = ['textStrokeColor','textGlowColor','textShadowColor'];
  function colorValue(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const color = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(color)) return '#' + color.slice(1).split('').map(c => c+c).join('').toLowerCase();
    return fallback;
  }
  const DEFAULTS = Object.freeze({
    ...TEXT_STYLE_DEFAULTS,
    mode: 'static', template: 'wrap', title: '未命名作品',
    textLayer: true, text: 'AROUND YOU • AROUND YOU •', subtitle: '', issue: '01',
    font: 'sans', fontWeight: 800, size: 88, letterSpacing: 2, rowGap: 22,
    scaleX: 1, scaleY: 1, textAlign: 'left', textPlacement: 'center',
    imagePathMode: 'off', hudShuffle: false, renderStyle: 'normal',
    asciiLayer: false, asciiLayerOrder: 'below', asciiDensity: 54,
    asciiCharset: 'classic', asciiCoverage: 86, asciiContrast: 115,
    asciiEdge: 18, asciiInvert: false, asciiAnimate: true,
    asciiBlend: 'screen', asciiGlow: true, asciiScanlines: false,
    backgroundMode: 'color', textColor: '#ffffff', background: '#dededb',
    accent: '#c0ff7b', images: Object.freeze([]), imageData: '', imageName: '', imageFit: 'cover',
    imageWash: 0, smallText: false, guides: false,
    wrapTilt: -18, wrapRoll: -14, wrapPhase: 0, wrapX: .5, wrapY: .48, wrapRadius: .40, wrapDepth: .22, wrapPerspective: 1.5, subjectMask: '',
    ringGroups: Object.freeze([]), helixGroups: Object.freeze([]), depthFade: .58, wrapTurns: 3, wrapHeight: .7,
    customPath: Object.freeze([]), pathClosed: false, pathRepeat: true, pathDirection: 'forward', pathPhase: 0, pathSpacing: 2,
    contourGap: .018, contourSpacing: .045, contourCount: 1, spiralTurns: 3,
    speed: 48, density: 64, spread: 58, seed: 7,
    width: 900, height: 1200, frame: 0, duration: 5
  });

  const TEMPLATES = Object.freeze([
    { id: 'wrap', name: '三维环绕', mode: 'motion', description: '文字围绕主体，近大远小，前后遮挡。' },
    { id: 'contour', name: '沿主体轮廓', mode: 'motion', description: '文字沿所选主体的真实外轮廓排列。' },
    { id: 'spiral', name: '平面螺旋', mode: 'motion', description: '文字从中心向外连续盘旋。' },
    { id: 'helix', name: '立体螺旋', mode: 'motion', description: '文字沿主体上下盘旋，随透视呈现明暗与遮挡。' },
    { id: 'customPath', name: '手绘路径', mode: 'motion', description: '在画布画一条线，让文字沿着它流动。' },
    { id: 'hud', name: '文字网络', mode: 'motion', description: 'Connected words in a living network.' },
    { id: 'wave', name: '波浪文字', mode: 'motion', description: 'Type follows a continuous sine wave.' },
    { id: 'rain', name: '字符雨', mode: 'motion', description: 'Columns of falling characters.' },
    { id: 'orbit', name: '圆形环绕', mode: 'motion', description: 'Words move around a circular axis.' },
    { id: 'drift', name: '浮动网格', mode: 'motion', description: 'A measured grid with a soft offset.' },
    { id: 'coil', name: '字符旋涡', mode: 'motion', description: 'Characters unfold along a spiral.' },
    { id: 'flag', name: '波动旗帜', mode: 'motion', description: 'A rhythmic, rippling banner.' },
    { id: 'crash', name: '撞击时钟', mode: 'motion', description: 'A rotating ring with pulsing impact.' }
  ].map(function (template) { return Object.freeze(Object.assign({ label: template.name }, template)); }));

  const PRESETS = Object.freeze([
    { id: 'around-you', name: '围绕你', mode: 'static', template: 'wrap', description: '三维环绕文字。', patch: { text: 'AROUND YOU • AROUND YOU •', textColor: '#ffffff', size: 88 } },
    { id: 'connected', name: 'Connected Type', mode: 'motion', template: 'hud', description: 'Words become a moving system.', patch: { text: 'EVERYTHING IS CONNECTED', subtitle: 'An open network of ideas.', font: 'mono', size: 42, letterSpacing: 2, density: 64, background: '#020704', textColor: '#8aff9e', accent: '#39ff6f', guides: true } },
    { id: 'gentle-wave', name: 'In Motion', mode: 'motion', template: 'wave', description: 'An unbroken rhythm of type.', patch: { text: 'ALWAYS IN MOTION', subtitle: 'Keep moving. Keep making.', font: 'sans', size: 74, letterSpacing: -1, rowGap: 40, speed: 36, spread: 40, background: '#06110a', textColor: '#a4f5ab', accent: '#39ff6f' } },
    { id: 'orbital', name: 'Orbital Study', mode: 'motion', template: 'orbit', description: 'A message in constant rotation.', patch: { text: 'IDEAS IN ORBIT', subtitle: 'A continuous exchange.', font: 'mono', size: 54, letterSpacing: 5, speed: 28, background: '#b6ffb0', textColor: '#06120a', accent: '#173e25' } },
    { id: 'data-rain', name: 'Data Rain', mode: 'motion', template: 'rain', description: 'A living character field.', patch: { text: 'CREATE THE FUTURE', subtitle: 'The next frame is yours.', font: 'mono', size: 38, letterSpacing: 2, density: 70, speed: 44, background: '#020704', textColor: '#39ff6f', accent: '#caffb8' } }
  ].map(function (preset) { Object.freeze(preset.patch); return Object.freeze(preset); }));

  const ENUMS = {
    mode: ['static', 'motion'], template: TEMPLATES.map(function (item) { return item.id; }), pathDirection: ['forward','reverse'],
    font: ['sans', 'serif', 'mono', 'thinSans', 'lightSerif', 'condensedThin', 'hairlineMono'],
    textAlign: ['left', 'center', 'right'], textPlacement: ['center', 'top', 'bottom', 'imageScatter'],
    imagePathMode: ['off', 'structure', 'edge'], renderStyle: ['normal', 'outline', 'mosaic'],
    asciiLayerOrder: ['below', 'above'], asciiCharset: ['classic', 'random', 'binary', 'blocks'],
    asciiBlend: ['source-over', 'screen', 'lighter', 'overlay'],
    backgroundMode: ['color', 'image', 'none'], imageFit: ['cover', 'contain', 'stretch']
  };
  const NUMBERS = {
    ...STYLE_NUMBERS,
    fontWeight: [100, 950, true], size: [18, 200], letterSpacing: [-8, 30], rowGap: [8, 100],
    scaleX: [0.5, 2], scaleY: [0.5, 2], asciiDensity: [18, 96, true],
    asciiCoverage: [10, 100], asciiContrast: [40, 220], asciiEdge: [0, 100],
    imageWash: [0, 100], speed: [0, 100], density: [0, 100], spread: [0, 100],
    seed: [0, 2147483647, true], width: [320, 4096, true], height: [320, 4096, true],
    frame: [0, 20], duration: [1, 20],
    wrapTilt: [-70, 70], wrapRoll: [-90, 90], wrapPhase: [0, 360], wrapX: [0, 1], wrapY: [0, 1],
    wrapRadius: [.08, .62], wrapDepth: [.035, .5], wrapPerspective: [.6, 8],
    depthFade: [0, 1], wrapTurns: [1, 6], wrapHeight: [.1, 1.2],
    contourGap: [0, .15], contourSpacing: [.01, .15], contourCount: [1, 5, true], spiralTurns: [1, 8], pathPhase:[0,100], pathSpacing:[0,40]
  };
  const TEXT_LIMITS = { text: 500, subtitle: 180, issue: 16, title: 80, imageName: 255 };
  const BOOLEANS = [...STYLE_BOOLEANS, 'pathClosed', 'pathRepeat', 'textLayer', 'hudShuffle', 'asciiLayer', 'asciiInvert', 'asciiAnimate', 'asciiGlow', 'asciiScanlines', 'smallText', 'guides'];
  const MAX_IMAGES = 9;
  const IMAGE_DATA_LIMIT = 16 * 1024 * 1024;
  const IMAGES_DATA_LIMIT = 48 * 1024 * 1024;
  const SUBJECT_MASK_LIMIT = 4 * 1024 * 1024;
  const own = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
  const validatedImages = [];

  function isImageData(value) {
    if (typeof value !== 'string' || value.length > IMAGE_DATA_LIMIT) return false;
    if (value === '') return true;
    if (validatedImages.indexOf(value) !== -1) return true;
    // External URLs and SVG are intentionally excluded. Project files cannot
    // fetch remote resources or embed active documents.
    const valid = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
    if (valid) {
      validatedImages.push(value);
      if (validatedImages.length > 32) validatedImages.shift();
    }
    return valid;
  }

  function cleanText(value, maximum) {
    return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, maximum);
  }

  function normalizeImages(source) {
    // An explicit collection is authoritative, especially [] after removal.
    // Legacy aliases are only read when the collection is absent.
    const candidates = own(source, 'images') ? (Array.isArray(source.images) ? source.images : []) :
      (own(source, 'imageData') && source.imageData ? [{ dataURL: source.imageData, name: own(source, 'imageName') ? source.imageName : '' }] : []);
    const images = [];
    let total = 0;
    for (const item of candidates.slice(0, MAX_IMAGES)) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !own(item, 'dataURL') || !item.dataURL || !isImageData(item.dataURL)) continue;
      if (total + item.dataURL.length > IMAGES_DATA_LIMIT) break;
      images.push({ dataURL: item.dataURL, name: own(item, 'name') && typeof item.name === 'string' ? cleanText(item.name, 255) : '' });
      total += item.dataURL.length;
    }
    return images;
  }

  function nextGroupId(groups) {
    return 'g' + ((Array.isArray(groups) ? groups : []).reduce((max, g) => /^g[1-9]\d{0,5}$/.test(g && g.id) ? Math.max(max, Number(g.id.slice(1))) : max, 0) + 1);
  }

  function makeGroup(document, index = 0, patch = {}) {
    const base = Object.assign({}, DEFAULTS, document || {}), g = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    const number = (key, fallback, min, max) => { const n = (typeof g[key] === 'number' || typeof g[key] === 'string' && g[key].trim()) ? Number(g[key]) : NaN; return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; };
    const id = typeof g.id === 'string' && /^g[1-9]\d{0,5}$/.test(g.id) ? g.id : 'g' + (Math.max(0, Math.floor(index)) + 1);
    const radiusScale = number('radiusScale', 1, .35, 1.8);
    const style = {};
    Object.entries(STYLE_NUMBERS).forEach(([key,bounds]) => { style[key] = number(key, base[key], bounds[0], bounds[1]); });
    STYLE_BOOLEANS.forEach(key => { style[key] = typeof g[key] === 'boolean' ? g[key] : base[key]; });
    STYLE_COLORS.forEach(key => { style[key] = colorValue(g[key], base[key]); });
    return {
      ...style,
      id, name: typeof g.name === 'string' && g.name.trim() ? cleanText(g.name.trim(), 48) : '文字组 ' + id.slice(1),
      text: typeof g.text === 'string' ? cleanText(g.text, 500) : base.text,
      color: typeof g.color === 'string' && /^#[0-9a-f]{6}$/i.test(g.color) ? g.color.toLowerCase() : base.textColor,
      offsetX: number('offsetX', 0, -.45, .45), offsetY: number('offsetY', 0, -.45, .45),
      radiusScale, depthScale: number('depthScale', radiusScale, .1, 2), phase: number('phase', 0, 0, 360),
      roll: number('roll', base.wrapRoll, -90, 90), tilt: number('tilt', base.wrapTilt, -70, 70),
      size: number('size', base.size, 18, 200), font: ENUMS.font.includes(g.font) ? g.font : base.font,
      fontWeight: Math.round(number('fontWeight', base.fontWeight, 100, 950)),
      depthFade: number('depthFade', base.depthFade, 0, 1), turns: number('turns', base.wrapTurns, 1, 6), height: number('height', base.wrapHeight, .1, 1.2)
    };
  }

  function copyDocument(document) {
    return Object.assign({}, document, { images: document.images.map(function (item) { return { dataURL: item.dataURL, name: item.name }; }), ringGroups: document.ringGroups.map(group => ({...group})), helixGroups: document.helixGroups.map(group => ({...group})), customPath: document.customPath.map(point => ({...point})) });
  }

  function sameDocument(left, right) {
    return Object.keys(DEFAULTS).every(function (key) {
      if (['ringGroups','helixGroups','customPath'].includes(key)) return JSON.stringify(left[key]) === JSON.stringify(right[key]);
      if (key !== 'images') return left[key] === right[key];
      return left.images.length === right.images.length && left.images.every(function (image, index) {
        return image.dataURL === right.images[index].dataURL && image.name === right.images[index].name;
      });
    });
  }

  function normalize(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const output = Object.assign({}, DEFAULTS);
    Object.keys(ENUMS).forEach(function (key) {
      if (own(source, key) && ENUMS[key].indexOf(source[key]) !== -1) output[key] = source[key];
    });
    Object.keys(NUMBERS).forEach(function (key) {
      if (!own(source, key)) return;
      const value = source[key];
      if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || (typeof value === 'string' && !value.trim())) return;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      const bounds = NUMBERS[key];
      const limited = Math.max(bounds[0], Math.min(bounds[1], numeric));
      output[key] = bounds[2] ? Math.round(limited) : limited;
    });
    Object.keys(TEXT_LIMITS).forEach(function (key) {
      if (own(source, key) && typeof source[key] === 'string') {
        output[key] = cleanText(source[key], TEXT_LIMITS[key]);
      }
    });
    BOOLEANS.forEach(function (key) { if (own(source, key) && typeof source[key] === 'boolean') output[key] = source[key]; });
    ['textColor', 'background', 'accent', ...STYLE_COLORS].forEach(key => { output[key] = colorValue(source[key], output[key]); });
    const normalizeGroups = (values,base) => {
    const usedIds = new Set();
    return Array.isArray(values) ? values.slice(0, 6).filter(g => g && typeof g === 'object' && !Array.isArray(g)).map(function (g, index) {
      const group = makeGroup(base, index, g);
      if (usedIds.has(group.id)) {
        const oldDefault = '文字组 ' + group.id.slice(1);
        let serial = index + 1; while (usedIds.has('g' + serial)) serial++;
        group.id = 'g' + serial;
        if (!g.name || g.name === oldDefault) group.name = '文字组 ' + serial;
      }
      usedIds.add(group.id); return group;
    }) : [];
    };
    output.ringGroups = normalizeGroups(source.ringGroups,output);
    // Old releases used one group collection for both effects. Migrate a copy,
    // never an alias. A v10 document explicitly carries both collections.
    const legacyHelix = !own(source,'helixGroups');
    const helixValues = legacyHelix ? (output.ringGroups.length ? output.ringGroups : source.template==='helix' ? [makeGroup(output,0)] : []) : source.helixGroups;
    output.helixGroups = normalizeGroups(helixValues,legacyHelix ? output : helixDefaults(output));
    output.customPath = normalizePath(source.customPath);
    output.images = normalizeImages(source);
    if (output.images.length && own(source, 'subjectMask') && typeof source.subjectMask === 'string' && source.subjectMask.length <= SUBJECT_MASK_LIMIT && isImageData(source.subjectMask)) output.subjectMask = source.subjectMask;
    output.imageData = output.images.length ? output.images[0].dataURL : '';
    output.imageName = output.images.length ? output.images[0].name : '';
    // Old text-style ASCII becomes the independent image layer when possible.
    if (own(source, 'renderStyle') && source.renderStyle === 'ascii' && output.imageData) output.asciiLayer = true;
    // v3's photo-only template becomes the common image foundation with type
    // hidden. Preserve its appearance and the copy it kept behind that template.
    if (own(source, 'template') && source.template === 'collage') {
      output.template = 'wrap';
      output.mode = 'static';
      output.textLayer = false;
      output.imageWash = 0;
      output.asciiLayer = false;
      output.imagePathMode = 'off';
      // v3 drew collage photos even when its background setting was 'none'.
      output.backgroundMode = 'image';
    }
    // Removed static layouts migrate to the editable wrap workflow, preserving text/photos.
    if (own(source, 'template') && ['editorial', 'swiss', 'typegrid', 'specimen'].includes(source.template)) { output.template = 'wrap'; output.mode = 'static'; }
    if (source.template === 'tunnel') output.template = 'wave';
    if (source.template === 'danger') output.template = 'crash';
    // v1 had no mode field; keep its motion templates alive on import.
    const template = TEMPLATES.find(function (item) { return item.id === output.template; });
    if (template.mode === 'static') output.mode = 'static';
    else if (!own(source, 'mode') && output.template !== 'wrap') output.mode = 'motion';
    output.frame = Math.min(output.duration, output.frame);
    return output;
  }

  function createHistory(initial, maximum) {
    const limit = Number.isFinite(maximum) ? Math.max(2, Math.min(200, Math.floor(maximum))) : 60;
    let entries = [normalize(initial)];
    let cursor = 0;
    const current = function () { return copyDocument(entries[cursor]); };
    return {
      current: current,
      commit: function (next) {
        const value = normalize(next);
        if (sameDocument(value, entries[cursor])) return current();
        entries = entries.slice(0, cursor + 1);
        entries.push(value);
        if (entries.length > limit) entries.shift();
        cursor = entries.length - 1;
        return current();
      },
      undo: function () { cursor = Math.max(0, cursor - 1); return current(); },
      redo: function () { cursor = Math.min(entries.length - 1, cursor + 1); return current(); },
      canUndo: function () { return cursor > 0; },
      canRedo: function () { return cursor < entries.length - 1; },
      reset: function (next) { entries = [normalize(next)]; cursor = 0; return current(); }
    };
  }

  function helixDefaults(document) { return {...document,wrapRoll:0,wrapTilt:10,size:64,wrapTurns:3,wrapHeight:.7}; }
  function groupKey(document) { return document.template === 'helix' ? 'helixGroups' : 'ringGroups'; }
  function groupsFor(document) {
    const groups = document[groupKey(document)];
    return groups && groups.length ? groups.map(group=>({...group})) : [makeGroup(document.template==='helix' ? helixDefaults(document) : document,0)];
  }
  function normalizePath(values) {
    if (!Array.isArray(values) || values.length < 2) return [];
    const points=[],count=Math.min(values.length,4096);
    for(let i=0;i<count;i++) {
      const point=values[Math.floor(i*(values.length-1)/(count-1))];
      if(!point || typeof point!=='object' || Array.isArray(point)) continue;
      if(!['x','y'].every(key=>typeof point[key]==='number' && Number.isFinite(point[key])))continue;
      const next={x:Math.max(0,Math.min(1,point.x)),y:Math.max(0,Math.min(1,point.y))},last=points[points.length-1];
      if(!last || Math.hypot(next.x-last.x,next.y-last.y)>1e-6)points.push(next);
    }
    if(points.length<2)return [];
    return points.length<=256 ? points : Array.from({length:256},(_,i)=>({...points[Math.floor(i*(points.length-1)/255)]}));
  }
  global.KineticModel = Object.freeze({ TEXT_STYLE_KEYS: Object.freeze(Object.keys(TEXT_STYLE_DEFAULTS)), DEFAULTS: DEFAULTS, TEMPLATES: TEMPLATES, PRESETS: PRESETS, normalize: normalize, normalizePath, groupKey, groupsFor, makeGroup: makeGroup, nextGroupId: nextGroupId, createHistory: createHistory, isImageData: isImageData, MAX_IMAGES: MAX_IMAGES, IMAGE_DATA_LIMIT: IMAGE_DATA_LIMIT, IMAGES_DATA_LIMIT: IMAGES_DATA_LIMIT, SUBJECT_MASK_LIMIT: SUBJECT_MASK_LIMIT });
})(typeof window === 'undefined' ? globalThis : window);
