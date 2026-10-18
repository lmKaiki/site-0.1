"use strict";
/* ============================================================
   NEXO · server/handlers/messages
   Mensagens em canais de servidor: enviar, editar, apagar,
   reagir e fixar — com as MESMAS permissões que a interface
   mostra, porém verificadas aqui.
   ============================================================ */

const db = require("../db");
const auth = require("../auth");
const u = require("../util");
const P = require("../patch");
const acl = require("../acl");
const { bad, notFound, forbidden } = require("../errors");
const { sanitizeAttachments } = require("./social");

function now() {
  return Date.now();
}

async function loadMessage(id) {
  const rows = await db.select("messages", { where: { id }, limit: 1 });
  return rows && rows[0] ? rows[0] : null;
}

function routes() {
  return [
    ["POST", "/channels/:id/messages", sendChannelMessage],
    ["PATCH", "/messages/:id", editMessage],
    ["DELETE", "/messages/:id", deleteMessage],
    ["POST", "/messages/:id/reactions", toggleReaction],
    ["POST", "/messages/:id/pin", pinMessage],
  ];
}

async function sendChannelMessage(ctx) {
  const me = await auth.requireUser(ctx.event);
  const body = ctx.body || {};
  const text = String(body.content || "").trim();
  const attachments = sanitizeAttachments(body.attachments);
  if (!text && !attachments.length) throw bad("");
  if (attachments.length)
    await db.assertWritable(
      "messages",
      "attachments",
      "O envio de anexos está indisponível neste banco. Execute a migração do Nexo (supabase/migrations/0001_nexo_backend.sql) e tente novamente."
    );
  if (text.length > 2000)
    throw bad("As mensagens podem ter no máximo 2000 caracteres.");

  const rows = await db.select("channels", { where: { id: ctx.params.id }, limit: 1 });
  const channel = rows && rows[0];
  if (!channel) throw notFound("Este canal não existe mais.");

  const ctxS = await acl.loadServer(channel.serverId);
  if (!(await acl.canSendIn(ctxS, channel, me.id)))
    throw forbidden("Você não pode enviar mensagens neste canal.");

  /* comando de um app instalado é executado AQUI, no servidor:
     permissão do usuário e do bot são conferidas nas duas pontas */
  if (text[0] === "/") {
    const reply = await require("./apps").runCommand(ctxS, channel, me, text);
    if (reply && reply.length) {
      const cmdPatch = P.createPatch();
      reply.forEach((m) => P.set(cmdPatch, "messages", m.id, m));
      return { status: 201, data: reply[reply.length - 1], patch: cmdPatch };
    }
  }

  const perms = acl.effectiveChannelPerms(ctxS, channel, me.id);
  if (attachments.length && !perms.attachFiles)
    throw forbidden("Seu cargo não tem a permissão “Anexar arquivos” aqui.");
  if (attachments.some((a) => a.type === "gif") && !perms.useGifs)
    throw forbidden("Seu cargo não tem a permissão “Usar GIFs” aqui.");
  if (!text && attachments.length && !perms.useEmojis)
    throw forbidden("Seu cargo não pode enviar mídia sem texto neste canal.");

  /* anti-spam do Nexo Moderação (desligado por padrão): confere as
     mensagens REAIS recentes desta pessoa no canal e, se estourou o
     limite, a mensagem nova não é publicada — o bot explica e o
     servidor registra. Falha aqui nunca bloqueia o envio normal. */
  const spamHit = await require("./apps").checkSpam(ctxS, channel, me);
  if (spamHit && spamHit.blocked) {
    if (spamHit.reply) {
      const spamPatch = P.createPatch();
      P.set(spamPatch, "messages", spamHit.reply.id, spamHit.reply);
      return { status: 201, data: spamHit.reply, patch: spamPatch };
    }
    throw forbidden(
      "Você enviou mensagens rápido demais para este canal. Aguarde alguns segundos e tente de novo."
    );
  }

  /* AutoMod do Nexo (desligado sem termos configurados): confere
     APENAS o texto desta mensagem contra a lista do servidor — se
     bateu, a mensagem não é publicada e o bot explica. Mesma
     filosofia do anti-spam: falha aqui nunca bloqueia o envio. */
  const autoHit = await require("./apps").moderateContent(ctxS, channel, me, text);
  if (autoHit && autoHit.blocked) {
    if (autoHit.reply) {
      const autoPatch = P.createPatch();
      P.set(autoPatch, "messages", autoHit.reply.id, autoHit.reply);
      return { status: 201, data: autoHit.reply, patch: autoPatch };
    }
    throw forbidden("Sua mensagem contém um termo bloqueado neste servidor.");
  }

  const message = {
    id: u.uid("ms"),
    channelId: channel.id,
    conversationId: channel.id,
    authorId: me.id,
    senderId: me.id,
    content: text.slice(0, 2000),
    attachments,
    type: "user",
    reactions: {},
    pinned: false,
    createdAt: now(),
    updatedAt: null,
  };
  await db.insert("messages", message);

  const patch = P.createPatch();
  P.set(patch, "messages", message.id, message);
  return { status: 201, data: message, patch };
}

