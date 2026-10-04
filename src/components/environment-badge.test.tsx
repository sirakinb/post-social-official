import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EnvironmentBadge } from "./environment-badge";

describe("EnvironmentBadge", () => {
  it("shows the environment and backend host outside production", () => {
    render(
      <EnvironmentBadge
        appEnv="development"
        backendUrl="https://syydd6ck-zqc.us-east.insforge.app"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "development · syydd6ck-zqc.us-east.insforge.app",
    );
  });

  it("renders nothing in production", () => {
    const { container } = render(
      <EnvironmentBadge appEnv="production" backendUrl="https://syydd6ck.us-east.insforge.app" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when no environment is set", () => {
    const { container } = render(<EnvironmentBadge appEnv="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still renders when the backend URL is missing", () => {
    render(<EnvironmentBadge appEnv="development" backendUrl="" />);
    expect(screen.getByRole("status")).toHaveTextContent("development · no backend set");
  });

  it("shows a malformed backend URL as-is instead of crashing", () => {
    render(<EnvironmentBadge appEnv="development" backendUrl="not a url" />);
    expect(screen.getByRole("status")).toHaveTextContent("development · not a url");
  });
});
