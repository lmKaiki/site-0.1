"use strict";
/* ============================================================
   NEXO · server/handlers/servers
   Servidores, cargos, membros, categorias, canais, convites,
   banimentos e logs. TODA mutação passa pela verificação de
   permissão do servidor (server/acl.js) — esconder o botão na
   interface não é controle: quem recusa é esta camada.
   ============================================================ */

const db = require("../db");
const auth = require("../auth");
const u = require("../util");
const P = require("../patch");
const R = require("../relations");
const acl = require("../acl");
const handlersAuth = require("./auth");
const official = require("../official");
const { bad, forbidden, notFound } = require("../errors");

function now() {
  return Date.now();
}

/* estruturas iniciais (PT-BR) — espelha NX.TEMPLATES de js/core.js */
const TEMPLATES = {
  comunidade: [
    { name: "INFORMAÇÕES", channels: [["boas-vindas", "text"], ["regras", "text"]] },
    { name: "COMUNIDADE", channels: [["geral", "text"], ["memes", "text"], ["novidades", "text"]] },
    { name: "SUPORTE", channels: [["ajuda", "text"], ["chamados", "text"]] },
    { name: "VOZ", channels: [["Sala Geral", "voice"], ["Jogatina", "voice"]] },
  ],
  estudo: [
    { name: "ESTUDO", channels: [["geral", "text"], ["materiais", "text"], ["duvidas", "text"]] },
    { name: "ENCONTROS", channels: [["Sala de Estudo", "voice"]] },
  ],
  jogos: [
    { name: "LOBBY", channels: [["geral", "text"], ["combos", "text"]] },
    { name: "PARTIDAS", channels: [["Sala 1", "voice"], ["Sala 2", "voice"]] },
  ],
  dev: [
    { name: "PROJETO", channels: [["geral", "text"], ["bugs", "text"], ["releases", "text"]] },
    { name: "REUNIÕES", channels: [["Call", "voice"]] },
  ],
  vazio: [{ name: "GERAL", channels: [["geral", "text"]] }],
};

async function getUser(id) {
  const rows = await db.select("users", { where: { id }, limit: 1 });
  return rows && rows[0] ? rows[0] : null;
}

/* ------------------------------------------------------------
   Imagem do ícone do servidor.
   Segue o mesmo padrão do avatar/banner: data URL validado AQUI
   (tipo, estrutura e tamanho real). Só PNG, JPG e WEBP — SVG é
   recusado de propósito: ele nunca foi aceito como avatar e carrega
   script em contexto de imagem. O cliente redimensiona antes de
   enviar; 900 KB é o teto do arquivo pronto.
   ------------------------------------------------------------ */
const ICON_IMAGE_LIMIT = 900000;

function sanitizeServerIconImage(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") throw bad("Ícone do servidor inválido.");
  if (raw.length > ICON_IMAGE_LIMIT)
    throw bad("Esta imagem é grande demais. Use uma com até 1 MB.");
  if (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(raw))
    throw bad("Envie uma imagem PNG, JPG ou WEBP.");
  return raw;
}

/* ------------------------------------------------------------
   Cores do logo do servidor (fundo e símbolo).
   São pintadas no cliente via CSS, mas o BANCO só pode receber
   cor bem formada: validamos o formato aqui e descartamos o resto.
   Aceita #RGB ou #RRGGBB (com ou sem #), devolve minúsculo.
   ------------------------------------------------------------ */
function sanitizeLogoColor(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (s.charAt(0) !== "#") s = "#" + s;
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s))
    throw bad("Cor inválida. Use um código hexadecimal como #22D3A6.");
  if (s.length === 4) s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return s.toLowerCase();
}

/* ------------------------------------------------------------
   Ícone de um cargo personalizado.
   O cliente aceita duas coisas e só: o NOME de um ícone SVG da
   galeria do Nexo (ex.: "crown") ou um EMOJI escolhido. Nada de
   HTML, atributo ou URL — o valor é sempre escapado ao voltar
   para a tela, e aqui já chega limpo.
   ------------------------------------------------------------ */
function sanitizeRoleIcon(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  /* 12 caracteres é folgado para nome de ícone e para emoji com
     ZWJ (ex.: "👨‍👩‍👧"), e curto demais para esconder qualquer coisa */
  if (s.length > 12)
    throw bad("O ícone do cargo pode ter no máximo 12 caracteres.");
  /* caracteres de controle (inclusive quebra de linha) nunca fazem
     parte de um ícone */
  if (/[\u0000-\u001f\u007f]/.test(s))
    throw bad("O ícone contém caracteres inválidos.");
  return s;
}

/* Descrição curta do cargo: texto puro, uma linha só. */
function sanitizeRoleDescription(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return s ? s.slice(0, 160) : null;
}

/* registro de auditoria: actorId, ação, alvo, serverId, timestamp.
   Nunca registra senha, token ou cookie. */
async function log(serverId, action, meta, target, actorId) {
  const entry = {
    id: u.uid("lg"),
    serverId,
    action,
    actorId: actorId || null,
    target: target || null,
    meta: meta || null,
    at: now(),
    createdAt: now(),
  };
  await db.insert("logs", entry);
  return entry;
}

/* melhor esforço: o app de Logs registra o evento sem nunca
   quebrar a ação que o usuário pediu */
