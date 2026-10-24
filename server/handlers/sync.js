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
const official = require("../official");

const MESSAGE_LIMIT = 400;

function toMap(rows, keyFn) {
  const out = {};
  (rows || []).forEach((r) => (out[keyFn(r)] = r));
  return out;
}

/* o OFFICIAL_APPS é a fonte verdadeira dos metadados do catálogo
   (comandos novos, selo de integração externa etc.); a tabela `apps`
   não tem coluna de status, então servimos a definição oficial. */
function decorateApp(row) {
  try {
    const appsH = require("./apps");
    if (appsH && typeof appsH.catalogRow === "function") return appsH.catalogRow(row);
  } catch (e) {
    /* módulo indisponível: serve a linha crua */
  }
  return row;
}

/* catálogo + o @ de quem criou (o id cru de usuário não vai ao
   cliente — mesma regra de /apps; o rótulo nunca invalida o sync) */
async function decorateAndLabelApps(rows) {
  const out = (rows || []).map(decorateApp);
  try {
    const appsH = require("./apps");
    if (appsH && typeof appsH.labelOwners === "function") await appsH.labelOwners(out);
  } catch (e) {
    /* rótulo é cosmético */
  }
  return out;
}

/* Linhas de uma tabela NOVA por servidor, tolerando migração aditiva
   ainda não aplicada. `db.schemaFor` é memoizado por processo, então a
   checagem custa uma introspecção no primeiro pedido e nada depois:
   quando a tabela não existe, o acervo volta vazio e o resto do /sync
   segue intacto. */
