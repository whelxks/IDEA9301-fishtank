/// <reference types="p5/global" />

import type p5 from "p5";

/* =========================================================================
   AQUARIUM COMMON UTILITIES
   -------------------------------------------------------------------------
   Shared types, camera logic, texture generation, and rendering helpers 
   used across different aquarium sketches.
   ========================================================================= */

/* ------------------------------- TYPES ---------------------------------- */
export type FishSprite = p5.Image | p5.Graphics;

export interface Fish {
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

export interface KelpPoint {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Kelp {
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
  colGradient: p5.Color[];
}

export interface Bubble {
  pos: p5.Vector;
  size: number;
  speed: number;
  phase: number;
  wob: number;
  life: number;
}

export interface Rock {
  x: number;
  z: number;
  s: number;
  r: number;
  c: number;
}

export interface CameraState {
  theta: number;
  phi: number;
  radius: number;
  x: number;
  y: number;
  z: number;
  right: p5.Vector;
  dragging: boolean;
  idleTime: number;
}

/* Quality knob: 5 = chunky, 6 = good (default), 8 = smooth, 12 = very smooth.
   Only affects mesh density; shading quality is unaffected. */
const KELP_RING_SEGS = 6;

/**
 * Instance-mode factory. Call once per sketch with that sketch's p5 instance.
 * Every helper below closes over `p`, so two aquariums can run simultaneously
 * without fighting over globals.
 */
export function createCommon(p: p5) {
  /* ---------------------- SCREEN-SPACE PROJECTION ------------------------ */
  /**
   * Project a world-space point to 2D canvas coordinates.
   * Handles both ortho (front view) and perspective (orbit) modes
   * WITHOUT touching p5 internals — mirrors the same math that
   * `common.updateCamera` feeds into `p.camera(...)` and `p.ortho(...)`.
   */
  function projectToScreen(
    cam: CameraState,
    frontView: boolean,
    frontZoom: number,
    wx: number,
    wy: number,
    wz: number,
  ): { x: number; y: number } {
    if (frontView) {
      const vh = 700 / frontZoom;
      const vw = vh * (p.width / p.height);
      return {
        x: (wx / vw + 0.5) * p.width,
        y: (0.5 + wy / vh) * p.height,
      };
    }
    const ex = cam.x,
      ey = cam.y,
      ez = cam.z;
    let fx = -ex,
      fy = -ey,
      fz = -ez;
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
    fx /= fl;
    fy /= fl;
    fz /= fl;

    // right = normalize(cross(forward, worldUp)) with worldUp = (0,1,0)
    let rx = -fz,
      ry = 0,
      rz = fx;
    const rl = Math.sqrt(rx * rx + rz * rz) || 1;
    rx /= rl;
    ry /= rl;
    rz /= rl;

    // up = cross(right, forward)
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;

    const px = wx - ex,
      py = wy - ey,
      pz = wz - ez;
    const cx = px * rx + py * ry + pz * rz;
    const cy = px * ux + py * uy + pz * uz;
    const cz = px * fx + py * fy + pz * fz;

    if (cz <= 0.001) return { x: -9999, y: -9999 };

    const f = 1 / Math.tan(p.PI / 6);
    const aspect = p.width / p.height;
    const ndcX = ((f / aspect) * cx) / cz;
    const ndcY = (f * cy) / cz;

    return {
      // orbit view
      x: (ndcX + 1) * 0.5 * p.width,
      y: (1 + ndcY) * 0.5 * p.height,
    };
  }

  /* --------------------- SPOTLIGHT / GLOW SPRITE ------------------------- */
  /** Soft radial glow used as a spotlight halo around the selected fish. */
  function makeGlowSprite(): p5.Graphics {
    const size = 512;
    const g = p.createGraphics(size, size);
    g.clear();
    const ctx = (g as any).drawingContext as CanvasRenderingContext2D;
    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    grad.addColorStop(0.0, "rgba(180, 230, 255, 0.85)");
    grad.addColorStop(0.25, "rgba(127, 212, 255, 0.45)");
    grad.addColorStop(0.6, "rgba(80, 160, 220, 0.12)");
    grad.addColorStop(1.0, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return g;
  }

  /**
   * Draw a billboarded additive glow behind the selected fish.
   * Must be called AFTER `gl.clear(DEPTH_BUFFER_BIT)` so it sits on top
   * of the dark overlay and BEFORE `drawFish(...)` so the sprite wins.
   */
  function drawSpotlightGlow(
    f: Fish,
    cam: CameraState,
    frontView: boolean,
    glowImg: p5.Graphics,
  ): void {
    p.push();
    p.translate(f.pos.x, f.pos.y, f.pos.z);

    const vx = frontView ? -cam.x : cam.x - f.pos.x;
    const vy = frontView ? -cam.y : cam.y - f.pos.y;
    const vz = frontView ? -cam.z : cam.z - f.pos.z;
    p.rotateY(Math.atan2(vx, vz));
    p.rotateX(-Math.atan2(vy, Math.sqrt(vx * vx + vz * vz)));

    const pulse = 1 + Math.sin(p.frameCount * 0.08) * 0.06; // gentle breathing
    const glowSize = f.size * 4.2 * pulse;

    p.blendMode(p.ADD);
    p.noStroke();
    p.texture(glowImg);
    p.plane(glowSize, glowSize);
    p.blendMode(p.BLEND);

    p.pop();
  }

  /* ------------------------- CAMERA & MATH -------------------------------- */
  function updateCamera(
    cam: CameraState,
    frontView: boolean,
    frontZoom: number,
    updateIdle = true, // NEW: spotlight pass reuses the camera without double-advancing idle
  ): void {
    if (frontView) {
      const vh = 700 / frontZoom;
      const vw = vh * (p.width / p.height);
      p.ortho(-vw / 2, vw / 2, -vh / 2, vh / 2, 10, 7000);
    } else {
      p.perspective(p.PI / 3, p.width / p.height, 10, 7000);
    }

    if (updateIdle && !cam.dragging && !frontView) {
      cam.idleTime += Math.min(p.deltaTime, 50) * 0.001;
      if (cam.idleTime > 3) cam.theta += 0.0016;
    }

    const cr = cam.radius * Math.cos(cam.phi);
    cam.x = cr * Math.sin(cam.theta);
    cam.y = -cam.radius * Math.sin(cam.phi);
    cam.z = cr * Math.cos(cam.theta);

    p.camera(cam.x, cam.y, cam.z, 0, 0, 0, 0, 1, 0);

    const fx = -cam.x,
      fy = -cam.y,
      fz = -cam.z;
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
    const ux = fx / fl,
      uz = fz / fl;
    cam.right = p.createVector(-uz, 0, ux).normalize();
  }

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
      p.loadImage(
        file,
        (img) => {
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

  function enterFromEdge(f: Fish, tankW: number, tankD: number): void {
    const hw = tankW * 0.45;
    const hd = tankD * 0.45;

    switch (Math.floor(p.random(4))) {
      case 0:
        f.pos.set(-hw, p.random(-120, 110), p.random(-hd, hd));
        break;
      case 1:
        f.pos.set(hw, p.random(-120, 110), p.random(-hd, hd));
        break;
      case 2:
        f.pos.set(p.random(-hw, hw), p.random(-120, 110), -hd);
        break;
      default:
        f.pos.set(p.random(-hw, hw), p.random(-120, 110), hd);
        break;
    }

    f.baseY = f.pos.y;
    const dir = p.createVector(-f.pos.x, 0, -f.pos.z);
    if (dir.magSq() < 1e-4) dir.set(1, 0, 0);
    f.vel = dir.normalize().mult(f.speed);
  }

  /* ------------------------- ENVIRONMENT RENDERING ------------------------ */
  function drawFloor(
    tankW: number,
    tankD: number,
    floorY: number,
    sandImg: p5.Graphics,
  ): void {
    p.push();
    p.translate(0, floorY + 24, 0);
    p.noStroke();
    p.fill(60, 50, 40);
    p.box(tankW, 48, tankD);
    p.pop();

    p.push();
    p.translate(0, floorY - 0.5, 0);
    p.rotateX(p.HALF_PI);
    p.noStroke();
    p.texture(sandImg);
    p.plane(tankW, tankD);
    p.pop();
  }

  function drawCaustics(
    t: number,
    tankW: number,
    tankD: number,
    floorY: number,
  ): void {
    p.push();
    p.translate(0, floorY - 1.4, 0);
    p.rotateX(p.HALF_PI);
    p.noStroke();
    p.blendMode(p.ADD);
    for (let i = 0; i < 8; i++) {
      const ph = t * 0.25 + i * 1.7;
      const x = Math.sin(ph * 0.7 + i) * tankW * 0.32;
      const y = Math.cos(ph * 0.53 + i * 2.1) * tankD * 0.32;
      const s = 140 + 70 * Math.sin(ph * 1.3 + i);
      p.fill(70, 140, 150, 10);
      p.ellipse(x, y, s * 1.7, s);
    }
    p.blendMode(p.BLEND);
    p.pop();
  }

  function drawRocks(rocks: Rock[], floorY: number): void {
    p.noStroke();
    for (const r of rocks) {
      p.push();
      p.translate(r.x, floorY - r.s * 0.35, r.z);
      p.rotateY(r.r);
      p.fill(r.c, r.c * 0.9, r.c * 0.78);
      p.sphere(r.s, 8, 6);
      p.pop();
    }
  }

  function drawGlass(tankW: number, tankH: number, tankD: number): void {
    p.push();
    p.noFill();
    p.stroke(150, 215, 245, 20);
    p.strokeWeight(1.5);
    p.box(tankW, tankH, tankD);
    p.pop();
  }

  function drawKelp(
    k: Kelp,
    camRight: p5.Vector,
    t: number,
    floorY: number,
    droop = 0.02,
  ): void {
    const n = k.segs;

    /* ── Spine (unchanged) ─────────────────────────────────────────── */
    const pts: KelpPoint[] = [];
    let px = k.x,
      py = floorY,
      pz = k.z;
    let ang = 0;
    const dirA = k.dir + Math.sin(t * 0.17 + k.phase) * 0.6;
    const dx = Math.cos(dirA),
      dz = Math.sin(dirA);

    pts.push({ x: px, y: py, z: pz, w: k.width0 });
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      ang +=
        Math.sin(t * k.speed + k.phase + i * 0.55) * 0.17 * (0.35 + u * 1.2);
      ang += droop;
      px += Math.sin(ang) * k.segLen * dx;
      pz += Math.sin(ang) * k.segLen * dz;
      py -= Math.cos(ang) * k.segLen;
      pts.push({ x: px, y: py, z: pz, w: k.width0 * (1 - u * 0.86) });
    }
    k.tip = pts[n];

    /* ── Tangents ──────────────────────────────────────────────────── */
    const tanX: number[] = [],
      tanY: number[] = [],
      tanZ: number[] = [];
    for (let i = 0; i <= n; i++) {
      let tx: number, ty: number, tz: number;
      if (i === 0) {
        tx = pts[1].x - pts[0].x;
        ty = pts[1].y - pts[0].y;
        tz = pts[1].z - pts[0].z;
      } else if (i === n) {
        tx = pts[n].x - pts[n - 1].x;
        ty = pts[n].y - pts[n - 1].y;
        tz = pts[n].z - pts[n - 1].z;
      } else {
        tx = pts[i + 1].x - pts[i - 1].x;
        ty = pts[i + 1].y - pts[i - 1].y;
        tz = pts[i + 1].z - pts[i - 1].z;
      }
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tanX.push(tx / tl);
      tanY.push(ty / tl);
      tanZ.push(tz / tl);
    }

    /* ── Parallel-transported frames (no twist) ───────────────────── */
    const t0x = tanX[0],
      t0y = tanY[0],
      t0z = tanZ[0];
    let refX = 1,
      refY = 0,
      refZ = 0;
    if (Math.abs(t0x) > 0.9) {
      refX = 0;
      refZ = 1;
    }
    let r0x = refY * t0z - refZ * t0y;
    let r0y = refZ * t0x - refX * t0z;
    let r0z = refX * t0y - refY * t0x;
    const r0l = Math.sqrt(r0x * r0x + r0y * r0y + r0z * r0z) || 1;
    r0x /= r0l;
    r0y /= r0l;
    r0z /= r0l;

    const frx: number[] = [],
      fry: number[] = [],
      frz: number[] = [];
    const ffx: number[] = [],
      ffy: number[] = [],
      ffz: number[] = [];
    let curRx = r0x,
      curRy = r0y,
      curRz = r0z;
    for (let i = 0; i <= n; i++) {
      const tx = tanX[i],
        ty = tanY[i],
        tz = tanZ[i];
      const dotRT = curRx * tx + curRy * ty + curRz * tz;
      let rx = curRx - dotRT * tx;
      let ry = curRy - dotRT * ty;
      let rz = curRz - dotRT * tz;
      const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
      rx /= rl;
      ry /= rl;
      rz /= rl;

      frx.push(rx);
      fry.push(ry);
      frz.push(rz);
      ffx.push(ty * rz - tz * ry);
      ffy.push(tz * rx - tx * rz);
      ffz.push(tx * ry - ty * rx);
      curRx = rx;
      curRy = ry;
      curRz = rz;
    }

    /* ── Ring vertices: position + brightness, one flat array each ─ */
    const N = KELP_RING_SEGS;
    const TAU = Math.PI * 2;

    const cosJ = new Float32Array(N);
    const sinJ = new Float32Array(N);
    for (let j = 0; j < N; j++) {
      const th = (j / N) * TAU;
      cosJ[j] = Math.cos(th);
      sinJ[j] = Math.sin(th);
    }

    // Fixed world-space light (top-left, slightly toward camera).
    const lnx = 0.36,
      lny = -0.9,
      lnz = 0.27;

    const pos = new Float32Array((n + 1) * N * 3);
    const bri = new Float32Array((n + 1) * N);

    for (let i = 0; i <= n; i++) {
      const P = pts[i];
      const radius = P.w * 0.5;
      const rxi = frx[i],
        ryi = fry[i],
        rzi = frz[i];
      const fxi = ffx[i],
        fyi = ffy[i],
        fzi = ffz[i];

      for (let j = 0; j < N; j++) {
        const c = cosJ[j],
          s = sinJ[j];
        const nx = c * rxi + s * fxi;
        const ny = c * ryi + s * fyi;
        const nz = c * rzi + s * fzi;

        const vi = (i * N + j) * 3;
        pos[vi] = P.x + nx * radius;
        pos[vi + 1] = P.y + ny * radius;
        pos[vi + 2] = P.z + nz * radius;

        const d = nx * lnx + ny * lny + nz * lnz;
        bri[i * N + j] = 0.5 + 0.5 * (d > 0 ? d : 0);
      }
    }

    /* ── ONE draw call: all stem + leaf triangles ─────────────────── */
    p.beginShape(p.TRIANGLES);

    // Stems
    for (let i = 0; i < n; i++) {
      const base = k.colGradient[i];
      const br = p.red(base),
        bg = p.green(base),
        bb = p.blue(base);

      for (let j = 0; j < N; j++) {
        const j1 = (j + 1) % N;
        const i00 = i * N + j;
        const i01 = i * N + j1;
        const i10 = (i + 1) * N + j;
        const i11 = (i + 1) * N + j1;

        const a = i00 * 3,
          b = i01 * 3,
          c = i11 * 3,
          d = i10 * 3;
        const sa = bri[i00],
          sb = bri[i01],
          sc = bri[i11],
          sd = bri[i10];

        // Tri 1: a → b → c
        p.fill(br * sa, bg * sa, bb * sa);
        p.vertex(pos[a], pos[a + 1], pos[a + 2]);
        p.fill(br * sb, bg * sb, bb * sb);
        p.vertex(pos[b], pos[b + 1], pos[b + 2]);
        p.fill(br * sc, bg * sc, bb * sc);
        p.vertex(pos[c], pos[c + 1], pos[c + 2]);

        // Tri 2: a → c → d
        p.fill(br * sa, bg * sa, bb * sa);
        p.vertex(pos[a], pos[a + 1], pos[a + 2]);
        p.fill(br * sc, bg * sc, bb * sc);
        p.vertex(pos[c], pos[c + 1], pos[c + 2]);
        p.fill(br * sd, bg * sd, bb * sd);
        p.vertex(pos[d], pos[d + 1], pos[d + 2]);
      }
    }

    // Leaves — same batch, same draw call
    // Leaves — same batch, same draw call.
    //
    // Two parameters now drive leaf geometry:
    //   1. heightScale — leaf LENGTH scales with the total spine height
    //      (k.segs * k.segLen), so a short wilted kelp (≈60–120 px) gets
    //      proportionally small leaves instead of oversized spikes, and a
    //      tall healthy kelp (≈180–330 px) keeps its original proportions.
    //   2. leafDroop   — extra downward ANGLE per unit of `droop` beyond
    //      the healthy baseline of 0.02. Healthy kelp leaves are unchanged
    //      (drop = 0.55 * len), wilted kelp leaves flop down
    //      (drop = 1.15 * len at droop = 0.06).
    const kelpHeight = k.segs * k.segLen;
    const heightScale = kelpHeight / 250; // ~0.24 wilted → ~1.32 healthy
    const leafDroop = Math.max(0, droop - 0.02) * 15; // 0 healthy → 0.6 wilted

    const crx = camRight.x,
      crz = camRight.z;
    for (let i = 2; i < n - 1; i += 2) {
      const a = pts[i];
      const base = k.colGradient[i];
      const side = i % 4 === 0 ? 1 : -1;

      // Base length × heightScale (proportional to the spine's total height)
      const len = (26 + 20 * Math.sin(i * 1.7 + k.phase)) * heightScale;
      // Tip drop × (baseline flop + droop-driven flop)
      const tipDrop = len * (0.55 + leafDroop);

      const leafCol = p.lerpColor(base, p.color(255, 232, 150), 0.3);
      p.fill(leafCol);

      p.vertex(a.x, a.y, a.z);
      p.vertex(
        a.x + crx * side * a.w * 0.45,
        a.y + 2,
        a.z + crz * side * a.w * 0.45,
      );
      p.vertex(a.x + crx * side * len, a.y - tipDrop, a.z + crz * side * len);
    }

    p.endShape();
  }

  function drawFish(
    f: Fish,
    camState: CameraState,
    frontView: boolean,
    t: number,
    isHighlighted: boolean = false,
    opacity: number = 1, // reused, now drives the ALPHA channel
  ): void {
    p.push();
    p.translate(f.pos.x, f.pos.y, f.pos.z);

    let vx: number, vy: number, vz: number;
    if (frontView) {
      vx = -camState.x;
      vy = -camState.y;
      vz = -camState.z;
    } else {
      vx = camState.x - f.pos.x;
      vy = camState.y - f.pos.y;
      vz = camState.z - f.pos.z;
    }
    p.rotateY(Math.atan2(vx, vz));
    p.rotateX(-Math.atan2(vy, Math.sqrt(vx * vx + vz * vz)));

    const fishDot = f.vel.x * camState.right.x + f.vel.z * camState.right.z;
    const flip = fishDot < 0 ? -1 : 1;
    const sy = 1 + Math.sin(t * 9 + f.fin) * 0.05;
    const scaleFactor = isHighlighted ? 1.15 : 1;

    p.scale(
      flip * f.size * 0.5 * scaleFactor,
      f.size * 0.5 * sy * scaleFactor,
      1,
    );
    p.noStroke();
    p.texture(f.img);

    // Ambient brightness stays at 180 (unchanged look); the 4th argument
    // is the alpha channel, so low counts make the fish see-through.
    const alpha = Math.round(255 * Math.max(0, Math.min(1, opacity)));
    p.tint(180, 180, 180, alpha);

    const gl = p.drawingContext as unknown as WebGL2RenderingContext;
    gl.depthMask(false);
    p.plane(2, 1);
    gl.depthMask(true);

    p.noTint();
    p.pop();
  }

  function drawAllBubbles(
    bubbles: Bubble[],
    bubbleImg: p5.Graphics,
    camState: CameraState,
    t: number,
    dt: number,
    tankW: number,
    tankD: number,
    floorY: number,
    topY: number,
  ): void {
    if (bubbles.length < 85 && p.random() < 0.02) {
      bubbles.push({
        pos: p.createVector(
          p.random(-tankW * 0.4, tankW * 0.4),
          floorY - 4,
          p.random(-tankD * 0.4, tankD * 0.4),
        ),
        size: p.random(3, 8),
        speed: p.random(26, 58),
        phase: p.random(p.TWO_PI),
        wob: p.random(6, 20),
        life: 0,
      });
    }

    p.noStroke();
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.pos.y -= b.speed * dt;
      b.pos.x += Math.sin(t * 1.7 + b.phase) * b.wob * dt;
      b.pos.z += Math.cos(t * 1.3 + b.phase) * b.wob * dt;
      b.life += dt;

      if (b.pos.y < topY + 4 || b.life > 22) {
        bubbles.splice(i, 1);
        continue;
      }

      const dx = camState.x - b.pos.x,
        dy = camState.y - b.pos.y,
        dz = camState.z - b.pos.z;
      const bbAlpha = p.map(b.pos.y, topY, topY + 90, 0, 200, true);

      p.push();
      p.translate(b.pos.x, b.pos.y, b.pos.z);
      p.rotateY(Math.atan2(dx, dz));
      p.rotateX(-Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)));
      p.texture(bubbleImg);
      p.tint(255, bbAlpha);
      p.plane(b.size, b.size);
      p.noTint();
      p.pop();
    }
  }

