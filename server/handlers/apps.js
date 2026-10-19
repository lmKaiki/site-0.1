"use strict";
/* ============================================================
   NEXO · server/handlers/apps
   Bot Center — apps/bots reais para servidores dos usuários.

   Regras do sistema:
   · um bot NÃO é uma pessoa: a identidade mora em `apps`
     (catálogo) e `server_apps` (instalação) — nunca em `users`.
   · bots não entram em `memberships`, portanto não contam como
     membro humano e nunca aparecem como amigo.
   · quem instala precisa de permissão no servidor, e o bot só
     recebe permissões que o próprio instalador já possui
     (validado AQUI, no backend — nunca só na interface).
   · toda ação do bot é auditável em `logs`.

   Autoria das mensagens do bot:
   `messages.sender_id` é chave estrangeira de `users`, então a
   mensagem é gravada com o usuário que instalou/instigou e carrega
   o marcador «bot:<instalacao>» no início do conteúdo — a interface
   reconhece o marcador e desenha o robô no lugar da pessoa.
   ============================================================ */

const db = require("../db");
const auth = require("../auth");
const u = require("../util");
const P = require("../patch");
const acl = require("../acl");
const handlersAuth = require("./auth");
const { bad, forbidden, notFound } = require("../errors");

function now() {
  return Date.now();
}

/* ------------------------------------------------------------
   marcador de autoria
   ------------------------------------------------------------ */
const BOT_TAG = /^«bot:([^»]+)»\s?/;
function tag(installId) {
  return "«bot:" + installId + "» ";
}
function parseTag(text) {
  const m = BOT_TAG.exec(String(text || ""));
  return m ? m[1] : null;
}
function stripTag(text) {
  return String(text || "").replace(BOT_TAG, "");
}

/* ------------------------------------------------------------
   catálogo OFICIAL — apps com implementação real neste backend.
   Nada aqui é "vitrine": cada app tem comportamento efetivo
   (ganchos em onMemberJoin/onEvent e comandos em runCommand).
   ------------------------------------------------------------ */
const OFFICIAL_APPS = [
  {
    id: "app_nexo_welcome",
    name: "Nexo Boas-vindas",
    description:
      "Recebe cada pessoa nova com uma mensagem automática no canal escolhido, citando o nome (e o avatar, quando disponível).",
    avatar: "👋",
    category: "👋 Boas-vindas",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      {
        name: "/welcome",
        usage: "/welcome on | off",
        description: "Liga ou desliga as boas-vindas automáticas deste servidor.",
        admin: true,
      },
    ],
    config: {
      enabled: true,
      channelId: "",
      message:
        "👋 **{usuario}** entrou no **{servidor}**! Seja bem-vindo(a) — use /welcome para configurar.",
      includeName: true,
      includeAvatar: true,
    },
  },
  {
    id: "app_nexo_mod",
    name: "Nexo Moderação",
    description:
      "Comandos de moderação reais (/warn, /kick, /ban, /clear) que respeitam cargo, hierarquia e permissões do servidor.",
    avatar: "🛡️",
    category: "🛡️ Moderação",
    developer: "Nexo Oficial",
    permissions: ["sendMessages", "deleteMessages", "kickMembers", "banMembers", "manageMembers"],
    commands: [
      { name: "/warn", usage: "/warn @usuario motivo", description: "Registra uma advertência e avisa a pessoa.", admin: true },
      { name: "/kick", usage: "/kick @usuario motivo", description: "Expulsa a pessoa do servidor (com hierarquia).", admin: true },
      { name: "/ban", usage: "/ban @usuario motivo", description: "Expulsa e bane a pessoa do servidor.", admin: true },
      { name: "/clear", usage: "/clear quantidade", description: "Apaga as últimas mensagens do canal.", admin: true },
    ],
    config: { enabled: true, warnNotify: true },
  },
  {
    id: "app_nexo_logs",
    name: "Nexo Logs",
    description:
      "Registra entradas, saídas, banimentos e ações administrativas no canal de logs que você escolher. Nunca lê mensagens privadas.",
    avatar: "📋",
    category: "📋 Logs",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [],
    config: {
      enabled: true,
      channelId: "",
      events: { join: true, leave: true, moderation: true, channels: true },
    },
  },
  {
    id: "app_nexo_autorole",
    name: "Nexo AutoRole",
    description:
      "Atribui automaticamente um cargo a toda pessoa que entrar no servidor, sem tocar no dono nem em administradores.",
    avatar: "🏷️",
    category: "🏷️ AutoRole",
    developer: "Nexo Oficial",
    permissions: ["manageRoles", "manageMembers"],
    commands: [],
    config: { enabled: true, roleId: "" },
  },
  {
    id: "app_nexo_utils",
    name: "Nexo Utilidades",
    description:
      "Informação do servidor e das pessoas em tempo real: /ping, /help, /serverinfo e /userinfo com dados verdadeiros.",
    avatar: "🛠️",
    category: "🛠️ Utilidades",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/ping", usage: "/ping", description: "Verifica se os apps do Nexo estão respondendo.", admin: false },
      { name: "/help", usage: "/help", description: "Lista os comandos disponíveis neste servidor.", admin: false },
      { name: "/serverinfo", usage: "/serverinfo", description: "Mostra dados reais do servidor.", admin: false },
      { name: "/userinfo", usage: "/userinfo @usuario", description: "Mostra dados reais de uma pessoa.", admin: false },
    ],
    config: { enabled: true },
  },
];

