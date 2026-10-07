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
