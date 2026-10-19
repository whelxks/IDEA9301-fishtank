import type { Route } from "./+types/home";
import React, { useCallback, useRef, useState } from "react";
import Aquarium from "./aquarium/aquarium";
import { PaneLabel } from "~/components/text";
import EndangeredAquarium from "./endangered-aquarium/endangered-aquarium";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

// Bounds for the divider, as a fraction of the viewport.
// Set to e.g. 0.1 / 0.9 if you never want a pane to fully collapse.
const MIN_FRAC = 0;
const MAX_FRAC = 1;

export default function Home() {
  // Fraction of the container width taken by the left pane.
  // Percentages instead of pixels => the server-rendered HTML already
  // fills 100vw, with no "800px" fallback and no hydration jump.
  const [leftFrac, setLeftFrac] = useState(0.5);

  const dragging = useRef(false);

  const setFromClientX = useCallback((clientX: number) => {
    // Container is `fixed inset:0` / 100vw, so clientX maps 1:1.
    const w = window.innerWidth || 1;
    setLeftFrac(Math.min(MAX_FRAC, Math.max(MIN_FRAC, clientX / w)));
  }, []);

  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setFromClientX(e.clientX); // jump handle to the pointer
      e.preventDefault();
    },
    [setFromClientX],
  );

  const moveDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      setFromClientX(e.clientX);
    },
    [setFromClientX],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setLeftFrac((f) => Math.max(MIN_FRAC, f - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setLeftFrac((f) => Math.min(MAX_FRAC, f + step));
    } else if (e.key === "Home") {
      e.preventDefault();
      setLeftFrac(MIN_FRAC);
    } else if (e.key === "End") {
      e.preventDefault();
      setLeftFrac(MAX_FRAC);
    }
  }, []);

  const pct = leftFrac * 100;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#141414",
      }}
    >
      {/* ---- LEFT pane ---- */}
      {leftFrac > MIN_FRAC && (
        <>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: `${pct}%`,
              height: "100%",
              overflow: "hidden", // clips the child component
            }}
          >
            <EndangeredAquarium />
          </div>
          <PaneLabel
            text="fishes in the past year"
            left="0%"
            width={`${pct}%`}
            color="#ffffff"
          />
        </>
      )}

      {/* ---- RIGHT pane ---- */}
      {leftFrac < MAX_FRAC && (
        <>
          <div
            style={{
              position: "absolute",
              left: `${pct}%`,
              top: 0,
              width: `${100 - pct}%`,
              height: "100%",
              overflow: "hidden",
              userSelect: "none",
            }}
          >
            <Aquarium />
          </div>

          <PaneLabel
            text="fishes you want to see in 5 years"
            left={`${pct}%`}
            width={`${100 - pct}%`}
            color="#7fd4ff"
          />
        </>
      )}

      {/* ---- Divider line (only when both panes exist) ---- */}
      {leftFrac > MIN_FRAC && leftFrac < MAX_FRAC && (
        <div
          style={{
            position: "absolute",
            left: `${pct}%`,
            top: 0,
            width: 2,
            height: "100%",
            transform: "translateX(-50%)",
            background: "rgba(255,255,255,0.85)",
            pointerEvents: "none",
            zIndex: 9,
          }}
        />
      )}

      {/* ---- Drag hit area ---- */}
      <div
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        role="slider"
        tabIndex={0}
        aria-label="Resize divider"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={`${Math.round(pct)}%`}
        style={{
          position: "absolute",
          left: `${pct}%`,
          top: 0,
          height: "100%",
          width: 28,
          transform: "translateX(-50%)",
          cursor: "ew-resize",
          touchAction: "none",
          zIndex: 10,
        }}
      />

      {/* ---- Visible grip ---- */}
      <div
        style={{
          position: "absolute",
          left: `${pct}%`,
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 26,
          height: 90,
          borderRadius: 13,
          background: "#fff",
          boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          pointerEvents: "none", // hit area above handles the input
          zIndex: 10,
        }}
      >
        <div
          style={{ width: 2, height: 22, background: "#888", borderRadius: 1 }}
        />
        <div
          style={{ width: 2, height: 22, background: "#888", borderRadius: 1 }}
        />
      </div>
    </div>
  );
}
