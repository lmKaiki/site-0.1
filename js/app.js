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

  /* telas de acesso públicas: login, cadastro e confirmação de e-mail.
     A confirmação é pública de propósito: quem clica no link do
     e-mail ainda não tem sessão. */
  const AUTH_MODES = {
    login: "#/login",
    cadastro: "#/cadastro",
    confirmar: "#/confirmar",
  };
  /* data-mode (telas) → trecho de rota */
  const AUTH_ALIAS = {
    login: "login",
    signup: "cadastro",
    cadastro: "cadastro",
    confirmar: "confirmar",
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
    syncMenuBtn();
  }

  /* ---------------- menu (☰) da barra superior ----------------
     Em telas pequenas a sidebar é uma gaveta (overlay + scrim).
     Em desktop ela recolhe de verdade, no mesmo espírito do
     members-off — e o estado recolhido é preferência do usuário,
     persistida no storage local. O scrim só existe na gaveta. */
  const SIDEBAR_OFF_KEY = "nexo.sidebar-off";
  const menuIsDrawer = () => window.innerWidth < 900;

  app.menuOpen = function () {
    const shell = document.getElementById("screen-app");
    if (!shell) return true;
    return menuIsDrawer()
      ? shell.classList.contains("sidebar-open")
      : !shell.classList.contains("sidebar-off");
  };

  /* reapinta o botão atual (ícone/aria) — o header é redesenhado
     a cada rota, então aqui só sincronizamos o que já existe */
  function syncMenuBtn() {
    const burger = document.querySelector(".header__burger");
    if (!burger) return;
    const open = app.menuOpen();
    const label = open
      ? NX.i18n.get("landing.fecharMenu", "Fechar menu")
      : NX.i18n.get("landing.abrirMenu", "Abrir menu");
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    burger.setAttribute("aria-label", label);
    /* na gaveta o ícone vira ✕ quando aberta; no desktop o ☰
       permanece e o destaque do CSS indica o estado */
    burger.innerHTML = NX.icon(menuIsDrawer() && open ? "x" : "menu", "", 20);
  }
  app.syncMenuBtn = syncMenuBtn;

  app.applySidebarPref = function () {
    try {
      const shell = document.getElementById("screen-app");
      if (!shell) return;
      if (NX.storage.get(SIDEBAR_OFF_KEY, "0") === "1" && window.innerWidth >= 900) {
        shell.classList.add("sidebar-off");
      } else {
        shell.classList.remove("sidebar-off");
      }
    } catch (e) {}
  };

  /* ---- espera do sync de boot (deep links #/s/...) ----
     Se o sync inicial falhar (rede instável), o store começa vazio e
     um redirecionamento imediato apagaria o endereço pedido para
     sempre — era isso que jogava deep links de convite no Início.
     Fica na tela com sync manual em retry e um teto de espera. */
  let syncWaitHash = null;
  let syncWaitTimer = null;
  let syncWaitKickTimer = null;
  let syncWaitKicks = 0;

  function syncWaitReset() {
    syncWaitHash = null;
    syncWaitKicks = 0;
    if (syncWaitTimer) { clearTimeout(syncWaitTimer); syncWaitTimer = null; }
    if (syncWaitKickTimer) { clearTimeout(syncWaitKickTimer); syncWaitKickTimer = null; }
  }

  function syncWaitGiveUp() {
    syncWaitTimer = null;
    if (app.route && app.route.name === "syncWaiting") {
      try {
        NX.ui.toast(
          NX.i18n.get("route.syncDemorou", "Não foi possível carregar seus dados agora. Tente novamente."),
          "warn"
        );
      } catch (e) {}
      app.go("#/");
    }
  }

  function kickSyncWait() {
    syncWaitKicks++;
    try {
      const p = NX.remote && NX.remote.sync ? NX.remote.sync() : null;
      /* sem catch o sync rejeitado viraria unhandled rejection */
      if (p && typeof p.catch === "function") p.catch(function () {});
    } catch (e) {}
    if (syncWaitKicks < 5) {
      syncWaitKickTimer = window.setTimeout(function () {
        syncWaitKickTimer = null;
        if (syncWaitHash) kickSyncWait(); /* ainda esperando: tenta de novo */
      }, 3000);
    }
  }

  function waitForSyncBoot() {
    const hash = location.hash;
    app.route = { name: "syncWaiting" };
    lastRouteKey = "syncWaiting";
    lastScreen = "app";
    if (syncWaitHash === hash) return; /* já desenhado nesta rota */
    syncWaitHash = hash;
    const mc = document.getElementById("main-content");
    if (mc) {
      mc.innerHTML =
        '<div class="syncwait">' +
        '<div class="spinner syncwait__spin" aria-hidden="true"></div>' +
        "<p>" + NX.i18n.get("route.sincronizando", "Sincronizando seus dados…") + "</p>" +
        "</div>";
    }
    if (!syncWaitTimer) syncWaitTimer = window.setTimeout(syncWaitGiveUp, 16000);
    kickSyncWait();
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
    const rawHash = location.hash || "#/";
    /* O link de confirmação do Supabase chega com um SEGUNDO "#"
       trazendo o token (#/auth/callback#access_token=…). Ele é
       credencial, não rota: a navegação ignora esse pedaço. */
    const cut = rawHash.indexOf("#", 1);
    const hash = cut > -1 ? rawHash.slice(0, cut) : rawHash;
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

    /* ---- página de servidor (#/servidores/:id) ----
       Interna: só quem é membro vê (a exceção pública do
       Servidor Oficial Nexo foi removida junto com ele). */
    if (seg[0] === "servidores") {
      const sid = seg[1] ? String(seg[1]) : "";
      showScreen("invite");
      lastScreen = "invite";
      if (NX.pages && NX.pages.renderServerPage) NX.pages.renderServerPage(sid);
      app.route = { name: "serverPage", serverId: sid };
      lastRouteKey = "serverPage:" + sid;
      return;
    }

    /* ---- callback do link de confirmação de e-mail ----
       Público de propósito: quem clicou no link ainda não tem
       sessão, e o token é conferido no servidor. */
    if (seg[0] === "auth" && seg[1] === "callback") {
      showScreen("auth");
      NX.pages.renderAuth("authCallback");
      lastScreen = "auth";
      lastAuthMode = "confirmar";
      lastRouteKey = "authcallback";
      app.route = null;
      return;
    }

    /* ---- páginas de ajuda (públicas) ----
       Central de ajuda, Suporte, Termos e Privacidade. Abrem com
       ou sem sessão: são documentos, não dados pessoais. */
    if (seg.length === 1 && NX.help && NX.help.pages && NX.help.pages.indexOf(seg[0]) !== -1) {
      const helpPage = seg[0];
      /* Estas páginas são estáticas — não leem o store. Como
         `route()` roda a cada commit do sincronizador (a cada
         poucos segundos), redesenhá-las sem motivo apagaria o
         formulário de Suporte pela metade e o resultado de um
         envio que já deu certo. Só redesenha quando a página
         realmente muda ou o marcador sumiu da tela. */
      if (
        app.route &&
        app.route.name === "help" &&
        app.route.page === helpPage &&
        lastScreen === "invite" &&
        NX.help.isRendered &&
        NX.help.isRendered(helpPage)
      )
        return;
      showScreen("invite");
      lastScreen = "invite";
      lastAuthMode = null;
      NX.help.render(helpPage);
      app.route = { name: "help", page: helpPage };
      lastRouteKey = "help:" + helpPage;
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
      if (
        lastScreen !== "auth" ||
        lastAuthMode !== mode ||
        (NX.pages.authModeMatches && !NX.pages.authModeMatches(mode))
      )
        NX.pages.renderAuth(mode);
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
        /* Deep link (convite/permalink) com o cache ainda frio: o sync
           inicial do boot falhou ou ainda não terminou. Redirecionar
           agora descartaria o endereço para sempre — mesmo cuidado do
           ramo de DMs. Espera na tela e resolve quando os dados chegar. */
        const cacheFrio = !!(NX.remote && NX.remote.online && !NX.remote.lastSyncAt);
        if (cacheFrio && !server && seg[1]) {
          waitForSyncBoot();
          return;
        }
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
      let activeId = dmId;
      if (dmId) {
        let dm = NX.store.db.dms[dmId] || null;
        /* #/mensagens/<id-da-pessoa>: quando a conversa JÁ existe ela é
           aberta — sem criar nada e sem mandar a pessoa para outra tela */
        if (!dm && String(dmId).indexOf("u_") === 0) {
          dm =
            Object.keys(NX.store.db.dms || {})
              .map((k) => NX.store.db.dms[k])
              .find(
                (d) =>
                  d &&
                  Array.isArray(d.participants) &&
                  d.participants.indexOf(me.id) > -1 &&
                  d.participants.indexOf(dmId) > -1
              ) || null;
          if (dm) activeId = dm.id;
        }
        if (activeId && activeId !== dmId && window.history && window.history.replaceState) {
          /* normaliza o endereço para o ID real da conversa (sem
             disparar hashchange — o route já está rodando) */
          try {
            window.history.replaceState(null, "", "#/mensagens/" + activeId);
          } catch (e) {
            /* navegador sem suporte: a conversa abre do mesmo jeito */
          }
        }
        const allowed = !!(
          dm &&
          Array.isArray(dm.participants) &&
          dm.participants.indexOf(me.id) !== -1
        );
        if (!allowed) {
          /* O primeiro sync do boot ainda não rodou: o endereço está
             certo, só o cache que ainda não recebeu as conversas.
             O recupero de chamada dispara um commit (e o roteador)
             antes do sync aplicar os dados. Redirecionar aqui manda a
             pessoa para a lista e APAGA o endereço da conversa — era
             isso que fazia a conversa abrir "outra tela". Sai sem
             mexer no hash: o próximo route abre a conversa certa. */
          const cacheFrio = !!(
            NX.remote &&
            NX.remote.online &&
            !NX.remote.lastSyncAt
          );
          if (cacheFrio) return;
          /* a conversa não existe ou não é sua: avisa em vez de
             redirecionar em silêncio para a lista */
          try {
            NX.ui.toast(
              NX.i18n.get(
                "route.dmIndisponivel",
                "Não encontramos esta conversa. Ela pode ter sido removida ou você não tem acesso a ela."
              ),
              "warn"
            );
          } catch (e) {
            /* sem interface ainda: segue para a lista */
          }
          app.go("#/mensagens");
          return;
        }
        other = S().user(dm.participants.find((p) => p !== me.id) || dm.participants[0]);
        /* marca como lida DEPOIS do render (fora da pilha do route)
           para não causar reentrada quando houver não lidas */
        if (app.__reading !== activeId) {
          app.__reading = activeId;
          window.setTimeout(() => {
            app.__reading = null;
            try {
              NX.api.markDMRead(activeId);
            } catch (e) {
              /* sem sessão: mantém como não lida */
            }
          }, 0);
        }
      }
      next = { name: activeId ? "dm" : "messages", dmId: activeId, dmOtherId: other ? other.id : null };
    } else if (head === "explorar") {
      next = { name: "explore" };
    } else if (head === "amigos") {
      /* #/amigos · /todos · /online · /idle · /offline · /recebidas · /enviadas */
      const TABS = ["todos", "online", "idle", "offline", "recebidas", "enviadas"];
      const tab = TABS.indexOf(seg[1] || "") > -1 ? seg[1] : "todos";
      next = { name: "friends", tab: tab };
    } else if (head === "feed") {
      next = { name: "feed", postId: seg[1] || null };
    } else if (head === "bots") {
      next = { name: "bots" };
    } else if (head === "loja") {
      /* #/loja — loja de placas de nome (personalização) */
      next = { name: "shop" };
    } else if (head === "perfil") {
      /* aceita id ou @usuário (/perfil/username) */
      const raw = seg[1] ? String(decodeURIComponent(seg[1])) : "";
      const user = S().user(raw) || S().userByUsername(raw) || null;
      if (!user && raw) {
        /* cache frio do boot: sem dados ainda, esperar em vez de
           abrir o perfil errado (o hash não muda e o próximo
           route resolve com os dados em mãos) */
        const cacheFrio = !!(NX.remote && NX.remote.online && !NX.remote.lastSyncAt);
        if (cacheFrio) {
          waitForSyncBoot();
          return;
        }
      }
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
    /* rota resolvida: encerra uma eventual espera de sync de boot */
    syncWaitReset();
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
          (NX.i18n.get("app.4servicoplataforma", "4. Serviço — a plataforma é fornecida no estado em que está; recursos podem mudar e, em caso de indisponibilidade, o serviço retorna assim que possível.")),
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

  /* colapsar/abrir a seção "Ativo agora" da coluna de membros */
  A["toggle-active-now"] = () => {
    const ui = NX.store.ui;
    ui.activeNowCollapsed = !ui.activeNowCollapsed;
    NX.store.persistUI();
    NX.views.members();
  };

  A["open-dm"] = (el) => app.go("#/mensagens/" + el.getAttribute("data-id"));

  A["open-profile"] = (el) => app.go("#/perfil/" + el.getAttribute("data-id"));

  A["create-server"] = () => NX.modals.createServer();
  A["join-invite"] = () => NX.modals.joinServer();
  A["new-dm"] = () => NX.modals.newDM();

  /* menu da conversa na barra de Mensagens */
  A["dm-menu"] = async (el) => {
    const dmId = el.getAttribute("data-id");
    const dm = NX.store.db.dms[dmId];
    if (!dm) return;
    const me = S().me();

    /* ---- GRUPO: itens do grupo (abrir, adicionar, editar, sair) ---- */
    if (dm.isGroup) {
      const isAdmin = dm.adminId === me.id;
      const full = Number(dm.memberCount || (dm.participants || []).length) >= 10;
      const gItems = [
        {
          label: NX.i18n.get("view.abrirConversa", "Abrir conversa"),
          icon: "chat",
          onClick: () => app.go("#/mensagens/" + dmId),
        },
      ];
      if (isAdmin)
        gItems.push({
          label: NX.i18n.get("grp.adicionarMembros", "Adicionar membros"),
          icon: "userPlus",
          onClick: () => {
            if (full) NX.ui.toast(NX.i18n.get("grp.cheio", "Grupo cheio: 10/10 membros. Saia alguém para adicionar outra pessoa."), "warn");
            else NX.modals.groupAddMembers(dmId);
          },
        });
      if (isAdmin)
        gItems.push({
          label: NX.i18n.get("grp.editarGrupo", "Editar grupo"),
          icon: "settings",
          onClick: () => NX.modals.groupEdit(dmId),
        });
      gItems.push(
        { divider: true },
        {
          label: NX.i18n.get("grp.sairDoGrupo", "Sair do grupo"),
          icon: "logout",
          danger: true,
          onClick: () => A["group-leave"](dmId),
        }
      );
      NX.ui.menu(el, gItems, { align: "end" });
      return;
    }

    const otherId = (dm.participants || []).find((p) => p !== me.id) || dm.participants[0];
    const other = NX.store.db.users[otherId];
    const items = [
      {
        label: NX.i18n.get("view.abrirConversa", "Abrir conversa"),
        icon: "chat",
        onClick: () => app.go("#/mensagens/" + dmId),
      },
    ];
    if (other) {
      items.push({
        label: NX.i18n.get("view.verPerfil", "Ver perfil"),
        icon: "user",
        onClick: () => app.go("#/perfil/" + other.id),
      });
    }
    items.push(
      { divider: true },
      {
        label: NX.i18n.get("view.removerDaLista", "Remover da lista"),
        icon: "eyeOff",
        danger: true,
        onClick: () => A["dm-hide"](dmId),
      }
    );
    NX.ui.menu(el, items, { align: "end" });
  };

  /* tira a conversa da barra. A conversa, as mensagens e a amizade
     continuam intactas — é só uma escolha de exibição desta conta. */
  A["dm-hide"] = async (dmId) => {
    const ok = await NX.ui.confirm({
      title: NX.i18n.get("view.removerConversaDaLista", "Remover conversa da lista?"),
      message: NX.i18n.get(
        "view.aConversaEAsMensagensContinuamSalvasVocePode",
        "A conversa e as mensagens continuam salvas. Você pode restaurá-la a qualquer momento em \"Conversas ocultas\"."
      ),
      confirmLabel: NX.i18n.get("view.removerDaLista", "Remover da lista"),
      danger: true,
      icon: "eyeOff",
    });
    if (!ok) return;
    try {
      await NX.api.archiveDM(dmId, true);
      const r = NX.app.route;
      if (r && r.dmId === dmId) app.go("#/mensagens");
      NX.ui.toast(
        NX.i18n.get("view.conversaRemovidaDaLista", "Conversa removida da lista."),
        "success"
      );
    } catch (e) {
      NX.ui.error(e.message);
    }
  };

  A["dm-unhide"] = async (el) => {
    try {
      await NX.api.archiveDM(el.getAttribute("data-id"), false);
      NX.ui.toast(NX.i18n.get("view.conversaRestaurada", "Conversa restaurada."), "success");
    } catch (e) {
      NX.ui.error(e.message);
    }
  };

  A["dm-hidden"] = () => NX.modals.dmHidden();

  /* ================= GRUPOS PRIVADOS NAS DMs ================= */
  A["new-group"] = () => NX.modals.newGroup();

  /* silenciar/ativar notificações da conversa (grupo ou 1:1) */
  A["dm-mute"] = async (el) => {
    const dmId = el.getAttribute("data-id");
    const dm = NX.store.db.dms[dmId];
    if (!dm) return;
    try {
      await NX.api.muteDM(dmId, !dm.muted);
    } catch (e) {
      NX.ui.error(e.message);
    }
  };

  A["group-add"] = (el) => NX.modals.groupAddMembers(el.getAttribute("data-id"));
  A["group-edit"] = (el) => NX.modals.groupEdit(el.getAttribute("data-id"));

  A["group-remove-member"] = async (el) => {
    const dmId = el.getAttribute("data-id");
    const userId = el.getAttribute("data-user");
    const person = S().user(userId);
    const okRemove = await NX.ui.confirm({
      title: NX.i18n.get("grp.removerDoGrupo", "Remover do grupo?"),
      message:
        (person ? person.displayName : "@") +
        NX.i18n.get(
          "grp.vaiPerderAcesso",
          " vai perder o acesso a estas mensagens e não verá mais o grupo na lista."
        ),
      confirmLabel: NX.i18n.get("grp.remover", "Remover"),
      danger: true,
      icon: "x",
    });
    if (!okRemove) return;
    try {
      await NX.api.removeGroupMember(dmId, userId);
      NX.ui.toast(NX.i18n.get("grp.removido", "Pessoa removida do grupo."), "success");
    } catch (e) {
      NX.ui.error(e.message);
    }
  };

  /* aceita o botão (data-id) ou o próprio id (menus) */
  A["group-leave"] = async (el) => {
    const dmId = typeof el === "string" ? el : el.getAttribute("data-id");
    const okLeave = await NX.ui.confirm({
      title: NX.i18n.get("grp.sairDoGrupo", "Sair do grupo?"),
      message: NX.i18n.get(
        "grp.sairDoGrupoMsg",
        "Você deixará de ver este grupo na lista. As mensagens continuam guardadas para os outros participantes."
      ),
      confirmLabel: NX.i18n.get("grp.sair", "Sair"),
      danger: true,
      icon: "logout",
    });
    if (!okLeave) return;
    try {
      await NX.api.leaveGroup(dmId);
      const r = NX.app.route;
      if (r && r.dmId === dmId) app.go("#/mensagens");
      NX.ui.toast(NX.i18n.get("grp.voceSaiu", "Você saiu do grupo."), "success");
    } catch (e) {
      NX.ui.error(e.message);
    }
  };

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
    if (menuIsDrawer()) {
      const open = shell.classList.toggle("sidebar-open");
      document.getElementById("scrim").hidden = !open;
    } else {
      const off = shell.classList.toggle("sidebar-off");
      NX.storage.set(SIDEBAR_OFF_KEY, off ? "1" : "0");
    }
    syncMenuBtn();
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
    const id = el.getAttribute("data-id");
    try {
      /* a sala inteira (presença + WebRTC) é do NX.call — aqui só
         pedimos para entrar e mostramos o erro real, se houver */
      await NX.call.joinRoom(id);
    } catch (e) {
      NX.ui.error(e && e.message ? e.message : String(e));
    }
  };

  A["leave-voice"] = async () => {
    try {
      await NX.call.leaveRoom("left");
      NX.ui.toast(NX.i18n.get("app.desconectadoSala", "Desconectado da sala."), "success");
    } catch (e) {
      NX.ui.error(e && e.message ? e.message : String(e));
    }
  };

  /* microfone do dock (o mesmo estado da chamada, sem duplicar lógica) */
  A["voice-mic"] = () => {
    try {
      NX.call.toggleMic();
      /* o ícone do dock só existe nas telas: repinta depois da troca */
      NX.store.commit(["voice"]);
    } catch (e) {
      NX.ui.error(e && e.message ? e.message : String(e));
    }
  };

  /* restaurar a janela da sala (dock ou página do canal) */
  A["voice-restore"] = () => {
    try {
      const st = NX.call.roomState();
      if (!st) return;
      NX.call.restoreRoom();
      const ch = NX.selectors && NX.selectors.channel ? NX.selectors.channel(st.channelId) : null;
      if (ch && NX.app.route.channelId !== ch.id) location.hash = "#/s/" + ch.serverId + "/" + ch.id;
    } catch (e) {
      NX.ui.error(e && e.message ? e.message : String(e));
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

  /* ---------------- Bot Center (apps/bots) ---------------- */
  A["nav-bots"] = () => app.go("#/bots");
  A["bots-refresh"] = () => NX.bots.refresh();
  A["bots-tab"] = (el) => NX.bots.setTab(el.getAttribute("data-tab") || "");
  A["bots-cat"] = (el) => NX.bots.setCategory(el.getAttribute("data-cat") || "");
  A["bots-detail"] = (el) => NX.bots.openDetail(el.getAttribute("data-id"));
  A["bots-back"] = () => NX.bots.back();
  A["bots-clear"] = () => NX.bots.clearFilters();
  A["bots-install"] = (el) => NX.bots.install(el.getAttribute("data-id"));
  A["bots-configure"] = (el) => NX.bots.configure(el.getAttribute("data-id"));

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

    /* clique direito (ou tecla ContextMenu) num ícone de servidor do
       rail: abre o MESMO menu permissível do topo do servidor e
       bloqueia o menu padrão do navegador por cima. Servidores fora
       do rail continuam com o comportamento normal do navegador. */
    document.addEventListener("contextmenu", (e) => {
      const el = e.target.closest && e.target.closest('.rail__item[data-action="open-server"]');
      if (!el) return;
      e.preventDefault();
      try {
        NX.modals.serverMenu(el, el.getAttribute("data-id"));
      } catch (err) {
        console.error("[rail:contextmenu]", err);
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
        /* cruzou a faixa de 900px: reaplica a preferência de
           desktop e atualiza ícone/aria do botão */
        app.applySidebarPref();
        syncMenuBtn();
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

    /* preferência de menu: sidebar já recolhida em desktop */
    app.applySidebarPref();

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

    /* microfone/câmera/tela da sala mudaram: o dock mostra o mesmo
       estado da chamada (uma repintura, sem dado fake) */
    if (NX.bus && NX.bus.on) {
      const repaintVoice = () => NX.store.commit(["voice"]);
      NX.bus.on("call:roommedia", repaintVoice);
      /* entrou, saiu ou mudou de janela aberta/minimizada */
      NX.bus.on("call:roomjoined", repaintVoice);
      NX.bus.on("call:roomleft", repaintVoice);
      NX.bus.on("call:roomstate", repaintVoice);
    }

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
      (NX.i18n.get("app.cnexocomunidadesnexo", "%cNexo%c — comunidades em órbita.")),
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
