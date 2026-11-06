'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/contour.js');

function alpha(width, height, rectangles) {
  const data = new Uint8Array(width * height);
  for (const [x, y, w, h] of rectangles) for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) data[row * width + col] = 255;
  return data;
}
function imageData(data, width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  data.forEach((value, index) => { rgba[index * 4 + 3] = value; });
  return { data: rgba, width, height };
}
function fakeContext(width = 200, height = 240) {
  const painted = [];
  return {
    canvas: { width, height }, painted, font: '20px sans-serif',
    save() {}, restore() {}, setTransform() {}, clearRect() {}, scale() {}, translate() {}, rotate() {},
    measureText(text) { const size = Number((this.font.match(/([\d.]+)px/) || [0, 20])[1]); return { width: text.length * size * .58 }; },
    fillText(text) { painted.push({ text, font: this.font, color: this.fillStyle }); }
  };
}

test('trace follows an asymmetric stepped silhouette, not its bounds or an ellipse', () => {
  const data = alpha(40, 40, [[5, 4, 10, 28], [15, 22, 17, 10]]);
  const points = C.traceAlpha(data, 40, 40);
  assert.equal(C.area(points), 450);
  assert.deepEqual(C.boundsOf(points), { x: 5, y: 4, width: 27, height: 28 });
  assert(points.some(point => point.x === 15 && point.y === 22), 'concave elbow must appear on the path');
  assert(!points.some(point => point.x > 15 && point.y < 22), 'empty upper-right quadrant is not part of silhouette');
});

test('outer contour ignores holes and picks largest independent subject', () => {
  const data = alpha(60, 40, [[2, 2, 5, 5], [20, 8, 24, 26]]);
  for (let y = 15; y < 25; y++) for (let x = 28; x < 36; x++) data[y * 60 + x] = 0;
  const points = C.traceAlpha(data, 60, 40);
  assert.deepEqual(C.boundsOf(points), { x: 20, y: 8, width: 24, height: 26 });
  assert.equal(C.area(points), 24 * 26);
});

