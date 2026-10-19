"use strict";
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
  try { json = JSON.parse(res.body); } catch (e) {}
  let c = null;
  const sc = res.multiValueHeaders && res.multiValueHeaders["Set-Cookie"];
  if (sc && sc.length) c = sc[0].split(";")[0];
  return { status: res.statusCode, json, cookie: c };
}

(async () => {
  const stamp = Date.now().toString(36);
  const a = "d" + stamp + "a";
  const b = "d" + stamp + "b";
  const sa = await call("POST", "/auth/signup", { username: a, password: "Teste1234", confirm: "Teste1234" });
  const sb = await call("POST", "/auth/signup", { username: b, password: "Teste1234", confirm: "Teste1234" });
  const ca = sa.cookie, cb = sb.cookie;
  const idA = sa.json.data.id, idB = sb.json.data.id;
  console.log("signup A", sa.status, idA, "B", sb.status, idB);

  const srv = await call("POST", "/servers", { name: "Dbg Server", template: "comunidade" }, ca);
  const sid = srv.json.data && srv.json.data.id;
  console.log("server", srv.status, sid);

  const inst = await call("POST", "/servers/" + sid + "/apps", { appId: "app_nexo_welcome" }, ca);
  console.log("install", inst.status, JSON.stringify(inst.json).slice(0, 300));

  const inv = await call("POST", "/servers/" + sid + "/invites", {}, ca);
  const code = inv.json.data && (inv.json.data.code || inv.json.data);
  console.log("invite", inv.status, code);
  const join = await call("POST", "/invites/" + code + "/join", {}, cb);
  console.log("join", join.status, JSON.stringify(join.json).slice(0, 500));

  const sync = await call("GET", "/sync", null, ca);
  const messages = Object.values(sync.json.data.messages || {});
  const bots = messages.filter((m) => /^«bot:/.test(m.content || ""));
  console.log("mensagens totais:", messages.length, "com marcador de bot:", bots.length);
  if (bots.length) console.log("exemplo:", bots[0].content.slice(0, 200));

  // limpeza
  const db = require("../server/db");
  const chans = await db.select("channels", { where: { server_id: sid }, limit: 100 });
  if (chans && chans.length) await db.remove("messages", { where: { channel_id: chans.map((c) => c.id) } }).catch(() => {});
  await db.remove("server_apps", { where: { server_id: sid } }).catch(() => {});
  await db.remove("channels", { where: { server_id: sid } }).catch(() => {});
  await db.remove("categories", { where: { server_id: sid } }).catch(() => {});
  await db.remove("roles", { where: { server_id: sid } }).catch(() => {});
  await db.remove("invites", { where: { server_id: sid } }).catch(() => {});
  await db.remove("logs", { where: { server_id: sid } }).catch(() => {});
  await db.remove("memberships", { where: { server_id: sid } }).catch(() => {});
  await db.remove("servers", { where: { id: sid } }).catch(() => {});
  await db.remove("notifications", { where: { user_id: [idA, idB] } }).catch(() => {});
  await db.remove("presence", { where: { user_id: [idA, idB] } }).catch(() => {});
  await db.remove("prefs", { where: { user_id: [idA, idB] } }).catch(() => {});
  await db.remove("users", { where: { id: [idA, idB] } }).catch(() => {});
  console.log("limpeza ok");
  process.exit(0);
})().catch((e) => { console.log("ERRO", e); process.exit(1); });
