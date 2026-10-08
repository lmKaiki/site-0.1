"use strict";
/* ============================================================
   NEXO · server/db-sqlite
   Driver SQLite (node:sqlite, zero dependências) para
   desenvolvimento local e testes. O DDL é um ESPPELO exato do
   schema que existe no Supabase — mesmo nome de colunas, mesmos
   tipos de texto/ISO — para que a mesma camada de mapeamento
   (server/map.js) e os mesmos handlers funcionem igual nos dois.

   Transporte burro: não converte snake/camel nem datas.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const env = require("./env");

let db = null;

/* ---------- DDL (espelho do schema real do Supabase) ---------- */
const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  password_hash TEXT,
  avatar TEXT,
  banner TEXT,
  bio TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS presence (
  user_id TEXT PRIMARY KEY,
  status TEXT,
  last_seen_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS prefs (
  user_id TEXT PRIMARY KEY,
  data TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  friend_id TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  sender_id TEXT,
  receiver_id TEXT,
  status TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT,
  blocked_id TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS dms (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS dm_members (
  conversation_id TEXT,
  user_id TEXT,
  joined_at TEXT
);
CREATE TABLE IF NOT EXISTS message_reads (
  conversation_id TEXT,
  user_id TEXT,
  last_read_at TEXT,
  last_read_message_id TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS dm_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  sender_id TEXT,
  content TEXT,
  edited_at TEXT,
  deleted_at TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  sender_id TEXT,
  content TEXT,
  reply_to_id TEXT,
  edited_at TEXT,
  deleted_at TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  name TEXT,
  icon TEXT,
  banner TEXT,
  description TEXT,
  is_official INTEGER,
  official_key TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS memberships (
  server_id TEXT,
  user_id TEXT,
  joined_at TEXT,
  nickname TEXT
);
CREATE TABLE IF NOT EXISTS member_roles (
  server_id TEXT,
  user_id TEXT,
  role_id TEXT
);
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  name TEXT,
  color TEXT,
  position INTEGER,
  permissions TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  name TEXT,
  position INTEGER,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  category_id TEXT,
  name TEXT,
  type TEXT,
  position INTEGER,
  topic TEXT,
  permissions TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  created_by TEXT,
  code TEXT,
  expires_at TEXT,
  max_uses INTEGER,
  uses INTEGER,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS bans (
  server_id TEXT,
  user_id TEXT,
  banned_by TEXT,
  reason TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  type TEXT,
  title TEXT,
  body TEXT,
  data TEXT,
  read_at TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  actor_id TEXT,
  action TEXT,
  target_id TEXT,
  data TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  avatar TEXT,
  category TEXT,
  developer TEXT,
  permissions TEXT,
  commands TEXT,
  enabled INTEGER,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS server_apps (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  app_id TEXT,
  installed_by TEXT,
  permissions TEXT,
  enabled INTEGER,
  configuration TEXT,
  installed_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS voice (
  server_id TEXT,
  channel_id TEXT,
  user_id TEXT,
  muted INTEGER,
  deafened INTEGER,
  camera INTEGER,
  screen_share INTEGER,
  joined_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_server_apps_server ON server_apps(server_id, app_id);
CREATE INDEX IF NOT EXISTS idx_voice_server ON voice(server_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver ON friend_requests(receiver_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_sender ON friend_requests(sender_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships(friend_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dm_messages_conv ON dm_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memberships_server ON memberships(server_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_member_roles_server ON member_roles(server_id);
CREATE INDEX IF NOT EXISTS idx_roles_server ON roles(server_id);
CREATE INDEX IF NOT EXISTS idx_categories_server ON categories(server_id, position);
CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id);
CREATE INDEX IF NOT EXISTS idx_bans_server ON bans(server_id, user_id);
CREATE INDEX IF NOT EXISTS idx_logs_server ON logs(server_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dm_members_conv ON dm_members(conversation_id);
CREATE INDEX IF NOT EXISTS idx_message_reads_conv ON message_reads(conversation_id);
`;

function open() {
  if (db) return db;
  const file = env.sqliteFile;
  if (file !== ":memory:") {
    const dir = path.dirname(path.resolve(process.cwd(), file));
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {}
  }
  db = new DatabaseSync(file === ":memory:" ? ":memory:" : path.resolve(process.cwd(), file));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec(DDL);
  return db;
}

/* objetos viram texto (SQLite não liga objeto em coluna TEXT) */
function bind(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function bindRow(obj) {
  const out = {};
  Object.keys(obj).forEach((k) => (out[k] = bind(obj[k])));
  return out;
}

/* ---------- filtros ---------- */
function buildWhere(where, op, params) {
  const clauses = [];
  const push = (col, clause, value) => {
    clauses.push(clause);
    params.push(value);
  };

  Object.keys(where || {}).forEach((rawKey) => {
    const col = rawKey;
    const value = where[rawKey];
    if (value === undefined) return;
    if (value === null) {
      clauses.push('"' + col + '" IS NULL');
      return;
    }
    if (Array.isArray(value)) {
      if (!value.length) {
        clauses.push("0 = 1");
        return;
      }
      push(col, '"' + col + '" IN (' + value.map(() => "?").join(",") + ")", value);
      return;
    }
    push(col, '"' + col + '" = ?', bind(value));
  });

  Object.keys(op || {}).forEach((rawKey) => {
    const col = rawKey;
    const spec = op[rawKey] || {};
    Object.keys(spec).forEach((operator) => {
      const value = spec[operator];
      switch (operator) {
        case "neq":
          push(col, '"' + col + '" IS DISTINCT FROM ?', bind(value));
          break;
        case "gt":
          push(col, '"' + col + '" > ?', bind(value));
          break;
        case "gte":
          push(col, '"' + col + '" >= ?', bind(value));
          break;
        case "lt":
          push(col, '"' + col + '" < ?', bind(value));
          break;
        case "lte":
          push(col, '"' + col + '" <= ?', bind(value));
          break;
        case "like":
          push(col, '"' + col + '" LIKE ?', bind(value));
          break;
        case "ilike":
          push(col, 'LOWER("' + col + '") LIKE LOWER(?)', bind(value));
          break;
        case "in":
          if (!value || !value.length) clauses.push("0 = 1");
          else push(col, '"' + col + '" IN (' + value.map(() => "?").join(",") + ")", value);
          break;
        case "isnull":
          clauses.push('"' + col + '" IS ' + (value ? "NULL" : "NOT NULL"));
          break;
        default:
          push(col, '"' + col + '" = ?', bind(value));
      }
    });
  });

  return clauses.length ? " WHERE " + clauses.join(" AND ") : "";
}

const driver = {
  name: "sqlite",

  init() {
    open();
  },

  /* colunas reais por tabela (PRAGMA) */
  columns(table) {
    const rows = open().prepare('PRAGMA table_info("' + table + '")').all();
    return new Set(rows.map((r) => r.name));
  },

  select(table, opts) {
    opts = opts || {};
    const params = [];
    let sql = 'SELECT * FROM "' + table + '"' + buildWhere(opts.where, opts.op, params);
    if (opts.order) {
      const dir = opts.desc ? "DESC" : "ASC";
      sql += ' ORDER BY "' + opts.order + '" ' + dir;
    }
    if (opts.limit) sql += " LIMIT " + Math.max(0, Math.floor(opts.limit));
    return open().prepare(sql).all(params);
  },

  insert(table, obj) {
    const line = bindRow(obj);
    const cols = Object.keys(line);
    const sql =
      'INSERT INTO "' + table + '" (' +
      cols.map((c) => '"' + c + '"').join(",") +
      ") VALUES (" + cols.map(() => "?").join(",") + ")";
    open().prepare(sql).run(cols.map((c) => line[c]));
    return obj;
  },

  upsert(table, obj, conflictCol) {
    const line = bindRow(obj);
    const cols = Object.keys(line);
    const target = conflictCol || "id";
    const sql =
      'INSERT INTO "' + table + '" (' +
      cols.map((c) => '"' + c + '"').join(",") +
      ") VALUES (" + cols.map(() => "?").join(",") +
      ') ON CONFLICT("' + target + '") DO UPDATE SET ' +
      cols.filter((c) => c !== target).map((c) => '"' + c + '" = excluded."' + c + '"').join(", ");
    open().prepare(sql).run(cols.map((c) => line[c]));
    return obj;
  },

  update(table, opts, patch) {
    opts = opts || {};
    const params = [];
    const where = buildWhere(opts.where, opts.op, params);
    const line = bindRow(patch);
    const cols = Object.keys(line);
    if (!cols.length) return 0;
    const sql =
      'UPDATE "' + table + '" SET ' + cols.map((c) => '"' + c + '" = ?').join(", ") + where;
    const res = open().prepare(sql).run(cols.map((c) => line[c]).concat(params));
    return Number(res.changes || 0);
  },

  remove(table, opts) {
    opts = opts || {};
    const params = [];
    const where = buildWhere(opts.where, opts.op, params);
    if (!where) throw new Error("remove exige filtro (recusa apagar a tabela inteira)");
    const res = open().prepare('DELETE FROM "' + table + '"' + where).run(params);
    return Number(res.changes || 0);
  },

  count(table, opts) {
    opts = opts || {};
    const params = [];
    const where = buildWhere(opts.where, opts.op, params);
    const res = open().prepare('SELECT COUNT(*) AS n FROM "' + table + '"' + where).all(params);
    return Number((res[0] && res[0].n) || 0);
  },
};

module.exports = driver;
