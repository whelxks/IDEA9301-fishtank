import type p5 from "p5";
import {
  getExistingEndangeredFish,
  type EndangeredFishRow,
} from "../lib/supabase";

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
   3D AQUARIUM — p5.js (WEBGL) — TypeScript
   -------------------------------------------------------------------------
   • Focuses on ENDANGERED FISH species from Supabase
     (`history_of_endangered_fish`).
   • Fish are clickable. Clicking a fish dims the scene, spotlights the fish
     with an additive glow, and shows a callout with its species, fun fact,
     and a Chart.js curve of its population history (current month highlighted).
   • Clicking empty space deselects and restores the tank.
   • Chart.js is loaded globally from `Layout.tsx` (window.Chart), not fetched
     per-sketch — see the <script> tag in the layout's <head>.
   ========================================================================= */

const TANK = { w: 780, h: 460, d: 460, floorY: 230, topY: -230 };

interface EndangeredFish extends Fish {
  id: string;
  species: string;
  funFact: string;
  populationHistory: { count: number; month: string }[];
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

  /* [NEW] Interaction mode toggle.
     selectMode = true  → presses select a fish (never drag the tank)
     selectMode = false → presses drag the tank (never select a fish)      */
  let selectMode = true;
  let modeBtn: p5.Element;

  /* [NEW] Tracks whether the current press turned into a real drag, so a
     tap in drag-mode can still close an open callout.                     */
  let dragMoved = false;

