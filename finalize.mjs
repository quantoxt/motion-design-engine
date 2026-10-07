// One-command finish: mix (if needed) → two-pass loudnorm to −14 LUFS → mux with
// the silent render → confirm with ebur128 → CRF-20 posting copy.
// node finalize.mjs --dir brands/<name> [--video out/silent.mp4 --audio out/mix.wav] [--all-formats]
//
// Output is named after the brand (the --dir folder) and the format, so films in the
// library are recognisable and formats never overwrite each other:
//   out/<brand>-<format>-<W>x<H>.mp4           master, CRF 16 video + −14 LUFS audio
//   out/<brand>-<format>-<W>x<H>-posting.mp4   CRF-20 posting copy
// <format> comes from the render's name (silent_<format>.mp4), else from the film.json
// format with the same size, else vertical/square/wide by shape.
// --all-formats finalizes every out/silent*.mp4 with the same audio (measured once).
//
// Audio source, first that exists:
//   --audio FILE  |  out/mix.wav  |  out/music.wav (+ out/sfx.wav mixed on top, if present)
// Relative --video/--audio paths resolve against --dir.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, isAbsolute, basename } from 'node:path';

const sarg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = resolve(sarg('dir', '.'));
const inDir = (p) => (isAbsolute(p) ? p : join(DIR, p));
const BRAND = basename(DIR).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
const ALL = process.argv.includes('--all-formats');
const VIDEOS = ALL
  ? readdirSync(join(DIR, 'out')).filter((f) => /^silent(_[a-z0-9-]+)?\.mp4$/.test(f)).sort().map((f) => join(DIR, 'out', f))
  : [inDir(sarg('video', 'out/silent.mp4'))];
const PREMIX = join(DIR, 'out/premix.wav');

// ffmpeg writes its logs (loudnorm JSON, ebur128 summary) to STDERR at info level.
function ff(args, label) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 64e6 });
  if (r.status !== 0) { console.error(r.stderr.slice(-2000)); throw new Error(`ffmpeg failed: ${label}`); }
  return r.stderr;
}
const die = (msg) => { console.error(msg); process.exit(1); };

if (!VIDEOS.length) die(`no out/silent*.mp4 in ${DIR} — render first`);
for (const v of VIDEOS) if (!existsSync(v)) die(`no video at ${v} — render first`);

// Name an output after the brand + format of its render.
let film = {};
try { film = JSON.parse(readFileSync(join(DIR, 'film.json'), 'utf8')); } catch {}
function outputs(video) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', video], { encoding: 'utf8' });
  const [w, h] = r.stdout.trim().split('x').map(Number);
  if (!w || !h) die(`could not read the size of ${video}`);
  const fmt = basename(video).match(/^silent_([a-z0-9-]+)\.mp4$/)?.[1]
    ?? film.formats?.find((f) => f.w === w && f.h === h)?.name
    ?? (w > h ? 'wide' : w < h ? 'vertical' : 'square');
  const stem = join(DIR, 'out', `${BRAND}-${fmt}-${w}x${h}`);
  return { final: `${stem}.mp4`, posting: `${stem}-posting.mp4` };
}

// 1 · Pick or build the audio
let AUDIO = sarg('audio') ? inDir(sarg('audio')) : join(DIR, 'out/mix.wav');
if (!existsSync(AUDIO)) {
  const music = join(DIR, 'out/music.wav'), sfx = join(DIR, 'out/sfx.wav');
  if (!existsSync(music)) die(`no audio: expected ${AUDIO} or ${music}`);
  if (existsSync(sfx)) {
    // sfx.mjs writes mono: spread it to both channels, sum without auto-normalizing
    ff(['-y', '-i', music, '-i', sfx, '-filter_complex',
      '[1]aformat=channel_layouts=stereo[s];[0][s]amix=inputs=2:normalize=0:duration=first[m]',
      '-map', '[m]', PREMIX], 'premix');
    console.log(`mixed music + sfx → ${PREMIX}`);
    AUDIO = PREMIX;
  } else AUDIO = music;
}

// 2 · Pass 1: measure
const p1 = ff(['-i', AUDIO, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], 'loudnorm measure');
const json = p1.slice(p1.lastIndexOf('{'), p1.lastIndexOf('}') + 1);
let m;
try { m = JSON.parse(json); } catch { die(`could not read loudnorm measurement:\n${p1.slice(-800)}`); }
console.log(`measured: ${m.input_i} LUFS, peak ${m.input_tp} dBTP`);

for (const VIDEO of VIDEOS) {
const { final: FINAL, posting: POSTING } = outputs(VIDEO);
// 3 · Pass 2: normalize (linear) + mux, video stream copied
ff(['-y', '-i', VIDEO, '-i', AUDIO, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
  '-af', `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`,
  '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', FINAL], 'normalize + mux');

// 4 · Confirm on the delivered file
const ebu = ff(['-i', FINAL, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], 'ebur128');
const summary = ebu.slice(ebu.lastIndexOf('Summary:'));
const I = summary.match(/I:\s*(-?[\d.]+) LUFS/)?.[1], TP = summary.match(/Peak:\s*(-?[\d.]+) dBFS/)?.[1];
if (!I) die(`ebur128 summary not found:\n${ebu.slice(-800)}`);
console.log(`confirmed: ${I} LUFS integrated, ${TP} dBTP true peak → ${FINAL}`);
if (Math.abs(Number(I) + 14) > 0.5) console.warn(`WARNING: ${I} LUFS is off the −14 target (linear mode may have fallen back — check peaks)`);

// 5 · Posting copy: CRF 20 (grain-heavy CRF-16 finals run ~24 Mbps), audio copied.
ff(['-y', '-i', FINAL, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy',
  '-movflags', '+faststart', POSTING], 'posting copy');
console.log(`posting copy → ${POSTING}`);
}
