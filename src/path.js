(function (root, factory) {
  'use strict';
  const P = typeof module === 'object' && module.exports ? require('./projection.js') : root.KineticProjection;
  const api = factory(P);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KineticPath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P) {
  'use strict';
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const finite = (n, fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;
  const mod = (n, d) => ((n % d) + d) % d;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const geometryCache = new Map(), measurementCache = new Map(), glyphCache = new Map();
  const counters = { geometryBuilds: 0, measurementBuilds: 0, textureBuilds: 0 };
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const MAX_GLYPHS = 800, PIXEL_BUDGET = 4 * 1024 * 1024;
  let glyphPixels = 0;

  function cleanPoints(input, maximum = 4096) {
    if (!Array.isArray(input)) return [];
    const points = [];
    const stride = Math.max(1, Math.ceil(input.length / maximum));
    for (let i = 0; i < input.length; i += stride) {
      const p = input[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const next = { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
      if (!points.length || distance(points[points.length - 1], next) > 1e-7) points.push(next);
    }
    const last = input[input.length - 1];
    if (last && Number.isFinite(last.x) && Number.isFinite(last.y)) {
      const end = { x: clamp(last.x, 0, 1), y: clamp(last.y, 0, 1) };
      if (!points.length || distance(points[points.length - 1], end) > 1e-7) points.push(end);
    }
    return points;
  }
  function segmentDistanceSquared(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / length, 0, 1) : 0;
    return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
  }
  function simplify(input, tolerance = .002, maximum = 256) {
    const points = cleanPoints(input), count = points.length;
    if (count < 3) return points;
    const threshold = Math.max(0, finite(tolerance, .002)) ** 2;
    const keep = new Uint8Array(count), stack = [[0, count - 1]];
    keep[0] = keep[count - 1] = 1;
    while (stack.length) {
      const [first, last] = stack.pop(); let best = threshold, index = -1;
      for (let i = first + 1; i < last; i++) {
        const d = segmentDistanceSquared(points[i], points[first], points[last]);
        if (d > best) { best = d; index = i; }
      }
      if (index !== -1) { keep[index] = 1; stack.push([first, index], [index, last]); }
    }
    const result = points.filter((_, i) => keep[i]);
    const cap = clamp(Math.floor(finite(maximum, 256)), 2, 256);
    if (result.length <= cap) return result;
    return Array.from({ length: cap }, (_, i) => result[Math.round(i * (result.length - 1) / (cap - 1))]);
  }

  function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  // Centripetal Catmull–Rom avoids the loops produced by uniform splines when
  // a finger pauses and creates unevenly spaced samples. Open ends extrapolate.
  function curve(p0, p1, p2, p3, u) {
    const t0 = 0, t1 = Math.sqrt(distance(p0, p1)), t2 = t1 + Math.sqrt(distance(p1, p2)), t3 = t2 + Math.sqrt(distance(p2, p3));
    const t = t1 + u * (t2 - t1);
    const between = (a, b, ta, tb) => lerp(a, b, (t - ta) / Math.max(1e-7, tb - ta));
    const a1 = between(p0, p1, t0, t1), a2 = between(p1, p2, t1, t2), a3 = between(p2, p3, t2, t3);
    const b1 = between(a1, a2, t0, t2), b2 = between(a2, a3, t1, t3);
    return between(b1, b2, t1, t2);
  }
  function prepare(input, width = 900, height = 1200, requestedClosed = false) {
    const clean = cleanPoints(input, 255);
    const normalized = clean.length <= 256 ? clean : Array.from({ length: 256 }, (_, i) => clean[Math.round(i * (clean.length - 1) / 255)]);
    width = clamp(finite(width, 900), 1, 16384); height = clamp(finite(height, 1200), 1, 16384);
    if (requestedClosed && normalized.length > 2 && distance(normalized[0], normalized[normalized.length - 1]) < 1e-5) normalized.pop();
    const closed = requestedClosed === true && normalized.length > 2;
    const key = JSON.stringify([width, height, closed, normalized]);
    if (geometryCache.has(key)) { const hit = geometryCache.get(key); geometryCache.delete(key); geometryCache.set(key, hit); return hit; }
    const original = normalized.map(p => ({ x: p.x * width, y: p.y * height })), points = [];
    const count = original.length, segments = closed ? count : count - 1;
    if (count === 1) points.push(original[0]);
    for (let i = 0; i < segments; i++) {
      const p1 = original[i], p2 = original[(i + 1) % count];
      const p0 = i ? original[i - 1] : closed ? original[count - 1] : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
      const p3 = i + 2 < count ? original[i + 2] : closed ? original[(i + 2) % count] : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y };
      const steps = clamp(Math.ceil(distance(p1, p2) / 5), 4, 32);
      for (let j = 0; j < steps; j++) {
        const p = curve(p0, p1, p2, p3, j / steps);
        p.x = clamp(p.x, 0, width); p.y = clamp(p.y, 0, height);
        if (!points.length || distance(points[points.length - 1], p) > 1e-5) points.push(p);
      }
    }
    if (count > 1) points.push(closed ? { ...points[0] } : original[count - 1]);
    const cumulative = [0]; let length = 0;
    for (let i = 1; i < points.length; i++) { length += distance(points[i - 1], points[i]); cumulative.push(length); }
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const bounds = points.length ? { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } : null;
    points.forEach(Object.freeze);
    const result = Object.freeze({ points: Object.freeze(points), cumulative: Object.freeze(cumulative), length, closed, bounds: bounds && Object.freeze(bounds) });
    if (geometryCache.size >= 8) geometryCache.delete(geometryCache.keys().next().value);
    geometryCache.set(key, result); counters.geometryBuilds++;
    return result;
  }
  function pointAt(path, value) {
    const { points, cumulative, length, closed } = path;
    if (!points.length) return null;
    if (points.length < 2 || length < 1e-7) return { ...points[0] };
    const d = closed ? mod(value, length) : clamp(value, 0, length);
    let lo = 0, hi = cumulative.length - 1;
    while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] <= d) lo = mid; else hi = mid; }
    return lerp(points[lo], points[hi], (d - cumulative[lo]) / Math.max(1e-7, cumulative[hi] - cumulative[lo]));
  }
  function sample(path, value, tangentDistance = 2) {
    const p = pointAt(path, value);
    if (!p) return null;
    const delta = Math.max(.01, Math.min(path.length / 4, finite(tangentDistance, 2)));
    const before = pointAt(path, value - delta), after = pointAt(path, value + delta);
    return { ...p, angle: Math.atan2(after.y - before.y, after.x - before.x) };
  }
  function measure(ctx, text, font, spacing) {
    const key = JSON.stringify([text, font, spacing]);
    if (measurementCache.has(key)) return measurementCache.get(key);
    const chars = segmenter ? Array.from(segmenter.segment(text), p => p.segment) : Array.from(text);
    ctx.font = font;
    const glyphs = chars.slice(0, 500).map(char => { const width = ctx.measureText(char).width; return { char, width, advance: Math.max(1, width + spacing) }; });
    const result = { glyphs, length: glyphs.reduce((n, g) => n + g.advance, 0) };
    if (measurementCache.size >= 64) measurementCache.delete(measurementCache.keys().next().value);
    measurementCache.set(key, result); counters.measurementBuilds++;
    return result;
  }
  function surface(ctx, width, height) {
    const owner = ctx.canvas && ctx.canvas.ownerDocument;
    const tile = owner ? owner.createElement('canvas') : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : null;
    if (!tile) return null;
    tile.width = Math.max(1, Math.ceil(width)); tile.height = Math.max(1, Math.ceil(height)); return tile;
  }
  function texture(ctx, glyph, font, fontSize, style) {
    const keys = ['textStrokeEnabled', 'textStrokeWidth', 'textStrokeColor', 'textGlowEnabled', 'textGlow', 'textGlowColor', 'textShadowEnabled', 'textShadowBlur', 'textShadowX', 'textShadowY', 'textShadowColor', 'textShadowOpacity'];
    const key = JSON.stringify([glyph.char, font, style.color, ...keys.map(k => style[k])]);
    if (glyphCache.has(key)) { const hit = glyphCache.get(key); glyphCache.delete(key); glyphCache.set(key, hit); return hit; }
    const pad = Math.max(Math.ceil(fontSize * .3), P.stylePadding(style)), tile = surface(ctx, glyph.width + pad * 2, fontSize * 1.8 + pad * 2);
    if (!tile) return null;
    const tc = tile.getContext('2d'); tc.font = font; tc.fillStyle = style.color; tc.textAlign = 'left'; tc.textBaseline = 'middle';
    P.paintStyledText(tc, glyph.char, pad, tile.height / 2, style);
    const result = { tile, x: -glyph.width / 2 - pad, y: -tile.height / 2 }, pixels = tile.width * tile.height;
    while (glyphCache.size && (glyphCache.size >= 512 || glyphPixels + pixels > PIXEL_BUDGET)) {
      const first = glyphCache.keys().next().value, entry = glyphCache.get(first); glyphPixels -= entry.tile.width * entry.tile.height; glyphCache.delete(first);
    }
    if (pixels <= PIXEL_BUDGET) { glyphCache.set(key, result); glyphPixels += pixels; }
    counters.textureBuilds++; return result;
  }
  function render(ctx, input = {}) {
    if (!ctx || typeof ctx.fillText !== 'function') throw new TypeError('A Canvas 2D context is required for path text.');
    const width = clamp(finite(input.width, 900), 1, 16384), height = clamp(finite(input.height, 1200), 1, 16384);
    const path = prepare(input.points, width, height, input.closed);
    const stats = { mode: 'customPath', waiting: path.length < 2, glyphCount: 0, pathLength: path.length, closed: path.closed, glyphs: [], limited: false };
    if (stats.waiting) return stats;
    const rawText = String(input.text == null ? '' : input.text).replace(/[\r\n\t]+/g, ' ').slice(0, 1000);
    if (!rawText.trim()) return stats;
    const fontSize = clamp(finite(input.fontSize, 64), 1, 4096), weight = clamp(finite(input.fontWeight, 700), 100, 950);
    const font = `${weight} ${fontSize}px ${input.fontFamily || 'sans-serif'}`, spacing = clamp(finite(input.spacing, 2), 0, Math.max(width, height));
    const repeat = input.repeat !== false, phrase = rawText + (repeat && !/\s$/.test(rawText) ? ' ' : '');
    const style = { ...P.textStyle(), ...input, color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : '#ffffff' };
    const styled = style.textStrokeEnabled || style.textGlowEnabled || style.textShadowEnabled;
    const motion = input.motion === true, speed = clamp(finite(input.speed, 48), 0, 100);
    const movement = motion ? Math.max(0, finite(input.time, 0)) * speed * .003 * Math.min(width, height) * (input.direction === 'reverse' ? -1 : 1) : 0;
    const phase = clamp(finite(input.phase, 0), 0, 100) / 100;
    ctx.save();
    try {
      ctx.font = font; ctx.fillStyle = style.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const measured = measure(ctx, phrase, font, spacing), glyphs = measured.glyphs;
      if (!glyphs.length || measured.length < 1) return stats;
      const placements = [];
      if (path.closed && measured.length <= path.length) {
        // A fixed set of letters circulates around a closed loop. Keeping the
        // same slots also avoids characters changing at the seam each frame.
        let cursor = 0, index = 0;
        while (index < MAX_GLYPHS && (repeat || index < glyphs.length)) {
          const glyph = glyphs[index % glyphs.length];
          if (cursor + glyph.width / 2 > path.length) break;
          placements.push({ glyph, distance: mod(cursor + glyph.width / 2 + phase * path.length + movement, path.length) });
          cursor += glyph.advance; index++;
        }
        stats.limited = index >= MAX_GLYPHS && cursor < path.length;
      } else if (repeat) {
        // A phrase longer than a closed path also uses this moving window:
        // later characters enter at the seam instead of being permanently cut.
        const offset = mod(phase * path.length + movement, measured.length);
        let cursor = offset - measured.length, index = 0;
        while (cursor <= path.length && index < MAX_GLYPHS + glyphs.length) {
          const glyph = glyphs[index % glyphs.length], center = cursor + glyph.width / 2;
          if (center >= 0 && center <= path.length) placements.push({ glyph, distance: center });
          cursor += glyph.advance; index++;
          if (placements.length >= MAX_GLYPHS) { stats.limited = cursor < path.length; break; }
        }
      } else {
        const cycle = path.length + measured.length;
        let cursor = motion && speed > 0 ? mod(phase * path.length + movement + measured.length, cycle) - measured.length : phase * path.length;
        for (const glyph of glyphs) { const center = cursor + glyph.width / 2; if (center >= 0 && center <= path.length) placements.push({ glyph, distance: center }); cursor += glyph.advance; }
      }
      for (const item of placements) {
        if (!item.glyph.char.trim()) continue;
        const point = sample(path, item.distance, Math.max(1, Math.min(fontSize * .22, item.glyph.advance * .45)));
        ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(point.angle);
        if (styled) {
          const bitmap = texture(ctx, item.glyph, font, fontSize, style);
          if (bitmap) ctx.drawImage(bitmap.tile, bitmap.x, bitmap.y);
          else P.paintStyledText(ctx, item.glyph.char, 0, 0, style);
        } else ctx.fillText(item.glyph.char, 0, 0);
        ctx.restore(); stats.glyphCount++;
        stats.glyphs.push({ char: item.glyph.char, x: point.x, y: point.y, angle: point.angle, distance: item.distance });
      }
      return stats;
    } finally { ctx.restore(); }
  }
  function clearCaches() { geometryCache.clear(); measurementCache.clear(); glyphCache.clear(); glyphPixels = 0; Object.keys(counters).forEach(k => { counters[k] = 0; }); }
  return Object.freeze({ simplify, prepare, sample, render, clearCaches, diagnostics: () => ({ ...counters, geometryEntries: geometryCache.size, measurementEntries: measurementCache.size, glyphEntries: glyphCache.size, glyphPixels }), MAX_GLYPHS });
});