async function galleryRows(table, serverIds) {
  if (!serverIds.length) return [];
  let schema = null;
  try {
    schema = await db.schemaFor(table);
  } catch (e) {
    schema = null;
  }
  if (!schema || !schema.size) return [];
  return (await db.select(table, { where: { server_id: serverIds }, limit: 2000 })) || [];
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
  /* ---- emojis e figurinhas personalizados dos MEUS servidores ----
     Antes viviam só no navegador (db().emojis): morriam no reload e
     nunca chegavam a outro membro. Aqui saem do banco junto com o
     resto do sync, filtrados pelos servidores dos quais sou membro.
     Quem não é membro não recebe o acervo de forma nenhuma. */
  /* Tabelas novas da migração 0006. Se ainda não foram aplicadas
     online, a tabela não existe e o acervo vem VAZIO — sem derrubar
     o resto do /sync. Quebrar o sync inteiro por uma tabela opcional
     derrubaria o carregamento do app inteiro. */
  const emojis = await galleryRows("emojis", serverIds);
  const stickers = await galleryRows("stickers", serverIds);

  /* ---- apps/bots: catálogo + instalações dos meus servidores ---- */
  try {
    await require("./apps").ensureCatalog();
  } catch (e) {
    /* catálogo indisponível: a tela mostra o erro de forma amigável */
  }
  const appsRaw = (await db.select("apps", { limit: 200 })) || [];
  const serverApps = serverIds.length
    ? ((await db.select("server_apps", { where: { server_id: serverIds }, limit: 500 })) || [])
    : [];
  /* rascunho de bot de usuário: no /sync ele só existe para o criador
     (e para comunidades onde já está instalado — em uso ali) */
  let appsH = null;
  try {
    appsH = require("./apps");
  } catch (e) {
    appsH = null;
  }
  const installedAppIds = {};
  serverApps.forEach((i) => {
    if (i && i.appId) installedAppIds[String(i.appId)] = true;
  });
  const apps = appsRaw.filter(
    (a) =>
      !appsH ||
      typeof appsH.visibleInSync !== "function" ||
      appsH.visibleInSync(a, user.id, installedAppIds)
  );

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

  /* ---- conversas diretas ----
     As conversas que o usuário ocultou continuam vindo (com a marca
     `hidden`) — nada é apagado, a lista da interface é que filtra. */
  const allDMs = await db.select("dms", { limit: 500 });
  const hiddenDms = await db.hiddenDms(user.id);
  const dms = (allDMs || []).filter(
    (d) => Array.isArray(d.participants) && d.participants.indexOf(user.id) !== -1
  );
  dms.forEach((d) => (d.hidden = hiddenDms.indexOf(d.id) !== -1));
  dms.forEach((d) => d.participants.forEach((p) => (memberIds[p] = true)));
  const mutedDms = await db.mutedDms(user.id);
  dms.forEach((d) => (d.muted = mutedDms.indexOf(d.id) !== -1));

  /* ---- mensagens: minhas DMs + canais que consigo ver ---- */
  const channelIds = [];
  /* canal de ticket que eu consigo ver → levo o ticketId junto, para
     o seletor local mostrar o canal a quem o backend já autorizou
     (participante transferido, por exemplo — sem conhecê-lo de cor) */
  const ticketIdByChannel = {};
  const ctxCache = {};
  for (const server of servers) {
    try {
      const ctxS = await acl.loadServer(server.id);
      ctxCache[server.id] = ctxS;
      for (const c of ctxS.channels) {
        if (await acl.canViewChannel(ctxS, c, user.id)) {
          channelIds.push(c.id);
          if (c.ticketId) ticketIdByChannel[c.id] = c.ticketId;
        }
      }
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

  /* ---- notificações ----
     (as do Servidor Oficial Nexo — legado — ficam no banco mas
      não são mais entregues; filtro de leitura em official.js) */
  const notifications = official.hideOfficialNotes(
    await db.select("notifications", {
      where: { user_id: user.id },
      order: "at",
      desc: true,
      limit: 80,
    })
  );

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

  const friendSet = {};
  friendships.forEach((fr) => {
    const other = fr.userAId === user.id ? fr.userBId : fr.userAId;
    friendSet[other] = true;
  });

  const usersMap = {};
  const presence = {};
  const voicePrivacy = {};
  (users || []).forEach((x) => {
    const safe = auth.publicUser(x, user.id, { friend: !!friendSet[x.id] });
    safe.blocks = blocks[x.id] || [];
    usersMap[x.id] = safe;
    presence[x.id] = x.status || "offline";
    /* regra de quem pode ver "Em um canal de voz" (privacidade da
       própria pessoa; só interessa os 3 modos conhecidos) */
    const va = x.privacy && typeof x.privacy === "object" ? x.privacy.voiceActivity : null;
    voicePrivacy[x.id] = va === "friends" || va === "none" ? va : "all";
  });

  /* ---- placas de nome equipadas (personalização) ----
     Dado PÚBLICO de exibição (como o status ou o apelido): só o
     id da placa escolhida, lido do prefs.data.custom de cada
     pessoa visível — um único select, na mesma economia de
     blocos e privacidades. Nada de saldo, itens ou missões de
     ninguém sai daqui. */
  const nameplateMap = {};
  if (userIds.length) {
    try {
      const prefsRows = await db.select("prefs", {
        where: { user_id: userIds },
        limit: 2000,
      });
      (prefsRows || []).forEach(function (p) {
        let data = p && p.data;
        if (typeof data === "string") {
          try {
            data = JSON.parse(data);
          } catch (e) {
            data = null;
          }
        }
        const custom = data && typeof data === "object" ? data.custom : null;
        const eq =
          custom && typeof custom.equipped === "string" && custom.equipped
            ? custom.equipped
            : null;
        const pid = p && (p.userId || p.user_id);
        if (eq && pid) nameplateMap[pid] = eq;
      });
    } catch (e) {
      /* prefs indisponíveis: as telas seguem só com o nome */
    }
  }
  Object.keys(usersMap).forEach(function (id) {
    usersMap[id].nameplate = nameplateMap[id] || null;
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

  /* ---- não notificações: presença em canais de voz ----
     Só dos servidores que eu pertenço, só com renovação recente
     (quem fechou o navegador sem sair some daqui em ~45s), só de
     quem está realmente online e conforme a privacidade "Ativo
     agora" de cada pessoa (todos/amigos/ninguém). */
  let voice = [];
  try {
    const vrows = serverIds.length
      ? await db.select("voice", { where: { server_id: serverIds }, limit: 800 })
      : [];
    const at = Date.now();
    voice = (vrows || []).filter(function (v) {
      if (at - Number(v.updatedAt || 0) >= 45000) return false;
      if (v.userId === user.id) return true;
      const owner = usersMap[v.userId];
      if (!owner) return false; /* fora do círculo que eu vejo */
      if ((presence[v.userId] || "offline") === "offline") return false;
      const mode = voicePrivacy[v.userId] || "all";
      if (mode === "none") return false;
      if (mode === "friends" && !friendSet[v.userId]) return false;
      return true;
    });
  } catch (e) {
    voice = [];
  }

  /* canais PRIVADOS (tickets) só para quem passa em canViewChannel —
     o filtro de channelIds acima já protegia as MENSAGENS; sem isto
     o canal privado (com topic = assunto do chamado) vazava para
     qualquer membro comum no sync. Falha fechada: se o loadServer
     de um servidor deu erro, os canais dele também saem. */
  const visibleChannelIds = new Set(channelIds);
  const visibleChannels = channels
    .filter((c) => visibleChannelIds.has(c.id))
    .map((c) => {
      if (ticketIdByChannel[c.id]) c.ticketId = ticketIdByChannel[c.id];
      return c;
    });

  return {
    me: Object.assign(auth.publicUser(user), {
      nameplate: nameplateMap[user.id] || null,
    }),
    users: usersMap,
    servers: toMap(servers, (s) => s.id),
    /* minhas memberships + as de cada servidor que eu vejo (é o que
       a lista de membros do canal desenha). O mapa deduplica pelo id. */
    memberships: toMap(
      (memberships || []).concat(memberRows || []),
      (m) => m.id
    ),
    roles: toMap(roles, (r) => r.id),
    emojis: toMap(emojis, (e) => e.id),
    stickers: toMap(stickers, (s) => s.id),
    categories: toMap(categories, (c) => c.id),
    channels: toMap(visibleChannels, (c) => c.id),
    invites: invitesMap,
    bans: toMap(bans, (b) => b.id),
    friendRequests: toMap(friendRequests, (r) => r.id),
    friendships: toMap(friendships, (f) => f.id),
    dms: toMap(dms, (d) => d.id),
    messages: toMap(messages, (m) => m.id),
    notifications: notifications || [],
    logs: visibleLogs,
    apps: toMap(await decorateAndLabelApps(apps), (a) => a.id),
    serverApps: toMap(serverApps, (a) => a.id),
    voice,
    presence,
    serverTime: Date.now(),
  };
}

function routes() {
  return [["GET", "/sync", syncRoute]];
}

async function syncRoute(ctx) {
  const user = await auth.requireUser(ctx.event);
  /* lembretes vencidos do Nexo Lembretes são entregues AGORA, junto
     com este sync — é o "abrir o app". Não existe executor em
     segundo plano e o próprio comando de criação avisa isso. */
  try {
    await require("./apps").deliverReminders(user.id);
  } catch (e) {
    /* falha aqui nunca derruba o sync */
  }
  return { data: await syncPayload(user) };
}

module.exports = { routes, syncPayload };
