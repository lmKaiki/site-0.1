"use strict";
/* ============================================================
   NEXO · server/handlers/social
   Amigos, solicitações, bloqueios e mensagens diretas.
   Cada mutação devolve { data, patch }: o data é o valor que a
   view já espera e o patch é o que o cache local precisa
   aplicar para a tela continuar coerente sem recarregar.
   ============================================================ */

const db = require("../db");
const auth = require("../auth");
const u = require("../util");
const P = require("../patch");
const R = require("../relations");
const handlersAuth = require("./auth");
const { bad, forbidden, notFound } = require("../errors");

function now() {
  return Date.now();
}

async function getUser(id) {
  const rows = await db.select("users", { where: { id }, limit: 1 });
  return rows && rows[0] ? rows[0] : null;
}

async function friendListOf(userId) {
  const a = await db.select("friendships", { where: { user_a_id: userId }, limit: 2000 });
  const b = await db.select("friendships", { where: { user_b_id: userId }, limit: 2000 });
  const all = (a || []).concat(b || []);
  const ids = all.map((fr) => (fr.userAId === userId ? fr.userBId : fr.userAId));
  if (!ids.length) return [];
  const users = await db.select("users", { where: { id: ids }, limit: 2000 });
  const byId = {};
  (users || []).forEach((x) => (byId[x.id] = x));
  return ids
    .map((id) => byId[id])
    .filter(Boolean)
    .map((x) => auth.publicUser(x))
    .sort((a2, b2) => String(a2.displayName || "").localeCompare(String(b2.displayName || "")));
}

/* ============================ ROTAS ============================ */
function routes() {
  return [
    ["GET", "/friends", listFriends],
    ["GET", "/friends/requests", listFriendRequests],
    ["GET", "/friends/state", friendStateRoute],
    ["POST", "/friends/request", sendFriendRequest],
    ["POST", "/friends/accept", acceptFriendRequest],
    ["POST", "/friends/reject", rejectFriendRequest],
    ["POST", "/friends/cancel", cancelFriendRequest],
    ["POST", "/friends/remove", removeFriend],
    ["POST", "/blocks", blockUser],
    ["POST", "/blocks/remove", unblockUser],
    ["GET", "/dms", listDMs],
    ["POST", "/dms", openDM],
    ["GET", "/dms/:id/messages", dmMessages],
    ["POST", "/dms/:id/messages", dmSendMessage],
    ["POST", "/dms/:id/read", dmMarkRead],
    ["POST", "/dms/:id/mute", dmMute],
  ];
}

async function listFriends(ctx) {
  const me = await auth.requireUser(ctx.event);
  const ownerId = (ctx.query && ctx.query.userId) || me.id;
  const owner = ownerId === me.id ? me : await getUser(ownerId);
  if (!owner) throw notFound("Usuário não encontrado.");

  if (owner.id !== me.id && !(await R.areFriends(me.id, owner.id))) {
    /* sem amizade só vemos os amigos em comum */
    const mine = await friendListOf(me.id);
    const theirs = await friendListOf(owner.id);
    const have = {};
    mine.forEach((x) => (have[x.id] = true));
    return { data: theirs.filter((x) => have[x.id]) };
  }
  return { data: await friendListOf(owner.id) };
}

async function listFriendRequests(ctx) {
  const me = await auth.requireUser(ctx.event);
  const kind = (ctx.query && ctx.query.kind) === "sent" ? "sent" : "received";
  const column = kind === "sent" ? "sender_id" : "receiver_id";
  const rows = await db.select("friend_requests", {
    where: { [column]: me.id, status: "pending" },
    order: "createdAt",
    limit: 100,
  });
  const out = [];
  for (const r of rows || []) {
    const otherId = kind === "sent" ? r.receiverId : r.senderId;
    const other = await getUser(otherId);
    if (!other) continue;
    out.push({ request: r, user: auth.publicUser(other) });
  }
  return { data: out };
}

async function friendStateRoute(ctx) {
  const me = await auth.requireUser(ctx.event);
  const otherId = (ctx.query && ctx.query.userId) || "";
  return { data: await R.friendState(me.id, otherId) };
}

