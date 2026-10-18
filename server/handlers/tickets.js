"use strict";
/* ============================================================
   NEXO · server/handlers/tickets
   Bot Center de tickets: painel publicado como MENSAGEM REAL num
   canal (persistida no banco) e cada chamado vira um canal
   PRIVADO com ID TICKET-000N.

   Regras do sistema (tudo conferido AQUI, no backend — a
   interface só esconde botões, nunca é a única barreira):
   · a migração 0003 é necessária (tickets, ticket_participants,
     ticket_panels + colunas created_by/overrides em channels).
     Enquanto ela não for aplicada no Supabase, cada operação
     responde 503 "schema_pending" e a interface mostra esse
     estado — nada de fingir que um ticket foi aberto;
   · abrir/assumir/transferir/fechar/reabrir exigem staff
     (dono OU manageServer OU manageMembers) — com o ACL real;
   · o CANAL do ticket é privado de verdade: membro comum não o
     enxerga no sync nem envia nele. O portão é canViewChannel
     (acl), que honra overrides.view === "private" para
     participante/dono/staff;
   · toda ação fica registrada em `logs` (auditoria);
   · isolamento por servidor: um ticket só enxerga dados do
     próprio server_id — chamando a API direto não se vaza;
   · limite de abertura por janela, contado no BANCO.
   ============================================================ */

const db = require("../db");
const auth = require("../auth");
const u = require("../util");
const map = require("../map");
const acl = require("../acl");
const P = require("../patch");
const { ApiError, bad, forbidden, notFound } = require("../errors");

const T_TICKETS = "tickets";
const T_PARTS = "ticket_participants";
const T_PANELS = "ticket_panels";

const SUBJECT_MIN = 3;
const SUBJECT_MAX = 120;
const REASON_MIN = 5;
const REASON_MAX = 2000;

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 3;
const MAX_OPEN_PER_SERVER = 200;

function now() {
  return Date.now();
}

function msOf(v) {
  if (typeof v === "number" && isFinite(v)) return v;
  const t = Date.parse(String(v || ""));
  return isNaN(t) ? 0 : t;
}

/* a migração 0003 ainda não aplicada? `db.schemaFor` devolve um
   Set vazio para tabela inexistente. Mesmo 503 honesto do Suporte.
   Também conferimos as COLUNAS de channels (created_by, overrides):
   sem elas o canal do ticket seria criado SEM a privacidade, e o
   `insertSimple` apagaria os campos em silêncio — um falha quieta
   de segurança, não um erro. Aqui ela vira 503 explícito. */
async function assertTables() {
  const missing = [];
  let schema = null;
  try {
    schema = await db.schemaFor(T_TICKETS);
  } catch (e) {
    schema = null;
  }
  if (!schema || !schema.size) missing.push("tickets");
  let parts = null;
  try {
    parts = await db.schemaFor(T_PARTS);
  } catch (e) {
    parts = null;
  }
  if (!parts || !parts.size) missing.push("ticket_participants");
  let panels = null;
  try {
    panels = await db.schemaFor(T_PANELS);
  } catch (e) {
    panels = null;
  }
  if (!panels || !panels.size) missing.push("ticket_panels");

  let chCols = null;
  try {
    chCols = await db.schemaFor("channels");
  } catch (e) {
    chCols = null;
  }
  if (!chCols || !chCols.size || !chCols.has("created_by") || !chCols.has("overrides"))
    missing.push("channels.created_by/overrides");

  if (!missing.length) return;
  throw new ApiError(
    503,
    "O Bot Center de tickets ainda não foi implantado no banco: falta executar a migração supabase/migrations/0003_ticket_center.sql no Supabase (faltando: " +
      missing.join(", ") +
      "). Enquanto isso nenhum ticket é aberto — e nenhum é fingido como enviado.",
    "schema_pending"
  );
}

/* staff = dono OU manageServer OU manageMembers. Conferido no
   servidor real, nunca só na interface. */
function requireStaff(ctxS, userId, action) {
  if (
    acl.isOwner(ctxS, userId) ||
    acl.can(ctxS, userId, "manageServer") ||
    acl.can(ctxS, userId, "manageMembers")
  )
    return true;
  throw forbidden(
    "Você não tem permissão para " + (action || "gerenciar tickets") + " neste servidor."
  );
}

/* participante do ticket? (abridor ou quem o staff adicionou) */
async function isParticipant(ticketId, userId) {
  const rows =
    (await db.select(T_PARTS, { where: { ticket_id: ticketId, user_id: userId }, limit: 1 })) || [];
  return rows.length > 0;
}

