"use strict";
/* ============================================================
   NEXO · server/map
   Fronteira de schema: o que a INTERFACE trata como modelo de
   aplicação (camelCase, datas em ms) e o que o BANCO grava
   (snake_case, timestamps timestamptz).

   · alias   → colunas com nome diferente no banco
   · iso     → campos em ms que viram ISO 8601 ao gravar
   · json    → colunas text que guardam JSON (stringify/parse)
   · jsonb   → colunas jsonb (objeto direto, NÃO stringificar)
   · key     → chave composta quando a tabela não tem "id"
   · skip    → campos só existem após a migração aditiva
               (lidos com padrão, gravados só se a coluna existir)
   ============================================================ */

function iso(ms) {
  if (ms === null || ms === undefined) return null;
  if (typeof ms === "string") return ms;
  const n = Number(ms);
  if (!n || !isFinite(n)) return null;
  return new Date(n).toISOString();
}

function ms(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const t = Date.parse(v);
  return isNaN(t) ? null : t;
}

function snakeToCamel(key) {
  return String(key).replace(/_([a-z])/g, (m, c) => c.toUpperCase());
}

function camelToSnake(key) {
  return String(key)
    .replace(/([A-Z])/g, (m) => "_" + m.toLowerCase())
    .replace(/^[A-Z]/, (m) => m.toLowerCase());
}

/* ------------------------------------------------------------
   metadado por tabela
   ------------------------------------------------------------ */
