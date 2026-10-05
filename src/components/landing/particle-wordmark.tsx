"use client";

import { useEffect, useRef } from "react";

/* Particle wordmark: the POST SOCIAL lockup assembled from drifting points of light.
   Ported from the Manor landing (itself inspired by ThreeUI's particle wordmark, MIT).
   The text is drawn once to an offscreen canvas, its pixels become targets, and each
   particle springs home from a scattered start, then breathes in place and parts around
   the pointer. Now and then one lifts away like a released lantern, rises, fades, and
   finds its way back. Plain Canvas 2D. */

export type WordmarkTarget = { x: number; y: number };

type Tone = "ink" | "amber" | "plum";
export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  r: number;
  tone: Tone;
  phase: number;
  delay: number;
  lift: number; // seconds left drifting upward (0 = home)
};

const COLORS: Record<Tone, string> = { ink: "250,242,232", amber: "255,196,128", plum: "190,140,255" };

/** Rasterise `text` and return one target per lit sample cell (CSS px). */
export function sampleWordmark(text: string, font: string, width: number, height: number, letterSpacingEm: number, gap: number): WordmarkTarget[] {
  if (typeof document === "undefined") return [];
  const scratch = document.createElement("canvas");
  scratch.width = Math.max(1, Math.round(width));
  scratch.height = Math.max(1, Math.round(height));
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? "48");
  const tracking = size * letterSpacingEm;
  const chars = Array.from(text);
  const widths = chars.map((char) => ctx.measureText(char).width);
  const total = widths.reduce((sum, w) => sum + w, 0) + tracking * (chars.length - 1);
  let x = (width - total) / 2;
  const y = height / 2;
  chars.forEach((char, index) => {
    ctx.fillText(char, x, y);
    x += (widths[index] ?? 0) + tracking;
  });
  const data = ctx.getImageData(0, 0, scratch.width, scratch.height).data;
  const targets: WordmarkTarget[] = [];
  for (let py = 0; py < scratch.height; py += gap) {
    for (let px = 0; px < scratch.width; px += gap) {
      if ((data[(py * scratch.width + px) * 4 + 3] ?? 0) > 110) targets.push({ x: px, y: py });
    }
  }
  return targets;
}

export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function makeParticles(targets: WordmarkTarget[], width: number, height: number, seed = 7): Particle[] {
  const rand = seeded(seed);
  const cx = width / 2;
  const cy = height / 2;
  return targets.map((target) => {
    const angle = rand() * Math.PI * 2;
    const radius = Math.max(width, height) * (0.55 + rand() * 0.5);
    const pick = rand();
    return {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      tx: target.x,
      ty: target.y,
      r: 0.7 + rand() * 0.75,
      tone: pick < 0.16 ? "amber" : pick < 0.27 ? "plum" : "ink",
      phase: rand() * Math.PI * 2,
      delay: rand() * 0.55,
      lift: 0,
    };
  });
}

export const LIFT_SECONDS = 3.2;

/** Sends one settled particle up like a lantern. */
export function release(particles: Particle[], rand: () => number) {
  if (!particles.length) return;
  const p = particles[Math.floor(rand() * particles.length)];
  if (p && p.lift === 0) p.lift = LIFT_SECONDS;
}

/** One physics step. `t` in seconds since start; pointer in CSS px or null. */
export function stepParticles(particles: Particle[], t: number, pointer: { x: number; y: number } | null, dt: number) {
  const k = 0.085;
  const damping = 0.8;
  const clampDt = Math.min(dt, 1 / 20) * 60;
  for (const p of particles) {
    if (t < p.delay) continue;
    if (p.lift > 0) {
      // Rising: a slow climb with a little sway, no spring.
      p.lift = Math.max(0, p.lift - Math.min(dt, 1 / 20));
      p.vy = -0.55;
      p.vx = 0.18 * Math.sin(t * 2 + p.phase);
      p.x += p.vx * clampDt;
      p.y += p.vy * clampDt;
      continue;
    }
    const breathe = 1.4 * Math.sin(t * 1.1 + p.phase);
    let tx = p.tx + breathe * Math.cos(p.phase);
    let ty = p.ty + breathe * Math.sin(p.phase);
    if (pointer) {
      const dx = tx - pointer.x;
      const dy = ty - pointer.y;
      const d2 = dx * dx + dy * dy;
      const radius = 70;
      if (d2 < radius * radius) {
        const d = Math.sqrt(d2) || 1;
        const push = (1 - d / radius) * 26;
        tx += (dx / d) * push;
        ty += (dy / d) * push;
      }
    }
    p.vx = (p.vx + (tx - p.x) * k) * damping;
    p.vy = (p.vy + (ty - p.y) * k) * damping;
    p.x += p.vx * clampDt;
    p.y += p.vy * clampDt;
  }
}

