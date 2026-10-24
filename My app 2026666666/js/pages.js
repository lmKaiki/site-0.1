/* ============================================================
   NEXO · páginas
   Tela de acesso (login/cadastro — só nome de usuário + senha),
   página inicial, explorar, perfil, mensagens e tela de convite.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const u = () => NX.util;
  const S = () => NX.selectors;
  const pages = {};

  /* ---- autenticação: rota ↔ modo interno ----
     SEM e-mail, SEM código de verificação, SEM recuperação por
     e-mail: aqui só existem nome de usuário + senha. */
  const AUTH_ALIAS = {
    login: "login",
    cadastro: "signup",
    signup: "signup",
  };
  const AUTH_ROUTE = {
    login: "#/login",
    signup: "#/cadastro",
  };
  pages.routeFor = (mode) => AUTH_ROUTE[AUTH_ALIAS[mode] || mode] || "#/login";

  let authMode = "login";

  /* tela de acesso: apenas nome de usuário + senha.
     (sem e-mail, sem código, sem contagem de reenvio) */


  function passwordRulesHTML(pw) {
    const p = u().passwordPolicy(pw || "");
    return (
      '<ul class="pw-rules" data-pw-rules>' +
      p.checks
        .map(
          (c) =>
            "<li class=" +
            (c.ok ? '"is-ok"' : '""') +
            ">" +
            NX.icon(c.ok ? "check" : "circle", "", 14) +
            "<span>" + u().h(c.label) + "</span></li>"
        )
        .join("") +
      "</ul>"
    );
  }

  pages.setAuthMode = function (mode) {
    authMode = AUTH_ALIAS[mode] || mode || "login";
    pages.renderAuth();
  };

  pages.renderAuth = function (mode) {
    if (mode) authMode = AUTH_ALIAS[mode] || mode || "login";
    const root = document.getElementById("screen-auth");
    if (!root) return;

    const art =
      '<div class="auth__art">' +
      '<div class="auth__brand">' + NX.brandMark(40) + "<span>Nexo</span></div>" +
      '<div class="auth__pitch">' +
      ("<h1>" + NX.i18n.get("page.comunidadescomasuaidentidade", "Comunidades com a sua identidade.") + "</h1>") +
      ("<p>" + NX.i18n.get("page.crieseuservidororganizeporcategorias", "Crie seu servidor, organize por categorias e canais, defina cargos e convide quem você quiser.") + "</p>") +
      "</div>" +
      '<ul class="auth__feats">' +
      "<li>" + NX.icon("folder", "", 18) + ("<span><strong>" + NX.i18n.get("page.categoriasecanais", "Categorias e canais") + "</strong>" + NX.i18n.get("page.doseujeitocomtextoe", "Do seu jeito, com texto e voz.") + "</span></li>") +
      "<li>" + NX.icon("shield", "", 18) + ("<span><strong>" + NX.i18n.get("landing.cargosPermissoes2", "Cargos e permissões") + "</strong>" + NX.i18n.get("page.controlequemfazoque", "Controle quem faz o quê.") + "</span></li>") +
      "<li>" + NX.icon("link", "", 18) + ("<span><strong>" + NX.i18n.get("page.convitessimples", "Convites simples") + "</strong>" + NX.i18n.get("page.umcodigoeaportaesta", "Um código e a porta está aberta.") + "</span></li>") +
      "</ul>" +
      ("<div class=\"auth__quote\">" + NX.i18n.get("page.monteimeuservidoremdoisminutos", "“Montei meu servidor em dois minutos — e o convite saiu na hora.”") + "</div>") +
      "</div>";

    let form = "";

    /* ---------------- LOGIN ---------------- */
    if (authMode === "login") {
      form =
        ("<h2>" + NX.i18n.get("page.bemvindodevolta", "Bem-vindo de volta") + "</h2>") +
        ("<p class=\"auth__sub\">" + NX.i18n.get("page.entreparacontinuarcomassuas", "Entre para continuar com as suas comunidades.") + "</p>") +
        '<form class="auth__form" data-form="login" novalidate>' +
        ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("set.nomeUsuario", "Nome de usuário") + "</span>") +
        '<input class="input" name="identifier" type="text" autocomplete="username" placeholder="' + NX.i18n.get("ui.exanabia", "ex.: ana.bia") + '" data-autofocus /></label>' +
        ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("set.item.password", "Senha") + "</span>") +
        '<span class="input-wrap">' +
        '<input class="input" name="password" type="password" autocomplete="current-password" placeholder="' + NX.i18n.get("ui.suasenha", "Sua senha") + '" />' +
        '<button type="button" class="input-eye" data-action="toggle-password" aria-label="' + NX.i18n.get("set.mostrarSenha", "Mostrar senha") + '">' +
        NX.icon("eye", "", 18) +
        "</button></span></label>" +
        '<div class="auth__row">' +
        ("<label class=\"check\"><input type=\"checkbox\" name=\"remember\" checked /><span class=\"check__box\"></span>" + NX.i18n.get("page.manterconectado", "Manter conectado") + "</label>") +
        "</div>" +
        '<div class="form-error" data-error hidden></div>' +
        ("<button class=\"btn btn--primary btn--block btn--lg\" type=\"submit\" data-busy-label=\"Entrando\">" + NX.i18n.get("adm.entrar", "Entrar") + "</button>") +
        "</form>" +
        '<div class="auth__note">' + NX.icon("shield", "", 16) +
        ("<span>" + NX.i18n.get("page.sevoceesqueceusuasenhaentre", "Se você esqueceu sua senha, entre em contato com a administração da plataforma.") + "</span></div>") +
        ("<div class=\"auth__alt\">" + NX.i18n.get("page.aindanaotemconta", "Ainda não tem conta?")) +
        ("<button class=\"link-btn\" data-action=\"auth-mode\" data-mode=\"signup\">" + NX.i18n.get("app.criarconta", "Criar conta") + "</button></div>") +
        '<div class="auth__foot">' +
        '<button class="link-btn" data-action="goto-landing">' +
        NX.icon("arrowLeft", "", 15) + (" " + NX.i18n.get("page.voltarparainicio", "Voltar para início") + "</button></div>");

      /* ---------------- CADASTRO ---------------- */
    } else if (authMode === "signup") {
      form =
        ("<h2>" + NX.i18n.get("app.criarconta", "Criar conta") + "</h2>") +
        ("<p class=\"auth__sub\">" + NX.i18n.get("page.nomedeusuarioesenhae", "Nome de usuário e senha — é só isso.") + "</p>") +
        '<form class="auth__form" data-form="signup" novalidate>' +
        ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("set.nomeUsuario", "Nome de usuário") + "</span>") +
        '<input class="input" name="username" type="text" autocomplete="username" placeholder="' + NX.i18n.get("ui.pages.exanabia", "ex.: ana.bia") + '" data-autofocus />' +
        ("<span class=\"field__hint\">" + NX.i18n.get("page.3a18caracteresletrasnumeros", "3 a 18 caracteres: letras, números, ponto e sublinhado.") + "</span></label>") +
        ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("set.item.password", "Senha") + "</span>") +
        '<span class="input-wrap"><input class="input" name="password" type="password" autocomplete="new-password" placeholder="' + NX.i18n.get("ui.minimo8caracteres", "Mínimo 8 caracteres") + '" data-pw-source />' +
        '<button type="button" class="input-eye" data-action="toggle-password" aria-label="' + NX.i18n.get("set.mostrarSenha", "Mostrar senha") + '">' +
        NX.icon("eye", "", 18) +
        "</button></span></label>" +
        passwordRulesHTML("") +
        ("<label class=\"field\"><span class=\"field__label\">" + NX.i18n.get("page.confirmarsenha", "Confirmar senha") + "</span>") +
        '<span class="input-wrap"><input class="input" name="confirm" type="password" autocomplete="new-password" placeholder="' + NX.i18n.get("ui.repitaasenha", "Repita a senha") + '" />' +
        '<button type="button" class="input-eye" data-action="toggle-password" aria-label="' + NX.i18n.get("set.mostrarSenha", "Mostrar senha") + '">' +
        NX.icon("eye", "", 18) +
        "</button></span></label>" +
        '<div class="form-error" data-error hidden></div>' +
        ("<button class=\"btn btn--primary btn--block btn--lg\" type=\"submit\" data-busy-label=\"Criando\">" + NX.i18n.get("app.criarconta", "Criar conta") + "</button>") +
        "</form>" +
        '<div class="auth__note">' + NX.icon("shield", "", 16) +
        ("<span>" + NX.i18n.get("page.criouentrouacontaeativada", "Criou, entrou: a conta é ativada na hora, sem etapa de e-mail.") + "</span></div>") +
        ("<div class=\"auth__alt\">" + NX.i18n.get("page.jatemumaconta", "Já tem uma conta?")) +
        ("<button class=\"link-btn\" data-action=\"auth-mode\" data-mode=\"login\">" + NX.i18n.get("adm.entrar", "Entrar") + "</button></div>") +
        '<div class="auth__foot">' +
        '<button class="link-btn" data-action="goto-landing">' +
        NX.icon("arrowLeft", "", 15) + (" " + NX.i18n.get("page.voltarparainicio", "Voltar para início") + "</button></div>");

      /* ---------------- FALLBACK ----------------
         Só existem login e cadastro: qualquer endereço antigo
         (verificação, recuperação, código) volta para o login. */
    } else {
      authMode = "login";
      return pages.renderAuth();
    }

    root.innerHTML =
      '<div class="auth">' +
      art +
      '<div class="auth__panel"><div class="auth__card">' +
      '<div class="auth__mobile-brand">' + NX.brandMark(32) + "<span>Nexo</span></div>" +
      form +
      "</div></div></div>";

    wireAuth(root);
  };

  function showFormError(form, message) {
    const box = form.querySelector("[data-error]");
    if (!box) return;
    if (!message) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML = NX.icon("alert", "", 17) + "<span>" + u().h(message) + "</span>";
  }

  function wireAuth(root) {
    /* checklist de requisitos da senha, ao vivo */
    const pwSource = root.querySelector("[data-pw-source]");
    if (pwSource) {
      const paint = () => {
        const box = root.querySelector("[data-pw-rules]");
        if (!box) return;
        const p = u().passwordPolicy(pwSource.value);
        box.innerHTML = p.checks
          .map(
            (c) =>
              '<li class="' +
              (c.ok ? "is-ok" : "") +
              '">' +
              NX.icon(c.ok ? "check" : "dash", "", 14) +
              "<span>" +
              u().h(c.label) +
              "</span></li>"
          )
          .join("");
      };
      pwSource.addEventListener("input", paint);
      paint();
    }

    root.querySelectorAll("form[data-form]").forEach((form) => {
      const kind = form.getAttribute("data-form");

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        showFormError(form, "");
        const data = Object.fromEntries(new FormData(form).entries());
        const btn = form.querySelector('button[type="submit"]');

        /* ================= CADASTRO =================
           username + senha: sem e-mail, sem termos extras.
           Depois de criada, a conta ENTRA automaticamente. */
        if (kind === "signup") {
          const username = String(data.username || "").trim();
          if (!username) {
            showFormError(form, NX.i18n.get("api.digiteNomeUsuario2", "Digite um nome de usuário."));
            return;
          }
          if (!data.password) {
            showFormError(form, NX.i18n.get("api.digiteSenha", "Digite uma senha."));
            return;
          }
          const policy = u().passwordPolicy(data.password);
          if (!policy.ok) {
            showFormError(form, policy.message);
            return;
          }
          if (String(data.password) !== String(data.confirm)) {
            showFormError(form, NX.i18n.get("api.senhasNaoConferem2", "As senhas não conferem."));
            return;
          }
          const end = NX.ui.busy(btn);
          NX.api.signup({
            username: username,
            password: data.password,
            confirm: data.confirm,
          })
            .then((res) => {
              end();
              NX.ui.toast(res.message || NX.i18n.get("api.suaContaFoiCriada", "Sua conta foi criada com sucesso."), "success");
              NX.app.afterAuth(); /* sessão já criada no cadastro */
            })
            .catch((err) => {
              end();
              showFormError(form, err.message);
            });
          return;
        }

        /* ================= LOGIN =================
           SOMENTE nome de usuário + senha. */
        const ident = String(data.identifier || "").trim();
        if (!ident) {
          showFormError(form, NX.i18n.get("api.digiteSeuNomeUsuario", "Digite seu nome de usuário."));
          return;
        }
        if (!data.password) {
          showFormError(form, NX.i18n.get("api.digiteSuaSenha", "Digite sua senha."));
          return;
        }
        const end = NX.ui.busy(btn);
        NX.api.login({
          identifier: ident,
          password: data.password,
          remember: !!data.remember,
        })
          .then(() => {
            end();
            NX.app.afterAuth();
          })
          .catch((err) => {
            end();
            showFormError(form, err.message);
          });
      });
    });
  }

  /* =========================================================
     PÁGINA INICIAL
     ========================================================= */
  function serverCard(s) {
    const online = S().onlineCount(s.id);
    return (
      '<button class="server-card" data-action="open-server" data-id="' + s.id + '">' +
      '<span class="server-card__top">' +
      u().serverIconHTML(s, "md", false) +
      '<span class="server-card__badges">' +
      (s.ownerId === S().me().id ? ("<span class=\"tag tag--owner\">" + NX.i18n.get("adm.dono4", "Dono") + "</span>") : "") +
      "</span></span>" +
      '<strong class="server-card__name">' + u().h(s.name) + "</strong>" +
      '<span class="server-card__desc truncate">' +
      u().h(s.description || NX.i18n.get("page.descricaoAinda", "Sem descrição ainda.")) +
      "</span>" +
      '<span class="server-card__foot">' +
      "<span>" + NX.icon("users", "", 14) + " " + u().plural(S().memberCount(s.id), "membro", "membros") + "</span>" +
      '<span class="dot-online"></span>' + online + " online" +
      "</span></button>"
    );
  }

  pages.home = function () {
    const me = S().me();
    const servers = S().serversOf(me.id);
    const dms = S().dmsOf(me.id);

    const quick =
      '<div class="quick-grid">' +
      '<button class="quick-card quick-card--accent" data-action="create-server">' +
      '<span class="quick-card__ico">' + NX.icon("plus", "", 22) + "</span>" +
      ("<strong>" + NX.i18n.get("modal.criarServidor", "Criar servidor") + "</strong><span>" + NX.i18n.get("page.nomeiconeeestruturapronta", "Nome, ícone e estrutura pronta.") + "</span></button>") +
      '<button class="quick-card" data-action="join-invite">' +
      '<span class="quick-card__ico">' + NX.icon("enter", "", 22) + "</span>" +
      ("<strong>" + NX.i18n.get("page.entrarConvite", "Entrar com convite") + "</strong><span>" + NX.i18n.get("page.coleocodigoouolink", "Cole o código ou o link.") + "</span></button>") +
      '<button class="quick-card" data-action="nav-explore">' +
      '<span class="quick-card__ico">' + NX.icon("compass", "", 22) + "</span>" +
      (("<strong>" + NX.i18n.get("nav.explore", "Explorar") + "</strong><span>") + NX.i18n.get("page.vejacomunidadesabertas", "Veja comunidades abertas.") + "</span></button>") +
      "</div>";

    const list = servers.length
      ? '<div class="server-grid">' + servers.map(serverCard).join("") + "</div>"
      : '<div class="empty-state">' +
        '<span class="empty-state__ico">' + NX.icon("compass", "", 28) + "</span>" +
        ("<h3>" + NX.i18n.get("page.voceaindanaoestaemnenhum", "Você ainda não está em nenhum servidor") + "</h3>") +
        ("<p>" + NX.i18n.get("page.crieoseuservidorouentre", "Crie o seu servidor ou entre em um por convite. Só servidores que você criar ou entrar aparecem aqui.") + "</p>") +
        '<div class="empty-state__actions">' +
        '<button class="btn btn--primary" data-action="create-server">' +
        NX.icon("plus", "", 16) + (" " + NX.i18n.get("modal.criarServidor", "Criar servidor") + "</button>") +
        '<button class="btn btn--soft" data-action="nav-explore">' +
        NX.icon("search", "", 16) + (" " + NX.i18n.get("view.explorarServidores", "Explorar servidores") + "</button>") +
        "</div></div>";

    const tips =
      '<section class="panel">' +
      '<header class="panel__head"><h3>' + NX.icon("sparkles", "", 17) + (" " + NX.i18n.get("page.oquedaprafazer", "O que dá pra fazer") + "</h3></header>") +
      '<ul class="tip-list">' +
      (("<li><span>📁</span><div><strong>" + NX.i18n.get("adm.categorias", "Categorias") + "</strong><p>") + NX.i18n.get("page.agrupecanaiserecolhaquandoquiser", "Agrupe canais e recolha quando quiser.") + "</p></div></li>") +
      ("<li><span>💬</span><div><strong>" + NX.i18n.get("page.canaisdetextoevoz", "Canais de texto e voz") + "</strong><p>" + NX.i18n.get("page.criegeralmemessalasdevoz", "Crie #geral, #memes, salas de voz e mais.") + "</p></div></li>") +
      ("<li><span>🛡️</span><div><strong>" + NX.i18n.get("landing.cargosPermissoes2", "Cargos e permissões") + "</strong><p>" + NX.i18n.get("page.definaquempodemoderarconvidarou", "Defina quem pode moderar, convidar ou falar.") + "</p></div></li>") +
      (("<li><span>🎟️</span><div><strong>" + NX.i18n.get("set.item.privacyInvites", "Convites") + "</strong><p>") + NX.i18n.get("page.umcodigocurtoabreaporta", "Um código curto abre a porta do seu servidor.") + "</p></div></li>") +
      "</ul></section>";

    const profilePanel =
      '<section class="panel">' +
      '<header class="panel__head"><h3>' + NX.icon("user", "", 17) + (" " + NX.i18n.get("set.seuPerfil", "Seu perfil") + "</h3></header>") +
      '<div class="mini-profile">' +
      u().avatarHTML(me, "xl", true) +
      "<div><strong>" + u().h(me.displayName) + "</strong>" +
      '<span class="mini-profile__user">@' + u().h(me.username) + "</span>" +
      '<span class="status-pill" data-status="' + me.status + '">' + u().h(NX.STATUS_LABEL[me.status]) + "</span></div>" +
      '<div class="mini-profile__actions">' +
      ("<button class=\"btn btn--soft btn--sm\" data-action=\"edit-profile\">" + NX.i18n.get("modal.editarPerfil2", "Editar perfil") + "</button>") +
      '<button class="btn btn--ghost btn--sm" data-action="open-profile" data-id="' + me.id + (NX.i18n.get("page.verpagina", "\">Ver página") + "</button>") +
      "</div></div>" +
      '<div class="mini-stats">' +
      "<div><strong>" + servers.length + ("</strong><span>" + NX.i18n.get("page.servidores", "servidores") + "</span></div>") +
      "<div><strong>" + dms.length + ("</strong><span>" + NX.i18n.get("page.conversas", "conversas") + "</span></div>") +
      "<div><strong>" + S().membershipsOf(me.id).length + ("</strong><span>" + NX.i18n.get("page.servidores", "servidores") + "</span></div>") +
      "</div></section>";

    return (
      '<div class="page page--home">' +
      '<section class="hero">' +
      '<div class="hero__text">' +
      ("<span class=\"hero__hi\">" + NX.i18n.get("page.bemvindo", "Bem-vindo!") + "</span>") +
      ("<h1>" + NX.i18n.get("page.ola", "Olá,") + " ") + u().h(me.displayName.split(" ")[0]) + " 👋</h1>" +
      ("<p>" + NX.i18n.get("page.escolhaumservidoraesquerdaou", "Escolha um servidor à esquerda ou comece algo novo. Sua comunidade, suas regras.") + "</p>") +
      "</div>" +
      quick +
      "</section>" +
      '<section class="block">' +
      ("<header class=\"block__head\"><h2>" + NX.i18n.get("people.seusServidores", "Seus servidores") + "</h2>") +
      '<span class="block__count">' + servers.length + "</span></header>" +
      list +
      "</section>" +
      '<div class="two-col">' + tips + profilePanel + "</div>" +
      "</div>"
    );
  };

  /* =========================================================
     MENSAGENS (vazio)
     ========================================================= */
  pages.messagesEmpty = function () {
    const me = S().me();
    const people = [];
    S().membershipsOf(me.id).forEach((m) => {
      S().visibleMembersOf(m.serverId).forEach((row) => {
        if (row.user.id !== me.id && !people.some((p) => p.id === row.user.id)) people.push(row.user);
      });
    });
    people.sort((a, b) => (a.status === "online" ? 0 : 1) - (b.status === "online" ? 0 : 1));

    const suggestions = people
      .slice(0, 8)
      .map(
        (p) =>
          '<button class="person-chip" data-action="start-dm" data-id="' + p.id + '">' +
          u().avatarHTML(p, "sm", true) +
          '<span><strong>' + u().h(p.displayName) + "</strong><small>@" + u().h(p.username) + "</small></span>" +
          "</button>"
      )
      .join("");

    return (
      '<div class="page page--center">' +
      '<div class="state-block">' +
      '<span class="state-block__ico">' + NX.icon("chat", "", 26) + "</span>" +
      ("<h2>" + NX.i18n.get("page.suasconversasdiretas", "Suas conversas diretas") + "</h2>") +
      ("<p>" + NX.i18n.get("page.escolhaumaconversanabarralateral", "Escolha uma conversa na barra lateral ou comece uma nova com alguém de um servidor que vocês compartilham.") + "</p>") +
      '<div class="state-block__actions">' +
      ("<button class=\"btn btn--primary\" data-action=\"new-dm\">" + NX.i18n.get("modal.novaConversa", "Nova conversa") + "</button>") +
      "</div>" +
      (suggestions
        ? ("<div class=\"people-row\"><span class=\"people-row__label\">" + NX.i18n.get("page.pessoasonlineagora", "Pessoas online agora") + "</span><div>") +
          suggestions +
          "</div></div>"
        : ("<div class=\"people-row\"><span class=\"people-row__label\">" + NX.i18n.get("page.entreemumservidorparaconhecer", "Entre em um servidor para conhecer pessoas —") + " ") +
          ("<button class=\"link-btn\" data-action=\"nav-explore\">" + NX.i18n.get("page.explorarservidores", "explorar servidores") + "</button></span></div>")) +
      "</div></div>"
    );
  };

  /* =========================================================
     EXPLORAR
     ========================================================= */
  pages.explore = function () {
    const me = S().me();
    const servers = S().discoverableServers();

    if (!servers.length) {
      return (
        '<div class="page page--center"><div class="state-block">' +
        '<span class="state-block__ico">' + NX.icon("compass", "", 26) + "</span>" +
        ("<h2>" + NX.i18n.get("page.nenhumservidornodiretorio", "Nenhum servidor no diretório") + "</h2>") +
        ("<p>" + NX.i18n.get("page.quandoalguemativarmostrarnoexplorar", "Quando alguém ativar “Mostrar no explorar” nas configurações, a comunidade aparece aqui.") + "</p>") +
        '<div class="state-block__actions">' +
        ("<button class=\"btn btn--primary\" data-action=\"create-server\">" + NX.i18n.get("page.criaroprimeiro", "Criar o primeiro") + "</button>") +
        "</div></div></div>"
      );
    }

    const cards = servers
      .map((s) => {
        const isMember = !!S().membership(s.id, me.id);
        const online = S().onlineCount(s.id);
        return (
          '<article class="explore-card">' +
          '<div class="explore-card__head">' +
          u().serverIconHTML(s, "lg", false) +
          "<div><h3>" + u().h(s.name) + "</h3>" +
          "<span>" + u().plural(S().memberCount(s.id), "membro", "membros") + " · " + online + " online</span></div></div>" +
          "<p>" + u().h(s.description || NX.i18n.get("adm.descricao2", "Sem descrição.")) + "</p>" +
          '<div class="explore-card__foot">' +
          '<span class="tag">' + u().plural(S().channelsOf(s.id).length, "canal", "canais") + "</span>" +
          (isMember
            ? '<button class="btn btn--soft btn--sm" data-action="open-server" data-id="' + s.id + ("\">" + NX.i18n.get("page.abrir", "Abrir") + "</button>")
            : '<button class="btn btn--primary btn--sm" data-action="join-explore" data-id="' + s.id + ("\">" + NX.i18n.get("adm.entrar", "Entrar") + "</button>")) +
          "</div></article>"
        );
      })
      .join("");

    return (
      '<div class="page">' +
      ("<section class=\"block\"><header class=\"block__head\"><h2>" + NX.i18n.get("page.servidoresabertos", "Servidores abertos") + "</h2>") +
      '<span class="block__count">' + servers.length + "</span></header>" +
      ("<p class=\"block__sub\">" + NX.i18n.get("page.nenhumacomunidadeeobrigatoriaaquivoce", "Nenhuma comunidade é obrigatória aqui: você entra e sai quando quiser.") + "</p>") +
      '<div class="explore-grid">' + cards + "</div></section></div>"
    );
  };

  /* =========================================================
     AMIGOS  (#/amigos) — lista real de amizades e pedidos
     ========================================================= */
  /* labels via getter → resolvidos a cada render (trocam com o idioma) */
  const FR_TABS = [
    { id: "todos", get label() { return NX.i18n.get("reg.privacyAll", "Todos"); } },
    { id: "online", get label() { return NX.i18n.get("page.disponiveis", "Disponíveis"); } },
    { id: "idle", get label() { return NX.i18n.get("page.ausentes", "Ausentes"); } },
    { id: "offline", get label() { return NX.i18n.get("page.filtroOffline", "Offline"); } },
    { id: "recebidas", get label() { return NX.i18n.get("soc.solicitacoes", "Solicitações"); } },
    { id: "enviadas", get label() { return NX.i18n.get("page.enviados", "Enviados"); } },
  ];

  const FR_GROUPS = [
    { emoji: "🟢", get label() { return NX.i18n.get("page.disponivel", "Disponível"); }, test: (s) => s === "online" },
    { emoji: "🟡", get label() { return NX.i18n.get("core.ausente", "Ausente"); }, test: (s) => s === "idle" || s === "dnd" },
    { emoji: "⚫", get label() { return NX.i18n.get("page.filtroOffline", "Offline"); }, test: (s) => s !== "online" && s !== "idle" && s !== "dnd" },
  ];

  /* quais grupos cada filtro exibe */
  const FR_TAB_GROUPS = { todos: [0, 1, 2], online: [0], idle: [1], offline: [2] };

  function frTabsHTML(active, counts) {
    return (
      '<div class="fr-tabs" role="tablist">' +
      FR_TABS.map((t) => {
        const n = counts[t.id] || 0;
        return (
          '<button class="fr-tab' + (t.id === active ? " is-on" : "") + '" type="button" role="tab"' +
          ' aria-selected="' + (t.id === active) + '" data-action="fr-tab" data-tab="' + t.id + '">' +
          u().h(t.label) +
          (n ? '<span class="fr-tab__badge">' + n + "</span>" : "") +
          "</button>"
        );
      }).join("") +
      "</div>"
    );
  }

  function frAct(action, icon, label, userId) {
    return (
      '<button class="icon-btn icon-btn--xs" type="button" data-action="' + action +
      '" data-id="' + u().h(userId) + '" title="' + u().h(label) + '" aria-label="' + u().h(label) + '">' +
      NX.icon(icon, "", 15) +
      "</button>"
    );
  }

  function frEmpty(icon, title, text, actionLabel, action) {
    return (
      '<div class="empty-state">' +
      '<span class="empty-state__ico">' + NX.icon(icon, "", 26) + "</span>" +
      "<h3>" + u().h(title) + "</h3><p>" + u().h(text) + "</p>" +
      (actionLabel
        ? '<button class="btn btn--primary btn--sm empty-state__cta" type="button" data-action="' +
          action + '">' + NX.icon("userPlus", "", 15) +
          "<span>" + u().h(actionLabel) + "</span></button>"
        : "") +
      "</div>"
    );
  }

  function frRow(user, extraSmall, actions, statusText) {
    return (
      '<div class="fr-row">' +
      u().avatarHTML(user, "sm", true) +
      '<span class="fr-row__txt"><strong>' + u().h(user.displayName) + "</strong>" +
      "<small>@" + u().h(user.username) + (extraSmall ? " · " + u().h(extraSmall) : "") + "</small>" +
      (statusText ? '<em class="fr-row__status">' + statusText + "</em>" : "") +
      "</span>" +
      '<span class="fr-row__acts">' + actions + "</span>" +
      "</div>"
    );
  }

  /* =========================================================
     ADICIONAR PESSOAS — tela de busca de pessoas REAIS
     Consulta NX.api.searchPeople (valida sessão, exclui a própria
     conta e qualquer bloqueio). O estado fica em módulo para que
     a última busca reapareça quando a tela é reaberta.
     ========================================================= */
  let frSearchQ = "";
  let frSearchRes = null; /* null = ainda não buscou */
  let frSearchErr = null;
  let frSearchTimer = null;
  let frSearchM = null; /* modal aberto */
  let frUnsub = null; /* assinatura do store enquanto a tela está aberta */

  /* botão de ação de acordo com o estado REAL da relação */
  function frPersonActs(uu) {
    const me = S().me();
    const st = S().friendState(me.id, uu.id);
    const id = u().h(uu.id);

    if (st === "friends") {
      return (
        '<span class="fr-chip fr-chip--ok">' + NX.icon("check", "", 15) +
        "<span>" + NX.i18n.get("page.saoAmigos", "Amigos") + "</span></span>"
      );
    }
    if (st === "sent") {
      return (
        '<span class="fr-chip fr-chip--wait">' + NX.icon("clock", "", 15) +
        "<span>" + NX.i18n.get("page.pedidoEnviado", "Pedido enviado") + "</span></span>"
      );
    }
    if (st === "received") {
      return (
        '<button class="btn btn--primary btn--sm" type="button" data-action="pp-accept-friend" data-id="' +
        id + '">' + NX.i18n.get("page.aceitar", "Aceitar") + "</button>" +
        '<button class="btn btn--soft btn--sm" type="button" data-action="pp-reject-friend" data-id="' +
        id + '">' + NX.i18n.get("page.recusar", "Recusar") + "</button>"
      );
    }
    return (
      '<button class="btn btn--primary btn--sm" type="button" data-action="pp-add-friend" data-id="' +
      id + '">' + NX.icon("userPlus", "", 15) +
      "<span>" + NX.i18n.get("people.adicionarAmigo", "Adicionar amigo") + "</span></button>"
    );
  }

  /* status REAL da pessoa — nunca inventa, nunca esconde 🔴/⚫ */
  function frStatusText(status) {
    const st = status || "offline";
    const emoji = st === "online" ? "🟢" : st === "idle" ? "🟡" : st === "dnd" ? "🔴" : "⚫";
    const lbl = NX.STATUS_LABEL[st] || NX.i18n.get("core.statusOffline", "Offline");
    return emoji + " " + u().h(lbl);
  }

  function frPersonRow(uu, withId) {
    return frRow(
      uu,
      null,
      frPersonActs(uu),
      frStatusText(uu.status) +
        (withId ? ' <code class="fr-row__id">' + u().h(uu.id) + "</code>" : "")
    );
  }

  function frSearchBody() {
    if (frSearchErr) {
      return (
        '<p class="fr-add__hint fr-add__hint--err">' + NX.icon("alert", "", 15) +
        "<span>" + u().h(frSearchErr) + "</span></p>"
      );
    }
    const q = String(frSearchQ || "").trim();
    if (!q) {
      return (
        '<p class="fr-add__hint">' +
        NX.i18n.get("page.digiteUsernameOuIdPesquisar", "Digite um nome de usuário ou ID para pesquisar.") +
        "</p>"
      );
    }
    if (frSearchRes === null) {
      return (
        '<p class="fr-add__hint fr-add__hint--load"><span class="spinner" aria-hidden="true"></span>' +
        "<span>" + NX.i18n.get("page.procurando", "Procurando…") + "</span></p>"
      );
    }
    if (!frSearchRes.length) {
      return (
        '<p class="fr-add__hint">' +
        NX.i18n.get("page.nenhumaPessoaEncontrada", "🔍 Nenhuma pessoa encontrada.") +
        "</p>"
      );
    }
    return (
      '<p class="fr-add__label">' + NX.i18n.get("page.resultados", "Resultados") +
      " <b>" + frSearchRes.length + "</b></p>" +
      '<div class="fr-list">' +
      frSearchRes.map((uu) => frPersonRow(uu, true)).join("") +
      "</div>"
    );
  }

  function frPaint() {
    const box = document.querySelector("[data-fr-results]");
    if (box) box.innerHTML = frSearchBody();
  }

  function runFrSearch(live) {
    const q = String(frSearchQ || "").trim();
    if (!q) {
      frSearchRes = null;
      frSearchErr = null;
      frPaint();
      return;
    }
    if (live) {
      frSearchRes = null;
      frSearchErr = null;
      frPaint();
    }
    NX.api
      .searchPeople(q, 12)
      .then((res) => {
        if (String(frSearchQ || "").trim() !== q) return; /* resultado velho */
        frSearchRes = res;
        frSearchErr = null;
        frPaint();
      })
      .catch((e) => {
        if (String(frSearchQ || "").trim() !== q) return;
        frSearchRes = null;
        frSearchErr = (e && e.message) || NX.i18n.get("adm.algoDeuErrado", "Algo deu errado.");
        frPaint();
      });
  }

  /* um único listener delegado para o campo de busca */
  document.addEventListener("input", (e) => {
    const el = e && e.target;
    if (!el || !el.matches || !el.matches("[data-fr-search]")) return;
    frSearchQ = el.value;
    if (frSearchTimer) window.clearTimeout(frSearchTimer);
    frSearchTimer = window.setTimeout(() => runFrSearch(true), 200);
  });

  /* Enter dispara a busca na hora, sem esperar o debounce */
  document.addEventListener("keydown", (e) => {
    const el = e && e.target;
    if (!el || !el.matches || !el.matches("[data-fr-search]")) return;
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (frSearchTimer) window.clearTimeout(frSearchTimer);
    runFrSearch(true);
  });

  /* =========================================================
     TELA "ADICIONAR PESSOAS"
     Usa NX.ui.modal (mesmo cabeçalho, X, ESC e foco de todo o
     Nexo) e só consulta pessoas REAIS via NX.api.searchPeople.
     ========================================================= */
  function openAddPeople() {
    if (frSearchM) {
      const open = document.querySelector("[data-fr-search]");
      if (open) open.focus();
      return;
    }

    const m = NX.ui.modal({
      title: NX.i18n.get("page.adicionarPessoas", "Adicionar pessoas"),
      eyebrow: NX.i18n.get("page.encontrePessoasNoNexo", "Encontre pessoas no Nexo"),
      size: "md",
      footer: u().el(
        '<div class="modal__actions">' +
        '<button class="btn btn--ghost" type="button" data-modal-close>' +
        NX.i18n.get("common.close", "Fechar") +
        "</button></div>"
      ),
      onClose: () => {
        frSearchM = null;
        if (frUnsub) {
          frUnsub();
          frUnsub = null;
        }
        if (frSearchTimer) {
          window.clearTimeout(frSearchTimer);
          frSearchTimer = null;
        }
      },
    });

    const ph = NX.i18n.get("page.pesquisarPorUsernameOuId", "Pesquisar por @username ou ID...");
    m.body.innerHTML =
      '<div class="fr-add fr-add--modal">' +
      '<div class="fr-add__field">' + NX.icon("search", "", 16) +
      '<input type="search" class="fr-add__input" data-fr-search data-autofocus' +
      ' autocomplete="off" spellcheck="false" value="' + u().h(frSearchQ) + '"' +
      ' placeholder="' + u().h(ph) + '" aria-label="' + u().h(ph) + '"' +
      ' aria-controls="fr-results" />' +
      "</div>" +
      '<div class="fr-add__results" id="fr-results" data-fr-results aria-live="polite">' +
      frSearchBody() +
      "</div></div>";

    frSearchM = m;

    /* o modal não é re-renderizado pela rota: enquanto ele está aberto,
       qualquer mudança real (pedido aceito, novo pedido, bloqueio,
       presença) reexecuta a busca para os botões não mentirem */
    frUnsub = NX.store.subscribe(() => {
      if (frSearchM && String(frSearchQ || "").trim()) runFrSearch(false);
    });

    /* texto salvo de uma busca anterior: pinta na hora e atualiza */
    if (String(frSearchQ || "").trim()) {
      if (frSearchRes === null) frPaint();
      window.setTimeout(() => runFrSearch(false), 0);
    }

    return m;
  }

  NX.action("fr-add-people", openAddPeople);
  pages.openAddPeople = openAddPeople;

  pages.friends = function (tab) {
    const me = S().me();
    const t = FR_TABS.some((x) => x.id === tab) ? tab : "todos";
    const friends = S().friendsOf(me.id);
    const incoming = S().friendRequestsOf(me.id);
    const outgoing = S().sentFriendRequestsOf(me.id);
    const counts = { recebidas: incoming.length, enviadas: outgoing.length };

    let body = "";

    if (t === "recebidas" || t === "enviadas") {
      const received = t === "recebidas";
      const rows = (received ? incoming : outgoing)
        .map((r) => {
          const other = S().user(received ? r.senderId : r.receiverId);
          if (!other || !S().isRealPerson(other.id)) return "";
          /* pedido vindo de quem está bloqueado não aparece */
          if (received && S().blockedBetween(me.id, other.id)) return "";
          const acts = received
            ? frAct("pp-accept-friend", "check", NX.i18n.get("page.aceitarPedido", "Aceitar pedido"), other.id) +
              frAct("pp-reject-friend", "x", NX.i18n.get("page.recusarPedido", "Recusar pedido"), other.id) +
              frAct("pp-view-profile", "user", NX.i18n.get("adm.verPerfil", "Ver perfil"), other.id)
            : frAct("pp-cancel-friend", "x", NX.i18n.get("page.cancelarPedido", "Cancelar pedido"), other.id) +
              frAct("pp-view-profile", "user", NX.i18n.get("adm.verPerfil", "Ver perfil"), other.id);
          return frRow(other, u().timeAgo(r.createdAt) || "agora", acts, frStatusText(other.status));
        })
        .join("");

      body = rows
        ? '<div class="fr-list">' + rows + "</div>"
        : received
          ? frEmpty("userPlus", NX.i18n.get("page.nenhumPedidoRecebido", "Nenhum pedido recebido"), NX.i18n.get("page.quandoAlguemTeAdicionar", "Quando alguém te adicionar como amigo, o pedido aparece aqui."))
          : frEmpty("clock", NX.i18n.get("page.nenhumaSolicitacaoEnviada", "Nenhuma solicitação enviada"), NX.i18n.get("page.voceAindaNaoEnviou", "Você ainda não enviou pedidos de amizade."));
    } else {
      const idxs = FR_TAB_GROUPS[t] || [0, 1, 2];
      const groups = idxs.map((i) => FR_GROUPS[i]);
      /* em "Disponíveis"/"Ausentes" quem está bloqueado não aparece */
      const soDisponibilidade = t === "online" || t === "idle";
      let any = false;
      body = groups
        .map((g) => {
          const rows = friends
            .filter((f) => g.test(f.status || "offline"))
            .filter((f) => !soDisponibilidade || !S().blockedBetween(me.id, f.id))
            .map((f) =>
              frRow(
                f,
                null,
                frAct("pp-message", "chat", NX.i18n.get("page.enviarMensagem", "Enviar mensagem"), f.id) +
                  frAct("pp-view-profile", "user", NX.i18n.get("adm.verPerfil", "Ver perfil"), f.id) +
                  frAct("fr-call", "voice", NX.i18n.get("page.convidarCall", "Convidar para call"), f.id) +
                  frAct("pp-remove-friend", "trash", NX.i18n.get("page.removerAmigo", "Remover amigo"), f.id) +
                  (S().isBlocked(me.id, f.id)
                    ? frAct("pp-unblock", "lock", (NX.i18n.get("page.desbloquear", "Desbloquear")), f.id)
                    : frAct("pp-block", "lock", (NX.i18n.get("page.bloquear", "Bloquear")), f.id)),
                frStatusText(f.status)
              )
            )
            .join("");
          if (!rows) return "";
          any = true;
          return (
            '<div class="fr-group"><span class="fr-group__head">' + g.emoji + " " + g.label + "</span>" +
            '<div class="fr-list">' + rows + "</div></div>"
          );
        })
        .join("");

      if (!any) {
        body = friends.length
          ? frEmpty(
              "compass",
              NX.i18n.get("page.ninguemAqui", "Ninguém por aqui"),
              NX.i18n.get("page.nenhumamigoNesseFiltro", "Nenhum amigo neste filtro agora. Abra “Todos” para ver a lista completa.")
            )
          : frEmpty(
              "users",
              NX.i18n.get("page.nenhumAmigoAinda", "Nenhum amigo ainda."),
              NX.i18n.get("page.procurePeloUsername", "Procure pelo @username ou pelo User ID para enviar o primeiro pedido."),
              NX.i18n.get("page.adicionarPessoas", "Adicionar pessoas"),
              "fr-add-people"
            );
      }
    }

    return (
      '<div class="page page--friends">' +
      ("<section class=\"block\"><header class=\"block__head\"><h2>" + NX.i18n.get("nav.friends", "Amigos") + "</h2>") +
      '<span class="block__count">' + friends.length + "</span>" +
      '<button class="btn btn--primary btn--sm fr-addbtn" type="button" data-action="fr-add-people">' +
      NX.icon("plus", "", 15) +
      "<span>" + NX.i18n.get("page.adicionarPessoas", "Adicionar pessoas") + "</span></button>" +
      "</header>" +
      frTabsHTML(t, counts) +
      body +
      "</section></div>"
    );
  };

  NX.action("fr-tab", (el) => NX.app.go("#/amigos/" + (el.getAttribute("data-tab") || "todos")));

  /* convidar um amigo para uma call: só canais de voz reais em comum */
  NX.action("fr-call", (el) => {
    const me = S().me();
    const friend = S().user(el.getAttribute("data-id"));
    if (!me || !friend || friend.id === me.id) return;

    const options = [];
    S().sharedServers(me.id, friend.id).forEach((srv) => {
      S().channelsOf(srv.id).forEach((c) => {
        if (!c || c.type !== "voice") return;
        if (!S().canViewChannel(c, me.id)) return;
        if (!S().channelPerm(c, me.id, "inviteToVoice")) return;
        options.push({ srv: srv, ch: c });
      });
    });

    if (!options.length) {
      NX.ui.error((NX.i18n.get("page.naohanenhumcanaldevoz", "Não há nenhum canal de voz em comum com @")) + friend.username + ".");
      return;
    }

    NX.ui.menu(
      el,
      options.map((o) => ({
        label: o.srv.name + " · " + o.ch.name,
        icon: "voice",
        onClick: () => {
          NX.api.inviteToVoice(o.ch.id, friend.id)
            .then(() =>
              NX.ui.toast((NX.i18n.get("page.convitedechamadaenviadopara", "Convite de chamada enviado para @")) + friend.username + ".", "success")
            )
            .catch((e) => NX.ui.error(e.message || NX.i18n.get("page.naoFoiPossivelEnviar", "Não foi possível enviar o convite.")));
        },
      })),
      { align: "start" }
    );
  });

  /* =========================================================
     FEED (rede social)
     ========================================================= */
  pages.feed = function (postId) {
    if (NX.social && typeof NX.social.feedPage === "function") {
      if (typeof NX.social.feedAfter === "function") {
        setTimeout(() => {
          const root =
            document.getElementById("main-content") ||
            document.getElementById("screen-app") ||
            document.body;
          try {
            NX.social.feedAfter(root, postId);
          } catch (e) {
            /* módulo em transição: ignora */
          }
        }, 0);
      }
      return NX.social.feedPage(postId);
    }
    return (
      ("<div class=\"state-block\"><h3>" + NX.i18n.get("page.feedindisponivel", "Feed indisponível") + "</h3>") +
      ("<p>" + NX.i18n.get("page.omodulosocialaindanaoterminou", "O módulo social ainda não terminou de carregar.") + "</p></div>")
    );
  };

  /* =========================================================
     PERFIL
     ========================================================= */
  pages.profile = function (userId) {
    /* o módulo NX.people assume quando disponível (banner, ID, cor,
       status personalizado, bloqueio e edição) */
    if (NX.people && typeof NX.people.profilePage === "function") {
      if (typeof NX.people.profilePageAfter === "function") {
        setTimeout(() => {
          const root =
            document.getElementById("main-content") ||
            document.getElementById("screen-app") ||
            document.body;
          try {
            NX.people.profilePageAfter(root, userId);
          } catch (e) {
            /* módulo em transição: ignora */
          }
        }, 0);
      }
      return NX.people.profilePage(userId);
    }

    const me = S().me();
    const user = S().user(userId) || me;
    const isMe = user.id === me.id;
    const shared = S().sharedServers(me.id, user.id);
    const servers = S().serversOf(user.id);
    const role = (uid, sid) => {
      const m = S().membership(sid, uid);
      return m ? S().role(m.roleId) : null;
    };

    const serverRows = servers
      .map((s) => {
        const r = role(user.id, s.id);
        return (
          '<button class="pill-row" data-action="open-server" data-id="' + s.id + '">' +
          u().serverIconHTML(s, "xs", false) +
          "<span><strong>" + u().h(s.name) + "</strong><small>" +
          u().h(r ? r.name : (NX.i18n.get("adm.membro2", "Membro"))) +
          (s.ownerId === user.id ? (" " + NX.i18n.get("page.dono", "· Dono")) : "") +
          "</small></span>" +
          NX.icon("chevronRight", "", 16) +
          "</button>"
        );
      })
      .join("");

    return (
      '<div class="page page--profile">' +
      '<section class="profile-card">' +
      '<div class="profile-card__banner" style="--pc:' + (user.avatar.color || "#35e0a8") + '"></div>' +
      '<div class="profile-card__body">' +
      '<div class="profile-card__avatar">' + u().avatarHTML(user, "xl", true) + "</div>" +
      "<div class=\"profile-card__id\">" +
      "<h1>" + u().h(user.displayName) + "</h1>" +
      '<span class="profile-card__user">@' + u().h(user.username) + "</span>" +
      '<span class="status-pill" data-status="' + user.status + '">' +
      u().h(NX.STATUS_LABEL[user.status] || NX.i18n.get("core.statusOffline", "Offline")) +
      (user.statusText ? " · " + u().h(user.statusText) : "") +
      "</span></div>" +
      '<div class="profile-card__actions">' +
      (isMe
        ? ("<button class=\"btn btn--primary btn--sm\" data-action=\"edit-profile\">" + NX.i18n.get("modal.editarPerfil2", "Editar perfil") + "</button>")
        : '<button class="btn btn--primary btn--sm" data-action="start-dm" data-id="' + user.id + '">' +
          NX.icon("chat", "", 16) + (" " + NX.i18n.get("modal.mensagem", "Mensagem") + "</button>")) +
      "</div></div>" +
      '<div class="profile-card__grid">' +
      '<div class="profile-card__col">' +
      ("<h4>" + NX.i18n.get("page.sobremim", "Sobre mim") + "</h4>") +
      '<p class="profile-card__bio">' + u().h(user.bio || (isMe ? NX.i18n.get("page.voceAindaNaoEscreveu", "Você ainda não escreveu uma bio. Edite seu perfil para contar quem é você.") : NX.i18n.get("page.nadaAquiAinda", "Nada por aqui ainda."))) + "</p>" +
      '<div class="profile-card__meta">' +
      ("<span><small>" + NX.i18n.get("modal.membrodesde", "Membro desde") + "</small>") +
      u().h(NX.util.formatDate(user.createdAt, { day: "2-digit", month: "2-digit", year: "numeric" })) +
      "</span>" +
      ("<span><small>" + NX.i18n.get("adm.convite", "Convite") + "</small>@") + u().h(user.username) + "</span>" +
      "</div></div>" +
      '<div class="profile-card__col">' +
      ("<h4>" + NX.i18n.get("ex.servidores", "Servidores")) + (servers.length ? " · " + servers.length : "") + "</h4>" +
      (serverRows
        ? '<div class="pill-list">' + serverRows + "</div>"
        : '<p class="profile-card__bio">' + (isMe ? NX.i18n.get("page.voceAindaNaoParticipa", "Você ainda não participa de nenhum servidor.") : NX.i18n.get("page.esteUsuarioNaoParticipa", "Este usuário não participa de nenhum servidor visível.")) + "</p>") +
      (shared.length && !isMe
        ? ("<div class=\"profile-card__shared\"><small>" + NX.i18n.get("page.vocesseconhecemem", "Vocês se conhecem em") + "</small>") +
          shared.map((s) => "<span>" + u().h(s.name) + "</span>").join("") +
          "</div>"
        : "") +
      "</div></div></section></div>"
    );
  };

  /* =========================================================
     CONVITE
     ========================================================= */
  pages.renderInvite = function (code) {
    const root = document.getElementById("screen-invite");
    if (!root) return;
    const invite = S().invite(code);
    const me = S().me();

    if (!invite) {
      root.innerHTML =
        '<div class="invite-wrap"><div class="invite-card invite-card--error">' +
        NX.brandMark(40) +
        '<span class="invite-card__error-ico">' + NX.icon("alert", "", 26) + "</span>" +
        ("<h1>" + NX.i18n.get("page.conviteinvalido", "Convite inválido") + "</h1>") +
        ("<p>" + NX.i18n.get("page.ocodigo", "O código") + " " + "<strong>") + u().h(String(code || "").toUpperCase()) + ("</strong>" + " " + NX.i18n.get("page.naoexisteoufoirevogadopeca", "não existe ou foi revogado. Peça um novo link para quem administra o servidor.") + "</p>") +
        '<div class="invite-card__actions">' +
        ("<button class=\"btn btn--primary\" data-action=\"nav-explore\">" + NX.i18n.get("view.explorarServidores", "Explorar servidores") + "</button>") +
        (me ? ("<button class=\"btn btn--soft\" data-action=\"nav-home\">" + NX.i18n.get("view.paginaInicial", "Página inicial") + "</button>") : "") +
        "</div></div></div>";
      return;
    }

    const server = S().server(invite.serverId);
    if (!server) {
      root.innerHTML = "";
      return;
    }
    const count = S().memberCount(server.id);
    const online = S().onlineCount(server.id);
    const owner = S().user(server.ownerId);
    const isMember = me && !!S().membership(server.id, me.id);

    const actions = isMember
      ? '<div class="invite-card__actions">' +
        '<button class="btn btn--primary btn--lg" data-action="open-server" data-id="' + server.id + '">' +
        NX.icon("enter", "", 18) + (" " + NX.i18n.get("ex.abrirservidor", "Abrir servidor") + "</button>") +
        ("<button class=\"btn btn--ghost\" data-action=\"nav-home\">" + NX.i18n.get("view.paginaInicial", "Página inicial") + "</button></div>")
      : me
      ? '<div class="invite-card__actions">' +
        '<button class="btn btn--primary btn--lg" data-action="accept-invite" data-code="' + invite.code + '">' +
        NX.icon("enter", "", 18) + (" " + NX.i18n.get("modal.entrarnoservidor", "Entrar no servidor") + "</button>") +
        ("<button class=\"btn btn--ghost\" data-action=\"nav-home\">" + NX.i18n.get("page.agoranao", "Agora não") + "</button></div>")
      : '<div class="invite-card__actions">' +
        '<button class="btn btn--primary btn--lg" data-action="login-for-invite" data-code="' + invite.code + (NX.i18n.get("page.entrarparaaceitar", "\">Entrar para aceitar") + "</button>") +
        '<button class="btn btn--soft" data-action="signup-for-invite" data-code="' + invite.code + (NX.i18n.get("page.criarconta", "\">Criar conta") + "</button></div>");

    root.innerHTML =
      '<div class="invite-wrap"><div class="invite-card">' +
      '<div class="invite-card__brand">' + NX.brandMark(28) + "<span>Nexo</span></div>" +
      '<div class="invite-card__icon">' + u().serverIconHTML(server, "xl", false) + "</div>" +
      "<h1>" + u().h(server.name) + "</h1>" +
      '<p class="invite-card__desc">' + u().h(server.description || NX.i18n.get("page.comunidadeNexo", "Uma comunidade no Nexo.")) + "</p>" +
      '<div class="invite-card__stats">' +
      "<div><strong>" + count + "</strong><span>" + (count === 1 ? "membro" : "membros") + "</span></div>" +
      "<i></i><div><strong>" + online + ("</strong><span>" + NX.i18n.get("page.onlineagora", "online agora") + "</span></div>") +
      "<i></i><div><strong>" + S().categoriesOf(server.id).length + ("</strong><span>" + NX.i18n.get("page.categorias", "categorias") + "</span></div>") +
      "</div>" +
      '<div class="invite-card__owner">' +
      u().avatarHTML(owner, "xs", false) +
      ("<span>" + NX.i18n.get("page.criadopor", "Criado por") + " " + "<strong>") + u().h(owner ? owner.displayName : "desconhecido") + "</strong></span>" +
      '<span class="invite-card__code mono">' + u().h(invite.code) + "</span>" +
      "</div>" +
      actions +
      ("<p class=\"invite-card__note\">" + NX.i18n.get("page.aoentrarvoceconcordacomas", "Ao entrar, você concorda com as regras definidas pelos administradores do servidor.") + "</p>") +
      "</div></div>";
  };

  /* =========================================================
     BOAS-VINDAS APÓS O CADASTRO
     ========================================================= */
  pages.renderWelcome = function () {
    const root = document.getElementById("screen-auth");
    if (!root) return;

    const me = S().me();
    let choice = "create";

    const cards = [
      { id: "create", icon: "home", title: NX.i18n.get("page.criarMeuServidor", "Criar meu servidor"), desc: NX.i18n.get("page.comeceZeroCategoriasCanais", "Comece do zero com categorias e canais prontos.") },
      { id: "invite", icon: "link", title: NX.i18n.get("page.entrarConvite", "Entrar com convite"), desc: NX.i18n.get("page.coleLinkCodigoAlguem", "Cole o link ou o código que alguém te passou.") },
      { id: "explore", icon: "user", title: NX.i18n.get("page.explorarMinhaConta", "Explorar minha conta"), desc: NX.i18n.get("page.vejaSeuPerfilPreferencias", "Veja seu perfil, preferências e notificações.") },
    ];

    root.innerHTML =
      '<div class="auth auth--single"><div class="auth__panel auth__panel--full"><div class="welcome" data-welcome>' +
      '<div class="welcome__brand">' + NX.brandMark(44) + "<span>Nexo</span></div>" +
      '<div class="welcome__head">' +
      '<span class="welcome__badge">' + NX.icon("sparkles", "", 18) + (" " + NX.i18n.get("page.contacriada", "Conta criada") + "</span>") +
      ("<h1>" + NX.i18n.get("page.bemvindoanexo", "Bem-vindo à Nexo")) + (me ? ", " + u().h(me.displayName) : "") + "!</h1>" +
      ("<p>" + NX.i18n.get("page.oquevocequerfazer", "O que você quer fazer?") + "</p>") +
      "</div>" +
      '<div class="welcome__cards">' +
      cards
        .map(
          (c) =>
            '<button type="button" class="welcome__card' +
            (c.id === choice ? " is-on" : "") +
            '" data-choice="' + c.id + '">' +
            '<span class="welcome__card-ico">' + NX.icon(c.icon, "", 22) + "</span>" +
            "<strong>" + c.title + "</strong><small>" + c.desc + "</small>" +
            '<span class="welcome__card-check">' + NX.icon("check", "", 16) + "</span>" +
            "</button>"
        )
        .join("") +
      "</div>" +
      '<div class="welcome__actions">' +
      ("<button class=\"btn btn--primary btn--lg\" data-welcome-go>" + NX.i18n.get("adm.continuar", "Continuar") + "</button>") +
      ("<button class=\"link-btn\" data-action=\"nav-home\">" + NX.i18n.get("page.pularporenquanto", "Pular por enquanto") + "</button>") +
      "</div>" +
      "</div></div></div>";

    const wrap = root.querySelector("[data-welcome]");
    if (!wrap) return;

    wrap.addEventListener("click", (e) => {
      const card = e.target.closest("[data-choice]");
      if (card) {
        choice = card.getAttribute("data-choice");
        wrap.querySelectorAll("[data-choice]").forEach((b) => {
          b.classList.toggle("is-on", b.getAttribute("data-choice") === choice);
        });
        return;
      }
      const go = e.target.closest("[data-welcome-go]");
      if (!go) return;
      if (choice === "create") {
        NX.app.go("#/");
        setTimeout(() => {
          if (NX.modals && NX.modals.createServer) NX.modals.createServer();
        }, 80);
      } else if (choice === "invite") {
        NX.app.go("#/");
        setTimeout(() => {
          if (NX.modals && NX.modals.joinServer) NX.modals.joinServer();
        }, 80);
      } else {
        NX.app.go("#/explorar");
      }
    });
  };

  NX.pages = pages;
})(window.NX);
