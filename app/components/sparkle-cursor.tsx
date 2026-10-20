import { useEffect, useRef } from "react";

const POOL_SIZE = 90;
const SPAWN_EVERY_PX = 14; // distance between spawns (distance-based, not event-based)

type Particle = {
  alive: boolean;
  sparkle: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  phase: number;
};

/** Pre-render a sprite once; drawImage is far cheaper than redrawing paths. */
function makeSprite(draw: (c: CanvasRenderingContext2D, s: number) => void) {
  const s = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  draw(cv.getContext("2d")!, s);
  return cv;
}

const bubbleSprite = () =>
  makeSprite((c, s) => {
    const m = s / 2;
    const g = c.createRadialGradient(m, m, s * 0.18, m, m, m - 2);
    g.addColorStop(0, "rgba(170,230,255,0)");
    g.addColorStop(1, "rgba(170,230,255,0.4)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(m, m, m - 2, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(225,248,255,0.9)";
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.9)"; // highlight
    c.beginPath();
    c.ellipse(m - 11, m - 12, 7, 4.5, -0.6, 0, Math.PI * 2);
    c.fill();
  });

const sparkleSprite = () =>
  makeSprite((c, s) => {
    const m = s / 2;
    const glow = c.createRadialGradient(m, m, 0, m, m, m);
    glow.addColorStop(0, "rgba(200,240,255,0.55)");
    glow.addColorStop(1, "rgba(127,212,255,0)");
    c.fillStyle = glow;
    c.fillRect(0, 0, s, s);

    c.fillStyle = "#ffffff"; // 4-point star
    c.beginPath();
    c.moveTo(m, 4);
    c.quadraticCurveTo(m, m, s - 4, m);
    c.quadraticCurveTo(m, m, m, s - 4);
    c.quadraticCurveTo(m, m, 4, m);
    c.quadraticCurveTo(m, m, m, 4);
    c.fill();
  });

export function SparkleCursor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Skip on touch devices and for users who prefer reduced motion.
    if (
      window.matchMedia("(pointer: coarse)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const bubble = bubbleSprite();
    const sparkle = sparkleSprite();

    // Fixed pool: no allocations or splice() in the hot path.
    const pool: Particle[] = Array.from({ length: POOL_SIZE }, () => ({
      alive: false,
      sparkle: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      age: 0,
      life: 1,
      size: 8,
      phase: 0,
    }));
    let cursor = 0;

    let W = 0,
      H = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const mouse = {
      x: -100,
      y: -100,
      lastX: -100,
      lastY: -100,
      visible: false,
    };
    let lastMove = 0;
    let raf = 0;
    let lastT = 0;
    let acc = 0;

    const spawn = (x: number, y: number) => {
      const p = pool[cursor];
      cursor = (cursor + 1) % POOL_SIZE;
      const isSparkle = Math.random() < 0.4;
      p.alive = true;
      p.sparkle = isSparkle;
      p.x = x + (Math.random() - 0.5) * 10;
      p.y = y + (Math.random() - 0.5) * 10;
      p.age = 0;
      p.phase = Math.random() * Math.PI * 2;
      if (isSparkle) {
        p.vx = (Math.random() - 0.5) * 0.6;
        p.vy = (Math.random() - 0.5) * 0.6;
        p.life = 0.6 + Math.random() * 0.4;
        p.size = 8 + Math.random() * 8;
      } else {
        p.vx = (Math.random() - 0.5) * 0.4;
        p.vy = -(0.5 + Math.random() * 0.8); // bubbles drift upward
        p.life = 0.9 + Math.random() * 0.7;
        p.size = 5 + Math.random() * 8;
      }
    };

    const onMove = (e: PointerEvent) => {
      const nx = e.clientX,
        ny = e.clientY;
      if (!mouse.visible) {
        mouse.lastX = nx;
        mouse.lastY = ny;
        mouse.visible = true;
      }
      // Spawn along the path so fast swipes leave a continuous trail.
      const dx = nx - mouse.lastX,
        dy = ny - mouse.lastY;
      const dist = Math.hypot(dx, dy);
      acc += dist;
      let spawned = 0;
      while (acc >= SPAWN_EVERY_PX && spawned < 4) {
        acc -= SPAWN_EVERY_PX;
        const k = dist > 0 ? 1 - acc / dist : 1;
        spawn(mouse.lastX + dx * k, mouse.lastY + dy * k);
        spawned++;
      }
      if (acc > SPAWN_EVERY_PX) acc = 0;

      mouse.lastX = mouse.x = nx;
      mouse.lastY = mouse.y = ny;
      lastMove = performance.now();
      if (!raf) {
        lastT = lastMove;
        raf = requestAnimationFrame(tick);
      }
    };

    const onLeave = () => {
      mouse.visible = false;
      ctx.clearRect(0, 0, W, H);
    };

    const tick = (now: number) => {
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;
      const step = dt * 60; // normalise to 60fps so 144Hz screens match

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter"; // cheap glow, no shadowBlur

      let alive = 0;
      for (let i = 0; i < POOL_SIZE; i++) {
        const p = pool[i];
        if (!p.alive) continue;
        p.age += dt;
        const t = p.age / p.life;
        if (t >= 1) {
          p.alive = false;
          continue;
        }
        alive++;

        p.x += p.vx * step;
        p.y += p.vy * step;

        if (p.sparkle) {
          // twinkle: grow then shrink, fade out
          const s = p.size * Math.sin(Math.PI * t);
          ctx.globalAlpha = 1 - t * 0.6;
          ctx.drawImage(sparkle, p.x - s, p.y - s, s * 2, s * 2);
        } else {
          p.x += Math.sin(p.age * 5 + p.phase) * 0.35 * step; // wobble
          const fadeIn = Math.min(1, t * 6);
          ctx.globalAlpha = fadeIn * (1 - t) * 0.9;
          const s = p.size * (0.8 + t * 0.4); // bubbles swell slightly
          ctx.drawImage(bubble, p.x - s, p.y - s, s * 2, s * 2);
        }
      }

      // Cursor head: a pulsing, slowly rotating star.
      if (mouse.visible) {
        const pulse = 13 + Math.sin(now * 0.005) * 2.5;
        ctx.save();
        ctx.translate(mouse.x, mouse.y);
        ctx.rotate(now * 0.0008);
        ctx.globalAlpha = 0.95;
        ctx.drawImage(sparkle, -pulse, -pulse, pulse * 2, pulse * 2);
        ctx.restore();
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      // Idle: stop the loop entirely until the pointer moves again.
      if (alive > 0 || now - lastMove < 200) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", resize);
    document.documentElement.addEventListener("mouseleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", resize);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 999999,
      }}
    />
  );
}
