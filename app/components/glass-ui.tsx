/* -------------------------------------------------------------------------
   GLASS-UI HELPERS — reusable "glowing neon glass" panels
   -------------------------------------------------------------------------
   One source of truth for the frosted-glass look used by the fish callout,
   the population chart, and any other overlay you add later. Either style
   an existing p5.Element in place, or inline the style string directly into
   a template literal.
   ------------------------------------------------------------------------- */

import type p5 from "p5";

export const GLASS_UI_CSS = {
  background: "rgba(10, 20, 35, 0.45)",
  border: "1px solid rgba(127, 212, 255, 0.3)",
  borderRadius: "16px",
  boxShadow:
    "0 8px 32px 0 rgba(0, 0, 0, 0.5), " +
    "inset 0 0 0 1px rgba(255, 255, 255, 0.1), " +
    "inset 2px 2px 6px rgba(255, 255, 255, 0.15), " +
    "0 0 30px rgba(60, 180, 255, 0.2)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
} as const;

export type GlassUIOverrides = Partial<
  Record<keyof typeof GLASS_UI_CSS, string>
>;

/* Holographic overrides for the glass helper — brighter border, layered
   neon glow, and an animated iridescent gradient (see ensureHoloStyles). */
export const HOLO_GLASS_OVERRIDES: GlassUIOverrides = {
  background:
    "linear-gradient(120deg, " +
    "rgba(0, 205, 255, 0.20) 0%, " +
    "rgba(120, 90, 255, 0.18) 38%, " +
    "rgba(255, 80, 200, 0.16) 66%, " +
    "rgba(0, 205, 255, 0.20) 100%)",
  border: "1px solid rgba(150, 235, 255, 0.6)",
  boxShadow:
    "0 0 18px rgba(80, 215, 255, 0.5), " +
    "0 0 44px rgba(140, 110, 255, 0.32), " +
    "inset 0 0 22px rgba(120, 220, 255, 0.2), " +
    "inset 0 0 0 1px rgba(255, 255, 255, 0.18)",
};

/* Chart-panel variant of the holographic glass.
   Keeps the iridescent border + neon glow from HOLO_GLASS_OVERRIDES, but
   darkens the fill to a frosted base (like GLASS_UI_CSS) so the chart
   canvas stays readable. */
export const MUTED_HOLO_GLASS_OVERRIDES: GlassUIOverrides = {
  // Low-alpha iridescent gradient over a dark frosted base.
  // The colour in the final layer is the background-color; the gradient
  // paints on top, and because its stops are mostly-transparent the dark
  // base shows through — muted shimmer, not a bright wash.
  background:
    "linear-gradient(120deg, " +
    "rgba(0, 205, 255, 0.10) 0%, " +
    "rgba(120, 90, 255, 0.09) 38%, " +
    "rgba(255, 80, 200, 0.08) 66%, " +
    "rgba(0, 205, 255, 0.10) 100%), " +
    "rgba(10, 20, 35, 0.65)", // raise 0.65 if you want more legiblte text
  border: HOLO_GLASS_OVERRIDES.border,
  boxShadow: HOLO_GLASS_OVERRIDES.boxShadow,
  // Extra frost over the p5 scene behind the card.
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
};

function kebabCase(camel: string): string {
  return camel.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

/** Apply the glass look to an existing p5.Element. */
export function applyGlassUI(
  el: p5.Element,
  overrides: GlassUIOverrides = {},
): void {
  const merged = { ...GLASS_UI_CSS, ...overrides };
  const node = el.elt as HTMLElement;
  for (const [key, value] of Object.entries(merged)) {
    node.style.setProperty(kebabCase(key), value);
  }
}

/** Glass style as an inline `key: value;` string for template HTML. */
export function glassUICss(overrides: GlassUIOverrides = {}): string {
  const merged = { ...GLASS_UI_CSS, ...overrides };
  return Object.entries(merged)
    .map(([key, value]) => `${kebabCase(key)}: ${value};`)
    .join(" ");
}

/** Create a ready-to-use glass panel (drop-in replacement for createAbsoluteDiv). */
export function createGlassDiv(
  p: p5,
  opts: {
    parent?: HTMLElement;
    id?: string;
    width?: string;
    padding?: string;
    zIndex?: string;
    overrides?: GlassUIOverrides;
  } = {},
): p5.Element {
  const el = p.createDiv("");
  if (opts.id) el.id(opts.id);
  if (opts.parent) el.parent(opts.parent);

  const node = el.elt as HTMLElement;
  node.style.position = "absolute";
  node.style.display = "none";
  node.style.boxSizing = "border-box";
  node.style.fontFamily = "var(--font-sans)";
  node.style.color = "#fff";
  node.style.pointerEvents = "auto";
  node.style.zIndex = opts.zIndex ?? "1000";
  if (opts.width) node.style.width = opts.width;
  node.style.padding = opts.padding ?? "16px";

  applyGlassUI(el, opts.overrides);

  const stopEvt = (e: Event) => e.stopPropagation();
  node.addEventListener("mousedown", stopEvt);
  node.addEventListener("touchstart", stopEvt, { passive: true });
  node.addEventListener("wheel", stopEvt, { passive: true });

  return el;
}
