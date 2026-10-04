import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EnvironmentBadge, resolveAppEnv } from "./environment-badge";

describe("EnvironmentBadge", () => {
  it("shows the environment and the InsForge host outside production", () => {
    render(
      <EnvironmentBadge
        appEnv="development"
        insforgeUrl="https://syydd6ck-zqc.us-east.insforge.app"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "development · InsForge syydd6ck-zqc.us-east.insforge.app",
    );
  });

  it("renders nothing in production", () => {
    const { container } = render(
      <EnvironmentBadge appEnv="production" insforgeUrl="https://syydd6ck.us-east.insforge.app" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("still renders when the InsForge URL is missing", () => {
    render(<EnvironmentBadge appEnv="preview" insforgeUrl="" />);
    expect(screen.getByRole("status")).toHaveTextContent("preview · InsForge not set");
  });

  it("shows a malformed URL as-is instead of crashing", () => {
    render(<EnvironmentBadge appEnv="development" insforgeUrl="not a url" />);
    expect(screen.getByRole("status")).toHaveTextContent("development · InsForge not a url");
  });

  it("renders from environment variables when no props are passed", () => {
    // Test runs have no NEXT_PUBLIC_APP_ENV and NODE_ENV=test, so this is a non-production badge.
    render(<EnvironmentBadge />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("resolveAppEnv", () => {
  it("prefers the explicit app environment", () => {
    expect(resolveAppEnv("development", "production", "production")).toBe("development");
  });

  it("falls back to the Vercel environment", () => {
    expect(resolveAppEnv(undefined, "preview", "production")).toBe("preview");
    expect(resolveAppEnv("", "production", "production")).toBe("production");
  });

  it("treats a production build with no other signal as production", () => {
    expect(resolveAppEnv(undefined, undefined, "production")).toBe("production");
  });

  it("treats local development as development", () => {
    expect(resolveAppEnv(undefined, undefined, "development")).toBe("development");
  });
});