const APP_BY_ID = {};
OFFICIAL_APPS.forEach((a) => (APP_BY_ID[a.id] = a));

/* catálogo gravado no banco (idempotente) */
let catalogReady = null;
async function ensureCatalog() {
  if (catalogReady) return catalogReady;
  catalogReady = (async () => {
    for (const app of OFFICIAL_APPS) {
      try {
        const rows = await db.select("apps", { where: { id: app.id }, limit: 1 });
        if (rows && rows.length) continue;
        await db.insert("apps", {
          id: app.id,
          name: app.name,
          description: app.description,
          avatar: app.avatar,
          category: app.category,
          developer: app.developer,
          permissions: app.permissions.slice(),
          commands: app.commands.slice(),
          enabled: true,
          createdAt: now(),
        });
      } catch (e) {
        /* catálogo é só de leitura: nunca derruba a requisição */
      }
    }
  })();
  return catalogReady;
}

async function installsOf(serverId) {
  const rows = await db.select("server_apps", { where: { server_id: serverId }, limit: 100 });
  return rows || [];
}

async function loadInstall(id) {
  const rows = await db.select("server_apps", { where: { id }, limit: 1 });
  return rows && rows[0] ? rows[0] : null;
}

/* permissões que um instalador pode conceder = permissões dele */
function grantable(ctxS, userId) {
  const perms = acl.effectivePerms(ctxS, userId);
  return perms;
}

function cleanPermList(app, requested) {
  const allowed = Array.isArray(app.permissions) ? app.permissions : [];
  const want = Array.isArray(requested) ? requested : allowed.slice();
  return want.filter((p) => allowed.indexOf(p) !== -1);
}

/* configuração aceita por app (whitelist — nada de campo inventado) */
const CONFIG_KEYS = {
  app_nexo_welcome: ["enabled", "channelId", "message", "includeName", "includeAvatar"],
  app_nexo_mod: ["enabled", "warnNotify"],
  app_nexo_logs: ["enabled", "channelId", "events"],
  app_nexo_autorole: ["enabled", "roleId"],
  app_nexo_utils: ["enabled"],
};

function cleanConfig(appId, raw) {
  const keys = CONFIG_KEYS[appId] || ["enabled"];
  const out = {};
  const src = raw && typeof raw === "object" ? raw : {};
  keys.forEach((k) => {
    if (src[k] === undefined) return;
    let v = src[k];
    if (k === "enabled") v = !!v;
    else if (k === "includeName" || k === "includeAvatar") v = !!v;
    else if (k === "events") {
      v = v && typeof v === "object" ? v : {};
      const ev = {};
      ["join", "leave", "moderation", "channels"].forEach((e) => (ev[e] = v[e] !== false));
      v = ev;
    } else v = String(v).slice(0, 400);
    out[k] = v;
  });
  return out;
}

