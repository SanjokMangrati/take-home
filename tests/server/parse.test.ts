import { afterEach, expect, test, vi } from "vitest";
import { parseXer } from "../../src/core/analyze.ts";
import { parseInWorker } from "../../src/server/parse.ts";
import { repoFile } from "../support/xer.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

test("returns the same result as parsing in the same thread", async () => {
  const bytes = repoFile("tests/fixtures/broken-rows.xer");

  expect(await parseInWorker({ bytes, hoursPerDay: null })).toEqual(parseXer(bytes));
});

test("ignores the module messages a worker sends when the server runs with node --watch", async () => {
  vi.stubEnv("WATCH_REPORT_DEPENDENCIES", "1");
  const bytes = repoFile("tests/fixtures/broken-rows.xer");

  expect(await parseInWorker({ bytes, hoursPerDay: null })).toEqual(parseXer(bytes));
});
