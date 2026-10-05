import { describe, expect, it } from "vitest";
import { buildInput, coerce, InputError, parseArgs, toCommand, toOperationId } from "./args";
import { mimeFor } from "./upload";

describe("postsocial arguments", () => {
  it("reads the command and flags in both --name value and --name=value forms", () => {
    expect(parseArgs(["create-post", "--caption", "Hi there", "--draft", "--limit=5"])).toEqual({
      command: "create-post",
      flags: { caption: "Hi there", draft: true, limit: "5" },
      positional: [],
    });
    expect(toOperationId("create-post")).toBe("create_post");
    expect(toCommand("list_social_accounts")).toBe("list-social-accounts");
  });

  it("gives each flag the type the API expects", () => {
    expect(coerce("limit", "10", { type: "integer" })).toBe(10);
    expect(coerce("draft", true, { type: "boolean" })).toBe(true);
    expect(coerce("include_hidden", "false", { type: "boolean" })).toBe(false);
    expect(coerce("destinations", '[{"account_id":"a"}]', { type: "array" })).toEqual([{ account_id: "a" }]);
    expect(coerce("media_ids", "m1, m2", { type: "array" })).toEqual(["m1", "m2"]);
    expect(() => coerce("limit", "ten", { type: "integer" })).toThrow(InputError);
    expect(() => coerce("caption", true, { type: "string" })).toThrow(/needs a value/);
  });

  it("builds the request from flags or one --input object, and rejects unknown options", () => {
    const properties = { caption: { type: "string" }, draft: { type: "boolean" }, media_ids: { type: "array" } };
    expect(buildInput({ caption: "Hi", draft: true, pretty: true }, properties)).toEqual({ caption: "Hi", draft: true });
    expect(buildInput({ input: '{"caption":"From JSON"}', draft: "true" }, properties)).toEqual({ caption: "From JSON", draft: true });
    expect(() => buildInput({ colour: "red" }, properties)).toThrow(/Unknown option --colour/);
    expect(() => buildInput({ input: "[1]" }, properties)).toThrow(/JSON object/);
  });

  it("knows which files Post Social accepts", () => {
    expect(mimeFor("clip.MOV")).toBe("video/quicktime");
    expect(mimeFor("photo.jpeg")).toBe("image/jpeg");
    expect(() => mimeFor("doc.pdf")).toThrow(/JPEG, PNG, WebP, MP4 and MOV/);
  });
});
