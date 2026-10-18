"use strict";
/* ============================================================
   NEXO · server/handlers/apps
   Bot Center — apps/bots reais para servidores dos usuários.

   Regras do sistema:
   · um bot NÃO é uma pessoa: a identidade mora em `apps`
     (catálogo) e `server_apps` (instalação) — nunca em `users`.
   · bots não entram em `memberships`, portanto não contam como
     membro humano e nunca aparecem como amigo.
   · quem instala precisa de permissão no servidor, e o bot só
     recebe permissões que o próprio instalador já possui
     (validado AQUI, no backend — nunca só na interface).
   · toda ação do bot é auditável em `logs`.

   Autoria das mensagens do bot:
   `messages.sender_id` é chave estrangeira de `users`, então a
   mensagem é gravada com o usuário que instalou/instigou e carrega
   o marcador «bot:<instalacao>» no início do conteúdo — a interface
   reconhece o marcador e desenha o robô no lugar da pessoa.
   ============================================================ */

const db = require("../db");
const auth = require("../auth");
const u = require("../util");
const P = require("../patch");
const acl = require("../acl");
const handlersAuth = require("./auth");
const { bad, forbidden, notFound } = require("../errors");

function now() {
  return Date.now();
}

/* ------------------------------------------------------------
   marcador de autoria
   ------------------------------------------------------------ */
const BOT_TAG = /^«bot:([^»]+)»\s?/;
function tag(installId) {
  return "«bot:" + installId + "» ";
}
function parseTag(text) {
  const m = BOT_TAG.exec(String(text || ""));
  return m ? m[1] : null;
}
function stripTag(text) {
  return String(text || "").replace(BOT_TAG, "");
}

/* ------------------------------------------------------------
   catálogo OFICIAL — apps com implementação real neste backend.
   Nada aqui é "vitrine": cada app tem comportamento efetivo
   (ganchos em onMemberJoin/onEvent e comandos em runCommand).
   ------------------------------------------------------------ */
const OFFICIAL_APPS = [
  {
    id: "app_nexo_welcome",
    name: "Nexo Boas-vindas",
    description:
      "Recebe cada pessoa nova com uma mensagem automática no canal escolhido, citando o nome (e o avatar, quando disponível).",
    avatar: "home",
    category: "Boas-vindas",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      {
        name: "/welcome",
        usage: "/welcome on | off",
        description: "Liga ou desliga as boas-vindas automáticas deste servidor.",
        admin: true,
      },
    ],
    config: {
      enabled: true,
      channelId: "",
      message:
        "**{usuario}** entrou no **{servidor}**! Seja bem-vindo(a) — use /welcome para configurar.",
      includeName: true,
      includeAvatar: true,
    },
  },
  {
    id: "app_nexo_mod",
    name: "Nexo Moderação",
    description:
      "Comandos de moderação reais (/warn ou /avisar, /kick, /ban, /clear) que respeitam cargo, hierarquia e permissões do servidor. Opcionalmente detecta excesso de mensagens (spam) com limites configuráveis e registra tudo.",
    avatar: "shield",
    category: "Moderação",
    developer: "Nexo Oficial",
    permissions: ["sendMessages", "deleteMessages", "kickMembers", "banMembers", "manageMembers"],
    commands: [
      { name: "/warn", usage: "/warn @usuario motivo", description: "Registra uma advertência e avisa a pessoa.", admin: true },
      { name: "/avisar", usage: "/avisar @usuario motivo", description: "Mesmo que /warn: registra uma advertência e avisa a pessoa.", admin: true },
      { name: "/kick", usage: "/kick @usuario motivo", description: "Expulsa a pessoa do servidor (com hierarquia).", admin: true },
      { name: "/ban", usage: "/ban @usuario motivo", description: "Expulsa e bane a pessoa do servidor.", admin: true },
      { name: "/clear", usage: "/clear quantidade", description: "Apaga as últimas mensagens do canal.", admin: true },
    ],
    config: {
      enabled: true,
      warnNotify: true,
      spamEnabled: false,
      spamLimit: 8,
      spamWindow: 10,
      spamAction: "block",
    },
  },
  {
    id: "app_nexo_logs",
    name: "Nexo Logs",
    description:
      "Registra entradas, saídas, banimentos e ações administrativas no canal de logs que você escolher. Nunca lê mensagens privadas.",
    avatar: "list",
    category: "Logs",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [],
    config: {
      enabled: true,
      channelId: "",
      events: { join: true, leave: true, moderation: true, channels: true },
    },
  },
  {
    id: "app_nexo_autorole",
    name: "Nexo AutoRole",
    description:
      "Atribui automaticamente um cargo a toda pessoa que entrar no servidor, sem tocar no dono nem em administradores.",
    avatar: "tag",
    category: "AutoRole",
    developer: "Nexo Oficial",
    permissions: ["manageRoles", "manageMembers"],
    commands: [],
    config: { enabled: true, roleId: "" },
  },
  {
    id: "app_nexo_utils",
    name: "Nexo Utilidades",
    description:
      "Informação do servidor e das pessoas em tempo real: /ping, /help, /serverinfo e /userinfo com dados verdadeiros.",
    avatar: "tool",
    category: "Utilidades",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/ping", usage: "/ping", description: "Verifica se os apps do Nexo estão respondendo.", admin: false },
      { name: "/help", usage: "/help", description: "Lista os comandos disponíveis neste servidor.", admin: false },
      { name: "/serverinfo", usage: "/serverinfo", description: "Mostra dados reais do servidor.", admin: false },
      { name: "/userinfo", usage: "/userinfo @usuario", description: "Mostra dados reais de uma pessoa.", admin: false },
    ],
    config: { enabled: true },
  },
  {
    id: "app_nexo_ajuda",
    name: "Nexo Ajuda",
    description:
      "Central de ajuda do servidor: /ajuda lista os comandos instalados com exemplos e /regras mostra as regras escritas por quem gerencia o servidor.",
    avatar: "info",
    category: "Utilidades",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/ajuda", usage: "/ajuda", description: "Lista os comandos disponíveis e como usá-los.", admin: false },
      { name: "/regras", usage: "/regras", description: "Mostra as regras do servidor definidas na Central de Bots.", admin: false },
    ],
    config: { enabled: true, rules: "" },
  },
  {
    id: "app_nexo_enquete",
    name: "Nexo Enquetes",
    description:
      "Crie enquetes no chat, vote com um número e veja o resultado em tempo real. Um voto por pessoa por padrão (dá para permitir trocar o voto); os votos ficam registrados no servidor.",
    avatar: "checkCircle",
    category: "Utilidades",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/enquete", usage: "/enquete criar Pergunta | opção 1 | opção 2", description: "Cria uma enquete com 2 a 10 opções.", admin: false },
      { name: "/enquete votar", usage: "/enquete votar <número>", description: "Vota na opção indicada (1 voto por pessoa).", admin: false },
      { name: "/enquete resultado", usage: "/enquete resultado", description: "Mostra a contagem atual da enquete.", admin: false },
      { name: "/enquete listar", usage: "/enquete listar", description: "Lista as enquetes do servidor.", admin: false },
      { name: "/enquete fechar", usage: "/enquete fechar <id>", description: "Encerra uma enquete (quem criou ou quem gerencia).", admin: false },
    ],
    config: { enabled: true, pollAllowChange: false },
  },
  {
    id: "app_nexo_lembrete",
    name: "Nexo Lembretes",
    description:
      "Crie lembretes com prazo em minutos, liste e cancele quando quiser. O aviso chega na próxima vez que você abrir o Nexo — não existe executor em segundo plano, e o app avisa isso com clareza.",
    avatar: "bell",
    category: "Utilidades",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/lembrete", usage: "/lembrete criar <minutos> <texto>", description: "Cria um lembrete com prazo em minutos.", admin: false },
      { name: "/lembrete listar", usage: "/lembrete listar", description: "Lista seus lembretes pendentes e entregues.", admin: false },
      { name: "/lembrete cancelar", usage: "/lembrete cancelar <id>", description: "Cancela um lembrete pendente.", admin: false },
    ],
    config: { enabled: true },
  },
  /* ---------------------- Nexo AutoMod ----------------------- */
  {
    id: "app_nexo_automod",
    name: "Nexo AutoMod",
    description:
      "Bloqueia termos configurados antes da mensagem ser publicada: a mensagem com o termo não entra no canal e o servidor registra o ocorrido. Quem modera é isento. Nada além do texto enviado ao canal é analisado.",
    avatar: "shield",
    category: "Moderação",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/automod", usage: "/automod", description: "Mostra os termos bloqueados do servidor.", admin: false },
      { name: "/automod add", usage: "/automod add <termo>", description: "Bloqueia um termo (quem gerencia o servidor).", admin: true },
      { name: "/automod remove", usage: "/automod remove <termo>", description: "Remove um termo da lista (quem gerencia).", admin: true },
      { name: "/automod limpar", usage: "/automod limpar", description: "Esvazia a lista de termos (quem gerencia).", admin: true },
    ],
    config: { enabled: true, blockedWords: "" },
  },
  /* --------------------- Nexo Sugestões ---------------------- */
  {
    id: "app_nexo_sugestoes",
    name: "Nexo Sugestões",
    description:
      "Caixa de sugestões do servidor: qualquer membro sugere, todos votam e quem gerencia aprova ou recusa com um comentário. As sugestões ficam no servidor, não no perfil de ninguém.",
    avatar: "sparkle",
    category: "Comunidade",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/sugestao", usage: "/sugestao", description: "Ajuda dos comandos de sugestões.", admin: false },
      { name: "/sugerir", usage: "/sugerir <sugestão>", description: "Envia uma sugestão para a caixa.", admin: false },
      { name: "/sugestoes", usage: "/sugestoes [abertas|aprovadas|recusadas|todas]", description: "Lista as sugestões.", admin: false },
      { name: "/sugestao votar", usage: "/sugestao votar <id>", description: "Vote (ou retire o voto) em uma sugestão aberta.", admin: false },
      { name: "/sugestao avaliar", usage: "/sugestao avaliar <id> <aprovar|recusar> [comentário]", description: "Avalia uma sugestão (quem gerencia).", admin: true },
    ],
    config: { enabled: true },
  },
  /* ----------------------- Nexo Tarefas ---------------------- */
  {
    id: "app_nexo_tarefas",
    name: "Nexo Tarefas",
    description:
      "Quadro de tarefas simples no chat: crie, atribua a um membro, acompanhe o status e feche quando concluir. Cada servidor tem sua própria lista.",
    avatar: "check",
    category: "Utilidades",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/tarefa", usage: "/tarefa", description: "Ajuda dos comandos de tarefas.", admin: false },
      { name: "/tarefa criar", usage: "/tarefa criar <título>", description: "Cria uma tarefa aberta.", admin: false },
      { name: "/tarefas", usage: "/tarefas [abertas|feitas]", description: "Lista as tarefas do servidor.", admin: false },
      { name: "/tarefa status", usage: "/tarefa status <id> <aberta|feita>", description: "Muda o status de uma tarefa.", admin: false },
      { name: "/tarefa atribuir", usage: "/tarefa atribuir <id> @usuario", description: "Atribui a tarefa a um membro.", admin: false },
      { name: "/tarefa remover", usage: "/tarefa remover <id>", description: "Remove uma tarefa (quem criou ou quem gerencia).", admin: false },
    ],
    config: { enabled: true },
  },
  /* ------------------------ Nexo Notas ----------------------- */
  {
    id: "app_nexo_notas",
    name: "Nexo Notas",
    description:
      "Notas pessoais guardadas na sua conta — e só suas. Anote links, ideias e lembretes e consulte quando quiser; ninguém mais no servidor lê essas notas.",
    avatar: "book",
    category: "Utilidades",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/nota", usage: "/nota <texto>", description: "Salva uma nota pessoal (só você vê).", admin: false },
      { name: "/notas", usage: "/notas", description: "Lista suas notas pessoais.", admin: false },
      { name: "/nota apagar", usage: "/nota apagar <id>", description: "Apaga uma das suas notas.", admin: false },
    ],
    config: { enabled: true },
  },
  /* -------------------- Nexo Aniversários -------------------- */
  {
    id: "app_nexo_aniversarios",
    name: "Nexo Aniversários",
    description:
      "Aniversários somente quando a pessoa informa a própria data. Quem define entra na lista do servidor e qualquer membro consulta os próximos — nada é coletado automaticamente.",
    avatar: "calendar",
    category: "Comunidade",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/aniversario definir", usage: "/aniversario definir <DD/MM>", description: "Registra seu aniversário na lista do servidor.", admin: false },
      { name: "/aniversario", usage: "/aniversario", description: "Mostra seu aniversário registrado e o total da lista.", admin: false },
      { name: "/aniversarios", usage: "/aniversarios", description: "Lista os próximos aniversários do servidor.", admin: false },
      { name: "/aniversario tirar", usage: "/aniversario tirar", description: "Remove seu aniversário da lista.", admin: false },
    ],
    config: { enabled: true },
  },
  /* -------------------------- Nexo FAQ ----------------------- */
  {
    id: "app_nexo_faq",
    name: "Nexo FAQ",
    description:
      "Perguntas e respostas do servidor: quem gerencia cadastra as dúvidas frequentes e qualquer membro consulta por palavra-chave, sem sair do chat.",
    avatar: "info",
    category: "Comunidade",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/faq add", usage: "/faq add <pergunta> :: <resposta>", description: "Cadastra uma pergunta no FAQ (quem gerencia).", admin: true },
      { name: "/faq listar", usage: "/faq listar", description: "Mostra todas as perguntas cadastradas.", admin: false },
      { name: "/faq apagar", usage: "/faq apagar <id>", description: "Remove uma pergunta do FAQ (quem gerencia).", admin: true },
      { name: "/faq", usage: "/faq <palavra>", description: "Busca no FAQ por palavra-chave.", admin: false },
    ],
    config: { enabled: true },
  },
  /* ------------------------ Nexo Eventos --------------------- */
  {
    id: "app_nexo_eventos",
    name: "Nexo Eventos",
    description:
      "Crie eventos no servidor, abra inscrições e acompanhe quem vai. Sem executor em segundo plano: o estado é o do servidor e pode ser consultado a qualquer momento.",
    avatar: "clock",
    category: "Comunidade",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/evento", usage: "/evento", description: "Ajuda dos comandos de eventos.", admin: false },
      { name: "/evento criar", usage: "/evento criar <nome>", description: "Cria um evento com inscrições abertas.", admin: false },
      { name: "/eventos", usage: "/eventos", description: "Lista os eventos do servidor.", admin: false },
      { name: "/evento inscrever", usage: "/evento inscrever <id>", description: "Inscreve você no evento.", admin: false },
      { name: "/evento sair", usage: "/evento sair <id>", description: "Remove sua inscrição.", admin: false },
      { name: "/evento encerrar", usage: "/evento encerrar <id>", description: "Encerra as inscrições (quem gerencia).", admin: true },
    ],
    config: { enabled: true },
  },
  /* ------------------- Nexo Estatísticas --------------------- */
  {
    id: "app_nexo_stats",
    name: "Nexo Estatísticas",
    description:
      "Números reais do servidor: membros humanos, canais, categorias, cargos, mensagens e apps instalados — lidos do banco nesta hora, sem estimativas.",
    avatar: "list",
    category: "Utilidades",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/stats", usage: "/stats", description: "Mostra as estatísticas reais do servidor.", admin: false },
    ],
    config: { enabled: true },
  },
  /* -------------------- Nexo Auditoria ----------------------- */
  {
    id: "app_nexo_auditoria",
    name: "Nexo Auditoria",
    description:
      "Consulta rápida do histórico de ações administrativas registradas no servidor (avisos, expulsões, banimentos, mudanças de canal e instalação de apps). Só quem gerencia consulta.",
    avatar: "pin",
    category: "Logs",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/auditoria", usage: "/auditoria [quantidade]", description: "Mostra as últimas ações registradas (quem gerencia).", admin: true },
    ],
    config: { enabled: true },
  },
  /* ----------------------- Nexo Status ----------------------- */
  {
    id: "app_nexo_status",
    name: "Nexo Status",
    description:
      "Mostra se a API do Nexo está respondendo, qual banco de dados está em uso e há quanto tempo o serviço está de pé. Informação pública do serviço — nada de chaves ou dados internos.",
    avatar: "heart",
    category: "Utilidades",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/status", usage: "/status", description: "Verifica a disponibilidade dos serviços do Nexo.", admin: false },
    ],
    config: { enabled: true },
  },
  /* ------------------------ Nexo Dados ----------------------- */
  {
    id: "app_nexo_dados",
    name: "Nexo Dados",
    description:
      "Sorteios honestos no chat: dado de N lados, cara ou coroa, sorteio aleatório de um membro e respostas de bola de cristal — aleatoriedade real do servidor, sem palpite.",
    avatar: "star",
    category: "Diversão",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/dado", usage: "/dado [lados]", description: "Rola um dado de 2 a 100 lados.", admin: false },
      { name: "/moeda", usage: "/moeda", description: "Cara ou coroa.", admin: false },
      { name: "/sorteio", usage: "/sorteio", description: "Sorteia um membro do servidor.", admin: false },
      { name: "/sorte", usage: "/sorte <pergunta>", description: "Bola de cristal responde sua pergunta.", admin: false },
    ],
    config: { enabled: true },
  },
  /* ----------------------- Nexo Trivia ----------------------- */
  {
    id: "app_nexo_trivia",
    name: "Nexo Trivia",
    description:
      "Perguntas originais do Nexo em português: responda com a letra, some pontos e compare o placar do servidor. Sem banco externo — as perguntas vêm junto do app.",
    avatar: "gamepad",
    category: "Diversão",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/trivia", usage: "/trivia", description: "Publica uma nova pergunta com alternativas embaralhadas.", admin: false },
      { name: "/trivia responder", usage: "/trivia responder <letra>", description: "Responde a pergunta em aberto.", admin: false },
      { name: "/trivia placar", usage: "/trivia placar", description: "Mostra o placar do servidor.", admin: false },
    ],
    config: { enabled: true },
  },
  /* --------------------- Nexo Comunicados -------------------- */
  {
    id: "app_nexo_comunicados",
    name: "Nexo Comunicados",
    description:
      "Publique comunicados formatados no canal combinado, só para quem gerencia o servidor. O bot entrega o texto exatamente como escrito — nada é enviado sem o comando.",
    avatar: "bell",
    category: "Utilidades",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/comunicado", usage: "/comunicado <texto>", description: "Publica um comunicado no canal configurado (quem gerencia).", admin: true },
    ],
    config: { enabled: true, channelId: "" },
  },
  /* ------------------------ Nexo Mídia ----------------------- */
  {
    id: "app_nexo_midia",
    name: "Nexo Mídia",
    description:
      "Organize links de mídia compartilhados na comunidade: salve com título, liste por ordem de envio e remova os seus. Apenas links — nenhum arquivo é hospedado aqui.",
    avatar: "link",
    category: "Utilidades",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/midia salvar", usage: "/midia salvar <link> [título]", description: "Salva um link de mídia na lista.", admin: false },
      { name: "/midia", usage: "/midia", description: "Lista as mídias compartilhadas.", admin: false },
      { name: "/midia remover", usage: "/midia remover <id>", description: "Remove um item (quem salvou ou quem gerencia).", admin: false },
    ],
    config: { enabled: true },
  },
  /* --------------------- Nexo Tradutor ----------------------- */
  {
    id: "app_nexo_tradutor",
    name: "Nexo Tradutor",
    description:
      "Tradução automática exige um serviço externo com licença e chave de API, que o Nexo ainda não possui. O app fica visível para deixar claro o que falta — nenhum resultado inventado.",
    avatar: "compass",
    category: "Utilidades",
    developer: "Nexo Oficial",
    integration: "external",
    externalNote:
      "O app **Nexo Tradutor** requer um serviço externo de tradução com licença e chave de API, que o Nexo ainda não possui. " +
      "Nenhum resultado é inventado — a instalação fica desabilitada até existir essa integração.",
    permissions: ["sendMessages"],
    commands: [
      { name: "/traduzir", usage: "/traduzir <idioma> <texto>", description: "Traduziria o texto (requer serviço externo de tradução).", admin: false, external: true },
    ],
    config: { enabled: false },
  },
  {
    id: "app_nexo_musica",
    name: "Nexo Música",
    description:
      "Tocar música em canais de voz exige um servidor de áudio externo (um player de streaming separado do Nexo), que ainda não existe aqui. Este app fica visível para deixar claro o que falta — a instalação está desabilitada até existir essa integração. Nenhum botão de tocar vai funcionar no vazio.",
    avatar: "play",
    category: "Música",
    developer: "Nexo Oficial",
    integration: "external",
    externalNote:
      "O app **Nexo Música** requer um servidor de áudio externo que o Nexo ainda não possui. " +
      "A instalação está desabilitada até existir essa integração — preferimos dizer isso a mostrar um botão que não funciona.",
    permissions: ["sendMessages"],
    commands: [
      { name: "/tocar", usage: "/tocar <url ou busca>", description: "Tocaria uma faixa na call (requer servidor de áudio externo).", admin: false, external: true },
      { name: "/pausar", usage: "/pausar", description: "Pausaria a faixa atual (requer servidor de áudio externo).", admin: false, external: true },
      { name: "/fila", usage: "/fila", description: "Mostraria a fila de reprodução (requer servidor de áudio externo).", admin: false, external: true },
    ],
    config: { enabled: false },
  },

  /* --------------------- Nexo Ranking ----------------------- */
  {
    id: "app_nexo_ranking",
    name: "Nexo Ranking",
    description:
      "Consulta o que já aconteceu no servidor, com dados reais: quem mais escreveu nos últimos dias, quem está conectado agora e quem não aparece faz tempo. Nada aqui é estimativa — cada número vem das mensagens e da presença gravadas.",
    avatar: "arrowUp",
    category: "Utilidades",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/top", usage: "/top [quantos]", description: "Quem mais escreveu nos canais nos últimos 30 dias.", admin: false },
      { name: "/online", usage: "/online", description: "Membros conectados agora (contagem real de presença).", admin: false },
      { name: "/inativos", usage: "/inativos [dias]", description: "Membros que não escrevem há tantos dias.", admin: false },
    ],
    config: { enabled: true, topDays: 30, inactiveDays: 30 },
  },
  /* ----------------------- Nexo Busca ------------------------ */
  {
    id: "app_nexo_busca",
    name: "Nexo Busca",
    description:
      "Procura um texto nas mensagens do canal em que você está e gera uma transcrição das últimas mensagens para você guardar. A busca só enxerga o canal que você já pode ver — nada de ler conversas alheias.",
    avatar: "search",
    category: "Utilidades",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/buscar", usage: "/buscar <termo>", description: "Procura um termo nas mensagens deste canal.", admin: false },
      { name: "/exportar", usage: "/exportar [quantas]", description: "Transcrição das últimas mensagens deste canal.", admin: false },
    ],
    config: { enabled: true, searchLimit: 20, exportLimit: 50 },
  },
  /* --------------------- Nexo Sorteios ----------------------- */
  {
    id: "app_nexo_sorteio",
    name: "Nexo Sorteios",
    description:
      "Sorteia pessoas de verdade entre os membros do servidor, sozinho ou por cargo. Quem entra no sorteio é quem é membro mesmo — nenhum nome é inventado e o resultado mostra de onde saiu cada escolhido.",
    avatar: "sparkles",
    category: "Diversão",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/sortear", usage: "/sortear [quantos]", description: "Sorteia membros entre todos os do servidor.", admin: false },
      { name: "/sortear-cargo", usage: "/sortear-cargo @cargo [quantos]", description: "Sorteia só entre quem tem aquele cargo.", admin: false },
    ],
    config: { enabled: true },
  },
  /* ----------------------- Nexo Tempo ------------------------ */
  {
    id: "app_nexo_tempo",
    name: "Nexo Tempo",
    description:
      "Quanto tempo faz que alguém está no servidor, quando entrou e quem já está aqui há mais tempo. Datas tiradas do registro real de entrada de cada membro.",
    avatar: "clock",
    category: "Utilidades",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/tempo", usage: "/tempo [@usuario]", description: "Há quanto tempo você ou alguém está no servidor.", admin: false },
      { name: "/antiguidade", usage: "/antiguidade", description: "Os que estão aqui há mais tempo e os que chegaram agora.", admin: false },
    ],
    config: { enabled: true },
  },
  /* --------------------- Nexo Convites ----------------------- */
  {
    id: "app_nexo_convites",
    name: "Nexo Convites",
    description:
      "Lista os convites ativos do servidor e permite revogar um deles pelo código. Só quem já pode gerenciar convites usa estes comandos — a conferência de permissão é feita no servidor, não no botão.",
    avatar: "link",
    category: "Utilidades",
    developer: "Nexo Oficial",
    permissions: ["sendMessages"],
    commands: [
      { name: "/convites", usage: "/convites", description: "Lista os convites ativos do servidor.", admin: false },
      { name: "/revogar", usage: "/revogar <codigo>", description: "Revoga um convite pelo código.", admin: false },
    ],
    config: { enabled: true },
  },
];

