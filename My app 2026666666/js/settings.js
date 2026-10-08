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
    prefs: "nexo.prefs",         // { messages, mentions, sounds: {...} } (sounds: objeto do NX.sfx)
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
  const SCALE_LABEL = { sm: (NX.i18n.get("set.pequeno", "Pequeno")), md: (NX.i18n.get("people.padrao", "Padrão")), lg: (NX.i18n.get("set.grande", "Grande")) };

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
  /* `sounds` era um booleano e agora é o objeto do NX.sfx.
     O booleano continua sendo aceito aqui (migração de leitura) e é
     normalizado antes de qualquer gravação. */
  const PREF_DEFAULTS = { messages: true, mentions: true, sounds: true };

  function prefs() {
    const saved = get(K.prefs, null);
    const p = Object.assign({}, PREF_DEFAULTS, saved && typeof saved === "object" ? saved : {});
    p.sounds = normalizeSounds(p.sounds);
    return p;
  }

  function savePref(key, value) {
    const p = prefs();
    /* sons nunca são gravados "cruos": passam pela normalização do NX.sfx */
    if (key === "sounds") p.sounds = normalizeSounds(value);
    else p[key] = !!value;
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
      { id: "sess-this", name: NX.i18n.get("set.esteNavegador2", "Este navegador"), current: true, last: now, os: platformInfo() },
      { id: "sess-other", name: NX.i18n.get("set.outroDispositivo", "Outro dispositivo"), current: false, last: now - 2 * 86400000, os: NX.i18n.get("set.androidChrome", "Android · Chrome") },
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
      let os = NX.i18n.get("set.sistemaDesconhecido2", "Sistema desconhecido");
      if (/Windows/i.test(ua)) os = (NX.i18n.get("set.windows", "Windows"));
      else if (/Android/i.test(ua)) os = (NX.i18n.get("set.android", "Android"));
      else if (/iPhone|iPad|iPod|iOS/i.test(ua)) os = "iOS";
      else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
      else if (/Linux/i.test(ua)) os = (NX.i18n.get("set.linux", "Linux"));

      let br = (NX.i18n.get("set.navegador", "Navegador"));
      if (/Edg\//.test(ua)) br = (NX.i18n.get("set.edge", "Edge"));
      else if (/OPR\/|Opera/.test(ua)) br = (NX.i18n.get("set.opera", "Opera"));
      else if (/Firefox\//.test(ua)) br = (NX.i18n.get("set.firefox", "Firefox"));
      else if (/Chrome\//.test(ua)) br = (NX.i18n.get("set.chrome", "Chrome"));
      else if (/Safari\//.test(ua)) br = (NX.i18n.get("set.safari", "Safari"));

      return os + " · " + br;
    } catch (e) {
      return NX.i18n.get("set.sistemaDesconhecido2", "Sistema desconhecido");
    }
  }

  /* =========================================================
     SOM · preferências gravadas por NX.sfx (js/sounds.js)
     Este bloco só lê e monta a interface: o escritor único
     das preferências de som é o próprio NX.sfx.
     ========================================================= */
  const SOUND_CATS = [
    { key: "messages", tk: "nav.messages", fb: "Mensagens" },
    { key: "notifications", tk: "nav.notifications", fb: "Notificações" },
    { key: "calls", tk: "set.sndCatCalls", fb: "Chamadas" },
    { key: "invites", tk: "set.item.privacyInvites", fb: "Convites" },
    { key: "interface", tk: "set.sndCatInterface", fb: "Interface" },
  ];

  /* espelho defensivo de normalize() do NX.sfx: usado apenas como
     fallback de leitura caso js/sounds.js não tenha sido carregado */
  function normalizeSounds(value) {
    const out = {
      on: true,
      volume: 0.7,
      muted: false,
      categories: { messages: true, notifications: true, calls: true, invites: true, interface: true },
    };
    if (typeof value === "boolean") {
      out.on = value !== false;
      return out;
    }
    if (!value || typeof value !== "object") return out;
    if (value.on === false) out.on = false;
    if (value.muted === true) out.muted = true;
    if (value.volume != null) {
      const n = Number(value.volume);
      out.volume = isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.7;
    }
    const cats = value.categories;
    if (cats && typeof cats === "object") {
      Object.keys(out.categories).forEach((k) => {
        out.categories[k] = cats[k] !== false;
      });
    }
    return out;
  }

  function soundPrefs() {
    try {
      if (NX.sfx && typeof NX.sfx.prefs === "function") return NX.sfx.prefs();
    } catch (e) {
      /* NX.sfx indisponível: cai na leitura local */
    }
    return normalizeSounds(prefs().sounds);
  }

  /* gravação de contingência (sem NX.sfx): preserva messages/mentions */
  function writeSounds(patch) {
    const p = prefs();
    const merged = Object.assign({}, p.sounds, patch);
    if (patch && patch.categories) merged.categories = Object.assign({}, p.sounds.categories, patch.categories);
    p.sounds = normalizeSounds(merged);
    set(K.prefs, p);
    return p.sounds;
  }

  function sfxEnabled(value) {
    try {
      if (NX.sfx && typeof NX.sfx.setEnabled === "function") {
        NX.sfx.setEnabled(!!value);
        return;
      }
    } catch (e) {
      /* fallback abaixo */
    }
    writeSounds({ on: !!value });
  }

  function sfxVolume(value) {
    try {
      if (NX.sfx && typeof NX.sfx.setVolume === "function") {
        NX.sfx.setVolume(value);
        return;
      }
    } catch (e) {
      /* fallback abaixo */
    }
    writeSounds({ volume: value });
  }

  function sfxSilent(value) {
    try {
      if (NX.sfx && typeof NX.sfx.setSilent === "function") {
        NX.sfx.setSilent(!!value);
        return;
      }
    } catch (e) {
      /* fallback abaixo */
    }
    writeSounds({ muted: !!value });
  }

  function sfxCategory(cat, value) {
    try {
      if (NX.sfx && typeof NX.sfx.setCategory === "function") {
        NX.sfx.setCategory(cat, !!value);
        return;
      }
    } catch (e) {
      /* fallback abaixo */
    }
    const patch = { categories: {} };
    patch.categories[cat] = !!value;
    writeSounds(patch);
  }

  function playTestSound() {
    try {
      if (NX.sfx && typeof NX.sfx.play === "function") {
        NX.sfx.play("notification");
        return true; /* motor disponível (pode estar silenciado de propósito) */
      }
    } catch (e) {
      /* sem motor de som: avisa abaixo */
    }
    return false;
  }

  /* =========================================================
     NAVEGAÇÃO (grupos do menu)
     ========================================================= */
  const GROUPS = [
    {
      title: NX.i18n.get("set.group.account", "MINHA CONTA"),
      tk: "set.group.account",
      items: [
        { id: "account", label: (NX.i18n.get("set.item.profile", "Perfil")), icon: "user", tk: "set.item.profile" },
        { id: "password", label: (NX.i18n.get("set.item.password", "Senha")), icon: "lock", tk: "set.item.password" },
      ],
    },
    {
      title: (NX.i18n.get("set.group.appearance", "APARÊNCIA")),
      tk: "set.group.appearance",
      items: [
        { id: "theme-dark", label: NX.i18n.get("set.item.themeDark", "Tema escuro"), icon: "sparkles", tk: "set.item.themeDark" },
        { id: "theme-light", label: NX.i18n.get("set.item.themeLight", "Tema claro"), icon: "sparkle", tk: "set.item.themeLight" },
        { id: "theme-auto", label: NX.i18n.get("set.item.themeAuto", "Tema automático"), icon: "refresh", tk: "set.item.themeAuto" },
        { id: "ui-size", label: NX.i18n.get("set.item.uiSize", "Tamanho da interface"), icon: "menu", tk: "set.item.uiSize" },
      ],
    },
    {
      title: (NX.i18n.get("set.group.notifications", "NOTIFICAÇÕES")),
      tk: "set.group.notifications",
      items: [
        { id: "notif-messages", label: (NX.i18n.get("nav.messages", "Mensagens")), icon: "chat", tk: "set.item.notifMessages" },
        { id: "notif-mentions", label: (NX.i18n.get("set.item.notifMentions", "Menções")), icon: "bell", tk: "set.item.notifMentions" },
        { id: "notif-sounds", label: (NX.i18n.get("set.item.notifSounds", "Sons")), icon: "headset", tk: "set.item.notifSounds" },
      ],
    },
    {
      title: (NX.i18n.get("set.group.privacy", "PRIVACIDADE")),
      tk: "set.group.privacy",
      items: [
        { id: "privacy-social", label: NX.i18n.get("set.item.privacySocial", "Quem pode interagir"), icon: "userPlus", tk: "set.item.privacySocial" },
        { id: "privacy-dms", label: NX.i18n.get("set.item.privacyDms", "Mensagens privadas"), icon: "lock", tk: "set.item.privacyDms" },
        { id: "privacy-invites", label: (NX.i18n.get("set.item.privacyInvites", "Convites")), icon: "link", tk: "set.item.privacyInvites" },
        { id: "privacy-blocks", label: (NX.i18n.get("set.item.privacyBlocks", "Bloqueios")), icon: "alert", tk: "set.item.privacyBlocks" },
      ],
    },
    {
      title: (NX.i18n.get("set.group.security", "SEGURANÇA")),
      tk: "set.group.security",
      items: [
        { id: "security-sessions", label: (NX.i18n.get("set.item.securitySessions", "Sessões")), icon: "clock", tk: "set.item.securitySessions" },
        { id: "security-devices", label: (NX.i18n.get("set.item.securityDevices", "Dispositivos")), icon: "grid", tk: "set.item.securityDevices" },
      ],
    },
  ];

  const SIGNOUT_ITEM = { id: "logout", label: (NX.i18n.get("set.item.logout", "Sair")), icon: "logout", danger: true, tk: "set.item.logout" };

  const SECTION_IDS = GROUPS.reduce((acc, g) => acc.concat(g.items.map((i) => i.id)), []).concat(["logout"]);

  /* seção -> painel */
  const SECTION_PANEL = {
    account: "account",
    password: "password",
    "theme-dark": "appearance",
    "theme-light": "appearance",
    "theme-auto": "appearance",
    "ui-size": "appearance",
    "notif-messages": "notifications",
    "notif-mentions": "notifications",
    "notif-sounds": "notifications",
    "privacy-social": "privacySocial",
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
    interacoes: "privacy-social",
    visibilidade: "privacy-social",
    social: "privacy-social",
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
    const labels = NX.STATUS_LABEL || { online: NX.i18n.get("core.statusOnline", "Online"), idle: (NX.i18n.get("core.ausente", "Ausente")), dnd: NX.i18n.get("core.naoPerturbe", "Não perturbe"), offline: NX.i18n.get("core.statusOffline", "Offline") };
    return Object.keys(labels)
      .map(
        (k) =>
          '<option value="' + k + '"' + (k === current ? " selected" : "") + ">" + esc(labels[k]) + "</option>"
      )
      .join("");
  }

  function needAccount(text) {
    return '<section class="set-card">' + headBlock(NX.i18n.get("modal.suaConta", "Sua conta"), text) +
      ("<div class=\"set-card__foot\"><button type=\"button\" class=\"set-btn set-btn--primary\" data-set=\"close\">" + NX.i18n.get("common.close", "Fechar") + "</button></div></section>");
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
    if (!m) return { html: needAccount(NX.i18n.get("set.entreSuaContaEditar", "Entre na sua conta para editar seu perfil.")) };

    const avatar = m.avatar || {};
    const emoji = avatar.emoji || (NX.util && NX.util.emojiFor ? NX.util.emojiFor(m.username) : "🌙");
    const color = avatar.color || (NX.util && NX.util.colorFor ? NX.util.colorFor(m.id) : "#35e0a8");
    const bio = m.bio || "";

    const html =
      '<section class="set-card">' +
      headBlock(NX.i18n.get("set.seuPerfil", "Seu perfil"), NX.i18n.get("set.comoVoceApareceComunidades", "Como você aparece nas comunidades e nas conversas.")) +
      '<div class="set-avatar">' +
      '<span class="set-avatar__img" data-av style="--av:' + esc(color) + '">' +
      '<span data-av-glyph>' + esc(emoji) + "</span>" +
      '<i class="set-avatar__dot" data-av-dot data-status="' + esc(m.status || "offline") + '"></i></span>' +
      '<div class="set-avatar__meta"><strong data-live>' + esc(m.displayName || m.username) + "</strong>" +
      "<span>@" + esc(m.username) + (m.createdAt ? (" " + NX.i18n.get("set.nonexodesde", "· no Nexo desde") + " ") + NX.util.formatDate(m.createdAt) : "") + "</span></div>" +
      "</div>" +
      '<form data-form="profile" novalidate>' +
      fieldBlock(NX.i18n.get("set.emojiAvatar", "Emoji do avatar"), emojiGrid(emoji)) +
      fieldBlock(NX.i18n.get("set.corAvatar", "Cor do avatar"), swatches(color)) +
      fieldBlock(
        NX.i18n.get("set.nomeExibicao", "Nome de exibição"),
        '<input class="set-input" name="displayName" maxlength="32" autocomplete="display-name" value="' +
          esc(m.displayName || "") + '" />'
      ) +
      fieldBlock(
        NX.i18n.get("set.nomeUsuario", "Nome de usuário"),
        '<input class="set-input" name="username" maxlength="18" autocomplete="username" value="' +
          esc(m.username || "") + '" />',
        NX.i18n.get("set.318CaracteresLetras", "De 3 a 18 caracteres: letras, números, ponto e _.")
      ) +
      fieldBlock(
        (NX.i18n.get("modal.bio", "Bio")),
        '<textarea class="set-textarea" name="bio" rows="3" maxlength="190" placeholder="' + NX.i18n.get("ui.conteemumalinhaquemevoce", "Conte em uma linha quem é você") + '">' +
          esc(bio) + "</textarea>",
        '<span data-count>' + String(bio).length + "</span>/190 caracteres"
      ) +
      '<div class="set-grid-2">' +
      fieldBlock(
        (NX.i18n.get("modal.status", "Status")),
        '<select class="set-select" name="status">' + statusOptions(m.status || "online") + "</select>"
      ) +
      fieldBlock(
        NX.i18n.get("set.statusPersonalizado", "Status personalizado"),
        '<input class="set-input" name="statusText" maxlength="60" placeholder="' + NX.i18n.get("ui.settings.exestudando", "ex.: estudando") + '" value="' +
          esc(m.statusText || "") + '" />'
      ) +
      "</div>" +
      errorBlock() +
      '<div class="set-card__foot">' +
      ("<button type=\"button\" class=\"set-btn set-btn--ghost\" data-set=\"reset-profile\">" + NX.i18n.get("set.descartar", "Descartar") + "</button>") +
      ("<button type=\"submit\" class=\"set-btn set-btn--primary\" data-busy-label=\"Salvando\">" + NX.i18n.get("adm.salvarAlteracoes", "Salvar alterações") + "</button>") +
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
      showErr(err, NX.i18n.get("api.digiteNomePeloMenos", "Digite um nome com pelo menos 2 caracteres."));
      return;
    }
    if (NX.util && NX.util.usernameOk && !NX.util.usernameOk(username)) {
      showErr(err, NX.i18n.get("set.nomeUsuarioPrecisa3", "Nome de usuário precisa de 3 a 18 caracteres (letras, números, ponto e _)."));
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
        toast(NX.i18n.get("modal.perfilAtualizado", "Perfil atualizado."), "success");
        refresh();
      })
      .catch((e) => {
        const msg = (e && e.message) || NX.i18n.get("reg.invalid", "Não foi possível salvar agora. Tente de novo.");
        showErr(err, msg);
        toast(msg, "error");
      })
      .then(done, done);
  }

  /* ---------- 2. Senha ---------- */
  PANELS.password = function () {
    const m = me();
    if (!m) return { html: needAccount(NX.i18n.get("set.entreSuaContaAlterar", "Entre na sua conta para alterar sua senha.")) };

    const passField = (name, label, placeholder) =>
      fieldBlock(
        label,
        '<span class="set-pass">' +
          '<input class="set-input" type="password" name="' + name + '" maxlength="64" autocomplete="new-password" placeholder="' +
          esc(placeholder) + '" />' +
          '<button type="button" class="set-pass__eye" data-set="toggle-pass" data-target="' + name +
          '" aria-label="' + NX.i18n.get("set.mostrarSenha", "Mostrar senha") + '">' + ico("eye", 18) + "</button></span>"
      );

    const html =
      '<section class="set-card">' +
      headBlock(NX.i18n.get("set.alterarSenha", "Alterar senha"), NX.i18n.get("set.escolhaSenhaPeloMenos", "Escolha uma senha com pelo menos 6 caracteres e confirme abaixo.")) +
      '<form data-form="password" novalidate>' +
      passField("password", NX.i18n.get("set.novaSenha", "Nova senha"), NX.i18n.get("set.minimo6Caracteres", "Mínimo de 6 caracteres")) +
      passField("confirm", NX.i18n.get("set.confirmarNovaSenha", "Confirmar nova senha"), NX.i18n.get("set.digiteMesmaSenhaNovo", "Digite a mesma senha de novo")) +
      errorBlock() +
      '<div class="set-card__foot">' +
      ("<button type=\"submit\" class=\"set-btn set-btn--primary\" data-busy-label=\"Verificando\">" + NX.i18n.get("set.atualizarsenha", "Atualizar senha") + "</button>") +
      "</div></form>" +
      "</section>";

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
            showErr(err, NX.i18n.get("set.senhaPrecisaTerMenos", "A senha precisa ter no menos 6 caracteres."));
            return;
          }
          if (pw !== confirm) {
            showErr(err, NX.i18n.get("set.senhasNaoConferemDigite", "As senhas não conferem. Digite a mesma senha nos dois campos."));
            return;
          }
          form.reset();
          toast(NX.i18n.get("set.senhaAlteradaProducaoEsta", "Senha alterada! Em produção esta troca é gravada pelo backend."), "success");
        });
      },
    };
  };

  /* ---------- 4. Aparência (tema + tamanho) ---------- */
  const THEME_CARDS = [
    { key: "dark", label: (NX.i18n.get("people.escuro", "Escuro")), icon: "sparkles", desc: NX.i18n.get("set.paletaCarvaoAcentoMenta", "Paleta carvão com acento menta. Padrão do Nexo."), bg: "#0d1416", fg: "#e8f3f0", ac: "#35e0a8" },
    { key: "light", label: (NX.i18n.get("adm.claro", "Claro")), icon: "sparkle", desc: NX.i18n.get("set.nevoaClaraAmbientesMuita", "Névoa clara para ambientes com muita luz."), bg: "#fbfdfc", fg: "#12211e", ac: "#0b9e75" },
    { key: "auto", label: (NX.i18n.get("set.automatico", "Automático")), icon: "refresh", desc: NX.i18n.get("set.seguePreferenciaClaroEscuro", "Segue a preferência de claro/escuro do seu sistema."), bg: "linear-gradient(90deg,#0d1416 50%,#fbfdfc 50%)", fg: "#93a8a4", ac: "#4cc9f0" },
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
      headBlock((NX.i18n.get("people.tema", "Tema")), (NX.i18n.get("set.escolhacomoonexoapareceo", "Escolha como o Nexo aparece. O modo automático acompanha a preferência de claro/escuro do seu sistema."))) +
      '<div class="set-themes" data-themes>' + themes + "</div>" +
      "</section>" +
      '<section class="set-card" data-focus-card="ui-size">' +
      headBlock(NX.i18n.get("set.item.uiSize", "Tamanho da interface"), NX.i18n.get("set.aumenteReduzaConjuntoInterface", "Aumente ou reduza o conjunto da interface neste dispositivo.")) +
      '<div class="set-seg" data-segments>' + segs + "</div>" +
      '<div class="set-preview" data-preview style="--pv:' + SCALES[scale] + '">' +
      ("<strong>" + NX.i18n.get("set.interfacenexoaa", "Interface Nexo Aa") + "</strong><span>" + NX.i18n.get("set.amostradetextoparaconferiro", "Amostra de texto para conferir o tamanho antes de fechar.") + "</span></div>") +
      '<div style="margin-top:14px">' +
      noteBlock((NX.i18n.get("set.aescolhaficasalvanestenavegador", "A escolha fica salva neste navegador e volta assim que você abrir o Nexo de novo.")), "accent") +
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
  function updateVolumeLabel(host, pct) {
    const val = host.querySelector("[data-sfx-vol]");
    if (val) val.textContent = Math.round(Number(pct) || 0) + "%";
  }

  /* sincroniza o cartão de som com as preferências atuais
     (desliga os controles quando o som master está desligado) */
  function syncSoundCard(host) {
    const card = host.querySelector("[data-sound-card]");
    if (!card) return;
    const s = soundPrefs();
    const off = !s.on;
    card.setAttribute("data-master", off ? "off" : "on");
    Array.prototype.forEach.call(card.querySelectorAll("[data-sfx], [data-sfx-cat]"), (el) => {
      if (el.getAttribute("data-sfx") === "on") return; /* o master nunca desliga */
      try {
        el.disabled = off;
      } catch (e) {
        /* atributo somente leitura */
      }
    });
    updateVolumeLabel(host, Math.round(s.volume * 100));
  }

  function handleSoundInput(host, input) {
    const cat = input.getAttribute("data-sfx-cat");
    if (cat) {
      sfxCategory(cat, input.checked);
      const label = input.closest ? input.closest("label") : null;
      if (label) label.classList.toggle("is-on", !!input.checked);
      return true;
    }
    const key = input.getAttribute("data-sfx");
    if (!key) return false;
    if (key === "on") {
      sfxEnabled(input.checked);
      syncSoundCard(host);
      return true;
    }
    if (key === "volume") {
      const pct = Number(input.value);
      sfxVolume(isFinite(pct) ? pct / 100 : 0.7);
      updateVolumeLabel(host, pct);
      return true;
    }
    if (key === "muted") {
      sfxSilent(input.checked);
      return true;
    }
    return false;
  }

  function soundCardHTML() {
    const s = soundPrefs();
    const off = !s.on;
    const volPct = Math.round(s.volume * 100);
    const masterLabel = NX.i18n.get("set.sndMaster", "Sons ativados");
    const volLabel = NX.i18n.get("set.sndVolume", "Volume geral");

    const masterRow =
      '<label class="set-row" data-row="sounds">' +
      '<span class="set-row__txt"><strong>' + esc(masterLabel) + "</strong>" +
      "<small>" + esc(NX.i18n.get("set.sndMasterDesc", "Toca alertas sonoros nas ações do Nexo.")) + "</small></span>" +
      '<span class="set-switch"><input type="checkbox" data-sfx="on"' + (off ? "" : " checked") + " /><i></i></span></label>";

    const volumeRow =
      '<div class="set-row sfx-vol">' +
      '<span class="set-row__txt"><strong>' + esc(volLabel) + "</strong>" +
      "<small>" + esc(NX.i18n.get("set.sndVolumeDesc", "Ajuste o volume dos alertas sonoros em todo o Nexo.")) + "</small></span>" +
      '<span class="sfx-vol__ctl">' +
      '<input type="range" class="sfx-range" min="0" max="100" step="1" value="' + volPct + '" data-sfx="volume"' +
      (off ? " disabled" : "") + ' aria-label="' + esc(volLabel) + '" />' +
      '<span class="sfx-vol__val" data-sfx-vol>' + volPct + "%</span></span></div>";

    const cats =
      SOUND_CATS.map((c) => {
        const on = s.categories[c.key] !== false;
        return (
          '<label class="sfx-check' + (on ? " is-on" : "") + '">' +
          '<input type="checkbox" data-sfx-cat="' + c.key + '"' + (on ? " checked" : "") + (off ? " disabled" : "") + " />" +
          '<span class="sfx-check__box">' + ico("check", 13) + "</span>" +
          "<span>" + esc(NX.i18n.get(c.tk, c.fb)) + "</span></label>"
        );
      }).join("");

    const catsBlock =
      '<div class="sfx-cats"><span class="set-label">' +
      esc(NX.i18n.get("set.sndCats", "Categorias de som")) +
      '</span><div class="sfx-cats__grid">' + cats + "</div></div>";

    const silentRow =
      '<label class="set-row" data-row="silent">' +
      '<span class="set-row__txt"><strong>' + esc(NX.i18n.get("set.sndSilent", "Modo silencioso")) + "</strong>" +
      "<small>" + esc(NX.i18n.get("set.sndSilentDesc", "Pausa todos os alertas sonoros até você desligar.")) + "</small></span>" +
      '<span class="set-switch"><input type="checkbox" data-sfx="muted"' + (s.muted ? " checked" : "") + (off ? " disabled" : "") +
      " /><i></i></span></label>" +
      noteBlock(NX.i18n.get("set.sndSilentNote", "O modo silencioso não corta o áudio de chamadas ativas."));

    const foot =
      '<div class="set-card__foot">' +
      '<span class="set-hint" style="margin-right:auto">' +
      esc(NX.i18n.get("set.sndGeneratedHint", "Os sons são gerados no próprio navegador, sem arquivos externos.")) +
      "</span>" +
      '<button type="button" class="set-btn set-btn--soft set-btn--sm" data-set="sound">' +
      ico("headset", 16) +
      " " +
      esc(NX.i18n.get("set.testarsom", "Testar som")) +
      "</button></div>";

    return (
      '<section class="set-card" data-sound-card data-master="' + (off ? "off" : "on") + '">' +
      headBlock(
        NX.i18n.get("set.item.notifSounds", "Sons"),
        NX.i18n.get("set.sndCardDesc", "Escolha quais sons o Nexo toca e em que volume.")
      ) +
      masterRow +
      volumeRow +
      catsBlock +
      silentRow +
      foot +
      "</section>"
    );
  }

  PANELS.notifications = function (focusKey) {
    const p = prefs();

    const html =
      '<section class="set-card">' +
      headBlock((NX.i18n.get("nav.notifications", "Notificações")), NX.i18n.get("set.escolhaMereceSuaAtencao", "Escolha o que merece sua atenção enquanto você está por aqui.")) +
      switchRow("messages", p.messages, (NX.i18n.get("nav.messages", "Mensagens")), NX.i18n.get("set.avisosMensagensDiretasCanais", "Avisos de mensagens diretas e de canais em que você participa.")) +
      switchRow("mentions", p.mentions, (NX.i18n.get("set.item.notifMentions", "Menções")), NX.i18n.get("set.avisosQuandoAlguemEscreve", "Avisos quando alguém escreve @você.")) +
      '<div class="set-card__foot">' +
      ("<span class=\"set-hint\" style=\"margin-right:auto\">" + NX.i18n.get("set.aspreferenciassaosalvasautomaticamentenest", "As preferências são salvas automaticamente neste dispositivo.") + "</span>") +
      "</div></section>" +
      soundCardHTML() +
      '<section class="set-card">' +
      headBlock(NX.i18n.get("set.silenciarRapidamente", "Silenciar rapidamente"), NX.i18n.get("set.precisaFocarDesligueTudo", "Precisa focar? Desligue tudo e reative quando voltar.")) +
      '<div class="set-card__foot" style="border-top:0;padding-top:0;margin-top:4px">' +
      ("<button type=\"button\" class=\"set-btn set-btn--ghost set-btn--sm\" data-set=\"mute-all\">" + NX.i18n.get("set.desativartodas", "Desativar todas") + "</button>") +
      ("<button type=\"button\" class=\"set-btn set-btn--primary set-btn--sm\" data-set=\"unmute-all\">" + NX.i18n.get("set.ativartodas", "Ativar todas") + "</button>") +
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
          if (handleSoundInput(host, input)) return;
          const key = input.getAttribute("data-pref");
          if (!key) return;
          savePref(key, input.checked);
        });
        host.addEventListener("input", (e) => {
          const input = e.target;
          if (!input || !input.getAttribute) return;
          if (input.getAttribute("data-sfx") === "volume") updateVolumeLabel(host, input.value);
        });
        syncSoundCard(host);
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
      ["all", (NX.i18n.get("reg.privacyAll", "Todos"))],
      ["friends", NX.i18n.get("set.soAmigos", "Só amigos")],
      ["none", (NX.i18n.get("reg.privacyNone", "Ninguém"))],
    ]
      .map(
        (o) =>
          '<option value="' + o[0] + '"' + (p.dms === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"
      )
      .join("");

    const inviteOptions = [
      ["everyone", NX.i18n.get("set.qualquer", "De qualquer um")],
      ["friends", NX.i18n.get("set.soAmigos2", "Só de amigos")],
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
              ("<small>" + NX.i18n.get("set.bloqueado", "Bloqueado") + " ") + esc(timeAgo(b.at) || "recentemente") + "</small></span>" +
              '<button type="button" class="set-btn set-btn--danger-soft set-btn--sm" data-set="unblock" data-id="' +
              esc(b.id) + ("\">" + NX.i18n.get("page.desbloquear", "Desbloquear") + "</button></div>")
          )
          .join("") +
        "</div>"
      : '<div style="margin-top:12px">' +
        emptyBlock("shield", NX.i18n.get("set.ninguemBloqueado", "Ninguém bloqueado"), NX.i18n.get("set.quemVoceBloquearNao", "Quem você bloquear não poderá te escrever nem te ver nas listas de membros.")) +
        "</div>";

    const html =
      '<section class="set-card" data-focus-card="privacy-dms">' +
      headBlock(NX.i18n.get("set.quemPodeFalarVoce", "Quem pode falar com você"), NX.i18n.get("set.controleQuemIniciaConversas", "Controle quem inicia conversas e quem te chama para comunidades.")) +
      ("<div class=\"set-row\"><span class=\"set-row__txt\"><strong>" + NX.i18n.get("set.item.privacyDms", "Mensagens privadas") + "</strong>") +
      ("<small>" + NX.i18n.get("set.quempodeabrirumaconversadireta", "Quem pode abrir uma conversa direta com você.") + "</small></span>") +
      '<select class="set-select" data-privacy="dms" style="width:auto;min-width:150px">' + dmsOptions + "</select></div>" +
      ("<div class=\"set-row\" data-focus-card=\"privacy-invites\"><span class=\"set-row__txt\"><strong>" + NX.i18n.get("set.item.privacyInvites", "Convites") + "</strong>") +
      ("<small>" + NX.i18n.get("set.quempodeteconvidarparaservidores", "Quem pode te convidar para servidores.") + "</small></span>") +
      '<select class="set-select" data-privacy="invites" style="width:auto;min-width:170px">' + inviteOptions + "</select></div>" +
      ("<div class=\"set-card__foot\"><span class=\"set-hint\" style=\"margin-right:auto\">" + NX.i18n.get("set.salvoautomaticamente", "Salvo automaticamente.") + "</span></div>") +
      "</section>" +
      '<section class="set-card" data-focus-card="privacy-blocks">' +
      headBlock((NX.i18n.get("set.item.privacyBlocks", "Bloqueios")), NX.i18n.get("set.pessoasBloqueadasNaoConseguem", "Pessoas bloqueadas não conseguem te escrever nem aparecer nas suas listas.")) +
      blockList +
      '<form data-form="block" novalidate><div class="set-inline">' +
      '<input class="set-input" name="name" maxlength="24" placeholder="' + NX.i18n.get("ui.nomedeusuario", "nome de usuário") + '" autocomplete="off" />' +
      ("<button type=\"submit\" class=\"set-btn set-btn--danger-soft\">" + NX.i18n.get("page.bloquear", "Bloquear") + "</button></div>") +
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
              showErr(err, NX.i18n.get("set.digiteNomeUsuarioPelo", "Digite um nome de usuário com pelo menos 2 caracteres."));
              return;
            }
            const current = blocks();
            const exists = current.some((b) => b.name.toLowerCase() === raw.toLowerCase());
            if (exists) {
              showErr(err, NX.i18n.get("set.esseUsuarioJaEsta", "Esse usuário já está bloqueado."));
              return;
            }
            current.push({ id: uid("bl"), name: raw.slice(0, 24), at: Date.now() });
            saveBlocks(current);
            toast("@" + raw + (" " + NX.i18n.get("people.foibloqueado", "foi bloqueado.")), "success");
            refresh();
          });
        }
      },
    };
  };

  /* ---------- 6b. Privacidade da conta (rede social) ----------
     Controles ligados em me.privacy, sempre via NX.api.updateSocialPrivacy.
     A fonte de verdade é o estado devolvido pela API (nunca o valor clicado). */
  const SP_DEFAULTS = {
    follow: "all",
    dm: "all",
    followers: "all",
    likes: "all",
    posts: "public",
    friendRequests: "all",
  };

  const SP_VALID = {
    follow: ["all", "approved"],
    dm: ["all", "friends", "followers", "none"],
    followers: ["all", "followers", "self"],
    likes: ["all", "followers", "self"],
    posts: ["public", "followers", "self"],
    friendRequests: ["all", "common", "none"],
  };

  const SP_GROUPS = [
    {
      key: "follow",
      label: NX.i18n.get("set.quemPodeMeSeguir", "Quem pode me seguir?"),
      options: [
        ["all", (NX.i18n.get("reg.privacyAll", "Todos"))],
        ["approved", NX.i18n.get("set.apenasAprovados", "Apenas aprovados")],
      ],
      hints: {
        all: NX.i18n.get("set.todosQualquerPessoaPode", "Todos: qualquer pessoa pode começar a te seguir sem pedir sua permissão."),
        approved: (NX.i18n.get("set.apenasaprovadosquemquiserteseguir", "Apenas aprovados: quem quiser te seguir recebe uma solicitação que você aceita ou recusa.")),
      },
    },
    {
      key: "dm",
      label: NX.i18n.get("set.quemPodeEnviarDm", "Quem pode enviar DM?"),
      options: [
        ["all", (NX.i18n.get("reg.privacyAll", "Todos"))],
        ["friends", (NX.i18n.get("nav.friends", "Amigos"))],
        ["followers", (NX.i18n.get("people.seguidores", "Seguidores"))],
        ["none", (NX.i18n.get("reg.privacyNone", "Ninguém"))],
      ],
      hints: {
        all: NX.i18n.get("set.todosQualquerPessoaPode2", "Todos: qualquer pessoa pode iniciar uma conversa direta com você."),
        friends: NX.i18n.get("set.amigosSoQuemSeu", "Amigos: só quem é seu amigo no Nexo consegue começar uma conversa direta."),
        followers: NX.i18n.get("set.seguidoresSoQuemJa", "Seguidores: só quem já te segue pode começar uma conversa direta."),
        none: NX.i18n.get("set.ninguemNinguemConsegueIniciar", "Ninguém: ninguém consegue iniciar uma conversa direta com você."),
      },
    },
    {
      key: "followers",
      label: NX.i18n.get("set.quemPodeVerMeus", "Quem pode ver meus seguidores?"),
      options: [
        ["all", (NX.i18n.get("reg.privacyAll", "Todos"))],
        ["followers", (NX.i18n.get("people.seguidores", "Seguidores"))],
        ["self", NX.i18n.get("set.apenasEu3", "Apenas eu")],
      ],
      hints: {
        all: NX.i18n.get("set.todosQualquerPessoaPode3", "Todos: qualquer pessoa pode abrir a sua lista de seguidores."),
        followers: NX.i18n.get("set.seguidoresSoQuemJa2", "Seguidores: só quem já te segue consegue ver quem te segue."),
        self: NX.i18n.get("set.apenasEuNinguemAlem", "Apenas eu: ninguém além de você vê a sua lista de seguidores."),
      },
    },
    {
      key: "likes",
      label: NX.i18n.get("set.quemPodeVerMinhas", "Quem pode ver minhas curtidas?"),
      options: [
        ["all", (NX.i18n.get("reg.privacyAll", "Todos"))],
        ["followers", (NX.i18n.get("people.seguidores", "Seguidores"))],
        ["self", NX.i18n.get("set.apenasEu3", "Apenas eu")],
      ],
      hints: {
        all: NX.i18n.get("set.todosQualquerPessoaAbrir", "Todos: qualquer pessoa que abrir seu perfil vê o ❤️ de curtidas recebidas."),
        followers: NX.i18n.get("set.seguidoresSoQuemJa3", "Seguidores: só quem já te segue vê quantas curtidas você recebeu."),
        self: NX.i18n.get("set.apenasEuSeuPerfil", "Apenas eu: o ❤️ do seu perfil aparece como privado para os outros."),
      },
    },
    {
      key: "posts",
      label: NX.i18n.get("set.quemPodeVerMinhas2", "Quem pode ver minhas publicações?"),
      options: [
        ["public", (NX.i18n.get("ex.publico", "Público"))],
        ["followers", (NX.i18n.get("people.seguidores", "Seguidores"))],
        ["self", NX.i18n.get("set.apenasEu3", "Apenas eu")],
      ],
      hints: {
        public: (NX.i18n.get("set.publicosuaspublicacoesaparecemparaqualquer", "Público: suas publicações aparecem para qualquer pessoa no Nexo, mesmo para quem não te segue.")),
        followers: NX.i18n.get("set.seguidoresSoQuemJa4", "Seguidores: só quem já te segue vê as suas publicações no feed."),
        self: NX.i18n.get("set.apenasEuSoVoce", "Apenas eu: só você vê as suas publicações."),
      },
    },
    {
      key: "friendRequests",
      label: NX.i18n.get("set.solicitacoesAmizade", "Solicitações de amizade"),
      options: [
        ["all", (NX.i18n.get("reg.privacyAll", "Todos"))],
        ["common", NX.i18n.get("set.amigosComum", "Amigos em comum")],
        ["none", (NX.i18n.get("reg.privacyNone", "Ninguém"))],
      ],
      hints: {
        all: NX.i18n.get("set.todosQualquerPessoaPode4", "Todos: qualquer pessoa pode te enviar uma solicitação de amizade."),
        common: (NX.i18n.get("set.amigosemcomumsoquemtem", "Amigos em comum: só quem tem pelo menos um amigo em comum pode te chamar de amizade.")),
        none: NX.i18n.get("set.ninguemNinguemEnviaSolicitacao", "Ninguém: ninguém envia solicitação de amizade para você."),
      },
    },
  ];

  function spGroup(key) {
    for (let i = 0; i < SP_GROUPS.length; i++) {
      if (SP_GROUPS[i].key === key) return SP_GROUPS[i];
    }
    return null;
  }

  /* estado atual = me.privacy (padrões do migrateSocial quando faltar algo) */
  function spValues() {
    const m = me();
    const p = (m && m.privacy) || {};
    const out = {};
    SP_GROUPS.forEach((g) => {
      const v = p[g.key];
      out[g.key] = SP_VALID[g.key].indexOf(v) > -1 ? v : SP_DEFAULTS[g.key];
    });
    return out;
  }

  function spSegHTML(g, value) {
    const options = g.options
      .map((o) => {
        const on = o[0] === value;
        return (
          '<label class="set-seg__btn' + (on ? " is-on" : "") + '" data-seg-opt="' + o[0] + '">' +
          '<input type="radio" name="set-sp-' + g.key + '" value="' + o[0] + '"' +
          (on ? " checked" : "") +
          ' data-social="' + g.key + '" />' +
          "<span>" + esc(o[1]) + "</span></label>"
        );
      })
      .join("");
    return (
      '<div class="set-seg set-seg--sp" data-priv-seg="' + g.key + '" data-busy-label="Salvando"' +
      ' role="radiogroup" aria-labelledby="set-sp-lbl-' + g.key +
      '" aria-describedby="set-sp-hint-' + g.key + '">' +
      options +
      "</div>"
    );
  }

  /* repinta um grupo a partir do valor autoritativo (e devolve o foco,
     já que o busy do controle recria os inputs) */
  function spMark(host, key, value, refocus) {
    const g = spGroup(key);
    const wrap = host.querySelector('[data-priv-group="' + key + '"]');
    if (!g || !wrap) return;
    Array.prototype.forEach.call(wrap.querySelectorAll("[data-seg-opt]"), (el) => {
      const on = el.getAttribute("data-seg-opt") === value;
      el.classList.toggle("is-on", on);
      const input = el.querySelector("input");
      if (input) input.checked = on;
    });
    const hint = wrap.querySelector("[data-priv-hint]");
    if (hint) hint.textContent = g.hints[value] || "";
    if (refocus) {
      const input = wrap.querySelector('[data-seg-opt="' + value + '"] input');
      if (input && input.focus) input.focus();
    }
  }

  function spSave(host, key, value) {
    const g = spGroup(key);
    const prev = spValues()[key];

    /* valor desconhecido ou já salvo: só realinha a interface */
    if (!g || SP_VALID[key].indexOf(value) === -1 || value === prev) {
      spMark(host, key, prev, false);
      return;
    }

    if (!NX.api || typeof NX.api.updateSocialPrivacy !== "function") {
      spMark(host, key, prev, false);
      toast(NX.i18n.get("reg.invalid", "Não foi possível salvar agora. Tente de novo."), "error");
      return;
    }

    const seg = host.querySelector('[data-priv-seg="' + key + '"]');
    const hadFocus = !!(seg && document.activeElement && seg.contains(document.activeElement));
    let next = prev;

    const done = NX.ui && NX.ui.busy ? NX.ui.busy(seg) : function () {};
    if (seg) seg.setAttribute("aria-busy", "true");

    NX.api
      .updateSocialPrivacy({ [key]: value })
      .then(() => {
        /* só o que a API devolveu vira estado */
        next = spValues()[key];
        toast(NX.i18n.get("set.preferenciaPrivacidadeAtualizada", "Preferência de privacidade atualizada."), "success");
      })
      .catch((er) => {
        /* deu erro: recarrega o valor anterior, nada de estado falso */
        next = spValues()[key];
        toast((er && er.message) || NX.i18n.get("reg.invalid", "Não foi possível salvar agora. Tente de novo."), "error");
      })
      .then(() => {
        done();
        if (seg) seg.removeAttribute("aria-busy");
        spMark(host, key, next, hadFocus);
      });
  }

  PANELS.privacySocial = function () {
    const cur = spValues();

    const groups = SP_GROUPS.map((g) => {
      const value = cur[g.key];
      return (
        '<div class="set-priv" data-priv-group="' + g.key + '">' +
        '<span class="set-label" id="set-sp-lbl-' + g.key + '">' + esc(g.label) + "</span>" +
        spSegHTML(g, value) +
        '<span class="set-hint" data-priv-hint="' + g.key + '" id="set-sp-hint-' + g.key + '">' +
        esc(g.hints[value] || "") +
        "</span></div>"
      );
    }).join("");

    const html =
      '<section class="set-card" data-focus-card="privacy-social">' +
      headBlock(
        (NX.i18n.get("landing.privacidade", "Privacidade")),
        (NX.i18n.get("set.escolhaquempodeteseguirte", "Escolha quem pode te seguir, te escrever e ver o que você publica. Cada escolha vale para a sua conta no Nexo inteira."))
      ) +
      groups +
      '<div class="set-card__foot">' +
      ("<span class=\"set-hint\" style=\"margin-right:auto\">" + NX.i18n.get("set.cadaopcaoesalvasozinhaassim", "Cada opção é salva sozinha assim que você escolhe.") + "</span>") +
      "</div></section>" +
      '<section class="set-card">' +
      headBlock(NX.i18n.get("set.comoFuncionaPratica", "Como funciona na prática"), NX.i18n.get("set.nadaMudaSeuPerfil", "Nada muda no seu perfil: só quem consegue chegar até você.")) +
      noteBlock(
        (NX.i18n.get("set.comapenasaprovadosospedidosde", "Com \"Apenas aprovados\", os pedidos de seguimento aparecem em Solicitações e você aceita ou recusa um a um.")),
        null
      ) +
      '<div style="margin-top:10px">' +
      noteBlock(
        (NX.i18n.get("set.comapenaseunaspublicacoesso", "Com \"Apenas eu\" nas publicações, só você enxerga as suas postagens — nem quem te segue.")),
        "accent"
      ) +
      "</div></section>";

    return {
      html: html,
      wire: function (host) {
        host.addEventListener("change", (e) => {
          const input = e.target;
          if (!input || !input.getAttribute) return;
          const key = input.getAttribute("data-social");
          if (!key) return;
          spSave(host, key, input.value);
        });
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
              "<small>" + esc(s.os || "") + (s.current ? (" " + NX.i18n.get("set.ativoagora", "· ativo agora")) : (" " + NX.i18n.get("set.ultimaatividade", "· última atividade") + " ") + esc(timeAgo(s.last))) +
              "</small></span>" +
              (s.current ? ("<span class=\"set-badge\">" + NX.i18n.get("set.agora", "Agora") + "</span>") : "") +
              '<button type="button" class="set-btn set-btn--danger-soft set-btn--sm" data-set="end-session" data-id="' +
              esc(s.id) + (NX.i18n.get("set.encerrarsessao", "\">Encerrar sessão") + "</button></div>")
          )
          .join("") +
        "</div>"
      : emptyBlock("lock", NX.i18n.get("set.nenhumaOutraSessao", "Nenhuma outra sessão"), NX.i18n.get("set.quandoVoceEntrarOutro", "Quando você entrar em outro dispositivo, ele aparece aqui."));

    const deviceRows = list.length
      ? '<div class="set-list">' +
        list
          .map(
            (s) =>
              '<div class="set-item"><span class="set-item__ico' + (s.current ? " is-live" : "") + '">' +
              ico("grid", 18) + "</span>" +
              '<span class="set-item__txt"><strong>' + esc(s.name) + "</strong><small>" + esc(s.os || "—") + "</small></span>" +
              (s.current
                ? ("<span class=\"set-badge\">" + NX.i18n.get("set.esteaparelho", "Este aparelho") + "</span>")
                : '<span class="set-badge set-badge--muted">' + esc(timeAgo(s.last) || "inativo") + "</span>") +
              "</div>"
          )
          .join("") +
        "</div>"
      : emptyBlock("grid", NX.i18n.get("set.soEsteDispositivo", "Só este dispositivo"), NX.i18n.get("set.nenhumOutroAparelhoConectado", "Nenhum outro aparelho conectado à sua conta."));

    const html =
      '<section class="set-card" data-focus-card="security-sessions">' +
      headBlock((NX.i18n.get("set.item.securitySessions", "Sessões")), NX.i18n.get("set.cadaEntradaContaVira", "Cada entrada na conta vira uma sessão. Encerre a que você não reconhecer.")) +
      sessionRows +
      "</section>" +
      '<section class="set-card" data-focus-card="security-devices">' +
      headBlock((NX.i18n.get("set.item.securityDevices", "Dispositivos")), NX.i18n.get("set.resumoAparelhosAcessoSua", "Resumo dos aparelhos com acesso à sua conta.")) +
      '<div class="set-stats">' +
      ("<div class=\"set-stat\"><span>" + NX.i18n.get("set.item.securityDevices", "Dispositivos") + "</span><strong>") + list.length + "</strong>" +
      ("<small>" + NX.i18n.get("set.comacessoagora", "com acesso agora") + "</small></div>") +
      ("<div class=\"set-stat\"><span>" + NX.i18n.get("set.esteaparelho", "Este aparelho") + "</span><strong>") + esc(p) + ("</strong><small>" + NX.i18n.get("set.navegadoratual", "navegador atual") + "</small></div>") +
      ("<div class=\"set-stat\"><span>" + NX.i18n.get("set.sessaoatual", "Sessão atual") + "</span><strong>") +
      esc((list.find((s) => s.current) || {}).name || NX.i18n.get("set.esteNavegador2", "Este navegador")) + ("</strong><small>" + NX.i18n.get("set.ativaagora", "ativa agora") + "</small></div>") +
      "</div>" +
      deviceRows +
      '<div style="margin-top:14px">' +
      noteBlock((NX.i18n.get("set.desconfioudealgoencerreasessao", "Desconfiou de algo? Encerre a sessão suspeita e troque sua senha em Segurança → Sessões.")), null) +
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
      headBlock(NX.i18n.get("app.sairConta", "Sair da conta"), NX.i18n.get("set.vocePrecisaraEntrarNovo", "Você precisará entrar de novo para voltar a conversar nos seus servidores.")) +
      (m
        ? '<div class="set-avatar" style="margin-bottom:0">' +
          '<span class="set-avatar__img" style="--av:' + esc((m.avatar && m.avatar.color) || "#35e0a8") + '">' +
          "<span>" + esc((m.avatar && m.avatar.emoji) || (m.displayName || "?").slice(0, 1)) + "</span></span>" +
          '<div class="set-avatar__meta"><strong>' + esc(m.displayName || m.username) + "</strong>" +
          "<span>@" + esc(m.username) + "</span></div></div>"
        : "") +
      '<div class="set-card__foot">' +
      ("<button type=\"button\" class=\"set-btn set-btn--ghost\" data-set=\"close\">" + NX.i18n.get("common.cancel", "Cancelar") + "</button>") +
      '<button type="button" class="set-btn set-btn--danger set-btn--lg" data-set="logout">' +
      ico("logout", 18) + (" " + NX.i18n.get("app.sairConta", "Sair da conta") + "</button>") +
      "</div></section>";
    return { html: html };
  };

  /* =========================================================
     ESTRUTURA DA TELA
     ========================================================= */
  function navItemHTML(item) {
    const label = item.tk && NX.t ? NX.t(item.tk) : item.label;
    return (
      '<button type="button" class="set-nav__item' + (item.danger ? " is-danger" : "") +
      '" data-set="section" data-id="' + item.id + '" data-nav-id="' + item.id + '">' +
      ico(item.icon, 17) + "<span>" + esc(label) + "</span></button>"
    );
  }

  function navHTML() {
    let html = "";
    GROUPS.forEach((g) => {
      const title = g.tk && NX.t ? NX.t(g.tk) : g.title;
      html +=
        '<div class="set-nav__group"><div class="set-nav__title">' + esc(title) + "</div>" +
        '<div class="set-nav__list">' + g.items.map(navItemHTML).join("") + "</div></div>";
    });
    html +=
      '<div class="set-nav__group set-nav__sep"><div class="set-nav__list">' +
      navItemHTML(SIGNOUT_ITEM) +
      "</div></div>";
    return html;
  }

  /* shell reconstruído a cada render */
  function shellHTML() {
    return (
      '<div class="set-shell">' +
      '<header class="set-head"><div class="set-head__inner">' +
      '<div class="set-head__txt"><span class="set-eyebrow">' +
      esc(NX.t ? NX.t("set.eyebrow") : (NX.i18n.get("set.eyebrow", "Preferências"))) + "</span>" +
      '<h1 class="set-title">' + esc(NX.t ? NX.t("set.title") : (NX.i18n.get("nav.settings", "Configurações"))) + "</h1></div>" +
      '<span class="set-head__who" data-who hidden></span>' +
      '<button type="button" class="set-close" data-set="close" title="' + NX.i18n.get("ui.fecharesc", "Fechar (Esc)") + '" aria-label="' +
      esc(NX.t ? NX.t("set.close") : NX.i18n.get("set.close", "Fechar configurações")) + '">' +
      ico("x", 20) +
      "</button></div></header>" +
      '<div class="set-body">' +
      '<nav class="set-nav" aria-label="' + esc(NX.t ? NX.t("set.navAria") : NX.i18n.get("set.navAria", "Seções de configuração")) +
      '" data-nav>' + navHTML() + "</nav>" +
      '<main class="set-content" data-content tabindex="-1"></main>' +
      "</div></div>"
    );
  }

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
      built = { html: '<section class="set-card">' + headBlock((NX.i18n.get("set.ops", "Ops")), NX.i18n.get("set.naoFoiPossivelCarregar", "Não foi possível carregar esta seção.")) + "</section>" };
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
          toast(NX.i18n.get("set.voceSaiuConta", "Você saiu da conta."), "success");
          closeScreen();
        })
        .catch((e) => {
          toast((e && e.message) || NX.i18n.get("set.naoFoiPossivelSair", "Não foi possível sair agora."), "error");
        });
    };

    if (typeof ui.confirm !== "function") {
      finish();
      return;
    }
    ui
      .confirm({
        title: NX.i18n.get("app.sairConta", "Sair da conta"),
        message: NX.i18n.get("set.vocePrecisaraEntrarNovo2", "Você precisará entrar de novo para voltar a conversar."),
        confirmLabel: (NX.i18n.get("set.item.logout", "Sair")),
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
    "set-sound": () => {
      if (!playTestSound()) {
        toast(NX.i18n.get("set.seuNavegadorNaoPermitiu", "Seu navegador não permitiu tocar o som de teste."), "info");
        return;
      }
      try {
        const s = soundPrefs();
        if (!s.on || s.muted || s.categories.notifications === false) {
          toast(NX.i18n.get("set.sndTesteSilenciado", "Os sons estão desligados — ative acima para ouvir o teste."), "info");
        }
      } catch (e) {
        /* sem preferências: segue sem aviso */
      }
    },
    "set-mute-all": () => {
      setPrefsAll(false);
      refresh();
      toast(NX.i18n.get("set.notificacoesDesativadasNesteDispositivo", "Notificações desativadas neste dispositivo."), "info");
    },
    "set-unmute-all": () => {
      setPrefsAll(true);
      refresh();
      toast(NX.i18n.get("people.notificacoesAtivadas", "Notificações ativadas."), "success");
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
      el.setAttribute("aria-label", show ? NX.i18n.get("set.ocultarSenha", "Ocultar senha") : NX.i18n.get("set.mostrarSenha", "Mostrar senha"));
    },
    "set-unblock": (el) => {
      const id = el.getAttribute("data-id");
      const list = blocks().filter((b) => b.id !== id);
      saveBlocks(list);
      toast(NX.i18n.get("set.usuarioDesbloqueado", "Usuário desbloqueado."), "info");
      refresh();
    },
    "set-end-session": (el) => {
      const id = el.getAttribute("data-id");
      const list = sessions().filter((s) => s.id !== id);
      saveSessions(list);
      toast(NX.i18n.get("set.sessaoEncerrada", "Sessão encerrada."), "success");
      refresh();
    },
    "set-save-profile": () => submitForm("profile"),
    "set-save-password": () => submitForm("password"),
  };

  function setPrefsAll(value) {
    const p = prefs();
    /* preserva o objeto de sons (booleano antigo já não é mais gravado) */
    set(K.prefs, { messages: !!value, mentions: !!value, sounds: normalizeSounds(p.sounds) });
    /* o som master continua sendo gravado pelo escritor único: NX.sfx */
    sfxEnabled(value);
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
      if (e.key !== (NX.i18n.get("app.escape", "Escape"))) return;
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
      root.innerHTML = shellHTML();
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
