import { describe, expect, it } from "vitest";
import { esDesfaseDeVersion } from "../src/lib/ui/version";

describe("esDesfaseDeVersion", () => {
  it("reconoce los errores de una versión anterior abierta", () => {
    expect(esDesfaseDeVersion({ name: "ChunkLoadError", message: "Loading chunk 123 failed." })).toBe(true);
    expect(esDesfaseDeVersion({ message: 'Failed to find Server Action "abc". This request might be from an older or newer deployment.' })).toBe(true);
    expect(esDesfaseDeVersion({ message: "TypeError: Failed to fetch" })).toBe(true);
    expect(esDesfaseDeVersion({ message: 'Server Action "7f3a" was not found on the server.' })).toBe(true);
  });
  it("no confunde otros errores", () => {
    expect(esDesfaseDeVersion({ message: "An error occurred in the Server Components render." })).toBe(false);
  });
});
