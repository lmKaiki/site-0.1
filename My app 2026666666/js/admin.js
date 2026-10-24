/* ============================================================
   NEXO · painel de administração do servidor
   ---------------------------------------------------------------------------
   Contrato:
     NX.admin.open(serverId, initialTabId)  → abre o modal de configurações
     NX.admin.tabs(serverId)               → [{id,label,icon,visible}]
   Observações:
     · auto-injeta css/admin.css (index.html pertence a outra pessoa)
     · ações registradas em NX.action com prefixo `adm-`
     · todo campo é filtrado por NX.selectors.can(...) e toda mutação
       passa por NX.api (que também valida permissão e registra log)
     · estado local persistido em NX.storage (regras, filtros, segurança)
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const u = () => NX.util;
  const S = () => NX.selectors;
  const api = () => NX.api;

  /* ---------------- css próprio ---------------- */
  function ensureStyles() {
    if (document.querySelector('link[rel="stylesheet"][href*="admin.css"]')) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "css/admin.css";
    l.setAttribute("data-nx-admin", "1");
    document.head.appendChild(l);
  }

  /* ---------------- estado do painel ---------------- */
  const state = {
    serverId: null,
    modal: null,
    tab: null,
    roleId: null,      /* null | "novo" | id  → editor de cargo */
    memberSub: "todos",
    d: null,           /* rascunho · visão geral */
    a: null,           /* rascunho · aparência */
    r: null,           /* rascunho · editor de cargo */
    e: null            /* rascunho · emoji */
  };

  const admin = {};

  /* ---------------- atalhos ---------------- */
  const esc = (s) => u().h(s);
  const ico = (n, s) => NX.icon(n, "", s || 18);
  const me = () => S().me();
  const srv = () => S().server(state.serverId);
  const can = (k) => !!(me() && S().can(state.serverId, me().id, k));
  const isOwner = () => !!(me() && S().isOwner(state.serverId, me().id));
  const plural = (n, a, b) => u().plural(n, a, b);

  const ok = (msg) => NX.ui.toast(msg, "success");
  const bad = (e) => NX.ui.error((e && e.message) || NX.i18n.get("adm.algoDeuErrado", "Algo deu errado."));

  function reg(name, fn) {
    NX.action(name, fn);
    return fn;
  }

  function errBox() {
    return '<div class="form-error" data-adm-error hidden></div>';
  }

  function showErr(root, msg) {
    if (!root) return;
    const box = root.querySelector("[data-adm-error]");
    if (!box) {
      if (msg) NX.ui.error(msg);
      return;
    }
    box.hidden = !msg;
    box.innerHTML = msg ? ico("alert", 16) + "<span>" + esc(msg) + "</span>" : "";
  }

  /* executa uma tarefa com botão ocupado + erro amigável */
  function run(btn, task, root, onDone) {
    const end = NX.ui.busy(btn);
    Promise.resolve()
      .then(task)
      .then((res) => {
        end();
        if (onDone) onDone(res);
      })
      .catch((e) => {
        end();
        if (e && e.message && root && root.querySelector("[data-adm-error]")) showErr(root, e.message);
        else bad(e);
      });
  }

  function gate(msg) {
    return (
      '<div class="callout callout--info">' + ico("lock", 17) +
      "<span>" + esc(msg || NX.i18n.get("adm.voceNaoTemPermissao", "Você não tem permissão para acessar esta seção.")) + "</span></div>"
    );
  }

  function empty(iconName, title, text, actions) {
    return (
      '<div class="empty-state adm-empty">' +
      '<span class="empty-state__ico">' + ico(iconName, 26) + "</span>" +
      "<h3>" + esc(title) + "</h3><p>" + esc(text) + "</p>" +
      (actions ? '<div class="empty-state__actions">' + actions + "</div>" : "") +
      "</div>"
    );
  }

  function head(title, desc, actions) {
    return (
      '<div class="adm-head">' +
      '<div class="settings__head">' +
      '<h3 class="settings__title">' + esc(title) + "</h3>" +
      (actions ? "<div>" + actions + "</div>" : "") +
      "</div>" +
      (desc ? '<p class="settings__desc">' + desc + "</p>" : "") +
      "</div>"
    );
  }

  function moveBtns(kind, id, i, len) {
    return (
      '<button type="button" class="adm-move" data-action="adm-' + kind + '-up" data-id="' + id + '"' +
      (i <= 0 ? " disabled" : "") + ' title="' + NX.i18n.get("ui.subir", "Subir") + '" aria-label="' + NX.i18n.get("ui.admin.subir", "Subir") + '">▲</button>' +
      '<button type="button" class="adm-move" data-action="adm-' + kind + '-down" data-id="' + id + '"' +
      (i >= len - 1 ? " disabled" : "") + ' title="' + NX.i18n.get("ui.descer", "Descer") + '" aria-label="' + NX.i18n.get("ui.admin.descer", "Descer") + '">▼</button>'
    );
  }

  /* =========================================================
     IMAGENS (upload → canvas, respeita os limites da api)
     ========================================================= */
  function processImage(img, max, maxLen, preferPng) {
    let w = img.naturalWidth || img.width || 1;
    let h = img.naturalHeight || img.height || 1;
    const base = Math.min(1, max / Math.max(w, h));
    w = Math.max(1, Math.round(w * base));
    h = Math.max(1, Math.round(h * base));

    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    let out = "";
    for (let i = 0; i < 6; i++) {
      const s = Math.pow(0.72, i);
      c.width = Math.max(1, Math.round(w * s));
      c.height = Math.max(1, Math.round(h * s));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, c.width, c.height);
      if (preferPng && i === 0) out = c.toDataURL("image/png");
      else out = c.toDataURL("image/jpeg", Math.max(0.5, 0.92 - i * 0.1));
      if (out.length <= maxLen) return out;
    }
    return out;
  }

  function readImage(file, opts) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//i.test(file.type || ""))
        return reject(new Error(NX.i18n.get("adm.envieArquivoImagemPng", "Envie um arquivo de imagem (PNG, JPG ou GIF).")));
      if (file.size > 8 * 1024 * 1024)
        return reject(new Error(NX.i18n.get("adm.estaImagemGrandeDemais", "Esta imagem é grande demais. Use um arquivo de até 8 MB.")));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error(NX.i18n.get("adm.naoFoiPossivelLer", "Não foi possível ler este arquivo.")));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error(NX.i18n.get("adm.naoFoiPossivelCarregar", "Não foi possível carregar esta imagem.")));
        img.onload = () => {
          try {
            resolve(processImage(img, opts.max || 512, opts.maxLen || 800000, !!opts.preferPng));
          } catch (e) {
            reject(new Error(NX.i18n.get("adm.naoFoiPossivelProcessar", "Não foi possível processar esta imagem.")));
          }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* =========================================================
     PICKERS (emoji / cor) — delegados dentro do corpo
     ========================================================= */
  function swatchRow(key, selected) {
    return (
      '<div class="swatch-row" role="group">' +
      u().PALETTE.map(
        (c) =>
          '<button type="button" class="swatch' + (c === selected ? " is-on" : "") +
          '" style="--sw:' + c + '" data-pk="' + key + '" data-val="' + c +
          '" aria-label="' + NX.i18n.get("ui.a11ycor", "Cor ") + c + '"></button>'
      ).join("") +
      "</div>"
    );
  }

  function emojiRow(key, selected) {
    const list = Array.from(new Set(u().EMOJIS));
    return (
      '<div class="emoji-grid emoji-grid--sm">' +
      list
        .map(
          (e) =>
            '<button type="button" class="emoji-grid__item' + (e === selected ? " is-on" : "") +
            '" data-pk="' + key + '" data-val="' + esc(e) + '">' + esc(e) + "</button>"
        )
        .join("") +
      "</div>"
    );
  }

  function pickTarget(key) {
    const [group] = key.split(".");
    if (group === "icon") return state.d;
    if (group === "app") return state.a;
    if (group === "role") return state.r;
    if (group === "emoji") return state.e;
    return null;
  }

  function pickField(key) {
    return key.split(".")[1];
  }

  function bindPickers(root) {
    root.addEventListener("click", (e) => {
      const el = e.target.closest("[data-pk]");
      if (!el || el.tagName === "INPUT") return;
      const key = el.getAttribute("data-pk");
      const val = el.getAttribute("data-val");
      const t = pickTarget(key);
      if (!t || val == null) return;
      t[pickField(key)] = val;
      u().qa('[data-pk="' + key + '"]', root).forEach((b) => b.classList.toggle("is-on", b === el));
      syncPreviews(root);
    });
    u().qa("input[type=color][data-pk]", root).forEach((inp) => {
      const key = inp.getAttribute("data-pk");
      inp.addEventListener("input", () => {
        const t = pickTarget(key);
        if (!t) return;
        t[pickField(key)] = inp.value;
        u().qa('[data-pk="' + key + '"]:not(input)', root).forEach((b) =>
          b.classList.toggle("is-on", b.getAttribute("data-val") === inp.value)
        );
        syncPreviews(root);
      });
    });
  }

  function syncPreviews(root) {
    const d = state.d;
    const a = state.a;
    const r = state.r;
    const e = state.e;

    const icon = root.querySelector('[data-pv="icon"]');
    if (icon && d) {
      icon.style.setProperty("--sv", d.color);
      const glyph = icon.querySelector("[data-pv-glyph]");
      const img = icon.querySelector("[data-pv-img]");
      if (glyph) {
        glyph.textContent = d.image ? "" : d.emoji;
        glyph.hidden = !!d.image;
      }
      if (img) {
        img.hidden = !d.image;
        if (d.image) img.src = d.image;
      }
    }
    const banner = root.querySelector('[data-pv="banner"]');
    if (banner && d) {
      banner.style.backgroundImage = d.banner ? 'url("' + d.banner + '")' : "";
      banner.classList.toggle("has-img", !!d.banner);
    }
    const nameEl = root.querySelector('[data-pv="name"]');
    if (nameEl && d && d.__name) nameEl.textContent = d.__name;

    const look = root.querySelector('[data-pv="look"]');
    if (look && a) {
      look.style.setProperty("--lk1", a.primary);
      look.style.setProperty("--lk2", a.secondary);
      const bg = look.querySelector('[data-pv="look-bg"]');
      if (bg) bg.style.backgroundImage = a.backgroundImage ? 'url("' + a.backgroundImage + '")' : "";
    }

    const roleDot = root.querySelector('[data-pv="role-dot"]');
    if (roleDot && r) roleDot.style.setProperty("--rc", r.color);
    const roleGlyph = root.querySelector('[data-pv="role-glyph"]');
    if (roleGlyph && r) roleGlyph.textContent = r.icon || "⭐";
    const roleChip = root.querySelector('[data-pv="role-chip"]');
    if (roleChip && r) {
      roleChip.style.setProperty("--tc", r.color);
      roleChip.textContent = (r.icon ? r.icon + " " : "") + (r.name || NX.i18n.get("adm.nome2", "Sem nome"));
    }

    const ePrev = root.querySelector('[data-pv="emoji"]');
    if (ePrev && e) {
      const im = ePrev.querySelector("img");
      if (im) {
        im.hidden = !e.image;
        if (e.image) im.src = e.image;
      }
      const sp = ePrev.querySelector("[data-pv-glyph]");
      if (sp) {
        sp.hidden = !!e.image;
        sp.textContent = e.name ? e.name.slice(0, 1).toUpperCase() : ":)";
      }
    }
    const eCode = root.querySelector('[data-pv="emoji-code"]');
    if (eCode && e) eCode.textContent = "<:" + (u().slug(e.name || "").replace(/-/g, "") || "nome") + ":>";
  }

  function bindFiles(root) {
    u().qa('input[type="file"][data-adm-file]', root).forEach((inp) => {
      inp.addEventListener("change", () => {
        const file = inp.files && inp.files[0];
        inp.value = "";
        if (!file) return;
        const kind = inp.getAttribute("data-adm-file");
        const opts =
          kind === "banner"
            ? { max: 1400, maxLen: 1300000 }
            : kind === "bg"
            ? { max: 1200, maxLen: 1300000 }
            : kind === "emoji"
            ? { max: 128, maxLen: 700000, preferPng: true }
            : { max: 256, maxLen: 700000, preferPng: true };
        readImage(file, opts)
          .then((url) => {
            if (kind === "icon" && state.d) state.d.image = url;
            else if (kind === "banner" && state.d) state.d.banner = url;
            else if (kind === "bg" && state.a) state.a.backgroundImage = url;
            else if (kind === "emoji" && state.e) state.e.image = url;
            else return;
            syncPreviews(root);
            NX.ui.toast(NX.i18n.get("adm.imagemProntaCliqueSalvar", "Imagem pronta — clique em Salvar para aplicar."), "info");
          })
          .catch(bad);
      });
    });
  }

  /* =========================================================
     MODAIS AUXILIARES
     ========================================================= */
  function actions(innerHTML) {
    return u().el('<div class="modal__actions">' + innerHTML + "</div>");
  }

  function inputModal(opts) {
    const footer = actions(
      ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
        '<button class="btn btn--primary" type="submit" data-busy-label="Salvando">' +
        esc(opts.confirmLabel || (NX.i18n.get("common.save", "Salvar"))) + "</button>"
    );
    const m = NX.ui.modal({
      title: opts.title,
      eyebrow: opts.eyebrow || (srv() ? srv().name : "Nexo"),
      size: "sm",
      footer: footer,
    });
    m.body.innerHTML =
      '<form novalidate>' +
      '<label class="field"><span class="field__label">' + esc(opts.label) + "</span>" +
      '<input class="input" name="value" maxlength="' + (opts.maxlength || 40) +
      '" value="' + esc(opts.value || "") + '" placeholder="' + esc(opts.placeholder || "") +
      '" data-autofocus /></label>' +
      (opts.hint ? '<p class="form-note">' + esc(opts.hint) + "</p>" : "") +
      errBox() +
      "</form>";
    const form = m.body.querySelector("form");
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      showErr(m.body, "");
      run(
        form.querySelector('button[type="submit"]'),
        () => opts.onSubmit(form.elements.value.value),
        m.body,
        () => {
          m.close();
          if (opts.onDone) opts.onDone();
        }
      );
    });
    return m;
  }

  /* modal com campo opcional de motivo (expulsar / banir) */
  function reasonModal(opts) {
    return new Promise((resolve) => {
      let settled = false;
      const footer = actions(
        ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
          '<button class="btn ' + (opts.danger ? "btn--danger" : "btn--primary") +
          '" type="submit" data-busy-label="Confirmando">' + esc(opts.confirmLabel) + "</button>"
      );
      const m = NX.ui.modal({
        title: opts.title,
        eyebrow: opts.eyebrow || (srv() ? srv().name : "Nexo"),
        size: "sm",
        footer: footer,
        onClose: () => {
          if (!settled) resolve(null);
        },
      });
      m.body.innerHTML =
        '<div class="adm-reason">' +
        '<div class="confirm__icon' + (opts.danger ? " is-danger" : "") + '">' + ico(opts.icon || "alert", 24) + "</div>" +
        '<p class="confirm__text">' + opts.message + "</p>" +
        '<form novalidate>' +
        ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.motivo", "Motivo") + " " + "<em>" + NX.i18n.get("adm.opcional", "(opcional)") + "</em></span>") +
        '<textarea class="input input--area" name="reason" rows="2" maxlength="160" placeholder="' +
        esc(opts.placeholder || NX.i18n.get("adm.estaAcaoEstaSendo", "Por que esta ação está sendo tomada?")) + '"></textarea></label>' +
        errBox() +
        "</form></div>";
      const form = m.body.querySelector("form");
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        showErr(m.body, "");
        run(
          form.querySelector('button[type="submit"]'),
          () => opts.onSubmit(form.elements.reason.value),
          m.body,
          (res) => {
            settled = true;
            m.close();
            resolve(res);
          }
        );
      });
    });
  }

  /* =========================================================
     AÇÕES GLOBAIS (prefixo adm-)
     ========================================================= */
  reg("adm-open", (el) => admin.open(el.getAttribute("data-id"), el.getAttribute("data-tab")));

  reg("adm-tab", (el) => {
    if (!state.modal) return;
    state.tab = el.getAttribute("data-tab");
    state.roleId = null;
    state.memberSub = "todos";
    render();
  });

  reg("adm-member-tab", (el) => {
    state.memberSub = el.getAttribute("data-sub");
    render();
  });

  /* ---- ícone / banner / fundo ---- */
  reg("adm-icon-clear", () => {
    if (!state.d || !state.modal) return;
    state.d.image = null;
    syncPreviews(state.modal.body);
  });
  reg("adm-banner-clear", () => {
    if (!state.d || !state.modal) return;
    state.d.banner = null;
    syncPreviews(state.modal.body);
  });
  reg("adm-bg-clear", () => {
    if (!state.a || !state.modal) return;
    state.a.backgroundImage = null;
    syncPreviews(state.modal.body);
  });

  /* ---- canais ---- */
  reg("adm-new-channel", () => newChannelModal());
  reg("adm-chan-menu", (el) => channelMenu(el, el.getAttribute("data-id")));
  reg("adm-chan-up", (el) => moveChannel(el.getAttribute("data-id"), -1));
  reg("adm-chan-down", (el) => moveChannel(el.getAttribute("data-id"), 1));

  /* ---- categorias ---- */
  reg("adm-new-category", () => newCategoryModal());
  reg("adm-cat-menu", (el) => categoryMenu(el, el.getAttribute("data-id")));
  reg("adm-cat-up", (el) => moveCategory(el.getAttribute("data-id"), -1));
  reg("adm-cat-down", (el) => moveCategory(el.getAttribute("data-id"), 1));

  /* ---- cargos ---- */
  reg("adm-role-open", (el) => {
    state.roleId = el.getAttribute("data-id");
    render();
  });
  reg("adm-role-back", () => {
    state.roleId = null;
    render();
  });
  reg("adm-role-up", (el) => moveRole(el.getAttribute("data-id"), -1));
  reg("adm-role-down", (el) => moveRole(el.getAttribute("data-id"), 1));
  reg("adm-role-del", (el) => deleteRole(el.getAttribute("data-id")));
  reg("adm-role-preset", (el) => createFromPreset(el.getAttribute("data-key")));

  /* ---- membros ---- */
  reg("adm-member-menu", (el) => memberMenu(el, el.getAttribute("data-id")));
  reg("adm-member-profile", (el) => {
    NX.app.go("#/perfil/" + el.getAttribute("data-id"));
  });

  /* ---- convites ---- */
  reg("adm-invite-new", (el) => createInviteNow(el));
  reg("adm-invite-copy", async (el) => {
    const code = el.getAttribute("data-code");
    const good = await u().copy(inviteLink(code));
    NX.ui.toast(good ? NX.i18n.get("adm.linkConviteCopiado", "Link do convite copiado!") : NX.i18n.get("adm.naoFoiPossivelCopiar2", "Não foi possível copiar."), good ? "success" : "error");
  });
  reg("adm-invite-revoke", (el) => revokeInviteNow(el.getAttribute("data-code")));

  /* ---- emojis ---- */
  reg("adm-emoji-del", (el) => deleteEmoji(el.getAttribute("data-id")));
  reg("adm-emoji-copy", async (el) => {
    const good = await u().copy("<:" + el.getAttribute("data-name") + ":>");
    NX.ui.toast(good ? NX.i18n.get("adm.sintaxeCopiada", "Sintaxe copiada!") : NX.i18n.get("adm.naoFoiPossivelCopiar2", "Não foi possível copiar."), good ? "success" : "error");
  });

  /* ---- moderação local ---- */
  reg("adm-rules-save", (el) => saveRules(el));
  reg("adm-filters-save", (el) => saveFilters(el));

  /* ---- banidos ---- */
  reg("adm-unban", (el) => unbanNow(el.getAttribute("data-id")));

  /* ---- segurança ---- */
  reg("adm-security-save", (el) => saveSecurity(el));

  /* ---- zona perigosa ---- */
  reg("adm-delete-server", () => openDeleteModal());
  reg("adm-transfer", (el) => transferNow(el));

  /* =========================================================
     1 · VISÃO GERAL
     ========================================================= */
  function tabVisao() {
    if (!can("manageServer")) return { html: gate(NX.i18n.get("adm.soAdministradoresPodemEditar", "Só administradores podem editar este servidor.")), wire: noop };
    const s = srv();
    state.d = {
      emoji: (s.icon && s.icon.emoji) || u().emojiFor(s.name),
      color: (s.icon && s.icon.color) || u().colorFor(s.id),
      image: (s.icon && s.icon.image) || null,
      banner: s.banner || null
    };

    const html =
      head(
        NX.i18n.get("adm.visaoGeral", "Visão geral"),
        NX.i18n.get("adm.identidadeServidorPreVisualizacao", "Identidade do servidor. A pré-visualização abaixo muda antes de você salvar.")
      ) +
      '<form novalidate data-adm-form="visao">' +
      '<div class="adm-hero">' +
      '<div class="adm-hero__banner' + (s.banner ? " has-img" : "") + '" data-pv="banner"' +
      (s.banner ? ' style="background-image:url(&quot;' + esc(s.banner) + '&quot;)"' : "") + ">" +
      ("<span class=\"adm-hero__banner-ph\">" + NX.i18n.get("adm.sembanner", "Sem banner") + "</span>") +
      "</div>" +
      '<div class="adm-hero__row">' +
      '<span class="adm-hero__icon" data-pv="icon" style="--sv:' + esc(state.d.color) + '">' +
      '<span data-pv-glyph>' + esc(state.d.emoji) + "</span>" +
      '<img data-pv-img alt=""' + (state.d.image ? ' src="' + state.d.image + '"' : " hidden") + " />" +
      "</span>" +
      '<div class="adm-hero__txt"><strong data-pv="name">' + esc(s.name) + "</strong>" +
      "<span>" + plural(S().memberCount(s.id), "membro", "membros") +
      " · " + plural(S().channelsOf(s.id).length, "canal", "canais") + "</span></div>" +
      "</div></div>" +

      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.nomedoservidor", "Nome do servidor") + "</span>") +
      '<input class="input" name="name" maxlength="40" value="' + esc(s.name) + '" data-autofocus /></label>' +

      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.iconeemojiecor", "Ícone · emoji e cor") + "</span>") +
      emojiRow("icon.emoji", state.d.emoji) +
      swatchRow("icon.color", state.d.color) +
      '<div class="adm-inline">' +
      ("<label class=\"btn btn--soft btn--sm\">" + NX.i18n.get("adm.enviarimagem", "Enviar imagem") + "<input type=\"file\" accept=\"image/*\" data-adm-file=\"icon\" hidden /></label>") +
      ("<button type=\"button\" class=\"btn btn--ghost btn--sm\" data-action=\"adm-icon-clear\">" + NX.i18n.get("adm.removerimagem", "Remover imagem") + "</button>") +
      ("<span class=\"adm-inline__hint\">" + NX.i18n.get("adm.pngoujpgredimensionadopara256", "PNG ou JPG · redimensionado para 256 px") + "</span>") +
      "</div></div>" +

      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.banner", "Banner") + "</span>") +
      '<div class="adm-inline">' +
      ("<label class=\"btn btn--soft btn--sm\">" + NX.i18n.get("adm.enviarbanner", "Enviar banner") + "<input type=\"file\" accept=\"image/*\" data-adm-file=\"banner\" hidden /></label>") +
      ("<button type=\"button\" class=\"btn btn--ghost btn--sm\" data-action=\"adm-banner-clear\">" + NX.i18n.get("adm.removerbanner", "Remover banner") + "</button>") +
      ("<span class=\"adm-inline__hint\">" + NX.i18n.get("adm.aparecenotopodoperfildo", "Aparece no topo do perfil do servidor · até 1,5 MB") + "</span>") +
      "</div></div>" +

      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.descricao3", "Descrição") + "</span>") +
      '<textarea class="input input--area" name="description" rows="3" maxlength="240" placeholder="' + NX.i18n.get("ui.oqueacontecenesteservidor", "O que acontece neste servidor?") + '">' +
      esc(s.description || "") + "</textarea>" +
      ("<span class=\"field__hint\">" + NX.i18n.get("adm.aparecenapaginadeconvitee", "Aparece na página de convite e no explorar.") + "</span></label>") +

      ("<label class=\"perm-row\"><span class=\"perm-row__txt\"><strong>" + NX.i18n.get("adm.mostrarnoexplorar", "Mostrar no explorar") + "</strong>") +
      ("<small>" + NX.i18n.get("adm.deixaacomunidadevisivelnodiretorio", "Deixa a comunidade visível no diretório público.") + "</small></span>") +
      '<span class="switch"><input type="checkbox" name="discoverable"' + (s.discoverable ? " checked" : "") +
      " /><i></i></span></label>" +

      errBox() +
      '<div class="settings__save"><button class="btn btn--primary" type="submit" data-busy-label="Salvando">' +
      (NX.i18n.get("adm.salvarAlteracoes", "Salvar alterações") + "</button></div>") +
      "</form>";

    return { html: html, wire: wireVisao };
  }

  function wireVisao(root) {
    const form = root.querySelector('[data-adm-form="visao"]');
    if (!form) return;
    const nameInput = form.elements.name;
    nameInput.addEventListener("input", () => {
      const el = root.querySelector('[data-pv="name"]');
      if (el) el.textContent = nameInput.value.trim() || srv().name;
      if (state.d) state.d.__name = nameInput.value.trim();
    });
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      showErr(root, "");
      const d = state.d;
      run(
        form.querySelector('button[type="submit"]'),
        () =>
          api().updateServer(state.serverId, {
            name: form.elements.name.value,
            description: form.elements.description.value,
            icon: { emoji: d.emoji, color: d.color, image: d.image },
            banner: d.banner,
            discoverable: !!form.elements.discoverable.checked
          }),
        root,
        () => {
          ok(NX.i18n.get("adm.configuracoesSalvas", "Configurações salvas."));
          render();
        }
      );
    });
  }

  /* =========================================================
     2 · APARÊNCIA
     ========================================================= */
  function tabAparencia() {
    if (!can("manageServer")) return { html: gate(), wire: noop };
    const s = srv();
    const ap = s.appearance || {};
    state.a = {
      primary: ap.primary || "#35e0a8",
      secondary: ap.secondary || "#8f83ff",
      backgroundImage: ap.backgroundImage || null,
      theme: ap.theme === "light" ? "light" : "dark"
    };

    const html =
      head((NX.i18n.get("adm.aparencia", "Aparência")), (NX.i18n.get("adm.coresfundoetemadoservidor", "Cores, fundo e tema do servidor. O cartão abaixo é uma pré-visualização ao vivo — nada é salvo até você clicar em Salvar."))) +
      '<form novalidate data-adm-form="aparencia">' +
      '<div class="adm-look" data-pv="look" style="--lk1:' + esc(state.a.primary) + ";--lk2:" + esc(state.a.secondary) + '">' +
      '<div class="adm-look__banner" data-pv="look-bg"' +
      (state.a.backgroundImage ? ' style="background-image:url(&quot;' + esc(state.a.backgroundImage) + '&quot;)"' : "") +
      "></div>" +
      '<div class="adm-look__body">' +
      '<span class="adm-look__ico">' + esc((s.icon && s.icon.emoji) || u().emojiFor(s.name)) + "</span>" +
      '<div class="adm-look__txt"><strong>' + esc(s.name) + "</strong><span>" +
      esc(s.description || NX.i18n.get("adm.descricao2", "Sem descrição.")) + "</span></div>" +
      ("<div class=\"adm-look__btns\"><span class=\"adm-look__btn\">" + NX.i18n.get("adm.entrar", "Entrar") + "</span><span class=\"adm-look__chip\">" + NX.i18n.get("adm.novato", "novato") + "</span></div>") +
      "</div></div>" +

      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.corprincipal", "Cor principal") + "</span>") +
      swatchRow("app.primary", state.a.primary) +
      '<div class="adm-inline"><input type="color" data-pk="app.primary" value="' + esc(state.a.primary) +
      '" class="adm-color" aria-label="' + NX.i18n.get("ui.corprincipalpersonalizada", "Cor principal personalizada") + '" /></div></div>' +

      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.corsecundaria", "Cor secundária") + "</span>") +
      swatchRow("app.secondary", state.a.secondary) +
      '<div class="adm-inline"><input type="color" data-pk="app.secondary" value="' + esc(state.a.secondary) +
      '" class="adm-color" aria-label="' + NX.i18n.get("ui.corsecundariapersonalizada", "Cor secundária personalizada") + '" /></div></div>' +

      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.imagemdefundo", "Imagem de fundo") + " " + ("<em>" + NX.i18n.get("adm.opcional", "(opcional)") + "</em></span>")) +
      '<div class="adm-inline">' +
      ("<label class=\"btn btn--soft btn--sm\">" + NX.i18n.get("adm.enviarimagem", "Enviar imagem") + "<input type=\"file\" accept=\"image/*\" data-adm-file=\"bg\" hidden /></label>") +
      ("<button type=\"button\" class=\"btn btn--ghost btn--sm\" data-action=\"adm-bg-clear\">" + NX.i18n.get("adm.removerfundo", "Remover fundo") + "</button>") +
      ("<span class=\"adm-inline__hint\">" + NX.i18n.get("adm.atrasdocartaodeboasvindas", "Atrás do cartão de boas-vindas") + "</span>") +
      "</div></div>" +

      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.temadoservidor", "Tema do servidor") + "</span>") +
      '<select class="select" name="theme">' +
      '<option value="dark"' + (state.a.theme === "dark" ? " selected" : "") + (NX.i18n.get("adm.escuropadrao", ">Escuro (padrão)") + "</option>") +
      '<option value="light"' + (state.a.theme === "light" ? " selected" : "") + (">" + NX.i18n.get("adm.claro", "Claro") + "</option>") +
      "</select>" +
      ("<span class=\"field__hint\">" + NX.i18n.get("adm.defineapreferenciadequementra", "Define a preferência de quem entra neste servidor.") + "</span></label>") +

      errBox() +
      '<div class="settings__save"><button class="btn btn--primary" type="submit" data-busy-label="Salvando">' +
      (NX.i18n.get("adm.salvaraparencia", "Salvar aparência") + "</button></div>") +
      "</form>";

    return { html: html, wire: wireAparencia };
  }

  function wireAparencia(root) {
    const form = root.querySelector('[data-adm-form="aparencia"]');
    if (!form) return;
    form.elements.theme.addEventListener("change", () => {
      if (state.a) state.a.theme = form.elements.theme.value;
    });
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      showErr(root, "");
      const a = state.a;
      run(
        form.querySelector('button[type="submit"]'),
        () =>
          api().updateServer(state.serverId, {
            appearance: {
              primary: a.primary,
              secondary: a.secondary,
              backgroundImage: a.backgroundImage,
              theme: a.theme
            }
          }),
        root,
        () => {
          ok(NX.i18n.get("adm.aparenciaAtualizada", "Aparência atualizada."));
          render();
        }
      );
    });
  }

  /* =========================================================
     3 · CANAIS
     ========================================================= */
  function tabCanais() {
    if (!can("manageChannels")) return { html: gate(NX.i18n.get("adm.soAdministradoresPodemGerenciar", "Só administradores podem gerenciar canais.")), wire: noop };
    const cats = S().categoriesOf(state.serverId);
    const actionsHTML =
      '<button type="button" class="btn btn--soft btn--sm" data-action="adm-new-category">' +
      ico("folderPlus", 15) + (" " + NX.i18n.get("adm.novaCategoria", "Nova categoria") + "</button>") +
      '<button type="button" class="btn btn--primary btn--sm" data-action="adm-new-channel">' +
      ico("plus", 15) + (" " + NX.i18n.get("adm.novoCanal", "Novo canal") + "</button>");

    if (!cats.length)
      return {
        html:
          head((NX.i18n.get("adm.canais2", "Canais")), NX.i18n.get("adm.organizeCategoriasCanaisTexto", "Organize categorias e canais de texto e voz."), actionsHTML) +
          empty("hash", NX.i18n.get("adm.nenhumaCategoriaAinda", "Nenhuma categoria ainda"), NX.i18n.get("adm.crieCategoriaComecarOrganizar", "Crie uma categoria para começar a organizar os canais do servidor."),
            ("<button type=\"button\" class=\"btn btn--primary\" data-action=\"adm-new-category\">" + NX.i18n.get("modal.criarCategoria", "Criar categoria") + "</button>")),
        wire: noop
      };

    const body = cats
      .map((cat) => {
        const chans = S().channelsOfCategory(cat.id);
        const ci = cats.indexOf(cat);
        return (
          '<div class="adm-cat">' +
          '<div class="adm-cat__head">' +
          ico("folder", 15) +
          '<strong class="adm-cat__name truncate">' + esc(cat.name) + "</strong>" +
          '<span class="adm-cat__count">' + plural(chans.length, "canal", "canais") + "</span>" +
          '<span class="spacer"></span>' +
          moveBtns("cat", cat.id, ci, cats.length) +
          '<button type="button" class="adm-move adm-move--more" data-action="adm-cat-menu" data-id="' + cat.id +
          '" aria-label="' + NX.i18n.get("ui.opcoesdacategoria", "Opções da categoria") + '">' + ico("more", 16) + "</button>" +
          "</div>" +
          (chans.length
            ? chans
                .map((ch, i) => {
                  const sameType = chans.filter((x) => x.type === ch.type);
                  const si = sameType.indexOf(ch);
                  return (
                    '<div class="adm-chan">' +
                    '<span class="adm-chan__ico">' + ico(ch.type === "voice" ? "voice" : "hash", 16) + "</span>" +
                    '<span class="adm-chan__name truncate">' + esc(ch.name) + "</span>" +
                    '<span class="tag">' + (ch.type === "voice" ? "voz" : "texto") + "</span>" +
                    '<span class="spacer"></span>' +
                    moveBtns("chan", ch.id, si, sameType.length) +
                    '<button type="button" class="adm-move adm-move--more" data-action="adm-chan-menu" data-id="' + ch.id +
                    '" aria-label="' + NX.i18n.get("ui.opcoesdocanal", "Opções do canal") + '">' + ico("more", 16) + "</button>" +
                    "</div>"
                  );
                })
                .join("")
            : ("<p class=\"adm-cat__empty\">" + NX.i18n.get("adm.nenhumcanalnestacategoria", "Nenhum canal nesta categoria.") + "</p>")) +
          "</div>"
        );
      })
      .join("");

    return { html: head((NX.i18n.get("adm.canais2", "Canais")), NX.i18n.get("adm.categoriasAgrupamCanaisUse", "Categorias agrupam canais. Use ▲▼ para reordenar e ⋯ para editar."), actionsHTML) + body, wire: noop };
  }

  /* ordenação protótipo: api.updateChannel valida permissão; o corpo local
     do protótipo ainda não expõe `order`, então normalizamos em seguida. */
  async function applyOrder(list, scope, scopeKey) {
    list.forEach((item, i) => {
      item[scopeKey] = i;
    });
    NX.store.commit([scope]);
  }

  async function moveChannel(id, dir) {
    const ch = S().channel(id);
    if (!ch) return;
    const chans = S().channelsOfCategory(ch.categoryId);
    const sameType = chans.filter((x) => x.type === ch.type);
    const i = sameType.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= sameType.length) return;
    const moved = sameType.slice();
    moved.splice(j, 0, moved.splice(i, 1)[0]);
    const others = chans.filter((x) => x.type !== ch.type);
    const finalList = ch.type === "text" ? moved.concat(others) : others.concat(moved);
    const newIdx = finalList.findIndex((x) => x.id === id);
    try {
      /* valida permissão + registra log no api.js */
      await api().updateChannel(id, { order: newIdx });
    } catch (e) {
      bad(e);
      return;
    }
    await applyOrder(finalList, "channels", "order");
    render();
  }

  async function moveCategory(id, dir) {
    if (!can("manageChannels")) {
      NX.ui.error(NX.i18n.get("adm.voceNaoTemPermissao2", "Você não tem permissão para reordenar categorias."));
      return;
    }
    const cats = S().categoriesOf(state.serverId);
    const i = cats.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= cats.length) return;
    cats.splice(j, 0, cats.splice(i, 1)[0]);
    await applyOrder(cats, "categories", "order");
    render();
  }

  function channelMenu(anchor, id) {
    const ch = S().channel(id);
    if (!ch) return;
    NX.ui.menu(anchor, [
      { label: NX.i18n.get("adm.renomearCanal2", "Renomear canal"), icon: "pencil", onClick: () => renameChannel(id) },
      { label: NX.i18n.get("adm.moverCima", "Mover para cima"), icon: "chevronDown", disabled: false, onClick: () => moveChannel(id, -1) },
      { label: NX.i18n.get("adm.moverBaixo", "Mover para baixo"), icon: "chevronDown", onClick: () => moveChannel(id, 1) },
      { divider: true },
      { label: NX.i18n.get("adm.excluirCanal", "Excluir canal"), icon: "trash", danger: true, onClick: () => deleteChannel(id) }
    ]);
  }

  function categoryMenu(anchor, id) {
    const cat = S().category(id);
    if (!cat) return;
    NX.ui.menu(anchor, [
      { label: NX.i18n.get("adm.renomearCategoria2", "Renomear categoria"), icon: "pencil", onClick: () => renameCategory(id) },
      { divider: true },
      { label: NX.i18n.get("adm.excluirCategoria", "Excluir categoria"), icon: "trash", danger: true, onClick: () => deleteCategory(id) }
    ]);
  }

  function renameChannel(id) {
    const ch = S().channel(id);
    if (!ch) return;
    inputModal({
      title: NX.i18n.get("adm.renomearCanal2", "Renomear canal"),
      label: NX.i18n.get("adm.nomeCanal", "Nome do canal"),
      value: ch.name,
      maxlength: 32,
      confirmLabel: (NX.i18n.get("common.save", "Salvar")),
      onSubmit: (v) => api().updateChannel(id, { name: v }),
      onDone: () => {
        ok(NX.i18n.get("adm.canalRenomeado", "Canal renomeado."));
        render();
      }
    });
  }

  function deleteChannel(id) {
    const ch = S().channel(id);
    if (!ch) return;
    NX.ui.confirm({
      title: (NX.i18n.get("adm.excluir", "Excluir #")) + ch.name,
      message: (NX.i18n.get("adm.todasasmensagensdestecanalserao", "Todas as mensagens deste canal serão apagadas. Esta ação não pode ser desfeita.")),
      confirmLabel: (NX.i18n.get("common.delete", "Excluir")),
      danger: true,
      icon: "trash"
    }).then((yes) => {
      if (!yes) return;
      api()
        .deleteChannel(id)
        .then(() => {
          ok(NX.i18n.get("adm.canalExcluido", "Canal excluído."));
          render();
        })
        .catch(bad);
    });
  }

  function newChannelModal() {
    const cats = S().categoriesOf(state.serverId);
    if (!cats.length) {
      NX.ui.toast(NX.i18n.get("adm.crieCategoriaAntesAdicionar", "Crie uma categoria antes de adicionar canais."), "warn");
      return;
    }
    const footer = actions(
      ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
        ("<button class=\"btn btn--primary\" type=\"submit\" data-busy-label=\"Criando\">" + NX.i18n.get("modal.criarCanal", "Criar canal") + "</button>")
    );
    const m = NX.ui.modal({ title: NX.i18n.get("adm.novoCanal", "Novo canal"), eyebrow: srv().name, size: "sm", footer });
    m.body.innerHTML =
      '<form novalidate>' +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.nome3", "Nome") + "</span>") +
      '<input class="input" name="name" maxlength="32" placeholder="' + NX.i18n.get("ui.exduvidas", "ex.: duvidas") + '" data-autofocus /></label>' +
      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.tipo", "Tipo") + "</span>") +
      '<div class="type-switch">' +
      '<button type="button" class="type-switch__btn is-on" data-chtype="text">' + ico("hash", 17) +
      ("<span><strong>" + NX.i18n.get("adm.texto", "Texto") + "</strong><small>" + NX.i18n.get("adm.mensagensearquivos", "mensagens e arquivos") + "</small></span></button>") +
      '<button type="button" class="type-switch__btn" data-chtype="voice">' + ico("voice", 17) +
      (("<span><strong>" + NX.i18n.get("adm.voz", "Voz") + "</strong><small>") + NX.i18n.get("adm.audioevideochamada", "áudio e videochamada") + "</small></span></button>") +
      "</div></div>" +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.categoria", "Categoria") + "</span>") +
      '<select class="select" name="categoryId">' +
      cats.map((c) => '<option value="' + c.id + '">' + esc(c.name) + "</option>").join("") +
      "</select></label>" +
      errBox() +
      "</form>";
    const form = m.body.querySelector("form");
    let type = "text";
    m.body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-chtype]");
      if (!b) return;
      type = b.getAttribute("data-chtype");
      u().qa("[data-chtype]", m.body).forEach((x) => x.classList.toggle("is-on", x === b));
    });
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      showErr(m.body, "");
      run(
        form.querySelector('button[type="submit"]'),
        () =>
          api().createChannel(state.serverId, {
            name: form.elements.name.value,
            type: type,
            categoryId: form.elements.categoryId.value
          }),
        m.body,
        () => {
          m.close();
          ok(NX.i18n.get("adm.canalCriado", "Canal criado."));
          render();
        }
      );
    });
  }

  /* =========================================================
     4 · CATEGORIAS
     ========================================================= */
  function tabCategorias() {
    if (!can("manageChannels")) return { html: gate(NX.i18n.get("adm.soAdministradoresPodemGerenciar2", "Só administradores podem gerenciar categorias.")), wire: noop };
    const cats = S().categoriesOf(state.serverId);
    const actionsHTML =
      '<button type="button" class="btn btn--primary btn--sm" data-action="adm-new-category">' +
      ico("plus", 15) + (" " + NX.i18n.get("adm.novaCategoria", "Nova categoria") + "</button>");

    if (!cats.length)
      return {
        html:
          head((NX.i18n.get("adm.categorias", "Categorias")), NX.i18n.get("adm.agrupeCanaisAssuntoFacilitar", "Agrupe canais por assunto para facilitar a navegação."), actionsHTML) +
          empty("folder", NX.i18n.get("adm.nenhumaCategoria", "Nenhuma categoria"), NX.i18n.get("adm.categoriasOrganizamCanaisComece", "Categorias organizam os canais — comece criando a primeira."),
            ("<button type=\"button\" class=\"btn btn--primary\" data-action=\"adm-new-category\">" + NX.i18n.get("modal.criarCategoria", "Criar categoria") + "</button>")),
        wire: noop
      };

    const rows = cats
      .map((cat, i) => {
        const n = S().channelsOfCategory(cat.id).length;
        return (
          '<div class="adm-cat adm-cat--row">' +
          '<span class="adm-cat__head">' +
          ico("folder", 15) +
          '<strong class="adm-cat__name truncate">' + esc(cat.name) + "</strong>" +
          '<span class="adm-cat__count">' + plural(n, "canal", "canais") + "</span>" +
          '<span class="spacer"></span>' +
          moveBtns("cat", cat.id, i, cats.length) +
          '<button type="button" class="adm-move adm-move--more" data-action="adm-cat-menu" data-id="' + cat.id +
          '" aria-label="' + NX.i18n.get("ui.admin.opcoesdacategoria", "Opções da categoria") + '">' + ico("more", 16) + "</button>" +
          "</span></div>"
        );
      })
      .join("");

    return {
      html:
        head((NX.i18n.get("adm.categorias", "Categorias")), NX.i18n.get("adm.cadaCategoriaViraGrupo", "Cada categoria vira um grupo na barra lateral. Renomeie, reordene ou exclua."), actionsHTML) +
        '<div class="adm-cats">' + rows + "</div>",
      wire: noop
    };
  }

  function newCategoryModal() {
    const footer = actions(
      ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
        ("<button class=\"btn btn--primary\" type=\"submit\" data-busy-label=\"Criando\">" + NX.i18n.get("modal.criarCategoria", "Criar categoria") + "</button>")
    );
    const m = NX.ui.modal({ title: NX.i18n.get("adm.novaCategoria", "Nova categoria"), eyebrow: srv().name, size: "sm", footer });
    m.body.innerHTML =
      '<form novalidate>' +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.nome3", "Nome") + "</span>") +
      '<input class="input" name="name" maxlength="32" placeholder="' + NX.i18n.get("ui.excomunidade", "ex.: COMUNIDADE") + '" data-autofocus /></label>' +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.primeirocanal", "Primeiro canal") + " " + ("<em>" + NX.i18n.get("adm.opcional", "(opcional)") + "</em></span>")) +
      '<input class="input" name="channel" maxlength="32" placeholder="' + NX.i18n.get("ui.exgeral", "ex.: geral") + '" /></label>' +
      errBox() +
      "</form>";
    const form = m.body.querySelector("form");
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      showErr(m.body, "");
      run(
        form.querySelector('button[type="submit"]'),
        () =>
          api().createCategory(state.serverId, {
            name: form.elements.name.value,
            firstChannel: form.elements.channel.value.trim()
          }),
        m.body,
        () => {
          m.close();
          ok(NX.i18n.get("adm.categoriaCriada", "Categoria criada."));
          render();
        }
      );
    });
  }

  function renameCategory(id) {
    const cat = S().category(id);
    if (!cat) return;
    inputModal({
      title: NX.i18n.get("adm.renomearCategoria2", "Renomear categoria"),
      label: NX.i18n.get("adm.nomeCategoria", "Nome da categoria"),
      value: cat.name,
      maxlength: 32,
      onSubmit: (v) => api().renameCategory(id, v),
      onDone: () => {
        ok(NX.i18n.get("adm.categoriaRenomeada", "Categoria renomeada."));
        render();
      }
    });
  }

  function deleteCategory(id) {
    const cat = S().category(id);
    if (!cat) return;
    const n = S().channelsOfCategory(id).length;
    NX.ui.confirm({
      title: (NX.i18n.get("common.delete", "Excluir") + " ") + cat.name,
      message:
        (NX.i18n.get("adm.acategoriae", "A categoria e") + " ") + plural(n, NX.i18n.get("adm.canal", "o canal"), NX.i18n.get("adm.canais", "os canais")) +
        (" " + NX.i18n.get("adm.dentrodelaseraoapagadosjuntocom", "dentro dela serão apagados junto com as mensagens. Não dá para desfazer.")),
      confirmLabel: (NX.i18n.get("common.delete", "Excluir")),
      danger: true,
      icon: "trash"
    }).then((yes) => {
      if (!yes) return;
      api()
        .deleteCategory(id)
        .then(() => {
          ok(NX.i18n.get("adm.categoriaExcluida", "Categoria excluída."));
          render();
        })
        .catch(bad);
    });
  }

  /* =========================================================
     5 · CARGOS  (+ presets)
     ========================================================= */
  const PRESETS = [
    { key: "dono", glyph: "👑", name: (NX.i18n.get("adm.dono3", "DONO")), fixed: true },
    {
      key: "admin",
      glyph: "🛡️",
      name: "ADMIN",
      color: "#35e0a8",
      description: NX.i18n.get("adm.administraServidorJuntoDono", "Administra o servidor junto com o dono."),
      permissions: ["administrator"]
    },
    {
      key: "moderador",
      glyph: "🔨",
      name: (NX.i18n.get("adm.moderador", "MODERADOR")),
      color: "#8f83ff",
      description: NX.i18n.get("adm.mantemConversaSaudavelCuida", "Mantém a conversa saudável e cuida dos membros."),
      permissions: [
        "viewChannels", "sendMessages", "createInvite", "joinVoice", "speak",
        "manageMembers", "kickMembers", "banMembers", "unbanMembers", "timeoutMembers",
        "editMessages", "deleteMessages", "pinMessages", "viewLogs"
      ]
    },
    {
      key: "vip",
      glyph: "⭐",
      name: (NX.i18n.get("adm.vip", "VIP")),
      color: "#ff7ab6",
      description: NX.i18n.get("adm.apoiadoresColaboradoresEspeciais", "Apoiadores e colaboradores especiais."),
      permissions: [
        "viewChannels", "sendMessages", "createInvite", "attachFiles",
        "useEmojis", "useCustomEmojis", "useGifs", "joinVoice", "speak"
      ]
    },
    {
      key: "membro",
      glyph: "👤",
      name: (NX.i18n.get("adm.membro", "MEMBRO")),
      color: "#93a8a4",
      description: NX.i18n.get("adm.cargoPadraoQuemEntra", "Cargo padrão de quem entra no servidor."),
      permissions: ["viewChannels", "sendMessages", "createInvite", "joinVoice", "speak"]
    }
  ];

  function tabCargos() {
    if (!can("manageRoles")) return { html: gate(NX.i18n.get("adm.soAdministradoresPodemGerenciar3", "Só administradores podem gerenciar cargos.")), wire: noop };
    if (state.roleId) return roleEditor();

    const s = srv();
    const owner = S().user(s.ownerId);
    const roles = S().rolesOf(state.serverId);

    const presets =
      '<div class="adm-presets">' +
      PRESETS.map(
        (p) =>
          '<button type="button" class="adm-preset' + (p.fixed ? " is-fixed" : "") +
          '" data-action="adm-role-preset" data-key="' + p.key + '"' +
          (p.fixed ? ' title="' + NX.i18n.get("ui.cargofixododononaopodesereditado", "Cargo fixo do dono — não pode ser editado") + '"' : "") + ">" +
          '<span class="adm-preset__ico">' + p.glyph + "</span>" +
          "<span><strong>" + esc(p.name) + "</strong><small>" +
          (p.fixed ? NX.i18n.get("adm.soDonoFixo", "só dono · fixo") : NX.i18n.get("adm.criarPreset", "criar preset")) +
          "</small></span></button>"
      ).join("") +
      "</div>";

    const ownerRow =
      '<div class="adm-role adm-role--owner">' +
      '<span class="adm-role__ico">👑</span>' +
      ("<span class=\"adm-role__txt\"><strong style=\"--tc:#ffc857\">" + NX.i18n.get("adm.dono3", "DONO") + "</strong>") +
      "<small>" + esc(owner ? owner.displayName : "—") +
      (" " + NX.i18n.get("adm.cargofixonaoeditaveltodasas", "· cargo fixo, não editável · todas as permissões") + "</small></span>") +
      ("<span class=\"tag tag--owner\">" + NX.i18n.get("adm.fixo", "Fixo") + "</span></div>");

    const rows = roles.length
      ? roles
          .map((r) => {
            const members = Object.values(NX.store.db.memberships).filter(
              (m) => m.serverId === state.serverId && m.roleId === r.id
            ).length;
            const granted = NX.PERM_KEYS.filter((k) => r.permissions && r.permissions[k]).length;
            const ordered = roles.filter((x) => !x.isDefault);
            return (
              '<div class="adm-role" data-action="adm-role-open" data-id="' + r.id + '" role="button" tabindex="0">' +
              '<span class="adm-role__ico">' + esc(r.icon || "🎭") + "</span>" +
              '<span class="adm-role__txt"><strong style="--tc:' + esc(r.color) + '">' + esc(r.name) +
              (r.isDefault ? (" <em class=\"adm-role__badge\">" + NX.i18n.get("adm.padrao", "padrão") + "</em>") : "") + "</strong>" +
              "<small>" + esc(r.description || NX.i18n.get("adm.descricao2", "Sem descrição.")) + (" " + NX.i18n.get("adm.posicao", "· posição") + " ") + r.position +
              " · " + plural(members, "membro", "membros") + " · " + granted + "/" + NX.PERM_KEYS.length +
              (" " + NX.i18n.get("adm.permissoes", "permissões") + "</small></span>") +
              '<span class="adm-role__acts">' +
              (r.isDefault
                ? '<span class="adm-move is-locked" title="' + NX.i18n.get("ui.ocargopadraonaopodesermovidonemexcluido", "O cargo padrão não pode ser movido nem excluído") + '">🔒</span>'
                : moveBtns("role", r.id, ordered.indexOf(r), ordered.length) +
                  '<button type="button" class="adm-move adm-move--more" data-action="adm-role-del" data-id="' + r.id +
                  '" aria-label="' + NX.i18n.get("modal.excluirCargo", "Excluir cargo") + '">' + ico("trash", 15) + "</button>") +
              "</span></div>"
            );
          })
          .join("")
      : empty("shield", NX.i18n.get("adm.nenhumCargo", "Nenhum cargo"), NX.i18n.get("adm.crieCargosAgruparPermissoes", "Crie cargos para agrupar permissões e destacar membros."));

    return {
      html:
        head(
          (NX.i18n.get("adm.cargos", "Cargos")),
          (NX.i18n.get("adm.cargosagrupampermissoesquantomaisalto", "Cargos agrupam permissões — quanto mais alto na lista, maior a hierarquia. Clique em um cargo para abrir o editor.")),
          '<button type="button" class="btn btn--primary btn--sm" data-action="adm-role-open" data-id="novo">' +
            ico("plus", 15) + (" " + NX.i18n.get("adm.criarCargo2", "Criar cargo") + "</button>")
        ) +
        ("<div class=\"adm-sub-title\">" + NX.i18n.get("adm.presetsrapidos", "Presets rápidos") + "</div>") +
        presets +
        ownerRow +
        ("<div class=\"adm-sub-title\">" + NX.i18n.get("adm.cargosdoservidor", "Cargos do servidor") + "</div>") +
        '<div class="adm-roles">' + rows + "</div>",
      wire: noop
    };
  }

  function createFromPreset(key) {
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    if (p.fixed) {
      NX.ui.toast(NX.i18n.get("adm.cargoDonoExclusivoDono", "O cargo 👑 DONO é exclusivo do dono e fica fixo no topo."), "info");
      return;
    }
    const exists = S().rolesOf(state.serverId).find((r) => r.name.toUpperCase() === p.name);
    if (exists) {
      state.roleId = exists.id;
      render();
      NX.ui.toast((NX.i18n.get("adm.jaexisteumcargo", "Já existe um cargo “")) + p.name + (NX.i18n.get("adm.abrimosoeditor", "” — abrimos o editor.")), "info");
      return;
    }
    const perms = {};
    NX.PERM_KEYS.forEach((k) => (perms[k] = p.permissions.indexOf(k) !== -1));
    api()
      .createRole(state.serverId, {
        name: p.name,
        color: p.color,
        icon: p.glyph,
        description: p.description,
        permissions: perms
      })
      .then((role) => {
        state.roleId = role.id;
        ok((NX.i18n.get("adm.cargo", "Cargo") + " ") + p.name + " criado.");
        render();
      })
      .catch(bad);
  }

  async function moveRole(id, dir) {
    const roles = S().rolesOf(state.serverId).filter((r) => !r.isDefault);
    const i = roles.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= roles.length) return;
    try {
      await api().updateRole(roles[j].id, { position: roles[i].position });
      await api().updateRole(id, { position: roles[j].position });
      ok(NX.i18n.get("adm.ordemCargosAtualizada", "Ordem dos cargos atualizada."));
      render();
    } catch (e) {
      bad(e);
    }
  }

  function deleteRole(id) {
    const r = S().role(id);
    if (!r) return;
    if (r.isDefault) {
      NX.ui.toast(NX.i18n.get("adm.cargoPadraoNaoPode", "O cargo padrão não pode ser excluído."), "warn");
      return;
    }
    NX.ui.confirm({
      title: (NX.i18n.get("modal.excluirCargo", "Excluir cargo") + " ") + r.name,
      message: (NX.i18n.get("adm.membroscom", "Membros com “")) + r.name + (NX.i18n.get("adm.voltamparaocargopadraodo", "” voltam para o cargo padrão do servidor.")),
      confirmLabel: (NX.i18n.get("common.delete", "Excluir")),
      danger: true,
      icon: "shield"
    }).then((yes) => {
      if (!yes) return;
      api()
        .deleteRole(id)
        .then(() => {
          if (state.roleId === id) state.roleId = null;
          ok(NX.i18n.get("adm.cargoExcluido", "Cargo excluído."));
          render();
        })
        .catch(bad);
    });
  }

  /* ---- 6 · editor de cargo (sub-aba dentro de Cargos) ---- */
  function roleEditor() {
    const isNew = state.roleId === "novo";
    const role = isNew ? null : S().role(state.roleId);
    if (!isNew && !role) {
      state.roleId = null;
      return tabCargos();
    }
    const roles = S().rolesOf(state.serverId);
    state.r = {
      color: role ? role.color : "#8f83ff",
      icon: role && role.icon ? role.icon : "⭐",
      name: role ? role.name : ""
    };
    const perms = {};
    NX.PERM_KEYS.forEach((k) => (perms[k] = role ? !!(role.permissions && role.permissions[k]) : k === "viewChannels" || k === "sendMessages"));

    const groups = {};
    NX.PERMS.forEach((p) => {
      (groups[p.group] = groups[p.group] || []).push(p);
    });

    const html =
      '<div class="adm-editor">' +
      '<div class="adm-editor__top">' +
      '<button type="button" class="btn btn--ghost btn--sm" data-action="adm-role-back">' +
      ico("arrowLeft", 15) + (" " + NX.i18n.get("adm.cargos", "Cargos") + "</button>") +
      '<h3 class="settings__title">' + (isNew ? NX.i18n.get("adm.criarCargo2", "Criar cargo") : NX.i18n.get("adm.editarCargo", "Editar cargo")) + "</h3>" +
      "</div>" +
      ("<p class=\"settings__desc\">" + NX.i18n.get("adm.nomeidentidadeepermissoesagrupadaspor", "Nome, identidade e permissões agrupadas por categoria.") + "</p>") +
      '<form novalidate data-adm-form="role">' +

      '<div class="role-preview">' +
      '<span class="role-preview__dot" data-pv="role-dot" style="--rc:' + esc(state.r.color) + '"></span>' +
      '<input class="input input--role" name="name" maxlength="30" placeholder="' + NX.i18n.get("ui.nomedocargo", "Nome do cargo") + '" value="' +
      esc(state.r.name) + '" data-autofocus />' +
      "</div>" +

      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.cordocargo", "Cor do cargo") + "</span>") +
      swatchRow("role.color", state.r.color) +
      '<div class="adm-inline">' +
      '<input type="color" data-pk="role.color" value="' + esc(state.r.color) + '" class="adm-color" aria-label="' + NX.i18n.get("ui.corpersonalizada", "Cor personalizada") + '" />' +
      ("<span class=\"adm-inline__hint\">" + NX.i18n.get("adm.useacorparaidentificaro", "Use a cor para identificar o cargo nas listas e no chat.") + "</span></div></div>") +

      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.iconedocargo", "Ícone do cargo") + "</span>") +
      emojiRow("role.icon", state.r.icon) +
      '<div class="adm-inline"><span class="adm-chip" data-pv="role-chip" style="--tc:' + esc(state.r.color) + '">' +
      esc((state.r.icon || "⭐") + " " + (state.r.name || NX.i18n.get("adm.nome2", "Sem nome"))) + "</span>" +
      ("<span class=\"adm-inline__hint\">" + NX.i18n.get("adm.previsualizacaodocargo", "Pré-visualização do cargo") + "</span></div></div>") +

      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.descricao3", "Descrição") + "</span>") +
      '<textarea class="input input--area" name="description" rows="2" maxlength="120" placeholder="' + NX.i18n.get("ui.paraqueserveestecargo", "Para que serve este cargo?") + '">' +
      esc(role ? role.description || "" : "") + "</textarea></label>" +

      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.posicaonahierarquia", "Posição na hierarquia") + "</span>") +
      '<input class="input" type="number" name="position" min="1" max="' + Math.max(1, roles.length) +
      '" value="' + (role ? Math.max(1, role.position) : Math.max(1, roles.length)) + '" />' +
      ("<span class=\"field__hint\">" + NX.i18n.get("adm.quantomaioronumeromaisalto", "Quanto maior o número, mais alto o cargo aparece.") + "</span></label>") +

      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.permissoes2", "Permissões") + "</span>") +
      '<div class="perm-list">' +
      Object.keys(groups)
        .map(
          (g) =>
            '<div class="perm-group"><span class="perm-group__title">' + esc(g) + "</span>" +
            groups[g]
              .map(
                (p) =>
                  '<label class="perm-row' + (p.super ? " is-super" : "") + '">' +
                  '<span class="perm-row__txt"><strong>' + esc(p.label) + "</strong><small>" +
                  esc(p.desc) + "</small></span>" +
                  '<span class="switch"><input type="checkbox" name="perm_' + p.key + '"' +
                  (perms[p.key] ? " checked" : "") + " /><i></i></span></label>"
              )
              .join("") +
            "</div>"
        )
        .join("") +
      "</div>" +
      ("<p class=\"form-note\">" + NX.i18n.get("adm.odonoequemtem", "O dono e quem tem") + " " + ("<strong>" + NX.i18n.get("adm.administrador", "Administrador") + "</strong>") + " " + NX.i18n.get("adm.semprerecebemtodasaspermissoesalteracoes", "sempre recebem todas as permissões. Alterações individuais de membros sobrepõem o cargo.") + "</p>") +
      "</div>" +

      errBox() +
      '<div class="settings__save">' +
      (!isNew && !role.isDefault
        ? '<button type="button" class="btn btn--danger-soft" data-action="adm-role-del" data-id="' + role.id +
          (NX.i18n.get("adm.excluircargo", "\">Excluir cargo") + "</button><span class=\"spacer\"></span>")
        : "") +
      '<button class="btn btn--primary" type="submit" data-busy-label="Salvando">' +
      (isNew ? NX.i18n.get("adm.criarCargo2", "Criar cargo") : NX.i18n.get("adm.salvarAlteracoes", "Salvar alterações")) +
      "</button></div>" +
      "</form></div>";

    return { html: html, wire: wireRole };
  }

  function wireRole(root) {
    const form = root.querySelector('[data-adm-form="role"]');
    if (!form) return;
    const nameInput = form.elements.name;
    nameInput.addEventListener("input", () => {
      if (state.r) state.r.name = nameInput.value.trim();
      syncPreviews(root);
    });
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      showErr(root, "");
      const permissions = {};
      NX.PERM_KEYS.forEach((k) => (permissions[k] = !!(form.elements["perm_" + k] && form.elements["perm_" + k].checked)));
      const payload = {
        name: form.elements.name.value,
        color: state.r.color,
        icon: state.r.icon,
        description: form.elements.description.value,
        position: Number(form.elements.position.value) || 1,
        permissions: permissions
      };
      const isNew = state.roleId === "novo";
      run(
        form.querySelector('button[type="submit"]'),
        async () => {
          if (isNew) {
            const role = await api().createRole(state.serverId, payload);
            if (payload.position !== role.position) await api().updateRole(role.id, { position: payload.position });
            return role;
          }
          return api().updateRole(state.roleId, payload);
        },
        root,
        () => {
          ok(isNew ? NX.i18n.get("adm.cargoCriado", "Cargo criado.") : NX.i18n.get("adm.cargoAtualizado", "Cargo atualizado."));
          state.roleId = null;
          render();
        }
      );
    });
  }

  /* =========================================================
     7 · MEMBROS
     ========================================================= */
  function isModerator(serverId, userId, role) {
    if (S().isOwner(serverId, userId)) return true;
    const p = S().effectivePerms(serverId, userId);
    return !!(p.administrator || p.manageMembers || p.kickMembers || p.banMembers || p.viewLogs);
  }

  function tabMembros() {
    if (!can("manageMembers")) return { html: gate(NX.i18n.get("adm.soAdministradoresPodemGerenciar4", "Só administradores podem gerenciar membros.")), wire: noop };
    const sub = state.memberSub;
    const canBan = can("banMembers");

    const subs =
      '<div class="adm-sub">' +
      ["todos", "moderadores", "banidos"]
        .filter((x) => x !== "banidos" || canBan)
        .map(
          (x) =>
            '<button type="button" class="adm-sub__btn' + (sub === x ? " is-on" : "") +
            '" data-action="adm-member-tab" data-sub="' + x + '">' +
            (x === "todos" ? (NX.i18n.get("reg.privacyAll", "Todos")) : x === "moderadores" ? (NX.i18n.get("adm.moderadores", "Moderadores")) : (NX.i18n.get("adm.banidos", "Banidos"))) +
            "</button>"
        )
        .join("") +
      "</div>";

    let inner = "";
    if (sub === "banidos" && canBan) inner = bansList();
    else {
      const all = S().membersOf(state.serverId);
      const list = sub === "moderadores" ? all.filter((m) => isModerator(state.serverId, m.user.id, m.role)) : all;
      inner = list.length ? '<div class="adm-members">' + list.map(memberRow).join("") + "</div>" : empty(
        "users",
        sub === "moderadores" ? NX.i18n.get("adm.nenhumModerador", "Nenhum moderador") : NX.i18n.get("adm.nenhumMembro", "Nenhum membro"),
        sub === "moderadores"
          ? NX.i18n.get("adm.quemTemCargosModeracao", "Quem tem cargos de moderação aparece aqui automaticamente.")
          : NX.i18n.get("adm.membrosEntraramServidorAparecem", "Os membros que entraram no servidor aparecem aqui.")
      );
    }

    return {
      html:
        head((NX.i18n.get("adm.membros", "Membros")), plural(S().memberCount(state.serverId), "membro", "membros") + (" " + NX.i18n.get("adm.noservidoruseparamoderar", "no servidor. Use ⋯ para moderar.")), "") +
        subs + inner,
      wire: noop
    };
  }

  function memberRow(row) {
    const s = srv();
    const user = row.user;
    const isOwnerRow = s.ownerId === user.id;
    const role = row.role;
    const nick = row.membership.nickname;
    const status = user.status || "offline";
    return (
      '<div class="adm-mem">' +
      u().avatarHTML(user, "sm", true) +
      '<span class="adm-mem__txt"><strong class="truncate">' +
      esc(nick || user.displayName) + "</strong>" +
      "<small>@" + esc(user.username) +
      (nick ? " · " + esc(user.displayName) : "") + "</small></span>" +
      '<span class="adm-mem__role">' +
      (isOwnerRow
        ? ("<span class=\"tag tag--owner\">" + NX.i18n.get("adm.dono", "👑 Dono") + "</span>")
        : '<span class="tag" style="--tc:' + esc(role ? role.color : "#93a8a4") + '">' +
          esc((role && role.icon ? role.icon + " " : "") + (role ? role.name : (NX.i18n.get("adm.membro2", "Membro")))) +
          "</span>") +
      "</span>" +
      '<span class="status-pill" data-status="' + esc(status) + '">' +
      esc(NX.STATUS_LABEL[status] || NX.i18n.get("core.statusOffline", "Offline")) + "</span>" +
      '<span class="spacer"></span>' +
      '<button type="button" class="adm-move adm-move--more" data-action="adm-member-menu" data-id="' + user.id +
      '" aria-label="Opções de ' + esc(user.displayName) + '">' + ico("more", 16) + "</button>" +
      "</div>"
    );
  }

  function memberMenu(anchor, userId) {
    const s = srv();
    const user = S().user(userId);
    const membership = S().membership(state.serverId, userId);
    if (!user || !membership) return;
    const ownerRow = s.ownerId === userId;
    const self = me().id === userId;
    const items = [];

    items.push({ label: NX.i18n.get("adm.verPerfil", "Ver perfil"), icon: "user", onClick: () => NX.app.go("#/perfil/" + userId) });

    if (can("manageRoles") && !ownerRow && !self) {
      items.push({ divider: true }, { heading: (NX.i18n.get("adm.cargo", "Cargo")) });
      S().rolesOf(state.serverId).forEach((r) => {
        items.push({
          label: (r.icon ? r.icon + " " : "") + r.name,
          check: membership.roleId === r.id,
          onClick: () => setRole(userId, r.id, r.name)
        });
      });
      items.push({ divider: true });
      items.push({ label: NX.i18n.get("adm.permissoesIndividuais", "Permissões individuais"), icon: "shield", onClick: () => memberPermsModal(userId) });
    }

    if ((can("manageMembers") || self) && !ownerRow) {
      items.push({ label: NX.i18n.get("adm.apelidoServidor2", "Apelido no servidor"), icon: "pencil", onClick: () => nicknameModal(userId) });
    }

    if (!ownerRow && !self) {
      if (can("kickMembers")) items.push({ divider: true }, { label: (NX.i18n.get("adm.expulsar2", "Expulsar")), icon: "logout", danger: true, onClick: () => kickMember(userId) });
      if (can("banMembers")) items.push({ label: (NX.i18n.get("adm.banir2", "Banir")), icon: "lock", danger: true, onClick: () => banMember(userId) });
    }

    NX.ui.menu(anchor, items, { align: "end" });
  }

  function setRole(userId, roleId, roleName) {
    api()
      .setMemberRole(state.serverId, userId, roleId)
      .then(() => {
        ok((NX.i18n.get("adm.cargoalteradopara", "Cargo alterado para") + " ") + roleName + ".");
        render();
      })
      .catch(bad);
  }

  function memberPermsModal(userId) {
    const user = S().user(userId);
    if (!user) return;
    const current = S().effectivePerms(state.serverId, userId);
    const groups = {};
    NX.PERMS.forEach((p) => (groups[p.group] = groups[p.group] || []).push(p));

    const footer = actions(
      ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
        ("<button class=\"btn btn--primary\" type=\"submit\" data-busy-label=\"Salvando\">" + NX.i18n.get("adm.salvarpermissoes", "Salvar permissões") + "</button>")
    );
    const m = NX.ui.modal({
      title: (NX.i18n.get("adm.permissoesde", "Permissões de") + " ") + user.displayName,
      eyebrow: srv().name,
      size: "md",
      footer: footer
    });
    m.body.innerHTML =
      '<div class="member-mini">' + u().avatarHTML(user, "sm", true) +
      "<span><strong>" + esc(user.displayName) + "</strong><small>@" + esc(user.username) + "</small></span></div>" +
      '<form novalidate>' +
      '<div class="perm-list">' +
      Object.keys(groups)
        .map(
          (g) =>
            '<div class="perm-group"><span class="perm-group__title">' + esc(g) + "</span>" +
            groups[g]
              .map(
                (p) =>
                  '<label class="perm-row"><span class="perm-row__txt"><strong>' + esc(p.label) +
                  "</strong><small>" + esc(p.desc) + "</small></span>" +
                  '<span class="switch"><input type="checkbox" name="perm_' + p.key + '"' +
                  (current[p.key] ? " checked" : "") + " /><i></i></span></label>"
              )
              .join("") +
            "</div>"
        )
        .join("") +
      "</div>" +
      ("<p class=\"form-note\">" + NX.i18n.get("adm.estaspermissoesindividuaissobrepoemocargo", "Estas permissões individuais sobrepõem o cargo do membro.") + "</p>") +
      errBox() +
      "</form>";

    const form = m.body.querySelector("form");
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      showErr(m.body, "");
      const patch = {};
      NX.PERM_KEYS.forEach((k) => (patch[k] = !!(form.elements["perm_" + k] && form.elements["perm_" + k].checked)));
      run(
        footer.querySelector('button[type="submit"]'),
        () => api().updateMemberPerms(state.serverId, userId, patch),
        m.body,
        () => {
          m.close();
          ok(NX.i18n.get("adm.permissoesAtualizadas", "Permissões atualizadas."));
        }
      );
    });
  }

  function nicknameModal(userId) {
    const user = S().user(userId);
    const membership = S().membership(state.serverId, userId);
    if (!user || !membership) return;
    inputModal({
      title: NX.i18n.get("adm.apelidoServidor2", "Apelido no servidor"),
      label: (NX.i18n.get("adm.apelidode", "Apelido de") + " ") + user.displayName,
      value: membership.nickname || "",
      maxlength: 32,
      placeholder: NX.i18n.get("adm.comoApareceNesteServidor", "Como aparece neste servidor"),
      hint: NX.i18n.get("adm.deixeVazioVoltarNome", "Deixe vazio para voltar ao nome original."),
      confirmLabel: NX.i18n.get("adm.salvarApelido", "Salvar apelido"),
      onSubmit: (v) => api().setNickname(state.serverId, userId, v),
      onDone: () => {
        ok(NX.i18n.get("adm.apelidoAtualizado", "Apelido atualizado."));
        render();
      }
    });
  }

  function kickMember(userId) {
    const user = S().user(userId);
    if (!user) return;
    reasonModal({
      title: (NX.i18n.get("adm.expulsar", "Expulsar @")) + user.username,
      message:
        (NX.i18n.get("adm.vocedesejaexpulsar", "Você deseja expulsar") + " " + "<strong>@") + esc(user.username) +
        ("</strong>" + " " + NX.i18n.get("adm.desteservidorelepoderaentrarnovamente", "deste servidor? Ele poderá entrar novamente com um novo convite.")),
      confirmLabel: (NX.i18n.get("adm.expulsar2", "Expulsar")),
      danger: true,
      icon: "logout",
      onSubmit: (reason) => api().kickMember(state.serverId, userId, reason)
    }).then((res) => {
      if (!res) return;
      ok(user.displayName + (" " + NX.i18n.get("adm.foiexpulso", "foi expulso.")));
      render();
    });
  }

  function banMember(userId) {
    const user = S().user(userId);
    if (!user) return;
    reasonModal({
      title: (NX.i18n.get("adm.banir", "Banir @")) + user.username,
      message:
        (NX.i18n.get("adm.vocedesejabanir", "Você deseja banir") + " " + "<strong>@") + esc(user.username) +
        ("</strong>" + " " + NX.i18n.get("adm.desteservidor", "deste servidor?")),
      confirmLabel: (NX.i18n.get("adm.banir2", "Banir")),
      danger: true,
      icon: "lock",
      onSubmit: (reason) => api().banMember(state.serverId, userId, reason)
    }).then((res) => {
      if (!res) return;
      ok(user.displayName + (" " + NX.i18n.get("adm.foibanido", "foi banido.")));
      render();
    });
  }

  /* =========================================================
     8 · CONVITES
     ========================================================= */
  function inviteLink(code) {
    return location.origin + location.pathname + "#/convite/" + code;
  }

  function tabConvites() {
    if (!can("createInvite")) return { html: gate(NX.i18n.get("adm.voceNaoTemPermissao3", "Você não tem permissão para criar convites.")), wire: noop };
    const invites = S().invitesOf(state.serverId);

    const create =
      '<div class="adm-card">' +
      '<div class="adm-card__head">' + ico("link", 16) + ("<strong>" + NX.i18n.get("adm.novoconvite", "Novo convite") + "</strong></div>") +
      '<div class="field-row">' +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.expiracao", "Expiração") + "</span>") +
      '<select class="select" name="expiresIn" data-adm-exp>' +
      ("<option value=\"60\">" + NX.i18n.get("adm.1hora", "1 hora") + "</option>") +
      ("<option value=\"1440\" selected>" + NX.i18n.get("adm.24horas", "24 horas") + "</option>") +
      ("<option value=\"10080\">" + NX.i18n.get("adm.7dias", "7 dias") + "</option>") +
      ("<option value=\"0\">" + NX.i18n.get("adm.nuncaexpira", "Nunca expira") + "</option>") +
      "</select></label>" +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.maximodeusos", "Máximo de usos") + "</span>") +
      '<select class="select" name="maxUses" data-adm-uses>' +
      ("<option value=\"0\">" + NX.i18n.get("adm.semlimite", "∞ (sem limite)") + "</option>") +
      ("<option value=\"1\">" + NX.i18n.get("adm.1uso", "1 uso") + "</option>") +
      ("<option value=\"5\" selected>" + NX.i18n.get("adm.5usos", "5 usos") + "</option>") +
      ("<option value=\"10\">" + NX.i18n.get("adm.10usos", "10 usos") + "</option>") +
      ("<option value=\"25\">" + NX.i18n.get("adm.25usos", "25 usos") + "</option>") +
      "</select></label>" +
      "</div>" +
      '<button type="button" class="btn btn--primary" data-action="adm-invite-new">' +
      ico("plus", 16) + (" " + NX.i18n.get("adm.criarconvite", "Criar convite") + "</button>") +
      "</div>";

    const list = invites.length
      ? '<div class="adm-invites">' +
        invites
          .map((i) => {
            const creator = S().user(i.creatorId);
            const expired = i.expiresAt && i.expiresAt < Date.now();
            return (
              '<div class="adm-invite">' +
              '<span class="adm-invite__code mono">' + esc(i.code) + "</span>" +
              '<span class="adm-invite__meta">' +
              "<strong>" + esc(creator ? creator.displayName : "—") + "</strong> · " +
              (i.uses || 0) + (i.maxUses ? "/" + i.maxUses : "") + (" " + NX.i18n.get("adm.usos", "usos ·") + " ") +
              (i.expiresAt
                ? "expira " + esc(NX.time.dateTime(i.expiresAt, { day: "2-digit", month: "2-digit" }))
                : NX.i18n.get("adm.nuncaExpira", "nunca expira")) +
              (expired ? (" <span class=\"adm-invite__bad\">" + NX.i18n.get("adm.expirado", "expirado") + "</span>") : "") +
              "</span>" +
              '<span class="spacer"></span>' +
              '<button type="button" class="btn btn--ghost btn--sm" data-action="adm-invite-copy" data-code="' +
              esc(i.code) + '">' + ico("copy", 15) + (" " + NX.i18n.get("adm.copiarlink", "Copiar link") + "</button>") +
              '<button type="button" class="btn btn--ghost btn--sm btn--danger-text" data-action="adm-invite-revoke" data-code="' +
              esc(i.code) + ("\">" + NX.i18n.get("adm.revogar", "Revogar") + "</button>") +
              "</div>"
            );
          })
          .join("") +
        "</div>"
      : empty("link", NX.i18n.get("adm.nenhumConviteAtivo", "Nenhum convite ativo"), NX.i18n.get("adm.gereLinkAcimaConvidar", "Gere um link acima para convidar pessoas para o servidor."));

    return {
      html:
        head((NX.i18n.get("set.item.privacyInvites", "Convites")), NX.i18n.get("adm.cadaCodigoAbrePorta", "Cada código abre a porta para o seu servidor. Revogue quando quiser.")) +
        create +
        ("<div class=\"adm-sub-title\">" + NX.i18n.get("adm.convitesativos", "Convites ativos ·") + " ") + invites.length + "</div>" +
        list,
      wire: noop
    };
  }

  function createInviteNow(btn) {
    if (!state.modal) return;
    const root = state.modal.body;
    const exp = root.querySelector("[data-adm-exp]");
    const uses = root.querySelector("[data-adm-uses]");
    run(
      btn,
      () =>
        api().createInvite(state.serverId, {
          expiresIn: Number(exp ? exp.value : 1440),
          maxUses: Number(uses ? uses.value : 0)
        }),
      root,
      (inv) => {
        ok((NX.i18n.get("adm.convite", "Convite") + " ") + inv.code + " criado.");
        render();
        setTimeout(() => {
          const code = inv.code;
          const el = state.modal && state.modal.body.querySelector('[data-code="' + code + '"][data-action="adm-invite-copy"]');
          if (el) el.focus();
        }, 0);
      }
    );
  }

  function revokeInviteNow(code) {
    NX.ui.confirm({
      title: (NX.i18n.get("adm.revogarconvite", "Revogar convite") + " ") + code,
      message: NX.i18n.get("adm.quemJaUsouLink", "Quem já usou o link continua no servidor, mas o link para de funcionar."),
      confirmLabel: (NX.i18n.get("adm.revogar", "Revogar")),
      danger: true,
      icon: "link"
    }).then((yes) => {
      if (!yes) return;
      api()
        .revokeInvite(code)
        .then(() => {
          ok(NX.i18n.get("adm.conviteRevogado", "Convite revogado."));
          render();
        })
        .catch(bad);
    });
  }

  /* =========================================================
     9 · EMOJIS
     ========================================================= */
  function tabEmojis() {
    if (!can("manageChannels")) return { html: gate(NX.i18n.get("adm.soAdministradoresPodemGerenciar5", "Só administradores podem gerenciar emojis.")), wire: noop };
    state.e = state.e && state.e.keep ? state.e : { name: "", image: null };

    const add =
      '<form class="adm-card" novalidate data-adm-form="emoji">' +
      '<div class="adm-card__head">' + ico("smile", 16) + ("<strong>" + NX.i18n.get("adm.adicionaremoji", "Adicionar emoji") + "</strong></div>") +
      '<div class="adm-emoji-add">' +
      '<span class="adm-emoji-prev" data-pv="emoji">' +
      '<span data-pv-glyph>😀</span><img alt="" hidden /></span>' +
      '<div class="adm-emoji-add__fields">' +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.nome3", "Nome") + "</span>") +
      '<input class="input" name="name" maxlength="24" placeholder="' + NX.i18n.get("ui.exfire", "ex.: fire") + '" data-autofocus /></label>' +
      '<div class="adm-inline">' +
      ("<label class=\"btn btn--soft btn--sm\">" + NX.i18n.get("adm.escolherimagem", "Escolher imagem") + "<input type=\"file\" accept=\"image/*\" data-adm-file=\"emoji\" hidden /></label>") +
      ("<span class=\"adm-inline__hint\">" + NX.i18n.get("adm.reduzidapara128pxate1", "Reduzida para 128 px · até 1 MB") + "</span>") +
      "</div></div></div>" +
      ("<p class=\"form-note\">" + NX.i18n.get("adm.sintaxe", "Sintaxe:") + " " + "<code class=\"mono\" data-pv=\"emoji-code\">&lt;:nome:&gt;</code></p>") +
      errBox() +
      '<div class="settings__save"><button class="btn btn--primary" type="submit" data-busy-label="Adicionando">' +
      (NX.i18n.get("adm.adicionaremoji", "Adicionar emoji") + "</button></div>") +
      "</form>";

    const list = S().serverEmojis(state.serverId);
    const grid = list.length
      ? '<div class="adm-emojis">' +
        list
          .map(
            (e) =>
              '<div class="adm-emoji">' +
              '<span class="adm-emoji__img"><img src="' + e.image + '" alt="' + esc(e.name) + '" /></span>' +
              '<span class="adm-emoji__txt"><strong class="truncate">' + esc(e.name) + "</strong>" +
              '<code class="mono">&lt;:' + esc(e.name) + ':&gt;</code></span>' +
              '<span class="spacer"></span>' +
              '<button type="button" class="btn btn--ghost btn--sm" data-action="adm-emoji-copy" data-name="' +
              esc(e.name) + '">' + ico("copy", 15) + "</button>" +
              '<button type="button" class="btn btn--ghost btn--sm btn--danger-text" data-action="adm-emoji-del" data-id="' +
              e.id + ("\">" + NX.i18n.get("common.delete", "Excluir") + "</button>") +
              "</div>"
          )
          .join("") +
        "</div>"
      : empty("smile", NX.i18n.get("adm.nenhumEmojiPersonalizado", "Nenhum emoji personalizado"), (NX.i18n.get("adm.adicioneimagensparausalascomo", "Adicione imagens para usá-las como") + " " + ("<:nome:>" + " " + NX.i18n.get("adm.nasconversas", "nas conversas."))));

    return {
      html:
        head((NX.i18n.get("adm.emojis", "Emojis")), (NX.i18n.get("adm.emojisdoservidorficamdisponiveisem", "Emojis do servidor ficam disponíveis em qualquer canal para quem tem a permissão “Usar emojis personalizados”."))) +
        add +
        ("<div class=\"adm-sub-title\">" + NX.i18n.get("adm.emojisdoservidor", "Emojis do servidor ·") + " ") + list.length + "</div>" +
        grid,
      wire: wireEmojis
    };
  }

  function wireEmojis(root) {
    const form = root.querySelector('[data-adm-form="emoji"]');
    if (!form) return;
    const nameInput = form.elements.name;
    nameInput.addEventListener("input", () => {
      if (state.e) state.e.name = nameInput.value;
      syncPreviews(root);
    });
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      showErr(root, "");
      run(
        form.querySelector('button[type="submit"]'),
        () => {
          if (!state.e || !state.e.image) return Promise.reject(NX.fail(NX.i18n.get("adm.escolhaImagemEmoji", "Escolha uma imagem para o emoji.")));
          return api().createEmoji(state.serverId, { name: state.e.name, image: state.e.image });
        },
        root,
        () => {
          state.e = { name: "", image: null };
          ok(NX.i18n.get("adm.emojiAdicionado", "Emoji adicionado."));
          render();
        }
      );
    });
  }

  function deleteEmoji(id) {
    const e = S().serverEmojis(state.serverId).find((x) => x.id === id);
    if (!e) return;
    NX.ui.confirm({
      title: (NX.i18n.get("adm.excluiremoji", "Excluir emoji") + " ") + e.name,
      message: NX.i18n.get("adm.asMensagensQueJaUsam", "As mensagens que já usam") + " <:" + e.name + ":> " + NX.i18n.get("adm.deixamDeExibirAImagem", "deixam de exibir a imagem."),
      confirmLabel: (NX.i18n.get("common.delete", "Excluir")),
      danger: true,
      icon: "trash"
    }).then((yes) => {
      if (!yes) return;
      api()
        .deleteEmoji(id)
        .then(() => {
          ok(NX.i18n.get("adm.emojiRemovido", "Emoji removido."));
          render();
        })
        .catch(bad);
    });
  }

  /* =========================================================
     10 · MODERAÇÃO (estado local por servidor)
     ========================================================= */
  const RULES_KEY = (id) => "nexo.rules." + id;
  const FILTERS_KEY = (id) => "nexo.filters." + id;
  const SECURITY_KEY = (id) => "nexo.security." + id;

  const FILTER_DEFS = [
    { key: "spam", label: NX.i18n.get("adm.filtroSpam", "Filtro de spam"), desc: NX.i18n.get("adm.bloqueiaMensagensRepetidasSequencia", "Bloqueia mensagens repetidas em sequência.") },
    { key: "links", label: NX.i18n.get("adm.bloquearLinksConvite", "Bloquear links de convite"), desc: NX.i18n.get("adm.impedeDivulgacaoOutrosServidores", "Impede divulgação de outros servidores.") },
    { key: "nsfw", label: NX.i18n.get("adm.conteudoNsfw", "Conteúdo NSFW"), desc: NX.i18n.get("adm.removeAutomaticamenteConteudoAdulto", "Remove automaticamente conteúdo adulto.") }
  ];

  function getFilters() {
    return Object.assign(
      { spam: true, links: false, nsfw: true },
      NX.storage.get(FILTERS_KEY(state.serverId), {})
    );
  }

  function tabModeracao() {
    if (!can("manageServer")) return { html: gate(NX.i18n.get("adm.soAdministradoresPodemEditar2", "Só administradores podem editar as regras e filtros.")), wire: noop };
    const rules = NX.storage.get(RULES_KEY(state.serverId), "");
    const f = getFilters();

    const shortcuts =
      '<div class="adm-shortcuts">' +
      (can("viewLogs")
        ? '<button type="button" class="btn btn--soft btn--sm" data-action="adm-tab" data-tab="logs">' +
          ico("clock", 15) + (" " + NX.i18n.get("core.verLogs", "Ver logs") + "</button>")
        : "") +
      (can("banMembers")
        ? '<button type="button" class="btn btn--soft btn--sm" data-action="adm-tab" data-tab="banidos">' +
          ico("lock", 15) + (" " + NX.i18n.get("adm.verbanidos", "Ver banidos") + "</button>")
        : "") +
      '<button type="button" class="btn btn--soft btn--sm" data-action="adm-tab" data-tab="seguranca">' +
      ico("shield", 15) + (" " + NX.i18n.get("adm.seguranca", "Segurança") + "</button>") +
      "</div>";

    const html =
      head((NX.i18n.get("adm.moderacao", "Moderação")), NX.i18n.get("adm.regrasServidorFiltrosAutomaticos", "Regras do servidor e filtros automáticos. Tudo é salvo por servidor.")) +
      '<form class="adm-card" novalidate data-adm-form="rules">' +
      '<div class="adm-card__head">' + ico("chat", 16) + ("<strong>" + NX.i18n.get("adm.regrasdoservidor", "Regras do servidor") + "</strong></div>") +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.textodasregras", "Texto das regras") + "</span>") +
      '<textarea class="input input--area" name="rules" rows="7" maxlength="2000" placeholder="' + NX.i18n.get("ui.1respeitetodomundo102semspam103divulgacaosocom", "1. Respeite todo mundo.&#10;2. Sem spam.&#10;3. Divulgação só com permissão.") + '">' +
      esc(rules) + "</textarea>" +
      ("<span class=\"field__hint\">" + NX.i18n.get("adm.salvolocalmenteporservidorchave", "Salvo localmente por servidor · chave") + " " + "<code class=\"mono\">") +
      esc(RULES_KEY(state.serverId)) + "</code></span></label>" +
      '<div class="settings__save"><button class="btn btn--primary" type="submit" data-busy-label="Salvando">' +
      (NX.i18n.get("adm.salvarregras", "Salvar regras") + "</button></div>") +
      "</form>" +

      '<form class="adm-card" novalidate data-adm-form="filters">' +
      '<div class="adm-card__head">' + ico("bolt", 16) + ("<strong>" + NX.i18n.get("adm.filtrosautomaticos", "Filtros automáticos") + "</strong></div>") +
      FILTER_DEFS.map(
        (d) =>
          '<label class="perm-row"><span class="perm-row__txt"><strong>' + esc(d.label) +
          "</strong><small>" + esc(d.desc) + "</small></span>" +
          '<span class="switch"><input type="checkbox" name="f_' + d.key + '"' + (f[d.key] ? " checked" : "") +
          " /><i></i></span></label>"
      ).join("") +
      '<div class="settings__save"><button class="btn btn--primary" type="submit" data-busy-label="Salvando">' +
      (NX.i18n.get("adm.salvarfiltros", "Salvar filtros") + "</button></div>") +
      "</form>" +

      '<div class="adm-card">' +
      '<div class="adm-card__head">' + ico("settings", 16) + ("<strong>" + NX.i18n.get("adm.atalhos", "Atalhos") + "</strong></div>") +
      shortcuts +
      "</div>";

    return { html: html, wire: wireModeracao };
  }

  function wireModeracao(root) {
    const rf = root.querySelector('[data-adm-form="rules"]');
    if (rf)
      rf.addEventListener("submit", (ev) => {
        ev.preventDefault();
        NX.storage.set(RULES_KEY(state.serverId), rf.elements.rules.value);
        ok(NX.i18n.get("adm.regrasSalvas", "Regras salvas."));
      });
    const ff = root.querySelector('[data-adm-form="filters"]');
    if (ff)
      ff.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const out = {};
        FILTER_DEFS.forEach((d) => (out[d.key] = !!ff.elements["f_" + d.key].checked));
        NX.storage.set(FILTERS_KEY(state.serverId), out);
        ok(NX.i18n.get("adm.filtrosSalvos", "Filtros salvos."));
      });
  }

  /* =========================================================
     11 · BANIDOS
     ========================================================= */
  function bansList() {
    const bans = S().bansOf(state.serverId);
    if (!bans.length)
      return empty("lock", NX.i18n.get("adm.ninguemEstaBanido", "Ninguém está banido"), NX.i18n.get("adm.quandoVoceBanirAlguem", "Quando você banir alguém, o registro aparece aqui com motivo e data."));

    return (
      '<div class="adm-bans">' +
      bans
        .map((b) => {
          const user = S().user(b.userId);
          const by = S().user(b.byId);
          if (!user) return "";
          return (
            '<div class="adm-ban">' +
            u().avatarHTML(user, "sm", false) +
            '<span class="adm-ban__txt"><strong class="truncate">' + esc(user.displayName) + "</strong>" +
            "<small>@" + esc(user.username) + "</small>" +
            '<span class="adm-ban__meta">' +
            (b.reason ? (NX.i18n.get("adm.motivo2", "Motivo:") + " ") + esc(b.reason) : NX.i18n.get("adm.motivoInformado", "Sem motivo informado")) +
            (" " + NX.i18n.get("adm.banido", "· banido") + " ") + esc(u().timeAgo(b.at)) +
            " (" + esc(NX.util.formatDate(b.at)) + ")" +
            (" " + NX.i18n.get("adm.baniu", "· baniu") + " ") + (by ? esc(by.displayName) : "desconhecido") +
            "</span></span>" +
            '<span class="spacer"></span>' +
            (can("unbanMembers")
              ? '<button type="button" class="btn btn--soft btn--sm" data-action="adm-unban" data-id="' + b.id +
                ("\">" + NX.i18n.get("adm.desbanir", "Desbanir") + "</button>")
              : "") +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function tabBanidos() {
    if (!can("banMembers")) return { html: gate(NX.i18n.get("adm.voceNaoTemPermissao4", "Você não tem permissão para ver os banidos.")), wire: noop };
    return { html: head((NX.i18n.get("adm.banidos", "Banidos")), NX.i18n.get("adm.membrosBloqueadosEntrarServidor", "Membros bloqueados de entrar no servidor.")) + bansList(), wire: noop };
  }

  function unbanNow(banId) {
    const ban = (NX.store.db.bans || {})[banId];
    if (!ban) return;
    const user = S().user(ban.userId);
    NX.ui.confirm({
      title: (NX.i18n.get("adm.desbanir", "Desbanir") + " ") + (user ? user.displayName : "membro"),
      message: NX.i18n.get("adm.pessoaPoderaEntrarNovamente", "A pessoa poderá entrar novamente no servidor usando um convite válido."),
      confirmLabel: (NX.i18n.get("adm.desbanir", "Desbanir")),
      icon: "lock"
    }).then((yes) => {
      if (!yes) return;
      api()
        .unbanMember(banId)
        .then(() => {
          ok(NX.i18n.get("adm.membroDesbanido", "Membro desbanido."));
          render();
        })
        .catch(bad);
    });
  }

  /* chaves de meta dos logs traduzidas para português */
  const LOG_META_KEYS = {
    what: "detalhe",
    userId: "membro",
    role: "cargo",
    nick: "apelido",
    reason: "motivo",
    name: "nome",
    channels: "canais",
    type: "tipo",
    code: (NX.i18n.get("adm.codigo", "código")),
    from: "antes",
    uses: "usos",
    enabled: "estado",
    position: (NX.i18n.get("adm.posicao2", "posição"))
  };

  /* =========================================================
     12 · LOGS
     ========================================================= */
  function tabLogs() {
    if (!can("viewLogs")) return { html: gate(NX.i18n.get("adm.voceNaoTemPermissao5", "Você não tem permissão para ver os logs.")), wire: noop };
    const logs = S().logsOf(state.serverId).slice(0, 80);
    if (!logs.length)
      return {
        html: head((NX.i18n.get("adm.logs", "Logs")), NX.i18n.get("adm.historicoAcoesAdministrativasDeste", "Histórico de ações administrativas deste servidor.")) +
          empty("clock", NX.i18n.get("adm.nenhumRegistroAinda", "Nenhum registro ainda"), NX.i18n.get("adm.criacoesAlteracoesBanimentosConvites", "Criações, alterações, banimentos e convites ficam registrados aqui.")),
        wire: noop
      };

    const rows = logs
      .map((entry) => {
        const actor = S().user(entry.actorId);
        const label = NX.LOG_ACTIONS[entry.action] || entry.action;
        const meta = entry.meta || {};
        const metaHTML = Object.keys(meta)
          .map((k) => {
            const v = meta[k];
            if (v === "" || v == null) return "";
            const key = LOG_META_KEYS[k] || k;
            let text;
            if (typeof v === "boolean") {
              text = v ? "sim" : (NX.i18n.get("adm.nao", "não"));
            } else {
              const raw = String(v);
              const usr = S().user(raw);
              const ch = S().channel(raw);
              const rl = S().role(raw);
              const cat = S().category(raw);
              const sv = S().server(raw);
              if (usr) text = "@" + usr.username;
              else if (ch) text = "#" + ch.name;
              else if (rl) text = rl.name;
              else if (cat) text = cat.name;
              else if (sv) text = sv.name;
              else text = raw;
            }
            return '<span class="adm-log__meta"><b>' + esc(key) + "</b>" + esc(text) + "</span>";
          })
          .join("");
        return (
          '<div class="adm-log">' +
          '<span class="adm-log__ico">' + ico(iconForLog(entry.action), 16) + "</span>" +
          '<span class="adm-log__txt"><strong>' + esc(label) + "</strong>" +
          '<span class="adm-log__who">' +
          (actor ? u().avatarHTML(actor, "xs", false) + esc(actor.displayName) : "sistema") +
          "</span>" +
          (metaHTML ? '<span class="adm-log__metas">' + metaHTML + "</span>" : "") +
          "</span>" +
          '<span class="spacer"></span>' +
          '<span class="adm-log__when">' + esc(u().fmtDayLabel(entry.at)) + "<br />" +
          esc(u().fmtTime(entry.at)) + "</span>" +
          "</div>"
        );
      })
      .join("");

    return {
      html:
        head((NX.i18n.get("adm.logs", "Logs")), NX.i18n.get("adm.acoesRegistradasServidorMaximo", "Ações registradas por servidor (máximo de 80 exibidos).")) +
        '<div class="adm-logs">' + rows + "</div>",
      wire: noop
    };
  }

  function iconForLog(action) {
    if (action.indexOf("member.ban") === 0) return "lock";
    if (action.indexOf("member.kick") === 0) return "logout";
    if (action.indexOf("member") === 0) return "users";
    if (action.indexOf("role") === 0) return "shield";
    if (action.indexOf("channel") === 0) return "hash";
    if (action.indexOf("category") === 0) return "folder";
    if (action.indexOf("invite") === 0) return "link";
    if (action.indexOf("emoji") === 0) return "smile";
    if (action.indexOf("server") === 0) return "settings";
    return "info";
  }

  /* =========================================================
     13 · SEGURANÇA
     ========================================================= */
  const SECURITY_DEFS = [
    { key: "verify", label: NX.i18n.get("adm.verificacaoNovosMembros", "Verificação de novos membros"), desc: NX.i18n.get("adm.exigeConfirmacaoMailAntes", "Exige confirmação por e-mail antes de enviar mensagens.") },
    { key: "inviteOnly", label: NX.i18n.get("adm.somenteConvite", "Somente por convite"), desc: NX.i18n.get("adm.novasEntramApenasLink", "Novas entram apenas com link de convite ativo.") },
    { key: "alertInvites", label: NX.i18n.get("adm.avisarModeracaoNovosConvites", "Avisar a moderação de novos convites"), desc: NX.i18n.get("adm.geraLogSempreConvite", "Gera um log sempre que um convite é criado.") }
  ];

  function getSecurity() {
    return Object.assign(
      { verify: true, inviteOnly: true, alertInvites: false },
      NX.storage.get(SECURITY_KEY(state.serverId), {})
    );
  }

  function tabSeguranca() {
    if (!can("manageServer")) return { html: gate(NX.i18n.get("adm.soAdministradoresPodemAlterar", "Só administradores podem alterar a segurança.")), wire: noop };
    const sec = getSecurity();
    const s = srv();
    const owner = S().user(s.ownerId);

    const groups = {};
    NX.PERMS.forEach((p) => (groups[p.group] = groups[p.group] || []).push(p));
    const summary =
      '<div class="adm-card">' +
      '<div class="adm-card__head">' + ico("crown", 16) + ("<strong>" + NX.i18n.get("adm.resumodepermissoesdodono", "Resumo de permissões do dono") + "</strong></div>") +
      '<div class="adm-sec-owner">' +
      (owner ? u().avatarHTML(owner, "sm", true) : "") +
      "<span><strong>" + esc(owner ? owner.displayName : "—") + "</strong>" +
      ("<small>" + NX.i18n.get("adm.dono2", "Dono ·") + " ") + NX.PERM_KEYS.length + "/" + NX.PERM_KEYS.length + (" " + NX.i18n.get("adm.permissoescargofixo", "permissões · cargo fixo") + "</small></span>") +
      "</div>" +
      Object.keys(groups)
        .map(
          (g) =>
            '<div class="adm-sec-group"><span class="field__label">' + esc(g) + "</span><div>" +
            groups[g]
              .map((p) => '<span class="adm-chip is-ok">' + esc(p.label) + "</span>")
              .join("") +
            "</div></div>"
        )
        .join("") +
      ("<p class=\"form-note\">" + NX.i18n.get("adm.odonorecebetodasaspermissoes", "O dono recebe todas as permissões automaticamente — nada pode ser revogado enquanto for dono.") + "</p>") +
      "</div>";

    const html =
      head((NX.i18n.get("adm.seguranca", "Segurança")), NX.i18n.get("adm.controlesEntradaVisibilidadeServidor", "Controles de entrada e visibilidade do servidor.")) +
      '<form class="adm-card" novalidate data-adm-form="security">' +
      '<div class="adm-card__head">' + ico("lock", 16) + ("<strong>" + NX.i18n.get("adm.verificacaoeconvites", "Verificação e convites") + "</strong></div>") +
      SECURITY_DEFS.map(
        (d) =>
          '<label class="perm-row"><span class="perm-row__txt"><strong>' + esc(d.label) +
          "</strong><small>" + esc(d.desc) + "</small></span>" +
          '<span class="switch"><input type="checkbox" name="s_' + d.key + '"' + (sec[d.key] ? " checked" : "") +
          " /><i></i></span></label>"
      ).join("") +
      '<div class="settings__save"><button class="btn btn--primary" type="submit" data-busy-label="Salvando">' +
      (NX.i18n.get("adm.salvarseguranca", "Salvar segurança") + "</button></div>") +
      "</form>" + summary;

    return { html: html, wire: wireSeguranca };
  }

  function wireSeguranca(root) {
    const form = root.querySelector('[data-adm-form="security"]');
    if (!form) return;
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const out = {};
      SECURITY_DEFS.forEach((d) => (out[d.key] = !!form.elements["s_" + d.key].checked));
      NX.storage.set(SECURITY_KEY(state.serverId), out);
      ok(NX.i18n.get("adm.segurancaAtualizada", "Segurança atualizada."));
    });
  }

  /* =========================================================
     14/15 · ZONA PERIGOSA
     ========================================================= */
  function tabPerigoso() {
    if (!isOwner()) return { html: gate(NX.i18n.get("adm.apenasDonoServidorAcessa", "Apenas o dono do servidor acessa esta área.")), wire: noop };
    const s = srv();
    const others = S().membersOf(state.serverId).filter((m) => m.user.id !== me().id);

    const transfer =
      '<div class="adm-card adm-danger__block">' +
      '<div class="adm-card__head">' + ico("crown", 16) + ("<strong>" + NX.i18n.get("adm.transferirPropriedade", "Transferir propriedade") + "</strong></div>") +
      ("<p class=\"settings__desc\"><strong>" + NX.i18n.get("adm.voceperderaapropriedadedesteservidor", "Você perderá a propriedade deste servidor.") + "</strong> ") +
      (NX.i18n.get("adm.onovodonopassaater", "O novo dono passa a ter controle total e você continuará como membro comum.") + "</p>") +
      (others.length
        ? '<div class="field-row">' +
          ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.novodono", "Novo dono") + "</span>") +
          '<select class="select" name="transferTo">' +
          others
            .map(
              (m) =>
                '<option value="' + m.user.id + '">' +
                esc((m.membership.nickname || m.user.displayName) + " (@" + m.user.username + ")") +
                "</option>"
            )
            .join("") +
          "</select></label>" +
          '<div class="field"><span class="field__label">&nbsp;</span>' +
          ("<button type=\"button\" class=\"btn btn--soft\" data-action=\"adm-transfer\">" + NX.i18n.get("adm.transferirPropriedade", "Transferir propriedade") + "</button></div>") +
          "</div>"
        : ("<p class=\"form-note\">" + NX.i18n.get("adm.naohaoutrosmembrosnoservidor", "Não há outros membros no servidor para receber a propriedade.") + "</p>")) +
      "</div>";

    const remove =
      '<div class="adm-card adm-danger__block adm-danger__block--red">' +
      '<div class="adm-card__head">' + ico("alert", 16) + ("<strong>" + NX.i18n.get("adm.excluirServidor", "Excluir servidor") + "</strong></div>") +
      ("<p class=\"settings__desc\">" + NX.i18n.get("common.delete", "Excluir") + " " + "<strong>") + esc(s.name) +
      ("</strong>" + " " + NX.i18n.get("adm.apagacanaismensagenscargosemojisconvites", "apaga canais, mensagens, cargos, emojis, convites e logs. Esta ação é permanente.") + "</p>") +
      ("<button type=\"button\" class=\"btn btn--danger\" data-action=\"adm-delete-server\">" + NX.i18n.get("adm.excluirservidor", "🔴 Excluir servidor") + "</button>") +
      "</div>";

    return {
      html:
        '<div class="adm-head"><div class="settings__head">' +
        ("<h3 class=\"settings__title is-danger\">" + NX.i18n.get("adm.zonaPerigosa2", "Zona perigosa") + "</h3></div>") +
        ("<p class=\"settings__desc\">" + NX.i18n.get("adm.acoesirreversiveisleiacomcalmaantes", "Ações irreversíveis. Leia com calma antes de continuar.") + "</p></div>") +
        transfer +
        remove,
      wire: noop
    };
  }

  function transferNow(btn) {
    if (!state.modal) return;
    const sel = state.modal.body.querySelector('[name="transferTo"]');
    if (!sel) return;
    const target = S().user(sel.value);
    if (!target) return;
    (async () => {
      const first = await NX.ui.confirm({
        title: NX.i18n.get("adm.transferirPropriedade", "Transferir propriedade"),
        message:
          (NX.i18n.get("adm.voceperderaapropriedadedesteservidor", "Você perderá a propriedade deste servidor.") + " ") + target.displayName +
          (" " + NX.i18n.get("adm.passaraaseronovodono", "passará a ser o novo dono e você continuará como membro.")),
        confirmLabel: (NX.i18n.get("adm.continuar", "Continuar")),
        danger: true,
        icon: "crown"
      });
      if (!first) return;
      const second = await NX.ui.confirm({
        title: NX.i18n.get("adm.confirmarTransferencia", "Confirmar transferência"),
        message:
          (NX.i18n.get("adm.ultimaconfirmacaoapropriedadede", "Última confirmação: a propriedade de") + " ") + srv().name + (" " + NX.i18n.get("adm.seratransferidapara", "será transferida para @")) +
          target.username + ". Esta ação não pode ser desfeita por você.",
        confirmLabel: NX.i18n.get("adm.transferirAgora", "Transferir agora"),
        danger: true,
        icon: "crown"
      });
      if (!second) return;
      try {
        await api().transferOwnership(state.serverId, target.id);
        ok((NX.i18n.get("adm.propriedadetransferidapara", "Propriedade transferida para") + " ") + target.displayName + ".");
        render();
      } catch (e) {
        bad(e);
      }
    })();
  }

  function openDeleteModal() {
    if (!isOwner()) {
      NX.ui.error(NX.i18n.get("adm.apenasDonoServidorPode", "Apenas o dono do servidor pode excluí-lo."));
      return;
    }
    const s = srv();
    const footer = actions(
      ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
        ("<button class=\"btn btn--danger\" type=\"button\" data-adm-confirm disabled>" + NX.i18n.get("modal.excluirDefinitivamente", "Excluir definitivamente") + "</button>")
    );
    const m = NX.ui.modal({ title: NX.i18n.get("adm.excluirServidor", "Excluir servidor"), eyebrow: NX.i18n.get("adm.zonaPerigosa2", "Zona perigosa"), size: "sm", footer: footer });
    m.body.innerHTML =
      '<div class="adm-danger">' +
      '<span class="adm-danger__ico">🔴</span>' +
      ("<p class=\"confirm__text\"><strong>" + NX.i18n.get("adm.estaacaoepermanente", "Esta ação é permanente.") + "</strong></p>") +
      ("<p class=\"confirm__note\">" + NX.i18n.get("adm.canaismensagenscargosemojisconvitese", "Canais, mensagens, cargos, emojis, convites e logs de") + " " + "<strong>") +
      esc(s.name) + ("</strong>" + " " + NX.i18n.get("adm.seraoapagadosnaohacomodesfazer", "serão apagados. Não há como desfazer.") + "</p>") +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.digite", "Digite") + " " + "<em>") + esc(s.name) +
      ("</em>" + " " + NX.i18n.get("adm.paraconfirmar", "para confirmar") + "</span>") +
      '<input class="input" data-adm-echo placeholder="' + esc(s.name) + '" autocomplete="off" data-autofocus /></label>' +
      "</div>";

    const btn = footer.querySelector("[data-adm-confirm]");
    const input = m.body.querySelector("[data-adm-echo]");
    input.addEventListener("input", () => {
      btn.disabled = input.value.trim() !== s.name;
    });
    btn.addEventListener("click", () => {
      const end = NX.ui.busy(btn);
      api()
        .deleteServer(state.serverId)
        .then(() => {
          end();
          m.close();
          if (state.modal) state.modal.close();
          ok(NX.i18n.get("adm.servidorExcluido", "Servidor excluído."));
          if (NX.app && NX.app.go) NX.app.go("#/");
        })
        .catch((e) => {
          end();
          bad(e);
        });
    });
  }

  /* =========================================================
     SHELL / RENDER / ABERTURA
     ========================================================= */
  function noop() {}

  const TABS = [
    { id: "visao", label: NX.i18n.get("adm.visaoGeral2", "Visão geral"), icon: "settings", perm: "manageServer", render: tabVisao },
    { id: "aparencia", label: (NX.i18n.get("adm.aparencia", "Aparência")), icon: "palette", perm: "manageServer", render: tabAparencia },
    { id: "canais", label: (NX.i18n.get("adm.canais2", "Canais")), icon: "hash", perm: "manageChannels", render: tabCanais },
    { id: "categorias", label: (NX.i18n.get("adm.categorias", "Categorias")), icon: "folder", perm: "manageChannels", render: tabCategorias },
    { id: "cargos", label: (NX.i18n.get("adm.cargos", "Cargos")), icon: "shield", perm: "manageRoles", render: tabCargos },
    { id: "membros", label: (NX.i18n.get("adm.membros", "Membros")), icon: "users", perm: "manageMembers", render: tabMembros },
    { id: "convites", label: (NX.i18n.get("set.item.privacyInvites", "Convites")), icon: "link", perm: "createInvite", render: tabConvites },
    { id: "emojis", label: (NX.i18n.get("adm.emojis", "Emojis")), icon: "smile", perm: "manageChannels", render: tabEmojis },
    { id: "moderacao", label: (NX.i18n.get("adm.moderacao", "Moderação")), icon: "bolt", perm: "manageServer", render: tabModeracao },
    { id: "banidos", label: (NX.i18n.get("adm.banidos", "Banidos")), icon: "lock", perm: "banMembers", render: tabBanidos },
    { id: "logs", label: (NX.i18n.get("adm.logs", "Logs")), icon: "clock", perm: "viewLogs", render: tabLogs },
    { id: "seguranca", label: (NX.i18n.get("adm.seguranca", "Segurança")), icon: "shield", perm: "manageServer", render: tabSeguranca },
    { id: "perigoso", label: NX.i18n.get("adm.zonaPerigosa2", "Zona perigosa"), icon: "alert", owner: true, danger: true, render: tabPerigoso }
  ];

  function tabVisible(t, serverId, userId) {
    if (t.owner) return S().isOwner(serverId, userId);
    return S().can(serverId, userId, t.perm);
  }

  function visibleTabs() {
    const userId = (me() || {}).id;
    if (!userId) return [];
    return TABS.filter((t) => tabVisible(t, state.serverId, userId));
  }

  function shellHTML(inner) {
    const s = srv();
    const tabs = visibleTabs();
    const m = me();
    return (
      '<div class="adm">' +
      '<nav class="adm-nav" aria-label="' + NX.i18n.get("ui.secoesdeadministracao", "Seções de administração") + '">' +
      '<div class="adm-nav__head">' +
      u().serverIconHTML(s, "sm") +
      '<span class="adm-nav__txt"><strong class="truncate">' + esc(s.name) + "</strong>" +
      "<small>" + plural(S().memberCount(s.id), "membro", "membros") + "</small></span>" +
      "</div>" +
      '<div class="adm-nav__list">' +
      tabs
        .map(
          (t) =>
            '<button type="button" class="adm-nav__tab' +
            (t.id === state.tab ? " is-on" : "") +
            (t.danger ? " is-danger" : "") +
            '" data-action="adm-tab" data-tab="' + t.id + '"' +
            (t.id === state.tab ? ' aria-current="page"' : "") + ">" +
            ico(t.icon, 16) + "<span>" + esc(t.label) + "</span></button>"
        )
        .join("") +
      "</div>" +
      '<div class="adm-nav__foot">' +
      u().avatarHTML(m, "xs", true) +
      '<span class="truncate">' + esc(m.displayName) + "</span>" +
      (isOwner() ? ("<span class=\"tag tag--owner\">" + NX.i18n.get("adm.dono4", "Dono") + "</span>") : "") +
      "</div>" +
      "</nav>" +
      '<section class="adm-body" data-adm-body>' + inner + "</section>" +
      "</div>"
    );
  }

  function render() {
    if (!state.modal) return;
    const tabs = visibleTabs();
    if (!tabs.length) {
      state.modal.close();
      return;
    }
    if (!tabs.some((t) => t.id === state.tab)) {
      state.tab = tabs[0].id;
      state.roleId = null;
    }
    const def = TABS.find((t) => t.id === state.tab) || tabs[0];
    let view;
    try {
      view = def.render();
    } catch (e) {
      console.error("[admin] render " + def.id, e);
      view = { html: empty("alert", NX.i18n.get("adm.naoFoiPossivelCarregar2", "Não foi possível carregar"), NX.i18n.get("adm.tenteReabrirConfiguracoesServidor", "Tente reabrir as configurações do servidor.")), wire: noop };
    }
    const body = state.modal.body;
    body.innerHTML = shellHTML(view.html);
    body.classList.toggle("is-danger", def.danger === true);
    bindPickers(body);
    bindFiles(body);
    if (view.wire) view.wire(body);
  }

  /* =========================================================
     API PÚBLICA
     ========================================================= */
  admin.tabs = function (serverId) {
    const userId = (me() || {}).id;
    return TABS.map((t) => ({
      id: t.id,
      label: t.label,
      icon: t.icon,
      visible: !!(userId && S().membership(serverId, userId) && tabVisible(t, serverId, userId))
    }));
  };

  admin.open = function (serverId, initialTabId) {
    ensureStyles();
    const server = S().server(serverId);
    const user = me();
    if (!server) {
      NX.ui.error(NX.i18n.get("adm.esteServidorNaoExiste", "Este servidor não existe mais ou foi excluído."));
      return null;
    }
    if (!user || !S().membership(serverId, user.id)) {
      NX.ui.error(NX.i18n.get("adm.voceNaoFazParte", "Você não faz parte deste servidor."));
      return null;
    }

    const tabs = admin.tabs(serverId).filter((t) => t.visible);
    if (!tabs.length) {
      NX.ui.error(NX.i18n.get("adm.voceNaoTemPermissao6", "Você não tem permissão para administrar este servidor."));
      return null;
    }

    let tab = initialTabId || null;
    let roleId = null;
    if (tab && tab.indexOf("cargo:") === 0) {
      roleId = tab.slice(6);
      tab = "cargos";
    }
    if (!tab || !tabs.some((t) => t.id === tab)) tab = tabs[0].id;

    if (state.modal) state.modal.close();

    state.serverId = serverId;
    state.tab = tab;
    state.roleId = roleId && (roleId === "novo" || S().role(roleId)) ? roleId : null;
    state.memberSub = "todos";
    state.d = state.a = state.r = state.e = null;

    const m = NX.ui.modal({
      title: server.name,
      eyebrow: NX.i18n.get("adm.configuracoesServidor", "Configurações do servidor"),
      size: "lg",
      onClose: () => {
        state.modal = null;
        state.serverId = null;
        state.roleId = null;
        state.d = state.a = state.r = state.e = null;
      }
    });
    m.el.classList.add("adm-modal");
    state.modal = m;
    render();
    return m;
  };

  admin.close = function () {
    if (state.modal) state.modal.close();
  };

  NX.admin = admin;
})(window.NX);
