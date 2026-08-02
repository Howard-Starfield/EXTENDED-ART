import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("web checkpoint", () => {
  it("keeps the browser entrypoint and local shell together", () => {
    const root = resolve(import.meta.dirname, "..");
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    const script = readFileSync(resolve(root, "app.js"), "utf8");

    expect(html).toContain("ExtendedArt Alignment Studio");
    expect(html).toContain('id="setupForm"');
    expect(script).toContain("fallbackProfiles");
  });
});