const APP_BY_ID = {};
OFFICIAL_APPS.forEach((a) => (APP_BY_ID[a.id] = a));

/* catálogo gravado no banco (idempotente).
   `avatar`, `category`, `name`, `description`, `commands` e
   `permissions` são METADADOS do catálogo oficial (a tabela
   `apps` não tem rota de escrita para o usuário; instalações vivem em
   `server_apps`), então são re-sincronizados de OFFICIAL_APPS a cada
   partida — assim um ajuste no catálogo chega às instalações antigas
   sem DDL e sem tocar em nada que o usuário criou. */
let catalogReady = null;
async function ensureCatalog() {
  if (catalogReady) return catalogReady;
  catalogReady = (async () => {
    for (const app of OFFICIAL_APPS) {
      try {
        const rows = await db.select("apps", { where: { id: app.id }, limit: 1 });
        if (rows && rows.length) {
          const cur = rows[0];
          const sameCommands = JSON.stringify(cur.commands || []) === JSON.stringify(app.commands || []);
          const samePerms = JSON.stringify(cur.permissions || []) === JSON.stringify(app.permissions || []);
          if (
            cur.avatar !== app.avatar ||
            cur.category !== app.category ||
            cur.name !== app.name ||
            cur.description !== app.description ||
            !sameCommands ||
            !samePerms
          ) {
            await db.update(
              "apps",
              { where: { id: app.id } },
              {
                avatar: app.avatar,
                category: app.category,
                name: app.name,
                description: app.description,
                commands: app.commands.slice(),
                permissions: app.permissions.slice(),
              }
            );
          }
          continue;
        }
        await db.insert("apps", {
          id: app.id,
          name: app.name,
          description: app.description,
          avatar: app.avatar,
          category: app.category,
          developer: app.developer,
          permissions: app.permissions.slice(),
          commands: app.commands.slice(),
          enabled: true,
          createdAt: now(),
        });
      } catch (e) {
        /* catálogo é só de leitura: nunca derruba a requisição */
      }
    }
  })();
  return catalogReady;
}

/* ------------------------------------------------------------
   BOTS CRIADOS POR USUÁRIOS
   Guardados na MESMA tabela `apps` com id `bot_…`, usando as
   colunas existentes: `developer` = id de quem criou e `commands`
   = JSON {list, settings}. Sem DDL, sem tabela nova — e a execução
   é fechada aqui: só ações validadas por este arquivo, nunca
   código de terceiros.
   ------------------------------------------------------------ */
const BOT_ACTIONS = ["responder", "aleatorio", "info"];
const BOT_PERMS = ["sendMessages"];
const BOT_CATEGORIES = ["Comunidade", "Moderação", "Diversão", "Utilidades", "Logs"];
const MAX_BOTS_PER_USER = 5;
const MAX_BOT_COMMANDS = 10;

function isCustomId(id) {
  const s = String(id || "");
  return s.indexOf("bot_") === 0 && s.indexOf("app_nexo_") !== 0;
}

function customOf(row) {
  const raw = row && row.commands;
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    list: Array.isArray(obj.list) ? obj.list : [],
    settings: obj.settings && typeof obj.settings === "object" ? obj.settings : {},
  };
}

async function customAppRow(id) {
  if (!isCustomId(id)) return null;
  const rows = await db.select("apps", { where: { id }, limit: 1 });
  return rows && rows[0] ? rows[0] : null;
}

/* valida um comando do editor visual — tipos fechados e texto curto */
function cleanBotCommand(raw) {
  const name = String((raw && raw.name) || "").trim().toLowerCase();
  if (!/^\/[a-z0-9]{2,24}$/.test(name))
    throw bad("Comando inválido: use “/” seguido de 2 a 24 caracteres (letras e números), como /regras.");
  const desc = String((raw && raw.description) || "").slice(0, 120);
  const a = (raw && raw.action) || {};
  const type = String(a.type || "");
  if (type === "responder") {
    const text = String(a.text || "").trim();
    if (!text || text.length > 600)
      throw bad("Comando " + name + ": a resposta “responder” precisa de 1 a 600 caracteres.");
    return { name, description: desc, action: { type, text } };
  }
  if (type === "aleatorio") {
    const options = (Array.isArray(a.options) ? a.options : [])
      .map((o) => String(o).trim()).filter(Boolean).slice(0, 12);
    if (options.length < 2)
      throw bad("Comando " + name + ": “respostas aleatórias” precisa de pelo menos 2 opções.");
    return { name, description: desc, action: { type, options: options.map((o) => o.slice(0, 200)) } };
  }
  if (type === "info") return { name, description: desc, action: { type } };
  throw bad("Comando " + name + ": ação desconhecida. Tipos válidos: " + BOT_ACTIONS.join(", ") + ".");
}

/* linhas do banco servidas ao cliente: o OFFICIAL_APPS é a fonte
   verdadeira de metadados (comandos novos, selo de integração etc.),
   então servimos a definição oficial quando conhecida — a coluna
   `apps` não tem campo de "status" e não precisa ter DDL. */
function catalogRow(row) {
  if (!row) return row;
  const def = APP_BY_ID[row.id];
  if (!def) {
    if (!isCustomId(row.id)) return row;
    /* bot de usuário: `commands` guarda {list, settings} — servimos a
       lista de comandos no formato que o cliente já entende. */
    const c = customOf(row);
    const reports = (c.settings.reports && typeof c.settings.reports === "object") ? c.settings.reports : {};
    return Object.assign({}, row, {
      commands: c.list,
      permissions: Array.isArray(row.permissions) ? row.permissions : [],
      custom: {
        ownerId: row.developer || "",
        prefix: c.settings.prefix || "/",
        welcome: c.settings.welcome || "",
        published: !!c.settings.published,
        reports: Number(reports.count) || 0,
      },
    });
  }
  return Object.assign({}, row, {
    name: def.name,
    description: def.description,
    avatar: def.avatar,
    category: def.category,
    developer: def.developer,
    permissions: (def.permissions || []).slice(),
    commands: (def.commands || []).slice(),
    integration: def.integration === "external" ? "external" : "builtin",
  });
}

async function installsOf(serverId) {
  const rows = await db.select("server_apps", { where: { server_id: serverId }, limit: 100 });
  return rows || [];
}

async function loadInstall(id) {
  const rows = await db.select("server_apps", { where: { id }, limit: 1 });
  return rows && rows[0] ? rows[0] : null;
}

/* permissões que um instalador pode conceder = permissões dele */
function grantable(ctxS, userId) {
  const perms = acl.effectivePerms(ctxS, userId);
  return perms;
}

function cleanPermList(app, requested) {
  const allowed = Array.isArray(app.permissions) ? app.permissions : [];
  const want = Array.isArray(requested) ? requested : allowed.slice();
  return want.filter((p) => allowed.indexOf(p) !== -1);
}

/* configuração aceita por app (whitelist — nada de campo inventado) */
const CONFIG_KEYS = {
  app_nexo_welcome: ["enabled", "channelId", "message", "includeName", "includeAvatar"],
  app_nexo_mod: ["enabled", "warnNotify", "spamEnabled", "spamLimit", "spamWindow", "spamAction"],
  app_nexo_logs: ["enabled", "channelId", "events"],
  app_nexo_autorole: ["enabled", "roleId"],
  app_nexo_utils: ["enabled"],
  app_nexo_ajuda: ["enabled", "rules"],
  app_nexo_enquete: ["enabled", "pollAllowChange"],
  app_nexo_lembrete: ["enabled"],
  app_nexo_automod: ["enabled", "blockedWords"],
  app_nexo_sugestoes: ["enabled"],
  app_nexo_tarefas: ["enabled"],
  app_nexo_notas: ["enabled"],
  app_nexo_aniversarios: ["enabled"],
  app_nexo_faq: ["enabled"],
  app_nexo_eventos: ["enabled"],
  app_nexo_stats: ["enabled"],
  app_nexo_auditoria: ["enabled"],
  app_nexo_status: ["enabled"],
  app_nexo_dados: ["enabled"],
  app_nexo_trivia: ["enabled"],
  app_nexo_comunicados: ["enabled", "channelId"],
  app_nexo_midia: ["enabled"],
  app_nexo_ranking: ["enabled", "topDays", "inactiveDays"],
  app_nexo_busca: ["enabled", "searchLimit", "exportLimit"],
  app_nexo_sorteio: ["enabled"],
  app_nexo_tempo: ["enabled"],
  app_nexo_convites: ["enabled"],
  /* app_nexo_musica e app_nexo_tradutor não instalam: nenhuma chave */
};

function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function cleanConfig(appId, raw) {
  const keys = CONFIG_KEYS[appId] || ["enabled"];
  const out = {};
  const src = raw && typeof raw === "object" ? raw : {};
  keys.forEach((k) => {
    if (src[k] === undefined) return;
    let v = src[k];
    if (k === "enabled") v = !!v;
    else if (k === "includeName" || k === "includeAvatar" || k === "spamEnabled" || k === "pollAllowChange" || k === "warnNotify") v = !!v;
    else if (k === "spamLimit") v = clampInt(v, 8, 2, 50);
    else if (k === "spamWindow") v = clampInt(v, 10, 3, 300);
    else if (k === "spamAction") v = v === "clear" ? "clear" : "block";
    /* limites de consulta dos apps novos — sempre com teto, para
       um valor enviado pela interface não virar varredura infinita */
    else if (k === "topDays") v = clampInt(v, 30, 1, 365);
    else if (k === "inactiveDays") v = clampInt(v, 30, 1, 365);
    else if (k === "searchLimit") v = clampInt(v, 20, 1, 50);
    else if (k === "exportLimit") v = clampInt(v, 50, 5, 200);
    else if (k === "events") {
      v = v && typeof v === "object" ? v : {};
      const ev = {};
      ["join", "leave", "moderation", "channels"].forEach((e) => (ev[e] = v[e] !== false));
      v = ev;
    } else if (k === "rules") v = String(v).slice(0, 2000);
    else v = String(v).slice(0, 400);
    out[k] = v;
  });
  return out;
}

