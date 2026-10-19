"use strict";
/* ============================================================
   NEXO · server/db
   Fachada única de banco. Escolhe o driver (Supabase ou
   SQLite) e FAZ A PONTE entre o modelo do aplicativo e o
   schema real (server/map.js), porque o schema que existe no
   Supabase tem colunas com outros nomes, timestamps timestamptz
   e dados espalhados por tabelas de apoio (prefs, dm_members,
   member_roles, message_reads).

   Regras daqui:
   · leitura sempre devolve o formato que a interface espera;
   · escrita só grava colunas que existem (campos que dependem
     da migração aditiva são gravados quando a coluna aparecer);
   · nada de "userId vindo do cliente" — autenticação é separada.
   ============================================================ */

const env = require("./env");
const { ApiError } = require("./errors");
const map = require("./map");

let driver = null;
const schemaCache = {};

function loadDriver() {
  if (driver) return driver;
  if (env.driver === "supabase") {
    if (!env.supabaseUrl) {
      throw new ApiError(
        503,
        "SUPABASE_URL não configurada. Configure a variável de ambiente SUPABASE_URL no backend (Netlify > Site configuration > Environment variables) e tente novamente.",
        "env_missing"
      );
    }
    if (!env.supabaseServiceRoleKey && !env.supabaseAnonKey) {
      throw new ApiError(
        503,
        "SUPABASE_SERVICE_ROLE_KEY não configurada. Configure a variável de ambiente SUPABASE_SERVICE_ROLE_KEY no ambiente da Function (Netlify > Environment variables). Ela nunca pode ser exposta ao navegador.",
        "env_missing"
      );
    }
    driver = require("./db-supabase");
  } else {
    driver = require("./db-sqlite");
  }
  try {
    driver.init();
  } catch (e) {
    throw new ApiError(503, "Não foi possível conectar ao banco de dados: " + e.message, "db_unavailable");
  }
  return driver;
}

function d() {
  return loadDriver();
}

/* Set de colunas reais por tabela (usado para não gravar coluna
   que não existe). SQLite = DDL local; Supabase = OpenAPI. */
async function schemaFor(table) {
  if (schemaCache[table]) return schemaCache[table];
  let cols = null;
  try {
    cols = await d().columns(table);
  } catch (e) {
    cols = null;
  }
  schemaCache[table] = cols || new Set();
  return schemaCache[table];
}

function whereOk(table, where, schema) {
  if (!schema || !schema.size) return true;
  return Object.keys(where || {}).every((col) => schema.has(col));
}

/* ---------------------------------------------------------
   SELECT
   --------------------------------------------------------- */
async function select(table, opts) {
  opts = opts || {};
  const schema = await schemaFor(table);
  const where = map.filterToRow(table, opts.where);
  if (where === null) return [];
  if (where && !whereOk(table, where, schema)) return [];

  const order = map.orderToRow(table, opts.order, opts.desc);

  if (table === "messages") return selectMessages(opts, schema);

  const rows = await d().select(table, {
    where,
    limit: opts.limit,
    order: order ? order.col : null,
    desc: order ? order.desc : false,
  });
  const app = (rows || []).map((r) => map.toApp(table, r, schema));

  if (table === "users") await joinUsers(app);
  else if (table === "memberships") await joinMemberships(app);
  else if (table === "dms") await joinDMs(app);
  else if (table === "roles") joinRoles(app, schema);

  return app;
}

/* mensagens: as de canal ficam em "messages", as de DM em "dm_messages" */
function splitMessages(filter) {
  const raw =
    (filter && (filter.channel_id || filter.channelId)) ||
    (filter && filter.conversation_id) ||
    null;
  if (raw === null || raw === undefined) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  const dm = list.filter((x) => String(x).indexOf("dm_") === 0);
  const ch = list.filter((x) => String(x).indexOf("dm_") !== 0);
  return { dm, ch };
}