/* canal de texto válido dentro do servidor */
function textChannel(ctxS, channelId, fallbackFirst) {
  if (channelId) {
    const c = ctxS.channels.find((x) => x.id === channelId && x.type === "text");
    if (c) return c;
  }
  if (!fallbackFirst) return null;
  return ctxS.channels.find((c) => c.type === "text") || null;
}

/* ------------------------------------------------------------
   publica uma mensagem como bot (marcador + author real)
   ------------------------------------------------------------ */
async function botPost(ctxS, install, channel, text, actorId) {
  if (!channel) return null;
  const perms = Array.isArray(install.permissions) ? install.permissions : [];
  if (perms.indexOf("sendMessages") === -1) return null;

  let senderId = actorId || install.installedBy || ctxS.server.ownerId;
  const exists = await db.select("users", { where: { id: senderId }, limit: 1 });
  if (!exists || !exists.length) senderId = ctxS.server.ownerId;

  const message = {
    id: u.uid("ms"),
    channelId: channel.id,
    conversationId: channel.id,
    authorId: senderId,
    senderId: senderId,
    content: (tag(install.id) + String(text || "")).slice(0, 2000),
    attachments: [],
    reactions: {},
    pinned: false,
    createdAt: now(),
    updatedAt: null,
  };
  await db.insert("messages", message);
  return message;
}

/* ------------------------------------------------------------
   ganchos de eventos (chamados por handlers/servers.js)
   ------------------------------------------------------------ */

/* entrada de membro: AutoRole + Boas-vindas + Logs */
async function onMemberJoin(ctx) {
  const out = { roleId: null, messages: [] };
  try {
    await ensureCatalog();
    const installs = (await installsOf(ctx.serverId)).filter((i) => i.enabled !== false);
    if (!installs.length) return out;

    for (const install of installs) {
      const app = APP_BY_ID[install.appId];
      if (!app) continue;
      const cfg = install.configuration || {};

      /* AutoRole: cargo automático (nunca sobre o dono) */
      if (install.appId === "app_nexo_autorole" && cfg.roleId) {
        const role = ctx.ctxS.roleById[cfg.roleId];
        const isOwner = ctx.ctxS.server.ownerId === ctx.user.id;
        if (role && !isOwner) out.roleId = role.id;
      }

      /* Boas-vindas */
      if (install.appId === "app_nexo_welcome" && cfg.enabled !== false && cfg.message) {
        const ch = textChannel(ctx.ctxS, cfg.channelId, true);
        if (ch) {
          const who =
            cfg.includeName === false
              ? "Alguém"
              : "**@" + ctx.user.username + "**";
          const avatar =
            cfg.includeAvatar !== false && ctx.user.avatar && ctx.user.avatar.emoji
              ? ctx.user.avatar.emoji + " "
              : "";
          const text = String(cfg.message)
            .replace(/\{usuario\}/g, who)
            .replace(/\{nome\}/g, ctx.user.displayName || ctx.user.username)
            .replace(/\{servidor\}/g, ctx.ctxS.server.name);
          const msg = await botPost(ctx.ctxS, install, ch, avatar + text, ctx.user.id);
          if (msg) out.messages.push(msg);
        }
      }

      /* Logs: entrada */
      if (install.appId === "app_nexo_logs" && (cfg.events || {}).join !== false) {
        const ch = textChannel(ctx.ctxS, cfg.channelId, true);
        if (ch) {
          const msg = await botPost(
            ctx.ctxS,
            install,
            ch,
            "📥 Entrou: **@" + ctx.user.username + "** (`" + ctx.user.id + "`)",
            ctx.user.id
          );
          if (msg) out.messages.push(msg);
        }
      }
    }
  } catch (e) {
    /* ganchos nunca quebram a entrada no servidor */
  }
  return out;
}

