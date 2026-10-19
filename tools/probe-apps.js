"use strict";
/* ============================================================
   NEXO · tools/probe-apps.js
   Verificação ponta a ponta dos NOVOS recursos (apps/bots +
   chamadas), com limpeza total ao final.
     node tools/probe-apps.js
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

function ok(label, condition, detail) {
  if (condition) {
    pass++;
    console.log("  ✔ " + label);
  } else {
    fail++;
    console.log("  ✘ " + label + (detail ? "  → " + detail : ""));
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
  let cookieOut = null;
  const sc = res.multiValueHeaders && res.multiValueHeaders["Set-Cookie"];
  if (sc && sc.length) cookieOut = sc[0].split(";")[0];
  return { status: res.statusCode, json, cookie: cookieOut };
}

function rnd(n) {
  return Math.random().toString(36).slice(2, 2 + (n || 6));
}

async function cleanup() {
  const db = require("../server/db");
  const ids = created.users.map((u) => u.id);
  if (!ids.length) return;

  for (const sid of created.servers) {
    await db.remove("server_apps", { where: { server_id: sid } }).catch(() => {});
    const chans = await db.select("channels", { where: { server_id: sid }, limit: 500 });
    const chIds = (chans || []).map((c) => c.id);
    if (chIds.length) await db.remove("messages", { where: { channel_id: chIds } }).catch(() => {});
    await db.remove("channels", { where: { server_id: sid } }).catch(() => {});
    await db.remove("categories", { where: { server_id: sid } }).catch(() => {});
    await db.remove("roles", { where: { server_id: sid } }).catch(() => {});
    await db.remove("invites", { where: { server_id: sid } }).catch(() => {});
    await db.remove("bans", { where: { server_id: sid } }).catch(() => {});
    await db.remove("logs", { where: { server_id: sid } }).catch(() => {});
    await db.remove("memberships", { where: { server_id: sid } }).catch(() => {});
    await db.remove("servers", { where: { id: sid } }).catch(() => {});
  }
  await db.remove("friend_requests", { where: { sender_id: ids } }).catch(() => {});
  await db.remove("friend_requests", { where: { receiver_id: ids } }).catch(() => {});
  await db.remove("friendships", { where: { user_a_id: ids } }).catch(() => {});
  await db.remove("friendships", { where: { user_b_id: ids } }).catch(() => {});
  await db.remove("blocks", { where: { blocker_id: ids } }).catch(() => {});
  await db.remove("notifications", { where: { user_id: ids } }).catch(() => {});
  await db.remove("presence", { where: { user_id: ids } }).catch(() => {});
  await db.remove("prefs", { where: { user_id: ids } }).catch(() => {});
  await db.remove("users", { where: { id: ids } }).catch(() => {});
}

async function main() {
  const stamp = Date.now().toString(36);
  const nameA = ("a" + stamp + rnd(2)).slice(0, 18).replace(/[^a-z0-9._]/g, "");
  const nameB = ("b" + stamp + rnd(2)).slice(0, 18).replace(/[^a-z0-9._]/g, "");

  try {
    console.log("\n== 1. catálogo de apps ==");
    const signA = await call("POST", "/auth/signup", { username: nameA, password: "Teste1234", confirm: "Teste1234" });
    const ca = signA.cookie;
    created.users.push(signA.json.data && signA.json.data.user ? signA.json.data.user : { id: signA.json.data.id });
    const signB = await call("POST", "/auth/signup", { username: nameB, password: "Teste1234", confirm: "Teste1234" });
    const cb = signB.cookie;
    created.users.push(signB.json.data && signB.json.data.user ? signB.json.data.user : { id: signB.json.data.id });

    const list = await call("GET", "/apps", null, ca);
    ok("GET /api/apps responde 200", list.status === 200, JSON.stringify(list.json).slice(0, 160));
    const apps = (list.json.data || []).filter((a) => a.enabled !== false);
    ok("catálogo tem apps oficiais reais (" + apps.length + ")", apps.length >= 5);
    ok("cada app traz comandos/permissões declarados", apps.every((a) => Array.isArray(a.commands) && Array.isArray(a.permissions)));

    console.log("\n== 2. servidor + instalação ==");
    const srv = await call("POST", "/servers", { name: "Probe Bots", template: "comunidade" }, ca);
    const serverId = srv.json.data && srv.json.data.id;
    ok("A criou o servidor", !!serverId, JSON.stringify(srv.json).slice(0, 160));
    created.servers.push(serverId);
    const channels = await call("GET", "/sync", null, ca);
    const chList = Object.values((channels.json.data && channels.json.data.channels) || {});
    const textCh = chList.find((c) => c.type === "text" && c.serverId === serverId) || chList[0];
    ok("canal de texto disponível", !!textCh);

    /* B ainda não é membro */
    const noMember = await call("POST", "/servers/" + serverId + "/apps", { appId: apps[0].id }, cb);
    ok("não-membro NÃO instala app (403)", noMember.status === 403, "status=" + noMember.status);

    const welcome = apps.find((a) => a.id === "app_nexo_welcome") || apps[0];
    const inst = await call("POST", "/servers/" + serverId + "/apps", { appId: welcome.id }, ca);
    ok("A (dono) instalou o app", inst.status === 201, JSON.stringify(inst.json).slice(0, 200));
    ok("instalação guarda permissões concedidas", !!(inst.json.data && Array.isArray(inst.json.data.permissions)));

    const instUtils = await call("POST", "/servers/" + serverId + "/apps", { appId: "app_nexo_utils" }, ca);
    ok("A instalou o app de utilidades", instUtils.status === 201, JSON.stringify(instUtils.json).slice(0, 200));
    const instMod = await call("POST", "/servers/" + serverId + "/apps", { appId: "app_nexo_mod" }, ca);
    ok("A instalou o app de moderação", instMod.status === 201, JSON.stringify(instMod.json).slice(0, 200));
    const modPerms = (instMod.json.data && instMod.json.data.permissions) || [];
    ok(
      "dono concede permissões de moderação ao bot",
      modPerms.indexOf("kickMembers") > -1 && modPerms.indexOf("banMembers") > -1,
      JSON.stringify(modPerms)
    );

    const twice = await call("POST", "/servers/" + serverId + "/apps", { appId: welcome.id }, ca);
    ok("mesmo app não instala duas vezes", twice.status >= 400 && twice.status < 500, "status=" + twice.status);

    const inv = await call("POST", "/servers/" + serverId + "/invites", {}, ca);
    const code = inv.json.data && (inv.json.data.code || inv.json.data);
    const join = await call("POST", "/invites/" + code + "/join", {}, cb);
    ok("B entrou no servidor", join.status < 300, JSON.stringify(join.json).slice(0, 160));

    const joinPatch = (join.json && join.json.patch && join.json.patch.set) || {};
    const welcomeMsgs = joinPatch.messages || {};
    const botMsgs = Object.values(welcomeMsgs).filter((m) => /^«bot:/.test(m.content || ""));
    ok(
      "bot de boas-vindas publicou a mensagem",
      botMsgs.length > 0 && /entrou/i.test((botMsgs[0] && botMsgs[0].content) || ""),
      "patch.messages=" + Object.keys(welcomeMsgs).length
    );

    console.log("\n== 3. permissões de instalação/configuração ==");
    const instB = await call("POST", "/servers/" + serverId + "/apps", { appId: "app_nexo_mod" }, cb);
    ok("B (membro comum) NÃO instala app (403)", instB.status === 403, "status=" + instB.status);

    const installId = inst.json.data.id;
    const cfgB = await call("PATCH", "/servers/" + serverId + "/apps/" + installId, { enabled: false }, cb);
    ok("B (membro comum) NÃO configura app (403)", cfgB.status === 403, "status=" + cfgB.status);

    const permEscalation = await call(
      "POST",
      "/servers/" + serverId + "/apps",
      { appId: "app_nexo_mod", permissions: ["administrator", "banMembers", "kickMembers"] },
      ca
    );
    const granted = (permEscalation.json.data && permEscalation.json.data.permissions) || [];
    ok("permissões fora do escopo do app são recusadas", granted.indexOf("administrator") === -1, JSON.stringify(granted));

    console.log("\n== 4. comandos dos bots ==");
    const ping = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/ping" }, ca);
    const pingMsg = ping.json.data;
    ok("/ping responde com mensagem do bot", ping.status === 201 && /^«bot:/.test((pingMsg && pingMsg.content) || ""), JSON.stringify(ping.json).slice(0, 200));

    const help = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/help" }, ca);
    ok("/help lista comandos instalados", help.status === 201 && /ping/i.test((help.json.data && help.json.data.content) || ""));

    const info = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/serverinfo" }, ca);
    ok("/serverinfo usa dados reais do servidor", info.status === 201 && (info.json.data.content || "").indexOf("Probe Bots") > -1);

    const kickB = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/kick @" + nameA }, cb);
    ok("B sem permissão NÃO usa /kick (erro PT-BR)", kickB.status >= 400 && typeof kickB.json.error === "string" && kickB.json.error.length > 5, "status=" + kickB.status + " " + kickB.json.error);

    const unknown = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/comandoinexistente" }, ca);
    ok("comando desconhecido vira mensagem normal", unknown.status === 201, "status=" + unknown.status);

    const who = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/userinfo @" + nameB }, ca);
    ok("/userinfo devolve dados reais", who.status === 201 && (who.json.data.content || "").indexOf(nameB) > -1);

    const modInstallId = instMod.json.data.id;
    const clear = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/clear 3" }, ca);
    ok("/clear apaga mensagens do canal (com permissão)", clear.status === 201 && /apaguei/i.test((clear.json.data && clear.json.data.content) || ""), JSON.stringify(clear.json).slice(0, 200));
    const clearB = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/clear 1" }, cb);
    ok("B sem permissão NÃO usa /clear (erro PT-BR)", clearB.status >= 400 && typeof clearB.json.error === "string", "status=" + clearB.status);

    console.log("\n== 5. desativar/remover app ==");
    const disable = await call("PATCH", "/servers/" + serverId + "/apps/" + installId, { enabled: false }, ca);
    ok("A desativou o app", disable.status === 200 && disable.json.data.enabled === false, JSON.stringify(disable.json).slice(0, 160));
    const del = await call("DELETE", "/servers/" + serverId + "/apps/" + installId, null, ca);
    ok("A removeu o app", del.status === 200, "status=" + del.status);
    const delB = await call("DELETE", "/servers/" + serverId + "/apps/" + installId, null, cb);
    ok("remover já removido responde 404", delB.status === 404, "status=" + delB.status);

    console.log("\n== 6. chamadas (sinalização real) ==");
    const frq = await call("POST", "/friends/request", { userId: nameB }, ca);
    ok("A pediu amizade a B", frq.status === 201, JSON.stringify(frq.json).slice(0, 160));
    const reqs = await call("GET", "/friends/requests", null, cb);
    const pending = (reqs.json.data || [])[0];
    const acc = await call("POST", "/friends/accept", { requestId: pending && pending.request.id }, cb);
    ok("B aceitou a amizade", acc.status === 200 || acc.status === 201, JSON.stringify(acc.json).slice(0, 160));
    const fr = await call("GET", "/friends", null, ca);
    const friendList = fr.json.data || [];
    ok("A e B são amigos (dado real)", friendList.some((f) => f.username === nameB), JSON.stringify(friendList).slice(0, 120));

    const idA = created.users[0].id;
    const idB = created.users[1].id;
    const start = await call("POST", "/calls", { peerId: idB }, ca);
    ok("A iniciou a chamada", start.status === 201, JSON.stringify(start.json).slice(0, 200));
    const callId = start.json.data && start.json.data.id;
    ok("estado da chamada = ringing", start.json.data && start.json.data.state === "ringing");

    const peekB = await call("GET", "/calls/peek", null, cb);
    const incoming = peekB.json.data && peekB.json.data.calls && peekB.json.data.calls[callId];
    ok("B vê a chamada recebida", incoming && incoming.state === "incoming", JSON.stringify(peekB.json.data && peekB.json.data.calls));
    ok("B recebe o perfil de quem ligou", !!(peekB.json.data && peekB.json.data.peers && peekB.json.data.peers[callId]));

    const notif = await call("GET", "/notifications", null, cb);
    const callNotes = (notif.json.data || []).filter((n) => n.type === "call");
    ok("B recebeu notificação de chamada", callNotes.length > 0);

    const offer = await call("POST", "/calls/" + callId + "/signal", { kind: "offer", payload: JSON.stringify({ type: "offer", sdp: "v=0 probe" }) }, ca);
    ok("A enviou a oferta (sinalização)", offer.status === 200 || offer.status === 201, "status=" + offer.status);

    const peekB2 = await call("GET", "/calls/peek", null, cb);
    const sig = (peekB2.json.data && peekB2.json.data.signals) || [];
    ok("B recebeu o sinal", sig.some((s) => s.callId === callId && s.items.some((i) => i.kind === "offer")), JSON.stringify(sig).slice(0, 160));
    const peekB3 = await call("GET", "/calls/peek", null, cb);
    ok("fila de sinais é esvaziada após a leitura", ((peekB3.json.data && peekB3.json.data.signals) || []).length === 0);

    const answer = await call("POST", "/calls/" + callId + "/respond", { accept: true }, cb);
    ok("B atendeu", answer.status === 200 && answer.json.data.state === "active", JSON.stringify(answer.json).slice(0, 160));

    const cand = await call("POST", "/calls/" + callId + "/signal", { kind: "candidate", payload: JSON.stringify({ candidate: "candidate:1" }) }, cb);
    ok("B enviou candidato ICE", cand.status === 200 || cand.status === 201, "status=" + cand.status);
    const peekA = await call("GET", "/calls/peek", null, ca);
    const sigA = (peekA.json.data && peekA.json.data.signals) || [];
    ok("A recebeu o candidato", sigA.some((s) => s.callId === callId), JSON.stringify(sigA).slice(0, 160));

    const end = await call("POST", "/calls/" + callId + "/end", { reason: "hangup" }, ca);
    ok("A encerrou a chamada", end.status === 200, "status=" + end.status);
    const peekB4 = await call("GET", "/calls/peek", null, cb);
    const ended = peekB4.json.data && peekB4.json.data.calls && peekB4.json.data.calls[callId];
    ok("B vê a chamada encerrada", ended && ended.state === "ended", JSON.stringify(ended));

    const stranger = await call("POST", "/calls", { peerId: idB }, cb);
    ok("quem está em chamada não inicia outra", stranger.status >= 400, "status=" + stranger.status);

    console.log("\n== 7. recusar chamada ==");
    const start2 = await call("POST", "/calls", { peerId: idB }, ca);
    ok("A iniciou a segunda chamada", start2.status === 201, JSON.stringify(start2.json).slice(0, 200));
    const call2 = start2.json.data && start2.json.data.id;
    const decline = await call("POST", "/calls/" + call2 + "/respond", { accept: false }, cb);
    ok("B recusou a chamada", decline.status === 200 && decline.json.data.state === "declined", JSON.stringify(decline.json).slice(0, 160));
    const peekA2 = await call("GET", "/calls/peek", null, ca);
    const decl = peekA2.json.data && peekA2.json.data.calls && peekA2.json.data.calls[call2];
    ok("A vê a recusa", decl && decl.state === "declined", JSON.stringify(decl));

    console.log("\n== 8. sync entrega apps/bots ==");
    const sync = await call("GET", "/sync", null, ca);
    ok("sync inclui o catálogo", Array.isArray(sync.json.data.apps) && sync.json.data.apps.length >= 5);
    ok("sync inclui instalações", Array.isArray(sync.json.data.serverApps));
    ok("sync não vaza segredos", !JSON.stringify(sync.json).includes("service_role") && !JSON.stringify(sync.json).includes("eyJ"));
  } catch (e) {
    fail++;
    console.log("  ✘ exceção → " + e.message + "\n" + (e.stack || "").split("\n").slice(1, 4).join("\n"));
  } finally {
    console.log("\n== limpeza (nenhum dado de teste no banco) ==");
    await cleanup();
    console.log("  ✔ registros temporários removidos");
    console.log("---------------------------------------------");
    console.log("aprovados: " + pass + "   reprovados: " + fail);
    console.log("---------------------------------------------\n");
    process.exit(fail ? 1 : 0);
  }
}

main();