export function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[], t: number) {
  for (const p of particles) {
    if (t < p.delay) continue;
    const settled = Math.min(1, Math.max(0, (t - p.delay) / 1.4));
    let alpha = 0.35 + 0.65 * settled;
    let r = p.r;
    if (p.lift > 0) {
      // A lantern: warm, a touch larger, glowing, fading as it climbs.
      const left = p.lift / LIFT_SECONDS;
      alpha = Math.min(1, left * 1.4);
      r = p.r * 1.6;
      ctx.fillStyle = `rgba(255,190,120,${alpha * 0.18})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${COLORS.amber},${alpha})`;
    } else {
      ctx.fillStyle = `rgba(${COLORS[p.tone]},${alpha})`;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * A wordmark made of particles, sized by its container width. Holds the assembled state
 * (no motion) for people who prefer reduced motion.
 */
export function ParticleWordmark({
  text,
  fontSize = 96,
  fontWeight = 600,
  letterSpacingEm = 0.32,
  gap = 3,
  className,
  label,
  fit = false,
}: {
  text: string;
  fontSize?: number;
  fontWeight?: number;
  letterSpacingEm?: number;
  gap?: number;
  className?: string;
  label?: string;
  fit?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // next/font gives Fraunces a generated family name; read it from the CSS variable.
    const family = getComputedStyle(canvas).getPropertyValue("--font-fraunces").trim() || "Fraunces";
    const fontAt = (size: number) => `${fontWeight} ${size}px ${family}, Georgia, serif`;
    const font = fontAt(fontSize);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const rand = seeded(11);
    let particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let visible = true;
    let pointer: { x: number; y: number } | null = null;
    let started = performance.now();
    let last = started;
    let nextRelease = 0;
    let disposed = false;

    const layout = () => {
      const parent = canvas.parentElement;
      width = Math.max(1, Math.round(parent?.clientWidth ?? canvas.clientWidth ?? 320));
      let fittedFont = font;
      let step = gap;
      // Shrink to fit whenever the tracked text is wider than the space (always on phones).
      if (fit) {
        ctx.font = font;
        const chars = Array.from(text);
        const textWidth = chars.reduce((sum, char) => sum + ctx.measureText(char).width, 0) + fontSize * letterSpacingEm * Math.max(0, chars.length - 1);
        const scale = Math.min(1, Math.max(1, width - 32) / Math.max(1, textWidth));
        fittedFont = fontAt(fontSize * scale);
        // Small text needs denser sampling or the letters dissolve.
        if (scale < 0.6) step = Math.max(2, gap - 1);
      }
      height = Math.round(fontSize * 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.height = `${height}px`;
      particles = makeParticles(sampleWordmark(text, fittedFont, width, height, letterSpacingEm, step), width, height);
      started = performance.now();
      last = started;
      nextRelease = 3.5;
      if (reduceMotion) {
        for (const p of particles) {
          p.x = p.tx;
          p.y = p.ty;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        drawParticles(ctx, particles, 10);
      }
    };

    const loop = (now: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(loop);
      if (!visible) return;
      const t = (now - started) / 1000;
      const dt = (now - last) / 1000;
      last = now;
      if (t > nextRelease) {
        release(particles, rand);
        nextRelease = t + 0.35 + rand() * 0.9;
      }
      stepParticles(particles, t, pointer, dt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawParticles(ctx, particles, t);
    };

    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const onLeave = () => {
      pointer = null;
    };

    const ready = document.fonts?.load(font).catch(() => undefined) ?? Promise.resolve();
    void ready.then(() => {
      if (disposed) return;
      layout();
      if (reduceMotion) return;
      frame = requestAnimationFrame(loop);
    });

    let lastWidth = 0;
    const resize =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            const next = canvas.parentElement?.clientWidth ?? 0;
            if (next !== lastWidth) {
              lastWidth = next;
              layout();
            }
          })
        : null;
    if (canvas.parentElement) resize?.observe(canvas.parentElement);
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
          })
        : null;
    observer?.observe(canvas);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      observer?.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [text, fontSize, fontWeight, letterSpacingEm, gap, fit]);

  return <canvas ref={canvasRef} role="img" aria-label={label ?? text} className={className} style={{ display: "block", width: "100%" }} />;
}
