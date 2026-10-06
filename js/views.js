/* ============================================================
   NEXO · views
   Renderização do shell da aplicação: rail de servidores,
   barra de canais, cabeçalho, área central, chat, voz e membros.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const u = () => NX.util;
  const S = () => NX.selectors;
  const views = {};

  views.editingMessageId = null;

  /* ================= RAIL (barra de servidores) ================= */
  views.rail = function () {
    const me = S().me();
    const route = NX.app.route;
    const servers = S().serversOf(me.id);
    const activeServer = route.serverId;

    const item = (o) =>
      '<button class="rail__item' + (o.active ? " is-active" : "") + '" data-action="' + o.action + '"' +
      (o.id ? ' data-id="' + u().h(o.id) + '"' : "") +
      ' data-tooltip="' + u().h(o.tooltip) + '" aria-label="' + u().h(o.tooltip) + '">' +
      o.inner +
      "</button>";

    let html = "";

    html += item({
      action: "nav",
      tooltip: "Início",
      active: route.name === "home" || route.name === "profile",
      inner:
        '<span class="rail__bubble rail__bubble--brand">' + NX.icon("home", "", 21) + "</span>" +
        '<span class="rail__label">Início</span>',
    });

    html += item({
      action: "nav-messages",
      tooltip: "Mensagens",
      active: route.name === "messages",
      inner:
        '<span class="rail__bubble">' + NX.icon("chat", "", 21) + "</span>" +
        '<span class="rail__label">Mensagens</span>',
    });

    html += item({
      action: "nav-feed",
      tooltip: "Feed",
      active: route.name === "feed",
      inner:
        '<span class="rail__bubble">' + NX.icon("heart", "", 21) + "</span>" +
        '<span class="rail__label">Feed</span>',
    });

    html += '<div class="rail__divider"></div>';

    servers.forEach((s) => {
      const active = s.id === activeServer;
      const online = S().onlineCount(s.id);
      html +=
        '<div class="rail__slot' + (active ? " is-active" : "") + '">' +
        item({
          action: "open-server",
          id: s.id,
          tooltip: s.name,
          active: active,
          inner:
            u().serverIconHTML(s, "rail", false) +
            (online ? '<span class="rail__online" title="' + online + ' online">' + online + "</span>" : "") +
            '<span class="rail__indicator" aria-hidden="true"></span>' +
            '<span class="rail__tip">' + u().h(s.name) + "</span>",
        }) +
        "</div>";
    });

    html += item({
      action: "create-server",
      tooltip: "Criar servidor",
      inner:
        '<span class="rail__bubble rail__bubble--action">' + NX.icon("plus", "", 21) + "</span>" +
        '<span class="rail__label">Criar</span>',
    });

    html += item({
      action: "nav-explore",
      tooltip: "Explorar servidores",
      active: route.name === "explore",
      inner:
        '<span class="rail__bubble rail__bubble--action">' + NX.icon("compass", "", 21) + "</span>" +
        '<span class="rail__label">Explorar</span>',
    });

    html += '<div class="rail__spacer"></div>';

    html +=
      '<button class="rail__item rail__profile" data-action="profile-menu" data-tooltip="Você" aria-label="Sua conta">' +
      u().avatarHTML(me, "sm", true) +
      '<span class="rail__tip">' + u().h(me.displayName) + "</span>" +
      "</button>";

    document.getElementById("rail").innerHTML = html;
  };

  /* ================= SIDEBAR ================= */
  function serverHead(server) {
    const me = S().me();
    const canInvite = S().can(server.id, me.id, "createInvite");
    const canManage = S().can(server.id, me.id, "manageChannels");
    const online = S().onlineCount(server.id);
    return (
      '<header class="srv-head">' +
      '<button class="srv-head__btn" data-action="server-menu" data-id="' + server.id + '">' +
      u().serverIconHTML(server, "xs", false) +
      '<span class="srv-head__name">' + u().h(server.name) + "</span>" +
      NX.icon("chevronDown", "srv-head__chev", 16) +
      "</button>" +
      '<div class="srv-head__tools">' +
      (canInvite
        ? '<button class="icon-btn icon-btn--accent" data-action="invite" data-id="' + server.id + '" title="Convidar pessoas" aria-label="Convidar pessoas">' +
          NX.icon("userPlus", "", 18) +
          "</button>"
        : "") +
      (canManage
        ? '<button class="icon-btn" data-action="create-channel" data-id="' + server.id + '" title="Criar canal" aria-label="Criar canal">' +
          NX.icon("plus", "", 18) +
          "</button>"
        : "") +
      "</div>" +
      "</header>"
    );
  }

  function voiceDock() {
    const me = S().me();
    const ch = S().voiceChannelOfUser(me.id);
    if (!ch) return "";
    const server = S().server(ch.serverId);
    const people = S().voiceOf(ch.id).length;
    return (
      '<div class="voice-dock">' +
      '<div class="voice-dock__top">' +
      NX.icon("voice", "voice-dock__ico", 16) +
      '<div class="voice-dock__txt"><strong>Conectado</strong><span>' + u().h(ch.name) + "</span></div>" +
      "</div>" +
      '<div class="voice-dock__meta">' + u().h(server ? server.name : "") + " · " + people + " na sala</div>" +
      '<button class="btn btn--danger-soft btn--sm btn--block" data-action="leave-voice">' +
      NX.icon("power", "", 15) + " Desconectar</button>" +
      "</div>"
    );
  }

  function channelRow(ch, canManage) {
    const isActive = NX.app.route.channelId === ch.id;
    const isVoice = ch.type === "voice";
    const locked = ch.overrides && (ch.overrides.send === "none" || ch.overrides.send === "private");
    const people = isVoice ? S().voiceOf(ch.id) : [];
    let voicePeople = "";
    if (isVoice && people.length) {
      voicePeople =
        '<span class="chan__people">' +
        people
          .slice(0, 4)
          .map((p) => {
            const usr = S().user(p.userId);
            return usr ? u().avatarHTML(usr, "xs", true) : "";
          })
          .join("") +
        (people.length > 4 ? '<span class="chan__more">+' + (people.length - 4) + "</span>" : "") +
        "</span>";
    }
    return (
      '<div class="chan' + (isActive ? " is-active" : "") + '" data-id="' + ch.id + '">' +
      '<button class="chan__main" data-action="open-channel" data-id="' + ch.id + '" title="' + u().h(ch.name) + '">' +
      NX.icon(isVoice ? "voice" : "hash", "chan__ico", 19) +
      '<span class="chan__name">' + u().h(ch.name) + "</span>" +
      (locked ? NX.icon("lock", "chan__lock", 13) : "") +
      "</button>" +
      voicePeople +
      (canManage
        ? '<button class="chan__gear" data-action="channel-menu" data-id="' + ch.id + '" aria-label="Opções do canal">' +
          NX.icon("more", "", 16) +
          "</button>"
        : "") +
      "</div>"
    );
  }

  function serverSidebar(server) {
    const me = S().me();
    const canManage = S().can(server.id, me.id, "manageChannels");
    const tree = S().visibleCategoryTree(server.id, me.id);

    let body = "";
    if (!tree.length) {
      body =
        '<div class="sidebar__empty">' +
        NX.icon("folder", "", 26) +
        "<p>Nenhum canal visível.</p>" +
        (canManage
          ? '<button class="btn btn--soft btn--sm" data-action="create-category" data-id="' + server.id + '">Criar categoria</button>'
          : "") +
        "</div>";
    } else {
      tree.forEach((node) => {
        const cat = node.category;
        const collapsed = !!cat.collapsed;
        body +=
          '<div class="cat' + (collapsed ? " is-collapsed" : "") + '" data-id="' + cat.id + '">' +
          '<div class="cat__row">' +
          '<button class="cat__toggle" data-action="toggle-category" data-id="' + cat.id + '" aria-expanded="' + (!collapsed) + '">' +
          NX.icon("chevronRight", "cat__chev", 13) +
          '<span class="cat__name">' + u().h(cat.name) + "</span>" +
          "</button>" +
          (canManage
            ? '<button class="cat__add" data-action="create-channel" data-id="' + server.id + '" data-cat="' + cat.id + '" title="Criar canal em ' +
              u().h(cat.name) + '">' + NX.icon("plus", "", 15) + "</button>" +
              '<button class="cat__menu" data-action="category-menu" data-id="' + cat.id + '" title="Opções da categoria">' +
              NX.icon("more", "", 15) + "</button>"
            : "") +
          "</div>" +
          '<div class="cat__channels">' +
          node.channels.map((c) => channelRow(c, canManage)).join("") +
          "</div>" +
          "</div>";
      });
      if (canManage) {
        body +=
          '<div class="sidebar__add">' +
          '<button class="add-row" data-action="create-channel" data-id="' + server.id + '">' +
          NX.icon("plus", "", 16) + " Criar canal</button>" +
          '<button class="add-row" data-action="create-category" data-id="' + server.id + '">' +
          NX.icon("folderPlus", "", 16) + " Criar categoria</button>" +
          "</div>";
      }
    }

    return serverHead(server) + '<div class="sidebar__scroll">' + body + "</div>" + voiceDock();
  }

  function homeSidebar() {
    const me = S().me();
    const route = NX.app.route;
    const servers = S().serversOf(me.id);
    const item = (o) =>
      '<button class="nav-row' + (o.active ? " is-active" : "") + '" data-action="' + o.action + '"' +
      (o.to ? ' data-to="' + o.to + '"' : "") +
      ">" +
      NX.icon(o.icon, "nav-row__ico", 18) +
      '<span class="nav-row__label">' + o.label + "</span>" +
      (o.badge ? '<span class="nav-row__badge">' + o.badge + "</span>" : "") +
      "</button>";

    let html =
      '<header class="side-head">' +
      NX.brandMark(26) +
      "<span>Nexo</span>" +
      "</header>" +
      '<div class="sidebar__scroll"><nav class="nav-group">' +
      item({ action: "nav", to: "#/", icon: "home", label: "Página inicial", active: route.name === "home" }) +
      item({ action: "nav-messages", icon: "chat", label: "Mensagens" }) +
      item({ action: "nav-explore", icon: "compass", label: "Explorar", active: route.name === "explore" }) +
      "</nav>";

    html +=
      '<div class="side-section">' +
      '<div class="side-section__head"><span>Servidores</span>' +
      '<button class="icon-btn icon-btn--xs" data-action="create-server" title="Criar servidor">' +
      NX.icon("plus", "", 15) +
      "</button></div>";

    if (!servers.length) {
      html +=
        '<p class="side-note">Você ainda não está em nenhum servidor.</p>' +
        '<div class="side-cta">' +
        '<button class="btn btn--soft btn--sm btn--block" data-action="create-server">' +
        NX.icon("plus", "", 16) + " Criar servidor</button>" +
        '<button class="btn btn--soft btn--sm btn--block" data-action="nav-explore">' +
        NX.icon("search", "", 16) + " Explorar servidores</button>" +
        "</div>";
    } else {
      html += '<div class="side-servers">';
      servers.forEach((s) => {
        html +=
          '<button class="side-server" data-action="open-server" data-id="' + s.id + '">' +
          u().serverIconHTML(s, "xs", false) +
          '<span class="side-server__txt"><strong class="truncate">' + u().h(s.name) + "</strong>" +
          "<small>" + u().plural(S().memberCount(s.id), "membro", "membros") + "</small></span>" +
          "</button>";
      });
      html += "</div>";
    }

    html +=
      '<div class="side-cta">' +
      '<button class="btn btn--soft btn--sm btn--block" data-action="join-invite">' + NX.icon("enter", "", 16) +
      " Entrar com convite</button></div></div>";

    html += "</div>" + voiceDock();
    return html;
  }

  function messagesSidebar() {
    const me = S().me();
    const route = NX.app.route;
    const dms = S().dmsOf(me.id);
    let html =
      '<header class="side-head">' + NX.icon("chat", "", 18) + "<span>Mensagens</span></header>" +
      '<div class="sidebar__scroll">' +
      '<div class="side-section__head side-section__head--pad"><span>Conversas</span>' +
      '<button class="icon-btn icon-btn--xs" data-action="new-dm" title="Nova conversa">' +
      NX.icon("plus", "", 15) +
      "</button></div>";

    if (!dms.length) {
      html += '<p class="side-note">Nenhuma conversa ainda. Escolha alguém de um servidor para começar.</p>';
    } else {
      html += '<div class="dm-list">';
      dms.forEach((row) => {
        const active = route.dmId === row.dm.id;
        html +=
          '<button class="dm-row' + (active ? " is-active" : "") + '" data-action="open-dm" data-id="' + row.dm.id + '">' +
          u().avatarHTML(row.other, "sm", true) +
          '<span class="dm-row__txt"><strong class="truncate">' + u().h(row.other.displayName) + "</strong>" +
          "<small class=\"truncate\">" +
          (row.last ? u().h(row.last.content.slice(0, 46)) : "Sem mensagens ainda") +
          "</small></span>" +
          "</button>";
      });
      html += "</div>";
    }
    html +=
      '<div class="side-cta">' +
      '<button class="btn btn--soft btn--sm btn--block" data-action="new-dm">' + NX.icon("userPlus", "", 16) +
      " Nova conversa</button></div></div>";
    return html;
  }

  function exploreSidebar() {
    const servers = S().discoverableServers();
    return (
      '<header class="side-head">' + NX.icon("compass", "", 18) + "<span>Explorar</span></header>" +
      '<div class="sidebar__scroll">' +
      '<div class="side-block">' +
      "<h4>Servidores públicos</h4>" +
      "<p>Comunidades que decidiram aparecer no diretório. Nenhuma é obrigatória — você escolhe onde entrar.</p>" +
      '<div class="side-stat"><strong>' + servers.length + "</strong><span>no diretório</span></div>" +
      "</div>" +
      '<div class="side-block">' +
      "<h4>Tem seu servidor?</h4>" +
      "<p>Ative “Mostrar no explorar” nas configurações para aparecer aqui.</p>" +
      '<button class="btn btn--soft btn--sm btn--block" data-action="create-server">Criar servidor</button>' +
      "</div>" +
      "</div>"
    );
  }

  views.sidebar = function () {
    const el = document.getElementById("sidebar");
    const route = NX.app.route;
    let html = "";

    if (route.name === "server") {
      const server = S().server(route.serverId);
      html = server ? serverSidebar(server) : '<div class="sidebar__empty">Servidor não encontrado.</div>';
    } else if (route.name === "messages") {
      html = messagesSidebar();
    } else if (route.name === "explore") {
      html = exploreSidebar();
    } else {
      html = homeSidebar();
    }
    el.innerHTML = html;
  };

  /* ================= CABEÇALHO ================= */
  views.header = function () {
    const el = document.getElementById("channel-header");
    const me = S().me();
    const route = NX.app.route;

    const burger =
      '<button class="icon-btn header__burger" data-action="toggle-sidebar" aria-label="Abrir menu">' +
      NX.icon("menu", "", 20) +
      "</button>";

    let html = "";

    if (route.name === "server") {
      const server = S().server(route.serverId);
      const ch = S().channel(route.channelId);
      if (!server || !ch) {
        el.innerHTML = burger + '<span class="header__title">Canal indisponível</span>';
        return;
      }
      const canInvite = S().can(server.id, me.id, "createInvite");
      const canManage = S().can(server.id, me.id, "manageChannels");
      html =
        burger +
        '<span class="header__ico">' + NX.icon(ch.type === "voice" ? "voice" : "hash", "", 21) + "</span>" +
        '<span class="header__title">' + u().h(ch.name) + "</span>" +
        (ch.topic
          ? '<span class="header__topic"><i></i><span class="truncate">' + u().h(ch.topic) + "</span></span>"
          : "") +
        '<div class="header__actions">' +
        (canInvite
          ? '<button class="btn btn--accent btn--sm" data-action="invite" data-id="' + server.id + '">' +
            NX.icon("userPlus", "", 16) + "<span>Convidar pessoas</span></button>"
          : "") +
        '<button class="icon-btn" data-action="toggle-members" title="Membros" aria-label="Mostrar membros">' +
        NX.icon("users", "", 19) +
        "</button>" +
        (canManage
          ? '<button class="icon-btn" data-action="channel-settings" data-id="' + ch.id + '" title="Configurações do canal">' +
            NX.icon("settings", "", 19) +
            "</button>"
          : "") +
        "</div>";
    } else if (route.name === "dm") {
      const dm = S().user(route.dmOtherId);
      const controls =
        NX.people && typeof NX.people.dmHeaderControls === "function"
          ? NX.people.dmHeaderControls(route.dmId, route.dmOtherId)
          : "";
      html =
        burger +
        '<span class="header__ico">' + (dm ? u().avatarHTML(dm, "xs", true) : "") + "</span>" +
        '<span class="header__title">' + u().h(dm ? dm.displayName : "Conversa") + "</span>" +
        '<span class="header__status">' + u().h(dm ? NX.STATUS_LABEL[dm.status] || "" : "") + "</span>" +
        '<div class="header__actions">' +
        controls +
        '<button class="icon-btn" data-action="toggle-members" title="Detalhes" aria-label="Detalhes">' +
        NX.icon("info", "", 19) +
        "</button></div>";
    } else if (route.name === "messages") {
      html =
        burger +
        '<span class="header__ico">' + NX.icon("chat", "", 20) + "</span>" +
        '<span class="header__title">Mensagens</span>' +
        '<div class="header__actions">' +
        '<button class="btn btn--soft btn--sm" data-action="new-dm">' + NX.icon("userPlus", "", 16) +
        "<span>Nova conversa</span></button></div>";
    } else if (route.name === "explore") {
      html =
        burger +
        '<span class="header__ico">' + NX.icon("compass", "", 20) + "</span>" +
        '<span class="header__title">Explorar servidores</span>';
    } else if (route.name === "profile") {
      const user = S().user(route.userId) || me;
      html =
        burger +
        '<span class="header__ico">' + NX.icon("user", "", 20) + "</span>" +
        '<span class="header__title">Perfil</span>' +
        '<span class="header__topic"><i></i><span class="truncate">' + u().h(user.displayName) + "</span></span>";
    } else {
      html =
        burger +
        '<span class="header__ico">' + NX.brandMark(24) + "</span>" +
        '<span class="header__title">Início</span>' +
        '<div class="header__actions">' +
        '<button class="btn btn--accent btn--sm" data-action="create-server">' + NX.icon("plus", "", 16) +
        "<span>Criar servidor</span></button></div>";
    }
    el.innerHTML = html;

    /* botões globais: busca + notificações */
    let extras = "";
    if (NX.extras) {
      if (typeof NX.extras.searchButtonHTML === "function") extras += NX.extras.searchButtonHTML();
      if (typeof NX.extras.bellButtonHTML === "function") extras += NX.extras.bellButtonHTML();
    } else {
      extras +=
        '<button class="icon-btn" data-action="nx-search" title="Buscar" aria-label="Buscar">' +
        NX.icon("search", "", 18) + "</button>";
    }
    if (extras) {
      let bar = el.querySelector(".header__actions");
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "header__actions";
        el.appendChild(bar);
      }
      bar.insertAdjacentHTML("beforeend", extras);
    }
  };
  function messageText(m, members, serverId) {
    let text = u().h(m.content).replace(/\n/g, "<br>");
    text = text.replace(/(https?:\/\/[^\s<]+)/g, (mm) => {
      if (mm.indexOf("href=") !== -1) return mm;
      return '<a class="msg-link" href="' + mm + '" target="_blank" rel="noopener noreferrer">' + mm + "</a>";
    });
    (members || []).forEach((uname) => {
      const token = "@" + uname;
      if (text.indexOf(token) !== -1) {
        text = text.split(token).join('<span class="mention">' + token + "</span>");
      }
    });
    if (NX.chat && typeof NX.chat.emojify === "function") text = NX.chat.emojify(text, serverId);
    return text;
  }

  function messageActions(m, ctx) {
    const mine = m.authorId === S().me().id;
    if (NX.chat && typeof NX.chat.messageMenu === "function") {
      return (
        '<div class="msg__actions">' +
        '<button class="msg__act" data-action="chat-menu" data-id="' + m.id +
        '" title="Mais ações" aria-label="Mais ações">' + NX.icon("more", "", 15) + "</button>" +
        "</div>"
      );
    }
    const canModerate = ctx && ctx.canModerate;
    return (
      '<div class="msg__actions">' +
      (mine
        ? '<button class="msg__act" data-action="msg-edit" data-id="' + m.id + '" title="Editar">' +
          NX.icon("pencil", "", 15) + "</button>"
        : "") +
      (mine || canModerate
        ? '<button class="msg__act msg__act--danger" data-action="msg-delete" data-id="' + m.id + '" title="Excluir">' +
          NX.icon("trash", "", 15) + "</button>"
        : "") +
      "</div>"
    );
  }

  function authorLabel(m, serverId) {
    const author = S().user(m.authorId);
    if (!author) return "Usuário removido";
    const mem = serverId ? S().membership(serverId, author.id) : null;
    if (mem && mem.nickname) return mem.nickname;
    return author.displayName;
  }

  function messageHTML(m, grouped, info, ctx) {
    const serverId = ctx && ctx.serverId;
    const author = S().user(m.authorId) || {
      displayName: "Usuário removido",
      username: "—",
      avatar: { emoji: "?", color: "#6b817d" },
      status: "offline",
      id: "ghost",
    };
    const role = info.roleOf ? info.roleOf(m.authorId) : null;
    const names = info.list || [];
    const editing = views.editingMessageId === m.id;
    const label = authorLabel(m, serverId);

    const attachments =
      NX.chat && NX.chat.attachmentsHTML ? NX.chat.attachmentsHTML(m) : "";
    const reactions =
      m.reactions && Object.keys(m.reactions).length && NX.chat && NX.chat.reactionsHTML
        ? NX.chat.reactionsHTML(m, { canReact: !!ctx.canReact })
        : "";

    if (editing) {
      return (
        '<article class="msg is-editing" data-id="' + m.id + '">' +
        '<div class="msg__avatar">' + u().avatarHTML(author, "md", false) + "</div>" +
        '<div class="msg__body">' +
        '<div class="msg__meta"><span class="msg__author">' + u().h(label) + "</span>" +
        '<time>' + u().fmtTime(m.createdAt) + "</time></div>" +
        '<div class="msg__editor">' +
        '<textarea class="msg__editor-input" data-edit-input rows="2">' + u().h(m.content) + "</textarea>" +
        '<div class="msg__editor-hint">Enter para salvar · Esc para cancelar</div>' +
        '<div class="msg__editor-actions">' +
        '<button class="btn btn--ghost btn--sm" data-action="msg-cancel-edit">Cancelar</button>' +
        '<button class="btn btn--primary btn--sm" data-action="msg-save-edit" data-id="' + m.id + '">Salvar</button>' +
        "</div></div></div></article>"
      );
    }

    return (
      '<article class="msg' + (grouped ? " msg--grouped" : "") + (m.pinned ? " is-pinned" : "") +
      '" data-id="' + m.id + '">' +
      '<div class="msg__avatar">' +
      (grouped
        ? '<time class="msg__hover-time">' + u().fmtTime(m.createdAt) + "</time>"
        : u().avatarHTML(author, "md", true)) +
      "</div>" +
      '<div class="msg__body">' +
      (grouped
        ? ""
        : '<div class="msg__meta">' +
          '<button class="msg__author" data-action="open-profile" data-id="' + author.id + '">' +
          u().h(label) +
          "</button>" +
          (role
            ? '<span class="msg__role" style="--rc:' + role.color + '">' +
              u().h(role.icon ? role.icon + " " : "") + u().h(role.name) + "</span>"
            : "") +
          '<time class="msg__time" title="' + u().h(u().fmtDayLabel(m.createdAt)) + '">' +
          u().fmtTime(m.createdAt) +
          "</time>" +
          (m.pinned ? '<span class="msg__pin-tag">' + NX.icon("pin", "", 12) + " fixada</span>" : "") +
          "</div>") +
      (attachments ? '<div class="msg__attachments">' + attachments + "</div>" : "") +
      (m.content
        ? '<div class="msg__text">' + messageText(m, names, serverId) + "</div>"
        : "") +
      (m.updatedAt ? '<div class="msg__edited">(editado)</div>' : "") +
      (reactions ? '<div class="msg__reactions">' + reactions + "</div>" : "") +
      "</div>" +
      messageActions(m, ctx) +
      "</article>"
    );
  }

  function dayDivider(ts) {
    return (
      '<div class="day-divider"><span class="day-divider__line"></span>' +
      '<span class="day-divider__label">' + u().h(u().fmtDayLabel(ts)) + "</span>" +
      '<span class="day-divider__line"></span></div>'
    );
  }

  function chatEmpty(channel, isVoice) {
    return (
      '<div class="chat-empty">' +
      '<span class="chat-empty__icon">' + NX.icon(isVoice ? "voice" : "hash", "", 30) + "</span>" +
      "<h3>" +
      (isVoice ? u().h(channel.name) : "Este é o começo de #" + u().h(channel.name)) +
      "</h3>" +
      (channel.topic
        ? "<p>" + u().h(channel.topic) + "</p>"
        : isVoice
          ? "<p>Ninguém está na sala agora. Entre para começar.</p>"
          : "") +
      "</div>"
    );
  }

  function renderChat(channel) {
    const me = S().me();
    const isVoice = channel.type === "voice";
    const ref = channel.id;
    const canSend = S().canSendIn(channel, me.id);
    const canModerate =
      S().can(channel.serverId, me.id, "manageServer") ||
      S().can(channel.serverId, me.id, "administrator");

    if (isVoice) return "";

    const members = S().visibleMembersOf(channel.serverId);
    const usernames = members.map((m) => m.user.username);
    const roleOf = (uid) => {
      const found = members.find((m) => m.user.id === uid);
      return found ? found.role : null;
    };
    const memberInfo = { list: usernames, roleOf: roleOf };
    const ctx = {
      serverId: channel.serverId,
      canModerate: canModerate,
      canPin: S().channelPerm(channel, me.id, "pinMessages"),
      canReact: S().channelPerm(channel, me.id, "useEmojis"),
      canSend: canSend,
    };

    const msgs = S().messagesOf(ref);
    let body = "";
    let prev = null;
    msgs.forEach((m) => {
      if (!prev || !u().sameDay(prev.createdAt, m.createdAt)) body += dayDivider(m.createdAt);
      const grouped =
        prev &&
        prev.authorId === m.authorId &&
        m.createdAt - prev.createdAt < 5 * 60 * 1000 &&
        views.editingMessageId !== m.id &&
        views.editingMessageId !== prev.id;
      body += messageHTML(m, grouped, memberInfo, ctx);
      prev = m;
    });
    const hasMsgs = msgs.length > 0;
    if (!hasMsgs) body = chatEmpty(channel, false);

    return (
      '<div class="chat" data-ref="' + ref + '">' +
      (hasMsgs
        ? '<div class="chat__intro">' +
          '<span class="chat__intro-icon">' + NX.icon("hash", "", 26) + "</span>" +
          "<div><h2>Bem-vindo ao #" + u().h(channel.name) + "!</h2>" +
          "<p>" +
          u().h(channel.topic || "Este é o início do canal #" + channel.name + ".") +
          "</p></div></div>"
        : "") +
      '<div class="chat__list" data-chat-list>' +
      body +
      "</div>" +
      (canSend ? "" : voiceOrLockHint(channel, me)) +
      "</div>"
    );
  }

  function voiceOrLockHint(channel, me) {
    const ov = channel.overrides || {};
    let reason = "Você não tem permissão para enviar mensagens aqui.";
    if (ov.send === "none") reason = "Este canal está silenciado: ninguém pode enviar mensagens.";
    else if (ov.send === "private") reason = "Apenas o criador do canal pode enviar mensagens aqui.";
    else if (!S().can(channel.serverId, me.id, "sendMessages"))
      reason = "Seu cargo não tem a permissão “Enviar mensagens” neste servidor.";
    return (
      '<div class="chat__notice">' + NX.icon("lock", "", 16) + "<span>" + u().h(reason) + "</span></div>"
    );
  }

  function renderVoiceRoom(channel) {
    const me = S().me();
    const server = S().server(channel.serverId);
    const canJoin = S().can(channel.serverId, me.id, "joinVoice");
    const here = S().voiceOf(channel.id);
    const iAmIn = here.some((v) => v.userId === me.id);
    const others = here
      .map((v) => S().user(v.userId))
      .filter(Boolean);

    const cards = others
      .map(
        (usr) =>
          '<div class="voice-card">' +
          u().avatarHTML(usr, "lg", true) +
          "<strong>" + u().h(usr.displayName) + "</strong>" +
          '<span>' + u().h(usr.statusText || NX.STATUS_LABEL[usr.status] || "Online") + "</span>" +
          "</div>"
      )
      .join("");

    return (
      '<div class="voice-room">' +
      '<div class="voice-room__hero">' +
      '<span class="voice-room__icon">' + NX.icon("voice", "", 30) + "</span>" +
      "<div><h2>" + u().h(channel.name) + "</h2>" +
      "<p>" + u().h(server ? server.name : "") + " · " + u().plural(here.length, "pessoa", "pessoas") + " na sala</p></div>" +
      "</div>" +
      '<div class="voice-room__grid">' +
      (cards ||
        '<div class="voice-room__empty">Ninguém está conectado agora. Entre na sala para começar.</div>') +
      "</div>" +
      '<div class="voice-room__actions">' +
      (iAmIn
        ? '<button class="btn btn--danger" data-action="leave-voice">' + NX.icon("power", "", 17) + " Desconectar</button>"
        : canJoin
        ? '<button class="btn btn--primary" data-action="join-voice" data-id="' + channel.id + '">' +
          NX.icon("headset", "", 17) + " Entrar na sala</button>"
        : '<span class="btn btn--ghost is-disabled">' + NX.icon("lock", "", 16) + " Sem permissão para entrar</span>") +
      '<span class="voice-room__note">Protótipo de interface: áudio e chamadas entram quando o backend estiver conectado.</span>' +
      "</div>" +
      "</div>"
    );
  }

  /* ================= ÁREA CENTRAL ================= */
  views.content = function (scopes) {
    const el = document.getElementById("main-content");
    const route = NX.app.route;
    const key =
      route.name + "|" + (route.serverId || "") + "|" + (route.channelId || "") + "|" +
      (route.dmId || "") + "|" + (route.userId || "");

    const prevKey = el.dataset.key;
    const isChatRoute = route.name === "server" || route.name === "dm";
    const onlyMessages = prevKey === key && isChatRoute && (scopes || []).indexOf("messages") !== -1;
    const stickBottom = el.dataset.atbottom !== "false";

    if (onlyMessages) {
      const list = el.querySelector("[data-chat-list]");
      if (list) {
        const html = views.chatListHTML();
        list.innerHTML = html;
        if (stickBottom) views.scrollToBottom(el);
      }
      return;
    }

    const scrollTop = el.scrollTop;
    el.dataset.key = key;
    let html = "";

    if (route.name === "server") {
      const ch = S().channel(route.channelId);
      if (!ch) html = '<div class="state-block"><h3>Canal não encontrado</h3><p>Ele pode ter sido removido.</p></div>';
      else html = ch.type === "voice" ? renderVoiceRoom(ch) : renderChat(ch);
    } else if (route.name === "dm") {
      const other = S().user(route.dmOtherId);
      html = other
        ? renderDmChat(route.dmId, other)
        : '<div class="state-block"><h3>Conversa indisponível</h3></div>';
    } else if (route.name === "messages") {
      html = NX.pages.messagesEmpty();
    } else if (route.name === "explore") {
      html = NX.pages.explore();
    } else if (route.name === "profile") {
      html = NX.pages.profile(route.userId);
    } else if (route.name === "feed") {
      html = NX.pages.feed(route.postId);
    } else {
      html = NX.pages.home();
    }

    el.innerHTML = html;

    if (isChatRoute) {
      if (stickBottom) views.scrollToBottom(el);
      else el.scrollTop = scrollTop;
      if (views.editingMessageId) {
        const ta = el.querySelector("[data-edit-input]");
        if (ta) {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
      }
    } else {
      /* mesma rota repintada (curtida, comentário…) → mantém a
         posição de leitura; rota nova → topo */
      el.scrollTop = prevKey === key ? scrollTop : 0;
    }
  };

  views.chatListHTML = function () {
    const route = NX.app.route;
    if (route.name === "server") {
      const ch = S().channel(route.channelId);
      if (!ch || ch.type === "voice") return "";
      const holder = document.createElement("div");
      holder.innerHTML = renderChat(ch);
      const list = holder.querySelector("[data-chat-list]");
      return list ? list.innerHTML : "";
    }
    if (route.name === "dm") {
      const holder = document.createElement("div");
      holder.innerHTML = renderDmChat(route.dmId, S().user(route.dmOtherId));
      const list = holder.querySelector("[data-chat-list]");
      return list ? list.innerHTML : "";
    }
    return "";
  };

  function renderDmChat(dmId, other) {
    const me = S().me();
    const msgs = S().messagesOf(dmId);
    const memberInfo = { list: [other.username, me.username], roleOf: () => null };
    const ctx = { serverId: null, canModerate: false, canPin: false, canReact: true, canSend: true };
    const dm = NX.store.db.dms[dmId];
    let body = "";
    let prev = null;
    msgs.forEach((m) => {
      if (!prev || !u().sameDay(prev.createdAt, m.createdAt)) body += dayDivider(m.createdAt);
      const grouped =
        prev &&
        prev.authorId === m.authorId &&
        m.createdAt - prev.createdAt < 5 * 60 * 1000 &&
        views.editingMessageId !== m.id;
      body += messageHTML(m, grouped, memberInfo, ctx);
      prev = m;
    });
    if (!msgs.length)
      body =
        '<div class="chat-empty"><span class="chat-empty__icon">' + u().avatarHTML(other, "xl", true) +
        "</span><h3>" + u().h(other.displayName) + "</h3><p>Envie a primeira mensagem desta conversa.</p></div>";

    const blocked = S().blockedBetween(me.id, other.id);
    const muted = dm && dm.muted;

    return (
      '<div class="chat" data-ref="' + dmId + '">' +
      '<div class="chat__intro chat__intro--dm">' +
      u().avatarHTML(other, "xl", true) +
      "<div><h2>" + u().h(other.displayName) + "</h2>" +
      "<p>@" + u().h(other.username) + " · " + u().h(NX.STATUS_LABEL[other.status] || "") +
      (other.customStatus ? " · " + u().h((other.statusEmoji || "") + " " + other.customStatus) : "") +
      (other.bio ? " · " + u().h(other.bio) : "") +
      "</p></div></div>" +
      (blocked || muted
        ? '<div class="chat__notice">' + NX.icon("lock", "", 16) + "<span>" +
          (blocked
            ? "Conversa bloqueada — você ou a outra pessoa não pode enviar mensagens."
            : "Conversa silenciada: você não receberá notificações.") +
          "</span></div>"
        : "") +
      '<div class="chat__list" data-chat-list>' + body + "</div></div>"
    );
  }

  views.scrollToBottom = function (el) {
    const target = el || document.getElementById("main-content");
    requestAnimationFrame(() => {
      target.scrollTop = target.scrollHeight;
    });
  };

  /* ================= MEMBROS ================= */
  views.members = function () {
    const el = document.getElementById("members");
    const route = NX.app.route;
    const me = S().me();

    if (route.name === "dm") {
      const other = S().user(route.dmOtherId);
      if (!other) {
        el.innerHTML = "";
        el.classList.add("is-empty");
        return;
      }
      el.classList.remove("is-empty");
      el.innerHTML =
        '<div class="members__head"><span>Sobre</span></div>' +
        '<div class="members__scroll"><div class="about-card">' +
        u().avatarHTML(other, "xl", true) +
        "<h3>" + u().h(other.displayName) + "</h3>" +
        '<span class="about-card__user">@' + u().h(other.username) + "</span>" +
        '<span class="status-pill" data-status="' + other.status + '">' +
        u().h(NX.STATUS_LABEL[other.status] || "Offline") + "</span>" +
        (other.bio ? "<p>" + u().h(other.bio) + "</p>" : "") +
        '<div class="about-card__actions">' +
        '<button class="btn btn--soft btn--sm btn--block" data-action="open-profile" data-id="' + other.id + '">Ver perfil</button>' +
        "</div></div></div>";
      return;
    }

    if (route.name !== "server") {
      el.innerHTML = "";
      el.classList.add("is-empty");
      return;
    }

    const server = S().server(route.serverId);
    if (!server) {
      el.innerHTML = "";
      el.classList.add("is-empty");
      return;
    }
    el.classList.remove("is-empty");

    const members = S().visibleMembersOf(server.id);
    const others = members.filter((m) => m.user.id !== me.id);
    const online = others.filter((m) => m.user.status !== "offline");
    const offline = others.filter((m) => m.user.status === "offline");
    const isOwner = (uid) => server.ownerId === uid;

    const row = (m) => {
      const role = m.role;
      const mem = m.membership;
      const roleName = role && !role.isDefault ? role.name : "";
      const color = role && role.color ? role.color : "inherit";
      const dim = m.user.status === "offline" ? " is-offline" : "";
      return (
        '<button class="member' + (m.user.id === me.id ? " is-me" : "") + dim +
        '" data-action="member-card" data-id="' + m.user.id + '" data-server="' + server.id + '">' +
        u().avatarHTML(m.user, "sm", true) +
        '<span class="member__txt">' +
        '<strong class="truncate" style="--rc:' + color + '">' +
        u().h(mem && mem.nickname ? mem.nickname : m.user.displayName) + "</strong>" +
        '<small class="truncate">@' + u().h(m.user.username) +
        (roleName ? " · " + u().h((role.icon ? role.icon + " " : "") + roleName) : "") +
        "</small>" +
        "</span>" +
        (isOwner(m.user.id) ? '<span class="member__owner" title="Dono">' + NX.icon("crown", "", 14) + "</span>" : "") +
        "</button>"
      );
    };

    let html =
      '<div class="members__head"><span>Membros — ' + members.length + "</span>" +
      '<span class="members__online-dot">' + online.length + " online</span></div>";
    html += '<div class="members__scroll">';

    if (!others.length) {
      html += '<p class="members__empty">Não há outros membros neste servidor.</p></div>';
      el.innerHTML = html;
      return;
    }

    html += '<div class="members__group members__group--online">● Online — ' + online.length + "</div>";
    if (online.length) html += online.map(row).join("");
    else html += '<p class="members__empty">Ninguém online agora.</p>';

    html += '<div class="members__group members__group--offline">● Offline — ' + offline.length + "</div>";
    if (offline.length) html += offline.map(row).join("");
    else html += '<p class="members__empty">Todos estão online.</p>';

    html += "</div>";
    el.innerHTML = html;
  };

  /* ================= COMPOSER ================= */
  function composerContext() {
    const me = S().me();
    const route = NX.app.route;
    if (route.name === "server") {
      const ch = S().channel(route.channelId);
      if (!ch || ch.type !== "text") return null;
      const canSend = S().canSendIn(ch, me.id);
      return {
        key: "ch:" + ch.id + ":" + canSend,
        ref: ch.id,
        placeholder: canSend ? "Mensagem para #" + ch.name : "Você não pode enviar mensagens em #" + ch.name,
        canSend: canSend,
        serverId: ch.serverId,
      };
    }
    if (route.name === "dm") {
      const other = S().user(route.dmOtherId);
      if (!other) return null;
      return {
        key: "dm:" + route.dmId,
        ref: route.dmId,
        placeholder: "Mensagem para " + other.displayName,
        canSend: true,
        serverId: null,
      };
    }
    return null;
  }

  views.composer = function () {
    const root = document.getElementById("composer");
    const ctx = composerContext();

    if (!ctx) {
      root.hidden = true;
      root.dataset.key = "";
      root.innerHTML = "";
      return;
    }

    root.hidden = false;

    if (root.dataset.key !== ctx.key) {
      root.dataset.key = ctx.key;
      root.innerHTML =
        '<div class="composer__pending" data-pending hidden></div>' +
        '<div class="composer__inner">' +
        (ctx.canSend
          ? '<button class="icon-btn composer__plus" data-action="composer-attach" title="Anexar" aria-label="Anexar">' +
            NX.icon("plus", "", 20) +
            "</button>"
          : '<span class="composer__locked">' + NX.icon("lock", "", 18) + "</span>") +
        '<div class="composer__field">' +
        '<textarea class="composer__input" rows="1" data-composer-input placeholder="' +
        u().h(ctx.placeholder) +
        '"' +
        (ctx.canSend ? "" : " disabled") +
        '></textarea>' +
        (ctx.canSend
          ? '<button class="icon-btn composer__gif" data-action="composer-gif" title="GIF" aria-label="Enviar GIF">GIF</button>' +
            '<button class="icon-btn composer__emoji" data-action="composer-emoji" title="Emojis" aria-label="Escolher emoji">' +
            NX.icon("smile", "", 19) +
            "</button>"
          : "") +
        "</div>" +
        '<button class="composer__send" data-action="send-message" title="Enviar" aria-label="Enviar"' +
        (ctx.canSend ? "" : " disabled") +
        ">" +
        NX.icon("send", "", 19) +
        "</button>" +
        "</div>" +
        (ctx.canSend
          ? '<div class="composer__hint">Enter envia · Shift + Enter quebra linha</div>'
          : "");
      wireComposer(root);
      views.renderPending();
    }
  };

  /* faixa de anexos aguardando envio */
  views.renderPending = function () {
    const root = document.getElementById("composer");
    const box = root && root.querySelector("[data-pending]");
    if (!box) return;
    const items = NX.chat && NX.chat.pending ? NX.chat.pending : [];
    if (!items.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML =
      (NX.chat.renderPendingStrip ? NX.chat.renderPendingStrip() : "") +
      '<button class="composer__pending-clear" data-action="composer-clear-pending">Limpar anexos</button>';
  };

  function wireComposer(root) {
    if (root.dataset.wired === "1") return;
    root.dataset.wired = "1";

    const input = () => root.querySelector("[data-composer-input]");

    const grow = () => {
      const ta = input();
      if (!ta) return;
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 190) + "px";
      const send = root.querySelector(".composer__send");
      if (send) send.classList.toggle("is-ready", ta.value.trim().length > 0);
    };

    const send = () => {
      const ta = input();
      if (!ta) return;
      const text = ta.value;
      const attachments = NX.chat && NX.chat.takePending ? NX.chat.takePending() : [];
      if (!text.trim() && !attachments.length) {
        if (attachments.length) views.renderPending();
        return;
      }
      const ctx = composerContext();
      if (!ctx || !ctx.canSend) return;
      ta.value = "";
      grow();
      views.renderPending();
      NX.api
        .sendMessage(ctx.ref, text, { attachments: attachments })
        .then(() => {
          const main = document.getElementById("main-content");
          main.dataset.atbottom = "true";
          views.scrollToBottom(main);
        })
        .catch((e) => {
          if (e && e.message) NX.ui.error(e.message);
          ta.value = text;
          grow();
        });
    };

    root.addEventListener("input", (e) => {
      if (e.target.matches("[data-composer-input]")) grow();
    });

    root.addEventListener("keydown", (e) => {
      if (!e.target.matches("[data-composer-input]")) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
      if (e.key === "Escape") {
        e.target.value = "";
        grow();
      }
    });

    root.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="send-message"]')) send();
    });
  }

  /* ================= orchestration ================= */
  views.render = function (scopes) {
    const main = document.getElementById("main-content");
    const list = main.querySelector("[data-chat-list]");
    if (list) {
      const dist = main.scrollHeight - main.scrollTop - main.clientHeight;
      main.dataset.atbottom = dist < 140 ? "true" : "false";
    }
    views.rail();
    views.sidebar();
    views.header();
    views.content(scopes);
    views.members();
    views.composer();
  };

  NX.views = views;
})(window.NX);
