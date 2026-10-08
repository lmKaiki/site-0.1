"use strict";
/* ============================================================
   NEXO · server/rows
   Ponte entre o formato do banco (snake_case, como nas tabelas
   PostgreSQL) e o formato do Nexo (camelCase, o mesmo que as
   views e seletores já usam). Uma única regra genérica:
     display_name  <->  displayName
     created_at    <->  createdAt
     user_a_id     <->  userAId
   ============================================================ */

/* colunas guardadas como JSON (jsonb no Postgres, texto no SQLite) */
const JSON_COLS = [
  "avatar", "region", "icon", "appearance", "privacy", "permissions", "perms",
  "overrides", "participants", "reads", "reactions", "meta", "target",
  "configuration", "extra_role_ids", "blocks", "media", "attachments",
  "commands",
];

/* colunas booleanas (SQLite devolve 0/1) */
const BOOL_COLS = [
  "read", "pinned", "enabled", "is_default", "discoverable", "inherit_perms",
  "demo", "collapsed", "muted", "open", "deafened", "camera", "screen_share",
];

function snakeToCamel(key) {
  if (key.indexOf("_") === -1) return key;
  return key.replace(/_([a-z0-9])/g, (m, c) => c.toUpperCase());
}

function camelToSnake(key) {
  return String(key).replace(/([A-Z])/g, "_$1").toLowerCase();
}

function isJsonCol(col) {
  return JSON_COLS.indexOf(col) !== -1;
}

function isBoolCol(col) {
  return BOOL_COLS.indexOf(col) !== -1;
}

/* linha do banco → objeto do Nexo */
function fromRow(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  Object.keys(row).forEach((col) => {
    let value = row[col];
    if (value !== null && value !== undefined) {
      if (isJsonCol(col) && typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch (e) {
          /* valor que não era JSON: mantém como texto */
        }
      } else if (isBoolCol(col)) {
        value = value === true || value === 1 || value === "1" || value === "t" || value === "true";
      }
    }
    out[snakeToCamel(col)] = value;
  });
  return out;
}

/* objeto do Nexo → linha do banco (jsonify = true no SQLite) */
function toRow(obj, jsonify) {
  const out = {};
  Object.keys(obj).forEach((key) => {
    const col = camelToSnake(key);
    let value = obj[key];
    if (value === undefined) return;
    if (isJsonCol(col) && value !== null && typeof value === "object") {
      value = jsonify ? JSON.stringify(value) : value;
    }
    out[col] = value;
  });
  return out;
}

function fromRows(rows) {
  return (rows || []).map(fromRow);
}

module.exports = {
  JSON_COLS,
  BOOL_COLS,
  snakeToCamel,
  camelToSnake,
  isJsonCol,
  isBoolCol,
  fromRow,
  toRow,
  fromRows,
};