/* estado por servidor gravado direto na configuração da instalação
   (mesmo padrão das enquetes — sem DDL, sem tabela nova). As chaves
   de estado passam por fora do whitelist do cleanConfig, então um
   PATCH de configuração nunca apaga o que os comandos gravaram. */
async function saveCfgState(install, patch) {
  const newCfg = Object.assign({}, install.configuration || {}, patch);
  await db.update(
    "server_apps",
    { where: { id: install.id } },
    { configuration: newCfg, updatedAt: now() }
  );
  install.configuration = newCfg;
  return newCfg;
}

/* enxame de perguntas da Nexo Trivia — conteúdo original, sem banco
   externo e sem texto de terceiros. `answer` é o ÍNDICE da opção. */
const TRIVIA_BANK = [
  { q: "Quantos canais o modelo “comunidade” cria ao criar um servidor no Nexo?", opts: ["2", "3", "5", "1"], answer: 1 },
  { q: "O que um bot do Nexo NUNCA é?", opts: ["Uma pessoa", "Um aplicativo", "Um integrante", "Um canal"], answer: 0 },
  { q: "Onde as permissões de um bot são validadas de verdade?", opts: ["No backend", "No navegador", "No aplicativo", "Na configuração visual"], answer: 0 },
  { q: "Como se chama o gradiente do cartão de perfil?", opts: ["appearance.card", "user.skin", "profile.css", "theme.card"], answer: 0 },
  { q: "O que o anti-spam do Nexo Moderação faz por padrão?", opts: ["Nada — é desligado", "Bloqueia tudo", "Apaga o servidor", "Banir todo mundo"], answer: 0 },
  { q: "Onde ficam os lembretes criados no Nexo Lembretes?", opts: ["Na sua conta", "No servidor", "No e-mail", "Na lixeira"], answer: 0 },
  { q: "Um app marcado como integração externa no catálogo…", opts: ["Fica visível mas não instala", "Instala em silêncio", "Some do catálogo", "Roda sozinho"], answer: 0 },
  { q: "Quantos votos por pessoa numa enquete padrão do Nexo?", opts: ["1", "2", "Ilimitados", "5"], answer: 0 },
  { q: "O que acontece quando o sync de boot falha num deep link?", opts: ["Tela de espera com retry", "Erro fatal", "Logout automático", "Abre a home em branco"], answer: 0 },
  { q: "Quem pode instalar apps num servidor do Nexo?", opts: ["Quem gerencia o servidor", "Qualquer visitante", "Só o criador do app", "Ninguém"], answer: 0 },
  { q: "As mensagens de bot carregam um marcador no conteúdo?", opts: ["Sim — «bot:id»", "Não — parecem pessoas", "Sim — @bot", "Só em DM"], answer: 0 },
  { q: "O que a Nexo Notas guarda das suas anotações?", opts: ["Só na sua conta", "No servidor inteiro", "Em e-mail", "Em arquivo público"], answer: 0 },
];

/* canal de texto válido dentro do servidor */
function textChannel(ctxS, channelId, fallbackFirst) {
  if (channelId) {
    const c = ctxS.channels.find((x) => x.id === channelId && x.type === "text");
    if (c) return c;
  }
  if (!fallbackFirst) return null;
  return ctxS.channels.find((c) => c.type === "text") || null;
}

/* ------------------------------------------------------------
   publica uma mensagem como bot (marcador + author real)
   ------------------------------------------------------------ */
async function botPost(ctxS, install, channel, text, actorId) {
  if (!channel) return null;
  /* defesa na porta: bot só fala em CANAL DE SERVIDOR. Uma DM tem
     id `dm_…` e nunca aparece aqui — se aparecer, abortamos. */
  if (String(channel.id || "").indexOf("dm_") === 0) return null;
  if (channel.serverId && ctxS.server && channel.serverId !== ctxS.server.id) return null;
  const perms = Array.isArray(install.permissions) ? install.permissions : [];
  if (perms.indexOf("sendMessages") === -1) return null;

  let senderId = actorId || install.installedBy || ctxS.server.ownerId;
  const exists = await db.select("users", { where: { id: senderId }, limit: 1 });
  if (!exists || !exists.length) senderId = ctxS.server.ownerId;

  const message = {
    id: u.uid("ms"),
    channelId: channel.id,
    conversationId: channel.id,
    authorId: senderId,
    senderId: senderId,
    content: (tag(install.id) + String(text || "")).slice(0, 2000),
    attachments: [],
    reactions: {},
    pinned: false,
    createdAt: now(),
    updatedAt: null,
  };
  await db.insert("messages", message);
  return message;
}

/* publica as respostas de um comando no canal e devolve o que foi
   enviado. Mesmo corpo do fim do runCommand, para comandos que
   encerram antes do fluxo comum — nada de publicar duas vezes. */
async function finish(list, ctxS, install, channel, actorId) {
  if (!list || !list.length) return null;
  const out = [];
  for (const line of list) {
    const msg = await botPost(ctxS, install, channel, line, actorId);
    if (msg) out.push(msg);
  }
  return out;
}

/* registro de auditoria em `logs` — mesmos campos que o handler de
   servidores usa (o mapa converte meta/at/target para o schema). */
async function logAudit(serverId, actorId, action, meta) {
  const entry = {
    id: u.uid("lg"),
    serverId: serverId,
    action: action,
    actorId: actorId || null,
    meta: meta || null,
    at: now(),
    createdAt: now(),
  };
  await db.insert("logs", entry);
  return entry;
}

/* ------------------------------------------------------------
   ganchos de eventos (chamados por handlers/servers.js)
   ------------------------------------------------------------ */

/* entrada de membro: AutoRole + Boas-vindas + Logs */
async function onMemberJoin(ctx) {
  const out = { roleId: null, messages: [] };
  try {
    await ensureCatalog();
    const installs = (await installsOf(ctx.serverId)).filter((i) => i.enabled !== false);
    if (!installs.length) return out;

    for (const install of installs) {
      const app = APP_BY_ID[install.appId];
      if (!app) {
        /* boas-vindas de bot criado por usuário — mensagem definida
           pelo criador, publicada só em canal de texto do servidor */
        if (!isCustomId(install.appId)) continue;
        const rowB = await customAppRow(install.appId);
        if (!rowB) continue;
        const welcome = (customOf(rowB).settings || {}).welcome;
        if (!welcome) continue;
        const chB = textChannel(ctx.ctxS, "", true);
        if (chB) {
          const textB = String(welcome)
            .replace(/\{usuario\}/g, "**@" + ctx.user.username + "**")
            .replace(/\{nome\}/g, ctx.user.displayName || ctx.user.username)
            .slice(0, 500);
          const msgB = await botPost(ctx.ctxS, install, chB, textB, ctx.user.id);
          if (msgB) out.messages.push(msgB);
        }
        continue;
      }
      const cfg = install.configuration || {};

      /* AutoRole: cargo automático (nunca sobre o dono) */
      if (install.appId === "app_nexo_autorole" && cfg.roleId) {
        const role = ctx.ctxS.roleById[cfg.roleId];
        const isOwner = ctx.ctxS.server.ownerId === ctx.user.id;
        if (role && !isOwner) out.roleId = role.id;
      }

      /* Boas-vindas */
      if (install.appId === "app_nexo_welcome" && cfg.enabled !== false && cfg.message) {
        const ch = textChannel(ctx.ctxS, cfg.channelId, true);
        if (ch) {
          const who =
            cfg.includeName === false
              ? "Alguém"
              : "**@" + ctx.user.username + "**";
          const avatar =
            cfg.includeAvatar !== false && ctx.user.avatar && ctx.user.avatar.emoji
              ? ctx.user.avatar.emoji + " "
              : "";
          const text = String(cfg.message)
            .replace(/\{usuario\}/g, who)
            .replace(/\{nome\}/g, ctx.user.displayName || ctx.user.username)
            .replace(/\{servidor\}/g, ctx.ctxS.server.name);
          const msg = await botPost(ctx.ctxS, install, ch, avatar + text, ctx.user.id);
          if (msg) out.messages.push(msg);
        }
      }

      /* Logs: entrada */
      if (install.appId === "app_nexo_logs" && (cfg.events || {}).join !== false) {
        const ch = textChannel(ctx.ctxS, cfg.channelId, true);
        if (ch) {
          const msg = await botPost(
            ctx.ctxS,
            install,
            ch,
            "Entrou: **@" + ctx.user.username + "** (`" + ctx.user.id + "`)",
            ctx.user.id
          );
          if (msg) out.messages.push(msg);
        }
      }
    }
  } catch (e) {
    /* ganchos nunca quebram a entrada no servidor */
  }
  return out;
}

/* eventos administrativos → app de Logs */
const EVENT_TEXT = {
  "member.leave": ["leave", "Saiu do servidor"],
  "member.kick": ["moderation", "Foi expulso"],
  "member.ban": ["moderation", "Foi banido"],
  "member.unban": ["moderation", "Banimento removido"],
  "channel.create": ["channels", "Canal criado"],
  "channel.delete": ["channels", "Canal apagado"],
  "message.delete": ["moderation", "Mensagem apagada"],
  "message.spam": ["moderation", "Anti-spam (mensagem não publicada)"],
};

async function onEvent(serverId, action, meta, ctxS) {
  try {
    const spec = EVENT_TEXT[action];
    if (!spec) return;
    await ensureCatalog();
    const installs = await installsOf(serverId);
    const install = installs.find(
      (i) => i.appId === "app_nexo_logs" && i.enabled !== false
    );
    if (!install) return;
    const cfg = install.configuration || {};
    if ((cfg.events || {})[spec[0]] === false) return;

    const server = ctxS ? ctxS.server : (await db.select("servers", { where: { id: serverId }, limit: 1 }))[0];
    const sctx = ctxS || (await acl.loadServer(serverId));
    const ch = textChannel(sctx, cfg.channelId, true);
    if (!ch) return;

    const details = [];
    if (meta && meta.username) details.push("@" + meta.username);
    if (meta && meta.reason) details.push("motivo: " + meta.reason);
    if (meta && meta.channel) details.push("#" + meta.channel);
    const msg = await botPost(
      sctx,
      install,
      ch,
      spec[1] + (details.length ? " — " + details.join(" · ") : ""),
      (meta && meta.actorId) || null
    );
    if (msg) {
      /* a interface puxa o novo canal no próximo sync */
      await db.update("messages", { where: { id: msg.id } }, { updatedAt: now() });
    }
  } catch (e) {
    /* logs são best-effort */
  }
}

/* ------------------------------------------------------------
   comandos (execução server-side dentro do envio de mensagem)
   ------------------------------------------------------------ */

function mentionToId(text) {
  const m = /(?:<@!?)?@?([a-zA-Z0-9_.]{2,32})/.exec(String(text || ""));
  return m ? m[1] : null;
}

async function findUserByArg(ctxS, arg) {
  if (!arg) return null;
  const clean = String(arg).replace(/^<@!?|>$/g, "").replace(/^@/, "").trim();
  if (!clean) return null;
  let rows = await db.select("users", { where: { id: clean }, limit: 1 });
  if (rows && rows.length) return rows[0];
  rows = await db.select("users", { where: { username: clean.toLowerCase() }, limit: 1 });
  if (rows && rows.length) return rows[0];
  rows = await db.select("users", { where: { display_name: clean }, limit: 1 });
  if (rows && rows.length) return rows[0];
  return null;
}

/* hierarquia: cargo mais alto vence; dono está no topo */
function rankOf(ctxS, userId) {
  if (ctxS.server.ownerId === userId) return 9999;
  const m = acl.membershipOf(ctxS, userId);
  if (!m) return -1;
  const role = m.roleId && ctxS.roleById[m.roleId];
  return role ? Number(role.position || 0) : 0;
}

/* executa o texto do usuário como comando, se ele casar com um app
   instalado. Devolve null quando não é comando deste servidor. */
