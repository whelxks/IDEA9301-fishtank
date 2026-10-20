import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { supabase, addNewFish } from "../../lib/supabase";

const STORAGE_BUCKET = "fish-bucket";

/* --------------------------- CANVAS RESOLUTION -------------------------- */
const CANVAS_W = 320;
const CANVAS_H = 360;

const SEND_ANIM_MS = 1800;
const MAX_UNDO = 40;
const OUTLINE_COLOR = "#1b2e2c";

/* ------------------------------ FISH OUTLINES --------------------------- */
type OutlineDef = {
  label: string;
  eye: { x: number; y: number };
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
};

// TODO: run imageToPath once endangered fish outlines are available
const FISH_OUTLINES: Record<string, OutlineDef> = {
  classic: {
    label: "Classic",
    eye: { x: 0.3, y: 0.44 },
    draw(ctx, w, h) {
      ctx.beginPath();
      ctx.ellipse(w * 0.42, h * 0.5, w * 0.28, h * 0.22, 0, 0, Math.PI * 2);
      ctx.moveTo(w * 0.68, h * 0.5);
      ctx.lineTo(w * 0.92, h * 0.26);
      ctx.lineTo(w * 0.92, h * 0.74);
      ctx.closePath();
      ctx.moveTo(w * 0.4, h * 0.3);
      ctx.lineTo(w * 0.5, h * 0.08);
      ctx.lineTo(w * 0.56, h * 0.32);
      ctx.closePath();
      ctx.moveTo(w * 0.4, h * 0.7);
      ctx.lineTo(w * 0.48, h * 0.92);
      ctx.lineTo(w * 0.55, h * 0.68);
      ctx.closePath();
    },
  },
  round: {
    label: "Round",
    eye: { x: 0.34, y: 0.42 },
    draw(ctx, w, h) {
      ctx.beginPath();
      ctx.ellipse(w * 0.48, h * 0.5, w * 0.3, h * 0.28, 0, 0, Math.PI * 2);
      ctx.moveTo(w * 0.76, h * 0.5);
      ctx.lineTo(w * 0.92, h * 0.38);
      ctx.lineTo(w * 0.92, h * 0.62);
      ctx.closePath();
      ctx.moveTo(w * 0.44, h * 0.24);
      ctx.lineTo(w * 0.5, h * 0.08);
      ctx.lineTo(w * 0.57, h * 0.26);
      ctx.closePath();
    },
  },
  angel: {
    label: "Angel",
    eye: { x: 0.32, y: 0.4 },
    draw(ctx, w, h) {
      ctx.beginPath();
      ctx.ellipse(w * 0.46, h * 0.52, w * 0.2, h * 0.32, 0, 0, Math.PI * 2);
      ctx.moveTo(w * 0.4, h * 0.24);
      ctx.lineTo(w * 0.5, h * 0.02);
      ctx.lineTo(w * 0.55, h * 0.28);
      ctx.closePath();
      ctx.moveTo(w * 0.4, h * 0.78);
      ctx.lineTo(w * 0.48, h * 0.98);
      ctx.lineTo(w * 0.55, h * 0.74);
      ctx.closePath();
      ctx.moveTo(w * 0.62, h * 0.52);
      ctx.lineTo(w * 0.84, h * 0.34);
      ctx.lineTo(w * 0.84, h * 0.7);
      ctx.closePath();
    },
  },
};