/* eventos administrativos → app de Logs */
const EVENT_TEXT = {
  "member.leave": ["leave", "📤 Saiu do servidor"],
  "member.kick": ["moderation", "🚪 Foi expulso"],
  "member.ban": ["moderation", "⛔ Foi banido"],
  "member.unban": ["moderation", "🔓 Banimento removido"],
  "channel.create": ["channels", "🆕 Canal criado"],
  "channel.delete": ["channels", "🗑️ Canal apagado"],
  "message.delete": ["moderation", "🗑️ Mensagem apagada"],
};

async function onEvent(serverId, action, meta, ctxS) {
  try {
    const spec = EVENT_TEXT[action];
    if (!spec) return;
    await ensureCatalog();
    const installs = await installsOf(serverId);
    const install = installs.find(
      (i) => i.appId === "app_nexo_logs" && i.enabled !== false
    );
    if (!install) return;
    const cfg = install.configuration || {};
    if ((cfg.events || {})[spec[0]] === false) return;

    const server = ctxS ? ctxS.server : (await db.select("servers", { where: { id: serverId }, limit: 1 }))[0];
    const sctx = ctxS || (await acl.loadServer(serverId));
    const ch = textChannel(sctx, cfg.channelId, true);
    if (!ch) return;

    const details = [];
    if (meta && meta.username) details.push("@" + meta.username);
    if (meta && meta.reason) details.push("motivo: " + meta.reason);
    if (meta && meta.channel) details.push("#" + meta.channel);
    const msg = await botPost(
      sctx,
      install,
      ch,
      spec[1] + (details.length ? " — " + details.join(" · ") : ""),
      (meta && meta.actorId) || null
    );
    if (msg) {
      /* a interface puxa o novo canal no próximo sync */
      await db.update("messages", { where: { id: msg.id } }, { updatedAt: now() });
    }
  } catch (e) {
    /* logs são best-effort */
  }
}

/* ------------------------------------------------------------
   comandos (execução server-side dentro do envio de mensagem)
   ------------------------------------------------------------ */

function mentionToId(text) {
  const m = /(?:<@!?)?@?([a-zA-Z0-9_.]{2,32})/.exec(String(text || ""));
  return m ? m[1] : null;
}

async function findUserByArg(ctxS, arg) {
  if (!arg) return null;
  const clean = String(arg).replace(/^<@!?|>$/g, "").replace(/^@/, "").trim();
  if (!clean) return null;
  let rows = await db.select("users", { where: { id: clean }, limit: 1 });
  if (rows && rows.length) return rows[0];
  rows = await db.select("users", { where: { username: clean.toLowerCase() }, limit: 1 });
  if (rows && rows.length) return rows[0];
  rows = await db.select("users", { where: { display_name: clean }, limit: 1 });
  if (rows && rows.length) return rows[0];
  return null;
}

/* hierarquia: cargo mais alto vence; dono está no topo */
function rankOf(ctxS, userId) {
  if (ctxS.server.ownerId === userId) return 9999;
  const m = acl.membershipOf(ctxS, userId);
  if (!m) return -1;
  const role = m.roleId && ctxS.roleById[m.roleId];
  return role ? Number(role.position || 0) : 0;
}

/* executa o texto do usuário como comando, se ele casar com um app
   instalado. Devolve null quando não é comando deste servidor. */
