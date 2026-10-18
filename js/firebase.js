/* ============================================================
   NEXO · js/firebase.js
   Ponte com o Firebase Authentication (provedores: e-mail/senha
   e Google) usando o SDK OFICIAL da Google.

   O que este arquivo faz:
     1) guarda a configuração PÚBLICA do app web do Firebase;
     2) carrega o SDK oficial só quando alguém usa um acesso
        Firebase (não atrasa a abertura do site);
     3) entrega ao backend apenas um ID token — a senha e o
        acesso do Google nunca passam pelo servidor do Nexo;
     4) traduz os erros do Firebase para português claro.

   O que ele NÃO faz:
     · não guarda conta, senha ou sessão no navegador;
     · não decide quem é o dono de uma conta: isso é o backend
       (server/firebase.js verifica o token com a chave do Google);
     · não substitui o login por nome de usuário + senha, que
       continua funcionando exatamente como antes.

   ============================================================

   >>> PREENCHA AQUI A CONFIGURAÇÃO DO SEU PROJETO <<<
   Firebase Console → Configurações do projeto → Seus apps →
   app web → "SDK setup and configuration". Esses valores são
   PÚBLICOS por definição (vão para o navegador de qualquer um);
   nenhum segredo do servidor mora aqui.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const CONFIG = {
    apiKey: "", // ex.: "AIzaSy..."
    authDomain: "", // ex.: "meu-projeto.firebaseapp.com"
    projectId: "", // ex.: "meu-projeto"
    appId: "", // ex.: "1:123456:web:abc123"
    messagingSenderId: "", // opcional
  };

  const SDK_VERSION = "10.12.2";
  const SDK_URLS = [
    "https://www.gstatic.com/firebasejs/" + SDK_VERSION + "/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/" + SDK_VERSION + "/firebase-auth-compat.js",
  ];

  let loading = null;
  let authInstance = null;

  function configured() {
    return !!(
      CONFIG.apiKey &&
      CONFIG.authDomain &&
      CONFIG.projectId &&
      CONFIG.appId
    );
  }

  function notConfiguredError() {
    const e = new Error(
      NX.i18n.get(
        "fb.naoAtivado",
        "O acesso por e-mail/Google ainda não está ativado neste site."
      )
    );
    e.code = "nexo/fb-not-configured";
    return e;
  }

  /* carrega o SDK oficial sob demanda (uma única vez) */
  function loadSDK() {
    if (window.firebase && window.firebase.auth) return Promise.resolve();
    if (loading) return loading;
    loading = SDK_URLS.reduce(
      (chain, url) =>
        chain.then(
          () =>
            new Promise((resolve, reject) => {
              const s = document.createElement("script");
              s.src = url;
              s.async = true;
              s.onload = () => resolve();
              s.onerror = () =>
                reject(
                  new Error(
                    NX.i18n.get(
                      "fb.semRede",
                      "Não foi possível carregar o Firebase. Verifique sua conexão."
                    )
                  )
                );
              document.head.appendChild(s);
            })
        ),
      Promise.resolve()
    ).catch((e) => {
      loading = null;
      throw e;
    });
    return loading;
  }

  function auth() {
    if (authInstance) return authInstance;
    if (!window.firebase) throw notConfiguredError();
    if (!window.firebase.apps || !window.firebase.apps.length) {
      window.firebase.initializeApp(CONFIG);
    }
    authInstance = window.firebase.auth();
    return authInstance;
  }

  /* erro do Firebase → frase clara em português */
  function friendlyError(err) {
    const code = (err && err.code) || "";
    const map = {
      "auth/invalid-email": "fb.err.invalidEmail",
      "auth/weak-password": "fb.err.weakPassword",
      "auth/email-already-in-use": "fb.err.emailInUse",
      "auth/invalid-credential": "fb.err.badCredentials",
      "auth/wrong-password": "fb.err.badCredentials",
      "auth/user-not-found": "fb.err.badCredentials",
      "auth/user-disabled": "fb.err.disabled",
      "auth/too-many-requests": "fb.err.tooMany",
      "auth/network-request-failed": "fb.err.network",
      "auth/popup-closed-by-user": "fb.err.popupClosed",
      "auth/cancelled-popup-request": "fb.err.popupClosed",
      "auth/popup-blocked": "fb.err.popupBlocked",
      "auth/unauthorized-domain": "fb.err.unauthorizedDomain",
      "auth/operation-not-allowed": "fb.err.notAllowed",
      "auth/requires-recent-login": "fb.err.recentLogin",
      "auth/quota-exceeded": "fb.err.quota",
      "auth/internal-error": "fb.err.internal",
    };
    const texts = {
      "fb.err.invalidEmail": "Digite um e-mail válido.",
      "fb.err.weakPassword": "A senha precisa de pelo menos 8 caracteres, com letra e número.",
      "fb.err.emailInUse": "Este e-mail já está cadastrado. Entre com ele.",
      "fb.err.badCredentials": "E-mail ou senha incorretos.",
      "fb.err.disabled": "Esta conta foi desativada.",
      "fb.err.tooMany": "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
      "fb.err.network": "Sem conexão com o Firebase. Tente novamente.",
      "fb.err.popupClosed": "A janela do Google foi fechada antes de concluir.",
      "fb.err.popupBlocked": "O navegador bloqueou a janela do Google. Permita pop-ups para este site.",
      "fb.err.unauthorizedDomain": "Este site ainda não está autorizado no Firebase. Adicione o domínio nas configurações do projeto.",
      "fb.err.notAllowed": "Este tipo de login não está ativado no Firebase Authentication.",
      "fb.err.recentLogin": "Por segurança, entre novamente para continuar.",
      "fb.err.quota": "Limite de e-mails atingido. Tente mais tarde.",
      "fb.err.internal": "O Firebase recusou a operação. Tente novamente.",
    };
    const e = new Error(NX.i18n.get(map[code] || "fb.err.generic", texts[map[code]] || "Não foi possível concluir a operação com o Firebase."));
    e.code = code || (err && err.code) || null;
    return e;
  }

  /* token de identidade do usuário do Firebase (navegador → backend) */
  function idTokenOf(user) {
    return user.getIdToken();
  }

  const fb = {
    configured,
    /* Google: popup oficial. Devolve o ID token para o backend. */
    signInWithGoogle: async function () {
      if (!configured()) throw notConfiguredError();
      try {
        await loadSDK();
        const provider = new window.firebase.auth.GoogleAuthProvider();
        const cred = await auth().signInWithPopup(provider);
        return await idTokenOf(cred.user);
      } catch (err) {
        throw friendlyError(err);
      }
    },

    /* e-mail + senha: cria a conta no Firebase e pede a confirmação.
       Se o e-mail já existir no Firebase, tenta ENTRAR com a mesma
       senha (retomada de cadastro) antes de avisar. */
    signUpEmail: async function (email, password) {
      if (!configured()) throw notConfiguredError();
      try {
        await loadSDK();
        let cred;
        let created = false;
        try {
          cred = await auth().createUserWithEmailAndPassword(
            String(email).trim(),
            String(password)
          );
          created = true;
        } catch (err) {
          if ((err && err.code) !== "auth/email-already-in-use") throw err;
          cred = await auth().signInWithEmailAndPassword(
            String(email).trim(),
            String(password)
          );
        }
        if (created) {
          try {
            await cred.user.sendEmailVerification();
          } catch (e) {
            /* falha no e-mail de confirmação não impede a conta */
          }
        }
        return { idToken: await idTokenOf(cred.user), created: created };
      } catch (err) {
        throw friendlyError(err);
      }
    },

    /* e-mail + senha de conta já existente */
    signInEmail: async function (email, password) {
      if (!configured()) throw notConfiguredError();
      try {
        await loadSDK();
        const cred = await auth().signInWithEmailAndPassword(
          String(email).trim(),
          String(password)
        );
        return await idTokenOf(cred.user);
      } catch (err) {
        throw friendlyError(err);
      }
    },

    /* recuperação de senha: o link vem do Firebase, sem passar
       pelo servidor do Nexo */
    sendResetEmail: async function (email) {
      if (!configured()) throw notConfiguredError();
      try {
        await loadSDK();
        await auth().sendPasswordResetEmail(String(email).trim());
      } catch (err) {
        throw friendlyError(err);
      }
    },

    /* reenvia o e-mail de confirmação (só com sessão do Firebase) */
    sendVerification: async function () {
      if (!configured()) throw notConfiguredError();
      try {
        await loadSDK();
        const user = auth().currentUser;
        if (!user) throw notConfiguredError();
        await user.sendEmailVerification();
      } catch (err) {
        throw friendlyError(err);
      }
    },
  };

  NX.firebase = fb;
})(window.NX);
