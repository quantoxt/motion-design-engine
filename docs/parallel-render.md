# Parallel render: how it works and why it's safe

`render-parallel.mjs` is a faster twin of `render.mjs`. Same flags, same output file, **byte-identical video**.
On this machine (4 cores) a 20s film went from ~60 min to ~11 min.

```bash
node render-parallel.mjs --fps 60 --dur 20 --sub 4 --w 1080 --h 1920 --workers 3
#   --from <s>     start time (re-render a section)
#   --out <file>   default out/silent.mp4
#   --workers <n>  default = core count; 3 is the sweet spot here (see benchmarks)
```

`render.mjs` is unchanged and stays the reference implementation.

## Why the old render was slow

Measured per subframe (one of the 4 motion-blur samples that make up each video frame):

| Step | Time |
|---|---|
| `seek(t)`: draw the frame on the canvas | **31 ms** |
| Playwright `locator.screenshot()`: compositor readback + full-strength PNG encode + base64 | **~810 ms** |

96% of the time went into encoding PNGs, and only one core was used. A 20s film at 60fps × 4 subframes = 4,800 screenshots ≈ 60 min. The CPU wasn't the problem; the pipeline was.

## What changed (2 things)

### 1. Faster lossless capture (~2.2× on its own)
Each frame is captured with Chrome's DevTools call directly:
```js
cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } })
```
`optimizeForSpeed` makes Chrome use lighter PNG compression. The file is ~1.8× bigger, but PNG is lossless, so **the pixels are identical**. This was verified by decoding both PNGs and comparing MD5s of the raw RGBA.

Rejected alternatives (all measured):
| Approach | ms / subframe | Why not |
|---|---|---|
| `getImageData` → JS base64 string | 751 | String building in JS is slow |
| `getImageData` → `fetch` POST to localhost | 1904 | Browser network stack is slower still |
| `getImageData` → return `Uint8Array` | 550 | 8 MB through the DevTools protocol per frame |
| `getImageData` → native `toBase64()` | 455 | Same speed as fast PNG, but sends raw RGBA, a different input path than `render.mjs` |
| **CDP PNG `optimizeForSpeed`** | **441** | ✅ Same pixels, same ffmpeg input path |

### 2. Workers in parallel, ONE ordered encode
- Start N headless Chromium instances (separate processes, so they really run on separate cores).
- **Frame f is painted by worker `f % N`** (round-robin, not big contiguous chunks). The workers stay in step, so only a few frames ever sit waiting in memory.
- Each worker queues its own jobs one at a time, because seek and capture must not interleave on the same page. Each worker is allowed at most `AHEAD = 2` frames ahead, which keeps memory small.
- The main process waits for frames **in order** (0, 1, 2, …) and pipes their PNGs into **a single ffmpeg**. The `tmix` motion blur and x264 see exactly the same stream as with `render.mjs`.

## Why the output can't change
1. **Pure frames.** `window.seek(t)` depends only on `t`. There's no state carried between frames, and noise comes from seeded `mulberry32`, never `Math.random`. That's the project render contract, and it's the only reason this works. Break the contract (e.g. `Math.random`, or reading the previous frame) and parallel output **will** diverge.
2. **Bit-identical times.** Subframe `i` uses the exact same expression as `render.mjs`: `FROM + (i - (SUB-1)) / (FPS*SUB)`, computed from the global index. `chunkStart + offset` could drift by floating-point ulps.
3. **Motion blur never crosses a worker.** A frame's 4 subframes are always rendered by the same worker and land next to each other in the stream.
4. **One encoder.** There are no per-chunk MP4s to join, so there are no extra keyframes at seams.

## Verification (run 2026-10-06)
Rendered 6.0–6.5s (typing, cursor, camera move: 30 frames, so every frame boundary is a worker handoff) both ways:

```
serial   (render.mjs)           93.8 s wall
parallel (render-parallel.mjs)  24.9 s wall
framemd5: 30 vs 30 frames → DECODED FRAMES IDENTICAL
file md5: 9f8a319e… = 9f8a319e…  (byte-identical MP4)
```
3, 5 and 6 workers also produced the same `9f8a319e…` file.

Re-run the check any time you change the renderer:
```bash
node render.mjs          --from 6 --dur 0.5 --out out/_serial.mp4
node render-parallel.mjs --from 6 --dur 0.5 --out out/_par.mp4
ffmpeg -y -v error -i out/_serial.mp4 -f framemd5 out/_serial.md5
ffmpeg -y -v error -i out/_par.mp4 -f framemd5 out/_par.md5
diff out/_serial.md5 out/_par.md5 && echo identical
```

## Benchmarks (0.5s of film = 120 subframes, render loop only)
| Workers | Time | Note |
|---|---|---|
| 1 (old `render.mjs`) | ~88 s | wall time minus ~6 s browser startup |
| 3 | 16 s | **recommended**: leaves headroom on a 4-core machine |
| 4 | 18 s | |
| 5 | 16 s | |
| 6 | 15 s | CPU saturated, no gain past 3 |

Speed tops out around 3 workers because Chromium's raster + PNG work, the PNG decoding and x264 all share the same 4 cores. A machine with more cores will scale further.

## Cost / side effects
- RAM: ~400–600 MB per Chromium while running.
- The machine is busy for the duration (all cores in use). Use `--workers 2` if you need it responsive.
- If any worker or ffmpeg fails, the script kills ffmpeg, closes every browser and exits non-zero. The partly written output file stays on disk, so check the exit code / the final `rendered 20.0s / 20s` line before using it.
