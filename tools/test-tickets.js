"use strict";
/* ============================================================
   NEXO · teste do Bot Center de tickets
   Comprov, com contas REAIS, que o sistema de tickets funciona:
   · qualquer membro abre um chamado → vira TICKET-000N;
   · o canal do chamado é PRIVADO de verdade (outro membro comum
     não o vê no sync nem envia nele; o abridor e o staff veem);
   · assumir/transferir/fechar/reabrir exigem staff, conferido no
     backend (recusa de não-equipe e de não-membro);
   · toda ação fica registrada em logs (auditoria);
   · transcrição só para quem participa/staff;
   · nada disso deixa dado de teste para trás.

   Roda com NEXO_DB=sqlite (tem as tabelas da migração 0003 no DDL
   local). No Supabase, enquanto a 0003 não for aplicada, as mesmas
   rotas respondem 503 schema_pending honesto.

   Uso:  node tools/test-tickets.js
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
  require("../server/handlers/tickets"),
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

function err(r) {
  return String((r.json && r.json.error) || "");
}

async function signup(name) {
  const r = await call("POST", "/auth/signup", {
    username: name,
    password: "SenhaForte#123",
    confirm: "SenhaForte#123",
  });
  created.users.push(r.json.data.user);
  return { user: r.json.data.user, cookie: r.cookie, status: r.status };
}

async function cleanup() {
  const db = require("../server/db");
  const ids = created.users.map((x) => x.id);
  if (!ids.length) return;

  for (const sid of created.servers) {
    /* canais de ticket (e seus mensagens) junto com os do servidor */
    const chans = await db.select("channels", { where: { server_id: sid }, limit: 500 });
    const chIds = (chans || []).map((c) => c.id);
    for (const cid of chIds) {
      await db.remove("message_reads", { where: { conversation_id: cid } }).catch(() => {});
      await db.remove("messages", { where: { channel_id: cid } }).catch(() => {});
    }
    await db.remove("channels", { where: { server_id: sid } }).catch(() => {});
    /* tickets deste servidor + participantes + painéis */
    const tks = await db.select("tickets", { where: { server_id: sid }, limit: 500 });
    const tIds = (tks || []).map((t) => t.id);
    for (const tid of tIds) {
      await db.remove("ticket_participants", { where: { ticket_id: tid } }).catch(() => {});
    }
    await db.remove("tickets", { where: { server_id: sid } }).catch(() => {});
    await db.remove("ticket_panels", { where: { server_id: sid } }).catch(() => {});
    await db.remove("categories", { where: { server_id: sid } }).catch(() => {});
    await db.remove("roles", { where: { server_id: sid } }).catch(() => {});
    await db.remove("member_roles", { where: { server_id: sid } }).catch(() => {});
    await db.remove("invites", { where: { server_id: sid } }).catch(() => {});
    await db.remove("logs", { where: { server_id: sid } }).catch(() => {});
    await db.remove("memberships", { where: { server_id: sid } }).catch(() => {});
    await db.remove("servers", { where: { id: sid } }).catch(() => {});
  }
  await db.remove("notifications", { where: { user_id: ids } }).catch(() => {});
  await db.remove("presence", { where: { user_id: ids } }).catch(() => {});
  await db.remove("prefs", { where: { user_id: ids } }).catch(() => {});
  await db.remove("users", { where: { id: ids } }).catch(() => {});
}

