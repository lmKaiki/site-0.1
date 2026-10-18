/* ============================================================
   NEXO · js/nameplates
   Placas de nome (nameplates) + Pulsos + missões na INTERFACE.

   O que este arquivo faz:
     1) guarda o estado vindo do backend (GET /custom);
     2) desenha a loja (#/loja), o painel em Configurações >
        Aparência e o seletor do perfil;
     3) pinta a placa atrás do nome nas listas de membros e nos
        perfis (classe "np np--<id>" — o CSS mora em
        css/nameplates.css);
     4) respeita "movimento reduzido" do sistema e a opção
        própria de desativar animações (prefs.data.custom).

   O que ele NÃO faz:
     · não compra, não resgata e não concede nada por conta
       própria — toda mutação passa por NX.api.* que, online,
       fala com /custom validado no servidor;
     · não inventa saldo: os Pulsos só chegam por resgate de
       missão feito no backend.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const S = () => NX.selectors;
  const u = () => NX.util;
  const t = (k, d) => (NX.i18n && NX.i18n.get ? NX.i18n.get(k, d) : d);
  const h = (s) => (NX.util && NX.util.h ? NX.util.h(String(s == null ? "" : s)) : String(s == null ? "" : s));

  /* ---------------- catálogo (espelho do server/custom.js) ----------------
     Com backend no ar, o estado traz o catálogo oficial e este espelho
     só serve ao modo offline e ao primeiro desenho antes do load. */
  const CATEGORIES = [
    { id: "neon", name: "Neon" },
    { id: "cosmica", name: "Cósmica" },
    { id: "natureza", name: "Natureza" },
    { id: "minimalista", name: "Minimalista" },
    { id: "arcade", name: "Arcade" },
    { id: "epica", name: "Épica" },
    { id: "nexo", name: "Nexo" },
  ];

  const CATALOG = [
    { id: "faixa-verde", name: "Faixa Verde Nexo", category: "neon", kind: "static", price: 0, rarity: "comum", description: "A faixa na cor do Nexo. De graça para toda conta.", rewardOnly: false },
    { id: "linha-serena", name: "Linha Serena", category: "minimalista", kind: "static", price: 0, rarity: "comum", description: "Um traço discreto para quem prefere silêncio visual.", rewardOnly: false },
    { id: "pulso-neon", name: "Pulso Neon", category: "neon", kind: "animated", price: 120, rarity: "incomum", description: "O brilho neon respira devagar atrás do seu nome.", rewardOnly: false },
    { id: "constelacao-fina", name: "Constelação Fina", category: "cosmica", kind: "static", price: 100, rarity: "incomum", description: "Pontos de luz fixos, como uma noite sem nuvens.", rewardOnly: false },
    { id: "trama-cosmica", name: "Trama Cósmica", category: "cosmica", kind: "animated", price: 180, rarity: "rara", description: "Estrelas que piscam em transe lento pelo fundo.", rewardOnly: false },
    { id: "musgo-noturno", name: "Musgo Noturno", category: "natureza", kind: "static", price: 70, rarity: "comum", description: "Verde profundo de floresta depois da chuva.", rewardOnly: false },
    { id: "seiva-viva", name: "Seiva Viva", category: "natureza", kind: "animated", price: 150, rarity: "rara", description: "Ondas de folhagem que se movem em cadência suave.", rewardOnly: false },
    { id: "traco-minimo", name: "Traço Mínimo", category: "minimalista", kind: "static", price: 60, rarity: "comum", description: "Só o contorno. Quase nada, de propósito.", rewardOnly: false },
    { id: "grade-arcade", name: "Grade Arcade", category: "arcade", kind: "static", price: 80, rarity: "incomum", description: "Pixels em grade, como a tela de um fliperama.", rewardOnly: false },
    { id: "onda-arcade", name: "Onda Arcade", category: "arcade", kind: "animated", price: 160, rarity: "rara", description: "Listras que deslizam em ritmo de jogo.", rewardOnly: false },
    { id: "alvorecer", name: "Alvorecer", category: "epica", kind: "animated", price: 220, rarity: "rara", description: "Um céu de amanhecer que muda de cor por trás do nome.", rewardOnly: false },
    { id: "selo-nexo", name: "Selo Nexo", category: "nexo", kind: "animated", price: null, rarity: "lendaria", description: "Recompensa da Jornada Nexo: um brilho que percorre a placa. Não é vendida.", rewardOnly: true },
    /* ---- Conquistas do Brasil 🇧🇷 (recompensa, nunca à venda) ---- */
    { id: "sol-de-neon", name: "Sol de Neon", category: "neon", kind: "animated", price: null, rarity: "incomum", description: "Primeira recompensa da coleção Brasil: um sol neon que percorre o nome. Desbloqueada ao confirmar 1 convite.", rewardOnly: true, brasilGoal: 1 },
    { id: "cruzeiro-do-sul", name: "Cruzeiro do Sul", category: "cosmica", kind: "static", price: null, rarity: "rara", description: "As estrelas do Cruzeiro pontilhando o fundo. Recompensa da coleção Brasil por convites confirmados.", rewardOnly: true, brasilGoal: 3 },
    { id: "mata-atlantica", name: "Mata Atlântica", category: "natureza", kind: "static", price: null, rarity: "incomum", description: "Verde de mata fechada em memória da floresta costeira. Recompensa da coleção Brasil.", rewardOnly: true, brasilGoal: 5 },
    { id: "faixa-amarela", name: "Faixa Amarela", category: "minimalista", kind: "static", price: null, rarity: "comum", description: "Uma faixa amarela só e fina, no espírito discreto brasileiro. Recompensa da coleção Brasil.", rewardOnly: true, brasilGoal: 10 },
    { id: "moeda-de-ouro", name: "Moeda de Ouro", category: "arcade", kind: "animated", price: null, rarity: "rara", description: "Um brilho de moeda que desliza como em fliperama. Recompensa da coleção Brasil.", rewardOnly: true, brasilGoal: 20 },
    { id: "carnaval-de-luz", name: "Carnaval de Luz", category: "epica", kind: "animated", price: null, rarity: "rara", description: "Cores de carnaval que passam atrás do nome. Recompensa da coleção Brasil.", rewardOnly: true, brasilGoal: 35 },
    { id: "brasil-nexo", name: "Brasil Nexo", category: "nexo", kind: "animated", price: null, rarity: "lendaria", description: "A maior recompensa da coleção Brasil: verde, amarelo e azul na placa Nexo. Recompensa por muitos convites confirmados.", rewardOnly: true, brasilGoal: 50 },
  ];

  const MISSIONS = [
    { id: "perfil", name: "Perfil completo", description: "Escreva uma bio de verdade e personalize seu avatar.", goal: 1, reward: { pulsos: 80 }, deadline: null },
    { id: "conversa", name: "Entre na conversa", description: "Envie 5 mensagens de verdade em canais ou conversas.", goal: 5, reward: { pulsos: 60 }, deadline: null },
    { id: "amigo", name: "Faça um amigo", description: "Deixe um pedido de amizade virar amizade de verdade.", goal: 1, reward: { pulsos: 70 }, deadline: null },
    { id: "servidor", name: "Crie seu servidor", description: "Crie um servidor seu no Nexo.", goal: 1, reward: { pulsos: 100 }, deadline: null },
    { id: "convite", name: "Chame alguém", description: "Gere um convite de servidor para trazer alguém.", goal: 1, reward: { pulsos: 50 }, deadline: null },
    { id: "jornada", name: "Jornada Nexo", description: "Conclua as outras 5 missões e ganhe a placa Selo Nexo (recompensa, sem venda).", goal: 5, reward: { plate: "selo-nexo" }, deadline: null },
  ];

  /* Metas das Conquistas do Brasil 🇧🇷 — espelho de BRASIL_TIERS
     do server/custom.js (o estado do servidor é a autoridade;
     aqui vale para o modo offline e para o primeiro desenho).
     As metas exibidas na loja são exatamente estes números. */
  const BRASIL_TIERS = [
    { plateId: "sol-de-neon", goal: 1 },
    { plateId: "cruzeiro-do-sul", goal: 3 },
    { plateId: "mata-atlantica", goal: 5 },
    { plateId: "faixa-amarela", goal: 10 },
    { plateId: "moeda-de-ouro", goal: 20 },
    { plateId: "carnaval-de-luz", goal: 35 },
    { plateId: "brasil-nexo", goal: 50 },
  ];

  const np = {
    state: null,
    loading: null,
    bootDone: false,
    busy: false,
    cat: "",
    picker: null,
    brServerId: null,
    brLink: null,
    CATALOG: CATALOG,
    CATEGORIES: CATEGORIES,
    MISSIONS: MISSIONS,
    BRASIL_TIERS: BRASIL_TIERS,
  };
  NX.nameplates = np;

  /* ---------------- estado ---------------- */

  np.load = function (force) {
    if (np.loading && !force) return np.loading;
    if (!NX.api || typeof NX.api.getCustomState !== "function")
      return Promise.resolve(np.state);
    np.loading = NX.api
      .getCustomState()
      .then((st) => {
        np.applyState(st);
        return st;
      })
      .catch((e) => {
        console.warn("[nameplates] estado:", e && e.message);
        return np.state;
      })
      .then((v) => {
        np.loading = null;
        return v;
      });
    return np.loading;
  };

  /* garante o estado uma vez por sessão (para a preferência de
     animação valer já na primeira tela); ao chegar, repinta a
     loja — é lá que saldo e missões aparecem */
  np.ensure = function () {
    if (np.state) return Promise.resolve(np.state);
    if (np.loading) return np.loading;
    return np.load().then((st) => {
      if (st && NX.app && NX.app.route && NX.app.route.name === "shop") {
        try {
          NX.views.content([]);
        } catch (e) {
          /* a tela já mudou */
        }
      }
      return st;
    });
  };

  np.applyState = function (st) {
    if (!st || typeof st !== "object") return;
    np.state = st;
    try {
      const me = S().me();
      if (me && NX.store.db.users[me.id]) NX.store.db.users[me.id].nameplate = st.equipped || null;
    } catch (e) {
      /* sem espelho local: o sync entrega em seguida */
    }
    np.applyMotion();
  };

  np.applyMotion = function () {
    try {
      if (!document.body) return;
      const off = !!(np.state && np.state.animations === false);
      document.body.classList.toggle("nx-motion-off", off);
    } catch (e) {
      /* sem DOM ainda */
    }
  };

  /* preferência de animação pede o estado assim que há sessão */
  try {
    if (NX.store && Array.isArray(NX.store.listeners)) {
      NX.store.listeners.push(function () {
        if (np.bootDone) return;
        let me = null;
        try {
          me = S().me();
        } catch (e) {
          me = null;
        }
        if (!me) return;
        np.bootDone = true;
        np.load();
      });
    }
  } catch (e) {
    /* store indisponível: o load acontece ao abrir loja/ajustes */
  }

  /* ---------------- helpers de pintura ---------------- */

  const plateById = (id) =>
    (np.state && Array.isArray(np.state.catalog) ? np.state.catalog : CATALOG).find(
      (p) => p && p.id === String(id || "")
    ) || null;

  np.plateOf = function (user) {
    if (!user) return "";
    try {
      const me = S().me();
      if (me && user.id === me.id && np.state) return np.state.equipped || "";
    } catch (e) {
      /* sem sessão: usa o valor do espelho */
    }
    return user.nameplate || "";
  };

  /* classe CSS da placa de alguém ("" = sem placa) */
  np.cls = function (user) {
    const id = np.plateOf(user);
    return id ? "np np--" + id : "";
  };

  const RARITY = {
    comum: () => t("np.rarity.comum", "Comum"),
    incomum: () => t("np.rarity.incomum", "Incomum"),
    rara: () => t("np.rarity.rara", "Rara"),
    lendaria: () => t("np.rarity.lendaria", "Lendária"),
  };

  np.chipHTML = function (plateId, label) {
    const p = plateById(plateId);
    if (!p) return "<span>" + h(label || "@usuario") + "</span>";
    return '<span class="np np--' + h(p.id) + ' np--chip">' + h(label || "@usuario") + "</span>";
  };

  const owns = (id) => {
    const p = plateById(id);
    if (!p) return false;
    if (p.price === 0) return true;
    return !!(np.state && Array.isArray(np.state.owned) && np.state.owned.indexOf(id) > -1);
  };

  const curName = () =>
    (np.state && np.state.currency && np.state.currency.name) || "Pulsos";

  /* ---------------- ações ---------------- */

  np.run = function (job, okMsg) {
    if (np.busy) return Promise.resolve(np.state);
    np.busy = true;
    return Promise.resolve()
      .then(job)
      .then((st) => {
        np.applyState(st);
        if (okMsg) NX.ui.toast(okMsg, "success");
        np.repaint();
        return st;
      })
      .catch((e) => {
        try {
          NX.ui.error(e && e.message);
        } catch (err) {
          console.warn("[nameplates]", err && err.message);
        }
      })
      .then((v) => {
        np.busy = false;
        return v;
      });
  };

  np.equip = (id) =>
    np.run(() => NX.api.equipNameplate(id), t("np.toast.equip", "Placa equipada."));
  np.unequip = () =>
    np.run(() => NX.api.equipNameplate(null), t("np.toast.removed", "Placa removida."));
  np.buy = (id) =>
    np.run(() => NX.api.buyNameplate(id), t("np.toast.bought", "Placa comprada!"));
  np.claim = (missionId) =>
    np.run(() => NX.api.claimMission(missionId), t("np.toast.claim", "Recompensa resgatada!"));
  np.setAnimations = function (on) {
    return np.run(
      () => NX.api.updateCustom({ animations: !!on }),
      on
        ? t("np.toast.animOn", "Animações das placas ativadas.")
        : t("np.toast.animOff", "Animações das placas desativadas.")
    );
  };

  np.repaint = function () {
    try {
      const r = NX.app && NX.app.route;
      if (r && (r.name === "shop" || r.name === "profile" || r.name === "home"))
        NX.views.content([]);
      else if (r && r.name === "server") NX.views.members();
      if (np.picker) np.renderPicker();
      if (NX.settings && NX.settings.root && NX.settings.section === "nameplates")
        NX.settings.go("nameplates");
    } catch (e) {
      console.warn("[nameplates] repaint:", e && e.message);
    }
  };

  /* ---------------- LOJA (#/loja) ---------------- */

  np.missionForPlate = function (plateId) {
    return (
      MISSIONS.find((m) => m.reward && m.reward.plate === plateId) || null
    );
  };

  function rewardLabel(m) {
    if (m.reward && m.reward.pulsos) return "+" + Number(m.reward.pulsos) + " " + curName();
    if (m.reward && m.reward.plate) {
      const p = plateById(m.reward.plate);
      return t("np.rewardPlate", "Placa") + ": " + (p ? p.name : "");
    }
    return "";
  }

  function missionCard(m) {
    const pct = m.goal ? Math.min(100, Math.round((m.progress / m.goal) * 100)) : 0;
    let foot = "";
    if (m.claimed) {
      foot = '<span class="mis-card__done">' + h(t("np.claimed", "Resgatada")) + "</span>";
    } else if (m.done) {
      foot =
        '<button class="btn btn--accent btn--sm" data-action="np-claim" data-id="' +
        h(m.id) +
        '">' +
        h(t("np.claim", "Resgatar")) +
        " · " +
        h(rewardLabel(m)) +
        "</button>";
    } else {
      foot = '<span class="mis-card__doing">' + h(t("np.inProgress", "Em progresso")) + "</span>";
    }
    return (
      '<article class="mis-card' + (m.claimed ? " is-claimed" : "") + '" data-mission="' + h(m.id) + '">' +
      '<div class="mis-card__top"><strong>' + h(m.name) + "</strong>" +
      '<span class="mis-card__reward">' + h(rewardLabel(m)) + "</span></div>" +
      "<p>" + h(m.description) + "</p>" +
      '<div class="mis-card__prog"><span class="mis-bar"><i style="width:' + pct + '%"></i></span>' +
      "<span class=\"mis-card__num\">" + Number(m.progress) + "/" + Number(m.goal) + "</span></div>" +
      '<div class="mis-card__foot"><small>' +
      h(m.deadline ? String(m.deadline) : t("np.noPrazo", "Sem prazo")) +
      "</small>" + foot + "</div>" +
      "</article>"
    );
  }

  function priceHTML(p) {
    if (p.price === 0) return '<span class="shop-card__price is-free">' + h(t("np.free", "Grátis")) + "</span>";
    if (p.price === null)
      return (
        '<span class="shop-card__price is-reward">' +
        (Number(p.brasilGoal)
          ? "🇧🇷 " + h(t("nbr.short", "Conquista"))
          : h(t("np.reward", "Recompensa"))) +
        "</span>"
      );
    return (
      '<span class="shop-card__price">' +
      Number(p.price) + " " + h(curName()) +
      "</span>"
    );
  }

  function actionHTML(p) {
    const equipped = !!(np.state && np.state.equipped === p.id);
    if (equipped)
      return (
        '<button class="btn btn--soft btn--sm" data-action="np-remove">' +
        h(t("np.remove", "Remover")) +
        "</button>"
      );
    if (owns(p.id))
      return (
        '<button class="btn btn--primary btn--sm" data-action="np-equip" data-id="' + h(p.id) + '">' +
        h(t("np.equip", "Equipar")) +
        "</button>"
      );
    if (p.price === null) {
      /* coleção Brasil 🇧🇷: mostra o progresso REAL de convites
         confirmados — mesma meta que o servidor valida */
      const brGoal = Number(p.brasilGoal) || 0;
      if (brGoal) {
        const tier = brasilView().tiers.find((x) => x.plateId === p.id);
        const prog = tier ? Number(tier.progress) || 0 : 0;
        return (
          '<span class="shop-card__hint" data-brasil="' + h(p.id) + '">' +
          h(t("nbr.short", "Conquista")) +
          " · " + h(t("nbr.progress", "Progresso")) +
          ": " + prog + "/" + brGoal +
          "</span>"
        );
      }
      const m = np.missionForPlate(p.id);
      return (
        '<span class="shop-card__hint">' +
        h(t("np.fromMission", "Missão")) + ": " + h(m ? m.name : t("np.missions", "Missões")) +
        "</span>"
      );
    }
    const balance = (np.state && Number(np.state.balance)) || 0;
    const short = p.price > balance;
    return (
      '<button class="btn btn--primary btn--sm" data-action="np-buy" data-id="' + h(p.id) + '"' +
      (short ? ' disabled title="' + h(t("np.need", "Saldo insuficiente — complete missões")) + '"' : "") +
      ">" + h(t("np.buy", "Comprar")) + "</button>"
    );
  }

  function shopCard(p) {
    const cat = CATEGORIES.find((c) => c.id === p.category);
    return (
      '<article class="shop-card" data-plate="' + h(p.id) + '">' +
      '<div class="shop-card__prev">' + np.chipHTML(p.id, "@" + ((S().me() && S().me().username) || "usuario")) + "</div>" +
      '<div class="shop-card__meta">' +
      '<div class="shop-card__name"><strong>' + h(p.name) + "</strong>" +
      '<span class="rar rar--' + h(p.rarity) + '">' + h((RARITY[p.rarity] || RARITY.comum)()) + "</span></div>" +
      "<small>" + h(cat ? cat.name : p.category) + " · " +
      h(p.kind === "animated" ? t("np.kind.animated", "Animada") : t("np.kind.static", "Estática")) +
      "</small>" +
      "<p>" + h(p.description) + "</p>" +
      "</div>" +
      '<div class="shop-card__foot">' + priceHTML(p) + actionHTML(p) + "</div>" +
      "</article>"
    );
  }

  /* ============ CONQUISTAS DO BRASIL 🇧🇷 (loja) ============ */

  /* Fonte do progresso: np.state.brasil (servidor/local). Sem
     estado carregado ainda, deriva do catálogo + placas
     desbloqueadas — nunca inventa número de convites. */
  function brasilView() {
    const st = np.state;
    if (st && st.brasil && Array.isArray(st.brasil.tiers) && st.brasil.tiers.length)
      return st.brasil;
    const owned = st && Array.isArray(st.owned) ? st.owned : [];
    const tiers = BRASIL_TIERS.map((t) => {
      const p = plateById(t.plateId);
      const goal = Math.max(1, Number(t.goal) || 1);
      const unlocked = owned.indexOf(t.plateId) > -1;
      return {
        plateId: t.plateId,
        name: p ? p.name : t.plateId,
        category: p ? p.category : null,
        goal: goal,
        progress: 0,
        unlocked: unlocked,
        done: unlocked,
      };
    });
    return { invitees: 0, tiers: tiers, next: tiers.find((x) => !x.unlocked) || null };
  }
  np.brasilView = brasilView;

  function serversIMember() {
    const me = S().me();
    if (!me) return [];
    const out = [];
    (S().membershipsOf(me.id) || []).forEach((m) => {
      const s = S().server(m.serverId);
      if (s) out.push(s);
    });
    return out;
  }

  function brasilCard(tier) {
    const pct = tier.goal ? Math.min(100, Math.round((tier.progress / tier.goal) * 100)) : 0;
    const state = tier.unlocked ? "done" : tier.progress > 0 ? "doing" : "locked";
    let foot;
    if (tier.unlocked) {
      const equipped = !!(np.state && np.state.equipped === tier.plateId);
      foot = equipped
        ? '<button class="btn btn--soft btn--sm" data-action="np-remove">' + h(t("np.remove", "Remover")) + "</button>"
        : '<button class="btn btn--primary btn--sm" data-action="np-equip" data-id="' + h(tier.plateId) + '">' + h(t("np.equip", "Equipar")) + "</button>";
    } else if (state === "doing") {
      foot = '<span class="nbr-card__doing">' + h(t("np.inProgress", "Em progresso")) + "</span>";
    } else {
      foot = '<span class="nbr-card__locked">' + h(t("nbr.locked", "Bloqueada")) + "</span>";
    }
    return (
      '<article class="nbr-card is-' + state + '" data-tier="' + h(tier.plateId) + '">' +
      '<div class="nbr-card__prev">' + np.chipHTML(tier.plateId, "@" + ((S().me() && S().me().username) || "usuario")) + "</div>" +
      '<div class="nbr-card__body">' +
      '<div class="nbr-card__top"><strong>' + h(tier.name) + "</strong>" +
      (tier.unlocked ? '<span class="nbr-card__done">' + h(t("nbr.done", "Concluído!")) + "</span>" : "") +
      "</div>" +
      "<p>" + h(t("nbr.goal", "Convide")) + " " + Number(tier.goal) + " " +
      (tier.goal === 1 ? h(t("nbr.person", "pessoa")) : h(t("nbr.people", "pessoas"))) + " " +
      h(t("nbr.goalSuffix", "para um servidor")) + "</p>" +
      '<div class="nbr-card__prog"><span class="mis-bar"><i style="width:' + pct + '%"></i></span>' +
      '<span class="mis-card__num">' + Number(tier.progress) + "/" + Number(tier.goal) + "</span></div>" +
      "</div>" +
      '<div class="nbr-card__foot">' + foot + "</div>" +
      "</article>"
    );
  }

  np.brasilHTML = function () {
    const bv = brasilView();
    const invitees = Number(bv.invitees) || 0;
    const next = bv.next || null;
    const servers = serversIMember();
    const chosen = servers.find((s) => s.id === np.brServerId) || servers[0] || null;
    const link = np.brLink || "";

    return (
      '<section class="shop-br" aria-label="' + h(t("nbr.title", "Conquistas do Brasil 🇧🇷")) + '">' +
      '<div class="shop-br__head"><h3>' + h(t("nbr.title", "Conquistas do Brasil 🇧🇷")) + "</h3>" +
      "<p>" + h(t("nbr.lead", "Traga pessoas de verdade para um servidor: quando a entrada for confirmada pelo servidor, a conquista é sua. Gerar ou copiar um convite sozinho não conta.")) + "</p>" +
      '<div class="shop-br__summary">' +
      '<span class="shop-br__count"><strong>' + invitees + "</strong> " +
      h(invitees === 1 ? t("nbr.confirmed1", "convite confirmado") : t("nbr.confirmedN", "convites confirmados")) +
      "</span>" +
      (next
        ? '<span class="shop-br__next">' + h(t("nbr.next", "Próxima:")) + " <b>" + h(next.name) + "</b> · " +
          h(t("nbr.progress", "Progresso")) + ": " + Number(next.progress) + "/" + Number(next.goal) + "</span>"
        : '<span class="shop-br__next is-done">' + NX.icon("check", "", 15) + " " +
          h(t("nbr.allDone", "Todas as conquistas concluídas!")) + "</span>") +
      "</div></div>" +
      '<div class="shop-br__grid">' + bv.tiers.map(brasilCard).join("") + "</div>" +
      '<div class="shop-br__share">' +
      '<div class="shop-br__shareTxt"><strong>' + h(t("nbr.shareTitle", "Convide pelo seu servidor")) + "</strong>" +
      "<small>" + h(t("nbr.shareHint", "Escolha um servidor, gere o convite e envie para uma pessoa real. O progresso só aumenta quando ela entrar.")) + "</small></div>" +
      '<div class="shop-br__shareBtns">' +
      '<button type="button" class="btn btn--soft btn--sm" data-action="np-br-server"' + (servers.length ? "" : " disabled") + ">" +
      NX.icon("users", "", 15) + "<span>" + h(chosen ? chosen.name : t("nbr.noServer", "Sem servidor")) + "</span></button>" +
      '<button type="button" class="btn btn--primary btn--sm" data-action="np-br-copy"' + (chosen ? "" : " disabled") + ">" +
      h(t("nbr.copy", "Copiar convite 🇧🇷")) + "</button>" +
      "</div>" +
      '<label class="shop-br__link"><input class="input" readonly data-np-link value="' + h(link) + '" placeholder="' +
      h(t("nbr.linkPh", "O link do convite aparece aqui ao copiar")) + '" aria-label="' + h(t("nbr.linkPh2", "Link do convite")) + '" /></label>' +
      "</div>" +
      "</section>"
    );
  };

  np.pages = np.pages || {};

  np.shopHTML = function () {
    const st = np.state;
    const balance = st ? Number(st.balance) || 0 : 0;
    const missions = (st && Array.isArray(st.missions) ? st.missions : MISSIONS);
    const cats = (st && Array.isArray(st.categories) && st.categories.length ? st.categories : CATEGORIES);
    const plates = (st && Array.isArray(st.catalog) && st.catalog.length ? st.catalog : CATALOG).filter(
      (p) => !np.cat || p.category === np.cat
    );

    const chips =
      '<button class="shop-chip' + (!np.cat ? " is-on" : "") + '" data-action="np-cat" data-cat="">' +
      h(t("np.shop.catAll", "Todas")) + "</button>" +
      cats
        .map(
          (c) =>
            '<button class="shop-chip' + (np.cat === c.id ? " is-on" : "") + '" data-action="np-cat" data-cat="' + h(c.id) + '">' +
            h(c.name) + "</button>"
        )
        .join("");

    return (
      '<div class="page page--shop">' +
      '<header class="shop-head">' +
      '<div class="shop-head__txt"><h2>' + h(t("np.shop.title", "Loja de placas de nome")) + "</h2>" +
      "<p>" + h(t("np.shop.lead", "Fundo visual atrás do seu nome nas listas de membros e no perfil. Estáticas e animadas, feitas para o Nexo.")) + "</p></div>" +
      '<div class="shop-balance" aria-label="' + h(t("np.shop.balance", "Seus Pulsos")) + '">' +
      "<strong>" + balance + "</strong><span>" + h(curName()) + "</span></div>" +
      "</header>" +

      '<section class="shop-miss">' +
      '<div class="shop-miss__head"><h3>' + h(t("np.shop.missions", "Missões")) + "</h3>" +
      "<p>" + h(t("np.shop.missionsHint", "Opcional, sem prazo e sem compra obrigatória. O progresso é verificado no servidor.")) + "</p></div>" +
      '<div class="shop-miss__list">' + missions.map(missionCard).join("") + "</div>" +
      "</section>" +

      np.brasilHTML() +

      '<section class="shop-cats" aria-label="' + h(t("np.shop.cats", "Categorias")) + '">' + chips + "</section>" +

      '<section class="shop-grid">' +
      (plates.length
        ? plates.map(shopCard).join("")
        : '<p class="shop-empty">' + h(t("np.emptyFilter", "Nenhuma placa nesta categoria.")) + "</p>") +
      "</section>" +

      '<p class="shop-note">' + NX.icon("info", "", 15) +
      "<span>" + h(t("np.shop.note", "Sem pagamentos reais: os Pulsos vêm das missões e nada é cobrado fora do Nexo. Propriedade e saldo ficam guardados no servidor.")) + "</span></p>" +
      "</div>"
    );
  };

  /* ---------------- SELETOR DO PERFIL (modal) ---------------- */

  np.pickerHTML = function () {
    const st = np.state;
    const equipped = (st && st.equipped) || null;
    const plates = (st && Array.isArray(st.catalog) ? st.catalog : CATALOG).filter((p) => owns(p.id));
    const plate = equipped ? plateById(equipped) : null;

    return (
      '<div class="np-picker">' +
      '<div class="np-picker__cur">' +
      (plate
        ? '<div class="np-picker__curline">' + np.chipHTML(plate.id, "@" + ((S().me() && S().me().username) || "usuario")) +
          '<button class="btn btn--soft btn--sm" data-action="np-remove">' + h(t("np.remove", "Remover")) + "</button></div>"
        : '<p class="np-picker__none">' + h(t("np.none", "Nenhuma placa equipada.")) + "</p>") +
      "</div>" +
      '<div class="np-picker__list">' +
      plates
        .map((p) => {
          const on = equipped === p.id;
          return (
            '<div class="np-picker__row' + (on ? " is-on" : "") + '">' +
            np.chipHTML(p.id, h(p.name)) +
            (on
              ? '<span class="np-picker__on">' + h(t("np.equipped", "Equipada")) + "</span>"
              : '<button class="btn btn--soft btn--sm" data-action="np-equip" data-id="' + h(p.id) + '">' + h(t("np.equip", "Equipar")) + "</button>") +
            "</div>"
          );
        })
        .join("") +
      "</div>" +
      '<p class="np-picker__note">' + h(t("np.picker.more", "Compre novas placas e resgate recompensas na loja.")) + "</p>" +
      '<div class="modal__actions"><button class="btn btn--primary" data-action="np-go-shop">' +
      h(t("np.openShop", "Ver a loja")) + "</button></div>" +
      "</div>"
    );
  };

  np.renderPicker = function () {
    if (!np.picker || !np.picker.body) return;
    try {
      np.picker.body.innerHTML = np.pickerHTML();
    } catch (e) {
      /* modal já fechado */
    }
  };

  np.openPicker = function () {
    if (!S().me()) return;
    if (!np.state) np.load().then(() => { try { np.openPicker(); } catch (e) {} });
    const m = NX.ui.modal({
      title: t("np.picker.title", "Placas de nome"),
      eyebrow: "Nexo",
      size: "sm",
    });
    np.picker = m;
    const origClose = m.close;
    m.close = function () {
      np.picker = null;
      return origClose.apply(m, arguments);
    };
    m.body.innerHTML = np.pickerHTML();
  };

  /* ---------------- PAINEL DE CONFIGURAÇÕES ---------------- */

  np.settingsPanel = function () {
    const st = np.state;
    const equipped = (st && st.equipped) || null;
    const plate = equipped ? plateById(equipped) : null;
    const animOff = !!(st && st.animations === false);

    const mine = (st && Array.isArray(st.catalog) ? st.catalog : CATALOG).filter((p) => owns(p.id));

    const list = mine.length
      ? mine
          .map((p) => {
            const on = equipped === p.id;
            return (
              '<div class="np-set__row' + (on ? " is-on" : "") + '">' +
              np.chipHTML(p.id, h(p.name)) +
              (on
                ? '<button class="btn btn--soft btn--sm" data-action="np-remove">' + h(t("np.remove", "Remover")) + "</button>"
                : '<button class="btn btn--primary btn--sm" data-action="np-equip" data-id="' + h(p.id) + '">' + h(t("np.equip", "Equipar")) + "</button>") +
              "</div>"
            );
          })
          .join("")
      : '<p class="np-set__empty">' + h(t("np.noneOwned", "Você ainda não tem placas próprias — as gratuitas já estão listadas na loja.")) + "</p>";

    return {
      html:
        '<section class="set-card" data-focus-card="nameplates">' +
        '<div class="set-card__head"><h2>' + h(t("np.title.settings", "Placas de nome")) + "</h2>" +
        "<p>" + h(t("np.desc.settings", "Equipe, troque e remova sua placa. Ela aparece atrás do seu nome nas listas de membros e no perfil.")) + "</p></div>" +
        '<div class="np-set">' +
        '<div class="np-set__cur"><small>' + h(t("np.current", "Placa equipada")) + "</small>" +
        (plate
          ? '<div class="np-set__curline">' + np.chipHTML(plate.id, "@" + ((S().me() && S().me().username) || "usuario")) +
            '<button class="btn btn--soft btn--sm" data-action="np-remove">' + h(t("np.remove", "Remover")) + "</button></div>"
          : '<p class="np-set__none">' + h(t("np.none", "Nenhuma placa equipada.")) + "</p>") +
        "</div>" +
        '<div class="np-set__list"><small>' + h(t("np.myPlates", "Suas placas (grátis e compradas)")) + "</small>" + list + "</div>" +
        '<label class="np-anim"><input type="checkbox" data-np-anim' + (animOff ? " checked" : "") + ">" +
        '<span class="np-anim__txt"><strong>' + h(t("np.animOff", "Desativar animações das placas")) + "</strong>" +
        "<small>" + h(t("np.animNote", "Com o movimento reduzido do sistema ligado, as animações já ficam desligadas automaticamente.")) + "</small></span></label>" +
        '<div class="np-set__foot">' +
        '<button class="btn btn--soft btn--sm" data-action="nav-shop">' + NX.icon("sparkle", "", 15) +
        "<span>" + h(t("np.openShop", "Ver a loja")) + "</span></button>" +
        '<p class="np-set__currency">' + h(t("np.currencyNote", "Pulsos e missões ficam na loja. Tudo é validado no servidor.")) + "</p>" +
        "</div></div></section>",
      wire: function (inner) {
        const box = inner.querySelector("[data-np-anim]");
        if (box) {
          box.addEventListener("change", function () {
            np.setAnimations(!box.checked);
          });
        }
        if (!np.state && !np.loading) {
          np.load().then((st2) => {
            if (st2 && NX.settings && NX.settings.section === "nameplates")
              try {
                NX.settings.go("nameplates");
              } catch (e) {
                /* tela já mudou */
              }
          });
        }
      },
    };
  };

  /* ---------------- ações globais ---------------- */

  const A = NX.actions || (NX.actions = {});

  A["nav-shop"] = function () {
    if (np.picker) try { np.picker.close(); } catch (e) {}
    NX.app.go("#/loja");
  };
  A["np-go-shop"] = function () {
    if (np.picker) try { np.picker.close(); } catch (e) {}
    NX.app.go("#/loja");
  };
  A["np-cat"] = function (el) {
    np.cat = el.getAttribute("data-cat") || "";
    try {
      NX.views.content([]);
    } catch (e) {
      /* sem tela de conteúdo */
    }
  };
  A["np-equip"] = function (el) {
    const id = el.getAttribute("data-id");
    if (id) np.equip(id);
  };
  A["np-remove"] = function () {
    np.unequip();
  };
  A["np-buy"] = function (el) {
    const id = el.getAttribute("data-id");
    if (id) np.buy(id);
  };
  A["np-claim"] = function (el) {
    const id = el.getAttribute("data-id");
    if (id) np.claim(id);
  };
  A["np-open-picker"] = function () {
    np.openPicker();
  };

  /* ---- Conquistas do Brasil 🇧🇷: escolher servidor e copiar
     convite. O convite é o MESMO usado pelo app inteiro — não
     há convite especial da loja. O progresso da conquista só
     muda quando uma pessoa real entra (validado no servidor). */
  A["np-br-server"] = function (el) {
    const servers = serversIMember();
    if (!servers.length) {
      NX.ui.toast(t("nbr.noServer", "Você ainda não tem um servidor."), "warn");
      return;
    }
    NX.ui.menu(
      el,
      servers.map((s) => ({
        label: s.name,
        icon: "chat",
        onClick: () => {
          np.brServerId = s.id;
          np.brLink = null;
          np.repaint();
        },
      })),
      { align: "end" }
    );
  };

  A["np-br-copy"] = async function () {
    if (np.busy) return;
    const servers = serversIMember();
    if (!servers.length) {
      NX.ui.toast(t("nbr.noServer", "Você ainda não tem um servidor."), "warn");
      return;
    }
    const chosen = servers.find((s) => s.id === np.brServerId) || servers[0];
    np.brServerId = chosen.id;
    np.busy = true;
    try {
      /* reusa um convite válido já existente do servidor; se não
         houver, cria um novo pelo mesmo fluxo de sempre */
      let invite = (S().invitesOf(chosen.id) || []).find(
        (i) =>
          i &&
          (!i.expiresAt || i.expiresAt > Date.now()) &&
          (!i.maxUses || (i.uses || 0) < i.maxUses)
      );
      if (!invite) invite = await NX.api.createInvite(chosen.id);
      const link = location.href.split("#")[0] + "#/convite/" + invite.code;
      np.brLink = link;
      const copied = await u().copy(link);
      NX.ui.toast(
        copied
          ? t("nbr.copied", "Convite copiado! Cole para uma pessoa entrar.")
          : t("nbr.linkReady", "Link gerado: copie o campo acima."),
        copied ? "success" : "info"
      );
      np.repaint();
    } catch (e) {
      NX.ui.error(e && e.message ? e.message : t("nbr.errCopy", "Não foi possível gerar o convite."));
    } finally {
      np.busy = false;
    }
  };

  /* página da loja registrada em NX.pages (usada pelo views.content) */
  NX.pages = NX.pages || {};
  NX.pages.shop = function () {
    np.ensure(); /* saldo/missões chegam do servidor e repintam */
    return np.shopHTML();
  };
})(window.NX);
