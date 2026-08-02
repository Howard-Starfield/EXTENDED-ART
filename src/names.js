export function safeSlug(value) {
  const slug = String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return slug || "extended_art";
}

export function outputNames({ slug, profile, paper }) {
  const base = `${slug}_${profile}_${paper}`;
  return {
    cutReadyPdf: `${base}_cut_ready.pdf`,
    withCardPdf: `${base}_with_card_reference.pdf`,
    printGuidePdf: `${base}_print_guide.pdf`,
    masterPng: `${slug}_${profile}_master_300dpi.png`,
    piecePng: (position) => `pieces/${slug}_${profile}_${position}_300dpi.png`,
    packageZip: (paperSet, timestamp) => `${slug}_${profile}_${paperSet}_print_package_${timestamp}.zip`,
  };
}
