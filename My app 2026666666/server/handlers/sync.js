"use strict";
/* ============================================================
   NEXO · server/handlers/sync
   Fatia completa dos dados do usuário autenticado. É o que o
   navegador baixa no boot e a cada atualização: nada aqui
   depende do localStorage e nada é devolvido sem o servidor
   conferir a sessão.
   ============================================================ */

const db = require("../db");
const auth = require("../auth");
const acl = require("../acl");

const MESSAGE_LIMIT = 400;

function toMap(rows, keyFn) {
  const out = {};
  (rows || []).forEach((r) => (out[keyFn(r)] = r));
  return out;
}

async function syncPayload(user) {
  /* ---- servidor: membros, convites, cargos, canais ---- */
  const memberships = await db.select("memberships", {
    where: { user_id: user.id },
    limit: 500,
  });
  const serverIds = (memberships || []).map((m) => m.serverId);

  const servers = serverIds.length
    ? await db.select("servers", { where: { id: serverIds }, limit: 500 })
    : [];
  const roles = serverIds.length
    ? await db.select("roles", { where: { server_id: serverIds }, limit: 2000 })
    : [];
  const categories = serverIds.length
    ? await db.select("categories", { where: { server_id: serverIds }, limit: 2000 })
    : [];
  const channels = serverIds.length
    ? await db.select("channels", { where: { server_id: serverIds }, limit: 2000 })
    : [];
  const bans = serverIds.length
    ? await db.select("bans", { where: { server_id: serverIds }, limit: 2000 })
    : [];
  const invites = serverIds.length
    ? await db.select("invites", { where: { server_id: serverIds }, limit: 500 })
    : [];
  const logs = serverIds.length
    ? await db.select("logs", { where: { server_id: serverIds }, order: "at", desc: true, limit: 80 })
    : [];

  /* ---- apps/bots: catálogo + instalações dos meus servidores ---- */
  try {
    await require("./apps").ensureCatalog();
  } catch (e) {
    /* catálogo indisponível: a tela mostra o erro de forma amigável */
  }
  const apps = (await db.select("apps", { limit: 200 })) || [];
  const serverApps = serverIds.length
    ? ((await db.select("server_apps", { where: { server_id: serverIds }, limit: 500 })) || [])
    : [];

  /* membros dos meus servidores (preciso exibir a lista) */
  const memberRows = serverIds.length
    ? await db.select("memberships", { where: { server_id: serverIds }, limit: 2000 })
    : [];
  const memberIds = {};
  (memberships || []).forEach((m) => (memberIds[m.userId] = true));
  (memberRows || []).forEach((m) => (memberIds[m.userId] = true));

  /* ---- rede social ---- */
  const frA = await db.select("friendships", { where: { user_a_id: user.id }, limit: 2000 });
  const frB = await db.select("friendships", { where: { user_b_id: user.id }, limit: 2000 });
  const friendships = (frA || []).concat(frB || []);

  const reqA = await db.select("friend_requests", {
    where: { sender_id: user.id },
    limit: 500,
  });
  const reqB = await db.select("friend_requests", {
    where: { receiver_id: user.id },
    limit: 500,
  });
  const friendRequests = (reqA || [])
    .concat(reqB || [])
    .filter((r) => r.status === "pending" || r.status === "accepted" || r.status === "rejected");

  const counterpartIds = {};
  friendships.forEach((fr) => {
    counterpartIds[fr.userAId === user.id ? fr.userBId : fr.userAId] = true;
  });
  friendRequests.forEach((r) => {
    counterpartIds[r.senderId] = true;
    counterpartIds[r.receiverId] = true;
  });

  /* ---- conversas diretas ---- */
  const allDMs = await db.select("dms", { limit: 500 });
  const dms = (allDMs || []).filter(
    (d) => Array.isArray(d.participants) && d.participants.indexOf(user.id) !== -1
  );
  dms.forEach((d) => d.participants.forEach((p) => (memberIds[p] = true)));
  const mutedDms = await db.mutedDms(user.id);
  dms.forEach((d) => (d.muted = mutedDms.indexOf(d.id) !== -1));

  /* ---- mensagens: minhas DMs + canais que consigo ver ---- */
  const channelIds = [];
  const ctxCache = {};
  for (const server of servers) {
    try {
      const ctxS = await acl.loadServer(server.id);
      ctxCache[server.id] = ctxS;
      ctxS.channels.forEach((c) => {
        if (acl.canViewChannel(ctxS, c, user.id)) channelIds.push(c.id);
      });
    } catch (e) {
      /* servidor inacessível: segue sem ele */
    }
  }
  const refs = dms.map((d) => d.id).concat(channelIds);
  let messages = refs.length
    ? await db.select("messages", {
        where: { channel_id: refs },
        order: "createdAt",
        desc: true,
        limit: MESSAGE_LIMIT,
      })
    : [];
  messages = messages.slice().reverse(); /* cronológico para a interface */

  /* ---- notificações ---- */
  const notifications = await db.select("notifications", {
    where: { user_id: user.id },
    order: "at",
    desc: true,
    limit: 80,
  });

  /* ---- pessoas visíveis ----
     membros dos meus servidores + amigos + quem está envolvido numa
     solicitação de amizade (sem estes, a tela de solicitações não
     tem o remetente para mostrar). */
  memberIds[user.id] = true;
  Object.keys(counterpartIds).forEach((id) => {
    if (id) memberIds[id] = true;
  });
  const userIds = Object.keys(memberIds);
  const users = userIds.length
    ? await db.select("users", { where: { id: userIds }, limit: 2000 })
    : [];

  /* bloqueios (fonte: tabela blocks; espelhado em users.blocks) */
  const blocks = {};
  if (userIds.length) {
    const mine = await db.select("blocks", { where: { blocker_id: userIds }, limit: 2000 });
    (mine || []).forEach((b) => {
      blocks[b.blockerId] = blocks[b.blockerId] || [];
      if (blocks[b.blockerId].indexOf(b.blockedId) === -1)
        blocks[b.blockerId].push(b.blockedId);
    });
  }

  const usersMap = {};
  const presence = {};
  (users || []).forEach((x) => {
    const safe = auth.publicUser(x);
    safe.blocks = blocks[x.id] || [];
    usersMap[x.id] = safe;
    presence[x.id] = x.status || "offline";
  });

  /* convites: só quem pode gerenciar enxerga a lista completa */
  const invitesMap = {};
  for (const invite of invites || []) {
    const ctxS = ctxCache[invite.serverId];
    if (!ctxS) continue;
    const allowed =
      acl.isOwner(ctxS, user.id) ||
      invite.creatorId === user.id ||
      acl.can(ctxS, user.id, "manageServer");
    if (allowed) invitesMap[invite.code] = invite;
  }

  /* logs: só quem tem "ver logs" */
  const visibleLogs = [];
  for (const entry of logs || []) {
    const ctxS = ctxCache[entry.serverId];
    if (ctxS && (acl.isOwner(ctxS, user.id) || acl.can(ctxS, user.id, "viewLogs")))
      visibleLogs.push(entry);
  }

  return {
    me: auth.publicUser(user),
    users: usersMap,
    servers: toMap(servers, (s) => s.id),
    /* minhas memberships + as de cada servidor que eu vejo (é o que
       a lista de membros do canal desenha). O mapa deduplica pelo id. */
    memberships: toMap(
      (memberships || []).concat(memberRows || []),
      (m) => m.id
    ),
    roles: toMap(roles, (r) => r.id),
    categories: toMap(categories, (c) => c.id),
    channels: toMap(channels, (c) => c.id),
    invites: invitesMap,
    bans: toMap(bans, (b) => b.id),
    friendRequests: toMap(friendRequests, (r) => r.id),
    friendships: toMap(friendships, (f) => f.id),
    dms: toMap(dms, (d) => d.id),
    messages: toMap(messages, (m) => m.id),
    notifications: notifications || [],
    logs: visibleLogs,
    apps: toMap(apps, (a) => a.id),
    serverApps: toMap(serverApps, (a) => a.id),
    presence,
    serverTime: Date.now(),
  };
}

function routes() {
  return [["GET", "/sync", syncRoute]];
}

async function syncRoute(ctx) {
  const user = await auth.requireUser(ctx.event);
  return { data: await syncPayload(user) };
}

module.exports = { routes, syncPayload };
