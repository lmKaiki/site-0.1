"use strict";
/* ============================================================
   NEXO · server/relations
   Regras de amizade, bloqueio e privacidade — as MESMAS do
   js/store.js, porém avaliadas no servidor. Aqui nada se
   resolve com o que o navegador afirma: o servidor carrega as
   linhas do banco e decide.
   ============================================================ */

const db = require("./db");
const auth = require("./auth");

function friendKey(a, b) {
  return [a, b].sort().join(":");
}

async function friendshipOf(a, b) {
  if (!a || !b || a === b) return null;
  const key = friendKey(a, b);
  const rows = await db.select("friendships", { where: { id: key }, limit: 1 });
  return rows && rows[0] ? rows[0] : null;
}

async function areFriends(a, b) {
  return !!(await friendshipOf(a, b));
}

async function friendRequestsBetween(a, b) {
  const list = await db.select("friend_requests", {
    where: { sender_id: a, status: "pending" },
    limit: 100,
  });
  return (list || []).find((r) => r.receiverId === b) || null;
}

/* bloqueios nos DOIS sentidos */
async function blockedBetween(a, b) {
  if (!a || !b) return false;
  const one = await db.select("blocks", {
    where: { blocker_id: a, blocked_id: b },
    limit: 1,
  });
  if (one && one.length) return true;
  const two = await db.select("blocks", {
    where: { blocker_id: b, blocked_id: a },
    limit: 1,
  });
  return !!(two && two.length);
}

async function blocksOf(userId) {
  const mine = await db.select("blocks", { where: { blocker_id: userId }, limit: 1000 });
  return (mine || []).map((b) => b.blockedId);
}

/* mapa {userId: [ids bloqueados]} para montar o cache do cliente */
async function blocksMapFor(userIds) {
  const out = {};
  if (!userIds || !userIds.length) return out;
  const mine = await db.select("blocks", { where: { blocker_id: userIds }, limit: 2000 });
  (mine || []).forEach((b) => {
    out[b.blockerId] = out[b.blockerId] || [];
    if (out[b.blockerId].indexOf(b.blockedId) === -1) out[b.blockerId].push(b.blockedId);
  });
  return out;
}

async function mutualFriendCount(a, b) {
  const list = await db.select("friendships", { limit: 5000 });
  const fa = {};
  (list || []).forEach((fr) => {
    if (fr.userAId === a) fa[fr.userBId] = 1;
    if (fr.userBId === a) fa[fr.userAId] = 1;
  });
  return (list || []).filter(
    (fr) =>
      (fr.userAId === b || fr.userBId === b) && fa[fr.userAId === b ? fr.userBId : fr.userAId]
  ).length;
}

/* regras do DONO do perfil (mesmos textos da interface) */
async function canSendFriendRequest(viewerId, otherId) {
  if (!viewerId || !otherId)
    return { ok: false, reason: "Usuário não encontrado." };
  if (viewerId === otherId)
    return { ok: false, reason: "Você não pode adicionar a si mesmo." };
  if (await areFriends(viewerId, otherId))
    return { ok: false, reason: "Vocês já são amigos." };
  if (await friendRequestsBetween(viewerId, otherId))
    return { ok: false, reason: "Já existe uma solicitação de amizade pendente." };
  if (await blockedBetween(viewerId, otherId))
    return { ok: false, reason: "Não é possível enviar solicitação para esta pessoa." };

  const rows = await db.select("users", { where: { id: otherId }, limit: 1 });
  const other = rows && rows[0];
  if (!other) return { ok: false, reason: "Usuário não encontrado." };
  const privacy = other.privacy || {};
  const mode = privacy.friendRequests || "all";
  if (mode === "none")
    return { ok: false, reason: "Esta pessoa não aceita solicitações de amizade." };
  if (mode === "common" && (await mutualFriendCount(viewerId, otherId)) < 1)
    return {
      ok: false,
      reason: "Esta pessoa só aceita solicitações de amigos em comum.",
    };
  return { ok: true, reason: "" };
}

/* "none" | "friends" | "sent" | "received" | "self" */
async function friendState(viewerId, otherId) {
  if (!viewerId || !otherId) return "none";
  if (viewerId === otherId) return "self";
  if (await areFriends(viewerId, otherId)) return "friends";
  const a = await friendRequestsBetween(viewerId, otherId);
  if (a) return "sent";
  const b = await friendRequestsBetween(otherId, viewerId);
  if (b) return "received";
  return "none";
}

/* pode iniciar/receber DM? regras de privacidade do DONO */
async function canDM(viewerId, targetId) {
  if (!viewerId || !targetId || viewerId === targetId) return false;
  if (await blockedBetween(viewerId, targetId)) return false;
  const rows = await db.select("users", { where: { id: targetId }, limit: 1 });
  const target = rows && rows[0];
  if (!target) return false;
  const mode = ((target.privacy || {}).dm) || "all";
  if (mode === "none") return false;
  if (mode === "friends") return await areFriends(targetId, viewerId);
  if (mode === "followers") return false; /* rede social ainda não migrada */
  return true;
}

function dmPrivacyMessage(target) {
  const mode = (((target && target.privacy) || {}).dm) || "all";
  if (mode === "none") return "Esta pessoa não recebe mensagens diretas.";
  if (mode === "friends") return "Esta pessoa só aceita mensagens de amigos.";
  return "Esta pessoa só aceita mensagens de quem a segue.";
}

/* id determinístico da conversa — igual a S.dmId do frontend */
function dmIdFor(a, b) {
  return "dm_" + [a, b].sort().join("_");
}

module.exports = {
  friendKey,
  friendshipOf,
  areFriends,
  friendRequestsBetween,
  blockedBetween,
  blocksOf,
  blocksMapFor,
  mutualFriendCount,
  canSendFriendRequest,
  friendState,
  canDM,
  dmPrivacyMessage,
  dmIdFor,
};
