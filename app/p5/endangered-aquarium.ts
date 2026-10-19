/// <reference path="../../node_modules/@types/p5/global.d.ts" />

import type p5 from "p5";
import {
  getExistingEndangeredFish,
  type EndangeredFishRow,
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
   • Focuses on ENDANGERED FISH species from Supabase
     (`history_of_endangered_fish`).
   • Data is treated as STATIC per page-load: we fetch once in setup() and
     never rebuild. A page refresh is required to reflect DB changes
     (new species discovered, population updated, or a species declared
     extinct). TODO: swap in a poll / manual refresh button later.
   • Kelp and rocks are wilted and short, reflecting poor ocean conditions.
   • Fish are clickable. Clicking a fish fades the background and spotlights
     the fish with a callout showing its species, fun fact, and population
     history.
   ========================================================================= */

/* ------------------------------ CONFIG ---------------------------------- */
const TANK = { w: 780, h: 460, d: 460, floorY: 230, topY: -230 };

const MIN_FISH = 9; // pad the tank with filler if the DB has fewer rows
const NO_IMG_FISH = 9; // school size when no rows at all / fetch fails

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
let frontZoom = 1;
let savedTheta = 0.7;
let savedPhi = 0.16;
let savedRadius = 1080;
let viewBtn: p5.Element;

/* Interaction state */
let selectedFish: EndangeredFish | null = null;
let calloutDiv: p5.Element;

let fallbackFishImgs: p5.Graphics[] = [];

const fishes: EndangeredFish[] = [];
const kelps: Kelp[] = [];
const bubbles: Bubble[] = [];
const rocks: Rock[] = [];

let bubbleImg: p5.Graphics;
let skyImg: p5.Graphics;
let sandImg: p5.Graphics;
let t = 0;

let runId = 0;

/* ------------------------------- TYPES ---------------------------------- */
interface EndangeredFish extends Fish {
  id: string;
  species: string;
  funFact: string;
  populationHistory: { count: number; month: string }[];
}

/* ------------------------- STATE RESET ---------------------------- */
/** Module state survives unmount (ES modules are cached), so wipe it. */
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

  selectedFish = null;
  if (calloutDiv) calloutDiv.hide();
}

export function customCleanup(): void {
  runId++; // invalidates any in-flight fetch / image load
  if (calloutDiv) calloutDiv.remove();
}

/* ------------------------- FISH LOADING / SPAWN ------------------------- */

function makeFallbackFish(): EndangeredFish {
  return makeFish(
    fallbackFishImgs[fishes.length % fallbackFishImgs.length],
    undefined,
  );
}

function makeFish(img: FishSprite, row?: EndangeredFishRow): EndangeredFish {
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
    id: row?.id ?? `fallback-${Math.random()}`,
    species: row?.species ?? "Data Pending",
    funFact: row?.fun_fact ?? "No information available for this entry.",
    populationHistory: row?.population_history ?? [],
  };
}

function randomFallbackSprite(): FishSprite {
  return fallbackFishImgs[fishes.length % fallbackFishImgs.length];
}

