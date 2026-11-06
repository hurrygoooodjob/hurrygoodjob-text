(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KineticViewLayout = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  function fitArtwork(viewWidth, viewHeight, width, height, inset = 12) {
    const w = Math.max(1, Number(width) || 1), h = Math.max(1, Number(height) || 1);
    const fit = Math.min(Math.max(1, viewWidth - inset) / w, Math.max(1, viewHeight - inset) / h);
    return { width: Math.max(1, Math.floor(w * fit)), height: Math.max(1, Math.floor(h * fit)) };
  }
  function keyboardVisible({width, height, baseline, focused, scale = 1}) {
    return width <= 900 && !!focused && scale <= 1.05 && baseline - height > Math.max(100, baseline * .18);
  }
  function preservePan(pan, previousSize, nextSize) {
    return previousSize > 0 ? pan * nextSize / previousSize : 0;
  }
  return { fitArtwork, keyboardVisible, preservePan };
});
