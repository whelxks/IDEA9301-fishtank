import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { Link, useNavigate, useParams } from "react-router";
import { supabase, addNewFish } from "../../lib/supabase";
import {
  FISH_OUTLINES,
  findLabelBySlug,
  findOutlineIdBySlug,
} from "~/constants/fish-outlines";
import { GLASS_UI_CSS, HOLO_GLASS_OVERRIDES } from "~/components/glass-ui";
import StudioPage, { studioStyles } from "~/components/steppers";
import { saveFinishedFish } from "~/functions/finished-fish";

const STORAGE_BUCKET = "fish-bucket";
const COMPLETED_PATH = "/color/completed";

const TEAL = "#53D7C7";

/* --------------------------- CANVAS RESOLUTION -------------------------- */
// The canvas takes the aspect ratio of the selected outline. It is fitted
// inside DISPLAY_MAX_W x DISPLAY_MAX_H (CSS px); the backing store is RES
// times larger so strokes stay crisp.
const DISPLAY_MAX_W = 300;
const DISPLAY_MAX_H = 340;
const RES = 1.25;

function getCanvasDims(aspect: number) {
  let dispW = DISPLAY_MAX_W;
  let dispH = dispW / aspect;
  if (dispH > DISPLAY_MAX_H) {
    dispH = DISPLAY_MAX_H;
    dispW = dispH * aspect;
  }
  dispW = Math.round(dispW);
  dispH = Math.round(dispH);
  return {
    dispW,
    dispH,
    w: Math.round(dispW * RES),
    h: Math.round(dispH * RES),
  };
}

const DEFAULT_OUTLINE_ID = Object.keys(FISH_OUTLINES)[0];
const DEFAULT_LABEL = FISH_OUTLINES[DEFAULT_OUTLINE_ID].label;

// Gap between the drawing and the tools, and between the tools and the finish button.
const SECTION_GAP = 58;

