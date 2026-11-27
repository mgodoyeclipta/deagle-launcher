/**
 * Crosshair model and geometry, mirroring cs16-client's drawing code
 * (cl_dll/ammo.cpp: CHudAmmo::DrawCrosshair and GetCrosshairGap), so the
 * launcher preview matches what you get in game.
 */

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];
export type ClassicSize = "auto" | "small" | "medium" | "large";

export interface CrosshairConfig {
  /** xhair_enable: cs16-client's enhanced crosshair instead of the classic one. */
  enabled: boolean;
  color: RGBA;
  size: number;
  gap: number;
  thick: number;
  pad: number;
  dot: boolean;
  t: boolean;
  additive: boolean;
  dynamicScale: number;
  useWeaponGap: boolean;
  dynamicMove: boolean;
  classicColor: RGB;
  classicSize: ClassicSize;
  classicTranslucent: boolean;
  classicDynamic: boolean;
  hudColor: RGB;
}

/** cs16-client's own defaults for every cvar. */
export const DEFAULT_CROSSHAIR: CrosshairConfig = {
  enabled: false,
  color: [0, 255, 0, 255],
  size: 4,
  gap: 0,
  thick: 0,
  pad: 0,
  dot: false,
  t: false,
  additive: false,
  dynamicScale: 0,
  useWeaponGap: false,
  dynamicMove: true,
  classicColor: [50, 250, 50],
  classicSize: "auto",
  classicTranslucent: true,
  classicDynamic: true,
  hudColor: [255, 160, 0],
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function parseNumbers(value: string | undefined, count: number): number[] | null {
  if (!value) return null;
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length < count || parts.slice(0, count).some((n) => !Number.isFinite(n))) return null;
  return parts.slice(0, count).map((n) => clamp(Math.round(n), 0, 255));
}

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) ? n : fallback;
};
const bool = (value: string | undefined, fallback: boolean) =>
  value === undefined ? fallback : Number(value) !== 0;

export function fromCvars(cvars: Record<string, string>): CrosshairConfig {
  const d = DEFAULT_CROSSHAIR;
  const size = cvars.cl_crosshair_size as ClassicSize | undefined;
  return {
    enabled: bool(cvars.xhair_enable, d.enabled),
    color: (parseNumbers(cvars.xhair_color, 4) as RGBA | null) ?? d.color,
    size: num(cvars.xhair_size, d.size),
    gap: num(cvars.xhair_gap, d.gap),
    thick: num(cvars.xhair_thick, d.thick),
    pad: num(cvars.xhair_pad, d.pad),
    dot: bool(cvars.xhair_dot, d.dot),
    t: bool(cvars.xhair_t, d.t),
    additive: bool(cvars.xhair_additive, d.additive),
    dynamicScale: num(cvars.xhair_dynamic_scale, d.dynamicScale),
    useWeaponGap: bool(cvars.xhair_gap_useweaponvalue, d.useWeaponGap),
    dynamicMove: bool(cvars.xhair_dynamic_move, d.dynamicMove),
    classicColor: (parseNumbers(cvars.cl_crosshair_color, 3) as RGB | null) ?? d.classicColor,
    classicSize: size && ["auto", "small", "medium", "large"].includes(size) ? size : d.classicSize,
    classicTranslucent: bool(cvars.cl_crosshair_translucent, d.classicTranslucent),
    classicDynamic: bool(cvars.cl_dynamiccrosshair, d.classicDynamic),
    hudColor: (parseNumbers(cvars.hud_color, 3) as RGB | null) ?? d.hudColor,
  };
}

const flag = (b: boolean) => (b ? "1" : "0");
const decimal = (n: number) => String(Math.round(n * 10) / 10);

export function toCvars(c: CrosshairConfig): Record<string, string> {
  return {
    xhair_enable: flag(c.enabled),
    xhair_color: c.color.join(" "),
    xhair_size: decimal(c.size),
    xhair_gap: decimal(c.gap),
    xhair_thick: decimal(c.thick),
    xhair_pad: String(Math.round(c.pad)),
    xhair_dot: flag(c.dot),
    xhair_t: flag(c.t),
    xhair_additive: flag(c.additive),
    xhair_dynamic_scale: decimal(c.dynamicScale),
    xhair_gap_useweaponvalue: flag(c.useWeaponGap),
    xhair_dynamic_move: flag(c.dynamicMove),
    cl_crosshair_color: c.classicColor.join(" "),
    cl_crosshair_size: c.classicSize,
    cl_crosshair_translucent: flag(c.classicTranslucent),
    cl_dynamiccrosshair: flag(c.classicDynamic),
    hud_color: c.hudColor.join(" "),
  };
}

export const sameConfig = (a: CrosshairConfig, b: CrosshairConfig) =>
  JSON.stringify(toCvars(a)) === JSON.stringify(toCvars(b));

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

export function toHex([r, g, b]: RGB | RGBA): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 255, 0];
}

export const rgba = ([r, g, b]: RGB | RGBA, a = 255) => `rgba(${r}, ${g}, ${b}, ${a / 255})`;

// ---------------------------------------------------------------------------
// Weapons (gap behaviour from GetCrosshairGap)
// ---------------------------------------------------------------------------

