/* ============================================================
   NEXO — js/remote.js
   Camada remota do frontend (fase 1): liga o NX.api ao backend
   (Netlify Functions + Supabase) SEM mudar nenhuma assinatura.

   O que esta camada faz:
     1) sonda GET /api/health no boot e define NX.remote.online;
     2) valida a sessão de verdade em GET /api/auth/me — a prova
        é o cookie HttpOnly nx_session, nunca um ID no localStorage;
     3) baixa GET /api/sync e aplica o payload no NX.store.db;
     4) envolve as funções do NX.api que têm rota equivalente e
        aplica o patch {set, del, list} de cada resposta no cache;
     5) mantém o cache coerente: polling de sync + heartbeat de
        presença, pulando quando a tela está ocupada.

   O que esta camada NÃO faz:
     - enquanto online, NÃO grava dados da conta no localStorage
       (store.persist é neutralizado aqui: o servidor é a fonte);
     - não usa localStorage como autenticação;
     - não mexe nas funções sem rota do backend (voz, feed, emojis,
       região, relatórios): elas continuam locais sobre o cache
       sincronizado até a fase 2 ganhar endpoints.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const S = () => NX.selectors;
  const db = () => NX.store.db;

  const BASE = "/api";
  const DB_KEY = "nexo.db.v3";
  const POLL_MS = 15000;
  const HEARTBEAT_MS = 60000;
  const PROBE_TIMEOUT = 7000;
  const REQUEST_TIMEOUT = 25000;

  /* coleções que vivem no SERVIDOR — nunca no localStorage */
  const SERVER_COLS = [
    "users", "servers", "roles", "memberships", "categories", "channels",
    "messages", "invites", "dms", "presence", "bans", "logs",
    "notifications", "friendRequests", "friendships",
    "apps", "serverApps", "calls",
  ];
  /* no cache local estas coleções são listas, não mapas */
  const ARRAY_COLS = { notifications: 1, logs: 1 };

  const SYNC_SCOPES = [
    "session", "servers", "members", "roles", "categories", "channels",
    "messages", "invites", "presence", "profile", "notifications", "route",
    "apps",
  ];
  const SOCIAL_SCOPES = ["profile", "members", "notifications"];
  const STRUCT_SCOPES = [
    "servers", "members", "roles", "categories", "channels", "messages",
    "invites", "route", "apps",
  ];

  const remote = {
    online: false,
    pending: true,
    started: false,
    driver: null,
    lastSyncAt: 0,
    pollFailures: 0,
    error: null,
    base: BASE,
  };
  NX.remote = remote;

  /* =========================================================
     0 · localStorage travado enquanto online
     ---------------------------------------------------------
     Regra: com o backend no ar, o banco da conta é o Supabase.
     Qualquer gravação da chave nexo.db.v3 é ignorada — assim o
     cache local nunca reentra na memória nem volta a ser fonte
     de verdade. Preferências de interface (nexo.ui.v1)
     continuam normais.                                    */
  const origStorageSet = NX.storage.set;
  NX.storage.set = function (key, value) {
    if (key === DB_KEY && (remote.pending || remote.online)) return false;
    return origStorageSet.apply(this, arguments);
  };

  const origPersist = NX.store.persist;
  NX.store.persist = function () {
    if (remote.online) {
      this.persistOk = true;
      this.persistError = null;
      return true;
    }
    return origPersist.apply(this, arguments);
  };

  const origLoad = NX.store.load;
  NX.store.load = function () {
    if (remote.online) return; /* online: o servidor é a fonte */
    return origLoad.apply(this, arguments);
  };

  /* =========================================================
     1 · transporte
     ========================================================= */
  function qs(params) {
    if (!params) return "";
    const parts = [];
    Object.keys(params).forEach((k) => {
      const v = params[k];
      if (v === undefined || v === null || v === "") return;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  function enc(v) {
    return encodeURIComponent(String(v == null ? "" : v));
  }

  function apiError(message, status, code) {
    const e = NX.fail(
      message ||
        "Não foi possível conectar ao servidor. Tente novamente."
    );
    e.status = status || 0;
    e.code = code || null;
    return e;
  }

  function withTimeout(ms) {
    if (typeof AbortController === "undefined") return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return {
      signal: ctrl.signal,
      done: () => clearTimeout(timer),
    };
  }

  function toast(message, kind) {
    try {
      if (NX.ui && typeof NX.ui.toast === "function")
        NX.ui.toast(message, kind || "warn", 6000);
    } catch (e) {
      /* sem interface pronta: segue */
    }
  }

  function commit(scopes) {
    try {
      NX.store.commit(scopes || []);
    } catch (e) {
      console.warn("[nexo/remote] commit:", e && e.message);
    }
  }

  /* sessão expirada no servidor: o espelho local sai e, se alguém
     estava logado nesta aba, a tela volta para o login. */
  function handleUnauthorized() {
    const me = S().me ? S().me() : null;
    try {
      NX.session.clear();
    } catch (e) {}
    if (!remote.started) return;
    if (!me) return;
    wipeAccount();
    commit(SYNC_SCOPES);
    toast("Sua sessão expirou. Entre novamente.", "warn");
  }

  /* uma chamada HTTP: devolve o JSON { ok, data, patch } e aplica
     o patch no cache. Nunca devolve segredo nenhum. */
  async function http(method, path, body, opts) {
    opts = opts || {};
    const to = withTimeout(opts.timeout || REQUEST_TIMEOUT);
    let res;
    try {
      res = await fetch(BASE + path + (opts.query ? qs(opts.query) : ""), {
        method: method,
        credentials: "same-origin",
        cache: "no-store",
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: to ? to.signal : undefined,
      });
    } catch (err) {
      throw apiError(
        "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.",
        0,
        "network"
      );
    } finally {
      if (to) to.done();
    }

    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      json = null;
    }

    if (!json || json.ok !== true) {
      const status = res.status;
      const code = (json && json.code) || null;
      if (status === 401 || code === "session" || code === "unauthorized")
        handleUnauthorized();
      throw apiError(
        (json && json.error) ||
          "Não foi possível conectar ao servidor. Tente novamente.",
        status,
        code
      );
    }

    if (json.patch) applyPatch(json.patch);
    return json;
  }

  const GET = (path, query) =>
    http("GET", path, null, { query: query || null }).then((j) => j.data);
  const POST = (path, body) =>
    http("POST", path, body || {}).then((j) => j.data);
  const PATCHQ = (path, body) =>
    http("PATCH", path, body || {}).then((j) => j.data);
  const DEL = (path) => http("DELETE", path).then((j) => j.data);

  /* =========================================================
     2 · patch e sync → NX.store.db
     ========================================================= */
  function setRows(col, bucket) {
    if (!bucket) return;
    const target = db();
    if (ARRAY_COLS[col]) {
      if (!Array.isArray(target[col])) target[col] = [];
      Object.keys(bucket).forEach((k) => {
        const row = bucket[k];
        if (!row) return;
        /* higiene: notificação de outra conta nunca entra no cache */
        if (col === "notifications" && row.userId) {
          const me = S() && S().me ? S().me() : null;
          if (me && row.userId !== me.id) return;
        }
        let idx = -1;
        for (let i = 0; i < target[col].length; i++) {
          if (target[col][i] && target[col][i].id === k) {
            idx = i;
            break;
          }
        }
        if (idx > -1) target[col][idx] = row;
        else target[col].unshift(row);
      });
      return;
    }
    if (!target[col] || typeof target[col] !== "object" || Array.isArray(target[col]))
      target[col] = {};
    Object.keys(bucket).forEach((k) => {
      if (bucket[k] !== undefined && bucket[k] !== null) target[col][k] = bucket[k];
    });
  }

  function delRows(col, keys) {
    if (!keys || !keys.length) return;
    const target = db();
    if (Array.isArray(target[col])) {
      target[col] = target[col].filter((r) => !(r && keys.indexOf(r.id) > -1));
      return;
    }
    if (!target[col] || typeof target[col] !== "object") return;
    keys.forEach((k) => {
      delete target[col][k];
    });
  }

  function listRows(col, rows) {
    const target = db();
    if (ARRAY_COLS[col] || Array.isArray(target[col])) {
      target[col] = Array.isArray(rows) ? rows : [];
      return;
    }
    const out = {};
    (rows || []).forEach((r) => {
      if (r && r.id !== undefined) out[r.id] = r;
    });
    target[col] = out;
  }

  function applyPatch(patch) {
    if (!patch) return;
    if (patch.set)
      Object.keys(patch.set).forEach((col) => setRows(col, patch.set[col]));
    if (patch.del)
      Object.keys(patch.del).forEach((col) => delRows(col, patch.del[col]));
    if (patch.list)
      Object.keys(patch.list).forEach((col) => listRows(col, patch.list[col]));
  }

  function mirrorSession(userId) {
    if (!userId) return;
    try {
      /* sessionStorage: o espelho serve só para a interface saber
         quem está logado. A prova de sessão é sempre o cookie. */
      NX.session.set(userId, false);
    } catch (e) {}
  }

  function applySync(data, reset) {
    if (!data) return;
    const target = db();

    /* collapsed é preferência de vista (sem coluna no banco) */
    const collapsed = {};
    Object.keys(target.categories || {}).forEach((id) => {
      if (target.categories[id] && target.categories[id].collapsed)
        collapsed[id] = true;
    });

    [
      "servers", "roles", "memberships", "categories", "channels",
      "invites", "bans", "friendRequests", "friendships", "dms", "messages",
      "apps", "serverApps",
    ].forEach((col) => {
      const v = data[col];
      target[col] = v && typeof v === "object" && !Array.isArray(v) ? v : {};
    });
    ["notifications", "logs"].forEach((col) => {
      target[col] = Array.isArray(data[col]) ? data[col] : [];
    });
    Object.keys(collapsed).forEach((id) => {
      if (target.categories[id]) target.categories[id].collapsed = true;
    });

    /* usuários: no primeiro sync (boot ou troca de conta) a lista
       inteira é trocada; depois apenas soma — é o que faz a busca
       de pessoas abrir o perfil pelo ID. */
    if (reset || !target.users || typeof target.users !== "object")
      target.users = {};
    const users = data.users || {};
    Object.keys(users).forEach((id) => {
      if (users[id]) target.users[id] = users[id];
    });

    if (reset || !target.presence || typeof target.presence !== "object")
      target.presence = {};
    const presence = data.presence || {};
    Object.keys(presence).forEach((id) => {
      target.presence[id] = presence[id];
    });

    if (data.me) {
      target.users[data.me.id] = data.me;
      target.presence[data.me.id] =
        data.me.status || target.presence[data.me.id] || "online";
      mirrorSession(data.me.id);
    }
  }

  /* zera tudo o que pertence a contas (usado no logout e sem sessão) */
  function wipeAccount() {
    const target = db();
    [
      "users", "servers", "roles", "memberships", "categories", "channels",
      "messages", "invites", "dms", "presence", "bans", "friendRequests",
      "friendships", "friendInvites", "follows", "posts", "likes",
      "comments", "reports", "emojis", "voiceInvites",
      "apps", "serverApps", "calls",
    ].forEach((col) => {
      target[col] = {};
    });
    ["logs", "notifications", "voice"].forEach((col) => {
      target[col] = [];
    });
  }

  function adoptUser(user) {
    if (!user) return;
    const target = db();
    if (!target.users || typeof target.users !== "object") target.users = {};
    target.users[user.id] = Object.assign({}, target.users[user.id] || {}, user);
    if (!target.presence || typeof target.presence !== "object")
      target.presence = {};
    target.presence[user.id] = user.status || "online";
    mirrorSession(user.id);
    /* sem troca de idioma: o Nexo é somente pt-BR */
  }

  /* =========================================================
     3 · sync (com mutex: um sync por vez, o 2º entra na fila)
     ========================================================= */
  let syncing = false;
  let queued = null;
  let lastSig = "";

  async function doSync(reset) {
    syncing = true;
    try {
      const data = await GET("/sync");
      if (!data) return null;
      const sig = JSON.stringify(data);
      const changed = sig !== lastSig;
      lastSig = sig;
      applySync(data, !!reset);
      remote.lastSyncAt = Date.now();
      remote.pollFailures = 0;
      remote.error = null;
      if (changed || reset) commit(SYNC_SCOPES);
      return data;
    } finally {
      syncing = false;
    }
  }

  function syncNow(reset) {
    if (!remote.online) return Promise.resolve(null);
    if (syncing) {
      if (!queued)
        queued = doSync(!!reset).then(
          (d) => {
            queued = null;
            return d;
          },
          (e) => {
            queued = null;
            throw e;
          }
        );
      return queued;
    }
    return doSync(!!reset);
  }

  remote.sync = () => syncNow(false);

  /* =========================================================
     4 · polling, presença e disponibilidade
     ========================================================= */
  function busy() {
    /* só o que um commit DESTRUIRIA fica em espera: a tela de
       configurações é reconstruída por inteiro e a edição inline de
       mensagem some com o repaint. Modais e campos com texto não
       entram aqui — o cache continua atualizando em segundo plano. */
    if (NX.app && NX.app.screen === "settings") return true;
    if (NX.views && NX.views.editingMessageId) return true;
    return false;
  }

  function tickPoll() {
    if (!remote.online) return;
    if (document.hidden) return;
    if (busy()) return; /* espera o próximo tique: nada de resetar a tela */
    if (!(S() && S().me && S().me())) return;
    syncNow(false).catch((e) => {
      remote.pollFailures++;
      if (remote.pollFailures === 3)
        toast(
          "Sem conexão com o servidor. Tentando reconectar…",
          "warn"
        );
      console.warn("[nexo/remote] sync:", e && e.message);
    });
  }

  async function beat(status) {
    if (!remote.online) return;
    const me = S() && S().me ? S().me() : null;
    const next = status || (me ? me.status : null) || "online";
    if (!me && !status) return;
    try {
      await http("POST", "/presence", { status: next });
    } catch (e) {
      /* presença é best-effort: erro de rede não derruba a tela */
    }
  }

  function onVisible() {
    if (!remote.online || document.hidden) return;
    if (busy()) return;
    if (!(S() && S().me && S().me())) return;
    syncNow(false).catch(() => {});
    beat();
  }

  function onPageHide() {
    if (!remote.online) return;
    const me = S() && S().me ? S().me() : null;
    if (!me) return;
    try {
      /* keepalive: a requisição sobrevive ao fechamento da aba */
      fetch(BASE + "/presence", {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "offline" }),
      });
    } catch (e) {}
  }

  let pollTimer = null;
  let beatTimer = null;

  function startTimers() {
    if (pollTimer) return;
    pollTimer = setInterval(tickPoll, POLL_MS);
    beatTimer = setInterval(() => beat(), HEARTBEAT_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onPageHide);
  }

  /* =========================================================
     5 · boot
     ========================================================= */
  remote.start = async function () {
    if (remote.started) return remote.online;
    remote.started = true;

    let health = null;
    try {
      const json = await http("GET", "/health", null, {
        timeout: PROBE_TIMEOUT,
      });
      health = json && json.data;
    } catch (e) {
      health = null;
    }

    if (!health || health.ok === false) {
      remote.pending = false;
      remote.online = false;
      remote.error = (health && health.error) || "backend indisponível";
      console.warn(
        "[nexo/remote] backend indisponível — funcionando em modo local.",
        remote.error
      );
      return false;
    }

    remote.pending = false;
    remote.online = true;
    remote.driver = health.driver || null;

    let me = null;
    try {
      const json = await http("GET", "/auth/me", null, {
        timeout: PROBE_TIMEOUT,
      });
      me = (json && json.data && json.data.user) || null;
    } catch (e) {
      me = null; /* 401 = sem sessão (handleUnauthorized já limpou) */
    }

    if (me) {
      /* sync primeiro: os dados da conta já estão no cache
         quando o adoteUser grava o usuário no lugar. */
      try {
        await syncNow(true);
      } catch (e) {
        console.warn("[nexo/remote] sync inicial:", e && e.message);
      }
      adoptUser(me);
    } else {
      clearSession();
      wipeAccount();
    }

    startTimers();
    /* o bootUI roda logo em seguida e pode mudar o status para
       online; este anúncio leva essa visão para o servidor. */
    if (me) setTimeout(() => beat(), 1500);
    return true;
  };

  function clearSession() {
    try {
      NX.session.clear();
    } catch (e) {}
  }

  /* =========================================================
     6 · wrapper: mesma assinatura, corpo remoto
     ========================================================= */
  let wrapped = 0;
  let total = 0;

  function wrap(name, impl, scopes) {
    const api = NX.api;
    const orig = api[name];
    if (typeof orig !== "function") {
      console.warn("[nexo/remote] NX.api." + name + " não existe.");
      return;
    }
    total++;
    api[name] = function () {
      const args = arguments;
      if (!remote.online) return orig.apply(api, args);
      wrapped++;
      return Promise.resolve()
        .then(() => impl.apply(api, args))
        .then((out) => {
          if (scopes && scopes.length) commit(scopes);
          return out;
        });
    };
  }

  /* -------------------------- autenticação -------------------------- */
  wrap(
    "signup",
    async function (data) {
      data = data || {};
      const json = await http("POST", "/auth/signup", {
        username: data.username,
        password: data.password,
        confirm: data.confirm,
        emoji: data.emoji,
        color: data.color,
        birth: data.birth,
      });
      const user = json.data && json.data.user;
      try {
        await syncNow(true);
      } catch (e) {
        console.warn("[nexo/remote] sync pós-cadastro:", e && e.message);
      }
      adoptUser(user);
      return {
        user: user,
        message:
          (json.data && json.data.message) ||
          "Sua conta foi criada com sucesso.",
      };
    },
    ["session", "servers", "profile", "presence", "notifications"]
  );

  wrap(
    "login",
    async function (data) {
      data = data || {};
      const user = await POST("/auth/login", {
        identifier: data.identifier,
        password: data.password,
        status: data.status,
        remember: !!data.remember,
      });
      try {
        await syncNow(true);
      } catch (e) {
        console.warn("[nexo/remote] sync pós-login:", e && e.message);
      }
      adoptUser(user);
      return user;
    },
    ["session", "servers", "profile", "presence", "notifications"]
  );

  wrap(
    "logout",
    async function () {
      try {
        await POST("/auth/logout", {});
      } catch (e) {
        /* mesmo com a rede fora a sessão local precisa sair */
      }
      clearSession();
      wipeAccount();
      try {
        if (NX.i18n) {
          NX.i18n.reset();
          NX.i18n.apply();
        }
      } catch (e) {}
    },
    ["session", "presence", "voice", "servers", "profile", "notifications"]
  );

  wrap(
    "changePassword",
    (data) =>
      POST("/auth/password", {
        current: (data || {}).current,
        password: (data || {}).password,
        confirm: (data || {}).confirm,
      }),
    ["session", "notifications"]
  );

  wrap(
    "updateProfile",
    async function (patch) {
      const user = await PATCHQ("/profile", patch || {});
      adoptUser(user);
      return user;
    },
    ["profile", "presence"]
  );

  wrap(
    "setStatus",
    async function (status) {
      const user = await POST("/presence", { status: status });
      adoptUser(user);
    },
    ["presence", "profile"]
  );

  wrap(
    "markNotificationsRead",
    async function (ids) {
      const list =
        !ids || ids === "all" || !Array.isArray(ids) ? null : ids;
      await POST("/notifications/read", { ids: list });
      return true;
    },
    ["notifications"]
  );

  wrap("clearNotifications", () => POST("/notifications/clear", {}), [
    "notifications",
  ]);

  /* busca de pessoas: resultado entra no cache para o perfil abrir */
  wrap("searchPeople", async function (query, limit) {
    const raw = String(query || "").trim();
    if (!raw) return [];
    const list = await GET("/users/search", { q: raw, limit: limit });
    const target = db();
    if (!target.users || typeof target.users !== "object") target.users = {};
    if (!target.presence || typeof target.presence !== "object")
      target.presence = {};
    (list || []).forEach((u) => {
      if (!u || !u.id) return;
      target.users[u.id] = u;
      target.presence[u.id] = u.status || "offline";
    });
    return list || [];
  });

  /* -------------------------- amizade -------------------------- */
  wrap(
    "sendFriendRequest",
    (userIdOrName) => POST("/friends/request", { userId: userIdOrName }),
    SOCIAL_SCOPES
  );
  wrap(
    "acceptFriendRequest",
    (requestId) => POST("/friends/accept", { requestId: requestId }),
    SOCIAL_SCOPES
  );
  wrap(
    "rejectFriendRequest",
    (requestId) => POST("/friends/reject", { requestId: requestId }),
    SOCIAL_SCOPES
  );
  wrap(
    "cancelFriendRequest",
    (requestId) => POST("/friends/cancel", { requestId: requestId }),
    SOCIAL_SCOPES
  );
  wrap("removeFriend", (userId) => POST("/friends/remove", { userId }), SOCIAL_SCOPES);

  /* -------------------------- bloqueio -------------------------- */
  wrap("blockUser", (userId) => POST("/blocks", { userId }), [
    "profile",
    "members",
  ]);
  wrap("unblockUser", (userId) => POST("/blocks/remove", { userId }), [
    "profile",
    "members",
  ]);

  /* -------------------------- conversas -------------------------- */
  wrap("openDM", (userId) => POST("/dms", { userId }), ["messages", "profile"]);
  wrap("muteDM", (dmId, muted) =>
    POST("/dms/" + enc(dmId) + "/mute", { muted: muted !== false }), [
    "profile",
  ]);

  /* marcador de leitura: síncrono para a rota, escrita em segundo
     plano no servidor (a resposta só atualiza o cursor). */
  const origMarkDMRead = NX.api.markDMRead;
  NX.api.markDMRead = function (dmId) {
    if (!remote.online) return origMarkDMRead.apply(NX.api, arguments);
    const me = S() && S().me ? S().me() : null;
    if (!me || !dmId) return false;
    const dm = db().dms[dmId];
    if (!dm || !dm.participants || dm.participants.indexOf(me.id) === -1)
      return false;
    if (!S().dmUnreadFor(dm, me.id)) return false;
    dm.reads = dm.reads || {};
    dm.reads[me.id] = Date.now();
    http("POST", "/dms/" + enc(dmId) + "/read", {}).catch(() => {});
    commit(["messages"]);
    return true;
  };

  /* -------------------------- mensagens -------------------------- */
  wrap(
    "sendMessage",
    function (ref, content, opts) {
      opts = opts || {};
      const body = {
        content: content,
        attachments: opts.attachments || [],
      };
      const isDM = String(ref).indexOf("dm_") === 0;
      const path = isDM
        ? "/dms/" + enc(ref) + "/messages"
        : "/channels/" + enc(ref) + "/messages";
      return http("POST", path, body).then((j) => j.data);
    },
    ["messages", "notifications"]
  );

  wrap("editMessage", (messageId, content) =>
    PATCHQ("/messages/" + enc(messageId), { content: content }), ["messages"]);
  wrap("deleteMessage", (messageId) =>
    DEL("/messages/" + enc(messageId)), ["messages", "notifications"]);
  wrap("toggleReaction", (messageId, emoji) =>
    POST("/messages/" + enc(messageId) + "/reactions", { emoji: emoji }), [
    "messages",
  ]);
  wrap("pinMessage", (messageId, pin) =>
    POST("/messages/" + enc(messageId) + "/pin", { pinned: pin !== false }), [
    "messages",
  ]);

  /* -------------------------- servidores -------------------------- */
  function setLastChannel(serverId, firstChannelId) {
    if (!serverId || !firstChannelId) return;
    NX.store.ui.lastChannel[serverId] = firstChannelId;
    try {
      NX.store.commitUI();
    } catch (e) {}
  }

  wrap(
    "createServer",
    async function (data) {
      const json = await http("POST", "/servers", {
        name: (data || {}).name,
        description: (data || {}).description,
        emoji: (data || {}).emoji,
        color: (data || {}).color,
        templateId: (data || {}).templateId,
      });
      const server = json.data;
      const meta = json.meta || {};
      setLastChannel(server && server.id, meta.firstChannelId);
      return server;
    },
    STRUCT_SCOPES
  );

  wrap("updateServer", (serverId, patch) =>
    PATCHQ("/servers/" + enc(serverId), patch || {}), ["servers"]);

  wrap(
    "deleteServer",
    async function (serverId) {
      const ok = await DEL("/servers/" + enc(serverId));
      delete NX.store.ui.lastChannel[serverId];
      try {
        NX.store.commitUI();
      } catch (e) {}
      return ok;
    },
    STRUCT_SCOPES
  );

  wrap("leaveServer", (serverId) =>
    POST("/servers/" + enc(serverId) + "/leave", {}), STRUCT_SCOPES);

  wrap(
    "joinServer",
    async function (serverId, invite) {
      const json = await http("POST", "/servers/" + enc(serverId) + "/join", {
        invite: invite || null,
      });
      setLastChannel(serverId, json.meta && json.meta.firstChannelId);
      return json.data;
    },
    STRUCT_SCOPES
  );

  wrap(
    "joinByInvite",
    async function (code) {
      const clean = String(code || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      const json = await http(
        "POST",
        "/invites/" + enc(clean) + "/join",
        {}
      );
      const server = json.data;
      setLastChannel(server && server.id, json.meta && json.meta.firstChannelId);
      return server;
    },
    STRUCT_SCOPES
  );

  /* -------------------------- convites -------------------------- */
  wrap(
    "createInvite",
    (serverId, opts) =>
      POST("/servers/" + enc(serverId) + "/invites", {
        maxUses: (opts || {}).maxUses,
        expiresIn: (opts || {}).expiresIn,
      }),
    ["invites"]
  );

  wrap("revokeInvite", (code) => DEL("/invites/" + enc(code)), ["invites"]);

  /* convite direto para amiga(o): o código passa a existir no
     servidor; o registro local de "já convidei" fica no cache. */
  wrap(
    "inviteFriendToServer",
    async function (serverId, friendId) {
      const me = S().me();
      const server = S().server(serverId);
      if (!server)
        throw NX.fail(
          NX.i18n.get(
            "api.esteServidorNaoExiste2",
            "Este servidor não existe mais."
          )
        );
      const target = S().user(friendId);
      if (!target)
        throw NX.fail(
          NX.i18n.get("api.usuarioNaoEncontrado2", "Usuário não encontrado.")
        );
      if (!S().isFriend(me.id, target.id))
        throw NX.fail(
          NX.i18n.get("api.estaPessoaNaoSua", "Esta pessoa não é sua amiga.")
        );

      const mapKey = serverId + ":" + friendId;
      const existing = (db().friendInvites || {})[mapKey];
      if (existing)
        throw NX.fail(
          NX.i18n.get(
            "api.voceJaEnviouConvite2",
            "Você já enviou um convite para esta pessoa."
          )
        );

      const invite = await POST("/servers/" + enc(serverId) + "/invites", {});
      const inv = {
        id: "finv_" + serverId + "_" + friendId,
        serverId: serverId,
        friendId: friendId,
        byId: me.id,
        code: invite.code,
        createdAt: invite.createdAt || Date.now(),
      };
      db().friendInvites = db().friendInvites || {};
      db().friendInvites[mapKey] = inv;
      db().invites = db().invites || {};
      db().invites[invite.code] = invite;
      return inv;
    },
    ["invites", "notifications"]
  );

  /* -------------------------- cargos -------------------------- */
  wrap(
    "createRole",
    (serverId, data) =>
      POST("/servers/" + enc(serverId) + "/roles", {
        name: (data || {}).name,
        color: (data || {}).color,
        position: (data || {}).position,
        permissions: (data || {}).permissions,
      }),
    ["roles", "members"]
  );
  wrap("updateRole", (roleId, patch) => PATCHQ("/roles/" + enc(roleId), patch || {}), [
    "roles",
    "members",
  ]);
  wrap("deleteRole", (roleId) => DEL("/roles/" + enc(roleId)), [
    "roles",
    "members",
  ]);

  /* -------------------------- membros -------------------------- */
  wrap(
    "setMemberRole",
    async function (serverId, userId, roleId) {
      const me = S().me();
      if (me && userId === me.id)
        throw NX.fail(
          NX.i18n.get(
            "api.voceNaoPodeAlterar",
            "Você não pode alterar o próprio cargo por aqui."
          )
        );
      return PATCHQ(
        "/servers/" + enc(serverId) + "/members/" + enc(userId),
        { roleId: roleId || null }
      );
    },
    ["members", "notifications"]
  );

  wrap(
    "updateMemberPerms",
    (serverId, userId, patch) =>
      PATCHQ("/servers/" + enc(serverId) + "/members/" + enc(userId), {
        permissions: patch || {},
      }),
    ["members"]
  );

  wrap(
    "setNickname",
    (serverId, userId, nickname) =>
      PATCHQ("/servers/" + enc(serverId) + "/members/" + enc(userId), {
        nickname: nickname,
      }),
    ["members"]
  );

  wrap("kickMember", (serverId, userId) =>
    DEL("/servers/" + enc(serverId) + "/members/" + enc(userId)), [
    "members",
    "voice",
    "notifications",
  ]);

  wrap(
    "banMember",
    (serverId, userId, reason) =>
      POST("/servers/" + enc(serverId) + "/bans", {
        userId: userId,
        reason: reason,
      }),
    ["members", "voice", "notifications"]
  );

  wrap(
    "unbanMember",
    async function (banId) {
      const ban = (db().bans || {})[banId];
      let serverId = ban ? ban.serverId : null;
      let userId = ban ? ban.userId : null;
      if (!serverId || !userId) {
        const raw = String(banId || "");
        const i = raw.indexOf(":");
        if (i > 0) {
          serverId = raw.slice(0, i);
          userId = raw.slice(i + 1);
        }
      }
      if (!serverId || !userId)
        throw NX.fail(
          NX.i18n.get(
            "api.esteBanimentoNaoExiste",
            "Este banimento não existe mais."
          )
        );
      return DEL(
        "/servers/" + enc(serverId) + "/bans/" + enc(userId)
      );
    },
    ["members", "notifications"]
  );

  wrap(
    "transferOwnership",
    (serverId, userId) =>
      POST("/servers/" + enc(serverId) + "/transfer", { userId: userId }),
    ["servers", "members", "notifications"]
  );

  /* -------------------------- categorias -------------------------- */
  wrap(
    "createCategory",
    (serverId, data) =>
      POST("/servers/" + enc(serverId) + "/categories", {
        name: (data || {}).name,
        firstChannel: (data || {}).firstChannel,
      }),
    ["categories", "channels"]
  );
  wrap("renameCategory", (categoryId, name) =>
    PATCHQ("/categories/" + enc(categoryId), { name: name }), ["categories"]);
  wrap("deleteCategory", (categoryId) =>
    DEL("/categories/" + enc(categoryId)), ["categories", "channels", "messages"]);

  /* -------------------------- canais -------------------------- */
  wrap(
    "createChannel",
    (serverId, data) =>
      POST("/servers/" + enc(serverId) + "/channels", {
        name: (data || {}).name,
        type: (data || {}).type,
        categoryId: (data || {}).categoryId,
        topic: (data || {}).topic,
        view: (data || {}).view,
        send: (data || {}).send,
        inheritPerms: (data || {}).inheritPerms,
      }),
    ["channels", "categories", "route"]
  );
  wrap("updateChannel", (channelId, patch) =>
    PATCHQ("/channels/" + enc(channelId), patch || {}), ["channels", "route"]);
  wrap("deleteChannel", (channelId) =>
    DEL("/channels/" + enc(channelId)), ["channels", "messages", "route"]);

  wrap(
    "setChannelPerm",
    (channelId, targetKey, permKey, state) =>
      POST("/channels/" + enc(channelId) + "/perms", {
        targetKey: targetKey,
        permKey: permKey,
        state: state,
      }),
    ["channels"]
  );
  wrap(
    "setCategoryPerm",
    (categoryId, targetKey, permKey, state) =>
      POST("/categories/" + enc(categoryId) + "/perms", {
        targetKey: targetKey,
        permKey: permKey,
        state: state,
      }),
    ["categories"]
  );
  wrap("setChannelInheritance", (channelId, inherit) =>
    PATCHQ("/channels/" + enc(channelId) + "/inherit", {
      inherit: !!inherit,
    }), ["channels"]);

  /* =========================================================
     7 · tela de convite: busca no servidor quando não está no cache
     ========================================================= */
  const previewing = {};
  if (NX.pages && typeof NX.pages.renderInvite === "function") {
    const origInvite = NX.pages.renderInvite;
    NX.pages.renderInvite = function (code) {
      origInvite.call(NX.pages, code);
      if (!remote.online || !code) return;
      const clean = String(code).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!clean || S().invite(clean) || previewing[clean]) return;
      previewing[clean] = true;
      GET("/invites/" + enc(clean))
        .then((data) => {
          delete previewing[clean];
          if (!data) return;
          const target = db();
          target.invites = target.invites || {};
          target.servers = target.servers || {};
          target.users = target.users || {};
          target.presence = target.presence || {};
          if (data.invite) target.invites[data.invite.code] = data.invite;
          if (data.server) {
            target.servers[data.server.id] = data.server;
            if (typeof data.memberCount === "number")
              target.servers[data.server.id].memberCount = data.memberCount;
          }
          if (data.owner) {
            target.users[data.owner.id] = data.owner;
            target.presence[data.owner.id] = data.owner.status || "offline";
          }
          commit(["invites", "servers"]);
        })
        .catch(() => {
          delete previewing[clean];
        });
    };
  }

  /* =========================================================
     7.5 · apps/bots (Bot Center) e chamadas (sinalização)
     ========================================================= */
  wrap("listApps", () => GET("/apps"), ["apps"]);
  wrap("getApp", (appId) => GET("/apps/" + enc(appId)), ["apps"]);
  wrap("listServerApps", (serverId) => GET("/servers/" + enc(serverId) + "/apps"), ["apps"]);
  wrap(
    "installApp",
    (serverId, data) => POST("/servers/" + enc(serverId) + "/apps", data || {}),
    ["apps"]
  );
  wrap(
    "updateServerApp",
    (serverId, installId, patch) =>
      PATCHQ("/servers/" + enc(serverId) + "/apps/" + enc(installId), patch || {}),
    ["apps"]
  );
  wrap(
    "removeServerApp",
    (serverId, installId) => DEL("/servers/" + enc(serverId) + "/apps/" + enc(installId)),
    ["apps"]
  );

  /* chamadas: o estado vem sempre do servidor (peek); áudio/vídeo
     nunca passa por aqui — só a sinalização WebRTC */
  wrap(
    "startCall",
    async function (peerId) {
      const call = await POST("/calls", { peerId: peerId });
      const target = db();
      target.calls = target.calls || {};
      if (call && call.id) target.calls[call.id] = call;
      return call;
    },
    ["calls"]
  );
  wrap(
    "respondCall",
    async function (callId, accept) {
      const call = await POST("/calls/" + enc(callId) + "/respond", { accept: accept !== false });
      const target = db();
      target.calls = target.calls || {};
      if (call && call.id) target.calls[call.id] = call;
      return call;
    },
    ["calls"]
  );
  wrap(
    "endCall",
    async function (callId, reason) {
      const call = await POST("/calls/" + enc(callId) + "/end", { reason: reason || "hangup" });
      const target = db();
      target.calls = target.calls || {};
      if (call && call.id) target.calls[call.id] = call;
      return call;
    },
    ["calls"]
  );
  wrap("sendSignal", (callId, kind, payload) =>
    POST("/calls/" + enc(callId) + "/signal", { kind: kind, payload: payload })
  );
  wrap(
    "peekCalls",
    async function () {
      const data = (await GET("/calls/peek")) || {};
      const target = db();
      target.calls = data.calls && typeof data.calls === "object" ? data.calls : {};
      return data;
    },
    ["calls"]
  );

  /* =========================================================
     8 · status para diagnóstico (nunca expõe credencial)
     ========================================================= */
  remote.status = function () {
    const me = S() && S().me ? S().me() : null;
    return {
      online: remote.online,
      pending: remote.pending,
      driver: remote.driver,
      session: !!me,
      userId: me ? me.id : null,
      lastSyncAt: remote.lastSyncAt,
      pollFailures: remote.pollFailures,
      wrapped: wrapped,
      wrappedTotal: total,
      apiFunctions: Object.keys(NX.api || {}).length,
    };
  };
})(window.NX);
