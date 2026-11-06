# Hurrygoodjob-Text maintenance

This repository is a browser-local image typography editor. Keep changes scoped, preserve existing projects, and avoid sending user images to external services.

## Runtime and structure

- Native JavaScript and Canvas 2D; no installed runtime dependencies. Node.js 18+ is used for build and tests.
- `index.html`, `src/`, and the complete `assets/` directory are the runnable static site. Keep resource paths relative so GitHub Pages project URLs work.
- `npm start` starts the application server on localhost:4203. `npm test` runs Node regressions. `npm run build` creates the bundled HTML and accompanying assets in `dist/`.
- Browser Canvas fixtures need a general static server rooted at the repository. The application server intentionally does not expose the tests directory.
- Keep third-party licenses, sources, model card and modification notices. Both classic and module WASM loaders are required for compatibility.

## Data and rendering contracts

- Current project schema is10, readable schemas2–10. Preserve read-only migration of older draft namespaces. Do not overwrite old drafts during migration.
- `ringGroups` and `helixGroups` are independent collections, each with up to6 groups. Use `KineticModel.groupKey` and `groupsFor`; never hardcode a shared ringGroups collection for both effects.
- Per-group text, style, roll, tilt, position, dimensions and phase remain independent. The common camera and playback speed remain global. Other groups must not alter a group's repetition or mesh budget.
- Keep helix as a continuous rising/falling3D path, not an ellipse. Preserve consistent glyph compositing for opaque and translucent text to avoid changing unedited group pixels.
- Custom paths contain up to256 normalized points. Only explicit drawing mode captures the drawing gesture. Release previews; Done creates one history entry and saves; Cancel/Escape or an interrupted gesture preserves the previous path.
- The path renderer receives unscaled seconds and applies speed exactly once. Zero speed must stop movement. It does not clear the canvas or apply overall opacity a second time.
- Drawing guides are editing UI and must not appear in PNG or video exports.
- Do not reintroduce canvas text picking buffers, whole-canvas hit-map readback or direct-edit popovers removed for performance.

## Validation

- Run relevant Node tests after changes. For rendering changes also run actual browser Canvas fixtures for affected paths/styles, multi-image composition, transparency and occlusion.
- Verify preview, export, undo/redo and project round trips use the same document data.
- Check narrow and short viewports, including internal panel scroll and visible canvas size; page width alone is insufficient.
- Compare performance with identical scenarios, sizes and warmup. Synchronous Canvas call timing is not mobile FPS. Include a maximum-load scenario and report remaining limits.
- Before publishing, verify same-origin model and WASM loading on the deployed subpath, and avoid shipping personal files, local test outputs, browser data or credentials.