async function sendFriendRequest(ctx) {
  const me = await auth.requireUser(ctx.event);
  const target = String((ctx.body || {}).userId || "").trim();
  if (!target) throw bad("Não encontramos ninguém com esse @username.");

  let other = null;
  if (target.indexOf("u_") === 0) other = await getUser(target);
  if (!other) {
    const rows = await db.select("users", {
      where: { username: u.normalizeUsername(target.replace(/^@/, "")) },
      limit: 1,
    });
    other = rows && rows[0] ? rows[0] : null;
  }
  if (!other) throw bad("Não encontramos ninguém com esse @username.");

  const check = await R.canSendFriendRequest(me.id, other.id);
  if (!check.ok) throw bad(check.reason);

  const req = {
    id: u.uid("frq"),
    senderId: me.id,
    receiverId: other.id,
    status: "pending",
    createdAt: now(),
    updatedAt: now(),
  };
  await db.insert("friend_requests", req);

  const note = await handlersAuth.createNotification(
    other.id,
    "friend",
    "@" + me.username + " enviou uma solicitação de amizade.",
    { href: "#/amigos/recebidas", actorId: me.id, requestId: req.id }
  );

  const patch = P.createPatch();
  P.set(patch, "friendRequests", req.id, req);
  P.set(patch, "users", other.id, auth.publicUser(other));
  P.set(patch, "notifications", note.id, note);
  return { status: 201, data: req, patch };
}

async function loadPendingRequest(id, userId, asReceiver) {
  const rows = await db.select("friend_requests", { where: { id }, limit: 1 });
  const req = rows && rows[0];
  if (!req || req.status !== "pending")
    throw notFound("Esta solicitação de amizade não existe mais.");
  const expected = asReceiver ? req.receiverId : req.senderId;
  if (expected !== userId) {
    throw forbidden(
      asReceiver ? "Esta solicitação não é para você." : "Você não pode executar esta ação."
    );
  }
  return req;
}

async function acceptFriendRequest(ctx) {
  const me = await auth.requireUser(ctx.event);
  const req = await loadPendingRequest((ctx.body || {}).requestId, me.id, true);

  const key = R.friendKey(req.senderId, req.receiverId);
  const existing = await db.select("friendships", { where: { id: key }, limit: 1 });
  let friendship = existing && existing[0];
  if (!friendship) {
    friendship = {
      id: key,
      userAId: req.senderId,
      userBId: req.receiverId,
      createdAt: now(),
    };
    await db.insert("friendships", friendship);
  }
  await db.update(
    "friend_requests",
    { where: { id: req.id } },
    { status: "accepted", acceptedAt: now(), updatedAt: now() }
  );
  const updated = Object.assign({}, req, { status: "accepted", acceptedAt: now() });

  const note = await handlersAuth.createNotification(
    req.senderId,
    "friend",
    "🎉 Agora você e @" + me.username + " são amigos!",
    { href: "#/amigos", actorId: me.id }
  );

  const other = await getUser(req.senderId);
  const patch = P.createPatch();
  P.set(patch, "friendships", key, friendship);
  P.set(patch, "friendRequests", req.id, updated);
  P.set(patch, "users", other.id, auth.publicUser(other));
  P.set(patch, "notifications", note.id, note);
  return { data: { friendship, user: other ? auth.publicUser(other) : null }, patch };
}

async function rejectFriendRequest(ctx) {
  const me = await auth.requireUser(ctx.event);
  const req = await loadPendingRequest((ctx.body || {}).requestId, me.id, true);
  await db.update(
    "friend_requests",
    { where: { id: req.id } },
    { status: "rejected", rejectedAt: now(), updatedAt: now() }
  );
  const patch = P.createPatch();
  P.del(patch, "friendRequests", [req.id]);
  return { data: true, patch };
}

async function cancelFriendRequest(ctx) {
  const me = await auth.requireUser(ctx.event);
  const req = await loadPendingRequest((ctx.body || {}).requestId, me.id, false);
  await db.remove("friend_requests", { where: { id: req.id } });
  const patch = P.createPatch();
  P.del(patch, "friendRequests", [req.id]);
  return { data: true, patch };
}

