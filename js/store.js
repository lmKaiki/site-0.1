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
    auth: { attempts: {}, codes: {}, pending: {} },
    outbox: [],
    /* rede social — fonte de verdade dos contadores do perfil */
    follows: {},   /* "<de>><para>" → {id, followerId, followingId, state, createdAt} */
    posts: {},     /* id → {id, authorId, content, media[], createdAt, likesCount, commentsCount} */
    likes: {},     /* id → {id, userId, targetType, targetId, createdAt} */
    comments: {},  /* id → {id, postId, parentId, authorId, content, createdAt, likesCount} */
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

  store.load = function () {
    let best = null;
    let bestKey = null;

    LEGACY_KEYS.forEach((key) => {
      const raw = NX.storage.get(key, null);
      if (!raw || typeof raw !== "object" || !raw.users) return;
      const count = Object.keys(raw.users || {}).length;
      if (!best || count > best.__count) {
        best = raw;
        best.__count = count;
        bestKey = key;
      }
    });

    if (best) {
      const count = best.__count;
      delete best.__count;
      this.db = Object.assign(emptyDB(), best);
      this.db.version = 1;
      this.db.auth = this.db.auth || { attempts: {}, codes: {}, pending: {} };
      this.db.auth.attempts = this.db.auth.attempts || {};
      this.db.auth.codes = this.db.auth.codes || {};
      this.db.auth.pending = this.db.auth.pending || {};
      this.db.outbox = this.db.outbox || [];
      this.migratedFrom = bestKey && bestKey !== DB_KEY ? bestKey : null;
      this.loadedUsers = count;
      if (this.migratedFrom) {
        const saved = NX.storage.set(DB_KEY, this.db);
        /* só apaga as chaves antigas depois que a nova estiver gravada */
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
    this.ready = true;
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

    const PRIV = { follow: ["all", "approved"], dm: ["all", "followers", "none"], followers: ["all", "followers", "self"], posts: ["public", "followers", "self"] };

    Object.values(db.users || {}).forEach((usr) => {
      const p = usr.privacy || {};
      usr.privacy = {
        follow: PRIV.follow.indexOf(p.follow) > -1 ? p.follow : "all",
        dm: PRIV.dm.indexOf(p.dm) > -1 ? p.dm : "all",
        followers: PRIV.followers.indexOf(p.followers) > -1 ? p.followers : "all",
        posts: PRIV.posts.indexOf(p.posts) > -1 ? p.posts : "public",
      };
      if (!Array.isArray(usr.blocks)) usr.blocks = [];
      usr.followersCount = 0;
      usr.followingCount = 0;
      usr.likesReceived = 0;
    });

    /* contadores recalculados (fonte de verdade = coleções) */
    Object.values(db.follows).forEach((f) => {
      if (f.state !== "active") return;
      const target = db.users[f.followingId];
      const from = db.users[f.followerId];
      if (target) target.followersCount = (target.followersCount || 0) + 1;
      if (from) from.followingCount = (from.followingCount || 0) + 1;
    });

    const authorOf = (like) => {
      if (like.targetType === "post") return db.posts[like.targetId];
      if (like.targetType === "comment") return db.comments[like.targetId];
      if (like.targetType === "message") return db.messages[like.targetId];
      return null;
    };
    Object.values(db.likes).forEach((l) => {
      const owner = authorOf(l);
      if (owner && db.users[owner.authorId || owner.userId]) {
        const u = db.users[owner.authorId || owner.userId];
        u.likesReceived = (u.likesReceived || 0) + 1;
      }
    });
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

  const likesOwner = (like) => {
    const db = store.db;
    if (like.targetType === "post") return db.posts[like.targetId];
    if (like.targetType === "comment") return db.comments[like.targetId];
    if (like.targetType === "message") return db.messages[like.targetId];
    return null;
  };

  S.likesReceivedOf = (userId) =>
    Object.values(store.db.likes || {}).filter((l) => {
      const owner = likesOwner(l);
      return owner && (owner.authorId || owner.userId) === userId;
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

  /* pode enviar mensagem direta para authorId? */
  S.canDM = (viewerId, authorId) => {
    if (!viewerId || !authorId || viewerId === authorId) return false;
    if (S.blockedBetween(viewerId, authorId)) return false;
    const author = store.db.users[authorId];
    const mode = (author && author.privacy && author.privacy.dm) || "all";
    if (mode === "none") return false;
    if (mode === "followers") return S.isFollowing(authorId, viewerId);
    return true;
  };

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
