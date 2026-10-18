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
  return {
    balance: Math.max(0, Math.floor(Number(c.balance) || 0)),
    owned: owned,
    equipped: plateById(c.equipped) ? String(c.equipped) : null,
    animations: c.animations !== false,
    claimed: claimed,
  };
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
  }));
}

module.exports = {
  CURRENCY,
  CATEGORIES,
  PLATES,
  MISSIONS,
  JORNADA_BASE,
  plateById,
  missionById,
  normalize,
  progressOf,
  catalog,
};
