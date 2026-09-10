import { describe, expect, it } from "vitest";
import {
  imageFilesFromList,
  routeAlignDroppedFiles,
  routeStudioDroppedFiles,
} from "../src/file-intake-routing.js";

function file(name, type = "image/png") {
  return { name, type };
}

describe("studio file drop routing", () => {
  it("keeps only image files", () => {
    expect(imageFilesFromList([
      file("a.png"),
      file("notes.txt", "text/plain"),
      file("b.JPG", ""),
    ]).map((item) => item.name)).toEqual(["a.png", "b.JPG"]);
  });

  it("routes a single align drop into the first empty seat", () => {
    expect(routeAlignDroppedFiles({
      files: [file("scene.png")],
      hasArt: false,
      hasCard: false,
    })).toEqual([{ kind: "art", file: expect.objectContaining({ name: "scene.png" }) }]);

    expect(routeAlignDroppedFiles({
      files: [file("card.png")],
      hasArt: true,
      hasCard: false,
    })).toEqual([{ kind: "card", file: expect.objectContaining({ name: "card.png" }) }]);
  });

  it("replaces art when both align seats are already filled", () => {
    expect(routeAlignDroppedFiles({
      files: [file("new-art.png")],
      hasArt: true,
      hasCard: true,
    })).toEqual([{ kind: "art", file: expect.objectContaining({ name: "new-art.png" }) }]);
  });

  it("assigns the first two files to art then card", () => {
    expect(routeAlignDroppedFiles({
      files: [file("a.png"), file("b.png"), file("c.png")],
      hasArt: false,
      hasCard: false,
    })).toEqual([
      { kind: "art", file: expect.objectContaining({ name: "a.png" }) },
      { kind: "card", file: expect.objectContaining({ name: "b.png" }) },
    ]);
  });

  it("sends every image to the proxy board in slot-fill mode", () => {
    const routed = routeStudioDroppedFiles({
      intake: "slot-fill",
      files: [file("1.png"), file("2.png")],
      hasArt: false,
      hasCard: false,
    });
    expect(routed.mode).toBe("proxies");
    expect(routed.files.map((item) => item.name)).toEqual(["1.png", "2.png"]);
  });
});
