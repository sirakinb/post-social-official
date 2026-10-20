import { describe, expect, it } from "vitest";
import { parseJson } from "./json";

describe("parseJson", () => {
  it("keeps TikTok's 19-digit post ids exact", () => {
    const body = parseJson('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7698502021669784846]}}') as { data: { publicaly_available_post_id: unknown[] } };
    expect(body.data.publicaly_available_post_id).toEqual(["7698502021669784846"]);
  });

  it("leaves ordinary numbers and strings alone", () => {
    expect(parseJson('{"views":1234,"rate":0.5,"neg":-3,"exp":1e3,"note":"id 7698502021669784846, \\"ok\\"","id":"7698502021669784846"}')).toEqual({
      views: 1234,
      rate: 0.5,
      neg: -3,
      exp: 1000,
      note: 'id 7698502021669784846, "ok"',
      id: "7698502021669784846",
    });
  });

  it("still rejects bad JSON", () => {
    expect(() => parseJson("{nope")).toThrow();
  });
});
