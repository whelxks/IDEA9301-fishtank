/// <reference path="../../node_modules/@types/p5/global.d.ts" />

import type p5 from "p5";
import {
  getExistingFish,
  subscribeToNewFish,
  type FishRow,
} from "../lib/supabase";

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

let camTheta = 0.7;
let camPhi = 0.16;
let camRadius = 1080;
let camX = 0,
  camY = 0,
  camZ = 0;
let camRight: p5.Vector;

let dragging = false;
let lastMX = 0;
let lastMY = 0;
let idleTime = 99;

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

/* ------------------------------- TYPES ---------------------------------- */
type FishSprite = p5.Image | p5.Graphics;

interface Fish {
  img: FishSprite;
  size: number;
  pos: p5.Vector;
  vel: p5.Vector;
  speed: number;
  phase: number;
  fin: number;
  bob: number;
  baseY: number;
}

interface KelpPoint {
  x: number;
  y: number;
  z: number;
  w: number;
}

interface Kelp {
  x: number;
  z: number;
  segs: number;
  segLen: number;
  width0: number;
  phase: number;
  speed: number;
  sway: number;
  dir: number;
  colA: p5.Color;
  colB: p5.Color;
  tip: KelpPoint | null;
}

interface Bubble {
  pos: p5.Vector;
  size: number;
  speed: number;
  phase: number;
  wob: number;
  life: number;
}

interface Rock {
  x: number;
  z: number;
  s: number;
  r: number;
  c: number;
}

/* ------------------------- FISH LOADING / SPAWN ------------------------- */

function loadFishImages(
  files: string[],
  onDone: (imgs: p5.Image[]) => void,
): void {
  if (!files || files.length === 0) {
    onDone([]);
    return;
  }

  const results: Array<p5.Image | null> = new Array(files.length).fill(null);
  let remaining = files.length;

  const finish = (): void => {
    remaining -= 1;
    if (remaining === 0) {
      onDone(results.filter((img): img is p5.Image => img !== null));
    }
  };

  files.forEach((file, i) => {
    loadImage(
      file,
      (img) => {
        console.log("loaded", file, img.width, img.height);
        results[i] = img;
        finish();
      },
      () => {
        console.warn("failed to load", file);
        finish();
      },
    );
  });
}

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
  createCanvas(windowWidth, windowHeight, WEBGL);
  perspective(PI / 3, width / height, 10, 7000);
  strokeCap(ROUND);

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

  camRight = createVector(1, 0, 0);

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
  // Subscribe FIRST so a row inserted while the initial fetch is in flight
  // isn't lost. Anything that lands early is buffered in pendingFishRows.
  subscribeToRealtimeFish();
  void loadExistingFish();
}

/** setup() task: pull every existing row and use its image_url as FISH_FILES. */
async function loadExistingFish(): Promise<void> {
  let rows: FishRow[] = [];

  try {
    rows = (await getExistingFish()) ?? [];
  } catch (err) {
    console.warn("[aquarium] getExistingFish failed:", err);
  }

  // Update the FISH_FILES list in place (it stays `const`).
  FISH_FILES.length = 0;
  for (const row of rows) {
    if (!row || !row.id || seenFishIds.has(row.id)) continue;
    seenFishIds.add(row.id);
    if (row.image_url) FISH_FILES.push(row.image_url);
  }

  // Load every URL, then spawn the school once (never again).
  loadFishImages(FISH_FILES, (imgs) => {
    loadedFishImgs = imgs;
    buildFishes();
    tankReady = true;
    flushPendingFishRows();
  });
}