/* o filtro de canal vira o de conversa na tabela de DMs */
function toDMWhere(where) {
  const out = {};
  Object.keys(where || {}).forEach((k) => {
    if (k === "channel_id" || k === "channelId") out.conversation_id = where[k];
    else out[k] = where[k];
  });
  return out;
}

async function selectMessages(opts, schema) {
  const where = map.filterToRow("messages", opts.where) || {};
  const split = splitMessages(opts.where);
  const order = opts.desc ? -1 : 1;

  async function grab(tableName, ids, extraWhere) {
    if (ids && !ids.length) return [];
    const w = Object.assign({}, extraWhere || {});
    /* messages.channel_id = dm_messages.conversation_id */
    const col = tableName === "dm_messages" ? "conversation_id" : "channel_id";
    if (ids) w[col] = ids;
    else if (w.channel_id !== undefined) {
      w[col] = w.channel_id;
      if (col !== "channel_id") delete w.channel_id;
    }
    if (!Object.keys(w).length) return [];
    const s = await schemaFor(tableName);
    if (!whereOk(tableName, w, s)) return [];
    const rows = await d().select(tableName, {
      where: w,
      limit: opts.limit,
      order: "created_at",
      desc: !!opts.desc,
    });
    const key = tableName === "dm_messages" ? "dm_messages" : "messages";
    return (rows || []).map((r) => map.toApp(key, r, s));
  }

  let out = [];
  if (where.id) {
    /* localizar uma mensagem sem saber de onde ela veio */
    const ids = Array.isArray(where.id) ? where.id : [where.id];
    out = (await grab("messages", null, { id: ids })).concat(
      await grab("dm_messages", null, { id: ids })
    );
  } else if (split) {
    out = (await grab("messages", split.ch)).concat(await grab("dm_messages", split.dm));
  } else {
    out = (await grab("messages", null, where)).concat(
      await grab("dm_messages", null, where)
    );
  }
  out.sort((a, b) => (a.createdAt - b.createdAt) * order);
  if (opts.limit && out.length > opts.limit) {
    out = opts.desc ? out.slice(0, opts.limit) : out.slice(out.length - opts.limit);
  }
  return out;
}

/* ---------------------------------------------------------
   joins necessários ao formato do app
   --------------------------------------------------------- */
async function joinUsers(users) {
  if (!users.length) return;
  const ids = users.map((u) => u.id);

  const prefs = await d().select("prefs", { where: map.filterToRow("prefs", { userId: ids }) });
  const byUser = {};
  (prefs || []).forEach((p) => {
    const data = map.parseJSON(p.data, null) || {};
    delete data.sessions; /* nunca devolve a lista de sessões ao cliente */
    byUser[p.user_id] = data;
  });
  users.forEach((u) => {
    const extra = byUser[u.id] || {};
    Object.keys(extra).forEach((k) => {
      if (u[k] === undefined || k === "sessions") u[k] = extra[k];
    });
    if (!Array.isArray(u.blocks)) u.blocks = [];
  });

  const presence = await d().select("presence", { where: map.filterToRow("presence", { userId: ids }) });
  const status = {};
  (presence || []).forEach((p) => (status[p.user_id] = p.status));
  users.forEach((u) => {
    if (status[u.id]) u.status = status[u.id];
    else if (u.status === undefined || u.status === null) u.status = "offline";
  });

  const blocks = await d().select("blocks", { where: map.filterToRow("blocks", { blockerId: ids }) });
  const mine = {};
  (blocks || []).forEach((b) => {
    mine[b.blocker_id] = mine[b.blocker_id] || [];
    if (mine[b.blocker_id].indexOf(b.blocked_id) === -1) mine[b.blocker_id].push(b.blocked_id);
  });
  users.forEach((u) => (u.blocks = mine[u.id] || u.blocks || []));
}

