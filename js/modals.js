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
          '" style="--sw:' + c + '" data-' + attr + '="' + c + '" aria-label="' + NX.i18n.get("ui.a11ycor", "Cor ") + c + '"></button>'
      ).join("") +
      "</div>"
    );
  }

  function emojiGrid(selected) {
    /* primeira casa = "padrão" (sem emoji): o ícone volta a ser o
       monograma/iniciais do Nexo em vez de um emoji de sistema */
    const none = selected ? "" : " is-on";
    return (
      '<div class="emoji-grid emoji-grid--sm">' +
      '<button type="button" class="emoji-grid__item emoji-grid__item--none' + none +
      '" data-pick-emoji="" title="' + NX.i18n.get("ui.padrao", "Padrão") +
      '" aria-label="' + NX.i18n.get("ui.padrao", "Padrão") + '">' +
      NX.icon("grid2", "", 16) + "</button>" +
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

  /* =========================================================
     UPLOAD DE ÍCONE DE SERVIDOR
     Substitui a antiga grade de emojis + paleta de cores nos
     diálogos de servidor: prévia arredondada, botão “+” e
     “remover”. O arquivo é redimensionado no navegador e o
     servidor valida de novo (PNG/JPG/WEBP, teto de tamanho).
     `swatches`/`emojiGrid` continuam existindo para o editor
     legado de perfil — a mudança é só nos ícones de servidor.
     ========================================================= */
  const ICON_TYPES = ["image/png", "image/jpeg", "image/webp"];
  const ICON_SRC_MAX = 8 * 1024 * 1024; /* arquivo original escolhido */
  const ICON_MAX_PX = 512; /* lado maior depois de redimensionar */
  const ICON_OUT_MAX = 900000; /* mesmo teto do servidor */

  function iconPrevHTML(st, fallbackText) {
    return st.image
      ? '<img src="' + u().h(st.image) + '" alt="">'
      : u().h(fallbackText || "");
  }

  function iconUploadHTML(st, fallbackText) {
    return (
      '<div class="icon-upload" data-icon-upload>' +
      '<span class="icon-upload__prev" data-iup-prev style="--sv:' + u().h(st.color || u().colorFor("novo")) + '">' +
      iconPrevHTML(st, fallbackText) +
      "</span>" +
      '<div class="icon-upload__acts">' +
      '<div class="icon-upload__row">' +
      '<button type="button" class="btn btn--soft btn--sm" data-iup-pick>' +
      NX.icon("plus", "", 15) +
      "<span>" + NX.i18n.get("modal.iconeEscolherImagem", "Escolher imagem") + "</span></button>" +
      '<button type="button" class="btn btn--ghost btn--sm" data-iup-clear' + (st.image ? "" : " hidden") + ">" +
      NX.icon("x", "", 14) +
      "<span>" + NX.i18n.get("modal.iconeRemoverImagem", "Remover") + "</span></button>" +
      "</div>" +
      '<span class="icon-upload__hint">' +
      NX.i18n.get("modal.iconeUploadDica", "PNG, JPG ou WEBP · a imagem é redimensionada para até 512 px") +
      "</span>" +
      '<span class="icon-upload__err" data-iup-err hidden></span>' +
      "</div>" +
      '<input type="file" accept="image/png,image/jpeg,image/webp" data-iup-file tabindex="-1" aria-hidden="true">' +
      "</div>"
    );
  }

  function readIconImage(file) {
    return new Promise((resolve) => {
      const badFile = NX.i18n.get("modal.iconeFormatoInvalido", "Formato inválido. Use uma imagem PNG, JPG ou WEBP.");
      const tooBig = NX.i18n.get("modal.iconeGrandeDemais", "Arquivo grande demais. Use uma imagem de até 8 MB.");
      const unreadable = NX.i18n.get("modal.iconeFalhaLeitura", "Não foi possível ler esta imagem.");
      if (!file) return resolve({ error: badFile });
      if (ICON_TYPES.indexOf(file.type) === -1) return resolve({ error: badFile });
      if (file.size > ICON_SRC_MAX) return resolve({ error: tooBig });
      const fr = new FileReader();
      fr.onerror = () => resolve({ error: unreadable });
      fr.onload = () => {
        const src = String(fr.result || "");
        const img = new Image();
        img.onerror = () => resolve({ error: unreadable });
        img.onload = () => {
          try {
            let w = img.naturalWidth || 1;
            let hgt = img.naturalHeight || 1;
            const scale = Math.min(1, ICON_MAX_PX / Math.max(w, hgt));
            w = Math.max(1, Math.round(w * scale));
            hgt = Math.max(1, Math.round(hgt * scale));
            const c = document.createElement("canvas");
            c.width = w;
            c.height = hgt;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0, w, hgt);
            /* PNG mantém transparência; foto segue JPEG/WEBP para
               o arquivo ficar pequeno no banco */
            const mime = file.type === "image/jpeg" ? "image/jpeg" : file.type === "image/webp" ? "image/webp" : "image/png";
            let out = "";
            try {
              out = c.toDataURL(mime, 0.85);
            } catch (e) {
              out = "";
            }
            if (!out || out.indexOf("data:image/") !== 0) {
              try {
                out = c.toDataURL("image/png");
              } catch (e) {
                out = "";
              }
            }
            if (!out || out.indexOf("data:image/") !== 0) return resolve({ error: unreadable });
            if (out.length > ICON_OUT_MAX)
              return resolve({
                error: NX.i18n.get("modal.iconeImagemProntaGrande", "Esta imagem ficou grande demais. Tente uma menor."),
              });
            resolve({ data: out });
          } catch (err) {
            resolve({ error: unreadable });
          }
        };
        img.src = src;
      };
      fr.readAsDataURL(file);
    });
  }

  /* root = formulário/modal que contém o widget; st = estado com
     { image, imageDirty }; getFallback devolve o texto (iniciais)
     enquanto não há imagem. */
  function bindIconUpload(root, st, getFallback) {
    const box = root.querySelector("[data-icon-upload]");
    if (!box) return;
    const file = box.querySelector("[data-iup-file]");
    const prev = box.querySelector("[data-iup-prev]");
    const errBox = box.querySelector("[data-iup-err]");
    const clearBtn = box.querySelector("[data-iup-clear]");
    const pickBtn = box.querySelector("[data-iup-pick]");

    function showErr(msg) {
      if (!errBox) return;
      errBox.textContent = msg || "";
      errBox.hidden = !msg;
    }

    function repaint() {
      if (prev) prev.innerHTML = iconPrevHTML(st, typeof getFallback === "function" ? getFallback() : "");
      if (clearBtn) clearBtn.hidden = !st.image;
    }

    if (pickBtn && file) {
      pickBtn.addEventListener("click", () => {
        showErr("");
        try {
          file.value = "";
          file.click();
        } catch (e) {}
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        st.image = null;
        st.imageDirty = true;
        showErr("");
        repaint();
        if (st.onIconChange) st.onIconChange();
      });
    }
    if (file) {
      file.addEventListener("change", () => {
        const f = file.files && file.files[0];
        if (!f) return;
        readIconImage(f).then((res) => {
          if (res.error) {
            showErr(res.error);
            return;
          }
          showErr("");
          st.image = res.data;
          st.imageDirty = true;
          repaint();
          if (st.onIconChange) st.onIconChange();
        });
      });
    }
    repaint();
  }

  /* =========================================================
     LOGO PERSONALIZADO — CORES LIVRES
     Substitui a antiga paleta fixa de 10 bolinhas: seletor de
     cor nativo + HEX + RGB, aceitando QUALQUER cor válida do
     espectro. Duas cores: fundo do logo e símbolo (as iniciais).
     As conversões HEX<->RGB são locais; o servidor guarda o
     valor já normalizado (sanitizado lá, em servers.js).
     ========================================================= */
  const LOGO_DEFAULTS = { bg: "#22d3a6", fg: "#06110f" };

  function hexToRgb(raw) {
    let s = String(raw || "").trim();
    if (s.charAt(0) !== "#") s = "#" + s;
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return null;
    if (s.length === 4) s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return {
      r: parseInt(s.substr(1, 2), 16),
      g: parseInt(s.substr(3, 2), 16),
      b: parseInt(s.substr(5, 2), 16),
    };
  }

  function rgbToHex(r, g, b) {
    const c = (n) => {
      const v = Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
      return (v < 16 ? "0" : "") + v.toString(16);
    };
    return ("#" + c(r) + c(g) + c(b)).toLowerCase();
  }

  /* normalizeHex: aceita #RGB, #RRGGBB ou "RRGGBB" e devolve
     minúsculo; null quando não é cor de verdade. */
  function normalizeHex(raw) {
    const rgb = hexToRgb(raw);
    return rgb ? rgbToHex(rgb.r, rgb.g, rgb.b) : null;
  }

  function logoRowHTML(which, label, value) {
    const rgb = hexToRgb(value) || hexToRgb(LOGO_DEFAULTS[which]);
    return (
      '<div class="logo-row" data-logo-row="' + which + '">' +
      '<span class="logo-row__label">' + u().h(label) + "</span>" +
      '<div class="logo-row__ctrls">' +
      '<input type="color" class="logo-row__swatch" data-logo-pick value="' +
      rgbToHex(rgb.r, rgb.g, rgb.b) + '" aria-label="' + u().h(label) + '">' +
      '<label class="logo-row__hex"><span>HEX</span>' +
      '<input class="input input--sm" data-logo-hex maxlength="7" spellcheck="false" value="' +
      rgbToHex(rgb.r, rgb.g, rgb.b) + '" placeholder="#22d3a6"></label>' +
      '<div class="logo-row__rgb">' +
      '<label><span>R</span><input type="number" class="input input--sm" data-logo-n="r" min="0" max="255" value="' + rgb.r + '"></label>' +
      '<label><span>G</span><input type="number" class="input input--sm" data-logo-n="g" min="0" max="255" value="' + rgb.g + '"></label>' +
      '<label><span>B</span><input type="number" class="input input--sm" data-logo-n="b" min="0" max="255" value="' + rgb.b + '"></label>' +
      "</div></div></div>"
    );
  }

  /* leitura da cor atual: fundo (st.color) e símbolo (st.glyphColor).
     null cai no padrão — é a mesma regra usada para montar o HTML
     e para repintar, então os dois nunca divergem. */
  function logoValue(st, which) {
    const v = which === "bg" ? st.color : st.glyphColor;
    return v || LOGO_DEFAULTS[which];
  }

  function logoColorsHTML(st) {
    return (
      '<div class="logo-colors" data-logo-colors>' +
      logoRowHTML("bg", NX.i18n.get("modal.logoCorDeFundo", "Cor de fundo"), logoValue(st, "bg")) +
      logoRowHTML("fg", NX.i18n.get("modal.logoCorDoSimbolo", "Cor do símbolo"), logoValue(st, "fg")) +
      '<div class="logo-colors__foot">' +
      '<button type="button" class="btn btn--ghost btn--sm" data-logo-reset>' +
      NX.icon("refresh", "", 14) +
      "<span>" + NX.i18n.get("modal.logoRestaurarPadrao", "Restaurar padrão") + "</span></button>" +
      '<span class="logo-colors__err" data-logo-err hidden></span>' +
      "</div></div>"
    );
  }

  /* st: { color, glyphColor, colorDirty }. `color` é o fundo (o
     mesmo campo de sempre) e `glyphColor` o símbolo (null = padrão).
     onColorChange repinta a prévia a cada toque — sem esperar salvar. */
  function bindLogoColors(root, st, onColorChange) {
    const box = root.querySelector("[data-logo-colors]");
    if (!box) return;
    const errBox = box.querySelector("[data-logo-err]");

    const valOf = (which) => logoValue(st, which);

    function paintRow(which) {
      const row = box.querySelector('[data-logo-row="' + which + '"]');
      if (!row) return;
      const rgb = hexToRgb(valOf(which)) || hexToRgb(LOGO_DEFAULTS[which]);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      const pick = row.querySelector("[data-logo-pick]");
      const hexIn = row.querySelector("[data-logo-hex]");
      if (pick && pick.value !== hex) pick.value = hex;
      if (hexIn && hexIn.value.toLowerCase() !== hex) hexIn.value = hex;
      row.querySelector('[data-logo-n="r"]').value = rgb.r;
      row.querySelector('[data-logo-n="g"]').value = rgb.g;
      row.querySelector('[data-logo-n="b"]').value = rgb.b;
    }

    function setColor(which, hex) {
      if (which === "bg") st.color = hex;
      else st.glyphColor = hex;
      st.colorDirty = true;
      paintRow(which);
      if (onColorChange) onColorChange();
    }

    function showErr(msg) {
      if (!errBox) return;
      errBox.textContent = msg || "";
      errBox.hidden = !msg;
    }

    box.addEventListener("input", (e) => {
      const row = e.target.closest("[data-logo-row]");
      if (!row) return;
      const which = row.getAttribute("data-logo-row");
      showErr("");
      const pick = e.target.closest("[data-logo-pick]");
      if (pick) return setColor(which, normalizeHex(pick.value) || LOGO_DEFAULTS[which]);
      const hexIn = e.target.closest("[data-logo-hex]");
      if (hexIn) {
        const hex = normalizeHex(hexIn.value);
        if (hex) {
          setColor(which, hex);
        } else {
          showErr(NX.i18n.get("modal.logoCorInvalida", "Cor inválida. Use um código como #22d3a6."));
        }
        return;
      }
      const num = e.target.closest("[data-logo-n]");
      if (num) {
        const key = num.getAttribute("data-logo-n");
        const cur = hexToRgb(valOf(which)) || hexToRgb(LOGO_DEFAULTS[which]);
        cur[key] = Number(num.value);
        const hex = rgbToHex(cur.r, cur.g, cur.b);
        setColor(which, hex);
        const hexIn2 = row.querySelector("[data-logo-hex]");
        if (hexIn2) hexIn2.value = hex;
        const pick2 = row.querySelector("[data-logo-pick]");
        if (pick2) pick2.value = hex;
      }
    });

    /* HEX fora de foco com texto incompleto: não grita durante a
       digitação, só corrige quando a pessoa sai do campo */
    box.addEventListener(
      "change",
      (e) => {
        const hexIn = e.target.closest("[data-logo-hex]");
        if (!hexIn) return;
        const row = hexIn.closest("[data-logo-row]");
        const which = row.getAttribute("data-logo-row");
        const hex = normalizeHex(hexIn.value);
        if (!hex) {
          showErr(NX.i18n.get("modal.logoCorInvalida", "Cor inválida. Use um código como #22d3a6."));
          paintRow(which);
          return;
        }
        showErr("");
        setColor(which, hex);
      },
      true
    );

    const reset = box.querySelector("[data-logo-reset]");
    if (reset) {
      reset.addEventListener("click", () => {
        st.color = LOGO_DEFAULTS.bg;
        st.glyphColor = LOGO_DEFAULTS.fg;
        st.colorDirty = true;
        showErr("");
        paintRow("bg");
        paintRow("fg");
        if (onColorChange) onColorChange();
      });
    }
  }

  /* =========================================================
     EDITOR DE ÍCONE — IMAGEM × LOGO PERSONALIZADO
     Um seletor compacto no lugar da antiga grade de emojis e das
     bolinhas de cor. "Imagem" envia um arquivo; "Logo" usa as
     cores livres. Uma escolha NUNCA apaga a outra: quem tem
     imagem continua com ela guardada e pode alternar.
     ========================================================= */
  function iconEditorHTML(st, fallbackText) {
    /* modo ativo: o que o servidor já tem, senão "imagem" quando
       existe foto (comportamento de sempre) e "logo" quando não
       (é o que mostra as cores). Guardamos em st.mode porque o
       submit precisa saber qual dos dois está valendo. */
    st.mode = st.mode === "logo" || st.mode === "image" ? st.mode : st.image ? "image" : "logo";
    const useLogo = st.mode === "logo";
    return (
      '<div class="icon-editor" data-icon-editor>' +
      '<div class="icon-editor__tabs" role="tablist">' +
      '<button type="button" role="tab" class="icon-editor__tab' + (useLogo ? "" : " is-on") +
      '" data-icon-tab="image" aria-selected="' + (!useLogo) + '">' +
      NX.icon("image", "", 15) +
      "<span>" + NX.i18n.get("modal.iconeImagem", "Imagem") + "</span></button>" +
      '<button type="button" role="tab" class="icon-editor__tab' + (useLogo ? " is-on" : "") +
      '" data-icon-tab="logo" aria-selected="' + useLogo + '">' +
      NX.icon("palette", "", 15) +
      "<span>" + NX.i18n.get("modal.iconeLogo", "Logo") + "</span></button>" +
      "</div>" +
      '<div class="icon-editor__pane" data-icon-pane="image"' + (useLogo ? " hidden" : "") + ">" +
      iconUploadHTML(st, fallbackText) +
      "</div>" +
      '<div class="icon-editor__pane" data-icon-pane="logo"' + (useLogo ? "" : " hidden") + ">" +
      logoColorsHTML(st) +
      "</div>" +
      "</div>"
    );
  }

  /* st: { image, imageDirty, color, glyphColor, colorDirty }.
     onPaint repinta a prévia do modal (imagem × iniciais coloridas). */
  function bindIconEditor(root, st, getFallback, onPaint) {
    const ed = root.querySelector("[data-icon-editor]");
    if (!ed) return;

    function showPane(which) {
      st.mode = which;
      ed.querySelectorAll("[data-icon-pane]").forEach((p) => {
        p.hidden = p.getAttribute("data-icon-pane") !== which;
      });
      ed.querySelectorAll("[data-icon-tab]").forEach((b) => {
        const on = b.getAttribute("data-icon-tab") === which;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
    }

    ed.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-icon-tab]");
      if (!tab) return;
      const which = tab.getAttribute("data-icon-tab");
      st.mode = which;
      /* trocar de modo é uma escolha explícita: no submit ela vai
         junto, para o servidor saber qual dos dois está ativo */
      st.modeDirty = true;
      showPane(which);
      if (onPaint) onPaint();
    });

    /* o upload avisa por st.onIconChange: apontamos para a mesma
       prévia usada pelas cores, para os dois modos repintarem igual */
    st.onIconChange = onPaint;
    bindIconUpload(ed, st, getFallback);
    bindLogoColors(ed, st, onPaint);

    /* ao mandar enviar imagem, o logo deixa de ser a fonte ativa */
    const file = ed.querySelector("[data-iup-file]");
    if (file) {
      file.addEventListener("change", () => {
        if (file.files && file.files.length) showPane("image");
      });
    }
    /* remover a imagem volta ao logo colorido (não fica sem nada) */
    const clearBtn = ed.querySelector("[data-iup-clear]");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => showPane("logo"));
    }
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
        else if (e) NX.ui.error(e.message || NX.i18n.get("adm.algoDeuErrado", "Algo deu errado."));
      });
  }

  /* =========================================================
     CRIAR SERVIDOR
     ========================================================= */
  M.createServer = function () {
    const state = {
      image: null,
      imageDirty: false,
      color: u().colorFor("novo"),
      glyphColor: null,
      colorDirty: false,
      /* criar sem foto: começa no modo logo (mostra as cores) */
      mode: "logo",
      modeDirty: false,
      templateId: "comunidade",
    };
    const footer = u().el(
      ACTIONS(
        ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
          ("<button class=\"btn btn--primary\" type=\"submit\" form=\"form-create-server\" data-busy-label=\"Criando\">" + NX.i18n.get("modal.criarServidor", "Criar servidor") + "</button>")
      )
    );
    const m = NX.ui.modal({
      title: NX.i18n.get("modal.criarServidor", "Criar servidor"),
      eyebrow: NX.i18n.get("modal.novoEspaco", "Novo espaço"),
      size: "md",
      footer: footer,
    });

    m.body.innerHTML =
      ("<p class=\"modal__lead\">" + NX.i18n.get("modal.deumnomeescolhaumicone", "Dê um nome, escolha um ícone e uma estrutura inicial. Você entra no servidor automaticamente.") + "</p>") +
      '<form id="form-create-server" class="form" novalidate>' +
      '<div class="server-preview">' +
      '<span class="server-preview__icon" data-server-preview style="--sv:' + state.color + '">' +
      u().initials(NX.i18n.get("modal.meuServidor", "Meu servidor")) +
      "</span>" +
      ("<div class=\"server-preview__txt\"><strong data-name-preview>" + NX.i18n.get("modal.meuServidor", "Meu servidor") + "</strong>") +
      ("<span>" + NX.i18n.get("modal.novoservidor1membro", "Novo servidor · 1 membro") + "</span></div></div>") +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.nomedoservidor", "Nome do servidor") + "</span>") +
      '<input class="input" name="name" maxlength="40" placeholder="' + NX.i18n.get("ui.excomunidadeaurora", "Ex.: Comunidade Aurora") + '" data-autofocus /></label>' +
      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("modal.iconedoservidor", "Ícone do servidor") + "</span>") +
      iconEditorHTML(state, u().initials(NX.i18n.get("modal.meuServidor", "Meu servidor"))) + "</div>" +
      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("modal.estruturainicial", "Estrutura inicial") + "</span>") +
      '<div class="template-grid">' +
      NX.TEMPLATES.map(
        (t) =>
          '<button type="button" class="template-chip' + (t.id === state.templateId ? " is-on" : "") +
          '" data-template="' + t.id + '"><span class="template-chip__ico">' + NX.icon(t.icon || "grid2", "", 18) +
          "</span><span><strong>" + u().h(t.name) + "</strong><small>" + u().h(t.desc) + "</small></span></button>"
      ).join("") +
      "</div></div>" +
      '<div class="form-error" data-error hidden></div>' +
      "</form>";

    const form = m.body.querySelector("form");
    const preview = m.body.querySelector("[data-server-preview]");
    const namePrev = m.body.querySelector("[data-name-preview]");

    const fallbackText = () =>
      u().initials((form.elements.name.value || "").trim() || NX.i18n.get("modal.meuServidor", "Meu servidor"));

    const paintPreview = () => {
      const nm = (form.elements.name.value || "").trim();
      /* modo "logo" mostra o monograma por cima (sem apagar a foto
         guardada); só a aba Imagem traz a foto de volta. As cores
         (fundo e símbolo) entram como variáveis CSS para a prévia
         refletir na hora. */
      const showImage = state.image && state.mode !== "logo";
      preview.innerHTML = showImage
        ? '<img src="' + u().h(state.image) + '" alt="">'
        : u().h(u().initials(nm || NX.i18n.get("modal.meuServidor", "Meu servidor")));
      preview.style.setProperty("--sv", state.color);
      if (state.glyphColor) preview.style.setProperty("--svg", state.glyphColor);
      else preview.style.removeProperty("--svg");
    };
    bindIconEditor(m.body, state, fallbackText, paintPreview);

    form.addEventListener("input", () => {
      namePrev.textContent = form.elements.name.value.trim() || NX.i18n.get("modal.meuServidor", "Meu servidor");
      paintPreview();
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
        api().createServer(
          Object.assign(
            {
              name: formData(form).name,
              mode: state.mode,
              icon: { image: state.image },
              templateId: state.templateId,
            },
            /* cores só quando a pessoa mexeu nelas: sem isso todo
               servidor novo herdaria a cor da prévia, e não a sua */
            state.colorDirty
              ? { color: state.color, glyphColor: state.glyphColor }
              : {}
          )
        ),
        form,
        (server) => {
          m.close();
          NX.ui.toast((NX.i18n.get("modal.servidor", "Servidor “")) + server.name + (NX.i18n.get("modal.criado", "” criado!")), "success");
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
        ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
          ("<button class=\"btn btn--primary\" type=\"submit\" form=\"form-join\" disabled data-busy-label=\"Entrando\">" + NX.i18n.get("modal.entrarnoservidor", "Entrar no servidor") + "</button>")
      )
    );
    const m = NX.ui.modal({
      title: NX.i18n.get("modal.entrarServidor", "Entrar em um servidor"),
      eyebrow: (NX.i18n.get("adm.convite", "Convite")),
      size: "sm",
      footer: footer,
    });

    m.body.innerHTML =
      ("<p class=\"modal__lead\">" + NX.i18n.get("modal.coleolinkoudigiteo", "Cole o link ou digite o código de convite recebido.") + "</p>") +
      '<form id="form-join" class="form" novalidate>' +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("modal.linkoucodigo", "Link ou código") + "</span>") +
      '<input class="input mono" name="code" placeholder="nexo.chat/ABC12" data-autofocus value="' +
      u().h(presetCode || "") + '" /></label>' +
      '<div class="invite-preview" data-preview>' +
      ("<span class=\"invite-preview__hint\">" + NX.i18n.get("modal.digiteumcodigoparavero", "Digite um código para ver o servidor.") + "</span></div>") +
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
        preview.innerHTML = ("<span class=\"invite-preview__hint\">" + NX.i18n.get("modal.digiteumcodigoparavero", "Digite um código para ver o servidor.") + "</span>");
        return;
      }
      const invite = S().invite(code);
      const me = S().me();
      if (!invite) {
        preview.innerHTML =
          '<span class="invite-preview__hint is-bad">' + NX.icon("alert", "", 16) +
          (" " + NX.i18n.get("modal.codigonaoencontradoconfiracomquem", "Código não encontrado. Confira com quem enviou.") + "</span>");
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
        (isMember ? NX.i18n.get("modal.voceJaParticipa", "você já participa") : "convite " + invite.code) +
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
        NX.ui.toast((NX.i18n.get("app.voceentrouem", "Você entrou em") + " ") + server.name + "!", "success");
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
      NX.ui.toast(NX.i18n.get("modal.crieCategoriaAntesCriar", "Crie uma categoria antes de criar canais."), "warn");
      M.createCategory(serverId);
      return;
    }
    const state = { type: "text", categoryId: categoryId || cats[0].id };

    const footer = u().el(
      ACTIONS(
        ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
          ("<button class=\"btn btn--primary\" type=\"submit\" form=\"form-channel\" data-busy-label=\"Criando\">" + NX.i18n.get("modal.criarCanal", "Criar canal") + "</button>")
      )
    );
    const m = NX.ui.modal({ title: NX.i18n.get("modal.criarCanal", "Criar canal"), eyebrow: server.name, size: "md", footer: footer });

    m.body.innerHTML =
      '<form id="form-channel" class="form" novalidate>' +
      '<div class="type-switch" role="radiogroup" aria-label="' + NX.i18n.get("ui.tipodocanal", "Tipo do canal") + '">' +
      '<button type="button" class="type-switch__btn is-on" data-type="text">' +
      NX.icon("hash", "", 18) + ("<span><strong>" + NX.i18n.get("adm.texto", "Texto") + "</strong><small>" + NX.i18n.get("adm.mensagensearquivos", "mensagens e arquivos") + "</small></span></button>") +
      '<button type="button" class="type-switch__btn" data-type="voice">' +
      NX.icon("voice", "", 18) + ("<span><strong>" + NX.i18n.get("adm.voz", "Voz") + "</strong><small>" + NX.i18n.get("modal.saladeconversa", "sala de conversa") + "</small></span></button>") +
      "</div>" +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.nomeCanal", "Nome do canal") + "</span>") +
      '<span class="input-affix">' +
      '<span class="input-affix__ico" data-affix>' + NX.icon("hash", "", 17) + "</span>" +
      '<input class="input" name="name" placeholder="' + NX.i18n.get("ui.novocanal", "novo-canal") + '" data-autofocus /></span></label>' +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.categoria", "Categoria") + "</span>") +
      '<select class="select" name="categoryId">' +
      cats
        .map(
          (c) =>
            '<option value="' + c.id + '"' + (c.id === state.categoryId ? " selected" : "") + ">" +
            u().h(c.name) + "</option>"
        )
        .join("") +
      "</select></label>" +
      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.permissoes2", "Permissões") + "</span>") +
      '<div class="perm-mini">' +
      ("<label class=\"perm-mini__row\"><span><strong>" + NX.i18n.get("modal.quempodeverestecanal", "Quem pode ver este canal") + "</strong>") +
      ("<small>" + NX.i18n.get("modal.somenteeuescondeocanaldos", "“Somente eu” esconde o canal dos outros membros.") + "</small></span>") +
      '<select class="select select--sm" name="view">' +
      (("<option value=\"all\">" + NX.i18n.get("reg.privacyAll", "Todos") + "</option><option value=\"private\">") + NX.i18n.get("modal.somenteeu", "Somente eu") + "</option></select></label>") +
      ("<label class=\"perm-mini__row\"><span><strong>" + NX.i18n.get("modal.quempodeenviarmensagens", "Quem pode enviar mensagens") + "</strong>") +
      ("<small>" + NX.i18n.get("modal.voceeadministradoressemprepodemescrever", "Você e administradores sempre podem escrever.") + "</small></span>") +
      '<select class="select select--sm" name="send">' +
      (("<option value=\"all\">" + NX.i18n.get("reg.privacyAll", "Todos") + "</option><option value=\"private\">") + NX.i18n.get("modal.somenteeu", "Somente eu") + "</option>") +
      ("<option value=\"none\">" + NX.i18n.get("modal.ninguemsomenteleitura", "Ninguém (somente leitura)") + "</option></select></label>") +
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
      nameInput.placeholder = state.type === "voice" ? NX.i18n.get("modal.salaConversa", "Sala de conversa") : "novo-canal";
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
          NX.ui.toast((NX.i18n.get("modal.canal", "Canal #")) + ch.name + " criado.", "success");
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
        ("<button class=\"btn btn--danger-soft\" type=\"button\" data-del>" + NX.i18n.get("adm.excluirCanal", "Excluir canal") + "</button>") +
          '<span class="spacer"></span>' +
          ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
          ("<button class=\"btn btn--primary\" type=\"submit\" form=\"form-channel-edit\" data-busy-label=\"Salvando\">" + NX.i18n.get("adm.salvarAlteracoes", "Salvar alterações") + "</button>")
      )
    );
    const m = NX.ui.modal({
      title: NX.i18n.get("modal.editarCanal2", "Editar canal"),
      eyebrow: server.name,
      size: "md",
      footer: footer,
    });

    m.body.innerHTML =
      '<form id="form-channel-edit" class="form" novalidate>' +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.nomeCanal", "Nome do canal") + "</span>") +
      '<span class="input-affix"><span class="input-affix__ico">' +
      NX.icon(ch.type === "voice" ? "voice" : "hash", "", 17) +
      '</span><input class="input" name="name" value="' + u().h(ch.name) + '" data-autofocus /></span></label>' +
      (("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("modal.topico", "Tópico") + " " + "<em>") + NX.i18n.get("modal.aparecenocabecalho", "(aparece no cabeçalho)") + "</em></span>") +
      '<textarea class="input input--area" name="topic" rows="2" maxlength="180" placeholder="' + NX.i18n.get("ui.sobreoqueeestecanal", "Sobre o que é este canal?") + '">' +
      u().h(ch.topic || "") +
      "</textarea></label>" +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.categoria", "Categoria") + "</span>") +
      '<select class="select" name="categoryId">' +
      cats
        .map(
          (c) =>
            '<option value="' + c.id + '"' + (c.id === ch.categoryId ? " selected" : "") + ">" +
            u().h(c.name) + "</option>"
        )
        .join("") +
      "</select></label>" +
      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.permissoes2", "Permissões") + "</span><div class=\"perm-mini\">") +
      ("<label class=\"perm-mini__row\"><span><strong>" + NX.i18n.get("modal.quempodeverestecanal", "Quem pode ver este canal") + "</strong></span>") +
      '<select class="select select--sm" name="view">' +
      '<option value="all"' + (ch.overrides.view === "all" ? " selected" : "") + (">" + NX.i18n.get("reg.privacyAll", "Todos") + "</option>") +
      '<option value="private"' + (ch.overrides.view === "private" ? " selected" : "") + (NX.i18n.get("modal.somenteeu2", ">Somente eu") + "</option>") +
      "</select></label>" +
      ("<label class=\"perm-mini__row\"><span><strong>" + NX.i18n.get("modal.quempodeenviarmensagens", "Quem pode enviar mensagens") + "</strong></span>") +
      '<select class="select select--sm" name="send">' +
      '<option value="all"' + (ch.overrides.send === "all" ? " selected" : "") + (">" + NX.i18n.get("reg.privacyAll", "Todos") + "</option>") +
      '<option value="private"' + (ch.overrides.send === "private" ? " selected" : "") + (NX.i18n.get("modal.somenteeu2", ">Somente eu") + "</option>") +
      '<option value="none"' + (ch.overrides.send === "none" ? " selected" : "") + (">" + NX.i18n.get("reg.privacyNone", "Ninguém") + "</option>") +
      "</select></label>" +
      "</div></div>" +
      (NX.permUI && typeof NX.permUI.openChannel === "function"
        ? ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("modal.permissoesavancadas", "Permissões avançadas") + "</span>") +
          ("<p class=\"field__hint\">" + NX.i18n.get("modal.matrizporcargoouusuariocom", "Matriz por cargo ou usuário com estados Permitir, Negar e Herdar — incluindo herança da categoria.") + "</p>") +
          '<button type="button" class="btn btn--soft btn--sm" data-open-perms>' +
          NX.icon("shield", "", 15) + (" " + NX.i18n.get("modal.abrirpermissoesdocanal", "Abrir permissões do canal") + "</button></div>")
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
          NX.ui.toast(NX.i18n.get("modal.canalAtualizado", "Canal atualizado."), "success");
        }
      );
    });

    footer.querySelector("[data-del]").addEventListener("click", async () => {
      const ok = await NX.ui.confirm({
        title: NX.i18n.get("adm.excluirCanal", "Excluir canal"),
        message: (NX.i18n.get("modal.ocanal", "O canal #")) + ch.name + (" " + NX.i18n.get("modal.etodasassuasmensagensserao", "e todas as suas mensagens serão apagados. Isso não pode ser desfeito.")),
        confirmLabel: NX.i18n.get("adm.excluirCanal", "Excluir canal"),
        danger: true,
        icon: "trash",
      });
      if (!ok) return;
      try {
        await api().deleteChannel(channelId);
        m.close();
        NX.ui.toast(NX.i18n.get("adm.canalExcluido", "Canal excluído."), "success");
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
        ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
          ("<button class=\"btn btn--primary\" type=\"submit\" form=\"form-cat\" data-busy-label=\"Criando\">" + NX.i18n.get("modal.criarCategoria", "Criar categoria") + "</button>")
      )
    );
    const m = NX.ui.modal({ title: NX.i18n.get("modal.criarCategoria", "Criar categoria"), eyebrow: server.name, size: "sm", footer });
    m.body.innerHTML =
      '<form id="form-cat" class="form" novalidate>' +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.nomeCategoria", "Nome da categoria") + "</span>") +
      '<input class="input" name="name" placeholder="' + NX.i18n.get("ui.modals.excomunidade", "EX.: COMUNIDADE") + '" data-autofocus /></label>' +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.primeirocanal", "Primeiro canal") + " " + ("<em>" + NX.i18n.get("adm.opcional", "(opcional)") + "</em></span>")) +
      '<input class="input" name="channel" placeholder="' + NX.i18n.get("landing.geral", "geral") + '" /></label>' +
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
          NX.ui.toast((NX.i18n.get("adm.categoria", "Categoria") + " ") + res.category.name + " criada.", "success");
        }
      );
    });
  };

  M.categorySettings = function (categoryId) {
    const cat = S().category(categoryId);
    if (!cat) return;
    const footer = u().el(
      ACTIONS(
        ("<button class=\"btn btn--danger-soft\" type=\"button\" data-del>" + NX.i18n.get("common.delete", "Excluir") + "</button>") +
          '<span class="spacer"></span>' +
          ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
          ("<button class=\"btn btn--primary\" type=\"submit\" form=\"form-cat-edit\" data-busy-label=\"Salvando\">" + NX.i18n.get("common.save", "Salvar") + "</button>")
      )
    );
    const m = NX.ui.modal({ title: NX.i18n.get("modal.editarCategoria2", "Editar categoria"), eyebrow: S().server(cat.serverId).name, size: "sm", footer });
    const chCount = S().channelsOfCategory(cat.id).length;
    m.body.innerHTML =
      '<form id="form-cat-edit" class="form" novalidate>' +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.nome3", "Nome") + "</span>") +
      '<input class="input" name="name" value="' + u().h(cat.name) + '" data-autofocus /></label>' +
      '<p class="form-note">' + u().plural(chCount, NX.i18n.get("modal.canalNestaCategoria", "canal nesta categoria"), NX.i18n.get("modal.canaisNestaCategoria", "canais nesta categoria")) +
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
          NX.ui.toast(NX.i18n.get("modal.categoriaAtualizada", "Categoria atualizada."), "success");
        }
      );
    });
    footer.querySelector("[data-del]").addEventListener("click", async () => {
      const ok = await NX.ui.confirm({
        title: NX.i18n.get("adm.excluirCategoria", "Excluir categoria"),
        message: (NX.i18n.get("modal.acategoria", "A categoria") + " ") + cat.name + (" " + NX.i18n.get("modal.eseus", "e seus") + " ") + chCount + (" " + NX.i18n.get("modal.canalisseraoapagadoscomtodas", "canal(is) serão apagados com todas as mensagens.")),
        confirmLabel: NX.i18n.get("adm.excluirCategoria", "Excluir categoria"),
        danger: true,
        icon: "folderPlus",
      });
      if (!ok) return;
      try {
        await api().deleteCategory(categoryId);
        m.close();
        NX.ui.toast(NX.i18n.get("adm.categoriaExcluida", "Categoria excluída."), "success");
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
      title: NX.i18n.get("modal.convidarPessoas2", "Convidar pessoas"),
      eyebrow: server.name,
      size: "md",
      footer: u().el(
        ACTIONS(
          ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.close", "Fechar") + "</button>") +
            ("<button class=\"btn btn--soft\" type=\"button\" data-new>" + NX.i18n.get("modal.gerarnovocodigo", "Gerar novo código") + "</button>")
        )
      ),
    });

    function render(active) {
      const list = S().invitesOf(serverId).filter(
        (i) => canManage || i.creatorId === me.id
      );
      m.body.innerHTML =
        ("<p class=\"modal__lead\">" + NX.i18n.get("modal.compartilheocodigoouolink", "Compartilhe o código ou o link. Quem acessar poderá ver o servidor e entrar.") + "</p>") +
        (active
          ? '<div class="invite-hero">' +
            ("<span class=\"invite-hero__label\">" + NX.i18n.get("modal.codigodeconvite", "Código de convite") + "</span>") +
            '<strong class="invite-hero__code mono">' + u().h(active.code) + "</strong>" +
            '<div class="invite-hero__link">' +
            '<input class="input mono" readonly value="' + u().h(inviteLink(active.code)) + '" data-link />' +
            '<button class="btn btn--soft btn--sm" data-copy-link>' + NX.icon("copy", "", 15) + (" " + NX.i18n.get("modal.copiar", "Copiar") + "</button>") +
            '<button class="btn btn--soft btn--sm" data-share>' + NX.icon("share", "", 15) + "</button>" +
            "</div></div>"
          : '<div class="invite-empty">' + NX.icon("link", "", 22) +
            ("<span>" + NX.i18n.get("modal.nenhumconviteativogereumcodigo", "Nenhum convite ativo. Gere um código para começar.") + "</span></div>")) +
        (list.length
          ? ("<div class=\"invite-list\"><span class=\"field__label\">" + NX.i18n.get("adm.convitesativos", "Convites ativos ·") + " ") + list.length + "</span>" +
            list
              .map(
                (i) =>
                  '<div class="invite-row"><span class="invite-row__code mono">' + u().h(i.code) + "</span>" +
                  "<span class=\"invite-row__meta\">" +
                  u().h((S().user(i.creatorId) || {}).displayName || "?") +
                  " · " + (i.uses || 0) + " " + NX.i18n.get("adm.usosDeConvite", "uso(s)") + " · " + u().timeAgo(i.createdAt) +
                  "</span>" +
                  (canManage || i.creatorId === me.id
                    ? '<button class="btn btn--ghost btn--sm" data-revoke="' + i.code + ("\">" + NX.i18n.get("adm.revogar", "Revogar") + "</button>")
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
        NX.ui.toast(ok ? NX.i18n.get("modal.linkCopiado2", "Link copiado!") : NX.i18n.get("adm.naoFoiPossivelCopiar2", "Não foi possível copiar."), ok ? "success" : "error");
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
          NX.ui.toast(ok ? NX.i18n.get("modal.linkCopiadoCompartilhar", "Link copiado para compartilhar.") : NX.i18n.get("adm.naoFoiPossivelCopiar2", "Não foi possível copiar."), ok ? "success" : "error");
        }
        return;
      }
      const rev = e.target.closest("[data-revoke]");
      if (rev) {
        try {
          await api().revokeInvite(rev.getAttribute("data-revoke"));
          render(S().invitesOf(serverId)[0]);
          NX.ui.toast(NX.i18n.get("adm.conviteRevogado", "Convite revogado."), "success");
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
          NX.ui.toast(NX.i18n.get("modal.novoConviteGerado", "Novo convite gerado."), "success");
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
        (!isNew ? ("<button class=\"btn btn--danger-soft\" type=\"button\" data-del>" + NX.i18n.get("modal.excluirCargo", "Excluir cargo") + "</button>") : "") +
          '<span class="spacer"></span>' +
          ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
          '<button class="btn btn--primary" type="submit" form="form-role" data-busy-label="Salvando">' +
          (isNew ? NX.i18n.get("adm.criarCargo2", "Criar cargo") : (NX.i18n.get("common.save", "Salvar"))) +
          "</button>"
      )
    );
    const m = NX.ui.modal({
      title: isNew ? NX.i18n.get("modal.novoCargo", "Novo cargo") : NX.i18n.get("adm.editarCargo", "Editar cargo"),
      eyebrow: S().server(serverId).name,
      size: "md",
      footer,
    });

    m.body.innerHTML =
      '<form id="form-role" class="form" novalidate>' +
      '<div class="role-preview"><span class="role-preview__dot" data-role-dot style="--rc:' + state.color + '"></span>' +
      '<input class="input input--role" name="name" maxlength="30" placeholder="' + NX.i18n.get("ui.modals.nomedocargo", "Nome do cargo") + '" value="' +
      u().h(role ? role.name : "") + '" data-autofocus /></div>' +
      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("modal.cordedestaque", "Cor de destaque") + "</span>") + swatches(state.color, "pick-color") + "</div>" +
      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.permissoes2", "Permissões") + "</span>") +
      '<div class="perm-list">' + permList(perms, false) + "</div></div>" +
      ("<p class=\"form-note\">" + NX.i18n.get("modal.odonodoservidorsempretem", "O dono do servidor sempre tem todas as permissões. Permissões individuais de membros sobrepõem o cargo.") + "</p>") +
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
          NX.ui.toast(isNew ? NX.i18n.get("adm.cargoCriado", "Cargo criado.") : NX.i18n.get("adm.cargoAtualizado", "Cargo atualizado."), "success");
        }
      );
    });

    if (!isNew) {
      footer.querySelector("[data-del]").addEventListener("click", async () => {
        const ok = await NX.ui.confirm({
          title: NX.i18n.get("modal.excluirCargo", "Excluir cargo"),
          message: (NX.i18n.get("adm.membroscom", "Membros com “")) + role.name + (NX.i18n.get("modal.voltamparaocargopadrao", "” voltam para o cargo padrão.")),
          confirmLabel: (NX.i18n.get("common.delete", "Excluir")),
          danger: true,
          icon: "shield",
        });
        if (!ok) return;
        try {
          await api().deleteRole(roleId);
          m.close();
          NX.ui.toast(NX.i18n.get("adm.cargoExcluido", "Cargo excluído."), "success");
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
        ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
          '<button class="btn btn--primary" type="submit" form="form-perms"' +
          (isOwner ? " disabled" : "") +
          (" data-busy-label=\"Salvando\">" + NX.i18n.get("adm.salvarpermissoes", "Salvar permissões") + "</button>")
      )
    );
    const m = NX.ui.modal({
      title: (NX.i18n.get("adm.permissoesde", "Permissões de") + " ") + target.displayName,
      eyebrow: server.name,
      size: "md",
      footer,
    });

    m.body.innerHTML =
      '<div class="member-mini">' + u().avatarHTML(target, "sm", true) +
      "<span><strong>" + u().h(target.displayName) + "</strong><small>@" + u().h(target.username) + "</small></span>" +
      (isOwner ? ("<span class=\"tag tag--owner\">" + NX.i18n.get("adm.dono4", "Dono") + "</span>") : "") +
      "</div>" +
      (isOwner
        ? '<div class="callout callout--info">' + NX.icon("crown", "", 17) +
          ("<span>" + NX.i18n.get("modal.odonodoservidorpossuitodas", "O dono do servidor possui todas as permissões, automaticamente.") + "</span></div>")
        : '<form id="form-perms" class="form" novalidate>' +
          '<div class="perm-list">' + permList(current, false) + "</div>" +
          ("<p class=\"form-note\">" + NX.i18n.get("modal.estasalteracoesindividuaissobrepoemocargo", "Estas alterações individuais sobrepõem o cargo do membro.") + "</p>") +
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
          NX.ui.toast(NX.i18n.get("adm.permissoesAtualizadas", "Permissões atualizadas."), "success");
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
      '<div class="member-card__body">' +
      '<div class="member-card__avatar">' + u().avatarHTML(user, "lg", true) + "</div>" +
      "<h3" +
      (NX.nameplates && NX.nameplates.cls(user) ? ' class="' + NX.nameplates.cls(user) + '"' : "") +
      ">" +
      u().h(user.displayName) +
      "</h3>" +
      '<span class="member-card__user">@' + u().h(user.username) + "</span>" +
      '<span class="status-pill" data-status="' + user.status + '">' +
      u().h(NX.STATUS_LABEL[user.status] || NX.i18n.get("core.statusOffline", "Offline")) +
      (user.statusText ? " · " + u().h(user.statusText) : "") +
      "</span>" +
      '<div class="member-card__tags">' +
      (isOwner ? ("<span class=\"tag tag--owner\">" + NX.i18n.get("adm.dono4", "Dono") + "</span>") : "") +
      (role ? '<span class="tag" style="--tc:' + role.color + '">' + u().h(role.name) + "</span>" : "") +
      "</div>" +
      (user.bio ? '<p class="member-card__bio">' + u().h(user.bio) + "</p>" : "") +
      ("<div class=\"member-card__meta\">" + NX.i18n.get("modal.membrodesde", "Membro desde") + " ") +
      u().h(NX.util.formatDate(membership ? membership.joinedAt : Date.now(), { day: "2-digit", month: "2-digit", year: "numeric" })) +
      "</div>" +
      '<div class="member-card__actions">' +
      (isMe
        ? ("<button class=\"btn btn--soft btn--sm btn--block\" data-card=\"edit\">" + NX.i18n.get("modal.editarPerfil2", "Editar perfil") + "</button>")
        : '<button class="btn btn--soft btn--sm btn--block" data-card="dm">' + NX.icon("chat", "", 15) +
          (" " + NX.i18n.get("modal.mensagem", "Mensagem") + "</button>") +
          ("<button class=\"btn btn--ghost btn--sm btn--block\" data-card=\"profile\">" + NX.i18n.get("adm.verPerfil", "Ver perfil") + "</button>")) +
      (canManage
        ? '<div class="member-card__divider"></div>' +
          '<button class="btn btn--soft btn--sm btn--block" data-card="perms">' + NX.icon("shield", "", 15) +
          (" " + NX.i18n.get("adm.permissoes2", "Permissões") + "</button>") +
          ("<label class=\"member-card__role\"><span>" + NX.i18n.get("adm.cargo", "Cargo") + "</span>") +
          '<select class="select select--sm" data-card-role>' +
          roles
            .map(
              (r) =>
                '<option value="' + r.id + '"' + (membership.roleId === r.id ? " selected" : "") + ">" +
                u().h(r.name) + "</option>"
            )
            .join("") +
          "</select></label>" +
          ("<button class=\"btn btn--danger-soft btn--sm btn--block\" data-card=\"kick\">" + NX.i18n.get("modal.removerdoservidor", "Remover do servidor") + "</button>")
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
            title: (NX.i18n.get("modal.remover", "Remover") + " ") + user.displayName,
            message: NX.i18n.get("modal.elePerdeAcessoImediatamente", "Ele perde o acesso imediatamente e precisará de um novo convite para voltar."),
            confirmLabel: (NX.i18n.get("modal.remover", "Remover")),
            danger: true,
            icon: "userPlus",
          });
          if (ok) {
            try {
              await api().kickMember(serverId, userId);
              NX.ui.toast(user.displayName + (" " + NX.i18n.get("modal.foiremovido", "foi removido.")), "success");
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
        NX.ui.toast(NX.i18n.get("modal.cargoAlterado", "Cargo alterado."), "success");
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
      eyebrow: NX.i18n.get("adm.configuracoesServidor", "Configurações do servidor"),
      size: "lg",
      cls: "modal--settings",
    });
    m.el.classList.add("modal--settings");

    const TABS = [
      { id: "general", label: (NX.i18n.get("core.geral", "Geral")), icon: "settings" },
      { id: "roles", label: (NX.i18n.get("adm.cargos", "Cargos")), icon: "shield" },
      { id: "members", label: (NX.i18n.get("adm.membros", "Membros")), icon: "users" },
      { id: "invites", label: (NX.i18n.get("set.item.privacyInvites", "Convites")), icon: "link" },
      { id: "danger", label: isOwner ? (NX.i18n.get("common.delete", "Excluir")) : (NX.i18n.get("set.item.logout", "Sair")), icon: "alert" },
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
      const state = {
        image: (s.icon && s.icon.image) || null,
        imageDirty: false,
        color: (s.icon && s.icon.color) || u().colorFor(s.id),
        glyphColor: (s.icon && s.icon.glyphColor) || null,
        colorDirty: false,
        /* modo do logo atual (null = o servidor decide) */
        mode: (s.icon && s.icon.mode) || null,
        modeDirty: false,
      };
      const html =
        '<form id="form-general" class="form" novalidate>' +
        ("<h3 class=\"settings__title\">" + NX.i18n.get("modal.aparenciadoservidor", "Aparência do servidor") + "</h3>") +
        '<div class="server-preview"><span class="server-preview__icon" data-gp style="--sv:' + state.color +
        (state.glyphColor ? ";--svg:" + u().h(state.glyphColor) : "") + '">' +
        (state.image ? '<img src="' + u().h(state.image) + '" alt="">' : u().h(u().initials(s.name))) + "</span>" +
        '<div class="server-preview__txt"><strong data-gn>' + u().h(s.name) + "</strong>" +
        "<span>" + u().plural(S().memberCount(s.id), "membro", "membros") + "</span></div></div>" +
        ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.nomedoservidor", "Nome do servidor") + "</span>") +
        '<input class="input" name="name" maxlength="40" value="' + u().h(s.name) + '"' +
        (canManage ? "" : " disabled") + " /></label>" +
        ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("adm.descricao3", "Descrição") + "</span>") +
        '<textarea class="input input--area" name="description" rows="2" maxlength="240" placeholder="' + NX.i18n.get("ui.oqueaconteceaqui", "O que acontece aqui?") + '"' +
        (canManage ? "" : " disabled") + ">" + u().h(s.description || "") + "</textarea></label>" +
        (canManage
          ? ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("modal.icone", "Ícone") + "</span>") +
            iconEditorHTML(state, u().initials(s.name)) + "</div>" +
            ("<label class=\"perm-row\"><span class=\"perm-row__txt\"><strong>" + NX.i18n.get("adm.mostrarnoexplorar", "Mostrar no explorar") + "</strong>") +
            ("<small>" + NX.i18n.get("adm.deixaacomunidadevisivelnodiretorio", "Deixa a comunidade visível no diretório público.") + "</small></span>") +
            '<span class="switch"><input type="checkbox" name="discoverable" data-disc-toggle' +
            ' aria-describedby="disc-state"' +
            (s.discoverable ? " checked" : "") + " /><i></i></span></label>" +
            /* estado da publicação: mostra o que REALMENTE aconteceu.
               Se falhar, o toggle volta para o valor anterior — nunca
               fica "ligado" fingindo que salvou. */
            '<div class="disc-state" id="disc-state" data-disc-state data-state="' +
            (s.discoverable ? "on" : "off") + '">' +
            NX.icon(s.discoverable ? "check" : "circle", "", 14) +
            "<span>" + (s.discoverable
              ? NX.i18n.get("adm.explorarAtivo", "Ativo e salvo — visível no diretório.")
              : NX.i18n.get("adm.explorarInativo", "Desativado — não aparece no diretório.")) +
            "</span></div>"
          : '<div class="callout callout--info">' + NX.icon("info", "", 16) +
            ("<span>" + NX.i18n.get("modal.vocepodeverasconfiguracoesmas", "Você pode ver as configurações, mas só administradores podem alterá-las.") + "</span></div>")) +
        '<div class="form-error" data-error hidden></div>' +
        (canManage
          ? ("<div class=\"settings__save\"><button class=\"btn btn--primary\" type=\"submit\" data-busy-label=\"Salvando\">" + NX.i18n.get("adm.salvarAlteracoes", "Salvar alterações") + "</button></div>")
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
          const curName = () => form.elements.name.value.trim() || s.name;

          /* uma única função repinta a prévia: foto → iniciais, com
             as duas cores do logo (fundo e símbolo). Em modo "logo"
             a foto fica guardada mas não aparece — é isso que permite
             alternar sem perder a escolha. */
          const paintPreview = () => {
            const showImage = st.image && st.mode !== "logo";
            gp.innerHTML = showImage
              ? '<img src="' + u().h(st.image) + '" alt="">'
              : u().h(u().initials(curName()));
            gp.style.setProperty("--sv", st.color);
            if (st.glyphColor) gp.style.setProperty("--svg", u().h(st.glyphColor));
            else gp.style.removeProperty("--svg");
          };
          bindIconEditor(form, st, () => u().initials(curName()), paintPreview);
          paintPreview();
          form.addEventListener("input", () => {
            gn.textContent = curName();
            if (!st.image || st.mode === "logo")
              gp.textContent = u().h(u().initials(curName()));
          });

          /* ---------------- Mostrar no explorar ----------------
             O interruptor salva NA HORA (não espera o rodapé): é a
             única forma de mostrar "salvando → salvo → erro" sem
             mentir. Em erro ele volta ao último valor CONFIRMADO e
             oferece "Tentar novamente" — nunca fica ligado fingindo
             que publicou. */
          const disc = form.querySelector("[data-disc-toggle]");
          const discState = form.querySelector("[data-disc-state]");
          let discSaved = !!s.discoverable; /* último valor confirmado */
          let discBusy = false;

          function paintDisc(kind, msg) {
            if (!discState) return;
            discState.setAttribute("data-state", kind);
            const ico =
              kind === "on" ? "check" : kind === "saving" ? "refresh" : kind === "error" ? "alert" : "circle";
            const text =
              msg ||
              (kind === "on"
                ? NX.i18n.get("adm.explorarAtivo", "Ativo e salvo — visível no diretório.")
                : kind === "saving"
                ? NX.i18n.get("adm.explorarSalvando", "Salvando…")
                : kind === "error"
                ? NX.i18n.get("adm.explorarErro", "Erro ao salvar.")
                : NX.i18n.get("adm.explorarInativo", "Desativado — não aparece no diretório."));
            const retry =
              kind === "error"
                ? '<button type="button" class="btn btn--ghost btn--sm" data-disc-retry>' +
                  NX.i18n.get("view.tentarNovamente", "Tentar novamente") +
                  "</button>"
                : "";
            discState.innerHTML =
              NX.icon(ico, "", 14) + "<span>" + u().h(text) + "</span>" + retry;
            if (kind === "saving") discState.classList.add("is-spin");
            else discState.classList.remove("is-spin");
          }

          async function saveDisc(next) {
            if (discBusy) return;
            discBusy = true;
            if (disc) disc.disabled = true;
            paintDisc("saving");
            try {
              await api().updateServer(serverId, { discoverable: next });
              discSaved = next;
              if (disc) disc.checked = discSaved;
              paintDisc(discSaved ? "on" : "off");
            } catch (err) {
              /* falhou de verdade: desfazemos a aparência para o
                 valor que ESTÁ no servidor e dizemos o motivo */
              if (disc) disc.checked = discSaved;
              paintDisc("error", (err && err.message) || NX.i18n.get("adm.explorarErro", "Erro ao salvar."));
            } finally {
              discBusy = false;
              if (disc) disc.disabled = false;
            }
          }

          if (disc) {
            disc.addEventListener("change", () => saveDisc(disc.checked));
          }
          if (discState) {
            discState.addEventListener("click", (e) => {
              if (!e.target.closest("[data-disc-retry]")) return;
              saveDisc(disc.checked);
            });
          }
          paintDisc(discSaved ? "on" : "off");

          form.addEventListener("submit", (e) => {
            e.preventDefault();
            showErr(form, "");
            const d = formData(form);
            /* nome/descrição/logo salvam pelo rodapé; o interruptor
               do Explorar já teve a dele salva por conta própria */
            const iconPatch = {};
            if (st.imageDirty) iconPatch.image = st.image;
            if (st.colorDirty) {
              iconPatch.color = st.color;
              iconPatch.glyphColor = st.glyphColor;
            }
            /* alternar Imagem × Logo é escolha do usuário: o modo
               vai junto (a foto fica guardada no banco, só sai do
               caminho quando o modo é "logo") */
            if (st.modeDirty) iconPatch.mode = st.mode;
            runTask(
              form.querySelector('button[type="submit"]'),
              api().updateServer(
                serverId,
                Object.assign(
                  {
                    name: d.name,
                    description: d.description,
                  },
                  Object.keys(iconPatch).length ? { icon: iconPatch } : {}
                )
              ),
              form,
              () => {
                st.imageDirty = false;
                st.colorDirty = false;
                st.modeDirty = false;
                NX.ui.toast(NX.i18n.get("adm.configuracoesSalvas", "Configurações salvas."), "success");
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
            ("<span>" + NX.i18n.get("modal.apenasadministradorespodemgerenciarcargos", "Apenas administradores podem gerenciar cargos.") + "</span></div>"),
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
            "<small>" + (r.isDefault ? (NX.i18n.get("modal.cargopadrao", "Cargo padrão ·") + " ") : "") + u().plural(members, "membro", "membros") +
            " · " + perms + (NX.i18n.get("modal.7permissoes", "/7 permissões") + "</small></span>") +
            NX.icon("chevronRight", "", 16) +
            "</button>"
          );
        })
        .join("");
      return {
        html:
          ("<div class=\"settings__head\"><h3 class=\"settings__title\">" + NX.i18n.get("adm.cargos", "Cargos") + "</h3>") +
          '<button class="btn btn--soft btn--sm" data-new-role>' + NX.icon("plus", "", 15) + (" " + NX.i18n.get("modal.novoCargo", "Novo cargo") + "</button></div>") +
          ("<p class=\"settings__desc\">" + NX.i18n.get("modal.cargosagrupampermissoesquemtemvarios", "Cargos agrupam permissões. Quem tem vários, vale o conjunto de todos.") + "</p>") +
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
                u().h(isOwner ? (NX.i18n.get("adm.dono4", "Dono")) : row.role ? row.role.name : (NX.i18n.get("adm.membro2", "Membro"))) +
                "</span>") +
            (canManage && !isOwner && !isMe
              ? '<button class="btn btn--ghost btn--sm" data-perms-for="' + row.user.id + ("\">" + NX.i18n.get("adm.permissoes2", "Permissões") + "</button>") +
                '<button class="btn btn--ghost btn--sm btn--danger-text" data-kick="' + row.user.id + ("\">" + NX.i18n.get("modal.remover", "Remover") + "</button>")
              : "") +
            "</div>"
          );
        })
        .join("");
      return {
        html:
          ("<div class=\"settings__head\"><h3 class=\"settings__title\">" + NX.i18n.get("adm.membros", "Membros") + "</h3>") +
          '<span class="block__count">' + members.length + "</span></div>" +
          '<div class="admin-members">' + rows + "</div>",
        wire: (root) => {
          root.querySelectorAll("[data-role-for]").forEach((sel) =>
            sel.addEventListener("change", async () => {
              try {
                await api().setMemberRole(serverId, sel.getAttribute("data-role-for"), sel.value);
                NX.ui.toast(NX.i18n.get("adm.cargoAtualizado", "Cargo atualizado."), "success");
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
                title: (NX.i18n.get("modal.remover", "Remover") + " ") + (usr ? usr.displayName : "membro"),
                message: NX.i18n.get("modal.pessoaPerderaAcessoPrecisara", "A pessoa perderá o acesso e precisará de um novo convite."),
                confirmLabel: (NX.i18n.get("modal.remover", "Remover")),
                danger: true,
                icon: "userPlus",
              });
              if (!ok) return;
              try {
                await api().kickMember(serverId, uid);
                NX.ui.toast(NX.i18n.get("modal.membroRemovido", "Membro removido."), "success");
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
          ("<div class=\"settings__head\"><h3 class=\"settings__title\">" + NX.i18n.get("set.item.privacyInvites", "Convites") + "</h3>") +
          (canInvite
            ? '<button class="btn btn--soft btn--sm" data-new-invite>' + NX.icon("plus", "", 15) + (" " + NX.i18n.get("modal.gerarconvite", "Gerar convite") + "</button>")
            : "") +
          "</div>" +
          ("<p class=\"settings__desc\">" + NX.i18n.get("adm.cadaCodigoAbrePorta", "Cada código abre a porta para o seu servidor. Revogue quando quiser.") + "</p>") +
          (invites.length
            ? '<div class="invite-list">' +
              invites
                .map(
                  (i) =>
                    '<div class="invite-row"><span class="invite-row__code mono">' + u().h(i.code) + "</span>" +
                    '<span class="invite-row__meta">' +
                    u().h((S().user(i.creatorId) || {}).displayName || "?") +
                    " · " + (i.uses || 0) + " " + NX.i18n.get("adm.usosDeConvite", "uso(s)") + " · " + u().timeAgo(i.createdAt) +
                    "</span>" +
                    '<button class="btn btn--ghost btn--sm" data-copy-code="' + i.code + ("\">" + NX.i18n.get("modal.copiar", "Copiar") + "</button>") +
                    (canManage || i.creatorId === me.id
                      ? '<button class="btn btn--ghost btn--sm btn--danger-text" data-revoke-code="' + i.code + ("\">" + NX.i18n.get("adm.revogar", "Revogar") + "</button>")
                      : "") +
                    "</div>"
                )
                .join("") +
              "</div>"
            : '<div class="invite-empty">' + NX.icon("link", "", 20) + ("<span>" + NX.i18n.get("modal.nenhumconviteativo", "Nenhum convite ativo.") + "</span></div>")),
        wire: (root) => {
          const nb = root.querySelector("[data-new-invite]");
          if (nb)
            nb.addEventListener("click", async () => {
              try {
                const inv = await api().createInvite(serverId);
                NX.ui.toast((NX.i18n.get("adm.convite", "Convite") + " ") + inv.code + " gerado.", "success");
                refresh("invites");
              } catch (err) {
                NX.ui.error(err.message);
              }
            });
          root.querySelectorAll("[data-copy-code]").forEach((b) =>
            b.addEventListener("click", async () => {
              const code = b.getAttribute("data-copy-code");
              const ok = await u().copy(inviteLink(code));
              NX.ui.toast(ok ? NX.i18n.get("adm.linkConviteCopiado", "Link do convite copiado!") : NX.i18n.get("adm.naoFoiPossivelCopiar2", "Não foi possível copiar."), ok ? "success" : "error");
            })
          );
          root.querySelectorAll("[data-revoke-code]").forEach((b) =>
            b.addEventListener("click", async () => {
              try {
                await api().revokeInvite(b.getAttribute("data-revoke-code"));
                NX.ui.toast(NX.i18n.get("adm.conviteRevogado", "Convite revogado."), "success");
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
            ("<h3 class=\"settings__title is-danger\">" + NX.i18n.get("adm.excluirServidor", "Excluir servidor") + "</h3>") +
            ("<p class=\"settings__desc\">" + NX.i18n.get("common.delete", "Excluir") + " " + "<strong>") + u().h(server.name) +
            ("</strong>" + " " + NX.i18n.get("modal.removetodososcanaismensagenscargos", "remove todos os canais, mensagens, cargos e convites. Não há como desfazer.") + "</p>") +
            '<div class="danger-zone"><button class="btn btn--danger" data-delete-server>' +
            NX.icon("trash", "", 16) + (" " + NX.i18n.get("adm.excluirServidor", "Excluir servidor") + "</button></div>"),
          wire: (root) => {
            root.querySelector("[data-delete-server]").addEventListener("click", async () => {
              const ok = await NX.ui.confirm({
                title: (NX.i18n.get("common.delete", "Excluir") + " ") + server.name,
                message:
                  (NX.i18n.get("modal.todososcanaismensagenscargose", "Todos os canais, mensagens, cargos e convites serão apagados permanentemente. Esta ação não pode ser desfeita.")),
                confirmLabel: NX.i18n.get("modal.excluirDefinitivamente", "Excluir definitivamente"),
                danger: true,
                icon: "trash",
              });
              if (!ok) return;
              try {
                await api().deleteServer(serverId);
                m.close();
                NX.ui.toast(NX.i18n.get("adm.servidorExcluido", "Servidor excluído."), "success");
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
          ("<h3 class=\"settings__title is-danger\">" + NX.i18n.get("modal.sairServidor", "Sair do servidor") + "</h3>") +
          ("<p class=\"settings__desc\">" + NX.i18n.get("modal.voceperderaoacessoa", "Você perderá o acesso a") + " " + "<strong>") + u().h(server.name) +
          ("</strong>" + " " + NX.i18n.get("modal.eprecisaradeumnovoconvite", "e precisará de um novo convite para voltar.") + "</p>") +
          '<div class="danger-zone"><button class="btn btn--danger" data-leave-server>' +
          NX.icon("logout", "", 16) + (" " + NX.i18n.get("modal.sairServidor", "Sair do servidor") + "</button></div>"),
        wire: (root) => {
          root.querySelector("[data-leave-server]").addEventListener("click", async () => {
            const ok = await NX.ui.confirm({
              title: (NX.i18n.get("modal.sairde", "Sair de") + " ") + server.name,
              message: NX.i18n.get("modal.vocePodeEntrarNovo", "Você pode entrar de novo se alguém te enviar um convite."),
              confirmLabel: (NX.i18n.get("set.item.logout", "Sair")),
              danger: true,
              icon: "logout",
            });
            if (!ok) return;
            try {
              await api().leaveServer(serverId);
              m.close();
              NX.ui.toast(NX.i18n.get("modal.voceSaiuServidor", "Você saiu do servidor."), "success");
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
    /* O editor completo com abas (Foto · Banner · Informações · Status ·
       Aparência) é o canônico. Este modal antigo, que só trocava um emoji,
       foi aposentado para não existirem dois "Editar perfil" diferentes
       — e para nunca sobrescrever o modelo SVG escolhido pela pessoa. */
    if (NX.people && typeof NX.people.editProfileModal === "function") {
      return NX.people.editProfileModal();
    }
    const me = S().me();
    if (!me) return;
    const state = { emoji: (me.avatar && me.avatar.emoji) || "", color: me.avatar.color };
    const footer = u().el(
      ACTIONS(
        ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
          ("<button class=\"btn btn--primary\" type=\"submit\" form=\"form-profile\" data-busy-label=\"Salvando\">" + NX.i18n.get("common.save", "Salvar") + "</button>")
      )
    );
    const m = NX.ui.modal({ title: NX.i18n.get("modal.editarPerfil2", "Editar perfil"), eyebrow: NX.i18n.get("modal.suaConta", "Sua conta"), size: "md", footer });

    m.body.innerHTML =
      '<form id="form-profile" class="form" novalidate>' +
      '<div class="server-preview"><span class="server-preview__icon" data-pp style="--sv:' + state.color + '">' +
      u().h(state.emoji) + "</span>" +
      '<div class="server-preview__txt"><strong data-pn>' + u().h(me.displayName) + "</strong>" +
      "<span>@" + u().h(me.username) + "</span></div></div>" +
      ("<div class=\"field\"><span class=\"field__label\">" + NX.i18n.get("modal.avatar", "Avatar") + "</span><div class=\"icon-picker\">") +
      emojiGrid(state.emoji) + swatches(state.color, "pick-color") + "</div></div>" +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("set.nomeExibicao", "Nome de exibição") + "</span>") +
      '<input class="input" name="displayName" maxlength="32" value="' + u().h(me.displayName) + '" data-autofocus /></label>' +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("set.nomeUsuario", "Nome de usuário") + "</span>") +
      '<input class="input" name="username" maxlength="18" value="' + u().h(me.username) + '" /></label>' +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("modal.bio", "Bio") + "</span>") +
      '<textarea class="input input--area" name="bio" rows="2" maxlength="190" placeholder="' + NX.i18n.get("ui.contequemevoce", "Conte quem é você") + '">' +
      u().h(me.bio || "") +
      "</textarea></label>" +
      '<div class=\"field-row\">' +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("modal.status", "Status") + "</span>") +
      '<select class="select" name="status">' +
      Object.keys(NX.STATUS_LABEL)
        .map(
          (k) =>
            '<option value="' + k + '"' + (me.status === k ? " selected" : "") + ">" +
            NX.STATUS_LABEL[k] + "</option>"
        )
        .join("") +
      "</select></label>" +
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("set.statusPersonalizado", "Status personalizado") + "</span>") +
      '<input class="input" name="statusText" maxlength="60" placeholder="' + NX.i18n.get("ui.exestudando", "ex.: estudando") + '" value="' +
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
          bio: d.bio,
          status: d.status,
          statusText: d.statusText,
          avatar: { emoji: state.emoji, color: state.color },
        }),
        form,
        () => {
          m.close();
          NX.ui.toast(NX.i18n.get("modal.perfilAtualizado", "Perfil atualizado."), "success");
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
    const seen = {};
    /* só pessoa de verdade: app/bot nunca vira conversa pessoal */
    const add = (p) => {
      if (!p || !p.id || p.id === me.id || seen[p.id]) return;
      if (!S().isPerson(p)) return;
      seen[p.id] = true;
      people.push(p);
    };
    /* amizades primeiro: a amizade é global e existe mesmo sem
       servidor em comum — este era o motivo de "Nova conversa"
       mostrar vazio para quem já tinha amigos */
    S().friendsOf(me.id).forEach(add);
    S().membershipsOf(me.id).forEach((mm) => {
      S().membersOf(mm.serverId).forEach((row) => add(row.user));
    });
    /* amigos em cima, gente online na sequência, resto alfabético */
    const sortPeople = () =>
      people.sort((a, b) => {
        const fa = S().isFriend(me.id, a.id) ? 0 : 1;
        const fb = S().isFriend(me.id, b.id) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        const oa = a.status === "online" ? 0 : 1;
        const ob = b.status === "online" ? 0 : 1;
        if (oa !== ob) return oa - ob;
        return String(a.displayName || "").localeCompare(String(b.displayName || ""));
      });
    sortPeople();

    const m = NX.ui.modal({
      title: NX.i18n.get("modal.novaConversa", "Nova conversa"),
      eyebrow: NX.i18n.get("modal.mensagensDiretas", "Mensagens diretas"),
      size: "sm",
      footer: u().el(ACTIONS(("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.close", "Fechar") + "</button>"))),
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
        return (
          '<div class="invite-empty">' + NX.icon("users", "", 20) + "<span>" +
          (f
            ? NX.i18n.get("modal.nenhumapessoaencontrada", "Nenhuma pessoa corresponde à sua busca.")
            : people.length
              ? NX.i18n.get("modal.nenhumaPessoaPorPerto", "Nenhuma pessoa por perto. Adicione amigos ou entre em um servidor.")
              : NX.i18n.get("modal.nenhumapessoaencontradaentreemum", "Nenhuma pessoa encontrada. Entre em um servidor para conhecer gente nova.")) +
          "</span></div>"
        );
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

    const repaint = () => {
      if (!results || !results.isConnected) return;
      results.innerHTML = listHTML(search ? search.value : "");
    };

    m.body.innerHTML =
      ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("modal.buscarpessoa", "Buscar pessoa") + "</span>") +
      '<span class="input-affix"><span class="input-affix__ico">' + NX.icon("search", "", 16) +
      '</span><input class="input" data-search placeholder="' + NX.i18n.get("ui.nomeouusuario", "Nome ou @usuário") + '" data-autofocus /></span></label>' +
      '<div class="dm-list dm-list--modal" data-results>' + listHTML("") + "</div>";

    const search = m.body.querySelector("[data-search]");
    const results = m.body.querySelector("[data-results]");
    search.addEventListener(
      "input",
      u().debounce(() => {
        results.innerHTML = listHTML(search.value);
      }, 160)
    );

    /* a amizade é global e pode ter sido fechada em outro aparelho:
       a lista é refeita a partir do backend, sem fechar o modal */
    Promise.resolve()
      .then(() => api().listFriends())
      .then((list) => {
        if (!Array.isArray(list)) return;
        const before = people.length;
        list.forEach(add);
        if (people.length === before) return;
        sortPeople();
        repaint();
      })
      .catch(() => {});

    /* um clique só: cliques repetidos não podem abrir duas conversas */
    let opening = false;
    results.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-open-dm]");
      if (!b || opening) return;
      opening = true;
      const uid = b.getAttribute("data-open-dm");
      try {
        const dm = await api().openDM(uid);
        m.close();
        NX.app.go("#/mensagens/" + dm.id);
      } catch (err) {
        opening = false;
        NX.ui.error(err.message);
      }
    });
  };

  /* =========================================================
     GRUPOS PRIVADOS NAS DMs
     Os três modais do grupo. Candidatos: amigos + pessoas dos
     meus servidores (mesma base do "Nova conversa"). O limite
     de 10 é validado NO BACKEND; aqui a interface só avisa
     antes de perder a viagem.
     ========================================================= */
  function groupCandidatePool() {
    const me = S().me();
    const people = [];
    const seen = {};
    const add = (p) => {
      if (!p || !p.id || p.id === me.id || seen[p.id]) return;
      if (!S().isPerson(p)) return;
      seen[p.id] = true;
      people.push(p);
    };
    S().friendsOf(me.id).forEach(add);
    S().membershipsOf(me.id).forEach((mm) => {
      S().membersOf(mm.serverId).forEach((row) => add(row.user));
    });
    const sort = () =>
      people.sort((a, b) => {
        const fa = S().isFriend(me.id, a.id) ? 0 : 1;
        const fb = S().isFriend(me.id, b.id) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        const oa = a.status === "online" ? 0 : 1;
        const ob = b.status === "online" ? 0 : 1;
        if (oa !== ob) return oa - ob;
        return String(a.displayName || "").localeCompare(String(b.displayName || ""));
      });
    sort();
    return { me: me, people: people, add: add, sort: sort };
  }

  /* ---- NOVO GRUPO ---- */
  M.newGroup = function () {
    const pool = groupCandidatePool();
    const people = pool.people;
    const selected = {};
    const selCount = () => Object.keys(selected).length + 1; /* + quem cria */

    const m = NX.ui.modal({
      title: NX.i18n.get("grp.novoGrupo", "Novo grupo"),
      eyebrow: NX.i18n.get("modal.mensagensDiretas", "Mensagens diretas"),
      size: "sm",
      footer: u().el(
        ACTIONS(
          '<button class="btn btn--ghost" type="button" data-modal-close>' +
            NX.i18n.get("common.close", "Fechar") +
            "</button>" +
            '<button class="btn btn--primary" type="button" data-create disabled>' +
            NX.i18n.get("grp.criarGrupo", "Criar grupo") +
            "</button>"
        )
      ),
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
        return (
          '<div class="invite-empty">' + NX.icon("users", "", 20) + "<span>" +
          NX.i18n.get("modal.nenhumapessoaencontrada", "Nenhuma pessoa corresponde à sua busca.") +
          "</span></div>"
        );
      const full = selCount() >= 10;
      return rows
        .map((p) => {
          const picked = !!selected[p.id];
          return (
            '<button class="dm-row dm-row--pick' +
            (picked ? " is-picked" : "") +
            (!picked && full ? " is-dim" : "") +
            '" data-pick="' + p.id + '">' +
            u().avatarHTML(p, "sm", true) +
            '<span class="dm-row__txt"><strong class="truncate">' + u().h(p.displayName) + "</strong>" +
            '<small class="truncate">@' + u().h(p.username) + " · " +
            u().h(NX.STATUS_LABEL[p.status] || "") +
            "</small></span>" +
            '<span class="dm-row__tick">' + (picked ? NX.icon("check", "", 16) : "") + "</span>" +
            "</button>"
          );
        })
        .join("");
    };

    m.body.innerHTML =
      '<label class="field"><span class="field__label">' +
      NX.i18n.get("grp.nomeDoGrupo", "Nome do grupo") + "</span>" +
      '<input class="input" data-name maxlength="64" placeholder="' +
      NX.i18n.get("grp.nomeGrupoPh", "Ex.: time do rolê") + '" data-autofocus /></label>' +
      '<p class="field__hint" data-count></p>' +
      '<label class="field"><span class="field__label">' + NX.i18n.get("modal.buscarpessoa", "Buscar pessoa") + "</span>" +
      '<span class="input-affix"><span class="input-affix__ico">' + NX.icon("search", "", 16) +
      '</span><input class="input" data-search placeholder="' + NX.i18n.get("ui.nomeouusuario", "Nome ou @usuário") + '" /></span></label>' +
      '<div class="dm-list dm-list--modal" data-results>' + listHTML("") + "</div>";

    const nameEl = m.body.querySelector("[data-name]");
    const countEl = m.body.querySelector("[data-count]");
    const search = m.body.querySelector("[data-search]");
    const results = m.body.querySelector("[data-results]");
    const createBtn = m.el.querySelector("[data-create]");

    const repaint = () => {
      const n = selCount();
      countEl.textContent =
        n +
        "/10 " +
        NX.i18n.get("grp.participantesNoTotal", "participantes no total (você inclusive)") +
        (n < 2
          ? " — " + NX.i18n.get("grp.minimoDuasPessoas", "Adicione pelo menos uma pessoa (o grupo começa com 2).")
          : "");
      createBtn.disabled = !(nameEl.value || "").trim() || n < 2;
      if (results && results.isConnected) results.innerHTML = listHTML(search ? search.value : "");
    };

    nameEl.addEventListener("input", repaint);
    search.addEventListener("input", u().debounce(repaint, 160));

    results.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick]");
      if (!b) return;
      const uid = b.getAttribute("data-pick");
      if (selected[uid]) delete selected[uid];
      else if (selCount() >= 10) {
        NX.ui.toast(NX.i18n.get("grp.limiteAtingido", "O limite é de 10 participantes por grupo."), "warn");
        return;
      } else selected[uid] = true;
      repaint();
    });

    let creating = false;
    createBtn.addEventListener("click", async () => {
      if (creating || createBtn.disabled) return;
      creating = true;
      createBtn.disabled = true;
      try {
        const dm = await api().createGroup(nameEl.value, Object.keys(selected));
        m.close();
        NX.app.go("#/mensagens/" + dm.id);
      } catch (err) {
        creating = false;
        createBtn.disabled = false;
        NX.ui.error(err.message);
      }
    });

    repaint();

    /* a amizade é global e pode mudar em outro aparelho: refaz a
       lista pelo backend sem fechar o modal */
    Promise.resolve()
      .then(() => api().listFriends())
      .then((list) => {
        if (!Array.isArray(list)) return;
        const before = people.length;
        list.forEach(pool.add);
        if (people.length === before) return;
        pool.sort();
        repaint();
      })
      .catch(() => {});
  };

  /* ---- ADICIONAR MEMBROS (só admin; abre de novo a cada clique,
     lê o tamanho atual e recusa quando está cheio) ---- */
  M.groupAddMembers = function (dmId) {
    const dm = NX.store.db.dms[dmId];
    if (!dm || !dm.isGroup) return;
    const pool = groupCandidatePool();

    const m = NX.ui.modal({
      title: NX.i18n.get("grp.adicionarMembros", "Adicionar membros"),
      eyebrow: NX.i18n.get("grp.membros", "Membros"),
      size: "sm",
      footer: u().el(
        ACTIONS(
          '<button class="btn btn--ghost" type="button" data-modal-close>' +
            NX.i18n.get("common.close", "Fechar") + "</button>"
        )
      ),
    });

    const live = () => NX.store.db.dms[dmId] || {};
    const members = () => live().participants || [];
    const count = () => Number(live().memberCount) || members().length;

    const listHTML = (filter) => {
      const have = members();
      const f = u().normalize(filter || "");
      const rows = pool.people.filter(
        (p) =>
          have.indexOf(p.id) === -1 &&
          (!f ||
            u().normalize(p.displayName).indexOf(f) !== -1 ||
            u().normalize(p.username).indexOf(f) !== -1)
      );
      if (!rows.length)
        return (
          '<div class="invite-empty">' + NX.icon("users", "", 20) + "<span>" +
          NX.i18n.get("modal.nenhumapessoaencontrada", "Nenhuma pessoa corresponde à sua busca.") +
          "</span></div>"
        );
      return rows
        .map(
          (p) =>
            '<button class="dm-row" data-add="' + p.id + '">' +
            u().avatarHTML(p, "sm", true) +
            '<span class="dm-row__txt"><strong class="truncate">' + u().h(p.displayName) + "</strong>" +
            '<small class="truncate">@' + u().h(p.username) + "</small></span>" +
            '<span class="dm-row__tick">' + NX.icon("plus", "", 16) + "</span>" +
            "</button>"
        )
        .join("");
    };

    m.body.innerHTML =
      '<p class="field__hint" data-count></p>' +
      '<label class="field"><span class="field__label">' + NX.i18n.get("modal.buscarpessoa", "Buscar pessoa") + "</span>" +
      '<span class="input-affix"><span class="input-affix__ico">' + NX.icon("search", "", 16) +
      '</span><input class="input" data-search placeholder="' + NX.i18n.get("ui.nomeouusuario", "Nome ou @usuário") + '" data-autofocus /></span></label>' +
      '<div class="dm-list dm-list--modal" data-results>' + listHTML("") + "</div>";

    const countEl = m.body.querySelector("[data-count]");
    const search = m.body.querySelector("[data-search]");
    const results = m.body.querySelector("[data-results]");

    const repaint = () => {
      const n = count();
      if (n >= 10) {
        countEl.textContent = NX.i18n.get(
          "grp.cheio",
          "Grupo cheio: 10/10 membros. Saia alguém para adicionar outra pessoa."
        );
        results.innerHTML = "";
        search.disabled = true;
      } else {
        countEl.textContent = n + "/10 " + NX.i18n.get("grp.membros", "membros");
        if (results.isConnected) results.innerHTML = listHTML(search.value);
      }
    };

    search.addEventListener("input", u().debounce(repaint, 160));

    results.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-add]");
      if (!b) return;
      const uid = b.getAttribute("data-add");
      b.disabled = true;
      try {
        await api().addGroupMember(dmId, uid);
        const p = S().user(uid);
        NX.ui.toast(
          NX.i18n.get("grp.adicionado", "Adicionado: ") + (p ? "@" + p.username : ""),
          "success"
        );
        repaint();
      } catch (err) {
        b.disabled = false;
        NX.ui.error(err.message);
        repaint(); /* mostra o aviso de cheio se o backend recusou */
      }
    });

    repaint();

    Promise.resolve()
      .then(() => api().listFriends())
      .then((list) => {
        if (!Array.isArray(list)) return;
        const before = pool.people.length;
        list.forEach(pool.add);
        if (pool.people.length === before) return;
        pool.sort();
        repaint();
      })
      .catch(() => {});
  };

  /* ---- EDITAR GRUPO (só admin): nome + emoji manual ou imagem ---- */
  M.groupEdit = function (dmId) {
    const dm = NX.store.db.dms[dmId];
    const me = S().me();
    if (!dm || !dm.isGroup || dm.adminId !== me.id) return;

    const iconState = {
      emoji: (dm.icon && dm.icon.emoji) || "",
      color: (dm.icon && dm.icon.color) || null,
      image: (dm.icon && dm.icon.image) || null,
    };

    const m = NX.ui.modal({
      title: NX.i18n.get("grp.editarGrupo", "Editar grupo"),
      eyebrow: NX.i18n.get("grp.membrosTitulo", "Participantes do grupo"),
      size: "sm",
      footer: u().el(
        ACTIONS(
          '<button class="btn btn--ghost" type="button" data-modal-close>' +
            NX.i18n.get("common.close", "Fechar") + "</button>" +
            '<button class="btn btn--primary" type="button" data-save>' +
            NX.i18n.get("common.save", "Salvar") + "</button>"
        )
      ),
    });

    m.body.innerHTML =
      '<label class="field"><span class="field__label">' +
      NX.i18n.get("grp.nomeDoGrupo", "Nome do grupo") + "</span>" +
      '<input class="input" data-name maxlength="64" data-autofocus /></label>' +
      '<label class="field"><span class="field__label">' +
      NX.i18n.get("grp.emoji", "Emoji (opcional, até 8 caracteres)") + "</span>" +
      '<input class="input" data-emoji maxlength="8" placeholder="🎮" /></label>' +
      '<div class="field"><span class="field__label">' + NX.i18n.get("grp.imagem", "Imagem do grupo") + "</span>" +
      '<div class="group-icon-edit">' +
      "<span data-preview></span>" +
      '<div class="group-icon-edit__acts">' +
      '<label class="btn btn--soft btn--sm">' + NX.i18n.get("grp.trocarImagem", "Enviar imagem") +
      '<input type="file" accept="image/*" data-image hidden /></label>' +
      '<button class="btn btn--ghost btn--sm" type="button" data-rm>' +
      NX.i18n.get("grp.removerImagem", "Remover imagem") + "</button>" +
      "</div></div></div>";

    const nameEl = m.body.querySelector("[data-name]");
    const emojiEl = m.body.querySelector("[data-emoji]");
    const preview = m.body.querySelector("[data-preview]");
    const fileEl = m.body.querySelector("[data-image]");
    const saveBtn = m.el.querySelector("[data-save]");

    nameEl.value = dm.name || "";
    emojiEl.value = iconState.emoji;

    const paintPreview = () => {
      preview.innerHTML = u().groupIconHTML(
        {
          id: dm.id,
          name: nameEl.value || dm.name,
          icon: Object.assign({}, iconState, { emoji: emojiEl.value ? emojiEl.value.trim() : null }),
        },
        "lg"
      );
    };
    paintPreview();

    nameEl.addEventListener("input", paintPreview);
    emojiEl.addEventListener("input", paintPreview);

    m.body.querySelector("[data-rm]").addEventListener("click", () => {
      iconState.image = null;
      paintPreview();
    });

    fileEl.addEventListener("change", () => {
      const file = fileEl.files && fileEl.files[0];
      if (!file) return;
      if (file.type.indexOf("image/") !== 0) {
        NX.ui.error(NX.i18n.get("grp.erroImagem", "Envie uma imagem válida."));
        fileEl.value = "";
        return;
      }
      const fr = new FileReader();
      fr.onload = () => {
        const data = String(fr.result || "");
        /* mesmo teto do backend — a imagem viaja dentro do JSON */
        if (data.length > 250000) {
          NX.ui.error(NX.i18n.get("grp.imagemGrande", "Imagem grande demais (máximo 250 KB)."));
          fileEl.value = "";
          return;
        }
        iconState.image = data;
        paintPreview();
      };
      fr.onerror = () => NX.ui.error(NX.i18n.get("chat.naoFoiPossivelLer2", "Não foi possível ler o arquivo."));
      fr.readAsDataURL(file);
    });

    let saving = false;
    saveBtn.addEventListener("click", async () => {
      if (saving) return;
      const name = String(nameEl.value || "").trim();
      if (!name) {
        NX.ui.error(NX.i18n.get("grp.nomeVazio", "O nome do grupo não pode ficar vazio."));
        return;
      }
      saving = true;
      try {
        await api().editGroup(dmId, {
          name: name,
          icon: {
            emoji: emojiEl.value ? emojiEl.value.trim().slice(0, 8) : null,
            color: iconState.color,
            image: iconState.image,
          },
        });
        m.close();
        NX.ui.toast(NX.i18n.get("grp.atualizado", "Grupo atualizado."), "success");
      } catch (err) {
        saving = false;
        NX.ui.error(err.message);
      }
    });
  };

  /* =========================================================
     CONVERSAS OCULTAS
     Remover da barra nunca apaga nada: a conversa, as mensagens e
     a relação entre as pessoas continuam guardadas e voltam na hora.
     ========================================================= */
  M.dmHidden = function () {
    const me = S().me();

    const rows = () => {
      const list = S().hiddenDmsOf(me.id);
      if (!list.length)
        return (
          '<div class="invite-empty">' +
          NX.icon("eyeOff", "", 20) +
          "<span>" +
          NX.i18n.get(
            "modal.nenhumaConversaOculta",
            "Nenhuma conversa oculta. As conversas que você remover da barra aparecem aqui."
          ) +
          "</span></div>"
        );
      return list
        .map((dm) => {
          const otherId =
            (dm.participants || []).find((p) => p !== me.id) || dm.participants[0];
          const other = NX.store.db.users[otherId];
          /* só conversa entre pessoas: app, bot ou conta de sistema
             nunca aparece — nem mesmo na lista de ocultas */
          if (!other || !S().isPerson(other)) return "";
          const msgs = S().messagesOf(dm.id);
          const last = msgs[msgs.length - 1];
          return (
            '<div class="dm-row dm-row--hidden">' +
            u().avatarHTML(other, "sm", true) +
            '<span class="dm-row__txt"><strong class="truncate">' +
            u().h(other.displayName) +
            "</strong>" +
            '<small class="truncate">' +
            (last
              ? u().h(last.content.slice(0, 46))
              : NX.i18n.get("view.mensagensAinda", "Sem mensagens ainda")) +
            "</small></span>" +
            '<button class="btn btn--soft btn--sm" type="button" data-unhide="' +
            dm.id +
            '">' +
            NX.icon("refresh", "", 14) +
            "<span>" +
            NX.i18n.get("view.restaurar", "Restaurar") +
            "</span></button>" +
            "</div>"
          );
        })
        .join("");
    };

    const m = NX.ui.modal({
      title: NX.i18n.get("view.conversasOcultas", "Conversas ocultas"),
      eyebrow: NX.i18n.get("modal.mensagensDiretas", "Mensagens diretas"),
      size: "sm",
      footer: u().el(
        ACTIONS(
          '<button class="btn btn--ghost" type="button" data-modal-close>' +
            NX.i18n.get("common.close", "Fechar") +
            "</button>"
        )
      ),
    });

    m.body.innerHTML =
      '<p class="pp-edit__p">' +
      NX.i18n.get(
        "modal.asConversasAquiNaoForamApagadas",
        "Nada foi apagado: estas conversas só saíram da sua barra. Restaurar devolve a conversa com todas as mensagens."
      ) +
      '</p><div class="dm-list dm-list--modal" data-results>' +
      rows() +
      "</div>";

    m.body.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-unhide]");
      if (!b) return;
      try {
        await api().archiveDM(b.getAttribute("data-unhide"), false);
        const host = m.body.querySelector("[data-results]");
        if (host) host.innerHTML = rows();
        NX.ui.toast(
          NX.i18n.get("view.conversaRestaurada", "Conversa restaurada."),
          "success"
        );
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
        ? { label: NX.i18n.get("modal.convidarPessoas2", "Convidar pessoas"), icon: "userPlus", onClick: () => M.invite(serverId) }
        : null,
      { label: (NX.i18n.get("adm.membros", "Membros")), icon: "users", onClick: () => M.serverSettings(serverId, "members") },
      canManage
        ? { label: NX.i18n.get("landing.cargosPermissoes2", "Cargos e permissões"), icon: "shield", onClick: () => M.serverSettings(serverId, "roles") }
        : null,
      canInvite ? { label: NX.i18n.get("modal.convitesAtivos", "Convites ativos"), icon: "link", onClick: () => M.serverSettings(serverId, "invites") } : null,
      { label: NX.i18n.get("adm.configuracoesServidor", "Configurações do servidor"), icon: "settings", onClick: () => M.serverSettings(serverId, "general") },
      { divider: true },
      isOwner
        ? {
            label: NX.i18n.get("adm.excluirServidor", "Excluir servidor"),
            icon: "trash",
            danger: true,
            onClick: () => M.serverSettings(serverId, "danger"),
          }
        : {
            label: NX.i18n.get("modal.sairServidor", "Sair do servidor"),
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
          label: NX.i18n.get("modal.copiarLinkCanal", "Copiar link do canal"),
          icon: "link",
          onClick: async () => {
            const ok = await u().copy(location.href.split("#")[0] + "#/s/" + ch.serverId + "/" + ch.id);
            NX.ui.toast(ok ? NX.i18n.get("modal.linkCopiado2", "Link copiado!") : NX.i18n.get("adm.naoFoiPossivelCopiar2", "Não foi possível copiar."), ok ? "success" : "error");
          },
        },
        { divider: true },
        { label: NX.i18n.get("modal.editarCanal2", "Editar canal"), icon: "pencil", onClick: () => M.channelSettings(channelId) },
        {
          label: NX.i18n.get("adm.excluirCanal", "Excluir canal"),
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
          label: NX.i18n.get("modal.criarCanalAqui", "Criar canal aqui"),
          icon: "plus",
          onClick: () => M.createChannel(cat.serverId, categoryId),
        },
        { label: NX.i18n.get("modal.editarCategoria2", "Editar categoria"), icon: "pencil", onClick: () => M.categorySettings(categoryId) },
        { divider: true },
        {
          label: NX.i18n.get("adm.excluirCategoria", "Excluir categoria"),
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
    /* ID público numérico (o u_muzo… interno nunca aparece aqui) */
    const pid = me.publicId ? "#" + me.publicId : "";
    NX.ui.menu(
      anchor,
      [
        { heading: me.displayName + " · @" + me.username },
        { label: NX.i18n.get("modal.meuPerfil", "Meu perfil"), icon: "user", onClick: () => NX.app.go("#/perfil/" + me.id) },
        { label: NX.i18n.get("modal.editarPerfil2", "Editar perfil"), icon: "pencil", onClick: () => M.editProfile() },
        { divider: true },
        { heading: (NX.i18n.get("modal.status", "Status")) },
        ...Object.keys(NX.STATUS_LABEL).map((k) => ({
          label: NX.STATUS_LABEL[k],
          /* símbolo próprio do Nexo, colorido, na versão selecionada */
          iconHTML:
            '<span class="menu__ico">' + NX.statusIcon(k, { size: 16, sel: me.status === k }) + "</span>",
          check: me.status === k,
          onClick: () => NX.api.setStatus(k).catch(() => {}),
        })),
        ...(pid
          ? [
              { divider: true },
              {
                label: NX.i18n.get("modal.iddousuario", "ID do usuário"),
                icon: "copy",
                hint: pid,
                onClick: () => {
                  NX.util.copy(String(me.publicId)).then((ok) =>
                    NX.ui.toast(
                      ok
                        ? NX.i18n.get("modal.idCopiado", "ID ") + pid + NX.i18n.get("modal.copiado", " copiado.")
                        : NX.i18n.get("modal.naoCopiar", "Não foi possível copiar o ID."),
                      ok ? "success" : "error"
                    )
                  );
                },
              },
            ]
          : []),
        { divider: true },
        {
          label: theme === "dark" ? NX.i18n.get("set.item.themeLight", "Tema claro") : NX.i18n.get("set.item.themeDark", "Tema escuro"),
          icon: "palette",
          onClick: () => NX.applyTheme(theme === "dark" ? "light" : "dark"),
        },
        { label: NX.i18n.get("app.sairConta", "Sair da conta"), icon: "logout", danger: true, onClick: () => NX.app.logout() },
      ],
      { align: "start", side: "top" }
    );
  };

  /* widget de ícone compartilhado: usado nos modais daqui (criar
     servidor / configurações legado) e no painel NX.admin */
  M.iconUploadHTML = iconUploadHTML;
  M.bindIconUpload = bindIconUpload;
  /* editor unificado Imagem × Logo + cores livres: exportado para o
     NX.admin usar o MESMO editor (sem divergência entre os dois) */
  M.iconEditorHTML = iconEditorHTML;
  M.bindIconEditor = bindIconEditor;
  M.logoColorsHTML = logoColorsHTML;
  M.bindLogoColors = bindLogoColors;

  NX.modals = M;
})(window.NX);
