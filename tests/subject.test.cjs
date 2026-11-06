const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup() {
  let lastEncoded;
  function createCanvas() {
    const surface = { width: 1, height: 1 };
    let source, output;
    surface.getContext = () => ({
      drawImage(image) { source = image; },
      getImageData() { return { width: surface.width, height: surface.height, data: new Uint8ClampedArray(source.data) }; },
      createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
      putImageData(image) { output = image; }
    });
    surface.toDataURL = () => { lastEncoded = output; return 'data:image/png;base64,TEST'; };
    return surface;
  }
  const window = { addEventListener() {}, location: { protocol: 'https:' } };
  const document = { currentScript: { src: 'https://local.example/src/subject.js' }, baseURI: 'https://local.example/', createElement: createCanvas };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/subject.js'), 'utf8'), { window, document, URL, DOMException, Uint8Array, Uint8ClampedArray, Float32Array, setTimeout, clearTimeout });
  return { subject: window.KineticSubject, encoded: () => lastEncoded };
}
function photo(fn) {
  const width = 20, height = 20, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[(y * width + x) * 4 + 3] = fn(x, y);
  return { width, height, data };
}
test('opaque images and empty alpha do not manufacture a subject', () => {
  const { subject } = setup();
  assert.equal(subject.fromAlpha(photo(() => 255)), null);
  assert.equal(subject.fromAlpha(photo(() => 0)), null);
});
test('transparent padding around a rectangular photograph is not a cutout', () => {
  const { subject } = setup();
  assert.equal(subject.fromAlpha(photo((x,y) => x >= 3 && x <= 16 && y >= 2 && y <= 17 ? 255 : 0)), null);
});
test('real alpha preserves edges and bounds without classifying RGB colors', () => {
  const { subject, encoded } = setup();
  const image = photo((x,y) => Math.abs(x - 10) + Math.abs(y - 10) < 7 ? 255 : Math.abs(x - 10) + Math.abs(y - 10) === 7 ? 90 : 0);
  const result = subject.fromAlpha(image);
  assert.equal(result.source, 'alpha');
  assert.equal(result.bounds.x, .2);
  assert.equal(result.bounds.y, .2);
  assert.equal(result.bounds.width, .65);
  assert.equal(result.bounds.height, .65);
  for (let i=0;i<400;i++) {
    assert.equal(encoded().data[i*4+3], image.data[i*4+3]);
    assert.equal(encoded().data[i*4],255);
  }
});
test('missing source dimensions fail explicitly', () => {
  assert.throws(() => setup().subject.fromAlpha({width:0,height:0}), /可读取的图片/);
});
