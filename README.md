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

The app exposes a detector-shaped flow ready for OpenCV.js (loaded from the OpenCV CDN). The MVP's dependable fallback uses a lightweight heuristic/demo detector so the UI works even if the CDN is unavailable. Real-world performance depends on lighting, contrast, overlap, pill shape, and resolution. It does not identify medication, validate dosage, or replace a human check. Always verify every numbered overlay.

## Current limits

- Camera capture is browser/file-input based; continuous camera streaming is not implemented.
- Pinch zoom is represented by a review stage and can be extended with a gesture library; overlays are rendered at the image's fitted scale.
- Optional production metrics can be added around detector timing/counts; no telemetry is sent by this build.