/* ------------------------------- SETUP ---------------------------------- */
function setup(): void {
  resetState();
  runId++;

  createCanvas(windowWidth, windowHeight, WEBGL);
  perspective(PI / 3, width / height, 10, 7000);
  strokeCap(ROUND);

  camState.right = createVector(1, 0, 0); // p5 is ready now, safe to initialize

  // --- Callout UI Overlay -------------------------------------------------
  calloutDiv = createDiv("");
  calloutDiv.id("fish-callout");
  calloutDiv.style("position", "absolute");
  calloutDiv.style("display", "none");
  calloutDiv.style("background", "rgba(10, 34, 51, 0.95)");
  calloutDiv.style("color", "#fff");
  calloutDiv.style("border", "1px solid #2a6a99");
  calloutDiv.style("border-radius", "8px");
  calloutDiv.style("padding", "20px");
  calloutDiv.style("font-family", "sans-serif");
  calloutDiv.style("max-width", "320px");
  calloutDiv.style("pointer-events", "none");
  calloutDiv.style("z-index", "1000");
  calloutDiv.style("box-shadow", "0 4px 20px rgba(0,0,0,0.5)");

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

  // --- Fetch rows once, then build the tank ------------------------------
  void loadExistingFish(runId);

  // --- Kelp (Wilted & Shorter) ---------------------------------------------
  for (let i = 0; i < 12; i++) {
    kelps.push(
      makeWiltedKelp(
        random(-TANK.w * 0.44, TANK.w * 0.44),
        random(-TANK.d * 0.44, TANK.d * 0.44),
      ),
    );
  }

  // --- Rocks (Smaller & Darker) --------------------------------------------
  for (let i = 0; i < 7; i++) {
    rocks.push({
      x: random(-TANK.w * 0.42, TANK.w * 0.42),
      z: random(-TANK.d * 0.42, TANK.d * 0.42),
      s: random(15, 40), // Smaller
      r: random(TWO_PI),
      c: random(30, 60), // Darker
    });
  }

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

function makeWiltedKelp(x: number, z: number): Kelp {
  const segs = 10;
  const h = random(60, 120); // Much shorter
  const colA = color(96, 58, 12);
  const colB = color(255, 196, 62);
  return {
    x,
    z,
    segs,
    segLen: h / segs,
    width0: random(8, 16), // Thinner
    phase: random(TWO_PI),
    speed: random(0.3, 0.6), // Slower sway
    sway: random(0.1, 0.2), // Less sway
    dir: random(TWO_PI),
    colA: color(60, 50, 20), // Wilted brownish-green
    colB: color(140, 110, 40),
    colGradient: Array.from({ length: segs }, (_, i) =>
      lerpColor(colA, colB, Math.pow(i / segs, 0.65)),
    ),
    tip: null,
  };
}

/* ------------------- STATIC DATA LOAD ------------------ */

/**
 * Fetch every endangered-fish row ONCE, load its image, and spawn it.
 * No realtime. No buffering. Just: fetch → load → build.
 *
 * If the initial fetch fails or returns nothing, we fall back to a small
 * school of procedurally-drawn fish so the tank is never empty.
 */
async function loadExistingFish(run: number): Promise<void> {
  let rows: EndangeredFishRow[] = [];
  try {
    rows = (await getExistingEndangeredFish()) ?? [];
    console.log(rows);
  } catch (err) {
    console.warn("[aquarium] getExistingEndangeredFish failed:", err);
  }

  if (run !== runId) return;

  // No rows at all → fill the tank with filler sprites.
  if (rows.length === 0) {
    for (let i = 0; i < NO_IMG_FISH; i++) {
      fishes.push(makeFallbackFish());
    }
    return;
  }

  // Load each row's image in parallel. A fish is created as each image
  // settles (loaded or failed), preserving that row's data in both cases.
  const loads = rows.map(
    (row) =>
      new Promise<void>((resolve) => {
        if (!row.image_url) {
          fishes.push(makeFish(randomFallbackSprite(), row));
          resolve();
          return;
        }
        loadImage(
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
  if (run !== runId) return;

  // Pad the tank to MIN_FISH so a sparse DB doesn't feel empty.
  while (fishes.length < MIN_FISH) {
    fishes.push(makeFallbackFish());
  }
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

  // Kelp
  noStroke();
  for (const k of kelps) {
    drawKelp(k, camState.right, t, TANK.floorY);
  }

  // Fish movement + sorted render (skip the selected one — it's drawn last)
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
    drawFish(f, camState, frontView, t);
  }

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

  // --- Spotlight / Selection Logic ---------------------------------------
  if (selectedFish) {
    // 1. Dark overlay (2D, in front of everything drawn so far).
    push();
    resetMatrix();
    noStroke();
    fill(0, 0, 0, 180);
    rect(-width / 2, -height / 2, width, height);
    pop();

    // 2. Redraw the selected fish on top, dimming the rest of the tank.
    push();
    drawingContext.clear(drawingContext.DEPTH_BUFFER_BIT);
    drawFish(selectedFish, camState, frontView, t, true);
    pop();

    // 3. Reposition the callout to track the fish.
    updateCalloutPosition();
  }
}

/* ------------------------------ FISH MOTION ---------------------------- */
function updateFishMovement(dt: number): void {
  const fishStep = Math.min(dt * 60, 2.5);

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

    f.pos.add(f.vel.copy().mult(fishStep));
  }
}

/* ------------------------------ INPUT ----------------------------------- */
function mousePressed(): void {
  // Check for fish click first
  let clickedFish: EndangeredFish | null = null;

  for (const f of fishes) {
    // @ts-ignore - screenPosition is available in WEBGL global mode
    const screenPos = screenPosition(f.pos.x, f.pos.y, f.pos.z);
    const d = dist(mouseX, mouseY, screenPos.x, screenPos.y);

    if (d < f.size * 0.6) {
      clickedFish = f;
      break;
    }
  }

  if (clickedFish) {
    selectedFish = clickedFish;
    showCallout(clickedFish);
    return;
  }

  // If clicking empty space, deselect
  if (selectedFish) {
    selectedFish = null;
    calloutDiv.hide();
    return;
  }

  if (frontView) return;
  camState.dragging = true;
  camState.idleTime = 0;
}

function showCallout(f: EndangeredFish): void {
  const popRows =
    f.populationHistory.length > 0
      ? f.populationHistory
          .map(
            (d) =>
              `<li style="margin: 2px 0;">${d.month}: ${d.count.toLocaleString()} individuals</li>`,
          )
          .join("")
      : "<li>No population data available.</li>";

  calloutDiv.html(`
    <h2 style="margin: 0 0 10px 0; color: #7fd4ff; font-size: 18px;">${f.species}</h2>
    <div style="font-size: 13px; line-height: 1.5; color: #ccc;">
      <p style="margin: 0 0 10px 0;"><strong>Fun Fact:</strong> ${f.funFact}</p>
      <div><strong>Population History:</strong>
        <ul style="margin: 4px 0 0 0; padding-left: 20px;">${popRows}</ul>
      </div>
    </div>
    <div style="margin-top: 15px; font-size: 11px; color: #666; text-align: center;">
      Click anywhere to close
    </div>
  `);
  calloutDiv.show();
}

function updateCalloutPosition(): void {
  if (!selectedFish) return;

  // @ts-ignore
  const screenPos = screenPosition(
    selectedFish.pos.x,
    selectedFish.pos.y,
    selectedFish.pos.z,
  );

  let cx = screenPos.x + 60;
  let cy = screenPos.y - 100;

  const margin = 20;
  const rect = calloutDiv.elt.getBoundingClientRect();

  if (cx + rect.width > width - margin) cx = screenPos.x - rect.width - 20;
  if (cy + rect.height > height - margin) cy = height - rect.height - margin;
  if (cy < margin) cy = margin;
  if (cx < margin) cx = margin;

  calloutDiv.position(cx, cy);
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

function mouseWheel(event: WheelEvent & { delta: number }): boolean {
  const mouseSign = Math.sign(event.delta);
  if (frontView) {
    frontZoom = constrain(frontZoom * (1 - mouseSign * 0.12), 0.4, 4);
  } else {
    camState.radius = constrain(camState.radius + mouseSign * 90, 400, 2600);
  }
  return false;
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
