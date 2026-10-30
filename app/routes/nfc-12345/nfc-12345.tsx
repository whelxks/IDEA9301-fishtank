import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { getExistingFish, type FishRow } from "../../lib/supabase";
import { GLASS_UI_CSS, HOLO_GLASS_OVERRIDES } from "~/components/glass-ui";
import StudioPage, { studioStyles } from "~/components/steppers";

const TEAL = "#53D7C7";
const AQUARIUM_PATH = "/endangered-aquarium";

/** "30 Oct 2026" (date only, no time) */
function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Same hover treatment as the "I have finished!" button in color-fish.tsx.
// !important is needed because the glass styles are applied inline.
const HOLO_BTN_CSS = `
  .finish-btn {
    transition: transform 0.2s ease, filter 0.2s ease,
      box-shadow 0.2s ease, border-color 0.2s ease;
  }
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
  @keyframes spin { to { transform: rotate(360deg); } }
`;

/* --------------------------------- ICONS --------------------------------- */
function ShareIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <g
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="15" cy="4.5" r="2.3" />
        <circle cx="5" cy="10" r="2.3" />
        <circle cx="15" cy="15.5" r="2.3" />
        <path d="M7.1 8.9l5.8-3.3M7.1 11.1l5.8 3.3" />
      </g>
    </svg>
  );
}

function GraphIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <g
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 3v16h16" />
        <path d="M7 14l4-4 3 3 5-6" />
      </g>
    </svg>
  );
}

/* ================================= PAGE ================================== */
export default function NfcGallery() {
  const [fish, setFish] = useState<FishRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let rows: FishRow[] = [];
      try {
        rows = (await getExistingFish()) ?? [];
      } catch (err) {
        console.warn("[nfc-12345] getExistingFish failed:", err);
      }
      if (cancelled) return;
      setFish(rows.filter((r) => r && r.id && r.image_url));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Opens the device's share sheet (social apps). Falls back to copying the
  // link on browsers without the Web Share API (most desktops).
  async function handleShare() {
    const url = window.location.href;
    const data = {
      title: "The community fish tank",
      text: "Take a look at the fish made for Sydney’s endangered aquatic life.",
      url,
    };
    try {
      if (typeof navigator.share === "function") {
        await navigator.share(data);
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* share sheet dismissed */
    }
  }

  return (
    <StudioPage step={null}>
      <style>{HOLO_BTN_CSS}</style>

      <h1 style={styles.title}>Your fish collection</h1>

      <div style={styles.content}>
        {loading ? (
          <div role="status" style={styles.statusPill}>
            <div style={styles.spinner} />
            <span>Loading fish…</span>
          </div>
        ) : fish.length === 0 ? (
          <p style={studioStyles.body}>
            No fish yet.{" "}
            <Link to="/color" style={studioStyles.link}>
              Customise a fish
            </Link>
          </p>
        ) : (
          <div style={styles.grid}>
            {fish.map((f) => (
              <div key={f.id} style={styles.item}>
                <span style={styles.date}>{formatDate(f.created_at)}</span>
                <span style={styles.species} title={f.species}>
                  {f.species}
                </span>
                <div style={styles.square}>
                  <img
                    src={f.image_url}
                    alt={`A ${f.species}`}
                    loading="lazy"
                    style={styles.img}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Spacer so the fixed share tab never covers the last row */}
      <div style={{ height: 110 }} aria-hidden />

      {/* Share tab */}
      <nav style={styles.shareTab} aria-label="Share and aquarium">
        <button
          className="finish-btn"
          style={styles.shareBtn}
          onClick={handleShare}
          aria-label="Share"
        >
          <ShareIcon />
          <span>{copied ? "Link copied" : "Share"}</span>
        </button>
        <Link to={AQUARIUM_PATH} className="finish-btn" style={styles.graphBtn}>
          <GraphIcon />
          <span>Endangered species</span>
        </Link>
      </nav>
    </StudioPage>
  );
}

/* ---------------------------------- STYLES -------------------------------- */
const styles: Record<string, CSSProperties> = {
  title: { ...studioStyles.title, marginBottom: 22 },
  content: {
    width: "100%",
    maxWidth: 420,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },

  grid: {
    width: "100%",
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "18px 12px",
  },
  item: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minWidth: 0,
  },
  date: {
    marginBottom: 2,
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: 0.3,
    color: "rgba(255, 255, 255, 0.8)",
    textAlign: "center",
    whiteSpace: "nowrap",
  },
  species: {
    marginBottom: 6,
    maxWidth: "100%",
    fontSize: 12.5,
    fontWeight: 600,
    color: "#fff",
    textAlign: "center",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // Square artwork card, same cream as the colouring stage
  square: {
    width: "100%",
    aspectRatio: "1 / 1",
    boxSizing: "border-box",
    padding: 8,
    borderRadius: 16,
    background: "#f3efe4",
    boxShadow: "0 8px 20px rgba(0,0,0,0.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  img: {
    display: "block",
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
  },

  statusPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "14px 30px",
    borderRadius: 999,
    background: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.3)",
    color: "#fff",
    fontSize: 16,
    fontWeight: 500,
  },
  spinner: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    border: "2px solid rgba(255, 255, 255, 0.25)",
    borderTopColor: TEAL,
    animation: "spin 0.9s linear infinite",
  },

  // Fixed bar at the bottom: share on the left, graph icon beside it
  shareTab: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    padding: "14px 12px calc(18px + env(safe-area-inset-bottom, 0px))",
    pointerEvents: "none",
  },
  shareBtn: {
    ...GLASS_UI_CSS,
    ...HOLO_GLASS_OVERRIDES,
    pointerEvents: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
    padding: "14px 24px",
    borderRadius: 999,
    color: "#fff",
    fontFamily: "'Poppins', sans-serif",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
  },
  graphBtn: {
    ...GLASS_UI_CSS,
    ...HOLO_GLASS_OVERRIDES,
    pointerEvents: "auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "14px 22px",
    boxSizing: "border-box",
    borderRadius: 999,
    color: "#fff",
    fontFamily: "'Poppins', sans-serif",
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.2,
    textAlign: "left",
    textDecoration: "none",
    cursor: "pointer",
  },
};
