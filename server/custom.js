"use strict";
/* ============================================================
   NEXO · server/custom
   Placas de nome (nameplates) + moeda "Pulsos" + missões.

   Fonte ÚNICA de verdade do catálogo: o handler entrega estes
   dados ao navegador (GET /custom), então loja, perfil e
   configurações sempre mostram os mesmos nomes, preços e
   raridades que o servidor valida. Nada aqui toca no banco —
   é dado puro + normalização defensiva de prefs.data.custom.

   REGRAS DE OURO (servidor é a autoridade):
     · saldo nunca fica negativo (validação no handler, dentro
       de db.lockPrefs);
     · compra repetida é recusada (409);
     · resgate de missão é único (prefs.data.custom.claimed);
     · progresso de missão é calculado no servidor a partir de
       linhas reais — o corpo do pedido NÃO é fonte de nada;
     · itens gratuitos são sempre equipáveis (sem compra);
     · itens de recompensa (price: null) nunca estão à venda.
   ============================================================ */

const CURRENCY = { id: "pulsos", name: "Pulsos" };

const CATEGORIES = [
  { id: "neon", name: "Neon" },
  { id: "cosmica", name: "Cósmica" },
  { id: "natureza", name: "Natureza" },
  { id: "minimalista", name: "Minimalista" },
  { id: "arcade", name: "Arcade" },
  { id: "epica", name: "Épica" },
  { id: "nexo", name: "Nexo" },
];

/* kind: "static" (sem movimento) | "animated" (efeito sutil)
   price: 0 = gratuito · número = compra com Pulsos · null = só
          recompensa de missão (nunca à venda)                  */
const PLATES = [
  {
    id: "faixa-verde",
    name: "Faixa Verde Nexo",
    category: "neon",
    kind: "static",
    price: 0,
    rarity: "comum",
    description: "A faixa na cor do Nexo. De graça para toda conta.",
  },
  {
    id: "linha-serena",
    name: "Linha Serena",
    category: "minimalista",
    kind: "static",
    price: 0,
    rarity: "comum",
    description: "Um traço discreto para quem prefere silêncio visual.",
  },
  {
    id: "pulso-neon",
    name: "Pulso Neon",
    category: "neon",
    kind: "animated",
    price: 120,
    rarity: "incomum",
    description: "O brilho neon respira devagar atrás do seu nome.",
  },
  {
    id: "constelacao-fina",
    name: "Constelação Fina",
    category: "cosmica",
    kind: "static",
    price: 100,
    rarity: "incomum",
    description: "Pontos de luz fixos, como uma noite sem nuvens.",
  },
  {
    id: "trama-cosmica",
    name: "Trama Cósmica",
    category: "cosmica",
    kind: "animated",
    price: 180,
    rarity: "rara",
    description: "Estrelas que piscam em transe lento pelo fundo.",
  },
  {
    id: "musgo-noturno",
    name: "Musgo Noturno",
    category: "natureza",
    kind: "static",
    price: 70,
    rarity: "comum",
    description: "Verde profundo de floresta depois da chuva.",
  },
  {
    id: "seiva-viva",
    name: "Seiva Viva",
    category: "natureza",
    kind: "animated",
    price: 150,
    rarity: "rara",
    description: "Ondas de folhagem que se movem em cadência suave.",
  },
  {
    id: "traco-minimo",
    name: "Traço Mínimo",
    category: "minimalista",
    kind: "static",
    price: 60,
    rarity: "comum",
    description: "Só o contorno. Quase nada, de propósito.",
  },
  {
    id: "grade-arcade",
    name: "Grade Arcade",
    category: "arcade",
    kind: "static",
    price: 80,
    rarity: "incomum",
    description: "Pixels em grade, como a tela de um fliperama.",
  },
  {
    id: "onda-arcade",
    name: "Onda Arcade",
    category: "arcade",
    kind: "animated",
    price: 160,
    rarity: "rara",
    description: "Listras que deslizam em ritmo de jogo.",
  },
  {
    id: "alvorecer",
    name: "Alvorecer",
    category: "epica",
    kind: "animated",
    price: 220,
    rarity: "rara",
    description: "Um céu de amanhecer que muda de cor por trás do nome.",
  },
  {
    id: "selo-nexo",
    name: "Selo Nexo",
    category: "nexo",
    kind: "animated",
    price: null,
    rarity: "lendaria",
    description:
      "Recompensa da Jornada Nexo: um brilho que percorre a placa. Não é vendida.",
    rewardOnly: true,
  },
  /* ---- Conquistas do Brasil 🇧🇷 (recompensa, nunca à venda) ----
     Desbloqueadas automaticamente quando uma pessoa NOVA entra
     num servidor pelo convite de quem convidou (entrada real
     confirmada pelo backend). A meta de cada placa fica em
     BRASIL_TIERS — tabela única e fácil de ajustar. */
  {
    id: "sol-de-neon",
    name: "Sol de Neon",
    category: "neon",
    kind: "animated",
    price: null,
    rarity: "incomum",
    description:
      "Primeira recompensa da coleção Brasil: um sol neon que percorre o nome. Desbloqueada ao confirmar 1 convite.",
    rewardOnly: true,
  },
  {
    id: "cruzeiro-do-sul",
    name: "Cruzeiro do Sul",
    category: "cosmica",
    kind: "static",
    price: null,
    rarity: "rara",
    description:
      "As estrelas do Cruzeiro pontilhando o fundo. Recompensa da coleção Brasil por convites confirmados.",
    rewardOnly: true,
  },
  {
    id: "mata-atlantica",
    name: "Mata Atlântica",
    category: "natureza",
    kind: "static",
    price: null,
    rarity: "incomum",
    description:
      "Verde de mata fechada em memória da floresta costeira. Recompensa da coleção Brasil.",
    rewardOnly: true,
  },
  {
    id: "faixa-amarela",
    name: "Faixa Amarela",
    category: "minimalista",
    kind: "static",
    price: null,
    rarity: "comum",
    description:
      "Uma faixa amarela só e fina, no espírito discreto brasileiro. Recompensa da coleção Brasil.",
    rewardOnly: true,
  },
  {
    id: "moeda-de-ouro",
    name: "Moeda de Ouro",
    category: "arcade",
    kind: "animated",
    price: null,
    rarity: "rara",
    description:
      "Um brilho de moeda que desliza como em fliperama. Recompensa da coleção Brasil.",
    rewardOnly: true,
  },
  {
    id: "carnaval-de-luz",
    name: "Carnaval de Luz",
    category: "epica",
    kind: "animated",
    price: null,
    rarity: "rara",
    description:
      "Cores de carnaval que passam atrás do nome. Recompensa da coleção Brasil.",
    rewardOnly: true,
  },
  {
    id: "brasil-nexo",
    name: "Brasil Nexo",
    category: "nexo",
    kind: "animated",
    price: null,
    rarity: "lendaria",
    description:
      "A maior recompensa da coleção Brasil: verde, amarelo e azul na placa Nexo. Recompensa por muitos convites confirmados.",
    rewardOnly: true,
  },
];

