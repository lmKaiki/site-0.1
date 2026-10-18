"use strict";
/* ============================================================
   NEXO · tools/test-voice.js
   Teste de ponta a ponta das salas de voz (sem navegador):
     node tools/test-voice.js
   Cria contas REAIS, um servidor com canal de voz e um cargo
   de moderação, e verifica que a moderação da sala é decidida
   NO SERVIDOR: identidade, participação, permissão e
   hierarquia. No final apaga tudo o que criou.
   ============================================================ */

process.env.NEXO_DB = process.env.NEXO_DB || "supabase";

const { register, dispatch } = require("../server/router");

register([
  require("../server/handlers/auth"),
  require("../server/handlers/social"),
  require("../server/handlers/servers"),
  require("../server/handlers/messages"),
  require("../server/handlers/sync"),
  require("../server/handlers/apps"),
  require("../server/handlers/calls"),
]);

let pass = 0;
let fail = 0;
const created = { users: [], servers: [] };

function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log("  [ok] " + label);
  } else {
    fail++;
    console.log("  [FAIL] " + label + (detail ? "  -> " + detail : ""));
  }
}

async function call(method, path, body, cookie, query) {
  const res = await dispatch({
    httpMethod: method,
    path: path.indexOf("/api") === 0 ? path : "/api" + path,
    queryStringParameters: query || {},
    headers: cookie ? { cookie: cookie } : {},
    body: body === undefined ? null : JSON.stringify(body),
    isBase64Encoded: false,
  });
  let json = {};
  try {
    json = JSON.parse(res.body);
  } catch (e) {}
  let setCookie = null;
  const sc = res.multiValueHeaders && res.multiValueHeaders["Set-Cookie"];
  if (sc && sc.length) setCookie = sc[0].split(";")[0];
  return { status: res.statusCode, json, cookie: setCookie };
}

function rnd(n) {
  return Math.random().toString(36).slice(2, 2 + (n || 6));
}

async function cleanup() {
  const db = require("../server/db");
  const ids = created.users.map((u) => u.id);
  if (!ids.length) return;
  for (const sid of created.servers) {
    await db.remove("voice", { where: { server_id: sid } }).catch(() => {});
    const chans = await db.select("channels", { where: { server_id: sid } }).catch(() => []);
    const chIds = (chans || []).map((c) => c.id);
    if (chIds.length) await db.remove("messages", { where: { channel_id: chIds } }).catch(() => {});
    await db.remove("channels", { where: { server_id: sid } }).catch(() => {});
    await db.remove("categories", { where: { server_id: sid } }).catch(() => {});
    await db.remove("roles", { where: { server_id: sid } }).catch(() => {});
    await db.remove("invites", { where: { server_id: sid } }).catch(() => {});
    await db.remove("logs", { where: { server_id: sid } }).catch(() => {});
    await db.remove("memberships", { where: { server_id: sid } }).catch(() => {});
    await db.remove("servers", { where: { id: sid } }).catch(() => {});
  }
  await db.remove("voice", { where: { user_id: ids } }).catch(() => {});
  await db.remove("friend_requests", { where: { sender_id: ids } }).catch(() => {});
  await db.remove("friend_requests", { where: { receiver_id: ids } }).catch(() => {});
  await db.remove("friendships", { where: { user_a_id: ids } }).catch(() => {});
  await db.remove("friendships", { where: { user_b_id: ids } }).catch(() => {});
  await db.remove("blocks", { where: { blocker_id: ids } }).catch(() => {});
  await db.remove("notifications", { where: { user_id: ids } }).catch(() => {});
  await db.remove("prefs", { where: { user_id: ids } }).catch(() => {});
  await db.remove("presence", { where: { user_id: ids } }).catch(() => {});
  await db.remove("sessions", { where: { user_id: ids } }).catch(() => {});
  await db.remove("users", { where: { id: ids } }).catch(() => {});
}

