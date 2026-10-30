import { useEffect, useState, type CSSProperties } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import StudioPage, { studioStyles } from "~/components/steppers";
import { GLASS_UI_CSS, HOLO_GLASS_OVERRIDES } from "~/components/glass-ui";
import { loadFinishedFish, type FinishedFish } from "~/functions/finished-fish";

const NFC_PATH = "/color/nfc-collect";

// savedAt is optional so fish saved before this change still load.
type SavedFish = FinishedFish & { savedAt?: number };

/** "30 Oct 2026 · 9:29 am" */
function formatStamp(ts: number) {
  const d = new Date(ts);
  const date = d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d
    .toLocaleTimeString("en-AU", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/[\u202f\u00a0]/g, " ")
    .toLowerCase();
  return `${date} · ${time}`;
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
`;

export default function Completed() {
  const location = useLocation();
  const navigate = useNavigate();

  const [fish, setFish] = useState<SavedFish | null>(
    (location.state as SavedFish | null) ?? null,
  );
  const [checked, setChecked] = useState(Boolean(fish));
  // Fallback stamp for fish saved without a timestamp
  const [fallbackTs] = useState(() => Date.now());

  useEffect(() => {
    if (!fish) setFish(loadFinishedFish());
    setChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <StudioPage step={2}>
      <style>{HOLO_BTN_CSS}</style>

      <h1 style={styles.title}>Your fish is saved!</h1>

      {fish ? (
        <div style={styles.content}>
          <p style={styles.intro}>
            It has joined the community tank, swimming alongside fish made by
            everyone who visits. Look up at the dashboard to spot yours in the
            tank.
          </p>

          {/* Artwork card with date/time stamp */}
          <div style={styles.fishCard}>
            <img
              src={fish.imageUrl}
              alt={`Your finished ${fish.label}`}
              style={styles.fishImg}
            />
            <span style={styles.stamp}>
              Saved {formatStamp(fish.savedAt ?? fallbackTs)}
            </span>
          </div>

          <p style={styles.keepsake}>
            <strong>Screenshot this to keep it.</strong> Your artwork, stamped
            with today’s date and time, is a keepsake of the day you made your
            mark on the tank.
          </p>

          {/* Glass card */}
          <section style={styles.nfcCard}>
            <div style={styles.nfcHeader}>
              <h2 style={styles.nfcTitle}>Take your fish home</h2>
              <span aria-hidden style={styles.infoIcon}>
                i
              </span>
            </div>

            <p style={styles.nfcBody}>
              Turn your artwork into a 3D-printed NFC tag you can hold, and help
              protect Sydney’s endangered aquatic life.
            </p>

            <button
              className="finish-btn"
              style={styles.holoBtn}
              onClick={() => navigate(NFC_PATH)}
            >
              Purchase NFC tag
            </button>
          </section>
        </div>
      ) : (
        checked && (
          <p style={studioStyles.body}>
            We couldn’t find your fish.{" "}
            <Link to="/color" style={studioStyles.link}>
              Customise a fish
            </Link>
          </p>
        )
      )}
    </StudioPage>
  );
}

/* ---------------------------------- STYLES -------------------------------- */
const styles: Record<string, CSSProperties> = {
  title: { ...studioStyles.title, marginBottom: 10 },
  content: {
    width: "100%",
    maxWidth: 420,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  intro: {
    ...studioStyles.body,
    fontSize: 12,
    maxWidth: 360,
    margin: "0 0 22px",
  },

  fishCard: {
    ...studioStyles.card,
    position: "relative",
    width: "100%",
    boxSizing: "border-box",
    minHeight: 200,
    padding: "28px 20px 44px",
    borderRadius: 24,
  },
  fishImg: {
    display: "block",
    maxWidth: "75%",
    maxHeight: 240,
    objectFit: "contain",
  },
  stamp: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 14,
    textAlign: "center",
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: 0.3,
    color: "#6f6d63",
  },

  keepsake: {
    ...studioStyles.body,
    fontSize: 12,
    maxWidth: 400,
    margin: "18px 0 28px",
  },

  // Glass card, tinted teal to match the stepper accent
  nfcCard: {
    ...GLASS_UI_CSS,
    background:
      "linear-gradient(135deg, rgba(83, 215, 199, 0.12) 0%, rgba(83, 215, 199, 0.04) 100%), " +
      "rgba(10, 20, 35, 0.45)",
    border: "1px solid rgba(83, 215, 199, 0.4)",
    borderRadius: 20,
    width: "100%",
    boxSizing: "border-box",
    padding: "22px 24px 26px",
  },
  nfcHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  nfcTitle: { margin: 0, fontSize: 17, fontWeight: 600, color: "#fff" },
  infoIcon: {
    width: 26,
    height: 26,
    borderRadius: "50%",
    border: "1.5px solid #53D7C7",
    color: "#53D7C7",
    fontSize: 13,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  },
  nfcBody: {
    margin: "14px 0 22px",
    fontSize: 14.5,
    lineHeight: 1.5,
    color: "rgba(255, 255, 255, 0.9)",
  },

  // Holographic glass pill, same as finishBtn in color-fish.tsx
  holoBtn: {
    ...GLASS_UI_CSS,
    ...HOLO_GLASS_OVERRIDES,
    display: "block",
    margin: "0 auto",
    padding: "14px 30px",
    borderRadius: 999,
    color: "#fff",
    fontFamily: "'Poppins', sans-serif",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
  },
};
