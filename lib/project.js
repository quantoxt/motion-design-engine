// Fake-3D in 2D canvas: isometric projection, rotating solids, parallax.
// ~20 lines of projection math, zero dependencies, pure functions of t.
// For true 3D (Three.js driven by seek(t)) see docs/patterns.md — not this file.
import { track } from './motion.js';

// Rotate a vertex around Y then X (radians). v = [x, y, z].
export function rot([x, y, z], ry, rx = 0) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const [x1, z1] = [x * c - z * s, x * s + z * c];
  const c2 = Math.cos(rx), s2 = Math.sin(rx);
  return [x1, y * c2 - z1 * s2, y * s2 + z1 * c2];
}

// Isometric project [x, y, z] → screen, centered on (cx, cy) at scale k.
export function iso([x, y, z], cx, cy, k = 1) {
  return [cx + (x - z) * 0.866 * k, cy + (x + z) * 0.5 * k - y * k];
}

// Cube faces in world space, with their (rotated) outward normals.
// center = [x, y, z], size s, rotation (ry, rx). Returns [{pts, normal, face}].
// face: 0 back(−z) 1 front(+z) 2 bottom(−y) 3 top(+y) 4 right(+x) 5 left(−x), before rotation.
const FACES = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [1, 2, 6, 5], [0, 4, 7, 3]];
const NORMALS = [[0, 0, -1], [0, 0, 1], [0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0]];
export function cube(center, s, ry, rx = 0.5) {
  const h = s / 2;
  const V = [];
  for (const [x, y, z] of
    [[-h,-h,-h],[h,-h,-h],[h,h,-h],[-h,h,-h],[-h,-h,h],[h,-h,h],[h,h,h],[-h,h,h]])
    V.push(rot([x, y, z], ry, rx).map((v, i) => v + center[i]));
  return FACES.map((f, i) => ({ pts: f.map((v) => V[v]), normal: rot(NORMALS[i], ry, rx), face: i }));
}

// Draw the cube: projected via proj([x,y,z]) → [sx, sy] (screen y down).
// Back faces are culled by projected winding — exact for a convex solid, so no
// depth sort is needed and faces never paint over each other.
// shades = [dark, mid, light]: lit by the rotated normal (up = light, sides = darker),
// so the top face is always the lightest and shading follows the rotation.
export function drawCube(g, proj, center, s, ry, rx, shades) {
  for (const { pts, normal } of cube(center, s, ry, rx)) {
    const P = pts.map((p) => proj(p));
    let area = 0;
    for (let i = 0; i < 4; i++) { const [ax, ay] = P[i], [bx, by] = P[(i + 1) % 4]; area += ax * by - bx * ay; }
    if (area >= 0) continue;              // facing away (screen y is down, so front faces wind negative)
    g.beginPath();
    P.forEach(([sx, sy], i) => (i ? g.lineTo(sx, sy) : g.moveTo(sx, sy)));
    g.closePath();
    const up = normal[1], side = Math.abs(normal[0]) > Math.abs(normal[2]);
    g.fillStyle = up > 0.5 ? shades[2] : side ? shades[0] : shades[1];
    g.fill();
  }
}

// Continuous turntable angle from keyframed stops: stops = [[time, turns], ...].
export function turntable(t, stops, k = 60, d = 14) {
  return track(t, stops.map(([time, turns]) => [time, turns * Math.PI * 2]), k, d);
}

// Parallax: layers [{draw, depth}] shift against camera x by depth factor.
export function parallax(g, camX, layers) {
  for (const { draw, depth } of layers) {
    g.save(); g.translate(-camX * depth, 0); draw(); g.restore();
  }
}

// Hinged turn: a flat rect {x, y, w, h} swinging on one real edge (a book cover on its spine, a door,
// a card), not about its centre. angle 0 = flat, π/2 = edge-on, π = folded over onto the other side.
// edge: 'left' | 'right' | 'top' | 'bottom'. persp = perspective strength (0 = none).
// Returns the 4 corners [hinge-a, hinge-b, far-b, far-a]: the far edge is where the next object
// should start (e.g. the page that opens from under the cover). Pure.
export function hingeQuad({ x, y, w, h }, angle, edge = 'left', persp = 0.0006) {
  const horiz = edge === 'left' || edge === 'right';
  const len = horiz ? w : h, sign = edge === 'left' || edge === 'top' ? 1 : -1;
  const reach = len * Math.cos(angle), depth = len * Math.sin(angle);
  const s = 1 / Math.max(0.2, 1 - depth * persp);   // far edge grows as it lifts toward the viewer
  if (horiz) {
    const hx = edge === 'left' ? x : x + w, fx = hx + sign * reach * s, cy = y + h / 2, half = (h / 2) * s;
    return [[hx, y], [hx, y + h], [fx, cy + half], [fx, cy - half]];
  }
  const hy = edge === 'top' ? y : y + h, fy = hy + sign * reach * s, cx = x + w / 2, half = (w / 2) * s;
  return [[x, hy], [x + w, hy], [cx + half, fy], [cx - half, fy]];
}

// Draw `face` (an image or canvas, the rect's content) through hingeQuad in strips so the perspective
// taper is real. Past edge-on you see the other side: `back` if given (reading normally), else the face
// mirrored, as a real sheet would look from behind.
export function drawHinged(g, rect, angle, face, { edge = 'left', persp = 0.0006, strips = 32, back = null } = {}) {
  const behind = Math.cos(angle) < 0, src = behind && back ? back : face;
  const q = hingeQuad(rect, angle, edge, persp);
  const horiz = edge === 'left' || edge === 'right';
  const sw = src.width, sh = src.height;
  const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  // u runs from the hinge (0) to the far edge (1); the face's own coordinate along that axis:
  const far = edge === 'left' || edge === 'top' ? (u) => u : (u) => 1 - u;   // face: hinge side first
  const along = behind && back ? (u) => 1 - far(u) : far;                       // back: seen from the other side
  for (let i = 0; i < strips; i++) {
    const u0 = i / strips, u1 = (i + 1) / strips;
    const a0 = lerp(q[0], q[3], u0), b0 = lerp(q[1], q[2], u0), a1 = lerp(q[0], q[3], u1), b1 = lerp(q[1], q[2], u1);
    const s0 = Math.min(along(u0), along(u1)), s1 = Math.max(along(u0), along(u1));
    g.save();
    if (horiz) {
      const x0 = Math.min(a0[0], a1[0]), x1 = Math.max(a0[0], a1[0]) + 0.6;
      const top = Math.min(a0[1], a1[1]), bot = Math.max(b0[1], b1[1]);
      // the strip's source runs with u; if u runs right→left on screen, mirror it
      const mirror = (a1[0] < a0[0]) !== (along(u1) < along(u0));
      if (mirror) { g.translate(x0 + x1, 0); g.scale(-1, 1); }
      g.drawImage(src, s0 * sw, 0, (s1 - s0) * sw, sh, x0, top, x1 - x0, bot - top);
    } else {
      const y0 = Math.min(a0[1], a1[1]), y1 = Math.max(a0[1], a1[1]) + 0.6;
      const l = Math.min(a0[0], a1[0]), r = Math.max(b0[0], b1[0]);
      const mirror = (a1[1] < a0[1]) !== (along(u1) < along(u0));
      if (mirror) { g.translate(0, y0 + y1); g.scale(1, -1); }
      g.drawImage(src, 0, s0 * sh, sw, (s1 - s0) * sh, l, y0, r - l, y1 - y0);
    }
    g.restore();
  }
  return q;
}
