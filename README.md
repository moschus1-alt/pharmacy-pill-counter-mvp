# PillCount MVP

A mobile-first, local-first pharmacy pill counter built with Vite and vanilla JavaScript.

## Use

```sh
npm install
npm run dev
```

Choose **Capture / upload** (the `capture="environment"` file input requests the Android rear camera) or upload a photo. Set a 30/60/90/custom target, review numbered contour overlays, correct with +/- or Undo/Redo, then save the correction. **Try demo image** is useful for a quick walkthrough.

## Privacy and security

The image is decoded and analyzed in the browser and is not sent to a server. Images are held in memory only and are not placed in IndexedDB. Saving stores only target, final count, and timestamp in a local IndexedDB database. Use HTTPS (or localhost) for camera access; the service worker and installable PWA require a secure origin.

## Detection and limits

The browser detector uses OpenCV.js (loaded from the OpenCV CDN): grayscale local-contrast enhancement (CLAHE when available), yellow and blue color masks, low-saturation white-tablet masks, local top-hat contrast for stainless-steel reflections, two erosion strengths, contour/moment centers, and distance-transform peaks for conservative touching-pill splits. A fallback heuristic keeps the UI usable if the CDN is unavailable. Real-world performance depends on lighting, contrast, overlap, pill shape, and resolution. It does not identify medication, validate dosage, or replace a human check. Always verify every numbered overlay.

The synthetic browser fixture at `tests/synthetic-fixture.html` exercises five separated pills plus two touching pills and asserts that separated pills are found and the total stays within a conservative range.

## Current limits

- Camera capture is browser/file-input based; continuous camera streaming is not implemented.
- Pinch zoom is represented by a review stage and can be extended with a gesture library; overlays are rendered at the image's fitted scale.
- Optional production metrics can be added around detector timing/counts; no telemetry is sent by this build.

## Developer test data and benchmark

Phase 1 developer tools are available at `/annotation.html` and
`/benchmark.html` when running Vite. The annotation page accepts a local image,
supports click-to-add/delete center markers, and downloads verified ground-truth
JSON; it never uploads imagery. The benchmark consumes the manifest format in
`test-data/manifest.schema.json`, compares actual detector output to annotated
centers (TP/FP/FN, center-distance matching, precision/recall/F1, exact count
accuracy, MAE, and processing time), and draws TP/FP/FN overlays. Use the
optional image-file picker when testing a manifest selected from disk. Keep
private pharmacy images outside version control and do not infer accuracy from
the schema-only example manifest.