/* ---- Metas das Conquistas do Brasil 🇧🇷 --------------------
   Tabela de configuração ÚNICA da coleção: para ajustar quantas
   pessoas cada placa exige, mude só `goal` aqui. As metas são
   exibidas na loja exatamente como estão aqui — nada de meta
   escondida. `progresso` no servidor = quantidade de pessoas
   DISTINTAS que entraram num servidor pelo convite do usuário
   (entrada real confirmada; copiar link não conta).          */
const BRASIL_TIERS = [
  { plateId: "sol-de-neon", goal: 1 },
  { plateId: "cruzeiro-do-sul", goal: 3 },
  { plateId: "mata-atlantica", goal: 5 },
  { plateId: "faixa-amarela", goal: 10 },
  { plateId: "moeda-de-ouro", goal: 20 },
  { plateId: "carnaval-de-luz", goal: 35 },
  { plateId: "brasil-nexo", goal: 50 },
];

/* Missões: progresso sempre derivado de dados reais no servidor.
   deadline null = sem prazo (a tela mostra "Sem prazo").       */
const MISSIONS = [
  {
    id: "perfil",
    name: "Perfil completo",
    description: "Escreva uma bio de verdade e personalize seu avatar.",
    goal: 1,
    reward: { pulsos: 80 },
    deadline: null,
  },
  {
    id: "conversa",
    name: "Entre na conversa",
    description: "Envie 5 mensagens de verdade em canais ou conversas.",
    goal: 5,
    reward: { pulsos: 60 },
    deadline: null,
  },
  {
    id: "amigo",
    name: "Faça um amigo",
    description: "Deixe um pedido de amizade virar amizade de verdade.",
    goal: 1,
    reward: { pulsos: 70 },
    deadline: null,
  },
  {
    id: "servidor",
    name: "Crie seu servidor",
    description: "Crie um servidor seu no Nexo.",
    goal: 1,
    reward: { pulsos: 100 },
    deadline: null,
  },
  {
    id: "convite",
    name: "Chame alguém",
    description: "Gere um convite de servidor para trazer alguém.",
    goal: 1,
    reward: { pulsos: 50 },
    deadline: null,
  },
  {
    id: "jornada",
    name: "Jornada Nexo",
    description:
      "Conclua as outras 5 missões e ganhe a placa Selo Nexo (recompensa, sem venda).",
    goal: 5,
    reward: { plate: "selo-nexo" },
    deadline: null,
  },
];

const PLATE_BY_ID = {};
PLATES.forEach((p) => (PLATE_BY_ID[p.id] = p));
const MISSION_BY_ID = {};
MISSIONS.forEach((m) => (MISSION_BY_ID[m.id] = m));