function appsEvent(serverId, action, meta, ctxS) {
  try {
    const p = require("./apps").onEvent(serverId, action, meta, ctxS);
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {
    /* módulo de apps indisponível: segue sem log de bot */
  }
}

async function notifyUser(userId, type, text, meta) {
  const note = await handlersAuth.createNotification(userId, type, text, meta);
  return note;
}

async function loadMembership(serverId, userId) {
  const rows = await db.select("memberships", {
    where: { server_id: serverId, user_id: userId },
    limit: 1,
  });
  return rows && rows[0] ? rows[0] : null;
}

/* ============================ ROTAS ============================ */
function routes() {
  return [
    ["GET", "/servers", listServers],
    /* público: só servidores com discoverable=true (ver listExplore) */
    ["GET", "/explore", listExplore],
    ["POST", "/servers", createServer],
    ["PATCH", "/servers/:id", updateServer],
    ["DELETE", "/servers/:id", deleteServer],
    ["POST", "/servers/:id/leave", leaveServer],
    ["POST", "/servers/:id/join", joinServer],
    ["GET", "/invites/:code", previewInvite],
    ["POST", "/invites/:code/join", joinByInvite],
    ["GET", "/servers/:id/invites", listInvites],
    ["POST", "/servers/:id/invites", createInvite],
    ["DELETE", "/invites/:code", revokeInvite],
    ["POST", "/servers/:id/roles", createRole],
    ["PATCH", "/roles/:id", updateRole],
    ["DELETE", "/roles/:id", deleteRole],
    ["PATCH", "/servers/:serverId/members/:userId", updateMember],
    ["DELETE", "/servers/:serverId/members/:userId", kickMember],
    ["POST", "/servers/:serverId/bans", banMember],
    ["DELETE", "/servers/:serverId/bans/:userId", unbanMember],
    ["POST", "/servers/:serverId/transfer", transferOwnership],
    ["GET", "/servers/:id/logs", listLogs],
    ["POST", "/servers/:id/categories", createCategory],
    ["PATCH", "/categories/:id", updateCategory],
    ["DELETE", "/categories/:id", deleteCategory],
    ["POST", "/servers/:id/channels", createChannel],
    ["PATCH", "/channels/:id", updateChannel],
    ["DELETE", "/channels/:id", deleteChannel],
    ["POST", "/channels/:id/perms", setChannelPerm],
    ["POST", "/categories/:id/perms", setCategoryPerm],
    ["PATCH", "/channels/:id/inherit", setChannelInheritance],
  ];
}

/* ------------------------- servidores ------------------------- */
async function listServers(ctx) {
  const me = await auth.requireUser(ctx.event);
  const memberships = await db.select("memberships", { where: { user_id: me.id }, limit: 500 });
  const ids = (memberships || []).map((m) => m.serverId);
  if (!ids.length) return { data: [] };
  const servers = await db.select("servers", { where: { id: ids }, limit: 500 });
  return { data: servers || [] };
}

/* ------------------------ EXPLORAR (público) ------------------------
   Diretório público: lista SOMENTE servidores com discoverable=true.
   Nunca devolve servidores privados, membros, canais ou dono — só o
   que a tela do diretório mostra. As contagens são REAIS, lidas das
   próprias memberships/channels (nada inventado). Preenche também
   `memberCount`/`channelCount` porque quem NÃO é membro não tem essas
   memberships no cache local. */
async function listExplore(ctx) {
  const rows = (await db.select("servers", { where: { discoverable: true }, limit: 100 })) || [];
  if (!rows.length) return { data: [] };

  const ids = rows.map((s) => s.id);
  const memberRows = (await db.select("memberships", { where: { server_id: ids }, limit: 20000 })) || [];
  const channelRows = (await db.select("channels", { where: { server_id: ids }, limit: 20000 })) || [];

  const counts = {};
  ids.forEach((id) => (counts[id] = { members: 0, channels: 0 }));
  memberRows.forEach((m) => {
    if (counts[m.serverId]) counts[m.serverId].members++;
  });
  channelRows.forEach((c) => {
    if (counts[c.serverId]) counts[c.serverId].channels++;
  });

  const data = rows.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description || "",
    icon: s.icon || null,
    banner: s.banner || null,
    isOfficial: !!s.isOfficial,
    createdAt: s.createdAt || null,
    discoverable: true,
    memberCount: counts[s.id].members,
    channelCount: counts[s.id].channels,
  }));

  return { data };
}

/* ---------------- Servidor Oficial Nexo — REMOVIDO ----------------
   A rota pública GET /servers/official e o officialView() saíram
   junto com a criação automática (server/official.js não provisiona
   mais nada). O registro legado permanece no banco, intocado. */

