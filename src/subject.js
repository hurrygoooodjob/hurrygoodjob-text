/* Point-guided, on-device subject selection. No photo or mask is transmitted. */
(function (global) {
  'use strict';
  const scriptURL = document.currentScript && document.currentScript.src;
  const rootURL = scriptURL ? new URL('../', scriptURL) : new URL('./', document.baseURI);
  const asset = path => new URL('assets/' + path, rootURL).href;
  const MAX_EDGE = 768;
  let worker = null, workerUnavailable = false, requestSequence = 0;
  let directTask = null, directLoading = null, queue = Promise.resolve();
  const pending = new Map();
  const clamp = value => Math.max(0, Math.min(1, Number(value)));
  const abortError = () => new DOMException('主体识别已取消。', 'AbortError');
  function report(callback, text) { if (typeof callback === 'function') callback(text); }
  function dimensions(source) {
    const width = Number(source && (source.naturalWidth || source.width));
    const height = Number(source && (source.naturalHeight || source.height));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error('请先放入一张可读取的图片。');
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }
  function pixels(source) {
    const size = dimensions(source), canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('此浏览器无法读取图片像素，请尝试更新浏览器。');
    context.drawImage(source, 0, 0, size.width, size.height);
    const result = context.getImageData(0, 0, size.width, size.height);
    canvas.width = canvas.height = 1;
    return result;
  }
  function encodeMask(width, height, alpha, kind) {
    let left = width, top = height, right = -1, bottom = -1, foreground = 0;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'), output = ctx.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      const value = Math.max(0, Math.min(255, Math.round(alpha[i])));
      output.data[i * 4] = output.data[i * 4 + 1] = output.data[i * 4 + 2] = 255;
      output.data[i * 4 + 3] = value;
      if (value > 127) {
        foreground++; const x = i % width, y = Math.floor(i / width);
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    if (foreground < Math.max(4, width * height * .0005) || foreground > width * height * .995) {
      canvas.width = canvas.height = 1;
      throw new Error('还没有选中清楚的主体，请点在人物或物体的内部再试一次。');
    }
    ctx.putImageData(output, 0, 0);
    const dataURL = canvas.toDataURL('image/png'); canvas.width = canvas.height = 1;
    return { dataURL, bounds: { x: left / width, y: top / height, width: (right - left + 1) / width, height: (bottom - top + 1) / height }, source: kind };
  }
  function fromAlpha(source) {
    const image = pixels(source), n = image.width * image.height, alpha = new Uint8Array(n);
    let transparent = 0, solid = 0, left = image.width, top = image.height, right = -1, bottom = -1;
    for (let i = 0; i < n; i++) {
      const a = image.data[i * 4 + 3]; alpha[i] = a;
      if (a < 8) transparent++;
      if (a > 127) { solid++; const x = i % image.width, y = Math.floor(i / image.width); left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
    // Transparent margins around an opaque rectangular photograph are not a subject mask.
    const boxArea = Math.max(1, (right - left + 1) * (bottom - top + 1));
    if (transparent < n * .01 || solid < n * .001 || solid / boxArea > .985) return null;
    return encodeMask(image.width, image.height, alpha, 'alpha');
  }
  function rejectWorker(error) {
    for (const operation of pending.values()) { clearTimeout(operation.timer); operation.reject(error); }
    pending.clear();
    if (worker) worker.terminate(); worker = null; workerUnavailable = true;
  }
  function getWorker() {
    if (worker) return worker;
    if (workerUnavailable || typeof global.Worker !== 'function' || typeof global.OffscreenCanvas !== 'function') return null;
    try {
      worker = new Worker(asset('vendor/subject-worker.js'), { type: 'module', name: 'hgj-subject' });
      worker.onmessage = event => {
        const data = event.data, operation = pending.get(data.id);
        if (!operation) return;
        if (data.type === 'progress') { report(operation.onProgress, data.message); return; }
        pending.delete(data.id); clearTimeout(operation.timer);
        if (data.type === 'error') operation.reject(new Error(data.message)); else operation.resolve(data);
      };
      worker.onerror = event => { event.preventDefault(); rejectWorker(new Error('后台识别组件未能启动。')); };
      return worker;
    } catch (_) { workerUnavailable = true; return null; }
  }
  async function workerSegment(image, point, onProgress) {
    const target = getWorker();
    if (!target) return null;
    const id = ++requestSequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => rejectWorker(new Error('主体识别超时，请刷新后重试。')), 90000);
      pending.set(id, { resolve, reject, timer, onProgress });
      // Keep the caller buffer intact for a CPU fallback if Worker initialization fails.
      target.postMessage({ id, width: image.width, height: image.height, rgba: image.data.buffer, point });
    });
  }
  async function getDirectTask(onProgress) {
    if (directTask) return directTask;
    if (!directLoading) directLoading = (async () => {
      report(onProgress, '正在加载本机主体识别组件…');
      const vision = await import(asset('vendor/mediapipe-1.2.2/vision_bundle.mjs'));
      const files = await vision.FilesetResolver.forVisionTasks(asset('vendor/mediapipe-1.2.2/wasm'));
      directTask = await vision.InteractiveSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: asset('models/magic-touch-v2-int8-1.task'), delegate: 'CPU' } });
      return directTask;
    })().catch(error => { directLoading = null; throw error; });
    return directLoading;
  }
  async function directSegment(image, point, onProgress) {
    const task = await getDirectTask(onProgress);
    report(onProgress, '正在本机识别主体…');
    await new Promise(resolve => setTimeout(resolve, 0));
    task.setImage(image);
    const mask = task.segment([{ brushMode: 1, point: [point], isCompleted: true }]);
    try { return { width: mask.width, height: mask.height, values: new Float32Array(mask.getAsFloat32Array()) }; }
    finally { mask.close(); }
  }
  async function run(source, point, options) {
    if (global.location && global.location.protocol === 'file:') throw new Error('主体识别需要通过编辑器网页链接打开；直接打开 HTML 文件仍可使用其他编辑功能。');
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) throw new Error('请在图片中的主体上点一下。');
    const where = { x: clamp(point.x), y: clamp(point.y) }, image = pixels(source);
    if (options.signal && options.signal.aborted) throw abortError();
    report(options.onProgress, '正在准备本机主体识别…');
    let result;
    try { result = await workerSegment(image, where, options.onProgress); }
    catch (error) {
      if (!workerUnavailable) throw error;
      report(options.onProgress, '正在使用兼容方式识别主体…');
    }
    if (!result) result = await directSegment(image, where, options.onProgress);
    if (options.signal && options.signal.aborted) throw abortError();
    const values = result.values instanceof Float32Array ? result.values : new Float32Array(result.values);
    const n = result.width * result.height;
    if (values.length !== n || !n) throw new Error('主体识别没有返回可用结果，请重新点选。');
    const alpha = new Uint8Array(n);
    for (let i = 0; i < n; i++) alpha[i] = Math.round(clamp((values[i] - .35) / .30) * 255);
    return encodeMask(result.width, result.height, alpha, 'model');
  }
  function segment(source, point, options = {}) {
    // Keep stateful model access serial; an earlier failure must not poison the queue.
    const operation = queue.catch(() => {}).then(() => run(source, point, options)).catch(error => {
      if (error.name === 'AbortError') throw error;
      if (/主体|图片|浏览器|HTML/.test(error.message)) throw error;
      console.warn('Subject selection failed:', error && error.message);
      throw new Error('主体识别组件暂时不可用，请确认已完整打开编辑器文件夹后重试。', { cause: error });
    });
    queue = operation; return operation;
  }
  function dispose() {
    rejectWorker(abortError()); workerUnavailable = false;
    if (directTask) directTask.close(); directTask = directLoading = null;
  }
  global.addEventListener('pagehide', event => { if (!event.persisted) dispose(); });
  global.KineticSubject = Object.freeze({ segment, fromAlpha, dispose, maxEdge: MAX_EDGE });
})(window);
