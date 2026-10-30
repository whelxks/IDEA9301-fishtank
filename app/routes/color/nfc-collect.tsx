import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link, useLocation } from "react-router";
import { GLASS_UI_CSS } from "~/components/glass-ui";
import StudioPage, { studioStyles } from "~/components/steppers";
import { FISH_OUTLINES } from "~/constants/fish-outlines";
import { loadFinishedFish, type FinishedFish } from "~/functions/finished-fish";

const TEAL = "#53D7C7";
const PRINT_MS = 5000; // demo duration (the copy in the design says "About 45 min")

/* --------------------------------- TIMER --------------------------------- */
function usePrintTimer(totalMs: number) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => {
      const e = Math.min(performance.now() - start, totalMs);
      setElapsed(e);
      if (e >= totalMs) window.clearInterval(id);
    }, 100);
    return () => window.clearInterval(id);
  }, [totalMs]);
  return elapsed;
}

/** 4200 -> "00:05" (rounds up so it hits 00:00 exactly when done) */
function formatClock(ms: number) {
  const secs = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/* ------------------------------ FAKE 3D TAG ------------------------------- */
const TAG_DEPTH = 12; // number of stacked layers (thickness)
const TAG_OFF_X = 0.7; // css px each layer shifts right
const TAG_OFF_Y = 0.9; // ...and down
const TAG_RES = 2; // backing-store multiplier so edges stay crisp
const TAG_MAX_W = 220;
const TAG_MAX_H = 130;

function Fish3DTag({
  imageUrl,
  outlineId,
  label,
}: {
  imageUrl: string;
  outlineId: string;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outline = FISH_OUTLINES[outlineId];

  const dims = useMemo(() => {
    const aspect = outline?.aspect ?? 1.6;
    let w = TAG_MAX_W;
    let h = w / aspect;
    if (h > TAG_MAX_H) {
      h = TAG_MAX_H;
      w = h * aspect;
    }
    w = Math.round(w);
    h = Math.round(h);
    return {
      w,
      h,
      cw: w + Math.ceil(TAG_DEPTH * TAG_OFF_X) + 2,
      ch: h + Math.ceil(TAG_DEPTH * TAG_OFF_Y) + 2,
    };
  }, [outline]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !outline) return;
    const { w, h } = dims;

    const render = (img: HTMLImageElement | null) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(TAG_RES, TAG_RES);
      ctx.lineJoin = "round";

      // 1. Side walls: the silhouette repeated, darker the further back it is
      for (let i = TAG_DEPTH; i >= 1; i--) {
        const t = i / TAG_DEPTH;
        ctx.save();
        ctx.translate(i * TAG_OFF_X, i * TAG_OFF_Y);
        outline.draw(ctx, w, h);
        ctx.fillStyle = `hsl(48, ${22 - 8 * t}%, ${78 - 24 * t}%)`;
        ctx.fill();
        if (i === TAG_DEPTH) {
          ctx.strokeStyle = "rgba(27, 46, 44, 0.55)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.restore();
      }

      // 2. Front face: solid cream so transparent areas of the PNG aren't see-through
      outline.draw(ctx, w, h);
      ctx.fillStyle = "#f1ede0";
      ctx.fill();

      // 3. The visitor's artwork (outline stroke + paint) on the face
      if (img) ctx.drawImage(img, 0, 0, w, h);
    };

    let cancelled = false;
    const img = new Image();
    img.onload = () => !cancelled && render(img);
    img.onerror = () => !cancelled && render(null);
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl, outline, dims]);

  // Unknown outline id: just show the flat image
  if (!outline) {
    return (
      <img
        src={imageUrl}
        alt={`Your ${label}`}
        style={{ maxWidth: TAG_MAX_W, maxHeight: TAG_MAX_H }}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <canvas
        ref={canvasRef}
        width={dims.cw * TAG_RES}
        height={dims.ch * TAG_RES}
        role="img"
        aria-label={`3D preview of your ${label}`}
        style={{ width: dims.cw, height: dims.ch, display: "block" }}
      />
      {/* Floor shadow */}
      <div
        aria-hidden
        style={{
          width: dims.w * 0.9,
          height: 16,
          marginTop: 14,
          borderRadius: "50%",
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 70%)",
          filter: "blur(2px)",
        }}
      />
    </div>
  );
}