async function editMessage(ctx) {
  const me = await auth.requireUser(ctx.event);
  const message = await loadMessage(ctx.params.id);
  if (!message) throw notFound("Mensagem não encontrada.");

  const isMine = message.authorId === me.id;
  /* mensagem publicada por um APP: o texto vem do bot e ninguém edita
     (editar apagaria o marcador «bot:…» e viraria fala de pessoa) */
  if (/^«bot:/.test(String(message.content || "")))
    throw bad("Mensagens de bots não podem ser editadas.");
  const rows = await db.select("channels", { where: { id: message.channelId }, limit: 1 });
  const channel = rows && rows[0];
  if (!isMine) {
    if (!channel) throw notFound("Mensagem não encontrada.");
    const ctxS = await acl.loadServer(channel.serverId);
    if (!acl.channelPerm(ctxS, channel, me.id, "editMessages"))
      throw forbidden("Você não tem permissão para editar mensagens de outras pessoas.");
  }

  const text = String((ctx.body || {}).content || "").trim();
  if (!text) throw bad("A mensagem não pode ficar vazia.");
  await db.update(
    "messages",
    { where: { id: message.id } },
    { content: text.slice(0, 2000), updatedAt: now() }
  );
  const fresh = await loadMessage(message.id);
  const patch = P.createPatch();
  P.set(patch, "messages", message.id, fresh);
  return { data: fresh, patch };
}

async function deleteMessage(ctx) {
  const me = await auth.requireUser(ctx.event);
  const message = await loadMessage(ctx.params.id);
  if (!message) throw notFound("Mensagem não encontrada.");

  const isMine = message.authorId === me.id;
  const rows = await db.select("channels", { where: { id: message.channelId }, limit: 1 });
  const channel = rows && rows[0];
  if (!isMine) {
    if (!channel) throw notFound("Mensagem não encontrada.");
    const ctxS = await acl.loadServer(channel.serverId);
    if (!acl.channelPerm(ctxS, channel, me.id, "deleteMessages"))
      throw forbidden("Você não tem permissão para apagar mensagens de outras pessoas.");
    const { log, appsEvent } = require("./servers");
    await log(
      channel.serverId,
      "message.delete",
      { userId: message.authorId, channel: "#" + channel.name },
      message.id,
      me.id
    );
    appsEvent(channel.serverId, "message.delete", { channel: channel.name, actorId: me.id }, ctxS);
  }
  await db.remove("messages", { where: { id: message.id } });
  const patch = P.createPatch();
  P.del(patch, "messages", [message.id]);
  return { data: true, patch };
}

async function toggleReaction(ctx) {
  const me = await auth.requireUser(ctx.event);
  const message = await loadMessage(ctx.params.id);
  if (!message) throw notFound("Mensagem não encontrada.");
  const emoji = String((ctx.body || {}).emoji || "").slice(0, 12);
  if (!emoji) throw bad("");

  const isDM = String(message.channelId).indexOf("dm_") === 0;
  if (isDM) {
    const rows = await db.select("dms", { where: { id: message.channelId }, limit: 1 });
    const dm = rows && rows[0];
    if (!dm || !Array.isArray(dm.participants) || dm.participants.indexOf(me.id) === -1)
      throw notFound("Conversa não encontrada.");
  } else {
    const rows = await db.select("channels", { where: { id: message.channelId }, limit: 1 });
    const channel = rows && rows[0];
    if (!channel) throw notFound("Este canal não existe mais.");
    const ctxS = await acl.loadServer(channel.serverId);
    if (!(await acl.canSendIn(ctxS, channel, me.id)))
      throw forbidden("Você não pode reagir neste canal.");
    if (!acl.channelPerm(ctxS, channel, me.id, "useEmojis"))
      throw forbidden("Seu cargo não tem a permissão “Usar emojis” aqui.");
  }

  await db.assertWritable(
    isDM ? "dm_messages" : "messages",
    "reactions",
    "Reações em mensagens não estão disponíveis neste banco. Execute a migração do Nexo (supabase/migrations/0001_nexo_backend.sql)."
  );

  const reactions = Object.assign({}, message.reactions || {});
  const list = (reactions[emoji] || []).slice();
  const i = list.indexOf(me.id);
  if (i === -1) list.push(me.id);
  else list.splice(i, 1);
  if (list.length) reactions[emoji] = list;
  else delete reactions[emoji];

  await db.update("messages", { where: { id: message.id } }, { reactions });
  const fresh = await loadMessage(message.id);
  const patch = P.createPatch();
  P.set(patch, "messages", message.id, fresh);
  return { data: fresh, patch };
}

async function pinMessage(ctx) {
  const me = await auth.requireUser(ctx.event);
  const message = await loadMessage(ctx.params.id);
  if (!message) throw notFound("Mensagem não encontrada.");

  const rows = await db.select("channels", { where: { id: message.channelId }, limit: 1 });
  const channel = rows && rows[0];
  if (!channel) throw notFound("Esta mensagem não está em um canal.");

  const ctxS = await acl.loadServer(channel.serverId);
  const mine = message.authorId === me.id;
  if (!mine && !acl.channelPerm(ctxS, channel, me.id, "pinMessages"))
    throw forbidden("Você não tem permissão para fixar mensagens de outras pessoas.");
  if (!(await acl.canSendIn(ctxS, channel, me.id)))
    throw forbidden("Você não tem permissão neste canal.");

  const pinned = (ctx.body || {}).pinned !== false;
  await db.assertWritable(
    "messages",
    "pinned",
    "Mensagens fixadas não estão disponíveis neste banco. Execute a migração do Nexo (supabase/migrations/0001_nexo_backend.sql)."
  );
  await db.update("messages", { where: { id: message.id } }, { pinned });
  const { log } = require("./servers");
  const entry = await log(
    channel.serverId,
    "message.pin",
    { channel: "#" + channel.name, pinned },
    message.id,
    me.id
  );
  const fresh = await loadMessage(message.id);
  const patch = P.createPatch();
  P.set(patch, "messages", message.id, fresh);
  P.set(patch, "logs", entry.id, entry);
  return { data: fresh, patch };
}

module.exports = { routes, loadMessage };