const T = {
  users: {
    key: "id",
    alias: { displayName: "display_name", passwordHash: "password_hash" },
    iso: ["createdAt", "updatedAt"],
    json: ["avatar", "banner"],
    /* sem coluna própria no banco: vêm de presence/blocks/prefs */
    virtual: ["status", "statusText", "theme", "profileColor", "statusEmoji",
      "customStatus", "region", "privacy", "blocks", "demo", "birth", "email"],
    drop: ["status", "statusText", "theme", "profileColor", "statusEmoji",
      "customStatus", "region", "privacy", "blocks", "demo", "birth", "email"],
  },
  presence: {
    key: "userId",
    alias: { userId: "user_id", lastSeenAt: "last_seen_at", updatedAt: "updated_at" },
    iso: ["lastSeenAt", "updatedAt"],
    noId: true,
  },
  prefs: {
    key: "userId",
    alias: { userId: "user_id" },
    jsonb: ["data"],
    iso: ["updatedAt"],
    noId: true,
  },
  friendships: {
    key: "id",
    alias: { userAId: "user_id", userBId: "friend_id" },
    iso: ["createdAt"],
  },
  friend_requests: {
    key: "id",
    alias: { senderId: "sender_id", receiverId: "receiver_id" },
    iso: ["createdAt", "updatedAt"],
  },
  blocks: {
    key: "[blockerId,blockedId]",
    alias: { blockerId: "blocker_id", blockedId: "blocked_id" },
    iso: ["createdAt"],
    noId: true,
  },
  dms: {
    key: "id",
    iso: ["createdAt", "updatedAt"],
    /* participantes/leitura/mudo moram em outras tabelas */
    drop: ["participants", "reads", "muted"],
  },
  dm_members: {
    key: "[conversationId,userId]",
    alias: { conversationId: "conversation_id", userId: "user_id" },
    iso: ["joinedAt"],
    noId: true,
  },
  message_reads: {
    key: "[conversationId,userId]",
    alias: {
      conversationId: "conversation_id", userId: "user_id",
      lastReadAt: "last_read_at", lastReadMessageId: "last_read_message_id",
    },
    iso: ["lastReadAt", "updatedAt"],
    noId: true,
  },
  dm_messages: {
    key: "id",
    alias: {
      conversationId: "conversation_id", senderId: "sender_id",
      authorId: "sender_id", editedAt: "edited_at", deletedAt: "deleted_at",
      channelId: "conversation_id",
    },
    iso: ["createdAt", "updatedAt", "editedAt", "deletedAt"],
    drop: ["attachments", "reactions", "pinned", "type", "conversationId"],
  },
  messages: {
    key: "id",
    alias: {
      authorId: "sender_id", senderId: "sender_id",
      updatedAt: "edited_at", conversationId: "conversation_id",
    },
    iso: ["createdAt", "updatedAt", "editedAt"],
    drop: ["attachments", "reactions", "pinned", "type", "conversationId", "deletedAt"],
  },
  servers: {
    key: "id",
    alias: { ownerId: "owner_id" },
    iso: ["createdAt", "updatedAt"],
    json: ["icon", "banner"],
    drop: ["appearance", "discoverable"],
  },
  memberships: {
    key: "[serverId,userId]",
    alias: { joinedAt: "joined_at", roleId: null },
    iso: ["joinedAt", "createdAt"],
    drop: ["permissions", "extraRoleIds", "createdAt"],
  },
  member_roles: {
    key: "[serverId,userId]",
    alias: { serverId: "server_id", userId: "user_id", roleId: "role_id" },
    noId: true,
  },
  roles: {
    key: "id",
    alias: { isDefault: "is_default" },
    iso: ["createdAt"],
    jsonb: ["permissions"],
    drop: ["isDefault"],
  },
  categories: {
    key: "id",
    alias: { order: "position" },
    iso: ["createdAt"],
    drop: ["collapsed", "perms"],
  },
  channels: {
    key: "id",
    alias: { perms: "permissions", order: "position", createdBy: "created_by" },
    iso: ["createdAt", "updatedAt"],
    jsonb: ["permissions"],
    drop: ["inheritPerms", "overrides", "updatedAt"],
  },
  invites: {
    key: "id",
    alias: { creatorId: "created_by", maxUses: "max_uses" },
    iso: ["createdAt", "expiresAt"],
  },
  bans: {
    key: "[serverId,userId]",
    alias: { byId: "banned_by" },
    iso: ["at", "createdAt"],
    noId: true,
  },
  notifications: {
    key: "id",
    alias: { text: "title", meta: "data", at: "created_at", read: "read_at" },
    iso: ["at", "createdAt"],
    jsonb: ["data"],
  },
  logs: {
    key: "id",
    alias: { meta: "data", at: "created_at", target: "target_id" },
    iso: ["at", "createdAt"],
    jsonb: ["data"],
  },
  /* catálogo oficial de apps/bots — identidade de bot, NÃO de pessoa */
  apps: {
    key: "id",
    iso: ["createdAt"],
    jsonb: ["permissions", "commands"],
  },
  /* instalação de um app dentro de um servidor (uma por app/servidor) */
  server_apps: {
    key: "id",
    alias: { appId: "app_id", installedBy: "installed_by" },
    iso: ["installedAt", "updatedAt"],
    jsonb: ["permissions", "configuration"],
  },
  /* presença em canal de voz (estado real do canal, por servidor) */
  voice: {
    key: "[serverId,userId]",
    alias: { screenShare: "screen_share" },
    iso: ["joinedAt", "updatedAt"],
    noId: true,
  },
};

/* ------------------------------------------------------------
   leitura: linha do banco → objeto do app
   ------------------------------------------------------------ */
function toApp(table, row, schemaCols) {
  const meta = T[table];
  if (!meta) return row;
  const out = {};
  const aliasByCol = {};
  Object.keys(meta.alias || {}).forEach((appKey) => {
    const col = meta.alias[appKey];
    if (!col) return;
    /* uma coluna pode alimentar mais de um campo do app
       (ex.: sender_id → authorId e senderId) */
    aliasByCol[col] = aliasByCol[col] || [];
    if (aliasByCol[col].indexOf(appKey) === -1) aliasByCol[col].push(appKey);
  });

  Object.keys(row || {}).forEach((col) => {
    const targets = aliasByCol[col] || [snakeToCamel(col)];
    let value = row[col];
    targets.forEach((appKey) => {
      let v = value;
      if ((meta.iso || []).indexOf(appKey) > -1) v = ms(v);
      else if ((meta.json || []).indexOf(appKey) > -1) v = parseJSON(v, null);
      else if ((meta.jsonb || []).indexOf(appKey) > -1) v = parseJSON(v, null);
      else if (col === "read_at" && table === "notifications") v = !!v;
      out[appKey] = v;
    });
  });

  /* campos sem coluna: caem no padrão (existirão após a migração) */
  (meta.drop || []).forEach((k) => {
    if (out[k] === undefined || out[k] === null) out[k] = defaultFor(table, k);
  });

  /* tabelas sem coluna "id" ganham a chave composta sintética
     (ex.: "sv_x:u_y") para que os handlers possam removê-las */
  if (meta.key && meta.key.charAt(0) === "[" && out.id === undefined) {
    const fields = meta.key.slice(1, -1).split(",");
    if (fields.every((f) => out[f] !== undefined && out[f] !== null)) {
      out.id = fields.map((f) => out[f]).join(":");
    }
  }
  return out;
}