async function createServer(ctx) {
  const me = await auth.requireUser(ctx.event);
  const body = ctx.body || {};
  const name = String(body.name || "").trim();
  if (name.length < 2) throw bad("Dê um nome com pelo menos 2 caracteres ao servidor.");
  if (name.length > 40) throw bad("O nome pode ter no máximo 40 caracteres.");
  /* ninguém cria um servidor que se passe pelo oficial */
  if (official.isOfficialName(name))
    throw bad("Este nome é reservado ao Servidor Oficial Nexo.");
  if (body.isOfficial || body.officialKey || body.is_official || body.official_key)
    throw bad("A marca de servidor oficial não pode ser escolhida por conta própria.");

  const id = u.uid("sv");
  const server = {
    id,
    name,
    description: String(body.description || "").slice(0, 240),
    icon: {
      /* padrão SEM emoji: o cliente mostra as iniciais do nome.
         Imagem só entra quando a pessoa envia no seletor; emoji
         continua sendo aceito por compatibilidade com clientes
         antigos. */
      emoji:
        typeof body.emoji === "string" && body.emoji.trim()
          ? body.emoji.trim().slice(0, 8)
          : null,
      color: sanitizeLogoColor(body.color) || u.colorFor(id),
      /* cor do símbolo (iniciais/glyph): null = padrão escuro */
      glyphColor: sanitizeLogoColor(body.glyphColor),
      /* modo do logo do criador; null = imagem-primeiro (padrão) */
      mode:
        String(body.mode || "") === "logo" || String(body.mode || "") === "image"
          ? String(body.mode)
          : null,
      image: sanitizeServerIconImage(body.icon && body.icon.image),
    },
    banner: null,
    appearance: { primary: "#35e0a8", secondary: "#8f83ff", backgroundImage: null, theme: "dark" },
    ownerId: me.id,
    discoverable: false,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.insert("servers", server);

  const defRole = {
    id: u.uid("rl"),
    serverId: id,
    name: "Membros",
    color: "#93a8a4",
    position: 0,
    isDefault: true,
    permissions: acl.defaultPerms(["viewChannels", "sendMessages", "createInvite", "joinVoice"]),
    createdAt: now(),
  };
  await db.insert("roles", defRole);

  const membership = {
    id: u.uid("mb"),
    serverId: id,
    userId: me.id,
    roleId: defRole.id,
    permissions: {},
    nickname: "",
    extraRoleIds: [],
    joinedAt: now(),
    createdAt: now(),
  };
  await db.insert("memberships", membership);

  const template = TEMPLATES[body.templateId] || TEMPLATES.comunidade;
  const createdChannels = [];
  const createdCategories = [];
  let order = 0;
  for (const cat of template) {
    const catId = u.uid("ct");
    const category = {
      id: catId,
      serverId: id,
      name: cat.name,
      order: order++,
      collapsed: false,
      perms: {},
      createdAt: now(),
    };
    await db.insert("categories", category);
    createdCategories.push(category);

    let i = 0;
    for (const ch of cat.channels) {
      const channel = {
        id: u.uid("ch"),
        serverId: id,
        categoryId: catId,
        name: ch[1] === "voice" ? ch[0] : u.slug(ch[0]) || "geral",
        type: ch[1],
        order: i++,
        topic: "",
        perms: {},
        inheritPerms: true,
        overrides: { view: "all", send: "all" },
        createdBy: me.id,
        createdAt: now(),
        updatedAt: now(),
      };
      await db.insert("channels", channel);
      createdChannels.push(channel);
    }
  }

  const first = createdChannels.find((c) => c.type === "text");
  const patch = P.createPatch();
  P.set(patch, "servers", id, server);
  P.set(patch, "roles", defRole.id, defRole);
  P.set(patch, "memberships", membership.id, membership);
  createdCategories.forEach((c) => P.set(patch, "categories", c.id, c));
  createdChannels.forEach((c) => P.set(patch, "channels", c.id, c));

  return { status: 201, data: server, patch, meta: { firstChannelId: first ? first.id : null } };
}

async function updateServer(ctx) {
  const me = await auth.requireUser(ctx.event);
  const serverId = ctx.params.id;
  const ctxS = await acl.loadServer(serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageServer", "Você não tem permissão para editar este servidor.");

  const patchBody = ctx.body || {};
  const update = {};
  const s = ctxS.server;
  if (patchBody.name !== undefined) {
    const n = String(patchBody.name).trim();
    if (n.length < 2) throw bad("O nome precisa de pelo menos 2 caracteres.");
    /* renomear para o nome do oficial é impedimento contra
       se passar pelo Servidor Oficial Nexo */
    if (!official.isOfficial(s) && official.isOfficialName(n))
      throw bad("Este nome é reservado ao Servidor Oficial Nexo.");
    update.name = n.slice(0, 40);
  }
  if (patchBody.isOfficial !== undefined || patchBody.officialKey !== undefined)
    throw forbidden("A marca de servidor oficial não pode ser alterada.");
  if (patchBody.description !== undefined)
    update.description = String(patchBody.description).slice(0, 240);
  if (patchBody.icon !== undefined) {
    if (typeof patchBody.icon !== "object" || patchBody.icon === null)
      throw bad("Ícone do servidor inválido.");
    const next = Object.assign({}, s.icon, patchBody.icon);
    /* null limpa a imagem e volta o fallback (emoji/iniciais) */
    next.image = sanitizeServerIconImage(next.image);
    /* cores do logo: só formato válido entra no banco. `null` limpa
       (volta ao padrão) e `undefined` preserva a atual. */
    if (patchBody.icon.color !== undefined)
      next.color = sanitizeLogoColor(patchBody.icon.color) || u.colorFor(serverId);
    if (patchBody.icon.glyphColor !== undefined)
      next.glyphColor = sanitizeLogoColor(patchBody.icon.glyphColor);
    /* modo do logo: "image" (foto em primeiro) ou "logo" (monograma
       colorido por cima, SEM apagar a foto). Qualquer outra coisa
       vira null = servidor decide (imagem-primeiro, como sempre). */
    if (patchBody.icon.mode !== undefined) {
      const md = String(patchBody.icon.mode || "");
      next.mode = md === "logo" || md === "image" ? md : null;
    }
    update.icon = next;
  }
  if (patchBody.appearance !== undefined) {
    await db.assertWritable(
      "servers",
      "appearance",
      "A aparência do servidor não está disponível neste banco. Execute a migração do Nexo (supabase/migrations/0001_nexo_backend.sql) e tente novamente."
    );
    update.appearance = Object.assign({}, s.appearance, patchBody.appearance);
  }
  if (patchBody.banner !== undefined) {
    if (patchBody.banner && String(patchBody.banner).length > 1400000)
      throw bad("Este banner é grande demais. Use uma imagem com até 1,5 MB.");
    update.banner = patchBody.banner || null;
  }
  if (patchBody.discoverable !== undefined) {
    await db.assertWritable(
      "servers",
      "discoverable",
      "A descoberta de servidores não está disponível neste banco. Execute a migração do Nexo (supabase/migrations/0001_nexo_backend.sql)."
    );
    update.discoverable = !!patchBody.discoverable;
  }

  if (!Object.keys(update).length) return { data: s, patch: null };
  update.updatedAt = now();
  await db.update("servers", { where: { id: serverId } }, update);

  const fresh = (await db.select("servers", { where: { id: serverId }, limit: 1 }))[0];
  const entry = await log(serverId, "server.update", { name: fresh.name }, null, me.id);
  const patch = P.createPatch();
  P.set(patch, "servers", serverId, fresh);
  P.set(patch, "logs", entry.id, entry);
  return { data: fresh, patch };
}

async function deleteServer(ctx) {
  const me = await auth.requireUser(ctx.event);
  const serverId = ctx.params.id;
  const ctxS = await acl.loadServer(serverId);
  if (official.isOfficial(ctxS.server))
    throw forbidden("O Servidor Oficial Nexo não pode ser excluído.");
  if (ctxS.server.ownerId !== me.id)
    throw forbidden("Apenas o dono do servidor pode excluí-lo.");

  const channels = ctxS.channels;
  const channelIds = channels.map((c) => c.id);
  if (channelIds.length)
    await db.remove("messages", { where: { channel_id: channelIds } });
  await db.remove("channels", { where: { server_id: serverId } });
  await db.remove("categories", { where: { server_id: serverId } });
  await db.remove("memberships", { where: { server_id: serverId } });
  await db.remove("roles", { where: { server_id: serverId } });
  await db.remove("invites", { where: { server_id: serverId } });
  await db.remove("bans", { where: { server_id: serverId } });
  await db.remove("logs", { where: { server_id: serverId } });
  await db.remove("servers", { where: { id: serverId } });

  const patch = P.createPatch();
  P.del(patch, "servers", [serverId]);
  P.del(patch, "channels", channelIds);
  ctxS.categories.forEach((c) => P.del(patch, "categories", [c.id]));
  Object.keys(ctxS.byUser).forEach((uid) =>
    P.del(patch, "memberships", [ctxS.byUser[uid].id])
  );
  Object.keys(ctxS.roleById).forEach((rid) => P.del(patch, "roles", [rid]));
  return { data: true, patch };
}

async function leaveServer(ctx) {
  const me = await auth.requireUser(ctx.event);
  const serverId = ctx.params.id;
  const ctxS = await acl.loadServer(serverId);
  const membership = acl.membershipOf(ctxS, me.id);
  if (!membership) throw forbidden("Você não faz parte deste servidor.");
  if (ctxS.server.ownerId === me.id)
    throw forbidden(
      "O dono não pode sair do próprio servidor. Transfira a propriedade primeiro."
    );

  await db.remove("memberships", { where: { id: membership.id } });
  const entry = await log(serverId, "member.leave", { userId: me.id }, me.id, me.id);
  appsEvent(serverId, "member.leave", { userId: me.id, username: me.username, actorId: me.id }, ctxS);
  const patch = P.createPatch();
  P.del(patch, "memberships", [membership.id]);
  P.set(patch, "logs", entry.id, entry);
  P.del(patch, "servers", [serverId]); /* o servidor sai da minha lista */
  return { data: true, patch };
}

async function joinServer(ctx) {
  const me = await auth.requireUser(ctx.event);
  const serverId = ctx.params.id;
  const invite = (ctx.body || {}).invite || null;
  const ctxS = await acl.loadServer(serverId);
  if (acl.membershipOf(ctxS, me.id)) throw bad("Você já faz parte deste servidor.");

  const ban = ctxS.bans.find((b) => b.userId === me.id);
  if (ban)
    throw bad(
      "Você foi banido deste servidor" +
        (ban.reason ? " pelo motivo: " + ban.reason : ".") +
        " Fale com a moderação."
    );

  const membership = {
    id: u.uid("mb"),
    serverId,
    userId: me.id,
    roleId: ctxS.defaultRole ? ctxS.defaultRole.id : null,
    permissions: {},
    nickname: "",
    extraRoleIds: [],
    joinedAt: now(),
    createdAt: now(),
  };
  await db.insert("memberships", membership);

  /* apps instalados: AutoRole define o cargo antes do patch ser
     montado; boas-vindas e logs publicam a mensagem do bot */
  let botJoin = null;
  try {
    botJoin = await require("./apps").onMemberJoin({
      serverId,
      user: me,
      membership,
      ctxS,
    });
    if (botJoin && botJoin.roleId) {
      membership.roleId = botJoin.roleId;
      await db.update(
        "memberships",
        { where: { id: membership.id } },
        { roleId: botJoin.roleId }
      );
    }
  } catch (e) {
    botJoin = null;
  }

  if (invite && invite.code) {
    await db.update(
      "invites",
      { where: { code: invite.code } },
      { uses: Number(invite.uses || 0) + 1 }
    );
  }

  const entry = await log(serverId, "member.join", { userId: me.id }, me.id, me.id);
  let note = null;
  /* dono é a conta de SISTEMA? não existe pessoa para avisar */
  if (
    ctxS.server.ownerId &&
    ctxS.server.ownerId !== me.id &&
    !official.isSystemUser(ctxS.server.ownerId)
  ) {
    note = await notifyUser(
      ctxS.server.ownerId,
      "server",
      me.displayName + " entrou em " + ctxS.server.name + ".",
      { href: "#/servidores/" + serverId, actorId: me.id }
    );
  }

  /* canal inicial + canais entregues no join: só os que a pessoa
     CONSEGUE ver — canal privado de ticket não vaza para quem
     acabou de entrar (mesmo portão do sync: canViewChannel). */
  let first = null;
  for (const c of ctxS.channels) {
    if (c.type !== "text" || first) continue;
    if (await acl.canViewChannel(ctxS, c, me.id)) first = c;
  }
  const patch = P.createPatch();
  P.set(patch, "servers", serverId, ctxS.server);
  P.set(patch, "memberships", membership.id, membership);
  P.set(patch, "logs", entry.id, entry);
  if (note) P.set(patch, "notifications", note.id, note);
  (botJoin && botJoin.messages ? botJoin.messages : []).forEach((m) =>
    P.set(patch, "messages", m.id, m)
  );
  ctxS.categories.forEach((c) => P.set(patch, "categories", c.id, c));
  for (const c of ctxS.channels) {
    if (await acl.canViewChannel(ctxS, c, me.id)) P.set(patch, "channels", c.id, c);
  }
  ctxS.bans.forEach((b) => P.set(patch, "bans", b.id, b));
  Object.keys(ctxS.roleById).forEach((rid) =>
    P.set(patch, "roles", rid, ctxS.roleById[rid])
  );

  return { data: ctxS.server, patch, meta: { firstChannelId: first ? first.id : null } };
}

/* --------------------------- convites --------------------------- */
/* pré-visualização do convite: é a tela pública mostrada ANTES do
   login (e antes de entrar). O código do convite é o próprio acesso
   — a entrada continua exigindo sessão em /invites/:code/join.
   Devolve só o que a tela mostra: servidor + perfil mínimo do dono. */
async function previewInvite(ctx) {
  const code = String(ctx.params.code || "").toUpperCase();
  const rows = await db.select("invites", { where: { code }, limit: 1 });
  const invite = rows && rows[0];
  if (!invite) throw notFound("Convite inválido ou expirado.");
  const server = (await db.select("servers", { where: { id: invite.serverId }, limit: 1 }))[0];
  if (!server) throw notFound("Convite inválido ou expirado.");

  let owner = null;
  if (server.ownerId) {
    const own = (await db.select("users", { where: { id: server.ownerId }, limit: 1 }))[0];
    if (own) {
      const pub = auth.publicUser(own);
      owner = {
        id: pub.id,
        username: pub.username,
        displayName: pub.displayName,
        avatar: pub.avatar,
        status: pub.status,
      };
    }
  }

  /* memberships no Supabase NÃO tem coluna `id` (chave composta
     serverId+userId), então db.count (que seleciona `id`) falha
     lá — contar via select, que funciona nos dois drivers. */
  const memberRows = await db.select("memberships", {
    where: { server_id: server.id },
    limit: 10000,
  });
  const memberCount = (memberRows || []).length;

  return { data: { invite, server, owner, memberCount: memberCount || 0 } };
}

async function joinByInvite(ctx) {
  const me = await auth.requireUser(ctx.event);
  const code = String(ctx.params.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const rows = await db.select("invites", { where: { code }, limit: 1 });
  const invite = rows && rows[0];
  if (!invite) throw bad("Convite inválido ou expirado. Peça um novo link para quem criou.");
  if (invite.expiresAt && Number(invite.expiresAt) < now())
    throw bad("Este convite expirou. Peça um novo link para quem criou.");
  if (invite.maxUses && Number(invite.uses) >= Number(invite.maxUses))
    throw bad("Este convite atingiu o limite de usos. Peça um novo link.");

  const result = await joinServer({
    params: { id: invite.serverId },
    body: { invite },
    headers: ctx.headers,
    event: ctx.event,
    query: {},
  });

  /* ---- Conquistas do Brasil 🇧🇷 ---------------------------
     Conta só ENTRADA REAL confirmada por ESTE convite: o código
     veio do caminho da rota e o convite foi lido pelo servidor
     (nunca pelo corpo do pedido). Gerar/copiar link sozinho não
     conta; entrar pelo POST genérico /servers/:id/join (corpo
     vindo do cliente) também não conta. A gravação roda no
     lockPrefs de quem convidou: entradas simultâneas ficam em
     fila e a mesma pessoa nunca conta duas vezes. */
  let brasil = null;
  try {
    const customH = require("./custom");
    brasil = await customH.recordInviteJoin(
      invite.creatorId,
      me.id,
      invite.serverId,
      invite.code
    );
  } catch (e) {
    brasil = null; /* a entrada em si já foi criada; coleção não derruba o join */
  }
  if (brasil && brasil.unlocked && brasil.unlocked.length) {
    try {
      const plateMod = require("../custom");
      const names = brasil.unlocked
        .map(function (pid) {
          const p = plateMod.plateById(pid);
          return p ? p.name : pid;
        })
        .join(", ");
      await notifyUser(
        invite.creatorId,
        "conquest",
        "Conquista do Brasil desbloqueada: " +
          names +
          " (" +
          brasil.count +
          (brasil.count === 1 ? " convite confirmado" : " convites confirmados") +
          ").",
        { href: "#/loja" }
      );
    } catch (e) {
      /* notificação é bônus: a conquista já ficou gravada */
    }
  }
  return result;
}

async function listInvites(ctx) {
  const me = await auth.requireUser(ctx.event);
  const ctxS = await acl.loadServer(ctx.params.id);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageServer", "Você não tem permissão para ver os convites.");
  const list = await db.select("invites", { where: { server_id: ctx.params.id }, limit: 200 });
  return { data: list || [] };
}

async function createInvite(ctx) {
  const me = await auth.requireUser(ctx.event);
  const serverId = ctx.params.id;
  const ctxS = await acl.loadServer(serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "createInvite", "Você não tem permissão para criar convites.");

  const body = ctx.body || {};
  let code = u.inviteCode();
  for (let i = 0; i < 5; i++) {
    const taken = await db.select("invites", { where: { code }, limit: 1 });
    if (!taken || !taken.length) break;
    code = u.inviteCode();
  }
  const invite = {
    code,
    serverId,
    creatorId: me.id,
    uses: 0,
    maxUses: Number(body.maxUses) || 0,
    expiresAt: body.expiresIn ? now() + Number(body.expiresIn) * 60000 : null,
    createdAt: now(),
  };
  await db.insert("invites", invite);
  const entry = await log(serverId, "invite.create", { code }, code, me.id);
  const patch = P.createPatch();
  P.set(patch, "invites", code, invite);
  P.set(patch, "logs", entry.id, entry);
  return { status: 201, data: invite, patch };
}

async function revokeInvite(ctx) {
  const me = await auth.requireUser(ctx.event);
  const code = String(ctx.params.code || "").toUpperCase();
  const rows = await db.select("invites", { where: { code }, limit: 1 });
  const invite = rows && rows[0];
  if (!invite) throw notFound("Este convite não existe mais.");

  if (invite.creatorId !== me.id) {
    const ctxS = await acl.loadServer(invite.serverId);
    acl.requirePerm(
      ctxS,
      me.id,
      "manageServer",
      "Você não pode revogar este convite."
    );
  }
  await db.remove("invites", { where: { code } });
  const entry = await log(invite.serverId, "invite.revoke", { code }, code, me.id);
  const patch = P.createPatch();
  P.del(patch, "invites", [code]);
  P.set(patch, "logs", entry.id, entry);
  return { data: true, patch };
}

/* ---------------------------- cargos ---------------------------- */
async function createRole(ctx) {
  const me = await auth.requireUser(ctx.event);
  const serverId = ctx.params.id;
  const ctxS = await acl.loadServer(serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageRoles", "Você não tem permissão para criar cargos.");

  const body = ctx.body || {};
  const name = String(body.name || "").trim();
  if (name.length < 2) throw bad("Dê um nome com pelo menos 2 caracteres ao cargo.");
  if ((await db.count("roles", { where: { server_id: serverId } })) >= 60)
    throw bad("Este servidor já atingiu o limite de cargos.");

  /* cargos personalizados: nome, cor, ícone e descrição livres.
     Permissões são escolhidas, mas NUNCA vêm automático — quem
     cria um cargo não recebe nada só por tê-lo criado. */
  const role = {
    id: u.uid("rl"),
    serverId,
    name: name.slice(0, 32),
    color: body.color || u.colorFor(name),
    position: Number(body.position) || (await db.count("roles", { where: { server_id: serverId } })),
    isDefault: false,
    icon: sanitizeRoleIcon(body.icon),
    description: sanitizeRoleDescription(body.description),
    permissions: acl.normalizePerms(body.permissions, true),
    createdAt: now(),
  };
  await db.insert("roles", role);
  const entry = await log(serverId, "role.create", { name: role.name }, role.id, me.id);
  const patch = P.createPatch();
  P.set(patch, "roles", role.id, role);
  P.set(patch, "logs", entry.id, entry);
  return { status: 201, data: role, patch };
}

async function updateRole(ctx) {
  const me = await auth.requireUser(ctx.event);
  const rows = await db.select("roles", { where: { id: ctx.params.id }, limit: 1 });
  const role = rows && rows[0];
  if (!role) throw notFound("Cargo não encontrado.");
  const ctxS = await acl.loadServer(role.serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageRoles", "Você não tem permissão para editar cargos.");
  /* hierarquia: não deixa um nível menor mexer num cargo maior */
  if (!acl.canManageRole(ctxS, me.id, role))
    throw forbidden("Você não pode editar um cargo acima do seu na hierarquia.");

  const body = ctx.body || {};
  const update = {};
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (n.length < 2) throw bad("O nome precisa de pelo menos 2 caracteres.");
    update.name = n.slice(0, 32);
  }
  if (body.color !== undefined) update.color = String(body.color || "").slice(0, 20);
  if (body.icon !== undefined) update.icon = sanitizeRoleIcon(body.icon);
  if (body.description !== undefined)
    update.description = sanitizeRoleDescription(body.description);
  if (body.position !== undefined) {
    const target = Number(body.position);
    if (!Number.isFinite(target) || target < 0)
      throw bad("Posição de cargo inválida.");
    update.position = target;
  }
  if (body.permissions !== undefined)
    update.permissions = acl.normalizePerms(body.permissions, true);

  if (Object.keys(update).length) {
    await db.update("roles", { where: { id: role.id } }, update);
  }
  const fresh = (await db.select("roles", { where: { id: role.id }, limit: 1 }))[0];
  const entry = await log(role.serverId, "role.update", { name: fresh.name }, role.id, me.id);
  const patch = P.createPatch();
  P.set(patch, "roles", role.id, fresh);
  P.set(patch, "logs", entry.id, entry);
  return { data: fresh, patch };
}

async function deleteRole(ctx) {
  const me = await auth.requireUser(ctx.event);
  const rows = await db.select("roles", { where: { id: ctx.params.id }, limit: 1 });
  const role = rows && rows[0];
  if (!role) throw notFound("Cargo não encontrado.");
  const ctxS = await acl.loadServer(role.serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageRoles", "Você não tem permissão para apagar cargos.");
  if (role.isDefault) throw bad("O cargo padrão do servidor não pode ser excluído.");
  if (!acl.canManageRole(ctxS, me.id, role))
    throw forbidden("Você não pode excluir um cargo acima do seu na hierarquia.");

  await db.remove("roles", { where: { id: role.id } });
  /* o cargo some dos membros (a associação fica em member_roles) */
  await db.remove("member_roles", {
    where: { server_id: role.serverId, role_id: role.id },
  });
  const entry = await log(role.serverId, "role.delete", { name: role.name }, role.id, me.id);
  const patch = P.createPatch();
  P.del(patch, "roles", [role.id]);
  P.set(patch, "logs", entry.id, entry);
  return { data: true, patch };
}

/* ---------------------------- membros ---------------------------- */
async function updateMember(ctx) {
  const me = await auth.requireUser(ctx.event);
  const { serverId, userId } = ctx.params;
  const ctxS = await acl.loadServer(serverId);
  acl.requireMember(ctxS, me.id);
  const isSelf = userId === me.id;
  if (!isSelf)
    acl.requirePerm(ctxS, me.id, "manageMembers", "Você não tem permissão para gerenciar membros.");

  const membership = acl.membershipOf(ctxS, userId);
  if (!membership) throw notFound("Este usuário não faz parte do servidor.");

  const body = ctx.body || {};
  const update = {};
  if (body.roleId !== undefined) {
    if (!isSelf)
      acl.requirePerm(ctxS, me.id, "manageRoles", "Você não tem permissão para alterar cargos.");
    if (body.roleId) {
      const target = ctxS.roleById[body.roleId];
      if (!target) throw bad("Cargo inválido.");
      if (!acl.isOwner(ctxS, me.id) && !acl.can(ctxS, me.id, "manageRoles"))
        throw forbidden("Você não tem permissão para este cargo.");
      /* Hierarquia: só se atribui cargo que esteja dentro do próprio
         alcance. Sem isto, qualquer pessoa com manageRoles se dava um
         cargo acima da própria — inclusive a si mesma, já que a rota
         aceita `isSelf`. Dono e administrador passam por tudo. */
      if (!acl.canManageRole(ctxS, me.id, target))
        throw forbidden("Você não pode atribuir um cargo acima do seu na hierarquia.");
      /* Ninguém tira o cargo de quem está acima de si na hierarquia */
      const currentRole = membership.roleId ? ctxS.roleById[membership.roleId] : null;
      if (currentRole && !currentRole.isDefault && !acl.canManageRole(ctxS, me.id, currentRole))
        throw forbidden("Você não pode alterar o cargo de alguém acima de você na hierarquia.");
    }
    update.roleId = body.roleId;
  }
  if (body.nickname !== undefined) update.nickname = String(body.nickname || "").slice(0, 32);
  if (body.permissions !== undefined) {
    acl.requirePerm(ctxS, me.id, "manageMembers", "Você não tem permissão para alterar permissões.");
    await db.assertWritable(
      "memberships",
      "permissions",
      "Permissões por membro não estão disponíveis neste banco. Execute a migração do Nexo (supabase/migrations/0001_nexo_backend.sql)."
    );
    update.permissions = acl.normalizePerms(body.permissions, true);
  }

  if (!Object.keys(update).length) return { data: membership };
  await db.update("memberships", { where: { id: membership.id } }, update);

  const fresh = (await db.select("memberships", { where: { id: membership.id }, limit: 1 }))[0];
  const patch = P.createPatch();
  P.set(patch, "memberships", membership.id, fresh);
  let entry = null;
  if (update.roleId !== undefined)
    entry = await log(serverId, "member.role", { userId, roleId: update.roleId }, userId, me.id);
  else if (update.nickname !== undefined)
    entry = await log(serverId, "member.nick", { userId, nickname: update.nickname }, userId, me.id);
  if (entry) P.set(patch, "logs", entry.id, entry);
  return { data: fresh, patch };
}

async function kickMember(ctx) {
  const me = await auth.requireUser(ctx.event);
  const { serverId, userId } = ctx.params;
  const ctxS = await acl.loadServer(serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "kickMembers", "Você não tem permissão para expulsar membros.");
  if (userId === me.id) throw bad("Você não pode expulsar a si mesmo.");
  if (ctxS.server.ownerId === userId) throw bad("Você não pode expulsar o dono do servidor.");

  const membership = acl.membershipOf(ctxS, userId);
  if (!membership) throw notFound("Este usuário não faz parte do servidor.");
  await db.remove("memberships", { where: { id: membership.id } });

  const entry = await log(serverId, "member.kick", { userId }, userId, me.id);
  appsEvent(serverId, "member.kick", { userId, actorId: me.id }, ctxS);
  const patch = P.createPatch();
  P.del(patch, "memberships", [membership.id]);
  P.set(patch, "logs", entry.id, entry);
  return { data: true, patch };
}

async function banMember(ctx) {
  const me = await auth.requireUser(ctx.event);
  const serverId = ctx.params.serverId;
  const userId = (ctx.body || {}).userId;
  const ctxS = await acl.loadServer(serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "banMembers", "Você não tem permissão para banir membros.");
  if (userId === me.id) throw bad("Você não pode banir a si mesmo.");
  if (ctxS.server.ownerId === userId) throw bad("Você não pode banir o dono do servidor.");

  const target = await getUser(userId);
  if (!target) throw notFound("Usuário não encontrado.");
  const existing = ctxS.bans.find((b) => b.userId === userId);
  if (existing) throw bad("Esta pessoa já está banida.");

  const ban = {
    id: serverId + ":" + userId,
    serverId,
    userId,
    reason: String((ctx.body || {}).reason || "").slice(0, 200),
    byId: me.id,
    at: now(),
    createdAt: now(),
  };
  await db.insert("bans", ban);
  const membership = acl.membershipOf(ctxS, userId);
  if (membership) await db.remove("memberships", { where: { id: membership.id } });

  const entry = await log(serverId, "member.ban", { userId, reason: ban.reason }, userId, me.id);
  appsEvent(serverId, "member.ban", { userId, reason: ban.reason, actorId: me.id }, ctxS);
  const patch = P.createPatch();
  P.set(patch, "bans", ban.id, ban);
  if (membership) P.del(patch, "memberships", [membership.id]);
  P.set(patch, "logs", entry.id, entry);
  return { data: ban, patch };
}

async function unbanMember(ctx) {
  const me = await auth.requireUser(ctx.event);
  const serverId = ctx.params.serverId;
  const userId = ctx.params.userId;
  const ctxS = await acl.loadServer(serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "unbanMembers", "Você não tem permissão para desbanir membros.");

  const ban = ctxS.bans.find((b) => b.userId === userId);
  if (!ban) throw notFound("Este banimento não existe.");
  await db.remove("bans", { where: { id: ban.id } });
  const entry = await log(serverId, "member.unban", { userId }, userId, me.id);
  appsEvent(serverId, "member.unban", { userId, actorId: me.id }, ctxS);
  const patch = P.createPatch();
  P.del(patch, "bans", [ban.id]);
  P.set(patch, "logs", entry.id, entry);
  return { data: true, patch };
}

/* transferência de propriedade: só o dono, e nunca para conta
   inexistente, banida ou que não seja membro */
async function transferOwnership(ctx) {
  const me = await auth.requireUser(ctx.event);
  const serverId = ctx.params.serverId;
  const targetId = (ctx.body || {}).userId;
  const ctxS = await acl.loadServer(serverId);
  if (ctxS.server.ownerId !== me.id)
    throw forbidden("Apenas o dono do servidor pode transferir a propriedade.");
  if (!targetId || targetId === me.id) throw bad("Escolha outro usuário.");
  const target = await getUser(targetId);
  if (!target) throw notFound("Usuário não encontrado.");
  if (ctxS.bans.some((b) => b.userId === targetId))
    throw bad("Não é possível transferir a propriedade para alguém banido.");
  if (!acl.membershipOf(ctxS, targetId))
    throw bad("Apenas um membro do servidor pode receber a propriedade.");

  await db.update("servers", { where: { id: serverId } }, { ownerId: targetId, updatedAt: now() });
  const fresh = (await db.select("servers", { where: { id: serverId }, limit: 1 }))[0];
  const entry = await log(serverId, "ownership.transfer", { from: me.id, to: targetId }, targetId, me.id);
  const patch = P.createPatch();
  P.set(patch, "servers", serverId, fresh);
  P.set(patch, "users", target.id, auth.publicUser(target, me.id));
  P.set(patch, "logs", entry.id, entry);
  return { data: fresh, patch };
}

async function listLogs(ctx) {
  const me = await auth.requireUser(ctx.event);
  const ctxS = await acl.loadServer(ctx.params.id);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "viewLogs", "Você não tem permissão para ver os logs.");
  const list = await db.select("logs", {
    where: { server_id: ctx.params.id },
    order: "at",
    desc: true,
    limit: 80,
  });
  return { data: list || [] };
}

/* ------------------------- categorias ------------------------- */
async function createCategory(ctx) {
  const me = await auth.requireUser(ctx.event);
  const serverId = ctx.params.id;
  const ctxS = await acl.loadServer(serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageChannels", "Você não tem permissão para criar categorias.");

  const body = ctx.body || {};
  const name = String(body.name || "").trim();
  if (name.length < 2) throw bad("Dê um nome com pelo menos 2 caracteres à categoria.");

  const order = await db.count("categories", { where: { server_id: serverId } });
  const category = {
    id: u.uid("ct"),
    serverId,
    name: name.slice(0, 32),
    order,
    collapsed: false,
    perms: {},
    createdAt: now(),
  };
  await db.insert("categories", category);

  let channel = null;
  if (body.firstChannel) {
    const chName = u.slug(body.firstChannel) || "geral";
    channel = {
      id: u.uid("ch"),
      serverId,
      categoryId: category.id,
      name: chName,
      type: "text",
      order: 0,
      topic: "",
      perms: {},
      inheritPerms: true,
      overrides: { view: "all", send: "all" },
      createdBy: me.id,
      createdAt: now(),
      updatedAt: now(),
    };
    await db.insert("channels", channel);
  }

  const entry = await log(serverId, "category.create", { name: category.name }, category.id, me.id);
  const patch = P.createPatch();
  P.set(patch, "categories", category.id, category);
  if (channel) P.set(patch, "channels", channel.id, channel);
  P.set(patch, "logs", entry.id, entry);
  return { status: 201, data: { category, channel }, patch };
}

async function updateCategory(ctx) {
  const me = await auth.requireUser(ctx.event);
  const rows = await db.select("categories", { where: { id: ctx.params.id }, limit: 1 });
  const cat = rows && rows[0];
  if (!cat) throw notFound("Categoria não encontrada.");
  const ctxS = await acl.loadServer(cat.serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageChannels", "Você não tem permissão para editar categorias.");

  const body = ctx.body || {};
  const update = {};
  let action = "category.update";
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (n.length < 2) throw bad("Dê um nome com pelo menos 2 caracteres à categoria.");
    update.name = n.slice(0, 32).toUpperCase();
  }
  if (body.collapsed !== undefined) update.collapsed = !!body.collapsed;
  if (body.perms !== undefined) {
    await db.assertWritable(
      "categories",
      "perms",
      "Permissões por categoria não estão disponíveis neste banco. Execute a migração do Nexo (supabase/migrations/0001_nexo_backend.sql)."
    );
    update.perms = body.perms || {};
  }

  if (!Object.keys(update).length) return { data: cat };
  await db.update("categories", { where: { id: cat.id } }, update);
  const fresh = (await db.select("categories", { where: { id: cat.id }, limit: 1 }))[0];
  const entry = await log(cat.serverId, action, { name: fresh.name }, cat.id, me.id);
  const patch = P.createPatch();
  P.set(patch, "categories", cat.id, fresh);
  P.set(patch, "logs", entry.id, entry);
  return { data: fresh, patch };
}

async function deleteCategory(ctx) {
  const me = await auth.requireUser(ctx.event);
  const rows = await db.select("categories", { where: { id: ctx.params.id }, limit: 1 });
  const cat = rows && rows[0];
  if (!cat) throw notFound("Categoria não encontrada.");
  const ctxS = await acl.loadServer(cat.serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageChannels", "Você não tem permissão para apagar categorias.");

  const chans = await db.select("channels", { where: { category_id: cat.id }, limit: 500 });
  const channelIds = (chans || []).map((c) => c.id);
  if (channelIds.length) {
    await db.remove("messages", { where: { channel_id: channelIds } });
    await db.remove("channels", { where: { id: channelIds } });
  }
  await db.remove("categories", { where: { id: cat.id } });

  const entry = await log(
    cat.serverId,
    "category.delete",
    { name: cat.name, channels: channelIds.length },
    cat.id,
    me.id
  );
  const patch = P.createPatch();
  P.del(patch, "categories", [cat.id]);
  P.del(patch, "channels", channelIds);
  channelIds.forEach((id) => P.del(patch, "messages", [id]));
  P.set(patch, "logs", entry.id, entry);
  return { data: { removedChannels: channelIds.length }, patch };
}

/* --------------------------- canais --------------------------- */
async function createChannel(ctx) {
  const me = await auth.requireUser(ctx.event);
  const serverId = ctx.params.id;
  const ctxS = await acl.loadServer(serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageChannels", "Você não tem permissão para criar canais.");

  const body = ctx.body || {};
  const type = body.type === "voice" ? "voice" : "text";
  const raw = String(body.name || "").trim();
  const name = type === "voice" ? raw.replace(/\s+/g, " ").slice(0, 32) : u.slug(raw);
  if (name.length < 2) throw bad("Dê um nome com pelo menos 2 caracteres ao canal.");
  const cat = ctxS.categories.find((c) => c.id === body.categoryId);
  if (!cat) throw bad("Escolha uma categoria válida.");

  const count = await db.count("channels", { where: { category_id: cat.id } });
  const channel = {
    id: u.uid("ch"),
    serverId,
    categoryId: cat.id,
    name,
    type,
    order: count,
    topic: String(body.topic || "").slice(0, 180),
    perms: {},
    inheritPerms: body.inheritPerms === false ? false : true,
    overrides: {
      view: body.view === "private" ? "private" : "all",
      send: body.send === "private" || body.send === "none" ? body.send : "all",
    },
    createdBy: me.id,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.insert("channels", channel);

  const entry = await log(serverId, "channel.create", { name: "#" + name, type }, channel.id, me.id);
  appsEvent(serverId, "channel.create", { channel: name, actorId: me.id }, ctxS);
  const patch = P.createPatch();
  P.set(patch, "channels", channel.id, channel);
  P.set(patch, "logs", entry.id, entry);
  return { status: 201, data: channel, patch };
}

async function updateChannel(ctx) {
  const me = await auth.requireUser(ctx.event);
  const rows = await db.select("channels", { where: { id: ctx.params.id }, limit: 1 });
  const ch = rows && rows[0];
  if (!ch) throw notFound("Canal não encontrado.");
  const ctxS = await acl.loadServer(ch.serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageChannels", "Você não tem permissão para editar canais.");

  const body = ctx.body || {};
  const update = {};
  if (body.name !== undefined) {
    const raw = String(body.name).trim();
    const name = ch.type === "voice" ? raw.replace(/\s+/g, " ").slice(0, 32) : u.slug(raw);
    if (name.length < 2) throw bad("O nome do canal precisa de pelo menos 2 caracteres.");
    update.name = name;
  }
  if (body.topic !== undefined) update.topic = String(body.topic).slice(0, 180);
  if (body.categoryId !== undefined) {
    const cat = ctxS.categories.find((c) => c.id === body.categoryId);
    if (!cat) throw bad("Categoria inválida.");
    update.categoryId = cat.id;
  }
  if (body.overrides !== undefined) {
    await db.assertWritable(
      "channels",
      "overrides",
      "A visibilidade por canal não está disponível neste banco. Execute a migração do Nexo (supabase/migrations/0001_nexo_backend.sql)."
    );
    const ov = body.overrides || {};
    update.overrides = {
      view: ov.view === "private" ? "private" : "all",
      send: ov.send === "private" || ov.send === "none" ? ov.send : "all",
    };
  }
  if (!Object.keys(update).length) return { data: ch };
  update.updatedAt = now();
  await db.update("channels", { where: { id: ch.id } }, update);

  const fresh = (await db.select("channels", { where: { id: ch.id }, limit: 1 }))[0];
  const entry = await log(ch.serverId, "channel.update", { name: "#" + fresh.name }, ch.id, me.id);
  const patch = P.createPatch();
  P.set(patch, "channels", ch.id, fresh);
  P.set(patch, "logs", entry.id, entry);
  return { data: fresh, patch };
}

async function deleteChannel(ctx) {
  const me = await auth.requireUser(ctx.event);
  const rows = await db.select("channels", { where: { id: ctx.params.id }, limit: 1 });
  const ch = rows && rows[0];
  if (!ch) throw notFound("Canal não encontrado.");
  const ctxS = await acl.loadServer(ch.serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageChannels", "Você não tem permissão para apagar canais.");

  await db.remove("messages", { where: { channel_id: ch.id } });
  await db.remove("channels", { where: { id: ch.id } });
  const entry = await log(ch.serverId, "channel.delete", { name: "#" + ch.name }, ch.id, me.id);
  appsEvent(ch.serverId, "channel.delete", { channel: ch.name, actorId: me.id }, ctxS);
  const patch = P.createPatch();
  P.del(patch, "channels", [ch.id]);
  P.del(patch, "messages", [ch.id]);
  P.set(patch, "logs", entry.id, entry);
  return { data: true, patch };
}

function setPermOn(container, targetKey, permKey, state) {
  if (acl.PERM_KEYS.indexOf(permKey) === -1) throw bad("Permissão desconhecida.");
  const perms = Object.assign({}, container.perms || {});
  if (state === null || state === undefined) {
    if (perms[targetKey]) {
      const box = Object.assign({}, perms[targetKey]);
      delete box[permKey];
      if (Object.keys(box).length) perms[targetKey] = box;
      else delete perms[targetKey];
    }
  } else {
    const box = Object.assign({}, perms[targetKey] || {});
    box[permKey] = state === true;
    perms[targetKey] = box;
  }
  if (!Object.keys(perms).length) return {};
  return perms;
}

async function setChannelPerm(ctx) {
  const me = await auth.requireUser(ctx.event);
  const rows = await db.select("channels", { where: { id: ctx.params.id }, limit: 1 });
  const ch = rows && rows[0];
  if (!ch) throw notFound("Canal não encontrado.");
  const ctxS = await acl.loadServer(ch.serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageChannels", "Você não tem permissão para alterar permissões.");

  const body = ctx.body || {};
  const perms = setPermOn(ch, body.targetKey, body.permKey, body.state);
  await db.update("channels", { where: { id: ch.id } }, { perms, updatedAt: now() });
  const fresh = (await db.select("channels", { where: { id: ch.id }, limit: 1 }))[0];
  const entry = await log(
    ch.serverId,
    "channel.update",
    { name: "#" + ch.name, what: "permissões" },
    ch.id,
    me.id
  );
  const patch = P.createPatch();
  P.set(patch, "channels", ch.id, fresh);
  P.set(patch, "logs", entry.id, entry);
  return { data: fresh, patch };
}

async function setCategoryPerm(ctx) {
  const me = await auth.requireUser(ctx.event);
  const rows = await db.select("categories", { where: { id: ctx.params.id }, limit: 1 });
  const cat = rows && rows[0];
  if (!cat) throw notFound("Categoria não encontrada.");
  const ctxS = await acl.loadServer(cat.serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageChannels", "Você não tem permissão para alterar permissões.");

  const body = ctx.body || {};
  const perms = setPermOn(cat, body.targetKey, body.permKey, body.state);
  await db.assertWritable(
    "categories",
    "perms",
    "Permissões por categoria não estão disponíveis neste banco. Execute a migração do Nexo (supabase/migrations/0001_nexo_backend.sql) e tente novamente."
  );
  await db.update("categories", { where: { id: cat.id } }, { perms });
  const fresh = (await db.select("categories", { where: { id: cat.id }, limit: 1 }))[0];
  const entry = await log(
    cat.serverId,
    "category.update",
    { name: cat.name, what: "permissões" },
    cat.id,
    me.id
  );
  const patch = P.createPatch();
  P.set(patch, "categories", cat.id, fresh);
  P.set(patch, "logs", entry.id, entry);
  return { data: fresh, patch };
}

async function setChannelInheritance(ctx) {
  const me = await auth.requireUser(ctx.event);
  const rows = await db.select("channels", { where: { id: ctx.params.id }, limit: 1 });
  const ch = rows && rows[0];
  if (!ch) throw notFound("Canal não encontrado.");
  const ctxS = await acl.loadServer(ch.serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageChannels", "Você não tem permissão para alterar permissões.");

  const inherit = !!(ctx.body || {}).inherit;
  await db.assertWritable(
    "channels",
    "inheritPerms",
    "A herança de permissões por canal não está disponível neste banco. Execute a migração do Nexo (supabase/migrations/0001_nexo_backend.sql)."
  );
  await db.update("channels", { where: { id: ch.id } }, { inheritPerms: inherit, updatedAt: now() });
  const fresh = (await db.select("channels", { where: { id: ch.id }, limit: 1 }))[0];
  const patch = P.createPatch();
  P.set(patch, "channels", ch.id, fresh);
  return { data: fresh, patch };
}

module.exports = { routes, log, loadMembership, getUser, appsEvent };
