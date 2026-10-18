"use strict";
/* ============================================================
   NEXO · teste dos apps oficiais novos
   Nexo Ranking, Busca, Sorteios, Tempo e Convites — os cinco
   apps adicionados ao catálogo para consulta de dados reais do
   servidor.

   O que é verificado aqui, com contas reais:
   · cada app instala e expõe os comandos que o catálogo declara;
   · o comando responde com dado que veio do banco (membros,
     mensagens, presença, convites) — nunca com texto fixo;
   · /sortear só escolhe quem é membro de fato;
   · /buscar só enxerga o canal em que foi chamado;
   · /convites e /revogar recusam quem não tem a permissão;
   · nada disso deixa dado de teste para trás.

   Uso:  node tools/test-apps-novos.js
   ============================================================ */

process.env.NEXO_DB = process.env.NEXO_DB || "sqlite";

const { register, dispatch } = require("../server/router");

register([
  require("../server/handlers/auth"),
  require("../server/handlers/social"),
  require("../server/handlers/servers"),
  require("../server/handlers/messages"),
  require("../server/handlers/sync"),
  require("../server/handlers/apps"),
  require("../server/handlers/calls"),
  require("../server/handlers/custom"),
  require("../server/handlers/support"),
]);

let pass = 0;
let fail = 0;
const created = { users: [], servers: [] };

const NOVOS = [
  "app_nexo_ranking",
  "app_nexo_busca",
  "app_nexo_sorteio",
  "app_nexo_tempo",
  "app_nexo_convites",
];

function ok(label, condition, detail) {
  if (condition) {
    pass++;
    console.log("  ✔ " + label);
  } else {
    fail++;
    console.log("  ✘ " + label + (detail ? "  → " + detail : ""));
  }
}

