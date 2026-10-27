"use client";
import { useEffect, useRef } from "react";

const COLORS = ["#1d53f0", "#059669", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#ef4444"];

/** Full-screen party-paper burst. Renders nothing for users who prefer reduced motion. */
export function Confetti({ fire, durationMs = 4500 }: { fire: number; durationMs?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!fire || !ref.current) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const W = () => window.innerWidth;
    const H = () => window.innerHeight;
    // Two cannons from the bottom corners plus a gentle rain from the top.
    const pieces = Array.from({ length: 260 }, (_, i) => {
      const fromLeft = i % 3 === 0, fromRight = i % 3 === 1;
      const x = fromLeft ? 0 : fromRight ? W() : Math.random() * W();
      const y = fromLeft || fromRight ? H() * 0.85 : -20 - Math.random() * H() * 0.4;
      const angle = fromLeft ? -Math.PI / 3 - Math.random() * 0.5 : fromRight ? (-2 * Math.PI) / 3 + Math.random() * 0.5 : Math.PI / 2;
      const speed = fromLeft || fromRight ? 9 + Math.random() * 9 : 1 + Math.random() * 2;
      return {
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 6,
        h: 8 + Math.random() * 10,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: COLORS[i % COLORS.length],
        wobble: Math.random() * 10,
      };
    });

    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, W(), H());
      const fade = t > durationMs - 800 ? Math.max(0, (durationMs - t) / 800) : 1;
      for (const p of pieces) {
        p.vy += 0.18; // gravity
        p.vx *= 0.99;
        p.vy = Math.min(p.vy, 6);
        p.wobble += 0.1;
        p.x += p.vx + Math.sin(p.wobble) * 0.6;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.wobble)));
        ctx.restore();
      }
      if (t < durationMs) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, W(), H());
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [fire, durationMs]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-[60] h-full w-full" />;
}