const SEND_ANIM_MS = 1800;
const MAX_UNDO = 40;
const OUTLINE_COLOR = "#1b2e2c";

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
type Status = "idle" | "uploading" | "error";

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
  const navigate = useNavigate();

  // Bottom layer: user paint. Eraser and undo act only on this canvas.
  const paintCanvasRef = useRef<HTMLCanvasElement>(null);
  // Top layer: outline stroke + eye dot. Rendered above paint, never erased.
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const paintRef = useRef<{ drawing: boolean; lastX: number; lastY: number }>({
    drawing: false,
    lastX: 0,
    lastY: 0,
  });
  const undoStackRef = useRef<ImageData[]>([]);

  // Selected fish comes from the URL: /color/:fish (e.g. /color/seahorse).
  // /color with no (or an unknown) slug falls back to the first outline.
  const { fish } = useParams();
  const outlineId = findOutlineIdBySlug(fish) ?? DEFAULT_OUTLINE_ID;
  const species = findLabelBySlug(fish) ?? DEFAULT_LABEL;
  const outline = FISH_OUTLINES[outlineId];
  const dims = useMemo(() => getCanvasDims(outline.aspect), [outline.aspect]);

  const [tool, setTool] = useState<Tool>("brush");
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
    overlayCtx.lineJoin = "round";
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

  // Runs after React has applied the new canvas width/height, so resetCanvas
  // always sees the dimensions that match the selected outline. It only
  // depends on the outline: a failed upload keeps the drawing intact.
  useEffect(() => {
    resetCanvas(outlineId);
  }, [outlineId, resetCanvas]);

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
    if (isBusy) return;
    const paint = paintCanvasRef.current;
    if (!paint) return;
    paint.setPointerCapture(e.pointerId);
    const pos = getPos(e);
    paintRef.current = { drawing: true, lastX: pos.x, lastY: pos.y };

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
    if (!paintRef.current.drawing || isBusy) return;
    if (tool === "stamp") return;

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
  }

  /* --------------------------------- FINISH ------------------------------ */
  // "Finished customising": plays the swim-away animation while the fish is
  // uploaded, then goes to /completed. On failure the drawing is kept so the
  // person can try again.
  async function finishCustomising() {
    if (isBusy) return;
    const paint = paintCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!paint || !overlay) return;

    const started = Date.now();
    setIsAnimating(true);
    setStatus("uploading");

    let imageUrl: string | null = null;
    try {
      // Composite the layers into a single canvas for export.
      const composite = document.createElement("canvas");
      composite.width = paint.width;
      composite.height = paint.height;
      const cctx = composite.getContext("2d");
      if (!cctx) throw new Error("Could not create composite context");

      // Bottom layer: white fish body (inside the outline only, outside stays transparent)
      outline.draw(cctx, composite.width, composite.height);
      cctx.fillStyle = "#ffffff";
      cctx.fill();

      // Then the paint, then the outline stroke + eye on top
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

      const inserted = await addNewFish(
        publicUrlData.publicUrl,
        outlineId,
        species,
      );
      if (!inserted) throw new Error("Insert failed");

      imageUrl = publicUrlData.publicUrl;
    } catch (err) {
      console.error("Fish upload failed:", err);
    }

    const elapsed = Date.now() - started;
    const remaining = Math.max(0, SEND_ANIM_MS - elapsed);

    window.setTimeout(() => {
      if (imageUrl) {
        const finished = { imageUrl, outlineId, label: outline.label };
        saveFinishedFish(finished);
        navigate(COMPLETED_PATH, { state: finished });
      } else {
        setStatus("error");
        window.setTimeout(() => {
          setIsAnimating(false);
          setStatus("idle");
        }, 1600);
      }
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
    error: "Something went wrong — try again",
  };

  /* -------------------------------- RENDER ------------------------------- */
  return (
    <StudioPage step={1}>
      <style>{`
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

        @keyframes pillIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .finish-btn {
          transition: transform 0.2s ease, filter 0.2s ease,
            box-shadow 0.2s ease, border-color 0.2s ease;
        }
        /* Hover only on devices that actually hover, so it doesn't stick on touch */
        @media (hover: hover) {
          .finish-btn:not(:disabled):hover {
            transform: translateY(-2px) scale(1.04);
            filter: brightness(1.3);
            border-color: rgba(190, 245, 255, 0.95) !important;
            box-shadow:
              0 0 24px rgba(80, 215, 255, 0.75),
              0 0 60px rgba(140, 110, 255, 0.5),
              inset 0 0 26px rgba(120, 220, 255, 0.35),
              inset 0 0 0 1px rgba(255, 255, 255, 0.3) !important;
          }
        }
        .finish-btn:not(:disabled):active {
          transform: translateY(0) scale(0.97);
        }
      `}</style>

      <h1 style={studioStyles.title}>Customise your {species} </h1>

      {/* Only rendered while active, so it pushes everything below it down */}
      {status !== "idle" && (
        <div
          role="status"
          style={{
            ...styles.statusPill,
            ...(status === "error" ? styles.statusPillError : {}),
          }}
        >
          {status === "uploading" && <div style={styles.spinner} />}
          <span>{statusText[status]}</span>
        </div>
      )}
      {/*NOTE: users scan QR initially to get to unique URL */}
      {/* Each outline is its own link: /color/seahorse, /color/unifasciata, … */}
      {/* <div style={styles.outlineGlass}>
        {Object.entries(FISH_OUTLINES).map(([id, o]) => (
          <Link
            key={id}
            to={`/color/${o.slug}`}
            onClick={(e) => {
              if (isBusy) e.preventDefault();
            }}
            aria-disabled={isBusy}
            aria-current={outlineId === id ? "page" : undefined}
            style={{
              ...styles.outlineChip,
              ...(outlineId === id ? styles.outlineChipActive : {}),
              ...(isBusy ? { opacity: 0.5, cursor: "not-allowed" } : {}),
            }}
          >
            {o.label}
          </Link>
        ))}
      </div> */}

      <div style={styles.stage}>
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
            moves them together as one unit. Its size follows the outline. */}
        <div
          style={{
            ...styles.canvasStack,
            width: dims.dispW,
            height: dims.dispH,
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
            width={dims.w}
            height={dims.h}
            style={styles.paintCanvas}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
          <canvas
            ref={overlayCanvasRef}
            width={dims.w}
            height={dims.h}
            style={styles.overlayCanvas}
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Tools sit directly on the page background (no glass box). */}
      <div style={styles.tray}>
        <div style={styles.toolRow}>
          <button
            style={{
              ...styles.toolBtn,
              ...(tool === "brush" ? styles.toolBtnActive : {}),
            }}
            onClick={() => setTool("brush")}
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
            onClick={() => setTool("stamp")}
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
            onClick={() => setTool("eraser")}
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
            onClick={undo}
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
                aria-pressed={stampId === s.id}
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

      <button
        className="finish-btn"
        style={{
          ...styles.finishBtn,
          ...(isBusy ? { opacity: 0.6, cursor: "not-allowed" } : {}),
        }}
        onClick={finishCustomising}
        disabled={isBusy}
      >
        I have finished!
      </button>
    </StudioPage>
  );
}

