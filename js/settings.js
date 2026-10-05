/* ============================================================
   NEXO · tela de configurações do usuário
   Preenche o container #screen-settings (criado no index.html).
   Auto-suficiente:
     · classes CSS prefixadas com `set-` (css/settings.css)
     · ações registradas em NX.action com prefixo `set-`
     · estado persistido com NX.storage (sobrevive a reload)
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  /* ---------------- helpers ---------------- */
  const esc = (s) => (NX.util ? NX.util.h(s) : String(s == null ? "" : s));
  const ico = (n, s) => (NX.icon ? NX.icon(n, "", s || 18) : "");

  const toast = (msg, type) => {
    try {
      if (NX.ui && NX.ui.toast) NX.ui.toast(msg, type);
    } catch (e) {
      /* sem UI de toast: segue sem quebrar */
    }
  };

  const get = (key, fb) => {
    try {
      return NX.storage ? NX.storage.get(key, fb) : fb;
    } catch (e) {
      return fb;
    }
  };

  const set = (key, value) => {
    try {
      if (NX.storage) NX.storage.set(key, value);
    } catch (e) {
      /* armazenamento indisponível */
    }
  };

  const me = () => {
    try {
      return NX.selectors && NX.selectors.me ? NX.selectors.me() : null;
    } catch (e) {
      return null;
    }
  };

  const uid = (p) =>
    NX.util && NX.util.uid ? NX.util.uid(p) : p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const timeAgo = (ts) => {
    try {
      if (NX.util && NX.util.timeAgo) return NX.util.timeAgo(ts);
    } catch (e) {
      /* cai no padrão */
    }
    return "";
  };

  /* ---------------- chaves de persistência ---------------- */
  const K = {
    themeMode: "nexo.themeMode", // 'dark' | 'light' | 'auto'
    theme: "nexo.theme",         // valor resolvido (escrito por NX.applyTheme)
    uiScale: "nexo.uiScale",     // 'sm' | 'md' | 'lg'
    prefs: "nexo.prefs",         // { messages, mentions, sounds }
    privacy: "nexo.privacy",     // { dms, invites }
    blocks: "nexo.blocks",       // [{ id, name, at }]
    sessions: "nexo.sessions",   // [{ id, name, current, last, os }]
  };

  /* =========================================================
     TEMA
     ========================================================= */
  const THEME_MODES = ["dark", "light", "auto"];
  const THEME_SECTIONS = { "theme-dark": "dark", "theme-light": "light", "theme-auto": "auto" };

  function systemTheme() {
    try {
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    } catch (e) {
      /* sem matchMedia: escuro por padrão */
    }
    return "dark";
  }

  function themeMode() {
    const saved = get(K.themeMode, null);
    if (THEME_MODES.indexOf(saved) > -1) return saved;
    const resolved = get(K.theme, "dark");
    return resolved === "light" ? "light" : "dark";
  }

  function applyThemeMode(mode) {
    const m = THEME_MODES.indexOf(mode) > -1 ? mode : "auto";
    const resolved = m === "auto" ? systemTheme() : m;
    set(K.themeMode, m);
    try {
      if (NX.applyTheme) NX.applyTheme(resolved);
      else document.documentElement.setAttribute("data-theme", resolved);
    } catch (e) {
      document.documentElement.setAttribute("data-theme", resolved);
    }
    return m;
  }

  function watchSystemTheme() {
    if (NX.__setThemeWatch || !window.matchMedia) return;
    NX.__setThemeWatch = true;
    try {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        if (themeMode() === "auto") applyThemeMode("auto");
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch (e) {
      /* preferência do sistema indisponível */
    }
  }

  /* =========================================================
     TAMANHO DA INTERFACE
     ========================================================= */
  const SCALES = { sm: 0.94, md: 1, lg: 1.07 };
  const SCALE_LABEL = { sm: "Pequeno", md: "Padrão", lg: "Grande" };

  function uiScale() {
    const v = get(K.uiScale, "md");
    return SCALES[v] ? v : "md";
  }

  function applyScale(value) {
    const key = SCALES[value] ? value : "md";
    const factor = SCALES[key];
    set(K.uiScale, key);
    try {
      const root = document.documentElement;
      root.style.setProperty("--ui-scale", String(factor));
      root.style.fontSize = factor === 1 ? "" : Math.round(15 * factor) + "px";
      if ("zoom" in root.style) root.style.zoom = factor === 1 ? "" : String(factor);
    } catch (e) {
      /* escala é opcional */
    }
    return key;
  }

  /* =========================================================
     PREFERÊNCIAS · PRIVACIDADE · BLOQUEIOS · SESSÕES
     ========================================================= */
  const PREF_DEFAULTS = { messages: true, mentions: true, sounds: true };

  function prefs() {
    const saved = get(K.prefs, null);
    return Object.assign({}, PREF_DEFAULTS, saved && typeof saved === "object" ? saved : {});
  }

  function savePref(key, value) {
    const p = prefs();
    p[key] = !!value;
    set(K.prefs, p);
    return p;
  }

  const PRIVACY_DEFAULTS = { dms: "all", invites: "everyone" };

  function privacy() {
    const saved = get(K.privacy, null);
    return Object.assign({}, PRIVACY_DEFAULTS, saved && typeof saved === "object" ? saved : {});
  }

  function savePrivacy(patch) {
    const p = Object.assign(privacy(), patch || {});
    set(K.privacy, p);
    return p;
  }

  function blocks() {
    const saved = get(K.blocks, null);
    return Array.isArray(saved) ? saved : [];
  }

  function saveBlocks(list) {
    set(K.blocks, list);
    return list;
  }

  function defaultSessions() {
    const now = Date.now();
    return [
      { id: "sess-this", name: "Este navegador", current: true, last: now, os: platformInfo() },
      { id: "sess-other", name: "Outro dispositivo", current: false, last: now - 2 * 86400000, os: "Android · Chrome" },
    ];
  }

  function sessions() {
    const saved = get(K.sessions, null);
    if (Array.isArray(saved)) return saved;
    const fresh = defaultSessions();
    set(K.sessions, fresh);
    return fresh;
  }

  function saveSessions(list) {
    set(K.sessions, list);
    return list;
  }

  function platformInfo() {
    try {
      const ua = navigator.userAgent || "";
      let os = "Sistema desconhecido";
      if (/Windows/i.test(ua)) os = "Windows";
      else if (/Android/i.test(ua)) os = "Android";
      else if (/iPhone|iPad|iPod|iOS/i.test(ua)) os = "iOS";
      else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
      else if (/Linux/i.test(ua)) os = "Linux";

      let br = "Navegador";
      if (/Edg\//.test(ua)) br = "Edge";
      else if (/OPR\/|Opera/.test(ua)) br = "Opera";
      else if (/Firefox\//.test(ua)) br = "Firefox";
      else if (/Chrome\//.test(ua)) br = "Chrome";
      else if (/Safari\//.test(ua)) br = "Safari";

      return os + " · " + br;
    } catch (e) {
      return "Sistema desconhecido";
    }
  }

  /* =========================================================
     SOM (teste de notificação)
     ========================================================= */
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        toast("Seu navegador não permitiu tocar o som de teste.", "info");
        return;
      }
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
      osc.onended = () => {
        try {
          if (ctx.close) ctx.close();
        } catch (e) {
          /* contexto já fechado */
        }
      };
    } catch (e) {
      /* protótipo local: segue sem som */
    }
  }

  /* =========================================================
     NAVEGAÇÃO (grupos do menu)
     ========================================================= */
  const GROUPS = [
    {
      title: "MINHA CONTA",
      items: [
        { id: "account", label: "Perfil", icon: "user" },
        { id: "email", label: "E-mail", icon: "mail" },
        { id: "password", label: "Senha", icon: "lock" },
      ],
    },
    {
      title: "APARÊNCIA",
      items: [
        { id: "theme-dark", label: "Tema escuro", icon: "sparkles" },
        { id: "theme-light", label: "Tema claro", icon: "sparkle" },
        { id: "theme-auto", label: "Tema automático", icon: "refresh" },
        { id: "ui-size", label: "Tamanho da interface", icon: "menu" },
      ],
    },
    {
      title: "NOTIFICAÇÕES",
      items: [
        { id: "notif-messages", label: "Mensagens", icon: "chat" },
        { id: "notif-mentions", label: "Menções", icon: "bell" },
        { id: "notif-sounds", label: "Sons", icon: "headset" },
      ],
    },
    {
      title: "PRIVACIDADE",
      items: [
        { id: "privacy-dms", label: "Mensagens privadas", icon: "lock" },
        { id: "privacy-invites", label: "Convites", icon: "link" },
        { id: "privacy-blocks", label: "Bloqueios", icon: "alert" },
      ],
    },
    {
      title: "SEGURANÇA",
      items: [
        { id: "security-sessions", label: "Sessões", icon: "clock" },
        { id: "security-devices", label: "Dispositivos", icon: "grid" },
      ],
    },
  ];

  const SIGNOUT_ITEM = { id: "logout", label: "Sair", icon: "logout", danger: true };

  const SECTION_IDS = GROUPS.reduce((acc, g) => acc.concat(g.items.map((i) => i.id)), []).concat(["logout"]);

  /* seção -> painel */
  const SECTION_PANEL = {
    account: "account",
    email: "email",
    password: "password",
    "theme-dark": "appearance",
    "theme-light": "appearance",
    "theme-auto": "appearance",
    "ui-size": "appearance",
    "notif-messages": "notifications",
    "notif-mentions": "notifications",
    "notif-sounds": "notifications",
    "privacy-dms": "privacy",
    "privacy-invites": "privacy",
    "privacy-blocks": "privacy",
    "security-sessions": "security",
    "security-devices": "security",
    logout: "logout",
  };

  const ALIASES = {
    profile: "account",
    perfil: "account",
    conta: "account",
    senha: "password",
    mail: "email",
    tema: "theme-dark",
    theme: "theme-dark",
    appearance: "theme-dark",
    themes: "theme-dark",
    size: "ui-size",
    interface: "ui-size",
    notifications: "notif-messages",
    notificacoes: "notif-messages",
    privacy: "privacy-dms",
    privacidade: "privacy-dms",
    security: "security-sessions",
    seguranca: "security-sessions",
    sair: "logout",
    signout: "logout",
  };

  /* =========================================================
     BLOCOS DE HTML REUTILIZÁVEIS
     ========================================================= */
  function headBlock(title, desc) {
    return (
      '<div class="set-card__head"><h2>' + esc(title) + "</h2>" +
      (desc ? "<p>" + esc(desc) + "</p>" : "") +
      "</div>"
    );
  }

  function fieldBlock(label, control, hint) {
    return (
      '<div class="set-field"><span class="set-label">' + esc(label) + "</span>" +
      control +
      (hint ? '<span class="set-hint">' + hint + "</span>" : "") +
      "</div>"
    );
  }

  function errorBlock() {
    return '<div class="form-error set-error" data-error hidden></div>';
  }

  function noteBlock(text, kind) {
    return (
      '<div class="set-note' + (kind === "accent" ? " set-note--accent" : "") + '">' +
      ico(kind === "accent" ? "check" : "info", 17) +
      "<span>" + esc(text) + "</span></div>"
    );
  }

  function emptyBlock(icon, title, text) {
    return (
      '<div class="set-empty"><span class="set-empty__ico">' + ico(icon, 20) + "</span>" +
      "<strong>" + esc(title) + "</strong><p>" + esc(text) + "</p></div>"
    );
  }

  function switchRow(key, on, title, desc) {
    return (
      '<label class="set-row" data-row="' + key + '">' +
      '<span class="set-row__txt"><strong>' + esc(title) + "</strong>" +
      (desc ? "<small>" + esc(desc) + "</small>" : "") +
      "</span>" +
      '<span class="set-switch"><input type="checkbox" data-pref="' + key + '"' +
      (on ? " checked" : "") + " /><i></i></span></label>"
    );
  }

  function emojiGrid(selected) {
    const list = [];
    const seen = {};
    (NX.util && NX.util.EMOJIS ? NX.util.EMOJIS : ["🌙", "⚡", "🎧", "🔥", "🌊", "🌱", "🎲", "🚀", "🐙", "🎯"]).forEach(
      (e) => {
        if (!seen[e]) {
          seen[e] = true;
          list.push(e);
        }
      }
    );
    return (
      '<div class="set-emoji-grid" data-emojis>' +
      list
        .map(
          (e) =>
            '<button type="button" class="set-emoji' + (e === selected ? " is-on" : "") +
            '" data-pick-emoji="' + esc(e) + '" aria-label="Emoji ' + esc(e) + '">' + esc(e) + "</button>"
        )
        .join("") +
      "</div>"
    );
  }

  function swatches(selected) {
    const palette = (NX.util && NX.util.PALETTE) || ["#35e0a8", "#4cc9f0", "#8f83ff"];
    return (
      '<div class="set-swatches" data-swatches>' +
      palette
        .map(
          (c) =>
            '<button type="button" class="set-swatch' + (c === selected ? " is-on" : "") +
            '" style="--sw:' + esc(c) + '" data-pick-color="' + esc(c) + '" aria-label="Cor ' + esc(c) + '"></button>'
        )
        .join("") +
      "</div>"
    );
  }

  function statusOptions(current) {
    const labels = NX.STATUS_LABEL || { online: "Online", idle: "Ausente", dnd: "Não perturbe", offline: "Offline" };
    return Object.keys(labels)
      .map(
        (k) =>
          '<option value="' + k + '"' + (k === current ? " selected" : "") + ">" + esc(labels[k]) + "</option>"
      )
      .join("");
  }

  function needAccount(text) {
    return '<section class="set-card">' + headBlock("Sua conta", text) +
      '<div class="set-card__foot"><button type="button" class="set-btn set-btn--primary" data-set="close">Fechar</button></div></section>';
  }

  function formData(form) {
    const out = {};
    if (!form || !form.elements) return out;
    for (let i = 0; i < form.elements.length; i++) {
      const el = form.elements[i];
      if (!el.name || el.disabled) continue;
      if (el.type === "checkbox" || el.type === "radio") {
        if (el.checked) out[el.name] = el.value;
      } else {
        out[el.name] = el.value;
      }
    }
    return out;
  }

  function showErr(el, msg) {
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML = ico("alert", 16) + "<span>" + esc(msg) + "</span>";
  }

  /* =========================================================
     PAINÉIS
     ========================================================= */
  const PANELS = {};

  /* ---------- 1. Perfil ---------- */
  PANELS.account = function () {
    const m = me();
    if (!m) return { html: needAccount("Entre na sua conta para editar seu perfil.") };

    const avatar = m.avatar || {};
    const emoji = avatar.emoji || (NX.util && NX.util.emojiFor ? NX.util.emojiFor(m.username) : "🌙");
    const color = avatar.color || (NX.util && NX.util.colorFor ? NX.util.colorFor(m.id) : "#35e0a8");
    const bio = m.bio || "";

    const html =
      '<section class="set-card">' +
      headBlock("Seu perfil", "Como você aparece nas comunidades e nas conversas.") +
      '<div class="set-avatar">' +
      '<span class="set-avatar__img" data-av style="--av:' + esc(color) + '">' +
      '<span data-av-glyph>' + esc(emoji) + "</span>" +
      '<i class="set-avatar__dot" data-av-dot data-status="' + esc(m.status || "offline") + '"></i></span>' +
      '<div class="set-avatar__meta"><strong data-live>' + esc(m.displayName || m.username) + "</strong>" +
      "<span>@" + esc(m.username) + (m.createdAt ? " · no Nexo desde " + new Date(m.createdAt).getFullYear() : "") + "</span></div>" +
      "</div>" +
      '<form data-form="profile" novalidate>' +
      fieldBlock("Emoji do avatar", emojiGrid(emoji)) +
      fieldBlock("Cor do avatar", swatches(color)) +
      fieldBlock(
        "Nome de exibição",
        '<input class="set-input" name="displayName" maxlength="32" autocomplete="display-name" value="' +
          esc(m.displayName || "") + '" />'
      ) +
      fieldBlock(
        "Nome de usuário",
        '<input class="set-input" name="username" maxlength="18" autocomplete="username" value="' +
          esc(m.username || "") + '" />',
        "De 3 a 18 caracteres: letras, números, ponto e _."
      ) +
      fieldBlock(
        "Bio",
        '<textarea class="set-textarea" name="bio" rows="3" maxlength="190" placeholder="Conte em uma linha quem é você">' +
          esc(bio) + "</textarea>",
        '<span data-count>' + String(bio).length + "</span>/190 caracteres"
      ) +
      '<div class="set-grid-2">' +
      fieldBlock(
        "Status",
        '<select class="set-select" name="status">' + statusOptions(m.status || "online") + "</select>"
      ) +
      fieldBlock(
        "Status personalizado",
        '<input class="set-input" name="statusText" maxlength="60" placeholder="ex.: estudando" value="' +
          esc(m.statusText || "") + '" />'
      ) +
      "</div>" +
      errorBlock() +
      '<div class="set-card__foot">' +
      '<button type="button" class="set-btn set-btn--ghost" data-set="reset-profile">Descartar</button>' +
      '<button type="submit" class="set-btn set-btn--primary" data-busy-label="Salvando">Salvar alterações</button>' +
      "</div>" +
      "</form></section>";

    return {
      html: html,
      wire: function (host) {
        const form = host.querySelector('[data-form="profile"]');
        if (!form) return;
        const state = { emoji: emoji, color: color };
        const av = form.querySelector("[data-av]");
        const glyph = form.querySelector("[data-av-glyph]");
        const dot = form.querySelector("[data-av-dot]");
        const live = form.querySelector("[data-live]");

        form.addEventListener("click", (e) => {
          const em = e.target && e.target.closest ? e.target.closest("[data-pick-emoji]") : null;
          if (em && form.contains(em)) {
            state.emoji = em.getAttribute("data-pick-emoji");
            Array.prototype.forEach.call(form.querySelectorAll("[data-pick-emoji]"), (b) =>
              b.classList.toggle("is-on", b === em)
            );
            if (glyph) glyph.textContent = state.emoji;
            return;
          }
          const co = e.target && e.target.closest ? e.target.closest("[data-pick-color]") : null;
          if (co && form.contains(co)) {
            state.color = co.getAttribute("data-pick-color");
            Array.prototype.forEach.call(form.querySelectorAll("[data-pick-color]"), (b) =>
              b.classList.toggle("is-on", b === co)
            );
            if (av) av.style.setProperty("--av", state.color);
          }
        });

        form.addEventListener("input", (e) => {
          const t = e.target;
          if (!t || !t.name) return;
          if (t.name === "displayName" && live) live.textContent = t.value.trim() || (m.displayName || m.username);
          if (t.name === "bio") {
            const c = form.querySelector("[data-count]");
            if (c) c.textContent = String(t.value.length);
          }
        });

        form.addEventListener("change", (e) => {
          if (e.target && e.target.name === "status" && dot) dot.setAttribute("data-status", e.target.value);
        });

        form.addEventListener("submit", (e) => {
          e.preventDefault();
          saveProfile(form, state);
        });
      },
    };
  };

  function saveProfile(form, state) {
    const err = form.querySelector("[data-error]");
    showErr(err, "");
    const d = formData(form);
    const displayName = String(d.displayName || "").trim();
    const username = String(d.username || "").trim();

    if (displayName.length < 2) {
      showErr(err, "Digite um nome com pelo menos 2 caracteres.");
      return;
    }
    if (NX.util && NX.util.usernameOk && !NX.util.usernameOk(username)) {
      showErr(err, "Nome de usuário precisa de 3 a 18 caracteres (letras, números, ponto e _).");
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    const done = NX.ui && NX.ui.busy ? NX.ui.busy(btn) : function () {};

    NX.api
      .updateProfile({
        displayName: displayName,
        username: username,
        bio: String(d.bio || ""),
        status: d.status,
        statusText: String(d.statusText || ""),
        avatar: { emoji: state.emoji, color: state.color },
      })
      .then(() => {
        toast("Perfil atualizado.", "success");
        refresh();
      })
      .catch((e) => {
        const msg = (e && e.message) || "Não foi possível salvar agora. Tente de novo.";
        showErr(err, msg);
        toast(msg, "error");
      })
      .then(done, done);
  }

  /* ---------- 2. E-mail ---------- */
  PANELS.email = function () {
    const m = me();
    if (!m) return { html: needAccount("Entre na sua conta para alterar o e-mail.") };

    const html =
      '<section class="set-card">' +
      headBlock("E-mail da conta", "Usado para entrar na sua conta e para recuperar o acesso quando você esquecer a senha.") +
      '<form data-form="email" novalidate>' +
      '<div class="set-note set-note--accent" style="margin-bottom:14px">' + ico("info", 17) +
      "<span>Conta conectada como <strong>@" + esc(m.username) + "</strong>. Ao trocar o e-mail, o próximo login passa a usá-lo.</span></div>" +
      fieldBlock(
        "E-mail",
        '<input class="set-input" type="email" name="email" maxlength="120" autocomplete="email" value="' +
          esc(m.email || "") + '" />',
        "Digite um endereço válido, como voce@exemplo.com."
      ) +
      errorBlock() +
      '<div class="set-card__foot">' +
      '<button type="submit" class="set-btn set-btn--primary" data-busy-label="Salvando">Salvar e-mail</button>' +
      "</div></form></section>";

    return {
      html: html,
      wire: function (host) {
        const form = host.querySelector('[data-form="email"]');
        if (!form) return;
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const err = form.querySelector("[data-error]");
          showErr(err, "");
          const email = String(formData(form).email || "").trim();
          if (NX.util && NX.util.isEmail && !NX.util.isEmail(email)) {
            showErr(err, "Digite um e-mail válido, como voce@exemplo.com.");
            return;
          }
          const btn = form.querySelector('button[type="submit"]');
          const done = NX.ui && NX.ui.busy ? NX.ui.busy(btn) : function () {};
          NX.api
            .updateProfile({ email: email })
            .then(() => {
              toast("E-mail atualizado. Use o novo endereço no próximo login.", "success");
              refresh();
            })
            .catch((er) => {
              const msg = (er && er.message) || "Não foi possível alterar o e-mail agora.";
              showErr(err, msg);
              toast(msg, "error");
            })
            .then(done, done);
        });
      },
    };
  };

  /* ---------- 3. Senha ---------- */
  PANELS.password = function () {
    const m = me();
    if (!m) return { html: needAccount("Entre na sua conta para alterar sua senha.") };

    const passField = (name, label, placeholder) =>
      fieldBlock(
        label,
        '<span class="set-pass">' +
          '<input class="set-input" type="password" name="' + name + '" maxlength="64" autocomplete="new-password" placeholder="' +
          esc(placeholder) + '" />' +
          '<button type="button" class="set-pass__eye" data-set="toggle-pass" data-target="' + name +
          '" aria-label="Mostrar senha">' + ico("eye", 18) + "</button></span>"
      );

    const html =
      '<section class="set-card">' +
      headBlock("Alterar senha", "Escolha uma senha com pelo menos 6 caracteres e confirme abaixo.") +
      '<form data-form="password" novalidate>' +
      passField("password", "Nova senha", "Mínimo de 6 caracteres") +
      passField("confirm", "Confirmar nova senha", "Digite a mesma senha de novo") +
      errorBlock() +
      '<div class="set-card__foot">' +
      '<button type="submit" class="set-btn set-btn--primary" data-busy-label="Verificando">Atualizar senha</button>' +
      "</div></form>" +
      '<div style="margin-top:14px">' +
      noteBlock("Protótipo local: a senha é validada aqui na tela. A gravação real sai junto com o backend.", null) +
      "</div></section>";

    return {
      html: html,
      wire: function (host) {
        const form = host.querySelector('[data-form="password"]');
        if (!form) return;
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const err = form.querySelector("[data-error]");
          showErr(err, "");
          const d = formData(form);
          const pw = String(d.password || "");
          const confirm = String(d.confirm || "");

          if (!NX.util || !NX.util.passwordOk || !NX.util.passwordOk(pw)) {
            showErr(err, "A senha precisa ter no menos 6 caracteres.");
            return;
          }
          if (pw !== confirm) {
            showErr(err, "As senhas não conferem. Digite a mesma senha nos dois campos.");
            return;
          }
          form.reset();
          toast("Senha alterada! Em produção esta troca é gravada pelo backend.", "success");
        });
      },
    };
  };

  /* ---------- 4. Aparência (tema + tamanho) ---------- */
  const THEME_CARDS = [
    { key: "dark", label: "Escuro", icon: "sparkles", desc: "Paleta carvão com acento menta. Padrão do Nexo.", bg: "#0d1416", fg: "#e8f3f0", ac: "#35e0a8" },
    { key: "light", label: "Claro", icon: "sparkle", desc: "Névoa clara para ambientes com muita luz.", bg: "#fbfdfc", fg: "#12211e", ac: "#0b9e75" },
    { key: "auto", label: "Automático", icon: "refresh", desc: "Segue a preferência de claro/escuro do seu sistema.", bg: "linear-gradient(90deg,#0d1416 50%,#fbfdfc 50%)", fg: "#93a8a4", ac: "#4cc9f0" },
  ];

  PANELS.appearance = function (focusKey) {
    const mode = themeMode();
    const scale = uiScale();

    const themes = THEME_CARDS.map((t) => {
      const on = t.key === mode;
      return (
        '<label class="set-theme' + (on ? " is-on" : "") + '" data-theme-card="' + t.key + '">' +
        '<input type="radio" name="set-theme-mode" value="' + t.key + '"' + (on ? " checked" : "") + " />" +
        '<span class="set-theme__top"><span class="set-theme__ico">' + ico(t.icon, 18) + "</span>" +
        '<span class="set-theme__check">' + ico("check", 15) + "</span></span>" +
        '<span class="set-theme__prev" style="--prev-bg:' + t.bg + ";--prev-fg:" + t.fg + ";--prev-ac:" + t.ac + '">' +
        "<i></i><i></i><i></i></span>" +
        "<strong>" + esc(t.label) + "</strong><small>" + esc(t.desc) + "</small></label>"
      );
    }).join("");

    const segs = Object.keys(SCALES)
      .map((k) => {
        const on = k === scale;
        return (
          '<label class="set-seg__btn' + (on ? " is-on" : "") + '" data-scale-card="' + k + '">' +
          '<input type="radio" name="set-ui-scale" value="' + k + '"' + (on ? " checked" : "") + " />" +
          "<span>" + esc(SCALE_LABEL[k]) + "</span></label>"
        );
      })
      .join("");

    const html =
      '<section class="set-card" data-focus-card="theme">' +
      headBlock("Tema", "Escolha como o Nexo aparece. O modo automático acompanha a preferência de claro/escuro do seu sistema.") +
      '<div class="set-themes" data-themes>' + themes + "</div>" +
      "</section>" +
      '<section class="set-card" data-focus-card="ui-size">' +
      headBlock("Tamanho da interface", "Aumente ou reduza o conjunto da interface neste dispositivo.") +
      '<div class="set-seg" data-segments>' + segs + "</div>" +
      '<div class="set-preview" data-preview style="--pv:' + SCALES[scale] + '">' +
      "<strong>Interface Nexo Aa</strong><span>Amostra de texto para conferir o tamanho antes de fechar.</span></div>" +
      '<div style="margin-top:14px">' +
      noteBlock("A escolha fica salva neste navegador e volta assim que você abrir o Nexo de novo.", "accent") +
      "</div></section>";

    return {
      html: html,
      wire: function (host) {
        const themesBox = host.querySelector("[data-themes]");
        if (themesBox) {
          themesBox.addEventListener("change", (e) => {
            const input = e.target;
            if (!input || input.name !== "set-theme-mode") return;
            applyThemeMode(input.value);
            markThemes(host, input.value);
          });
        }
        const segBox = host.querySelector("[data-segments]");
        if (segBox) {
          segBox.addEventListener("change", (e) => {
            const input = e.target;
            if (!input || input.name !== "set-ui-scale") return;
            applyScale(input.value);
            markScales(host, input.value);
          });
        }
      },
    };
  };

  function markThemes(host, mode) {
    Array.prototype.forEach.call(host.querySelectorAll("[data-theme-card]"), (el) => {
      el.classList.toggle("is-on", el.getAttribute("data-theme-card") === mode);
      const input = el.querySelector("input");
      if (input) input.checked = el.getAttribute("data-theme-card") === mode;
    });
  }

  function markScales(host, value) {
    Array.prototype.forEach.call(host.querySelectorAll("[data-scale-card]"), (el) => {
      el.classList.toggle("is-on", el.getAttribute("data-scale-card") === value);
      const input = el.querySelector("input");
      if (input) input.checked = el.getAttribute("data-scale-card") === value;
    });
    const preview = host.querySelector("[data-preview]");
    if (preview) preview.style.setProperty("--pv", String(SCALES[value] || 1));
  }

  /* ---------- 5. Notificações ---------- */
  PANELS.notifications = function (focusKey) {
    const p = prefs();

    const html =
      '<section class="set-card">' +
      headBlock("Notificações", "Escolha o que merece sua atenção enquanto você está por aqui.") +
      switchRow("messages", p.messages, "Mensagens", "Avisos de mensagens diretas e de canais em que você participa.") +
      switchRow("mentions", p.mentions, "Menções", "Avisos quando alguém escreve @você.") +
      switchRow("sounds", p.sounds, "Sons", "Toca um alerta curto junto com a notificação.") +
      '<div class="set-card__foot">' +
      '<span class="set-hint" style="margin-right:auto">As preferências são salvas automaticamente neste dispositivo.</span>' +
      '<button type="button" class="set-btn set-btn--soft set-btn--sm" data-set="sound">' +
      ico("headset", 16) + " Testar som</button>" +
      "</div></section>" +
      '<section class="set-card">' +
      headBlock("Silenciar rapidamente", "Precisa focar? Desligue tudo e reative quando voltar.") +
      '<div class="set-card__foot" style="border-top:0;padding-top:0;margin-top:4px">' +
      '<button type="button" class="set-btn set-btn--ghost set-btn--sm" data-set="mute-all">Desativar todas</button>' +
      '<button type="button" class="set-btn set-btn--primary set-btn--sm" data-set="unmute-all">Ativar todas</button>' +
      "</div></section>";

    const ROW_OF = {
      "notif-messages": "messages",
      "notif-mentions": "mentions",
      "notif-sounds": "sounds",
    };
    const target = ROW_OF[focusKey] || null;

    return {
      html: html,
      wire: function (host) {
        host.addEventListener("change", (e) => {
          const input = e.target;
          if (!input || !input.getAttribute) return;
          const key = input.getAttribute("data-pref");
          if (!key) return;
          savePref(key, input.checked);
        });
        if (target) {
          const row = host.querySelector('[data-row="' + target + '"]');
          if (row) row.classList.add("is-focus");
        }
      },
    };
  };

  /* ---------- 6. Privacidade ---------- */
  PANELS.privacy = function (focusKey) {
    const p = privacy();
    const list = blocks();

    const dmsOptions = [
      ["all", "Todos"],
      ["friends", "Só amigos"],
      ["none", "Ninguém"],
    ]
      .map(
        (o) =>
          '<option value="' + o[0] + '"' + (p.dms === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"
      )
      .join("");

    const inviteOptions = [
      ["everyone", "De qualquer um"],
      ["friends", "Só de amigos"],
    ]
      .map(
        (o) =>
          '<option value="' + o[0] + '"' + (p.invites === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"
      )
      .join("");

    const blockList = list.length
      ? '<div class="set-list" style="margin-top:12px">' +
        list
          .map(
            (b) =>
              '<div class="set-item"><span class="set-item__ico">' + ico("user", 18) + "</span>" +
              '<span class="set-item__txt"><strong>@' + esc(b.name) + "</strong>" +
              "<small>Bloqueado " + esc(timeAgo(b.at) || "recentemente") + "</small></span>" +
              '<button type="button" class="set-btn set-btn--danger-soft set-btn--sm" data-set="unblock" data-id="' +
              esc(b.id) + '">Desbloquear</button></div>'
          )
          .join("") +
        "</div>"
      : '<div style="margin-top:12px">' +
        emptyBlock("shield", "Ninguém bloqueado", "Quem você bloquear não poderá te escrever nem te ver nas listas de membros.") +
        "</div>";

    const html =
      '<section class="set-card" data-focus-card="privacy-dms">' +
      headBlock("Quem pode falar com você", "Controle quem inicia conversas e quem te chama para comunidades.") +
      '<div class="set-row"><span class="set-row__txt"><strong>Mensagens privadas</strong>' +
      "<small>Quem pode abrir uma conversa direta com você.</small></span>" +
      '<select class="set-select" data-privacy="dms" style="width:auto;min-width:150px">' + dmsOptions + "</select></div>" +
      '<div class="set-row" data-focus-card="privacy-invites"><span class="set-row__txt"><strong>Convites</strong>' +
      "<small>Quem pode te convidar para servidores.</small></span>" +
      '<select class="set-select" data-privacy="invites" style="width:auto;min-width:170px">' + inviteOptions + "</select></div>" +
      '<div class="set-card__foot"><span class="set-hint" style="margin-right:auto">Salvo automaticamente.</span></div>' +
      "</section>" +
      '<section class="set-card" data-focus-card="privacy-blocks">' +
      headBlock("Bloqueios", "Pessoas bloqueadas não conseguem te escrever nem aparecer nas suas listas.") +
      blockList +
      '<form data-form="block" novalidate><div class="set-inline">' +
      '<input class="set-input" name="name" maxlength="24" placeholder="nome de usuário" autocomplete="off" />' +
      '<button type="submit" class="set-btn set-btn--danger-soft">Bloquear</button></div>' +
      errorBlock() +
      "</form></section>";

    return {
      html: html,
      wire: function (host) {
        host.addEventListener("change", (e) => {
          const sel = e.target;
          if (!sel || !sel.getAttribute) return;
          const key = sel.getAttribute("data-privacy");
          if (!key) return;
          savePrivacy({ [key]: sel.value });
        });

        const form = host.querySelector('[data-form="block"]');
        if (form) {
          form.addEventListener("submit", (e) => {
            e.preventDefault();
            const err = form.querySelector("[data-error]");
            showErr(err, "");
            const raw = String(formData(form).name || "").trim().replace(/^@/, "");
            if (raw.length < 2) {
              showErr(err, "Digite um nome de usuário com pelo menos 2 caracteres.");
              return;
            }
            const current = blocks();
            const exists = current.some((b) => b.name.toLowerCase() === raw.toLowerCase());
            if (exists) {
              showErr(err, "Esse usuário já está bloqueado.");
              return;
            }
            current.push({ id: uid("bl"), name: raw.slice(0, 24), at: Date.now() });
            saveBlocks(current);
            toast("@" + raw + " foi bloqueado.", "success");
            refresh();
          });
        }
      },
    };
  };

  /* ---------- 7. Segurança ---------- */
  PANELS.security = function (focusKey) {
    const list = sessions();
    const p = platformInfo();

    const sessionRows = list.length
      ? '<div class="set-list">' +
        list
          .map(
            (s) =>
              '<div class="set-item"><span class="set-item__ico' + (s.current ? " is-live" : "") + '">' +
              ico(s.current ? "enter" : "clock", 18) + "</span>" +
              '<span class="set-item__txt"><strong>' + esc(s.name) + "</strong>" +
              "<small>" + esc(s.os || "") + (s.current ? " · ativo agora" : " · última atividade " + esc(timeAgo(s.last))) +
              "</small></span>" +
              (s.current ? '<span class="set-badge">Agora</span>' : "") +
              '<button type="button" class="set-btn set-btn--danger-soft set-btn--sm" data-set="end-session" data-id="' +
              esc(s.id) + '">Encerrar sessão</button></div>'
          )
          .join("") +
        "</div>"
      : emptyBlock("lock", "Nenhuma outra sessão", "Quando você entrar em outro dispositivo, ele aparece aqui.");

    const deviceRows = list.length
      ? '<div class="set-list">' +
        list
          .map(
            (s) =>
              '<div class="set-item"><span class="set-item__ico' + (s.current ? " is-live" : "") + '">' +
              ico("grid", 18) + "</span>" +
              '<span class="set-item__txt"><strong>' + esc(s.name) + "</strong><small>" + esc(s.os || "—") + "</small></span>" +
              (s.current
                ? '<span class="set-badge">Este aparelho</span>'
                : '<span class="set-badge set-badge--muted">' + esc(timeAgo(s.last) || "inativo") + "</span>") +
              "</div>"
          )
          .join("") +
        "</div>"
      : emptyBlock("grid", "Só este dispositivo", "Nenhum outro aparelho conectado à sua conta.");

    const html =
      '<section class="set-card" data-focus-card="security-sessions">' +
      headBlock("Sessões", "Cada entrada na conta vira uma sessão. Encerre a que você não reconhecer.") +
      sessionRows +
      "</section>" +
      '<section class="set-card" data-focus-card="security-devices">' +
      headBlock("Dispositivos", "Resumo dos aparelhos com acesso à sua conta.") +
      '<div class="set-stats">' +
      '<div class="set-stat"><span>Dispositivos</span><strong>' + list.length + "</strong>" +
      "<small>com acesso agora</small></div>" +
      '<div class="set-stat"><span>Este aparelho</span><strong>' + esc(p) + "</strong><small>navegador atual</small></div>" +
      '<div class="set-stat"><span>Sessão atual</span><strong>' +
      esc((list.find((s) => s.current) || {}).name || "Este navegador") + "</strong><small>ativa agora</small></div>" +
      "</div>" +
      deviceRows +
      '<div style="margin-top:14px">' +
      noteBlock("Desconfiou de algo? Encerre a sessão suspeita e troque sua senha em Segurança → Sessões.", null) +
      "</div></section>";

    const target =
      focusKey === "security-devices"
        ? "security-devices"
        : focusKey === "security-sessions"
          ? "security-sessions"
          : null;

    return {
      html: html,
      wire: function (host) {
        if (target) {
          const el = host.querySelector('[data-focus-card="' + target + '"]');
          if (el) el.classList.add("is-focus");
        }
      },
    };
  };

  /* ---------- 8. Sair ---------- */
  PANELS.logout = function () {
    const m = me();
    const html =
      '<section class="set-card set-card--danger" data-focus-card="logout">' +
      headBlock("Sair da conta", "Você precisará entrar de novo para voltar a conversar nos seus servidores.") +
      (m
        ? '<div class="set-avatar" style="margin-bottom:0">' +
          '<span class="set-avatar__img" style="--av:' + esc((m.avatar && m.avatar.color) || "#35e0a8") + '">' +
          "<span>" + esc((m.avatar && m.avatar.emoji) || (m.displayName || "?").slice(0, 1)) + "</span></span>" +
          '<div class="set-avatar__meta"><strong>' + esc(m.displayName || m.username) + "</strong>" +
          "<span>@" + esc(m.username) + "</span></div></div>"
        : "") +
      '<div class="set-card__foot">' +
      '<button type="button" class="set-btn set-btn--ghost" data-set="close">Cancelar</button>' +
      '<button type="button" class="set-btn set-btn--danger set-btn--lg" data-set="logout">' +
      ico("logout", 18) + " Sair da conta</button>" +
      "</div></section>";
    return { html: html };
  };

  /* =========================================================
     ESTRUTURA DA TELA
     ========================================================= */
  function navItemHTML(item) {
    return (
      '<button type="button" class="set-nav__item' + (item.danger ? " is-danger" : "") +
      '" data-set="section" data-id="' + item.id + '" data-nav-id="' + item.id + '">' +
      ico(item.icon, 17) + "<span>" + esc(item.label) + "</span></button>"
    );
  }

  function navHTML() {
    let html = "";
    GROUPS.forEach((g) => {
      html +=
        '<div class="set-nav__group"><div class="set-nav__title">' + esc(g.title) + "</div>" +
        '<div class="set-nav__list">' + g.items.map(navItemHTML).join("") + "</div></div>";
    });
    html +=
      '<div class="set-nav__group set-nav__sep"><div class="set-nav__list">' +
      navItemHTML(SIGNOUT_ITEM) +
      "</div></div>";
    return html;
  }

  const SHELL_HTML =
    '<div class="set-shell">' +
    '<header class="set-head"><div class="set-head__inner">' +
    '<div class="set-head__txt"><span class="set-eyebrow">Preferências</span>' +
    '<h1 class="set-title">Configurações</h1></div>' +
    '<span class="set-head__who" data-who hidden></span>' +
    '<button type="button" class="set-close" data-set="close" title="Fechar (Esc)" aria-label="Fechar configurações">' +
    ico("x", 20) +
    "</button></div></header>" +
    '<div class="set-body">' +
    '<nav class="set-nav" aria-label="Seções de configuração" data-nav>' + navHTML() + "</nav>" +
    '<main class="set-content" data-content tabindex="-1"></main>' +
    "</div></div>";

  /* =========================================================
     ESTADO / RENDER
     ========================================================= */
  const settings = {};
  settings.section = "account";
  settings.sections = SECTION_IDS.slice();
  settings.root = null;

  function resolveSection(id) {
    const raw = String(id == null ? "" : id).trim();
    if (!raw) return settings.section || "account";
    if (SECTION_PANEL[raw]) return raw;
    const lower = raw.toLowerCase();
    if (SECTION_PANEL[lower]) return lower;
    if (ALIASES[lower]) return ALIASES[lower];
    if (PANELS[raw]) return raw;
    return settings.section && SECTION_PANEL[settings.section] ? settings.section : "account";
  }

  function updateNav(root, key) {
    const nav = root.querySelector("[data-nav]");
    if (!nav) return;
    Array.prototype.forEach.call(nav.querySelectorAll("[data-nav-id]"), (btn) => {
      btn.classList.toggle("is-on", btn.getAttribute("data-nav-id") === key);
    });
  }

  function updateIdentity(root) {
    const el = root.querySelector("[data-who]");
    if (!el) return;
    const m = me();
    if (!m) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML =
      (NX.util && NX.util.avatarHTML ? NX.util.avatarHTML(m, "xs", true) : "") +
      "<span>" + esc(m.displayName || m.username) + "</span>";
  }

  settings.go = function (id) {
    const root = settings.root;
    if (!root) return;
    const key = resolveSection(id);
    settings.section = key;

    if (THEME_SECTIONS[key]) applyThemeMode(THEME_SECTIONS[key]);

    const host = root.querySelector("[data-content]");
    if (!host) return;

    const panelKey = SECTION_PANEL[key] || (PANELS[key] ? key : "account");
    let built;
    try {
      built = (PANELS[panelKey] || PANELS.account)(key);
    } catch (e) {
      console.error("[settings:painel]", panelKey, e);
      built = { html: '<section class="set-card">' + headBlock("Ops", "Não foi possível carregar esta seção.") + "</section>" };
    }

    const inner = document.createElement("div");
    inner.className = "set-content__inner";
    inner.innerHTML = built.html;
    host.innerHTML = "";
    host.appendChild(inner);

    if (built.wire) {
      try {
        built.wire(inner);
      } catch (e) {
        console.error("[settings:wire]", panelKey, e);
      }
    }

    /* pulso na seção de origem (quando houver alvo específico) */
    const targets = [];
    if (key === "theme-dark" || key === "theme-light" || key === "theme-auto") targets.push("theme");
    else if (key === "ui-size") targets.push("ui-size");
    else if (key.indexOf("privacy-") === 0) targets.push(key);
    else if (key.indexOf("security-") === 0) targets.push(key);
    else if (key === "logout") targets.push("logout");

    targets.forEach((t) => {
      const el = findFocus(inner, t);
      if (el) el.classList.add("is-focus");
    });

    updateNav(root, key);
    updateIdentity(root);
    try {
      root.scrollTop = 0;
    } catch (e) {
      /* sem scroll */
    }
  };

  function findFocus(host, name) {
    const all = host.querySelectorAll("[data-focus-card]");
    for (let i = 0; i < all.length; i++) {
      if (all[i].getAttribute("data-focus-card") === name) return all[i];
    }
    return null;
  }

  function refresh() {
    if (settings.root) settings.go(settings.section);
  }

  function closeScreen() {
    const root = settings.root || document.getElementById("screen-settings");
    if (root) root.hidden = true;
    try {
      if (NX.bus && NX.bus.emit) NX.bus.emit("settings:close");
    } catch (e) {
      /* sem bus */
    }
  }

  /* Fecha a tela respeitando o host: se o app registrou "set-close"
     (app.closeSettings), usa-o; se depois ainda estiver aberta, volta
     para a rota anterior (ou para o início) para não deixar tela em branco. */
  function closeSettings() {
    const mine = handlers["set-close"];
    const host = NX.actions && NX.actions["set-close"];
    if (typeof host === "function" && host !== mine) {
      try {
        host(null, null);
      } catch (e) {
        /* host indisponível: segue para o fechamento local */
      }
    }
    const root = settings.root || document.getElementById("screen-settings");
    if (root && root.hidden) return;
    /* nunca volta para uma rota de configurações: isso reabriria a tela */
    const hash = location.hash || "";
    const back = hash.indexOf("#/config") === 0 ? "#/" : hash || "#/";
    const app = NX.app;
    if (app && typeof app.go === "function") {
      try {
        app.go(back);
        if (root && root.hidden) return;
      } catch (e) {
        /* rota indisponível */
      }
    }
    closeScreen();
  }

  function doLogout() {
    const ui = NX.ui || {};
    const finish = () => {
      NX.api
        .logout()
        .then(() => {
          toast("Você saiu da conta.", "success");
          closeScreen();
        })
        .catch((e) => {
          toast((e && e.message) || "Não foi possível sair agora.", "error");
        });
    };

    if (typeof ui.confirm !== "function") {
      finish();
      return;
    }
    ui
      .confirm({
        title: "Sair da conta",
        message: "Você precisará entrar de novo para voltar a conversar.",
        confirmLabel: "Sair",
        danger: true,
        icon: "logout",
      })
      .then((ok) => {
        if (ok) finish();
      });
  }

  /* =========================================================
     AÇÕES (sempre com prefixo set-)
     ========================================================= */
  const handlers = {
    "set-section": (el) => settings.go(el.getAttribute("data-id")),
    "set-close": () => closeSettings(),
    "set-logout": () => doLogout(),
    "set-theme": (el) => {
      const mode = applyThemeMode(el.getAttribute("data-mode"));
      const root = settings.root;
      if (root) {
        const content = root.querySelector("[data-content]");
        if (content) markThemes(content, mode);
      }
    },
    "set-scale": (el) => {
      const value = applyScale(el.getAttribute("data-scale"));
      const root = settings.root;
      if (root) {
        const content = root.querySelector("[data-content]");
        if (content) markScales(content, value);
      }
    },
    "set-sound": () => beep(),
    "set-mute-all": () => {
      setPrefsAll(false);
      refresh();
      toast("Notificações desativadas neste dispositivo.", "info");
    },
    "set-unmute-all": () => {
      setPrefsAll(true);
      refresh();
      toast("Notificações ativadas.", "success");
    },
    "set-reset-profile": () => refresh(),
    "set-toggle-pass": (el) => {
      const root = settings.root || document;
      const scope = el.closest("form") || root;
      const input = scope && scope.querySelector('[name="' + el.getAttribute("data-target") + '"]');
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      el.innerHTML = ico(show ? "eyeOff" : "eye", 18);
      el.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
    },
    "set-unblock": (el) => {
      const id = el.getAttribute("data-id");
      const list = blocks().filter((b) => b.id !== id);
      saveBlocks(list);
      toast("Usuário desbloqueado.", "info");
      refresh();
    },
    "set-end-session": (el) => {
      const id = el.getAttribute("data-id");
      const list = sessions().filter((s) => s.id !== id);
      saveSessions(list);
      toast("Sessão encerrada.", "success");
      refresh();
    },
    "set-save-profile": () => submitForm("profile"),
    "set-save-email": () => submitForm("email"),
    "set-save-password": () => submitForm("password"),
  };

  function setPrefsAll(value) {
    set(K.prefs, { messages: !!value, mentions: !!value, sounds: !!value });
  }

  function submitForm(name) {
    const root = settings.root;
    if (!root) return;
    const form = root.querySelector('[data-form="' + name + '"]');
    if (!form) return;
    if (form.requestSubmit) form.requestSubmit();
    else form.dispatchEvent(new Event("submit", { cancelable: true }));
  }

  Object.keys(handlers).forEach((name) => {
    try {
      NX.action(name, handlers[name]);
    } catch (e) {
      /* NX.action indisponível: a tela continua funcionando pelos listeners */
    }
  });

  /* =========================================================
     BIND DA TELA
     ========================================================= */
  /* resolve a ação priorizando o registro global (NX.actions), para que
     o host possa sobrescrever comportamentos (ex.: set-close → app.closeSettings) */
  function resolveAction(name) {
    const reg = NX.actions && typeof NX.actions[name] === "function" ? NX.actions[name] : null;
    return reg || (typeof handlers[name] === "function" ? handlers[name] : null);
  }

  function bindShell(root) {
    root.addEventListener("click", (e) => {
      const target = e.target;
      const el = target && target.closest ? target.closest("[data-set]") : null;
      if (!el || !root.contains(el)) return;
      const name = "set-" + el.getAttribute("data-set");
      /* o fechamento tem lógica própria (host + fallback de rota) */
      const fn = name === "set-close" ? closeSettings : resolveAction(name);
      if (typeof fn !== "function") return;
      if (el.tagName === "A") e.preventDefault();
      fn(el, e);
    });
  }

  function bindGlobal() {
    if (NX.__setKeysBound) return;
    NX.__setKeysBound = true;
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const root = settings.root;
      if (!root || root.hidden || !root.isConnected) return;
      if (NX.ui && NX.ui.isOpen && NX.ui.isOpen()) return;
      closeSettings();
    });
  }

  settings.render = function (root, section) {
    if (!root) return settings;
    settings.root = root;
    let shell = root.querySelector(".set-shell");
    if (!shell) {
      root.innerHTML = SHELL_HTML;
      shell = root.querySelector(".set-shell");
      if (shell) bindShell(root);
    }
    bindGlobal();
    settings.go(section || settings.section || "account");
    return settings;
  };

  NX.settings = settings;

  /* ---------------- aplicação inicial ---------------- */
  try {
    applyThemeMode(themeMode());
    applyScale(uiScale());
    watchSystemTheme();
  } catch (e) {
    console.warn("[settings:boot]", e);
  }
})(window.NX);