async function removeFriend(ctx) {
  const me = await auth.requireUser(ctx.event);
  const otherId = (ctx.body || {}).userId;
  const fr = await R.friendshipOf(me.id, otherId);
  if (!fr) throw bad("Vocês não são amigos.");
  await db.remove("friendships", { where: { id: fr.id } });
  const patch = P.createPatch();
  P.del(patch, "friendships", [fr.id]);
  return { data: true, patch };
}

async function blockUser(ctx) {
  const me = await auth.requireUser(ctx.event);
  const otherId = (ctx.body || {}).userId;
  if (!otherId || otherId === me.id) throw bad("Você não pode bloquear a si mesmo.");
  const other = await getUser(otherId);
  if (!other) throw notFound("Usuário não encontrado.");

  const existing = await db.select("blocks", {
    where: { blocker_id: me.id, blocked_id: otherId },
    limit: 1,
  });
  if (!existing || !existing.length) {
    await db.insert("blocks", {
      id: me.id + ":" + otherId,
      blockerId: me.id,
      blockedId: otherId,
      createdAt: now(),
    });
  }
  const list = await R.blocksOf(me.id);
  const patch = P.createPatch();
  const mine = await getUser(me.id);
  const shape = auth.publicUser(mine);
  shape.blocks = list;
  P.set(patch, "users", me.id, shape);
  return { data: true, patch };
}

async function unblockUser(ctx) {
  const me = await auth.requireUser(ctx.event);
  const otherId = (ctx.body || {}).userId;
  await db.remove("blocks", { where: { blocker_id: me.id, blocked_id: otherId } });
  const list = await R.blocksOf(me.id);
  const mine = await getUser(me.id);
  const shape = auth.publicUser(mine);
  shape.blocks = list;
  const patch = P.createPatch();
  P.set(patch, "users", me.id, shape);
  return { data: true, patch };
}

/* ---------------------------- DMs ---------------------------- */
async function dmRowsFor(userId) {
  const list = await db.select("dms", { limit: 500 });
  return (list || []).filter(
    (d) => Array.isArray(d.participants) && d.participants.indexOf(userId) !== -1
  );
}

async function listDMs(ctx) {
  const me = await auth.requireUser(ctx.event);
  const list = await dmRowsFor(me.id);
  const muted = await db.mutedDms(me.id);
  list.forEach((dm) => (dm.muted = muted.indexOf(dm.id) !== -1));
  return { data: list };
}

async function loadDM(id, userId) {
  const rows = await db.select("dms", { where: { id }, limit: 1 });
  const dm = rows && rows[0];
  if (!dm || !Array.isArray(dm.participants) || dm.participants.indexOf(userId) === -1)
    throw notFound("Conversa não encontrada.");
  return dm;
}

async function openDM(ctx) {
  const me = await auth.requireUser(ctx.event);
  const otherId = (ctx.body || {}).userId;
  if (!otherId || otherId === me.id) throw bad("Você não pode conversar consigo mesmo.");
  const other = await getUser(otherId);
  if (!other) throw notFound("Usuário não encontrado.");
  if (await R.blocksOf(me.id).then((l) => l.indexOf(otherId) !== -1))
    throw bad("Desbloqueie esta pessoa primeiro.");

  const id = R.dmIdFor(me.id, otherId);
  const rows = await db.select("dms", { where: { id }, limit: 1 });
  if (rows && rows.length) return { data: rows[0] };

  if (!(await R.canDM(me.id, otherId)))
    throw bad(R.dmPrivacyMessage(other));

  const dm = {
    id,
    participants: [me.id, otherId],
    muted: false,
    reads: {},
    createdAt: now(),
    updatedAt: now(),
  };
  await db.insert("dms", dm);
  const patch = P.createPatch();
  P.set(patch, "dms", id, dm);
  P.set(patch, "users", other.id, auth.publicUser(other));
  return { status: 201, data: dm, patch };
}

async function dmMessages(ctx) {
  const me = await auth.requireUser(ctx.event);
  await loadDM(ctx.params.id, me.id);
  const rows = await db.select("messages", {
    where: { channel_id: ctx.params.id },
    order: "createdAt",
    limit: 500,
  });
  return { data: rows || [] };
}

