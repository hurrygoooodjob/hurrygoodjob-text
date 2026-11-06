/* Kinetic Type Studio — deterministic, instance-local Canvas 2D renderer. */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const FONTS = Object.freeze({
    thinSans: '"Avenir Next", "Helvetica Neue", Arial, sans-serif',
    lightSerif: 'Didot, "Bodoni 72", Georgia, "Times New Roman", serif',
    condensedThin: '"Arial Narrow", "Helvetica Neue Condensed", "Helvetica Neue", Arial, sans-serif',
    hairlineMono: '"IBM Plex Mono", Consolas, "Courier New", monospace',
    sans: '"Helvetica Neue", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: '"IBM Plex Mono", Consolas, "Courier New", monospace'
  });
  const RAMPS = Object.freeze({
    classic: ' .:-=+*#%@', detailed: ' .,:;i1tfLCG08@', minimal: ' .:+#@',
    blocks: ' ░▒▓█', random: '01XO#@$%+=-*/<>[]{}', binary: '001101011110'
  });
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
  const graphemes = (text) => segmenter
    ? Array.from(segmenter.segment(String(text)), (entry) => entry.segment)
    : Array.from(String(text));

  // Every image receives exactly 1/count of the canvas. A row containing k
  // images is k/count of the canvas height, so prime counts need no blank cell.
  // Compare both orientations and favor compact cells instead of thin strips.
  function collageRects(count, width, height) {
    const n = clamp(Math.floor(finite(count, 0)), 0, 9);
    const w = Math.max(0, finite(width, 0)), h = Math.max(0, finite(height, 0));
    if (!n || !w || !h) return [];
    let best = null, bestScore = Infinity;
    for (const transpose of [false, true]) {
      const cw = transpose ? h : w, ch = transpose ? w : h;
      for (let rows = 1; rows <= n; rows += 1) {
        const columns = Math.floor(n / rows), extra = n % rows;
        const cells = [];
        let offset = 0;
        for (let row = 0; row < rows; row += 1) {
          const k = columns + (row < extra ? 1 : 0);
          const top = ch * offset / n, bottom = ch * (offset + k) / n;
          for (let col = 0; col < k; col += 1) {
            const left = cw * col / k, right = cw * (col + 1) / k;
            cells.push(transpose
              ? { x: top, y: left, w: bottom - top, h: right - left }
              : { x: left, y: top, w: right - left, h: bottom - top });
          }
          offset += k;
        }
        const distortions = cells.map((cell) => Math.log(cell.w / cell.h) ** 2);
        const score = distortions.reduce((sum, value) => sum + value, 0) / n + Math.max(...distortions) * 0.25;
        if (score < bestScore - 1e-10) { bestScore = score; best = cells; }
      }
    }
    return best.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  // Public photo composition uses the same cell layout, image fitting and pixel snapping as the renderer.
  // transparent:true leaves source transparency intact for genuine alpha-mask extraction.
  function composePhotos(canvas, input, source, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('A canvas is required.');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    const state = input || {}, W = clamp(finite(state.width, 900), 64, 12000), H = clamp(finite(state.height, 1200), 64, 12000);
    const images = Array.isArray(source) ? source.filter(Boolean).slice(0, 9) : source ? [source] : [];
    const cells = collageRects(images.length, W, H), pixelX = canvas.width / W, pixelY = canvas.height / H;
    ctx.save();
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.scale(pixelX, pixelY); ctx.imageSmoothingEnabled = true;
      if (!options.transparent) { ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(state.background || '') ? state.background : '#dededb'; ctx.fillRect(0, 0, W, H); }
      cells.forEach((cell, index) => {
        const image = images[index], iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
        if (!iw || !ih) return;
        const x = Math.round(cell.x * pixelX) / pixelX, y = Math.round(cell.y * pixelY) / pixelY;
        const right = Math.round((cell.x + cell.w) * pixelX) / pixelX, bottom = Math.round((cell.y + cell.h) * pixelY) / pixelY;
        const w = right-x, h = bottom-y, fit = state.imageFit || 'cover';
        const factor = fit === 'contain' ? Math.min(w/iw,h/ih) : Math.max(w/iw,h/ih);
        const dw = fit === 'stretch' ? w : iw*factor, dh = fit === 'stretch' ? h : ih*factor;
        ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip();
        ctx.drawImage(image,x+(w-dw)/2,y+(h-dh)/2,dw,dh); ctx.restore();
      });
    } finally { ctx.restore(); }
    return { cells, images: images.length };
  }

  const STYLE_KEYS = ['textOpacity','textStrokeEnabled','textStrokeWidth','textStrokeColor','textGlowEnabled','textGlow','textGlowColor','textShadowEnabled','textShadowBlur','textShadowX','textShadowY','textShadowColor','textShadowOpacity'];
  const styleValues = source => Object.fromEntries(STYLE_KEYS.filter(key => source && source[key] != null).map(key => [key,source[key]]));

  function create(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('A canvas is required.');
    let ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
    let state, W = 900, H = 1200, U = 1, image = null, images = [];
    let disposed = false;
    const metrics = new Map();
    const mosaics = new Map();
    const samples = new Map();
    const imageIds = new WeakMap();
    let nextImageId = 1;
    let compositeCanvas = null, compositeKey = '', sourceCells = [];
    let ringCanvas = null, textCanvas = null;
    const styledGlyphs = new Map();
    let styledGlyphPixels = 0;
    let structure = null;
    let structureKey = '';
    let asciiCanvas = null;
    let asciiKey = '';
    const stats = { frames: 0, imageReadbacks: 0, compositeBuilds: 0, compositeImages: 0, asciiBuilds: 0, glyphBuilds: 0, imageAnalysis: 'none' };

    function surface(width, height) {
      let result;
      if (typeof OffscreenCanvas !== 'undefined') result = new OffscreenCanvas(width, height);
      else result = canvas.ownerDocument.createElement('canvas');
      result.width = Math.max(1, Math.ceil(width));
      result.height = Math.max(1, Math.ceil(height));
      return result;
    }

    function remember(cache, key, value, limit) {
      if (cache.size >= limit) cache.delete(cache.keys().next().value);
      cache.set(key, value);
      return value;
    }

    function random(index) {
      const x = Math.sin((index + 1) * 999 + state.seed * 33) * 10000;
      return x - Math.floor(x);
    }

    function font(size, family = state.font, weight = state.fontWeight) {
      return `${clamp(finite(weight, 700), 100, 950)} ${Math.max(1, size)}px ${FONTS[family] || FONTS.mono}`;
    }

    function measure(text, size, options = {}) {
      const family = options.family || state.font;
      const weight = options.weight == null ? state.fontWeight : options.weight;
      const spacing = options.spacing == null ? state.letterSpacing * U : options.spacing;
      const key = `${text}\u0000${font(size, family, weight)}\u0000${spacing}`;
      if (metrics.has(key)) return metrics.get(key);
      ctx.font = font(size, family, weight);
      const chars = graphemes(text);
      const widths = chars.map((char) => ctx.measureText(char).width);
      const width = Math.max(0, widths.reduce((sum, n) => sum + n, 0) + Math.max(0, chars.length - 1) * spacing);
      return remember(metrics, key, { chars, widths, width, spacing }, 1400);
    }

    function mosaicGlyph(char, size, family, weight, color) {
      const key = `${char}\u0000${size.toFixed(3)}\u0000${family}\u0000${weight}\u0000${color}`;
      if (mosaics.has(key)) return mosaics.get(key);
      const block = Math.max(U * 1.5, size / 19);
      const pad = size * 0.22;
      ctx.font = font(size, family, weight);
      const glyphWidth = ctx.measureText(char).width;
      const width = Math.ceil((glyphWidth + pad * 2) / block);
      const height = Math.ceil(size * 1.7 / block);
      const tile = surface(width, height);
      const tc = tile.getContext('2d');
      tc.font = font(size / block, family, weight);
      tc.textBaseline = 'middle';
      tc.fillStyle = color;
      tc.fillText(char, pad / block, height / 2);
      stats.glyphBuilds += 1;
      return remember(mosaics, key, { tile, width: width * block, height: height * block, pad }, 700);
    }

    function styledGlyph(char, size, family, weight, color) {
      const P=global.KineticProjection,s=P.textStyle(state,U),f=font(size,family,weight),key=JSON.stringify([char,f,color,...Object.keys(s).filter(k=>k!=='textOpacity').map(k=>s[k])]);
      if(styledGlyphs.has(key))return styledGlyphs.get(key);
      ctx.font=f;const width=ctx.measureText(char).width,pad=Math.max(Math.ceil(size*.22),P.stylePadding(s));
      const tile=surface(width+pad*2,size*1.7+pad*2),c=tile.getContext('2d');
      c.font=f;c.textAlign='left';c.textBaseline='middle';c.fillStyle=color;
      P.paintStyledText(c,char,pad,tile.height/2,s);
      const pixels=tile.width*tile.height,result={tile,pad,width:tile.width,height:tile.height};
      while(styledGlyphs.size&&(styledGlyphs.size>=512||styledGlyphPixels+pixels>4*1024*1024)){const oldest=styledGlyphs.keys().next().value,old=styledGlyphs.get(oldest);styledGlyphPixels-=old.width*old.height;styledGlyphs.delete(oldest);}
      if(pixels<=4*1024*1024){styledGlyphs.set(key,result);styledGlyphPixels+=pixels;}stats.glyphBuilds++;return result;
    }

    function text(value, x, y, options = {}) {
      const source = String(value == null ? '' : value).replace(/\n/g, ' ');
      if (!source) return;
      const size = Math.max(1, options.size == null ? state.size * U : options.size);
      const color = options.color || state.textColor;
      const family = options.family || state.font;
      const weight = options.weight == null ? state.fontWeight : options.weight;
      const sx = options.scaleX == null ? state.scaleX : options.scaleX;
      const sy = options.scaleY == null ? state.scaleY : options.scaleY;
      const align = options.align || 'center';
      const data = measure(source, size, { family, weight, spacing: options.spacing });
      const xScale = options.maxWidth && data.width * sx > options.maxWidth
        ? options.maxWidth / Math.max(data.width, 1) : sx;
      let cursor = align === 'left' ? 0 : align === 'right' ? -data.width : -data.width / 2;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(options.rotate || 0);
      ctx.scale(xScale, sy);
      ctx.font = font(size, family, weight);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha *= options.alpha == null ? 1 : clamp(options.alpha, 0, 1);
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(U * 0.7, size * 0.014);
      ctx.lineJoin = 'round';
      const style = options.style || state.renderStyle;
      data.chars.forEach((char, i) => {
        if (style === 'mosaic' && char.trim()) {
          const glyph = mosaicGlyph(char, size, family, weight, color);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(glyph.tile, cursor - glyph.pad, -glyph.height / 2, glyph.width, glyph.height);
        } else if ((state.textStrokeEnabled || state.textGlowEnabled || state.textShadowEnabled) && global.KineticProjection) {
          const glyph=styledGlyph(char,size,family,weight,color);ctx.drawImage(glyph.tile,cursor-glyph.pad,-glyph.height/2);
        } else if (style === 'outline' || options.stroke) ctx.strokeText(char, cursor, 0);
        else ctx.fillText(char, cursor, 0);
        cursor += data.widths[i] + data.spacing;
      });
      ctx.restore();
    }

    // A word is kept intact where possible; an oversized word falls back to graphemes.
    function wrappedLines(value, size, maxWidth, options = {}) {
      const lines = [];
      const sx = options.scaleX == null ? state.scaleX : options.scaleX;
      for (const paragraph of String(value).split('\n')) {
        if (!paragraph.trim()) { lines.push(''); continue; }
        const words = paragraph.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\S\n]+|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) || [paragraph];
        let line = '';
        for (const word of words) {
          const candidate = line + word;
          if (measure(candidate, size, options).width * sx <= maxWidth) { line = candidate; continue; }
          if (line.trim()) { lines.push(line.trimEnd()); line = ''; }
          const token = word.trimStart();
          if (measure(token, size, options).width * sx <= maxWidth) { line = token; continue; }
          for (const char of graphemes(token)) {
            if (line && measure(line + char, size, options).width * sx > maxWidth) {
              lines.push(line); line = '';
            }
            line += char;
          }
        }
        if (line.trim()) lines.push(line.trimEnd());
      }
      return lines.length ? lines : [''];
    }

    function fitBlock(value, box, options = {}) {
      let size = options.size || state.size * U;
      const min = options.minSize || 8 * U;
      const leading = options.leading || 1.08;
      const sy = options.scaleY == null ? state.scaleY : options.scaleY;
      const sx = options.scaleX == null ? state.scaleX : options.scaleX;
      const gap = options.useRowGap ? (finite(state.rowGap, 22) - 22) * U * 0.7 : 0;
      const heightAt = (fontSize) => Math.max(fontSize * sy * 0.72, fontSize * leading * sy + gap);
      // Ordinary words should shrink into their column before grapheme wrapping.
      // Very long unbroken tokens can still wrap, rather than making all copy microscopic.
      const words = String(value).match(/[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) || [];
      const intactWords = words.filter((word) => graphemes(word).length <= 32);
      for (let attempt = 0; attempt < 80 && size > min; attempt += 1) {
        const widest = intactWords.reduce((width, word) => Math.max(width, measure(word, size, options).width * sx), 0);
        if (widest <= box.w) break;
        size = Math.max(min, size * 0.94);
      }
      let lines;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        lines = wrappedLines(value, size, box.w, options);
        if (lines.length * heightAt(size) <= box.h || size <= min) break;
        size = Math.max(min, size * 0.94);
      }
      const lineHeight = heightAt(size);
      const totalHeight = lines.length * lineHeight;
      const align = options.align || state.textAlign;
      const x = align === 'left' ? box.x : align === 'right' ? box.x + box.w : box.x + box.w / 2;
      const top = options.valign === 'bottom' ? box.y + box.h - totalHeight
        : options.valign === 'center' ? box.y + (box.h - totalHeight) / 2 : box.y;
      lines.forEach((line, i) => text(line, x, top + lineHeight * (i + 0.5), {
        ...options, align, size, maxWidth: box.w
      }));
      return { size, lines, height: totalHeight };
    }

    function line(x1, y1, x2, y2, color = state.accent, alpha = 1, width = U) {
      ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha *= alpha; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
    }

    function rect(x, y, w, h, color = state.accent, alpha = 1, filled = false, width = U) {
      ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = width;
      if (filled) ctx.fillRect(x, y, w, h); else ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }

    function imageRect(img, width = W, height = H) {
      const iw = img.naturalWidth || img.videoWidth || img.width;
      const ih = img.naturalHeight || img.videoHeight || img.height;
      if (!iw || !ih) return null;
      if (state.imageFit === 'stretch') return { x: 0, y: 0, w: width, h: height };
      const factor = state.imageFit === 'contain' ? Math.min(width / iw, height / ih) : Math.max(width / iw, height / ih);
      return { x: (width - iw * factor) / 2, y: (height - ih * factor) / 2, w: iw * factor, h: ih * factor };
    }

    // Build the photo layer once, before paper, wash, ASCII, or typography.
    // Every consumer uses these canvas coordinates: a fitted photo must never
    // be fitted a second time when deriving its ASCII or structure samples.
    function prepareImages() {
      const identities = images.map((photo) => {
        if (!imageIds.has(photo)) imageIds.set(photo, nextImageId++);
        return `${imageIds.get(photo)}@${photo.naturalWidth || photo.width}x${photo.naturalHeight || photo.height}`;
      });
      const key = [W, H, canvas.width, canvas.height, state.imageFit, ...identities].join(':');
      if (key === compositeKey) return;
      compositeKey = key;
      samples.clear(); structure = null; structureKey = ''; asciiKey = '';
      stats.compositeImages = images.length;
      stats.imageAnalysis = images.length ? 'pending' : 'none';
      sourceCells = collageRects(images.length, W, H);
      if (!images.length) { image = null; compositeCanvas = null; return; }
      if (!compositeCanvas || compositeCanvas.width !== canvas.width || compositeCanvas.height !== canvas.height) {
        compositeCanvas = surface(canvas.width, canvas.height);
      }
      composePhotos(compositeCanvas, state, images, { transparent: true });
      image = compositeCanvas;
      stats.compositeBuilds += 1;
    }

    function imageSample(cols, rows) {
      if (!image) return null;
      const iw = image.naturalWidth || image.width;
      const ih = image.naturalHeight || image.height;
      const key = `${cols}:${rows}:${W}:${H}:${state.imageFit}:${iw}:${ih}`;
      if (samples.has(key)) return samples.get(key);
      const sample = surface(cols, rows);
      const sc = sample.getContext('2d', { willReadFrequently: true });
      sc.drawImage(image, 0, 0, cols, rows);
      const rgba = sc.getImageData(0, 0, cols, rows).data;
      stats.imageReadbacks += 1;
      const lum = new Float32Array(cols * rows);
      const alpha = new Float32Array(cols * rows);
      const edge = new Float32Array(cols * rows);
      for (let i = 0; i < lum.length; i += 1) {
        lum[i] = (rgba[i * 4] * 0.2126 + rgba[i * 4 + 1] * 0.7152 + rgba[i * 4 + 2] * 0.0722) / 255;
        alpha[i] = rgba[i * 4 + 3] / 255;
      }
      for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
        const i = y * cols + x;
        const left = x > 0 && alpha[i - 1] ? lum[i - 1] : lum[i];
        const up = y > 0 && alpha[i - cols] ? lum[i - cols] : lum[i];
        edge[i] = Math.min(1, (Math.abs(lum[i] - left) + Math.abs(lum[i] - up)) * 2.5);
      }
      return remember(samples, key, { cols, rows, lum, alpha, edge }, 5);
    }

    function background() {
      if (state.backgroundMode === 'none') return;
      ctx.fillStyle = state.background; ctx.fillRect(0, 0, W, H);
      if (state.backgroundMode === 'image' && image) {
        ctx.drawImage(image, 0, 0, W, H);
        rect(0, 0, W, H, state.background, state.imageWash / 100, true);
      }
    }

    function analyzeImage() {
      if (!image || (state.imagePathMode === 'off' && state.textPlacement !== 'imageScatter')) return;
      const key = `${W}:${H}:${state.imageFit}`;
      if (structure && key === structureKey) return;
      const cols = 72, rows = clamp(Math.round(cols * H / W), 24, 160);
      const sample = imageSample(cols, rows);
      if (!sample) return;
      const all = [], path = [], cellPoints = sourceCells.map(() => []), cellPaths = sourceCells.map(() => []);
      let centerX = 0, centerY = 0, total = 0;
      for (let y = 1; y < rows - 1; y += 1) {
        const best = sourceCells.map(() => null);
        for (let x = 1; x < cols - 1; x += 1) {
          const i = y * cols + x;
          if (sample.alpha[i] < 0.12) continue;
          const weight = sample.edge[i] * 1.6 + Math.abs(sample.lum[i] - 0.5) * 0.45 + (1 - sample.lum[i]) * 0.12;
          if (weight < 0.08) continue;
          const point = { x: (x + 0.5) / cols * W, y: (y + 0.5) / rows * H, weight };
          const cellIndex = sourceCells.findIndex((cell) => point.x >= cell.x && point.x < cell.x + cell.w && point.y >= cell.y && point.y < cell.y + cell.h);
          all.push(point);
          if (cellIndex >= 0) {
            cellPoints[cellIndex].push(point);
            if (!best[cellIndex] || best[cellIndex].weight < weight) best[cellIndex] = point;
          }
          centerX += point.x * weight; centerY += point.y * weight; total += weight;
        }
        if (y % 2 === 0) best.forEach((point, index) => {
          if (point) { path.push(point); cellPaths[index].push(point); }
        });
      }
      // Give every photo a share of the structure budget. Otherwise one photo
      // with strong contrast could discard all points from its quieter peers.
      const perCell = Math.max(1, Math.floor(600 / Math.max(1, cellPoints.length)));
      const edgeCells = cellPoints.map((points) => points.sort((a, b) => b.weight - a.weight).slice(0, perCell));
      structure = { edge: edgeCells.flat(), path, edgeCells, pathCells: cellPaths,
        center: total ? { x: centerX / total, y: centerY / total } : { x: W / 2, y: H / 2 } };
      structureKey = key;
      stats.imageAnalysis = all.length ? 'ready' : 'low contrast';
    }

    function imagePoint(index, t, prefer = 'path') {
      if (!structure || !structure.edge.length) return null;
      const useEdge = prefer === 'edge' || state.imagePathMode === 'edge' || structure.path.length < 4;
      const groups = (useEdge ? structure.edgeCells : structure.pathCells).filter((points) => points.length);
      if (!groups.length) return null;
      // Select a photo first, then a point within it. A fixed stride through a
      // flattened list can repeatedly hit the same cell (for example 5 photos
      // and stride 5), or ignore later photos at a low text density.
      const source = groups[mod(index + state.seed, groups.length)];
      const step = Math.floor(t * 1.5);
      const i = mod(Math.floor(index / groups.length) * (useEdge ? 13 : 5) + step + state.seed, source.length);
      const point = source[i], prev = source[mod(i - 1, source.length)], next = source[(i + 1) % source.length];
      return { ...point, angle: Math.atan2(next.y - prev.y, next.x - prev.x) };
    }

    function anchor(t = 0, index = 0) {
      if (state.textPlacement === 'top') return { x: W / 2, y: H * 0.3 };
      if (state.textPlacement === 'bottom') return { x: W / 2, y: H * 0.7 };
      if (state.textPlacement === 'imageScatter') {
        const p = imagePoint(index, t, 'edge');
        if (p) return p;
        return { x: W * (0.12 + random(index * 17) * 0.76), y: H * (0.15 + random(index * 23) * 0.7) };
      }
      return { x: W / 2, y: H / 2 };
    }

    function ascii(t) {
      if (!state.asciiLayer || !image) return;
      const cols = clamp(Math.round(state.asciiDensity), 18, 120);
      const rows = clamp(Math.round(cols * H / W * 0.5), 10, 160);
      const sample = imageSample(cols, rows);
      if (!sample) return;
      const tick = state.asciiAnimate ? Math.floor(t * 5) : 0;
      const key = [cols, rows, W, H, canvas.width, canvas.height, state.imageFit, state.asciiCharset, state.asciiCoverage, state.asciiContrast,
        state.asciiEdge, state.asciiInvert, state.asciiAnimate, state.accent, state.asciiGlow, state.asciiScanlines, tick, state.seed].join(':');
      if (key !== asciiKey || !asciiCanvas) {
        // Keep the ASCII raster proportional to the output, so exports retain crisp glyphs.
        const dw = canvas.width, dh = canvas.height;
        if (!asciiCanvas || asciiCanvas.width !== dw || asciiCanvas.height !== dh) asciiCanvas = surface(dw, dh);
        const ac = asciiCanvas.getContext('2d');
        ac.setTransform(1, 0, 0, 1, 0, 0); ac.clearRect(0, 0, dw, dh); ac.scale(dw / W, dh / H);
        const ramp = RAMPS[state.asciiCharset] || RAMPS.classic;
        const cellW = W / cols, cellH = H / rows;
        ac.font = font(cellH * 0.88, 'mono', 500); ac.textBaseline = 'middle'; ac.textAlign = 'center'; ac.fillStyle = state.accent;
        ac.globalCompositeOperation = 'source-over';
        ac.shadowColor = state.accent; ac.shadowBlur = state.asciiGlow ? cellH * 0.26 * dw / W : 0;
        for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
          const i = y * cols + x;
          if (sample.alpha[i] < 0.06) continue;
          let brightness = clamp((sample.lum[i] - 0.5) * state.asciiContrast / 100 + 0.5 - sample.edge[i] * state.asciiEdge / 100, 0, 1);
          if (state.asciiInvert) brightness = 1 - brightness;
          if ((1 - brightness) * 100 < 100 - state.asciiCoverage && sample.edge[i] < state.asciiEdge / 180) continue;
          const perturbation = state.asciiAnimate ? (random(x * 7 + y * 31 + tick) - 0.5) * 1.4 : 0;
          const index = state.asciiCharset === 'random' || state.asciiCharset === 'binary'
            ? Math.floor(random(x + y * 97 + tick) * ramp.length)
            : clamp(Math.floor((1 - brightness) * (ramp.length - 1) + perturbation), 0, ramp.length - 1);
          if (ramp[index] === ' ') continue;
          ac.globalAlpha = sample.alpha[i];
          ac.fillText(ramp[index], (x + 0.5) * cellW, (y + 0.5) * cellH);
        }
        if (state.asciiScanlines) {
          // source-atop shades existing glyph pixels only; transparency stays transparent.
          ac.globalCompositeOperation = 'source-atop'; ac.shadowBlur = 0; ac.globalAlpha = 0.2; ac.fillStyle = '#000';
          for (let y = 0; y < H; y += 6 * U) ac.fillRect(0, y, W, 1.5 * U);
        }
        ac.globalAlpha = 1; ac.globalCompositeOperation = 'source-over'; ac.shadowBlur = 0;
        asciiKey = key; stats.asciiBuilds += 1;
      }
      ctx.save();
      ctx.globalCompositeOperation = ['screen', 'multiply', 'overlay', 'lighten', 'lighter', 'source-over'].includes(state.asciiBlend) ? state.asciiBlend : 'source-over';
      ctx.globalAlpha = state.asciiLayerOrder === 'above' ? 0.8 : 0.58;
      ctx.drawImage(asciiCanvas, 0, 0, W, H); ctx.restore();
    }

    function micro(label) {
      if (!state.smallText) return;
      const m = 56 * U;
      text(`TYPE / ${label.toUpperCase()}`, m, m, { size: 17 * U, family: 'mono', weight: 500, spacing: 1.3 * U, align: 'left', alpha: 0.8, scaleX: 1, scaleY: 1, style: 'normal' });
      text(`NO. ${state.issue}`, W - m, m, { size: 17 * U, family: 'mono', weight: 500, spacing: 1.2 * U, align: 'right', alpha: 0.8, scaleX: 1, scaleY: 1, style: 'normal' });
      line(m, H - m * 1.32, W - m, H - m * 1.32, state.textColor, 0.3);
      text(state.subtitle, m, H - m * 0.72, { size: 18 * U, family: 'mono', weight: 400, spacing: 0.5 * U, align: 'left', maxWidth: W - m * 3, scaleX: 1, scaleY: 1, alpha: 0.86, style: 'normal' });
      text('+', W - m, H - m * 0.72, { size: 16 * U, color: state.accent, scaleX: 1, scaleY: 1, style: 'normal' });
    }

    function staticEditorial() {
      const m = 64 * U;
      const titleWidth = W - m * 2;
      line(m, H * 0.16, W - m, H * 0.16, state.textColor, 0.6, U * 1.3);
      rect(m, H * 0.16 - 7 * U, 14 * U, 14 * U, state.accent, 1, true);
      text(state.issue, W - m, H * 0.27, { size: Math.min(W * 0.33, H * 0.21), align: 'right', color: state.accent, alpha: 0.14, family: 'sans', weight: 800, spacing: -7 * U, scaleX: 1, scaleY: 1, maxWidth: W * 0.6, style: 'normal' });
      const block = fitBlock(state.text, { x: m, y: H * 0.28, w: titleWidth, h: H * 0.43 }, {
        size: state.size * U * 2.85, leading: 1.03, valign: 'center', useRowGap: true
      });
      const by = Math.max(H * 0.75, H * 0.28 + block.height + 22 * U);
      line(m, Math.min(by, H * 0.83), m + titleWidth * 0.22, Math.min(by, H * 0.83), state.accent, 1, 6 * U);
      if (state.smallText) {
        text('FORM / LANGUAGE / RHYTHM', m, H * 0.85, { size: 15 * U, spacing: 2 * U, align: 'left', family: 'mono', weight: 400, scaleX: 1, scaleY: 1, maxWidth: titleWidth, alpha: 0.75, style: 'normal' });
      }
    }

    function staticSwiss() {
      const m = 64 * U, cx = W * 0.63, cy = H * 0.43;
      const radius = Math.min(W * 0.3, H * 0.28);
      ctx.save(); ctx.fillStyle = state.accent; ctx.globalAlpha = 0.13;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, TAU); ctx.fill(); ctx.restore();
      line(m, H * 0.2, m, H * 0.79, state.accent, 0.8, 5 * U);
      line(m, H * 0.79, W - m, H * 0.79, state.accent, 0.8, 5 * U);
      rect(W - m - 22 * U, H * 0.2, 22 * U, 22 * U, state.accent, 1, true);
      fitBlock(state.text, { x: m + 24 * U, y: H * 0.23, w: W - m * 2 - 40 * U, h: H * 0.49 }, {
        size: state.size * U * 2.7, leading: 0.98, valign: 'center', useRowGap: true
      });
      if (state.smallText) text(`SWISS / ${state.issue}`, W - m, H * 0.84, { size: 15 * U, family: 'mono', weight: 500, align: 'right', spacing: 3 * U, scaleX: 1, scaleY: 1, style: 'normal' });
    }

    function staticTypegrid() {
      const m = 62 * U;
      let words = state.text.trim().split(/\s+/).filter(Boolean);
      if (words.length < 2) words = graphemes(state.text.replace(/\s/g, ''));
      if (!words.length) words = ['TYPE'];
      const cols = W > H * 1.3 ? 3 : 2;
      const count = clamp(words.length, cols * 2, 12);
      const rows = Math.ceil(count / cols);
      const top = H * 0.18, bottom = H * 0.83;
      const cellW = (W - m * 2) / cols, cellH = (bottom - top) / rows;
      for (let i = 0; i < rows * cols; i += 1) {
        const col = i % cols, row = Math.floor(i / cols);
        const x = m + col * cellW, y = top + row * cellH;
        if (i === 0) rect(x, y, cellW, cellH, state.accent, 0.12, true);
        rect(x, y, cellW, cellH, state.textColor, 0.3);
        const word = words[i % words.length];
        fitBlock(word, { x: x + 18 * U, y: y + 26 * U, w: cellW - 36 * U, h: cellH - 42 * U }, {
          size: state.size * U * 1.65, leading: 1.05, valign: 'center', color: i % 3 === 0 ? state.accent : state.textColor, useRowGap: true
        });
        if (state.smallText) text(String(i + 1).padStart(2, '0'), x + 15 * U, y + 15 * U, { size: 13 * U, family: 'mono', weight: 400, align: 'left', spacing: U, alpha: 0.65, scaleX: 1, scaleY: 1, style: 'normal' });
      }
      // Preserve the complete copy even when the display grid uses repeated excerpt cells.
      if (words.length > 12) fitBlock(state.text, { x: m, y: H * 0.84, w: W - m * 2, h: H * 0.06 }, { size: 14 * U, scaleX: 1, scaleY: 1, leading: 1.1 });
    }

    function staticSpecimen() {
      const m = 64 * U;
      const first = graphemes(state.text.trim())[0] || 'A';
      const bigSize = Math.min(W * 0.68, H * 0.5);
      const glyphX = W * 0.42, glyphY = H * 0.39;
      line(m, H * 0.18, W - m, H * 0.18, state.textColor, 0.22);
      line(m, H * 0.57, W - m, H * 0.57, state.textColor, 0.22);
      text(first, glyphX, glyphY, { size: bigSize, color: state.accent, maxWidth: W * 0.65 });
      const alphabet = graphemes(state.text.replace(/\s/g, '')).slice(0, 6).join('');
      for (let row = 0; row < 3; row += 1) {
        text(alphabet, W - m, H * (0.29 + row * 0.085), { size: state.size * U * (0.35 + row * 0.17), align: 'right', maxWidth: W * 0.27, alpha: 0.45 + row * 0.2 });
      }
      fitBlock(state.text, { x: m, y: H * 0.64, w: W - m * 2, h: H * 0.2 }, { size: state.size * U * 1.35, leading: 1.04, valign: 'center', useRowGap: true });
      if (state.smallText) text(`${state.font.toUpperCase()} / ${state.fontWeight}`, m, H * 0.87, { size: 15 * U, family: 'mono', weight: 500, align: 'left', spacing: 2 * U, scaleX: 1, scaleY: 1, alpha: 0.75, style: 'normal' });
    }

    function tokens() {
      const source = state.text.trim() || 'TYPE';
      if (/\s/.test(source) && graphemes(source).length > 22) return source.split(/\s+/).filter(Boolean);
      return graphemes(source.replace(/\s+/g, '·'));
    }

    function imageText(t) {
      if (state.imagePathMode === 'off' || !structure || structure.edge.length < 4) return false;
      const chars = graphemes(state.text.replace(/\s+/g, '·'));
      const count = clamp(Math.round(state.density * 1.1), 18, 120);
      const points = Array.from({ length: count }, (_, i) => imagePoint(i, t, state.imagePathMode === 'edge' ? 'edge' : 'path')).filter(Boolean);
      ctx.save(); ctx.strokeStyle = state.accent; ctx.globalAlpha = 0.2; ctx.lineWidth = U;
      ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); ctx.restore();
      points.forEach((p, i) => text(chars[i % chars.length] || '·', p.x, p.y, {
        size: clamp(state.size * (0.35 + p.weight * 0.25), 12, 58) * U,
        rotate: p.angle, color: i % 5 === 0 ? state.accent : state.textColor,
        alpha: clamp(0.45 + p.weight * 0.3, 0, 1)
      }));
      text(state.text, W / 2, H * 0.82, { size: state.size * U * 0.75, color: state.accent, maxWidth: W * 0.84 });
      return true;
    }

    function hud(t) {
      let labels = tokens();
      if (state.hudShuffle) labels = labels.map((label, i) => ({ label, order: random(i) })).sort((a, b) => a.order - b.order).map((item) => item.label);
      const count = clamp(Math.round(state.density * 0.86), 10, 96);
      const cols = clamp(Math.round(Math.sqrt(count * W / H) * 1.55), 4, 14);
      const rows = Math.ceil(count / cols), a = anchor(t);
      const gridW = W * 0.8, gridH = Math.min(H * 0.48, rows * state.rowGap * U * 1.25);
      const gapX = gridW / Math.max(1, cols - 1), gapY = gridH / Math.max(1, rows - 1);
      const nodes = [];
      for (let i = 0; i < count; i += 1) {
        const row = Math.floor(i / cols), col = i % cols;
        const point = state.imagePathMode !== 'off' ? imagePoint(i, t) : state.textPlacement === 'imageScatter' ? anchor(t, i) : null;
        const x = point ? point.x : a.x - gridW / 2 + col * gapX + Math.sin(t * 0.8 + i * 0.62) * state.spread * U * 0.15;
        const y = point ? point.y : a.y - gridH / 2 + row * gapY + Math.cos(t * 0.7 + col) * 5 * U;
        if (x < 42 * U || x > W - 42 * U || y < 90 * U || y > H - 100 * U) continue;
        const label = labels[i % labels.length];
        let size = clamp(state.size * 0.72, 12, 78) * U;
        const width = measure(label, size).width * state.scaleX;
        if (width > gapX * 0.73) size *= gapX * 0.73 / Math.max(width, 1);
        size = Math.min(size, Math.max(8 * U, (gapY - 15 * U) / state.scaleY));
        nodes.push({ x, y, label, size, i });
      }
      nodes.forEach((node, i) => {
        if (nodes[i + 1]) line(node.x, node.y, nodes[i + 1].x, nodes[i + 1].y, state.textColor, 0.25);
        if (i % 5 === 0 && nodes[i + cols]) line(node.x, node.y, nodes[i + cols].x, nodes[i + cols].y, state.accent, 0.13);
      });
      nodes.forEach((node) => {
        const bw = measure(node.label, node.size).width * state.scaleX + 17 * U;
        const bh = node.size * state.scaleY + 13 * U;
        rect(node.x - bw / 2, node.y - bh / 2, bw, bh, state.accent, 0.07, true);
        rect(node.x - bw / 2, node.y - bh / 2, bw, bh, node.i % 5 ? state.textColor : state.accent, 0.8);
        text(node.label, node.x, node.y, { size: node.size });
      });
      if (state.imagePathMode === 'off' && state.textPlacement !== 'imageScatter') {
        const y = state.textPlacement === 'bottom' ? H * 0.2 : H * 0.83;
        text(state.text, W / 2, y, { size: state.size * U, maxWidth: W * 0.84 });
      }
    }

    function wave(t) {
      if (imageText(t)) return;
      const rows = clamp(Math.round(state.density / 9), 4, 12), a = anchor(t);
      const height = Math.min(H * 0.52, rows * Math.max(state.rowGap * 1.6, state.size * state.scaleY * 0.86) * U);
      for (let row = 0; row < rows; row += 1) {
        const p = row / (rows - 1);
        text(state.text, a.x + Math.sin(t * 1.2 + row * 0.72) * state.spread * U * 0.42, a.y - height / 2 + p * height, {
          size: Math.min(state.size * U * (0.7 + p * 0.12), height / (rows - 1) / state.scaleY * 0.88), alpha: 0.35 + (1 - Math.abs(p - 0.5) * 1.4) * 0.6,
          rotate: Math.sin(t * 0.9 + row) * 0.025, scaleX: state.scaleX * (1.12 + Math.sin(t + row) * 0.06), maxWidth: W * 0.8
        });
      }
    }

    function rain(t) {
      const chars = graphemes(state.text.replace(/\s+/g, '·'));
      const cols = clamp(Math.round(state.density / 5), 6, 22);
      const size = clamp(state.size * 0.48, 14, 48) * U;
      const gap = Math.max(size * 1.4 * state.scaleY, state.rowGap * U * 1.7);
      const rows = Math.ceil(H / gap) + 2;
      for (let col = 0; col < cols; col += 1) for (let row = 0; row < rows; row += 1) {
        const y = mod(row * gap + t * 145 * U + random(col) * H, H + gap) - gap / 2;
        text(chars[mod(col * 7 + row, chars.length)] || '·', (col + 0.5) * W / cols, y, {
          size, family: state.font, alpha: 0.2 + mod(row + col, 7) * 0.1, color: row % 7 === 0 ? state.accent : state.textColor
        });
      }
    }

    function orbit(t) {
      const source = graphemes(`${state.text.replace(/\s+/g, ' ')} · `);
      const count = clamp(Math.round(state.density), 12, 96), a = anchor(t);
      const radius = Math.min(W * 0.37, H * 0.32) * (0.7 + state.spread / 200);
      const size = Math.min(state.size * U * 0.48, TAU * radius / count * 0.8);
      for (let i = 0; i < count; i += 1) {
        const angle = i / count * TAU + t * 0.3;
        text(source[i % source.length], a.x + Math.cos(angle) * radius, a.y + Math.sin(angle) * radius, { size, rotate: angle + Math.PI / 2 });
      }
      fitBlock(state.text, { x: a.x - radius * 0.65, y: a.y - radius * 0.3, w: radius * 1.3, h: radius * 0.6 }, { size: state.size * U, align: 'center', valign: 'center', color: state.accent });
    }

    function drift(t) {
      const count = clamp(Math.round(state.density * 0.7), 8, 70);
      const cols = clamp(Math.round(Math.sqrt(count * W / H)), 3, 12), rows = Math.ceil(count / cols);
      for (let i = 0; i < count; i += 1) {
        const x = W * 0.12 + (i % cols) * W * 0.76 / Math.max(1, cols - 1) + Math.sin(t + i) * state.spread * U * 0.2;
        const y = H * 0.2 + Math.floor(i / cols) * H * 0.6 / Math.max(1, rows - 1) + Math.cos(t * 0.8 + i) * state.spread * U * 0.18;
        text(state.text, x, y, { size: state.size * U * (0.22 + random(i) * 0.4), rotate: (random(i + 9) - 0.5) * 0.25,
          alpha: 0.18 + random(i) * 0.65, maxWidth: W / cols * 0.88 });
      }
    }

    function coil(t) {
      const chars = graphemes(state.text.replace(/\s+/g, '·'));
      const count = clamp(Math.round(state.density * 1.4), 18, 140), a = anchor(t);
      const maxRadius = Math.min(W * 0.4, H * 0.34) * (0.65 + state.spread / 200);
      for (let i = 0; i < count; i += 1) {
        const angle = i * 0.34 + t * 0.55, radius = 20 * U + i / count * maxRadius;
        text(chars[i % chars.length] || '·', a.x + Math.cos(angle) * radius, a.y + Math.sin(angle) * radius, {
          size: clamp(state.size * 0.4, 12, 40) * U, rotate: angle + Math.PI / 2, alpha: 0.2 + i / count * 0.8
        });
      }
    }

    function flag(t) {
      if (imageText(t)) return;
      const chars = graphemes(state.text.replace(/\s+/g, '·'));
      const count = clamp(Math.round(state.density * 0.9), 18, 96), a = anchor(t);
      const width = W * 0.8, amp = Math.min(H * 0.18, (36 + state.spread * 0.72) * U);
      const points = Array.from({ length: count }, (_, i) => {
        const p = i / (count - 1), phase = p * Math.PI * 2.4 + t * 1.25;
        return { x: W * 0.1 + p * width, y: a.y + Math.sin(phase) * amp, angle: Math.atan(Math.cos(phase) * amp * Math.PI * 2.4 / width) };
      });
      points.forEach((p, i) => {
        if (i) line(points[i - 1].x, points[i - 1].y, p.x, p.y, state.accent, 0.3);
        text(chars[i % chars.length] || '·', p.x, p.y, { size: Math.min(state.size * U * 0.44, width / count * 1.3), rotate: p.angle, alpha: 0.9 });
      });
      text(state.text, W / 2, H * 0.79, { size: state.size * U * 0.7, color: state.accent, maxWidth: W * 0.82 });
    }

    function crash(t) {
      const chars = graphemes(state.text.replace(/\s+/g, '·'));
      const count = clamp(Math.round(state.density), 18, 100), a = anchor(t);
      const maxRadius = Math.min(W * 0.4, H * 0.35);
      for (let i = 0; i < count; i += 1) {
        const angle = i / count * TAU + Math.sin(t * 0.7) * 0.2;
        const radius = maxRadius * (0.22 + random(i) * 0.78) * (0.85 + Math.sin(t * 1.4 + i) * state.spread / 700);
        text(chars[i % chars.length] || '·', a.x + Math.cos(angle) * radius, a.y + Math.sin(angle) * radius, {
          size: state.size * U * (0.28 + random(i + 2) * 0.55), rotate: angle, alpha: 0.35 + random(i + 3) * 0.6
        });
      }
      text(state.text, a.x, a.y, { size: state.size * U * 0.95, color: state.accent, maxWidth: W * 0.76 });
    }

    function currentGroups() {
      if(global.KineticModel?.groupsFor)return global.KineticModel.groupsFor(state);
      return state.template==='helix'?(state.helixGroups||state.ringGroups||[]):(state.ringGroups||[]);
    }

    function wrap(time, mask) {
      if (!global.KineticRing) throw new Error('The 3D text renderer could not load.');
      if (!ringCanvas || ringCanvas.width !== canvas.width || ringCanvas.height !== canvas.height) ringCanvas = surface(canvas.width, canvas.height);
      const options = {
        width: W, height: H, text: state.text, ...styleValues(state), textStyleScale:U,
        subjectBox: { x:0, y:0, width:W, height:H },
        ringCenterX: W * finite(state.wrapX,.5), ringCenterY: H * finite(state.wrapY,.48),
        radiusX: W * finite(state.wrapRadius,.40), radiusZ: W * finite(state.wrapDepth,.22),
        perspective: W * finite(state.wrapPerspective,1.5), tilt: finite(state.wrapTilt,-18), roll: finite(state.wrapRoll,-14),
        phase: finite(state.wrapPhase,0) + (state.mode === 'motion' ? time*36 : 0),
        fontSize: state.size * U, fontFamily: FONTS[state.font] || FONTS.sans,
        fontWeight: state.fontWeight, textColor:state.textColor,
        letterSpacing: Math.max(0,state.letterSpacing * U), segments: 5,
        path: state.template === 'helix' ? 'helix' : 'ellipse', turns: finite(state.wrapTurns,3),
        helixHeight: H * finite(state.wrapHeight,.7), depthFade: finite(state.depthFade,.58),
        layers: { background:false, subject:!!mask }
      };
      const groups=currentGroups();
      if (groups.length) options.groups = groups.map(group => ({
        ...styleValues(group), id: group.id, name: group.name, text: typeof group.text === 'string' ? group.text : state.text, textColor: group.color || options.textColor,
        ringCenterX: options.ringCenterX + W * finite(group.offsetX,0),
        ringCenterY: options.ringCenterY + H * finite(group.offsetY,0),
        radiusX: options.radiusX * finite(group.radiusScale,1), radiusZ: options.radiusZ * finite(group.depthScale,finite(group.radiusScale,1)),
        phase: options.phase + finite(group.phase,0),
        roll: finite(group.roll,options.roll), tilt: finite(group.tilt,options.tilt),
        fontSize: finite(group.size,state.size) * U,
        fontFamily: FONTS[group.font] || options.fontFamily, fontWeight: finite(group.fontWeight,state.fontWeight),
        depthFade: finite(group.depthFade,options.depthFade), turns: finite(group.turns,options.turns),
        helixHeight: H * finite(group.height,finite(state.wrapHeight,.7))
      }));
      stats.wrap = global.KineticRing.render(ringCanvas.getContext('2d'),mask || null,options);
      ctx.drawImage(ringCanvas,0,0,W,H);
    }

    function contour(time, mask) {
      if (!global.KineticContour) throw new Error('轮廓文字模块未能加载。');
      if (!ringCanvas || ringCanvas.width !== canvas.width || ringCanvas.height !== canvas.height) ringCanvas = surface(canvas.width, canvas.height);
      stats.contour = global.KineticContour.render(ringCanvas.getContext('2d'), mask || null, {
        mode: state.template, width: W, height: H, text: state.text, ...styleValues(state), textOpacity:1, textStyleScale:U,
        fontFamily: FONTS[state.font] || FONTS.sans, fontWeight: state.fontWeight, fontSize: state.size * U,
        color: state.textColor, ...(state.template === 'spiral' ? { centerX: W * state.wrapX, centerY: H * state.wrapY } : {}),
        radiusX: Math.min(W,H) * state.wrapRadius,
        gap: W * state.contourGap, spacing: W * state.contourSpacing, count: state.contourCount,
        turns: state.spiralTurns, phase: (state.wrapPhase + (state.mode === 'motion' ? time*24 : 0)) * Math.PI / 180,
        letterSpacing: Math.max(0,state.letterSpacing*U)
      });
      ctx.drawImage(ringCanvas,0,0,W,H);
    }

    function customPath(timeSeconds) {
      if(!global.KineticPath)throw new Error('自定义路径模块未能加载。');
      stats.customPath=global.KineticPath.render(ctx,{
        width:W,height:H,points:state.customPath||[],closed:state.pathClosed===true,repeat:state.pathRepeat!==false,
        direction:state.pathDirection||'forward',phase:finite(state.pathPhase,0),spacing:finite(state.pathSpacing,2)*U,
        text:state.text,fontFamily:FONTS[state.font]||FONTS.sans,fontWeight:state.fontWeight,fontSize:state.size*U,color:state.textColor,
        time:Math.max(0,finite(timeSeconds,0)),motion:state.mode==='motion',speed:state.speed,
        ...global.KineticProjection.textStyle(state,U),textOpacity:1
      });
    }

    function guides() {
      const m = 56 * U;
      ctx.save(); ctx.strokeStyle = state.accent; ctx.globalAlpha = 0.28; ctx.lineWidth = U;
      ctx.setLineDash([5 * U, 6 * U]); ctx.strokeRect(m, m, W - m * 2, H - m * 2);
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke(); ctx.restore();
    }

    const renderers = { editorial: staticEditorial, swiss: staticSwiss, typegrid: staticTypegrid, specimen: staticSpecimen,
      hud, wave, rain, orbit, drift, coil, flag, crash };

    function render(input, timeSeconds = 0, source = null, options = {}) {
      if (disposed) throw new Error('This renderer has been disposed.');
      stats.wrap = null;stats.customPath=null;
      state = { font: 'mono', fontWeight: 700, size: 42, speed: 48, density: 64, letterSpacing: 0, rowGap: 30, spread: 58,
        scaleX: 1, scaleY: 1, text: 'TYPE / TIME', textColor: '#8aff9e', accent: '#39ff6f', background: '#020704',
        backgroundMode: 'color', imageFit: 'cover', imageWash: 32, smallText: true, textLayer: true, renderStyle: 'normal',
        imagePathMode: 'off', textPlacement: 'center', textAlign: 'left', seed: 7, issue: '01', subtitle: 'A study in type & time.',
        asciiLayer: false, asciiLayerOrder: 'below', asciiDensity: 54, asciiCharset: 'classic', asciiCoverage: 86,
        asciiContrast: 115, asciiEdge: 18, asciiInvert: false, asciiAnimate: true, asciiBlend: 'screen', asciiGlow: true, asciiScanlines: true,
        ...input };
      W = clamp(finite(state.width, 900), 64, 12000); H = clamp(finite(state.height, 1200), 64, 12000); U = Math.min(W, H) / 900;
      state.text = String(state.text == null ? '' : state.text);
      state.scaleX = clamp(finite(state.scaleX, 1), 0.2, 5); state.scaleY = clamp(finite(state.scaleY, 1), 0.2, 5);
      state.seed = finite(state.seed, 7); state.textAlign = ['left', 'center', 'right'].includes(state.textAlign) ? state.textAlign : 'left';
      images = Array.isArray(source) ? source.filter(Boolean).slice(0, 9) : source ? [source] : [];
      // Direct callers of the old renderer still receive an image-only layout;
      // saved v03 projects are migrated by the model before reaching this path.
      if (state.template === 'collage') { state.textLayer = false; state.backgroundMode = 'image'; state.imageWash = 0; }
      prepareImages();
      ctx.save();
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(canvas.width / W, canvas.height / H); ctx.imageSmoothingEnabled = true;
        ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
        const time = Math.max(0, finite(timeSeconds, 0)) * clamp(finite(state.speed, 48), 0, 100) / 48;
        background();
        if (state.textLayer !== false) analyzeImage();
        if (state.asciiLayerOrder !== 'above') ascii(time);
        if (state.textLayer !== false) {
          const grouped=state.template==='wrap'||state.template==='helix';
          const opacity=grouped?1:clamp(finite(state.textOpacity,1),0,1);
          const drawType=()=>{
            if(state.text.trim()||(grouped&&currentGroups().some(g=>g.text.trim()))) {
              if(grouped)wrap(time,options.subjectMask);
              else if(state.template==='contour'||state.template==='spiral')contour(time,options.subjectMask);
              else if(state.template==='customPath')customPath(timeSeconds);
              else(renderers[state.template]||hud)(time);
            }
            micro(state.template||(state.mode==='static'?'editorial':'hud'));
          };
          if(opacity>0&&opacity<1) {
            if(!textCanvas||textCanvas.width!==canvas.width||textCanvas.height!==canvas.height)textCanvas=surface(canvas.width,canvas.height);
            const main=ctx,layer=textCanvas.getContext('2d');layer.save();
            try {layer.setTransform(1,0,0,1,0,0);layer.globalAlpha=1;layer.globalCompositeOperation='source-over';layer.clearRect(0,0,textCanvas.width,textCanvas.height);layer.scale(textCanvas.width/W,textCanvas.height/H);ctx=layer;drawType();}
            finally {ctx=main;layer.restore();}
            ctx.save();ctx.globalAlpha=opacity;ctx.drawImage(textCanvas,0,0,W,H);ctx.restore();
          } else if(opacity>0)drawType();
        }
        if (state.asciiLayerOrder === 'above') ascii(time);
        if (options.guides === true) guides();
        stats.frames += 1;
      } finally { ctx.restore(); }
      return stats;
    }

    function dispose() {
      metrics.clear(); mosaics.clear(); samples.clear(); structure = null; image = null; images = []; compositeCanvas = null; sourceCells = []; asciiCanvas = null; ringCanvas = null; textCanvas = null; styledGlyphs.clear(); styledGlyphPixels=0; disposed = true;
    }
    function clearCaches() { styledGlyphs.clear(); styledGlyphPixels=0; metrics.clear(); mosaics.clear(); samples.clear(); structure = null; structureKey = ''; asciiKey = ''; compositeKey = ''; }
    return Object.freeze({ render, dispose, clearCaches, stats });
  }

  global.KineticRenderer = Object.freeze({ create, composePhotos, graphemes, collageRects, fonts: FONTS, templateIds: Object.freeze(['wrap', 'contour', 'spiral', 'helix', 'customPath', 'hud', 'wave', 'rain', 'orbit', 'drift', 'coil', 'flag', 'crash']) });
})(window);
