/* ============================================================
   NEXO · store
   Estado da aplicação, persistência, pub/sub e seletores.
   É a única fonte de verdade lida pelas views.
   (Trocar por um cliente HTTP/WebSocket posteriormente = refatorar api.js)
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const DB_KEY = "nexo.db.v3";
  const UI_KEY = "nexo.ui.v1";

  const emptyDB = () => ({
    version: 1,
    createdAt: Date.now(),
    users: {},
    servers: {},
    roles: {},
    memberships: {},
    categories: {},
    channels: {},
    messages: {},
    invites: {},
    dms: {},
    voice: [],
    presence: {},
    /* ampliação — sistemas novos */
    bans: {},
    logs: [],
    emojis: {},
    notifications: [],
    reports: [],
    prefs: {},
    /* autenticação (camada backend): tentativas, códigos e caixa de saída */
    /* autenticação: limite de tentativas de login */
    auth: { attempts: {} },
    /* rede social — fonte de verdade dos contadores do perfil */
    follows: {},   /* "<de>><para>" → {id, followerId, followingId, state, createdAt} */
    posts: {},     /* id → {id, authorId, content, media[], createdAt, likesCount, commentsCount} */
    likes: {},     /* id → {id, userId, targetType, targetId, createdAt} */
    comments: {},  /* id → {id, postId, parentId, authorId, content, createdAt, likesCount} */
    /* amizades — GLOBAL (independem do servidor) */
    friendRequests: {}, /* id → {id, senderId, receiverId, status:"pending"|"accepted"|"rejected", createdAt} */
    friendships: {},    /* "<menor>:<maior>" → {id, userAId, userBId, createdAt} */
    friendInvites: {},  /* "<server>:<user>" → {id, serverId, friendId, byId, code, createdAt} */
  });

  const store = {
    db: emptyDB(),
    ui: { lastChannel: {}, collapsed: {}, sidebarOpen: false, membersOpen: true },
    listeners: [],
    ready: false,
  };

  /* ---------------- persistência ----------------
     A causa clássica de "não encontro minha conta" é o banco antigo
     ser descartado em silêncio: aqui procuramos chaves antigas,
     migramos a que tiver mais dados e só zeramos se não houver nada. */
  const LEGACY_KEYS = ["nexo.db.v3", "nexo.db.v2", "nexo.db.v1", "nexo.db"];

  /* funde um banco lido de uma chave ANTIGA no banco atual.
     Regra de ouro: NUNCA descartar conta — as coleções são unidas
     por id e o que já está no banco atual (chave principal) ganha. */
  function mergeInto(target, src) {
    if (!src || typeof src !== "object") return target;
    Object.keys(src).forEach((k) => {
      const sv = src[k];
      if (sv === undefined || sv === null) return;

      if (Array.isArray(sv)) {
        const cur = Array.isArray(target[k]) ? target[k] : [];
        const have = {};
        cur.forEach((it, i) => {
          have[it && it.id !== undefined ? "id:" + it.id : "raw:" + i + ":" + JSON.stringify(it)] = true;
        });
        sv.forEach((it, i) => {
          const key = it && it.id !== undefined ? "id:" + it.id : "raw:" + i + ":" + JSON.stringify(it);
          if (have[key]) return;
          have[key] = true;
          cur.push(it);
        });
        target[k] = cur;
      } else if (typeof sv === "object") {
        /* objeto (users, servers, posts…) — o atual já gravado vence */
        target[k] = Object.assign({}, sv, target[k]);
      } else if (target[k] === undefined) {
        target[k] = sv;
      }
    });
    return target;
  }

  store.load = function () {
    /* 1 · lê TODAS as chaves conhecidas e funde — assim nenhuma conta
           criada numa chave antiga (ou na principal) se perde. */
    const merged = emptyDB();
    let found = false;
    let hasLegacy = false;

    LEGACY_KEYS.forEach((key) => {
      const raw = NX.storage.get(key, null);
      if (!raw || typeof raw !== "object" || !raw.users) return;
      found = true;
      if (key !== DB_KEY) hasLegacy = true;
      mergeInto(merged, raw);
    });

    if (found) {
      this.db = merged;
      this.db.version = 1;
      this.db.auth = this.db.auth || { attempts: {} };
      this.db.auth.attempts = this.db.auth.attempts || {};
      this.migratedFrom = hasLegacy ? "chaves antigas fundidas" : null;
      this.loadedUsers = Object.keys(this.db.users || {}).length;
      if (hasLegacy) {
        /* grava a fusão e só apaga as chaves antigas DEPOIS de salva */
        const saved = NX.storage.set(DB_KEY, this.db);
        if (saved) LEGACY_KEYS.filter((k) => k !== DB_KEY).forEach((k) => NX.storage.remove(k));
      }
    } else {
      this.db = emptyDB();
      this.migratedFrom = null;
      this.loadedUsers = 0;
    }

    const ui = NX.storage.get(UI_KEY, null);
    if (ui) this.ui = Object.assign(this.ui, ui);

    this.migrateSocial();
    /* PRODUÇÃO (DEMO_MODE=false): apaga dados de demonstração de
       versões antigas do protótipo — contas/servidores REAIS ficam. */
    try {
      this.purgeDemo();
    } catch (err) {
      console.warn("[store] purgeDemo:", err);
    }
    this.ready = true;
    this.watchStorage();
  };

  /* outra aba gravou o banco → recarrega antes de escrever por cima
     (evita que uma aba velha apague a conta criada em outra aba). */
  let watchingStorage = false;
  store.watchStorage = function () {
    if (watchingStorage || typeof window === "undefined" || !window.addEventListener) return;
    watchingStorage = true;
    window.addEventListener("storage", (e) => {
      if (!e || e.key !== DB_KEY) return;
      try {
        store.load();
        store.commit(["all"], { persist: false });
      } catch (err) {
        console.warn("[store] falha ao sincronizar abas:", err);
      }
    });
  };

  /* ---- migração da rede social ----
     1. cria coleções que não existiam;
     2. garante padrões de privacidade em toda conta;
     3. RECALCULA os contadores a partir das coleções
        (os números do perfil nunca são a fonte da verdade). */
  store.migrateSocial = function () {
    const db = this.db;
    db.follows = db.follows || {};
    db.posts = db.posts || {};
    db.likes = db.likes || {};
    db.comments = db.comments || {};
    db.notifications = db.notifications || [];
    /* amizades — coleções novas em bancos antigos */
    db.friendRequests = db.friendRequests || {};
    db.friendships = db.friendships || {};
    db.friendInvites = db.friendInvites || {};

    /* resquícios do sistema antigo de e-mail/códigos: removidos */
    if (db.auth) {
      delete db.auth.codes;
      delete db.auth.pending;
      delete db.auth.recovery;
    }
    if (db.outbox) delete db.outbox;

    const PRIV = {
      follow: ["all", "approved"],
      dm: ["all", "friends", "followers", "none"],
      followers: ["all", "followers", "self"],
      likes: ["all", "followers", "self"],
      posts: ["public", "followers", "self"],
      friendRequests: ["all", "common", "none"],
    };

    Object.values(db.users || {}).forEach((usr) => {
      const p = usr.privacy || {};
      usr.privacy = {
        follow: PRIV.follow.indexOf(p.follow) > -1 ? p.follow : "all",
        dm: PRIV.dm.indexOf(p.dm) > -1 ? p.dm : "all",
        followers: PRIV.followers.indexOf(p.followers) > -1 ? p.followers : "all",
        likes: PRIV.likes.indexOf(p.likes) > -1 ? p.likes : "all",
        posts: PRIV.posts.indexOf(p.posts) > -1 ? p.posts : "public",
        friendRequests:
          PRIV.friendRequests.indexOf(p.friendRequests) > -1 ? p.friendRequests : "all",
      };
      if (!Array.isArray(usr.blocks)) usr.blocks = [];
      usr.followersCount = 0;
      usr.followingCount = 0;
      usr.likesReceived = 0;
      usr.friendsCount = 0;
    });

    /* amizades válidas só entre contas que continuam existindo
       (uma amizade nunca existe duas vezes nem consigo mesmo) */
    const cleanFriendships = {};
    Object.values(db.friendships || {}).forEach((fr) => {
      if (!fr || !fr.userAId || !fr.userBId) return;
      if (fr.userAId === fr.userBId) return;
      if (!db.users[fr.userAId] || !db.users[fr.userBId]) return;
      const id = [fr.userAId, fr.userBId].sort().join(":");
      if (cleanFriendships[id]) return; /* anti-duplicidade */
      cleanFriendships[id] = {
        id: id, userAId: fr.userAId, userBId: fr.userBId,
        createdAt: fr.createdAt || Date.now(),
      };
    });
    db.friendships = cleanFriendships;
    Object.values(db.friendships).forEach((fr) => {
      const a = db.users[fr.userAId];
      const b = db.users[fr.userBId];
      if (a) a.friendsCount = (a.friendsCount || 0) + 1;
      if (b) b.friendsCount = (b.friendsCount || 0) + 1;
    });

    /* contadores recalculados (fonte de verdade = coleções) */
    Object.values(db.follows).forEach((f) => {
      if (f.state !== "active") return;
      const target = db.users[f.followingId];
      const from = db.users[f.followerId];
      if (target) target.followersCount = (target.followersCount || 0) + 1;
      if (from) from.followingCount = (from.followingCount || 0) + 1;
    });

    /* curtidas nas PUBLICAÇÕES de cada autor (fonte do "❤️ Curtidas" do perfil) */
    Object.values(db.likes).forEach((l) => {
      if (l.targetType !== "post") return;
      const post = db.posts[l.targetId];
      if (post && db.users[post.authorId]) {
        const u = db.users[post.authorId];
        u.likesReceived = (u.likesReceived || 0) + 1;
      }
    });
  };

  /* =========================================================
     PRODUÇÃO · limpeza dos dados fictícios (seed)
     Com DEMO_MODE=false o seed nem roda; se ainda existirem contas,
     servidores ou mensagens de demonstração de versões antigas,
     eles são apagados aqui.
     REGRAS DE OURO:
       · conta e servidor REAIS nunca são apagados;
       · usuário fictício = marca demo:true (o seed marca todas) e,
         em bancos antigos, a lista de nomes que só o seed cria —
         usada apenas quando o banco tem o bloco completo (>=5),
         para nunca confundir uma conta real com um NPC;
       · é idempotente: roda a cada carga e não faz nada se não
         houver nada fictício.
     ========================================================= */
  const SEED_NAMES = ["demo","luna","kai","maya","bruno","teo","ana","sofia","rafa","gus"];

  store.purgeDemo = function () {
    if (NX.demoMode()) return false;
    const db = this.db;
    if (!db || !db.users) return false;

    const norm = (s) => String(s || "").trim().toLowerCase();
    const users = Object.values(db.users);
    const seedIds = {};
    users.forEach((usr) => {
      if (!usr) return;
      if (usr.demo === true) seedIds[usr.id] = true;
    });
    /* bancos antigos: só os nomes do seed, e só com o bloco completo */
    const anchor = users.some((usr) => usr && (usr.demo === true || norm(usr.username) === "demo"));
    if (anchor) {
      const named = users.filter((usr) => usr && SEED_NAMES.indexOf(norm(usr.username)) > -1);
      if (named.length >= 5) named.forEach((usr) => (seedIds[usr.id] = true));
    }
    const seedCount = Object.keys(seedIds).length;
    if (!seedCount) return false;

    const isSeed = (id) => !!id && seedIds[id] === true;
    const hasSeedRef = (rec) => {
      if (!rec) return false;
      if (rec.demo) return true;
      return Object.keys(rec).some((k) => typeof rec[k] === "string" && seedIds[rec[k]] === true);
    };
    const delWhere = (col, fn) => {
      if (!col) return;
      Object.keys(col).forEach((id) => {
        if (fn(col[id], id)) delete col[id];
      });
    };
    const delArray = (arr, fn) => {
      if (!Array.isArray(arr)) return;
      for (let i = arr.length - 1; i >= 0; i--) if (fn(arr[i], i)) arr.splice(i, 1);
    };

    /* 1 · servidores fictícios (o seed cria todos com dono fictício) */
    const seedServers = {};
    Object.values(db.servers || {}).forEach((s) => {
      if (s && isSeed(s.ownerId)) seedServers[s.id] = true;
    });
    const goneChannels = {};
    const goneDms = {};
    Object.keys(seedServers).forEach((id) => delete db.servers[id]);

    /* 2 · estrutura e registros ligados a esses servidores */
    delWhere(db.roles, (r) => r && seedServers[r.serverId]);
    delWhere(db.categories, (c) => c && seedServers[c.serverId]);
    delWhere(db.channels, (c) => {
      if (!c) return false;
      const gone = !!seedServers[c.serverId];
      if (gone) goneChannels[c.id] = true;
      return gone;
    });
    delWhere(db.memberships, (m) => (m && seedServers[m.serverId]) || isSeed(m && m.userId));
    delWhere(db.bans, (b) => b && (seedServers[b.serverId] || isSeed(b.userId) || isSeed(b.byId)));
    delWhere(db.invites, (i) => i && (seedServers[i.serverId] || isSeed(i.creatorId)));
    delWhere(db.emojis, (e) => e && (seedServers[e.serverId] || isSeed(e.createdBy)));
    delArray(db.logs, (l) => l && (seedServers[l.serverId] || isSeed(l.actorId) || (l.meta && isSeed(l.meta.userId))));
    delArray(db.voice, (v) => v && (seedServers[v.serverId] || isSeed(v.userId)));

    /* 3 · conversas diretas e mensagens fictícias */
    delWhere(db.dms, (d) => {
      if (!d) return false;
      const gone = hasSeedRef(d);
      if (gone) goneDms[d.id] = true;
      return gone;
    });
    delWhere(db.messages, (m) => m && (isSeed(m.authorId) || goneChannels[m.channelId] || goneDms[m.channelId]));
    /* reações de mensagens reais não podem citar contas fictícias */
    Object.values(db.messages || {}).forEach((m) => {
      if (!m || !m.reactions) return;
      Object.keys(m.reactions).forEach((emo) => {
        const arr = (m.reactions[emo] || []).filter((id) => !isSeed(id));
        if (arr.length) m.reactions[emo] = arr;
        else delete m.reactions[emo];
      });
    });

    /* 4 · as contas fictícias em si */
    Object.keys(seedIds).forEach((id) => {
      delete db.users[id];
      delete db.presence[id];
      if (db.prefs) delete db.prefs[id];
    });

    /* 5 · rede social, amizades, notificações e moderação */
    delWhere(db.follows, (f) => hasSeedRef(f));
    delWhere(db.friendRequests, (r) => hasSeedRef(r));
    delWhere(db.friendships, (f) => hasSeedRef(f));
    delWhere(db.friendInvites, (f) => hasSeedRef(f));
    delWhere(db.posts, (p) => p && (isSeed(p.authorId) || p.demo === true));
    delWhere(db.comments, (c) => c && (isSeed(c.authorId) || c.demo === true || (c.postId && !db.posts[c.postId])));
    delWhere(db.likes, (l) => {
      if (!l) return false;
      if (isSeed(l.userId) || l.demo === true) return true;
      if (l.targetType === "post") return !db.posts[l.targetId];
      if (l.targetType === "comment") return !db.comments[l.targetId];
      return false;
    });
    delWhere(db.reports, (r) => hasSeedRef(r));
    delArray(db.notifications, (n) => n && (isSeed(n.userId) || (n.meta && isSeed(n.meta.actorId)) || n.demo === true));

    /* 6 · contadores derivados + amizades que apontavam para contas
           apagadas (migrateSocial refaz a limpeza e os números) */
    Object.values(db.posts || {}).forEach((p) => {
      p.likesCount = Object.values(db.likes || {}).filter(
        (l) => l.targetType === "post" && l.targetId === p.id
      ).length;
      p.commentsCount = Object.values(db.comments || {}).filter((c) => c.postId === p.id).length;
    });
    Object.values(db.comments || {}).forEach((c) => {
      c.likesCount = Object.values(db.likes || {}).filter(
        (l) => l.targetType === "comment" && l.targetId === c.id
      ).length;
    });
    this.migrateSocial();
    this.persist();
    console.info(
      "[store] DEMO_MODE=false: removidos " + seedCount + " conta(s) fictícia(s) e todos os dados dela(s)."
    );
    return true;
  };

  /* grava e informa se realmente deu certo */
  store.persist = function () {
    const ok = NX.storage.set(DB_KEY, this.db);
    this.persistOk = ok;
    this.persistError = ok ? null : NX.storage.lastError || "indisponível";
    return ok;
  };

  store.persistUI = function () {
    return NX.storage.set(UI_KEY, this.ui);
  };

  /* aviso exibido no app quando nada pode ser salvo */
  store.storageWarning = function () {
    if (NX.storage.persistent && this.persistOk !== false) return null;
    return (
      "Este navegador não está permitindo salvar dados do Nexo. " +
      "Libere o armazenamento do site (ou desative o bloqueio) para que sua conta e seus servidores não sejam perdidos."
    );
  };

  store.resetAll = function () {
    NX.storage.remove(DB_KEY);
    NX.storage.remove(UI_KEY);
    NX.session.clear();
    this.db = emptyDB();
    this.ui = { lastChannel: {}, collapsed: {}, sidebarOpen: false, membersOpen: true };
    this.persist();
    this.persistUI();
  };

  /* ---------------- assinaturas ---------------- */
  store.subscribe = function (fn) {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i > -1) this.listeners.splice(i, 1);
    };
  };

  /* scopes: session, route, servers, roles, members, categories, channels,
             messages, invites, voice, presence, profile, ui */
  store.commit = function (scopes, opts) {
    const list = Array.isArray(scopes) ? scopes : [scopes || "all"];
    if (!opts || opts.persist !== false) this.persist();
    const payload = { scopes: list };
    this.listeners.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error("[store]", e);
      }
    });
    NX.bus.emit("db:change", payload);
  };

  store.commitUI = function () {
    this.persistUI();
    this.listeners.forEach((fn) => fn({ scopes: ["ui"], ui: true }));
  };

  /* ---------------- seletores ---------------- */
  const S = {};

  S.me = () => {
    const s = NX.session.get();
    return s && store.db.users[s.userId] ? store.db.users[s.userId] : null;
  };

  S.user = (id) => store.db.users[id] || null;
  S.userByUsername = (name) => {
    const raw = String(name || "").trim().toLowerCase().replace(/^@/, "");
    if (!raw) return null;
    return (
      Object.values(store.db.users || {}).find(
        (u) => String(u.username || "").toLowerCase() === raw
      ) || null
    );
  };
  S.server = (id) => store.db.servers[id] || null;
  S.role = (id) => store.db.roles[id] || null;
  S.category = (id) => store.db.categories[id] || null;
  S.channel = (id) => store.db.channels[id] || null;

  S.membershipsOf = (userId) =>
    Object.values(store.db.memberships).filter((m) => m.userId === userId);

  S.serversOf = (userId) =>
    S.membershipsOf(userId)
      .map((m) => store.db.servers[m.serverId])
      .filter(Boolean)
      .sort((a, b) => {
        const ma = S.membership(a.id, userId);
        const mb = S.membership(b.id, userId);
        return (ma ? ma.joinedAt : 0) - (mb ? mb.joinedAt : 0);
      });

  S.membership = (serverId, userId) =>
    Object.values(store.db.memberships).find(
      (m) => m.serverId === serverId && m.userId === userId
    ) || null;

  S.rolesOf = (serverId) =>
    Object.values(store.db.roles)
      .filter((r) => r.serverId === serverId)
      .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || a.position - b.position);

  S.defaultRole = (serverId) =>
    Object.values(store.db.roles).find((r) => r.serverId === serverId && r.isDefault) || null;

  S.membersOf = (serverId) =>
    Object.values(store.db.memberships)
      .filter((m) => m.serverId === serverId)
      .map((m) => ({
        membership: m,
        user: store.db.users[m.userId],
        role: store.db.roles[m.roleId] || S.defaultRole(serverId),
      }))
      .filter((x) => x.user)
      .sort((a, b) => {
        const ra = a.role ? a.role.position : 99;
        const rb = b.role ? b.role.position : 99;
        if (ra !== rb) return rb - ra;
        const pa = a.user.status === "online" ? 0 : 1;
        const pb = b.user.status === "online" ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return (a.user.displayName || "").localeCompare(b.user.displayName || "");
      });

  S.onlineCount = (serverId) =>
    S.membersOf(serverId).filter((m) => m.user.status && m.user.status !== "offline").length;

  /* membros que podem ser exibidos como pessoas na interface:
     só quem realmente pertence ao servidor e, em produção
     (DEMO_MODE=false), nenhuma conta de demonstração. */
  S.visibleMembersOf = (serverId) =>
    S.membersOf(serverId).filter((m) => S.isRealPerson(m.user.id));

  S.categoriesOf = (serverId) =>
    Object.values(store.db.categories)
      .filter((c) => c.serverId === serverId)
      .sort((a, b) => a.order - b.order);

  S.channelsOf = (serverId) =>
    Object.values(store.db.channels)
      .filter((c) => c.serverId === serverId)
      .sort((a, b) => a.order - b.order);

  S.channelsOfCategory = (categoryId) =>
    Object.values(store.db.channels)
      .filter((c) => c.categoryId === categoryId)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "text" ? -1 : 1;
        return a.order - b.order;
      });

  S.messagesOf = (ref) =>
    Object.values(store.db.messages)
      .filter((m) => m.channelId === ref)
      .sort((a, b) => a.createdAt - b.createdAt);

  S.invite = (code) => (code ? store.db.invites[String(code).toUpperCase()] || null : null);

  S.invitesOf = (serverId) =>
    Object.values(store.db.invites)
      .filter((i) => i.serverId === serverId)
      .sort((a, b) => b.createdAt - a.createdAt);

  S.dmId = (a, b) => "dm_" + [a, b].sort().join("_");

  S.dmWith = (userId) => {
    const me = S.me();
    if (!me) return null;
    return store.db.dms[S.dmId(me.id, userId)] || null;
  };

  S.dmsOf = (userId) =>
    Object.values(store.db.dms)
      .filter((d) => d.participants.indexOf(userId) !== -1)
      .map((d) => {
        const otherId = d.participants.find((p) => p !== userId) || d.participants[0];
        const msgs = S.messagesOf(d.id);
        const last = msgs[msgs.length - 1] || null;
        return { dm: d, other: store.db.users[otherId], last: last };
      })
      .filter((x) => x.other)
      .sort((a, b) => {
        const ta = a.last ? a.last.createdAt : a.dm.createdAt;
        const tb = b.last ? b.last.createdAt : b.dm.createdAt;
        return tb - ta;
      });

  S.dmUnreadCount = () => 0;

  S.voiceOf = (channelId) =>
    store.db.voice.filter((v) => v.channelId === channelId);

  S.voiceChannelOfUser = (userId) => {
    const v = store.db.voice.find((x) => x.userId === userId);
    return v ? store.db.channels[v.channelId] : null;
  };

  S.discoverableServers = () =>
    Object.values(store.db.servers)
      .filter((s) => s.discoverable)
      .sort((a, b) => S.memberCount(b.id) - S.memberCount(a.id));

  S.memberCount = (serverId) =>
    Object.values(store.db.memberships).filter((m) => m.serverId === serverId).length;

  /* ---------------- permissões ---------------- */
  function applyPerms(target, source) {
    if (!source) return;
    NX.PERM_KEYS.forEach((k) => {
      if (source[k] === true) target[k] = true;
      else if (source[k] === false && target[k] !== undefined) target[k] = false;
    });
  }

  S.effectivePerms = (serverId, userId) => {
    const out = {};
    NX.PERM_KEYS.forEach((k) => (out[k] = false));
    const server = S.server(serverId);
    const membership = S.membership(serverId, userId);
    if (!server || !membership) return out;

    if (server.ownerId === userId) {
      NX.PERM_KEYS.forEach((k) => (out[k] = true));
      return out;
    }

    applyPerms(out, S.defaultRole(serverId) && S.defaultRole(serverId).permissions);
    const role = store.db.roles[membership.roleId];
    if (role && !role.isDefault) applyPerms(out, role.permissions);
    applyPerms(out, membership.permissions);

    if (out.administrator) NX.PERM_KEYS.forEach((k) => (out[k] = true));
    return out;
  };

  S.can = (serverId, userId, perm) => {
    if (!perm) return true;
    const p = S.effectivePerms(serverId, userId);
    return !!p[perm];
  };

  /* ---- overrides por canal/categoria (Permitir / Negar / Herdar) ----
     container.perms = { "everyone": {chave: true|false},
                          "role:<id>": {...}, "user:<id>": {...} }
     Ausência da chave = herdar (continua o valor do nível anterior). */

  function applyOverride(container, key, userId, serverId, current) {
    if (!container) return current;
    const mem = S.membership(serverId, userId);
    const userVal = container["user:" + userId];
    if (userVal && userVal[key] !== undefined && userVal[key] !== null)
      return userVal[key] === true;
    let decided = null;
    if (container["everyone"] && container["everyone"][key] !== undefined && container["everyone"][key] !== null)
      decided = container["everyone"][key] === true;
    const roleIds = [];
    if (mem && mem.roleId) roleIds.push(mem.roleId);
    (mem && mem.extraRoleIds ? mem.extraRoleIds : []).forEach((rid) => roleIds.push(rid));
    roleIds.filter(Boolean).forEach((rid) => {
      const box = container["role:" + rid];
      if (box && box[key] !== undefined && box[key] !== null) {
        if (box[key] === false) decided = false; /* negar vence */
        else if (decided === null) decided = true;
      }
    });
    return decided === null ? current : decided;
  }

  /* permissões efetivas considerando categoria (herança) e canal */
  S.effectiveChannelPerms = (channel, userId) => {
    const out = S.effectivePerms(channel.serverId, userId);
    const cat = channel.categoryId ? store.db.categories[channel.categoryId] : null;
    if (cat && channel.inheritPerms !== false) {
      NX.PERM_KEYS.forEach((k) => {
        out[k] = applyOverride(cat.perms, k, userId, channel.serverId, out[k]);
      });
    }
    NX.PERM_KEYS.forEach((k) => {
      out[k] = applyOverride(channel.perms, k, userId, channel.serverId, out[k]);
    });
    return out;
  };

  S.channelPerm = (channel, userId, key) => {
    if (!channel) return false;
    const p = S.effectiveChannelPerms(channel, userId);
    return !!p[key];
  };

  S.isOwner = (serverId, userId) => {
    const s = S.server(serverId);
    return !!s && s.ownerId === userId;
  };

  S.canViewChannel = (channel, userId) => {
    if (!channel) return false;
    const serverId = channel.serverId;
    if (!S.membership(serverId, userId)) return false;
    if (!S.channelPerm(channel, userId, "viewChannels")) return false;
    const ov = channel.overrides || {};
    if (ov.view === "private") {
      return (
        channel.createdBy === userId ||
        S.isOwner(serverId, userId) ||
        S.can(serverId, userId, "manageChannels")
      );
    }
    return true;
  };

  S.canSendIn = (channel, userId) => {
    if (!channel) return false;
    if (!S.canViewChannel(channel, userId)) return false;
    const ov = channel.overrides || {};
    if (ov.send === "none") return false;
    if (ov.send === "private") {
      return (
        channel.createdBy === userId ||
        S.isOwner(channel.serverId, userId) ||
        S.can(channel.serverId, userId, "manageChannels")
      );
    }
    return S.channelPerm(channel, userId, "sendMessages");
  };

  /* pode moderar mensagens de outros autores neste canal */
  S.canModerateMessages = (channel, userId) => {
    if (!channel) return false;
    const p = S.effectiveChannelPerms(channel, userId);
    return !!(p.deleteMessages || p.pinMessages || p.editMessages);
  };

  /* ---- banimentos ---- */
  S.banOf = (serverId, userId) =>
    Object.values(store.db.bans || {}).find(
      (b) => b.serverId === serverId && b.userId === userId
    ) || null;

  S.isBanned = (serverId, userId) => !!S.banOf(serverId, userId);

  S.bansOf = (serverId) =>
    Object.values(store.db.bans || {})
      .filter((b) => b.serverId === serverId)
      .sort((a, b) => b.at - a.at);

  /* ---- logs de moderação ---- */
  S.logsOf = (serverId) =>
    (store.db.logs || [])
      .filter((l) => l.serverId === serverId)
      .sort((a, b) => b.at - a.at);

  /* ---- emojis personalizados do servidor ---- */
  S.serverEmojis = (serverId) =>
    Object.values(store.db.emojis || {})
      .filter((e) => e.serverId === serverId)
      .sort((a, b) => a.name.localeCompare(b.name));

  S.emojiByName = (serverId, name) =>
    Object.values(store.db.emojis || {}).find(
      (e) => e.serverId === serverId && e.name === String(name || "").toLowerCase()
    ) || null;

  /* ---- notificações ---- */
  S.notificationsOf = (userId) =>
    (store.db.notifications || [])
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.at - a.at);

  S.unreadNotifications = (userId) =>
    S.notificationsOf(userId).filter((n) => !n.read).length;

  /* ---- bloqueios ---- */
  S.blocksOf = (userId) => {
    const usr = store.db.users[userId];
    return (usr && usr.blocks) || [];
  };
  S.isBlocked = (a, b) => S.blocksOf(a).indexOf(b) !== -1;
  S.blockedBetween = (a, b) => S.isBlocked(a, b) || S.isBlocked(b, a);

  /* ---- mensagens fixadas e reações ---- */
  S.pinnedOf = (channelId) =>
    Object.values(store.db.messages)
      .filter((m) => m.channelId === channelId && m.pinned)
      .sort((a, b) => b.createdAt - a.createdAt);

  S.reactionSummary = (m, userId) => {
    const out = [];
    const reactions = (m && m.reactions) || {};
    Object.keys(reactions).forEach((emoji) => {
      const list = reactions[emoji] || [];
      if (list.length) out.push({ emoji: emoji, count: list.length, mine: list.indexOf(userId) !== -1 });
    });
    return out.sort((a, b) => b.count - a.count);
  };


  /* canais visíveis para o usuário, agrupados por categoria */
  S.visibleCategoryTree = (serverId, userId) => {
    const cats = S.categoriesOf(serverId);
    const tree = [];
    cats.forEach((cat) => {
      const channels = S.channelsOfCategory(cat.id).filter((c) =>
        S.canViewChannel(c, userId)
      );
      if (channels.length) tree.push({ category: cat, channels: channels });
    });
    return tree;
  };

  S.sharedServers = (a, b) =>
    S.membershipsOf(a)
      .filter((m) => S.membership(m.serverId, b))
      .map((m) => store.db.servers[m.serverId])
      .filter(Boolean);

  /* ---------------- rede social ----------------
     Coleções são a fonte de verdade; os contadores do usuário
     são cache derivado (recalculados em store.migrateSocial). */
  const followId = (a, b) => a + ">" + b;

  S.followEdge = (from, to) => (store.db.follows || {})[followId(from, to)] || null;

  /* "active" | "pending" | null */
  S.followState = (from, to) => {
    const e = S.followEdge(from, to);
    return e && e.state ? e.state : null;
  };

  S.isFollowing = (from, to) => S.followState(from, to) === "active";

  const sortByName = (a, b) =>
    String(a.displayName || a.username).localeCompare(String(b.displayName || b.username), "pt-BR");

  S.followersOf = (userId) =>
    Object.values(store.db.follows || {})
      .filter((f) => f.followingId === userId && f.state === "active")
      .map((f) => store.db.users[f.followerId])
      .filter(Boolean)
      .sort(sortByName);

  S.followingOf = (userId) =>
    Object.values(store.db.follows || {})
      .filter((f) => f.followerId === userId && f.state === "active")
      .map((f) => store.db.users[f.followingId])
      .filter(Boolean)
      .sort(sortByName);

  /* pedidos aguardando aprovação de `userId` */
  S.followRequestsOf = (userId) =>
    Object.values(store.db.follows || {})
      .filter((f) => f.followingId === userId && f.state === "pending")
      .map((f) => ({ edge: f, user: store.db.users[f.followerId] }))
      .filter((x) => x.user)
      .sort((a, b) => b.edge.createdAt - a.edge.createdAt);

  S.followerCount = (userId) =>
    Object.values(store.db.follows || {}).filter(
      (f) => f.followingId === userId && f.state === "active"
    ).length;

  S.followingCount = (userId) =>
    Object.values(store.db.follows || {}).filter(
      (f) => f.followerId === userId && f.state === "active"
    ).length;

  /* ---- curtidas ---- */
  S.likesOf = (type, id) =>
    Object.values(store.db.likes || {}).filter(
      (l) => l.targetType === type && l.targetId === id
    );

  S.likeCount = (type, id) => S.likesOf(type, id).length;

  S.likedBy = (type, id, userId) =>
    !!userId && S.likesOf(type, id).some((l) => l.userId === userId);

  /* ❤️ CURTIDAS recebidas nas publicações de `userId`.
     Uma curtida conta uma vez só: a chave do like é única por
     (autor, alvo), então remover a curtida devolve o número. */
  S.likesReceivedOf = (userId) =>
    Object.values(store.db.likes || {}).filter((l) => {
      if (l.targetType !== "post") return false;
      const post = (store.db.posts || {})[l.targetId];
      return !!post && post.authorId === userId;
    }).length;

  /* ---- publicações e comentários ---- */
  S.postsBy = (userId) =>
    Object.values(store.db.posts || {})
      .filter((p) => p.authorId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);

  S.post = (id) => (store.db.posts || {})[id] || null;

  S.commentsOf = (postId) =>
    Object.values(store.db.comments || {})
      .filter((c) => c.postId === postId)
      .sort((a, b) => a.createdAt - b.createdAt);

  S.comment = (id) => (store.db.comments || {})[id] || null;

  /* o visitante `viewerId` pode ver as publicações de `authorId`? */
  S.canViewPostsOf = (viewerId, authorId) => {
    if (!authorId) return false;
    if (viewerId && viewerId === authorId) return true;
    const author = store.db.users[authorId];
    const mode = (author && author.privacy && author.privacy.posts) || "public";
    if (mode === "public") return true;
    if (mode === "self") return false;
    return !!(viewerId && S.isFollowing(viewerId, authorId));
  };

  S.canViewFollowersOf = (viewerId, authorId) => {
    if (!authorId) return false;
    if (viewerId && viewerId === authorId) return true;
    const author = store.db.users[authorId];
    const mode = (author && author.privacy && author.privacy.followers) || "all";
    if (mode === "all") return true;
    if (mode === "self") return false;
    return !!(viewerId && S.isFollowing(viewerId, authorId));
  };

  /* pode ver as CURTIDAS (❤️) do perfil de authorId? */
  S.canViewLikesOf = (viewerId, authorId) => {
    if (!authorId) return false;
    if (viewerId && viewerId === authorId) return true;
    const author = store.db.users[authorId];
    const mode = (author && author.privacy && author.privacy.likes) || "all";
    if (mode === "all") return true;
    if (mode === "self") return false;
    return !!(viewerId && S.isFollowing(viewerId, authorId));
  };

  /* pode enviar mensagem direta para authorId? */
  S.canDM = (viewerId, authorId) => {
    if (!viewerId || !authorId || viewerId === authorId) return false;
    if (S.blockedBetween(viewerId, authorId)) return false;
    const author = store.db.users[authorId];
    const mode = (author && author.privacy && author.privacy.dm) || "all";
    if (mode === "none") return false;
    if (mode === "friends") return S.isFriend(authorId, viewerId);
    if (mode === "followers") return S.isFollowing(authorId, viewerId);
    return true;
  };

  /* =========================================================
     AMIZADES — sistema GLOBAL (a amizade existe independentemente
     de os dois estarem no mesmo servidor)
     ========================================================= */
  S.friendKey = (a, b) => [a, b].sort().join(":");

  S.friendship = (a, b) =>
    !a || !b || a === b
      ? null
      : (store.db.friendships || {})[S.friendKey(a, b)] || null;

  S.isFriend = (a, b) => !!S.friendship(a, b);

  S.friendCount = (userId) => {
    const u = store.db.users[userId];
    if (u && typeof u.friendsCount === "number") return u.friendsCount;
    return Object.values(store.db.friendships || {}).filter(
      (fr) => fr.userAId === userId || fr.userBId === userId
    ).length;
  };

  S.friendsOf = (userId) =>
    Object.values(store.db.friendships || {})
      .filter((fr) => fr.userAId === userId || fr.userBId === userId)
      .map((fr) => store.db.users[fr.userAId === userId ? fr.userBId : fr.userAId])
      .filter((u) => !!u && S.isRealPerson(u.id))
      .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));

  /* solicitação pendente em QUALQUER direção */
  S.friendRequestBetween = (a, b) =>
    Object.values(store.db.friendRequests || {}).find(
      (r) =>
        r.status === "pending" &&
        ((r.senderId === a && r.receiverId === b) || (r.senderId === b && r.receiverId === a))
    ) || null;

  S.friendRequestsOf = (userId) =>
    Object.values(store.db.friendRequests || {})
      .filter((r) => r.status === "pending" && r.receiverId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);

  S.sentFriendRequestsOf = (userId) =>
    Object.values(store.db.friendRequests || {})
      .filter((r) => r.status === "pending" && r.senderId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);

  S.friendRequest = (id) => (store.db.friendRequests || {})[id] || null;

  /* convite de servidor enviado a um amigo (evita duplicidade) */
  S.friendInvite = (serverId, friendId) =>
    (store.db.friendInvites || {})[serverId + ":" + friendId] || null;

  /* "self" | "friends" | "sent" | "received" | "none" */
  S.friendState = (viewerId, otherId) => {
    if (!viewerId || !otherId) return "none";
    if (viewerId === otherId) return "self";
    if (S.isFriend(viewerId, otherId)) return "friends";
    const req = S.friendRequestBetween(viewerId, otherId);
    if (!req) return "none";
    return req.senderId === viewerId ? "sent" : "received";
  };

  S.mutualFriendCount = (a, b) => {
    const fa = {};
    Object.values(store.db.friendships || {}).forEach((fr) => {
      if (fr.userAId === a) fa[fr.userBId] = 1;
      if (fr.userBId === a) fa[fr.userAId] = 1;
    });
    return Object.values(store.db.friendships || {}).filter(
      (fr) =>
        (fr.userAId === b || fr.userBId === b) && fa[fr.userAId === b ? fr.userBId : fr.userAId]
    ).length;
  };

  /* pode enviar solicitação de amizade? regras do DONO do perfil */
  S.canSendFriendRequest = (viewerId, otherId) => {
    if (!viewerId || !otherId) return { ok: false, reason: "Usuário não encontrado." };
    if (viewerId === otherId) return { ok: false, reason: "Você não pode adicionar a si mesmo." };
    if (S.isFriend(viewerId, otherId))
      return { ok: false, reason: "Vocês já são amigos." };
    if (S.friendRequestBetween(viewerId, otherId))
      return { ok: false, reason: "Já existe uma solicitação de amizade pendente." };
    if (S.blockedBetween(viewerId, otherId))
      return { ok: false, reason: "Não é possível enviar solicitação para esta pessoa." };
    const other = store.db.users[otherId];
    const mode = (other && other.privacy && other.privacy.friendRequests) || "all";
    if (mode === "none")
      return { ok: false, reason: "Esta pessoa não aceita solicitações de amizade." };
    if (mode === "common" && S.mutualFriendCount(viewerId, otherId) < 1)
      return { ok: false, reason: "Esta pessoa só aceita solicitações de amigos em comum." };
    return { ok: true, reason: "" };
  };

  /* =========================================================
     PESSOAS REAIS x DADOS DE DEMONSTRAÇÃO
     Com DEMO_MODE=false (produção) nenhuma conta de demonstração
     aparece em listas públicas (membros, amigos, busca...).
     ========================================================= */
  S.isRealPerson = (userId) => {
    const u = store.db.users[userId];
    if (!u) return false;
    if (u.demo && !NX.demoMode()) return false;
    return true;
  };

  S.realPeople = (users) => (users || []).filter((u) => u && S.isRealPerson(u.id));

  /* feed: minhas publicações + das pessoas que sigo + públicas */
  S.feedPosts = () => {
    const me = S.me();
    if (!me) return [];
    return Object.values(store.db.posts || {})
      .filter((p) => S.canViewPostsOf(me.id, p.authorId))
      .sort((a, b) => b.createdAt - a.createdAt);
  };

  NX.store = store;
  NX.selectors = S;
})(window.NX);
