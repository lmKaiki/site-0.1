/* ============================================================
   NEXO · modais e menus
   Diálogos de servidores, canais, categorias, cargos,
   permissões, convites, membros e perfil + menus suspensos.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const u = () => NX.util;
  const S = () => NX.selectors;
  const api = () => NX.api;
  const M = {};

  const ACTIONS = (m) => '<div class="modal__actions">' + m + "</div>";

  function swatches(selected, attr) {
    return (
      '<div class="swatch-row" data-swatches>' +
      u().PALETTE.map(
        (c) =>
          '<button type="button" class="swatch' + (c === selected ? " is-on" : "") +
          '" style="--sw:' + c + '" data-' + attr + '="' + c + '" aria-label="Cor ' + c + '"></button>'
      ).join("") +
      "</div>"
    );
  }

  function emojiGrid(selected) {
    return (
      '<div class="emoji-grid emoji-grid--sm">' +
      Array.from(new Set(u().EMOJIS))
        .map(
          (e) =>
            '<button type="button" class="emoji-grid__item' + (e === selected ? " is-on" : "") +
            '" data-pick-emoji="' + u().h(e) + '">' + e + "</button>"
        )
        .join("") +
      "</div>"
    );
  }

  function bindPickers(root, state) {
    root.addEventListener("click", (e) => {
      const em = e.target.closest("[data-pick-emoji]");
      if (em) {
        state.emoji = em.getAttribute("data-pick-emoji");
        u().qa("[data-pick-emoji]", root).forEach((b) => b.classList.toggle("is-on", b === em));
        if (state.onPick) state.onPick();
      }
      const co = e.target.closest("[data-pick-color]");
      if (co) {
        state.color = co.getAttribute("data-pick-color");
        u().qa("[data-pick-color]", root).forEach((b) => b.classList.toggle("is-on", b === co));
        if (state.onPick) state.onPick();
      }
    });
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function showErr(form, msg) {
    const box = form.querySelector("[data-error]");
    if (!box) return;
    if (!msg) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML = NX.icon("alert", "", 16) + "<span>" + u().h(msg) + "</span>";
  }

  function runTask(btn, task, form, onDone) {
    const end = NX.ui.busy(btn);
    task
      .then((res) => {
        end();
        if (onDone) onDone(res);
      })
      .catch((e) => {
        end();
        if (e && e.message) showErr(form, e.message);
        else if (e) NX.ui.error(e.message || "Algo deu errado.");
      });
  }

  /* =========================================================
     CRIAR SERVIDOR
     ========================================================= */
  M.createServer = function () {
    const state = { emoji: "🚀", color: u().colorFor("novo"), templateId: "comunidade" };
    const footer = u().el(
      ACTIONS(
        '<button class="btn btn--ghost" type="button" data-modal-close>Cancelar</button>' +
          '<button class="btn btn--primary" type="submit" form="form-create-server" data-busy-label="Criando">Criar servidor</button>'
      )
    );
    const m = NX.ui.modal({
      title: "Criar servidor",
      eyebrow: "Novo espaço",
      size: "md",
      footer: footer,
    });

    m.body.innerHTML =
      '<p class="modal__lead">Dê um nome, escolha um ícone e uma estrutura inicial. Você entra no servidor automaticamente.</p>' +
      '<form id="form-create-server" class="form" novalidate>' +
      '<div class="server-preview">' +
      '<span class="server-preview__icon" data-server-preview style="--sv:' + state.color + '">' +
      state.emoji +
      "</span>" +
      '<div class="server-preview__txt"><strong data-name-preview>Meu servidor</strong>' +
      "<span>Novo servidor · 1 membro</span></div></div>" +
      '<label class="field"><span class="field__label">Nome do servidor</span>' +
      '<input class="input" name="name" maxlength="40" placeholder="Ex.: Comunidade Aurora" data-autofocus /></label>' +
      '<div class="field"><span class="field__label">Ícone do servidor</span>' +
      '<div class="icon-picker">' + emojiGrid(state.emoji) + swatches(state.color, "pick-color") + "</div></div>" +
      '<div class="field"><span class="field__label">Estrutura inicial</span>' +
      '<div class="template-grid">' +
      NX.TEMPLATES.map(
        (t) =>
          '<button type="button" class="template-chip' + (t.id === state.templateId ? " is-on" : "") +
          '" data-template="' + t.id + '"><span class="template-chip__ico">' + t.emoji +
          "</span><span><strong>" + u().h(t.name) + "</strong><small>" + u().h(t.desc) + "</small></span></button>"
      ).join("") +
      "</div></div>" +
      '<div class="form-error" data-error hidden></div>' +
      "</form>";

    const form = m.body.querySelector("form");
    const preview = m.body.querySelector("[data-server-preview]");
    const namePrev = m.body.querySelector("[data-name-preview]");

    state.onPick = () => {
      preview.textContent = state.emoji;
      preview.style.setProperty("--sv", state.color);
    };
    bindPickers(m.body, state);

    form.addEventListener("input", () => {
      namePrev.textContent = form.elements.name.value.trim() || "Meu servidor";
    });

    m.body.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-template]");
      if (!chip) return;
      state.templateId = chip.getAttribute("data-template");
      u().qa("[data-template]", m.body).forEach((b) => b.classList.toggle("is-on", b === chip));
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      showErr(form, "");
      const btn = footer.querySelector('button[type="submit"]');
      runTask(
        btn,
        api().createServer({
          name: formData(form).name,
          emoji: state.emoji,
          color: state.color,
          templateId: state.templateId,
        }),
        form,
        (server) => {
          m.close();
          NX.ui.toast("Servidor “" + server.name + "” criado!", "success");
          NX.app.go("#/s/" + server.id);
        }
      );
    });
  };

  /* =========================================================
     ENTRAR COM CONVITE
     ========================================================= */
  M.joinServer = function (presetCode) {
    const footer = u().el(
      ACTIONS(
        '<button class="btn btn--ghost" type="button" data-modal-close>Cancelar</button>' +
          '<button class="btn btn--primary" type="submit" form="form-join" disabled data-busy-label="Entrando">Entrar no servidor</button>'
      )
    );
    const m = NX.ui.modal({
      title: "Entrar em um servidor",
      eyebrow: "Convite",
      size: "sm",
      footer: footer,
    });

    m.body.innerHTML =
      '<p class="modal__lead">Cole o link ou digite o código de convite recebido.</p>' +
      '<form id="form-join" class="form" novalidate>' +
      '<label class="field"><span class="field__label">Link ou código</span>' +
      '<input class="input mono" name="code" placeholder="nexo.chat/ABC12" data-autofocus value="' +
      u().h(presetCode || "") + '" /></label>' +
      '<div class="invite-preview" data-preview>' +
      '<span class="invite-preview__hint">Digite um código para ver o servidor.</span></div>' +
      '<div class="form-error" data-error hidden></div>' +
      "</form>";

    const form = m.body.querySelector("form");
    const preview = m.body.querySelector("[data-preview]");
    const submit = footer.querySelector('button[type="submit"]');
    let resolved = null;

    const extract = (raw) => {
      const v = String(raw || "").trim();
      if (!v) return "";
      const mUrl = v.match(/([A-Za-z0-9]+)\/?$/);
      const cleaned = v.replace(/^https?:\/\//, "").replace(/[?#].*$/, "");
      const segs = cleaned.split("/").filter(Boolean);
      const candidate = segs.length ? segs[segs.length - 1] : v;
      return (candidate || (mUrl && mUrl[1]) || v).toUpperCase().replace(/[^A-Z0-9]/g, "");
    };

    const refresh = u().debounce(() => {
      const code = extract(form.code.value);
      resolved = null;
      submit.disabled = true;
      if (code.length < 4) {
        preview.innerHTML = '<span class="invite-preview__hint">Digite um código para ver o servidor.</span>';
        return;
      }
      const invite = S().invite(code);
      const me = S().me();
      if (!invite) {
        preview.innerHTML =
          '<span class="invite-preview__hint is-bad">' + NX.icon("alert", "", 16) +
          " Código não encontrado. Confira com quem enviou.</span>";
        return;
      }
      const server = S().server(invite.serverId);
      const isMember = me && !!S().membership(server.id, me.id);
      resolved = code;
      submit.disabled = isMember;
      preview.innerHTML =
        u().serverIconHTML(server, "sm", false) +
        '<span class="invite-preview__txt"><strong>' + u().h(server.name) + "</strong>" +
        "<small>" + u().plural(S().memberCount(server.id), "membro", "membros") + " · " +
        (isMember ? "você já participa" : "convite " + invite.code) +
        "</small></span>";
    }, 260);

    form.addEventListener("input", refresh);
    if (presetCode) refresh();

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      showErr(form, "");
      const code = resolved || extract(form.code.value);
      runTask(submit, api().joinByInvite(code), form, (server) => {
        m.close();
        NX.ui.toast("Você entrou em " + server.name + "!", "success");
        NX.app.go("#/s/" + server.id);
      });
    });
  };

  /* =========================================================
     CRIAR CANAL
     ========================================================= */
  M.createChannel = function (serverId, categoryId) {
    const server = S().server(serverId);
    if (!server) return;
    const cats = S().categoriesOf(serverId);
    if (!cats.length) {
      NX.ui.toast("Crie uma categoria antes de criar canais.", "warn");
      M.createCategory(serverId);
      return;
    }
    const state = { type: "text", categoryId: categoryId || cats[0].id };

    const footer = u().el(
      ACTIONS(
        '<button class="btn btn--ghost" type="button" data-modal-close>Cancelar</button>' +
          '<button class="btn btn--primary" type="submit" form="form-channel" data-busy-label="Criando">Criar canal</button>'
      )
    );
    const m = NX.ui.modal({ title: "Criar canal", eyebrow: server.name, size: "md", footer: footer });

    m.body.innerHTML =
      '<form id="form-channel" class="form" novalidate>' +
      '<div class="type-switch" role="radiogroup" aria-label="Tipo do canal">' +
      '<button type="button" class="type-switch__btn is-on" data-type="text">' +
      NX.icon("hash", "", 18) + "<span><strong>Texto</strong><small>mensagens e arquivos</small></span></button>" +
      '<button type="button" class="type-switch__btn" data-type="voice">' +
      NX.icon("voice", "", 18) + "<span><strong>Voz</strong><small>sala de conversa</small></span></button>" +
      "</div>" +
      '<label class="field"><span class="field__label">Nome do canal</span>' +
      '<span class="input-affix">' +
      '<span class="input-affix__ico" data-affix>' + NX.icon("hash", "", 17) + "</span>" +
      '<input class="input" name="name" placeholder="novo-canal" data-autofocus /></span></label>' +
      '<label class="field"><span class="field__label">Categoria</span>' +
      '<select class="select" name="categoryId">' +
      cats
        .map(
          (c) =>
            '<option value="' + c.id + '"' + (c.id === state.categoryId ? " selected" : "") + ">" +
            u().h(c.name) + "</option>"
        )
        .join("") +
      "</select></label>" +
      '<div class="field"><span class="field__label">Permissões</span>' +
      '<div class="perm-mini">' +
      '<label class="perm-mini__row"><span><strong>Quem pode ver este canal</strong>' +
      "<small>“Somente eu” esconde o canal dos outros membros.</small></span>" +
      '<select class="select select--sm" name="view">' +
      '<option value="all">Todos</option><option value="private">Somente eu</option></select></label>' +
      '<label class="perm-mini__row"><span><strong>Quem pode enviar mensagens</strong>' +
      "<small>Você e administradores sempre podem escrever.</small></span>" +
      '<select class="select select--sm" name="send">' +
      '<option value="all">Todos</option><option value="private">Somente eu</option>' +
      '<option value="none">Ninguém (somente leitura)</option></select></label>' +
      "</div></div>" +
      '<div class="form-error" data-error hidden></div>' +
      "</form>";

    const form = m.body.querySelector("form");
    const nameInput = form.elements.name;
    const affix = m.body.querySelector("[data-affix]");

    m.body.addEventListener("click", (e) => {
      const t = e.target.closest("[data-type]");
      if (!t) return;
      state.type = t.getAttribute("data-type");
      u().qa("[data-type]", m.body).forEach((b) => b.classList.toggle("is-on", b === t));
      affix.innerHTML = NX.icon(state.type === "voice" ? "voice" : "hash", "", 17);
      nameInput.placeholder = state.type === "voice" ? "Sala de conversa" : "novo-canal";
      nameInput.focus();
    });

    nameInput.addEventListener("input", () => {
      if (state.type === "text") {
        const pos = nameInput.selectionStart;
        const clean = u().slug(nameInput.value);
        if (clean !== nameInput.value) {
          nameInput.value = clean;
          nameInput.setSelectionRange(pos, pos);
        }
      }
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      showErr(form, "");
      const data = formData(form);
      runTask(
        footer.querySelector('button[type="submit"]'),
        api().createChannel(serverId, {
          name: data.name,
          type: state.type,
          categoryId: data.categoryId,
          view: data.view,
          send: data.send,
        }),
        form,
        (ch) => {
          m.close();
          NX.ui.toast("Canal #" + ch.name + " criado.", "success");
          NX.app.go("#/s/" + serverId + "/" + ch.id);
        }
      );
    });
  };

  /* =========================================================
     CONFIGURAÇÕES DO CANAL
     ========================================================= */
  M.channelSettings = function (channelId) {
    const ch = S().channel(channelId);
    if (!ch) return;
    const server = S().server(ch.serverId);
    const cats = S().categoriesOf(ch.serverId);
    const footer = u().el(
      ACTIONS(
        '<button class="btn btn--danger-soft" type="button" data-del>Excluir canal</button>' +
          '<span class="spacer"></span>' +
          '<button class="btn btn--ghost" type="button" data-modal-close>Cancelar</button>' +
          '<button class="btn btn--primary" type="submit" form="form-channel-edit" data-busy-label="Salvando">Salvar alterações</button>'
      )
    );
    const m = NX.ui.modal({
      title: "Editar canal",
      eyebrow: server.name,
      size: "md",
      footer: footer,
    });

    m.body.innerHTML =
      '<form id="form-channel-edit" class="form" novalidate>' +
      '<label class="field"><span class="field__label">Nome do canal</span>' +
      '<span class="input-affix"><span class="input-affix__ico">' +
      NX.icon(ch.type === "voice" ? "voice" : "hash", "", 17) +
      '</span><input class="input" name="name" value="' + u().h(ch.name) + '" data-autofocus /></span></label>' +
      '<label class="field"><span class="field__label">Tópico <em>(aparece no cabeçalho)</em></span>' +
      '<textarea class="input input--area" name="topic" rows="2" maxlength="180" placeholder="Sobre o que é este canal?">' +
      u().h(ch.topic || "") +
      "</textarea></label>" +
      '<label class="field"><span class="field__label">Categoria</span>' +
      '<select class="select" name="categoryId">' +
      cats
        .map(
          (c) =>
            '<option value="' + c.id + '"' + (c.id === ch.categoryId ? " selected" : "") + ">" +
            u().h(c.name) + "</option>"
        )
        .join("") +
      "</select></label>" +
      '<div class="field"><span class="field__label">Permissões</span><div class="perm-mini">' +
      '<label class="perm-mini__row"><span><strong>Quem pode ver este canal</strong></span>' +
      '<select class="select select--sm" name="view">' +
      '<option value="all"' + (ch.overrides.view === "all" ? " selected" : "") + ">Todos</option>" +
      '<option value="private"' + (ch.overrides.view === "private" ? " selected" : "") + ">Somente eu</option>" +
      "</select></label>" +
      '<label class="perm-mini__row"><span><strong>Quem pode enviar mensagens</strong></span>' +
      '<select class="select select--sm" name="send">' +
      '<option value="all"' + (ch.overrides.send === "all" ? " selected" : "") + ">Todos</option>" +
      '<option value="private"' + (ch.overrides.send === "private" ? " selected" : "") + ">Somente eu</option>" +
      '<option value="none"' + (ch.overrides.send === "none" ? " selected" : "") + ">Ninguém</option>" +
      "</select></label>" +
      "</div></div>" +
      (NX.permUI && typeof NX.permUI.openChannel === "function"
        ? '<div class="field"><span class="field__label">Permissões avançadas</span>' +
          '<p class="field__hint">Matriz por cargo ou usuário com estados 🟢 Permitir, 🔴 Negar e ⚪ Herdar — incluindo herança da categoria.</p>' +
          '<button type="button" class="btn btn--soft btn--sm" data-open-perms>' +
          NX.icon("shield", "", 15) + " Abrir permissões do canal</button></div>"
        : "") +
      '<div class="form-error" data-error hidden></div>' +
      "</form>";

    const permBtn = m.body.querySelector("[data-open-perms]");
    if (permBtn) {
      permBtn.addEventListener("click", () => {
        m.close();
        NX.permUI.openChannel(channelId);
      });
    }

    const form = m.body.querySelector("form");

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      showErr(form, "");
      const data = formData(form);
      runTask(
        footer.querySelector('button[type="submit"]'),
        api().updateChannel(channelId, {
          name: data.name,
          topic: data.topic,
          categoryId: data.categoryId,
          overrides: { view: data.view, send: data.send },
        }),
        form,
        () => {
          m.close();
          NX.ui.toast("Canal atualizado.", "success");
        }
      );
    });

    footer.querySelector("[data-del]").addEventListener("click", async () => {
      const ok = await NX.ui.confirm({
        title: "Excluir canal",
        message: "O canal #" + ch.name + " e todas as suas mensagens serão apagados. Isso não pode ser desfeito.",
        confirmLabel: "Excluir canal",
        danger: true,
        icon: "trash",
      });
      if (!ok) return;
      try {
        await api().deleteChannel(channelId);
        m.close();
        NX.ui.toast("Canal excluído.", "success");
        NX.app.go("#/s/" + ch.serverId);
      } catch (e) {
        NX.ui.error(e.message);
      }
    });
  };

  /* =========================================================
     CATEGORIA
     ========================================================= */
  M.createCategory = function (serverId) {
    const server = S().server(serverId);
    const footer = u().el(
      ACTIONS(
        '<button class="btn btn--ghost" type="button" data-modal-close>Cancelar</button>' +
          '<button class="btn btn--primary" type="submit" form="form-cat" data-busy-label="Criando">Criar categoria</button>'
      )
    );
    const m = NX.ui.modal({ title: "Criar categoria", eyebrow: server.name, size: "sm", footer });
    m.body.innerHTML =
      '<form id="form-cat" class="form" novalidate>' +
      '<label class="field"><span class="field__label">Nome da categoria</span>' +
      '<input class="input" name="name" placeholder="EX.: COMUNIDADE" data-autofocus /></label>' +
      '<label class="field"><span class="field__label">Primeiro canal <em>(opcional)</em></span>' +
      '<input class="input" name="channel" placeholder="geral" /></label>' +
      '<div class="form-error" data-error hidden></div></form>';
    const form = m.body.querySelector("form");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      showErr(form, "");
      const d = formData(form);
      runTask(
        footer.querySelector('button[type="submit"]'),
        api().createCategory(serverId, { name: d.name, firstChannel: d.channel }),
        form,
        (res) => {
          m.close();
          NX.ui.toast("Categoria " + res.category.name + " criada.", "success");
        }
      );
    });
  };

  M.categorySettings = function (categoryId) {
    const cat = S().category(categoryId);
    if (!cat) return;
    const footer = u().el(
      ACTIONS(
        '<button class="btn btn--danger-soft" type="button" data-del>Excluir</button>' +
          '<span class="spacer"></span>' +
          '<button class="btn btn--ghost" type="button" data-modal-close>Cancelar</button>' +
          '<button class="btn btn--primary" type="submit" form="form-cat-edit" data-busy-label="Salvando">Salvar</button>'
      )
    );
    const m = NX.ui.modal({ title: "Editar categoria", eyebrow: S().server(cat.serverId).name, size: "sm", footer });
    const chCount = S().channelsOfCategory(cat.id).length;
    m.body.innerHTML =
      '<form id="form-cat-edit" class="form" novalidate>' +
      '<label class="field"><span class="field__label">Nome</span>' +
      '<input class="input" name="name" value="' + u().h(cat.name) + '" data-autofocus /></label>' +
      '<p class="form-note">' + u().plural(chCount, "canal nesta categoria", "canais nesta categoria") +
      ". Ao excluir, os canais e mensagens vão junto.</p>" +
      '<div class="form-error" data-error hidden></div></form>';
    const form = m.body.querySelector("form");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      runTask(
        footer.querySelector('button[type="submit"]'),
        api().renameCategory(categoryId, formData(form).name),
        form,
        () => {
          m.close();
          NX.ui.toast("Categoria atualizada.", "success");
        }
      );
    });
    footer.querySelector("[data-del]").addEventListener("click", async () => {
      const ok = await NX.ui.confirm({
        title: "Excluir categoria",
        message: "A categoria " + cat.name + " e seus " + chCount + " canal(is) serão apagados com todas as mensagens.",
        confirmLabel: "Excluir categoria",
        danger: true,
        icon: "folderPlus",
      });
      if (!ok) return;
      try {
        await api().deleteCategory(categoryId);
        m.close();
        NX.ui.toast("Categoria excluída.", "success");
      } catch (e) {
        NX.ui.error(e.message);
      }
    });
  };

  /* =========================================================
     CONVITES
     ========================================================= */
  function inviteLink(code) {
    return location.href.split("#")[0] + "#/convite/" + code;
  }

  M.invite = function (serverId) {
    const server = S().server(serverId);
    if (!server) return;
    const me = S().me();
    const canManage = S().can(serverId, me.id, "manageServer");
    const m = NX.ui.modal({
      title: "Convidar pessoas",
      eyebrow: server.name,
      size: "md",
      footer: u().el(
        ACTIONS(
          '<button class="btn btn--ghost" type="button" data-modal-close>Fechar</button>' +
            '<button class="btn btn--soft" type="button" data-new>Gerar novo código</button>'
        )
      ),
    });

    function render(active) {
      const list = S().invitesOf(serverId).filter(
        (i) => canManage || i.creatorId === me.id
      );
      m.body.innerHTML =
        '<p class="modal__lead">Compartilhe o código ou o link. Quem acessar poderá ver o servidor e entrar.</p>' +
        (active
          ? '<div class="invite-hero">' +
            '<span class="invite-hero__label">Código de convite</span>' +
            '<strong class="invite-hero__code mono">' + u().h(active.code) + "</strong>" +
            '<div class="invite-hero__link">' +
            '<input class="input mono" readonly value="' + u().h(inviteLink(active.code)) + '" data-link />' +
            '<button class="btn btn--soft btn--sm" data-copy-link>' + NX.icon("copy", "", 15) + " Copiar</button>" +
            '<button class="btn btn--soft btn--sm" data-share>' + NX.icon("share", "", 15) + "</button>" +
            "</div></div>"
          : '<div class="invite-empty">' + NX.icon("link", "", 22) +
            "<span>Nenhum convite ativo. Gere um código para começar.</span></div>") +
        (list.length
          ? '<div class="invite-list"><span class="field__label">Convites ativos · ' + list.length + "</span>" +
            list
              .map(
                (i) =>
                  '<div class="invite-row"><span class="invite-row__code mono">' + u().h(i.code) + "</span>" +
                  "<span class=\"invite-row__meta\">" +
                  u().h((S().user(i.creatorId) || {}).displayName || "?") +
                  " · " + (i.uses || 0) + " uso(s) · " + u().timeAgo(i.createdAt) +
                  "</span>" +
                  (canManage || i.creatorId === me.id
                    ? '<button class="btn btn--ghost btn--sm" data-revoke="' + i.code + '">Revogar</button>'
                    : "") +
                  "</div>"
              )
              .join("") +
            "</div>"
          : "");
    }

    const activeInvite = S().invitesOf(serverId).filter(
      (i) => canManage || i.creatorId === me.id
    )[0];
    render(activeInvite);

    m.body.addEventListener("click", async (e) => {
      const copyBtn = e.target.closest("[data-copy-link]");
      if (copyBtn) {
        const input = m.body.querySelector("[data-link]");
        const ok = await u().copy(input.value);
        NX.ui.toast(ok ? "Link copiado!" : "Não foi possível copiar.", ok ? "success" : "error");
        return;
      }
      const share = e.target.closest("[data-share]");
      if (share) {
        const input = m.body.querySelector("[data-link]");
        if (navigator.share) {
          try {
            await navigator.share({ title: server.name, url: input.value });
          } catch (err) {}
        } else {
          const ok = await u().copy(input.value);
          NX.ui.toast(ok ? "Link copiado para compartilhar." : "Não foi possível copiar.", ok ? "success" : "error");
        }
        return;
      }
      const rev = e.target.closest("[data-revoke]");
      if (rev) {
        try {
          await api().revokeInvite(rev.getAttribute("data-revoke"));
          render(S().invitesOf(serverId)[0]);
          NX.ui.toast("Convite revogado.", "success");
        } catch (err) {
          NX.ui.error(err.message);
        }
      }
    });

    const foot = m.el.querySelector(".modal__foot");
    if (foot) {
      foot.addEventListener("click", async (e) => {
        if (!e.target.closest("[data-new]")) return;
        try {
          const inv = await api().createInvite(serverId);
          render(inv);
          NX.ui.toast("Novo convite gerado.", "success");
        } catch (err) {
          NX.ui.error(err.message);
        }
      });
    }
  };

  /* =========================================================
     EDITOR DE CARGO
     ========================================================= */
  function permList(permissions, disabled) {
    const groups = {};
    NX.PERMS.forEach((p) => {
      (groups[p.group] = groups[p.group] || []).push(p);
    });
    return Object.keys(groups)
      .map(
        (g) =>
          '<div class="perm-group"><span class="perm-group__title">' + u().h(g) + "</span>" +
          groups[g]
            .map(
              (p) =>
                '<label class="perm-row' + (disabled ? " is-disabled" : "") + '">' +
                '<span class="perm-row__txt"><strong>' + u().h(p.label) + "</strong><small>" +
                u().h(p.desc) + "</small></span>" +
                '<span class="switch"><input type="checkbox" name="' + p.key + '"' +
                (permissions[p.key] ? " checked" : "") + (disabled ? " disabled" : "") +
                ' /><i></i></span></label>'
            )
            .join("") +
          "</div>"
      )
      .join("");
  }

  M.roleEditor = function (serverId, roleId) {
    const isNew = !roleId;
    const role = isNew ? null : S().role(roleId);
    if (!isNew && !role) return;
    const state = {
      color: role ? role.color : "#8f83ff",
      emoji: null,
    };
    const perms = {};
    NX.PERM_KEYS.forEach(
      (k) => (perms[k] = role ? !!role.permissions[k] : k === "viewChannels" || k === "sendMessages")
    );

    const footer = u().el(
      ACTIONS(
        (!isNew ? '<button class="btn btn--danger-soft" type="button" data-del>Excluir cargo</button>' : "") +
          '<span class="spacer"></span>' +
          '<button class="btn btn--ghost" type="button" data-modal-close>Cancelar</button>' +
          '<button class="btn btn--primary" type="submit" form="form-role" data-busy-label="Salvando">' +
          (isNew ? "Criar cargo" : "Salvar") +
          "</button>"
      )
    );
    const m = NX.ui.modal({
      title: isNew ? "Novo cargo" : "Editar cargo",
      eyebrow: S().server(serverId).name,
      size: "md",
      footer,
    });

    m.body.innerHTML =
      '<form id="form-role" class="form" novalidate>' +
      '<div class="role-preview"><span class="role-preview__dot" data-role-dot style="--rc:' + state.color + '"></span>' +
      '<input class="input input--role" name="name" maxlength="30" placeholder="Nome do cargo" value="' +
      u().h(role ? role.name : "") + '" data-autofocus /></div>' +
      '<div class="field"><span class="field__label">Cor de destaque</span>' + swatches(state.color, "pick-color") + "</div>" +
      '<div class="field"><span class="field__label">Permissões</span>' +
      '<div class="perm-list">' + permList(perms, false) + "</div></div>" +
      '<p class="form-note">O dono do servidor sempre tem todas as permissões. Permissões individuais de membros sobrepõem o cargo.</p>' +
      '<div class="form-error" data-error hidden></div></form>';

    const form = m.body.querySelector("form");
    const dot = m.body.querySelector("[data-role-dot]");

    m.body.addEventListener("click", (e) => {
      const c = e.target.closest("[data-pick-color]");
      if (!c) return;
      state.color = c.getAttribute("data-pick-color");
      u().qa("[data-pick-color]", m.body).forEach((b) => b.classList.toggle("is-on", b === c));
      dot.style.setProperty("--rc", state.color);
    });

    form.addEventListener("input", () => {
      const val = form.elements.name.value.trim();
      dot.parentElement.querySelector(".role-preview__dot").setAttribute("title", val);
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      showErr(form, "");
      const permissions = {};
      NX.PERM_KEYS.forEach((k) => (permissions[k] = !!form[k].checked));
      const d = formData(form);
      runTask(
        footer.querySelector('button[type="submit"]'),
        isNew
          ? api().createRole(serverId, { name: d.name, color: state.color, permissions })
          : api().updateRole(roleId, { name: d.name, color: state.color, permissions }),
        form,
        () => {
          m.close();
          NX.ui.toast(isNew ? "Cargo criado." : "Cargo atualizado.", "success");
        }
      );
    });

    if (!isNew) {
      footer.querySelector("[data-del]").addEventListener("click", async () => {
        const ok = await NX.ui.confirm({
          title: "Excluir cargo",
          message: "Membros com “" + role.name + "” voltam para o cargo padrão.",
          confirmLabel: "Excluir",
          danger: true,
          icon: "shield",
        });
        if (!ok) return;
        try {
          await api().deleteRole(roleId);
          m.close();
          NX.ui.toast("Cargo excluído.", "success");
        } catch (err) {
          NX.ui.error(err.message);
        }
      });
    }
  };

  /* =========================================================
     PERMISSÕES DE UM MEMBRO
     ========================================================= */
  M.memberPerms = function (serverId, userId) {
    const server = S().server(serverId);
    const target = S().user(userId);
    const membership = S().membership(serverId, userId);
    if (!server || !target || !membership) return;
    const isOwner = server.ownerId === userId;
    const current = S().effectivePerms(serverId, userId);

    const footer = u().el(
      ACTIONS(
        '<button class="btn btn--ghost" type="button" data-modal-close>Cancelar</button>' +
          '<button class="btn btn--primary" type="submit" form="form-perms"' +
          (isOwner ? " disabled" : "") +
          ' data-busy-label="Salvando">Salvar permissões</button>'
      )
    );
    const m = NX.ui.modal({
      title: "Permissões de " + target.displayName,
      eyebrow: server.name,
      size: "md",
      footer,
    });

    m.body.innerHTML =
      '<div class="member-mini">' + u().avatarHTML(target, "sm", true) +
      "<span><strong>" + u().h(target.displayName) + "</strong><small>@" + u().h(target.username) + "</small></span>" +
      (isOwner ? '<span class="tag tag--owner">Dono</span>' : "") +
      "</div>" +
      (isOwner
        ? '<div class="callout callout--info">' + NX.icon("crown", "", 17) +
          "<span>O dono do servidor possui todas as permissões, automaticamente.</span></div>"
        : '<form id="form-perms" class="form" novalidate>' +
          '<div class="perm-list">' + permList(current, false) + "</div>" +
          '<p class="form-note">Estas alterações individuais sobrepõem o cargo do membro.</p>' +
          '<div class="form-error" data-error hidden></div></form>');

    if (isOwner) return;
    const form = m.body.querySelector("form");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const patch = {};
      NX.PERM_KEYS.forEach((k) => (patch[k] = !!form[k].checked));
      runTask(
        footer.querySelector('button[type="submit"]'),
        api().updateMemberPerms(serverId, userId, patch),
        form,
        () => {
          m.close();
          NX.ui.toast("Permissões atualizadas.", "success");
        }
      );
    });
  };

  /* =========================================================
     CARTÃO DO MEMBRO (popout)
     ========================================================= */
  M.memberCard = function (anchor, serverId, userId) {
    /* o módulo NX.people assume quando disponível (cartão rico) */
    if (NX.people && typeof NX.people.memberCard === "function") {
      NX.people.memberCard(anchor, serverId, userId);
      return;
    }
    const server = S().server(serverId);
    const user = S().user(userId);
    const me = S().me();
    if (!server || !user) return;
    const membership = S().membership(serverId, userId);
    const role = membership ? S().role(membership.roleId) : null;
    const isOwner = server.ownerId === userId;
    const isMe = userId === me.id;
    const canManage = !isMe && !isOwner && S().can(serverId, me.id, "manageServer");
    const roles = S().rolesOf(serverId);

    const html =
      '<div class="member-card">' +
      '<div class="member-card__banner" style="--pc:' + (user.avatar.color || "#35e0a8") + '"></div>' +
      '<div class="member-card__body">' +
      '<div class="member-card__avatar">' + u().avatarHTML(user, "lg", true) + "</div>" +
      "<h3>" + u().h(user.displayName) + "</h3>" +
      '<span class="member-card__user">@' + u().h(user.username) + "</span>" +
      '<span class="status-pill" data-status="' + user.status + '">' +
      u().h(NX.STATUS_LABEL[user.status] || "Offline") +
      (user.statusText ? " · " + u().h(user.statusText) : "") +
      "</span>" +
      '<div class="member-card__tags">' +
      (isOwner ? '<span class="tag tag--owner">Dono</span>' : "") +
      (role ? '<span class="tag" style="--tc:' + role.color + '">' + u().h(role.name) + "</span>" : "") +
      "</div>" +
      (user.bio ? '<p class="member-card__bio">' + u().h(user.bio) + "</p>" : "") +
      '<div class="member-card__meta">Membro desde ' +
      u().h(new Date(membership ? membership.joinedAt : Date.now()).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })) +
      "</div>" +
      '<div class="member-card__actions">' +
      (isMe
        ? '<button class="btn btn--soft btn--sm btn--block" data-card="edit">Editar perfil</button>'
        : '<button class="btn btn--soft btn--sm btn--block" data-card="dm">' + NX.icon("chat", "", 15) +
          " Mensagem</button>" +
          '<button class="btn btn--ghost btn--sm btn--block" data-card="profile">Ver perfil</button>') +
      (canManage
        ? '<div class="member-card__divider"></div>' +
          '<button class="btn btn--soft btn--sm btn--block" data-card="perms">' + NX.icon("shield", "", 15) +
          " Permissões</button>" +
          '<label class="member-card__role"><span>Cargo</span>' +
          '<select class="select select--sm" data-card-role>' +
          roles
            .map(
              (r) =>
                '<option value="' + r.id + '"' + (membership.roleId === r.id ? " selected" : "") + ">" +
                u().h(r.name) + "</option>"
            )
            .join("") +
          "</select></label>" +
          '<button class="btn btn--danger-soft btn--sm btn--block" data-card="kick">Remover do servidor</button>'
        : "") +
      "</div></div></div>";

    const el = NX.ui.popout(anchor, html, { cls: "popout--member", align: "start" });

    const close = () => NX.ui.closePopout();

    el.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-card]");
      if (act) {
        const kind = act.getAttribute("data-card");
        close();
        if (kind === "edit") M.editProfile();
        if (kind === "profile") NX.app.go("#/perfil/" + userId);
        if (kind === "dm") NX.actions["start-dm"](act, e);
        if (kind === "perms") M.memberPerms(serverId, userId);
        if (kind === "kick") {
          const ok = await NX.ui.confirm({
            title: "Remover " + user.displayName,
            message: "Ele perde o acesso imediatamente e precisará de um novo convite para voltar.",
            confirmLabel: "Remover",
            danger: true,
            icon: "userPlus",
          });
          if (ok) {
            try {
              await api().kickMember(serverId, userId);
              NX.ui.toast(user.displayName + " foi removido.", "success");
            } catch (err) {
              NX.ui.error(err.message);
            }
          }
        }
        return;
      }
      const sel = e.target.closest("[data-card-role]");
      if (sel && e.type === "change") return;
    });

    el.addEventListener("change", async (e) => {
      const sel = e.target.closest("[data-card-role]");
      if (!sel) return;
      try {
        await api().setMemberRole(serverId, userId, sel.value);
        NX.ui.toast("Cargo alterado.", "success");
      } catch (err) {
        NX.ui.error(err.message);
        sel.value = membership.roleId;
      }
    });
  };

  /* =========================================================
     CONFIGURAÇÕES DO SERVIDOR
     ========================================================= */
  M.serverSettings = function (serverId, tab) {
    /* o módulo NX.admin assume quando disponível (abas ampliadas) */
    if (NX.admin && typeof NX.admin.open === "function") {
      NX.admin.open(serverId, tab);
      return;
    }
    const server = S().server(serverId);
    if (!server) return;
    const me = S().me();
    const canManage = S().can(serverId, me.id, "manageServer");
    const isOwner = server.ownerId === me.id;
    const active = tab || "general";

    const m = NX.ui.modal({
      title: server.name,
      eyebrow: "Configurações do servidor",
      size: "lg",
      cls: "modal--settings",
    });
    m.el.classList.add("modal--settings");

    const TABS = [
      { id: "general", label: "Geral", icon: "settings" },
      { id: "roles", label: "Cargos", icon: "shield" },
      { id: "members", label: "Membros", icon: "users" },
      { id: "invites", label: "Convites", icon: "link" },
      { id: "danger", label: isOwner ? "Excluir" : "Sair", icon: "alert" },
    ];

    function shell(inner, current) {
      return (
        '<div class="settings">' +
        '<nav class="settings__nav">' +
        TABS.map(
          (t) =>
            '<button class="settings__tab' + (t.id === current ? " is-on" : "") + '" data-tab="' + t.id + '">' +
            NX.icon(t.icon, "", 16) + "<span>" + t.label + "</span></button>"
        ).join("") +
        "</nav>" +
        '<div class="settings__body">' + inner + "</div></div>"
      );
    }

    function generalTab() {
      const s = S().server(serverId);
      const state = { emoji: s.icon.emoji, color: s.icon.color };
      const html =
        '<form id="form-general" class="form" novalidate>' +
        '<h3 class="settings__title">Aparência do servidor</h3>' +
        '<div class="server-preview"><span class="server-preview__icon" data-gp style="--sv:' + state.color + '">' +
        u().h(state.emoji) + "</span>" +
        '<div class="server-preview__txt"><strong data-gn>' + u().h(s.name) + "</strong>" +
        "<span>" + u().plural(S().memberCount(s.id), "membro", "membros") + "</span></div></div>" +
        '<label class="field"><span class="field__label">Nome do servidor</span>' +
        '<input class="input" name="name" maxlength="40" value="' + u().h(s.name) + '"' +
        (canManage ? "" : " disabled") + " /></label>" +
        '<label class="field"><span class="field__label">Descrição</span>' +
        '<textarea class="input input--area" name="description" rows="2" maxlength="240" placeholder="O que acontece aqui?"' +
        (canManage ? "" : " disabled") + ">" + u().h(s.description || "") + "</textarea></label>" +
        (canManage
          ? '<div class="field"><span class="field__label">Ícone</span><div class="icon-picker">' +
            emojiGrid(state.emoji) + swatches(state.color, "pick-color") + "</div></div>" +
            '<label class="perm-row"><span class="perm-row__txt"><strong>Mostrar no explorar</strong>' +
            "<small>Deixa a comunidade visível no diretório público.</small></span>" +
            '<span class="switch"><input type="checkbox" name="discoverable"' +
            (s.discoverable ? " checked" : "") + " /><i></i></span></label>"
          : '<div class="callout callout--info">' + NX.icon("info", "", 16) +
            "<span>Você pode ver as configurações, mas só administradores podem alterá-las.</span></div>") +
        '<div class="form-error" data-error hidden></div>' +
        (canManage
          ? '<div class="settings__save"><button class="btn btn--primary" type="submit" data-busy-label="Salvando">Salvar alterações</button></div>'
          : "") +
        "</form>";

      return {
        html: html,
        wire: (root) => {
          if (!canManage) return;
          const form = root.querySelector("#form-general");
          const gp = root.querySelector("[data-gp]");
          const gn = root.querySelector("[data-gn]");
          const st = state;
          st.onPick = () => {
            gp.textContent = st.emoji;
            gp.style.setProperty("--sv", st.color);
          };
          bindPickers(form, st);
          form.addEventListener("input", () => {
            gn.textContent = form.elements.name.value.trim() || s.name;
          });
          form.addEventListener("submit", (e) => {
            e.preventDefault();
            showErr(form, "");
            const d = formData(form);
            runTask(
              form.querySelector('button[type="submit"]'),
              api().updateServer(serverId, {
                name: d.name,
                description: d.description,
                icon: { emoji: st.emoji, color: st.color },
                discoverable: !!d.discoverable,
              }),
              form,
              () => {
                NX.ui.toast("Configurações salvas.", "success");
                m.close();
              }
            );
          });
        },
      };
    }

    function rolesTab() {
      if (!canManage) {
        return {
          html:
            '<div class="callout callout--info">' + NX.icon("shield", "", 17) +
            "<span>Apenas administradores podem gerenciar cargos.</span></div>",
          wire: () => {},
        };
      }
      const roles = S().rolesOf(serverId);
      const rows = roles
        .map((r) => {
          const members = Object.values(NX.store.db.memberships).filter(
            (mm) => mm.serverId === serverId && mm.roleId === r.id
          ).length;
          const perms = NX.PERM_KEYS.filter((k) => r.permissions[k]).length;
          return (
            '<button class="role-row" data-edit-role="' + r.id + '">' +
            '<span class="role-row__dot" style="--rc:' + r.color + '"></span>' +
            "<span class=\"role-row__txt\"><strong>" + u().h(r.name) + "</strong>" +
            "<small>" + (r.isDefault ? "Cargo padrão · " : "") + u().plural(members, "membro", "membros") +
            " · " + perms + "/7 permissões</small></span>" +
            NX.icon("chevronRight", "", 16) +
            "</button>"
          );
        })
        .join("");
      return {
        html:
          '<div class="settings__head"><h3 class="settings__title">Cargos</h3>' +
          '<button class="btn btn--soft btn--sm" data-new-role>' + NX.icon("plus", "", 15) + " Novo cargo</button></div>" +
          '<p class="settings__desc">Cargos agrupam permissões. Quem tem vários, vale o conjunto de todos.</p>' +
          '<div class="role-list">' + rows + "</div>",
        wire: (root) => {
          root.querySelector("[data-new-role]") &&
            root.querySelector("[data-new-role]").addEventListener("click", () => M.roleEditor(serverId, null));
          root.querySelectorAll("[data-edit-role]").forEach((b) =>
            b.addEventListener("click", () => M.roleEditor(serverId, b.getAttribute("data-edit-role")))
          );
        },
      };
    }

    function membersTab() {
      const members = S().membersOf(serverId);
      const roles = S().rolesOf(serverId);
      const rows = members
        .map((row) => {
          const isOwner = server.ownerId === row.user.id;
          const isMe = row.user.id === me.id;
          const editable = canManage && !isOwner && !isMe;
          return (
            '<div class="admin-member">' +
            u().avatarHTML(row.user, "sm", true) +
            '<span class="admin-member__txt"><strong>' + u().h(row.user.displayName) + "</strong>" +
            "<small>@" + u().h(row.user.username) + "</small></span>" +
            (editable
              ? '<select class="select select--sm" data-role-for="' + row.user.id + '">' +
                roles
                  .map(
                    (r) =>
                      '<option value="' + r.id + '"' +
                      (row.membership.roleId === r.id ? " selected" : "") +
                      ">" + u().h(r.name) + "</option>"
                  )
                  .join("") +
                "</select>"
              : '<span class="tag' + (isOwner ? " tag--owner" : "") + '">' +
                u().h(isOwner ? "Dono" : row.role ? row.role.name : "Membro") +
                "</span>") +
            (canManage && !isOwner && !isMe
              ? '<button class="btn btn--ghost btn--sm" data-perms-for="' + row.user.id + '">Permissões</button>' +
                '<button class="btn btn--ghost btn--sm btn--danger-text" data-kick="' + row.user.id + '">Remover</button>'
              : "") +
            "</div>"
          );
        })
        .join("");
      return {
        html:
          '<div class="settings__head"><h3 class="settings__title">Membros</h3>' +
          '<span class="block__count">' + members.length + "</span></div>" +
          '<div class="admin-members">' + rows + "</div>",
        wire: (root) => {
          root.querySelectorAll("[data-role-for]").forEach((sel) =>
            sel.addEventListener("change", async () => {
              try {
                await api().setMemberRole(serverId, sel.getAttribute("data-role-for"), sel.value);
                NX.ui.toast("Cargo atualizado.", "success");
              } catch (err) {
                NX.ui.error(err.message);
              }
            })
          );
          root.querySelectorAll("[data-perms-for]").forEach((b) =>
            b.addEventListener("click", () => M.memberPerms(serverId, b.getAttribute("data-perms-for")))
          );
          root.querySelectorAll("[data-kick]").forEach((b) =>
            b.addEventListener("click", async () => {
              const uid = b.getAttribute("data-kick");
              const usr = S().user(uid);
              const ok = await NX.ui.confirm({
                title: "Remover " + (usr ? usr.displayName : "membro"),
                message: "A pessoa perderá o acesso e precisará de um novo convite.",
                confirmLabel: "Remover",
                danger: true,
                icon: "userPlus",
              });
              if (!ok) return;
              try {
                await api().kickMember(serverId, uid);
                NX.ui.toast("Membro removido.", "success");
              } catch (err) {
                NX.ui.error(err.message);
              }
            })
          );
        },
      };
    }

    function invitesTab() {
      const invites = S().invitesOf(serverId).filter(
        (i) => canManage || i.creatorId === me.id
      );
      const canInvite = S().can(serverId, me.id, "createInvite");
      return {
        html:
          '<div class="settings__head"><h3 class="settings__title">Convites</h3>' +
          (canInvite
            ? '<button class="btn btn--soft btn--sm" data-new-invite>' + NX.icon("plus", "", 15) + " Gerar convite</button>"
            : "") +
          "</div>" +
          '<p class="settings__desc">Cada código abre a porta para o seu servidor. Revogue quando quiser.</p>' +
          (invites.length
            ? '<div class="invite-list">' +
              invites
                .map(
                  (i) =>
                    '<div class="invite-row"><span class="invite-row__code mono">' + u().h(i.code) + "</span>" +
                    '<span class="invite-row__meta">' +
                    u().h((S().user(i.creatorId) || {}).displayName || "?") +
                    " · " + (i.uses || 0) + " uso(s) · " + u().timeAgo(i.createdAt) +
                    "</span>" +
                    '<button class="btn btn--ghost btn--sm" data-copy-code="' + i.code + '">Copiar</button>' +
                    (canManage || i.creatorId === me.id
                      ? '<button class="btn btn--ghost btn--sm btn--danger-text" data-revoke-code="' + i.code + '">Revogar</button>'
                      : "") +
                    "</div>"
                )
                .join("") +
              "</div>"
            : '<div class="invite-empty">' + NX.icon("link", "", 20) + "<span>Nenhum convite ativo.</span></div>"),
        wire: (root) => {
          const nb = root.querySelector("[data-new-invite]");
          if (nb)
            nb.addEventListener("click", async () => {
              try {
                const inv = await api().createInvite(serverId);
                NX.ui.toast("Convite " + inv.code + " gerado.", "success");
                refresh("invites");
              } catch (err) {
                NX.ui.error(err.message);
              }
            });
          root.querySelectorAll("[data-copy-code]").forEach((b) =>
            b.addEventListener("click", async () => {
              const code = b.getAttribute("data-copy-code");
              const ok = await u().copy(inviteLink(code));
              NX.ui.toast(ok ? "Link do convite copiado!" : "Não foi possível copiar.", ok ? "success" : "error");
            })
          );
          root.querySelectorAll("[data-revoke-code]").forEach((b) =>
            b.addEventListener("click", async () => {
              try {
                await api().revokeInvite(b.getAttribute("data-revoke-code"));
                NX.ui.toast("Convite revogado.", "success");
                refresh("invites");
              } catch (err) {
                NX.ui.error(err.message);
              }
            })
          );
        },
      };
    }

    function dangerTab() {
      if (isOwner) {
        return {
          html:
            '<h3 class="settings__title is-danger">Excluir servidor</h3>' +
            '<p class="settings__desc">Excluir <strong>' + u().h(server.name) +
            "</strong> remove todos os canais, mensagens, cargos e convites. Não há como desfazer.</p>" +
            '<div class="danger-zone"><button class="btn btn--danger" data-delete-server>' +
            NX.icon("trash", "", 16) + " Excluir servidor</button></div>",
          wire: (root) => {
            root.querySelector("[data-delete-server]").addEventListener("click", async () => {
              const ok = await NX.ui.confirm({
                title: "Excluir " + server.name,
                message:
                  "Todos os canais, mensagens, cargos e convites serão apagados permanentemente. Esta ação não pode ser desfeita.",
                confirmLabel: "Excluir definitivamente",
                danger: true,
                icon: "trash",
              });
              if (!ok) return;
              try {
                await api().deleteServer(serverId);
                m.close();
                NX.ui.toast("Servidor excluído.", "success");
                NX.app.go("#/");
              } catch (err) {
                NX.ui.error(err.message);
              }
            });
          },
        };
      }
      return {
        html:
          '<h3 class="settings__title is-danger">Sair do servidor</h3>' +
          '<p class="settings__desc">Você perderá o acesso a <strong>' + u().h(server.name) +
          "</strong> e precisará de um novo convite para voltar.</p>" +
          '<div class="danger-zone"><button class="btn btn--danger" data-leave-server>' +
          NX.icon("logout", "", 16) + " Sair do servidor</button></div>",
        wire: (root) => {
          root.querySelector("[data-leave-server]").addEventListener("click", async () => {
            const ok = await NX.ui.confirm({
              title: "Sair de " + server.name,
              message: "Você pode entrar de novo se alguém te enviar um convite.",
              confirmLabel: "Sair",
              danger: true,
              icon: "logout",
            });
            if (!ok) return;
            try {
              await api().leaveServer(serverId);
              m.close();
              NX.ui.toast("Você saiu do servidor.", "success");
              NX.app.go("#/");
            } catch (err) {
              NX.ui.error(err.message);
            }
          });
        },
      };
    }

    function refresh(tab) {
      const render = {
        general: generalTab,
        roles: rolesTab,
        members: membersTab,
        invites: invitesTab,
        danger: dangerTab,
      }[tab]();
      m.body.innerHTML = shell(render.html, tab);
      m.body.querySelector(".settings__nav").addEventListener("click", (e) => {
        const t = e.target.closest("[data-tab]");
        if (!t) return;
        refresh(t.getAttribute("data-tab"));
      });
      render.wire(m.body);
    }

    refresh(active);
  };

  /* =========================================================
     EDITAR PERFIL
     ========================================================= */
  M.editProfile = function () {
    const me = S().me();
    if (!me) return;
    const state = { emoji: me.avatar.emoji || u().emojiFor(me.username), color: me.avatar.color };
    const footer = u().el(
      ACTIONS(
        '<button class="btn btn--ghost" type="button" data-modal-close>Cancelar</button>' +
          '<button class="btn btn--primary" type="submit" form="form-profile" data-busy-label="Salvando">Salvar</button>'
      )
    );
    const m = NX.ui.modal({ title: "Editar perfil", eyebrow: "Sua conta", size: "md", footer });

    m.body.innerHTML =
      '<form id="form-profile" class="form" novalidate>' +
      '<div class="server-preview"><span class="server-preview__icon" data-pp style="--sv:' + state.color + '">' +
      u().h(state.emoji) + "</span>" +
      '<div class="server-preview__txt"><strong data-pn>' + u().h(me.displayName) + "</strong>" +
      "<span>@" + u().h(me.username) + "</span></div></div>" +
      '<div class="field"><span class="field__label">Avatar</span><div class="icon-picker">' +
      emojiGrid(state.emoji) + swatches(state.color, "pick-color") + "</div></div>" +
      '<label class="field"><span class="field__label">Nome de exibição</span>' +
      '<input class="input" name="displayName" maxlength="32" value="' + u().h(me.displayName) + '" data-autofocus /></label>' +
      '<label class="field"><span class="field__label">Nome de usuário</span>' +
      '<input class="input" name="username" maxlength="18" value="' + u().h(me.username) + '" /></label>' +
      '<label class="field"><span class="field__label">E-mail</span>' +
      '<input class="input" name="email" type="email" value="' + u().h(me.email) + '" /></label>' +
      '<label class="field"><span class="field__label">Bio</span>' +
      '<textarea class="input input--area" name="bio" rows="2" maxlength="190" placeholder="Conte quem é você">' +
      u().h(me.bio || "") +
      "</textarea></label>" +
      '<div class=\"field-row\">' +
      '<label class="field"><span class="field__label">Status</span>' +
      '<select class="select" name="status">' +
      Object.keys(NX.STATUS_LABEL)
        .map(
          (k) =>
            '<option value="' + k + '"' + (me.status === k ? " selected" : "") + ">" +
            NX.STATUS_LABEL[k] + "</option>"
        )
        .join("") +
      "</select></label>" +
      '<label class="field"><span class="field__label">Status personalizado</span>' +
      '<input class="input" name="statusText" maxlength="60" placeholder="ex.: estudando" value="' +
      u().h(me.statusText || "") + '" /></label>' +
      "</div>" +
      '<div class="form-error" data-error hidden></div></form>';

    const form = m.body.querySelector("form");
    const pp = m.body.querySelector("[data-pp]");
    const pn = m.body.querySelector("[data-pn]");
    state.onPick = () => {
      pp.textContent = state.emoji;
      pp.style.setProperty("--sv", state.color);
    };
    bindPickers(form, state);
    form.addEventListener("input", () => {
      pn.textContent = form.displayName.value.trim() || me.displayName;
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      showErr(form, "");
      const d = formData(form);
      runTask(
        footer.querySelector('button[type="submit"]'),
        api().updateProfile({
          displayName: d.displayName,
          username: d.username,
          email: d.email,
          bio: d.bio,
          status: d.status,
          statusText: d.statusText,
          avatar: { emoji: state.emoji, color: state.color },
        }),
        form,
        () => {
          m.close();
          NX.ui.toast("Perfil atualizado.", "success");
        }
      );
    });
  };

  /* =========================================================
     NOVA CONVERSA DIRETA
     ========================================================= */
  M.newDM = function () {
    const me = S().me();
    const people = [];
    S().membershipsOf(me.id).forEach((mm) => {
      S().membersOf(mm.serverId).forEach((row) => {
        if (row.user.id !== me.id && !people.some((p) => p.id === row.user.id)) {
          people.push(row.user);
        }
      });
    });
    people.sort((a, b) => (a.status === "online" ? 0 : 1) - (b.status === "online" ? 0 : 1));

    const m = NX.ui.modal({
      title: "Nova conversa",
      eyebrow: "Mensagens diretas",
      size: "sm",
      footer: u().el(ACTIONS('<button class="btn btn--ghost" type="button" data-modal-close>Fechar</button>')),
    });

    const listHTML = (filter) => {
      const f = u().normalize(filter || "");
      const rows = people.filter(
        (p) =>
          !f ||
          u().normalize(p.displayName).indexOf(f) !== -1 ||
          u().normalize(p.username).indexOf(f) !== -1
      );
      if (!rows.length)
        return '<div class="invite-empty">' + NX.icon("users", "", 20) +
          "<span>Nenhuma pessoa encontrada. Entre em um servidor para conhecer gente nova.</span></div>";
      return rows
        .map(
          (p) =>
            '<button class="dm-row" data-open-dm="' + p.id + '">' +
            u().avatarHTML(p, "sm", true) +
            '<span class="dm-row__txt"><strong class="truncate">' + u().h(p.displayName) + "</strong>" +
            '<small class="truncate">@' + u().h(p.username) + " · " +
            u().h(NX.STATUS_LABEL[p.status] || "") +
            "</small></span></button>"
        )
        .join("");
    };

    m.body.innerHTML =
      '<label class="field"><span class="field__label">Buscar pessoa</span>' +
      '<span class="input-affix"><span class="input-affix__ico">' + NX.icon("search", "", 16) +
      '</span><input class="input" data-search placeholder="Nome ou @usuário" data-autofocus /></span></label>' +
      '<div class="dm-list dm-list--modal" data-results>' + listHTML("") + "</div>";

    const search = m.body.querySelector("[data-search]");
    const results = m.body.querySelector("[data-results]");
    search.addEventListener(
      "input",
      u().debounce(() => {
        results.innerHTML = listHTML(search.value);
      }, 160)
    );
    results.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-open-dm]");
      if (!b) return;
      const uid = b.getAttribute("data-open-dm");
      try {
        const dm = await api().openDM(uid);
        m.close();
        NX.app.go("#/mensagens/" + dm.id);
      } catch (err) {
        NX.ui.error(err.message);
      }
    });
  };

  /* =========================================================
     MENUS SUSPENSOS
     ========================================================= */
  M.serverMenu = function (anchor, serverId) {
    const server = S().server(serverId);
    const me = S().me();
    if (!server) return;
    const canManage = S().can(serverId, me.id, "manageServer");
    const canInvite = S().can(serverId, me.id, "createInvite");
    const isOwner = server.ownerId === me.id;

    const items = [
      { heading: server.name },
      canInvite
        ? { label: "Convidar pessoas", icon: "userPlus", onClick: () => M.invite(serverId) }
        : null,
      { label: "Membros", icon: "users", onClick: () => M.serverSettings(serverId, "members") },
      canManage
        ? { label: "Cargos e permissões", icon: "shield", onClick: () => M.serverSettings(serverId, "roles") }
        : null,
      canInvite ? { label: "Convites ativos", icon: "link", onClick: () => M.serverSettings(serverId, "invites") } : null,
      { label: "Configurações do servidor", icon: "settings", onClick: () => M.serverSettings(serverId, "general") },
      { divider: true },
      isOwner
        ? {
            label: "Excluir servidor",
            icon: "trash",
            danger: true,
            onClick: () => M.serverSettings(serverId, "danger"),
          }
        : {
            label: "Sair do servidor",
            icon: "logout",
            danger: true,
            onClick: () => M.serverSettings(serverId, "danger"),
          },
    ].filter(Boolean);

    NX.ui.menu(anchor, items, { align: "start" });
  };

  M.channelMenu = function (anchor, channelId) {
    const ch = S().channel(channelId);
    if (!ch) return;
    NX.ui.menu(
      anchor,
      [
        {
          label: "Copiar link do canal",
          icon: "link",
          onClick: async () => {
            const ok = await u().copy(location.href.split("#")[0] + "#/s/" + ch.serverId + "/" + ch.id);
            NX.ui.toast(ok ? "Link copiado!" : "Não foi possível copiar.", ok ? "success" : "error");
          },
        },
        { divider: true },
        { label: "Editar canal", icon: "pencil", onClick: () => M.channelSettings(channelId) },
        {
          label: "Excluir canal",
          icon: "trash",
          danger: true,
          onClick: () => M.channelSettings(channelId),
        },
      ],
      { align: "start" }
    );
  };

  M.categoryMenu = function (anchor, categoryId) {
    const cat = S().category(categoryId);
    if (!cat) return;
    NX.ui.menu(
      anchor,
      [
        {
          label: "Criar canal aqui",
          icon: "plus",
          onClick: () => M.createChannel(cat.serverId, categoryId),
        },
        { label: "Editar categoria", icon: "pencil", onClick: () => M.categorySettings(categoryId) },
        { divider: true },
        {
          label: "Excluir categoria",
          icon: "trash",
          danger: true,
          onClick: () => M.categorySettings(categoryId),
        },
      ],
      { align: "start" }
    );
  };

  M.profileMenu = function (anchor) {
    const me = S().me();
    if (!me) return;
    const theme = NX.currentTheme();
    NX.ui.menu(
      anchor,
      [
        { heading: me.displayName + " · @" + me.username },
        { label: "Meu perfil", icon: "user", onClick: () => NX.app.go("#/perfil/" + me.id) },
        { label: "Editar perfil", icon: "pencil", onClick: () => M.editProfile() },
        { divider: true },
        { heading: "Status" },
        ...Object.keys(NX.STATUS_LABEL).map((k) => ({
          label: NX.STATUS_LABEL[k],
          icon: k === "online" ? "check" : "clock",
          check: me.status === k,
          onClick: () => NX.api.setStatus(k).catch(() => {}),
        })),
        { divider: true },
        {
          label: theme === "dark" ? "Tema claro" : "Tema escuro",
          icon: "palette",
          onClick: () => NX.applyTheme(theme === "dark" ? "light" : "dark"),
        },
        { label: "Sair da conta", icon: "logout", danger: true, onClick: () => NX.app.logout() },
      ],
      { align: "start", side: "top" }
    );
  };

  /* =========================================================
     CONTINUAR COM GOOGLE
     ========================================================= */
  M.googleSignIn = function () {
    /* provedor real configurado → fluxo do Google de verdade */
    if (NX.google.isConfigured()) {
      const res = NX.google.begin();
      if (res && res.error) NX.ui.error(res.error);
      return;
    }

    /* sem client id: dizemos a verdade e deixamos testar o retorno */
    if (console && console.info) {
      console.info(
        "[Nexo][DEMO] adaptador Google em MODO DEMO — sem client_id configurado, " +
          "nenhum redirecionamento real foi feito."
      );
    }

    const footer = u().el(
      ACTIONS(
        '<button class="btn btn--ghost" type="button" data-modal-close>Cancelar</button>' +
          '<button class="btn btn--primary" type="submit" form="form-google" data-busy-label="Entrando">Continuar com Google</button>'
      )
    );
    const m = NX.ui.modal({
      title: "Continuar com Google",
      eyebrow: "Acesso externo",
      size: "md",
      footer: footer,
    });

    m.body.innerHTML =
      '<div class="notice">' + NX.icon("alert", "", 18) +
      "<div><strong>O acesso com Google ainda não está configurado neste ambiente.</strong>" +
      "<p>Nenhum redirecionamento real foi feito. Informe os dados que o Google devolveria " +
      "para testar o fluxo — em produção este botão leva direto para a conta do Google, " +
      "sem esta janela.</p></div></div>" +
      '<form id="form-google" class="form" novalidate>' +
      '<label class="field"><span class="field__label">E-mail da conta Google</span>' +
      '<input class="input" name="email" type="email" placeholder="voce@gmail.com" data-autofocus /></label>' +
      '<label class="field"><span class="field__label">Nome exibido <em>(opcional)</em></span>' +
      '<input class="input" name="name" placeholder="Como o Google mostra seu nome" /></label>' +
      '<div class="form-error" data-error hidden></div>' +
      "</form>";

    const form = m.body.querySelector("form");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      showErr(form, "");
      const data = formData(form);
      if (!u().isEmail(data.email)) {
        showErr(form, "Digite um endereço de e-mail válido.");
        return;
      }
      runTask(
        footer.querySelector('button[type="submit"]'),
        api().googleSignIn(NX.google.demoProfile(data.email, data.name)),
        form,
        (res) => {
          m.close();
          NX.ui.toast(res.created ? "Conta criada com o Google." : "Bem-vindo de volta!", "success");
          NX.app.afterAuth();
        }
      );
    });
  };

  NX.modals = M;
})(window.NX);
