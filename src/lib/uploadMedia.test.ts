import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assertFilesWithinSizeLimit,
  MAX_MEDIA_BYTES,
  uploadFile,
  type UploadProgressEvent,
} from "./uploadMedia";

type XhrListener = (event?: {
  lengthComputable?: boolean;
  loaded?: number;
  total?: number;
}) => void;

class FakeXHR {
  method = "";
  url = "";
  timeout = 0;
  status = 0;
  responseText = "";
  requestHeaders: Record<string, string> = {};
  body: unknown;
  private listeners: Record<string, XhrListener[]> = {};
  private uploadListeners: Record<string, XhrListener[]> = {};
  upload = { addEventListener: this.addUploadListener.bind(this) };

  addEventListener(type: string, handler: XhrListener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  addUploadListener(type: string, handler: XhrListener) {
    if (!this.uploadListeners[type]) this.uploadListeners[type] = [];
    this.uploadListeners[type].push(handler);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name] = value;
  }

  send(body: unknown) {
    this.body = body;
  }

  trigger(type: string, event?: Parameters<XhrListener>[0]) {
    (this.listeners[type] ?? []).forEach((handler) => handler(event));
  }

  triggerUpload(type: string, event?: Parameters<XhrListener>[0]) {
    (this.uploadListeners[type] ?? []).forEach((handler) => handler(event));
  }
}

let requests: FakeXHR[] = [];
const OriginalXHR = globalThis.XMLHttpRequest;

beforeEach(() => {
  requests = [];
  globalThis.XMLHttpRequest = class extends FakeXHR {
    constructor() {
      super();
      requests.push(this);
    }
  } as unknown as typeof XMLHttpRequest;
});

afterEach(() => {
  globalThis.XMLHttpRequest = OriginalXHR;
});

function makeFile(name = "clip.mp4", size = 100, type = "video/mp4") {
  return new File([new Uint8Array(size)], name, { type });
}

describe("uploadFile", () => {
  it("returns the storageId on a successful upload", async () => {
    const file = makeFile();
    const promise = uploadFile({ uploadUrl: "https://example.com/upload", file });

    const request = requests[0];
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://example.com/upload");
    expect(request.timeout).toBe(10 * 60 * 1000);
    expect(request.requestHeaders["Content-Type"]).toBe("video/mp4");
    expect(request.body).toBe(file);

    request.status = 200;
    request.responseText = JSON.stringify({ storageId: "storage_123" });
    request.trigger("load");

    await expect(promise).resolves.toEqual({ storageId: "storage_123" });
  });

  it("reports upload progress", async () => {
    const onProgress = vi.fn();
    const file = makeFile("clip.mp4", 100);
    const promise = uploadFile({
      uploadUrl: "https://example.com/upload",
      file,
      onProgress,
    });

    const request = requests[0];
    request.triggerUpload("progress", {
      lengthComputable: true,
      loaded: 25,
      total: 100,
    });
    request.triggerUpload("progress", {
      lengthComputable: true,
      loaded: 80,
      total: 100,
    });

    request.status = 200;
    request.responseText = JSON.stringify({ storageId: "storage_123" });
    request.trigger("load");

    await promise;

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      percent: 25,
      loaded: 25,
      total: 100,
    } as UploadProgressEvent);
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      percent: 80,
      loaded: 80,
      total: 100,
    } as UploadProgressEvent);
  });

  it("rejects on a non-2xx response", async () => {
    const promise = uploadFile({
      uploadUrl: "https://example.com/upload",
      file: makeFile(),
    });

    const request = requests[0];
    request.status = 503;
    request.responseText = "Service Unavailable";
    request.trigger("load");

    await expect(promise).rejects.toThrow("Upload failed with status 503.");
  });

  it("rejects when the response is not valid JSON", async () => {
    const promise = uploadFile({
      uploadUrl: "https://example.com/upload",
      file: makeFile(),
    });

    const request = requests[0];
    request.status = 200;
    request.responseText = "not json";
    request.trigger("load");

    await expect(promise).rejects.toThrow("Upload response was not valid JSON.");
  });

  it("rejects when the storageId is missing", async () => {
    const promise = uploadFile({
      uploadUrl: "https://example.com/upload",
      file: makeFile(),
    });

    const request = requests[0];
    request.status = 200;
    request.responseText = JSON.stringify({ id: "abc" });
    request.trigger("load");

    await expect(promise).rejects.toThrow(
      "Upload response did not include a storage id.",
    );
  });

  it("rejects on a network error", async () => {
    const promise = uploadFile({
      uploadUrl: "https://example.com/upload",
      file: makeFile(),
    });

    requests[0].trigger("error");

    await expect(promise).rejects.toThrow(
      "Upload failed because of a network error.",
    );
  });

  it("rejects on abort", async () => {
    const promise = uploadFile({
      uploadUrl: "https://example.com/upload",
      file: makeFile(),
    });

    requests[0].trigger("abort");

    await expect(promise).rejects.toThrow("Upload was cancelled.");
  });

  it("rejects on timeout", async () => {
    const promise = uploadFile({
      uploadUrl: "https://example.com/upload",
      file: makeFile(),
    });

    requests[0].trigger("timeout");

    await expect(promise).rejects.toThrow("Upload timed out after 10 minutes.");
  });

  it("settles exactly once even if multiple events fire", async () => {
    const promise = uploadFile({
      uploadUrl: "https://example.com/upload",
      file: makeFile(),
    });

    const request = requests[0];
    request.status = 200;
    request.responseText = JSON.stringify({ storageId: "storage_123" });
    request.trigger("load");
    request.trigger("error");
    request.trigger("timeout");

    await expect(promise).resolves.toEqual({ storageId: "storage_123" });
  });
});

describe("assertFilesWithinSizeLimit", () => {
  it("allows files at the 500 MB limit", () => {
    const file = { name: "big.mp4", size: MAX_MEDIA_BYTES } as File;
    expect(() => assertFilesWithinSizeLimit([file])).not.toThrow();
  });

  it("throws for files over the 500 MB limit", () => {
    const file = { name: "huge.mp4", size: MAX_MEDIA_BYTES + 1 } as File;
    expect(() => assertFilesWithinSizeLimit([file])).toThrow(
      "huge.mp4 is larger than the 500 MB limit.",
    );
  });
});
