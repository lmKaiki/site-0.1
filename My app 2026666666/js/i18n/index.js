/* ============================================================
   NEXO · i18n — motor central de textos (PT-BR FIXO)
   ------------------------------------------------------------
   O Nexo existe SOMENTE em Português (Brasil):
   · não existe seletor de idioma, nem troca de idioma;
   · o único dicionário carregado é js/i18n/pt-BR.js;
   · data = DD/MM/AAAA e hora = HH:mm (24h) em toda a interface;
   · NX.i18n mantém a MESMA API pública de antes (get, t, has,
     keys, register, apply, reset, hydrate, audit…) para que
     nenhum chamador quebre — só que tudo aponta para pt-BR;
   · pedir outro idioma (NX.i18n.set/setLocale) é recusado com
     mensagem em português: não existe mais outro idioma.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const DEFAULT_LANG = "pt-BR";

  /* ---------------- idioma único ----------------
     Mantido como lista de UM elemento para as assinaturas
     públicas que ainda leem LANGS continuarem funcionando. */
  const LANGS = [
    { code: "pt-BR", label: "Português (Brasil)", native: "Português (Brasil)", flag: "br", locale: "pt-BR", dir: "ltr" }
  ];

  /* ---------------- dicionário ----------------
     Preenchido por js/i18n/pt-BR.js via register(). */
  const DICT = {};

  let cached = null;

  /* ---------------- normalização ----------------
     Só existe português: qualquer variante "pt*"/"pt-XX" vira
     pt-BR; qualquer outro código NÃO é aceito (retorna null),
     então é impossível colocar outro idioma na interface. */
  function normalize(code) {
    if (!code) return null;
    const raw = String(code).trim().toLowerCase().replace("_", "-");
    if (raw === "pt" || raw.indexOf("pt-") === 0) return DEFAULT_LANG;
    return null;
  }

  function langInfo() {
    return LANGS[0];
  }

  /* registro de dicionário: só o pt-BR é aceito */
  function register(code, dict) {
    const norm = normalize(code);
    if (norm !== DEFAULT_LANG) return null;
    const target = DICT[norm] || (DICT[norm] = {});
    Object.keys(dict || {}).forEach(function (k) {
      const v = dict[k];
      /* recusa lixo: nada de undefined/null/NaN no dicionário */
      if (v == null) return;
      const s = String(v);
      if (!s || s === "undefined" || s === "null" || s === "NaN") return;
      target[k] = s;
    });
    return norm;
  }

  const i18n = {};

  i18n.LANGS = LANGS;
  i18n.DICT = DICT;
  i18n.DEFAULT = DEFAULT_LANG;
  i18n.normalize = normalize;
  i18n.langInfo = langInfo;
  i18n.register = register;

  /* só português é idioma válido */
  i18n.isValid = function (code) {
    return !!normalize(code);
  };

  /* idioma vigente: SEMPRE pt-BR */
  i18n.current = function () {
    cached = DEFAULT_LANG;
    return cached;
  };

  /* apelidos pedidos pela API pública do Nexo */
  i18n.getLocale = function () {
    return i18n.current();
  };

  i18n.setLocale = function (code, opts) {
    return i18n.set(code, opts);
  };

  /* locale de dados/números para Intl (datas DD/MM/AAAA) */
  i18n.locale = function () {
    return DEFAULT_LANG;
  };

  i18n.langInfo = function () {
    return langInfo();
  };

  /* direção do texto: sempre da esquerda para a direita */
  i18n.dir = function () {
    return "ltr";
  };

  i18n.isRTL = function () {
    return false;
  };

  function interpolate(text, vars) {
    if (!vars) return text;
    Object.keys(vars).forEach(function (name) {
      text = text.split("{" + name + "}").join(String(vars[name]));
    });
    return text;
  }

  /* tradução com fallback seguro: pt-BR → texto padrão → chave.
     NUNCA aparece "undefined", "translation missing" ou chave
     exposta na tela. */
  i18n.get = function (key, fallback, vars) {
    const k = String(key == null ? "" : key);
    if (!k) return fallback == null ? "" : String(fallback);
    let text = DICT[DEFAULT_LANG] && DICT[DEFAULT_LANG][k];
    if (text == null || text === "") {
      if (fallback != null && fallback !== "") text = String(fallback);
      else text = k;
    }
    return interpolate(String(text), vars);
  };

  /* mesmo comportamento, mantido por compatibilidade com NX.t */
  i18n.t = function (key, vars) {
    return i18n.get(key, null, vars);
  };

  i18n.has = function (key) {
    const d = DICT[DEFAULT_LANG];
    return !!(d && d[String(key)] != null && d[String(key)] !== "");
  };

  i18n.keys = function () {
    return Object.keys(DICT[DEFAULT_LANG] || {});
  };

  /* ==========================================================
      AUDITORIA EM DESENVOLVIMENTO - NX.i18n.audit()
      ----------------------------------------------------------
      Com um idioma só, "tradução faltando" e "hardcoded" não
      existem mais; sobram as verificações de DOM úteis:
        broken  : undefined / null / NaN / "missing translation"
        exposed : chave técnica aparecendo na tela (a.b.c)
        braces  : {{variavel}} sem interpolação
      ========================================================== */
  i18n.audit = function (opts) {
    opts = opts || {};
    const locale = DEFAULT_LANG;
    const res = {
      locale: locale,
      fallback: [],
      hardcoded: [],
      broken: [],
      exposed: [],
      braces: [],
      missing: [],
      checked: 0,
    };

    if (typeof document === "undefined" || !document.body) return res;

    const BAD = /\b(undefined|NaN|missing translation|translation missing)\b/i;
    const EXPOSED = /^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/;
    const BRACES = /\{\{[a-zA-Z0-9_]+\}\}/;

    const USER_ZONE =
      ".msg__content,.message__content,.msg__body,.post__body,.comment__body," +
      ".bio,.profile-card__bio,.pp-bio,.dm__content,[data-user-content]," +
      "[data-username],.username,.user-name,.nick,.server-name,.channel-name,.mention";

    function push(arr, item) {
      if (arr.indexOf(item) === -1) arr.push(item);
    }

    function scan(node) {
      if (node.nodeType === 3) {
        const t = node.nodeValue;
        if (!t) return;
        const s = t.replace(/\s+/g, " ").trim();
        if (!s || s.length < 2 || /^\d+$/.test(s)) return;
        res.checked++;
        if (BAD.test(s)) push(res.broken, s);
        if (BRACES.test(s)) push(res.braces, s);
        if (s.length <= 120 && EXPOSED.test(s)) push(res.exposed, s);
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return;
      const isUser = node.matches && node.matches(USER_ZONE);
      if (!isUser) {
        ["placeholder", "title", "aria-label", "alt", "data-tooltip"].forEach(function (a) {
          if (!node.hasAttribute || !node.hasAttribute(a)) return;
          const v = (node.getAttribute(a) || "").replace(/\s+/g, " ").trim();
          if (!v || v.length < 2) return;
          res.checked++;
          if (BAD.test(v)) push(res.broken, v);
        });
      }
      for (let i = 0; i < node.childNodes.length; i++) scan(node.childNodes[i]);
    }

    if (!opts.skipDOM) scan(document.body);
    return res;
  };

  i18n.auditLog = function (opts) {
    const r = i18n.audit(opts);
    const bad = r.broken.length + r.exposed.length + r.braces.length;
    const info = {
      locale: r.locale,
      texto_verificado: r.checked,
      broken: r.broken.length,
      chaves_expostas: r.exposed.length
    };
    if (bad) {
      console.warn("[i18n.audit] PROBLEMAS", info);
      if (r.broken.length) console.warn("  broken:", r.broken.slice(0, 60));
      if (r.exposed.length) console.warn("  exposed:", r.exposed.slice(0, 60));
      if (r.braces.length) console.warn("  braces:", r.braces.slice(0, 60));
    } else {
      console.info("[i18n.audit] OK", info);
    }
    return r;
  };

  i18n.auditReset = function () {};

  /* ==========================================================
      HIDRATAÇÃO — elementos FORA do ciclo de render
      ----------------------------------------------------------
      O Nexo tem DUAS fontes de texto, e as duas passam pelo
      MESMO NX.i18n:

        1. views redesenhadas por route()  → NX.i18n.get("chave")
        2. elementos que NUNCA voltam a passar pelo template:
           o HTML estático do index.html (#rail, #members) e os
           overlays montados uma vez (busca global, notificações).

      O caso 2 carrega a CHAVE marcada no elemento:
        data-i18n="chave"                  → textContent
        data-i18n-attr="aria-label:chave"  → atributo
        data-i18n-attr="a:k;b:k2"          → vários, separados ;

      O marcador guarda SÓ a chave, nunca o texto — portanto não
      existe segunda fonte de texto: tudo sai de NX.i18n (pt-BR).
      ========================================================== */
  i18n.hydrate = function (root) {
    if (typeof document === "undefined") return 0;
    root = root || document;
    if (!root || !root.querySelectorAll) return 0;

    try {
      if (document.documentElement) {
        document.documentElement.lang = DEFAULT_LANG;
        document.documentElement.dir = "ltr";
      }
    } catch (e) {
      /* sem raiz */
    }

    let n = 0;
    let i;
    let el;

    const texts = root.querySelectorAll("[data-i18n]");
    for (i = 0; i < texts.length; i++) {
      el = texts[i];
      const key = el.getAttribute("data-i18n");
      if (!key) continue;
      if (!i18n.has(key)) console.warn("[I18N MISSING]", key, el);
      const val = i18n.get(key);
      if (el.textContent !== val) {
        el.textContent = val;
        n++;
      }
    }

    const attrs = root.querySelectorAll("[data-i18n-attr]");
    for (i = 0; i < attrs.length; i++) {
      el = attrs[i];
      const spec = el.getAttribute("data-i18n-attr") || "";
      const pairs = spec.split(";");
      for (let j = 0; j < pairs.length; j++) {
        const p = pairs[j].trim();
        if (!p) continue;
        const at = p.indexOf(":");
        if (at < 1) continue;
        const attr = p.slice(0, at).trim();
        const key = p.slice(at + 1).trim();
        if (!attr || !key) continue;
        if (!i18n.has(key)) console.warn("[I18N MISSING]", key, el);
        const val = i18n.get(key);
        if (el.getAttribute(attr) !== val) {
          el.setAttribute(attr, val);
          n++;
        }
      }
    }
    return n;
  };

  /* aplica o idioma na tela: <html lang|dir> + re-render do que
     estiver aberto. O parâmetro é ignorado — só existe pt-BR. */
  i18n.apply = function () {
    cached = DEFAULT_LANG;
    try {
      document.documentElement.lang = cached;
      document.documentElement.dir = "ltr";
    } catch (e) {
      /* sem DOM */
    }
    try {
      if (NX.bus && NX.bus.emit) NX.bus.emit("i18n:change", { lang: cached });
    } catch (e) {
      /* sem bus */
    }
    /* reaplica os elementos que ficam fora do route() — HTML
       estático e overlays montados uma vez (busca/notificações).
       Depois do emit para cobrir também o que o route criou. */
    try {
      i18n.hydrate(document);
    } catch (e) {
      /* sem DOM */
    }
    return cached;
  };

  /* troca de idioma: RECUSADA — o Nexo é somente pt-BR */
  i18n.set = function (code) {
    if (code && !normalize(code)) {
      return Promise.reject(
        new Error("Idioma não suportado. O Nexo está disponível apenas em Português (Brasil).")
      );
    }
    i18n.apply();
    return Promise.resolve({ lang: DEFAULT_LANG, persisted: false });
  };

  i18n.reset = function () {
    cached = null;
  };

  NX.i18n = i18n;
  NX.t = function (key, vars) {
    return i18n.get(key, null, vars);
  };

  /* limpa a preferência de idioma de versões antigas: a conta e
     este navegador passam a guardar somente pt-BR. */
  try {
    if (window.localStorage) window.localStorage.removeItem("nexo.lang");
  } catch (e) {
    /* storage bloqueado */
  }

  /* idioma inicial fixo */
  try {
    document.documentElement.lang = DEFAULT_LANG;
    document.documentElement.dir = "ltr";
  } catch (e) {
    /* boot antes do DOM */
  }
})(window.NX);
