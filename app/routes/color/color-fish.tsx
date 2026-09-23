import React, { useRef, useState, useEffect, useCallback } from 'react';
import { supabase, addNewFish } from '../../lib/supabase';

/* =========================================================================
   SUPABASE CONFIG
   -------------------------------------------------------------------------
   Client config lives in lib/supabase.ts (VITE_SUPABASE_URL / 
   VITE_SUPABASE_ANON_KEY). This file uses the shared `supabase` client
   and the `addNewFish` helper for inserts.

   Storage: create a PUBLIC bucket named "fish-uploads".
   Database:

      create table fish_uploads (
        id uuid default gen_random_uuid() primary key,
        image_url text not null,
        outline text,
        created_at timestamp with time zone default now()
      );

   ========================================================================= */
const STORAGE_BUCKET = 'fish';

/* --------------------------- CANVAS RESOLUTION -------------------------- */
const CANVAS_W = 320;
const CANVAS_H = 360;

/* ------------------------------ FISH OUTLINES ---------------------------
   Each outline builds one path (may contain several sub-shapes) onto the
   given context. The caller decides whether to stroke, fill, or clip it —
   this function only defines the shape.
   ------------------------------------------------------------------------ */
type OutlineDef = {
  label: string;
  eye: { x: number; y: number };
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
};

const FISH_OUTLINES: Record<string, OutlineDef> = {
  classic: {
    label: 'Classic',
    eye: { x: 0.30, y: 0.44 },
    draw(ctx, w, h) {
      ctx.beginPath();
      ctx.ellipse(w * 0.42, h * 0.5, w * 0.28, h * 0.22, 0, 0, Math.PI * 2);
      ctx.moveTo(w * 0.68, h * 0.5);
      ctx.lineTo(w * 0.92, h * 0.26);
      ctx.lineTo(w * 0.92, h * 0.74);
      ctx.closePath();
      ctx.moveTo(w * 0.40, h * 0.30);
      ctx.lineTo(w * 0.50, h * 0.08);
      ctx.lineTo(w * 0.56, h * 0.32);
      ctx.closePath();
      ctx.moveTo(w * 0.40, h * 0.70);
      ctx.lineTo(w * 0.48, h * 0.92);
      ctx.lineTo(w * 0.55, h * 0.68);
      ctx.closePath();
    }
  },
  round: {
    label: 'Round',
    eye: { x: 0.34, y: 0.42 },
    draw(ctx, w, h) {
      ctx.beginPath();
      ctx.ellipse(w * 0.48, h * 0.5, w * 0.30, h * 0.28, 0, 0, Math.PI * 2);
      ctx.moveTo(w * 0.76, h * 0.5);
      ctx.lineTo(w * 0.92, h * 0.38);
      ctx.lineTo(w * 0.92, h * 0.62);
      ctx.closePath();
      ctx.moveTo(w * 0.44, h * 0.24);
      ctx.lineTo(w * 0.50, h * 0.08);
      ctx.lineTo(w * 0.57, h * 0.26);
      ctx.closePath();
    }
  },
  angel: {
    label: 'Angel',
    eye: { x: 0.32, y: 0.40 },
    draw(ctx, w, h) {
      ctx.beginPath();
      ctx.ellipse(w * 0.46, h * 0.52, w * 0.20, h * 0.32, 0, 0, Math.PI * 2);
      ctx.moveTo(w * 0.40, h * 0.24);
      ctx.lineTo(w * 0.50, h * 0.02);
      ctx.lineTo(w * 0.55, h * 0.28);
      ctx.closePath();
      ctx.moveTo(w * 0.40, h * 0.78);
      ctx.lineTo(w * 0.48, h * 0.98);
      ctx.lineTo(w * 0.55, h * 0.74);
      ctx.closePath();
      ctx.moveTo(w * 0.62, h * 0.52);
      ctx.lineTo(w * 0.84, h * 0.34);
      ctx.lineTo(w * 0.84, h * 0.70);
      ctx.closePath();
    }
  }
};

/* --------------------------------- STAMPS -------------------------------- */
function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  const points = 5;
  const step = Math.PI / points;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const angle = i * step - Math.PI / 2;
    const x = cx + Math.cos(angle) * rad;
    const y = cy + Math.sin(angle) * rad;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  const s = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.3);
  ctx.bezierCurveTo(cx, cy, cx - s, cy, cx - s, cy + s * 0.3);
  ctx.bezierCurveTo(cx - s, cy + s * 0.7, cx, cy + s * 0.85, cx, cy + s * 1.1);
  ctx.bezierCurveTo(cx, cy + s * 0.85, cx + s, cy + s * 0.7, cx + s, cy + s * 0.3);
  ctx.bezierCurveTo(cx + s, cy, cx, cy, cx, cy + s * 0.3);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

