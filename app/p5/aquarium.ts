import type p5 from "p5";
import {
  getExistingFish,
  subscribeToNewFish,
  supabase,
  type FishRow,
} from "../lib/supabase";
import { glassUICss, HOLO_GLASS_OVERRIDES } from "../components/glass-ui";
import {
  type Fish,
  type FishSprite,
  type Kelp,
  type Bubble,
  type Rock,
  type CameraState,
  createCommon,
  isInsideCanvas,
} from "./common-functions";
import "./aquarium-stats.css";

// TODO: change after demo
// true = FRONT VIEW / FISH CLICK buttons sit top-left, false = bottom-left
const BUTTONS_TOP_LEFT = false;

/* =========================================================================
   3D AQUARIUM — p5.js (WEBGL) — TypeScript
   ========================================================================= */

/* ------------------------------ CONFIG ---------------------------------- */
const TANK = { w: 780, h: 460, d: 460, floorY: 230, topY: -230 };
const TANK_OFFSET_Y = 90; // world units; positive = tank sits lower on screen

const MIN_FISH = 0;
const NO_IMG_FISH = 0;

// TODO: depends on nfc price
const RATES: Record<string, number> = {
  hoesesgoby: 30,
  whiteseahorse: 24,
  parmaunifasciata: 20,
  angelshark: 30,
  mecaenichthys: 9,
  scorpionfish: 18,
};

/* ---------------------- TRACKED (THREATENED) SPECIES -------------------- */
const TARGET_SPECIES = [
  { display: "Hoese's Goby", canon: "hoesesgoby" },
  { display: "White Seahorse", canon: "whiteseahorse" },
  { display: "Parma Unifasciata", canon: "parmaunifasciata" },
  { display: "Angelshark", canon: "angelshark" },
  { display: "Mecaenichthys", canon: "mecaenichthys" },
  { display: "Scorpionfish", canon: "scorpionfish" },
] as const;

