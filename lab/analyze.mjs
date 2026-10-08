// Lab analyzer: reference video → measurements + token draft (measurements only).
// NEVER writes outside lab/refs/<name>/analysis/. Imports engine read-only.
// Usage: node lab/analyze.mjs lab/refs/v1 [--tick 0]
//
// Output: meta.json, mafd.txt, cuts.json, contact.png, shots/*.png,
//   strips/*.png, beats.json, loudness.json, sync.json, tokens.md (measurements
//   filled, statements left for the agent — see lab/tokens.md).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, parseMafd } from '../lib/holds.mjs';

const ref = process.argv[2];
if (!ref) { console.error('usage: node lab/analyze.mjs lab/refs/<name> [--tick 0]'); process.exit(2); }
const tickArg = process.argv.find((a) => a.startsWith('--tick'));
const tick = tickArg ? Number(tickArg.split('=')[1] ?? process.argv[process.argv.indexOf(tickArg) + 1]) : 0;
const SRC = join(ref, 'source.mp4');
const OUT = join(ref, 'analysis');
mkdirSync(join(OUT, 'shots'), { recursive: true });
mkdirSync(join(OUT, 'strips'), { recursive: true });

const run = (args, label) => {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(`${label} failed:\n${r.stderr}`); process.exit(1); }
  return r;
};
const probe = (args) => spawnSync('ffprobe', ['-v', 'error', ...args], { encoding: 'utf8' }).stdout.trim();

// 1. Meta
const [w, h, fpsStr, durStr] = [
  probe(['-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', SRC]),
  probe(['-select_streams', 'v:0', '-show_entries', 'stream=height', '-of', 'csv=p=0', SRC]),
  probe(['-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate', '-of', 'csv=p=0', SRC]),
  probe(['-show_entries', 'format=duration', '-of', 'csv=p=0', SRC]),
];
const [fn, fd] = fpsStr.split('/').map(Number);
const fps = fn / fd, dur = Number(durStr);
const hasAudio = probe(['-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', SRC]) !== '';
const meta = { w: +w, h: +h, fps: +fps.toFixed(3), dur: +dur.toFixed(3), frames: Math.round(dur * fps), hasAudio };
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 1) + '\n');

// 2. Frame differences (same signal holds.mjs uses; tick=0: references have no 12fps grain)
run(['-i', SRC, '-vf', `scdet,metadata=print:file=${join(OUT, 'mafd.txt')}`, '-f', 'null', '-'], 'mafd');
import { readFileSync } from 'node:fs';
const mafd = parseMafd(readFileSync(join(OUT, 'mafd.txt'), 'utf8'));
const { pops, holds } = analyze(mafd, { fps, tick, hold: 1 });
const cuts = pops.map((p) => +p.t.toFixed(3));
const shots = [0, ...cuts, dur].map((t, i, a) => i < a.length - 1 ? { start: +t.toFixed(3), end: +a[i + 1].toFixed(3), len: +(a[i + 1] - t).toFixed(3) } : null).filter(Boolean);
writeFileSync(join(OUT, 'cuts.json'), JSON.stringify({ cuts, shots, holds }, null, 1) + '\n');

// 3. Contact sheet + mid-shot per shot + dense strips across each cut
run(['-i', SRC, '-vf', 'fps=2,scale=270:-1,tile=8x4', '-frames:v', '1', join(OUT, 'contact.png')], 'contact');
shots.forEach((s, i) => {
  const mid = (s.start + s.end) / 2;
  run(['-ss', String(mid), '-i', SRC, '-vf', 'scale=480:-1', '-frames:v', '1', join(OUT, `shots/shot_${String(i).padStart(2, '0')}.png`)], `shot ${i}`);
});
cuts.forEach((t, i) => {
  // 13 frames centered on the cut: the motion technique lives here
  run(['-ss', String(Math.max(0, t - 6 / fps)), '-i', SRC, '-vf', 'scale=270:-1,tile=13x1', '-frames:v', '1', join(OUT, `strips/cut_${String(i).padStart(2, '0')}.png`)], `strip ${i}`);
});

