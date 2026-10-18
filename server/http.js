"use strict";
/* ============================================================
   NEXO · server/http
   Helpers HTTP compartilhados pelas Netlify Functions e pelo
   host local (tools/local-api.js): corpo, cookies e respostas.
   ============================================================ */

function readBody(event) {
  if (!event || !event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }
  return raw;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  String(header)
    .split(";")
    .forEach((part) => {
      const i = part.indexOf("=");
      if (i < 0) return;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (!k) return;
      try {
        out[k] = decodeURIComponent(v);
      } catch (e) {
        out[k] = v;
      }
    });
  return out;
}

function serializeCookie(name, value, opts) {
  opts = opts || {};
  let cookie = name + "=" + encodeURIComponent(value == null ? "" : value);
  cookie += "; Path=" + (opts.path || "/");
  if (opts.maxAge != null) cookie += "; Max-Age=" + Math.floor(opts.maxAge);
  if (opts.expires) cookie += "; Expires=" + new Date(opts.expires).toUTCString();
  if (opts.httpOnly !== false) cookie += "; HttpOnly";
  if (opts.secure) cookie += "; Secure";
  cookie += "; SameSite=" + (opts.sameSite || "Lax");
  return cookie;
}

function jsonResponse(status, payload, headers) {
  const base = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  if (headers) Object.keys(headers).forEach((k) => (base[k] = headers[k]));
  return {
    statusCode: status || 200,
    headers: base,
    body: JSON.stringify(payload == null ? {} : payload),
  };
}

function multiValue(event, name) {
  const h = event && event.headers ? event.headers : {};
  return h[name] || h[name.toLowerCase()] || null;
}

module.exports = {
  readBody,
  parseCookies,
  serializeCookie,
  jsonResponse,
  multiValue,
};
