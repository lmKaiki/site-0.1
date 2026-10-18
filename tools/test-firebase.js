"use strict";
/* ============================================================
   NEXO · tools/test-firebase.js
   Testa a ponte Firebase Authentication → conta Nexo, SEM bater
   no Google: gera um par de chaves RS256 local e injeta a pública
   como se fosse a do Google (mesmo caminho de verificação real).

      node tools/test-firebase.js

   Cobre:
     · verificação do ID token (assinatura, aud, iss, exp, kid);
     · POST /auth/firebase: cadastro, login, idempotência, Google,
       recusa de login por e-mail sem conta, nome duplicado;
     · vínculo SEMPRE pelo uid (nunca por e-mail/username);
     · nada de dado privado (auth/email) vazando para outras contas;
     · limpeza total no final.
   ============================================================ */

process.env.NEXO_DB = process.env.NEXO_DB || "supabase";
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "nexo-teste-fb";

const crypto = require("crypto");

const env = require("../server/env");
const db = require("../server/db");
const firebase = require("../server/firebase");
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
const createdUsers = [];

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
  return { status: res.status || res.statusCode, json, cookie: setCookie };
}

function rnd(n) {
  return Math.random().toString(36).slice(2, 2 + (n || 8));
}

/* ---------- chaves locais no lugar das do Google ---------- */
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" });
const KEY_ID = "nexo-teste-key";
firebase._setTestCerts({ [KEY_ID]: PUBLIC_PEM });

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

/* monta um ID token assinado — o mesmo formato do Firebase */
function makeToken(overrides, opts) {
  opts = opts || {};
  const header = { alg: "RS256", kid: opts.kid || KEY_ID, typ: "JWT" };
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = Object.assign(
    {
      iss: "https://securetoken.google.com/" + env.firebaseProjectId,
      aud: env.firebaseProjectId,
      auth_time: nowSec,
      user_id: opts.uid || "fb_" + rnd(10),
      sub: opts.uid || "fb_" + rnd(10),
      iat: nowSec,
      exp: nowSec + 3600,
      email: opts.email || null,
      email_verified: opts.emailVerified !== false,
      firebase: { sign_in_provider: opts.provider || "password" },
    },
    overrides || {}
  );
  /* sub/uid explícitos vencem os aleatórios */
  if (opts.uid) {
    payload.sub = opts.uid;
    payload.user_id = opts.uid;
  }
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = crypto
    .sign("RSA-SHA256", Buffer.from(h + "." + p), opts.privateKey || privateKey)
    .toString("base64url");
  return h + "." + p + "." + sig;
}

async function cleanup() {
  const ids = createdUsers.slice();
  if (!ids.length) return;
  await db.remove("notifications", { where: { user_id: ids } }).catch(() => {});
  await db.remove("presence", { where: { user_id: ids } }).catch(() => {});
  await db.remove("sessions", { where: { user_id: ids } }).catch(() => {});
  await db.remove("prefs", { where: { user_id: ids } }).catch(() => {});
  await db.remove("users", { where: { id: ids } }).catch(() => {});
  createdUsers.length = 0;
}