test('outward contours expand by requested distance and retain real concavity', () => {
  const data = alpha(80, 80, [[10, 10, 20, 60], [30, 45, 40, 25]]);
  const [first, second] = C.offsetContours(data, 80, 80, [2, 8]);
  const a = C.boundsOf(first), b = C.boundsOf(second);
  assert(Math.abs(a.x - 8) < 1, JSON.stringify(a));
  assert(Math.abs(b.x - 2) < 1, JSON.stringify(b));
  assert(b.width > a.width + 10 && b.height > a.height + 10);
  assert(first.some(point => point.x > 30 && point.x < 35 && point.y > 17 && point.y < 36), 'offset retains vertical concave arm');
  assert(first.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('empty masks produce no artificial path', () => {
  const data = new Uint8Array(20 * 20);
  assert.deepEqual(C.traceAlpha(data, 20, 20), []);
  assert.deepEqual(C.offsetContours(data, 20, 20, [0, 4]), [[], []]);
  const result = C.render(fakeContext(), imageData(data, 20, 20), { mode: 'contour', text: 'Hello' });
  assert.equal(result.waiting, true);
  assert.equal(result.glyphCount, 0);
});

test('arc lookup wraps closed paths and clamps open paths', () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const closed = C.arcTable(points);
  assert.equal(closed.length, 40);
  assert.deepEqual(C.pointAtLength(closed, 45), { x: 5, y: 0 });
  assert.deepEqual(C.pointAtLength(closed, -5), { x: 0, y: 5 });
  const open = C.arcTable(points, false);
  assert.equal(open.length, 30);
  assert.deepEqual(C.pointAtLength(open, 99), { x: 0, y: 10 });
});

test('flat spiral grows continuously and performs requested number of turns', () => {
  const path = C.spiralPath({ centerX: 50, centerY: 70, radius: 80, turns: 3, phase: .3 });
  const radii = path.map(point => Math.hypot(point.x - 50, point.y - 70));
  assert(Math.abs(radii[0] - 8) < 1e-9);
  assert(Math.abs(radii.at(-1) - 80) < 1e-9);
  assert(radii.every((r, i) => i === 0 || r > radii[i - 1]));
  let turns = 0;
  for (let i = 1; i < path.length; i++) {
    const a = Math.atan2(path[i - 1].y - 70, path[i - 1].x - 50), b = Math.atan2(path[i].y - 70, path[i].x - 50);
    turns += Math.atan2(Math.sin(b - a), Math.cos(b - a));
  }
  assert(Math.abs(turns / (Math.PI * 2) - 3) < 1e-9);
});

test('render uses actual mask for contour, supports multi rings/groups, colors and phase', () => {
  const data = alpha(100, 120, [[35, 15, 25, 90], [18, 40, 17, 20]]);
  const mask = imageData(data, 100, 120), ctx = fakeContext();
  const result = C.render(ctx, mask, {
    text: 'HELLO', mode: 'contour', fontSize: 10, count: 2, spacing: 15, gap: 3,
    centerX: 78, centerY: 120,
    groups: [{ text: 'FIRST', color: '#123456', phase: 0 }, { text: 'SECOND', color: '#654321', centerY: 130, phase: Math.PI }]
  });
  assert.equal(result.usesSubjectOutline, true);
  assert.equal(result.paths.length, 4);
  assert.equal(result.waiting, false);
  assert(result.glyphCount > 80);
  assert(result.glyphs.every(glyph => Number.isFinite(glyph.angle) && Number.isFinite(glyph.x) && Number.isFinite(glyph.y)));
  assert(ctx.painted.some(glyph => glyph.color === '#123456'));
  assert(ctx.painted.some(glyph => glyph.color === '#654321'));
  assert.equal(result.paths[2].group, 1);
});

test('spiral works without mask, font size changes with radius, contour waits honestly', () => {
  const ctx = fakeContext(400, 400);
  const spiral = C.render(ctx, null, { mode: 'spiral', text: 'AROUND YOU', fontSize: 30, turns: 4, radiusX: 150 });
  assert.equal(spiral.waiting, false);
  assert.equal(spiral.paths.length, 1);
  assert.equal(spiral.paths[0].closed, false);
  assert(spiral.glyphCount > 100);
  assert(spiral.glyphs[0].size < spiral.glyphs.at(-1).size * .5);
  const waiting = C.render(ctx, null, { mode: 'contour', text: 'AROUND YOU' });
  assert.equal(waiting.waiting, true);
  assert.equal(waiting.glyphCount, 0);
});


test('off-center subjects stay anchored to their actual silhouette unless explicitly repositioned', () => {
  const data = alpha(200, 240, [[22, 18, 35, 78], [57, 52, 22, 18]]);
  const mask = imageData(data, 200, 240), ctx = fakeContext();
  const result = C.render(ctx, mask, { mode: 'contour', text: 'FOLLOW', fontSize: 10, gap: 3 });
  const bounds = C.boundsOf(result.paths[0].points);
  assert(Math.abs(bounds.x + bounds.width / 2 - 50.5) < 2, JSON.stringify(bounds));
  assert(Math.abs(bounds.y + bounds.height / 2 - 57) < 2, JSON.stringify(bounds));
  const moved = C.render(ctx, mask, { mode: 'contour', text: 'FOLLOW', fontSize: 10, gap: 3, centerX: 100, centerY: 120 });
  const movedBounds = C.boundsOf(moved.paths[0].points);
  assert(Math.abs(movedBounds.x + movedBounds.width / 2 - 100) < 2);
  assert(Math.abs(movedBounds.y + movedBounds.height / 2 - 120) < 2);
});

test('isolated mask specks cannot grow into the subject contour', () => {
  const clean = alpha(100, 100, [[30, 30, 30, 50]]), noisy = clean.slice();
  noisy[40 * 100 + 69] = 255;
  const a = C.offsetContours(clean, 100, 100, [8])[0], b = C.offsetContours(noisy, 100, 100, [8])[0];
  assert.deepEqual(a, b);
});
