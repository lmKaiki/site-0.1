/* ============================================================
   NEXO · motor de sons centralizado (Web Audio API)
   · nenhum arquivo de áudio externo, nenhum acesso de rede:
     cada alerta é sintetizado em tempo real (osciladores + envelopes).
   · preferências gravadas em `nexo.prefs` sob a chave `sounds`
     { on, volume, muted, categories: { messages, notifications,
       calls, invites, interface } } — `NX.storage` é o único meio
       de leitura/gravação, então qualquer tela pode ler por lá.
   · legado: `sounds` já foi um booleano. `normalize()` aceita
     true/false e devolve o objeto completo (migração silenciosa).
   · ATENÇÃO · o modo silencioso (muted) atinge apenas os sons
     desta engenharia. O áudio de chamadas ativas (WebRTC / <audio>
     remoto) NUNCA passa por aqui: ele é reproduzido pelo próprio
     fluxo de mídia do navegador e não é afetado por nenhuma
     preferência do NX.sfx.
   Seguro para carregar em qualquer ordem: todas as dependências
   (NX.storage, AudioContext, document) têm checagens defensivas.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const KEY = "nexo.prefs";
  const DEFAULT_VOLUME = 0.7;
  const CATEGORIES = ["messages", "notifications", "calls", "invites", "interface"];

  /* categoria de cada som (som fora desta tabela = desconhecido) */
  const CAT_OF = {
    message_sent: "messages",
    message_received: "messages",
    notification: "notifications",
    friend_request: "notifications",
    friend_accept: "notifications",
    call_ringing: "calls",
    call_join: "calls",
    call_leave: "calls",
    call_ended: "calls",
    server_invite: "invites",
    server_join: "invites",
    success: "interface",
    error: "interface",
  };

  /* ---------------- preferências ---------------- */
  function clampVolume(value) {
    const n = Number(value);
    if (!isFinite(n)) return DEFAULT_VOLUME;
    return Math.max(0, Math.min(1, n));
  }

  function defaultPrefs() {
    const categories = {};
    for (let i = 0; i < CATEGORIES.length; i++) categories[CATEGORIES[i]] = true;
    return { on: true, volume: DEFAULT_VOLUME, muted: false, categories: categories };
  }

  /* aceita o booleano legado, o objeto completo ou lixo qualquer */
  function normalize(value) {
    const out = defaultPrefs();
    if (typeof value === "boolean") {
      out.on = value !== false;
      return out;
    }
    if (!value || typeof value !== "object") return out;
    if (value.on === false) out.on = false;
    if (value.muted === true) out.muted = true;
    if (value.volume != null) out.volume = clampVolume(value.volume);
    const cats = value.categories;
    if (cats && typeof cats === "object") {
      for (let i = 0; i < CATEGORIES.length; i++) {
        const k = CATEGORIES[i];
        out.categories[k] = cats[k] !== false;
      }
    }
    return out;
  }

  function readRaw() {
    try {
      if (NX.storage && typeof NX.storage.get === "function") return NX.storage.get(KEY, null);
    } catch (e) {
      /* storage indisponível: tenta o caminho direto */
    }
    try {
      if (typeof localStorage !== "undefined") {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
      }
    } catch (e) {
      /* sem armazenamento acessível */
    }
    return null;
  }

  /* grava o objeto inteiro de preferências preservando messages/mentions */
  function writeSounds(sounds) {
    const raw = readRaw();
    const base = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const next = {
      messages: base.messages !== false,
      mentions: base.mentions !== false,
      sounds: normalize(sounds),
    };
    try {
      if (NX.storage && typeof NX.storage.set === "function") return NX.storage.set(KEY, next) !== false;
    } catch (e) {
      /* segue para o caminho direto */
    }
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(KEY, JSON.stringify(next));
        return true;
      }
    } catch (e) {
      /* armazenamento indisponível */
    }
    return false;
  }

  function prefs() {
    ensureMigrated();
    const raw = readRaw();
    return normalize(raw && typeof raw === "object" ? raw.sounds : null);
  }

  /* uma única migração: booleano legado -> objeto normalizado */
  let migrated = false;
  function ensureMigrated() {
    if (migrated) return;
    const raw = readRaw();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      migrated = true; /* nada gravado ainda (ou sem storage): nada a migrar */
      return;
    }
    try {
      if (typeof raw.sounds === "boolean" || !raw.sounds || typeof raw.sounds !== "object") {
        writeSounds(normalize(raw.sounds));
      }
    } catch (e) {
      /* migração é opcional */
    }
    migrated = true;
  }

  /* ---------------- áudio ---------------- */
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function audio() {
    try {
      if (typeof window === "undefined") return null;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!ctx) {
        ctx = new Ctx();
        master = ctx.createGain();
        master.gain.value = prefs().volume;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended" && typeof ctx.resume === "function") {
        const job = ctx.resume();
        if (job && typeof job.catch === "function") job.catch(function () {});
      }
      syncVolume();
      return ctx;
    } catch (e) {
      return null;
    }
  }

  function syncVolume() {
    if (!ctx || !master) return;
    const v = prefs().volume;
    try {
      master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
    } catch (e) {
      try {
        master.gain.value = v;
      } catch (e2) {
        /* ganho fixo é o último recurso */
      }
    }
  }

  /* rastreio de vozes ativas para poder cortá-las com stop() */
  const voices = {};

  function register(name, node, gain) {
    const rec = { node: node, gain: gain };
    if (!voices[name]) voices[name] = [];
    voices[name].push(rec);
    node.onended = function () {
      const list = voices[name];
      if (!list) return;
      const i = list.indexOf(rec);
      if (i > -1) list.splice(i, 1);
    };
  }

  function stopVoices(name) {
    const list = voices[name];
    if (!list || !list.length) return;
    const pending = list.slice();
    const now = ctx ? ctx.currentTime : 0;
    for (let i = 0; i < pending.length; i++) {
      const rec = pending[i];
      try {
        if (rec.gain && ctx) {
          try {
            rec.gain.gain.cancelScheduledValues(now);
          } catch (e) {}
          rec.gain.gain.setTargetAtTime(0.0001, now, 0.012);
        }
        if (rec.node) rec.node.stop(now + 0.06);
      } catch (e) {
        /* nó já parado */
      }
    }
  }

  /* nota simples com envelope (ataque curto + decaimento exponencial) */
  function tone(name, t0, o) {
    const c = audio();
    if (!c) return null;
    try {
      const dur = o.dur || 0.2;
      const peak = o.gain == null ? 0.16 : o.gain;
      const attack = o.attack == null ? 0.008 : o.attack;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = o.type || "sine";
      osc.frequency.setValueAtTime(o.from || 440, t0);
      if (o.to) {
        try {
          osc.frequency.exponentialRampToValueAtTime(o.to, t0 + (o.glide || dur));
        } catch (e) {
          /* rampa inválida: mantém a frequência inicial */
        }
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + Math.max(0.003, attack));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      let out = g;
      if (o.filter) {
        const bq = c.createBiquadFilter();
        bq.type = o.filter.type || "lowpass";
        bq.frequency.value = o.filter.freq || 1200;
        if (o.filter.q) bq.Q.value = o.filter.q;
        g.connect(bq);
        out = bq;
      }
      out.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
      register(name, osc, g);
      return osc;
    } catch (e) {
      return null;
    }
  }

  /* ruído branco filtrado: textura de "clique"/brilho curto */
  function noise(name, t0, o) {
    const c = audio();
    if (!c) return null;
    try {
      if (!noiseBuffer) {
        const len = Math.floor(c.sampleRate * 0.35);
        noiseBuffer = c.createBuffer(1, len, c.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      const dur = o.dur || 0.1;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer;
      const bq = c.createBiquadFilter();
      bq.type = "bandpass";
      bq.frequency.value = o.freq || 3000;
      bq.Q.value = o.q == null ? 1 : o.q;
      const g = c.createGain();
      const peak = o.gain == null ? 0.05 : o.gain;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bq);
      bq.connect(g);
      g.connect(master);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
      register(name, src, g);
      return src;
    } catch (e) {
      return null;
    }
  }

  /* ---------------- receitas (todas ≤ 600 ms, exceto o toque de chamada) ---------------- */
  const SOUNDS = {
    /* enviado: "whoosh" curto subindo */
    message_sent: function (name, t0) {
      tone(name, t0, { from: 420, to: 900, glide: 0.12, type: "sine", dur: 0.17, gain: 0.16, attack: 0.01 });
      tone(name, t0 + 0.02, { from: 880, to: 1560, glide: 0.1, type: "triangle", dur: 0.13, gain: 0.06, attack: 0.01 });
      noise(name, t0, { freq: 3200, q: 0.8, dur: 0.06, gain: 0.035 });
    },
    /* recebido: dueto de notas descendentes (contraste com o enviado) */
    message_received: function (name, t0) {
      tone(name, t0, { from: 880, type: "sine", dur: 0.14, gain: 0.14, attack: 0.006 });
      tone(name, t0 + 0.08, { from: 659.25, type: "sine", dur: 0.24, gain: 0.12, attack: 0.006 });
    },
    /* aviso: arpejo rápido de três notas agudas */
    notification: function (name, t0) {
      tone(name, t0, { from: 880, type: "sine", dur: 0.2, gain: 0.1, attack: 0.005 });
      tone(name, t0 + 0.07, { from: 1108.73, type: "sine", dur: 0.2, gain: 0.1, attack: 0.005 });
      tone(name, t0 + 0.14, { from: 1318.51, type: "sine", dur: 0.24, gain: 0.12, attack: 0.005 });
    },
    /* pedido de amizade: par grave → agudo com intervalo maior */
    friend_request: function (name, t0) {
      tone(name, t0, { from: 587.33, type: "triangle", dur: 0.13, gain: 0.13, attack: 0.008 });
      tone(name, t0 + 0.14, { from: 880, type: "sine", dur: 0.3, gain: 0.12, attack: 0.008 });
      noise(name, t0 + 0.14, { freq: 4200, q: 0.7, dur: 0.14, gain: 0.03 });
    },
    /* pedido aceito: dueto brilhante subindo (triângulo) */
    friend_accept: function (name, t0) {
      tone(name, t0, { from: 783.99, type: "triangle", dur: 0.14, gain: 0.13, attack: 0.006 });
      tone(name, t0 + 0.09, { from: 1174.66, type: "triangle", dur: 0.3, gain: 0.11, attack: 0.006 });
    },
    /* convite de servidor: quinta aberta + brilho (acorde aberto) */
    server_invite: function (name, t0) {
      tone(name, t0, { from: 659.25, type: "sine", dur: 0.4, gain: 0.1, attack: 0.008 });
      tone(name, t0, { from: 987.77, type: "sine", dur: 0.4, gain: 0.09, attack: 0.008 });
      noise(name, t0 + 0.04, { freq: 4600, q: 0.6, dur: 0.22, gain: 0.025 });
    },
    /* entrou no servidor: tríade maior completa com cauda */
    server_join: function (name, t0) {
      tone(name, t0, { from: 523.25, type: "sine", dur: 0.5, gain: 0.08, attack: 0.01 });
      tone(name, t0 + 0.015, { from: 659.25, type: "sine", dur: 0.5, gain: 0.08, attack: 0.01 });
      tone(name, t0 + 0.03, { from: 783.99, type: "sine", dur: 0.5, gain: 0.08, attack: 0.01 });
      tone(name, t0 + 0.05, { from: 1046.5, type: "triangle", dur: 0.42, gain: 0.07, attack: 0.03 });
    },
    /* sucesso: sino agudo + estouro de brilho */
    success: function (name, t0) {
      tone(name, t0, { from: 1318.51, type: "sine", dur: 0.28, gain: 0.13, attack: 0.005 });
      tone(name, t0 + 0.05, { from: 1975.53, type: "sine", dur: 0.24, gain: 0.06, attack: 0.01 });
      noise(name, t0, { freq: 5200, q: 0.7, dur: 0.2, gain: 0.03 });
    },
    /* erro: dueto descendente grave filtrado (negativo, mas suave) */
    error: function (name, t0) {
      tone(name, t0, { from: 329.63, type: "sawtooth", dur: 0.12, gain: 0.09, attack: 0.005, filter: { type: "lowpass", freq: 1100, q: 1 } });
      tone(name, t0, { from: 659.25, type: "sine", dur: 0.1, gain: 0.05, attack: 0.005 });
      tone(name, t0 + 0.13, { from: 246.94, type: "sawtooth", dur: 0.2, gain: 0.09, attack: 0.005, filter: { type: "lowpass", freq: 900, q: 1 } });
      tone(name, t0 + 0.13, { from: 493.88, type: "sine", dur: 0.18, gain: 0.05, attack: 0.005 });
    },
    /* toque de chamada: repete até stop() (não tem limite de duração) */
    call_ringing: function () {
      /* agendado pelo laço de startRing() */
    },
    /* entrou na chamada: tríade ascendente + nota alta */
    call_join: function (name, t0) {
      tone(name, t0, { from: 523.25, type: "triangle", dur: 0.18, gain: 0.13, attack: 0.006 });
      tone(name, t0 + 0.06, { from: 659.25, type: "triangle", dur: 0.18, gain: 0.13, attack: 0.006 });
      tone(name, t0 + 0.12, { from: 783.99, type: "triangle", dur: 0.18, gain: 0.13, attack: 0.006 });
      tone(name, t0 + 0.18, { from: 1046.5, type: "sine", dur: 0.26, gain: 0.09, attack: 0.01 });
    },
    /* saiu da chamada: tríade descendente suave */
    call_leave: function (name, t0) {
      tone(name, t0, { from: 783.99, type: "sine", dur: 0.18, gain: 0.12, attack: 0.008 });
      tone(name, t0 + 0.07, { from: 659.25, type: "sine", dur: 0.18, gain: 0.11, attack: 0.008 });
      tone(name, t0 + 0.14, { from: 523.25, type: "sine", dur: 0.3, gain: 0.1, attack: 0.008 });
    },
    /* chamada encerrada: descida longa e grave (queda de energia) */
    call_ended: function (name, t0) {
      tone(name, t0, { from: 330, to: 110, glide: 0.34, type: "sawtooth", dur: 0.38, gain: 0.1, attack: 0.01, filter: { type: "lowpass", freq: 850, q: 0.8 } });
      tone(name, t0 + 0.05, { from: 164.81, to: 82.41, glide: 0.3, type: "sine", dur: 0.36, gain: 0.09, attack: 0.02 });
    },
  };

  const NAMES = Object.keys(SOUNDS);

  /* ---------------- gating ---------------- */
  function canPlay(name) {
    const cat = CAT_OF[name];
    if (!cat) return false; /* nome desconhecido: sem efeito */
    const p = prefs();
    if (!p.on || p.muted) return false;
    return p.categories[cat] !== false;
  }

  /* ---------------- laço do toque de chamada ---------------- */
  let ringTimer = null;
  let ringing = false;

  function ringBurst(t0) {
    tone("call_ringing", t0, { from: 440, type: "sine", dur: 0.42, gain: 0.1, attack: 0.02 });
    tone("call_ringing", t0, { from: 480, type: "sine", dur: 0.42, gain: 0.09, attack: 0.02 });
  }

  function ringCycle() {
    if (!ringing) return;
    const c = audio();
    if (!c) {
      ringing = false;
      return;
    }
    const t0 = c.currentTime + 0.03;
    ringBurst(t0);
    ringBurst(t0 + 0.55);
    ringTimer = setTimeout(ringCycle, 2200);
  }

  function startRing() {
    if (!canPlay("call_ringing")) return false;
    if (ringing) return true;
    ringing = true;
    ringCycle();
    return true;
  }

  function stopRing() {
    ringing = false;
    if (ringTimer) {
      clearTimeout(ringTimer);
      ringTimer = null;
    }
    stopVoices("call_ringing");
    return true;
  }

  /* ---------------- API pública ---------------- */
  function play(name) {
    try {
      if (typeof name !== "string" || !SOUNDS[name]) return false; /* desconhecido: no-op */
      if (!canPlay(name)) return false;
      const c = audio();
      if (!c) return false;
      if (name === "call_ringing") return startRing();
      stopVoices(name); /* substitui a nota anterior do mesmo tipo */
      SOUNDS[name](name, c.currentTime + 0.012);
      return true;
    } catch (e) {
      return false;
    }
  }

  function stop(name) {
    try {
      if (typeof name !== "string" || !SOUNDS[name]) return false; /* desconhecido: no-op */
      if (name === "call_ringing") return stopRing();
      stopVoices(name);
      return true;
    } catch (e) {
      return false;
    }
  }

  function startRingPublic() {
    try {
      return startRing();
    } catch (e) {
      return false;
    }
  }

  function stopRingPublic() {
    try {
      return stopRing();
    } catch (e) {
      return false;
    }
  }

  function setEnabled(value) {
    try {
      const p = prefs();
      p.on = value !== false;
      writeSounds(p);
      if (!p.on) stopRing();
      return p.on;
    } catch (e) {
      return value !== false;
    }
  }

  function enabled() {
    try {
      return prefs().on;
    } catch (e) {
      return true;
    }
  }

  function setVolume(value) {
    const v = clampVolume(value);
    try {
      const p = prefs();
      p.volume = v;
      writeSounds(p);
      syncVolume();
    } catch (e) {
      /* sem armazenamento: o ganho ainda é aplicado abaixo */
    }
    return v;
  }

  function volume() {
    try {
      return prefs().volume;
    } catch (e) {
      return DEFAULT_VOLUME;
    }
  }

  function setSilent(value) {
    try {
      const p = prefs();
      p.muted = value === true;
      writeSounds(p);
      if (p.muted) stopRing();
      return p.muted;
    } catch (e) {
      return value === true;
    }
  }

  function silent() {
    try {
      return prefs().muted;
    } catch (e) {
      return false;
    }
  }

  function setCategory(cat, value) {
    if (CATEGORIES.indexOf(cat) < 0) return false; /* categoria desconhecida: no-op */
    try {
      const p = prefs();
      p.categories[cat] = value !== false;
      writeSounds(p);
      if (cat === "calls" && !p.categories.calls) stopRing();
      return p.categories[cat];
    } catch (e) {
      return value !== false;
    }
  }

  function category(cat) {
    if (CATEGORIES.indexOf(cat) < 0) return false;
    try {
      return prefs().categories[cat] !== false;
    } catch (e) {
      return true;
    }
  }

  /* prévia explícita do usuário: ignora categoria/mudo, respeita o volume */
  function test() {
    try {
      const c = audio();
      if (!c) return false;
      stopVoices("notification");
      SOUNDS.notification("notification", c.currentTime + 0.012);
      return true;
    } catch (e) {
      return false;
    }
  }

  function names() {
    return NAMES.slice();
  }

  NX.sfx = {
    play: play,
    stop: stop,
    startRing: startRingPublic,
    stopRing: stopRingPublic,
    prefs: function () {
      return prefs();
    },
    setEnabled: setEnabled,
    enabled: enabled,
    setVolume: setVolume,
    volume: volume,
    setSilent: setSilent,
    silent: silent,
    setCategory: setCategory,
    category: category,
    test: test,
    names: names,
    categories: function () {
      return CATEGORIES.slice();
    },
  };

  /* ---------------- boot defensivo ---------------- */
  try {
    ensureMigrated();
  } catch (e) {
    /* preferências normalizadas sob demanda */
  }

  /* o primeiro gesto do usuário destrava o AudioContext nos navegadores
     que iniciam suspenso (a 1ª reprodução também tenta destravar) */
  try {
    if (typeof document !== "undefined" && document.addEventListener) {
      const unlock = function () {
        audio();
      };
      ["pointerdown", "keydown", "touchstart"].forEach(function (evt) {
        document.addEventListener(evt, unlock, { once: true, passive: true });
      });
    }
  } catch (e) {
    /* sem DOM: nada a destravar agora */
  }
})(window.NX);