type StampDef = {
  id: string;
  label: string;
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) => void;
};

const STAMPS: StampDef[] = [
  { id: 'dot', label: 'Dot', draw: (ctx, x, y, size, color) => {
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    } },
  { id: 'star', label: 'Star', draw: (ctx, x, y, size, color) => drawStar(ctx, x, y, size / 2, color) },
  { id: 'heart', label: 'Heart', draw: (ctx, x, y, size, color) => drawHeart(ctx, x, y, size, color) },
  { id: 'stripe', label: 'Stripe', draw: (ctx, x, y, size, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x - size * 0.15, y - size * 0.6, size * 0.3, size * 1.2);
    } }
];

const COLORS = ['#ef6f53', '#e7a93c', '#f4d35e', '#5fb49c', '#3f7cac', '#9b5de5', '#f2f2f2', '#1b2e2c'];

type Status = 'idle' | 'uploading' | 'sent' | 'error';

/* ================================ COMPONENT ============================== */
export default function FishColoringStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef<{ drawing: boolean; lastX: number; lastY: number }>({
    drawing: false, lastX: 0, lastY: 0
  });
  const dragRef = useRef<{ dragging: boolean; startY: number }>({
    dragging: false, startY: 0
  });

  const [outlineId, setOutlineId] = useState('classic');
  const [tool, setTool] = useState<'brush' | 'stamp'>('brush');
  const [stampId, setStampId] = useState('dot');
  const [color, setColor] = useState(COLORS[0]);
  const [brushSize, setBrushSize] = useState(14);
  const [dragOffset, setDragOffset] = useState(0);
  const [status, setStatus] = useState<Status>('idle');

  const resetCanvas = useCallback((id: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.restore(); // undo previous session's clip, if any (no-op the first time)
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fbf3e1';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const outline = FISH_OUTLINES[id];
    outline.draw(ctx, canvas.width, canvas.height);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#1b2e2c';
    ctx.stroke();

    // decorative eye, drawn before the clip so users can still paint over it
    const eye = outline.eye;
    ctx.beginPath();
    ctx.arc(canvas.width * eye.x, canvas.height * eye.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#1b2e2c';
    ctx.fill();

    ctx.save();               // checkpoint to restore to on the next reset
    outline.draw(ctx, canvas.width, canvas.height);
    ctx.clip();                // keeps every future stroke/stamp inside the fish
  }, []);

  useEffect(() => { resetCanvas(outlineId); }, [outlineId, resetCanvas]);

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const pos = getPos(e);
    paintRef.current = { drawing: true, lastX: pos.x, lastY: pos.y };
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (tool === 'stamp') {
      const stamp = STAMPS.find((s) => s.id === stampId);
      stamp?.draw(ctx, pos.x, pos.y, brushSize * 3, color);
    } else {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!paintRef.current.drawing || tool !== 'brush') return;
    const pos = getPos(e);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(paintRef.current.lastX, paintRef.current.lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    paintRef.current.lastX = pos.x;
    paintRef.current.lastY = pos.y;
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    paintRef.current.drawing = false;
    try { canvasRef.current?.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
  }

  /* --------------------------- swipe-up-to-send -------------------------- */
  function handleDragStart(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { dragging: true, startY: e.clientY };
  }
  function handleDragMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current.dragging) return;
    const dy = dragRef.current.startY - e.clientY;
    setDragOffset(Math.max(0, Math.min(dy, 140)));
  }
  function handleDragEnd() {
    if (!dragRef.current.dragging) return;
    dragRef.current.dragging = false;
    if (dragOffset > 90) sendFish();
    setDragOffset(0);
  }

  async function sendFish() {
    if (status === 'uploading') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setStatus('uploading');
    try {
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Canvas is empty');
      const fileName = `fish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;

      const { error: uploadError } = await supabase
        .storage.from(STORAGE_BUCKET)
        .upload(fileName, blob, { contentType: 'image/png' });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);

      const inserted = await addNewFish(publicUrlData.publicUrl, outlineId);
      if (!inserted) throw new Error('Insert failed');

      setStatus('sent');
      setTimeout(() => { setStatus('idle'); resetCanvas(outlineId); }, 1600);
    } catch (err) {
      console.error('Fish upload failed:', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
    }
  }

  const statusText: Record<Status, string> = {
    idle: 'Swipe up to send it swimming',
    uploading: 'Sending your fish…',
    sent: 'Off it goes! 🐟',
    error: 'Something went wrong — try again'
  };

  return (
    <div style={styles.page}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700&family=Inter:wght@400;500;600&display=swap');`}</style>

      <h1 style={styles.title}>Color your fish</h1>

      <div style={styles.outlineRow}>
        {Object.entries(FISH_OUTLINES).map(([id, o]) => (
          <button
            key={id}
            onClick={() => setOutlineId(id)}
            style={{ ...styles.outlineChip, ...(outlineId === id ? styles.outlineChipActive : {}) }}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div style={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={styles.canvas}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </div>

      <div style={styles.tray}>
        <div style={styles.toolRow}>
          <button style={{ ...styles.toolBtn, ...(tool === 'brush' ? styles.toolBtnActive : {}) }} onClick={() => setTool('brush')}>Brush</button>
          <button style={{ ...styles.toolBtn, ...(tool === 'stamp' ? styles.toolBtnActive : {}) }} onClick={() => setTool('stamp')}>Stamp</button>
          <input
            type="range" min="4" max="34" value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            style={styles.slider}
          />
        </div>

        {tool === 'stamp' && (
          <div style={styles.stampRow}>
            {STAMPS.map((s) => (
              <button
                key={s.id}
                onClick={() => setStampId(s.id)}
                style={{ ...styles.stampBtn, ...(stampId === s.id ? styles.stampBtnActive : {}) }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div style={styles.paletteRow}>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{ ...styles.swatch, background: c, ...(color === c ? styles.swatchActive : {}) }}
              aria-label={`color ${c}`}
            />
          ))}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={styles.customSwatch} />
        </div>
      </div>

      <div
        style={styles.sendHandle}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
      >
        <div style={{ ...styles.sendPill, transform: `translateY(${-dragOffset}px)` }}>
          <div style={styles.sendBar} />
          <span style={styles.sendText}>{statusText[status]}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- STYLES -------------------------------- */
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', background: '#0e2f36', color: '#fbf3e1',
    fontFamily: "'Inter', sans-serif", display: 'flex', flexDirection: 'column',
    alignItems: 'center', padding: '28px 16px 0', boxSizing: 'border-box'
  },
  title: { fontFamily: "'Baloo 2', sans-serif", fontSize: 26, margin: '0 0 18px', fontWeight: 700 },
  outlineRow: { display: 'flex', gap: 10, marginBottom: 18 },
  outlineChip: {
    padding: '8px 18px', borderRadius: 999, border: '1px solid #3f5c5c',
    background: 'transparent', color: '#cfe3df', fontFamily: "'Inter', sans-serif",
    fontSize: 14, cursor: 'pointer'
  },
  outlineChipActive: { background: '#e7a93c', color: '#1b2e2c', border: '1px solid #e7a93c', fontWeight: 600 },
  canvasWrap: { borderRadius: 18, overflow: 'hidden', boxShadow: '0 12px 30px rgba(0,0,0,0.35)' },
  canvas: { display: 'block', width: 260, height: 292, touchAction: 'none', background: '#fbf3e1' },
  tray: {
    width: '100%', maxWidth: 340, background: '#123c42', borderRadius: 16,
    marginTop: 18, padding: 14, boxSizing: 'border-box'
  },
  toolRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  toolBtn: {
    padding: '7px 14px', borderRadius: 10, border: '1px solid #3f5c5c',
    background: 'transparent', color: '#cfe3df', fontSize: 13, cursor: 'pointer'
  },
  toolBtnActive: { background: '#ef6f53', border: '1px solid #ef6f53', color: '#1b2e2c', fontWeight: 600 },
  slider: { flex: 1 },
  stampRow: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  stampBtn: {
    padding: '6px 12px', borderRadius: 8, border: '1px solid #3f5c5c',
    background: 'transparent', color: '#cfe3df', fontSize: 12, cursor: 'pointer'
  },
  stampBtnActive: { background: '#5fb49c', border: '1px solid #5fb49c', color: '#0e2f36', fontWeight: 600 },
  paletteRow: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  swatch: { width: 28, height: 28, borderRadius: 8, border: '2px solid transparent', cursor: 'pointer' },
  swatchActive: { border: '2px solid #fbf3e1' },
  customSwatch: { width: 30, height: 30, border: 'none', background: 'none', cursor: 'pointer' },
  sendHandle: {
    width: '100%', maxWidth: 340, marginTop: 18, marginBottom: 28,
    display: 'flex', justifyContent: 'center', touchAction: 'none'
  },
  sendPill: {
    width: '100%', background: '#e7a93c', borderRadius: 16, padding: '14px 18px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    cursor: 'grab', userSelect: 'none'
  },
  sendBar: { width: 40, height: 4, borderRadius: 4, background: 'rgba(27,46,44,0.4)' },
  sendText: { fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600, color: '#1b2e2c' }
};