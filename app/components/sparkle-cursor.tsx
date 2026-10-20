import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
};

export function SparkleCursor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -100, y: -100, isHovering: false });
  const particlesRef = useRef<Particle[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 1. Handle resizing
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // 2. Track mouse position globally
    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
      
      // Spawn 1-2 sparkles per movement
      for (let i = 0; i < 2; i++) {
        particlesRef.current.push({
          x: e.clientX + (Math.random() - 0.5) * 10,
          y: e.clientY + (Math.random() - 0.5) * 10,
          vx: (Math.random() - 0.5) * 1.5,
          vy: (Math.random() - 0.5) * 1.5,
          life: 1,
          size: Math.random() * 3 + 1,
        });
      }
    };

    window.addEventListener("mousemove", onMouseMove);

    // 3. Animation Loop
    let animationFrameId: number;
    let rotation = 0;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // --- Draw the main cursor (Holographic Star) ---
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      
      if (mx > 0 && my > 0) {
        ctx.save();
        ctx.translate(mx, my);
        rotation += 0.02;
        ctx.rotate(rotation);

        // Glow effect
        ctx.shadowColor = "#7fd4ff";
        ctx.shadowBlur = 12;

        // Draw star cross
        ctx.fillStyle = "rgba(127, 212, 255, 0.9)";
        const size = 8 + Math.sin(Date.now() * 0.005) * 2;
        
        ctx.beginPath();
        ctx.roundRect(-size, -1.5, size * 2, 3, 2); // Horizontal
        ctx.roundRect(-1.5, -size, 3, size * 2, 2); // Vertical
        ctx.fill();

        // Central white dot
        ctx.fillStyle = "#ffffff";
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(0, 0, 2, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
      }

      // --- Update and Draw the trailing particles ---
      ctx.shadowBlur = 8;
      ctx.shadowColor = "#7fd4ff";

      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.03; // Fade out speed
        p.size *= 0.96; // Shrink

        if (p.life <= 0) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        ctx.fillStyle = `rgba(127, 212, 255, ${p.life * 0.8})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      cancelAnimationFrame(animationFrameId);
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
        pointerEvents: "none", // Crucial: lets clicks pass through to React and p5
        zIndex: 999999,        // Ensures it floats above everything
      }}
    />
  );
}