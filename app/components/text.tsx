import type { CSSProperties, ReactNode } from "react";

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
  size = 40,
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
        textAlign: "center",
        color,
        pointerEvents: "none",
        fontFamily: "'MarinaSundaland', sans-serif",
        fontSize: size,
        ...style,
      }}
    >
      {text}
    </div>
  );
}