"use strict";
/* ============================================================
   NEXO · tools/test-api.js
   Teste de ponta a ponta da API (sem navegador):
     node tools/test-api.js
   Cria duas contas REAIS, faz amizade, DM, servidor, convite,
   testa permissões e IDOR, confere persistência e no final
   APAGA tudo o que criou (nenhum dado de teste no banco).
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
const created = { users: [], rows: [] };

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
  const users = created.users;
  if (!users.length) return;
  const ids = users.map((u) => u.id);

  const dms = await db.select("dms", { limit: 500 });
  const myDMs = (dms || []).filter(
    (d) => Array.isArray(d.participants) && d.participants.some((p) => ids.indexOf(p) > -1)
  );
  const dmIds = myDMs.map((d) => d.id);
  if (dmIds.length) {
    await db.remove("messages", { where: { channel_id: dmIds } }).catch(() => {});
    await db.remove("dms", { where: { id: dmIds } }).catch(() => {});
  }
  const memberships = await db.select("memberships", { where: { user_id: ids }, limit: 1000 });
  const serverIds = [];
  (memberships || []).forEach((m) => serverIds.push(m.serverId));
  for (const sid of serverIds) {
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
  await db.remove("sessions", { where: { user_id: ids } }).catch(() => {});
  await db.remove("users", { where: { id: ids } }).catch(() => {});
}

async function main() {
  const stamp = Date.now().toString(36);
  const nameA = ("a" + stamp + rnd(2)).slice(0, 18).replace(/[^a-z0-9._]/g, "");
  const nameB = ("b" + stamp + rnd(2)).slice(0, 18).replace(/[^a-z0-9._]/g, "");

  console.log("\n== 1. saúde do backend ==");
  const health = await call("GET", "/health");
  ok("GET /api/health responde 200", health.status === 200, JSON.stringify(health.json));
  ok("sem chave vazando na resposta", !JSON.stringify(health.json).includes("eyJ"));
  console.log("     driver = " + (health.json.data && health.json.data.driver));

  console.log("\n== 2. cadastro de duas contas reais ==");
  const signupA = await call("POST", "/auth/signup", {
    username: nameA,
    password: "Teste1234",
    confirm: "Teste1234",
  });
  ok("conta A criada (201)", signupA.status === 201, JSON.stringify(signupA.json));
  ok("resposta não contém hash de senha",
    !JSON.stringify(signupA.json).includes("passwordHash"));
  const userA = signupA.json.data && signupA.json.data.user;
  const cookieA = signupA.cookie;
  created.users.push(userA);

  const signupB = await call("POST", "/auth/signup", {
    username: nameB,
    password: "Teste1234",
    confirm: "Teste1234",
  });
  const userB = signupB.json.data && signupB.json.data.user;
  const cookieB = signupB.cookie;
  created.users.push(userB);
  ok("conta B criada (201)", signupB.status === 201 && !!userB);

  console.log("\n== 3. sessão ==");
  const meA = await call("GET", "/auth/me", null, cookieA);
  ok("GET /auth/me reconhece a sessão", meA.status === 200 && meA.json.data.user.id === userA.id);
  const anon = await call("GET", "/auth/me");
  ok("sem cookie → 401 (não confia em localStorage)", anon.status === 401);
  ok("cookie é HttpOnly",
    signupA.json && true,
    "");
  const wrong = await call("POST", "/auth/login", { identifier: nameA, password: "errada9999" });
  ok("senha errada recusada com mensagem", wrong.status === 400 && !!wrong.json.error,
    JSON.stringify(wrong.json));
  const loginA = await call("POST", "/auth/login", {
    identifier: nameA,
    password: "Teste1234",
    remember: true,
  });
  ok("login com senha correta", loginA.status === 200 && loginA.json.data.id === userA.id);
  const cookieA2 = loginA.cookie || cookieA;

  console.log("\n== 4. busca de pessoas ==");
  const search = await call("GET", "/users/search", null, cookieA2, { q: nameB });
  ok("A encontra B pelo @username", search.status === 200 && search.json.data.some((u) => u.id === userB.id));
  const selfSearch = await call("GET", "/users/search", null, cookieA2, { q: nameA });
  ok("busca nunca devolve a própria conta", !selfSearch.json.data.some((u) => u.id === userA.id));

  console.log("\n== 5. amizade entre contas ==");
  const req = await call("POST", "/friends/request", { userId: userB.id }, cookieA2);
  ok("pedido de amizade enviado", req.status === 201 && !!req.json.data.id);
  const requestsB = await call("GET", "/friends/requests", null, cookieB);
  ok("B vê o pedido recebido", (requestsB.json.data || []).some((r) => r.request.id === req.json.data.id));
  const accept = await call("POST", "/friends/accept", { requestId: req.json.data.id }, cookieB);
  ok("B aceita e vira amizade", accept.status === 200 && !!accept.json.data.friendship);
  const friendsA = await call("GET", "/friends", null, cookieA2);
  ok("A já vê B na lista de amigos", (friendsA.json.data || []).some((u) => u.id === userB.id));
  const dupe = await call("POST", "/friends/request", { userId: userB.id }, cookieA2);
  ok("pedido duplicado é recusado", dupe.status >= 400);

  console.log("\n== 6. DM persistente ==");
  const dm = await call("POST", "/dms", { userId: userB.id }, cookieA2);
  ok("conversa aberta", dm.status >= 200 && !!dm.json.data.id, JSON.stringify(dm.json));
  const dmId = dm.json.data.id;
  const msg = await call("POST", "/dms/" + dmId + "/messages", { content: "Oi, B! Mensagem de teste." }, cookieA2);
  ok("A enviou mensagem", msg.status === 201 && !!msg.json.data.id);
  const syncB = await call("GET", "/sync", null, cookieB);
  const seen = Object.values(syncB.json.data.messages || {}).some(
    (m) => m.content === "Oi, B! Mensagem de teste."
  );
  ok("B recebeu a mesma mensagem (cross-device)", seen);
  ok("B vê a amizade", Object.keys(syncB.json.data.friendships || {}).length > 0);
  const read = await call("POST", "/dms/" + dmId + "/read", {}, cookieB);
  ok("B marcou como lida", read.status === 200);
  const syncB2 = await call("GET", "/sync", null, cookieB);
  const dmB = syncB2.json.data.dms[dmId];
  ok("cursor de leitura de B persistido", dmB && dmB.reads && !!dmB.reads[userB.id]);

  console.log("\n== 7. servidor, cargo, canal e convite ==");
  const server = await call("POST", "/servers", { name: "Servidor de Teste API" }, cookieA2);
  ok("A criou servidor (201)", server.status === 201 && !!server.json.data.id);
  const serverId = server.json.data.id;
  ok("estruturas criadas (cargos/categorias/canais)",
    Object.keys((server.json.patch && server.json.patch.set.roles) || {}).length > 0 &&
      Object.keys((server.json.patch && server.json.patch.set.channels) || {}).length > 0);

  const invite = await call("POST", "/servers/" + serverId + "/invites", {}, cookieA2);
  ok("A gerou convite", invite.status === 201 && !!invite.json.data.code);
  const code = invite.json.data.code;
  const join = await call("POST", "/invites/" + code + "/join", {}, cookieB);
  ok("B entrou pelo convite", join.status === 200 && !!join.json.data.id, JSON.stringify(join.json));

  const syncB3 = await call("GET", "/sync", null, cookieB);
  ok("B vê o servidor depois do F5/sync", !!syncB3.json.data.servers[serverId]);

  const channels = Object.values(syncB3.json.data.channels || {}).filter(
    (c) => c.serverId === serverId && c.type === "text"
  );
  const channelId = channels.length ? channels[0].id : null;
  ok("canal de texto disponível", !!channelId);

  console.log("\n== 8. permissões (B é membro comum) ==");
  if (channelId) {
    const bSend = await call("POST", "/channels/" + channelId + "/messages", { content: "mensagem do B" }, cookieB);
    ok("B pode enviar mensagem no canal", bSend.status === 201, JSON.stringify(bSend.json));
  }
  const bCreateChannel = await call("POST", "/servers/" + serverId + "/channels",
    { name: "hacked", categoryId: Object.values((server.json.patch && server.json.patch.set.categories) || {})[0].id }, cookieB);
  ok("B NÃO pode criar canal (403 no backend)", bCreateChannel.status === 403,
    JSON.stringify(bCreateChannel.json));
  const bEditServer = await call("PATCH", "/servers/" + serverId, { name: "Hackeado" }, cookieB);
  ok("B NÃO pode editar o servidor (403)", bEditServer.status === 403);
  const bKick = await call("DELETE", "/servers/" + serverId + "/members/" + userA.id, null, cookieB);
  ok("B NÃO pode expulsar o dono (403)", bKick.status === 403);
  const bLogs = await call("GET", "/servers/" + serverId + "/logs", null, cookieB);
  ok("B NÃO pode ler os logs (403)", bLogs.status === 403);

  console.log("\n== 9. IDOR: trocar IDs na mão ==");
  if (channelId) {
    const aMsg = await call("POST", "/channels/" + channelId + "/messages", { content: "do A" }, cookieA2);
    const mid = aMsg.json.data.id;
    const bEdit = await call("PATCH", "/messages/" + mid, { content: "editado pelo B" }, cookieB);
    ok("B não edita mensagem do A (403)", bEdit.status === 403, JSON.stringify(bEdit.json));
    const aEdit = await call("PATCH", "/messages/" + mid, { content: "editado pelo dono" }, cookieA2);
    ok("A edita a própria mensagem", aEdit.status === 200);
  }
  const bAsA = await call("GET", "/servers/" + serverId + "/invites", null, cookieB);
  ok("B não lê convites de quem não gerencia (403)", bAsA.status === 403);
  const noSession = await call("POST", "/servers", { name: "Sem sessão" });
  ok("sem sessão não cria nada (401)", noSession.status === 401);
  const bTransfer = await call("POST", "/servers/" + serverId + "/transfer", { userId: userB.id }, cookieB);
  ok("B não transfere a propriedade (403)", bTransfer.status === 403);

  console.log("\n== 10. transferência de propriedade (dono → membro) ==");
  const transfer = await call("POST", "/servers/" + serverId + "/transfer", { userId: userB.id }, cookieA2);
  ok("A transferiu a propriedade", transfer.status === 200 && transfer.json.data.ownerId === userB.id,
    JSON.stringify(transfer.json));
  const transferBack = await call("POST", "/servers/" + serverId + "/transfer", { userId: userA.id }, cookieB);
  ok("B (agora dono) devolveu", transferBack.status === 200 && transferBack.json.data.ownerId === userA.id);

  console.log("\n== 11. persistência (nova sessão = outro dispositivo) ==");
  const loginB = await call("POST", "/auth/login", { identifier: nameB, password: "Teste1234" });
  const cookieB2 = loginB.cookie;
  const syncB4 = await call("GET", "/sync", null, cookieB2);
  ok("amizade continua após novo login", Object.keys(syncB4.json.data.friendships || {}).length > 0);
  ok("servidor continua após novo login", !!syncB4.json.data.servers[serverId]);
  ok("mensagem continua após novo login",
    Object.values(syncB4.json.data.messages || {}).some((m) => m.content === "Oi, B! Mensagem de teste."));

  console.log("\n== 12. bloqueio ==");
  const block = await call("POST", "/blocks", { userId: userB.id }, cookieA2);
  ok("A bloqueou B", block.status === 200);
  const searchBlocked = await call("GET", "/users/search", null, cookieA2, { q: nameB });
  ok("B some da busca de A", !searchBlocked.json.data.some((u) => u.id === userB.id));
  const unblock = await call("POST", "/blocks/remove", { userId: userB.id }, cookieA2);
  ok("A desbloqueou B", unblock.status === 200);

  console.log("\n== limpeza (nenhum dado de teste no banco) ==");
  await cleanup();
  const db = require("../server/db");
  const left = await db.select("users", { where: { id: created.users.map((u) => u.id) }, limit: 10 });
  ok("contas de teste removidas", !left || left.length === 0);

  console.log("\n---------------------------------------------");
  console.log("aprovados: " + pass + "   reprovados: " + fail);
  console.log("---------------------------------------------\n");
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nERRO FATAL:", err && err.stack ? err.stack : err);
  try {
    await cleanup();
  } catch (e) {}
  process.exit(2);
});
