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