function subscribeToRealtimeFish(): void {
  try {
    fishChannel = subscribeToNewFish((row: FishRow) => handleNewFishRow(row));
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

function flushPendingFishRows(): void {
  while (pendingFishRows.length > 0) {
    const row = pendingFishRows.shift();
    if (row) spawnFishFromRow(row);
  }
}

/** Load the new fish's image and add it — the tank is never rebuilt. */
function spawnFishFromRow(row: FishRow): void {
  const url = row.image_url;

  if (!url) {
    addFishToTank(makeFish(randomFallbackSprite()));
    return;
  }

  loadImage(
    url,
    (img) => {
      loadedFishImgs.push(img);
      addFishToTank(makeFish(img));
    },
    () => {
      console.warn("[aquarium] new fish image failed to load:", url);
      addFishToTank(makeFish(randomFallbackSprite()));
    },
  );
}

function randomFallbackSprite(): FishSprite {
  return fallbackFishImgs[fishes.length % fallbackFishImgs.length];
}

function addFishToTank(f: Fish): void {
  enterFromEdge(f);
  fishes.push(f);
}

/** Spawn just outside the glass so the newcomer visibly swims in. */
function enterFromEdge(f: Fish): void {
  const hw = TANK.w * 0.45;
  const hd = TANK.d * 0.45;

  switch (Math.floor(random(4))) {
    case 0:
      f.pos.set(-hw, random(-120, 110), random(-hd, hd));
      break;
    case 1:
      f.pos.set(hw, random(-120, 110), random(-hd, hd));
      break;
    case 2:
      f.pos.set(random(-hw, hw), random(-120, 110), -hd);
      break;
    default:
      f.pos.set(random(-hw, hw), random(-120, 110), hd);
      break;
  }

  f.baseY = f.pos.y;

  const dir = createVector(-f.pos.x, 0, -f.pos.z);
  if (dir.magSq() < 1e-4) dir.set(1, 0, 0);
  f.vel = dir.normalize().mult(f.speed);
}

/** Close the realtime channel (page unload / HMR). */
function teardownRealtime(): void {
  const ch: unknown = fishChannel;
  if (typeof ch === "function") {
    (ch as () => void)();
  } else if (
    ch &&
    typeof (ch as { unsubscribe?: unknown }).unsubscribe === "function"
  ) {
    (ch as { unsubscribe: () => void }).unsubscribe();
  }
  fishChannel = null;
}

/* ------------------------- VIEW TOGGLE ---------------------------------- */
function toggleView(): void {
  frontView = !frontView;
  if (frontView) {
    savedTheta = camTheta;
    savedPhi = camPhi;
    savedRadius = camRadius;

    camTheta = 0;
    camPhi = 0;
    camRadius = 1200; // sits inside the water dome
    viewBtn.html("ORBIT VIEW");
  } else {
    camTheta = savedTheta;
    camPhi = savedPhi;
    camRadius = savedRadius;
    viewBtn.html("FRONT VIEW");
  }
  dragging = false;
}

/* -------------------------------- DRAW ---------------------------------- */
function draw(): void {
  background(3, 14, 24);
  const dt = Math.min(deltaTime, 50) * 0.001;
  t += dt;

  updateCamera();

  // Water dome
  push();
  noStroke();
  texture(skyImg);
  sphere(2600, 16, 12);
  pop();

  // Scene
  drawFloor();
  drawCaustics();
  drawRocks();
  drawAllKelp();
  drawAllFish();
  drawAllBubbles(dt);
  drawGlass();
}

/* ------------------------------ CAMERA ---------------------------------- */
function updateCamera(): void {
  // --- Projection --------------------------------------------------------
  if (frontView) {
    // Orthographic: flat 2D-like look. frontZoom controls visible height.
    const vh = 700 / frontZoom;
    const vw = vh * (width / height);
    ortho(-vw / 2, vw / 2, -vh / 2, vh / 2, 10, 7000);
  } else {
    perspective(PI / 3, width / height, 10, 7000);
  }

  // --- Auto orbit (only in 3D mode) --------------------------------------
  if (!dragging && !frontView) {
    idleTime += Math.min(deltaTime, 50) * 0.001;
    if (idleTime > 3) camTheta += 0.0016;
  }

  // --- Position camera ---------------------------------------------------
  const cr = camRadius * Math.cos(camPhi);
  camX = cr * Math.sin(camTheta);
  camY = -camRadius * Math.sin(camPhi);
  camZ = cr * Math.cos(camTheta);

  camera(camX, camY, camZ, 0, 0, 0, 0, 1, 0);

  // --- Screen-right vector (for kelp ribbon orientation) -----------------
  const fx = -camX,
    fy = -camY,
    fz = -camZ;
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  const ux = fx / fl,
    uz = fz / fl;
  camRight = createVector(-uz, 0, ux).normalize();
}

/* ------------------------------- FLOOR ---------------------------------- */
function drawFloor(): void {
  push();
  translate(0, TANK.floorY + 24, 0);
  noStroke();
  fill(88, 70, 50);
  box(TANK.w, 48, TANK.d);
  pop();

  push();
  translate(0, TANK.floorY - 0.5, 0);
  rotateX(HALF_PI);
  noStroke();
  texture(sandImg);
  plane(TANK.w, TANK.d);
  pop();
}

function drawCaustics(): void {
  push();
  translate(0, TANK.floorY - 1.4, 0);
  rotateX(HALF_PI);
  noStroke();
  blendMode(ADD);
  for (let i = 0; i < 8; i++) {
    const ph = t * 0.25 + i * 1.7;
    const x = Math.sin(ph * 0.7 + i) * TANK.w * 0.32;
    const y = Math.cos(ph * 0.53 + i * 2.1) * TANK.d * 0.32;
    const s = 140 + 70 * Math.sin(ph * 1.3 + i);
    fill(70, 140, 150, 18);
    ellipse(x, y, s * 1.7, s);
  }
  blendMode(BLEND);
  pop();
}

function drawRocks(): void {
  noStroke();
  for (const r of rocks) {
    push();
    translate(r.x, TANK.floorY - r.s * 0.35, r.z);
    rotateY(r.r);
    fill(r.c, r.c * 0.9, r.c * 0.78);
    sphere(r.s, 8, 6);
    pop();
  }
}

/* -------------------------------- KELP ---------------------------------- */
function makeKelp(x: number, z: number): Kelp {
  const segs = 14;
  const h = random(180, 330);
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
    colA: color(96, 58, 12),
    colB: color(255, 196, 62),
    tip: null,
  };
}

function drawAllKelp(): void {
  noStroke();
  for (const k of kelps) {
    drawKelp(k);

    if (k.tip && bubbles.length < 90 && random() < 0.008) {
      bubbles.push(
        makeBubble(
          k.tip.x + random(-8, 8),
          k.tip.y + random(-6, 2),
          k.tip.z + random(-8, 8),
          random(3.5, 9),
        ),
      );
    }
  }
}

function drawKelp(k: Kelp): void {
  const n = k.segs;
  const pts: KelpPoint[] = [];

  let px = k.x,
    py = TANK.floorY,
    pz = k.z;
  let ang = 0;
  const dirA = k.dir + Math.sin(t * 0.17 + k.phase) * 0.6;
  const dx = Math.cos(dirA),
    dz = Math.sin(dirA);

  pts.push({ x: px, y: py, z: pz, w: k.width0 }); // anchored to the sand

  for (let i = 0; i <= n; i++) {
    const u = i / n;
    ang += Math.sin(t * k.speed + k.phase + i * 0.55) * 0.17 * (0.35 + u * 1.2);
    ang += 0.02;
    px += Math.sin(ang) * k.segLen * dx;
    pz += Math.sin(ang) * k.segLen * dz;
    py -= Math.cos(ang) * k.segLen;
    pts.push({ x: px, y: py, z: pz, w: k.width0 * (1 - u * 0.86) });
  }
  k.tip = pts[n];

  const rx = camRight.x,
    rz = camRight.z;

  for (let i = 0; i < n; i++) {
    const a = pts[i],
      b = pts[i + 1];
    const u = i / n;
    fill(lerpColor(k.colA, k.colB, Math.pow(u, 0.65)));
    beginShape();
    vertex(a.x - rx * a.w * 0.5, a.y, a.z - rz * a.w * 0.5);
    vertex(a.x + rx * a.w * 0.5, a.y, a.z + rz * a.w * 0.5);
    vertex(b.x + rx * b.w * 0.5, b.y, b.z + rz * b.w * 0.5);
    vertex(b.x - rx * b.w * 0.5, b.y, b.z - rz * b.w * 0.5);
    endShape(CLOSE);
  }

  for (let i = 2; i < n - 1; i += 2) {
    const a = pts[i];
    const u = i / n;
    const side = i % 4 === 0 ? 1 : -1;
    const len = 26 + 20 * Math.sin(i * 1.7 + k.phase);
    fill(
      lerpColor(
        lerpColor(k.colA, k.colB, Math.pow(u, 0.65)),
        color(255, 232, 150),
        0.3,
      ),
    );
    beginShape();
    vertex(a.x, a.y, a.z);
    vertex(a.x + rx * side * a.w * 0.45, a.y + 2, a.z + rz * side * a.w * 0.45);
    vertex(a.x + rx * side * len, a.y - len * 0.55, a.z + rz * side * len);
    endShape(CLOSE);
  }
}

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
      (camX - a.pos.x) ** 2 + (camY - a.pos.y) ** 2 + (camZ - a.pos.z) ** 2;
    const db =
      (camX - b.pos.x) ** 2 + (camY - b.pos.y) ** 2 + (camZ - b.pos.z) ** 2;
    return db - da; // farthest first
  });

  for (const f of sorted) drawFish(f);
}