  /* --------------------------- TEXTURE FACTORIES -------------------------- */
  type RGB = [number, number, number];

  function makeFishSprite(bodyC: RGB, finC: RGB, tailC: RGB): p5.Graphics {
    const g = p.createGraphics(256, 128);
    g.clear();
    g.noStroke();

    g.fill(tailC[0], tailC[1], tailC[2], 235);
    g.beginShape();
    g.vertex(56, 64);
    g.vertex(8, 20);
    g.vertex(20, 64);
    g.vertex(8, 108);
    g.endShape(p.CLOSE);

    g.fill(finC[0], finC[1], finC[2], 225);
    g.beginShape();
    g.vertex(112, 30);
    g.vertex(136, 6);
    g.vertex(168, 32);
    g.endShape(p.CLOSE);
    g.beginShape();
    g.vertex(118, 96);
    g.vertex(140, 122);
    g.vertex(168, 94);
    g.endShape(p.CLOSE);

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
    const g = p.createGraphics(128, 128);
    g.clear();
    g.noStroke();
    for (let r = 62; r > 0; r -= 2) {
      g.fill(180, 225, 255, p.map(r, 62, 0, 6, 95));
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
    const g = p.createGraphics(32, 128);
    g.strokeWeight(1);
    for (let y = 0; y < 128; y++) {
      const u = y / 127;
      const c = p.lerpColor(
        p.color(20, 60, 80),
        p.color(2, 10, 22),
        Math.pow(u, 0.85),
      );
      g.stroke(c);
      g.line(0, y, 32, y);
    }
    return g;
  }

  function makeSandTexture(): p5.Graphics {
    const g = p.createGraphics(256, 256);
    g.noStroke();
    g.background(160, 140, 100);
    g.loadPixels();
    for (let i = 0; i < g.width * g.height; i++) {
      const x = i % g.width;
      const y = Math.floor(i / g.width);
      const n = p.noise(x * 0.04, y * 0.04);
      const c = p.lerpColor(p.color(120, 100, 70), p.color(190, 170, 130), n);
      g.pixels[i * 4 + 0] = p.red(c);
      g.pixels[i * 4 + 1] = p.green(c);
      g.pixels[i * 4 + 2] = p.blue(c);
      g.pixels[i * 4 + 3] = 255;
    }
    g.updatePixels();
    return g;
  }

  return {
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
    projectToScreen,
    makeGlowSprite,
    drawSpotlightGlow,
  };
}

/**
 * In p5 instance mode, mouse/wheel events fire on `window`, not on the canvas.
 * `p.mouseX` / `p.mouseY` are canvas-relative (and NOT clamped), so a simple
 * bounds check rejects events that landed on the other pane's canvas.
 */
export function isInsideCanvas(p: p5): boolean {
  return (
    p.mouseX >= 0 &&
    p.mouseX <= p.width &&
    p.mouseY >= 0 &&
    p.mouseY <= p.height
  );
}
