import type p5 from "p5";
import {
  getExistingEndangeredFish,
  type EndangeredFishRow,
} from "../lib/supabase";
import type { TooltipItem, ChartType } from "chart.js";
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

/* =========================================================================
   3D AQUARIUM — ENDANGERED FISH — p5.js (WEBGL) — TypeScript
   -------------------------------------------------------------------------
   • Fish are clickable. Clicking a fish dims the scene, spotlights the fish
     with an additive glow, and shows:
        - a callout (species + fun fact) hovering ABOVE the clicked fish
        - a bottom-centre chart panel with the population history. The
          panel sits on a black rectangle whose edges radiate black outward
          and fade to transparent (via layered box-shadow), and stretches to
          the full canvas width.
   • Dragging across the chart highlights the nearest data point and sets the
     spotlighted fish's opacity to (count - min) / (max - min), so lowering
     the scrubber fades the fish out — a visual read on how the population
     compares to its own historical range.
   • Clicking empty space deselects and restores the tank.
   • Chart.js is loaded globally from `Layout.tsx` (window.Chart).
   ========================================================================= */

const TANK = { w: 780, h: 460, d: 460, floorY: 230, topY: -230 };

interface EndangeredFish extends Fish {
  id: string;
  species: string;
  funFact: string;
  populationHistory: { count: number; month: string }[];
}

interface AbsDivOptions {
  parent?: HTMLElement;
  id?: string;
  width?: string;
  padding?: string;
  background?: string;
  border?: string;
  borderRadius?: string;
  zIndex?: string;
  boxShadow?: string;
}