  let selectedFish: EndangeredFish | null = null;
  let calloutDiv: p5.Element;
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
    deselect();
  }

  /** Tear down any Chart.js instance and its drag listeners. */
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

  /** Clear the spotlight and callout; destroy any Chart.js instance. */
  function deselect(): void {
    selectedFish = null;
    if (calloutDiv) calloutDiv.hide();
    destroyChart();
  }

  function customCleanup(): void {
    runId++;
    destroyChart();
    if (calloutDiv) calloutDiv.remove();
    if (modeBtn) modeBtn.remove();
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

    // --- Callout UI Overlay -------------------------------------------------
    calloutDiv = p.createDiv("");
    calloutDiv.id("fish-callout");
    if ((p as any)._userNode) calloutDiv.parent((p as any)._userNode);
    calloutDiv.style("position", "absolute");
    calloutDiv.style("display", "none");
    calloutDiv.style("background", "rgba(10, 34, 51, 0.95)");
    calloutDiv.style("color", "#fff");
    calloutDiv.style("border", "1px solid #2a6a99");
    calloutDiv.style("border-radius", "8px");
    calloutDiv.style("padding", "16px");
    calloutDiv.style("font-family", "sans-serif");
    calloutDiv.style("width", "320px");
    calloutDiv.style("pointer-events", "auto");
    calloutDiv.style("z-index", "1000");
    calloutDiv.style("box-shadow", "0 4px 20px rgba(0,0,0,0.5)");

    // Don't let callout interactions reach the p5 canvas.
    const stopEvt = (e: Event) => e.stopPropagation();
    calloutDiv.elt.addEventListener("mousedown", stopEvt);
    calloutDiv.elt.addEventListener("touchstart", stopEvt, { passive: true });
    calloutDiv.elt.addEventListener("wheel", stopEvt, { passive: true });

    // --- Procedural textures ------------------------------------------------
    bubbleImg = common.makeBubbleSprite();
    skyImg = common.makeSkyTexture();
    sandImg = common.makeSandTexture();
    glowImg = common.makeGlowSprite();

    // --- Fish fallback sprites ---------------------------------------------
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

    // --- View toggle button --------------------------------------------------
    viewBtn = p.createButton("FRONT VIEW");
    if ((p as any)._userNode) viewBtn.parent((p as any)._userNode);
    viewBtn.position(24, 24);
    viewBtn.style("padding", "10px 18px");
    viewBtn.style("background", "rgba(10, 34, 51, 0.85)");
    viewBtn.style("color", "#7fd4ff");
    viewBtn.style("border", "1px solid #2a6a99");
    viewBtn.style("border-radius", "8px");
    viewBtn.style("font-family", "sans-serif");
    viewBtn.style("font-size", "13px");
    viewBtn.style("letter-spacing", "1.5px");
    viewBtn.style("cursor", "pointer");
    viewBtn.style("outline", "none");
    viewBtn.mousePressed(toggleView);

    // --- [NEW] Interaction-mode toggle (beside the view button) -------------
    modeBtn = p.createButton("FISH CLICK: ON");
    if ((p as any)._userNode) modeBtn.parent((p as any)._userNode);
    modeBtn.position(170, 24); // provisional — repositioned once laid out
    modeBtn.style("padding", "10px 18px");
    modeBtn.style("background", "rgba(10, 34, 51, 0.85)");
    modeBtn.style("color", "#7fd4ff");
    modeBtn.style("border", "1px solid #2a6a99");
    modeBtn.style("border-radius", "8px");
    modeBtn.style("font-family", "sans-serif");
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

  /* ------------------- STATIC DATA LOAD ------------------ */
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

  /* ------------------- [NEW] INTERACTION MODE TOGGLE --------------------- */
  function toggleSelectMode(): void {
    selectMode = !selectMode;
    camState.dragging = false; // abort any in-flight drag
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

    // Freeze camera auto-rotation while a fish is selected, so the
    // spotlighted fish (and its callout) stay exactly where clicked.
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
      // 1. Full-screen dark overlay — uses ortho in screen space so it
      //    covers the entire canvas regardless of the current projection.
      p.push();
      p.resetMatrix();
      p.ortho(0, p.width, 0, p.height, -1, 1);
      p.noStroke();
      p.fill(0, 0, 0, 180);
      p.rect(0, 0, p.width, p.height);
      p.pop();

      // 2. Restore the real camera + projection, then clear depth so the
      //    spotlighted fish paints on top of everything.
      common.updateCamera(camState, frontView, frontZoom, false);
      const gl = p.drawingContext as WebGL2RenderingContext;
      gl.clear(gl.DEPTH_BUFFER_BIT);

      // 3. Additive glow behind the fish.
      common.drawSpotlightGlow(selectedFish, camState, frontView, glowImg);

      // 4. The spotlighted fish itself.
      common.drawFish(selectedFish, camState, frontView, t, true);

      // 5. Move the callout to hover ABOVE the fish.
      updateCalloutPosition();
    }
  };

  /* ------------------------------ FISH MOTION ---------------------------- */
  function updateFishMovement(dt: number): void {
    const fishStep = Math.min(dt * 60, 2.5);
    for (const f of fishes) {
      // The selected fish holds still; everything else keeps swimming.
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
  /**
   * Approximate the fish's on-screen radius by projecting three world-space
   * offsets. Tracks perspective, front-view zoom, and orbit rotation — unlike
   * a fixed pixel radius.
   */
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

    // Generous margin + hard floor (front view's camera is further back,
    // so sprites render physically smaller — the floor keeps them clickable).
    return Math.max(maxD * 1.5, 30);
  }

  /* ------------------------------ INPUT ----------------------------------- */
  p.mousePressed = () => {
    // Callout guard: ignore presses landing on the callout (chart drag, etc.).
    if (calloutDiv && calloutDiv.elt.style.display !== "none") {
      const canvasEl = (p as any).canvas as HTMLCanvasElement | undefined;
      if (canvasEl) {
        const cr = canvasEl.getBoundingClientRect();
        const r = calloutDiv.elt.getBoundingClientRect();
        const cx = cr.left + p.mouseX;
        const cy = cr.top + p.mouseY;
        if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
          return;
        }
      }
    }

    // Click outside canvas → close callout (works in both modes).
    if (!isInsideCanvas(p)) {
      if (selectedFish) deselect();
      return;
    }

    /* ---------- SELECT MODE: press = fish click. No drag ever. ---------- */
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

      // Primary: any fish whose hit circle contains the click.
      // Tie-break: most-centred first, larger projected radius second
      // (bigger on screen ⇒ drawn on top).
      const inside = infos
        .filter((i) => i.score <= 1)
        .sort((a, b) => a.score - b.score || b.r - a.r);
      let clickedFish: EndangeredFish | null = inside[0]?.fish ?? null;

      // Fallback: nearest fish within 45 px of its silhouette (near-miss).
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

    /* ---------- DRAG MODE: press = potential drag. No fish click. ---------- */
    dragMoved = false;
    if (frontView) return; // front view has nothing to orbit
    camState.dragging = true;
    camState.idleTime = 0;
  };

  /* ------------------------------ CALLOUT -------------------------------- */
  function showCallout(f: EndangeredFish): void {
    destroyChart();

    const chartCanvasId = `fish-chart-${f.id.replace(/[^a-z0-9]/gi, "")}`;

    calloutDiv.html(`
      <h2 style="margin:0 0 8px 0;color:#7fd4ff;font-size:17px;">${f.species}</h2>
      <p style="margin:0 0 10px 0;font-size:12px;line-height:1.45;color:#cfd;">
        <strong>Fun Fact:</strong> ${f.funFact}
      </p>
      <div style="font-size:11px;color:#8aa;margin-bottom:6px;">
        <strong>Population History</strong>
      </div>
      <div style="background:rgba(0,0,0,0.25);border-radius:6px;padding:6px;">
        <canvas id="${chartCanvasId}" width="288" height="120"></canvas>
      </div>
      <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(127,212,255,0.15);font-size:11px;color:#666;text-align:center;">
        Click outside to close
      </div>
    `);
    calloutDiv.show();

    if (!selectedFish || selectedFish.id !== f.id) return;

    const canvas = document.getElementById(
      chartCanvasId,
    ) as HTMLCanvasElement | null;
    const ChartCtor = (window as any).Chart;
    if (!canvas) return;

    if (!ChartCtor) {
      if (canvas.parentElement) {
        canvas.parentElement.innerHTML =
          '<div style="color:#666;font-size:11px;text-align:center;padding:16px 0;">' +
          "Chart unavailable</div>";
      }
      return;
    }

    const hist = f.populationHistory;
    if (hist.length === 0) {
      canvas.parentElement!.innerHTML =
        '<div style="color:#666;font-size:11px;text-align:center;padding:16px 0;">' +
        "No population data available</div>";
      return;
    }

    const labels = hist.map((d) => d.month);
    const counts = hist.map((d) => d.count);
    const last = hist.length - 1;

    const pointStyles = (idx: number) => ({
      pointRadius: counts.map((_, i) => (i === idx ? 6 : 2.5)),
      pointBackgroundColor: counts.map((_, i) =>
        i === idx ? "#7fd4ff" : "#4a7a99",
      ),
      pointBorderColor: counts.map((_, i) =>
        i === idx ? "#ffffff" : "rgba(0,0,0,0)",
      ),
      pointBorderWidth: counts.map((_, i) => (i === idx ? 2 : 0)),
    });

    currentChart = new ChartCtor(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            data: counts,
            borderColor: "#7fd4ff",
            backgroundColor: "rgba(127,212,255,0.15)",
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            ...pointStyles(last),
          },
        ],
      },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: true },
        },
        scales: {
          x: {
            ticks: { color: "#779", font: { size: 9 }, maxRotation: 0 },
            grid: { color: "rgba(127,212,255,0.06)" },
          },
          y: {
            beginAtZero: true,
            ticks: { color: "#779", font: { size: 9 } },
            grid: { color: "rgba(127,212,255,0.06)" },
          },
        },
      },
    });

    /* ------------------ draggable chart (highlight scrubber) ----------- */
    let highlighted = last;
    let dragging = false;

    const logPoint = (idx: number) => {
      // eslint-disable-next-line no-console
      console.log(`[aquarium] ${f.species} — ${labels[idx]}: ${counts[idx]}`);
    };

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
      if (doLog) logPoint(idx);
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

    if (cy < margin) {
      cy = sp.y + selectedFish.size * 0.5 + 24;
    }

    if (cx < margin) cx = margin;
    if (cx + rect.width > p.width - margin) cx = p.width - rect.width - margin;
    if (cy + rect.height > p.height - margin)
      cy = p.height - rect.height - margin;
    if (cy < margin) cy = margin;

    calloutDiv.position(cx, cy);
  }

  /* --------------------------- MOUSE / TOUCH ---------------------------- */
  p.mouseDragged = () => {
    if (!camState.dragging || frontView) return;
    dragMoved = true; // [NEW] mark real drag for tap detection on release
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

    // In drag mode, a *tap* (press+release with no movement) closes the
    // callout. A real drag leaves the callout open.
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
  p.windowResized = (): void => {
    const { w, h } = containerSize();
    p.resizeCanvas(w, h);
    p.perspective(p.PI / 3, w / h, 10, 7000);
  };

  (p as any).resizeToContainer = () => {
    const { w, h } = containerSize();
    p.resizeCanvas(w, h);
    p.perspective(p.PI / 3, w / h, 10, 7000);
  };

  (p as any).customCleanup = customCleanup;
}
