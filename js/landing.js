/* ============================================================
   NEXO · landing page
   Preenche #screen-landing com a página pública do produto.
   Expõe NX.landing.render(root) e registra ações com prefixo
   "landing-" (goto-login / goto-signup pertencem ao app).
   Não cria nem remove containers globais.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const landing = {};

  /* ---------------- helpers ---------------- */
  const u = NX.util || {};
  const h = typeof u.h === "function" ? u.h : (s) => String(s == null ? "" : s);
  const ico = (name, size, cls) =>
    typeof NX.icon === "function" ? NX.icon(name, cls || "", size || 20) : "";
  const mark = (size) => (typeof NX.brandMark === "function" ? NX.brandMark(size || 30) : "");
  const colorFor = (k) => (typeof u.colorFor === "function" ? u.colorFor(k) : "#35e0a8");
  const initials = (n) => (typeof u.initials === "function" ? u.initials(n) : "");
  const reduced = () => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return false;
    }
  };
  const toast = (msg, type) => {
    if (NX.ui && typeof NX.ui.toast === "function") NX.ui.toast(msg, type || "info");
  };

  /* ---------------- conteúdo ---------------- */
  const NAV = [
    { label: "Recursos", target: "sec-recursos" },
    { label: "Comunidades", target: "sec-comunidades" },
    { label: "Segurança", target: "sec-seguranca" },
    { label: "Sobre", target: "sec-sobre" },
  ];

  const SERVER_CARDS = [
    { emoji: "🏠", tint: "53, 224, 168", title: "Servidores", desc: "Crie quantos servidores quiser." },
    { emoji: "💬", tint: "76, 201, 240", title: "Canais", desc: "Organize conversas em canais e categorias." },
    { emoji: "🛡️", tint: "143, 131, 255", title: "Cargos", desc: "Defina cargos e permissões para sua comunidade." },
  ];

  const FEATURES = [
    { emoji: "💬", tint: "53, 224, 168", title: "Chat em tempo real", desc: "Mensagens que chegam na hora, em canais e direct." },
    { emoji: "🔊", tint: "76, 201, 240", title: "Canais de voz", desc: "Salas de voz para conversar, jogar ou só estar junto." },
    { emoji: "👥", tint: "255, 200, 87", title: "Comunidades", desc: "Reúna amigos, times, fãs e grupos em um só lugar." },
    { emoji: "🛡️", tint: "143, 131, 255", title: "Cargos e permissões", desc: "Cada pessoa com o papel certo e o controle certo." },
    { emoji: "🔗", tint: "255, 122, 182", title: "Convites", desc: "Links simples para chamar quem faz parte da conversa." },
    { emoji: "🎨", tint: "53, 224, 168", title: "Personalização", desc: "Nome, ícone e identidade com a cara da sua galera." },
    { emoji: "🔔", tint: "255, 200, 87", title: "Notificações", desc: "Avisos que respeitam o seu foco e os seus canais." },
    { emoji: "📱", tint: "76, 201, 240", title: "Celular e computador", desc: "A mesma conversa, no navegador de qualquer tela." },
  ];

  const SEC_POINTS = [
    { emoji: "🛡️", title: "Cargos e permissões", desc: "Defina quem pode falar, moderar e configurar cada canal." },
    { emoji: "🔗", title: "Convites sob controle", desc: "Gere e revogue convites quando a sua comunidade pedir." },
    { emoji: "🕶️", title: "Privacidade em primeiro lugar", desc: "O que acontece no seu espaço continua sendo do seu espaço." },
  ];

  const STEPS = [
    { n: "01", title: "Crie sua conta", desc: "Cadastre-se gratuitamente." },
    { n: "02", title: "Crie seu servidor", desc: "Dê um nome e personalize sua comunidade." },
    { n: "03", title: "Convide seus amigos", desc: "Compartilhe um convite e comece a conversar." },
  ];

  const FOOTER_COLS = [
    {
      title: "Plataforma",
      links: [
        { label: "Início", target: "lp-top" },
        { label: "Recursos", target: "sec-recursos" },
        { label: "Comunidades", target: "sec-comunidades" },
        { label: "Segurança", target: "sec-seguranca" },
      ],
    },
    {
      title: "Ajuda",
      links: [
        { label: "Central de ajuda" },
        { label: "Suporte" },
        { label: "Termos" },
        { label: "Privacidade" },
      ],
    },
    {
      title: "Redes",
      links: [{ label: "YouTube" }, { label: "Instagram" }, { label: "X" }, { label: "TikTok" }],
    },
  ];

  /* conteúdo do mockup (informativo, sem imagem) */
  const MOCK_SERVERS = ["🎮", "📚", "🛠️"];
  const MOCK_MSGS = [
    { name: "Marina", time: "10:02", text: "Bem-vindos ao servidor! 🚀" },
    { name: "Rafa", time: "10:03", text: "Separei os canais por categoria." },
    { name: "Lia", time: "10:04", text: "Alguém entra na call depois?" },
    { name: "Téo", time: "10:05", text: "Já tô entrando!" },
  ];
  const MOCK_MEMBERS = [
    { name: "Marina", status: "online" },
    { name: "Rafa", status: "online" },
    { name: "Lia", status: "typing" },
    { name: "Téo", status: "idle" },
  ];

  /* ---------------- blocos de HTML ---------------- */

  function navBtns(cls) {
    return NAV.map(
      (n) =>
        '<button type="button" class="' + cls + '" data-action="landing-scroll" data-target="' +
        n.target + '">' + h(n.label) + "</button>"
    ).join("");
  }

  function headerHTML() {
    return (
      '<header class="lp-header">' +
        '<div class="lp-wrap lp-header__inner">' +
          '<button type="button" class="lp-brand" data-action="landing-scroll" data-target="lp-top" aria-label="Nexo — voltar ao início">' +
            mark(30) +
            '<span class="lp-brand__name">Nexo</span>' +
          "</button>" +
          '<nav class="lp-nav" aria-label="Navegação da página">' + navBtns("lp-nav__link") + "</nav>" +
          '<div class="lp-header__actions">' +
            '<button type="button" class="lp-btn lp-btn--ghost lp-btn--sm" data-action="goto-login">Entrar</button>' +
            '<button type="button" class="lp-btn lp-btn--primary lp-btn--sm" data-action="goto-signup">Criar conta</button>' +
            '<button type="button" class="lp-burger" data-action="landing-menu" aria-label="Abrir menu" aria-expanded="false" aria-controls="lp-drawer">' +
              ico("menu", 22) +
            "</button>" +
          "</div>" +
        "</div>" +
        '<div class="lp-drawer" id="lp-drawer" hidden>' +
          '<div class="lp-wrap lp-drawer__inner">' +
            '<div class="lp-drawer__links">' + navBtns("lp-drawer__link") + "</div>" +
            '<div class="lp-drawer__cta">' +
              '<button type="button" class="lp-btn lp-btn--ghost" data-action="goto-login">Entrar</button>' +
              '<button type="button" class="lp-btn lp-btn--primary" data-action="goto-signup">Criar conta</button>' +
            "</div>" +
          "</div>" +
        "</div>" +
      "</header>"
    );
  }

  function avHTML(name, size, status) {
    const cls = "lp-av" + (size ? " lp-av--" + size : "");
    let dot = "";
    if (status) {
      dot = '<i class="lp-sdot" data-s="' + h(status) + '" aria-hidden="true"></i>';
    }
    return (
      '<span class="' + cls + '" style="--av:' + h(colorFor(name)) + '" aria-hidden="true">' +
      h(initials(name)) + dot + "</span>"
    );
  }

  function mockHTML() {
    const rail =
      '<div class="lp-mock__rail" aria-hidden="true">' +
        '<span class="lp-mock__srv is-active">' + mark(30) + '<i class="lp-mock__pill"></i></span>' +
        MOCK_SERVERS.map((e) => '<span class="lp-mock__srv"><b>' + h(e) + "</b></span>").join("") +
        '<span class="lp-mock__srv lp-mock__srv--add">' + ico("plus", 16) + "</span>" +
      "</div>";

    const side =
      '<div class="lp-mock__side" aria-hidden="true">' +
        '<div class="lp-mock__srvhead"><span>Comunidade Nexo</span>' + ico("chevronDown", 14) + "</div>" +
        '<div class="lp-mock__cat">INFORMAÇÕES</div>' +
        '<div class="lp-mock__chan">' + ico("hash", 14) + "<span>boas-vindas</span></div>" +
        '<div class="lp-mock__chan">' + ico("hash", 14) + "<span>regras</span></div>" +
        '<div class="lp-mock__cat">COMUNIDADE</div>' +
        '<div class="lp-mock__chan is-active">' + ico("hash", 14) + "<span>geral</span>" +
          '<i class="lp-mock__pulse"></i></div>' +
        '<div class="lp-mock__chan">' + ico("hash", 14) + "<span>memes</span></div>" +
        '<div class="lp-mock__chan">' + ico("hash", 14) + "<span>novidades</span></div>" +
        '<div class="lp-mock__cat">VOZ</div>' +
        '<div class="lp-mock__chan">' + ico("voice", 14) + "<span>Sala Geral</span>" +
          '<em class="lp-mock__peers">2</em></div>' +
      "</div>";

    const msgs = MOCK_MSGS.map(
      (m, i) =>
        '<div class="lp-msg" style="--i:' + i + '">' +
          avHTML(m.name) +
          '<div class="lp-msg__body">' +
            '<div class="lp-msg__meta"><strong>' + h(m.name) + "</strong><time>" + h(m.time) + "</time></div>" +
            "<p>" + h(m.text) + "</p>" +
          "</div>" +
        "</div>"
    ).join("");

    const chat =
      '<div class="lp-mock__chat">' +
        '<div class="lp-mock__chathead">' + ico("hash", 15) + "<span>geral</span>" +
          '<em class="lp-mock__topic">Comunidade, novidades e conversa</em></div>' +
        '<div class="lp-mock__msgs">' + msgs + "</div>" +
        '<div class="lp-mock__composer"><span>Mensagem para #geral</span>' + ico("send", 15) + "</div>" +
      "</div>";

    const members =
      '<div class="lp-mock__members" aria-hidden="true">' +
        '<div class="lp-mock__cat">ONLINE — ' + MOCK_MEMBERS.length + "</div>" +
        MOCK_MEMBERS.map((m) => {
          if (m.status === "typing") {
            return (
              '<div class="lp-mrow">' + avHTML(m.name, "", null) +
                '<span class="lp-mrow__txt"><b>' + h(m.name) + "</b>" +
                '<em class="lp-typing">digitando<span class="lp-tdots"><i></i><i></i><i></i></span></em>' +
                "</span></div>"
            );
          }
          return (
            '<div class="lp-mrow">' + avHTML(m.name, "", m.status) +
              '<span class="lp-mrow__txt"><b>' + h(m.name) + "</b></span>" +
            "</div>"
          );
        }).join("") +
      "</div>";

    return (
      '<figure class="lp-mock">' +
        '<figcaption class="lp-mock__badge">' + ico("sparkles", 14) + "<span>Prévia da interface</span></figcaption>" +
        '<div class="lp-mock__frame">' +
          '<div class="lp-mock__bar">' +
            '<span class="lp-mock__dots"><i></i><i></i><i></i></span>' +
            '<span class="lp-mock__url">nexo · comunidade</span>' +
            '<span class="lp-mock__env">' + ico("shield", 13) + "<span>convite válido</span></span>" +
          "</div>" +
          '<div class="lp-mock__body">' + rail + side + chat + members + "</div>" +
        "</div>" +
        '<div class="lp-mock__reflect" aria-hidden="true"></div>' +
      "</figure>"
    );
  }

  function heroHTML() {
    return (
      '<section class="lp-sec lp-hero" id="lp-top">' +
        '<div class="lp-wrap lp-hero__grid">' +
          '<div class="lp-hero__text">' +
            '<span class="lp-pill">' + ico("sparkles", 14) + "<span>Plataforma de comunidades</span></span>" +
            '<h1 class="lp-hero__title">Seu espaço. Sua comunidade. <span class="lp-grad">Sua conversa.</span></h1>' +
            '<p class="lp-hero__sub">Crie comunidades, converse com seus amigos, organize canais e construa seu próprio espaço online.</p>' +
            '<div class="lp-hero__cta">' +
              '<button type="button" class="lp-btn lp-btn--primary lp-btn--lg" data-action="goto-signup">Começar agora</button>' +
              '<button type="button" class="lp-btn lp-btn--ghost lp-btn--lg" data-action="goto-login">Entrar</button>' +
            "</div>" +
            '<p class="lp-hero__note">' + ico("check", 16) + "<span>Grátis para começar · no celular e no computador</span></p>" +
          "</div>" +
          '<div class="lp-hero__visual" data-reveal style="--d:1">' + mockHTML() + "</div>" +
        "</div>" +
      "</section>"
    );
  }

  function cardHTML(c, i) {
    return (
      '<article class="lp-card lp-reveal" data-reveal style="--d:' + (i % 4) + ";--tint:" + h(c.tint) + '">' +
        '<span class="lp-card__ico" aria-hidden="true">' + h(c.emoji) + "</span>" +
        '<h3 class="lp-card__title">' + h(c.title) + "</h3>" +
        '<p class="lp-card__desc">' + h(c.desc) + "</p>" +
      "</article>"
    );
  }

  function serversSection() {
    return (
      '<section class="lp-sec" id="sec-comunidades">' +
        '<div class="lp-wrap">' +
          '<div class="lp-sec__head lp-reveal" data-reveal>' +
            '<span class="lp-eyebrow">Sua comunidade</span>' +
            '<h2 class="lp-h2">Crie seu próprio servidor</h2>' +
            '<p class="lp-lead">Crie um espaço personalizado para seus amigos, comunidade, projeto ou grupo.</p>' +
          "</div>" +
          '<div class="lp-grid lp-grid--3">' + SERVER_CARDS.map(cardHTML).join("") + "</div>" +
        "</div>" +
      "</section>"
    );
  }

  function featuresSection() {
    return (
      '<section class="lp-sec lp-sec--tint" id="sec-recursos">' +
        '<div class="lp-wrap">' +
          '<div class="lp-sec__head lp-reveal" data-reveal>' +
            '<span class="lp-eyebrow">Recursos</span>' +
            '<h2 class="lp-h2">Tudo o que a sua conversa precisa</h2>' +
            '<p class="lp-lead">Do primeiro oi ao servidor gigante: recursos pensados para conversas de verdade.</p>' +
          "</div>" +
          '<div class="lp-grid lp-grid--4">' + FEATURES.map(cardHTML).join("") + "</div>" +
        "</div>" +
      "</section>"
    );
  }

  function securitySection() {
    return (
      '<section class="lp-sec" id="sec-seguranca">' +
        '<div class="lp-wrap">' +
          '<div class="lp-secure lp-reveal" data-reveal>' +
            '<div class="lp-secure__text">' +
              '<span class="lp-eyebrow">Segurança</span>' +
              '<h2 class="lp-h2">Sua comunidade, sob o seu controle</h2>' +
              '<p class="lp-lead">Permissões claras, convites sob controle e tranquilidade para moderar o seu espaço.</p>' +
              '<button type="button" class="lp-btn lp-btn--ghost" data-action="goto-signup">Criar minha conta</button>' +
            "</div>" +
            '<ul class="lp-secure__list">' +
              SEC_POINTS.map(
                (p, i) =>
                  '<li class="lp-secure__item" style="--d:' + i + '">' +
                    '<span class="lp-secure__ico" aria-hidden="true">' + h(p.emoji) + "</span>" +
                    "<span><b>" + h(p.title) + "</b><span>" + h(p.desc) + "</span></span>" +
                  "</li>"
              ).join("") +
            "</ul>" +
          "</div>" +
        "</div>" +
      "</section>"
    );
  }

  function stepsSection() {
    return (
      '<section class="lp-sec" id="sec-como">' +
        '<div class="lp-wrap">' +
          '<div class="lp-sec__head lp-reveal" data-reveal>' +
            '<span class="lp-eyebrow">Como funciona</span>' +
            '<h2 class="lp-h2">Como funciona</h2>' +
            '<p class="lp-lead">Três passos e a conversa começa.</p>' +
          "</div>" +
          '<ol class="lp-steps">' +
            STEPS.map(
              (s, i) =>
                '<li class="lp-step lp-reveal" data-reveal style="--d:' + i + '">' +
                  '<span class="lp-step__n">' + h(s.n) + "</span>" +
                  '<h3 class="lp-step__t">' + h(s.title) + "</h3>" +
                  '<p class="lp-step__d">' + h(s.desc) + "</p>" +
                "</li>"
            ).join("") +
          "</ol>" +
        "</div>" +
      "</section>"
    );
  }

  function ctaSection() {
    return (
      '<section class="lp-sec lp-cta" id="sec-cta">' +
        '<div class="lp-wrap">' +
          '<div class="lp-cta__panel lp-reveal" data-reveal>' +
            '<span class="lp-eyebrow">Comece agora</span>' +
            '<h2 class="lp-h2">Pronto para criar sua comunidade?</h2>' +
            '<p class="lp-lead">Crie seu servidor em minutos e chame quem importa.</p>' +
            '<div class="lp-cta__actions">' +
              '<button type="button" class="lp-btn lp-btn--primary lp-btn--lg" data-action="goto-signup">Criar minha conta</button>' +
              '<button type="button" class="lp-btn lp-btn--ghost lp-btn--lg" data-action="goto-login">Entrar</button>' +
            "</div>" +
          "</div>" +
        "</div>" +
      "</section>"
    );
  }

  function footLink(l) {
    if (l.target) {
      return (
        '<a class="lp-foot__link" href="#' + l.target + '" data-action="landing-scroll" data-target="' +
        l.target + '">' + h(l.label) + "</a>"
      );
    }
    return '<a class="lp-foot__link" href="#" data-action="landing-stub">' + h(l.label) + "</a>";
  }

  function footerHTML() {
    return (
      '<footer class="lp-foot">' +
        '<div class="lp-wrap">' +
          '<div class="lp-foot__top">' +
            '<div class="lp-foot__about" id="sec-sobre">' +
              '<span class="lp-brand lp-brand--foot">' + mark(32) + '<span class="lp-brand__name">Nexo</span></span>' +
              '<h2 class="lp-foot__title">Sobre o Nexo</h2>' +
              '<p class="lp-foot__about-text">Nexo é um espaço para criar comunidades, organizar canais e conversar com as pessoas que importam — do seu jeito, em qualquer tela.</p>' +
            "</div>" +
            FOOTER_COLS.map(
              (col) =>
                '<nav class="lp-foot__col" aria-label="' + h(col.title) + '">' +
                  '<h2 class="lp-foot__title">' + h(col.title) + "</h2>" +
                  '<div class="lp-foot__links">' + col.links.map(footLink).join("") + "</div>" +
                "</nav>"
            ).join("") +
          "</div>" +
          '<div class="lp-foot__bottom">' +
            "<span>© 2026 Nexo</span>" +
            '<button type="button" class="lp-top" data-action="landing-scroll" data-target="lp-top" aria-label="Voltar ao topo">' +
              ico("arrowRight", 16) + "</button>" +
          "</div>" +
        "</div>" +
      "</footer>"
    );
  }

  function pageHTML() {
    return (
      '<div class="lp">' +
        headerHTML() +
        '<main class="lp-main">' +
          heroHTML() +
          serversSection() +
          featuresSection() +
          securitySection() +
          stepsSection() +
          ctaSection() +
        "</main>" +
        footerHTML() +
      "</div>"
    );
  }

  /* ---------------- estado / limpeza ---------------- */
  let ctx = null;

  function cleanup() {
    if (!ctx) return;
    if (ctx.raf) {
      try { window.cancelAnimationFrame(ctx.raf); } catch (e) {}
    }
    if (ctx.io) {
      try { ctx.io.disconnect(); } catch (e) {}
    }
    if (ctx.root && ctx.onRootScroll) ctx.root.removeEventListener("scroll", ctx.onRootScroll, true);
    if (ctx.onWinScroll) window.removeEventListener("scroll", ctx.onWinScroll);
    if (ctx.onResize) window.removeEventListener("resize", ctx.onResize);
    if (ctx.onDocClick) document.removeEventListener("click", ctx.onDocClick, true);
    if (ctx.onKey) document.removeEventListener("keydown", ctx.onKey, true);
    ctx = null;
  }

  /* ---------------- rolagem suave ---------------- */
  function scrollContainer() {
    const r = ctx && ctx.root;
    if (r && r.scrollHeight > r.clientHeight + 4) {
      const oy = window.getComputedStyle(r).overflowY;
      if (oy === "auto" || oy === "scroll" || oy === "hidden") return r;
    }
    return null;
  }

  function getScrollTop(box) {
    if (box) return box.scrollTop;
    return window.pageYOffset || document.documentElement.scrollTop || 0;
  }

  function setScrollTop(box, v) {
    if (box) box.scrollTop = v;
    else window.scrollTo(0, v);
  }

  /* rolagem animada própria (rAF): funciona igual em qualquer container */
  function animateScrollTo(box, to) {
    to = Math.max(0, to);
    if (ctx && ctx.raf) {
      window.cancelAnimationFrame(ctx.raf);
      ctx.raf = 0;
    }
    const from = getScrollTop(box);
    if (reduced() || typeof window.requestAnimationFrame !== "function" || Math.abs(to - from) < 2) {
      setScrollTop(box, to);
      return;
    }
    const owner = ctx;
    const dur = 520;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    let start = null;
    const frame = (now) => {
      if (ctx !== owner) return;
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / dur);
      setScrollTop(box, from + (to - from) * ease(t));
      ctx.raf = t < 1 ? window.requestAnimationFrame(frame) : 0;
    };
    ctx.raf = window.requestAnimationFrame(frame);
  }

  function scrollToTarget(id) {
    if (!ctx || !ctx.root) return;
    const found = document.getElementById(id);
    const node = found && ctx.root.contains(found) ? found : null;
    if (!node) return;
    const head = ctx.root.querySelector(".lp-header");
    const offset = (head ? head.offsetHeight : 0) + 8;
    const box = scrollContainer();
    const base = box ? getScrollTop(box) : (window.pageYOffset || document.documentElement.scrollTop || 0);
    const top = node.getBoundingClientRect().top - (box ? box.getBoundingClientRect().top : 0) + base - offset;
    animateScrollTo(box, Math.max(0, top));
  }

  /* ---------------- header (blur no scroll) ---------------- */
  function updateHeader(y) {
    if (!ctx || !ctx.header) return;
    ctx.header.classList.toggle("is-scrolled", y > 8);
  }

  /* ---------------- menu celular ---------------- */
  function setDrawer(open) {
    if (!ctx || !ctx.root) return;
    const drawer = ctx.root.querySelector(".lp-drawer");
    const burger = ctx.root.querySelector(".lp-burger");
    if (!drawer || !burger) return;
    if (open) drawer.removeAttribute("hidden");
    else drawer.setAttribute("hidden", "");
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    burger.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
    burger.innerHTML = open ? ico("x", 22) : ico("menu", 22);
  }

  function toggleDrawer() {
    if (!ctx || !ctx.root) return;
    const drawer = ctx.root.querySelector(".lp-drawer");
    if (!drawer) return;
    setDrawer(drawer.hasAttribute("hidden"));
  }

  /* ---------------- reveal (IntersectionObserver) ---------------- */
  function bindReveal(root) {
    const nodes = Array.prototype.slice.call(root.querySelectorAll("[data-reveal]"));
    if (reduced() || typeof window.IntersectionObserver !== "function") {
      nodes.forEach((n) => n.classList.add("is-in"));
      return null;
    }
    const io = new window.IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("is-in");
            io.unobserve(en.target);
          }
        });
      },
      { root: null, rootMargin: "0px 0px -40px 0px", threshold: 0 }
    );
    nodes.forEach((n) => io.observe(n));
    return io;
  }

  /* ---------------- bind ---------------- */
  function bind(root) {
    const header = root.querySelector(".lp-header");

    const onRootScroll = () => updateHeader(root.scrollTop);
    const onWinScroll = () => updateHeader(window.pageYOffset || document.documentElement.scrollTop || 0);
    const onResize = () => { if (window.innerWidth > 860) setDrawer(false); };
    const onKey = (e) => { if (e.key === "Escape") setDrawer(false); };

    /* fallback de clique: assumes as ações prefixadas "landing-*".
       stopPropagation evita execução dupla pelo delegador global do app. */
    const onDocClick = (e) => {
      const t = e.target;
      const el = t && t.closest ? t.closest("[data-action]") : null;
      if (!el) return;
      const name = el.getAttribute("data-action") || "";
      if (name.indexOf("landing-") !== 0) return;
      const fn = NX.actions && NX.actions[name];
      if (typeof fn !== "function") return;
      e.preventDefault();
      e.stopPropagation();
      try {
        fn(el, e);
      } catch (err) {
        console.error("[landing:" + name + "]", err);
      }
    };

    ctx = {
      root: root,
      header: header,
      onRootScroll: onRootScroll,
      onWinScroll: onWinScroll,
      onResize: onResize,
      onKey: onKey,
      onDocClick: onDocClick,
      io: null,
      raf: 0,
    };

    root.addEventListener("scroll", onRootScroll, true);
    window.addEventListener("scroll", onWinScroll, { passive: true });
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("click", onDocClick, true);

    ctx.io = bindReveal(root);
    onRootScroll();
    window.requestAnimationFrame(() => onRootScroll());
  }

  /* ---------------- ações ---------------- */
  NX.action("landing-scroll", (el) => {
    const target = el && el.getAttribute("data-target");
    if (!target) return;
    setDrawer(false);
    scrollToTarget(target);
  });

  NX.action("landing-menu", () => toggleDrawer());

  NX.action("landing-stub", () => toast("Esta página chega em breve.", "info"));

  /* ---------------- API ---------------- */
  landing.sections = ["lp-top", "sec-comunidades", "sec-recursos", "sec-seguranca", "sec-como", "sec-cta", "sec-sobre"];

  landing.render = function (root) {
    if (!root) return;
    cleanup();
    root.innerHTML = pageHTML();
    bind(root);
  };

  landing.destroy = function () {
    const root = ctx && ctx.root;
    cleanup();
    if (root) root.innerHTML = "";
  };

  NX.landing = landing;
})(window.NX);
