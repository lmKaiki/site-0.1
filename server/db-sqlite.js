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
const map = require("./map");

let db = null;

/* ---------- DDL (espelho do schema real do Supabase) ----------
   Este espelho reflete o schema ATUAL da conta Supabase, que ainda
   NÃO recebeu a migração aditiva (supabase/migrations/0001_nexo_backend.sql).
   Quando essa migração for aplicada, as mesmas colunas precisam ser
   acrescentadas AQUI — de preferência com CREATE TABLE ... IF NOT EXISTS
   já incluindo-as — para que o dev local e a produção continuem iguais.
   Enquanto isso os dois drivers respondem igual: 503 schema_pending
   nas operações que dependem dessas colunas. */
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
  updated_at TEXT,
  is_group INTEGER,
  name TEXT,
  icon TEXT,
  admin_id TEXT,
  member_count INTEGER
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
  created_at TEXT,
  type TEXT
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
  discoverable INTEGER NOT NULL DEFAULT 0,
  appearance TEXT,
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
  created_at TEXT,
  icon TEXT,
  description TEXT
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
  created_by TEXT,
  overrides TEXT,
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
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  code TEXT,
  opener_id TEXT,
  subject TEXT,
  reason TEXT,
  status TEXT,
  channel_id TEXT,
  assigned_to TEXT,
  closed_by TEXT,
  closed_at TEXT,
  close_reason TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS ticket_participants (
  ticket_id TEXT,
  user_id TEXT,
  added_at TEXT
);
CREATE TABLE IF NOT EXISTS ticket_panels (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  channel_id TEXT,
  message_id TEXT,
  title TEXT,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS emojis (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  name TEXT,
  image TEXT,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS stickers (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  name TEXT,
  description TEXT,
  image TEXT,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_server_apps_server ON server_apps(server_id, app_id);
CREATE INDEX IF NOT EXISTS idx_emojis_server ON emojis(server_id, name);
CREATE INDEX IF NOT EXISTS idx_stickers_server ON stickers(server_id, name);
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
  upgradeAdditive();
  return db;
}

/* Upgrade aditivo de bancos locais já existentes.
   O CREATE TABLE IF NOT EXISTS NÃO acrescenta coluna em tabela que
   já existe: um tools/.nexo-local.db criado antes da migração 0003
   ficaria sem channels.created_by/overrides e o Bot Center recusaria
   (503 schema_pending) mesmo sendo sqlite. É o mesmo que o
   ALTER TABLE ADD COLUMN da migração 0003 faz no Supabase. */
function addColumnIfMissing(table, column, type) {
  try {
    const cols = open()
      .prepare('PRAGMA table_info("' + table + '")')
      .all();
    if (cols.some((c) => c.name === column)) return;
    open().exec('ALTER TABLE "' + table + '" ADD COLUMN "' + column + '" ' + type);
  } catch (e) {
    /* coluna já existe ou tabela sem permissão: segue — nada a fazer */
  }
}

function upgradeAdditive() {
  /* migração 0001 (aparência e descoberta do servidor) — sem estas
     colunas o "Mostrar no explorar" respondia 503 schema_pending no
     banco local: o mapa só persiste `discoverable` quando a coluna
     existe. DEFAULT 0 mantém todos os servidores atuais privados. */
  addColumnIfMissing("servers", "discoverable", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("servers", "appearance", "TEXT");
  /* cargos personalizados (migração 0005): o editor de cargo já
     mostrava ícone e descrição, mas a tabela não tinha as colunas —
     o createRole descartava os dois em silêncio. Colunas nulas não
     quebram cargo nenhum existente. */
  addColumnIfMissing("roles", "icon", "TEXT");
  addColumnIfMissing("roles", "description", "TEXT");
  addColumnIfMissing("channels", "created_by", "TEXT");
  addColumnIfMissing("channels", "overrides", "TEXT");
  /* migração 0004 (grupos privados nas DMs) — equivalente local do
     ALTER TABLE ADD COLUMN que roda no Supabase */
  addColumnIfMissing("dms", "is_group", "INTEGER");
  addColumnIfMissing("dms", "name", "TEXT");
  addColumnIfMissing("dms", "icon", "TEXT");
  addColumnIfMissing("dms", "admin_id", "TEXT");
  addColumnIfMissing("dms", "member_count", "INTEGER");
  /* mensagens de sistema do grupo precisam do tipo na tabela local */
  addColumnIfMissing("dm_messages", "type", "TEXT");
  /* reações (migração 0001): sem esta coluna, reagir respondia 503
     schema_pending no banco local — inclusive para emojis
     personalizados. DEFAULT '{}' mantém as mensagens atuais sem
     reação nenhuma, igual ao Supabase. */
  addColumnIfMissing("messages", "reactions", "TEXT");
  addColumnIfMissing("dm_messages", "reactions", "TEXT");
  /* membros duplicados não existem: o índice único é o piso do
     "não contar o mesmo usuário duas vezes" também no motor local */
  try {
    open().exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS ux_dm_members_conv_user " +
        "ON dm_members (conversation_id, user_id)"
    );
  } catch (e) {
    console.warn(
      "[nexo/sqlite] índice único de dm_members não criado (há linhas duplicadas?): " +
        e.message
    );
  }
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
      const marks = value.map(() => "?").join(",");
      clauses.push('"' + col + '" IN (' + marks + ")");
      value.forEach((v) => params.push(bind(v)));
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
        case "in": {
          const list = Array.isArray(value) ? value : [value];
          if (!list.length) clauses.push("0 = 1");
          else {
            clauses.push('"' + col + '" IN (' + list.map(() => "?").join(",") + ")");
            list.forEach((v) => params.push(bind(v)));
          }
          break;
        }
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
    return open().prepare(sql).all(...params);
  },

  insert(table, obj) {
    const line = bindRow(obj);
    const cols = Object.keys(line);
    const sql =
      'INSERT INTO "' + table + '" (' +
      cols.map((c) => '"' + c + '"').join(",") +
      ") VALUES (" + cols.map(() => "?").join(",") + ")";
    open().prepare(sql).run(...cols.map((c) => line[c]));
    return obj;
  },

  upsert(table, obj, conflictCol) {
    /* o conflictCol chega em formato do APP (camelCase) — o driver
       Supabase converte com camelToSnake antes de usar; aqui a mesma
       regra, senão ON CONFLICT("userId") quebra no sqlite real */
    const col = map.camelToSnake(conflictCol || "id");
    const line = bindRow(obj);
    const cols = Object.keys(line);
    const sql =
      'INSERT INTO "' + table + '" (' +
      cols.map((c) => '"' + c + '"').join(",") +
      ") VALUES (" + cols.map(() => "?").join(",") +
      ') ON CONFLICT("' + col + '") DO UPDATE SET ' +
      cols.filter((c) => c !== col).map((c) => '"' + c + '" = excluded."' + c + '"').join(", ");
    open().prepare(sql).run(...cols.map((c) => line[c]));
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
    const res = open().prepare(sql).run(...cols.map((c) => line[c]).concat(params));
    return Number(res.changes || 0);
  },

  remove(table, opts) {
    opts = opts || {};
    const params = [];
    const where = buildWhere(opts.where, opts.op, params);
    if (!where) throw new Error("remove exige filtro (recusa apagar a tabela inteira)");
    const res = open().prepare('DELETE FROM "' + table + '"' + where).run(...params);
    return Number(res.changes || 0);
  },

  count(table, opts) {
    opts = opts || {};
    const params = [];
    const where = buildWhere(opts.where, opts.op, params);
    const res = open().prepare('SELECT COUNT(*) AS n FROM "' + table + '"' + where).all(...params);
    return Number((res[0] && res[0].n) || 0);
  },
};

module.exports = driver;