/* --------------------------------- ICONS --------------------------------- */
function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="8" fill="none" stroke={TEAL} strokeWidth="2" />
      <path
        d="M10 5.5V10l3 2"
        fill="none"
        stroke={TEAL}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <path
        d="M4.5 10.5l3.5 3.5 7.5-8"
        fill="none"
        stroke="#06222a"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------- "WHERE TO COLLECT" ART ------------------------- */
function TankIllustration() {
  const fishGlyph = (x: number, y: number) => (
    <g
      transform={`translate(${x} ${y})`}
      fill="none"
      stroke={TEAL}
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <path d="M0 6 C5 -1 15 -1 20 6 C15 13 5 13 0 6 Z" />
      <path d="M20 6 L27 1 L27 11 Z" />
      <circle cx="5" cy="5" r="0.9" fill={TEAL} stroke="none" />
    </g>
  );
  return (
    <svg viewBox="0 0 150 100" style={styles.svgFill} aria-hidden>
      <rect
        x="1.5"
        y="1.5"
        width="147"
        height="97"
        rx="14"
        fill="rgba(83, 215, 199, 0.12)"
        stroke={TEAL}
        strokeWidth="2.5"
      />
      {fishGlyph(22, 24)}
      {fishGlyph(88, 38)}
      {fishGlyph(44, 56)}
      <path
        d="M14 82 q 6 -6 12 0 t 12 0 t 12 0 t 12 0 t 12 0 t 12 0 t 12 0 t 12 0"
        fill="none"
        stroke={TEAL}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PointIllustration() {
  return (
    <svg viewBox="0 0 140 120" style={styles.svgFill} aria-hidden>
      {/* map pin */}
      <path
        d="M70 2 C57 2 47 12 47 25 C47 41 70 60 70 60 C70 60 93 41 93 25 C93 12 83 2 70 2 Z"
        fill={TEAL}
      />
      <circle cx="70" cy="24" r="7" fill="#0a1a22" />
      {/* collection box with tag slot */}
      <rect
        x="3"
        y="64"
        width="134"
        height="52"
        rx="10"
        fill="#2a3238"
        stroke="rgba(255,255,255,0.65)"
        strokeWidth="2.5"
      />
      <rect
        x="28"
        y="78"
        width="84"
        height="24"
        rx="5"
        fill="none"
        stroke="rgba(255,255,255,0.9)"
        strokeWidth="2"
      />
      <path
        d="M42 78 V102 M98 78 V102"
        stroke="rgba(255,255,255,0.9)"
        strokeWidth="2"
      />
    </svg>
  );
}

/* ================================= PAGE ================================== */
export default function NfcCollect() {
  const location = useLocation();

  const [fish, setFish] = useState<FinishedFish | null>(
    (location.state as FinishedFish | null) ?? null,
  );
  const [checked, setChecked] = useState(Boolean(fish));

  useEffect(() => {
    if (!fish) setFish(loadFinishedFish());
    setChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const elapsed = usePrintTimer(PRINT_MS);
  const done = elapsed >= PRINT_MS;
  const progress = elapsed / PRINT_MS;
  const clock = formatClock(PRINT_MS - elapsed);

  return (
    <StudioPage step={3}>
      <h1 style={styles.title}>Collect your NFC tag</h1>

      <div style={styles.content}>
        {/* Status pill: outlined while printing, solid teal when ready */}
        <div
          style={{
            ...styles.statusPill,
            ...(done ? styles.statusPillDone : {}),
          }}
        >
          {done ? <CheckIcon /> : <ClockIcon />}
          <span>
            {done ? (
              "NFC is ready for collection"
            ) : (
              <>
                Ready for collection in{" "}
                <span style={styles.tabular}>{clock}</span>
              </>
            )}
          </span>
        </div>

        <p style={styles.hint}>
          {done
            ? "Head to the print & collection point and show this screen to pick up your tag."
            : "We’ll show you when it’s ready. Take a look around the tank while you wait."}
        </p>

        {/* Printing progress */}
        <section style={styles.card}>
          <div style={styles.progressHeader}>
            <span style={styles.progressLabel}>
              {done ? "Printing complete" : "Printing time"}
            </span>
            <span style={styles.progressValue}>
              {done ? clock : "About 45 min"}
            </span>
          </div>
          <div
            style={styles.track}
            role="progressbar"
            aria-label="Printing progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div
              style={{
                ...styles.fill,
                width: `${progress * 100}%`,
                ...(done ? styles.fillDone : {}),
              }}
            />
          </div>
        </section>

        {/* 3D preview */}
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>How your tag will look</h2>
          <div style={styles.tagStage}>
            {fish ? (
              <Fish3DTag
                imageUrl={fish.imageUrl}
                outlineId={fish.outlineId}
                label={fish.label}
              />
            ) : (
              checked && (
                <p style={styles.noFish}>
                  We couldn’t find your fish.{" "}
                  <Link to="/color" style={studioStyles.link}>
                    Customise a fish
                  </Link>
                </p>
              )
            )}
          </div>
          <p style={styles.caption}>A 3D-printed model of the fish you drew.</p>
        </section>

        {/* Where to collect */}
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Where to collect it</h2>
          <div style={styles.mapGrid}>
            <TankIllustration />
            <svg
              viewBox="0 0 60 30"
              preserveAspectRatio="none"
              style={styles.connector}
              aria-hidden
            >
              <path
                d="M0 4 C25 4, 35 24, 60 24"
                fill="none"
                stroke="rgba(255,255,255,0.5)"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <PointIllustration />

            <p style={styles.mapLabel}>Community tank</p>
            <span />
            <p style={styles.mapLabel}>Print &amp; collection point</p>
          </div>
        </section>
      </div>
    </StudioPage>
  );
}

/* ---------------------------------- STYLES -------------------------------- */
const CARD_BG = "#1a2126";
const CARD_BORDER = "1px solid rgba(255, 255, 255, 0.2)";

const styles: Record<string, CSSProperties> = {
  title: { ...studioStyles.title, marginBottom: 22 },
  content: {
    width: "100%",
    maxWidth: 420,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },

  statusPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "14px 30px",
    borderRadius: 999,
    background: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.3)",
    color: "#fff",
    fontSize: 16,
    fontWeight: 500,
    transition:
      "background 0.4s ease, color 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease",
  },
  statusPillDone: {
    background: TEAL,
    borderColor: TEAL,
    color: "#06222a",
    fontWeight: 600,
    boxShadow: "0 0 26px rgba(83, 215, 199, 0.45)",
  },
  tabular: { fontVariantNumeric: "tabular-nums" },
  hint: { ...studioStyles.body, maxWidth: 320, margin: "18px 0 22px" },

 card: {
    ...GLASS_UI_CSS,
    width: "100%",
    boxSizing: "border-box",
    padding: "20px 22px",
    marginBottom: 22,
  },
  cardTitle: { margin: 0, fontSize: 16, fontWeight: 600, color: "#fff" },

  progressHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 12,
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: 500,
    color: "rgba(255, 255, 255, 0.8)",
  },
  progressValue: {
    fontSize: 16,
    fontWeight: 700,
    color: "#fff",
    fontVariantNumeric: "tabular-nums",
  },
  track: {
    height: 8,
    borderRadius: 999,
    background: "rgba(255, 255, 255, 0.16)",
  },
  fill: {
    height: "100%",
    borderRadius: 999,
    background: TEAL,
    transition: "width 0.1s linear, box-shadow 0.4s ease",
  },
  fillDone: { boxShadow: "0 0 12px rgba(83, 215, 199, 0.6)" },

  tagStage: {
    display: "flex",
    justifyContent: "center",
    padding: "18px 0 10px",
    minHeight: 150,
  },
  caption: {
    margin: "4px 0 0",
    textAlign: "center",
    fontSize: 13.5,
    color: "rgba(255, 255, 255, 0.75)",
  },
  noFish: { ...studioStyles.body, margin: 0 },

  mapGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(28px, 0.45fr) minmax(0, 1fr)",
    alignItems: "end",
    marginTop: 22,
  },
  svgFill: { width: "100%", height: "auto", display: "block" },
  connector: { width: "100%", height: 30, display: "block", marginBottom: 18 },
  mapLabel: {
    margin: "12px 0 0",
    textAlign: "center",
    fontSize: 12,
    fontWeight: 600,
    color: "#fff",
  },
};