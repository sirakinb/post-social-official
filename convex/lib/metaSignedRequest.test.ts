import { describe, expect, it } from "vitest";
import { readMetaSignedRequest, verifyMetaSignedRequest } from "./metaSignedRequest";

function base64url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

async function sign(payload: object, secret: string) {
  const encodedPayload = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload)));
  return `${base64url(signature)}.${encodedPayload}`;
}

describe("Meta signed data-deletion requests", () => {
  it("accepts an authentic HMAC-SHA256 request", async () => {
    const request = await sign({ algorithm: "HMAC-SHA256", user_id: "meta-user-1" }, "app-secret");
    await expect(verifyMetaSignedRequest(request, "app-secret")).resolves.toMatchObject({ user_id: "meta-user-1" });
  });

  it("rejects a tampered request and the wrong secret", async () => {
    const request = await sign({ algorithm: "HMAC-SHA256", user_id: "meta-user-1" }, "app-secret");
    await expect(verifyMetaSignedRequest(`${request}x`, "app-secret")).rejects.toThrow();
    await expect(verifyMetaSignedRequest(request, "wrong-secret")).rejects.toThrow("Invalid signed request");
  });

  it("reads signed requests from form and JSON callbacks", async () => {
    const form = new FormData();
    form.set("signed_request", "form-value");
    await expect(readMetaSignedRequest(new Request("https://example.com", { method: "POST", body: form }))).resolves.toBe("form-value");
    await expect(readMetaSignedRequest(new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signed_request: "json-value" }),
    }))).resolves.toBe("json-value");
  });

  it("rejects callbacks without a signed request", async () => {
    await expect(readMetaSignedRequest(new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }))).rejects.toThrow("signed_request is required");
  });
});
