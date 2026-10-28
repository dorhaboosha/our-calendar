// Rules for the color each user picks for their events: it must stand out from the
// white page and be clearly different from the other calendar colors.

/** WCAG 1.4.11 minimum contrast for non-text elements, against the white page. */
export const MIN_BACKGROUND_CONTRAST = 3;
/** Minimum CIE76 distance between two calendar colors (about 20 is clearly different). */
export const MIN_COLOR_DISTANCE = 20;

const PAGE_BACKGROUND = "#ffffff";
const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

type Rgb = [number, number, number];

export function isHexColor(value: string): boolean {
  return HEX_PATTERN.test(value);
}

function toRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, from 1 (same) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black or white, whichever is more readable on the given background. */
export function textColorFor(background: string): "#000000" | "#ffffff" {
  return contrastRatio(background, "#ffffff") >= contrastRatio(background, "#000000")
    ? "#ffffff"
    : "#000000";
}

function toLab(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map(linearize);
  // sRGB -> XYZ (D65 white point), then CIELAB.
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 delta E: about 2 is barely noticeable, 20 or more is clearly a different color. */
export function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

export type ColorCheck =
  | { ok: true; color: string }
  | { ok: false; reason: "invalid" | "tooLight" }
  | { ok: false; reason: "tooSimilar"; conflictWith: string };

/**
 * @param others colors already in use, keyed by a label for the error message
 *   (the other user's name, or the label for shared events).
 */
export function checkUserColor(color: string, others: Record<string, string>): ColorCheck {
  if (!isHexColor(color)) return { ok: false, reason: "invalid" };
  const normalized = color.toLowerCase();
  if (contrastRatio(normalized, PAGE_BACKGROUND) < MIN_BACKGROUND_CONTRAST) {
    return { ok: false, reason: "tooLight" };
  }
  for (const [label, other] of Object.entries(others)) {
    if (colorDistance(normalized, other) < MIN_COLOR_DISTANCE) {
      return { ok: false, reason: "tooSimilar", conflictWith: label };
    }
  }
  return { ok: true, color: normalized };
}