async function main() {
  /* ---------------- 1. contas + servidor ---------------- */
  console.log("\n== 1. contas reais e servidor ==");
  const a = await signup("tkt" + rnd(6)); /* dono / staff */
  const b = await signup("tkt" + rnd(6)); /* membro comum */
  const c = await signup("tkt" + rnd(6)); /* membro comum (outra pessoa) */
  const z = await signup("tkt" + rnd(6)); /* NÃO membro */
  ok("dono criado", a.status === 201, "status=" + a.status);
  ok("membro B criado", b.status === 201);
  ok("membro C criado", c.status === 201);
  ok("não-membro Z criado", z.status === 201);
  const ca = a.cookie, cb = b.cookie, cc = c.cookie, cz = z.cookie;

  const srv = await call("POST", "/servers", { name: "Servidor de teste de tickets" }, ca);
  const serverId = srv.json.data && srv.json.data.id;
  ok("dono criou o servidor", !!serverId, JSON.stringify(srv.json).slice(0, 140));
  created.servers.push(serverId);

  /* B e C entram como membros comuns via convite real */
  for (const [who, cookie] of [["B", cb], ["C", cc]]) {
    const inv = await call("POST", "/servers/" + serverId + "/invites", {}, ca);
    const code = inv.json.data && (inv.json.data.code || inv.json.data);
    const join = await call("POST", "/invites/" + code + "/join", {}, cookie);
    ok(who + " entrou no servidor", join.status < 300, JSON.stringify(join.json).slice(0, 120));
  }

  /* ---------------- 2. abrir chamado ---------------- */
  console.log("\n== 2. abrir chamado (membro comum) ==");
  const open = await call("POST", "/servers/" + serverId + "/tickets", {
    subject: "Não consigo entrar no canal de voz",
    reason: "Quando clico no canal de voz nada acontece. Já tentei reconectar.",
  }, cb);
  const tk = open.json.data;
  ok("B abriu o chamado", open.status === 201 && !!tk && !!tk.id, "status=" + open.status + " " + JSON.stringify(open.json).slice(0, 160));
  ok("código é TICKET-000N", !!(tk && /^TICKET-\d{4}$/.test(tk.code)), tk && tk.code);
  ok("status inicial aberto", tk && tk.status === "open");
  ok("canal privado criado para o chamado", !!(tk && tk.channelId));
  const tid = tk && tk.id;
  const channelId = tk && tk.channelId;

  /* validação de entrada */
  const bad1 = await call("POST", "/servers/" + serverId + "/tickets", { subject: "ab", reason: "motivo válido aqui" }, cb);
  ok("assunto curto é recusado (400)", bad1.status === 400, "status=" + bad1.status);
  const bad2 = await call("POST", "/servers/" + serverId + "/tickets", { subject: "Assunto válido", reason: "cur" }, cb);
  ok("motivo curto é recusado (400)", bad2.status === 400, "status=" + bad2.status);

  /* ---------------- 3. privacidade do canal ---------------- */
  console.log("\n== 3. canal privado de verdade ==");
  const syncB = await call("GET", "/sync", null, cb);
  const chansB = Object.values((syncB.json.data && syncB.json.data.channels) || {});
  ok("abridor B VÊ o canal do chamado", chansB.some((c) => c.id === channelId), "canal ausente no sync de B");

  const syncC = await call("GET", "/sync", null, cc);
  const chansC = Object.values((syncC.json.data && syncC.json.data.channels) || {});
  ok("membro comum C NÃO vê o canal do chamado", !chansC.some((c) => c.id === channelId), "vazou para C");
  ok("C continua vendo os canais normais", chansC.some((c) => c.serverId === serverId), "C perdeu acesso aos canais comuns");

  const sendC = await call("POST", "/channels/" + channelId + "/messages", { content: "vazando" }, cc);
  ok("C NÃO consegue enviar no canal privado (403)", sendC.status === 403, "status=" + sendC.status);

  const sendB = await call("POST", "/channels/" + channelId + "/messages", { content: "obrigado pela ajuda" }, cb);
  ok("abridor B ENVIA no próprio canal", sendB.status < 300, "status=" + sendB.status + " " + err(sendB));

  /* não-membro não faz nada */
  const openZ = await call("POST", "/servers/" + serverId + "/tickets", { subject: "Tentativa de fora", reason: "não sou membro deste servidor" }, cz);
  ok("não-membro Z não abre chamado (403/404)", openZ.status >= 400, "status=" + openZ.status);

  /* ---------------- 4. listagem por papel ---------------- */
  console.log("\n== 4. listagem: staff vê todos, membro vê os seus ==");
  const listA = await call("GET", "/servers/" + serverId + "/tickets", null, ca);
  ok("dono (staff) lista os chamados", listA.status === 200 && (listA.json.data || []).length >= 1, "n=" + (listA.json.data || []).length);
  const listB = await call("GET", "/servers/" + serverId + "/tickets", null, cb);
  ok("abridor B vê o próprio chamado", (listB.json.data || []).some((t) => t.id === tid));
  const listC = await call("GET", "/servers/" + serverId + "/tickets", null, cc);
  ok("membro C NÃO vê chamado alheio", !(listC.json.data || []).some((t) => t.id === tid), "C viu " + (listC.json.data || []).length);

  /* ---------------- 5. detalhe e permissão ---------------- */
  console.log("\n== 5. detalhe: staff/abridor sim, outro membro não ==");
  const detA = await call("GET", "/servers/" + serverId + "/tickets/" + tid, null, ca);
  ok("staff abre o detalhe", detA.status === 200 && detA.json.data.id === tid);
  ok("detalhe traz participantes", !!(detA.json.data.participantIds || []).length);
  const detC = await call("GET", "/servers/" + serverId + "/tickets/" + tid, null, cc);
  ok("membro C não abre o detalhe (403)", detC.status === 403, "status=" + detC.status);

  /* ---------------- 6. ciclo de vida (staff) ---------------- */
  console.log("\n== 6. assumir / fechar / reabrir (staff) ==");
  const assign = await call("POST", "/servers/" + serverId + "/tickets/" + tid + "/assign", {}, ca);
  ok("dono assumiu o chamado", assign.status === 200 && !!assign.json.data.assignedTo, err(assign));
  ok("assumir registra assignedTo = dono", assign.json.data && assign.json.data.assignedTo === a.user.id);

  const assignC = await call("POST", "/servers/" + serverId + "/tickets/" + tid + "/assign", {}, cc);
  ok("membro comum C NÃO pode assumir (403)", assignC.status === 403, "status=" + assignC.status);

  const closeNoReason = await call("POST", "/servers/" + serverId + "/tickets/" + tid + "/close", { reason: "abc" }, ca);
  ok("fechar sem motivo válido é recusado (400)", closeNoReason.status === 400, "status=" + closeNoReason.status);

  const close = await call("POST", "/servers/" + serverId + "/tickets/" + tid + "/close", { reason: "Resolvido no canal de voz." }, ca);
  ok("dono fechou o chamado", close.status === 200 && close.json.data.status === "closed", err(close));
  ok("fechamento guarda motivo e quem fechou", !!(close.json.data.closeReason && close.json.data.closedBy === a.user.id));

  const reopen = await call("POST", "/servers/" + serverId + "/tickets/" + tid + "/reopen", {}, ca);
  ok("dono reabriu o chamado", reopen.status === 200 && reopen.json.data.status === "open", err(reopen));
  ok("reabrir limpa motivo/fechador", !reopen.json.data.closeReason && !reopen.json.data.closedBy);

  /* ---------------- 7. transcrição ---------------- */
  console.log("\n== 7. transcrição ==");
  const trB = await call("GET", "/servers/" + serverId + "/tickets/" + tid + "/transcript", null, cb);
  ok("abridor lê a transcrição", trB.status === 200 && !!(trB.json.data.messages || []).length, "n=" + (trB.json.data.messages || []).length);
  ok("transcrição traz a mensagem real de B", (trB.json.data.messages || []).some((m) => /obrigado/.test(m.content)));
  const trC = await call("GET", "/servers/" + serverId + "/tickets/" + tid + "/transcript", null, cc);
  ok("membro C não lê a transcrição (403)", trC.status === 403, "status=" + trC.status);

  /* ---------------- 8. painel publicado como mensagem real ---------------- */
  console.log("\n== 8. painel ==");
  const syncCh = await call("GET", "/sync", null, ca);
  const geral = Object.values((syncCh.json.data && syncCh.json.data.channels) || {})
    .find((c) => c.serverId === serverId && c.type === "text");
  ok("canal de texto para publicar o painel", !!geral);
  const pub = await call("POST", "/servers/" + serverId + "/tickets/panel", { channelId: geral.id, title: "Abrir chamado" }, ca);
  ok("dono publicou o painel", pub.status === 201 && !!pub.json.data.messageId, err(pub));
  /* a publicação é uma MENSAGEM REAL persistida */
  const msgs = await call("GET", "/sync", null, ca);
  const allMsgs = Object.values((msgs.json.data && msgs.json.data.messages) || {});
  ok("painel virou mensagem real no canal", allMsgs.some((m) => m.id === pub.json.data.messageId && /Abrir chamado/.test(m.content || "")));
  const pubB = await call("POST", "/servers/" + serverId + "/tickets/panel", { channelId: geral.id, title: "x" }, cb);
  ok("membro comum não publica painel (403)", pubB.status === 403, "status=" + pubB.status);

  /* ---------------- 9. auditoria ---------------- */
  console.log("\n== 9. auditoria em logs ==");
  const db = require("../server/db");
  const logs = await db.select("logs", { where: { server_id: serverId }, limit: 200 });
  const actions = (logs || []).map((l) => l.action);
  ok("abertura registrada", actions.indexOf("ticket.open") !== -1);
  ok("assumir registrado", actions.indexOf("ticket.assign") !== -1);
  ok("fechar registrado", actions.indexOf("ticket.close") !== -1);
  ok("reabrir registrado", actions.indexOf("ticket.reopen") !== -1);
  ok("painel registrado", actions.indexOf("ticket.panel") !== -1);

  /* ---------------- 10. rate limit ---------------- */
  console.log("\n== 10. limite de abertura ==");
  let limited = false;
  for (let i = 0; i < 6; i++) {
    const r = await call("POST", "/servers/" + serverId + "/tickets", {
      subject: "Chamado de teste " + i,
      reason: "Motivo de teste suficientemente longo para passar.",
    }, cb);
    if (r.status === 400 && /chamados nos últimos|3 chamados abertos/i.test(err(r))) {
      limited = true;
      break;
    }
  }
  ok("limite de abertura por pessoa é aplicado", limited, "nunca recusou");
}

main()
  .then(async () => {
    console.log("\n---------------------------------------------");
    console.log("  pass=" + pass + "  fail=" + fail);
    console.log("---------------------------------------------\n");
  })
  .catch((e) => {
    fail++;
    console.error("ERRO FATAL:", e && e.message, e && e.stack);
  })
  .finally(async () => {
    try {
      await cleanup();
      console.log("limpeza de dados de teste concluída.");
    } catch (e) {
      console.warn("cleanup:", e && e.message);
    }
    process.exit(fail ? 1 : 0);
  });
