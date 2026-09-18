# Test data and golden annotations

This directory is intentionally separate from application assets:

```text
test-data/
  images/       # local images, never uploaded by the app
  annotations/  # verified center coordinates
  manifest.json # dataset manifest (see manifest.schema.json)
```

Copy `manifest.example.json` to `manifest.json`, add local images and annotations,
then open `benchmark.html` and choose the manifest. Paths are resolved by the
browser relative to the manifest URL; for local files, use a local static server
(`npm run dev`) and keep the dataset outside version control if it contains
private pharmacy/patient imagery. The annotation tool is available at
`annotation.html`; it only downloads JSON and never uploads images or labels.

An annotation file has `schemaVersion`, `image`, `width`, `height`, and a
`centers` array of `{x,y}` pixel coordinates. Do not claim detector accuracy
from the example manifest: it is a schema example and contains no image.
