// Desktop test server for the web UI. Serves app/src/main/assets at http://127.0.0.1:<port>/ and the small Keswick
// map samples in tools/testdata at /maps/... with HTTP range requests, like the app's own map file handler.
//
//   node tools/serve_test.mjs [port]        (default 8137)
//
// Also imported by tools/ui_smoke_test.mjs.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "app/src/main/assets");
const testdata = path.join(root, "tools/testdata");
const MAPS = { "gb.pmtiles": "sample-gb.pmtiles", "contours.pmtiles": "sample-contours.pmtiles", "places.tsv": "sample-places.tsv" };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2", ".pbf": "application/x-protobuf", ".tsv": "text/tab-separated-values" };

export function serve(port = 8137, opts = {}) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let file;
    if (url.startsWith("/maps/")) {
      const name = url.slice(6);
      if (opts.noMaps || !MAPS[name]) { res.writeHead(404); return res.end(); }
      file = path.join(testdata, MAPS[name]);
    } else {
      file = path.join(assets, url === "/" ? "index.html" : url);
      if (!file.startsWith(assets)) { res.writeHead(403); return res.end(); }
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
      const type = TYPES[path.extname(file)] || "application/octet-stream";
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
      if (m) {
        let start = m[1] === "" ? Math.max(0, st.size - Number(m[2])) : Number(m[1]);
        let end = m[1] === "" || m[2] === "" ? st.size - 1 : Math.min(Number(m[2]), st.size - 1);
        if (start > end) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); return res.end(); }
        res.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Accept-Ranges": "bytes" });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes" });
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.argv[2] || 8137);
  serve(port).then(() => console.log(`http://127.0.0.1:${port}/`));
}
