/* ============================================================
   NEXO · extras
   Busca global (Ctrl/Cmd+K), painel de notificações e barra
   inferior mobile. Camada isolada: só cria os seus próprios
   containers (não altera views do app).
   Contrato: NX.extras.searchButtonHTML / bellButtonHTML /
             bottomBarHTML / mount / openSearch / openNotifications
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  /* proteção contra inclusão duplicada do script */
  if (NX.extras && NX.extras.__id === "nexo-extras") return;

  const u = () => NX.util;
  const S = () => NX.selectors;

  /* ---------------- estado ---------------- */
  let mounted = false;
  let rootEl = null;
  let overlayEl = null;
  let panelEl = null;
  let inputEl = null;
  let listEl = null;

  let searchOpen = false;
  let notifOpen = false;
  let notifAnchor = null;

  let flat = []; /* resultados achatados (teclado) */
  let active = -1;
  let runSearch = null;

  let navManualHash = null; /* última rota em que setActiveNav foi chamado */
  let unsubStore = null;

  const MAX_PER_SECTION = 8;
  const MAX_MESSAGES = 24;

  /* ============================================================
     texto · mapeamento normalizado -> original (destaque)
     ============================================================ */
  function mapText(str) {
    const raw = String(str == null ? "" : str);
    let norm = "";
    const map = [];
    for (let i = 0; i < raw.length; i++) {
      let piece = "";
      try {
        piece = u().normalize(raw[i]);
      } catch (e) {
        piece = raw[i].toLowerCase();
      }
      if (!piece) piece = raw[i].toLowerCase();
      for (let j = 0; j < piece.length; j++) {
        norm += piece.charAt(j);
        map.push(i);
      }
    }
    return { raw: raw, norm: norm, map: map };
  }

  function nq(q) {
    return u().normalize(String(q == null ? "" : q)).replace(/\s+/g, " ").trim();
  }

  function hit(text, term) {
    if (!term) return false;
    return u().normalize(text).indexOf(term) !== -1;
  }

  /* escape + <mark> no trecho que casa com o termo */
  function highlight(text, term) {
    const raw = String(text == null ? "" : text);
    if (!term) return u().h(raw);
    const m = mapText(raw);
    const start = m.norm.indexOf(term);
    if (start === -1) return u().h(raw);
    const end = Math.min(m.norm.length, start + term.length);
    const a = m.map[start];
    const b = Math.min(raw.length, m.map[end - 1] + 1);
    return (
      u().h(raw.slice(0, a)) +
      '<mark class="ex-hl">' + u().h(raw.slice(a, b)) + "</mark>" +
      highlight(raw.slice(b), term)
    );
  }

  /* trecho em volta do termo, com reticências */
  function excerpt(text, term, before, after) {
    const raw = String(text == null ? "" : text);
    const m = mapText(raw);
    const at = m.norm.indexOf(term);
    if (at === -1) return raw.slice(0, before + after);
    const from = Math.max(0, m.map[at] - before);
    const to = Math.min(raw.length, m.map[Math.min(m.norm.length - 1, at + term.length)] + 1 + after);
    return (from > 0 ? "…" : "") + raw.slice(from, to) + (to < raw.length ? "…" : "");
  }

  function oneLine(s, max) {
    const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
  }

  /* ============================================================
     utilidades de dados
     ============================================================ */
  function me() {
    try {
      return S().me();
    } catch (e) {
      return null;
    }
  }

  function db() {
    return (NX.store && NX.store.db) || {};
  }

  function unread() {
    const m = me();
    if (!m) return 0;
    try {
      return S().unreadNotifications(m.id) || 0;
    } catch (e) {
      return 0;
    }
  }

  function notifList() {
    const m = me();
    if (!m) return [];
    try {
      return S().notificationsOf(m.id) || [];
    } catch (e) {
      return [];
    }
  }

  /* ============================================================
     cromo: badges, sino, barra inferior, rota ativa
     ============================================================ */
  function refreshBadges() {
    const n = unread();
    const nodes = document.querySelectorAll("[data-ex-badge]");
    for (let i = 0; i < nodes.length; i++) {
      const b = nodes[i];
      if (n > 0) {
        const txt = n > 99 ? "99+" : String(n);
        if (b.textContent !== txt) b.textContent = txt;
        if (b.hidden) b.hidden = false;
        b.classList.add("is-on");
      } else {
        if (!b.hidden) b.hidden = true;
        b.classList.remove("is-on");
      }
    }
    const label = n > 0
      ? "Notificações (" + n + " não lidas)"
      : "Notificações — você está em dia";
    const bells = document.querySelectorAll('[data-action="nx-bell"]');
    for (let j = 0; j < bells.length; j++) bells[j].setAttribute("aria-label", label);
    if (panelEl && !panelEl.hidden) renderNotif();
  }

  function chromeVisible() {
    const shell = document.getElementById("screen-app");
    return !!(me() && shell && !shell.hidden);
  }

  function syncChrome() {
    const visible = chromeVisible();
    const bars = document.querySelectorAll("[data-ex-bar]");
    for (let i = 0; i < bars.length; i++) bars[i].hidden = !visible;
    if (document.body) document.body.classList.toggle("ex-has-bar", visible);
    if (!visible) {
      closeSearch();
      closeNotifications();
    }
  }

  function routeKey() {
    return String(location.hash || "#/");
  }

  function inferNav() {
    const r = NX.app && NX.app.route;
    if (!r) return null;
    if (r.name === "home" || r.name === "landing" || r.name === "welcome") return "home";
    if (r.name === "messages" || r.name === "dm") return "messages";
    if (r.name === "profile") return "profile";
    return null;
  }

  function applyNav(name) {
    const items = document.querySelectorAll("[data-ex-bar] [data-nav]");
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const on = it.getAttribute("data-nav") === name;
      it.classList.toggle("is-active", !!on);
      if (on) it.setAttribute("aria-current", "page");
      else it.removeAttribute("aria-current");
    }
    return name;
  }

  function syncNav() {
    if (navManualHash === routeKey()) return; /* quem chama setActiveNav manda */
    applyNav(inferNav());
  }

  /* ============================================================
     BUSCA · dados
     ============================================================ */
  function searchUsers(term) {
    const users = Object.values(db().users || {});
    const out = [];
    users.forEach((x) => {
      const name = (x.displayName || "") + " " + (x.username || "");
      if (hit(name, term)) out.push(x);
    });
    out.sort((a, b) => {
      const pa = u().normalize(a.displayName || a.username).indexOf(term) === 0 ? 0 : 1;
      const pb = u().normalize(b.displayName || b.username).indexOf(term) === 0 ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return String(a.displayName || a.username).localeCompare(String(b.displayName || b.username), "pt-BR");
    });
    return out.slice(0, MAX_PER_SECTION);
  }

  function searchServers(term) {
    const m = me();
    const mine = m ? S().serversOf(m.id) : [];
    const mineIds = {};
    mine.forEach((s) => (mineIds[s.id] = true));

    const own = [];
    mine.forEach((s) => {
      const blob = (s.name || "") + " " + (s.description || "");
      if (hit(blob, term)) own.push(s);
    });

    const pub = [];
    try {
      S().discoverableServers().forEach((s) => {
        if (mineIds[s.id]) return;
        const blob = (s.name || "") + " " + (s.description || "");
        if (hit(blob, term)) pub.push(s);
      });
    } catch (e) { /* seletor indisponível */ }

    return {
      own: own.slice(0, MAX_PER_SECTION),
      pub: pub.slice(0, MAX_PER_SECTION),
    };
  }

  function searchChannels(term) {
    const m = me();
    if (!m) return [];
    const out = [];
    const servers = S().serversOf(m.id);
    servers.forEach((s) => {
      let tree = [];
      try {
        tree = S().visibleCategoryTree(s.id, m.id) || [];
      } catch (e) {
        tree = [];
      }
      tree.forEach((node) => {
        (node.channels || []).forEach((ch) => {
          const cat = node.category ? node.category.name : "";
          if (hit((ch.name || "") + " " + cat, term)) {
            out.push({ channel: ch, server: s, category: cat });
          }
        });
      });
    });
    return out.slice(0, MAX_PER_SECTION + 4);
  }

  function searchMessages(term) {
    const all = Object.values(db().messages || {});
    const out = [];
    all.forEach((msg) => {
      if (!hit(msg.content || "", term)) return;
      out.push(msg);
    });
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return out.slice(0, MAX_MESSAGES);
  }

  /* ============================================================
     BUSCA · render
     ============================================================ */
  function sectionHTML(kind, title, icon, count, body) {
    if (!count) return "";
    return (
      '<section class="ex-sec" data-sec="' + kind + '">' +
      '<header class="ex-sec__head">' +
      '<span class="ex-sec__ico ex-sec__ico--' + kind + '">' + NX.icon(icon, "", 15) + "</span>" +
      '<h3 class="ex-sec__title">' + u().h(title) + "</h3>" +
      '<span class="ex-sec__count">' + count + "</span>" +
      "</header>" +
      '<div class="ex-sec__list">' + body + "</div>" +
      "</section>"
    );
  }

  function rowHTML(item) {
    const idx = flat.push(item) - 1;
    return (
      '<button type="button" class="ex-res" data-ex-idx="' + idx + '"' +
      ' data-action="nx-search-go" data-kind="' + u().h(item.kind) + '"' +
      ' data-id="' + u().h(item.id || "") + '"' +
      ' data-a="' + u().h(item.a || "") + '" data-b="' + u().h(item.b || "") + '"' +
      ' aria-label="' + u().h(item.aria || item.title) + '">' +
      item.body +
      "</button>"
    );
  }

  function emptyBlock(title, hint, icon) {
    return (
      '<div class="ex-empty">' +
      '<span class="ex-empty__ico">' + NX.icon(icon || "search", "", 26) + "</span>" +
      '<p class="ex-empty__title">' + u().h(title) + "</p>" +
      '<p class="ex-empty__hint">' + u().h(hint) + "</p>" +
      "</div>"
    );
  }

  function hintBlock() {
    const users = Object.keys(db().users || {}).length;
    const servers = Object.keys(db().servers || {}).length;
    const m = me();
    let channels = 0;
    try {
      (m ? S().serversOf(m.id) : []).forEach((s) => {
        (S().visibleCategoryTree(s.id, m.id) || []).forEach((n) => (channels += (n.channels || []).length));
      });
    } catch (e) { /* ignora */ }
    const msgs = Object.keys(db().messages || {}).length;

    const row = (icon, kind, label, count) =>
      '<div class="ex-hint__row">' +
      '<span class="ex-sec__ico ex-sec__ico--' + kind + '">' + NX.icon(icon, "", 15) + "</span>" +
      "<span>" + u().h(label) + "</span>" +
      '<b>' + count + "</b></div>";

    return (
      '<div class="ex-hints">' +
      '<p class="ex-hints__title">Busque em tudo num só lugar</p>' +
      row("user", "users", "Usuários", users) +
      row("compass", "servers", "Servidores", servers) +
      row("hash", "channels", "Canais visíveis", channels) +
      row("chat", "messages", "Mensagens", msgs) +
      '<p class="ex-hints__note">Use <kbd>↑</kbd> <kbd>↓</kbd> para navegar e <kbd>Enter</kbd> para abrir.</p>' +
      "</div>"
    );
  }

  function renderResults(query) {
    if (!listEl) return;
    flat = [];
    active = -1;
    const term = nq(query);

    if (!term) {
      listEl.innerHTML = hintBlock();
      setStatus("");
      return;
    }

    /* --- usuários --- */
    const users = searchUsers(term);
    let html = "";
    let body = "";
    users.forEach((x) => {
      body += rowHTML({
        kind: "user",
        id: x.id,
        title: x.displayName || x.username,
        aria: "Abrir perfil de " + (x.displayName || x.username),
        body:
          '<span class="ex-res__av">' + u().avatarHTML(x, "sm", true) + "</span>" +
          '<span class="ex-res__txt">' +
          '<span class="ex-res__t">' + highlight(x.displayName || x.username, term) + "</span>" +
          '<span class="ex-res__s">@' + highlight(x.username || "", term) +
          (x.status ? " · " + u().h(NX.STATUS_LABEL[x.status] || x.status) : "") + "</span>" +
          "</span>" +
          '<span class="ex-res__go">' + NX.icon("chevronRight", "", 16) + "</span>",
      });
    });
    html += sectionHTML("users", "Usuários", "user", users.length, body);

    /* --- servidores --- */
    const servers = searchServers(term);
    body = "";
    servers.own.forEach((s) => {
      body += rowHTML({
        kind: "server",
        id: s.id,
        a: "1",
        title: s.name,
        aria: "Abrir servidor " + s.name,
        body:
          '<span class="ex-res__ic">' + u().serverIconHTML(s, "xs") + "</span>" +
          '<span class="ex-res__txt">' +
          '<span class="ex-res__t">' + highlight(s.name, term) + "</span>" +
          '<span class="ex-res__s">' + S().memberCount(s.id) + " membros · seu servidor</span>" +
          "</span>" +
          '<span class="ex-tag ex-tag--own">Seu</span>',
      });
    });
    servers.pub.forEach((s) => {
      body += rowHTML({
        kind: "server",
        id: s.id,
        a: "0",
        title: s.name,
        aria: "Ver servidor público " + s.name,
        body:
          '<span class="ex-res__ic">' + u().serverIconHTML(s, "xs") + "</span>" +
          '<span class="ex-res__txt">' +
          '<span class="ex-res__t">' + highlight(s.name, term) + "</span>" +
          '<span class="ex-res__s">' + S().memberCount(s.id) + " membros · público</span>" +
          "</span>" +
          '<span class="ex-tag">Público</span>',
      });
    });
    const totalServers = servers.own.length + servers.pub.length;
    html += sectionHTML("servers", "Servidores", "compass", totalServers, body);

    /* --- canais --- */
    const channels = searchChannels(term);
    body = "";
    channels.forEach((c) => {
      body += rowHTML({
        kind: "channel",
        id: c.channel.id,
        a: c.channel.serverId,
        title: c.channel.name,
        aria: "Abrir canal " + c.channel.name + " em " + (c.server ? c.server.name : ""),
        body:
          '<span class="ex-res__ic ex-res__ic--chan">' +
          NX.icon(c.channel.type === "voice" ? "voice" : "hash", "", 17) + "</span>" +
          '<span class="ex-res__txt">' +
          '<span class="ex-res__t">' + highlight(c.channel.name, term) + "</span>" +
          '<span class="ex-res__s">' +
          (c.category ? u().h(c.category) + " · " : "") +
          (c.server ? highlight(c.server.name, term) : "") +
          "</span></span>" +
          '<span class="ex-res__go">' + NX.icon("chevronRight", "", 16) + "</span>",
      });
    });
    html += sectionHTML("channels", "Canais", "hash", channels.length, body);

    /* --- mensagens --- */
    const messages = searchMessages(term);
    body = "";
    messages.forEach((msg) => {
      const ch = db().channels && db().channels[msg.channelId];
      const dm = db().dms && db().dms[msg.channelId];
      if (!ch && !dm) return;
      const author = (db().users || {})[msg.authorId];
      const server = ch ? (db().servers || {})[ch.serverId] : null;
      const where = ch
        ? "#" + (ch.name || "") + (server ? " em " + server.name : "")
        : "Conversa direta";
      const a = ch ? ch.serverId : "";
      const b = ch ? ch.id : "";
      body += rowHTML({
        kind: ch ? "channel" : "dm",
        id: msg.channelId,
        a: a,
        b: b,
        title: msg.content,
        aria: "Abrir mensagem de " + (author ? author.displayName || author.username : "alguém"),
        body:
          '<span class="ex-res__ic ex-res__ic--msg">' + NX.icon("chat", "", 16) + "</span>" +
          '<span class="ex-res__txt">' +
          '<span class="ex-res__t ex-res__t--msg">' + highlight(excerpt(msg.content || "", term, 34, 70), term) + "</span>" +
          '<span class="ex-res__s">' +
          (author ? u().h(author.displayName || author.username) + " · " : "") +
          u().h(where) + " · " + u().h(u().timeAgo(msg.createdAt || 0)) +
          "</span></span>",
      });
    });
    html += sectionHTML("messages", "Mensagens", "chat", messages.length, body);

    const total = flat.length;
    if (!total) {
      listEl.innerHTML = emptyBlock(
        'Nada encontrado para “' + oneLine(query, 28) + '”',
        "Tente outro termo — a busca olha usuários, servidores, canais e mensagens.",
        "search"
      );
      setStatus("Nenhum resultado");
      return;
    }
    listEl.innerHTML = html;
    setStatus(total + (total === 1 ? " resultado" : " resultados"));
    moveActive(0, true);
  }

  function setStatus(text) {
    const s = overlayEl && overlayEl.querySelector("[data-ex-status]");
    if (!s) return;
    s.textContent = text;
    s.hidden = !text;
  }

  /* ---------------- navegação por teclado ---------------- */
  function moveActive(step, keep) {
    const rows = overlayEl ? overlayEl.querySelectorAll(".ex-res") : [];
    if (!rows.length) {
      active = -1;
      return;
    }
    if (keep && active >= 0 && active < rows.length) return;
    if (active < 0) active = step < 0 ? rows.length - 1 : 0;
    else active = Math.max(0, Math.min(rows.length - 1, active + step));

    for (let i = 0; i < rows.length; i++) {
      const on = i === active;
      rows[i].classList.toggle("is-active", on);
      if (on) {
        rows[i].setAttribute("aria-current", "true");
        try {
          rows[i].scrollIntoView({ block: "nearest" });
        } catch (e) { /* opcional */ }
      } else {
        rows[i].removeAttribute("aria-current");
      }
    }
  }

  function openResult(idx) {
    const item = flat[idx];
    if (!item) return;
    closeSearch();
    goForResult(item);
  }

  function goForResult(item) {
    const app = NX.app;
    if (!app || typeof app.go !== "function") return;
    if (item.kind === "user") {
      app.go("#/perfil/" + item.id);
    } else if (item.kind === "server") {
      if (item.a === "1") app.go("#/s/" + item.id);
      else app.go("#/explorar");
    } else if (item.kind === "channel") {
      app.go("#/s/" + item.a + "/" + item.id);
    } else if (item.kind === "dm") {
      app.go("#/mensagens/" + item.id);
    }
  }

  /* ============================================================
     BUSCA · overlay
     ============================================================ */
  function searchOverlayHTML() {
    return (
      '<div class="ex-search" id="ex-search" hidden>' +
      '<div class="ex-search__scrim" data-action="nx-search-close" aria-hidden="true"></div>' +
      '<div class="ex-search__panel" role="dialog" aria-modal="true" aria-label="Busca global">' +
      '<div class="ex-search__bar">' +
      '<span class="ex-search__ico">' + NX.icon("search", "", 19) + "</span>" +
      '<input class="ex-search__input" type="text" data-ex-input autocomplete="off" spellcheck="false"' +
      ' placeholder="Buscar usuários, servidores, canais e mensagens"' +
      ' aria-label="Busca global" aria-controls="ex-results" />' +
      '<span class="ex-search__status" data-ex-status hidden></span>' +
      '<button type="button" class="ex-search__close" data-action="nx-search-close" aria-label="Fechar busca">' +
      NX.icon("x", "", 17) + "</button>" +
      "</div>" +
      '<div class="ex-search__results" id="ex-results" data-ex-results></div>' +
      '<footer class="ex-search__foot">' +
      "<span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>" +
      "<span><kbd>Enter</kbd> abrir</span>" +
      "<span><kbd>Esc</kbd> fechar</span>" +
      '<span class="ex-search__foot-hint">Busca em usuários, servidores, canais e mensagens</span>' +
      "</footer>" +
      "</div></div>"
    );
  }

  function openSearch() {
    if (!mounted) extras.mount();
    if (!overlayEl) return false;
    closeNotifications();
    searchOpen = true;
    overlayEl.hidden = false;
    overlayEl.classList.remove("is-out");
    requestAnimationFrame(() => overlayEl.classList.add("is-in"));
    listEl = overlayEl.querySelector("[data-ex-results]");
    inputEl = overlayEl.querySelector("[data-ex-input]");
    if (inputEl) {
      inputEl.value = inputEl.value || "";
      setTimeout(() => {
        try {
          inputEl.focus();
          inputEl.select();
        } catch (e) { /* ignora */ }
      }, 40);
    }
    renderResults(inputEl ? inputEl.value : "");
    return true;
  }

  function closeSearch() {
    if (!searchOpen || !overlayEl) return false;
    searchOpen = false;
    overlayEl.classList.remove("is-in");
    overlayEl.classList.add("is-out");
    setTimeout(() => {
      if (!searchOpen) overlayEl.hidden = true;
    }, 170);
    return true;
  }

  function toggleSearch() {
    if (searchOpen) closeSearch();
    else openSearch();
  }

  /* ============================================================
     NOTIFICAÇÕES · painel
     ============================================================ */
  function notifIcon(type) {
    if (type === "invite" || type === "follow" || type === "follow_request") return "userPlus";
    if (type === "mention") return "chat";
    if (type === "server") return "shield";
    if (type === "like") return "heartFill";
    if (type === "comment" || type === "reply") return "comment";
    return "info";
  }

  function notifPanelHTML() {
    return (
      '<div class="ex-notif" id="ex-notif" role="dialog" aria-label="Notificações" hidden>' +
      '<header class="ex-notif__head">' +
      '<span class="ex-notif__emoji" aria-hidden="true">🔔</span>' +
      '<h2 class="ex-notif__title">Notificações</h2>' +
      '<span class="ex-notif__count" data-ex-notif-count></span>' +
      '<button type="button" class="icon-btn icon-btn--xs" data-action="nx-notif-close" aria-label="Fechar notificações">' +
      NX.icon("x", "", 16) + "</button>" +
      "</header>" +
      '<div class="ex-notif__acts">' +
      '<button type="button" class="btn btn--soft btn--sm" data-action="nx-notif-read-all">' +
      NX.icon("check", "", 15) + "<span>Marcar como lido</span></button>" +
      '<button type="button" class="btn btn--ghost btn--sm" data-action="nx-notif-clear">' +
      NX.icon("trash", "", 15) + "<span>Limpar</span></button>" +
      '<span class="spacer"></span>' +
      '<button type="button" class="icon-btn" data-action="nx-notif-config" title="Configurar notificações"' +
      ' aria-label="Configurar notificações">' + NX.icon("settings", "", 17) + "</button>" +
      "</div>" +
      '<div class="ex-notif__list" data-ex-notif-list></div>' +
      "</div>"
    );
  }

  function renderNotif(force) {
    if (!panelEl) return;
    const list = panelEl.querySelector("[data-ex-notif-list]");
    const countEl = panelEl.querySelector("[data-ex-notif-count]");
    const items = notifList();
    const n = unread();

    /* assinatura: evita re-render em cascata com o MutationObserver */
    const sig = n + "|" + items.map((x) => x.id + (x.read ? "1" : "0")).join(",");
    if (!force && panelEl.getAttribute("data-sig") === sig) return;
    panelEl.setAttribute("data-sig", sig);

    if (countEl) {
      countEl.textContent = n > 0 ? n + " não lida" + (n > 1 ? "s" : "") : "em dia";
      countEl.classList.toggle("is-zero", n === 0);
    }

    const readAllBtn = panelEl.querySelector('[data-action="nx-notif-read-all"]');
    if (readAllBtn) readAllBtn.disabled = n === 0;
    const clearBtn = panelEl.querySelector('[data-action="nx-notif-clear"]');
    if (clearBtn) clearBtn.disabled = items.length === 0;

    if (!list) return;
    if (!items.length) {
      list.innerHTML =
        '<div class="ex-notif__empty">' +
        '<span class="ex-notif__empty-ico">' + NX.icon("bell", "", 24) + "</span>" +
        '<p class="ex-notif__empty-title">Você está em dia por aqui.</p>' +
        '<p class="ex-notif__empty-hint">Convites, menções e avisos dos seus servidores aparecem nesta lista.</p>' +
        "</div>";
      return;
    }

    let html = "";
    items.forEach((nt) => {
      html +=
        '<article class="ex-notif__item' + (nt.read ? "" : " is-unread") + '"' +
        ' role="button" tabindex="0" data-action="nx-notif-read-one" data-id="' + u().h(nt.id) + '"' +
        ' aria-label="' + u().h((nt.read ? "" : "Não lida — ") + nt.text) + '">' +
        '<span class="ex-notif__ico ex-notif__ico--' + u().h(nt.type || "system") + '">' +
        NX.icon(notifIcon(nt.type), "", 16) + "</span>" +
        '<span class="ex-notif__body">' +
        '<span class="ex-notif__text">' + u().h(nt.text) + "</span>" +
        '<span class="ex-notif__meta">' +
        '<time datetime="' + u().h(new Date(nt.at || 0).toISOString()) + '">' +
        u().h(u().timeAgo(nt.at || 0)) + "</time>" +
        (nt.read ? "" : "<i>· não lida</i>") +
        "</span></span>" +
        (nt.read
          ? ""
          : '<span class="ex-notif__dot" aria-hidden="true"></span>') +
        "</article>";
    });
    list.innerHTML = html;
  }

  function placePanel(anchor) {
    if (!panelEl) return;
    panelEl.style.visibility = "hidden";
    panelEl.style.left = "0px";
    panelEl.style.top = "0px";
    const w = panelEl.offsetWidth;
    const h = panelEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left;
    let top;
    if (anchor && anchor.getBoundingClientRect) {
      const r = anchor.getBoundingClientRect();
      left = r.right - w;
      top = r.bottom + 8;
      if (top + h > vh - 8) top = Math.max(8, r.top - h - 8);
    } else {
      left = vw - w - 12;
      top = 64;
    }
    left = Math.max(8, Math.min(left, vw - w - 8));
    top = Math.max(8, Math.min(top, vh - h - 8));
    panelEl.style.left = Math.round(left) + "px";
    panelEl.style.top = Math.round(top) + "px";
    panelEl.style.visibility = "";
  }

  function openNotifications(anchor) {
    if (!mounted) extras.mount();
    if (!panelEl) return false;
    if (!chromeVisible()) return false;
    closeSearch();
    notifAnchor = anchor && anchor.getBoundingClientRect ? anchor : findBell();
    notifOpen = true;
    renderNotif(true);
    panelEl.hidden = false;
    requestAnimationFrame(() => {
      panelEl.classList.add("is-in");
      placePanel(notifAnchor);
    });
    return true;
  }

  function closeNotifications() {
    if (!notifOpen || !panelEl) return false;
    notifOpen = false;
    panelEl.classList.remove("is-in");
    setTimeout(() => {
      if (!notifOpen) panelEl.hidden = true;
    }, 160);
    return true;
  }

  function toggleNotifications(anchor) {
    if (notifOpen) closeNotifications();
    else openNotifications(anchor);
  }

  function findBell() {
    return (
      document.querySelector('[data-action="nx-bell"]') ||
      document.querySelector("[data-ex-bar] [data-nav='notifications']") ||
      null
    );
  }

  /* ============================================================
     ações registradas
     ============================================================ */
  function registerActions() {
    NX.action("nx-search", () => {
      toggleSearch();
    });

    NX.action("nx-search-close", () => {
      closeSearch();
    });

    NX.action("nx-search-go", (el) => {
      const idx = parseInt(el.getAttribute("data-ex-idx"), 10);
      if (!isNaN(idx)) openResult(idx);
    });

    NX.action("nx-bell", (el) => {
      toggleNotifications(el);
    });

    NX.action("nx-bottom-nav", (el) => {
      const nav = el.getAttribute("data-nav");
      if (nav === "notifications") {
        toggleNotifications(el);
        return;
      }
      const to = el.getAttribute("data-to");
      if (to && NX.app) NX.app.go(to);
    });

    NX.action("nx-notif-close", () => closeNotifications());

    NX.action("nx-notif-read-one", async (el) => {
      const id = el.getAttribute("data-id");
      if (!id) return;
      try {
        await NX.api.markNotificationsRead([id]);
        refreshBadges();
      } catch (e) {
        NX.ui.error(e.message || "Não foi possível marcar como lida.");
      }
      /* abre o conteúdo correspondente (curtida, comentário, seguidor…) */
      try {
        const me = S().me();
        const nt = me
          ? (S().notificationsOf(me.id) || []).find((n) => n.id === id)
          : null;
        const href = nt && nt.meta && nt.meta.href;
        if (href && NX.app) {
          closeNotifications();
          NX.app.go(href);
        }
      } catch (e) {
        /* sem destino: só marca como lida */
      }
    });

    NX.action("nx-notif-read-all", async () => {
      try {
        await NX.api.markNotificationsRead("all");
        refreshBadges();
        NX.ui.success("Tudo em dia: notificações marcadas como lidas.");
      } catch (e) {
        NX.ui.error(e.message || "Não foi possível atualizar.");
      }
    });

    NX.action("nx-notif-clear", async () => {
      closeNotifications();
      try {
        const ok = await NX.ui.confirm({
          title: "Limpar notificações",
          message: "Todas as suas notificações serão removidas. Esta ação não pode ser desfeita.",
          confirmLabel: "Limpar",
          danger: true,
          icon: "bell",
        });
        if (!ok) return;
        await NX.api.clearNotifications();
        refreshBadges();
        NX.ui.success("Notificações limpas.");
      } catch (e) {
        NX.ui.error(e.message || "Não foi possível limpar.");
      }
    });

    NX.action("nx-notif-config", () => {
      closeNotifications();
      if (NX.app) NX.app.go("#/config");
    });
  }

  /* ============================================================
     eventos globais
     ============================================================ */
  function onKeydown(e) {
    /* Ctrl/Cmd + K — busca global */
    if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key || "").toLowerCase() === "k") {
      if (searchOpen || !NX.ui.isOpen || !NX.ui.isOpen()) {
        e.preventDefault();
        toggleSearch();
      }
      return;
    }

    if (searchOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeSearch();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        moveActive(1, false);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        moveActive(-1, false);
        return;
      }
      if (e.key === "Enter") {
        if (active >= 0) {
          e.preventDefault();
          e.stopPropagation();
          openResult(active);
        }
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      return;
    }

    if (notifOpen && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeNotifications();
    }
  }

  function onOutside(e) {
    if (!notifOpen) return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (panelEl && panelEl.contains(t)) return;
    if (t.closest('[data-action="nx-bell"]')) return; /* deixa o clique alternar */
    if (t.closest("[data-ex-bar] [data-nav='notifications']")) return;
    closeNotifications();
  }

  function onItemKey(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target;
    if (!t || !t.closest) return;
    const item = t.closest(".ex-notif__item");
    if (!item) return;
    e.preventDefault();
    item.click();
  }

  function bind() {
    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("mousedown", onOutside, true);

    document.addEventListener(
      "keydown",
      (e) => {
        if (panelEl) onItemKey(e);
      },
      false
    );

    window.addEventListener("hashchange", () => {
      closeNotifications();
      navManualHash = null;
      syncNav();
      syncChrome();
    });

    window.addEventListener(
      "resize",
      u().debounce(() => {
        if (notifOpen) placePanel(notifAnchor);
      }, 120)
    );

    if (NX.store && typeof NX.store.subscribe === "function") {
      unsubStore = NX.store.subscribe(() => {
        refreshBadges();
        syncChrome();
        syncNav();
      });
    }

    /* botões/barra podem ser injetados pelo app depois do mount */
    if (window.MutationObserver && document.body) {
      let pending = null;
      const mo = new MutationObserver(() => {
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
          pending = null;
          try {
            refreshBadges();
            syncChrome();
            syncNav();
          } catch (e) {
            console.error("[extras] sync", e);
          }
        }, 120);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  /* ============================================================
     contrato público
     ============================================================ */
  const extras = {};

  extras.searchButtonHTML = function () {
    return (
      '<button type="button" class="icon-btn ex-btn-search" data-action="nx-search"' +
      ' title="Buscar (Ctrl+K)" aria-label="Buscar">' +
      NX.icon("search", "", 19) +
      '<kbd class="ex-btn-search__kbd" aria-hidden="true">K</kbd>' +
      "</button>"
    );
  };

  extras.bellButtonHTML = function () {
    return (
      '<button type="button" class="icon-btn ex-btn-bell" data-action="nx-bell"' +
      ' aria-label="Notificações">' +
      NX.icon("bell", "", 19) +
      '<span class="ex-badge" data-ex-badge hidden></span>' +
      "</button>"
    );
  };

  extras.bottomBarHTML = function () {
    const m = me();
    const profile = m ? "#/perfil/" + m.id : "#/";
    const item = (nav, label, icon, to) => {
      const badge = nav === "notifications"
        ? '<span class="ex-bar__badge" data-ex-badge hidden></span>'
        : "";
      return (
        '<button type="button" class="ex-bar__item" data-action="nx-bottom-nav" data-nav="' + nav + '"' +
        (to ? ' data-to="' + u().h(to) + '"' : "") +
        ' aria-label="' + u().h(label) + '">' +
        '<span class="ex-bar__ico">' + NX.icon(icon, "", 22) + badge + "</span>" +
        '<span class="ex-bar__label">' + u().h(label) + "</span>" +
        "</button>"
      );
    };
    return (
      '<nav class="ex-bar" data-ex-bar aria-label="Navegação principal"' +
      (chromeVisible() ? "" : " hidden") +
      ">" +
      item("home", "Início", "home", "#/") +
      item("messages", "Mensagens", "chat", "#/mensagens") +
      item("notifications", "Notificações", "bell", null) +
      item("profile", "Perfil", "user", profile) +
      "</nav>"
    );
  };

  extras.mount = function () {
    if (mounted) {
      refreshBadges();
      syncChrome();
      return true;
    }
    mounted = true;

    rootEl = document.createElement("div");
    rootEl.id = "ex-root";
    rootEl.className = "ex-root";
    document.body.appendChild(rootEl);

    rootEl.insertAdjacentHTML("beforeend", searchOverlayHTML());
    rootEl.insertAdjacentHTML("beforeend", notifPanelHTML());

    overlayEl = rootEl.querySelector("#ex-search");
    panelEl = rootEl.querySelector("#ex-notif");
    listEl = overlayEl ? overlayEl.querySelector("[data-ex-results]") : null;
    inputEl = overlayEl ? overlayEl.querySelector("[data-ex-input]") : null;

    runSearch = u().debounce((v) => renderResults(v), 120);
    if (inputEl) {
      inputEl.addEventListener("input", () => runSearch(inputEl.value));
    }

    registerActions();
    bind();
    refreshBadges();
    syncChrome();
    syncNav();
    return true;
  };

  extras.openSearch = function () {
    return openSearch();
  };

  extras.closeSearch = function () {
    return closeSearch();
  };

  extras.openNotifications = function (anchor) {
    return openNotifications(anchor);
  };

  extras.closeNotifications = function () {
    return closeNotifications();
  };

  extras.refreshBadges = function () {
    refreshBadges();
    return unread();
  };

  extras.setActiveNav = function (name) {
    navManualHash = routeKey();
    return applyNav(name || null);
  };

  extras.syncNav = function () {
    syncNav();
  };

  /* pulso discreto em qualquer elemento/seletor ("mensagens novas") */
  extras.pulse = function (selector) {
    const el =
      typeof selector === "string" ? document.querySelector(selector) : selector;
    if (!el || !el.classList) return false;
    el.classList.remove("ex-pulse");
    void el.offsetWidth;
    el.classList.add("ex-pulse");
    setTimeout(() => el.classList.remove("ex-pulse"), 1100);
    return true;
  };

  extras.isOpen = function () {
    return { search: searchOpen, notifications: notifOpen, mounted: mounted };
  };

  extras.__id = "nexo-extras";
  NX.extras = extras;

  /* montagem automática quando o DOM estiver pronto (idempotente) */
  function autoMount() {
    try {
      extras.mount();
      refreshBadges();
      syncChrome();
    } catch (e) {
      console.error("[extras] mount", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    setTimeout(autoMount, 0);
  }
})(window.NX);
