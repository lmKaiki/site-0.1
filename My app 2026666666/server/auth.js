"use strict";
/* ============================================================
   NEXO · server/auth
   Autenticação SOMENTE no backend:
   · senha   → scrypt (KDF de memória) + salt aleatório por conta;
   · sessão  → cookie HttpOnly com payload assinado (HMAC-SHA256
               usando a chave de serviço, que só existe no
               ambiente da Function) + revogação individual
               guardada em prefs do usuário;
   · localStorage.userId NUNCA prova nada: todo handler que
     exige sessão passa por requireUser().

   O JavaScript do navegador jamais lê o token (HttpOnly).
   ============================================================ */

const crypto = require("crypto");
const db = require("./db");
const env = require("./env");
const { unauthorized, bad } = require("./errors");
const { serializeCookie, parseCookies } = require("./http");

const COOKIE = "nx_session";
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const MAX_SESSIONS = 10;

/* cache curto para não reler prefs a cada requisição */
const sessionCache = new Map();
const CACHE_TTL = 15 * 1000;

function secret() {
  return env.supabaseServiceRoleKey || env.supabaseAnonKey || "nexo-local-secret";
}

function b64(buf) {
  return Buffer.from(buf).toString("base64");
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

function makeToken(data) {
  const payload = b64url(Buffer.from(JSON.stringify(data), "utf8"));
  return payload + "." + sign(payload);
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || token.indexOf(".") === -1) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = sign(parts[0]);
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch (e) {
    return null;
  }
}

/* senha → "scrypt$N$r$p$saltB64$hashB64" */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, b64(salt), b64(hash)].join("$");
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = parseInt(parts[1], 10);
  const r = parseInt(parts[2], 10);
  const p = parseInt(parts[3], 10);
  if (!N || !r || !p) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch (e) {
    return false;
  }
  let actual;
  try {
    actual = crypto.scryptSync(String(password), salt, expected.length, { N, r, p });
  } catch (e) {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function tokenFromRequest(req) {
  const cookies = parseCookies(req && req.headers && (req.headers.cookie || req.headers.Cookie));
  return cookies[COOKIE] || null;
}

function sessionCookie(token) {
  return serializeCookie(COOKIE, token, {
    maxAge: SESSION_DAYS * 24 * 3600,
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "Lax",
    path: "/",
  });
}

function clearCookie() {
  return serializeCookie(COOKIE, "", {
    maxAge: 0,
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "Lax",
    path: "/",
  });
}

async function loadSessions(userId) {
  const data = await db.readPrefs(userId);
  return Array.isArray(data.sessions) ? data.sessions : [];
}

async function saveSessions(userId, list) {
  const data = await db.readPrefs(userId);
  data.sessions = list.slice(-MAX_SESSIONS);
  await db.writePrefs(userId, data);
  sessionCache.delete(userId + "|*");
}

/* cria sessão e devolve {token, setCookie} */
async function createSession(userId, userAgent) {
  const sid = crypto.randomBytes(16).toString("hex");
  const exp = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  const list = await loadSessions(userId);
  list.push({
    sid,
    exp,
    ua: String(userAgent || "").slice(0, 160),
    at: Date.now(),
  });
  await saveSessions(userId, list);
  const token = makeToken({ uid: userId, sid, exp });
  return { token, setCookie: sessionCookie(token) };
}

async function destroySession(req) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (payload && payload.uid && payload.sid) {
    const list = await loadSessions(payload.uid);
    const next = list.filter((s) => s.sid !== payload.sid);
    if (next.length !== list.length) await saveSessions(payload.uid, next);
    sessionCache.delete(payload.uid + "|" + payload.sid);
  }
  return clearCookie();
}

/* sessão válida → usuário (sem password_hash) ou null */
async function userFromRequest(req) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || !payload.uid || !payload.sid) return null;
  if (Number(payload.exp) < Date.now()) return null;

  const key = payload.uid + "|" + payload.sid;
  const cached = sessionCache.get(key);
  if (cached && cached.exp === payload.exp && Date.now() - cached.at < CACHE_TTL) {
    return loadUser(payload.uid);
  }

  const list = await loadSessions(payload.uid);
  const found = list.find((s) => s.sid === payload.sid);
  if (!found || Number(found.exp) < Date.now()) return null;
  if (Number(found.exp) !== Number(payload.exp)) return null;

  sessionCache.set(key, { exp: payload.exp, at: Date.now() });
  return loadUser(payload.uid);
}

async function loadUser(userId) {
  const rows = await db.select("users", { where: { id: userId }, limit: 1 });
  return rows && rows[0] ? rows[0] : null;
}

async function requireUser(req) {
  const user = await userFromRequest(req);
  if (!user) throw unauthorized();
  return user;
}

/* remove senha e qualquer segredo antes de qualquer resposta */
function publicUser(user) {
  if (!user) return null;
  const out = Object.assign({}, user);
  delete out.passwordHash;
  delete out.password;
  delete out.sessions;
  delete out.authEpoch;
  if (typeof out.blocks === "string") {
    try {
      out.blocks = JSON.parse(out.blocks);
    } catch (e) {
      out.blocks = [];
    }
  }
  if (!Array.isArray(out.blocks)) out.blocks = [];
  if (out.status === undefined || out.status === null) out.status = "offline";
  return out;
}

function assertPasswordPolicy(password, confirm) {
  const value = String(password || "");
  if (!value) throw bad("Digite uma senha.");
  if (value.length < 8) throw bad("A senha precisa de pelo menos 8 caracteres.");
  if (!/[a-zA-Z]/.test(value)) throw bad("A senha precisa de pelo menos uma letra.");
  if (!/[0-9]/.test(value)) throw bad("A senha precisa de pelo menos um número.");
  if (value.length > 72) throw bad("A senha pode ter no máximo 72 caracteres.");
  if (confirm !== undefined && confirm !== null && String(confirm) !== value)
    throw bad("As senhas não conferem.");
  return true;
}

module.exports = {
  COOKIE,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  userFromRequest,
  requireUser,
  publicUser,
  assertPasswordPolicy,
  clearCookie,
  tokenFromRequest,
  loadSessions,
  saveSessions,
};