export interface WeaponGap {
  id: string;
  label: string;
  minGap: number;
  deltaGap: number;
}

export const PREVIEW_WEAPONS: WeaponGap[] = [
  { id: "ak47", label: "AK-47", minGap: 4, deltaGap: 4 },
  { id: "m4a1", label: "M4A1", minGap: 4, deltaGap: 3 },
  { id: "deagle", label: "Desert Eagle", minGap: 8, deltaGap: 3 },
  { id: "usp", label: "USP", minGap: 8, deltaGap: 3 },
  { id: "mp5", label: "MP5", minGap: 6, deltaGap: 2 },
  { id: "m3", label: "M3", minGap: 8, deltaGap: 6 },
];

const MAX_XHAIR_GAP = 15;

/** Gap the weapon rests at (standing still, not shooting). */
export function restingGap(c: CrosshairConfig, weapon: WeaponGap): number {
  return c.useWeaponGap ? weapon.minGap : 4;
}

/** One shot: what the client adds when the shot counter increases. */
export function gapAfterShot(current: number, c: CrosshairConfig, weapon: WeaponGap): number {
  return Math.min(current + weapon.deltaGap * c.dynamicScale, MAX_XHAIR_GAP);
}

/** Decay between frames, "as if we were always running at 100 fps". */
export function decayGap(current: number, dtSeconds: number, minGap: number): number {
  const next = current - 100 * dtSeconds * (0.013 * current + 0.1);
  return Math.max(next, minGap);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({
  x: Math.min(x0, x1),
  y: Math.min(y0, y1),
  w: Math.abs(x1 - x0),
  h: Math.abs(y1 - y0),
});

/** C's rint(): rounds half to even (4.5 → 4), unlike Math.round. */
export function rint(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** C's integer division by 2 truncates toward zero. */
const half = (n: number) => Math.trunc(n / 2);

/**
 * Bars (and their black padding) of the enhanced crosshair, in screen pixels
 * for a game running at `screenHeight`, centred at (cx, cy).
 * `gapUnits` is the weapon gap from the model, before adding xhair_gap.
 */
export function enhancedRects(
  c: CrosshairConfig,
  gapUnits: number,
  screenHeight: number,
  cx: number,
  cy: number,
): { bars: Rect[]; padding: Rect[] } {
  const scale = screenHeight / 480; // "default" resolution is 640x480
  const gap = rint((gapUnits + c.gap) * scale);
  const length = rint(c.size * scale);
  const thickness = Math.max(1, rint(c.thick * scale));

  const innerLeft = cx - gap - half(thickness);
  const innerRight = innerLeft + 2 * gap + thickness;
  const innerTop = cy - gap - half(thickness);
  const innerBottom = innerTop + 2 * gap + thickness;
  const outerLeft = innerLeft - length;
  const outerRight = innerRight + length;
  const outerTop = innerTop - length;
  const outerBottom = innerBottom + length;
  const y0 = cy - half(thickness);
  const x0 = cx - half(thickness);
  const y1 = y0 + thickness;
  const x1 = x0 + thickness;

  const sections: [number, number, number, number][] = [];
  if (c.dot) sections.push([x0, y0, x1, y1]);
  if (!c.t) sections.push([x0, outerTop, x1, innerTop]);
  sections.push([x0, innerBottom, x1, outerBottom]);
  sections.push([outerLeft, y0, innerLeft, y1]);
  sections.push([innerRight, y0, outerRight, y1]);

  const bars = sections.filter(([a, b, c2, d]) => a !== c2 && b !== d).map(([a, b, c2, d]) => rect(a, b, c2, d));

  // Padding is not scaled with resolution.
  const pad = Math.round(c.pad);
  const padding: Rect[] = [];
  if (pad > 0) {
    for (const [sx0, sy0, sx1, sy1] of sections) {
      padding.push(rect(sx0 - pad, sy0 - pad, sx1 + pad, sy0)); // top
      padding.push(rect(sx0 - pad, sy1, sx1 + pad, sy1 + pad)); // bottom
      padding.push(rect(sx0 - pad, sy0, sx0, sy1)); // left
      padding.push(rect(sx1, sy0, sx1 + pad, sy1)); // right
    }
  }
  return { bars, padding };
}

const CLASSIC_SCALE_BASE: Record<Exclude<ClassicSize, "auto">, number> = {
  small: 1024,
  medium: 800,
  large: 640,
};

/** The stock CS 1.6 crosshair at rest: 1 px lines, gap 4 and length 5 at its scale base. */
export function classicRects(c: CrosshairConfig, screenWidth: number, cx: number, cy: number): Rect[] {
  const base =
    c.classicSize === "auto"
      ? screenWidth >= 1024
        ? 640
        : screenWidth > 640
          ? 800
          : 640
      : CLASSIC_SCALE_BASE[c.classicSize];
  const distance = Math.round((screenWidth * 4) / base);
  const length = Math.round((screenWidth * 5) / base);
  return [
    rect(cx - distance - length, cy, cx - distance, cy + 1),
    rect(cx + distance + 1, cy, cx + distance + 1 + length, cy + 1),
    rect(cx, cy - distance - length, cx + 1, cy - distance),
    rect(cx, cy + distance + 1, cx + 1, cy + distance + 1 + length),
  ];
}
