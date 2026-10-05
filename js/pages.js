/* ============================================================
   NEXO · páginas
   Tela de acesso (login/cadastro/recuperação), página inicial,
   explorar, perfil, mensagens e tela de convite.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const u = () => NX.util;
  const S = () => NX.selectors;
  const pages = {};

  /* ---- autenticação: rota ↔ modo interno ----
     (a rota usa português, a tela usa o nome interno) */
  const AUTH_ALIAS = {
    login: "login",
    cadastro: "signup",
    signup: "signup",
    recuperar: "forgot",
    forgot: "forgot",
    verificar: "verify",
    verify: "verify",
  };
  const AUTH_ROUTE = {
    login: "#/login",
    signup: "#/cadastro",
    forgot: "#/recuperar",
    verify: "#/verificar",
  };
  pages.routeFor = (mode) => AUTH_ROUTE[AUTH_ALIAS[mode] || mode] || "#/login";

  let authMode = "login";

  /* recuperação em 3 passos — estado na própria aba, para um F5
     no meio do fluxo não trancar o usuário (nada de código aqui) */
  const REC_KEY = "nx.rec";
  let forgotStep = 1;
  let forgotEmail = "";
  let forgotToken = "";
  let resendUntil = 0;
  let resendPurpose = "";
  let cdTimer = null;
  /* aviso devolvido pela API de envio (nunca afirmamos mais que o
     provedor confirmou) — sobrevive a F5 junto com o fluxo */
  let authNotice = null;

  function setNotice(message, sent, kind) {
    authNotice = {
      type: sent ? "ok" : kind === "info" ? "info" : "warn",
      text: message || "",
    };
    if (!authNotice.text) authNotice = null;
    return authNotice;
  }

  function saveRec() {
    try {
      sessionStorage.setItem(
        REC_KEY,
        JSON.stringify({
          step: forgotStep,
          email: forgotEmail,
          token: forgotToken,
          until: resendUntil,
          purpose: resendPurpose,
          notice: authNotice,
        })
      );
    } catch (e) {}
  }
  function loadRec() {
    try {
      const raw = sessionStorage.getItem(REC_KEY);
      if (!raw) {
        /* sem estado salvo: recomeça do passo 1 (nunca herda um passo
           antigo que ficou só na memória) */
        forgotStep = 1;
        forgotEmail = "";
        forgotToken = "";
        resendUntil = 0;
        resendPurpose = "";
        authNotice = null;
        return;
      }
      const s = JSON.parse(raw) || {};
      forgotStep = s.step || 1;
      forgotEmail = s.email || "";
      forgotToken = s.token || "";
      resendUntil = s.until || 0;
      resendPurpose = s.purpose || "";
      authNotice = s.notice && s.notice.text ? s.notice : null;
    } catch (e) {}
  }
  function clearRec() {
    forgotStep = 1;
    forgotEmail = "";
    forgotToken = "";
    resendUntil = 0;
    resendPurpose = "";
    authNotice = null;
    try {
      sessionStorage.removeItem(REC_KEY);
    } catch (e) {}
  }

  function clearCountdown() {
    if (cdTimer) {
      clearInterval(cdTimer);
      cdTimer = null;
    }
  }

  /* contador do "Reenviar código" */
  function startCountdown(root) {
    clearCountdown();
    const btn = root.querySelector("[data-resend]");
    if (!btn) return;
    const paint = () => {
      const b = root.querySelector("[data-resend]");
      if (!b) {
        clearCountdown();
        return;
      }
      const left = Math.ceil((resendUntil - Date.now()) / 1000);
      if (left > 0) {
        b.disabled = true;
        b.textContent = "Reenviar em " + left + "s";
      } else {
        b.disabled = false;
        b.textContent = "Reenviar código";
        clearCountdown();
      }
    };
    paint();
    if (resendUntil > Date.now()) cdTimer = setInterval(paint, 1000);
  }

  /* aviso sobre o envio — a mensagem vem SEMPRE da API:
     só afirmamos o envio quando o provedor respondeu {ok:true} */
  function providerNotice() {
    if (authNotice && authNotice.text) {
      const mod = authNotice.type === "ok" ? "--ok" : authNotice.type === "warn" ? "--warn" : "";
      return (
        '<div class="auth__notice' + (mod ? " auth__notice" + mod : "") + '">' +
        NX.icon(authNotice.type === "warn" ? "alert" : "check", "", 17) +
        "<span>" + u().h(authNotice.text) + "</span></div>"
      );
    }
    /* sem tentativa nesta sessão: só orientamos, sem prometer envio */
    const status = NX.email && NX.email.status ? NX.email.status() : "unknown";
    if (status === "not-configured") {
      return (
        '<div class="auth__notice auth__notice--warn">' +
        NX.icon("alert", "", 17) +
        "<span>" + u().h(NX.email.NOT_CONFIGURED_MSG) + "</span></div>"
      );
    }
    return (
      '<div class="auth__notice">' +
      NX.icon("mail", "", 17) +
      "<span>Confira a caixa de entrada e, se não encontrar, " +
      "verifique também Spam ou outras pastas.</span></div>"
    );
  }

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

  function googleButtonHTML(size) {
    return (
      '<button type="button" class="btn btn--soft btn--block btn--lg btn--google" data-action="auth-google">' +
      NX.google.LOGO +
      "<span>Continuar com Google</span></button>"
    );
  }

  pages.setAuthMode = function (mode) {
    authMode = AUTH_ALIAS[mode] || mode || "login";
    clearCountdown();
    if (authMode === "forgot") loadRec();
    else if (authMode === "signup" || authMode === "login") clearRec();
    pages.renderAuth();
  };

  pages.renderAuth = function (mode) {
    if (mode) {
      authMode = AUTH_ALIAS[mode] || mode;
      if (authMode === "forgot") loadRec();
      else if (authMode === "signup" || authMode === "login") clearRec();
    }
    clearCountdown();
    const root = document.getElementById("screen-auth");
    if (!root) return;

    const art =
      '<div class="auth__art">' +
      '<div class="auth__brand">' + NX.brandMark(40) + "<span>Nexo</span></div>" +
      '<div class="auth__pitch">' +
      "<h1>Comunidades com a sua identidade.</h1>" +
      "<p>Crie seu servidor, organize por categorias e canais, defina cargos e convide quem você quiser.</p>" +
      "</div>" +
      '<ul class="auth__feats">' +
      "<li>" + NX.icon("folder", "", 18) + "<span><strong>Categorias e canais</strong>Do seu jeito, com texto e voz.</span></li>" +
      "<li>" + NX.icon("shield", "", 18) + "<span><strong>Cargos e permissões</strong>Controle quem faz o quê.</span></li>" +
      "<li>" + NX.icon("link", "", 18) + "<span><strong>Convites simples</strong>Um código e a porta está aberta.</span></li>" +
      "</ul>" +
      '<div class="auth__quote">“Montei meu servidor em dois minutos — e o convite saiu na hora.”</div>' +
      "</div>";

    let form = "";

    /* ---------------- LOGIN ---------------- */
    if (authMode === "login") {
      form =
        "<h2>Boas-vindas de volta</h2>" +
        '<p class="auth__sub">Entre para continuar com as suas comunidades.</p>' +
        '<form class="auth__form" data-form="login" novalidate>' +
        '<label class="field"><span class="field__label">E-mail ou nome de usuário</span>' +
        '<input class="input" name="identifier" type="text" autocomplete="username" placeholder="voce@exemplo.com" data-autofocus /></label>' +
        '<label class="field"><span class="field__label">Senha</span>' +
        '<span class="input-wrap">' +
        '<input class="input" name="password" type="password" autocomplete="current-password" placeholder="Sua senha" />' +
        '<button type="button" class="input-eye" data-action="toggle-password" aria-label="Mostrar senha">' +
        NX.icon("eye", "", 18) +
        "</button></span></label>" +
        '<div class="auth__row">' +
        '<label class="check"><input type="checkbox" name="remember" checked /><span class="check__box"></span>Manter conectado</label>' +
        '<button type="button" class="link-btn" data-action="auth-mode" data-mode="forgot">Esqueci minha senha</button>' +
        "</div>" +
        '<div class="form-error" data-error hidden></div>' +
        '<button class="btn btn--primary btn--block btn--lg" type="submit" data-busy-label="Entrando">Entrar</button>' +
        "</form>" +
        '<div class="auth__divider"><span>ou</span></div>' +
        googleButtonHTML() +
        '<div class="auth__alt">Ainda não tem conta?' +
        '<button class="link-btn" data-action="auth-mode" data-mode="signup">Criar conta</button></div>' +
        '<div class="auth__demo">' +
        "<div><strong>Conta de demonstração</strong><span>demo@nexo.chat · senha <code>nexo123</code></span></div>" +
        '<button class="btn btn--soft btn--sm" data-action="fill-demo">Entrar como demo</button>' +
        "</div>" +
        '<div class="auth__foot">' +
        '<button class="link-btn" data-action="goto-landing">' +
        NX.icon("arrowLeft", "", 15) + " Voltar para início</button></div>";

      /* ---------------- CADASTRO ---------------- */
    } else if (authMode === "signup") {
      form =
        "<h2>Crie sua conta</h2>" +
        '<p class="auth__sub">É rápido — e você já pode criar seu primeiro servidor.</p>' +
        '<form class="auth__form" data-form="signup" novalidate>' +
        '<label class="field"><span class="field__label">Nome de usuário</span>' +
        '<input class="input" name="username" type="text" autocomplete="username" placeholder="ex.: ana.bia" data-autofocus />' +
        '<span class="field__hint">3 a 18 caracteres: letras, números, ponto e sublinhado.</span></label>' +
        '<label class="field"><span class="field__label">Nome de exibição <em>(opcional)</em></span>' +
        '<input class="input" name="displayName" type="text" placeholder="Como as pessoas te chamam" /></label>' +
        '<label class="field"><span class="field__label">E-mail</span>' +
        '<input class="input" name="email" type="email" autocomplete="email" placeholder="voce@exemplo.com" /></label>' +
        '<div class="field-row">' +
        '<label class="field"><span class="field__label">Senha</span>' +
        '<span class="input-wrap"><input class="input" name="password" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres" data-pw-source />' +
        '<button type="button" class="input-eye" data-action="toggle-password" aria-label="Mostrar senha">' +
        NX.icon("eye", "", 18) +
        "</button></span></label>" +
        '<label class="field"><span class="field__label">Confirmar senha</span>' +
        '<input class="input" name="confirm" type="password" autocomplete="new-password" placeholder="Repita a senha" /></label>' +
        "</div>" +
        passwordRulesHTML("") +
        '<label class="field"><span class="field__label">Data de nascimento</span>' +
        '<input class="input" name="birth" type="date" /></label>' +
        '<div class="field"><span class="field__label">Avatar <em>(opcional)</em></span>' +
        '<div class="avatar-picker" data-avatar-picker>' +
        '<span class="avatar-picker__preview" data-avatar-preview>' +
        u().avatarHTML({ id: "new", displayName: "?", avatar: { emoji: "🌙", color: "#35e0a8" } }, "lg", false) +
        "</span>" +
        '<div class="avatar-picker__panel">' +
        '<div class="emoji-grid">' +
        Array.from(new Set(u().EMOJIS))
          .map(
            (e, i) =>
              '<button type="button" class="emoji-grid__item' + (i === 0 ? " is-on" : "") +
              '" data-pick-emoji="' + u().h(e) + '">' + e + "</button>"
          )
          .join("") +
        "</div>" +
        '<div class="swatch-row" data-swatches>' +
        u().PALETTE.map(
          (c, i) =>
            '<button type="button" class="swatch' + (i === 0 ? " is-on" : "") + '" style="--sw:' + c +
            '" data-pick-color="' + c + '" aria-label="Cor ' + c + '"></button>'
        ).join("") +
        "</div></div></div></div>" +
        '<label class="check check--terms"><input type="checkbox" name="terms" />' +
        '<span class="check__box"></span><span class="check__terms">Li e concordo com os ' +
        '<button type="button" class="link-btn" data-action="open-docs" data-doc="termos">Termos de Uso</button>' +
        " e a " +
        '<button type="button" class="link-btn" data-action="open-docs" data-doc="privacidade">Política de Privacidade</button>.' +
        "</span></label>" +
        '<div class="form-error" data-error hidden></div>' +
        '<button class="btn btn--primary btn--block btn--lg" type="submit" data-busy-label="Criando">Criar conta</button>' +
        "</form>" +
        '<div class="auth__divider"><span>ou</span></div>' +
        googleButtonHTML() +
        '<div class="auth__alt">Já tem uma conta?' +
        '<button class="link-btn" data-action="auth-mode" data-mode="login">Entrar</button></div>' +
        '<div class="auth__foot">' +
        '<button class="link-btn" data-action="goto-landing">' +
        NX.icon("arrowLeft", "", 15) + " Voltar para início</button></div>";

      /* ---------------- VERIFICAÇÃO DE E-MAIL ---------------- */
    } else if (authMode === "verify") {
      form =
        "<h2>Verifique seu e-mail</h2>" +
        '<p class="auth__sub">Enviamos um código de verificação para seu endereço de e-mail. ' +
        "Ele expira em 10 minutos e só pode ser usado uma vez.</p>" +
        providerNotice() +
        '<form class="auth__form" data-form="verify" novalidate>' +
        '<label class="field"><span class="field__label">Código de verificação</span>' +
        '<input class="input input--code" name="code" inputmode="numeric" maxlength="6" placeholder="000000" data-autofocus /></label>' +
        '<div class="form-error" data-error hidden></div>' +
        '<button class="btn btn--primary btn--block btn--lg" type="submit" data-busy-label="Verificando">Verificar</button>' +
        "</form>" +
        '<div class="auth__row auth__row--between">' +
        '<button type="button" class="link-btn" data-resend>Reenviar código</button>' +
        '<button type="button" class="link-btn" data-action="auth-mode" data-mode="login">' +
        NX.icon("arrowLeft", "", 15) + " Voltar para o login</button></div>" +
        '<div class="auth__foot">' +
        '<button type="button" class="link-btn" data-verify-skip>Continuar sem verificar agora</button></div>';

      /* ---------------- RECUPERAÇÃO ---------------- */
    } else {
      if (forgotStep === 2) {
        /* passo 2 — código */
        form =
          "<h2>Digite o código</h2>" +
          '<p class="auth__sub">Se existir uma conta associada a este endereço, ' +
          "enviaremos um código para recuperação.</p>" +
          providerNotice() +
          '<form class="auth__form" data-form="forgot" data-step="2" novalidate>' +
          '<label class="field"><span class="field__label">Código de verificação</span>' +
          '<input class="input input--code" name="code" inputmode="numeric" maxlength="6" placeholder="000000" data-autofocus /></label>' +
          '<div class="form-error" data-error hidden></div>' +
          '<button class="btn btn--primary btn--block btn--lg" type="submit" data-busy-label="Verificando">Verificar código</button>' +
          "</form>" +
          '<div class="auth__row auth__row--between">' +
          '<button type="button" class="link-btn" data-resend>Reenviar código</button>' +
          '<button type="button" class="link-btn" data-forgot-back>Voltar</button></div>' +
          '<div class="auth__alt"><button class="link-btn" data-action="auth-mode" data-mode="login">' +
          NX.icon("arrowLeft", "", 15) + " Voltar para o login</button></div>";
      } else if (forgotStep === 3) {
        /* passo 3 — nova senha */
        form =
          "<h2>Crie uma nova senha</h2>" +
          '<p class="auth__sub">Defina uma nova senha para <strong>' +
          u().h(forgotEmail) + "</strong>.</p>" +
          '<form class="auth__form" data-form="forgot" data-step="3" novalidate>' +
          '<label class="field"><span class="field__label">Nova senha</span>' +
          '<span class="input-wrap"><input class="input" name="password" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres" data-pw-source data-autofocus />' +
          '<button type="button" class="input-eye" data-action="toggle-password" aria-label="Mostrar senha">' +
          NX.icon("eye", "", 18) + "</button></span></label>" +
          passwordRulesHTML("") +
          '<label class="field"><span class="field__label">Confirmar nova senha</span>' +
          '<input class="input" name="confirm" type="password" autocomplete="new-password" placeholder="Repita a nova senha" /></label>' +
          '<div class="form-error" data-error hidden></div>' +
          '<button class="btn btn--primary btn--block btn--lg" type="submit" data-busy-label="Salvando">Salvar nova senha</button>' +
          "</form>" +
          '<div class="auth__alt"><button class="link-btn" data-action="auth-mode" data-mode="login">' +
          NX.icon("arrowLeft", "", 15) + " Voltar para o login</button></div>";
      } else {
        /* passo 1 — e-mail */
        form =
          "<h2>Recuperar acesso</h2>" +
          '<p class="auth__sub">Digite o e-mail da sua conta. Depois de enviar, ' +
          "confira a caixa de entrada para o código de verificação.</p>" +
          '<form class="auth__form" data-form="forgot" data-step="1" novalidate>' +
          '<label class="field"><span class="field__label">E-mail</span>' +
          '<input class="input" name="email" type="email" autocomplete="email" placeholder="voce@exemplo.com" data-autofocus />' +
          '<span class="field__hint">Também aceitamos seu nome de usuário.</span></label>' +
          '<div class="form-error" data-error hidden></div>' +
          '<button class="btn btn--primary btn--block btn--lg" type="submit" data-busy-label="Enviando">Enviar código</button>' +
          "</form>" +
          '<div class="auth__alt"><button class="link-btn" data-action="auth-mode" data-mode="login">' +
          NX.icon("arrowLeft", "", 15) + " Voltar para o login</button></div>";
      }
    }

    root.innerHTML =
      '<div class="auth">' +
      art +
      '<div class="auth__panel"><div class="auth__card">' +
      '<div class="auth__mobile-brand">' + NX.brandMark(32) + "<span>Nexo</span></div>" +
      form +
      "</div></div></div>";

    wireAuth(root);
    startCountdown(root);
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
    let pickedEmoji = "🌙";
    let pickedColor = u().PALETTE[0];

    const picker = root.querySelector("[data-avatar-picker]");
    if (picker) {
      picker.addEventListener("click", (e) => {
        const emb = e.target.closest("[data-pick-emoji]");
        const col = e.target.closest("[data-pick-color]");
        if (emb) {
          pickedEmoji = emb.getAttribute("data-pick-emoji");
          picker.querySelectorAll("[data-pick-emoji]").forEach((b) => b.classList.toggle("is-on", b === emb));
        } else if (col) {
          pickedColor = col.getAttribute("data-pick-color");
          picker.querySelectorAll("[data-pick-color]").forEach((b) => b.classList.toggle("is-on", b === col));
        } else return;
        const prev = picker.querySelector("[data-avatar-preview]");
        if (prev) {
          prev.innerHTML = u().avatarHTML(
            { id: "new", displayName: "?", avatar: { emoji: pickedEmoji, color: pickedColor } },
            "lg",
            false
          );
        }
      });
    }

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
      const step = form.getAttribute("data-step");

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        showFormError(form, "");
        const data = Object.fromEntries(new FormData(form).entries());
        const btn = form.querySelector('button[type="submit"]');

        /* ================= RECUPERAÇÃO DE SENHA ================= */
        if (kind === "forgot") {
          /* passo 1 — pedir o código */
          if (step === "1") {
            const id = String(data.email || "").trim();
            if (!id) {
              showFormError(form, "Digite um endereço de e-mail válido.");
              return;
            }
            if (id.indexOf("@") > -1 && !u().isEmail(id)) {
              showFormError(form, "Digite um endereço de e-mail válido.");
              return;
            }
            const end = NX.ui.busy(btn);
            NX.api.requestReset(id)
              .then((res) => {
                end();
                forgotEmail = u().normalizeIdentifier(id);
                resendUntil = res.resendAt || 0;
                resendPurpose = "recover";
                forgotStep = 2;
                setNotice(res.message, res.sent, res.noAccount ? "info" : "");
                saveRec();
                pages.renderAuth();
              })
              .catch((err) => {
                end();
                showFormError(form, err.message);
              });
            return;
          }

          /* passo 2 — conferir o código */
          if (step === "2") {
            const end = NX.ui.busy(btn);
            NX.api.confirmResetCode({ code: data.code })
              .then((res) => {
                end();
                forgotToken = res.token || ""; /* fica só na aba */
                forgotStep = 3;
                saveRec();
                pages.renderAuth();
              })
              .catch((err) => {
                end();
                showFormError(form, err.message);
              });
            return;
          }

          /* passo 3 — nova senha */
          if (String(data.password) !== String(data.confirm)) {
            showFormError(form, "As senhas não conferem.");
            return;
          }
          const end3 = NX.ui.busy(btn);
          NX.api.resetPassword({
            token: forgotToken,
            password: data.password,
            confirm: data.confirm,
          })
            .then(() => {
              end3();
              clearRec();
              pages.setAuthMode("login");
              NX.ui.toast("Senha alterada com sucesso.", "success");
            })
            .catch((err) => {
              end3();
              showFormError(form, err.message);
            });
          return;
        }

        /* ================= VERIFICAÇÃO DE E-MAIL ================= */
        if (kind === "verify") {
          const end = NX.ui.busy(btn);
          NX.api.verifyEmail({ code: data.code })
            .then(() => {
              end();
              clearCountdown();
              NX.ui.toast("E-mail verificado com sucesso!", "success");
              NX.app.go("#/bem-vindo");
            })
            .catch((err) => {
              end();
              showFormError(form, err.message);
            });
          return;
        }

        /* ================= CADASTRO ================= */
        if (kind === "signup") {
          const policy = u().passwordPolicy(data.password);
          if (!policy.ok) {
            showFormError(form, policy.message);
            return;
          }
          if (String(data.password) !== String(data.confirm)) {
            showFormError(form, "As senhas não conferem.");
            return;
          }
          if (!data.terms) {
            showFormError(form, "É preciso aceitar os Termos de Uso e a Política de Privacidade.");
            return;
          }
          const end = NX.ui.busy(btn);
          NX.api.signup({
            email: data.email,
            username: data.username,
            displayName: data.displayName,
            password: data.password,
            confirm: data.confirm,
            birth: data.birth,
            terms: !!data.terms,
            avatar: { emoji: pickedEmoji, color: pickedColor },
          })
            .then((res) => {
              end();
              clearRec();
              resendUntil = res.resendAt || 0;
              resendPurpose = "verify";
              setNotice(res.emailNotice, res.sent, "");
              saveRec();
              NX.ui.toast(res.message || "Sua conta foi criada com sucesso.", "success");
              NX.app.go("#/verificar");
            })
            .catch((err) => {
              end();
              showFormError(form, err.message);
            });
          return;
        }

        /* ================= LOGIN ================= */
        const end = NX.ui.busy(btn);
        NX.api.login({
          identifier: data.identifier,
          password: data.password,
          remember: !!data.remember,
        })
          .then((user) => {
            end();
            if (user && user.emailVerified === false) {
              NX.ui.toast("E-mail ainda não verificado — você pode confirmar depois.", "info");
            }
            NX.app.afterAuth();
          })
          .catch((err) => {
            end();
            showFormError(form, err.message);
          });
      });
    });

    /* ---- ações soltas da tela de auth ---- */
    if (!root.dataset.authWired) {
      root.dataset.authWired = "1";
      root.addEventListener("click", (e) => {
        const resend = e.target.closest("[data-resend]");
        if (resend) {
          if (resend.disabled) return;
          const purpose = resendPurpose || (authMode === "verify" ? "verify" : "recover");
          NX.api.resendCode(purpose)
            .then((res) => {
              resendUntil = res.resendAt || 0;
              resendPurpose = purpose;
              setNotice(res.message, res.sent, "");
              saveRec();
              pages.renderAuth();
              NX.ui.toast(res.message, res.sent ? "success" : "info");
            })
            .catch((err) => NX.ui.error(err.message));
          return;
        }

        if (e.target.closest("[data-forgot-back]")) {
          forgotStep = 1;
          saveRec();
          pages.renderAuth();
          return;
        }

        if (e.target.closest("[data-verify-skip]")) {
          NX.api.skipEmailVerification()
            .then(() => {
              clearCountdown();
              NX.ui.toast("Você pode verificar o e-mail depois, em Configurações.", "info");
              NX.app.go("#/bem-vindo");
            })
            .catch((err) => NX.ui.error(err.message));
        }
      });
    }
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
      (s.ownerId === S().me().id ? '<span class="tag tag--owner">Dono</span>' : "") +
      "</span></span>" +
      '<strong class="server-card__name">' + u().h(s.name) + "</strong>" +
      '<span class="server-card__desc truncate">' +
      u().h(s.description || "Sem descrição ainda.") +
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
      "<strong>Criar servidor</strong><span>Nome, ícone e estrutura pronta.</span></button>" +
      '<button class="quick-card" data-action="join-invite">' +
      '<span class="quick-card__ico">' + NX.icon("enter", "", 22) + "</span>" +
      "<strong>Entrar com convite</strong><span>Cole o código ou o link.</span></button>" +
      '<button class="quick-card" data-action="nav-explore">' +
      '<span class="quick-card__ico">' + NX.icon("compass", "", 22) + "</span>" +
      "<strong>Explorar</strong><span>Veja comunidades abertas.</span></button>" +
      "</div>";

    const list = servers.length
      ? '<div class="server-grid">' + servers.map(serverCard).join("") + "</div>"
      : '<div class="empty-state">' +
        '<span class="empty-state__ico">' + NX.icon("construction", "", 28) + "</span>" +
        "<h3>Nenhum servidor ainda</h3>" +
        "<p>Crie o seu servidor ou entre em um por convite. Não existe servidor obrigatório por aqui.</p>" +
        '<div class="empty-state__actions">' +
        '<button class="btn btn--primary" data-action="create-server">Criar servidor</button>' +
        '<button class="btn btn--soft" data-action="join-invite">Entrar com convite</button>' +
        "</div></div>";

    const tips =
      '<section class="panel">' +
      '<header class="panel__head"><h3>' + NX.icon("sparkles", "", 17) + " O que dá pra fazer</h3></header>" +
      '<ul class="tip-list">' +
      "<li><span>📁</span><div><strong>Categorias</strong><p>Agrupe canais e recolha quando quiser.</p></div></li>" +
      "<li><span>💬</span><div><strong>Canais de texto e voz</strong><p>Crie #geral, #memes, salas de voz e mais.</p></div></li>" +
      "<li><span>🛡️</span><div><strong>Cargos e permissões</strong><p>Defina quem pode moderar, convidar ou falar.</p></div></li>" +
      "<li><span>🎟️</span><div><strong>Convites</strong><p>Um código curto abre a porta do seu servidor.</p></div></li>" +
      "</ul></section>";

    const profilePanel =
      '<section class="panel">' +
      '<header class="panel__head"><h3>' + NX.icon("user", "", 17) + " Seu perfil</h3></header>" +
      '<div class="mini-profile">' +
      u().avatarHTML(me, "xl", true) +
      "<div><strong>" + u().h(me.displayName) + "</strong>" +
      '<span class="mini-profile__user">@' + u().h(me.username) + "</span>" +
      '<span class="status-pill" data-status="' + me.status + '">' + u().h(NX.STATUS_LABEL[me.status]) + "</span></div>" +
      '<div class="mini-profile__actions">' +
      '<button class="btn btn--soft btn--sm" data-action="edit-profile">Editar perfil</button>' +
      '<button class="btn btn--ghost btn--sm" data-action="open-profile" data-id="' + me.id + '">Ver página</button>' +
      "</div></div>" +
      '<div class="mini-stats">' +
      "<div><strong>" + servers.length + "</strong><span>servidores</span></div>" +
      "<div><strong>" + dms.length + "</strong><span>conversas</span></div>" +
      "<div><strong>" + S().membershipsOf(me.id).length + "</strong><span>servidores</span></div>" +
      "</div></section>";

    return (
      '<div class="page page--home">' +
      '<section class="hero">' +
      '<div class="hero__text">' +
      '<span class="hero__hi">Bem-vindo!</span>' +
      "<h1>Olá, " + u().h(me.displayName.split(" ")[0]) + " 👋</h1>" +
      "<p>Escolha um servidor à esquerda ou comece algo novo. Sua comunidade, suas regras.</p>" +
      "</div>" +
      quick +
      "</section>" +
      '<section class="block">' +
      '<header class="block__head"><h2>Seus servidores</h2>' +
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
      S().membersOf(m.serverId).forEach((row) => {
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
      "<h2>Suas conversas diretas</h2>" +
      "<p>Escolha uma conversa na barra lateral ou comece uma nova com alguém de um servidor que vocês compartilham.</p>" +
      '<div class="state-block__actions">' +
      '<button class="btn btn--primary" data-action="new-dm">Nova conversa</button>' +
      "</div>" +
      (suggestions
        ? '<div class="people-row"><span class="people-row__label">Pessoas online agora</span><div>' +
          suggestions +
          "</div></div>"
        : '<div class="people-row"><span class="people-row__label">Entre em um servidor para conhecer pessoas — ' +
          '<button class="link-btn" data-action="nav-explore">explorar servidores</button></span></div>') +
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
        "<h2>Nenhum servidor no diretório</h2>" +
        "<p>Quando alguém ativar “Mostrar no explorar” nas configurações, a comunidade aparece aqui.</p>" +
        '<div class="state-block__actions">' +
        '<button class="btn btn--primary" data-action="create-server">Criar o primeiro</button>' +
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
          "<p>" + u().h(s.description || "Sem descrição.") + "</p>" +
          '<div class="explore-card__foot">' +
          '<span class="tag">' + u().plural(S().channelsOf(s.id).length, "canal", "canais") + "</span>" +
          (isMember
            ? '<button class="btn btn--soft btn--sm" data-action="open-server" data-id="' + s.id + '">Abrir</button>'
            : '<button class="btn btn--primary btn--sm" data-action="join-explore" data-id="' + s.id + '">Entrar</button>') +
          "</div></article>"
        );
      })
      .join("");

    return (
      '<div class="page">' +
      '<section class="block"><header class="block__head"><h2>Servidores abertos</h2>' +
      '<span class="block__count">' + servers.length + "</span></header>" +
      '<p class="block__sub">Nenhuma comunidade é obrigatória aqui: você entra e sai quando quiser.</p>' +
      '<div class="explore-grid">' + cards + "</div></section></div>"
    );
  };

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
      '<div class="state-block"><h3>Feed indisponível</h3>' +
      "<p>O módulo social ainda não terminou de carregar.</p></div>"
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
          u().h(r ? r.name : "Membro") +
          (s.ownerId === user.id ? " · Dono" : "") +
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
      u().h(NX.STATUS_LABEL[user.status] || "Offline") +
      (user.statusText ? " · " + u().h(user.statusText) : "") +
      "</span></div>" +
      '<div class="profile-card__actions">' +
      (isMe
        ? '<button class="btn btn--primary btn--sm" data-action="edit-profile">Editar perfil</button>'
        : '<button class="btn btn--primary btn--sm" data-action="start-dm" data-id="' + user.id + '">' +
          NX.icon("chat", "", 16) + " Mensagem</button>") +
      "</div></div>" +
      '<div class="profile-card__grid">' +
      '<div class="profile-card__col">' +
      "<h4>Sobre mim</h4>" +
      '<p class="profile-card__bio">' + u().h(user.bio || (isMe ? "Você ainda não escreveu uma bio. Edite seu perfil para contar quem é você." : "Nada por aqui ainda.")) + "</p>" +
      '<div class="profile-card__meta">' +
      "<span><small>Membro desde</small>" +
      u().h(new Date(user.createdAt).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })) +
      "</span>" +
      "<span><small>Convite</small>@" + u().h(user.username) + "</span>" +
      "</div></div>" +
      '<div class="profile-card__col">' +
      "<h4>Servidores" + (servers.length ? " · " + servers.length : "") + "</h4>" +
      (serverRows
        ? '<div class="pill-list">' + serverRows + "</div>"
        : '<p class="profile-card__bio">' + (isMe ? "Você ainda não participa de nenhum servidor." : "Este usuário não participa de nenhum servidor visível.") + "</p>") +
      (shared.length && !isMe
        ? '<div class="profile-card__shared"><small>Vocês se conhecem em</small>' +
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
        "<h1>Convite inválido</h1>" +
        "<p>O código <strong>" + u().h(String(code || "").toUpperCase()) + "</strong> não existe ou foi revogado. Peça um novo link para quem administra o servidor.</p>" +
        '<div class="invite-card__actions">' +
        '<button class="btn btn--primary" data-action="nav-explore">Explorar servidores</button>' +
        (me ? '<button class="btn btn--soft" data-action="nav-home">Página inicial</button>' : "") +
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
        NX.icon("enter", "", 18) + " Abrir servidor</button>" +
        '<button class="btn btn--ghost" data-action="nav-home">Página inicial</button></div>'
      : me
      ? '<div class="invite-card__actions">' +
        '<button class="btn btn--primary btn--lg" data-action="accept-invite" data-code="' + invite.code + '">' +
        NX.icon("enter", "", 18) + " Entrar no servidor</button>" +
        '<button class="btn btn--ghost" data-action="nav-home">Agora não</button></div>'
      : '<div class="invite-card__actions">' +
        '<button class="btn btn--primary btn--lg" data-action="login-for-invite" data-code="' + invite.code + '">Entrar para aceitar</button>' +
        '<button class="btn btn--soft" data-action="signup-for-invite" data-code="' + invite.code + '">Criar conta</button></div>';

    root.innerHTML =
      '<div class="invite-wrap"><div class="invite-card">' +
      '<div class="invite-card__brand">' + NX.brandMark(28) + "<span>Nexo</span></div>" +
      '<div class="invite-card__icon">' + u().serverIconHTML(server, "xl", false) + "</div>" +
      "<h1>" + u().h(server.name) + "</h1>" +
      '<p class="invite-card__desc">' + u().h(server.description || "Uma comunidade no Nexo.") + "</p>" +
      '<div class="invite-card__stats">' +
      "<div><strong>" + count + "</strong><span>" + (count === 1 ? "membro" : "membros") + "</span></div>" +
      "<i></i><div><strong>" + online + "</strong><span>online agora</span></div>" +
      "<i></i><div><strong>" + S().categoriesOf(server.id).length + "</strong><span>categorias</span></div>" +
      "</div>" +
      '<div class="invite-card__owner">' +
      u().avatarHTML(owner, "xs", false) +
      "<span>Criado por <strong>" + u().h(owner ? owner.displayName : "desconhecido") + "</strong></span>" +
      '<span class="invite-card__code mono">' + u().h(invite.code) + "</span>" +
      "</div>" +
      actions +
      '<p class="invite-card__note">Ao entrar, você concorda com as regras definidas pelos administradores do servidor.</p>' +
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
      { id: "create", icon: "home", title: "Criar meu servidor", desc: "Comece do zero com categorias e canais prontos." },
      { id: "invite", icon: "link", title: "Entrar com convite", desc: "Cole o link ou o código que alguém te passou." },
      { id: "explore", icon: "user", title: "Explorar minha conta", desc: "Veja seu perfil, preferências e notificações." },
    ];

    root.innerHTML =
      '<div class="auth auth--single"><div class="auth__panel auth__panel--full"><div class="welcome" data-welcome>' +
      '<div class="welcome__brand">' + NX.brandMark(44) + "<span>Nexo</span></div>" +
      '<div class="welcome__head">' +
      '<span class="welcome__badge">' + NX.icon("sparkles", "", 18) + " Conta criada</span>" +
      "<h1>Bem-vindo à Nexo" + (me ? ", " + u().h(me.displayName) : "") + "!</h1>" +
      "<p>O que você quer fazer?</p>" +
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
      '<button class="btn btn--primary btn--lg" data-welcome-go>Continuar</button>' +
      '<button class="link-btn" data-action="nav-home">Pular por enquanto</button>' +
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