async function runCommand(ctxS, channel, user, rawText) {
  const text = String(rawText || "").trim();
  if (text[0] !== "/") return null;
  const parts = text.split(/\s+/);
  const name = parts[0].toLowerCase();
  const args = parts.slice(1);

  await ensureCatalog();
  const installs = (await installsOf(ctxS.server.id)).filter((i) => i.enabled !== false);
  let install = null;
  let command = null;
  for (const i of installs) {
    const app = APP_BY_ID[i.appId];
    if (!app || !app.commands) continue;
    const cmd = app.commands.find((c) => c.name.toLowerCase() === name);
    if (cmd) {
      install = i;
      command = cmd;
      break;
    }
  }
  if (!install) return null;

  const botPerms = Array.isArray(install.permissions) ? install.permissions : [];
  const cfg = install.configuration || {};
  const replies = [];
  const needBot = (k) => {
    if (botPerms.indexOf(k) === -1)
      throw forbidden("O app **" + APP_BY_ID[install.appId].name + "** não tem a permissão “" + k + "” neste servidor. Peça a quem o instalou para conceder.");
  };
  const needUser = (k) => {
    if (!acl.can(ctxS, user.id, k))
      throw forbidden("Você não tem permissão para usar “" + name + "” aqui.");
  };

  /* ------------------------- /ping ------------------------- */
  if (name === "/ping") {
    replies.push("🏓 Pong! Estou respondendo pelo servidor do Nexo em " + new Date().toISOString().slice(11, 19) + " (horário do servidor).");
  }

  /* ------------------------- /help ------------------------- */
  else if (name === "/help") {
    const lines = [];
    for (const i of installs) {
      const app = APP_BY_ID[i.appId];
      if (!app || !app.commands.length) continue;
      lines.push("**" + app.name + "**");
      app.commands.forEach((c) => lines.push("`" + c.usage + "` — " + c.description));
    }
    replies.push(lines.length ? lines.join("\n") : "Nenhum comando instalado neste servidor.");
  }

  /* --------------------- /serverinfo ---------------------- */
  else if (name === "/serverinfo") {
    const memberRows = (await db.select("memberships", { where: { server_id: ctxS.server.id }, limit: 5000 })) || [];
    const created = ctxS.server.createdAt ? new Date(ctxS.server.createdAt) : null;
    replies.push(
      "📊 **" + ctxS.server.name + "**\n" +
        "• Membros humanos: **" + memberRows.length + "**\n" +
        "• Canais: **" + ctxS.channels.length + "** · Categorias: **" + ctxS.categories.length + "**\n" +
        "• Apps instalados: **" + installs.length + "**\n" +
        (created ? "• Criado em: **" + created.toLocaleDateString("pt-BR") + "**" : "")
    );
  }

  /* ---------------------- /userinfo ----------------------- */
  else if (name === "/userinfo") {
    const target = await findUserByArg(ctxS, args[0]);
    if (!target) throw bad("Mencione uma pessoa válida: /userinfo @usuario");
    const m = acl.membershipOf(ctxS, target.id);
    const role = m && m.roleId ? ctxS.roleById[m.roleId] : null;
    replies.push(
      "👤 **" + (target.displayName || target.username) + "** (@" + target.username + ")\n" +
        "• ID: `" + target.id + "`\n" +
        "• Cargo: **" + (role ? role.name : (target.id === ctxS.server.ownerId ? "Dono" : "Membro")) + "**\n" +
        "• Status: **" + (target.status || "offline") + "**"
    );
  }

  /* ------------------------ /warn ------------------------- */
  else if (name === "/warn") {
    needBot("manageMembers");
    needUser("manageMembers");
    const target = await findUserByArg(ctxS, args[0]);
    if (!target) throw bad("Mencione a pessoa: /warn @usuario motivo");
    if (target.id === user.id) throw bad("Você não pode advertir a si mesmo.");
    if (target.id === ctxS.server.ownerId) throw bad("Você não pode advertir o dono do servidor.");
    const reason = args.slice(1).join(" ").slice(0, 200);
    if (cfg.warnNotify !== false) {
      await handlersAuth.createNotification(
        target.id,
        "server",
        "⚠️ Advertência em " + ctxS.server.name + (reason ? ": " + reason : "."),
        { serverId: ctxS.server.id, href: "#/s/" + ctxS.server.id, actorId: user.id }
      );
    }
    const entry = require("./servers").log(ctxS.server.id, "member.warn", { userId: target.id, reason }, target.id, user.id);
    await entry;
    replies.push(
      "⚠️ **@" + target.username + "** foi advertido por @" + user.username + "." +
        (reason ? "\nMotivo: " + reason : "")
    );
  }

  /* ------------------------ /kick ------------------------- */
  else if (name === "/kick") {
    needBot("kickMembers");
    needUser("kickMembers");
    const target = await findUserByArg(ctxS, args[0]);
    if (!target) throw bad("Mencione a pessoa: /kick @usuario motivo");
    if (target.id === user.id) throw bad("Você não pode expulsar a si mesmo.");
    if (target.id === ctxS.server.ownerId) throw bad("Você não pode expulsar o dono do servidor.");
    if (rankOf(ctxS, target.id) >= rankOf(ctxS, user.id) && ctxS.server.ownerId !== user.id)
      throw forbidden("Hierarquia: você não pode expulsar alguém com cargo igual ou superior.");
    const membership = acl.membershipOf(ctxS, target.id);
    if (!membership) throw notFound("Esta pessoa não faz parte do servidor.");
    const reason = args.slice(1).join(" ").slice(0, 200);
    await db.remove("memberships", { where: { id: membership.id } });
    await require("./servers").log(ctxS.server.id, "member.kick", { userId: target.id, reason, via: "bot" }, target.id, user.id);
    await handlersAuth.createNotification(
      target.id,
      "server",
      "🚪 Você foi expulso de " + ctxS.server.name + (reason ? " — " + reason : "."),
      { serverId: ctxS.server.id }
    );
    replies.push("🚪 **@" + target.username + "** foi expulso." + (reason ? " Motivo: " + reason : ""));
  }

  /* ------------------------- /ban ------------------------- */
  else if (name === "/ban") {
    needBot("banMembers");
    needUser("banMembers");
    const target = await findUserByArg(ctxS, args[0]);
    if (!target) throw bad("Mencione a pessoa: /ban @usuario motivo");
    if (target.id === user.id) throw bad("Você não pode banir a si mesmo.");
    if (target.id === ctxS.server.ownerId) throw bad("Você não pode banir o dono do servidor.");
    if (rankOf(ctxS, target.id) >= rankOf(ctxS, user.id) && ctxS.server.ownerId !== user.id)
      throw forbidden("Hierarquia: você não pode banir alguém com cargo igual ou superior.");
    const existing = ctxS.bans.find((b) => b.userId === target.id);
    if (existing) throw bad("Esta pessoa já está banida.");
    const reason = args.slice(1).join(" ").slice(0, 200);
    const ban = {
      id: ctxS.server.id + ":" + target.id,
      serverId: ctxS.server.id,
      userId: target.id,
      reason,
      byId: user.id,
      at: now(),
      createdAt: now(),
    };
    await db.insert("bans", ban);
    const membership = acl.membershipOf(ctxS, target.id);
    if (membership) await db.remove("memberships", { where: { id: membership.id } });
    await require("./servers").log(ctxS.server.id, "member.ban", { userId: target.id, reason, via: "bot" }, target.id, user.id);
    await handlersAuth.createNotification(
      target.id,
      "server",
      "⛔ Você foi banido de " + ctxS.server.name + (reason ? " — " + reason : "."),
      { serverId: ctxS.server.id }
    );
    replies.push("⛔ **@" + target.username + "** foi banido." + (reason ? " Motivo: " + reason : ""));
  }

  /* ------------------------ /clear ------------------------ */
  else if (name === "/clear") {
    needBot("deleteMessages");
    needUser("deleteMessages");
    const n = Math.max(1, Math.min(100, parseInt(args[0], 10) || 0));
    if (!n) throw bad("Use /clear quantidade (1 a 100).");
    const rows = (await db.select("messages", {
      where: { channel_id: channel.id },
      order: "createdAt",
      desc: true,
      limit: n,
    })) || [];
    for (const row of rows) await db.remove("messages", { where: { id: row.id } });
    await require("./servers").log(
      ctxS.server.id,
      "message.delete",
      { channel: "#" + channel.name, count: rows.length, via: "bot" },
      channel.id,
      user.id
    );
    replies.push("🧹 Apaguei **" + rows.length + "** mensagem(ns) de #" + channel.name + ".");
  }

  /* ---------------------- /welcome ------------------------ */
  else if (name === "/welcome") {
    if (!acl.can(ctxS, user.id, "manageServer") && ctxS.server.ownerId !== user.id)
      throw forbidden("Só quem gerencia o servidor configura as boas-vindas.");
    const installW = installs.find((i) => i.appId === "app_nexo_welcome");
    if (!installW) throw bad("O app de boas-vindas não está instalado neste servidor.");
    const flag = (args[0] || "").toLowerCase();
    if (flag === "on" || flag === "off") {
      const cfgW = Object.assign({}, installW.configuration || {}, { enabled: flag === "on" });
      await db.update("server_apps", { where: { id: installW.id } }, { configuration: cfgW, updatedAt: now() });
      replies.push("👋 Boas-vindas " + (flag === "on" ? "**ativadas**" : "**desativadas**") + " neste servidor.");
    } else {
      const cfgW = installW.configuration || {};
      replies.push(
        "👋 Boas-vindas estão **" + (cfgW.enabled === false ? "desligadas" : "ligadas") + "**.\n" +
          "Canal: " + (cfgW.channelId ? "definido" : "padrão") + "\n" +
          "Mensagem: " + String(cfgW.message || "").slice(0, 160) + "\n" +
          "Use `/welcome on` ou `/welcome off`."
      );
    }
  }

  if (!replies.length) return null;

  /* respostas do bot no mesmo canal */
  const out = [];
  for (const line of replies) {
    const msg = await botPost(ctxS, install, channel, line, user.id);
    if (msg) out.push(msg);
  }
  return out;
}

