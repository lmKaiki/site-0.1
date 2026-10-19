/* ============================================================
   NEXO · host local (dev e testes)
   Serve o site estático E a API /api/* com os MESMOS handlers
   das Netlify Functions — então o que funciona aqui funciona
   publicado.

     node tools/local-api.js            (porta 8087)
     PORT=3000 node tools/local-api.js

   O banco vem do ambiente (.env):
     NEXO_DB=supabase  → usa o Supabase online
     NEXO_DB=sqlite    → usa tools/.nexo-local.db (sem rede)
   ============================================================ */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const { register, dispatch } = require("../server/router");
const env = require("../server/env");

const handlers = [
  require("../server/handlers/auth"),
  require("../server/handlers/social"),
  require("../server/handlers/servers"),
  require("../server/handlers/messages"),
  require("../server/handlers/sync"),
  require("../server/handlers/apps"),
  require("../server/handlers/calls"),
];
register(handlers);

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || env.port || 8087;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("403");
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      /* SPA: rotas sem extensão caem no index.html */
      if (!path.extname(rel)) {
        fs.readFile(path.join(ROOT, "index.html"), (e2, html) => {
          if (e2) {
            res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            res.end("404");
            return;
          }
          res.writeHead(200, { "content-type": MIME[".html"] });
          res.end(html);
        });
        return;
      }
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("404");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || "/";

  if (pathname === "/api" || pathname.indexOf("/api/") === 0) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 6 * 1024 * 1024) req.destroy();
    });
    req.on("end", async () => {
      const headers = {};
      Object.keys(req.headers).forEach((k) => (headers[k] = req.headers[k]));
      const event = {
        httpMethod: req.method,
        path: pathname,
        queryStringParameters: parsed.query,
        headers,
        body: body || null,
        isBase64Encoded: false,
      };
      try {
        const out = await dispatch(event);
        const base = out.headers || {};
        if (out.multiValueHeaders) {
          res.writeHead(out.statusCode || 200, Object.assign({}, base, out.multiValueHeaders));
        } else {
          res.writeHead(out.statusCode || 200, base);
        }
        res.end(out.body || "");
      } catch (err) {
        console.error("[local-api] erro:", err);
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            ok: false,
            error: "Não foi possível conectar ao servidor. Tente novamente.",
          })
        );
      }
    });
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log("Nexo local em http://localhost:" + PORT + "/");
  console.log("  driver de banco : " + env.driver);
  console.log("  API             : http://localhost:" + PORT + "/api/health");
  if (env.driver === "supabase") {
    console.log(
      "  supabase        : " +
        (env.supabaseUrl || "(SUPABASE_URL ausente)") +
        " · chave " +
        (env.keyIsSecret ? "de serviço" : env.supabaseAnonKey ? "anónima" : "AUSENTE")
    );
  }
});
