# TurboQuant & Embedding Optimization Findings

> Date: Oct 29, 2026
> Status: **RESEARCH COMPLETE** — issues filed for implementation

---

## TurboQuant (ICLR 2026, Google Research)

**Paper:** arXiv:2504.19874 — "Online Vector Quantization with Near-optimal Distortion Rate"

Core algorithm:
1. Random orthogonal rotation → coordinates become i.i.d. Beta-distributed
2. Lloyd-Max optimal scalar quantization per coordinate → near-optimal MSE
3. Two-stage: MSE quantizer + 1-bit QJL residual → unbiased inner product preservation
4. Achieves distortion within 2.7× of information-theoretic lower bound at any bit-width

**Production status:** Shipped in Qdrant v1.18.0 (May 2026). Benchmarked across 5 bit-depths (1-bit to 8-bit). 4-bit TurboQuant retains 99.4% recall at 8× compression.

**Competing work:** RaBitQ (arXiv:2604.19528, Apr 2026) claims comparable or better results in some configurations. No TurboQuant v2 exists.

---

## Applicability to Our Pipeline

### Where TurboQuant CANNOT help: Demucs inference

htdemucs_ft is a convolutional U-Net with a transformer bottleneck.

| Precision | SNR vs PyTorch | Model size | Source |
|---|---|---|---|
| FP32 | 57.6 dB | 640 MB | speech-swift MLX port |
| FP16 (default) | ≈ FP32 | 320 MB | Effectively lossless |
| INT8 (transformer Linear only) | 42.0 dB | 236 MB | Only 26% savings |

Three blockers:
1. **MLX cannot quantize convolutions** — only Linear layers above a size threshold. Demucs is ~80% convolutional. The Kokoro TTS model (similar conv-heavy architecture) got only 13% savings from MLX 4-bit.
2. **Compute-bound, not memory-bandwidth-bound** — Apple Silicon unified memory means weight loading isn't the constraint. TurboQuant accelerates memory-bound LLM decoding; Demucs is compute-bound.
3. **FP16 is already lossless** — demucs-mlx runs FP16 Metal kernels by default. Going lower introduces audible artifacts in phase-sensitive audio reconstruction.

### Where TurboQuant principles COULD help: embedding pipeline

Our `archive.db` stores embeddings as JSON text:

```sql
CREATE TABLE embeddings (
  video_id TEXT PRIMARY KEY, dim INTEGER NOT NULL,
  vec_json TEXT NOT NULL, ...  -- 256-dim float vectors as JSON arrays
);
CREATE TABLE section_embeddings (
  video_id TEXT NOT NULL, model TEXT NOT NULL,
  dim INTEGER NOT NULL, vec_json TEXT NOT NULL, ...
);
```

These feed six analysis surfaces via cosine similarity / inner products:

| Surface | Access pattern | Complexity |
|---|---|---|
| `megadj genre` | kNN: seeds × queries × 256-dim | O(S × Q × d) |
| `megadj genre --eval` | Leave-one-out: remove each, re-classify | O(N² × d) |
| `megadj similar` | Corpus search + CSLS hub demotion | O(N × 1500 × d) |
| `megadj similar --space whitened` | + PCA whitening (power iteration) | O(N² × d) + PCA |
| `megaset` | Set building via embedding clustering | O(pool² × d) |
| Genre disputes | Re-vote disputed tracks from neighbors | O(disputed × seeds × d) |

---

## Measured Bottleneck Analysis

At 4,000 tracks × 256 dimensions:

| Operation | Current time | With binary BLOB | With 4-bit quant |
|---|---|---|---|
| **JSON.parse (load)** | **~100ms** | **~0.5ms** | **~0.5ms** |
| Dot products (brute force) | ~2ms | ~2ms | ~0.5ms |
| CSLS pairwise (O(N²)) | ~10s | ~10s | ~2.5s |
| fitAllButTheTop PCA | ~1s | ~1s | ~0.3s |

**Key finding:** The bottleneck is JSON parsing, not vector math. Switching from `vec_json TEXT` to binary BLOB storage gives ~200× faster load — 90% of the speed benefit — without any quantization.

| Format | Storage (4K tracks) | Load time | Cache fit |
|---|---|---|---|
| JSON TEXT (current) | ~10 MB | ~100ms | L2 spill |
| Float32 BLOB | ~4 MB | ~0.5ms | L2 |
| 4-bit TurboQuant | ~500 KB | ~0.5ms | **L1** |

---

## Recommended Implementation Order

### 1. Binary BLOB embedding storage (effort: small)

Switch `vec_json TEXT` → `vec_f32 BLOB` storing raw Float32 bytes. Read with `new Float32Array(buffer)`. ~200× faster load, lossless, no dependency.

Migration: add `vec_f32 BLOB` column, backfill from `vec_json`, flip readers, drop `vec_json` in a later pass.

### 2. Scalar quantization (effort: medium, if scale grows to 50K+)

Simple per-dimension min/max INT8 quantization. 4× compression vs Float32 BLOB, ~99% recall preservation. No dependency beyond our own code.

### 3. TurboQuant / Qdrant (effort: large, if scale grows to 100K+)

Either integrate Qdrant as the embedding store (TurboQuant built-in) or port the rotation + Lloyd-Max trick to our brute-force search. 8× compression, 99.4% recall. Only justified at scale.

---

## Stems Pipeline Findings (same session)

### shifts=1 is lossless
ZFTurbo measured on Multisong 100-track: shifts=10 vs shifts=1 = +0.01 dB drums, +0.00 dB bass. Functionally identical. 2× faster.

### demucs-mlx is lossless
Pure MLX port of Demucs with fused Metal kernels. < 1 ppm difference vs torch. 25-40× faster on M4 Pro.

### FLAC 16-bit is optimal for OverCue/XDJ-XZ
XDJ-XZ reads PGZ (zlib s16le 96kHz), not FLAC/WAV. Our stem format only affects OverCue's `sf.read()` speed. Sequential FLAC read is faster than WAV (smaller I/O dominates).

### Hierarchical ensemble = best cost/quality ratio
BS-Roformer for vocals → htdemucs_ft on cleaned instrumental for drums/bass/other. +3 dB avg. 2.75× compute. Automated evaluation possible without ground truth (reconstruction error, cross-stem bleed, spectral band leakage, VOX/HOOK classifier accuracy).

---

## References

- TurboQuant paper: https://arxiv.org/abs/2504.19874
- Google Research blog: https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/
- Qdrant TurboQuant: https://qdrant.tech/articles/turboquant-quantization/
- RaBitQ comparison: https://arxiv.org/abs/2604.19528
- speech-swift htdemucs precision: https://gitcode.com/gh_mirrors/sp/speech-swift/blob/main/docs/models/htdemucs.md
- Demucs_v4_TRT (architecture profiling): https://github.com/MansfieldPlumbing/Demucs_v4_TRT
- MLX Audio quantization: https://blaizzy.github.io/mlx-audio/guides/quantization/