function defaultFor(table, field) {
  switch (table + "." + field) {
    case "users.statusText": return "";
    case "users.theme": return "";
    case "users.profileColor": return null;
    case "users.statusEmoji": return "";
    case "users.customStatus": return "";
    case "users.demo": return false;
    case "users.birth": return null;
    case "users.blocks": return [];
    case "users.privacy": return { friendRequests: "all", dm: "all" };
    case "users.region": return null;
    case "users.status": return "online";
    case "servers.appearance": return { primary: "#35e0a8", secondary: "#8f83ff", backgroundImage: null, theme: "dark" };
    case "servers.discoverable": return false;
    case "memberships.permissions": return {};
    case "memberships.extraRoleIds": return [];
    case "memberships.createdAt": return null;
    case "categories.collapsed": return false;
    case "categories.perms": return {};
    case "channels.inheritPerms": return true;
    case "channels.overrides": return { view: "all", send: "all" };
    case "channels.updatedAt": return null;
    case "channels.createdBy": return null;
    case "roles.isDefault": return false;
    case "messages.attachments": return [];
    case "messages.reactions": return {};
    case "messages.pinned": return false;
    case "messages.type": return "user";
    case "messages.conversationId": return null;
    case "messages.deletedAt": return null;
    case "dm_messages.attachments": return [];
    case "dm_messages.reactions": return {};
    case "dm_messages.pinned": return false;
    case "dm_messages.type": return "user";
    case "dm_messages.conversationId": return null;
    case "dms.muted": return false;
    default: return null;
  }
}

function parseJSON(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }
  return fallback;
}

/* ------------------------------------------------------------
   escrita: objeto do app → linha do banco
   ------------------------------------------------------------ */
function toRow(table, app, schemaCols) {
  const meta = T[table];
  if (!meta) return app;
  const out = {};
  const used = {};

  Object.keys(app || {}).forEach((appKey) => {
    const value = app[appKey];
    if (value === undefined) return;
    if ((meta.drop || []).indexOf(appKey) > -1 && !columnExists(table, schemaCols, appKey)) return;
    if ((meta.virtual || []).indexOf(appKey) > -1) return;

    let col = Object.prototype.hasOwnProperty.call(meta.alias || {}, appKey)
      ? meta.alias[appKey]
      : camelToSnake(appKey);
    if (col === null || col === false) return;
    if (used[col]) return; /* mesma coluna, mantém o primeiro */

    let outValue = value;
    if ((meta.iso || []).indexOf(appKey) > -1) outValue = iso(value);
    else if ((meta.json || []).indexOf(appKey) > -1)
      outValue = value === null || value === undefined ? null : JSON.stringify(value);
    else if ((meta.jsonb || []).indexOf(appKey) > -1)
      outValue = value === null || value === undefined ? null : value;
    else if (table === "notifications" && appKey === "read")
      outValue = value ? iso(Date.now()) : null;

    if (col === "id" && meta.noId) return;
    used[col] = true;
    out[col] = outValue;
  });

  if (meta.key && meta.key.charAt(0) === "[" && out.id === undefined && !meta.noId) {
    out.id = keyToId(table, app);
  }
  if (table === "invites" && out.id === undefined && out.code) out.id = out.code;
  return out;
}