/* as 5 missões que alimentam a "Jornada Nexo" (toda menos ela) */
const JORNADA_BASE = MISSIONS.filter((m) => m.id !== "jornada").map((m) => m.id);

function plateById(id) {
  return Object.prototype.hasOwnProperty.call(PLATE_BY_ID, String(id || ""))
    ? PLATE_BY_ID[String(id)]
    : null;
}

function missionById(id) {
  return Object.prototype.hasOwnProperty.call(MISSION_BY_ID, String(id || ""))
    ? MISSION_BY_ID[String(id)]
    : null;
}

/* Normalização defensiva de prefs.data.custom: qualquer lixo
   vindo do banco vira valor seguro (sem saldo negativo, sem id
   fantasma equipado, sem lista corrompida). */
function normalize(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const owned = Array.isArray(c.owned)
    ? c.owned.filter(function (id) {
        const p = plateById(id);
        return !!p && p.price !== 0;
      })
    : [];
  const claimed = {};
  if (c.claimed && typeof c.claimed === "object") {
    Object.keys(c.claimed).forEach(function (k) {
      if (missionById(k)) claimed[k] = c.claimed[k];
    });
  }
  /* registros de entradas confirmadas pelos convites do usuário
     (quem entrou, em qual servidor, quando) — fonte do progresso
     das Conquistas do Brasil. Lixo do banco vira objeto vazio. */
  const brInvitees = {};
  if (c.brInvitees && typeof c.brInvitees === "object" && !Array.isArray(c.brInvitees)) {
    Object.keys(c.brInvitees).forEach(function (k) {
      if (typeof k !== "string" || !k) return;
      const v = c.brInvitees[k] && typeof c.brInvitees[k] === "object" ? c.brInvitees[k] : {};
      brInvitees[k] = {
        serverId: v.serverId ? String(v.serverId) : "",
        at: Number(v.at) > 0 ? Number(v.at) : 0,
      };
    });
  }
  return {
    balance: Math.max(0, Math.floor(Number(c.balance) || 0)),
    owned: owned,
    equipped: plateById(c.equipped) ? String(c.equipped) : null,
    animations: c.animations !== false,
    claimed: claimed,
    brInvitees: brInvitees,
  };
}

/* Quantas pessoas distintas já entraram pelo convite do usuário */
function brasilCount(c) {
  const inv = c && c.brInvitees && typeof c.brInvitees === "object" ? c.brInvitees : {};
  return Object.keys(inv).length;
}

/* Estado da coleção Brasil para a tela (metas + progresso +
   desbloqueio), derivado APENAS do registro real de entradas. */
function brasilTierState(c) {
  const n = brasilCount(c);
  const owned = c && Array.isArray(c.owned) ? c.owned : [];
  return BRASIL_TIERS.map(function (t) {
    const p = plateById(t.plateId);
    const unlocked = owned.indexOf(t.plateId) > -1;
    return {
      plateId: t.plateId,
      name: p ? p.name : t.plateId,
      category: p ? p.category : null,
      goal: Math.max(1, Math.floor(Number(t.goal) || 1)),
      progress: Math.max(0, Math.min(Math.max(1, Math.floor(Number(t.goal) || 1)), n)),
      unlocked: unlocked,
      done: unlocked,
    };
  });
}

function brasilGoalOf(plateId) {
  const t = BRASIL_TIERS.find(function (x) {
    return x.plateId === plateId;
  });
  return t ? Math.max(1, Math.floor(Number(t.goal) || 1)) : null;
}

/* progresso das missões a partir de FATOS já calculados pelo
   handler (linhas reais do banco). Nunca aceita número vindo do
   cliente. */
function progressOf(mission, facts) {
  const f = facts || {};
  let n = 0;
  if (mission.id === "perfil") n = f.profile ? 1 : 0;
  else if (mission.id === "conversa") n = Number(f.talk) || 0;
  else if (mission.id === "amigo") n = Number(f.friends) || 0;
  else if (mission.id === "servidor") n = Number(f.servers) || 0;
  else if (mission.id === "convite") n = Number(f.invites) || 0;
  else if (mission.id === "jornada") n = Number(f.jornada) || 0;
  return Math.max(0, Math.min(Number(mission.goal) || 1, n));
}

/* catálogo público (o que a loja desenha) */
function catalog() {
  return PLATES.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    kind: p.kind,
    price: p.price,
    rarity: p.rarity,
    description: p.description,
    rewardOnly: !!p.rewardOnly,
    /* meta da coleção Brasil (null quando a placa não é de
       conquista) — a loja mostra "N/G" exatamente como aqui */
    brasilGoal: brasilGoalOf(p.id),
  }));
}

module.exports = {
  CURRENCY,
  CATEGORIES,
  PLATES,
  MISSIONS,
  JORNADA_BASE,
  BRASIL_TIERS,
  plateById,
  missionById,
  normalize,
  progressOf,
  catalog,
  brasilCount,
  brasilTierState,
  brasilGoalOf,
};