/* ------------------------------------------------------------
   rotas
   ------------------------------------------------------------ */
function routes() {
  return [
    ["GET", "/apps", listApps],
    ["GET", "/apps/:id", getApp],
    ["GET", "/servers/:id/apps", listInstalls],
    ["POST", "/servers/:id/apps", installApp],
    ["PATCH", "/servers/:serverId/apps/:installId", updateInstall],
    ["DELETE", "/servers/:serverId/apps/:installId", removeInstall],
  ];
}

/* catálogo público (para quem tem sessão) + popularidade real */
async function listApps(ctx) {
  await auth.requireUser(ctx.event);
  await ensureCatalog();
  const rows = (await db.select("apps", { limit: 200 })) || [];
  const installs = (await db.select("server_apps", { limit: 2000 })) || [];
  const count = {};
  installs.forEach((i) => (count[i.appId] = (count[i.appId] || 0) + 1));
  return {
    data: rows
      .filter((a) => a.enabled !== false)
      .map((a) => Object.assign({}, a, { installCount: count[a.id] || 0, commands: a.commands || [], permissions: a.permissions || [] })),
  };
}

async function getApp(ctx) {
  await ensureCatalog();
  const rows = await db.select("apps", { where: { id: ctx.params.id }, limit: 1 });
  if (!rows || !rows.length) throw notFound("Este app não existe.");
  const installs = (await db.select("server_apps", { where: { app_id: ctx.params.id }, limit: 2000 })) || [];
  return { data: Object.assign({}, rows[0], { installCount: installs.length, commands: rows[0].commands || [], permissions: rows[0].permissions || [] }) };
}

