import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DataDeletionPage from "./page";

describe("DataDeletionPage", () => {
  it("explains each way to delete data, pointing at the web app", () => {
    render(<DataDeletionPage />);
    expect(screen.getByRole("heading", { name: /Data Deletion/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute("href", "/beta/accounts");
    expect(screen.getByRole("link", { name: "Drafts" })).toHaveAttribute("href", "/beta/drafts");
    expect(screen.getByRole("link", { name: "support@postsocial.xyz" }).getAttribute("href")).toMatch(/^mailto:support@postsocial\.xyz/);
  });
});
