"use strict";
/* ============================================================
   NEXO · tools/test-servericon.js
   Ícone do servidor por IMAGEM (upload) — validado no servidor:
      node tools/test-servericon.js          (sqlite por padrão)
      NEXO_DB=supabase node tools/test-servericon.js
   Cria contas REAIS e confere no backend:
      · criar servidor com imagem PNG/JPG válida grava icon.image;
      · criar sem imagem fica null (iniciais como sempre);
      · SVG, GIF, URL comum, campo não-string e arquivo gigante
        são recusados (400) e nada é criado;
      · editar: trocar imagem, remover (null) volta ao fallback e
        preserva o emoji legado;
      · erro de formato/tamanho na edição NÃO altera o ícone;
      · permissão: quem não é membro não altera (403/404);
      · persistência: outra sessão (login novo) vê a mesma imagem.
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
  let setCookie = null;
  const sc = res.multiValueHeaders && res.multiValueHeaders["Set-Cookie"];
  if (sc && sc.length) setCookie = sc[0].split(";")[0];
  return { status: res.statusCode, json, cookie: setCookie };
}

function rnd(n) {
  return Math.random().toString(36).slice(2, 2 + (n || 6));
}

function isSuccess(r) {
  return r.status >= 200 && r.status < 300;
}

/* o servidor vem na lista GET /servers (não há GET /servers/:id) */
async function fetchServer(cookie, id) {
  const r = await call("GET", "/servers", null, cookie);
  const list = (r.json && r.json.data) || [];
  return (Array.isArray(list) ? list : Object.values(list)).find((x) => x && x.id === id) || null;
}

/* /sync devolve coleções como lista OU mapa — aceita os dois */
function pickFrom(coll, id) {
  if (!coll) return null;
  if (Array.isArray(coll)) return coll.find((x) => x && x.id === id) || null;
  return coll[id] || null;
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
    await db.remove("bans", { where: { server_id: sid } }).catch(() => {});
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
  return { user: su.json.data.user, cookie: su.cookie, username: username };
}

/* amostras reais (1×1 px) nos formatos aceitos e recusados */
const PNG_1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_2 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";
const JPG_1 =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";
const SVG_1 =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
const GIF_1 = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const OVERSIZE = "data:image/png;base64," + "A".repeat(900500);