async function joinMemberships(list) {
  if (!list.length) return;
  const users = list.map((m) => m.userId);
  const rows = await d().select("member_roles", {
    where: map.filterToRow("member_roles", { userId: users }),
  });
  const pair = {};
  (rows || []).forEach((r) => (pair[r.user_id + ":" + r.server_id] = r.role_id));
  list.forEach((m) => {
    const k = m.userId + ":" + m.serverId;
    if (pair[k] !== undefined) m.roleId = pair[k];
    if (m.roleId === undefined) m.roleId = null;
    if (!m.permissions) m.permissions = {};
    if (!Array.isArray(m.extraRoleIds)) m.extraRoleIds = [];
    if (!m.id) m.id = m.serverId + ":" + m.userId;
  });
}

async function joinDMs(list) {
  if (!list.length) return;
  const ids = list.map((d2) => d2.id);
  const members = await d().select("dm_members", {
    where: map.filterToRow("dm_members", { conversationId: ids }),
  });
  const parts = {};
  (members || []).forEach((m) => {
    parts[m.conversation_id] = parts[m.conversation_id] || [];
    if (parts[m.conversation_id].indexOf(m.user_id) === -1)
      parts[m.conversation_id].push(m.user_id);
  });
  const reads = await d().select("message_reads", {
    where: map.filterToRow("message_reads", { conversationId: ids }),
  });
  const readMap = {};
  (reads || []).forEach((r) => {
    readMap[r.conversation_id] = readMap[r.conversation_id] || {};
    readMap[r.conversation_id][r.user_id] = map.ms(r.last_read_at);
  });
  list.forEach((dm) => {
    dm.participants = parts[dm.id] || [];
    dm.reads = readMap[dm.id] || {};
    if (dm.muted === undefined) dm.muted = false;
  });
}

function joinRoles(list, schema) {
  const hasCol = !schema || !schema.size || schema.has("is_default");
  list.forEach((r) => {
    if (hasCol) {
      if (r.isDefault === undefined || r.isDefault === null) r.isDefault = false;
    } else {
      /* coluna is_default ainda não existe: o cargo criado na abertura
         do servidor é o de posição 0 */
      r.isDefault = Number(r.position) === 0;
    }
  });
}

/* ---------------------------------------------------------
   INSERT
   --------------------------------------------------------- */
async function insert(table, app) {
  const schema = await schemaFor(table);

  if (table === "users") return insertUser(app, schema);

  if (table === "messages") {
    const isDM = String(app.channelId || "").indexOf("dm_") === 0;
    const target = isDM ? "dm_messages" : "messages";
    return insertSimple(target, app, await schemaFor(target));
  }

  if (table === "memberships") {
    const row = map.toRow("memberships", app, schema);
    await insertSimple("memberships", row, schema, true);
    if (app.roleId) {
      const mrSchema = await schemaFor("member_roles");
      await d().remove(
        "member_roles",
        { where: map.filterToRow("member_roles", { serverId: app.serverId, userId: app.userId }) }
      );
      await insertSimple(
        "member_roles",
        map.toRow(
          "member_roles",
          { serverId: app.serverId, userId: app.userId, roleId: app.roleId },
          mrSchema
        ),
        mrSchema,
        true
      );
    }
    return app;
  }

  if (table === "dms") {
    await insertSimple("dms", map.toRow("dms", app, schema), schema, true);
    const rows = (app.participants || []).map((uid) => ({
      conversation_id: app.id,
      user_id: uid,
      joined_at: map.iso(Date.now()),
    }));
    for (const r of rows) {
      await d().remove("dm_members", { where: { conversation_id: r.conversation_id, user_id: r.user_id } });
      await d().insert("dm_members", r);
    }
    return app;
  }

  if (table === "presence") {
    const row = map.toRow("presence", app, schema);
    row.user_id = row.user_id || app.userId;
    row.updated_at = row.updated_at || map.iso(Date.now());
    await d().remove("presence", { where: { user_id: row.user_id } });
    await d().insert("presence", row);
    return app;
  }

  if (table === "prefs") {
    const row = map.toRow("prefs", app, schema);
    row.user_id = row.user_id || app.userId;
    row.updated_at = map.iso(Date.now());
    await d().remove("prefs", { where: { user_id: row.user_id } });
    await d().insert("prefs", row);
    return app;
  }

  if (table === "blocks") {
    const row = map.toRow("blocks", app, schema);
    return insertSimple("blocks", row, schema, true);
  }

  return insertSimple(table, map.toRow(table, app, schema), schema, true);
}

