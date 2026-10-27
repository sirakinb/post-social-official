import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CODE_FRESH_MS, rejectedCodeMessage, SignUpForm } from "./forms";

const actions = vi.hoisted(() => ({
  signUp: vi.fn(async () => ({ step: "verify", email: "ada@example.com", notice: "We sent a code.", sentAt: Date.now() })),
  verifyEmailCode: vi.fn(async () => ({ step: "verify", email: "ada@example.com", codeRejected: true, at: Date.now() })),
  resendEmailCode: vi.fn(async () => ({ step: "verify", email: "ada@example.com", notice: "We sent a new code to ada@example.com.", sentAt: Date.now(), at: Date.now() + 1 })),
}));
vi.mock("./actions", () => ({ ...actions, signIn: vi.fn(), requestPasswordReset: vi.fn(), completePasswordReset: vi.fn(), startGoogleSignIn: vi.fn() }));

describe("rejectedCodeMessage", () => {
  it("calls a fresh code a typo and an old one expired", () => {
    const now = Date.now();
    expect(rejectedCodeMessage(now - 60_000, now)).toBe("That code doesn't match. Check the email and try again.");
    expect(rejectedCodeMessage(now - CODE_FRESH_MS - 1000, now)).toMatch(/^That code has expired/);
    expect(rejectedCodeMessage(undefined, now)).toMatch(/doesn't match/);
  });
});

describe("SignUpForm", () => {
  it("explains a short password in its own words, without sending anything", async () => {
    render(<SignUpForm />);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short1" } });
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "Create free account" }).closest("form")!));
    expect(screen.getByRole("alert")).toHaveTextContent("Use at least 12 characters.");
    expect(actions.signUp).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Password")).not.toHaveAttribute("minlength");
  });

  it("then asks for the code, says where it went, and offers a new one", async () => {
    render(<SignUpForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-good-password-1" } });
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "Create free account" }).closest("form")!));
    expect(await screen.findByText(/We sent a 6-digit code to/)).toHaveTextContent("We sent a 6-digit code to ada@example.com.");

    fireEvent.change(screen.getByLabelText("Code from the email"), { target: { value: "123456" } });
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "Confirm email" }).closest("form")!));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code doesn't match. Check the email and try again.");

    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "Send a new code" }).closest("form")!));
    expect(await screen.findByRole("status")).toHaveTextContent("We sent a new code to ada@example.com.");
  });
});
