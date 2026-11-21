/**
 * Automation curves. A curve is a list of points { beat, value (0–1), ease (0–1) }, sorted by beat.
 * Between two points the curve is a cubic bezier whose handles are horizontal:
 *
 *   P0 = (x0, y0)   P1 = (x0 + e0·dx/2, y0)   P2 = (x1 − e1·dx/2, y1)   P3 = (x1, y1)
 *
 * so each point's `ease` sets how far its handles reach towards the neighbours:
 * 0 = sharp corner (straight lines), 1 = the widest, smoothest ease-in/out.
 * Before the first point the curve holds the first value; after the last, the last value.
 */
export const DEFAULT_EASE = 0.66; // handles ≈ ⅓ of the gap: a classic smooth curve

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function normalizePoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .filter((p) => p && Number.isFinite(+p.beat) && Number.isFinite(+p.value))
    .map((p) => ({ beat: Math.max(0, +p.beat), value: clamp01(+p.value), ease: clamp01(Number.isFinite(+p.ease) ? +p.ease : DEFAULT_EASE) }))
    .sort((a, b) => a.beat - b.beat);
}

/** Bezier control points of the segment a → b (in beat/value space). */
export function segment(a, b) {
  const dx = b.beat - a.beat;
  return [
    [a.beat, a.value],
    [a.beat + (a.ease * dx) / 2, a.value],
    [b.beat - (b.ease * dx) / 2, b.value],
    [b.beat, b.value],
  ];
}

const bez = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

/** Curve value at `beat` (`def` when there are no points). x(t) is monotonic, so bisection finds t. */
export function valueAt(points, beat, def) {
  if (!points.length) return def;
  if (beat <= points[0].beat) return points[0].value;
  const last = points[points.length - 1];
  if (beat >= last.beat) return last.value;
  let i = 1;
  while (points[i].beat < beat) i++;
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = segment(points[i - 1], points[i]);
  if (x3 === x0) return y3;
  let lo = 0, hi = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (bez(x0, x1, x2, x3, mid) < beat) lo = mid; else hi = mid;
  }
  return bez(y0, y1, y2, y3, (lo + hi) / 2);
}

/** `n` evenly spaced values from `fromBeat` to `toBeat` (for AudioParam.setValueCurveAtTime). */
export function sampleCurve(points, fromBeat, toBeat, n, def) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = valueAt(points, fromBeat + ((toBeat - fromBeat) * i) / (n - 1 || 1), def);
  return out;
}

/** SVG path for the curve across [0, endX] px. X: beat → px, Y: value → px. */
export function curvePath(points, X, Y, endX, def) {
  if (!points.length) return `M0,${Y(def)} L${endX},${Y(def)}`;
  const f = (n) => n.toFixed(1);
  let d = `M0,${f(Y(points[0].value))} L${f(X(points[0].beat))},${f(Y(points[0].value))}`;
  for (let i = 1; i < points.length; i++) {
    const [, p1, p2, p3] = segment(points[i - 1], points[i]);
    d += ` C${f(X(p1[0]))},${f(Y(p1[1]))} ${f(X(p2[0]))},${f(Y(p2[1]))} ${f(X(p3[0]))},${f(Y(p3[1]))}`;
  }
  const last = points[points.length - 1];
  return `${d} L${f(endX)},${f(Y(last.value))}`;
}

/** Where a point's handles are drawn (beat positions), given its neighbours. */
export function handleBeats(points, i) {
  const p = points[i];
  const left = i > 0 ? p.beat - (p.ease * (p.beat - points[i - 1].beat)) / 2 : null;
  const right = i < points.length - 1 ? p.beat + (p.ease * (points[i + 1].beat - p.beat)) / 2 : null;
  return { left, right };
}
