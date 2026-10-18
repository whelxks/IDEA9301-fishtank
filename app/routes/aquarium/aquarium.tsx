import { useEffect, useRef } from "react";

export function meta() {
  return [{ title: "Aquarium" }];
}

export default function Aquarium() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let instance: any;
    let cancelled = false;

    // dynamic import keeps p5 out of the server bundle entirely —
    // it's only ever loaded in the browser, after mount
    (async () => {
      const p5 = (await import("p5")).default;
      const { sketch } = (await import("../../p5/aquarium")) as any;
      if (cancelled || !containerRef.current) return;
      instance = new p5(sketch, containerRef.current);
    })();

    return () => {
      cancelled = true;
      instance?.customCleanup?.();
      instance?.remove();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    />
  );
}