/* ---------------------------------- STYLES -------------------------------- */
// Shared pill look for tool + stamp buttons (same as the status pill on the
// NFC page): faint outlined when idle, solid teal with a glow when selected.
const PILL: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.03)",
  border: "1px solid rgba(255, 255, 255, 0.3)",
  borderRadius: 999,
  color: "#fff",
  fontWeight: 500,
  cursor: "pointer",
  transition:
    "background 0.25s ease, color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease",
};
const PILL_ACTIVE: React.CSSProperties = {
  background: TEAL,
  borderColor: TEAL,
  color: "#06222a",
  fontWeight: 600,
  boxShadow: "0 0 18px rgba(83, 215, 199, 0.45)",
};

const styles: Record<string, React.CSSProperties> = {
  // Holographic glass box around the outline chips.
  outlineGlass: {
    ...GLASS_UI_CSS,
    ...HOLO_GLASS_OVERRIDES,
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    padding: "14px 16px",
    marginBottom: 18,
    maxWidth: 380,
    boxSizing: "border-box",
  },
  outlineChip: {
    display: "inline-block",
    textDecoration: "none",
    padding: "8px 18px",
    borderRadius: 999,
    border: "1px solid #3f5c5c",
    background: "transparent",
    color: "#fff",
    fontFamily: "'Poppins', sans-serif",
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
  // The two stacked canvases live inside this wrapper. Width/height are set
  // inline from the selected outline's aspect ratio.
  canvasStack: {
    position: "relative",
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

  // Holographic glass pill for the "Finished customising" button.
  finishBtn: {
    ...GLASS_UI_CSS,
    ...HOLO_GLASS_OVERRIDES,
    marginTop: SECTION_GAP,
    padding: "14px 30px",
    borderRadius: 999,
    color: "#fff",
    fontFamily: "'Poppins', sans-serif",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
  },

  // Upload status pill under the title, same size as the NFC page's status pill
  statusPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    boxSizing: "border-box",
    maxWidth: "100%",
    padding: "14px 30px",
    marginBottom: 22,
    borderRadius: 999,
    background: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.3)",
    color: "#fff",
    fontSize: 16,
    fontWeight: 500,
    textAlign: "center",
    animation: "pillIn 0.3s ease-out",
  },
  statusPillError: {
    background: "rgba(239, 111, 83, 0.12)",
    borderColor: "rgba(239, 111, 83, 0.6)",
  },
  spinner: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    border: "2px solid rgba(255, 255, 255, 0.25)",
    borderTopColor: TEAL,
    animation: "spin 0.9s linear infinite",
  },

  tray: {
    width: "100%",
    maxWidth: 340,
    marginTop: SECTION_GAP,
    boxSizing: "border-box",
  },
  toolRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  toolBtn: {
    ...PILL,
    padding: "8px 16px",
    fontSize: 13,
  },
  toolBtnActive: PILL_ACTIVE,
  toolBtnDisabled: {
    opacity: 0.35,
    cursor: "not-allowed",
  },
  undoBtn: {
    marginLeft: "auto",
  },
  sliderRow: {
    display: "flex",
    alignItems: "center",
    marginBottom: 12,
  },
  slider: { flex: 1 },
  stampRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  stampBtn: {
    ...PILL,
    padding: "7px 15px",
    fontSize: 12.5,
  },
  stampBtnActive: PILL_ACTIVE,
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
