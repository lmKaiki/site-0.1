"use strict";
/* ============================================================
   NEXO · server/handlers/custom
   Placas de nome + Pulsos + missões — tudo autorizado AQUI.

   Estado por usuário em prefs.data.custom (mesmo lugar onde já
   moram chamadas, lembretes, privacidade e vínculos): sem tabela
   nova, sem migração, sem tocar em autenticação, servidores,
   mensagens, amigos ou voz.

   Rotas:
     GET    /custom          estado + catálogo + missões
     POST   /custom/equip    equipar/remover (valida propriedade)
     POST   /custom/buy      comprar (saldo real, sem duplicar)
     POST   /custom/claim    resgatar missão (único, progresso real)
     PATCH  /custom          preferência de animações

   Fora de rota (chamado por servers.joinByInvite):
     recordInviteJoin        Conquistas do Brasil — grava a
                             entrada real confirmada pelo
                             convite e desbloqueia as placas
                             da coleção automaticamente.

   Toda mutação roda dentro de db.lockPrefs(userId): leituras e
   escritas do mesmo usuário ficam em fila, então compra dupla,
   resgate duplo e saldo negativo não têm como passar (mesma
   alavanca usada por chamadas de voz e lembretes).
   ============================================================ */

const db = require("../db");
const auth = require("../auth");
const { bad, conflict, forbidden, notFound } = require("../errors");
const C = require("../custom");

/* select tolerante: se uma consulta não existir no banco atual,
   a missão só fica com progresso 0 — nunca derruba a tela. */