async function main() {
  const stamp = Date.now().toString(36);
  const nameA = ("a" + stamp + rnd(2)).slice(0, 18).replace(/[^a-z0-9._]/g, "");
  const nameB = ("b" + stamp + rnd(2)).slice(0, 18).replace(/[^a-z0-9._]/g, "");

  console.log("\n== 1. contas reais ==");
  const suA = await call("POST", "/auth/signup", {
    username: nameA, password: "Teste1234", confirm: "Teste1234",
  });
  ok("A criada", suA.status === 201, JSON.stringify(suA.json));
  const A = suA.json.data.user;
  const cA = suA.cookie;
  created.users.push(A);

  const suB = await call("POST", "/auth/signup", {
    username: nameB, password: "Teste1234", confirm: "Teste1234",
  });
  ok("B criada", suB.status === 201, JSON.stringify(suB.json));
  const B = suB.json.data.user;
  const cB = suB.cookie;
  created.users.push(B);

  console.log("\n== 2. servidor + canal de voz ==");
  const srv = await call("POST", "/servers", { name: "voicetest " + stamp }, cA);
  ok("servidor criado", srv.status < 300, JSON.stringify(srv.json));
  const sid = srv.json.data.id;
  created.servers.push(sid);

  const cat = await call(
    "POST", "/servers/" + sid + "/categories",
    { name: "Voz" }, cA
  );
  ok("categoria criada", cat.status < 300, JSON.stringify(cat.json));
  const catId = cat.json.data.category.id;

  const ch = await call(
    "POST", "/servers/" + sid + "/channels",
    { name: "geral-voz", type: "voice", categoryId: catId }, cA
  );
  ok("canal de voz criado", ch.status < 300, JSON.stringify(ch.json));
  const chId = ch.json.data.id;

  const inv = await call("POST", "/servers/" + sid + "/invites", {}, cA);
  ok("convite criado", inv.status < 300, JSON.stringify(inv.json));
  const code = inv.json.data.code;
  const joined = await call("POST", "/invites/" + code + "/join", {}, cB);
  ok("B entrou no servidor", joined.status < 300, JSON.stringify(joined.json));

  console.log("\n== 3. ambos na sala ==");
  const jA = await call("POST", "/voice/join", { channelId: chId }, cA);
  ok("A entrou na sala", jA.status < 300, JSON.stringify(jA.json));
  const jB = await call("POST", "/voice/join", { channelId: chId }, cB);
  ok("B entrou na sala", jB.status < 300, JSON.stringify(jB.json));

  const peekA = await call("GET", "/calls/peek", null, cA);
  const seats = (peekA.json.data.voice || []).filter((v) => v.channelId === chId);
  ok("snapshot mostra as duas pessoas", seats.length === 2, "achou " + seats.length);

  console.log("\n== 4. B (membro comum) não modera nada ==");
  const bKickA = await call("POST", "/voice/moderate", {
    channelId: chId, userId: A.id, action: "kick",
  }, cB);
  ok("B não pode remover A", bKickA.status >= 400, JSON.stringify(bKickA.json));

  const bMuteA = await call("POST", "/voice/moderate", {
    channelId: chId, userId: A.id, action: "mute",
  }, cB);
  ok("B não pode silenciar A", bMuteA.status >= 400, JSON.stringify(bMuteA.json));

  const bEnd = await call("POST", "/voice/moderate", {
    channelId: chId, action: "end",
  }, cB);
  ok("B não pode encerrar a sala", bEnd.status >= 400, JSON.stringify(bEnd.json));

  console.log("\n== 5. dono silencia e libera (autoridade no servidor) ==");
  const aMuteB = await call("POST", "/voice/moderate", {
    channelId: chId, userId: B.id, action: "mute",
  }, cA);
  ok("A silenciou B", aMuteB.status < 300, JSON.stringify(aMuteB.json));

  const peekB = await call("GET", "/calls/peek", null, cB);
  const modB = (peekB.json.data.voiceMod || {})[B.id];
  ok("B vê o próprio estado de silêncio (autoritativo)", !!(modB && modB.mute),
    JSON.stringify(modB));
  ok("o estado registra quem aplicou", modB && !!modB.muteBy, JSON.stringify(modB));

  const peekA2 = await call("GET", "/calls/peek", null, cA);
  const modAView = (peekA2.json.data.voiceMod || {})[B.id];
  ok("A também vê o silêncio de B", !!(modAView && modAView.mute), JSON.stringify(modAView));

  const stillThere = (peekB.json.data.voice || []).filter((v) => v.channelId === chId && v.userId === B.id);
  ok("silenciar NÃO remove da sala", stillThere.length === 1);

  const aUnmuteB = await call("POST", "/voice/moderate", {
    channelId: chId, userId: B.id, action: "unmute",
  }, cA);
  ok("A liberou o microfone de B", aUnmuteB.status < 300, JSON.stringify(aUnmuteB.json));
  const peekB2 = await call("GET", "/calls/peek", null, cB);
  const modB2 = (peekB2.json.data.voiceMod || {})[B.id];
  ok("silêncio limpo", !(modB2 && modB2.mute), JSON.stringify(modB2));

  console.log("\n== 6. hierarquia: dono não é removido por membro com cargo ==");
  const aKickSelf = await call("POST", "/voice/moderate", {
    channelId: chId, userId: A.id, action: "kick",
  }, cA);
  ok("A não se remove a si mesma", aKickSelf.status >= 400, JSON.stringify(aKickSelf.json));

  console.log("\n== 7. remover + impedir de entrar ==");
  const aKickB = await call("POST", "/voice/moderate", {
    channelId: chId, userId: B.id, action: "kick", reason: "teste de remoção",
  }, cA);
  ok("A removeu B da sala", aKickB.status < 300, JSON.stringify(aKickB.json));
  ok("resposta traz o prazo de bloqueio", !!(aKickB.json.data && aKickB.json.data.kickUntil));

  const peekA3 = await call("GET", "/calls/peek", null, cA);
  const seats3 = (peekA3.json.data.voice || []).filter((v) => v.channelId === chId);
  ok("B saiu da presença real", seats3.length === 1, "achou " + seats3.length);

  const rejoinB = await call("POST", "/voice/join", { channelId: chId }, cB);
  ok("B não entra de volta antes do prazo", rejoinB.status >= 400, JSON.stringify(rejoinB.json));
  ok("mensagem de bloqueio é honesta",
    JSON.stringify(rejoinB.json).indexOf("não pode entrar") > -1, JSON.stringify(rejoinB.json));

  console.log("\n== 8. bloqueio expira sozinho ==");
  const db = require("../server/db");
  const prefsB = await db.readPrefs(B.id);
  if (prefsB && prefsB.voiceMod && prefsB.voiceMod[chId]) {
    prefsB.voiceMod[chId].kickUntil = Date.now() - 1000;
    await db.writePrefs(B.id, prefsB);
  }
  const rejoinB2 = await call("POST", "/voice/join", { channelId: chId }, cB);
  ok("B entra de volta quando o prazo passa", rejoinB2.status < 300, JSON.stringify(rejoinB2.json));
  const peekB3 = await call("GET", "/calls/peek", null, cB);
  const modB3 = (peekB3.json.data.voiceMod || {})[B.id];
  ok("estado de moderação começa limpo ao entrar", !modB3, JSON.stringify(modB3));

  console.log("\n== 9. tempo máximo respeitado ==");
  const aTimeout = await call("POST", "/voice/moderate", {
    channelId: chId, userId: B.id, action: "timeout", durationMs: 99 * 60 * 60 * 1000,
  }, cA);
  ok("timeout aceito", aTimeout.status < 300, JSON.stringify(aTimeout.json));
  const until = aTimeout.json.data && aTimeout.json.data.kickUntil;
  const cap = 60 * 60 * 1000;
  ok("prazo cortado em 1 hora", !!until && until - Date.now() <= cap + 5000,
    "until=" + until + " agora=" + Date.now());

  console.log("\n== 10. encerrar a sala ==");
  const aEnd = await call("POST", "/voice/moderate", {
    channelId: chId, action: "end",
  }, cA);
  ok("A encerrou a sala", aEnd.status < 300, JSON.stringify(aEnd.json));

  const peekA4 = await call("GET", "/calls/peek", null, cA);
  const seats4 = (peekA4.json.data.voice || []).filter((v) => v.channelId === chId);
  ok("sala vazia depois de encerrar", seats4.length === 0, "achou " + seats4.length);

  console.log("\n== 11. IDOR: sem sessão não há moderação ==");
  const anon = await call("POST", "/voice/moderate", {
    channelId: chId, userId: B.id, action: "kick",
  });
  ok("sem sessão é recusado", anon.status >= 400, JSON.stringify(anon.json));

  const otherCh = await call("POST", "/voice/moderate", {
    channelId: "ch_inexistente", userId: B.id, action: "kick",
  }, cA);
  ok("canal inexistente é recusado", otherCh.status >= 400, JSON.stringify(otherCh.json));

  console.log("\n== 12. moderador: pode moderar abaixo, não acima ==");
  /* dá a B permissão de moderar (cargo "Moderação").
     Um cargo não-padrão SUBSTITUI as permissões do cargo padrão,
     então ele precisa declarar também o básico (ver/entrar). */
  const role = await call("POST", "/servers/" + sid + "/roles", {
    name: "Moderação " + stamp,
    permissions: { viewChannels: true, joinVoice: true, kickMembers: true, muteMembers: true },
  }, cA);
  ok("cargo de moderação criado", role.status < 300, JSON.stringify(role.json));
  const roleId = role.json.data.id;

  const setRole = await call(
    "PATCH", "/servers/" + sid + "/members/" + B.id, { roleId: roleId }, cA
  );
  ok("cargo aplicado em B", setRole.status < 300, JSON.stringify(setRole.json));

  /* C: terceira conta, membro comum — alvo legítimo para a moderação de B */
  const nameC = ("c" + stamp + rnd(2)).slice(0, 18).replace(/[^a-z0-9._]/g, "");
  const suC = await call("POST", "/auth/signup", {
    username: nameC, password: "Teste1234", confirm: "Teste1234",
  });
  ok("C criada", suC.status === 201, JSON.stringify(suC.json));
  const C = suC.json.data.user;
  const cC = suC.cookie;
  created.users.push(C);
  const joinC = await call("POST", "/invites/" + code + "/join", {}, cC);
  ok("C entrou no servidor", joinC.status < 300, JSON.stringify(joinC.json));

  await call("POST", "/voice/join", { channelId: chId }, cA);
  await call("POST", "/voice/join", { channelId: chId }, cB);
  await call("POST", "/voice/join", { channelId: chId }, cC);

  const modKickOwner = await call("POST", "/voice/moderate", {
    channelId: chId, userId: A.id, action: "kick",
  }, cB);
  ok("moderador NÃO remove o dono", modKickOwner.status >= 400, JSON.stringify(modKickOwner.json));

  const modMuteOwner = await call("POST", "/voice/moderate", {
    channelId: chId, userId: A.id, action: "mute",
  }, cB);
  ok("moderador NÃO silencia o dono", modMuteOwner.status >= 400, JSON.stringify(modMuteOwner.json));

  const modEnd = await call("POST", "/voice/moderate", {
    channelId: chId, action: "end",
  }, cB);
  ok("moderador sem manageChannels NÃO encerra a sala", modEnd.status >= 400, JSON.stringify(modEnd.json));

  const modKickC = await call("POST", "/voice/moderate", {
    channelId: chId, userId: C.id, action: "kick",
  }, cB);
  ok("moderador remove um membro comum", modKickC.status < 300, JSON.stringify(modKickC.json));

  const peekC = await call("GET", "/calls/peek", null, cC);
  const seatsC = (peekC.json.data.voice || []).filter(
    (v) => v.channelId === chId && v.userId === C.id
  );
  ok("C saiu da presença real", seatsC.length === 0, "achou " + seatsC.length);

  const modMuteC = await call("POST", "/voice/moderate", {
    channelId: chId, userId: C.id, action: "mute",
  }, cB);
  ok("moderador NÃO silencia quem já está fora", modMuteC.status >= 400, JSON.stringify(modMuteC.json));

  console.log("\n== 13. Ativo agora: privacidade da atividade de voz ==");
  const seatsOf = (peek, uid) =>
    (peek.json.data.voice || []).filter(
      (v) => v.channelId === chId && (!uid || v.userId === uid)
    );
  const peekAs = (cookie) => call("GET", "/calls/peek", null, cookie);

  /* o timeout da seção 9 ainda vale: expira o prazo (igual à seção 8) */
  const prefsB13 = await db.readPrefs(B.id);
  if (prefsB13 && prefsB13.voiceMod && prefsB13.voiceMod[chId]) {
    prefsB13.voiceMod[chId].kickUntil = Date.now() - 1000;
    await db.writePrefs(B.id, prefsB13);
  }
  const rejoin13 = await call("POST", "/voice/join", { channelId: chId }, cB);
  ok("B entrou de novo na sala", rejoin13.status < 300, JSON.stringify(rejoin13.json));

  /* A e B estão na sala; C ficou de fora (expulso na seção 12) */
  const vDef = await peekAs(cA);
  ok("padrão 'todos': A vê B na call", seatsOf(vDef, B.id).length === 1,
    "achou " + seatsOf(vDef, B.id).length);

  /* --- Ativo agora = ninguém (a PRÓPRIA sala nunca é escondida) --- */
  const privNone = await call("PATCH", "/profile", { privacy: { voiceActivity: "none" } }, cB);
  ok("B salva Ativo agora = ninguém",
    privNone.status < 300 && ((privNone.json.data || {}).privacy || {}).voiceActivity === "none",
    JSON.stringify(privNone.json));
  await peekAs(cB); /* renova a linha de B */
  const vNoneIn = await peekAs(cA);
  ok("'ninguém': A (na mesma sala) ainda vê B — a call não se esconde",
    seatsOf(vNoneIn, B.id).length === 1, "achou " + seatsOf(vNoneIn, B.id).length);
  const vSelf = await peekAs(cB);
  ok("B ainda vê a própria linha", seatsOf(vSelf, B.id).length === 1,
    "achou " + seatsOf(vSelf, B.id).length);
  const vNoneOut = await peekAs(cC);
  ok("'ninguém': C (fora da sala) não vê B", seatsOf(vNoneOut, B.id).length === 0,
    "achou " + seatsOf(vNoneOut, B.id).length);

  /* --- FORA da sala a privacidade continua valendo por inteiro --- */
  const leaveA13 = await call("POST", "/voice/leave", {}, cA);
  ok("A saiu da sala", leaveA13.status < 300, JSON.stringify(leaveA13.json));
  const vNoneOutA = await peekAs(cA);
  ok("'ninguém': A (fora da sala) não vê B", seatsOf(vNoneOutA, B.id).length === 0,
    "achou " + seatsOf(vNoneOutA, B.id).length);

  /* --- Ativo agora = só amigos (sem amizade ainda) --- */
  const privFr = await call("PATCH", "/profile", { privacy: { voiceActivity: "friends" } }, cB);
  ok("B salva Ativo agora = só amigos",
    privFr.status < 300 && ((privFr.json.data || {}).privacy || {}).voiceActivity === "friends",
    JSON.stringify(privFr.json));
  await peekAs(cB);
  const vFr1 = await peekAs(cA);
  ok("'só amigos' sem amizade: A (fora) não vê B",
    seatsOf(vFr1, B.id).length === 0, "achou " + seatsOf(vFr1, B.id).length);
  const vFr1c = await peekAs(cC);
  ok("'só amigos' sem amizade: C (fora) não vê B",
    seatsOf(vFr1c, B.id).length === 0, "achou " + seatsOf(vFr1c, B.id).length);

  /* --- fazem amizade e a visão volta --- */
  const frReq = await call("POST", "/friends/request", { userId: B.id }, cA);
  ok("A pediu amizade de B", frReq.status === 201, JSON.stringify(frReq.json));
  const frAcc = await call("POST", "/friends/accept", { requestId: (frReq.json.data || {}).id }, cB);
  ok("B aceitou a amizade", frAcc.status < 300, JSON.stringify(frAcc.json));
  await peekAs(cB);
  const vFr2 = await peekAs(cA);
  ok("'só amigos' COM amizade: A (fora) vê B de novo",
    seatsOf(vFr2, B.id).length === 1, "achou " + seatsOf(vFr2, B.id).length);
  const vFr2c = await peekAs(cC);
  ok("'só amigos' sem ser amigo: C (fora) continua sem ver B",
    seatsOf(vFr2c, B.id).length === 0, "achou " + seatsOf(vFr2c, B.id).length);

  /* --- offline some, online volta --- */
  const presOff = await call("POST", "/presence", { status: "offline" }, cB);
  ok("B ficou offline", presOff.status < 300, JSON.stringify(presOff.json));
  const vOff = await peekAs(cA);
  ok("offline: some da call mesmo com linha viva",
    seatsOf(vOff, B.id).length === 0, "achou " + seatsOf(vOff, B.id).length);
  const presOn = await call("POST", "/presence", { status: "online" }, cB);
  ok("B voltou a ficar online", presOn.status < 300, JSON.stringify(presOn.json));
  await peekAs(cB); /* renova a linha antes de checar */
  const vOn = await peekAs(cA);
  ok("online de novo: A vê B", seatsOf(vOn, B.id).length === 1,
    "achou " + seatsOf(vOn, B.id).length);

  /* --- restaura o padrão e sai da sala --- */
  const privBack = await call("PATCH", "/profile", { privacy: { voiceActivity: "all" } }, cB);
  ok("B restaurou o padrão (todos)",
    privBack.status < 300 && ((privBack.json.data || {}).privacy || {}).voiceActivity === "all",
    JSON.stringify(privBack.json));
  await call("POST", "/voice/leave", {}, cB);

  await cleanup();
  console.log("\n---------------------------------------------");
  console.log("  pass=" + pass + "  fail=" + fail);
  console.log("---------------------------------------------\n");
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("erro no teste:", e && e.stack ? e.stack : e);
  try { await cleanup(); } catch (e2) {}
  process.exit(1);
});
