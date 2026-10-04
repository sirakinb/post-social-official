function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function verifyMetaSignedRequest(signedRequest: string, secret: string) {
  const [encodedSignature, encodedPayload] = signedRequest.split(".");
  if (!encodedSignature || !encodedPayload) throw new Error("Malformed signed request.");
  const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload)));
  if (String(payload.algorithm ?? "").toUpperCase() !== "HMAC-SHA256") throw new Error("Unsupported signed request algorithm.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload)));
  const actual = decodeBase64Url(encodedSignature);
  if (actual.length !== expected.length) throw new Error("Invalid signed request.");
  let difference = 0;
  for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expected[index];
  if (difference !== 0) throw new Error("Invalid signed request.");
  return payload as { user_id?: string; algorithm: string };
}

export async function readMetaSignedRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const signedRequest = contentType.includes("application/json")
    ? (await request.json()).signed_request
    : (await request.formData()).get("signed_request");
  if (typeof signedRequest !== "string") throw new Error("signed_request is required.");
  return signedRequest;
}
