import { describe, expect, test } from "vitest";
import { decodeXer } from "../../src/core/xer/decode.ts";

describe("decodeXer", () => {
  test("reads a valid UTF-8 file as UTF-8", () => {
    const decoded = decodeXer(new TextEncoder().encode("ERMHDR\tFaçade"));

    expect(decoded).toBe("ERMHDR\tFaçade");
  });

  test("drops a UTF-8 byte order mark", () => {
    const decoded = decodeXer(Uint8Array.from([0xef, 0xbb, 0xbf, 0x45, 0x52]));

    expect(decoded).toBe("ER");
  });

  test("falls back to Windows-1252 when the bytes are not valid UTF-8", () => {
    const decoded = decodeXer(Uint8Array.from([0x46, 0x61, 0xe7, 0x61, 0x64, 0x65, 0x80]));

    expect(decoded).toBe("Façade€");
  });

  test("keeps bytes that Windows-1252 leaves undefined as C1 characters", () => {
    const decoded = decodeXer(Uint8Array.from([0x41, 0x81, 0x42]));

    expect(decoded).toBe("A\u0081B");
  });
});
