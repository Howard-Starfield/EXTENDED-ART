import { describe, expect, it } from "vitest";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import { buildPrintPackage, createZipArchive, estimatePeakMemory, textBytes } from "../src/package.js";
import { outputNames, safeSlug } from "../src/names.js";

describe("package and filename contract", () => {
  it("sanitizes slugs and keeps optional names deterministic", () => {
    expect(safeSlug("Froakie: Binder / Final.png")).toBe("Froakie_Binder_Final");
    const names = outputNames({ slug: "froakie", profile: "psa", paper: "letter" });
    expect(names.cutReadyPdf).toBe("froakie_psa_letter_cut_ready.pdf");
    expect(names.piecePng("TL")).toBe("pieces/froakie_psa_TL_300dpi.png");
  });

  it("estimates warning and blocking memory levels", () => {
    expect(estimatePeakMemory({ rasterBytes: 10 }).level).toBe("ok");
    expect(estimatePeakMemory({ rasterBytes: 512 * 1024 * 1024 }).level).toBe("warning");
    expect(estimatePeakMemory({ rasterBytes: 1024 * 1024 * 1024 }).level).toBe("blocked");
  });

  it("sorts ZIP entries and produces a manifest without raw card files", async () => {
    const result = await buildPrintPackage({
      entries: [{ path: "z.txt", bytes: textBytes("z") }, { path: "a.txt", bytes: textBytes("a") }],
      instructions: "Print at 100%.",
      qualityReport: { overallStatus: "PASS" },
      manifest: { profile: "standard", paper: "a4" },
    });
    expect(result.manifest.files.map((file) => file.path)).toEqual([
      "a.txt", "PRINT_INSTRUCTIONS.txt", "quality_report.json", "z.txt",
    ]);
    const reader = new ZipReader(new BlobReader(new Blob([result.bytes])));
    const entries = await reader.getEntries();
    expect(entries.map((entry) => entry.filename)).toEqual([
      "a.txt", "manifest.json", "PRINT_INSTRUCTIONS.txt", "quality_report.json", "z.txt",
    ]);
    expect(await entries.find((entry) => entry.filename === "manifest.json").getData(new TextWriter())).toContain("standard");
    await reader.close();
  });

  it("can build a required-only archive with no pieces directory", async () => {
    const bytes = await createZipArchive([{ path: "cut_ready.pdf", bytes: textBytes("pdf") }]);
    const reader = new ZipReader(new BlobReader(new Blob([bytes])));
    const entries = await reader.getEntries();
    expect(entries.map((entry) => entry.filename)).toEqual(["cut_ready.pdf"]);
    await reader.close();
  });

  it("honors cancellation before adding the next archive entry", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createZipArchive([{ path: "cut_ready.pdf", bytes: textBytes("pdf") }], { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
