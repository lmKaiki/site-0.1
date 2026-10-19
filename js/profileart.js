/* ============================================================
   NEXO · profileart
   A logo oficial do Nexo em SVG.

   · NX.logo    — a ÚNICA marca do Nexo, desenhada aqui (original,
                  vetorial, sem emoji do sistema e sem imagem de
                  terceiros). É o avatar padrão de toda conta nova
                  e volta a aparecer quando a pessoa remove a foto.
   · NX.avatarArt — casca compatível com o resto do app: todos os
                  lugares que pedem "render" recebem a logo. Não
                  existe mais galeria de modelos.
   · NX.banner  — lê, valida e DESENHA o banner de perfil. É
                  gratuito para toda conta: não pede assinatura,
                  moedas nem nível. Aceita string (data URL antiga)
                  ou objeto { src, x, y, zoom }: o enquadramento vai
                  junto com a imagem, então sobrevive a F5 e a login.

   Nada aqui cria dados de demonstração: é vetor puro.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  /* ---------------- utilidades de cor ---------------- */
  function safeColor(c, fallback) {
    const s = String(c || "").trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : fallback;
  }

  function hex2rgb(c) {
    let s = String(c).replace("#", "");
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  function rgb2hex(r, g, b) {
    const p = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return "#" + p(r) + p(g) + p(b);
  }

  /* mistura `c` com `target` na proporção t (0..1) */
  function mix(c, target, t) {
    const a = hex2rgb(safeColor(c, "#35e0a8"));
    const b = hex2rgb(safeColor(target, "#06170f"));
    return rgb2hex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  }

  /* ============================================================
     1 · A LOGO OFICIAL DO NEXO
     ============================================================ */

  /* ids de gradiente únicos: `url(#…)` vale para o documento inteiro,
     então cada instância precisa do seu próprio id — senão todos os
     avatares pegariam o gradiente do primeiro da tela. */
  let seq = 0;
  function uid(prefix) {
    seq = (seq + 1) % 1000000;
    return prefix + seq;
  }

  /* A marca: placa arredondada com o gradiente do Nexo e o "N"
     desenhado com traço grosso e pontas arredondadas, com um nó
     (node) no topo do traço direito — a ideia de conexão. */
  function logoSVG() {
    const g = uid("nxg");
    const shine = uid("nxsh");
    return (
      '<svg viewBox="0 0 64 64" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" ' +
      'focusable="false" aria-hidden="true">' +
      "<defs>" +
      '<linearGradient id="' + g + '" x1="6" y1="2" x2="58" y2="62" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0" stop-color="#4bf0bb"/>' +
      '<stop offset=".52" stop-color="#22cdb0"/>' +
      '<stop offset="1" stop-color="#12a0c4"/>' +
      "</linearGradient>" +
      '<linearGradient id="' + shine + '" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0" stop-color="#ffffff" stop-opacity=".26"/>' +
      '<stop offset=".55" stop-color="#ffffff" stop-opacity="0"/>' +
      "</linearGradient>" +
      "</defs>" +
      '<rect width="64" height="64" rx="18" fill="url(#' + g + ')"/>' +
      '<rect width="64" height="64" rx="18" fill="url(#' + shine + ')"/>' +
      '<g fill="none" stroke="#04150f" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round" opacity=".9">' +
      '<path d="M20 46V19"/>' +
      '<path d="M20 19 44 45"/>' +
      '<path d="M44 45V19"/>' +
      "</g>" +
      '<circle cx="44" cy="17.6" r="4.6" fill="#04150f" opacity=".9"/>' +
      '<circle cx="20" cy="47.4" r="2.6" fill="#ffffff" opacity=".85"/>' +
      "</svg>"
    );
  }

  /* casca compatível: o app inteiro continua chamando
     NX.avatarArt.render(...) e recebe sempre a logo oficial. */
  function render() {
    return logoSVG();
  }

  function thumb() {
    return '<span class="arm-art" aria-hidden="true">' + logoSVG() + "</span>";
  }

  NX.logo = {
    html: logoSVG,
    url: function () {
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(logoSVG());
    },
  };

  NX.avatarArt = {
    /* não existe mais galeria de modelos: só a logo */
    models: function () {
      return [];
    },
    has: function () {
      return false;
    },
    /* usuário novo não recebe "model": a logo é o fallback universal */
    forKey: function () {
      return null;
    },
    render: render,
    thumb: thumb,
    secondTone: function (base) {
      return mix(base || "#35e0a8", "#06170f", 0.18);
    },
    mix: mix,
    safeColor: safeColor,
  };

  /* ============================================================
     2 · BANNERS (apenas compatibilidade de dados antigos)
     ============================================================ */

  const LIMITS = {
    imageChars: 1400000,
    svgChars: 60000,
    videoChars: 2400000,
    videoSeconds: 10,
    videoBytes: 1700000,
    videoTypes: ["video/mp4", "video/webm", "video/ogg"],
    videoExt: /\.(mp4|webm|ogv|ogg)$/i,
  };

  /* número preso entre limites (aceita string vinda do JSON) */
  function clampNum(v, min, max, dflt) {
    const n = typeof v === "number" ? v : parseFloat(v);
    if (!isFinite(n)) return dflt;
    return Math.min(max, Math.max(min, n));
  }

  /* o campo aceita string (dado antigo, já gravado) ou objeto com o
     enquadramento. Nos dois casos devolve o mesmo formato pronto
     para desenhar: { src, x, y, zoom }. */
  function parse(value) {
    if (!value) return null;
    if (typeof value === "string")
      return value ? { src: value, x: 0, y: 0, zoom: 1 } : null;
    if (typeof value !== "object" || Array.isArray(value)) return null;
    const src = typeof value.src === "string" ? value.src : "";
    if (!src) return null;
    return {
      src: src,
      x: clampNum(value.x, -50, 50, 0),
      y: clampNum(value.y, -50, 50, 0),
      zoom: clampNum(value.zoom, 1, 3, 1),
    };
  }

  /* SÓ data: entra na tela. Nenhuma URL externa é buscada pelo
     perfil — o banner não vira alvo de rastreamento. */
  function kindOf(value) {
    const b = parse(value);
    if (!b || !/^data:/i.test(b.src)) return "none";
    if (/^data:video\//i.test(b.src)) return "video";
    if (/^data:image\/gif/i.test(b.src)) return "gif";
    if (/^data:image\/svg/i.test(b.src)) return "svg";
    return "image";
  }

  /* enquadramento: mesmos números que os controles do editor,
     aplicados como transform para o GIF continuar animado */
  function transformOf(b) {
    if (!b) return "";
    const t = [];
    if (b.x) t.push("translateX(" + b.x + "%)");
    if (b.y) t.push("translateY(" + b.y + "%)");
    if (b.zoom && b.zoom !== 1) t.push("scale(" + b.zoom + ")");
    return t.join(" ");
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  /* mesma regra do servidor (server/handlers/auth.js): devolve a
     mensagem de erro ou null. Aceita string e o objeto {src,...}. */
  function validate(value) {
    if (value === null || value === undefined || value === "") return null;
    let v = value;
    if (typeof v === "object" && !Array.isArray(v)) v = v.src;
    if (typeof v !== "string" || !v) return "Banner inválido.";
    if (/^data:video\//i.test(v)) {
      if (!/^data:video\/(mp4|webm|ogg|x-m4v);base64,[A-Za-z0-9+/=]+$/i.test(v))
        return "Formato de vídeo não suportado. Use MP4 (H.264) ou WebM.";
      if (v.length > LIMITS.videoChars)
        return "Este vídeo é grande demais. Use um arquivo de até 1,7 MB e 10 segundos.";
      return null;
    }
    if (/^data:image\/svg\+xml/i.test(v)) {
      if (v.length > LIMITS.svgChars) return "Modelo de banner inválido.";
      let d = "";
      try {
        d = decodeURIComponent(v.replace(/^data:image\/svg\+xml;charset=utf-8,/i, ""));
      } catch (e) {
        return "Modelo de banner inválido.";
      }
      if (/<script|<foreignObject|javascript:|\son[a-z]+\s*=/i.test(d)) return "Modelo de banner inválido.";
      return null;
    }
    if (/^data:image\//i.test(v)) {
      if (!/^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=]+$/i.test(v))
        return "Envie uma imagem JPG, PNG, WebP ou GIF.";
      if (v.length > LIMITS.imageChars)
        return "Este banner é grande demais. Use uma imagem com até 1,4 MB.";
      return null;
    }
    return "Banner inválido.";
  }

  /* fundo padrão do Nexo: gradiente no tom do perfil + brilhos.
     É o que aparece quando a pessoa ainda não enviou um banner. */
  function defaultHTML() {
    return (
      '<div class="pp-banner pp-banner--grad">' +
        '<span class="pp-banner__glow pp-banner__glow--a"></span>' +
        '<span class="pp-banner__glow pp-banner__glow--b"></span>' +
      "</div>"
    );
  }

  function html(value) {
    const kind = kindOf(value);
    if (kind === "none") return defaultHTML();
    const b = parse(value);
    const tr = transformOf(b);
    const style = tr ? ' style="transform:' + tr + '"' : "";
    /* o gradiente fica ATRÁS da imagem: arquivo que não carregar
       nunca deixa um buraco no perfil */
    const head = '<div class="pp-banner pp-banner--grad">';
    if (kind === "video") {
      /* dado antigo: vídeo embutido, sem som e em laço. A interface
         não aceita novos vídeos — o editor é de imagem e GIF. */
      return (
        head +
        '<video class="pp-banner__img" data-banner-fb src="' +
        esc(b.src) +
        '" autoplay loop muted playsinline preload="metadata"' +
        style +
        "></video></div>"
      );
    }
    return (
      head +
      '<img class="pp-banner__img" data-banner-fb src="' +
      esc(b.src) +
      '" alt="" loading="lazy"' +
      style +
      "></div>"
    );
  }

  /* aplica num elemento de pré-visualização (editor de perfil) */
  function paint(el, value) {
    if (!el || !el.style || !el.querySelector) return;
    const kind = kindOf(value);
    const b = kind === "none" || kind === "video" ? null : parse(value);
    let img = el.querySelector("[data-banner-img]");
    if (!b) {
      if (img) img.hidden = true;
      el.classList.remove("is-img");
      return;
    }
    if (!img) {
      img = document.createElement("img");
      img.className = "pp-banner__img";
      img.setAttribute("data-banner-img", "");
      img.setAttribute("data-banner-fb", "");
      img.alt = "";
      el.appendChild(img);
    }
    img.hidden = false;
    if (img.getAttribute("src") !== b.src) img.src = b.src;
    img.style.transform = transformOf(b);
    el.classList.add("is-img");
  }

  NX.banner = {
    limits: LIMITS,
    validate: validate,
    parse: parse,
    kindOf: kindOf,
    transform: transformOf,
    html: html,
    paint: paint,
    /* o editor NÃO aceita novos vídeos (imagem e GIF primeiro);
       dados de vídeo antigos continuam sendo exibidos por html() */
    canPlayVideo: function () {
      return false;
    },
  };

  /* ============================================================
     3 · FOTO QUEBRA → VOLTA PARA A LOGO
     Uma foto que não carrega (arquivo perdido, data URL corrompida,
     rede caindo) nunca pode virar avatar quebrado: na fase de
     captura trocamos a <img> pela logo oficial do Nexo.
     ============================================================ */
  let wired = false;
  function wireImageFallback() {
    if (wired || typeof document === "undefined" || !document.addEventListener) return;
    wired = true;
    /* error NÃO borbulha: só a fase de captura enxerga */
    document.addEventListener(
      "error",
      function (e) {
        const img = e.target;
        if (!img || !img.hasAttribute) return;
        /* banner quebrado (arquivo perdido, data URL corrompida,
           rede caindo) some e deixa o gradiente padrão do Nexo */
        if (img.hasAttribute("data-banner-fb")) {
          img.style.display = "none";
          return;
        }
        if (img.hasAttribute("data-sv-fb")) {
          /* foto do ícone de servidor quebrada: volta ao glyph
             (emoji escolhido ou iniciais) sem derrubar o card */
          const svBox = img.parentNode;
          if (svBox && svBox.className === "server-icon__img") {
            const g = document.createElement("span");
            g.className = "server-icon__glyph";
            g.textContent = img.getAttribute("data-sv-fb") || "";
            svBox.parentNode.replaceChild(g, svBox);
          }
          return;
        }
        if (img.tagName !== "IMG" || !img.hasAttribute("data-avatar-fb")) return;
        const box = img.parentNode;
        if (!box || box.className !== "avatar__img") return;
        const span = document.createElement("span");
        span.className = "avatar__art";
        span.innerHTML = logoSVG();
        box.parentNode.replaceChild(span, box);
        return;
      },
      true
    );
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", wireImageFallback);
    } else {
      wireImageFallback();
    }
  }
})(window.NX);
