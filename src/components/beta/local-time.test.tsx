import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fullLocal, LocalTime } from "./local-time";

// A fixed moment far from "today", so the short form is the plain month-day-time one.
const ISO = "2026-03-10T01:56:00Z";

describe("LocalTime", () => {
  it("shows the moment in the viewer's own time zone, never the server's", () => {
    render(<LocalTime iso={ISO} />);
    const time = screen.getByText(new Date(ISO).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }), { exact: false });
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", ISO);
  });

  it("names the time zone in the hover text", () => {
    render(<LocalTime iso={ISO} />);
    const zone = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date(ISO)).find((part) => part.type === "timeZoneName")!.value;
    expect(screen.getByText(/\d:\d\d/).getAttribute("title")).toBe(fullLocal(ISO));
    expect(fullLocal(ISO)).toContain(zone);
  });

  it("is honest on the server, which can't know the viewer's zone: UTC, and labelled so", () => {
    const html = renderToString(<LocalTime iso={ISO} />);
    expect(html).toContain("01:56 UTC");
    expect(html).not.toContain("title=");
  });
});
