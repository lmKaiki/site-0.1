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

  /* ============================================================
     COLEÇÃO AMPLIADA · 2026
     Cada peça muda FORMA, CONTORNO, MATERIAL ou MOVIMENTO —
     nada aqui é "mesmo desenho em outra cor":
       · faixas laterais, tubos, fios e cantos (contorno);
       · pontos, escamas, cristais, pixels e listras (material);
       · fluxo, varredura, cintilação e pulso (movimento).
     ============================================================ */

  /* ---------------- NEON ---------------- */
  { id: "neon-ciano", name: "Ciano Neon", category: "neon", kind: "static", price: 90, rarity: "incomum", description: "Barra de luz ciano em cada lateral do nome." },
  { id: "neon-roxo", name: "Roxo Neon", category: "neon", kind: "animated", price: 165, rarity: "rara", description: "Roxo elétrico que corre em laço pelo fundo." },
  { id: "neon-rosa", name: "Rosa Neon", category: "neon", kind: "static", price: 95, rarity: "incomum", description: "Brilho rosa estático com halo suave nas bordas." },
  { id: "neon-tubo", name: "Tubo de Neon", category: "neon", kind: "static", price: 145, rarity: "rara", description: "Um tubo de vidro aceso emoldurando a linha inteira." },
  { id: "neon-onda", name: "Onda Neon", category: "neon", kind: "animated", price: 210, rarity: "epica", description: "Uma onda de luz sobe e desce por trás das letras." },
  { id: "neon-vertigo", name: "Vertigo Neon", category: "neon", kind: "animated", price: 265, rarity: "epica", description: "Duas linhas opostas que se cruzam em movimento contínuo." },

  /* ---------------- CÓSMICA ---------------- */
  { id: "galaxia", name: "Galáxia", category: "cosmica", kind: "animated", price: 225, rarity: "rara", description: "Um disco de estrelas girando devagar atrás do nome." },
  { id: "nebulosa", name: "Nebulosa", category: "cosmica", kind: "animated", price: 245, rarity: "epica", description: "Nuvens de gás que mudam de densidade em cadência lenta." },
  { id: "estrelas-cadentes", name: "Estrelas Cadentes", category: "cosmica", kind: "animated", price: 195, rarity: "rara", description: "Faíscas atravessam o fundo como chuva de estrelas." },
  { id: "orbita", name: "Órbita", category: "cosmica", kind: "static", price: 115, rarity: "incomum", description: "Anéis concêntricos de um corpo em rotação." },
  { id: "eclipse", name: "Eclipse", category: "cosmica", kind: "static", price: 155, rarity: "rara", description: "Um disco escuro com anel dourado de luz na borda." },
  { id: "universo-profundo", name: "Universo Profundo", category: "cosmica", kind: "static", price: 285, rarity: "epica", description: "Azul-abissal com pontos de luz raros e distantes." },

  /* ---------------- NATUREZA ---------------- */
  { id: "floresta", name: "Floresta", category: "natureza", kind: "static", price: 105, rarity: "incomum", description: "Verdes empilhados, como copas vistas de baixo." },
  { id: "orvalho", name: "Orvalho", category: "natureza", kind: "static", price: 85, rarity: "comum", description: "Gotas frias espalhadas sobre fundo de madrugada." },
  { id: "flores", name: "Flores", category: "natureza", kind: "static", price: 135, rarity: "incomum", description: "Pontos de pétala sobre verde fundo de jardim." },
  { id: "aurora", name: "Aurora Boreal", category: "natureza", kind: "animated", price: 235, rarity: "rara", description: "Cortinas de luz que se movem como céu do norte." },
  { id: "correnteza", name: "Correnteza", category: "natureza", kind: "animated", price: 175, rarity: "rara", description: "Listras de água que escorrem sem parar." },
  { id: "cristal-verde", name: "Cristal Verde", category: "natureza", kind: "static", price: 215, rarity: "rara", description: "Facetas de cristal com brilho duro nas quinas." },

  /* ---------------- MINIMALISTA ---------------- */
  { id: "contorno-fino", name: "Contorno Fino", category: "minimalista", kind: "static", price: 65, rarity: "comum", description: "Uma linha de 1px em volta do nome. Só isso." },
  { id: "monocromatico", name: "Monocromático", category: "minimalista", kind: "static", price: 75, rarity: "comum", description: "Um cinza único, sem gradiente e sem brilho." },
  { id: "cinza-elegante", name: "Cinza Elegante", category: "minimalista", kind: "static", price: 105, rarity: "incomum", description: "Degradê quase invisível entre dois cinzas frios." },
  { id: "preto-e-branco", name: "Preto e Branco", category: "minimalista", kind: "static", price: 140, rarity: "rara", description: "Fundo claro sobre um corte escuro embaixo." },
  { id: "transparencia", name: "Transparência", category: "minimalista", kind: "static", price: 125, rarity: "incomum", description: "Vidro fosco: quase sumido, ainda legível." },
  { id: "linha-dupla", name: "Linha Dupla", category: "minimalista", kind: "static", price: 160, rarity: "rara", description: "Dois filetes paralelos emoldurando a placa." },

  /* ---------------- ARCADE ---------------- */
  { id: "pixel-art", name: "Pixel Art", category: "arcade", kind: "static", price: 110, rarity: "incomum", description: "Blocos de pixel firmes, sem suavização de borda." },
  { id: "fliperama", name: "Fliperama Retrô", category: "arcade", kind: "static", price: 130, rarity: "incomum", description: "Moldura de máquina de 1986 com brilho de tubo." },
  { id: "efeitos-jogo", name: "Efeitos de Jogo", category: "arcade", kind: "animated", price: 185, rarity: "rara", description: "Faixa de energia que corre como barra de vida." },
  { id: "luzes-rgb", name: "Luzes RGB", category: "arcade", kind: "animated", price: 205, rarity: "rara", description: "Cores trocando em ciclo fechado, como teclado gamer." },
  { id: "cyberpunk", name: "Cyberpunk", category: "arcade", kind: "static", price: 245, rarity: "epica", description: "Amarelo ácido sobre roxo, com corte diagonal." },
  { id: "painel-digital", name: "Painel Digital", category: "arcade", kind: "static", price: 165, rarity: "rara", description: "Linhas de leitura de instrumento, com marcas de escala." },

  /* ---------------- ÉPICA ---------------- */
  { id: "chamas", name: "Chamas", category: "epica", kind: "animated", price: 260, rarity: "epica", description: "Fogo que lambe o fundo em movimento perpétuo." },
  { id: "energia", name: "Energia Elétrica", category: "epica", kind: "animated", price: 255, rarity: "epica", description: "Descargas que piscam nas duas pontas." },
  { id: "dragao", name: "Dragão Estilizado", category: "epica", kind: "static", price: 275, rarity: "epica", description: "Escamas em diagonal com espinhos na borda superior." },
  { id: "cristal-radiante", name: "Cristal Radiante", category: "epica", kind: "static", price: 240, rarity: "epica", description: "Polígonos facetados refletindo luz de dentro." },
  { id: "runas", name: "Runas", category: "epica", kind: "static", price: 225, rarity: "rara", description: "Marcas gravadas ritmadas como uma inscrição." },
  { id: "lendario", name: "Efeito Lendário", category: "epica", kind: "animated", price: 330, rarity: "lendaria", description: "Ouro líquido atravessando uma placa pesada." },

  /* ---------------- NEXO EXCLUSIVA ---------------- */
  { id: "nexo-logo", name: "Marca Nexo", category: "nexo", kind: "static", price: 300, rarity: "nexo", description: "O símbolo do Nexo impresso ao fundo, sem roubar o nome." },
  { id: "nexo-identidade", name: "Identidade Nexo", category: "nexo", kind: "static", price: 310, rarity: "nexo", description: "Verde e ciano nas cores oficiais, com canto marcado." },
  { id: "nexo-gradiente", name: "Gradiente Nexo", category: "nexo", kind: "animated", price: 350, rarity: "nexo", description: "O gradiente da marca percorrendo a placa inteira." },
  { id: "nexo-futurista", name: "Efeito Futurista", category: "nexo", kind: "animated", price: 370, rarity: "nexo", description: "Linhas de dados descendo como se fossem código." },
  { id: "nexo-animacao", name: "Animação Especial", category: "nexo", kind: "animated", price: 400, rarity: "nexo", description: "Varredura dupla sincronizada com um pulso de borda." },
  { id: "nexo-raro", name: "Modelo Raro", category: "nexo", kind: "animated", price: 460, rarity: "nexo", description: "A peça mais difícil do catálogo: três camadas em movimento." },

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
