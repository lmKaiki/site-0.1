"use strict";
/* ============================================================
   NEXO · server/db-supabase
   Cliente PostgREST puro (fetch nativo, zero dependências).
   A chave secreta (service_role) fica SÓ aqui dentro, vinda do
   ambiente do Netlify — nunca em HTML, JS público ou Git.

   Contrato idêntico ao driver SQLite: os handlers não sabem
   qual driver está ativo.
   ============================================================ */

const env = require("./env");
const { camelToSnake } = require("./rows");

/* Este driver é um transporte burro: quem entende o schema é
   server/map.js (fachada). Por isso NÃO converte snake/camel
   nem datas aqui — devolve o que o PostgREST devolve. */

function base() {
  if (!env.supabaseUrl) throw new Error("SUPABASE_URL não configurada");
  return env.supabaseUrl + "/rest/v1";
}

function headers(extra) {
  const h = {
    apikey: env.supabaseKey,
    Authorization: "Bearer " + env.supabaseKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (env.keyIsSecret) h.Prefer = "return=representation";
  if (extra) Object.keys(extra).forEach((k) => (h[k] = extra[k]));
  return h;
}

/* codificação de valor/query (colunas são identificadores simples) */
function encode(value) {
  return encodeURIComponent(String(value)).replace(/%20/g, "+");
}

function buildQuery(opts) {
  opts = opts || {};
  const parts = ["select=*"];
  const where = opts.where || {};
  const op = opts.op || {};

  Object.keys(where).forEach((rawKey) => {
    const col = camelToSnake(rawKey);
    const value = where[rawKey];
    if (value === undefined) return;
    if (value === null) {
      parts.push(encode(col) + "=is.null");
    } else if (Array.isArray(value)) {
      if (!value.length) parts.push(encode(col) + "=in.(" + ")");
      else
        parts.push(
          encode(col) + "=in.(" + value.map((v) => String(v).replace(/[(),]/g, "")).join(",") + ")"
        );
    } else {
      parts.push(encode(col) + "=eq." + encode(value));
    }
  });

  Object.keys(op).forEach((rawKey) => {
    const col = camelToSnake(rawKey);
    const spec = op[rawKey] || {};
    Object.keys(spec).forEach((operator) => {
      const value = spec[operator];
      switch (operator) {
        case "neq":
          parts.push(encode(col) + "=neq." + encode(value));
          break;
        case "gt":
          parts.push(encode(col) + "=gt." + encode(value));
          break;
        case "gte":
          parts.push(encode(col) + "=gte." + encode(value));
          break;
        case "lt":
          parts.push(encode(col) + "=lt." + encode(value));
          break;
        case "lte":
          parts.push(encode(col) + "=lte." + encode(value));
          break;
        case "like":
          parts.push(encode(col) + "=like." + encode(value));
          break;
        case "ilike":
          parts.push(encode(col) + "=ilike." + encode(value));
          break;
        case "in":
          parts.push(encode(col) + "=in.(" + (value || []).map((v) => String(v)).join(",") + ")");
          break;
        case "isnull":
          parts.push(encode(col) + (value ? "=is.null" + "" : "=not.is.null"));
          break;
        default:
          parts.push(encode(col) + "=eq." + encode(value));
      }
    });
  });

  if (opts.order) {
    const col = camelToSnake(opts.order);
    parts.push("order=" + encode(col) + "." + (opts.desc === false ? "asc" : "desc"));
  }
  if (opts.limit) parts.push("limit=" + Math.floor(opts.limit));
  return parts.join("&");
}

async function request(pathname, init) {
  const res = await fetch(base() + pathname, init);
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (e) {
      body = text;
    }
  }
  if (!res.ok) {
    const message =
      (body && (body.message || body.error_description || body.error)) ||
      "Falha ao acessar o banco (" + res.status + ").";
    const err = new Error(message);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const driver = {
  name: "supabase",

  init() {
    if (!env.supabaseKey) throw new Error("Chave do Supabase ausente no ambiente");
  },

  /* colunas reais de cada tabela (OpenAPI do PostgREST) — permite
     gravar apenas o que existe no schema atual da conta */
  _tables: null,
  async tables() {
    if (driver._tables) return driver._tables;
    let spec = null;
    try {
      spec = await request("/", { method: "GET", headers: headers() });
    } catch (e) {
      spec = null;
    }
    driver._tables = {};
    if (spec && spec.definitions) {
      Object.keys(spec.definitions).forEach((name) => {
        const props = (spec.definitions[name] && spec.definitions[name].properties) || {};
        driver._tables[name] = new Set(Object.keys(props));
      });
    }
    return driver._tables;
  },
  async columns(table) {
    const all = await driver.tables();
    return (all && all[table]) || new Set();
  },

  async select(table, opts) {
    const list = await request("/" + table + "?" + buildQuery(opts), {
      method: "GET",
      headers: headers(),
    });
    return Array.isArray(list) ? list : [];
  },

  async insert(table, obj) {
    const body = await request("/" + table, {
      method: "POST",
      headers: headers({ Prefer: "return=representation" }),
      body: JSON.stringify(obj),
    });
    return (body && body[0]) || obj;
  },

  async upsert(table, obj, conflictCol) {
    const target = camelToSnake(conflictCol || "id");
    const q = "?on_conflict=" + target + "&resolution=merge-duplicates";
    const body = await request("/" + table + q, {
      method: "POST",
      headers: headers({ Prefer: "return=representation" }),
      body: JSON.stringify(obj),
    });
    return (body && body[0]) || obj;
  },

  async update(table, opts, patch) {
    const body = await request("/" + table + "?" + buildQuery(opts), {
      method: "PATCH",
      headers: headers({ Prefer: "return=representation" }),
      body: JSON.stringify(patch),
    });
    return Array.isArray(body) ? body.length : 0;
  },

  async remove(table, opts) {
    const q = buildQuery(opts);
    if (!q.includes("=eq.") && !q.includes("=in.") && !q.includes("=not.") && !q.includes("=is.null") && !q.includes("=gt") && !q.includes("=lt")) {
      throw new Error("remove exige filtro (recusa apagar a tabela inteira)");
    }
    const body = await request("/" + table + "?" + q, {
      method: "DELETE",
      headers: headers(),
    });
    return Array.isArray(body) ? body.length : 0;
  },

  async count(table, opts) {
    const q = buildQuery(Object.assign({}, opts, { select: null }));
    const body = await request(
      "/" + table + "?" + q.replace("select=*", "select=id") + "&limit=10000",
      { method: "GET", headers: headers() }
    );
    return Array.isArray(body) ? body.length : 0;
  },
};

module.exports = driver;