function columnExists(table, schemaCols, appKey) {
  if (!schemaCols) return false;
  return schemaCols.has(camelToSnake(appKey));
}

/* chave composta "[serverId,userId]" → id sintético */
function keyToId(table, app) {
  const meta = T[table];
  if (!meta || meta.key.charAt(0) !== "[") return undefined;
  const fields = meta.key.slice(1, -1).split(",");
  return fields.map((f) => (app && app[f] !== undefined && app[f] !== null ? app[f] : "?")).join(":");
}

function idToParts(table, id) {
  const meta = T[table];
  if (!meta || meta.key.charAt(0) !== "[") return null;
  const fields = meta.key.slice(1, -1).split(",");
  const parts = String(id || "").split(":");
  if (parts.length !== fields.length) return null;
  const out = {};
  fields.forEach((f, i) => (out[f] = parts[i]));
  return out;
}

/* ------------------------------------------------------------
   filtros/ordem: o handler pode falar em coluna bruta
   ("user_a_id") ou em campo do app ("userAId") — os dois
   viram a coluna certa.
   ------------------------------------------------------------ */
function colOf(table, key) {
  const meta = T[table];
  if (!meta) return camelToSnake(key);
  const appKey = snakeToCamel(key);
  if (Object.prototype.hasOwnProperty.call(meta.alias || {}, appKey)) {
    const mapped = meta.alias[appKey];
    if (mapped === null) return null;
    return mapped;
  }
  return camelToSnake(appKey);
}

function filterToRow(table, where) {
  const meta = T[table];
  const out = {};
  let impossible = false;

  Object.keys(where || {}).forEach((k) => {
    /* tabelas sem coluna "id" usam chave composta: "sv_x:u_y" vira
       server_id + user_id (nunca filtrar por uma coluna que não existe) */
    if ((k === "id" || k === "Id") && meta && meta.key && meta.key.charAt(0) === "[") {
      const fields = meta.key.slice(1, -1).split(",");
      const list = Array.isArray(where[k]) ? where[k] : [where[k]];
      const parsed = list.map((v) => idToParts(table, v)).filter(Boolean);
      if (!parsed.length || parsed.length !== list.length) {
        impossible = true;
        return;
      }
      /* chave composta: só é filtrável em massa quando o primeiro
         campo é o mesmo (ex.: mesmo servidor) */
      const firstField = parsed[0][fields[0]];
      if (parsed.some((p) => p[fields[0]] !== firstField)) {
        impossible = true;
        return;
      }
      out[colOf(table, fields[0])] = firstField;
      if (fields.length > 1) {
        out[colOf(table, fields[1])] = parsed.map((p) => p[fields[1]]);
      }
      return;
    }
    const col = colOf(table, k);
    if (col === null) {
      impossible = true;
      return;
    }
    out[col] = where[k];
  });

  return impossible ? null : out;
}

function orderToRow(table, order, desc) {
  if (!order) return null;
  const col = colOf(table, order);
  if (!col) return null;
  return { col, desc: !!desc };
}

/* colunas NOT NULL sem default no schema real (descobertas via
   OpenAPI): preenchidas na escrita para não violar constraint */
const REQ = {
  users: { display_name: "", password_hash: "" },
  notifications: { data: {} },
  logs: { data: {} },
  servers: { is_official: false },
  channels: { permissions: {} },
  roles: { permissions: {} },
  prefs: { data: {} },
  presence: { status: "offline" },
};

function applyRequired(table, row) {
  const req = REQ[table];
  if (!req || !row) return row;
  Object.keys(req).forEach((col) => {
    if (row[col] === undefined || row[col] === null) row[col] = req[col];
  });
  return row;
}

module.exports = {
  T,
  iso,
  ms,
  toApp,
  toRow,
  filterToRow,
  orderToRow,
  colOf,
  keyToId,
  idToParts,
  defaultFor,
  parseJSON,
  applyRequired,
  snakeToCamel,
  camelToSnake,
};
