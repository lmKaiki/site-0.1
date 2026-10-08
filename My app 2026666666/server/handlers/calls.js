"use strict";
/* ============================================================
   NEXO · server/handlers/calls
   Chamadas reais entre pessoas (WebRTC no navegador) com
   sinalização pelo backend existente.

   · o estado de cada chamada mora em `prefs.data.calls` do
     próprio participante (uma linha por pessoa, sem tabela nova);
   · ofertas/respostas/candidatos ICE trafegam em
     `prefs.data.signal[callId]`, lidos e esvaziados por
     `GET /calls/peek` (o navegador consulta enquanto está visível);
   · convite/recusa/fim também geram notificação real.

   Isto é sinalização de verdade: quem oferece, quem aceita e os
   candidatos ICE são trocados por aqui — o áudio/vídeo em si nunca
   passa pelo servidor (RTCPeerConnection no cliente).
   ============================================================ */

const db = require("../db");
const auth = require("../auth");
const u = require("../util");
const handlersAuth = require("./auth");
const R = require("../relations");
const { bad, forbidden, notFound } = require("../errors");

function now() {
  return Date.now();
}

const CALL_TTL = 6 * 60 * 60 * 1000;   /* chamada esquecida é encerrada */
const SIGNAL_MAX = 80;                 /* candidatos pendentes por chamada */
const PEEKABLE = ["ringing", "incoming", "active"];

function callsOf(prefs) {
  if (!prefs.calls || typeof prefs.calls !== "object") prefs.calls = {};
  return prefs.calls;
}

function activeCall(prefs) {
  const calls = callsOf(prefs);
  const ids = Object.keys(calls);
  for (const id of ids) {
    const c = calls[id];
    if (c && PEEKABLE.indexOf(c.state) !== -1 && now() - Number(c.startedAt || 0) < CALL_TTL)
      return c;
  }
  return null;
}

async function save(userId, prefs) {
  await db.writePrefs(userId, prefs);
}

/* encerra chamada dos DOIS lados (best-effort) */
async function settle(prefsA, userIdA, prefsB, userIdB, callId, state, reason, extra) {
  const a = callsOf(prefsA)[callId];
  const b = callsOf(prefsB)[callId];
  if (a) {
    a.state = state;
    a.endedAt = now();
    if (reason) a.reason = reason;
    if (extra) Object.assign(a, extra);
  }
  if (b) {
    b.state = state;
    b.endedAt = now();
    if (reason) b.reason = reason;
    if (extra) Object.assign(b, extra);
  }
  await save(userIdA, prefsA);
  await save(userIdB, prefsB);
}

/* ---------------------------- iniciar ---------------------------- */
async function startCall(ctx) {
  const me = await auth.requireUser(ctx.event);
  const peerId = String((ctx.body || {}).peerId || "");
  if (!peerId) throw bad("Escolha quem você quer chamar.");
  if (peerId === me.id) throw bad("Você não pode ligar para si mesmo.");

  const peer = (await db.select("users", { where: { id: peerId }, limit: 1 }))[0];
  if (!peer) throw notFound("Esta pessoa não existe mais.");

  /* bloqueio em qualquer sentido impede a chamada */
  const blocked = await R.blockedBetween(me.id, peerId);
  if (blocked) throw forbidden("Não é possível iniciar uma chamada com esta pessoa.");

  const canDM = await R.canDM(me.id, peerId);
  if (!canDM) throw forbidden("Só é possível ligar para amigos ou pessoas que podem te enviar mensagens.");

  const myPrefs = await db.readPrefs(me.id);
  const peerPrefs = await db.readPrefs(peerId);

  const mineNow = activeCall(myPrefs);
  if (mineNow) throw bad("Você já está em uma chamada.");
  const theirsNow = activeCall(peerPrefs);
  if (theirsNow) throw bad("Esta pessoa já está em outra chamada.");

  const id = u.uid("cl");
  const at = now();
  callsOf(myPrefs)[id] = { id, peerId, role: "caller", state: "ringing", startedAt: at, answeredAt: null, endedAt: null, reason: null };
  callsOf(peerPrefs)[id] = { id, peerId: me.id, role: "callee", state: "incoming", startedAt: at, answeredAt: null, endedAt: null, reason: null };
  if (!peerPrefs.signal || typeof peerPrefs.signal !== "object") peerPrefs.signal = {};
  peerPrefs.signal[id] = [];
  await save(me.id, myPrefs);
  await save(peerId, peerPrefs);

  const note = await handlersAuth.createNotification(
    peerId,
    "call",
    "📞 " + (me.displayName || me.username) + " está ligando para você.",
    { callId: id, href: "#/mensagens", actorId: me.id }
  );

  const patch = {};
  if (note) patch.notifications = [note];
  return { status: 201, data: callsOf(myPrefs)[id], patch: undefined, meta: { notificationId: note ? note.id : null } };
}

