"use strict";
/* ============================================================
   NEXO · server/router
   Roteador compartilhado pelas Netlify Functions e pelo host
   local (tools/local-api.js). Toda resposta tem o formato
     { ok: true, data, patch }
   e todo erro responde { ok:false, error } com status HTTP —
   nada de erro engolido em silêncio.

   Autorização: os handlers usam o usuário da SESSÃO (cookie
   HttpOnly) — id enviado pelo navegador não prova nada.
   ============================================================ */

const { readBody, parseCookies, jsonResponse } = require("./http");
const { ApiError } = require("./errors");

const routes = [];

function route(method, pattern, handler, opts) {
  const parts = pattern.split("/").filter((s) => s.length);
  routes.push({
    method: method.toUpperCase(),
    parts,
    handler,
    opts: opts || {},
    raw: method.toUpperCase() + " " + pattern,
  });
}

function match(routeDef, method, segments) {
  if (routeDef.method !== method) return null;
  if (routeDef.parts.length !== segments.length) return null;
  const params = {};
  for (let i = 0; i < routeDef.parts.length; i++) {
    const p = routeDef.parts[i];
    const s = segments[i];
    if (p.charAt(0) === ":") {
      params[p.slice(1)] = decodeURIComponent(s);
    } else if (p !== s) {
      return null;
    }
  }
  return params;
}

function normalizePath(path) {
  let p = String(path || "");
  p = p.split("?")[0];
  p = p.replace(/^\/\.netlify\/functions\/api/, "");
  if (p.indexOf("/api") === 0) p = p.slice(4);
  if (p.charAt(0) !== "/") p = "/" + p;
  if (p.length > 1 && p.charAt(p.length - 1) === "/") p = p.slice(0, -1);
  return p;
}

/* registra os handlers */
function register(modules) {
  modules.forEach((m) => {
    (m && m.routes ? m.routes() : []).forEach((r) => route(r[0], r[1], r[2], r[3]));
  });
}

async function dispatch(event) {
  const method = String(event.httpMethod || "GET").toUpperCase();
  const fullPath = event.path || "/";
  const path = normalizePath(fullPath);
  const segments = path.split("/").filter((s) => s.length);
  const query = event.queryStringParameters || {};

  let matched = null;
  let params = null;
  for (let i = 0; i < routes.length; i++) {
    const p = match(routes[i], method, segments);
    if (p) {
      matched = routes[i];
      params = p;
      break;
    }
  }

  if (!matched) {
    return jsonResponse(404, {
      ok: false,
      error: "Rota não encontrada: " + method + " " + path,
      code: "not_found",
    });
  }

  const ctx = {
    event,
    method,
    path,
    params: params || {},
    query,
    body: readBody(event),
    headers: event.headers || {},
    cookies: parseCookies((event.headers || {}).cookie || (event.headers || {}).Cookie),
    user: null,
    userId: null,
  };

  try {
    const result = (await matched.handler(ctx)) || {};
    const payload = {
      ok: true,
      data: result.data === undefined ? null : result.data,
    };
    if (result.patch) payload.patch = result.patch;
    if (result.meta) payload.meta = result.meta;

    const headers = { "cache-control": "no-store" };
    if (result.setCookies && result.setCookies.length) {
      headers["x-nexo-set-cookie"] = "1";
    }
    const response = jsonResponse(result.status || 200, payload, headers);
    if (result.setCookies && result.setCookies.length) {
      response.multiValueHeaders = { "Set-Cookie": result.setCookies };
      delete response.headers["x-nexo-set-cookie"];
    }
    return response;
  } catch (err) {
    if (err instanceof ApiError || err.friendly) {
      return jsonResponse(err.status || 400, {
        ok: false,
        error: err.message,
        code: err.code || null,
      });
    }
    console.error("[nexo/api] erro não tratado em " + method + " " + path + ":", err);
    return jsonResponse(500, {
      ok: false,
      error: "Não foi possível conectar ao servidor. Tente novamente.",
      code: "server_error",
    });
  }
}

module.exports = { route, routes, register, dispatch, normalizePath };
