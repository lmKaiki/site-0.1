/* ============================================================
   NEXO · people
   Perfil do usuário, apresentação de membros e controles de DM.

   Camada de apresentação: lê NX.selectors, escreve HTML e delega
   todas as mutações para NX.api (que validam permissões).
   Nada aqui persiste estado próprio.

   Contrato público:
     NX.people.profilePage(userId)                  -> HTML
     NX.people.profilePageAfter(container, userId)  -> liga eventos
     NX.people.memberCard(anchor, serverId, userId) -> popout
     NX.people.dmHeaderControls(dmId, userId)       -> HTML
     NX.people.editProfileModal()                   -> modal

   Ações registradas em NX.actions com prefixo "pp-".
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const u = () => NX.util;
  const S = () => NX.selectors;
  const api = () => NX.api;
  const ui = () => NX.ui;

  const people = {};
  const PP = {}; /* ações pp-* */

  /* ---------------- utilitários locais ---------------- */
  const h = (s) => u().h(s);
  const db = () => NX.store.db;

  function go(hash) {
    if (NX.app && typeof NX.app.go === "function") NX.app.go(hash);
    else if (location.hash !== hash) location.hash = hash;
  }

  function emitChange(detail) {
    try {
      document.dispatchEvent(new CustomEvent("nx:people:change", { detail: detail || {} }));
    } catch (e) {
      /* CustomEvent indisponível em navegadores muito antigos */
    }
  }

  function dateLabel(ts) {
    try {
      return new Date(ts).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
    } catch (e) {
      return "";
    }
  }

  function copyId(id) {
    return u().copy(id).then((ok) => {
      ui().toast(
        ok ? "ID copiado para a área de transferência." : "Não foi possível copiar o ID.",
        ok ? "success" : "error"
      );
      return ok;
    });
  }

  /* ---------------- avatar (considera imagem enviada) ---------------- */
  function avatarHTML(user, size, showStatus) {
    if (!user) return "";
    const cls = ["avatar", "avatar--" + (size || "md")];
    if (showStatus) cls.push("avatar--status");
    const av = user.avatar || {};
    const color = av.color || u().colorFor(user.id);
    const glyph = av.emoji ? av.emoji : u().initials(user.displayName || user.username);
    return (
      '<span class="' + cls.join(" ") + '" style="--av:' + h(color) + '" aria-hidden="true">' +
      (av.image
        ? '<img class="avatar__img" src="' + h(av.image) + '" alt="" />'
        : '<span class="avatar__glyph">' + h(glyph) + "</span>") +
      (showStatus ? '<i class="avatar__dot" data-status="' + h(user.status || "offline") + '"></i>' : "") +
      "</span>"
    );
  }

  /* ---------------- status ---------------- */
  function statusOf(user) {
    return user && user.status ? user.status : "offline";
  }

  function statusLabel(user) {
    return NX.STATUS_LABEL[statusOf(user)] || "Offline";
  }

  function customStatusText(user) {
    if (!user) return "";
    const bits = [];
    if (user.statusEmoji) bits.push(user.statusEmoji);
    const text = user.customStatus || user.statusText || "";
    if (text) bits.push(text);
    return bits.join(" ");
  }

  function statusPill(user) {
    return '<span class="status-pill" data-status="' + h(statusOf(user)) + '">' + h(statusLabel(user)) + "</span>";
  }

  /* ---------------- cargos ---------------- */
  function roleOf(serverId, userId) {
    const m = S().membership(serverId, userId);
    return m ? S().role(m.roleId) : null;
  }

  function roleChip(role) {
    if (!role) return "";
    return (
      '<span class="pp-role" style="--rc:' + h(role.color || "#93a8a4") + '">' +
      (role.icon ? '<i class="pp-role__ico">' + h(role.icon) + "</i>" : "") +
      h(role.name) +
      "</span>"
    );
  }

  function ownerChip() {
    return '<span class="pp-role pp-role--owner">' + NX.icon("crown", "", 13) + " Dono</span>";
  }

  /* ---------------- conversa / bloqueio ---------------- */
  function startDM(userId) {
    if (!userId) return;
    api()
      .openDM(userId)
      .then((dm) => {
        ui().closePopout();
        go("#/mensagens/" + dm.id);
      })
      .catch((e) => ui().error(e.message || "Não foi possível abrir a conversa."));
  }

  function blockUser(user) {
    if (!user) return;
    ui()
      .confirm({
        title: "Bloquear @" + user.username,
        message:
          "Deseja bloquear " + user.displayName + "? Este usuário não poderá enviar mensagens privadas para você.",
        note: "Vocês não poderão trocar mensagens privadas até você desbloquear. Você pode desbloquear quando quiser.",
        confirmLabel: "Bloquear",
        danger: true,
        icon: "lock",
      })
      .then((ok) => {
        if (!ok) return;
        return api()
          .blockUser(user.id)
          .then(() => {
            ui().closePopout();
            ui().toast(user.displayName + " foi bloqueado.", "success");
            emitChange({ userId: user.id, blocked: true });
          });
      })
      .catch((e) => ui().error(e.message || "Não foi possível bloquear."));
  }

  function unblockUser(user) {
    if (!user) return;
    api()
      .unblockUser(user.id)
      .then(() => {
        ui().closePopout();
        ui().toast(user.displayName + " foi desbloqueado.", "success");
        emitChange({ userId: user.id, blocked: false });
      })
      .catch((e) => ui().error(e.message || "Não foi possível desbloquear."));
  }

  /* ---------------- denúncia ---------------- */
  const REPORT_REASONS = [
    "Spam ou mensagens repetidas",
    "Assédio ou discurso de ódio",
    "Conteúdo sexual ou impróprio",
    "Golpe, link suspeito ou roubo de conta",
    "Fingir ser outra pessoa",
    "Quebra das regras do servidor",
    "Outro",
  ];

  function reportModal(user) {
    if (!user) return null;
    const footer = u().el(
      '<div class="modal__actions">' +
        '<button class="btn btn--ghost" type="button" data-modal-close>Cancelar</button>' +
        '<button class="btn btn--danger" type="button" data-report-send data-busy-label="Enviando">Enviar denúncia</button>' +
        "</div>"
    );
    const m = ui().modal({ title: "Denunciar @" + user.username, eyebrow: "Segurança", size: "sm", footer: footer });

    m.body.innerHTML =
      '<p class="modal__lead">Conte o que aconteceu com ' +
      h(user.displayName) +
      ". A denúncia é anônima — a pessoa não fica sabendo que você a enviou.</p>" +
      '<div class="field"><span class="field__label">Motivo</span>' +
      '<select class="select" data-report-reason data-autofocus>' +
      REPORT_REASONS.map((r) => '<option value="' + h(r) + '">' + h(r) + "</option>").join("") +
      "</select></div>" +
      '<label class="field"><span class="field__label">Detalhes <em>(opcional)</em></span>' +
      '<textarea class="input input--area" data-report-detail rows="3" maxlength="300" placeholder="O que aconteceu? Ex.: mensagens ofensivas no canal #geral."></textarea></label>' +
      '<div class="form-error" data-error hidden></div>';

    const box = m.body.querySelector("[data-error]");
    const showErr = (msg) => {
      if (!box) return;
      box.hidden = !msg;
      box.innerHTML = msg ? NX.icon("alert", "", 16) + "<span>" + h(msg) + "</span>" : "";
    };

    footer.querySelector("[data-report-send]").addEventListener("click", (ev) => {
      const btn = ev.currentTarget;
      showErr("");
      const reasonSel = m.body.querySelector("[data-report-reason]");
      const detail = (m.body.querySelector("[data-report-detail]").value || "").trim();
      const reason = (reasonSel.value || "Outro") + (detail ? " — " + detail : "");
      const done = ui().busy(btn);
      api()
        .reportUser(user.id, reason)
        .then(() => {
          done();
          m.close();
          ui().toast("Denúncia enviada. Obrigado por cuidar da comunidade.", "success");
          emitChange({ userId: user.id, reported: true });
        })
        .catch((e) => {
          done();
          showErr(e.message || "Não foi possível enviar a denúncia.");
          ui().error(e.message || "Não foi possível enviar a denúncia.");
        });
    });

    return m;
  }

  /* modal de confirmação com campo de motivo */
  function reasonModal(opts) {
    return new Promise((resolve) => {
      let done = false;
      const footer = u().el(
        '<div class="modal__actions">' +
          '<button class="btn btn--ghost" type="button" data-modal-close>Cancelar</button>' +
          '<button class="btn ' +
          (opts.danger ? "btn--danger" : "btn--primary") +
          '" type="button" data-reason-ok>' +
          h(opts.confirmLabel || "Confirmar") +
          "</button>" +
          "</div>"
      );
      const m = ui().modal({
        title: opts.title || "Tem certeza?",
        size: "sm",
        footer: footer,
        onClose: () => {
          if (!done) resolve(null);
        },
      });

      m.body.innerHTML =
        '<div class="confirm__icon' + (opts.danger ? " is-danger" : "") + '">' +
        NX.icon(opts.icon || "alert", "", 24) +
        "</div>" +
        '<p class="confirm__text">' + h(opts.message || "") + "</p>" +
        '<label class="field"><span class="field__label">Motivo <em>(opcional)</em></span>' +
        '<input class="input" data-reason-input maxlength="160" placeholder="' +
        h(opts.placeholder || "Sem motivo informado") +
        '" data-autofocus /></label>' +
        '<div class="form-error" data-error hidden></div>';

      footer.querySelector("[data-reason-ok]").addEventListener("click", () => {
        const input = m.body.querySelector("[data-reason-input]");
        done = true;
        m.close();
        resolve((input && input.value.trim()) || "");
      });
      const cancel = footer.querySelector(".btn--ghost");
      if (cancel)
        cancel.addEventListener("click", () => {
          done = true;
          resolve(null);
        });
    });
  }

  /* =========================================================
     TELA DE PERFIL
     ========================================================= */
  function bannerHTML(user) {
    if (user.banner) {
      return (
        '<div class="pp-banner"><img class="pp-banner__img" src="' +
        h(user.banner) +
        '" alt="" /></div>'
      );
    }
    return (
      '<div class="pp-banner pp-banner--grad">' +
      '<span class="pp-banner__glow pp-banner__glow--a"></span>' +
      '<span class="pp-banner__glow pp-banner__glow--b"></span>' +
      "</div>"
    );
  }

  function badgeList(user, servers) {
    const out = [];
    const seen = {};
    if (servers.some((s) => s.ownerId === user.id)) out.push(ownerChip());
    servers.forEach((s) => {
      const r = roleOf(s.id, user.id);
      if (r && !r.isDefault && !seen[r.id]) {
        seen[r.id] = 1;
        out.push(
          '<span class="pp-badge" style="--rc:' + h(r.color || "#93a8a4") + '">' +
            (r.icon ? "<i>" + h(r.icon) + "</i>" : "") +
            h(r.name) +
            "</span>"
        );
      }
    });
    return out.slice(0, 5).join("");
  }

  /* ---- botão de amizade (estado lido do store, nunca chutado) ---- */
  function friendBtnHTML(user, isMe) {
    if (isMe || !user) return "";
    const me = S().me();
    if (!me) return "";
    const st = S().friendState(me.id, user.id);
    const id = h(user.id);
    if (st === "self") return "";
    if (st === "friends") {
      return (
        '<button class="btn btn--soft" data-action="pp-remove-friend" data-id="' + id +
        '" title="Remover dos amigos">' + NX.icon("check", "", 16) +
        "<span>Amigos</span></button>"
      );
    }
    if (st === "sent") {
      return (
        '<button class="btn btn--soft" data-action="pp-cancel-friend" data-id="' + id +
        '" title="Cancelar solicitação de amizade">' + NX.icon("clock", "", 16) +
        "<span>Solicitação enviada</span></button>"
      );
    }
    if (st === "received") {
      return (
        '<button class="btn btn--primary" data-action="pp-accept-friend" data-id="' + id + '">' +
        NX.icon("userPlus", "", 16) +
        "<span>Aceitar solicitação</span></button>"
      );
    }
    return (
      '<button class="btn btn--soft" data-action="pp-add-friend" data-id="' + id + '">' +
      NX.icon("userPlus", "", 16) +
      "<span>Adicionar amigo</span></button>"
    );
  }

  /* ---- botão de seguir (mesmas ações do feed: sx-follow / sx-unfollow) ---- */
  function followBtnHTML(user, isMe) {
    if (isMe || !user) return "";
    const me = S().me();
    if (!me) return "";
    let st = { can: true, state: null };
    try {
      st = api().followStatus(user.id) || st;
    } catch (e) {
      st = { can: true, state: null };
    }
    const id = h(user.id);
    if (st.state === "self") return "";
    if (st.state === "following") {
      return (
        '<button class="btn btn--soft" data-action="sx-unfollow" data-id="' + id +
        '" title="Deixar de seguir">' + NX.icon("check", "", 16) +
        "<span>Seguindo</span></button>"
      );
    }
    if (st.state === "pending") {
      return (
        '<button class="btn btn--soft" data-action="sx-unfollow" data-id="' + id +
        '" title="Cancelar solicitação de seguimento">' + NX.icon("clock", "", 16) +
        "<span>Solicitado</span></button>"
      );
    }
    return (
      '<button class="btn btn--soft" data-action="sx-follow" data-id="' + id + '">' +
      NX.icon("userPlus", "", 16) +
      "<span>" + (st.state === "request" ? "Solicitar" : "Seguir") + "</span></button>"
    );
  }

  /* ---- estatísticas públicas do perfil (❤️ e 👥) ----
     Nada aqui é número fixo: tudo vem das coleções follows/likes. */
  function statsRowHTML(user) {
    const me = S().me();
    const viewerId = me ? me.id : null;
    const canF = S().canViewFollowersOf(viewerId, user.id);
    const canL = S().canViewLikesOf(viewerId, user.id);

    const chip = (o) =>
      '<button type="button" class="pp-stat' + (o.visible ? "" : " is-locked") +
      '" data-action="' + o.action + '" data-id="' + h(user.id) +
      '" title="' + h(o.title) + '">' +
      '<span class="pp-stat__ico">' + (o.visible ? o.ico : NX.icon("lock", "", 15)) + "</span>" +
      '<span class="pp-stat__txt"><strong>' +
      (o.visible ? o.value : "Privado") +
      "</strong><span>" + o.label + "</span></span></button>";

    return (
      '<div class="pp-stats">' +
      chip({
        visible: canF,
        action: "pp-followers",
        ico: "👥",
        value: u().num(S().followerCount(user.id)),
        label: "Seguidores",
        title: canF ? "Ver a lista de seguidores" : "A lista de seguidores está privada",
      }) +
      chip({
        visible: canL,
        action: "pp-likes",
        ico: "❤️",
        value: u().num(S().likesReceivedOf(user.id)),
        label: "Curtidas",
        title: canL ? "Ver as publicações curtidas" : "As curtidas estão privadas",
      }) +
      "</div>"
    );
  }

  people.profilePage = function (userId) {
    const me = S().me();
    const user = (userId ? S().user(userId) : null) || me;

    if (!user) {
      return (
        '<div class="pp-page pp-page--empty"><div class="pp-empty">' +
        NX.icon("user", "", 30) +
        "<h2>Perfil não encontrado</h2>" +
        "<p>Esta conta não existe mais ou você não tem permissão para vê-la.</p>" +
        '<div class="pp-empty__actions">' +
        '<button class="btn btn--soft" data-action="nav-home">Voltar ao início</button>' +
        "</div></div></div>"
      );
    }

    const isMe = !!me && me.id === user.id;
    const pc = user.profileColor || (user.avatar && user.avatar.color) || u().colorFor(user.id);
    const servers = isMe ? S().serversOf(user.id) : me ? S().sharedServers(me.id, user.id) : [];
    const iBlocked = !!me && !isMe && S().isBlocked(me.id, user.id);
    const theyBlocked = !!me && !isMe && S().isBlocked(user.id, me.id);
    const cs = customStatusText(user);
    const badges = badgeList(user, servers);

    /* ---- ações ---- */
    const hideSocial = iBlocked || theyBlocked;
    const actions = isMe
      ? '<button class="btn btn--primary" data-action="pp-edit-profile">' +
        NX.icon("pencil", "", 16) +
        "<span>Editar perfil</span></button>" +
        '<button class="btn btn--soft" data-action="open-settings">' +
        NX.icon("settings", "", 16) +
        "<span>Configurações</span></button>"
      : (hideSocial ? "" : friendBtnHTML(user, isMe) + followBtnHTML(user, isMe)) +
        '<button class="btn btn--primary" data-action="pp-message" data-id="' +
        h(user.id) +
        '">' +
        NX.icon("chat", "", 16) +
        "<span>Mensagem</span></button>" +
        '<button class="btn btn--soft pp-actions__more" data-action="pp-profile-menu" data-id="' +
        h(user.id) +
        '" aria-label="Mais opções" title="Mais opções">' +
        NX.icon("more", "", 18) +
        "</button>";

    /* ---- avisos de bloqueio ---- */
    let notice = "";
    if (iBlocked) {
      notice =
        '<div class="pp-notice">' +
        NX.icon("lock", "", 18) +
        '<div class="pp-notice__txt"><strong>Você bloqueou este usuário.</strong>' +
        "<span>Este usuário não poderá enviar mensagens privadas para você.</span></div>" +
        '<button class="btn btn--soft btn--sm" data-action="pp-unblock" data-id="' +
        h(user.id) +
        '">Desbloquear</button></div>';
    } else if (theyBlocked) {
      notice =
        '<div class="pp-notice pp-notice--muted">' +
        NX.icon("info", "", 18) +
        '<div class="pp-notice__txt"><strong>Este usuário bloqueou você.</strong>' +
        "<span>Vocês não podem trocar mensagens privadas por enquanto.</span></div></div>";
    }

    /* ---- lista de servidores ---- */
    const rows = servers
      .map((s) => {
        const r = roleOf(s.id, user.id);
        return (
          '<button class="pp-srv" data-action="open-server" data-id="' +
          h(s.id) +
          '">' +
          u().serverIconHTML(s, "xs", false) +
          '<span class="pp-srv__txt"><strong>' +
          h(s.name) +
          "</strong><small>" +
          h(r ? r.name : "Membro") +
          (s.ownerId === user.id ? " · Dono" : "") +
          "</small></span>" +
          NX.icon("chevronRight", "", 15) +
          "</button>"
        );
      })
      .join("");

    const emptyServers = isMe
      ? "Você ainda não participa de nenhum servidor. Crie um ou entre por convite."
      : "Nenhum servidor em comum. Entrem no mesmo servidor para ver a lista aqui.";

    return (
      '<div class="pp-page" data-pp-user="' +
      h(user.id) +
      '" style="--pc:' +
      h(pc) +
      '">' +
      '<section class="pp-card">' +
      bannerHTML(user) +
      '<div class="pp-card__head">' +
      '<div class="pp-avatar">' +
      avatarHTML(user, "xl", true) +
      "</div>" +
      '<div class="pp-head">' +
      '<div class="pp-name"><h1>' +
      h(user.displayName) +
      "</h1>" +
      (badges ? '<div class="pp-badges">' + badges + "</div>" : "") +
      "</div>" +
      '<div class="pp-handle"><span class="pp-handle__at">@' +
      h(user.username) +
      "</span>" +
      '<button class="pp-copy" data-action="pp-copy-id" data-id="' +
      h(user.id) +
      '" title="Copiar ID do usuário">' +
      NX.icon("copy", "", 13) +
      "<span>Copiar ID</span></button></div>" +
      '<div class="pp-statusline">' +
      statusPill(user) +
      (cs ? '<span class="pp-custom">' + h(cs) + "</span>" : "") +
      "</div>" +
      "</div>" +
      '<div class="pp-actions">' +
      actions +
      "</div>" +
      "</div>" +
      notice +
      statsRowHTML(user) +
      '<div class="pp-card__grid">' +
      '<section class="pp-block">' +
      '<h4 class="pp-block__h">' +
      NX.icon("user", "", 15) +
      "<span>Sobre</span></h4>" +
      '<p class="pp-bio">' +
      h(
        user.bio ||
          (isMe
            ? "Você ainda não escreveu uma bio. Edite seu perfil para contar quem é você."
            : "Este usuário ainda não escreveu uma bio.")
      ) +
      "</p>" +
      '<div class="pp-meta">' +
      '<span class="pp-meta__item">' +
      NX.icon("calendar", "", 15) +
      "<span><small>Membro desde</small>" +
      h(dateLabel(user.createdAt)) +
      "</span></span>" +
      '<span class="pp-meta__item">' +
      NX.icon("info", "", 15) +
      "<span><small>ID do usuário</small><code class=\"pp-uid\">" +
      h(user.id) +
      "</code></span>" +
      '<button class="icon-btn icon-btn--xs" data-action="pp-copy-id" data-id="' +
      h(user.id) +
      '" title="Copiar ID" aria-label="Copiar ID do usuário">' +
      NX.icon("copy", "", 14) +
      "</button>" +
      "</span>" +
      "</div>" +
      "</section>" +
      '<section class="pp-block">' +
      '<h4 class="pp-block__h">' +
      NX.icon("grid", "", 15) +
      "<span>" +
      (isMe ? "Seus servidores" : "Servidores em comum") +
      (servers.length ? " · " + servers.length : "") +
      "</span></h4>" +
      (rows
        ? '<div class="pp-srv-list">' + rows + "</div>"
        : '<p class="pp-bio pp-bio--dim">' + h(emptyServers) + "</p>") +
      "</section>" +
      "</div>" +
      "</section>" +
      "</div>"
    );
  };

  /* liga eventos + atualização automática quando os dados mudam */
  people.profilePageAfter = function (container, userId) {
    if (!container) return container;
    bindActions(container);

    const readTarget = () => {
      const root = container.classList && container.classList.contains("pp-page")
        ? container
        : container.querySelector(".pp-page");
      const el = root || container.querySelector("[data-pp-user]");
      return (el && el.getAttribute("data-pp-user")) || userId || "";
    };

    const repaint = u().debounce(function () {
      if (!container.isConnected) return;
      const target = readTarget();
      if (!target || !S().user(target)) return;
      const root = container.classList && container.classList.contains("pp-page")
        ? container
        : container.querySelector(".pp-page");
      if (!root) return; /* o hospedeiro substituiu o conteúdo */
      const tmp = document.createElement("div");
      tmp.innerHTML = people.profilePage(target);
      const next = tmp.firstElementChild;
      if (!next) return;
      root.className = next.className;
      root.setAttribute("style", next.getAttribute("style") || "");
      root.innerHTML = next.innerHTML;
    }, 90);

    if (container.__ppOff) container.__ppOff();
    container.__ppOff = NX.bus.on("db:change", (payload) => {
      if (!container.isConnected) {
        if (container.__ppOff) {
          container.__ppOff();
          container.__ppOff = null;
        }
        return;
      }
      const scopes = (payload && payload.scopes) || [];
      const relevant = ["all", "profile", "members", "servers", "roles", "presence", "session"];
      for (let i = 0; i < scopes.length; i++) {
        if (relevant.indexOf(scopes[i]) !== -1) {
          repaint();
          return;
        }
      }
    });

    return container;
  };

  /* =========================================================
     CARTÃO DO MEMBRO (popout)
     ========================================================= */
  people.memberCard = function (anchor, serverId, userId) {
    const server = S().server(serverId);
    const user = S().user(userId);
    const me = S().me();
    if (!anchor || !server || !user || !me) return null;

    const membership = S().membership(serverId, userId);
    const role = membership ? S().role(membership.roleId) : null;
    const isOwner = server.ownerId === userId;
    const isMe = me.id === userId;
    const nick = membership && membership.nickname ? membership.nickname : "";
    const pc = user.profileColor || (user.avatar && user.avatar.color) || u().colorFor(user.id);
    const cs = customStatusText(user);

    const html =
      '<div class="pp-mcard" style="--pc:' +
      h(pc) +
      '">' +
      '<div class="pp-mcard__banner"></div>' +
      '<div class="pp-mcard__body">' +
      '<div class="pp-mcard__avatar">' +
      avatarHTML(user, "lg", true) +
      "</div>" +
      '<h3 class="pp-mcard__name"' +
      (role ? ' style="--rc:' + h(role.color) + '"' : "") +
      ">" +
      h(user.displayName) +
      "</h3>" +
      '<span class="pp-mcard__user">@' +
      h(user.username) +
      "</span>" +
      (nick
        ? '<span class="pp-mcard__nick">' + NX.icon("pencil", "", 13) + "Apelido: <strong>" + h(nick) + "</strong></span>"
        : "") +
      '<div class="pp-mcard__status">' +
      statusPill(user) +
      (cs ? '<span class="pp-custom pp-custom--sm">' + h(cs) + "</span>" : "") +
      "</div>" +
      '<div class="pp-mcard__roles">' +
      (isOwner ? ownerChip() : "") +
      (role ? roleChip(role) : "") +
      "</div>" +
      '<p class="pp-mcard__bio' +
      (user.bio ? "" : " pp-mcard__bio--empty") +
      '">' +
      h(user.bio || "Este membro ainda não escreveu uma bio.") +
      "</p>" +
      '<div class="pp-mcard__meta">Membro desde ' +
      h(dateLabel(membership ? membership.joinedAt : user.createdAt)) +
      "</div>" +
      '<div class="pp-mcard__actions">' +
      '<button class="btn btn--soft btn--sm" data-action="pp-view-profile" data-id="' +
      h(userId) +
      '">' +
      NX.icon("user", "", 15) +
      "<span>Ver perfil</span></button>" +
      (isMe
        ? ""
        : '<button class="btn btn--soft btn--sm" data-action="pp-message" data-id="' +
          h(userId) +
          '">' +
          NX.icon("chat", "", 15) +
          "<span>Mensagem</span></button>") +
      '<button class="btn btn--ghost btn--sm pp-mcard__more" data-action="pp-member-menu" data-server="' +
      h(serverId) +
      '" data-user="' +
      h(userId) +
      '" aria-label="Mais opções">' +
      NX.icon("more", "", 17) +
      "</button>" +
      "</div>" +
      "</div></div>";

    return ui().popout(anchor, html, { cls: "popout--pp-member", align: "start", gap: 10 });
  };

  /* ---- modal de cargos ---- */
  function roleModal(serverId, userId) {
    const user = S().user(userId);
    const membership = S().membership(serverId, userId);
    if (!user || !membership) return null;
    const roles = S().rolesOf(serverId);

    const m = ui().modal({ title: "Cargos de @" + user.username, eyebrow: "Membros", size: "sm" });
    m.body.innerHTML =
      '<p class="modal__lead">Escolha o cargo de ' +
      h(user.displayName) +
      " neste servidor. Só é possível ter um cargo por membro.</p>" +
      '<div class="pp-role-list" role="listbox" aria-label="Cargos disponíveis">' +
      roles
        .map((r) => {
          const on = membership.roleId === r.id;
          return (
            '<button type="button" class="pp-role-row' +
            (on ? " is-on" : "") +
            '" data-role-id="' +
            h(r.id) +
            '" role="option" aria-selected="' +
            on +
            '">' +
            '<i class="pp-role-row__dot" style="--rc:' +
            h(r.color || "#93a8a4") +
            '"></i>' +
            '<span class="pp-role-row__txt"><strong>' +
            (r.icon ? h(r.icon) + " " : "") +
            h(r.name) +
            "</strong><small>" +
            h(r.description || (r.isDefault ? "Cargo padrão do servidor" : "Sem descrição")) +
            "</small></span>" +
            (on ? '<span class="pp-role-row__check">' + NX.icon("check", "", 16) + "</span>" : "") +
            "</button>"
          );
        })
        .join("") +
      "</div>" +
      '<div class="form-error" data-error hidden></div>';

    const box = m.body.querySelector("[data-error]");
    m.body.addEventListener("click", (e) => {
      const row = e.target.closest("[data-role-id]");
      if (!row) return;
      const roleId = row.getAttribute("data-role-id");
      if (roleId === membership.roleId) return;
      const label = row.querySelector("strong");
      if (box) {
        box.hidden = true;
        box.innerHTML = "";
      }
      row.classList.add("is-busy");
      api()
        .setMemberRole(serverId, userId, roleId)
        .then(() => {
          m.close();
          ui().toast(
            "Cargo de " + user.displayName + " agora é " + (label ? label.textContent : "novo cargo") + ".",
            "success"
          );
          emitChange({ userId: userId, serverId: serverId });
        })
        .catch((err) => {
          row.classList.remove("is-busy");
          if (box) {
            box.hidden = false;
            box.innerHTML = NX.icon("alert", "", 16) + "<span>" + h(err.message || "Não foi possível alterar.") + "</span>";
          }
          ui().error(err.message || "Não foi possível alterar o cargo.");
        });
    });
    return m;
  }

  /* ---- expulsar / banir ---- */
  function kickFlow(serverId, user) {
    reasonModal({
      title: "Expulsar " + user.displayName,
      message:
        "Você deseja expulsar @" + user.username + " deste servidor? Ele perderá o acesso na hora e precisará de um novo convite para voltar.",
      confirmLabel: "Expulsar",
      danger: true,
      icon: "logout",
      placeholder: "Motivo (opcional)",
    }).then((reason) => {
      if (reason === null) return;
      api()
        .kickMember(serverId, user.id, reason)
        .then(() => {
          ui().closePopout();
          ui().toast(user.displayName + " foi expulso do servidor.", "success");
          emitChange({ userId: user.id, serverId: serverId, kicked: true });
        })
        .catch((e) => ui().error(e.message || "Não foi possível expulsar."));
    });
  }

  function banFlow(serverId, user) {
    reasonModal({
      title: "Banir @" + user.username,
      message: "Você deseja banir @" + user.username + " deste servidor?",
      confirmLabel: "Banir",
      danger: true,
      icon: "lock",
      placeholder: "Motivo (opcional)",
    }).then((reason) => {
      if (reason === null) return;
      api()
        .banMember(serverId, user.id, reason)
        .then(() => {
          ui().closePopout();
          ui().toast(user.displayName + " foi banido do servidor.", "success");
          emitChange({ userId: user.id, serverId: serverId, banned: true });
        })
        .catch((e) => ui().error(e.message || "Não foi possível banir."));
    });
  }

  /* =========================================================
     CONTROLES DO CABEÇALHO DE DM
     ========================================================= */
  people.dmHeaderControls = function (dmId, userId) {
    const me = S().me();
    const user = S().user(userId);
    if (!me || !user) return "";
    const dm = (db().dms || {})[dmId] || null;
    const iBlocked = S().isBlocked(me.id, userId);

    if (iBlocked) {
      return (
        '<div class="pp-dmctl pp-dmctl--blocked" data-pp-dm="' +
        h(dmId) +
        '">' +
        '<span class="pp-dmctl__note">' +
        NX.icon("lock", "", 15) +
        "<span>Você bloqueou este usuário</span></span>" +
        '<button class="btn btn--soft btn--sm" data-action="pp-unblock" data-id="' +
        h(user.id) +
        '">Desbloquear</button>' +
        "</div>"
      );
    }

    const theyBlocked = S().isBlocked(user.id, me.id);
    return (
      '<div class="pp-dmctl" data-pp-dm="' +
      h(dmId) +
      '" data-pp-user="' +
      h(user.id) +
      '">' +
      (theyBlocked
        ? '<span class="pp-dmctl__flag">' + NX.icon("info", "", 14) + "<span>Este usuário bloqueou você</span></span>"
        : "") +
      (dm && dm.muted
        ? '<span class="pp-dmctl__flag">' + NX.icon("bell", "", 14) + "<span>Notificações silenciadas</span></span>"
        : "") +
      '<button class="icon-btn" data-action="pp-dm-menu" data-dm="' +
      h(dmId) +
      '" data-user="' +
      h(user.id) +
      '" title="Opções da conversa" aria-label="Opções da conversa">' +
      NX.icon("more", "", 18) +
      "</button>" +
      "</div>"
    );
  };

  /* =========================================================
     MODAL · EDITAR PERFIL
     ========================================================= */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Não foi possível ler esta imagem."));
      img.src = src;
    });
  }

  /* recorte simples: cover + translate(%) + scale, igual ao preview */
  function cropImage(src, crop, outW, outH, maxLen) {
    return loadImage(src).then((img) => {
      const c = document.createElement("canvas");
      c.width = outW;
      c.height = outH;
      const ctx = c.getContext && c.getContext("2d");
      if (!ctx) throw new Error("Este navegador não suporta o ajuste de imagens.");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const base = Math.max(outW / img.naturalWidth, outH / img.naturalHeight);
      const scale = base * (crop.zoom || 1);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      const dx = (outW - dw) / 2 + ((crop.x || 0) / 100) * outW;
      const dy = (outH - dh) / 2 + ((crop.y || 0) / 100) * outH;
      ctx.fillStyle = "#0d1416";
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(img, dx, dy, dw, dh);
      let url = c.toDataURL("image/jpeg", 0.86);
      if (url.length > maxLen) url = c.toDataURL("image/jpeg", 0.72);
      if (url.length > maxLen) url = c.toDataURL("image/jpeg", 0.6);
      if (url.length > maxLen) throw new Error("A imagem continua grande demais. Tente outra foto.");
      return url;
    });
  }

  function themeValue(theme) {
    if (theme === "light" || theme === "dark") return theme;
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    } catch (e) {
      return "dark";
    }
  }

  people.editProfileModal = function () {
    const me = S().me();
    if (!me) {
      ui().error("Entre na sua conta para editar o perfil.");
      return null;
    }

    const st = {
      displayName: me.displayName || "",
      username: me.username || "",
      bio: me.bio || "",
      status: statusOf(me),
      statusEmoji: me.statusEmoji || "",
      customStatus: me.customStatus || "",
      profileColor: me.profileColor || (me.avatar && me.avatar.color) || u().colorFor(me.id),
      theme: me.theme === "light" ? "light" : me.theme === "dark" ? "dark" : "",
      avatarEmoji: (me.avatar && me.avatar.emoji) || u().emojiFor(me.username),
      avatarColor: (me.avatar && me.avatar.color) || u().colorFor(me.id),
      avatarImage: (me.avatar && me.avatar.image) || null,
      avatarSrc: null,
      avatarCrop: { x: 0, y: 0, zoom: 1 },
      banner: me.banner || null,
      bannerSrc: null,
      bannerCrop: { x: 0, y: 0, zoom: 1 },
      bannerTouched: false,
      tab: "foto",
    };

    const SUGGESTIONS = [
      { emoji: "🟢", text: "Jogando agora" },
      { emoji: "🎮", text: "Minecraft" },
      { emoji: "🎧", text: "Ouvindo Nexo Lo-fi" },
      { emoji: "🌙", text: "Modo foco ligado" },
    ];

    const TABS = [
      { id: "foto", label: "Foto", icon: "user" },
      { id: "banner", label: "Banner", icon: "image" },
      { id: "info", label: "Informações", icon: "pencil" },
      { id: "status", label: "Status", icon: "smile" },
      { id: "theme", label: "Aparência", icon: "palette" },
    ];

    const footer = u().el(
      '<div class="modal__actions">' +
        '<span class="spacer"></span>' +
        '<button class="btn btn--ghost" type="button" data-modal-close>Cancelar</button>' +
        '<button class="btn btn--primary" type="button" data-pp-save data-busy-label="Salvando">Salvar alterações</button>' +
        "</div>"
    );

    const m = ui().modal({ title: "Editar perfil", eyebrow: "Sua conta", size: "lg", footer: footer });
    m.el.classList.add("modal--pp-edit");

    /* ---------- blocos de HTML ---------- */
    function emojiGrid(selected) {
      return (
        '<div class="emoji-grid emoji-grid--sm">' +
        Array.from(new Set(u().EMOJIS))
          .map(
            (e) =>
              '<button type="button" class="emoji-grid__item' +
              (e === selected ? " is-on" : "") +
              '" data-pp-emoji="' +
              h(e) +
              '" aria-label="Emoji ' +
              h(e) +
              '">' +
              h(e) +
              "</button>"
          )
          .join("") +
        "</div>"
      );
    }

    function swatchRow(selected, attr) {
      return (
        '<div class="swatch-row">' +
        u().PALETTE.map(
          (c) =>
            '<button type="button" class="swatch' +
            (c === selected ? " is-on" : "") +
            '" style="--sw:' +
            c +
            '" data-' +
            attr +
            '="' +
            c +
            '" aria-label="Cor ' +
            c +
            '"></button>'
        ).join("") +
        "</div>"
      );
    }

    function rangeHTML(kind, axis, label, min, max, step, value) {
      return (
        '<label class="pp-range"><span class="pp-range__label">' +
        h(label) +
        '</span><input type="range" min="' +
        min +
        '" max="' +
        max +
        '" step="' +
        step +
        '" value="' +
        value +
        '" data-range="' +
        kind +
        '" data-axis="' +
        axis +
        '" /><output data-out="' +
        kind +
        "-" +
        axis +
        '">' +
        (axis === "zoom" ? Number(value).toFixed(2).replace(".", ",") + "×" : value + "%") +
        "</output></label>"
      );
    }

    function cropBox(kind, hint) {
      const c = kind === "avatar" ? st.avatarCrop : st.bannerCrop;
      return (
        '<div class="pp-crop pp-crop--' +
        kind +
        '" data-cropbox="' +
        kind +
        '" hidden>' +
        '<div class="pp-crop__frame"><img data-cropimg="' +
        kind +
        '" alt="Pré-visualização do recorte" /></div>' +
        '<div class="pp-crop__controls">' +
        rangeHTML(kind, "x", "Posição horizontal", -50, 50, 1, c.x) +
        rangeHTML(kind, "y", "Posição vertical", -50, 50, 1, c.y) +
        rangeHTML(kind, "zoom", "Zoom", 1, 3, 0.05, c.zoom) +
        "</div>" +
        '<div class="pp-crop__foot"><span>' +
        h(hint) +
        "</span>" +
        '<button type="button" class="btn btn--ghost btn--sm" data-cropreset="' +
        kind +
        '">' +
        NX.icon("refresh", "", 14) +
        "<span>Reajustar</span></button></div>" +
        "</div>"
      );
    }

    function fotoPanel() {
      return (
        '<section class="pp-edit__panel" data-pppanel="foto">' +
        '<h4 class="pp-edit__h">Foto de perfil</h4>' +
        '<p class="pp-edit__p">Envie uma imagem quadrada — você ajusta enquadramento e zoom antes de salvar. Sem imagem, use um emoji com a cor do seu perfil.</p>' +
        '<div class="pp-photo">' +
        '<div class="pp-photo__preview" data-avatar-preview></div>' +
        '<div class="pp-photo__side">' +
        '<div class="pp-photo__btns">' +
        '<label class="btn btn--soft btn--sm">' +
        NX.icon("image", "", 15) +
        "<span>Trocar foto</span>" +
        '<input type="file" accept="image/*" data-ppfile="avatar" class="sr-only" /></label>' +
        (st.avatarImage && !st.avatarSrc
          ? '<button type="button" class="btn btn--ghost btn--sm" data-ppavatar-adjust>' +
            NX.icon("pencil", "", 14) +
            "<span>Ajustar</span></button>"
          : "") +
        (st.avatarImage || st.avatarSrc
          ? '<button type="button" class="btn btn--ghost btn--sm" data-ppavatar-remove>' +
            NX.icon("trash", "", 14) +
            "<span>Remover</span></button>"
          : "") +
        "</div>" +
        '<div class="field"><span class="field__label">Emoji</span>' +
        emojiGrid(st.avatarEmoji) +
        "</div>" +
        '<div class="field"><span class="field__label">Cor</span>' +
        swatchRow(st.avatarColor, "ppavcolor") +
        "</div>" +
        "</div></div>" +
        cropBox("avatar", "Arraste os controles até o rosto ficar centralizado.") +
        "</section>"
      );
    }

    function bannerPanel() {
      return (
        '<section class="pp-edit__panel" data-pppanel="banner" hidden>' +
        '<h4 class="pp-edit__h">Banner do perfil</h4>' +
        '<p class="pp-edit__p">Uma faixa no topo do seu cartão. A imagem é reduzida para 1200 px de largura.</p>' +
        '<div class="pp-banneredit">' +
        '<div class="pp-banneredit__preview" data-banner-preview></div>' +
        '<div class="pp-photo__btns">' +
        '<label class="btn btn--soft btn--sm">' +
        NX.icon("image", "", 15) +
        "<span>Trocar banner</span>" +
        '<input type="file" accept="image/*" data-ppfile="banner" class="sr-only" /></label>' +
        (st.banner && !st.bannerSrc
          ? '<button type="button" class="btn btn--ghost btn--sm" data-ppbanner-adjust>' +
            NX.icon("pencil", "", 14) +
            "<span>Ajustar</span></button>"
          : "") +
        (st.banner || st.bannerSrc
          ? '<button type="button" class="btn btn--ghost btn--sm" data-ppbanner-remove>' +
            NX.icon("trash", "", 14) +
            "<span>Remover</span></button>"
          : "") +
        "</div></div>" +
        cropBox("banner", "Centralize o que importa — as laterais aparecem no cartão.") +
        "</section>"
      );
    }

    function infoPanel() {
      return (
        '<section class="pp-edit__panel" data-pppanel="info" hidden>' +
        '<h4 class="pp-edit__h">Informações</h4>' +
        '<div class="field"><span class="field__label">Nome de exibição</span>' +
        '<input class="input" data-ppfield="displayName" maxlength="32" value="' +
        h(st.displayName) +
        '" placeholder="Como as pessoas te chamam" /></div>' +
        '<div class="field"><span class="field__label">Nome de usuário</span>' +
        '<div class="input-affix"><span class="input-affix__ico">@</span>' +
        '<input class="input" data-ppfield="username" maxlength="18" value="' +
        h(st.username) +
        '" /></div>' +
        '<span class="field__hint">3 a 18 caracteres: letras, números, ponto e sublinhado.</span></div>' +
        '<div class="field"><span class="field__label">Bio <em data-ppcount>' +
        st.bio.length +
        "/190</em></span>" +
        '<textarea class="input input--area" data-ppfield="bio" rows="4" maxlength="190" placeholder="Conte quem é você, o que curte e do que faz parte.">' +
        h(st.bio) +
        "</textarea></div>" +
        "</section>"
      );
    }

    function statusPanel() {
      return (
        '<section class="pp-edit__panel" data-pppanel="status" hidden>' +
        '<h4 class="pp-edit__h">Status</h4>' +
        '<div class="field-row">' +
        '<div class="field"><span class="field__label">Presença</span>' +
        '<select class="select" data-ppfield="status">' +
        Object.keys(NX.STATUS_LABEL)
          .map(
            (k) =>
              '<option value="' +
              k +
              '"' +
              (st.status === k ? " selected" : "") +
              ">" +
              h(NX.STATUS_LABEL[k]) +
              "</option>"
          )
          .join("") +
        "</select></div>" +
        '<div class="field"><span class="field__label">Emoji</span>' +
        '<input class="input" data-ppfield="statusEmoji" maxlength="8" value="' +
        h(st.statusEmoji) +
        '" placeholder="🎮" /></div>' +
        "</div>" +
        '<div class="field"><span class="field__label">Status personalizado</span>' +
        '<input class="input" data-ppfield="customStatus" maxlength="60" value="' +
        h(st.customStatus) +
        '" placeholder="Jogando agora · Minecraft" /></div>' +
        '<div class="field"><span class="field__label">Sugestões</span>' +
        '<div class="pp-sug-row">' +
        SUGGESTIONS.map(
          (s) =>
            '<button type="button" class="pp-sug" data-pp-sug data-emoji="' +
            h(s.emoji) +
            '" data-text="' +
            h(s.text) +
            '"><i>' +
            h(s.emoji) +
            "</i>" +
            h(s.text) +
            "</button>"
        ).join("") +
        "</div></div>" +
        '<p class="pp-edit__p">O status personalizado aparece no seu cartão e ao seu lado na lista de membros.</p>' +
        "</section>"
      );
    }

    function appearancePanel() {
      return (
        '<section class="pp-edit__panel" data-pppanel="theme" hidden>' +
        '<h4 class="pp-edit__h">Cor do perfil</h4>' +
        '<p class="pp-edit__p">Usada no banner, no cartão e nos destaques do seu perfil.</p>' +
        swatchRow(st.profileColor, "ppcolor") +
        '<div class="pp-edit__divider"></div>' +
        '<h4 class="pp-edit__h">Tema</h4>' +
        '<div class="pp-seg" role="group" aria-label="Tema da interface">' +
        [
          { v: "", l: "Padrão" },
          { v: "light", l: "Claro" },
          { v: "dark", l: "Escuro" },
        ]
          .map(
            (t) =>
              '<button type="button" class="pp-seg__btn' +
              (st.theme === t.v ? " is-on" : "") +
              '" data-pp-theme="' +
              t.v +
              '">' +
              h(t.l) +
              "</button>"
          )
          .join("") +
        "</div>" +
        '<p class="pp-edit__p">Padrão acompanha a preferência do seu sistema.</p>' +
        "</section>"
      );
    }

    function previewHTML() {
      return (
        '<div class="pp-preview" data-preview style="--pc:' +
        h(st.profileColor) +
        '">' +
        '<div class="pp-preview__banner" data-pv-banner></div>' +
        '<div class="pp-preview__body">' +
        '<div class="pp-preview__avatar" data-pv-avatar></div>' +
        '<div class="pp-preview__name" data-pv-name></div>' +
        '<div class="pp-preview__user" data-pv-user></div>' +
        '<div class="pp-preview__status"><span class="status-pill" data-status="online" data-pv-pill>Online</span>' +
        '<span class="pp-preview__custom" data-pv-custom></span></div>' +
        '<p class="pp-preview__bio" data-pv-bio></p>' +
        "</div></div>"
      );
    }

    m.body.innerHTML =
      '<div class="pp-edit">' +
      '<aside class="pp-edit__side">' +
      '<span class="pp-edit__sidelabel">Pré-visualização</span>' +
      previewHTML() +
      '<p class="pp-edit__hint">É assim que sua conta aparece para as pessoas.</p>' +
      "</aside>" +
      '<div class="pp-edit__main">' +
      '<nav class="pp-tabs" role="tablist">' +
      TABS.map(
        (t, i) =>
          '<button type="button" class="pp-tab' +
          (i === 0 ? " is-on" : "") +
          '" role="tab" data-pptab="' +
          t.id +
          '" aria-selected="' +
          (i === 0) +
          '">' +
          NX.icon(t.icon, "", 15) +
          "<span>" +
          h(t.label) +
          "</span></button>"
      ).join("") +
      "</nav>" +
      '<div class="form-error" data-error hidden></div>' +
      fotoPanel() +
      bannerPanel() +
      infoPanel() +
      statusPanel() +
      appearancePanel() +
      "</div></div>";

    const body = m.body;

    /* ---------- helpers de render ---------- */
    function showErr(msg) {
      const box = body.querySelector("[data-error]");
      if (!box) return;
      box.hidden = !msg;
      box.innerHTML = msg ? NX.icon("alert", "", 16) + "<span>" + h(msg) + "</span>" : "";
      if (msg) box.scrollIntoView({ block: "nearest" });
    }

    function renderPanel(id) {
      const host = body.querySelector('[data-pppanel="' + id + '"]');
      if (!host) return;
      const html =
        id === "foto"
          ? fotoPanel()
          : id === "banner"
          ? bannerPanel()
          : id === "info"
          ? infoPanel()
          : id === "status"
          ? statusPanel()
          : appearancePanel();
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      const next = tmp.firstElementChild;
      if (!next) return;
      host.className = next.className;
      host.innerHTML = next.innerHTML;
      host.hidden = st.tab !== id;
    }

    function cropTransform(kind) {
      const c = kind === "avatar" ? st.avatarCrop : st.bannerCrop;
      return "translate(" + c.x + "%, " + c.y + "%) scale(" + (c.zoom || 1) + ")";
    }

    function applyCrop(kind) {
      const img = body.querySelector('[data-cropimg="' + kind + '"]');
      if (img) img.style.transform = cropTransform(kind);
      const c = kind === "avatar" ? st.avatarCrop : st.bannerCrop;
      ["x", "y", "zoom"].forEach((axis) => {
        const out = body.querySelector('[data-out="' + kind + "-" + axis + '"]');
        if (!out) return;
        out.textContent = axis === "zoom" ? Number(c[axis]).toFixed(2).replace(".", ",") + "×" : c[axis] + "%";
      });
    }

    function showCrop(kind) {
      const box = body.querySelector('[data-cropbox="' + kind + '"]');
      if (!box) return;
      const img = box.querySelector("[data-cropimg]");
      const src = kind === "avatar" ? st.avatarSrc : st.bannerSrc;
      if (img && src) img.src = src;
      box.hidden = false;
      const c = kind === "avatar" ? st.avatarCrop : st.bannerCrop;
      ["x", "y", "zoom"].forEach((axis) => {
        const r = box.querySelector('[data-range="' + kind + '"][data-axis="' + axis + '"]');
        if (r) r.value = c[axis];
      });
      applyCrop(kind);
      const prev = body.querySelector(kind === "avatar" ? "[data-avatar-preview]" : "[data-banner-preview]");
      if (prev) prev.hidden = true;
    }

    function hideCrop(kind) {
      const box = body.querySelector('[data-cropbox="' + kind + '"]');
      if (box) box.hidden = true;
      const prev = body.querySelector(kind === "avatar" ? "[data-avatar-preview]" : "[data-banner-preview]");
      if (prev) prev.hidden = false;
    }

    function renderAvatarPreview() {
      const box = body.querySelector("[data-avatar-preview]");
      if (!box) return;
      if (st.avatarSrc) {
        box.hidden = true;
        showCrop("avatar");
        return;
      }
      box.hidden = false;
      box.innerHTML = avatarHTML(
        {
          id: me.id,
          displayName: st.displayName,
          username: st.username,
          avatar: { emoji: st.avatarEmoji, color: st.avatarColor, image: st.avatarImage },
          status: st.status,
        },
        "xl",
        false
      );
    }

    function renderBannerPreview() {
      const box = body.querySelector("[data-banner-preview]");
      if (!box) return;
      if (st.bannerSrc) {
        box.hidden = true;
        showCrop("banner");
        return;
      }
      box.hidden = false;
      box.innerHTML = st.banner
        ? '<img class="pp-banneredit__img" src="' + h(st.banner) + '" alt="" />'
        : '<span class="pp-banneredit__grad" style="--pc:' + h(st.profileColor) + '"></span>';
    }

    function refresh() {
      const pv = body.querySelector("[data-preview]");
      if (!pv) return;
      pv.style.setProperty("--pc", st.profileColor);

      const banner = pv.querySelector("[data-pv-banner]");
      if (banner) {
        if (st.banner) {
          banner.classList.add("is-img");
          banner.style.backgroundImage = 'url("' + st.banner + '")';
        } else {
          banner.classList.remove("is-img");
          banner.style.backgroundImage = "";
        }
      }

      const av = pv.querySelector("[data-pv-avatar]");
      if (av)
        av.innerHTML = avatarHTML(
          {
            id: me.id,
            displayName: st.displayName,
            username: st.username,
            avatar: { emoji: st.avatarEmoji, color: st.avatarColor, image: st.avatarImage },
            status: st.status,
          },
          "lg",
          false
        );

      const name = pv.querySelector("[data-pv-name]");
      if (name) name.textContent = st.displayName.trim() || "Seu nome";
      const usr = pv.querySelector("[data-pv-user]");
      if (usr) usr.textContent = "@" + (st.username.trim() || "usuario");

      const pill = pv.querySelector("[data-pv-pill]");
      if (pill) {
        pill.setAttribute("data-status", st.status);
        pill.textContent = NX.STATUS_LABEL[st.status] || "Offline";
      }

      const bits = [];
      if (st.statusEmoji) bits.push(st.statusEmoji);
      if (st.customStatus) bits.push(st.customStatus);
      const cs = pv.querySelector("[data-pv-custom]");
      if (cs) {
        cs.textContent = bits.join(" ");
        cs.hidden = !bits.length;
      }

      const bio = pv.querySelector("[data-pv-bio]");
      if (bio) bio.textContent = st.bio || "Sua bio aparece aqui.";
    }

    function setTab(id) {
      st.tab = id;
      Array.prototype.forEach.call(body.querySelectorAll("[data-pptab]"), (b) => {
        const on = b.getAttribute("data-pptab") === id;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      Array.prototype.forEach.call(body.querySelectorAll("[data-pppanel]"), (p) => {
        p.hidden = p.getAttribute("data-pppanel") !== id;
      });
    }

    /* ---------- leitura de arquivo ---------- */
    function handleFile(input) {
      const kind = input.getAttribute("data-ppfile");
      const file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        ui().error("Escolha um arquivo de imagem (JPG, PNG ou WebP).");
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        ui().error("Esta imagem é grande demais. Use uma com até 8 MB.");
        return;
      }
      const fr = new FileReader();
      fr.onload = () => {
        const src = String(fr.result || "");
        loadImage(src)
          .then(() => {
            if (kind === "avatar") {
              st.avatarSrc = src;
              st.avatarCrop = { x: 0, y: 0, zoom: 1 };
              renderPanel("foto");
              renderAvatarPreview();
              showCrop("avatar");
            } else {
              st.bannerSrc = src;
              st.bannerTouched = true;
              st.bannerCrop = { x: 0, y: 0, zoom: 1 };
              renderPanel("banner");
              renderBannerPreview();
              showCrop("banner");
            }
            showErr("");
            refresh();
          })
          .catch((e) => ui().error(e.message));
      };
      fr.onerror = () => ui().error("Não foi possível ler este arquivo.");
      fr.readAsDataURL(file);
    }

    /* ---------- eventos ---------- */
    body.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-pptab]");
      if (tab) {
        setTab(tab.getAttribute("data-pptab"));
        return;
      }

      const em = e.target.closest("[data-pp-emoji]");
      if (em) {
        st.avatarEmoji = em.getAttribute("data-pp-emoji");
        if (st.avatarImage || st.avatarSrc) {
          st.avatarImage = null;
          st.avatarSrc = null;
          hideCrop("avatar");
        }
        renderPanel("foto");
        renderAvatarPreview();
        refresh();
        return;
      }

      const avc = e.target.closest("[data-ppavcolor]");
      if (avc) {
        st.avatarColor = avc.getAttribute("data-ppavcolor");
        renderPanel("foto");
        renderAvatarPreview();
        refresh();
        return;
      }

      const pc = e.target.closest("[data-ppcolor]");
      if (pc) {
        st.profileColor = pc.getAttribute("data-ppcolor");
        renderPanel("theme");
        renderBannerPreview();
        refresh();
        return;
      }

      const th = e.target.closest("[data-pp-theme]");
      if (th) {
        st.theme = th.getAttribute("data-pp-theme");
        renderPanel("theme");
        return;
      }

      const sug = e.target.closest("[data-pp-sug]");
      if (sug) {
        st.statusEmoji = sug.getAttribute("data-emoji");
        st.customStatus = sug.getAttribute("data-text");
        renderPanel("status");
        refresh();
        return;
      }

      if (e.target.closest("[data-ppavatar-remove]")) {
        st.avatarImage = null;
        st.avatarSrc = null;
        st.avatarCrop = { x: 0, y: 0, zoom: 1 };
        hideCrop("avatar");
        renderPanel("foto");
        renderAvatarPreview();
        refresh();
        return;
      }

      if (e.target.closest("[data-ppavatar-adjust]") && st.avatarImage) {
        st.avatarSrc = st.avatarImage;
        st.avatarCrop = { x: 0, y: 0, zoom: 1 };
        renderPanel("foto");
        showCrop("avatar");
        return;
      }

      if (e.target.closest("[data-ppbanner-remove]")) {
        st.banner = null;
        st.bannerSrc = null;
        st.bannerTouched = true;
        st.bannerCrop = { x: 0, y: 0, zoom: 1 };
        hideCrop("banner");
        renderPanel("banner");
        renderBannerPreview();
        refresh();
        return;
      }

      if (e.target.closest("[data-ppbanner-adjust]") && st.banner) {
        st.bannerSrc = st.banner;
        st.bannerTouched = true;
        st.bannerCrop = { x: 0, y: 0, zoom: 1 };
        renderPanel("banner");
        showCrop("banner");
        return;
      }

      const reset = e.target.closest("[data-cropreset]");
      if (reset) {
        const kind = reset.getAttribute("data-cropreset");
        const c = kind === "avatar" ? st.avatarCrop : st.bannerCrop;
        c.x = 0;
        c.y = 0;
        c.zoom = 1;
        const box = body.querySelector('[data-cropbox="' + kind + '"]');
        if (box) {
          ["x", "y", "zoom"].forEach((axis) => {
            const r = box.querySelector('[data-range="' + kind + '"][data-axis="' + axis + '"]');
            if (r) r.value = c[axis];
          });
        }
        applyCrop(kind);
      }
    });

    body.addEventListener("input", (e) => {
      const range = e.target.closest("[data-range]");
      if (range) {
        const kind = range.getAttribute("data-range");
        const axis = range.getAttribute("data-axis");
        const c = kind === "avatar" ? st.avatarCrop : st.bannerCrop;
        c[axis] = Number(range.value);
        applyCrop(kind);
        return;
      }

      const field = e.target.closest("[data-ppfield]");
      if (field) {
        const key = field.getAttribute("data-ppfield");
        st[key] = field.value;
        if (key === "bio") {
          const c = body.querySelector("[data-ppcount]");
          if (c) c.textContent = field.value.length + "/190";
        }
        refresh();
      }
    });

    body.addEventListener("change", (e) => {
      const file = e.target.closest("[data-ppfile]");
      if (file) handleFile(file);
      const field = e.target.closest("[data-ppfield]");
      if (field) {
        st[field.getAttribute("data-ppfield")] = field.value;
        refresh();
      }
    });

    /* ---------- salvar ---------- */
    footer.querySelector("[data-pp-save]").addEventListener("click", () => {
      showErr("");
      const patch = {
        displayName: st.displayName,
        username: st.username,
        bio: st.bio,
        status: st.status,
        statusEmoji: st.statusEmoji,
        customStatus: st.customStatus,
        statusText: st.customStatus,
        profileColor: st.profileColor,
        theme: st.theme,
        avatar: { emoji: st.avatarEmoji, color: st.avatarColor, image: st.avatarImage },
      };

      const failLocal = (msg) => {
        showErr(msg);
        ui().error(msg);
      };

      if (String(patch.displayName).trim().length < 2) {
        failLocal("Digite um nome com pelo menos 2 caracteres.");
        setTab("info");
        return;
      }
      if (!u().usernameOk(patch.username)) {
        failLocal("Nome de usuário precisa de 3 a 18 caracteres (letras, números, . e _).");
        setTab("info");
        return;
      }

      const btn = footer.querySelector("[data-pp-save]");
      const done = ui().busy(btn);

      Promise.all([
        st.avatarSrc ? cropImage(st.avatarSrc, st.avatarCrop, 256, 256, 900000) : Promise.resolve(st.avatarImage),
        st.bannerSrc ? cropImage(st.bannerSrc, st.bannerCrop, 1200, 360, 1400000) : Promise.resolve(undefined),
      ])
        .then((out) => {
          patch.avatar.image = out[0] || null;
          if (st.bannerSrc) patch.banner = out[1];
          else if (st.bannerTouched) patch.banner = null;
          return api().updateProfile(patch);
        })
        .then(() => {
          try {
            NX.applyTheme(themeValue(st.theme));
          } catch (e) {
            /* tema é melhor esforço */
          }
          done();
          m.close();
          ui().toast("Perfil atualizado.", "success");
          emitChange({ userId: me.id, updated: true });
        })
        .catch((e) => {
          done();
          const msg = (e && e.message) || "Não foi possível salvar as alterações.";
          showErr(msg);
          ui().error(msg);
        });
    });

    /* ---------- estado inicial ---------- */
    renderPanel("foto");
    renderPanel("banner");
    renderPanel("info");
    renderPanel("status");
    renderPanel("theme");
    setTab("foto");
    renderAvatarPreview();
    renderBannerPreview();
    refresh();

    return m;
  };

  /* =========================================================
     AÇÕES (prefixo pp-)
     ========================================================= */
  PP["pp-copy-id"] = (el) => copyId(el.getAttribute("data-id"));
  PP["pp-message"] = (el) => startDM(el.getAttribute("data-id"));
  PP["pp-view-profile"] = (el) => go("#/perfil/" + el.getAttribute("data-id"));
  PP["pp-edit-profile"] = () => people.editProfileModal();

  /* ---- estatísticas do perfil (👥 seguidores / ❤️ curtidas) ---- */
  PP["pp-followers"] = (el) => {
    const id = el.getAttribute("data-id");
    const me = S().me();
    if (!S().canViewFollowersOf(me ? me.id : null, id)) {
      ui().error("Esta pessoa mantém a lista de seguidores dela privada.");
      return;
    }
    if (NX.social && typeof NX.social.openFollowers === "function") {
      NX.social.openFollowers(id, "followers");
    }
  };

  PP["pp-likes"] = (el) => {
    const id = el.getAttribute("data-id");
    const me = S().me();
    if (!S().canViewLikesOf(me ? me.id : null, id)) {
      ui().error("Esta pessoa mantém as curtidas dela privadas.");
      return;
    }
    if (NX.social && typeof NX.social.openLikes === "function") NX.social.openLikes(id);
  };

  /* ---- amizade ---- */
  function pendingRequestWith(otherId) {
    const me = S().me();
    return me ? S().friendRequestBetween(me.id, otherId) : null;
  }

  const friendFail = (e) => ui().error((e && e.message) || "Não foi possível concluir.");

  PP["pp-add-friend"] = (el) => {
    api()
      .sendFriendRequest(el.getAttribute("data-id"))
      .then(() => ui().toast("Solicitação de amizade enviada.", "success"))
      .catch(friendFail);
  };

  PP["pp-accept-friend"] = (el) => {
    const id = el.getAttribute("data-id");
    const req = pendingRequestWith(id);
    if (!req) {
      ui().error("Esta solicitação de amizade não existe mais.");
      return;
    }
    api()
      .acceptFriendRequest(req.id)
      .then((res) => {
        const who = (res && res.user) || S().user(id);
        ui().toast(
          "🎉 Agora você e @" + (who ? who.username : "essa pessoa") + " são amigos!",
          "success"
        );
      })
      .catch(friendFail);
  };

  PP["pp-reject-friend"] = (el) => {
    const req = pendingRequestWith(el.getAttribute("data-id"));
    if (!req) return;
    api()
      .rejectFriendRequest(req.id)
      .then(() => ui().toast("Solicitação recusada.", "info"))
      .catch(friendFail);
  };

  PP["pp-cancel-friend"] = (el) => {
    const id = el.getAttribute("data-id");
    const other = S().user(id);
    const req = pendingRequestWith(id);
    if (!req) return;
    api()
      .cancelFriendRequest(req.id)
      .then(() => ui().toast("Solicitação cancelada" + (other ? " para @" + other.username : "") + ".", "info"))
      .catch(friendFail);
  };

  PP["pp-remove-friend"] = async (el) => {
    const id = el.getAttribute("data-id");
    const other = S().user(id);
    if (!other) return;
    const ok = await ui().confirm({
      title: "Remover amigo",
      message: "Tem certeza que deseja remover @" + other.username + " dos seus amigos?",
      confirmLabel: "Remover",
      icon: "alert",
    });
    if (!ok) return;
    api()
      .removeFriend(id)
      .then(() => ui().toast("@" + other.username + " não é mais seu amigo.", "info"))
      .catch(friendFail);
  };

  PP["pp-block"] = (el) => {
    const user = S().user(el.getAttribute("data-id"));
    if (user) blockUser(user);
  };

  PP["pp-unblock"] = (el) => {
    const user = S().user(el.getAttribute("data-id"));
    if (user) unblockUser(user);
  };

  PP["pp-report"] = (el) => {
    const user = S().user(el.getAttribute("data-id"));
    if (user) reportModal(user);
  };

  PP["pp-profile-menu"] = (el) => {
    const userId = el.getAttribute("data-id");
    const user = S().user(userId);
    const me = S().me();
    if (!user || !me) return;
    const blocked = S().isBlocked(me.id, userId);
    const items = [
      { label: "Ver perfil", icon: "user", onClick: () => go("#/perfil/" + userId) },
      { label: "Mensagem", icon: "chat", onClick: () => startDM(userId) },
      { label: "Copiar ID", icon: "copy", onClick: () => copyId(userId) },
      { divider: true },
      blocked
        ? { label: "Desbloquear", icon: "lock", onClick: () => unblockUser(user) }
        : { label: "Bloquear", icon: "lock", danger: true, onClick: () => blockUser(user) },
      { label: "Denunciar", icon: "alert", danger: true, onClick: () => reportModal(user) },
    ];
    ui().menu(el, items, { align: "end" });
  };

  PP["pp-member-menu"] = (el) => {
    const serverId = el.getAttribute("data-server");
    const userId = el.getAttribute("data-user");
    const server = S().server(serverId);
    const user = S().user(userId);
    const me = S().me();
    if (!server || !user || !me) return;

    const isMe = me.id === userId;
    const isOwner = server.ownerId === userId;
    const blocked = S().isBlocked(me.id, userId);

    const items = [
      { label: "Ver perfil", icon: "user", onClick: () => go("#/perfil/" + userId) },
      { label: "Copiar ID", icon: "copy", onClick: () => copyId(userId) },
    ];
    if (!isMe) items.splice(1, 0, { label: "Mensagem", icon: "chat", onClick: () => startDM(userId) });

    const admin = [];
    if (!isMe && !isOwner) {
      if (S().can(serverId, me.id, "manageRoles"))
        admin.push({ label: "Adicionar cargo", icon: "shield", onClick: () => roleModal(serverId, userId) });
      if (S().can(serverId, me.id, "kickMembers"))
        admin.push({ label: "Expulsar", icon: "logout", danger: true, onClick: () => kickFlow(serverId, user) });
      if (S().can(serverId, me.id, "banMembers"))
        admin.push({ label: "Banir", icon: "lock", danger: true, onClick: () => banFlow(serverId, user) });
    }
    if (admin.length) {
      items.push({ divider: true });
      admin.forEach((it) => items.push(it));
    }

    if (!isMe) {
      items.push({ divider: true });
      items.push(
        blocked
          ? { label: "Desbloquear", icon: "lock", onClick: () => unblockUser(user) }
          : { label: "Bloquear", icon: "lock", danger: true, onClick: () => blockUser(user) }
      );
    }

    ui().menu(el, items, { align: "end" });
  };

  PP["pp-dm-menu"] = (el) => {
    const dmId = el.getAttribute("data-dm");
    const userId = el.getAttribute("data-user");
    const dm = (db().dms || {})[dmId];
    const user = S().user(userId);
    const me = S().me();
    if (!user || !me) return;
    const muted = !!(dm && dm.muted);
    const blocked = S().isBlocked(me.id, userId);

    const items = [
      { label: "Ver perfil", icon: "user", onClick: () => go("#/perfil/" + userId) },
      {
        label: muted ? "Ativar notificações" : "Silenciar",
        icon: "bell",
        onClick: () => {
          if (!dm) {
            ui().error("Conversa não encontrada.");
            return;
          }
          api()
            .muteDM(dmId, !muted)
            .then(() => {
              ui().toast(muted ? "Notificações ativadas." : "Conversa silenciada.", "success");
              emitChange({ dmId: dmId, muted: !muted });
            })
            .catch((e) => ui().error(e.message || "Não foi possível alterar as notificações."));
        },
      },
      { divider: true },
      blocked
        ? { label: "Desbloquear", icon: "lock", onClick: () => unblockUser(user) }
        : { label: "Bloquear", icon: "lock", danger: true, onClick: () => blockUser(user) },
      { label: "Denunciar", icon: "alert", danger: true, onClick: () => reportModal(user) },
    ];
    ui().menu(el, items, { align: "end" });
  };

  /* ---------------- ligações de eventos ---------------- */
  function bindActions(container) {
    if (!container || container.__ppBound) return container;
    container.__ppBound = true;
    container.addEventListener("click", (e) => {
      const el = e.target.closest ? e.target.closest("[data-action]") : null;
      if (!el || !container.contains(el)) return;
      const name = el.getAttribute("data-action");
      const fn = PP[name];
      if (typeof fn !== "function") return; /* deixa a ação global tratar */
      e.preventDefault();
      e.stopPropagation();
      try {
        fn(el, e);
      } catch (err) {
        console.error("[pp:" + name + "]", err);
        ui().error("Algo deu errado ao executar esta ação.");
      }
    });
    return container;
  }

  /* registra as ações no mapa global (delegação do app) */
  Object.keys(PP).forEach((key) => NX.action(key, PP[key]));

  people.actions = PP;
  people.bind = bindActions;
  people.avatarHTML = avatarHTML;

  NX.people = people;
})(window.NX);
