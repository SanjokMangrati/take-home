// @vitest-environment node
import { gunzipSync } from "node:zlib";
import { describe, expect, test, vi } from "vitest";
import { MAX_UPLOAD_MEGABYTES } from "../../src/shared/api.ts";
import { SERVER_ERROR } from "../../src/shared/errors.ts";
import { serverApi } from "../../src/ui/api.ts";

function respondWith(body: string, status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status })),
  );
}

describe("the API client", () => {
  test("compresses a file before uploading it and keeps its name", async () => {
    const fetchMock = vi.fn(
      async (_path: string, _init: RequestInit) => new Response("{}", { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const text = "ERMHDR\t17.12\n%E\n";

    await serverApi.uploadFile(new File([text], "schedule.xer"));

    const form = fetchMock.mock.calls[0]?.[1].body as FormData;
    const sent = form.get("file") as File;
    expect(sent.name).toBe("schedule.xer");
    expect(gunzipSync(new Uint8Array(await sent.arrayBuffer())).toString()).toBe(text);
  });

  test("shows the server's message when the error body is JSON", async () => {
    respondWith(JSON.stringify({ error: "There is no uploaded file with this ID." }), 404);

    await expect(serverApi.openFile("missing")).rejects.toMatchObject({
      message: "There is no uploaded file with this ID.",
      status: 404,
    });
  });

  test("explains the size limit when a proxy rejects the upload without JSON", async () => {
    respondWith("<html>413 Request Entity Too Large</html>", 413);

    await expect(serverApi.openFile("large")).rejects.toMatchObject({
      message: `This file is larger than the ${MAX_UPLOAD_MEGABYTES} MB limit.`,
      status: 413,
    });
  });

  test("says the checker is starting when the gateway times out", async () => {
    respondWith("upstream timed out", 504);

    await expect(serverApi.openFile("slow")).rejects.toMatchObject({
      message: "The checker is busy or starting up. Try again in a minute.",
      status: 504,
    });
  });

  test("falls back to the general message for other statuses without JSON", async () => {
    respondWith("Internal Server Error", 500);

    await expect(serverApi.openFile("broken")).rejects.toMatchObject({
      message: SERVER_ERROR,
      status: 500,
    });
  });

  test("says the server could not be reached when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(serverApi.openFile("offline")).rejects.toMatchObject({
      message: "The server could not be reached. Check your connection and try again.",
      status: null,
    });
  });
});