async function insertSimple(table, row, schema, raw) {
  const obj = raw ? row : map.toRow(table, row, schema);
  map.applyRequired(table, obj);
  if (schema && schema.size) {
    Object.keys(obj).forEach((col) => {
      if (!schema.has(col)) delete obj[col];
    });
  }
  return d().insert(table, obj);
}

async function insertUser(app, schema) {
  const row = map.toRow("users", app, schema);
  await insertSimple("users", row, schema, true);

  /* extras que não têm coluna: prefs.data */
  const extra = {};
  ["statusText", "theme", "profileColor", "statusEmoji", "customStatus", "region",
    "privacy", "birth", "demo", "email"].forEach((k) => {
    if (app[k] !== undefined) extra[k] = app[k];
  });
  await d().remove("prefs", { where: { user_id: app.id } });
  await d().insert("prefs", { user_id: app.id, data: extra, updated_at: map.iso(Date.now()) });

  await d().remove("presence", { where: { user_id: app.id } });
  await d().insert("presence", {
    user_id: app.id,
    status: app.status || "online",
    last_seen_at: map.iso(Date.now()),
    updated_at: map.iso(Date.now()),
  });
  return app;
}

/* ---------------------------------------------------------
   UPDATE
   --------------------------------------------------------- */
async function update(table, opts, patch) {
  const schema = await schemaFor(table);
  const where = map.filterToRow(table, opts.where);
  if (where === null || (where && !whereOk(table, where, schema))) return 0;

  if (table === "messages") {
    const n1 = await safeUpdate("messages", where, patch, schema);
    const n2 = await safeUpdate(
      "dm_messages",
      toDMWhere(where),
      patch,
      await schemaFor("dm_messages")
    );
    return n1 + n2;
  }

  if (table === "users") return updateUser(where, patch, schema);

  if (table === "memberships") return updateMembership(where, patch, schema);

  if (table === "dms") {
    let n = 0;
    const reads = patch.reads;
    const rest = Object.assign({}, patch);
    delete rest.reads;
    delete rest.muted;
    if (Object.keys(rest).length)
      n += await safeUpdate("dms", where, rest, schema);
    if (reads) {
      const dmIds = await resolveDmIds(where);
      for (const dmId of dmIds) {
        for (const uid of Object.keys(reads)) {
          await d().remove("message_reads", {
            where: { conversation_id: dmId, user_id: uid },
          });
          await d().insert("message_reads", {
            conversation_id: dmId,
            user_id: uid,
            last_read_at: map.iso(reads[uid]),
            last_read_message_id: null,
            updated_at: map.iso(Date.now()),
          });
        }
      }
      n++;
    }
    return n;
  }

  return safeUpdate(table, where, patch, schema);
}

async function resolveDmIds(where) {
  if (where.id) return Array.isArray(where.id) ? where.id : [where.id];
  const rows = await d().select("dms", { where, limit: 500 });
  return (rows || []).map((r) => r.id);
}

/* memberships não tem coluna "id": a chave é server_id+user_id */
function membershipFilter(where) {
  const out = {};
  if (where.id !== undefined) {
    const parts = map.idToParts("memberships", Array.isArray(where.id) ? where.id[0] : where.id);
    if (parts) {
      out.server_id = parts.serverId;
      out.user_id = parts.userId;
    }
  }
  if (where.server_id !== undefined) out.server_id = where.server_id;
  if (where.user_id !== undefined) out.user_id = where.user_id;
  return out;
}

