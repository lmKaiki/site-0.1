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
  /* Alfabeto dos códigos de convite: dado TÉCNICO, nunca traduzir —
     se uma versão trocar as letras, os convites deixam de bater. */
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
    return usr ? usr.displayName : (NX.i18n.get("api.alguem", "alguém"));
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
    if (!server) fail(NX.i18n.get("adm.esteServidorNaoExiste", "Este servidor não existe mais ou foi excluído."));
    return server;
  }

  function requireMember(serverId) {
    const me = S().me();
    if (!me) fail(NX.i18n.get("api.suaSessaoExpirouEntre8", "Sua sessão expirou. Entre novamente."));
    const m = S().membership(serverId, me.id);
    if (!m) fail(NX.i18n.get("adm.voceNaoFazParte", "Você não faz parte deste servidor."));
    return { me: me, membership: m };
  }

  function requirePerm(serverId, perm, message) {
    const { me } = requireMember(serverId);
    if (!S().can(serverId, me.id, perm)) fail(message || NX.i18n.get("api.voceNaoTemPermissao", "Você não tem permissão para isso."));
    return me;
  }

  /* =========================================================
     AUTENTICAÇÃO — camada "backend"
     -------------------------------------------------------
     • login SOMENTE por nome de usuário + senha (sem e-mail,
       sem código de verificação, sem recuperação por e-mail);
     • senha guardada apenas como hash com salt (nx2$…),
       nunca em texto puro — hashes antigos nx1$ são
       atualizados sozinhos no primeiro login certo;
     • limite de tentativas de login (anti força bruta);
     • toda gravação é verificada: se o navegador não salvar,
       a operação falha em voz alta em vez de fingir sucesso.
     ========================================================= */

  const LOGIN_MAX_FAILS = 8;
  const LOGIN_FAIL_WINDOW = 15 * 60 * 1000;

  function authDB() {
    db().auth = db().auth || {};
    const a = db().auth;
    a.attempts = a.attempts || {};
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
      fail((NX.i18n.get("api.muitastentativasaguarde", "Muitas tentativas. Aguarde") + " ") + waitLabel(secs) + (" " + NX.i18n.get("api.paratentardenovo", "para tentar de novo.")));
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

  /* encontra a conta APENAS pelo nome de usuário (o login da Nexo
     não usa e-mail). Cadastro e login passam por ESTA função e usam
     a MESMA normalização — não existe lista paralela de contas:
     a fonte única é NX.store.db.users, a mesma que o cadastro grava. */
  function findAccount(rawIdent) {
    const bare = u().normalizeUsername(rawIdent).replace(/^@/, "");
    if (!bare) return null;
    const users = Object.values(db().users || {});
    const hit = users.find(
      (x) => x && x.username && u().normalizeUsername(x.username) === bare
    );
    return hit || null;
  }

  /* grava e, se o navegador não aceitar, desfaz o que foi criado */
  function persistOrFail(rollback) {
    if (NX.store.persist()) return true;
    if (typeof rollback === "function") rollback();
    fail(
      (NX.i18n.get("api.naofoipossivelsalvarseusdados", "Não foi possível salvar seus dados neste navegador (armazenamento bloqueado ou sem espaço).") + " ") +
        NX.i18n.get("api.libereArmazenamentoSiteTente", "Libere o armazenamento do site e tente novamente.")
    );
    return false;
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
    const detected = (NX.region && NX.region.detect)
      ? NX.region.detect()
      : { timezone: (NX.i18n.get("api.americasaopaulo", "America/Sao_Paulo")), language: "pt-BR" };
    return {
      id: id,
      username: o.username,
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
      createdAt: Date.now(),
      /* região: só o que o navegador informa, nunca IP/GPS */
      region: {
        countryCode: "",
        countryName: "",
        countryFlag: "",
        timezone: detected.timezone,
        language: "pt-BR",
        showCountry: true,
      },
    };
  }

  /* ===== CADASTRO =====
     Usuário + senha (sem e-mail, sem código de verificação).
     Depois de criada, a conta entra automaticamente. */
  api.signup = async function (data) {
    await delay();
    /* MESMA normalização usada no login (util.normalizeUsername) */
    const username = u().normalizeUsername(data.username);
    const policy = u().passwordPolicy(data.password);

    if (!username) fail(NX.i18n.get("api.digiteNomeUsuario2", "Digite um nome de usuário."));
    if (!u().usernameOk(username))
      fail((NX.i18n.get("api.nomedeusuarioprecisade3", "Nome de usuário precisa de 3 a 18 caracteres (letras, números, ponto e sublinhado), sem espaços.")));
    if (!data.password) fail(NX.i18n.get("api.digiteSenha", "Digite uma senha."));
    if (!policy.ok) fail(policy.message);
    if (String(data.password) !== String(data.confirm)) fail(NX.i18n.get("api.senhasNaoConferem2", "As senhas não conferem."));

    const key = username;
    assertNotBlocked("signup", key, 5, LOGIN_FAIL_WINDOW);

    /* unicidade já em forma canônica: teste123 e TESTE123 são o mesmo nome */
    const dupeName = Object.values(db().users).some(
      (x) => x && x.username && u().normalizeUsername(x.username) === key
    );
    if (dupeName) {
      countFail("signup", key, 5, LOGIN_FAIL_WINDOW);
      fail(NX.i18n.get("api.esseNomeUsuarioJa", "Esse nome de usuário já está em uso. Tente outro."));
    }

    const user = makeUser({
      username: username, /* canônico (minúsculo) — o mesmo que o login procura */
      password: data.password,
      displayName: String(data.username || "").trim() || username,
      emoji: data.emoji,
      color: data.color,
    });

    db().users[user.id] = user;
    db().presence[user.id] = "online";

    /* a conta só "existe" depois de gravada de verdade */
    persistOrFail(() => {
      delete db().users[user.id];
      delete db().presence[user.id];
    });

    clearFails("signup", key);
    notify(user.id, "system", NX.i18n.get("api.bemVindoNexo", "Bem-vindo à Nexo!"));

    /* acesso automático: nenhuma etapa de e-mail/código */
    user.status = "online";
    NX.session.set(user.id, true);
    try {
      if (NX.i18n) {
        NX.i18n.reset();
        NX.i18n.apply();
      }
    } catch (e) {
      /* sem i18n: segue no padrão */
    }
    NX.store.commit(["session", "servers", "profile", "presence"]);

    return { user: user, message: NX.i18n.get("api.suaContaFoiCriada", "Sua conta foi criada com sucesso.") };
  };

  /* ===== LOGIN ===== (nome de usuário + senha) */
  api.login = async function (data) {
    await delay();
    /* mesma normalização do cadastro: OSAK = osak = @Osak */
    const ident = u().normalizeIdentifier(data.identifier);
    if (!ident) fail(NX.i18n.get("api.digiteSeuNomeUsuario", "Digite seu nome de usuário."));
    if (!data.password) fail(NX.i18n.get("api.digiteSuaSenha", "Digite sua senha."));

    const key = ident;
    assertNotBlocked("login", key, LOGIN_MAX_FAILS, LOGIN_FAIL_WINDOW);

    /* procura na MESMA fonte em que o cadastro gravou: db.users */
    const found = findAccount(ident);
    if (!found) {
      countFail("login", key, LOGIN_MAX_FAILS, LOGIN_FAIL_WINDOW);
      fail(NX.i18n.get("api.naoEncontramosContaEsse", "Não encontramos uma conta com esse nome de usuário."));
    }
    if (!u().verifyPassword(String(data.password), found.password || "")) {
      countFail("login", key, LOGIN_MAX_FAILS, LOGIN_FAIL_WINDOW);
      fail(NX.i18n.get("api.senhaEstaIncorreta", "A senha está incorreta."));
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
    /* o Nexo é somente pt-BR: nada de troca de idioma aqui */
    try {
      if (NX.i18n) {
        NX.i18n.reset();
        NX.i18n.apply();
      }
    } catch (e) {
      /* sem i18n: segue no padrão */
    }
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
    try {
      if (NX.i18n) {
        NX.i18n.reset();
        NX.i18n.apply();
      }
    } catch (e) {
      /* sem i18n: segue no padrão */
    }
    NX.store.commit(["session", "presence", "voice"]);
  };

  /* troca de senha com sessão ativa (Configurações → Minha conta) */
  api.changePassword = async function (data) {
    await delay();
    const me = S().me();
    if (!me) fail(NX.i18n.get("api.suaSessaoExpirouEntre8", "Sua sessão expirou. Entre novamente."));
    data = data || {};

    if (!u().verifyPassword(String(data.current || ""), me.password || ""))
      fail(NX.i18n.get("api.senhaAtualEstaIncorreta", "A senha atual está incorreta."));
    const policy = u().passwordPolicy(data.password);
    if (!policy.ok) fail(policy.message);
    if (String(data.password) !== String(data.confirm)) fail(NX.i18n.get("api.senhasNaoConferem2", "As senhas não conferem."));

    me.password = u().hashPassword(String(data.password), u().makeSalt());
    persistOrFail();
    db().prefs = db().prefs || {};
    db().prefs.pwChangedAt = Date.now();
    notify(me.id, "system", NX.i18n.get("api.suaSenhaFoiAlterada", "Sua senha foi alterada."));
    NX.store.commit(["session"]);
    return { ok: true };
  };

  api.updateProfile = async function (patch) {
    await delay();
    const me = S().me();
    if (!me) fail(NX.i18n.get("api.suaSessaoExpirouEntre8", "Sua sessão expirou. Entre novamente."));

    if (patch.username !== undefined) {
      /* mesma regra do cadastro/login: canônico, único e sem espaços */
      const username = u().normalizeUsername(patch.username);
      if (!username) fail(NX.i18n.get("api.digiteNomeUsuario2", "Digite um nome de usuário."));
      if (!u().usernameOk(username))
        fail((NX.i18n.get("api.nomedeusuarioprecisade32", "Nome de usuário precisa de 3 a 18 caracteres (letras, números, . e _), sem espaços.")));
      const dupe = Object.values(db().users).some(
        (x) => x.id !== me.id && x.username && u().normalizeUsername(x.username) === username
      );
      if (dupe) fail(NX.i18n.get("api.esseNomeUsuarioJa2", "Esse nome de usuário já está em uso."));
      me.username = username;
    }
    if (patch.displayName !== undefined) {
      const n = String(patch.displayName).trim();
      if (n.length < 2) fail(NX.i18n.get("api.digiteNomePeloMenos", "Digite um nome com pelo menos 2 caracteres."));
      me.displayName = n.slice(0, 32);
    }
    if (patch.bio !== undefined) me.bio = String(patch.bio).slice(0, 190);
    if (patch.avatar !== undefined) {
      const next = Object.assign({}, me.avatar, patch.avatar);
      if (next.image && next.image.length > 900000)
        fail(NX.i18n.get("api.estaImagemGrandeDemais2", "Esta imagem é grande demais. Use uma com até 1 MB."));
      me.avatar = next;
    }
    if (patch.banner !== undefined) {
      if (patch.banner && String(patch.banner).length > 1400000)
        fail(NX.i18n.get("api.esteBannerGrandeDemais2", "Este banner é grande demais. Use uma imagem com até 1,5 MB."));
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
    if (!me) fail(NX.i18n.get("api.suaSessaoExpirouEntre8", "Sua sessão expirou. Entre novamente."));
    const name = String(data.name || "").trim();
    if (name.length < 2) fail(NX.i18n.get("api.nomePeloMenos2", "Dê um nome com pelo menos 2 caracteres ao servidor."));
    if (name.length > 40) fail(NX.i18n.get("api.nomePodeTerMaximo", "O nome pode ter no máximo 40 caracteres."));

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
      name: (NX.i18n.get("adm.membros", "Membros")),
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
    requirePerm(serverId, "manageServer", NX.i18n.get("api.voceNaoTemPermissao2", "Você não tem permissão para editar este servidor."));
    const s = db().servers[serverId];
    const changed = [];
    if (patch.name !== undefined) {
      const n = String(patch.name).trim();
      if (n.length < 2) fail(NX.i18n.get("api.nomePrecisaPeloMenos", "O nome precisa de pelo menos 2 caracteres."));
      if (n !== s.name) changed.push("nome");
      s.name = n.slice(0, 40);
    }
    if (patch.description !== undefined) s.description = String(patch.description).slice(0, 240);
    if (patch.icon !== undefined) {
      const next = Object.assign({}, s.icon, patch.icon);
      if (next.image && next.image.length > 900000)
        fail(NX.i18n.get("api.estaImagemGrandeDemais2", "Esta imagem é grande demais. Use uma com até 1 MB."));
      s.icon = next;
      changed.push((NX.i18n.get("api.icone", "ícone")));
    }
    if (patch.banner !== undefined) {
      if (patch.banner && String(patch.banner).length > 1400000)
        fail(NX.i18n.get("api.esteBannerGrandeDemais2", "Este banner é grande demais. Use uma imagem com até 1,5 MB."));
      s.banner = patch.banner || null;
      changed.push("banner");
    }
    if (patch.appearance !== undefined) {
      s.appearance = Object.assign(
        { primary: "#35e0a8", secondary: "#8f83ff", backgroundImage: null, theme: "dark" },
        s.appearance,
        patch.appearance
      );
      changed.push((NX.i18n.get("api.aparencia", "aparência")));
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
    if (server.ownerId !== me.id) fail(NX.i18n.get("adm.apenasDonoServidorPode", "Apenas o dono do servidor pode excluí-lo."));

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

  /* Sair do servidor — afeta SOMENTE quem clica.
     Regras do backend (não confiar no botão):
       • sessão autenticada;
       • servidor existe;
       • usuário realmente é membro;
       • dono NÃO pode sair sem transferir a propriedade
         (senão o servidor ficaria sem proprietário);
       • não mexe em conta, DMs, outros membros nem no servidor. */
  api.leaveServer = async function (serverId) {
    await delay();
    requireServer(serverId);
    const me = S().me();
    if (!me) fail(NX.i18n.get("api.suaSessaoExpirouEntre8", "Sua sessão expirou. Entre novamente."));
    const server = db().servers[serverId];
    if (server.ownerId === me.id)
      fail(
        (NX.i18n.get("api.voceeoproprietariodesteservidor", "Você é o proprietário deste servidor. Transfira a propriedade para outro membro antes de sair."))
      );
    const m = S().membership(serverId, me.id);
    if (!m) fail(NX.i18n.get("adm.voceNaoFazParte", "Você não faz parte deste servidor."));
    delete db().memberships[m.id];
    db().voice = db().voice.filter(
      (v) => !(v.userId === me.id && v.channelId && (S().channel(v.channelId) || {}).serverId === serverId)
    );
    log(serverId, "member.leave", { userId: me.id });
    Object.values(db().memberships)
      .filter((x) => x.serverId === serverId)
      .slice(0, 1)
      .forEach((x) =>
        notify(x.userId, "server", me.displayName + (" " + NX.i18n.get("api.saiude", "saiu de") + " ") + server.name + ".")
      );
    NX.store.commit(["servers", "members", "voice", "route"]);
    return true;
  };

  api.joinByInvite = async function (code) {
    await delay();
    const me = S().me();
    if (!me) fail(NX.i18n.get("api.entreSuaContaAceitar", "Entre na sua conta para aceitar o convite."));
    const clean = u().normalize(String(code || "")).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const invite = S().invite(clean);
    if (!invite) {
      const maybe = Object.keys(db().servers).find(
        (id) => u().slug(db().servers[id].name) === clean.toLowerCase()
      );
      if (!maybe) fail(NX.i18n.get("api.conviteInvalidoExpiradoPeca", "Convite inválido ou expirado. Peça um novo link para quem criou."));
      return api.joinServer(maybe);
    }
    if (invite.expiresAt && invite.expiresAt < Date.now()) {
      delete db().invites[invite.code];
      NX.store.commit(["invites"]);
      fail(NX.i18n.get("api.esteConviteExpirouPeca", "Este convite expirou. Peça um novo link para quem criou."));
    }
    if (invite.maxUses && invite.uses >= invite.maxUses)
      fail(NX.i18n.get("api.esteConviteAtingiuLimite", "Este convite atingiu o limite de usos. Peça um novo link."));
    return api.joinServer(invite.serverId, invite);
  };

  api.joinServer = async function (serverId, invite) {
    await delay();
    const server = requireServer(serverId);
    const me = S().me();
    if (!me) fail(NX.i18n.get("api.entreSuaContaEntrar", "Entre na sua conta para entrar no servidor."));
    if (S().membership(serverId, me.id))
      fail(NX.i18n.get("api.voceJaFazParte", "Você já faz parte deste servidor."));
    const ban = S().banOf(serverId, me.id);
    if (ban)
      fail(
        NX.i18n.get("api.voceFoiBanidoDeste", "Você foi banido deste servidor") +
          (ban.reason ? (" " + NX.i18n.get("api.pelomotivo", "pelo motivo:") + " ") + ban.reason : ".") +
          (" " + NX.i18n.get("api.falecomamoderacao", "Fale com a moderação."))
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
      notify(server.ownerId, "server", me.displayName + (" " + NX.i18n.get("api.entrouem", "entrou em") + " ") + server.name + ".");
    NX.store.commit(["servers", "members", "channels", "invites", "route"]);
    return server;
  };

  /* =========================================================
     CARGOS
     ========================================================= */
  api.createRole = async function (serverId, data) {
    await delay();
    requirePerm(serverId, "manageRoles", NX.i18n.get("api.voceNaoTemPermissao3", "Você não tem permissão para criar cargos."));
    const name = String(data.name || "").trim();
    if (name.length < 2) fail(NX.i18n.get("api.nomePeloMenos22", "Dê um nome com pelo menos 2 caracteres ao cargo."));
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
    if (!role) fail(NX.i18n.get("api.cargoNaoEncontrado2", "Cargo não encontrado."));
    requirePerm(role.serverId, "manageRoles", NX.i18n.get("api.voceNaoTemPermissao4", "Você não tem permissão para editar cargos."));
    if (patch.name !== undefined) {
      const n = String(patch.name).trim();
      if (n.length < 2) fail(NX.i18n.get("api.nomeCargoPrecisaPelo", "O nome do cargo precisa de pelo menos 2 caracteres."));
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
    if (!role) fail(NX.i18n.get("api.cargoNaoEncontrado2", "Cargo não encontrado."));
    requirePerm(role.serverId, "manageRoles", NX.i18n.get("api.voceNaoTemPermissao5", "Você não tem permissão para apagar cargos."));
    if (role.isDefault) fail(NX.i18n.get("adm.cargoPadraoNaoPode", "O cargo padrão não pode ser excluído."));
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
    const me = requirePerm(serverId, "manageRoles", NX.i18n.get("api.voceNaoTemPermissao6", "Você não tem permissão para gerenciar cargos."));
    if (userId === me.id) fail(NX.i18n.get("api.voceNaoPodeAlterar", "Você não pode alterar o próprio cargo por aqui."));
    const server = requireServer(serverId);
    if (server.ownerId === userId) fail(NX.i18n.get("api.donoServidorTemTodos", "O dono do servidor tem todos os cargos."));
    const m = S().membership(serverId, userId);
    if (!m) fail(NX.i18n.get("api.esteMembroNaoEsta4", "Este membro não está mais no servidor."));
    if (roleId && !S().role(roleId)) fail(NX.i18n.get("api.cargoInvalido", "Cargo inválido."));
    m.roleId = roleId || (S().defaultRole(serverId) || {}).id || null;
    log(serverId, "member.role", { userId: userId, role: roleName(serverId, m.roleId) });
    notify(userId, "server", (NX.i18n.get("api.seucargoem", "Seu cargo em") + " ") + server.name + (" " + NX.i18n.get("api.agorae", "agora é") + " ") + roleName(serverId, m.roleId) + ".");
    NX.store.commit(["members"]);
    return m;
  };

  api.updateMemberPerms = async function (serverId, userId, patch) {
    await delay();
    const me = requirePerm(serverId, "manageRoles", NX.i18n.get("api.voceNaoTemPermissao19", "Você não tem permissão para alterar permissões."));
    const server = requireServer(serverId);
    if (server.ownerId === userId) fail(NX.i18n.get("api.donoJaPossuiTodas", "O dono já possui todas as permissões."));
    if (userId === me.id && !S().can(serverId, me.id, "administrator"))
      fail(NX.i18n.get("api.voceSoPodeAlterar", "Você só pode alterar permissões de outros membros."));
    const m = S().membership(serverId, userId);
    if (!m) fail(NX.i18n.get("api.esteMembroNaoEsta4", "Este membro não está mais no servidor."));
    m.permissions = m.permissions || {};
    NX.PERM_KEYS.forEach((k) => {
      if (patch[k] === true || patch[k] === false) m.permissions[k] = patch[k];
    });
    log(serverId, "member.role", { userId: userId, what: NX.i18n.get("api.permissoesIndividuais", "permissões individuais") });
    NX.store.commit(["members"]);
    return m;
  };

  /* apelido específico do servidor (perfil por servidor) */
  api.setNickname = async function (serverId, userId, nickname) {
    await delay();
    const me = S().me();
    const m = S().membership(serverId, userId);
    if (!m) fail(NX.i18n.get("api.esteMembroNaoEsta4", "Este membro não está mais no servidor."));
    const isSelf = me.id === userId;
    if (!isSelf) requirePerm(serverId, "manageMembers", NX.i18n.get("api.voceNaoTemPermissao8", "Você não tem permissão para alterar apelidos."));
    m.nickname = String(nickname || "").slice(0, 32);
    if (isSelf) log(serverId, "member.nick", { userId: userId, nick: m.nickname || "(removido)" });
    NX.store.commit(["members"]);
    return m;
  };

  /* hierarquia: ninguém age sobre o dono; só dono/admin age sobre admin */
  function assertCanActOn(serverId, me, targetId) {
    const server = db().servers[serverId];
    if (server.ownerId === targetId) fail(NX.i18n.get("api.estaAcaoNaoAplica", "Esta ação não se aplica ao dono do servidor."));
    const targetIsAdmin = S().can(serverId, targetId, "administrator");
    const iAmAdmin = S().can(serverId, me.id, "administrator") || server.ownerId === me.id;
    if (targetIsAdmin && !iAmAdmin)
      fail(NX.i18n.get("api.voceNaoPodeAplicar", "Você não pode aplicar esta ação a um administrador."));
  }

  api.kickMember = async function (serverId, userId, reason) {
    await delay();
    const me = requirePerm(serverId, "kickMembers", NX.i18n.get("api.voceNaoTemPermissao9", "Você não tem permissão para expulsar membros."));
    const server = requireServer(serverId);
    if (userId === me.id) fail(NX.i18n.get("api.useSairServidorSair", "Use “Sair do servidor” para sair."));
    assertCanActOn(serverId, me, userId);
    const m = S().membership(serverId, userId);
    if (!m) fail(NX.i18n.get("api.esteMembroNaoEsta4", "Este membro não está mais no servidor."));
    delete db().memberships[m.id];
    db().voice = db().voice.filter((v) => v.userId !== userId);
    log(serverId, "member.kick", { userId: userId, reason: reason || "" });
    notify(userId, "server", (NX.i18n.get("api.vocefoiexpulsode", "Você foi expulso de") + " ") + server.name + (reason ? ": " + reason : "."));
    NX.store.commit(["members", "voice"]);
    return true;
  };

  api.banMember = async function (serverId, userId, reason) {
    await delay();
    const me = requirePerm(serverId, "banMembers", NX.i18n.get("api.voceNaoTemPermissao10", "Você não tem permissão para banir membros."));
    const server = requireServer(serverId);
    if (userId === me.id) fail(NX.i18n.get("api.voceNaoPodeBanir", "Você não pode banir a si mesmo."));
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
    notify(userId, "server", (NX.i18n.get("api.vocefoibanidode", "Você foi banido de") + " ") + server.name + (reason ? ": " + reason : "."));
    NX.store.commit(["members", "voice"]);
    return db().bans[id];
  };

  api.unbanMember = async function (banId) {
    await delay();
    const ban = (db().bans || {})[banId];
    if (!ban) fail(NX.i18n.get("api.esteBanimentoNaoExiste", "Este banimento não existe mais."));
    requirePerm(ban.serverId, "unbanMembers", NX.i18n.get("api.voceNaoTemPermissao11", "Você não tem permissão para desbanir membros."));
    delete db().bans[banId];
    log(ban.serverId, "member.unban", { userId: ban.userId, reason: ban.reason || "" });
    const usr = S().user(ban.userId);
    if (usr) notify(ban.userId, "server", (NX.i18n.get("api.vocefoidesbanidode", "Você foi desbanido de") + " ") + (S().server(ban.serverId) || {}).name + ".");
    NX.store.commit(["members"]);
    return true;
  };

  /* duas etapas: escolher membro + confirmar que você perde a propriedade */
  api.transferOwnership = async function (serverId, userId) {
    await delay();
    const server = requireServer(serverId);
    const me = S().me();
    if (server.ownerId !== me.id) fail(NX.i18n.get("api.apenasDonoPodeTransferir", "Apenas o dono pode transferir a propriedade."));
    if (userId === me.id) fail(NX.i18n.get("api.escolhaOutroMembro", "Escolha outro membro."));
    const m = S().membership(serverId, userId);
    if (!m) fail(NX.i18n.get("api.escolhaMembroEstejaServidor", "Escolha um membro que esteja no servidor."));
    const prevOwner = server.ownerId;
    server.ownerId = userId;
    log(serverId, "ownership.transfer", { userId: userId, from: prevOwner });
    notify(userId, "server", (NX.i18n.get("api.voceagoraeodonode", "Você agora é o dono de") + " ") + server.name + ".");
    NX.store.commit(["servers", "members"]);
    return server;
  };

  /* =========================================================
     CATEGORIAS
     ========================================================= */
  api.createCategory = async function (serverId, data) {
    await delay();
    const me = requirePerm(serverId, "manageChannels", NX.i18n.get("api.voceNaoTemPermissao12", "Você não tem permissão para criar categorias."));
    const name = String(data.name || "").trim();
    if (name.length < 2) fail(NX.i18n.get("api.nomePeloMenos24", "Dê um nome com pelo menos 2 caracteres à categoria."));
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
    if (!cat) fail(NX.i18n.get("api.categoriaNaoEncontrada3", "Categoria não encontrada."));
    requirePerm(cat.serverId, "manageChannels", NX.i18n.get("api.voceNaoTemPermissao13", "Você não tem permissão para editar categorias."));
    const n = String(name || "").trim();
    if (n.length < 2) fail(NX.i18n.get("api.nomePeloMenos24", "Dê um nome com pelo menos 2 caracteres à categoria."));
    cat.name = n.slice(0, 32).toUpperCase();
    log(cat.serverId, "category.update", { name: cat.name });
    NX.store.commit(["categories"]);
    return cat;
  };

  api.deleteCategory = async function (categoryId) {
    await delay();
    const cat = S().category(categoryId);
    if (!cat) fail(NX.i18n.get("api.categoriaNaoEncontrada3", "Categoria não encontrada."));
    requirePerm(cat.serverId, "manageChannels", NX.i18n.get("api.voceNaoTemPermissao14", "Você não tem permissão para apagar categorias."));
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
    const me = requirePerm(serverId, "manageChannels", NX.i18n.get("api.voceNaoTemPermissao15", "Você não tem permissão para criar canais."));
    const type = data.type === "voice" ? "voice" : "text";
    const raw = String(data.name || "").trim();
    const name = type === "voice" ? raw.replace(/\s+/g, " ").slice(0, 32) : u().slug(raw);
    if (name.length < 2) fail(NX.i18n.get("api.nomePeloMenos25", "Dê um nome com pelo menos 2 caracteres ao canal."));
    const cat = S().category(data.categoryId);
    if (!cat || cat.serverId !== serverId) fail(NX.i18n.get("api.escolhaCategoriaValida", "Escolha uma categoria válida."));
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
    if (!ch) fail(NX.i18n.get("api.canalNaoEncontrado6", "Canal não encontrado."));
    requirePerm(ch.serverId, "manageChannels", NX.i18n.get("api.voceNaoTemPermissao16", "Você não tem permissão para editar canais."));
    if (patch.name !== undefined) {
      const raw = String(patch.name).trim();
      const name = ch.type === "voice" ? raw.replace(/\s+/g, " ").slice(0, 32) : u().slug(raw);
      if (name.length < 2) fail(NX.i18n.get("api.nomeCanalPrecisaPelo", "O nome do canal precisa de pelo menos 2 caracteres."));
      ch.name = name;
    }
    if (patch.topic !== undefined) ch.topic = String(patch.topic).slice(0, 180);
    if (patch.categoryId !== undefined) {
      const cat = S().category(patch.categoryId);
      if (!cat || cat.serverId !== ch.serverId) fail(NX.i18n.get("api.categoriaInvalida", "Categoria inválida."));
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
    if (NX.PERM_KEYS.indexOf(permKey) === -1) fail(NX.i18n.get("api.permissaoDesconhecida", "Permissão desconhecida."));
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
    if (!ch) fail(NX.i18n.get("api.canalNaoEncontrado6", "Canal não encontrado."));
    requirePerm(ch.serverId, "manageChannels", NX.i18n.get("api.voceNaoTemPermissao19", "Você não tem permissão para alterar permissões."));
    setPermOn(ch, targetKey, permKey, state);
    log(ch.serverId, "channel.update", { name: "#" + ch.name, what: (NX.i18n.get("adm.permissoes", "permissões")) });
    NX.store.commit(["channels"]);
    return ch;
  };

  api.setCategoryPerm = async function (categoryId, targetKey, permKey, state) {
    await delay();
    const cat = S().category(categoryId);
    if (!cat) fail(NX.i18n.get("api.categoriaNaoEncontrada3", "Categoria não encontrada."));
    requirePerm(cat.serverId, "manageChannels", NX.i18n.get("api.voceNaoTemPermissao19", "Você não tem permissão para alterar permissões."));
    setPermOn(cat, targetKey, permKey, state);
    log(cat.serverId, "category.update", { name: cat.name, what: (NX.i18n.get("adm.permissoes", "permissões")) });
    NX.store.commit(["categories"]);
    return cat;
  };

  api.setChannelInheritance = async function (channelId, inherit) {
    await delay();
    const ch = S().channel(channelId);
    if (!ch) fail(NX.i18n.get("api.canalNaoEncontrado6", "Canal não encontrado."));
    requirePerm(ch.serverId, "manageChannels", NX.i18n.get("api.voceNaoTemPermissao19", "Você não tem permissão para alterar permissões."));
    ch.inheritPerms = !!inherit;
    NX.store.commit(["channels"]);
    return ch;
  };

  api.deleteChannel = async function (channelId) {
    await delay();
    const ch = S().channel(channelId);
    if (!ch) fail(NX.i18n.get("api.canalNaoEncontrado6", "Canal não encontrado."));
    requirePerm(ch.serverId, "manageChannels", NX.i18n.get("api.voceNaoTemPermissao20", "Você não tem permissão para apagar canais."));
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
    if (list.length > 4) fail(NX.i18n.get("api.envieMaximo4Anexos", "Envie no máximo 4 anexos por mensagem."));
    return list.slice(0, 4).map((a) => {
      const type = ATTACH_TYPES.indexOf(a.type) !== -1 ? a.type : "file";
      const url = String(a.url || "");
      if (url.length > 1600000) fail(NX.i18n.get("api.esteArquivoGrandeDemais", "Este arquivo é grande demais (máximo 1,5 MB)."));
      if (!/^(data:image\/|data:video\/|blob:|https?:\/\/)/i.test(url))
        fail(NX.i18n.get("api.formatoArquivoNaoSuportado", "Formato de arquivo não suportado."));
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
    if (!me) fail(NX.i18n.get("api.suaSessaoExpirouEntre8", "Sua sessão expirou. Entre novamente."));
    opts = opts || {};
    const text = String(content || "").trim();
    const attachments = sanitizeAttachments(opts.attachments);
    if (!text && !attachments.length) fail("");
    if (text.length > 2000) fail(NX.i18n.get("api.mensagensPodemTerMaximo", "As mensagens podem ter no máximo 2000 caracteres."));

    const isDM = String(ref).indexOf("dm_") === 0;
    let dmOtherId = null;
    if (isDM) {
      const dm = db().dms[ref];
      if (!dm || dm.participants.indexOf(me.id) === -1) fail(NX.i18n.get("api.conversaNaoEncontrada3", "Conversa não encontrada."));
      dmOtherId = dm.participants.find((p) => p !== me.id) || null;
      if (dmOtherId && S().isBlocked(dmOtherId, me.id))
        fail(NX.i18n.get("api.voceNaoPodeEnviar", "Você não pode enviar mensagens para esta pessoa."));
      if (dmOtherId && S().isBlocked(me.id, dmOtherId))
        fail(NX.i18n.get("api.desbloqueieEstaPessoaVoltar", "Desbloqueie esta pessoa para voltar a conversar."));
      /* revalida a privacidade do DONO quando a conversa ainda não tem
         histórico: impede abrir uma DM nova burlando a regra.
         Com histórico, a conversa já iniciada continua válida. */
      if (dmOtherId && !S().messagesOf(ref).length && !S().canDM(me.id, dmOtherId)) {
        const mode = ((S().user(dmOtherId) || {}).privacy || {}).dm || "all";
        fail(
          mode === "none"
            ? NX.i18n.get("api.pessoaNaoRecebeDiretas", "Esta pessoa não recebe mensagens diretas.")
            : mode === "friends"
              ? NX.i18n.get("api.pessoaSoAceitaAmigos", "Esta pessoa só aceita mensagens de amigos.")
              : NX.i18n.get("api.pessoaSoAceitaQuemSegue", "Esta pessoa só aceita mensagens de quem a segue.")
        );
      }
    } else {
      const ch = S().channel(ref);
      if (!ch) fail(NX.i18n.get("api.esteCanalNaoExiste2", "Este canal não existe mais."));
      if (!S().canSendIn(ch, me.id))
        fail(NX.i18n.get("api.voceNaoPodeEnviar2", "Você não pode enviar mensagens neste canal."));
      const p = S().effectiveChannelPerms(ch, me.id);
      if (attachments.length && !p.attachFiles)
        fail(NX.i18n.get("api.seuCargoNaoTem", "Seu cargo não tem a permissão “Anexar arquivos” aqui."));
      if (attachments.some((a) => a.type === "gif") && !p.useGifs)
        fail(NX.i18n.get("api.seuCargoNaoTem2", "Seu cargo não tem a permissão “Usar GIFs” aqui."));
      if (!text && attachments.length && !p.useEmojis)
        fail(NX.i18n.get("api.seuCargoNaoPode", "Seu cargo não pode enviar mídia sem texto neste canal."));
    }

    const m = {
      id: u().uid("ms"),
      channelId: ref,
      authorId: me.id,
      /* alias de leitura: a mesma mensagem atende a canais e a DMs */
      conversationId: ref,
      senderId: me.id,
      content: text.slice(0, 2000),
      attachments: attachments,
      reactions: {},
      pinned: false,
      createdAt: Date.now(),
      updatedAt: null,
    };
    db().messages[m.id] = m;

    if (isDM && dmOtherId) {
      const dmRow = db().dms[ref];
      if (dmRow) {
        /* o autor já "leu" o que acabou de enviar */
        dmRow.reads = dmRow.reads || {};
        dmRow.reads[me.id] = m.createdAt;
        /* notificação real para o OUTRO participante — nunca para mim.
           Conversa silenciada não gera notificação. */
        if (!dmRow.muted) {
          notify(
            dmOtherId,
            "dm",
            "@" + me.username + " " + NX.i18n.get("api.enviouUmaMensagem", "enviou uma mensagem."),
            { href: "#/mensagens/" + ref, actorId: me.id, messageId: m.id }
          );
        }
      }
      NX.store.commit(["messages", "notifications"]);
      return m;
    }

    NX.store.commit(["messages"]);
    return m;
  };

  /* marca a conversa como lida para mim (cursor por participante).
     Sincrono de propósito: é chamada na abertura da rota e precisa
     acontecer antes do render, sem esperar o delay da API. */
  api.markDMRead = function (dmId) {
    const me = S().me();
    if (!me || !dmId) return false;
    const dm = db().dms[dmId];
    if (!dm || dm.participants.indexOf(me.id) === -1) return false;
    if (!S().dmUnreadFor(dm, me.id)) return false; /* já lida: nada a fazer */
    dm.reads = dm.reads || {};
    dm.reads[me.id] = Date.now();
    NX.store.commit(["messages"]);
    return true;
  };

  /* busca de PESSOAS REAIS para adicionar como amigo.
     Casa com @username, nome exibido ou o User ID completo.
     Nunca devolve a própria conta nem alguém bloqueado. */
  api.searchPeople = async function (query, limit) {
    await delay();
    const me = requireMe();
    const raw = String(query || "").trim();
    if (!raw) return [];
    const q = raw.toLowerCase();
    const max = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 25);
    const norm = (s) => String(s || "").toLowerCase();

    return Object.values(db().users)
      .filter((u) => u && S().isRealPerson(u.id))
      .filter((u) => u.id !== me.id)
      .filter((u) => !S().blockedBetween(me.id, u.id))
      .map((u) => {
        const un = norm(u.username);
        const dn = norm(u.displayName);
        let rank = -1;
        if (un === q || norm(u.id) === q) rank = 0;
        else if (un.indexOf(q) === 0) rank = 1;
        else if (un.indexOf(q) > -1) rank = 2;
        else if (dn.indexOf(q) > -1) rank = 3;
        return { u: u, rank: rank };
      })
      .filter((x) => x.rank > -1)
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          String(a.u.displayName || "").localeCompare(String(b.u.displayName || ""))
      )
      .slice(0, max)
      .map((x) => x.u);
  };

  api.editMessage = async function (messageId, content) {
    await delay();
    const me = S().me();
    const m = db().messages[messageId];
    if (!m) fail(NX.i18n.get("api.mensagemNaoEncontrada7", "Mensagem não encontrada."));
    const isMine = m.authorId === me.id;
    if (!isMine) {
      const ch = S().channel(m.channelId);
      if (!ch) fail(NX.i18n.get("api.mensagemNaoEncontrada7", "Mensagem não encontrada."));
      if (!S().channelPerm(ch, me.id, "editMessages"))
        fail(NX.i18n.get("api.voceNaoTemPermissao21", "Você não tem permissão para editar mensagens de outras pessoas."));
    }
    const text = String(content || "").trim();
    if (!text) fail(NX.i18n.get("api.mensagemNaoPodeFicar", "A mensagem não pode ficar vazia."));
    m.content = text.slice(0, 2000);
    m.updatedAt = Date.now();
    NX.store.commit(["messages"]);
    return m;
  };

  api.deleteMessage = async function (messageId) {
    await delay();
    const me = S().me();
    const m = db().messages[messageId];
    if (!m) fail(NX.i18n.get("api.mensagemNaoEncontrada7", "Mensagem não encontrada."));
    const isMine = m.authorId === me.id;
    if (!isMine) {
      const ch = S().channel(m.channelId);
      if (!ch) fail(NX.i18n.get("api.mensagemNaoEncontrada7", "Mensagem não encontrada."));
      if (!S().channelPerm(ch, me.id, "deleteMessages"))
        fail(NX.i18n.get("api.voceNaoTemPermissao22", "Você não tem permissão para apagar mensagens de outras pessoas."));
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
    if (!m) fail(NX.i18n.get("api.mensagemNaoEncontrada7", "Mensagem não encontrada."));
    const key = String(emoji || "").slice(0, 12);
    if (!key) fail("");
    if (String(m.channelId).indexOf("dm_") === 0) {
      const dm = db().dms[m.channelId];
      if (!dm || dm.participants.indexOf(me.id) === -1) fail(NX.i18n.get("api.conversaNaoEncontrada3", "Conversa não encontrada."));
      if (S().blockedBetween(m.authorId, me.id) && m.authorId !== me.id)
        fail(NX.i18n.get("api.voceNaoPodeReagir", "Você não pode reagir nesta conversa."));
    } else {
      const ch = S().channel(m.channelId);
      if (!ch) fail(NX.i18n.get("api.esteCanalNaoExiste2", "Este canal não existe mais."));
      if (!S().canSendIn(ch, me.id)) fail(NX.i18n.get("api.voceNaoPodeReagir2", "Você não pode reagir neste canal."));
      if (!S().channelPerm(ch, me.id, "useEmojis"))
        fail(NX.i18n.get("api.seuCargoNaoTem3", "Seu cargo não tem a permissão “Usar emojis” aqui."));
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
    if (!m) fail(NX.i18n.get("api.mensagemNaoEncontrada7", "Mensagem não encontrada."));
    const ch = S().channel(m.channelId);
    if (!ch) fail(NX.i18n.get("api.estaMensagemNaoEsta", "Esta mensagem não está em um canal."));
    const mine = m.authorId === me.id;
    if (!mine && !S().channelPerm(ch, me.id, "pinMessages"))
      fail(NX.i18n.get("api.voceNaoTemPermissao23", "Você não tem permissão para fixar mensagens de outras pessoas."));
    if (!S().canSendIn(ch, me.id)) fail(NX.i18n.get("api.voceNaoTemPermissao24", "Você não tem permissão neste canal."));
    m.pinned = pin !== false;
    log(ch.serverId, "message.pin", { channel: "#" + ch.name, pinned: m.pinned });
    NX.store.commit(["messages"]);
    return m;
  };

  api.reportMessage = async function (messageId, reason) {
    await delay();
    const me = S().me();
    const m = db().messages[messageId];
    if (!m) fail(NX.i18n.get("api.mensagemNaoEncontrada7", "Mensagem não encontrada."));
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
    requirePerm(serverId, "createInvite", NX.i18n.get("adm.voceNaoTemPermissao3", "Você não tem permissão para criar convites."));
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
    if (!invite) fail(NX.i18n.get("api.esteConviteNaoExiste2", "Este convite não existe mais."));
    const me = S().me();
    if (invite.creatorId !== me.id)
      requirePerm(invite.serverId, "manageServer", NX.i18n.get("api.voceNaoPodeRevogar", "Você não pode revogar este convite."));
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
    if (!me || !other) fail(NX.i18n.get("api.usuarioNaoEncontrado2", "Usuário não encontrado."));
    if (userId === me.id) fail(NX.i18n.get("api.voceNaoPodeConversar", "Você não pode conversar consigo mesmo."));
    if (S().isBlocked(me.id, userId)) fail(NX.i18n.get("api.desbloqueieEstaPessoaPrimeiro", "Desbloqueie esta pessoa primeiro."));
    const id = S().dmId(me.id, userId);
    /* privacidade "quem pode enviar DM" do DONO da conversa */
    if (!db().dms[id] && !S().canDM(me.id, userId)) {
      const mode = ((other.privacy || {}).dm) || "all";
      fail(
        mode === "none"
          ? NX.i18n.get("api.estaPessoaNaoRecebe", "Esta pessoa não recebe mensagens diretas.")
          : mode === "friends"
          ? NX.i18n.get("api.estaPessoaSoAceita", "Esta pessoa só aceita mensagens de amigos.")
          : NX.i18n.get("api.estaPessoaSoAceita2", "Esta pessoa só aceita mensagens de quem a segue.")
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
    if (!me || !other) fail(NX.i18n.get("api.usuarioNaoEncontrado2", "Usuário não encontrado."));
    if (userId === me.id) fail(NX.i18n.get("api.voceNaoPodeBloquear", "Você não pode bloquear a si mesmo."));
    if (!me.blocks) me.blocks = [];
    if (me.blocks.indexOf(userId) === -1) me.blocks.push(userId);
    NX.store.commit(["profile", "members"]);
    return true;
  };

  api.unblockUser = async function (userId) {
    await delay();
    const me = S().me();
    if (!me) fail(NX.i18n.get("api.suaSessaoExpirou", "Sua sessão expirou."));
    me.blocks = (me.blocks || []).filter((x) => x !== userId);
    NX.store.commit(["profile", "members"]);
    return true;
  };

  api.muteDM = async function (dmId, muted) {
    await delay();
    const dm = db().dms[dmId];
    if (!dm) fail(NX.i18n.get("api.conversaNaoEncontrada3", "Conversa não encontrada."));
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
    requirePerm(serverId, "manageChannels", NX.i18n.get("api.voceNaoTemPermissao26", "Você não tem permissão para adicionar emojis."));
    const name = u().slug(String(data.name || "")).replace(/-/g, "");
    if (name.length < 2) fail(NX.i18n.get("api.nomePeloMenos26", "Dê um nome com pelo menos 2 caracteres ao emoji."));
    if (Object.values(db().emojis || {}).some((e) => e.serverId === serverId && e.name === name))
      fail(NX.i18n.get("api.jaExisteEmojiEsse", "Já existe um emoji com esse nome."));
    const image = String(data.image || "");
    if (!/^data:image\//.test(image)) fail((NX.i18n.get("api.envieumaimagemvalida", "Envie uma imagem válida.")));
    if (image.length > 900000) fail(NX.i18n.get("api.estaImagemGrandeDemais3", "Esta imagem é grande demais (máximo 1 MB)."));
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
    if (!e) fail(NX.i18n.get("api.emojiNaoEncontrado", "Emoji não encontrado."));
    requirePerm(e.serverId, "manageChannels", NX.i18n.get("api.voceNaoTemPermissao27", "Você não tem permissão para remover emojis."));
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
    if (!ch || ch.type !== "voice") fail(NX.i18n.get("api.canalVozNaoEncontrado2", "Canal de voz não encontrado."));
    if (!S().can(ch.serverId, me.id, "joinVoice"))
      fail(NX.i18n.get("api.voceNaoTemPermissao28", "Você não tem permissão para entrar em canais de voz."));
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
     CONVITES DE CHAMADA DE VOZ
     ---------------------------------------------------------
     Regras:
       • quem CONVIDA precisa da permissão "inviteToVoice"
         no canal (respeita overrides de canal/categoria);
       • quem RECEBE precisa ser membro do servidor e poder
         VER + CONECTAR no canal — senão o convite é recusado;
       • bloqueios mútuos são respeitados;
       • só usuários reais (nada de bots/NPCs);
       • um convite pendente por pessoa/canal (nunca duplica);
       • convite expira em 30 minutos.
     ========================================================= */
  const VOICE_INVITE_TTL = 30 * 60 * 1000;

  function findPerson(q) {
    const raw = String(q || "").trim();
    if (!raw) return null;
    return S().user(raw) || S().userByUsername(raw) || null;
  }

  function voiceGate(channel, viewerId) {
    if (!channel || channel.type !== "voice")
      return { ok: false, reason: NX.i18n.get("api.canalVozNaoEncontrado2", "Canal de voz não encontrado.") };
    if (!S().canViewChannel(channel, viewerId))
      return { ok: false, reason: NX.i18n.get("api.voceNaoTemPermissao29", "Você não tem permissão para ver este canal.") };
    if (!S().channelPerm(channel, viewerId, "inviteToVoice"))
      return {
        ok: false,
        reason: NX.i18n.get("api.voceNaoTemPermissao30", "Você não tem permissão para convidar pessoas para chamadas."),
      };
    return { ok: true, reason: "" };
  }

  function canEnterVoice(channel, userId) {
    if (!S().membership(channel.serverId, userId)) return false;
    if (S().banOf(channel.serverId, userId)) return false;
    if (!S().channelPerm(channel, userId, "viewChannels")) return false;
    if (!S().channelPerm(channel, userId, "joinVoice")) return false;
    return true;
  }

  function connectToVoice(channel) {
    const me = S().me();
    db().voice = db().voice.filter((v) => v.userId !== me.id);
    db().voice.push({ channelId: channel.id, userId: me.id, joinedAt: Date.now() });
  }

  /* 1) enviar convite (busca por @username, username ou ID) */
  api.inviteToVoice = async function (channelId, userIdOrName) {
    await delay();
    const me = S().me();
    if (!me) fail(NX.i18n.get("api.entreSuaContaConvidar", "Entre na sua conta para convidar alguém."));
    const ch = S().channel(channelId);
    const gate = voiceGate(ch, me.id);
    if (!gate.ok) fail(gate.reason);

    const target = findPerson(userIdOrName);
    if (!target || !S().isRealPerson(target.id))
      fail(NX.i18n.get("api.naoEncontramosNinguemEsse", "Não encontramos ninguém com esse @username ou ID."));
    if (target.id === me.id) fail(NX.i18n.get("api.voceJaEstaNesta", "Você já está nesta chamada."));
    if (S().blockedBetween(me.id, target.id))
      fail(NX.i18n.get("api.naoPossivelEnviarConvites", "Não é possível enviar convites entre contas bloqueadas."));
    if (!S().membership(ch.serverId, target.id))
      fail(NX.i18n.get("api.essaPessoaNaoEsta", "Essa pessoa não está neste servidor."));
    if (!canEnterVoice(ch, target.id))
      fail(NX.i18n.get("api.essaPessoaNaoTem", "Essa pessoa não tem permissão para entrar neste canal."));

    const dup = Object.values(db().voiceInvites || {}).find(
      (v) =>
        v.status === "pending" &&
        v.channelId === ch.id &&
        v.toUserId === target.id &&
        v.fromUserId === me.id &&
        Date.now() - v.createdAt < VOICE_INVITE_TTL
    );
    if (dup) fail(NX.i18n.get("api.voceJaEnviouConvite", "Você já enviou um convite de chamada para esta pessoa."));

    const inv = {
      id: u().uid("vi"),
      channelId: ch.id,
      serverId: ch.serverId,
      toUserId: target.id,
      fromUserId: me.id,
      status: "pending",
      createdAt: Date.now(),
    };
    db().voiceInvites[inv.id] = inv;

    notify(
      target.id,
      "voice",
      "👥 " + me.displayName + (" " + NX.i18n.get("api.convidouvoceparaentrarnasala", "convidou você para entrar na sala de voz") + " ") + ch.name + ".",
      {
        voiceInviteId: inv.id,
        channelId: ch.id,
        serverId: ch.serverId,
        fromId: me.id,
        href: "#/s/" + ch.serverId + "/" + ch.id,
      }
    );
    NX.store.commit(["notifications", "voice"]);
    return inv;
  };

  /* 2) responder (aceitar/recusar) */
  api.respondVoiceInvite = async function (inviteId, accept) {
    await delay();
    const me = S().me();
    if (!me) fail(NX.i18n.get("api.entreSuaConta5", "Entre na sua conta."));
    const inv = S().voiceInvite(inviteId);
    if (!inv) fail(NX.i18n.get("api.esteConviteNaoExiste2", "Este convite não existe mais."));
    if (inv.toUserId !== me.id) fail(NX.i18n.get("api.esteConviteNaoVoce", "Este convite não é para você."));
    if (inv.status !== "pending") fail(NX.i18n.get("api.esteConviteJaFoi", "Este convite já foi respondido."));
    if (Date.now() - inv.createdAt > VOICE_INVITE_TTL) {
      inv.status = "expired";
      NX.store.commit(["voice", "notifications"]);
      fail(NX.i18n.get("api.esteConviteExpirouPeca2", "Este convite expirou. Peça um novo."));
    }

    /* a notificação correspondente deixa de exigir resposta */
    (db().notifications || []).forEach((n) => {
      if (n.meta && n.meta.voiceInviteId === inv.id) n.read = true;
    });

    if (!accept) {
      inv.status = "declined";
      inv.respondedAt = Date.now();
      NX.store.commit(["voice", "notifications"]);
      return { accepted: false };
    }

    const ch = S().channel(inv.channelId);
    if (!ch) {
      inv.status = "expired";
      NX.store.commit(["voice", "notifications"]);
      fail(NX.i18n.get("api.estaSalaVozNao2", "Esta sala de voz não existe mais."));
    }
    if (!canEnterVoice(ch, me.id)) {
      NX.store.commit(["notifications"]);
      fail(NX.i18n.get("api.voceNaoTemPermissao32", "Você não tem permissão para entrar neste canal."));
    }

    inv.status = "accepted";
    inv.respondedAt = Date.now();
    connectToVoice(ch);
    if (inv.fromUserId !== me.id)
      notify(
        inv.fromUserId,
        "voice",
        "✅ " + me.displayName + (" " + NX.i18n.get("api.entrounasaladevoz", "entrou na sala de voz") + " ") + ch.name + ".",
        { channelId: ch.id, serverId: ch.serverId, href: "#/s/" + ch.serverId + "/" + ch.id }
      );
    NX.store.commit(["voice", "notifications", "channels", "route"]);
    return { accepted: true, serverId: ch.serverId, channelId: ch.id };
  };

  /* 3) convite direto por link ("Copiar convite da call") */
  api.createVoiceLink = async function (channelId) {
    await delay();
    const me = S().me();
    if (!me) fail(NX.i18n.get("api.entreSuaConta5", "Entre na sua conta."));
    const ch = S().channel(channelId);
    const gate = voiceGate(ch, me.id);
    if (!gate.ok) fail(gate.reason);

    const existing = Object.values(db().invites || {}).find(
      (i) => i.kind === "voice" && i.channelId === ch.id && i.creatorId === me.id
    );
    if (existing) return existing;

    const invite = {
      code: newInviteCode(),
      kind: "voice",
      serverId: ch.serverId,
      channelId: ch.id,
      creatorId: me.id,
      createdAt: Date.now(),
      uses: 0,
      maxUses: 0,
      expiresAt: null,
    };
    db().invites[invite.code] = invite;
    NX.store.commit(["invites"]);
    return invite;
  };

  /* 4) abrir um convite de voz pelo link e entrar na call */
  api.acceptVoiceLink = async function (code) {
    await delay();
    const me = S().me();
    if (!me) fail(NX.i18n.get("api.entreSuaContaEntrar2", "Entre na sua conta para entrar na chamada."));
    const clean = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const invite = S().invite(clean);
    if (!invite || invite.kind !== "voice")
      fail(NX.i18n.get("api.conviteChamadaInvalidoExpirado", "Convite de chamada inválido ou expirado."));
    const server = S().server(invite.serverId);
    const ch = S().channel(invite.channelId);
    if (!server || !ch) fail(NX.i18n.get("api.estaSalaVozNao2", "Esta sala de voz não existe mais."));
    if (!S().membership(invite.serverId, me.id))
      fail(NX.i18n.get("api.entreServidorPrimeiroParticipar", "Entre no servidor primeiro para participar desta chamada."));
    if (!S().canViewChannel(ch, me.id) || !canEnterVoice(ch, me.id))
      fail(NX.i18n.get("api.voceNaoTemPermissao32", "Você não tem permissão para entrar neste canal."));
    connectToVoice(ch);
    invite.uses = (invite.uses || 0) + 1;
    NX.store.commit(["voice", "invites"]);
    return { serverId: invite.serverId, channelId: ch.id };
  };

  /* =========================================================
     CONTROLE DE MÍDIA DA CALL
     ---------------------------------------------------------
     Estado real de cada participante gravado em db.voice:
       mic (false = mutado) · cam (câmera ligada) ·
       screen (compartilhando tela) · speaking (falando)
     Regras:
       • cada um mexe no próprio estado;
       • mutar OUTRO exige "muteMembers";
       • remover OUTRO exige "moveMembers" ou admin/dono;
       • o volume é preferência local de quem assiste.
     ========================================================= */
  function myVoiceRow(channelId) {
    const me = S().me();
    if (!me) return null;
    return db().voice.find((v) => v.channelId === channelId && v.userId === me.id) || null;
  }

  function voiceRowOf(channelId, userId) {
    return db().voice.find((v) => v.channelId === channelId && v.userId === userId) || null;
  }

  const OWN_STATE_KEYS = ["mic", "cam", "screen", "speaking"];

  /* estado de MIM mesmo (microfone, câmera, tela, falando) */
  api.setVoiceState = async function (channelId, patch) {
    await delay();
    const me = S().me();
    if (!me) fail(NX.i18n.get("api.entreSuaConta5", "Entre na sua conta."));
    const row = myVoiceRow(channelId);
    if (!row) fail(NX.i18n.get("api.voceNaoEstaNesta", "Você não está nesta chamada."));
    const clean = {};
    OWN_STATE_KEYS.forEach((k) => {
      if (patch && patch[k] !== undefined) clean[k] = !!patch[k];
    });
    Object.keys(clean).forEach((k) => (row[k] = clean[k]));
    /* microfone desligado nunca pode aparecer "falando" */
    if (row.mic === false) row.speaking = false;
    NX.store.commit(["voice"]);
    return row;
  };

  /* estado de OUTRO participante (moderação) */
  api.setOtherVoiceState = async function (channelId, userId, patch) {
    await delay();
    const me = S().me();
    if (!me) fail(NX.i18n.get("api.entreSuaConta5", "Entre na sua conta."));
    const server = S().server((S().channel(channelId) || {}).serverId);
    if (!server) fail(NX.i18n.get("api.canalNaoEncontrado6", "Canal não encontrado."));
    if (userId === me.id) return api.setVoiceState(channelId, patch);

    const canModerate =
      server.ownerId === me.id ||
      S().can(server.id, me.id, "administrator") ||
      S().can(server.id, me.id, "muteMembers");
    if (!canModerate)
      fail(NX.i18n.get("api.voceNaoTemPermissao33", "Você não tem permissão para silenciar participantes da chamada."));

    const row = voiceRowOf(channelId, userId);
    if (!row) fail(NX.i18n.get("api.estaPessoaNaoEsta", "Esta pessoa não está mais na chamada."));

    if (patch && patch.mic === false) {
      row.mic = false;
      row.speaking = false;
      notify(
        userId,
        "voice",
        "🔇 " + me.displayName + (" " + NX.i18n.get("api.silenciouvocenasaladevoz", "silenciou você na sala de voz") + " ") + S().channel(channelId).name + ".",
        { channelId: channelId, serverId: server.id, href: "#/s/" + server.id + "/" + channelId }
      );
    } else if (patch && patch.mic === true) {
      row.mic = true;
      notify(
        userId,
        "voice",
        "🔊 " + me.displayName + (" " + NX.i18n.get("api.reativouseumicrofonenasalade", "reativou seu microfone na sala de voz") + " ") + S().channel(channelId).name + ".",
        { channelId: channelId, serverId: server.id, href: "#/s/" + server.id + "/" + channelId }
      );
    }
    NX.store.commit(["voice", "notifications"]);
    return row;
  };

  /* remover alguém da call */
  api.removeFromVoice = async function (channelId, userId) {
    await delay();
    const me = S().me();
    if (!me) fail(NX.i18n.get("api.entreSuaConta5", "Entre na sua conta."));
    const server = S().server((S().channel(channelId) || {}).serverId);
    if (!server) fail(NX.i18n.get("api.canalNaoEncontrado6", "Canal não encontrado."));
    const canRemove =
      server.ownerId === me.id ||
      S().can(server.id, me.id, "administrator") ||
      S().can(server.id, me.id, "moveMembers");
    if (!canRemove) fail(NX.i18n.get("api.voceNaoTemPermissao34", "Você não tem permissão para remover participantes da chamada."));
    if (userId === me.id) fail(NX.i18n.get("api.useBotaoDesconectarSair", "Use o botão Desconectar para sair da chamada."));

    const row = voiceRowOf(channelId, userId);
    if (!row) fail(NX.i18n.get("api.estaPessoaNaoEsta2", "Esta pessoa não está na chamada."));
    db().voice = db().voice.filter((v) => !(v.channelId === channelId && v.userId === userId));
    const ch = S().channel(channelId);
    notify(
      userId,
      "voice",
      "🔌 " + me.displayName + (" " + NX.i18n.get("api.removeuvocedasaladevoz", "removeu você da sala de voz") + " ") + ch.name + ".",
      { channelId: channelId, serverId: server.id, href: "#/s/" + server.id + "/" + channelId }
    );
    log(serverId_of(ch), "member.voice.remove", { userId: userId });
    NX.store.commit(["voice", "notifications"]);
    return true;
  };

  /* volume: preferência LOCAL de quem escuta (nunca mexe no outro) */
  api.setVoiceVolume = async function (userId, value) {
    const v = Math.max(0, Math.min(200, Math.round(Number(value) || 0)));
    NX.store.ui.voiceVolume = NX.store.ui.voiceVolume || {};
    NX.store.ui.voiceVolume[userId] = v;
    NX.store.persistUI();
    return v;
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
    if (!me) fail(NX.i18n.get("api.suaSessaoExpirouEntre8", "Sua sessão expirou. Entre novamente."));
    return me;
  }

  function requireUser(userId) {
    const usr = S().user(userId);
    if (!usr) fail(NX.i18n.get("api.esteUsuarioNaoExiste", "Este usuário não existe mais."));
    return usr;
  }

  function privacyOf(usr) {
    const p = (usr && usr.privacy) || {};
    return {
      follow: p.follow === "approved" ? "approved" : "all",
      dm: ["all", "friends", "followers", "none"].indexOf(p.dm) > -1 ? p.dm : "all",
      followers: ["all", "followers", "self"].indexOf(p.followers) > -1 ? p.followers : "all",
      likes: ["all", "followers", "self"].indexOf(p.likes) > -1 ? p.likes : "all",
      posts: ["public", "followers", "self"].indexOf(p.posts) > -1 ? p.posts : "public",
      friendRequests:
        ["all", "common", "none"].indexOf(p.friendRequests) > -1 ? p.friendRequests : "all",
    };
  }

  /* recalcula o cache de contadores de um usuário */
  function recount(userId) {
    const usr = S().user(userId);
    if (!usr) return;
    usr.followersCount = S().followerCount(userId);
    usr.followingCount = S().followingCount(userId);
    usr.likesReceived = S().likesReceivedOf(userId);
    usr.friendsCount = S().friendCount(userId);
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
    if (target.id === me.id) fail(NX.i18n.get("api.voceNaoPodeSeguir", "Você não pode seguir a si mesmo."));

    const existing = S().followEdge(me.id, target.id);
    if (existing && existing.state === "active") fail(NX.i18n.get("api.voceJaSegueEsta", "Você já segue esta pessoa."));
    if (existing && existing.state === "pending")
      fail(NX.i18n.get("api.solicitacaoSeguimentoJaFoi", "A solicitação de seguimento já foi enviada."));

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
      fail(NX.i18n.get("api.naoFoiPossivelSalvar4", "Não foi possível salvar neste navegador (armazenamento bloqueado)."));
    }

    if (allowAll) {
      recount(target.id);
      recount(me.id);
      socialNotify(target.id, "follow", "@" + me.username + (" " + NX.i18n.get("api.comecouaseguirvoce", "começou a seguir você.")), "#/perfil/" + me.username);
      NX.store.commit(SOCIAL_SCOPES);
      return { state: "active", followers: target.followersCount };
    }

    socialNotify(
      target.id,
      "follow_request",
      "@" + me.username + (" " + NX.i18n.get("api.solicitouseguirvoce", "solicitou seguir você.")),
      "#/perfil/" + me.username
    );
    recount(me.id);
    NX.store.commit(SOCIAL_SCOPES);
    return { state: "pending", followers: target.followersCount };
  };

  api.unfollowUser = async function (userId) {
    await delay();
    const me = requireMe();
    const target = requireUser(userId);
    const id = me.id + ">" + target.id;
    const edge = db().follows[id];
    if (!edge) fail(NX.i18n.get("api.voceNaoSegueEsta", "Você não segue esta pessoa."));

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
    if (!edge || edge.state !== "pending") fail(NX.i18n.get("api.naoHaSolicitacaoSeguimento2", "Não há solicitação de seguimento pendente."));
    edge.state = "active";
    edge.approvedAt = Date.now();
    NX.store.persist();
    recount(me.id);
    recount(followerId);
    socialNotify(
      followerId,
      "follow_request",
      "@" + me.username + (" " + NX.i18n.get("api.aceitousuasolicitacaodeseguimento", "aceitou sua solicitação de seguimento.")),
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
      fail(NX.i18n.get("api.naoHaSolicitacaoSeguimento2", "Não há solicitação de seguimento pendente."));
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
    if (media.tooBig) fail(NX.i18n.get("api.esteArquivoGrandeDemais2", "Este arquivo é grande demais (máximo 900 KB)."));
    if (!content && !media.list.length) fail(NX.i18n.get("api.escrevaAlgumaCoisaAnexe", "Escreva alguma coisa ou anexe uma imagem/vídeo."));
    if (content.length > 2000) fail(NX.i18n.get("api.publicacaoPodeTerMaximo", "A publicação pode ter no máximo 2.000 caracteres."));

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
      fail(NX.i18n.get("api.naoFoiPossivelSalvar4", "Não foi possível salvar neste navegador (armazenamento bloqueado)."));
    }
    NX.store.commit(SOCIAL_SCOPES);
    return db().posts[id];
  };

  api.deletePost = async function (postId) {
    await delay();
    const me = requireMe();
    const post = S().post(postId);
    if (!post) fail(NX.i18n.get("api.estaPublicacaoNaoExiste2", "Esta publicação não existe mais."));
    if (post.authorId !== me.id) fail(NX.i18n.get("api.voceSoPodeExcluir", "Você só pode excluir as suas publicações."));

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
    if (LIKE_KINDS.indexOf(targetType) === -1) fail(NX.i18n.get("api.conteudoInvalido2", "Conteúdo inválido."));
    const target = likeTarget(targetType, targetId);
    if (!target) fail(NX.i18n.get("api.esteConteudoNaoExiste", "Este conteúdo não existe mais."));

    const likeId = [targetType, targetId, me.id].join(":");
    if (db().likes[likeId]) fail(NX.i18n.get("api.voceJaCurtiuEste", "Você já curtiu este conteúdo.")); /* anti-duplicidade */

    db().likes[likeId] = {
      id: likeId,
      userId: me.id,
      targetType: targetType,
      targetId: targetId,
      createdAt: Date.now(),
    };
    if (!NX.store.persist()) {
      delete db().likes[likeId];
      fail(NX.i18n.get("api.naoFoiPossivelSalvar4", "Não foi possível salvar neste navegador (armazenamento bloqueado)."));
    }

    if (targetType !== "message") target.likesCount = S().likeCount(targetType, targetId);

    const owner = likeOwner(target);
    const ownerId = owner ? owner.id : null;
    if (ownerId) recount(ownerId);
    if (ownerId && ownerId !== me.id) {
      const what =
        targetType === "post" ? (NX.i18n.get("api.publicacao", "publicação")) : targetType === "comment" ? (NX.i18n.get("api.comentario", "comentário")) : "mensagem";
      socialNotify(ownerId, "like", "@" + me.username + (" " + NX.i18n.get("api.curtiuseu", "curtiu seu") + " ") + what + ".", likeHref(targetType, targetId));
    }

    NX.store.commit(SOCIAL_SCOPES);
    return { liked: true, count: S().likeCount(targetType, targetId) };
  };

  api.unlikeContent = async function (targetType, targetId) {
    await delay();
    const me = requireMe();
    if (LIKE_KINDS.indexOf(targetType) === -1) fail(NX.i18n.get("api.conteudoInvalido2", "Conteúdo inválido."));
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
    if (!post) fail(NX.i18n.get("api.estaPublicacaoNaoExiste2", "Esta publicação não existe mais."));
    if (!S().canViewPostsOf(me.id, post.authorId)) fail(NX.i18n.get("api.voceNaoPodeComentar", "Você não pode comentar esta publicação."));

    const text = String(content || "").trim();
    if (!text) fail(NX.i18n.get("api.escrevaComentario", "Escreva um comentário."));
    if (text.length > 500) fail(NX.i18n.get("api.comentarioPodeTerMaximo", "O comentário pode ter no máximo 500 caracteres."));

    let parent = null;
    if (parentId) {
      parent = S().comment(parentId);
      if (!parent || parent.postId !== postId) fail(NX.i18n.get("api.comentarioRespostaNaoEncontrado", "Comentário de resposta não encontrado."));
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
      fail(NX.i18n.get("api.naoFoiPossivelSalvar4", "Não foi possível salvar neste navegador (armazenamento bloqueado)."));
    }

    post.commentsCount = S().commentsOf(postId).length;
    const href = hrefForPost(postId);

    if (parent && parent.authorId !== me.id) {
      socialNotify(parent.authorId, "reply", "@" + me.username + (" " + NX.i18n.get("api.respondeuseucomentario", "respondeu seu comentário.")), href);
    } else if (post.authorId !== me.id) {
      socialNotify(post.authorId, "comment", "@" + me.username + (" " + NX.i18n.get("api.comentousuapublicacao", "comentou sua publicação.")), href);
    }

    NX.store.commit(SOCIAL_SCOPES);
    return db().comments[id];
  };

  api.deleteComment = async function (commentId) {
    await delay();
    const me = requireMe();
    const c = S().comment(commentId);
    if (!c) fail(NX.i18n.get("api.esteComentarioNaoExiste", "Este comentário não existe mais."));
    if (c.authorId !== me.id) fail(NX.i18n.get("api.voceSoPodeExcluir2", "Você só pode excluir os seus comentários."));

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
      dm: ["all", "friends", "followers", "none"],
      followers: ["all", "followers", "self"],
      likes: ["all", "followers", "self"],
      posts: ["public", "followers", "self"],
      friendRequests: ["all", "common", "none"],
      country: ["all", "friends", "none"],
    };
    const current = privacyOf(me);
    Object.keys(VALID).forEach((k) => {
      if (patch && patch[k] !== undefined) {
        if (VALID[k].indexOf(patch[k]) === -1) fail(NX.i18n.get("api.opcaoPrivacidadeInvalida2", "Opção de privacidade inválida."));
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
      if (!me || me.id !== owner.id) fail(NX.i18n.get("api.soVocePodeVer", "Só você pode ver quem pediu para seguir você."));
      return S().followRequestsOf(owner.id).map((x) => x.user);
    }
    if (!S().canViewFollowersOf(me ? me.id : null, owner.id))
      fail(NX.i18n.get("api.estaPessoaMantemSua", "Esta pessoa mantém sua lista de seguidores privada."));
    return kind === "following" ? S().followingOf(owner.id) : S().followersOf(owner.id);
  };

  /* ❤️ resumo de curtidas de um perfil — a privacidade do dono manda */
  api.listLikes = async function (userId) {
    await delay();
    const me = S().me();
    const owner = requireUser(userId);
    if (!S().canViewLikesOf(me ? me.id : null, owner.id))
      fail(NX.i18n.get("api.estaPessoaMantemCurtidas", "Esta pessoa mantém as curtidas dela privadas."));

    const posts = S()
      .postsBy(owner.id)
      .filter((p) => S().likeCount("post", p.id) > 0)
      .map((p) => ({ post: p, likes: S().likeCount("post", p.id) }));

    return { total: S().likesReceivedOf(owner.id), posts: posts };
  };

  /* =========================================================
     AMIZADES — sistema GLOBAL (não depende de servidor)
     ========================================================= */
  function findUserByIdOrName(v) {
    const raw = String(v || "").trim().replace(/^@/, "");
    if (!raw) return null;
    return S().user(raw) || S().userByUsername(raw) || null;
  }

  function friendshipCount(userId) {
    const u = S().user(userId);
    if (u) u.friendsCount = S().friendCount(userId);
  }

  /* 1) enviar solicitação (não a si mesmo, sem duplicatas) */
  api.sendFriendRequest = async function (userIdOrName) {
    await delay();
    const me = requireMe();
    const other = findUserByIdOrName(userIdOrName);
    if (!other || !S().isRealPerson(other.id)) fail(NX.i18n.get("api.naoEncontramosNinguemEsse2", "Não encontramos ninguém com esse @username."));
    const check = S().canSendFriendRequest(me.id, other.id);
    if (!check.ok) fail(check.reason);

    const req = {
      id: u().uid("frq"),
      senderId: me.id,
      receiverId: other.id,
      status: "pending",
      createdAt: Date.now(),
    };
    db().friendRequests[req.id] = req;
    NX.store.persist();

    notify(other.id, "friend", "@" + me.username + (" " + NX.i18n.get("api.enviouumasolicitacaodeamizade", "enviou uma solicitação de amizade.")), {
      href: "#/amigos/recebidas",
      actorId: me.id,
      requestId: req.id,
    });
    NX.store.commit(["profile", "notifications", "members"]);
    return req;
  };

  /* 2) aceitar — vira amizade real para os DOIS lados */
  api.acceptFriendRequest = async function (requestId) {
    await delay();
    const me = requireMe();
    const req = S().friendRequest(requestId);
    if (!req || req.status !== "pending") fail(NX.i18n.get("api.estaSolicitacaoAmizadeNao3", "Esta solicitação de amizade não existe mais."));
    if (req.receiverId !== me.id) fail(NX.i18n.get("api.estaSolicitacaoNaoVoce2", "Esta solicitação não é para você."));

    const key = S().friendKey(req.senderId, req.receiverId);
    if (!db().friendships[key]) {
      db().friendships[key] = {
        id: key,
        userAId: req.senderId,
        userBId: req.receiverId,
        createdAt: Date.now(),
      };
      req.status = "accepted";
      req.acceptedAt = Date.now();
    }
    NX.store.persist();
    friendshipCount(req.senderId);
    friendshipCount(req.receiverId);

    const other = S().user(req.senderId);
    notify(
      req.senderId,
      "friend",
      (NX.i18n.get("api.agoravocee", "🎉 Agora você e @")) + me.username + (" " + NX.i18n.get("api.saoamigos", "são amigos!")),
      { href: "#/amigos", actorId: me.id }
    );
    NX.store.commit(SOCIAL_SCOPES);
    return { friendship: db().friendships[key], user: other || null };
  };

  /* 3) recusar (quem recebe) */
  api.rejectFriendRequest = async function (requestId) {
    await delay();
    const me = requireMe();
    const req = S().friendRequest(requestId);
    if (!req || req.status !== "pending") fail(NX.i18n.get("api.estaSolicitacaoAmizadeNao3", "Esta solicitação de amizade não existe mais."));
    if (req.receiverId !== me.id) fail(NX.i18n.get("api.estaSolicitacaoNaoVoce2", "Esta solicitação não é para você."));
    req.status = "rejected";
    req.rejectedAt = Date.now();
    NX.store.persist();
    NX.store.commit(["profile", "notifications"]);
    return true;
  };

  /* 4) cancelar (quem enviou) */
  api.cancelFriendRequest = async function (requestId) {
    await delay();
    const me = requireMe();
    const req = S().friendRequest(requestId);
    if (!req || req.status !== "pending") fail(NX.i18n.get("api.estaSolicitacaoAmizadeNao3", "Esta solicitação de amizade não existe mais."));
    if (req.senderId !== me.id) fail(NX.i18n.get("api.voceNaoPodeCancelar", "Você não pode cancelar esta solicitação."));
    delete db().friendRequests[requestId];
    NX.store.persist();
    NX.store.commit(["profile"]);
    return true;
  };

  /* 5) remover amizade — funciona para os DOIS lados */
  api.removeFriend = async function (userId) {
    await delay();
    const me = requireMe();
    const other = requireUser(userId);
    const key = S().friendKey(me.id, other.id);
    if (!db().friendships[key]) fail(NX.i18n.get("api.vocesNaoSaoAmigos", "Vocês não são amigos."));
    delete db().friendships[key];
    NX.store.persist();
    friendshipCount(me.id);
    friendshipCount(other.id);
    NX.store.commit(SOCIAL_SCOPES);
    return true;
  };

  /* 6) estado do relacionamento (para o botão do perfil) */
  api.friendState = async function (userId) {
    await delay();
    const me = S().me();
    if (!me) return "none";
    return S().friendState(me.id, userId);
  };

  /* 7) listas */
  api.listFriends = async function (userId) {
    await delay();
    const me = requireMe();
    const owner = userId ? requireUser(userId) : me;
    if (owner.id !== me.id && !S().isFriend(me.id, owner.id)) {
      /* quem não é amigo vê apenas os amigos em comum —
         a lista completa não é exposta sem amizade */
      return S().friendsOf(owner.id).filter((f) => S().isFriend(me.id, f.id));
    }
    return S().friendsOf(owner.id);
  };

  api.listFriendRequests = async function (kind) {
    await delay();
    const me = requireMe();
    if (kind === "sent") {
      return S().sentFriendRequestsOf(me.id).map((r) => ({ request: r, user: S().user(r.receiverId) }));
    }
    return S().friendRequestsOf(me.id).map((r) => ({ request: r, user: S().user(r.senderId) }));
  };

  /* 8) convidar amiga(o) para um servidor (sem convite duplicado) */
  api.inviteFriendToServer = async function (serverId, friendId) {
    await delay();
    const me = requireMe();
    const server = S().server(serverId);
    if (!server) fail(NX.i18n.get("api.esteServidorNaoExiste2", "Este servidor não existe mais."));
    const friend = requireUser(friendId);
    if (!S().isFriend(me.id, friend.id)) fail(NX.i18n.get("api.estaPessoaNaoSua", "Esta pessoa não é sua amiga."));
    requirePerm(serverId, "createInvite", NX.i18n.get("adm.voceNaoTemPermissao3", "Você não tem permissão para criar convites."));
    if (S().membership(serverId, friend.id)) fail(NX.i18n.get("api.estaPessoaJaParticipa", "Esta pessoa já participa do servidor."));

    const mapKey = serverId + ":" + friend.id;
    const existing = (db().friendInvites || {})[mapKey];
    if (existing && db().invites[existing.code]) {
      fail(NX.i18n.get("api.voceJaEnviouConvite2", "Você já enviou um convite para esta pessoa."));
    }

    const code = newInviteCode();
    db().invites[code] = {
      code: code,
      serverId: serverId,
      creatorId: me.id,
      createdAt: Date.now(),
      uses: 0,
      maxUses: 0,
      expiresAt: null,
    };
    db().friendInvites = db().friendInvites || {};
    const inv = {
      id: u().uid("finv"),
      serverId: serverId,
      friendId: friend.id,
      byId: me.id,
      code: code,
      createdAt: Date.now(),
    };
    db().friendInvites[mapKey] = inv;
    NX.store.persist();

    notify(
      friend.id,
      "invite",
      "@" + me.username + (" " + NX.i18n.get("api.teconvidouparaentrarem", "te convidou para entrar em") + " ") + server.name + ".",
      { href: "#/convite/" + code, actorId: me.id, serverId: serverId }
    );
    NX.store.commit(["invites", "notifications"]);
    return inv;
  };

  /* =========================================================
     APPS / BOTS (Bot Center) — catálogo, instalação e config
     ========================================================= */
  api.listApps = async function () {
    await delay();
    const counts = {};
    Object.values(db().serverApps || {}).forEach(function (it) {
      counts[it.appId] = (counts[it.appId] || 0) + 1;
    });
    return Object.values(db().apps || {}).map(function (a) {
      return Object.assign({}, a, { installCount: counts[a.id] || 0 });
    });
  };

  api.getApp = async function (appId) {
    await delay();
    const app = (db().apps || {})[appId];
    if (!app) fail(NX.i18n.get("apps.esteAppNaoExiste", "Este app não existe."));
    return Object.assign({}, app, { installCount: 0 });
  };

  api.listServerApps = async function (serverId) {
    await delay();
    return Object.values(db().serverApps || {}).filter(function (i) {
      return i.serverId === serverId;
    });
  };

  function canManageServer(serverId) {
    const me = S().me();
    const srv = S().server(serverId);
    if (!me) fail(NX.i18n.get("api.suaSessaoExpirouEntre8", "Sua sessão expirou. Entre novamente."));
    if (!srv) fail(NX.i18n.get("api.esteServidorNaoExiste2", "Este servidor não existe mais."));
    if (srv.ownerId !== me.id && !S().can(serverId, me.id, "manageServer"))
      fail(NX.i18n.get("apps.semPermissaoInstalar", "Você não tem permissão para instalar apps neste servidor."));
    return me;
  }

  api.installApp = async function (serverId, data) {
    await delay();
    const me = canManageServer(serverId);
    data = data || {};
    const app = (db().apps || {})[data.appId];
    if (!app || app.enabled === false)
      fail(NX.i18n.get("apps.naoDisponivel", "Este app não está disponível."));
    if (S().appInstall(serverId, app.id))
      fail(NX.i18n.get("apps.jaInstalado", "Este app já está instalado neste servidor."));
    const install = {
      id: u().uid("sa"),
      serverId: serverId,
      appId: app.id,
      installedBy: me.id,
      permissions: Array.isArray(data.permissions) ? data.permissions.slice() : (app.permissions || []).slice(),
      enabled: true,
      configuration: Object.assign({}, (app.config || {}), data.configuration || {}),
      installedAt: Date.now(),
      updatedAt: Date.now(),
    };
    db().serverApps = db().serverApps || {};
    db().serverApps[install.id] = install;
    log(serverId, "app.install", { app: app.name });
    NX.store.commit(["apps"]);
    return install;
  };

  api.updateServerApp = async function (serverId, installId, patch) {
    await delay();
    canManageServer(serverId);
    patch = patch || {};
    const install = (db().serverApps || {})[installId];
    if (!install || install.serverId !== serverId)
      fail(NX.i18n.get("apps.instalacaoNaoExiste", "Esta instalação não existe."));
    if (patch.enabled !== undefined) install.enabled = !!patch.enabled;
    if (patch.configuration !== undefined)
      install.configuration = Object.assign({}, install.configuration || {}, patch.configuration);
    if (patch.permissions !== undefined) install.permissions = patch.permissions.slice();
    install.updatedAt = Date.now();
    log(serverId, "app.update", { app: install.appId, enabled: install.enabled });
    NX.store.commit(["apps"]);
    return install;
  };

  api.removeServerApp = async function (serverId, installId) {
    await delay();
    canManageServer(serverId);
    const install = (db().serverApps || {})[installId];
    if (!install || install.serverId !== serverId)
      fail(NX.i18n.get("apps.instalacaoNaoExiste", "Esta instalação não existe."));
    delete db().serverApps[installId];
    log(serverId, "app.remove", { app: install.appId });
    NX.store.commit(["apps"]);
    return true;
  };

  /* =========================================================
     CHAMADAS — WebRTC no cliente, estado aqui (fallback local)
     ========================================================= */
  function localCall(id, patch) {
    db().calls = db().calls || {};
    const cur = db().calls[id] || null;
    const next = Object.assign({}, cur || {}, patch || {});
    db().calls[id] = next;
    return next;
  }

  api.startCall = async function (peerId) {
    await delay();
    const me = S().me();
    if (!me) fail(NX.i18n.get("api.suaSessaoExpirouEntre8", "Sua sessão expirou. Entre novamente."));
    if (!peerId || peerId === me.id) fail(NX.i18n.get("call.naoLigarParaSi", "Você não pode ligar para si mesmo."));
    if (S().activeCall()) fail(NX.i18n.get("call.jaEmChamada", "Você já está em uma chamada."));
    const id = u().uid("cl");
    const call = localCall(id, {
      id: id,
      peerId: peerId,
      role: "caller",
      state: "ringing",
      startedAt: Date.now(),
      answeredAt: null,
      endedAt: null,
      reason: null,
    });
    notify(
      peerId,
      "call",
      "📞 " + (me.displayName || me.username) + " está ligando para você.",
      { callId: id, href: "#/mensagens", actorId: me.id }
    );
    NX.store.commit(["calls", "notifications"]);
    return call;
  };

  api.respondCall = async function (callId, accept) {
    await delay();
    const call = (db().calls || {})[callId];
    if (!call) fail(NX.i18n.get("call.naoExiste", "Esta chamada não existe mais."));
    const ok = accept !== false;
    const next = localCall(callId, {
      state: ok ? "active" : "declined",
      answeredAt: ok ? Date.now() : null,
      endedAt: ok ? null : Date.now(),
      reason: ok ? null : "declined",
    });
    NX.store.commit(["calls"]);
    return next;
  };

  api.endCall = async function (callId, reason) {
    await delay();
    const call = (db().calls || {})[callId];
    if (!call) fail(NX.i18n.get("call.naoExiste", "Esta chamada não existe mais."));
    const missed = reason === "missed";
    const next = localCall(callId, {
      state: missed ? "missed" : "ended",
      endedAt: Date.now(),
      reason: reason || "hangup",
    });
    NX.store.commit(["calls"]);
    return next;
  };

  api.sendSignal = async function (callId, kind, payload) {
    await delay();
    return true;
  };

  api.peekCalls = async function () {
    await delay();
    return {
      calls: db().calls || {},
      signals: [],
      peers: {},
      serverTime: Date.now(),
    };
  };

  NX.api = api;
})(window.NX);