function drawFish(f: Fish): void {
  push();
  translate(f.pos.x, f.pos.y, f.pos.z);

  // Billboard: face the camera.
  // In front-view (ortho), every fish uses the same view direction so they
  // stay perfectly flat; in orbit view we aim each fish at the camera.
  let vx: number, vy: number, vz: number;
  if (frontView) {
    vx = -camX;
    vy = -camY;
    vz = -camZ; // global view direction
  } else {
    vx = camX - f.pos.x;
    vy = camY - f.pos.y;
    vz = camZ - f.pos.z;
  }
  rotateY(Math.atan2(vx, vz));
  rotateX(-Math.atan2(vy, Math.sqrt(vx * vx + vz * vz)));

  const fishDot = f.vel.x * camRight.x + f.vel.z * camRight.z;
  const flip = fishDot < 0 ? -1 : 1;
  const sy = 1 + Math.sin(t * 9 + f.fin) * 0.05;

  scale(flip * f.size * 0.5, f.size * 0.5 * sy, 1);
  noStroke();
  texture(f.img);

  drawingContext.depthMask(false);
  plane(2, 1);
  drawingContext.depthMask(true);

  pop();
}

/* ------------------------------- BUBBLES -------------------------------- */
function makeBubble(x: number, y: number, z: number, size: number): Bubble {
  return {
    pos: createVector(x, y, z),
    size: size,
    speed: random(26, 58),
    phase: random(TWO_PI),
    wob: random(6, 20),
    life: 0,
  };
}