export function sketch(p: p5): void {
  const common = createCommon(p);

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
  let dragMoved = false;

  let selectedFish: EndangeredFish | null = null;
  /**
   * Opacity applied to the spotlighted fish. Derived from the count ratio of
   * whichever chart point is currently highlighted: (count - min)/(max - min),
   * mapped into [0.15, 1] so the fish never fully disappears.
   */
  let selectedOpacity = 1;

  let calloutDiv: p5.Element;
  let chartDiv: p5.Element;

  let currentChart: any = null;
  let chartCleanup: (() => void) | null = null;

  let fallbackFishImgs: p5.Graphics[] = [];
  let glowImg: p5.Graphics;

  const fishes: EndangeredFish[] = [];
  const kelps: Kelp[] = [];
  const bubbles: Bubble[] = [];
  const rocks: Rock[] = [];

  let bubbleImg: p5.Graphics;
  let skyImg: p5.Graphics;
  let sandImg: p5.Graphics;
  let t = 0;
  let runId = 0;

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

  /* ---------------------- ABSOLUTE-DIV FACTORY --------------------------- */
  function createAbsoluteDiv(opts: AbsDivOptions): p5.Element {
    const el = p.createDiv("");
    if (opts.id) el.id(opts.id);
    if (opts.parent) el.parent(opts.parent);

    el.style("position", "absolute");
    el.style("display", "none");
    el.style("box-sizing", "border-box");
    el.style("background", opts.background ?? "rgba(10, 34, 51, 0.95)");
    el.style("color", "#fff");
    el.style("border", opts.border ?? "1px solid #2a6a99");
    el.style("border-radius", opts.borderRadius ?? "8px");
    el.style("padding", opts.padding ?? "16px");
    el.style("font-family", "var(--font-sans)");
    if (opts.width) el.style("width", opts.width);
    el.style("pointer-events", "auto");
    el.style("z-index", opts.zIndex ?? "1000");
    el.style("box-shadow", opts.boxShadow ?? "0 4px 20px rgba(0,0,0,0.5)");

    const stopEvt = (e: Event) => e.stopPropagation();
    el.elt.addEventListener("mousedown", stopEvt);
    el.elt.addEventListener("touchstart", stopEvt, { passive: true });
    el.elt.addEventListener("wheel", stopEvt, { passive: true });

    return el;
  }

  /* ------------------------- STATE RESET ---------------------------- */
  function resetState(): void {
    fishes.length = 0;
    kelps.length = 0;
    bubbles.length = 0;
    rocks.length = 0;
    fallbackFishImgs = [];
    frontView = false;
    frontZoom = 1;
    t = 0;
    camState.theta = 0.7;
    camState.phi = 0.16;
    camState.radius = 1080;
    camState.dragging = false;
    camState.idleTime = 99;
    selectMode = true;
    dragMoved = false;
    selectedOpacity = 1;
    deselect();
  }

  function destroyChart(): void {
    if (chartCleanup) {
      try {
        chartCleanup();
      } catch {
        /* ignore */
      }
      chartCleanup = null;
    }
    if (currentChart) {
      try {
        currentChart.destroy();
      } catch {
        /* ignore */
      }
      currentChart = null;
    }
  }

  function deselect(): void {
    selectedFish = null;
    selectedOpacity = 1;
    if (calloutDiv) calloutDiv.hide();
    if (chartDiv) chartDiv.hide();
    destroyChart();
  }

  function customCleanup(): void {
    runId++;
    destroyChart();
    if (calloutDiv) calloutDiv.remove();
    if (chartDiv) chartDiv.remove();
    if (modeBtn) modeBtn.remove();
    if (viewBtn) viewBtn.remove();
  }

  /* ------------------------- FISH LOADING / SPAWN ------------------------- */
  function makeFish(img: FishSprite, row?: EndangeredFishRow): EndangeredFish {
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
      id: row ? String(row.id) : `fallback-${Math.random()}`,
      species: row?.species ?? "Data Pending",
      funFact: row?.fun_fact ?? "No information available for this entry.",
      populationHistory: row?.population_history ?? [],
    };
  }

  function randomFallbackSprite(): FishSprite {
    return fallbackFishImgs[fishes.length % fallbackFishImgs.length];
  }

  /* ------------------------------- SETUP ---------------------------------- */
  p.setup = () => {
    resetState();
    runId++;

    const { w, h } = containerSize();
    p.createCanvas(w, h, p.WEBGL);
    p.perspective(p.PI / 3, w / h, 10, 7000);
    p.strokeCap(p.ROUND);

    camState.right = p.createVector(1, 0, 0);

    // --- Overlay UI -------------------------------------------------------
    const parentNode = (p as any)._userNode as HTMLElement | undefined;

    // Callout: solid, pinned above the fish.
    calloutDiv = createAbsoluteDiv({
      parent: parentNode,
      id: "fish-callout",
      width: "320px",
      background: "rgba(10, 34, 51, 0.95)",
    });

    // Chart panel: outer shell is transparent with a radial glow; the inner
    // black rectangle is created fresh per-fish (see showCallout) and is
    // what actually carries the radiating box-shadow.
    chartDiv = createAbsoluteDiv({
      parent: parentNode,
      id: "fish-chart",
      padding: "0px", // theres alr padding in the outside container
      background: "transparent",
      border: "none",
      borderRadius: "0",
      boxShadow: "none",
    });

    // --- Textures & fallbacks ---------------------------------------------
    bubbleImg = common.makeBubbleSprite();
    skyImg = common.makeSkyTexture();
    sandImg = common.makeSandTexture();
    glowImg = common.makeGlowSprite();

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

    void loadExistingFish(runId);

    for (let i = 0; i < 12; i++) {
      kelps.push(
        makeWiltedKelp(
          p.random(-TANK.w * 0.44, TANK.w * 0.44),
          p.random(-TANK.d * 0.44, TANK.d * 0.44),
        ),
      );
    }
    for (let i = 0; i < 7; i++) {
      rocks.push({
        x: p.random(-TANK.w * 0.42, TANK.w * 0.42),
        z: p.random(-TANK.d * 0.42, TANK.d * 0.42),
        s: p.random(15, 40),
        r: p.random(p.TWO_PI),
        c: p.random(30, 60),
      });
    }

    // --- View toggle button ----------------------------------------------
    viewBtn = p.createButton("FRONT VIEW");
    if ((p as any)._userNode) viewBtn.parent((p as any)._userNode);
    viewBtn.position(24, 24);
    viewBtn.style("padding", "10px 18px");
    viewBtn.style("background", "rgba(10, 34, 51, 0.85)");
    viewBtn.style("color", "#7fd4ff");
    viewBtn.style("border", "1px solid #2a6a99");
    viewBtn.style("border-radius", "8px");
    viewBtn.style("font-family", "var(--font-sans)");
    viewBtn.style("font-size", "13px");
    viewBtn.style("letter-spacing", "1.5px");
    viewBtn.style("cursor", "pointer");
    viewBtn.style("outline", "none");
    viewBtn.mousePressed(toggleView);

    // --- Interaction-mode toggle -----------------------------------------
    modeBtn = p.createButton("FISH CLICK: ON");
    if ((p as any)._userNode) modeBtn.parent((p as any)._userNode);
    modeBtn.position(170, 24);
    modeBtn.style("padding", "10px 18px");
    modeBtn.style("background", "rgba(10, 34, 51, 0.85)");
    modeBtn.style("color", "#7fd4ff");
    modeBtn.style("border", "1px solid #2a6a99");
    modeBtn.style("border-radius", "8px");
    modeBtn.style("font-family", "var(--font-sans)");
    modeBtn.style("font-size", "13px");
    modeBtn.style("letter-spacing", "1.5px");
    modeBtn.style("cursor", "pointer");
    modeBtn.style("outline", "none");
    modeBtn.mousePressed(toggleSelectMode);

    requestAnimationFrame(() => {
      try {
        const w = (viewBtn.elt as HTMLElement).offsetWidth || 130;
        modeBtn.position(24 + w + 12, 24);
      } catch {
        /* keep fallback position */
      }
    });
  };

  function makeWiltedKelp(x: number, z: number): Kelp {
    const segs = 10;
    const h = p.random(60, 120);
    const colA = p.color(96, 58, 12);
    const colB = p.color(255, 196, 62);
    return {
      x,
      z,
      segs,
      segLen: h / segs,
      width0: p.random(8, 16),
      phase: p.random(p.TWO_PI),
      speed: p.random(0.3, 0.6),
      sway: p.random(0.1, 0.2),
      dir: p.random(p.TWO_PI),
      colA: p.color(60, 50, 20),
      colB: p.color(140, 110, 40),
      colGradient: Array.from({ length: segs }, (_, i) =>
        p.lerpColor(colA, colB, Math.pow(i / segs, 0.65)),
      ),
      tip: null,
    };
  }

  async function loadExistingFish(run: number): Promise<void> {
    let rows: EndangeredFishRow[] = [];
    try {
      rows = (await getExistingEndangeredFish()) ?? [];
    } catch (err) {
      console.warn("[aquarium] getExistingEndangeredFish failed:", err);
    }
    if (run !== runId) return;

    const loads = rows.map(
      (row) =>
        new Promise<void>((resolve) => {
          if (!row.image_url) {
            fishes.push(makeFish(randomFallbackSprite(), row));
            resolve();
            return;
          }
          p.loadImage(
            row.image_url,
            (img) => {
              if (run === runId) fishes.push(makeFish(img, row));
              resolve();
            },
            () => {
              if (run === runId) {
                console.warn("[aquarium] fish image failed:", row.image_url);
                fishes.push(makeFish(randomFallbackSprite(), row));
              }
              resolve();
            },
          );
        }),
    );
    await Promise.all(loads);
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

  function toggleSelectMode(): void {
    selectMode = !selectMode;
    camState.dragging = false;
    dragMoved = false;

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

    if (selectedFish) camState.idleTime = 0;

    common.updateCamera(camState, frontView, frontZoom);

    // Water dome
    p.push();
    p.noStroke();
    p.texture(skyImg);
    p.sphere(2600, 16, 12);
    p.pop();

    // Scene
    common.drawFloor(TANK.w, TANK.d, TANK.floorY, sandImg);
    common.drawCaustics(t, TANK.w, TANK.d, TANK.floorY);
    common.drawRocks(rocks, TANK.floorY);

    p.noStroke();
    for (const k of kelps) {
      common.drawKelp(k, camState.right, t, TANK.floorY, 0.1);
    }

    updateFishMovement(dt);

    const sortedFishes = [...fishes].sort((a, b) => {
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
    for (const f of sortedFishes) {
      if (selectedFish && f.id === selectedFish.id) continue;
      common.drawFish(f, camState, frontView, t);
    }

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

    /* --- Spotlight / Selection ------------------------------------------- */
    if (selectedFish) {
      // 1. Dim the scene in screen space.
      p.push();
      p.resetMatrix();
      p.ortho(0, p.width, 0, p.height, -1, 1);
      p.noStroke();
      p.fill(0, 0, 0, 180);
      p.rect(0, 0, p.width, p.height);
      p.pop();

      // 2. Restore camera, clear depth so the fish paints on top.
      common.updateCamera(camState, frontView, frontZoom, false);
      const gl = p.drawingContext as WebGL2RenderingContext;
      gl.clear(gl.DEPTH_BUFFER_BIT);

      // 3. Glow behind the fish.
      common.drawSpotlightGlow(selectedFish, camState, frontView, glowImg);

      // 4. Spotlighted fish, opacity driven by the chart scrubber.
      //    NOTE: if common.drawFish() calls noTint() internally, remove that
      //    call or move the tint inside that function for this to take effect.
      p.tint(255, Math.round(selectedOpacity * 255));
      common.drawFish(selectedFish, camState, frontView, t, true);
      p.noTint();

      // 5. Keep the callout hovering above the fish.
      updateCalloutPosition();
    }
  };

  /* ------------------------------ FISH MOTION ---------------------------- */
  function updateFishMovement(dt: number): void {
    const fishStep = Math.min(dt * 60, 2.5);
    for (const f of fishes) {
      if (selectedFish && f.id === selectedFish.id) continue;

      const nz = p.noise(f.phase, t * 0.06);
      const targetAng = nz * p.TWO_PI * 2.2;
      const desired = p
        .createVector(Math.cos(targetAng), 0, Math.sin(targetAng))
        .mult(f.speed);
      desired.y = Math.sin(t * 0.8 + f.bob) * 0.4 + (f.baseY - f.pos.y) * 0.015;

      const mx = TANK.w * 0.5 - 90;
      const mz = TANK.d * 0.5 - 90;
      const my = 160;
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
  }

  /* ---------------------- HIT-TEST HELPERS ------------------------------- */
  function projectedScreenRadius(f: EndangeredFish): number {
    const center = common.projectToScreen(
      camState,
      frontView,
      frontZoom,
      f.pos.x,
      f.pos.y,
      f.pos.z,
    );
    if (!center || !isFinite(center.x) || !isFinite(center.y)) return 0;

    const half = f.size * 0.5;
    let maxD = 0;
    for (const [ox, oy, oz] of [
      [half, 0, 0],
      [0, half, 0],
      [0, 0, half],
    ] as const) {
      const s = common.projectToScreen(
        camState,
        frontView,
        frontZoom,
        f.pos.x + ox,
        f.pos.y + oy,
        f.pos.z + oz,
      );
      if (!s || !isFinite(s.x) || !isFinite(s.y)) continue;
      const d = Math.hypot(s.x - center.x, s.y - center.y);
      if (d > maxD) maxD = d;
    }
    return Math.max(maxD * 1.5, 30);
  }

  function isOverOverlay(): boolean {
    const canvasEl = (p as any).canvas as HTMLCanvasElement | undefined;
    if (!canvasEl) return false;
    const cr = canvasEl.getBoundingClientRect();
    const cx = cr.left + p.mouseX;
    const cy = cr.top + p.mouseY;
    for (const d of [calloutDiv, chartDiv]) {
      if (!d || d.elt.style.display === "none") continue;
      const r = d.elt.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
        return true;
      }
    }
    return false;
  }

  /* ------------------------------ INPUT ----------------------------------- */
  p.mousePressed = () => {
    if (isOverOverlay()) return;
    if (!isInsideCanvas(p)) {
      if (selectedFish) deselect();
      return;
    }

    if (selectMode) {
      type Info = { fish: EndangeredFish; d: number; r: number; score: number };
      const infos: Info[] = [];
      for (const f of fishes) {
        const sp = common.projectToScreen(
          camState,
          frontView,
          frontZoom,
          f.pos.x,
          f.pos.y,
          f.pos.z,
        );
        if (!sp || !isFinite(sp.x) || !isFinite(sp.y)) continue;
        const r = projectedScreenRadius(f);
        if (r <= 0) continue;
        const d = p.dist(p.mouseX, p.mouseY, sp.x, sp.y);
        infos.push({ fish: f, d, r, score: d / r });
      }

      const inside = infos
        .filter((i) => i.score <= 1)
        .sort((a, b) => a.score - b.score || b.r - a.r);
      let clickedFish: EndangeredFish | null = inside[0]?.fish ?? null;

      if (!clickedFish) {
        const nearest = infos
          .map((i) => ({ ...i, gap: i.d - i.r }))
          .filter((i) => i.gap <= 45)
          .sort((a, b) => a.gap - b.gap)[0];
        if (nearest) clickedFish = nearest.fish;
      }

      if (clickedFish) {
        selectedFish = clickedFish;
        showCallout(clickedFish);
        return;
      }

      if (selectedFish) deselect();
      return;
    }

    dragMoved = false;
    if (frontView) return;
    camState.dragging = true;
    camState.idleTime = 0;
  };

  /* ------------------------------ CALLOUT -------------------------------- */
  function showCallout(f: EndangeredFish): void {
    destroyChart();
    if (!selectedFish || selectedFish.id !== f.id) return;

    /* ---------- 1. Callout: name + fun fact (above the fish) ---------- */
    calloutDiv.html(`
      <h2 style="margin:0 0 8px 0;color:#7fd4ff;font-size:17px;">${f.species}</h2>
      <p style="margin:0 0 8px 0;font-size:12px;line-height:1.45;color:#cfd;">
        <strong>Fun Fact:</strong> ${f.funFact}
      </p>
      <p style="margin:0;font-size:12px;line-height:1.45;color:#cfd;">
        <strong>Why should you care:</strong> ${f.funFact}
      </p>
           <div
        data-close-btn="1"
        style="
          margin-top:12px;font-size:11px;color:#7a8a99;
          text-align:center;cursor:pointer;
        "
      >Click outside to close</div>
    `);
    calloutDiv.show();
    updateCalloutPosition();

    /* ---------- 2. Chart panel: outer shell + inner black card -------- */
    const chartCanvasId = `fish-chart-${f.id.replace(/[^a-z0-9]/gi, "")}`;

    // Inner card: solid black rectangle. The layered box-shadow is what
    // makes the black "radiate out to outside the rectangle" and fade to
    // transparent. 0.98/0.6/0.35/0.15 alphas layer a progressive fade.
    chartDiv.html(`
      <div
        id="fish-chart-inner"
        style="
          position: relative;
          font-family: var(--font-sans);
          background: rgba(0, 0, 0, 0.98);
          border-radius: 12px;
          padding: 10px;
          box-shadow:
            0 0 18px 6px rgba(0, 0, 0, 0.98),
            0 0 42px 14px rgba(0, 0, 0, 0.55),
            0 0 80px 24px rgba(0, 0, 0, 0.22);
        "
      >
         <h2 style="margin:0 0 8px 0;color:#7fd4ff;font-size:17px;">Sightings — ${f.species}</h2>
        <div style="position:relative;width:100%;height:220px;">
          <canvas id="${chartCanvasId}"></canvas>
        </div>
      </div>
 
    `);
    chartDiv.show();
    positionChartDiv();
    wireCloseButton();

    /* ---------- 3. Chart.js setup ------------------------------------- */
    const canvas = document.getElementById(
      chartCanvasId,
    ) as HTMLCanvasElement | null;
    const ChartCtor = (window as any).Chart;
    ChartCtor.defaults.font.family = "var(--font-sans)";
    if (!canvas) return;

    if (!ChartCtor) {
      showChartMessage("Chart unavailable");
      return;
    }

    const hist = f.populationHistory;
    if (hist.length === 0) {
      showChartMessage("No population data available");
      return;
    }

    const labels = hist.map((d) => d.month);
    const counts = hist.map((d) => d.count);
    const last = hist.length - 1;

    // Ratio helpers used by both the highlight styles and the fish opacity.
    const minC = Math.min(...counts);
    const maxC = Math.max(...counts);
    const range = maxC - minC || 1;
    const ratioFor = (idx: number) => (counts[idx] - minC) / range;
    const ratioToOpacity = (r: number) =>
      0.15 + 0.85 * Math.max(0, Math.min(1, r));

    // Seed the fish opacity from the initially-highlighted (last) point.
    selectedOpacity = ratioToOpacity(ratioFor(last));

    const pointStyles = (idx: number) => ({
      pointRadius: counts.map((_, i) => (i === idx ? 6 : 2.5)),
      pointBackgroundColor: counts.map((_, i) =>
        i === idx ? "##8aa" : "#4a7a99",
      ),
      pointBorderColor: counts.map((_, i) =>
        i === idx ? "#ffffff" : "rgba(0,0,0,0)",
      ),
      pointBorderWidth: counts.map((_, i) => (i === idx ? 2 : 0)),
    });

    const initial = pointStyles(last);
    let highlighted = last;
    let dragging = false;

    /* ---------- plugin: baseline line, current line, %change --- */
    const scrubberDeltaPlugin = {
      id: "scrubberDelta",
      afterDatasetsDraw(chart: any) {
        const idx = highlighted;
        if (idx < 0 || idx >= counts.length) return;

        const { ctx, chartArea, scales } = chart;
        if (!ctx || !chartArea) return;

        const yFirstRaw = scales.y.getPixelForValue(counts[0]);
        const yCurRaw = scales.y.getPixelForValue(counts[idx]);
        if (!isFinite(yFirstRaw) || !isFinite(yCurRaw)) return;

        const clampY = (v: number) =>
          Math.max(chartArea.top, Math.min(chartArea.bottom, v));
        const yFirst = clampY(yFirstRaw);
        const yCur = clampY(yCurRaw);

        const base = counts[0];
        const diff = counts[idx] - base;
        const up = diff >= 0;
        const accent = up ? "#4ade80" : "#f87171";
        const accentSoft = up
          ? "rgba(74, 222, 128, 0.85)"
          : "rgba(248, 113, 113, 0.85)";

        ctx.save();

        /* 1. dashed reference line at the FIRST point's value */
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(127, 212, 255, 0.55)";
        ctx.moveTo(chartArea.left, yFirst);
        ctx.lineTo(chartArea.right, yFirst);
        ctx.stroke();

        /* 2. solid line at the CURRENT (highlighted) point's value */
        ctx.beginPath();
        ctx.setLineDash([]);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = accentSoft;
        ctx.moveTo(chartArea.left, yCur);
        ctx.lineTo(chartArea.right, yCur);
        ctx.stroke();

        /* 3. badge — centered horizontally on the highlighted point,
              floating just above that point's marker */
        let text: string;
        if (base === 0) {
          text = diff === 0 ? "▲ 0.0%" : `${up ? "▲" : "▼"} —`;
        } else {
          const pct = (diff / base) * 100;
          text = `${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`;
        }

        const fontSize = 12;
        ctx.font = `600 ${fontSize}px Poppins, ui-sans-serif, system-ui, sans-serif`;
        const padX = 8;
        const padY = 5;
        const textW = ctx.measureText(text).width;
        const boxW = Math.ceil(textW + padX * 2);
        const boxH = fontSize + padY * 2;

        // X: centred on the highlighted data point.
        let xCur: number;
        try {
          xCur = scales.x.getPixelForValue(idx);
        } catch {
          const sc = scales.x;
          xCur = sc.left + ((idx + 0.5) / labels.length) * sc.width;
        }

        // Clamp so the badge can't slide outside the plot at the edges.
        const boxX = Math.max(
          chartArea.left + 2,
          Math.min(chartArea.right - boxW - 2, xCur - boxW / 2),
        );

        // gap between label and point
        const markerGap = 14;

        // Clamp to the canvas (so the badge may float into the reserved
        // top padding) instead of chartArea.top, which used to shove the
        // badge downwards whenever the point was near the top.
        const boxY = Math.max(
          2,
          Math.min(chart.height - boxH - 2, yCur - boxH - markerGap),
        );
        console.log(boxY);
        roundRectPath(ctx, boxX, boxY, boxW, boxH, 6);
        ctx.fillStyle = up
          ? "rgba(12, 46, 26, 0.95)"
          : "rgba(56, 16, 16, 0.95)";
        ctx.fill();
        ctx.strokeStyle = accentSoft;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = accent;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(text, boxX + padX, boxY + boxH / 2 + 0.5);

        ctx.restore();
      },
    };

    function roundRectPath(
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
      r: number,
    ): void {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }

    currentChart = new ChartCtor(canvas, {
      type: "line",
      plugins: [scrubberDeltaPlugin],
      data: {
        labels,
        datasets: [
          {
            label: "Sightings",
            data: counts,
            borderColor: "#4a7a99",
            backgroundColor: "rgba(127, 212, 255, 0.12)",
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: initial.pointRadius,
            pointBackgroundColor: initial.pointBackgroundColor,
            pointBorderColor: initial.pointBorderColor,
            pointBorderWidth: initial.pointBorderWidth,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false, // required: the wrapper div is a fixed 160px
        animation: false,
        events: [], // we handle input ourselves; avoids hover/tooltip conflicts
        font: { family: "'Poppins', sans-serif" },
        layout: {
          padding: { top: 34 },
        },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
        scales: {
          x: {
            ticks: { color: "#7a8a99", maxRotation: 0, autoSkip: true },
            grid: { color: "rgba(255,255,255,0.05)" },
          },
          y: {
            ticks: { display: false },
          },
        },
      },
    });

    /* ------------------ draggable chart (highlight scrubber) ----------- */
    const applyHighlight = (idx: number, doLog: boolean) => {
      if (!currentChart) return;
      highlighted = idx;
      const ds = currentChart.data.datasets[0];
      const s = pointStyles(idx);
      ds.pointRadius = s.pointRadius;
      ds.pointBackgroundColor = s.pointBackgroundColor;
      ds.pointBorderColor = s.pointBorderColor;
      ds.pointBorderWidth = s.pointBorderWidth;
      currentChart.update("none");

      // Feed the scrubber back into the fish's opacity.
      selectedOpacity = ratioToOpacity(ratioFor(idx));

      if (doLog) {
        // eslint-disable-next-line no-console
        console.log(
          `[aquarium] ${f.species} — ${labels[idx]}: ${counts[idx]} ` +
            `(opacity ${selectedOpacity.toFixed(2)})`,
        );
      }
    };

    const nearestIndex = (ev: MouseEvent | TouchEvent): number => {
      if (!currentChart) return -1;
      const rect = canvas.getBoundingClientRect();
      let clientX: number;
      if ("touches" in ev) {
        if (ev.touches.length === 0) return highlighted;
        clientX = ev.touches[0].clientX;
      } else {
        clientX = ev.clientX;
      }
      const scaleX = (currentChart.width || canvas.width) / rect.width || 1;
      const x = (clientX - rect.left) * scaleX;

      let best = highlighted;
      let bestD = Infinity;
      for (let i = 0; i < labels.length; i++) {
        let px: number;
        try {
          px = currentChart.scales.x.getPixelForTick(i);
        } catch {
          const sc = currentChart.scales.x;
          px = sc.left + ((i + 0.5) / labels.length) * sc.width;
        }
        const d = Math.abs(px - x);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };

    const onDown = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
      dragging = true;
      const idx = nearestIndex(ev as MouseEvent | TouchEvent);
      if (idx >= 0) applyHighlight(idx, true);
    };

    const onMove = (ev: Event) => {
      if (!dragging) return;
      ev.stopPropagation();
      ev.preventDefault();
      const idx = nearestIndex(ev as MouseEvent | TouchEvent);
      if (idx >= 0 && idx !== highlighted) applyHighlight(idx, true);
    };

    const onUp = (ev: Event) => {
      if (!dragging) return;
      dragging = false;
      ev.stopPropagation();
    };

    canvas.style.cursor = "ew-resize";
    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("touchstart", onDown as EventListener, {
      passive: false,
    });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove as EventListener, {
      passive: false,
    });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    window.addEventListener("touchcancel", onUp);

    chartCleanup = () => {
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("touchstart", onDown as EventListener);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove as EventListener);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onUp);
    };
  }

  function wireCloseButton(): void {
    const closer = chartDiv.elt.querySelector(
      "[data-close-btn]",
    ) as HTMLElement | null;
    if (!closer) return;
    closer.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      deselect();
    });
  }

  function showChartMessage(msg: string): void {
    chartDiv.html(`
      <div style="
        position:relative;
        background:rgba(0,0,0,0.98);
        border-radius:12px;
        padding:10px 14px;
        box-shadow:
          0 0 18px 6px rgba(0,0,0,0.98),
          0 0 42px 14px rgba(0,0,0,0.55),
          0 0 80px 24px rgba(0,0,0,0.22);
      ">
        <div style="font-size:11px;color:#8aa;margin:0 0 6px 4px;letter-spacing:0.5px;">
          <strong>Sightings — ${selectedFish?.species ?? ""}</strong>
        </div>
        <div style="color:#666;font-size:11px;text-align:center;padding:48px 0;">
          ${msg}
        </div>
      </div>
    `);
    positionChartDiv();
    wireCloseButton();
  }

  /** Pin the callout above the fish (never below). */
  function updateCalloutPosition(): void {
    if (!selectedFish) return;
    const sp = common.projectToScreen(
      camState,
      frontView,
      frontZoom,
      selectedFish.pos.x,
      selectedFish.pos.y,
      selectedFish.pos.z,
    );
    const rect = calloutDiv.elt.getBoundingClientRect();
    const margin = 16;

    let cx = sp.x - rect.width / 2;
    let cy = sp.y - selectedFish.size * 0.5 - rect.height - 24;

    if (cx < margin) cx = margin;
    if (cx + rect.width > p.width - margin) cx = p.width - rect.width - margin;
    if (cy < margin) cy = margin;

    calloutDiv.position(cx, cy);
  }

  /**
   * Bottom-centre, full-width chart panel. Width is `min(p.width - 80, 1400)`
   * so the panel stretches to the screen but never gets absurdly wide on
   * very large monitors. Sits 60px above the canvas floor.
   */
  function positionChartDiv(): void {
    if (!chartDiv) return;
    const w = Math.min(p.width - 80, 1400);
    chartDiv.style("width", `${w}px`);

    // Force layout so offsetHeight is accurate after the width change.
    const el = chartDiv.elt as HTMLElement;
    const h = el.offsetHeight || 260;

    const x = Math.max(0, (p.width - w) / 2);
    const y = Math.max(0, p.height - h - 60);
    chartDiv.position(x, y);
  }

  /* --------------------------- MOUSE / TOUCH ---------------------------- */
  p.mouseDragged = () => {
    if (!camState.dragging || frontView) return;
    dragMoved = true;
    camState.theta -= (p.mouseX - (p.pmouseX || p.mouseX)) * 0.006;
    camState.phi = p.constrain(
      camState.phi - (p.mouseY - (p.pmouseY || p.mouseY)) * 0.004,
      -0.35,
      1.15,
    );
    camState.idleTime = 0;
  };

  p.mouseReleased = () => {
    const wasDragging = camState.dragging;
    camState.dragging = false;
    if (!selectMode && wasDragging && !dragMoved && selectedFish) {
      deselect();
    }
    dragMoved = false;
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

  (p as any).touchStarted = () => p.mousePressed!();
  (p as any).touchMoved = (): boolean => {
    p.mouseDragged!();
    return false;
  };
  (p as any).touchEnded = () => p.mouseReleased!();

  /* ------------------------------ RESIZE ---------------------------------- */
  function handleResize(): void {
    const { w, h } = containerSize();
    p.resizeCanvas(w, h);
    p.perspective(p.PI / 3, w / h, 10, 7000);
    if (chartDiv && chartDiv.elt.style.display !== "none") positionChartDiv();
    if (calloutDiv && calloutDiv.elt.style.display !== "none") {
      updateCalloutPosition();
    }
  }

  p.windowResized = handleResize;
  (p as any).resizeToContainer = handleResize;

  (p as any).customCleanup = customCleanup;
}