/* ------------------------- atender/recusar ------------------------ */
async function respondCall(ctx) {
  const me = await auth.requireUser(ctx.event);
  const callId = ctx.params.id;
  const accept = (ctx.body || {}).accept !== false;

  const myPrefs = await db.readPrefs(me.id);
  const mine = callsOf(myPrefs)[callId];
  if (!mine) throw notFound("Esta chamada não existe mais.");
  if (mine.state !== "incoming" && mine.state !== "ringing")
    throw bad("Esta chamada já foi respondida.");

  const peerPrefs = await db.readPrefs(mine.peerId);
  const at = now();

  if (accept) {
    mine.state = "active";
    mine.answeredAt = at;
    const peer = callsOf(peerPrefs)[callId];
    if (peer) {
      peer.state = "active";
      peer.answeredAt = at;
    }
    await save(me.id, myPrefs);
    await save(mine.peerId, peerPrefs);
    await handlersAuth.createNotification(
      mine.peerId,
      "call",
      "✅ Chamada atendida por " + (me.displayName || me.username) + ".",
      { callId, actorId: me.id }
    );
    return { data: mine };
  }

  mine.state = "declined";
  mine.endedAt = at;
  mine.reason = "declined";
  const peer = callsOf(peerPrefs)[callId];
  if (peer) {
    peer.state = "declined";
    peer.endedAt = at;
    peer.reason = "declined";
  }
  if (peerPrefs.signal) delete peerPrefs.signal[callId];
  await save(me.id, myPrefs);
  await save(mine.peerId, peerPrefs);
  await handlersAuth.createNotification(
    mine.peerId,
    "call",
    "❌ " + (me.displayName || me.username) + " recusou sua chamada.",
    { callId, actorId: me.id }
  );
  return { data: mine };
}

/* ---------------------------- encerrar ---------------------------- */
async function endCall(ctx) {
  const me = await auth.requireUser(ctx.event);
  const callId = ctx.params.id;
  const reason = String((ctx.body || {}).reason || "hangup").slice(0, 24);

  const myPrefs = await db.readPrefs(me.id);
  const mine = callsOf(myPrefs)[callId];
  if (!mine) throw notFound("Esta chamada não existe mais.");

  const peerPrefs = await db.readPrefs(mine.peerId);
  const state = reason === "missed" ? "missed" : "ended";
  await settle(myPrefs, me.id, peerPrefs, mine.peerId, callId, state, reason);
  if (myPrefs.signal) delete myPrefs.signal[callId];
  if (peerPrefs.signal) delete peerPrefs.signal[callId];
  await save(me.id, myPrefs);
  await save(mine.peerId, peerPrefs);

  if (state === "missed" && mine.role === "callee")
    await handlersAuth.createNotification(mine.peerId, "call", "📵 Chamada perdida de " + (me.displayName || me.username) + ".", { callId, actorId: me.id });
  else if (state === "missed" && mine.role === "caller")
    await handlersAuth.createNotification(mine.peerId, "call", "📵 Chamada perdida para " + (me.displayName || me.username) + ".", { callId, actorId: me.id });

  return { data: mine };
}

/* --------------------------- sinalização -------------------------- */
async function pushSignal(ctx) {
  const me = await auth.requireUser(ctx.event);
  const callId = ctx.params.id;
  const body = ctx.body || {};
  const kind = String(body.kind || "");
  if (["offer", "answer", "candidate", "bye"].indexOf(kind) === -1)
    throw bad("Sinal inválido.");

  const myPrefs = await db.readPrefs(me.id);
  const mine = callsOf(myPrefs)[callId];
  if (!mine) throw forbidden("Você não participa desta chamada.");

  const payload = String(body.payload || "");
  if (payload.length > 12000) throw bad("Sinalização muito grande.");

  const peerPrefs = await db.readPrefs(mine.peerId);
  if (!peerPrefs.signal || typeof peerPrefs.signal !== "object") peerPrefs.signal = {};
  const queue = peerPrefs.signal[callId] || [];
  queue.push({ kind, payload, from: me.id, at: now() });
  while (queue.length > SIGNAL_MAX) queue.shift();
  peerPrefs.signal[callId] = queue;
  await save(mine.peerId, peerPrefs);
  return { data: true };
}

/* consulta única do navegador: estado das chamadas + sinais novos */
async function peek(ctx) {
  const me = await auth.requireUser(ctx.event);
  const myPrefs = await db.readPrefs(me.id);
  const calls = callsOf(myPrefs);
  const out = {};
  const pending = [];

  /* expira chamadas esquecidas */
  let dirty = false;
  Object.keys(calls).forEach((id) => {
    const c = calls[id];
    if (!c) return;
    const stale = now() - Number(c.startedAt || 0) > CALL_TTL;
    if ((c.state === "ringing" || c.state === "incoming" || c.state === "active") && stale) {
      c.state = "ended";
      c.endedAt = now();
      c.reason = "expired";
      dirty = true;
    }
    if (now() - Number(c.endedAt || 0) < 24 * 3600 * 1000 || PEEKABLE.indexOf(c.state) !== -1)
      out[id] = c;
  });

  const signalMap = myPrefs.signal || {};
  Object.keys(signalMap).forEach((cid) => {
    const list = signalMap[cid];
    if (Array.isArray(list) && list.length) pending.push({ callId: cid, items: list });
  });
  if (pending.length) {
    myPrefs.signal = {};
    dirty = true;
  }
  if (dirty) await save(me.id, myPrefs);

  /* nomes de exibição para quem está chamando */
  const peers = {};
  for (const id of Object.keys(out)) {
    const p = (await db.select("users", { where: { id: out[id].peerId }, limit: 1 }))[0];
    if (p) {
      peers[id] = { id: p.id, username: p.username, displayName: p.displayName, avatar: p.avatar, status: p.status };
    }
  }

  return { data: { calls: out, signals: pending, peers, serverTime: now() } };
}

function routes() {
  return [
    ["POST", "/calls", startCall],
    ["POST", "/calls/:id/respond", respondCall],
    ["POST", "/calls/:id/end", endCall],
    ["POST", "/calls/:id/signal", pushSignal],
    ["GET", "/calls/peek", peek],
  ];
}

module.exports = { routes };
