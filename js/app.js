/* ============================================================
   NEXO · aplicação
   Roteamento por hash, bootstrap, delegação de ações e
   controle de gavetas responsivas.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const u = () => NX.util;
  const S = () => NX.selectors;
  const app = {};
  let routing = false;
  let lastScreen = null;
  let lastAuthMode = null;
  let lastRouteKey = null;

  app.route = null;
  app.screen = null;
  app.pendingInvite = null;

  /* login da Nexo: SOMENTE nome de usuário + senha.
     (sem recuperação por e-mail, sem verificação de e-mail) */
  const AUTH_MODES = { login: "#/login", cadastro: "#/cadastro" };
  /* data-mode (telas) → trecho de rota */
  const AUTH_ALIAS = {
    login: "login",
    signup: "cadastro",
    cadastro: "cadastro",
  };
  /* rotas antigas (e-mail/código) voltam para o login */
  const LEGACY_AUTH = { recuperar: 1, verificar: 1, forgot: 1, verify: 1 };

  /* ---------------- navegação ---------------- */
  app.go = function (hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  };

  app.afterAuth = function () {
    const code = app.pendingInvite;
    app.pendingInvite = null;
    if (code) app.go("#/convite/" + code);
    else app.go("#/");
  };

  app.logout = async function () {
    const ok = await NX.ui.confirm({
      title: NX.i18n.get("app.sairConta", "Sair da conta"),
      message: NX.i18n.get("app.vocePrecisaraEntrarNovamente", "Você precisará entrar novamente para acessar seus servidores."),
      confirmLabel: (NX.i18n.get("set.item.logout", "Sair")),
      icon: "logout",
    });
    if (!ok) return;
    try {
      await NX.api.logout();
      lastRouteKey = null;
      app.go("#/login");
    } catch (e) {
      NX.ui.error(e.message);
    }
  };

  function showScreen(which) {
    app.screen = which;
    document.getElementById("screen-auth").hidden = which !== "auth";
    document.getElementById("screen-invite").hidden = which !== "invite";
    document.getElementById("screen-landing").hidden = which !== "landing";
    document.getElementById("screen-settings").hidden = which !== "settings";
    document.getElementById("screen-app").hidden = which !== "app";
  }

  /* landing pública — usada quando não há sessão */
  function showLanding() {
    const el = document.getElementById("screen-landing");
    showScreen("landing");
    if (lastScreen !== "landing") {
      if (NX.landing && typeof NX.landing.render === "function") {
        NX.landing.render(el);
      } else {
        el.innerHTML =
          '<div class="landing-fallback">' +
          ("<h1>" + NX.i18n.get("app.seuespacosuacomunidadesuaconversa", "Seu espaço. Sua comunidade. Sua conversa.") + "</h1>") +
          ("<p>" + NX.i18n.get("app.criecomunidadesconversecomseusamigos", "Crie comunidades, converse com seus amigos e construa seu próprio espaço online.") + "</p>") +
          '<div class="landing-fallback__actions">' +
          ("<button class=\"btn btn--primary\" data-action=\"goto-login\">" + NX.i18n.get("adm.entrar", "Entrar") + "</button>") +
          ("<button class=\"btn btn--soft\" data-action=\"goto-signup\">" + NX.i18n.get("app.criarconta", "Criar conta") + "</button>") +
          "</div></div>";
      }
    }
    lastScreen = "landing";
    lastAuthMode = null;
    app.route = { name: "landing" };
  }

  /* configurações do usuário (camada sobre o app) */
  app.openSettings = function (section) {
    if (!S().me()) {
      app.go("#/login");
      return;
    }
    const el = document.getElementById("screen-settings");
    showScreen("settings");
    lastScreen = "settings";
    lastRouteKey = "settings|" + (section || "");
    app.route = { name: "settings", section: section || "account" };
    if (NX.settings && typeof NX.settings.render === "function") {
      NX.settings.render(el, section || "account");
    } else {
      el.innerHTML =
        ("<div class=\"settings-fallback\"><h2>" + NX.i18n.get("nav.settings", "Configurações") + "</h2>") +
        ("<p>" + NX.i18n.get("app.osmodulosdeconfiguracaoaindaestao", "Os módulos de configuração ainda estão carregando.") + "</p>") +
        ("<button class=\"btn btn--soft\" data-action=\"settings-close\">" + NX.i18n.get("common.back", "Voltar") + "</button></div>");
    }
  };

  app.closeSettings = function () {
    if (location.hash === "#/config") app.go("#/");
    else app.openSettings();
  };

  function closeDrawers() {
    const shell = document.getElementById("screen-app");
    shell.classList.remove("sidebar-open", "members-open");
    document.getElementById("scrim").hidden = true;
  }

  /* ---------------- roteador ---------------- */
  function route() {
    if (routing) return;
    routing = true;
    try {
      doRoute();
    } catch (e) {
      console.error("[route]", e);
    }
    routing = false;
  }

  function doRoute() {
    const hash = location.hash || "#/";
    const seg = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const me = S().me();

    /* ---- convite ---- */
    if (seg[0] === "convite") {
      showScreen("invite");
      lastScreen = "invite";
      NX.pages.renderInvite(seg[1] ? seg[1].toUpperCase() : "");
      app.route = { name: "invite", code: seg[1] };
      lastRouteKey = "invite:" + seg[1];
      return;
    }

    /* ---- sem sessão: landing pública ou autenticação ---- */
    if (!me) {
      if (LEGACY_AUTH[seg[0]]) {
        /* endereço antigo (e-mail/código): cai sempre no login */
        app.go("#/login");
        return;
      }
      const mode = AUTH_MODES[seg[0]] ? seg[0] : seg[0] === "config" ? "login" : null;
      if (!mode) {
        showLanding();
        return;
      }
      showScreen("auth");
      if (lastScreen !== "auth" || lastAuthMode !== mode) NX.pages.renderAuth(mode);
      lastScreen = "auth";
      lastAuthMode = mode;
      app.route = null;
      return;
    }

    /* ---- logado mas em rota de auth ---- */
    if (AUTH_MODES[seg[0]] || LEGACY_AUTH[seg[0]]) {
      lastAuthMode = null;
      app.go("#/");
      return;
    }

    /* ---- boas-vindas após o cadastro ---- */
    if (seg[0] === "bem-vindo") {
      showScreen("auth");
      NX.pages.renderWelcome();
      lastScreen = "welcome";
      lastAuthMode = null;
      lastRouteKey = "welcome";
      app.route = { name: "welcome" };
      return;
    }

    /* ---- configurações do usuário ---- */
    if (seg[0] === "config") {
      lastAuthMode = null;
      app.openSettings(seg[1]);
      return;
    }

    showScreen("app");
    lastAuthMode = null;

    let next = null;
    const head = seg[0] || "";

    if (head === "s") {
      const server = S().server(seg[1]);
      if (!server || !S().membership(server.id, me.id)) {
        if (server) NX.ui.toast(NX.i18n.get("adm.voceNaoFazParte", "Você não faz parte deste servidor."), "warn");
        app.go("#/");
        return;
      }
      let ch = seg[2] ? S().channel(seg[2]) : null;
      if (ch && (ch.serverId !== server.id || !S().canViewChannel(ch, me.id))) ch = null;
      if (!ch) {
        const last = NX.store.ui.lastChannel[server.id];
        ch = S().channel(last);
        if (!ch || ch.serverId !== server.id || !S().canViewChannel(ch, me.id)) {
          const tree = S().visibleCategoryTree(server.id, me.id);
          ch = tree.length && tree[0].channels.length ? tree[0].channels[0] : null;
        }
      }
      if (ch && NX.store.ui.lastChannel[server.id] !== ch.id) {
        NX.store.ui.lastChannel[server.id] = ch.id;
        NX.store.persistUI();
      }
      if (ch && location.hash !== "#/s/" + server.id + "/" + ch.id) {
        history.replaceState(null, "", "#/s/" + server.id + "/" + (ch.id || ""));
      }
      next = { name: "server", serverId: server.id, channelId: ch ? ch.id : null };
    } else if (head === "mensagens") {
      const dmId = seg[1] || null;
      let other = null;
      if (dmId) {
        const dm = NX.store.db.dms[dmId];
        if (!dm || dm.participants.indexOf(me.id) === -1) {
          app.go("#/mensagens");
          return;
        }
        other = S().user(dm.participants.find((p) => p !== me.id) || dm.participants[0]);
        /* marca como lida DEPOIS do render (fora da pilha do route)
           para não causar reentrada quando houver não lidas */
        if (app.__reading !== dmId) {
          app.__reading = dmId;
          window.setTimeout(() => {
            app.__reading = null;
            try {
              NX.api.markDMRead(dmId);
            } catch (e) {
              /* sem sessão: mantém como não lida */
            }
          }, 0);
        }
      }
      next = { name: dmId ? "dm" : "messages", dmId: dmId, dmOtherId: other ? other.id : null };
    } else if (head === "explorar") {
      next = { name: "explore" };
    } else if (head === "amigos") {
      /* #/amigos · /todos · /online · /idle · /offline · /recebidas · /enviadas */
      const TABS = ["todos", "online", "idle", "offline", "recebidas", "enviadas"];
      const tab = TABS.indexOf(seg[1] || "") > -1 ? seg[1] : "todos";
      next = { name: "friends", tab: tab };
    } else if (head === "feed") {
      next = { name: "feed", postId: seg[1] || null };
    } else if (head === "perfil") {
      /* aceita id ou @usuário (/perfil/username) */
      const raw = seg[1] ? String(decodeURIComponent(seg[1])) : "";
      const user = S().user(raw) || S().userByUsername(raw) || me;
      next = { name: "profile", userId: user ? user.id : me.id };
    } else {
      next = { name: "home" };
    }

    const key =
      next.name + "|" + (next.serverId || "") + "|" + (next.channelId || "") + "|" +
      (next.dmId || "") + "|" + (next.userId || "") + "|" + (next.postId || "") + "|" + (next.tab || "");
    app.route = next;

    if (lastScreen === "app" && key !== lastRouteKey) closeDrawers();
    lastRouteKey = key;
    lastScreen = "app";
    NX.views.render(app.lastScopes || []);
    app.lastScopes = [];
  }

  /* ---------------- ações globais ---------------- */
  const A = NX.actions;

  A["nav"] = (el) => app.go(el.getAttribute("data-to") || "#/");
  A["nav-home"] = () => app.go("#/");
  A["nav-messages"] = () => app.go("#/mensagens");
  A["nav-feed"] = () => app.go("#/feed");
  A["nav-explore"] = () => app.go("#/explorar");
  A["nav-friends"] = () => app.go("#/amigos");

  /* ---- landing / autenticação ---- */
  A["goto-login"] = () => app.go("#/login");
  A["goto-signup"] = () => app.go("#/cadastro");
  A["goto-landing"] = () => app.go("#/");

  /* ---- documentos legais (cadastro) ---- */
  A["open-docs"] = (el) => {
    const which = el.getAttribute("data-doc") || "termos";
    const docs = {
      termos: {
        title: NX.i18n.get("app.termosUso", "Termos de Uso"),
        body: [
          (NX.i18n.get("app.1contavoceeresponsavelpelas", "1. Conta — você é responsável pelas atividades realizadas na sua conta. Use um nome de usuário único e mantenha sua senha em segurança.")),
          (NX.i18n.get("app.2condutarespeiteaspessoasnao", "2. Conduta — respeite as pessoas. Não publique conteúdo ilegal, de ódio, assédio ou que viole direitos de terceiros.")),
          (NX.i18n.get("app.3comunidadesosadministradoresdecada", "3. Comunidades — os administradores de cada servidor definem as regras e podem moderar conteúdo, cargos e membros.")),
          (NX.i18n.get("app.4servicoesteambienteeum", "4. Serviço — este ambiente é um protótipo de demonstração: os dados podem ser reiniciados a qualquer momento.")),
        ],
      },
      privacidade: {
        title: NX.i18n.get("app.politicaPrivacidade", "Política de Privacidade"),
        body: [
          (NX.i18n.get("app.1dadosnomedeusuarioavatar", "1. Dados — nome de usuário, avatar, mensagens e preferências ficam armazenados para que a plataforma funcione.")),
          (NX.i18n.get("app.2usoasinformacoesservempara", "2. Uso — as informações servem para exibir seu perfil, organizar servidores e enviar notificações.")),
          (NX.i18n.get("app.3controlevocepodeeditarseu", "3. Controle — você pode editar seu perfil, bloquear pessoas e excluir conteúdos que publicou.")),
          NX.i18n.get("app.4NadaCompartilhadoTerceiros", "4. Nada é compartilhado com terceiros fora do escopo de operar a plataforma."),
        ],
      },
    };
    const d = docs[which] || docs.termos;
    const footer = u().el(
      ("<div class=\"modal__actions\"><button class=\"btn btn--primary\" data-modal-close>" + NX.i18n.get("app.entendi", "Entendi") + "</button></div>")
    );
    const m = NX.ui.modal({ title: d.title, eyebrow: "Nexo", size: "md", footer: footer });
    m.body.innerHTML =
      '<div class="docs">' +
      d.body.map((p) => "<p>" + u().h(p) + "</p>").join("") +
      "</div>";
  };

  /* ---- configurações do usuário ---- */
  A["open-settings"] = (el) => app.openSettings(el.getAttribute("data-section"));
  A["settings-section"] = (el) => app.openSettings(el.getAttribute("data-section"));
  A["settings-close"] = () => app.closeSettings();
  A["set-close"] = () => app.closeSettings(); /* o módulo settings registra antes; app.js carrega por último */
  A["settings-logout"] = () => app.logout();

  /* ---- tela de boas-vindas ---- */
  A["welcome-create"] = () => app.go("#/"); /* o modal de criar servidor abre pelo home */
  A["welcome-join"] = () => {
    app.go("#/");
    setTimeout(() => NX.modals.joinServer(), 60);
  };
  A["welcome-explore"] = () => app.go("#/explorar");
  A["welcome-continue"] = () => app.go("#/");

  A["open-server"] = (el) => app.go("#/s/" + el.getAttribute("data-id"));

  A["open-channel"] = (el) => {
    const id = el.getAttribute("data-id");
    const ch = S().channel(id);
    if (!ch) return;
    app.go("#/s/" + ch.serverId + "/" + id);
  };

  A["open-dm"] = (el) => app.go("#/mensagens/" + el.getAttribute("data-id"));

  A["open-profile"] = (el) => app.go("#/perfil/" + el.getAttribute("data-id"));

  A["create-server"] = () => NX.modals.createServer();
  A["join-invite"] = () => NX.modals.joinServer();
  A["new-dm"] = () => NX.modals.newDM();

  A["join-explore"] = async (el) => {
    const id = el.getAttribute("data-id");
    try {
      const server = await NX.api.joinServer(id);
      NX.ui.toast((NX.i18n.get("app.voceentrouem", "Você entrou em") + " ") + server.name + "!", "success");
      app.go("#/s/" + server.id);
    } catch (e) {
      NX.ui.error(e.message);
    }
  };

  A["accept-invite"] = async (el) => {
    try {
      const server = await NX.api.joinByInvite(el.getAttribute("data-code"));
      NX.ui.toast((NX.i18n.get("app.voceentrouem", "Você entrou em") + " ") + server.name + "!", "success");
      app.go("#/s/" + server.id);
    } catch (e) {
      NX.ui.error(e.message);
    }
  };

  A["login-for-invite"] = (el) => {
    app.pendingInvite = el.getAttribute("data-code");
    app.go("#/login");
  };

  A["signup-for-invite"] = (el) => {
    app.pendingInvite = el.getAttribute("data-code");
    app.go("#/cadastro");
  };

  A["server-menu"] = (el) => NX.modals.serverMenu(el, el.getAttribute("data-id"));
  A["invite"] = (el) => NX.modals.invite(el.getAttribute("data-id"));
  A["create-channel"] = (el) =>
    NX.modals.createChannel(el.getAttribute("data-id"), el.getAttribute("data-cat"));
  A["create-category"] = (el) => NX.modals.createCategory(el.getAttribute("data-id"));
  A["channel-menu"] = (el) => NX.modals.channelMenu(el, el.getAttribute("data-id"));
  A["category-menu"] = (el) => NX.modals.categoryMenu(el, el.getAttribute("data-id"));
  A["channel-settings"] = (el) => NX.modals.channelSettings(el.getAttribute("data-id"));
  A["profile-menu"] = (el) => NX.modals.profileMenu(el);
  A["edit-profile"] = () => NX.modals.editProfile();

  A["toggle-category"] = (el) => {
    NX.api.toggleCategory(el.getAttribute("data-id"));
  };

  A["member-card"] = (el) =>
    NX.modals.memberCard(el, el.getAttribute("data-server"), el.getAttribute("data-id"));

  A["start-dm"] = async (el) => {
    try {
      const dm = await NX.api.openDM(el.getAttribute("data-id"));
      NX.ui.closePopout();
      app.go("#/mensagens/" + dm.id);
    } catch (e) {
      NX.ui.error(e.message);
    }
  };

  A["toggle-sidebar"] = () => {
    const shell = document.getElementById("screen-app");
    const open = shell.classList.toggle("sidebar-open");
    document.getElementById("scrim").hidden = !open;
  };

  A["toggle-members"] = () => {
    const shell = document.getElementById("screen-app");
    if (window.innerWidth >= 1200) {
      shell.classList.toggle("members-off");
    } else {
      const open = shell.classList.toggle("members-open");
      document.getElementById("scrim").hidden = !open;
    }
  };

  A["join-voice"] = async (el) => {
    try {
      await NX.api.joinVoice(el.getAttribute("data-id"));
      NX.ui.toast(NX.i18n.get("app.voceEntrouSalaVoz", "Você entrou na sala de voz."), "success");
    } catch (e) {
      NX.ui.error(e.message);
    }
  };

  A["leave-voice"] = async () => {
    try {
      await NX.api.leaveVoice();
      NX.ui.toast(NX.i18n.get("app.desconectadoSala", "Desconectado da sala."), "success");
    } catch (e) {
      NX.ui.error(e.message);
    }
  };

  /* ---- mensagens ---- */
  A["msg-edit"] = (el) => {
    NX.views.editingMessageId = el.getAttribute("data-id");
    NX.views.render(["messages"]);
  };
  A["msg-cancel-edit"] = () => {
    NX.views.editingMessageId = null;
    NX.views.render(["messages"]);
  };
  A["msg-save-edit"] = async (el) => {
    const id = el.getAttribute("data-id");
    const input = document.querySelector("[data-edit-input]");
    if (!input) return;
    try {
      await NX.api.editMessage(id, input.value);
      NX.views.editingMessageId = null;
      NX.views.render(["messages"]);
    } catch (e) {
      NX.ui.error(e.message || NX.i18n.get("app.naoFoiPossivelEditar", "Não foi possível editar."));
    }
  };
  A["msg-delete"] = async (el) => {
    const ok = await NX.ui.confirm({
      title: NX.i18n.get("app.apagarMensagem", "Apagar mensagem"),
      message: NX.i18n.get("app.estaMensagemSeraApagada", "Esta mensagem será apagada para todos. Não dá para desfazer."),
      confirmLabel: (NX.i18n.get("app.apagar", "Apagar")),
      danger: true,
      icon: "trash",
    });
    if (!ok) return;
    try {
      await NX.api.deleteMessage(el.getAttribute("data-id"));
      NX.ui.toast(NX.i18n.get("app.mensagemApagada", "Mensagem apagada."), "success");
    } catch (e) {
      NX.ui.error(e.message);
    }
  };

  /* ---- autenticação ---- */
  A["auth-mode"] = (el) => {
    const mode = el.getAttribute("data-mode");
    app.go(AUTH_MODES[AUTH_ALIAS[mode] || mode] || "#/login");
  };

  A["toggle-password"] = (el) => {
    const wrap = el.closest(".input-wrap") || el.parentElement;
    const input = wrap.querySelector("input");
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    el.innerHTML = NX.icon(show ? "eyeOff" : "eye", "", 18);
  };

  /* ---- compositor: anexos, GIFs e emojis ---- */
  function insertAtCursor(text) {
    const ta = document.querySelector("[data-composer-input]");
    if (!ta) return;
    const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    const e = ta.selectionEnd == null ? ta.value.length : ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = s + text.length;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const chatReady = () =>
    NX.chat && typeof NX.chat.openAttachMenu === "function";

  A["composer-attach"] = (el) => {
    if (!chatReady()) return NX.ui.error(NX.i18n.get("app.moduloMidiaAindaEsta", "O módulo de mídia ainda está carregando."));
    NX.chat.openAttachMenu(el, (item) => {
      NX.chat.addPending(item);
      NX.views.renderPending();
    });
  };

  A["composer-gif"] = (el) => {
    if (!NX.chat || typeof NX.chat.openGifPicker !== "function")
      return NX.ui.error(NX.i18n.get("app.moduloGifsAindaEsta", "O módulo de GIFs ainda está carregando."));
    NX.chat.openGifPicker(el, (item) => {
      NX.chat.addPending(item);
      NX.views.renderPending();
    });
  };

  A["composer-emoji"] = (el) => {
    if (!NX.chat || typeof NX.chat.openEmojiPicker !== "function")
      return NX.ui.error(NX.i18n.get("app.seletorEmojisAindaEsta", "O seletor de emojis ainda está carregando."));
    const serverId = app.route && app.route.serverId;
    NX.chat.openEmojiPicker(el, insertAtCursor, { serverId: serverId });
  };

  A["composer-clear-pending"] = () => {
    if (NX.chat && NX.chat.pending) NX.chat.pending.length = 0;
    NX.views.renderPending();
  };

  /* aliases antigos (telas que ainda apontam para eles) */
  A["composer-hint"] = (el) => A["composer-attach"](el);
  A["emoji-hint"] = (el) => A["composer-emoji"](el);

  /* ---------------- eventos globais ---------------- */
  function bindGlobal() {
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const name = el.getAttribute("data-action");
      const fn = NX.actions[name];
      if (typeof fn === "function") {
        e.preventDefault();
        try {
          fn(el, e);
        } catch (err) {
          console.error("[action:" + name + "]", err);
          NX.ui.error(NX.i18n.get("app.algoDeuErradoExecutar", "Algo deu errado ao executar esta ação."));
        }
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === (NX.i18n.get("app.escape", "Escape"))) {
        if (NX.ui.isOpen()) return;
        const shell = document.getElementById("screen-app");
        if (shell.classList.contains("sidebar-open") || shell.classList.contains("members-open")) {
          closeDrawers();
          return;
        }
        if (NX.views.editingMessageId) {
          NX.views.editingMessageId = null;
          NX.views.render(["messages"]);
        }
        return;
      }
      if (NX.views.editingMessageId && e.target.matches("[data-edit-input]")) {
        if (e.key === (NX.i18n.get("app.enter", "Enter")) && !e.shiftKey) {
          e.preventDefault();
          const btn = document.querySelector('[data-action="msg-save-edit"]');
          if (btn) btn.click();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        const ta = document.querySelector("[data-composer-input]");
        if (ta) {
          e.preventDefault();
          ta.focus();
        }
      }
    });

    document.getElementById("scrim").addEventListener("click", closeDrawers);

    /* NX.i18n.apply (login/logout) fecha overlays montados e
       redesenha a tela atual inteira, sem recarregar a página. */
    if (NX.bus && NX.bus.on) {
      NX.bus.on("i18n:change", function () {
        try {
          NX.ui.closeEverything();
        } catch (e) {}
        if (app.screen === "settings") return; /* settings re-renderiza sozinho */
        lastRouteKey = null;
        if (lastScreen === "landing") lastScreen = null;
        if (lastScreen === "auth") lastAuthMode = null;
        try {
          route();
        } catch (e) {
          console.error("[i18n:rerender]", e);
        }
      });
    }

    window.addEventListener("hashchange", route);

    window.addEventListener(
      "resize",
      u().debounce(() => {
        if (window.innerWidth >= 900) {
          document.getElementById("screen-app").classList.remove("sidebar-open");
        }
        if (window.innerWidth >= 1200) {
          document.getElementById("screen-app").classList.remove("members-open");
        }
        document.getElementById("scrim").hidden = !document
          .getElementById("screen-app")
          .classList.contains("sidebar-open");
      }, 150)
    );

    /* registra ações declaradas por outros módulos */
    window.addEventListener("nx:register-actions", () => {});
  }

  /* ---------------- bootstrap ---------------- */
  function init() {
    NX.applyTheme(NX.currentTheme());
    NX.store.load();
    NX.seed();

    /* se o armazenamento local falhou, dizemos na cara em vez de
       deixar o usuário criar contas que somem no F5 */
    try {
      const warn = NX.store.storageWarning && NX.store.storageWarning();
      if (warn) {
        console.warn("[Nexo] " + warn);
        setTimeout(() => NX.ui.toast(warn, "warn", 9000), 700);
      }
    } catch (e) {}

    NX.store.subscribe((payload) => {
      app.lastScopes = (app.lastScopes || []).concat(payload.scopes || []);
      route();
    });

    bindGlobal();

    /* o backend remoto precisa responder (ou falhar) antes do
       primeiro desenho: quem está logado é o servidor que diz,
       através do cookie HttpOnly validado em /auth/me. */
    const started =
      NX.remote && typeof NX.remote.start === "function"
        ? NX.remote.start()
        : Promise.resolve(null);
    Promise.resolve(started)
      .catch(function (err) {
        console.warn("[nexo/remote] boot:", err && err.message);
      })
      .then(function () {
        bootUI();
      });
  }

  /* primeiro desenho — só depois de conhecer o estado do backend */
  function bootUI() {
    if (!location.hash) location.hash = "#/";
    route();

    /* o HTML estático do index.html (#rail, #sidebar, #members)
       nunca passa pelo route() — reaplica as chaves marcadas
       data-i18n em pt-BR já no primeiro desenho. */
    try {
      NX.i18n.hydrate(document);
    } catch (e) {
      /* sem hidratação: segue o render normal */
    }

    /* presença real da conta atual: online ao entrar */
    const me = S().me();
    if (me) {
      if (me.status === "offline") {
        me.status = "online";
        NX.store.db.presence[me.id] = "online";
        NX.store.persist();
      }
      me.autoIdle = false;
      setupPresence();
    }

    console.log(
      (NX.i18n.get("app.cnexocprototipodecomunidadescamada", "%cNexo%c protótipo de comunidades — camada de dados isolada em js/api.js.")),
      "background:#35e0a8;color:#06231a;font-weight:bold;padding:2px 6px;border-radius:4px",
      "color:#93a8a4"
    );
  }

  /* ---------------- presença real ----------------
     online ao entrar · Ausente por inatividade · Offline ao sair.
     Quem escolher "Não perturbe"/"Offline" na mão não é sobrescrito. */
  const IDLE_MS = 5 * 60 * 1000; /* 5 min sem interação */
  let idleTimer = null;

  function writeStatus(status) {
    const u = S().me();
    if (!u || u.status === status) return false;
    u.status = status;
    if (NX.store.db.presence) NX.store.db.presence[u.id] = status;
    NX.store.persist();
    NX.store.commit(["presence", "profile"]);
    return true;
  }

  function pokePresence() {
    const u = S().me();
    if (!u) return;
    if (u.status === "idle" && u.autoIdle) {
      u.autoIdle = false;
      writeStatus("online");
    }
    if (idleTimer) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      const v = S().me();
      if (v && v.status === "online") {
        v.autoIdle = true;
        writeStatus("idle");
      }
    }, IDLE_MS);
  }

  function setupPresence() {
    ["pointerdown", "keydown", "wheel", "touchstart"].forEach((ev) => {
      window.addEventListener(ev, pokePresence, { passive: true });
    });
    pokePresence();

    /* ao fechar/recarregar a aba a conta sai como Offline de verdade;
       no boot seguinte ela volta a ficar Online (nada de ficar "Online"
       eterno para quem já saiu). */
    window.addEventListener("pagehide", () => {
      const u = S().me();
      if (u && u.status !== "offline") {
        u.autoIdle = false;
        u.status = "offline";
        if (NX.store.db.presence) NX.store.db.presence[u.id] = "offline";
        NX.store.persist();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  NX.app = app;
})(window.NX);