function drawAllBubbles(dt: number): void {
  if (bubbles.length < 85 && random() < 0.02) {
    bubbles.push(
      makeBubble(
        random(-TANK.w * 0.4, TANK.w * 0.4),
        TANK.floorY - 4,
        random(-TANK.d * 0.4, TANK.d * 0.4),
        random(3, 8),
      ),
    );
  }

  noStroke();
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];

    b.pos.y -= b.speed * dt;
    b.pos.x += Math.sin(t * 1.7 + b.phase) * b.wob * dt;
    b.pos.z += Math.cos(t * 1.3 + b.phase) * b.wob * dt;
    b.life += dt;

    if (b.pos.y < TANK.topY + 4 || b.life > 22) {
      bubbles.splice(i, 1);
      continue;
    }

    const dx = camX - b.pos.x;
    const dy = camY - b.pos.y;
    const dz = camZ - b.pos.z;
    const bbAlpha = map(b.pos.y, TANK.topY, TANK.topY + 90, 0, 200, true);

    push();
    translate(b.pos.x, b.pos.y, b.pos.z);
    rotateY(Math.atan2(dx, dz));
    rotateX(-Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)));
    texture(bubbleImg);
    tint(255, bbAlpha);
    plane(b.size, b.size);
    noTint();
    pop();
  }
}

/* -------------------------------- GLASS --------------------------------- */
function drawGlass(): void {
  push();
  noFill();
  stroke(150, 215, 245, 38);
  strokeWeight(1.5);
  box(TANK.w, TANK.h, TANK.d);
  pop();
}

/* --------------------------- TEXTURE FACTORIES -------------------------- */

type RGB = [number, number, number];

