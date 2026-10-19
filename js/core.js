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

  /* ---------------- tempo ----------------
     As datas gravadas nunca são alteradas: só a EXIBIÇÃO
     é convertida para o fuso escolhido pelo usuário. */
  const pad = (n) => String(n).padStart(2, "0");

  function userZone() {
    try {
      const me = NX.selectors && NX.selectors.me ? NX.selectors.me() : null;
      const tz = me && me.region ? me.region.timezone : null;
      if (tz && NX.region && NX.region.isValidZone(tz)) return tz;
    } catch (e) {
      /* sem conta/região: usa o fuso do aparelho */
    }
    return null;
  }
  util.userZone = userZone;

  /* ---------------- formato de tempo (FIXO 24h) ----------------
      Preferência única: HH:mm em 24h. */
  util.timeFormat = function () {
    return "24h";
  };
  util.is12h = function () {
    return false;
  };

  /* opções de hora: sempre 24h */
  util.hourOpts = function () {
    return { hour: "2-digit", minute: "2-digit", hour12: false };
  };

  /* só o horário, em HH:mm (24h) */
  util.formatTime = function (value, opts) {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return "";
    const loc = NX.i18n && NX.i18n.locale ? NX.i18n.locale() : "pt-BR";
    const o = Object.assign({}, opts || {}, util.hourOpts());
    try {
      return new Intl.DateTimeFormat(loc, o).format(d);
    } catch (e) {
      return pad(d.getHours()) + ":" + pad(d.getMinutes());
    }
  };

  /* data (sem hora) — padrão FIXO DD/MM/AAAA, sem depender do
     estilo padrão do locale do navegador */
  const DATE_OPTS = { day: "2-digit", month: "2-digit", year: "numeric" };
  util.DATE_OPTS = DATE_OPTS;
  util.formatDate = function (value, opts) {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return "";
    const loc = NX.i18n && NX.i18n.locale ? NX.i18n.locale() : "pt-BR";
    const o = opts || DATE_OPTS;
    try {
      return new Intl.DateTimeFormat(loc, o).format(d);
    } catch (e) {
      return d.toLocaleDateString(loc, o);
    }
  };

  util.formatDateTime = function (value, dateOpts, timeOpts) {
    const d = value instanceof Date ? value : new Date(value);
    const date = util.formatDate(d, dateOpts);
    const time = util.formatTime(d, timeOpts);
    return date && time ? date + " " + time : date || time;
  };

  util.fmtTime = (ts) => {
    const tz = userZone();
    if (tz && NX.region) {
      return NX.region.fmtHM(ts, tz, NX.i18n ? NX.i18n.locale() : "pt-BR");
    }
    return util.formatTime(ts);
  };

  util.sameDay = (a, b) => {
    const tz = userZone();
    if (tz && NX.region) {
      const x = NX.region.dayParts(a, tz);
      const y = NX.region.dayParts(b, tz);
      return x.y === y.y && x.m === y.m && x.d === y.d;
    }
    const x = new Date(a),
      y = new Date(b);
    return (
      x.getFullYear() === y.getFullYear() &&
      x.getMonth() === y.getMonth() &&
      x.getDate() === y.getDate()
    );
  };

  util.fmtDayLabel = (ts) => {
    const tz = userZone();
    const locale = NX.i18n ? NX.i18n.locale() : "pt-BR";
    const t = (k, fb) => (NX.t ? NX.t(k) : fb);
    const now = Date.now();
    if (util.sameDay(ts, now)) return t("time.today", (NX.i18n.get("time.today", "Hoje")));
    const yesterday = now - 24 * 60 * 60 * 1000;
    if (util.sameDay(ts, yesterday)) return t("time.yesterday", (NX.i18n.get("time.yesterday", "Ontem")));
    /* dia anterior: sempre DD/MM/AAAA */
    return NX.region
      ? NX.region.fmt(ts, tz, { day: "2-digit", month: "2-digit", year: "numeric" }, locale)
      : new Date(ts).toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  /* tempo relativo: Intl.RelativeTimeFormat localiza sozinho
      (pt "há 5 min") — sem texto manual */
  util.timeAgo = (ts) => {
    const locale = NX.i18n ? NX.i18n.locale() : "pt-BR";
    const t = (k, fb) => (NX.t ? NX.t(k) : fb);
    const diff = Number(ts);
    if (!isFinite(diff)) return "";
    const past = diff < Date.now();
    const sec = Math.round(Math.abs(Date.now() - diff) / 1000);
    try {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      const p = past ? -1 : 1;
      if (sec < 60) return t("time.now", NX.i18n.get("time.now", "agora há pouco"));
      if (sec < 3600) return rtf.format(p * Math.round(sec / 60), "minute");
      if (sec < 86400) return rtf.format(p * Math.round(sec / 3600), "hour");
      if (sec < 2592000) return rtf.format(p * Math.round(sec / 86400), "day");
      if (sec < 31536000) return rtf.format(p * Math.round(sec / 2592000), "month");
      return rtf.format(p * Math.round(sec / 31536000), "year");
    } catch (e) {
      /* navegador sem RelativeTimeFormat: mantém o texto em pt-BR */
      const m = Math.floor(sec / 60);
      if (m < 60) return NX.i18n.get("core.ha", "há") + " " + m + " min";
      const h = Math.floor(m / 60);
      if (h < 24) return NX.i18n.get("core.ha", "há") + " " + h + " h";
      const d = Math.floor(h / 24);
      if (d === 1) return t("time.yesterday", "ontem");
      if (d < 30) return NX.i18n.get("core.ha", "há") + " " + d + " " + NX.i18n.get("core.dias", "dias");
      return (
        (past ? NX.i18n.get("core.ha", "há") : NX.i18n.get("time.in", "em")) +
        " " +
        util.formatDate(ts)
      );
    }
  };

  util.ageFrom = (birth) => {
    if (!birth) return null;
    const b = new Date(birth + (NX.i18n.get("core.t000000", "T00:00:00")));
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
      .normalize((NX.i18n.get("core.nfd", "NFD")))
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
      .normalize((NX.i18n.get("core.nfd", "NFD")))
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
  util.usernameOk = (v) => /^[a-z0-9._]{3,18}$/i.test(String(v || "").trim());

  /* Username canônico da Nexo — usado NO CADASTRO, NO LOGIN e em
     toda busca por username (uma única regra, nunca duas fontes):
       1. remove caracteres invisíveis;
       2. remove espaços do início e do fim;
       3. minúsculas (OSAK = osak = Osak → a mesma conta).
     O resultado continua sendo validado por util.usernameOk. */
  util.normalizeUsername = function (v) {
    return String(v || "")
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      .trim()
      .toLowerCase();
  };

  /* número no padrão brasileiro (1.240) — estatísticas do perfil */
  util.num = function (n) {
    const v = Math.max(0, Number(n) || 0);
    try {
      return v.toLocaleString(NX.i18n && NX.i18n.locale ? NX.i18n.locale() : "pt-BR");
    } catch (e) {
      return String(v);
    }
  };

  util.PASSWORD_RULES = [
    { key: "len", label: NX.i18n.get("core.8CaracteresMais", "8 caracteres ou mais"), test: (v) => v.length >= 8 },
    { key: "letter", label: NX.i18n.get("core.1Letra", "1 letra"), test: (v) => /[a-zA-ZÀ-ÿ]/.test(v) },
    { key: "digit", label: NX.i18n.get("core.1Numero", "1 número"), test: (v) => /[0-9]/.test(v) },
  ];

  util.passwordPolicy = function (v) {
    const val = String(v || "");
    const checks = util.PASSWORD_RULES.map((r) => ({ key: r.key, label: r.label, ok: r.test(val) }));
    const ok = checks.every((c) => c.ok);
    return {
      ok: ok,
      checks: checks,
      message:
        (NX.i18n.get("core.asenhaprecisadenominimo", "A senha precisa de no mínimo 8 caracteres, com pelo menos uma letra e um número.")),
    };
  };

  util.passwordOk = (v) => util.passwordPolicy(v).ok;

  /* normaliza o identificador digitado (nome de usuário ou @usuário)
     — mesma regra do cadastro, para login e cadastro baterem sempre */
  util.normalizeIdentifier = function (v) {
    return util.normalizeUsername(String(v || "").replace(/^@/, ""));
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
        NX.storage.lastError = NX.i18n.get("core.armazenamentoIndisponivel", "armazenamento indisponível");
        return false;
      }
      try {
        localStorage.setItem(key, JSON.stringify(value));
        NX.storage.lastError = null;
        return true;
      } catch (e) {
        NX.storage.lastError = (e && (e.name || e.code)) || NX.i18n.get("core.erroGravacao", "erro de gravação");
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
    { key: "administrator", label: (NX.i18n.get("adm.administrador", "Administrador")), desc: NX.i18n.get("core.controleTotalSobreServidor", "Controle total sobre o servidor."), group: (NX.i18n.get("core.geral", "Geral")), super: true },
    { key: "manageServer", label: NX.i18n.get("core.gerenciarServidor", "Gerenciar servidor"), desc: NX.i18n.get("core.editarNomeIconeBanner", "Editar nome, ícone, banner e descrição."), group: (NX.i18n.get("core.geral", "Geral")) },
    { key: "manageRoles", label: NX.i18n.get("core.gerenciarCargos", "Gerenciar cargos"), desc: NX.i18n.get("core.criarEditarApagarCargos", "Criar, editar e apagar cargos e permissões."), group: (NX.i18n.get("core.geral", "Geral")) },
    { key: "manageChannels", label: NX.i18n.get("core.gerenciarCanais", "Gerenciar canais"), desc: NX.i18n.get("core.criarEditarApagarCategorias", "Criar, editar e apagar categorias e canais."), group: (NX.i18n.get("core.geral", "Geral")) },
    { key: "manageMembers", label: NX.i18n.get("core.gerenciarMembros", "Gerenciar membros"), desc: NX.i18n.get("core.verDetalhesAlterarCargos", "Ver detalhes e alterar cargos de membros."), group: (NX.i18n.get("core.geral", "Geral")) },
    { key: "createInvite", label: NX.i18n.get("core.criarConvites", "Criar convites"), desc: NX.i18n.get("core.gerarLinksConviteServidor", "Gerar links de convite para o servidor."), group: (NX.i18n.get("core.geral", "Geral")) },
    { key: "viewLogs", label: NX.i18n.get("core.verLogs", "Ver logs"), desc: NX.i18n.get("core.consultarHistoricoModeracao", "Consultar o histórico de moderação."), group: (NX.i18n.get("core.geral", "Geral")) },

    /* Chat */
    { key: "viewChannels", label: NX.i18n.get("core.verCanais", "Ver canais"), desc: NX.i18n.get("core.visualizarCanaisTextoVoz", "Visualizar canais de texto e voz."), group: (NX.i18n.get("core.chat", "Chat")) },
    { key: "sendMessages", label: NX.i18n.get("core.enviarMensagens", "Enviar mensagens"), desc: NX.i18n.get("core.escreverCanaisTexto", "Escrever nos canais de texto."), group: (NX.i18n.get("core.chat", "Chat")) },
    { key: "editMessages", label: NX.i18n.get("core.editarMensagens", "Editar mensagens"), desc: NX.i18n.get("core.editarMensagensOutrasPessoas", "Editar mensagens de outras pessoas."), group: (NX.i18n.get("core.chat", "Chat")) },
    { key: "deleteMessages", label: NX.i18n.get("core.excluirMensagens", "Excluir mensagens"), desc: NX.i18n.get("core.apagarMensagensOutrasPessoas", "Apagar mensagens de outras pessoas."), group: (NX.i18n.get("core.chat", "Chat")) },
    { key: "pinMessages", label: NX.i18n.get("core.fixarMensagens", "Fixar mensagens"), desc: NX.i18n.get("core.fixarMensagensCanal", "Fixar mensagens no canal."), group: (NX.i18n.get("core.chat", "Chat")) },
    { key: "attachFiles", label: NX.i18n.get("core.anexarArquivos", "Anexar arquivos"), desc: NX.i18n.get("core.enviarImagensVideosArquivos", "Enviar imagens, vídeos e arquivos."), group: (NX.i18n.get("core.chat", "Chat")) },
    { key: "useEmojis", label: NX.i18n.get("core.usarEmojis", "Usar emojis"), desc: NX.i18n.get("core.reagirUsarEmojisMensagens", "Reagir e usar emojis nas mensagens."), group: (NX.i18n.get("core.chat", "Chat")) },
    { key: "useCustomEmojis", label: NX.i18n.get("core.usarEmojisPersonalizados", "Usar emojis personalizados"), desc: NX.i18n.get("core.usarEmojisServidor", "Usar os emojis do servidor."), group: (NX.i18n.get("core.chat", "Chat")) },
    { key: "useGifs", label: NX.i18n.get("core.usarGifs", "Usar GIFs"), desc: NX.i18n.get("core.enviarGifsConversas", "Enviar GIFs nas conversas."), group: (NX.i18n.get("core.chat", "Chat")) },
    { key: "mentionEveryone", label: NX.i18n.get("core.mencionarMembros", "Mencionar membros"), desc: NX.i18n.get("core.usarEveryoneMencoesMassa", "Usar @everyone e menções em massa."), group: (NX.i18n.get("core.chat", "Chat")) },

    /* Moderação */
    { key: "kickMembers", label: NX.i18n.get("core.expulsarMembros", "Expulsar membros"), desc: NX.i18n.get("core.removerAlguemServidorPode", "Remover alguém do servidor (pode voltar)."), group: (NX.i18n.get("adm.moderacao", "Moderação")) },
    { key: "banMembers", label: NX.i18n.get("core.banirMembros", "Banir membros"), desc: NX.i18n.get("core.bloquearEntradaAlguemServidor", "Bloquear a entrada de alguém no servidor."), group: (NX.i18n.get("adm.moderacao", "Moderação")) },
    { key: "unbanMembers", label: NX.i18n.get("core.desbanirMembros", "Desbanir membros"), desc: NX.i18n.get("core.removerAlguemListaBanidos", "Remover alguém da lista de banidos."), group: (NX.i18n.get("adm.moderacao", "Moderação")) },
    { key: "timeoutMembers", label: NX.i18n.get("core.silenciarMembros2", "Silenciar membros"), desc: NX.i18n.get("core.impedirAlguemEnviarMensagens", "Impedir alguém de enviar mensagens."), group: (NX.i18n.get("adm.moderacao", "Moderação")) },

    /* Voz */
    { key: "joinVoice", label: (NX.i18n.get("core.conectar", "Conectar")), desc: NX.i18n.get("core.entrarCanaisVoz", "Entrar em canais de voz."), group: (NX.i18n.get("adm.voz", "Voz")) },
    { key: "inviteToVoice", label: NX.i18n.get("core.convidarPessoasChamadas", "Convidar pessoas para chamadas"), desc: NX.i18n.get("core.enviarConvitesEntrarSala", "Enviar convites para entrar na sala de voz."), group: (NX.i18n.get("adm.voz", "Voz")) },
    { key: "speak", label: (NX.i18n.get("core.falar", "Falar")), desc: NX.i18n.get("core.falarCanaisVoz", "Falar nos canais de voz."), group: (NX.i18n.get("adm.voz", "Voz")) },
    { key: "muteMembers", label: NX.i18n.get("core.silenciarMembros2", "Silenciar membros"), desc: NX.i18n.get("core.silenciarAlguemVoz", "Silenciar alguém na voz."), group: (NX.i18n.get("adm.voz", "Voz")) },
    { key: "deafenMembers", label: NX.i18n.get("core.ensurdecerMembros", "Ensurdecer membros"), desc: NX.i18n.get("core.ensurdecerAlguemVoz", "Ensurdecer alguém na voz."), group: (NX.i18n.get("adm.voz", "Voz")) },
    { key: "moveMembers", label: NX.i18n.get("core.moverMembros", "Mover membros"), desc: NX.i18n.get("core.moverAlguemEntreCanais", "Mover alguém entre canais de voz."), group: (NX.i18n.get("adm.voz", "Voz")) },
  ];

  NX.PERM_KEYS = NX.PERMS.map((p) => p.key);

  /* permissões LIGADAS por padrão: valem mesmo em cargos antigos que
     foram criados antes da chave existir (o dono e quem tem admin
     continuam podendo desligar na tela de cargos) */
  NX.DEFAULT_ON_PERMS = ["inviteToVoice"];

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
    "inviteToVoice",
    "speak",
  ];

  NX.defaultPerms = (preset) => {
    const out = {};
    NX.PERM_KEYS.forEach((k) => (out[k] = false));
    NX.DEFAULT_ON_PERMS.forEach((k) => (out[k] = true));
    (preset || NX.BASE_PERMS).forEach((k) => {
      if (out[k] !== undefined) out[k] = true;
    });
    return out;
  };

  /* rótulos amigáveis para ações de log */
  NX.LOG_ACTIONS = {
    "member.join": NX.i18n.get("core.membroEntrou", "Membro entrou"),
    "member.leave": NX.i18n.get("core.membroSaiu", "Membro saiu"),
    "member.kick": NX.i18n.get("core.membroFoiExpulso", "Membro foi expulso"),
    "member.ban": NX.i18n.get("core.membroFoiBanido", "Membro foi banido"),
    "member.unban": NX.i18n.get("core.membroFoiDesbanido", "Membro foi desbanido"),
    "member.role": NX.i18n.get("core.cargoAlterado2", "Cargo alterado"),
    "member.nick": NX.i18n.get("core.apelidoAlterado", "Apelido alterado"),
    "role.create": NX.i18n.get("core.cargoCriado", "Cargo criado"),
    "role.update": NX.i18n.get("core.cargoAlterado2", "Cargo alterado"),
    "role.delete": NX.i18n.get("core.cargoExcluido", "Cargo excluído"),
    "channel.create": NX.i18n.get("core.canalCriado", "Canal criado"),
    "channel.update": NX.i18n.get("core.canalAlterado", "Canal alterado"),
    "channel.delete": NX.i18n.get("core.canalExcluido", "Canal excluído"),
    "category.create": NX.i18n.get("core.categoriaCriada", "Categoria criada"),
    "category.update": NX.i18n.get("core.categoriaAlterada", "Categoria alterada"),
    "category.delete": NX.i18n.get("core.categoriaExcluida", "Categoria excluída"),
    "message.delete": NX.i18n.get("core.mensagemExcluida", "Mensagem excluída"),
    "message.pin": NX.i18n.get("core.mensagemFixada", "Mensagem fixada"),
    "server.update": NX.i18n.get("core.configuracaoAlterada", "Configuração alterada"),
    "invite.create": NX.i18n.get("core.conviteCriado", "Convite criado"),
    "invite.revoke": NX.i18n.get("core.conviteRevogado", "Convite revogado"),
    "emoji.create": NX.i18n.get("core.emojiAdicionado", "Emoji adicionado"),
    "emoji.delete": NX.i18n.get("core.emojiRemovido", "Emoji removido"),
    "ownership.transfer": NX.i18n.get("core.propriedadeTransferida", "Propriedade transferida"),
  };

  /* rótulos de status resolvidos A CADA leitura → trocam de idioma na hora */
  NX.STATUS_LABEL = {};
  (function () {
    var defs = [
      ["online", "core.statusOnline", "Online"],
      ["idle", "core.ausente", "Ausente"],
      ["dnd", "core.naoPerturbe", "Não perturbe"],
      ["offline", "core.statusOffline", "Offline"],
    ];
    defs.forEach(function (d) {
      Object.defineProperty(NX.STATUS_LABEL, d[0], {
        enumerable: true,
        configurable: true,
        get: function () {
          return NX.i18n.get(d[1], d[2]);
        },
      });
    });
  })();

  /* Estruturas iniciais oferecidas na criação de servidor */
  /* name/desc/cats[].name são GETTERS: resolvidos a cada leitura,
     então trocar o idioma atualiza o modal de criação na hora */
  NX.TEMPLATES = [
    {
      id: "comunidade",
      get name() { return NX.i18n.get("core.comunidade", "Comunidade"); },
      emoji: "🌐",
      get desc() { return NX.i18n.get("core.informacoesConversaSuporteVoz", "Informações, conversa, suporte e voz."); },
      cats: [
        { get name() { return NX.i18n.get("core.informacoes", "INFORMAÇÕES"); }, channels: [["boas-vindas", "text"], ["regras", "text"]] },
        { get name() { return NX.i18n.get("core.comunidade2", "COMUNIDADE"); }, channels: [["geral", "text"], ["memes", "text"], ["novidades", "text"]] },
        { get name() { return NX.i18n.get("core.suporte", "SUPORTE"); }, channels: [["ajuda", "text"], ["chamados", "text"]] },
        { get name() { return NX.i18n.get("core.voz", "VOZ"); }, channels: [[NX.i18n.get("core.salaGeral", "Sala Geral"), "voice"], [(NX.i18n.get("core.jogatina", "Jogatina")), "voice"]] },
      ],
    },
    {
      id: "estudo",
      get name() { return NX.i18n.get("core.grupoEstudo", "Grupo de estudo"); },
      emoji: "📚",
      get desc() { return NX.i18n.get("core.materialDuvidasSessoesVivo", "Material, dúvidas e sessões ao vivo."); },
      cats: [
        { get name() { return NX.i18n.get("core.estudo", "ESTUDO"); }, channels: [["geral", "text"], ["materiais", "text"], [(NX.i18n.get("core.duvidas", "dúvidas")), "text"]] },
        { get name() { return NX.i18n.get("core.encontros", "ENCONTROS"); }, channels: [[NX.i18n.get("core.salaEstudo", "Sala de Estudo"), "voice"]] },
      ],
    },
    {
      id: "jogos",
      get name() { return NX.i18n.get("core.squadJogos", "Squad de jogos"); },
      emoji: "🎮",
      get desc() { return NX.i18n.get("core.lobbyAvisosSalasVoz", "Lobby, avisos e salas de voz."); },
      cats: [
        { get name() { return NX.i18n.get("core.lobby", "LOBBY"); }, channels: [["geral", "text"], ["combos", "text"]] },
        { get name() { return NX.i18n.get("core.partidas", "PARTIDAS"); }, channels: [[NX.i18n.get("core.sala1", "Sala 1"), "voice"], [NX.i18n.get("core.sala2", "Sala 2"), "voice"]] },
      ],
    },
    {
      id: "dev",
      get name() { return NX.i18n.get("core.timeDev", "Time de dev"); },
      emoji: "🛠️",
      get desc() { return NX.i18n.get("core.sprintsBugsDeploy", "Sprints, bugs e deploy."); },
      cats: [
        { get name() { return NX.i18n.get("core.projeto", "PROJETO"); }, channels: [["geral", "text"], ["bugs", "text"], ["releases", "text"]] },
        { get name() { return NX.i18n.get("core.reunioes", "REUNIÕES"); }, channels: [[(NX.i18n.get("core.call", "Call")), "voice"]] },
      ],
    },
    {
      id: "vazio",
      get name() { return NX.i18n.get("core.comecarZero", "Começar do zero"); },
      emoji: "✨",
      get desc() { return NX.i18n.get("core.categoriaCanalRestoSeu", "Uma categoria, um canal. O resto é seu."); },
      cats: [{ get name() { return NX.i18n.get("core.geral2", "GERAL"); }, channels: [["geral", "text"]] }],
    },
  ];


  NX.THEME_KEY = "nexo.theme";
  NX.applyTheme = (theme) => {
    const t = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    NX.storage.set(NX.THEME_KEY, t);
  };
  NX.currentTheme = () => NX.storage.get(NX.THEME_KEY, "dark");

  /* ---------------- modo de demonstração (DEMO_MODE) ----------------
     DEMO_MODE = false (PADRÃO / PRODUÇÃO):
       · o seed NÃO roda — nenhum servidor, usuário, mensagem, amigo,
         seguidor, curtida ou notificação fictício é criado;
       · dados fictícios de versões antigas são apagados no carregamento
         (store.purgeDemo) — contas e servidores REAIS nunca são tocados.
     DEMO_MODE = true (só dev/protótipo, ligado explicitamente com
       NX.setDemoMode(true) ou window.NEXO_DEMO_MODE = true):
       · o seed cria os dados de demonstração para explorar a interface.
     Nada real é apagado ao trocar de modo. */
  NX.DEMO_KEY = "nx.demo_mode";
  NX.demoMode = () => {
    if (window.NEXO_DEMO_MODE === true) return true;
    if (window.NEXO_DEMO_MODE === false) return false;
    try {
      return NX.storage.get(NX.DEMO_KEY, "off") === "on";
    } catch (e) {
      return false; /* produção por padrão */
    }
  };
  NX.setDemoMode = (on) => {
    try {
      NX.storage.set(NX.DEMO_KEY, on ? "on" : "off");
    } catch (e) {}
    NX.DEMO_MODE = !!on;
    window.NEXO_DEMO_MODE = !!on;
  };
  NX.DEMO_MODE = NX.demoMode();

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

  /* API pública de tempo — a ÚNICA porta de formatação de horário.
      O formato é fixo: DD/MM/AAAA + HH:mm (24h). */
  NX.time = {
    get: function () {
      return util.timeFormat();
    },
    is12h: function () {
      return util.is12h();
    },
    format: function (value, opts) {
      return util.formatTime(value, opts);
    },
    date: function (value, opts) {
      return util.formatDate(value, opts);
    },
    dateTime: function (value, dateOpts, timeOpts) {
      return util.formatDateTime(value, dateOpts, timeOpts);
    },
    hourOpts: function () {
      return util.hourOpts();
    },
  };

  if (NX.i18n) {
    NX.i18n.formatTime = function (value, opts) {
      return util.formatTime(value, opts);
    };
    NX.i18n.formatDate = function (value, opts) {
      return util.formatDate(value, opts);
    };
  }
})(window.NX);
