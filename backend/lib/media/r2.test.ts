// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createR2 } from "./r2";

describe("listParts", () => {
  it("reads every stored part's ETag, page by page", async () => {
    const asked: string[] = [];
    const pages: Record<string, string> = {
      "0": "<ListPartsResult><IsTruncated>true</IsTruncated><NextPartNumberMarker>1</NextPartNumberMarker><Part><PartNumber>1</PartNumber><ETag>&quot;aaa&quot;</ETag><Size>5</Size></Part></ListPartsResult>",
      "1": "<ListPartsResult><IsTruncated>false</IsTruncated><Part><PartNumber>2</PartNumber><ETag>\"bbb\"</ETag></Part></ListPartsResult>",
    };
    const fetchImpl = (async (request: Request) => {
      const url = new URL(request.url);
      asked.push(url.searchParams.get("part-number-marker")!);
      expect(url.searchParams.get("uploadId")).toBe("up 1");
      return new Response(pages[url.searchParams.get("part-number-marker")!]);
    }) as unknown as typeof fetch;
    const r2 = createR2({ accountId: "acct", bucket: "b", accessKeyId: "k", secretAccessKey: "s" }, fetchImpl);
    expect(await r2.listParts("ws/media/m/a.mov", "up 1")).toEqual([
      { partNumber: 1, etag: '"aaa"' },
      { partNumber: 2, etag: '"bbb"' },
    ]);
    expect(asked).toEqual(["0", "1"]);
  });
});