function canonSpecies(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type FishRowWithSpecies = FishRow & { outline?: string | null };

export function sketch(p: p5): void {
  const common = createCommon(p);

  const FISH_FILES: string[] = [];

  let camState: CameraState = {
    theta: 0.7,
    phi: 0.16,
    radius: 1080,
    x: 0,
    y: 0,
    z: 0,
    right: null as unknown as p5.Vector,
    dragging: false,
    idleTime: 99,
  };

  let frontView = false;
  let frontZoom = 1;
  let savedTheta = 0.7;
  let savedPhi = 0.16;
  let savedRadius = 1080;
  let viewBtn: p5.Element;

  let selectMode = true;
  let modeBtn: p5.Element;

  let loadedFishImgs: p5.Image[] = [];
  let fallbackFishImgs: p5.Graphics[] = [];

  const fishes: Fish[] = [];
  const kelps: Kelp[] = [];
  const bubbles: Bubble[] = [];
  const rocks: Rock[] = [];

  const speciesCounts = new Map<string, number>();
  const targetCounts = new Map<string, number>();
  const contributionRates = new Map<string, number>();

  let statsWrap: HTMLElement | null = null;
  let statSavedHeader: HTMLElement | null = null;
  let statSavedCount: HTMLElement | null = null;
  let statsRowTop: HTMLElement | null = null;
  let statsRowBottom: HTMLElement | null = null;
  let scanPrompt: HTMLElement | null = null;

  const flipStates = new Map<string, boolean>();

  type CardRef = {
    outer: HTMLElement;
    frontLabel: HTMLElement;
    frontSpecies: HTMLElement;
    frontCount: HTMLElement;
    backLabel: HTMLElement;
    backSpecies: HTMLElement;
    backNote: HTMLElement;
    backAmount: HTMLElement;
  };
  const cardRefs: CardRef[] = [];

  let bubbleImg: p5.Graphics;
  let skyImg: p5.Graphics;
  let sandImg: p5.Graphics;
  let t = 0;

  let runId = 0;

  let pendingFishClick: Fish | null = null;
  let mouseDownX = 0;
  let mouseDownY = 0;

  let audioCtx: AudioContext | null = null;

  /* ------------------------- PETTING: STATE ------------------------------ */
  const PET_DURATION = 0.9; // seconds
  const petAnim = new WeakMap<Fish, number>(); // fish -> time the pet started

  type FxKind = "heart" | "sparkle" | "bubble" | "sprinkle";
  type Particle = {
    kind: FxKind;
    x: number;
    y: number;
    vx: number;
    vy: number;
    gravity: number; // px/s^2 (positive = falls)
    drag: number; // 0 = none
    wob: number; // sideways sway amplitude (px/s)
    wobSpeed: number;
    phase: number;
    age: number;
    life: number;
    delay: number;
    size: number;
    rot: number;
    vrot: number;
    color: string;
  };
  const particles: Particle[] = [];
  let fxCanvas: HTMLCanvasElement | null = null;
  let fxCtx: CanvasRenderingContext2D | null = null;
  let fxDpr = 1;
  let fxRaf = 0;
  let fxLast = 0;

  const HEART_COLORS = ["#ff6fa5", "#ff8fb8", "#ff5c93", "#ffb3d1"];
  const SPARKLE_COLORS = ["#fff6b0", "#ffffff", "#ffe27a", "#bff3ff"];
  const SPRINKLE_COLORS = [
    "#ff7aa8",
    "#ffd166",
    "#7fe3ff",
    "#a6f0b0",
    "#c9a7ff",
  ];
  const PET_SOUNDS = ["chime", "pop", "boop", "trill"] as const;

  /* ---------------------- CONTAINER-SIZE HELPERS ------------------------- */
  function containerSize(): { w: number; h: number } {
    const node = (p as any)._userNode as HTMLElement | undefined;
    if (node && node.clientWidth > 0 && node.clientHeight > 0) {
      return { w: node.clientWidth, h: node.clientHeight };
    }
    return {
      w: Math.max(1, window.innerWidth / 2),
      h: Math.max(1, window.innerHeight),
    };
  }

  /* ------------------------- STATE RESET ---------------------------- */
  function resetState(): void {
    fishes.length = 0;
    kelps.length = 0;
    bubbles.length = 0;
    rocks.length = 0;
    FISH_FILES.length = 0;
    loadedFishImgs = [];
    fallbackFishImgs = [];
    seenFishIds.clear();
    pendingFishRows.length = 0;
    tankReady = false;
    frontView = false;
    frontZoom = 1;
    t = 0;

    removeFx();

    selectMode = true;
    if (modeBtn) {
      modeBtn.html("FISH CLICK: ON");
      modeBtn.style("color", "#7fd4ff");
      modeBtn.style("border-color", "#2a6a99");
      modeBtn.style("background", "rgba(10, 34, 51, 0.85)");
    }

    speciesCounts.clear();
    targetCounts.clear();
    contributionRates.clear();
    flipStates.clear();

    if (statsWrap) {
      statsWrap.remove();
      statsWrap = null;
    }
    if (scanPrompt) {
      scanPrompt.remove();
      scanPrompt = null;
    }
    statSavedHeader = null;
    statSavedCount = null;
    statsRowTop = null;
    statsRowBottom = null;
    cardRefs.length = 0;

    pendingFishClick = null;

    camState.theta = 0.7;
    camState.phi = 0.16;
    camState.radius = 1080;
    camState.dragging = false;
    camState.idleTime = 99;
  }

  function customCleanup(): void {
    runId++;
    teardownRealtime();

    removeFx();

    if (viewBtn) viewBtn.remove();
    if (modeBtn) modeBtn.remove();

    if (statsWrap) {
      statsWrap.remove();
      statsWrap = null;
    }
    if (scanPrompt) {
      scanPrompt.remove();
      scanPrompt = null;
    }
    statSavedHeader = null;
    statSavedCount = null;
    statsRowTop = null;
    statsRowBottom = null;
    cardRefs.length = 0;

    if (audioCtx) {
      try {
        void audioCtx.close();
      } catch {
        /* noop */
      }
      audioCtx = null;
    }
  }

  /* ======================================================================
     CARD + PROMPT STYLES (injected once) — Poppins everywhere
     ====================================================================== */
  let stylesInjected = false;
  function ensureFlipStyles(): void {
    if (stylesInjected) return;
    stylesInjected = true;

    if (!document.getElementById("aq-poppins-font")) {
      const pre1 = document.createElement("link");
      pre1.rel = "preconnect";
      pre1.href = "https://fonts.googleapis.com";
      document.head.appendChild(pre1);

      const pre2 = document.createElement("link");
      pre2.rel = "preconnect";
      pre2.href = "https://fonts.gstatic.com";
      pre2.crossOrigin = "anonymous";
      document.head.appendChild(pre2);

      // Includes italics for the "endangered fishes" line.
      const link = document.createElement("link");
      link.id = "aq-poppins-font";
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,500;1,600&display=swap";
      document.head.appendChild(link);
    }

    const style = document.createElement("style");
    style.id = "aq-flip-styles";
    style.textContent = `
      .aq-stats-wrap,
      .aq-stats-wrap * {
        font-family: 'Poppins', system-ui, -apple-system, 'Segoe UI', sans-serif !important;
      }

      /* Force the whole strip above the p5 canvas and interactive. */
      .aq-stats-wrap {
        /* tweak these three to resize the whole block */
        --aq-count-size: 60px;
        --aq-unit-size: 14px;
        --aq-card-h: 80px;

        position: absolute !important;
        z-index: 100 !important;
        pointer-events: auto !important;
        max-width: 1100px;
        margin: 0 auto;
      }
      .aq-stats-row {
        pointer-events: auto !important;
        gap: 14px !important;
      }

      /* ---------- HEADER: eyebrow / wave / big count / italic unit ------- */
      .aq-saved-header {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        width: 100%;
        margin: 0 0 14px 0;
      }
      /* soft teal glow behind the number */
      .aq-saved-header::before {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        width: 560px;
        height: 280px;
        transform: translate(-50%, -50%);
        background: radial-gradient(
          closest-side,
          rgba(83, 215, 199, 0.18),
          rgba(83, 215, 199, 0) 100%
        );
        pointer-events: none;
        z-index: -1;
      }
      .aq-saved-eyebrow {
        font-size: 14px;
        font-weight: 400;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        color: rgba(160, 228, 220, 0.85);
        line-height: 1.2;
        /* trailing letter-spacing would shift the text off-centre */
        padding-left: 0.36em;
      }
      .aq-saved-wave {
        margin: 8px 0 2px 0;
        color: rgba(83, 215, 199, 0.7);
        line-height: 0;
      }
      .aq-saved-wave svg {
        width: 220px;
        height: 12px;
        display: block;
      }
      .aq-saved-count {
        font-size: var(--aq-count-size);
        font-weight: 500;
        line-height: 1;
        color: #53D7C7;
        text-shadow: 0 0 28px rgba(83, 215, 199, 0.55);
      }
      .aq-saved-unit {
        margin-top: 4px;
        font-size: var(--aq-unit-size);
        font-style: italic;
        font-weight: 400;
        letter-spacing: 0.20em;
        text-transform: uppercase;
        color: rgba(160, 228, 220, 0.85);
        line-height: 1.2;
      }

      /* ---------- FLIP CARD (whole card rotates, bulletproof hit) -------- */
      .aq-flip-card {
        flex: 1 1 0;
        min-width: 180px;
        height: var(--aq-card-h);
        position: relative !important;
        z-index: 100 !important;
        perspective: 1200px;
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        pointer-events: auto !important;
        outline: none;
      }
      .aq-flip-card:focus-visible {
        outline: 2px solid #53D7C7;
        outline-offset: 3px;
        border-radius: 16px;
      }
      .aq-flip-inner {
        position: relative;
        width: 100%;
        height: 100%;
        transform-style: preserve-3d;
        transition: transform 0.7s cubic-bezier(0.4, 0.2, 0.2, 1);
        pointer-events: auto !important;
      }
      .aq-flip-card.aq-flipped .aq-flip-inner {
        transform: rotateY(180deg);
      }
      .aq-flip-face {
        position: absolute;
        top: 0; left: 0;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: stretch;
        gap: 4px;
        padding: 14px 18px 12px;
        overflow: hidden;
        pointer-events: auto !important;
      }
      .aq-flip-back {
        transform: rotateY(180deg);
      }

      /* row 1: small label (left) + note (right) */
      .aq-card-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        width: 100%;
      }
      /* row 2: species (left) + big number (right) */
      .aq-card-bottom {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 10px;
        width: 100%;
        min-width: 0;
      }

      .aq-flip-face .aq-stat-label {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: #7fd4ff;
        line-height: 1.1;
        white-space: nowrap;
      }
      .aq-count-label,
      .aq-contrib-note {
        font-size: 10.5px;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.6);
        letter-spacing: 0.2px;
        line-height: 1.1;
        white-space: nowrap;
        text-align: right;
      }
      .aq-species-highlight {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 18px;
        font-weight: 600;
        color: #fff;
        line-height: 1.15;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-shadow: 0 0 12px rgba(83, 215, 199, 0.35);
      }
      .aq-count-value,
      .aq-contrib-amount {
        flex: 0 0 auto;
        font-size: 34px;
        font-weight: 500;
        line-height: 0.9;
        color: #53D7C7;
        text-shadow: 0 0 14px rgba(83, 215, 199, 0.5);
      }

      /* bottom three cards are visually quieter (like the design) */
      .aq-card-dim .aq-species-highlight {
        color: rgba(222, 234, 237, 0.88);
        text-shadow: none;
      }
      .aq-card-dim .aq-count-value,
      .aq-card-dim .aq-contrib-amount {
        color: #8fb3bd;
        text-shadow: none;
      }

      /* ---------- Bottom-of-tank QR prompt (pill) ----------------------- */
      .aq-scan-prompt {
        position: absolute;
        left: 50%;
        bottom: 16px;
        transform: translateX(-50%);
        font-family: 'Poppins', system-ui, sans-serif;
        padding: 9px 18px;
        border-radius: 999px;
        background: rgba(251, 243, 225, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.18);
        color: rgba(255, 255, 255, 0.5);
        font-size: 11.5px;
        font-weight: 400;
        letter-spacing: 0.3px;
        white-space: nowrap;
        transition: all 0.25s ease;
        pointer-events: none;
        z-index: 5;
      }
    `;
    document.head.appendChild(style);
  }

  /* ======================================================================
     SIX-CARD FLIP GRID
     ====================================================================== */

  function txt(className: string, text = ""): HTMLElement {
    const el = document.createElement("div");
    el.className = className;
    el.textContent = text;
    return el;
  }

  function mkRow(
    className: string,
    left: HTMLElement,
    right: HTMLElement,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = className;
    row.append(left, right);
    return row;
  }

  /** Toggle a card's flip state. Fails safe on the species lookup. */
  function toggleCardFlip(card: CardRef): void {
    const species =
      card.outer.dataset.species ||
      TARGET_SPECIES[cardRefs.indexOf(card)]?.canon ||
      "";
    if (!species) return;

    const next = !card.outer.classList.contains("aq-flipped");
    card.outer.classList.toggle("aq-flipped", next);
    card.outer.setAttribute("aria-pressed", next ? "true" : "false");
    flipStates.set(species, next);
  }

  function makeFlipCard(holo: boolean): CardRef {
    const outer = document.createElement("div");
    outer.className = `aq-flip-card ${holo ? "aq-card-holo" : "aq-card-dim"}`;
    outer.setAttribute("role", "button");
    outer.setAttribute("aria-pressed", "false");
    outer.tabIndex = 0;

    const stop = (e: Event) => e.stopPropagation();
    outer.addEventListener("mousedown", stop);
    outer.addEventListener("touchstart", stop, { passive: true });
    outer.addEventListener("pointerdown", stop);
    outer.addEventListener("wheel", stop, { passive: true });

    const inner = document.createElement("div");
    inner.className = "aq-flip-inner";

    // Top 3 cards: holo glass. Bottom 3: default glass.
    const glassCss = glassUICss(holo ? HOLO_GLASS_OVERRIDES : {});

    /* FRONT
         row 1:  THREATENED #N ............ total count in tank
         row 2:  Species name ........................ number   */
    const front = document.createElement("div");
    front.className = "aq-flip-face aq-flip-front";
    front.style.cssText = glassCss;

    const frontLabel = txt("aq-stat-label", "Threatened #1");
    const frontCountLabel = txt("aq-count-label", "total count in tank");
    const frontSpecies = txt("aq-species-highlight", "—");
    const frontCount = txt("aq-count-value", "0");

    front.append(
      mkRow("aq-card-top", frontLabel, frontCountLabel),
      mkRow("aq-card-bottom", frontSpecies, frontCount),
    );

    /* BACK — same structure
         row 1:  BIODIVERSITY OF .......... contribution from nfc sales
         row 2:  Species name ........................ $amount   */
    const back = document.createElement("div");
    back.className = "aq-flip-face aq-flip-back";
    back.style.cssText = glassCss;

    const backLabel = txt("aq-stat-label", "Biodiversity of");
    const backNote = txt("aq-contrib-note", "contribution from nfc sales");
    const backSpecies = txt("aq-species-highlight", "—");
    const backAmount = txt("aq-contrib-amount", "$0");

    back.append(
      mkRow("aq-card-top", backLabel, backNote),
      mkRow("aq-card-bottom", backSpecies, backAmount),
    );

    inner.append(front, back);
    outer.appendChild(inner);

    /* ---- PRIMARY TRIGGER: pointerdown (immediate + drag-proof) -------- */
    outer.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (e.button !== undefined && e.button > 0) return;
      toggleCardFlip(cardRef);
    });

    /* ---- BACKUP TRIGGER: click (accessibility / touch click) ---------- */
    let lastPointerAt = 0;
    outer.addEventListener("pointerdown", () => {
      lastPointerAt = Date.now();
    });
    outer.addEventListener("click", (e) => {
      e.stopPropagation();
      if (Date.now() - lastPointerAt < 400) return;
      toggleCardFlip(cardRef);
    });

    /* ---- KEYBOARD ------------------------------------------------------ */
    outer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleCardFlip(cardRef);
      }
    });

    const cardRef: CardRef = {
      outer,
      frontLabel,
      frontSpecies,
      frontCount,
      backLabel,
      backSpecies,
      backNote,
      backAmount,
    };
    return cardRef;
  }

  function buildStatsUI(): void {
    ensureFlipStyles();

    if (statsWrap) statsWrap.remove();
    cardRefs.length = 0;

    const host = (p as any)._userNode as HTMLElement | undefined;

    const wrap = document.createElement("div");
    wrap.className = "aq-stats-wrap";
    if (host) host.appendChild(wrap);
    statsWrap = wrap;

    // Buttons live at the bottom-left, so the stats span the full top strip.
    wrap.style.top = BUTTONS_TOP_LEFT ? "76px" : "24px";
    wrap.style.left = "24px";
    wrap.style.right = "24px";

    /* Header:
         COLLECTIVELY, WE HAVE SAVED
         ~~~~~~~~ wave ~~~~~~~~
                    5
           endangered fishes            */
    const header = document.createElement("div");
    header.className = "aq-saved-header";

    const eyebrow = txt("aq-saved-eyebrow", "Collectively, we have saved");

    const wave = document.createElement("div");
    wave.className = "aq-saved-wave";
    wave.innerHTML = `
      <svg viewBox="0 0 220 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M0 6 Q 13.75 0 27.5 6 T 55 6 T 82.5 6 T 110 6 T 137.5 6 T 165 6 T 192.5 6 T 220 6"
              stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>`;

    const count = txt("aq-saved-count", String(seenFishIds.size));
    const unit = txt("aq-saved-unit", "endangered fishes");

    header.append(eyebrow, wave, count, unit);
    wrap.appendChild(header);
    statSavedHeader = header;
    statSavedCount = count;

    /* Top row: 3 holo */
    const rowTop = document.createElement("div");
    rowTop.className = "aq-stats-row";
    wrap.appendChild(rowTop);
    statsRowTop = rowTop;

    /* Bottom row: 3 glass */
    const rowBottom = document.createElement("div");
    rowBottom.className = "aq-stats-row";
    rowBottom.style.marginTop = "14px";
    wrap.appendChild(rowBottom);
    statsRowBottom = rowBottom;

    for (let i = 0; i < 3; i++) {
      const card = makeFlipCard(true);
      rowTop.appendChild(card.outer);
      cardRefs.push(card);
    }
    for (let i = 0; i < 3; i++) {
      const card = makeFlipCard(false);
      rowBottom.appendChild(card.outer);
      cardRefs.push(card);
    }

    refreshStats();
  }

  function buildScanPrompt(): void {
    ensureFlipStyles();
    const host = (p as any)._userNode as HTMLElement | undefined;
    if (!host) return;

    if (scanPrompt) scanPrompt.remove();

    // TODO: remove block below after demo
    const el = document.createElement("div");
    el.className = "aq-scan-prompt";
    el.textContent =
      "contribute to this tank by scanning the various QR codes below";
    host.appendChild(el);
    scanPrompt = el;
  }

  /* -------------------- BOTTOM-LEFT BUTTON LAYOUT ------------------------ */
  /**
   * Place FRONT VIEW + FISH CLICK: ON/OFF at the bottom of the container,
   * aligned to the same 16px bottom gutter as the scan-prompt pill. They
   * sit to the left of the (centred) pill; if the container is narrow
   * enough that the pill would overlap them, they slide leftward so the
   * gutter is preserved.
   */
  function positionBottomButtons(): void {
    if (!viewBtn || !modeBtn) return;

    const { h } = containerSize();
    const viewEl = viewBtn.elt as HTMLElement;
    const modeEl = modeBtn.elt as HTMLElement;

    const btnH = viewEl.offsetHeight || 38;
    const viewW = viewEl.offsetWidth || 130;
    const modeW = modeEl.offsetWidth || 155;

    let x = 24;
    let y: number;

    if (BUTTONS_TOP_LEFT) {
      // Same 24px gutter as the stats strip; no pill to avoid up here.
      y = 24;
    } else {
      // Matches .aq-scan-prompt { bottom: 16px }.
      y = Math.max(0, h - 16 - btnH);

      const totalBtnW = viewW + 12 + modeW;
      if (scanPrompt) {
        try {
          const host = (p as any)._userNode as HTMLElement | undefined;
          if (host) {
            const pillRect = scanPrompt.getBoundingClientRect();
            const hostRect = host.getBoundingClientRect();
            const pillLeft = pillRect.left - hostRect.left;
            if (x + totalBtnW + 16 > pillLeft) {
              x = Math.max(8, pillLeft - totalBtnW - 16);
            }
          }
        } catch {
          /* keep default x */
        }
      }
    }

    viewBtn.position(x, y);
    modeBtn.position(x + viewW + 12, y);
  }

  function refreshStats(): void {
    if (statSavedCount) {
      statSavedCount.textContent = String(seenFishIds.size);
    }

    if (cardRefs.length !== 6) return;

    const ranked = TARGET_SPECIES.map((s) => ({
      display: s.display,
      canon: s.canon,
      count: targetCounts.get(s.canon) ?? 0,
      rate: contributionRates.get(s.canon) ?? 0,
    })).sort((a, b) => b.count - a.count);

    for (let i = 0; i < 6; i++) {
      const s = ranked[i];
      const card = cardRefs[i];
      if (!s) continue;

      card.frontLabel.textContent = `Threatened #${i + 1}`;
      card.frontSpecies.textContent = s.display;
      card.frontCount.textContent = String(s.count);

      card.backLabel.textContent = "Biodiversity of";
      card.backSpecies.textContent = s.display;
      card.backAmount.textContent = `$${(s.rate * s.count).toLocaleString("en-US")}`;

      card.outer.dataset.species = s.canon;
      card.outer.title = `${s.display}: ${s.count} in tank`;

      const flipped = flipStates.get(s.canon) ?? false;
      card.outer.classList.toggle("aq-flipped", flipped);
      card.outer.setAttribute("aria-pressed", flipped ? "true" : "false");
    }
  }

  /* ------------------------- FISH LOADING / SPAWN ------------------------- */

  function buildFishes(): void {
    fishes.length = 0;

    if (loadedFishImgs.length === 0) {
      for (let i = 0; i < NO_IMG_FISH; i++) {
        fishes.push(makeFish(fallbackFishImgs[i % fallbackFishImgs.length]));
      }
      return;
    }

    for (const img of loadedFishImgs) fishes.push(makeFish(img));

    let i = 0;
    while (fishes.length < MIN_FISH) {
      fishes.push(makeFish(fallbackFishImgs[i++ % fallbackFishImgs.length]));
    }
  }

  function makeFish(img: FishSprite): Fish {
    return {
      img,
      size: p.random(72, 118),
      pos: p.createVector(
        p.random(-TANK.w * 0.32, TANK.w * 0.32),
        p.random(-130, 120),
        p.random(-TANK.d * 0.32, TANK.d * 0.32),
      ),
      vel: p
        .createVector(p.random(-1, 1), 0, p.random(-1, 1))
        .normalize()
        .mult(p.random(1.1, 2.0)),
      speed: p.random(1.0, 2.1),
      phase: p.random(1000),
      fin: p.random(p.TWO_PI),
      bob: p.random(p.TWO_PI),
      baseY: p.random(-120, 110),
    };
  }

  /* ------------------------------- SETUP ---------------------------------- */
  p.setup = () => {
    resetState();
    runId++;

    for (const s of TARGET_SPECIES) {
      targetCounts.set(s.canon, 0);
      contributionRates.set(s.canon, RATES[s.canon] ?? 0);
    }

    const { w, h } = containerSize();
    p.createCanvas(w, h, p.WEBGL);
    p.perspective(p.PI / 3, w / h, 10, 7000);
    p.strokeCap(p.ROUND);

    camState.right = p.createVector(1, 0, 0);

    bubbleImg = common.makeBubbleSprite();
    skyImg = common.makeSkyTexture();
    sandImg = common.makeSandTexture();

    const palettes: Array<
      [
        [number, number, number],
        [number, number, number],
        [number, number, number],
      ]
    > = [
      [
        [255, 146, 74],
        [255, 96, 46],
        [255, 196, 120],
      ],
      [
        [104, 196, 255],
        [46, 124, 224],
        [168, 232, 255],
      ],
      [
        [255, 214, 92],
        [242, 172, 44],
        [255, 240, 168],
      ],
    ];
    fallbackFishImgs = palettes.map((pl) =>
      common.makeFishSprite(pl[0], pl[1], pl[2]),
    );

    initFishFromSupabase();

    for (let i = 0; i < 12; i++) {
      kelps.push(
        makeKelp(
          p.random(-TANK.w * 0.44, TANK.w * 0.44),
          p.random(-TANK.d * 0.44, TANK.d * 0.44),
        ),
      );
    }

    for (let i = 0; i < 7; i++) {
      rocks.push({
        x: p.random(-TANK.w * 0.42, TANK.w * 0.42),
        z: p.random(-TANK.d * 0.42, TANK.d * 0.42),
        s: p.random(24, 62),
        r: p.random(p.TWO_PI),
        c: p.random(70, 110),
      });
    }

    camState.right = p.createVector(1, 0, 0);

    const host = () => (p as any)._userNode as HTMLElement | undefined;

    /* --- View toggle button (bottom-left, above the scan prompt) ------ */
    viewBtn = p.createButton("FRONT VIEW");
    if (host()) viewBtn.parent(host()!);
    viewBtn.style("padding", "10px 18px");
    viewBtn.style("background", "rgba(10, 34, 51, 0.85)");
    viewBtn.style("color", "#7fd4ff");
    viewBtn.style("border", "1px solid #2a6a99");
    viewBtn.style("border-radius", "8px");
    viewBtn.style("font-family", "'Poppins', sans-serif");
    viewBtn.style("font-size", "13px");
    viewBtn.style("letter-spacing", "1.5px");
    viewBtn.style("cursor", "pointer");
    viewBtn.style("outline", "none");
    viewBtn.style("z-index", "10");
    viewBtn.mousePressed(toggleView);

    /* --- Interaction-mode toggle (bottom-left, right of FRONT VIEW) --- */
    modeBtn = p.createButton("FISH CLICK: ON");
    if (host()) modeBtn.parent(host()!);
    modeBtn.style("padding", "10px 18px");
    modeBtn.style("background", "rgba(10, 34, 51, 0.85)");
    modeBtn.style("color", "#7fd4ff");
    modeBtn.style("border", "1px solid #2a6a99");
    modeBtn.style("border-radius", "8px");
    modeBtn.style("font-family", "'Poppins', sans-serif");
    modeBtn.style("font-size", "13px");
    modeBtn.style("letter-spacing", "1.5px");
    modeBtn.style("cursor", "pointer");
    modeBtn.style("outline", "none");
    modeBtn.style("z-index", "10");
    modeBtn.mousePressed(toggleSelectMode);

    buildStatsUI();
    buildScanPrompt();

    // Position once with rough sizes, then once more after layout so the
    // pill's real width is taken into account.
    positionBottomButtons();
    requestAnimationFrame(positionBottomButtons);
  };

  /* ------------------- SUPABASE: INITIAL LOAD + REALTIME ------------------ */

  const seenFishIds = new Set<string>();
  const pendingFishRows: FishRow[] = [];
  let tankReady = false;
  let fishChannel: ReturnType<typeof subscribeToNewFish> | null = null;

  function trackSpecies(row: FishRow): void {
    const raw = (row as FishRowWithSpecies).outline;
    const key = (raw ?? "").toString().trim() || "unknown";
    speciesCounts.set(key, (speciesCounts.get(key) ?? 0) + 1);

    const canon = canonSpecies(key);
    if (targetCounts.has(canon)) {
      targetCounts.set(canon, (targetCounts.get(canon) ?? 0) + 1);
    }
  }

  function initFishFromSupabase(): void {
    teardownRealtime();
    const run = runId;
    subscribeToRealtimeFish(run);
    void loadExistingFish(run);
  }

  async function loadExistingFish(run: number): Promise<void> {
    let rows: FishRow[] = [];
    try {
      rows = (await getExistingFish()) ?? [];
    } catch (err) {
      console.warn("[aquarium] getExistingFish failed:", err);
    }

    if (run !== runId) return;

    FISH_FILES.length = 0;
    for (const row of rows) {
      if (!row || !row.id || seenFishIds.has(row.id)) continue;
      seenFishIds.add(row.id);
      trackSpecies(row);
      if (row.image_url) FISH_FILES.push(row.image_url);
    }

    refreshStats();

    common.loadFishImages(FISH_FILES, (imgs) => {
      if (run !== runId) return;
      loadedFishImgs = imgs;
      buildFishes();
      tankReady = true;
      flushPendingFishRows(run);
    });
  }

  function subscribeToRealtimeFish(run: number): void {
    try {
      fishChannel = subscribeToNewFish((row: FishRow) => {
        if (run !== runId) return;
        handleNewFishRow(row);
      });
    } catch (err) {
      console.warn("[aquarium] subscribeToNewFish failed:", err);
    }
  }

  function handleNewFishRow(row: FishRow): void {
    if (!row || !row.id || seenFishIds.has(row.id)) return;
    seenFishIds.add(row.id);
    trackSpecies(row);
    refreshStats();

    if (!tankReady) {
      pendingFishRows.push(row);
      return;
    }

    spawnFishFromRow(row);
  }

  function flushPendingFishRows(run: number): void {
    while (pendingFishRows.length > 0) {
      const row = pendingFishRows.shift();
      if (row) spawnFishFromRow(row, run);
    }
  }

  function spawnFishFromRow(row: FishRow, run: number = runId): void {
    const url = row.image_url;

    if (!url) {
      addFishToTank(makeFish(randomFallbackSprite()));
      return;
    }

    p.loadImage(
      url,
      (img) => {
        if (run !== runId) return;
        loadedFishImgs.push(img);
        addFishToTank(makeFish(img));
      },
      () => {
        if (run !== runId) return;
        console.warn("[aquarium] new fish image failed to load:", url);
        addFishToTank(makeFish(randomFallbackSprite()));
      },
    );
  }

  function randomFallbackSprite(): FishSprite {
    return fallbackFishImgs[fishes.length % fallbackFishImgs.length];
  }

  function addFishToTank(f: Fish): void {
    common.enterFromEdge(f, TANK.w, TANK.d);
    fishes.push(f);
  }

  function teardownRealtime(): void {
    if (!fishChannel) return;
    try {
      void supabase.removeChannel(fishChannel);
    } catch (err) {
      console.warn("[aquarium] removeChannel failed:", err);
    }
    fishChannel = null;
  }

  /* ------------------------- VIEW TOGGLE ---------------------------------- */
  function toggleView(): void {
    frontView = !frontView;
    if (frontView) {
      savedTheta = camState.theta;
      savedPhi = camState.phi;
      savedRadius = camState.radius;

      camState.theta = 0;
      camState.phi = 0;
      camState.radius = 1200;
      viewBtn.html("ORBIT VIEW");
    } else {
      camState.theta = savedTheta;
      camState.phi = savedPhi;
      camState.radius = savedRadius;
      viewBtn.html("FRONT VIEW");
    }
    camState.dragging = false;
  }

  /* ---------------------- INTERACTION-MODE TOGGLE ------------------------ */
  function toggleSelectMode(): void {
    selectMode = !selectMode;
    camState.dragging = false;
    pendingFishClick = null;

    if (selectMode) {
      modeBtn.html("FISH CLICK: ON");
      modeBtn.style("color", "#7fd4ff");
      modeBtn.style("border-color", "#2a6a99");
      modeBtn.style("background", "rgba(10, 34, 51, 0.85)");
    } else {
      modeBtn.html("FISH CLICK: OFF");
      modeBtn.style("color", "#8a8a8a");
      modeBtn.style("border-color", "#3a4a5a");
      modeBtn.style("background", "rgba(10, 34, 51, 0.55)");
    }
  }

  /* -------------------------------- DRAW ---------------------------------- */
  p.draw = () => {
    p.background(3, 14, 24);
    const dt = Math.min(p.deltaTime, 50) * 0.001;
    t += dt;

    common.updateCamera(camState, frontView, frontZoom);

    p.push();
    p.noStroke();
    p.texture(skyImg);
    p.sphere(2600, 16, 12);
    p.pop();

    p.push();
    p.translate(0, TANK_OFFSET_Y, 0); // p5 WEBGL: +y is down

    common.drawFloor(TANK.w, TANK.d, TANK.floorY, sandImg);
    common.drawCaustics(t, TANK.w, TANK.d, TANK.floorY);
    common.drawRocks(rocks, TANK.floorY);
    drawAllKelp();
    drawAllFish();
    common.drawAllBubbles(
      bubbles,
      bubbleImg,
      camState,
      t,
      dt,
      TANK.w,
      TANK.d,
      TANK.floorY,
      TANK.topY,
    );
    common.drawGlass(TANK.w, TANK.h, TANK.d);

    p.pop();
  };

  /* -------------------------------- KELP ---------------------------------- */
  function makeKelp(x: number, z: number): Kelp {
    const segs = 14;
    const h = p.random(180, 330);
    const colA = p.color(96, 58, 12);
    const colB = p.color(255, 196, 62);
    return {
      x,
      z,
      segs,
      segLen: h / segs,
      width0: p.random(16, 26),
      phase: p.random(p.TWO_PI),
      speed: p.random(0.55, 1.05),
      sway: p.random(0.22, 0.42),
      dir: p.random(p.TWO_PI),
      colA,
      colB,
      colGradient: Array.from({ length: segs }, (_, i) =>
        p.lerpColor(colA, colB, Math.pow(i / segs, 0.65)),
      ),
      tip: null,
    };
  }

  function drawAllKelp(): void {
    p.noStroke();
    for (const k of kelps) {
      common.drawKelp(k, camState.right, t, TANK.floorY);

      if (k.tip && bubbles.length < 90 && p.random() < 0.008) {
        bubbles.push({
          pos: p.createVector(
            k.tip.x + p.random(-8, 8),
            k.tip.y + p.random(-6, 2),
            k.tip.z + p.random(-8, 8),
          ),
          size: p.random(3.5, 9),
          speed: p.random(26, 58),
          phase: p.random(p.TWO_PI),
          wob: p.random(6, 20),
          life: 0,
        });
      }
    }
  }

  /* -------------------------------- FISH ---------------------------------- */
  function drawAllFish(): void {
    const fishStep = Math.min(p.deltaTime / 16.6667, 2.5);

    for (const f of fishes) {
      const nz = p.noise(f.phase, t * 0.06);
      const targetAng = nz * p.TWO_PI * 2.2;
      const desired = p
        .createVector(Math.cos(targetAng), 0, Math.sin(targetAng))
        .mult(f.speed);
      desired.y = Math.sin(t * 0.8 + f.bob) * 0.4 + (f.baseY - f.pos.y) * 0.015;

      const mx = TANK.w * 0.5 - 90,
        mz = TANK.d * 0.5 - 90,
        my = 160;
      if (f.pos.x > mx) desired.x -= (f.pos.x - mx) * 0.1;
      if (f.pos.x < -mx) desired.x += (-mx - f.pos.x) * 0.1;
      if (f.pos.z > mz) desired.z -= (f.pos.z - mz) * 0.1;
      if (f.pos.z < -mz) desired.z += (-mz - f.pos.z) * 0.1;
      if (f.pos.y > my) desired.y -= (f.pos.y - my) * 0.1;
      if (f.pos.y < -my) desired.y += (-my - f.pos.y) * 0.1;

      f.vel.lerp(desired, 0.04 * fishStep);
      const sp = f.vel.mag();
      if (sp > f.speed * 1.5) f.vel.mult((f.speed * 1.5) / sp);
      if (sp < 0.35) f.vel.mult(1.6);

      f.pos.add(f.vel.copy().mult(fishStep));
    }

    const sorted = [...fishes].sort((a, b) => {
      const da =
        (camState.x - a.pos.x) ** 2 +
        (camState.y - a.pos.y) ** 2 +
        (camState.z - a.pos.z) ** 2;
      const db =
        (camState.x - b.pos.x) ** 2 +
        (camState.y - b.pos.y) ** 2 +
        (camState.z - b.pos.z) ** 2;
      return db - da;
    });

    for (const f of sorted) {
      const start = petAnim.get(f);
      const age = start === undefined ? Infinity : t - start;

      if (age >= PET_DURATION) {
        common.drawFish(f, camState, frontView, t);
        continue;
      }

      const k = age / PET_DURATION; // 0 -> 1
      const decay = 1 - k;
      const hop = Math.abs(Math.sin(k * Math.PI * 3)) * 28 * decay; // 3 little hops
      const sy = 1 + Math.sin(k * Math.PI * 6) * 0.14 * decay; // squash/stretch
      const sxz = 1 / Math.sqrt(sy);

      const origY = f.pos.y;
      f.pos.y = origY - hop; // negative y = up in p5 WEBGL

      p.push();
      p.translate(f.pos.x, f.pos.y, f.pos.z);
      p.scale(sxz, sy, sxz);
      p.translate(-f.pos.x, -f.pos.y, -f.pos.z);
      common.drawFish(f, camState, frontView, t);
      p.pop();

      f.pos.y = origY;
    }
  }

  /* ======================================================================
     FISH PETTING — uses common.projectToScreen instead of p5.screenPosition
     (screenPosition is unreliable across p5 builds and returns NaN/garbage
     in WEBGL once the camera has been driven by updateCamera()).
     ====================================================================== */

  function findClickedFish(mx: number, my: number): Fish | null {
    let best: Fish | null = null;
    let bestDist = Infinity;

    for (const f of fishes) {
      const screen = common.projectToScreen(
        camState,
        frontView,
        frontZoom,
        f.pos.x,
        f.pos.y + TANK_OFFSET_Y,
        f.pos.z,
      );
      if (!screen || !isFinite(screen.x) || !isFinite(screen.y)) continue;

      const dx = mx - screen.x;
      const dy = my - screen.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Approximate on-screen radius by projecting the fish's right edge.
      let threshold = 32;
      const edge = common.projectToScreen(
        camState,
        frontView,
        frontZoom,
        f.pos.x + f.size * 0.5,
        f.pos.y + TANK_OFFSET_Y,
        f.pos.z,
      );
      if (edge && isFinite(edge.x) && isFinite(edge.y)) {
        const ex = edge.x - screen.x;
        const ey = edge.y - screen.y;
        const sizePx = Math.sqrt(ex * ex + ey * ey);
        if (sizePx > 0) {
          threshold = Math.max(20, sizePx * 1.1);
        }
      }

      if (dist < threshold && dist < bestDist) {
        bestDist = dist;
        best = f;
      }
    }
    return best;
  }

  function getAudioCtx(): AudioContext | null {
    try {
      if (!audioCtx) {
        const AC: typeof AudioContext | undefined =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
      }
      const ctx = audioCtx;
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }

  function playCuteSound(kind: "chime" | "pop" | "boop" | "trill"): void {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (kind === "chime") {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        const t0 = now + i * 0.08;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.12, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
        o.connect(g).connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + 0.4);
      });
      return;
    }

    if (kind === "pop") {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(820, now);
      o.frequency.exponentialRampToValueAtTime(1240, now + 0.1);
      g.gain.setValueAtTime(0.15, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(now);
      o.stop(now + 0.2);
      return;
    }

    if (kind === "boop") {
      [400, 600].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "triangle";
        o.frequency.value = f;
        const t0 = now + i * 0.1;
        g.gain.setValueAtTime(0.12, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
        o.connect(g).connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + 0.26);
      });
      return;
    }

    [660, 880, 990, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t0 = now + i * 0.05;
      g.gain.setValueAtTime(0.09, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.2);
    });
  }

  /* ======================================================================
     PETTING PARTICLES — drawn on a 2D overlay canvas (no emojis)
     hearts, sparkles, bubbles, sprinkles
     ====================================================================== */

  function rand(a: number, b: number): number {
    return a + Math.random() * (b - a);
  }
  function pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function resizeFx(): void {
    if (!fxCanvas) return;
    const { w, h } = containerSize();
    fxDpr = Math.min(window.devicePixelRatio || 1, 2);
    fxCanvas.width = Math.round(w * fxDpr);
    fxCanvas.height = Math.round(h * fxDpr);
    fxCanvas.style.width = `${w}px`;
    fxCanvas.style.height = `${h}px`;
  }

  function ensureFxCanvas(): void {
    const host = (p as any)._userNode as HTMLElement | undefined;
    if (!host) return;
    if (!fxCanvas) {
      fxCanvas = document.createElement("canvas");
      fxCanvas.style.cssText =
        "position:absolute;left:0;top:0;pointer-events:none;z-index:60;";
      host.appendChild(fxCanvas);
      fxCtx = fxCanvas.getContext("2d");
    }
    resizeFx();
  }

  function removeFx(): void {
    if (fxRaf) cancelAnimationFrame(fxRaf);
    fxRaf = 0;
    particles.length = 0;
    if (fxCanvas) {
      fxCanvas.remove();
      fxCanvas = null;
      fxCtx = null;
    }
  }

  function easeOutBack(x: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  function drawParticle(c: CanvasRenderingContext2D, pt: Particle): void {
    const k = pt.age / pt.life;
    const fadeIn = Math.min(1, pt.age / 0.12);
    const fadeOut = Math.min(1, (1 - k) / 0.35);
    const alpha = Math.max(0, Math.min(fadeIn, fadeOut));
    let s = pt.size;

    c.save();
    c.translate(pt.x, pt.y);
    c.rotate(pt.rot);
    c.globalAlpha = alpha;

    if (pt.kind === "heart") {
      s *= easeOutBack(Math.min(1, pt.age / 0.25));
      c.fillStyle = pt.color;
      c.shadowColor = pt.color;
      c.shadowBlur = 10;
      c.beginPath();
      c.moveTo(0, s * 0.35);
      c.bezierCurveTo(-s, -s * 0.15, -s * 0.55, -s * 0.95, 0, -s * 0.4);
      c.bezierCurveTo(s * 0.55, -s * 0.95, s, -s * 0.15, 0, s * 0.35);
      c.closePath();
      c.fill();
    } else if (pt.kind === "sparkle") {
      // 4-point twinkling star with additive glow
      s *= 0.6 + 0.4 * Math.abs(Math.sin(pt.age * 10 + pt.phase));
      c.globalCompositeOperation = "lighter";
      c.fillStyle = pt.color;
      c.shadowColor = pt.color;
      c.shadowBlur = 12;
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? s : s * 0.22;
        const a = (i * Math.PI) / 4 - Math.PI / 2;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
      c.fill();
    } else if (pt.kind === "bubble") {
      const g = c.createRadialGradient(-s * 0.3, -s * 0.3, s * 0.1, 0, 0, s);
      g.addColorStop(0, "rgba(255,255,255,0.55)");
      g.addColorStop(0.7, "rgba(160,225,255,0.12)");
      g.addColorStop(1, "rgba(160,225,255,0.35)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, s, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "rgba(200,240,255,0.7)";
      c.lineWidth = 1;
      c.stroke();
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.beginPath();
      c.arc(-s * 0.35, -s * 0.35, s * 0.18, 0, Math.PI * 2);
      c.fill();
    } else {
      // sprinkle: little rounded confetti stick
      c.strokeStyle = pt.color;
      c.lineWidth = s * 0.5;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(-s, 0);
      c.lineTo(s, 0);
      c.stroke();
    }
    c.restore();
  }

  function fxTick(now: number): void {
    fxRaf = 0;
    if (!fxCanvas || !fxCtx) return;
    const dt = Math.min(0.05, (now - fxLast) / 1000);
    fxLast = now;

    const c = fxCtx;
    c.setTransform(fxDpr, 0, 0, fxDpr, 0, 0);
    c.clearRect(0, 0, fxCanvas.width / fxDpr, fxCanvas.height / fxDpr);

    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      if (pt.delay > 0) {
        pt.delay -= dt;
        continue;
      }
      pt.age += dt;
      if (pt.age >= pt.life) {
        particles.splice(i, 1);
        continue;
      }
      const d = Math.exp(-pt.drag * dt);
      pt.vx *= d;
      pt.vy *= d;
      pt.vy += pt.gravity * dt;
      pt.x += (pt.vx + Math.sin(pt.age * pt.wobSpeed + pt.phase) * pt.wob) * dt;
      pt.y += pt.vy * dt;
      pt.rot += pt.vrot * dt;
    }

    for (const pt of particles) if (pt.delay <= 0) drawParticle(c, pt);

    if (particles.length) fxRaf = requestAnimationFrame(fxTick);
  }

  function burstAt(x: number, y: number): void {
    ensureFxCanvas();
    if (!fxCtx) return;

    const mk = (kind: FxKind, o: Partial<Particle>): void => {
      particles.push({
        kind,
        x,
        y,
        vx: 0,
        vy: 0,
        gravity: 0,
        drag: 0,
        wob: 0,
        wobSpeed: 0,
        phase: Math.random() * Math.PI * 2,
        age: 0,
        life: 1,
        delay: 0,
        size: 8,
        rot: 0,
        vrot: 0,
        color: "#fff",
        ...o,
      });
    };

    const effect = pick([
      "hearts",
      "sparkles",
      "sprinkles",
      "bubbles",
    ] as const);

    if (effect === "hearts") {
      // hearts: pop in, then drift upward with a gentle sway
      for (let i = 0; i < 8; i++) {
        mk("heart", {
          x: x + rand(-18, 18),
          y: y + rand(-12, 4),
          vx: rand(-20, 20),
          vy: rand(-120, -70),
          drag: 0.6,
          wob: rand(25, 45),
          wobSpeed: rand(3, 5),
          life: rand(1.3, 1.9),
          size: rand(7, 13),
          rot: rand(-0.4, 0.4),
          vrot: rand(-0.5, 0.5),
          delay: i * 0.07,
          color: pick(HEART_COLORS),
        });
      }
    } else if (effect === "sparkles") {
      // sparkles: fast radial burst that slows quickly and twinkles
      for (let i = 0; i < 16; i++) {
        const a = rand(0, Math.PI * 2);
        const sp = rand(70, 200);
        mk("sparkle", {
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 20,
          drag: 3.2,
          life: rand(0.5, 1.0),
          size: rand(5, 11),
          vrot: rand(-3, 3),
          color: pick(SPARKLE_COLORS),
        });
      }
    } else if (effect === "sprinkles") {
      // sprinkles: confetti pop with gravity
      for (let i = 0; i < 22; i++) {
        const a = rand(-Math.PI * 0.9, -Math.PI * 0.1);
        const sp = rand(120, 280);
        mk("sprinkle", {
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          gravity: 420,
          drag: 0.8,
          life: rand(0.8, 1.3),
          size: rand(3, 5),
          rot: rand(0, Math.PI * 2),
          vrot: rand(-12, 12),
          color: pick(SPRINKLE_COLORS),
        });
      }
    } else {
      // bubbles: slow rise with wobble
      for (let i = 0; i < 12; i++) {
        mk("bubble", {
          x: x + rand(-26, 26),
          y: y + rand(-6, 10),
          vx: rand(-12, 12),
          vy: rand(-80, -30),
          drag: 0.3,
          wob: rand(15, 30),
          wobSpeed: rand(3, 6),
          life: rand(1.2, 2.0),
          size: rand(3, 9),
          delay: rand(0, 0.3),
        });
      }
    }

    if (!fxRaf) {
      fxLast = performance.now();
      fxRaf = requestAnimationFrame(fxTick);
    }
  }

  function reactToFish(f: Fish): void {
    const screen = common.projectToScreen(
      camState,
      frontView,
      frontZoom,
      f.pos.x,
      f.pos.y + +TANK_OFFSET_Y,
      f.pos.z,
    );
    if (!screen || !isFinite(screen.x) || !isFinite(screen.y)) return;

    burstAt(screen.x, screen.y);
    playCuteSound(pick(PET_SOUNDS));
    petAnim.set(f, t);

    f.vel.x += (Math.random() - 0.5) * 4;
    f.vel.y -= 1.5;
    f.vel.z += (Math.random() - 0.5) * 4;
  }

  /* ------------------------------ INPUT ----------------------------------- */

  p.mousePressed = () => {
    if (!isInsideCanvas(p)) return;

    mouseDownX = p.mouseX;
    mouseDownY = p.mouseY;

    // FISH CLICK mode: only hit-test fish — never start a camera drag.
    if (selectMode) {
      const clicked = findClickedFish(p.mouseX, p.mouseY);
      if (clicked) pendingFishClick = clicked;
      return;
    }

    // ROTATE mode: only camera drag — never hit-test fish.
    if (frontView) return;
    camState.dragging = true;
    camState.idleTime = 0;
  };

  p.mouseDragged = () => {
    if (!camState.dragging || frontView) return;
    camState.theta -= (p.mouseX - (p.pmouseX || p.mouseX)) * 0.006;
    camState.phi = p.constrain(
      camState.phi - (p.mouseY - (p.pmouseY || p.mouseY)) * 0.004,
      -0.35,
      1.15,
    );
    camState.idleTime = 0;
  };

  p.mouseReleased = () => {
    camState.dragging = false;

    if (pendingFishClick) {
      const dx = p.mouseX - mouseDownX;
      const dy = p.mouseY - mouseDownY;
      if (dx * dx + dy * dy < 25) {
        reactToFish(pendingFishClick);
      }
      pendingFishClick = null;
    }
  };

  p.mouseWheel = (event: any): boolean => {
    if (!isInsideCanvas(p)) return true;
    const mouseSign = Math.sign(event.delta);
    if (frontView) {
      frontZoom = p.constrain(frontZoom * (1 - mouseSign * 0.12), 0.4, 4);
    } else {
      camState.radius = p.constrain(
        camState.radius + mouseSign * 90,
        400,
        2600,
      );
    }
    return false;
  };

  (p as any).touchStarted = () => {
    p.mousePressed!();
  };
  (p as any).touchMoved = (): boolean => {
    p.mouseDragged!();
    return false;
  };
  (p as any).touchEnded = () => {
    p.mouseReleased!();
  };

  /* ------------------------------ RESIZE ---------------------------------- */
  function handleResize(): void {
    const { w, h } = containerSize();
    p.resizeCanvas(w, h);
    p.perspective(p.PI / 3, w / h, 10, 7000);
    // Keep the bottom-left buttons aligned with the pill on resize.
    positionBottomButtons();
    resizeFx();
  }

  p.windowResized = handleResize;
  (p as any).resizeToContainer = handleResize;

  /* -------------------- CLEANUP + GLOBAL-MODE BRIDGE --------------------- */
  (p as any).customCleanup = customCleanup;
  window.addEventListener("beforeunload", teardownRealtime);
}
