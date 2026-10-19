import type p5 from "p5";
import {
  getExistingFish,
  subscribeToNewFish,
  supabase,
  type FishRow,
} from "../lib/supabase";

// Import shared utilities
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
   • Fish PNGs come from Supabase (`image_url`). Fallbacks are drawn
     procedurally when a row has no image or the image fails to load.
   • Golden kelp sways with layered sine waves and releases bubbles.
   • Bubbles rise, wobble and fade near the surface.
   • Drag to orbit.
   • Scroll wheel: zoom in / out.
   • Button (top-left): toggle FRONT VIEW (flat 2D) / ORBIT VIEW (3D).
   • REALTIME: subscribeToNewFish() drops new fish into the tank the moment
     a row is inserted — the tank is never rebuilt or reloaded.
   ========================================================================= */

/* ------------------------------ CONFIG ---------------------------------- */
const TANK = { w: 780, h: 460, d: 460, floorY: 230, topY: -230 };

const MIN_FISH = 9; // minimum school size when PNGs are present
const NO_IMG_FISH = 9; // school size when no PNG loads at all

export function sketch(p: p5): void {
  const common = createCommon(p);

  /* Filled at runtime from Supabase inside setup(): one image_url per row.
     If it stays empty (no rows / all loads failed) we fall back to
     NO_IMG_FISH procedurally drawn fish. */
  const FISH_FILES: string[] = [];

  let camState: CameraState = {
    theta: 0.7,
    phi: 0.16,
    radius: 1080,
    x: 0,
    y: 0,
    z: 0,
    right: null as unknown as p5.Vector, // initialized in setup() once p5 boots
    dragging: false,
    idleTime: 99,
  };

  /* front-view state */
  let frontView = false;
  let frontZoom = 1; // 1 = default, >1 = zoom in, <1 = zoom out
  let savedTheta = 0.7;
  let savedPhi = 0.16;
  let savedRadius = 1080;
  let viewBtn: p5.Element;

  let loadedFishImgs: p5.Image[] = []; // PNGs that actually loaded
  let fallbackFishImgs: p5.Graphics[] = []; // procedurally drawn sprites

  const fishes: Fish[] = [];
  const kelps: Kelp[] = [];
  const bubbles: Bubble[] = [];
  const rocks: Rock[] = [];

  let bubbleImg: p5.Graphics;
  let skyImg: p5.Graphics;
  let sandImg: p5.Graphics;
  let t = 0;

  let runId = 0;

  /* ------------------------------- TYPES ---------------------------------- */
  // Types (Fish, Kelp, Bubble, Rock) are now imported from `aquarium-common`

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
  /** Module state survives unmount (ES modules are cached), so wipe it. */
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

    // Reset camera state
    camState.theta = 0.7;
    camState.phi = 0.16;
    camState.radius = 1080;
    camState.dragging = false;
    camState.idleTime = 99;
  }

  function customCleanup(): void {
    runId++; // invalidates any in-flight fetch / image load
    teardownRealtime();
  }

  /* ------------------------- FISH LOADING / SPAWN ------------------------- */

  // `loadFishImages` is imported from `aquarium-common`

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

    const { w, h } = containerSize();
    p.createCanvas(w, h, p.WEBGL);
    p.perspective(p.PI / 3, w / h, 10, 7000);
    p.strokeCap(p.ROUND);

    camState.right = p.createVector(1, 0, 0);

    // --- Procedural textures ------------------------------------------------
    bubbleImg = common.makeBubbleSprite();
    skyImg = common.makeSkyTexture();
    sandImg = common.makeSandTexture();

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

    // --- Fetch existing fish + open the realtime channel --------------------
    // (must run AFTER the fallback sprites exist, since realtime inserts can
    //  fall back to them)
    initFishFromSupabase();

    // --- Kelp ----------------------------------------------------------------
    for (let i = 0; i < 12; i++) {
      kelps.push(
        makeKelp(
          p.random(-TANK.w * 0.44, TANK.w * 0.44),
          p.random(-TANK.d * 0.44, TANK.d * 0.44),
        ),
      );
    }

    // --- Rocks ---------------------------------------------------------------
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
  };

  /* ------------------- SUPABASE: INITIAL LOAD + REALTIME ------------------ */

  /** Rows we've already turned into fish (prevents duplicates on reconnects). */
  const seenFishIds = new Set<string>();
  /** Rows that arrived before the initial school finished building. */
  const pendingFishRows: FishRow[] = [];
  /** True once buildFishes() has run for the first time. */
  let tankReady = false;
  /** Handle returned by subscribeToNewFish (channel or unsubscribe fn). */
  let fishChannel: ReturnType<typeof subscribeToNewFish> | null = null;

  function initFishFromSupabase(): void {
    // A previous mount may have left a live channel. If we don't drop it,
    // supabase.channel("fish_changes") hands back the cached, already-
    // subscribed channel and the next .on() throws.
    teardownRealtime();

    // Subscribe FIRST so a row inserted while the initial fetch is in flight
    // isn't lost. Anything that lands early is buffered in pendingFishRows.
    const run = runId;
    subscribeToRealtimeFish(run);
    void loadExistingFish(run);
  }

  /** setup() task: pull every existing row and use its image_url as FISH_FILES. */
  async function loadExistingFish(run: number): Promise<void> {
    let rows: FishRow[] = [];

    try {
      rows = (await getExistingFish()) ?? [];
    } catch (err) {
      console.warn("[aquarium] getExistingFish failed:", err);
    }

    if (run !== runId) return;

    // Update the FISH_FILES list in place (it stays `const`).
    FISH_FILES.length = 0;
    for (const row of rows) {
      if (!row || !row.id || seenFishIds.has(row.id)) continue;
      seenFishIds.add(row.id);
      if (row.image_url) FISH_FILES.push(row.image_url);
    }

    // Load every URL, then spawn the school once (never again).
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

  /** Realtime callback: a new row landed in Supabase. */
  function handleNewFishRow(row: FishRow): void {
    if (!row || !row.id || seenFishIds.has(row.id)) return;
    seenFishIds.add(row.id);

    // Tank still building? Buffer it and replay once we're live.
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

  /** Load the new fish's image and add it — the tank is never rebuilt. */
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

  // `enterFromEdge` is imported from `aquarium-common`

  /** Close the realtime channel (page unload / HMR). */
  function teardownRealtime(): void {
    if (!fishChannel) return;
    try {
      // removeChannel unsubscribes AND frees the name on the client,
      // so the next supabase.channel("fish_changes") returns a fresh channel.
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
      camState.radius = 1200; // sits inside the water dome
      viewBtn.html("ORBIT VIEW");
    } else {
      camState.theta = savedTheta;
      camState.phi = savedPhi;
      camState.radius = savedRadius;
      viewBtn.html("FRONT VIEW");
    }
    camState.dragging = false;
  }

  /* -------------------------------- DRAW ---------------------------------- */
  p.draw = () => {
    p.background(3, 14, 24);
    const dt = Math.min(p.deltaTime, 50) * 0.001;
    t += dt;

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
  };

  /* ------------------------------ CAMERA ---------------------------------- */
  // `updateCamera` is imported from `aquarium-common`

  /* ------------------------------- FLOOR ---------------------------------- */
  // `drawFloor` and `drawCaustics` are imported from `aquarium-common`

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

  // `drawKelp` is imported from `aquarium-common`

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

      // f.pos.add(p5.Vector.mult(f.vel, fishStep));
      f.pos.add(f.vel.copy().mult(fishStep));
    }

    // render

    // Sort farthest-from-camera first so overlapping transparent
    // billboards blend in the correct order.
    const sorted = [...fishes].sort((a, b) => {
      const da =
        (camState.x - a.pos.x) ** 2 +
        (camState.y - a.pos.y) ** 2 +
        (camState.z - a.pos.z) ** 2;
      const db =
        (camState.x - b.pos.x) ** 2 +
        (camState.y - b.pos.y) ** 2 +
        (camState.z - b.pos.z) ** 2;
      return db - da; // farthest first
    });

    for (const f of sorted) common.drawFish(f, camState, frontView, t);
  }

  // `drawFish` is imported from `aquarium-common`

  /* ------------------------------- BUBBLES -------------------------------- */
  // `drawAllBubbles` is imported from `aquarium-common`

  /* -------------------------------- GLASS --------------------------------- */
  // `drawGlass` is imported from `aquarium-common`

  /* --------------------------- TEXTURE FACTORIES -------------------------- */
  // `makeFishSprite`, `makeBubbleSprite`, `makeSkyTexture`, and `makeSandTexture`
  // are imported from `aquarium-common`

  /* ------------------------------ INPUT ----------------------------------- */

  p.mousePressed = () => {
    if (!isInsideCanvas(p)) return;
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
  };

  /* Scroll wheel: up = zoom in, down = zoom out ------------------------------ */
  p.mouseWheel = (event: any): boolean => {
    if (!isInsideCanvas(p)) return true;
    const mouseSign = Math.sign(event.delta);
    if (frontView) {
      // Orthographic zoom: shrink visible area to zoom in.
      frontZoom = p.constrain(frontZoom * (1 - mouseSign * 0.12), 0.4, 4);
    } else {
      // Perspective zoom: move camera closer / farther.
      camState.radius = p.constrain(
        camState.radius + mouseSign * 90,
        400,
        2600,
      );
    }
    return false; // stop page from scrolling
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
  p.windowResized = (): void => {
    const { w, h } = containerSize();
    p.resizeCanvas(w, h);
    p.perspective(p.PI / 3, w / h, 10, 7000);
  };

  // Expose an explicit resize hook for the React wrapper's ResizeObserver.
  (p as any).resizeToContainer = () => {
    const { w, h } = containerSize();
    p.resizeCanvas(w, h);
    p.perspective(p.PI / 3, w / h, 10, 7000);
  };

  /* =========================================================================
     p5 GLOBAL-MODE BRIDGE
     -------------------------------------------------------------------------
     This file is an ES module (it has `import`s), so `setup`, `draw`, … are
     module-scoped and NOT visible on `window` — which is where p5 global mode
     looks for them. Re-publishing them keeps the sketch working after
     bundling. (If you switch to instance mode — `new p5((p) => {…})` — delete
     this block and prefix every p5 call with `p.`.)
     ========================================================================= */

  // Expose cleanup so `instance.customCleanup?.()` from the React wrapper works.
  (p as any).customCleanup = customCleanup;

  window.addEventListener("beforeunload", teardownRealtime);
}
