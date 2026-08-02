import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { relative, sep } from "node:path";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === "server" || entry.name === ".openai") continue;

    const absolutePath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath)));
      continue;
    }

    const relativePath = relative("dist", absolutePath).split(sep).join("/");
    const body = await readFile(absolutePath, "utf8");
    const extension = relativePath.includes(".")
      ? `.${relativePath.split(".").pop()}`
      : "";

    files.push({
      path: `/${relativePath}`,
      body,
      contentType: contentTypes[extension] || "application/octet-stream",
    });
  }

  return files;
}

const files = await collectFiles("dist");
await mkdir("dist/server", { recursive: true });
await writeFile(
  "dist/server/index.js",
  `const files = new Map(${JSON.stringify(files.map(({ path, body, contentType }) => [path, { body, contentType }]))});

function responseFor(path, method) {
  const file = files.get(path);
  if (!file) return null;

  return new Response(method === "HEAD" ? null : file.body, {
    headers: {
      "Cache-Control": path === "/index.html" ? "no-cache" : "public, max-age=31536000, immutable",
      "Content-Type": file.contentType,
    },
  });
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname || "/");
    const staticPath = path === "/" ? "/index.html" : path;
    const directResponse = responseFor(staticPath, request.method);
    if (directResponse) return directResponse;

    // Keep the normal Sites asset binding as a fallback for future files or
    // platform-provided assets that are not part of this browser-only bundle.
    if (env?.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;
    }

    // This is a single-page app, so extensionless routes can use the shell.
    if (!path.includes(".")) {
      const shellResponse = responseFor("/index.html", request.method);
      if (shellResponse) return shellResponse;
    }

    return new Response("Not found", { status: 404 });
  },
};

export default worker;
`,
  "utf8",
);
