/* App-owned Worker adapter. MediaPipe and model assets are loaded only from this folder. */
import { FilesetResolver, InteractiveSegmenter } from './mediapipe-1.2.2/vision_bundle.mjs';
let loading = null, task = null, queue = Promise.resolve();
async function getTask(id) {
  if (!loading) loading = (async () => {
    postMessage({ id, type: 'progress', message: '正在加载本机主体识别组件…' });
    const files = await FilesetResolver.forVisionTasks(new URL('./mediapipe-1.2.2/wasm', import.meta.url).href, true);
    task = await InteractiveSegmenter.createFromOptions(files, {
      canvas: new OffscreenCanvas(1, 1),
      baseOptions: { modelAssetPath: new URL('../models/magic-touch-v2-int8-1.task', import.meta.url).href, delegate: 'CPU' }
    });
    return task;
  })().catch(error => { loading = null; throw error; });
  return loading;
}
self.onmessage = event => {
  const input = event.data;
  queue = queue.catch(() => {}).then(async () => {
    try {
      const segmenter = await getTask(input.id);
      postMessage({ id: input.id, type: 'progress', message: '正在本机识别主体…' });
      const image = new ImageData(new Uint8ClampedArray(input.rgba), input.width, input.height);
      segmenter.setImage(image);
      const mask = segmenter.segment([{ brushMode: 1, point: [input.point], isCompleted: true }]);
      try {
        const values = new Float32Array(mask.getAsFloat32Array());
        postMessage({ id: input.id, type: 'result', width: mask.width, height: mask.height, values: values.buffer }, [values.buffer]);
      } finally { mask.close(); }
    } catch (error) { postMessage({ id: input.id, type: 'error', message: error && error.message || '主体识别失败，请重新点选。' }); }
  });
};
