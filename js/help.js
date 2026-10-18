/* ============================================================
   NEXO · páginas de ajuda
   Preenche #screen-invite com as páginas públicas ligadas pelo
   rodapé: #/ajuda, #/suporte, #/termos e #/privacidade.

   Regras deste módulo:
     · público — abre com ou sem sessão, sem depender de sync;
     · conteúdo REAL — só descreve o que o Nexo hoje faz; o que
       ainda não existe é dito como pendente, nunca como pronto;
     · nada de "esta página chega em breve";
     · nenhum dado pessoal, senha ou chave aparece aqui.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const help = {};

  /* ---------------- helpers ---------------- */
  const u = NX.util || {};
  const h = typeof u.h === "function" ? u.h : (s) => String(s == null ? "" : s);
  const ico = (name, size, cls) =>
    typeof NX.icon === "function" ? NX.icon(name, cls || "", size || 20) : "";
  const mark = (size) => (typeof NX.brandMark === "function" ? NX.brandMark(size || 28) : "");
  const t = (key, fallback) => (NX.i18n && NX.i18n.get ? NX.i18n.get(key, fallback) : fallback);

  /* `u.h` já faz o escape de HTML — usar direto, sem re-escapar. */
  const esc = (s) => h(s);

  const PAGES = {
    ajuda: { title: t("help.tituloAjuda", "Central de ajuda"), icon: "book" },
    suporte: { title: t("help.tituloSuporte", "Suporte"), icon: "ticket" },
    termos: { title: t("help.tituloTermos", "Termos de Uso"), icon: "list" },
    privacidade: { title: t("help.tituloPrivacidade", "Política de Privacidade"), icon: "lock" },
  };

  /* =========================================================
     CONTEÚDO · CENTRAL DE AJUDA
     ========================================================= */

  const HELP_TOPICS = [
    {
      id: "conta",
      icon: "user",
      title: t("help.topicoConta", "Criar conta e entrar"),
      body: [
        t("help.conta1", "O cadastro do Nexo pede nome de usuário, e-mail e senha. O nome de usuário é público; o e-mail não é exibido para outras pessoas."),
        t("help.conta2", "Para entrar, use seu nome de usuário e senha na tela de login. Se esquecer a senha, use a opção de recuperação apresentada na própria tela de login."),
      ],
    },
    {
      id: "email",
      icon: "mail",
      title: t("help.topicoEmail", "Confirmar o e-mail"),
      body: [
        t("help.email1", "Quando a confirmação de e-mail está ativada no Nexo, o cadastro ainda não dá acesso à conta: você recebe uma mensagem no endereço informado e precisa confirmar antes de entrar."),
        t("help.email2", "A mensagem vem do serviço de autenticação configurado pelo Nexo. Se ela não chegar, verifique a caixa de spam e outras pastas, e use o botão de reenviar da tela de confirmação — ele tem limite de tentativas para evitar spam."),
        t("help.email3", "Se você já tentou entrar e a mensagem diz que o e-mail ainda não foi confirmado, a conta existe mas ainda está aguardando a confirmação."),
      ],
    },
    {
      id: "amigos",
      icon: "users",
      title: t("help.topicoAmigos", "Amigos e conversas privadas"),
      body: [
        t("help.amigos1", "Você procura pessoas pelo nome de usuário e envia um pedido de amizade. O pedido aparece para a outra pessoa, que pode aceitar ou recusar."),
        t("help.amigos2", "Depois de aceito, a conversa privada abre na área de mensagens. Cada pessoa pode bloquear a outra, o que encerra o envio de mensagens e pedidos entre elas."),
        t("help.amigos3", "As conversas privadas respeitam a privacidade definida por cada pessoa: quem pode enviar mensagem pode ser limitado a amigos, a pessoas que você segue, ou a ninguém."),
      ],
    },
    {
      id: "servidores",
      icon: "hash",
      title: t("help.topicoServidores", "Servidores, canais e categorias"),
      body: [
        t("help.servidores1", "Um servidor é um espaço da sua comunidade. Dentro dele, os canais ficam organizados em categorias — assim o assunto de cada conversa fica separado."),
        t("help.servidores2", "Há canais de texto, para mensagens, e canais de voz, para conversar ao vivo. Só quem é membro do servidor enxerga os canais que a equipe dele liberou."),
        t("help.servidores3", "Quem cria o servidor é o dono e pode convidar pessoas por link. O link pode ser revogado a qualquer momento nas configurações do servidor."),
      ],
    },
    {
      id: "chamadas",
      icon: "phone",
      title: t("help.topicoChamadas", "Chamadas de voz e vídeo"),
      body: [
        t("help.chamadas1", "Nos canais de voz você entra com um clique. O Nexo mostra claramente quando o seu microfone ou a sua câmera estão ativos, e você pode desligá-los a qualquer momento."),
        t("help.chamadas2", "O microfone e a câmera só são pedidos ao navegador depois que você mesmo aciona a entrada na sala."),
        t("help.chamadas3", "Chamadas em conversas privadas ainda não estão disponíveis no Nexo — a estrutura de chamadas existe nos canais de voz de servidores."),
      ],
    },
    {
      id: "perfil",
      icon: "palette",
      title: t("help.topicoPerfil", "Perfil, avatar e aparência"),
      body: [
        t("help.perfil1", "No perfil você altera nome de exibição, avatar, banner e bio. Cada pessoa enxerga o seu perfil como você o configurou."),
        t("help.perfil2", "As opções de aparência ficam nas configurações da sua conta. O tema escolhido por você vale só para a sua conta — não muda o visual das outras pessoas nem o de um servidor."),
      ],
    },
    {
      id: "notif",
      icon: "bell",
      title: t("help.topicoNotif", "Notificações e privacidade"),
      body: [
        t("help.notif1", "As notificações podem ser ajustadas por conta. O Nexo respeita o seu foco: os avisos seguem as regras de som e as preferências que você definir."),
        t("help.notif2", "Na privacidade você controla quem pode enviar mensagens privadas, quem pode ver sua atividade e quem pode procurar você pela rede social."),
        t("help.notif3", "Você pode bloquear pessoas. Um bloqueio impede mensagens, pedidos e chamadas entre os dois lados, e nenhum dos dois contorna o bloqueio do outro."),
      ],
    },
    {
      id: "bots",
      icon: "bot",
      title: t("help.topicoBots", "Bots e apps"),
      body: [
        t("help.bots1", "Apps e bots são instalados em servidores e mostram as permissões que pedem antes de serem adicionados."),
        t("help.bots2", "Quem administra o servidor pode remover um app a qualquer momento. Um bot nunca recebe permissão maior do que a de quem o instalou."),
      ],
    },
  ];

  const HELP_FAQ = [
    {
      q: t("help.faq1q", "Não consigo entrar na minha conta. O que fazer?"),
      a: t("help.faq1a", "Confirme se o nome de usuário e a senha estão corretos. Se o cadastro pediu confirmação de e-mail e você ainda não confirmou, o login é bloqueado até a confirmação — use o botão de reenviar na tela de confirmação."),
    },
    {
      q: t("help.faq2q", "Não recebo o e-mail de confirmação."),
      a: t("help.faq2a", "Verifique a caixa de spam e outras pastas. O envio tem limite de tentativas: se você tentou várias vezes, aguarde um pouco antes de reenviar. Se o problema continuar, abra um chamado na página de Suporte."),
    },
    {
      q: t("help.faq3q", "Como adiciono alguém?"),
      a: t("help.faq3a", "Procure a pessoa pelo nome de usuário e envie um pedido de amizade. Quando ela aceitar, a conversa privada fica disponível na área de mensagens."),
    },
    {
      q: t("help.faq4q", "Posso apagar uma mensagem?"),
      a: t("help.faq4a", "Você pode apagar as mensagens que você mesmo enviou. A equipe do servidor pode moderar as mensagens dentro do próprio servidor, conforme as permissões que ela definiu."),
    },
    {
      q: t("help.faq5q", "Outra pessoa vê meu e-mail?"),
      a: t("help.faq5a", "Não. O e-mail é usado só para cadastro, confirmação e recuperação de conta, e não aparece no seu perfil nem nas listas de membros."),
    },
    {
      q: t("help.faq6q", "Posso usar o Nexo no celular?"),
      a: t("help.faq6a", "Sim. A interface se adapta a telas menores, com menu lateral e navegação própria para celular."),
    },
  ];

  /* =========================================================
     CONTEÚDO · TERMOS DE USO
     ========================================================= */

  const TERMS = [
    {
      n: "1",
      title: t("help.termos1t", "Aceitação dos termos"),
      body: t(
        "help.termos1b",
        "Ao criar uma conta ou usar o Nexo, você concorda com estes Termos de Uso. Se não concorda, não use a plataforma. Estes termos são um texto inicial do projeto e precisam de revisão jurídica antes de um lançamento público."
      ),
    },
    {
      n: "2",
      title: t("help.termos2t", "Requisitos para usar a plataforma"),
      body: t(
        "help.termos2b",
        "Você precisa ser capaz de firmar um contrato válido para usar o Nexo. Se você for menor de idade, use a plataforma somente com o consentimento e supervisão de quem tem a responsabilidade sobre você, conforme as leis do seu país."
      ),
    },
    {
      n: "3",
      title: t("help.termos3t", "Segurança da conta"),
      body: t(
        "help.termos3b",
        "Sua conta é pessoal e intransferível. Você é responsável pelas atividades realizadas com suas credenciais. Mantenha sua senha em sigilo e avise imediatamente se suspeitar de acesso indevido. Não compartilhe sua senha com ninguém, inclusive com pessoas que se apresentem como equipe do Nexo."
      ),
    },
    {
      n: "4",
      title: t("help.termos4t", "Regras de convivência"),
      body: t(
        "help.termos4b",
        "Trate as outras pessoas com respeito. Não publique conteúdo que vise intimidar, humilhar, perseguir ou expor alguém. Discriminação, assédio, ameaças e incitação à violência não são permitidos."
      ),
    },
    {
      n: "5",
      title: t("help.termos5t", "Conteúdo publicado pelos usuários"),
      body: t(
        "help.termos5b",
        "O conteúdo que você publica continua sendo seu. Ao publicar, você concede ao Nexo a permissão técnica de exibir e transmitir esse conteúdo dentro da plataforma, para que ele chegue às pessoas com quem você o compartilhou. Você é responsável por ter os direitos sobre o que publica."
      ),
    },
    {
      n: "6",
      title: t("help.termos6t", "Spam, abuso e atividades proibidas"),
      body: t(
        "help.termos6b",
        "É proibido enviar spam, flood, conteúdo automatizado não autorizado, golpes, tentativas de invasão, distribuição de malware e qualquer atividade que comprometa a plataforma ou outras contas. Instalar bots e apps que exijam permissões amplas em servidores de terceiros sem autorização não é permitido."
      ),
    },
    {
      n: "7",
      title: t("help.termos7t", "Moderação e denúncias"),
      body: t(
        "help.termos7b",
        "Cada servidor tem sua própria equipe, que define regras adicionais e modera o conteúdo dentro daquele espaço. Denúncias podem ser feitas pela própria interface, tanto para mensagens quanto para perfis. O Nexo pode analisar conteúdo denunciado para decidir sobre violações destes termos."
      ),
    },
    {
      n: "8",
      title: t("help.termos8t", "Suspensão e encerramento de contas"),
      body: t(
        "help.termos8b",
        "O descumprimento destes termos pode levar a advertência, restrição de recursos ou suspensão da conta. Em casos graves, o encerramento pode ser imediato. Você também pode encerrar a sua conta a qualquer momento pelas configurações da conta."
      ),
    },
    {
      n: "9",
      title: t("help.termos9t", "Disponibilidade e alterações do serviço"),
      body: t(
        "help.termos9b",
        "O Nexo é fornecido no estado em que está. Recursos podem ser alterados, adicionados ou retirados, e o serviço pode ficar indisponível por períodos de manutenção ou falha. Faremos o possível para avisar sobre mudanças relevantes destes termos."
      ),
    },
    {
      n: "10",
      title: t("help.termos10t", "Contato"),
      body: t(
        "help.termos10b",
        "Dúvidas sobre estes termos podem ser enviadas pela página de Suporte, acessível pelo rodapé do site."
      ),
    },
  ];

  /* =========================================================
     CONTEÚDO · POLÍTICA DE PRIVACIDADE
     Escrita a partir do que o projeto realmente armazena hoje
     (tabelas users, prefs, presence, friendships, messages,
     dm_messages, servers, channels, notifications, logs).
     ========================================================= */

  const PRIVACY = [
    {
      icon: "user",
      title: t("help.priv1t", "Dados de cadastro e perfil"),
      body: t(
        "help.priv1b",
        "O cadastro registra nome de usuário, e-mail e a senha, que é guardada apenas na forma de um resumo criptográfico — o texto da senha nunca é guardado. No perfil ficam nome de exibição, avatar, banner e biografia, editáveis por você."
      ),
    },
    {
      icon: "chat",
      title: t("help.priv2t", "Mensagens e conteúdo que você envia"),
      body: t(
        "help.priv2b",
        "As mensagens de canais e de conversas privadas são armazenadas para que a conversa funcione e possa ser lida de novo. Publicações, comentários, anexos e reações que você faz também ficam registrados."
      ),
    },
    {
      icon: "users",
      title: t("help.priv3t", "Relações e organização"),
      body: t(
        "help.priv3b",
        "São armazenados seus servidores, seus canais e categorias, suas amizades, seus pedidos de amizade, suas bloqueios e seus cargos. Esses dados existem para organizar as comunidades das quais você faz parte."
      ),
    },
    {
      icon: "clock",
      title: t("help.priv4t", "Dados técnicos"),
      body: t(
        "help.priv4b",
        "O Nexo guarda a sua última atividade e o seu estado de presença (online, ausente, não perturbar, offline), que você pode controlar nas configurações de privacidade. Os registros administrativos de um servidor guardam ações da equipe de moderação, como criação e exclusão de canais."
      ),
    },
    {
      icon: "shield",
      title: t("help.priv5t", "Para que usamos esses dados"),
      body: t(
        "help.priv5b",
        "Os dados servem exclusivamente para operar a plataforma: autenticar você, exibir seu perfil, entregar as mensagens, aplicar suas permissões e preferências, e exibir notificações. O Nexo não usa seus dados para publicidade de terceiros."
      ),
    },
    {
      icon: "plug",
      title: t("help.priv6t", "Serviços que processam os dados"),
      body: t(
        "help.priv6b",
        "O Nexo usa o Supabase para armazenar os dados e o serviço de autenticação do Supabase para cadastro, confirmação de e-mail e recuperação de conta. Esses prestadores processam dados em nome do Nexo, apenas para manter a plataforma funcionando."
      ),
    },
    {
      icon: "lock",
      title: t("help.priv7t", "Armazenamento e segurança"),
      body: t(
        "help.priv7b",
        "As senhas são guardadas como resumo criptográfico e nunca em texto puro. As credenciais de acesso ao banco não são expostas ao navegador. O acesso a cada pessoa é conferido no servidor antes de entregar ou gravar qualquer dado."
      ),
    },
    {
      icon: "share",
      title: t("help.priv8t", "Compartilhamento com terceiros"),
      body: t(
        "help.priv8b",
        "Os dados não são vendidos nem compartilhados com terceiros fora do escopo de operar a plataforma — ou seja, com os prestadores descritos acima. O Nexo não possui integradores de análise publicitária."
      ),
    },
    {
      icon: "eyeOff",
      title: t("help.priv9t", "Seus controles"),
      body: t(
        "help.priv9b",
        "Você pode editar seu perfil, ajustar suas preferências de privacidade, bloquear pessoas e apagar conteúdos que publicou. As preferências de privacidade são aplicadas no servidor, não apenas escondidas na tela."
      ),
    },
    {
      icon: "trash",
      title: t("help.priv10t", "Exclusão de conta"),
      body: t(
        "help.priv10b",
        "Você pode encerrar sua conta pelas configurações. A exclusão da conta e o tratamento definitivo dos dados associados dependem da configuração de retenção do projeto e ainda estão sendo definidos — este ponto está marcado para revisão."
      ),
    },
    {
      icon: "box",
      title: t("help.priv11t", "Cookies e armazenamento local"),
      body: t(
        "help.priv11b",
        "O Nexo usa o armazenamento do navegador para manter a sua sessão e as suas preferências locais, e um cookie para manter você conectado. Não há cookies de publicidade nem de terceiros."
      ),
    },
    {
      icon: "mail",
      title: t("help.priv12t", "Contato"),
      body: t(
        "help.priv12b",
        "Questões sobre privacidade podem ser enviadas pela página de Suporte, acessível pelo rodapé do site."
      ),
    },
  ];

  /* Itens que AINDA dependem de decisão/implantação — marcados
     na própria página, em vez de prometer o que não existe. */
  const PRIVACY_PENDING = [
    t("help.pend1", "Política de retenção e exclusão definitiva dos dados após o encerramento da conta."),
    t("help.pend2", "Canal oficial de contato por e-mail para assuntos de privacidade."),
    t("help.pend3", "Revisão jurídica dos textos de Termos e Privacidade."),
  ];

  /* =========================================================
     FORMULÁRIO DE SUPORTE
     ========================================================= */

  const SUPPORT_CATEGORIES = [
    { id: "login", label: t("help.catLogin", "Login e cadastro") },
    { id: "email", label: t("help.catEmail", "Confirmação de e-mail") },
    { id: "social", label: t("help.catSocial", "Mensagens, amigos e servidores") },
    { id: "call", label: t("help.catCall", "Chamadas e notificações") },
    { id: "bug", label: t("help.catBug", "Bugs e erros gerais") },
  ];

  /* =========================================================
     MONTAGEM DAS TELAS
     ========================================================= */

  function shellHTML(page, bodyHTML) {
    const meta = PAGES[page] || PAGES.ajuda;
    /* a página é pública: o "voltar" leva ao início, que mostra a
       landing para quem não tem sessão e o app para quem tem. */
    const back = "#/";
    return (
      '<div class="help" data-help-page="' + esc(page) + '">' +
        '<header class="help__bar">' +
          '<div class="help__bar-inner">' +
            '<a class="help__brand" href="' + back + '" data-action="nav" data-to="' + back + '" aria-label="' + esc(t("help.voltarInicio", "Voltar ao início")) + '">' +
              mark(26) + '<span>Nexo</span>' +
            "</a>" +
            '<nav class="help__nav" aria-label="' + esc(t("help.navAjuda", "Navegação de ajuda")) + '">' +
              Object.keys(PAGES).map(
                (k) =>
                  '<a class="help__navlink' + (k === page ? " is-active" : "") + '" href="#/' + k + '" data-action="nav" data-to="#/' + k + '"' +
                  (k === page ? ' aria-current="page"' : "") + ">" + esc(PAGES[k].title) + "</a>"
              ).join("") +
            "</nav>" +
            '<a class="help__home" href="' + back + '" data-action="nav" data-to="' + back + '">' +
              ico("home", 18) + "<span>" + esc(t("help.voltarInicio", "Voltar ao início")) + "</span>" +
            "</a>" +
          "</div>" +
        "</header>" +
        '<main class="help__main" id="help-top" tabindex="-1">' +
          '<div class="help__wrap">' +
            '<div class="help__head">' +
              '<span class="help__eyebrow">' + ico(meta.icon, 16) + "<span>Nexo · " + esc(meta.title) + "</span></span>" +
              "<h1>" + esc(meta.title) + "</h1>" +
            "</div>" +
            bodyHTML +
          "</div>" +
        "</main>" +
      "</div>"
    );
  }

  /* ---------------- central de ajuda ---------------- */

  function topicHTML(topic) {
    return (
      '<article class="help-topic" id="t-' + esc(topic.id) + '">' +
        '<div class="help-topic__ico">' + ico(topic.icon, 20) + "</div>" +
        "<h3>" + esc(topic.title) + "</h3>" +
        topic.body.map((p) => "<p>" + esc(p) + "</p>").join("") +
      "</article>"
    );
  }

  function faqHTML(item) {
    return (
      '<details class="help-faq">' +
        "<summary>" + esc(item.q) + '<span class="help-faq__chev">' + ico("chevronDown", 16) + "</span></summary>" +
        "<p>" + esc(item.a) + "</p>" +
      "</details>"
    );
  }

  function renderAjuda(root) {
    const body =
      '<p class="help__lead">' +
        esc(t("help.leadAjuda", "O Nexo é um espaço para criar comunidades, organizar canais e conversar com as pessoas que importam. Estas páginas explicam, passo a passo, como usar cada recurso.")) +
      "</p>" +

      '<section class="help__search" aria-labelledby="help-search-h">' +
        '<h2 id="help-search-h" class="help__h2">' + esc(t("help.buscarTitulo", "Buscar na central de ajuda")) + "</h2>" +
        '<div class="help__searchbox">' +
          ico("search", 18) +
          '<input type="search" id="help-search" data-help-search autocomplete="off" ' +
            'placeholder="' + esc(t("help.buscarPh", "Digite um assunto: e-mail, chamada, servidor…")) + '" ' +
            'aria-label="' + esc(t("help.buscarAria", "Buscar artigos de ajuda")) + '" />' +
          '<span class="help__searchcount" data-help-count aria-live="polite"></span>' +
        "</div>" +
      "</section>" +

      '<section aria-labelledby="help-topics-h">' +
        '<h2 id="help-topics-h" class="help__h2">' + esc(t("help.temasTitulo", "Como usar o Nexo")) + "</h2>" +
        '<div class="help-grid" data-help-topics>' +
          HELP_TOPICS.map(topicHTML).join("") +
        "</div>" +
        '<p class="help__empty" data-help-empty hidden>' +
          esc(t("help.semResultado", "Nenhum artigo encontrado para essa busca. Tente outra palavra ou abra um chamado na página de Suporte.")) +
        "</p>" +
      "</section>" +

      '<section aria-labelledby="help-faq-h">' +
        '<h2 id="help-faq-h" class="help__h2">' + esc(t("help.faqTitulo", "Perguntas frequentes")) + "</h2>" +
        '<div class="help-faqs" data-help-faq>' + HELP_FAQ.map(faqHTML).join("") + "</div>" +
      "</section>" +

      '<aside class="help__cta">' +
        "<div>" +
          "<h2>" + esc(t("help.aindaDuvida", "Ainda com dúvida?")) + "</h2>" +
          "<p>" + esc(t("help.aindaDuvidaTxt", "Se o artigo não resolveu, abra um chamado descrevendo o que aconteceu.")) + "</p>" +
        "</div>" +
        '<a class="btn btn--primary" href="#/suporte" data-action="nav" data-to="#/suporte">' +
          ico("ticket", 18) + "<span>" + esc(t("help.abrirChamado", "Abrir um chamado")) + "</span>" +
        "</a>" +
      "</aside>";

    root.innerHTML = shellHTML("ajuda", body);
    wireSearch(root);
  }

  /* Busca real: filtra os artigos e as perguntas já renderizados,
     sem rede e sem enviar nada a lugar nenhum. */
  function wireSearch(root) {
    const input = root.querySelector("[data-help-search]");
    if (!input) return;
    const topics = Array.prototype.slice.call(root.querySelectorAll("[data-help-topics] .help-topic"));
    const faqs = Array.prototype.slice.call(root.querySelectorAll("[data-help-faq] .help-faq"));
    const empty = root.querySelector("[data-help-empty]");
    const count = root.querySelector("[data-help-count]");

    const norm = (s) =>
      String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");

    input.addEventListener("input", () => {
      const q = norm(input.value).trim();
      let shown = 0;
      topics.forEach((el) => {
        const hit = !q || norm(el.textContent).indexOf(q) !== -1;
        el.hidden = !hit;
        if (hit) shown++;
      });
      faqs.forEach((el) => {
        const hit = !q || norm(el.textContent).indexOf(q) !== -1;
        el.hidden = !hit;
        if (hit) shown++;
      });
      if (empty) empty.hidden = !(q && shown === 0);
      if (count) count.textContent = q ? String(shown) : "";
    });
  }

  /* ---------------- suporte ---------------- */

  function renderSuporte(root) {
    const opts = SUPPORT_CATEGORIES.map(
      (c) => '<option value="' + esc(c.id) + '">' + esc(c.label) + "</option>"
    ).join("");

    const body =
      '<p class="help__lead">' +
        esc(t("help.leadSuporte", "Encontrou um problema? Descreva o que aconteceu para que a equipe possa analisar.")) +
      "</p>" +

      '<div class="help__note help__note--warn" role="note">' +
        ico("alert", 18) +
        "<div><strong>" + esc(t("help.suporteAvisoTitulo", "O chamado é enviado ao servidor do Nexo.")) + "</strong>" +
        "<p>" + esc(
          t(
            "help.suporteAvisoTxt",
            "Você precisa estar conectado para abrir um chamado: sem sessão não há como a equipe devolver a resposta. Se o canal de atendimento estiver indisponível, o formulário avisa ANTES de enviar e mostra o texto para você não perdê-lo — nada é gravado e nada é fingido como enviado."
          )
        ) + "</p></div>" +
      "</div>" +

      '<div data-help-auth hidden></div>' +

      '<form class="help-form" data-help-form novalidate>' +
        '<div class="help-form__row">' +
          '<label class="help-form__field">' +
            "<span>" + esc(t("help.campoAssunto", "Assunto")) + "</span>" +
            '<input type="text" name="assunto" maxlength="120" required autocomplete="off" ' +
              'placeholder="' + esc(t("help.campoAssuntoPh", "Resuma o problema em uma linha")) + '" />' +
            '<em class="help-form__err" data-err-for="assunto" hidden></em>' +
          "</label>" +
          '<label class="help-form__field">' +
            "<span>" + esc(t("help.campoCategoria", "Categoria")) + "</span>" +
            '<select name="categoria" required>' +
              '<option value="">' + esc(t("help.selecione", "Selecione uma categoria")) + "</option>" +
              opts +
            "</select>" +
            '<em class="help-form__err" data-err-for="categoria" hidden></em>' +
          "</label>" +
        "</div>" +
        '<label class="help-form__field">' +
          "<span>" + esc(t("help.campoDescricao", "Descrição")) + "</span>" +
          '<textarea name="descricao" rows="7" minlength="20" maxlength="4000" required ' +
            'placeholder="' + esc(t("help.campoDescricaoPh", "Explique o que você fez, o que esperava que acontecesse e o que aconteceu. Se apareceu uma mensagem de erro, copie o texto dela.")) + '"></textarea>' +
          '<em class="help-form__err" data-err-for="descricao" hidden></em>' +
        "</label>" +
        '<div class="help-form__actions">' +
          '<button type="submit" class="btn btn--primary" data-help-send>' + ico("send", 18) +
            '<span data-help-send-label>' + esc(t("help.abrirChamado", "Abrir um chamado")) + "</span></button>" +
          '<button type="reset" class="btn btn--ghost">' + esc(t("common.limpar", "Limpar")) + "</button>" +
        "</div>" +
        '<div class="help-form__result" data-help-result hidden></div>' +
      "</form>" +

      '<section aria-labelledby="help-meus-h" data-help-mine-sec hidden>' +
        '<h2 id="help-meus-h" class="help__h2">' + esc(t("help.meusChamados", "Meus chamados")) + "</h2>" +
        '<div class="help__tickets" data-help-mine></div>' +
      "</section>" +

      '<section aria-labelledby="help-outras-h">' +
        '<h2 id="help-outras-h" class="help__h2">' + esc(t("help.enquantoIsso", "Enquanto o canal não existe")) + "</h2>" +
        '<ul class="help__list">' +
          "<li>" + esc(t("help.outra1", "Para e-mail de confirmação: verifique a caixa de spam e use o botão de reenviar na tela de confirmação — ele respeita o limite de tentativas.")) + "</li>" +
          "<li>" + esc(t("help.outra2", "Para problemas de servidor: a equipe de moderação do próprio servidor pode analisar o caso pelo canal de suporte dele.")) + "</li>" +
          "<li>" + esc(t("help.outra3", "Para a sua conta: as configurações da conta permitem alterar perfil, senha e preferências de privacidade.")) + "</li>" +
        "</ul>" +
      "</section>";

    root.innerHTML = shellHTML("suporte", body);
    wireSupportForm(root);
    loadMine(root);
  }

  function wireSupportForm(root) {
    const form = root.querySelector("[data-help-form]");
    if (!form) return;
    const result = root.querySelector("[data-help-result]");

    const showErr = (name, msg) => {
      const em = form.querySelector('[data-err-for="' + name + '"]');
      if (!em) return;
      em.textContent = msg || "";
      em.hidden = !msg;
      const field = form.elements[name];
      if (field) {
        if (msg) field.setAttribute("aria-invalid", "true");
        else field.removeAttribute("aria-invalid");
      }
    };

    form.addEventListener("input", (ev) => {
      const n = ev.target && ev.target.name;
      if (n) showErr(n, "");
    });

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (result) result.hidden = true;

      const assunto = String(form.elements.assunto.value || "").trim();
      const categoria = String(form.elements.categoria.value || "");
      const descricao = String(form.elements.descricao.value || "").trim();
      let firstBad = null;

      showErr("assunto", "");
      showErr("categoria", "");
      showErr("descricao", "");

      if (assunto.length < 5) {
        showErr("assunto", t("help.errAssunto", "Escreva um assunto com pelo menos 5 caracteres."));
        firstBad = firstBad || form.elements.assunto;
      }
      if (!categoria) {
        showErr("categoria", t("help.errCategoria", "Escolha a categoria que mais se aproxima do problema."));
        firstBad = firstBad || form.elements.categoria;
      }
      if (descricao.length < 20) {
        showErr("descricao", t("help.errDescricao", "Descreva o problema com pelo menos 20 caracteres."));
        firstBad = firstBad || form.elements.descricao;
      }
      if (firstBad) {
        firstBad.focus();
        return;
      }

      const catLabel =
        (SUPPORT_CATEGORIES.filter((c) => c.id === categoria)[0] || {}).label || categoria;

      submitTicket(root, form, result, {
        subject: assunto,
        category: categoria,
        description: descricao,
        catLabel: catLabel,
      });
    });

    form.addEventListener("reset", () => {
      showErr("assunto", "");
      showErr("categoria", "");
      showErr("descricao", "");
      if (result) result.hidden = true;
    });
  }

  /* =========================================================
     ENVIO DO CHAMADO
     O formulário fala com o servidor de verdade. Três saídas
     possíveis, e as três são ditas como são:
       · sucesso → mostra o protocolo que o servidor devolveu;
       · 503 pendente → o banco ainda não tem a tabela de
         chamados; avisa ANTES de perder o texto e entrega a
         prévia para copiar;
       · outro erro → repassa a mensagem do servidor, sem
         traduzir para "tudo certo".
     ========================================================= */

  function meUser() {
    return NX.selectors && NX.selectors.me ? NX.selectors.me() : null;
  }

  function fmtDate(msOrIso) {
    const d = new Date(typeof msOrIso === "number" ? msOrIso : Date.parse(String(msOrIso || "")));
    if (isNaN(d.getTime())) return "";
    try {
      return d.toLocaleString(t("help.locale", "pt-BR"), {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return d.toISOString();
    }
  }

  /* Um único bloco, com o aviso em cima e o conteúdo embaixo —
     dois blocos com a mesma classe fariam o seletor achar o aviso
     e esconder o texto escrito. */
  function previewHTML(d, warn) {
    return (
      '<div class="help-form__preview">' +
        (warn
          ? '<strong>' + ico("alert", 18) + " " + esc(warn.title) + "</strong>" +
            (warn.text ? "<p>" + esc(warn.text) + "</p>" : "") +
            (warn.text2 ? "<p>" + esc(warn.text2) + "</p>" : "")
          : "") +
        "<dl>" +
          "<dt>" + esc(t("help.campoAssunto", "Assunto")) + "</dt><dd>" + esc(d.subject) + "</dd>" +
          "<dt>" + esc(t("help.campoCategoria", "Categoria")) + "</dt><dd>" + esc(d.catLabel) + "</dd>" +
        "</dl>" +
        "<pre>" + esc(d.description) + "</pre>" +
        '<div class="help-form__preview-acts">' +
          '<button type="button" class="btn btn--soft" data-help-copy>' + ico("copy", 18) +
            "<span>" + esc(t("help.copiarTexto", "Copiar texto")) + "</span></button>" +
        "</div>" +
      "</div>"
    );
  }

  function bindCopy(scope, d) {
    const btn = scope.querySelector("[data-help-copy]");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const full =
        t("help.campoAssunto", "Assunto") + ": " + d.subject + "\n" +
        t("help.campoCategoria", "Categoria") + ": " + d.catLabel + "\n\n" +
        d.description;
      let okCopy = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(full);
          okCopy = true;
        }
      } catch (e) {
        okCopy = false;
      }
      const label = btn.querySelector("span");
      if (label) {
        label.textContent = okCopy
          ? t("help.copiado", "Copiado")
          : t("help.copiaFalhou", "Não foi possível copiar — selecione o texto manualmente.");
      }
    });
  }

  function showResult(result, html, scopeData) {
    if (!result) return;
    result.hidden = false;
    result.innerHTML = html;
    if (scopeData) bindCopy(result, scopeData);
    result.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function submitTicket(root, form, result, d) {
    const btn = form.querySelector("[data-help-send]");
    const btnLabel = form.querySelector("[data-help-send-label]");

    /* sem sessão o servidor recusaria de qualquer jeito: avisar
       antes evita um erro seco e explica o porquê */
    if (!meUser()) {
      showResult(
        result,
        '<div class="help-form__preview">' +
          "<strong>" + esc(t("help.entreParaAbrir", "Entre para abrir um chamado")) + "</strong>" +
          "<p>" + esc(
            t(
              "help.entreParaAbrirTxt",
              "O chamado precisa ficar ligado a uma conta: é assim que a equipe sabe de quem é e consegue responder. Entre ou crie uma conta e volte para esta página."
            )
          ) + "</p>" +
          '<div class="help-form__preview-acts">' +
            '<a class="btn btn--primary" href="#/login" data-action="nav" data-to="#/login">' +
              esc(t("adm.entrar", "Entrar")) + "</a>" +
            '<a class="btn btn--soft" href="#/registro" data-action="nav" data-to="#/registro">' +
              esc(t("app.criarconta", "Criar conta")) + "</a>" +
          "</div>" +
        "</div>"
      );
      return;
    }

    if (btn) btn.disabled = true;
    if (btnLabel) btnLabel.textContent = t("help.enviando", "Enviando…");

    try {
      const data = await NX.api.openSupportTicket({
        subject: d.subject,
        category: d.category,
        description: d.description,
      });

      const id = data && data.id ? String(data.id) : "";
      showResult(
        result,
        '<div class="help-form__done">' +
          "<strong>" + ico("checkCircle", 18) + " " + esc(t("help.chamadoAberto", "Chamado aberto")) + "</strong>" +
          "<p>" + esc(
            t("help.chamadoAbertoTxt", "Seu chamado foi registrado no Nexo. Guarde o identificador abaixo para acompanhar.")
          ) + "</p>" +
          "<dl>" +
            (id
              ? "<dt>" + esc(t("help.protocolo", "Protocolo")) + "</dt><dd><code>" + esc(id) + "</code></dd>"
              : "") +
            "<dt>" + esc(t("help.campoCategoria", "Categoria")) + "</dt><dd>" + esc(d.catLabel) + "</dd>" +
            "<dt>" + esc(t("help.abertoEm", "Aberto em")) + "</dt><dd>" + esc(fmtDate((data && data.createdAt) || Date.now())) + "</dd>" +
          "</dl>" +
        "</div>"
      );
      form.reset();
      loadMine(root);
    } catch (err) {
      const code = (err && err.code) || "";
      const msg = (err && err.message) || "";

      if (code === "schema_pending") {
        /* o canal de atendimento ainda não foi implantado no banco.
           Não há envio: diz isso e entrega o texto para não sumir. */
        showResult(
          result,
          previewHTML(d, {
            title: t("help.previewTitulo", "Sua solicitação NÃO foi enviada"),
            text:
              msg ||
              t(
                "help.suportePendenteTxt",
                "O canal de atendimento ainda não foi implantado no banco de dados do Nexo. Nenhum chamado é gravado enquanto isso."
              ),
            text2: t("help.previewTxt", "Guarde o texto abaixo para não perdê-lo."),
          }),
          d
        );
      } else if ((err && err.status) === 401 || code === "session" || code === "unauthorized") {
        showResult(
          result,
          '<div class="help-form__preview">' +
            "<strong>" + esc(t("help.sessaoExpirou", "Sua sessão expirou")) + "</strong>" +
            "<p>" + esc(t("help.sessaoExpirouTxt", "Entre novamente para abrir o chamado. O que você escreveu continua no formulário.")) + "</p>" +
            '<div class="help-form__preview-acts">' +
              '<a class="btn btn--primary" href="#/login" data-action="nav" data-to="#/login">' +
                esc(t("adm.entrar", "Entrar")) + "</a>" +
            "</div>" +
          "</div>"
        );
      } else {
        showResult(
          result,
          previewHTML(d, {
            title: t("help.envioFalhou", "Não foi possível enviar o chamado"),
            text:
              msg || t("help.envioFalhouTxt", "Tente de novo em instantes. O que você escreveu continua no formulário."),
            text2: t("help.previewTxt", "Guarde o texto abaixo para não perdê-lo."),
          }),
          d
        );
      }
    } finally {
      if (btn) btn.disabled = false;
      if (btnLabel) btnLabel.textContent = t("help.abrirChamado", "Abrir um chamado");
    }
  }

  /* lista de "Meus chamados": só quem tem sessão. Se o banco ainda
     não tem a tabela, a seção simplesmente não aparece — em vez de
     mostrar lista vazia como se não houvesse chamado nenhum. */
  const TICKET_STATUS = {
    open: () => t("help.estadoAberto", "Aberto"),
    pending: () => t("help.estadoAguardando", "Aguardando resposta"),
    solved: () => t("help.estadoResolvido", "Resolvido"),
    closed: () => t("help.estadoFechado", "Fechado"),
  };

  function ticketHTML(tk) {
    const label = (TICKET_STATUS[String(tk.status || "open")] || TICKET_STATUS.open)();
    return (
      '<article class="help__ticket">' +
        "<div class=\"help__ticket-head\">" +
          "<strong>" + esc(tk.subject || "") + "</strong>" +
          '<span class="help__ticket-state is-' + esc(String(tk.status || "open")) + '">' + esc(label) + "</span>" +
        "</div>" +
        '<div class="help__ticket-meta">' +
          "<span>" + esc((SUPPORT_CATEGORIES.filter((c) => c.id === tk.category)[0] || {}).label || tk.category || "") + "</span>" +
          "<span>" + esc(fmtDate(tk.createdAt)) + "</span>" +
        "</div>" +
      "</article>"
    );
  }

  async function loadMine(root) {
    const sec = root.querySelector("[data-help-mine-sec]");
    const box = root.querySelector("[data-help-mine]");
    if (!sec || !box) return;
    if (!meUser()) {
      sec.hidden = true;
      return;
    }
    let rows = null;
    try {
      rows = await NX.api.listSupportTickets();
    } catch (e) {
      /* tabela ainda não existe, sem rede ou sessão expirada:
         a seção fica escondida — não se mostra lista vazia
         como se fosse a resposta verdadeira */
      sec.hidden = true;
      return;
    }
    if (!Array.isArray(rows) || !rows.length) {
      sec.hidden = true;
      return;
    }
    box.innerHTML = rows.map(ticketHTML).join("");
    sec.hidden = false;
  }

  /* ---------------- termos / privacidade ---------------- */

  function renderTermos(root) {
    const body =
      '<p class="help__lead">' +
        esc(t("help.leadTermos", "Estes termos descrevem as regras de uso do Nexo. O texto abaixo é uma versão inicial do projeto e NÃO foi revisado por um advogado — ele precisa de revisão jurídica antes do lançamento público.")) +
      "</p>" +
      '<div class="help__note" role="note">' + ico("alert", 18) +
        "<div><strong>" + esc(t("help.avisoJuridico", "Revisão jurídica pendente")) + "</strong>" +
        "<p>" + esc(t("help.avisoJuridicoTxt", "Este documento ainda não passou por análise jurídica. Não use estes termos como aconselhamento legal.")) + "</p></div>" +
      "</div>" +
      '<div class="help-docs">' +
        TERMS.map(
          (s) =>
            '<section class="help-doc" id="termo-' + esc(s.n) + '">' +
              '<h2><span class="help-doc__n">' + esc(s.n) + "</span>" + esc(s.title) + "</h2>" +
              "<p>" + esc(s.body) + "</p>" +
            "</section>"
        ).join("") +
      "</div>" +
      '<p class="help__updated">' + esc(t("help.atualizado", "Última atualização: versão inicial do documento.")) + "</p>";

    root.innerHTML = shellHTML("termos", body);
  }

  function renderPrivacidade(root) {
    const body =
      '<p class="help__lead">' +
        esc(t("help.leadPrivacidade", "Esta política descreve exatamente o que o Nexo coleta hoje, a partir da auditoria do próprio projeto. Onde algo ainda não foi definido, isso está dito de forma explícita.")) +
      "</p>" +
      '<div class="help-docs">' +
        PRIVACY.map(
          (s) =>
            '<section class="help-doc">' +
              '<h2><span class="help-doc__ico">' + ico(s.icon, 18) + "</span>" + esc(s.title) + "</h2>" +
              "<p>" + esc(s.body) + "</p>" +
            "</section>"
        ).join("") +
      "</div>" +
      '<div class="help__note help__note--warn" role="note">' + ico("clock", 18) +
        "<div><strong>" + esc(t("help.pendenciasTitulo", "Ainda em definição")) + "</strong>" +
        "<p>" + esc(t("help.pendenciasTxt", "Os itens abaixo não estão implementados e são apresentados como pendências, não como práticas atuais.")) + "</p>" +
        '<ul class="help__list">' + PRIVACY_PENDING.map((p) => "<li>" + esc(p) + "</li>").join("") + "</ul>" +
        "</div>" +
      "</div>" +
      '<p class="help__updated">' + esc(t("help.atualizado", "Última atualização: versão inicial do documento.")) + "</p>";

    root.innerHTML = shellHTML("privacidade", body);
  }

  /* =========================================================
     API
     ========================================================= */

  help.pages = Object.keys(PAGES);

  /* A página de ajuda é ESTÁTICA: não depende do store. Como o
     roteador redesenha a tela a cada commit do store — e o
     sincronizador comita a cada poucos segundos —, re-renderizar
     aqui apagaria o que a pessoa digitou no formulário e o
     resultado de um envio que já deu certo. Este marcador diz ao
     roteador quando já não há nada a redesenhar. */
  help.isRendered = function (page) {
    const root = document.getElementById("screen-invite");
    if (!root) return false;
    const el = root.querySelector("[data-help-page]");
    return !!el && el.getAttribute("data-help-page") === String(page || "");
  };

  help.render = function (page) {
    const root = document.getElementById("screen-invite");
    if (!root) return;
    const key = Object.prototype.hasOwnProperty.call(PAGES, page) ? page : "ajuda";
    const render = { ajuda: renderAjuda, suporte: renderSuporte, termos: renderTermos, privacidade: renderPrivacidade }[key];
    render(root);
    root.scrollTop = 0;
    const main = root.querySelector(".help__main");
    if (main && main.focus) {
      try { main.focus({ preventScroll: true }); } catch (e) {}
    }
  };

  NX.help = help;
})(window.NX);
