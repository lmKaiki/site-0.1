"use strict";
/* ============================================================
   NEXO · tools/test-brasil.js
   Conquistas do Brasil 🇧🇷 — placas desbloqueadas ao convidar:
      node tools/test-brasil.js          (sqlite por padrão)
      NEXO_DB=supabase node tools/test-brasil.js
   Cria contas REAIS e confere que TUDO é decidido no servidor:
      · catálogo: 7 placas da coleção com metas exatas
        (1, 3, 5, 10, 20, 35, 50) e placas normais sem meta;
      · gerar/copiar/visualizar convite NÃO desbloqueia nada;
      · entrada real da 2ª conta pelo convite → 1ª placa
        desbloqueada SÓ para quem convidou (não para quem entrou);
      · notificação de conquista para o convidador;
      · equipar (quem tem a placa) / recusar compra (não é
        vendida) / recusar claim (conquista não é missão);
      · fraudes: mesma pessoa não conta 2x, auto-entrada não
        conta, rota genérica /servers/:id/join não conta, código
        falso recusado;
      · metas progressivas (2ª e 3ª placas) e metade de entradas
        disparadas em PARALELO — contagem exata, sem duplicar;
      · persistência em outra sessão (login novo).
   No final apaga tudo o que criou.
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

const META_HREF = "#/loja";
const TIERS = [
  ["sol-de-neon", 1],
  ["cruzeiro-do-sul", 3],
  ["mata-atlantica", 5],
  ["faixa-amarela", 10],
  ["moeda-de-ouro", 20],
  ["carnaval-de-luz", 35],
  ["brasil-nexo", 50],
];
const BR_IDS = TIERS.map((t) => t[0]);

function metaOf(n) {
  let m = n && n.meta;
  if (typeof m === "string") {
    try {
      m = JSON.parse(m);
    } catch (e) {
      m = null;
    }
  }
  return m && typeof m === "object" ? m : null;
}

async function conquestNotes(userId) {
  const db = require("../server/db");
  const rows = (await db.select("notifications", { where: { user_id: userId }, limit: 200 }).catch(() => [])) || [];
  return rows.filter((n) => n && n.type === "conquest");
}

async function cleanup() {
  const db = require("../server/db");
  const ids = created.users.map((u) => u.id);
  if (!ids.length) return;
  for (const sid of created.servers) {
    const chans = await db.select("channels", { where: { server_id: sid } }).catch(() => []);
    const chIds = (chans || []).map((c) => c.id);
    if (chIds.length)
      await db.remove("messages", { where: { channel_id: chIds } }).catch(() => {});
    await db.remove("voice", { where: { server_id: sid } }).catch(() => {});
    await db.remove("channels", { where: { server_id: sid } }).catch(() => {});
    await db.remove("categories", { where: { server_id: sid } }).catch(() => {});
    await db.remove("roles", { where: { server_id: sid } }).catch(() => {});
    await db.remove("invites", { where: { server_id: sid } }).catch(() => {});
    await db.remove("logs", { where: { server_id: sid } }).catch(() => {});
    await db.remove("memberships", { where: { server_id: sid } }).catch(() => {});
    await db.remove("servers", { where: { id: sid } }).catch(() => {});
  }
  await db.remove("voice", { where: { user_id: ids } }).catch(() => {});
  await db.remove("dm_messages", { where: { sender_id: ids } }).catch(() => {});
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

async function signup(prefix) {
  const stamp = Date.now().toString(36);
  const username = (prefix + stamp + rnd(2)).slice(0, 18).replace(/[^a-z0-9._]/g, "");
  const su = await call("POST", "/auth/signup", {
    username: username,
    password: "Teste1234",
    confirm: "Teste1234",
  });
  if (su.status !== 201) throw new Error("signup falhou: " + JSON.stringify(su.json));
  created.users.push(su.json.data.user);
  return { user: su.json.data.user, cookie: su.cookie };
}

async function customState(cookie) {
  const r = await call("GET", "/custom", null, cookie);
  if (r.status !== 200) throw new Error("GET /custom falhou: " + r.status);
  return r.json.data;
}

function tierOf(st, plateId) {
  return ((st && st.brasil && st.brasil.tiers) || []).find((t) => t.plateId === plateId) || null;
}

async function main() {
  console.log("\n== 1. contas reais (convidador + convidados) ==");
  const a = await signup("nbra");
  const b = await signup("nbrb");
  const c = await signup("nbrc");
  const d = await signup("nbrd");
  const e = await signup("nbre");
  const f1 = await signup("nbrf");
  const f2 = await signup("nbrg");
  const f3 = await signup("nbrh");
  const A = a.user, cA = a.cookie;
  const B = b.user, cB = b.cookie;
  const C = c.user, cC = c.cookie;
  const D = d.user, cD = d.cookie;
  const E = e.user, cE = e.cookie;
  const F1 = f1.user, cF1 = f1.cookie;
  const F2 = f2.user, cF2 = f2.cookie;
  const F3 = f3.user, cF3 = f3.cookie;
  ok("8 contas criadas", [cA, cB, cC, cD, cE, cF1, cF2, cF3].every(Boolean));

  console.log("\n== 2. coleção Brasil no catálogo + estado zerado ==");
  let st = await customState(cA);
  ok("seção brasil presente com invitees 0",
    st.brasil && st.brasil.invitees === 0, JSON.stringify(st.brasil && st.brasil.invitees));
  ok("7 metas, na ordem exata (1,3,5,10,20,35,50)",
    Array.isArray(st.brasil.tiers) && st.brasil.tiers.length === 7 &&
      TIERS.every((t, i) => st.brasil.tiers[i].plateId === t[0] && st.brasil.tiers[i].goal === t[1]),
    JSON.stringify((st.brasil.tiers || []).map((t) => t.plateId + ":" + t.goal)));
  ok("nenhuma meta desbloqueada no início",
    st.brasil.tiers.every((t) => t.unlocked === false && t.progress === 0));
  ok("próxima recompensa = Sol de Neon (1)",
    st.brasil.next && st.brasil.next.plateId === "sol-de-neon" && st.brasil.next.goal === 1);
  const catBr = (st.catalog || []).filter((p) => BR_IDS.indexOf(p.id) > -1);
  ok("7 placas da coleção no catálogo, todas price null + rewardOnly",
    catBr.length === 7 && catBr.every((p) => p.price === null && p.rewardOnly === true),
    JSON.stringify(catBr.map((p) => p.id)));
  ok("brasilGoal do catálogo = metas da configuração",
    TIERS.every((t) => {
      const p = (st.catalog || []).find((x) => x.id === t[0]);
      return p && p.brasilGoal === t[1];
    }));
  const catNormal = (st.catalog || []).filter((p) => BR_IDS.indexOf(p.id) === -1);
  ok("placas fora da coleção ficam sem meta (brasilGoal null)",
    catNormal.length === 12 && catNormal.every((p) => p.brasilGoal === null),
    String(catNormal.length));
  ok("nenhuma placa Brasil desbloqueada no início",
    BR_IDS.every((id) => st.owned.indexOf(id) === -1));

  console.log("\n== 3. criar/copiar convite NÃO conta =="); 
  const sv = await call("POST", "/servers", { name: "Servidor Brasil " + Date.now().toString(36) }, cA);
  ok("A cria servidor", sv.status === 201 && sv.json.data.id, JSON.stringify(sv.json));
  const serverId = sv.json.data.id;
  created.servers.push(serverId);
  const inv = await call("POST", "/servers/" + serverId + "/invites", {}, cA);
  ok("convite criado", inv.status === 201 && inv.json.data.code, JSON.stringify(inv.json));
  const code = inv.json.data.code;
  ok("ver o convite (preview) não conta",
    (await call("GET", "/invites/" + code, null, cA)).status === 200);
  st = await customState(cA);
  ok("invitees continua 0 após criar/ver convite", st.brasil.invitees === 0);
  ok("Sol de Neon continua bloqueada", tierOf(st, "sol-de-neon").unlocked === false);

  console.log("\n== 4. entrada real da 2ª conta pelo convite ==");
  const jB = await call("POST", "/invites/" + code + "/join", {}, cB);
  ok("B entra pelo convite → 200", jB.status === 200, JSON.stringify(jB.json));
  st = await customState(cA);
  ok("A: invitees = 1", st.brasil.invitees === 1, String(st.brasil.invitees));
  ok("A: Sol de Neon desbloqueada (meta 1)", tierOf(st, "sol-de-neon").unlocked === true);
  ok("A: placa já entra em owned (equipável)", st.owned.indexOf("sol-de-neon") > -1);
  ok("A: próxima = Cruzeiro do Sul (3), progresso 1/3",
    st.brasil.next && st.brasil.next.plateId === "cruzeiro-do-sul" &&
      st.brasil.next.progress === 1 && st.brasil.next.goal === 3,
    JSON.stringify(st.brasil.next));
  let stB = await customState(cB);
  ok("B (quem entrou) NÃO ganha a conquista", stB.brasil.invitees === 0 && BR_IDS.every((id) => stB.owned.indexOf(id) === -1));
  const notesA = await conquestNotes(A.id);
  ok("notificação de conquista para A (type conquest, href #/loja, texto Sol de Neon)",
    notesA.length === 1 && notesA[0].text.indexOf("Sol de Neon") > -1 && (metaOf(notesA[0]) || {}).href === META_HREF,
    JSON.stringify(notesA));
  ok("B não recebe notificação de conquista", (await conquestNotes(B.id)).length === 0);

  console.log("\n== 5. equipar / não é vendida / não é missão ==");
  let r = await call("POST", "/custom/equip", { plateId: "sol-de-neon" }, cB);
  ok("B tenta equipar placa alheia → 403", r.status === 403, String(r.status));
  r = await call("POST", "/custom/equip", { plateId: "sol-de-neon" }, cA);
  ok("A equipa a placa conquistada → 200", r.status === 200 && r.json.data.equipped === "sol-de-neon", JSON.stringify(r.json));
  r = await call("POST", "/custom/buy", { plateId: "sol-de-neon" }, cA);
  ok("comprar placa da coleção → 400 (não é vendida)", r.status === 400, String(r.status));
  r = await call("POST", "/custom/claim", { missionId: "sol-de-neon" }, cA);
  ok("conquista não vem por claim de missão → 404", r.status === 404, String(r.status));

  console.log("\n== 6. fraudes não contam ==");
  st = await customState(cA);
  const invitesBefore = st.brasil.invitees;
  r = await call("POST", "/invites/" + code + "/join", {}, cB);
  ok("B tenta entrar de novo → 400 (já faz parte)", r.status === 400, String(r.status));
  r = await call("POST", "/invites/" + code + "/join", {}, cA);
  ok("A tenta entrar pelo próprio convite → 400 (auto-entrada não conta)", r.status === 400, String(r.status));
  r = await call("POST", "/servers/" + serverId + "/join", { invite: inv.json.data }, cC);
  ok("C entra pela rota genérica /servers/:id/join → 200", r.status === 200, JSON.stringify(r.json));
  ok("...mas NÃO conta para a conquista de A", (await customState(cA)).brasil.invitees === invitesBefore);
  r = await call("POST", "/invites/" + code + "/join", {}, cC);
  ok("C tenta o convite canônico depois → 400 (não duplica)", r.status === 400, String(r.status));
  r = await call("POST", "/invites/ZZZZ99/join", {}, cD);
  ok("código falso → 400", r.status === 400, String(r.status));
  st = await customState(cA);
  ok("invitees ainda 1 após todas as tentativas", st.brasil.invitees === 1, String(st.brasil.invitees));

  console.log("\n== 7. saída libera e metas progressivas ==");
  r = await call("POST", "/servers/" + serverId + "/leave", {}, cC);
  ok("C sai do servidor", r.status === 200, String(r.status));
  r = await call("POST", "/invites/" + code + "/join", {}, cD);
  ok("D entra pelo convite → 200", r.status === 200, JSON.stringify(r.json));
  st = await customState(cA);
  ok("A: invitees = 2, próxima Cruzeiro do Sul 2/3",
    st.brasil.invitees === 2 && st.brasil.next.plateId === "cruzeiro-do-sul" &&
      st.brasil.next.progress === 2,
    JSON.stringify({ n: st.brasil.invitees, next: st.brasil.next }));
  r = await call("POST", "/invites/" + code + "/join", {}, cE);
  ok("E entra pelo convite → 200", r.status === 200, JSON.stringify(r.json));
  st = await customState(cA);
  ok("A: invitees = 3 e Cruzeiro do Sul desbloqueada",
    st.brasil.invitees === 3 && tierOf(st, "cruzeiro-do-sul").unlocked === true,
    String(st.brasil.invitees));
  ok("A: Sol de Neon continua desbloqueada (nada é perdido)",
    st.owned.indexOf("sol-de-neon") > -1 && st.owned.indexOf("cruzeiro-do-sul") > -1);
  ok("A: próxima = Mata Atlântica (5) com 3/5",
    st.brasil.next.plateId === "mata-atlantica" && st.brasil.next.progress === 3,
    JSON.stringify(st.brasil.next));
  const notesA2 = await conquestNotes(A.id);
  ok("2ª notificação de conquista (Cruzeiro do Sul)",
    notesA2.length === 2 && notesA2.some((n) => n.text.indexOf("Cruzeiro do Sul") > -1),
    String(notesA2.length));

  console.log("\n== 8. entradas simultâneas não duplicam =="); 
  const par = await Promise.all([
    call("POST", "/invites/" + code + "/join", {}, cF1),
    call("POST", "/invites/" + code + "/join", {}, cF2),
    call("POST", "/invites/" + code + "/join", {}, cF3),
  ]);
  ok("3 entradas em paralelo → todas 200", par.every((x) => x.status === 200), JSON.stringify(par.map((x) => x.status)));
  st = await customState(cA);
  ok("A: invitees = 6 EXATOS (cada pessoa conta 1x)", st.brasil.invitees === 6, String(st.brasil.invitees));
  ok("A: Mata Atlântica (5) desbloqueada; próxima Faixa Amarela 6/10",
    tierOf(st, "mata-atlantica").unlocked === true &&
      st.brasil.next.plateId === "faixa-amarela" && st.brasil.next.progress === 6,
    JSON.stringify(st.brasil.next));
  ok("A: owned = 3 placas da coleção",
    ["sol-de-neon", "cruzeiro-do-sul", "mata-atlantica"].every((id) => st.owned.indexOf(id) > -1) &&
      BR_IDS.filter((id) => st.owned.indexOf(id) > -1).length === 3,
    JSON.stringify(st.owned));

  console.log("\n== 9. persistência em outra sessão ==");
  const lg = await call("POST", "/auth/login", { identifier: A.username, password: "Teste1234" });
  ok("A loga de novo → 200", lg.status === 200, JSON.stringify(lg.json));
  st = await customState(lg.cookie);
  ok("estado novo: invitees 6 + 3 placas + placa equipada",
    st.brasil.invitees === 6 &&
      BR_IDS.filter((id) => st.owned.indexOf(id) > -1).length === 3 &&
      st.equipped === "sol-de-neon",
    JSON.stringify({ n: st.brasil.invitees, eq: st.equipped }));
  const sy = await call("GET", "/sync", null, lg.cookie);
  const syNotes = ((sy.json.data && sy.json.data.notifications) || []).filter(
    (n) => n && n.type === "conquest"
  );
  ok("conquistas seguem no /sync da nova sessão (3 notificações)",
    syNotes.length === 3 &&
      ["Sol de Neon", "Cruzeiro do Sul", "Mata Atlântica"].every((nm) =>
        syNotes.some((n) => n.text.indexOf(nm) > -1)
      ),
    JSON.stringify(syNotes.map((n) => n.text)));
  stB = await customState(cF3);
  ok("F3 (quem entrou por último) não tem conquista", stB.brasil.invitees === 0);

  console.log("\n========================================");
  console.log("RESULTADO: " + pass + " passaram, " + fail + " falharam");
  console.log("========================================");
  await cleanup();
  console.log("limpeza executada");
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error("ERRO FATAL:", e && e.stack ? e.stack : e);
  try {
    await cleanup();
    console.log("limpeza de emergência executada");
  } catch (e2) {}
  process.exit(1);
});
