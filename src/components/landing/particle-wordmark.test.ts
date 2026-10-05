import { describe, expect, it } from "vitest";
import { LIFT_SECONDS, makeParticles, release, seeded, stepParticles } from "./particle-wordmark";

const targets = Array.from({ length: 40 }, (_, i) => ({ x: 10 + i * 3, y: 20 }));

describe("particle wordmark", () => {
  it("scatters the same way every time and mixes in warm and plum points", () => {
    const a = makeParticles(targets, 200, 60);
    const b = makeParticles(targets, 200, 60);
    expect(a.map((p) => [p.x, p.y])).toEqual(b.map((p) => [p.x, p.y]));
    expect(new Set(a.map((p) => p.tone)).size).toBeGreaterThan(1);
  });

  it("springs every particle home", () => {
    const particles = makeParticles(targets, 200, 60);
    for (let i = 0; i < 600; i++) stepParticles(particles, 1 + i / 60, null, 1 / 60);
    for (const p of particles) expect(Math.hypot(p.x - p.tx, p.y - p.ty)).toBeLessThan(3);
  });

  it("lets a released particle rise like a lantern, then come back", () => {
    const particles = makeParticles(targets.slice(0, 1), 200, 60);
    for (let i = 0; i < 300; i++) stepParticles(particles, 1 + i / 60, null, 1 / 60);
    const p = particles[0];
    release(particles, seeded(1));
    expect(p.lift).toBe(LIFT_SECONDS);
    const before = p.y;
    for (let i = 0; i < 60; i++) stepParticles(particles, 6 + i / 60, null, 1 / 60);
    expect(p.y).toBeLessThan(before - 10);
    for (let i = 0; i < 900; i++) stepParticles(particles, 7 + i / 60, null, 1 / 60);
    expect(p.lift).toBe(0);
    expect(Math.hypot(p.x - p.tx, p.y - p.ty)).toBeLessThan(3);
  });
});
