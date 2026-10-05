/* ============================================================
   NEXO · api
   Camada de mutações. Tudo é assíncrono, valida permissões e
   sinaliza mudanças via store.commit(scopes).

   PARA CONECTAR UM BACKEND REAL:
   substitua o corpo de cada função por `await fetch('/api/...')`
   mantendo assinaturas e escopos de retorno — nenhuma view muda.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const S = () => NX.selectors;
  const u = () => NX.util;
  const db = () => NX.store.db;
  const fail = (m) => {
    throw NX.fail(m);
  };

  const api = {};
  const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  const delay = () => Promise.resolve();

  /* ---------------- registro de ações e notificações ----------------
     Tudo que é administrativo passa por aqui: fica no próprio db
     (trocar por tabela/endpoint no backend = trocar só estas duas fn). */
  function log(serverId, action, meta) {
    const me = S().me();
    const entry = {
      id: u().uid("lg"),
      serverId: serverId,
      action: action,
      actorId: me ? me.id : null,
      at: Date.now(),
      meta: meta || null,
    };
    db().logs = db().logs || [];
    db().logs.push(entry);
    if (db().logs.length > 500) db().logs.splice(0, db().logs.length - 500);
    return entry;
  }

  function notify(userId, type, text, meta) {
    if (!userId) return null;
    db().notifications = db().notifications || [];
    const n = {
      id: u().uid("nt"),
      userId: userId,
      type: type,
      text: text,
      at: Date.now(),
      read: false,
      meta: meta || null,
    };
    db().notifications.unshift(n);
    if (db().notifications.length > 80) db().notifications.length = 80;
    return n;
  }

  function roleName(serverId, roleId) {
    const r = S().role(roleId);
    return r ? r.name : (S().defaultRole(serverId) || {}).name || "membro";
  }

  function displayNameOf(userId) {
    const usr = S().user(userId);
    return usr ? usr.displayName : "alguém";
  }

  function newInviteCode() {
    let code;
    do {
      code = "";
      for (let i = 0; i < 5; i++) {
        code += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
      }
    } while (db().invites[code]);
    return code;
  }

  function requireServer(serverId) {
    const server = S().server(serverId);
    if (!server) fail("Este servidor não existe mais ou foi excluído.");
    return server;
  }

  function requireMember(serverId) {
    const me = S().me();
    if (!me) fail("Sua sessão expirou. Entre novamente.");
    const m = S().membership(serverId, me.id);
    if (!m) fail("Você não faz parte deste servidor.");
    return { me: me, membership: m };
  }

  function requirePerm(serverId, perm, message) {
    const { me } = requireMember(serverId);
    if (!S().can(serverId, me.id, perm)) fail(message || "Você não tem permissão para isso.");
    return me;
  }

  /* =========================================================
     AUTENTICAÇÃO — camada "backend"
     -------------------------------------------------------
     • identificador único: e-mail OU nome de usuário (também
       aceita @usuario e nome de exibimento quando é único);
     • senha guardada apenas como hash com salt (nx2$…),
       nunca em texto puro — hashes antigos nx1$ são
       atualizados sozinhos no primeiro login certo;
     • códigos de 6 dígitos: aleatórios, temporários (10 min),
       com hash no banco, uso único e limite de tentativas;
     • limite de tentativas de login e de reenvio de código;
     • toda gravação é verificada: se o navegador não salvar,
       a operação falha em voz alta em vez de fingir sucesso.
     ========================================================= */

  const CODE_TTL = 10 * 60 * 1000; /* código expira em 10 min */
  const RESEND_COOLDOWN = 30 * 1000; /* novo envio a cada 30 s */
  const CODE_MAX_ATTEMPTS = 5;
  const LOGIN_MAX_FAILS = 8;
  const LOGIN_FAIL_WINDOW = 15 * 60 * 1000;
  const RESET_MAX_REQ = 4;
  const RESET_REQ_WINDOW = 15 * 60 * 1000;

  function authDB() {
    db().auth = db().auth || {};
    const a = db().auth;
    a.attempts = a.attempts || {};
    a.codes = a.codes || {};
    a.pending = a.pending || {};
    return a;
  }

  function waitLabel(secs) {
    if (secs < 60) return secs + (secs === 1 ? " segundo" : " segundos");
    const m = Math.ceil(secs / 60);
    return m + (m === 1 ? " minuto" : " minutos");
  }

  function attemptRec(kind, key) {
    const a = authDB();
    const id = kind + ":" + key;
    const now = Date.now();
    let rec = a.attempts[id];
    if (!rec || (rec.window && now - rec.first > rec.window)) {
      rec = { count: 0, first: now, until: 0, window: 0 };
      a.attempts[id] = rec;
    }
    return rec;
  }

  function assertNotBlocked(kind, key, max, windowMs) {
    const rec = attemptRec(kind, key);
    rec.window = windowMs;
    if (rec.until && rec.until > Date.now()) {
      const secs = Math.ceil((rec.until - Date.now()) / 1000);
      fail("Muitas tentativas. Aguarde " + waitLabel(secs) + " para tentar de novo.");
    }
  }

  function countFail(kind, key, max, windowMs) {
    const rec = attemptRec(kind, key);
    rec.window = windowMs;
    rec.count += 1;
    if (rec.count >= max) {
      rec.until = Date.now() + windowMs;
      rec.count = 0;
      rec.first = Date.now();
    }
    NX.store.persist();
  }

  function clearFails(kind, key) {
    const a = authDB();
    if (a.attempts[kind + ":" + key]) {
      delete a.attempts[kind + ":" + key];
      NX.store.persist();
    }
  }

  /* encontra a conta por e-mail, @usuário, usuário ou nome único */
  function findAccount(rawIdent) {
    const ident = u().normalizeIdentifier(rawIdent);
    if (!ident) return null;
    const lower = ident.toLowerCase();
    const bare = lower.replace(/^@/, "");
    const users = Object.values(db().users || {});

    let hit = users.find((x) => x.email && x.email.toLowerCase() === lower);
    if (hit) return hit;
    hit = users.find((x) => x.username && x.username.toLowerCase() === bare);
    if (hit) return hit;
    hit = users.find((x) => x.username && x.username.toLowerCase() === lower);
    if (hit) return hit;
    const byName = users.filter(
      (x) => x.displayName && x.displayName.toLowerCase() === lower
    );
    if (byName.length === 1) return byName[0];
    return null;
  }

  /* grava e, se o navegador não aceitar, desfaz o que foi criado */
  function persistOrFail(rollback) {
    if (NX.store.persist()) return true;
    if (typeof rollback === "function") rollback();
    fail(
      "Não foi possível salvar seus dados neste navegador (armazenamento bloqueado ou sem espaço). " +
        "Libere o armazenamento do site e tente novamente."
    );
    return false;
  }

  /* gera + grava o código (hash) e pede o envio à API do servidor.
     O número em si NUNCA volta para a interface: vai direto para
     a API, que monta o e-mail e fala com o provedor. */
  async function issueAndSendCode(user, purpose) {
    const a = authDB();
    const code = u().randCode(6);
    const salt = u().makeSalt();
    const key = purpose + ":" + user.id;
    const now = Date.now();
    const prevRec = a.codes[key];
    const prevPend = a.pending[purpose];

    a.codes[key] = {
      purpose: purpose,
      userId: user.id,
      hash: u().hashPassword(code, salt),
      createdAt: now,
      expiresAt: now + CODE_TTL,
      resendAt: now + RESEND_COOLDOWN,
      attempts: 0,
      maxAttempts: CODE_MAX_ATTEMPTS,
      usedAt: null,
    };
    a.pending[purpose] = { userId: user.id, at: now, expiresAt: now + CODE_TTL };

    const res = await NX.email.send({
      to: user.email,
      name: user.displayName || user.username,
      code: code,
      purpose: purpose,
    });
    NX.email.lastStatus = res;

    /* envio recusado de verdade (provedor/resposta com erro):
       devolvemos o código anterior para não deixar ninguém trancado
       e NUNCA marcamos isso como enviado. */
    if (!res.sent && res.reason !== "not-configured") {
      if (prevRec) a.codes[key] = prevRec;
      else delete a.codes[key];
      if (prevPend) a.pending[purpose] = prevPend;
      else delete a.pending[purpose];
      NX.store.persist();
      return {
        sent: false,
        reason: res.reason,
        resendAt: Date.now() + RESEND_COOLDOWN,
        expiresAt: null,
      };
    }

    NX.store.persist();
    return { sent: res.sent, reason: res.reason, resendAt: a.codes[key].resendAt, expiresAt: a.codes[key].expiresAt };
  }

  /* valida o código digitado (mensagens exigidas pela especificação) */
  function checkCode(user, purpose, typed) {
    const a = authDB();
    const key = purpose + ":" + user.id;
    const rec = a.codes[key];
    const now = Date.now();

    if (!rec || rec.usedAt) fail("Esse código expirou. Solicite um novo código.");
    if (now > rec.expiresAt) {
      rec.usedAt = now;
      NX.store.persist();
      fail("Esse código expirou. Solicite um novo código.");
    }
    if (rec.attempts >= rec.maxAttempts) {
      rec.usedAt = now;
      NX.store.persist();
      fail("Muitas tentativas com este código. Solicite um novo código.");
    }

    const clean = String(typed || "").replace(/\s+/g, "");
    rec.attempts += 1;
    if (!/^\d{6}$/.test(clean)) {
      NX.store.persist();
      fail("O código informado está incorreto.");
    }
    if (!u().verifyPassword(clean, rec.hash)) {
      NX.store.persist();
      fail("O código informado está incorreto.");
    }

    rec.usedAt = now;
    delete a.pending[purpose];
    NX.store.persist();
    return rec;
  }

  function uniqueUsername(base) {
    let clean = String(base || "")
      .toLowerCase()
      .replace(/[^a-z0-9._]/g, "")
      .slice(0, 14);
    while (clean.length < 3) {
      clean = (clean + "usuario" + Math.floor(Math.random() * 90 + 10)).slice(0, 18);
    }
    let name = clean;
    let n = 1;
    const taken = (v) =>
      Object.values(db().users).some((x) => x.username.toLowerCase() === v.toLowerCase());
    while (taken(name)) {
      n += 1;
      name = clean.slice(0, 18 - String(n).length - 1) + "." + n;
    }
    return name;
  }

  function makeUser(o) {
    const id = u().uid("u");
    const salt = u().makeSalt();
    return {
      id: id,
      username: o.username,
      email: String(o.email || "").toLowerCase(),
      password: o.password ? u().hashPassword(o.password, salt) : null,
      displayName: String(o.displayName || o.username).trim().slice(0, 32),
      avatar: {
        emoji: o.emoji || u().emojiFor(o.username),
        color: o.color || u().colorFor(id),
        image: null,
      },
      banner: null,
      profileColor: o.color || u().colorFor(id),
      statusEmoji: "",
      customStatus: "",
      theme: "",
      bio: "",
      birth: o.birth || null,
      status: "online",
      statusText: "",
      blocks: [],
      emailVerified: !!o.emailVerified,
      emailVerifiedAt: o.emailVerified ? Date.now() : null,
      googleId: o.googleId || null,
      createdAt: Date.now(),
    };
  }

  api.signup = async function (data) {
    await delay();
    const username = String(data.username || "").trim();
    const emailAddr = String(data.email || "").trim().toLowerCase();
    const policy = u().passwordPolicy(data.password);

    if (!u().usernameOk(username))
      fail("Nome de usuário precisa de 3 a 18 caracteres (letras, números, ponto e sublinhado).");
    if (!u().isEmail(emailAddr)) fail("Digite um endereço de e-mail válido.");
    if (!policy.ok) fail(policy.message);
    if (String(data.password) !== String(data.confirm)) fail("As senhas não conferem.");
    const age = u().ageFrom(data.birth);
    if (age === null) fail("Informe sua data de nascimento.");
    if (age < 13) fail("Você precisa ter pelo menos 13 anos para criar uma conta.");
    if (age > 120) fail("Data de nascimento inválida.");

    assertNotBlocked("signup", emailAddr, 5, LOGIN_FAIL_WINDOW);

    const dupeName = Object.values(db().users).some(
      (x) => x.username.toLowerCase() === username.toLowerCase()
    );
    if (dupeName) {
      countFail("signup", emailAddr, 5, LOGIN_FAIL_WINDOW);
      fail("Esse nome de usuário já está em uso. Tente outro.");
    }
    const dupeMail = Object.values(db().users).some(
      (x) => x.email && x.email.toLowerCase() === emailAddr
    );
    if (dupeMail) {
      countFail("signup", emailAddr, 5, LOGIN_FAIL_WINDOW);
      fail("Já existe uma conta com esse e-mail. Faça login.");
    }

    const user = makeUser({
      username: username,
      email: emailAddr,
      password: data.password,
      displayName: data.displayName || username,
      birth: data.birth,
      emoji: data.emoji,
      color: data.color,
      emailVerified: false,
    });

    db().users[user.id] = user;
    db().presence[user.id] = "online";

    /* a conta só "existe" depois de gravada de verdade */
    persistOrFail(() => {
      delete db().users[user.id];
      delete db().presence[user.id];
    });

    clearFails("signup", emailAddr);
    notify(user.id, "system", "Bem-vindo à Nexo! Confirme seu e-mail quando puder.");

    const sent = await issueAndSendCode(user, "verify");
    NX.store.commit(["session", "servers", "profile", "presence"]);

    return {
      user: user,
      sent: sent.sent,
      resendAt: sent.resendAt,
      expiresAt: sent.expiresAt,
      message: "Sua conta foi criada com sucesso.",
      emailNotice: NX.email.verifyMessage(sent.sent),
    };
  };

  api.login = async function (data) {
    await delay();
    const ident = u().normalizeIdentifier(data.identifier);
    if (!ident) fail("Digite seu e-mail ou nome de usuário.");
    if (!data.password) fail("Digite sua senha.");
    if (ident.indexOf("@") > -1 && !u().isEmail(ident))
      fail("Digite um endereço de e-mail válido.");

    const key = ident.toLowerCase();
    assertNotBlocked("login", key, LOGIN_MAX_FAILS, LOGIN_FAIL_WINDOW);

    const found = findAccount(ident);
    if (!found) {
      countFail("login", key, LOGIN_MAX_FAILS, LOGIN_FAIL_WINDOW);
      fail("Não encontramos uma conta com esse e-mail ou nome de usuário.");
    }
    if (!u().verifyPassword(String(data.password), found.password || "")) {
      countFail("login", key, LOGIN_MAX_FAILS, LOGIN_FAIL_WINDOW);
      fail("A senha está incorreta.");
    }

    /* atualiza silenciosamente hashes antigos (nx1$ → nx2$) */
    if (u().isLegacyHash(found.password)) {
      found.password = u().hashPassword(String(data.password), u().makeSalt());
      NX.store.persist();
    }

    clearFails("login", key);
    found.status = data.status || "online";
    db().presence[found.id] = found.status;
    NX.session.set(found.id, !!data.remember);
    NX.store.commit(["session", "servers", "profile", "presence"]);
    return found;
  };

  api.logout = async function () {
    await delay();
    const me = S().me();
    if (me) {
      me.status = "offline";
      db().presence[me.id] = "offline";
      db().voice = db().voice.filter((v) => v.userId !== me.id);
    }
    NX.session.clear();
    NX.store.commit(["session", "presence", "voice"]);
  };

  /* -------- verificação de e-mail -------- */
  api.resendCode = async function (purpose) {
    await delay();
    const a = authDB();
    const pend = a.pending[purpose];
    const user = pend ? db().users[pend.userId] : null;
    if (!user) fail("Solicite um novo código de verificação.");

    const key = purpose + ":" + user.id;
    const rec = a.codes[key];
    if (rec && rec.resendAt > Date.now()) {
      const secs = Math.ceil((rec.resendAt - Date.now()) / 1000);
      fail("Aguarde " + waitLabel(secs) + " para solicitar um novo código.");
    }

    const res = await issueAndSendCode(user, purpose);
    return {
      sent: res.sent,
      reason: res.reason,
      resendAt: res.resendAt,
      expiresAt: res.expiresAt,
      /* reenvio: "Novo código enviado." só com confirmação da API */
      message: NX.email.sentMessage(res.sent, "resend"),
    };
  };

  api.verifyEmail = async function (data) {
    await delay();
    const a = authDB();
    const pend = a.pending.verify;
    const user = pend ? db().users[pend.userId] : null;
    if (!user) fail("Esse código expirou. Solicite um novo código.");
    if (pend.expiresAt && Date.now() > pend.expiresAt)
      fail("Esse código expirou. Solicite um novo código.");

    checkCode(user, "verify", data && data.code);

    user.emailVerified = true;
    user.emailVerifiedAt = Date.now();
    NX.store.persist();

    NX.session.set(user.id, true);
    db().presence[user.id] = "online";
    NX.store.commit(["session", "profile", "presence"]);
    return user;
  };

  /* não deixa a tela de verificação travar o usuário enquanto o
     provedor de e-mail ainda não estiver conectado */
  api.skipEmailVerification = async function () {
    await delay();
    const a = authDB();
    const pend = a.pending.verify;
    const user = pend ? db().users[pend.userId] : null;
    if (!user) fail("Sua sessão expirou. Entre novamente.");
    NX.session.set(user.id, true);
    db().presence[user.id] = "online";
    NX.store.commit(["session", "profile", "presence"]);
    return user;
  };

  /* -------- recuperação de senha -------- */
  api.requestReset = async function (identifier) {
    await delay();
    const ident = u().normalizeIdentifier(identifier);
    if (!ident) fail("Digite um endereço de e-mail válido.");
    if (ident.indexOf("@") > -1 && !u().isEmail(ident))
      fail("Digite um endereço de e-mail válido.");

    const key = ident.toLowerCase();
    assertNotBlocked("reset", key, RESET_MAX_REQ, RESET_REQ_WINDOW);
    countFail("reset", key, RESET_MAX_REQ, RESET_REQ_WINDOW);

    const found = findAccount(ident);
    /* resposta genérica exista ou não a conta: evita que qualquer
       pessoa descubra quem tem cadastro no Nexo. */
    if (!found) {
      return {
        ok: true,
        sent: false,
        generic: true,
        noAccount: true,
        resendAt: Date.now() + RESEND_COOLDOWN,
        message: "Se existir uma conta associada a este endereço, enviaremos um código para recuperação.",
      };
    }

    const res = await issueAndSendCode(found, "recover");
    return {
      ok: true,
      sent: res.sent,
      reason: res.reason,
      generic: true,
      resendAt: res.resendAt,
      expiresAt: res.expiresAt,
      /* só afirma envio quando a API confirmou {ok:true} */
      message: NX.email.sentMessage(res.sent, "reset"),
    };
  };

  /* passo 2: valida o código (uso único) e abre um token de
     recuperação curto — guardamos só o hash dele, nunca o valor. */
  api.confirmResetCode = async function (data) {
    await delay();
    data = data || {};
    const a = authDB();
    const pend = a.pending.recover;
    const user = pend ? db().users[pend.userId] : null;
    if (!user) fail("Esse código expirou. Solicite um novo código.");
    if (pend.expiresAt && Date.now() > pend.expiresAt)
      fail("Esse código expirou. Solicite um novo código.");

    checkCode(user, "recover", data.code); /* consome o código */

    const token = u().makeSalt() + u().makeSalt();
    const salt = u().makeSalt();
    a.recovery = {
      userId: user.id,
      tokenHash: u().hashPassword(token, salt),
      createdAt: Date.now(),
      expiresAt: Date.now() + CODE_TTL,
      usedAt: null,
    };
    NX.store.persist();
    return { token: token, expiresAt: a.recovery.expiresAt };
  };

  /* passo 3: troca a senha com salt novo e derruba o que era antigo */
  api.resetPassword = async function (data) {
    await delay();
    data = data || {};
    const a = authDB();
    const rec = a.recovery;
    const user = rec ? db().users[rec.userId] : null;
    if (!user || !data.token) fail("Solicite um novo código de verificação.");
    if (rec.usedAt) fail("Esse código expirou. Solicite um novo código.");
    if (Date.now() > rec.expiresAt) {
      rec.usedAt = Date.now();
      NX.store.persist();
      fail("Esse código expirou. Solicite um novo código.");
    }
    if (!u().verifyPassword(String(data.token), rec.tokenHash))
      fail("Solicite um novo código de verificação.");

    const policy = u().passwordPolicy(data.password);
    if (!policy.ok) fail(policy.message);
    if (String(data.password) !== String(data.confirm)) fail("As senhas não conferem.");

    /* senha: salt novo + hash PBKDF2 novo (nunca texto puro) */
    user.password = u().hashPassword(String(data.password), u().makeSalt());
    user.pwChangedAt = Date.now();

    /* invalida o token, o código e qualquer pendency anterior */
    rec.usedAt = Date.now();
    delete a.pending.recover;
    delete a.codes["recover:" + user.id];
    persistOrFail();

    /* invalida sessões/recuperações antigas deste usuário */
    const sess = NX.session.get();
    if (sess && sess.userId === user.id) NX.session.clear();
    db().prefs = db().prefs || {};
    db().prefs.pwChangedAt = user.pwChangedAt;
    notify(user.id, "system", "Sua senha foi alterada. Se não foi você, revise sua segurança.");
    NX.store.persist();

    return { ok: true, email: user.email };
  };

  /* troca de senha com sessão ativa (Configurações → Minha conta) */
  api.changePassword = async function (data) {
    await delay();
    const me = S().me();
    if (!me) fail("Sua sessão expirou. Entre novamente.");
    data = data || {};

    if (!u().verifyPassword(String(data.current || ""), me.password || ""))
      fail("A senha atual está incorreta.");
    const policy = u().passwordPolicy(data.password);
    if (!policy.ok) fail(policy.message);
    if (String(data.password) !== String(data.confirm)) fail("As senhas não conferem.");

    me.password = u().hashPassword(String(data.password), u().makeSalt());
    persistOrFail();
    db().prefs = db().prefs || {};
    db().prefs.pwChangedAt = Date.now();
    notify(me.id, "system", "Sua senha foi alterada.");
    NX.store.commit(["session"]);
    return { ok: true };
  };

  /* -------- acesso com Google -------- */
  api.googleSignIn = async function (profile) {
    await delay();
    if (!profile || !u().isEmail(profile.email))
      fail("Não foi possível concluir o acesso com o Google.");

    const mailAddr = String(profile.email).trim().toLowerCase();
    assertNotBlocked("google", mailAddr, 5, LOGIN_FAIL_WINDOW);

    let found = findAccount(mailAddr);
    let created = false;

    if (!found) {
      /* primeiro acesso: cria a conta automaticamente… */
      found = makeUser({
        username: uniqueUsername(mailAddr.split("@")[0]),
        email: mailAddr,
        password: null,
        displayName: profile.name || mailAddr.split("@")[0],
        emailVerified: !!profile.email_verified,
        googleId: profile.sub || null,
      });
      db().users[found.id] = found;
      db().presence[found.id] = "online";
      persistOrFail(() => {
        delete db().users[found.id];
        delete db().presence[found.id];
      });
      created = true;
      notify(found.id, "system", "Bem-vindo à Nexo! Conta criada com o Google.");
    } else {
      /* …senão entra na conta existente, sem duplicar nada */
      if (!found.googleId) found.googleId = profile.sub || null;
      if (!found.emailVerified && profile.email_verified) {
        found.emailVerified = true;
        found.emailVerifiedAt = Date.now();
      }
      db().presence[found.id] = "online";
      persistOrFail();
    }

    clearFails("google", mailAddr);
    found.status = "online";
    NX.session.set(found.id, true);
    NX.store.commit(["session", "servers", "profile", "presence"]);
    return { user: found, created: created };
  };

  api.updateProfile = async function (patch) {
    await delay();
    const me = S().me();
    if (!me) fail("Sua sessão expirou. Entre novamente.");

    if (patch.username !== undefined) {
      const username = String(patch.username).trim();
      if (!u().usernameOk(username))
        fail("Nome de usuário precisa de 3 a 18 caracteres (letras, números, . e _).");
      const dupe = Object.values(db().users).some(
        (x) => x.id !== me.id && x.username.toLowerCase() === username.toLowerCase()
      );
      if (dupe) fail("Esse nome de usuário já está em uso.");
      me.username = username;
    }
    if (patch.displayName !== undefined) {
      const n = String(patch.displayName).trim();
      if (n.length < 2) fail("Digite um nome com pelo menos 2 caracteres.");
      me.displayName = n.slice(0, 32);
    }
    if (patch.bio !== undefined) me.bio = String(patch.bio).slice(0, 190);
    if (patch.avatar !== undefined) {
      const next = Object.assign({}, me.avatar, patch.avatar);
      if (next.image && next.image.length > 900000)
        fail("Esta imagem é grande demais. Use uma com até 1 MB.");
      me.avatar = next;
    }
    if (patch.banner !== undefined) {
      if (patch.banner && String(patch.banner).length > 1400000)
        fail("Este banner é grande demais. Use uma imagem com até 1,5 MB.");
      me.banner = patch.banner || null;
    }
    if (patch.profileColor !== undefined) me.profileColor = patch.profileColor || null;
    if (patch.statusEmoji !== undefined) me.statusEmoji = String(patch.statusEmoji || "").slice(0, 8);
    if (patch.customStatus !== undefined)
      me.customStatus = String(patch.customStatus || "").slice(0, 60);
    if (patch.theme !== undefined) me.theme = String(patch.theme || "");
    if (patch.status !== undefined) {
      me.status = patch.status;
      db().presence[me.id] = patch.status;
    }
    if (patch.statusText !== undefined) me.statusText = String(patch.statusText).slice(0, 60);
    if (patch.email !== undefined) {
      const email = String(patch.email).trim().toLowerCase();
      if (!u().isEmail(email)) fail("Digite um e-mail válido.");
      const dupe = Object.values(db().users).some(
        (x) => x.id !== me.id && x.email === email
      );
      if (dupe) fail("Já existe uma conta com esse e-mail.");
      me.email = email;
    }
    NX.store.commit(["profile", "presence"]);
    return me;
  };

  api.setStatus = async function (status) {
    await delay();
    const me = S().me();
    if (!me) return;
    if (["online", "idle", "dnd", "offline"].indexOf(status) === -1) return;
    me.status = status;
    db().presence[me.id] = status;
    NX.store.commit(["presence", "profile"]);
  };

  /* =========================================================
     SERVIDORES
     ========================================================= */
  api.createServer = async function (data) {
    await delay();
    const me = S().me();
    if (!me) fail("Sua sessão expirou. Entre novamente.");
    const name = String(data.name || "").trim();
    if (name.length < 2) fail("Dê um nome com pelo menos 2 caracteres ao servidor.");
    if (name.length > 40) fail("O nome pode ter no máximo 40 caracteres.");

    const id = u().uid("sv");
    db().servers[id] = {
      id: id,
      name: name,
      description: String(data.description || "").slice(0, 240),
      icon: { emoji: data.emoji || u().emojiFor(name), color: data.color || u().colorFor(id), image: null },
      banner: null,
      appearance: {
        primary: "#35e0a8",
        secondary: "#8f83ff",
        backgroundImage: null,
        theme: "dark",
      },
      ownerId: me.id,
      discoverable: false,
      createdAt: Date.now(),
    };

    const defRole = {
      id: u().uid("rl"),
      serverId: id,
      name: "Membros",
      color: "#93a8a4",
      position: 0,
      isDefault: true,
      permissions: NX.defaultPerms(["viewChannels", "sendMessages", "createInvite", "joinVoice"]),
      createdAt: Date.now(),
    };
    db().roles[defRole.id] = defRole;

    const ownerMemberId = u().uid("mb");
    db().memberships[ownerMemberId] = {
      id: ownerMemberId,
      serverId: id,
      userId: me.id,
      roleId: defRole.id,
      permissions: {},
      joinedAt: Date.now(),
    };

    const template = NX.TEMPLATES.find((t) => t.id === (data.templateId || "comunidade")) || NX.TEMPLATES[0];
    let order = 0;
    template.cats.forEach((cat) => {
      const catId = u().uid("ct");
      db().categories[catId] = {
        id: catId, serverId: id, name: cat.name, order: order++, collapsed: false,
        perms: {},
      };
      cat.channels.forEach((ch, i) => {
        const chId = u().uid("ch");
        db().channels[chId] = {
          id: chId,
          serverId: id,
          categoryId: catId,
          name: ch[0],
          type: ch[1],
          order: i,
          topic: "",
          perms: {},
          inheritPerms: true,
          overrides: { view: "all", send: "all" },
          createdBy: me.id,
          createdAt: Date.now(),
        };
      });
    });

    /* primeiro canal de texto vira canal inicial */
    const first = S().channelsOf(id).find((c) => c.type === "text");
    NX.store.ui.lastChannel[id] = first ? first.id : null;
    NX.store.commitUI();
    NX.store.commit(["servers", "members", "categories", "channels", "route"]);
    return db().servers[id];
  };

  api.updateServer = async function (serverId, patch) {
    await delay();
    requireServer(serverId);
    requirePerm(serverId, "manageServer", "Você não tem permissão para editar este servidor.");
    const s = db().servers[serverId];
    const changed = [];
    if (patch.name !== undefined) {
      const n = String(patch.name).trim();
      if (n.length < 2) fail("O nome precisa de pelo menos 2 caracteres.");
      if (n !== s.name) changed.push("nome");
      s.name = n.slice(0, 40);
    }
    if (patch.description !== undefined) s.description = String(patch.description).slice(0, 240);
    if (patch.icon !== undefined) {
      const next = Object.assign({}, s.icon, patch.icon);
      if (next.image && next.image.length > 900000)
        fail("Esta imagem é grande demais. Use uma com até 1 MB.");
      s.icon = next;
      changed.push("ícone");
    }
    if (patch.banner !== undefined) {
      if (patch.banner && String(patch.banner).length > 1400000)
        fail("Este banner é grande demais. Use uma imagem com até 1,5 MB.");
      s.banner = patch.banner || null;
      changed.push("banner");
    }
    if (patch.appearance !== undefined) {
      s.appearance = Object.assign(
        { primary: "#35e0a8", secondary: "#8f83ff", backgroundImage: null, theme: "dark" },
        s.appearance,
        patch.appearance
      );
      changed.push("aparência");
    }
    if (patch.discoverable !== undefined) {
      s.discoverable = !!patch.discoverable;
      changed.push("visibilidade");
    }
    if (changed.length) log(serverId, "server.update", { what: changed.join(", ") });
    NX.store.commit(["servers"]);
    return s;
  };

  api.deleteServer = async function (serverId) {
    await delay();
    const server = requireServer(serverId);
    const me = S().me();
    if (server.ownerId !== me.id) fail("Apenas o dono do servidor pode excluí-lo.");

    Object.values(db().memberships).forEach((m) => {
      if (m.serverId === serverId) delete db().memberships[m.id];
    });
    Object.values(db().roles).forEach((r) => {
      if (r.serverId === serverId) delete db().roles[r.id];
    });
    const catIds = [];
    Object.values(db().categories).forEach((c) => {
      if (c.serverId === serverId) {
        catIds.push(c.id);
        delete db().categories[c.id];
      }
    });
    Object.values(db().channels).forEach((c) => {
      if (c.serverId === serverId) {
        Object.values(db().messages).forEach((m) => {
          if (m.channelId === c.id) delete db().messages[m.id];
        });
        delete db().channels[c.id];
      }
    });
    Object.values(db().invites).forEach((i) => {
      if (i.serverId === serverId) delete db().invites[i.code];
    });
    Object.values(db().bans || {}).forEach((b) => {
      if (b.serverId === serverId) delete db().bans[b.id];
    });
    Object.values(db().emojis || {}).forEach((e) => {
      if (e.serverId === serverId) delete db().emojis[e.id];
    });
    db().logs = (db().logs || []).filter((l) => l.serverId !== serverId);
    db().voice = db().voice.filter((v) => !!db().channels[v.channelId]);
    delete db().servers[serverId];
    delete NX.store.ui.lastChannel[serverId];
    NX.store.commitUI();
    NX.store.commit(["servers", "members", "categories", "channels", "messages", "invites", "route"]);
    return true;
  };

  api.leaveServer = async function (serverId) {
    await delay();
    requireServer(serverId);
    const me = S().me();
    const server = db().servers[serverId];
    if (server.ownerId === me.id)
      fail("Você é o dono. Exclua o servidor ou transfira a propriedade antes de sair.");
    const m = S().membership(serverId, me.id);
    if (m) delete db().memberships[m.id];
    db().voice = db().voice.filter((v) => v.userId !== me.id);
    log(serverId, "member.leave", { userId: me.id });
    Object.values(db().memberships)
      .filter((x) => x.serverId === serverId)
      .slice(0, 1)
      .forEach((x) =>
        notify(x.userId, "server", me.displayName + " saiu de " + server.name + ".")
      );
    NX.store.commit(["servers", "members", "voice", "route"]);
    return true;
  };

  api.joinByInvite = async function (code) {
    await delay();
    const me = S().me();
    if (!me) fail("Entre na sua conta para aceitar o convite.");
    const clean = u().normalize(String(code || "")).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const invite = S().invite(clean);
    if (!invite) {
      const maybe = Object.keys(db().servers).find(
        (id) => u().slug(db().servers[id].name) === clean.toLowerCase()
      );
      if (!maybe) fail("Convite inválido ou expirado. Peça um novo link para quem criou.");
      return api.joinServer(maybe);
    }
    if (invite.expiresAt && invite.expiresAt < Date.now()) {
      delete db().invites[invite.code];
      NX.store.commit(["invites"]);
      fail("Este convite expirou. Peça um novo link para quem criou.");
    }
    if (invite.maxUses && invite.uses >= invite.maxUses)
      fail("Este convite atingiu o limite de usos. Peça um novo link.");
    return api.joinServer(invite.serverId, invite);
  };

  api.joinServer = async function (serverId, invite) {
    await delay();
    const server = requireServer(serverId);
    const me = S().me();
    if (!me) fail("Entre na sua conta para entrar no servidor.");
    if (S().membership(serverId, me.id))
      fail("Você já faz parte deste servidor.");
    const ban = S().banOf(serverId, me.id);
    if (ban)
      fail(
        "Você foi banido deste servidor" +
          (ban.reason ? " pelo motivo: " + ban.reason : ".") +
          " Fale com a moderação."
      );
    const defRole = S().defaultRole(serverId);
    const memberId = u().uid("mb");
    db().memberships[memberId] = {
      id: memberId,
      serverId: serverId,
      userId: me.id,
      roleId: defRole ? defRole.id : null,
      permissions: {},
      nickname: "",
      joinedAt: Date.now(),
    };
    if (invite) {
      invite.uses = (invite.uses || 0) + 1;
      invite.lastUsedAt = Date.now();
    } else {
      const gen = S().invitesOf(serverId)[0];
      if (gen) gen.uses = (gen.uses || 0) + 1;
    }
    const first = S().channelsOf(serverId).find(
      (c) => c.type === "text" && S().canViewChannel(c, me.id)
    );
    NX.store.ui.lastChannel[serverId] = first ? first.id : null;
    NX.store.commitUI();
    log(serverId, "member.join", { userId: me.id });
    if (server.ownerId !== me.id)
      notify(server.ownerId, "server", me.displayName + " entrou em " + server.name + ".");
    NX.store.commit(["servers", "members", "channels", "invites", "route"]);
    return server;
  };

  /* =========================================================
     CARGOS
     ========================================================= */
  api.createRole = async function (serverId, data) {
    await delay();
    requirePerm(serverId, "manageRoles", "Você não tem permissão para criar cargos.");
    const name = String(data.name || "").trim();
    if (name.length < 2) fail("Dê um nome com pelo menos 2 caracteres ao cargo.");
    const perms = {};
    NX.PERM_KEYS.forEach((k) => (perms[k] = !!(data.permissions && data.permissions[k])));
    const count = S().rolesOf(serverId).length;
    const role = {
      id: u().uid("rl"),
      serverId: serverId,
      name: name.slice(0, 30),
      color: data.color || "#35e0a8",
      icon: String(data.icon || "").slice(0, 4),
      description: String(data.description || "").slice(0, 120),
      position: count,
      isDefault: false,
      permissions: perms,
      createdAt: Date.now(),
    };
    db().roles[role.id] = role;
    log(serverId, "role.create", { name: role.name });
    NX.store.commit(["roles", "members"]);
    return role;
  };

  api.updateRole = async function (roleId, patch) {
    await delay();
    const role = S().role(roleId);
    if (!role) fail("Cargo não encontrado.");
    requirePerm(role.serverId, "manageRoles", "Você não tem permissão para editar cargos.");
    if (patch.name !== undefined) {
      const n = String(patch.name).trim();
      if (n.length < 2) fail("O nome do cargo precisa de pelo menos 2 caracteres.");
      role.name = n.slice(0, 30);
    }
    if (patch.color !== undefined) role.color = patch.color;
    if (patch.icon !== undefined) role.icon = String(patch.icon || "").slice(0, 4);
    if (patch.description !== undefined)
      role.description = String(patch.description || "").slice(0, 120);
    if (patch.position !== undefined) role.position = patch.position;
    if (patch.permissions !== undefined) {
      const perms = {};
      NX.PERM_KEYS.forEach((k) => (perms[k] = !!patch.permissions[k]));
      role.permissions = perms;
    }
    log(role.serverId, "role.update", { name: role.name });
    NX.store.commit(["roles", "members"]);
    return role;
  };

  api.deleteRole = async function (roleId) {
    await delay();
    const role = S().role(roleId);
    if (!role) fail("Cargo não encontrado.");
    requirePerm(role.serverId, "manageRoles", "Você não tem permissão para apagar cargos.");
    if (role.isDefault) fail("O cargo padrão não pode ser excluído.");
    const def = S().defaultRole(role.serverId);
    Object.values(db().memberships).forEach((m) => {
      if (m.roleId === roleId) m.roleId = def ? def.id : null;
    });
    delete db().roles[roleId];
    log(role.serverId, "role.delete", { name: role.name });
    NX.store.commit(["roles", "members"]);
    return true;
  };

  api.setMemberRole = async function (serverId, userId, roleId) {
    await delay();
    const me = requirePerm(serverId, "manageRoles", "Você não tem permissão para gerenciar cargos.");
    if (userId === me.id) fail("Você não pode alterar o próprio cargo por aqui.");
    const server = requireServer(serverId);
    if (server.ownerId === userId) fail("O dono do servidor tem todos os cargos.");
    const m = S().membership(serverId, userId);
    if (!m) fail("Este membro não está mais no servidor.");
    if (roleId && !S().role(roleId)) fail("Cargo inválido.");
    m.roleId = roleId || (S().defaultRole(serverId) || {}).id || null;
    log(serverId, "member.role", { userId: userId, role: roleName(serverId, m.roleId) });
    notify(userId, "server", "Seu cargo em " + server.name + " agora é " + roleName(serverId, m.roleId) + ".");
    NX.store.commit(["members"]);
    return m;
  };

  api.updateMemberPerms = async function (serverId, userId, patch) {
    await delay();
    const me = requirePerm(serverId, "manageRoles", "Você não tem permissão para alterar permissões.");
    const server = requireServer(serverId);
    if (server.ownerId === userId) fail("O dono já possui todas as permissões.");
    if (userId === me.id && !S().can(serverId, me.id, "administrator"))
      fail("Você só pode alterar permissões de outros membros.");
    const m = S().membership(serverId, userId);
    if (!m) fail("Este membro não está mais no servidor.");
    m.permissions = m.permissions || {};
    NX.PERM_KEYS.forEach((k) => {
      if (patch[k] === true || patch[k] === false) m.permissions[k] = patch[k];
    });
    log(serverId, "member.role", { userId: userId, what: "permissões individuais" });
    NX.store.commit(["members"]);
    return m;
  };

  /* apelido específico do servidor (perfil por servidor) */
  api.setNickname = async function (serverId, userId, nickname) {
    await delay();
    const me = S().me();
    const m = S().membership(serverId, userId);
    if (!m) fail("Este membro não está mais no servidor.");
    const isSelf = me.id === userId;
    if (!isSelf) requirePerm(serverId, "manageMembers", "Você não tem permissão para alterar apelidos.");
    m.nickname = String(nickname || "").slice(0, 32);
    if (isSelf) log(serverId, "member.nick", { userId: userId, nick: m.nickname || "(removido)" });
    NX.store.commit(["members"]);
    return m;
  };

  /* hierarquia: ninguém age sobre o dono; só dono/admin age sobre admin */
  function assertCanActOn(serverId, me, targetId) {
    const server = db().servers[serverId];
    if (server.ownerId === targetId) fail("Esta ação não se aplica ao dono do servidor.");
    const targetIsAdmin = S().can(serverId, targetId, "administrator");
    const iAmAdmin = S().can(serverId, me.id, "administrator") || server.ownerId === me.id;
    if (targetIsAdmin && !iAmAdmin)
      fail("Você não pode aplicar esta ação a um administrador.");
  }

  api.kickMember = async function (serverId, userId, reason) {
    await delay();
    const me = requirePerm(serverId, "kickMembers", "Você não tem permissão para expulsar membros.");
    const server = requireServer(serverId);
    if (userId === me.id) fail("Use “Sair do servidor” para sair.");
    assertCanActOn(serverId, me, userId);
    const m = S().membership(serverId, userId);
    if (!m) fail("Este membro não está mais no servidor.");
    delete db().memberships[m.id];
    db().voice = db().voice.filter((v) => v.userId !== userId);
    log(serverId, "member.kick", { userId: userId, reason: reason || "" });
    notify(userId, "server", "Você foi expulso de " + server.name + (reason ? ": " + reason : "."));
    NX.store.commit(["members", "voice"]);
    return true;
  };

  api.banMember = async function (serverId, userId, reason) {
    await delay();
    const me = requirePerm(serverId, "banMembers", "Você não tem permissão para banir membros.");
    const server = requireServer(serverId);
    if (userId === me.id) fail("Você não pode banir a si mesmo.");
    assertCanActOn(serverId, me, userId);
    const id = u().uid("bn");
    db().bans[id] = {
      id: id,
      serverId: serverId,
      userId: userId,
      reason: String(reason || "").slice(0, 160),
      byId: me.id,
      at: Date.now(),
    };
    const m = S().membership(serverId, userId);
    if (m) delete db().memberships[m.id];
    db().voice = db().voice.filter((v) => v.userId !== userId);
    log(serverId, "member.ban", { userId: userId, reason: reason || "" });
    notify(userId, "server", "Você foi banido de " + server.name + (reason ? ": " + reason : "."));
    NX.store.commit(["members", "voice"]);
    return db().bans[id];
  };

  api.unbanMember = async function (banId) {
    await delay();
    const ban = (db().bans || {})[banId];
    if (!ban) fail("Este banimento não existe mais.");
    requirePerm(ban.serverId, "unbanMembers", "Você não tem permissão para desbanir membros.");
    delete db().bans[banId];
    log(ban.serverId, "member.unban", { userId: ban.userId, reason: ban.reason || "" });
    const usr = S().user(ban.userId);
    if (usr) notify(ban.userId, "server", "Você foi desbanido de " + (S().server(ban.serverId) || {}).name + ".");
    NX.store.commit(["members"]);
    return true;
  };

  /* duas etapas: escolher membro + confirmar que você perde a propriedade */
  api.transferOwnership = async function (serverId, userId) {
    await delay();
    const server = requireServer(serverId);
    const me = S().me();
    if (server.ownerId !== me.id) fail("Apenas o dono pode transferir a propriedade.");
    if (userId === me.id) fail("Escolha outro membro.");
    const m = S().membership(serverId, userId);
    if (!m) fail("Escolha um membro que esteja no servidor.");
    const prevOwner = server.ownerId;
    server.ownerId = userId;
    log(serverId, "ownership.transfer", { userId: userId, from: prevOwner });
    notify(userId, "server", "Você agora é o dono de " + server.name + ".");
    NX.store.commit(["servers", "members"]);
    return server;
  };

  /* =========================================================
     CATEGORIAS
     ========================================================= */
  api.createCategory = async function (serverId, data) {
    await delay();
    const me = requirePerm(serverId, "manageChannels", "Você não tem permissão para criar categorias.");
    const name = String(data.name || "").trim();
    if (name.length < 2) fail("Dê um nome com pelo menos 2 caracteres à categoria.");
    const order = S().categoriesOf(serverId).length;
    const cat = {
      id: u().uid("ct"),
      serverId: serverId,
      name: name.slice(0, 32).toUpperCase(),
      order: order,
      collapsed: false,
      perms: {},
    };
    db().categories[cat.id] = cat;
    log(serverId, "category.create", { name: cat.name });

    if (data.firstChannel) {
      const chName = u().slug(data.firstChannel) || "geral";
      const chId = u().uid("ch");
      const ch = {
        id: chId,
        serverId: serverId,
        categoryId: cat.id,
        name: chName,
        type: "text",
        order: 0,
        topic: "",
        perms: {},
        inheritPerms: true,
        overrides: { view: "all", send: "all" },
        createdBy: me.id,
        createdAt: Date.now(),
      };
      db().channels[chId] = ch;
      NX.store.commit(["categories", "channels"]);
      return { category: cat, channel: ch };
    }
    NX.store.commit(["categories"]);
    return { category: cat };
  };

  api.renameCategory = async function (categoryId, name) {
    await delay();
    const cat = S().category(categoryId);
    if (!cat) fail("Categoria não encontrada.");
    requirePerm(cat.serverId, "manageChannels", "Você não tem permissão para editar categorias.");
    const n = String(name || "").trim();
    if (n.length < 2) fail("Dê um nome com pelo menos 2 caracteres à categoria.");
    cat.name = n.slice(0, 32).toUpperCase();
    log(cat.serverId, "category.update", { name: cat.name });
    NX.store.commit(["categories"]);
    return cat;
  };

  api.deleteCategory = async function (categoryId) {
    await delay();
    const cat = S().category(categoryId);
    if (!cat) fail("Categoria não encontrada.");
    requirePerm(cat.serverId, "manageChannels", "Você não tem permissão para apagar categorias.");
    const chans = S().channelsOfCategory(categoryId);
    chans.forEach((c) => {
      Object.values(db().messages).forEach((m) => {
        if (m.channelId === c.id) delete db().messages[m.id];
      });
      delete db().channels[c.id];
      db().voice = db().voice.filter((v) => v.channelId !== c.id);
    });
    delete db().categories[categoryId];
    log(cat.serverId, "category.delete", { name: cat.name, channels: chans.length });
    NX.store.commit(["categories", "channels", "messages", "voice"]);
    return { removedChannels: chans.length };
  };

  api.toggleCategory = async function (categoryId) {
    const cat = S().category(categoryId);
    if (!cat) return;
    cat.collapsed = !cat.collapsed;
    NX.store.commit(["categories"]);
  };

  /* =========================================================
     CANAIS
     ========================================================= */
  api.createChannel = async function (serverId, data) {
    await delay();
    const me = requirePerm(serverId, "manageChannels", "Você não tem permissão para criar canais.");
    const type = data.type === "voice" ? "voice" : "text";
    const raw = String(data.name || "").trim();
    const name = type === "voice" ? raw.replace(/\s+/g, " ").slice(0, 32) : u().slug(raw);
    if (name.length < 2) fail("Dê um nome com pelo menos 2 caracteres ao canal.");
    const cat = S().category(data.categoryId);
    if (!cat || cat.serverId !== serverId) fail("Escolha uma categoria válida.");
    const order = S().channelsOfCategory(cat.id).length;
    const ch = {
      id: u().uid("ch"),
      serverId: serverId,
      categoryId: cat.id,
      name: name,
      type: type,
      order: order,
      topic: String(data.topic || "").slice(0, 180),
      perms: {},
      inheritPerms: data.inheritPerms === false ? false : true,
      overrides: {
        view: data.view === "private" ? "private" : "all",
        send: data.send === "private" || data.send === "none" ? data.send : "all",
      },
      createdBy: me.id,
      createdAt: Date.now(),
    };
    db().channels[ch.id] = ch;
    log(serverId, "channel.create", { name: "#" + name, type: type });
    NX.store.commit(["channels", "categories", "route"]);
    return ch;
  };

  api.updateChannel = async function (channelId, patch) {
    await delay();
    const ch = S().channel(channelId);
    if (!ch) fail("Canal não encontrado.");
    requirePerm(ch.serverId, "manageChannels", "Você não tem permissão para editar canais.");
    if (patch.name !== undefined) {
      const raw = String(patch.name).trim();
      const name = ch.type === "voice" ? raw.replace(/\s+/g, " ").slice(0, 32) : u().slug(raw);
      if (name.length < 2) fail("O nome do canal precisa de pelo menos 2 caracteres.");
      ch.name = name;
    }
    if (patch.topic !== undefined) ch.topic = String(patch.topic).slice(0, 180);
    if (patch.categoryId !== undefined) {
      const cat = S().category(patch.categoryId);
      if (!cat || cat.serverId !== ch.serverId) fail("Categoria inválida.");
      ch.categoryId = cat.id;
      ch.order = S().channelsOfCategory(cat.id).length;
    }
    if (patch.overrides !== undefined) {
      const ov = patch.overrides || {};
      ch.overrides = {
        view: ov.view === "private" ? "private" : "all",
        send: ov.send === "private" || ov.send === "none" ? ov.send : "all",
      };
    }
    if (patch.topic !== undefined || patch.name !== undefined || patch.overrides !== undefined)
      log(ch.serverId, "channel.update", { name: "#" + ch.name });
    NX.store.commit(["channels", "route"]);
    return ch;
  };

  /* permissões finas por canal/categoria: state = true (permitir),
     false (negar) ou null (herdar) */
  function setPermOn(container, targetKey, permKey, state) {
    if (NX.PERM_KEYS.indexOf(permKey) === -1) fail("Permissão desconhecida.");
    if (!container.perms) container.perms = {};
    if (!container.perms[targetKey]) container.perms[targetKey] = {};
    if (state === null || state === undefined) delete container.perms[targetKey][permKey];
    else container.perms[targetKey][permKey] = state === true;
    if (container.perms[targetKey] && !Object.keys(container.perms[targetKey]).length)
      delete container.perms[targetKey];
    if (!Object.keys(container.perms).length) delete container.perms;
  }

  api.setChannelPerm = async function (channelId, targetKey, permKey, state) {
    await delay();
    const ch = S().channel(channelId);
    if (!ch) fail("Canal não encontrado.");
    requirePerm(ch.serverId, "manageChannels", "Você não tem permissão para alterar permissões.");
    setPermOn(ch, targetKey, permKey, state);
    log(ch.serverId, "channel.update", { name: "#" + ch.name, what: "permissões" });
    NX.store.commit(["channels"]);
    return ch;
  };

  api.setCategoryPerm = async function (categoryId, targetKey, permKey, state) {
    await delay();
    const cat = S().category(categoryId);
    if (!cat) fail("Categoria não encontrada.");
    requirePerm(cat.serverId, "manageChannels", "Você não tem permissão para alterar permissões.");
    setPermOn(cat, targetKey, permKey, state);
    log(cat.serverId, "category.update", { name: cat.name, what: "permissões" });
    NX.store.commit(["categories"]);
    return cat;
  };

  api.setChannelInheritance = async function (channelId, inherit) {
    await delay();
    const ch = S().channel(channelId);
    if (!ch) fail("Canal não encontrado.");
    requirePerm(ch.serverId, "manageChannels", "Você não tem permissão para alterar permissões.");
    ch.inheritPerms = !!inherit;
    NX.store.commit(["channels"]);
    return ch;
  };

  api.deleteChannel = async function (channelId) {
    await delay();
    const ch = S().channel(channelId);
    if (!ch) fail("Canal não encontrado.");
    requirePerm(ch.serverId, "manageChannels", "Você não tem permissão para apagar canais.");
    Object.values(db().messages).forEach((m) => {
      if (m.channelId === channelId) delete db().messages[m.id];
    });
    db().voice = db().voice.filter((v) => v.channelId !== channelId);
    delete db().channels[channelId];
    log(ch.serverId, "channel.delete", { name: "#" + ch.name });
    NX.store.commit(["channels", "messages", "voice", "route"]);
    return true;
  };

  /* =========================================================
     MENSAGENS (texto, anexos, reações, fixação, denúncia)
     ========================================================= */
  const ATTACH_TYPES = ["image", "video", "file", "gif"];

  function sanitizeAttachments(list) {
    if (!list || !list.length) return [];
    if (list.length > 4) fail("Envie no máximo 4 anexos por mensagem.");
    return list.slice(0, 4).map((a) => {
      const type = ATTACH_TYPES.indexOf(a.type) !== -1 ? a.type : "file";
      const url = String(a.url || "");
      if (url.length > 1600000) fail("Este arquivo é grande demais (máximo 1,5 MB).");
      if (!/^(data:image\/|data:video\/|blob:|https?:\/\/)/i.test(url))
        fail("Formato de arquivo não suportado.");
      return {
        type: type,
        url: url,
        name: String(a.name || "arquivo").slice(0, 80),
        size: Number(a.size) || 0,
      };
    });
  }

  api.sendMessage = async function (ref, content, opts) {
    await delay();
    const me = S().me();
    if (!me) fail("Sua sessão expirou. Entre novamente.");
    opts = opts || {};
    const text = String(content || "").trim();
    const attachments = sanitizeAttachments(opts.attachments);
    if (!text && !attachments.length) fail("");
    if (text.length > 2000) fail("As mensagens podem ter no máximo 2000 caracteres.");

    if (String(ref).indexOf("dm_") === 0) {
      const dm = db().dms[ref];
      if (!dm || dm.participants.indexOf(me.id) === -1) fail("Conversa não encontrada.");
      const otherId = dm.participants.find((p) => p !== me.id);
      if (otherId && S().isBlocked(otherId, me.id))
        fail("Você não pode enviar mensagens para esta pessoa.");
      if (otherId && S().isBlocked(me.id, otherId))
        fail("Desbloqueie esta pessoa para voltar a conversar.");
    } else {
      const ch = S().channel(ref);
      if (!ch) fail("Este canal não existe mais.");
      if (!S().canSendIn(ch, me.id))
        fail("Você não pode enviar mensagens neste canal.");
      const p = S().effectiveChannelPerms(ch, me.id);
      if (attachments.length && !p.attachFiles)
        fail("Seu cargo não tem a permissão “Anexar arquivos” aqui.");
      if (attachments.some((a) => a.type === "gif") && !p.useGifs)
        fail("Seu cargo não tem a permissão “Usar GIFs” aqui.");
      if (!text && attachments.length && !p.useEmojis)
        fail("Seu cargo não pode enviar mídia sem texto neste canal.");
    }

    const m = {
      id: u().uid("ms"),
      channelId: ref,
      authorId: me.id,
      content: text.slice(0, 2000),
      attachments: attachments,
      reactions: {},
      pinned: false,
      createdAt: Date.now(),
      updatedAt: null,
    };
    db().messages[m.id] = m;
    NX.store.commit(["messages"]);
    return m;
  };

  api.editMessage = async function (messageId, content) {
    await delay();
    const me = S().me();
    const m = db().messages[messageId];
    if (!m) fail("Mensagem não encontrada.");
    const isMine = m.authorId === me.id;
    if (!isMine) {
      const ch = S().channel(m.channelId);
      if (!ch) fail("Mensagem não encontrada.");
      if (!S().channelPerm(ch, me.id, "editMessages"))
        fail("Você não tem permissão para editar mensagens de outras pessoas.");
    }
    const text = String(content || "").trim();
    if (!text) fail("A mensagem não pode ficar vazia.");
    m.content = text.slice(0, 2000);
    m.updatedAt = Date.now();
    NX.store.commit(["messages"]);
    return m;
  };

  api.deleteMessage = async function (messageId) {
    await delay();
    const me = S().me();
    const m = db().messages[messageId];
    if (!m) fail("Mensagem não encontrada.");
    const isMine = m.authorId === me.id;
    if (!isMine) {
      const ch = S().channel(m.channelId);
      if (!ch) fail("Mensagem não encontrada.");
      if (!S().channelPerm(ch, me.id, "deleteMessages"))
        fail("Você não tem permissão para apagar mensagens de outras pessoas.");
      log(ch.serverId, "message.delete", { userId: m.authorId, channel: "#" + ch.name });
    }
    delete db().messages[messageId];
    NX.store.commit(["messages"]);
    return true;
  };

  api.toggleReaction = async function (messageId, emoji) {
    await delay();
    const me = S().me();
    const m = db().messages[messageId];
    if (!m) fail("Mensagem não encontrada.");
    const key = String(emoji || "").slice(0, 12);
    if (!key) fail("");
    if (String(m.channelId).indexOf("dm_") === 0) {
      const dm = db().dms[m.channelId];
      if (!dm || dm.participants.indexOf(me.id) === -1) fail("Conversa não encontrada.");
      if (S().blockedBetween(m.authorId, me.id) && m.authorId !== me.id)
        fail("Você não pode reagir nesta conversa.");
    } else {
      const ch = S().channel(m.channelId);
      if (!ch) fail("Este canal não existe mais.");
      if (!S().canSendIn(ch, me.id)) fail("Você não pode reagir neste canal.");
      if (!S().channelPerm(ch, me.id, "useEmojis"))
        fail("Seu cargo não tem a permissão “Usar emojis” aqui.");
    }
    if (!m.reactions) m.reactions = {};
    const list = m.reactions[key] || [];
    const i = list.indexOf(me.id);
    if (i === -1) list.push(me.id);
    else list.splice(i, 1);
    if (list.length) m.reactions[key] = list;
    else delete m.reactions[key];
    NX.store.commit(["messages"]);
    return m;
  };

  api.pinMessage = async function (messageId, pin) {
    await delay();
    const me = S().me();
    const m = db().messages[messageId];
    if (!m) fail("Mensagem não encontrada.");
    const ch = S().channel(m.channelId);
    if (!ch) fail("Esta mensagem não está em um canal.");
    const mine = m.authorId === me.id;
    if (!mine && !S().channelPerm(ch, me.id, "pinMessages"))
      fail("Você não tem permissão para fixar mensagens de outras pessoas.");
    if (!S().canSendIn(ch, me.id)) fail("Você não tem permissão neste canal.");
    m.pinned = pin !== false;
    log(ch.serverId, "message.pin", { channel: "#" + ch.name, pinned: m.pinned });
    NX.store.commit(["messages"]);
    return m;
  };

  api.reportMessage = async function (messageId, reason) {
    await delay();
    const me = S().me();
    const m = db().messages[messageId];
    if (!m) fail("Mensagem não encontrada.");
    const ch = S().channel(m.channelId);
    db().reports = db().reports || [];
    db().reports.push({
      id: u().uid("rp"),
      messageId: messageId,
      channelId: m.channelId,
      serverId: ch ? ch.serverId : null,
      reporterId: me.id,
      authorId: m.authorId,
      reason: String(reason || "").slice(0, 200),
      at: Date.now(),
      open: true,
    });
    if (db().reports.length > 200) db().reports.splice(0, db().reports.length - 200);
    NX.store.commit(["messages"]);
    return true;
  };

  /* =========================================================
     CONVITES
     ========================================================= */
  api.createInvite = async function (serverId, opts) {
    await delay();
    requirePerm(serverId, "createInvite", "Você não tem permissão para criar convites.");
    opts = opts || {};
    const me = S().me();
    const invite = {
      code: newInviteCode(),
      serverId: serverId,
      creatorId: me.id,
      createdAt: Date.now(),
      uses: 0,
      maxUses: Number(opts.maxUses) || 0,
      expiresAt: opts.expiresIn ? Date.now() + Number(opts.expiresIn) * 60000 : null,
    };
    db().invites[invite.code] = invite;
    log(serverId, "invite.create", { code: invite.code });
    NX.store.commit(["invites"]);
    return invite;
  };

  api.revokeInvite = async function (code) {
    await delay();
    const invite = S().invite(code);
    if (!invite) fail("Este convite não existe mais.");
    const me = S().me();
    if (invite.creatorId !== me.id)
      requirePerm(invite.serverId, "manageServer", "Você não pode revogar este convite.");
    delete db().invites[invite.code];
    log(invite.serverId, "invite.revoke", { code: invite.code });
    NX.store.commit(["invites"]);
    return true;
  };

  /* =========================================================
     CONVERSAS DIRETAS
     ========================================================= */
  api.openDM = async function (userId) {
    await delay();
    const me = S().me();
    const other = S().user(userId);
    if (!me || !other) fail("Usuário não encontrado.");
    if (userId === me.id) fail("Você não pode conversar consigo mesmo.");
    if (S().isBlocked(me.id, userId)) fail("Desbloqueie esta pessoa primeiro.");
    const id = S().dmId(me.id, userId);
    /* privacidade "quem pode enviar DM" do DONO da conversa */
    if (!db().dms[id] && !S().canDM(me.id, userId)) {
      const mode = ((other.privacy || {}).dm) || "all";
      fail(
        mode === "none"
          ? "Esta pessoa não recebe mensagens diretas."
          : "Esta pessoa só aceita mensagens de quem a segue."
      );
    }
    if (!db().dms[id]) {
      db().dms[id] = { id: id, participants: [me.id, userId], createdAt: Date.now(), muted: false };
      NX.store.commit(["messages", "profile"]);
    }
    return db().dms[id];
  };

  api.blockUser = async function (userId) {
    await delay();
    const me = S().me();
    const other = S().user(userId);
    if (!me || !other) fail("Usuário não encontrado.");
    if (userId === me.id) fail("Você não pode bloquear a si mesmo.");
    if (!me.blocks) me.blocks = [];
    if (me.blocks.indexOf(userId) === -1) me.blocks.push(userId);
    NX.store.commit(["profile", "members"]);
    return true;
  };

  api.unblockUser = async function (userId) {
    await delay();
    const me = S().me();
    if (!me) fail("Sua sessão expirou.");
    me.blocks = (me.blocks || []).filter((x) => x !== userId);
    NX.store.commit(["profile", "members"]);
    return true;
  };

  api.muteDM = async function (dmId, muted) {
    await delay();
    const dm = db().dms[dmId];
    if (!dm) fail("Conversa não encontrada.");
    dm.muted = muted !== false;
    NX.store.commit(["profile"]);
    return dm;
  };

  api.reportUser = async function (userId, reason) {
    await delay();
    const me = S().me();
    db().reports = db().reports || [];
    db().reports.push({
      id: u().uid("rp"),
      userId: userId,
      reporterId: me.id,
      reason: String(reason || "").slice(0, 200),
      at: Date.now(),
      open: true,
    });
    return true;
  };

  /* =========================================================
     EMOJIS PERSONALIZADOS DO SERVIDOR
     ========================================================= */
  api.createEmoji = async function (serverId, data) {
    await delay();
    requirePerm(serverId, "manageChannels", "Você não tem permissão para adicionar emojis.");
    const name = u().slug(String(data.name || "")).replace(/-/g, "");
    if (name.length < 2) fail("Dê um nome com pelo menos 2 caracteres ao emoji.");
    if (Object.values(db().emojis || {}).some((e) => e.serverId === serverId && e.name === name))
      fail("Já existe um emoji com esse nome.");
    const image = String(data.image || "");
    if (!/^data:image\//.test(image)) fail("Envie uma imagem válida.");
    if (image.length > 900000) fail("Esta imagem é grande demais (máximo 1 MB).");
    const id = u().uid("em");
    db().emojis = db().emojis || {};
    db().emojis[id] = {
      id: id,
      serverId: serverId,
      name: name,
      image: image,
      createdBy: S().me().id,
      createdAt: Date.now(),
    };
    log(serverId, "emoji.create", { name: ":" + name + ":" });
    NX.store.commit(["emojis"]);
    return db().emojis[id];
  };

  api.deleteEmoji = async function (emojiId) {
    await delay();
    const e = (db().emojis || {})[emojiId];
    if (!e) fail("Emoji não encontrado.");
    requirePerm(e.serverId, "manageChannels", "Você não tem permissão para remover emojis.");
    delete db().emojis[emojiId];
    log(e.serverId, "emoji.delete", { name: ":" + e.name + ":" });
    NX.store.commit(["emojis"]);
    return true;
  };

  /* =========================================================
     NOTIFICAÇÕES
     ========================================================= */
  api.markNotificationsRead = async function (ids) {
    await delay();
    const me = S().me();
    if (!me) return true;
    (db().notifications || []).forEach((n) => {
      if (n.userId !== me.id) return;
      if (!ids || ids === "all" || ids.indexOf(n.id) !== -1) n.read = true;
    });
    NX.store.commit(["notifications"]);
    return true;
  };

  api.clearNotifications = async function () {
    await delay();
    const me = S().me();
    if (!me) return true;
    db().notifications = (db().notifications || []).filter((n) => n.userId !== me.id);
    NX.store.commit(["notifications"]);
    return true;
  };

  /* =========================================================
     VOZ (estado de conexão — sem áudio no protótipo)
     ========================================================= */
  api.joinVoice = async function (channelId) {
    await delay();
    const me = S().me();
    const ch = S().channel(channelId);
    if (!ch || ch.type !== "voice") fail("Canal de voz não encontrado.");
    if (!S().can(ch.serverId, me.id, "joinVoice"))
      fail("Você não tem permissão para entrar em canais de voz.");
    db().voice = db().voice.filter((v) => v.userId !== me.id);
    db().voice.push({ channelId: channelId, userId: me.id, joinedAt: Date.now() });
    NX.store.commit(["voice", "channels"]);
    return true;
  };

  api.leaveVoice = async function () {
    await delay();
    const me = S().me();
    if (!me) return true;
    db().voice = db().voice.filter((v) => v.userId !== me.id);
    NX.store.commit(["voice"]);
    return true;
  };

  /* =========================================================
     REDE SOCIAL — seguidores, publicações, curtidas, comentários
     ---------------------------------------------------------
     Todas as regras ficam aqui (camada "backend"), nunca só no
     cliente. Quando houver servidor real, cada função vira um
     endpoint mantendo assinatura e escopos de retorno:

       • não é possível seguir a si mesmo;
       • follow e like usam id determinístico → impossível
         duplicar;
       • a privacidade do DONO manda (seguir, DM, seguidores,
         publicações);
       • contadores são cache: a fonte da verdade são as
         coleções follows/likes (recontadas em migrateSocial).

     Escopos usados: profile, posts, notifications.
     ========================================================= */

  const SOCIAL_SCOPES = ["profile", "posts", "notifications", "members"];
  const LIKE_KINDS = ["post", "comment", "message"];

  function requireMe() {
    const me = S().me();
    if (!me) fail("Sua sessão expirou. Entre novamente.");
    return me;
  }

  function requireUser(userId) {
    const usr = S().user(userId);
    if (!usr) fail("Este usuário não existe mais.");
    return usr;
  }

  function privacyOf(usr) {
    const p = (usr && usr.privacy) || {};
    return {
      follow: p.follow === "approved" ? "approved" : "all",
      dm: ["all", "followers", "none"].indexOf(p.dm) > -1 ? p.dm : "all",
      followers: ["all", "followers", "self"].indexOf(p.followers) > -1 ? p.followers : "all",
      posts: ["public", "followers", "self"].indexOf(p.posts) > -1 ? p.posts : "public",
    };
  }

  /* recalcula o cache de contadores de um usuário */
  function recount(userId) {
    const usr = S().user(userId);
    if (!usr) return;
    usr.followersCount = S().followerCount(userId);
    usr.followingCount = S().followingCount(userId);
    usr.likesReceived = S().likesReceivedOf(userId);
  }

  function hrefForPost(postId) {
    return "#/feed/" + postId;
  }

  function hrefForMessage(msg) {
    if (!msg) return "#/feed";
    if (String(msg.channelId).indexOf("dm_") === 0) return "#/mensagens/" + msg.channelId;
    const channel = S().channel(msg.channelId);
    if (channel) return "#/s/" + channel.serverId + "/" + channel.id;
    return "#/";
  }

  function socialNotify(ownerId, type, text, href) {
    if (!ownerId) return;
    const me = S().me();
    notify(ownerId, type, text, {
      href: href,
      actorId: me ? me.id : null,
    });
  }

  /* ---------------------------------------------------------
     SEGUIDORES
     --------------------------------------------------------- */
  api.followUser = async function (userId) {
    await delay();
    const me = requireMe();
    const target = requireUser(userId);
    if (target.id === me.id) fail("Você não pode seguir a si mesmo.");

    const existing = S().followEdge(me.id, target.id);
    if (existing && existing.state === "active") fail("Você já segue esta pessoa.");
    if (existing && existing.state === "pending")
      fail("A solicitação de seguimento já foi enviada.");

    const allowAll = privacyOf(target).follow !== "approved";
    const id = me.id + ">" + target.id;
    db().follows[id] = {
      id: id,
      followerId: me.id,
      followingId: target.id,
      state: allowAll ? "active" : "pending",
      createdAt: Date.now(),
    };

    if (!NX.store.persist()) {
      delete db().follows[id];
      fail("Não foi possível salvar neste navegador (armazenamento bloqueado).");
    }

    if (allowAll) {
      recount(target.id);
      socialNotify(target.id, "follow", "@" + me.username + " começou a seguir você.", "#/perfil/" + me.username);
      NX.store.commit(SOCIAL_SCOPES);
      return { state: "active", followers: target.followersCount };
    }

    socialNotify(
      target.id,
      "follow_request",
      "@" + me.username + " solicitou seguir você.",
      "#/perfil/" + me.username
    );
    NX.store.commit(SOCIAL_SCOPES);
    return { state: "pending", followers: target.followersCount };
  };

  api.unfollowUser = async function (userId) {
    await delay();
    const me = requireMe();
    const target = requireUser(userId);
    const id = me.id + ">" + target.id;
    const edge = db().follows[id];
    if (!edge) fail("Você não segue esta pessoa.");

    delete db().follows[id];
    NX.store.persist();
    recount(target.id);
    recount(me.id);
    NX.store.commit(SOCIAL_SCOPES);
    return { state: null, followers: target.followersCount };
  };

  /* quem é seguido aprova/recusa pedidos (privacidade "apenas autorizadas") */
  api.approveFollow = async function (followerId) {
    await delay();
    const me = requireMe();
    const edge = S().followEdge(followerId, me.id);
    if (!edge || edge.state !== "pending") fail("Não há solicitação de seguimento pendente.");
    edge.state = "active";
    edge.approvedAt = Date.now();
    NX.store.persist();
    recount(me.id);
    recount(followerId);
    socialNotify(
      followerId,
      "follow_request",
      "@" + me.username + " aceitou sua solicitação de seguimento.",
      "#/perfil/" + me.username
    );
    NX.store.commit(SOCIAL_SCOPES);
    return true;
  };

  api.rejectFollow = async function (followerId) {
    await delay();
    const me = requireMe();
    const id = followerId + ">" + me.id;
    if (!db().follows[id] || db().follows[id].state !== "pending")
      fail("Não há solicitação de seguimento pendente.");
    delete db().follows[id];
    NX.store.persist();
    recount(me.id);
    NX.store.commit(SOCIAL_SCOPES);
    return true;
  };

  /* quem pode seguir / estado do botão (a UI nunca decide sozinha) */
  api.followStatus = function (userId) {
    const me = S().me();
    const target = S().user(userId);
    if (!me || !target) return { can: false, state: null };
    if (target.id === me.id) return { can: false, state: "self" };
    const state = S().followState(me.id, target.id);
    if (state === "active") return { can: false, state: "following" };
    if (state === "pending") return { can: false, state: "pending" };
    if (privacyOf(target).follow === "approved") return { can: true, state: "request" };
    return { can: true, state: null };
  };

  /* ---------------------------------------------------------
     PUBLICAÇÕES
     --------------------------------------------------------- */
  function normalizeMedia(list) {
    const items = Array.isArray(list) ? list : list ? [list] : [];
    const out = [];
    let tooBig = false;
    items.slice(0, 4).forEach((m) => {
      const url = String((m && m.url) || m || "").trim();
      if (!url) return;
      const isData = /^data:image\//.test(url) || /^data:video\//.test(url);
      const isRemote = /^https?:\/\//i.test(url);
      if (!isData && !isRemote) return;
      if (url.length > 900000) {
        tooBig = true;
        return;
      }
      const isImage =
        /^data:image\//.test(url) || /\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(url);
      out.push({ kind: isImage ? "image" : "video", url: url });
    });
    return { list: out, tooBig: tooBig };
  }

  api.createPost = async function (data) {
    await delay();
    const me = requireMe();
    data = data || {};
    const content = String(data.content || "").trim();
    const media = normalizeMedia(data.media);
    if (media.tooBig) fail("Este arquivo é grande demais (máximo 900 KB).");
    if (!content && !media.list.length) fail("Escreva alguma coisa ou anexe uma imagem/vídeo.");
    if (content.length > 2000) fail("A publicação pode ter no máximo 2.000 caracteres.");

    const id = u().uid("po");
    db().posts[id] = {
      id: id,
      authorId: me.id,
      content: content,
      media: media.list,
      createdAt: Date.now(),
      likesCount: 0,
      commentsCount: 0,
    };
    if (!NX.store.persist()) {
      delete db().posts[id];
      fail("Não foi possível salvar neste navegador (armazenamento bloqueado).");
    }
    NX.store.commit(SOCIAL_SCOPES);
    return db().posts[id];
  };

  api.deletePost = async function (postId) {
    await delay();
    const me = requireMe();
    const post = S().post(postId);
    if (!post) fail("Esta publicação não existe mais.");
    if (post.authorId !== me.id) fail("Você só pode excluir as suas publicações.");

    delete db().posts[postId];
    Object.values(db().comments || {})
      .filter((c) => c.postId === postId)
      .forEach((c) => delete db().comments[c.id]);
    Object.values(db().likes || {})
      .filter((l) => l.targetType === "post" && l.targetId === postId)
      .forEach((l) => delete db().likes[l.id]);
    NX.store.persist();
    recount(post.authorId);
    NX.store.commit(SOCIAL_SCOPES);
    return true;
  };

  /* ---------------------------------------------------------
     CURTIDAS — uma por pessoa por conteúdo, sem duplicatas
     --------------------------------------------------------- */
  function likeTarget(type, id) {
    if (type === "post") return S().post(id);
    if (type === "comment") return S().comment(id);
    if (type === "message") return db().messages[id] || null;
    return null;
  }

  function likeOwner(target) {
    if (!target) return null;
    return S().user(target.authorId || target.userId) || null;
  }

  function likeHref(type, id) {
    if (type === "post") return hrefForPost(id);
    if (type === "comment") {
      const c = S().comment(id);
      return c ? hrefForPost(c.postId) : "#/feed";
    }
    return hrefForMessage(likeTarget("message", id));
  }

  api.likeContent = async function (targetType, targetId) {
    await delay();
    const me = requireMe();
    if (LIKE_KINDS.indexOf(targetType) === -1) fail("Conteúdo inválido.");
    const target = likeTarget(targetType, targetId);
    if (!target) fail("Este conteúdo não existe mais.");

    const likeId = [targetType, targetId, me.id].join(":");
    if (db().likes[likeId]) fail("Você já curtiu este conteúdo."); /* anti-duplicidade */

    db().likes[likeId] = {
      id: likeId,
      userId: me.id,
      targetType: targetType,
      targetId: targetId,
      createdAt: Date.now(),
    };
    if (!NX.store.persist()) {
      delete db().likes[likeId];
      fail("Não foi possível salvar neste navegador (armazenamento bloqueado).");
    }

    if (targetType !== "message") target.likesCount = S().likeCount(targetType, targetId);

    const owner = likeOwner(target);
    const ownerId = owner ? owner.id : null;
    if (ownerId) recount(ownerId);
    if (ownerId && ownerId !== me.id) {
      const what =
        targetType === "post" ? "publicação" : targetType === "comment" ? "comentário" : "mensagem";
      socialNotify(ownerId, "like", "@" + me.username + " curtiu seu " + what + ".", likeHref(targetType, targetId));
    }

    NX.store.commit(SOCIAL_SCOPES);
    return { liked: true, count: S().likeCount(targetType, targetId) };
  };

  api.unlikeContent = async function (targetType, targetId) {
    await delay();
    const me = requireMe();
    if (LIKE_KINDS.indexOf(targetType) === -1) fail("Conteúdo inválido.");
    const likeId = [targetType, targetId, me.id].join(":");
    if (!db().likes[likeId]) return { liked: false, count: S().likeCount(targetType, targetId) };

    delete db().likes[likeId];
    NX.store.persist();

    const target = likeTarget(targetType, targetId);
    if (target && targetType !== "message") target.likesCount = S().likeCount(targetType, targetId);
    const owner = likeOwner(target);
    if (owner) recount(owner.id);

    NX.store.commit(SOCIAL_SCOPES);
    return { liked: false, count: target ? S().likeCount(targetType, targetId) : 0 };
  };

  /* ---------------------------------------------------------
     COMENTÁRIOS
     --------------------------------------------------------- */
  api.addComment = async function (postId, content, parentId) {
    await delay();
    const me = requireMe();
    const post = S().post(postId);
    if (!post) fail("Esta publicação não existe mais.");
    if (!S().canViewPostsOf(me.id, post.authorId)) fail("Você não pode comentar esta publicação.");

    const text = String(content || "").trim();
    if (!text) fail("Escreva um comentário.");
    if (text.length > 500) fail("O comentário pode ter no máximo 500 caracteres.");

    let parent = null;
    if (parentId) {
      parent = S().comment(parentId);
      if (!parent || parent.postId !== postId) fail("Comentário de resposta não encontrado.");
    }

    const id = u().uid("cm");
    db().comments[id] = {
      id: id,
      postId: postId,
      parentId: parent ? parent.id : null,
      authorId: me.id,
      content: text,
      createdAt: Date.now(),
      likesCount: 0,
    };
    if (!NX.store.persist()) {
      delete db().comments[id];
      fail("Não foi possível salvar neste navegador (armazenamento bloqueado).");
    }

    post.commentsCount = S().commentsOf(postId).length;
    const href = hrefForPost(postId);

    if (parent && parent.authorId !== me.id) {
      socialNotify(parent.authorId, "reply", "@" + me.username + " respondeu seu comentário.", href);
    } else if (post.authorId !== me.id) {
      socialNotify(post.authorId, "comment", "@" + me.username + " comentou sua publicação.", href);
    }

    NX.store.commit(SOCIAL_SCOPES);
    return db().comments[id];
  };

  api.deleteComment = async function (commentId) {
    await delay();
    const me = requireMe();
    const c = S().comment(commentId);
    if (!c) fail("Este comentário não existe mais.");
    if (c.authorId !== me.id) fail("Você só pode excluir os seus comentários.");

    delete db().comments[commentId];
    Object.values(db().likes || {})
      .filter((l) => l.targetType === "comment" && l.targetId === commentId)
      .forEach((l) => delete db().likes[l.id]);
    NX.store.persist();

    const post = S().post(c.postId);
    if (post) post.commentsCount = S().commentsOf(c.postId).length;
    recount(c.authorId);
    NX.store.commit(SOCIAL_SCOPES);
    return true;
  };

  /* ---------------------------------------------------------
     PRIVACIDADE (as regras valem também sem interface)
     --------------------------------------------------------- */
  api.updateSocialPrivacy = async function (patch) {
    await delay();
    const me = requireMe();
    const VALID = {
      follow: ["all", "approved"],
      dm: ["all", "followers", "none"],
      followers: ["all", "followers", "self"],
      posts: ["public", "followers", "self"],
    };
    const current = privacyOf(me);
    Object.keys(VALID).forEach((k) => {
      if (patch && patch[k] !== undefined) {
        if (VALID[k].indexOf(patch[k]) === -1) fail("Opção de privacidade inválida.");
        current[k] = patch[k];
      }
    });
    me.privacy = current;
    NX.store.persist();
    NX.store.commit(["profile"]);
    return me.privacy;
  };

  /* lista de seguidores/seguidores respeitando a privacidade */
  api.listFollow = async function (userId, kind) {
    await delay();
    const me = S().me();
    const owner = requireUser(userId);
    if (kind === "requests") {
      if (!me || me.id !== owner.id) fail("Só você pode ver quem pediu para seguir você.");
      return S().followRequestsOf(owner.id).map((x) => x.user);
    }
    if (!S().canViewFollowersOf(me ? me.id : null, owner.id))
      fail("Esta pessoa mantém sua lista de seguidores privada.");
    return kind === "following" ? S().followingOf(owner.id) : S().followersOf(owner.id);
  };

  NX.api = api;
})(window.NX);
