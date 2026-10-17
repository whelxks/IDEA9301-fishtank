import type { Route } from "./+types/home";
import React, { useEffect, useRef, useState, useCallback } from 'react';

export function meta({}: Route.MetaArgs) {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

const CANVAS_W = 700;
const CANVAS_H = 400;

export default function Home() {
 const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Viewport size (kept in state so we re-render on resize)
  const [size, setSize] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 800,
    h: typeof window !== 'undefined' ? window.innerHeight : 600,
  }));

  // Single source of truth: the divider x-position == left window width
  const [leftW, setLeftW] = useState<number>(() =>
    (typeof window !== 'undefined' ? window.innerWidth : 800) / 2
  );
  const rightW = size.w - leftW;

  // -------- Keep up with window resize --------
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setSize({ w, h });
      setLeftW((prev) => Math.max(0, Math.min(prev, w)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // -------- Draw the two screens on a full-viewport canvas --------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle HiDPI for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    canvas.style.width = size.w + 'px';
    canvas.style.height = size.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = size.w;
    const H = size.h;

    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, W, H);

    // ---- LEFT SCREEN ----
    if (leftW > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, leftW, H);
      ctx.clip();

      ctx.fillStyle = '#2d141e';
      ctx.fillRect(0, 0, leftW, H);

      ctx.fillStyle = '#e6506e';
      ctx.beginPath();
      ctx.arc(leftW / 2, H / 2 - 20, 60, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '22px sans-serif';
      ctx.fillText('SCREEN A', leftW / 2, H / 2 - 20);
      ctx.font = '13px sans-serif';
      ctx.fillText(`width: ${Math.round(leftW)}px`, leftW / 2, H / 2 + 70);

      ctx.restore();
    }

    // ---- RIGHT SCREEN ----
    if (rightW > 0) {
      const rx = leftW;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, 0, rightW, H);
      ctx.clip();

      ctx.fillStyle = '#141e32';
      ctx.fillRect(rx, 0, rightW, H);

      ctx.fillStyle = '#5aaae6';
      ctx.fillRect(rx + rightW / 2 - 60, H / 2 - 80, 120, 120);

      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '22px sans-serif';
      ctx.fillText('SCREEN B', rx + rightW / 2, H / 2 - 20);
      ctx.font = '13px sans-serif';
      ctx.fillText(`width: ${Math.round(rightW)}px`, rx + rightW / 2, H / 2 + 70);

      ctx.restore();
    }

    // ---- Divider line (only when both panes visible) ----
    if (leftW > 0 && rightW > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(leftW, 0);
      ctx.lineTo(leftW, H);
      ctx.stroke();
    }
  }, [leftW, rightW, size]);

  // -------- Drag logic for the divider handle --------
  const dragging = useRef(false);

  const startDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  const moveDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      setLeftW(Math.max(0, Math.min(size.w, e.clientX)));
    },
    [size.w]
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#141414',
        userSelect: 'none',
      }}
    >
      {/* Full-viewport canvas */}
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
      />

      {/* Invisible tall hit-area so the whole divider is grabbable */}
      <div
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: 'absolute',
          left: leftW,
          top: 0,
          height: '100%',
          width: 20,
          transform: 'translateX(-50%)',
          cursor: 'ew-resize',
          zIndex: 9,
          touchAction: 'none',
        }}
      />

      {/* Visible grip centred on the divider */}
      <div
        role="slider"
        aria-label="Resize divider"
        aria-valuemin={0}
        aria-valuemax={size.w}
        aria-valuenow={Math.round(leftW)}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: 'absolute',
          left: leftW,
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 26,
          height: 90,
          borderRadius: 13,
          background: '#fff',
          boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
          cursor: 'ew-resize',
          zIndex: 10,
          touchAction: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        <div style={{ width: 2, height: 22, background: '#888', borderRadius: 1 }} />
        <div style={{ width: 2, height: 22, background: '#888', borderRadius: 1 }} />
      </div>
    </div>
  );
};