/* código estável TICKET-0001, TICKET-0002… por servidor, contado
   no banco (não no relógio nem no navegador). */
async function nextCode(serverId) {
  const rows = (await db.select(T_TICKETS, { where: { server_id: serverId }, limit: 5000 })) || [];
  let max = 0;
  rows.forEach((r) => {
    const m = /^TICKET-(\d+)$/.exec(String(r.code || ""));
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  const s = String(max + 1);
  const pad = "0000".slice(s.length);
  return "TICKET-" + pad + s;
}

function toTicket(row) {
  const app = map.toApp(T_TICKETS, row);
  return {
    id: app.id,
    code: app.code,
    serverId: app.serverId,
    openerId: app.openerId,
    subject: app.subject,
    reason: app.reason,
    status: app.status || "open",
    channelId: app.channelId || null,
    assignedTo: app.assignedTo || null,
    closedBy: app.closedBy || null,
    closedAt: app.closedAt || null,
    closeReason: app.closeReason || null,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}

/* auditoria em `logs` — mesma forma que o handler de servidores usa */
async function audit(serverId, actorId, action, meta, target) {
  const entry = {
    id: u.uid("lg"),
    serverId: serverId,
    action: action,
    actorId: actorId || null,
    target: target || null,
    meta: meta || null,
    at: now(),
    createdAt: now(),
  };
  await db.insert("logs", entry);
  return entry;
}

/* participante precisa ser MEMBRO do servidor para enxergar o canal */
async function addParticipant(ctxS, ticketId, userId) {
  const existing =
    (await db.select(T_PARTS, { where: { ticket_id: ticketId, user_id: userId }, limit: 1 })) || [];
  if (existing.length) return false;
  if (!acl.membershipOf(ctxS, userId)) return false;
  await db.insert(T_PARTS, { ticketId: ticketId, userId: userId, addedAt: now() });
  return true;
}

/* ------------------------------------------------------------
   POST /servers/:id/tickets — abrir um chamado (qualquer membro)
   ------------------------------------------------------------ */
async function openTicket(ctx) {
  const me = await auth.requireUser(ctx.event);
  const serverId = ctx.params.id;
  const ctxS = await acl.loadServer(serverId);
  acl.requireMember(ctxS, me.id);

  const body = ctx.body || {};
  const subject = String(body.subject || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, SUBJECT_MAX);
  if (subject.length < SUBJECT_MIN)
    throw bad("Escreva um assunto com pelo menos " + SUBJECT_MIN + " caracteres.");

  const reason = String(body.reason || "").trim().slice(0, REASON_MAX);
  if (reason.length < REASON_MIN)
    throw bad("Descreva o motivo com pelo menos " + REASON_MIN + " caracteres.");

  /* validação ANTES da checagem de schema: pedido mal formado é 400
     de qualquer estado do banco. */
  await assertTables();

  const mine = (await db.select(T_TICKETS, { where: { server_id: serverId, opener_id: me.id }, limit: 200 })) || [];
  const openMine = mine.filter((t) => (t.status || "open") === "open");
  if (openMine.length >= 3)
    throw bad("Você já tem 3 chamados abertos neste servidor. Aguarde a equipe resolver antes de abrir outro.");

  const cutoff = now() - RATE_WINDOW_MS;
  const recent = mine.filter((t) => msOf(t.createdAt) >= cutoff);
  if (recent.length >= RATE_MAX)
    throw bad("Você abriu " + RATE_MAX + " chamados nos últimos 10 minutos. Aguarde um pouco.");

  const allOpen =
    ((await db.select(T_TICKETS, { where: { server_id: serverId, status: "open" }, limit: MAX_OPEN_PER_SERVER })) || []).length;
  if (allOpen >= MAX_OPEN_PER_SERVER)
    throw bad("Este servidor atingiu o limite de chamados abertos. Aguarde a equipe fechar alguns.");

  const code = await nextCode(serverId);
  const created = await db.insert(T_TICKETS, {
    id: u.uid("tk"),
    serverId: serverId,
    code: code,
    openerId: me.id,
    subject: subject,
    reason: reason,
    status: "open",
    createdAt: now(),
    updatedAt: now(),
  });

  /* canal PRIVADO do ticket: precisa de uma categoria (o modelo de
     canais exige). Reusa a "Chamados" se já existir, senão cria —
     nunca reaproveita categoria de conteúdo, para não sujar a tela
     de membros com um canal que eles não podem ver. */
  let cat = (ctxS.categories || []).find(
    (c) => c.name === "Chamados" || c.name === "Tickets"
  );
  if (!cat) {
    cat = await db.insert("categories", {
      id: u.uid("ct"),
      serverId: serverId,
      name: "Chamados",
      order: (ctxS.categories || []).length,
      collapsed: false,
      perms: {},
      createdAt: now(),
    });
  }

  const channel = await db.insert("channels", {
    id: u.uid("ch"),
    serverId: serverId,
    categoryId: cat.id,
    name: u.slug(code.toLowerCase()) || "ticket",
    type: "text",
    order: await db.count("channels", { where: { category_id: cat.id } }),
    topic: subject,
    perms: {},
    /* a privacidade REAL: membro comum não vê nem envia. O portão
       é canViewChannel (acl), que honra isto + ticket_participants */
    overrides: { view: "private", send: "all" },
    createdBy: me.id,
    createdAt: now(),
  });

  await db.update(T_TICKETS, { where: { id: created.id } }, {
    channelId: channel.id,
    updatedAt: now(),
  });

  await addParticipant(ctxS, created.id, me.id);
  /* a primeira mensagem do canal é o motivo escrito pelo abridor —
     nada de texto inventado, é a conversa real começando */
  await db.insert("messages", {
    id: u.uid("ms"),
    channelId: channel.id,
    conversationId: channel.id,
    authorId: me.id,
    senderId: me.id,
    content: ("**" + code + "** · " + subject + "\n\n" + reason).slice(0, 2000),
    createdAt: now(),
  });

  await audit(serverId, me.id, "ticket.open", { code: code, subject: subject }, created.id);

  const fresh = (await db.select(T_TICKETS, { where: { id: created.id }, limit: 1 }))[0];
  const patch = P.createPatch();
  P.set(patch, "tickets", created.id, toTicket(fresh || created));
  P.set(patch, "channels", channel.id, channel);
  return { status: 201, data: toTicket(fresh || created), patch: patch };
}

/* ------------------------------------------------------------
   GET /servers/:id/tickets — staff vê todos; membro vê os seus
   ------------------------------------------------------------ */
async function listTickets(ctx) {
  const me = await auth.requireUser(ctx.event);
  const serverId = ctx.params.id;
  const ctxS = await acl.loadServer(serverId);
  acl.requireMember(ctxS, me.id);
  await assertTables();

  const staff =
    acl.isOwner(ctxS, me.id) ||
    acl.can(ctxS, me.id, "manageServer") ||
    acl.can(ctxS, me.id, "manageMembers");

  const rows = (await db.select(T_TICKETS, { where: { server_id: serverId }, limit: 500 })) || [];
  let out;
  if (staff) {
    out = rows.map(toTicket);
  } else {
    const mineIds = new Set();
    for (const r of rows) {
      /* db.select devolve camelCase (map.toApp) — openerId, não opener_id */
      if (r.openerId === me.id) mineIds.add(r.id);
    }
    const parts =
      (await db.select(T_PARTS, { where: { user_id: me.id }, limit: 500 })) || [];
    parts.forEach((p) => mineIds.add(p.ticketId));
    out = rows.filter((r) => mineIds.has(r.id)).map(toTicket);
  }
  out.sort((a, b) => msOf(b.createdAt) - msOf(a.createdAt));
  return { data: out };
}

/* ------------------------------------------------------------
   POST /servers/:id/tickets/:tid/assign — assumir / transferir
   ------------------------------------------------------------ */
async function assignTicket(ctx) {
  const me = await auth.requireUser(ctx.event);
  const ctxS = await acl.loadServer(ctx.params.id);
  acl.requireMember(ctxS, me.id);
  requireStaff(ctxS, me.id, "assumir tickets");
  await assertTables();

  const rows = (await db.select(T_TICKETS, { where: { id: ctx.params.tid, server_id: ctx.params.id }, limit: 1 })) || [];
  const ticket = rows[0];
  if (!ticket) throw notFound("Este chamado não existe mais.");

  const body = ctx.body || {};
  const targetId = String(body.userId || me.id);
  if (!acl.membershipOf(ctxS, targetId))
    throw bad("Só é possível transferir para quem é membro deste servidor.");

  await db.update(T_TICKETS, { where: { id: ticket.id } }, { assignedTo: targetId, updatedAt: now() });
  await addParticipant(ctxS, ticket.id, targetId);
  await audit(ctx.params.id, me.id, "ticket.assign", { code: ticket.code, to: targetId }, ticket.id);

  const fresh = (await db.select(T_TICKETS, { where: { id: ticket.id }, limit: 1 }))[0];
  const patch = P.createPatch();
  P.set(patch, "tickets", fresh.id, toTicket(fresh));
  return { data: toTicket(fresh), patch: patch };
}

/* ------------------------------------------------------------
   POST /servers/:id/tickets/:tid/close — fechar (motivo)
   POST /servers/:id/tickets/:tid/reopen — reabrir
   ------------------------------------------------------------ */
async function closeTicket(ctx) {
  const me = await auth.requireUser(ctx.event);
  const ctxS = await acl.loadServer(ctx.params.id);
  acl.requireMember(ctxS, me.id);
  requireStaff(ctxS, me.id, "fechar tickets");
  await assertTables();

  const rows = (await db.select(T_TICKETS, { where: { id: ctx.params.tid, server_id: ctx.params.id }, limit: 1 })) || [];
  const ticket = rows[0];
  if (!ticket) throw notFound("Este chamado não existe mais.");

  const reason = String((ctx.body || {}).reason || "").trim().slice(0, REASON_MAX);
  if (reason.length < REASON_MIN)
    throw bad("Escreva o motivo do fechamento com pelo menos " + REASON_MIN + " caracteres.");

  await db.update(T_TICKETS, { where: { id: ticket.id } }, {
    status: "closed",
    closedBy: me.id,
    closedAt: now(),
    closeReason: reason,
    updatedAt: now(),
  });
  await audit(ctx.params.id, me.id, "ticket.close", { code: ticket.code, reason: reason }, ticket.id);

  const fresh = (await db.select(T_TICKETS, { where: { id: ticket.id }, limit: 1 }))[0];
  const patch = P.createPatch();
  P.set(patch, "tickets", fresh.id, toTicket(fresh));
  return { data: toTicket(fresh), patch: patch };
}

async function reopenTicket(ctx) {
  const me = await auth.requireUser(ctx.event);
  const ctxS = await acl.loadServer(ctx.params.id);
  acl.requireMember(ctxS, me.id);
  requireStaff(ctxS, me.id, "reabrir tickets");
  await assertTables();

  const rows = (await db.select(T_TICKETS, { where: { id: ctx.params.tid, server_id: ctx.params.id }, limit: 1 })) || [];
  const ticket = rows[0];
  if (!ticket) throw notFound("Este chamado não existe mais.");

  await db.update(T_TICKETS, { where: { id: ticket.id } }, {
    status: "open",
    closedBy: null,
    closedAt: null,
    closeReason: null,
    updatedAt: now(),
  });
  await audit(ctx.params.id, me.id, "ticket.reopen", { code: ticket.code }, ticket.id);

  const fresh = (await db.select(T_TICKETS, { where: { id: ticket.id }, limit: 1 }))[0];
  const patch = P.createPatch();
  P.set(patch, "tickets", fresh.id, toTicket(fresh));
  return { data: toTicket(fresh), patch: patch };
}

/* ------------------------------------------------------------
   GET /servers/:id/tickets/:tid/transcript — transcrição do canal
   ------------------------------------------------------------ */
async function transcript(ctx) {
  const me = await auth.requireUser(ctx.event);
  const ctxS = await acl.loadServer(ctx.params.id);
  acl.requireMember(ctxS, me.id);
  await assertTables();

  const rows = (await db.select(T_TICKETS, { where: { id: ctx.params.tid, server_id: ctx.params.id }, limit: 1 })) || [];
  const ticket = rows[0];
  if (!ticket) throw notFound("Este chamado não existe mais.");

  const staff =
    acl.isOwner(ctxS, me.id) ||
    acl.can(ctxS, me.id, "manageServer") ||
    acl.can(ctxS, me.id, "manageMembers");
  if (!staff && ticket.openerId !== me.id && !(await isParticipant(ticket.id, me.id)))
    throw forbidden("Você não participa deste chamado.");

  const msgs = ticket.channelId
    ? ((await db.select("messages", { where: { channel_id: ticket.channelId }, limit: 500, order: "createdAt" })) || [])
    : [];
  const lines = msgs.map((m) => ({
    senderId: m.senderId,
    content: m.content,
    createdAt: m.createdAt,
  }));
  return { data: { code: ticket.code, subject: ticket.subject, status: ticket.status, messages: lines } };
}

/* ------------------------------------------------------------
   Painel: POST /servers/:id/tickets/panel (publicar num canal)
   ------------------------------------------------------------ */
async function publishPanel(ctx) {
  const me = await auth.requireUser(ctx.event);
  const serverId = ctx.params.id;
  const ctxS = await acl.loadServer(serverId);
  acl.requireMember(ctxS, me.id);
  requireStaff(ctxS, me.id, "publicar o painel de tickets");
  await assertTables();

  const body = ctx.body || {};
  const title = String(body.title || "Abrir chamado").trim().slice(0, 80) || "Abrir chamado";
  const channelId = String(body.channelId || "");
  const channel = ctxS.channels.find((c) => c.id === channelId);
  if (!channel) throw bad("Escolha um canal de texto válido deste servidor.");
  if (!(await acl.canSendIn(ctxS, channel, me.id)))
    throw bad("Você não pode publicar mensagens neste canal.");

  const content =
    "🎫 **" + title + "**\n" +
    "Toque no botão ou use o comando para abrir um chamado. " +
    "A equipe responde por aqui — cada chamado vira um canal privado.";

  const message = {
    id: u.uid("ms"),
    channelId: channel.id,
    conversationId: channel.id,
    authorId: me.id,
    senderId: me.id,
    content: content.slice(0, 2000),
    createdAt: now(),
  };
  await db.insert("messages", message);

  const created = await db.insert(T_PANELS, {
    serverId: serverId,
    channelId: channel.id,
    messageId: message.id,
    title: title,
    createdBy: me.id,
    createdAt: now(),
    updatedAt: now(),
  });
  await audit(serverId, me.id, "ticket.panel", { title: title, channel: channel.name }, created.id);

  return { status: 201, data: { id: created.id, messageId: message.id, channelId: channel.id, title: title } };
}

/* ------------------------------------------------------------
   GET /servers/:id/tickets/:tid — detalhe (staff, abridor ou
   participante). Membro comum que não entra não vê nada.
   ------------------------------------------------------------ */
async function getTicket(ctx) {
  const me = await auth.requireUser(ctx.event);
  const ctxS = await acl.loadServer(ctx.params.id);
  acl.requireMember(ctxS, me.id);
  await assertTables();

  const rows = (await db.select(T_TICKETS, { where: { id: ctx.params.tid, server_id: ctx.params.id }, limit: 1 })) || [];
  const ticket = rows[0];
  if (!ticket) throw notFound("Este chamado não existe mais.");

  const staff =
    acl.isOwner(ctxS, me.id) ||
    acl.can(ctxS, me.id, "manageServer") ||
    acl.can(ctxS, me.id, "manageMembers");
  if (!staff && ticket.openerId !== me.id && !(await isParticipant(ticket.id, me.id)))
    throw forbidden("Você não tem acesso a este chamado.");

  const parts = (await db.select(T_PARTS, { where: { ticket_id: ticket.id }, limit: 200 })) || [];
  return {
    data: Object.assign(toTicket(ticket), {
      participantIds: parts.map((p) => p.userId),
    }),
  };
}

/* ------------------------------------------------------------
   GET /servers/:id/tickets/panel — painel publicado (se houver)
   ------------------------------------------------------------ */
async function getPanel(ctx) {
  const me = await auth.requireUser(ctx.event);
  const ctxS = await acl.loadServer(ctx.params.id);
  acl.requireMember(ctxS, me.id);
  await assertTables();

  const rows = (await db.select(T_PANELS, { where: { server_id: ctx.params.id }, limit: 10 })) || [];
  const panel = rows[0];
  if (!panel) return { data: null };
  return {
    data: {
      id: panel.id,
      channelId: panel.channelId,
      messageId: panel.messageId,
      title: panel.title,
      createdBy: panel.createdBy,
      createdAt: panel.createdAt,
    },
  };
}

/* rotas registradas no router */
function routes() {
  return [
    ["POST", "/servers/:id/tickets", openTicket],
    ["GET", "/servers/:id/tickets", listTickets],
    /* "panel" ANTES de ":tid": o router guarda o PRIMEIRO match, e
       ":tid" casaria com o literal "panel" — tornaria o painel 404. */
    ["GET", "/servers/:id/tickets/panel", getPanel],
    ["GET", "/servers/:id/tickets/:tid", getTicket],
    ["POST", "/servers/:id/tickets/:tid/assign", assignTicket],
    ["POST", "/servers/:id/tickets/:tid/close", closeTicket],
    ["POST", "/servers/:id/tickets/:tid/reopen", reopenTicket],
    ["GET", "/servers/:id/tickets/:tid/transcript", transcript],
    ["POST", "/servers/:id/tickets/panel", publishPanel],
  ];
}

module.exports = { routes };