function makeFishSprite(bodyC: RGB, finC: RGB, tailC: RGB): p5.Graphics {
  const g = createGraphics(256, 128);
  g.clear();
  g.noStroke();

  g.fill(tailC[0], tailC[1], tailC[2], 235);
  g.beginShape();
  g.vertex(56, 64);
  g.vertex(8, 20);
  g.vertex(20, 64);
  g.vertex(8, 108);
  g.endShape(CLOSE);

  g.fill(finC[0], finC[1], finC[2], 225);
  g.beginShape();
  g.vertex(112, 30);
  g.vertex(136, 6);
  g.vertex(168, 32);
  g.endShape(CLOSE);

  g.beginShape();
  g.vertex(118, 96);
  g.vertex(140, 122);
  g.vertex(168, 94);
  g.endShape(CLOSE);

  g.fill(bodyC[0], bodyC[1], bodyC[2], 245);
  g.ellipse(124, 64, 152, 80);

  g.fill(255, 255, 255, 45);
  g.ellipse(130, 84, 110, 36);

  g.fill(255, 255, 255, 40);
  g.ellipse(96, 60, 16, 66);
  g.ellipse(126, 62, 14, 70);

  g.fill(255);
  g.ellipse(180, 54, 26, 26);
  g.fill(20, 24, 30);
  g.ellipse(184, 55, 13, 13);
  g.fill(255, 255, 255, 220);
  g.ellipse(188, 50, 5, 5);

  return g;
}

function makeBubbleSprite(): p5.Graphics {
  const g = createGraphics(128, 128);
  g.clear();
  g.noStroke();

  for (let r = 62; r > 0; r -= 2) {
    const a = map(r, 62, 0, 6, 95);
    g.fill(180, 225, 255, a);
    g.ellipse(64, 64, r * 2, r * 2);
  }

  g.noFill();
  g.stroke(220, 245, 255, 150);
  g.strokeWeight(3);
  g.ellipse(64, 64, 120, 120);

  g.noStroke();
  g.fill(255, 255, 255, 190);
  g.ellipse(44, 42, 18, 14);

  return g;
}

function makeSkyTexture(): p5.Graphics {
  const g = createGraphics(32, 128);
  g.strokeWeight(1);
  for (let y = 0; y < 128; y++) {
    const u = y / 127;
    const c = lerpColor(
      color(46, 128, 150),
      color(2, 10, 22),
      Math.pow(u, 0.85),
    );
    g.stroke(c);
    g.line(0, y, 32, y);
  }
  return g;
}

function makeSandTexture(): p5.Graphics {
  const g = createGraphics(256, 256);
  g.noStroke();
  g.background(206, 180, 132);
  g.loadPixels();
  for (let i = 0; i < g.width * g.height; i++) {
    const x = i % g.width;
    const y = Math.floor(i / g.width);
    const n = noise(x * 0.04, y * 0.04);
    const c = lerpColor(color(168, 140, 96), color(240, 222, 184), n);
    g.pixels[i * 4 + 0] = red(c);
    g.pixels[i * 4 + 1] = green(c);
    g.pixels[i * 4 + 2] = blue(c);
    g.pixels[i * 4 + 3] = 255;
  }
  g.updatePixels();
  return g;
}

/* ------------------------------ INPUT ----------------------------------- */
function mousePressed(): void {
  if (frontView) return;
  dragging = true;
  lastMX = mouseX;
  lastMY = mouseY;
  idleTime = 0;
}

function mouseDragged(): void {
  if (!dragging || frontView) return;
  camTheta -= (mouseX - lastMX) * 0.006;
  camPhi = constrain(camPhi - (mouseY - lastMY) * 0.004, -0.35, 1.15);
  lastMX = mouseX;
  lastMY = mouseY;
  idleTime = 0;
}

function mouseReleased(): void {
  dragging = false;
}

/* Scroll wheel: up = zoom in, down = zoom out ------------------------------ */
function mouseWheel(event: WheelEvent & { delta: number }): boolean {
  const mouseSign = Math.sign(event.delta);
  if (frontView) {
    // Orthographic zoom: shrink visible area to zoom in.
    frontZoom = constrain(frontZoom * (1 - mouseSign * 0.12), 0.4, 4);
  } else {
    // Perspective zoom: move camera closer / farther.
    camRadius = constrain(camRadius + mouseSign * 90, 400, 2600);
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
