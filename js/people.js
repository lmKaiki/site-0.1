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
      const locale = NX.i18n ? NX.i18n.locale() : "pt-BR";
      return new Date(ts).toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch (e) {
      return "";
    }
  }

  /* País no perfil: só aparece se o dono permitir (privacidade),
     e nunca expõe fuso, IP, GPS ou endereço. */
  function countryMetaHTML(user, viewer) {
    if (!user) return "";
    const visible =
      NX.selectors && NX.selectors.canSeeCountry
        ? NX.selectors.canSeeCountry(viewer ? viewer.id : null, user.id)
        : false;
    if (!visible) return "";
    const reg = user.region || {};
    const label =
      NX.region && NX.region.countryLabel
        ? NX.region.countryLabel(reg.countryCode, NX.i18n ? NX.i18n.current() : "pt-BR")
        : reg.countryName;
    if (!label) return "";
    return (
      '<span class="pp-meta__item">' +
      '<span class="pp-meta__flag" aria-hidden="true">' + h(reg.countryFlag || "") + "</span>" +
      ("<span><small>" + NX.i18n.get("people.pais", "País") + "</small>") + h(label) + "</span></span>"
    );
  }

  function copyId(id) {
    return u().copy(id).then((ok) => {
      ui().toast(
        ok ? NX.i18n.get("people.idCopiadoAreaTransferencia", "ID copiado para a área de transferência.") : NX.i18n.get("people.naoFoiPossivelCopiar", "Não foi possível copiar o ID."),
        ok ? "success" : "error"
      );
      return ok;
    });
  }

  /* o que a pessoa compartilha é o ID PÚBLICO numérico (#2344).
     O u_… interno só entra se ainda não houver número (conta recém-criada
     antes da varredura) — nunca fingindo que o ID já existe. */
  function copyPublicId(userId) {
    const user = S().user(userId);
    if (user && user.publicId) return copyId("#" + user.publicId);
    return copyId(userId);
  }

  /* ---------------- avatar ----------------
     Um único caminho de desenho (NX.util.avatarHTML): foto enviada →
     modelo original do Nexo → emoji escolhido à mão → modelo do id.
     Assim perfil, preview e lista nunca divergem. */
  function avatarHTML(user, size, showStatus) {
    if (!user) return "";
    if (NX.util && typeof NX.util.avatarHTML === "function")
      return NX.util.avatarHTML(user, size || "md", !!showStatus);
    if (!NX.util) return "";
    return "";
  }

  /* ---------------- status ---------------- */
  function statusOf(user) {
    return user && user.status ? user.status : "offline";
  }

  function statusLabel(user) {
    return NX.STATUS_LABEL[statusOf(user)] || NX.i18n.get("core.statusOffline", "Offline");
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
    return '<span class="pp-role pp-role--owner">' + NX.icon("crown", "", 13) + (" " + NX.i18n.get("adm.dono4", "Dono") + "</span>");
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
      .catch((e) => ui().error(e.message || NX.i18n.get("people.naoFoiPossivelAbrir", "Não foi possível abrir a conversa.")));
  }

  function blockUser(user) {
    if (!user) return;
    ui()
      .confirm({
        title: (NX.i18n.get("people.bloquear", "Bloquear @")) + user.username,
        message:
          (NX.i18n.get("people.desejabloquear", "Deseja bloquear") + " ") + user.displayName + (NX.i18n.get("people.esteusuarionaopoderaenviarmensagens", "? Este usuário não poderá enviar mensagens privadas para você.")),
        note: (NX.i18n.get("people.vocesnaopoderaotrocarmensagensprivadas", "Vocês não poderão trocar mensagens privadas até você desbloquear. Você pode desbloquear quando quiser.")),
        confirmLabel: (NX.i18n.get("page.bloquear", "Bloquear")),
        danger: true,
        icon: "lock",
      })
      .then((ok) => {
        if (!ok) return;
        return api()
          .blockUser(user.id)
          .then(() => {
            ui().closePopout();
            ui().toast(user.displayName + (" " + NX.i18n.get("people.foibloqueado", "foi bloqueado.")), "success");
            emitChange({ userId: user.id, blocked: true });
          });
      })
      .catch((e) => ui().error(e.message || NX.i18n.get("people.naoFoiPossivelBloquear", "Não foi possível bloquear.")));
  }

  function unblockUser(user) {
    if (!user) return;
    api()
      .unblockUser(user.id)
      .then(() => {
        ui().closePopout();
        ui().toast(user.displayName + (" " + NX.i18n.get("people.foidesbloqueado", "foi desbloqueado.")), "success");
        emitChange({ userId: user.id, blocked: false });
      })
      .catch((e) => ui().error(e.message || NX.i18n.get("people.naoFoiPossivelDesbloquear", "Não foi possível desbloquear.")));
  }

  /* ---------------- denúncia ---------------- */
  const REPORT_REASONS = [
    NX.i18n.get("people.spamMensagensRepetidas", "Spam ou mensagens repetidas"),
    NX.i18n.get("people.assedioDiscursoOdio", "Assédio ou discurso de ódio"),
    NX.i18n.get("people.conteudoSexualImproprio", "Conteúdo sexual ou impróprio"),
    NX.i18n.get("people.golpeLinkSuspeitoRoubo", "Golpe, link suspeito ou roubo de conta"),
    NX.i18n.get("people.fingirSerOutraPessoa", "Fingir ser outra pessoa"),
    NX.i18n.get("people.quebraRegrasServidor", "Quebra das regras do servidor"),
    (NX.i18n.get("people.outro", "Outro")),
  ];

  function reportModal(user) {
    if (!user) return null;
    const footer = u().el(
      '<div class="modal__actions">' +
        ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
        ("<button class=\"btn btn--danger\" type=\"button\" data-report-send data-busy-label=\"Enviando\">" + NX.i18n.get("chat.enviardenuncia", "Enviar denúncia") + "</button>") +
        "</div>"
    );
    const m = ui().modal({ title: (NX.i18n.get("people.denunciar", "Denunciar @")) + user.username, eyebrow: (NX.i18n.get("adm.seguranca", "Segurança")), size: "sm", footer: footer });

    m.body.innerHTML =
      ("<p class=\"modal__lead\">" + NX.i18n.get("people.conteoqueaconteceucom", "Conte o que aconteceu com") + " ") +
      h(user.displayName) +
      ". A denúncia é anônima — a pessoa não fica sabendo que você a enviou.</p>" +
      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.motivo", "Motivo") + "</span>") +
      '<select class="select" data-report-reason data-autofocus>' +
      REPORT_REASONS.map((r) => '<option value="' + h(r) + '">' + h(r) + "</option>").join("") +
      "</select></div>" +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("people.detalhes", "Detalhes") + " " + "<em>" + NX.i18n.get("adm.opcional", "(opcional)") + "</em></span>") +
      '<textarea class="input input--area" data-report-detail rows="3" maxlength="300" placeholder="' + NX.i18n.get("ui.oqueaconteceuexmensagensofensivasnocanalgeral", "O que aconteceu? Ex.: mensagens ofensivas no canal #geral.") + '"></textarea></label>' +
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
      const reason = (reasonSel.value || (NX.i18n.get("people.outro", "Outro"))) + (detail ? " — " + detail : "");
      const done = ui().busy(btn);
      api()
        .reportUser(user.id, reason)
        .then(() => {
          done();
          m.close();
          ui().toast(NX.i18n.get("people.denunciaEnviadaObrigadoCuidar", "Denúncia enviada. Obrigado por cuidar da comunidade."), "success");
          emitChange({ userId: user.id, reported: true });
        })
        .catch((e) => {
          done();
          showErr(e.message || NX.i18n.get("chat.naoFoiPossivelEnviar", "Não foi possível enviar a denúncia."));
          ui().error(e.message || NX.i18n.get("chat.naoFoiPossivelEnviar", "Não foi possível enviar a denúncia."));
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
          ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
          '<button class="btn ' +
          (opts.danger ? "btn--danger" : "btn--primary") +
          '" type="button" data-reason-ok>' +
          h(opts.confirmLabel || (NX.i18n.get("common.confirm", "Confirmar"))) +
          "</button>" +
          "</div>"
      );
      const m = ui().modal({
        title: opts.title || NX.i18n.get("people.temCerteza", "Tem certeza?"),
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
        ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.motivo", "Motivo") + " " + "<em>" + NX.i18n.get("adm.opcional", "(opcional)") + "</em></span>") +
        '<input class="input" data-reason-input maxlength="160" placeholder="' +
        h(opts.placeholder || NX.i18n.get("adm.motivoInformado", "Sem motivo informado")) +
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
   /* O Nexo não tem mais banner de perfil: o campo continua no
      banco (nada é apagado), mas a interface não o exibe. */

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
        '" title="' + NX.i18n.get("ui.removerdosamigos", "Remover dos amigos") + '">' + NX.icon("check", "", 16) +
        ("<span>" + NX.i18n.get("nav.friends", "Amigos") + "</span></button>")
      );
    }
    if (st === "sent") {
      return (
        '<button class="btn btn--soft" data-action="pp-cancel-friend" data-id="' + id +
        '" title="' + NX.i18n.get("ui.cancelarsolicitacaodeamizade", "Cancelar solicitação de amizade") + '">' + NX.icon("clock", "", 16) +
        ("<span>" + NX.i18n.get("people.solicitacaoenviada", "Solicitação enviada") + "</span></button>")
      );
    }
    if (st === "received") {
      return (
        '<button class="btn btn--primary" data-action="pp-accept-friend" data-id="' + id + '">' +
        NX.icon("userPlus", "", 16) +
        ("<span>" + NX.i18n.get("people.aceitarsolicitacao", "Aceitar solicitação") + "</span></button>")
      );
    }
    return (
      '<button class="btn btn--soft" data-action="pp-add-friend" data-id="' + id + '">' +
      NX.icon("userPlus", "", 16) +
      ("<span>" + NX.i18n.get("people.adicionarAmigo", "Adicionar amigo") + "</span></button>")
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
        '" title="' + NX.i18n.get("soc.deixarSeguir", "Deixar de seguir") + '">' + NX.icon("check", "", 16) +
        ("<span>" + NX.i18n.get("people.seguindo", "Seguindo") + "</span></button>")
      );
    }
    if (st.state === "pending") {
      return (
        '<button class="btn btn--soft" data-action="sx-unfollow" data-id="' + id +
        '" title="' + NX.i18n.get("ui.cancelarsolicitacaodeseguimento", "Cancelar solicitação de seguimento") + '">' + NX.icon("clock", "", 16) +
        ("<span>" + NX.i18n.get("people.solicitado", "Solicitado") + "</span></button>")
      );
    }
    return (
      '<button class="btn btn--soft" data-action="sx-follow" data-id="' + id + '">' +
      NX.icon("userPlus", "", 16) +
      "<span>" + (st.state === "request" ? (NX.i18n.get("people.solicitar", "Solicitar")) : (NX.i18n.get("people.seguir", "Seguir"))) + "</span></button>"
    );
  }

  /* ---- estatísticas públicas do perfil (curtidas e seguidores) ----
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
      (o.visible ? o.value : (NX.i18n.get("people.privado", "Privado"))) +
      "</strong><span>" + o.label + "</span></span></button>";

    return (
      '<div class="pp-stats">' +
      chip({
        visible: canF,
        action: "pp-followers",
        ico: NX.icon("users", "", 15),
        value: u().num(S().followerCount(user.id)),
        label: (NX.i18n.get("people.seguidores", "Seguidores")),
        title: canF ? NX.i18n.get("people.verListaSeguidores", "Ver a lista de seguidores") : NX.i18n.get("people.listaSeguidoresEstaPrivada", "A lista de seguidores está privada"),
      }) +
      chip({
        visible: canL,
        action: "pp-likes",
        ico: NX.icon("heart", "", 15),
        value: u().num(S().likesReceivedOf(user.id)),
        label: (NX.i18n.get("people.curtidas", "Curtidas")),
        title: canL ? NX.i18n.get("people.verPublicacoesCurtidas", "Ver as publicações curtidas") : NX.i18n.get("people.curtidasEstaoPrivadas", "As curtidas estão privadas"),
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
        ("<h2>" + NX.i18n.get("people.perfilnaoencontrado", "Perfil não encontrado") + "</h2>") +
        ("<p>" + NX.i18n.get("people.estacontanaoexistemaisou", "Esta conta não existe mais ou você não tem permissão para vê-la.") + "</p>") +
        '<div class="pp-empty__actions">' +
        ("<button class=\"btn btn--soft\" data-action=\"nav-home\">" + NX.i18n.get("people.voltaraoinicio", "Voltar ao início") + "</button>") +
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
    /* placa de nome equipada — pinta atrás do nome (js/nameplates.js) */
    const npCls = NX.nameplates ? NX.nameplates.cls(user) : "";

    /* ---- ações ---- */
    const hideSocial = iBlocked || theyBlocked;
    const actions = isMe
      ? '<button class="btn btn--primary" data-action="pp-edit-profile">' +
        NX.icon("pencil", "", 16) +
        ("<span>" + NX.i18n.get("modal.editarPerfil2", "Editar perfil") + "</span></button>") +
        '<button class="btn btn--soft" data-action="np-open-picker">' +
        NX.icon("sparkle", "", 16) +
        ("<span>" + NX.i18n.get("np.picker.btn", "Placas de nome") + "</span></button>") +
        '<button class="btn btn--soft" data-action="open-settings">' +
        NX.icon("settings", "", 16) +
        ("<span>" + NX.i18n.get("nav.settings", "Configurações") + "</span></button>")
      : (hideSocial ? "" : friendBtnHTML(user, isMe) + followBtnHTML(user, isMe)) +
        '<button class="btn btn--primary" data-action="pp-message" data-id="' +
        h(user.id) +
        '">' +
        NX.icon("chat", "", 16) +
        ("<span>" + NX.i18n.get("modal.mensagem", "Mensagem") + "</span></button>") +
        '<button class="btn btn--soft pp-actions__more" data-action="pp-profile-menu" data-id="' +
        h(user.id) +
        '" aria-label="' + NX.i18n.get("ui.maisopcoes", "Mais opções") + '" title="' + NX.i18n.get("ui.people.maisopcoes", "Mais opções") + '">' +
        NX.icon("more", "", 18) +
        "</button>";

    /* ---- avisos de bloqueio ---- */
    let notice = "";
    if (iBlocked) {
      notice =
        '<div class="pp-notice">' +
        NX.icon("lock", "", 18) +
        ("<div class=\"pp-notice__txt\"><strong>" + NX.i18n.get("people.vocebloqueouesteusuario", "Você bloqueou este usuário.") + "</strong>") +
        ("<span>" + NX.i18n.get("people.esteusuarionaopoderaenviarmensagens2", "Este usuário não poderá enviar mensagens privadas para você.") + "</span></div>") +
        '<button class="btn btn--soft btn--sm" data-action="pp-unblock" data-id="' +
        h(user.id) +
        ("\">" + NX.i18n.get("page.desbloquear", "Desbloquear") + "</button></div>");
    } else if (theyBlocked) {
      notice =
        '<div class="pp-notice pp-notice--muted">' +
        NX.icon("info", "", 18) +
        ("<div class=\"pp-notice__txt\"><strong>" + NX.i18n.get("people.esteusuariobloqueouvoce", "Este usuário bloqueou você.") + "</strong>") +
        ("<span>" + NX.i18n.get("people.vocesnaopodemtrocarmensagensprivadas", "Vocês não podem trocar mensagens privadas por enquanto.") + "</span></div></div>");
    }

    /* ---- lista de servidores ----
       Perfil próprio → separa o que é meu do que eu só participo.
       Perfil de outra pessoa → apenas os servidores em comum, para
       não expor a lista privada dela (quem é dono/membro de quê). */
    const srvRow = (s) => {
      const r = roleOf(s.id, user.id);
      return (
        '<button class="pp-srv" data-action="open-server" data-id="' +
        h(s.id) +
        '">' +
        u().serverIconHTML(s, "xs", false) +
        '<span class="pp-srv__txt"><strong>' +
        h(s.name) +
        "</strong><small>" +
        h(r ? r.name : (NX.i18n.get("adm.membro2", "Membro"))) +
        (s.ownerId === user.id ? (" " + NX.i18n.get("page.dono", "· Dono")) : "") +
        "</small></span>" +
        NX.icon("chevronRight", "", 15) +
        "</button>"
      );
    };
    const srvBlock = (title, list, emptyText) =>
      '<section class="pp-block">' +
      '<h4 class="pp-block__h">' +
      NX.icon("grid", "", 15) +
      "<span>" +
      h(title) +
      (list.length ? " · " + list.length : "") +
      "</span></h4>" +
      (list.length
        ? '<div class="pp-srv-list">' + list.map(srvRow).join("") + "</div>"
        : '<p class="pp-bio pp-bio--dim">' + h(emptyText) + "</p>") +
      "</section>";

    /* Declarado ANTES de serversHTML: usar `const` depois do ponto de
       uso derruba o perfil inteiro com "Cannot access ... before
       initialization" (TDZ) — o perfil alheio nem abria. */
    const emptyServers = isMe
      ? NX.i18n.get(
          "people.voceAindaNaoParticipa",
          "Você ainda não participa de nenhum servidor. Crie um ou entre por convite."
        )
      : NX.i18n.get(
          "people.nenhumServidorComumEntrem",
          "Nenhum servidor em comum. Entrem no mesmo servidor para ver a lista aqui."
        );

    const owned = isMe ? servers.filter((s) => s.ownerId === user.id) : servers;
    const joined = isMe ? servers.filter((s) => s.ownerId !== user.id) : [];

    const serversHTML = isMe
      ? srvBlock(
          NX.i18n.get("people.meusServidores", "Meus servidores"),
          owned,
          NX.i18n.get(
            "people.voceNaoDnenhumServidor",
            "Você ainda não é dono de nenhum servidor. Crie um para começar."
          )
        ) +
        srvBlock(
          NX.i18n.get("people.servidoresParticipo", "Servidores em que participo"),
          joined,
          NX.i18n.get(
            "people.voceAindaNaoParticipa",
            "Você ainda não participa de nenhum servidor. Crie um ou entre por convite."
          )
        )
      : srvBlock(NX.i18n.get("people.servidoresComum", "Servidores em comum"), servers, emptyServers);

    /* gradiente personalizado do cartão: só quando a pessoa NÃO tem
       banner de imagem/vídeo próprio (o banner, sendo escolha
       explícita, continua por cima) */
    const cardg = user.appearance && user.appearance.card;
    const parsedBanner = NX.banner && NX.banner.parse ? NX.banner.parse(user.banner) : null;
    const cardGradOn = !!(cardg && cardg.on && cardg.from && cardg.to) && !(parsedBanner && parsedBanner.src);
    const bannerHTML = NX.banner.html(user.banner);

    return (
      '<div class="pp-page" data-pp-user="' +
      h(user.id) +
      '" style="--pc:' +
      h(pc) +
      '">' +
      (cardGradOn
        ? '<section class="pp-card pp-card--has-banner" style="--pcg:linear-gradient(' +
          (Number(cardg.angle) || 0) +
          "deg," +
          cardg.from +
          "," +
          cardg.to +
          ')">' +
          bannerHTML.replace("pp-banner--grad", "pp-banner--grad is-custom")
        : '<section class="pp-card pp-card--has-banner">' + bannerHTML) +
      '<div class="pp-card__head">' +
      '<div class="pp-avatar">' +
      avatarHTML(user, "xl", true) +
      "</div>" +
      '<div class="pp-head">' +
      '<div class="pp-name"><h1' +
      (npCls ? ' class="' + npCls + '"' : "") +
      ">" +
      h(user.displayName) +
      "</h1>" +
      (badges ? '<div class="pp-badges">' + badges + "</div>" : "") +
      "</div>" +
      '<div class="pp-handle"><span class="pp-handle__at">@' +
      h(user.username) +
      "</span>" +
      '<button class="pp-copy" data-action="pp-copy-id" data-id="' +
      h(user.id) +
      '" title="' + NX.i18n.get("ui.copiariddousuario", "Copiar ID do usuário") + '">' +
      NX.icon("copy", "", 13) +
      ("<span>" + NX.i18n.get("people.copiarId2", "Copiar ID") + "</span></button></div>") +
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
      ("<span>" + NX.i18n.get("landing.sobre", "Sobre") + "</span></h4>") +
      '<p class="pp-bio">' +
      h(
        user.bio ||
          (isMe
            ? NX.i18n.get("page.voceAindaNaoEscreveu", "Você ainda não escreveu uma bio. Edite seu perfil para contar quem é você.")
            : NX.i18n.get("people.esteUsuarioAindaNao", "Este usuário ainda não escreveu uma bio."))
      ) +
      "</p>" +
      '<div class="pp-meta">' +
      countryMetaHTML(user, me) +
      '<span class="pp-meta__item">' +
      NX.icon("calendar", "", 15) +
      ("<span><small>" + NX.i18n.get("modal.membrodesde", "Membro desde") + "</small>") +
      h(dateLabel(user.createdAt)) +
      "</span></span>" +
      '<span class="pp-meta__item">' +
      NX.icon("info", "", 15) +
      ("<span><small>" + NX.i18n.get("people.iddousuario", "ID do usuário") + "</small><code class=\"pp-uid\">") +
      "#" + h(user.publicId || "") +
      "</code></span>" +
      '<button class="icon-btn icon-btn--xs" data-action="pp-copy-id" data-id="' +
      h(user.id) +
      '" title="' + NX.i18n.get("people.copiarId", "Copiar ID") + '" aria-label="' + NX.i18n.get("ui.people.copiariddousuario", "Copiar ID do usuário") + '">' +
      NX.icon("copy", "", 14) +
      "</button>" +
      "</span>" +
      "</div>" +
      /* ---- seção ID DO USUÁRIO: o número que a pessoa compartilha ---- */
      '<div class="pp-uidbox">' +
      '<div class="pp-uidbox__txt">' +
      "<strong>" + NX.i18n.get("people.secaoIdUsuario", "ID DO USUÁRIO") + "</strong>" +
      "<span>" +
      NX.i18n.get(
        "people.idNumericoExplica",
        "Número curto e único para você acharem e adicionarem no Nexo."
      ) +
      "</span></div>" +
      '<div class="pp-uidbox__row">' +
      '<code class="pp-uidbox__num">' + (user.publicId ? "#" + h(user.publicId) : "—") + "</code>" +
      '<button class="btn btn--soft btn--sm" data-action="pp-copy-id" data-id="' +
      h(user.id) +
      '"' +
      (user.publicId ? "" : " disabled") +
      ">" +
      NX.icon("copy", "", 15) +
      "<span>" + NX.i18n.get("people.copiarId2", "Copiar ID") + "</span></button>" +
      "</div>" +
      "</div>" +
      "</section>" +
      serversHTML +
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
      '<div class="pp-mcard__body">' +
      '<div class="pp-mcard__avatar">' +
      avatarHTML(user, "lg", true) +
      "</div>" +
      '<h3 class="pp-mcard__name' +
      (NX.nameplates && NX.nameplates.cls(user) ? " " + NX.nameplates.cls(user) : "") +
      '"' +
      (role ? ' style="--rc:' + h(role.color) + '"' : "") +
      ">" +
      h(user.displayName) +
      "</h3>" +
      '<span class="pp-mcard__user">@' +
      h(user.username) +
      "</span>" +
      (nick
        ? '<span class="pp-mcard__nick">' + NX.icon("pencil", "", 13) + (NX.i18n.get("people.apelido", "Apelido:") + " " + "<strong>") + h(nick) + "</strong></span>"
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
      h(user.bio || NX.i18n.get("people.esteMembroAindaNao", "Este membro ainda não escreveu uma bio.")) +
      "</p>" +
      ("<div class=\"pp-mcard__meta\">" + NX.i18n.get("modal.membrodesde", "Membro desde") + " ") +
      h(dateLabel(membership ? membership.joinedAt : user.createdAt)) +
      "</div>" +
      '<div class="pp-mcard__actions">' +
      '<button class="btn btn--soft btn--sm" data-action="pp-view-profile" data-id="' +
      h(userId) +
      '">' +
      NX.icon("user", "", 15) +
      ("<span>" + NX.i18n.get("adm.verPerfil", "Ver perfil") + "</span></button>") +
      (isMe
        ? ""
        : '<button class="btn btn--soft btn--sm" data-action="pp-message" data-id="' +
          h(userId) +
          '">' +
          NX.icon("chat", "", 15) +
          ("<span>" + NX.i18n.get("modal.mensagem", "Mensagem") + "</span></button>")) +
      '<button class="btn btn--ghost btn--sm pp-mcard__more" data-action="pp-member-menu" data-server="' +
      h(serverId) +
      '" data-user="' +
      h(userId) +
      '" aria-label="' + NX.i18n.get("ui.people.maisopcoes2", "Mais opções") + '">' +
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

    const m = ui().modal({ title: (NX.i18n.get("people.cargosde", "Cargos de @")) + user.username, eyebrow: (NX.i18n.get("adm.membros", "Membros")), size: "sm" });
    m.body.innerHTML =
      ("<p class=\"modal__lead\">" + NX.i18n.get("people.escolhaocargode", "Escolha o cargo de") + " ") +
      h(user.displayName) +
      (" " + NX.i18n.get("people.nesteservidorsoepossivelter", "neste servidor. Só é possível ter um cargo por membro.") + "</p>") +
      '<div class="pp-role-list" role="listbox" aria-label="' + NX.i18n.get("ui.cargosdisponiveis", "Cargos disponíveis") + '">' +
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
            h(r.description || (r.isDefault ? NX.i18n.get("people.cargoPadraoServidor", "Cargo padrão do servidor") : NX.i18n.get("people.descricao", "Sem descrição"))) +
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
            (NX.i18n.get("people.cargode", "Cargo de") + " ") + user.displayName + (" " + NX.i18n.get("api.agorae", "agora é") + " ") + (label ? label.textContent : NX.i18n.get("people.novoCargo", "novo cargo")) + ".",
            "success"
          );
          emitChange({ userId: userId, serverId: serverId });
        })
        .catch((err) => {
          row.classList.remove("is-busy");
          if (box) {
            box.hidden = false;
            box.innerHTML = NX.icon("alert", "", 16) + "<span>" + h(err.message || NX.i18n.get("people.naoFoiPossivelAlterar", "Não foi possível alterar.")) + "</span>";
          }
          ui().error(err.message || NX.i18n.get("people.naoFoiPossivelAlterar2", "Não foi possível alterar o cargo."));
        });
    });
    return m;
  }

  /* ---- expulsar / banir ---- */
  function kickFlow(serverId, user) {
    reasonModal({
      title: (NX.i18n.get("adm.expulsar2", "Expulsar") + " ") + user.displayName,
      message:
        (NX.i18n.get("people.vocedesejaexpulsar", "Você deseja expulsar @")) + user.username + (" " + NX.i18n.get("people.desteservidoreleperderaoacesso", "deste servidor? Ele perderá o acesso na hora e precisará de um novo convite para voltar.")),
      confirmLabel: (NX.i18n.get("adm.expulsar2", "Expulsar")),
      danger: true,
      icon: "logout",
      placeholder: NX.i18n.get("people.motivoOpcional2", "Motivo (opcional)"),
    }).then((reason) => {
      if (reason === null) return;
      api()
        .kickMember(serverId, user.id, reason)
        .then(() => {
          ui().closePopout();
          ui().toast(user.displayName + (" " + NX.i18n.get("people.foiexpulsodoservidor", "foi expulso do servidor.")), "success");
          emitChange({ userId: user.id, serverId: serverId, kicked: true });
        })
        .catch((e) => ui().error(e.message || NX.i18n.get("people.naoFoiPossivelExpulsar", "Não foi possível expulsar.")));
    });
  }

  function banFlow(serverId, user) {
    reasonModal({
      title: (NX.i18n.get("adm.banir", "Banir @")) + user.username,
      message: (NX.i18n.get("people.vocedesejabanir", "Você deseja banir @")) + user.username + (" " + NX.i18n.get("adm.desteservidor", "deste servidor?")),
      confirmLabel: (NX.i18n.get("adm.banir2", "Banir")),
      danger: true,
      icon: "lock",
      placeholder: NX.i18n.get("people.motivoOpcional2", "Motivo (opcional)"),
    }).then((reason) => {
      if (reason === null) return;
      api()
        .banMember(serverId, user.id, reason)
        .then(() => {
          ui().closePopout();
          ui().toast(user.displayName + (" " + NX.i18n.get("people.foibanidodoservidor", "foi banido do servidor.")), "success");
          emitChange({ userId: user.id, serverId: serverId, banned: true });
        })
        .catch((e) => ui().error(e.message || NX.i18n.get("people.naoFoiPossivelBanir", "Não foi possível banir.")));
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
        ("<span>" + NX.i18n.get("people.vocebloqueouesteusuario2", "Você bloqueou este usuário") + "</span></span>") +
        '<button class="btn btn--soft btn--sm" data-action="pp-unblock" data-id="' +
        h(user.id) +
        ("\">" + NX.i18n.get("page.desbloquear", "Desbloquear") + "</button>") +
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
        ? '<span class="pp-dmctl__flag">' + NX.icon("info", "", 14) + ("<span>" + NX.i18n.get("people.esteusuariobloqueouvoce2", "Este usuário bloqueou você") + "</span></span>")
        : "") +
      (dm && dm.muted
        ? '<span class="pp-dmctl__flag">' + NX.icon("bell", "", 14) + ("<span>" + NX.i18n.get("people.notificacoessilenciadas", "Notificações silenciadas") + "</span></span>")
        : "") +
      (theyBlocked
        ? ""
        : '<button class="icon-btn pp-dmctl__call" data-action="pp-call" data-id="' +
          h(user.id) +
          '" title="' + NX.i18n.get("people.ligar", "Ligar") + '" aria-label="' + NX.i18n.get("people.ligar", "Ligar") + '">' +
          NX.icon("phone", "", 18) +
          "</button>" +
          '<button class="icon-btn pp-dmctl__video" data-action="pp-video" data-id="' +
          h(user.id) +
          '" title="' + NX.i18n.get("people.ligarComVideo", "Ligar com vídeo") +
          '" aria-label="' + NX.i18n.get("people.ligarComVideo", "Ligar com vídeo") + '">' +
          NX.icon("video", "", 18) +
          "</button>") +
      '<button class="icon-btn" data-action="pp-dm-menu" data-dm="' +
      h(dmId) +
      '" data-user="' +
      h(user.id) +
      '" title="' + NX.i18n.get("ui.opcoesdaconversa", "Opções da conversa") + '" aria-label="' + NX.i18n.get("ui.people.opcoesdaconversa", "Opções da conversa") + '">' +
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
      img.onerror = () => reject(new Error(NX.i18n.get("people.naoFoiPossivelLer", "Não foi possível ler esta imagem.")));
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
      if (!ctx) throw new Error(NX.i18n.get("people.esteNavegadorNaoSuporta", "Este navegador não suporta o ajuste de imagens."));
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
      if (url.length > maxLen) throw new Error(NX.i18n.get("people.imagemContinuaGrandeDemais", "A imagem continua grande demais. Tente outra foto."));
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
      ui().error(NX.i18n.get("people.entreSuaContaEditar", "Entre na sua conta para editar o perfil."));
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
      /* gradiente do cartão: fica SÓ no cartão de perfil (nunca
         muda a interface do site) e preserva o restante do
         appearance que a pessoa configurou nas Configurações */
      appearanceOrig: me.appearance || null,
      cardGrad: Object.assign(
        { on: false, angle: 135, from: null, to: null },
        (me.appearance && me.appearance.card) || {}
      ),
      theme: me.theme === "light" ? "light" : me.theme === "dark" ? "dark" : "",
      /* emoji continua OPCIONAL e só entra se a pessoa escolher
         (dado antigo preservado; o editor não oferece mais o seletor) */
      avatarEmoji: (me.avatar && me.avatar.emoji) || null,
      avatarColor: (me.avatar && me.avatar.color) || u().colorFor(me.id),
      avatarImage: (me.avatar && me.avatar.image) || null,
      avatarSrc: null,
      avatarCrop: { x: 0, y: 0, zoom: 1 },
      /* BANNER DE PERFIL · gratuito para toda conta (sem assinatura,
         sem moedas, sem nível). `banner` guarda o valor completo
         { src, x, y, zoom }: imagem + enquadramento juntos. */
      banner: NX.banner.parse(me.banner),
      bannerDirty: false,
      tab: "foto",
    };

    const TABS = [
      { id: "foto", label: NX.i18n.get("people.foto", "Foto"), icon: "user" },
      { id: "banner", label: NX.i18n.get("adm.banner", "Banner"), icon: "image" },
      { id: "info", label: NX.i18n.get("people.informacoes", "Informações"), icon: "pencil" },
      { id: "status", label: (NX.i18n.get("modal.status", "Status")), icon: "smile" },
      { id: "theme", label: (NX.i18n.get("adm.aparencia", "Aparência")), icon: "palette" },
    ];

    const footer = u().el(
      '<div class="modal__actions">' +
        '<span class="spacer"></span>' +
        ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
        ("<button class=\"btn btn--primary\" type=\"button\" data-pp-save data-busy-label=\"Salvando\">" + NX.i18n.get("adm.salvarAlteracoes", "Salvar alterações") + "</button>") +
        "</div>"
    );

    const m = ui().modal({ title: NX.i18n.get("modal.editarPerfil2", "Editar perfil"), eyebrow: NX.i18n.get("modal.suaConta", "Sua conta"), size: "lg", footer: footer });
    m.el.classList.add("modal--pp-edit");

    /* ---------- blocos de HTML ---------- */
    /* O editor NÃO oferece emoji: sem seção "EMOJI" e sem seletor.
       Emoji continua normalmente em mensagens e reações — aqui a
       escolha é só foto (ou a logo oficial do Nexo). Contas antigas
       que já têm emoji guardam o dado; "Remover" devolve a logo. */

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
            '" aria-label="' + NX.i18n.get("ui.a11ycor", "Cor ") +
            c +
            '"></button>'
        ).join("") +
        "</div>"
      );
    }

    /* ---- a logo oficial do Nexo: única opção padrão ----
       Não existe galeria de modelos nem busca de imagem externa.
       Ou a pessoa usa a logo, ou envia uma foto do próprio aparelho. */
    function logoRow() {
      if (!window.NX || !NX.logo) return "";
      return (
        '<div class="field"><span class="field__label">' +
        NX.i18n.get("people.logodoNexo", "Logo do Nexo") +
        "</span>" +
        '<div class="pp-logo"><span class="pp-logo__mark">' + NX.logo.html() + "</span>" +
        '<span class="pp-logo__txt">' +
        NX.i18n.get("people.logoPadraoDeTodaConta", "Padrão de toda conta. Aparece quando você não tem foto — ou quando remove a sua.") +
        "</span></div></div>"
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

    /* estado de enquadramento de cada upload: a FOTO usa o próprio
       objeto do avatar, o BANNER usa o objeto do banner (o
       enquadramento vai junto com a imagem ao salvar) */
    function cropOf(kind) {
      if (kind === "banner") return st.banner || { x: 0, y: 0, zoom: 1 };
      return st.avatarCrop;
    }

    /* recorte/enquadramento: serve a foto e o banner */
    function cropBox(hint, kind) {
      kind = kind || "avatar";
      const c = cropOf(kind);
      return (
        '<div class="pp-crop pp-crop--' + kind + '" data-cropbox="' + kind + '" hidden>' +
        '<div class="pp-crop__frame"><img data-cropimg="' + kind + '" alt="' + NX.i18n.get("ui.previsualizacaodorecorte", "Pré-visualização do recorte") + '" /></div>' +
        '<div class="pp-crop__controls">' +
        rangeHTML(kind, "x", NX.i18n.get("people.posicaoHorizontal", "Posição horizontal"), -50, 50, 1, c.x) +
        rangeHTML(kind, "y", NX.i18n.get("people.posicaoVertical", "Posição vertical"), -50, 50, 1, c.y) +
        rangeHTML(kind, "zoom", NX.i18n.get("people.zoom", "Zoom"), 1, 3, 0.05, c.zoom) +
        "</div>" +
        '<div class="pp-crop__foot"><span>' +
        h(hint) +
        "</span>" +
        '<button type="button" class="btn btn--ghost btn--sm" data-cropreset="' + kind + '">' +
        NX.icon("refresh", "", 14) +
        ("<span>" + NX.i18n.get("people.reajustar", "Reajustar") + "</span></button></div>") +
        "</div>"
      );
    }

    function fotoPanel() {
      return (
        '<section class="pp-edit__panel" data-pppanel="foto">' +
        ("<h4 class=\"pp-edit__h\">" + NX.i18n.get("people.fotodeperfil", "Foto de perfil") + "</h4>") +
        ("<p class=\"pp-edit__p\">" + NX.i18n.get("people.logoOuFotoSua", "Sem foto, a logo oficial do Nexo aparece no seu lugar. Envie uma foto do seu aparelho quando quiser — o seletor de arquivos é o do seu dispositivo, sem busca na internet.") + "</p>") +
        logoRow() +
        '<div class="pp-photo">' +
        '<div class="pp-photo__preview" data-avatar-preview></div>' +
        '<div class="pp-photo__side">' +
        '<div class="pp-photo__btns">' +
        '<label class="btn btn--soft btn--sm">' +
        NX.icon("image", "", 15) +
        ("<span>" + NX.i18n.get("people.trocarfoto", "Trocar foto") + "</span>") +
        '<input type="file" accept="image/*" data-ppfile="avatar" class="sr-only" /></label>' +
        (st.avatarImage && !st.avatarSrc
          ? '<button type="button" class="btn btn--ghost btn--sm" data-ppavatar-adjust>' +
            NX.icon("pencil", "", 14) +
            ("<span>" + NX.i18n.get("people.ajustar", "Ajustar") + "</span></button>")
          : "") +
        (st.avatarImage || st.avatarSrc || st.avatarEmoji
          ? '<button type="button" class="btn btn--ghost btn--sm" data-ppavatar-remove>' +
            NX.icon("trash", "", 14) +
            ("<span>" + NX.i18n.get("modal.remover", "Remover") + "</span></button>")
          : "") +
        "</div>" +
        ("<span class=\"field__hint\">" + NX.i18n.get("people.dicaFotoSeuAparelho", "A foto é escolhida pelo seletor de arquivos do seu dispositivo. Não há busca de imagens na internet.") + "</span>") +
        "</div></div>" +
        cropBox(NX.i18n.get("people.arrasteControlesAteRosto", "Arraste os controles até o rosto ficar centralizado."), "avatar") +
        "</section>"
      );
    }

    /* ---- BANNER DE PERFIL ----
       Grátis para toda conta (sem assinatura, moedas ou nível).
       O arquivo vem do seletor do próprio aparelho: PNG, JPG, WebP
       ou GIF animado. O enquadramento é guardado JUNTO com a
       imagem, então sobrevive a F5 e a login em outro aparelho. */
    function bannerPanel() {
      const has = !!(st.banner && st.banner.src);
      return (
        '<section class="pp-edit__panel" data-pppanel="banner" hidden>' +
        ("<h4 class=\"pp-edit__h\">" + NX.i18n.get("people.bannerdoperfil", "Banner do perfil") + "</h4>") +
        ("<p class=\"pp-edit__p\">" +
          NX.i18n.get("people.bannerGratis", "Grátis para toda conta: não precisa de assinatura, moedas ou nível.") +
          " " +
          NX.i18n.get("people.bannerDesc", "A imagem aparece no topo do seu perfil público.") +
          "</p>") +
        '<div class="pp-banneredit">' +
        '<div class="pp-banneredit__preview" data-banner-preview>' +
        '<span class="pp-banneredit__grad"></span>' +
        "</div>" +
        '<div class="pp-photo__btns">' +
        '<label class="btn btn--soft btn--sm">' +
        NX.icon("image", "", 15) +
        ("<span>" +
          (has
            ? NX.i18n.get("people.trocarbanner", "Trocar banner")
            : NX.i18n.get("adm.enviarbanner", "Enviar banner")) +
          "</span>") +
        '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-ppfile="banner" class="sr-only" /></label>' +
        (has
          ? '<button type="button" class="btn btn--ghost btn--sm" data-ppbanner-adjust>' +
            NX.icon("pencil", "", 14) +
            ("<span>" + NX.i18n.get("people.ajustar", "Ajustar") + "</span></button>")
          : "") +
        (has
          ? '<button type="button" class="btn btn--ghost btn--sm" data-ppbanner-remove>' +
            NX.icon("trash", "", 14) +
            ("<span>" + NX.i18n.get("adm.removerbanner", "Remover banner") + "</span></button>")
          : "") +
        "</div>" +
        ("<span class=\"field__hint\">" +
          NX.i18n.get(
            "people.bannerFormats",
            "PNG, JPG, WebP ou GIF animado · até 1,4 MB · o GIF continua animado. O arquivo é escolhido pelo seletor do seu aparelho, sem busca na internet."
          ) +
          "</span>") +
        (has
          ? "<span class=\"field__hint\">" +
            NX.i18n.get("people.bannerSemBanner", "Sem banner, o fundo padrão do Nexo aparece no topo do perfil.") +
            "</span>"
          : "") +
        "</div>" +
        cropBox(
          NX.i18n.get(
            "people.bannerEnquadramento",
            "Arraste os controles até o enquadramento ficar do jeito que você quer."
          ),
          "banner"
        ) +
        "</section>"
      );
    }

    function infoPanel() {
      return (
        '<section class="pp-edit__panel" data-pppanel="info" hidden>' +
        ("<h4 class=\"pp-edit__h\">" + NX.i18n.get("people.informacoes", "Informações") + "</h4>") +
        ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("set.nomeExibicao", "Nome de exibição") + "</span>") +
        '<input class="input" data-ppfield="displayName" maxlength="32" value="' +
        h(st.displayName) +
        '" placeholder="' + NX.i18n.get("ui.comoaspessoastechamam", "Como as pessoas te chamam") + '" /></div>' +
        ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("set.nomeUsuario", "Nome de usuário") + "</span>") +
        '<div class="input-affix"><span class="input-affix__ico">@</span>' +
        '<input class="input" data-ppfield="username" maxlength="18" value="' +
        h(st.username) +
        '" /></div>' +
        ("<span class=\"field__hint\">" + NX.i18n.get("page.3a18caracteresletrasnumeros", "3 a 18 caracteres: letras, números, ponto e sublinhado.") + "</span></div>") +
        ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("modal.bio", "Bio") + " " + "<em data-ppcount>") +
        st.bio.length +
        "/190</em></span>" +
        '<textarea class="input input--area" data-ppfield="bio" rows="4" maxlength="190" placeholder="' + NX.i18n.get("ui.contequemevoceoquecurteedoquefazparte", "Conte quem é você, o que curte e do que faz parte.") + '">' +
        h(st.bio) +
        "</textarea></div>" +
        "</section>"
      );
    }

    function statusPanel() {
      return (
        '<section class="pp-edit__panel" data-pppanel="status" hidden>' +
        ("<h4 class=\"pp-edit__h\">" + NX.i18n.get("modal.status", "Status") + "</h4>") +
        ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("people.presenca", "Presença") + "</span>") +
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
        "</select>" +
        ("<p class=\"pp-edit__p\">" + NX.i18n.get("people.presencaSeparada", "A presença (Online, Ausente, Não perturbe, Invisível) é automática e diferente do seu status personalizado.") + "</p>") +
        "</div>" +
        ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("set.statusPersonalizado", "Status personalizado") + "</span>") +
        '<input class="input" data-ppfield="customStatus" maxlength="60" value="' +
        h(st.customStatus) +
        '" placeholder="' + NX.i18n.get("ui.statusPersonalizadoExemplo", "Ex.: Volto em alguns minutos") + '" /></div>' +
        ("<p class=\"pp-edit__p\">" + NX.i18n.get("people.ostatuspersonalizadoaparecenoseu", "O status personalizado aparece no seu cartão e ao seu lado na lista de membros.") + "</p>") +
        "</section>"
      );
    }

    function appearancePanel() {
      return (
        '<section class="pp-edit__panel" data-pppanel="theme" hidden>' +
        ("<h4 class=\"pp-edit__h\">" + NX.i18n.get("people.cordoperfil", "Cor do perfil") + "</h4>") +
        ("<p class=\"pp-edit__p\">" + NX.i18n.get("people.usadaNoCartaoEDestaques", "Usada no seu cartão, no cabeçalho do perfil e nos destaques.") + "</p>") +
        swatchRow(st.profileColor, "ppcolor") +
        '<div class="pp-customcolor">' +
        '<input type="color" class="pp-customcolor__pick" data-ppcolor-pick value="' + h(st.profileColor) + '" aria-label="' + h(NX.i18n.get("people.escolhaUmaCor", "Escolha uma cor")) + '" />' +
        '<input class="input mono pp-customcolor__hex" data-ppcolor-hex maxlength="7" value="' + h(st.profileColor) + '" spellcheck="false" placeholder="#35e0a8" aria-label="HEX" />' +
        '<button type="button" class="btn btn--soft btn--sm" data-ppcolor-reset>' + h(NX.i18n.get("people.restaurarCorPadrao", "Restaurar padrão")) + "</button>" +
        "</div>" +
        '<span class="field__hint" data-ppcolor-err hidden></span>' +
        '<div class="pp-edit__divider"></div>' +
        ("<h4 class=\"pp-edit__h\">" + NX.i18n.get("people.gradienteDoCartao", "Gradiente do cartão") + "</h4>") +
        ("<p class=\"pp-edit__p\">" + NX.i18n.get("people.gradienteHint", "Usado atrás do cabeçalho do seu perfil quando você não tem banner próprio. Fica só no cartão — a interface do site não muda.") + "</p>") +
        '<div class="pp-gradrow">' +
        '<label class="check"><input type="checkbox" data-ppgrad-on' +
        (st.cardGrad.on ? " checked" : "") +
        ' /><span class="check__box"></span>' +
        h(NX.i18n.get("people.ativarGradiente", "Ativar gradiente")) +
        "</label></div>" +
        '<div class="pp-gradrow" data-ppgrad-row' +
        (st.cardGrad.on ? "" : " hidden") +
        ">" +
        ("<span class=\"field__label\">" + NX.i18n.get("people.corInicial", "Cor inicial") + "</span>") +
        '<input type="color" class="pp-customcolor__pick" data-ppgrad-from value="' + h(st.cardGrad.from || st.profileColor) + '" aria-label="' + h(NX.i18n.get("people.corInicial", "Cor inicial")) + '" />' +
        ("<span class=\"field__label\">" + NX.i18n.get("people.corFinal", "Cor final") + "</span>") +
        '<input type="color" class="pp-customcolor__pick" data-ppgrad-to value="' + h(st.cardGrad.to || "#8f83ff") + '" aria-label="' + h(NX.i18n.get("people.corFinal", "Cor final")) + '" />' +
        ("<span class=\"field__label\">" + NX.i18n.get("people.angulo", "Ângulo") + " <em data-ppgrad-angleval>" + (Number(st.cardGrad.angle) || 0) + "°</em></span>") +
        '<input type="range" class="range" min="0" max="360" step="1" value="' + (Number(st.cardGrad.angle) || 0) + '" data-ppgrad-angle aria-label="' + h(NX.i18n.get("people.angulo", "Ângulo")) + '" />' +
        "</div>" +
        '<div class="pp-edit__divider"></div>' +
        ("<h4 class=\"pp-edit__h\">" + NX.i18n.get("people.tema", "Tema") + "</h4>") +
        '<div class="pp-seg" role="group" aria-label="' + NX.i18n.get("ui.temadainterface", "Tema da interface") + '">' +
        [
          { v: "", l: (NX.i18n.get("people.padrao", "Padrão")) },
          { v: "light", l: (NX.i18n.get("adm.claro", "Claro")) },
          { v: "dark", l: (NX.i18n.get("people.escuro", "Escuro")) },
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
        ("<p class=\"pp-edit__p\">" + NX.i18n.get("people.padraoacompanhaapreferenciadoseu", "Padrão acompanha a preferência do seu sistema.") + "</p>") +
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
        '<div class="pp-preview__status"><span class="status-pill" data-status="online" data-pv-pill>' + NX.i18n.get("people.online", "Online") + '</span>' +
        '<span class="pp-preview__custom" data-pv-custom></span></div>' +
        '<p class="pp-preview__bio" data-pv-bio></p>' +
        "</div></div>"
      );
    }

    m.body.innerHTML =
      '<div class="pp-edit">' +
      '<aside class="pp-edit__side">' +
      ("<span class=\"pp-edit__sidelabel\">" + NX.i18n.get("people.previsualizacao", "Pré-visualização") + "</span>") +
      previewHTML() +
      ("<p class=\"pp-edit__hint\">" + NX.i18n.get("people.eassimquesuacontaaparece", "É assim que sua conta aparece para as pessoas.") + "</p>") +
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
      if (id === "banner") paintBannerPreview();
    }

    /* aplica a imagem + enquadramento nas duas pré-visualizações:
       a do cartão lateral e a da própria aba de banner */
    function paintBannerPreview() {
      const pv = body.querySelector("[data-preview]");
      if (pv) {
        const bn = pv.querySelector("[data-pv-banner]");
        if (bn) NX.banner.paint(bn, st.banner);
      }
      const ed = body.querySelector("[data-banner-preview]");
      if (ed) NX.banner.paint(ed, st.banner);
    }

    function cropTransform(kind) {
      const c = cropOf(kind || "avatar");
      return "translate(" + c.x + "%, " + c.y + "%) scale(" + (c.zoom || 1) + ")";
    }

    function applyCrop(kind) {
      kind = kind || "avatar";
      const c = cropOf(kind);
      const img = body.querySelector('[data-cropimg="' + kind + '"]');
      if (img) img.style.transform = cropTransform(kind);
      ["x", "y", "zoom"].forEach((axis) => {
        const out = body.querySelector('[data-out="' + kind + "-" + axis + '"]');
        if (!out) return;
        out.textContent = axis === "zoom" ? Number(c[axis]).toFixed(2).replace(".", ",") + "×" : c[axis] + "%";
      });
      if (kind === "banner") paintBannerPreview();
    }

    function showCrop(kind) {
      kind = kind || "avatar";
      const box = body.querySelector('[data-cropbox="' + kind + '"]');
      if (!box) return;
      const src = kind === "banner" ? (st.banner && st.banner.src) : st.avatarSrc;
      const img = box.querySelector("[data-cropimg]");
      if (img && src) img.src = src;
      box.hidden = false;
      const c = cropOf(kind);
      ["x", "y", "zoom"].forEach((axis) => {
        const r = box.querySelector('[data-range="' + kind + '"][data-axis="' + axis + '"]');
        if (r) r.value = c[axis];
      });
      applyCrop(kind);
      const prev = body.querySelector(
        kind === "banner" ? "[data-banner-preview]" : "[data-avatar-preview]"
      );
      if (prev) prev.hidden = true;
    }

    function hideCrop(kind) {
      kind = kind || "avatar";
      const box = body.querySelector('[data-cropbox="' + kind + '"]');
      if (box) box.hidden = true;
      const prev = body.querySelector(
        kind === "banner" ? "[data-banner-preview]" : "[data-avatar-preview]"
      );
      if (prev) prev.hidden = false;
      if (kind === "banner") paintBannerPreview();
    }

    function renderAvatarPreview() {
      const box = body.querySelector("[data-avatar-preview]");
      if (!box) return;
      if (st.avatarSrc) {
        box.hidden = true;
        showCrop();
        return;
      }
      box.hidden = false;
      box.innerHTML = avatarHTML(previewUser(), "xl", false);
    }

    /* usuário sintético só para o preview: nenhuma troca aqui é salva
       antes do botão "Salvar alterações" */
    function previewUser() {
      return {
        id: me.id,
        displayName: st.displayName,
        username: st.username,
        avatar: {
          emoji: st.avatarEmoji,
          color: st.avatarColor,
          image: st.avatarImage,
        },
        status: st.status,
      };
    }

    function refresh() {
      const pv = body.querySelector("[data-preview]");
      if (!pv) return;
      pv.style.setProperty("--pc", st.profileColor);

      /* gradiente do cartão na prévia (tempo real) */
      const pvb = pv.querySelector("[data-pv-banner]");
      if (pvb) {
        const g = st.cardGrad;
        if (g.on && g.from && g.to) {
          pvb.classList.add("is-custom");
          pvb.style.setProperty(
            "--pcg",
            "linear-gradient(" + (Number(g.angle) || 0) + "deg, " + g.from + ", " + g.to + ")"
          );
        } else {
          pvb.classList.remove("is-custom");
          pvb.style.removeProperty("--pcg");
        }
      }

      const av = pv.querySelector("[data-pv-avatar]");
      if (av) av.innerHTML = avatarHTML(previewUser(), "lg", false);

      const name = pv.querySelector("[data-pv-name]");
      if (name) name.textContent = st.displayName.trim() || NX.i18n.get("people.seuNome", "Seu nome");
      const usr = pv.querySelector("[data-pv-user]");
      if (usr) usr.textContent = "@" + (st.username.trim() || "usuario");

      const pill = pv.querySelector("[data-pv-pill]");
      if (pill) {
        pill.setAttribute("data-status", st.status);
        pill.textContent = NX.STATUS_LABEL[st.status] || NX.i18n.get("core.statusOffline", "Offline");
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
      if (bio) bio.textContent = st.bio || NX.i18n.get("people.suaBioApareceAqui", "Sua bio aparece aqui.");

      paintBannerPreview();
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

    /* ---------- leitura de arquivo ----------
       Foto e banner vêm do seletor do próprio dispositivo — não há
       busca de imagem na internet. */
    function handleFile(input) {
      const kind = input.getAttribute("data-ppfile") || "avatar";
      const file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      if (kind === "banner") {
        handleBannerFile(file);
        return;
      }

      if (!/^image\//.test(file.type)) {
        ui().error(NX.i18n.get("people.escolhaArquivoImagemJpg", "Escolha um arquivo de imagem (JPG, PNG ou WebP)."));
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        ui().error(NX.i18n.get("people.estaImagemGrandeDemais", "Esta imagem é grande demais. Use uma com até 8 MB."));
        return;
      }
      const fr = new FileReader();
      fr.onload = () => {
        const src = String(fr.result || "");
        loadImage(src)
          .then(() => {
            st.avatarSrc = src;
            st.avatarCrop = { x: 0, y: 0, zoom: 1 };
            renderPanel("foto");
            renderAvatarPreview();
            showCrop();
            showErr("");
            refresh();
          })
          .catch((e) => ui().error(e.message));
      };
      fr.onerror = () => ui().error(NX.i18n.get("adm.naoFoiPossivelLer", "Não foi possível ler este arquivo."));
      fr.readAsDataURL(file);
    }

    /* ---- BANNER · prepara o arquivo no tamanho que o banco aceita ----
       Imagem estática: desenha num canvas, reduz para no máximo
       1600px de largura e cai para JPEG só se passar do limite.
       GIF: NUNCA é refeito — reencodar mataria a animação, então ele
       segue como veio e é o servidor que diz se cabe. */
    function shrinkBanner(src) {
      return loadImage(src).then((img) => {
        const MAXCH = NX.banner.limits.imageChars;
        const MAXW = 1600;
        const iw = img.naturalWidth || img.width || 0;
        const ih = img.naturalHeight || img.height || 0;
        if (!iw || !ih) return src;
        if (src.length <= MAXCH && iw <= MAXW) return src;
        const scale = Math.min(1, MAXW / iw);
        const w = Math.max(1, Math.round(iw * scale));
        const hh = Math.max(1, Math.round(ih * scale));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = hh;
        const ctx = c.getContext("2d");
        if (!ctx) return src;
        /* fundo do Nexo: evita preto esquisito em PNG com transparência */
        ctx.fillStyle = "#0d1416";
        ctx.fillRect(0, 0, w, hh);
        ctx.drawImage(img, 0, 0, w, hh);
        let out = "";
        try {
          out = c.toDataURL("image/png");
        } catch (e) {
          out = "";
        }
        if (out && out.length <= MAXCH * 0.8) return out;
        const qualities = [0.86, 0.75, 0.62, 0.5];
        for (let i = 0; i < qualities.length; i++) {
          try {
            out = c.toDataURL("image/jpeg", qualities[i]);
          } catch (e2) {
            out = "";
          }
          if (out && out.length <= MAXCH) return out;
        }
        return out || src;
      });
    }

    function handleBannerFile(file) {
      const type = String(file.type || "").toLowerCase();
      if (!/^image\/(png|jpe?g|gif|webp)$/.test(type)) {
        ui().error(
          NX.i18n.get(
            "people.bannerArquivoInvalido",
            "Escolha um arquivo de imagem: PNG, JPG, WebP ou GIF."
          )
        );
        return;
      }
      if (file.size > 9 * 1024 * 1024) {
        ui().error(
          NX.i18n.get("people.bannerGrandeDemais", "Este arquivo é grande demais. Use uma imagem de até 1,4 MB.")
        );
        return;
      }
      const fr = new FileReader();
      fr.onload = () => {
        const src = String(fr.result || "");
        const isGif = type === "image/gif";
        const ready = (dataUrl) => {
          const err = NX.banner.validate(dataUrl);
          if (err) {
            ui().error(err);
            return;
          }
          loadImage(dataUrl)
            .then(() => {
              st.banner = { src: dataUrl, x: 0, y: 0, zoom: 1 };
              st.bannerDirty = true;
              renderPanel("banner");
              showCrop("banner");
              showErr("");
              refresh();
            })
            .catch((e) => ui().error(e.message));
        };
        if (isGif) {
          /* GIF animado: preserva o arquivo original */
          ready(src);
          return;
        }
        shrinkBanner(src)
          .then(ready)
          .catch(() => ready(src));
      };
      fr.onerror = () => ui().error(NX.i18n.get("adm.naoFoiPossivelLer", "Não foi possível ler este arquivo."));
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
        /* seletor de emoji do avatar foi removido do editor */
        e.preventDefault();
        return;
      }

      const pc = e.target.closest("[data-ppcolor]");
      if (pc) {
        st.profileColor = pc.getAttribute("data-ppcolor");
        renderPanel("theme");
        refresh();
        return;
      }

      if (e.target.closest("[data-ppcolor-reset]")) {
        /* restaurar a cor padrão: a cor derivada do avatar/conta */
        st.profileColor = (me.avatar && me.avatar.color) || u().colorFor(me.id);
        renderPanel("theme");
        refresh();
        return;
      }

      const th = e.target.closest("[data-pp-theme]");
      if (th) {
        st.theme = th.getAttribute("data-pp-theme");
        renderPanel("theme");
        return;
      }

      if (e.target.closest("[data-ppbanner-remove]")) {
        /* remover o banner devolve o fundo padrão do Nexo — nada é
           apagado do perfil da outra pessoa, só deste campo */
        st.banner = null;
        st.bannerDirty = true;
        hideCrop("banner");
        renderPanel("banner");
        showErr("");
        refresh();
        return;
      }

      if (e.target.closest("[data-ppbanner-adjust]") && st.banner) {
        renderPanel("banner");
        showCrop("banner");
        return;
      }

      if (e.target.closest("[data-ppavatar-remove]")) {
        /* remover a foto volta a conta para a LOGO oficial do Nexo
           (emoji também volta ao padrão, senão a pessoa nunca mais
           veria a logo depois de ter tocado num emoji) */
        st.avatarImage = null;
        st.avatarSrc = null;
        st.avatarEmoji = null;
        st.avatarCrop = { x: 0, y: 0, zoom: 1 };
        hideCrop();
        renderPanel("foto");
        renderAvatarPreview();
        refresh();
        return;
      }

      if (e.target.closest("[data-ppavatar-adjust]") && st.avatarImage) {
        st.avatarSrc = st.avatarImage;
        st.avatarCrop = { x: 0, y: 0, zoom: 1 };
        renderPanel("foto");
        showCrop();
        return;
      }

      const reset = e.target.closest("[data-cropreset]");
      if (reset) {
        const kind = reset.getAttribute("data-cropreset") || "avatar";
        if (kind === "banner") {
          if (!st.banner) return;
          st.banner.x = 0;
          st.banner.y = 0;
          st.banner.zoom = 1;
          st.bannerDirty = true;
        } else {
          st.avatarCrop.x = 0;
          st.avatarCrop.y = 0;
          st.avatarCrop.zoom = 1;
        }
        const c = cropOf(kind);
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
        const kind = range.getAttribute("data-range") || "avatar";
        const axis = range.getAttribute("data-axis");
        if (kind === "banner") {
          if (!st.banner) return;
          st.banner[axis] = Number(range.value);
          st.bannerDirty = true;
        } else {
          st.avatarCrop[axis] = Number(range.value);
        }
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

    /* ---------- aparência: cor com HEX + gradiente do cartão ---------- */
    function hexOk(v) {
      return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim());
    }
    function setHexErr(msg) {
      const el = body.querySelector("[data-ppcolor-err]");
      if (!el) return;
      el.textContent = msg || "";
      el.hidden = !msg;
    }
    body.addEventListener("input", (e) => {
      const t = e.target;
      if (!t || !t.matches) return;
      if (t.matches("[data-ppcolor-pick]")) {
        st.profileColor = t.value;
        setHexErr("");
        const hexIn = body.querySelector("[data-ppcolor-hex]");
        if (hexIn) hexIn.value = t.value;
        refresh();
        return;
      }
      if (t.matches("[data-ppcolor-hex]")) {
        const v = t.value.trim();
        if (hexOk(v)) {
          st.profileColor = v.toLowerCase();
          setHexErr("");
          const pick = body.querySelector("[data-ppcolor-pick]");
          if (pick) pick.value = v;
          refresh();
        } else {
          setHexErr(NX.i18n.get("people.hexInvalido", "Use um código HEX como #35e0a8."));
        }
        return;
      }
      if (t.matches("[data-ppgrad-from]")) {
        st.cardGrad.from = t.value;
        refresh();
        return;
      }
      if (t.matches("[data-ppgrad-to]")) {
        st.cardGrad.to = t.value;
        refresh();
        return;
      }
      if (t.matches("[data-ppgrad-angle]")) {
        st.cardGrad.angle = Number(t.value) || 0;
        const ang = body.querySelector("[data-ppgrad-angleval]");
        if (ang) ang.textContent = st.cardGrad.angle + "°";
        refresh();
      }
    });
    body.addEventListener("change", (e) => {
      const t = e.target;
      if (!t || !t.matches) return;
      if (t.matches("[data-ppgrad-on]")) {
        st.cardGrad.on = !!t.checked;
        if (st.cardGrad.on) {
          if (!st.cardGrad.from) st.cardGrad.from = st.profileColor;
          if (!st.cardGrad.to) st.cardGrad.to = "#8f83ff";
        }
        const row = body.querySelector("[data-ppgrad-row]");
        if (row) row.hidden = !st.cardGrad.on;
        const fromIn = body.querySelector("[data-ppgrad-from]");
        if (fromIn) fromIn.value = st.cardGrad.from || st.profileColor;
        const toIn = body.querySelector("[data-ppgrad-to]");
        if (toIn) toIn.value = st.cardGrad.to || "#8f83ff";
        refresh();
        return;
      }
      if (t.matches("[data-ppcolor-hex]") && hexOk(t.value)) {
        st.profileColor = t.value.trim().toLowerCase();
        setHexErr("");
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
        /* preserva accent/grad/etc. das Configurações e só troca o
           cartão — o servidor valida cada campo (sanitizeAppearance) */
        appearance: Object.assign({}, st.appearanceOrig || {}, {
          card: {
            on: !!st.cardGrad.on,
            angle: Number(st.cardGrad.angle) || 0,
            from: st.cardGrad.from || null,
            to: st.cardGrad.to || null,
          },
        }),
        theme: st.theme,
        avatar: {
          emoji: st.avatarEmoji || null,
          color: st.avatarColor,
          image: st.avatarImage,
        },
      };

      const failLocal = (msg) => {
        showErr(msg);
        ui().error(msg);
      };

      if (String(patch.displayName).trim().length < 2) {
        failLocal(NX.i18n.get("api.digiteNomePeloMenos", "Digite um nome com pelo menos 2 caracteres."));
        setTab("info");
        return;
      }
      if (!u().usernameOk(patch.username)) {
        failLocal(NX.i18n.get("people.nomeUsuarioPrecisa3", "Nome de usuário precisa de 3 a 18 caracteres (letras, números, . e _)."));
        setTab("info");
        return;
      }

      /* banner: só escreve se a pessoa mexeu nele (nada de regravar
         a conta inteira a cada "Salvar alterações") */
      if (st.bannerDirty) {
        const berr = st.banner ? NX.banner.validate(st.banner) : null;
        if (berr) {
          failLocal(berr);
          setTab("banner");
          return;
        }
        patch.banner = st.banner
          ? {
              src: st.banner.src,
              x: st.banner.x,
              y: st.banner.y,
              zoom: st.banner.zoom,
            }
          : null;
      }

      const btn = footer.querySelector("[data-pp-save]");
      const done = ui().busy(btn);

      Promise.resolve(st.avatarSrc ? cropImage(st.avatarSrc, st.avatarCrop, 256, 256, 900000) : Promise.resolve(st.avatarImage))
        .then((out) => {
          patch.avatar.image = out || null;
          return api().updateProfile(patch);
        })
        .then(() => {
          st.bannerDirty = false;
          try {
            NX.applyTheme(themeValue(st.theme));
          } catch (e) {
            /* tema é melhor esforço */
          }
          done();
          m.close();
          ui().toast(NX.i18n.get("modal.perfilAtualizado", "Perfil atualizado."), "success");
          emitChange({ userId: me.id, updated: true });
        })
        .catch((e) => {
          done();
          const msg = (e && e.message) || NX.i18n.get("people.naoFoiPossivelSalvar", "Não foi possível salvar as alterações.");
          showErr(msg);
          ui().error(msg);
        });
    });

    /* ---------- estado inicial ---------- */
    renderPanel("foto");
    renderPanel("info");
    renderPanel("status");
    renderPanel("theme");
    setTab("foto");
    renderAvatarPreview();
    refresh();

    return m;
  };

  /* =========================================================
     AÇÕES (prefixo pp-)
     ========================================================= */
  PP["pp-copy-id"] = (el) => copyPublicId(el.getAttribute("data-id"));
  PP["pp-message"] = (el) => startDM(el.getAttribute("data-id"));

  /* ---- chamada de áudio/vídeo: só o módulo real js/call.js ----
     (nada de simular chamada — sem módulo, o botão avisa) */
  function startCallWith(userId, withVideo) {
    const me = S().me();
    const other = S().user(userId);
    if (!me || !other || other.id === me.id) return;
    if (!NX.call || typeof NX.call.start !== "function") {
      ui().error(NX.i18n.get("call.indisponivel", "As chamadas ainda não estão disponíveis."));
      return;
    }
    if (S().isBlocked(me.id, other.id) || S().isBlocked(other.id, me.id)) {
      ui().error(NX.i18n.get("people.bloqueioImpedeAcao3", "Você não pode interagir com esta pessoa."));
      return;
    }
    /* entra pela prévia (lobby) quando existe: o usuário escolhe
       microfone/câmera antes de gastar a chamada do outro */
    const opts = { video: !!withVideo };
    const task =
      NX.call && typeof NX.call.preview === "function"
        ? NX.call.preview(other.id, opts)
        : NX.call.start(other.id, opts);
    Promise.resolve(task).catch((e) =>
      ui().error((e && e.message) || NX.i18n.get("call.naoFoiPossivelIniciar", "Não foi possível iniciar a chamada."))
    );
  }
  PP["pp-call"] = (el) => startCallWith(el.getAttribute("data-id"), false);
  PP["pp-video"] = (el) => startCallWith(el.getAttribute("data-id"), true);
  people.startCall = startCallWith;
  PP["pp-view-profile"] = (el) => go("#/perfil/" + el.getAttribute("data-id"));
  PP["pp-edit-profile"] = () => people.editProfileModal();

  /* ---- estatísticas do perfil (seguidores / curtidas) ---- */
  PP["pp-followers"] = (el) => {
    const id = el.getAttribute("data-id");
    const me = S().me();
    if (!S().canViewFollowersOf(me ? me.id : null, id)) {
      ui().error(NX.i18n.get("people.estaPessoaMantemLista", "Esta pessoa mantém a lista de seguidores dela privada."));
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
      ui().error(NX.i18n.get("api.estaPessoaMantemCurtidas", "Esta pessoa mantém as curtidas dela privadas."));
      return;
    }
    if (NX.social && typeof NX.social.openLikes === "function") NX.social.openLikes(id);
  };

  /* ---- amizade ---- */
  function pendingRequestWith(otherId) {
    const me = S().me();
    return me ? S().friendRequestBetween(me.id, otherId) : null;
  }

  const friendFail = (e) => ui().error((e && e.message) || NX.i18n.get("people.naoFoiPossivelConcluir", "Não foi possível concluir."));

  PP["pp-add-friend"] = (el) => {
    api()
      .sendFriendRequest(el.getAttribute("data-id"))
      .then(() => {
        if (NX.sfx && NX.sfx.play) NX.sfx.play("friend_request");
        ui().toast(NX.i18n.get("people.solicitacaoAmizadeEnviada", "Pedido de amizade enviado!"), "success");
      })
      .catch(friendFail);
  };

  PP["pp-accept-friend"] = (el) => {
    const id = el.getAttribute("data-id");
    const req = pendingRequestWith(id);
    if (!req) {
      ui().error(NX.i18n.get("api.estaSolicitacaoAmizadeNao3", "Esta solicitação de amizade não existe mais."));
      return;
    }
    api()
      .acceptFriendRequest(req.id)
      .then((res) => {
        const who = (res && res.user) || S().user(id);
        if (NX.sfx && NX.sfx.play) NX.sfx.play("friend_accept");
        ui().toast(
          (NX.i18n.get("api.agoravocee", "Agora você e @")) + (who ? who.username : NX.i18n.get("people.essaPessoa", "essa pessoa")) + (" " + NX.i18n.get("api.saoamigos", "são amigos!")),
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
      .then(() => ui().toast(NX.i18n.get("people.solicitacaoRecusada", "Solicitação recusada."), "info"))
      .catch(friendFail);
  };

  PP["pp-cancel-friend"] = (el) => {
    const id = el.getAttribute("data-id");
    const other = S().user(id);
    const req = pendingRequestWith(id);
    if (!req) return;
    api()
      .cancelFriendRequest(req.id)
      .then(() => ui().toast(NX.i18n.get("people.solicitacaoCancelada", "Solicitação cancelada") + (other ? (" " + NX.i18n.get("people.para", "para @")) + other.username : "") + ".", "info"))
      .catch(friendFail);
  };

  PP["pp-remove-friend"] = async (el) => {
    const id = el.getAttribute("data-id");
    const other = S().user(id);
    if (!other) return;
    const ok = await ui().confirm({
      title: NX.i18n.get("page.removerAmigo", "Remover amigo"),
      message: (NX.i18n.get("people.temcertezaquedesejaremover", "Tem certeza que deseja remover @")) + other.username + (" " + NX.i18n.get("people.dosseusamigos", "dos seus amigos?")),
      confirmLabel: (NX.i18n.get("modal.remover", "Remover")),
      icon: "alert",
    });
    if (!ok) return;
    api()
      .removeFriend(id)
      .then(() => ui().toast("@" + other.username + (" " + NX.i18n.get("people.naoemaisseuamigo", "não é mais seu amigo.")), "info"))
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

  /* itens de amizade dos menus "⋯" — sempre conforme o estado real
     (amizade, pedido enviado/recebido ou bloqueio) */
  function friendMenuItems(user) {
    const me = S().me();
    if (!user || !me || user.id === me.id) return [];
    if (S().isBlocked(me.id, user.id)) return [];
    const stub = { getAttribute: () => user.id };
    const st = S().friendState(me.id, user.id);
    if (st === "friends")
      return [
        {
          label: NX.i18n.get("page.removerAmigo", "Remover amigo"),
          icon: "trash",
          danger: true,
          onClick: () => PP["pp-remove-friend"](stub),
        },
      ];
    if (st === "sent")
      return [
        { label: NX.i18n.get("people.cancelarPedidoAmizade", "Cancelar pedido de amizade"), icon: "x", onClick: () => PP["pp-cancel-friend"](stub) },
      ];
    if (st === "received")
      return [
        { label: NX.i18n.get("people.aceitarPedidoAmizade", "Aceitar pedido de amizade"), icon: "check", onClick: () => PP["pp-accept-friend"](stub) },
      ];
    if (!S().canSendFriendRequest(me.id, user.id).ok) return [];
    return [
      { label: NX.i18n.get("people.adicionarAmigo", "Adicionar amigo"), icon: "userPlus", onClick: () => PP["pp-add-friend"](stub) },
    ];
  }

  PP["pp-profile-menu"] = (el) => {
    const userId = el.getAttribute("data-id");
    const user = S().user(userId);
    const me = S().me();
    if (!user || !me) return;
    const blocked = S().isBlocked(me.id, userId);
    const items = [
      { label: NX.i18n.get("adm.verPerfil", "Ver perfil"), icon: "user", onClick: () => go("#/perfil/" + userId) },
      { label: (NX.i18n.get("modal.mensagem", "Mensagem")), icon: "chat", onClick: () => startDM(userId) },
    ];
    if (userId !== me.id && !blocked)
      items.push({ label: NX.i18n.get("people.ligar", "Ligar"), icon: "phone", onClick: () => startCallWith(userId, false) });
      items.push({ label: NX.i18n.get("people.ligarComVideo", "Ligar com vídeo"), icon: "video", onClick: () => startCallWith(userId, true) });
    items.push({ label: NX.i18n.get("people.copiarId2", "Copiar ID"), icon: "copy", onClick: () => copyId(userId) });
    const friendItems = friendMenuItems(user);
    if (friendItems.length) {
      items.push({ divider: true });
      friendItems.forEach((it) => items.push(it));
    }
    items.push(
      { divider: true },
      blocked
        ? { label: (NX.i18n.get("page.desbloquear", "Desbloquear")), icon: "lock", onClick: () => unblockUser(user) }
        : { label: (NX.i18n.get("page.bloquear", "Bloquear")), icon: "lock", danger: true, onClick: () => blockUser(user) },
      { label: (NX.i18n.get("chat.denunciar", "Denunciar")), icon: "alert", danger: true, onClick: () => reportModal(user) }
    );
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
      { label: NX.i18n.get("adm.verPerfil", "Ver perfil"), icon: "user", onClick: () => go("#/perfil/" + userId) },
      { label: NX.i18n.get("people.copiarId2", "Copiar ID"), icon: "copy", onClick: () => copyId(userId) },
    ];
    if (!isMe) items.splice(1, 0, { label: (NX.i18n.get("modal.mensagem", "Mensagem")), icon: "chat", onClick: () => startDM(userId) });
    if (!isMe && !blocked && (!server || S().can(serverId, me.id, "viewChannels")))
      items.push({ label: NX.i18n.get("people.ligar", "Ligar"), icon: "phone", onClick: () => startCallWith(userId, false) });
      items.push({ label: NX.i18n.get("people.ligarComVideo", "Ligar com vídeo"), icon: "video", onClick: () => startCallWith(userId, true) });

    const admin = [];
    if (!isMe && !isOwner) {
      if (S().can(serverId, me.id, "manageRoles"))
        admin.push({ label: NX.i18n.get("people.adicionarCargo", "Adicionar cargo"), icon: "shield", onClick: () => roleModal(serverId, userId) });
      if (S().can(serverId, me.id, "kickMembers"))
        admin.push({ label: (NX.i18n.get("adm.expulsar2", "Expulsar")), icon: "logout", danger: true, onClick: () => kickFlow(serverId, user) });
      if (S().can(serverId, me.id, "banMembers"))
        admin.push({ label: (NX.i18n.get("adm.banir2", "Banir")), icon: "lock", danger: true, onClick: () => banFlow(serverId, user) });
    }
    if (admin.length) {
      items.push({ divider: true });
      admin.forEach((it) => items.push(it));
    }

    if (!isMe) {
      items.push({ divider: true });
      items.push(
        blocked
          ? { label: (NX.i18n.get("page.desbloquear", "Desbloquear")), icon: "lock", onClick: () => unblockUser(user) }
          : { label: (NX.i18n.get("page.bloquear", "Bloquear")), icon: "lock", danger: true, onClick: () => blockUser(user) }
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
      { label: NX.i18n.get("adm.verPerfil", "Ver perfil"), icon: "user", onClick: () => go("#/perfil/" + userId) },
    ];
    if (!blocked)
      items.push({ label: NX.i18n.get("people.ligar", "Ligar"), icon: "phone", onClick: () => startCallWith(userId, false) });
      items.push({ label: NX.i18n.get("people.ligarComVideo", "Ligar com vídeo"), icon: "video", onClick: () => startCallWith(userId, true) });
    items.push(
      {
        label: muted ? NX.i18n.get("people.ativarNotificacoes", "Ativar notificações") : (NX.i18n.get("people.silenciar", "Silenciar")),
        icon: "bell",
        onClick: () => {
          if (!dm) {
            ui().error(NX.i18n.get("api.conversaNaoEncontrada3", "Conversa não encontrada."));
            return;
          }
          api()
            .muteDM(dmId, !muted)
            .then(() => {
              ui().toast(muted ? NX.i18n.get("people.notificacoesAtivadas", "Notificações ativadas.") : NX.i18n.get("people.conversaSilenciada", "Conversa silenciada."), "success");
              emitChange({ dmId: dmId, muted: !muted });
            })
            .catch((e) => ui().error(e.message || NX.i18n.get("people.naoFoiPossivelAlterar3", "Não foi possível alterar as notificações.")));
        },
      },
      { divider: true },
      blocked
        ? { label: (NX.i18n.get("page.desbloquear", "Desbloquear")), icon: "lock", onClick: () => unblockUser(user) }
        : { label: (NX.i18n.get("page.bloquear", "Bloquear")), icon: "lock", danger: true, onClick: () => blockUser(user) },
      { label: (NX.i18n.get("chat.denunciar", "Denunciar")), icon: "alert", danger: true, onClick: () => reportModal(user) },
    );
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
        ui().error(NX.i18n.get("app.algoDeuErradoExecutar", "Algo deu errado ao executar esta ação."));
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