function sanitizeAttachments(list) {
  if (!list || !list.length) return [];
  if (list.length > 4) throw bad("Envie no máximo 4 anexos por mensagem.");
  return list.slice(0, 4).map((a) => {
    const type = ["image", "video", "file", "gif"].indexOf(a.type) !== -1 ? a.type : "file";
    const url = String(a.url || "");
    if (url.length > 1600000) throw bad("Este arquivo é grande demais (máximo 1,5 MB).");
    if (!/^(data:image\/|data:video\/|blob:|https?:\/\/)/i.test(url))
      throw bad("Formato de arquivo não suportado.");
    return {
      type,
      url,
      name: String(a.name || "arquivo").slice(0, 80),
      size: Number(a.size) || 0,
    };
  });
}

async function dmSendMessage(ctx) {
  const me = await auth.requireUser(ctx.event);
  const dm = await loadDM(ctx.params.id, me.id);
  const body = ctx.body || {};
  const text = String(body.content || "").trim();
  const attachments = sanitizeAttachments(body.attachments);
  if (!text && !attachments.length) throw bad("");
  if (attachments.length)
    await db.assertWritable(
      "dm_messages",
      "attachments",
      "O envio de anexos está indisponível neste banco. Execute a migração do Nexo (supabase/migrations/0001_nexo_backend.sql) e tente novamente."
    );
  if (text.length > 2000)
    throw bad("As mensagens podem ter no máximo 2000 caracteres.");

  const otherId = dm.participants.find((p) => p !== me.id) || null;
  if (otherId && (await R.blockedBetween(otherId, me.id)))
    throw bad("Você não pode enviar mensagens para esta pessoa.");
  if (otherId && (await R.blockedBetween(me.id, otherId)))
    throw bad("Desbloqueie esta pessoa para voltar a conversar.");

  /* privacidade revalidada enquanto a conversa não tem histórico */
  const history = await db.select("messages", {
    where: { channel_id: dm.id },
    limit: 1,
  });
  if (otherId && (!history || !history.length) && !(await R.canDM(me.id, otherId)))
    throw bad(R.dmPrivacyMessage(await getUser(otherId)));

  const createdAt = now();
  const message = {
    id: u.uid("ms"),
    channelId: dm.id,
    conversationId: dm.id,
    authorId: me.id,
    senderId: me.id,
    content: text.slice(0, 2000),
    attachments,
    type: "user",
    reactions: {},
    pinned: false,
    createdAt,
    updatedAt: null,
  };
  await db.insert("messages", message);

  const reads = Object.assign({}, dm.reads || {});
  reads[me.id] = createdAt;
  await db.update("dms", { where: { id: dm.id } }, { reads, updatedAt: now() });
  const updatedDM = Object.assign({}, dm, { reads });

  const patch = P.createPatch();
  P.set(patch, "messages", message.id, message);
  P.set(patch, "dms", dm.id, updatedDM);

  const mutedList = await db.mutedDms(me.id);
  if (otherId && mutedList.indexOf(dm.id) === -1) {
    const note = await handlersAuth.createNotification(
      otherId,
      "dm",
      "@" + me.username + " enviou uma mensagem.",
      { href: "#/mensagens/" + dm.id, actorId: me.id, messageId: message.id }
    );
    P.set(patch, "notifications", note.id, note);
  }
  return { status: 201, data: message, patch };
}

async function dmMarkRead(ctx) {
  const me = await auth.requireUser(ctx.event);
  const dm = await loadDM(ctx.params.id, me.id);
  const reads = Object.assign({}, dm.reads || {});
  reads[me.id] = now();
  await db.update("dms", { where: { id: dm.id } }, { reads, updatedAt: now() });
  const patch = P.createPatch();
  P.set(patch, "dms", dm.id, Object.assign({}, dm, { reads }));
  return { data: true, patch };
}

async function dmMute(ctx) {
  const me = await auth.requireUser(ctx.event);
  const dm = await loadDM(ctx.params.id, me.id);
  const muted = (ctx.body || {}).muted !== false;
  await db.setMutedDm(me.id, dm.id, muted);
  const updated = Object.assign({}, dm, { muted });
  const patch = P.createPatch();
  P.set(patch, "dms", dm.id, updated);
  return { data: updated, patch };
}

module.exports = { routes, friendListOf, getUser, sanitizeAttachments, dmRowsFor };
