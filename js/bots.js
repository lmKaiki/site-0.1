/* ============================================================
   NEXO · Bot Center (apps/bots)
   ---------------------------------------------------------------------------
   Contrato público:
     NX.bots.page()                          → HTML da rota #/bots
     NX.bots.setTab(id) / setCategory(cat) / clearFilters()
     NX.bots.openDetail(appId) / back()
     NX.bots.refresh() / ensureLoaded(cb)
     NX.bots.install(appId, serverId?)        → modal de instalação
     NX.bots.configure(appId, onSaved?)       → modal (escolhe instalação)
     NX.bots.configureInstall(sid, iid, cb?)  → modal de configuração
     NX.bots.pickFor(serverId)                → modal "adicionar app"
   Observações:
     · catálogo REAL: NX.api.listApps (fallback NX.selectors.appsList)
     · um bot NÃO é pessoa: nunca consulta NX.selectors.user()
     · permissões concedidas = (permissões do app) ∩ (minhas no servidor)
     · auto-injeta css/bots.css quando o index.html ainda não o citou
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const u = () => NX.util;
  const S = () => NX.selectors;
  const t = (key, fallback) => NX.i18n.get(key, fallback);
  const esc = (s) => u().h(s === undefined || s === null ? "" : String(s));
  const ico = (n, size) => (typeof NX.icon === "function" ? NX.icon(n, "", size || 18) : "");

  /* ---------------- css próprio ---------------- */
  function ensureStyles() {
    if (document.querySelector('link[rel="stylesheet"][href*="bots.css"]')) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "css/bots.css";
    l.setAttribute("data-nx-bots", "1");
    document.head.appendChild(l);
  }
  ensureStyles();

  /* ---------------- constantes ---------------- */
  const CATEGORIES = [
    "🤝 Comunidade",
    "🛡️ Moderação",
    "👋 Boas-vindas",
    "🎫 Tickets",
    "📋 Logs",
    "🏷️ AutoRole",
    "🛠️ Utilidades",
    "🎮 Diversão",
  ];

  const TABS = [
    { id: "recomendados", label: () => t("bots.tabRecomendados", "Recomendados") },
    { id: "populares", label: () => t("bots.tabPopulares", "Populares") },
    { id: "meus", label: () => t("bots.tabMeus", "Meus apps") },
    { id: "catalogo", label: () => t("bots.tabCatalogo", "Catálogo") },
  ];

  /* chaves de configuração aceitas pelo backend (whitelist) */
  const CONFIG_KEYS = {
    app_nexo_welcome: ["enabled", "channelId", "message", "includeName", "includeAvatar"],
    app_nexo_mod: ["enabled", "warnNotify"],
    app_nexo_logs: ["enabled", "channelId", "events"],
    app_nexo_autorole: ["enabled", "roleId"],
    app_nexo_utils: ["enabled"],
  };

  const LOG_EVENTS = [
    { key: "join", label: () => t("bots.evEntradas", "Entradas de membros") },
    { key: "leave", label: () => t("bots.evSaidas", "Saídas de membros") },
    { key: "moderation", label: () => t("bots.evMod", "Ações de moderação") },
    { key: "channels", label: () => t("bots.evCanais", "Criação e exclusão de canais") },
  ];

  const state = {
    apps: [],
    loading: false,
    loaded: false,
    error: null,
    tab: "recomendados",
    category: null,
    query: "",
    appId: null,
    waiters: [],
  };

  /* ---------------- utilidades ---------------- */
  function norm(s) {
    let out = String(s || "").toLowerCase();
    try {
      out = out.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch (e) {
      /* navegadores sem normalize: mantém acentos */
    }
    return out;
  }

  function clip(s, n) {
    const str = String(s || "");
    return str.length > n ? str.slice(0, n - 1).trim() + "…" : str;
  }

  /* handle @de_bot derivado do id (nunca uma conta inventada) */
  function handleOf(app) {
    const raw = String((app && app.id) || "")
      .replace(/^app_/i, "")
      .replace(/[^a-z0-9_-]+/gi, "-");
    const clean = raw.toLowerCase().replace(/-+/g, "-").replace(/^-|-$/g, "");
    return "@" + (clean || "bot");
  }

  function permInfo(key) {
    const list = NX.PERMS || [];
    for (let i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return { key: key, label: key, desc: "", group: "" };
  }

  function me() {
    return S().me ? S().me() : null;
  }

  function catalog() {
    const sel = S().appsList ? S().appsList() : [];
    const live = (sel || []).filter((a) => a && a.enabled !== false);
    if (live.length) return live;
    return state.apps.filter((a) => a && a.enabled !== false);
  }

  function findApp(id) {
    if (!id) return null;
    if (S().app) {
      const fromStore = S().app(id);
      if (fromStore) return fromStore;
    }
    for (let i = 0; i < state.apps.length; i++) if (state.apps[i].id === id) return state.apps[i];
    return null;
  }

  function addToCatalog(app) {
    if (!app || !app.id) return;
    for (let i = 0; i < state.apps.length; i++) {
      if (state.apps[i].id === app.id) {
        state.apps[i] = app;
        return;
      }
    }
    state.apps.push(app);
  }

  /* servidores que eu consigo gerenciar (dono ou manageServer) */
  function managedServers() {
    const user = me();
    if (!user) return [];
    let servers = [];
    if (S().serversOf) servers = S().serversOf(user.id) || [];
    else if (typeof S().servers === "function") servers = S().servers() || [];
    else servers = Object.values((NX.store && NX.store.db && NX.store.db.servers) || {});
    return servers.filter(
      (s) => !!s && (s.ownerId === user.id || (S().can && S().can(s.id, user.id, "manageServer")))
    );
  }

  /* todas as instalações em servidores que eu consigo gerenciar */
  function myInstalls() {
    if (!S().installedApps) return [];
    const out = [];
    managedServers().forEach((s) => {
      const list = S().installedApps(s.id) || [];
      list.forEach((i) => {
        if (i) out.push(i);
      });
    });
    return out.sort((a, b) => (b.installedAt || 0) - (a.installedAt || 0));
  }

  function installsOfApp(appId) {
    return myInstalls().filter((i) => i.appId === appId);
  }

  /* permissões que EU posso conceder neste servidor para este app */
  function grantableKeys(app, serverId) {
    const user = me();
    if (!user || !app || !S().can) return [];
    const declared = Array.isArray(app.permissions) ? app.permissions : [];
    return declared.filter((k) => !!S().can(serverId, user.id, k));
  }

  /* ---------------- catálogo (carregamento) ---------------- */
  function flushWaiters() {
    const list = state.waiters.slice();
    state.waiters.length = 0;
    list.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error("[bots/waiter]", e);
      }
    });
  }

  function loadCatalog(force, onDone) {
    if (onDone) state.waiters.push(onDone);
    if (state.loading) return; /* termina: os waiters são chamados no fim */
    if (state.loaded && !force) {
      flushWaiters();
      return;
    }
    const fn = NX.api && typeof NX.api.listApps === "function" ? NX.api.listApps : null;
    if (!fn) {
      state.loading = false;
      state.loaded = true;
      if (!catalog().length) state.error = t("bots.apiIndisponivel", "O catálogo de apps ainda não está disponível.");
      flushWaiters();
      repaint();
      return;
    }
    state.loading = true;
    if (force) state.error = null;
    repaint();
    Promise.resolve()
      .then(() => fn.call(NX.api))
      .then((rows) => {
        state.loading = false;
        state.loaded = true;
        state.apps = Array.isArray(rows) ? rows.filter((a) => a && a.enabled !== false) : [];
        state.error = null;
        flushWaiters();
        repaint();
      })
      .catch((e) => {
        state.loading = false;
        state.loaded = true;
        state.error = (e && e.message) || t("bots.erroCarregar", "Não foi possível carregar os apps.");
        flushWaiters();
        repaint();
      });
  }

  function refresh() {
    state.loaded = false;
    state.error = null;
    loadCatalog(true);
  }

  function ensureLoaded(onDone) {
    loadCatalog(false, onDone || null);
  }

  /* ---------------- repaint / rerender ---------------- */
  function onBotsRoute() {
    return !!(NX.app && NX.app.route && NX.app.route.name === "bots");
  }

  function repaint() {
    if (!onBotsRoute()) return;
    if (state.appId) {
      const main = document.getElementById("main-content");
      if (main && !main.querySelector("[data-bots-results]")) {
        main.innerHTML = page();
      }
      return;
    }
    const cats = document.querySelector("[data-bots-cats]");
    const tabs = document.querySelector("[data-bots-tabs]");
    const res = document.querySelector("[data-bots-results]");
    if (cats) cats.innerHTML = catsHTML();
    if (tabs) tabs.innerHTML = tabsHTML();
    if (res) res.innerHTML = resultsHTML();
  }

  function rerender() {
    const main = document.getElementById("main-content");
    if (!main || !onBotsRoute()) return;
    main.innerHTML = page();
    main.scrollTop = 0;
  }

  /* ---------------- filtros ---------------- */
  function matchesQuery(app) {
    const q = norm(state.query);
    if (!q) return true;
    const hay = norm(
      [app.name, app.description, app.category, app.developer].join(" ")
    );
    return hay.indexOf(q) !== -1;
  }

  function byCategory(app) {
    return !state.category || app.category === state.category;
  }

  function filteredApps() {
    let list = catalog().slice();
    if (state.tab === "recomendados") {
      const official = list.filter((a) => a.developer === "Nexo Oficial");
      if (official.length) list = official;
      list.sort((a, b) => (b.installCount || 0) - (a.installCount || 0));
    } else if (state.tab === "populares") {
      list.sort((a, b) => (b.installCount || 0) - (a.installCount || 0));
    } else {
      list.sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")
      );
    }
    return list.filter((a) => byCategory(a) && matchesQuery(a));
  }

  function categoryCount(cat) {
    return catalog().filter((a) => a.category === cat && matchesQuery(a)).length;
  }

  function filteredInstalls(list) {
    return list.filter((i) => {
      const app = findApp(i.appId);
      if (!app) return !state.category; /* sem catálogo: mostra, salvo filtro */
      return byCategory(app) && matchesQuery(app);
    });
  }

  /* =========================================================
     HTML · página
     ========================================================= */
  function page() {
    if (state.appId) return detailHTML();
    return (
      '<div class="page bots">' +
      '<header class="bots-hero">' +
      '<span class="bots-hero__ico" aria-hidden="true">🤖</span>' +
      '<div class="bots-hero__txt">' +
      "<h1>" + esc(t("bots.titulo", "Bots / Apps")) + "</h1>" +
      "<p>" +
      esc(
        t(
          "bots.subtitulo",
          "Bots oficiais para os seus servidores. Cada app mostra suas permissões antes de ser instalado e pode ser configurado a qualquer momento."
        )
      ) +
      "</p></div>" +
      '<button type="button" class="btn btn--soft btn--sm bots-hero__btn" data-action="bots-refresh">' +
      ico("refresh", 16) + "<span>" + esc(t("bots.atualizar", "Atualizar")) + "</span></button>" +
      "</header>" +
      '<div class="bots-toolbar">' + searchHTML() + "</div>" +
      '<div class="bots-cats" data-bots-cats>' + catsHTML() + "</div>" +
      '<div class="bots-tabs" data-bots-tabs role="tablist">' + tabsHTML() + "</div>" +
      '<div class="bots-results" data-bots-results>' + resultsHTML() + "</div>" +
      "</div>"
    );
  }

  function searchHTML() {
    return (
      '<span class="bots-search">' +
      '<span class="bots-search__ico">' + ico("search", 17) + "</span>" +
      '<input class="input bots-search__input" type="search" autocomplete="off" data-bots-search ' +
      'value="' + esc(state.query) + '" ' +
      'placeholder="' + esc(t("bots.buscarPlaceholder", "Buscar por nome, descrição ou categoria")) + '" ' +
      'aria-label="' + esc(t("bots.buscarPlaceholder", "Buscar por nome, descrição ou categoria")) + '" />' +
      "</span>"
    );
  }

  function catsHTML() {
    let html =
      '<button type="button" class="bots-chip' + (!state.category ? " is-on" : "") +
      '" data-action="bots-cat" data-cat="">' +
      esc(t("bots.catTodas", "Todas")) +
      '<span class="bots-chip__n">' + catalog().filter(matchesQuery).length + "</span></button>";
    CATEGORIES.forEach((c) => {
      const n = categoryCount(c);
      html +=
        '<button type="button" class="bots-chip' +
        (state.category === c ? " is-on" : "") +
        (n ? "" : " is-empty") +
        '" data-action="bots-cat" data-cat="' + esc(c) + '" title="' +
        esc(n ? t("bots.comApps", "com apps") : t("bots.semAppsAinda", "sem apps por enquanto")) + '">' +
        esc(c) + '<span class="bots-chip__n">' + n + "</span></button>";
    });
    return html;
  }

  function tabsHTML() {
    const mine = myInstalls().length;
    return TABS.map((tb) => {
      const on = state.tab === tb.id;
      return (
        '<button type="button" role="tab" aria-selected="' + (on ? "true" : "false") +
        '" class="bots-tab' + (on ? " is-on" : "") +
        '" data-action="bots-tab" data-tab="' + tb.id + '">' +
        esc(tb.label()) +
        (tb.id === "meus" && mine ? '<span class="bots-tab__n">' + mine + "</span>" : "") +
        "</button>"
      );
    }).join("");
  }

  /* ---------------- estados ---------------- */
  function emptyHTML(iconName, title, text, actions) {
    return (
      '<div class="empty-state bots-empty">' +
      '<span class="empty-state__ico">' + ico(iconName, 26) + "</span>" +
      "<h3>" + esc(title) + "</h3><p>" + esc(text) + "</p>" +
      (actions ? '<div class="empty-state__actions">' + actions + "</div>" : "") +
      "</div>"
    );
  }

  function loadingHTML() {
    return (
      '<div class="bots-loading"><span class="spinner" aria-hidden="true"></span><span>' +
      esc(t("bots.carregando", "Carregando apps…")) +
      "</span></div>"
    );
  }

  function errorHTML() {
    return emptyHTML(
      "alert",
      t("bots.erroTitulo", "Não foi possível carregar os apps"),
      state.error || t("bots.erroCarregar", "Não foi possível carregar o catálogo de apps."),
      '<button type="button" class="btn btn--primary btn--sm" data-action="bots-refresh">' +
        esc(t("bots.tentarNovamente", "Tentar novamente")) +
        "</button>"
    );
  }

  function clearBtn(label) {
    return (
      '<button type="button" class="btn btn--soft btn--sm" data-action="bots-clear">' +
      esc(label) +
      "</button>"
    );
  }

  function noMatchHTML() {
    const q = String(state.query || "").trim();
    if (q) {
      return emptyHTML(
        "search",
        t("bots.semResultadoTitulo", "Nenhum app encontrado"),
        t("bots.semResultadoTexto", "Nenhum app corresponde a") + " «" + q + "».",
        clearBtn(t("bots.limparFiltros", "Limpar busca e filtros"))
      );
    }
    return emptyHTML(
      "grid",
      t("bots.categoriaVaziaTitulo", "Nenhum app nesta categoria"),
      t("bots.categoriaVaziaTexto", "Ainda não há apps publicados em") +
        " «" + String(state.category || "") + "». " +
        t("bots.categoriaVaziaHint", "Enquanto isso, veja o catálogo completo."),
      clearBtn(t("bots.verTodos", "Ver todos os apps"))
    );
  }

  function resultsHTML() {
    if (state.tab === "meus") return mineHTML();
    const hasData = catalog().length > 0;
    if (state.loading && !hasData) return loadingHTML();
    if (state.error && !hasData) return errorHTML();
    if (!hasData) {
      return emptyHTML(
        "grid",
        t("bots.vazioTitulo", "Nenhum app disponível"),
        t("bots.vazioTexto", "O catálogo ainda não tem apps publicados. Volte em alguns instantes."),
        '<button type="button" class="btn btn--primary btn--sm" data-action="bots-refresh">' +
          esc(t("bots.atualizar", "Atualizar")) +
          "</button>"
      );
    }
    const list = filteredApps();
    if (!list.length) return noMatchHTML();
    return '<div class="bots-grid">' + list.map(cardHTML).join("") + "</div>";
  }

  /* ---------------- cartão de app ---------------- */
  function botBadge() {
    return '<span class="bot-badge">🤖 ' + esc(t("bots.botTag", "Bot")) + "</span>";
  }

  function cardHTML(app) {
    const n = app.installCount || 0;
    return (
      '<article class="bot-card">' +
      '<div class="bot-card__top">' +
      '<span class="bot-card__avatar" aria-hidden="true">' + esc(app.avatar || "🤖") + "</span>" +
      '<div class="bot-card__id">' +
      '<h3 class="bot-card__name">' + esc(app.name || "—") + "</h3>" +
      '<span class="bot-card__meta">' + esc(app.category || "") +
      (app.developer ? " · " + esc(app.developer) : "") + "</span></div>" +
      botBadge() +
      "</div>" +
      '<p class="bot-card__desc">' + esc(clip(app.description || "", 150)) + "</p>" +
      '<div class="bot-card__foot">' +
      '<span class="bot-card__installs">' +
      esc(u().plural(n, t("bots.instalacao", "instalação"), t("bots.instalacoes", "instalações"))) +
      "</span>" +
      (installsOfApp(app.id).length
        ? '<span class="tag tag--on">' + esc(t("bots.instalado", "Instalado")) + "</span>"
        : "") +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn btn--soft btn--sm" data-action="bots-detail" data-id="' +
      esc(app.id) + '">' + esc(t("bots.verDetalhes", "Ver detalhes")) + "</button>" +
      "</div></article>"
    );
  }

  /* ---------------- meus apps ---------------- */
  function mineHTML() {
    const all = myInstalls();
    if (!all.length) {
      return emptyHTML(
        "grid",
        t("bots.nenhumMeuTitulo", "Nenhum app instalado"),
        t(
          "bots.nenhumMeuTexto",
          "Você ainda não adicionou apps aos seus servidores. Explore o catálogo e escolha um bot para começar."
        ),
        '<button type="button" class="btn btn--primary btn--sm" data-action="bots-tab" data-tab="catalogo">' +
          esc(t("bots.verCatalogo", "Ver catálogo")) +
          "</button>"
      );
    }
    const list = filteredInstalls(all);
    if (!list.length) return noMatchHTML();
    return '<div class="bots-grid">' + list.map(installCardHTML).join("") + "</div>";
  }

  function installCardHTML(install) {
    const app = findApp(install.appId);
    const server = S().server ? S().server(install.serverId) : null;
    const name = app ? app.name : install.appId;
    const desc = app && app.description ? app.description : t(
      "bots.catalogoCurto",
      "Os dados deste app aparecem assim que o catálogo terminar de carregar."
    );
    return (
      '<article class="bot-card bot-card--mine">' +
      '<div class="bot-card__top">' +
      '<span class="bot-card__avatar" aria-hidden="true">' + esc(app && app.avatar ? app.avatar : "🤖") + "</span>" +
      '<div class="bot-card__id">' +
      '<h3 class="bot-card__name">' + esc(name) + "</h3>" +
      '<span class="bot-card__meta">' + esc(app && app.category ? app.category : t("bots.app", "App")) + "</span></div>" +
      botBadge() +
      "</div>" +
      '<p class="bot-card__desc">' + esc(clip(desc, 130)) + "</p>" +
      '<div class="bot-card__tags">' +
      '<span class="tag ' + (install.enabled ? "tag--on" : "tag--off") + '">' +
      esc(install.enabled ? t("bots.ativo", "Ativo") : t("bots.desativado", "Desativado")) +
      "</span>" +
      (server ? '<span class="tag">' + esc(server.name) + "</span>" : "") +
      "</div>" +
      '<div class="bot-card__foot">' +
      '<button type="button" class="btn btn--ghost btn--sm" data-action="bots-detail" data-id="' +
      esc(install.appId) + '">' + esc(t("bots.verDetalhes", "Ver detalhes")) + "</button>" +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn btn--primary btn--sm" data-action="bots-configure" data-id="' +
      esc(install.id) + '" data-server="' + esc(install.serverId) + '">' +
      esc(t("bots.configurar", "Configurar")) + "</button>" +
      "</div></article>"
    );
  }

  /* =========================================================
     HTML · detalhe do app
     ========================================================= */
  function backBarHTML() {
    return (
      '<div class="bots-detail__bar">' +
      '<button type="button" class="btn btn--ghost btn--sm" data-action="bots-back">' +
      ico("arrowLeft", 16) + "<span>" + esc(t("bots.voltar", "Voltar")) + "</span></button>" +
      "</div>"
    );
  }

  function metaRow(label, value) {
    return (
      '<div class="bots-meta__row"><dt>' + esc(label) + "</dt><dd>" + esc(value) + "</dd></div>"
    );
  }

  function commandsHTML(app) {
    const cmds = Array.isArray(app.commands) ? app.commands : [];
    if (!cmds.length) {
      return (
        '<p class="bots-note">' +
        esc(
          t(
            "bots.semComandos",
            "Este app não expõe comandos de texto — ele reage automaticamente aos eventos do servidor."
          )
        ) +
        "</p>"
      );
    }
    return (
      '<ul class="bot-cmds">' +
      cmds
        .map(
          (c) =>
            '<li class="bot-cmd">' +
            '<code class="bot-cmd__usage">' + esc(c.usage || c.name) + "</code>" +
            '<span class="bot-cmd__txt"><strong>' + esc(c.name) + "</strong>" +
            (c.admin
              ? ' <span class="tag">' + esc(t("bots.cmdAdmin", "apenas administradores")) + "</span>"
              : "") +
            "<small>" + esc(c.description || "") + "</small></span></li>"
        )
        .join("") +
      "</ul>"
    );
  }

  function permsHTML(app) {
    const keys = Array.isArray(app.permissions) ? app.permissions : [];
    if (!keys.length) {
      return (
        '<p class="bots-note">' +
        esc(t("bots.semPermissoes", "Este app não pede permissões especiais no servidor.")) +
        "</p>"
      );
    }
    return (
      '<div class="bot-perms">' +
      keys
        .map((k) => {
          const p = permInfo(k);
          return (
            '<div class="bot-perm"><span class="bot-perm__ico">' + ico("shield", 17) + "</span>" +
            '<span class="bot-perm__txt"><strong>' + esc(p.label) + "</strong>" +
            (p.desc ? "<small>" + esc(p.desc) + "</small>" : "") +
            "</span></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function detailHTML() {
    const app = findApp(state.appId);
    if (!app) {
      return (
        '<div class="page bots bots--detail">' + backBarHTML() +
        emptyHTML(
          "alert",
          t("bots.naoEncontradoTitulo", "App não encontrado"),
          t("bots.naoEncontradoTexto", "Este app não está disponível no catálogo no momento."),
          clearBtn(t("bots.voltarAoCatalogo", "Voltar ao catálogo"))
        ) +
        "</div>"
      );
    }

    const mine = installsOfApp(app.id);
    let acts =
      '<button type="button" class="btn btn--primary" data-action="bots-install" data-id="' +
      esc(app.id) + '">' + ico("plus", 16) +
      "<span>" + esc(t("bots.adicionarAoServidor", "Adicionar ao servidor")) + "</span></button>";

    if (mine.length) {
      acts +=
        '<button type="button" class="btn btn--soft" data-action="bots-configure" data-id="' +
        esc(app.id) + '">' + esc(t("bots.configurar", "Configurar")) + "</button>" +
        '<span class="tag tag--on">' +
        esc(
          u().plural(mine.length, t("bots.instaladoEm1", "Instalado em 1 servidor"), t("bots.instaladoEmN", "Instalado em servidores"))
        ) +
        "</span>";
    } else {
      acts =
        acts +
        '<p class="bots-note bots-note--wide">' +
        esc(
          t(
            "bots.configurarHint",
            "Instale este app em um servidor que você gerencia para poder configurá-lo."
          )
        ) +
        "</p>";
    }

    return (
      '<div class="page bots bots--detail">' +
      backBarHTML() +
      '<article class="bot-detail">' +
      '<header class="bot-detail__head">' +
      '<span class="bot-detail__avatar" aria-hidden="true">' + esc(app.avatar || "🤖") + "</span>" +
      '<div class="bot-detail__id">' +
      "<h1>" + esc(app.name || "—") + "</h1>" +
      '<span class="bot-detail__handle mono">' + esc(handleOf(app)) + "</span>" +
      '<div class="bot-detail__tags">' + botBadge() +
      (app.category ? '<span class="tag">' + esc(app.category) + "</span>" : "") +
      "</div></div></header>" +
      '<p class="bot-detail__desc">' + esc(app.description || "") + "</p>" +
      '<dl class="bots-meta">' +
      metaRow(t("bots.criador", "Criador / Publisher"), app.developer || "—") +
      metaRow(t("bots.categoria", "Categoria"), app.category || "—") +
      metaRow(
        t("bots.instalacoesLabel", "Instalações"),
        u().plural(app.installCount || 0, t("bots.instalacao", "instalação"), t("bots.instalacoes", "instalações"))
      ) +
      "</dl>" +
      '<section class="bots-sec"><h2>' + esc(t("bots.comandos", "Comandos")) + "</h2>" +
      commandsHTML(app) + "</section>" +
      '<section class="bots-sec"><h2>' + esc(t("bots.permissoes", "Permissões")) + "</h2>" +
      '<p class="bots-note">' +
      esc(t("bots.permissoesIntro", "Permissões que este app pede ao ser instalado em um servidor.")) +
      "</p>" + permsHTML(app) + "</section>" +
      '<footer class="bot-detail__acts">' + acts + "</footer>" +
      "</article></div>"
    );
  }

  /* =========================================================
     MODAL · instalação
     ========================================================= */
  function showErr(root, msg) {
    if (!root) {
      if (msg) NX.ui.error(msg);
      return;
    }
    const box = root.querySelector("[data-bots-error]");
    if (!box) {
      if (msg) NX.ui.error(msg);
      return;
    }
    box.hidden = !msg;
    box.innerHTML = msg ? ico("alert", 16) + "<span>" + esc(msg) + "</span>" : "";
  }

  function withApp(appId, cb) {
    const found = findApp(appId);
    if (found) return cb(found);
    if (NX.api && typeof NX.api.getApp === "function") {
      return Promise.resolve()
        .then(() => NX.api.getApp(appId))
        .then((app) => {
          if (app) {
            addToCatalog(app);
            cb(app);
          } else {
            NX.ui.error(t("bots.naoEncontradoTexto", "Este app não está disponível no catálogo no momento."));
          }
        })
        .catch((e) => {
          NX.ui.error((e && e.message) || t("bots.erroCarregar", "Não foi possível carregar o catálogo de apps."));
        });
    }
    NX.ui.error(t("bots.apiIndisponivel", "O catálogo de apps ainda não está disponível."));
    return null;
  }

  function permRowsHTML(app, serverId, preselected) {
    const keys = grantableKeys(app, serverId);
    if (!keys.length) {
      return (
        '<p class="bots-note">' +
        esc(
          t(
            "bots.semPermissaoConceder",
            "Você não tem permissões compatíveis com este app neste servidor. O app pode ser instalado, mas não receberá permissão para agir."
          )
        ) +
        "</p>"
      );
    }
    return (
      '<div class="perm-list">' +
      keys
        .map((k) => {
          const p = permInfo(k);
          const on = preselected.indexOf(k) !== -1;
          return (
            '<label class="perm-row"><span class="perm-row__txt"><strong>' + esc(p.label) +
            "</strong><small>" + esc(p.desc) + "</small></span>" +
            '<span class="switch"><input type="checkbox" name="perm_' + esc(k) + '"' +
            (on ? " checked" : "") + " /><i></i></span></label>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function installFormHTML(app, servers, startId) {
    return (
      '<form novalidate>' +
      '<p class="bots-note">' +
      esc(
        t(
          "bots.instalarIntro",
          "Escolha o servidor e revise as permissões que o bot vai receber. Só é possível instalar em servidores que você gerencia."
        )
      ) +
      "</p>" +
      '<label class="field"><span class="field__label">' + esc(t("bots.servidor", "Servidor")) + "</span>" +
      '<select class="select" name="serverId" data-autofocus>' +
      servers
        .map(
          (s) =>
            '<option value="' + esc(s.id) + '"' + (s.id === startId ? " selected" : "") + ">" +
            esc(s.name) + "</option>"
        )
        .join("") +
      "</select></label>" +
      '<div class="bots-perms">' +
      '<span class="bots-perms__title">' + esc(t("bots.permissoesSolicitadas", "Permissões que o bot receberá")) + "</span>" +
      '<div class="bots-perms__note">' + ico("lock", 16) + "<span>" +
      esc(t("bots.somenteSuasPermissoes", "Você só pode conceder permissões que você mesmo possui.")) +
      "</span></div>" +
      '<div data-bots-perms></div></div>' +
      '<div class="form-error" data-bots-error hidden></div>' +
      "</form>"
    );
  }

  function openInstall(appId, presetServerId) {
    withApp(appId, function (app) {
      const user = me();
      if (!user) {
        if (NX.app) NX.app.go("#/login");
        return;
      }
      const servers = managedServers();
      if (!servers.length) {
        const m0 = NX.ui.modal({
          title: t("bots.adicionarAoServidor", "Adicionar ao servidor"),
          eyebrow: "🤖 " + (app.name || ""),
          size: "sm",
        });
        m0.body.innerHTML = emptyHTML(
          "users",
          t("bots.semServidoresTitulo", "Nenhum servidor para instalar"),
          t(
            "bots.semServidoresTexto",
            "Você precisa ser dono ou ter a permissão “Gerenciar servidor” para adicionar apps. Crie um servidor ou peça a quem administra."
          ),
          ""
        );
        return;
      }

      const startId =
        presetServerId && servers.some((s) => s.id === presetServerId)
          ? presetServerId
          : servers[0].id;

      const footer = u().el(
        '<div class="modal__actions">' +
        '<button class="btn btn--ghost" type="button" data-modal-close>' +
        esc(t("common.cancel", "Cancelar")) + "</button>" +
        '<button class="btn btn--primary" type="submit" data-busy-label="' +
        esc(t("bots.instalando", "Instalando…")) + '">' +
        esc(t("bots.confirmarInstalacao", "Confirmar instalação")) + "</button></div>"
      );

      const m = NX.ui.modal({
        title: t("bots.adicionarAoServidor", "Adicionar ao servidor"),
        eyebrow: "🤖 " + (app.name || ""),
        size: "md",
        footer: footer,
      });
      m.body.innerHTML = installFormHTML(app, servers, startId);

      const form = m.body.querySelector("form");
      const permsBox = m.body.querySelector("[data-bots-perms]");
      const sel = form.elements.serverId;
      const paintPerms = () => {
        const keys = grantableKeys(app, sel.value);
        permsBox.innerHTML = permRowsHTML(app, sel.value, keys);
      };
      paintPerms();
      sel.addEventListener("change", paintPerms);

      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        showErr(m.body, "");
        if (!NX.api || typeof NX.api.installApp !== "function") {
          showErr(m.body, t("bots.apiIndisponivel", "O catálogo de apps ainda não está disponível."));
          return;
        }
        const serverId = sel.value;
        const keys = grantableKeys(app, serverId);
        const perms = keys.filter((k) => {
          const el = form.elements["perm_" + k];
          return el && el.checked;
        });
        const btn = footer.querySelector('button[type="submit"]');
        const end = NX.ui.busy(btn);
        Promise.resolve()
          .then(() => NX.api.installApp(serverId, { appId: app.id, permissions: perms }))
          .then(() => {
            end();
            m.close();
            NX.ui.toast(
              t("bots.instaladoComSucesso", "App instalado com sucesso!"),
              "success"
            );
            refresh();
          })
          .catch((e) => {
            end();
            showErr(m.body, (e && e.message) || t("bots.erroInstalar", "Não foi possível instalar o app."));
          });
      });
    });
  }

  /* =========================================================
     MODAL · configuração
     ========================================================= */
  function switchRow(name, label, on, hint) {
    return (
      '<label class="bots-row bots-row--switch"><span class="bots-row__txt">' +
      "<strong>" + esc(label) + "</strong>" +
      (hint ? "<small>" + esc(hint) + "</small>" : "") +
      '</span><span class="switch"><input type="checkbox" name="' + esc(name) + '"' +
      (on ? " checked" : "") + " /><i></i></span></label>"
    );
  }

  function textChannelOptions(serverId) {
    const list = S().channelsOf ? S().channelsOf(serverId) || [] : [];
    return list.filter((c) => c && c.type === "text");
  }

  function channelFieldHTML(serverId, value) {
    const chans = textChannelOptions(serverId);
    let html =
      '<label class="field"><span class="field__label">' + esc(t("bots.canal", "Canal")) + "</span>" +
      '<select class="select" name="cfg_channel">' +
      '<option value="">' + esc(t("bots.canalPadrao", "Padrão (primeiro canal de texto)")) + "</option>";
    chans.forEach((c) => {
      html +=
        '<option value="' + esc(c.id) + '"' + (c.id === value ? " selected" : "") + ">#" +
        esc(c.name) + "</option>";
    });
    html += "</select>";
    if (!chans.length) {
      html +=
        '<span class="field__hint">' +
        esc(t("bots.semCanais", "Este servidor ainda não tem canais de texto.")) +
        "</span>";
    }
    html += "</label>";
    return html;
  }

  function roleFieldHTML(serverId, value) {
    const roles = (S().rolesOf ? S().rolesOf(serverId) || [] : []).filter((r) => !r.isDefault);
    let html =
      '<label class="field"><span class="field__label">' + esc(t("bots.cargo", "Cargo")) + "</span>" +
      '<select class="select" name="cfg_role">' +
      '<option value="">' + esc(t("bots.cargoNenhum", "Nenhum cargo")) + "</option>";
    roles.forEach((r) => {
      html +=
        '<option value="' + esc(r.id) + '"' + (r.id === value ? " selected" : "") + ">" +
        esc((r.icon ? r.icon + " " : "") + r.name) + "</option>";
    });
    html += "</select>";
    if (!roles.length) {
      html +=
        '<span class="field__hint">' +
        esc(t("bots.semCargos", "Crie um cargo em Configurações → Cargos para usar este recurso.")) +
        "</span>";
    }
    html += "</label>";
    return html;
  }

  function eventsFieldHTML(ev) {
    return (
      '<div class="bots-row"><span class="bots-row__txt"><strong>' +
      esc(t("bots.eventos", "Eventos registrados")) + "</strong>" +
      "<small>" + esc(t("bots.eventosHint", "Marque o que o bot deve escrever no canal de logs.")) +
      "</small></span><div class=\"bots-checks\">" +
      LOG_EVENTS.map(
        (e) =>
          '<label class="bots-check"><input type="checkbox" name="ev_' + e.key + '"' +
          (ev[e.key] !== false ? " checked" : "") + " /><span>" + esc(e.label()) + "</span></label>"
      ).join("") +
      "</div></div>"
    );
  }

  function configFieldsHTML(serverId, appId, cfg) {
    cfg = cfg || {};
    const keys = CONFIG_KEYS[appId] || ["enabled"];
    let html = "";
    if (keys.indexOf("enabled") !== -1) {
      html += switchRow(
        "cfg_enabled",
        t("bots.cfgAtivo", "Ativar app neste servidor"),
        cfg.enabled !== false,
        t("bots.cfgAtivoHint", "Desative para pausar as ações do bot sem remover a instalação.")
      );
    }
    if (keys.indexOf("channelId") !== -1) html += channelFieldHTML(serverId, cfg.channelId || "");
    if (keys.indexOf("message") !== -1) {
      html +=
        '<label class="field"><span class="field__label">' + esc(t("bots.mensagem", "Mensagem")) + "</span>" +
        '<textarea class="input input--area" name="cfg_message" rows="3" maxlength="400">' +
        esc(cfg.message || "") + "</textarea>" +
        '<span class="field__hint">' +
        esc(
          t(
            "bots.mensagemHint",
            "Use {usuario} para citar a pessoa, {nome} para o nome dela e {servidor} para o nome do servidor."
          )
        ) +
        "</span></label>";
    }
    if (keys.indexOf("includeName") !== -1) {
      html += switchRow(
        "cfg_includeName",
        t("bots.incluirNome", "Incluir nome do usuário"),
        cfg.includeName !== false,
        ""
      );
    }
    if (keys.indexOf("includeAvatar") !== -1) {
      html += switchRow(
        "cfg_includeAvatar",
        t("bots.incluirAvatar", "Incluir avatar"),
        cfg.includeAvatar !== false,
        ""
      );
    }
    if (keys.indexOf("warnNotify") !== -1) {
      html += switchRow(
        "cfg_warnNotify",
        t("bots.notificarAdvertido", "Notificar a pessoa advertida"),
        cfg.warnNotify !== false,
        ""
      );
    }
    if (keys.indexOf("roleId") !== -1) html += roleFieldHTML(serverId, cfg.roleId || "");
    if (keys.indexOf("events") !== -1) html += eventsFieldHTML(cfg.events || {});
    return html;
  }

  function readConfig(form, appId) {
    const keys = CONFIG_KEYS[appId] || ["enabled"];
    const out = {};
    const val = (name) => (form.elements[name] ? form.elements[name] : null);
    keys.forEach((k) => {
      if (k === "enabled") out.enabled = !!(val("cfg_enabled") && val("cfg_enabled").checked);
      else if (k === "channelId") out.channelId = val("cfg_channel") ? val("cfg_channel").value : "";
      else if (k === "roleId") out.roleId = val("cfg_role") ? val("cfg_role").value : "";
      else if (k === "message") out.message = String(val("cfg_message") ? val("cfg_message").value : "").slice(0, 400);
      else if (k === "includeName") out.includeName = !!(val("cfg_includeName") && val("cfg_includeName").checked);
      else if (k === "includeAvatar") out.includeAvatar = !!(val("cfg_includeAvatar") && val("cfg_includeAvatar").checked);
      else if (k === "warnNotify") out.warnNotify = !!(val("cfg_warnNotify") && val("cfg_warnNotify").checked);
      else if (k === "events") {
        const ev = {};
        LOG_EVENTS.forEach((e) => {
          const el = val("ev_" + e.key);
          ev[e.key] = !el || !!el.checked;
        });
        out.events = ev;
      }
    });
    return out;
  }

  function openConfigure(serverId, installId, onSaved) {
    const installs = S().installedApps ? S().installedApps(serverId) || [] : [];
    const install = installs.filter((i) => i && i.id === installId)[0];
    if (!install) {
      NX.ui.error(t("bots.instalacaoNaoEncontrada", "Esta instalação não foi encontrada."));
      return;
    }
    const app = findApp(install.appId);
    if (!app) {
      NX.ui.error(t("bots.catalogoIndisponivel", "O catálogo de apps não está disponível no momento."));
      ensureLoaded(() => openConfigure(serverId, installId, onSaved));
      return;
    }

    const server = S().server ? S().server(serverId) : null;
    const granted = Array.isArray(install.permissions) ? install.permissions.slice() : [];
    const keys = grantableKeys(app, serverId);
    const ungrantable = granted.filter((k) => keys.indexOf(k) === -1);

    const footer = u().el(
      '<div class="modal__actions">' +
      '<button class="btn btn--ghost" type="button" data-modal-close>' +
      esc(t("common.cancel", "Cancelar")) + "</button>" +
      '<button class="btn btn--primary" type="submit" data-busy-label="' +
      esc(t("bots.salvando", "Salvando…")) + '">' +
      esc(t("common.save", "Salvar")) + "</button></div>"
    );

    const m = NX.ui.modal({
      title: t("bots.configurarApp", "Configurar app"),
      eyebrow: "🤖 " + (app.name || "") + (server ? " · " + server.name : ""),
      size: "md",
      footer: footer,
    });

    let body =
      '<form novalidate>' +
      '<div class="bots-perms"><span class="bots-perms__title">' +
      esc(t("bots.permissoesConcedidas", "Permissões do bot")) + "</span>" +
      '<div class="bots-perms__note">' + ico("lock", 16) + "<span>" +
      esc(t("bots.somenteSuasPermissoes", "Você só pode conceder permissões que você mesmo possui.")) +
      "</span></div>";

    if (keys.length) {
      body += permRowsHTML(app, serverId, granted);
    } else {
      body +=
        '<p class="bots-note">' +
        esc(
          granted.length
            ? t(
                "bots.permissoesOutros",
                "As permissões atuais foram concedidas por outra pessoa e serão mantidas como estão."
              )
            : t("bots.semPermissoes", "Este app não pede permissões especiais no servidor.")
        ) +
        "</p>";
    }
    if (ungrantable.length && keys.length) {
      body +=
        '<p class="bots-note">' +
        esc(
          t(
            "bots.permissoesOutros",
            "As permissões atuais foram concedidas por outra pessoa e serão mantidas como estão."
          )
        ) +
        "</p>";
    }
    body += "</div>";

    body +=
      '<div class="bots-config"><span class="bots-perms__title">' +
      esc(t("bots.configuracao", "Configuração")) + "</span>" +
      configFieldsHTML(serverId, app.id, install.configuration || {}) +
      "</div>" +
      '<div class="form-error" data-bots-error hidden></div></form>';

    m.body.innerHTML = body;

    const form = m.body.querySelector("form");
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      showErr(m.body, "");
      if (!NX.api || typeof NX.api.updateServerApp !== "function") {
        showErr(m.body, t("bots.apiIndisponivel", "O catálogo de apps ainda não está disponível."));
        return;
      }
      const patch = { configuration: readConfig(form, app.id) };
      /* só envio permissões quando consigo representar todas as atuais */
      if (!ungrantable.length) {
        patch.permissions = keys.filter((k) => {
          const el = form.elements["perm_" + k];
          return el && el.checked;
        });
      }
      const btn = footer.querySelector('button[type="submit"]');
      const end = NX.ui.busy(btn);
      Promise.resolve()
        .then(() => NX.api.updateServerApp(serverId, installId, patch))
        .then(() => {
          end();
          m.close();
          NX.ui.toast(t("bots.configuracaoSalva", "Configuração salva."), "success");
          refresh();
          if (typeof onSaved === "function") onSaved();
        })
        .catch((e) => {
          end();
          showErr(m.body, (e && e.message) || t("bots.erroSalvar", "Não foi possível salvar."));
        });
    });
  }

  function configure(appId, onSaved) {
    const list = installsOfApp(appId);
    if (!list.length) {
      NX.ui.toast(
        t(
          "bots.configurarHint",
          "Instale este app em um servidor que você gerencia para poder configurá-lo."
        ),
        "warn"
      );
      return;
    }
    if (list.length === 1) return openConfigure(list[0].serverId, list[0].id, onSaved);

    /* várias instalações: deixa escolher o servidor */
    const footer = u().el(
      '<div class="modal__actions"><button class="btn btn--ghost" type="button" data-modal-close>' +
      esc(t("common.cancel", "Cancelar")) + "</button></div>"
    );
    const m = NX.ui.modal({
      title: t("bots.configurarApp", "Configurar app"),
      eyebrow: "🤖 " + (findApp(appId) ? findApp(appId).name : appId),
      size: "sm",
      footer: footer,
    });
    m.body.innerHTML =
      '<label class="field"><span class="field__label">' + esc(t("bots.servidor", "Servidor")) + "</span>" +
      '<select class="select" name="serverId" data-autofocus>' +
      list
        .map((i) => {
          const s = S().server ? S().server(i.serverId) : null;
          return '<option value="' + esc(i.serverId) + '">' + esc(s ? s.name : i.serverId) + "</option>";
        })
        .join("") +
      "</select></label>" +
      '<div class="modal__actions">' +
      '<button type="button" class="btn btn--primary" data-bots-go>' +
      esc(t("bots.configurar", "Configurar")) + "</button></div>";
    const go = m.body.querySelector("[data-bots-go]");
    go.addEventListener("click", () => {
      const sid = m.body.querySelector('[name="serverId"]').value;
      const inst = list.filter((i) => i.serverId === sid)[0];
      if (!inst) return;
      m.close();
      openConfigure(inst.serverId, inst.id, onSaved);
    });
  }

  /* =========================================================
     MODAL · escolher app para instalar num servidor (admin)
     ========================================================= */
  function pickFor(serverId) {
    const server = S().server ? S().server(serverId) : null;
    const m = NX.ui.modal({
      title: t("bots.adicionarAppTitulo", "Adicionar app"),
      eyebrow: server ? server.name : "",
      size: "md",
    });

    const paint = () => {
      const installed = (S().installedApps ? S().installedApps(serverId) || [] : [])
        .map((i) => i.appId);
      const list = catalog().filter((a) => installed.indexOf(a.id) === -1);
      if (!list.length) {
        m.body.innerHTML = catalog().length
          ? emptyHTML(
              "check",
              t("bots.todosInstalados", "Todos os apps já estão instalados"),
              t("bots.todosInstaladosTexto", "Este servidor já recebeu todos os apps do catálogo."),
              ""
            )
          : loadingHTML();
        return;
      }
      m.body.innerHTML =
        '<div class="bots-pick">' +
        list
          .map(
            (a) =>
              '<div class="bots-pick__row">' +
              '<span class="bots-pick__ico" aria-hidden="true">' + esc(a.avatar || "🤖") + "</span>" +
              '<span class="bots-pick__txt"><strong>' + esc(a.name) + "</strong>" +
              "<small>" + esc(a.category || "") + (a.developer ? " · " + esc(a.developer) : "") +
              "</small></span>" + botBadge() +
              '<span class="spacer"></span>' +
              '<button type="button" class="btn btn--primary btn--sm" data-pick="' + esc(a.id) + '">' +
              esc(t("bots.adicionar", "Adicionar")) + "</button></div>"
          )
          .join("") +
        "</div>";
      u().qa("[data-pick]", m.body).forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-pick");
          m.close();
          openInstall(id, serverId);
        });
      });
    };

    paint();
    if (!catalog().length) ensureLoaded(paint);
  }

  /* =========================================================
     AÇÕES (registradas em js/app.js)
     ========================================================= */
  function setTab(tab) {
    if (!TABS.some((x) => x.id === tab)) return;
    state.tab = tab;
    state.appId = null;
    rerender();
  }

  function setCategory(cat) {
    state.category = cat || null;
    rerender();
  }

  function clearFilters() {
    state.query = "";
    state.category = null;
    state.appId = null;
    rerender();
  }

  function openDetail(appId) {
    state.appId = appId || null;
    rerender();
  }

  function back() {
    state.appId = null;
    rerender();
  }

  /* busca ao vivo: repinta só as áreas filtradas (mantém o foco) */
  document.addEventListener("input", (e) => {
    const el = e && e.target;
    if (!el || !el.matches || !el.matches("[data-bots-search]")) return;
    state.query = el.value || "";
    repaint();
  });

  /* sair da rota limpa o detalhe aberto */
  window.addEventListener("hashchange", () => {
    state.appId = null;
  });

  /* ---------------- API pública ---------------- */
  NX.bots = {
    page: page,
    setTab: setTab,
    setCategory: setCategory,
    clearFilters: clearFilters,
    openDetail: openDetail,
    back: back,
    refresh: refresh,
    ensureLoaded: ensureLoaded,
    install: openInstall,
    configure: configure,
    configureInstall: openConfigure,
    pickFor: pickFor,
    app: findApp,
    managedServers: managedServers,
    myInstalls: myInstalls,
    state: state,
  };
})(window.NX);
