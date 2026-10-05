/* ============================================================
   NEXO · núcleo
   Utilitários, bus de eventos, armazenamento, sessão,
   permissões, templates de servidor e validação.
   Camada 1 — sem dependência de DOM pesado (exceto helpers).
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  /* ---------------- utilitários ---------------- */
  const util = {};

  util.uid = (p) =>
    (p || "id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  util.h = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  util.el = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };

  util.q = (sel, root) => (root || document).querySelector(sel);
  util.qa = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  util.debounce = (fn, ms) => {
    let t;
    return function () {
      const a = arguments,
        c = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(c, a), ms);
    };
  };

  util.clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  util.rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  util.pick = (n) => Math.floor(Math.random() * n);

  util.copy = async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext !== false) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      /* cai no fallback */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  };

  /* ---------------- tempo ---------------- */
  const pad = (n) => String(n).padStart(2, "0");

  util.fmtTime = (ts) => {
    const d = new Date(ts);
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  };

  util.sameDay = (a, b) => {
    const x = new Date(a),
      y = new Date(b);
    return (
      x.getFullYear() === y.getFullYear() &&
      x.getMonth() === y.getMonth() &&
      x.getDate() === y.getDate()
    );
  };

  util.fmtDayLabel = (ts) => {
    const d = new Date(ts),
      now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (util.sameDay(d, now)) return "Hoje";
    if (util.sameDay(d, yesterday)) return "Ontem";
    return d.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
    });
  };

  util.timeAgo = (ts) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "agora há pouco";
    const m = Math.floor(s / 60);
    if (m < 60) return "há " + m + " min";
    const h = Math.floor(m / 60);
    if (h < 24) return "há " + h + " h";
    const d = Math.floor(h / 24);
    if (d === 1) return "ontem";
    if (d < 30) return "há " + d + " dias";
    return "em " + new Date(ts).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
  };

  util.ageFrom = (birth) => {
    if (!birth) return null;
    const b = new Date(birth + "T00:00:00");
    if (isNaN(b.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
    return age;
  };

  /* ---------------- texto ---------------- */
  util.slug = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);

  util.initials = (name) => {
    const parts = String(name || "?")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  util.normalize = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  util.plural = (n, one, many) => n + " " + (n === 1 ? one : many);

  util.linkify = (text) => {
    const safe = util.h(text);
    return safe.replace(
      /(https?:\/\/[^\s<]+|www\.[^\s<]+)/g,
      (m) =>
        '<a href="' +
        (m.startsWith("http") ? m : "https://" + m) +
        '" target="_blank" rel="noopener noreferrer" class="msg-link">' +
        m +
        "</a>"
    );
  };

  util.mentionify = (text, serverMembers) => {
    let out = util.linkify(text);
    (serverMembers || []).forEach((m) => {
      const u = "@" + m.username;
      if (out.indexOf(util.h(u)) !== -1) {
        out = out.split(util.h(u)).join('<span class="mention">' + util.h(u) + "</span>");
      }
    });
    return out;
  };

  /* ============================================================
     CRIPTOGRAFIA (camada "backend" do protótipo)
     SHA-256 + HMAC + PBKDF2 em JS puro: funciona também fora de
     contexto seguro (file://), onde crypto.subtle não existe.
     Em produção estas funções rodam no servidor (bcrypt/argon2).
     ============================================================ */
  const K256 = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
  const TE = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

  function utf8(str) {
    if (TE) return TE.encode(String(str));
    const out = [];
    const s = unescape(encodeURIComponent(String(str)));
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return new Uint8Array(out);
  }
  function hexOf(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
    return out;
  }
  function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  function sha256Bytes(msg) {
    const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const l = msg.length;
    const buf = new Uint8Array((((l + 8) >> 6) + 1) * 64);
    buf.set(msg, 0);
    buf[l] = 0x80;
    const dv = new DataView(buf.buffer);
    const bits = l * 8;
    dv.setUint32(buf.length - 8, Math.floor(bits / 4294967296), false);
    dv.setUint32(buf.length - 4, bits >>> 0, false);
    const w = new Uint32Array(64);

    for (let off = 0; off < buf.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15], y = w[i - 2];
        const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
        const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
        const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const mj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e;
        e = (d + t1) >>> 0;
        d = c; c = b; b = a;
        a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    let out = "";
    for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, "0");
    return out;
  }

  function hexToBytes(hex) {
    const out = new Uint8Array(String(hex).length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(String(hex).substr(i * 2, 2), 16);
    return out;
  }

  util.sha256Hex = function (str) {
    return sha256Bytes(utf8(str));
  };

  function hmacBytes(keyBytes, msgBytes) {
    let k = keyBytes;
    if (k.length > 64) k = hexToBytes(sha256Bytes(k));
    const ipad = new Uint8Array(64), opad = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      const b = i < k.length ? k[i] : 0;
      ipad[i] = b ^ 0x36;
      opad[i] = b ^ 0x5c;
    }
    return hexToBytes(sha256Bytes(concat(opad, sha256Bytes(concat(ipad, msgBytes)))));
  }

  function pbkdf2Hex(password, saltHex, iter) {
    const pw = utf8(password);
    const salt = hexToBytes(saltHex);
    const block = concat(salt, new Uint8Array([0, 0, 0, 1]));
    let u = hmacBytes(pw, block);
    const t = new Uint8Array(u.length);
    for (let i = 0; i < u.length; i++) t[i] = u[i];
    for (let i = 1; i < iter; i++) {
      u = hmacBytes(pw, u);
      for (let j = 0; j < t.length; j++) t[j] ^= u[j];
    }
    return hexOf(t);
  }

  /* ---------------- senha ----------------
     nx2$<iter>$<salt>$<hash>  → salt por conta + PBKDF2
     nx1$...                   → hash antigo (contas já existentes,
                                  atualizado sozinho no 1º login certo) */
  util.PBKDF2_ITER = 10000;

  util.makeSalt = function () {
    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return hexOf(bytes);
  };

  util.hashPassword = function (pw, salt) {
    const s = salt || "";
    if (!s) {
      /* compat: formato antigo (sem salt) */
      const raw = "nexo::" + String(pw || "");
      let h = 5381;
      for (let i = 0; i < raw.length; i++) h = ((h << 5) + h) ^ raw.charCodeAt(i);
      return "nx1$" + (h >>> 0).toString(36) + "$" + raw.length.toString(36);
    }
    return (
      "nx2$" + util.PBKDF2_ITER + "$" + s + "$" + pbkdf2Hex(String(pw || ""), s, util.PBKDF2_ITER)
    );
  };

  util.hashInfo = function (stored) {
    const parts = String(stored || "").split("$");
    if (parts[0] === "nx2" && parts.length === 4)
      return { algo: "nx2", iter: parseInt(parts[1], 10) || util.PBKDF2_ITER, salt: parts[2], hash: parts[3] };
    if (parts[0] === "nx1") return { algo: "nx1", raw: stored };
    return null;
  };

  util.verifyPassword = function (pw, stored) {
    const info = util.hashInfo(stored);
    if (!info) return false;
    if (info.algo === "nx2") {
      const calc = pbkdf2Hex(String(pw || ""), info.salt, info.iter);
      if (calc.length !== info.hash.length) return false;
      let diff = 0;
      for (let i = 0; i < calc.length; i++) diff |= calc.charCodeAt(i) ^ info.hash.charCodeAt(i);
      return diff === 0;
    }
    /* legado nx1 (DJB2) — mantido só para contas antigas */
    const raw = "nexo::" + String(pw || "");
    let h = 5381;
    for (let i = 0; i < raw.length; i++) h = ((h << 5) + h) ^ raw.charCodeAt(i);
    return info.raw === "nx1$" + (h >>> 0).toString(36) + "$" + raw.length.toString(36);
  };

  util.isLegacyHash = function (stored) {
    const info = util.hashInfo(stored);
    return !!info && info.algo === "nx1";
  };

  /* senha nunca em texto puro no banco */
  util.isPlaintextPassword = function (stored) {
    return !util.hashInfo(stored);
  };

  /* ---------------- validação ---------------- */
  util.isEmail = (v) => /^[^\s@,;:<>()[\]\\"]+@[^\s@,;:<>()[\]\\"]+\.[a-z]{2,}$/i.test(String(v || "").trim());

  util.usernameOk = (v) => /^[a-z0-9._]{3,18}$/i.test(String(v || "").trim());

  util.PASSWORD_RULES = [
    { key: "len", label: "8 caracteres ou mais", test: (v) => v.length >= 8 },
    { key: "letter", label: "1 letra", test: (v) => /[a-zA-ZÀ-ÿ]/.test(v) },
    { key: "digit", label: "1 número", test: (v) => /[0-9]/.test(v) },
  ];

  util.passwordPolicy = function (v) {
    const val = String(v || "");
    const checks = util.PASSWORD_RULES.map((r) => ({ key: r.key, label: r.label, ok: r.test(val) }));
    const ok = checks.every((c) => c.ok);
    return {
      ok: ok,
      checks: checks,
      message:
        "A senha precisa de no mínimo 8 caracteres, com pelo menos uma letra e um número.",
    };
  };

  util.passwordOk = (v) => util.passwordPolicy(v).ok;

  /* normaliza um identificador digitado (e-mail, @usuário ou nome) */
  util.normalizeIdentifier = function (v) {
    return String(v || "")
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  };

  /* código numérico criptográfico (nunca Math.random) */
  util.randCode = function (digits) {
    const n = digits || 6;
    const bytes = new Uint8Array(n);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
    let out = "";
    for (let i = 0; i < n; i++) out += String(bytes[i] % 10);
    return out;
  };

  /* ---------------- paletas ---------------- */
  util.PALETTE = [
    "#35e0a8",
    "#4cc9f0",
    "#8f83ff",
    "#ff7ab6",
    "#ffc857",
    "#ff6b7a",
    "#5ad1a3",
    "#a0e548",
    "#f0956b",
    "#7c9cff",
  ];

  util.EMOJIS = [
    "🌙","⚡","🎧","🔥","🌊","🎧","🌱","🎲","🚀","🐙",
    "🐱","🦊","🐼","🎮","🎯","📚","☕","🎧","💎","🌈",
    "🧠","🤖","🍕","🌵","🦉","🐝","🎸","🧭","🪐","🧩",
  ];

  util.emojiFor = (name) => {
    const pool = ["🌙","⚡","🎧","🔥","🌊","🌱","🎲","🚀","🐙","🎯","🧩","🪐","🌵","🦉","🎸","🧭","🤖","💎","🌈","🧠"];
    const s = String(name || "");
    let sum = 0;
    for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
    return pool[sum % pool.length];
  };

  util.colorFor = (key) => {
    const s = String(key || "");
    let sum = 0;
    for (let i = 0; i < s.length; i++) sum = (sum * 31 + s.charCodeAt(i)) >>> 0;
    return util.PALETTE[sum % util.PALETTE.length];
  };

  /* ---------------- avatar (HTML) ---------------- */
  util.avatarHTML = (user, size, showStatus) => {
    if (!user) return "";
    const cls = ["avatar", size ? "avatar--" + size : "avatar--md"];
    if (showStatus) cls.push("avatar--status");
    const glyph = user.avatar && user.avatar.emoji
      ? user.avatar.emoji
      : util.initials(user.displayName || user.username);
    const color = (user.avatar && user.avatar.color) || util.colorFor(user.id);
    const status = user.status || "offline";
    return (
      '<span class="' + cls.join(" ") + '" style="--av:' + color + '" aria-hidden="true">' +
      '<span class="avatar__glyph">' + util.h(glyph) + "</span>" +
      (showStatus ? '<i class="avatar__dot" data-status="' + status + '"></i>' : "") +
      "</span>"
    );
  };

  util.serverIconHTML = (server, size, showBadge) => {
    if (!server) return "";
    const cls = ["server-icon", size ? "server-icon--" + size : "server-icon--md"];
    const glyph =
      server.icon && server.icon.emoji
        ? server.icon.emoji
        : util.initials(server.name);
    const color = (server.icon && server.icon.color) || util.colorFor(server.id);
    return (
      '<span class="' + cls.join(" ") + '" style="--sv:' + color + '" aria-hidden="true">' +
      '<span class="server-icon__glyph">' + util.h(glyph) + "</span>" +
      (showBadge ? '<i class="server-icon__badge"></i>' : "") +
      "</span>"
    );
  };

  /* ---------------- bus de eventos ---------------- */
  const listeners = {};
  NX.bus = {
    on(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
      return () => NX.bus.off(type, fn);
    },
    off(type, fn) {
      const l = listeners[type];
      if (!l) return;
      const i = l.indexOf(fn);
      if (i > -1) l.splice(i, 1);
    },
    emit(type, payload) {
      (listeners[type] || []).slice().forEach((fn) => {
        try {
          fn(payload);
        } catch (e) {
          console.error("[bus]", type, e);
        }
      });
    },
  };

  /* ---------------- armazenamento ---------------- */
  const hasLocal = (() => {
    try {
      localStorage.setItem("__nx", "1");
      localStorage.removeItem("__nx");
      return true;
    } catch (e) {
      return false;
    }
  })();

  NX.storage = {
    persistent: hasLocal,
    lastError: null,
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    /* devolve true/false: o chamador precisa saber se os dados
       foram realmente gravados (nada de "gravar" em silêncio e
       perder a conta do usuário). */
    set(key, value) {
      if (!hasLocal) {
        NX.storage.lastError = "armazenamento indisponível";
        return false;
      }
      try {
        localStorage.setItem(key, JSON.stringify(value));
        NX.storage.lastError = null;
        return true;
      } catch (e) {
        NX.storage.lastError = (e && (e.name || e.code)) || "erro de gravação";
        console.warn("[storage] falha ao gravar", key, e);
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    },
    sessionGet(key, fallback) {
      try {
        const raw = sessionStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    sessionSet(key, value) {
      try {
        sessionStorage.setItem(key, JSON.stringify(value));
      } catch (e) {}
    },
    sessionRemove(key) {
      try {
        sessionStorage.removeItem(key);
      } catch (e) {}
    },
  };

  /* ---------------- sessão (trocável por auth real) ---------------- */
  const SKEY = "nexo.session";
  NX.session = {
    get() {
      return (
        NX.storage.get(SKEY, null) || NX.storage.sessionGet(SKEY, null) || null
      );
    },
    set(userId, remember) {
      const payload = { userId: userId, remember: !!remember, at: Date.now() };
      NX.storage.remove(SKEY);
      if (remember) NX.storage.set(SKEY, payload);
      else NX.storage.sessionSet(SKEY, payload);
      return payload;
    },
    clear() {
      NX.storage.remove(SKEY);
      NX.storage.sessionRemove(SKEY);
    },
  };

  /* ---------------- permissões ----------------
     Quatro grupos (Geral, Chat, Moderação, Voz).
     A chave é o contrato usado por cargos, overrides de canal e
     pela validação em api.js — some uma chave aqui e ela vira
     falsa para todo mundo (fail-safe). */
  NX.PERMS = [
    /* Geral */
    { key: "administrator", label: "Administrador", desc: "Controle total sobre o servidor.", group: "Geral", super: true },
    { key: "manageServer", label: "Gerenciar servidor", desc: "Editar nome, ícone, banner e descrição.", group: "Geral" },
    { key: "manageRoles", label: "Gerenciar cargos", desc: "Criar, editar e apagar cargos e permissões.", group: "Geral" },
    { key: "manageChannels", label: "Gerenciar canais", desc: "Criar, editar e apagar categorias e canais.", group: "Geral" },
    { key: "manageMembers", label: "Gerenciar membros", desc: "Ver detalhes e alterar cargos de membros.", group: "Geral" },
    { key: "createInvite", label: "Criar convites", desc: "Gerar links de convite para o servidor.", group: "Geral" },
    { key: "viewLogs", label: "Ver logs", desc: "Consultar o histórico de moderação.", group: "Geral" },

    /* Chat */
    { key: "viewChannels", label: "Ver canais", desc: "Visualizar canais de texto e voz.", group: "Chat" },
    { key: "sendMessages", label: "Enviar mensagens", desc: "Escrever nos canais de texto.", group: "Chat" },
    { key: "editMessages", label: "Editar mensagens", desc: "Editar mensagens de outras pessoas.", group: "Chat" },
    { key: "deleteMessages", label: "Excluir mensagens", desc: "Apagar mensagens de outras pessoas.", group: "Chat" },
    { key: "pinMessages", label: "Fixar mensagens", desc: "Fixar mensagens no canal.", group: "Chat" },
    { key: "attachFiles", label: "Anexar arquivos", desc: "Enviar imagens, vídeos e arquivos.", group: "Chat" },
    { key: "useEmojis", label: "Usar emojis", desc: "Reagir e usar emojis nas mensagens.", group: "Chat" },
    { key: "useCustomEmojis", label: "Usar emojis personalizados", desc: "Usar os emojis do servidor.", group: "Chat" },
    { key: "useGifs", label: "Usar GIFs", desc: "Enviar GIFs nas conversas.", group: "Chat" },
    { key: "mentionEveryone", label: "Mencionar membros", desc: "Usar @everyone e menções em massa.", group: "Chat" },

    /* Moderação */
    { key: "kickMembers", label: "Expulsar membros", desc: "Remover alguém do servidor (pode voltar).", group: "Moderação" },
    { key: "banMembers", label: "Banir membros", desc: "Bloquear a entrada de alguém no servidor.", group: "Moderação" },
    { key: "unbanMembers", label: "Desbanir membros", desc: "Remover alguém da lista de banidos.", group: "Moderação" },
    { key: "timeoutMembers", label: "Silenciar membros", desc: "Impedir alguém de enviar mensagens.", group: "Moderação" },

    /* Voz */
    { key: "joinVoice", label: "Conectar", desc: "Entrar em canais de voz.", group: "Voz" },
    { key: "speak", label: "Falar", desc: "Falar nos canais de voz.", group: "Voz" },
    { key: "muteMembers", label: "Silenciar membros", desc: "Silenciar alguém na voz.", group: "Voz" },
    { key: "deafenMembers", label: "Ensurdecer membros", desc: "Ensurdecer alguém na voz.", group: "Voz" },
    { key: "moveMembers", label: "Mover membros", desc: "Mover alguém entre canais de voz.", group: "Voz" },
  ];

  NX.PERM_KEYS = NX.PERMS.map((p) => p.key);

  /* permissões concedidas ao cargo padrão de um servidor novo */
  NX.BASE_PERMS = [
    "viewChannels",
    "sendMessages",
    "createInvite",
    "attachFiles",
    "useEmojis",
    "useCustomEmojis",
    "useGifs",
    "joinVoice",
    "speak",
  ];

  NX.defaultPerms = (preset) => {
    const out = {};
    NX.PERM_KEYS.forEach((k) => (out[k] = false));
    (preset || NX.BASE_PERMS).forEach((k) => {
      if (out[k] !== undefined) out[k] = true;
    });
    return out;
  };

  /* rótulos amigáveis para ações de log */
  NX.LOG_ACTIONS = {
    "member.join": "Membro entrou",
    "member.leave": "Membro saiu",
    "member.kick": "Membro foi expulso",
    "member.ban": "Membro foi banido",
    "member.unban": "Membro foi desbanido",
    "member.role": "Cargo alterado",
    "member.nick": "Apelido alterado",
    "role.create": "Cargo criado",
    "role.update": "Cargo alterado",
    "role.delete": "Cargo excluído",
    "channel.create": "Canal criado",
    "channel.update": "Canal alterado",
    "channel.delete": "Canal excluído",
    "category.create": "Categoria criada",
    "category.update": "Categoria alterada",
    "category.delete": "Categoria excluída",
    "message.delete": "Mensagem excluída",
    "message.pin": "Mensagem fixada",
    "server.update": "Configuração alterada",
    "invite.create": "Convite criado",
    "invite.revoke": "Convite revogado",
    "emoji.create": "Emoji adicionado",
    "emoji.delete": "Emoji removido",
    "ownership.transfer": "Propriedade transferida",
  };

  NX.STATUS_LABEL = {
    online: "Online",
    idle: "Ausente",
    dnd: "Não perturbe",
    offline: "Offline",
  };

  /* Estruturas iniciais oferecidas na criação de servidor */
  NX.TEMPLATES = [
    {
      id: "comunidade",
      name: "Comunidade",
      emoji: "🌐",
      desc: "Informações, conversa, suporte e voz.",
      cats: [
        { name: "INFORMAÇÕES", channels: [["boas-vindas", "text"], ["regras", "text"]] },
        { name: "COMUNIDADE", channels: [["geral", "text"], ["memes", "text"], ["novidades", "text"]] },
        { name: "SUPORTE", channels: [["ajuda", "text"], ["chamados", "text"]] },
        { name: "VOZ", channels: [["Sala Geral", "voice"], ["Jogatina", "voice"]] },
      ],
    },
    {
      id: "estudo",
      name: "Grupo de estudo",
      emoji: "📚",
      desc: "Material, dúvidas e sessões ao vivo.",
      cats: [
        { name: "ESTUDO", channels: [["geral", "text"], ["materiais", "text"], ["dúvidas", "text"]] },
        { name: "ENCONTROS", channels: [["Sala de Estudo", "voice"]] },
      ],
    },
    {
      id: "jogos",
      name: "Squad de jogos",
      emoji: "🎮",
      desc: "Lobby, avisos e salas de voz.",
      cats: [
        { name: "LOBBY", channels: [["geral", "text"], ["combos", "text"]] },
        { name: "PARTIDAS", channels: [["Sala 1", "voice"], ["Sala 2", "voice"]] },
      ],
    },
    {
      id: "dev",
      name: "Time de dev",
      emoji: "🛠️",
      desc: "Sprints, bugs e deploy.",
      cats: [
        { name: "PROJETO", channels: [["geral", "text"], ["bugs", "text"], ["releases", "text"]] },
        { name: "REUNIÕES", channels: [["Call", "voice"]] },
      ],
    },
    {
      id: "vazio",
      name: "Começar do zero",
      emoji: "✨",
      desc: "Uma categoria, um canal. O resto é seu.",
      cats: [{ name: "GERAL", channels: [["geral", "text"]] }],
    },
  ];


  NX.THEME_KEY = "nexo.theme";
  NX.applyTheme = (theme) => {
    const t = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    NX.storage.set(NX.THEME_KEY, t);
  };
  NX.currentTheme = () => NX.storage.get(NX.THEME_KEY, "dark");

  /* ---------------- eventos de rota ---------------- */
  NX.actions = {};
  NX.action = (name, fn) => {
    NX.actions[name] = fn;
  };

  /* ---------------- erros amigáveis ---------------- */
  NX.fail = (msg) => {
    const e = new Error(msg);
    e.friendly = true;
    return e;
  };

  NX.util = util;
})(window.NX);
