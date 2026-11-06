# Subject selection integration

Public API: `await KineticSubject.segment(composedCanvas, {x,y}, {onProgress,signal})`. x/y and returned bounds are normalized to the full composition. Returns `{dataURL,bounds,source:'model'}`; `dataURL` is a white PNG with alpha-only foreground. Input is capped at long edge768, returned mask has the same aspect ratio. The application must discard stale results if photos, fit or canvas ratio changed. The AbortSignal prevents applying a queued/cancelled result; it cannot preempt a synchronous native inference already running.

`KineticSubject.fromAlpha(transparentCanvas)` returns the same shape with `source:'alpha'`, or null. Call only with a photo layer composed with `{transparent:true}`. An opaque rectangle merely surrounded by transparent contain margins is rejected. A meaningful original cutout retains its alpha; this is not described as new model inference.

Worker path loads module WASM, fallback path loads classic WASM. Both are preserved because they use different official loader formats. Assets resolve relative to the subject.js URL; an inlined HTML build instead resolves from its own document folder. The entire assets folder must accompany that HTML. File URLs are rejected for model loading with a user-facing message; HTTP localhost or public HTTPS is supported. The HTTP server must set JavaScript MIME for .js/.mjs and application/wasm for .wasm.

No model speed or mask accuracy is guaranteed for real phones. Hair, thin edges and small subjects may be imperfect. Click inside the intended object; selecting background may return a large region. The integration rejects empty/almost full masks and asks for a clearer point.

Validation in this agent: syntax of module/Worker/vendor bundle, npm integrity, fixed model hash, 4 unit tests of alpha semantics. Actual model initialization and rendered foreground selection require browser validation by the main task.
