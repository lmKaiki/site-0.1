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
const pid = require("../publicid");
const { bad, unauthorized, forbidden, notFound } = require("../errors");
const { ApiError } = require("../errors");
const P = require("../patch");
const env = require("../env");
const firebase = require("../firebase");
const sbauth = require("../supabaseauth");
const official = require("../official");

/* ---------- limite de tentativas (memória do processo) ---------- */
const FAILS = new Map();
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW = 5 * 60 * 1000;

/* Cada tipo tem sua própria janela. login/signup/fb mantêm os
   números de antes (eram os de tentativa de senha, não de envio).

   O "resend" é diferente: ele consome um recurso ESCASSO. O e-mail
   de confirmação sai pelo serviço padrão do Supabase, que no plano
   gratuito aceita pouquíssimos envios por hora -- e cada reenvio
   gasta um deles. Com a janela de login (5 em 5 min) a pessoa
   conseguia pedir 5 confirmações antes do Supabase recusar com
   "over_email_send_rate_limit", que é justamente o erro que ela vê
   na tela. 3 em 15 min mantém o fluxo utilizável e corta a maior
   parte do consumo. Nada disso afrouxa segurança: é limite de
   envio, não de autenticação. */
const LIMITS = {
  resend: { max: 3, window: 15 * 60 * 1000 },
};

function limitFor(kind) {
  return (
    LIMITS[kind] || { max: LOGIN_MAX_FAILS, window: LOGIN_WINDOW }
  );
}

function failKey(kind, key) {
  return kind + ":" + key;
}

function blocked(kind, key) {
  const lim = limitFor(kind);
  const rec = FAILS.get(failKey(kind, key));
  if (!rec) return false;
  if (Date.now() - rec.at > lim.window) {
    FAILS.delete(failKey(kind, key));
    return false;
  }
  return rec.n >= lim.max;
}