/* --------------------------------- STAMPS -------------------------------- */
function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
) {
  const points = 5;
  const step = Math.PI / points;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const angle = i * step - Math.PI / 2;
    const x = cx + Math.cos(angle) * rad;
    const y = cy + Math.sin(angle) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawHeart(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
) {
  const w = size;
  const h = size;
  const x = cx - w / 2;
  const y = cy - h / 2;

  ctx.beginPath();
  ctx.moveTo(cx, y + h * 0.28);
  ctx.bezierCurveTo(cx, y, x, y, x, y + h * 0.28);
  ctx.bezierCurveTo(x, y + h * 0.55, cx, y + h * 0.78, cx, y + h);
  ctx.bezierCurveTo(cx, y + h * 0.78, x + w, y + h * 0.55, x + w, y + h * 0.28);
  ctx.bezierCurveTo(x + w, y, cx, y, cx, y + h * 0.28);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

type StampDef = {
  id: string;
  label: string;
  draw: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string,
  ) => void;
};

const STAMPS: StampDef[] = [
  {
    id: "dot",
    label: "Dot",
    draw: (ctx, x, y, size, color) => {
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    },
  },
  {
    id: "star",
    label: "Star",
    draw: (ctx, x, y, size, color) => drawStar(ctx, x, y, size / 2, color),
  },
  {
    id: "heart",
    label: "Heart",
    draw: (ctx, x, y, size, color) => drawHeart(ctx, x, y, size, color),
  },
  {
    id: "stripe",
    label: "Stripe",
    draw: (ctx, x, y, size, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x - size * 0.15, y - size * 0.6, size * 0.3, size * 1.2);
    },
  },
];

const COLORS = [
  "#ef6f53",
  "#e7a93c",
  "#f4d35e",
  "#5fb49c",
  "#3f7cac",
  "#9b5de5",
  "#f2f2f2",
  "#1b2e2c",
];

type Tool = "brush" | "stamp" | "eraser";
type Status = "idle" | "uploading" | "sent" | "error";

type BubbleCfg = {
  id: number;
  left: number;
  bottom: number;
  size: number;
  delay: number;
  duration: number;
};

