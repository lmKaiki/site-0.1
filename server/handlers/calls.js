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
const acl = require("../acl");
const map = require("../map");
const handlersAuth = require("./auth");
const R = require("../relations");
const { bad, forbidden, notFound } = require("../errors");

function now() {
  return Date.now();
}

const CALL_TTL = 6 * 60 * 60 * 1000;   /* chamada esquecida é encerrada */
const SIGNAL_MAX = 80;                 /* candidatos pendentes por chamada */
const SIGNAL_ONE = 64 * 1024;          /* um sinal: SDP REAL de 4 mídias ~14 KB */
const SIGNAL_BYTES = 256 * 1024;       /* a fila inteira (o peek devolve tudo) */
const PEEKABLE = ["ringing", "incoming", "active"];

/* fila limitada por QUANTIDADE e por TAMANHO — oferta/respuesta de WebRTC
   passa a SDP inteira no corpo do sinal, então o limite é em bytes */
function trimQueue(queue) {
  let total = 0;
  for (let i = 0; i < queue.length; i++)
    total += String((queue[i] && queue[i].payload) || "").length;
  while (queue.length > 1 && (queue.length > SIGNAL_MAX || total > SIGNAL_BYTES)) {
    const out = queue.shift();
    total -= String((out && out.payload) || "").length;
  }
  return queue;
}

function callsOf(prefs) {
  if (!prefs.calls || typeof prefs.calls !== "object") prefs.calls = {};
  return prefs.calls;
}

