/* ============================================================
   NEXO · chamadas WebRTC (1:1)
   Áudio e vídeo REAIS entre duas pessoas: RTCPeerConnection,
   getUserMedia e getDisplayMedia. Nada é simulado: quando a
   permissão falha, a chamada conecta mesmo assim (sinalização)
   e a tela mostra somente o avatar + aviso em pt-BR.
   A sinalização (offer/answer/candidate/bye) sai por
   NX.api.sendSignal e chega pelo polling de NX.api.peekCalls.
   Camada independente — pode carregar antes ou depois dos
   demais módulos; todos os acessos são defensivos.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  /* =========================================================
     1 · utilitários locais (defensivos)
     ========================================================= */

  function h(s) {
    return NX.util && NX.util.h ? NX.util.h(s) : String(s == null ? "" : s);
  }

  function t(key, fb) {
    return NX.i18n && NX.i18n.get ? NX.i18n.get(key, fb) : fb;
  }

  function el(html) {
    if (NX.util && NX.util.el) return NX.util.el(html);
    var d = document.createElement("div");
    d.innerHTML = String(html).trim();
    return d.firstElementChild;
  }

  function ico(name, size) {
    return typeof NX.icon === "function" ? NX.icon(name, "", size || 18) : "✕";
  }

  function emit(type, payload) {
    if (NX.bus && NX.bus.emit) {
      try {
        NX.bus.emit(type, payload);
      } catch (e) {
        console.error("[call:bus]", type, e);
      }
    }
  }

  /* som sempre OPCIONAL: outro módulo pode fornecer NX.sfx */
  function sfx(name) {
    if (NX.sfx && typeof NX.sfx.play === "function") {
      try {
        NX.sfx.play(name);
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  function toast(msg, kind) {
    if (NX.ui && NX.ui.toast) NX.ui.toast(msg, kind || "info");
  }

  function api(name) {
    return NX.api && typeof NX.api[name] === "function" ? NX.api[name].bind(NX.api) : null;
  }

  function sel(name) {
    return NX.selectors && NX.selectors[name] ? NX.selectors[name] : null;
  }

  function me() {
    var f = sel("me");
    try {
      return f ? f() : null;
    } catch (e) {
      return null;
    }
  }

  function userOf(id) {
    var f = sel("user");
    if (!id || !f) return null;
    try {
      return f(id) || null;
    } catch (e) {
      return null;
    }
  }

  function avatarHTML(user, size, withStatus) {
    if (NX.util && NX.util.avatarHTML) return NX.util.avatarHTML(user, size, withStatus);
    return "";
  }

  function pad(n) {
    return String(n).length < 2 ? "0" + n : String(n);
  }

  function fmtDur(sec) {
    var s = Math.max(0, Math.floor(Number(sec) || 0));
    return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor((s % 3600) / 60)) + ":" + pad(s % 60);
  }

  /* =========================================================
     2 · preferências (volume, dispositivos, processamento)
     ========================================================= */

  var PREF_KEY = "nexo.call.prefs";
  var prefs = {
    volume: 1,
    micId: "",
    camId: "",
    outId: "",
    ec: true,
    ns: true,
    agc: true,
  };

  try {
    var saved = NX.storage && NX.storage.get ? NX.storage.get(PREF_KEY, null) : null;
    if (saved && typeof saved === "object") {
      Object.keys(prefs).forEach(function (k) {
        if (saved[k] !== undefined) prefs[k] = saved[k];
      });
    }
  } catch (e) {
    /* sem armazenamento: segue com os padrões */
  }

  function savePrefs() {
    try {
      if (NX.storage && NX.storage.set) NX.storage.set(PREF_KEY, prefs);
    } catch (e) {}
  }

  /* =========================================================
     3 · estado
     ========================================================= */

  var CALL_TIMEOUT_MS = 45000;
  var STUN = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

  var media = {
    audio: null,
    video: null,
    screen: null,
    screenStream: null,
    local: null,
    micOn: true,
    wantCam: true,
    micError: null,
    camError: null,
    screenError: null,
  };

  var rtc = {
    pc: null,
    senders: {},
    remoteCamMuted: true,
    makingOffer: false,
    ignoreOffer: false,
    pending: [],
    negotiated: false,
  };

  var callState = {
    phase: "idle", /* idle | outgoing | incoming | active | ended */
    call: null,
    peer: null,
    role: null,
    incoming: null,
    answeredAt: 0,
    startedAt: 0,
    busy: false,
    warned: {},
    endReason: null,
    endBy: null,
  };

  var peers = {};
  var timers = { miss: null, tick: null, end: null, nego: null };
  var ui = { root: null, card: null, overlay: null };

  function phase() {
    return callState.phase;
  }

  function localStream() {
    if (!media.local && typeof window.MediaStream === "function") media.local = new MediaStream();
    return media.local;
  }

  function elapsed() {
    if (callState.phase === "active" && callState.answeredAt)
      return (Date.now() - callState.answeredAt) / 1000;
    return 0;
  }

  function isFinished(state) {
    return state === "ended" || state === "declined" || state === "missed";
  }

  function polite() {
    return callState.role === "callee";
  }

  function hasMedia() {
    return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
  }

  function sinkSupported() {
    return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
  }

  /* =========================================================
     4 · toque de chamada (só se NX.sfx não existir)
     ========================================================= */

  var ring = { ctx: null, timer: null };

  function ringTone(freq, at, dur, vol) {
    var ctx = ring.ctx;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.02);
    g.gain.setValueAtTime(vol, at + Math.max(0.05, dur - 0.06));
    g.gain.linearRampToValueAtTime(0, at + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  function ringStart(kind) {
    if (sfx("call_ringing")) return; /* módulo de som do app assumiu */
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!ring.ctx) ring.ctx = new AC();
      if (ring.ctx.state === "suspended" && ring.ctx.resume) ring.ctx.resume();
      ringStop();
      var play = function () {
        if (!ring.ctx) return;
        var now = ring.ctx.currentTime;
        if (kind === "in") {
          ringTone(880, now, 0.35, 0.1);
          ringTone(660, now + 0.45, 0.35, 0.1);
        } else {
          ringTone(425, now, 0.4, 0.05);
          ringTone(475, now + 0.5, 0.4, 0.05);
        }
      };
      play();
      ring.timer = setInterval(play, 2600);
    } catch (e) {
      /* sem áudio disponível: segue sem toque */
    }
  }

  function ringStop() {
    if (ring.timer) {
      clearInterval(ring.timer);
      ring.timer = null;
    }
  }

  /* =========================================================
     5 · mídia local (getUserMedia / getDisplayMedia)
     ========================================================= */

  function audioCons() {
    return {
      echoCancellation: prefs.ec !== false,
      noiseSuppression: prefs.ns !== false,
      autoGainControl: prefs.agc !== false,
      deviceId: prefs.micId ? { exact: prefs.micId } : undefined,
    };
  }

  function videoCons() {
    return {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      deviceId: prefs.camId ? { exact: prefs.camId } : undefined,
    };
  }

  function mediaErrText(err, kind) {
    var name = (err && err.name) || "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError")
      return kind === "mic"
        ? t("call.micNegado", "Permissão do microfone negada. A chamada segue sem áudio do seu lado.")
        : t("call.camNegado", "Permissão da câmera negada. A chamada segue sem vídeo do seu lado.");
    if (name === "NotFoundError" || name === "DevicesNotFoundError")
      return kind === "mic"
        ? t("call.micNenhum", "Nenhum microfone encontrado neste aparelho.")
        : t("call.camNenhuma", "Nenhuma câmera encontrada neste aparelho.");
    if (name === "NotReadableError" || name === "TrackStartError")
      return t("call.deviceOcupado", "O dispositivo está sendo usado por outro aplicativo.");
    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError")
      return t("call.deviceIndisponivel", "O dispositivo selecionado não está disponível agora.");
    if (name === "NotSupportedError" || name === "TypeError" || name === "InvalidStateError")
      return t("call.mediaIndisponivel", "Este navegador não permite acesso à câmera e ao microfone nesta conexão.");
    return kind === "mic"
      ? t("call.micFalhou", "Não foi possível acessar o microfone.")
      : t("call.camFalhou", "Não foi possível acessar a câmera.");
  }

  /* aviso honeste: banner dentro da chamada + toast, uma vez por chamada */
  function warnMedia(msg) {
    if (!msg) return;
    if (callState.warned[msg]) return;
    callState.warned[msg] = true;
    setBanner(msg);
    toast(msg, "warn");
  }

  function setBanner(msg) {
    if (!ui.overlay) return;
    var b = ui.overlay.querySelector("[data-call-banner]");
    var txt = ui.overlay.querySelector("[data-call-banner-txt]");
    if (!b || !txt) return;
    if (!msg) {
      b.hidden = true;
      txt.textContent = "";
      return;
    }
    b.hidden = false;
    txt.textContent = msg;
  }

  function localStreamAdd(track) {
    var st = localStream();
    if (!st || !track) return;
    var cur = st.getTracks();
    for (var i = 0; i < cur.length; i++) if (cur[i] === track) return;
    try {
      st.addTrack(track);
    } catch (e) {}
  }

  function localStreamRemove(kind) {
    var st = localStream();
    if (!st) return;
    st.getTracks().forEach(function (tr) {
      if (tr.kind === kind) {
        try {
          st.removeTrack(tr);
        } catch (e) {}
      }
    });
  }

  function ensureAudio() {
    if (!hasMedia()) {
      media.audio = null;
      media.micOn = false;
      media.micError = t(
        "call.mediaIndisponivel",
        "Este navegador não permite acesso à câmera e ao microfone nesta conexão."
      );
      warnMedia(media.micError);
      renderOverlay();
      return Promise.resolve(null);
    }
    if (media.audio && media.audio.readyState === "live") {
      media.audio.enabled = media.micOn;
      media.micError = null;
      return Promise.resolve(media.audio);
    }
    return navigator.mediaDevices
      .getUserMedia({ audio: audioCons(), video: false })
      .then(function (stream) {
        media.audio = stream.getAudioTracks()[0] || null;
        media.micError = null;
        if (media.audio) media.audio.enabled = media.micOn;
        localStreamAdd(media.audio);
        publishLocal("audio", media.audio);
        refreshDevices();
        renderOverlay();
        return media.audio;
      })
      .catch(function (err) {
        media.audio = null;
        media.micOn = false;
        media.micError = mediaErrText(err, "mic");
        warnMedia(media.micError);
        renderOverlay();
        return null;
      });
  }

  function ensureVideo() {
    if (!hasMedia()) {
      media.video = null;
      media.wantCam = false;
      media.camError = t(
        "call.mediaIndisponivel",
        "Este navegador não permite acesso à câmera e ao microfone nesta conexão."
      );
      warnMedia(media.camError);
      renderOverlay();
      return Promise.resolve(null);
    }
    if (media.video && media.video.readyState === "live") {
      media.wantCam = true;
      media.camError = null;
      return Promise.resolve(media.video);
    }
    return navigator.mediaDevices
      .getUserMedia({ audio: false, video: videoCons() })
      .then(function (stream) {
        media.video = stream.getVideoTracks()[0] || null;
        media.camError = null;
        media.wantCam = !!media.video;
        localStreamRemove("video");
        localStreamAdd(media.video);
        publishLocal("video", videoOutTrack());
        refreshDevices();
        renderOverlay();
        return media.video;
      })
      .catch(function (err) {
        media.video = null;
        media.wantCam = false;
        media.camError = mediaErrText(err, "cam");
        warnMedia(media.camError);
        renderOverlay();
        return null;
      });
  }

  function ensureMedia() {
    return ensureAudio().then(function () {
      return media.wantCam ? ensureVideo() : null;
    });
  }

  /* o que sai no transceptor de vídeo: tela > câmera > nada */
  function videoOutTrack() {
    if (media.screen && media.screen.readyState === "live") return media.screen;
    if (media.wantCam && media.video && media.video.readyState === "live") return media.video;
    return null;
  }

  function stopVideoLocal() {
    var back = null;
    if (media.video) {
      try {
        media.video.stop();
      } catch (e) {}
      media.video = null;
    }
    if (!media.screen) {
      localStreamRemove("video");
      publishLocal("video", back);
    }
    renderOverlay();
  }

  function stopAudioLocal() {
    if (media.audio) {
      try {
        media.audio.stop();
      } catch (e) {}
      media.audio = null;
    }
    localStreamRemove("audio");
    publishLocal("audio", null);
    renderOverlay();
  }

  function releaseAll() {
    stopVideoLocal();
    stopAudioLocal();
    stopScreen(false);
    media.micOn = true;
    media.wantCam = true;
  }

  /* ---------------- tela (getDisplayMedia) ---------------- */

  function toggleScreen() {
    if (callState.phase !== "active") {
      toast(t("call.somenteEmChamada", "O compartilhamento de tela só funciona durante a chamada."), "warn");
      return;
    }
    if (media.screen) {
      stopScreen(true);
      return;
    }
    var md = navigator.mediaDevices;
    if (!md || typeof md.getDisplayMedia !== "function") {
      media.screenError = t("call.telaNaoSuportada", "Este navegador não suporta compartilhamento de tela.");
      toast(media.screenError, "warn");
      emit("call:error", { call: callState.call, peer: callState.peer, message: media.screenError });
      return;
    }
    md
      .getDisplayMedia({ video: true, audio: false })
      .then(function (stream) {
        var tr = stream.getVideoTracks()[0];
        if (!tr) throw new Error("sem faixa de vídeo");
        media.screen = tr;
        media.screenStream = stream;
        media.screenError = null;
        tr.onended = function () {
          stopScreen(true);
        };
        localStreamRemove("video");
        localStreamAdd(tr);
        publishLocal("video", tr);
        renderOverlay();
      })
      .catch(function (err) {
        var name = (err && err.name) || "";
        if (name === "NotAllowedError" || name === "AbortError")
          toast(t("call.telaCancelada", "Compartilhamento de tela cancelado."), "info");
        else if (name === "NotSupportedError" || name === "TypeError")
          toast(t("call.telaNaoSuportada", "Este navegador não suporta compartilhamento de tela."), "warn");
        else toast(t("call.telaFalhou", "Não foi possível compartilhar a tela."), "error");
      });
  }

  function stopScreen(render) {
    var tr = media.screen;
    media.screen = null;
    media.screenStream = null;
    if (tr) {
      tr.onended = null;
      try {
        tr.stop();
      } catch (e) {}
    }
    if (render !== false) {
      var back = videoOutTrack();
      localStreamRemove("video");
      if (back) localStreamAdd(back);
      publishLocal("video", back);
      renderOverlay();
    }
  }

  /* =========================================================
     6 · WebRTC (RTCPeerConnection)
     ========================================================= */

  function createPC() {
    if (rtc.pc) return rtc.pc;
    var Ctor = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (!Ctor) {
      fatal(t("call.webrtcIndisponivel", "Este navegador não consegue fazer chamadas por WebRTC."));
      return null;
    }
    var pc;
    try {
      pc = new Ctor(STUN);
    } catch (e) {
      fatal(t("call.webrtcFalhou", "Não foi possível iniciar a conexão de chamada."));
      return null;
    }
    rtc.pc = pc;
    rtc.senders = {};
    rtc.pending = [];
    rtc.remoteCamMuted = true;

    pc.onicecandidate = function (e) {
      if (!e.candidate) return;
      var c = e.candidate;
      var payload = c.toJSON
        ? c.toJSON()
        : { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex };
      sendSignal("candidate", payload);
    };
    pc.ontrack = onRemoteTrack;
    pc.onconnectionstatechange = renderStatus;
    pc.oniceconnectionstatechange = renderStatus;
    pc.onicegatheringstatechange = renderStatus;
    pc.onsignalingstatechange = renderStatus;
    pc.onnegotiationneeded = function () {
      if (timers.nego) clearTimeout(timers.nego);
      timers.nego = setTimeout(function () {
        timers.nego = null;
        if (callState.phase !== "active" || !rtc.pc) return;
        if (rtc.pc.signalingState !== "stable") return;
        makeOffer();
      }, 150);
    };

    addLocalTracks();
    return pc;
  }

  function addLocalTracks() {
    if (!rtc.pc) return;
    [["audio", media.audio], ["video", videoOutTrack()]].forEach(function (pair) {
      var kind = pair[0];
      var tr = pair[1];
      if (rtc.senders[kind] || !tr) return;
      try {
        rtc.senders[kind] = rtc.pc.addTrack(tr, localStream());
      } catch (e) {
        console.warn("[call] addTrack " + kind, e);
      }
    });
  }

  /* replaceTrack quando o transpoder já existe (sem renegociação);
     addTrack + negotiationneeded quando ele não existe. */
  function publishLocal(kind, track) {
    if (!rtc.pc) return;
    var sender = rtc.senders[kind];
    if (!sender) {
      var list = rtc.pc.getSenders() || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].track && list[i].track.kind === kind) {
          sender = list[i];
          break;
        }
      }
      if (!sender && track) {
        try {
          rtc.senders[kind] = rtc.pc.addTrack(track, localStream());
        } catch (e) {}
        return;
      }
      if (sender) rtc.senders[kind] = sender;
    }
    if (!sender) return;
    var p = sender.replaceTrack(track || null);
    if (p && typeof p.catch === "function")
      p.catch(function (err) {
        console.warn("[call] replaceTrack", err);
      });
  }

  function onRemoteTrack(e) {
    var st = remoteStream();
    if (st && e.track) {
      try {
        st.addTrack(e.track);
      } catch (err) {}
    }
    var v = ui.overlay ? ui.overlay.querySelector("[data-call-remote]") : null;
    if (v && v.srcObject !== st) v.srcObject = st;
    var tr = e.track;
    if (tr && tr.kind === "video") {
      rtc.remoteCamMuted = !!tr.muted;
      var mark = function (v2) {
        return function () {
          rtc.remoteCamMuted = v2;
          renderOverlay();
        };
      };
      tr.addEventListener("mute", mark(true));
      tr.addEventListener("unmute", mark(false));
      tr.addEventListener("ended", mark(true));
    }
    playRemote();
    renderOverlay();
  }

  var remote = { stream: null };

  function remoteStream() {
    if (!remote.stream && typeof window.MediaStream === "function") remote.stream = new MediaStream();
    return remote.stream;
  }

  function playRemote() {
    var v = ui.overlay ? ui.overlay.querySelector("[data-call-remote]") : null;
    if (!v) return;
    v.volume = prefs.volume;
    applySink(v);
    if (v.play) {
      var p = v.play();
      if (p && p.catch)
        p.catch(function () {
          /* autoplay bloqueado: nada de vídeo falso, só sem som até interação */
        });
    }
  }

  function applySink(v) {
    if (!v || typeof v.setSinkId !== "function") return;
    var p = v.setSinkId(prefs.outId || "");
    if (p && p.catch)
      p.catch(function () {
        /* dispositivo de saída indisponível: mantém o padrão */
      });
  }

  function remoteVideoLive() {
    var v = ui.overlay ? ui.overlay.querySelector("[data-call-remote]") : null;
    if (!v || !v.srcObject) return false;
    var trs = v.srcObject.getVideoTracks();
    if (!trs.length) return false;
    var tr = trs[0];
    if (tr.readyState !== "live") return false;
    if (tr.muted) return false;
    return !rtc.remoteCamMuted;
  }

  function closePC() {
    if (timers.nego) {
      clearTimeout(timers.nego);
      timers.nego = null;
    }
    var pc = rtc.pc;
    rtc.pc = null;
    rtc.senders = {};
    rtc.pending = [];
    rtc.makingOffer = false;
    rtc.ignoreOffer = false;
    if (!pc) return;
    try {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onnegotiationneeded = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
    } catch (e) {}
  }

  /* =========================================================
     7 · sinalização (offer / answer / candidate / bye)
     ========================================================= */

  function sendSignal(kind, payload) {
    var f = api("sendSignal");
    var cur = callState.call;
    if (!f || !cur) return Promise.resolve(null);
    var data = typeof payload === "string" ? payload : JSON.stringify(payload);
    return Promise.resolve(f(cur.id, kind, data)).catch(function (err) {
      signalError(err);
      return null;
    });
  }

  function signalError(err) {
    var msg = (err && err.friendly && err.message) || (err && err.message) || "";
    console.warn("[call] sinalização", err);
    emit("call:error", { call: callState.call, peer: callState.peer, message: msg || "signaling" });
    if (msg) toast(msg, "error");
  }

  function fatal(msg) {
    toast(msg, "error");
    emit("call:error", { call: callState.call, peer: callState.peer, message: msg });
  }

  function makeOffer() {
    var pc = rtc.pc;
    if (!pc || rtc.makingOffer || callState.phase !== "active") return Promise.resolve(null);
    rtc.makingOffer = true;
    return pc
      .createOffer()
      .then(function (offer) {
        if (pc.signalingState !== "stable") return null;
        return pc.setLocalDescription(offer).then(function () {
          return sendSignal("offer", pc.localDescription);
        });
      })
      .catch(function (err) {
        signalError(err);
      })
      .then(function () {
        rtc.makingOffer = false;
      });
  }

  function flushCandidates() {
    var pc = rtc.pc;
    if (!pc) return Promise.resolve();
    var list = rtc.pending.splice(0, rtc.pending.length);
    return Promise.all(
      list.map(function (c) {
        return pc.addIceCandidate(c).catch(function () {});
      })
    );
  }

  function handleOffer(desc) {
    if (!rtc.pc) createPC();
    var pc = rtc.pc;
    if (!pc) return Promise.resolve();
    var collision = rtc.makingOffer || pc.signalingState !== "stable";
    rtc.ignoreOffer = !polite() && collision;
    if (rtc.ignoreOffer) return Promise.resolve();

    var start = Promise.resolve();
    if (pc.signalingState !== "stable") {
      start = pc.setLocalDescription({ type: "rollback" }).catch(function () {
        /* rollback implícito do navegador */
      });
    }
    return start
      .then(function () {
        return pc.setRemoteDescription(desc);
      })
      .then(flushCandidates)
      .then(function () {
        return pc.createAnswer();
      })
      .then(function (ans) {
        return pc.setLocalDescription(ans).then(function () {
          return sendSignal("answer", pc.localDescription);
        });
      })
      .catch(function (err) {
        signalError(err);
      });
  }

  function handleAnswer(desc) {
    var pc = rtc.pc;
    if (!pc) return Promise.resolve();
    return pc
      .setRemoteDescription(desc)
      .then(flushCandidates)
      .then(renderStatus)
      .catch(function (err) {
        if (!rtc.ignoreOffer) signalError(err);
      });
  }

  function handleCandidate(cand) {
    var pc = rtc.pc;
    if (!pc || !pc.remoteDescription) {
      rtc.pending.push(cand);
      return Promise.resolve();
    }
    return pc.addIceCandidate(cand).catch(function (err) {
      if (!rtc.ignoreOffer) console.warn("[call] candidato ICE", err);
    });
  }

  function handleSignal(item) {
    var desc = null;
    try {
      desc = item.payload ? JSON.parse(item.payload) : null;
    } catch (e) {
      signalError(new Error(t("call.sinalInvalido", "A chamada recebeu um sinal inválido.")));
      return Promise.resolve();
    }
    if (!desc) return Promise.resolve();
    if (item.kind === "offer") return handleOffer(desc);
    if (item.kind === "answer") return handleAnswer(desc);
    if (item.kind === "candidate") return handleCandidate(desc);
    return Promise.resolve();
  }

  /* fila: sinais podem chegar antes de a chamada estar ativa */
  var queue = [];
  var draining = false;

  function enqueue(callId, item, idx) {
    if (!item || !item.kind || !callId) return;
    var at = item.at || Date.now();
    var key = callId + "|" + item.kind + "|" + at + "|" + idx;
    if (poll.seen[key]) return;
    poll.seen[key] = at;
    pruneSeen();
    queue.push({ callId: callId, kind: item.kind, payload: item.payload, at: at, key: key });
    drain();
  }

  function pruneSeen() {
    var keys = Object.keys(poll.seen);
    if (keys.length < 1000) return;
    var cutoff = Date.now() - 600000;
    keys.forEach(function (k) {
      if ((poll.seen[k] || 0) < cutoff) delete poll.seen[k];
    });
    if (Object.keys(poll.seen).length > 1200) poll.seen = {};
  }

  function drain() {
    if (draining) return;
    draining = true;
    (function step() {
      if (!queue.length) {
        draining = false;
        return;
      }
      var item = queue[0];
      var cur = callState.call;
      var inc = callState.incoming;
      var mine = (cur && item.callId === cur.id) || (inc && item.callId === inc.id);
      if (!mine) {
        /* sinal de chamada antiga ou de outra pessoa */
        queue.shift();
        step();
        return;
      }
      if (item.kind === "bye") {
        queue.shift();
        onRemoteBye();
        step();
        return;
      }
      if (callState.phase !== "active" || !cur || item.callId !== cur.id) {
        draining = false; /* espera a chamada ficar ativa */
        return;
      }
      queue.shift();
      if (!rtc.pc && item.kind !== "candidate") createPC();
      poll.chain = poll.chain
        .then(function () {
          return handleSignal(item);
        })
        .catch(function (err) {
          signalError(err);
        })
        .then(step);
    })();
  }

  function onRemoteBye() {
    if (callState.phase === "incoming" && callState.incoming) {
      closeIncoming();
      return;
    }
    if (!callState.call || callState.phase === "ended") return;
    finishCall(callState.call, "hangup", "peer");
  }

  /* =========================================================
     8 · identidade do par
     ========================================================= */

  function peerFromNotification(callId) {
    try {
      var db = NX.store && NX.store.db;
      var list = db && db.notifications ? db.notifications : [];
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (n && n.meta && n.meta.callId === callId && n.meta.actorId) return n.meta.actorId;
      }
    } catch (e) {}
    return null;
  }

  function resolvePeer(call, explicitId) {
    var p = peers[call && call.id];
    if (p && (p.username || p.displayName))
      return {
        id: p.id || call.peerId || "",
        username: p.username || "",
        displayName: p.displayName || p.username || "",
        avatar: p.avatar || null,
        status: p.status || "offline",
      };

    var id = explicitId || (call ? call.peerId : null);
    var m = me();
    if (m && id === m.id) id = peerFromNotification(call ? call.id : null);
    var usr = userOf(id);
    if (usr) return usr;

    return {
      id: id || "",
      username: "",
      displayName: t("call.alguem", "Alguém"),
      avatar: null,
      status: "offline",
    };
  }

  function peerName(p) {
    p = p || {};
    return p.displayName || p.username || t("call.alguem", "Alguém");
  }

  function peerSub(p) {
    p = p || {};
    var parts = [];
    if (p.username) parts.push("@" + p.username);
    var st = p.status ? NX.STATUS_LABEL[p.status] : null;
    if (st) parts.push(st);
    return parts.join(" · ");
  }

  /* =========================================================
     9 · UI — cartão de chamada recebida
     ========================================================= */

  function getRoot() {
    if (ui.root && document.body.contains(ui.root)) return ui.root;
    ui.root = el('<div class="nx-call-root" id="nx-call-root"></div>');
    ui.card = null;
    ui.overlay = null;
    document.body.appendChild(ui.root);
    bindRoot(ui.root);
    return ui.root;
  }

  function incomingHTML() {
    var p = callState.peer || {};
    return (
      '<div class="nx-call-incoming" id="nx-call-incoming" role="dialog" aria-modal="true" aria-label="' +
      h(t("call.chamadaRecebida", "Chamada recebida")) +
      '">' +
      '<div class="nx-call-incoming__top">' +
      '<span class="nx-call-incoming__ico" aria-hidden="true">📞</span>' +
      '<span class="nx-call-incoming__title">' +
      h(t("call.chamadaRecebida", "Chamada recebida")) +
      "</span>" +
      '<span class="nx-call-incoming__pulse" aria-hidden="true"></span>' +
      "</div>" +
      '<div class="nx-call-incoming__who">' +
      '<span class="nx-call-incoming__av">' +
      avatarHTML(p, "lg", true) +
      "</span>" +
      '<span class="nx-call-incoming__meta">' +
      "<strong>" +
      h(peerName(p)) +
      "</strong>" +
      "<span>" +
      h(peerSub(p)) +
      "</span>" +
      "</span>" +
      "</div>" +
      '<p class="nx-call-incoming__hint">' +
      h(t("call.incomingHint", "Chamada de áudio e vídeo")) +
      "</p>" +
      '<div class="nx-call-incoming__actions">' +
      '<button type="button" class="btn btn--ghost btn--lg" data-action="call-decline">' +
      h(t("call.recusar", "Recusar")) +
      "</button>" +
      '<button type="button" class="btn btn--primary btn--lg nx-call-incoming__accept" data-action="call-accept">' +
      h(t("call.atender", "Atender")) +
      "</button>" +
      "</div>" +
      "</div>"
    );
  }

  function showIncoming(c) {
    callState.incoming = c;
    callState.role = "callee";
    callState.peer = resolvePeer(c);
    var root = getRoot();
    if (ui.card) ui.card.remove();
    ui.card = el(incomingHTML());
    root.appendChild(ui.card);
    ringStart("in");
    emit("call:incoming", { call: c, peer: callState.peer });
    armIncomingTimeout(c);
  }

  function closeIncoming() {
    if (timers.miss && callState.phase === "incoming") {
      clearTimeout(timers.miss);
      timers.miss = null;
    }
    if (callState.phase === "incoming") {
      callState.phase = "idle";
      callState.call = null;
    }
    callState.incoming = null;
    if (ui.card) {
      var c = ui.card;
      ui.card = null;
      c.classList.add("is-out");
      setTimeout(function () {
        try {
          c.remove();
        } catch (e) {}
      }, 180);
    }
    if (callState.phase !== "outgoing" && callState.phase !== "active") ringStop();
  }

  function armIncomingTimeout(c) {
    if (timers.miss) clearTimeout(timers.miss);
    timers.miss = setTimeout(function () {
      timers.miss = null;
      if (!callState.incoming || callState.incoming.id !== c.id) return;
      unansweredIncoming(c);
    }, CALL_TIMEOUT_MS);
  }

  function unansweredIncoming(c) {
    closeIncoming();
    var end = api("endCall");
    var done = end
      ? Promise.resolve(end(c.id, "missed")).catch(function () {
          var r = api("respondCall");
          return r ? Promise.resolve(r(c.id, false)).catch(function () {}) : null;
        })
      : Promise.resolve(null);
    void done;
    var peer = callState.peer;
    emit("call:missed", { call: c, peer: peer });
    emit("call:ended", { call: c, peer: peer, reason: "missed", by: "timeout" });
    toast(t("call.chamadaPerdida", "Chamada perdida") + " — " + t("call.semResposta", "Sem resposta"), "warn");
    sfx("call_end");
    schedulePoll();
  }

  function declineBusy(c) {
    var r = api("respondCall");
    if (!r) return;
    Promise.resolve(r(c.id, false)).catch(function () {
      var end = api("endCall");
      if (end) Promise.resolve(end(c.id, "declined")).catch(function () {});
    });
  }

  /* =========================================================
     10 · UI — tela da chamada
     ========================================================= */

  function ctl(action, glyph, label, extra) {
    return (
      '<button type="button" class="nx-call__ctl ' +
      (extra || "") +
      '" data-action="' +
      action +
      '" aria-label="' +
      h(label) +
      '"><span class="nx-call__ctl-ico" aria-hidden="true">' +
      glyph +
      '</span><span class="nx-call__ctl-lbl">' +
      h(label) +
      "</span></button>"
    );
  }

  function settingsHTML() {
    var outSupported = sinkSupported();
    return (
      '<aside class="nx-call__settings" data-call-settings hidden aria-label="' +
      h(t("call.configuracoes", "Configurações")) +
      '">' +
      '<header class="nx-call__settings-head">' +
      "<strong>" +
      h(t("call.configuracoes", "Configurações")) +
      "</strong>" +
      '<button type="button" class="icon-btn" data-action="call-settings-close" aria-label="' +
      h(t("common.close", "Fechar")) +
      '">' +
      ico("x", 18) +
      "</button>" +
      "</header>" +
      '<div class="nx-call__settings-body">' +
      '<div class="field" data-call-field="audioinput">' +
      '<label class="field__label">' +
      h(t("call.microfone", "Microfone")) +
      "</label>" +
      '<select class="select" data-call-dev="audioinput" aria-label="' +
      h(t("call.microfone", "Microfone")) +
      '"></select>' +
      '<span class="field__hint" data-call-hint="audioinput"></span>' +
      "</div>" +
      '<div class="field" data-call-field="videoinput">' +
      '<label class="field__label">' +
      h(t("call.camera", "Câmera")) +
      "</label>" +
      '<select class="select" data-call-dev="videoinput" aria-label="' +
      h(t("call.camera", "Câmera")) +
      '"></select>' +
      '<span class="field__hint" data-call-hint="videoinput"></span>' +
      "</div>" +
      (outSupported
        ? '<div class="field" data-call-field="audiooutput">' +
          '<label class="field__label">' +
          h(t("call.saidaAudio", "Saída de áudio")) +
          "</label>" +
          '<select class="select" data-call-dev="audiooutput" aria-label="' +
          h(t("call.saidaAudio", "Saída de áudio")) +
          '"></select>' +
          '<span class="field__hint" data-call-hint="audiooutput"></span>' +
          "</div>"
        : "") +
      '<div class="field">' +
      '<label class="field__label">' +
      h(t("call.volume", "Volume")) +
      "</label>" +
      '<div class="nx-call__set-volume">' +
      '<input type="range" min="0" max="100" step="1" data-call-volume aria-label="' +
      h(t("call.volume", "Volume")) +
      '">' +
      '<span class="nx-call__set-num" data-call-vol-num>100%</span>' +
      "</div>" +
      "</div>" +
      '<div class="nx-call__opt"><span>' +
      h(t("call.cancelamentoEco", "Cancelamento de eco")) +
      '</span><label class="switch"><input type="checkbox" data-call-opt="ec"><i></i></label></div>' +
      '<div class="nx-call__opt"><span>' +
      h(t("call.supressaoRuido", "Supressão de ruído")) +
      '</span><label class="switch"><input type="checkbox" data-call-opt="ns"><i></i></label></div>' +
      '<div class="nx-call__opt"><span>' +
      h(t("call.ganhoAutomatico", "Ganho automático")) +
      '</span><label class="switch"><input type="checkbox" data-call-opt="agc"><i></i></label></div>' +
      '<p class="field__hint">' +
      h(
        t(
          "call.processamentoHint",
          "O processamento de áudio é aplicado na próxima captura do microfone."
        )
      ) +
      "</p>" +
      "</div>" +
      "</aside>"
    );
  }

  function overlayHTML() {
    return (
      '<div class="nx-call" id="nx-call" role="dialog" aria-modal="true" aria-label="' +
      h(t("call.tituloChamada", "Chamada")) +
      '">' +
      '<div class="nx-call__bg" aria-hidden="true"></div>' +
      '<header class="nx-call__top">' +
      '<div class="nx-call__who">' +
      '<span class="nx-call__av" data-call-av aria-hidden="true"></span>' +
      '<span class="nx-call__names">' +
      '<strong class="nx-call__name" data-call-name></strong>' +
      '<span class="nx-call__handle" data-call-handle></span>' +
      "</span>" +
      "</div>" +
      '<div class="nx-call__center">' +
      '<span class="nx-call__timer" data-call-timer>00:00:00</span>' +
      '<span class="nx-call__pill" data-call-state></span>' +
      "</div>" +
      '<div class="nx-call__right">' +
      '<span class="nx-call__ice" data-call-ice></span>' +
      "</div>" +
      "</header>" +
      '<div class="nx-call__banner" data-call-banner hidden>' +
      '<span class="nx-call__banner-ico" aria-hidden="true">⚠️</span>' +
      '<span class="nx-call__banner-txt" data-call-banner-txt></span>' +
      '<button type="button" class="icon-btn icon-btn--xs" data-action="call-banner-close" aria-label="' +
      h(t("common.close", "Fechar")) +
      '">' +
      ico("x", 14) +
      "</button>" +
      "</div>" +
      '<main class="nx-call__stage">' +
      '<div class="nx-call__tile nx-call__tile--remote" data-tile="remote">' +
      '<video class="nx-call__video" data-call-remote autoplay playsinline></video>' +
      '<div class="nx-call__ph" data-call-remote-ph></div>' +
      '<span class="nx-call__tag" data-call-remote-tag></span>' +
      "</div>" +
      '<div class="nx-call__tile nx-call__tile--local">' +
      '<video class="nx-call__video" data-call-local autoplay muted playsinline></video>' +
      '<div class="nx-call__ph" data-call-local-ph></div>' +
      '<span class="nx-call__tag">' +
      h(t("call.voce", "Você")) +
      "</span>" +
      '<span class="nx-call__mute" data-call-local-mute hidden aria-label="' +
      h(t("call.microfoneDesligado", "Microfone desligado")) +
      '">🔇</span>' +
      "</div>" +
      "</main>" +
      '<footer class="nx-call__foot">' +
      '<div class="nx-call__controls">' +
      ctl("call-mic", "🎙️", t("call.microfone", "Microfone")) +
      ctl("call-cam", "📹", t("call.camera", "Câmera")) +
      ctl("call-screen", "🖥️", t("call.compartilharTela", "Compartilhar tela")) +
      '<div class="nx-call__volwrap">' +
      ctl("call-volume", "🔊", t("call.volume", "Volume")) +
      '<div class="nx-call__vol" data-call-vol hidden>' +
      '<input type="range" min="0" max="100" step="1" data-call-volume aria-label="' +
      h(t("call.volume", "Volume")) +
      '">' +
      '<span class="nx-call__vol-num" data-call-vol-num>100%</span>' +
      "</div>" +
      "</div>" +
      ctl("call-settings", "⚙️", t("call.configuracoes", "Configurações")) +
      ctl("call-end", "🔴", t("call.encerrar", "Encerrar"), "nx-call__ctl--end") +
      "</div>" +
      "</footer>" +
      settingsHTML() +
      '<div class="nx-call__ended" data-call-ended hidden></div>' +
      "</div>"
    );
  }

  function ensureOverlay() {
    if (ui.overlay && document.body.contains(ui.overlay)) return ui.overlay;
    var root = getRoot();
    ui.overlay = el(overlayHTML());
    root.appendChild(ui.overlay);
    syncSettingsUI();
    return ui.overlay;
  }

  function closeOverlay() {
    if (timers.end) {
      clearTimeout(timers.end);
      timers.end = null;
    }
    if (timers.tick) {
      clearInterval(timers.tick);
      timers.tick = null;
    }
    if (ui.overlay) {
      var o = ui.overlay;
      ui.overlay = null;
      try {
        var rv = o.querySelector("[data-call-remote]");
        var lv = o.querySelector("[data-call-local]");
        if (rv) rv.srcObject = null;
        if (lv) lv.srcObject = null;
        o.remove();
      } catch (e) {}
    }
    remote.stream = null;
  }

  function resetAll() {
    closeOverlay();
    closePC();
    releaseAll();
    callState.phase = "idle";
    callState.call = null;
    callState.peer = null;
    callState.role = null;
    callState.incoming = null;
    callState.answeredAt = 0;
    callState.warned = {};
    callState.busy = false;
    callState.endReason = null;
    callState.endBy = null;
    queue.length = 0;
    draining = false;
  }

  function statusText() {
    if (callState.phase === "outgoing")
      return t("call.aguardandoResposta", "Aguardando resposta…");
    if (callState.phase === "incoming") return t("call.tocando", "Tocando…");
    if (callState.phase === "ended") return t("call.chamadaEncerrada", "Chamada encerrada");
    if (callState.phase !== "active") return "";
    var pc = rtc.pc;
    if (!pc) return t("call.conectando", "Conectando…");
    var cs = pc.connectionState || "";
    var map = {
      new: ["call.connNew", "Iniciando conexão"],
      connecting: ["call.connConnecting", "Conectando…"],
      checking: ["call.connChecking", "Verificando rota…"],
      connected: ["call.connConnected", "Conectado"],
      completed: ["call.connConnected", "Conectado"],
      disconnected: ["call.connDisconnected", "Conexão instável"],
      failed: ["call.connFailed", "Falha na conexão"],
      closed: ["call.connClosed", "Conexão encerrada"],
    };
    if (map[cs]) return t(map[cs][0], map[cs][1]);
    var ice = pc.iceConnectionState || "";
    if (map[ice]) return t(map[ice][0], map[ice][1]);
    return t("call.conectando", "Conectando…");
  }

  function iceText() {
    var pc = rtc.pc;
    var state = pc ? pc.iceConnectionState || pc.iceGatheringState || "" : "";
    var label = t("call.iceAguardando", "aguardando");
    if (state === "checking") label = t("call.iceChecking", "verificando");
    else if (state === "connected" || state === "completed") label = t("call.iceConnected", "conectado");
    else if (state === "failed") label = t("call.iceFailed", "falhou");
    else if (state === "disconnected") label = t("call.iceDisconnected", "instável");
    else if (state === "closed") label = t("call.iceClosed", "encerrado");
    return t("call.icePrefix", "ICE: ") + label;
  }

  function setBtn(action, on, label) {
    if (!ui.overlay) return null;
    var b = ui.overlay.querySelector('[data-action="' + action + '"]');
    if (!b) return null;
    if (on === true) b.classList.remove("is-off");
    else if (on === false) b.classList.add("is-off");
    if (label != null) {
      var s = b.querySelector(".nx-call__ctl-lbl");
      if (s) s.textContent = label;
    }
    return b;
  }

  function renderControls() {
    if (!ui.overlay) return;
    var active = callState.phase === "active";
    var micLive = !!(media.audio && media.audio.readyState === "live" && media.audio.enabled);
    var camLive = !!(media.video && media.video.readyState === "live" && media.wantCam);

    setBtn(
      "call-mic",
      micLive,
      micLive ? t("call.microfone", "Microfone") : t("call.mudo", "Mudo")
    );
    setBtn(
      "call-cam",
      camLive,
      camLive ? t("call.camera", "Câmera") : t("call.cameraOff", "Câmera off")
    );
    setBtn(
      "call-screen",
      !!media.screen,
      media.screen
        ? t("call.pararTela", "Parar tela")
        : t("call.compartilharTela", "Compartilhar tela")
    );
    var screenBtn = ui.overlay.querySelector('[data-action="call-screen"]');
    if (screenBtn) screenBtn.disabled = !active;
    var endBtn = ui.overlay.querySelector('[data-action="call-end"]');
    if (endBtn) endBtn.disabled = callState.phase === "ended";

    var mute = ui.overlay.querySelector("[data-call-local-mute]");
    if (mute) mute.hidden = micLive;
  }

  function renderTiles() {
    if (!ui.overlay) return;
    var rPh = ui.overlay.querySelector("[data-call-remote-ph]");
    var lPh = ui.overlay.querySelector("[data-call-local-ph]");
    var rTag = ui.overlay.querySelector("[data-call-remote-tag]");
    var p = callState.peer || {};

    if (rPh) {
      var showRemote = !remoteVideoLive();
      rPh.hidden = !showRemote;
      if (showRemote)
        rPh.innerHTML =
          avatarHTML(p, "xl", false) +
          '<span class="nx-call__ph-name">' +
          h(peerName(p)) +
          "</span>" +
          '<span class="nx-call__ph-hint">' +
          h(t("call.videosDesligado", "Câmera desligada")) +
          "</span>";
    }
    if (rTag)
      rTag.textContent = media.screen
        ? t("call.voceCompartilhando", "Você está compartilhando a tela")
        : peerName(p);

    if (lPh) {
      var showLocal = !(media.video && media.video.readyState === "live" && media.wantCam && !media.screen);
      lPh.hidden = !showLocal;
      if (showLocal)
        lPh.innerHTML =
          avatarHTML(me(), "lg", false) +
          '<span class="nx-call__ph-hint">' +
          h(media.screen ? t("call.telaLocal", "Tela") : t("call.videosDesligado", "Câmera desligada")) +
          "</span>";
    }
  }

  function renderStatus() {
    if (!ui.overlay) return;
    var timer = ui.overlay.querySelector("[data-call-timer]");
    var st = ui.overlay.querySelector("[data-call-state]");
    var ice = ui.overlay.querySelector("[data-call-ice]");
    if (timer) timer.textContent = fmtDur(elapsed());
    if (st) st.textContent = statusText();
    if (ice) ice.textContent = iceText();
  }

  function renderOverlay() {
    if (!ui.overlay) return;
    var p = callState.peer || {};
    var av = ui.overlay.querySelector("[data-call-av]");
    var name = ui.overlay.querySelector("[data-call-name]");
    var handle = ui.overlay.querySelector("[data-call-handle]");
    if (av) av.innerHTML = avatarHTML(p, "md", true);
    if (name) name.textContent = peerName(p);
    if (handle) handle.textContent = peerSub(p);
    renderStatus();
    renderControls();
    renderTiles();
  }

  function showEnded(title, sub) {
    if (!ui.overlay) return;
    var box = ui.overlay.querySelector("[data-call-ended]");
    if (!box) return;
    box.innerHTML =
      '<div class="nx-call__ended-card">' +
      '<span class="nx-call__ended-ico" aria-hidden="true">📞</span>' +
      "<h3>" +
      h(title) +
      "</h3>" +
      (sub ? "<p>" + h(sub) + "</p>" : "") +
      '<button type="button" class="btn btn--soft" data-action="call-close">' +
      h(t("common.close", "Fechar")) +
      "</button>" +
      "</div>";
    box.hidden = false;
    if (timers.end) clearTimeout(timers.end);
    timers.end = setTimeout(function () {
      timers.end = null;
      if (callState.phase === "ended") resetAll();
    }, 7000);
  }

  function endedTexts(reason, by) {
    var dur = callState.answeredAt ? fmtDur(elapsed()) : "";
    if (reason === "missed")
      return {
        title: t("call.chamadaPerdida", "Chamada perdida"),
        sub: t("call.semResposta", "Sem resposta"),
      };
    if (reason === "declined")
      return by === "me"
        ? { title: t("call.chamadaRecusada", "Chamada recusada"), sub: "" }
        : {
            title: t("call.chamadaRecusada", "Chamada recusada"),
            sub: t("call.recusadaPelaPessoa", "A pessoa recusou a chamada."),
          };
    if (by === "me")
      return {
        title: t("call.chamadaEncerrada", "Chamada encerrada"),
        sub: dur ? t("call.duracao", "Duração") + ": " + dur : "",
      };
    return {
      title: t("call.chamadaEncerrada", "Chamada encerrada"),
      sub: t("call.finalizadaPelaPessoa", "A outra pessoa encerrou a chamada."),
    };
  }

  /* =========================================================
     11 · ciclo de vida da chamada
     ========================================================= */

  function startTicker() {
    if (timers.tick) clearInterval(timers.tick);
    timers.tick = setInterval(function () {
      if (callState.phase !== "active") return;
      renderStatus();
    }, 1000);
  }

  function clearTick() {
    if (timers.tick) {
      clearInterval(timers.tick);
      timers.tick = null;
    }
  }

  function armMissTimeout(c) {
    if (timers.miss) clearTimeout(timers.miss);
    timers.miss = setTimeout(function () {
      timers.miss = null;
      if (callState.phase !== "outgoing" || !callState.call || callState.call.id !== c.id) return;
      if (callState.call.state !== "ringing") return;
      var end = api("endCall");
      var updated = Object.assign({}, c, { state: "missed", reason: "missed", endedAt: Date.now() });
      if (end) Promise.resolve(end(c.id, "missed")).catch(function () {});
      finishCall(updated, "missed", "timeout");
    }, CALL_TIMEOUT_MS);
  }

  function onActivated() {
    if (callState.phase === "active") return;
    callState.phase = "active";
    if (timers.miss) {
      clearTimeout(timers.miss);
      timers.miss = null;
    }
    ringStop();
    callState.answeredAt = (callState.call && callState.call.answeredAt) || Date.now();
    ensureOverlay();
    startTicker();
    renderOverlay();
    emit("call:accepted", { call: callState.call, peer: callState.peer });
    sfx("call_accept");
    ensureMedia().then(function () {
      if (callState.phase !== "active") return;
      if (!rtc.pc) createPC();
      addLocalTracks();
      drain();
      if (callState.role === "caller") makeOffer();
      renderOverlay();
    });
  }

  function finishCall(c, reason, by) {
    if (callState.phase === "ended") return;
    var peer = callState.peer;
    var wasActive = callState.phase === "active";
    if (timers.miss) {
      clearTimeout(timers.miss);
      timers.miss = null;
    }
    clearTick();
    ringStop();
    callState.phase = "ended";
    callState.call = c || callState.call;
    callState.endReason = reason || "hangup";
    callState.endBy = by || "me";
    closePC();
    releaseAll();
    callState.micOnReset = true;
    media.micOn = true;
    media.wantCam = true;
    closeIncomingCardOnly();
    ensureOverlay();
    renderOverlay();
    var txt = endedTexts(callState.endReason, callState.endBy);
    var sub = txt.sub;
    if (!sub && wasActive && callState.answeredAt)
      sub = t("call.duracao", "Duração") + ": " + fmtDur(elapsed());
    showEnded(txt.title, sub);
    emit("call:ended", { call: callState.call, peer: peer, reason: callState.endReason, by: callState.endBy });
    if (callState.endReason === "missed") emit("call:missed", { call: callState.call, peer: peer });
    if (callState.endReason === "declined")
      emit("call:declined", { call: callState.call, peer: peer, by: callState.endBy });
    sfx("call_end");
    schedulePoll();
  }

  function closeIncomingCardOnly() {
    if (ui.card) {
      var c = ui.card;
      ui.card = null;
      try {
        c.remove();
      } catch (e) {}
    }
    callState.incoming = null;
  }

  /* ---------------- API pública ---------------- */

  function start(peerId) {
    if (callState.phase === "active" || callState.phase === "outgoing") {
      toast(t("call.jaEmChamada", "Você já está em uma chamada."), "warn");
      return Promise.resolve(callState.call);
    }
    if (callState.phase === "incoming") {
      toast(t("call.chamadaPendente", "Você tem uma chamada recebida pendente."), "warn");
      return Promise.resolve(callState.incoming);
    }
    var f = api("startCall");
    if (!f) {
      var msg = t("call.indisponivel", "As chamadas não estão disponíveis no momento.");
      toast(msg, "error");
      emit("call:error", { call: null, peer: null, message: msg });
      return Promise.reject(new Error(msg));
    }
    startPolling();
    return Promise.resolve()
      .then(function () {
        return f(peerId);
      })
      .then(function (call) {
        if (!call || !call.id) throw new Error(t("call.indisponivel", "As chamadas não estão disponíveis no momento."));
        callState.phase = "outgoing";
        callState.call = call;
        callState.role = "caller";
        callState.peer = resolvePeer(call, peerId);
        callState.warned = {};
        callState.answeredAt = 0;
        getRoot();
        ensureOverlay();
        renderOverlay();
        armMissTimeout(call);
        ringStart("out");
        emit("call:outgoing", { call: call, peer: callState.peer });
        schedulePoll();
        ensureMedia().then(function () {
          if (callState.phase === "outgoing") renderOverlay();
        });
        return call;
      })
      .catch(function (err) {
        var msg =
          (err && err.friendly && err.message) ||
          (err && err.message) ||
          t("call.falhaAoLigar", "Não foi possível iniciar a chamada.");
        toast(msg, "error");
        emit("call:error", { call: null, peer: userOf(peerId), message: msg });
        if (callState.phase === "outgoing") resetAll();
        throw err;
      });
  }

  function accept() {
    var c = callState.incoming;
    if (!c || callState.busy) return Promise.resolve(callState.call);
    callState.busy = true;
    closeIncoming();
    callState.phase = "incoming";
    callState.incoming = c;
    callState.call = c;
    callState.role = "callee";
    callState.warned = {};
    callState.answeredAt = 0;
    ringStop();
    var f = api("respondCall");
    var ok = f ? Promise.resolve(f(c.id, true)) : Promise.resolve(c);
    return ok
      .then(function (updated) {
        callState.call = updated && updated.id ? updated : c;
        callState.phase = "active";
        callState.answeredAt = callState.call.answeredAt || Date.now();
        ensureOverlay();
        startTicker();
        renderOverlay();
        emit("call:accepted", { call: callState.call, peer: callState.peer });
        sfx("call_accept");
        return ensureMedia().then(function () {
          if (!rtc.pc) createPC();
          addLocalTracks();
          drain();
          renderOverlay();
          return callState.call;
        });
      })
      .catch(function (err) {
        var msg = (err && err.message) || t("call.recusaFalhou", "Não foi possível atender a chamada.");
        toast(msg, "error");
        emit("call:error", { call: c, peer: callState.peer, message: msg });
        resetAll();
        return null;
      })
      .then(function (res) {
        callState.busy = false;
        return res;
      });
  }

  function decline() {
    var c = callState.incoming;
    if (!c) return Promise.resolve(null);
    closeIncoming();
    var f = api("respondCall");
    var peer = callState.peer;
    var p = f ? Promise.resolve(f(c.id, false)).catch(function (err) {
      console.warn("[call] recusa", err);
      return null;
    }) : Promise.resolve(null);
    var ended = Object.assign({}, c, { state: "declined", reason: "declined", endedAt: Date.now() });
    emit("call:declined", { call: ended, peer: peer, by: "me" });
    emit("call:ended", { call: ended, peer: peer, reason: "declined", by: "me" });
    sfx("call_end");
    callState.peer = null;
    schedulePoll();
    return p;
  }

  function hangup(reason) {
    if (callState.phase === "incoming" && callState.incoming) return decline();
    var c = callState.call;
    if (!c) {
      if (callState.phase !== "idle") resetAll();
      return Promise.resolve(null);
    }
    if (callState.phase === "ended") return Promise.resolve(c);
    var r = reason || "hangup";
    sendSignal("bye", {});
    var f = api("endCall");
    var p = f
      ? Promise.resolve(f(c.id, r)).catch(function (err) {
          console.warn("[call] encerrar", err);
          return null;
        })
      : Promise.resolve(null);
    var updated = Object.assign({}, c, {
      state: r === "missed" ? "missed" : "ended",
      reason: r,
      endedAt: Date.now(),
    });
    finishCall(updated, r, "me");
    return p.then(function () {
      return updated;
    });
  }

  function toggleMic() {
    if (callState.phase === "idle" || callState.phase === "ended") {
      toast(t("call.semChamada", "Nenhuma chamada em andamento."), "info");
      return;
    }
    if (!hasMedia()) {
      media.micOn = false;
      warnMedia(
        t("call.mediaIndisponivel", "Este navegador não permite acesso à câmera e ao microfone nesta conexão.")
      );
      toast(
        t("call.mediaIndisponivel", "Este navegador não permite acesso à câmera e ao microfone nesta conexão."),
        "warn"
      );
      renderOverlay();
      return;
    }
    if (media.audio && media.audio.readyState === "live") {
      media.micOn = !media.micOn;
      media.audio.enabled = media.micOn;
      renderOverlay();
      return;
    }
    media.micOn = true;
    ensureAudio().then(function (tr) {
      renderOverlay();
      if (!tr && media.micError) toast(media.micError, "error");
    });
  }

  function toggleCam() {
    if (callState.phase === "idle" || callState.phase === "ended") {
      toast(t("call.semChamada", "Nenhuma chamada em andamento."), "info");
      return;
    }
    if (!hasMedia()) {
      media.wantCam = false;
      toast(
        t("call.mediaIndisponivel", "Este navegador não permite acesso à câmera e ao microfone nesta conexão."),
        "warn"
      );
      renderOverlay();
      return;
    }
    if (media.wantCam && media.video && media.video.readyState === "live") {
      media.wantCam = false;
      stopVideoLocal();
      renderOverlay();
      return;
    }
    media.wantCam = true;
    ensureVideo().then(function (tr) {
      renderOverlay();
      if (!tr && media.camError) toast(media.camError, "error");
    });
  }

  function setVolume(v) {
    var n = Number(v);
    if (!isFinite(n)) return;
    if (n > 1) n = n / 100;
    prefs.volume = Math.max(0, Math.min(1, n));
    savePrefs();
    if (ui.overlay) {
      var rv = ui.overlay.querySelector("[data-call-remote]");
      if (rv) rv.volume = prefs.volume;
    }
    syncVolumeUI();
  }

  function syncVolumeUI() {
    var pct = Math.round(prefs.volume * 100);
    if (!ui.overlay) return;
    var ranges = ui.overlay.querySelectorAll("[data-call-volume]");
    for (var i = 0; i < ranges.length; i++) ranges[i].value = String(pct);
    var nums = ui.overlay.querySelectorAll("[data-call-vol-num]");
    for (var j = 0; j < nums.length; j++) nums[j].textContent = pct + "%";
  }

  function openSettings() {
    if (!ui.overlay) {
      toast(t("call.semChamada", "Nenhuma chamada em andamento."), "info");
      return;
    }
    var panel = ui.overlay.querySelector("[data-call-settings]");
    if (!panel) return;
    panel.hidden = false;
    requestAnimationFrame(function () {
      panel.classList.add("is-open");
    });
    refreshDevices();
    syncSettingsUI();
    var first = panel.querySelector("select:not([disabled])");
    if (first) {
      try {
        first.focus();
      } catch (e) {}
    }
  }

  function closeSettings() {
    if (!ui.overlay) return;
    var panel = ui.overlay.querySelector("[data-call-settings]");
    if (!panel) return;
    panel.classList.remove("is-open");
    setTimeout(function () {
      if (panel && !panel.classList.contains("is-open")) panel.hidden = true;
    }, 220);
  }

  function isActive() {
    return callState.phase === "active" && !!callState.call && callState.call.state === "active";
  }

  function state() {
    return {
      call: callState.call,
      peer: callState.peer,
      mic: !!(media.audio && media.audio.readyState === "live" && media.audio.enabled),
      cam: !!(media.video && media.video.readyState === "live" && media.wantCam),
      screen: !!media.screen,
      seconds: Math.floor(elapsed()),
      connection: statusText(),
    };
  }

  /* =========================================================
     12 · dispositivos e processamento de áudio
     ========================================================= */

  function defaultLabel(kind) {
    if (kind === "audioinput") return t("call.micAbrev", "Microfone");
    if (kind === "videoinput") return t("call.camAbrev", "Câmera");
    return t("call.saidaAbrev", "Saída");
  }

  function fillDevices(kind, supported) {
    if (!ui.overlay) return;
    var wrap = ui.overlay.querySelector('[data-call-field="' + kind + '"]');
    if (!wrap) return;
    if (!supported) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    var selEl = wrap.querySelector("select");
    var hint = wrap.querySelector(".field__hint");
    if (!selEl || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then(function (list) {
        var items = (list || []).filter(function (d) {
          return d && d.kind === kind;
        });
        if (!items.length) {
          selEl.innerHTML =
            '<option value="">' +
            h(t("call.nenhumDispositivo", "Nenhum dispositivo encontrado")) +
            "</option>";
          selEl.disabled = true;
          if (hint)
            hint.textContent = t(
              "call.autorizeDispositivos",
              "Autorize o acesso aos dispositivos para vê-los aqui."
            );
          return;
        }
        selEl.disabled = false;
        var cur = kind === "audioinput" ? prefs.micId : kind === "videoinput" ? prefs.camId : prefs.outId;
        var html = '<option value="">' + h(t("call.padraoSistema", "Padrão do sistema")) + "</option>";
        items.forEach(function (d, i) {
          html +=
            '<option value="' +
            h(d.deviceId) +
            '"' +
            (d.deviceId === cur ? " selected" : "") +
            ">" +
            h(d.label || defaultLabel(kind) + " " + (i + 1)) +
            "</option>";
        });
        selEl.innerHTML = html;
        if (hint) hint.textContent = "";
      })
      .catch(function () {
        wrap.hidden = true;
      });
  }

  function refreshDevices() {
    if (!ui.overlay) return;
    var md = navigator.mediaDevices;
    var supported = !!(md && typeof md.enumerateDevices === "function");
    fillDevices("audioinput", supported);
    fillDevices("videoinput", supported);
    fillDevices("audiooutput", supported && sinkSupported());
  }

  function syncSettingsUI() {
    if (!ui.overlay) return;
    var opts = ui.overlay.querySelectorAll("[data-call-opt]");
    for (var i = 0; i < opts.length; i++) {
      var k = opts[i].getAttribute("data-call-opt");
      opts[i].checked = prefs[k] !== false;
    }
    syncVolumeUI();
  }

  function restartAudio() {
    var wasOn = media.micOn;
    stopAudioLocal();
    media.micOn = wasOn;
    ensureAudio().then(function () {
      renderOverlay();
    });
  }

  function restartVideo() {
    stopVideoLocal();
    ensureVideo().then(function () {
      renderOverlay();
    });
  }

  function onDeviceChange(select) {
    var kind = select.getAttribute("data-call-dev");
    var val = select.value || "";
    if (kind === "audioinput") {
      prefs.micId = val;
      savePrefs();
      if (media.audio) restartAudio();
      else renderOverlay();
    } else if (kind === "videoinput") {
      prefs.camId = val;
      savePrefs();
      if (media.video) restartVideo();
      else renderOverlay();
    } else if (kind === "audiooutput") {
      prefs.outId = val;
      savePrefs();
      if (ui.overlay) {
        var rv = ui.overlay.querySelector("[data-call-remote]");
        applySink(rv);
      }
    }
  }

  function onOptChange(box) {
    var k = box.getAttribute("data-call-opt");
    if (!k) return;
    prefs[k] = !!box.checked;
    savePrefs();
    /* a nova restrição vale já na próxima captura */
    if (media.audio) restartAudio();
  }

  /* =========================================================
     13 · polling de peekCalls + sinalização
     ========================================================= */

  var poll = {
    timer: null,
    stopped: false,
    inflight: false,
    seen: {},
    chain: Promise.resolve(),
  };

  function callBusy() {
    var c = callState.call;
    return (
      !!callState.incoming ||
      (c && (c.state === "ringing" || c.state === "incoming" || c.state === "active"))
    );
  }

  function pollDelay() {
    return callBusy() || callState.phase === "active" || callState.phase === "outgoing" || callState.phase === "incoming"
      ? 1000
      : 2000;
  }

  function schedulePoll() {
    if (poll.stopped) return;
    if (poll.timer) {
      clearTimeout(poll.timer);
      poll.timer = null;
    }
    if (document.hidden) return; /* pausado em segundo plano */
    poll.timer = setTimeout(runPoll, pollDelay());
  }

  function runPoll() {
    poll.timer = null;
    if (poll.stopped || document.hidden) return;
    if (poll.inflight) {
      schedulePoll();
      return;
    }
    var f = api("peekCalls");
    if (!f || !me()) {
      schedulePoll();
      return;
    }
    poll.inflight = true;
    Promise.resolve()
      .then(function () {
        return f();
      })
      .then(function (data) {
        ingest(data);
      })
      .catch(function () {
        /* sem sessão ou offline: tenta de novo no ciclo seguinte */
      })
      .then(function () {
        poll.inflight = false;
        schedulePoll();
      });
  }

  function startPolling() {
    poll.stopped = false;
    schedulePoll();
  }

  function ingest(data) {
    if (!data) return;
    var calls = data.calls || {};
    if (data.peers) {
      Object.keys(data.peers).forEach(function (id) {
        peers[id] = data.peers[id];
      });
    }
    (data.signals || []).forEach(function (group) {
      if (!group || !group.callId) return;
      (group.items || []).forEach(function (item, i) {
        enqueue(group.callId, item, i);
      });
    });
    Object.keys(calls).forEach(function (id) {
      var c = calls[id];
      if (c && c.state) observe(c);
    });
    renderOverlay();
  }

  function observe(c) {
    /* uma chamada terminou de exibir o estado "encerrado" e outra chegou */
    if (callState.phase === "ended" && (!callState.call || callState.call.id !== c.id)) {
      if (c.state === "incoming" || c.state === "active") resetAll();
    }

    var cur = callState.call;
    if (cur && c.id === cur.id) {
      callState.call = c;
      if (c.state === "active" && callState.phase !== "active") onActivated();
      else if (isFinished(c.state) && callState.phase !== "ended")
        finishCall(c, c.reason || "hangup", callState.localBy || "peer");
      renderOverlay();
      return;
    }

    if (callState.phase === "active" || callState.phase === "outgoing") {
      if (c.state === "incoming" && c.id !== (cur && cur.id)) declineBusy(c);
      return;
    }

    if (callState.incoming) {
      if (c.id === callState.incoming.id) {
        callState.incoming = c;
        if (isFinished(c.state)) {
          var wasMissed = c.state === "missed";
          closeIncoming();
          if (wasMissed) {
            emit("call:missed", { call: c, peer: callState.peer });
            toast(t("call.chamadaPerdida", "Chamada perdida"), "warn");
          }
        }
        return;
      }
      if (c.state === "incoming") declineBusy(c);
      return;
    }

    if (callState.phase === "ended") return;

    if (c.state === "incoming") {
      showIncoming(c);
      return;
    }

    /* chamada que eu iniciei e que ficou esquecida (ex.: recarregou a página) */
    if (c.state === "ringing" && c.role === "caller" && Date.now() - (c.startedAt || 0) > CALL_TIMEOUT_MS) {
      if (!poll.missed) poll.missed = {};
      if (!poll.missed[c.id]) {
        poll.missed[c.id] = true;
        var end = api("endCall");
        if (end) Promise.resolve(end(c.id, "missed")).catch(function () {});
        emit("call:missed", { call: c, peer: resolvePeer(c) });
        toast(t("call.chamadaPerdida", "Chamada perdida") + " — " + t("call.semResposta", "Sem resposta"), "warn");
      }
    }
  }

  /* =========================================================
     14 · eventos da raiz (clique / change / input)
     ========================================================= */

  var ACTIONS = {
    "call-accept": function () {
      accept();
    },
    "call-decline": function () {
      decline();
    },
    "call-end": function () {
      hangup("hangup");
    },
    "call-close": function () {
      resetAll();
    },
    "call-mic": function () {
      toggleMic();
    },
    "call-cam": function () {
      toggleCam();
    },
    "call-screen": function () {
      toggleScreen();
    },
    "call-volume": function () {
      var box = ui.overlay && ui.overlay.querySelector("[data-call-vol]");
      if (box) box.hidden = !box.hidden;
    },
    "call-settings": function () {
      openSettings();
    },
    "call-settings-close": function () {
      closeSettings();
    },
    "call-banner-close": function () {
      setBanner(null);
    },
  };

  function bindRoot(root) {
    root.addEventListener(
      "click",
      function (e) {
        var btn = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
        if (!btn || !root.contains(btn)) return;
        var name = btn.getAttribute("data-action");
        var fn = ACTIONS[name];
        if (typeof fn !== "function") return;
        e.preventDefault();
        e.stopPropagation(); /* a ação pertence à chamada: nunca dispara duas vezes */
        try {
          fn(btn, e);
        } catch (err) {
          console.error("[call:" + name + "]", err);
        }
      },
      false
    );

    root.addEventListener(
      "change",
      function (e) {
        var el2 = e.target;
        if (!el2 || !el2.getAttribute) return;
        if (el2.hasAttribute("data-call-dev")) {
          e.stopPropagation();
          onDeviceChange(el2);
        } else if (el2.hasAttribute("data-call-opt")) {
          e.stopPropagation();
          onOptChange(el2);
        }
      },
      false
    );

    root.addEventListener(
      "input",
      function (e) {
        var el2 = e.target;
        if (!el2 || !el2.getAttribute) return;
        if (el2.hasAttribute("data-call-volume")) {
          e.stopPropagation();
          setVolume(el2.value);
        }
      },
      false
    );
  }

  /* =========================================================
     15 · init
     ========================================================= */

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (poll.timer) {
        clearTimeout(poll.timer);
        poll.timer = null;
      }
      return;
    }
    if (!poll.stopped) runPoll();
  });

  if (NX.bus && NX.bus.on) {
    NX.bus.on("db:change", function () {
      if (poll.stopped) {
        /* saiu do app (stopPolling) e voltou a ter sessão: retoma sozinho */
        if (me()) startPolling();
        return;
      }
      if (document.hidden || poll.timer) return;
      poll.timer = setTimeout(runPoll, 300);
    });
  }

  NX.call = {
    start: start,
    accept: accept,
    decline: decline,
    hangup: hangup,
    toggleMic: toggleMic,
    toggleCam: toggleCam,
    toggleScreen: toggleScreen,
    setVolume: setVolume,
    openSettings: openSettings,
    isActive: isActive,
    state: state,
    stopPolling: function () {
      poll.stopped = true;
      if (poll.timer) {
        clearTimeout(poll.timer);
        poll.timer = null;
      }
      ringStop();
      if (timers.miss) {
        clearTimeout(timers.miss);
        timers.miss = null;
      }
      if (timers.nego) {
        clearTimeout(timers.nego);
        timers.nego = null;
      }
      sendSignal("bye", {});
      queue.length = 0;
      draining = false;
      closeIncomingCardOnly();
      resetAll();
    },
    /* extra: o lead pode religar o polling após um login novo */
    startPolling: startPolling,
  };

  startPolling();
})(window.NX);
