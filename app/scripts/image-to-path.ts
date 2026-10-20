async function imageToPath(url: string, eye = { x: 0.7, y: 0.4 }, tolerance = 1.5) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();

  // downscale so tracing is fast and the result isn't noisy
  const W = 200, H = Math.round((img.height / img.width) * W);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < H && data[(y * W + x) * 4 + 3] >= 128;

  // --- Moore-neighbour boundary trace (outer contour only) ---
  let sx = -1, sy = -1;
  outer: for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (solid(x, y)) { sx = x; sy = y; break outer; }
  if (sx < 0) throw new Error("no opaque pixels found");

  const dirs = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  const pts: [number, number][] = [[sx, sy]];
  let x = sx, y = sy, start = 4;
  for (let guard = 0; guard < W * H * 4; guard++) {
    let moved = false;
    for (let i = 0; i < 8; i++) {
      const k = (start + i) % 8;
      const nx = x + dirs[k][0], ny = y + dirs[k][1];
      if (solid(nx, ny)) {
        x = nx; y = ny; start = (k + 6) % 8; moved = true;
        break;
      }
    }
    if (!moved || (x === sx && y === sy)) break;
    pts.push([x, y]);
  }

  // --- Ramer–Douglas–Peucker simplification ---
  const perp = (p: number[], a: number[], b: number[]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
  };
  const rdp = (p: [number, number][], eps: number): [number, number][] => {
    if (p.length < 3) return p;
    let maxD = 0, idx = 0;
    for (let i = 1; i < p.length - 1; i++) {
      const d = perp(p[i], p[0], p[p.length - 1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD <= eps) return [p[0], p[p.length - 1]];
    return [...rdp(p.slice(0, idx + 1), eps).slice(0, -1), ...rdp(p.slice(idx), eps)];
  };
  const simple = rdp(pts, tolerance);

  // --- emit code in your format (0..1 coords) ---
  const f = (n: number, d: number) => (n / d).toFixed(3);
  const lines = simple.map(([px, py], i) =>
    `      ctx.${i === 0 ? "moveTo" : "lineTo"}(w * ${f(px, W)}, h * ${f(py, H)});`);
  return `{
    label: "Custom",
    eye: { x: ${eye.x}, y: ${eye.y} },
    draw(ctx, w, h) {
      ctx.beginPath();
${lines.join("\n")}
      ctx.closePath();
    },
  },`;
}

imageToPath("/fish.png", { x: 0.7, y: 0.4 }).then(console.log);