import type { CSSProperties } from "react";

type PaneLabelProps = {
  text: string;
  color?: string;
  size?: number | string;
  left?: string;
  width?: string;
  bottom?: number | string;
  style?: CSSProperties;
};

export function PaneLabel({
  text,
  color = "#7fd4ff",
  size = 14,
  left = "0%",
  width = "100%",
  bottom = 24,
  style,
}: PaneLabelProps) {
  return (
    <div
      style={{
        position: "absolute",
        left,
        width,
        bottom,
        // Use flex to perfectly center the pill horizontally
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        ...style,
      }}
    >
      <div
        style={{
          // 1. Glass Theme Container
          background: "rgba(10, 20, 35, 0.35)", // Dark frosted base
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: `1px solid ${color}33`, // 20% opacity of the text color
          borderRadius: "999px", // Pill shape
          padding: "6px 16px",
          boxShadow:
            "0 4px 12px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.05)",

          // 2. Typography (Aesthetic & Subtle)
          color: color,
          fontSize: size,
          fontFamily: "var(--font-sans), sans-serif",
          fontWeight: 600,
          letterSpacing: "0.15em", // Wide tracking looks very modern
          textTransform: "uppercase", // Uppercase makes it read as a label

          // 3. Recede into the background
          opacity: 0.85,
          textShadow: "0 1px 2px rgba(0,0,0,0.5)", // Subtle drop shadow for legibility over sand

          // Ensure it doesn't break onto two lines awkwardly
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </div>
    </div>
  );
}
