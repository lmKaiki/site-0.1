"use strict";
/* ============================================================
   NEXO · tools/test-bots.js
   Tarefa 2 — Central de Bots + bots/comandos novos:
   catálogo (selo de integração externa), música bloqueada de
   verdade, /ajuda, /regras, /enquete (voto único sem duplicar),
   /lembrete (persistência real + entrega honesta no sync),
   /avisar, anti-spam configurável e remoção/reinstalação.
   Tudo com contas reais e limpeza total ao final.
     node tools/test-bots.js
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

/* conteúdo da resposta de um comando (mensagem do bot, sem o marcador) */
function reply(r) {
  return (r.json && r.json.data && r.json.data.content) || "";
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
  const db = require("../server/db");

  /* ---------------- 1. contas reais ---------------- */
  console.log("\n== 1. contas reais ==");
  const signA = await call("POST", "/auth/signup", {
    username: nameA, password: "Teste1234", confirm: "Teste1234",
  });
  const ca = signA.cookie;
  created.users.push(signA.json.data && signA.json.data.user ? signA.json.data.user : { id: signA.json.data.id });
  ok("A criada", signA.status === 201, JSON.stringify(signA.json).slice(0, 160));
  const signB = await call("POST", "/auth/signup", {
    username: nameB, password: "Teste1234", confirm: "Teste1234",
  });
  const cb = signB.cookie;
  created.users.push(signB.json.data && signB.json.data.user ? signB.json.data.user : { id: signB.json.data.id });
  ok("B criada", signB.status === 201, JSON.stringify(signB.json).slice(0, 160));
  const B = created.users[1];

  /* ---------------- 2. catálogo novo ---------------- */
  console.log("\n== 2. catálogo: apps novos + selo de integração ==");
  const list = await call("GET", "/apps", null, ca);
  const apps = (list.json.data || []).filter((a) => a.enabled !== false);
  ok("catálogo responde com os apps", list.status === 200 && apps.length >= 5, "achou " + apps.length);
  ["app_nexo_ajuda", "app_nexo_enquete", "app_nexo_lembrete", "app_nexo_musica"].forEach((id) => {
    ok("catálogo tem " + id, apps.some((a) => a.id === id));
  });
  const musica = apps.find((a) => a.id === "app_nexo_musica");
  ok("música marcada como integração externa", musica && musica.integration === "external",
    JSON.stringify(musica && musica.integration));
  const externos = apps.filter((a) => a.integration === "external").map((a) => a.id);
  ok("apps marcados como externos são só os honestos (música + tradutor)",
    externos.length === 2 && externos.indexOf("app_nexo_musica") !== -1 && externos.indexOf("app_nexo_tradutor") !== -1,
    JSON.stringify(externos));
  ok("demais apps são de integração interna",
    apps.filter((a) => a.integration !== "external").every((a) => a.integration === "builtin"));
  ok("comandos de música marcados como externos",
    !!(musica && (musica.commands || []).every((c) => c.external === true)));
  const ajudaApp = apps.find((a) => a.id === "app_nexo_ajuda");
  ok("app de ajuda declara /ajuda e /regras",
    !!(ajudaApp && (ajudaApp.commands || []).some((c) => c.name === "/ajuda") &&
      (ajudaApp.commands || []).some((c) => c.name === "/regras")));
  const modApp = apps.find((a) => a.id === "app_nexo_mod");
  ok("moderação declara /avisar", !!(modApp && (modApp.commands || []).some((c) => c.name === "/avisar")));
  ok("enquetes e lembretes declaram comandos",
    !!(apps.find((a) => a.id === "app_nexo_enquete") && apps.find((a) => a.id === "app_nexo_lembrete")));

  /* ---------------- 3. servidor + música bloqueada ---------------- */
  console.log("\n== 3. servidor + música: instalação de verdade é recusada ==");
  const srv = await call("POST", "/servers", { name: "T2 Bots", template: "comunidade" }, ca);
  const serverId = srv.json.data && srv.json.data.id;
  ok("A criou o servidor", !!serverId, JSON.stringify(srv.json).slice(0, 160));
  created.servers.push(serverId);
  const sync0 = await call("GET", "/sync", null, ca);
  const chList = Object.values((sync0.json.data && sync0.json.data.channels) || {});
  const textCh = chList.find((c) => c.type === "text" && c.serverId === serverId) || chList[0];
  ok("canal de texto disponível", !!textCh);

  const instMusic = await call("POST", "/servers/" + serverId + "/apps", { appId: "app_nexo_musica" }, ca);
  ok("dono NÃO instala música (403)", instMusic.status === 403, "status=" + instMusic.status);
  ok("recusa de música é honesta (diz que exige servidor de áudio externo)",
    /servidor de áudio externo/i.test(JSON.stringify(instMusic.json)) &&
      /desabilitada/i.test(JSON.stringify(instMusic.json)),
    JSON.stringify(instMusic.json).slice(0, 200));
  const installs0 = await call("GET", "/servers/" + serverId + "/apps", null, ca);
  ok("nenhuma instalação de música persistida",
    !((installs0.json.data || []).some((i) => i.appId === "app_nexo_musica")));

  /* ---------------- 4. instalação por permissão ---------------- */
  console.log("\n== 4. instalação respeitando permissões ==");
  const noMember = await call("POST", "/servers/" + serverId + "/apps", { appId: "app_nexo_utils" }, cb);
  ok("B (ainda não membro) NÃO instala (403)", noMember.status === 403, "status=" + noMember.status);

  const inv = await call("POST", "/servers/" + serverId + "/invites", {}, ca);
  const code = inv.json.data && (inv.json.data.code || inv.json.data);
  const join = await call("POST", "/invites/" + code + "/join", {}, cb);
  ok("B entrou no servidor", join.status < 300, JSON.stringify(join.json).slice(0, 140));

  const instB = await call("POST", "/servers/" + serverId + "/apps", { appId: "app_nexo_utils" }, cb);
  ok("B (membro comum) NÃO instala (403)", instB.status === 403, "status=" + instB.status);

  const instAjuda = await call("POST", "/servers/" + serverId + "/apps", { appId: "app_nexo_ajuda" }, ca);
  ok("A instalou Nexo Ajuda", instAjuda.status === 201, JSON.stringify(instAjuda.json).slice(0, 160));
  const idAjuda = instAjuda.json.data && instAjuda.json.data.id;
  const instEnquete = await call("POST", "/servers/" + serverId + "/apps", { appId: "app_nexo_enquete" }, ca);
  ok("A instalou Nexo Enquetes", instEnquete.status === 201, JSON.stringify(instEnquete.json).slice(0, 160));
  const idEnquete = instEnquete.json.data && instEnquete.json.data.id;
  const instLembrete = await call("POST", "/servers/" + serverId + "/apps", { appId: "app_nexo_lembrete" }, ca);
  ok("A instalou Nexo Lembretes", instLembrete.status === 201, JSON.stringify(instLembrete.json).slice(0, 160));
  const instMod = await call("POST", "/servers/" + serverId + "/apps", { appId: "app_nexo_mod" }, ca);
  ok("A instalou Nexo Moderação", instMod.status === 201, JSON.stringify(instMod.json).slice(0, 160));
  const idMod = instMod.json.data && instMod.json.data.id;

  const cfgMod = (instMod.json.data && instMod.json.data.configuration) || {};
  ok("anti-spam vem DESLIGADO por padrão", cfgMod.spamEnabled === false, JSON.stringify(cfgMod.spamEnabled));
  ok("limites de spam vêm com valores padrão", cfgMod.spamLimit === 8 && cfgMod.spamWindow === 10);
  const cfgEnq = (instEnquete.json.data && instEnquete.json.data.configuration) || {};
  ok("troca de voto vem DESLIGADA por padrão", cfgEnq.pollAllowChange === false);

  const cfgB = await call("PATCH", "/servers/" + serverId + "/apps/" + idAjuda, { enabled: false }, cb);
  ok("B (membro comum) NÃO configura app (403)", cfgB.status === 403, "status=" + cfgB.status);
  const delB = await call("DELETE", "/servers/" + serverId + "/apps/" + idAjuda, null, cb);
  ok("B (membro comum) NÃO remove app (403)", delB.status === 403, "status=" + delB.status);

  /* ---------------- 5. /ajuda e /regras ---------------- */
  console.log("\n== 5. /ajuda e /regras ==");
  const ajuda = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/ajuda" }, cb);
  ok("/ajuda responde com a lista de comandos",
    ajuda.status === 201 && /enquete/i.test(reply(ajuda)) && /lembrete/i.test(reply(ajuda)),
    reply(ajuda).slice(0, 160));

  const regrasVazio = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/regras" }, cb);
  ok("/regras sem regras é honesto",
    regrasVazio.status === 201 && /não tem regras/i.test(reply(regrasVazio)),
    reply(regrasVazio).slice(0, 160));

  const setRules = await call("PATCH", "/servers/" + serverId + "/apps/" + idAjuda, {
    configuration: { rules: "1) Respeitar a todos. 2) Sem spam." },
  }, ca);
  ok("A cadastrou as regras na configuração", setRules.status < 300, JSON.stringify(setRules.json).slice(0, 140));
  const regras = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/regras" }, cb);
  ok("/regras mostra as regras escritas",
    regras.status === 201 && /Respeitar a todos/.test(reply(regras)),
    reply(regras).slice(0, 160));

  /* ---------------- 6. /enquete ---------------- */
  console.log("\n== 6. /enquete: criar, votar, resultado, fechar ==");
  const criar = await call("POST", "/channels/" + textCh.id + "/messages", {
    content: "/enquete criar Gosto de pizza? | Sim | Não",
  }, cb);
  ok("B criou a enquete", criar.status === 201 && /Enquete p1/i.test(reply(criar)), reply(criar).slice(0, 160));
  const installs1 = await call("GET", "/servers/" + serverId + "/apps", null, ca);
  const enqueteInstall = (installs1.json.data || []).find((i) => i.appId === "app_nexo_enquete");
  const polls = ((enqueteInstall && enqueteInstall.configuration || {}).polls) || [];
  ok("enquete persistida na instalação", polls.length === 1 && polls[0].id === "p1", JSON.stringify(polls).slice(0, 140));

  const voto1 = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/enquete votar 1" }, cb);
  ok("B votou (1 voto por pessoa)", voto1.status === 201 && /Voto registrado/.test(reply(voto1)), reply(voto1).slice(0, 140));
  const votoDup = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/enquete votar 2" }, cb);
  ok("voto duplicado é recusado", votoDup.status >= 400 && /já votou/i.test(JSON.stringify(votoDup.json)),
    JSON.stringify(votoDup.json).slice(0, 160));
  const votoA = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/enquete votar 2" }, ca);
  ok("A votou em outra opção", votoA.status === 201 && /Voto registrado/.test(reply(votoA)), reply(votoA).slice(0, 140));

  const resultado = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/enquete resultado" }, ca);
  ok("resultado mostra as duas opções com a contagem",
    resultado.status === 201 && /Sim/.test(reply(resultado)) && /Não/.test(reply(resultado)) &&
      /Total: \*\*2\*\*/.test(reply(resultado)),
    reply(resultado).slice(0, 200));

  const voteRows = (await db.select("logs", {
    where: { server_id: serverId, action: "poll.vote" }, limit: 100,
  })) || [];
  ok("votos são linhas insert-only em logs (2 votos, 2 linhas)", voteRows.length === 2,
    "achou " + voteRows.length);

  const allow = await call("PATCH", "/servers/" + serverId + "/apps/" + idEnquete, {
    configuration: { pollAllowChange: true },
  }, ca);
  ok("A liberou a troca de voto", allow.status < 300, JSON.stringify(allow.json).slice(0, 120));
  const troca = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/enquete votar 2" }, cb);
  ok("B trocou o voto (sem contar duas vezes)", troca.status === 201 && /Voto trocado/.test(reply(troca)),
    reply(troca).slice(0, 140));
  const resultado2 = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/enquete resultado" }, ca);
  ok("após a troca o total segue 2 (B conta uma vez só)",
    /Total: \*\*2\*\*/.test(reply(resultado2)) && /Não/.test(reply(resultado2)),
    reply(resultado2).slice(0, 200));

  const fechar = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/enquete fechar p1" }, cb);
  ok("criador encerrou a enquete", fechar.status === 201 && /encerrada/i.test(reply(fechar)), reply(fechar).slice(0, 140));
  const votoFechada = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/enquete votar 1 p1" }, ca);
  ok("votar em enquete encerrada é recusado", votoFechada.status >= 400 && /encerrada/i.test(JSON.stringify(votoFechada.json)),
    JSON.stringify(votoFechada.json).slice(0, 160));
  const listar = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/enquete listar" }, ca);
  ok("/enquete listar mostra a enquete encerrada",
    listar.status === 201 && /encerrada/.test(reply(listar)) && /pizza/.test(reply(listar)),
    reply(listar).slice(0, 160));

  /* ---------------- 7. /lembrete ---------------- */
  console.log("\n== 7. /lembrete: criação honesta, persistência e entrega ==");
  const lem = await call("POST", "/channels/" + textCh.id + "/messages", {
    content: "/lembrete criar 5 teste de lembrete",
  }, cb);
  ok("criou lembrete com aviso honesto de segundo plano",
    lem.status === 201 && /segundo plano/i.test(reply(lem)) && /sync/i.test(reply(lem)),
    reply(lem).slice(0, 200));
  const lemList = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/lembrete listar" }, cb);
  ok("/lembrete listar mostra o pendente", lemList.status === 201 && /teste de lembrete/.test(reply(lemList)),
    reply(lemList).slice(0, 160));

  /* persistência real: nova sessão de login continua vendo o lembrete */
  const loginB2 = await call("POST", "/auth/login", { identifier: nameB, password: "Teste1234" });
  const cb2 = loginB2.cookie;
  ok("nova sessão de B criada", !!cb2, JSON.stringify(loginB2.json).slice(0, 120));
  const lemList2 = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/lembrete listar" }, cb2);
  ok("lembrete sobrevive a novo login (persistência)", /teste de lembrete/.test(reply(lemList2)),
    reply(lemList2).slice(0, 160));

  /* prazo venceu → o sync entrega a notificação (uma vez só) */
  const prefsB = await db.readPrefs(B.id);
  const rem = ((prefsB || {}).reminders || [])[0];
  ok("lembrete gravado em prefs.data do usuário", !!(rem && rem.id), JSON.stringify((prefsB || {}).reminders).slice(0, 140));
  if (rem) {
    const saved = prefsB.reminders.find((r) => r.id === rem.id);
    saved.dueAt = Date.now() - 5000;
    await db.writePrefs(B.id, prefsB);
  }
  const syncB1 = await call("GET", "/sync", null, cb2);
  const notifs1 = ((syncB1.json.data && syncB1.json.data.notifications) || []);
  ok("sync entrega a notificação do lembrete vencido",
    notifs1.some((n) => /Lembrete: teste de lembrete/.test(n.text || "")),
    JSON.stringify(notifs1.slice(-2)).slice(0, 200));
  const syncB2 = await call("GET", "/sync", null, cb2);
  const notifs2 = ((syncB2.json.data && syncB2.json.data.notifications) || [])
    .filter((n) => /Lembrete: teste de lembrete/.test(n.text || ""));
  ok("segundo sync NÃO duplica a entrega", notifs2.length === 1, "achou " + notifs2.length);

  const listaEntregue = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/lembrete listar" }, cb2);
  ok("listar mostra o lembrete como entregue", /entregue/.test(reply(listaEntregue)), reply(listaEntregue).slice(0, 200));

  const cancelEntregue = await call("POST", "/channels/" + textCh.id + "/messages", {
    content: "/lembrete cancelar " + rem.id,
  }, cb2);
  ok("cancelar lembrete já entregue é recusado com honestidade",
    cancelEntregue.status >= 400 && /já foi entregue/i.test(JSON.stringify(cancelEntregue.json)),
    JSON.stringify(cancelEntregue.json).slice(0, 160));

  const lem2 = await call("POST", "/channels/" + textCh.id + "/messages", {
    content: "/lembrete criar 60 segundo teste",
  }, cb2);
  ok("criou um segundo lembrete", lem2.status === 201, reply(lem2).slice(0, 140));
  const prefsB2 = await db.readPrefs(B.id);
  const pend = ((prefsB2 || {}).reminders || []).find((r) => !r.firedAt);
  ok("pendente existe para cancelar", !!pend, JSON.stringify((prefsB2 || {}).reminders).slice(0, 140));
  if (pend) {
    const cancel = await call("POST", "/channels/" + textCh.id + "/messages", {
      content: "/lembrete cancelar " + pend.id,
    }, cb2);
    ok("cancelou o pendente", cancel.status === 201 && /cancelado/.test(reply(cancel)), reply(cancel).slice(0, 140));
    const prefsB3 = await db.readPrefs(B.id);
    ok("cancelamento persistiu (sumiu do prefs)",
      !((prefsB3 || {}).reminders || []).some((r) => r.id === pend.id));
  }

  /* ---------------- 8. /avisar ---------------- */
  console.log("\n== 8. /avisar (alias de /warn) ==");
  const avisar = await call("POST", "/channels/" + textCh.id + "/messages", {
    content: "/avisar @" + nameB + " teste de advertência",
  }, ca);
  ok("/avisar responde como advertência", avisar.status === 201 && /advert/i.test(reply(avisar)), reply(avisar).slice(0, 160));
  const warnLogs = (await db.select("logs", {
    where: { server_id: serverId, action: "member.warn" }, limit: 50,
  })) || [];
  ok("/avisar registrou em logs", warnLogs.length >= 1, "achou " + warnLogs.length);
  const syncNotif = await call("GET", "/sync", null, cb2);
  const warned = ((syncNotif.json.data && syncNotif.json.data.notifications) || [])
    .some((n) => /advert|Advert/.test(n.text || ""));
  ok("B recebeu a notificação da advertência", warned);
  const avisarB = await call("POST", "/channels/" + textCh.id + "/messages", {
    content: "/avisar @" + nameA + " sem permissão",
  }, cb);
  ok("B sem permissão NÃO usa /avisar", avisarB.status >= 400 && /permissão/i.test(JSON.stringify(avisarB.json)),
    JSON.stringify(avisarB.json).slice(0, 160));

  /* ---------------- 9. anti-spam ---------------- */
  console.log("\n== 9. anti-spam do Nexo Moderação ==");
  const countB = async () => {
    const s = await call("GET", "/sync", null, ca);
    return Object.values((s.json.data && s.json.data.messages) || {})
      .filter((m) => m.channelId === textCh.id && m.senderId === B.id &&
        !String(m.content || "").startsWith("«bot:")).length;
  };

  /* limpa o histórico do canal: as seções anteriores deixaram
     mensagens dentro da janela de tempo do anti-spam */
  await call("POST", "/channels/" + textCh.id + "/messages", { content: "/clear 100" }, ca);

  const base0 = await countB();
  for (let i = 1; i <= 5; i++) {
    const r = await call("POST", "/channels/" + textCh.id + "/messages", { content: "livre " + i }, cb);
    if (r.status !== 201) break;
  }
  const base1 = await countB();
  ok("anti-spam desligado por padrão: todas passam", base1 === base0 + 5, base0 + " → " + base1);

  await call("POST", "/channels/" + textCh.id + "/messages", { content: "/clear 100" }, ca);
  const liga = await call("PATCH", "/servers/" + serverId + "/apps/" + idMod, {
    configuration: { spamEnabled: true, spamLimit: 4, spamWindow: 300, spamAction: "block" },
  }, ca);
  ok("A ligou o anti-spam (limite 4)", liga.status < 300, JSON.stringify(liga.json).slice(0, 120));

  let last = null;
  for (let i = 1; i <= 5; i++) {
    last = await call("POST", "/channels/" + textCh.id + "/messages", { content: "flood " + i }, cb);
  }
  ok("5ª mensagem rápida foi bloqueada com aviso do bot",
    last.status === 201 && /Anti-spam/.test(reply(last)), reply(last).slice(0, 180));
  const base2 = await countB();
  ok("a mensagem bloqueada NÃO foi publicada (4 de 5 passaram)", base2 === 4,
    "achou " + base2);

  let allOwner = true;
  for (let i = 1; i <= 6; i++) {
    const r = await call("POST", "/channels/" + textCh.id + "/messages", { content: "dono livre " + i }, ca);
    if (r.status !== 201) allOwner = false;
  }
  ok("dono (quem modera) é dispensado do limite", allOwner);

  await call("POST", "/channels/" + textCh.id + "/messages", { content: "/clear 100" }, ca);
  const ligaClear = await call("PATCH", "/servers/" + serverId + "/apps/" + idMod, {
    configuration: { spamAction: "clear" },
  }, ca);
  ok("A mudou a ação para clear (bot tem deleteMessages)", ligaClear.status < 300);
  let lastClear = null;
  for (let i = 1; i <= 5; i++) {
    lastClear = await call("POST", "/channels/" + textCh.id + "/messages", { content: "flood clear " + i }, cb);
  }
  ok("clear: aviso honesto diz que apagou as excedentes",
    lastClear.status === 201 && /Anti-spam/.test(reply(lastClear)) && /Apaguei/.test(reply(lastClear)),
    reply(lastClear).slice(0, 180));
  const base3 = await countB();
  ok("clear apagou as mensagens excedentes (nada sobrou na janela)", base3 === 0,
    "achou " + base3);

  const spamLogs = (await db.select("logs", {
    where: { server_id: serverId, action: "message.spam" }, limit: 50,
  })) || [];
  ok("eventos de anti-spam registrados em logs", spamLogs.length >= 2, "achou " + spamLogs.length);

  const desliga = await call("PATCH", "/servers/" + serverId + "/apps/" + idMod, {
    configuration: { spamEnabled: false },
  }, ca);
  ok("A desligou o anti-spam", desliga.status < 300);
  const depois = await call("POST", "/channels/" + textCh.id + "/messages", { content: "depois do anti-spam" }, cb);
  ok("com desligado volta a passar normal", depois.status === 201 && !/Anti-spam/.test(reply(depois)));

  /* ---------------- 10. remoção e reinstalação ---------------- */
  console.log("\n== 10. remoção e reinstalação ==");
  const remEnq = await call("DELETE", "/servers/" + serverId + "/apps/" + idEnquete, null, ca);
  ok("A removeu o app de enquetes", remEnq.status < 300, JSON.stringify(remEnq.json).slice(0, 120));
  const semEnq = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/enquete" }, cb);
  ok("comando some quando o app é removido (vira mensagem normal, nada finge executar)",
    semEnq.status === 201 && /^«bot:/.test(reply(semEnq)) === false &&
      /^\/enquete/.test((semEnq.json.data && semEnq.json.data.content) || ""),
    "status=" + semEnq.status + " " + reply(semEnq).slice(0, 80));
  const reinstala = await call("POST", "/servers/" + serverId + "/apps", { appId: "app_nexo_enquete" }, ca);
  ok("reinstalação funciona", reinstala.status === 201, JSON.stringify(reinstala.json).slice(0, 140));
  const comEnq = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/enquete" }, cb);
  ok("comando volta após reinstalar", comEnq.status === 201 && /Enquete/i.test(reply(comEnq)), reply(comEnq).slice(0, 120));

  /* ---------------- 11. sync entrega o catálogo decorado ---------------- */
  console.log("\n== 11. sync entrega catálogo sem segredos ==");
  const syncF = await call("GET", "/sync", null, ca);
  const syncApps = (syncF.json.data && syncF.json.data.apps) || {};
  ok("sync traz o app de música com selo externo",
    !!syncApps.app_nexo_musica && syncApps.app_nexo_musica.integration === "external");
  ok("sync traz o app de ajuda com os comandos novos",
    !!(syncApps.app_nexo_ajuda && (syncApps.app_nexo_ajuda.commands || []).some((c) => c.name === "/ajuda")));
  ok("sync traz as instalações do servidor",
    Object.keys((syncF.json.data && syncF.json.data.serverApps) || {}).length >= 4);
  const dump = JSON.stringify(syncF.json.data || {});
  ok("nenhuma chave/corpo/senha na resposta",
    !/password|senha|hash|\$2[aby]|cookie/i.test(dump), dump.slice(0, 120));

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