function activeCall(prefs) {
  const calls = callsOf(prefs);
  const ids = Object.keys(calls);
  for (const id of ids) {
    const c = calls[id];
    /* um registro com motivo de fim nunca é uma chamada viva, mesmo
       que o estado ainda diga "ativa" — senão ela bloqueia ligar */
    if (c && !c.reason && PEEKABLE.indexOf(c.state) !== -1 && now() - Number(c.startedAt || 0) < CALL_TTL)
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

  /* sala de voz e chamada 1:1 não convivem — dito aqui, do lado do
     servidor, para ninguém ficar "ligando" para quem nem pode atender */
  try {
    const myVoice = await db.select("voice", { where: { user_id: me.id }, limit: 1 });
    if (myVoice && myVoice.length) throw bad("Você está em uma sala de voz. Saia dela para ligar.");
    const theirVoice = await db.select("voice", { where: { user_id: peerId }, limit: 1 });
    if (theirVoice && theirVoice.length) throw bad("Esta pessoa está em uma sala de voz agora.");
  } catch (e) {
    if (e && e.name === "ApiError") throw e; /* recusa de negócio acima */
    /* tabela de voz indisponível: a chamada segue normalmente */
  }

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
    (me.displayName || me.username) + " está ligando para você.",
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
      "Chamada atendida por " + (me.displayName || me.username) + ".",
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
    (me.displayName || me.username) + " recusou sua chamada.",
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
    await handlersAuth.createNotification(mine.peerId, "call", "Chamada perdida de " + (me.displayName || me.username) + ".", { callId, actorId: me.id });
  else if (state === "missed" && mine.role === "caller")
    await handlersAuth.createNotification(mine.peerId, "call", "Chamada perdida para " + (me.displayName || me.username) + ".", { callId, actorId: me.id });

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
  if (payload.length > SIGNAL_ONE) throw bad("Sinalização muito grande.");

  /* fila SOB a trava do destinatário: dois sinais no mesmo instante
     apagavam o documento um do outro (oferta/replica perdida) */
  await db.lockPrefs(mine.peerId, async () => {
    const peerPrefs = await db.readPrefs(mine.peerId);
    if (!peerPrefs.signal || typeof peerPrefs.signal !== "object") peerPrefs.signal = {};
    const queue = peerPrefs.signal[callId] || [];
    queue.push({ kind, payload, from: me.id, at: now() });
    trimQueue(queue);
    peerPrefs.signal[callId] = queue;
    await save(mine.peerId, peerPrefs);
  });
  return { data: true };
}

/* consulta única do navegador: estado das chamadas + sinais novos */
async function peek(ctx) {
  const me = await auth.requireUser(ctx.event);
  const out = {};
  let pending = [];
  /* ler e consumir as filas SOB a trava do usuário: um peek simultâneo
     a um push de sinal gravava o documento sem o sinal novo e a oferta
     WebRTC sumia com status 200 */
  await db.lockPrefs(me.id, async () => {
    const myPrefs = await db.readPrefs(me.id);
    const calls = callsOf(myPrefs);

    /* expira chamadas esquecidas */
    let dirty = false;
    Object.keys(calls).forEach((id) => {
      const c = calls[id];
      if (!c) return;
      const live = c.state === "ringing" || c.state === "incoming" || c.state === "active";
      const stale = now() - Number(c.startedAt || 0) > CALL_TTL;
      if (live && stale) {
        c.state = "ended";
        c.endedAt = now();
        c.reason = "expired";
        dirty = true;
      } else if (live && c.reason) {
        /* autocura: registro contraditório — a chamada ainda diz "ativa"
           mas já carrega motivo de fim (acontece quando as duas pontas
           respondem no mesmo instante). Sem isto ela fica presa e
           impede a pessoa de iniciar outra chamada. */
        c.state = "ended";
        c.endedAt = c.endedAt || now();
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
  });

  /* nomes de exibição para quem está chamando */
  const peers = {};
  for (const id of Object.keys(out)) {
    const p = (await db.select("users", { where: { id: out[id].peerId }, limit: 1 }))[0];
    if (p) {
      peers[id] = { id: p.id, username: p.username, displayName: p.displayName, avatar: p.avatar, status: p.status };
    }
  }

  /* quem está em cada sala de voz (e a renovação da minha linha) */
  let voice = [];
  let voiceMod = {};
  try {
    const snap = await voiceSnapshot(me.id);
    voice = snap.rows || [];
    voiceMod = snap.mod || {};
  } catch (e) {
    voice = [];
    voiceMod = {};
  }

  return { data: { calls: out, signals: pending, peers, voice, voiceMod, serverTime: now() } };
}

/* ==================== salas de voz (canal de servidor) ====================
   A sala de voz NÃO é uma chamada: é presença real na tabela `voice`
   (já existente no banco) + sinalização WebRTC entre quem está na
   mesma sala. O áudio/vídeo nunca passa por aqui — só oferta,
   resposta, candidatos ICE e o estado dos dispositivos.            */

const VOICE_TOUCH_MS = 8000;   /* renova a minha presença a cada peek */
const VOICE_TTL = 45000;       /* presença sem renovação deixa de valer */
const VOICE_GC_MS = 60000;     /* limpeza de presenças órfãs (melhor esforço) */
const VOICE_STALE_MS = 30 * 60 * 1000;
const ROOM_SIGNAL = "vc:";     /* prefixo das salas em prefs.signal */

let voiceServersCache = { at: 0, userId: null, ids: [] };
let voiceGcAt = 0;

/* servidores que eu pertenço: só deles interessa a presença de voz */
async function voiceServersOf(userId) {
  const at = now();
  if (voiceServersCache.userId === userId && at - voiceServersCache.at < 30000)
    return voiceServersCache.ids;
  let ids = [];
  try {
    const rows = await db.select("memberships", { where: { user_id: userId }, limit: 200 });
    ids = (rows || []).map((m) => m.serverId).filter(Boolean);
  } catch (e) {
    ids = [];
  }
  voiceServersCache = { at: at, userId: userId, ids: ids };
  return ids;
}

async function voiceRow(channelId, userId) {
  try {
    const rows = await db.select("voice", {
      where: { channel_id: channelId, user_id: userId },
      limit: 1,
    });
    return (rows && rows[0]) || null;
  } catch (e) {
    return null;
  }
}

/* canal de voz + permissões de quem está entrando/sinalizando
   (validação server-side: nada de IDOR pela URL) */
async function voiceContext(me, channelId) {
  const ch = (await db.select("channels", { where: { id: channelId }, limit: 1 }))[0];
  if (!ch) throw notFound("Este canal de voz não existe mais.");
  if (ch.type !== "voice") throw bad("Este canal não é de voz.");
  const sctx = await acl.loadServer(ch.serverId);
  acl.requireMember(sctx, me.id);
  if (!(await acl.canViewChannel(sctx, ch, me.id))) throw forbidden("Você não pode ver este canal.");
  if (!acl.channelPerm(sctx, ch, me.id, "joinVoice"))
    throw forbidden("Você não tem permissão para entrar em canais de voz.");
  return { ch: ch, sctx: sctx };
}

/* limpeza de quem fechou o navegador sem sair (melhor esforço) */
async function gcVoice() {
  const at = now();
  if (at - voiceGcAt < VOICE_GC_MS) return;
  voiceGcAt = at;
  try {
    const rows = await db.select("voice", { limit: 1000 });
    const stale = (rows || []).filter(
      (r) => at - Number(r.updatedAt || r.joinedAt || 0) > VOICE_STALE_MS
    );
    for (const r of stale) {
      await db.remove("voice", { where: { server_id: r.serverId, user_id: r.userId } });
    }
  } catch (e) {
    /* limpeza nunca pode derrubar a entrada na sala */
  }
}

async function joinVoice(ctx) {
  const me = await auth.requireUser(ctx.event);
  const channelId = String((ctx.body || {}).channelId || "");
  if (!channelId) throw bad("Escolha um canal de voz.");
  const ch = (await voiceContext(me, channelId)).ch;

  /* alguém que acabou de ser removido/bloqueado não entra de novo
     antes do prazo — validado AQUI, não no botão do cliente */
  const mod = await readVoiceMod(me.id, ch.id);
  if (mod && Number(mod.kickUntil) > now()) {
    throw forbidden(
      (mod.kickReason ? mod.kickReason + " — " : "") +
        "Você não pode entrar nesta sala de voz por mais " +
        Math.ceil((Number(mod.kickUntil) - now()) / 60000) + " minuto(s)."
    );
  }
  /* entrada limpa: o estado de moderação desta sala começa do zero */
  if (mod) {
    try {
      await writeVoiceMod(me.id, ch.id, {
        kickUntil: null, kickBy: null, kickReason: null,
        mute: null, muteBy: null, muteAt: null, muteReason: null,
      });
    } catch (e) {}
  }

  /* uma sala por vez: sai de qualquer outra antes */
  try {
    await db.remove("voice", { where: { user_id: me.id } });
  } catch (e) {
    /* sem linha anterior: segue */
  }

  const at = now();
  await db.insert("voice", {
    serverId: ch.serverId,
    channelId: ch.id,
    userId: me.id,
    muted: false,
    deafened: false,
    camera: false,
    screenShare: false,
    joinedAt: at,
    updatedAt: at,
  });
  voiceServersCache.at = 0; /* servidor novo: próxima leitura refaz a lista */
  gcVoice();
  return {
    data: {
      serverId: ch.serverId,
      channelId: ch.id,
      userId: me.id,
      muted: false,
      deafened: false,
      camera: false,
      screenShare: false,
      joinedAt: at,
      updatedAt: at,
    },
  };
}

async function leaveVoice(ctx) {
  const me = await auth.requireUser(ctx.event);
  try {
    await db.remove("voice", { where: { user_id: me.id } });
  } catch (e) {
    /* já fora */
  }
  return { data: true };
}

/* ==================== moderação da sala ====================
   A sala é MESH (RTCPeerConnection no cliente): o servidor nunca
   vê o áudio/vídeo, então não existe "corte" físico do microfone
   de terceiros. O que o servidor faz — e é o que vale aqui — é:
     · gravar o estado de moderação de forma AUTORITATIVA, em
       `prefs.data.voiceMod[canalId]` do alvo (mesmo lugar onde a
       chamada 1:1 já guarda `calls` e `signal`);
     · remover/remover-acesso na presença real (tabela `voice`);
     · avisar o alvo com um sinal de sistema que o cliente dele
       não consegue forjar (o cliente só pode empurrar "offer",
       "answer", "candidate", "media" e "bye").
   Silenciar por moderação NÃO é o mesmo que "microfone desligado":
   a UI distingue os dois, e o alvo continua com estado próprio. */

const VOICE_MOD_MAX_KICK = 60 * 60 * 1000;  /* bloqueio temporário: 1h no máximo */
const VOICE_MOD_MIN_KICK = 10 * 1000;       /* e no mínimo 10s */
const VOICE_MOD_GRACE = 2 * 60 * 1000;      /* "remover" segura a reentrada 2 min */
const SYSTEM_FROM = "nexo";                 /* remetente que não é membro */
/* estado de moderação + regra de privacidade de quem está na sala.
   Uma única leitura em lote de prefs (mais barata que uma por linha):
   devolve o mapa de moderação e quem deve ficar OCULTO para o viewer
   (privacidade "Ativo agora": todos/amigos/ninguém + quem está offline). */
const VOICE_MOD_SNAPSHOT_MAX = 150;         /* leitura de prefs por peek */

function voiceModMap(prefs) {
  return prefs && prefs.voiceMod && typeof prefs.voiceMod === "object" ? prefs.voiceMod : null;
}

async function readVoiceMod(userId, channelId) {
  try {
    const prefs = await db.readPrefs(userId);
    const map = voiceModMap(prefs);
    const v = map ? map[channelId] : null;
    return v && typeof v === "object" ? v : null;
  } catch (e) {
    return null;
  }
}

/* grava/apaga o estado de moderação de UM canal para UMA pessoa,
   sem crescer sem limite e sem deixar entradas vazias */
async function writeVoiceMod(userId, channelId, patch) {
  /* sob a trava do usuário: uma moderação no mesmo instante de um
     sinal de WebRTC não pode apagar o sinal recém-gravado */
  return db.lockPrefs(userId, async () => {
    const prefs = await db.readPrefs(userId);
    const map = voiceModMap(prefs) || {};
    const cur = map[channelId] && typeof map[channelId] === "object" ? map[channelId] : {};
    const next = Object.assign({}, cur, patch || {});
    Object.keys(next).forEach(function (k) {
      if (next[k] === null || next[k] === undefined || next[k] === "") delete next[k];
    });
    if (Object.keys(next).length) map[channelId] = next;
    else delete map[channelId];
    prefs.voiceMod = map;
    await db.writePrefs(userId, prefs);
    return next;
  });
}

/* quão alto alguém está no servidor — usado para impedir que um
   moderador se aproveite de alguém acima dele */
function modRank(sctx, userId) {
  if (acl.isOwner(sctx, userId)) return 4;
  const p = acl.effectivePerms(sctx, userId);
  if (p.administrator) return 3;
  if (p.manageServer || p.manageRoles || p.manageChannels) return 2;
  if (p.kickMembers || p.muteMembers) return 1;
  return 0;
}

/* valida identidade + participação + permissão + hierarquia.
   Isto roda SEMPRE no servidor: esconder o botão não protege nada. */
async function requireModerator(sctx, meId, targetId, perm, message) {
  if (meId === targetId) throw bad("Você não pode aplicar esta ação em si mesmo.");
  acl.requirePerm(sctx, meId, perm, message);
  if (acl.isOwner(sctx, targetId))
    throw forbidden("O dono do servidor não pode ser moderado por aqui.");
  if (modRank(sctx, meId) < modRank(sctx, targetId))
    throw forbidden("Esta pessoa tem mais permissões que você no servidor.");
  const row = await voiceRowByUser(targetId);
  if (!row) throw notFound("Esta pessoa não está mais nesta sala de voz.");
  return row;
}

async function voiceRowByUser(userId) {
  try {
    const rows = await db.select("voice", { where: { user_id: userId }, limit: 1 });
    return (rows && rows[0]) || null;
  } catch (e) {
    return null;
  }
}

/* sinal de sistema entregue ao ALVO (não a um participante).
   O cliente trata "moderation" e sai/ajusta sozinho. */
async function pushSystemSignal(toUserId, channelId, payload) {
  const prefs = await db.readPrefs(toUserId);
  if (!prefs.signal || typeof prefs.signal !== "object") prefs.signal = {};
  const key = ROOM_SIGNAL + channelId + ":" + SYSTEM_FROM;
  const queue = prefs.signal[key] || [];
  queue.push({ kind: "moderation", payload: payload, from: SYSTEM_FROM, at: now() });
  trimQueue(queue);
  prefs.signal[key] = queue;
  await db.writePrefs(toUserId, prefs);
}

function modPayload(action, extra) {
  return String(JSON.stringify(Object.assign({ action: action, at: now() }, extra || {})));
}

async function dropFromRoom(row) {
  try {
    await db.remove("voice", { where: { server_id: row.serverId, user_id: row.userId } });
  } catch (e) {
    /* sem linha: segue */
  }
  try {
    await pushSystemSignal(row.userId, row.channelId, modPayload("removed"));
  } catch (e) {
    /* sem sinal, a presença já saiu do snapshot e o outro lado some */
  }
}

/* POST /voice/moderate  { channelId, userId, action, durationMs?, reason? }
   action: "kick" | "timeout" | "mute" | "unmute" | "end" */
async function moderateVoice(ctx) {
  const me = await auth.requireUser(ctx.event);
  const body = ctx.body || {};
  const channelId = String(body.channelId || "");
  const targetId = String(body.userId || "");
  const action = String(body.action || "");
  const reason = String(body.reason || "").slice(0, 200);

  if (!channelId) throw bad("Escolha um canal de voz.");
  const vc = await voiceContext(me, channelId);

  if (action === "end") {
    /* encerrar a sala exige controlar o canal, não só moderar membros */
    acl.requirePerm(vc.sctx, me.id, "manageChannels", "Você não pode encerrar esta sala de voz.");
    const rows = (await db.select("voice", { where: { channel_id: channelId }, limit: 500 })) || [];
    if (!rows.length) throw bad("Esta sala já está vazia.");
    for (const r of rows) {
      if (r.userId !== me.id) await dropFromRoom(r);
      else {
        try {
          await db.remove("voice", { where: { server_id: r.serverId, user_id: r.userId } });
        } catch (e) {}
      }
    }
    return { data: { action: "end", channelId: channelId, removed: rows.length } };
  }

  if (!targetId) throw bad("Escolha quem você quer moderar.");
  if (targetId === me.id) throw bad("Você não pode aplicar esta ação em si mesmo.");

  if (action === "kick" || action === "timeout") {
    const row = await requireModerator(
      vc.sctx, me.id, targetId, "kickMembers",
      "Você não tem permissão para remover pessoas da sala de voz."
    );
    let until = now() + VOICE_MOD_GRACE;
    if (action === "timeout") {
      const raw = Number(body.durationMs);
      if (!isFinite(raw) || raw <= 0) throw bad("Informe por quanto tempo a pessoa fica impedida.");
      const dur = Math.max(VOICE_MOD_MIN_KICK, Math.min(VOICE_MOD_MAX_KICK, Math.round(raw)));
      until = now() + dur;
    }
    await writeVoiceMod(targetId, channelId, {
      kickUntil: until,
      kickBy: me.id,
      kickReason: reason,
    });
    await dropFromRoom(row);
    return {
      data: {
        action: action,
        channelId: channelId,
        userId: targetId,
        kickUntil: until,
        reason: reason,
      },
    };
  }

  if (action === "mute" || action === "unmute") {
    const row = await requireModerator(
      vc.sctx, me.id, targetId, "muteMembers",
      "Você não tem permissão para silenciar pessoas na sala de voz."
    );
    if (action === "mute") {
      await writeVoiceMod(targetId, channelId, { mute: true, muteBy: me.id, muteAt: now(), muteReason: reason });
    } else {
      await writeVoiceMod(targetId, channelId, { mute: null, muteBy: null, muteAt: null, muteReason: null });
    }
    try {
      await pushSystemSignal(
        targetId,
        channelId,
        modPayload(action === "mute" ? "muted" : "unmuted", { reason: reason, by: me.id })
      );
    } catch (e) {}
    /* a presença continua — só o estado de mídia muda */
    return { data: { action: action, channelId: channelId, userId: targetId, row: row, reason: reason } };
  }

  throw bad("Ação de moderação inválida.");
}

/* estado de moderação + regra de privacidade de quem está na sala
   (para o snapshot): uma leitura em lote de prefs, presença e amizade */
async function voiceMetaOfSnapshot(rows, viewerId) {
  const out = { mod: {}, hidden: {} };
  /* a MINHA sala: quem está comigo no mesmo canal já me ouve e me vê
     (a sala inteira é visível para si mesma) — a privacidade da
     "Ativo agora" vale para os demais canais, nunca para a call em
     que estou, senão o cliente derrubaria conexões a cada peek */
  const myRoom = ((rows || []).find((r) => r.userId === viewerId) || {}).channelId || null;
  const live = (rows || []).slice(0, VOICE_MOD_SNAPSHOT_MAX);
  /* acima do teto não dá para avaliar privacidade: some em vez de vazar */
  (rows || []).slice(VOICE_MOD_SNAPSHOT_MAX).forEach((r) => {
    if (r.userId !== viewerId && !(myRoom && r.channelId === myRoom))
      out.hidden[r.userId] = true;
  });
  const ids = [];
  live.forEach((r) => {
    if (ids.indexOf(r.userId) === -1) ids.push(r.userId);
  });
  if (!ids.length) return out;

  try {
    const prefsRows = (await db.select("prefs", { where: { user_id: ids }, limit: ids.length + 5 })) || [];
    const dataBy = {};
    prefsRows.forEach((p) => {
      const uid = p.userId || p.user_id; /* db.select devolve formato app (camel) */
      const d = map.parseJSON(p.data, null) || {};
      delete d.sessions; /* nunca vira estado de voz */
      dataBy[uid] = d;
    });

    /* quem é amigo de quem (2 consultas por peek) */
    const frA = (await db.select("friendships", { where: { user_a_id: viewerId }, limit: 2000 })) || [];
    const frB = (await db.select("friendships", { where: { user_b_id: viewerId }, limit: 2000 })) || [];
    const friends = {};
    frA.concat(frB).forEach((f) => {
      const other = f.userAId === viewerId ? f.userBId : f.userAId;
      if (other) friends[other] = true;
    });

    /* presença real: quem está offline não aparece como "em call" */
    const offline = {};
    try {
      const pres = (await db.select("presence", { where: { user_id: ids }, limit: ids.length + 5 })) || [];
      pres.forEach((p) => {
        if (p.status === "offline") offline[p.userId || p.user_id] = true;
      });
    } catch (e) {
      /* sem presença: não esconde ninguém por aqui */
    }

    live.forEach((r) => {
      const d = dataBy[r.userId] || {};
      const vmap = voiceModMap(d);
      const v = vmap ? vmap[r.channelId] : null;
      if (v && typeof v === "object" && (v.mute || v.kickUntil)) out.mod[r.userId] = v;

      /* privacidade da atividade vale para OS OUTROS canais: a própria
         linha sempre aparece para si (e é renovada no snapshot), e a
         minha sala aparece inteira — quem está nela já está me ouvindo */
      if (r.userId === viewerId) return;
      if (myRoom && r.channelId === myRoom) return;
      const mode = ((d.privacy || {}).voiceActivity) || "all";
      if (offline[r.userId]) out.hidden[r.userId] = true;
      else if (mode === "none") out.hidden[r.userId] = true;
      else if (mode === "friends" && !friends[r.userId]) out.hidden[r.userId] = true;
    });
  } catch (e) {
    /* sem meta: mantém o estado de moderação vazio (comportamento antigo) */
  }
  return out;
}

/* sinalização entre quem está na MESMA sala (mesmo caminho de
   prefs.signal do 1:1, só que por sala e por destinatário) */
async function pushRoomSignal(ctx) {
  const me = await auth.requireUser(ctx.event);
  const body = ctx.body || {};
  const channelId = String(body.channelId || "");
  const to = String(body.to || "");
  const kind = String(body.kind || "");
  if (["offer", "answer", "candidate", "media", "bye"].indexOf(kind) === -1)
    throw bad("Sinal inválido.");
  if (!to) throw bad("Destinatário ausente.");
  if (to === me.id) throw bad("Este sinal é para você mesmo.");

  const ch = (await voiceContext(me, channelId)).ch;
  if (!(await voiceRow(ch.id, me.id))) throw forbidden("Você não está nesta sala de voz.");
  /* anti-IDOR: só quem TAMBÉM está na sala pode receber sinal */
  if (!(await voiceRow(ch.id, to))) throw forbidden("Esta pessoa não está nesta sala de voz.");

  const payload = String(body.payload || "");
  if (payload.length > SIGNAL_ONE) throw bad("Sinalização muito grande.");

  /* gravação da fila SOB a trava do destinatário: sem isto dois sinais
     no mesmo instante (media + offer, ou candidatos em rajada) liam o
     MESMO documento e a última gravação apagava a outra — a oferta
     WebRTC sumia com status 200 e a sala ficava "Conectando…" para
     sempre. Nenhuma validação muda: só a ordem das gravações. */
  await db.lockPrefs(to, async () => {
    const prefs = await db.readPrefs(to);
    if (!prefs.signal || typeof prefs.signal !== "object") prefs.signal = {};
    const key = ROOM_SIGNAL + ch.id + ":" + me.id;
    const queue = prefs.signal[key] || [];
    queue.push({ kind: kind, payload: payload, from: me.id, at: now() });
    trimQueue(queue);
    prefs.signal[key] = queue;
    await db.writePrefs(to, prefs);
  });
  return { data: true };
}

/* presença das salas de voz dos MEUS servidores + renovação da
   minha linha (sem isto, quem fica na sala sumiria da lista) */
async function voiceSnapshot(userId) {
  const ids = await voiceServersOf(userId);
  if (!ids.length) return [];
  const rows = (await db.select("voice", { where: { server_id: ids }, limit: 800 })) || [];
  const at = now();
  let mine = null;
  const live = [];
  rows.forEach(function (r) {
    if (r.userId === userId) mine = r;
    if (at - Number(r.updatedAt || 0) < VOICE_TTL) live.push(r);
  });
  if (mine && at - Number(mine.updatedAt || 0) >= VOICE_TOUCH_MS) {
    try {
      await db.update("voice", { where: { user_id: userId } }, { updatedAt: at });
      mine.updatedAt = at;
      if (live.indexOf(mine) === -1) live.push(mine);
    } catch (e) {
      /* sem renovação: a linha cai fora do TTL e o cliente sai da sala */
    }
  }

  /* estado de moderação (silenciado pela moderação / bloqueado) e
     privacidade "Ativo agora" — filtrado AQUI no servidor, nunca
     escondido só no cliente */
  let meta = { mod: {}, hidden: {} };
  try {
    meta = await voiceMetaOfSnapshot(live, userId);
  } catch (e) {
    meta = { mod: {}, hidden: {} };
  }
  const visible = live.filter((r) => r.userId === userId || !meta.hidden[r.userId]);

  return { rows: visible, mod: meta.mod };
}

function routes() {
  return [
    ["POST", "/calls", startCall],
    ["POST", "/calls/:id/respond", respondCall],
    ["POST", "/calls/:id/end", endCall],
    ["POST", "/calls/:id/signal", pushSignal],
    ["GET", "/calls/peek", peek],
    ["POST", "/voice/join", joinVoice],
    ["POST", "/voice/leave", leaveVoice],
    ["POST", "/voice/signal", pushRoomSignal],
    ["POST", "/voice/moderate", moderateVoice],
  ];
}

module.exports = { routes };