async function runCommand(ctxS, channel, user, rawText) {
  const text = String(rawText || "").trim();
  if (text[0] !== "/") return null;
  const parts = text.split(/\s+/);
  const name = parts[0].toLowerCase();
  const args = parts.slice(1);

  await ensureCatalog();
  const installs = (await installsOf(ctxS.server.id)).filter((i) => i.enabled !== false);
  let install = null;
  let command = null;
  for (const i of installs) {
    const app = APP_BY_ID[i.appId];
    if (!app || !app.commands) continue;
    const cmd = app.commands.find((c) => c.name.toLowerCase() === name);
    if (cmd) {
      install = i;
      command = cmd;
      break;
    }
  }
  /* bots criados por usuários entram na disputa DEPOIS dos oficiais */
  let customApp = null;
  let customCmd = null;
  if (!install) {
    for (const i of installs) {
      if (!isCustomId(i.appId)) continue;
      const row = await customAppRow(i.appId);
      if (!row) continue;
      const def = customOf(row);
      const cmd = (def.list || []).find((c) => c && c.name && c.name.toLowerCase() === name);
      if (cmd) {
        install = i;
        customApp = row;
        customCmd = cmd;
        break;
      }
    }
  }
  if (!install) return null;

  const botPerms = Array.isArray(install.permissions) ? install.permissions : [];
  const cfg = install.configuration || {};
  const replies = [];

  /* --------- execução fechada dos bots criados por usuários ---------
     Só as ações validadas na criação (responder / aleatorio / info).
     Nenhum código de terceiros é interpretado aqui ou no navegador. */
  if (customCmd && customApp) {
    const act = customCmd.action || {};
    if (act.type === "responder" && act.text) replies.push(String(act.text).slice(0, 800));
    else if (act.type === "aleatorio" && Array.isArray(act.options) && act.options.length)
      replies.push(String(act.options[Math.floor(Math.random() * act.options.length)]).slice(0, 400));
    else if (act.type === "info") {
      const memberRowsI = (await db.select("memberships", { where: { server_id: ctxS.server.id }, limit: 5000 })) || [];
      replies.push(
        "**" + customApp.name + "**\n" +
          "• Servidor: **" + ctxS.server.name + "**\n" +
          "• Membros humanos: **" + memberRowsI.length + "**\n" +
          "• Canais: **" + ctxS.channels.length + "**\n" +
          "• Cargos: **" + ((ctxS.roles || []).length) + "**"
      );
    } else replies.push("O comando `" + (customCmd.name || "") + "` do bot **" + customApp.name + "** não tem uma ação disponível nesta versão.");
    if (!replies.length) return null;
    const outCustom = [];
    for (const line of replies) {
      const msg = await botPost(ctxS, install, channel, line, user.id);
      if (msg) outCustom.push(msg);
    }
    return outCustom.length ? outCustom : null;
  }

  const needBot = (k) => {
    if (botPerms.indexOf(k) === -1)
      throw forbidden("O app **" + APP_BY_ID[install.appId].name + "** não tem a permissão “" + k + "” neste servidor. Peça a quem o instalou para conceder.");
  };
  const needUser = (k) => {
    if (!acl.can(ctxS, user.id, k))
      throw forbidden("Você não tem permissão para usar “" + name + "” aqui.");
  };

  /* ------------------------- /ping ------------------------- */
  if (name === "/ping") {
    replies.push("Pong! Estou respondendo pelo servidor do Nexo em " + new Date().toISOString().slice(11, 19) + " (horário do servidor).");
  }

  /* ------------------------- /help ------------------------- */
  else if (name === "/help") {
    const lines = [];
    for (const i of installs) {
      const app = APP_BY_ID[i.appId];
      if (!app || !app.commands.length) continue;
      lines.push("**" + app.name + "**");
      app.commands.forEach((c) => lines.push("`" + c.usage + "` — " + c.description));
    }
    replies.push(lines.length ? lines.join("\n") : "Nenhum comando instalado neste servidor.");
  }

  /* --------------------- /serverinfo ---------------------- */
  else if (name === "/serverinfo") {
    const memberRows = (await db.select("memberships", { where: { server_id: ctxS.server.id }, limit: 5000 })) || [];
    const created = ctxS.server.createdAt ? new Date(ctxS.server.createdAt) : null;
    replies.push(
      "**" + ctxS.server.name + "**\n" +
        "• Membros humanos: **" + memberRows.length + "**\n" +
        "• Canais: **" + ctxS.channels.length + "** · Categorias: **" + ctxS.categories.length + "**\n" +
        "• Apps instalados: **" + installs.length + "**\n" +
        (created ? "• Criado em: **" + created.toLocaleDateString("pt-BR") + "**" : "")
    );
  }

  /* ---------------------- /userinfo ----------------------- */
  else if (name === "/userinfo") {
    const target = await findUserByArg(ctxS, args[0]);
    if (!target) throw bad("Mencione uma pessoa válida: /userinfo @usuario");
    const m = acl.membershipOf(ctxS, target.id);
    const role = m && m.roleId ? ctxS.roleById[m.roleId] : null;
    replies.push(
      "**" + (target.displayName || target.username) + "** (@" + target.username + ")\n" +
        "• ID: `" + target.id + "`\n" +
        "• Cargo: **" + (role ? role.name : (target.id === ctxS.server.ownerId ? "Dono" : "Membro")) + "**\n" +
        "• Status: **" + (target.status || "offline") + "**"
    );
  }

  /* ------------------------ /warn e /avisar ------------------------- */
  else if (name === "/warn" || name === "/avisar") {
    needBot("manageMembers");
    needUser("manageMembers");
    const target = await findUserByArg(ctxS, args[0]);
    if (!target) throw bad("Mencione a pessoa: " + name + " @usuario motivo");
    if (target.id === user.id) throw bad("Você não pode advertir a si mesmo.");
    if (target.id === ctxS.server.ownerId) throw bad("Você não pode advertir o dono do servidor.");
    const reason = args.slice(1).join(" ").slice(0, 200);
    if (cfg.warnNotify !== false) {
      await handlersAuth.createNotification(
        target.id,
        "server",
        "Advertência em " + ctxS.server.name + (reason ? ": " + reason : "."),
        { serverId: ctxS.server.id, href: "#/s/" + ctxS.server.id, actorId: user.id }
      );
    }
    const entry = require("./servers").log(ctxS.server.id, "member.warn", { userId: target.id, reason }, target.id, user.id);
    await entry;
    replies.push(
      "**@" + target.username + "** foi advertido por @" + user.username + "." +
        (reason ? "\nMotivo: " + reason : "")
    );
  }

  /* ------------------------ /kick ------------------------- */
  else if (name === "/kick") {
    needBot("kickMembers");
    needUser("kickMembers");
    const target = await findUserByArg(ctxS, args[0]);
    if (!target) throw bad("Mencione a pessoa: /kick @usuario motivo");
    if (target.id === user.id) throw bad("Você não pode expulsar a si mesmo.");
    if (target.id === ctxS.server.ownerId) throw bad("Você não pode expulsar o dono do servidor.");
    if (rankOf(ctxS, target.id) >= rankOf(ctxS, user.id) && ctxS.server.ownerId !== user.id)
      throw forbidden("Hierarquia: você não pode expulsar alguém com cargo igual ou superior.");
    const membership = acl.membershipOf(ctxS, target.id);
    if (!membership) throw notFound("Esta pessoa não faz parte do servidor.");
    const reason = args.slice(1).join(" ").slice(0, 200);
    await db.remove("memberships", { where: { id: membership.id } });
    await require("./servers").log(ctxS.server.id, "member.kick", { userId: target.id, reason, via: "bot" }, target.id, user.id);
    await handlersAuth.createNotification(
      target.id,
      "server",
      "Você foi expulso de " + ctxS.server.name + (reason ? " — " + reason : "."),
      { serverId: ctxS.server.id }
    );
    replies.push("**@" + target.username + "** foi expulso." + (reason ? " Motivo: " + reason : ""));
  }

  /* ------------------------- /ban ------------------------- */
  else if (name === "/ban") {
    needBot("banMembers");
    needUser("banMembers");
    const target = await findUserByArg(ctxS, args[0]);
    if (!target) throw bad("Mencione a pessoa: /ban @usuario motivo");
    if (target.id === user.id) throw bad("Você não pode banir a si mesmo.");
    if (target.id === ctxS.server.ownerId) throw bad("Você não pode banir o dono do servidor.");
    if (rankOf(ctxS, target.id) >= rankOf(ctxS, user.id) && ctxS.server.ownerId !== user.id)
      throw forbidden("Hierarquia: você não pode banir alguém com cargo igual ou superior.");
    const existing = ctxS.bans.find((b) => b.userId === target.id);
    if (existing) throw bad("Esta pessoa já está banida.");
    const reason = args.slice(1).join(" ").slice(0, 200);
    const ban = {
      id: ctxS.server.id + ":" + target.id,
      serverId: ctxS.server.id,
      userId: target.id,
      reason,
      byId: user.id,
      at: now(),
      createdAt: now(),
    };
    await db.insert("bans", ban);
    const membership = acl.membershipOf(ctxS, target.id);
    if (membership) await db.remove("memberships", { where: { id: membership.id } });
    await require("./servers").log(ctxS.server.id, "member.ban", { userId: target.id, reason, via: "bot" }, target.id, user.id);
    await handlersAuth.createNotification(
      target.id,
      "server",
      "Você foi banido de " + ctxS.server.name + (reason ? " — " + reason : "."),
      { serverId: ctxS.server.id }
    );
    replies.push("**@" + target.username + "** foi banido." + (reason ? " Motivo: " + reason : ""));
  }

  /* ------------------------ /clear ------------------------ */
  else if (name === "/clear") {
    needBot("deleteMessages");
    needUser("deleteMessages");
    const n = Math.max(1, Math.min(100, parseInt(args[0], 10) || 0));
    if (!n) throw bad("Use /clear quantidade (1 a 100).");
    const rows = (await db.select("messages", {
      where: { channel_id: channel.id },
      order: "createdAt",
      desc: true,
      limit: n,
    })) || [];
    for (const row of rows) await db.remove("messages", { where: { id: row.id } });
    await require("./servers").log(
      ctxS.server.id,
      "message.delete",
      { channel: "#" + channel.name, count: rows.length, via: "bot" },
      channel.id,
      user.id
    );
    replies.push("Apaguei **" + rows.length + "** mensagem(ns) de #" + channel.name + ".");
  }

  /* ---------------------- /welcome ------------------------ */
  else if (name === "/welcome") {
    if (!acl.can(ctxS, user.id, "manageServer") && ctxS.server.ownerId !== user.id)
      throw forbidden("Só quem gerencia o servidor configura as boas-vindas.");
    const installW = installs.find((i) => i.appId === "app_nexo_welcome");
    if (!installW) throw bad("O app de boas-vindas não está instalado neste servidor.");
    const flag = (args[0] || "").toLowerCase();
    if (flag === "on" || flag === "off") {
      const cfgW = Object.assign({}, installW.configuration || {}, { enabled: flag === "on" });
      await db.update("server_apps", { where: { id: installW.id } }, { configuration: cfgW, updatedAt: now() });
      replies.push("Boas-vindas " + (flag === "on" ? "**ativadas**" : "**desativadas**") + " neste servidor.");
    } else {
      const cfgW = installW.configuration || {};
      replies.push(
        "Boas-vindas estão **" + (cfgW.enabled === false ? "desligadas" : "ligadas") + "**.\n" +
          "Canal: " + (cfgW.channelId ? "definido" : "padrão") + "\n" +
          "Mensagem: " + String(cfgW.message || "").slice(0, 160) + "\n" +
          "Use `/welcome on` ou `/welcome off`."
      );
    }
  }

  /* ------------------------ /ajuda ------------------------ */
  else if (name === "/ajuda") {
    needBot("sendMessages");
    const lines = [];
    for (const i of installs) {
      const appA = APP_BY_ID[i.appId];
      if (!appA || !appA.commands.length) continue;
      lines.push("**" + appA.name + "**");
      appA.commands.forEach((c) => lines.push("`" + c.usage + "` — " + c.description));
    }
    if (!lines.length) {
      replies.push("Nenhum comando instalado neste servidor ainda.");
    } else {
      lines.push("");
      lines.push("`/regras` mostra as regras deste servidor · `/help` traz a mesma lista de comandos.");
      replies.push(lines.join("\n"));
    }
  }

  /* ------------------------ /regras ------------------------ */
  else if (name === "/regras") {
    needBot("sendMessages");
    const rules = String(cfg.rules || "").trim();
    if (rules) {
      replies.push("**Regras de " + ctxS.server.name + "**\n" + rules.slice(0, 2000));
    } else {
      replies.push(
        "Este servidor ainda não tem regras escritas. Quem gerencia pode cadastrá-las na Central de Bots → **Nexo Ajuda** → *Configurar*."
      );
    }
  }

  /* ------------------------ /enquete ---------------------- */
  else if (name === "/enquete") {
    needBot("sendMessages");
    const sub = (args[0] || "").toLowerCase();
    const polls = Array.isArray(cfg.polls) ? cfg.polls : [];
    const savePolls = async (list) => {
      const newCfg = Object.assign({}, install.configuration || {}, { polls: list.slice(0, 30) });
      await db.update(
        "server_apps",
        { where: { id: install.id } },
        { configuration: newCfg, updatedAt: now() }
      );
    };
    const findPoll = (id) => polls.filter((p) => p && p.id === id)[0] || null;
    const lastPoll = () => (polls.length ? polls[polls.length - 1] : null);
    /* votos = linhas insert-only em `logs` (auditoria do servidor);
       o último voto de cada pessoa é o que vale na contagem. */
    const loadVotes = async () => {
      const rows =
        (await db.select("logs", {
          where: { server_id: ctxS.server.id, action: "poll.vote" },
          limit: 800,
        })) || [];
      const latest = {};
      rows.forEach((r) => {
        const m = r.meta || {};
        if (!m.pollId) return;
        const prev = latest[m.pollId] && latest[m.pollId][r.actorId];
        if (!prev || Number(r.at || 0) >= Number(prev.at || 0)) {
          if (!latest[m.pollId]) latest[m.pollId] = {};
          latest[m.pollId][r.actorId] = { choice: Number(m.choice), at: Number(r.at || 0) };
        }
      });
      return { rows: rows, latest: latest };
    };
    const resultText = (poll, latest) => {
      const votes = latest[poll.id] || {};
      const total = Object.keys(votes).length;
      const lines = [
        "**Enquete " + poll.id + "**" + (poll.closed ? " (encerrada)" : " (aberta)") + ": " + poll.q,
      ];
      poll.options.forEach((opt, idx) => {
        const n = Object.keys(votes).filter((k) => votes[k].choice === idx + 1).length;
        const pct = total ? Math.round((n * 100) / total) : 0;
        lines.push("**" + (idx + 1) + ".** " + opt + " — **" + n + "** voto(s)" + (total ? " (" + pct + "%)" : ""));
      });
      lines.push("Total: **" + total + "** voto(s) · " + (cfg.pollAllowChange === true ? "troca de voto liberada" : "1 voto por pessoa"));
      return lines.join("\n");
    };

    if (!sub || sub === "ajuda" || sub === "help") {
      replies.push(
        "**Enquetes**\n" +
          "`/enquete criar Pergunta | opção 1 | opção 2` — cria (2 a 10 opções)\n" +
          "`/enquete votar <número>` — vota na opção indicada\n" +
          "`/enquete resultado` — mostra a contagem\n" +
          "`/enquete listar` — lista as enquetes\n" +
          "`/enquete fechar <id>` — encerra (quem criou ou quem gerencia)"
      );
    } else if (sub === "criar" || sub === "create" || sub === "nova") {
      const bits = args
        .slice(1)
        .join(" ")
        .split("|")
        .map((s) => s.trim())
        .filter((s) => s.length);
      if (bits.length < 3) throw bad("Use: /enquete criar Pergunta | opção 1 | opção 2 (2 a 10 opções).");
      const q = bits[0].slice(0, 200);
      const options = bits.slice(1, 11).map((s) => s.slice(0, 120));
      if (options.length < 2) throw bad("A enquete precisa de pelo menos 2 opções.");
      let n = polls.length + 1;
      while (findPoll("p" + n)) n++;
      const poll = { id: "p" + n, q: q, options: options, by: user.id, at: now(), closed: false };
      await savePolls(polls.concat([poll]));
      await require("./servers").log(
        ctxS.server.id,
        "poll.create",
        { pollId: poll.id, q: q },
        poll.id,
        user.id
      );
      replies.push(
        "**Enquete " + poll.id + "**: " + q + "\n" +
          options.map((o, idx) => "**" + (idx + 1) + ".** " + o).join("\n") +
          "\nVotem com `/enquete votar 1` até `" + options.length + "`. Resultado: `/enquete resultado`."
      );
    } else if (sub === "votar" || sub === "vote") {
      const choice = parseInt(args[1], 10);
      if (!choice || choice < 1) throw bad("Use: /enquete votar <número da opção>.");
      let poll = null;
      if (args[2]) poll = findPoll(String(args[2]).toLowerCase());
      if (!poll) {
        const open = polls.filter((p) => p && !p.closed);
        poll = open.length ? open[open.length - 1] : null;
      }
      if (!poll) throw bad("Não há enquete aberta. Veja `/enquete listar`.");
      if (poll.closed) throw bad("A enquete " + poll.id + " está encerrada — o resultado é `/enquete resultado " + poll.id + "`.");
      if (choice > poll.options.length)
        throw bad("Opção inválida: esta enquete tem " + poll.options.length + " opções.");
      const loaded = await loadVotes();
      const mine = (loaded.latest[poll.id] || {})[user.id];
      if (mine && cfg.pollAllowChange !== true)
        throw bad(
          "Você já votou na opção " + mine.choice + " desta enquete (regra: 1 voto por pessoa). " +
            "Quem gerencia pode liberar a troca de voto na Central de Bots (Nexo Enquetes → Configurar)."
        );
      await require("./servers").log(
        ctxS.server.id,
        "poll.vote",
        { pollId: poll.id, choice: choice, q: poll.q },
        poll.id,
        user.id
      );
      replies.push(
        mine
          ? "Voto trocado: agora você está na opção **" + choice + "** (era a " + mine.choice + ")."
          : "Voto registrado na opção **" + choice + "** — " + poll.options[choice - 1] + "."
      );
    } else if (sub === "resultado" || sub === "result" || sub === "results") {
      const poll = (args[1] && findPoll(String(args[1]).toLowerCase())) || lastPoll();
      if (!poll) throw bad("Não há nenhuma enquete aqui. Crie com `/enquete criar …`.");
      const loaded = await loadVotes();
      replies.push(resultText(poll, loaded.latest));
    } else if (sub === "listar" || sub === "list") {
      if (!polls.length) {
        replies.push("Nenhuma enquete neste servidor ainda. Crie com `/enquete criar Pergunta | opção 1 | opção 2`.");
      } else {
        const loaded = await loadVotes();
        replies.push(
          polls
            .map((p) => {
              const total = Object.keys(loaded.latest[p.id] || {}).length;
              return (
                "`" + p.id + "` · " + (p.closed ? "encerrada" : "aberta") +
                " · " + total + " voto(s) — " + p.q
              );
            })
            .join("\n")
        );
      }
    } else if (sub === "fechar" || sub === "close") {
      const poll = (args[1] && findPoll(String(args[1]).toLowerCase())) ||
        polls.filter((p) => p && !p.closed).pop() ||
        null;
      if (!poll) throw bad("Não há enquete aberta para encerrar. Veja `/enquete listar`.");
      if (
        poll.by !== user.id &&
        !acl.can(ctxS, user.id, "manageServer") &&
        !acl.can(ctxS, user.id, "manageMembers")
      )
        throw forbidden("Só quem criou a enquete ou quem gerencia o servidor pode encerrá-la.");
      poll.closed = true;
      await savePolls(polls);
      replies.push("Enquete **" + poll.id + "** encerrada. Resultado: `/enquete resultado " + poll.id + "`.");
    } else {
      throw bad("Subcomando desconhecido. Use `/enquete` para ver as opções.");
    }
  }

  /* ----------------------- /lembrete ----------------------- */
  else if (name === "/lembrete") {
    needBot("sendMessages");
    const sub = (args[0] || "").toLowerCase();
    const HONEST =
      "⚠️ Sem executor em segundo plano: com o Nexo fechado o aviso não dispara — " +
      "o lembrete é entregue na próxima vez que você abrir o app (no sync).";
    const prefs = (await db.readPrefs(user.id)) || {};
    const list = Array.isArray(prefs.reminders) ? prefs.reminders : [];

    if (sub === "criar" || sub === "add" || sub === "novo" || sub === "c") {
      const mins = parseInt(args[1], 10);
      if (!mins || mins < 1 || mins > 40080)
        throw bad("Use: /lembrete criar <minutos (1 a 40080)> <texto>.");
      const text = args.slice(2).join(" ").trim().slice(0, 160);
      if (!text) throw bad("Escreva o texto: /lembrete criar 30 reunir com a equipe.");
      const pending = list.filter((r) => r && !r.firedAt);
      if (pending.length >= 20)
        throw bad("Você já tem 20 lembretes pendentes. Cancele algum — veja `/lembrete listar`.");
      const id = u.uid("rm");
      const rem = {
        id: id,
        text: text,
        at: now(),
        dueAt: now() + mins * 60000,
        serverId: ctxS.server.id,
        channelId: channel.id,
        firedAt: null,
      };
      prefs.reminders = list.concat([rem]).slice(-60);
      await db.writePrefs(user.id, prefs);
      replies.push(
        "⏰ Lembrete `" + id + "` criado: em **" + mins + " minuto(s)** — " + text + "\n" + HONEST
      );
    } else if (sub === "listar" || sub === "list" || sub === "l" || sub === "ver") {
      if (!list.length) {
        replies.push(
          "Você não tem lembretes. Crie com `/lembrete criar 30 sair do trabalho`.\n" + HONEST
        );
      } else {
        const at = now();
        const lines = [];
        list
          .filter((r) => r && !r.firedAt)
          .sort((a, b) => Number(a.dueAt) - Number(b.dueAt))
          .forEach((r) => {
            const left = Math.max(0, Math.round((Number(r.dueAt) - at) / 60000));
            lines.push(
              "⏳ `" + r.id + "` — " +
                (left > 0 ? "em **" + left + " min**" : "vencido (entrega no seu próximo sync)") +
                " — " + r.text
            );
          });
        const fired = list.filter((r) => r && r.firedAt).slice(-3).reverse();
        fired.forEach((r) => lines.push("✅ `" + r.id + "` — entregue — " + r.text));
        if (!lines.length) lines.push("Nenhum lembrete pendente.");
        lines.push(HONEST);
        replies.push(lines.join("\n"));
      }
    } else if (sub === "cancelar" || sub === "cancel" || sub === "rm" || sub === "remover") {
      const key = String(args[1] || "");
      if (!key) throw bad("Informe o id: /lembrete cancelar <id> (veja os ids em `/lembrete listar`).");
      const cands = list.filter((r) => r && (r.id === key || String(r.id).indexOf(key) === 0));
      if (!cands.length) throw bad("Nenhum lembrete com esse id. Veja `/lembrete listar`.");
      if (cands.length > 1) throw bad("Id ambíguo — use o id completo de `/lembrete listar`.");
      const found = cands[0];
      if (found.firedAt) throw bad("Este lembrete já foi entregue — não há o que cancelar.");
      prefs.reminders = list.filter((r) => r !== found);
      await db.writePrefs(user.id, prefs);
      replies.push("Lembrete `" + found.id + "` cancelado. Não vou avisar mais sobre ele.");
    } else {
      replies.push(
        "**Lembretes**\n" +
          "`/lembrete criar <minutos> <texto>` — cria (1 a 40080 min)\n" +
          "`/lembrete listar` — mostra seus lembretes\n" +
          "`/lembrete cancelar <id>` — cancela um pendente\n" +
          HONEST
      );
    }
  }

  /* ------------------------ /automod ------------------------- */
  else if (name === "/automod") {
    needBot("sendMessages");
    const words = String(cfg.blockedWords || "").split(",").map((s) => s.trim()).filter(Boolean);
    const sub = (args[0] || "").toLowerCase();
    if (!sub) {
      replies.push(
        words.length
          ? "**AutoMod** — termos bloqueados (" + words.length + "):\n" + words.map((w) => "`" + w + "`").join(" ")
          : "**AutoMod** sem nenhum termo bloqueado. Comece com `/automod add <termo>`."
      );
    } else if (sub === "add") {
      needUser("manageServer");
      const term = args.slice(1).join(" ").trim().toLowerCase().slice(0, 40);
      if (!term) throw bad("Informe o termo: /automod add <termo>");
      if (words.some((w) => w.toLowerCase() === term)) throw bad("Este termo já está na lista.");
      if (words.length >= 40) throw bad("A lista chegou ao limite de 40 termos.");
      await saveCfgState(install, { blockedWords: words.concat([term]).join(",") });
      replies.push("Termo `" + term + "` adicionado. Mensagens com ele não serão publicadas aqui.");
    } else if (sub === "remove") {
      needUser("manageServer");
      const term = args.slice(1).join(" ").trim().toLowerCase();
      if (!words.some((w) => w.toLowerCase() === term)) throw bad("Este termo não está na lista. Veja `/automod`.");
      await saveCfgState(install, { blockedWords: words.filter((w) => w.toLowerCase() !== term).join(",") });
      replies.push("Termo `" + term + "` removido da lista.");
    } else if (sub === "limpar") {
      needUser("manageServer");
      await saveCfgState(install, { blockedWords: "" });
      replies.push("Lista de termos esvaziada.");
    } else {
      replies.push(
        "**AutoMod**\n" +
          "`/automod` — lista os termos\n" +
          "`/automod add <termo>` — bloqueia (quem gerencia)\n" +
          "`/automod remove <termo>` — remove (quem gerencia)\n" +
          "`/automod limpar` — esvazia (quem gerencia)"
      );
    }
  }

  /* ------------------------- /sugerir ------------------------ */
  else if (name === "/sugerir" || name === "/sugestoes" || name === "/sugestao") {
    needBot("sendMessages");
    const sugs = Array.isArray(cfg.suggestions) ? cfg.suggestions : [];
    const saveSug = (list) => saveCfgState(install, { suggestions: list.slice(0, 60) });
    if (name === "/sugerir") {
      const text = args.join(" ").trim().slice(0, 300);
      if (!text) throw bad("Escreva a sugestão: /sugerir <texto>");
      const sug = {
        id: "sg" + (sugs.length + 1) + "-" + Math.random().toString(36).slice(2, 6),
        text, by: user.id, at: now(), status: "aberta", votes: [],
      };
      await saveSug(sugs.concat([sug]));
      replies.push("Sugestão `" + sug.id + "` registrada. Vote com `/sugestao votar " + sug.id + "`.");
    } else if (name === "/sugestoes") {
      const f = (args[0] || "abertas").toLowerCase();
      const wanted = f === "todas" ? "todas" : f === "aprovadas" ? "aprovada" : f === "recusadas" ? "recusada" : "aberta";
      const list = sugs.filter((s) => s && (wanted === "todas" || (s.status || "aberta") === wanted));
      if (!list.length) replies.push("Nenhuma sugestão neste filtro. Participe com `/sugerir <texto>`.");
      else
        replies.push(
          list
            .slice(-15)
            .map((s) => {
              const votes = Array.isArray(s.votes) ? s.votes.length : 0;
              return "`" + s.id + "` · **" + (s.status || "aberta") + "** · " + votes + " voto" + (votes === 1 ? "" : "s") + "\n" + s.text;
            })
            .join("\n\n")
            .slice(0, 1800)
        );
    } else {
      const sub = (args[0] || "").toLowerCase();
      const id = String(args[1] || "");
      const sug = sugs.filter((s) => s && s.id === id)[0];
      if (sub === "votar") {
        if (!sug) throw bad("Sugestão não encontrada. Veja `/sugestoes`.");
        if ((sug.status || "aberta") !== "aberta") throw bad("Esta sugestão já foi avaliada.");
        sug.votes = Array.isArray(sug.votes) ? sug.votes : [];
        if (sug.votes.indexOf(user.id) !== -1) {
          sug.votes = sug.votes.filter((v) => v !== user.id);
          await saveSug(sugs);
          replies.push("Voto removido de `" + id + "`.");
        } else {
          if (sug.votes.length >= 500) throw bad("Esta sugestão chegou ao limite de votos.");
          sug.votes.push(user.id);
          await saveSug(sugs);
          replies.push("Voto registrado em `" + id + "` (" + sug.votes.length + " no total).");
        }
      } else if (sub === "avaliar") {
        needUser("manageServer");
        if (!sug) throw bad("Sugestão não encontrada. Veja `/sugestoes`.");
        const verdict = (args[2] || "").toLowerCase();
        if (verdict !== "aprovar" && verdict !== "recusar")
          throw bad("Use: /sugestao avaliar <id> <aprovar|recusar> [comentário]");
        sug.status = verdict === "aprovar" ? "aprovada" : "recusada";
        sug.note = args.slice(3).join(" ").slice(0, 200);
        await saveSug(sugs);
        await require("./servers").log(ctxS.server.id, "suggestion." + sug.status, { id: sug.id }, install.appId, user.id);
        replies.push("Sugestão `" + id + "` **" + sug.status + "** por @" + user.username + (sug.note ? "\n" + sug.note : ""));
      } else {
        replies.push(
          "**Sugestões**\n" +
            "`/sugerir <texto>` — envia uma sugestão\n" +
            "`/sugestoes [abertas|aprovadas|recusadas|todas]` — lista\n" +
            "`/sugestao votar <id>` — vota (ou retira o voto)\n" +
            "`/sugestao avaliar <id> <aprovar|recusar> [comentário]` — avalia (quem gerencia)"
        );
      }
    }
  }

  /* ------------------------- /tarefas ------------------------ */
  else if (name === "/tarefa" || name === "/tarefas") {
    needBot("sendMessages");
    const tasks = Array.isArray(cfg.tasks) ? cfg.tasks : [];
    const saveTasks = (list) => saveCfgState(install, { tasks: list.slice(0, 60) });
    const sub = (args[0] || "").toLowerCase();
    if (name === "/tarefas" || sub === "listar") {
      const f = (args[1] || args[0] || "abertas").toLowerCase();
      const wanted = f === "feitas" ? true : f === "todas" ? null : false;
      const list = tasks.filter((t) => t && (wanted === null ? true : !!t.done === wanted));
      if (!list.length) replies.push("Nenhuma tarefa " + (wanted === true ? "feita" : "aberta") + " por aqui. Crie com `/tarefa criar <título>`.");
      else
        replies.push(
          list
            .slice(-15)
            .map((t) => {
              const who = t.assignee ? " → @" + (t.assigneeName || t.assignee) : "";
              return "`" + t.id + "` · **" + (t.done ? "feita" : "aberta") + "**" + who + "\n" + t.title;
            })
            .join("\n\n")
            .slice(0, 1800)
        );
    } else if (sub === "criar") {
      const title = args.slice(1).join(" ").trim().slice(0, 140);
      if (!title) throw bad("Título da tarefa: /tarefa criar <título>");
      const task = { id: "tk" + (tasks.length + 1) + "-" + Math.random().toString(36).slice(2, 5), title, by: user.id, assignee: null, done: false, at: now() };
      await saveTasks(tasks.concat([task]));
      replies.push("Tarefa `" + task.id + "` criada: **" + title + "**");
    } else if (sub === "status") {
      const task = tasks.filter((t) => t && t.id === String(args[1] || ""))[0];
      if (!task) throw bad("Tarefa não encontrada. Veja `/tarefas`.");
      const st = (args[2] || "").toLowerCase();
      if (st !== "aberta" && st !== "feita") throw bad("Use: /tarefa status <id> <aberta|feita>");
      task.done = st === "feita";
      await saveTasks(tasks);
      replies.push("Tarefa `" + task.id + "` agora está **" + st + "**.");
    } else if (sub === "atribuir") {
      const task = tasks.filter((t) => t && t.id === String(args[1] || ""))[0];
      if (!task) throw bad("Tarefa não encontrada. Veja `/tarefas`.");
      const target = await findUserByArg(ctxS, args[2]);
      if (!target) throw bad("Mencione a pessoa: /tarefa atribuir <id> @usuario");
      task.assignee = target.id;
      task.assigneeName = target.username;
      await saveTasks(tasks);
      replies.push("Tarefa `" + task.id + "` atribuída a **@" + target.username + "**.");
    } else if (sub === "remover") {
      const task = tasks.filter((t) => t && t.id === String(args[1] || ""))[0];
      if (!task) throw bad("Tarefa não encontrada. Veja `/tarefas`.");
      if (task.by !== user.id && !acl.can(ctxS, user.id, "manageServer"))
        throw forbidden("Só quem criou a tarefa ou quem gerencia o servidor pode removê-la.");
      await saveTasks(tasks.filter((t) => t !== task));
      replies.push("Tarefa `" + task.id + "` removida.");
    } else {
      replies.push(
        "**Tarefas**\n" +
          "`/tarefa criar <título>` — cria\n" +
          "`/tarefas [abertas|feitas|todas]` — lista\n" +
          "`/tarefa status <id> <aberta|feita>` — muda o status\n" +
          "`/tarefa atribuir <id> @usuario` — atribui\n" +
          "`/tarefa remover <id>` — remove (quem criou ou quem gerencia)"
      );
    }
  }

  /* -------------------------- /nota -------------------------- */
  else if (name === "/nota" || name === "/notas") {
    needBot("sendMessages");
    const prefs = (await db.readPrefs(user.id)) || {};
    const notes = Array.isArray(prefs.notes) ? prefs.notes : [];
    const sub = (args[0] || "").toLowerCase();
    if (name === "/notas" || sub === "listar") {
      if (!notes.length) replies.push("Você ainda não tem notas. Salve com `/nota <texto>` — só você vê.");
      else replies.push("**Suas notas**\n" + notes.slice(-20).map((n) => "`" + n.id + "` · " + n.text).join("\n").slice(0, 1800));
    } else if (sub === "apagar") {
      const id = String(args[1] || "");
      const found = notes.filter((n) => n && n.id === id)[0];
      if (!found) throw bad("Nenhuma nota com esse id. Veja `/notas`.");
      prefs.notes = notes.filter((n) => n !== found);
      await db.writePrefs(user.id, prefs);
      replies.push("Nota `" + id + "` apagada.");
    } else {
      const text = args.join(" ").trim().slice(0, 500);
      if (!text) throw bad("Escreva o texto da nota: /nota <texto>");
      const note = { id: "nt" + Math.random().toString(36).slice(2, 8), text, at: now() };
      prefs.notes = notes.concat([note]).slice(-30);
      await db.writePrefs(user.id, prefs);
      replies.push("Nota `" + note.id + "` salva — só você vê ela.");
    }
  }

  /* -------------------- /aniversario ------------------------- */
  else if (name === "/aniversario" || name === "/aniversarios") {
    needBot("sendMessages");
    const bdays = cfg.birthdays && typeof cfg.birthdays === "object" && !Array.isArray(cfg.birthdays) ? cfg.birthdays : {};
    const saveB = (obj) => saveCfgState(install, { birthdays: obj });
    const valid = (s) => /^([0-3]?[0-9])\/([01]?[0-9])$/.test(s);
    const sub = (args[0] || "").toLowerCase();
    if (name === "/aniversarios" || sub === "listar") {
      const uids = Object.keys(bdays);
      if (!uids.length) replies.push("Nenhum aniversário informado neste servidor. Participe com `/aniversario definir DD/MM`.");
      else {
        const today = new Date();
        const ord = (e) => {
          const p = e.dm.split("/");
          const m = Number(p[1]), d = Number(p[0]);
          const y = m - 1 < today.getMonth() || (m - 1 === today.getMonth() && d < today.getDate()) ? today.getFullYear() + 1 : today.getFullYear();
          return new Date(y, m - 1, d).getTime();
        };
        const entries = uids.map((uid) => ({ uid, dm: String(bdays[uid]) })).sort((a, b) => ord(a) - ord(b));
        const rowsU = (await db.select("users", { where: { id: uids }, limit: 60 })) || [];
        const uname = {};
        rowsU.forEach((x) => (uname[x.id] = x.username));
        replies.push(
          "**Próximos aniversários**\n" +
            entries.slice(0, 15).map((e) => "`" + e.dm + "` · **@" + (uname[e.uid] || "membro") + "**").join("\n")
        );
      }
    } else if (sub === "definir") {
      const val = String(args[1] || "");
      if (!valid(val)) throw bad("Use o formato DD/MM — exemplo: /aniversario definir 14/07");
      bdays[user.id] = val.slice(0, 5);
      await saveB(bdays);
      replies.push("Aniversário registrado como `" + val.slice(0, 5) + "` na lista deste servidor. Saia quando quiser com `/aniversario tirar`.");
    } else if (sub === "tirar") {
      if (!bdays[user.id]) throw bad("Você não tem aniversário nesta lista.");
      delete bdays[user.id];
      await saveB(bdays);
      replies.push("Seu aniversário saiu da lista deste servidor.");
    } else {
      replies.push(
        (bdays[user.id]
          ? "Seu aniversário nesta lista: `" + bdays[user.id] + "`."
          : "Você não informou seu aniversário aqui — use `/aniversario definir DD/MM` se quiser participar.") +
          "\nTotal de participantes: **" + Object.keys(bdays).length + "** · veja `/aniversarios`."
      );
    }
  }

  /* --------------------------- /faq -------------------------- */
  else if (name === "/faq") {
    needBot("sendMessages");
    const faqs = Array.isArray(cfg.faq) ? cfg.faq : [];
    const saveF = (list) => saveCfgState(install, { faq: list.slice(0, 40) });
    const sub = (args[0] || "").toLowerCase();
    if (sub === "add") {
      needUser("manageServer");
      const parts = args.slice(1).join(" ").split("::");
      if (parts.length < 2) throw bad("Formato: /faq add <pergunta> :: <resposta>");
      const q = parts[0].trim().slice(0, 120);
      const a = parts.slice(1).join("::").trim().slice(0, 600);
      if (!q || !a) throw bad("Pergunta e resposta são obrigatórias.");
      const entry = { id: "fq" + Math.random().toString(36).slice(2, 7), q, a, by: user.id, at: now() };
      await saveF(faqs.concat([entry]));
      replies.push("Pergunta `" + entry.id + "` adicionada ao FAQ.");
    } else if (sub === "listar") {
      if (!faqs.length) replies.push("O FAQ está vazio. Quem gerencia cadastra com `/faq add <pergunta> :: <resposta>`.");
      else replies.push(faqs.map((f) => "`" + f.id + "` **" + f.q + "**\n" + f.a).join("\n\n").slice(0, 1800));
    } else if (sub === "apagar") {
      needUser("manageServer");
      const id = String(args[1] || "");
      const found = faqs.filter((f) => f && f.id === id)[0];
      if (!found) throw bad("Nenhuma pergunta com esse id. Veja `/faq listar`.");
      await saveF(faqs.filter((f) => f !== found));
      replies.push("Pergunta `" + id + "` removida do FAQ.");
    } else {
      const q = args.join(" ").trim().toLowerCase();
      if (!q) {
        replies.push("**FAQ**\n`/faq <palavra>` — busca\n`/faq listar` — mostra todos\n`/faq add <pergunta> :: <resposta>` — cadastra (quem gerencia)");
      } else {
        const hits = faqs.filter((f) => (f.q + " " + f.a).toLowerCase().indexOf(q) !== -1);
        replies.push(hits.length ? hits.slice(0, 5).map((f) => "**" + f.q + "**\n" + f.a).join("\n\n").slice(0, 1800) : "Nada no FAQ para `" + q.slice(0, 40) + "`.");
      }
    }
  }

  /* -------------------------- /evento ------------------------ */
  else if (name === "/evento" || name === "/eventos") {
    needBot("sendMessages");
    const events = Array.isArray(cfg.events) ? cfg.events : [];
    const saveE = (list) => saveCfgState(install, { events: list.slice(0, 20) });
    const sub = (args[0] || "").toLowerCase();
    if (name === "/eventos" || sub === "listar") {
      if (!events.length) replies.push("Nenhum evento. Crie com `/evento criar <nome>`.");
      else
        replies.push(
          events
            .map((ev) => "`" + ev.id + "` **" + ev.name + "** · " + (ev.open ? "inscrições abertas" : "encerrado") + " · " + ((ev.inscritos || []).length) + " inscrito(s)")
            .join("\n")
            .slice(0, 1800)
        );
    } else if (sub === "criar") {
      const nm = args.slice(1).join(" ").trim().slice(0, 80);
      if (!nm) throw bad("Nome do evento: /evento criar <nome>");
      const ev = { id: "ev" + Math.random().toString(36).slice(2, 6), name: nm, by: user.id, open: true, inscritos: [], at: now() };
      await saveE(events.concat([ev]));
      replies.push("Evento `" + ev.id + "` criado — **" + nm + "**. Inscrição: `/evento inscrever " + ev.id + "`.");
    } else if (sub === "inscrever" || sub === "sair") {
      const id = String(args[1] || "");
      const ev = events.filter((e) => e && e.id === id)[0];
      if (!ev) throw bad("Evento não encontrado. Veja `/eventos`.");
      if (!ev.open) throw bad("As inscrições deste evento foram encerradas.");
      ev.inscritos = Array.isArray(ev.inscritos) ? ev.inscritos : [];
      if (sub === "sair") {
        if (ev.inscritos.indexOf(user.id) === -1) throw bad("Você não está inscrito neste evento.");
        ev.inscritos = ev.inscritos.filter((x) => x !== user.id);
        await saveE(events);
        replies.push("Inscrição removida de `" + id + "`.");
      } else {
        if (ev.inscritos.indexOf(user.id) !== -1) throw bad("Você já está inscrito neste evento.");
        if (ev.inscritos.length >= 500) throw bad("Este evento chegou ao limite de inscritos.");
        ev.inscritos.push(user.id);
        await saveE(events);
        replies.push("Inscrição confirmada em **" + ev.name + "** (" + ev.inscritos.length + " no total).");
      }
    } else if (sub === "encerrar") {
      needUser("manageServer");
      const id = String(args[1] || "");
      const ev = events.filter((e) => e && e.id === id)[0];
      if (!ev) throw bad("Evento não encontrado. Veja `/eventos`.");
      if (!ev.open) throw bad("Este evento já está encerrado.");
      ev.open = false;
      await saveE(events);
      replies.push("Evento **" + ev.name + "** encerrado com " + ((ev.inscritos || []).length) + " inscrito(s).");
    } else {
      replies.push(
        "**Eventos**\n" +
          "`/evento criar <nome>` — cria com inscrições abertas\n" +
          "`/eventos` — lista\n" +
          "`/evento inscrever <id>` / `/evento sair <id>` — inscrição\n" +
          "`/evento encerrar <id>` — encerra (quem gerencia)"
      );
    }
  }

  /* -------------------------- /stats ------------------------- */
  else if (name === "/stats") {
    needBot("sendMessages");
    /* memberships não tem coluna id — contar com select+length
       (mesmo padrão do /serverinfo, compatível com os dois drivers) */
    const memberRows = (await db.select("memberships", { where: { server_id: ctxS.server.id }, limit: 5000 })) || [];
    const members = memberRows.length;
    const chIds = ctxS.channels.map((c) => c.id);
    let msgs = 0;
    if (chIds.length) msgs = await db.count("messages", { where: { channel_id: chIds } });
    const textCh = ctxS.channels.filter((c) => c.type === "text").length;
    const voiceCh = ctxS.channels.filter((c) => c.type === "voice").length;
    replies.push(
      "**Estatísticas de " + ctxS.server.name + "**\n" +
        "• Membros humanos: **" + members + "**\n" +
        "• Canais: **" + ctxS.channels.length + "** (" + textCh + " de texto, " + voiceCh + " de voz)\n" +
        "• Categorias: **" + (ctxS.categories || []).length + "** · Cargos: **" + (ctxS.roles || []).length + "**\n" +
        "• Mensagens em canais: **" + msgs + "**\n" +
        "• Apps ativos: **" + installs.filter((i) => i.enabled !== false).length + "**"
    );
  }

  /* ------------------------ /auditoria ----------------------- */
  else if (name === "/auditoria") {
    needBot("sendMessages");
    needUser("manageServer");
    const n = clampInt(args[0], 10, 1, 25);
    const rows = (await db.select("logs", { where: { server_id: ctxS.server.id }, limit: n, order: "at", desc: true })) || [];
    if (!rows.length) replies.push("Nenhuma ação registrada neste servidor ainda.");
    else {
      const actorIds = rows.map((r) => r.actorId).filter(Boolean).slice(0, 25);
      const rowsU = actorIds.length ? ((await db.select("users", { where: { id: actorIds }, limit: 30 })) || []) : [];
      const uname = {};
      rowsU.forEach((x) => (uname[x.id] = x.username));
      replies.push(
        "**Auditoria — últimas " + rows.length + " ações**\n" +
          rows
            .map((r) => {
              const d = new Date(Number(r.at) || 0);
              const stamp = isNaN(d.getTime())
                ? "?"
                : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
              const who = r.actorId ? "@" + (uname[r.actorId] || "alguém") : "sistema";
              return "`" + stamp + "` **" + r.action + "** · " + who;
            })
            .join("\n")
            .slice(0, 1800)
      );
    }
  }

  /* -------------------------- /status ------------------------ */
  else if (name === "/status") {
    needBot("sendMessages");
    const uptimeMin = Math.floor(process.uptime() / 60);
    replies.push(
      "**Nexo Status**\n" +
        "• API: **no ar** — respondendo nesta chamada\n" +
        "• Banco de dados: **" + String(process.env.NEXO_DB || "sqlite").toLowerCase() + "**\n" +
        "• Serviço de pé há: **" + uptimeMin + " min**\n" +
        "• Catálogo: **" + OFFICIAL_APPS.length + "** apps oficiais"
    );
  }

  /* ------------------- /dado /moeda /sorteio /sorte ---------- */
  else if (name === "/dado" || name === "/moeda" || name === "/sorteio" || name === "/sorte") {
    needBot("sendMessages");
    if (name === "/dado") {
      const sides = clampInt(args[0], 6, 2, 100);
      replies.push("Dado de **" + sides + "** lados: saiu **" + (1 + Math.floor(Math.random() * sides)) + "**.");
    } else if (name === "/moeda") {
      replies.push("**" + (Math.random() < 0.5 ? "Cara" : "Coroa") + "**.");
    } else if (name === "/sorteio") {
      const rows = (await db.select("memberships", { where: { server_id: ctxS.server.id }, limit: 500 })) || [];
      if (rows.length < 2) throw bad("Preciso de pelo menos 2 membros para sortear.");
      const pick = rows[Math.floor(Math.random() * rows.length)];
      const pickId = pick.userId || pick.user_id;
      const rowsU = (await db.select("users", { where: { id: pickId }, limit: 1 })) || [];
      replies.push("Sorteio: **@" + ((rowsU[0] && rowsU[0].username) || "membro") + "** foi o escolhido entre " + rows.length + " membros.");
    } else {
      const q = args.join(" ").trim();
      const answers = [
        "É certo.",
        "Melhor não contar agora.",
        "Sim, com certeza.",
        "Não parece uma boa ideia.",
        "As estrelas dizem que sim.",
        "Pergunte de novo mais tarde.",
        "Sem chance.",
        "Provavelmente sim.",
        "Talvez — depende de você.",
        "Minha resposta é não.",
      ];
      replies.push((q ? "“" + q.slice(0, 80) + "”\n" : "") + "**" + answers[Math.floor(Math.random() * answers.length)] + "**");
    }
  }

  /* -------------------------- /trivia ------------------------ */
  else if (name === "/trivia") {
    needBot("sendMessages");
    const tr = cfg.trivia && typeof cfg.trivia === "object" && !Array.isArray(cfg.trivia) ? cfg.trivia : {};
    const saveT = (obj) => saveCfgState(install, { trivia: obj });
    const sub = (args[0] || "").toLowerCase();
    if (sub === "placar") {
      const scores = tr.scores && typeof tr.scores === "object" ? tr.scores : {};
      const ids = Object.keys(scores).slice(0, 30);
      if (!ids.length) replies.push("Nenhum ponto ainda. Jogue com `/trivia` e `/trivia responder <letra>`.");
      else {
        const rowsU = (await db.select("users", { where: { id: ids }, limit: 30 })) || [];
        const uname = {};
        rowsU.forEach((x) => (uname[x.id] = x.username));
        const list = ids.map((id) => ({ id, n: Number(scores[id]) || 0 })).sort((a, b) => b.n - a.n).slice(0, 10);
        replies.push(
          "**Placar da Trivia**\n" +
            list.map((x, i) => (i + 1) + ". @" + (uname[x.id] || "alguém") + " — **" + x.n + "** ponto" + (x.n === 1 ? "" : "s")).join("\n")
        );
      }
    } else if (sub === "responder" || sub === "resposta") {
      if (!tr.open) throw bad("Não há pergunta aberta. Use `/trivia` para começar uma.");
      const letter = String(args[1] || "").trim().toUpperCase().slice(0, 1);
      if ("ABCD".indexOf(letter) === -1) throw bad("Responda com a letra: /trivia responder A|B|C|D");
      if (tr.answered) throw bad("Esta pergunta já foi respondida. Use `/trivia` para a próxima.");
      const right = letter === tr.answer;
      tr.answered = true;
      tr.scores = tr.scores && typeof tr.scores === "object" ? tr.scores : {};
      if (right) tr.scores[user.id] = (Number(tr.scores[user.id]) || 0) + 1;
      await saveT(tr);
      const q = TRIVIA_BANK.filter((x) => x.q === tr.q)[0];
      const rightText = q ? q.opts["ABCD".indexOf(tr.answer)] : "";
      replies.push(
        (right ? "Certo! " : "Não foi dessa vez. ") +
          "A resposta era **" + tr.answer + "** — " + rightText +
          (right ? "\nPonto para @" + user.username + "!" : "") +
          "\nPróxima pergunta: `/trivia`."
      );
    } else {
      if (tr.open && !tr.answered) throw bad("Ainda há uma pergunta em aberto — responda com `/trivia responder <letra>`.");
      const q = TRIVIA_BANK[Math.floor(Math.random() * TRIVIA_BANK.length)];
      const letters = ["A", "B", "C", "D"];
      const opts = q.opts.map((t, i) => ({ t, l: letters[i] }));
      for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = opts[i];
        opts[i] = opts[j];
        opts[j] = tmp;
      }
      const answer = opts.filter((o) => o.l === letters[q.answer])[0].l;
      await saveT({ open: true, answered: false, q: q.q, answer, at: now(), scores: tr.scores || {} });
      replies.push("**Trivia** — " + q.q + "\n" + opts.map((o) => "**" + o.l + "**) " + o.t).join("\n") + "\nResponda com `/trivia responder <letra>`.");
    }
  }

  /* ------------------------ /comunicado ---------------------- */
  else if (name === "/comunicado") {
    needBot("sendMessages");
    needUser("manageServer");
    const ch = textChannel(ctxS, cfg.channelId, true);
    if (!ch) throw bad("Não há canal de texto neste servidor para publicar.");
    const text = args.join(" ").trim().slice(0, 900);
    if (!text) throw bad("Escreva o comunicado: /comunicado <texto>");
    await require("./servers").log(ctxS.server.id, "app.comunicado", { channelId: ch.id, length: text.length }, install.appId, user.id);
    const msg = await botPost(ctxS, install, ch, "**Comunicado de @" + user.username + "**\n" + text, user.id);
    replies.push(msg ? "Comunicado publicado em **#" + ch.name + "**." : "Não consegui publicar — confira a permissão “Enviar mensagens” do app neste canal.");
  }

  /* -------------------------- /midia ------------------------- */
  else if (name === "/midia") {
    needBot("sendMessages");
    const media = Array.isArray(cfg.media) ? cfg.media : [];
    const saveM = (list) => saveCfgState(install, { media: list.slice(0, 50) });
    const sub = (args[0] || "").toLowerCase();
    if (sub === "salvar" || sub === "add") {
      const url = String(args[1] || "");
      if (!/^https?:\/\//i.test(url)) throw bad("Informe um link começando com http:// ou https:// — nada de arquivos hospedados aqui.");
      const title = args.slice(2).join(" ").trim().slice(0, 80) || url.slice(0, 80);
      const item = { id: "md" + Math.random().toString(36).slice(2, 7), url: url.slice(0, 300), title, by: user.id, at: now() };
      await saveM(media.concat([item]));
      replies.push("Mídia `" + item.id + "` salva: **" + title + "**\n" + item.url);
    } else if (sub === "remover") {
      const id = String(args[1] || "");
      const found = media.filter((m) => m && m.id === id)[0];
      if (!found) throw bad("Nenhuma mídia com esse id. Veja `/midia`.");
      if (found.by !== user.id && !acl.can(ctxS, user.id, "manageServer"))
        throw forbidden("Só quem salvou ou quem gerencia pode remover este item.");
      await saveM(media.filter((m) => m !== found));
      replies.push("Mídia `" + id + "` removida.");
    } else {
      if (!media.length) replies.push("Nenhuma mídia salva. Adicione com `/midia salvar <link> [título]`.");
      else
        replies.push(
          "**Mídias compartilhadas**\n" +
            media.slice(-20).map((m) => "`" + m.id + "` **" + m.title + "** — " + m.url).join("\n").slice(0, 1800)
        );
    }
  }

  /* procura cargo por id, nome ou menção — mesmo jeito que se
     procura uma pessoa, sem depender do formato exato */
  function findRoleByArg(arg) {
    if (!arg) return null;
    const clean = String(arg).replace(/^<@?&?|#?>?$/g, "").replace(/^@/, "").trim();
    if (!clean) return null;
    const roles = ctxS.roles || [];
    const low = clean.toLowerCase();
    return (
      roles.filter((r) => String(r.id) === clean)[0] ||
      roles.filter((r) => String(r.name || "").toLowerCase() === low)[0] ||
      roles.filter((r) => String(r.name || "").toLowerCase().indexOf(low) === 0)[0] ||
      null
    );
  }

  /* membros do servidor como pessoas reais: id + como aparecem */
  async function memberRoster(ctxS) {
    const rows = (await db.select("memberships", { where: { server_id: ctxS.server.id }, limit: 5000 })) || [];
    const ids = rows.map((r) => r.userId).filter(Boolean);
    const users = ids.length ? ((await db.select("users", { where: { id: ids }, limit: 5000 })) || []) : [];
    const byId = {};
    users.forEach((u) => (byId[u.id] = u));
    const roleByUser = {};
    (ctxS.memberRoles || []).forEach((mr) => (roleByUser[mr.userId] = mr.roleId));
    return rows
      .filter((r) => r.userId && byId[r.userId])
      .map((r) => ({
        id: r.userId,
        name: byId[r.userId].display_name || byId[r.userId].username,
        username: byId[r.userId].username,
        joinedAt: r.joinedAt,
        roleId: roleByUser[r.userId] || null,
      }));
  }

  function shortDate(msOrIso) {
    const d = new Date(typeof msOrIso === "number" ? msOrIso : Date.parse(String(msOrIso || "")));
    if (isNaN(d.getTime()) || !d.getTime()) return "data desconhecida";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  /* tempo decorrido em português corrido, sem arredondamento falso */
  function elapsed(fromMsOrIso) {
    const from = typeof fromMsOrIso === "number" ? fromMsOrIso : Date.parse(String(fromMsOrIso || ""));
    if (!from || isNaN(from)) return "tempo desconhecido";
    let secs = Math.max(0, Math.floor((now() - from) / 1000));
    const days = Math.floor(secs / 86400); secs -= days * 86400;
    const hours = Math.floor(secs / 3600); secs -= hours * 3600;
    const mins = Math.floor(secs / 60);
    const out = [];
    if (days) out.push(days + (days === 1 ? " dia" : " dias"));
    if (hours) out.push(hours + (hours === 1 ? " hora" : " horas"));
    if (!days && mins) out.push(mins + (mins === 1 ? " minuto" : " minutos"));
    if (!out.length) out.push("menos de 1 minuto");
    return out.join(", ");
  }

  /* o mapa devolve datas como ms (número) ou ISO, conforme o driver.
     `Date.parse` num NÚMERO vira NaN — e um NaN em comparação nunca
     passa, o que faria o ranking e os inativos dizerem sempre
     "nada registrado". Este helper aceita os dois formatos. */
  function ts(v) {
    if (typeof v === "number" && isFinite(v)) return v;
    const t = Date.parse(String(v || ""));
    return isNaN(t) ? 0 : t;
  }

  /* ------------------------- Nexo Ranking ------------------------- */
  if (name === "/top" || name === "/online" || name === "/inativos") {
    needBot("sendMessages");
    const roster = await memberRoster(ctxS);
    const memberIds = roster.map((m) => m.id);
    const chIds = ctxS.channels.map((c) => c.id);

    if (name === "/online") {
      /* presença é global (uma linha por pessoa), mas só se conta
         quem é membro deste servidor — nada de listar gente de fora */
      const pres = (await db.select("presence", { limit: 5000 })) || [];
      const onlineIds = pres.filter((p) => p.status === "online").map((p) => p.userId);
      const here = roster.filter((m) => onlineIds.indexOf(m.id) !== -1);
      replies.push(
        here.length
          ? "**" + here.length + "** de **" + roster.length + "** membros conectados agora.\n" +
            here.slice(0, 30).map((m) => "• @" + m.username).join("\n")
          : "Nenhum membro conectado agora. **" + roster.length + "** pessoas no servidor."
      );
      return finish(replies, ctxS, install, channel, user);
    }

    if (name === "/top") {
      if (!chIds.length) {
        replies.push("Este servidor ainda não tem canais de texto para contar.");
        return finish(replies, ctxS, install, channel, user);
      }
      const days = clampInt(args[0], clampInt(cfg.topDays, 30, 1, 365), 1, 365);
      const since = now() - days * 86400000;
      const msgs = (await db.select("messages", { where: { channel_id: chIds }, limit: 20000 })) || [];
      const recent = msgs.filter((m) => {
        const at = ts(m.createdAt);
        return at >= since && m.deletedAt == null;
      });
      const count = {};
      recent.forEach((m) => {
        if (memberIds.indexOf(m.senderId) === -1) return;
        count[m.senderId] = (count[m.senderId] || 0) + 1;
      });
      const board = Object.keys(count)
        .map((id) => ({
          name: (roster.filter((m) => m.id === id)[0] || {}).name || "alguém",
          n: count[id],
        }))
        .sort((a, b) => b.n - a.n)
        .slice(0, clampInt(args[1] || 5, 5, 1, 15));
      replies.push(
        board.length
          ? "**Quem mais escreveu nos últimos " + days + " dias** (" + recent.length + " mensagens no total)\n" +
            board.map((b, i) => (i + 1) + ". **" + b.name + "** — " + b.n + " mensagens").join("\n")
          : "Nenhuma mensagem registrada nos últimos " + days + " dias neste servidor."
      );
    } else {
      /* /inativos: quem é membro e não escreve há N dias. Quem nunca
         escreveu aparece marcado como "nunca escreveu" — não se
         inventa última atividade para dar aparência de dado. */
      const days = clampInt(args[0], clampInt(cfg.inactiveDays, 30, 1, 365), 1, 365);
      const msgs = chIds.length
        ? ((await db.select("messages", { where: { channel_id: chIds }, limit: 20000 })) || [])
        : [];
      const last = {};
      msgs.forEach((m) => {
        if (memberIds.indexOf(m.senderId) === -1) return;
        const at = ts(m.createdAt);
        if (at && (!last[m.senderId] || at > last[m.senderId])) last[m.senderId] = at;
      });
      const limit = now() - days * 86400000;
      const quiet = roster
        .filter((m) => (last[m.id] || 0) < limit && ctxS.server.ownerId !== m.id)
        .map((m) => ({ name: m.name, at: last[m.id] || 0 }))
        .sort((a, b) => a.at - b.at)
        .slice(0, 15);
      replies.push(
        quiet.length
          ? "**Sem escrever há " + days + " dias** (" + quiet.length + " de " + roster.length + ")\n" +
            quiet
              .map((q) => "• **" + q.name + "** — " + (q.at ? "última mensagem em " + shortDate(q.at) : "nunca escreveu"))
              .join("\n")
          : "Todo mundo escreveu nos últimos " + days + " dias."
      );
    }
    return finish(replies, ctxS, install, channel, user);
  }

  /* --------------------------- Nexo Busca ------------------------- */
  else if (name === "/buscar" || name === "/exportar") {
    needBot("sendMessages");
    /* a busca só enxerga o canal em que foi chamada — e só se a
       pessoa pode vê-lo (o envio do comando já passou por isso) */
    const only = { channel_id: channel.id };
    const all = (await db.select("messages", { where: only, limit: 20000 })) || [];
    const visible = all
      .filter((m) => !m.deletedAt)
      .sort((a, b) => (Date.parse(a.createdAt || 0) || 0) - (Date.parse(b.createdAt || 0) || 0));

    if (name === "/buscar") {
      const term = args.join(" ").trim();
      if (term.length < 2) throw bad("Escreva pelo menos 2 letras para buscar. Exemplo: `/buscar reunião`.");
      const norm = (s) =>
        String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const q = norm(term);
      const hits = visible.filter((m) => norm(m.content).indexOf(q) !== -1);
      const limit = clampInt(cfg.searchLimit, 20, 1, 50);
      const who = {};
      hits.slice(-200).forEach((m) => (who[m.senderId] = (who[m.senderId] || 0) + 1));
      const ids = Object.keys(who);
      const users = ids.length ? ((await db.select("users", { where: { id: ids }, limit: 200 })) || []) : [];
      const uname = {};
      users.forEach((u) => (uname[u.id] = u.username));
      replies.push(
        hits.length
          ? "**" + hits.length + "** mensagem(ns) com “" + term + "” neste canal. As últimas " +
            Math.min(limit, hits.length) + ":\n" +
            hits
              .slice(-limit)
              .reverse()
              .map((m) =>
                "`" + shortDate(m.createdAt) + "` @" + (uname[m.senderId] || "alguém") + ": " +
                String(m.content || "").replace(/\s+/g, " ").slice(0, 160)
              )
              .join("\n")
              .slice(0, 1800)
          : "Nenhuma mensagem com “" + term + "” neste canal."
      );
    } else {
      const n = clampInt(args[0], clampInt(cfg.exportLimit, 50, 5, 200), 5, 200);
      if (!visible.length) {
        replies.push("Este canal ainda não tem mensagens para exportar.");
        return finish(replies, ctxS, install, channel, user);
      }
      const slice = visible.slice(-n);
      const ids = {};
      slice.forEach((m) => (ids[m.senderId] = 1));
      const users = (await db.select("users", { where: { id: Object.keys(ids) }, limit: 200 })) || [];
      const uname = {};
      users.forEach((u) => (uname[u.id] = u.username));
      replies.push(
        "**Transcrição de #" + (channel.name || "canal") + "** — últimas " + slice.length + " mensagens, pedidas por @" + user.username + "\n\n" +
        slice
          .map((m) => "`" + shortDate(m.createdAt) + "` @" + (uname[m.senderId] || "alguém") + ": " + String(m.content || "").replace(/\s+/g, " "))
          .join("\n")
          .slice(0, 3000)
      );
      try {
        await handlersAuth.createNotification(user.id, "server", "Sua transcrição de #" + (channel.name || "canal") + " foi gerada.", {});
      } catch (e) {
        /* notificação é cortesia, nunca quebra o comando */
      }
    }
    return finish(replies, ctxS, install, channel, user);
  }

  /* -------------------------- Nexo Sorteios ----------------------- */
  else if (name === "/sortear" || name === "/sortear-cargo") {
    needBot("sendMessages");
    const roster = await memberRoster(ctxS);
    let pool = roster;
    let label = "todos os " + roster.length + " membros";

    if (name === "/sortear-cargo") {
      const role = findRoleByArg(args[0]);
      if (!role) {
        const names = (ctxS.roles || []).map((r) => r.name).filter(Boolean);
        throw bad(
          names.length
            ? "Não achei esse cargo. Os cargos deste servidor são: " + names.map((n) => "`" + n + "`").join(", ") + "."
            : "Este servidor ainda não tem cargos definidos."
        );
      }
      const holders = (await db.select("member_roles", { where: { server_id: ctxS.server.id, role_id: role.id }, limit: 5000 })) || [];
      const ids = holders.map((h) => h.userId);
      pool = roster.filter((m) => ids.indexOf(m.id) !== -1);
      label = "os **" + pool.length + "** membros com o cargo **" + role.name + "**";
      args.shift();
    }

    if (!pool.length) throw bad("Ninguém entra neste sorteio: " + label + " está vazio.");
    const howMany = clampInt(args[0], 1, 1, Math.min(10, pool.length));
    /* embaralhamento por sorteio de verdade, sem repetir a mesma
       pessoa duas vezes no mesmo resultado */
    const bag = pool.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
    }
    const winners = bag.slice(0, howMany);
    replies.push(
      "Sorteio entre " + label + " — **" + winners.length + "** escolhido(s):\n" +
      winners.map((w) => "• 🎉 @" + w.username).join("\n") +
      "\n_Sorteio feito agora, entre quem é membro deste servidor._"
    );
    return finish(replies, ctxS, install, channel, user);
  }

  /* --------------------------- Nexo Tempo ------------------------- */
  else if (name === "/tempo" || name === "/antiguidade") {
    needBot("sendMessages");
    const roster = await memberRoster(ctxS);

    if (name === "/tempo") {
      let target = null;
      if (args[0]) {
        target = await findUserByArg(ctxS, args[0]);
        if (!target) throw bad("Não encontrei essa pessoa no Nexo.");
        if (!acl.membershipOf(ctxS, target.id))
          throw bad("@" + target.username + " não é membro deste servidor.");
      } else target = { id: user.id, username: user.username, display_name: user.displayName || user.username };

      const row = roster.filter((m) => m.id === target.id)[0];
      if (!row) throw bad("Não encontrei a entrada de @" + target.username + " neste servidor.");
      const isOwner = ctxS.server.ownerId === row.id;
      replies.push(
        "**@" + row.username + "** está no servidor há **" + elapsed(row.joinedAt) + "**." +
        "\n• Entrada registrada em: **" + shortDate(row.joinedAt) + "**" +
        (isOwner ? "\n• É o **dono** do servidor." : "")
      );
    } else {
      const dated = roster.filter((m) => m.joinedAt);
      if (dated.length < 2) {
        replies.push("Ainda há poucas entradas registradas para comparar a antiguidade.");
        return finish(replies, ctxS, install, channel, user);
      }
      const asc = dated.slice().sort((a, b) => (Date.parse(a.joinedAt) || 0) - (Date.parse(b.joinedAt) || 0));
      const vets = asc.slice(0, 3);
      const fresh = asc.slice(-3).reverse();
      replies.push(
        "**Antiguidade em " + ctxS.server.name + "**\n" +
        "Mais tempo aqui:\n" + vets.map((m, i) => (i + 1) + ". @" + m.username + " — desde " + shortDate(m.joinedAt) + " (" + elapsed(m.joinedAt) + ")").join("\n") +
        "\n\nChegaram por último:\n" + fresh.map((m, i) => (i + 1) + ". @" + m.username + " — desde " + shortDate(m.joinedAt) + " (" + elapsed(m.joinedAt) + ")").join("\n")
      );
    }
    return finish(replies, ctxS, install, channel, user);
  }

  /* ------------------------- Nexo Convites ------------------------ */
  else if (name === "/convites" || name === "/revogar") {
    needBot("sendMessages");
    /* mesma permissão que a própria tela de convites exige —
       a checagem é aqui, no servidor, não no botão escondido */
    needUser("createInvite");
    const rows = (await db.select("invites", { where: { server_id: ctxS.server.id }, limit: 200 })) || [];
    const live = rows.filter((r) => {
      if (r.expiresAt && Date.parse(r.expiresAt) < now()) return false;
      if (r.maxUses && Number(r.uses) >= Number(r.maxUses)) return false;
      return true;
    });

    if (name === "/convites") {
      replies.push(
        live.length
          ? "**" + live.length + "** convite(s) ativo(s) em " + ctxS.server.name + "\n" +
            live
              .slice(0, 25)
              .map((r) =>
                "`" + r.code + "` — " + (Number(r.uses) || 0) +
                (r.maxUses ? "/" + r.maxUses : "") + " usos" +
                (r.expiresAt ? ", expira em " + shortDate(r.expiresAt) : ", sem prazo")
              )
              .join("\n")
          : "Nenhum convite ativo neste servidor. Gere um na tela de convites."
      );
    } else {
      const code = String(args[0] || "").trim().toUpperCase();
      if (!code) throw bad("Informe o código do convite. Exemplo: `/revogar ABC123`.");
      const found = rows.filter((r) => String(r.code).toUpperCase() === code)[0];
      if (!found) throw bad("Não existe convite com o código `" + code + "` neste servidor.");
      await db.remove("invites", { where: { id: found.id } });
      try {
        await logAudit(ctxS.server.id, user.id, "invite.revoke", { code: found.code });
      } catch (e) {
        /* registro é cortesia; a revogação já aconteceu */
      }
      replies.push("Convite `" + found.code + "` revogado. Quem já usou continua no servidor; o link para de valer.");
    }
    return finish(replies, ctxS, install, channel, user);
  }

  if (!replies.length) return null;

  /* respostas do bot no mesmo canal */
  const out = [];
  for (const line of replies) {
    const msg = await botPost(ctxS, install, channel, line, user.id);
    if (msg) out.push(msg);
  }
  return out;
}

/* ------------------------------------------------------------
   anti-spam do Nexo Moderação — DESLIGADO por padrão.
   Consulta real das mensagens recentes da pessoa no canal; se
   estourou o limite configurado, a mensagem nova não é publicada
   (bloqueio) e, quando a ação é "clear" e o bot tem a permissão,
   as mensagens excedentes são apagadas. Tudo registrado em `logs`.
   Retorna null quando não há nada a fazer.
   ------------------------------------------------------------ */
async function checkSpam(ctxS, channel, user) {
  try {
    await ensureCatalog();
    const installs = await installsOf(ctxS.server.id);
    const install = installs.find((i) => i.appId === "app_nexo_mod" && i.enabled !== false);
    if (!install) return null;
    const cfg = install.configuration || {};
    if (!cfg.spamEnabled) return null;
    /* quem modera é isento: o anti-spam nunca trava a moderação */
    if (acl.can(ctxS, user.id, "deleteMessages") || acl.can(ctxS, user.id, "manageServer"))
      return null;

    const limit = clampInt(cfg.spamLimit, 8, 2, 50);
    const windowSec = clampInt(cfg.spamWindow, 10, 3, 300);
    const since = now() - windowSec * 1000;
    const rows =
      (await db.select("messages", {
        where: { channel_id: channel.id, sender_id: user.id },
        order: "createdAt",
        desc: true,
        limit: 50,
      })) || [];
    /* mensagens do próprio bot não contam como mensagens da pessoa
       (senão o próprio aviso anti-spam estouraria o limite) e não são
       alvo de apagamento */
    const recent = rows.filter(
      (m) => Number(m.createdAt || 0) >= since && !String(m.content || "").startsWith("«bot:")
    );
    if (recent.length < limit) return null;

    const botPerms = Array.isArray(install.permissions) ? install.permissions : [];
    const wantClear = cfg.spamAction === "clear" && botPerms.indexOf("deleteMessages") !== -1;
    let removed = 0;
    if (wantClear) {
      for (const m of recent) {
        await db.remove("messages", { where: { id: m.id } });
        removed++;
      }
    }
    await require("./servers").log(
      ctxS.server.id,
      "message.spam",
      {
        channel: "#" + channel.name,
        count: recent.length,
        removed: removed,
        windowSec: windowSec,
        limit: limit,
        via: "bot",
      },
      channel.id,
      user.id
    );
    const reply = await botPost(
      ctxS,
      install,
      channel,
      "⚠️ Anti-spam: @" + user.username + " enviou **" + recent.length + "** mensagem(ns) em menos de " +
        windowSec + "s (limite: " + limit + "). " +
        (removed
          ? "Apaguei as " + removed + " mensagens excedentes; esta também não foi publicada."
          : "A mensagem nova não foi publicada.") +
        " Só quem modera é dispensado deste limite.",
      user.id
    );
    return { reply: reply || null, blocked: true, removed: removed };
  } catch (e) {
    /* anti-spam nunca derruba o envio: falha = deixa passar */
    return null;
  }
}

/* ------------------------------------------------------------
   lembretes do Nexo Lembretes — entrega no sync do PRÓPRIO usuário.
   Não há executor em segundo plano: quem cria é avisado disso, e o
   aviso (notificação) nasce aqui quando o prazo venceu e a pessoa
   abriu o app (sync roda só com a sessão ativa).
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   AutoMod — termos bloqueados configurados por servidor.
   Igual ao anti-spam: confere APENAS o texto da mensagem enviada,
   quem modera é isento, e a mensagem com o termo não é publicada.
   Retorna null quando não há nada a fazer; falha nunca bloqueia.
   ------------------------------------------------------------ */
async function moderateContent(ctxS, channel, user, text) {
  try {
    await ensureCatalog();
    const installs = await installsOf(ctxS.server.id);
    const install = installs.find((i) => i.appId === "app_nexo_automod" && i.enabled !== false);
    if (!install) return null;
    const cfg = install.configuration || {};
    const words = String(cfg.blockedWords || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!words.length) return null;
    /* quem modera é isento: o AutoMod nunca trava a moderação */
    if (acl.can(ctxS, user.id, "deleteMessages") || acl.can(ctxS, user.id, "manageServer"))
      return null;
    const low = String(text || "").toLowerCase();
    const hit = words.filter((w) => low.indexOf(w) !== -1).sort((a, b) => b.length - a.length)[0];
    if (!hit) return null;
    await require("./servers").log(
      ctxS.server.id,
      "message.automod",
      { word: hit, userId: user.id },
      install.appId,
      user.id
    );
    const reply = await botPost(
      ctxS,
      install,
      channel,
      "Sua mensagem contém um termo bloqueado neste servidor e não foi publicada. Se isso for um engano, fale com a moderação.",
      user.id
    );
    return { blocked: true, reply };
  } catch (e) {
    return null; /* automod nunca derruba o envio normal */
  }
}

async function deliverReminders(userId) {
  try {
    const prefs = await db.readPrefs(userId);
    const list = prefs && Array.isArray(prefs.reminders) ? prefs.reminders : null;
    if (!list || !list.length) return 0;
    const at = now();
    const due = list.filter((r) => r && !r.firedAt && Number(r.dueAt || 0) <= at);
    let changed = false;
    for (const r of due.slice(0, 10)) {
      try {
        await handlersAuth.createNotification(
          userId,
          "reminder",
          "⏰ Lembrete: " + String(r.text || "").slice(0, 160),
          {
            href:
              r.serverId && r.channelId ? "#/s/" + r.serverId + "/" + r.channelId : null,
            reminderId: r.id,
          }
        );
        r.firedAt = at;
        changed = true;
      } catch (e) {
        /* um aviso que falha não mata os próximos */
      }
    }
    /* entregues ficam7 dias visíveis em `/lembrete listar` e depois somem */
    const kept = list.filter((r) => r && !(r.firedAt && at - Number(r.firedAt) > 7 * 864e5));
    if (kept.length !== list.length) {
      prefs.reminders = kept;
      changed = true;
    }
    if (changed) await db.writePrefs(userId, prefs);
    return due.length;
  } catch (e) {
    return 0;
  }
}

/* ------------------------------------------------------------
   rotas
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   CRUD dos bots criados por usuários (rota /apps/bots)
   ------------------------------------------------------------ */
async function createBot(ctx) {
  const me = await auth.requireUser(ctx.event);
  const body = ctx.body || {};
  const mine = (await db.select("apps", { where: { developer: me.id }, limit: 50 })) || [];
  const bots = mine.filter((a) => isCustomId(a.id));
  if (bots.length >= MAX_BOTS_PER_USER)
    throw bad("Você já tem " + MAX_BOTS_PER_USER + " bots. Edite ou exclua um antes de criar outro.");
  const name = String(body.name || "").trim().slice(0, 40);
  if (name.length < 2) throw bad("O bot precisa de um nome com pelo menos 2 caracteres.");
  const description = String(body.description || "").trim().slice(0, 220);
  if (!description) throw bad("Escreva uma descrição curta para o bot.");
  const category = BOT_CATEGORIES.indexOf(body.category) !== -1 ? body.category : "Comunidade";
  const list = (Array.isArray(body.commands) ? body.commands : []).slice(0, MAX_BOT_COMMANDS).map(cleanBotCommand);
  if (!list.length) throw bad("Adicione pelo menos um comando ao bot.");
  const names = list.map((c) => c.name);
  if (new Set(names).size !== names.length) throw bad("Dois comandos não podem ter o mesmo nome.");
  const welcome = String(body.welcome || "").trim().slice(0, 300);
  const app = {
    id: u.uid("bot"),
    name,
    description,
    avatar: "bot",
    category,
    developer: me.id,
    permissions: BOT_PERMS.slice(),
    commands: { list, settings: { prefix: "/", welcome, published: false, createdAt: now(), ownerId: me.id } },
    enabled: true,
    createdAt: now(),
  };
  await db.insert("apps", app);
  try {
    await require("./servers").log(null, "bot.create", { botId: app.id, name: app.name }, app.id, me.id);
  } catch (e) {
    /* auditoria sem servidor não pode travar a criação */
  }
  const row = catalogRow(app);
  const patch = P.createPatch();
  P.set(patch, "apps", app.id, row);
  return { status: 201, data: row, patch };
}

async function listMyBots(ctx) {
  const me = await auth.requireUser(ctx.event);
  const rows = (await db.select("apps", { where: { developer: me.id }, limit: 50 })) || [];
  const bots = rows.filter((a) => isCustomId(a.id));
  const installs = (await db.select("server_apps", { limit: 5000 })) || [];
  const count = {};
  installs.forEach((i) => (count[i.appId] = (count[i.appId] || 0) + 1));
  return { data: bots.map((a) => Object.assign(catalogRow(a), { installCount: count[a.id] || 0 })) };
}

async function updateBot(ctx) {
  const me = await auth.requireUser(ctx.event);
  const row = await customAppRow(ctx.params.id);
  if (!row) throw notFound("Este bot não existe.");
  if (row.developer !== me.id) throw forbidden("Só quem criou este bot pode editá-lo.");
  const body = ctx.body || {};
  const def = customOf(row);
  const patch = {};
  if (body.name !== undefined) {
    const name = String(body.name || "").trim().slice(0, 40);
    if (name.length < 2) throw bad("O nome precisa de pelo menos 2 caracteres.");
    patch.name = name;
  }
  if (body.description !== undefined) {
    const d = String(body.description || "").trim().slice(0, 220);
    if (!d) throw bad("A descrição não pode ficar vazia.");
    patch.description = d;
  }
  if (body.category !== undefined && BOT_CATEGORIES.indexOf(body.category) !== -1) patch.category = body.category;
  let list = def.list;
  let settings = def.settings;
  if (body.commands !== undefined) {
    list = (Array.isArray(body.commands) ? body.commands : []).slice(0, MAX_BOT_COMMANDS).map(cleanBotCommand);
    if (!list.length) throw bad("O bot precisa de pelo menos um comando.");
    const names = list.map((c) => c.name);
    if (new Set(names).size !== names.length) throw bad("Dois comandos não podem ter o mesmo nome.");
  }
  if (body.welcome !== undefined)
    settings = Object.assign({}, settings, { welcome: String(body.welcome || "").trim().slice(0, 300) });
  if (body.published !== undefined)
    settings = Object.assign({}, settings, { published: !!body.published });
  patch.commands = { list, settings };
  await db.update("apps", { where: { id: row.id } }, patch);
  const fresh = await customAppRow(row.id);
  const out = catalogRow(fresh);
  const patchOut = P.createPatch();
  P.set(patchOut, "apps", fresh.id, out);
  return { data: out, patch: patchOut };
}

async function deleteBot(ctx) {
  const me = await auth.requireUser(ctx.event);
  const row = await customAppRow(ctx.params.id);
  if (!row) throw notFound("Este bot não existe.");
  if (row.developer !== me.id) throw forbidden("Só quem criou este bot pode excluí-lo.");
  const installs = (await db.select("server_apps", { where: { app_id: row.id }, limit: 200 })) || [];
  for (const i of installs) await db.remove("server_apps", { where: { id: i.id } });
  await db.remove("apps", { where: { id: row.id } });
  const patch = P.createPatch();
  P.del(patch, "apps", [row.id]);
  if (installs.length) P.del(patch, "serverApps", installs.map((i) => i.id));
  return {
    data: { id: row.id, removed: true, installsRemoved: installs.length },
    patch,
  };
}

/* denúncia de bot abusivo — registrada no próprio bot e o criador
   é avisado para poder corrigir; revisão editorial da plataforma
   usa o mesmo contador quando houver equipe dedicada. */
async function reportBot(ctx) {
  const me = await auth.requireUser(ctx.event);
  const body = ctx.body || {};
  const row = await customAppRow(String(body.appId || ""));
  if (!row) throw notFound("Este bot não existe.");
  const reason = String(body.reason || "").trim().slice(0, 300);
  if (reason.length < 10) throw bad("Descreva o problema com pelo menos 10 caracteres.");
  const def = customOf(row);
  const settings = def.settings;
  const reports = settings.reports && typeof settings.reports === "object" ? settings.reports : { by: [], count: 0 };
  reports.by = Array.isArray(reports.by) ? reports.by : [];
  if (reports.by.indexOf(me.id) !== -1) throw bad("Você já denunciou este bot — a denúncia anterior segue registrada.");
  if (reports.by.length >= 200) throw bad("Este bot atingiu o limite de denúncias registradas.");
  reports.by.push(me.id);
  reports.count = (Number(reports.count) || 0) + 1;
  reports.lastReason = reason;
  reports.lastAt = now();
  await db.update(
    "apps",
    { where: { id: row.id } },
    { commands: { list: def.list, settings: Object.assign({}, settings, { reports }) } }
  );
  const fresh = await customAppRow(row.id);
  const patchRep = P.createPatch();
  if (fresh) P.set(patchRep, "apps", fresh.id, catalogRow(fresh));
  if (row.developer && row.developer !== me.id) {
    try {
      await handlersAuth.createNotification(
        row.developer,
        "server",
        "Seu bot **" + row.name + "** recebeu uma denúncia: " + reason.slice(0, 120),
        {}
      );
    } catch (e) {
      /* notificação nunca invalida a denúncia */
    }
  }
  return { data: { ok: true, count: reports.count }, patch: patchRep };
}

function routes() {
  return [
    ["GET", "/apps", listApps],
    /* bots criados por usuários — ANTES de /apps/:id (o roteador
       escolhe a primeira rota compatível, e "bots" é literal) */
    ["GET", "/apps/bots", listMyBots],
    ["POST", "/apps/bots", createBot],
    ["PATCH", "/apps/bots/:id", updateBot],
    ["DELETE", "/apps/bots/:id", deleteBot],
    ["POST", "/apps/report", reportBot],
    ["GET", "/apps/:id", getApp],
    ["GET", "/servers/:id/apps", listInstalls],
    ["POST", "/servers/:id/apps", installApp],
    ["PATCH", "/servers/:serverId/apps/:installId", updateInstall],
    ["DELETE", "/servers/:serverId/apps/:installId", removeInstall],
  ];
}

/* catálogo público (para quem tem sessão) + popularidade real.
   Bots de usuário só aparecem publicados — exceto para o próprio
   criador, que enxerga os seus não publicados para testar. */
async function listApps(ctx) {
  const me = await auth.requireUser(ctx.event);
  await ensureCatalog();
  const rows = (await db.select("apps", { limit: 300 })) || [];
  const installs = (await db.select("server_apps", { limit: 5000 })) || [];
  const count = {};
  installs.forEach((i) => (count[i.appId] = (count[i.appId] || 0) + 1));
  const out = [];
  for (const a of rows) {
    if (a.enabled === false) continue;
    if (isCustomId(a.id) && !customOf(a).settings.published && a.developer !== me.id) continue;
    const row = catalogRow(a);
    out.push(
      Object.assign(row, { installCount: count[a.id] || 0, commands: row.commands || [], permissions: row.permissions || [] })
    );
  }
  await labelOwners(out);
  return { data: out };
}

/* bots de usuários mostram o @ de quem criou (sem expor o id cru) */
async function labelOwners(rows) {  const ids = [];
  rows.forEach((r) => {
    if (r.custom && r.custom.ownerId && ids.indexOf(r.custom.ownerId) === -1) ids.push(r.custom.ownerId);
  });
  if (!ids.length) return;
  const users = (await db.select("users", { where: { id: ids }, limit: 60 })) || [];
  const by = {};
  users.forEach((x) => (by[x.id] = x));
  rows.forEach((r) => {
    if (!r.custom || !r.custom.ownerId) return;
    const owner = by[r.custom.ownerId];
    r.developer = owner ? "@" + (owner.username || owner.displayName || r.custom.ownerId) : "Bot do Nexo";
  });
}

/* visibilidade no /sync: um bot de usuário NÃO publicado só existe
   para quem tem relação com ele — o próprio criador, ou alguém no
   cujo servidor o bot já esteja instalado (sem isso o cartão de
   "Meus apps" perderia o nome e a configuração do bot em uso).
   O catálogo público filtra à parte, em /apps. */
function visibleInSync(row, userId, installedAppIds) {
  if (!row || !isCustomId(row.id)) return true;
  if (userId && row.developer && row.developer === userId) return true;
  if (customOf(row).settings.published) return true;
  return !!(installedAppIds && installedAppIds[String(row.id)]);
}

async function getApp(ctx) {
  await ensureCatalog();
  const rows = await db.select("apps", { where: { id: ctx.params.id }, limit: 1 });
  if (!rows || !rows.length) throw notFound("Este app não existe.");
  const raw = rows[0];
  let me = null;
  try {
    me = await auth.requireUser(ctx.event);
  } catch (e) {
    /* sem sessão: apps oficiais continuam legíveis */
  }
  if (isCustomId(raw.id)) {
    if (!me) throw forbidden("Entre para ver os bots da comunidade.");
    if (!customOf(raw).settings.published && raw.developer !== me.id) {
      /* bot em uso num servidor meu: a equipe precisa ver nome,
         comandos e permissões para configurar ou remover — sem isto
         o cartão de "Meus apps" mostraria o id cru no lugar do bot. */
      const mineRows = (await db.select("memberships", { where: { user_id: me.id }, limit: 500 })) || [];
      const myServers = mineRows.map((m) => String(m.serverId || ""));
      const instRows = (await db.select("server_apps", { where: { app_id: raw.id }, limit: 2000 })) || [];
      const emUso = instRows.some((i) => myServers.indexOf(String(i.serverId || "")) !== -1);
      if (!emUso) throw notFound("Este bot não está publicado no catálogo.");
    }
  }
  const installs = (await db.select("server_apps", { where: { app_id: raw.id }, limit: 2000 })) || [];
  const row = catalogRow(raw);
  try {
    await labelOwners([row]);
  } catch (e) {
    /* rótulo é cosmético */
  }
  return { data: Object.assign(row, { installCount: installs.length, commands: row.commands || [], permissions: row.permissions || [] }) };
}

/* instalações do servidor — qualquer membro vê, mas só gestores mudam */
async function listInstalls(ctx) {
  const me = await auth.requireUser(ctx.event);
  const ctxS = await acl.loadServer(ctx.params.id);
  acl.requireMember(ctxS, me.id);
  const list = await installsOf(ctxS.server.id);
  return { data: list };
}

async function installApp(ctx) {
  const me = await auth.requireUser(ctx.event);
  const body = ctx.body || {};
  const ctxS = await acl.loadServer(ctx.params.id);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageServer", "Você não tem permissão para instalar apps neste servidor.");
  if (ctxS.server.ownerId !== me.id && !acl.can(ctxS, me.id, "manageServer"))
    throw forbidden("Você não tem permissão para instalar apps neste servidor.");

  await ensureCatalog();
  const appRows = await db.select("apps", { where: { id: String(body.appId || "") }, limit: 1 });
  const app = appRows && appRows[0];
  if (!app || app.enabled === false) throw notFound("Este app não está disponível.");
  /* app que depende de integração externa nunca instala: dizer a
     verdade é melhor que um botão que não faz nada. */
  const defExt = APP_BY_ID[app.id];
  if (defExt && defExt.integration === "external")
    throw forbidden(
      defExt.externalNote ||
        "O app **" + defExt.name + "** requer uma integração externa que o Nexo ainda não possui. " +
          "A instalação está desabilitada até existir essa integração — preferimos dizer isso a mostrar um botão que não funciona."
    );
  /* bot de usuário só instala se estiver publicado (ou se for o seu) */
  if (isCustomId(app.id) && !customOf(app).settings.published && app.developer !== me.id)
    throw notFound("Este bot não está disponível no catálogo.");

  const existing = await db.select("server_apps", {
    where: { server_id: ctxS.server.id, app_id: app.id },
    limit: 1,
  });
  if (existing && existing.length) throw bad("Este app já está instalado neste servidor.");

  /* permissões pedidas ⊆ permissões do app ⊆ permissões do instalador */
  const mine = grantable(ctxS, me.id);
  const perms = cleanPermList(APP_BY_ID[app.id] || app, body.permissions);
  const illegal = perms.filter((p) => !mine[p]);
  if (illegal.length)
    throw forbidden(
      "Você não pode conceder ao bot as permissões: " + illegal.join(", ") + ". Elas são maiores do que as suas."
    );

  const install = {
    id: u.uid("sa"),
    serverId: ctxS.server.id,
    appId: app.id,
    installedBy: me.id,
    permissions: perms,
    enabled: true,
    configuration: Object.assign(
      {},
      (APP_BY_ID[app.id] || {}).config || {},
      cleanConfig(app.id, body.configuration)
    ),
    installedAt: now(),
    updatedAt: now(),
  };
  await db.insert("server_apps", install);

  await require("./servers").log(
    ctxS.server.id,
    "app.install",
    { app: app.name, permissions: perms },
    app.id,
    me.id
  );

  const patch = P.createPatch();
  P.set(patch, "serverApps", install.id, install);
  return { status: 201, data: install, patch };
}

async function updateInstall(ctx) {
  const me = await auth.requireUser(ctx.event);
  const body = ctx.body || {};
  const install = await loadInstall(ctx.params.installId);
  if (!install || install.serverId !== ctx.params.serverId)
    throw notFound("Esta instalação não existe.");
  const ctxS = await acl.loadServer(ctx.params.serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageServer", "Você não tem permissão para configurar apps.");

  const patch = {};
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  if (body.configuration !== undefined)
    patch.configuration = Object.assign(
      {},
      install.configuration || {},
      cleanConfig(install.appId, body.configuration)
    );
  if (body.permissions !== undefined) {
    const appDef = APP_BY_ID[install.appId];
    const perms = cleanPermList(appDef || {}, body.permissions);
    const mine = grantable(ctxS, me.id);
    const illegal = perms.filter((p) => !mine[p]);
    if (illegal.length)
      throw forbidden("Você não pode manter permissões maiores que as suas: " + illegal.join(", ") + ".");
    patch.permissions = perms;
  }
  patch.updatedAt = now();
  await db.update("server_apps", { where: { id: install.id } }, patch);
  const fresh = await loadInstall(install.id);

  await require("./servers").log(
    ctxS.server.id,
    "app.update",
    { app: install.appId, enabled: fresh.enabled },
    install.appId,
    me.id
  );

  const out = P.createPatch();
  P.set(out, "serverApps", fresh.id, fresh);
  return { data: fresh, patch: out };
}

async function removeInstall(ctx) {
  const me = await auth.requireUser(ctx.event);
  const install = await loadInstall(ctx.params.installId);
  if (!install || install.serverId !== ctx.params.serverId)
    throw notFound("Esta instalação não existe.");
  const ctxS = await acl.loadServer(ctx.params.serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, "manageServer", "Você não tem permissão para remover apps.");

  await db.remove("server_apps", { where: { id: install.id } });
  await require("./servers").log(
    ctxS.server.id,
    "app.remove",
    { app: install.appId },
    install.appId,
    me.id
  );

  const patch = P.createPatch();
  P.del(patch, "serverApps", [install.id]);
  return { data: true, patch };
}

module.exports = {
  routes,
  ensureCatalog,
  catalogRow,
  onMemberJoin,
  onEvent,
  runCommand,
  checkSpam,
  moderateContent,
  deliverReminders,
  parseTag,
  stripTag,
  OFFICIAL_APPS,
  installsOf,
  isCustomId,
  customOf,
  visibleInSync,
  labelOwners,
};
