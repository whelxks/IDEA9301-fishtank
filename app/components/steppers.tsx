import React from "react";
import { GLASS_UI_CSS } from "./glass-ui";

export const THEME = {
  bg: "rgb(3, 14, 24)",
  text: "#fff",
  accent: "#43CBCD", // buttons etc.
  accentLight: "#8AF1DF",
  stepActive: "#53D7C7", // selected stepper pill
};

const FONT = "'Poppins', sans-serif";

/* -------------------------------- STEPPER -------------------------------- */
// Three steps joined by longer connectors. The current step is a solid
// #43CBCD pill; the others are faded, outlined, regular-weight tags.
const STEPS = [
  { n: 1, label: "Customise" }, // /color
  { n: 2, label: "Community tank" }, // /completed
  { n: 3, label: "NFC tag" }, // /nfc-collect
] as const;

export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <nav aria-label="Progress" style={stepper.row}>
      {STEPS.map((step, i) => {
        const active = step.n === current;
        return (
          <React.Fragment key={step.n}>
            <span
              aria-current={active ? "step" : undefined}
              style={{ ...stepper.pill, ...(active ? stepper.pillActive : {}) }}
            >
              {step.n}: {step.label}
            </span>
            {i < STEPS.length - 1 && <span aria-hidden style={stepper.line} />}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

const stepper: Record<string, React.CSSProperties> = {
  row: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    rowGap: 10,
    marginBottom: 30,
    maxWidth: "100%",
  },
  // Inactive: faded text, regular weight, soft outline, translucent fill
  pill: {
    padding: "9px 18px",
    borderRadius: 999,
    background: "rgba(251, 243, 225, 0.04)",
    border: "1px solid rgba(255, 255, 255, 0.18)",
    color: "rgba(255, 255, 255, 0.5)",
    fontSize: 11.5,
    fontWeight: 400,
    letterSpacing: 0.3,
    whiteSpace: "nowrap",
    transition: "all 0.25s ease",
  },

  // Active: glass panel with a #53D7C7 tint
  pillActive: {
    ...GLASS_UI_CSS,
    borderRadius: 999, // glass default is 16px, pills need a full round
    // Teal tint over the dark frosted base (same layering trick as MUTED_HOLO)
    background:
      "linear-gradient(120deg, rgba(83, 215, 199, 0.5) 0%, rgba(83, 215, 199, 0.28) 100%), " +
      "rgba(10, 20, 35, 0.45)",
    border: "1px solid transparent", // same size as inactive pills, no outline
    color: "#fff",
    fontWeight: 600,
    textShadow: "0 1px 2px rgba(0, 0, 0, 0.35)",
    // Slimmed-down glass shadow: soft drop, white inner highlights, teal glow
    boxShadow:
      "0 4px 16px rgba(0, 0, 0, 0.35), " +
      "inset 0 0 0 1px rgba(255, 255, 255, 0.18), " +
      "inset 2px 2px 6px rgba(255, 255, 255, 0.2), " +
      "0 0 22px rgba(83, 215, 199, 0.35)",
  },
  // Solid, clearly visible connector between pills
  line: {
    width: 24,
    height: 1,
    flexShrink: 0,
    background: "rgba(255, 255, 255, 0.45)",
  },
};

/* ------------------------------- PAGE SHELL ------------------------------ */
export default function StudioPage({
  step,
  children,
}: {
  step: 1 | 2 | 3 | null;
  children: React.ReactNode;
}) {
  return (
    <div className="studio-page" style={studioStyles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
        /* Buttons and inputs don't inherit fonts by default */
        .studio-page, .studio-page button, .studio-page input {
          font-family: ${FONT};
        }
      `}</style>
      {step != null && <Stepper current={step} />}
      {children}
    </div>
  );
}

/* Shared styles for the /completed and /nfc-collect pages. */
export const studioStyles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: THEME.bg,
    color: THEME.text,
    fontFamily: FONT,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "28px 16px 32px",
    boxSizing: "border-box",
  },
  title: {
    fontFamily: FONT,
    fontSize: 26,
    margin: "0 0 18px",
    fontWeight: 700,
    textAlign: "center",
  },
  card: {
    borderRadius: 20,
    background: "#f3efe4",
    boxShadow: "0 12px 30px rgba(0,0,0,0.3)",
    padding: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    fontSize: 15,
    lineHeight: 1.5,
    textAlign: "center",
    margin: "0 0 14px",
    maxWidth: 340,
    color: "#fff",
  },
  link: { color: "#fff", fontWeight: 600, textDecoration: "underline" },
  primaryBtn: {
    display: "inline-block",
    padding: "14px 30px",
    borderRadius: 999,
    border: "none",
    background: THEME.accent,
    color: "#fff",
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: 700,
    textShadow: "0 1px 2px rgba(0, 0, 0, 0.35)",
    textDecoration: "none",
    cursor: "pointer",
    boxShadow: "0 0 22px rgba(67, 203, 205, 0.35)",
  },
};