async function safeUpdate(table, where, patch, schema) {
  const row = map.toRow(table, patch, schema);
  if (schema && schema.size) {
    Object.keys(row).forEach((col) => {
      if (!schema.has(col)) delete row[col];
    });
  }
  if (!Object.keys(row).length) return 0;
  return d().update(table, { where }, row);
}

async function updateUser(where, patch, schema) {
  const ids = Array.isArray(where.id) ? where.id : [where.id];
  const userCols = {};
  const extras = {};
  Object.keys(patch).forEach((k) => {
    if (["statusText", "theme", "profileColor", "statusEmoji", "customStatus",
      "region", "privacy", "birth", "demo", "email"].indexOf(k) > -1) extras[k] = patch[k];
    else if (k === "status") return; /* vai para presence */
    else userCols[k] = patch[k];
  });

  if (Object.keys(userCols).length)
    await safeUpdate("users", where, userCols, schema);

  if (Object.keys(extras).length) {
    for (const uid of ids) {
      const rows = await d().select("prefs", { where: { user_id: uid }, limit: 1 });
      const current = (rows && rows[0] && map.parseJSON(rows[0].data, null)) || {};
      const next = Object.assign({}, current, extras);
      await d().remove("prefs", { where: { user_id: uid } });
      await d().insert("prefs", {
        user_id: uid,
        data: next,
        updated_at: map.iso(Date.now()),
      });
    }
  }

  if (patch.status !== undefined) {
    for (const uid of ids) {
      await d().remove("presence", { where: { user_id: uid } });
      await d().insert("presence", {
        user_id: uid,
        status: patch.status,
        last_seen_at: map.iso(Date.now()),
        updated_at: map.iso(Date.now()),
      });
    }
  }
  return ids.length;
}

async function updateMembership(where, patch, schema) {
  const filter = membershipFilter(where);
  if (!Object.keys(filter).length) return 0;

  const rolePatch = {};
  if (patch.roleId !== undefined) rolePatch.roleId = patch.roleId;
  const rest = Object.assign({}, patch);
  delete rest.roleId;
  delete rest.permissions;
  delete rest.extraRoleIds;

  let n = 0;
  if (Object.keys(rest).length) {
    const row = map.toRow("memberships", rest, schema);
    Object.keys(row).forEach((col) => {
      if (schema && schema.size && !schema.has(col)) delete row[col];
    });
    if (Object.keys(row).length) n += await d().update("memberships", { where: filter }, row);
  }

  if (rolePatch.roleId !== undefined) {
    await d().remove("member_roles", { where: filter });
    if (rolePatch.roleId) {
      await d().insert("member_roles", {
        server_id: filter.server_id,
        user_id: filter.user_id,
        role_id: rolePatch.roleId,
      });
    }
    n++;
  }
  return n;
}

/* ---------------------------------------------------------
   REMOVE
   --------------------------------------------------------- */
async function remove(table, opts) {
  const schema = await schemaFor(table);
  const where = map.filterToRow(table, opts.where);
  if (where === null || (where && !whereOk(table, where, schema))) return 0;

  if (table === "messages") {
    const n1 = await d().remove("messages", { where });
    const n2 = await d().remove("dm_messages", { where: toDMWhere(where) });
    return n1 + n2;
  }

  if (table === "memberships") {
    const filter = membershipFilter(where);
    if (!Object.keys(filter).length) return 0;
    const n = await d().remove("memberships", { where: filter });
    const roleFilter = {};
    if (filter.server_id !== undefined) roleFilter.server_id = filter.server_id;
    if (filter.user_id !== undefined) roleFilter.user_id = filter.user_id;
    if (Object.keys(roleFilter).length)
      await d().remove("member_roles", { where: roleFilter });
    return n;
  }

  if (table === "dms") {
    const ids = await resolveDmIds(where);
    if (!ids.length) return 0;
    const n = await d().remove("dms", { where: { id: ids } });
    await d().remove("dm_members", { where: { conversation_id: ids } });
    await d().remove("message_reads", { where: { conversation_id: ids } });
    return n;
  }

  if (table === "users") {
    const ids = Array.isArray(where.id) ? where.id : [where.id];
    const n = await d().remove("users", { where });
    await d().remove("prefs", { where: { user_id: ids } });
    await d().remove("presence", { where: { user_id: ids } });
    await d().remove("blocks", { where: { blocker_id: ids } });
    return n;
  }

  return d().remove(table, { where });
}

