/* ============================================================
   NEXO · social
   Feed, publicações, seguidores/seguidos, curtidas e comentários.

   Camada de apresentação: lê NX.selectors, gera HTML e delega
   TODA mutação para NX.api (que validam privacidade, bloqueio e
   permissões). Nada aqui persiste estado próprio: contadores,
   listas e curtidas vêm sempre das coleções follows/likes/comments.

   Contrato público (consumido por js/pages.js e pelo módulo de perfil):
     NX.social.feedPage(postId)              -> HTML da rota #/feed
     NX.social.feedAfter(root, postId)       -> rola/destaca depois do render
     NX.social.postCard(post, opts)          -> HTML de UM cartão
     NX.social.postsSectionHTML(userId)      -> publicações de um perfil
     NX.social.userRow(user, opts)           -> linha de pessoa
     NX.social.openFollowers(userId, mode)   -> modal followers|following|requests
     NX.social.openCreatePost()              -> composer (inline ou modal)
     NX.social.openComments(postId)          -> modal de comentários
     NX.social.likeButtonHTML(type, id, opt) -> botão de curtida

   Ações registradas em NX.actions com prefixo "sx-" (delegação global).
   Classes CSS prefixadas "sx-".

   Requer, nesta ordem: core, icons, store, api, ui (e views/pages/app
   para a rota #/feed).
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const u = () => NX.util;
  const S = () => NX.selectors;
  const api = () => NX.api;
  const ui = () => NX.ui;
  const h = (s) => NX.util.h(s);

  const social = {};
  const SX = {}; /* ações sx-* */

  /* ---------------- limites (espelham js/api.js) ---------------- */
  const MAX_POST = 2000;
  const MAX_COMMENT = 500;
  const MAX_FILES = 4;
  const MAX_BYTES = 880000; /* folga sob o teto de 900.000 caracteres da api */

  /* o navegador toca vídeo? (o botão Vídeo só aparece se sim) */
  const VIDEO_OK = (function () {
    try {
      if (!window.HTMLVideoElement) return false;
      const v = document.createElement("video");
      return v.canPlayType("video/mp4") !== "" || v.canPlayType("video/webm") !== "";
    } catch (e) {
      return false;
    }
  })();

  /* ---------------- estado de apresentação ----------------
     Só guarda o que o DOM não pode reconstruir sozinho:
     rascunhos, comentários abertos e respostas pendentes. */
  const drafts = {}; /* chave -> {text, media[], emoji} */
  const openThread = {}; /* postId -> painel de comentários aberto */
  const replyTo = {}; /* chave de formulário -> commentId | null */
  const flashed = {}; /* postId -> último destaque (evita piscar sempre) */
  const busyLikes = {}; /* "tipo:id" -> em andamento (anti duplo clique) */

  let followView = null; /* modal de seguidores aberto */
  let commentsView = null; /* modal de comentários aberto */
  let createModal = null; /* modal de nova publicação */

  /* ---------------- utilitários internos ---------------- */
  function draft(key) {
    const k = key || "feed";
    if (!drafts[k]) drafts[k] = { text: "", media: [], emoji: false };
    return drafts[k];
  }

  function resetDraft(key) {
    drafts[key || "feed"] = { text: "", media: [], emoji: false };
  }

  /* valor seguro dentro de seletor de atributo */
  function selId(v) {
    return String(v == null ? "" : v).replace(/["\\]/g, "\\$&");
  }

  /* cartão que hospeda o fio de comentários.
     O botão "Responder" e o próprio formulário também carregam data-post,
     então o closest precisa mirar no <article> (que tem o prefixo do fio). */
  function cardOf(el) {
    if (!el || !el.closest) return null;
    return el.closest("[data-sx-cprefix]") || el.closest("article[data-post]") || null;
  }

  function go(hash) {
    if (NX.app && typeof NX.app.go === "function") NX.app.go(hash);
    else if (location.hash !== hash) location.hash = hash;
  }

  function statusLabel(user) {
    if (!user) return "";
    const map = NX.STATUS_LABEL || {};
    return map[user.status] || "Offline";
  }

  /* texto do usuário: escapa, linkifica e preserva quebras de linha */
  function contentHTML(text) {
    const safe = h(text == null ? "" : text);
    const linked = safe.replace(
      /(https?:\/\/[^\s<]+|www\.[^\s<]+)/g,
      (m) => {
        const href = m.indexOf("http") === 0 ? m : "https://" + m;
        return (
          '<a class="sx-link" href="' + href + '" target="_blank" rel="noopener noreferrer">' + m + "</a>"
        );
      }
    );
    return linked.split(/\r?\n/).join("<br>");
  }

  function scrollParentOf(el) {
    let n = el && el.parentElement;
    while (n && n !== document.body && n !== document.documentElement) {
      const o = window.getComputedStyle(n).overflowY;
      if (o === "auto" || o === "scroll") return n;
      n = n.parentElement;
    }
    return null;
  }

  function flashPost(el) {
    if (!el) return;
    const id = el.getAttribute("data-post");
    const now = Date.now();
    if (id && flashed[id] && now - flashed[id] < 8000) return;
    if (id) flashed[id] = now;
    el.classList.remove("is-flash");
    /* força reflow para reiniciar a animação */
    void el.offsetWidth;
    el.classList.add("is-flash");
    setTimeout(() => {
      if (el && el.classList) el.classList.remove("is-flash");
    }, 2800);
  }

  function scrollTo(el, flash) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || 800;
    const visible = r.top >= 56 && r.bottom <= vh - 16;
    if (!visible) {
      const sc = scrollParentOf(el);
      if (sc) sc.scrollTop = Math.max(0, sc.scrollTop + r.top - 80);
      else {
        try {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch (e) {
          el.scrollIntoView();
        }
      }
    }
    if (flash) flashPost(el);
  }

  function focusEl(el) {
    if (!el) return;
    try {
      el.focus();
      if (el.setSelectionRange && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
        const n = String(el.value || "").length;
        el.setSelectionRange(n, n);
      }
    } catch (e) {
      /* elemento não focável — ignora */
    }
  }

  /* =========================================================
     1 · botão de curtida (compartilhado com comentários)
     ========================================================= */
  social.likeButtonHTML = function (type, id, opts) {
    opts = opts || {};
    const me = S().me();
    const liked = !!(me && S().likedBy(type, id, me.id));
    const count = S().likeCount(type, id);
    return (
      '<button type="button" class="sx-like' +
      (liked ? " is-on" : "") +
      (opts.small ? " sx-like--sm" : "") +
      '" data-action="sx-like" data-type="' +
      h(type) +
      '" data-id="' +
      h(id) +
      '" aria-pressed="' +
      (liked ? "true" : "false") +
      '" title="' +
      (liked ? "Curtido" : "Curtir") +
      '">' +
      NX.icon(liked ? "heartFill" : "heart", "sx-like__ico", opts.small ? 15 : 17) +
      '<span class="sx-like__label">' +
      (liked ? "Curtido" : "Curtir") +
      "</span>" +
      (opts.withCount ? '<b class="sx-like__n">' + count + "</b>" : "") +
      "</button>"
    );
  };

  /* =========================================================
     2 · mídia da publicação
     ========================================================= */
  function mediaHTML(post, author) {
    const list = Array.isArray(post.media) ? post.media : [];
    if (!list.length) return "";
    const alt = "Imagem publicada por " + (author ? author.displayName || author.username : "alguém");
    const cells = list
      .slice(0, MAX_FILES)
      .map((m) => {
        const url = h((m && m.url) || "");
        if (!url) return "";
        if (m.kind === "video") {
          return (
            '<div class="sx-media__cell sx-media__cell--video">' +
            '<video class="sx-media__video" src="' +
            url +
            '" controls preload="metadata" playsinline aria-label="Vídeo da publicação"></video>' +
            "</div>"
          );
        }
        return (
          '<div class="sx-media__cell">' +
          '<img class="sx-media__img" src="' +
          url +
          '" alt="' +
          h(alt) +
          '" loading="lazy" decoding="async">' +
          "</div>"
        );
      })
      .join("");
    if (!cells) return "";
    return '<div class="sx-media sx-media--' + Math.min(list.length, MAX_FILES) + '">' + cells + "</div>";
  }

  /* =========================================================
     3 · comentário (item + árvore)
     ========================================================= */
  function buildTree(list, postId) {
    const top = [];
    const kids = {};
    list.forEach((c) => {
      const parent = c.parentId ? S().comment(c.parentId) : null;
      if (parent && parent.postId === postId) (kids[c.parentId] = kids[c.parentId] || []).push(c);
      else top.push(c);
    });
    return { top: top, kids: kids };
  }

  const MAX_DEPTH = 3;

  function commentHTML(c, tree, depth, post) {
    const author = S().user(c.authorId);
    if (!author) return "";
    const me = S().me();
    const mine = !!(me && me.id === c.authorId);
    const kids = depth < MAX_DEPTH ? tree.kids[c.id] || [] : [];
    const likes = S().likeCount("comment", c.id);

    return (
      '<article class="sx-comment' +
      (depth ? " sx-comment--reply" : "") +
      '" data-comment="' +
      h(c.id) +
      '">' +
      '<div class="sx-comment__row">' +
      u().avatarHTML(author, "sm", false) +
      '<div class="sx-comment__main">' +
      '<div class="sx-comment__head">' +
      '<b class="sx-comment__name">' +
      h(author.displayName || author.username) +
      "</b>" +
      '<span class="sx-comment__handle">@' +
      h(author.username) +
      "</span>" +
      '<span class="sx-comment__time" title="' +
      h(new Date(c.createdAt).toLocaleString("pt-BR")) +
      '">' +
      h(u().timeAgo(c.createdAt)) +
      "</span>" +
      "</div>" +
      '<p class="sx-comment__text">' +
      contentHTML(c.content) +
      "</p>" +
      '<div class="sx-comment__acts">' +
      social.likeButtonHTML("comment", c.id, { small: true, withCount: likes >= 0 }) +
      '<button type="button" class="sx-linkbtn" data-action="sx-reply" data-post="' +
      h(post.id) +
      '" data-id="' +
      h(c.id) +
      '">Responder</button>' +
      (mine
        ? '<button type="button" class="sx-linkbtn is-danger" data-action="sx-comment-delete" data-id="' +
          h(c.id) +
          '">Excluir</button>'
        : "") +
      "</div>" +
      "</div>" +
      "</div>" +
      (kids.length
        ? '<div class="sx-comment__kids">' +
          kids.map((k) => commentHTML(k, tree, depth + 1, post)).join("") +
          "</div>"
        : "") +
      "</article>"
    );
  }

  /* painel de comentários (inline no cartão ou dentro do modal) */
  function commentsHTML(post, prefix) {
    const me = S().me();
    const key = (prefix || "c") + ":" + post.id;
    const d = draft(key);
    const list = S().commentsOf(post.id);
    const tree = buildTree(list, post.id);
    const parent = replyTo[key] ? S().comment(replyTo[key]) : null;
    const parentAuthor = parent ? S().user(parent.authorId) : null;

    const body = list.length
      ? '<div class="sx-comments__list">' +
        tree.top.map((c) => commentHTML(c, tree, 0, post)).join("") +
        "</div>"
      : '<p class="sx-comments__empty">' +
        NX.icon("comment", "", 16) +
        "<span>Ninguém comentou ainda. Seja a primeira pessoa a responder.</span></p>";

    const form =
      '<form class="sx-cform" data-sx-form="comment" data-sx-key="' +
      h(key) +
      '" data-post="' +
      h(post.id) +
      '">' +
      (parent
        ? '<div class="sx-replychip">' +
          NX.icon("reply", "", 14) +
          "<span>Respondendo a <b>@" +
          h(parentAuthor ? parentAuthor.username : "") +
          "</b></span>" +
          '<button type="button" class="sx-replychip__x" data-action="sx-reply-cancel" data-sx-key="' +
          h(key) +
          '" aria-label="Cancelar resposta" title="Cancelar resposta">' +
          NX.icon("x", "", 14) +
          "</button></div>"
        : "") +
      '<div class="sx-cform__row">' +
      (me ? u().avatarHTML(me, "sm", false) : "") +
      '<div class="sx-cform__box">' +
      '<textarea class="input--area sx-cform__input" data-sx-input="text" data-sx-key="' +
      h(key) +
      '" rows="1" maxlength="' +
      MAX_COMMENT +
      '" placeholder="' +
      (parent && parentAuthor ? "Responder @" + h(parentAuthor.username) : "Escreva um comentário...") +
      '" aria-label="Texto do comentário">' +
      h(d.text) +
      "</textarea>" +
      '<div class="sx-cform__foot">' +
      '<span class="sx-cform__count" data-sx-count="' +
      h(key) +
      '">' +
      String(d.text.length) +
      "/" +
      MAX_COMMENT +
      "</span>" +
      '<button type="submit" class="btn btn--primary btn--sm">' +
      NX.icon("send", "", 15) +
      "<span>Comentar</span></button>" +
      "</div></div></div></form>";

    return (
      '<section class="sx-comments" aria-label="Comentários de ' + h(post.id) + '">' + body + form + "</section>"
    );
  }

  /* =========================================================
     4 · cartão de publicação
     ========================================================= */
  social.postCard = function (post, opts) {
    opts = opts || {};
    if (!post) return "";
    const me = S().me();
    const author = S().user(post.authorId);
    if (!author) return "";
    const mine = !!(me && me.id === author.id);
    const likes = S().likeCount("post", post.id);
    const comments = S().commentsOf(post.id).length;
    const threadOpen = opts.comments === "always" || !!openThread[post.id];
    const prefix = opts.commentKey || "c";

    return (
      '<article class="sx-post' +
      (opts.compact ? " sx-post--compact" : "") +
      '" data-post="' +
      h(post.id) +
      '" data-sx-cprefix="' +
      h(prefix) +
      '"' +
      (opts.compact ? "" : ' id="sx-post-' + h(post.id) + '" tabindex="-1"') +
      ">" +
      '<div class="sx-post__head">' +
      '<button type="button" class="sx-post__who" data-action="sx-profile" data-user="' +
      h(author.username) +
      '" title="Ver perfil de ' +
      h(author.displayName || author.username) +
      '">' +
      u().avatarHTML(author, "md", true) +
      '<span class="sx-post__idn">' +
      '<span class="sx-post__name">' +
      h(author.displayName || author.username) +
      "</span>" +
      '<span class="sx-post__handle">@' +
      h(author.username) +
      " · " +
      h(u().timeAgo(post.createdAt)) +
      "</span>" +
      "</span></button>" +
      (mine && !opts.hideDelete
        ? '<button type="button" class="icon-btn sx-post__del" data-action="sx-delete-post" data-id="' +
          h(post.id) +
          '" title="Excluir publicação" aria-label="Excluir publicação">' +
          NX.icon("trash", "", 17) +
          "</button>"
        : "") +
      "</div>" +
      (post.content ? '<div class="sx-post__text">' + contentHTML(post.content) + "</div>" : "") +
      mediaHTML(post, author) +
      '<div class="sx-post__counts">' +
      '<span class="sx-chip" title="Curtidas">' +
      NX.icon("heart", "sx-chip__ico", 14) +
      "<b>" +
      likes +
      "</b></span>" +
      '<span class="sx-chip" title="Comentários">' +
      NX.icon("comment", "sx-chip__ico", 14) +
      "<b>" +
      comments +
      "</b></span>" +
      "</div>" +
      (opts.hideActs
        ? ""
        : '<div class="sx-post__acts">' +
          social.likeButtonHTML("post", post.id, {}) +
          '<button type="button" class="sx-act" data-action="sx-comments" data-id="' +
          h(post.id) +
          '">' +
          NX.icon("comment", "", 17) +
          "<span>Comentar</span></button>" +
          '<button type="button" class="sx-act" data-action="sx-share" data-id="' +
          h(post.id) +
          '">' +
          NX.icon("share", "", 17) +
          "<span>Compartilhar</span></button>" +
          "</div>") +
      (threadOpen ? commentsHTML(post, prefix) : "") +
      "</article>"
    );
  };

  /* =========================================================
     5 · composer (usado inline no feed e no modal)
     ========================================================= */
  function previewsHTML(key, d) {
    if (!d.media.length) return "";
    return (
      '<div class="sx-att">' +
      d.media
        .map((m, i) => {
          const url = h(m.url || "");
          return (
            '<div class="sx-att__item sx-att__item--' +
            h(m.kind) +
            '">' +
            (m.kind === "video"
              ? '<video class="sx-att__vid" src="' + url + '" muted playsinline preload="metadata" aria-label="Pré-visualização do vídeo"></video>'
              : '<img class="sx-att__img" src="' + url + '" alt="Pré-visualização da imagem anexada">') +
            '<button type="button" class="sx-att__x" data-action="sx-att-remove" data-sx-key="' +
            h(key) +
            '" data-idx="' +
            i +
            '" title="Remover anexo" aria-label="Remover anexo">' +
            NX.icon("x", "", 14) +
            "</button>" +
            '<span class="sx-att__kind">' +
            (m.kind === "video" ? NX.icon("video", "", 13) : NX.icon("image", "", 13)) +
            "</span>" +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function emojiGridHTML(key) {
    const list = (u().EMOJIS || []).filter((e, i, a) => a.indexOf(e) === i);
    return (
      '<div class="sx-emoji" role="group" aria-label="Escolher emoji">' +
      list
        .map(
          (e) =>
            '<button type="button" class="sx-emoji__b" data-action="sx-emoji-pick" data-sx-key="' +
            h(key) +
            '" data-e="' +
            h(e) +
            '" aria-label="Inserir emoji ' +
            h(e) +
            '">' +
            h(e) +
            "</button>"
        )
        .join("") +
      "</div>"
    );
  }

  function composerHTML(key) {
    const me = S().me();
    const d = draft(key);
    const full = d.media.length >= MAX_FILES;

    return (
      '<form class="sx-composer' +
      (d.emoji ? " is-emoji" : "") +
      '" data-sx-form="composer" data-sx-key="' +
      h(key) +
      '" data-sx-composer="' +
      h(key) +
      '" aria-label="Criar publicação">' +
      '<div class="sx-composer__row">' +
      (me ? u().avatarHTML(me, "md", true) : "") +
      '<div class="sx-composer__box">' +
      '<textarea class="input--area sx-composer__input" data-sx-input="text" data-sx-key="' +
      h(key) +
      '" rows="2" maxlength="' +
      MAX_POST +
      '" placeholder="O que você está pensando?" aria-label="Texto da publicação">' +
      h(d.text) +
      "</textarea>" +
      previewsHTML(key, d) +
      (d.emoji ? emojiGridHTML(key) : "") +
      '<div class="sx-composer__foot">' +
      '<div class="sx-composer__tools">' +
      '<button type="button" class="sx-tool' +
      (d.emoji ? " is-on" : "") +
      '" data-action="sx-emoji" data-sx-key="' +
      h(key) +
      '" title="Emoji" aria-label="Escolher emoji" aria-expanded="' +
      (d.emoji ? "true" : "false") +
      '">' +
      NX.icon("smile", "", 19) +
      "</button>" +
      '<button type="button" class="sx-tool" data-action="sx-pick" data-kind="image" data-sx-key="' +
      h(key) +
      '" title="Anexar imagem" aria-label="Anexar imagem"' +
      (full ? " disabled" : "") +
      ">" +
      NX.icon("image", "", 19) +
      "</button>" +
      (VIDEO_OK
        ? '<button type="button" class="sx-tool" data-action="sx-pick" data-kind="video" data-sx-key="' +
          h(key) +
          '" title="Anexar vídeo" aria-label="Anexar vídeo"' +
          (full ? " disabled" : "") +
          ">" +
          NX.icon("video", "", 19) +
          "</button>"
        : "") +
      '<input type="file" class="sx-file" data-sx-change="attach" data-sx-key="' +
      h(key) +
      '" data-kind="image" accept="image/*" tabindex="-1" aria-hidden="true">' +
      (VIDEO_OK
        ? '<input type="file" class="sx-file" data-sx-change="attach" data-sx-key="' +
          h(key) +
          '" data-kind="video" accept="video/*" tabindex="-1" aria-hidden="true">'
        : "") +
      (full
        ? '<span class="sx-tool__hint">Máximo de ' + MAX_FILES + " anexos</span>"
        : "") +
      "</div>" +
      '<div class="sx-composer__end">' +
      '<span class="sx-composer__count" data-sx-count="' +
      h(key) +
      '">' +
      String(d.text.length) +
      "/" +
      MAX_POST +
      "</span>" +
      '<button type="button" class="btn btn--ghost btn--sm" data-action="sx-cancel" data-sx-key="' +
      h(key) +
      '">Cancelar</button>' +
      '<button type="submit" class="btn btn--primary btn--sm">Publicar</button>' +
      "</div></div></div></div></form>"
    );
  }

  function refreshComposer(key) {
    const el = document.querySelector('[data-sx-composer="' + selId(key) + '"]');
    if (!el) return null;
    const hadFocus = el.contains(document.activeElement);
    const fresh = u().el(composerHTML(key));
    if (!fresh) return null;
    el.replaceWith(fresh);
    if (hadFocus) focusEl(fresh.querySelector("textarea"));
    return fresh;
  }

  /* repinta o cartão (ou modal) que o elemento pertence */
  function repaintAfterMutation(el) {
    if (!el || !document.contains(el)) return; /* a rota já se repintou */
    if (commentsView && commentsView.m && commentsView.m.body && commentsView.m.body.contains(el)) {
      renderCommentsModal();
      return;
    }
    if (followView && followView.m && followView.m.body && followView.m.body.contains(el)) {
      renderFollowBody();
      return;
    }
    const card = cardOf(el);
    if (card && card.querySelector(".sx-comments")) refreshThread(card);
  }

  function refreshThread(card) {
    if (!card) return;
    const post = S().post(card.getAttribute("data-post"));
    const panel = card.querySelector(".sx-comments");
    if (!post || !panel) return;
    const prefix = card.getAttribute("data-sx-cprefix") || "c";
    const fresh = u().el(commentsHTML(post, prefix));
    if (fresh) panel.replaceWith(fresh);
  }

  function focusComment(postId) {
    requestAnimationFrame(() => {
      const sel = '[data-post="' + selId(postId) + '"]';
      let scope =
        commentsView && commentsView.m && commentsView.m.body
          ? commentsView.m.body.querySelector(sel)
          : null;
      if (!scope) scope = document.querySelector(sel);
      if (!scope) return;
      focusEl(scope.querySelector(".sx-cform__input"));
    });
  }

  /* =========================================================
     6 · página do feed
     ========================================================= */
  function emptyFeedHTML() {
    return (
      '<div class="sx-empty">' +
      '<span class="sx-empty__ico">' +
      NX.icon("heart", "", 26) +
      "</span>" +
      "<h2>Nada novo por aqui</h2>" +
      "<p>Seu feed ainda está vazio. Publique alguma coisa ou siga mais pessoas para ver conteúdo chegar.</p>" +
      '<div class="sx-empty__acts">' +
      '<button type="button" class="btn btn--primary" data-action="sx-new-post">Criar publicação</button>' +
      "</div></div>"
    );
  }

  social.feedPage = function (postId) {
    const me = S().me();
    if (!me) {
      return (
        '<div class="sx-page"><div class="sx-empty">' +
        '<span class="sx-empty__ico">' +
        NX.icon("users", "", 26) +
        "</span>" +
        "<h2>Entre para ver o feed</h2>" +
        "<p>Faça login para publicar, curtir e comentar nas conversas das suas comunidades.</p>" +
        '<div class="sx-empty__acts"><button type="button" class="btn btn--primary" data-action="goto-login">Entrar</button></div>' +
        "</div></div>"
      );
    }

    const posts = S().feedPosts();
    return (
      '<div class="sx-page">' +
      '<header class="sx-head">' +
      '<div class="sx-head__txt">' +
      '<span class="sx-head__eyebrow">Nexo · rede social</span>' +
      '<h1 class="sx-head__title">Feed</h1>' +
      '<p class="sx-head__sub">Suas publicações, das pessoas que você segue e as públicas das comunidades.</p>' +
      "</div>" +
      '<button type="button" class="btn btn--primary sx-head__btn" data-action="sx-new-post">' +
      NX.icon("plus", "", 17) +
      "<span>Criar publicação</span></button>" +
      "</header>" +
      composerHTML("feed") +
      (posts.length
        ? '<div class="sx-feed">' + posts.map((p) => social.postCard(p, {})).join("") + "</div>"
        : emptyFeedHTML()) +
      "</div>"
    );
  };

  /* chamado por js/pages.js logo após o innerHTML da rota */
  social.feedAfter = function (root, postId) {
    if (!root || !root.querySelector) return;
    if (postId) {
      const el = root.querySelector('[data-post="' + selId(postId) + '"]');
      if (el) scrollTo(el, true);
    }
    /* o rascunho do composer já é renderizado a partir de drafts */
  };

  /* =========================================================
     7 · publicações de um perfil
     ========================================================= */
  social.postsSectionHTML = function (userId) {
    const me = S().me();
    const user = S().user(userId);
    if (!user) {
      return '<div class="sx-empty"><span class="sx-empty__ico">' + NX.icon("alert", "", 24) +
        "</span><h2>Usuário não encontrado</h2><p>Esta conta pode ter sido removida.</p></div>";
    }
    if (!me || !S().canViewPostsOf(me.id, user.id)) {
      return (
        '<div class="sx-empty sx-empty--lock">' +
        '<span class="sx-empty__ico">' +
        NX.icon("eye", "", 24) +
        "</span>" +
        "<h2>Publicações privadas</h2>" +
        "<p>Esta pessoa deixa as publicações dela visíveis só para quem ela autorizar.</p>" +
        "</div>"
      );
    }
    const posts = S().postsBy(user.id);
    if (!posts.length) {
      const mine = me.id === user.id;
      return (
        '<div class="sx-empty">' +
        '<span class="sx-empty__ico">' +
        NX.icon("pencil", "", 24) +
        "</span>" +
        "<h2>" +
        (mine ? "Você ainda não publicou" : "Nenhuma publicação ainda") +
        "</h2>" +
        "<p>" +
        (mine
          ? "Compartilhe novidades com quem segue você."
          : h(user.displayName || user.username) + " ainda não publicou nada por aqui.") +
        "</p>" +
        (mine
          ? '<div class="sx-empty__acts"><button type="button" class="btn btn--primary" data-action="sx-new-post">Criar publicação</button></div>'
          : "") +
        "</div>"
      );
    }
    return (
      '<div class="sx-feed sx-feed--profile">' +
      posts.map((p) => social.postCard(p, { compact: true })).join("") +
      "</div>"
    );
  };

  /* =========================================================
     8 · linha de pessoa (seguidores, seguidos, solicitações)
     ========================================================= */
  function followBtnHTML(user, opts) {
    opts = opts || {};
    const me = S().me();
    if (!user || !me) return "";
    if (user.id === me.id) return '<span class="sx-row__you">Você</span>';

    if (opts.mode === "requests") {
      return (
        '<button type="button" class="btn btn--primary btn--sm" data-action="sx-follow-approve" data-id="' +
        h(user.id) +
        '">Aprovar</button>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-action="sx-follow-reject" data-id="' +
        h(user.id) +
        '">Recusar</button>'
      );
    }

    let st = { can: true, state: null };
    try {
      st = api().followStatus(user.id) || st;
    } catch (e) {
      st = { can: true, state: null };
    }
    if (st.state === "self") return '<span class="sx-row__you">Você</span>';
    if (st.state === "following") {
      return (
        '<button type="button" class="sx-follow is-on" data-action="sx-unfollow" data-id="' +
        h(user.id) +
        '" title="Deixar de seguir" aria-pressed="true">' +
        NX.icon("check", "", 15) +
        "<span>Seguindo</span></button>"
      );
    }
    if (st.state === "pending") {
      return (
        '<button type="button" class="sx-follow is-pending" data-action="sx-unfollow" data-id="' +
        h(user.id) +
        '" title="Cancelar solicitação de seguimento" aria-pressed="false">' +
        NX.icon("clock", "", 15) +
        "<span>Solicitado</span></button>"
      );
    }
    return (
      '<button type="button" class="sx-follow" data-action="sx-follow" data-id="' +
      h(user.id) +
      '" title="Seguir" aria-pressed="false">' +
      NX.icon("userPlus", "", 15) +
      "<span>" +
      (st.state === "request" ? "Solicitar" : "Seguir") +
      "</span></button>"
    );
  }

  social.userRow = function (user, opts) {
    opts = opts || {};
    if (!user) return "";
    const me = S().me();
    const mine = !!(me && me.id === user.id);
    return (
      '<div class="sx-row" data-user="' +
      h(user.id) +
      '">' +
      '<button type="button" class="sx-row__who" data-action="sx-profile" data-user="' +
      h(user.username) +
      '" title="Ver perfil de ' +
      h(user.displayName || user.username) +
      '">' +
      u().avatarHTML(user, "md", true) +
      '<span class="sx-row__txt">' +
      '<span class="sx-row__name">' +
      h(user.displayName || user.username) +
      "</span>" +
      '<span class="sx-row__meta">@' +
      h(user.username) +
      (opts.showStatus === false ? "" : " · " + h(statusLabel(user))) +
      "</span>" +
      "</span></button>" +
      '<div class="sx-row__act">' +
      (opts.action || (mine ? '<span class="sx-row__you">Você</span>' : followBtnHTML(user, opts))) +
      "</div>" +
      "</div>"
    );
  };

  /* =========================================================
     9 · modal de seguidores / seguidos / solicitações
     ========================================================= */
  const FLOW_TITLES = { followers: "Seguidores", following: "Seguindo", requests: "Solicitações" };
  const FLOW_PLACEHOLDER = {
    followers: "Pesquisar seguidores",
    following: "Pesquisar quem você segue",
    requests: "Pesquisar solicitações",
  };

  function renderFollowBody() {
    const v = followView;
    if (!v || !v.m || !v.m.body) return;
    const box = v.m.body.querySelector("[data-sx-flbody]");
    if (!box) return;

    const counts = {
      followers: S().followerCount(v.userId),
      following: S().followingCount(v.userId),
      requests: v.list.length,
    };
    const nouns = { followers: "seguidores", following: "seguindo", requests: "solicitações" };
    const head =
      '<div class="sx-fl__count"><b>' +
      counts[v.mode] +
      "</b> <span>" +
      nouns[v.mode] +
      "</span></div>";

    if (v.error) {
      box.innerHTML =
        head +
        '<div class="sx-note sx-note--error">' +
        NX.icon("alert", "", 17) +
        "<span>" +
        h(v.error) +
        "</span></div>";
      return;
    }
    if (v.loading) {
      box.innerHTML =
        head + '<div class="sx-note">' + NX.icon("clock", "", 16) + "<span>Carregando…</span></div>";
      return;
    }

    const q = u().normalize(v.query || "");
    const list = (v.list || []).filter(
      (x) => !q || u().normalize((x.displayName || "") + " " + (x.username || "") + " @" + x.username).indexOf(q) !== -1
    );

    box.innerHTML =
      head +
      (list.length
        ? '<div class="sx-fl__list">' +
          list.map((x) => social.userRow(x, { mode: v.mode })).join("") +
          "</div>"
        : '<div class="sx-note">' +
          NX.icon("search", "", 16) +
          "<span>" +
          (v.query
            ? "Ninguém encontrado para “" + h(v.query) + "”."
            : v.mode === "requests"
            ? "Nenhuma solicitação pendente."
            : "Nenhuma pessoa por aqui ainda.") +
          "</span></div>");
  }

  function loadFollow() {
    const v = followView;
    if (!v) return;
    v.loading = true;
    v.error = null;
    renderFollowBody();
    api()
      .listFollow(v.userId, v.mode)
      .then((list) => {
        if (followView !== v) return;
        v.list = Array.isArray(list) ? list : [];
        v.loading = false;
        renderFollowBody();
      })
      .catch((e) => {
        if (followView !== v) return;
        v.loading = false;
        v.error = (e && e.message) || "Não foi possível carregar esta lista.";
        renderFollowBody();
      });
  }

  social.openFollowers = function (userId, mode) {
    mode = ["followers", "following", "requests"].indexOf(mode) > -1 ? mode : "followers";
    const owner = S().user(userId);
    if (!owner) {
      ui().error("Este usuário não existe mais.");
      return null;
    }
    if (mode === "requests") {
      const me = S().me();
      if (!me || me.id !== owner.id) {
        ui().error("Só você pode ver quem pediu para seguir você.");
        return null;
      }
    }

    let m = null;
    m = ui().modal({
      title: FLOW_TITLES[mode],
      eyebrow: "@" + owner.username,
      size: "md",
      onClose: () => {
        if (followView && followView.m === m) followView = null;
      },
    });

    followView = {
      m: m,
      userId: owner.id,
      mode: mode,
      query: "",
      list: [],
      loading: true,
      error: null,
    };

    m.body.innerHTML =
      '<div class="sx-fl">' +
      '<div class="sx-fl__search">' +
      NX.icon("search", "sx-fl__ico", 16) +
      '<input type="search" class="sx-fl__input" data-sx-input="follow-search" placeholder="' +
      h(FLOW_PLACEHOLDER[mode]) +
      '" aria-label="' +
      h(FLOW_PLACEHOLDER[mode]) +
      '" value="' +
      h(followView.query) +
      '" autocomplete="off">' +
      "</div>" +
      '<div class="sx-fl__body" data-sx-flbody></div>' +
      "</div>";

    renderFollowBody();
    loadFollow();
    return m;
  };

  /* =========================================================
     9b · modal de CURTIDAS recebidas (❤️ do perfil)
     A privacidade do dono é aplicada pela API: se não der
     para ver, o modal mostra o aviso em vez dos números.
     ========================================================= */
  social.openLikes = function (userId) {
    const owner = S().user(userId);
    if (!owner) {
      ui().error("Este usuário não existe mais.");
      return null;
    }

    const m = ui().modal({
      title: "Curtidas",
      eyebrow: "@" + owner.username,
      size: "md",
    });

    m.body.innerHTML =
      '<div class="sx-fl"><div class="sx-fl__body" data-sx-likes>' +
      '<div class="sx-note">' + NX.icon("clock", "", 16) + "<span>Carregando…</span></div>" +
      "</div></div>";

    const box = m.body.querySelector("[data-sx-likes]");

    const row = (x) => {
      const p = x.post;
      const text = String((p && p.content) || "").replace(/\s+/g, " ").trim();
      return (
        '<button type="button" class="sx-likerow" data-action="sx-open-post" data-id="' + h(p.id) + '" title="Abrir publicação">' +
        '<span class="sx-like__ico">' + NX.icon("heartFill", "", 16) + "</span>" +
        '<span class="sx-like__txt"><strong>' +
        u().num(x.likes) +
        (x.likes === 1 ? " curtida" : " curtidas") +
        "</strong><span>" +
        h(text.slice(0, 140) || "Publicação sem texto") +
        "</span></span>" +
        '<span class="sx-like__when">' +
        h(u().timeAgo(p.createdAt)) +
        "</span></button>"
      );
    };

    api()
      .listLikes(owner.id)
      .then((res) => {
        if (!box.isConnected) return;
        const total = res && typeof res.total === "number" ? res.total : 0;
        const posts = (res && res.posts) || [];
        const head =
          '<div class="sx-fl__count"><b>' + u().num(total) + "</b> <span>curtidas recebidas</span></div>";

        box.innerHTML =
          head +
          (posts.length
            ? '<div class="sx-likes">' + posts.map(row).join("") + "</div>"
            : '<div class="sx-note">' + NX.icon("heart", "", 16) +
              "<span>Nenhuma publicação recebeu curtidas ainda.</span></div>");
      })
      .catch((e) => {
        if (!box.isConnected) return;
        box.innerHTML =
          '<div class="sx-note sx-note--error">' +
          NX.icon("lock", "", 17) +
          "<span>" +
          h((e && e.message) || "Não foi possível carregar as curtidas.") +
          "</span></div>";
      });

    /* clicar numa publicação abre ela no feed: ação sx-open-post
       registrada na delegação global (nx.action) */

    return m;
  };

  /* =========================================================
     10 · modal de comentários
     ========================================================= */
  function renderCommentsModal() {
    const v = commentsView;
    if (!v || !v.m) return;
    const post = S().post(v.postId);
    if (!post) {
      v.m.close();
      commentsView = null;
      return;
    }
    v.m.body.innerHTML =
      '<div class="sx-mpost">' +
      social.postCard(post, { compact: true, comments: "always", commentKey: "m" }) +
      "</div>";
  }

  social.openComments = function (postId) {
    const post = S().post(postId);
    if (!post) {
      ui().error("Esta publicação não existe mais.");
      return null;
    }
    const author = S().user(post.authorId);
    let m = null;
    m = ui().modal({
      title: "Comentários",
      eyebrow: author ? "@" + author.username : "Feed",
      size: "md",
      onClose: () => {
        if (commentsView && commentsView.m === m) commentsView = null;
      },
    });
    commentsView = { m: m, postId: postId };
    renderCommentsModal();
    return m;
  };

  /* =========================================================
     11 · criar publicação
     ========================================================= */
  function openCreateModal() {
    let m = null;
    m = ui().modal({
      title: "Criar publicação",
      eyebrow: "Feed",
      size: "md",
      onClose: () => {
        if (createModal === m) createModal = null;
      },
    });
    createModal = m;
    m.body.innerHTML = '<div class="sx-mcomposer">' + composerHTML("modal") + "</div>";
    setTimeout(() => focusEl(m.body.querySelector("textarea")), 80);
    return m;
  }

  social.openCreatePost = function () {
    const inline = document.querySelector('[data-sx-composer="feed"]');
    if (inline) {
      scrollTo(inline, false);
      inline.classList.add("is-focus");
      setTimeout(() => inline.classList.remove("is-focus"), 1600);
      setTimeout(() => focusEl(inline.querySelector("textarea")), 60);
      return inline;
    }
    return openCreateModal();
  };

  /* ---------------- envio ---------------- */
  async function publish(key, btn) {
    const d = draft(key);
    const root = document.querySelector('[data-sx-composer="' + selId(key) + '"]');
    const ta = root ? root.querySelector("textarea") : null;
    if (ta) d.text = ta.value;
    const text = String(d.text || "").trim();

    if (!text && !d.media.length) {
      ui().error("Escreva alguma coisa ou anexe uma imagem/vídeo.");
      focusEl(ta);
      return;
    }
    if (text.length > MAX_POST) {
      ui().error("A publicação pode ter no máximo 2.000 caracteres.");
      focusEl(ta);
      return;
    }

    const end = btn ? ui().busy(btn) : function () {};
    try {
      const post = await api().createPost({ content: text, media: d.media.slice() });
      resetDraft(key);
      if (key === "modal" && createModal) {
        const m = createModal;
        createModal = null;
        m.close();
      }
      ui().toast("Publicação criada!", "success");
      const id = post && post.id;
      if (id) {
        requestAnimationFrame(() => {
          const el = document.querySelector('[data-post="' + selId(id) + '"]');
          if (el) scrollTo(el, true);
          else if (NX.app && NX.app.route && NX.app.route.name === "feed") go("#/feed/" + id);
        });
      }
    } catch (e) {
      ui().error((e && e.message) || "Não foi possível publicar.");
    } finally {
      end();
    }
  }

  /* ---------------- anexos ---------------- */
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      r.onload = () => {
        const raw = String(r.result || "");
        const img = new Image();
        img.onerror = () => reject(new Error("Formato de imagem não suportado."));
        img.onload = () => {
          try {
            const max = 1024;
            const w0 = img.naturalWidth || img.width;
            const h0 = img.naturalHeight || img.height;
            const scale = Math.min(1, max / Math.max(w0, h0));
            const w = Math.max(1, Math.round(w0 * scale));
            const hh = Math.max(1, Math.round(h0 * scale));
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = hh;
            const ctx = canvas.getContext("2d");
            const keepPng = file.type === "image/png";
            if (!keepPng) {
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, w, hh);
            }
            ctx.drawImage(img, 0, 0, w, hh);

            let out = "";
            if (keepPng) {
              out = canvas.toDataURL("image/png");
              if (out.length > MAX_BYTES) out = ""; /* PNG grande → reencoda como JPEG */
            }
            if (!out) {
              let q = 0.82;
              out = canvas.toDataURL("image/jpeg", q);
              while (out.length > MAX_BYTES && q > 0.4) {
                q = Math.round((q - 0.15) * 100) / 100;
                out = canvas.toDataURL("image/jpeg", q);
              }
            }
            if (out.length > MAX_BYTES) {
              reject(new Error("Esta imagem continua grande demais mesmo após a redução. Tente outro arquivo."));
              return;
            }
            resolve({ kind: "image", url: out });
          } catch (e) {
            if (raw && raw.length <= MAX_BYTES) resolve({ kind: "image", url: raw });
            else reject(new Error("Não foi possível processar esta imagem."));
          }
        };
        img.src = raw;
      };
      r.readAsDataURL(file);
    });
  }

  function readVideo(file, key) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onerror = () => {
        ui().error("Não foi possível ler o vídeo.");
        resolve(null);
      };
      r.onload = () => {
        const url = String(r.result || "");
        if (!url || url.length > MAX_BYTES) {
          askVideoUrl(file, key);
          resolve(null);
          return;
        }
        resolve({ kind: "video", url: url });
      };
      r.readAsDataURL(file);
    });
  }

  /* vídeo não comprime como imagem: oferecemos anexar por URL, com a razão */
  function askVideoUrl(file, key) {
    const actions = u().el('<div class="modal__actions"></div>');
    const cancel = u().el('<button class="btn btn--ghost" type="button">Cancelar</button>');
    const ok = u().el('<button class="btn btn--primary" type="button">Anexar por link</button>');
    actions.appendChild(cancel);
    actions.appendChild(ok);

    const m = ui().modal({ title: "Vídeo grande demais", eyebrow: "Anexo", size: "sm", footer: actions });
    m.body.innerHTML =
      '<div class="sx-note sx-note--warn">' +
      NX.icon("alert", "", 17) +
      "<span>O arquivo <b>" +
      h(file && file.name ? file.name : "vídeo") +
      "</b> passa dos 900 KB que o Nexo guarda por anexo — e vídeo não dá para reduzir como imagem. " +
      "Cole o endereço de um vídeo já hospedado (http/https) para anexar por link, ou escolha um arquivo menor.</span></div>" +
      '<div class="field"><label class="field__label" for="sx-videourl">Endereço do vídeo</label>' +
      '<input class="input" id="sx-videourl" data-autofocus placeholder="https://…/video.mp4" autocomplete="off"></div>';

    cancel.addEventListener("click", () => m.close());
    ok.addEventListener("click", () => {
      const input = m.body.querySelector("#sx-videourl");
      const url = String((input && input.value) || "").trim();
      if (!/^https?:\/\/\S+/i.test(url)) {
        ui().error("Cole um endereço começando com http:// ou https://.");
        focusEl(input);
        return;
      }
      const d = draft(key);
      if (d.media.length >= MAX_FILES) {
        ui().error("Máximo de " + MAX_FILES + " anexos por publicação.");
        m.close();
        return;
      }
      d.media.push({ kind: "video", url: url });
      m.close();
      refreshComposer(key);
      ui().toast("Vídeo anexado por link.", "success");
    });
  }

  async function handleAttach(inp, file) {
    const key = inp.getAttribute("data-sx-key") || "feed";
    const kind = inp.getAttribute("data-kind") || (file.type.indexOf("video/") === 0 ? "video" : "image");
    const d = draft(key);
    try {
      if (d.media.length >= MAX_FILES) {
        ui().error("Máximo de " + MAX_FILES + " anexos por publicação.");
        return;
      }
      if (file && file.size > 240000) ui().toast("Preparando anexo…", "info", 2000);
      const item = kind === "video" ? await readVideo(file, key) : await readImage(file);
      if (!item) return; /* vídeo pediu URL e foi cancelado */
      if (d.media.length >= MAX_FILES) {
        ui().error("Máximo de " + MAX_FILES + " anexos por publicação.");
        return;
      }
      d.media.push(item);
      refreshComposer(key);
      ui().toast(kind === "video" ? "Vídeo anexado." : "Imagem anexada.", "success", 2200);
    } catch (e) {
      ui().error((e && e.message) || "Não foi possível anexar este arquivo.");
    } finally {
      try {
        inp.value = "";
      } catch (e) {
        /* input já removido do documento */
      }
    }
  }

  function insertAtCaret(ta, text) {
    if (!ta) return;
    const start = typeof ta.selectionStart === "number" ? ta.selectionStart : ta.value.length;
    const end = typeof ta.selectionEnd === "number" ? ta.selectionEnd : start;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    const pos = start + text.length;
    try {
      ta.setSelectionRange(pos, pos);
    } catch (e) {
      /* seleção indisponível */
    }
    focusEl(ta);
    const key = ta.getAttribute("data-sx-key");
    if (key) {
      draft(key).text = ta.value;
      updateCount(ta, key, ta.value.length);
    }
  }

  function updateCount(el, key, len) {
    const scope =
      (el && el.closest && (el.closest("[data-sx-composer]") || el.closest("[data-sx-form]"))) || document;
    const box = scope.querySelector('[data-sx-count="' + selId(key) + '"]');
    if (!box) return;
    const max = key.indexOf("c:") === 0 || key.indexOf("m:") === 0 ? MAX_COMMENT : MAX_POST;
    box.textContent = len + "/" + max;
    box.classList.toggle("is-near", len > max * 0.9);
  }

  /* =========================================================
     12 · comentários — ações
     ========================================================= */
  async function submitComment(form, btn) {
    const key = form.getAttribute("data-sx-key") || "";
    const postId = form.getAttribute("data-post") || "";
    const ta = form.querySelector("textarea");
    const text = String((ta && ta.value) || "");
    const parent = replyTo[key] || null;

    if (!text.trim()) {
      ui().error("Escreva um comentário.");
      focusEl(ta);
      return;
    }
    if (text.length > MAX_COMMENT) {
      ui().error("O comentário pode ter no máximo 500 caracteres.");
      focusEl(ta);
      return;
    }

    const end = btn ? ui().busy(btn) : function () {};
    const before = draft(key).text;
    draft(key).text = "";
    try {
      await api().addComment(postId, text, parent);
      delete replyTo[key];
      ui().toast("Comentário publicado.", "success", 2400);
      repaintAfterMutation(btn || form);
      focusComment(postId);
    } catch (e) {
      draft(key).text = before;
      ui().error((e && e.message) || "Não foi possível publicar o comentário.");
    } finally {
      end();
    }
  }

  SX["sx-comments"] = (el) => {
    const id = el.getAttribute("data-id");
    if (!id) return;
    if (commentsView && commentsView.postId === id) {
      focusComment(id);
      return;
    }
    const card = cardOf(el);
    if (!card) return;
    const post = S().post(id);
    if (!post) return;
    const panel = card.querySelector(".sx-comments");
    if (panel) {
      panel.remove();
      delete openThread[id];
      return;
    }
    const prefix = card.getAttribute("data-sx-cprefix") || "c";
    card.insertAdjacentHTML("beforeend", commentsHTML(post, prefix));
    openThread[id] = true;
    focusComment(id);
  };

  SX["sx-reply"] = (el) => {
    const postId = el.getAttribute("data-post");
    const commentId = el.getAttribute("data-id");
    if (!postId || !commentId) return;
    const card = cardOf(el);
    const prefix = card ? card.getAttribute("data-sx-cprefix") || "c" : "c";
    const key = prefix + ":" + postId;
    replyTo[key] = commentId;
    openThread[postId] = true;
    if (commentsView && commentsView.postId === postId) renderCommentsModal();
    else if (card) refreshThread(card);
    focusComment(postId);
  };

  SX["sx-reply-cancel"] = (el) => {
    const key = el.getAttribute("data-sx-key") || "";
    const postId = key.split(":")[1] || "";
    delete replyTo[key];
    if (commentsView && commentsView.postId === postId) renderCommentsModal();
    else {
      const card = cardOf(el);
      if (card) refreshThread(card);
    }
    focusComment(postId);
  };

  SX["sx-comment-delete"] = async (el) => {
    const id = el.getAttribute("data-id");
    if (!id) return;
    const ok = await ui().confirm({
      title: "Excluir comentário",
      message: "Este comentário será apagado para todo mundo. Não dá para desfazer.",
      confirmLabel: "Excluir",
      danger: true,
      icon: "trash",
    });
    if (!ok) return;
    try {
      await api().deleteComment(id);
      ui().toast("Comentário excluído.", "success", 2400);
      repaintAfterMutation(el);
    } catch (e) {
      ui().error((e && e.message) || "Não foi possível excluir o comentário.");
    }
  };

  /* =========================================================
     13 · ações principais
     ========================================================= */
  SX["sx-new-post"] = () => social.openCreatePost();

  SX["sx-profile"] = (el) => {
    const name = el.getAttribute("data-user");
    if (name) go("#/perfil/" + encodeURIComponent(name));
  };

  SX["sx-like"] = async (el) => {
    const type = el.getAttribute("data-type") || "post";
    const id = el.getAttribute("data-id");
    if (!id) return;
    const me = S().me();
    if (!me) {
      ui().error("Entre para curtir conteúdos.");
      return;
    }
    const k = type + ":" + id;
    if (busyLikes[k]) return;
    busyLikes[k] = true;
    try {
      const liked = S().likedBy(type, id, me.id);
      if (liked) await api().unlikeContent(type, id);
      else await api().likeContent(type, id);
      repaintAfterMutation(el);
    } catch (e) {
      ui().error((e && e.message) || "Não foi possível curtir este conteúdo.");
    } finally {
      delete busyLikes[k];
    }
  };

  SX["sx-share"] = (el) => {
    const id = el.getAttribute("data-id");
    if (!id) return;
    const url = location.origin + location.pathname + "#/feed/" + id;
    u()
      .copy(url)
      .then((ok) => {
        ui().toast(
          ok ? "Link da publicação copiado." : "Não foi possível copiar o link.",
          ok ? "success" : "error"
        );
      })
      .catch(() => ui().toast("Não foi possível copiar o link.", "error"));
  };

  SX["sx-delete-post"] = async (el) => {
    const id = el.getAttribute("data-id");
    if (!id) return;
    const ok = await ui().confirm({
      title: "Excluir publicação",
      message: "A publicação, os comentários e as curtidas dela serão apagados. Não dá para desfazer.",
      confirmLabel: "Excluir",
      danger: true,
      icon: "trash",
    });
    if (!ok) return;
    const end = ui().busy(el);
    try {
      await api().deletePost(id);
      ui().toast("Publicação excluída.", "success");
    } catch (e) {
      ui().error((e && e.message) || "Não foi possível excluir a publicação.");
    } finally {
      end();
    }
  };

  /* ---------------- composer ---------------- */
  SX["sx-emoji"] = (el) => {
    const key = el.getAttribute("data-sx-key") || "feed";
    const d = draft(key);
    d.emoji = !d.emoji;
    refreshComposer(key);
    const root = document.querySelector('[data-sx-composer="' + selId(key) + '"]');
    if (root && d.emoji) focusEl(root.querySelector("textarea"));
  };

  SX["sx-emoji-pick"] = (el) => {
    const key = el.getAttribute("data-sx-key") || "feed";
    const e = el.getAttribute("data-e");
    if (!e) return;
    const root = document.querySelector('[data-sx-composer="' + selId(key) + '"]');
    insertAtCaret(root ? root.querySelector("textarea") : null, e);
  };

  SX["sx-pick"] = (el) => {
    const key = el.getAttribute("data-sx-key") || "feed";
    const kind = el.getAttribute("data-kind") || "image";
    const sel =
      'input[data-sx-change="attach"][data-kind="' +
      kind +
      '"][data-sx-key="' +
      selId(key) +
      '"]';
    const input = document.querySelector(sel);
    if (!input) {
      ui().error(kind === "video" ? "Este navegador não abre arquivos de vídeo." : "Seletor de arquivos indisponível.");
      return;
    }
    try {
      input.value = "";
      input.click();
    } catch (e) {
      ui().error("Não foi possível abrir o seletor de arquivos.");
    }
  };

  SX["sx-att-remove"] = (el) => {
    const key = el.getAttribute("data-sx-key") || "feed";
    const idx = parseInt(el.getAttribute("data-idx"), 10);
    const d = draft(key);
    if (isNaN(idx) || idx < 0 || idx >= d.media.length) return;
    d.media.splice(idx, 1);
    refreshComposer(key);
  };

  SX["sx-cancel"] = (el) => {
    const key = el.getAttribute("data-sx-key") || "feed";
    resetDraft(key);
    if (key === "modal" && createModal) {
      const m = createModal;
      createModal = null;
      m.close();
      return;
    }
    refreshComposer(key);
  };

  /* ---------------- seguir / deixar de seguir ---------------- */
  SX["sx-follow"] = (el) => {
    const id = el.getAttribute("data-id");
    if (!id) return;
    const end = ui().busy(el);
    api()
      .followUser(id)
      .then((res) => {
        end();
        ui().toast(
          res && res.state === "pending" ? "Solicitação de seguimento enviada." : "Você começou a seguir esta pessoa.",
          "success"
        );
        if (followView) loadFollow();
        else repaintAfterMutation(el);
      })
      .catch((e) => {
        end();
        ui().error((e && e.message) || "Não foi possível seguir esta pessoa.");
      });
  };

  SX["sx-unfollow"] = async (el) => {
    const id = el.getAttribute("data-id");
    if (!id) return;
    const user = S().user(id);
    const name = user ? user.username : "";
    let pending = false;
    try {
      const st = api().followStatus(id);
      pending = st && st.state === "pending";
    } catch (e) {
      pending = false;
    }

    const ok = await ui().confirm(
      pending
        ? {
            title: "Cancelar solicitação",
            message: "Cancelar o pedido de seguimento para @" + name + "?",
            confirmLabel: "Cancelar solicitação",
            danger: true,
            icon: "x",
          }
        : {
            title: "Deixar de seguir",
            message: "Você deixará de seguir @" + name + ". Os contadores são atualizados na hora.",
            confirmLabel: "Deixar de seguir",
            danger: true,
            icon: "user",
          }
    );
    if (!ok) return;

    const end = ui().busy(el);
    api()
      .unfollowUser(id)
      .then(() => {
        end();
        ui().toast("Você deixou de seguir @" + name + ".", "success");
        if (followView) loadFollow();
        else repaintAfterMutation(el);
      })
      .catch((e) => {
        end();
        ui().error((e && e.message) || "Não foi possível deixar de seguir.");
      });
  };

  SX["sx-follow-approve"] = (el) => {
    const id = el.getAttribute("data-id");
    if (!id) return;
    const end = ui().busy(el);
    api()
      .approveFollow(id)
      .then(() => {
        end();
        ui().toast("Solicitação de seguimento aprovada.", "success");
        if (followView) loadFollow();
      })
      .catch((e) => {
        end();
        ui().error((e && e.message) || "Não foi possível aprovar a solicitação.");
      });
  };

  SX["sx-follow-reject"] = (el) => {
    const id = el.getAttribute("data-id");
    if (!id) return;
    const end = ui().busy(el);
    api()
      .rejectFollow(id)
      .then(() => {
        end();
        ui().toast("Solicitação recusada.", "success");
        if (followView) loadFollow();
      })
      .catch((e) => {
        end();
        ui().error((e && e.message) || "Não foi possível recusar a solicitação.");
      });
  };

  /* =========================================================
     14 · ligações globais (uma única vez por evento)
     ========================================================= */

  /* envio de formulários (composer e comentários) */
  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target;
      if (!form || !form.getAttribute) return;
      const kind = form.getAttribute("data-sx-form");
      if (!kind) return;
      e.preventDefault();
      const btn = (e && e.submitter) || form.querySelector('[type="submit"]') || null;
      try {
        if (kind === "composer") publish(form.getAttribute("data-sx-key") || "feed", btn);
        else if (kind === "comment") submitComment(form, btn);
      } catch (err) {
        console.error("[sx:submit]", err);
        ui().error("Algo deu errado ao enviar.");
      }
    },
    false
  );

  /* digitação: rascunho + contadores + pesquisa de seguidores */
  document.addEventListener(
    "input",
    (e) => {
      const el = e.target;
      if (!el || !el.getAttribute) return;
      const kind = el.getAttribute("data-sx-input");
      if (!kind) return;
      if (kind === "text") {
        const key = el.getAttribute("data-sx-key");
        if (!key) return;
        draft(key).text = el.value;
        updateCount(el, key, el.value.length);
      } else if (kind === "follow-search") {
        if (!followView) return;
        followView.query = el.value || "";
        renderFollowBody();
      }
    },
    false
  );

  /* arquivos anexados */
  document.addEventListener(
    "change",
    (e) => {
      const el = e.target;
      if (!el || !el.closest) return;
      const inp = el.closest('[data-sx-change="attach"]');
      if (!inp || !inp.files || !inp.files[0]) return;
      handleAttach(inp, inp.files[0]);
    },
    false
  );

  /* Ctrl/Cmd + Enter envia */
  document.addEventListener(
    "keydown",
    (e) => {
      if (!e || e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
      const el = e.target;
      if (!el || !el.closest) return;
      const ta = el.closest('[data-sx-input="text"]');
      if (!ta) return;
      const form = ta.closest("[data-sx-form]");
      if (!form) return;
      e.preventDefault();
      const btn = form.querySelector('[type="submit"]');
      if (typeof form.requestSubmit === "function") form.requestSubmit(btn);
      else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    },
    false
  );

  /* registro na delegação global do app (prefixo sx-) */
  Object.keys(SX).forEach((name) => NX.action(name, SX[name]));

  social.actions = SX;
  social.videoSupported = VIDEO_OK;
  social.__id = "nexo-social";

  NX.social = social;
})(window.NX);