// 4. Audio: beats + loudness (measure only; mood is out of scope)
let beats = null, loudness = null;
if (hasAudio) {
  run(['-i', SRC, '-vn', '-ar', '44100', '-ac', '1', join(OUT, 'audio.wav')], 'audio extract');
  const b = spawnSync('python3', ['beats.py', join(OUT, 'audio.wav')], { encoding: 'utf8' });
  if (b.status === 0) { beats = JSON.parse(b.stdout); writeFileSync(join(OUT, 'beats.json'), JSON.stringify(beats, null, 1) + '\n'); }
  else console.error('beats.py failed (librosa missing?) — skipping beats:\n' + b.stderr.slice(0, 500));
  const l = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', join(OUT, 'audio.wav'), '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = l.stderr.match(/I:\s+(-?[\d.]+)\s+LUFS[\s\S]*?Peak:\s+(-?[\d.]+)\s+dBFS/);
  if (m) { loudness = { integrated_lufs: +m[1], true_peak_dbfs: +m[2] }; writeFileSync(join(OUT, 'loudness.json'), JSON.stringify(loudness, null, 1) + '\n'); }
}

// 5. Sync: each cut's offset to the nearest beat/onset (is it cut to the music?)
let sync = null;
if (beats?.beats?.length) {
  const grid = beats.beats;
  sync = cuts.map((t) => {
    let best = grid[0], bd = Math.abs(t - grid[0]);
    for (const b of grid) { const d = Math.abs(t - b); if (d < bd) { bd = d; best = b; } }
    return { cut: t, nearest_beat: +best.toFixed(3), off_by: +(t - best).toFixed(3), on_beat: bd < 1 / fps + 0.02 };
  });
  writeFileSync(join(OUT, 'sync.json'), JSON.stringify(sync, null, 1) + '\n');
}

// 6. Token draft: measurements filled, statements empty (agent's job per lab/tokens.md)
const avgShot = shots.reduce((a, s) => a + s.len, 0) / shots.length;
const onBeat = sync ? sync.filter((s) => s.on_beat).length : null;
writeFileSync(join(OUT, 'tokens.md'), `# Tokens: ${ref.split('/').pop()}\n\n` +
  `> Measurements from analyze.mjs. Statements are EMPTY until the agent studies the evidence (lab/tokens.md).\n\n` +
  `## Measured\n` +
  `- duration ${dur.toFixed(1)}s, ${shots.length} shots, mean shot ${avgShot.toFixed(2)}s\n` +
  `- cuts at: ${cuts.join(', ') || 'none (one continuous take)'}\n` +
  `- holds >1s: ${holds.length ? holds.map((x) => `${x.from.toFixed(1)}–${x.to.toFixed(1)}`).join(', ') : 'none'}\n` +
  (beats ? `- tempo ${beats.bpm} BPM, ${beats.beats.length} beats\n` : `- no beat grid (beats.py failed or no audio)\n`) +
  (sync ? `- cuts on beat: ${onBeat}/${sync.length}\n` : ``) +
  (loudness ? `- loudness ${loudness.integrated_lufs} LUFS, peak ${loudness.true_peak_dbfs} dBFS\n` : ``) +
  `\n## Evidence\n- contact.png · shots/ (mid-shot each) · strips/ (13 frames per cut)\n\n## Tokens\n\n| name | kind | measurement | evidence | statement | refs |\n|---|---|---|---|---|---|\n| _(agent fills after studying evidence)_ | | | | | |\n`);

console.log(JSON.stringify({ ref, shots: shots.length, cuts: cuts.length, holds: holds.length, bpm: beats?.bpm ?? null, onBeat, loudness }, null, 1));
