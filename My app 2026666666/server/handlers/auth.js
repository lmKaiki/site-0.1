"use strict";
/* ============================================================
   NEXO · server/handlers/auth
   Conta, sessão, perfil, presença, notificações e busca.
   Regras idênticas às da interface (js/api.js) — só que aqui a
   senha é conferida no servidor e a sessão vive em cookie
   HttpOnly, nunca em localStorage.
   ============================================================ */

const db = require("../db");
const auth = require("../auth");
const u = require("../util");
const { bad, unauthorized, forbidden, notFound } = require("../errors");
const P = require("../patch");
const env = require("../env");

/* ---------- limite de tentativas de login (memória do processo) ---------- */
const FAILS = new Map();
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW = 5 * 60 * 1000;

function failKey(kind, key) {
  return kind + ":" + key;
}

function blocked(kind, key) {
  const rec = FAILS.get(failKey(kind, key));
  if (!rec) return false;
  if (Date.now() - rec.at > LOGIN_WINDOW) {
    FAILS.delete(failKey(kind, key));
    return false;
  }
  return rec.n >= LOGIN_MAX_FAILS;
}

function countFail(kind, key) {
  const id = failKey(kind, key);
  const rec = FAILS.get(id) || { n: 0, at: Date.now() };
  if (Date.now() - rec.at > LOGIN_WINDOW) rec.n = 0;
  rec.n += 1;
  rec.at = Date.now();
  FAILS.set(id, rec);
}

function clearFails(kind, key) {
  FAILS.delete(failKey(kind, key));
}

/* ---------- helpers ---------- */
function now() {
  return Date.now();
}

async function findById(id) {
  const rows = await db.select("users", { where: { id }, limit: 1 });
  return rows && rows[0] ? rows[0] : null;
}

async function findByUsername(username) {
  const rows = await db.select("users", {
    where: { username: u.normalizeUsername(username) },
    limit: 1,
  });
  return rows && rows[0] ? rows[0] : null;
}

async function createNotification(userId, type, text, meta) {
  const n = {
    id: u.uid("nt"),
    userId,
    type,
    text,
    at: now(),
    read: false,
    meta: meta || null,
    createdAt: now(),
  };
  await db.insert("notifications", n);
  return n;
}

/* presença: grava na tabela e no campo do usuário (a tela lê o usuário) */
async function setPresence(userId, status) {
  const allowed = ["online", "idle", "dnd", "offline"];
  const next = allowed.indexOf(status) > -1 ? status : "offline";
  await db.upsert("presence", {
    userId,
    status: next,
    updatedAt: now(),
  });
  await db.update("users", { where: { id: userId } }, { status: next, updatedAt: now() });
  return next;
}

/* ============================ ROTAS ============================ */
function routes() {
  return [
    ["GET", "/health", health],
    ["POST", "/auth/signup", signup],
    ["POST", "/auth/login", login],
    ["POST", "/auth/logout", logout],
    ["GET", "/auth/me", me],
    ["POST", "/auth/password", changePassword],
    ["PATCH", "/profile", updateProfile],
    ["POST", "/presence", setStatus],
    ["GET", "/notifications", listNotifications],
    ["POST", "/notifications/read", readNotifications],
    ["POST", "/notifications/clear", clearNotifications],
    ["GET", "/users/search", searchPeople],
  ];
}

/* saúde do backend — nunca devolve chave nenhuma */
async function health() {
  let ok = true;
  let detail = "";
  try {
    db.init();
  } catch (e) {
    ok = false;
    detail = e.message;
  }
  return {
    status: ok ? 200 : 503,
    data: {
      ok,
      driver: env.driver,
      backend: db.name || env.driver,
      error: detail || null,
      serverTime: now(),
    },
  };
}

async function signup(ctx) {
  const body = ctx.body || {};
  const username = u.normalizeUsername(body.username);
  if (!username) throw bad("Digite um nome de usuário.");
  if (!u.usernameOk(username))
    throw bad(
      "Nome de usuário precisa de 3 a 18 caracteres (letras, números, ponto e sublinhado), sem espaços."
    );
  auth.assertPasswordPolicy(body.password, body.confirm);

  const key = username;
  if (blocked("signup", key)) {
    throw bad(
      "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente."
    );
  }

  const dupe = await findByUsername(username);
  if (dupe) {
    countFail("signup", key);
    throw bad("Esse nome de usuário já está em uso. Tente outro.");
  }
  clearFails("signup", key);

  const id = u.uid("u");
  const user = {
    id,
    username,
    passwordHash: auth.hashPassword(String(body.password)),
    displayName: String(body.username || "").trim().slice(0, 32) || username,
    avatar: {
      emoji: body.emoji || u.emojiFor(username),
      color: body.color || u.colorFor(id),
      image: null,
    },
    banner: null,
    profileColor: body.color || u.colorFor(id),
    statusEmoji: "",
    customStatus: "",
    theme: "",
    bio: "",
    birth: body.birth || null,
    status: "online",
    statusText: "",
    blocks: [],
    privacy: { friendRequests: "all", dm: "all" },
    region: {
      countryCode: "",
      countryName: "",
      countryFlag: "",
      timezone: "America/Sao_Paulo",
      language: "pt-BR",
      showCountry: true,
    },
    demo: false,
    createdAt: now(),
    updatedAt: now(),
  };

  await db.insert("users", user);
  await db.upsert("presence", { userId: id, status: "online", updatedAt: now() });
  const welcome = await createNotification(id, "system", "Bem-vindo à Nexo!");

  const session = await auth.createSession(
    id,
    (ctx.headers && (ctx.headers["user-agent"] || ctx.headers["User-Agent"])) || ""
  );

  const patch = P.createPatch();
  P.set(patch, "users", id, auth.publicUser(user));
  P.set(patch, "presence", id, "online");
  P.list(patch, "notifications", [welcome]);

  return {
    status: 201,
    data: {
      user: auth.publicUser(user),
      message: "Sua conta foi criada com sucesso.",
    },
    patch,
    setCookies: [session.setCookie],
  };
}

