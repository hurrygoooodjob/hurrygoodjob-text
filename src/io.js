(function (global) {
  'use strict';

  const Model = global.KineticModel;
  if (!Model) throw new Error('Load the document model before file tools.');
  const FORMAT = 'kinetic-type-studio';
  const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
  const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
  const DATABASE_NAME = 'hurrygoodjob-text-v10';
  const DRAFT_KEY = 'hurrygoodjob-text.v10.draft';
  const LEGACY_DRAFTS = [
    ['hurrygoodjob-text-v9', 'hurrygoodjob-text.v9.draft'],
    ['hurrygoodjob-text-v8', 'hurrygoodjob-text.v8.draft'],
    ['hurrygoodjob-text-v7', 'hurrygoodjob-text.v7.draft'],
    ['hurrygoodjob-text-v6', 'hurrygoodjob-text.v6.draft'],
    ['kinetic-type-studio-mobile-v1', 'kinetic-type-studio.mobile.v1.draft'],
    ['kinetic-type-studio-v4', 'kinetic-type-studio.v4.draft'],
    ['kinetic-type-studio-v3', 'kinetic-type-studio.v3.draft'],
    ['kinetic-type-studio-v2', 'kinetic-type-studio.v2.draft']
  ];
  const VIDEO_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1.42E01E', 'video/mp4'];
  const databasePromises = new Map();

  const own = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };

  function validateImages(images) {
    if (!Array.isArray(images)) throw new Error('项目图片必须是最多9张的列表。');
    if (images.length > Model.MAX_IMAGES) throw new Error('一个项目最多容纳9张图片。');
    let total = 0;
    images.forEach(function (item) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !own(item, 'dataURL') || !item.dataURL || !Model.isImageData(item.dataURL) || (own(item, 'name') && typeof item.name !== 'string')) {
        throw new Error('项目中有无效或过大的图片。请使用编辑器导出的项目。');
      }
      total += item.dataURL.length;
    });
    if (total > Model.IMAGES_DATA_LIMIT) throw new Error('图片总数据超过48MB，请减少图片或缩小尺寸。');
  }

  function validateMask(source) {
    if (!source || !own(source, 'subjectMask') || source.subjectMask === '') return;
    if (typeof source.subjectMask !== 'string' || source.subjectMask.length > (Model.SUBJECT_MASK_LIMIT || 4 * 1024 * 1024) || !/^data:image\/png;base64,/.test(source.subjectMask) || !Model.isImageData(source.subjectMask)) {
      throw new Error('项目中的主体蒙版无效，请使用编辑器保存的 PNG 蒙版。');
    }
  }

  function validateGroups(source) {
    if (!source || !own(source, 'ringGroups')) return;
    if (!Array.isArray(source.ringGroups) || source.ringGroups.length > 6 || source.ringGroups.some(g => !g || typeof g !== 'object' || Array.isArray(g) || typeof g.text !== 'string' || g.text.length > 500)) throw new Error('文字组必须为最多6组，每组最多500字。');
  }

  function serialize(state) {
    validateGroups(state);
    validateMask(state);
    if (state && own(state, 'images')) validateImages(state.images);
    const document = Model.normalize(state);
    // v4 embeds each photo once. These first-image aliases are runtime-only.
    delete document.imageData;
    delete document.imageName;
    return JSON.stringify({ format: FORMAT, version: 10, state: document }, null, 2);
  }

  function parse(text) {
    if (typeof text !== 'string' || text.length > MAX_PROJECT_BYTES || new global.Blob([text]).size > MAX_PROJECT_BYTES) throw new Error('项目过大，请选择64MB以内的文件。');
    let payload;
    try { payload = JSON.parse(text); } catch (_) { throw new Error('文件格式不正确，请选择编辑器保存的工程文件。'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('这不是可读取的图片文字工程。');
    let source = payload;
    if (Object.prototype.hasOwnProperty.call(payload, 'state') || Object.prototype.hasOwnProperty.call(payload, 'format') || Object.prototype.hasOwnProperty.call(payload, 'version')) {
      if (payload.format !== FORMAT || ![2, 3, 4, 5, 6, 7, 8, 9, 10].includes(payload.version)) throw new Error('暂不支持这个工程版本；支持版本2至10。');
      source = payload.state;
    }
    if (!source || typeof source !== 'object' || Array.isArray(source) || typeof source.text !== 'string' || typeof source.template !== 'string') throw new Error('项目缺少必要的文字或效果信息。');
    if (own(source, 'images')) validateImages(source.images);
    else if (own(source, 'imageData') && !Model.isImageData(source.imageData)) throw new Error('项目中的图片无效或过大。');
    validateMask(source);
    validateGroups(source);
    return Model.normalize(source);
  }

  function imageFromURL(url) {
    return new Promise(function (resolve, reject) {
      const image = new global.Image();
      let timer;
      const cleanup = function () { clearTimeout(timer); image.onload = null; image.onerror = null; };
      image.onload = function () {
        cleanup();
        if (!image.naturalWidth || !image.naturalHeight) reject(new Error('图片没有可读取的像素。'));
        else resolve(image);
      };
      image.onerror = function () { cleanup(); reject(new Error('图片无法打开，请尝试PNG、JPEG或WebP格式。')); };
      timer = setTimeout(function () { cleanup(); image.src = ''; reject(new Error('读取图片超时，请尝试较小的文件。')); }, 20000);
      image.src = url;
    });
  }

  async function decodeImage(dataURL) {
    if (!dataURL) return null;
    if (!Model.isImageData(dataURL)) throw new Error('保存的图片无效或过大。');
    return imageFromURL(dataURL);
  }

  async function decodeImages(images) {
    validateImages(images);
    const decoded = [];
    // Decode serially so nine high-resolution uploads do not peak together.
    for (const item of images) decoded.push(await decodeImage(item.dataURL));
    return decoded;
  }

  function makeCanvas(width, height) {
    const canvas = global.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  async function loadImage(file) {
    if (!file || !/^image\/(?:png|jpe?g|webp|gif|avif)$/i.test(file.type || '')) throw new Error('请选择PNG、JPEG、WebP、GIF或AVIF图片。');
    if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error('请选择25MB以内的有效图片。');
    const url = global.URL.createObjectURL(file);
    let original;
    try { original = await imageFromURL(url); } finally { global.URL.revokeObjectURL(url); }
    if (original.naturalWidth * original.naturalHeight > 100000000) throw new Error('图片分辨率过高，请先缩小到1亿像素以内。');
    // This edition optimizes newly selected photos for phone memory. Imported
    // projects retain their saved pixels and remain compatible with desktop.
    const ratio = Math.min(1, 1600 / Math.max(original.naturalWidth, original.naturalHeight));
    const width = Math.max(1, Math.round(original.naturalWidth * ratio));
    const height = Math.max(1, Math.round(original.naturalHeight * ratio));
    const canvas = makeCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法处理图片，请重新打开页面后重试。');
    context.drawImage(original, 0, 0, width, height);
    const dataURL = canvas.toDataURL('image/webp', 0.92);
    canvas.width = canvas.height = 1;
    if (!Model.isImageData(dataURL)) throw new Error('图片数据过大，无法存入工程，请使用较小的图片。');
    const image = await decodeImage(dataURL);
    const warnings = [];
    if (ratio < 1) warnings.push('图片已优化到 ' + width + ' × ' + height + ' 像素，工程保存优化后的图片。');
    if (/gif/i.test(file.type)) warnings.push('GIF将使用第一帧作为照片。');
    return { image: image, dataURL: dataURL, name: String(file.name || '未命名图片').slice(0, 255), warning: warnings.join(' ') };
  }

  function openDatabase(name, legacyReadOnly) {
    name = name || DATABASE_NAME;
    if (databasePromises.has(name)) return databasePromises.get(name);
    const databasePromise = new Promise(function (resolve, reject) {
      let request;
      let settled = false;
      const timer = setTimeout(function () { settled = true; reject(new Error('本机草稿暂不可用。')); }, 3000);
      try { request = global.indexedDB.open(name, 1); }
      catch (error) { clearTimeout(timer); reject(error); return; }
      request.onupgradeneeded = function () {
        // Opening a missing legacy database would otherwise create it. Abort
        // that upgrade: migration never creates or writes an older database.
        if (legacyReadOnly) { request.transaction.abort(); return; }
        if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts');
      };
      request.onsuccess = function () {
        if (settled) { request.result.close(); return; }
        settled = true;
        clearTimeout(timer);
        const database = request.result;
        database.onversionchange = function () { database.close(); databasePromises.delete(name); };
        resolve(database);
      };
      request.onerror = function () { if (!settled) { settled = true; clearTimeout(timer); reject(request.error); } };
      request.onblocked = function () { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('本机草稿正在使用中。')); } };
    }).catch(function (error) { databasePromises.delete(name); throw error; });
    databasePromises.set(name, databasePromise);
    return databasePromise;
  }

  function transact(database, mode, value) {
    return new Promise(function (resolve, reject) {
      const transaction = database.transaction('drafts', mode);
      const store = transaction.objectStore('drafts');
      const request = mode === 'readwrite' ? store.put(value, 'current') : store.get('current');
      transaction.oncomplete = function () { resolve(request.result); };
      transaction.onerror = function () { reject(transaction.error || new Error('本机存储失败。')); };
      transaction.onabort = function () { reject(transaction.error || new Error('本机存储被中断。')); };
    });
  }

  async function saveDraft(state) {
    const entry = { savedAt: Date.now(), json: serialize(state) };
    try {
      await transact(await openDatabase(), 'readwrite', entry);
      // A previous fallback can otherwise resurrect an obsolete document.
      try { global.localStorage.removeItem(DRAFT_KEY); } catch (_) { /* IndexedDB already holds the draft. */ }
      return { ok: true, reason: '已保存在这台设备。' };
    } catch (_) {
      try {
        global.localStorage.setItem(DRAFT_KEY, JSON.stringify(entry));
        return { ok: true, reason: '已保存在这台设备。' };
      } catch (_) { return { ok: false, reason: '本机草稿不可用或空间不足，请保存工程文件。' }; }
    }
  }

  async function readDraft(name, key, legacyReadOnly) {
    const candidates = [];
    try { const value = await transact(await openDatabase(name, legacyReadOnly), 'readonly'); if (value) candidates.push(value); } catch (_) { /* Fallback below. */ }
    try { const value = global.localStorage.getItem(key); if (value) candidates.push(JSON.parse(value)); } catch (_) { /* No readable fallback. */ }
    candidates.sort(function (a, b) { return (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0); });
    for (const entry of candidates) {
      try { return parse(entry.json); } catch (_) { /* Try the next intact saved draft. */ }
    }
    return null;
  }

  async function loadDraft(options = {}) {
    // Version precedence is deliberate: an older app left open cannot replace
    // current work just by saving later. Migration reads, but never writes,
    // desktop v4/v3/v2. Mobile saves have a separate storage namespace.
    const current = await readDraft(DATABASE_NAME, DRAFT_KEY, false);
    if (current) return current;
    if (!options.includeLegacy) return null;
    for (const legacy of LEGACY_DRAFTS) {
      const draft = await readDraft(legacy[0], legacy[1], true);
      if (draft) return draft;
    }
    return null;
  }

  async function fontsReady() {
    if (global.document.fonts && global.document.fonts.ready) await global.document.fonts.ready;
  }

  function canvasBlob(canvas, type) {
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (blob) {
          if (blob && blob.size) resolve(blob);
          else reject(new Error('浏览器未能生成图片，请尝试较小的画布。'));
        }, type);
      } catch (_) { reject(new Error('图片无法导出，请重新打开图片后重试。')); }
    });
  }

  async function exportPNG(options) {
    const state = Model.normalize(options.state);
    const image = options.image || null;
    const requested = options.scale === undefined ? 1 : Number(options.scale);
    if (!Number.isFinite(requested) || requested < 1 || requested > 3) throw new Error('请选择1至3倍的导出尺寸。');
    const width = Math.round(state.width * requested);
    const height = Math.round(state.height * requested);
    const maxPixels = options.maxPixels === undefined ? 24000000 : Math.min(24000000, Number(options.maxPixels));
    if (!Number.isFinite(maxPixels) || maxPixels < 1) throw new Error('导出尺寸限制无效。');
    if (width * height > maxPixels) throw new Error('导出超过 ' + (maxPixels / 1000000) + ' 百万像素限制，请减小画布。');
    const canvas = makeCanvas(width, height);
    try {
      await fontsReady();
      options.render(canvas, state, state.frame, image);
      return await canvasBlob(canvas, 'image/png');
    } finally { canvas.width = canvas.height = 1; }
  }

  function cancelled() {
    const error = new Error('视频导出已取消。');
    error.name = 'AbortError';
    return error;
  }

  function supportedVideoType() {
    if (typeof global.MediaRecorder !== 'function' || typeof global.MediaRecorder.isTypeSupported !== 'function') return '';
    return VIDEO_TYPES.find(function (type) {
      try { return global.MediaRecorder.isTypeSupported(type); } catch (_) { return false; }
    }) || '';
  }

  function canExportVideo() {
    if (!supportedVideoType()) return false;
    try {
      const canvas = makeCanvas(1, 1);
      return typeof canvas.captureStream === 'function';
    } catch (_) { return false; }
  }

  async function exportVideo(options) {
    const state = Model.normalize(options.state);
    if (state.mode !== 'motion') throw new Error('请先开启动态播放，再生成视频。');
    if (!global.MediaRecorder) throw new Error('当前浏览器无法导出视频，可保存PNG图片。');
    if (options.signal && options.signal.aborted) throw cancelled();
    if (state.backgroundMode === 'none') state.backgroundMode = 'color';
    const image = options.image || null;
    const canvas = makeCanvas(state.width, state.height);
    if (!canvas.captureStream) throw new Error('当前浏览器不支持录制画面，可保存PNG图片。');
    await fontsReady();
    if (options.signal && options.signal.aborted) throw cancelled();
    const mimeType = supportedVideoType();
    if (!mimeType) throw new Error('当前浏览器没有可用的视频编码器。');
    let stream;
    let recorder;
    let renderTimer;
    let stopTimer;
    let watchdog;
    let abort;
    const progress = function (value) {
      try { if (options.onProgress) options.onProgress(value); } catch (_) { /* A status display cannot interrupt encoding. */ }
    };
    try {
      options.render(canvas, state, 0, image);
      stream = canvas.captureStream(30);
      try { recorder = new global.MediaRecorder(stream, { mimeType: mimeType, videoBitsPerSecond: Math.min(16000000, Math.max(4000000, state.width * state.height * 5)) }); }
      catch (_) { throw new Error('视频生成无法启动，请尝试较小的画布。'); }
      return await new Promise(function (resolve, reject) {
        const chunks = [];
        let error = null;
        let finished = false;
        const settle = function (failure) {
          if (finished) return;
          finished = true;
          clearTimeout(renderTimer);
          clearTimeout(stopTimer);
          clearTimeout(watchdog);
          if (failure) { reject(failure); return; }
          const actualType = recorder.mimeType || mimeType;
          const blob = new global.Blob(chunks, { type: actualType });
          if (!blob.size) { reject(new Error('生成的视频为空，请重试。')); return; }
          progress(1);
          resolve({ blob: blob, extension: actualType.indexOf('mp4') !== -1 ? 'mp4' : 'webm', mimeType: actualType });
        };
        const stop = function (failure) {
          if (failure) error = failure;
          clearTimeout(renderTimer);
          clearTimeout(stopTimer);
          if (recorder.state !== 'inactive') {
            try { recorder.stop(); } catch (failure) { settle(error || failure); }
            watchdog = setTimeout(function () { settle(error || new Error('视频未能完成，请尝试更短的时长。')); }, 5000);
          } else settle(error);
        };
        abort = function () { stop(cancelled()); };
        if (options.signal) options.signal.addEventListener('abort', abort, { once: true });
        recorder.ondataavailable = function (event) { if (event.data && event.data.size) chunks.push(event.data); };
        recorder.onerror = function () { stop(new Error('视频生成失败，请缩小画布或缩短时长。')); };
        recorder.onstop = function () { settle(error); };
        recorder.start(250);
        const startedAt = global.performance.now();
        const durationMs = state.duration * 1000;
        let frame = 1;
        const tick = function () {
          if (finished || recorder.state !== 'recording') return;
          const elapsed = Math.min(state.duration, (global.performance.now() - startedAt) / 1000);
          try {
            options.render(canvas, state, elapsed, image);
            progress(elapsed / state.duration);
          } catch (_) { stop(new Error('视频帧无法绘制，请尝试其他文字效果。')); return; }
          frame = Math.max(frame + 1, Math.floor(elapsed * 30) + 1);
          renderTimer = setTimeout(tick, Math.max(1, startedAt + frame * 1000 / 30 - global.performance.now()));
        };
        progress(0);
        renderTimer = setTimeout(tick, 1000 / 30);
        stopTimer = setTimeout(function () { stop(); }, durationMs);
      });
    } finally {
      clearTimeout(renderTimer);
      clearTimeout(stopTimer);
      clearTimeout(watchdog);
      if (options.signal && abort) options.signal.removeEventListener('abort', abort);
      if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) { /* Already stopped. */ } }
      if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
      canvas.width = canvas.height = 1;
    }
  }

  function safeFilename(filename) {
    return String(filename || 'kinetic-type-export').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-');
  }

  function shareData(blob, filename) {
    if (!blob || !blob.size || typeof global.File !== 'function') return null;
    return { files: [new global.File([blob], safeFilename(filename), { type: blob.type || 'application/octet-stream' })] };
  }

  function canShareFile(blob, filename) {
    try {
      const navigator = global.navigator;
      if (global.isSecureContext === false || !navigator || typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') return false;
      const data = shareData(blob, filename);
      return !!data && navigator.canShare(data) === true;
    } catch (_) { return false; }
  }

  async function shareFile(blob, filename) {
    const navigator = global.navigator;
    const data = shareData(blob, filename);
    let supported = false;
    try { supported = global.isSecureContext !== false && !!data && !!navigator && typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare(data) === true; } catch (_) { /* Show the download fallback. */ }
    if (!supported) throw new Error('当前环境无法分享文件，请使用下载。');
    // The caller must invoke this directly from an explicit user click after
    // export finishes. Never await rendering before opening the share sheet.
    return navigator.share(data);
  }

  function download(blob, filename) {
    const url = global.URL.createObjectURL(blob);
    const anchor = global.document.createElement('a');
    anchor.href = url;
    anchor.download = safeFilename(filename);
    anchor.style.display = 'none';
    global.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { global.URL.revokeObjectURL(url); }, 10000);
  }

  global.KineticIO = Object.freeze({ serialize: serialize, parse: parse, decodeImage: decodeImage, decodeImages: decodeImages, loadImage: loadImage, saveDraft: saveDraft, loadDraft: loadDraft, exportPNG: exportPNG, exportVideo: exportVideo, canExportVideo: canExportVideo, canShareFile: canShareFile, shareFile: shareFile, download: download, MAX_PROJECT_BYTES: MAX_PROJECT_BYTES });
})(typeof window === 'undefined' ? globalThis : window);