/* instalações do servidor — qualquer membro vê, mas só gestores mudam */
async function listInstalls(ctx) {
  const me = await auth.requireUser(ctx.event);
  const ctxS = await acl.loadServer(ctx.params.id);
  acl.requireMember(ctxS, me.id);
  const list = await installsOf(ctxS.server.id);
  return { data: list };
}

async function installApp(ctx) {
  const me = await auth.requireUser(ctx.event);
  const body = ctx.body || {};
  const ctxS = await acl.loadServer(ctx.params.id);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageServer", "Você não tem permissão para instalar apps neste servidor.");
  if (ctxS.server.ownerId !== me.id && !acl.can(ctxS, me.id, "manageServer"))
    throw forbidden("Você não tem permissão para instalar apps neste servidor.");

  await ensureCatalog();
  const appRows = await db.select("apps", { where: { id: String(body.appId || "") }, limit: 1 });
  const app = appRows && appRows[0];
  if (!app || app.enabled === false) throw notFound("Este app não está disponível.");

  const existing = await db.select("server_apps", {
    where: { server_id: ctxS.server.id, app_id: app.id },
    limit: 1,
  });
  if (existing && existing.length) throw bad("Este app já está instalado neste servidor.");

  /* permissões pedidas ⊆ permissões do app ⊆ permissões do instalador */
  const mine = grantable(ctxS, me.id);
  const perms = cleanPermList(APP_BY_ID[app.id] || app, body.permissions);
  const illegal = perms.filter((p) => !mine[p]);
  if (illegal.length)
    throw forbidden(
      "Você não pode conceder ao bot as permissões: " + illegal.join(", ") + ". Elas são maiores do que as suas."
    );

  const install = {
    id: u.uid("sa"),
    serverId: ctxS.server.id,
    appId: app.id,
    installedBy: me.id,
    permissions: perms,
    enabled: true,
    configuration: cleanConfig(app.id, body.configuration) || Object.assign({}, (APP_BY_ID[app.id] || {}).config || {}),
    installedAt: now(),
    updatedAt: now(),
  };
  if (!Object.keys(install.configuration).length)
    install.configuration = Object.assign({}, (APP_BY_ID[app.id] || {}).config || {});
  await db.insert("server_apps", install);

  await require("./servers").log(
    ctxS.server.id,
    "app.install",
    { app: app.name, permissions: perms },
    app.id,
    me.id
  );

  const patch = P.createPatch();
  P.set(patch, "serverApps", install.id, install);
  return { status: 201, data: install, patch };
}

