import { afterEach, describe, expect, it, vi } from "vitest";
import { replacePreviewUrl } from "../src/image-io.js";

describe("preview URL lifecycle", () => {
  afterEach(() => vi.restoreAllMocks());

  it("revokes the replaced URL before creating the next preview", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:new-preview");
    const file = new File([new Uint8Array([1])], "preview.png", { type: "image/png" });

    expect(replacePreviewUrl("blob:old-preview", file)).toBe("blob:new-preview");
    expect(revoke).toHaveBeenCalledWith("blob:old-preview");
    expect(create).toHaveBeenCalledWith(file);
  });
});