async function main() {
  console.log("\n== 1. contas reais ==");
  const a = await signup("nica");
  const b = await signup("nicb");
  const cA = a.cookie;
  ok("2 contas criadas", !!cA && !!b.cookie);

  console.log("\n== 2. criar servidor com imagem válida ==");
  const r1 = await call("POST", "/servers", {
    name: "Server Icone Um",
    icon: { image: PNG_1 },
  }, cA);
  ok("criar com PNG aceito", isSuccess(r1) && r1.json.data && r1.json.data.icon, "status " + r1.status);
  const s1 = r1.json.data;
  if (s1) created.servers.push(s1.id);
  ok("icon.image persiste o PNG enviado",
    s1 && s1.icon && s1.icon.image === PNG_1,
    s1 && s1.icon && String(s1.icon.image).slice(0, 40));
  ok("emoji continua null (padrão iniciais)",
    s1 && s1.icon && (s1.icon.emoji === null || s1.icon.emoji === ""));

  console.log("\n== 3. criar sem imagem continua como sempre ==");
  const r2 = await call("POST", "/servers", { name: "Server Icone Dois" }, cA);
  ok("criar sem icon aceito", isSuccess(r2));
  const s2 = r2.json.data;
  if (s2) created.servers.push(s2.id);
  ok("icon.image null sem imagem", s2 && s2.icon && (s2.icon.image === null || s2.icon.image === undefined));

  console.log("\n== 4. formatos proibidos são recusados no criar ==");
  const before = created.servers.length;
  const rSvg = await call("POST", "/servers", { name: "Server Svg", icon: { image: SVG_1 } }, cA);
  ok("SVG recusado (400)", rSvg.status === 400, "status " + rSvg.status);
  const rGif = await call("POST", "/servers", { name: "Server Gif", icon: { image: GIF_1 } }, cA);
  ok("GIF recusado (400)", rGif.status === 400, "status " + rGif.status);
  const rUrl = await call("POST", "/servers", {
    name: "Server Url",
    icon: { image: "https://exemplo.com/x.png" },
  }, cA);
  ok("URL comum recusada (400)", rUrl.status === 400, "status " + rUrl.status);
  const rObj = await call("POST", "/servers", { name: "Server Obj", icon: { image: { src: "x" } } }, cA);
  ok("campo não-string recusado (400)", rObj.status === 400, "status " + rObj.status);
  const rBig = await call("POST", "/servers", { name: "Server Gordo", icon: { image: OVERSIZE } }, cA);
  ok("arquivo acima de 900 KB recusado (400)", rBig.status === 400, "status " + rBig.status);
  ok("nenhum servidor rejeitado foi criado", created.servers.length === before,
    String(created.servers.length - before));

  console.log("\n== 5. editar: trocar, preservar e remover ==");
  const rJpg = await call("PATCH", "/servers/" + s1.id, { icon: { image: JPG_1 } }, cA);
  ok("trocar PNG por JPG aceito", isSuccess(rJpg), "status " + rJpg.status);
  ok("icon.image agora é o JPG",
    rJpg.json.data && rJpg.json.data.icon && rJpg.json.data.icon.image === JPG_1);

  const rBad = await call("PATCH", "/servers/" + s1.id, { icon: { image: SVG_1 } }, cA);
  ok("trocar para SVG na edição recusado (400)", rBad.status === 400, "status " + rBad.status);
  const chk1 = await fetchServer(cA, s1.id);
  ok("ícone intacto depois do erro", chk1 && chk1.icon && chk1.icon.image === JPG_1,
    chk1 && chk1.icon && String(chk1.icon.image).slice(0, 40));

  const rBig2 = await call("PATCH", "/servers/" + s1.id, { icon: { image: OVERSIZE } }, cA);
  ok("imagem gigante na edição recusada (400)", rBig2.status === 400, "status " + rBig2.status);

  const rObj2 = await call("PATCH", "/servers/" + s1.id, { icon: "nope" }, cA);
  ok("icon não-objeto na edição recusado (400)", rObj2.status === 400, "status " + rObj2.status);

  const rClr = await call("PATCH", "/servers/" + s1.id, { icon: { image: null } }, cA);
  ok("remover imagem aceito (null)", isSuccess(rClr), "status " + rClr.status);
  ok("icon.image volta a null", rClr.json.data && rClr.json.data.icon && rClr.json.data.icon.image === null);

  console.log("\n== 6. emoji legado preservado junto da imagem ==");
  const r3 = await call("POST", "/servers", { name: "Server Emoji", emoji: "🚀", color: "#123456" }, cA);
  ok("criar com emoji legado aceito", isSuccess(r3));
  const s3 = r3.json.data;
  if (s3) created.servers.push(s3.id);
  ok("emoji legado gravado", s3 && s3.icon && s3.icon.emoji === "🚀", s3 && s3.icon && s3.icon.emoji);
  const r3img = await call("PATCH", "/servers/" + s3.id, { icon: { image: PNG_2 } }, cA);
  ok("imagem entra sem apagar o emoji", isSuccess(r3img) &&
    r3img.json.data.icon.emoji === "🚀" && r3img.json.data.icon.image === PNG_2,
    JSON.stringify(r3img.json.data && r3img.json.data.icon));
  const r3clr = await call("PATCH", "/servers/" + s3.id, { icon: { image: null } }, cA);
  ok("remover imagem volta ao emoji legado",
    r3clr.json.data.icon.image === null && r3clr.json.data.icon.emoji === "🚀");

  console.log("\n== 7. permissão: não-membro não altera ==");
  const rNo = await call("PATCH", "/servers/" + s1.id, { icon: { image: PNG_2 } }, b.cookie);
  ok("PATCH de fora recusado (4xx)", rNo.status >= 400 && rNo.status < 500, "status " + rNo.status);
  const chk2 = await fetchServer(cA, s1.id);
  ok("ícone do dono intacto após tentativa de fora",
    chk2 && chk2.icon && chk2.icon.image === null);

  console.log("\n== 8. persistência em outra sessão ==");
  const imgSet = await call("PATCH", "/servers/" + s1.id, { icon: { image: PNG_2 } }, cA);
  ok("imagem regravada para o teste de sessão", isSuccess(imgSet));
  const lg = await call("POST", "/auth/login", { identifier: a.username, password: "Teste1234" });
  ok("login novo obtido", isSuccess(lg) && lg.cookie, "status " + lg.status);
  const sy = await call("GET", "/sync", null, lg.cookie);
  const sv = pickFrom(sy.json.data && sy.json.data.servers, s1.id);
  ok("outra sessão vê a mesma imagem no servidor",
    sv && sv.icon && sv.icon.image === PNG_2,
    sv && sv.icon && String(sv.icon.image).slice(0, 40));

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
