/* ============================================================
   NEXO · call
   Chamadas reais 1:1 (WebRTC) com sinalização pelo backend.

   · mídia: getUserMedia / getDisplayMedia / RTCPeerConnection;
   · sinalização: NX.api.startCall / respondCall / endCall /
     sendSignal, consultada em NX.api.peekCalls (polling);
   · NADA aqui simula chamada: sem permissão de mídia a chamada
     continua sinalizando e mostra aviso honesto;
   · sons: só via NX.sfx (se existir) — áudio da chamada é do
     WebRTC e nunca passa pelo motor de sons.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const t = (key, fb) => (NX.i18n && NX.i18n.get ? NX.i18n.get(key, fb) : fb);
  const S = () => NX.selectors;
  const hh = (s) => (NX.util && NX.util.h ? NX.util.h(s) : String(s == null ? "" : s));

  const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  const POLL_VISIBLE = 2000;
  const POLL_INCALL = 1000;
  const OFFER_RETRY_MS = 6000; /* reenvio da oferta da sala sem resposta */
  const CONN_WATCH_MS = 20000; /* sem "connected": pede um ICE novo */
  const CONN_WATCH_GRACE_MS = 15000; /* e mais tanto sem subir: refaz o par */
  const OFFER_RETRY_MAX = 10; /* ~40s: cobre o boot lento do colega */
  const OFFER_FALLBACK_MS = 45000; /* quem espera a oferta acaba oferecendo */
  const RING_TIMEOUT = 45000;

  const state = {
    phase: "none", /* none | outgoing | incoming | active */
    call: null,
    peer: null,
    pc: null,
    localStream: null,
    remoteStream: null,
    screenStream: null,
    screenAudioSender: null, /* linha de áudio da aba compartilhada */
    screenAudio: false, /* há áudio da aba fluindo agora */
    screenEnding: false, /* trava contra dois pickers em sequência */
    mic: false,
    cam: false,
    screen: false,
    volume: 0.9,
    micDevice: "",
    camDevice: "",
    outDevice: "",
    eco: true,
    noise: true,
    agc: true,
    mediaOpen: false,
    minimized: false,
    popOpen: "",
    pendingCall: null,
    starting: false,
    pcRestarts: 0,
    makingOffer: false,
    accepting: false,
    ignoreOffer: false,
    remoteDescSet: false,
    pendingCandidates: [],
    pendingOffers: {}, /* callId → SDP recebido antes de atender */
    seenSignals: {},
    pollTimer: null,
    tickTimer: null,
    ringTimer: null,
    startedAt: 0,
    connection: "new",
    mediaWarned: false,
    /* UMA fonte de verdade do aviso de permissão: um item por tipo
       (microfone/câmera) com o motivo REAL — o mesmo evento nunca gera
       dois avisos na tela. */
    mediaIssues: [],
    mediaDismissed: false, /* aviso principal fechado (só visual) */
    permHelpOpen: false, /* "Como permitir" aberto no aviso principal */
    root: null,
    audioEl: null,
    room: null, /* sala de voz do servidor (malha WebRTC) */
    /* ---- participantes: controle local + moderação ---- */
    memberVol: {},   /* id → volume LOCAL desta pessoa (0..1) */
    localMute: {},   /* id → silenciado só PARA MIM (não mexe no microfone de ninguém) */
    mod: {},         /* estado AUTORITATIVO vindo do servidor (voiceMod) */
    menuFor: null,   /* participante com o menu ⋯ aberto */
    serverMutedWas: false,   /* já estava silenciado pela moderação */
    micBeforeMod: false,     /* meu microfone antes do silenciamento */

    /* --- transmissão (qualidade/FPS) ---
       Tudo aqui é APLICADO de verdade (applyConstraints/setParameters)
       e MEDIDO de verdade (getStats). Nenhum número é animado. */
    txFps: "auto",           /* "auto" | 30 | 60 | 120 */
    txRes: "720",            /* "720" | "1080" | "1440" | "2160" */
    txQuality: "equilibrada",/* "eco" | "equilibrada" | "alta" */
    txBitrateKbps: 0,        /* 0 = segue o preset de qualidade */
    txGame: false,           /* modo Jogatina */
    txLast: null,            /* último snapshot do getStats */
    txPrev: null,            /* snapshot anterior (delta de bytes) */
    txTimer: null,           /* leitura periódica enquanto o painel abre */
    txWarns: [],             /* avisos honestos gerados por txEvaluate */
    txApplied: "",           /* resumo do que foi aceito pelo navegador */
    txErr: ""                /* última recusa do navegador */
  };

  /* ---------------- utilidades ---------------- */
  function sfx(name) {
    try {
      if (NX.sfx && NX.sfx.play) NX.sfx.play(name);
    } catch (e) {
      /* sem motor de sons: segue */
    }
  }

  function bus(type, payload) {
    try {
      if (NX.bus && NX.bus.emit) NX.bus.emit(type, payload);
    } catch (e) {}
  }

  function toast(msg, kind) {
    try {
      if (NX.ui && NX.ui.toast) NX.ui.toast(msg, kind || "info");
    } catch (e) {}
  }

  function el(html) {
    return NX.util && NX.util.el ? NX.util.el(html) : null;
  }

  function statusLabel(status) {
    const map = { online: "Disponível", idle: "Ausente", dnd: "Não perturbe", offline: "Offline" };
    if (NX.STATUS_LABEL && NX.STATUS_LABEL[status]) return NX.STATUS_LABEL[status];
    return map[status] || map.offline;
  }

  function peerName() {
    const p = state.peer || {};
    return p.displayName || p.username || t("call.alguem", "Alguém");
  }

  function fmtTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh2 = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return hh2 + ":" + mm + ":" + ss;
  }

  function connLabel() {
    switch (state.connection) {
      case "checking":
      case "connecting":
        return t("call.conectando", "Conectando…");
      case "connected":
        return t("call.conectado", "Conectado");
      case "failed":
        return t("call.falhou", "Falha na conexão");
      case "disconnected":
        return t("call.desconectado", "Desconectado");
      case "closed":
        return t("call.encerrado", "Encerrado");
      default:
        return t("call.aguardando", "Aguardando…");
    }
  }

  function avatarHTML(size, showStatus) {
    const u = state.peer;
    if (!u) return "";
    if (NX.util && NX.util.avatarHTML) return NX.util.avatarHTML(u, size || "xl", showStatus !== false);
    return "";
  }

  /* ---------------- mídia ---------------- */
  function audioConstraints() {
    const c = { echoCancellation: state.eco, noiseSuppression: state.noise, autoGainControl: state.agc };
    if (state.micDevice) c.deviceId = { exact: state.micDevice };
    return c;
  }

  function videoConstraints() {
    const c = { width: { ideal: 1280 }, height: { ideal: 720 } };
    if (state.camDevice) c.deviceId = { exact: state.camDevice };
    return c;
  }

  function ensureAudioEl() {
    if (state.audioEl && state.audioEl.isConnected) return state.audioEl;
    const a = document.createElement("audio");
    a.autoplay = true;
    a.playsInline = true;
    a.setAttribute("data-call-audio", "1");
    a.volume = state.volume;
    document.body.appendChild(a);
    state.audioEl = a;
    return a;
  }

  function attachRemote(stream) {
    if (!stream) return;
    state.remoteStream = stream;
    const a = ensureAudioEl();
    /* só reanexa quando o stream mudou: reatribuir a cada track nova
       reiniciava o <audio> e cortava o áudio da call */
    if (a.srcObject !== stream) {
      a.srcObject = stream;
      const p = a.play();
      if (p && p.catch) p.catch(function () {});
    }
    stream.getAudioTracks().forEach(function (tr) {
      tr.enabled = true;
    });
    /* indicador de fala: análise REAL do que chega da outra ponta */
    startSpeak(stream);
  }

  function attachLocalPreview() {
    const v = state.root && state.root.querySelector("[data-call-local]");
    const box = state.root && state.root.querySelector(".call-stage__local");
    if (!v) return;
    /* o preview mostra a CÂMERA — nunca a tela que você compartilha */
    const cam = cameraTrack();
    const next = cam ? new MediaStream([cam]) : null;
    if (v.srcObject !== next) {
      v.srcObject = next;
      const p = v.play();
      if (p && p.catch) p.catch(function () {});
    }
    if (box) box.classList.toggle("has-video", !!cam);
  }

  function attachScreenPreview() {
    const v = state.root && state.root.querySelector("[data-call-screen]");
    if (!v) return;
    v.srcObject = state.screenStream;
    const p = v.play();
    if (p && p.catch) p.catch(function () {});
  }

  /* =========================================================
     PERMISSÕES DO NAVEGADOR
     A janela NATIVA só é aberta por uma ação da pessoa: ativar o
     microfone/câmera, atender ou ligar, entrar na sala, compartilhar
     a tela. Aqui a gente apenas LÊ o estado para:
       · não repetir pedido sem uma nova ação;
       · reutilizar o que já foi concedido;
       · dizer o que travou de verdade (negado x sem aparelho x ocupado).
     ========================================================= */
  async function permState(name) {
    if (!navigator.permissions || !navigator.permissions.query) return "unknown";
    try {
      const r = await navigator.permissions.query({ name: name });
      return r && r.state ? r.state : "unknown";
    } catch (e) {
      return "unknown"; /* navegador não expõe: quem decide é o próprio pedido */
    }
  }

  function isDenied(e) {
    const n = (e && e.name) || "";
    return n === "NotAllowedError" || n === "SecurityError" || n === "PermissionDeniedError";
  }

  /* quando o navegador já parou de perguntar, a pessoa precisa saber
     onde habilitar de novo */
  function permHelp(kind) {
    if (kind === "camera")
      return t(
        "call.ajudaCamera",
        "Liberar: clique no cadeado (ícone de aviso) ao lado do endereço → Configurações do site → Câmera → Permitir e recarregue."
      );
    if (kind === "screen")
      return t(
        "call.ajudaTela",
        "Liberar: clique no cadeado (ícone de aviso) ao lado do endereço → Configurações do site → Compartilhamento de tela → Permitir."
      );
    return t(
      "call.ajudaMicro",
      "Liberar: clique no cadeado (ícone de aviso) ao lado do endereço → Configurações do site → Microfone → Permitir e recarregue."
    );
  }

  /* os três bloqueios REAIS são coisas diferentes — o aviso diz qual */
  function mediaFail(kind, e, fallback) {
    const n = (e && e.name) || "";
    if (isDenied(e))
      return (
        (kind === "camera"
          ? t("call.permissaoCameraNegada", "Permissão da câmera negada.")
          : t("call.permissaoMicroNegada", "Permissão do microfone negada.")) +
        " " + permHelp(kind)
      );
    if (n === "NotFoundError" || n === "DevicesNotFoundError" || n === "OverconstrainedError")
      return kind === "camera"
        ? t("call.camAusente", "Nenhuma câmera encontrada — verifique se ela está conectada e liberada no sistema.")
        : t("call.micAusente", "Nenhum microfone encontrado — verifique se ele está conectado e liberado no sistema.");
    if (n === "NotReadableError" || n === "TrackStartError" || n === "AbortError")
      return kind === "camera"
        ? t("call.camOcupada", "A câmera está em uso por outro aplicativo. Feche o outro programa e tente de novo.")
        : t("call.micOcupado", "O microfone está em uso por outro aplicativo. Feche o outro programa e tente de novo.");
    if (n === "NotSupportedError" || n === "TypeError")
      return t("call.naoSuportaCameraMicro", "Este navegador não suporta câmera/microfone.");
    return (e && e.message) || fallback;
  }

  /* motivo REAL do bloqueio: permissão negada x sem aparelho x
     aparelho ocupado x navegador sem suporte x captura encerrada —
     o aviso diz qual, sem culpar permissão quando não é permissão */
  function failReason(e) {
    const n = (e && e.name) || "";
    if (isDenied(e)) return "denied";
    if (n === "NotFoundError" || n === "DevicesNotFoundError" || n === "OverconstrainedError")
      return "nodevice";
    if (n === "NotReadableError" || n === "TrackStartError" || n === "AbortError") return "busy";
    if (n === "NotSupportedError" || n === "TypeError") return "unsupported";
    if (n === "EndedError") return "ended";
    if (n === "pending") return "pending";
    return "error";
  }

  /* título curto + explicação objetiva por tipo e motivo (o componente
     único de aviso mostra isto; a ajuda de "Como permitir" fica à parte) */
  function issueCopy(kind, reason) {
    const cam = kind === "camera";
    const K = function (titleKey, title, bodyKey, body) {
      return { title: t(titleKey, title), body: t(bodyKey, body) };
    };
    if (reason === "denied")
      return cam
        ? K(
            "call.permTituloCamera",
            "Permissão da câmera necessária",
            "call.permBodyCamera",
            "O Nexo não consegue acessar sua câmera. Verifique as permissões do navegador e tente novamente."
          )
        : K(
            "call.permTituloMicro",
            "Permissão do microfone necessária",
            "call.permBodyMicro",
            "O Nexo não consegue acessar seu microfone. Verifique as permissões do navegador e tente novamente."
          );
    if (reason === "nodevice")
      return cam
        ? K(
            "call.permTituloCamNodev",
            "Câmera não encontrada",
            "call.permBodyCamNodev",
            "Nenhuma câmera foi encontrada. Conecte uma câmera e verifique se ela está liberada no sistema."
          )
        : K(
            "call.permTituloMicroNodev",
            "Microfone não encontrado",
            "call.permBodyMicroNodev",
            "Nenhum microfone foi encontrado. Conecte um aparelho e verifique se ele está liberado no sistema."
          );
    if (reason === "busy")
      return cam
        ? K(
            "call.permTituloCamBusy",
            "Câmera em uso",
            "call.permBodyCamBusy",
            "Outro aplicativo está usando a câmera. Feche o outro programa e tente novamente."
          )
        : K(
            "call.permTituloMicroBusy",
            "Microfone em uso",
            "call.permBodyMicroBusy",
            "Outro aplicativo está usando o microfone. Feche o outro programa e tente novamente."
          );
    if (reason === "unsupported")
      return K(
        "call.permTituloSemSuporte",
        "Navegador sem suporte a mídia",
        "call.permBodySemSuporte",
        "Este navegador não permite capturar microfone nem câmera."
      );
    if (reason === "ended")
      return cam
        ? K(
            "call.permTituloCamEnd",
            "Captura de vídeo encerrada",
            "call.permBodyCamEnd",
            "A câmera parou no meio da chamada (permissão revogada ou aparelho desconectado). Verifique e tente novamente."
          )
        : K(
            "call.permTituloMicroEnd",
            "Captura de áudio encerrada",
            "call.permBodyMicroEnd",
            "O microfone parou no meio da chamada (permissão revogada ou aparelho desconectado). Verifique e tente novamente."
          );
    if (reason === "pending")
      return cam
        ? K(
            "call.permTituloCamPend",
            "Aguardando permissão da câmera",
            "call.permBodyCamPend",
            "O navegador ainda não liberou a câmera. Use “Tentar novamente” para o navegador fazer o pedido."
          )
        : K(
            "call.permTituloMicroPend",
            "Aguardando permissão do microfone",
            "call.permBodyMicroPend",
            "O navegador ainda não liberou o microfone. Use “Tentar novamente” para o navegador fazer o pedido."
          );
    return cam
      ? K(
          "call.permTituloCamErro",
          "Câmera indisponível",
          "call.permBodyCamErro",
          "Não foi possível usar a câmera. Verifique o aparelho e as permissões do navegador."
        )
      : K(
          "call.permTituloMicroErro",
          "Microfone indisponível",
          "call.permBodyMicroErro",
          "Não foi possível usar o microfone. Verifique o aparelho e as permissões do navegador."
        );
  }

  function findIssue(kind) {
    for (let i = 0; i < state.mediaIssues.length; i++)
      if (state.mediaIssues[i].kind === kind) return state.mediaIssues[i];
    return null;
  }

  function issueMessage(kind) {
    const it = findIssue(kind);
    return it ? it.message : "";
  }

  /* registra/deduplica o problema por tipo. Um motivo novo (ou primeiro)
     volta a mostrar o aviso principal; repetir o mesmo motivo não
     reabre o que a pessoa fechou. */
  function setMediaIssue(kind, err, fallback, extra) {
    extra = extra || {};
    const reason = extra.reason || failReason(err);
    const prev = findIssue(kind);
    const copy = issueCopy(kind, reason);
    const help =
      extra.help !== undefined
        ? extra.help
        : reason === "denied"
        ? permHelp(kind === "camera" ? "camera" : "microphone")
        : "";
    const issue = {
      kind: kind,
      reason: reason,
      title: copy.title,
      body: copy.body,
      help: help,
      message:
        extra.message ||
        mediaFail(kind === "camera" ? "camera" : "microphone", err, fallback || copy.body),
    };
    if (prev) {
      const fresh = prev.reason !== reason || prev.message !== issue.message;
      state.mediaIssues[state.mediaIssues.indexOf(prev)] = issue;
      if (fresh) {
        state.mediaDismissed = false;
        state.permHelpOpen = false;
      }
    } else {
      state.mediaIssues.push(issue);
      state.mediaDismissed = false;
      state.permHelpOpen = false;
    }
    state.mediaWarned = state.mediaIssues.length > 0;
  }

  function clearMediaIssue(kind) {
    state.mediaIssues = state.mediaIssues.filter(function (x) {
      return x.kind !== kind;
    });
    if (!state.mediaIssues.length) {
      state.mediaWarned = false;
      state.mediaDismissed = false;
      state.permHelpOpen = false;
    }
  }

  function clearMediaIssues() {
    state.mediaIssues = [];
    state.mediaWarned = false;
    state.mediaDismissed = false;
    state.permHelpOpen = false;
  }

  /* uma nova tentativa da própria pessoa merece aviso visível de novo
     (se ela tinha fechado o cartão, o resultado volta a aparecer) */
  function reopenPermCard() {
    if (state.mediaIssues.length) state.mediaDismissed = false;
  }

  /* o aviso contextual só existe quando a pessoa está VENDO uma tela
     que o mostra (call ativa, lobby ou sala visível/dock): fora disso
     (ex.: chamada "ligando", call minimizada) o toast é o retorno
     honesto — nunca os dois ao mesmo tempo. */
  function mediaUIVisible() {
    try {
      if (state.room && roomVisible()) return true;
      if (state.phase === "lobby") return true;
      if (state.phase === "active" && !state.minimized) return true;
      if (state.room && document.querySelector(".voice-dock")) return true;
    } catch (e) {}
    return false;
  }

  async function acquireMedia(withVideo, opts) {
    opts = opts || {};
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMediaIssue("microphone", { name: "NotSupportedError" }, null);
      throw new Error(t("call.naoSuportaCameraMicro", "Este navegador não suporta câmera/microfone."));
    }

    /* RECUPERAÇÃO (F5 / voltar para a chamada): captura só se o
       navegador JÁ concedeu — nunca abrimos pedido sozinho. Se ainda
       não foi liberado, avisa e quem ativa é a pessoa, com um clique
       (essa ação é que gera o pedido nativo). */
    if (opts.auto) {
      const mp = await permState("microphone");
      const cp = withVideo ? await permState("camera") : "unknown";
      if (mp !== "granted" && cp !== "granted") {
        const kind = mp === "granted" ? "camera" : "microphone";
        const denied = mp === "denied" || cp === "denied";
        const msg = t(
          "call.semPermissaoAuto",
          "Sem acesso ao microfone/câmera ainda — clique em “Microfone” ou “Câmera” para o navegador fazer o pedido."
        );
        setMediaIssue(kind, { name: denied ? "NotAllowedError" : "pending" }, msg, {
          reason: denied ? "denied" : "pending",
          message: msg,
          help: denied ? permHelp(kind === "camera" ? "camera" : "microphone") : "",
        });
        throw new Error(msg);
      }
    }

    const warns = []; /* falhas DESTA tentativa (mensagem real por tipo) */
    /* junta com o que já existe: a captura anterior continua no ar */
    const stream = state.localStream || new MediaStream();
    let changed = false;

    if (micTrack()) {
      state.mic = !!micTrack().enabled; /* reutiliza: sem novo pedido */
      clearMediaIssue("microphone"); /* áudio de verdade no ar */
    } else {
      try {
        const a = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() });
        a.getTracks().forEach(function (tr) {
          stream.addTrack(tr);
          watchLocalTrack(tr, "audio");
          changed = true;
        });
        state.mic = true;
        clearMediaIssue("microphone"); /* confirmado por track */
      } catch (e) {
        state.mic = false;
        setMediaIssue("microphone", e, t("call.naoUsarMicro", "Não foi possível usar o microfone."));
        warns.push(issueMessage("microphone"));
      }
    }

    if (withVideo) {
      if (cameraTrack()) {
        state.cam = true; /* reutiliza: sem novo pedido */
        clearMediaIssue("camera");
      } else {
        try {
          const v = await navigator.mediaDevices.getUserMedia({ video: videoConstraints() });
          v.getVideoTracks().forEach(function (tr) {
            stream.addTrack(tr);
            watchLocalTrack(tr, "video");
            changed = true;
          });
          state.cam = true;
          clearMediaIssue("camera"); /* confirmado por track */
        } catch (e) {
          state.cam = false;
          setMediaIssue("camera", e, t("call.naoUsarCamera", "Não foi possível usar a câmera."));
          warns.push(issueMessage("camera"));
        }
      }
    }

    if (!stream.getTracks().length)
      throw new Error(warns[0] || t("call.semPermissaoMidia", "Não foi possível usar microfone nem câmera."));

    state.localStream = stream;
    state.mediaWarned = state.mediaIssues.length > 0;
    /* na sala de voz a mídia nova precisa entrar nas conexões já abertas */
    if (state.room && changed) roomApplyMedia();
    /* toast só quando NÃO existe aviso contextual na tela (a mesma
       permissão nunca é anunciada em dois lugares de uma vez) */
    if (state.mediaIssues.length && !mediaUIVisible())
      toast(
        state.mediaIssues
          .map(function (x) {
            return x.message;
          })
          .join(" "),
        "warn"
      );
    return state.localStream;
  }

  /* ---------------- peer connection ---------------- */
  /* ordem canônica das tracks (áudio antes de vídeo): os m-lines
     da oferta precisam bater com os da oferta anterior */
  function orderedTracks(stream) {
    if (!stream) return [];
    return stream.getTracks().slice().sort(function (a, b) {
      const rank = function (tr) {
        return tr.kind === "audio" ? 0 : 1;
      };
      return rank(a) - rank(b);
    });
  }

  /* ------------------------------------------------ envio de mídia
     Câmera e tela dividem a MESMA linha de vídeo (m-line): quando a
     câmera está desligada a linha continua aberta, só sem track.
     Localizar o sender pelo `s.track` perdia essa linha ociosa e abria
     um segundo m-line — SDP com ordem trocada e câmera sem volta. */

  /* única porta de entrada para colocar mídia no envio: reaproveita a
     linha existente (replaceTrack, sem renegotiar) e só cria uma linha
     nova quando ainda não existe nenhuma do tipo.
     `exclude` evita pegar a linha errada quando há dois senders do
     mesmo tipo (microfone + áudio da aba compartilhada) */
  function setOutgoingTrack(kind, track, stream, exclude) {
    if (state.room) return roomSend(kind, track, stream);
    const pc = state.pc;
    if (!pc) return false;
    const sender = pc.getSenders().find(function (s) {
      if (s === exclude) return false;
      if (s.track) return s.track.kind === kind;
      const tc = s.transceiver;
      return !!(tc && tc.receiver && tc.receiver.track && tc.receiver.track.kind === kind);
    });
    if (sender) {
      if (!sender.replaceTrack) return false;
      Promise.resolve(sender.replaceTrack(track || null)).catch(function () {});
      return true;
    }
    if (!track) return true; /* nada a enviar e nenhuma linha: ok */
    try {
      const s = pc.addTrack(track, stream || state.localStream || new MediaStream([track]));
      return s ? true : true;
    } catch (e) {
      console.warn("[nexo/call] addTrack:", e && e.message);
      return false;
    }
  }

  /* áudio da aba/tela compartilhada: linha própria, para poder parar
     SÓ esse áudio sem desligar o microfone da call */
  function setScreenAudio(track, stream) {
    if (state.room) {
      roomPush("tab", track);
      state.screenAudio = !!track;
      return true;
    }
    const pc = state.pc;
    if (!pc) return false;
    if (state.screenAudioSender) {
      Promise.resolve(state.screenAudioSender.replaceTrack(track || null)).catch(
        function () {}
      );
      state.screenAudio = !!track;
      return true;
    }
    if (!track) return true;
    try {
      const s = pc.addTrack(
        track,
        stream || state.screenStream || new MediaStream([track])
      );
      state.screenAudioSender = s || null;
      state.screenAudio = !!s;
      return true;
    } catch (e) {
      console.warn("[nexo/call] addTrack (áudio da tela):", e && e.message);
      return false;
    }
  }

  /* a câmera é a track de vídeo local que NÃO veio do compartilhamento */
  function cameraTrack() {
    const s = state.localStream;
    if (!s) return null;
    /* só track VIVA conta: trilha morta (aparelho desligado, permissão
       revogada) não é câmera ligada — mostrá-la como ligada seria mentira */
    return (
      s.getVideoTracks().find(function (tr) {
        return tr._nxSource !== "screen" && tr.readyState === "live";
      }) || null
    );
  }

  function micTrack() {
    const s = state.localStream;
    if (!s) return null;
    return (
      s.getAudioTracks().find(function (tr) {
        return tr._nxSource !== "screen" && tr.readyState === "live";
      }) ||
      s.getAudioTracks().find(function (tr) {
        return tr.readyState === "live";
      }) ||
      null
    );
  }

  /* quando o sistema mata a trilha local no meio da chamada (aparelho
     desligado, permissão revogada), o estado tem que virar junto — sem
     isto o app fica mostrando micro "ligado" que não manda som nenhum */
  function watchLocalTrack(tr, kind) {
    if (!tr) return tr;
    tr.onended = function () {
      if (tr._nxSource === "screen") return; /* fim da tela não é o micro */
      if (kind === "audio") {
        if (micTrack()) return; /* sobrou outro micro vivo */
        state.mic = false;
        setMediaIssue("microphone", { name: "EndedError" }, null);
      } else {
        if (cameraTrack()) return;
        state.cam = false;
        setMediaIssue("camera", { name: "EndedError" }, null);
      }
      state.mediaWarned = state.mediaIssues.length > 0;
      if (state.room) roomSendMedia();
      render();
    };
    return tr;
  }

  function screenVideoTrack() {
    const s = state.screenStream;
    return (s && s.getVideoTracks()[0]) || null;
  }

  function screenAudioTrack() {
    const s = state.screenStream;
    return (s && s.getAudioTracks()[0]) || null;
  }

  /* o outro lado só está "com vídeo" quando a track remota chega viva e
     DE FATO recebendo (não mudo): não anunciamos vídeo que ninguém está
     vendo do outro lado */
  function remoteVideoLive() {
    const rs = state.remoteStream;
    if (!rs) return false;
    return rs.getVideoTracks().some(function (tr) {
      return tr.readyState === "live" && tr.enabled !== false && !tr.muted;
    });
  }

  function paintRemoteVideo() {
    const root = state.root;
    if (!root) return;
    const stg = root.querySelector(".call-stage__remote");
    if (stg) stg.classList.toggle("has-video", remoteVideoLive());
    const v = root.querySelector("[data-call-remote]");
    if (v && state.remoteStream && v.srcObject !== state.remoteStream) {
      v.srcObject = state.remoteStream;
      const p = v.play();
      if (p && p.catch) p.catch(function () {});
    }
  }

  function createPC(skipTracks) {
    if (state.pc) return state.pc;
    const pc = new RTCPeerConnection(ICE);
    state.pc = pc;
    state.remoteDescSet = false;
    state.pendingCandidates = [];

    if (!skipTracks && state.localStream) {
      orderedTracks(state.localStream).forEach(function (tr) {
        pc.addTrack(tr, state.localStream);
      });
    }
    /* se já havia tela compartilhada, ela volta para a linha de vídeo
       (e o áudio da aba, para a linha dele) junto com a nova conexão */
    const shared = screenVideoTrack();
    if (!skipTracks && shared) setOutgoingTrack("video", shared, state.screenStream);
    if (!skipTracks && screenAudioTrack()) setScreenAudio(screenAudioTrack(), state.screenStream);

    pc.onicecandidate = function (ev) {
      if (!ev.candidate || !state.call) return;
      sendSignal("candidate", JSON.stringify(ev.candidate)).catch(function () {});
    };

    pc.ontrack = function (ev) {
      const tr = ev && ev.track;
      if (!tr) return;
      /* SEMPRE mesclar num stream remoto único: cada sender meu/do peer
         chega com um stream próprio — substituir descartava o áudio da
         call assim que a tela chegava */
      if (!state.remoteStream) state.remoteStream = new MediaStream();
      const seen = state.remoteStream.getTracks().some(function (x) {
        return x.id === tr.id;
      });
      if (!seen) {
        state.remoteStream.addTrack(tr);
        attachRemote(state.remoteStream);
      }
      tr.onunmute = paintRemoteVideo;
      tr.onmute = paintRemoteVideo;
      tr.onended = function () {
        if (state.remoteStream) state.remoteStream.removeTrack(tr);
        paintRemoteVideo();
      };
      paintRemoteVideo();
    };

    pc.onconnectionstatechange = function () {
      state.connection = pc.connectionState || "new";
      paintConnection();
    };
    pc.oniceconnectionstatechange = function () {
      if (!state.connection || state.connection === "new" || state.connection === "connected") {
        state.connection = pc.iceConnectionState || state.connection;
        paintConnection();
      }
    };

    pc.onnegotiationneeded = function () {
      if (!state.call || !state.pc) return;
      /* durante o atendimento a oferta/remota ainda vai chegar:
         a renegociação é disparada ao fim da resposta */
      if (state.accepting) return;
      renegotiate();
    };

    return pc;
  }

  /* criação de oferta (1ª ou renegociação de tracks) — sempre
     serializado pelo `signalChain` para não cruzar com um sinal
     que já está sendo aplicado */
  async function renegotiate() {
    const pc = state.pc;
    if (!pc || !state.call) return;
    if (state.makingOffer || state.accepting) return;
    if (pc.signalingState !== "stable") return;
    try {
      state.makingOffer = true;
      const offer = await pc.createOffer();
      if (pc.signalingState !== "stable") return;
      await pc.setLocalDescription(offer);
      await sendSignal("offer", JSON.stringify(pc.localDescription));
    } catch (e) {
      console.warn("[nexo/call] negociação:", e && e.message);
      /* ordem de m-lines fora do esperado: refaz a conexão do zero
         em vez de ficar enviando oferta quebrada */
      if (e && /m-line|m line|order/i.test(String(e.message || ""))) restartPC();
    } finally {
      state.makingOffer = false;
    }
  }

  /* recria a PeerConnection preservando a chamada e as tracks locais */
  let restartingPc = false;
  function restartPC() {
    if (!state.call || restartingPc) return;
    if (state.pcRestarts >= 2) return;
    restartingPc = true;
    state.pcRestarts++;
    try {
      const old = state.pc;
      state.pc = null;
      state.remoteDescSet = false;
      state.pendingCandidates = [];
      state.makingOffer = false;
      state.screenAudioSender = null; /* senders da conexão antiga morrem */
      try {
        if (old) old.close();
      } catch (e) {}
      createPC(false);
      renegotiate();
    } finally {
      restartingPc = false;
    }
  }

  /* sinais de uma mesma chamada precisam ser aplicados em ordem:
     answer e offer que chegam juntos nunca podem rodar em paralelo */
  let signalChain = Promise.resolve();
  function queueSignal(item) {
    signalChain = signalChain
      .then(function () {
        return handleSignal(item);
      })
      .catch(function (e) {
        console.warn("[nexo/call] sinal:", e && e.message);
      });
    return signalChain;
  }

  async function flushCandidates() {
    if (!state.pc || !state.remoteDescSet) return;
    const list = state.pendingCandidates.splice(0);
    for (const c of list) {
      try {
        await state.pc.addIceCandidate(c);
      } catch (e) {
        /* candidato atrasado de uma sessão antiga: ignora */
      }
    }
  }

  /* coloca na conexão as tracks que ainda não têm sender — usado
     após a resposta para o atendente enviar áudio/vídeo */
  function flushLocalTracks() {
    const pc = state.pc;
    if (!pc || !state.localStream) return;
    orderedTracks(state.localStream).forEach(function (tr) {
      const sending = pc.getSenders().some(function (s) {
        return s.track && s.track.kind === tr.kind;
      });
      if (sending) return;
      /* reaproveita uma linha já aberta (transceiver ocioso) antes
         de abrir outra — evita dois m-lines do mesmo tipo */
      const idle = (pc.getTransceivers ? pc.getTransceivers() : []).find(function (tc) {
        return (
          tc.receiver &&
          tc.receiver.track &&
          tc.receiver.track.kind === tr.kind &&
          tc.sender &&
          !tc.sender.track
        );
      });
      if (idle && idle.sender.replaceTrack) {
        try {
          idle.sender.replaceTrack(tr);
          return;
        } catch (e) {
          /* cai para addTrack */
        }
      }
      pc.addTrack(tr, state.localStream);
    });
  }

  async function handleSignal(item) {
    const kind = item && item.kind;
    const raw = (item && item.payload) || "";
    if (!kind || !raw) return;

    if (kind === "bye") {
      if (state.call && state.call.id === item.callId) teardown("peer_left");
      return;
    }

    const callId = item.callId;

    if (kind === "offer" && (!state.pc || (state.call && state.call.id !== callId))) {
      /* oferta chegou antes de eu atender: guarda */
      state.pendingOffers[callId] = raw;
      return;
    }

    const pc = state.pc;
    if (!pc) return;

    if (kind === "candidate") {
      let c;
      try {
        c = JSON.parse(raw);
      } catch (e) {
        return;
      }
      if (!state.remoteDescSet) {
        state.pendingCandidates.push(c);
        return;
      }
      try {
        await pc.addIceCandidate(c);
      } catch (e) {
        if (!state.ignoreOffer) console.warn("[nexo/call] ICE:", e && e.message);
      }
      return;
    }

    if (kind !== "offer" && kind !== "answer") return;

    let desc;
    try {
      desc = JSON.parse(raw);
    } catch (e) {
      return;
    }

    if (kind === "answer") {
      if (state.ignoreOffer) return;
      try {
        await pc.setRemoteDescription(desc);
        state.remoteDescSet = true;
        await flushCandidates();
      } catch (e) {
        console.warn("[nexo/call] answer:", e && e.message);
      }
      return;
    }

    /* offer */
    const collision = state.makingOffer || pc.signalingState !== "stable";
    const polite = !!(state.call && state.call.role === "callee");
    if (collision && !polite) {
      state.ignoreOffer = true;
      return;
    }
    state.ignoreOffer = false;
    try {
      await pc.setRemoteDescription(desc); /* rollback implícito nos navegadores modernos */
      state.remoteDescSet = true;
      await flushCandidates();
      if (pc.signalingState === "have-remote-offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal("answer", JSON.stringify(pc.localDescription));
        /* resposta enviada: o estado volta a "stable" — é o momento
           de colocar as tracks do atendente e renegociar */
        flushLocalTracks();
        await renegotiate();
      }
    } catch (e) {
      console.warn("[nexo/call] offer:", e && e.message);
    }
  }

  function sendSignal(kind, payload) {
    if (!state.call || !NX.api || typeof NX.api.sendSignal !== "function")
      return Promise.resolve(true);
    return Promise.resolve(NX.api.sendSignal(state.call.id, kind, payload)).catch(function () {
      return false;
    });
  }

  /* ---------------- polling da sinalização ---------------- */
  function stopPolling() {
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function schedulePoll(delay) {
    stopPolling();
    if (!S() || !S().me()) return;
    state.pollTimer = setTimeout(poll, delay);
  }

  /* O /calls/peek É DESTRUTIVO no servidor: ele lê as filas de sinal e
     as apaga na mesma resposta. Quem chama o peek sem passar por aqui
     PERDE para sempre os sinais do colega (oferta/replica/candidato).
     Toda leitura de peek passa por aqui: o polling, o reforço do 403,
     a reentrada na sala e a recuperação do F5. */
  function consumePeekSignals(data) {
    if (!data || !Array.isArray(data.signals)) return;
    data.signals.forEach(function (group) {
      if (!group || !Array.isArray(group.items)) return;
      group.items.forEach(function (item) {
        const key = group.callId + "|" + item.kind + "|" + item.at + "|" + (item.payload || "").slice(0, 24);
        if (state.seenSignals[key]) return;
        state.seenSignals[key] = true;
        /* sala de voz (prefixo vc:): nunca entra no fluxo do 1:1 */
        if (String(group.callId || "").indexOf("vc:") === 0) {
          if (state.room) {
            roomRouteSignal(group, item);
          } else {
            /* F5 / segunda aba / boot: a linha ainda existe no servidor e
               os sinais chegam antes de a sala reabrir aqui — guarda e
               reprocessa ao entrar; sem isto a oferta se perde e a call
               fica muda. O prazo é o do PRÓPRIO sinal (servidor), não o
               tempo que ele ficou guardado aqui: no boot, a sala pode
               levar 30s para abrir e a oferta tem que sobreviver a isso */
            const buf = state.pendingRoomSignals || (state.pendingRoomSignals = []);
            buf.push({ group: group, item: item, heldAt: Date.now() });
            if (buf.length > 120) buf.splice(0, buf.length - 120);
          }
          return;
        }
        if (group.callId !== (state.call && state.call.id)) {
          if (item.kind === "offer") state.pendingOffers[group.callId] = item.payload;
          return;
        }
        queueSignal(item);
      });
    });
  }

  /* o que ficou guardado antes de a sala abrir é reprocessado na hora
     em que ela abre (oferta de um colega que já estava dentro) */
  function flushRoomSignals() {
    const buf = state.pendingRoomSignals;
    if (!buf || !buf.length) return;
    state.pendingRoomSignals = [];
    const agora = Date.now();
    buf.forEach(function (x) {
      if (!x || !state.room) return;
      const item = x.item || {};
      /* idade pelo carimbo do SERVIDOR: no boot a sala pode demiar a
         abrir e a oferta do colega precisa atravessar isso */
      const carimbo = Number(item.at) || Number(x.heldAt) || agora;
      const idade = agora - carimbo;
      if (idade > 60000) return; /* velho demais: o colega reofere */
      /* bye antigo não pode derrubar quem acabou de entrar */
      if (item.kind === "bye" && idade > 15000) return;
      roomRouteSignal(x.group, item);
    });
  }

  async function poll() {
    state.pollTimer = null;
    /* aba oculta: economiza requisições — exceto quando há uma
       chamada viva (senão o atendimento passaria despercebido) */
    if (typeof document !== "undefined" && document.hidden && !state.call && !state.room) {
      schedulePoll(POLL_VISIBLE);
      return;
    }
    if (!S() || !S().me()) {
      stopPolling();
      return;
    }
    if (!NX.api || typeof NX.api.peekCalls !== "function") return;

    let data = null;
    try {
      data = await NX.api.peekCalls();
    } catch (e) {
      schedulePoll(POLL_VISIBLE);
      return;
    }
    if (!data) {
      schedulePoll(POLL_VISIBLE);
      return;
    }

    const calls = data.calls || {};
    const peers = data.peers || {};
    const me = S().me();

    /* sinais novos */
    consumePeekSignals(data);

    /* salas de voz: presença real e validação da MINHA linha */
    if (state.room) {
      const voiceList = data.voice;
      /* estado de moderação gravado no servidor (silenciado pela
         moderação / bloqueado) — é a fonte de verdade, não a UI */
      if (data.voiceMod && typeof data.voiceMod === "object") {
        const prev = JSON.stringify(state.mod || {});
        state.mod = data.voiceMod;
        if (prev !== JSON.stringify(state.mod)) applyServerMute();
      }
      if (Array.isArray(voiceList)) {
        const meId = me && me.id;
        const mineHere = voiceList.some(function (v) {
          return v && v.channelId === state.room.channelId && v.userId === meId;
        });
        if (mineHere) {
          state.room.missing = 0;
        } else {
          /* sem a minha linha no servidor eu não estou mais na sala
             (sai em outro aparelho, banco inacessível, etc.) */
          state.room.missing++;
          if (state.room.missing >= 10) {
            leaveRoom("expired");
            return;
          }
        }
      }
      roomSync();
    }

    /* chamada recebida — nunca a que a gente mesmo iniciou
       (role "caller" e a fase de prévia contam como nossas) */
    let incoming = null;
    Object.keys(calls).forEach(function (id) {
      const c = calls[id];
      if (!c || c.state !== "incoming") return;
      if (c.role === "caller") return;
      if (c.peerId === (me && me.id)) return;
      incoming = c;
    });

    if (
      incoming &&
      !state.room &&
      state.phase !== "incoming" &&
      state.phase !== "active" &&
      state.phase !== "outgoing" &&
      state.phase !== "lobby"
    ) {
      state.call = incoming;
      state.peer = peers[incoming.id] || S().user(incoming.peerId) || null;
      state.phase = "incoming";
      state.startedAt = incoming.startedAt || Date.now();
      state.connection = "new";
      bus("call:incoming", { call: incoming, peer: state.peer });
      render();
      sfx("call_ringing");
      if (NX.sfx && NX.sfx.startRing) NX.sfx.startRing();
      startRingTimeout();
      schedulePoll(POLL_INCALL);
      return;
    }

    /* estado da chamada atual */
    if (state.call) {
      const cur = calls[state.call.id];
      if (cur) state.call = cur;
      if (state.peer) state.peer = peers[state.call.id] || state.peer;

      if (state.phase === "outgoing" && cur && cur.state === "active") {
        acceptLocal();
      } else if (cur && (cur.state === "ended" || cur.state === "declined" || cur.state === "missed")) {
        const reason = cur.reason || cur.state;
        if (state.phase !== "none") {
          if (cur.state === "missed")
            toast(t("call.chamadaPerdida", "Chamada perdida — sem resposta."), "warn");
          else if (cur.state === "declined" && state.phase === "outgoing")
            toast(t("call.chamadaRecusada", "A chamada foi recusada."), "info");
          teardown(reason, true);
        }
      } else if (state.phase === "incoming" && cur && cur.state === "incoming") {
        render();
      }
    }

    const live = state.call && ["ringing", "incoming", "active"].indexOf(state.call.state) > -1;
    /* na sala o peek é o que renova a presença e entrega a mídia:
       continua rodando mesmo com a aba oculta */
    if (state.room) {
      schedulePoll(POLL_INCALL);
      return;
    }
    schedulePoll(live ? POLL_INCALL : POLL_VISIBLE);
  }

  function startRingTimeout() {
    clearRingTimeout();
    state.ringTimer = setTimeout(function () {
      if (state.phase === "outgoing" && state.call) {
        end("missed");
        toast(t("call.semResposta", "Sem resposta — chamada perdida."), "warn");
        bus("call:missed", { call: state.call });
      } else if (state.phase === "incoming") {
        /* quem chama encerra; só fecha o cartão */
        end("missed");
      }
    }, RING_TIMEOUT);
  }

  function clearRingTimeout() {
    if (state.ringTimer) {
      clearTimeout(state.ringTimer);
      state.ringTimer = null;
    }
  }

  /* ---------------- ações ---------------- */
  async function start(peerId, opts) {
    opts = opts || {};
    if (!NX.api || typeof NX.api.startCall !== "function")
      throw new Error(t("call.indisponivel", "As chamadas ainda não estão disponíveis."));
    if (state.room)
      throw new Error(t("call.salaAtiva", "Você está em uma sala de voz. Saia dela para ligar."));
    if (state.call) throw new Error(t("call.jaEmChamada", "Você já está em uma chamada."));
    if (state.starting) throw new Error(t("call.jaEmChamada", "Você já está em uma chamada."));
    const me = S().me();
    const peer = S().user(peerId);
    if (!me) throw new Error(t("api.suaSessaoExpirouEntre8", "Sua sessão expirou. Entre novamente."));
    if (!peer) throw new Error(t("call.pessoaNaoEncontrada", "Não encontramos esta pessoa."));
    if (peerId === me.id) throw new Error(t("call.naoLigarParaSi", "Você não pode ligar para si mesmo."));

    /* trava contra clique duplo: dois ligares simultâneos criariam
       duas chamadas no servidor (e duas negociações WebRTC) */
    state.starting = true;
    let call = null;
    try {
      call = await NX.api.startCall(peerId);
    } finally {
      state.starting = false;
    }
    state.call = call;
    state.peer = peer;
    state.phase = "outgoing";
    state.startedAt = Date.now();
    state.connection = "new";
    clearMediaIssues();
    state.pendingCall = null;
    state.minimized = false;
    render();
    sfx("call_ringing");
    if (NX.sfx && NX.sfx.startRing) NX.sfx.startRing();
    bus("call:outgoing", { call: call, peer: peer });
    startRingTimeout();
    schedulePoll(POLL_INCALL);

    if (!opts.hasMedia) {
      try {
        await acquireMedia(!!opts.video);
      } catch (e) {
        /* o motivo real já virou aviso contextual (setMediaIssue):
           toast só quando nenhuma superfície está na tela — o mesmo
           problema nunca é anunciado em dois lugares */
        if (e && e.message && (!state.mediaIssues.length || !mediaUIVisible())) toast(e.message, "warn");
      }
    }
    const pc = createPC();
    if (!state.localStream || !state.localStream.getTracks().length) {
      /* sem permissão de mídia: a negociação continua válida com uma
         linha de áudio para a outra pessoa ainda poder falar */
      try {
        pc.addTransceiver("audio", { direction: "sendrecv" });
      } catch (e) {
        /* navegador sem suporte: segue sem a linha */
      }
    }
    /* a oferta é disparada por onnegotiationneeded (createPC):
       criar uma segunda oferta aqui colidia com a primeira e o
       navegador recusava por ordem de m-lines */
    if (pc.signalingState === "stable" && !state.makingOffer) {
      try {
        await renegotiate();
      } catch (e) {
        console.warn("[nexo/call] offer:", e && e.message);
      }
    }
    render();
    return call;
  }

  async function accept() {
    if (!state.call) return;
    clearRingTimeout();
    if (NX.sfx && NX.sfx.stopRing) NX.sfx.stopRing();

    try {
      await NX.api.respondCall(state.call.id, true);
    } catch (e) {
      toast((e && e.message) || t("call.naoFoiPossivelAtender", "Não foi possível atender."), "error");
      teardown("error", true);
      return;
    }
    state.call.state = "active";
    state.call.answeredAt = Date.now();
    state.phase = "active";
    bus("call:accepted", { call: state.call, peer: state.peer });

    try {
      await acquireMedia(false);
    } catch (e) {
      /* o motivo real já virou aviso contextual (setMediaIssue):
         toast só quando nenhuma superfície está na tela — o mesmo
         problema nunca é anunciado em dois lugares */
      if (e && e.message && (!state.mediaIssues.length || !mediaUIVisible())) toast(e.message, "warn");
    }
    createPC(true); /* sem tracks ainda: entram depois da resposta */
    render();
    attachLocalPreview();
    startTicker();
    sfx("call_join");

    const pending = state.pendingOffers[state.call.id];
    if (pending) {
      delete state.pendingOffers[state.call.id];
      await handleSignal({ kind: "offer", payload: pending, callId: state.call.id });
    }
    schedulePoll(POLL_INCALL);
  }

  async function decline() {
    if (!state.call) return;
    clearRingTimeout();
    if (NX.sfx && NX.sfx.stopRing) NX.sfx.stopRing();
    try {
      await NX.api.respondCall(state.call.id, false);
    } catch (e) {
      /* mesmo com erro o cartão sai */
    }
    bus("call:declined", { call: state.call, peer: state.peer });
    teardown("declined", true);
    toast(t("call.chamadaRecusada2", "Chamada recusada."), "info");
  }

  async function end(reason) {
    const call = state.call;
    if (!call) return;
    clearRingTimeout();
    if (NX.sfx && NX.sfx.stopRing) NX.sfx.stopRing();
    const r = reason || "hangup";
    try {
      await sendSignal("bye", "1");
    } catch (e) {}
    try {
      if (NX.api && typeof NX.api.endCall === "function") await NX.api.endCall(call.id, r);
    } catch (e) {
      /* a chamada pode já ter sido encerrada pelo outro lado */
    }
    bus("call:ended", { call: call, peer: state.peer, reason: r });
    teardown(r, true);
  }

  const hangup = () => end("hangup");

  /* atendimento local: a outra pessoa aceitou */
  function acceptLocal() {
    if (state.phase === "active") return;
    clearRingTimeout();
    if (NX.sfx && NX.sfx.stopRing) NX.sfx.stopRing();
    state.phase = "active";
    state.call.state = "active";
    bus("call:accepted", { call: state.call, peer: state.peer });
    render();
    attachLocalPreview();
    startTicker();
    sfx("call_join");
    const pending = state.pendingOffers[state.call.id];
    if (pending) {
      delete state.pendingOffers[state.call.id];
      handleSignal({ kind: "offer", payload: pending, callId: state.call.id });
    }
  }

  function teardown(reason, notify) {
    clearRingTimeout();
    stopTicker();
    stopTests(); /* libera câmera/microfone de teste */
    stopSpeak(); /* encerra a análise do áudio remoto */
    if (NX.sfx && NX.sfx.stopRing) NX.sfx.stopRing();
    if (reason === "peer_left" || reason === "hangup" || reason === "ended" || reason === "declined" || reason === "missed")
      sfx(reason === "declined" || reason === "missed" ? "call_ended" : "call_leave");

    try {
      if (state.screenStream) state.screenStream.getTracks().forEach((tr) => tr.stop());
      if (state.localStream) state.localStream.getTracks().forEach((tr) => tr.stop());
      if (state.remoteStream) state.remoteStream.getTracks().forEach((tr) => tr.stop());
      if (state.pc) state.pc.close();
    } catch (e) {}
    if (state.audioEl) state.audioEl.srcObject = null;

    state.screen = false;
    state.cam = false;
    state.mic = false;
    state.screenStream = null;
    state.screenAudioSender = null;
    state.screenAudio = false;
    state.screenEnding = false;
    state.localStream = null;
    state.remoteStream = null;
    state.pc = null;
    state.remoteDescSet = false;
    state.pendingCandidates = [];
    state.connection = "new";
    state.call = null;
    state.phase = "none";
    state.root = null;
    state.popOpen = "";
    state.minimized = false;
    state.mediaOpen = false;
    state.pendingCall = null;
    state.starting = false;
    state.pcRestarts = 0;
    document.querySelectorAll('[data-call-audio="1"]').forEach(function (n) {
      if (n !== state.audioEl) n.remove();
    });
    render();
    schedulePoll(POLL_VISIBLE);
  }

  /* ---------------- controles ---------------- */
  function toggleMic() {
    const on = !state.mic;
    if (on && !micTrack()) {
      /* sem captura real não há o que ligar: ESTE clique é que faz o
         navegador abrir o pedido — e só ele, sem insistir sozinho */
      acquireMedia(!!cameraTrack())
        .then(function () {
          if (!state.room) createPC();
          setOutgoingTrack("audio", micTrack(), state.localStream, state.screenAudioSender);
          if (state.room) roomApplyMedia();
          if (state.localStream && !micTrack()) {
            setMediaIssue("microphone", null, null, { reason: "error" });
          } else {
            clearMediaIssue("microphone"); /* captura confirmada por track */
          }
          render();
        })
        .catch(function (e) {
          /* recusado: estado seguro + o aviso único já explica o motivo
             real (toast só quando não há superfície na tela) */
          state.mic = false;
          reopenPermCard();
          if (e && e.message && !mediaUIVisible())
            toast(e.message || t("call.naoUsarMicro", "Não foi possível usar o microfone."), "error");
          render();
        });
      return;
    }
    const tr = micTrack();
    if (tr) tr.enabled = on;
    /* só reporta "ligado" com track de verdade no ar */
    state.mic = !!(tr && tr.enabled);
    if (state.room) roomSendMedia();
    render();
  }

  /* desliga/liga a MINHA faixa de áudio sem passar pelo clique —
     usado quando o servidor registra que estou silenciado pela
     moderação. Não pede mídia de novo e não insiste sozinho. */
  function setMicEnabled(on) {
    const tr = micTrack();
    if (!tr) return false;
    tr.enabled = !!on;
    state.mic = tr.enabled;
    if (state.room) roomSendMedia();
    return state.mic;
  }

  async function toggleCam() {
    const on = !state.cam;
    if (on) {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          const ue = new Error(t("call.naoSuportaCameraMicro", "Este navegador não suporta câmera/microfone."));
          ue.name = "NotSupportedError";
          throw ue;
        }
        const v = await navigator.mediaDevices.getUserMedia({ video: videoConstraints() });
        const track = v.getVideoTracks()[0];
        if (!state.localStream) state.localStream = new MediaStream();
        /* só a câmera anterior — a tela compartilhada fica no próprio
           stream e continua no ar */
        const old = cameraTrack();
        if (old) {
          old.stop();
          state.localStream.removeTrack(old);
        }
        state.localStream.addTrack(track);
        watchLocalTrack(track, "video");
        state.cam = true;
        clearMediaIssue("camera"); /* captura confirmada por track */
        /* se a tela já ocupa a linha de vídeo, a câmera espera: a tela
           é o conteúdo que o outro lado está vendo agora */
        if (!state.screen) setOutgoingTrack("video", track, state.localStream);
        /* na sala a câmera tem linha própria: envia mesmo com tela aberta */
        if (state.room) {
          roomPush("cam", track);
          roomSendMedia();
        }
        render();
        attachLocalPreview();
      } catch (e) {
        state.cam = false;
        /* recusado/sem aparelho/ocupado: registrado no aviso único com
           o motivo real (toast só se não há superfície na tela) */
        setMediaIssue("camera", e, t("call.naoUsarCamera", "Não foi possível usar a câmera."));
        reopenPermCard();
        if (!mediaUIVisible()) toast(issueMessage("camera"), "error");
        render();
      }
      return;
    }
    const tr = cameraTrack();
    if (tr) {
      tr.stop();
      if (state.localStream) state.localStream.removeTrack(tr);
      /* a linha de vídeo continua aberta, sem track (sem renegotiar) */
      if (!state.screen) setOutgoingTrack("video", null, state.localStream);
    }
    state.cam = false;
    if (state.room) {
      roomPush("cam", null);
      roomSendMedia();
    }
    render();
    attachLocalPreview();
  }

  /* ---------------- compartilhamento de tela ----------------
     A tela ocupa a MESMA linha de vídeo da câmera (replaceTrack): sem
     SDP extra, sem ICE novo, e o outro lado vê a tela no vídeo que já
     estava fluindo. Parar devolve a câmera (se ligada) ou a linha vazia. */
  /* corta SÓ o áudio da aba compartilhada: o microfone da call
     continua no ar e o vídeo segue sendo enviado */
  function stopScreenAudio() {
    const at = screenAudioTrack();
    if (!at) {
      state.screenAudio = false;
      render();
      return;
    }
    at.onended = null;
    try {
      at.stop();
    } catch (e) {}
    if (state.screenStream) state.screenStream.removeTrack(at);
    setScreenAudio(null, null);
    state.screenAudio = false;
    if (state.room) roomSendMedia();
    toast(t("call.audioDaAbaDesligado", "Áudio da aba desligado. O microfone continua ativo."), "info");
    bus("call:screen", { sharing: !!state.screen, audio: false });
    render();
  }

  function stopScreenShare(fromNative) {
    const st = state.screenStream;
    const hadAudio = !!screenAudioTrack();
    state.screen = false;
    state.screenStream = null;
    /* na sala a tela tem linha própria: limpa SÓ ela (a câmera fica) */
    if (state.room) {
      roomPush("screen", null);
      roomSendMedia();
    }

    /* só as tracks da tela morrem: microfone e câmera seguem intactos */
    if (st) {
      st.getTracks().forEach(function (tr) {
        tr.onended = null;
        try {
          tr.stop();
        } catch (e) {}
      });
    }
    /* áudio compartilhado: tira SÓ a linha dele (o mic não é afetado) */
    if (hadAudio) setScreenAudio(null, null);
    /* volta para a câmera, se estiver ligada */
    if (!state.cam) setOutgoingTrack("video", null, state.localStream);
    else setOutgoingTrack("video", cameraTrack(), state.localStream);

    render();
    attachLocalPreview();
    if (fromNative) {
      toast(t("call.telaEncerradaNat", "Compartilhamento de tela encerrado pelo navegador."), "info");
    }
    bus("call:screen", { sharing: false });
  }

  async function toggleScreen() {
    if (state.screen) {
      stopScreenShare(false);
      return;
    }
    if (state.screenEnding) return; /* evita dois pickers / avisos duplos */
    state.screenEnding = true;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia)
        throw new Error(
          t(
            "call.naoSuportaCompartilhar",
            "Este navegador não suporta compartilhar a tela. Tente Chrome, Edge ou Firefox atualizados."
          )
        );
      /* `audio: true` pede o áudio da ABA quando o navegador oferece
         (Chrome/Edge). Só repetimos quando as constraints são
         REJEITADAS (TypeError) — nunca quando o usuário cancela o
         seletor, senão abriríamos um segundo seletor em cima */
      let st = null;
      try {
        st = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      } catch (e) {
        if (e && e.name === "TypeError") {
          st = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        } else {
          throw e;
        }
      }
      const track = st.getVideoTracks()[0];
      if (!track) throw new Error(t("call.compartilhamentoCancelado", "Compartilhamento cancelado."));
      track._nxSource = "screen";

      state.screenStream = st;
      state.screen = true;

      /* o navegador (ou o botão "Parar compartilhar" nativo) encerra a
         track: o Nexo acompanha sozinho */
      track.onended = function () {
        if (!state.screen) return;
        stopScreenShare(true);
      };

      setOutgoingTrack("video", track, st);
      const sharedAudio = st.getAudioTracks()[0];
      if (sharedAudio) {
        sharedAudio._nxSource = "screen";
        setScreenAudio(sharedAudio, st);
      }
      render();
      attachScreenPreview();
      if (state.room) roomSendMedia();
      bus("call:screen", { sharing: true, audio: !!sharedAudio });
      if (sharedAudio) {
        toast(
          t(
            "call.telaComAudio",
            "Áudio da aba compartilhada sendo enviado. Use fones para o outro não ouvir eco."
          ),
          "info"
        );
      }
    } catch (e) {
      if (e && (e.name === "NotAllowedError" || e.name === "AbortError")) {
        /* cancelou o seletor: volta ao estado anterior, SEM erro —
           o pedido nativo é só um. Só dizemos "bloqueado" quando o
           site está realmente proibido nas permissões do navegador. */
        const ps = await permState("display-capture");
        if (ps === "denied") {
          toast(
            t("call.telaBloqueada", "O navegador está bloqueando o compartilhamento de tela.") +
              " " +
              permHelp("screen"),
            "error"
          );
        } else {
          toast(
            t("call.compartilhamentoCancelado", "Compartilhamento de tela cancelado — nada mudou na chamada."),
            "info"
          );
        }
      } else if (e && e.name === "NotSupportedError") {
        toast(
          t("call.naoSuportaCompartilhar", "Este navegador não suporta compartilhar a tela."),
          "error"
        );
      } else {
        toast((e && e.message) || t("call.naoCompartilharTela", "Não foi possível compartilhar a tela."), "error");
      }
    } finally {
      state.screenEnding = false;
    }
  }

  function setVolume(v) {
    state.volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (state.audioEl) state.audioEl.volume = state.volume;
    if (state.room) roomVolume(state.volume);
    const bar = state.root && state.root.querySelector("[data-call-volbar]");
    if (bar) bar.style.width = Math.round(state.volume * 100) + "%";
  }

  async function listDevices(kind) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      return list.filter((d) => d.kind === kind);
    } catch (e) {
      return [];
    }
  }

  async function setMicDevice(id) {
    state.micDevice = id || "";
    if (!state.localStream && !state.mic) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() });
      const track = s.getAudioTracks()[0];
      const old = micTrack();
      if (old) {
        old.stop();
        if (state.localStream) state.localStream.removeTrack(old);
      }
      if (!state.localStream) state.localStream = new MediaStream();
      state.localStream.addTrack(track);
      watchLocalTrack(track, "audio");
      setOutgoingTrack("audio", track, state.localStream, state.screenAudioSender);
      state.mic = true;
      clearMediaIssue("microphone"); /* captura confirmada por track */
      if (state.room) {
        roomApplyMedia();
        roomSendMedia();
      }
      render();
    } catch (e) {
      /* motivo real no aviso único; toast só sem superfície na tela */
      setMediaIssue("microphone", e, t("call.naoTrocarMicro", "Não foi possível trocar o microfone."));
      reopenPermCard();
      if (!mediaUIVisible()) toast(issueMessage("microphone"), "error");
    }
  }

  async function setCamDevice(id) {
    state.camDevice = id || "";
    if (!state.cam) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints() });
      const track = s.getVideoTracks()[0];
      const old = cameraTrack();
      if (old) {
        old.stop();
        if (state.localStream) state.localStream.removeTrack(old);
      }
      if (!state.localStream) state.localStream = new MediaStream();
      state.localStream.addTrack(track);
      watchLocalTrack(track, "video");
      /* a tela é quem ocupa a linha de vídeo agora: troca só a câmera
         guardada, sem mexer no que o outro lado está vendo */
      if (!state.screen) setOutgoingTrack("video", track, state.localStream);
      if (state.room) {
        roomPush("cam", track);
        roomSendMedia();
      }
      clearMediaIssue("camera"); /* captura confirmada por track */
      render();
      attachLocalPreview();
    } catch (e) {
      /* motivo real no aviso único; toast só sem superfície na tela */
      setMediaIssue("camera", e, t("call.naoTrocarCamera", "Não foi possível trocar a câmera."));
      reopenPermCard();
      if (!mediaUIVisible()) toast(issueMessage("camera"), "error");
    }
  }

  async function setOutDevice(id) {
    state.outDevice = id || "";
    const a = state.audioEl;
    if (a && typeof a.setSinkId === "function" && id) {
      try {
        await a.setSinkId(id);
      } catch (e) {
        /* navegador sem suporte */
      }
    }
  }

  function applyProcessing() {
    /* aplica no próximo acesso de mídia (constraints) */
    if (state.mic) setMicDevice(state.micDevice);
  }

  /* ---------------- ticker de duração ---------------- */
  function startTicker() {
    stopTicker();
    state.tickTimer = setInterval(function () {
      const node = state.root && state.root.querySelector("[data-call-time]");
      if (node) node.textContent = fmtTime(Date.now() - (state.call && state.call.answeredAt ? state.call.answeredAt : state.startedAt));
    }, 1000);
  }

  function stopTicker() {
    if (state.tickTimer) {
      clearInterval(state.tickTimer);
      state.tickTimer = null;
    }
  }

  function paintConnection() {
    const node = state.root && state.root.querySelector("[data-call-conn]");
    if (!node) return;
    node.textContent = connLabel();
    node.dataset.conn = state.connection || "new";
  }

  /* ---------------- render ---------------- */
  function ensureRoot() {
    let root = document.getElementById("call-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "call-root";
      document.body.appendChild(root);
    }
    return root;
  }

  function render() {
    /* sala de voz ativa: a camada dela é que manda (o cartão 1:1 fica
       escondido — as duas nunca convivem) */
    if (state.room) {
      renderRoom();
      return;
    }
    const root = ensureRoot();
    state.root = root;
    root.innerHTML = "";
    root.className = "";
    document.body.classList.toggle(
      "in-call",
      state.phase === "active" && !state.minimized
    );

    if (state.phase === "none") {
      root.hidden = true;
      return;
    }
    root.hidden = false;

    if (state.phase === "active" && state.minimized) {
      root.className = "call-layer call-layer--pill";
      root.innerHTML = pillHTML();
      bind(root);
      return;
    }

    if (state.phase === "lobby") {
      root.className = "call-layer call-layer--lobby";
      root.innerHTML = lobbyHTML();
      bind(root);
      attachLobbyPreview();
      return;
    }

    if (state.phase === "incoming") {
      root.className = "call-layer call-layer--card";
      root.innerHTML = cardHTML("incoming");
    } else if (state.phase === "outgoing") {
      root.className = "call-layer call-layer--card";
      root.innerHTML = cardHTML("outgoing");
    } else {
      root.className = "call-layer call-layer--screen";
      root.innerHTML = screenHTML();
      attachLocalPreview();
      if (state.remoteStream) {
        const rv = root.querySelector("[data-call-remote]");
        if (rv) {
          rv.srcObject = state.remoteStream;
          const pr = rv.play();
          if (pr && pr.catch) pr.catch(function () {});
        }
      }
      /* só anuncia vídeo quando a track remota está viva de verdade */
      paintRemoteVideo();
      if (state.screen) attachScreenPreview();
      paintConnection();
    }
    bind(root);

    /* o popover sobrevive ao re-render dos controles */
    if (state.popOpen) {
      const pop = root.querySelector("[data-call-pop]");
      if (pop) {
        pop.hidden = false;
        pop.dataset.open = state.popOpen;
        openPopover(state.popOpen, true);
      }
    }
  }

  function cardHTML(mode) {
    const peer = state.peer || {};
    const incoming = mode === "incoming";
    const label = incoming
      ? t("call.chamadaRecebida", "Chamada recebida")
      : t("call.ligando", "Ligando…") + (peer.username ? "" : "");
    return (
      '<div class="call-card call-card--' + mode + '" role="dialog" aria-live="polite">' +
      '<div class="call-card__av call-card__av--pulse">' + avatarHTML("lg", false) + "</div>" +
      '<div class="call-card__body">' +
      '<strong class="call-card__name">' + hh(peerName()) + "</strong>" +
      '<span class="call-card__handle">@' + hh(peer.username || "") + "</span>" +
      '<span class="call-card__status"><i class="dot" data-status="' + hh(peer.status || "offline") + '"></i>' +
      hh(statusLabel(peer.status || "offline")) + "</span>" +
      '<span class="call-card__label">' + label + "</span>" +
      "</div>" +
      '<div class="call-card__acts">' +
      '<button type="button" class="call-fab call-fab--danger" data-call="decline" aria-label="' +
      (incoming ? t("call.recusar", "Recusar") : t("call.cancelar", "Cancelar")) + '">' +
      NX.icon("phoneOff", "", 22) + "</button>" +
      (incoming
        ? '<button type="button" class="call-fab call-fab--ok" data-call="accept" aria-label="' +
          t("call.atender", "Atender") + '">' + NX.icon("phone", "", 22) + "</button>"
        : "") +
      "</div>" +
      "</div>"
    );
  }

  /* =========================================================
     AVISO ÚNICO DE PERMISSÃO (call1:1, sala de voz e lobby)
     Um só componente, dentro da área da chamada, com largura
     limitada, texto quebrado corretamente, ação real de nova
     tentativa e fechar VISUAL (nunca fingi que a permissão foi
     concedida). O mesmo aviso não aparece em outro lugar.
     ========================================================= */
  function permCardHTML(flow) {
    const issues = state.mediaIssues;
    if (!issues.length || state.mediaDismissed) return "";
    const multi = issues.length > 1;
    const title = multi
      ? t("call.permTituloMulti", "Permissões de mídia necessárias")
      : issues[0].title;
    const body = issues
      .map(function (x) {
        return x.body;
      })
      .join(" ");
    const help = issues
      .map(function (x) {
        return x.help;
      })
      .filter(Boolean)
      .join(" ");
    const closeLbl = t("call.permFechar", "Fechar aviso");
    return (
      '<div class="call-perm' +
      (flow ? " call-perm--flow" : " call-perm--float") +
      '" role="alert" data-perm-card>' +
      '<div class="call-perm__head">' +
      '<span class="call-perm__ico" aria-hidden="true">' + NX.icon("alert", "", 17) + "</span>" +
      "<strong>" + hh(title) + "</strong>" +
      '<button type="button" class="call-perm__x" data-call="perm-dismiss" aria-label="' +
      hh(closeLbl) +
      '" title="' +
      hh(closeLbl) +
      '">' +
      NX.icon("x", "", 14) +
      "</button>" +
      "</div>" +
      '<p class="call-perm__body">' + hh(body) + "</p>" +
      (state.permHelpOpen && help ? '<p class="call-perm__help">' + hh(help) + "</p>" : "") +
      '<div class="call-perm__acts">' +
      (help
        ? '<button type="button" class="btn btn--ghost btn--sm" data-call="perm-help" aria-expanded="' +
          (state.permHelpOpen ? "true" : "false") +
          '">' +
          (
            state.permHelpOpen
              ? t("call.permOcultar", "Ocultar")
              : t("call.permComoPermitir", "Como permitir")
          ) +
          "</button>"
        : "") +
      '<button type="button" class="btn btn--primary btn--sm" data-call="perm-retry">' +
      NX.icon("refresh", "", 14) +
      " " +
      t("call.permTentarNovamente", "Tentar novamente") +
      "</button>" +
      "</div>" +
      "</div>"
    );
  }

  /* "Tentar novamente": nova tentativa REAL de captura. O aviso só sai
     quando a captura é confirmada por uma track viva de verdade. */
  async function retryMedia(silent) {
    /* tentativa nova = resultado à vista: se o aviso estava fechado,
       ele volta a aparecer com o desfecho real (liberado ou não) */
    reopenPermCard();
    const withVideo =
      !!cameraTrack() ||
      state.mediaIssues.some(function (x) {
        return x.kind === "camera";
      }) ||
      !!(state.pendingCall && state.pendingCall.video);
    try {
      await acquireMedia(withVideo);
      if (state.room) roomApplyMedia();
      if (state.phase !== "none" && state.localStream) {
        try {
          setOutgoingTrack("audio", micTrack(), state.localStream, state.screenAudioSender);
        } catch (e) {}
      }
      if (!silent && !state.mediaIssues.length)
        toast(t("call.midiaLiberada", "Mídia liberada — captura confirmada."), "success");
    } catch (e) {
      /* o motivo real já foi registrado em setMediaIssue: o próprio
         aviso (cartão ou dock) explica — sem toast em duplicidade */
    }
    render();
    try {
      if (NX.store && NX.store.commit) NX.store.commit(["voice"]);
    } catch (e) {}
  }

  /* quando o navegador muda a permissão sozinho (configurações do
     site), o aviso acompanha: concedido de verdade → tenta capturar de
     novo e só assim o aviso sai. Nada é marcado como funcionando sem
     track no ar. */
  function watchPermChanges() {
    if (!navigator.permissions || !navigator.permissions.query) return;
    ["microphone", "camera"].forEach(function (name) {
      try {
        navigator.permissions
          .query({ name: name })
          .then(function (st) {
            st.onchange = function () {
              if (st.state !== "granted") return;
              if (!state.room && state.phase === "none") return;
              if (state.mediaIssues.length) retryMedia(true);
            };
          })
          .catch(function () {});
      } catch (e) {
        /* navegador não expõe: quem avisa é o próprio pedido */
      }
    });
  }

  function screenHTML() {
    const peer = state.peer || {};
    const sharing = state.screen && state.screenStream;
    const cam = !!cameraTrack();
    return (
      '<div class="call-screen" role="dialog" aria-label="' + t("call.emChamada", "Em chamada") + '">' +
      '<header class="call-head">' +
      '<div class="call-head__who">' +
      '<span class="call-head__av">' + avatarHTML("sm", true) + "</span>" +
      "<span class=\"call-head__txt\"><strong>" + hh(peerName()) + "</strong>" +
      "<small>@" + hh(peer.username || "") + " · " + hh(statusLabel(peer.status || "offline")) + "</small></span>" +
      "</div>" +
      '<div class="call-head__meta">' +
      '<span class="call-chip" data-call-conn>' + hh(connLabel()) + "</span>" +
      '<span class="call-chip call-chip--time" data-call-time>' + fmtTime(Date.now() - (state.call && state.call.answeredAt ? state.call.answeredAt : state.startedAt)) + "</span>" +
      (sharing
        ? '<span class="call-chip call-chip--live">' + NX.icon("monitor", "", 14) + " " +
          t("call.compartilhando", "Compartilhando a tela") +
          "</span>"
        : "") +
      '<button type="button" class="call-chip call-chip--btn' + (state.mediaOpen ? " is-on" : "") +
      '" data-call="media">' + NX.icon("film", "", 16) + " " + t("call.midia", "Mídia") + "</button>" +
      '<button type="button" class="call-chip call-chip--btn" data-call="min" aria-label="' +
      t("call.minimizar", "Minimizar") + '">–</button>' +
      "</div>" +
      "</header>" +
      '<div class="call-stage' + (sharing ? " is-sharing" : "") + '">' +
      '<div class="call-stage__remote">' +
      '<video class="call-video call-video--remote" data-call-remote autoplay playsinline></video>' +
      '<div class="call-stage__fallback">' + avatarHTML("xl", false) +
      "<span>" + hh(peerName()) + "</span>" +
      '<em>' +
      (sharing
        ? t("call.voceCompartilhando", "Você está compartilhando a tela")
        : state.cam
          ? ""
          : t("call.cameraDesligada", "Câmera desligada")) +
      "</em></div>" +
      "</div>" +
      '<span class="call-stage__tag call-stage__tag--speak" data-call-speaking hidden>' + NX.icon("volume", "", 14) + " " +
      t("call.falando", "Falando…") + "</span>" +
      (sharing
        ? '<div class="call-stage__screen"><video class="call-video call-video--screen" data-call-screen autoplay playsinline muted></video>' +
          '<span class="call-stage__tag">' + NX.icon("monitor", "", 14) + " " + t("call.voceCompartilhando", "Você está compartilhando a tela") + "</span></div>"
        : "") +
      '<div class="call-stage__local' + (cam ? " has-video" : "") + '">' +
      '<span class="call-stage__localph">' + avatarHTML("lg", false) + "</span>" +
      '<video class="call-video call-video--local" data-call-local autoplay muted playsinline></video>' +
      '<span class="call-stage__localtag">' + (state.mic ? NX.icon("mic", "", 13) + " " + t("call.microAtivo", "Micro ativo") : NX.icon("mic", "", 13) + " " + t("call.microDesligado", "Micro desligado")) + "</span>" +
      "</div>" +
      (state.mediaWarned
        ? permCardHTML(false)
        : "") +
      "</div>" +
      '<div class="call-bar">' +
      ctl(
        "mic",
        NX.icon("mic", "", 18),
        state.mic ? t("call.micro", "Micro") : t("call.microDesligado2", "Mudo"),
        !state.mic,
        state.mic
          ? t("call.dicaMicroOn", "Microfone ligado — clique para silenciar. Escolher outro microfone nas Configurações.")
          : t("call.dicaMicroOff", "Microfone desligado — clique para ativar. Escolher outro microfone nas Configurações.")
      ) +
      ctl(
        "cam",
        NX.icon("camera", "", 18),
        state.cam ? t("call.camera", "Câmera") : t("call.camera2", "Câmera"),
        !state.cam,
        state.cam
          ? t("call.dicaCamOn", "Câmera ligada — clique para desligar. Prévia e escolha da câmera nas Configurações.")
          : t("call.dicaCamOff", "Câmera desligada — clique para ligar. Prévia e escolha da câmera nas Configurações.")
      ) +
      ctl(
        "screen",
        state.screen ? NX.icon("stop", "", 18) : NX.icon("monitor", "", 18),
        state.screen ? t("call.pararTela", "Parar tela") : t("call.tela", "Tela"),
        state.screen,
        state.screen
          ? t("call.dicaTelaOn", "Compartilhando a tela — clique para parar (a chamada continua).")
          : t("call.dicaTelaOff", "Compartilhar a tela — abre o seletor de janelas/abas do navegador.")
      ) +
      ctl("volume", NX.icon("volume", "", 18), t("call.volume", "Volume"), false) +
      ctl("people", NX.icon("users", "", 18), t("call.pessoas", "Pessoas"), false) +
      ctl("tx", NX.icon("monitor", "", 18), t("call.tx.titulo", "Transmissão"), state.popOpen === "tx") +
      ctl("settings", NX.icon("settings", "", 18), t("call.config", "Configurações"), false) +
      ctl("full", NX.icon("maximize", "", 18), t("call.telaCheia", "Tela cheia"), false) +
      '<button type="button" class="call-ctl call-ctl--hang" data-call="hangup"><span class="call-ctl__ico">' + NX.icon("phoneOff", "", 18) + "</span>" +
      "<span>" + t("call.encerrar", "Encerrar") + "</span></button>" +
      "</div>" +
      '<div class="call-pop" data-call-pop hidden></div>' +
      '<aside class="call-media' + (state.mediaOpen ? " is-open" : "") + '" data-call-media' +
      (state.mediaOpen ? "" : " hidden") + ">" +
      mediaHTML() +
      "</aside>" +
      "</div>"
    );
  }

  /* painel de mídia: estado real (tela compartilhada ou vazio) —
     sem player falso, sem jogo inventado */
  function mediaHTML() {
    const sharing = !!(state.screen && state.screenStream);
    return (
      '<header class="call-media__head"><strong>' + NX.icon("film", "", 16) + " " + t("call.midia", "Mídia") + "</strong>" +
      '<button type="button" class="call-media__x" data-call="media" aria-label="' +
      t("call.fechar", "Fechar") + '">' + NX.icon("x", "", 16) + "</button></header>" +
      '<div class="call-media__body">' +
      (sharing
        ? '<div class="call-media__item"><span class="call-media__thumb">' + NX.icon("monitor", "", 22) + "</span>" +
          "<span><strong>" + t("call.telaCompartilhada", "Tela compartilhada") + "</strong>" +
          "<small>" + t("call.voceEnviandoTela", "Você está enviando sua tela") + "</small></span>" +
          '<button type="button" class="call-media__cta" data-call="screen">' +
          t("call.parar", "Parar") + "</button></div>" +
          /* o áudio da aba é opcional e independente do microfone:
             dá para cortar só ele sem desligar a call */
          (state.screenAudio
            ? '<div class="call-media__item"><span class="call-media__thumb">' + NX.icon("volume", "", 22) + "</span>" +
              "<span><strong>" + t("call.audioDaAba", "Áudio da aba") + "</strong>" +
              "<small>" +
              t("call.audioDaAbaAtivo", "Som da aba compartilhada sendo enviado") +
              "</small></span>" +
              '<button type="button" class="call-media__cta" data-call="screen-audio-off">' +
              t("call.desligarAudioAba", "Desligar") + "</button></div>"
            : '<div class="call-media__item call-media__item--muted"><span class="call-media__thumb">' + NX.icon("volumeOff", "", 22) + "</span>" +
              "<span><strong>" + t("call.audioDaAba", "Áudio da aba") + "</strong>" +
              "<small>" +
              t(
                "call.audioDaAbaIndisponivel",
                "Sem áudio — selecione uma ABA e marque “Compartilhar áudio da aba”"
              ) +
              "</small></span></div>")
        : '<div class="call-media__empty"><span>' + NX.icon("film", "", 22) + "</span><strong>" +
          t("call.nenhumaMidia", "Nenhuma mídia compartilhada") + "</strong><p>" +
          t("call.compartilheParaComecar", "Compartilhe uma tela ou conteúdo para começar.") +
          "</p>" +
          '<button type="button" class="call-media__cta" data-call="screen">' + NX.icon("monitor", "", 16) + " " +
          t("call.compartilharTela", "Compartilhar tela") + "</button></div>") +
      '<section class="call-media__sec"><h4>' + NX.icon("gamepad", "", 15) + " " + t("call.atividade", "Atividade") + "</h4>" +
      '<div class="call-media__empty call-media__empty--sm"><span>' + NX.icon("gamepad", "", 22) + "</span><strong>" +
      t("call.nenhumaAtividade", "Nenhuma atividade em andamento") + "</strong><p>" +
      t(
        "call.atividadePreparada",
        "Espaço preparado para jogos e conteúdo compartilhado no futuro."
      ) +
      "</p></div></section>" +
      "</div>"
    );
  }

  /* versão minimizada: pastilha flutuante com duração e retorno */
  function pillHTML() {
    return (
      '<div class="call-pill" role="status">' +
      '<span class="call-pill__av">' + avatarHTML("xs", false) + "</span>" +
      '<span class="call-pill__txt"><strong>' + hh(peerName()) + "</strong>" +
      '<small data-call-time>' +
      fmtTime(Date.now() - (state.call && state.call.answeredAt ? state.call.answeredAt : state.startedAt)) +
      "</small></span>" +
      '<button type="button" class="call-pill__btn" data-call="restore" aria-label="' +
      t("call.voltar", "Voltar para a chamada") + '">⤢</button>' +
      '<button type="button" class="call-pill__btn call-pill__btn--hang" data-call="hangup" aria-label="' +
      t("call.encerrar", "Encerrar") + '">' + NX.icon("phoneOff", "", 16) + "</button>" +
      "</div>"
    );
  }

  function ctl(name, ico, label, active, title) {
    const tip = title || label;
    return (
      '<button type="button" class="call-ctl' + (active ? " is-on" : "") + '" data-call="' + name + '"' +
      ' title="' + hh(tip) + '" aria-label="' + hh(label) + '"' +
      ' aria-pressed="' + (active ? "true" : "false") + '">' +
      '<span class="call-ctl__ico">' + ico + "</span><span>" + hh(label) + "</span></button>"
    );
  }

  function closePopover() {
    const pop = state.root && state.root.querySelector("[data-call-pop]");
    state.popOpen = "";
    txStopStats(); /* a leitura de getStats só existe com o painel aberto */
    if (!pop) return;
    pop.hidden = true;
    pop.dataset.open = "";
    pop.classList.remove("call-pop--sheet");
    stopTests(); /* o teste de microfone/câmera só existe com o painel aberto */
  }

  async function openPopover(which, force) {
    const pop = state.root && state.root.querySelector("[data-call-pop]");
    if (!pop) return;
    if (!force && pop.dataset.open === which) {
      closePopover();
      return;
    }
    pop.hidden = false;
    pop.dataset.open = which;
    state.popOpen = which;
    pop.classList.remove("call-pop--sheet");
    if (which !== "settings") stopTests();

    if (which === "people") {
      pop.innerHTML = peopleHTML();
      return;
    }

    /* Transmissão: qualidade/FPS aplicados de verdade + medição real.
       É uma folha (como "Áudio e vídeo") porque carrega o painel de
       estatísticas. bindTx roda aqui porque o render() recria o DOM. */
    if (which === "tx") {
      pop.classList.add("call-pop--sheet");
      pop.innerHTML = txHTML();
      pop.querySelector(".tx").dataset.txWarnKey = state.txWarns.map(function (x) { return x.k; }).join(",");
      bindTx(pop);
      txOpenPanel();
      return;
    }

    if (which === "volume") {
      pop.innerHTML =
        '<div class="call-pop__row"><label for="call-vol">' + t("call.volume", "Volume") + "</label>" +
        '<input id="call-vol" type="range" min="0" max="100" value="' + Math.round(state.volume * 100) +
        '" data-call-volrange /><span data-call-volval>' + Math.round(state.volume * 100) + "%</span></div>";
      const range = pop.querySelector("[data-call-volrange]");
      range.addEventListener("input", function () {
        setVolume(Number(range.value) / 100);
        const v = pop.querySelector("[data-call-volval]");
        if (v) v.textContent = range.value + "%";
      });
      return;
    }

    /* Áudio e vídeo: teste REAL de microfone/câmera medido pelo
       navegador (Web Audio + AnalyserNode), volume e processamento */
    pop.classList.add("call-pop--sheet");
    await openSettingsPanel(pop);
  }

  function sw(key, label, on) {
    return (
      '<label class="call-switch"><input type="checkbox" data-call-switch="' + key + '"' + (on ? " checked" : "") +
      " /><span>" + hh(label) + "</span></label>"
    );
  }

  /* =========================================================
     TESTES DE DISPOSITIVO
     Streams de teste são SEPARADOS do `state.localStream`
     (callMediaStream): fechar um teste nunca interrompe a
     chamada, e o teste nunca envia áudio para a outra pessoa.
     ========================================================= */
  const test = {
    mic: null,
    micBorrowed: false,
    cam: null,
    ctx: null,
    analyser: null,
    src: null,
    raf: 0,
    buf: null,
    startedAt: 0,
    lastPeak: 0,
    level: 0,
    micState: "idle",
    camState: "idle",
    mics: null,
    cams: null,
    outs: null,
  };

  /* indicador de fala: análise REAL do áudio remoto */
  const speak = {
    ctx: null,
    src: null,
    analyser: null,
    raf: 0,
    buf: null,
    on: false,
    stream: null,
  };

  function supportsSink() {
    try {
      return (
        typeof document !== "undefined" &&
        typeof document.createElement("audio").setSinkId === "function"
      );
    } catch (e) {
      return false;
    }
  }

  function audioCtx() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error("Web Audio indisponível");
    const ctx = new Ctx();
    if (ctx.state === "suspended" && ctx.resume) ctx.resume();
    return ctx;
  }

  function rmsOf(analyser, buf) {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }

  /* ---------------- teste de microfone ---------------- */
  async function startMicTest() {
    stopMicTest();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      test.micState = "error";
      paintTests();
      return;
    }
    let stream = null;
    let borrowed = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() });
    } catch (e) {
      const callTrack = state.localStream && state.localStream.getAudioTracks()[0];
      if (callTrack && callTrack.enabled) {
        /* o aparelho recusou um 2º stream: mede o que a call já
           captura (análise real, sem enviar nada para a chamada) */
        stream = new MediaStream([callTrack]);
        borrowed = true;
      } else {
        const n = (e && e.name) || "";
        /* sem aparelho e aparelho ocupado são coisas diferentes */
        test.micState =
          n === "NotFoundError" || n === "DevicesNotFoundError" || n === "OverconstrainedError"
            ? "empty"
            : "busy";
        paintTests();
        return;
      }
    }
    test.mic = stream;
    test.micBorrowed = borrowed;
    try {
      const ctx = audioCtx();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0.5;
      src.connect(an);
      test.ctx = ctx;
      test.src = src;
      test.analyser = an;
      test.buf = null;
      test.startedAt = Date.now();
      test.lastPeak = Date.now();
      test.micState = "ok";
      paintTests();
      meterLoop();
    } catch (e) {
      stopMicTest();
      test.micState = "error";
      paintTests();
    }
  }

  function meterLoop() {
    if (!test.analyser) return;
    try {
      if (!test.buf || test.buf.length !== test.analyser.fftSize)
        test.buf = new Uint8Array(test.analyser.fftSize);
      const rms = rmsOf(test.analyser, test.buf);
      const level = Math.max(0, Math.min(1, rms * 3.6));
      test.level = level;
      if (level > 0.035) test.lastPeak = Date.now();
      paintMeter(level);

      const silent = Date.now() - test.lastPeak > 5000;
      const aged = Date.now() - test.startedAt > 6500;
      if (test.micState === "ok" && aged && silent) {
        test.micState = "nodata";
        paintTests();
      } else if (test.micState === "nodata" && !silent) {
        test.micState = "ok";
        paintTests();
      }
    } catch (e) {
      /* medidor nunca pode quebrar a tela */
    }
    test.raf = requestAnimationFrame(meterLoop);
  }

  function paintMeter(level) {
    const root = state.root;
    if (!root) return;
    const pct = Math.round(Math.max(0, Math.min(1, level || 0)) * 100);
    const fill = root.querySelector("[data-test-level]");
    if (fill) fill.style.width = pct + "%";
    const knob = root.querySelector("[data-test-knob]");
    if (knob) knob.style.left = pct + "%";
    const meter = root.querySelector(".av-meter");
    if (meter) meter.setAttribute("aria-valuenow", String(pct));
  }

  function stopMicTest() {
    if (test.raf) {
      cancelAnimationFrame(test.raf);
      test.raf = 0;
    }
    if (test.src) {
      try {
        test.src.disconnect();
      } catch (e) {}
      test.src = null;
    }
    test.analyser = null;
    test.buf = null;
    /* nunca para a track da call (só a do teste) */
    if (test.mic && !test.micBorrowed)
      test.mic.getTracks().forEach(function (tr) {
        try {
          tr.stop();
        } catch (e) {}
      });
    test.mic = null;
    test.micBorrowed = false;
    if (test.ctx) {
      try {
        test.ctx.close();
      } catch (e) {}
      test.ctx = null;
    }
    test.level = 0;
  }

  /* ---------------- teste de câmera ---------------- */
  async function startCamTest() {
    stopCamTest();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      test.camState = "error";
      paintTests();
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints() });
      test.cam = s;
      test.camState = "ok";
      paintTests();
      attachCamPreview();
    } catch (e) {
      const n = (e && e.name) || "";
      test.camState =
        n === "NotAllowedError" || n === "SecurityError"
          ? "denied"
          : n === "NotFoundError" || n === "OverconstrainedError"
          ? "empty"
          : "error";
      paintTests();
    }
  }

  function stopCamTest() {
    if (test.cam) {
      test.cam.getTracks().forEach(function (tr) {
        try {
          tr.stop();
        } catch (e) {}
      });
      test.cam = null;
    }
    const v = state.root && state.root.querySelector("[data-test-cam]");
    if (v)
      try {
        v.srcObject = null;
      } catch (e) {}
  }

  function attachCamPreview() {
    const root = state.root;
    if (!root || !test.cam) return;
    const v = root.querySelector("[data-test-cam]");
    if (!v) return;
    v.srcObject = test.cam;
    const p = v.play();
    if (p && p.catch) p.catch(function () {});
    const ph = root.querySelector("[data-test-cam-ph]");
    if (ph) ph.hidden = true;
  }

  function stopTests() {
    stopMicTest();
    stopCamTest();
    if (test.micState !== "idle") test.micState = "idle";
    if (test.camState !== "idle") test.camState = "idle";
  }

  function testAudio() {
    try {
      if (NX.sfx && typeof NX.sfx.test === "function" && NX.sfx.test()) return;
      if (NX.sfx && typeof NX.sfx.play === "function" && NX.sfx.play("success")) return;
    } catch (e) {}
    toast(t("call.naoReproduziuSom", "Não foi possível reproduzir o som de teste."), "warn");
  }

  /* ---------------- rótulos de estado (pt-BR) ---------------- */
  function micChip() {
    switch (test.micState) {
      case "ok":
        return t("call.micOk", "Microfone funcionando");
      case "nodata":
        return t("call.micSemAudio", "Nenhum áudio detectado");
      case "denied":
        return t("call.micNegado", "Permissão negada");
      case "empty":
        return t("call.micAusente", "Nenhum microfone encontrado");
      case "busy":
        return t("call.micOcupado", "Microfone em uso");
      case "error":
        return t("call.micErro", "Erro no microfone");
      default:
        return t("call.testeNaoIniciado", "○ Teste não iniciado");
    }
  }
  function micMsg() {
    if (test.micState === "denied")
      return t(
        "call.micNegadoMsg",
        "Não foi possível acessar seu microfone: o acesso foi negado pelo navegador. Libere o microfone (ícone na barra de endereço) para ver os aparelhos reais e para as outras pessoas te ouvirem — aqui não há prévia simulada."
      );
    if (test.micState === "empty")
      return t(
        "call.micAusenteMsg",
        "Nenhum microfone foi encontrado. Conecte um (ou libere o do notebook no sistema) e tente de novo."
      );
    if (test.micState === "busy")
      return t(
        "call.micOcupadoMsg",
        "O microfone está em uso. Solte o dispositivo (ou desative o mudo da chamada) e tente de novo."
      );
    if (test.micState === "error")
      return t("call.micErroMsg", "Não foi possível acessar seu microfone.");
    if (test.micState === "nodata")
      return t("call.micSemAudioMsg", "Fale alto: o medidor precisa subir quando você falar.");
    return "";
  }
  function camChip() {
    switch (test.camState) {
      case "ok":
        return t("call.camOk", "Câmera funcionando");
      case "empty":
        return t("call.camVazia", "Nenhuma câmera encontrada.");
      case "denied":
        return t("call.camNegada", "Permissão negada");
      case "error":
        return t("call.camErro", "Erro na câmera");
      default:
        return t("call.testeNaoIniciado", "○ Teste não iniciado");
    }
  }
  function camMsg() {
    if (test.camState === "denied")
      return t(
        "call.camNegadaMsg",
        "Não foi possível acessar sua câmera: o acesso foi negado pelo navegador. Libere a câmera (ícone na barra de endereço) para ver os aparelhos reais e para o preview — aqui não há prévia simulada."
      );
    if (test.camState === "empty") return t("call.camVaziaMsg", "Nenhuma câmera foi encontrada.");
    if (test.camState === "error") return t("call.camErroMsg", "Não foi possível acessar sua câmera.");
    return "";
  }

  /* ---------------- painel Áudio e vídeo ---------------- */
  function devOpt(list, cur, ph) {
    list = list || [];
    return (
      '<option value="">' + hh(ph) + "</option>" +
      list
        .map(function (d, i) {
          return (
            '<option value="' + hh(d.deviceId) + '"' + (cur === d.deviceId ? " selected" : "") + ">" +
            hh(
              d.label ||
                t("call.dispositivo", "Dispositivo") +
                  " " +
                  (i + 1) +
                  " " +
                  t("call.nomeOculto", "(nome oculto pelo navegador)")
            ) +
            "</option>"
          );
        })
        .join("")
    );
  }

  function settingsHTML() {
    const lvl = Math.round((test.level || 0) * 100);
    const vol = Math.round(state.volume * 100);
    const canRetry = test.micState === "denied" || test.micState === "error" || test.micState === "busy";
    const canRetryCam = test.camState === "denied" || test.camState === "error" || test.camState === "empty";
    return (
      '<div class="av">' +
      '<header class="av__head"><strong>' + NX.icon("settings", "", 16) + " " + t("call.audioVideo", "Áudio e vídeo") + "</strong>" +
      '<button type="button" class="av__x" data-call="av-close" aria-label="' + t("call.fechar", "Fechar") + '">' + NX.icon("x", "", 16) + "</button></header>" +
      '<div class="av__body">' +

      '<section class="av__sec">' +
      '<h4 class="av__h">' + NX.icon("mic", "", 15) + " " + t("call.microfone", "Microfone") + "</h4>" +
      '<label class="av__field"><span>' + t("call.dispositivo", "Dispositivo") + "</span>" +
      '<select class="select select--sm" data-call-micdev>' +
      devOpt(test.mics, state.micDevice, t("call.micPadrao", "Microfone padrão")) +
      "</select></label>" +
      '<div class="av__row"><span class="av__lbl">' + t("call.nivelEntrada", "Nível de entrada") + "</span>" +
      '<span class="av__state av__state--' + test.micState + '">' + hh(micChip()) + "</span></div>" +
      '<div class="av-meter"><span class="av-meter__fill" data-test-level style="width:' + lvl + '%"></span>' +
      '<i class="av-meter__knob" data-test-knob style="left:' + lvl + '%"></i></div>' +
      '<button type="button" class="av__btn' + (test.mic ? " is-on" : "") + '" data-call="av-mic">' +
      (test.mic
        ? t("call.pararTeste", "Parar teste")
        : NX.icon("mic", "", 15) + " " + t("call.testarMicrofone", "Testar microfone")) +
      "</button>" +
      (micMsg() ? '<p class="av__msg">' + hh(micMsg()) + "</p>" : "") +
      (canRetry
        ? '<button type="button" class="av__btn av__btn--ghost" data-call="av-mic">' + NX.icon("refresh", "", 15) + " " +
          t("call.tentarNovamente", "Tentar novamente") + "</button>"
        : "") +
      "</section>" +

      '<section class="av__sec">' +
      '<h4 class="av__h">' + NX.icon("camera", "", 15) + " " + t("call.camera", "Câmera") + "</h4>" +
      '<div class="av__preview">' +
      '<video class="av__video" data-test-cam autoplay muted playsinline></video>' +
      '<span class="av__ph" data-test-cam-ph>' + NX.icon("camera", "", 15) + " " +
      t("call.previewAqui", "O preview da câmera aparece aqui") +
      "</span></div>" +
      '<label class="av__field"><span>' + t("call.dispositivo", "Dispositivo") + "</span>" +
      '<select class="select select--sm" data-call-camdev>' +
      devOpt(test.cams, state.camDevice, t("call.camPadrao", "Câmera padrão")) +
      "</select></label>" +
      '<div class="av__row"><span class="av__lbl">' + t("call.status", "Status") + "</span>" +
      '<span class="av__state av__state--' + test.camState + '">' + hh(camChip()) + "</span></div>" +
      '<button type="button" class="av__btn' + (test.cam ? " is-on" : "") + '" data-call="av-cam">' +
      (test.cam
        ? t("call.pararTeste", "Parar teste")
        : NX.icon("camera", "", 15) + " " + t("call.testarCamera", "Testar câmera")) +
      "</button>" +
      (camMsg() ? '<p class="av__msg">' + hh(camMsg()) + "</p>" : "") +
      (canRetryCam
        ? '<button type="button" class="av__btn av__btn--ghost" data-call="av-cam">' + NX.icon("refresh", "", 15) + " " +
          t("call.tentarNovamente", "Tentar novamente") + "</button>"
        : "") +
      "</section>" +

      '<section class="av__sec">' +
      '<h4 class="av__h">' + NX.icon("volume", "", 15) + " " + t("call.audio", "Áudio") + "</h4>" +
      '<label class="av__field av__field--range"><span>' + t("call.volumeDaCall", "Volume da call") + "</span>" +
      '<input type="range" min="0" max="100" value="' + vol + '" data-call-volrange />' +
      "<em data-call-volval>" + vol + "%</em></label>" +
      ((test.outs || []).length
        ? '<label class="av__field"><span>' + t("call.saida", "Saída de áudio") + "</span>" +
          '<select class="select select--sm" data-call-outdev>' +
          devOpt(test.outs, state.outDevice, t("call.padraoSaida", "Padrão")) +
          "</select></label>"
        : '<p class="av__hint">' +
          t("call.semEscolhaSaida", "Este navegador não permite escolher a saída: o áudio sai no dispositivo padrão.") +
          "</p>") +
      '<button type="button" class="av__btn" data-call="av-audio">' + NX.icon("volume", "", 15) + " " +
      t("call.testarAudio", "Testar áudio") +
      "</button>" +
      "</section>" +

      '<section class="av__sec">' +
      '<h4 class="av__h">' + NX.icon("mic", "", 15) + " " + t("call.processamento", "Processamento") + "</h4>" +
      '<div class="av__switches">' +
      sw("eco", t("call.cancelamentoEcho", "Cancelamento de eco"), state.eco) +
      sw("noise", t("call.reducaoRuido", "Supressão de ruído"), state.noise) +
      sw("agc", t("call.ganhoAutomatico", "Ganho automático"), state.agc) +
      "</div></section>" +

      "</div></div>"
    );
  }

  /* permissão já negada pelo navegador? Enquanto isso, o navegador
     esconde os nomes dos dispositivos — avisamos ANTES de a pessoa
     clicar em "Testar", sem inventar prévia nem aparelho nenhum. */
  async function probePermission() {
    if (!navigator.permissions || !navigator.permissions.query) return;
    try {
      const mic = await navigator.permissions.query({ name: "microphone" });
      if (mic.state === "denied" && test.micState === "idle") test.micState = "denied";
    } catch (e) {}
    try {
      const cam = await navigator.permissions.query({ name: "camera" });
      if (cam.state === "denied" && test.camState === "idle") test.camState = "denied";
    } catch (e) {}
  }

  async function openSettingsPanel(pop) {
    if (!pop) return;
    pop.innerHTML =
      '<div class="call-pop__load"><span class="spinner"></span>' +
      t("call.carregandoDispositivos", "Carregando dispositivos…") +
      "</div>";
    await refreshDevices();
    await probePermission();
    if (state.popOpen !== "settings") return; /* painel foi fechado no meio */
    pop.innerHTML = settingsHTML();
    attachCamPreview();
    paintMeter(test.level);
  }

  async function refreshDevices() {
    test.mics = await listDevices("audioinput");
    test.cams = await listDevices("videoinput");
    try {
      test.outs = supportsSink() ? await listDevices("audiooutput") : [];
    } catch (e) {
      test.outs = [];
    }
  }

  function paintTests() {
    if (state.popOpen !== "settings") return;
    const pop = state.root && state.root.querySelector("[data-call-pop]");
    if (!pop) return;
    pop.innerHTML = settingsHTML();
    attachCamPreview();
    paintMeter(test.level);
  }

  /* troca de dispositivo: para o teste anterior, aplica na call
     (quando existe) e reabre o teste no aparelho novo */
  async function onMicDevChange(value) {
    const wasTesting = !!test.mic;
    if (wasTesting) stopMicTest();
    await setMicDevice(value);
    if (wasTesting) await startMicTest();
    else paintTests();
  }

  async function onCamDevChange(value) {
    const wasTesting = !!test.cam;
    if (wasTesting) stopCamTest();
    await setCamDevice(value);
    if (wasTesting) await startCamTest();
    else paintTests();
  }

  /* ---------------- participantes ---------------- */
  function personRow(u, isMe) {
    return (
      '<div class="call-person">' +
      '<span class="call-person__av">' +
      (NX.util && NX.util.avatarHTML ? NX.util.avatarHTML(u, "sm", true) : "") +
      "</span>" +
      '<span class="call-person__txt"><strong>' +
      hh(u.displayName || u.username || "") +
      (isMe ? " · " + t("call.voce", "Você") : "") +
      "</strong><small>@" +
      hh(u.username || "") +
      " · " +
      hh(statusLabel(u.status || "offline")) +
      "</small></span>" +
      '<span class="call-person__mic">' +
      (isMe ? (state.mic ? NX.icon("mic", "", 15) : NX.icon("volumeOff", "", 15)) : "") +
      "</span></div>"
    );
  }

  function peopleHTML() {
    if (state.room) return roomPeopleHTML();
    const me = S() ? S().me() : null;
    const rows = [];
    if (me) rows.push(personRow(me, true));
    if (state.peer) rows.push(personRow(state.peer, false));
    return (
      '<div class="call-people"><h4>' +
      t("call.participantes", "Participantes") +
      " <span>" +
      rows.length +
      "</span></h4>" +
      rows.join("") +
      "</div>"
    );
  }

  function toggleMedia() {
    state.mediaOpen = !state.mediaOpen;
    render();
  }

  function toggleFull() {
    try {
      if (typeof document === "undefined") return;
      if (!document.fullscreenElement) {
        const el = state.root;
        if (el && el.requestFullscreen) el.requestFullscreen();
        else if (el && el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      } else if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (e) {
      toast(t("call.semTelaCheia", "O navegador não permitiu tela cheia."), "warn");
    }
  }

  /* =========================================================
     INDICADOR DE FALA (análise real do áudio remoto)
     ========================================================= */
  function startSpeak(stream) {
    if (!stream || !stream.getAudioTracks().length) {
      stopSpeak();
      return;
    }
    /* mesmo stream: mantém o analisador (não recria a cada track nova) */
    if (speak.analyser && speak.stream === stream) return;
    stopSpeak();
    try {
      const ctx = audioCtx();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.78;
      src.connect(an); /* só análise: não vai para o destino (sem eco) */
      speak.stream = stream;
      speak.ctx = ctx;
      speak.src = src;
      speak.analyser = an;
      speak.buf = null;
      speak.on = false;
      speakLoop();
    } catch (e) {
      console.warn("[nexo/call] indicador de fala:", e && e.message);
    }
  }

  function speakLoop() {
    if (!speak.analyser) return;
    try {
      if (!speak.buf || speak.buf.length !== speak.analyser.fftSize)
        speak.buf = new Uint8Array(speak.analyser.fftSize);
      const level = Math.min(1, rmsOf(speak.analyser, speak.buf) * 3.6);
      if (!speak.on && level > 0.06) {
        speak.on = true;
        paintSpeak(true);
      } else if (speak.on && level < 0.032) {
        speak.on = false;
        paintSpeak(false);
      }
    } catch (e) {}
    speak.raf = requestAnimationFrame(speakLoop);
  }

  function paintSpeak(on) {
    const root = state.root;
    if (!root) return;
    const stage = root.querySelector(".call-stage__remote");
    if (stage) stage.classList.toggle("is-speaking", on);
    const tag = root.querySelector("[data-call-speaking]");
    if (tag) tag.hidden = !on;
  }

  function stopSpeak() {
    if (speak.raf) {
      cancelAnimationFrame(speak.raf);
      speak.raf = 0;
    }
    if (speak.src) {
      try {
        speak.src.disconnect();
      } catch (e) {}
      speak.src = null;
    }
    speak.analyser = null;
    speak.buf = null;
    speak.on = false;
    speak.stream = null;
    if (speak.ctx) {
      try {
        speak.ctx.close();
      } catch (e) {}
      speak.ctx = null;
    }
  }

  /* =========================================================
     PRÉVIA (lobby) — configurar microfone/câmera antes de
     gastar a chamada do outro lado
     ========================================================= */
  function lobbyRow(icon, label, on) {
    return (
      '<div class="lobby__row"><span class="lobby__rowico">' + icon + " " + hh(label) + "</span>" +
      '<span class="lobby__state ' + (on ? "is-on" : "is-off") + '">' +
      (on ? NX.icon("checkCircle", "", 14) + " " + t("call.ligado", "Ligado") : NX.icon("xCircle", "", 14) + " " + t("call.desligado", "Desligado")) +
      "</span></div>"
    );
  }

  function lobbyHTML() {
    const peer = state.peer || {};
    return (
      '<div class="lobby" role="dialog" aria-label="' + t("call.entrarNaChamada", "Entrar na chamada") + '">' +
      '<header class="lobby__head"><strong>' + NX.icon("phone", "", 16) + " " + t("call.entrarNaChamada", "Entrar na chamada") + "</strong>" +
      '<span class="lobby__peer">@' + hh(peer.username || "") + "</span></header>" +
      '<div class="lobby__preview">' +
      '<video class="lobby__video" data-lobby-cam autoplay muted playsinline></video>' +
      '<div class="lobby__ph" data-lobby-ph>' + avatarHTML("xl", false) +
      "<span>" + hh(peerName()) + "</span>" +
      "<em>" + (state.cam ? "" : t("call.cameraDesligada", "Câmera desligada")) + "</em></div>" +
      "</div>" +
      '<div class="lobby__rows">' +
      lobbyRow(NX.icon("mic", "", 15), t("call.microfone", "Microfone"), state.mic) +
      lobbyRow(NX.icon("camera", "", 15), t("call.camera", "Câmera"), state.cam) +
      "</div>" +
      '<div class="lobby__toggles">' +
      '<button type="button" class="lobby__tg' + (state.mic ? " is-on" : "") +
      '" data-call="lob-mic" aria-pressed="' + (state.mic ? "true" : "false") + '">' +
      '<span>' + (state.mic ? NX.icon("mic", "", 17) : NX.icon("volumeOff", "", 17)) + "</span><small>" +
      (state.mic ? t("call.micro", "Micro") : t("call.mudo", "Mudo")) + "</small></button>" +
      '<button type="button" class="lobby__tg' + (state.cam ? " is-on" : "") +
      '" data-call="lob-cam" aria-pressed="' + (state.cam ? "true" : "false") + '">' +
      '<span>' + (state.cam ? NX.icon("camera", "", 17) : NX.icon("videoOff", "", 17)) + "</span><small>" +
      (state.cam ? t("call.camera", "Câmera") : t("call.camOff", "Câmera off")) + "</small></button>" +
      "</div>" +
      (state.mediaWarned ? permCardHTML(true) : "") +
      '<div class="lobby__acts">' +
      '<button type="button" class="lobby__cancel" data-call="lob-cancel">' +
      t("call.cancelar", "Cancelar") + "</button>" +
      '<button type="button" class="lobby__enter" data-call="lob-enter">' +
      NX.icon("phone", "", 18) + "<span>" + t("call.entrarCall", "Entrar na call") + "</span></button>" +
      "</div></div>"
    );
  }

  function attachLobbyPreview() {
    const root = state.root;
    if (!root || state.phase !== "lobby") return;
    const v = root.querySelector("[data-lobby-cam]");
    if (!v) return;
    if (state.cam && state.localStream && state.localStream.getVideoTracks().length) {
      v.srcObject = state.localStream;
      const p = v.play();
      if (p && p.catch) p.catch(function () {});
      v.style.display = "block";
    } else {
      try {
        v.srcObject = null;
      } catch (e) {}
      v.style.display = "none";
    }
    const ph = root.querySelector("[data-lobby-ph]");
    if (ph) ph.hidden = state.cam && !!(state.localStream && state.localStream.getVideoTracks().length);
  }

  async function preview(peerId, opts) {
    opts = opts || {};
    if (state.call || state.phase !== "none")
      throw new Error(t("call.jaEmChamada", "Você já está em uma chamada."));
    const me = S() ? S().me() : null;
    const peer = S() ? S().user(peerId) : null;
    if (!me) throw new Error(t("api.suaSessaoExpirouEntre8", "Sua sessão expirou. Entre novamente."));
    if (!peer) throw new Error(t("call.pessoaNaoEncontrada", "Não encontramos esta pessoa."));
    if (peerId === me.id) throw new Error(t("call.naoLigarParaSi", "Você não pode ligar para si mesmo."));

    state.peer = peer;
    state.pendingCall = { peerId: peerId, video: !!opts.video };
    state.cam = false;
    state.mic = false; /* só vira "ligado" quando houver captura real */
    clearMediaIssues();
    state.startedAt = Date.now();
    state.phase = "lobby";
    render();
    try {
      await acquireMedia(!!opts.video);
    } catch (e) {
      /* o motivo real já virou aviso contextual (setMediaIssue):
         toast só quando nenhuma superfície está na tela — o mesmo
         problema nunca é anunciado em dois lugares */
      if (e && e.message && (!state.mediaIssues.length || !mediaUIVisible())) toast(e.message, "warn");
    }
    if (state.phase === "lobby") {
      render();
      attachLobbyPreview();
    }
    return true;
  }

  async function toggleLobbyMic() {
    if (!state.localStream) {
      try {
        await acquireMedia(state.cam);
        render();
        attachLobbyPreview();
      } catch (e) {
        /* o motivo real já está no aviso único do lobby */
        reopenPermCard();
        render();
      }
      return;
    }
    const tr = state.localStream.getAudioTracks()[0];
    if (!tr) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() });
        const fresh = s.getAudioTracks()[0];
        fresh.enabled = true;
        state.localStream.addTrack(fresh);
        state.mic = true;
        clearMediaIssue("microphone"); /* captura confirmada por track */
      } catch (e) {
        setMediaIssue("microphone", e, t("call.micNegadoMsg", "Não foi possível acessar seu microfone."));
        reopenPermCard();
        if (!mediaUIVisible()) toast(issueMessage("microphone"), "error");
      }
    } else {
      tr.enabled = !tr.enabled;
      state.mic = tr.enabled;
    }
    render();
    attachLobbyPreview();
  }

  async function toggleLobbyCam() {
    const on = !state.cam;
    if (on) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setMediaIssue("camera", { name: "NotSupportedError" }, null);
        reopenPermCard();
        render();
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints() });
        const track = s.getVideoTracks()[0];
        if (!state.localStream) state.localStream = new MediaStream();
        state.localStream.getVideoTracks().forEach(function (old) {
          old.stop();
          state.localStream.removeTrack(old);
        });
        state.localStream.addTrack(track);
        watchLocalTrack(track, "video");
        state.cam = true;
        clearMediaIssue("camera"); /* captura confirmada por track */
      } catch (e) {
        state.cam = false;
        setMediaIssue("camera", e, t("call.camErroMsg", "Não foi possível acessar sua câmera."));
        reopenPermCard();
        if (!mediaUIVisible()) toast(issueMessage("camera"), "error");
      }
    } else {
      const tr = state.localStream && state.localStream.getVideoTracks()[0];
      if (tr) {
        tr.stop();
        state.localStream.removeTrack(tr);
      }
      state.cam = false;
    }
    render();
    attachLobbyPreview();
  }

  function stopLobbyMedia() {
    if (state.localStream) {
      state.localStream.getTracks().forEach(function (tr) {
        try {
          tr.stop();
        } catch (e) {}
      });
      state.localStream = null;
    }
  }

  function cancelLobby() {
    stopLobbyMedia();
    stopTests();
    state.phase = "none";
    state.pendingCall = null;
    state.peer = null;
    state.cam = false;
    state.mic = false;
    clearMediaIssues();
    render();
  }

  function enterCall() {
    const p = state.pendingCall;
    if (!p) return Promise.resolve(false);
    const hasMedia = !!(state.localStream && state.localStream.getTracks().length);
    return Promise.resolve(start(p.peerId, { video: state.cam, hasMedia: hasMedia })).catch(function (e) {
      toast((e && e.message) || t("call.naoFoiPossivelIniciar", "Não foi possível iniciar a chamada."), "error");
      return false;
    });
  }

  function bind(root) {
    /* o root é reutilizado entre renders: o listener é registrado
       uma única vez (senão um clique dispararia N ações) */
    if (root.dataset.callBound === "1") return;
    root.dataset.callBound = "1";
    root.addEventListener("click", function (e) {
      const tgt = e.target;
      const inPop = tgt && tgt.closest ? tgt.closest("[data-call-pop]") : null;
      const trigger =
        tgt && tgt.closest
          ? tgt.closest('[data-call="settings"],[data-call="volume"],[data-call="people"],[data-call="tx"],[data-call="av-close"]')
          : null;
      if (state.popOpen && !inPop && !trigger) closePopover();

      /* menu ⋯ do participante (cartão e linha) */
      const rmenu = tgt && tgt.closest ? tgt.closest("[data-room-menu]") : null;
      if (rmenu) {
        e.preventDefault();
        e.stopPropagation();
        openParticipantMenu(rmenu, rmenu.getAttribute("data-room-menu"));
        return;
      }

      const btn = tgt && tgt.closest ? tgt.closest("[data-call]") : null;
      if (!btn) return;
      const act = btn.getAttribute("data-call");
      if (act === "accept") accept();
      else if (act === "decline") decline();
      else if (act === "hangup") {
        /* na sala de voz "encerrar" é sair da sala — nunca uma call 1:1 */
        if (state.room) leaveRoom("hangup");
        else end("hangup");
      }
      else if (act === "mic") toggleMic();
      else if (act === "cam") toggleCam();
      else if (act === "screen") toggleScreen();
      else if (act === "screen-audio-off") stopScreenAudio();
      else if (act === "volume" || act === "settings" || act === "people" || act === "tx") openPopover(act);
      else if (act === "av-close") closePopover();
      else if (act === "av-mic") {
        if (test.mic) {
          stopMicTest();
          test.micState = "idle";
          paintTests();
        } else startMicTest();
      } else if (act === "av-cam") {
        if (test.cam) {
          stopCamTest();
          test.camState = "idle";
          paintTests();
        } else startCamTest();
      } else if (act === "av-audio") testAudio();
      else if (act === "lob-mic") toggleLobbyMic();
      else if (act === "lob-cam") toggleLobbyCam();
      else if (act === "lob-cancel") cancelLobby();
      else if (act === "lob-enter") enterCall();
      else if (act === "media") toggleMedia();
      else if (act === "perm-dismiss") {
        /* fechar é VISUAL: a permissão continua como está (o dock segue
           sinalizando, sem fingir que foi concedida) */
        state.mediaDismissed = true;
        render();
      } else if (act === "perm-help") {
        state.permHelpOpen = !state.permHelpOpen;
        render();
      } else if (act === "perm-retry") retryMedia();
      else if (act === "room-focus") toggleRoomFocus();
      else if (act === "room-menu") openRoomMenu(btn);
      else if (act === "full") toggleFull();
      else if (act === "min") {
        if (state.room) {
          state.room.minimized = true;
          /* a página do canal (atrás da camada) precisa refletir isso */
          bus("call:roomstate", { channelId: state.room.channelId, minimized: true });
        } else state.minimized = true;
        render();
      } else if (act === "restore") {
        if (state.room) state.room.minimized = false;
        else state.minimized = false;
        render();
      }
    });

    root.addEventListener("change", function (e) {
      const el = e.target;
      if (!el || !el.getAttribute) return;
      if (el.getAttribute("data-call-micdev") !== null && el.tagName === "SELECT") {
        onMicDevChange(el.value);
        return;
      }
      if (el.getAttribute("data-call-camdev") !== null && el.tagName === "SELECT") {
        onCamDevChange(el.value);
        return;
      }
      if (el.getAttribute("data-call-outdev") !== null && el.tagName === "SELECT") {
        setOutDevice(el.value);
        return;
      }
      const k = el.getAttribute("data-call-switch");
      if (k) {
        state[k] = !!el.checked;
        applyProcessing();
      }
    });

    root.addEventListener("input", function (e) {
      const el = e.target;
      if (!el || !el.matches) return;
      if (el.matches("[data-call-volrange]")) {
        setVolume(Number(el.value) / 100);
        const lab = root.querySelector("[data-call-volval]");
        if (lab) lab.textContent = el.value + "%";
      }
    });

    /* botão direito no cartão de um participante abre o mesmo menu
       do ⋯ — atalho de teclado/mouse já conhecido pelas pessoas */
    root.addEventListener("contextmenu", function (e) {
      if (!state.room) return;
      const card = e.target && e.target.closest ? e.target.closest("[data-room-card]") : null;
      if (!card) return;
      const id = card.getAttribute("data-room-card");
      const menu = card.querySelector('[data-room-menu="' + id + '"]');
      if (!menu) return;
      e.preventDefault();
      e.stopPropagation();
      openParticipantMenu(menu, id);
    });
  }

  /* ESC fecha só o popover da call — nunca encerra a chamada
     (registrado uma única vez: sem listener duplicado por render) */
  try {
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !state.root || state.phase === "none") return;
      if (state.popOpen) {
        closePopover();
        return;
      }
      const pop = state.root.querySelector("[data-call-pop]");
      if (pop && !pop.hidden) {
        pop.hidden = true;
        pop.dataset.open = "";
      }
    });
  } catch (e) {
    /* sem DOM: nada a fechar */
  }

  /* ---------------- ciclo de vida do polling ---------------- */
  function onStoreChange() {
    const me = S() && S().me ? S().me() : null;
    if (!me) {
      stopPolling();
      if (state.room) leaveRoom("logout");
      if (state.call) teardown("logout");
      return;
    }
    if (state.room) {
      /* rota/dados mudaram: a camada acompanha o canal e a sala
         cria ou derruba conexões conforme a presença */
      syncRoomVisibility();
      roomSync();
      /* presença nova/mudou: a grade precisa mostrar quem chegou
         (renderRoom só repinta o HTML se a "chave da tela" mudou) */
      renderRoom();
    }
    if (!state.pollTimer && (!document.hidden || state.call || state.room))
      schedulePoll(state.call || state.room ? POLL_INCALL : POLL_VISIBLE);
  }

  function onVisibility() {
    if (document.hidden && !state.call && !state.room) stopPolling();
    else if (S() && S().me()) schedulePoll(state.call || state.room ? POLL_INCALL : POLL_VISIBLE);
  }

  try {
    if (NX.store && NX.store.subscribe) NX.store.subscribe(onStoreChange);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    /* navegar pelo Nexo não passa pelo store: a sala acompanha a rota */
    if (typeof window !== "undefined")
      window.addEventListener("hashchange", function () {
        if (state.room) syncRoomVisibility();
      });
  } catch (e) {
    /* módulo continua utilizável pelas ações */
  }

  /* =========================================================
     SALAS DE VOZ DO SERVIDOR (malha WebRTC)
     ---------------------------------------------------------
     Uma sala NÃO é uma chamada: quem entra escreve a sua presença
     na tabela `voice` do servidor e cada par combina a própria
     RTCPeerConnection. Reaproveita a MESMA mídia (state.localStream
     e state.screenStream), os MESMOS toggles e o MESMO caminho de
     sinalização do 1:1 (prefs.signal, lido no /calls/peek) — não
     existe um segundo sistema de chamadas aqui.
     ========================================================= */

  /* ordem fixa das linhas de mídia: os DOIS lados criam as mesmas 4
     transceivers na mesma ordem, então o SDP casa e trocar de
     microfone/câmera/tela vira só replaceTrack (sem renegociar) */
  const ROOM_ROLES = { mic: "micSender", tab: "tabSender", cam: "camSender", screen: "screenSender" };

  function roomRoot() {
    let root = document.getElementById("voice-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "voice-root";
      root.className = "call-layer call-layer--voice";
      root.hidden = true;
      document.body.appendChild(root);
    }
    return root;
  }

  function voiceAudioBox() {
    let box = document.getElementById("voice-audio");
    if (!box) {
      box = document.createElement("div");
      box.id = "voice-audio";
      box.className = "voice-audio";
      document.body.appendChild(box);
    }
    return box;
  }

  /* o <audio> de cada pessoa fica FORA da camada: repintar a sala
     nunca pode reiniciar o som que já está tocando */
  function roomAudioEl(id) {
    const box = voiceAudioBox();
    let a = box.querySelector('[data-room-audio="' + id + '"]');
    if (!a) {
      a = document.createElement("audio");
      a.autoplay = true;
      a.playsInline = true;
      a.setAttribute("data-room-audio", id);
      a.volume = state.volume;
      box.appendChild(a);
    }
    return a;
  }

  function roomMember(id) {
    return (state.room && state.room.members[id]) || null;
  }

  /* a sala só aparece no canal dela (fora disso fica o dock) */
  function roomVisible() {
    const r = state.room;
    if (!r) return false;
    if (r.minimized) return false;
    try {
      const route = NX.app && NX.app.route;
      if (!route || route.name !== "server") return false;
      return route.channelId === r.channelId;
    } catch (e) {
      return true;
    }
  }

  /* assentos reais: quem tem linha na sala agora (ordenados por
     quem entrou primeiro) */
  function roomSeats() {
    const r = state.room;
    if (!r) return [];
    const me = S() ? S().me() : null;
    const rows = (((NX.store || {}).db || {}).voice || []).filter(function (v) {
      return v && v.channelId === r.channelId;
    });
    rows.sort(function (a, b) {
      return Number(a.joinedAt || 0) - Number(b.joinedAt || 0);
    });
    const ids = [];
    rows.forEach(function (v) {
      if (ids.indexOf(v.userId) === -1) ids.push(v.userId);
    });
    if (me && ids.indexOf(me.id) === -1) ids.unshift(me.id);
    return ids;
  }

  /* quem está compartilhando agora (eu ou alguém da sala) */
  function roomSharer() {
    const r = state.room;
    if (!r) return null;
    const me = S() ? S().me() : null;
    if (state.screen && screenVideoTrack()) return { id: me ? me.id : "", mine: true };
    const ids = Object.keys(r.members);
    for (let i = 0; i < ids.length; i++) {
      const m = r.members[ids[i]];
      if (m.media.screen && m.screenStream && m.screenStream.getVideoTracks().length)
        return { id: ids[i], mine: false };
    }
    return null;
  }

  function roomSharingId() {
    const s = roomSharer();
    return s ? s.id : null;
  }

  function roomConnLabel(m) {
    if (!m) return t("call.conectado", "Conectado");
    switch (m.conn) {
      case "checking":
      case "connecting":
        return t("call.conectando", "Conectando…");
      case "connected":
        return t("call.conectado", "Conectado");
      case "failed":
        return t("call.falhou", "Falha na conexão");
      case "disconnected":
        return t("call.desconectado", "Desconectado");
      case "closed":
        return t("call.encerrado", "Encerrado");
      default:
        return t("call.aguardando", "Aguardando…");
    }
  }

  function roomHeaderConn() {
    const r = state.room;
    if (!r) return "";
    const ids = Object.keys(r.members);
    if (!ids.length) return t("call.salaSozinho", "Você é o único aqui");
    let ok = 0;
    let bad = 0;
    ids.forEach(function (id) {
      const c = r.members[id].conn;
      if (c === "connected") ok++;
      else if (c === "failed" || c === "closed" || c === "disconnected") bad++;
    });
    if (bad) return t("call.falhou", "Falha na conexão") + " (" + bad + ")";
    if (ok === ids.length) return t("call.conectado", "Conectado");
    return t("call.conectando", "Conectando…") + " (" + ok + "/" + ids.length + ")";
  }

  function roomWant() {
    return {
      mic: micTrack(),
      tab: screenAudioTrack(),
      cam: state.cam ? cameraTrack() : null,
      screen: state.screen ? screenVideoTrack() : null,
    };
  }

  /* troca a track de UM papel em TODAS as conexões da sala */
  function roomPush(role, track) {
    const r = state.room;
    if (!r) return false;
    const key = ROOM_ROLES[role];
    if (!key) return false;
    let ok = false;
    Object.keys(r.members).forEach(function (id) {
      const m = r.members[id];
      const sender = m[key];
      if (!sender || !sender.replaceTrack) return;
      if (sender.track === track || (!sender.track && !track)) {
        ok = true;
        return;
      }
      ok = true;
      Promise.resolve(sender.replaceTrack(track || null)).catch(function (e) {
        console.warn("[nexo/call] sala replaceTrack (" + role + "):", e && e.message);
      });
    });
    return ok;
  }

  /* porta usada pelos toggles do 1:1: o papel sai do tipo da track */
  function roomSend(kind, track, stream) {
    const role = kind === "audio" ? "mic" : (track && track._nxSource === "screen" ? "screen" : "cam");
    return roomPush(role, track);
  }

  function roomApplyMedia() {
    if (!state.room) return;
    const want = roomWant();
    roomPush("mic", want.mic);
    roomPush("tab", want.tab);
    roomPush("cam", want.cam);
    roomPush("screen", want.screen);
    roomStartLocalMeter();
    roomSendMedia();
  }

  /* estado dos meus dispositivos, anunciado de forma honesta para a
     sala (a pista de vídeo sozinha não diz se a câmera está ligada) */
  function roomMediaSig() {
    return JSON.stringify({
      mic: !!state.mic,
      cam: !!cameraTrack(),
      screen: !!state.screen,
      screenAudio: !!state.screenAudio,
    });
  }

  function roomSendMedia() {
    const r = state.room;
    if (!r) return;
    const sig = roomMediaSig();
    if (sig === r.mediaSig) return;
    r.mediaSig = sig;
    Object.keys(r.members).forEach(function (id) {
      roomSignal(id, "media", sig).catch(function () {});
    });
    /* o dock e a página do canal mostram o MESMO estado: avisa */
    bus("call:roommedia", { channelId: r.channelId, sig: sig });
    paintRoomState();
  }

  function roomPushMediaTo(id) {
    roomSignal(id, "media", roomMediaSig()).catch(function () {});
  }

  function roomSignal(to, kind, payload) {
    const r = state.room;
    if (!r || r.leaving) return Promise.resolve(true);
    if (!NX.api || typeof NX.api.sendRoomSignal !== "function") return Promise.resolve(true);
    return Promise.resolve(NX.api.sendRoomSignal(r.channelId, to, kind, payload)).then(
      function () {
        return true;
      },
      function (e) {
        const status = e && e.status;
        if (status !== 403) {
          /* rede/500: avisa uma vez no console, sem jogar erro na tela */
          console.warn("[nexo/call] sinal da sala (" + kind + "):", (e && e.message) || status || "falhou");
          return false;
        }
        /* 403 = a presença mudou depois do último peek (alguém saiu,
           trocou de canal ou fui eu). O servidor está certo: não se
           sinaliza para fora da sala. Re-sincroniza e derruba quem o
           servidor não vê mais — se ainda estiver lá, o próximo peek
           recria a conexão sozinho. */
        if (!state.room || state.room !== r || r.leaving) return false;
        const msg = String((e && e.message) || "");
        if (msg.indexOf("Esta pessoa não está") === 0) roomDropMember(r, to, "left");
        refreshVoice();
        if (typeof console !== "undefined" && console.debug)
          console.debug("[nexo/call] 403 de presença em '" + kind + "': " + (msg || "sala mudou"));
        return false;
      }
    );
  }

  /* presença fresca sob demanda: o espelho local atrasa até ~2s e é
     ele que decide com quem abrimos conexão (máx. 1x a cada 700ms) */
  let voiceRefreshAt = 0;
  function refreshVoice() {
    const r = state.room;
    if (!r) return;
    const at = Date.now();
    if (at - voiceRefreshAt < 700) return;
    voiceRefreshAt = at;
    if (!NX.api || typeof NX.api.peekCalls !== "function") return;
    Promise.resolve(NX.api.peekCalls())
      .then(function (data) {
        /* o peek é destrutivo: os sinais que vieram junto precisam ser
           despachados aqui, senão a oferta do colega se perde */
        consumePeekSignals(data);
        if (!state.room || state.room !== r) return;
        roomSync();
      })
      .catch(function () {});
  }

  /* ---------------- áudio: análise real por pessoa ---------------- */
  function roomAudioCtx() {
    const r = state.room;
    if (!r) return null;
    if (r.ctx) return r.ctx;
    try {
      r.ctx = audioCtx();
    } catch (e) {
      r.ctx = null;
    }
    return r.ctx;
  }

  function roomCreateMeter(m) {
    if (!m || m.analyser) return;
    const ctx = roomAudioCtx();
    if (!ctx || !m.play || !m.play.getAudioTracks().length) return;
    try {
      const src = ctx.createMediaStreamSource(m.play);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.78;
      src.connect(an); /* análise só: nunca vai para o destino (sem eco) */
      m.anSrc = src;
      m.analyser = an;
    } catch (e) {
      console.warn("[nexo/call] indicador de fala da sala:", e && e.message);
    }
  }

  function roomStartLocalMeter() {
    const r = state.room;
    if (!r || r.selfAnalyser) return;
    const s = state.localStream;
    if (!s || !s.getAudioTracks().length) return;
    const ctx = roomAudioCtx();
    if (!ctx) return;
    try {
      const src = ctx.createMediaStreamSource(s);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.78;
      src.connect(an);
      r.selfSrc = src;
      r.selfAnalyser = an;
    } catch (e) {
      /* sem Web Audio: a sala funciona sem o anel de fala */
    }
  }

  function roomLevel(analyser, holder) {
    if (!analyser) return 0;
    try {
      if (!holder.buf || holder.buf.length !== analyser.fftSize)
        holder.buf = new Uint8Array(analyser.fftSize);
      return Math.min(1, rmsOf(analyser, holder.buf) * 3.6);
    } catch (e) {
      return 0;
    }
  }

  /* ---------------- conexão por pessoa ---------------- */
  async function roomCreateMember(id) {
    const r = state.room;
    if (!r || r.members[id]) return;
    const me = S() ? S().me() : null;
    if (!me || id === me.id) return;
    if (typeof RTCPeerConnection !== "function") {
      console.warn("[nexo/call] navegador sem RTCPeerConnection.");
      return;
    }

    const pc = new RTCPeerConnection(ICE);
    /* elegemos UM ofertante por par (mesma conta dos dois lados, sempre
       o mesmo): se os dois oferecessem ao mesmo tempo, o lado que cede
       no rollback fica com a trilha do micro num transceiver FORA da
       sessão — ele aparece "conectado" mas o áudio nunca sai */
    const ofertante = String(me.id) > String(id);
    const m = {
      id: id,
      pc: pc,
      media: { mic: true, cam: false, screen: false, screenAudio: false },
      conn: "new",
      speaking: false,
      makingOffer: false,
      ignoreOffer: false,
      remoteDescSet: false,
      ofertante: ofertante,
      pendingCandidates: [],
      chain: Promise.resolve(),
      play: new MediaStream(),
      camStream: new MediaStream(),
      screenStream: new MediaStream(),
      analyser: null,
      anSrc: null,
      buf: null,
      restarts: 0,
      audio: roomAudioEl(id),
    };
    r.members[id] = m;

    /* quem só responde NÃO cria transceivers agora: os nossos + os que
       nascem da oferta do colega DUPLICAM cada m-line e o navegador
       entra em loop de renegociação (renegocia, renegocia, e nunca
       conecta de verdade). Os transceivers nascem da oferta e as
       trilhas são penduradas neles em roomBindSenders, antes da
       resposta — que já nasce sendrecv, sem renegociar. */
    if (ofertante) roomEnsureSenders(m);

    pc.onicecandidate = function (ev) {
      if (ev && ev.candidate && state.room)
        roomSignal(id, "candidate", JSON.stringify(ev.candidate)).catch(function () {});
    };
    pc.ontrack = function (ev) {
      roomOnTrack(m, ev);
    };
    pc.onconnectionstatechange = function () {
      m.conn = pc.connectionState || "new";
      paintRoomState();
      if (m.conn === "connected") {
        /* subiu: o vigia pode ficar quieto (e volta a valer se cair) */
        clearTimeout(m.connWatchTimer);
        m.connWatchStart = 0;
        m.connIceRestarted = false;
      } else if (m.conn === "failed") roomRestart(m);
    };
    pc.onnegotiationneeded = function () {
      /* quem só responde não dispara a própria oferta antes de ter uma
         remota (senão o empate volta e o rollback perde o micro) */
      if (!m.ofertante && !m.remoteDescSet) return;
      roomNegotiate(m);
    };

    roomPushTracks(m, roomWant());
    roomCreateMeter(m);
    roomPushMediaTo(id);
    if (m.ofertante) roomNegotiate(m);
    else roomOfferWait(m); /* rede de segurança: sem oferta em 10s, oferece */
    paintRoomState();
  }

  /* só o ofertante faz a primeira oferta; se ela nunca chegar (colega
     caiu, sinal perdido), quem espera acaba oferecendo sozinho — a
     janela grande evita colidir com os reenvios do ofertante */
  function roomOfferWait(m) {
    if (!m) return;
    clearTimeout(m.offerTimer);
    m.offerTimer = setTimeout(function () {
      if (!m || !state.room || !m.pc || m.remoteDescSet) return;
      if (m.pc.signalingState !== "stable") return;
      /* viramos ofertantes: os transceivers precisam existir antes */
      roomEnsureSenders(m);
      roomPushTracks(m, roomWant());
      roomNegotiate(m);
    }, OFFER_FALLBACK_MS);
  }

  function roomEnsureSenders(m) {
    if (!m || !m.pc || m.micSender) return;
    try {
      m.micSender = m.pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
      m.tabSender = m.pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
      m.camSender = m.pc.addTransceiver("video", { direction: "sendrecv" }).sender;
      m.screenSender = m.pc.addTransceiver("video", { direction: "sendrecv" }).sender;
    } catch (e) {
      console.warn("[nexo/call] transceivers da sala:", e && e.message);
    }
  }

  /* o lado que só responde recebe os transceivers JUNTO com a oferta:
     aqui alinhamos os papéis na ORDEM das m-lines do colega (mic, tab,
     câm, tela — a mesma ordem do código dos dois lados) e penduramos
     as trilhas ANTES de responder, para a resposta já nascer sendrecv.
     Também RE pendura quando os nossos ficaram fora da sessão (rollback
     de um empate): nesse caso o par conecta e o áudio não sai. */
  function roomBindSenders(m) {
    const pc = m && m.pc;
    if (!pc) return;
    let trs = [];
    try {
      trs = pc.getTransceivers().slice();
    } catch (e) {
      return;
    }
    /* só as m-lines que pertencem à sessão remota atual */
    const ativas = trs.filter(function (t) {
      return t.mid !== null && t.mid !== undefined;
    });
    if (ativas.length < 4) return;
    if (m.micSender) {
      /* os nossos ainda estão dentro da sessão? então nada a refazer */
      const dentro = ativas.some(function (t) {
        return t.sender === m.micSender;
      });
      if (dentro) return;
    }
    ativas.sort(function (a, b) {
      const ia = parseInt(a.mid, 10);
      const ib = parseInt(b.mid, 10);
      return (isNaN(ia) ? 1e9 : ia) - (isNaN(ib) ? 1e9 : ib);
    });
    const want = roomWant();
    const papeis = [
      [ativas[0], want.mic],
      [ativas[1], want.tab],
      [ativas[2], want.cam],
      [ativas[3], want.screen],
    ];
    m.micSender = ativas[0].sender;
    m.tabSender = ativas[1].sender;
    m.camSender = ativas[2].sender;
    m.screenSender = ativas[3].sender;
    papeis.forEach(function (p) {
      const tr = p[0];
      const track = p[1];
      try {
        tr.direction = "sendrecv"; /* resposta nasce nos dois sentidos */
      } catch (e) {}
      const sender = tr.sender;
      if (sender && sender.replaceTrack && sender.track !== track && (sender.track || track))
        Promise.resolve(sender.replaceTrack(track || null)).catch(function () {});
    });
  }

  function roomPushTracks(m, want) {
    if (!m) return;
    roomPushTo(m, "mic", want.mic);
    roomPushTo(m, "tab", want.tab);
    roomPushTo(m, "cam", want.cam);
    roomPushTo(m, "screen", want.screen);
  }

  function roomPushTo(m, role, track) {
    const key = ROOM_ROLES[role];
    const sender = key && m[key];
    if (!sender || !sender.replaceTrack) return;
    if (sender.track === track || (!sender.track && !track)) return;
    Promise.resolve(sender.replaceTrack(track || null)).catch(function (e) {
      console.warn("[nexo/call] sala replaceTrack (" + role + "):", e && e.message);
    });
  }

  async function roomNegotiate(m) {
    if (!m || !m.pc || !state.room || m.makingOffer) return;
    const pc = m.pc;
    if (pc.signalingState !== "stable") return;
    try {
      m.makingOffer = true;
      const offer = await pc.createOffer();
      if (pc.signalingState !== "stable") return;
      await pc.setLocalDescription(offer);
      m.offerRetries = 0;
      await roomSignal(m.id, "offer", JSON.stringify(pc.localDescription));
      roomOfferArm(m);
    } catch (e) {
      console.warn("[nexo/call] negociação da sala:", e && e.message);
    } finally {
      m.makingOffer = false;
    }
  }

  /* a oferta sai em UMA requisição e não tem confirmação: se esse sinal
     se perder no caminho (rede instável, fila reiniciada), o colega
     nunca responde e a sala fica "Conectando…" para sempre. Enquanto a
     réplica não chegar, reenvia a MESMA oferta (idempotente) algumas
     vezes — sem abrir negociação nova. */
  function roomOfferArm(m) {
    if (!m) return;
    clearTimeout(m.offerTimer);
    m.offerTimer = setTimeout(function () {
      roomOfferRetry(m);
    }, OFFER_RETRY_MS);
  }

  function roomOfferRetry(m) {
    const pc = m && m.pc;
    if (!state.room || !pc) return;
    if (m.remoteDescSet) return; /* a réplica chegou */
    if (pc.signalingState !== "have-local-offer" || !pc.localDescription) return;
    if ((m.offerRetries || 0) >= OFFER_RETRY_MAX) {
      /* esgotou sem resposta: refaz o par do zero. A oferta nova tem a
         MESMA ordem de m-lines, então ela entra onde a antiga (que o
         colega pode ter perdido no boot) não entra mais. */
      roomRestart(m);
      return;
    }
    m.offerRetries = (m.offerRetries || 0) + 1;
    roomSignal(m.id, "offer", JSON.stringify(pc.localDescription)).catch(function () {});
    roomOfferArm(m);
  }

  /* se o rollback de um empate deixou NOSSAS trilhas fora da sessão, o
     par mostra "Conectado" mas nada de áudio sai. Detecta e refaz. */
  function roomSanity(m) {
    setTimeout(function () {
      try {
        const pc = m && m.pc;
        if (!pc || !state.room || !pc.remoteDescription) return;
        const comTrack = pc.getTransceivers().filter(function (t) {
          return t.sender && t.sender.track;
        });
        if (!comTrack.length) return;
        const orfaos = comTrack.filter(function (t) {
          return t.currentDirection === null;
        });
        if (orfaos.length !== comTrack.length) return;
        if (typeof console !== "undefined" && console.debug)
          console.debug("[nexo/call] trilhas locais fora da sessão (rollback do empate): refazendo a conexão");
        roomRestart(m);
      } catch (e) {}
    }, 400);
  }

  /* o ICE pode ficar "checking" para sempre (rede estranha, STUN
     bloqueado, rota assimétrica entre máquinas) — sem este vigia a
     chamada fica em "Conectando…" para sempre com os dois lados
     "estáveis" no sinal. Primeiro pede um ICE novo (barato; só o
     ofertante consegue levá-lo ao colega numa oferta/replica); se
     ainda assim não subir, refaz o par inteiro. */
  function roomConnWatch(m) {
    clearTimeout(m.connWatchTimer);
    const pc = m && m.pc;
    const r = state.room;
    if (!pc || !r) return;
    if (pc.connectionState === "connected") return;
    /* outro vigia já assumiu (par refazido) */
    if (r.members[m.id] !== m) return;
    /* sem réplica quem cuida é a lógica de oferta/reenvio */
    if (!pc.remoteDescription) return;
    if (!m.connWatchStart) m.connWatchStart = Date.now();
    const decorrido = Date.now() - m.connWatchStart;
    const esperar = m.connIceRestarted ? CONN_WATCH_GRACE_MS : CONN_WATCH_MS;
    if (decorrido < esperar) {
      m.connWatchTimer = setTimeout(function () {
        roomConnWatch(m);
      }, esperar - decorrido + 500);
      return;
    }
    if (!m.connIceRestarted && m.ofertante && typeof pc.restartIce === "function") {
      m.connIceRestarted = true;
      m.connWatchStart = Date.now();
      if (typeof console !== "undefined" && console.debug)
        console.debug("[nexo/call] conexão da sala sem 'connected': pedindo ICE novo");
      try {
        pc.restartIce();
        roomNegotiate(m);
      } catch (e) {}
      m.connWatchTimer = setTimeout(function () {
        roomConnWatch(m);
      }, CONN_WATCH_GRACE_MS + 500);
      return;
    }
    if (typeof console !== "undefined" && console.debug)
      console.debug("[nexo/call] conexão da sala não sobe: refazendo o par");
    roomRestart(m);
  }

  async function roomFlush(m) {
    if (!m || !m.pc || !m.remoteDescSet) return;
    const list = m.pendingCandidates.splice(0);
    for (const c of list) {
      try {
        await m.pc.addIceCandidate(c);
      } catch (e) {
        /* candidato de uma sessão antiga: ignora */
      }
    }
  }

  function roomOnTrack(m, ev) {
    const tr = ev && ev.track;
    if (!tr || !m) return;
    const audio = tr.kind === "audio";
    let idx = -1;
    try {
      idx = m.pc.getTransceivers ? m.pc.getTransceivers().indexOf(ev.transceiver) : -1;
    } catch (e) {
      idx = -1;
    }
    /* posição da linha entre as do MESMO tipo (0 = micro/câmera,
       1 = áudio da aba/tela compartilhada) */
    let pos = -1;
    if (idx >= 0) pos = audio ? (idx === 1 ? 1 : 0) : idx === 3 ? 1 : 0;
    if (pos < 0) {
      const key = audio ? "audioSeq" : "videoSeq";
      pos = Math.min(m[key] || 0, 1);
      m[key] = pos + 1;
    }

    const target = audio ? m.play : pos === 1 ? m.screenStream : m.camStream;
    const seen = target.getTracks().some(function (x) {
      return x.id === tr.id;
    });
    if (!seen) target.addTrack(tr);

    if (audio) {
      const a = m.audio;
      if (a && a.srcObject !== m.play) {
        a.srcObject = m.play;
        a.volume = state.volume;
        const p = a.play();
        if (p && p.catch) p.catch(function () {});
      }
      roomCreateMeter(m);
    }

    tr.onunmute = paintRoomState;
    tr.onmute = paintRoomState;
    tr.onended = function () {
      try {
        target.removeTrack(tr);
      } catch (e) {}
      paintRoomState();
    };
    paintRoomState();
  }

  function roomDropMember(r, id, reason) {
    const m = r && r.members[id];
    if (!m) return;
    delete r.members[id];
    clearTimeout(m.offerTimer); /* não reenvia oferta de quem saiu */
    clearTimeout(m.connWatchTimer); /* nem refaz conexão de quem saiu */
    try {
      if (m.pc) {
        m.pc.onnegotiationneeded = null;
        m.pc.ontrack = null;
        m.pc.onicecandidate = null;
        m.pc.onconnectionstatechange = null;
        m.pc.close();
      }
    } catch (e) {}
    if (m.anSrc) {
      try {
        m.anSrc.disconnect();
      } catch (e) {}
      m.anSrc = null;
    }
    m.analyser = null;
    if (m.audio) {
      try {
        m.audio.pause();
        m.audio.srcObject = null;
      } catch (e) {}
    }
    paintRoomState();
  }

  /* uma conexão morreu (ICE): refaz UMA vez do zero */
  function roomRestart(m) {
    const r = state.room;
    if (!r || !m || m.restarting) return;
    if ((m.restarts || 0) >= 1) return;
    m.restarting = true;
    m.restarts++;
    const id = m.id;
    const roomId = r.channelId;
    roomDropMember(r, id, "failed");
    setTimeout(function () {
      if (!state.room || state.room.channelId !== roomId) return;
      roomCreateMember(id);
    }, 800);
  }

  /* presença vinda do servidor: cria/sai conexões */
  function roomSync() {
    const r = state.room;
    if (!r) return false;
    const me = S() ? S().me() : null;
    if (!me) return false;
    const rows = ((NX.store || {}).db || {}).voice || [];
    const present = {};
    let iAmIn = false;
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i];
      if (!v || v.channelId !== r.channelId) continue;
      present[v.userId] = true;
      if (v.userId === me.id) iAmIn = true;
    }
    Object.keys(present).forEach(function (id) {
      if (id !== me.id && !r.members[id]) roomCreateMember(id);
    });
    Object.keys(r.members).forEach(function (id) {
      if (!present[id]) roomDropMember(r, id, "left");
    });
    return iAmIn;
  }

  /* ---------------- moderação recebida do servidor ---------------- */
  function roomHandleModeration(item) {
    let p = {};
    try {
      p = JSON.parse((item && item.payload) || "{}") || {};
    } catch (e) {
      p = {};
    }
    const action = String(p.action || "");

    if (action === "removed") {
      const reason = p.reason ? String(p.reason) : "";
      leaveRoom("removed");
      toast(
        reason ||
          t(
            "call.voceFoiRemovido",
            "Você foi removido desta sala de voz pela moderação."
          ),
        "error"
      );
      return;
    }

    if (action === "muted" || action === "unmuted") {
      /* o servidor registrou; nosso cliente obedece na própria faixa */
      state.mod = state.mod || {};
      const r = state.room;
      const me = S() ? S().me() : null;
      if (r && me) {
        const slot = Object.assign({}, state.mod[me.id] || {});
        if (action === "muted") {
          slot.mute = true;
          slot.muteBy = p.by || "";
        } else {
          delete slot.mute;
          delete slot.muteBy;
        }
        state.mod[me.id] = slot;
      }
      applyServerMute();
      toast(
        action === "muted"
          ? t(
              "call.silenciadoPorModeracao",
              "A moderação silenciou seu microfone nesta sala."
            )
          : t(
              "call.silenciamentoLiberado",
              "A moderação liberou seu microfone nesta sala."
            ),
        action === "muted" ? "error" : "info"
      );
      return;
    }
  }

  /* ---------------- sinalização recebida ---------------- */
  function roomRouteSignal(group, item) {
    const r = state.room;
    const cid = String((group && group.callId) || "");
    if (cid.indexOf("vc:") !== 0) return false;
    const rest = cid.slice(3);
    const cut = rest.lastIndexOf(":");
    if (cut <= 0) return false;
    const channelId = rest.slice(0, cut);
    const fromId = rest.slice(cut + 1);
    if (!r || r.channelId !== channelId) return true; /* outra sala: descarta */
    if (!fromId || fromId === ((S() && S().me()) || {}).id) return true;

    /* sinal de sistema da moderação (remetente que não é membro):
       não cria card, não entra no encadeamento WebRTC */
    if (item && item.kind === "moderation") {
      roomHandleModeration(item);
      return true;
    }

    let m = r.members[fromId];
    if (!m && item.kind !== "bye") {
      roomCreateMember(fromId);
      m = r.members[fromId];
      if (m) renderRoom(); /* o card do colega aparece na hora */
    }
    if (!m) return true;
    m.chain = m.chain
      .then(function () {
        return roomHandleSignal(m, item);
      })
      .catch(function (e) {
        console.warn("[nexo/call] sinal da sala:", e && e.message);
      });
    return true;
  }

  async function roomHandleSignal(m, item) {
    const kind = item && item.kind;
    const raw = (item && item.payload) || "";
    if (!kind || !raw || !m) return;

    if (kind === "bye") {
      if (state.room) roomDropMember(state.room, m.id, "peer_left");
      return;
    }

    if (kind === "media") {
      try {
        const next = JSON.parse(raw) || {};
        m.media = {
          mic: next.mic !== false,
          cam: !!next.cam,
          screen: !!next.screen,
          screenAudio: !!next.screenAudio,
        };
      } catch (e) {
        /* sinal ilegível: mantém o estado anterior */
      }
      paintRoomState();
      return;
    }

    const pc = m.pc;
    if (!pc) return;

    if (kind === "candidate") {
      let c;
      try {
        c = JSON.parse(raw);
      } catch (e) {
        return;
      }
      if (!m.remoteDescSet) {
        m.pendingCandidates.push(c);
        return;
      }
      try {
        await pc.addIceCandidate(c);
      } catch (e) {
        if (!m.ignoreOffer) console.warn("[nexo/call] ICE da sala:", e && e.message);
      }
      return;
    }

    if (kind !== "offer" && kind !== "answer") return;

    let desc;
    try {
      desc = JSON.parse(raw);
    } catch (e) {
      return;
    }

    if (kind === "answer") {
      /* a réplica NUNCA é bloqueada pelo empate: quando as duas pontas
         oferecem ao mesmo tempo, quem cedeu já descartou a própria
         oferta e responde à do colega — ignorar aqui deixava o lado
         "impolite" preso em have-local-offer para sempre e a chamada
         ficava em "Conectando…" sem áudio (era isso que travava) */
      if (pc.signalingState !== "have-local-offer") return; /* duplicada/atrasada */
      try {
        await pc.setRemoteDescription(desc);
        m.remoteDescSet = true;
        m.offerRetries = 0;
        clearTimeout(m.offerTimer);
        await roomFlush(m);
        roomConnWatch(m); /* se o ICE não subir em 20s, tenta de novo */
      } catch (e) {
        console.warn("[nexo/call] answer da sala:", e && e.message);
      }
      return;
    }

    /* oferta: perfect negotiation — um dos dois cede (id maior é o
       "polite", então as duas pontas calculam o mesmo par) */
    const collision = m.makingOffer || pc.signalingState !== "stable";
    const me = S() ? S().me() : { id: "" };
    const polite = String(me.id) > String(m.id);
    if (collision && !polite) {
      m.ignoreOffer = true;
      return;
    }
    m.ignoreOffer = false;
    /* cedeu a própria oferta: para de reenviá-la, o caminho agora é
       responder à do colega */
    clearTimeout(m.offerTimer);
    m.offerRetries = 0;
    try {
      await pc.setRemoteDescription(desc);
      m.remoteDescSet = true;
      /* alinha os papéis nas m-lines da oferta e pendura as trilhas
         antes de responder: a resposta já nasce nos dois sentidos */
      roomBindSenders(m);
      await roomFlush(m);
      if (pc.signalingState === "have-remote-offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await roomSignal(m.id, "answer", JSON.stringify(pc.localDescription));
        roomSanity(m); /* pode ter cedido a própria oferta no empate */
        roomConnWatch(m); /* e se o ICE nunca subir, refaz */
      }
    } catch (e) {
      console.warn("[nexo/call] offer da sala:", e && e.message);
    }
  }

  /* ---------------- entrada / saída ---------------- */
  async function joinRoom(channelId, opts) {
    opts = opts || {};
    if (!NX.api || typeof NX.api.joinVoice !== "function")
      throw new Error(t("call.indisponivel", "As chamadas ainda não estão disponíveis."));
    if (state.room) {
      if (state.room.channelId === channelId) return state.room;
      throw new Error(t("call.jaEmChamada", "Você já está em uma chamada."));
    }
    if (state.call || (state.phase && state.phase !== "none"))
      throw new Error(t("call.jaEmChamada", "Você já está em uma chamada."));
    const me = S() ? S().me() : null;
    if (!me) throw new Error(t("api.suaSessaoExpirouEntre8", "Sua sessão expirou. Entre novamente."));
    const ch = S() ? S().channel(channelId) : null;
    if (!ch || ch.type !== "voice")
      throw new Error(t("call.salaNaoEncontrada", "Este canal de voz não existe mais."));

    state.room = {
      channelId: ch.id,
      serverId: ch.serverId,
      members: {},
      minimized: false,
      focus: "grid",
      startedAt: Date.now(),
      mediaSig: "",
      missing: 0,
      ctx: null,
      raf: 0,
      timer: 0,
    };
    state.root = roomRoot();
    renderRoom();

    try {
      await NX.api.joinVoice(ch.id);
    } catch (e) {
      state.room = null;
      render();
      throw e;
    }

    /* mídia: microfone (e câmera se pedida) se o navegador deixar.
       Sem permissão a sala continua ABERTA — só ouve — com aviso
       honesto, em vez de um botão que não responde. Na recuperação
       (`quiet`) NÃO abrimos pedido sozinho: só capturamos se já
       estiver concedido. */
    try {
      await acquireMedia(opts.withVideo === true, { auto: !!opts.quiet });
    } catch (e) {
      /* o motivo real já virou aviso contextual (setMediaIssue):
         toast só quando nenhuma superfície está na tela — o mesmo
         problema nunca é anunciado em dois lugares */
      if (e && e.message && (!state.mediaIssues.length || !mediaUIVisible())) toast(e.message, "warn");
    }

    state.room.phase = "active";
    bind(state.root);
    roomApplyMedia();
    startRoomLoop();
    schedulePoll(POLL_INCALL);
    renderRoom();
    /* presença fresca ANTES de criar os pares: sem isto o espelho local
       (até 2s velho) manda offer/media para quem já saiu e o servidor
       responde 403 por segurança */
    try {
      if (NX.api && typeof NX.api.peekCalls === "function") {
        /* o peek é destrutivo: os sinais que vieram junto são
           despachados aqui, nunca descartados */
        consumePeekSignals(await NX.api.peekCalls());
      }
    } catch (e) {
      /* sem peek: a lista antiga ainda assim é melhor que nada */
    }
    roomSync();
    flushRoomSignals();
    paintRoomState();
    if (!opts.quiet)
      toast(t("call.voceEntrouNaSala", "Você entrou na sala de voz."), "success");
    bus("call:roomjoined", { channelId: ch.id, serverId: ch.serverId });
    return state.room;
  }

  async function leaveRoom(reason) {
    const r = state.room;
    if (!r) return false;
    r.leaving = true; /* nenhum sinal novo sai desta sala daqui pra frente */
    stopRoomLoop(r);
    const ids = Object.keys(r.members);
    /* "removed"/"expired": o servidor já apagou a MINHA linha — avisar
       com bye só geraria 403 em série; a sala dos outros se atualiza
       pelo próprio snapshot de presença (1s) */
    const rowGone = reason === "removed" || reason === "expired";
    if (!rowGone)
      ids.forEach(function (id) {
        if (NX.api && typeof NX.api.sendRoomSignal === "function")
          Promise.resolve(NX.api.sendRoomSignal(r.channelId, id, "bye", reason || "left")).catch(
            function () {}
          );
      });
    state.room = null;
    state.pendingRoomSignals = []; /* sinais guardados valem só para a sala anterior */
    ids.forEach(function (id) {
      roomDropMember(r, id, reason);
    });

    const root = document.getElementById("voice-root");
    if (root) {
      root.hidden = true;
      root.dataset.shell = "";
      root.innerHTML = "";
    }
    document.body.classList.remove("in-room");
    state.root = null;
    state.popOpen = "";
    state.mediaOpen = false;
    clearMediaIssues();

    try {
      if (NX.api && typeof NX.api.leaveVoice === "function") await NX.api.leaveVoice();
    } catch (e) {
      console.warn("[nexo/call] sair da sala:", e && e.message);
    }

    render();
    schedulePoll(POLL_VISIBLE);
    if (reason !== "logout" && reason !== "expired")
      toast(t("call.voceSaiuDaSala", "Você saiu da sala de voz."), "info");
    else if (reason === "expired")
      toast(t("call.presencaExpirou", "Sua conexão com a sala caiu — você saiu."), "warn");
    bus("call:roomleft", { channelId: r.channelId, reason: reason || "left" });
    return true;
  }

  /* ---------------- laço (fala + relógio) ---------------- */
  function startRoomLoop() {
    const r = state.room;
    if (!r) return;
    if (r.timer) clearInterval(r.timer);
    r.timer = setInterval(function () {
      if (!state.room) return;
      paintRoomState();
    }, 1000);
    if (!r.raf) r.raf = requestAnimationFrame(roomFrame);
  }

  function stopRoomLoop(r) {
    if (!r) return;
    if (r.raf) cancelAnimationFrame(r.raf);
    if (r.timer) clearInterval(r.timer);
    r.raf = 0;
    r.timer = 0;
    if (r.selfSrc) {
      try {
        r.selfSrc.disconnect();
      } catch (e) {}
      r.selfSrc = null;
    }
    r.selfAnalyser = null;
    r.buf = null;
    if (r.ctx) {
      try {
        r.ctx.close();
      } catch (e) {}
      r.ctx = null;
    }
  }

  function roomCard(id) {
    const root = document.getElementById("voice-root");
    return root ? root.querySelector('[data-room-card="' + id + '"]') : null;
  }

  function roomFrame() {
    const r = state.room;
    if (!r) return;
    r.raf = requestAnimationFrame(roomFrame);
    try {
      Object.keys(r.members).forEach(function (id) {
        const m = r.members[id];
        const level = roomLevel(m.analyser, m);
        const on = level > 0.06 ? true : m.speaking ? level > 0.032 : false;
        if (on !== m.speaking) {
          m.speaking = on;
          const card = roomCard(id);
          if (card) card.classList.toggle("is-speaking", on);
        }
      });
      const self = roomLevel(r.selfAnalyser, r);
      const selfOn = self > 0.06 ? true : r.selfSpeaking ? self > 0.032 : false;
      if (selfOn !== r.selfSpeaking) {
        r.selfSpeaking = selfOn;
        const me = S() ? S().me() : null;
        const card = me ? roomCard(me.id) : null;
        if (card) card.classList.toggle("is-speaking", selfOn);
      }
    } catch (e) {
      /* sem canvas/Web Audio: a sala segue sem o anel */
    }
  }

  /* ---------------- desenho ---------------- */
  function toggleRoomFocus() {
    if (!state.room) return;
    state.room.focus = state.room.focus === "screen" ? "grid" : "screen";
    renderRoom();
  }

  function roomShellKey() {
    const r = state.room;
    if (!r) return "";
    return [
      r.channelId,
      r.minimized ? "min" : "",
      r.focus || "grid",
      state.mediaOpen ? "media" : "",
      roomVisible() ? "v" : "h",
      Object.keys(r.members).join(","),
      state.screen ? "share" : "",
      /* aviso de permissão: motivo + fechar/ajuda entram na chave para
         a sala repintar quando o estado muda */
      state.mediaIssues
        .map(function (x) {
          return x.kind + ":" + x.reason;
        })
        .join(",") +
        (state.mediaDismissed ? "#d" : "") +
        (state.permHelpOpen ? "#h" : ""),
    ].join("|");
  }

  function renderRoom() {
    const r = state.room;
    if (!r) return;
    const root = roomRoot();
    state.root = root;
    const vis = roomVisible();
    document.body.classList.toggle("in-room", vis);
    const callRoot = document.getElementById("call-root");
    if (callRoot && state.phase === "none") callRoot.hidden = true;
    document.body.classList.remove("in-call");

    if (root.dataset.shell !== roomShellKey()) {
      root.dataset.shell = roomShellKey();
      root.className = "call-layer call-layer--voice";
      root.innerHTML = roomHTML();
      bind(root);
      /* o popover da call sobrevive à repintura da sala */
      if (state.popOpen) {
        const pop = root.querySelector("[data-call-pop]");
        if (pop) {
          pop.hidden = false;
          pop.dataset.open = state.popOpen;
          openPopover(state.popOpen, true);
        }
      }
    }
    root.hidden = !vis;
    roomAttach();
    paintRoomState();
  }

  function syncRoomVisibility() {
    const root = document.getElementById("voice-root");
    if (!root || !state.room) return;
    const vis = roomVisible();
    if (root.hidden !== !vis) {
      root.hidden = !vis;
      document.body.classList.toggle("in-room", vis);
      if (vis) roomAttach();
    }
  }

  function roomSeatMedia(id) {
    const me = S() ? S().me() : null;
    if (me && id === me.id)
      return {
        mic: !!state.mic,
        cam: !!cameraTrack(),
        screen: !!state.screen,
        screenAudio: !!state.screenAudio,
      };
    const m = roomMember(id);
    return m ? m.media : { mic: true, cam: false, screen: false, screenAudio: false };
  }

  function seatHTML(id, count) {
    const me = S() ? S().me() : null;
    const isMe = !!(me && id === me.id);
    const u = (S() ? S().user(id) : null) || (isMe ? me : null);
    const m = isMe ? null : roomMember(id);
    const media = roomSeatMedia(id);
    const av = u && NX.util && NX.util.avatarHTML ? NX.util.avatarHTML(u, "lg", true) : "";
    const name = u ? u.displayName || u.username : t("call.alguem", "Alguém");
    const muted = !media.mic;
    const camOn = !!media.cam;
    const size = count <= 1 ? " is-alone" : count === 2 ? " is-two" : "";
    const conn = m ? roomConnLabel(m) : "";
    const live = media.screen || (isMe && state.screen);
    const modMuted = !isMe && isServerMuted(id);
    const locMuted = !isMe && isLocalMuted(id);
    const volPct = Math.round(memberVolumeOf(id) * 100);
    return (
      '<div class="vroom__card' + size + (live ? " is-sharing" : "") + (modMuted ? " is-modmuted" : "") +
      '" data-room-card="' + hh(id) + '"' + (isMe ? ' data-room-me="1"' : "") +
      ' role="group" aria-label="' + hh(name) + '">' +
      '<div class="vroom__media' + (camOn ? " has-video" : "") + '">' +
      '<span class="vroom__ph">' + av + "</span>" +
      (isMe
        ? '<video class="call-video vroom__video" data-call-local autoplay muted playsinline></video>'
        : '<video class="call-video vroom__video" data-room-video="' + hh(id) + '" autoplay playsinline></video>') +
      (conn ? '<span class="vroom__badge" data-room-conn="' + hh(id) + '">' + hh(conn) + "</span>" : "") +
      (live ? '<span class="vroom__live">' + NX.icon("monitor", "", 13) + " " + t("call.compartilhando", "Compartilhando a tela") + "</span>" : "") +
      (modMuted
        ? '<span class="vroom__live vroom__live--mod">' + NX.icon("micOff", "", 13) + " " + t("call.silenciadoPelaMod", "Silenciado pela moderação") + "</span>"
        : "") +
      "</div>" +
      '<div class="vroom__foot">' +
      "<strong>" + hh(name) + (isMe ? " · " + t("call.voce", "Você") : "") + "</strong>" +
      '<span class="vroom__icons">' +
      (locMuted
        ? '<span class="vroom__ico is-local" title="' + t("call.silenciadoParaVoce", "Silenciado só para você") + '">' +
          NX.icon("volumeOff", "", 14) + "</span>"
        : "") +
      '<span class="vroom__ico' + (muted ? " is-off" : "") + '" data-room-mic="' + hh(id) + '" title="' +
      (modMuted
        ? t("call.silenciadoPelaMod", "Silenciado pela moderação")
        : muted
          ? t("call.microDesligado2", "Mudo")
          : t("call.micro", "Micro")) + '">' +
      (muted ? NX.icon("volumeOff", "", 14) : NX.icon("mic", "", 14)) + "</span>" +
      '<span class="vroom__ico' + (camOn ? "" : " is-off") + '" title="' +
      (camOn ? t("call.camera", "Câmera") : t("call.camera3", "Câmera desligada")) + '">' +
      (camOn ? NX.icon("video", "", 14) : NX.icon("videoOff", "", 14)) + "</span>" +
      (live ? '<span class="vroom__ico vroom__ico--live" title="' + t("call.compartilhando", "Compartilhando a tela") + '">' + NX.icon("monitor", "", 14) + "</span>" : "") +
      (volPct !== 100 && !locMuted
        ? '<span class="vroom__ico vroom__ico--vol" title="' + t("call.volume", "Volume") + " " + volPct + '%">' + volPct + "%</span>"
        : "") +
      '<button type="button" class="vroom__more" data-room-menu="' + hh(id) +
      '" aria-haspopup="menu" aria-label="' + t("call.menuParticipante", "Opções de ") + hh(name) + '">' +
      NX.icon("more", "", 16) + "</button>" +
      "</span></div></div>"
    );
  }

  function roomPeopleHTML() {
    const seats = roomSeats();
    const rows = seats
      .map(function (id) {
        const me = S() ? S().me() : null;
        const isMe = !!(me && id === me.id);
        const u = (S() ? S().user(id) : null) || (isMe ? me : null);
        if (!u) return "";
        const media = roomSeatMedia(id);
        const m = isMe ? null : roomMember(id);
        return (
          '<div class="call-person">' +
          '<span class="call-person__av">' +
          (NX.util && NX.util.avatarHTML ? NX.util.avatarHTML(u, "sm", true) : "") +
          "</span>" +
          '<span class="call-person__txt"><strong>' +
          hh(u.displayName || u.username || "") +
          (isMe ? " · " + t("call.voce", "Você") : "") +
          "</strong><small>@" +
          hh(u.username || "") +
          (m ? " · " + hh(roomConnLabel(m)) : "") +
          "</small></span>" +
          '<span class="call-person__mic">' +
          (media.mic ? NX.icon("mic", "", 14) : NX.icon("volumeOff", "", 14)) +
          (media.cam ? NX.icon("video", "", 14) : "") +
          (media.screen ? NX.icon("monitor", "", 14) : "") +
          "</span>" +
          '<button type="button" class="call-person__more" data-room-menu="' + hh(id) +
          '" aria-haspopup="menu" aria-label="' +
          t("call.menuParticipante", "Opções de ") + hh(u.displayName || u.username || "") + '">' +
          NX.icon("more", "", 15) + "</button>" +
          "</div>"
        );
      })
      .join("");
    return (
      '<div class="call-people"><h4>' +
      t("call.participantes", "Participantes") +
      " <span>" +
      seats.length +
      "</span></h4>" +
      (rows || '<p class="call-people__empty">' + t("call.salaVazia", "Ninguém por aqui.") + "</p>") +
      "</div>"
    );
  }

  function roomHTML() {
    const r = state.room;
    const me = S() ? S().me() : null;
    const ch = S() ? S().channel(r.channelId) : null;
    const srv = S() ? S().server(r.serverId) : null;
    const seats = roomSeats();
    const sharer = roomSharer();
    const focusScreen = r.focus === "screen" && !!sharer;
    const cards = seats
      .map(function (id) {
        return seatHTML(id, seats.length);
      })
      .join("");
    const spotOwner = sharer
      ? sharer.mine
        ? t("call.voceCompartilhando", "Você está compartilhando a tela")
        : hh(((S() && S().user(sharer.id)) || {}).displayName || t("call.alguem", "Alguém")) +
          " · " + t("call.compartilhandoATela", "compartilhando a tela")
      : "";

    return (
      '<div class="call-screen vroom' + (focusScreen ? " vroom--focus" : "") +
      '" role="dialog" aria-label="' + hh(ch ? ch.name : t("call.salaDeVoz", "Sala de voz")) + '">' +
      '<header class="call-head">' +
      '<div class="call-head__who">' +
      '<span class="call-head__av">' + NX.icon("voice", "", 18) + "</span>" +
      '<span class="call-head__txt"><strong>' + hh(ch ? ch.name : t("call.salaDeVoz", "Sala de voz")) + "</strong>" +
      "<small>" + hh(srv ? srv.name : "") + " · " +
      seats.length + " " + (seats.length === 1 ? t("call.pessoa", "pessoa") : t("call.pessoas2", "pessoas")) +
      " " + t("call.nasala", "na sala") + "</small></span>" +
      "</div>" +
      '<div class="call-head__meta">' +
      '<span class="call-chip" data-call-conn>' + hh(roomHeaderConn()) + "</span>" +
      '<span class="call-chip call-chip--time" data-call-time>' +
      fmtTime(Date.now() - r.startedAt) + "</span>" +
      (state.screen
        ? '<span class="call-chip call-chip--live">' + NX.icon("monitor", "", 14) + " " + t("call.compartilhando", "Compartilhando a tela") + "</span>"
        : "") +
      (sharer
        ? '<button type="button" class="call-chip call-chip--btn' + (focusScreen ? " is-on" : "") +
          '" data-call="room-focus">' +
          (focusScreen ? NX.icon("users", "", 15) + " " + t("call.participantes", "Participantes") : NX.icon("monitor", "", 15) + " " + t("call.verTela", "Ver tela")) +
          "</button>"
        : "") +
      '<button type="button" class="call-chip call-chip--btn' + (state.mediaOpen ? " is-on" : "") +
      '" data-call="media">' + NX.icon("film", "", 16) + " " + t("call.midia", "Mídia") + "</button>" +
      '<button type="button" class="call-chip call-chip--btn" data-call="room-menu" aria-haspopup="menu" aria-label="' +
      t("call.menuDaSala", "Opções da sala") + '">' + NX.icon("more", "", 16) + "</button>" +
      '<button type="button" class="call-chip call-chip--btn" data-call="min" aria-label="' +
      t("call.minimizar", "Minimizar") + '">–</button>' +
      "</div></header>" +

      '<div class="call-stage vroom__stage' + (focusScreen ? " is-spot" : "") + '">' +
      (sharer
        ? '<div class="vroom__spot"><video class="call-video vroom__spotvideo" data-room-spot autoplay playsinline></video>' +
          '<span class="vroom__splabel">' + NX.icon("monitor", "", 13) + " " + spotOwner + "</span></div>"
        : "") +
      (state.mediaWarned ? permCardHTML(true) : "") +
      '<div class="vroom__grid">' + cards + "</div>" +
      "</div>" +

      '<div class="call-bar">' +
      ctl(
        "mic",
        state.mic ? NX.icon("mic", "", 18) : NX.icon("volumeOff", "", 18),
        state.mic ? t("call.micro", "Micro") : t("call.microDesligado2", "Mudo"),
        !state.mic,
        state.mic
          ? t("call.dicaMicroOn", "Microfone ligado — clique para silenciar. Escolher outro microfone nas Configurações.")
          : t("call.dicaMicroOff", "Microfone desligado — clique para ativar. Escolher outro microfone nas Configurações.")
      ) +
      ctl(
        "cam",
        state.cam ? NX.icon("camera", "", 18) : NX.icon("videoOff", "", 18),
        t("call.camera", "Câmera"),
        !state.cam,
        state.cam
          ? t("call.dicaCamOn", "Câmera ligada — clique para desligar. Prévia e escolha da câmera nas Configurações.")
          : t("call.dicaCamOff", "Câmera desligada — clique para ligar. Prévia e escolha da câmera nas Configurações.")
      ) +
      ctl(
        "screen",
        state.screen ? NX.icon("stop", "", 18) : NX.icon("monitor", "", 18),
        state.screen ? t("call.pararTela", "Parar tela") : t("call.tela", "Tela"),
        state.screen,
        state.screen
          ? t("call.dicaTelaOn", "Compartilhando a tela — clique para parar (você continua na sala).")
          : t("call.dicaTelaOff", "Compartilhar a tela — abre o seletor de janelas/abas do navegador.")
      ) +
      ctl("volume", NX.icon("volume", "", 18), t("call.volume", "Volume"), false) +
      ctl("people", NX.icon("users", "", 18), t("call.pessoas", "Pessoas"), false) +
      ctl("tx", NX.icon("monitor", "", 18), t("call.tx.titulo", "Transmissão"), state.popOpen === "tx") +
      ctl("settings", NX.icon("settings", "", 18), t("call.config", "Configurações"), false) +
      ctl("full", NX.icon("maximize", "", 18), t("call.telaCheia", "Tela cheia"), false) +
      '<button type="button" class="call-ctl call-ctl--hang" data-call="hangup" title="' +
      t("call.desconectar", "Desconectar") + '"><span class="call-ctl__ico">' + NX.icon("phoneOff", "", 18) + "</span><span>" +
      t("call.desconectar", "Desconectar") + "</span></button>" +
      "</div>" +
      '<div class="call-pop" data-call-pop hidden></div>' +
      '<aside class="call-media' + (state.mediaOpen ? " is-open" : "") + '" data-call-media' +
      (state.mediaOpen ? "" : " hidden") + ">" +
      mediaHTML() +
      "</aside>" +
      "</div>"
    );
  }

  /* anexa as streams nas mídias da camada (idempotente) */
  function roomAttach() {
    const r = state.room;
    if (!r) return;
    const root = document.getElementById("voice-root");
    if (!root) return;
    attachLocalPreview();

    Object.keys(r.members).forEach(function (id) {
      const m = r.members[id];
      const v = root.querySelector('[data-room-video="' + id + '"]');
      if (v && v.srcObject !== m.camStream) {
        v.srcObject = m.camStream;
        const p = v.play();
        if (p && p.catch) p.catch(function () {});
      }
      if (m.audio && m.audio.srcObject !== m.play) {
        m.audio.srcObject = m.play;
        m.audio.volume = state.volume;
        const p2 = m.audio.play();
        if (p2 && p2.catch) p2.catch(function () {});
      }
    });

    const spot = root.querySelector("[data-room-spot]");
    if (spot) {
      const sharer = roomSharer();
      let src = null;
      if (sharer) src = sharer.mine ? state.screenStream : (roomMember(sharer.id) || {}).screenStream;
      if (src && spot.srcObject !== src) {
        spot.srcObject = src;
        const p3 = spot.play();
        if (p3 && p3.catch) p3.catch(function () {});
      }
    }
  }

  /* atualização leve: sem innerHTML (senão o vídeo reinicia) */
  function paintRoomState() {
    const r = state.room;
    if (!r) return;
    const root = document.getElementById("voice-root");
    if (!root) return;

    const conn = root.querySelector("[data-call-conn]");
    if (conn) conn.textContent = roomHeaderConn();
    const time = root.querySelector("[data-call-time]");
    if (time) time.textContent = fmtTime(Date.now() - r.startedAt);

    setCtl(root, "mic", !state.mic);
    setCtl(root, "cam", !state.cam);
    setCtl(root, "screen", !!state.screen);

    roomSeats().forEach(function (id) {
      const card = roomCard(id);
      if (!card) return;
      const media = roomSeatMedia(id);
      const m = roomMember(id);
      const me = S() ? S().me() : null;
      const isMe = !!(me && id === me.id);
      const video = isMe
        ? card.querySelector("[data-call-local]")
        : card.querySelector('[data-room-video="' + id + '"]');
      const camLive = !!(media.cam && video && liveVideoIn(video));
      card.querySelector(".vroom__media").classList.toggle("has-video", camLive);
      const mic = card.querySelector('[data-room-mic="' + id + '"]') || card.querySelector(".vroom__icons .vroom__ico");
      if (mic) {
        mic.classList.toggle("is-off", !media.mic);
        mic.innerHTML = NX.icon(media.mic ? "mic" : "volumeOff", "", 14);
      }
      /* silêncio local (só eu) e silêncio por moderação (servidor)
         são coisas diferentes — cada um com seu próprio indicador */
      const modm = !isMe && isServerMuted(id);
      const locm = !isMe && isLocalMuted(id);
      card.classList.toggle("is-modmuted", modm);
      const localIco = card.querySelector(".vroom__ico.is-local");
      if (localIco) localIco.hidden = !locm;
      card.classList.toggle("is-sharing", !!media.screen);
      const badge = card.querySelector("[data-room-conn]");
      if (badge && m) badge.textContent = roomConnLabel(m);

      /* o selo "silenciado pela moderação" tem que acompanhar o
         estado sem esperar uma repintura completa da sala */
      let modBadge = card.querySelector(".vroom__live--mod");
      if (modm && !modBadge) {
        const mediaBox = card.querySelector(".vroom__media");
        if (mediaBox) {
          modBadge = document.createElement("span");
          modBadge.className = "vroom__live vroom__live--mod";
          modBadge.innerHTML =
            NX.icon("micOff", "", 13) + " " +
            hh(t("call.silenciadoPelaMod", "Silenciado pela moderação"));
          mediaBox.appendChild(modBadge);
        }
      } else if (!modm && modBadge) {
        modBadge.remove();
      }

      /* título do microfone muda junto: não é "mudo", é moderação */
      if (mic) {
        mic.setAttribute(
          "title",
          modm
            ? t("call.silenciadoPelaMod", "Silenciado pela moderação")
            : media.mic
              ? t("call.micro", "Micro")
              : t("call.microDesligado2", "Mudo")
        );
      }
    });

    roomAttach();
  }

  function liveVideoIn(video) {
    const s = video && video.srcObject;
    if (!s) return false;
    return s.getVideoTracks().some(function (tr) {
      return tr.readyState === "live" && tr.enabled !== false && !tr.muted;
    });
  }

  function setCtl(root, name, on) {
    const btn = root.querySelector('[data-call="' + name + '"]');
    if (!btn) return;
    btn.classList.toggle("is-on", !!on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function roomVolume(v) {
    const box = document.getElementById("voice-audio");
    if (box) {
      box.querySelectorAll("audio").forEach(function (a) {
        a.volume = v;
      });
    }
    if (state.room && state.room.members) {
      Object.keys(state.room.members).forEach(function (id) {
        const m = state.room.members[id];
        if (m.audio) m.audio.volume = v;
      });
    }
    applyMemberAudio();
  }

  /* ---------------- volume e silenciamento POR PESSOA ----------------
     Isto é só do meu lado: mexer no volume ou silenciar alguém aqui
     NÃO altera o microfone dessa pessoa nem o que os outros ouvem. */

  function memberVolumeOf(id) {
    const v = Number(state.memberVol[id]);
    return isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  }

  function isLocalMuted(id) {
    return !!state.localMute[id];
  }

  /* volume efetivo = volume global × volume daquela pessoa;
     silenciado só para mim = 0 (a faixa continua vindo, eu só não ouço) */
  function applyMemberAudio() {
    const box = document.getElementById("voice-audio");
    const ids = [];
    if (box) {
      box.querySelectorAll("audio").forEach(function (a) {
        ids.push(a.getAttribute("data-room-audio"));
      });
    }
    if (state.room && state.room.members) {
      Object.keys(state.room.members).forEach(function (id) {
        const m = state.room.members[id];
        if (m.audio && ids.indexOf(id) === -1) ids.push(id);
      });
    }
    ids.forEach(function (id) {
      if (!id) return;
      const eff = isLocalMuted(id) ? 0 : state.volume * memberVolumeOf(id);
      const box2 = document.getElementById("voice-audio");
      const el = box2 ? box2.querySelector('[data-room-audio="' + id + '"]') : null;
      if (el) el.volume = eff;
      const m = roomMember(id);
      if (m && m.audio) m.audio.volume = eff;
    });
  }

  /* o servidor mandou silenciar/ativar — eu obedeço na MINHA faixa e
     aviso os outros. Isto é enforcement do cliente, gravado no
     servidor: não dá para cortar o áudio de terceiros em malha. */
  function applyServerMute() {
    const r = state.room;
    if (!r) return;
    const me = S() ? S().me() : null;
    if (!me) return;
    const slot = (state.mod || {})[me.id];
    const wanted = !!(slot && slot.mute);
    const wasWanted = !!state.serverMutedWas;
    if (wanted && !wasWanted) {
      /* começo a valer: lembro o que eu estava e desligo a minha faixa */
      state.micBeforeMod = state.mic;
      if (state.mic) setMicEnabled(false);
    } else if (!wanted && wasWanted) {
      /* acabou: religa só se é assim que eu estava antes — senão
         fica desligado e eu que decido quando ligar de novo */
      if (state.micBeforeMod && micTrack()) setMicEnabled(true);
      state.micBeforeMod = false;
    }
    state.serverMutedWas = wanted;
    paintRoomState();
    renderRoom();
  }

  /* =============== moderação da sala (espelho do servidor) ===============
     Tudo aqui é só PREVIEW: o servidor revalida identidade, participação,
     permissão e hierarquia em POST /voice/moderate. Esconder o botão não
     protege nada — quem recusa é a API. */
  function roomModSlot(id) {
    const r = state.room;
    if (!r) return null;
    const v = (state.mod || {})[id];
    return v && typeof v === "object" ? v : null;
  }

  function isServerMuted(id) {
    const s = roomModSlot(id);
    return !!(s && s.mute);
  }

  function isVoiceBlocked(id) {
    const s = roomModSlot(id);
    return !!(s && Number(s.kickUntil) > Date.now());
  }

  /* mesma escada do server/handlers/calls.js → modRank() */
  function modRankLocal(serverId, userId) {
    if (!S()) return 0;
    if (S().isOwner(serverId, userId)) return 4;
    const p = S().effectivePerms(serverId, userId) || {};
    if (p.administrator) return 3;
    if (p.manageServer || p.manageRoles || p.manageChannels) return 2;
    if (p.kickMembers || p.muteMembers) return 1;
    return 0;
  }

  function canModerateVoice(targetId, perm) {
    const r = state.room;
    const me = S() ? S().me() : null;
    if (!r || !me || !targetId || targetId === me.id) return false;
    if (!S().can(r.serverId, me.id, perm)) return false;
    if (S().isOwner(r.serverId, targetId)) return false;
    if (modRankLocal(r.serverId, me.id) < modRankLocal(r.serverId, targetId)) return false;
    return true;
  }

  function canEndVoiceRoom() {
    const r = state.room;
    const me = S() ? S().me() : null;
    if (!r || !me) return false;
    return !!S().can(r.serverId, me.id, "manageChannels");
  }

  async function voiceModerate(opts, busyLabel) {
    try {
      const res = await NX.api.voiceModerate(opts || {});
      return res;
    } catch (e) {
      toast((e && e.message) || t("call.erroModeracao", "Não foi possível concluir a ação."), "error");
      return null;
    }
  }

  /* ---------------- menu da sala (cabeçalho) ---------------- */
  function openRoomMenu(anchor) {
    if (!anchor || !state.room) return;
    const r = state.room;
    const seats = roomSeats();
    const items = [{ heading: t("call.participantes", "Participantes") }];

    seats.forEach(function (id) {
      const me = S() ? S().me() : null;
      const isMe = !!(me && id === me.id);
      const u = (S() ? S().user(id) : null) || (isMe ? me : null);
      if (!u) return;
      const media = roomSeatMedia(id);
      items.push({
        icon: media.mic ? "mic" : "volumeOff",
        label: (u.displayName || u.username || "") + (isMe ? " · " + t("call.voce", "Você") : ""),
        hint: isServerMuted(id) ? t("call.silenciadoPelaMod", "Silenciado pela moderação") : "",
        onClick: function () {
          /* reabre o menu daquela pessoa ancorado no cabeçalho */
          openParticipantMenu(anchor, id);
        },
      });
    });

    if (!seats.length) {
      items.push({
        icon: "dashCircle",
        label: t("call.salaVazia", "Ninguém na sala"),
        disabled: true,
      });
    }

    if (canEndVoiceRoom()) {
      items.push({ divider: true });
      items.push({
        icon: "power",
        label: t("call.encerrarSala", "Encerrar a sala de voz"),
        danger: true,
        onClick: function () {
          confirmThen(
            {
              title: t("call.tituloEncerrar", "Encerrar a sala?"),
              message: t(
                "call.msgEncerrar",
                "Todas as pessoas são retiradas desta sala de voz."
              ),
              icon: "power",
              confirmLabel: t("call.confEncerrar", "Encerrar sala"),
              danger: true,
            },
            function () {
              return voiceModerate({ channelId: r.channelId, action: "end" });
            },
            function () {
              leaveRoom("ended");
            }
          );
        },
      });
    }

    NX.ui.menu(anchor, items, { align: "end" });
  }

  /* ---------------- menu do participante ---------------- */
  function openParticipantMenu(anchor, id) {
    if (!anchor || !id || !state.room) return;
    const me = S() ? S().me() : null;
    const isMe = !!(me && id === me.id);
    const u = (S() ? S().user(id) : null) || (isMe ? me : null);
    const name = (u && (u.displayName || u.username)) || t("call.alguem", "Alguém");
    const items = [];

    items.push({ heading: name });

    /* --- sempre: coisas que são SÓ do meu lado --- */
    items.push({
      icon: "user",
      label: t("call.abrirPerfil", "Abrir perfil"),
      onClick: function () {
        if (NX.app && NX.app.go) NX.app.go("/perfil/" + id);
      },
    });
    items.push({
      icon: "volume",
      label: t("call.volumeIndividual", "Volume individual"),
      hint: Math.round(memberVolumeOf(id) * 100) + "%",
      onClick: function () {
        openVolumePopout(anchor, id);
      },
    });
    items.push({
      icon: isLocalMuted(id) ? "volume" : "volumeOff",
      label: isLocalMuted(id)
        ? t("call.reativarSomLocal", "Ativar som para mim")
        : t("call.silenciarParaMim", "Silenciar só para mim"),
      hint: t("call.soEsteLado", "Só deste lado"),
      onClick: function () {
        state.localMute[id] = !state.localMute[id];
        if (!state.localMute[id]) delete state.localMute[id];
        applyMemberAudio();
        paintRoomState();
        renderRoom();
      },
    });

    if (isMe) {
      NX.ui.menu(anchor, items, { align: "start" });
      return;
    }

    const canKick = canModerateVoice(id, "kickMembers");
    const canMute = canModerateVoice(id, "muteMembers");
    if (!canKick && !canMute) {
      NX.ui.menu(anchor, items, { align: "start" });
      return;
    }

    items.push({ divider: true });
    items.push({ heading: t("call.moderacao", "Moderação") });

    if (canMute) {
      const mutedNow = isServerMuted(id);
      items.push({
        icon: mutedNow ? "mic" : "micOff",
        label: mutedNow
          ? t("call.liberarMicrofone", "Liberar microfone na sala")
          : t("call.silenciarNaSala", "Silenciar na sala"),
        hint: mutedNow
          ? t("call.hintLiberar", "A pessoa volta a poder falar")
          : t("call.efeitoReal", "Efeito real: a pessoa não fala aqui"),
        onClick: function () {
          confirmThen(
            {
              title: mutedNow
                ? t("call.tituloLiberarMicro", "Liberar microfone?")
                : t("call.tituloSilenciar", "Silenciar na sala?"),
              message: mutedNow
                ? t(
                    "call.msgLiberarMicro",
                    name + " volta a poder falar nesta sala de voz."
                  )
                : t("call.msgSilenciar", name + " é silenciado para todas as pessoas da sala."),
              note: t(
                "call.notaSilenciar",
                "O áudio é malha entre os navegadores: o servidor registra a ordem e o microfone de quem foi silenciado é desligado pelo próprio cliente."
              ),
              icon: "micOff",
              confirmLabel: mutedNow
                ? t("call.confLiberar", "Liberar")
                : t("call.confSilenciar", "Silenciar"),
              danger: !mutedNow,
            },
            function () {
              return voiceModerate({
                channelId: state.room.channelId,
                userId: id,
                action: mutedNow ? "unmute" : "mute",
              });
            },
            function () {
              const slot = Object.assign({}, (state.mod || {})[id] || {});
              if (mutedNow) {
                delete slot.mute;
                delete slot.muteBy;
              } else {
                slot.mute = true;
              }
              state.mod[id] = slot;
              paintRoomState();
              renderRoom();
            }
          );
        },
      });
    }

    if (canKick) {
      items.push({
        icon: "clock",
        label: t("call.impedirDeEntrar", "Impedir de entrar por tempo"),
        hint: t("call.tempoMax", "até 1 hora"),
        onClick: function () {
          openBlockPopout(anchor, id);
        },
      });
      items.push({
        icon: "x",
        label: t("call.removerDaSala", "Remover da sala"),
        danger: true,
        onClick: function () {
          confirmThen(
            {
              title: t("call.tituloRemover", "Remover da sala?"),
              message: t("call.msgRemover", name + " sai desta sala de voz agora."),
              note: t(
                "call.notaRemover",
                "A presença é apagada no servidor e a pessoa não entra de volta por 2 minutos."
              ),
              icon: "x",
              confirmLabel: t("call.confRemover", "Remover"),
              danger: true,
            },
            function () {
              return voiceModerate({
                channelId: state.room.channelId,
                userId: id,
                action: "kick",
              });
            },
            function () {}
          );
        },
      });
    }

    if (canEndVoiceRoom()) {
      items.push({
        icon: "power",
        label: t("call.encerrarSala", "Encerrar a sala de voz"),
        danger: true,
        onClick: function () {
          confirmThen(
            {
              title: t("call.tituloEncerrar", "Encerrar a sala?"),
              message: t(
                "call.msgEncerrar",
                "Todas as pessoas são retiradas desta sala de voz."
              ),
              icon: "power",
              confirmLabel: t("call.confEncerrar", "Encerrar sala"),
              danger: true,
            },
            function () {
              return voiceModerate({
                channelId: state.room.channelId,
                action: "end",
              });
            },
            function () {
              leaveRoom("ended");
            }
          );
        },
      });
    }

    NX.ui.menu(anchor, items, { align: "start" });
  }

  function confirmThen(ask, run, onDone) {
    Promise.resolve(NX.ui.confirm(ask)).then(function (ok) {
      if (!ok) return;
      Promise.resolve(run()).then(function (res) {
        if (res && onDone) onDone(res);
      });
    });
  }

  /* volume individual: slider de verdade, com teclado e toque */
  function openVolumePopout(anchor, id) {
    const u = (S() ? S().user(id) : null) || null;
    const name = (u && (u.displayName || u.username)) || t("call.alguem", "Alguém");
    const el = NX.ui.popout(
      anchor,
      '<div class="vroom-pop">' +
        '<strong class="vroom-pop__t">' + t("call.volumeDe", "Volume de ") + hh(name) + "</strong>" +
        '<label class="vroom-pop__row">' +
        '<span class="vroom-pop__lbl">' + t("call.volume", "Volume") + "</span>" +
        '<input type="range" min="0" max="100" step="5" value="' +
        Math.round(memberVolumeOf(id) * 100) +
        '" data-vol-for="' + hh(id) + '" aria-label="' + t("call.volumeDe", "Volume de ") + hh(name) + '">' +
        '<span class="vroom-pop__val" data-vol-out>' + Math.round(memberVolumeOf(id) * 100) + "%</span>" +
        "</label>" +
        '<p class="vroom-pop__note">' + t("call.notaVolume", "Vale só para você. O áudio das outras pessoas não muda.") + "</p>" +
        "</div>",
      { cls: "popout--vroom", align: "start" }
    );
    if (!el) return;
    const range = el.querySelector("[data-vol-for]");
    const out = el.querySelector("[data-vol-out]");
    if (!range) return;
    range.addEventListener("input", function () {
      const v = Math.max(0, Math.min(100, Number(range.value) || 0));
      state.memberVol[id] = v / 100;
      if (out) out.textContent = v + "%";
      applyMemberAudio();
    });
    range.focus();
  }

  /* impedir de entrar por tempo: escolha de duração + motivo */
  function openBlockPopout(anchor, id) {
    const u = (S() ? S().user(id) : null) || null;
    const name = (u && (u.displayName || u.username)) || t("call.alguem", "Alguém");
    const opts = [
      [60000, t("call.umMinuto", "1 minuto")],
      [300000, t("call.cincoMinutos", "5 minutos")],
      [900000, t("call.dezMinutos", "10 minutos")],
      [1800000, t("call.trintaMinutos", "30 minutos")],
      [3600000, t("call.umaHora", "1 hora")],
    ];
    const el = NX.ui.popout(
      anchor,
      '<div class="vroom-pop">' +
        '<strong class="vroom-pop__t">' + t("call.impedirTitulo", "Impedir de entrar: ") + hh(name) + "</strong>" +
        '<label class="vroom-pop__row"><span class="vroom-pop__lbl">' + t("call.duracao", "Duração") + "</span>" +
        '<select data-block-dur aria-label="' + t("call.duracao", "Duração") + '">' +
        opts
          .map(function (o, i) {
            return '<option value="' + o[0] + '"' + (i === 2 ? " selected" : "") + ">" + o[1] + "</option>";
          })
          .join("") +
        "</select></label>" +
        '<label class="vroom-pop__row"><span class="vroom-pop__lbl">' + t("call.motivo", "Motivo") + "</span>" +
        '<input type="text" maxlength="120" data-block-reason placeholder="' +
        t("call.motivoOpcional", "Opcional") + '"></label>' +
        '<div class="vroom-pop__acts">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-block-cancel>' +
        t("common.cancel", "Cancelar") + "</button>" +
        '<button type="button" class="btn btn--danger btn--sm" data-block-ok>' +
        t("call.confImpedir", "Impedir") + "</button>" +
        "</div></div>",
      { cls: "popout--vroom", align: "start" }
    );
    if (!el) return;
    const dur = el.querySelector("[data-block-dur]");
    const reason = el.querySelector("[data-block-reason]");
    const cancel = el.querySelector("[data-block-cancel]");
    const ok = el.querySelector("[data-block-ok]");
    if (cancel)
      cancel.addEventListener("click", function () {
        NX.ui.closePopout();
      });
    if (ok)
      ok.addEventListener("click", function () {
        const ms = Number(dur && dur.value) || 600000;
        const why = ((reason && reason.value) || "").slice(0, 120);
        NX.ui.closePopout();
        confirmThen(
          {
            title: t("call.tituloImpedir", "Impedir de entrar?"),
            message: t("call.msgImpedir", name + " é retirado e não entra nesta sala antes do prazo."),
            note: t("call.notaImpedir", "A proibição é gravada no servidor e vale para qualquer navegador dessa pessoa."),
            icon: "clock",
            confirmLabel: t("call.confImpedir", "Impedir"),
            danger: true,
          },
          function () {
            return voiceModerate({
              channelId: state.room.channelId,
              userId: id,
              action: "timeout",
              durationMs: ms,
              reason: why,
            });
          },
          function () {}
        );
      });
    if (dur) dur.focus();
  }

  function roomState() {
    const r = state.room;
    if (!r) return null;
    const me = S() ? S().me() : null;
    return {
      channelId: r.channelId,
      serverId: r.serverId,
      phase: r.phase,
      minimized: !!r.minimized,
      focus: r.focus,
      seats: roomSeats().length,
      members: Object.keys(r.members).map(function (id) {
        const m = r.members[id];
        return { id: id, conn: m.conn, media: m.media, speaking: !!m.speaking };
      }),
      me: me ? { id: me.id, mic: !!state.mic, cam: !!state.cam, screen: !!state.screen } : null,
      /* estado agregado REAL da conexão (mesmo texto do cabeçalho) */
      conn: roomHeaderConn(),
      /* mídia de verdade: um problema real por tipo (o dock mostra um
         indicador compacto em vez de um aviso gigante) */
      media: {
        ok: !state.mediaIssues.length,
        issues: state.mediaIssues.map(function (x) {
          return { kind: x.kind, reason: x.reason, title: x.title, body: x.body, help: x.help };
        }),
        dismissed: !!state.mediaDismissed,
      },
      visible: roomVisible(),
      seconds: Math.floor((Date.now() - r.startedAt) / 1000),
    };
  }

  /* estado REAL das tracks na sala (envio e recebimento) */
  function roomTracks() {
    const r = state.room;
    const out = { send: [], recv: [] };
    if (!r) return out;
    Object.keys(r.members).forEach(function (id) {
      const m = r.members[id];
      m.pc.getSenders().forEach(function (s) {
        const tr = s.track;
        out.send.push({
          peer: id,
          kind: tr ? tr.kind : "vazio",
          live: !!(tr && tr.readyState === "live"),
          enabled: tr ? tr.enabled !== false : false,
          source: tr ? tr._nxSource || "local" : "-",
        });
      });
      m.play.getTracks().forEach(function (tr) {
        out.recv.push({
          peer: id,
          kind: tr.kind,
          live: tr.readyState === "live",
          muted: !!tr.muted,
          enabled: tr.enabled !== false,
        });
      });
      m.camStream.getTracks().forEach(function (tr) {
        out.recv.push({ peer: id, kind: "video", live: tr.readyState === "live", muted: !!tr.muted, enabled: tr.enabled !== false });
      });
      m.screenStream.getTracks().forEach(function (tr) {
        out.recv.push({ peer: id, kind: "screen", live: tr.readyState === "live", muted: !!tr.muted, enabled: tr.enabled !== false });
      });
    });
    return out;
  }

  /* F5 / troca de aba: volta para a sala que ainda existe no servidor */
  async function recoverRoom(peekData) {
    if (state.room || state.call || (state.phase && state.phase !== "none")) return null;
    const me = S() ? S().me() : null;
    if (!me) return null;
    /* as linhas vêm do PRÓPRIO peek que acabou de rodar: se ele não
       conseguiu ler a presença, tenta de novo (o boot insiste) */
    const list = peekData && Array.isArray(peekData.voice)
      ? peekData.voice
      : ((NX.store || {}).db || {}).voice;
    if (!Array.isArray(list)) return null;
    const mine = list.filter(function (v) {
      return v && v.userId === me.id;
    })[0];
    if (!mine) return "idle"; /* nada de sala para retomar */
    if (!S() || !S().channel(mine.channelId)) return "idle";
    try {
      await joinRoom(mine.channelId, { quiet: true });
      toast(t("call.voltouParaSala", "Você voltou para a sala de voz."), "info");
      return "room";
    } catch (e) {
      console.warn("[nexo/call] voltar para a sala:", e && e.message);
      return "idle";
    }
  }

  /* =========================================================
     RECUPERAÇÃO (F5 / troca de aba no meio da chamada)
     Reentra na chamada que continua ativa no servidor —
     nada de chamada "fantasma" travando o próximo ligar.
     ========================================================= */
  async function recover() {
    if (!NX.api || typeof NX.api.peekCalls !== "function") return null;
    if (state.call || state.phase !== "none") return null;
    let data = null;
    try {
      data = await NX.api.peekCalls();
    } catch (e) {
      return null;
    }
    if (!data || state.call || state.phase !== "none") return null;

    /* o peek é destrutivo: aproveita para despachar os sinais que
       vieram junto (oferta da outra ponta, candidatos da sala) —
       descartá-los aqui trancava a chamada em "conectando" */
    consumePeekSignals(data);

    const calls = data.calls || {};
    const peers = data.peers || {};
    let active = null;
    Object.keys(calls).forEach(function (id) {
      const c = calls[id];
      if (c && c.state === "active") active = c;
    });
    if (!active) {
      /* nada de chamada 1:1: talvez eu continue numa sala de voz */
      return await recoverRoom(data);
    }
    const peer = peers[active.id] || (S() ? S().user(active.peerId) : null);
    if (!peer) return null;

    state.call = active;
    state.peer = peer;
    state.phase = "active";
    state.startedAt = active.startedAt || Date.now();
    state.connection = "new";
    clearMediaIssues();
    render();
    try {
      /* F5 no meio da chamada: reutiliza o que já foi concedido e,
         se ainda não foi liberado, não abrimos pedido sozinho */
      await acquireMedia(false, { auto: true });
    } catch (e) {
      /* o motivo real já virou aviso contextual (setMediaIssue):
         toast só quando nenhuma superfície está na tela — o mesmo
         problema nunca é anunciado em dois lugares */
      if (e && e.message && (!state.mediaIssues.length || !mediaUIVisible())) toast(e.message, "warn");
    }
    createPC(false); /* dispara renegotiate → a outra ponta responde */
    attachLocalPreview();
    startTicker();
    schedulePoll(POLL_INCALL);
    toast(t("call.voceVoltou", "Você voltou para a chamada."), "info");
    bus("call:rejoined", { call: active, peer: peer });
    return "rejoined";
  }

  /* o sync da sessão pode terminar depois do boot: tenta até saber
     quem é o usuário e até a chamada ativa aparecer no sync */
  function bootRecover(attempt) {
    const n = attempt || 0;
    let me = null;
    try {
      me = S() ? S().me() : null;
    } catch (e) {}
    if (!me) {
      if (n < 20) setTimeout(function () { bootRecover(n + 1); }, 1000);
      return;
    }
    Promise.resolve(recover())
      .then(function (r) {
        if (!r && n < 8) setTimeout(function () { bootRecover(n + 1); }, 1500);
      })
      .catch(function () {});
  }
  try {
    bootRecover(0);
  } catch (e) {
    /* sem ambiente: nada a recuperar */
  }

  /* =========================================================
     TRANSMISSÃO — qualidade, FPS e estatísticas REAIS
     ---------------------------------------------------------
     Regras desta seção:
     • Nenhum contador é animado. Os três números de FPS são
       coisas DIFERENTES e o painel diz qual é qual:
         capturado = track.getSettings().frameRate
         codificado = outbound-rtp.framesPerSecond
         recebido  = inbound-rtp.framesPerSecond
     • 120 FPS só é oferecido se getCapabilities() disser que a
       captura aguenta. Caso contrário o painel explica o teto
       e ajusta o pedido — nunca finge que funcionou.
     • Nada aqui captura GPU nem jogo específico: é captura de
       tela do navegador, como o resto do Nexo.
     ========================================================= */

  const TX_RES = [
    { v: "720", w: 1280, h: 720 },
    { v: "1080", w: 1920, h: 1080 },
    { v: "1440", w: 2560, h: 1440 },
    { v: "2160", w: 3840, h: 2160 }
  ];

  /* limites SEGUROS de taxa: 150 kbps (telas estáticas) até 20 Mbps */
  const TX_BIT_MIN = 150;
  const TX_BIT_MAX = 20000;
  const TX_QUALITY = {
    eco: { kbps: 800, degr: "maintain-resolution" },
    equilibrada: { kbps: 2500, degr: "maintain-framerate" },
    alta: { kbps: 6000, degr: "maintain-framerate" }
  };

  /* faixas de VÍDEO que eu estou enviando agora (câmera e/ou tela) */
  function txOutgoingVideoTracks() {
    const out = [];
    const push = function (tr, src) {
      if (!tr || tr.kind !== "video") return;
      if (out.some(function (o) { return o.track === tr; })) return;
      out.push({ track: tr, source: src });
    };
    if (state.localStream) {
      state.localStream.getVideoTracks().forEach(function (tr) {
        push(tr, tr._nxSource === "screen" ? "screen" : "cam");
      });
    }
    if (state.screenStream) {
      state.screenStream.getVideoTracks().forEach(function (tr) { push(tr, "screen"); });
    }
    return out;
  }

  /* capacidades REAIS: é daqui que sai o teto de FPS/resolução */
  function txTrackCaps(track) {
    try {
      if (track && track.getCapabilities) {
        const c = track.getCapabilities();
        return {
          fpsMax: (c && c.frameRate && Number(c.frameRate.max)) || 0,
          wMax: (c && c.width && Number(c.width.max)) || 0,
          hMax: (c && c.height && Number(c.height.max)) || 0
        };
      }
    } catch (e) {}
    return { fpsMax: 0, wMax: 0, hMax: 0 };
  }

  /* teto combinado de todas as faixas ativas */
  function txCeiling() {
    const cap = { fpsMax: 0, wMax: 0, hMax: 0 };
    txOutgoingVideoTracks().forEach(function (o) {
      const c = txTrackCaps(o.track);
      cap.fpsMax = Math.max(cap.fpsMax, c.fpsMax);
      cap.wMax = Math.max(cap.wMax, c.wMax);
      cap.hMax = Math.max(cap.hMax, c.hMax);
    });
    return cap;
  }

  /* resolução efetiva (o que vai ser aplicado, já respeitando o teto) */
  function txResChoice() {
    const wanted = TX_RES.filter(function (r) { return r.v === state.txRes; })[0] || TX_RES[0];
    const cap = txCeiling();
    /* navegador que não informa capacidades (ex.: Firefox): deixa o
       pedido passar e o navegador degrada por conta própria */
    if (!cap.wMax) return { v: wanted.v, w: wanted.w, h: wanted.h, capped: false, known: false };
    return {
      v: wanted.v,
      w: Math.min(wanted.w, cap.wMax),
      h: Math.min(wanted.h, cap.hMax),
      capped: wanted.w > cap.wMax,
      known: true
    };
  }

  /* FPS efetivo (0 = automático) */
  function txFpsChoice() {
    const cap = txCeiling();
    if (state.txFps === "auto") return { fps: 0, capped: false };
    const want = Number(state.txFps);
    if (cap.fpsMax && want > cap.fpsMax) {
      return { fps: Math.round(cap.fpsMax), capped: true, wanted: want };
    }
    return { fps: want, capped: false, wanted: want };
  }

  /* aplica FPS/resolução NA CAPTURA (applyConstraints) */
  async function txApplyTrack(track) {
    if (!track || typeof track.applyConstraints !== "function") return false;
    const fps = txFpsChoice();
    const res = txResChoice();
    const c = {};
    if (fps.fps) c.frameRate = { ideal: fps.fps, max: fps.fps };
    if (res.w) { c.width = { ideal: res.w }; c.height = { ideal: res.h }; }

    /* contentHint: modo jogo pede fluidez, texto/presentação pede nitidez */
    try {
      track.contentHint = state.txGame ? "motion" : (state.txQuality === "alta" ? "detail" : "motion");
    } catch (e) {}

    if (!Object.keys(c).length) return true;
    try {
      await track.applyConstraints(c);
      return true;
    } catch (e) {
      /* nem toda faixa aceita tudo: tenta só o FPS, depois só a resolução */
      const tries = [];
      if (c.frameRate) tries.push({ frameRate: c.frameRate });
      if (c.width) tries.push({ width: c.width, height: c.height });
      for (let i = 0; i < tries.length; i++) {
        try { await track.applyConstraints(tries[i]); return true; } catch (e2) {}
      }
      state.txErr = (e && e.message) || "applyConstraints";
      return false;
    }
  }

  /* aplica taxa e estratégia de degradação NO ENVIO (setParameters) */
  async function txApplySender(sender) {
    if (!sender || typeof sender.setParameters !== "function") return false;
    let p;
    try { p = sender.getParameters(); } catch (e) { return false; }
    if (!p) return false;
    const q = TX_QUALITY[state.txQuality] || TX_QUALITY.equilibrada;
    const kbps = state.txBitrateKbps > 0
      ? state.txBitrateKbps
      : (state.txGame ? Math.max(q.kbps, 3000) : q.kbps);
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    p.encodings[0].maxBitrate = Math.max(TX_BIT_MIN, Math.min(kbps, TX_BIT_MAX)) * 1000;
    const degr = state.txGame ? "maintain-framerate" : q.degr;
    try {
      p.degradationPreference = degr;
      await sender.setParameters(p);
      return true;
    } catch (e) {
      /* alguns navegadores recusam degradationPreference: repete sem ele */
      try {
        delete p.degradationPreference;
        await sender.setParameters(p);
        return true;
      } catch (e2) {
        state.txErr = (e2 && e2.message) || "setParameters";
        return false;
      }
    }
  }

  /* senders de vídeo: 1:1 (state.pc) e sala (camSender/screenSender) */
  function txVideoSenders() {
    const list = [];
    if (state.pc && state.pc.getSenders) {
      state.pc.getSenders().forEach(function (s) {
        if (s.track && s.track.kind === "video") list.push(s);
      });
    }
    if (state.room) {
      Object.keys(state.room.members).forEach(function (id) {
        const m = state.room.members[id];
        if (!m) return;
        ["camSender", "screenSender"].forEach(function (k) {
          if (m[k] && (!m[k].track || m[k].track.kind === "video")) list.push(m[k]);
        });
      });
    }
    return list;
  }

  /* aplica a configuração atual em TUDO que está transmitindo */
  async function txApplyAll() {
    const tracks = txOutgoingVideoTracks();
    const senders = txVideoSenders();
    const res = { tracks: 0, trackTotal: tracks.length, senders: 0, senderTotal: senders.length };
    for (let i = 0; i < tracks.length; i++) {
      if (await txApplyTrack(tracks[i].track)) res.tracks++;
    }
    for (let j = 0; j < senders.length; j++) {
      if (await txApplySender(senders[j])) res.senders++;
    }
    state.txApplied =
      res.tracks + "/" + res.trackTotal + " " + t("call.tx.faixas", "faixas") +
      " · " + res.senders + "/" + res.senderTotal + " " + t("call.tx.envios", "envios");
    txEvaluate();
    paintTx();
    return res;
  }

  /* lê estatísticas REAIS de todas as conexões ativas */
  async function txSnapshot() {
    const pcs = [];
    if (state.pc) pcs.push(state.pc);
    if (state.room) {
      Object.keys(state.room.members).forEach(function (id) {
        const m = state.room.members[id];
        if (m && m.pc) pcs.push(m.pc);
      });
    }

    const cap = [];
    txOutgoingVideoTracks().forEach(function (o) {
      let s = null;
      try { s = o.track.getSettings ? o.track.getSettings() : null; } catch (e) {}
      cap.push({
        source: o.source,
        fps: s && s.frameRate ? Math.round(s.frameRate) : null,
        w: (s && s.width) || null,
        h: (s && s.height) || null
      });
    });

    const enc = [];
    const dec = [];
    let rtt = null;
    let aob = null;
    let bytesSent = 0;

    for (let i = 0; i < pcs.length; i++) {
      let reports;
      try { reports = await pcs[i].getStats(); } catch (e) { continue; }
      if (!reports || !reports.forEach) continue;
      reports.forEach(function (r) {
        if (!r || !r.type) return;
        if (r.type === "outbound-rtp" && r.kind === "video" && !r.isRemote) {
          /* descarta linha ociosa (sem quadros e sem dimensão): ela só
             poluiria a leitura com "— FPS" ao lado do número real */
          if (r.framesPerSecond == null && r.frameWidth == null) return;
          enc.push({
            fps: r.framesPerSecond != null ? Math.round(r.framesPerSecond) : null,
            w: r.frameWidth || null,
            h: r.frameHeight || null,
            limitation: r.qualityLimitationReason || null
          });
          bytesSent += Number(r.bytesSent) || 0;
        } else if (r.type === "inbound-rtp" && r.kind === "video" && !r.isRemote) {
          if (r.framesPerSecond == null && r.frameWidth == null) return;
          dec.push({
            fps: r.framesPerSecond != null ? Math.round(r.framesPerSecond) : null,
            w: r.frameWidth || null,
            h: r.frameHeight || null
          });
        } else if (r.type === "candidate-pair" && (r.state === "succeeded" || r.nominated)) {
          if (r.currentRoundTripTime != null) {
            rtt = Math.max(rtt == null ? 0 : rtt, r.currentRoundTripTime);
          }
          if (r.availableOutgoingBitrate != null) {
            aob = Math.max(aob == null ? 0 : aob, r.availableOutgoingBitrate);
          }
        }
      });
    }

    const prev = state.txLast;
    const kbps = prev && bytesSent >= prev.bytesSent
      ? Math.round(((bytesSent - prev.bytesSent) * 8) / Math.max(1, (Date.now() - prev.at) / 1000) / 1000)
      : null;

    return {
      at: Date.now(), cap: cap, enc: enc, dec: dec,
      rtt: rtt, aob: aob, bytesSent: bytesSent, kbps: kbps
    };
  }

  /* avalia e gera avisos HONESTOS (o painel nunca promete o que não há) */
  function txEvaluate() {
    const w = [];
    const cap = txCeiling();
    const fps = txFpsChoice();
    const res = txResChoice();
    const hasVideo = txOutgoingVideoTracks().length > 0;

    /* teto do dispositivo: avisa SEMPRE que existem opções desabilitadas,
       mesmo antes de a pessoa escolher — é o aviso que explica o "não
       suportado" que aparece ao lado de 60/120 */
    if (cap.fpsMax > 0 && cap.fpsMax < 120) {
      if (fps.capped && fps.wanted) {
        w.push({
          k: "fps",
          m: t("call.tx.fpsLimit",
            "Este dispositivo/navegador captura no máximo " + fps.fps +
            " FPS. O pedido de " + fps.wanted + " FPS foi ajustado para o teto real.")
        });
      } else {
        w.push({
          k: "fps",
          m: t("call.tx.fpsCeiling",
            "Este dispositivo/navegador captura no máximo " + Math.round(cap.fpsMax) +
            " FPS. Por isso as opções acima disso ficam desabilitadas e a Automática " +
            "escolhe o melhor ritmo que a captura aceita.")
        });
      }
    } else if (fps.capped && fps.wanted) {
      w.push({
        k: "fps",
        m: t("call.tx.fpsLimit",
          "Este dispositivo/navegador captura no máximo " + fps.fps +
          " FPS. O pedido de " + fps.wanted + " FPS foi ajustado para o teto real.")
      });
    }
    if (res.capped) {
      w.push({
        k: "res",
        m: t("call.tx.resLimit",
          "A captura disponível chega no máximo a " + res.w + "×" + res.h +
          ". A resolução foi ajustada ao que o dispositivo aceita.")
      });
    }
    if (hasVideo && cap.fpsMax === 0) {
      w.push({
        k: "nocaps",
        m: t("call.tx.noCaps",
          "Este navegador não informa as capacidades da captura. As opções foram aplicadas, " +
          "mas o teto real de FPS/resolução só aparece nas estatísticas abaixo.")
      });
    }
    if (!hasVideo) {
      w.push({
        k: "novideo",
        m: t("call.tx.noVideo",
          "Nenhuma câmera ou tela está sendo transmitida agora. As opções ficam guardadas " +
          "e são aplicadas assim que a transmissão começar.")
      });
    }

    const s = state.txLast;
    if (s && hasVideo) {
      const lim = {};
      s.enc.forEach(function (e) { if (e.limitation) lim[e.limitation] = 1; });
      if (lim.cpu) {
        w.push({
          k: "cpu",
          m: t("call.tx.cpuLimit",
            "A CPU não está dando conta de codificar no ritmo pedido. Reduza a resolução ou o FPS.")
        });
      }
      if (lim.bandwidth) {
        w.push({
          k: "bw",
          m: t("call.tx.bwLimit",
            "A conexão limitou a taxa de envio. A qualidade foi reduzida automaticamente pelo navegador.")
        });
      }
      if (s.aob != null && state.txBitrateKbps > 0 && s.aob < state.txBitrateKbps * 1000) {
        w.push({
          k: "aob",
          m: t("call.tx.aobLimit",
            "A conexão estima apenas ~" + Math.round(s.aob / 1000) +
            " kbps disponíveis. O limite pedido (" + state.txBitrateKbps + " kbps) não será atingido.")
        });
      }
      if (s.rtt != null && s.rtt > 0.4) {
        w.push({
          k: "rtt",
          m: t("call.tx.rttLimit",
            "Latência de ~" + Math.round(s.rtt * 1000) + " ms. Chamadas em rede restrita podem precisar de um servidor TURN, que o Nexo ainda não possui.")
        });
      }
    }

    state.txWarns = w;
    return w;
  }

  /* ---------------- painel ---------------- */

  /* rótulo de conexão CORRETO para o contexto: na sala de voz o estado
     real mora em roomHeaderConn() (membros/pares); na chamada 1:1 mora
     em state.connection. Usar connLabel() na sala mostrava "Aguardando
     conexão…" mesmo com todo mundo conectado. */
  function txConnLabel() {
    if (state.room) return roomHeaderConn() || connLabel();
    return connLabel();
  }

  function txOpt(v, cur, label, disabled) {
    return (
      '<option value="' + hh(v) + '"' + (String(cur) === String(v) ? " selected" : "") +
      (disabled ? " disabled" : "") + ">" + hh(label) + (disabled ? " — " + t("call.tx.naoSuportado", "não suportado") : "") +
      "</option>"
    );
  }

  function txHTML() {
    const cap = txCeiling();
    const fps = txFpsChoice();
    const res = txResChoice();
    const q = TX_QUALITY[state.txQuality] || TX_QUALITY.equilibrada;
    const bitrate = state.txBitrateKbps > 0 ? state.txBitrateKbps : (state.txGame ? Math.max(q.kbps, 3000) : q.kbps);
    const s = state.txLast;

    /* 120 só aparece se o teto real cobrir (ou se ainda não sabemos) */
    const fps120Off = cap.fpsMax > 0 && cap.fpsMax < 120;
    const fps60Off = cap.fpsMax > 0 && cap.fpsMax < 60;

    const resOpts = TX_RES.map(function (r) {
      const off = cap.wMax > 0 && r.w > cap.wMax;
      return txOpt(r.v, state.txRes, r.v + "p (" + r.w + "×" + r.h + ")", off);
    }).join("");

    const capFps = cap.fpsMax ? Math.round(cap.fpsMax) + " FPS" : t("call.tx.desconhecido", "desconhecido");
    const capRes = cap.wMax ? cap.wMax + "×" + cap.hMax : t("call.tx.desconhecido", "desconhecido");

    const warnings = state.txWarns.length
      ? '<div class="tx__warns">' + state.txWarns.map(function (x) {
          return '<p class="call-warn" data-tx-warn="' + hh(x.k) + '">' + hh(x.m) + "</p>";
        }).join("") + "</div>"
      : "";

    return (
      '<div class="av tx">' +
      '<header class="tx__head"><strong>' + NX.icon("monitor", "", 16) + " " +
      t("call.tx.titulo", "Transmissão") + "</strong>" +
      '<button type="button" class="av__x" data-call="av-close" aria-label="' + t("call.fechar", "Fechar") + '">' +
      NX.icon("x", "", 16) + "</button></header>" +

      '<div class="av__body tx__body">' +

      /* faixa compacta: a leitura de FPS sem precisar rolar */
      '<section class="tx__sec tx__live" aria-label="' + t("call.tx.leitura", "Leitura ao vivo da transmissão") + '">' +
      '<div class="tx__tiles">' +
      '<div class="tx__tile"><small>' + t("call.tx.capturado", "Capturado") + "</small>" +
      '<strong data-tx-cap>—</strong></div>' +
      '<div class="tx__tile"><small>' + t("call.tx.codificadoCurto", "Enviado") + "</small>" +
      '<strong data-tx-enc>—</strong></div>' +
      '<div class="tx__tile"><small>' + t("call.tx.recebido", "Recebido") + "</small>" +
      '<strong data-tx-dec>—</strong></div>' +
      '<div class="tx__tile"><small>' + t("call.tx.conexao", "Conexão") + "</small>" +
      '<strong data-tx-conn>—</strong></div>' +
      "</div>" +
      "</section>" +

      '<section class="tx__sec">' +
      '<label class="tx__field"><span>' + t("call.tx.fps", "Taxa de quadros") + "</span>" +
      '<select class="select select--sm" data-tx-fps>' +
      txOpt("auto", state.txFps, t("call.tx.auto", "Automática")) +
      txOpt(30, state.txFps, "30 FPS") +
      txOpt(60, state.txFps, "60 FPS", fps60Off) +
      txOpt(120, state.txFps, "120 FPS", fps120Off) +
      "</select></label>" +

      '<label class="tx__field"><span>' + t("call.tx.res", "Resolução") + "</span>" +
      '<select class="select select--sm" data-tx-res>' + resOpts + "</select></label>" +

      '<label class="tx__field"><span>' + t("call.tx.qualidade", "Qualidade") + "</span>" +
      '<select class="select select--sm" data-tx-quality>' +
      txOpt("eco", state.txQuality, t("call.tx.eco", "Economia")) +
      txOpt("equilibrada", state.txQuality, t("call.tx.equilibrada", "Equilibrada")) +
      txOpt("alta", state.txQuality, t("call.tx.alta", "Alta")) +
      "</select></label>" +

      '<div class="tx__field"><span>' + t("call.tx.bitrate", "Taxa de bits") +
      ' <small data-tx-bitval>' + bitrate + " kbps</small></span>" +
      '<input type="range" min="' + TX_BIT_MIN + '" max="' + TX_BIT_MAX + '" step="50" value="' +
      Math.max(TX_BIT_MIN, Math.min(bitrate, TX_BIT_MAX)) + '" data-tx-bitrate' +
      ' aria-label="' + t("call.tx.bitrate", "Taxa de bits") + '">' +
      '<small class="tx__hint">' + t("call.tx.bitrange", "Limite seguro de 150 kbps a 20 Mbps.") + "</small></div>" +

      '<label class="call-switch"><input type="checkbox" data-tx-game' + (state.txGame ? " checked" : "") +
      " /><span>" + t("call.tx.game", "Modo Jogatina (prioriza fluidez)") + "</span></label>" +

      '<p class="tx__hint">' + t("call.tx.gpuNota",
        "O Nexo usa a captura de tela do navegador. Ele não captura a GPU nem um jogo específico.") + "</p>" +
      "</section>" +

      '<section class="tx__sec">' +
      '<h4 class="tx__h">' + t("call.tx.estatisticas", "Estatísticas reais") + "</h4>" +
      '<dl class="tx__stats">' +
      '<div><dt>' + t("call.tx.capturado", "Capturado") + "</dt>" +
      '<dd data-tx-cap>' + (s && s.cap.length
        ? s.cap.map(function (c) { return (c.fps != null ? c.fps : "—") + " FPS"; }).join(" · ")
        : "—") + "</dd></div>" +
      '<div><dt>' + t("call.tx.codificado", "Codificado (enviado)") + "</dt>" +
      '<dd data-tx-enc>' + (s && s.enc.length
        ? s.enc.map(function (e) { return (e.fps != null ? e.fps : "—") + " FPS"; }).join(" · ")
        : "—") + "</dd></div>" +
      '<div><dt>' + t("call.tx.recebido", "Recebido") + "</dt>" +
      '<dd data-tx-dec>' + (s && s.dec.length
        ? s.dec.map(function (d) { return (d.fps != null ? d.fps : "—") + " FPS"; }).join(" · ")
        : "—") + "</dd></div>" +
      '<div><dt>' + t("call.tx.resolucaoAtual", "Resolução atual") + "</dt>" +
      '<dd data-tx-resnow>' + (s && s.cap.length && s.cap[0].w
        ? s.cap.map(function (c) { return c.w + "×" + c.h; }).join(" · ")
        : "—") + "</dd></div>" +
      '<div><dt>' + t("call.tx.envioMedido", "Envio medido") + "</dt>" +
      '<dd data-tx-kbps>' + (s && s.kbps != null ? "~" + s.kbps + " kbps" : "—") + "</dd></div>" +
      '<div><dt>' + t("call.tx.latencia", "Latência") + "</dt>" +
      '<dd data-tx-rtt>' + (s && s.rtt != null ? Math.round(s.rtt * 1000) + " ms" : "—") + "</dd></div>" +
      '<div><dt>' + t("call.tx.conexao", "Conexão") + "</dt>" +
      '<dd data-tx-conn>' + hh(txConnLabel()) + "</dd></div>" +
      "</dl>" +
      '<p class="tx__hint"><strong>' + t("call.tx.tetoReal", "Teto real do dispositivo:") + "</strong> " +
      hh(capFps) + " · " + hh(capRes) + "</p>" +
      '<p class="tx__hint" data-tx-applied>' +
      (state.txApplied ? t("call.tx.aplicado", "Aplicado: ") + hh(state.txApplied) : "") + "</p>" +
      (state.txErr ? '<p class="call-warn">' + t("call.tx.erro", "O navegador recusou: ") + hh(state.txErr) + "</p>" : "") +
      "</section>" +

      "</div>" + warnings + "</div>"
    );
  }

  /* repinta SÓ os números, sem re-render da chamada (e sem piscar) */
  function paintTx() {
    const pop = state.root && state.root.querySelector("[data-call-pop]");
    if (!pop || pop.dataset.open !== "tx") return;
    const s = state.txLast;
    /* atualiza TODOS os nós com aquele atributo (a faixa compacta do
       topo e a tabela detalhada compartilham os mesmos data-tx-*) */
    const set = function (sel, val) {
      const nodes = pop.querySelectorAll(sel);
      for (let i = 0; i < nodes.length; i++) nodes[i].textContent = val;
    };
    set("[data-tx-cap]", s && s.cap.length ? s.cap.map(function (c) { return (c.fps != null ? c.fps : "—") + " FPS"; }).join(" · ") : "—");
    set("[data-tx-enc]", s && s.enc.length ? s.enc.map(function (e) { return (e.fps != null ? e.fps : "—") + " FPS"; }).join(" · ") : "—");
    set("[data-tx-dec]", s && s.dec.length ? s.dec.map(function (d) { return (d.fps != null ? d.fps : "—") + " FPS"; }).join(" · ") : "—");
    set("[data-tx-resnow]", s && s.cap.length && s.cap[0].w ? s.cap.map(function (c) { return c.w + "×" + c.h; }).join(" · ") : "—");
    set("[data-tx-kbps]", s && s.kbps != null ? "~" + s.kbps + " kbps" : "—");
    set("[data-tx-rtt]", s && s.rtt != null ? Math.round(s.rtt * 1000) + " ms" : "—");
    set("[data-tx-conn]", txConnLabel());

    /* avisos: só recria quando a lista mudou (evita piscar) */
    const key = state.txWarns.map(function (x) { return x.k; }).join(",");
    const box = pop.querySelector(".tx__warns");
    const holder = pop.querySelector(".tx");
    if (holder && holder.dataset.txWarnKey !== key) {
      holder.dataset.txWarnKey = key;
      let w = pop.querySelector(".tx__warns");
      if (!w && state.txWarns.length) {
        w = document.createElement("div");
        w.className = "tx__warns";
        holder.appendChild(w);
      }
      if (w) {
        if (state.txWarns.length) {
          w.innerHTML = state.txWarns.map(function (x) {
            return '<p class="call-warn" data-tx-warn="' + hh(x.k) + '">' + hh(x.m) + "</p>";
          }).join("");
        } else {
          w.innerHTML = "";
        }
      }
      void box;
    }
  }

  async function txTick() {
    try {
      state.txPrev = state.txLast;
      state.txLast = await txSnapshot();
      txEvaluate();
      paintTx();
    } catch (e) {
      /* getStats indisponível: painel continua, só sem números */
    }
  }

  function txStartStats() {
    txStopStats();
    state.txLast = null;
    txTick();
    /* 2s: suficiente para ver FPS cair/subir sem gastar CPU.
       No modo Jogatina lemos um pouco mais devagar de propósito. */
    state.txTimer = setInterval(txTick, state.txGame ? 3000 : 2000);
  }

  function txStopStats() {
    if (state.txTimer) {
      clearInterval(state.txTimer);
      state.txTimer = null;
    }
  }

  /* abre o painel: aplica a configuração e começa a medir */
  async function txOpenPanel() {
    txEvaluate();
    await txApplyAll();
    txStartStats();
  }

  /* ao mudar qualquer controle: reaplica e reavalia sem fechar o painel */
  async function txChanged() {
    txEvaluate();
    await txApplyAll();
  }

  function bindTx(pop) {
    const fpsSel = pop.querySelector("[data-tx-fps]");
    const resSel = pop.querySelector("[data-tx-res]");
    const qSel = pop.querySelector("[data-tx-quality]");
    const bit = pop.querySelector("[data-tx-bitrate]");
    const game = pop.querySelector("[data-tx-game]");

    if (fpsSel) {
      fpsSel.addEventListener("change", function () {
        state.txFps = fpsSel.value;
        txChanged();
      });
    }
    if (resSel) {
      resSel.addEventListener("change", function () {
        state.txRes = resSel.value;
        txChanged();
      });
    }
    if (qSel) {
      qSel.addEventListener("change", function () {
        state.txQuality = qSel.value;
        const q = TX_QUALITY[state.txQuality] || TX_QUALITY.equilibrada;
        state.txBitrateKbps = 0; /* volta a seguir o preset */
        const b = pop.querySelector("[data-tx-bitrate]");
        const bv = pop.querySelector("[data-tx-bitval]");
        if (b) b.value = q.kbps;
        if (bv) bv.textContent = q.kbps + " kbps";
        txChanged();
      });
    }
    if (bit) {
      bit.addEventListener("input", function () {
        state.txBitrateKbps = Number(bit.value);
        const bv = pop.querySelector("[data-tx-bitval]");
        if (bv) bv.textContent = bit.value + " kbps";
        txChanged();
      });
    }
    if (game) {
      game.addEventListener("change", function () {
        state.txGame = game.checked;
        txStartStats(); /* o intervalo muda no modo jogo */
        txChanged();
      });
    }
  }

  NX.call = {
    start: start,
    preview: preview,
    enter: enterCall,
    cancel: cancelLobby,
    recover: recover,
    accept: accept,
    decline: decline,
    hangup: hangup,
    end: end,
    toggleMic: toggleMic,
    toggleCam: toggleCam,
    toggleScreen: toggleScreen,
    stopScreen: function () {
      return stopScreenShare(false);
    },
    stopScreenAudio: stopScreenAudio,
    setVolume: setVolume,
    setMicDevice: setMicDevice,
    setCamDevice: setCamDevice,
    setOutDevice: setOutDevice,
    openSettings: function () {
      return openPopover("settings");
    },
    /* --- transmissão: qualidade/FPS aplicados e medidos de verdade --- */
    openTx: function () {
      return openPopover("tx");
    },
    txState: function () {
      return {
        fps: state.txFps,
        res: state.txRes,
        quality: state.txQuality,
        bitrateKbps: state.txBitrateKbps,
        game: state.txGame,
        ceiling: txCeiling(),
        applied: state.txApplied,
        err: state.txErr,
        warns: state.txWarns.map(function (w) { return w.k; }),
        stats: state.txLast
      };
    },
    txSet: function (patch) {
      if (!patch || typeof patch !== "object") return;
      if (patch.fps != null) state.txFps = String(patch.fps);
      if (patch.res != null) state.txRes = String(patch.res);
      if (patch.quality != null) state.txQuality = String(patch.quality);
      if (patch.bitrateKbps != null) state.txBitrateKbps = Math.max(TX_BIT_MIN, Math.min(Number(patch.bitrateKbps) || 0, TX_BIT_MAX));
      if (patch.game != null) state.txGame = !!patch.game;
      return txChanged();
    },
    txApply: txApplyAll,
    txStats: txSnapshot,
    /* testes reais de dispositivo (a mesma lógica do painel) */
    testMicrophone: startMicTest,
    testCamera: startCamTest,
    stopTests: stopTests,
    listDevices: function (kind) {
      return listDevices(kind);
    },
    testOutput: testAudio,
    isActive: function () {
      return state.phase === "active";
    },
    state: function () {
      return {
        phase: state.phase,
        call: state.call,
        peer: state.peer,
        mic: state.mic,
        cam: state.cam,
        screen: state.screen,
        screenAudio: state.screenAudio,
        volume: state.volume,
        connection: state.connection,
        room: roomState(),
        seconds: state.call && state.call.answeredAt ? Math.floor((Date.now() - state.call.answeredAt) / 1000) : 0,
      };
    },
    /* estado REAL das tracks: o que está saindo e o que está chegando
       (usado para conferir se a mídia está mesmo fluindo) */
    tracks: function () {
      const pc = state.pc;
      const out = { send: [], recv: [] };
      if (pc) {
        pc.getSenders().forEach(function (s) {
          const tr = s.track;
          out.send.push({
            kind: tr ? tr.kind : "vazio",
            live: !!(tr && tr.readyState === "live"),
            muted: !!(tr && tr.muted),
            enabled: tr ? tr.enabled !== false : false,
            source: tr ? tr._nxSource || "local" : "-",
          });
        });
      }
      if (state.remoteStream) {
        state.remoteStream.getTracks().forEach(function (tr) {
          out.recv.push({
            kind: tr.kind,
            live: tr.readyState === "live",
            muted: !!tr.muted,
            enabled: tr.enabled !== false,
          });
        });
      }
      return out;
    },
    stopPolling: stopPolling,
    /* ---- salas de voz do servidor (mesmo sistema de chamadas) ---- */
    joinRoom: joinRoom,
    leaveRoom: leaveRoom,
    roomState: roomState,
    roomTracks: roomTracks,
    recoverRoom: function () {
      return recoverRoom();
    },
    inRoom: function (channelId) {
      if (!state.room) return false;
      return channelId ? state.room.channelId === channelId : true;
    },
    restoreRoom: function () {
      if (!state.room) return false;
      state.room.minimized = false;
      bus("call:roomstate", { channelId: state.room.channelId, minimized: false });
      renderRoom();
      return true;
    },
    /* nova tentativa REAL de mídia ("Tentar novamente" do aviso/dock) */
    retryMedia: function (silent) {
      return retryMedia(silent);
    },
    peek: poll,
  };

  /* acompanha mudança de permissão no navegador (configurações do site):
     concedido de verdade → tenta capturar e o aviso só sai com track */
  try {
    watchPermChanges();
  } catch (e) {}
})(window.NX);