async function updateInstall(ctx) {
  const me = await auth.requireUser(ctx.event);
  const body = ctx.body || {};
  const install = await loadInstall(ctx.params.installId);
  if (!install || install.serverId !== ctx.params.serverId)
    throw notFound("Esta instalação não existe.");
  const ctxS = await acl.loadServer(ctx.params.serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageServer", "Você não tem permissão para configurar apps.");

  const patch = {};
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  if (body.configuration !== undefined)
    patch.configuration = Object.assign(
      {},
      install.configuration || {},
      cleanConfig(install.appId, body.configuration)
    );
  if (body.permissions !== undefined) {
    const appDef = APP_BY_ID[install.appId];
    const perms = cleanPermList(appDef || {}, body.permissions);
    const mine = grantable(ctxS, me.id);
    const illegal = perms.filter((p) => !mine[p]);
    if (illegal.length)
      throw forbidden("Você não pode manter permissões maiores que as suas: " + illegal.join(", ") + ".");
    patch.permissions = perms;
  }
  patch.updatedAt = now();
  await db.update("server_apps", { where: { id: install.id } }, patch);
  const fresh = await loadInstall(install.id);

  await require("./servers").log(
    ctxS.server.id,
    "app.update",
    { app: install.appId, enabled: fresh.enabled },
    install.appId,
    me.id
  );

  const out = P.createPatch();
  P.set(out, "serverApps", fresh.id, fresh);
  return { data: fresh, patch: out };
}

async function removeInstall(ctx) {
  const me = await auth.requireUser(ctx.event);
  const install = await loadInstall(ctx.params.installId);
  if (!install || install.serverId !== ctx.params.serverId)
    throw notFound("Esta instalação não existe.");
  const ctxS = await acl.loadServer(ctx.params.serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageServer", "Você não tem permissão para remover apps.");

  await db.remove("server_apps", { where: { id: install.id } });
  await require("./servers").log(
    ctxS.server.id,
    "app.remove",
    { app: install.appId },
    install.appId,
    me.id
  );

  const patch = P.createPatch();
  P.del(patch, "serverApps", [install.id]);
  return { data: true, patch };
}

module.exports = {
  routes,
  ensureCatalog,
  onMemberJoin,
  onEvent,
  runCommand,
  parseTag,
  stripTag,
  OFFICIAL_APPS,
  installsOf,
};