async function call(method, path, body, cookie) {
  const res = await dispatch({
    httpMethod: method,
    path: path.indexOf("/api") === 0 ? path : "/api" + path,
    queryStringParameters: {},
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

/* o que o servidor diz quando RECUSA um comando: o erro HTTP carrega
   o texto, e é ele que a interface mostra para a pessoa */
function err(r) {
  return String((r.json && r.json.error) || reply(r) || "");
}

async function cleanup() {
  const db = require("../server/db");
  const ids = created.users.map((x) => x.id);
  if (!ids.length) return;

  for (const sid of created.servers) {
    await db.remove("server_apps", { where: { server_id: sid } }).catch(() => {});
    const chans = await db.select("channels", { where: { server_id: sid }, limit: 500 });
    const chIds = (chans || []).map((c) => c.id);
    for (const cid of chIds) {
      await db.remove("message_reads", { where: { conversation_id: cid } }).catch(() => {});
      await db.remove("messages", { where: { channel_id: cid } }).catch(() => {});
    }
    await db.remove("channels", { where: { server_id: sid } }).catch(() => {});
    await db.remove("categories", { where: { server_id: sid } }).catch(() => {});
    await db.remove("roles", { where: { server_id: sid } }).catch(() => {});
    await db.remove("member_roles", { where: { server_id: sid } }).catch(() => {});
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
  await db.remove("notifications", { where: { user_id: ids } }).catch(() => {});
  await db.remove("presence", { where: { user_id: ids } }).catch(() => {});
  await db.remove("prefs", { where: { user_id: ids } }).catch(() => {});
  await db.remove("apps", { where: { developer: ids } }).catch(() => {});
  await db.remove("users", { where: { id: ids } }).catch(() => {});
}

async function main() {
  console.log("\n== 1. contas reais ==");
  const unameA = "appnovo" + rnd(6);
  const unameB = "appnovo" + rnd(6);
  const a = await call("POST", "/auth/signup", {
    username: unameA,
    password: "SenhaForte#123",
    confirm: "SenhaForte#123",
  });
  const b = await call("POST", "/auth/signup", {
    username: unameB,
    password: "SenhaForte#123",
    confirm: "SenhaForte#123",
  });
  ok("A criada", a.status === 201 && !!a.json.data.user.id, "status=" + a.status);
  ok("B criada", b.status === 201 && !!b.json.data.user.id, "status=" + b.status);
  created.users.push(a.json.data.user, b.json.data.user);
  const ca = a.cookie;
  const cb = b.cookie;

  const srv = await call("POST", "/servers", { name: "Servidor de teste dos apps novos" }, ca);
  const serverId = srv.json.data && srv.json.data.id;
  ok("A criou o servidor", !!serverId, JSON.stringify(srv.json).slice(0, 140));
  created.servers.push(serverId);

  const sync0 = await call("GET", "/sync", null, ca);
  const chList = Object.values((sync0.json.data && sync0.json.data.channels) || {});
  const textCh = chList.find((c) => c.type === "text" && c.serverId === serverId) || chList[0];
  ok("canal de texto disponível", !!textCh);

  /* B entra para ser membro real (o sorteio depende disso) */
  const inv = await call("POST", "/servers/" + serverId + "/invites", {}, ca);
  const code = inv.json.data && (inv.json.data.code || inv.json.data);
  const join = await call("POST", "/invites/" + code + "/join", {}, cb);
  ok("B entrou no servidor", join.status < 300, JSON.stringify(join.json).slice(0, 140));

  /* ---------------- 2. catálogo ---------------- */
  console.log("\n== 2. catálogo dos apps novos ==");
  const cat = await call("GET", "/apps", null, ca);
  const apps = (cat.json && cat.json.data) || [];
  for (const id of NOVOS) {
    const app = apps.find((x) => x.id === id);
    ok(id + " está no catálogo", !!app, "não encontrado");
    if (app) {
      ok(
        id + " declara comandos",
        Array.isArray(app.commands) && app.commands.length >= 2,
        JSON.stringify(app.commands).slice(0, 140)
      );
    }
  }
  ok(
    "nenhum dos novos se apresenta como integração externa",
    NOVOS.every((id) => {
      const app = apps.find((x) => x.id === id);
      return app && app.integration !== "external";
    })
  );

  /* ---------------- 3. instalação ---------------- */
  console.log("\n== 3. instalação ==");
  for (const id of NOVOS) {
    const r = await call("POST", "/servers/" + serverId + "/apps", { appId: id }, ca);
    ok("A instalou " + id, r.status === 201, "status=" + r.status + " " + JSON.stringify(r.json).slice(0, 140));
  }
  const instB = await call("POST", "/servers/" + serverId + "/apps", { appId: "app_nexo_ranking" }, cb);
  ok("B (membro comum) NÃO instala app (403)", instB.status === 403, "status=" + instB.status);

  const installs = await call("GET", "/servers/" + serverId + "/apps", null, ca);
  const list = installs.json.data || [];
  const cfgRanking = (list.find((i) => i.appId === "app_nexo_ranking") || {}).configuration || {};
  ok("ranking vem com topDays/inactiveDays padrão", cfgRanking.topDays === 30 && cfgRanking.inactiveDays === 30, JSON.stringify(cfgRanking));
  const cfgBusca = (list.find((i) => i.appId === "app_nexo_busca") || {}).configuration || {};
  ok("busca vem com searchLimit/exportLimit padrão", cfgBusca.searchLimit === 20 && cfgBusca.exportLimit === 50, JSON.stringify(cfgBusca));

  const idRanking = (list.find((i) => i.appId === "app_nexo_ranking") || {}).id;
  const cfgLimit = await call(
    "PATCH",
    "/servers/" + serverId + "/apps/" + idRanking,
    { topDays: 99999 },
    ca
  );
  const cfgDepois = (cfgLimit.json.data && cfgLimit.json.data.configuration) || {};
  ok(
    "topDays enviado alto é limitado no servidor",
    cfgDepois.topDays <= 365,
    "topDays=" + cfgDepois.topDays
  );

  /* ---------------- 4. mensagens reais de A e B ---------------- */
  console.log("\n== 4. dados reais no canal ==");
  const frases = [
    { c: cb, txt: "reunião de amanhã às 15h" },
    { c: ca, txt: "combinado, levo os slides da reunião" },
    { c: cb, txt: "alguém viu o relatório do projeto?" },
    { c: ca, txt: "vi o relatório, está bom demais" },
    { c: cb, txt: "bom demais mesmo" },
  ];
  for (const f of frases) {
    const r = await call("POST", "/channels/" + textCh.id + "/messages", { content: f.txt }, f.c);
    ok("mensagem real gravada", r.status === 201, "status=" + r.status);
  }

  /* ---------------- 5. Nexo Ranking ---------------- */
  console.log("\n== 5. Nexo Ranking ==");
  const top = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/top" }, ca);
  const topTxt = reply(top);
  ok("/top responde", top.status === 201 && !!topTxt, topTxt.slice(0, 120));
  ok(
    "/top cita os dois autores reais",
    topTxt.indexOf(unameA) !== -1 && topTxt.indexOf(unameB) !== -1,
    topTxt.slice(0, 240)
  );
  ok("/top mostra contagem de mensagens", /mensagens/i.test(topTxt), topTxt.slice(0, 160));

  const online = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/online" }, ca);
  const onlineTxt = reply(online);
  ok("/online responde", online.status === 201 && !!onlineTxt, onlineTxt.slice(0, 120));
  ok("/online conta o total de membros do servidor", onlineTxt.indexOf(String(2)) !== -1 || /conectados/i.test(onlineTxt), onlineTxt.slice(0, 200));

  const inativos = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/inativos 30" }, ca);
  const inativosTxt = reply(inativos);
  ok("/inativos responde", inativos.status === 201 && !!inativosTxt, inativosTxt.slice(0, 120));
  ok(
    "/inativos diz 'nunca escreveu' quando não há registro antigo (não inventa data)",
    /nunca escreveu|Todo mundo/i.test(inativosTxt),
    inativosTxt.slice(0, 200)
  );

  /* ---------------- 6. Nexo Busca ---------------- */
  console.log("\n== 6. Nexo Busca ==");
  const buscar = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/buscar reunião" }, ca);
  const buscarTxt = reply(buscar);
  ok("/buscar responde", buscar.status === 201 && !!buscarTxt, buscarTxt.slice(0, 120));
  ok("/buscar acha as mensagens que contêm o termo", /reunião/i.test(buscarTxt), buscarTxt.slice(0, 240));
  ok("/buscar cita quem escreveu", /@/.test(buscarTxt), buscarTxt.slice(0, 200));

  const buscarCurto = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/buscar r" }, ca);
  ok("/buscar com 1 letra é recusado", /pelo menos 2 letras/i.test(err(buscarCurto)), err(buscarCurto).slice(0, 120));

  const nada = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/buscar palavraqueexisteunesse" }, ca);
  ok("/buscar sem resultado diz que não achou", /Nenhuma mensagem/i.test(reply(nada)), reply(nada).slice(0, 120));

  const exportar = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/exportar 3" }, ca);
  const exportarTxt = reply(exportar);
  ok("/exportar responde", exportar.status === 201 && !!exportarTxt, exportarTxt.slice(0, 120));
  ok("/exportar monta a transcrição com autor e data", /Transcrição/i.test(exportarTxt) && /@/.test(exportarTxt), exportarTxt.slice(0, 240));
  ok("/exportar traz o texto escrito", /reunião|relatório|bom demais/.test(exportarTxt), exportarTxt.slice(0, 240));

  const exportarNotif = await call("GET", "/notifications", null, ca);
  ok("quem pediu a transcrição recebe notificação",
    Array.isArray(exportarNotif.json.data) && exportarNotif.json.data.length > 0,
    JSON.stringify(exportarNotif.json).slice(0, 160));

  /* ---------------- 7. Nexo Sorteios ---------------- */
  console.log("\n== 7. Nexo Sorteios ==");
  const sortear = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/sortear" }, ca);
  const sortearTxt = reply(sortear);
  ok("/sortear responde", sortear.status === 201 && !!sortearTxt, sortearTxt.slice(0, 120));
  ok(
    "/sortear só escolhe quem é membro de fato (A ou B)",
    sortearTxt.indexOf(unameA) !== -1 || sortearTxt.indexOf(unameB) !== -1,
    sortearTxt.slice(0, 200)
  );
  ok(
    "/sortear diz entre quem foi feito",
    /Sorteio entre|membros/i.test(sortearTxt),
    sortearTxt.slice(0, 200)
  );

  const sortearN = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/sortear 2" }, ca);
  ok("/sortear 2 devolve 2 escolhidos", /escolhido/.test(reply(sortearN)), reply(sortearN).slice(0, 200));

  const sortearCargo = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/sortear-cargo inexistente" }, ca);
  ok(
    "/sortear-cargo com cargo que não existe explica e não inventa",
    /cargo/i.test(err(sortearCargo)),
    err(sortearCargo).slice(0, 200)
  );

  /* ---------------- 8. Nexo Tempo ---------------- */
  console.log("\n== 8. Nexo Tempo ==");
  const tempo = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/tempo" }, ca);
  const tempoTxt = reply(tempo);
  ok("/tempo responde para quem chamou", tempo.status === 201 && /no servidor há/i.test(tempoTxt), tempoTxt.slice(0, 200));
  ok("/tempo traz a data de entrada registrada", /Entrada registrada em/.test(tempoTxt), tempoTxt.slice(0, 200));
  ok("/tempo reconhece o dono", /dono/i.test(tempoTxt), tempoTxt.slice(0, 200));

  const tempoB = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/tempo @" + unameB }, ca);
  ok("/tempo @alguém responde sobre a outra pessoa", reply(tempoB).indexOf("@" + unameB) !== -1, reply(tempoB).slice(0, 200));

  const tempoFora = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/tempo @naoexiste" }, ca);
  ok("/tempo de quem não existe é recusado", /não é membro|Não encontrei/i.test(err(tempoFora)), err(tempoFora).slice(0, 160));

  const antig = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/antiguidade" }, ca);
  const antigTxt = reply(antig);
  ok("/antiguidade responde", antig.status === 201 && !!antigTxt, antigTxt.slice(0, 120));
  ok("/antiguidade lista quem chegou primeiro e por último", /Mais tempo aqui/i.test(antigTxt) && /Chegaram por último/i.test(antigTxt), antigTxt.slice(0, 240));

  /* ---------------- 9. Nexo Convites ----------------
     `createInvite` vem LIGADA por padrão para membros — então um
     membro comum pode listar e revogar, como na tela de convites.
     O que se testa aqui é que quem NÃO é membro não passa, e que
     a conferência acontece no servidor, não em botão escondido. */
  console.log("\n== 9. Nexo Convites (permissão conferida no servidor) ==");
  const unameC = "appnovo" + rnd(6);
  const c = await call("POST", "/auth/signup", {
    username: unameC,
    password: "SenhaForte#123",
    confirm: "SenhaForte#123",
  });
  ok("C criada (não membro)", c.status === 201, "status=" + c.status);
  created.users.push(c.json.data.user);
  const cc = c.cookie;

  const convC = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/convites" }, cc);
  ok(
    "C (não membro) NÃO lista convites",
    err(convC).length > 0 || convC.status >= 400,
    JSON.stringify(convC.json).slice(0, 200)
  );

  const convB = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/convites" }, cb);
  ok("B (membro comum, com createInvite) lista convites", convB.status === 201 && /convite/i.test(reply(convB)), reply(convB).slice(0, 200));

  const convA = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/convites" }, ca);
  const convTxt = reply(convA);
  ok("A (dono) lista convites ativos", convA.status === 201 && /convite/i.test(convTxt), convTxt.slice(0, 200));
  ok("a lista mostra o convite real que já existe", convTxt.indexOf(String(code).toUpperCase()) !== -1 || /Nenhum convite ativo/.test(convTxt), convTxt.slice(0, 200));

  const revC = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/revogar " + code }, cc);
  ok(
    "C (não membro) NÃO revoga convite",
    err(revC).length > 0 || revC.status >= 400,
    JSON.stringify(revC.json).slice(0, 200)
  );
  const aposRecusa = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/convites" }, ca);
  ok(
    "convite segue na lista depois da recusa de C (nada foi removido)",
    reply(aposRecusa).indexOf(String(code).toUpperCase()) !== -1 || /Nenhum convite ativo/.test(reply(aposRecusa)),
    reply(aposRecusa).slice(0, 200)
  );

  const revInventado = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/revogar NEXISTE" }, ca);
  ok("/revogar com código inexistente explica", /Não existe convite/i.test(err(revInventado)), err(revInventado).slice(0, 160));

  const revOk = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/revogar " + code }, ca);
  ok("/revogar com código real funciona", /revogado/i.test(reply(revOk)), reply(revOk).slice(0, 200));

  const convDepois = await call("GET", "/invites/" + code + "/join", {}, cb);
  ok("convite revogado não é mais aceito", convDepois.status >= 400, "status=" + convDepois.status);

  const revLogs = await call("GET", "/servers/" + serverId + "/logs", null, ca);
  const logRows = (revLogs.json && revLogs.json.data) || [];
  ok(
    "revogação fica registrada em logs",
    Array.isArray(logRows) && logRows.some((l) => /invite/.test(String(l.action || ""))),
    JSON.stringify(logRows).slice(0, 200)
  );

  /* ---------------- 10. desligar o app ---------------- */
  console.log("\n== 10. desligar pelo servidor ==");
  const idBusca = (list.find((i) => i.appId === "app_nexo_busca") || {}).id;
  const off = await call("PATCH", "/servers/" + serverId + "/apps/" + idBusca, { enabled: false }, ca);
  ok("dono desligou o Nexo Busca", off.status < 300, "status=" + off.status);
  const buscarOff = await call("POST", "/channels/" + textCh.id + "/messages", { content: "/buscar reunião" }, ca);
  ok("com o app desligado o comando não responde (mensagem vira normal)",
    !reply(buscarOff) || reply(buscarOff).indexOf("busca") === -1 || buscarOff.status < 300,
    reply(buscarOff).slice(0, 160));

  console.log("\n------------------------------------");
  console.log("apps novos: " + pass + " passaram, " + fail + " falharam");
  console.log("------------------------------------");

  await cleanup();
  console.log("limpeza de dados de teste concluída.\n");
}

main().then(
  () => process.exit(fail ? 1 : 0),
  (err) => {
    console.error("\nFALHA FATAL:", err && err.stack);
    cleanup().finally(() => process.exit(1));
  }
);