async function count(table, opts) {
  const schema = await schemaFor(table);
  const where = map.filterToRow(table, (opts && opts.where) || {});
  if (where === null || (where && !whereOk(table, where, schema))) return 0;

  if (table === "messages") {
    const rows = await selectMessages({ where: opts.where }, schema);
    return rows.length;
  }
  return d().count(table, { where });
}

/* ---------------------------------------------------------
   upsert simplificado (remove + insert) — não depende de PK
   --------------------------------------------------------- */
async function upsert(table, app) {
  if (table === "presence" || table === "prefs") return insert(table, app);
  const schema = await schemaFor(table);
  const row = map.toRow(table, app, schema);
  const keyCol = row.id !== undefined ? "id" : null;
  if (keyCol) await d().remove(table, { where: { id: row.id } });
  return insertSimple(table, row, schema, true);
}

/* ---------------------------------------------------------
   utilidades extras usadas pelos handlers
   --------------------------------------------------------- */
async function mutedDms(userId) {
  const rows = await d().select("prefs", { where: { user_id: userId }, limit: 1 });
  const data = (rows && rows[0] && map.parseJSON(rows[0].data, null)) || {};
  return Array.isArray(data.mutedDms) ? data.mutedDms : [];
}

async function setMutedDm(userId, dmId, muted) {
  const rows = await d().select("prefs", { where: { user_id: userId }, limit: 1 });
  const data = (rows && rows[0] && map.parseJSON(rows[0].data, null)) || {};
  const list = Array.isArray(data.mutedDms) ? data.mutedDms.slice() : [];
  const i = list.indexOf(dmId);
  if (muted && i === -1) list.push(dmId);
  if (!muted && i > -1) list.splice(i, 1);
  data.mutedDms = list;
  await d().remove("prefs", { where: { user_id: userId } });
  await d().insert("prefs", {
    user_id: userId,
    data,
    updated_at: map.iso(Date.now()),
  });
  return list;
}

async function readPrefs(userId) {
  const rows = await d().select("prefs", { where: { user_id: userId }, limit: 1 });
  return (rows && rows[0] && map.parseJSON(rows[0].data, null)) || {};
}

async function writePrefs(userId, data) {
  await d().remove("prefs", { where: { user_id: userId } });
  await d().insert("prefs", {
    user_id: userId,
    data: data || {},
    updated_at: map.iso(Date.now()),
  });
  return data;
}

/* lança erro claro quando uma opção depende de coluna que ainda
   não existe no banco (migração aditiva pendente) — nunca
   descarta o dado em silêncio */
async function assertWritable(table, appField, hint) {
  const schema = await schemaFor(table);
  if (!schema || !schema.size) return true;
  const col = map.colOf(table, appField) || appField;
  if (schema.has(col)) return true;
  throw new ApiError(
    503,
    hint ||
      "Esta operação não está disponível neste banco ainda. Execute a migração do Nexo (supabase/migrations/0001_nexo_backend.sql) e tente novamente.",
    "schema_pending"
  );
}

module.exports = {
  init() {
    loadDriver();
  },
  get name() {
    try {
      return loadDriver().name;
    } catch (e) {
      return env.driver;
    }
  },
  get driverName() {
    return env.driver;
  },
  schemaFor,
  assertWritable,
  select,
  insert,
  update,
  remove,
  count,
  upsert,
  mutedDms,
  setMutedDm,
  readPrefs,
  writePrefs,
  _raw: d,
};