async function safeSelect(table, where, limit) {
  try {
    const rows = await db.select(table, { where: where, limit: limit || 2000 });
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}

/* fatos reais do usuário — a ÚNICA fonte de progresso */
async function progressFacts(user) {
  const uid = user.id;

  const msgs = await safeSelect("messages", { authorId: uid }, 4000);
  const talk = msgs.filter(function (m) {
    return String((m && m.content) || "").trim().length >= 3;
  }).length;

  const frA = await safeSelect("friendships", { userAId: uid }, 2000);
  const frB = await safeSelect("friendships", { userBId: uid }, 2000);
  const servers = await safeSelect("servers", { ownerId: uid }, 500);
  const invites = await safeSelect("invites", { creatorId: uid }, 500);

  const bio = String(user.bio || "").trim();
  const avatar = user.avatar && typeof user.avatar === "object" ? user.avatar : {};
  const profile = bio.length >= 10 && (avatar.image || avatar.model) ? 1 : 0;

  return {
    talk: talk,
    friends: frA.length + frB.length,
    servers: servers.length,
    invites: invites.length,
    profile: profile,
    jornada: 0, /* preenchido depois: nº de missões base resgatadas */
  };
}

/* estado completo que o cliente desenha (loja, perfil, ajustes) */
async function buildState(user) {
  const prefs = await db.readPrefs(user.id);
  const c = C.normalize(prefs && prefs.custom);
  const facts = await progressFacts(user);

  const claimedBase = C.JORNADA_BASE.filter((id) => !!c.claimed[id]).length;
  facts.jornada = claimedBase;

  const missions = C.MISSIONS.map(function (m) {
    const progress = C.progressOf(m, facts);
    return {
      id: m.id,
      name: m.name,
      description: m.description,
      goal: m.goal,
      progress: progress,
      done: progress >= m.goal,
      claimed: !!c.claimed[m.id],
      reward: m.reward,
      deadline: m.deadline,
    };
  });

  /* Conquistas do Brasil 🇧🇷 — progresso = pessoas DISTINTAS que
     entraram num servidor pelo convite deste usuário (gravado
     por recordInviteJoin, em entrada real confirmada). */
  const brTiers = C.brasilTierState(c);
  const brasil = {
    invitees: C.brasilCount(c),
    tiers: brTiers,
    next: brTiers.find(function (t) {
      return !t.unlocked;
    }) || null,
  };

  return {
    currency: C.CURRENCY,
    balance: c.balance,
    equipped: c.equipped,
    animations: c.animations,
    owned: c.owned,
    claimed: c.claimed,
    catalog: C.catalog(),
    categories: C.CATEGORIES,
    missions: missions,
    brasil: brasil,
    serverTime: Date.now(),
  };
}

/* ============================================================
   Conquistas do Brasil 🇧🇷 · registro de ENTRADA CONFIRMADA
   ------------------------------------------------------------
   Chamado por servers.joinByInvite DEPOIS da entrada real ser
   criada, com o convite lido pelo servidor (nunca com dado do
   cliente). Grava em prefs de quem convidou (lockPrefs: linhas
   simultâneas do mesmo convidador ficam em fila, então a mesma
   pessoa nunca conta duas vezes e nenhuma entrada passa 2x).

   · auto-entrada (convidou a si mesmo) → nada;
   · mesma pessoa de novo → não conta de novo (chave = invitee);
   · ao cruzar uma meta de BRASIL_TIERS → placa entra em owned
     (desbloqueio automático, equipável na loja) e o chamador
     pode notificar.
   ============================================================ */
async function recordInviteJoin(inviterId, inviteeId, serverId, code) {
  if (!inviterId || !inviteeId) return null;
  if (String(inviterId) === String(inviteeId)) return null;
  /* só conta para uma conta que ainda existe */
  const owners = await safeSelect("users", { id: inviterId }, 1);
  if (!owners.length) return null;

  let out = null;
  await db.lockPrefs(inviterId, async function () {
    const prefs = await db.readPrefs(inviterId);
    const c = C.normalize(prefs && prefs.custom);
    const n0 = C.brasilCount(c);
    if (Object.prototype.hasOwnProperty.call(c.brInvitees, inviteeId)) {
      out = { count: n0, unlocked: [], already: true };
      return;
    }
    c.brInvitees[String(inviteeId)] = {
      serverId: serverId ? String(serverId) : "",
      at: Date.now(),
      code: code ? String(code) : "",
    };
    const n = n0 + 1;
    const unlocked = [];
    C.BRASIL_TIERS.forEach(function (t) {
      if (n >= t.goal && c.owned.indexOf(t.plateId) === -1) {
        c.owned.push(t.plateId);
        unlocked.push(t.plateId);
      }
    });
    prefs.custom = c;
    await db.writePrefs(inviterId, prefs);
    out = { count: n, unlocked: unlocked, already: false };
  });
  return out;
}

/* ---------------- rotas ---------------- */

async function getCustom(ctx) {
  const user = await auth.requireUser(ctx.event);
  return { data: await buildState(user) };
}

async function equip(ctx) {
  const user = await auth.requireUser(ctx.event);
  const body = ctx.body || {};
  const raw = body.plateId;
  const plateId = raw === null || raw === undefined || raw === "" ? null : String(raw);

  if (plateId !== null) {
    const plate = C.plateById(plateId);
    if (!plate) throw bad("Placa de nome não encontrada.");
    /* propriedade é conferida AQUI, nunca pelo cliente */
    const row = (await db.readPrefs(user.id)) || {};
    const c0 = C.normalize(row.custom);
    const free = plate.price === 0;
    if (!free && c0.owned.indexOf(plateId) === -1)
      throw forbidden("Esta placa ainda não é sua. Conquiste-a na loja ou em uma missão.");
  }

  await db.lockPrefs(user.id, async function () {
    const prefs = await db.readPrefs(user.id);
    const c = C.normalize(prefs.custom);
    c.equipped = plateId;
    prefs.custom = c;
    await db.writePrefs(user.id, prefs);
  });

  return { data: await buildState(user) };
}

async function buy(ctx) {
  const user = await auth.requireUser(ctx.event);
  const plateId = String((ctx.body || {}).plateId || "");
  const plate = C.plateById(plateId);
  if (!plate) throw bad("Placa de nome não encontrada.");
  if (plate.price === null)
    throw bad("Esta placa não é vendida: ela é recompensa de uma missão.");
  if (plate.price === 0)
    throw bad("Esta placa é gratuita — você já pode equipá-la.");

  await db.lockPrefs(user.id, async function () {
    const prefs = await db.readPrefs(user.id);
    const c = C.normalize(prefs.custom);
    if (c.owned.indexOf(plateId) > -1) throw conflict("Esta placa já é sua.");
    if (c.balance < plate.price)
      throw bad(
        "Saldo insuficiente: você tem " +
          c.balance +
          " Pulsos e esta placa custa " +
          plate.price +
          " Pulsos. Complete missões para ganhar mais."
      );
    c.balance -= plate.price; /* saldo nunca fica negativo */
    c.owned.push(plateId);
    prefs.custom = c;
    await db.writePrefs(user.id, prefs);
  });

  return { data: await buildState(user) };
}

async function claim(ctx) {
  const user = await auth.requireUser(ctx.event);
  const missionId = String((ctx.body || {}).missionId || "");
  const mission = C.missionById(missionId);
  if (!mission) throw notFound("Missão não encontrada.");

  await db.lockPrefs(user.id, async function () {
    /* fatos lidos dentro da trava: o resgate usa o estado real do
       banco na hora exata em que é gravado */
    const facts = await progressFacts(user);
    facts.jornada = 0;
    const prefs = await db.readPrefs(user.id);
    const c = C.normalize(prefs.custom);

    if (c.claimed[missionId]) throw conflict("Esta recompensa já foi resgatada.");

    if (missionId === "jornada") {
      facts.jornada = C.JORNADA_BASE.filter((id) => !!c.claimed[id]).length;
    }

    const progress = C.progressOf(mission, facts);
    if (progress < mission.goal)
      throw bad("Missão ainda não concluída. O progresso é verificado no servidor.");

    if (mission.reward && mission.reward.pulsos) c.balance += Number(mission.reward.pulsos) || 0;
    if (mission.reward && mission.reward.plate) {
      const pid = mission.reward.plate;
      if (C.plateById(pid) && c.owned.indexOf(pid) === -1) c.owned.push(pid);
    }
    c.claimed[missionId] = Date.now();

    prefs.custom = c;
    await db.writePrefs(user.id, prefs);
  });

  return { data: await buildState(user) };
}

async function updateCustom(ctx) {
  const user = await auth.requireUser(ctx.event);
  const body = ctx.body || {};
  if (body.animations !== undefined && typeof body.animations !== "boolean")
    throw bad("Preferência de animação inválida.");

  await db.lockPrefs(user.id, async function () {
    const prefs = await db.readPrefs(user.id);
    const c = C.normalize(prefs.custom);
    if (body.animations !== undefined) c.animations = body.animations;
    prefs.custom = c;
    await db.writePrefs(user.id, prefs);
  });

  return { data: await buildState(user) };
}

function routes() {
  return [
    ["GET", "/custom", getCustom],
    ["POST", "/custom/equip", equip],
    ["POST", "/custom/buy", buy],
    ["POST", "/custom/claim", claim],
    ["PATCH", "/custom", updateCustom],
  ];
}

module.exports = { routes, buildState, recordInviteJoin };