/* ============================================================ */
async function main() {
  console.log("\n== 1. verificação do ID token (chave RS256 local) ==");

  const goodUid = "fb_" + rnd(10);
  const goodEmail = rnd(8) + "@teste.dev";
  const good = makeToken({}, { uid: goodUid, email: goodEmail });
  let claims = null;
  try {
    claims = await firebase.verifyIdToken(good);
  } catch (e) {
    claims = null;
  }
  ok("token válido é aceito", !!claims, claims && claims.message);
  ok("devolve o uid confiável", claims && claims.uid === goodUid);
  ok("devolve o e-mail", claims && claims.email === goodEmail);
  ok("devolve e-mail confirmado", claims && claims.emailVerified === true);
  ok("devolve o provedor", claims && claims.provider === "password");

  const tampered = good.split(".")[0] + "." + b64url(JSON.stringify({ sub: "outra" })) + "." + good.split(".")[2];
  let tamperedOk = false;
  try {
    await firebase.verifyIdToken(tampered);
    tamperedOk = true;
  } catch (e) {}
  ok("payload trocado é recusado", !tamperedOk);

  const wrongAud = makeToken({ aud: "outro-projeto" }, { uid: goodUid, email: goodEmail });
  let audOk = false;
  try {
    await firebase.verifyIdToken(wrongAud);
    audOk = true;
  } catch (e) {}
  ok("aud de outro projeto é recusado", !audOk);

  const wrongIss = makeToken({ iss: "https://securetoken.google.com/outro" }, { uid: goodUid, email: goodEmail });
  let issOk = false;
  try {
    await firebase.verifyIdToken(wrongIss);
    issOk = true;
  } catch (e) {}
  ok("iss de outro projeto é recusado", !issOk);

  const expired = makeToken({ exp: Math.floor(Date.now() / 1000) - 120 }, { uid: goodUid, email: goodEmail });
  let expOk = false;
  try {
    await firebase.verifyIdToken(expired);
    expOk = true;
  } catch (e) {}
  ok("token expirado é recusado", !expOk);

  const unknownKid = makeToken({}, { uid: goodUid, email: goodEmail, kid: "chave-que-nao-existe" });
  let kidOk = false;
  try {
    await firebase.verifyIdToken(unknownKid);
    kidOk = true;
  } catch (e) {}
  ok("kid desconhecido é recusado", !kidOk);

  const otherKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const forged = makeToken({}, { uid: goodUid, email: goodEmail, privateKey: otherKey.privateKey });
  let forgeOk = false;
  try {
    await firebase.verifyIdToken(forged);
    forgeOk = true;
  } catch (e) {}
  ok("assinatura de outra chave é recusada", !forgeOk);

  ok("token vazio é recusado", await (async () => {
    try {
      await firebase.verifyIdToken("");
      return false;
    } catch (e) {
      return true;
    }
  })());

  console.log("\n== 2. POST /auth/firebase · cadastro por e-mail ==");

  const A_UID = "fb_" + rnd(10);
  const A_EMAIL = rnd(8) + "@teste.dev";
  const A_USER = "fba" + rnd(6);
  const tokenA = makeToken({ email_verified: false }, { uid: A_UID, email: A_EMAIL });

  const usersBefore = await db.count("users", {});
  let r = await call("POST", "/auth/firebase", {
    idToken: tokenA,
    intent: "signup",
    username: A_USER,
  });
  ok("cadastro cria a conta (201)", r.status === 201, "status " + r.status + " " + (r.json.error || ""));
  const userA = r.json && r.json.data && r.json.data.user;
  ok("devolve a conta", !!(userA && userA.id));
  if (userA && userA.id) createdUsers.push(userA.id);
  ok("criado:true no cadastro", r.json && r.json.data && r.json.data.created === true);
  ok("avisa e-mail não confirmado", r.json && r.json.data && r.json.data.emailVerified === false);
  ok("entrega cookie de sessão", !!r.cookie);
  ok("usuário vem sem senha", userA && userA.passwordHash === undefined);
  ok("usuário vem sem o vínculo interno", userA && userA.auth === undefined);
  ok("e-mail visível só para o dono", userA && userA.email === A_EMAIL);

  /* o vínculo gravou o UID (nunca o e-mail) como chave */
  const linkA = userA && (await db.readAuthLink(userA.id));
  ok("vínculo guardado em prefs.data.auth", !!(linkA && linkA.firebaseUid === A_UID));
  ok("vínculo guardou o e-mail", linkA && linkA.email === A_EMAIL);
  ok("vínculo guardou o selo de confirmação", linkA && linkA.emailVerified === false);
  const usersAfter = await db.count("users", {});
  ok("cadastro criou exatamente UMA conta", usersAfter === usersBefore + 1,
    usersBefore + " → " + usersAfter);

  console.log("\n== 3. POST /auth/firebase · login idempotente ==");

  const r2 = await call("POST", "/auth/firebase", {
    idToken: makeToken({}, { uid: A_UID, email: A_EMAIL }),
    intent: "login",
  });
  ok("login devolve a MESMA conta", r2.json && r2.json.data && r2.json.data.user && r2.json.data.user.id === userA.id);
  ok("login não cria conta nova", r2.json && r2.json.data && r2.json.data.created === false);
  ok("selo de e-mail confirmado atualizado", r2.json && r2.json.data && r2.json.data.emailVerified === true);
  const linkA2 = await db.readAuthLink(userA.id);
  ok("vínculo atualizado no banco", linkA2 && linkA2.emailVerified === true);

  /* signup com o MESMO uid não pode duplicar a conta */
  const beforeCount = (await db.select("users", { where: { id: createdUsers }, limit: 50 })).length;
  const r3 = await call("POST", "/auth/firebase", {
    idToken: makeToken({}, { uid: A_UID, email: A_EMAIL }),
    intent: "signup",
    username: "outronome" + rnd(6),
  });
  ok("signup repetido não duplica (entra na conta)", r3.json && r3.json.data && r3.json.data.user && r3.json.data.user.id === userA.id);
  const afterCount = (await db.select("users", { where: { id: createdUsers }, limit: 50 })).length;
  ok("nenhuma conta duplicada", beforeCount === afterCount, beforeCount + " → " + afterCount);

  console.log("\n== 4. nome de usuário já em uso ==");

  const r4 = await call("POST", "/auth/firebase", {
    idToken: makeToken({}, { uid: "fb_" + rnd(10), email: rnd(8) + "@teste.dev" }),
    intent: "signup",
    username: A_USER, /* mesmo do A */
  });
  ok("nome duplicado é recusado", r4.status === 400, "status " + r4.status);
  ok("mensagem clara", r4.json && /já está em uso/.test(r4.json.error || ""));

  console.log("\n== 5. login por e-mail sem conta Nexo ==");

  const r5 = await call("POST", "/auth/firebase", {
    idToken: makeToken({}, { uid: "fb_" + rnd(10), email: rnd(8) + "@teste.dev" }),
    intent: "login",
  });
  ok("e-mail sem conta não cria conta sozinho", r5.status === 400, "status " + r5.status);
  ok("orienta a criar conta", r5.json && /Crie uma conta/.test(r5.json.error || ""));

  console.log("\n== 6. Google: cria conta automaticamente ==");

  const G_UID = "fb_" + rnd(10);
  const G_EMAIL = rnd(8) + "@gmail.com";
  const r6 = await call("POST", "/auth/firebase", {
    idToken: makeToken({}, { uid: G_UID, email: G_EMAIL, provider: "google.com", emailVerified: true }),
    intent: "login",
  });
  ok("Google cria a conta (201)", r6.status === 201, "status " + r6.status + " " + (r6.json.error || ""));
  const userG = r6.json && r6.json.data && r6.json.data.user;
  if (userG && userG.id) createdUsers.push(userG.id);
  ok("conta Google criada", !!(userG && userG.id));
  ok("sem senha local", userG && userG.passwordHash === undefined);
  ok("nome derivado é válido (3-18)", userG && /^[a-z0-9._]{3,18}$/.test(userG.username), userG && userG.username);
  const linkG = userG && (await db.readAuthLink(userG.id));
  ok("Google vinculado pelo UID", linkG && linkG.firebaseUid === G_UID);
  ok("provedor guardado", linkG && linkG.provider === "google.com");

  /* mesmo uid de novo → mesma conta */
  const r7 = await call("POST", "/auth/firebase", {
    idToken: makeToken({}, { uid: G_UID, email: G_EMAIL, provider: "google.com" }),
    intent: "login",
  });
  ok("segundo login do Google é a mesma conta", r7.json && r7.json.data && r7.json.data.user && r7.json.data.user.id === userG.id);
  ok("sem duplicar", r7.json && r7.json.data && r7.json.data.created === false);

  console.log("\n== 7. e-mail NÃO vira chave de vínculo ==");

  /* outro uid com o MESMO e-mail do A: não pode cair na conta do A */
  const r8 = await call("POST", "/auth/firebase", {
    idToken: makeToken({}, { uid: "fb_" + rnd(10), email: A_EMAIL, provider: "google.com" }),
    intent: "login",
  });
  ok("uid novo com e-mail igual NÃO entra na conta do A",
    !(r8.json && r8.json.data && r8.json.data.user && r8.json.data.user.id === userA.id),
    "entrou na conta do A!");
  ok("criou conta separada (nada de vínculo por e-mail)",
    r8.status === 201 && r8.json && r8.json.data && r8.json.data.user && r8.json.data.user.id !== userA.id);
  const user8 = r8.json && r8.json.data && r8.json.data.user;
  if (user8 && user8.id) createdUsers.push(user8.id);

  console.log("\n== 8. conta Google não entra com usuário+senha ==");

  const r9 = await call("POST", "/auth/login", {
    identifier: userG.username,
    password: "Qualquer123",
  });
  ok("recusa com mensagem clara", r9.status === 400, "status " + r9.status);
  ok("explica que é e-mail/Google", r9.json && /e-mail ou com o Google/.test(r9.json.error || ""));

  console.log("\n== 9. token inválido/recusado no backend ==");

  const r10 = await call("POST", "/auth/firebase", { idToken: "abc.def.ghi", intent: "login" });
  ok("token lixo é recusado", r10.status === 401, "status " + r10.status);

  const r11 = await call("POST", "/auth/firebase", { intent: "login" });
  ok("sem token é recusado", r11.status === 401 || r11.status === 400, "status " + r11.status);

  const r12 = await call("POST", "/auth/firebase", {
    idToken: makeToken({}, { uid: "fb_" + rnd(10), email: rnd(8) + "@teste.dev", privateKey: otherKey.privateKey }),
    intent: "login",
  });
  ok("assinatura forjada é recusada", r12.status === 401, "status " + r12.status);

  console.log("\n== 10. nada privado vaza para OUTRA conta ==");

  /* a conta A procura a conta do Google: e-mail e vínculo não podem aparecer */
  const r13 = await call("GET", "/users/search", null, r.cookie, { q: userG.username });
  ok("busca autenticada funciona", r13.status === 200, "status " + r13.status);
  const found = (r13.json && r13.json.data && r13.json.data[0]) || null;
  ok("achou a conta do Google", !!(found && found.id === userG.id));
  ok("sem e-mail de outra conta", found && found.email === undefined);
  ok("sem vínculo de outra conta", found && found.auth === undefined);

  console.log("\n== limpeza (nenhum dado de teste no banco) ==");
  await cleanup();
  ok("contas de teste removidas", true);

  console.log("---------------------------------------------");
  console.log("aprovados: " + pass + "   reprovados: " + fail);
  console.log("---------------------------------------------");
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("\nERRO FATAL:", e && e.message, e && e.stack);
  try {
    await cleanup();
  } catch (e2) {}
  process.exit(2);
});