function countFail(kind, key) {
  const lim = limitFor(kind);
  const id = failKey(kind, key);
  const rec = FAILS.get(id) || { n: 0, at: Date.now() };
  if (Date.now() - rec.at > lim.window) rec.n = 0;
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

/* O e-mail mora em prefs.data.auth — a coluna users.email ainda não
   existe no banco (migração pendente), então o endereço não vem no
   objeto do usuário. Aqui ele é anexado AO DONO, na hora em que a
   própria conta é lida. publicUser apaga `email` de qualquer
   requisição que não seja do dono, então terceiros nunca o veem. */
async function attachEmail(user) {
  if (!user) return user;
  if (user.email) return user;
  try {
    const link = await db.readAuthLink(user.id);
    if (link && link.email) {
      user.email = link.email;
      user.emailVerified = !!link.emailVerified;
    }
  } catch (e) {
    /* prefs indisponíveis: segue sem o endereço, nada quebra */
  }
  return user;
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
  await db.upsert(
    "presence",
    {
      userId,
      status: next,
      updatedAt: now(),
    },
    "userId"
  );
  await db.update("users", { where: { id: userId } }, { status: next, updatedAt: now() });
  return next;
}

/* ============================ ROTAS ============================ */
function routes() {
  return [
    ["GET", "/health", health],
    ["POST", "/auth/signup", signup],
    ["POST", "/auth/login", login],
    ["POST", "/auth/resend", resendEmail],
    ["POST", "/auth/confirm", confirmEmail],
    ["POST", "/auth/firebase", firebaseAuth],
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

  /* ------------------------------------------------------------
     E-MAIL · Supabase Authentication
     O Nexo continua dono da conta: a senha continua com hash
     próprio e a sessão continua sendo o cookie nx_session. O
     Supabase Auth recebe uma missão só: provar que o e-mail é do
     usuário, disparando o link de confirmação. Toda a chamada
     acontece no servidor (server/supabaseauth.js) — o navegador
     nunca vê chave nenhuma.
     ------------------------------------------------------------ */
  const email = u.normalizeEmail(body.email);
  let sb = null;
  if (email) {
    if (!u.emailOk(email)) throw bad("Digite um e-mail válido.");
    const taken = await db.findByEmail(email);
    if (taken) {
      countFail("signup", key);
      throw bad("Este e-mail já está cadastrado. Use outro ou entre na sua conta.");
    }
    if (sbauth.configured()) {
      sb = await sbauth.signUp(email, String(body.password), { username });
      if (!sb.ok) {
        countFail("signup", key);
        throw bad(sb.message || "Não foi possível criar a conta agora.");
      }
      clearFails("signup", key);
    }
  }

  const id = u.uid("u");
  /* ID público numérico: sorteado aqui no banco (nunca no
     navegador), único entre as contas e permanente. O identificador
     interno `u_…` segue igual, intacto. */
  let publicId = null;
  try {
    publicId = await pid.pickFree();
  } catch (e) {
    publicId = null;
  }
  const user = {
    id,
    username,
    passwordHash: auth.hashPassword(String(body.password)),
    displayName: String(body.username || "").trim().slice(0, 32) || username,
    avatar: {
      /* usuário novo começa com a LOGO OFICIAL do Nexo — nunca com
         emoji do sistema. Emoji continua disponível, mas só se pedir. */
      emoji: body.emoji ? String(body.emoji).slice(0, 8) : null,
      color: body.color || u.colorFor(id),
      image: null,
      model: null,
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
    publicId: publicId || null,
    /* espelho na tabela users: se a coluna `email` existir no
       banco, ela é preenchida; se não existir (migração pendente),
       o endereço continua salvo em prefs.data.auth e nada falha. */
    email: email || null,
    createdAt: now(),
    updatedAt: now(),
  };

  await db.insert("users", user);
  /* confirma o número depois de gravar: se outra conta criada ao
     mesmo tempo sorteou o mesmo, esta recua e ganha outro */
  try {
    const confirmed = await pid.forUser(id);
    if (confirmed) {
      user.publicId = confirmed;
      if (confirmed !== publicId) pid.sweep(true).catch(function () {});
    }
  } catch (e) {
    /* sem número esta vez: a conta existe e a varredura atribui */
  }
  await db.upsert("presence", { userId: id, status: "online", updatedAt: now() });
  const welcome = await createNotification(id, "system", "Bem-vindo à Nexo!");
  /* Servidor Oficial Nexo: REMOVIDO. Não há mais criação
     automática (ensureOfficial) nem notificação de divulgação —
     o registro legado permanece no banco, intocado. */

  /* vínculo e e-mail ficam em prefs.data.auth — o mesmo lugar onde
     o Firebase já guardava o uid, sem depender de coluna nova. */
  if (email) {
    try {
      await db.writeAuthLink(id, {
        supabaseUid: (sb && sb.uid) || null,
        email,
        emailVerified: !!(sb && sb.confirmed),
        provider: "supabase",
        linkedAt: now(),
      });
    } catch (e) {
      /* prefs indisponíveis: a conta existe; a confirmação fica
         para o próximo passo do fluxo */
    }
  }

  const ua =
    (ctx.headers && (ctx.headers["user-agent"] || ctx.headers["User-Agent"])) || "";

  /* Confirmação pendente: a conta NASCE, mas NÃO recebe sessão.
     Nada de tratá-la como confirmada só porque o cadastro
     devolveu 201 — quem decide é o link clicado. */
  const pending = !!(email && sb && !sb.confirmed);
  const semConfirmacao = !!(email && !sb);
  const session = pending
    ? null
    : await auth.createSession(id, ua);

  const pub = auth.publicUser(await attachEmail(user));
  const patch = P.createPatch();
  P.set(patch, "users", id, pub);
  P.set(patch, "presence", id, "online");
  P.list(patch, "notifications", [welcome]);

  if (pending) {
    /* 202: criado, aguardando confirmação. Sem cookie, sem patch. */
    return {
      status: 202,
      data: {
        user: pub,
        needsEmailConfirm: true,
        email,
        message:
          "Enviamos um link de confirmação para " + email + ". Confira a caixa de entrada, o spam e outras pastas.",
      },
    };
  }

  return {
    status: 201,
    data: {
      user: pub,
      email: email || null,
      /* honesto: se o Supabase Auth não está configurado neste
         ambiente, ninguém enviou e-mail nenhum */
      emailVerified: !!(sb && sb.confirmed),
      confirmationAvailable: !email || !!sb,
      message: semConfirmacao
        ? "Sua conta foi criada com sucesso. A confirmação de e-mail não está disponível neste ambiente."
        : "Sua conta foi criada com sucesso.",
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

  /* "E-mail ou nome de usuário": com "@", a conta é procurada pelo
     e-mail gravado no cadastro. A senha continua sendo a do Nexo
     (hash próprio) — nada de fingir que o Supabase aceita nome de
     usuário como se fosse e-mail. */
  let user = null;
  if (ident.indexOf("@") > -1) {
    const byEmail = await db.findByEmail(u.normalizeEmail(ident));
    if (byEmail) user = await findById(byEmail);
  }
  if (!user) user = await findByUsername(ident);
  if (!user) {
    countFail("login", key);
    throw bad(
      ident.indexOf("@") > -1
        ? "Não encontramos uma conta com esse e-mail."
        : "Não encontramos uma conta com esse nome de usuário."
    );
  }
  /* conta criada pelo Firebase (Google ou e-mail confirmado) não tem
     senha local: explicar em vez de dizer "senha incorreta" */
  if (!user.passwordHash && user.auth && user.auth.firebaseUid) {
    countFail("login", key);
    throw bad(
      "Esta conta entra com o e-mail ou com o Google. Use uma dessas opções para entrar."
    );
  }
  if (!auth.verifyPassword(String(body.password), user.passwordHash)) {
    countFail("login", key);
    throw bad("A senha está incorreta.");
  }
  /* Conta que nasceu com e-mail: mesmo com a senha local correta,
     se o Supabase disser que o e-mail ainda não foi confirmado,
     não deixamos entrar. A prova vive no servidor — um flag no
     navegador não vale nada aqui. */
  const link = await db.readAuthLink(user.id);
  if (link && link.supabaseUid && link.email && !link.emailVerified) {
    const check = await sbauth.verifyPassword(link.email, String(body.password));
    if (!check.ok && check.reason === "unconfirmed") {
      countFail("login", key);
      throw bad(
        "Este e-mail ainda não foi confirmado. Abra o link que enviamos para " +
          link.email +
          " e tente de novo.",
        "email_not_confirmed"
      );
    }
  }
  clearFails("login", key);

  const status = await setPresence(user.id, body.status || "online");
  const session = await auth.createSession(
    user.id,
    (ctx.headers && (ctx.headers["user-agent"] || ctx.headers["User-Agent"])) || ""
  );

  const publicUser = auth.publicUser(
    await attachEmail(Object.assign({}, user, { status }))
  );
  const patch = P.createPatch();
  P.set(patch, "users", user.id, publicUser);
  P.set(patch, "presence", user.id, status);

  return { data: publicUser, patch, setCookies: [session.setCookie] };
}

/* ------------------------------------------------------------
   CONFIRMAÇÃO DE E-MAIL (Supabase Auth)
   ------------------------------------------------------------ */

/* resposta neutra: não revela se o e-mail tem conta ou não */
const RESEND_MSG =
  "Se este e-mail tiver um cadastro pendente, reenviamos a confirmação agora.";

async function resendEmail(ctx) {
  const body = ctx.body || {};
  const email = u.normalizeEmail(body.email);
  if (!email || !u.emailOk(email)) throw bad("Digite um e-mail válido.");

  /* limite local: o Supabase já tem o dele, mas não transformamos
     o Nexo em repetidor de spam */
  if (blocked("resend", email)) {
    throw bad(
      "Aguarde alguns minutos antes de pedir outro e-mail.",
      "rate_limited"
    );
  }
  countFail("resend", email);

  /* O GoTrue é quem sabe se o e-mail tem conta. Antes existia um
     atalho aqui: se o Nexo não achasse vínculo, respondíamos 202 sem
     nem perguntar ao Supabase. Era uma resposta FALSA — uma conta
     criada direto no Supabase Auth (cadastro que abortou no meio,
     antes de gravar o vínculo) não tem vínculo nenhum no Nexo, e o
     reenvio "funcionava" sem enviar nada, dando à pessoa um sucesso
     imaginário.

     Perguntar ao GoTrue não o transforma em ferramenta de descoberta:
     ele responde da mesma forma para e-mail sem conta (não há nada a
     enviar), então a resposta neutra continua igual. */
  if (!sbauth.configured()) {
    return { status: 202, data: { ok: true, message: RESEND_MSG } };
  }

  const r = await sbauth.resend(email);
  if (!r.ok) {
    /* Falha de envio: mantém o status que o sbauth escolheu (503) em
       vez de jogar tudo num 400 genérico, para o navegador mostrar
       "não saiu" e não um sucesso falso. */
    if (r.code) throw new ApiError(r.status || 503, r.message, r.code);
    throw bad(r.message || "Não foi possível reenviar agora.");
  }
  return { status: 202, data: { ok: true, message: RESEND_MSG } };
}

/* o link do e-mail volta para a URL permitida com o token; o
   navegador entrega o token aqui e o SERVIDOR pergunta ao
   Supabase se ele ainda vale. Nada é aceito só porque chegou. */
async function confirmEmail(ctx) {
  const body = ctx.body || {};
  const token = String(body.accessToken || body.token || "").trim();
  /* Importante: aqui LANÇAMOS o erro em vez de devolver {status:400}.
     O router embrulha qualquer retorno como {ok:true} — só o erro
     lançado vira {ok:false} que o navegador entende como falha. */
  if (!token) {
    throw new ApiError(
      400,
      "Este link de confirmação está incompleto. Peça um novo e-mail.",
      "invalid"
    );
  }

  const r = await sbauth.userFromToken(token);
  if (!r.ok) {
    const rede = r.status === 0;
    throw new ApiError(
      rede ? 503 : 400,
      rede
        ? "Não conseguimos verificar o link agora. Verifique sua conexão e tente de novo."
        : "Este link expirou, já foi usado ou é inválido. Peça um novo e-mail de confirmação.",
      rede ? "network" : "invalid"
    );
  }

  const userId = await db.findByAuth("supabaseUid", r.uid);
  if (!userId) throw bad("Não encontramos a conta ligada a este e-mail.");

  try {
    await db.writeAuthLink(userId, {
      supabaseUid: r.uid,
      email: r.email || null,
      emailVerified: true,
      provider: "supabase",
      linkedAt: now(),
    });
  } catch (e) {
    /* prefs indisponíveis: o Supabase já confirmou; o Nexo tenta
       de novo no próximo login */
  }

  return {
    status: 200,
    data: {
      ok: true,
      email: r.email || null,
      message: "E-mail confirmado. Agora você já pode entrar na sua conta.",
    },
  };
}

/* ------------------------------------------------------------
   CONTA VIA FIREBASE AUTHENTICATION
   O navegador entrega SÓ o ID token do Firebase. Quem decide se o
   token é verdadeiro é server/firebase.js (assinatura RS256 do
   Google + aud/iss/exp). O Supabase continua sendo o banco: a
   conta Nexo nasce nas mesmas tabelas, com a mesma RLS, e o
   vínculo fica em prefs.data.auth (sem coluna nova).

   Regra de ouro: o vínculo é SEMPRE pelo uid do Firebase.
   Nunca por e-mail e nunca por nome de usuário — nada de
   "assumir" uma conta antiga que só parece igual.
   ------------------------------------------------------------ */

/* nome de usuário derivado do acesso externo (Google): base do
   e-mail/nome, sanitizado, com sufixo aleatório quando ocupado */
async function deriveUsername(claims) {
  const raw = String(
    (claims.email && claims.email.split("@")[0]) || claims.name || "usuario"
  );
  let base = u
    .normalizeUsername(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._]/g, "")
    .replace(/^[._]+/, "")
    .slice(0, 14);
  if (base.length < 3) base = (base + "nexo").slice(0, 14);
  for (let i = 0; i < 12; i++) {
    const cand =
      i === 0 ? base : base.slice(0, 10) + "." + Math.random().toString(36).slice(2, 6);
    if (cand.length >= 3 && u.usernameOk(cand) && !(await findByUsername(cand)))
      return cand;
  }
  return u.uid("u").replace(/[^a-z0-9._]/g, "").slice(0, 18);
}

/* cria a conta Nexo + vínculo + sessão, como o cadastro comum faz */
async function provisionFirebaseAccount(ctx, claims, username, displayName) {
  const id = u.uid("u");
  let publicId = null;
  try {
    publicId = await pid.pickFree();
  } catch (e) {
    publicId = null;
  }

  const user = {
    id,
    username,
    /* conta criada pelo Firebase: NÃO nasce com senha local.
       O acesso é pelo e-mail (Firebase) ou pelo Google. */
    passwordHash: null,
    displayName: String(displayName || username).trim().slice(0, 32) || username,
    avatar: { emoji: null, color: u.colorFor(id), image: null, model: null },
    banner: null,
    profileColor: u.colorFor(id),
    statusEmoji: "",
    customStatus: "",
    theme: "",
    bio: "",
    birth: null,
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
    publicId: publicId || null,
    email: claims.email || null,
    auth: {
      firebaseUid: claims.uid,
      email: claims.email || null,
      emailVerified: !!claims.emailVerified,
      provider: claims.provider || null,
      linkedAt: now(),
    },
    createdAt: now(),
    updatedAt: now(),
  };

  await db.insert("users", user);
  try {
    const confirmed = await pid.forUser(id);
    if (confirmed) {
      user.publicId = confirmed;
      if (confirmed !== publicId) pid.sweep(true).catch(function () {});
    }
  } catch (e) {
    /* sem número esta vez: a conta existe e a varredura atribui */
  }
  await db.upsert("presence", { userId: id, status: "online", updatedAt: now() });
  const welcome = await createNotification(id, "system", "Bem-vindo à Nexo!");
  /* Servidor Oficial Nexo: sem provisão automática e sem
     notificação de divulgação (removido junto com ensureOfficial). */

  const session = await auth.createSession(
    id,
    (ctx.headers && (ctx.headers["user-agent"] || ctx.headers["User-Agent"])) || ""
  );

  const pub = auth.publicUser(user);
  const patch = P.createPatch();
  P.set(patch, "users", id, pub);
  P.set(patch, "presence", id, "online");
  P.list(patch, "notifications", [welcome]);

  return {
    status: 201,
    data: {
      user: pub,
      created: true,
      emailVerified: !!claims.emailVerified,
      message: "Sua conta foi criada com sucesso.",
    },
    patch,
    setCookies: [session.setCookie],
  };
}

async function firebaseAuth(ctx) {
  const body = ctx.body || {};
  const intent = body.intent === "signup" ? "signup" : "login";

  /* identidade vem do payload ASSINADO — nunca do corpo da requisição */
  const claims = await firebase.verifyIdToken(body.idToken);

  const key = claims.uid;
  if (blocked("fb", key)) {
    throw bad("Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.");
  }

  /* 1) já vinculado? entra (e atualiza o selo de e-mail confirmado) */
  const linkedId = await db.findByFirebaseUid(claims.uid);
  if (linkedId) {
    const user = await findById(linkedId);
    if (user) {
      clearFails("fb", key);
      const prev = user.auth || {};
      if (
        prev.email !== claims.email ||
        prev.emailVerified !== !!claims.emailVerified ||
        prev.provider !== claims.provider
      ) {
        await db.writeAuthLink(user.id, {
          firebaseUid: claims.uid,
          email: claims.email || prev.email || null,
          emailVerified: !!claims.emailVerified,
          provider: claims.provider || prev.provider || null,
        });
      }
      const status = await setPresence(user.id, body.status || "online");
      const session = await auth.createSession(
        user.id,
        (ctx.headers && (ctx.headers["user-agent"] || ctx.headers["User-Agent"])) || ""
      );
      const pub = auth.publicUser(Object.assign({}, user, { status }));
      const patch = P.createPatch();
      P.set(patch, "users", user.id, pub);
      P.set(patch, "presence", user.id, status);
      return {
        data: {
          user: pub,
          created: false,
          emailVerified: !!claims.emailVerified,
        },
        patch,
        setCookies: [session.setCookie],
      };
    }
    /* vínculo apontando para conta que não existe mais: segue como novo */
  }

  /* 2) sem vínculo */
  if (intent === "signup") {
    const username = u.normalizeUsername(body.username);
    if (!username) throw bad("Digite um nome de usuário.");
    if (!u.usernameOk(username))
      throw bad(
        "Nome de usuário precisa de 3 a 18 caracteres (letras, números, ponto e sublinhado), sem espaços."
      );
    const dupe = await findByUsername(username);
    if (dupe) {
      countFail("fb", key);
      throw bad("Esse nome de usuário já está em uso. Tente outro.");
    }
    clearFails("fb", key);
    return provisionFirebaseAccount(ctx, claims, username, body.username || username);
  }

  /* login por e-mail sem conta Nexo: não criamos conta sozinhos aqui.
     Quem quer criar, vai para o cadastro. */
  if (claims.provider !== "google.com") {
    countFail("fb", key);
    throw bad(
      "Não encontramos uma conta Nexo com este e-mail. Crie uma conta primeiro."
    );
  }

  /* Google sem vínculo: cria a conta Nexo automaticamente, com o
     nome de usuário derivado e conferido contra duplicidade. */
  const username = await deriveUsername(claims);
  clearFails("fb", key);
  return provisionFirebaseAccount(ctx, claims, username, claims.name || username);
}

async function logout(ctx) {
  const user = await auth.userFromRequest(ctx.event);
  if (user) await setPresence(user.id, "offline");
  const cookie = await auth.destroySession(ctx.event);
  return { data: { ok: true }, setCookies: cookie ? [cookie] : [] };
}

async function me(ctx) {
  const user = await auth.requireUser(ctx.event);
  const pub = auth.publicUser(await attachEmail(user));
  const patch = P.createPatch();
  P.set(patch, "users", user.id, pub);
  return { data: { user: pub }, patch };
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

/* ------------------------------------------------------------
   Banner do perfil.
   O campo continua sendo UMA STRING (compatível com bancos antigos):
     null                     -> faixa padrão
     data:image/...           -> imagem enviada (JPG/PNG/WebP/GIF)
     data:image/svg+xml;...   -> modelo original do Nexo
     data:video/...           -> vídeo curto, mudo, em loop
   Tudo validado AQUI: tipo, estrutura do data URL e tamanho real.
   ------------------------------------------------------------ */
const BANNER_LIMITS = {
  image: 1400000,
  svg: 60000,
  video: 2400000,
};

function sanitizeBanner(raw) {
  if (raw === null || raw === undefined || raw === "") return null;

  /* formato atual: { src, x, y, zoom } — a imagem vai junto com o
     enquadramento para ele sobreviver a reload e a outro aparelho.
     Dado antigo (string) continua sendo aceito como sempre. */
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const src = sanitizeBanner(raw.src);
    if (!src) return null;
    const num = (v, min, max, dflt) => {
      const n = typeof v === "number" ? v : parseFloat(v);
      if (!isFinite(n)) return dflt;
      return Math.min(max, Math.max(min, n));
    };
    return {
      src: src,
      x: num(raw.x, -50, 50, 0),
      y: num(raw.y, -50, 50, 0),
      zoom: num(raw.zoom, 1, 3, 1),
    };
  }

  if (typeof raw !== "string") throw bad("Banner inválido.");
  const v = raw;

  if (/^data:video\//i.test(v)) {
    if (!/^data:video\/(mp4|webm|ogg|x-m4v);base64,[A-Za-z0-9+/=]+$/i.test(v))
      throw bad("Formato de vídeo não suportado. Use MP4 (H.264) ou WebM.");
    if (v.length > BANNER_LIMITS.video)
      throw bad("Este vídeo é grande demais. Use um arquivo de até 1,7 MB e 10 segundos.");
    return v;
  }

  if (/^data:image\/svg\+xml/i.test(v)) {
    if (v.length > BANNER_LIMITS.svg) throw bad("Modelo de banner inválido.");
    let decoded = "";
    try {
      decoded = decodeURIComponent(v.replace(/^data:image\/svg\+xml;charset=utf-8,/i, ""));
    } catch (e) {
      throw bad("Modelo de banner inválido.");
    }
    if (/<script|<foreignObject|javascript:|\son[a-z]+\s*=/i.test(decoded))
      throw bad("Modelo de banner inválido.");
    return v;
  }

  if (/^data:image\//i.test(v)) {
    if (!/^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=]+$/i.test(v))
      throw bad("Envie uma imagem JPG, PNG ou WebP.");
    if (v.length > BANNER_LIMITS.image)
      throw bad("Este banner é grande demais. Use uma imagem com até 1,5 MB.");
    return v;
  }

  throw bad("Banner inválido.");
}

/* ------------------------------------------------------------
   Atividade de jogo (STATUS MANUAL — "atividade personalizada").
   O site NÃO detecta jogos abertos no computador: a pessoa informa
   o nome do jogo e escolhe quem pode ver. `manual: true` fica
   gravado para a interface sempre sinalizar que não é leitura
   automática, e `visibility` é aplicada em auth.publicUser().
   ------------------------------------------------------------ */
const GAME_VIS = ["public", "friends", "nobody"];

function sanitizeGame(raw) {
  if (raw === null || raw === undefined || raw === false || raw === "") return null;
  if (typeof raw !== "object") throw bad("Atividade de jogo inválida.");
  const name = String(raw.name || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  if (!name) return null;
  const visibility = GAME_VIS.indexOf(raw.visibility) > -1 ? raw.visibility : "friends";
  return { name, visibility, manual: true, updatedAt: now() };
}

/* ------------------------------------------------------------
   Aparência (tema, escala, cor de destaque, brilho, gradiente e
   cores favoritas). Guardada por USUÁRIO em prefs.data — cada
   conta tem a sua e ninguém altera o tema do outro.
   ------------------------------------------------------------ */
function sanitizeAppearance(raw) {
  if (raw === null || raw === undefined || raw === false) return null;
  if (typeof raw !== "object") throw bad("Aparência inválida.");
  const hex = (v) =>
    typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim().toLowerCase() : null;
  const num = (v, min, max, dflt) => {
    const n = Number(v);
    if (!isFinite(n)) return dflt;
    return Math.max(min, Math.min(max, Math.round(n)));
  };
  const out = {};
  if ("mode" in raw)
    out.mode = ["dark", "light", "auto"].indexOf(raw.mode) > -1 ? raw.mode : "auto";
  if ("scale" in raw)
    out.scale = ["sm", "md", "lg"].indexOf(raw.scale) > -1 ? raw.scale : "md";
  if ("accent" in raw) {
    const a = raw.accent && typeof raw.accent === "object" ? raw.accent : {};
    out.accent = { hex: hex(a.hex), glow: num(a.glow, 0, 100, 60) };
  }
  if ("grad" in raw) {
    const g = raw.grad && typeof raw.grad === "object" ? raw.grad : {};
    out.grad = {
      on: g.on !== false,
      angle: num(g.angle, 0, 360, 135),
      intensity: num(g.intensity, 0, 100, 60),
    };
  }
  /* gradiente do CARTÃO de perfil (aparência do perfil) — separado
     do grad da interface: fica só no cartão e nunca muda o site */
  if ("card" in raw) {
    const c = raw.card && typeof raw.card === "object" ? raw.card : {};
    out.card = {
      on: c.on === true,
      angle: num(c.angle, 0, 360, 135),
      from: hex(c.from),
      to: hex(c.to),
    };
  }
  if ("customs" in raw) {
    out.customs = (Array.isArray(raw.customs) ? raw.customs : [])
      .map(hex)
      .filter(Boolean)
      .slice(0, 12);
  }
  return out;
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
    const incoming = patchBody.avatar && typeof patchBody.avatar === "object" ? patchBody.avatar : {};
    const next = Object.assign({}, user.avatar, incoming);

    /* foto: só data URL de imagem raster (sem SVG — e sem URL externa) */
    if ("image" in incoming && incoming.image) {
      if (typeof incoming.image !== "string" || incoming.image.length > 900000)
        throw bad("Esta imagem é grande demais. Use uma com até 1 MB.");
      if (!/^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=]+$/i.test(incoming.image))
        throw bad("Envie uma imagem JPG, PNG ou WebP.");
    } else if ("image" in incoming) {
      next.image = null;
    }

    /* modelo original do Nexo: id curto e simples (a renderização só
       aceita ids conhecidos, qualquer outro cai no modelo automático) */
    if ("model" in incoming) {
      if (
        incoming.model !== null &&
        incoming.model !== "" &&
        (typeof incoming.model !== "string" || !/^[a-z0-9_-]{1,24}$/.test(incoming.model))
      )
        throw bad("Avatar inválido.");
      next.model = incoming.model || null;
    }
    if ("emoji" in incoming) next.emoji = incoming.emoji ? String(incoming.emoji).slice(0, 8) : null;
    if ("color" in incoming && incoming.color && !/^#[0-9a-fA-F]{3,8}$/.test(String(incoming.color)))
      throw bad("Cor de avatar inválida.");

    if (next.emoji) next.emoji = String(next.emoji).slice(0, 8);
    if (next.model && (typeof next.model !== "string" || !/^[a-z0-9_-]{1,24}$/.test(next.model)))
      next.model = null;
    if (next.image && String(next.image).length > 900000)
      throw bad("Esta imagem é grande demais. Use uma com até 1 MB.");

    update.avatar = next;
  }
  if (patchBody.banner !== undefined) update.banner = sanitizeBanner(patchBody.banner);
  if (patchBody.profileColor !== undefined) {
    const pc = patchBody.profileColor;
    if (pc === null || pc === undefined || pc === "") update.profileColor = null;
    else if (typeof pc === "string" && /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(pc.trim()))
      update.profileColor = pc.trim().toLowerCase();
    else throw bad("Cor de perfil inválida. Use um código HEX como #35e0a8.");
  }
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

  if (patchBody.game !== undefined) update.game = sanitizeGame(patchBody.game);
  if (patchBody.appearance !== undefined)
    update.appearance = sanitizeAppearance(patchBody.appearance);

  /* privacidade de "Ativo agora" (atividade de voz): gravada no
     servidor, em prefs.data.privacy — só chaves conhecidas passam */
  if (patchBody.privacy !== undefined) {
    const incoming =
      patchBody.privacy && typeof patchBody.privacy === "object" ? patchBody.privacy : {};
    const cur = user.privacy && typeof user.privacy === "object" ? user.privacy : {};
    const next = Object.assign({}, cur);
    const mode =
      ["all", "friends", "none"].indexOf(incoming.voiceActivity) > -1
        ? incoming.voiceActivity
        : null;
    if (mode) next.voiceActivity = mode;
    update.privacy = next;
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
  /* notificações do Servidor Oficial Nexo (legado) ficam no banco,
     mas não são mais ENTREGUES pela API — filtro de leitura */
  return { data: official.hideOfficialNotes(list) };
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
  const list = official.hideOfficialNotes(
    await db.select("notifications", {
      where: { user_id: user.id },
      order: "at",
      desc: true,
      limit: 80,
    })
  );
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

  /* garante que as contas antigas já tenham ID público antes de
     alguém procurar por número (varredura com limite de frequência) */
  try {
    await pid.sweep();
  } catch (e) {
    /* segue sem número: a busca por @username continua funcionando */
  }

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

  /* amizade prova quem pode ver a atividade "só amigos" */
  const frA = await db.select("friendships", { where: { user_a_id: user.id }, limit: 2000 });
  const frB = await db.select("friendships", { where: { user_b_id: user.id }, limit: 2000 });
  const friendSet = {};
  (frA || []).concat(frB || []).forEach((fr) => {
    const other = fr.userAId === user.id ? fr.userBId : fr.userAId;
    if (other) friendSet[other] = true;
  });

  const norm = (s) => String(s || "").toLowerCase();
  /* o ID que a pessoa digita é o NÚMERO público (ex.: 2344).
     O id interno continua buscável para ferramentas internas. */
  const qid = String(raw).replace(/^#/, "").trim();
  const isPid = /^\d{3,8}$/.test(qid);
  const results = (all || [])
    /* conta de SISTEMA (plataforma) não aparece para ninguém */
    .filter((x) => x && x.id !== user.id && !hidden[x.id] && x.system !== true)
    .map((x) => {
      const un = norm(x.username);
      const dn = norm(x.displayName);
      const mine = String(x.publicId === undefined || x.publicId === null ? "" : x.publicId);
      let rank = -1;
      if (isPid && mine === qid) rank = 0;
      else if (un === q || norm(x.id) === q) rank = 1;
      else if (un.indexOf(q) === 0) rank = 2;
      else if (un.indexOf(q) > -1) rank = 3;
      else if (dn.indexOf(q) > -1) rank = 4;
      return { user: x, rank };
    })
    .filter((x) => x.rank > -1)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        String(a.user.displayName || "").localeCompare(String(b.user.displayName || ""))
    )
    .slice(0, limit)
    .map((x) => auth.publicUser(x.user, user.id, { friend: !!friendSet[x.user.id] }));

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
