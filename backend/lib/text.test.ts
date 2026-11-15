import { describe, expect, it } from "vitest";
import { trimEndChars, trimTrailingSlashes } from "./text";

describe("linear trims", () => {
  it("trims only the end", () => {
    expect(trimTrailingSlashes("/docs/quickstart///")).toBe("/docs/quickstart");
    expect(trimTrailingSlashes("////")).toBe("");
    expect(trimTrailingSlashes("/a//b")).toBe("/a//b");
    expect(trimEndChars("name---", "-")).toBe("name");
  });

  it("stays fast on input that makes a backtracking regex crawl", () => {
    const evil = `/${"/".repeat(1_000_000)}x`;
    const started = performance.now();
    expect(trimTrailingSlashes(evil)).toBe(evil);
    expect(trimEndChars(`a${"-".repeat(1_000_000)}a`, "-")).toHaveLength(1_000_002);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
