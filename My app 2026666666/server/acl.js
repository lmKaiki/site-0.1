"use strict";
/* ============================================================
   NEXO · server/acl
   Permissões validadas NO BACKEND (a interface só esconde
   botões — aqui é onde a recusa acontece de verdade).

   Espelha js/store.js (effectivePerms / channelPerm /
   canViewChannel / canSendIn) para que a tela e a API
   concordem, mas quem decide é esta cópia.
   ============================================================ */

const db = require("./db");
const { forbidden, notFound, unauthorized } = require("./errors");

const PERM_KEYS = [
  "administrator",
  "manageServer",
  "manageRoles",
  "manageChannels",
  "manageMembers",
  "createInvite",
  "viewLogs",
  "viewChannels",
  "sendMessages",
  "editMessages",
  "deleteMessages",
  "pinMessages",
  "attachFiles",
  "useEmojis",
  "useCustomEmojis",
  "useGifs",
  "mentionEveryone",
  "kickMembers",
  "banMembers",
  "unbanMembers",
  "timeoutMembers",
  "joinVoice",
  "inviteToVoice",
  "speak",
  "muteMembers",
  "deafenMembers",
  "moveMembers",
];

const DEFAULT_ON_PERMS = ["inviteToVoice"];

const BASE_PERMS = [
  "viewChannels",
  "sendMessages",
  "createInvite",
  "attachFiles",
  "useEmojis",
  "useCustomEmojis",
  "useGifs",
  "joinVoice",
  "inviteToVoice",
  "speak",
];

function blankPerms() {
  const out = {};
  PERM_KEYS.forEach((k) => (out[k] = false));
  return out;
}

function defaultPerms(preset) {
  const out = blankPerms();
  DEFAULT_ON_PERMS.forEach((k) => (out[k] = true));
  (preset || BASE_PERMS).forEach((k) => {
    if (out[k] !== undefined) out[k] = true;
  });
  return out;
}

function normalizePerms(input, allowSuper) {
  const out = blankPerms();
  if (input && typeof input === "object") {
    PERM_KEYS.forEach((k) => {
      if (input[k] === true) out[k] = true;
      else if (input[k] === false && allowSuper) out[k] = false;
    });
  }
  return out;
}

function applyPerms(target, source) {
  if (!source) return;
  PERM_KEYS.forEach((k) => {
    if (source[k] === true) target[k] = true;
    else if (source[k] === false && target[k] !== undefined) target[k] = false;
  });
}

/* contexto completo do servidor carregado uma vez por requisição */
async function loadServer(serverId) {
  const rows = await db.select("servers", { where: { id: serverId }, limit: 1 });
  const server = rows && rows[0];
  if (!server) throw notFound("Este servidor não existe mais ou foi excluído.");

  const memberships = await db.select("memberships", { where: { server_id: serverId } });
  const roles = await db.select("roles", { where: { server_id: serverId } });
  const categories = await db.select("categories", { where: { server_id: serverId } });
  const channels = await db.select("channels", { where: { server_id: serverId } });
  const bans = await db.select("bans", { where: { server_id: serverId } });

  const byUser = {};
  (memberships || []).forEach((m) => (byUser[m.userId] = m));
  const roleById = {};
  (roles || []).forEach((r) => (roleById[r.id] = r));
  const defaultRole = (roles || []).find((r) => r.isDefault) || null;

  return {
    server,
    byUser,
    roleById,
    defaultRole,
    categories: categories || [],
    channels: channels || [],
    bans: bans || [],
  };
}

function membershipOf(ctx, userId) {
  return ctx.byUser[userId] || null;
}

function isOwner(ctx, userId) {
  return !!ctx.server && ctx.server.ownerId === userId;
}

function effectivePerms(ctx, userId) {
  const out = blankPerms();
  const membership = membershipOf(ctx, userId);
  if (!ctx.server || !membership) return out; /* não é membro: nada */

  if (ctx.server.ownerId === userId) {
    PERM_KEYS.forEach((k) => (out[k] = true));
    return out;
  }

  DEFAULT_ON_PERMS.forEach((k) => (out[k] = true));
  if (ctx.defaultRole) applyPerms(out, ctx.defaultRole.permissions);
  const role = membership.roleId ? ctx.roleById[membership.roleId] : null;
  if (role && !role.isDefault) applyPerms(out, role.permissions);
  applyPerms(out, membership.permissions);

  if (out.administrator) PERM_KEYS.forEach((k) => (out[k] = true));
  return out;
}

