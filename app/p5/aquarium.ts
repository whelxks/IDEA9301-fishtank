/// <reference path="../../node_modules/@types/p5/global.d.ts" />

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
  updateCamera,
  loadFishImages,
  enterFromEdge,
  drawFloor,
  drawCaustics,
  drawRocks,
  drawGlass,
  drawKelp,
  drawFish,
  drawAllBubbles,
  makeFishSprite,
  makeBubbleSprite,
  makeSkyTexture,
  makeSandTexture,
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

/* Filled at runtime from Supabase inside setup(): one image_url per row.
   If it stays empty (no rows / all loads failed) we fall back to
   NO_IMG_FISH procedurally drawn fish. */
const FISH_FILES: string[] = [];

const MIN_FISH = 9; // minimum school size when PNGs are present
const NO_IMG_FISH = 9; // school size when no PNG loads at all

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

export function customCleanup(): void {
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
    size: random(72, 118),
    pos: createVector(
      random(-TANK.w * 0.32, TANK.w * 0.32),
      random(-130, 120),
      random(-TANK.d * 0.32, TANK.d * 0.32),
    ),
    vel: createVector(random(-1, 1), 0, random(-1, 1))
      .normalize()
      .mult(random(1.1, 2.0)),
    speed: random(1.0, 2.1),
    phase: random(1000),
    fin: random(TWO_PI),
    bob: random(TWO_PI),
    baseY: random(-120, 110),
  };
}

