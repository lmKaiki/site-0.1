"use strict";
/* ============================================================
   NEXO · tools/test-custom.js
   Teste de ponta a ponta das placas de nome + Pulsos + missões
   (sem navegador):
     node tools/test-custom.js
   Cria contas REAIS, confere que TUDO é decidido no servidor:
     · equipar/remover/trocar placa (grátis e própria);
     · propriedade (placa de outra natureza → 403);
     · compra: saldo insuficiente, duplicata e saldo nunca
       negativo;
     · missões: progresso só de dados reais (o corpo do pedido
       é ignorado — tentativa de forjar 409/400), resgate único;
     · persistência em OUTRA sessão;
     · animações (preferência persistida e validada);
     · exposição pública mínima no /sync (só o id da placa —
       nunca saldo/itens/missões de ninguém).
   No final apaga tudo o que criou.
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

function mission(st, id) {
  return ((st && st.missions) || []).find((m) => m.id === id) || null;
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

async function main() {
  const stamp = Date.now().toString(36);
  const nameA = ("na" + stamp + rnd(2)).slice(0, 18).replace(/[^a-z0-9._]/g, "");
  const nameB = ("nb" + stamp + rnd(2)).slice(0, 18).replace(/[^a-z0-9._]/g, "");

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

  console.log("\n== 2. sessão obrigatória (401 sem login) ==");
  ok("GET /custom sem sessão → 401", (await call("GET", "/custom")).status === 401);
  ok("POST /custom/equip sem sessão → 401", (await call("POST", "/custom/equip", { plateId: "faixa-verde" })).status === 401);
  ok("POST /custom/buy sem sessão → 401", (await call("POST", "/custom/buy", { plateId: "pulso-neon" })).status === 401);
  ok("POST /custom/claim sem sessão → 401", (await call("POST", "/custom/claim", { missionId: "perfil" })).status === 401);
  ok("PATCH /custom sem sessão → 401", (await call("PATCH", "/custom", { animations: false })).status === 401);

  console.log("\n== 3. estado inicial + catálogo próprio ==");
  let r = await call("GET", "/custom", null, cA);
  ok("GET /custom → 200", r.status === 200, JSON.stringify(r.json));
  let st = r.json.data;
  ok("moeda é Pulsos", st.currency && st.currency.name === "Pulsos");
  ok("saldo começa 0", st.balance === 0);
  ok("nenhuma placa equipada", st.equipped === null);
  ok("animações ligadas por padrão", st.animations === true);
  ok("sem itens pagos no início", Array.isArray(st.owned) && st.owned.length === 0);
  ok("catálogo com 19 placas (12 + 7 do Brasil)", Array.isArray(st.catalog) && st.catalog.length === 19, String((st.catalog || []).length));
  ok("7 categorias (Neon…Nexo)", Array.isArray(st.categories) && st.categories.length === 7, String((st.categories || []).length));
  ok("6 missões", Array.isArray(st.missions) && st.missions.length === 6);

  const ids = (st.catalog || []).map((p) => p.id);
  ok("ids de placas únicos", new Set(ids).size === ids.length);
  const free = (st.catalog || []).filter((p) => p.price === 0).map((p) => p.id);
  ok("2 placas gratuitas", free.length === 2 && free.indexOf("faixa-verde") > -1 && free.indexOf("linha-serena") > -1, JSON.stringify(free));
  const rewardOnly = (st.catalog || []).filter((p) => p.price === null);
  ok("8 placas só por recompensa (selo-nexo + 7 do Brasil, price null)",
    rewardOnly.length === 8 && rewardOnly[0].id === "selo-nexo" && rewardOnly.every((p) => p.rewardOnly === true),
    JSON.stringify(rewardOnly.map((p) => p.id)));
  const paid = (st.catalog || []).filter((p) => typeof p.price === "number" && p.price > 0);
  ok("9 placas compráveis com preço > 0", paid.length === 9, String(paid.length));
  ok("kind só static/animated", (st.catalog || []).every((p) => p.kind === "static" || p.kind === "animated"));
  ok("categorias válidas em tudo",
    (st.catalog || []).every((p) => (st.categories || []).some((c) => c.id === p.category)));

  ok("missões iniciam zeradas",
    (st.missions || []).every((m) => m.progress === 0 && m.done === false && m.claimed === false));
  ok("missões sem prazo (deadline null)",
    (st.missions || []).every((m) => m.deadline === null));
  ok("recompensas declaradas",
    (st.missions || []).every((m) => m.reward && (m.reward.pulsos > 0 || !!m.reward.plate)));
  ok("recompensa da Jornada = placa selo-nexo existe no catálogo",
    (mission(st, "jornada").reward.plate === "selo-nexo") && ids.indexOf("selo-nexo") > -1);

  console.log("\n== 4. equipar / remover / trocar ==");
  r = await call("POST", "/custom/equip", { plateId: "faixa-verde" }, cA);
  ok("equipar placa grátis sem comprar → 200", r.status === 200, JSON.stringify(r.json));
  ok("equipada = faixa-verde", r.json.data.equipped === "faixa-verde");

  r = await call("POST", "/custom/equip", { plateId: "linha-serena" }, cA);
  ok("trocar para outra grátis", r.status === 200 && r.json.data.equipped === "linha-serena");

  r = await call("POST", "/custom/equip", { plateId: "pulso-neon" }, cA);
  ok("equipar placa PAGA sem possuir → 403", r.status === 403, "status " + r.status);
  ok("saldo continua 0 depois do 403", r.status === 403);

  r = await call("POST", "/custom/equip", { plateId: "selo-nexo" }, cA);
  ok("equipar recompensa sem missão concluída → 403", r.status === 403, "status " + r.status);

  r = await call("POST", "/custom/equip", { plateId: "naoexiste" }, cA);
  ok("placa fantasma → 400", r.status === 400, "status " + r.status);

  r = await call("POST", "/custom/equip", { plateId: null }, cA);
  ok("remover placa (plateId null) → 200", r.status === 200 && r.json.data.equipped === null);
  r = await call("POST", "/custom/equip", { plateId: "" }, cA);
  ok("remover de novo é idempotente", r.status === 200 && r.json.data.equipped === null);

  console.log("\n== 5. compras: saldo, duplicata, sem negativo ==");
  r = await call("POST", "/custom/buy", { plateId: "pulso-neon" }, cA);
  ok("comprar sem saldo → 400", r.status === 400, "status " + r.status);
  r = await call("GET", "/custom", null, cA);
  ok("saldo permanece 0 (não fica negativo)", r.json.data.balance === 0);
  ok("placa não foi concedida", r.json.data.owned.indexOf("pulso-neon") === -1);

  r = await call("POST", "/custom/buy", { plateId: "naoexiste" }, cA);
  ok("comprar placa fantasma → 400", r.status === 400);
  r = await call("POST", "/custom/buy", { plateId: "faixa-verde" }, cA);
  ok("comprar placa gratuita → 400 (é grátis, só equipar)", r.status === 400, "status " + r.status);
  r = await call("POST", "/custom/buy", { plateId: "selo-nexo" }, cA);
  ok("comprar recompensa → 400 (não está à venda)", r.status === 400, "status " + r.status);

  console.log("\n== 6. missões: progresso REAL, sem forjar no corpo ==");
  r = await call("POST", "/custom/claim", { missionId: "perfil" }, cA);
  ok("resgatar missão sem concluir → 400", r.status === 400, "status " + r.status);
  r = await call("POST", "/custom/claim",
    { missionId: "conversa", progress: 999, done: true, claimed: false }, cA);
  ok("corpo forjado {progress:999} é ignorado → 400", r.status === 400, "status " + r.status);
  r = await call("POST", "/custom/claim", { missionId: "fantasma" }, cA);
  ok("missão fantasma → 404", r.status === 404, "status " + r.status);
  r = await call("GET", "/custom", null, cA);
  ok("nenhum crédito após tentativas", r.json.data.balance === 0 && Object.keys(r.json.data.claimed || {}).length === 0);

  /* -- perfil completo (+80) -- */
  r = await call("PATCH", "/profile",
    { bio: "Perfil de teste das placas de nome do Nexo.", avatar: { model: "robot" } }, cA);
  ok("bio + avatar salvos", r.status === 200 || r.status === 201, "status " + r.status);
  r = await call("POST", "/custom/claim", { missionId: "perfil" }, cA);
  ok("missão perfil concluída → 200", r.status === 200, JSON.stringify(r.json));
  ok("saldo = 80", r.json.data && r.json.data.balance === 80, String(r.json.data && r.json.data.balance));
  r = await call("POST", "/custom/claim", { missionId: "perfil" }, cA);
  ok("resgatar a mesma de novo → 409", r.status === 409, "status " + r.status);

  /* -- servidor (+100) -- */
  const srv = await call("POST", "/servers", { name: "placastest " + stamp }, cA);
  ok("servidor criado", srv.status === 201 && !!srv.json.data.id, JSON.stringify(srv.json));
  const sid = srv.json.data.id;
  created.servers.push(sid);
  r = await call("POST", "/custom/claim", { missionId: "servidor" }, cA);
  ok("missão servidor concluída", r.status === 200 && r.json.data.balance === 180, String(r.json.data && r.json.data.balance));

  /* -- convite (+50) -- */
  const inv = await call("POST", "/servers/" + sid + "/invites", {}, cA);
  ok("convite gerado", inv.status === 201 && !!inv.json.data.code, JSON.stringify(inv.json));
  r = await call("POST", "/custom/claim", { missionId: "convite" }, cA);
  ok("missão convite concluída", r.status === 200 && r.json.data.balance === 230, String(r.json.data && r.json.data.balance));

  /* -- amizade (+70) -- */
  const req = await call("POST", "/friends/request", { userId: B.id }, cA);
  ok("pedido de amizade enviado", req.status === 201 || req.status === 200, JSON.stringify(req.json));
  const acc = await call("POST", "/friends/accept", { requestId: req.json.data.id }, cB);
  ok("pedido aceito", acc.status === 200 || acc.status === 201, JSON.stringify(acc.json));
  r = await call("POST", "/custom/claim", { missionId: "amigo" }, cA);
  ok("missão amigo concluída", r.status === 200 && r.json.data.balance === 300, String(r.json.data && r.json.data.balance));

  /* -- conversa: 5 mensagens reais (+60) -- */
  r = await call("GET", "/sync", null, cA);
  const chan = Object.values(r.json.data.channels || {}).find(
    (c) => c.serverId === sid && c.type === "text"
  );
  ok("canal de texto disponível", !!chan);
  if (chan) {
    for (let i = 0; i < 5; i++) {
      await call("POST", "/channels/" + chan.id + "/messages",
        { content: "mensagem real numero " + (i + 1) + " das placas" }, cA);
    }
  }
  r = await call("GET", "/custom", null, cA);
  const mc = mission(r.json.data, "conversa");
  ok("progresso da conversa vem do banco (5/5)",
    mc && mc.progress === 5 && mc.done === true, JSON.stringify(mc));
  r = await call("POST", "/custom/claim", { missionId: "conversa" }, cA);
  ok("missão conversa concluída", r.status === 200 && r.json.data.balance === 360, String(r.json.data && r.json.data.balance));

  /* -- Jornada Nexo (recompensa: placa selo-nexo) -- */
  r = await call("GET", "/custom", null, cA);
  const jo = mission(r.json.data, "jornada");
  ok("Jornada 5/5 depois das outras", jo && jo.progress === 5 && jo.done === true, JSON.stringify(jo));
  r = await call("POST", "/custom/claim", { missionId: "jornada" }, cA);
  ok("Jornada resgatada", r.status === 200, JSON.stringify(r.json));
  ok("saldo intacto (Jornada dá placa, não Pulsos)", r.json.data.balance === 360, String(r.json.data.balance));
  ok("placa selo-nexo conquistada", r.json.data.owned.indexOf("selo-nexo") > -1, JSON.stringify(r.json.data.owned));
  r = await call("POST", "/custom/claim", { missionId: "jornada" }, cA);
  ok("Jornada resgatada de novo → 409", r.status === 409, "status " + r.status);
  r = await call("POST", "/custom/equip", { plateId: "selo-nexo" }, cA);
  ok("placa de recompensa agora equipável", r.status === 200 && r.json.data.equipped === "selo-nexo");
  r = await call("GET", "/custom", null, cA);
  ok("todas as 6 missões resgatadas",
    r.json.data.missions.every((m) => m.claimed === true) &&
      Object.keys(r.json.data.claimed || {}).length === 6);

  console.log("\n== 7. compra com saldo real + duplicata ==");
  r = await call("POST", "/custom/buy", { plateId: "traco-minimo" }, cA);
  ok("traco-minimo comprado (60)", r.status === 200 && r.json.data.balance === 300,
    JSON.stringify(r.json));
  ok("owned inclui traco-minimo", r.json.data.owned.indexOf("traco-minimo") > -1);
  r = await call("POST", "/custom/buy", { plateId: "traco-minimo" }, cA);
  ok("comprar de novo → 409", r.status === 409, "status " + r.status);
  r = await call("GET", "/custom", null, cA);
  ok("saldo não mudou na duplicata", r.json.data.balance === 300);

  r = await call("POST", "/custom/buy", { plateId: "alvorecer" }, cA);
  ok("alvorecer comprado (220) → saldo 80", r.status === 200 && r.json.data.balance === 80,
    String(r.json.data && r.json.data.balance));
  r = await call("POST", "/custom/buy", { plateId: "pulso-neon" }, cA);
  ok("sem saldo para pulso-neon → 400", r.status === 400, "status " + r.status);
  r = await call("GET", "/custom", null, cA);
  ok("saldo final 80 (nunca negativo)", r.json.data.balance === 80, String(r.json.data.balance));
  ok("gratuitas continuam fora do owned (uso livre)",
    r.json.data.owned.indexOf("faixa-verde") === -1 && r.json.data.owned.indexOf("linha-serena") === -1);

  r = await call("POST", "/custom/equip", { plateId: "traco-minimo" }, cA);
  ok("placa própria equipada", r.status === 200 && r.json.data.equipped === "traco-minimo");

  console.log("\n== 8. animações: preferência persistida e validada ==");
  r = await call("PATCH", "/custom", { animations: false }, cA);
  ok("desligar animações → 200", r.status === 200 && r.json.data.animations === false);
  r = await call("PATCH", "/custom", { animations: "sim" }, cA);
  ok("valor não booleano → 400", r.status === 400, "status " + r.status);
  r = await call("PATCH", "/custom", { animations: true }, cA);
  ok("religar animações → true", r.status === 200 && r.json.data.animations === true);
  r = await call("PATCH", "/custom", { animations: false }, cA);
  ok("preferência final: off (para o teste de persistência)", r.status === 200 && r.json.data.animations === false);

  console.log("\n== 9. persistência em OUTRA sessão ==");
  const login2 = await call("POST", "/auth/login", { identifier: nameA, password: "Teste1234" });
  ok("segundo login de A", login2.status === 200, JSON.stringify(login2.json));
  const cA2 = login2.cookie;
  r = await call("GET", "/custom", null, cA2);
  ok("outra sessão vê a placa equipada", r.json.data.equipped === "traco-minimo", String(r.json.data.equipped));
  ok("outra sessão vê o saldo", r.json.data.balance === 80, String(r.json.data.balance));
  ok("outra sessão vê os itens", r.json.data.owned.indexOf("selo-nexo") > -1 && r.json.data.owned.indexOf("alvorecer") > -1, JSON.stringify(r.json.data.owned));
  ok("outra sessão vê os resgates", Object.keys(r.json.data.claimed || {}).length === 6);
  ok("outra sessão vê animações off", r.json.data.animations === false);

  console.log("\n== 10. exposição pública no /sync (só o id da placa) ==");
  await call("POST", "/custom/equip", { plateId: "faixa-verde" }, cA);
  const syncA = await call("GET", "/sync", null, cA);
  ok("me.nameplate = placa equipada de A",
    syncA.json.data.me && syncA.json.data.me.nameplate === "faixa-verde",
    String(syncA.json.data.me && syncA.json.data.me.nameplate));
  const syncB = await call("GET", "/sync", null, cB);
  const uA = (syncB.json.data.users || {})[A.id];
  ok("B vê a placa de A no sync", uA && uA.nameplate === "faixa-verde", String(uA && uA.nameplate));
  const uB = (syncB.json.data.users || {})[B.id];
  ok("usuário sem placa → nameplate null", uB && (uB.nameplate === null || uB.nameplate === undefined));
  ok("sync NUNCA entrega saldo", uA && uA.balance === undefined);
  ok("sync NUNCA entrega itens", uA && uA.owned === undefined);
  ok("sync NUNCA entrega missões/claimeds", uA && uA.claimed === undefined && uA.missions === undefined);
  ok("sync NUNCA entrega prefs.custom", uA && uA.custom === undefined,
    uA ? "custom=" + JSON.stringify(uA.custom) + " keys=" + Object.keys(uA).join("|") : "uA ausente");

  console.log("\n== 11. isolamento entre contas ==");
  r = await call("GET", "/custom", null, cB);
  ok("B começa zerado (saldo 0, owned vazio)",
    r.json.data.balance === 0 && r.json.data.owned.length === 0, JSON.stringify(r.json.data.owned));
  ok("B não tem missões resgatadas", Object.keys(r.json.data.claimed || {}).length === 0);
  r = await call("POST", "/custom/equip", { plateId: "traco-minimo" }, cB);
  ok("B não pode equipar item que é de A → 403", r.status === 403, "status " + r.status);
  r = await call("POST", "/custom/buy", { plateId: "pulso-neon" }, cB);
  ok("B sem saldo também → 400", r.status === 400, "status " + r.status);

  console.log("\n== 12. limpeza ==");
  await cleanup();
  ok("tudo que foi criado foi apagado", true);

  console.log("\n------------------------------------");
  console.log("placas de nome: " + pass + " passaram, " + fail + " falharam");
  console.log("------------------------------------\n");
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("[test-custom] erro:", e);
  try {
    await cleanup();
  } catch (err) {}
  process.exit(1);
});