async function login(ctx) {
  const body = ctx.body || {};
  const ident = u.normalizeIdentifier(body.identifier);
  if (!ident) throw bad("Digite seu nome de usuário.");
  if (!body.password) throw bad("Digite sua senha.");

  const key = ident;
  if (blocked("login", key)) {
    throw bad(
      "Muitas tentativas de login. Tente novamente em alguns minutos.",
      "rate_limited"
    );
  }

  const user = await findByUsername(ident);
  if (!user) {
    countFail("login", key);
    throw bad("Não encontramos uma conta com esse nome de usuário.");
  }
  if (!auth.verifyPassword(String(body.password), user.passwordHash)) {
    countFail("login", key);
    throw bad("A senha está incorreta.");
  }
  clearFails("login", key);

  const status = await setPresence(user.id, body.status || "online");
  const session = await auth.createSession(
    user.id,
    (ctx.headers && (ctx.headers["user-agent"] || ctx.headers["User-Agent"])) || ""
  );

  const publicUser = auth.publicUser(Object.assign({}, user, { status }));
  const patch = P.createPatch();
  P.set(patch, "users", user.id, publicUser);
  P.set(patch, "presence", user.id, status);

  return { data: publicUser, patch, setCookies: [session.setCookie] };
}

async function logout(ctx) {
  const user = await auth.userFromRequest(ctx.event);
  if (user) await setPresence(user.id, "offline");
  const cookie = await auth.destroySession(ctx.event);
  return { data: { ok: true }, setCookies: cookie ? [cookie] : [] };
}

async function me(ctx) {
  const user = await auth.requireUser(ctx.event);
  const patch = P.createPatch();
  P.set(patch, "users", user.id, auth.publicUser(user));
  return { data: { user: auth.publicUser(user) }, patch };
}

async function changePassword(ctx) {
  const user = await auth.requireUser(ctx.event);
  const body = ctx.body || {};
  if (!auth.verifyPassword(String(body.current || ""), user.passwordHash))
    throw bad("A senha atual está incorreta.");
  auth.assertPasswordPolicy(body.password, body.confirm);

  await db.update(
    "users",
    { where: { id: user.id } },
    { passwordHash: auth.hashPassword(String(body.password)), updatedAt: now() }
  );
  const note = await createNotification(user.id, "system", "Sua senha foi alterada.");

  const patch = P.createPatch();
  P.list(patch, "notifications", [note]);
  return { data: { ok: true }, patch };
}