/* ------------------------------- SETUP ---------------------------------- */
function setup(): void {
  resetState();
  runId++;

  createCanvas(windowWidth, windowHeight, WEBGL);
  perspective(PI / 3, width / height, 10, 7000);
  strokeCap(ROUND);

  camState.right = createVector(1, 0, 0);

  // --- Procedural textures ------------------------------------------------
  bubbleImg = makeBubbleSprite();
  skyImg = makeSkyTexture();
  sandImg = makeSandTexture();

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

  fallbackFishImgs = palettes.map((p) => makeFishSprite(p[0], p[1], p[2]));

  // --- Fetch existing fish + open the realtime channel --------------------
  // (must run AFTER the fallback sprites exist, since realtime inserts can
  //  fall back to them)
  initFishFromSupabase();

  // --- Kelp ----------------------------------------------------------------
  for (let i = 0; i < 12; i++) {
    kelps.push(
      makeKelp(
        random(-TANK.w * 0.44, TANK.w * 0.44),
        random(-TANK.d * 0.44, TANK.d * 0.44),
      ),
    );
  }

  // --- Rocks ---------------------------------------------------------------
  for (let i = 0; i < 7; i++) {
    rocks.push({
      x: random(-TANK.w * 0.42, TANK.w * 0.42),
      z: random(-TANK.d * 0.42, TANK.d * 0.42),
      s: random(24, 62),
      r: random(TWO_PI),
      c: random(70, 110),
    });
  }

  camState.right = createVector(1, 0, 0);

  // --- View toggle button --------------------------------------------------
  viewBtn = createButton("FRONT VIEW");
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
}

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
  loadFishImages(FISH_FILES, (imgs) => {
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

  loadImage(
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
  enterFromEdge(f, TANK.w, TANK.d);
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
function draw(): void {
  background(3, 14, 24);
  const dt = Math.min(deltaTime, 50) * 0.001;
  t += dt;

  updateCamera(camState, frontView, frontZoom, TANK.w, TANK.d);

  // Water dome
  push();
  noStroke();
  texture(skyImg);
  sphere(2600, 16, 12);
  pop();

  // Scene
  drawFloor(TANK.w, TANK.d, TANK.floorY, sandImg);
  drawCaustics(t, TANK.w, TANK.d, TANK.floorY);
  drawRocks(rocks, TANK.floorY);
  drawAllKelp();
  drawAllFish();
  drawAllBubbles(
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
  drawGlass(TANK.w, TANK.h, TANK.d);
}

/* ------------------------------ CAMERA ---------------------------------- */
// `updateCamera` is imported from `aquarium-common`

/* ------------------------------- FLOOR ---------------------------------- */
// `drawFloor` and `drawCaustics` are imported from `aquarium-common`

/* -------------------------------- KELP ---------------------------------- */
function makeKelp(x: number, z: number): Kelp {
  const segs = 14;
  const h = random(180, 330);
  const colA = color(96, 58, 12);
  const colB = color(255, 196, 62);
  return {
    x,
    z,
    segs,
    segLen: h / segs,
    width0: random(16, 26),
    phase: random(TWO_PI),
    speed: random(0.55, 1.05),
    sway: random(0.22, 0.42),
    dir: random(TWO_PI),
    colA,
    colB,
    colGradient: Array.from({ length: segs }, (_, i) =>
      lerpColor(colA, colB, Math.pow(i / segs, 0.65)),
    ),
    tip: null,
  };
}

function drawAllKelp(): void {
  noStroke();
  for (const k of kelps) {
    drawKelp(k, camState.right, t, TANK.floorY);

    if (k.tip && bubbles.length < 90 && random() < 0.008) {
      bubbles.push({
        pos: createVector(
          k.tip.x + random(-8, 8),
          k.tip.y + random(-6, 2),
          k.tip.z + random(-8, 8),
        ),
        size: random(3.5, 9),
        speed: random(26, 58),
        phase: random(TWO_PI),
        wob: random(6, 20),
        life: 0,
      });
    }
  }
}

// `drawKelp` is imported from `aquarium-common`

/* -------------------------------- FISH ---------------------------------- */
function drawAllFish(): void {
  const fishStep = Math.min(deltaTime / 16.6667, 2.5);

  for (const f of fishes) {
    const nz = noise(f.phase, t * 0.06);
    const targetAng = nz * TWO_PI * 2.2;
    const desired = createVector(
      Math.cos(targetAng),
      0,
      Math.sin(targetAng),
    ).mult(f.speed);
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

  for (const f of sorted) drawFish(f, camState, frontView, t);
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
function mousePressed(): void {
  if (frontView) return;
  camState.dragging = true;
  camState.idleTime = 0;
}

function mouseDragged(): void {
  if (!camState.dragging || frontView) return;
  camState.theta -= (mouseX - (pmouseX || mouseX)) * 0.006;
  camState.phi = constrain(
    camState.phi - (mouseY - (pmouseY || mouseY)) * 0.004,
    -0.35,
    1.15,
  );
  camState.idleTime = 0;
}

function mouseReleased(): void {
  camState.dragging = false;
}

/* Scroll wheel: up = zoom in, down = zoom out ------------------------------ */
function mouseWheel(event: WheelEvent & { delta: number }): boolean {
  const mouseSign = Math.sign(event.delta);
  if (frontView) {
    // Orthographic zoom: shrink visible area to zoom in.
    frontZoom = constrain(frontZoom * (1 - mouseSign * 0.12), 0.4, 4);
  } else {
    // Perspective zoom: move camera closer / farther.
    camState.radius = constrain(camState.radius + mouseSign * 90, 400, 2600);
  }
  return false; // stop page from scrolling
}

function touchStarted(): void {
  mousePressed();
}
function touchMoved(): boolean {
  mouseDragged();
  return false;
}
function touchEnded(): void {
  mouseReleased();
}

/* ------------------------------ RESIZE ---------------------------------- */
function windowResized(): void {
  resizeCanvas(windowWidth, windowHeight);
  perspective(PI / 3, width / height, 10, 7000);
}

/* =========================================================================
   p5 GLOBAL-MODE BRIDGE
   -------------------------------------------------------------------------
   This file is an ES module (it has `import`s), so `setup`, `draw`, … are
   module-scoped and NOT visible on `window` — which is where p5 global mode
   looks for them. Re-publishing them keeps the sketch working after
   bundling. (If you switch to instance mode — `new p5((p) => {…})` — delete
   this block and prefix every p5 call with `p.`.)
   ========================================================================= */
Object.assign(window, {
  setup,
  draw,
  mousePressed,
  mouseDragged,
  mouseReleased,
  mouseWheel,
  touchStarted,
  touchMoved,
  touchEnded,
  windowResized,
});

window.addEventListener("beforeunload", teardownRealtime);
