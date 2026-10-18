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
    "Comunidade",
    "Moderação",
    "Boas-vindas",
    "Tickets",
    "Logs",
    "AutoRole",
    "Utilidades",
    "Diversão",
    "Música",
  ];

  /* rótulo legível e ícone próprio de cada categoria.
     Antigamente a chave de dados carregava um emoji junto com o nome
     ("👋 Boas-vindas"); agora o catálogo grava só o nome. As duas
     formas convivem: `catLabel` tira o prefixo e o mapa é consultado
     pelo nome já limpo, então linhas antigas continuam funcionando. */
  const CAT_ICONS = {
    Comunidade: "users",
    Moderação: "shield",
    "Boas-vindas": "home",
    Tickets: "ticket",
    Logs: "list",
    AutoRole: "tag",
    Utilidades: "tool",
    Diversão: "gamepad",
    Música: "play",
  };
  function catLabel(cat) {
    return String(cat || "").replace(/^[^\p{L}\p{N}]+\s*/u, "").trim();
  }
  function catIcon(cat) {
    const n = CAT_ICONS[catLabel(cat)];
    return n ? NX.icon(n, "", 13) + " " : "";
  }

  /* avatar do app: nome de ícone SVG do Nexo quando existe; se o banco
     ainda guardou um emoji antigo, ele é exibido como está (dado já
     gravado, não um ícone de UI escolhido pela interface). */
  function botAvatarHTML(app, size) {
    const v = app && app.avatar;
    const s = size || 20;
    if (v && NX.hasIcon(v)) return NX.icon(v, "", s);
    if (v) return '<span class="bot-card__glyph">' + esc(v) + "</span>";
    return NX.icon("bot", "", s);
  }

  const TABS = [
    { id: "recomendados", label: () => t("bots.tabRecomendados", "Recomendados") },
    { id: "populares", label: () => t("bots.tabPopulares", "Populares") },
    { id: "meus", label: () => t("bots.tabMeus", "Meus apps") },
    { id: "meusbots", label: () => t("bots.tabMeusBots", "Meus bots") },
    { id: "tickets", label: () => t("bots.tabTickets", "Tickets") },
    { id: "criar", label: () => t("bots.tabCriar", "Criar um Bot") },
    { id: "catalogo", label: () => t("bots.tabCatalogo", "Catálogo") },
  ];

  /* categorias aceitas para bots criados por usuários (mesma lista
     branca do backend — nada de categoria inventada) */
  const BOT_CATEGORIES = ["Comunidade", "Moderação", "Diversão", "Utilidades", "Logs"];

  /* ações fechadas do editor: nenhum código de terceiros roda aqui
     ou no servidor — só estes três tipos existem de verdade */
  const ACTION_TYPES = [
    { id: "responder", label: () => t("bots.acResponder", "Responder com uma mensagem") },
    { id: "aleatorio", label: () => t("bots.acAleatorio", "Respostas aleatórias de uma lista") },
    { id: "info", label: () => t("bots.acInfo", "Informações do servidor") },
  ];

  const BOT_MAX_COMMANDS = 10;
  const BOT_MAX_BOTS = 5;

  function actionLabel(type) {
    for (let i = 0; i < ACTION_TYPES.length; i++)
      if (ACTION_TYPES[i].id === type) return ACTION_TYPES[i].label();
    return String(type || "");
  }

  /* chaves de configuração aceitas pelo backend (whitelist) */
  const CONFIG_KEYS = {
    app_nexo_welcome: ["enabled", "channelId", "message", "includeName", "includeAvatar"],
    app_nexo_mod: ["enabled", "warnNotify", "spamEnabled", "spamLimit", "spamWindow", "spamAction"],
    app_nexo_logs: ["enabled", "channelId", "events"],
    app_nexo_autorole: ["enabled", "roleId"],
    app_nexo_utils: ["enabled"],
    app_nexo_ajuda: ["enabled", "rules"],
    app_nexo_enquete: ["enabled", "pollAllowChange"],
    app_nexo_lembrete: ["enabled"],
    /* app_nexo_musica não instala: nenhuma chave de configuração */
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
    /* bots criados por você (editor visual) */
    myBots: [],
    myBotsLoaded: false,
    myBotsLoading: false,
    myBotsError: null,
    editor: null,
    /* tickets do Bot Center (canal privado por chamado) */
    ticketsServerId: null,
    tickets: [],
    ticketsLoading: false,
    ticketsError: null,
    ticketsLoaded: false,
    panel: null,
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
    return !state.category || catLabel(app.category) === state.category;
  }

  function filteredApps() {
    let list = catalog().slice();
    /* "Recomendados" mostra os apps oficiais — MAS quem está procurando
       precisa achar qualquer app pelo nome/categoria: com busca ou
       categoria ativa, a tela vira uma busca de catálogo de verdade. */
    const procurando = !!norm(state.query) || !!state.category;
    if (state.tab === "recomendados" && !procurando) {
      const official = list.filter((a) => a.developer === "Nexo Oficial");
      if (official.length) list = official;
      list.sort((a, b) => (b.installCount || 0) - (a.installCount || 0));
    } else if (state.tab === "recomendados" || state.tab === "populares") {
      list.sort((a, b) => (b.installCount || 0) - (a.installCount || 0));
    } else {
      list.sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")
      );
    }
    return list.filter((a) => byCategory(a) && matchesQuery(a));
  }

  function categoryCount(cat) {
    return catalog().filter((a) => catLabel(a.category) === cat && matchesQuery(a)).length;
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
    const noHud = state.tab === "criar";
    return (
      '<div class="page bots' + (noHud ? " bots--nohud" : "") + '">' +
      '<header class="bots-hero">' +
      '<span class="bots-hero__ico" aria-hidden="true">' + NX.icon("bot", "", 26) + '</span>' +
      '<div class="bots-hero__txt">' +
      "<h1>" + esc(t("bots.titulo", "Bots / Apps")) + "</h1>" +
      "<p>" +
      esc(
        t(
          "bots.subtitulo",
          "Aplicativos que trabalham sozinhos nos seus servidores — não são pessoas e nunca aparecem nas suas conversas diretas. Cada app mostra suas permissões antes de ser instalado e pode ser configurado ou removido a qualquer momento."
        )
      ) +
      "</p></div>" +
      '<button type="button" class="btn btn--primary btn--sm bots-hero__btn" data-bot-act="criar">' +
      ico("plus", 16) + "<span>" + esc(t("bots.criarBot", "Criar um Bot")) + "</span></button>" +
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
        catIcon(c) + esc(catLabel(c)) + '<span class="bots-chip__n">' + n + "</span></button>";
    });
    return html;
  }

  function tabsHTML() {
    const mine = myInstalls().length;
    const created = state.myBots.length;
    return TABS.map((tb) => {
      const on = state.tab === tb.id;
      const badge =
        (tb.id === "meus" && mine) || (tb.id === "meusbots" && created)
          ? '<span class="bots-tab__n">' + (tb.id === "meus" ? mine : created) + "</span>"
          : "";
      return (
        '<button type="button" role="tab" aria-selected="' + (on ? "true" : "false") +
        '" class="bots-tab' + (on ? " is-on" : "") +
        '" data-action="bots-tab" data-tab="' + tb.id + '">' +
        esc(tb.label()) +
        badge +
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
    if (state.tab === "criar") return editorHTML();
    if (state.tab === "meusbots") return myBotsHTML();
    if (state.tab === "meus") return mineHTML();
    if (state.tab === "tickets") return ticketsHTML();
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

  /* =========================================================
     TICKETS · painel de atendimento (Bot Center)
     Cada chamado vira um canal PRIVADO com código TICKET-000N.
     Tudo é conferido no backend (staff, participante, migração
     0003) — aqui só espelhamos o estado real, inclusive o 503
     "schema_pending" quando a tabela ainda não existe.
     ========================================================= */
  function ticketServers() {
    /* qualquer MEMBRO pode abrir chamado; quem é equipe gerencia
       (fechar/reabrir/assumir). O backend valida cada ação — aqui
       só mostramos os servidores em que a pessoa está. */
    const user = me();
    if (!user) return [];
    if (S().serversOf) return S().serversOf(user.id) || [];
    return managedServers();
  }

  function isStaff(serverId) {
    const user = me();
    if (!user || !serverId) return false;
    const s = S().server ? S().server(serverId) : null;
    if (s && s.ownerId === user.id) return true;
    return !!(S().can && S().can(serverId, user.id, "manageServer"));
  }

  function ensureTickets(serverId) {
    if (!serverId) return;
    if (state.ticketsServerId !== serverId) {
      state.ticketsServerId = serverId;
      state.ticketsLoaded = false;
      state.tickets = [];
      state.ticketsError = null;
      state.panel = null;
    }
    if (state.ticketsLoading || state.ticketsLoaded) return;
    state.ticketsLoading = true;
    state.ticketsError = null;
    repaint();
    Promise.all([
      NX.api.listTickets(serverId).catch((e) => { state.ticketsError = e; return null; }),
      isStaff(serverId) ? NX.api.getTicketPanel(serverId).catch(() => null) : Promise.resolve(null),
    ])
      .then((r) => {
        if (r[0]) state.tickets = r[0] || [];
        if (r[1] !== undefined && r[1] !== null) state.panel = r[1];
      })
      .finally(() => {
        state.ticketsLoading = false;
        state.ticketsLoaded = true;
        repaint();
      });
  }

  function ticketStatusLabel(st) {
    if (st === "closed") return t("bots.ticketFechado", "Fechado");
    return t("bots.ticketAberto", "Aberto");
  }

  function ticketRowHTML(tk) {
    const staff = isStaff(state.ticketsServerId);
    const closed = tk.status === "closed";
    return (
      '<div class="ticket-row' + (closed ? " is-closed" : "") + '">' +
      '<div class="ticket-row__main">' +
      '<span class="ticket-row__code">' + esc(tk.code) + "</span>" +
      '<span class="ticket-row__subject">' + esc(tk.subject) + "</span>" +
      '<span class="tag ' + (closed ? "tag--muted" : "tag--ok") + '">' + esc(ticketStatusLabel(tk.status)) + "</span>" +
      "</div>" +
      '<div class="ticket-row__acts">' +
      (staff
        ? closed
          ? '<button type="button" class="btn btn--soft btn--sm" data-bot-act="ticket-reopen" data-id="' + esc(tk.id) + '">' +
              ico("refresh", 15) + "<span>" + esc(t("bots.ticketReabrir", "Reabrir")) + "</span></button>"
          : '<button type="button" class="btn btn--soft btn--sm" data-bot-act="ticket-close" data-id="' + esc(tk.id) + '">' +
              ico("check", 15) + "<span>" + esc(t("bots.ticketFechar", "Fechar")) + "</span></button>"
        : "") +
      (tk.channelId
        ? '<button type="button" class="btn btn--ghost btn--sm" data-bot-act="ticket-goto" data-id="' + esc(tk.channelId) + '">' +
            ico("message", 15) + "<span>" + esc(t("bots.ticketAbrirCanal", "Abrir canal")) + "</span></button>"
        : "") +
      "</div>" +
      "</div>"
    );
  }

  function ticketsHTML() {
    const servers = ticketServers();
    if (!servers.length) {
      return emptyHTML(
        "ticket",
        t("bots.ticketSemServidorTitulo", "Você ainda não está em nenhum servidor"),
        t(
          "bots.ticketSemServidorTexto",
          "Tickets são abertos dentro de um servidor. Entre em um servidor para abrir um chamado para a equipe."
        ),
        ""
      );
    }
    const sid = state.ticketsServerId || servers[0].id;
    if (state.ticketsServerId !== sid) { state.ticketsServerId = sid; state.ticketsLoaded = false; }

    const sel =
      '<label class="field"><span class="field__label">' + esc(t("bots.servidor", "Servidor")) + "</span>" +
      '<select class="select" data-tickets-server>' +
      servers
        .map((s) => '<option value="' + esc(s.id) + '"' + (s.id === sid ? " selected" : "") + ">" + esc(s.name) + "</option>")
        .join("") +
      "</select></label>";

    const staff = isStaff(sid);
    const head =
      '<div class="tickets-head">' +
      '<div class="tickets-head__txt"><h2>' + esc(t("bots.ticketTitulo", "Tickets")) + "</h2>" +
      "<p>" + esc(t("bots.ticketIntro", "Chamados abertos pelos membros. Cada um vira um canal privado da equipe.")) + "</p></div>" +
      '<button type="button" class="btn btn--primary btn--sm" data-bot-act="ticket-open">' +
      ico("plus", 16) + "<span>" + esc(t("bots.ticketNovo", "Abrir chamado")) + "</span></button>" +
      "</div>";

    if (state.ticketsLoading && !state.tickets.length) return head + sel + loadingHTML();
    if (state.ticketsError) {
      /* erro honesto: se for schema_pending, a mensagem do servidor
         (migração 0003) é mostrada como está — nada de fingir lista vazia */
      const msg = (state.ticketsError && state.ticketsError.message) || t("bots.ticketErro", "Não foi possível carregar os tickets.");
      return (
        head + sel +
        '<div class="tickets-alert">' + ico("alert", 18) +
        "<div><strong>" + esc(t("bots.ticketErroTitulo", "Painel indisponível")) + "</strong>" +
        "<p>" + esc(msg) + "</p></div></div>"
      );
    }
    if (!state.tickets.length) {
      return head + sel + emptyHTML("ticket", t("bots.ticketVazioTitulo", "Nenhum chamado"), t("bots.ticketVazioTexto", "Quando um membro abrir um chamado, ele aparece aqui."), "");
    }
    return head + sel + '<div class="tickets-list">' + state.tickets.map(ticketRowHTML).join("") + "</div>";
  }

  /* ---------------- cartão de app ---------------- */
  function botBadge() {
    return '<span class="bot-badge">' + NX.icon("bot", "", 13) + " " + esc(t("bots.botTag", "Bot")) + "</span>";
  }

  /* selo honesto: o que já funciona aqui vs. o que depende de
     integração externa (ex.: servidor de áudio para música) */
  function statusBadge(app) {
    if (app && app.integration === "external") {
      return (
        '<span class="tag tag--warn">' + ico("alert", 13) + " " +
        esc(t("bots.statusExternal", "Requer integração externa")) + "</span>"
      );
    }
    return (
      '<span class="tag tag--ok">' + esc(t("bots.statusImplemented", "Implementado")) + "</span>"
    );
  }

  function isExternal(app) {
    return !!(app && app.integration === "external");
  }

  function externalNoteHTML() {
    return (
      '<p class="bots-note bots-note--wide bots-note--warn">' + ico("alert", 16) + "<span>" +
      esc(
        t(
          "bots.externalInstallHint",
          "A instalação está desabilitada: tocar música exige um servidor de áudio externo (um player de streaming) que o Nexo ainda não possui. Preferimos dizer isso a mostrar um botão que não funciona."
        )
      ) + "</span></p>"
    );
  }

  function cardHTML(app) {
    const n = app.installCount || 0;
    return (
      '<article class="bot-card">' +
      '<div class="bot-card__top">' +
      '<span class="bot-card__avatar" aria-hidden="true">' + botAvatarHTML(app, 20) + "</span>" +
      '<div class="bot-card__id">' +
      '<h3 class="bot-card__name">' + esc(app.name || "—") + "</h3>" +
      '<span class="bot-card__meta">' + esc(catLabel(app.category)) +
      (app.developer ? " · " + esc(app.developer) : "") + "</span></div>" +
      botBadge() +
      "</div>" +
      '<p class="bot-card__desc">' + esc(clip(app.description || "", 150)) + "</p>" +
      '<div class="bot-card__tags">' + statusBadge(app) + "</div>" +
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
      '<span class="bot-card__avatar" aria-hidden="true">' + botAvatarHTML(app, 20) + "</span>" +
      '<div class="bot-card__id">' +
      '<h3 class="bot-card__name">' + esc(name) + "</h3>" +
      '<span class="bot-card__meta">' + (app && app.category ? esc(catLabel(app.category)) : esc(t("bots.app", "App"))) + "</span></div>" +
      botBadge() +
      "</div>" +
      '<p class="bot-card__desc">' + esc(clip(desc, 130)) + "</p>" +
      '<div class="bot-card__tags">' +
      '<span class="tag ' + (install.enabled ? "tag--on" : "tag--off") + '">' +
      esc(install.enabled ? t("bots.ativo", "Ativo") : t("bots.desativado", "Desativado")) +
      "</span>" +
      (app ? statusBadge(app) : "") +
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
            (c.action && c.action.type
              ? ' <span class="tag">' + esc(actionLabel(c.action.type)) + "</span>"
              : "") +
            (c.admin
              ? ' <span class="tag">' + esc(t("bots.cmdAdmin", "apenas administradores")) + "</span>"
              : "") +
            (c.external
              ? ' <span class="tag tag--warn">' + esc(t("bots.cmdExternal", "requer integração externa")) + "</span>"
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
    let acts = "";
    if (isExternal(app)) {
      /* app que depende de integração externa: NÃO tem botão de
         instalar — a nota diz exatamente o que falta. */
      acts = externalNoteHTML();
    } else {
      acts =
        '<button type="button" class="btn btn--primary" data-action="bots-install" data-id="' +
        esc(app.id) + '">' + ico("plus", 16) +
        "<span>" + esc(t("bots.adicionarAoServidor", "Adicionar ao servidor")) + "</span></button>";
    }

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

    /* bot de usuário: quem criou edita/publica/exclui; os outros
       denunciam (a denúncia vai para o criador + moderação) */
    if (app.custom && app.custom.ownerId) {
      if (isOwnerOf(app)) {
        acts =
          '<button type="button" class="btn btn--primary" data-bot-act="editar" data-id="' +
          esc(app.id) + '">' + esc(t("bots.editar", "Editar")) + "</button>" +
          '<button type="button" class="btn btn--soft" data-bot-act="publicar" data-id="' +
          esc(app.id) + '">' +
          esc(app.custom.published ? t("bots.despublicar", "Despublicar") : t("bots.publicar", "Publicar")) +
          "</button>" +
          acts;
      } else if (app.custom.published) {
        acts +=
          '<button type="button" class="btn btn--ghost bots-danger" data-bot-act="denunciar" data-id="' +
          esc(app.id) + '">' + esc(t("bots.denunciar", "Denunciar")) + "</button>";
      }
    }

    const welcomeSection =
      app.custom && app.custom.welcome
        ? '<section class="bots-sec"><h2>' +
          esc(t("bots.apresentacao", "Mensagem de apresentação")) +
          '</h2><p class="bots-note">' +
          esc(
            t(
              "bots.apresentacaoHint",
              "Publicada quando alguém entra em um servidor onde o bot está instalado."
            )
          ) +
          '</p><p class="bot-welcome">“' + esc(app.custom.welcome) + "”</p></section>"
        : "";

    return (
      '<div class="page bots bots--detail">' +
      backBarHTML() +
      '<article class="bot-detail">' +
      '<header class="bot-detail__head">' +
      '<span class="bot-detail__avatar" aria-hidden="true">' + botAvatarHTML(app, 26) + "</span>" +
      '<div class="bot-detail__id">' +
      "<h1>" + esc(app.name || "—") + "</h1>" +
      '<span class="bot-detail__handle mono">' + esc(handleOf(app)) + "</span>" +
      '<div class="bot-detail__tags">' + botBadge() + statusBadge(app) +
      (app.category ? '<span class="tag">' + esc(catLabel(app.category)) + "</span>" : "") +
      "</div></div></header>" +
      '<p class="bot-detail__desc">' + esc(app.description || "") + "</p>" +
      '<dl class="bots-meta">' +
      metaRow(t("bots.criador", "Criador / Publisher"), ownerLabel(app)) +
      metaRow(t("bots.categoria", "Categoria"), catLabel(app.category) || "—") +
      metaRow(
        t("bots.instalacoesLabel", "Instalações"),
        u().plural(app.installCount || 0, t("bots.instalacao", "instalação"), t("bots.instalacoes", "instalações"))
      ) +
      "</dl>" +
      '<section class="bots-sec"><h2>' + esc(t("bots.comandos", "Comandos")) + "</h2>" +
      commandsHTML(app) + "</section>" +
      welcomeSection +
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
      '<form id="form-app-install" novalidate>' +
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
      /* app de integração externa: nunca abre o formulário — mostra
         por que não dá para instalar (o backend também recusa). */
      if (isExternal(app)) {
        const mx = NX.ui.modal({
          title: t("bots.externalTitulo", "Requer integração externa"),
          eyebrow: app.name || "",
          size: "sm",
        });
        mx.body.innerHTML = emptyHTML(
          "alert",
          t("bots.externalTitulo", "Requer integração externa"),
          t(
            "bots.externalTexto",
            "Tocar música exige um servidor de áudio externo (um player de streaming) que o Nexo ainda não possui. Enquanto essa integração não existir, a instalação fica desabilitada — nenhum comando deste app funcionaria."
          ),
          ""
        );
        return;
      }
      const servers = managedServers();
      if (!servers.length) {
        const m0 = NX.ui.modal({
          title: t("bots.adicionarAoServidor", "Adicionar ao servidor"),
          eyebrow: app.name || "",
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
        '<button class="btn btn--primary" type="submit" form="form-app-install" data-busy-label="' +
        esc(t("bots.instalando", "Instalando…")) + '">' +
        esc(t("bots.confirmarInstalacao", "Confirmar instalação")) + "</button></div>"
      );

      const m = NX.ui.modal({
        title: t("bots.adicionarAoServidor", "Adicionar ao servidor"),
        eyebrow: app.name || "",
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

  function numberFieldHTML(name, label, value, min, max, hint) {
    return (
      '<label class="field"><span class="field__label">' + esc(label) + "</span>" +
      '<input class="input" type="number" name="' + esc(name) + '" min="' + min + '" max="' + max +
      '" value="' + esc(String(value)) + '" />' +
      (hint ? '<span class="field__hint">' + esc(hint) + "</span>" : "") +
      "</label>"
    );
  }

  function selectFieldHTML(name, label, value, options, hint) {
    return (
      '<label class="field"><span class="field__label">' + esc(label) + "</span>" +
      '<select class="select" name="' + esc(name) + '">' +
      options
        .map(
          (o) =>
            '<option value="' + esc(o[0]) + '"' + (o[0] === value ? " selected" : "") + ">" +
            esc(o[1]) + "</option>"
        )
        .join("") +
      "</select>" +
      (hint ? '<span class="field__hint">' + esc(hint) + "</span>" : "") +
      "</label>"
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
    if (keys.indexOf("spamEnabled") !== -1) {
      html += switchRow(
        "cfg_spamEnabled",
        t("bots.cfgSpamAtivo", "Anti-spam (excesso de mensagens)"),
        cfg.spamEnabled === true,
        t(
          "bots.cfgSpamHint",
          "Quando ativado, quem enviar mensagens rápidas demais no canal tem a mensagem nova bloqueada (o bot explica) e tudo fica registrado nos logs. Só quem modera é dispensado."
        )
      );
    }
    if (keys.indexOf("spamLimit") !== -1) {
      html += numberFieldHTML(
        "cfg_spamLimit",
        t("bots.cfgSpamLimite", "Mensagens permitidas na janela"),
        cfg.spamLimit !== undefined ? cfg.spamLimit : 8,
        2, 50,
        t("bots.cfgSpamLimiteHint", "De 2 a 50 mensagens.")
      );
    }
    if (keys.indexOf("spamWindow") !== -1) {
      html += numberFieldHTML(
        "cfg_spamWindow",
        t("bots.cfgSpamJanela", "Janela de tempo (segundos)"),
        cfg.spamWindow !== undefined ? cfg.spamWindow : 10,
        3, 300,
        t("bots.cfgSpamJanelaHint", "De 3 a 300 segundos. O limite conta as mensagens dessa janela.")
      );
    }
    if (keys.indexOf("spamAction") !== -1) {
      html += selectFieldHTML(
        "cfg_spamAction",
        t("bots.cfgSpamAcao", "Ao estourar o limite"),
        cfg.spamAction === "clear" ? "clear" : "block",
        [
          ["block", t("bots.cfgSpamBlock", "Bloquear só a mensagem nova")],
          ["clear", t("bots.cfgSpamClear", "Apagar as mensagens excedentes também")],
        ],
        t(
          "bots.cfgSpamAcaoHint",
          "“Apagar” exige que o bot receba a permissão Apagar mensagens na instalação; sem ela, o comportamento volta a ser bloquear."
        )
      );
    }
    if (keys.indexOf("rules") !== -1) {
      html +=
        '<label class="field"><span class="field__label">' + esc(t("bots.regras", "Regras do servidor")) + "</span>" +
        '<textarea class="input input--area" name="cfg_rules" rows="5" maxlength="2000">' +
        esc(cfg.rules || "") + "</textarea>" +
        '<span class="field__hint">' +
        esc(t("bots.regrasHint", "Escreva as regras: todo membro vê com /regras no chat. Deixe vazio para mostrar o aviso de “regras não escritas”.")) +
        "</span></label>";
    }
    if (keys.indexOf("pollAllowChange") !== -1) {
      html += switchRow(
        "cfg_pollAllowChange",
        t("bots.cfgTrocaVoto", "Permitir trocar o voto na enquete"),
        cfg.pollAllowChange === true,
        t(
          "bots.cfgTrocaVotoHint",
          "Desligado (padrão): cada pessoa tem 1 voto por enquete e votos duplicados são recusados. Ligado: um novo voto substitui o anterior — nunca conta duas vezes."
        )
      );
    }
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
      else if (k === "spamEnabled") out.spamEnabled = !!(val("cfg_spamEnabled") && val("cfg_spamEnabled").checked);
      else if (k === "spamLimit") {
        const n = parseInt(val("cfg_spamLimit") ? val("cfg_spamLimit").value : "", 10);
        out.spamLimit = isNaN(n) ? 8 : Math.max(2, Math.min(50, n));
      } else if (k === "spamWindow") {
        const n = parseInt(val("cfg_spamWindow") ? val("cfg_spamWindow").value : "", 10);
        out.spamWindow = isNaN(n) ? 10 : Math.max(3, Math.min(300, n));
      } else if (k === "spamAction") {
        out.spamAction = val("cfg_spamAction") && val("cfg_spamAction").value === "clear" ? "clear" : "block";
      } else if (k === "rules") {
        out.rules = String(val("cfg_rules") ? val("cfg_rules").value : "").slice(0, 2000);
      } else if (k === "pollAllowChange") {
        out.pollAllowChange = !!(val("cfg_pollAllowChange") && val("cfg_pollAllowChange").checked);
      } else if (k === "events") {
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
      '<button class="btn btn--danger-soft" type="button" data-bots-remove>' +
      esc(t("bots.removerApp", "Remover app")) + "</button>" +
      '<button class="btn btn--ghost" type="button" data-modal-close>' +
      esc(t("common.cancel", "Cancelar")) + "</button>" +
      '<button class="btn btn--primary" type="submit" form="form-app-config" data-busy-label="' +
      esc(t("bots.salvando", "Salvando…")) + '">' +
      esc(t("common.save", "Salvar")) + "</button></div>"
    );

    const m = NX.ui.modal({
      title: t("bots.configurarApp", "Configurar app"),
      eyebrow: (app.name || "") + (server ? " · " + server.name : ""),
      size: "md",
      footer: footer,
    });

    let body =
      '<form id="form-app-config" novalidate>' +
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
      const cfg = readConfig(form, app.id);
      const patch = { configuration: cfg };
      /* `enabled` é campo da INSTALAÇÃO (liga/desliga o bot de
         verdade), não da configuração: precisa sair no topo do
         pedido, senão o bot continua agindo no servidor */
      if (Object.prototype.hasOwnProperty.call(cfg, "enabled")) {
        patch.enabled = !!cfg.enabled;
      }
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

    /* remover a instalação: o app deixa de agir no servidor e pode
       ser instalado de novo depois (a ação é confirmada) */
    const removeBtn = footer.querySelector("[data-bots-remove]");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        if (!NX.api || typeof NX.api.removeServerApp !== "function") {
          showErr(m.body, t("bots.apiIndisponivel", "O catálogo de apps ainda não está disponível."));
          return;
        }
        NX.ui.confirm({
          title: t("bots.removerTitulo", "Remover este app do servidor?"),
          message: t(
            "bots.removerMensagem",
            "O app para de agir neste servidor e as configurações dele são apagadas. Você pode instalar novamente quando quiser."
          ),
          note: t("bots.removerNota", "As mensagens já enviadas pelo app continuam no histórico."),
          confirmLabel: t("bots.removerApp", "Remover app"),
          danger: true,
        }).then((yes) => {
          if (!yes) return;
          showErr(m.body, "");
          const end = NX.ui.busy(removeBtn);
          NX.api
            .removeServerApp(serverId, installId)
            .then(() => {
              end();
              m.close();
              NX.ui.toast(t("bots.removido", "App removido do servidor."), "success");
              refresh();
              if (typeof onSaved === "function") onSaved();
            })
            .catch((e) => {
              end();
              showErr(m.body, (e && e.message) || t("bots.erroRemover", "Não foi possível remover o app."));
            });
        });
      });
    }
  }

  function configure(appIdOrInstallId, onSaved) {
    /* o botão do detalhe passa o id do APP; o botão do cartão de
       "Meus apps" passa o id da INSTALAÇÃO (sa_…). Aceita os dois. */
    let list = installsOfApp(appIdOrInstallId);
    if (!list.length) {
      list = myInstalls().filter((i) => i && i.id === appIdOrInstallId);
    }
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
      eyebrow: (findApp(appIdOrInstallId) ? findApp(appIdOrInstallId).name : appIdOrInstallId),
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
      const available = catalog().filter((a) => installed.indexOf(a.id) === -1);
      const external = available.filter((a) => isExternal(a));
      const list = available.filter((a) => !isExternal(a));
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
              '<span class="bots-pick__ico" aria-hidden="true">' + botAvatarHTML(a, 20) + "</span>" +
              '<span class="bots-pick__txt"><strong>' + esc(a.name) + "</strong>" +
              "<small>" + esc(catLabel(a.category)) + (a.developer ? " · " + esc(a.developer) : "") +
              "</small></span>" + botBadge() +
              '<span class="spacer"></span>' +
              '<button type="button" class="btn btn--primary btn--sm" data-pick="' + esc(a.id) + '">' +
              esc(t("bots.adicionar", "Adicionar")) + "</button></div>"
          )
          .join("") +
        "</div>" +
        (external.length
          ? '<p class="bots-note bots-note--warn">' + ico("alert", 15) + "<span>" +
            esc(
              t(
                "bots.pickExternalNote",
                "Fora desta lista: apps que dependem de integração externa ainda inexistente no Nexo (a instalação deles está desabilitada)."
              )
            ) + "</span></p>"
          : "");
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
     MEUS BOTS · lista do que você criou (gravado no servidor)
     ========================================================= */
  function findMyBot(id) {
    if (!id) return null;
    for (let i = 0; i < state.myBots.length; i++)
      if (state.myBots[i] && state.myBots[i].id === id) return state.myBots[i];
    return null;
  }

  function isOwnerOf(app) {
    const owner = app && app.custom ? app.custom.ownerId : null;
    const user = me();
    return !!(owner && user && owner === user.id);
  }

  /* quem criou, sem expor id cru (o backend já serve o @ quando sabe) */
  function ownerLabel(app) {
    if (!app || !app.custom || !app.custom.ownerId) return app.developer || "—";
    const user = me();
    if (user && app.custom.ownerId === user.id) return t("bots.ownerVoce", "você");
    const u = S().user ? S().user(app.custom.ownerId) : null;
    if (u) return "@" + (u.username || u.displayName || u.id);
    if (app.developer && app.developer !== app.custom.ownerId) return app.developer;
    return "—";
  }

  function loadMyBots(force, onDone) {
    if (state.myBotsLoading) return;
    if (state.myBotsLoaded && !force) {
      if (onDone) onDone();
      return;
    }
    const fn = NX.api && typeof NX.api.listMyBots === "function" ? NX.api.listMyBots : null;
    if (!fn) {
      state.myBotsLoaded = true;
      state.myBotsError = t("bots.apiIndisponivel", "O catálogo de apps ainda não está disponível.");
      repaint();
      if (onDone) onDone();
      return;
    }
    state.myBotsLoading = true;
    state.myBotsError = null;
    repaint();
    Promise.resolve()
      .then(() => fn.call(NX.api))
      .then((rows) => {
        state.myBotsLoading = false;
        state.myBotsLoaded = true;
        state.myBots = Array.isArray(rows) ? rows.filter((r) => r && r.id) : [];
        state.myBotsError = null;
        repaint();
        if (onDone) onDone();
      })
      .catch((e) => {
        state.myBotsLoading = false;
        state.myBotsLoaded = true;
        state.myBots = [];
        state.myBotsError =
          (e && e.message) || t("bots.erroCarregar", "Não foi possível carregar os bots.");
        repaint();
        if (onDone) onDone();
      });
  }

  function ensureMyBots() {
    if (!state.myBotsLoaded && !state.myBotsLoading) loadMyBots(false);
  }

  function filteredMyBots() {
    return state.myBots.filter((b) => b && matchesQuery(b) && byCategory(b));
  }

  function myBotsHTML() {
    if (!me()) {
      return emptyHTML(
        "shield",
        t("bots.meusBotsSemSessaoTitulo", "Entre para criar bots"),
        t(
          "bots.meusBotsSemSessaoTexto",
          "Seus bots ficam ligados à sua conta: entre para criar, editar, testar e publicar os seus."
        ),
        ""
      );
    }
    if (state.myBotsLoading && !state.myBots.length) return loadingHTML();
    if (state.myBotsError && !state.myBots.length) {
      return emptyHTML(
        "alert",
        t("bots.meusBotsErroTitulo", "Não foi possível carregar seus bots"),
        state.myBotsError,
        '<button type="button" class="btn btn--primary btn--sm" data-bot-act="recarregar">' +
          esc(t("bots.tentarNovamente", "Tentar novamente")) +
          "</button>"
      );
    }
    if (!state.myBots.length) {
      return emptyHTML(
        "bot",
        t("bots.meusBotsVazioTitulo", "Você ainda não criou nenhum bot"),
        t(
          "bots.meusBotsVazioTexto",
          "Monte os comandos no editor visual — sem programar — e instale o seu bot em servidores que você gerencia."
        ),
        '<button type="button" class="btn btn--primary btn--sm" data-bot-act="criar">' +
          esc(t("bots.criarBot", "Criar um Bot")) +
          "</button>"
      );
    }
    const list = filteredMyBots();
    if (!list.length) return noMatchHTML();
    return '<div class="bots-grid">' + list.map(myBotCardHTML).join("") + "</div>";
  }

  function myBotCardHTML(bot) {
    const published = !!(bot.custom && bot.custom.published);
    const total = bot.installCount || 0;
    const mine = installsOfApp(bot.id);
    const others = Math.max(0, total - mine.length);
    const reports = (bot.custom && bot.custom.reports) || 0;
    const commands = Array.isArray(bot.commands) ? bot.commands : [];
    const user = me();

    let installs = "";
    if (mine.length) {
      installs =
        '<div class="bot-mine__row"><span class="bot-mine__label">' +
        esc(t("bots.instaladoEm", "Instalado em")) +
        "</span>" +
        mine
          .map((i) => {
            const s = S().server ? S().server(i.serverId) : null;
            const canRemove =
              !!user &&
              (!!s &&
                (s.ownerId === user.id || (S().can && S().can(i.serverId, user.id, "manageServer"))));
            return (
              '<span class="tag' + (i.enabled === false ? " tag--off" : "") + '">' +
              esc(s ? s.name : i.serverId) +
              (canRemove
                ? ' <button type="button" class="bot-mine__x" data-bot-act="desinstalar" data-install="' +
                  esc(i.id) +
                  '" data-server="' +
                  esc(i.serverId) +
                  '" title="' +
                  esc(t("bots.removerDoServidor", "Remover do servidor")) +
                  '" aria-label="' +
                  esc(t("bots.removerDoServidor", "Remover do servidor")) +
                  '">×</button>'
                : "") +
              "</span>"
            );
          })
          .join("") +
        (others
          ? '<span class="tag">' +
            esc(t("bots.eMais", "e mais")) +
            " " +
            others +
            " " +
            esc(t("bots.servidores", "servidores")) +
            "</span>"
          : "") +
        "</div>";
    } else if (total > 0) {
      installs =
        '<div class="bot-mine__row"><span class="bot-mine__label">' +
        esc(
          t("bots.instaladoSoFora", "Instalado em") +
            " " +
            total +
            " " +
            t("bots.servidoresFora", "servidor(es) que você não gerencia")
        ) +
        "</span></div>";
    } else {
      installs =
        '<div class="bot-mine__row"><span class="bot-mine__label">' +
        esc(t("bots.semServidores", "Ainda não está instalado em nenhum servidor.")) +
        "</span></div>";
    }

    return (
      '<article class="bot-card bot-card--mine">' +
      '<div class="bot-card__top">' +
      '<span class="bot-card__avatar" aria-hidden="true">' +
      botAvatarHTML(bot, 20) +
      "</span>" +
      '<div class="bot-card__id">' +
      '<h3 class="bot-card__name">' +
      esc(bot.name || "—") +
      "</h3>" +
      '<span class="bot-card__meta">' +
      esc(catLabel(bot.category)) +
      " · " +
      esc(handleOf(bot)) +
      "</span></div>" +
      botBadge() +
      "</div>" +
      '<p class="bot-card__desc">' +
      esc(clip(bot.description || "", 150)) +
      "</p>" +
      '<div class="bot-card__tags">' +
      '<span class="tag ' + (published ? "tag--ok" : "tag--warn") + '">' +
      esc(published ? t("bots.publicado", "Publicado") : t("bots.rascunho", "Rascunho")) +
      "</span>" +
      '<span class="tag">' +
      esc(u().plural(commands.length, t("bots.comando", "comando"), t("bots.comandos", "comandos"))) +
      "</span>" +
      (reports
        ? '<span class="tag tag--warn">' +
          esc(reports + " " + t("bots.denuncias", "denúncia(s)")) +
          "</span>"
        : "") +
      "</div>" +
      installs +
      '<div class="bot-card__foot bot-card__foot--wrap">' +
      '<button type="button" class="btn btn--primary btn--sm" data-bot-act="editar" data-id="' +
      esc(bot.id) +
      '">' +
      esc(t("bots.editar", "Editar")) +
      "</button>" +
      '<button type="button" class="btn btn--ghost btn--sm" data-bot-act="testar" data-id="' +
      esc(bot.id) +
      '">' +
      esc(t("bots.testar", "Testar")) +
      "</button>" +
      '<button type="button" class="btn btn--soft btn--sm" data-bot-act="duplicar" data-id="' +
      esc(bot.id) +
      '">' +
      esc(t("bots.duplicar", "Duplicar")) +
      "</button>" +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn btn--soft btn--sm" data-bot-act="instalar" data-id="' +
      esc(bot.id) +
      '">' +
      esc(t("bots.instalar", "Instalar")) +
      "</button>" +
      '<button type="button" class="btn btn--soft btn--sm" data-bot-act="publicar" data-id="' +
      esc(bot.id) +
      '">' +
      esc(published ? t("bots.despublicar", "Despublicar") : t("bots.publicar", "Publicar")) +
      "</button>" +
      '<button type="button" class="btn btn--ghost btn--sm bots-danger" data-bot-act="excluir" data-id="' +
      esc(bot.id) +
      '">' +
      esc(t("bots.excluir", "Excluir")) +
      "</button>" +
      "</div></article>"
    );
  }

  /* =========================================================
     EDITOR · Criar um Bot / Editar bot (ações fechadas)
     ========================================================= */
  function emptyCommand() {
    return { name: "", description: "", action: { type: "responder", text: "" } };
  }

  function actionFor(type, prev) {
    const p = prev && typeof prev === "object" ? prev : {};
    if (type === "aleatorio")
      return { type: "aleatorio", options: Array.isArray(p.options) ? p.options.slice() : [] };
    if (type === "info") return { type: "info" };
    return { type: "responder", text: typeof p.text === "string" ? p.text : "" };
  }

  function normalizeCmd(c) {
    const a = (c && c.action) || {};
    const type = ACTION_TYPES.some((x) => x.id === a.type) ? a.type : "responder";
    return {
      name: String((c && c.name) || ""),
      description: String((c && c.description) || ""),
      action: actionFor(type, a),
    };
  }

  function newEditor(bot) {
    const b = bot || null;
    return {
      id: b ? b.id : null,
      name: b ? b.name || "" : "",
      description: b ? b.description || "" : "",
      category:
        b && BOT_CATEGORIES.indexOf(catLabel(b.category)) !== -1
          ? catLabel(b.category)
          : "Comunidade",
      welcome: b && b.custom ? b.custom.welcome || "" : "",
      commands:
        b && Array.isArray(b.commands) && b.commands.length
          ? b.commands.slice(0, BOT_MAX_COMMANDS).map(normalizeCmd)
          : [emptyCommand()],
      saving: false,
      error: null,
      cmdErrors: {},
      testInput: "",
      testOut: null,
    };
  }

  function fieldHTML(label, inner, hint) {
    return (
      '<label class="field bots-ed__field"><span class="field__label">' +
      esc(label) +
      "</span>" +
      inner +
      (hint ? '<span class="bots-ed__hint">' + esc(hint) + "</span>" : "") +
      "</label>"
    );
  }

  /* a prévia acompanha a digitação repintando SÓ o painel dela —
     repintar o editor inteiro derrubaria o foco do campo em uso */
  function refreshPreview() {
    const side = document.querySelector(".bots-ed__side");
    const ed = state.editor;
    if (!side || !ed) return;
    const panel = side.querySelector(".bots-ed__panel");
    if (!panel || !panel.parentNode) return;
    const tmp = u().el("<div>" + previewHTML(ed) + "</div>");
    if (tmp && tmp.firstElementChild) panel.parentNode.replaceChild(tmp.firstElementChild, panel);
  }

  function cmdRowHTML(cmd, i, ed) {
    const type = (cmd.action && cmd.action.type) || "responder";
    let payload = "";
    if (type === "aleatorio") {
      payload =
        '<textarea class="input bots-ed__ta" rows="3" data-bot-cmd="' +
        i +
        '" data-cmd-field="options" placeholder="' +
        esc(t("bots.cmdOptionsPh", "Uma resposta por linha — o bot escolhe uma ao acaso (mínimo 2)")) +
        '">' +
        esc(((cmd.action && cmd.action.options) || []).join("\n")) +
        "</textarea>";
    } else if (type === "info") {
      payload =
        '<p class="bots-ed__hint bots-ed__hint--box">' +
        esc(
          t(
            "bots.cmdInfoHint",
            "O bot responde com o nome do servidor, membros humanos, canais e cargos — dados reais do servidor onde estiver instalado."
          )
        ) +
        "</p>";
    } else {
      payload =
        '<textarea class="input bots-ed__ta" rows="2" maxlength="600" data-bot-cmd="' +
        i +
        '" data-cmd-field="text" placeholder="' +
        esc(t("bots.cmdTextPh", "O que o bot deve responder")) +
        '">' +
        esc((cmd.action && cmd.action.text) || "") +
        "</textarea>";
    }
    const err = ed.cmdErrors[i];
    return (
      '<div class="bots-cmd' + (err ? " is-err" : "") + '">' +
      '<div class="bots-cmd__top">' +
      '<span class="bots-cmd__n" aria-hidden="true">' +
      i +
      1 +
      "</span>" +
      '<input class="input bots-cmd__name mono" maxlength="26" data-bot-cmd="' +
      i +
      '" data-cmd-field="name" value="' +
      esc(cmd.name) +
      '" placeholder="/comando" aria-label="' +
      esc(t("bots.comando", "Comando")) +
      '" />' +
      '<select class="select bots-cmd__type" data-bot-cmd="' +
      i +
      '" data-cmd-field="type" aria-label="' +
      esc(t("bots.acao", "Ação")) +
      '">' +
      ACTION_TYPES.map(
        (a) =>
          '<option value="' + a.id + '"' + (a.id === type ? " selected" : "") + ">" + esc(a.label()) + "</option>"
      ).join("") +
      "</select>" +
      '<button type="button" class="btn btn--ghost btn--sm bots-cmd__rm" data-bot-act="rmcmd" data-i="' +
      i +
      '" title="' +
      esc(t("bots.removerComando", "Remover comando")) +
      '" aria-label="' +
      esc(t("bots.removerComando", "Remover comando")) +
      '">✕</button>' +
      "</div>" +
      '<input class="input bots-cmd__desc" maxlength="120" data-bot-cmd="' +
      i +
      '" data-cmd-field="description" value="' +
      esc(cmd.description) +
      '" placeholder="' +
      esc(t("bots.cmdDescPh", "Descrição curta (aparece no catálogo)")) +
      '" />' +
      payload +
      (err ? '<p class="bots-ed__err">' + esc(err) + "</p>" : "") +
      "</div>"
    );
  }

  function previewHTML(ed) {
    return (
      '<section class="bots-ed__panel">' +
      "<h4>" +
      esc(t("bots.previewTitulo", "Prévia do bot")) +
      "</h4>" +
      '<div class="bot-mini">' +
      '<span class="bot-mini__avatar" aria-hidden="true">' +
      NX.icon("bot", "", 22) +
      "</span>" +
      '<div class="bot-mini__id"><strong>' +
      esc(ed.name || t("bots.previewNome", "Seu bot")) +
      "</strong><span>" +
      esc(t("bots.previewHandle", "identificador gerado ao salvar")) +
      "</span></div></div>" +
      '<p class="bot-mini__desc">' +
      esc(ed.description || t("bots.previewDesc", "A descrição do seu bot aparece aqui.")) +
      "</p>" +
      '<div class="bot-card__tags"><span class="tag">' +
      esc(catLabel(ed.category)) +
      "</span>" +
      '<span class="tag">' +
      esc(u().plural(ed.commands.length, t("bots.comando", "comando"), t("bots.comandos", "comandos"))) +
      "</span></div>" +
      '<ul class="bot-cmds bot-cmds--mini">' +
      ed.commands
        .map(
          (c) =>
            '<li class="bot-cmd"><code class="bot-cmd__usage">' +
            esc(c.name || "/…") +
            '</code><span class="bot-cmd__txt"><small>' +
            esc(c.description || actionLabel((c.action || {}).type)) +
            "</small></span></li>"
        )
        .join("") +
      "</ul>" +
      "</section>"
    );
  }

  function testOutHTML(ed) {
    const out = ed.testOut;
    if (!out) return "";
    if (out.kind === "miss")
      return (
        '<p class="bots-ed__out bots-ed__out--warn">' +
        ico("alert", 15) +
        "<span>" +
        esc(
          t("bots.testMiss", "Nenhum comando corresponde a") +
            " «" +
            (out.name || "") +
            "». " +
            t("bots.testMissHint", "Confira o nome no editor.")
        ) +
        "</span></p>"
      );
    if (out.kind === "incomplete")
      return (
        '<p class="bots-ed__out bots-ed__out--warn">' +
        ico("alert", 15) +
        "<span>" +
        esc(t("bots.testIncomplete", "Este comando ainda não tem uma resposta configurada.")) +
        "</span></p>"
      );
    return (
      '<div class="bots-ed__out"><span class="bots-ed__outwho">' +
      NX.icon("bot", "", 15) +
      " <strong>" +
      esc(ed.name || t("bots.previewNome", "Seu bot")) +
      "</strong> <code>" +
      esc(out.name) +
      "</code></span><p>" +
      esc(out.text) +
      "</p></div>"
    );
  }

  function testHTML(ed) {
    return (
      '<section class="bots-ed__panel">' +
      "<h4>" +
      esc(t("bots.testarTitulo", "Testar comandos")) +
      "</h4>" +
      '<div class="bots-ed__testrow">' +
      '<input class="input mono" data-bot-field="testInput" value="' +
      esc(ed.testInput) +
      '" placeholder="/oi" aria-label="' +
      esc(t("bots.testarPlaceholder", "Comando para testar")) +
      '" />' +
      '<button type="button" class="btn btn--soft btn--sm" data-bot-act="testar">' +
      esc(t("bots.testar", "Testar")) +
      "</button></div>" +
      testOutHTML(ed) +
      '<p class="bots-ed__hint">' +
      esc(
        t(
          "bots.testNota",
          "Prévia local: no servidor, a mesma ação responde com os dados reais da comunidade."
        )
      ) +
      "</p>" +
      "</section>"
    );
  }

  function editorHTML() {
    if (!state.editor) state.editor = newEditor(null);
    const ed = state.editor;
    const editing = !!ed.id;
    return (
      '<form class="bots-ed" data-bots-editor novalidate autocomplete="off">' +
      '<div class="bots-ed__head"><div>' +
      "<h2>" +
      esc(editing ? t("bots.edTituloEditar", "Editar bot") : t("bots.edTituloCriar", "Criar um Bot")) +
      "</h2>" +
      "<p>" +
      esc(
        t(
          "bots.edSubtitulo",
          "Monte os comandos sem programar: cada comando tem uma ação fechada e segura. Nenhum código de terceiros é executado no Nexo."
        )
      ) +
      "</p></div>" +
      '<span class="tag">' +
      esc(state.myBots.length + "/" + BOT_MAX_BOTS + " " + t("bots.edLimite", "bots usados")) +
      "</span></div>" +
      '<div class="bots-ed__cols"><div class="bots-ed__main">' +
      '<section class="bots-ed__sec"><h3>' +
      esc(t("bots.edIdentidade", "Identidade")) +
      "</h3>" +
      '<div class="bots-ed__row">' +
      fieldHTML(
        t("bots.edNome", "Nome *"),
        '<input class="input" maxlength="40" data-bot-field="name" value="' +
          esc(ed.name) +
          '" placeholder="' +
          esc(t("bots.edNomePh", "Ex.: Guarda da Vila")) +
          '" />'
      ) +
      fieldHTML(
        t("bots.edCategoria", "Categoria"),
        '<select class="select" data-bot-field="category">' +
          BOT_CATEGORIES.map(
            (c) =>
              '<option value="' + esc(c) + '"' + (ed.category === c ? " selected" : "") + ">" + esc(c) + "</option>"
          ).join("") +
          "</select>"
      ) +
      "</div>" +
      fieldHTML(
        t("bots.edDescricao", "Descrição *"),
        '<textarea class="input" rows="2" maxlength="220" data-bot-field="description" placeholder="' +
          esc(t("bots.edDescricaoPh", "O que este bot faz no seu servidor")) +
          '">' +
          esc(ed.description) +
          "</textarea>"
      ) +
      fieldHTML(
        t("bots.edApresentacao", "Mensagem de apresentação (opcional)"),
        '<textarea class="input" rows="2" maxlength="300" data-bot-field="welcome" placeholder="' +
          esc(t("bots.edApresentacaoPh", "Boas-vindas quando alguém entra no servidor…")) +
          '">' +
          esc(ed.welcome) +
          "</textarea>",
        t(
          "bots.edApresentacaoHint",
          "Publicada no primeiro canal de texto quando alguém entra no servidor onde o bot está instalado. Use {usuario} e {nome}."
        )
      ) +
      '<p class="bots-ed__hint">' +
      ico("shield", 14) +
      " " +
      esc(t("bots.edPrefixo", "Os comandos começam com / — formato padrão do Nexo (ex.: /regras).")) +
      "</p>" +
      "</section>" +
      '<section class="bots-ed__sec">' +
      '<div class="bots-ed__sechd"><h3>' +
      esc(t("bots.edComandos", "Comandos")) +
      '</h3><span class="bots-ed__count">' +
      ed.commands.length +
      "/" +
      BOT_MAX_COMMANDS +
      "</span></div>" +
      ed.commands.map((c, i) => cmdRowHTML(c, i, ed)).join("") +
      (ed.commands.length < BOT_MAX_COMMANDS
        ? '<button type="button" class="btn btn--soft btn--sm bots-ed__add" data-bot-act="addcmd">' +
          ico("plus", 15) +
          " " +
          esc(t("bots.edAddComando", "Adicionar comando")) +
          "</button>"
        : '<p class="bots-ed__hint">' +
          esc(t("bots.edLimiteComandos", "Você chegou ao limite de 10 comandos por bot.")) +
          "</p>") +
      "</section></div>" +
      '<aside class="bots-ed__side">' +
      previewHTML(ed) +
      testHTML(ed) +
      "</aside></div>" +
      (ed.error
        ? '<p class="form-error bots-ed__error">' +
          ico("alert", 16) +
          "<span>" +
          esc(ed.error) +
          "</span></p>"
        : "") +
      '<div class="bots-ed__foot">' +
      '<button type="button" class="btn btn--ghost" data-bot-act="cancelar">' +
      esc(t("common.cancel", "Cancelar")) +
      "</button>" +
      '<button type="submit" class="btn btn--primary"' +
      (ed.saving ? " disabled" : "") +
      ">" +
      esc(editing ? t("bots.edSalvar", "Salvar alterações") : t("bots.edCriar", "Criar bot")) +
      "</button>" +
      "</div></form>"
    );
  }

  /* lê o DOM para o estado antes de qualquer ação (repaint mataria
     o que ainda não foi salvo) */
  function readEditorFromDOM() {
    const form = document.querySelector("[data-bots-editor]");
    const ed = state.editor;
    if (!form || !ed) return;
    form.querySelectorAll("[data-bot-field]").forEach((el) => {
      ed[el.getAttribute("data-bot-field")] = el.value;
    });
    form.querySelectorAll("[data-bot-cmd]").forEach((el) => {
      const i = Number(el.getAttribute("data-bot-cmd"));
      const f = el.getAttribute("data-cmd-field");
      const cmd = ed.commands[i];
      if (!cmd) return;
      if (f === "name") cmd.name = el.value;
      else if (f === "description") cmd.description = el.value;
      else if (f === "type") cmd.action = actionFor(el.value, cmd.action);
      else if (f === "text")
        cmd.action = actionFor("responder", Object.assign({}, cmd.action, { text: el.value }));
      else if (f === "options")
        cmd.action = actionFor(
          "aleatorio",
          Object.assign({}, cmd.action, { options: String(el.value).split("\n") })
        );
    });
  }

  /* validação espelhada do backend — mesmas mensagens, mesma régua */
  function validateEditor(ed) {
    const out = { error: null, errors: {}, payload: null };
    const name = String(ed.name || "").trim().slice(0, 40);
    const description = String(ed.description || "").trim().slice(0, 220);
    const list = [];
    const seen = {};
    ed.commands.forEach((c, i) => {
      let cn = String(c.name || "").trim().toLowerCase();
      if (cn && cn[0] !== "/") cn = "/" + cn;
      if (!/^\/[a-z0-9]{2,24}$/.test(cn)) {
        out.errors[i] = t(
          "bots.cmdInvalido",
          "Comando inválido: use “/” seguido de 2 a 24 caracteres (letras e números), como /regras."
        );
        return;
      }
      if (seen[cn]) {
        out.errors[i] = t("bots.cmdDuplicado", "Dois comandos não podem ter o mesmo nome.");
        return;
      }
      seen[cn] = true;
      const a = c.action || {};
      const type = a.type === "aleatorio" || a.type === "info" ? a.type : "responder";
      const desc = String(c.description || "").slice(0, 120);
      if (type === "responder") {
        const text = String(a.text || "").trim();
        if (!text || text.length > 600) {
          out.errors[i] = t(
            "bots.cmdResponderInvalido",
            "A resposta “responder” precisa de 1 a 600 caracteres."
          );
          return;
        }
        list.push({ name: cn, description: desc, action: { type: "responder", text: text } });
      } else if (type === "aleatorio") {
        const options = (Array.isArray(a.options) ? a.options : [])
          .map((o) => String(o).trim())
          .filter(Boolean)
          .slice(0, 12);
        if (options.length < 2) {
          out.errors[i] = t(
            "bots.cmdAleatorioInvalido",
            "“Respostas aleatórias” precisa de pelo menos 2 opções (uma por linha)."
          );
          return;
        }
        list.push({
          name: cn,
          description: desc,
          action: { type: "aleatorio", options: options.map((o) => o.slice(0, 200)) },
        });
      } else {
        list.push({ name: cn, description: desc, action: { type: "info" } });
      }
    });
    const hasCmdErr = Object.keys(out.errors).length > 0;
    out.error =
      (name.length < 2
        ? t("bots.nomeCurto", "O bot precisa de um nome com pelo menos 2 caracteres.")
        : !description
        ? t("bots.descVazia", "Escreva uma descrição curta para o bot.")
        : hasCmdErr
        ? t("bots.edCorrija", "Corrija os campos destacados.")
        : !list.length
        ? t("bots.semComandosNovo", "Adicione pelo menos um comando ao bot.")
        : null);
    if (out.error) return out;
    out.payload = {
      name: name,
      description: description,
      category: BOT_CATEGORIES.indexOf(ed.category) !== -1 ? ed.category : "Comunidade",
      welcome: String(ed.welcome || "").trim().slice(0, 300),
      commands: list,
    };
    return out;
  }

  /* prévia honesta da resposta: no servidor a mesma ação usa dados
     reais — aqui só simulamos a lógica fechada do comando */
  function simulateReply(owner, raw) {
    let name = String(raw || "").trim().toLowerCase();
    if (name && name[0] !== "/") name = "/" + name;
    if (!name) return { kind: "miss", name: "" };
    const list = Array.isArray(owner.commands) ? owner.commands : [];
    let cmd = null;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c) continue;
      let cn = String(c.name || "").trim().toLowerCase();
      if (cn && cn[0] !== "/") cn = "/" + cn;
      if (cn === name) {
        cmd = c;
        break;
      }
    }
    if (!cmd) return { kind: "miss", name: name };
    const a = cmd.action || {};
    if (a.type === "aleatorio") {
      const opts = (Array.isArray(a.options) ? a.options : [])
        .map((o) => String(o).trim())
        .filter(Boolean);
      if (opts.length < 2) return { kind: "incomplete" };
      return { kind: "ok", name: cmd.name, text: opts[Math.floor(Math.random() * opts.length)] };
    }
    if (a.type === "info")
      return {
        kind: "ok",
        name: cmd.name,
        text:
          String(owner.name || t("bots.previewNome", "Seu bot")) +
          ": " +
          t(
            "bots.testInfoPreview",
            "no servidor responde nome, membros humanos, canais e cargos reais"
          ),
      };
    const text = String(a.text || "").trim();
    if (!text) return { kind: "incomplete" };
    return { kind: "ok", name: cmd.name, text: text };
  }

  function runTest() {
    readEditorFromDOM();
    const ed = state.editor;
    if (!ed) return;
    const v = validateEditor(ed);
    ed.cmdErrors = v.errors;
    ed.error = null;
    ed.testOut = simulateReply(ed, ed.testInput);
    repaint();
  }

  function saveEditor() {
    readEditorFromDOM();
    const ed = state.editor;
    if (!ed || ed.saving) return;
    const v = validateEditor(ed);
    ed.cmdErrors = v.errors;
    ed.error = v.error;
    if (v.error) {
      repaint();
      return;
    }
    const form = document.querySelector("[data-bots-editor]");
    const btn = form ? form.querySelector('button[type="submit"]') : null;
    const end = btn && NX.ui && typeof NX.ui.busy === "function" ? NX.ui.busy(btn) : function () {};
    ed.saving = true;
    const wasEdit = !!ed.id;
    Promise.resolve()
      .then(() => (wasEdit ? NX.api.updateBot(ed.id, v.payload) : NX.api.createBot(v.payload)))
      .then((row) => {
        ed.saving = false;
        end();
        if (row) addToCatalog(row);
        state.editor = null;
        state.tab = "meusbots";
        state.appId = null;
        NX.ui.toast(
          wasEdit
            ? t("bots.toastSalvo", "Bot salvo.")
            : t(
                "bots.toastCriado",
                "Bot criado! Agora instale-o em um servidor que você gerencia."
              ),
          "success"
        );
        rerender();
        loadMyBots(true);
      })
      .catch((e) => {
        ed.saving = false;
        end();
        ed.error = (e && e.message) || t("bots.erroSalvar", "Não foi possível salvar o bot.");
        repaint();
      });
  }

  /* ---------------- ações do editor e da lista ---------------- */
  function newBot() {
    if (!me()) {
      NX.ui.error(t("bots EntreParaCriar", "Entre para criar um bot."));
      return;
    }
    state.editor = newEditor(null);
    setTab("criar");
  }

  function editBot(id) {
    const open = (bot) => {
      if (!bot) {
        NX.ui.error(t("bots.naoExiste", "Este bot não existe."));
        return;
      }
      state.editor = newEditor(bot);
      setTab("criar");
    };
    const found = findMyBot(id);
    if (found) return open(found);
    Promise.resolve()
      .then(() => NX.api.listMyBots())
      .then((rows) => {
        state.myBots = Array.isArray(rows) ? rows.filter((r) => r && r.id) : [];
        state.myBotsLoaded = true;
        open(findMyBot(id));
      })
      .catch((e) =>
        NX.ui.error((e && e.message) || t("bots.erroCarregar", "Não foi possível carregar os bots."))
      );
  }

  function cancelEditor() {
    const ed = state.editor;
    const hasContent =
      !!ed &&
      (!!String(ed.name || "").trim() ||
        !!String(ed.description || "").trim() ||
        !!String(ed.welcome || "").trim() ||
        ed.commands.some((c) => !!String((c && c.name) || "").trim()));
    const leave = () => {
      state.editor = null;
      setTab("meusbots");
    };
    if (!hasContent) return leave();
    NX.ui.confirm({
      title: t("bots.descartarTitulo", "Descartar este bot?"),
      message: t(
        "bots.descartarMensagem",
        "As informações digitadas ainda não foram salvas e serão perdidas."
      ),
      confirmLabel: t("bots.descartar", "Descartar"),
      danger: true,
    }).then((yes) => {
      if (yes) leave();
    });
  }

  function addCommand() {
    readEditorFromDOM();
    const ed = state.editor;
    if (!ed) return;
    if (ed.commands.length >= BOT_MAX_COMMANDS) {
      NX.ui.error(t("bots.edLimiteComandos", "Você chegou ao limite de 10 comandos por bot."));
      return;
    }
    ed.commands.push(emptyCommand());
    ed.error = null;
    repaint();
  }

  function removeCommand(i) {
    readEditorFromDOM();
    const ed = state.editor;
    if (!ed || isNaN(i) || i < 0 || i >= ed.commands.length) return;
    if (ed.commands.length === 1) ed.commands = [emptyCommand()];
    else ed.commands.splice(i, 1);
    ed.cmdErrors = {};
    ed.error = null;
    repaint();
  }

  function duplicateBot(id) {
    const bot = findMyBot(id) || findApp(id);
    if (!bot) return;
    const base = String(bot.name || t("bots.botTag", "Bot"))
      .replace(/\s*\(cópia\)\s*$/i, "")
      .slice(0, 31);
    NX.api.createBot({
      name: base + " (cópia)",
      description: bot.description || "",
      category: bot.category || "Comunidade",
      welcome: bot.custom ? bot.custom.welcome || "" : "",
      commands: Array.isArray(bot.commands) ? bot.commands : [],
    })
      .then((row) => {
        if (row) addToCatalog(row);
        NX.ui.toast(t("bots.toastDuplicado", "Bot duplicado."), "success");
        loadMyBots(true);
      })
      .catch((e) =>
        NX.ui.error((e && e.message) || t("bots.erroSalvar", "Não foi possível salvar o bot."))
      );
  }

  function togglePublish(id) {
    const bot = findMyBot(id) || findApp(id);
    if (!bot || !bot.custom) return;
    const next = !bot.custom.published;
    NX.api.updateBot(id, { published: next })
      .then((row) => {
        if (row) addToCatalog(row);
        NX.ui.toast(
          next
            ? t("bots.toastPublicado", "Bot publicado no catálogo do Nexo.")
            : t("bots.toastDespublicado", "Bot retirado do catálogo público."),
          "success"
        );
        loadMyBots(true);
        refresh();
      })
      .catch((e) =>
        NX.ui.error((e && e.message) || t("bots.erroSalvar", "Não foi possível salvar o bot."))
      );
  }

  function deleteBotFlow(id) {
    const bot = findMyBot(id) || findApp(id);
    if (!bot) return;
    NX.ui.confirm({
      title: t("bots.excluirTitulo", "Excluir este bot?"),
      message:
        t("bots.excluirMensagem", "O bot") +
        " «" +
        String(bot.name || "") +
        "» " +
        t("bots.excluirMensagem2", "será apagado da sua conta e removido dos servidores onde estiver instalado."),
      note: t(
        "bots.excluirNota",
        "Esta ação não pode ser desfeita. As mensagens já enviadas pelo bot continuam no histórico."
      ),
      confirmLabel: t("bots.excluirBot", "Excluir bot"),
      danger: true,
    }).then((yes) => {
      if (!yes) return;
      NX.api.deleteBot(id)
        .then((res) => {
          state.myBots = state.myBots.filter((b) => b && b.id !== id);
          state.apps = state.apps.filter((a) => a && a.id !== id);
          try {
            const target = NX.store && NX.store.db;
            if (target && target.apps && typeof target.apps === "object" && !Array.isArray(target.apps))
              delete target.apps[id];
            NX.store.commit(["apps"]);
          } catch (e) {
            /* cache local indisponível: o próximo sync corrige */
          }
          NX.ui.toast(
            (res && res.installsRemoved
              ? t("bots.toastExcluidoComInstalls", "Bot excluído e removido de ") +
                res.installsRemoved +
                " " +
                t("bots.servidores", "servidores") +
                "."
              : t("bots.toastExcluido", "Bot excluído.")),
            "success"
          );
          repaint();
        })
        .catch((e) =>
          NX.ui.error((e && e.message) || t("bots.erroExcluir", "Não foi possível excluir o bot."))
        );
    });
  }

  function removeInstallFlow(el) {
    const installId = el.getAttribute("data-install");
    const serverId = el.getAttribute("data-server");
    const srv = S().server ? S().server(serverId) : null;
    NX.ui.confirm({
      title: t("bots.removerDoTitulo", "Remover o bot deste servidor?"),
      message:
        t("bots.removerDoMensagem", "O bot para de agir em") +
        " «" +
        (srv ? srv.name : serverId) +
        "» " +
        t("bots.removerDoMensagem2", "e as configurações dele são apagadas."),
      note: t("bots.removerNota", "As mensagens já enviadas pelo app continuam no histórico."),
      confirmLabel: t("bots.removerApp", "Remover app"),
      danger: true,
    }).then((yes) => {
      if (!yes) return;
      NX.api.removeServerApp(serverId, installId)
        .then(() => {
          NX.ui.toast(t("bots.removido", "App removido do servidor."), "success");
          loadMyBots(true);
          repaint();
        })
        .catch((e) =>
          NX.ui.error((e && e.message) || t("bots.erroRemover", "Não foi possível remover o app."))
        );
    });
  }

  /* ---------------- tickets: abrir e agir ----------------
     O modal só coleta assunto/motivo; quem valida é o backend
     (staff, limite, migração). Se o servidor recusar, a mensagem
     dele aparece — nada de fingir que o chamado foi aberto. */
  function openTicketModal() {
    const sid = state.ticketsServerId;
    if (!sid) return;
    const footer = u().el(
      '<div class="modal__actions">' +
        '<button class="btn btn--ghost" type="button" data-modal-close>' +
        esc(t("common.cancel", "Cancelar")) +
        "</button>" +
        '<button class="btn btn--primary" type="submit" form="form-ticket-open" data-ticket-submit>' +
        esc(t("bots.ticketAbrir", "Abrir chamado")) +
        "</button></div>"
    );
    const m = NX.ui.modal({
      title: t("bots.ticketNovo", "Abrir chamado"),
      eyebrow: t("bots.ticketEyebrow", "Atendimento"),
      size: "sm",
      footer: footer,
    });
    m.body.innerHTML =
      '<form id="form-ticket-open" novalidate>' +
      '<label class="field"><span class="field__label">' + esc(t("bots.ticketAssunto", "Assunto")) + "</span>" +
      '<input class="input" name="subject" data-autofocus maxlength="120" placeholder="' +
      esc(t("bots.ticketAssuntoPh", "Do que você precisa?")) + '" /></label>' +
      '<label class="field"><span class="field__label">' + esc(t("bots.ticketMotivo", "Motivo")) + "</span>" +
      '<textarea class="input" name="reason" rows="4" maxlength="2000" placeholder="' +
      esc(t("bots.ticketMotivoPh", "Descreva com detalhe para a equipe ajudar mais rápido.")) + '"></textarea></label>' +
      '<div class="form-error" data-ticket-error hidden></div>' +
      "</form>";

    const form = m.body.querySelector("form");
    const errBox = m.body.querySelector("[data-ticket-error]");
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const subject = (form.elements.subject.value || "").trim();
      const reason = (form.elements.reason.value || "").trim();
      if (subject.length < 3 || reason.length < 5) {
        errBox.hidden = false;
        errBox.textContent = t("bots.ticketValidacao", "Preencha o assunto (mín. 3) e o motivo (mín. 5).");
        return;
      }
      errBox.hidden = true;
      NX.api
        .openTicket(sid, { subject: subject, reason: reason })
        .then(() => {
          NX.ui.toast(t("bots.ticketAberto", "Chamado aberto."), "success");
          m.close();
          state.ticketsLoaded = false;
          ensureTickets(sid);
        })
        .catch((e) => {
          errBox.hidden = false;
          errBox.textContent = (e && e.message) || t("bots.ticketErroAbrir", "Não foi possível abrir o chamado.");
        });
    });
  }

  function ticketAction(kind, id) {
    const sid = state.ticketsServerId;
    if (!sid || !id) return;
    const close = kind === "close";
    const run = close
      ? NX.api.closeTicket(sid, id, t("bots.ticketMotivoPadrao", "Atendimento encerrado pela equipe."))
      : NX.api.reopenTicket(sid, id);
    run
      .then(() => {
        NX.ui.toast(
          close ? t("bots.ticketFechado", "Chamado fechado.") : t("bots.ticketReaberto", "Chamado reaberto."),
          "success"
        );
        state.ticketsLoaded = false;
        ensureTickets(sid);
      })
      .catch((e) => NX.ui.error((e && e.message) || t("bots.ticketErroAcao", "Não foi possível concluir a ação.")));
  }

  /* listener do seletor de servidor do painel de tickets */
  document.addEventListener("change", (e) => {
    const el = e && e.target && e.target.closest ? e.target.closest("[data-tickets-server]") : null;
    if (!el) return;
    state.ticketsServerId = el.value;
    state.ticketsLoaded = false;
    state.tickets = [];
    state.ticketsError = null;
    ensureTickets(el.value);
  });

  /* teste rápido de um bot já salvo (mesma lógica fechada do editor) */
  function openTestModal(bot) {
    const commands = Array.isArray(bot.commands) ? bot.commands : [];
    if (!commands.length) {
      NX.ui.error(t("bots.semComandos", "Este app não tem comandos de texto."));
      return;
    }
    const footer = u().el(
      '<div class="modal__actions"><button class="btn btn--ghost" type="button" data-modal-close>' +
        esc(t("common.cancel", "Cancelar")) +
        "</button></div>"
    );
    const m = NX.ui.modal({
      title: t("bots.testarBot", "Testar bot"),
      eyebrow: bot.name || "",
      size: "sm",
      footer: footer,
    });
    m.body.innerHTML =
      '<label class="field"><span class="field__label">' +
      esc(t("bots.testarComandoLabel", "Comando")) +
      '</span><select class="select" data-test-cmd data-autofocus>' +
      commands
        .map(
          (c) =>
            '<option value="' +
            esc(c.name) +
            '">' +
            esc(c.name) +
            " — " +
            esc(clip(c.description || actionLabel((c.action || {}).type), 40)) +
            "</option>"
        )
        .join("") +
      "</select></label>" +
      '<div class="bots-ed__testrow"><button type="button" class="btn btn--primary btn--sm" data-test-run>' +
      esc(t("bots.testar", "Testar")) +
      "</button></div>" +
      '<div data-test-out></div>' +
      '<p class="bots-ed__hint">' +
      esc(
        t(
          "bots.testNota",
          "Prévia local: no servidor, a mesma ação responde com os dados reais da comunidade."
        )
      ) +
      "</p>";
    const run = m.body.querySelector("[data-test-run]");
    const sel = m.body.querySelector("[data-test-cmd]");
    const out = m.body.querySelector("[data-test-out]");
    const draw = () => {
      const res = simulateReply(bot, sel.value);
      out.innerHTML = testOutHTML({ name: bot.name, testOut: res });
    };
    run.addEventListener("click", draw);
    sel.addEventListener("change", draw);
    draw();
  }

  function reportFlow(id) {
    const bot = findApp(id);
    const footer = u().el(
      '<div class="modal__actions"><button class="btn btn--ghost" type="button" data-modal-close>' +
        esc(t("common.cancel", "Cancelar")) +
        '</button><button class="btn btn--primary" type="button" data-report-send>' +
        esc(t("bots.denunciarBtn", "Enviar denúncia")) +
        "</button></div>"
    );
    const m = NX.ui.modal({
      title: t("bots.denunciarTitulo", "Denunciar bot"),
      eyebrow: bot ? bot.name : "",
      size: "sm",
      footer: footer,
    });
    m.body.innerHTML =
      '<label class="field"><span class="field__label">' +
      esc(t("bots.denunciarLabel", "O que este bot faz de errado?")) +
      '</span><textarea class="input" rows="4" maxlength="300" data-autofocus placeholder="' +
      esc(t("bots.denunciarPh", "Descreva o problema (mínimo 10 caracteres)")) +
      '"></textarea></label><div class="form-error" data-report-err hidden></div>';
    const box = m.body.querySelector("[data-report-err]");
    const showErrBox = (msg) => {
      box.hidden = false;
      box.innerHTML = ico("alert", 16) + "<span>" + esc(msg) + "</span>";
    };
    const send = footer.querySelector("[data-report-send]");
    send.addEventListener("click", () => {
      const ta = m.body.querySelector("textarea");
      const reason = String((ta && ta.value) || "").trim();
      if (reason.length < 10) {
        showErrBox(t("bots.denunciaCurta", "Descreva o problema com pelo menos 10 caracteres."));
        return;
      }
      const end = NX.ui.busy(send);
      NX.api.reportApp(id, reason)
        .then(() => {
          end();
          m.close();
          NX.ui.toast(t("bots.toastDenuncia", "Denúncia enviada. Obrigado por avisar."), "success");
          loadMyBots(true);
        })
        .catch((e) => {
          end();
          showErrBox((e && e.message) || t("bots.erroSalvar", "Não foi possível enviar."));
        });
    });
  }

  function onBotAct(el) {
    const act = el.getAttribute("data-bot-act");
    const id = el.getAttribute("data-id") || null;
    const iAttr = el.getAttribute("data-i");
    switch (act) {
      case "criar":
        newBot();
        break;
      case "editar":
        editBot(id);
        break;
      case "cancelar":
        cancelEditor();
        break;
      case "addcmd":
        addCommand();
        break;
      case "rmcmd":
        removeCommand(iAttr === null ? NaN : Number(iAttr));
        break;
      case "testar":
        if (id) {
          const b = findMyBot(id) || findApp(id);
          if (b) openTestModal(b);
        } else runTest();
        break;
      case "duplicar":
        duplicateBot(id);
        break;
      case "publicar":
        togglePublish(id);
        break;
      case "excluir":
        deleteBotFlow(id);
        break;
      case "instalar":
        if (id) NX.bots.install(id);
        break;
      case "desinstalar":
        removeInstallFlow(el);
        break;
      case "denunciar":
        reportFlow(id);
        break;
      case "recarregar":
        loadMyBots(true);
        break;
      /* ---------------- tickets ---------------- */
      case "ticket-open":
        openTicketModal();
        break;
      case "ticket-close":
        ticketAction("close", id);
        break;
      case "ticket-reopen":
        ticketAction("reopen", id);
        break;
      case "ticket-goto":
        if (id) {
          const tk = (state.tickets || []).find((x) => x && x.channelId === id);
          if (tk && NX.app) NX.app.go("#/s/" + tk.serverId + "/" + id);
        }
        break;
      default:
        break;
    }
  }

  /* =========================================================
     AÇÕES (registradas em js/app.js)
     ========================================================= */
  function setTab(tab) {
    if (!TABS.some((x) => x.id === tab)) return;
    state.tab = tab;
    state.appId = null;
    if (tab === "criar" && !state.editor) state.editor = newEditor(null);
    if (tab === "criar" || tab === "meusbots") ensureMyBots();
    if (tab === "tickets") {
      const servers = ticketServers();
      ensureTickets(state.ticketsServerId || (servers[0] && servers[0].id) || null);
    }
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
    if (!el || !el.matches) return;
    if (el.matches("[data-bots-search]")) {
      state.query = el.value || "";
      repaint();
      return;
    }
    /* campos do editor: estado silencioso (repaint mataria o foco) */
    const ed = state.editor;
    if (!ed) return;
    if (el.matches("[data-bot-field]")) {
      ed[el.getAttribute("data-bot-field")] = el.value;
      refreshPreview();
      return;
    }
    if (!el.matches("[data-bot-cmd]")) return;
    const i = Number(el.getAttribute("data-bot-cmd"));
    const f = el.getAttribute("data-cmd-field");
    const cmd = ed.commands[i];
    if (!cmd) return;
    if (f === "name") cmd.name = el.value;
    else if (f === "description") cmd.description = el.value;
    else if (f === "text")
      cmd.action = actionFor("responder", Object.assign({}, cmd.action, { text: el.value }));
    else if (f === "options")
      cmd.action = actionFor(
        "aleatorio",
        Object.assign({}, cmd.action, { options: String(el.value).split("\n") })
      );
    refreshPreview();
  });

  /* selects do editor: trocar categoria não repinta; trocar o tipo de
     ação troca os campos do comando (repaint depois de ler o DOM) */
  document.addEventListener("change", (e) => {
    const el = e && e.target;
    if (!el || !el.matches) return;
    const ed = state.editor;
    if (!ed) return;
    if (el.matches('[data-bot-field="category"]')) {
      ed.category = el.value;
      repaint();
      return;
    }
    if (!el.matches('[data-cmd-field="type"]')) return;
    readEditorFromDOM();
    const i = Number(el.getAttribute("data-bot-cmd"));
    if (ed.commands[i]) ed.commands[i].action = actionFor(el.value, ed.commands[i].action);
    ed.error = null;
    repaint();
  });

  /* cliques do editor e de "Meus bots" (data-bot-act) */
  document.addEventListener("click", (e) => {
    const el = e && e.target && e.target.closest ? e.target.closest("[data-bot-act]") : null;
    if (!el) return;
    if (typeof onBotAct !== "function") return;
    onBotAct(el);
  });

  /* Salvar do editor: o Enter dentro do form também envia — e nada
     aqui pode recarregar a página (preventDefault explícito) */
  document.addEventListener("submit", (e) => {
    const form = e && e.target;
    if (!form || !form.matches || !form.matches("[data-bots-editor]")) return;
    e.preventDefault();
    saveEditor();
  });

  /* Enter roda a busca na hora, sem recarregar nem sair da página.
     preventDefault explícito: o campo não está em <form>, mas assim
     nenhum navegador/futuro formulário interpreta Enter como envio. */
  document.addEventListener("keydown", (e) => {
    const el = e && e.target;
    if (!el || !el.matches || !el.matches("[data-bots-search]")) return;
    if (e.key !== "Enter") return;
    e.preventDefault();
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
    /* bots criados por usuários (editor visual) */
    newBot: newBot,
    editBot: editBot,
    loadMyBots: loadMyBots,
    myBots: () => state.myBots,
    editor: () => state.editor,
    state: state,
  };
})(window.NX);