async function updateProfile(ctx) {
  const user = await auth.requireUser(ctx.event);
  const patchBody = ctx.body || {};
  const update = {};

  if (patchBody.username !== undefined) {
    const username = u.normalizeUsername(patchBody.username);
    if (!username) throw bad("Digite um nome de usuário.");
    if (!u.usernameOk(username))
      throw bad(
        "Nome de usuário precisa de 3 a 18 caracteres (letras, números, . e _), sem espaços."
      );
    const dupe = await findByUsername(username);
    if (dupe && dupe.id !== user.id) throw bad("Esse nome de usuário já está em uso.");
    update.username = username;
  }
  if (patchBody.displayName !== undefined) {
    const n = String(patchBody.displayName).trim();
    if (n.length < 2) throw bad("Digite um nome com pelo menos 2 caracteres.");
    update.displayName = n.slice(0, 32);
  }
  if (patchBody.bio !== undefined) update.bio = String(patchBody.bio).slice(0, 190);
  if (patchBody.avatar !== undefined) {
    const next = Object.assign({}, user.avatar, patchBody.avatar);
    if (next.image && next.image.length > 900000)
      throw bad("Esta imagem é grande demais. Use uma com até 1 MB.");
    update.avatar = next;
  }
  if (patchBody.banner !== undefined) {
    if (patchBody.banner && String(patchBody.banner).length > 1400000)
      throw bad("Este banner é grande demais. Use uma imagem com até 1,5 MB.");
    update.banner = patchBody.banner || null;
  }
  if (patchBody.profileColor !== undefined)
    update.profileColor = patchBody.profileColor || null;
  if (patchBody.statusEmoji !== undefined)
    update.statusEmoji = String(patchBody.statusEmoji || "").slice(0, 8);
  if (patchBody.customStatus !== undefined)
    update.customStatus = String(patchBody.customStatus || "").slice(0, 60);
  if (patchBody.theme !== undefined) update.theme = String(patchBody.theme || "");
  if (patchBody.statusText !== undefined)
    update.statusText = String(patchBody.statusText || "").slice(0, 60);
  if (patchBody.status !== undefined) {
    const allowed = ["online", "idle", "dnd", "offline"];
    if (allowed.indexOf(patchBody.status) > -1) {
      update.status = patchBody.status;
      await db.upsert("presence", {
        userId: user.id,
        status: patchBody.status,
        updatedAt: now(),
      });
    }
  }

  if (!Object.keys(update).length) return { data: auth.publicUser(user) };
  update.updatedAt = now();
  await db.update("users", { where: { id: user.id } }, update);

  const fresh = await findById(user.id);
  const patch = P.createPatch();
  P.set(patch, "users", user.id, auth.publicUser(fresh));
  P.set(patch, "presence", user.id, fresh.status || "online");
  return { data: auth.publicUser(fresh), patch };
}

async function setStatus(ctx) {
  const user = await auth.requireUser(ctx.event);
  const status = (ctx.body || {}).status;
  const saved = await setPresence(user.id, status);
  const fresh = await findById(user.id);
  const patch = P.createPatch();
  P.set(patch, "presence", user.id, saved);
  P.set(patch, "users", user.id, auth.publicUser(fresh));
  return { data: auth.publicUser(fresh), patch };
}

async function listNotifications(ctx) {
  const user = await auth.requireUser(ctx.event);
  const list = await db.select("notifications", {
    where: { user_id: user.id },
    order: "at",
    desc: true,
    limit: 80,
  });
  return { data: list || [] };
}

async function readNotifications(ctx) {
  const user = await auth.requireUser(ctx.event);
  const ids = (ctx.body || {}).ids;
  if (Array.isArray(ids) && ids.length) {
    await db.update(
      "notifications",
      { where: { user_id: user.id, id: ids } },
      { read: true }
    );
  } else {
    await db.update("notifications", { where: { user_id: user.id } }, { read: true });
  }
  const list = await db.select("notifications", {
    where: { user_id: user.id },
    order: "at",
    desc: true,
    limit: 80,
  });
  const patch = P.createPatch();
  P.list(patch, "notifications", list || []);
  return { data: list || [], patch };
}

async function clearNotifications(ctx) {
  const user = await auth.requireUser(ctx.event);
  await db.remove("notifications", { where: { user_id: user.id } });
  const patch = P.createPatch();
  P.list(patch, "notifications", []);
  return { data: true, patch };
}

/* busca por @username, nome exibido ou User ID — nunca devolve a
   própria conta nem alguém bloqueado (nos dois sentidos) */
async function searchPeople(ctx) {
  const user = await auth.requireUser(ctx.event);
  const raw = String((ctx.query && ctx.query.q) || "").trim();
  if (!raw) return { data: [] };
  const q = raw.toLowerCase();
  const limit = Math.min(Math.max(parseInt(ctx.query.limit, 10) || 8, 1), 25);

  const all = await db.select("users", { limit: 500 });
  const blocks = await db.select("blocks", {
    where: { blocker_id: user.id },
    limit: 1000,
  });
  const incoming = await db.select("blocks", {
    where: { blocked_id: user.id },
    limit: 1000,
  });
  const hidden = {};
  (blocks || []).forEach((b) => (hidden[b.blockedId] = true));
  (incoming || []).forEach((b) => (hidden[b.blockerId] = true));

  const norm = (s) => String(s || "").toLowerCase();
  const results = (all || [])
    .filter((x) => x && x.id !== user.id && !hidden[x.id])
    .map((x) => {
      const un = norm(x.username);
      const dn = norm(x.displayName);
      let rank = -1;
      if (un === q || norm(x.id) === q) rank = 0;
      else if (un.indexOf(q) === 0) rank = 1;
      else if (un.indexOf(q) > -1) rank = 2;
      else if (dn.indexOf(q) > -1) rank = 3;
      return { user: x, rank };
    })
    .filter((x) => x.rank > -1)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        String(a.user.displayName || "").localeCompare(String(b.user.displayName || ""))
    )
    .slice(0, limit)
    .map((x) => auth.publicUser(x.user));

  return { data: results };
}

module.exports = {
  routes,
  findById,
  findByUsername,
  createNotification,
  setPresence,
  publicUser: auth.publicUser,
};
