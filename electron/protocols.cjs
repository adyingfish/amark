const fs = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");

const APP_URL = "amark://app/index.html";
const IMAGE_TYPES = new Map(
  Object.entries({
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".apng": "image/apng",
    ".jfif": "image/jpeg",
  }),
);
const APP_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data: https: http:",
  "img-src 'self' data: blob: https: http: amark-asset:",
  "connect-src 'self' amark-asset:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
const PRINT_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data: https: http: amark-asset:",
  "font-src data: https: http:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function launchFilePath(arg, cwd) {
  // Desktop Entry %U passes file URIs; Windows Explorer and CLI launches use paths.
  if (!/^file:/i.test(arg)) return path.resolve(cwd, arg);
  try {
    return fileURLToPath(arg);
  } catch {
    return null;
  }
}

function rendererURL(devUrl, packaged) {
  if (packaged || !devUrl) return APP_URL;
  const url = new URL(devUrl);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("AMARK_DEV_URL must point to a local development server");
  }
  return url.href;
}

function isAppPage(value, entry) {
  try {
    const url = new URL(value);
    const app = new URL(entry);
    return (
      url.protocol === app.protocol &&
      url.host === app.host &&
      !url.username &&
      !url.password &&
      [app.pathname, "/", "/index.html"].includes(url.pathname)
    );
  } catch {
    return false;
  }
}

function registerProtocols({ protocol, net, dist, assets, printJobs, entry }) {
  protocol.handle("amark", async (request) => {
    try {
      const url = new URL(request.url);
      const name = decodeURIComponent(url.pathname).slice(1);
      if (
        url.host !== "app" ||
        request.method !== "GET" ||
        !/^(?:index\.html|assets\/[A-Za-z\d_.-]+)$/.test(name)
      ) {
        return new Response(null, { status: 404 });
      }
      const file = path.join(dist, name);
      const response = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", APP_POLICY);
      headers.set("Referrer-Policy", "no-referrer");
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  protocol.handle("amark-asset", async (request) => {
    try {
      const url = new URL(request.url);
      const workspace = assets.get(url.hostname);
      if (!workspace || request.method !== "GET") return new Response(null, { status: 403 });
      const file = await workspace.resolveAsset(decodeURIComponent(url.pathname.slice(1)));
      const type = IMAGE_TYPES.get(path.extname(file).toLowerCase());
      if (!type) return new Response(null, { status: 415 });
      const origin = new URL(entry);
      const headers = {
        "Content-Type": type,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Access-Control-Allow-Origin": origin.protocol + "//" + origin.host,
        "Cache-Control": "no-store",
      };
      return new Response(await fs.readFile(file), { headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  protocol.handle("amark-print", (request) => {
    const html = printJobs.get(request.url);
    return html === undefined
      ? new Response(null, { status: 404 })
      : new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": PRINT_POLICY,
            "Referrer-Policy": "no-referrer",
          },
        });
  });
}

module.exports = { isAppPage, launchFilePath, registerProtocols, rendererURL };