/* ================================ COMPONENT ============================== */
export default function FishColoringStudio() {
  // Bottom layer: user paint. Eraser and undo act only on this canvas.
  const paintCanvasRef = useRef<HTMLCanvasElement>(null);
  // Top layer: outline stroke + eye dot. Rendered above paint, never erased.
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const paintRef = useRef<{ drawing: boolean; lastX: number; lastY: number }>({
    drawing: false,
    lastX: 0,
    lastY: 0,
  });
  const swipeRef = useRef({
    startX: 0,
    startY: 0,
    startTime: 0,
    triggered: false,
  });
  const undoStackRef = useRef<ImageData[]>([]);

  const [outlineId, setOutlineId] = useState("classic");
  const [tool, setTool] = useState<Tool | null>(null);
  const [stampId, setStampId] = useState("dot");
  const [color, setColor] = useState(COLORS[0]);
  const [brushSize, setBrushSize] = useState(14);
  const [status, setStatus] = useState<Status>("idle");
  const [isAnimating, setIsAnimating] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  const isBusy = isAnimating || status !== "idle";

  /* ------------------------------ CANVAS --------------------------------- */
  const resetCanvas = useCallback((id: string) => {
    const paint = paintCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!paint || !overlay) return;
    const paintCtx = paint.getContext("2d");
    const overlayCtx = overlay.getContext("2d");
    if (!paintCtx || !overlayCtx) return;

    const outline = FISH_OUTLINES[id];
    const { width: w, height: h } = paint;

    /* ---- Paint canvas: clear, then install the fish-shaped clip ---- */
    paintCtx.restore(); // pop previous clip
    paintCtx.globalCompositeOperation = "source-over";
    paintCtx.globalAlpha = 1;
    paintCtx.clearRect(0, 0, w, h);
    paintCtx.save(); // checkpoint to pop on next reset
    outline.draw(paintCtx, w, h);
    paintCtx.clip();

    /* ---- Overlay canvas: outline stroke + eye, always on top ---- */
    overlayCtx.clearRect(0, 0, w, h);
    overlayCtx.globalCompositeOperation = "source-over";
    overlayCtx.globalAlpha = 1;

    outline.draw(overlayCtx, w, h);
    overlayCtx.lineWidth = 5;
    overlayCtx.strokeStyle = OUTLINE_COLOR;
    overlayCtx.stroke();

    const eye = outline.eye;
    overlayCtx.beginPath();
    overlayCtx.arc(w * eye.x, h * eye.y, 6, 0, Math.PI * 2);
    overlayCtx.fillStyle = OUTLINE_COLOR;
    overlayCtx.fill();

    undoStackRef.current = [];
    setCanUndo(false);
  }, []);

  useEffect(() => {
    if (!isAnimating) resetCanvas(outlineId);
  }, [outlineId, resetCanvas, isAnimating]);

  /* -------------------------------- UNDO --------------------------------- */
  // Snapshots only the paint canvas — overlay is static and never changes.
  const pushUndo = useCallback(() => {
    const paint = paintCanvasRef.current;
    if (!paint) return;
    const ctx = paint.getContext("2d");
    if (!ctx) return;
    try {
      const snapshot = ctx.getImageData(0, 0, paint.width, paint.height);
      const stack = undoStackRef.current;
      stack.push(snapshot);
      if (stack.length > MAX_UNDO) stack.shift();
      setCanUndo(stack.length > 0);
    } catch {
      /* ignore */
    }
  }, []);

  function undo() {
    if (isBusy) return;
    const paint = paintCanvasRef.current;
    if (!paint) return;
    const ctx = paint.getContext("2d");
    if (!ctx) return;
    const stack = undoStackRef.current;
    const snapshot = stack.pop();
    if (!snapshot) return;
    ctx.putImageData(snapshot, 0, 0);
    setCanUndo(stack.length > 0);
  }

  /* ------------------------------- POINTER ------------------------------- */
  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = paintCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (isAnimating) return;
    const paint = paintCanvasRef.current;
    if (!paint) return;
    paint.setPointerCapture(e.pointerId);
    const pos = getPos(e);
    paintRef.current = { drawing: true, lastX: pos.x, lastY: pos.y };
    swipeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTime: Date.now(),
      triggered: false,
    };

    if (tool === null) return;

    const ctx = paint.getContext("2d");
    if (!ctx) return;

    pushUndo();

    if (tool === "stamp") {
      const stamp = STAMPS.find((s) => s.id === stampId);
      stamp?.draw(ctx, pos.x, pos.y, brushSize * 3, color);
      return;
    }

    const erasing = tool === "eraser";
    ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (
      tool === null &&
      !swipeRef.current.triggered &&
      !isAnimating &&
      paintRef.current.drawing
    ) {
      const dt = Date.now() - swipeRef.current.startTime;
      const dy = swipeRef.current.startY - e.clientY;
      const dx = Math.abs(e.clientX - swipeRef.current.startX);
      if (dt < 400 && dy > 90 && dx < 60) {
        swipeRef.current.triggered = true;
        paintRef.current.drawing = false;
        sendFish();
        return;
      }
    }

    if (!paintRef.current.drawing || isAnimating) return;
    if (tool === null || tool === "stamp") return;

    const pos = getPos(e);
    const paint = paintCanvasRef.current;
    if (!paint) return;
    const ctx = paint.getContext("2d");
    if (!ctx) return;

    const erasing = tool === "eraser";
    ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
    ctx.beginPath();
    ctx.moveTo(paintRef.current.lastX, paintRef.current.lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";

    paintRef.current.lastX = pos.x;
    paintRef.current.lastY = pos.y;
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    paintRef.current.drawing = false;
    try {
      paintCanvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    // No outline-redraw needed anymore: the eraser can't reach the overlay.
  }

  /* --------------------------------- SEND -------------------------------- */
  async function sendFish() {
    if (isBusy) return;
    const paint = paintCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!paint || !overlay) return;

    const started = Date.now();
    setIsAnimating(true);
    setStatus("uploading");

    let outcome: "sent" | "error" = "sent";
    try {
      // Composite the two layers into a single canvas for export.
      const composite = document.createElement("canvas");
      composite.width = CANVAS_W;
      composite.height = CANVAS_H;
      const cctx = composite.getContext("2d");
      if (!cctx) throw new Error("Could not create composite context");
      cctx.drawImage(paint, 0, 0);
      cctx.drawImage(overlay, 0, 0);

      const blob: Blob | null = await new Promise((resolve) =>
        composite.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("Canvas is empty");

      const fileName = `fish-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.png`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(fileName, blob, { contentType: "image/png" });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(fileName);

      const inserted = await addNewFish(publicUrlData.publicUrl, outlineId);
      if (!inserted) throw new Error("Insert failed");
    } catch (err) {
      console.error("Fish upload failed:", err);
      outcome = "error";
    }

    const elapsed = Date.now() - started;
    const remaining = Math.max(0, SEND_ANIM_MS - elapsed);

    window.setTimeout(() => {
      setStatus(outcome);
      window.setTimeout(() => {
        setIsAnimating(false);
        setStatus("idle");
        resetCanvas(outlineId);
      }, 900);
    }, remaining);
  }

  /* ------------------------------- BUBBLES ------------------------------- */
  const bubbles: BubbleCfg[] = useMemo(() => {
    if (!isAnimating) return [];
    return Array.from({ length: 14 }, (_, i) => ({
      id: i,
      left: 8 + Math.random() * 84,
      bottom: Math.random() * 25,
      size: 6 + Math.random() * 12,
      delay: Math.random() * 0.7,
      duration: 1.0 + Math.random() * 0.9,
    }));
  }, [isAnimating]);

  const statusText: Record<Status, string> = {
    idle: "",
    uploading: "Sending your fish…",
    sent: "Off it goes! 🐟",
    error: "Something went wrong — try again",
  };

  /* -------------------------------- RENDER ------------------------------- */
  return (
    <div style={styles.page} onClick={() => setTool(null)}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700&family=Inter:wght@400;500;600&display=swap');

        @keyframes swimAway {
          0%   { transform: translateY(0)      rotate(0deg)  scale(1);    opacity: 1; }
          15%  { transform: translateY(8px)    rotate(-5deg) scale(1.04); opacity: 1; }
          35%  { transform: translateY(-22px)  rotate(5deg)  scale(1.06); opacity: 1; }
          65%  { transform: translateY(-150px) rotate(-4deg) scale(1);    opacity: 0.85; }
          100% { transform: translateY(-380px) rotate(8deg)  scale(0.75); opacity: 0; }
        }
        @keyframes bubbleFloat {
          0%   { transform: translateY(0)      scale(0.4); opacity: 0; }
          15%  { opacity: 0.9; }
          100% { transform: translateY(-340px) scale(1.15); opacity: 0; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes hintBob {
          0%, 100% { transform: translateY(0);    opacity: 0.8; }
          50%      { transform: translateY(-3px); opacity: 1; }
        }
      `}</style>

      <h1 style={styles.title}>Color your fish</h1>

      <div style={styles.outlineRow} onClick={(e) => e.stopPropagation()}>
        {Object.entries(FISH_OUTLINES).map(([id, o]) => (
          <button
            key={id}
            onClick={() => setOutlineId(id)}
            disabled={isBusy}
            style={{
              ...styles.outlineChip,
              ...(outlineId === id ? styles.outlineChipActive : {}),
              ...(isBusy ? { opacity: 0.5, cursor: "not-allowed" } : {}),
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div style={styles.stage} onClick={(e) => e.stopPropagation()}>
        {isAnimating && (
          <div style={styles.bubbleLayer}>
            {bubbles.map((b) => (
              <span
                key={b.id}
                style={{
                  position: "absolute",
                  left: `${b.left}%`,
                  bottom: `${b.bottom}%`,
                  width: b.size,
                  height: b.size,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.9), rgba(63,124,172,0.35))",
                  boxShadow: "0 0 6px rgba(63,124,172,0.35)",
                  animation: `bubbleFloat ${b.duration}s ease-out ${b.delay}s forwards`,
                }}
              />
            ))}
          </div>
        )}

        {/* The two canvases share a wrapper so the swim-away animation
            moves them together as one unit. */}
        <div
          style={{
            ...styles.canvasStack,
            animation: isAnimating
              ? `swimAway ${SEND_ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards`
              : "none",
            filter: isAnimating
              ? "drop-shadow(0 0 10px rgba(251, 243, 225, 0.7))"
              : "none",
            pointerEvents: isBusy ? "none" : "auto",
          }}
        >
          <canvas
            ref={paintCanvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={styles.paintCanvas}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
          <canvas
            ref={overlayCanvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={styles.overlayCanvas}
            aria-hidden="true"
          />
        </div>
      </div>

      <div style={styles.hintRow} onClick={(e) => e.stopPropagation()}>
        {status !== "idle" ? (
          <div style={styles.statusRow}>
            {status === "uploading" && <div style={styles.spinner} />}
            <span style={styles.statusText}>{statusText[status]}</span>
          </div>
        ) : tool === null ? (
          <div style={styles.hint}>
            <span style={styles.hintArrow}>↑</span>
            <span>Swipe up on the fish to send it swimming</span>
          </div>
        ) : (
          <div style={styles.hint}>
            <span>Tap the active tool to deselect</span>
          </div>
        )}
      </div>

      <div style={styles.tray} onClick={(e) => e.stopPropagation()}>
        <div style={styles.toolRow}>
          <button
            style={{
              ...styles.toolBtn,
              ...(tool === "brush" ? styles.toolBtnActive : {}),
            }}
            onClick={() => setTool(tool === "brush" ? null : "brush")}
            disabled={isBusy}
            aria-pressed={tool === "brush"}
          >
            Brush
          </button>
          <button
            style={{
              ...styles.toolBtn,
              ...(tool === "stamp" ? styles.toolBtnActive : {}),
            }}
            onClick={() => setTool(tool === "stamp" ? null : "stamp")}
            disabled={isBusy}
            aria-pressed={tool === "stamp"}
          >
            Stamp
          </button>
          <button
            style={{
              ...styles.toolBtn,
              ...(tool === "eraser" ? styles.toolBtnActive : {}),
            }}
            onClick={() => setTool(tool === "eraser" ? null : "eraser")}
            disabled={isBusy}
            aria-pressed={tool === "eraser"}
          >
            Eraser
          </button>
          <button
            style={{
              ...styles.toolBtn,
              ...styles.undoBtn,
              ...(canUndo && !isBusy ? {} : styles.toolBtnDisabled),
            }}
            onClick={(e) => {
              e.stopPropagation();
              undo();
            }}
            disabled={!canUndo || isBusy}
            aria-label="Undo last stroke"
          >
            ↶ Undo
          </button>
        </div>

        <div style={styles.sliderRow}>
          <input
            type="range"
            min="4"
            max="34"
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            style={styles.slider}
          />
        </div>

        {tool === "stamp" && (
          <div style={styles.stampRow}>
            {STAMPS.map((s) => (
              <button
                key={s.id}
                onClick={() => setStampId(s.id)}
                style={{
                  ...styles.stampBtn,
                  ...(stampId === s.id ? styles.stampBtnActive : {}),
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {tool !== "eraser" && (
          <div style={styles.paletteRow}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  ...styles.swatch,
                  background: c,
                  ...(color === c ? styles.swatchActive : {}),
                }}
                aria-label={`color ${c}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- STYLES -------------------------------- */
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#0e2f36",
    color: "#fbf3e1",
    fontFamily: "'Inter', sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "28px 16px 32px",
    boxSizing: "border-box",
  },
  title: {
    fontFamily: "'Baloo 2', sans-serif",
    fontSize: 26,
    margin: "0 0 18px",
    fontWeight: 700,
  },
  outlineRow: { display: "flex", gap: 10, marginBottom: 18 },
  outlineChip: {
    padding: "8px 18px",
    borderRadius: 999,
    border: "1px solid #3f5c5c",
    background: "transparent",
    color: "#cfe3df",
    fontFamily: "'Inter', sans-serif",
    fontSize: 14,
    cursor: "pointer",
  },
  outlineChipActive: {
    background: "#e7a93c",
    color: "#1b2e2c",
    border: "1px solid #e7a93c",
    fontWeight: 600,
  },

  stage: {
    position: "relative",
    borderRadius: 20,
    background: "#f3efe4",
    boxShadow: "0 12px 30px rgba(0,0,0,0.3)",
    padding: 16,
    overflow: "visible",
  },
  bubbleLayer: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    overflow: "visible",
    zIndex: 0,
  },
  // The two stacked canvases live inside this wrapper.
  canvasStack: {
    position: "relative",
    width: 260,
    height: 292,
    borderRadius: 10,
    transformOrigin: "center center",
  },
  paintCanvas: {
    position: "absolute",
    inset: 0,
    display: "block",
    width: "100%",
    height: "100%",
    touchAction: "none",
    background: "transparent",
    zIndex: 1,
  },
  overlayCanvas: {
    position: "absolute",
    inset: 0,
    display: "block",
    width: "100%",
    height: "100%",
    // Let pointer events pass through to the paint canvas underneath.
    pointerEvents: "none",
    zIndex: 2,
  },

  hintRow: {
    height: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    marginBottom: 6,
  },
  hint: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    borderRadius: 999,
    background: "rgba(251, 243, 225, 0.08)",
    color: "rgba(251, 243, 225, 0.8)",
    fontSize: 12.5,
    letterSpacing: 0.2,
  },
  hintArrow: {
    fontSize: 14,
    opacity: 0.85,
    animation: "hintBob 1.6s ease-in-out infinite",
  },
  statusRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 14px",
    borderRadius: 999,
    background: "rgba(251, 243, 225, 0.08)",
  },
  statusText: {
    fontSize: 12.5,
    fontWeight: 500,
    color: "rgba(251, 243, 225, 0.9)",
  },
  spinner: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    border: "2px solid rgba(251, 243, 225, 0.25)",
    borderTopColor: "#fbf3e1",
    animation: "spin 0.9s linear infinite",
  },

  tray: {
    width: "100%",
    maxWidth: 340,
    background: "#123c42",
    borderRadius: 16,
    marginTop: 10,
    padding: 14,
    boxSizing: "border-box",
  },
  toolRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  toolBtn: {
    padding: "7px 14px",
    borderRadius: 10,
    border: "1px solid #3f5c5c",
    background: "transparent",
    color: "#cfe3df",
    fontSize: 13,
    cursor: "pointer",
  },
  toolBtnActive: {
    background: "#ef6f53",
    border: "1px solid #ef6f53",
    color: "#1b2e2c",
    fontWeight: 600,
  },
  toolBtnDisabled: {
    opacity: 0.35,
    cursor: "not-allowed",
  },
  undoBtn: {
    marginLeft: "auto",
    fontWeight: 500,
  },
  sliderRow: {
    display: "flex",
    alignItems: "center",
    marginBottom: 10,
  },
  slider: { flex: 1 },
  stampRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  stampBtn: {
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid #3f5c5c",
    background: "transparent",
    color: "#cfe3df",
    fontSize: 12,
    cursor: "pointer",
  },
  stampBtnActive: {
    background: "#5fb49c",
    border: "1px solid #5fb49c",
    color: "#0e2f36",
    fontWeight: 600,
  },
  paletteRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 8,
    border: "2px solid transparent",
    cursor: "pointer",
  },
  swatchActive: { border: "2px solid #fbf3e1" },
};