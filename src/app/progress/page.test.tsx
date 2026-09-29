import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ProgressPage, { metadata } from "./page";

const notFound = vi.fn();
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));

describe("ProgressPage", () => {
  beforeEach(() => {
    notFound.mockReset();
    notFound.mockImplementation(() => { throw new Error("notFound"); });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("is excluded from search engines", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("renders locally but not in production", () => {
    vi.stubEnv("NODE_ENV", "development");
    render(<ProgressPage />);
    expect(screen.getByRole("heading", { name: /From idea to a working publishing platform/i })).toBeInTheDocument();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => render(<ProgressPage />)).toThrow("notFound");
  });
});
