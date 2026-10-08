/* ============================================================
   NEXO · mídia do chat
   Emojis (unicode + personalizados do servidor), GIFs, anexos,
   reações, menu de mensagens, faixa de anexos pendentes e
   barra de resposta (reply).

   Requer, nesta ordem: core, icons, store, seed, api, ui, views.
   Exporta tudo em NX.chat e registra suas próprias ações
   (prefixo `chat-`) via NX.action.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const u = () => NX.util;
  const S = () => NX.selectors;
  const chat = {};

  /* =========================================================
     0 · utilidades internas
     ========================================================= */
  function safe(fn, fallback) {
    try {
      return fn();
    } catch (e) {
      return fallback;
    }
  }

  function messageById(id) {
    if (!id) return null;
    const db = NX.store && NX.store.db;
    return (db && db.messages && db.messages[id]) || null;
  }

  function channelOfMessage(msg) {
    if (!msg || !msg.channelId) return null;
    if (String(msg.channelId).indexOf("dm_") === 0) return null;
    return safe(() => S().channel(msg.channelId), null);
  }

  function serverIdOfMessage(msg) {
    const ch = channelOfMessage(msg);
    return ch ? ch.serverId : null;
  }

  function currentServerId() {
    const route = NX.app && NX.app.route;
    if (route && route.serverId) return route.serverId;
    return null;
  }

  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + (" " + NX.i18n.get("chat.kb", "KB"));
    return (n / (1024 * 1024)).toFixed(1) + (" " + NX.i18n.get("chat.mb", "MB"));
  }

  function bytesOf(url) {
    return Math.round(String(url || "").length * 0.75);
  }

  /* contexto de permissões de uma mensagem (usado pelo menu e pelo reply) */
  function ctxForMessage(msg) {
    const me = safe(() => S().me(), null);
    const ch = channelOfMessage(msg);
    const mine = !!(me && msg && msg.authorId === me.id);
    if (!me || !ch) {
      return {
        mine: mine,
        canModerate: false,
        canDeleteOthers: false,
        canPin: false,
        canEditOthers: false,
        canReact: true,
        canReply: true,
      };
    }
    const p = safe(() => S().effectiveChannelPerms(ch, me.id), null);
    return {
      mine: mine,
      canModerate: !!safe(() => S().canModerateMessages(ch, me.id), false),
      canDeleteOthers: !!(p && p.deleteMessages),
      canPin: !!(p && p.pinMessages),
      canEditOthers: !!(p && p.editMessages),
      canReact: !!(p && p.useEmojis),
      canReply: !!(p && p.sendMessages),
    };
  }

  chat.ctxFor = ctxForMessage;

  /* permissões do compositor no canal atual */
  function attachPerms() {
    const me = safe(() => S().me(), null);
    const route = NX.app && NX.app.route;
    if (!me) return { files: false, gifs: false, emojis: false, custom: false, serverId: null };
    if (route && route.name === "server" && route.channelId) {
      const ch = safe(() => S().channel(route.channelId), null);
      if (ch) {
        const p = safe(() => S().effectiveChannelPerms(ch, me.id), null);
        if (p) {
          return {
            files: !!p.attachFiles,
            gifs: !!p.useGifs,
            emojis: !!p.useEmojis,
            custom: !!p.useCustomEmojis,
            serverId: ch.serverId,
          };
        }
      }
    }
    return { files: true, gifs: true, emojis: true, custom: true, serverId: route ? route.serverId || null : null };
  }

  /* =========================================================
     1 · emojify — tokens <:nome:> → <img> do servidor
     ========================================================= */
  const TOKEN_ESCAPED = /&lt;:([a-z0-9_\-.]{1,32}):&gt;/gi;
  const TOKEN_RAW = /<:([a-z0-9_\-.]{1,32}):>/gi;

  chat.emojify = function (html, serverId) {
    let out = html == null ? "" : String(html);
    const render = (raw) => {
      const name = String(raw || "").toLowerCase();
      if (!serverId) return null;
      const e = safe(() => S().emojiByName(serverId, name), null);
      if (!e || !e.image) return null;
      return (
        '<img class="chat-emoji cm-emoji" src="' +
        u().h(e.image) +
        '" alt=":' +
        u().h(name) +
        ':" title=":' +
        u().h(name) +
        ':" draggable="false">'
      );
    };
    out = out.replace(TOKEN_ESCAPED, (m, name) => render(name) || m);
    out = out.replace(TOKEN_RAW, (m, name) => render(name) || m);
    return out;
  };

  /* =========================================================
     2 · anexos
     ========================================================= */
  const attCache = {};

  chat.attachmentsHTML = function (msg) {
    if (!msg) return "";
    const list = Array.isArray(msg.attachments) ? msg.attachments : [];
    if (!list.length) return "";
    if (msg.id) attCache[msg.id] = list;
    return '<div class="cm-atts">' + list.map((a, i) => attHTML(msg, a, i)).join("") + "</div>";
  };

  function attHTML(msg, a, i) {
    const type = a && a.type === "gif" ? "gif" : (a && a.type) || "file";
    const id = u().h(msg && msg.id ? msg.id : "");
    const idx = String(i);
    const name = u().h((a && a.name) || "arquivo");
    const url = u().h((a && a.url) || "");

    if (type === "image" || type === "gif") {
      return (
        '<button type="button" class="cm-att cm-att--img' + (type === "gif" ? " is-gif" : "") +
        '" data-action="chat-preview" data-id="' + id + '" data-idx="' + idx +
        '" aria-label="' + NX.i18n.get("ui.a11yampliar", "Ampliar ") + name + '">' +
        '<img class="cm-att__img" src="' + url + '" alt="' + name + '" loading="lazy" decoding="async">' +
        (type === "gif" ? ("<span class=\"cm-att__badge\">" + NX.i18n.get("chat.gif", "GIF") + "</span>") : "") +
        '<span class="cm-att__zoom" aria-hidden="true">' + NX.icon("search", "", 15) + "</span>" +
        "</button>"
      );
    }

    if (type === "video") {
      return (
        '<div class="cm-att cm-att--video">' +
        '<video class="cm-att__video" controls preload="metadata" playsinline src="' + url +
        '" aria-label="' + name + '"></video>' +
        '<span class="cm-att__caption">' + name + (a && a.size ? " · " + fmtSize(a.size) : "") + "</span>" +
        "</div>"
      );
    }

    return (
      '<button type="button" class="cm-att cm-att--file" data-action="chat-preview" data-id="' + id +
      '" data-idx="' + idx + '" aria-label="' + NX.i18n.get("ui.a11yabrirarquivo", "Abrir arquivo ") + name + '">' +
      '<span class="cm-att__ico">' + NX.icon("folder", "", 20) + "</span>" +
      '<span class="cm-att__meta"><strong class="truncate">' + name + "</strong><small>" +
      fmtSize((a && a.size) || 0) + "</small></span>" +
      '<span class="cm-att__go" aria-hidden="true">' + NX.icon("chevronRight", "", 16) + "</span>" +
      "</button>"
    );
  }

  function openAttachmentPreview(a) {
    if (!a) return;
    const name = a.name || "anexo";
    let inner = "";
    if (a.type === "image" || a.type === "gif") {
      inner =
        '<div class="cm-view"><img class="cm-view__img" src="' + u().h(a.url) +
        '" alt="' + u().h(name) + '"></div>';
    } else if (a.type === "video") {
      inner =
        '<div class="cm-view"><video class="cm-view__video" controls playsinline src="' +
        u().h(a.url) + '"></video></div>';
    } else {
      inner =
        '<div class="cm-filecard"><span class="cm-filecard__ico">' + NX.icon("folder", "", 26) +
        '</span><span class="cm-filecard__txt"><strong class="truncate">' + u().h(name) +
        "</strong><small>" + fmtSize(a.size || 0) + "</small></span></div>" +
        (/^(https?:|data:|blob:)/i.test(a.url || "")
          ? '<p class="cm-view__note"><a href="' + u().h(a.url) +
            ("\" target=\"_blank\" rel=\"noopener noreferrer\">" + NX.i18n.get("chat.abriremnovaaba", "Abrir em nova aba") + "</a></p>")
          : "");
    }
    const m = NX.ui.modal({
      title: name,
      size: "md",
      eyebrow: a.type === "gif" ? (NX.i18n.get("chat.gif", "GIF")) : a.type === "video" ? (NX.i18n.get("chat.video", "Vídeo")) : a.type === "image" ? (NX.i18n.get("chat.imagem", "Imagem")) : (NX.i18n.get("chat.arquivo", "Arquivo")),
    });
    m.body.innerHTML = inner;
  }

  /* =========================================================
     3 · reações
     ========================================================= */
  function fallbackSummary(msg, meId) {
    const out = [];
    const r = (msg && msg.reactions) || {};
    Object.keys(r).forEach((k) => {
      const list = r[k] || [];
      if (list.length) out.push({ emoji: k, count: list.length, mine: meId ? list.indexOf(meId) !== -1 : false });
    });
    return out.sort((a, b) => b.count - a.count);
  }

  function reactionFace(emoji, serverId) {
    const m = /^<:([a-z0-9_\-.]{1,32}):>$/i.exec(String(emoji || ""));
    if (!m) return u().h(emoji);
    const e = serverId ? safe(() => S().emojiByName(serverId, m[1]), null) : null;
    if (e && e.image) {
      return '<img class="cm-react__img" src="' + u().h(e.image) + '" alt=":' + u().h(m[1]) + ':">';
    }
    return u().h(emoji);
  }

  chat.reactionsHTML = function (msg, ctx) {
    if (!msg) return "";
    ctx = ctx || {};
    const me = safe(() => S().me(), null);
    const canReact = ctx.canReact !== false;
    const serverId = serverIdOfMessage(msg);
    const summary =
      safe(() => S().reactionSummary(msg, me ? me.id : null), null) || fallbackSummary(msg, me ? me.id : null);

    if (!summary.length && !canReact) return "";

    const chips = summary
      .map((r) => {
        const face = reactionFace(r.emoji, serverId);
        return (
          '<button type="button" class="cm-react' + (r.mine ? " is-mine" : "") +
          '" data-action="chat-react" data-id="' + u().h(msg.id) +
          '" data-emoji="' + u().h(r.emoji) + '" aria-pressed="' + (r.mine ? "true" : "false") +
          '" aria-label="Reagir com ' + u().h(r.emoji) + " · " + r.count +
          (r.count === 1 ? (" " + NX.i18n.get("chat.reacao", "reação")) : (" " + NX.i18n.get("chat.reacoes", "reações"))) + '"' +
          (canReact ? "" : " disabled") +
          '><span class="cm-react__e">' + face +
          '</span><b class="cm-react__n">' + r.count + "</b></button>"
        );
      })
      .join("");

    const add = canReact
      ? '<button type="button" class="cm-react cm-react--add" data-action="chat-react-add" data-id="' +
        u().h(msg.id) + '" aria-label="' + NX.i18n.get("ui.adicionarreacao", "Adicionar reação") + '" title="' + NX.i18n.get("ui.chatmedia.adicionarreacao", "Adicionar reação") + '">➕</button>'
      : "";

    return '<div class="cm-reacts">' + chips + add + "</div>";
  };

  /* =========================================================
     4 · menu da mensagem
     ========================================================= */

  /* O botão ⋯ das mensagens só existe em :hover (display:none). Se o
     menu/painel for aberto sem o ponteiro sobre a mensagem, o retângulo
     do botão é 0×0 e o NX.ui desenharia tudo no canto da tela — nesses
     casos ancoramos na própria mensagem. */
  function visibleAnchor(el) {
    if (!el || el.nodeType !== 1) return el;
    const r = el.getBoundingClientRect();
    if (r.width || r.height) return el;
    return el.closest(".msg") || el.parentElement || el;
  }

  chat.messageMenu = function (anchor, msg, ctx) {
    if (!anchor || !msg) return null;
    ctx = ctx || ctxForMessage(msg);
    const mine = !!ctx.mine;
    const canDelete = mine || !!ctx.canDeleteOthers;
    const canEdit = mine || !!ctx.canEditOthers;
    const canPin = !!ctx.canPin || mine;
    const canReact = ctx.canReact !== false;
    const canReply = ctx.canReply !== false;
    const hasChannel = !!channelOfMessage(msg);
    const serverId = serverIdOfMessage(msg);
    const items = [];

    if (canReply) {
      items.push({
        icon: "chat",
        label: (NX.i18n.get("chat.responder", "Responder")),
        onClick: () => chat.setReply(msg, ctx),
      });
    }

    if (canReact) {
      items.push({
        icon: "smile",
        label: (NX.i18n.get("chat.reagir", "Reagir")),
        onClick: () =>
          chat.openEmojiPicker(
            anchor,
            (emoji) => {
              NX.api.toggleReaction(msg.id, emoji).catch((e) => {
                NX.ui.error((e && e.message) || NX.i18n.get("chat.naoFoiPossivelReagir3", "Não foi possível reagir."));
              });
            },
            { serverId: serverId }
          ),
      });
    }

    items.push({
      icon: "copy",
      label: NX.i18n.get("chat.copiarTexto", "Copiar texto"),
      onClick: () => {
        u()
          .copy(msg.content || "")
          .then((ok) => {
            if (ok) NX.ui.success(NX.i18n.get("chat.mensagemCopiada", "Mensagem copiada."));
            else NX.ui.error(NX.i18n.get("adm.naoFoiPossivelCopiar2", "Não foi possível copiar."));
          });
      },
    });

    items.push({ divider: true });

    if (canEdit) {
      items.push({
        icon: "pencil",
        label: (NX.i18n.get("common.edit", "Editar")),
        onClick: () => {
          if (!NX.views) return;
          NX.views.editingMessageId = msg.id;
          NX.views.render(["messages"]);
        },
      });
    }

    if (hasChannel && canPin) {
      items.push({
        icon: "star",
        label: msg.pinned ? (NX.i18n.get("chat.desfixar", "Desfixar")) : NX.i18n.get("chat.fixarMensagem", "Fixar mensagem"),
        onClick: async () => {
          const next = !msg.pinned;
          try {
            await NX.api.pinMessage(msg.id, next);
            NX.ui.toast(next ? NX.i18n.get("chat.mensagemFixadaCanal", "Mensagem fixada no canal.") : NX.i18n.get("chat.mensagemDesfixada", "Mensagem desfixada."), "success");
          } catch (e) {
            NX.ui.error((e && e.message) || NX.i18n.get("chat.naoFoiPossivelFixar", "Não foi possível fixar a mensagem."));
          }
        },
      });
    }

    if (!mine) {
      items.push({ icon: "alert", label: (NX.i18n.get("chat.denunciar", "Denunciar")), onClick: () => openReport(msg) });
    }

    items.push({ divider: true });

    if (canDelete) {
      items.push({
        icon: "trash",
        label: (NX.i18n.get("common.delete", "Excluir")),
        danger: true,
        onClick: async () => {
          const ok = await NX.ui.confirm({
            title: NX.i18n.get("app.apagarMensagem", "Apagar mensagem"),
            message: NX.i18n.get("app.estaMensagemSeraApagada", "Esta mensagem será apagada para todos. Não dá para desfazer."),
            confirmLabel: (NX.i18n.get("app.apagar", "Apagar")),
            danger: true,
            icon: "trash",
          });
          if (!ok) return;
          try {
            await NX.api.deleteMessage(msg.id);
            NX.ui.toast(NX.i18n.get("app.mensagemApagada", "Mensagem apagada."), "success");
          } catch (e) {
            NX.ui.error((e && e.message) || NX.i18n.get("chat.naoFoiPossivelApagar", "Não foi possível apagar."));
          }
        },
      });
    }

    if (items.length === 1 && items[0].divider) return null;
    return NX.ui.menu(visibleAnchor(anchor), items, { align: "end", gap: 8 });
  };

  function openReport(msg) {
    const actions = u().el('<div class="modal__actions"></div>');
    const cancel = u().el(("<button class=\"btn btn--ghost\" type=\"button\">" + NX.i18n.get("common.cancel", "Cancelar") + "</button>"));
    const send = u().el(("<button class=\"btn btn--primary\" type=\"button\">" + NX.i18n.get("chat.enviardenuncia", "Enviar denúncia") + "</button>"));
    actions.appendChild(cancel);
    actions.appendChild(send);

    const m = NX.ui.modal({
      title: NX.i18n.get("chat.denunciarMensagem", "Denunciar mensagem"),
      eyebrow: (NX.i18n.get("adm.moderacao", "Moderação")),
      size: "sm",
      footer: actions,
    });

    m.body.innerHTML =
      ("<p class=\"cm-report__lead\">" + NX.i18n.get("chat.conteoqueaconteceuaequipe", "Conte o que aconteceu. A equipe do servidor recebe sua denúncia e decide o próximo passo.") + "</p>") +
      ("<div class=\"field\"><label class=\"field__label\" for=\"cm-report-reason\">" + NX.i18n.get("adm.motivo", "Motivo") + " " + "<em>" + NX.i18n.get("chat.obrigatorio", "obrigatório") + "</em></label>") +
      '<textarea class="input--area" id="cm-report-reason" data-autofocus maxlength="200" ' +
      'placeholder="' + NX.i18n.get("ui.exspamconteudoimproprioassedio", "Ex.: spam, conteúdo impróprio, assédio...") + '"></textarea>' +
      ("<div class=\"field__hint\">" + NX.i18n.get("chat.ate200caracteres", "Até 200 caracteres.") + "</div></div>");

    cancel.addEventListener("click", () => m.close());
    send.addEventListener("click", async () => {
      const ta = m.body.querySelector("#cm-report-reason");
      const reason = ((ta && ta.value) || "").trim();
      if (!reason) {
        NX.ui.error(NX.i18n.get("chat.escrevaMotivoDenuncia", "Escreva o motivo da denúncia."));
        if (ta) ta.focus();
        return;
      }
      send.disabled = true;
      try {
        await NX.api.reportMessage(msg.id, reason);
        m.close();
        NX.ui.success(NX.i18n.get("chat.denunciaEnviadaObrigado", "Denúncia enviada. Obrigado!"));
      } catch (e) {
        send.disabled = false;
        NX.ui.error((e && e.message) || NX.i18n.get("chat.naoFoiPossivelEnviar", "Não foi possível enviar a denúncia."));
      }
    });
  }

  /* =========================================================
     5 · banco de emojis (categorias)
     ========================================================= */
  const EMOJI_CATS = [
    {
      id: "rostos",
      icon: "😀",
      label: (NX.i18n.get("chat.rostos", "Rostos")),
      items: [
        (NX.i18n.get("chat.grinningrisosorrindosmile", "😀|grinning riso sorrindo smile")),
        (NX.i18n.get("chat.sorrisograndehappy", "😃|sorriso grande happy")),
        (NX.i18n.get("chat.risoalegrelaugh", "😄|riso alegre laugh")),
        (NX.i18n.get("chat.sorrindogrin", "😁|sorrindo grin")),
        (NX.i18n.get("chat.risadaxdlaugh", "😆|risada XD laugh")),
        (NX.i18n.get("chat.chorandoderirfunnylloro", "😂|chorando de rir funny lloro")),
        (NX.i18n.get("chat.morrendoderirrofl", "🤣|morrendo de rir rofl")),
        (NX.i18n.get("chat.suoraliviorelief", "😅|suor alivio relief")),
        (NX.i18n.get("chat.piscadawink", "😉|piscada wink")),
        (NX.i18n.get("chat.sorrizoblush", "😊|sorrizo blush")),
        (NX.i18n.get("chat.anjoangel", "😇|anjo angel")),
        (NX.i18n.get("chat.meiosorrindoslightsmile", "🙂|meio sorrindo slight smile")),
        (NX.i18n.get("chat.decabecaprabaixoupside", "🙃|de cabeca pra baixo upside")),
        (NX.i18n.get("chat.doidozanymaluco", "🤪|doido zany maluco")),
        (NX.i18n.get("chat.piscandolinguasilly", "😜|piscando lingua silly")),
        (NX.i18n.get("chat.bocaabertaplayful", "😝|boca aberta playful")),
        (NX.i18n.get("chat.legalcool", "😎|legal cool")),
        (NX.i18n.get("chat.nerdinteligente", "🤓|nerd inteligente")),
        (NX.i18n.get("chat.festapartyaniversario", "🥳|festa party aniversario")),
        (NX.i18n.get("chat.dormindosleepsono", "😴|dormindo sleep sono")),
        (NX.i18n.get("chat.tirandovaporfrustrated", "😤|tirando vapor frustrated")),
        (NX.i18n.get("chat.raivaangrybravo", "😡|raiva angry bravo")),
        (NX.i18n.get("chat.chorandosadtriste", "😭|chorando sad triste")),
        (NX.i18n.get("chat.implorandopleadingolhos", "🥺|implorando pleading olhos")),
      ],
    },
    {
      id: "emocoes",
      icon: "❤️",
      label: (NX.i18n.get("chat.emocoes", "Emoções")),
      items: [
        (NX.i18n.get("chat.coracaolovevermelho", "❤️|coracao love vermelho")),
        (NX.i18n.get("chat.coracaolaranja", "🧡|coracao laranja")),
        (NX.i18n.get("chat.coracaoamarelo", "💛|coracao amarelo")),
        (NX.i18n.get("chat.coracaoverde", "💚|coracao verde")),
        (NX.i18n.get("chat.coracaoazul", "💙|coracao azul")),
        (NX.i18n.get("chat.coracaoroxo", "💜|coracao roxo")),
        (NX.i18n.get("chat.coracaopreto", "🖤|coracao preto")),
        (NX.i18n.get("chat.coracaobranco", "🤍|coracao branco")),
        (NX.i18n.get("chat.coracaopartidobroken", "💔|coracao partido broken")),
        (NX.i18n.get("chat.coracaobrilhantesparkle", "💖|coracao brilhante sparkle")),
        (NX.i18n.get("chat.coracaocrescentegrowing", "💗|coracao crescente growing")),
        (NX.i18n.get("chat.doiscoracoeslove", "💕|dois coracoes love")),
        (NX.i18n.get("chat.coracoesorbitando", "💞|coracoes orbitando")),
        (NX.i18n.get("chat.coracaopulsantebeating", "💓|coracao pulsante beating")),
        (NX.i18n.get("chat.cartaamorletter", "💌|carta amor letter")),
        (NX.i18n.get("chat.apaixonadocrushamor", "😍|apaixonado crush amor")),
        (NX.i18n.get("chat.abracocarinhocute", "🥰|abraco carinho cute")),
        (NX.i18n.get("chat.beijokiss", "😘|beijo kiss")),
        (NX.i18n.get("chat.saudadesentimental", "🥺|saudade sentimental")),
        (NX.i18n.get("chat.gritosurpresashock", "😱|grito surpresa shock")),
        (NX.i18n.get("chat.olhosdeestrelastarry", "🤩|olhos de estrela starry")),
        (NX.i18n.get("chat.gratidaothanks", "😇|gratidao thanks")),
        (NX.i18n.get("chat.fogofire", "🔥|fogo fire")),
        (NX.i18n.get("chat.brilhossparkles", "✨|brilhos sparkles")),
      ],
    },
    {
      id: "gestos",
      icon: "👍",
      label: (NX.i18n.get("chat.gestos", "Gestos")),
      items: [
        (NX.i18n.get("chat.simokaprovarlikepolegar", "👍|sim ok aprovar like polegar")),
        (NX.i18n.get("chat.naodesaprovarnope", "👎|nao desaprovar nope")),
        (NX.i18n.get("chat.okperfeito", "👌|ok perfeito")),
        (NX.i18n.get("chat.pazvitoriapeace", "✌️|paz vitoria peace")),
        (NX.i18n.get("chat.dedoscruzadosluck", "🤞|dedos cruzados luck")),
        (NX.i18n.get("chat.rockchifres", "🤘|rock chifres")),
        (NX.i18n.get("chat.meligacall", "🤙|me liga call")),
        (NX.i18n.get("chat.esquerdaapontar", "👈|esquerda apontar")),
        (NX.i18n.get("chat.direitaapontar", "👉|direita apontar")),
        (NX.i18n.get("chat.pracimaindex", "☝️|pra cima index")),
        (NX.i18n.get("chat.coracaomaoshearthands", "🫶|coracao maos heart hands")),
        (NX.i18n.get("chat.palmasaplausosclap", "👏|palmas aplausos clap")),
        (NX.i18n.get("chat.obrigadoporfavorpleasenamaste", "🙏|obrigado por favor please namaste")),
        (NX.i18n.get("chat.apertodemaoshandshake", "🤝|aperto de maos handshake")),
        (NX.i18n.get("chat.forcamuscletreino", "💪|forca muscle treino")),
        (NX.i18n.get("chat.maoabertastop", "✋|mao aberta stop")),
        (NX.i18n.get("chat.maocomdedos", "🖐️|mao com dedos")),
        (NX.i18n.get("chat.acenarwaveoi", "👋|acenar wave oi")),
        (NX.i18n.get("chat.palmalevantada", "🤚|palma levantada")),
        (NX.i18n.get("chat.apertodededos", "🤌|aperto de dedos")),
        (NX.i18n.get("chat.dinheiromoney", "🫰|dinheiro money")),
        (NX.i18n.get("chat.simpessoaok", "🙆|sim pessoa ok")),
        (NX.i18n.get("chat.naopessoano", "🙅|nao pessoa no")),
        (NX.i18n.get("chat.maolevantadapergunta", "🙋|mao levantada pergunta")),
      ],
    },
    {
      id: "animais",
      icon: "🐶",
      label: (NX.i18n.get("chat.animais", "Animais")),
      items: [
        (NX.i18n.get("chat.cachorrodogpet", "🐶|cachorro dog pet")),
        (NX.i18n.get("chat.gatocatpet", "🐱|gato cat pet")),
        (NX.i18n.get("chat.ratomouse", "🐭|rato mouse")),
        "🐹|hamster",
        (NX.i18n.get("chat.coelhorabbit", "🐰|coelho rabbit")),
        (NX.i18n.get("chat.raposafox", "🦊|raposa fox")),
        (NX.i18n.get("chat.ursobear", "🐻|urso bear")),
        "🐼|panda",
        "🐨|koala",
        (NX.i18n.get("chat.tigretiger", "🐯|tigre tiger")),
        (NX.i18n.get("chat.leaolion", "🦁|leao lion")),
        (NX.i18n.get("chat.vacacow", "🐮|vaca cow")),
        (NX.i18n.get("chat.porcopig", "🐷|porco pig")),
        (NX.i18n.get("chat.sapofrog", "🐸|sapo frog")),
        (NX.i18n.get("chat.galinhachicken", "🐔|galinha chicken")),
        (NX.i18n.get("chat.pinguimpenguin", "🐧|pinguim penguin")),
        (NX.i18n.get("chat.passarobird", "🐦|passaro bird")),
        (NX.i18n.get("chat.aguiaeagle", "🦅|aguia eagle")),
        (NX.i18n.get("chat.corujaowl", "🦉|coruja owl")),
        (NX.i18n.get("chat.borboletabutterfly", "🦋|borboleta butterfly")),
        (NX.i18n.get("chat.abelhabee", "🐝|abelha bee")),
        (NX.i18n.get("chat.joaninhaladybug", "🐞|joaninha ladybug")),
        (NX.i18n.get("chat.tartarugaturtle", "🐢|tartaruga turtle")),
        (NX.i18n.get("chat.polvooctopus", "🐙|polvo octopus")),
      ],
    },
    {
      id: "comida",
      icon: "🍔",
      label: (NX.i18n.get("chat.comida", "Comida")),
      items: [
        (NX.i18n.get("chat.hamburguerburger", "🍔|hamburguer burger")),
        (NX.i18n.get("chat.batatafritafries", "🍟|batata frita fries")),
        "🍕|pizza",
        (NX.i18n.get("chat.cachorroquentehotdog", "🌭|cachorro quente hotdog")),
        (NX.i18n.get("chat.sanduichesandwich", "🥪|sanduiche sandwich")),
        "🌮|taco",
        "🌯|burrito",
        (NX.i18n.get("chat.pitawrap", "🥙|pita wrap")),
        (NX.i18n.get("chat.ramenmacarrao", "🍜|ramen macarrao")),
        "🍣|sushi",
        "🍛|curry",
        (NX.i18n.get("chat.arrozrice", "🍚|arroz rice")),
        (NX.i18n.get("chat.espetinhoyakitori", "🍢|espetinho yakitori")),
        (NX.i18n.get("chat.donutrosca", "🍩|donut rosca")),
        (NX.i18n.get("chat.bolocake", "🍰|bolo cake")),
        (NX.i18n.get("chat.biscoitocookie", "🍪|biscoito cookie")),
        "🍫|chocolate",
        (NX.i18n.get("chat.balacandy", "🍬|bala candy")),
        (NX.i18n.get("chat.pirulitolollipop", "🍭|pirulito lollipop")),
        (NX.i18n.get("chat.cafecoffee", "☕|cafe coffee")),
        (NX.i18n.get("chat.bubblechamilktea", "🧋|bubble cha milktea")),
        (NX.i18n.get("chat.refrigerantedrink", "🥤|refrigerante drink")),
        (NX.i18n.get("chat.cervejabeer", "🍺|cerveja beer")),
        (NX.i18n.get("chat.sorveteicecream", "🍦|sorvete icecream")),
      ],
    },
    {
      id: "esportes",
      icon: "⚽",
      label: (NX.i18n.get("chat.esportes", "Esportes")),
      items: [
        (NX.i18n.get("chat.futebolsoccerbola", "⚽|futebol soccer bola")),
        (NX.i18n.get("chat.basquetebasketball", "🏀|basquete basketball")),
        (NX.i18n.get("chat.futebolamericano", "🏈|futebol americano")),
        (NX.i18n.get("chat.beisebolbaseball", "⚾|beisebol baseball")),
        (NX.i18n.get("chat.tenistennisbola", "🎾|tenis tennis bola")),
        "🏸|badminton",
        (NX.i18n.get("chat.esquiski", "🎿|esqui ski")),
        (NX.i18n.get("chat.esquialpino", "⛷️|esqui alpino")),
        "🏂|snowboard",
        "🏄|surf",
        (NX.i18n.get("chat.natacaoswim", "🏊|natacao swim")),
        (NX.i18n.get("chat.bicicletabike", "🚴|bicicleta bike")),
        (NX.i18n.get("chat.boxeboxingluvas", "🥊|boxe boxing luvas")),
        (NX.i18n.get("chat.musculacaopeso", "🏋️|musculacao peso")),
        "🤸|ginastica",
        (NX.i18n.get("chat.dardoalvotarget", "🎯|dardo alvo target")),
        (NX.i18n.get("chat.bolichebowling", "🎳|boliche bowling")),
        (NX.i18n.get("chat.lutawrestling", "🤼|luta wrestling")),
        (NX.i18n.get("chat.trofeutrofeo", "🏆|trofeu trofeo")),
        (NX.i18n.get("chat.medalhaourogold", "🥇|medalha ouro gold")),
        (NX.i18n.get("chat.medalhapratasilver", "🥈|medalha prata silver")),
        (NX.i18n.get("chat.medalhabronze", "🥉|medalha bronze")),
        (NX.i18n.get("chat.medalhamedal", "🏅|medalha medal")),
        (NX.i18n.get("chat.golgoalrede", "🥅|gol goal rede")),
      ],
    },
    {
      id: "jogos",
      icon: "🎮",
      label: (NX.i18n.get("chat.jogos", "Jogos")),
      items: [
        (NX.i18n.get("chat.controlegamegamer", "🎮|controle game gamer")),
        (NX.i18n.get("chat.joystickarcade", "🕹️|joystick arcade")),
        (NX.i18n.get("chat.dadodicesorte", "🎲|dado dice sorte")),
        (NX.i18n.get("chat.alvodarts", "🎯|alvo darts")),
        (NX.i18n.get("chat.quebracabecapuzzle", "🧩|quebra cabeca puzzle")),
        (NX.i18n.get("chat.cartasjoker", "🃏|cartas joker")),
        (NX.i18n.get("chat.xadrezchess", "♟️|xadrez chess")),
        (NX.i18n.get("chat.bolaoitopool", "🎱|bola oito pool")),
        (NX.i18n.get("chat.pescariafishing", "🎣|pescaria fishing")),
        (NX.i18n.get("chat.arcoarrow", "🏹|arco arrow")),
        (NX.i18n.get("chat.espadasswordbatalha", "⚔️|espadas sword batalha")),
        (NX.i18n.get("chat.escudoshield", "🛡️|escudo shield")),
        (NX.i18n.get("chat.adagadagger", "🗡️|adaga dagger")),
        (NX.i18n.get("chat.varinhamagic", "🪄|varinha magic")),
        (NX.i18n.get("chat.boladecristal", "🔮|bola de cristal")),
        (NX.i18n.get("chat.circocircus", "🎪|circo circus")),
        (NX.i18n.get("chat.rodagigante", "🎡|roda gigante")),
        "🎠|carrossel",
        (NX.i18n.get("chat.montanharussa", "🎢|montanha russa")),
        (NX.i18n.get("chat.cacaniquelluck", "🎰|caça niquel luck")),
        (NX.i18n.get("chat.ioio", "🪀|io io")),
        (NX.i18n.get("chat.ingressoticket", "🎫|ingresso ticket")),
        (NX.i18n.get("chat.pipakite", "🪁|pipa kite")),
        (NX.i18n.get("chat.discoballfesta", "🪩|disco ball festa")),
      ],
    },
    {
      id: "objetos",
      icon: "🚗",
      label: (NX.i18n.get("chat.objetos", "Objetos")),
      items: [
        (NX.i18n.get("chat.carrocar", "🚗|carro car")),
        "🚕|taxi",
        (NX.i18n.get("chat.suvcarro", "🚙|suv carro")),
        (NX.i18n.get("chat.onibusbus", "🚌|onibus bus")),
        (NX.i18n.get("chat.caminhaotruck", "🚚|caminhao truck")),
        (NX.i18n.get("chat.caminhaogrande", "🚛|caminhao grande")),
        (NX.i18n.get("chat.motomotoqueiro", "🏍️|moto motoqueiro")),
        (NX.i18n.get("chat.bicicletabike2", "🚲|bicicleta bike")),
        (NX.i18n.get("chat.aviaoplaneviagem", "✈️|aviao plane viagem")),
        (NX.i18n.get("chat.fogueterocket", "🚀|foguete rocket")),
        (NX.i18n.get("chat.ovniufo", "🛸|ovni ufo")),
        "🚁|helicoptero",
        (NX.i18n.get("chat.barcoavela", "⛵|barco a vela")),
        (NX.i18n.get("chat.navioship", "🚢|navio ship")),
        "🗺️|mapa",
        (NX.i18n.get("chat.camerafoto", "📷|camera foto")),
        (NX.i18n.get("chat.celularphone", "📱|celular phone")),
        (NX.i18n.get("chat.notebooklaptop", "💻|notebook laptop")),
        (NX.i18n.get("chat.tecladokeyboard", "⌨️|teclado keyboard")),
        (NX.i18n.get("chat.mouseclique", "🖱️|mouse clique")),
        (NX.i18n.get("chat.lampadaideialight", "💡|lampada ideia light")),
        (NX.i18n.get("chat.chavekey", "🔑|chave key")),
        (NX.i18n.get("chat.despertadorrelogio", "⏰|despertador relogio")),
        (NX.i18n.get("chat.presentegift", "🎁|presente gift")),
      ],
    },
    {
      id: "outros",
      icon: "✨",
      label: (NX.i18n.get("chat.outros", "Outros")),
      items: [
        (NX.i18n.get("chat.brilhossparkles", "✨|brilhos sparkles")),
        (NX.i18n.get("chat.arcoirisrainbow", "🌈|arco iris rainbow")),
        (NX.i18n.get("chat.estrelastar", "⭐|estrela star")),
        (NX.i18n.get("chat.estrelabrilhante", "🌟|estrela brilhante")),
        (NX.i18n.get("chat.girandodizzy", "💫|girando dizzy")),
        (NX.i18n.get("chat.luamoon", "🌙|lua moon")),
        (NX.i18n.get("chat.solsun", "☀️|sol sun")),
        (NX.i18n.get("chat.nuvemtempo", "⛅|nuvem tempo")),
        (NX.i18n.get("chat.nevesnowfrio", "❄️|neve snow frio")),
        (NX.i18n.get("chat.ondawavemar", "🌊|onda wave mar")),
        (NX.i18n.get("chat.brotoplant", "🌱|broto plant")),
        "🌵|cacto",
        "🌴|palmeira",
        (NX.i18n.get("chat.fogofire", "🔥|fogo fire")),
        (NX.i18n.get("chat.gotaagua", "💧|gota agua")),
        (NX.i18n.get("chat.raiolightning", "⚡|raio lightning")),
        (NX.i18n.get("chat.terraworld", "🌍|terra world")),
        (NX.i18n.get("chat.planetasaturno", "🪐|planeta saturno")),
        "🛰️|satelite",
        "🔭|telescopio",
        (NX.i18n.get("chat.cerebrobrain", "🧠|cerebro brain")),
        (NX.i18n.get("chat.robotorobot", "🤖|roboto robot")),
        (NX.i18n.get("chat.diamantegem", "💎|diamante gem")),
        (NX.i18n.get("chat.musicamusic", "🎵|musica music")),
      ],
    },
  ];

  const EMOJI_INDEX = [];
  EMOJI_CATS.forEach((cat) => {
    cat.items.forEach((raw) => {
      const bar = raw.indexOf("|");
      const emoji = bar === -1 ? raw : raw.slice(0, bar);
      const names = bar === -1 ? "" : raw.slice(bar + 1);
      EMOJI_INDEX.push({
        emoji: emoji,
        names: names,
        label: cat.label,
        cat: cat.id,
        hay: u().normalize(cat.label + " " + names + " " + emoji),
      });
    });
  });

  chat.emojiCount = EMOJI_INDEX.length;
  chat.emojiCategories = () => EMOJI_CATS.map((c) => ({ id: c.id, icon: c.icon, label: c.label }));

  /* =========================================================
     6 · painel de emojis
     ========================================================= */
  function serverEmojiList(serverId, wantCustom) {
    if (!serverId || wantCustom === false) return [];
    const list = safe(() => S().serverEmojis(serverId), []) || [];
    return list;
  }

  chat.openEmojiPicker = function (anchor, onPick, opts) {
    anchor = visibleAnchor(anchor);
    if (!anchor) return null;
    opts = opts || {};
    const serverId = opts.serverId || null;
    const perms = attachPerms();
    const showServer = !!serverId && (opts.server !== false);
    let tab = opts.tab || "geral";
    let query = "";

    if (tab === "server" && !showServer) tab = "geral";

    const tabs = [{ id: "geral", icon: "😀", label: NX.i18n.get("chat.rostosCategorias", "Rostos e categorias") }].concat(
      EMOJI_CATS.slice(1).map((c) => ({ id: c.id, icon: c.icon, label: c.label })),
      showServer ? [{ id: "server", icon: "⭐", label: NX.i18n.get("chat.servidor", "Do servidor") }] : []
    );

    const tabsHTML = tabs
      .map(
        (t) =>
          '<button type="button" class="cm-picker__tab' + (t.id === tab ? " is-on" : "") +
          '" role="tab" data-cat="' + t.id + '" aria-selected="' + (t.id === tab ? "true" : "false") +
          '" aria-label="' + u().h(t.label) + '" title="' + u().h(t.label) + '">' +
          '<span aria-hidden="true">' + t.icon + "</span></button>"
      )
      .join("");

    const html =
      '<div class="cm-picker" role="dialog" aria-label="' + NX.i18n.get("ui.seletordeemojis", "Seletor de emojis") + '">' +
      '<div class="cm-picker__head"><div class="cm-search">' +
      NX.icon("search", "cm-search__ico", 16) +
      '<input type="search" class="cm-search__input" data-cm-search placeholder="' + NX.i18n.get("ui.buscaremoji", "Buscar emoji") + '" ' +
      'aria-label="' + NX.i18n.get("ui.chatmedia.buscaremoji", "Buscar emoji") + '" autocomplete="off" spellcheck="false"></div></div>' +
      '<div class="cm-picker__tabs" role="tablist" aria-label="' + NX.i18n.get("ui.categoriasdeemoji", "Categorias de emoji") + '">' + tabsHTML + "</div>" +
      '<div class="cm-picker__body"><div class="cm-picker__grid" data-cm-grid role="grid" ' +
      'aria-label="' + NX.i18n.get("adm.emojis", "Emojis") + '"></div></div>' +
      '<div class="cm-picker__foot"><span class="cm-picker__preview" data-cm-preview aria-live="polite">' +
      (NX.i18n.get("chat.escolhaumemoji", "Escolha um emoji") + "</span></div>") +
      "</div>";

    const el = NX.ui.popout(anchor, html, {
      cls: "cm-pop cm-pop--emoji",
      side: opts.side || "bottom",
      gap: opts.gap === undefined ? 10 : opts.gap,
      align: opts.align || "start",
    });
    if (!el) return null;

    const grid = el.querySelector("[data-cm-grid]");
    const preview = el.querySelector("[data-cm-preview]");
    const input = el.querySelector("[data-cm-search]");

    function cellHTML(e) {
      return (
        '<button type="button" class="cm-emj" role="gridcell" data-e="' + u().h(e.emoji) +
        '" data-name="' + u().h(e.names) + '" aria-label="' + u().h(e.names) + '">' +
        '<span class="cm-emj__g" aria-hidden="true">' + u().h(e.emoji) + "</span></button>"
      );
    }

    function serverCellHTML(em) {
      return (
        '<button type="button" class="cm-emj cm-emj--custom" role="gridcell" data-token="' +
        u().h("<:" + em.name + ":>") + '" data-name="' + u().h(":" + em.name + ":") +
        '" aria-label="Emoji do servidor ' + u().h(em.name) + '">' +
        '<img class="cm-emj__img" src="' + u().h(em.image) + '" alt="' + u().h(":" + em.name + ":") + '" loading="lazy">' +
        "</button>"
      );
    }

    function renderGrid() {
      let cells = "";
      if (query) {
        const q = u().normalize(query);
        const found = EMOJI_INDEX.filter((e) => e.hay.indexOf(q) !== -1).slice(0, 120);
        cells = found.map(cellHTML).join("");
        if (showServer) {
          const sv = serverEmojiList(serverId, perms.custom !== false).filter(
            (em) => u().normalize(em.name).indexOf(q) !== -1
          );
          cells += sv.map(serverCellHTML).join("");
        }
      } else if (tab === "server") {
        const sv = serverEmojiList(serverId, perms.custom !== false);
        cells = sv.map(serverCellHTML).join("");
        if (!sv.length) {
          grid.innerHTML =
            ("<div class=\"cm-empty\">" + NX.i18n.get("chat.nenhumemojipersonalizadonesteservidorainda", "Nenhum emoji personalizado neste servidor ainda.") + "</div>");
          return;
        }
      } else {
        const cat = EMOJI_CATS.filter((c) => c.id === tab)[0] || EMOJI_CATS[0];
        cells = EMOJI_INDEX.filter((e) => e.cat === cat.id).map(cellHTML).join("");
      }
      grid.innerHTML = cells || ("<div class=\"cm-empty\">" + NX.i18n.get("chat.nenhumemojiencontrado", "Nenhum emoji encontrado.") + "</div>");
    }

    grid.addEventListener("click", (e) => {
      const b = e.target.closest(".cm-emj");
      if (!b) return;
      const value = b.getAttribute("data-token") || b.getAttribute("data-e");
      NX.ui.closePopout();
      if (typeof onPick === "function" && value) onPick(value);
    });

    grid.addEventListener("mouseover", (e) => {
      const b = e.target.closest(".cm-emj");
      if (!b || !preview) return;
      const g = b.querySelector(".cm-emj__g");
      preview.innerHTML =
        (g ? '<span class="cm-picker__preview-e">' + g.textContent + "</span>" : "") +
        '<span class="cm-picker__preview-t">' + u().h(b.getAttribute("data-name") || "") + "</span>";
    });

    el.querySelectorAll(".cm-picker__tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        tab = btn.getAttribute("data-cat");
        query = "";
        if (input) input.value = "";
        el.querySelectorAll(".cm-picker__tab").forEach((b) => {
          const on = b === btn;
          b.classList.toggle("is-on", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        renderGrid();
      });
    });

    if (input) {
      input.addEventListener("input", () => {
        query = input.value || "";
        renderGrid();
      });
      setTimeout(() => {
        try {
          input.focus();
        } catch (e) {}
      }, 40);
    }

    renderGrid();
    return el;
  };

  /* =========================================================
     7 · GIFs — provedor com fixture local
     ========================================================= */
  const GIF_FIXTURE = [
    { id: "g1", name: NX.i18n.get("chat.boaNoite", "boa noite"), tags: NX.i18n.get("chat.luaSonoSleepNight", "lua sono sleep night"), kind: "moon", c1: "#8f83ff", c2: "#4cc9f0" },
    { id: "g2", name: (NX.i18n.get("chat.parabens", "parabéns")), tags: NX.i18n.get("chat.festaAniversarioConfetti", "festa aniversario confetti"), kind: "confetti", c1: "#35e0a8", c2: "#ffc857" },
    { id: "g3", name: NX.i18n.get("chat.vamosLa", "vamos lá"), tags: NX.i18n.get("chat.boraSimVamosGo", "bora sim vamos go"), kind: "bars", c1: "#35e0a8", c2: "#8f83ff" },
    { id: "g4", name: "obrigado", tags: NX.i18n.get("chat.valeuThanksGrato", "valeu thanks grato"), kind: "heart", c1: "#ff7ab6", c2: "#ff6b7a" },
    { id: "g5", name: NX.i18n.get("chat.boaSorte", "boa sorte"), tags: NX.i18n.get("chat.sorteLuckTrevo", "sorte luck trevo"), kind: "spin", c1: "#a0e548", c2: "#35e0a8" },
    { id: "g6", name: "kkkk", tags: NX.i18n.get("chat.risoMemeHahaha", "riso meme hahaha"), kind: "shake", c1: "#ffc857", c2: "#f0956b" },
    { id: "g7", name: (NX.i18n.get("chat.cafe", "café?")), tags: NX.i18n.get("chat.cafeCoffeePausa", "cafe coffee pausa"), kind: "steam", c1: "#f0956b", c2: "#ffc857" },
    { id: "g8", name: "combinado", tags: NX.i18n.get("chat.simOkCheckApprove", "sim ok check approve"), kind: "check", c1: "#35e0a8", c2: "#17c98e" },
    { id: "g9", name: NX.i18n.get("chat.agoraNao", "agora não"), tags: NX.i18n.get("chat.naoStopRecusa", "nao no stop recusa"), kind: "cross", c1: "#ff6b7a", c2: "#ff7ab6" },
    { id: "g10", name: NX.i18n.get("chat.festa", "é uma festa"), tags: NX.i18n.get("chat.discoPartyBalanco", "disco party balanco"), kind: "disco", c1: "#8f83ff", c2: "#ff7ab6" },
    { id: "g11", name: "esperando...", tags: NX.i18n.get("chat.waitEsperaLoading", "wait espera loading"), kind: "dots", c1: "#4cc9f0", c2: "#8f83ff" },
    { id: "g12", name: "carinho", tags: NX.i18n.get("chat.amorLoveAbraco", "amor love abraco"), kind: "orbit", c1: "#ff7ab6", c2: "#8f83ff" },
    { id: "g13", name: NX.i18n.get("chat.boaIdeia", "boa ideia"), tags: NX.i18n.get("chat.ideiaLightbulbLuz", "ideia lightbulb luz"), kind: "pulse", c1: "#ffc857", c2: "#35e0a8" },
    { id: "g14", name: "sucesso", tags: NX.i18n.get("chat.vitoriaWinCampeao", "vitoria win campeao"), kind: "check", c1: "#4cc9f0", c2: "#35e0a8" },
    { id: "g15", name: NX.i18n.get("chat.mandaBalao", "manda balão"), tags: NX.i18n.get("chat.bolaoEmojiReact", "bolao emoji react"), kind: "orbit", c1: "#35e0a8", c2: "#4cc9f0" },
    { id: "g16", name: NX.i18n.get("chat.modoFoco", "modo foco"), tags: NX.i18n.get("chat.focoFocusSerio", "foco focus serio"), kind: "bars", c1: "#8f83ff", c2: "#4cc9f0" },
  ];

  const GW = 360;
  const GH = 200;

  function gifInner(g) {
    const c1 = g.c1;
    const c2 = g.c2;
    switch (g.kind) {
      case "moon":
        return (
          '<circle cx="180" cy="100" r="52" fill="' + c1 + '">' +
          '<animate attributeName="r" values="46;58;46" dur="2.2s" repeatCount="indefinite"/></circle>' +
          '<circle cx="212" cy="82" r="46" fill="#0b1214"/>' +
          '<circle cx="70" cy="52" r="5" fill="' + c2 + '"><animate attributeName="opacity" values="0.2;1;0.2" dur="1.4s" repeatCount="indefinite"/></circle>' +
          '<circle cx="300" cy="150" r="4" fill="' + c2 + '"><animate attributeName="opacity" values="1;0.2;1" dur="1.8s" repeatCount="indefinite"/></circle>' +
          '<text x="180" y="188" font-family="system-ui" font-size="17" fill="#e8f3f0" text-anchor="middle" opacity="0.85">' +
          g.name + "</text>"
        );
      case "confetti":
        return (
          '<g>' +
          '<rect x="50" y="-20" width="14" height="22" rx="4" fill="' + c1 + '">' +
          '<animate attributeName="y" values="-20;220" dur="2.4s" repeatCount="indefinite"/>' +
          '<animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="1.6s" repeatCount="indefinite"/></rect>' +
          '<rect x="130" y="-20" width="14" height="22" rx="4" fill="' + c2 + '">' +
          '<animate attributeName="y" values="-20;220" dur="3s" repeatCount="indefinite"/>' +
          '<animateTransform attributeName="transform" type="rotate" from="0 0 0" to="-360 0 0" dur="2s" repeatCount="indefinite"/></rect>' +
          '<rect x="220" y="-20" width="14" height="22" rx="4" fill="#ffc857">' +
          '<animate attributeName="y" values="-20;220" dur="2.1s" repeatCount="indefinite"/></rect>' +
          '<rect x="300" y="-20" width="14" height="22" rx="4" fill="#8f83ff">' +
          '<animate attributeName="y" values="-20;220" dur="2.8s" repeatCount="indefinite"/></rect>' +
          '<text x="180" y="112" font-family="system-ui" font-weight="700" font-size="34" fill="#e8f3f0" text-anchor="middle">' +
          "🎉 " + g.name + "</text></g>"
        );
      case "bars":
        return (
          '<g>' +
          [0, 1, 2, 3, 4]
            .map(
              (i) =>
                '<rect x="' + (60 + i * 50) + '" y="70" width="26" height="60" rx="10" fill="' +
                (i % 2 ? c2 : c1) + '"><animate attributeName="height" values="24;96;24" dur="1s" begin="' +
                i * 0.14 + 's" repeatCount="indefinite"/>' +
                '<animate attributeName="y" values="96;58;96" dur="1s" begin="' + i * 0.14 +
                's" repeatCount="indefinite"/></rect>'
            )
            .join("") +
          '<text x="180" y="176" font-family="system-ui" font-size="19" fill="#e8f3f0" text-anchor="middle">' +
          g.name + "</text></g>"
        );
      case "heart":
        return (
          '<g transform="translate(180,96)"><g>' +
          '<animateTransform attributeName="transform" type="scale" values="1;1.24;1;1.12;1" dur="1.1s" repeatCount="indefinite"/>' +
          '<text x="0" y="34" font-size="92" text-anchor="middle">❤️</text></g></g>' +
          '<text x="180" y="184" font-family="system-ui" font-size="19" fill="#e8f3f0" text-anchor="middle">' +
          g.name + "</text>"
        );
      case "spin":
        return (
          '<g transform="translate(180,92)"><g>' +
          '<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="3.2s" repeatCount="indefinite"/>' +
          '<path d="M0 -52 15 -16 54 -14 24 12 33 50 0 30 -33 50 -24 12 -54 -14 -15 -16Z" fill="' +
          c1 + '"/><circle r="14" fill="' + c2 + '"/></g></g>' +
          '<text x="180" y="184" font-family="system-ui" font-size="19" fill="#e8f3f0" text-anchor="middle">' +
          g.name + "</text>"
        );
      case "shake":
        return (
          '<g><animateTransform attributeName="transform" type="translate" values="0 0;-9 0;9 0;0 0" dur="0.34s" repeatCount="indefinite"/>' +
          '<text x="180" y="118" font-family="system-ui" font-weight="700" font-size="54" fill="' +
          c1 + ("\" text-anchor=\"middle\">" + NX.i18n.get("chat.kkkk", "kkkk") + "</text></g>") +
          '<text x="180" y="172" font-family="system-ui" font-size="17" fill="#e8f3f0" text-anchor="middle">' +
          g.name + "</text>"
        );
      case "steam":
        return (
          '<rect x="132" y="104" width="96" height="62" rx="14" fill="' + c1 + '"/>' +
          '<path d="M228 118h16a16 16 0 0 1 0 32h-16" fill="none" stroke="' + c1 + '" stroke-width="10"/>' +
          '<circle cx="164" cy="86" r="9" fill="#e8f3f0" opacity="0.7"><animate attributeName="cy" values="92;40" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.85;0" dur="2s" repeatCount="indefinite"/></circle>' +
          '<circle cx="192" cy="86" r="9" fill="#e8f3f0" opacity="0.7"><animate attributeName="cy" values="92;40" dur="2s" begin="0.7s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.85;0" dur="2s" begin="0.7s" repeatCount="indefinite"/></circle>' +
          '<text x="180" y="192" font-family="system-ui" font-size="18" fill="#e8f3f0" text-anchor="middle">' +
          g.name + "</text>"
        );
      case "check":
        return (
          '<circle cx="180" cy="92" r="54" fill="none" stroke="' + c1 + '" stroke-width="9" stroke-linecap="round" ' +
          'stroke-dasharray="340" stroke-dashoffset="340">' +
          '<animate attributeName="stroke-dashoffset" values="340;0;0;340" dur="2.6s" repeatCount="indefinite"/></circle>' +
          '<path d="M154 94l18 18 36-40" fill="none" stroke="' + c2 + '" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" ' +
          'stroke-dasharray="90" stroke-dashoffset="90">' +
          '<animate attributeName="stroke-dashoffset" values="90;90;0;0" dur="2.6s" repeatCount="indefinite"/></path>' +
          '<text x="180" y="180" font-family="system-ui" font-size="18" fill="#e8f3f0" text-anchor="middle">' +
          g.name + "</text>"
        );
      case "cross":
        return (
          '<g stroke="' + c1 + '" stroke-width="13" stroke-linecap="round">' +
          '<line x1="146" y1="58" x2="214" y2="126" stroke-dasharray="96" stroke-dashoffset="96">' +
          '<animate attributeName="stroke-dashoffset" values="96;0;0;96" dur="2.4s" repeatCount="indefinite"/></line>' +
          '<line x1="214" y1="58" x2="146" y2="126" stroke-dasharray="96" stroke-dashoffset="96">' +
          '<animate attributeName="stroke-dashoffset" values="96;96;0;0" dur="2.4s" repeatCount="indefinite"/></line></g>' +
          '<text x="180" y="176" font-family="system-ui" font-size="18" fill="#e8f3f0" text-anchor="middle">' +
          g.name + "</text>"
        );
      case "disco":
        return (
          '<g transform="translate(180,84)">' +
          '<circle r="46" fill="' + c1 + '" opacity="0.9"><animate attributeName="r" values="42;52;42" dur="1.6s" repeatCount="indefinite"/></circle>' +
          '<g stroke="#e8f3f0" stroke-width="4" opacity="0.65">' +
          '<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="4s" repeatCount="indefinite"/>' +
          '<line x1="-70" y1="0" x2="70" y2="0"/><line x1="0" y1="-70" x2="0" y2="70"/>' +
          '<line x1="-50" y1="-50" x2="50" y2="50"/><line x1="-50" y1="50" x2="50" y2="-50"/></g></g>' +
          '<text x="180" y="176" font-family="system-ui" font-size="18" fill="#e8f3f0" text-anchor="middle">' +
          g.name + "</text>"
        );
      case "dots":
        return (
          [0, 1, 2]
            .map(
              (i) =>
                '<circle cx="' + (130 + i * 50) + '" cy="92" r="17" fill="' + (i % 2 ? c2 : c1) +
                '" opacity="0.3"><animate attributeName="opacity" values="0.25;1;0.25" dur="1.2s" begin="' +
                i * 0.24 + 's" repeatCount="indefinite"/></circle>'
            )
            .join("") +
          '<text x="180" y="166" font-family="system-ui" font-size="18" fill="#e8f3f0" text-anchor="middle">' +
          g.name + "</text>"
        );
      case "pulse":
        return (
          '<g transform="translate(180,92)">' +
          '<circle r="34" fill="' + c1 + '"><animate attributeName="r" values="30;44;30" dur="1.5s" repeatCount="indefinite"/></circle>' +
          '<circle r="58" fill="none" stroke="' + c2 + '" stroke-width="5" opacity="0.7">' +
          '<animate attributeName="r" values="44;74;44" dur="1.5s" repeatCount="indefinite"/>' +
          '<animate attributeName="opacity" values="0.8;0;0.8" dur="1.5s" repeatCount="indefinite"/></circle>' +
          '<text x="0" y="12" font-size="38" text-anchor="middle">💡</text></g>' +
          '<text x="180" y="184" font-family="system-ui" font-size="18" fill="#e8f3f0" text-anchor="middle">' +
          g.name + "</text>"
        );
      case "orbit":
      default:
        return (
          '<g transform="translate(180,92)">' +
          '<circle r="40" fill="none" stroke="' + c2 + '" stroke-width="4" opacity="0.55"/>' +
          '<g><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2.4s" repeatCount="indefinite"/>' +
          '<circle cx="40" cy="0" r="15" fill="' + c1 + '"/></g>' +
          '<text x="0" y="12" font-size="34" text-anchor="middle">💗</text></g>' +
          '<text x="180" y="184" font-family="system-ui" font-size="18" fill="#e8f3f0" text-anchor="middle">' +
          g.name + "</text>"
        );
    }
  }

  function gifURI(g, w, h) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
      '" viewBox="0 0 ' + GW + " " + GH + '">' +
      '<rect width="' + GW + '" height="' + GH + '" rx="18" fill="#0b1214"/>' +
      '<rect x="1" y="1" width="' + (GW - 2) + '" height="' + (GH - 2) + '" rx="17" fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="2"/>' +
      gifInner(g) +
      "</svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  chat.gifProvider = {
    /* troque por um provedor real (Giphy/Tenor): remote = async (q) => [...] */
    remote: null,
    search: async function (q) {
      if (typeof this.remote === "function") {
        try {
          const remote = await this.remote(q);
          if (Array.isArray(remote) && remote.length) return remote;
        } catch (e) {
          /* sem rede: cai no fixture local */
        }
      }
      const query = u().normalize(q || "");
      return GIF_FIXTURE.filter(
        (g) => !query || u().normalize(g.name + " " + g.tags).indexOf(query) !== -1
      ).map((g) => {
        const url = gifURI(g, GW, GH);
        return {
          id: g.id,
          name: g.name,
          url: url,
          preview: gifURI(g, Math.round(GW / 2), Math.round(GH / 2)),
          size: bytesOf(url),
        };
      });
    },
  };

  function gifToAttachment(it) {
    return {
      type: "gif",
      url: it.url,
      name: it.name || "gif",
      size: Number(it.size) || bytesOf(it.url),
    };
  }

  chat.openGifPicker = function (anchor, onPick, opts) {
    anchor = visibleAnchor(anchor);
    if (!anchor) return null;
    opts = opts || {};

    const html =
      '<div class="cm-gifs" role="dialog" aria-label="' + NX.i18n.get("ui.escolherumgif", "Escolher um GIF") + '">' +
      '<div class="cm-gifs__head"><div class="cm-search">' +
      NX.icon("search", "cm-search__ico", 16) +
      '<input type="search" class="cm-search__input" data-cm-gifsearch placeholder="' + NX.i18n.get("ui.buscargifs", "Buscar GIFs") + '" ' +
      'aria-label="' + NX.i18n.get("ui.chatmedia.buscargifs", "Buscar GIFs") + '" autocomplete="off" spellcheck="false"></div></div>' +
      '<div class="cm-gifs__body"><div class="cm-gifs__grid" data-cm-gifgrid>' +
      ("<div class=\"cm-empty\">" + NX.i18n.get("common.loading", "Carregando…") + "</div></div></div>") +
      '<div class="cm-gifs__foot"><span class="cm-gifs__info" data-cm-gifinfo aria-live="polite">' +
      (NX.i18n.get("chat.passeMouseVisualizar", "Passe o mouse para visualizar") + "</span>") +
      ("<button type=\"button\" class=\"btn btn--primary btn--sm\" data-cm-gifsend disabled>" + NX.i18n.get("chat.enviar", "Enviar") + "</button>") +
      "</div></div>";

    const el = NX.ui.popout(anchor, html, {
      cls: "cm-pop cm-pop--gif",
      side: opts.side || "bottom",
      gap: opts.gap === undefined ? 10 : opts.gap,
      align: opts.align || "start",
    });
    if (!el) return null;

    const grid = el.querySelector("[data-cm-gifgrid]");
    const info = el.querySelector("[data-cm-gifinfo]");
    const sendBtn = el.querySelector("[data-cm-gifsend]");
    const input = el.querySelector("[data-cm-gifsearch]");

    let items = [];
    let current = null;
    let seq = 0;

    function setCurrent(it, label) {
      current = it;
      if (info) info.innerHTML = label || (it ? u().h(it.name) : NX.i18n.get("chat.passeMouseVisualizar", "Passe o mouse para visualizar"));
      if (sendBtn) sendBtn.disabled = !it;
    }

    function send(it) {
      if (!it) return;
      NX.ui.closePopout();
      if (typeof onPick === "function") onPick(gifToAttachment(it));
    }

    async function load(q) {
      const my = ++seq;
      grid.innerHTML = ("<div class=\"cm-empty\">" + NX.i18n.get("common.loading", "Carregando…") + "</div>");
      let list = [];
      try {
        list = (await chat.gifProvider.search(q)) || [];
      } catch (e) {
        list = [];
      }
      if (my !== seq || !el.isConnected) return;
      items = list;
      setCurrent(null);
      if (!list.length) {
        grid.innerHTML =
          ("<div class=\"cm-empty\">" + NX.i18n.get("chat.nenhumgifpara", "Nenhum GIF para “")) + u().h(q || "tudo") + (NX.i18n.get("chat.tenteoutrapalavra", "”. Tente outra palavra.") + "</div>");
        return;
      }
      grid.innerHTML = list
        .map(
          (it, i) =>
            '<button type="button" class="cm-gif" data-i="' + i + '" aria-label="' + NX.i18n.get("ui.a11yvergif", "Ver GIF ") +
            u().h(it.name) + '">' +
            '<img class="cm-gif__img" src="' + u().h(it.preview || it.url) +
            '" alt="" loading="lazy" decoding="async" data-full="' + u().h(it.url) + '">' +
            '<span class="cm-gif__name truncate">' + u().h(it.name) + "</span></button>"
        )
        .join("");
    }

    grid.addEventListener("mouseover", (e) => {
      const cell = e.target.closest(".cm-gif");
      if (!cell) return;
      const i = parseInt(cell.getAttribute("data-i"), 10);
      const it = items[i];
      if (!it) return;
      const img = cell.querySelector(".cm-gif__img");
      if (img && img.getAttribute("data-full") && img.src !== img.getAttribute("data-full")) {
        img.src = img.getAttribute("data-full");
      }
      cell.classList.add("is-previewing");
      setCurrent(it);
    });

    grid.addEventListener("mouseout", (e) => {
      const cell = e.target.closest(".cm-gif");
      if (!cell) return;
      const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest(".cm-gif") : null;
      if (to === cell) return;
      cell.classList.remove("is-previewing");
    });

    grid.addEventListener("click", (e) => {
      const cell = e.target.closest(".cm-gif");
      if (!cell) return;
      const it = items[parseInt(cell.getAttribute("data-i"), 10)];
      if (!it) return;
      setCurrent(it);

      const actions = u().el('<div class="modal__actions"></div>');
      const cancel = u().el(("<button class=\"btn btn--ghost\" type=\"button\">" + NX.i18n.get("common.cancel", "Cancelar") + "</button>"));
      const ok = u().el(("<button class=\"btn btn--primary\" type=\"button\">" + NX.i18n.get("chat.enviargif", "Enviar GIF") + "</button>"));
      actions.appendChild(cancel);
      actions.appendChild(ok);

      const m = NX.ui.modal({ title: it.name, eyebrow: (NX.i18n.get("chat.gif", "GIF")), size: "sm", footer: actions });
      m.body.innerHTML =
        '<div class="cm-view"><img class="cm-view__img cm-view__img--gif" src="' +
        u().h(it.url) + '" alt="' + u().h(it.name) + '"></div>' +
        ("<p class=\"cm-view__note\">" + NX.i18n.get("chat.seraenviadocomoanexodotipo", "Sera enviado como anexo do tipo GIF.") + "</p>");
      cancel.addEventListener("click", () => m.close());
      ok.addEventListener("click", () => {
        m.close();
        send(it);
      });
    });

    if (sendBtn) sendBtn.addEventListener("click", () => send(current));

    if (input) {
      const run = u().debounce(() => load(input.value || ""), 220);
      input.addEventListener("input", run);
      setTimeout(() => {
        try {
          input.focus();
        } catch (e) {}
      }, 40);
    }

    load("");
    return el;
  };

  /* =========================================================
     8 · menu "+" de anexos
     ========================================================= */
  const MAX_URL_CHARS = 1600000;

  function fileInput(accept, cb) {
    const input = document.createElement("input");
    input.type = "file";
    input.className = "cm-file-input";
    input.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;opacity:0;";
    if (accept) input.accept = accept;
    document.body.appendChild(input);
    const cleanup = () => setTimeout(() => { if (input.parentNode) input.parentNode.removeChild(input); }, 300);
    input.addEventListener("change", () => {
      const f = input.files && input.files[0];
      cleanup();
      if (f) cb(f);
    });
    input.addEventListener("cancel", cleanup);
    try {
      input.click();
    } catch (e) {
      cleanup();
      NX.ui.error(NX.i18n.get("chat.naoFoiPossivelAbrir", "Não foi possível abrir o seletor de arquivos."));
    }
  }

  function resizeImage(file, cb) {
    const reader = new FileReader();
    reader.onerror = () => cb(new Error(NX.i18n.get("chat.naoFoiPossivelLer", "Não foi possível ler a imagem.")));
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const img = new Image();
      img.onerror = () => cb(new Error(NX.i18n.get("chat.formatoImagemNaoSuportado", "Formato de imagem não suportado.")));
      img.onload = () => {
        try {
          const max = 1024;
          const scale = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
          const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
          const hgt = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = hgt;
          const ctx = canvas.getContext("2d");
          const keepPng = file.type === "image/png" || file.type === "image/svg+xml";
          if (!keepPng) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, w, hgt);
          }
          ctx.drawImage(img, 0, 0, w, hgt);
          let out = dataUrl;
          try {
            out = canvas.toDataURL(keepPng ? "image/png" : "image/jpeg", 0.82);
          } catch (e) {
            out = dataUrl;
          }
          if (out.length > MAX_URL_CHARS) {
            cb(new Error(NX.i18n.get("chat.imagemGrandeDemaisMaximo", "Imagem grande demais (máximo de 1,5 MB) mesmo após a redução.")));
            return;
          }
          cb(null, {
            type: "image",
            url: out,
            name: file.name || "imagem",
            size: bytesOf(out),
            resized: scale < 1,
          });
        } catch (e) {
          cb(new Error(NX.i18n.get("chat.naoFoiPossivelProcessar", "Não foi possível processar a imagem.")));
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function handleFile(kind, file, onPick) {
    if (kind === "image") {
      resizeImage(file, (err, item) => {
        if (err) {
          NX.ui.error(err.message);
          return;
        }
        previewSend(item, onPick);
      });
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => NX.ui.error(NX.i18n.get("chat.naoFoiPossivelLer2", "Não foi possível ler o arquivo."));
    reader.onload = () => {
      const url = String(reader.result || "");
      if (url.length > MAX_URL_CHARS) {
        NX.ui.error(NX.i18n.get("chat.arquivoGrandeDemaisMaximo", "Arquivo grande demais (máximo de 1,5 MB)."));
        return;
      }
      previewSend(
        {
          type: kind === "video" ? "video" : "file",
          url: url,
          name: file.name || "arquivo",
          size: bytesOf(url),
        },
        onPick
      );
    };
    reader.readAsDataURL(file);
  }

  function previewBody(item) {
    if (item.type === "image" || item.type === "gif") {
      return (
        '<div class="cm-view"><img class="cm-view__img" src="' + u().h(item.url) +
        '" alt="' + u().h(item.name) + '"></div>' +
        '<p class="cm-view__note"><strong>' + u().h(item.name) + "</strong> · " + fmtSize(item.size) + "</p>"
      );
    }
    if (item.type === "video") {
      return (
        '<div class="cm-view"><video class="cm-view__video" controls playsinline src="' +
        u().h(item.url) + '"></video></div>' +
        '<p class="cm-view__note"><strong>' + u().h(item.name) + "</strong> · " + fmtSize(item.size) + "</p>"
      );
    }
    return (
      '<div class="cm-filecard"><span class="cm-filecard__ico">' + NX.icon("folder", "", 26) +
      '</span><span class="cm-filecard__txt"><strong class="truncate">' + u().h(item.name) +
      "</strong><small>" + fmtSize(item.size) + "</small></span></div>"
    );
  }

  function previewSend(item, onPick) {
    const actions = u().el('<div class="modal__actions"></div>');
    const cancel = u().el(("<button class=\"btn btn--ghost\" type=\"button\">" + NX.i18n.get("common.cancel", "Cancelar") + "</button>"));
    const ok = u().el('<button class="btn btn--primary" type="button">' + NX.icon("send", "", 16) + (" " + NX.i18n.get("chat.enviar", "Enviar") + "</button>"));
    actions.appendChild(cancel);
    actions.appendChild(ok);

    const titles = { image: NX.i18n.get("chat.preVisualizarImagem", "Pré-visualizar imagem"), video: NX.i18n.get("chat.preVisualizarVideo", "Pré-visualizar vídeo"), file: NX.i18n.get("chat.enviarArquivo", "Enviar arquivo") };
    const m = NX.ui.modal({ title: item.name || (NX.i18n.get("chat.anexo", "Anexo")), eyebrow: (NX.i18n.get("chat.anexo", "Anexo")), size: "sm", footer: actions });
    m.body.innerHTML = previewBody(item);
    cancel.addEventListener("click", () => m.close());
    ok.addEventListener("click", () => {
      m.close();
      if (typeof onPick === "function") onPick(item);
    });
  }

  chat.openAttachMenu = function (anchor, onPick, opts) {
    anchor = visibleAnchor(anchor);
    if (!anchor) return null;
    opts = opts || {};
    const perms = attachPerms();
    const serverId = opts.serverId || perms.serverId || currentServerId();
    const items = [{ heading: (NX.i18n.get("chat.anexar", "Anexar")) }];

    if (perms.files) {
      items.push({
        icon: "image",
        label: (NX.i18n.get("chat.imagem", "Imagem")),
        hint: NX.i18n.get("chat.reduz1024px", "reduz para 1024px"),
        onClick: () => fileInput("image/*", (f) => handleFile("image", f, onPick)),
      });
      items.push({
        icon: "voice",
        label: (NX.i18n.get("chat.video", "Vídeo")),
        hint: (NX.i18n.get("chat.mp415mb", "MP4 · 1,5 MB")),
        onClick: () => fileInput("video/*", (f) => handleFile("video", f, onPick)),
      });
      items.push({
        icon: "folder",
        label: (NX.i18n.get("chat.arquivo", "Arquivo")),
        onClick: () => fileInput("", (f) => handleFile("file", f, onPick)),
      });
    }

    if (perms.gifs) {
      items.push({
        icon: "grid",
        label: (NX.i18n.get("chat.gif", "GIF")),
        onClick: () => chat.openGifPicker(anchor, onPick, opts),
      });
    }

    if (perms.emojis) {
      items.push({
        icon: "smile",
        label: (NX.i18n.get("chat.emoji", "Emoji")),
        onClick: () =>
          chat.openEmojiPicker(
            anchor,
            (emoji) => {
              /* o consumidor pode assumir o emoji (opts.onEmoji);
                 por padrão ele entra direto no campo do compositor */
              if (typeof opts.onEmoji === "function") opts.onEmoji(emoji);
              else if (opts.emojiViaPick && typeof onPick === "function")
                onPick({ type: "emoji", url: emoji, name: emoji, size: 0 });
              else chat.insertInComposer(emoji);
            },
            { serverId: serverId }
          ),
      });
    }

    if (items.length === 1) {
      items.push({ icon: "lock", label: NX.i18n.get("chat.permissaoAnexarAqui", "Sem permissão para anexar aqui"), disabled: true });
    }

    return NX.ui.menu(visibleAnchor(anchor), items, { align: "start", gap: 8 });
  };

  /* =========================================================
     9 · anexos pendentes (compositor)
     ========================================================= */
  chat.pending = [];

  function composerRoot() {
    const bench = document.querySelector("[data-cm-composer]");
    if (bench) return bench;
    const el = document.getElementById("composer");
    return el && !el.hidden ? el : null;
  }

  function insertIntoComposer(root, el) {
    const inner = root.querySelector(".composer__inner");
    if (inner) root.insertBefore(el, inner);
    else root.insertBefore(el, root.firstChild);
  }

  /* a views.js já cria <div class="composer__pending" data-pending> dentro
     do compositor — usamos esse nó quando existir; só criamos um se não. */
  function stripHost() {
    const root = composerRoot();
    if (!root) return document.querySelector(".composer__pending");
    let el = root.querySelector(".composer__pending");
    if (!el) {
      el = u().el('<div class="composer__pending" data-cm-owned hidden></div>');
      insertIntoComposer(root, el);
    }
    return el;
  }

  function replyHost() {
    const root = composerRoot();
    if (!root) return null;
    stripHost(); /* a faixa vem primeiro: strip → resposta → campo */
    let el = root.querySelector(".composer__reply");
    if (!el) {
      el = u().el('<div class="composer__reply" hidden></div>');
      const inner = root.querySelector(".composer__inner");
      if (inner) root.insertBefore(el, inner);
      else root.appendChild(el);
    }
    return el;
  }

  function thumbHTML(it, i) {
    const name = u().h(it.name || it.type || "anexo");
    let body;
    if (it.type === "image" || it.type === "gif") {
      body = '<img class="cm-thumb__img" src="' + u().h(it.url) + '" alt="' + name + '">';
    } else if (it.type === "video") {
      body = '<span class="cm-thumb__ico">' + NX.icon("voice", "", 18) + "</span>";
    } else if (it.type === "emoji") {
      body = '<span class="cm-thumb__emo">' + u().h(it.url) + "</span>";
    } else {
      body = '<span class="cm-thumb__ico">' + NX.icon("folder", "", 18) + "</span>";
    }
    return (
      '<div class="cm-thumb" title="' + name + '">' + body +
      '<button type="button" class="cm-thumb__x" data-action="chat-pending-remove" data-idx="' + i +
      '" aria-label="' + NX.i18n.get("modal.remover", "Remover") + " " + name + '">' + NX.icon("x", "", 13) + "</button></div>"
    );
  }

  const CLEAR_OWN =
    ("<button type=\"button\" class=\"cm-strip__clear\" data-action=\"chat-clear-pending\">" + NX.i18n.get("chat.limpar", "Limpar") + "</button>");

  chat.addPending = function (item) {
    if (!item || !item.url) return false;
    const types = ["image", "video", "file", "gif"];
    const type = types.indexOf(item.type) !== -1 ? item.type : "file";
    if (chat.pending.length >= 4) {
      NX.ui.error(NX.i18n.get("chat.maximo4AnexosMensagem", "No máximo 4 anexos por mensagem."));
      return false;
    }
    chat.pending.push({
      type: type,
      url: item.url,
      name: item.name || "arquivo",
      size: Number(item.size) || bytesOf(item.url),
    });
    chat.renderPendingStrip();
    return true;
  };

  /* Devolve o HTML da faixa e o desenha no .composer__pending local.
     Quando quem manda é a views.js (data-pending) ela acrescenta o próprio
     botão (NX.i18n.get("chat.limparanexos", "Limpar anexos")) ao nosso retorno — por isso o retorno nunca o
     inclui; na gravação direta preservamos o botão já existente. */
  chat.renderPendingStrip = function () {
    if (!chat.pending.length) {
      const host = stripHost();
      if (host) {
        host.innerHTML = "";
        host.hidden = true;
      }
      return "";
    }
    const thumbs = chat.pending.map(thumbHTML).join("");
    const count =
      '<span class="cm-strip__count">' + chat.pending.length + "/4</span>";
    const stripHTML =
      thumbs + '<div class="cm-strip__side">' + count + "</div>";

    const host = stripHost();
    if (!host) return stripHTML;

    const viewsClear = host.querySelector('[data-action="composer-clear-pending"]');
    if (viewsClear) host.__cmClear = viewsClear.outerHTML;
    const own = host.hasAttribute("data-cm-owned");
    const cached = host.__cmClear;

    host.hidden = false;
    if (own) {
      /* faixa autônoma (bancada / compositor sem views): limpar fica dentro */
      host.innerHTML =
        thumbs + '<div class="cm-strip__side">' + count + CLEAR_OWN + "</div>";
    } else {
      /* views.js acrescenta o botão dela quando redesenha a faixa; até lá
         (e se ela nunca rodar) mantemos o nosso equivalente */
      host.innerHTML = stripHTML + (cached || CLEAR_OWN);
    }
    return stripHTML;
  };

  chat.takePending = function () {
    const out = chat.pending.slice();
    chat.pending.length = 0;
    chat.renderPendingStrip();
    return out;
  };

  /* =========================================================
     10 · barra de resposta (reply)
     ========================================================= */
  chat.replyTo = null;

  /* foca o campo do compositor (bancada ou app) */
  function focusComposerInput() {
    const root = composerRoot();
    const ta =
      (root && root.querySelector("[data-composer-input]")) ||
      document.querySelector("[data-composer-input]");
    if (ta && !ta.disabled) {
      try {
        ta.focus({ preventScroll: true });
      } catch (e) {
        try {
          ta.focus();
        } catch (e2) {}
      }
    }
    return ta;
  }

  chat.setReply = function (msg, ctx) {
    if (!msg) return;
    const ch = channelOfMessage(msg);
    /* ref serve para o prefixo da citação só valer no mesmo destino */
    chat.replyTo = {
      msg: msg,
      ctx: ctx || ctxForMessage(msg),
      ref: ch ? ch.id : msg.dmId || msg.dmIdThread || null,
    };
    chat.renderReplyBar();
    focusComposerInput();
  };

  chat.cancelReply = function () {
    if (!chat.replyTo) return false;
    chat.replyTo = null;
    chat.renderReplyBar();
    return true;
  };

  chat.renderReplyBar = function () {
    const host = replyHost();
    if (!host) return "";
    const r = chat.replyTo;
    if (!r || !r.msg) {
      host.innerHTML = "";
      host.hidden = true;
      return "";
    }
    const msg = r.msg;
    const author = safe(() => S().user(msg.authorId), null);
    const name = author ? author.displayName : (NX.i18n.get("api.alguem", "alguém"));
    const excerpt = msg.content
      ? String(msg.content).slice(0, 140)
      : msg.attachments && msg.attachments.length
      ? "anexo: " + (msg.attachments[0].name || msg.attachments[0].type)
      : "";
    host.hidden = false;
    host.innerHTML =
      '<div class="cm-reply">' +
      '<span class="cm-reply__ico" aria-hidden="true">' + NX.icon("chat", "", 16) + "</span>" +
      ("<span class=\"cm-reply__txt\"><strong>" + NX.i18n.get("chat.respondendo", "Respondendo") + " " + "<b>") + u().h(name) + "</b></strong>" +
      '<span class="cm-reply__excerpt truncate">' + u().h(excerpt) + "</span></span>" +
      '<button type="button" class="cm-reply__x" data-action="chat-reply-cancel" ' +
      'aria-label="' + NX.i18n.get("ui.cancelarresposta", "Cancelar resposta") + '" title="' + NX.i18n.get("ui.chatmedia.cancelarresposta", "Cancelar resposta") + '">' + NX.icon("x", "", 15) + "</button>" +
      "</div>";
    return host.innerHTML;
  };

  /* prefixo de citação usado pelo compositor ao enviar */
  function prefixFor(r) {
    if (!r || !r.msg) return "";
    const author = safe(() => S().user(r.msg.authorId), null);
    const raw = r.msg.content
      ? String(r.msg.content).split("\n")[0].slice(0, 80)
      : r.msg.attachments && r.msg.attachments.length
      ? "anexo: " + (r.msg.attachments[0].name || r.msg.attachments[0].type)
      : "…";
    return "> **" + (author ? author.displayName : (NX.i18n.get("api.alguem", "alguém"))) + "**: " + raw + "\n";
  }

  chat.replyPrefix = function () {
    return prefixFor(chat.replyTo);
  };

  /* insere texto no campo do compositor (emojis, citações) */
  chat.insertInComposer = function (text) {
    const ta =
      document.querySelector("[data-cm-composer] [data-composer-input]") ||
      document.querySelector("[data-composer-input]");
    if (!ta || ta.disabled) {
      NX.ui.toast(NX.i18n.get("chat.abraCanalEscrever", "Abra um canal para escrever."), "info");
      return false;
    }
    const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    const e = ta.selectionEnd == null ? ta.value.length : ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    const pos = s + text.length;
    try {
      ta.focus();
      ta.setSelectionRange(pos, pos);
    } catch (err) {}
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  };

  /* =========================================================
     11 · ações registradas (data-action)
     ========================================================= */
  NX.action("chat-react", (el) => {
    const id = el.getAttribute("data-id");
    const emoji = el.getAttribute("data-emoji");
    if (!id || !emoji) return;
    if (el.disabled) return;
    el.classList.add("is-busy");
    NX.api
      .toggleReaction(id, emoji)
      .catch((e) => NX.ui.error((e && e.message) || NX.i18n.get("chat.naoFoiPossivelReagir3", "Não foi possível reagir.")))
      .then(() => el.classList.remove("is-busy"));
  });

  NX.action("chat-react-add", (el) => {
    const id = el.getAttribute("data-id");
    const msg = messageById(id);
    if (!id) return;
    chat.openEmojiPicker(
      el,
      (emoji) => {
        NX.api.toggleReaction(id, emoji).catch((e) => {
          NX.ui.error((e && e.message) || NX.i18n.get("chat.naoFoiPossivelReagir3", "Não foi possível reagir."));
        });
      },
      { serverId: msg ? serverIdOfMessage(msg) : currentServerId() }
    );
  });

  NX.action("chat-menu", (el) => {
    const msg = messageById(el.getAttribute("data-id"));
    if (!msg) return;
    chat.messageMenu(el, msg, ctxForMessage(msg));
  });

  NX.action("chat-preview", (el) => {
    const id = el.getAttribute("data-id");
    const idx = parseInt(el.getAttribute("data-idx"), 10) || 0;
    const msg = messageById(id);
    const list = (msg && msg.attachments) || attCache[id] || [];
    openAttachmentPreview(list[idx]);
  });

  NX.action("chat-pending-remove", (el) => {
    const i = parseInt(el.getAttribute("data-idx"), 10);
    if (isNaN(i)) return;
    chat.pending.splice(i, 1);
    chat.renderPendingStrip();
  });

  NX.action("chat-clear-pending", () => {
    chat.pending.length = 0;
    chat.renderPendingStrip();
  });

  NX.action("chat-reply-cancel", () => {
    chat.cancelReply();
  });

  /* atalhos do compositor (+ e 😀) já existentes no views.js */
  NX.action("chat-attach", (el) => {
    chat.openAttachMenu(el, chat.defaultPick, {});
  });
  NX.action("chat-emoji", (el) => {
    chat.openEmojiPicker(
      el,
      (emoji) => chat.insertInComposer(emoji),
      { serverId: currentServerId() }
    );
  });
  NX.action("chat-gifs", (el) => {
    chat.openGifPicker(el, chat.defaultPick, {});
  });

  /* aliases usados pelo views.js / app.js quando o botão é genérico.
     (app.js registra `composer-attach`/`composer-emoji`; aqui ficamos com
     nomes próprios para qualquer botão novo apontar direto para nós.) */

  /* escolha padrão do menu de anexos / GIFs */
  chat.defaultPick = function (item) {
    if (!item) return;
    if (item.type === "emoji") {
      chat.insertInComposer(item.url);
      return;
    }
    chat.addPending(item);
  };

  /* =========================================================
     12 · integração com o compositor do app
     ========================================================= */

  /* camadas que devem segurar a resposta (menu, popout, modal, toast) */
  const LAYER_SELECTOR =
    "#popout-root, #modal-root, #toast-root, .cm-pop, .cm-picker, .cm-gifs, [data-cm-layer]";

  function inLayer(el) {
    return !!(el && el.nodeType === 1 && el.closest && el.closest(LAYER_SELECTOR));
  }

  /* a resposta se mantém enquanto o foco fica no compositor ou em alguma
     camada; sai para outro lugar (mensagem, sidebar, modal de verdade) e
     ela é cancelada — nada disso acontece durante um re-render. */
  function watchReplyFocus() {
    if (chat.__blurWired) return;
    chat.__blurWired = true;
    let down = null;
    const mark = (e) => {
      down = e.target;
    };
    document.addEventListener("mousedown", mark, true);
    document.addEventListener("touchstart", mark, true);
    document.addEventListener("focusout", (e) => {
      if (!chat.replyTo || chat.__remounting) return;
      const root = composerRoot();
      const rel = e.relatedTarget;
      if (root && rel && rel.nodeType === 1 && root.contains(rel)) return;
      if (inLayer(rel) || inLayer(down)) return;
      if (root && down && down.nodeType === 1 && root.contains(down)) return;
      /* barra sumiu = o compositor está sendo redesenhado */
      if (root && !root.querySelector(".composer__reply")) return;
      window.setTimeout(() => {
        if (!chat.replyTo || chat.__remounting) return;
        const a = document.activeElement;
        if (a && a !== document.body && root && root.contains(a)) return;
        if (inLayer(a)) return;
        chat.cancelReply();
      }, 0);
    });
  }

  /* a citação entra no texto enviado — sem mexer no views.js */
  function wrapSend() {
    if (!NX.api || typeof NX.api.sendMessage !== "function" || NX.api.__cmWrapped) return;
    const orig = NX.api.sendMessage;
    NX.api.sendMessage = function (ref, text, opts) {
      const r = chat.replyTo;
      if (r) {
        const same = r.ref == null || String(r.ref) === String(ref);
        const hasContent =
          !!(text && String(text).trim()) ||
          !!(opts && opts.attachments && opts.attachments.length);
        const pre = same && hasContent ? prefixFor(r) : "";
        chat.replyTo = null;
        try {
          chat.renderReplyBar();
        } catch (e) {}
        if (pre) text = pre + String(text == null ? "" : text);
      }
      return orig.call(this, ref, text, opts);
    };
    NX.api.__cmWrapped = true;
  }

  function integrate() {
    watchReplyFocus();
    wrapSend();
    if (!NX.views || typeof NX.views.composer !== "function" || NX.views.__cmWrapped) return;
    const orig = NX.views.composer;
    NX.views.composer = function () {
      const prev = document.activeElement;
      const wasInput = !!(prev && prev.matches && prev.matches("[data-composer-input]"));
      chat.__remounting = true;
      let out;
      try {
        out = orig.apply(this, arguments);
      } catch (e) {
        chat.__remounting = false;
        throw e;
      }
      try {
        chat.renderPendingStrip();
        chat.renderReplyBar();
        /* devolve o foco ao campo quando era dele antes do redesenho */
        if (wasInput && chat.replyTo && !NX.ui.isOpen()) focusComposerInput();
      } catch (e) {
        console.error("[chatmedia:composer]", e);
      }
      window.setTimeout(() => {
        chat.__remounting = false;
      }, 0);
      return out;
    };
    NX.views.__cmWrapped = true;
    chat.integrated = true;
  }

  chat.integrate = integrate;

  integrate();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", integrate);
  }
  window.addEventListener("load", integrate);

  NX.chat = chat;
})(window.NX);
