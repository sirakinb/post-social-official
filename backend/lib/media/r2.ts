// Minimal Cloudflare R2 client over its S3-compatible API. Uses aws4fetch for request
// signing, so it runs the same in Deno (functions), Node (worker) and tests.
import { AwsClient } from "aws4fetch";

export type R2Config = { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string };

export type R2 = ReturnType<typeof createR2>;

export function createR2(config: R2Config, fetchImpl: typeof fetch = fetch) {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const base = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;
  const objectUrl = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

  async function send(url: string, init: RequestInit = {}) {
    const signed = await client.sign(url, init);
    return fetchImpl(signed);
  }

  async function presign(url: string, method: string, expiresSeconds: number, headers: Record<string, string> = {}) {
    const target = new URL(url);
    target.searchParams.set("X-Amz-Expires", String(expiresSeconds));
    const signed = await client.sign(target.toString(), { method, headers, aws: { signQuery: true, allHeaders: true } });
    return signed.url;
  }

  async function expectOk(response: Response, action: string) {
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`R2 ${action} failed (${response.status}): ${body.slice(0, 300)}`);
    }
    return response;
  }

  return {
    objectUrl,

    async createMultipartUpload(key: string, contentType: string) {
      const response = await expectOk(
        await send(`${objectUrl(key)}?uploads`, { method: "POST", headers: { "Content-Type": contentType } }),
        "start upload",
      );
      const uploadId = xmlValue(await response.text(), "UploadId");
      if (!uploadId) throw new Error("R2 start upload returned no UploadId");
      return uploadId;
    },

    // A URL the browser can PUT one part to without our credentials. The exact size is
    // signed, so R2 refuses a part of any other length (uploads cannot exceed what was
    // declared and counted against the plan).
    presignPart(key: string, uploadId: string, partNumber: number, expiresSeconds: number, contentLength: number) {
      const url = `${objectUrl(key)}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;
      return presign(url, "PUT", expiresSeconds, { "content-length": String(contentLength) });
    },

    async uploadPart(key: string, uploadId: string, partNumber: number, body: Uint8Array<ArrayBuffer>) {
      const url = `${objectUrl(key)}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;
      const response = await expectOk(await send(url, { method: "PUT", body }), "upload part");
      const etag = response.headers.get("etag");
      if (!etag) throw new Error("R2 upload part returned no ETag");
      return etag;
    },

    async completeMultipartUpload(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>) {
      const body =
        "<CompleteMultipartUpload>" +
        [...parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`)
          .join("") +
        "</CompleteMultipartUpload>";
      const response = await expectOk(
        await send(`${objectUrl(key)}?uploadId=${encodeURIComponent(uploadId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/xml" },
          body,
        }),
        "finish upload",
      );
      // S3 can report an error inside a 200 response.
      const text = await response.text();
      if (text.includes("<Error>")) throw new Error(`R2 finish upload failed: ${xmlValue(text, "Message") ?? text.slice(0, 200)}`);
    },

    async abortMultipartUpload(key: string, uploadId: string) {
      const response = await send(`${objectUrl(key)}?uploadId=${encodeURIComponent(uploadId)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) await expectOk(response, "cancel upload");
    },

    async head(key: string) {
      const response = await send(objectUrl(key), { method: "HEAD" });
      if (response.status === 404) return null;
      await expectOk(response, "check file");
      return {
        sizeBytes: Number(response.headers.get("content-length") ?? 0),
        contentType: response.headers.get("content-type") ?? "",
      };
    },

    presignGet(key: string, expiresSeconds: number) {
      return presign(objectUrl(key), "GET", expiresSeconds);
    },

    // One page of keys under a prefix. With a delimiter, also returns the "folders" below it.
    async list(prefix: string, options: { delimiter?: string; continuationToken?: string } = {}) {
      const url = new URL(base);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", prefix);
      if (options.delimiter) url.searchParams.set("delimiter", options.delimiter);
      if (options.continuationToken) url.searchParams.set("continuation-token", options.continuationToken);
      const text = await (await expectOk(await send(url.toString()), "list files")).text();
      return {
        keys: [...text.matchAll(/<Contents>[\s\S]*?<Key>([^<]*)<\/Key>/g)].map((m) => unescapeXml(m[1])),
        prefixes: [...text.matchAll(/<CommonPrefixes>\s*<Prefix>([^<]*)<\/Prefix>/g)].map((m) => unescapeXml(m[1])),
        nextToken: xmlValue(text, "NextContinuationToken"),
      };
    },

    async delete(key: string) {
      const response = await send(objectUrl(key), { method: "DELETE" });
      if (!response.ok && response.status !== 404) await expectOk(response, "delete file");
    },
  };
}

function xmlValue(xml: string, tag: string) {
  return xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] ?? null;
}

function unescapeXml(text: string) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function escapeXml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
