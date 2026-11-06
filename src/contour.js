(function (root, factory) {
  'use strict';
  const P = typeof module === 'object' && module.exports ? require('./projection.js') : root.KineticProjection;
  const api = factory(P);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KineticContour = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P) {
  'use strict';
  const TAU = Math.PI * 2;
  let maskCache = new WeakMap();
  const measureCache = new Map();
  const styledCache = new Map();
  let styledPixels = 0;
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const color = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#ffffff';

  function area(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return sum / 2;
  }

  // Edges are oriented with foreground on their right. Selecting the rightmost
  // successor at a diagonal contact keeps distinct components from becoming a
  // self-crossing outline. The largest positive loop is the exterior silhouette.
  function traceBinary(binary, width, height) {
    const edges = [], starts = new Map(), stride = width + 1;
    function edge(x, y, direction) {
      const dx = [1, 0, -1, 0][direction], dy = [0, 1, 0, -1][direction];
      const item = { x, y, end: (y + dy) * stride + x + dx, direction, visited: false };
      const key = y * stride + x;
      if (!starts.has(key)) starts.set(key, []);
      starts.get(key).push(item); edges.push(item);
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!binary[y * width + x]) continue;
      if (!y || !binary[(y - 1) * width + x]) edge(x, y, 0);
      if (x === width - 1 || !binary[y * width + x + 1]) edge(x + 1, y, 1);
      if (y === height - 1 || !binary[(y + 1) * width + x]) edge(x + 1, y + 1, 2);
      if (!x || !binary[y * width + x - 1]) edge(x, y + 1, 3);
    }
    let best = [], largest = 0;
    const priority = [1, 0, 3, 2];
    for (const first of edges) {
      if (first.visited) continue;
      let item = first, closed = false;
      const points = [], origin = first.y * stride + first.x;
      while (item && !item.visited) {
        item.visited = true; points.push({ x: item.x, y: item.y });
        if (item.end === origin) { closed = true; break; }
        const candidates = (starts.get(item.end) || []).filter(next => !next.visited);
        candidates.sort((a, b) => priority.indexOf((a.direction - item.direction + 4) % 4) - priority.indexOf((b.direction - item.direction + 4) % 4));
        item = candidates[0];
      }
      if (closed) {
        const size = area(points);
        if (size > largest) { largest = size; best = points; }
      }
    }
    return best;
  }

  function alphaBinary(data, width, height, threshold = 100) {
    if (!data || data.length !== width * height && data.length !== width * height * 4) throw new TypeError('Mask data must have one alpha channel or RGBA pixels.');
    const rgba = data.length === width * height * 4, out = new Uint8Array(width * height);
    for (let i = 0; i < out.length; i++) out[i] = data[rgba ? i * 4 + 3 : i] >= threshold ? 1 : 0;
    return out;
  }

  function traceAlpha(data, width, height, threshold = 100) {
    return traceBinary(alphaBinary(data, width, height, threshold), width, height);
  }

  // Exact squared Euclidean distance transform, separable into two 1D passes.
  // Dilation followed by tracing handles concave limbs and merges narrow gaps
  // naturally; offsetting polygon vertices would create spikes/self-intersections.
  function distanceLine(input, output, length, sites, cuts) {
    let k = 0;
    sites[0] = 0; cuts[0] = -Infinity; cuts[1] = Infinity;
    for (let q = 1; q < length; q++) {
      let s;
      do {
        const p = sites[k];
        s = ((input[q] + q * q) - (input[p] + p * p)) / (2 * (q - p));
        if (s > cuts[k] || k === 0) break;
        k--;
      } while (k >= 0);
      k++; sites[k] = q; cuts[k] = s; cuts[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q++) {
      while (cuts[k + 1] < q) k++;
      const delta = q - sites[k]; output[q] = delta * delta + input[sites[k]];
    }
  }

  function distanceField(binary, width, height) {
    const size = Math.max(width, height), input = new Float64Array(size), output = new Float64Array(size);
    const sites = new Int32Array(size), cuts = new Float64Array(size + 1);
    const intermediate = new Float64Array(width * height), result = new Float32Array(width * height), infinity = 1e12;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) input[y] = binary[y * width + x] ? 0 : infinity;
      distanceLine(input, output, height, sites, cuts);
      for (let y = 0; y < height; y++) intermediate[y * width + x] = output[y];
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) input[x] = intermediate[y * width + x];
      distanceLine(input, output, width, sites, cuts);
      for (let x = 0; x < width; x++) result[y * width + x] = output[x];
    }
    return result;
  }

  function arcTable(points, closed = true) {
    const lengths = [0]; let length = 0;
    if (points.length > 1) for (let i = 1; i <= points.length - (closed ? 0 : 1); i++) {
      const a = points[i - 1], b = points[i % points.length];
      length += Math.hypot(b.x - a.x, b.y - a.y); lengths.push(length);
    }
    return { points, lengths, length, closed };
  }

  function pointAtLength(arc, distance) {
    if (!arc.points.length) return { x: 0, y: 0 };
    if (!arc.length) return { ...arc.points[0] };
    distance = arc.closed ? ((distance % arc.length) + arc.length) % arc.length : clamp(distance, 0, arc.length);
    let lo = 0, hi = arc.lengths.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arc.lengths[mid] > distance) hi = mid; else lo = mid; }
    const a = arc.points[lo % arc.points.length], b = arc.points[(lo + 1) % arc.points.length];
    const span = arc.lengths[lo + 1] - arc.lengths[lo], t = span ? (distance - arc.lengths[lo]) / span : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function smooth(points, rounds = 3) {
    if (points.length < 4) return points;
    const arc = arcTable(points), count = Math.min(900, Math.max(48, Math.ceil(arc.length / 1.5)));
    let result = Array.from({ length: count }, (_, i) => pointAtLength(arc, arc.length * i / count));
    for (let n = 0; n < rounds; n++) result = result.map((p, i) => {
      const a = result[(i + count - 1) % count], b = result[(i + 1) % count];
      return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
    });
    return result;
  }

  function boundsOf(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    return points.length ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
  }

  function largestComponent(binary, width, height) {
    const visited = new Uint8Array(binary.length), queue = new Int32Array(binary.length);
    let largest = [];
    for (let start = 0; start < binary.length; start++) {
      if (!binary[start] || visited[start]) continue;
      let head = 0, tail = 1; queue[0] = start; visited[start] = 1;
      while (head < tail) {
        const current = queue[head++], x = current % width, y = Math.floor(current / width);
        const neighbors = [x ? current - 1 : -1, x + 1 < width ? current + 1 : -1, y ? current - width : -1, y + 1 < height ? current + width : -1];
        for (const next of neighbors) if (next >= 0 && binary[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
      }
      if (tail > largest.length) largest = queue.slice(0, tail);
    }
    const result = new Uint8Array(binary.length);
    for (const index of largest) result[index] = 1;
    return result;
  }

  function prepareField(binary, width, height, padding) {
    const w = width + padding * 2, h = height + padding * 2, padded = new Uint8Array(w * h);
    for (let y = 0; y < height; y++) padded.set(binary.subarray(y * width, (y + 1) * width), (y + padding) * w + padding);
    return { distances: distanceField(padded, w, h), width: w, height: h, padding };
  }

  function fieldContour(field, distance) {
    const { distances, width, height, padding } = field, binary = new Uint8Array(distances.length), limit = distance * distance;
    for (let i = 0; i < binary.length; i++) binary[i] = distances[i] <= limit ? 1 : 0;
    return smooth(traceBinary(binary, width, height)).map(p => ({ x: p.x - padding, y: p.y - padding }));
  }

  function offsetContours(data, width, height, offsets = [0], threshold = 100) {
    const binary = largestComponent(alphaBinary(data, width, height, threshold), width, height), safe = offsets.slice(0, 5).map(v => clamp(finite(v, 0), 0, Math.max(width, height)));
    const field = prepareField(binary, width, height, Math.ceil(Math.max(0, ...safe)) + 2);
    return safe.map(distance => fieldContour(field, distance));
  }

  function makeSurface(ctx, width, height) {
    const canvas = ctx.canvas.ownerDocument ? ctx.canvas.ownerDocument.createElement('canvas') : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : null;
    if (!canvas) throw new Error('A Canvas surface is required to read the subject mask.');
    canvas.width = width; canvas.height = height; return canvas;
  }

  function preparedMask(ctx, mask) {
    if (maskCache.has(mask)) return maskCache.get(mask);
    const sourceWidth = mask.naturalWidth || mask.width, sourceHeight = mask.naturalHeight || mask.height;
    if (!(sourceWidth > 0 && sourceHeight > 0)) throw new TypeError('The subject mask must be decoded before rendering.');
    const scale = Math.min(1, 384 / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale)), height = Math.max(1, Math.round(sourceHeight * scale));
    let data;
    if (mask.data && mask.data.length === sourceWidth * sourceHeight * 4) {
      data = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sx = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / width)), sy = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / height));
        data[y * width + x] = mask.data[(sy * sourceWidth + sx) * 4 + 3];
      }
    } else {
      const canvas = makeSurface(ctx, width, height), read = canvas.getContext('2d', { willReadFrequently: true });
      read.drawImage(mask, 0, 0, width, height); data = read.getImageData(0, 0, width, height).data;
    }
    const binary = largestComponent(alphaBinary(data, width, height), width, height), raw = traceBinary(binary, width, height);
    const result = { binary, width, height, bounds: boundsOf(raw), contours: new Map(), field: null };
    maskCache.set(mask, result); return result;
  }

  function contourPaths(prepared, offsets, width, height) {
    const sx = width / prepared.width, sy = height / prepared.height, scale = Math.sqrt(sx * sy);
    const distances = offsets.map(v => v / scale), max = Math.ceil(Math.max(0, ...distances)) + 2;
    if (!prepared.field || prepared.field.padding < max) prepared.field = prepareField(prepared.binary, prepared.width, prepared.height, max);
    return distances.map(distance => {
      const key = Math.round(distance * 4) / 4;
      let points = prepared.contours.get(key);
      if (!points) {
        points = fieldContour(prepared.field, key);
        if (prepared.contours.size >= 32) prepared.contours.clear();
        prepared.contours.set(key, points);
      }
      return points.map(p => ({ x: p.x * sx, y: p.y * sy }));
    });
  }

  function spiralPath(input = {}) {
    const radius = clamp(finite(input.radius, 150), 1, 10000), turns = clamp(finite(input.turns, 3), 1, 8);
    const inner = radius * .10, count = Math.max(240, Math.ceil(turns * 220));
    const centerX = finite(input.centerX, 0), centerY = finite(input.centerY, 0), phase = finite(input.phase, 0);
    return Array.from({ length: count + 1 }, (_, i) => {
      const t = i / count, angle = -Math.PI / 2 + TAU * turns * t + phase, r = inner + (radius - inner) * t;
      return { x: centerX + r * Math.cos(angle), y: centerY + r * Math.sin(angle) };
    });
  }

  function glyphs(text) {
    const source = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 500);
    const phrase = source ? source + (/[•·|]$/.test(source) ? ' ' : ' • ') : '';
    if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(phrase), item => item.segment);
    return Array.from(phrase);
  }

  function measure(ctx, char, font) {
    const key = font + '\n' + char;
    if (measureCache.has(key)) return measureCache.get(key);
    ctx.font = font; const width = ctx.measureText(char).width;
    if (measureCache.size >= 2048) measureCache.clear();
    measureCache.set(key, width); return width;
  }

  function styledGlyph(ctx,char,font,size,width,options) {
    const style=Object.keys(P.textStyle()).filter(k=>k!=='textOpacity').map(k=>options[k]),key=JSON.stringify([char,font,width,options.color,style]);
    if(styledCache.has(key))return styledCache.get(key);
    const pad=Math.max(Math.ceil(size*.22),P.stylePadding(options)),tile=makeSurface(ctx,Math.ceil(width+pad*2),Math.ceil(size*1.7+pad*2)),c=tile.getContext('2d');
    c.font=font;c.textAlign='left';c.textBaseline='middle';c.fillStyle=options.color;P.paintStyledText(c,char,pad,tile.height/2,options);
    const result={tile,width:tile.width,height:tile.height},pixels=tile.width*tile.height;
    while(styledCache.size&&(styledCache.size>=512||styledPixels+pixels>4*1024*1024)){const key=styledCache.keys().next().value,old=styledCache.get(key);styledPixels-=old.width*old.height;styledCache.delete(key);}
    if(pixels<=4*1024*1024){styledCache.set(key,result);styledPixels+=pixels;}return result;
  }

  function paintPath(ctx, points, options, stats, closed, groupIndex, pathIndex) {
    const arc = arcTable(points, closed), chars = glyphs(options.text);
    if (!chars.length || arc.length < 2) return;
    const phase = closed ? options.phase / TAU * arc.length : 0, limit = 3600;
    let cursor = 0, index = 0;
    while (cursor < arc.length && stats.glyphCount < limit && index < 6000) {
      const t = cursor / arc.length;
      // The inner letters become smaller as in a typographic vortex. Their
      // advance is measured at that actual size, rather than adding arbitrary gaps.
      const size = closed ? options.fontSize : options.fontSize * (.35 + .65 * Math.sqrt(t));
      const char = chars[index % chars.length], font = `${options.fontWeight} ${Math.round(size * 4) / 4}px ${options.fontFamily}`;
      const width = measure(ctx, char, font), advance = Math.max(size * .05, width + options.letterSpacing);
      if (cursor + advance > arc.length) break;
      const distance = cursor + width / 2 + phase, center = pointAtLength(arc, distance);
      const delta = Math.max(1, Math.min(size * .28, advance * .48));
      const before = pointAtLength(arc, distance - delta), after = pointAtLength(arc, distance + delta);
      const angle = Math.atan2(after.y - before.y, after.x - before.x);
      if (char.trim()) {
        ctx.save(); ctx.translate(center.x, center.y); ctx.rotate(angle); ctx.font = font;
        ctx.fillStyle = options.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';ctx.globalAlpha*=options.textOpacity;
        if(options.textStrokeEnabled||options.textGlowEnabled||options.textShadowEnabled){const glyph=styledGlyph(ctx,char,font,size,width,options);ctx.drawImage(glyph.tile,-glyph.width/2,-glyph.height/2);}else ctx.fillText(char,0,0);ctx.restore();
        stats.glyphCount++; stats.glyphs.push({ char, x: center.x, y: center.y, angle, size, group: groupIndex, path: pathIndex });
      }
      cursor += advance; index++;
    }
    stats.paths.push({ group: groupIndex, index: pathIndex, length: arc.length, closed, points });
  }

  function render(ctx, mask, input = {}) {
    if (!ctx || !ctx.canvas || typeof ctx.fillText !== 'function') throw new TypeError('render requires a Canvas 2D context.');
    const width = clamp(finite(input.width, ctx.canvas.width), 1, 16384), height = clamp(finite(input.height, ctx.canvas.height), 1, 16384);
    const mode = input.mode === 'spiral' ? 'spiral' : 'contour';
    const base = {
      ...P.textStyle(input,finite(input.textStyleScale,1)),
      text: String(input.text == null ? '' : input.text), color: color(input.color || input.textColor),
      fontFamily: input.fontFamily || 'sans-serif', fontWeight: clamp(finite(input.fontWeight, 700), 100, 1000),
      fontSize: clamp(finite(input.fontSize, 50), 4, Math.max(width, height)),
      letterSpacing: clamp(finite(input.letterSpacing, 0), -10, 100), phase: finite(input.phase, 0),
      centerX: finite(input.centerX, width / 2), centerY: finite(input.centerY, height / 2),
      gap: clamp(finite(input.gap, width * .018), 0, width * .3), spacing: clamp(finite(input.spacing, width * .045), 0, width * .3),
      count: clamp(Math.round(finite(input.count, 1)), 1, 5), turns: clamp(finite(input.turns, 3), 1, 8),
      radiusX: clamp(finite(input.radiusX, Math.min(width, height) * .42), 1, Math.max(width, height) * 2)
    };
    const stats = { mode, waiting: mode === 'contour' && !mask, glyphCount: 0, glyphs: [], paths: [], bounds: null, usesSubjectOutline: false };
    ctx.save();
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.scale(ctx.canvas.width / width, ctx.canvas.height / height);
      if (stats.waiting) return stats;
      let prepared = null, bounds = null;
      if (mask) {
        prepared = preparedMask(ctx, mask);
        if (prepared.bounds) bounds = { x: prepared.bounds.x * width / prepared.width, y: prepared.bounds.y * height / prepared.height, width: prepared.bounds.width * width / prepared.width, height: prepared.bounds.height * height / prepared.height };
        stats.bounds = bounds;
        if (bounds && input.centerX == null) base.centerX = bounds.x + bounds.width / 2;
        if (bounds && input.centerY == null) base.centerY = bounds.y + bounds.height / 2;
      }
      if (mode === 'contour' && !bounds) { stats.waiting = true; return stats; }
      stats.usesSubjectOutline = mode === 'contour' && !!bounds;
      const groups = Array.isArray(input.groups) && input.groups.length ? input.groups.slice(0, 6) : [{}];
      groups.forEach((group, groupIndex) => {
        const options = { ...base, ...group, color: color(group.color || group.textColor || base.color), phase: finite(group.phase, base.phase) };
        options.fontSize = clamp(finite(options.fontSize, base.fontSize), 4, Math.max(width, height));
        options.fontWeight = clamp(finite(options.fontWeight, base.fontWeight), 100, 1000);
        options.letterSpacing = clamp(finite(options.letterSpacing, base.letterSpacing), -10, 100);
        options.text = options.text == null ? base.text : String(options.text);
        options.centerX = finite(options.centerX, bounds ? bounds.x + bounds.width / 2 : base.centerX);
        options.centerY = finite(options.centerY, bounds ? bounds.y + bounds.height / 2 : base.centerY);
        if (mode === 'spiral') {
          const radius = clamp(finite(group.radiusX, base.radiusX), 1, Math.max(width, height) * 2);
          const points = spiralPath({ radius, turns: base.turns, centerX: options.centerX, centerY: options.centerY, phase: options.phase });
          paintPath(ctx, points, options, stats, false, groupIndex, 0);
        } else {
          const offsets = Array.from({ length: base.count }, (_, i) => base.gap + options.fontSize * .58 + i * Math.max(base.spacing, options.fontSize * 1.06));
          const paths = contourPaths(prepared, offsets, width, height);
          const originalX = bounds.x + bounds.width / 2, originalY = bounds.y + bounds.height / 2;
          const scale = clamp(finite(group.radiusScale, group.radiusX == null ? 1 : group.radiusX / base.radiusX), .35, 1.8);
          paths.forEach((points, index) => {
            const translated = points.map(p => ({ x: options.centerX + (p.x - originalX) * scale, y: options.centerY + (p.y - originalY) * scale }));
            paintPath(ctx, translated, options, stats, true, groupIndex, index);
          });
        }
      });
      return stats;
    } finally { ctx.restore(); }
  }

  function clearCaches() { maskCache = new WeakMap(); measureCache.clear(); styledCache.clear(); styledPixels=0; }
  return { render, clearCaches, traceAlpha, offsetContours, arcTable, pointAtLength, spiralPath, boundsOf, area };
});
