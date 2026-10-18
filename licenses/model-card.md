---
license: apache-2.0
language:
- zh
tags:
- object-detection
- onnx
- android
- pill-counting
- medical
- detr
datasets:
- custom
pipeline_tag: object-detection
library_name: onnxruntime
---

# DEIMv2-X Pill + Needle Detector (Android ONNX, fp16)

A fine-tuned **DEIMv2-X** object detection model for counting pills and insulin pen needle caps. Exported to ONNX with fp16 weights for efficient Android deployment via ONNX Runtime.

## Model Details

| | |
|---|---|
| **Architecture** | DEIMv2-X (ViT backbone + Hybrid Encoder + Deformable DETR Decoder) |
| **Parameters** | 50.3M |
| **Input** | `[1, 3, 640, 640]` float16, NCHW, ImageNet normalized |
| **Classes** | `pill` (0), `needle` (1) |
| **Framework** | ONNX Runtime Android 1.21.0 |
| **Precision** | fp16 (101 MB) |
| **License** | Apache 2.0 |

## Performance

| Metric | Value |
|--------|-------|
| Exact count match (fp32) | **100%** (87/87 val images) |
| Exact count match (fp16) | **99%** (15/16 test images) |
| Within ±2 | **100%** |
| Confidence threshold | 0.5 |
| Inference (modern Android) | ~50–200ms |

## Files

| File | Size | Description |
|------|------|-------------|
| `deimv2_x_pill_fp16.onnx` | 101 MB | fp16 ONNX model (plaintext) |
| `deimv2_x_pill_fp16.onnx.enc` | 101 MB | AES-256-CTR encrypted model (for app distribution) |
| `metadata.json` | 1 KB | Model I/O specification and metadata |

### Encrypted Model

The `.onnx.enc` file is encrypted with AES-256-CTR to prevent direct extraction from the APK.

- **Format**: `[16-byte IV][ciphertext]`
- **Decryption**: Handled by `ModelDecryptor.kt` in the Android app at runtime

## Quick Start (Android / Kotlin)

### Gradle

```groovy
dependencies {
    implementation 'com.microsoft.onnxruntime:onnxruntime-android:1.21.0'
}
```

### Preprocessing

```
1. Resize image to 640 x 640 (stretch, no padding)
2. Scale pixels to [0, 1] (divide by 255)
3. Normalize: (pixel / 255.0 - mean) / std
   - mean = [0.485, 0.456, 0.406]
   - std  = [0.229, 0.224, 0.225]
4. Layout: NCHW, convert to float16
```

### Inference

```kotlin
val ortEnv = OrtEnvironment.getEnvironment()
val session = ortEnv.createSession(modelFilePath, OrtSession.SessionOptions())
val results = session.run(mapOf("image" to inputTensor))
```

### Postprocessing

```
For each of the 300 detections:
  1. Skip if scores[0][i] <= 0.5
  2. Get label: labels[0][i]  (0 = pill, 1 = needle)
  3. Get box: [x1, y1, x2, y2] = boxes[0][i]  (640x640 space)
  4. Scale to original image:
       x_orig = x / 640.0 * original_width
       y_orig = y / 640.0 * original_height
```

### Model I/O

**Input:**

| Name | Shape | Type | Description |
|------|-------|------|-------------|
| `image` | `[1, 3, 640, 640]` | float16 | Preprocessed RGB image (NCHW) |

**Outputs:**

| Name | Shape | Type | Description |
|------|-------|------|-------------|
| `labels` | `[1, 300]` | int32 | Class: 0 = pill, 1 = needle |
| `boxes` | `[1, 300, 4]` | float16 | Bounding boxes [x1, y1, x2, y2] (0–640) |
| `scores` | `[1, 300]` | float16 | Confidence scores (0–1) |

## Key Notes

- **End-to-end**: DEIMv2 outputs are final — no NMS or post-processing needed
- **fp16 I/O**: Use `ShortBuffer` + `OnnxJavaType.FLOAT16` on Android
- **300 queries**: Always outputs 300 candidates; most have near-zero scores
- **Stream from file**: Load model from file path (not `readBytes()`) to avoid OOM on memory-constrained devices

## Known Limitations

1. **Blister packs**: Reflective foil may cause +1–2 overcounting
2. **Very small pills**: May be missed if too small relative to image — move camera closer
3. **Stacked pills**: 3+ layers of stacking may cause occlusion
4. **Needle types**: Trained on insulin pen needle caps only

## Training Data

- 333 pill images + 60 needle images
- Custom dataset, not publicly available

## Citation

```
@misc{reveliorx2026,
  title={RevelioRX: DEIMv2-X Pill and Needle Detector},
  author={Tsung-Han Liu},
  year={2026},
  url={https://huggingface.co/DanteLiu/deimv2-x-pill-android}
}
```
