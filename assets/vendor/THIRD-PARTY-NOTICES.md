# Third-party notices

## MediaPipe Tasks Vision

- Package: @mediapipe/tasks-vision 1.2.2; copyright The MediaPipe Authors / Google.
- License: Apache License 2.0, full text in LICENSE-Apache-2.0.txt.
- Download: https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.2.2.tgz
- Published SHA512 integrity and model SHA256 are recorded in sources.json. The exact original npm archive is retained in the project process archive.
- **Modified file:** vision_bundle.mjs has one app-local patch removing automatic optional remote usage-logger initialization. The unmodified original remains in the npm archive; exact original/replacement and before/after SHA256 are in local-only-patch.json. Inference, masks, WASM and model binaries are unchanged.
- vision_bundle.mjs sourceMappingURL is inherited from the package; runtime does not require source maps.

## MagicTouch model

- Model: MediaPipe Interactive Segmenter v2, magic_touch int8, version 1.
- Source: https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task
- Model card linked by the official Interactive Segmenter documentation: MagicTouch-model-card.pdf, declares Apache License 2.0. The linked card describes the original 2023 model, while current documentation and delivered .task use the v2 768px architecture; do not reuse the card's old model size or benchmark as v2 measurements.
- Current documentation: https://developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter
- Web API guide: https://developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter/web_js
- Retrieval date: 2026-11-06.

## Local execution

All executable assets and model files are served from the same editor folder. No external CDN, photo upload endpoint, account or API key is configured. subject-worker.js is app-owned code. It uses the supplied CPU backend in an offscreen Worker where available; the same local CPU task is used as a compatibility fallback. Models are loaded lazily on first subject selection.
