const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const windows1252 = new TextDecoder("windows-1252");

export function decodeXer(bytes: Uint8Array): string {
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return windows1252.decode(bytes);
  }
}