function can(ctx, userId, perm) {
  if (!perm) return true;
  return !!effectivePerms(ctx, userId)[perm];
}

function requirePerm(ctx, userId, perm, message) {
  if (!can(ctx, userId, perm))
    throw forbidden(message || "Você não tem permissão para realizar esta ação.");
  return userId;
}

function requireMember(ctx, userId) {
  const membership = membershipOf(ctx, userId);
  if (!membership) throw forbidden("Você não faz parte deste servidor.");
  return membership;
}

/* ---- overrides por canal/categoria (permitir / negar / herdar) ---- */
function applyOverride(container, key, userId, current, membership) {
  if (!container) return current;
  const userVal = container["user:" + userId];
  if (userVal && userVal[key] !== undefined && userVal[key] !== null)
    return userVal[key] === true;

  let decided = null;
  if (
    container.everyone &&
    container.everyone[key] !== undefined &&
    container.everyone[key] !== null
  )
    decided = container.everyone[key] === true;

  const roleIds = [];
  if (membership && membership.roleId) roleIds.push(membership.roleId);
  ((membership && membership.extraRoleIds) || []).forEach((rid) => roleIds.push(rid));
  roleIds.filter(Boolean).forEach((rid) => {
    const box = container["role:" + rid];
    if (box && box[key] !== undefined && box[key] !== null) {
      if (box[key] === false) decided = false;
      else if (decided === null) decided = true;
    }
  });
  return decided === null ? current : decided;
}

function effectiveChannelPerms(ctx, channel, userId) {
  const out = effectivePerms(ctx, userId);
  const membership = membershipOf(ctx, userId);
  const cat = channel.categoryId
    ? ctx.categories.find((c) => c.id === channel.categoryId)
    : null;
  if (cat && channel.inheritPerms !== false) {
    PERM_KEYS.forEach((k) => {
      out[k] = applyOverride(cat.perms, k, userId, out[k], membership);
    });
  }
  PERM_KEYS.forEach((k) => {
    out[k] = applyOverride(channel.perms, k, userId, out[k], membership);
  });
  return out;
}

function channelPerm(ctx, channel, userId, key) {
  if (!channel) return false;
  return !!effectiveChannelPerms(ctx, channel, userId)[key];
}

function canViewChannel(ctx, channel, userId) {
  if (!channel) return false;
  if (!membershipOf(ctx, userId)) return false;
  if (!channelPerm(ctx, channel, userId, "viewChannels")) return false;
  const ov = channel.overrides || {};
  if (ov.view === "private") {
    return (
      channel.createdBy === userId ||
      isOwner(ctx, userId) ||
      can(ctx, userId, "manageChannels")
    );
  }
  return true;
}

function canSendIn(ctx, channel, userId) {
  if (!canViewChannel(ctx, channel, userId)) return false;
  const ov = channel.overrides || {};
  if (ov.send === "none") return false;
  if (ov.send === "private") {
    return (
      channel.createdBy === userId ||
      isOwner(ctx, userId) ||
      can(ctx, userId, "manageChannels")
    );
  }
  return channelPerm(ctx, channel, userId, "sendMessages");
}

/* carrega o servidor e exige permissão — uso típico dos handlers */
async function serverWithPerm(serverId, userId, perm, message) {
  const ctx = await loadServer(serverId);
  requireMember(ctx, userId);
  requirePerm(ctx, userId, perm, message);
  return ctx;
}

module.exports = {
  PERM_KEYS,
  DEFAULT_ON_PERMS,
  BASE_PERMS,
  blankPerms,
  defaultPerms,
  normalizePerms,
  loadServer,
  membershipOf,
  isOwner,
  effectivePerms,
  can,
  requirePerm,
  requireMember,
  effectiveChannelPerms,
  channelPerm,
  canViewChannel,
  canSendIn,
  serverWithPerm,
  unauthorized,
};
