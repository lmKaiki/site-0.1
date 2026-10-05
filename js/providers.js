/* ============================================================
   NEXO · providers (camada de integração externa)
   Responsável por TUDO que sai para fora do protótipo:

     NX.email  → envio REAL de e-mail (código de verificação e
                 recuperação de senha). O navegador fala apenas
                 com a API do próprio projeto:

                   FRONTEND → API/serverless → PROVEDOR → GMAIL

                 A API existe em `api/send-email.js` (Vercel) e no
                 servidor local `serve.ps1`. As credenciais vivem
                 em variáveis de ambiente DO SERVIDOR
                 (EMAIL_PROVIDER_API_KEY / SMTP_*), nunca aqui.

     NX.google → OAuth do Google. Sem client id configurado o
                 botão explica o que falta em vez de fingir login.

   Regras deste arquivo:
     - nenhuma chave, senha ou token de servidor por aqui;
     - "enviado" só quando a API responder {ok:true};
     - falha real vira mensagem de falha, nunca "código enviado";
     - o código de verificação nunca aparece no console;
     - a caixa de saída local (db.outbox) só é gravada quando
       NADA foi enviado (modo desenvolvimento, sem provedor).
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const CFG_EMAIL = "nexo.email.provider";
  const CFG_GOOGLE = "nexo.google.clientId";

  const readJSON = (key) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  };

  /* =========================================================
     E-MAIL — envio real
     -------------------------------------------------------
     O navegador NUNCA fala com o provedor. Ele só chama a
     SUA API (mesma origem: /api/send-email), que fica aqui:

        FRONTEND  →  API/serverless  →  PROVEDOR  →  GMAIL

     • nenhuma chave, senha SMTP ou token sai do servidor;
     • o backend monta assunto e corpo a partir de
       { to, name, code, purpose } — o template fica no
       servidor, junto das credenciais;
     • "sent" só é true quando a API responde {ok:true};
     • falha vira mensagem de falha, nunca "código enviado";
     • o código nunca aparece no console nem em log.
     ========================================================= */
  const email = {};

  /* endpoint da API (mesma origem por padrão). Pode ser apontado
     para outro host em app/config — nunca contém segredo. */
  const DEFAULT_ENDPOINT = "/api/send-email";

  email.NOT_CONFIGURED_MSG =
    "O envio de e-mail ainda não está configurado neste ambiente. " +
    "Nenhum e-mail foi enviado — assim que um provedor for conectado, " +
    "o código chegará no seu endereço.";

  email.notConfiguredShort = "Provedor de e-mail não conectado — nenhum e-mail foi enviado.";

  /* mensagens exigidas pela especificação.
     ATENÇÃO: nunca prometemos "caixa de entrada"/entrega — só o
     provedor sabe o que aconteceu depois de aceitar a mensagem.
     Em caso de sucesso, orientamos a conferir as outras pastas. */
  email.FOLDER_HINT = "Verifique também Spam ou outras pastas.";
  email.SENT_RESET_MSG =
    "Enviamos um código de verificação para seu e-mail. " + email.FOLDER_HINT;
  email.SENT_RESEND_MSG =
    "Novo código enviado. " + email.FOLDER_HINT;
  email.SENT_VERIFY_MSG =
    "Enviamos um código de verificação para seu e-mail. " + email.FOLDER_HINT;
  email.SEND_FAILED_MSG = "Não foi possível enviar o código. Tente novamente.";

  email.endpoint = function () {
    const cfg = readJSON(CFG_EMAIL);
    if (cfg && cfg.endpoint) return cfg.endpoint;
    return DEFAULT_ENDPOINT;
  };

  /* aponta para outra API (apenas URL — segredo fica no servidor) */
  email.configure = function (endpoint) {
    try {
      localStorage.setItem(CFG_EMAIL, JSON.stringify({ endpoint: String(endpoint || "") }));
      return true;
    } catch (e) {
      return false;
    }
  };

  email.clearConfig = function () {
    try {
      localStorage.removeItem(CFG_EMAIL);
    } catch (e) {}
  };

  /* estado do último envio: null = ainda não sabemos */
  email.state = { configured: null, last: null };

  /* "connected" | "not-configured" | "unknown" */
  email.status = function () {
    if (email.state.configured === true) return "connected";
    if (email.state.configured === false) return "not-configured";
    return "unknown";
  };

  email.isConfigured = function () {
    return email.status() === "connected";
  };

  /**
   * Mensagem honesta para a interface.
   * @param {boolean} sent   a API confirmou {ok:true}?
   * @param {"reset"|"resend"|"verify"} kind
   */
  email.sentMessage = function (sent, kind) {
    if (sent) {
      if (kind === "resend") return email.SENT_RESEND_MSG;
      if (kind === "verify") return email.SENT_VERIFY_MSG;
      return email.SENT_RESET_MSG;
    }
    const reason = (email.state.last && email.state.last.reason) || "not-configured";
    if (reason === "not-configured") return email.NOT_CONFIGURED_MSG;
    return email.SEND_FAILED_MSG;
  };

  email.verifyMessage = function (sent) {
    return email.sentMessage(sent, "verify");
  };

  /* registro de desenvolvimento: só quando NADA foi enviado (sem
     provedor). Nunca guarda código com provedor configurado. */
  function devOutbox(msg, result) {
    if (result && result.sent) return;
    if (result && result.reason !== "not-configured") return;
    try {
      const db = NX.store.db;
      db.outbox = db.outbox || [];
      db.outbox.unshift({
        id: "mail_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        to: msg.to,
        subject: email.subjectFor(msg.purpose),
        body: email.bodyFor(msg),
        purpose: msg.purpose,
        at: Date.now(),
        delivered: false,
        sent: false,
        dev: true,
        provider: "nenhum",
        reason: "not-configured",
      });
      if (db.outbox.length > 40) db.outbox.length = 40;
      NX.store.persist();
    } catch (e) {
      /* caixa de dev é melhor esforço */
    }
  }

  /* ---- template (mesmo texto que o backend envia) ---- */
  email.subjectFor = function (purpose) {
    return purpose === "verify" ? "Seu código de verificação" : "Seu código de recuperação";
  };

  email.bodyFor = function (msg) {
    const nome = String(msg.name || msg.to || "").split("@")[0] || "usuário";
    const platform = "NEXO";
    if (msg.purpose === "verify") {
      return (
        "Olá, " + nome + ".\n\n" +
        "Recebemos uma solicitação para verificar o seu e-mail no " + platform + ".\n\n" +
        "Seu código de verificação é:\n\n" + msg.code + "\n\n" +
        "Esse código expira em alguns minutos.\n\n" +
        "Se você não solicitou isso, ignore este e-mail.\n\n" +
        "Atenciosamente,\n" + platform
      );
    }
    return (
      "Olá, " + nome + ".\n\n" +
      "Recebemos uma solicitação para recuperar sua conta.\n\n" +
      "Seu código de verificação é:\n\n" + msg.code + "\n\n" +
      "Esse código expira em alguns minutos.\n\n" +
      "Se você não solicitou essa recuperação, ignore este e-mail.\n\n" +
      "Atenciosamente,\n" + platform
    );
  };

  /**
   * Envia o código pedindo à API do servidor (o servidor fala com
   * o provedor). Nunca afirma sucesso sem confirmação da API.
   * @param {{to:string,name:string,code:string,purpose:string}} msg
   * @returns {Promise<{sent:boolean,reason?:string,status?:number,detail?:string}>}
   */
  email.send = async function (msg) {
    const endpoint = email.endpoint();
    const payload = {
      to: msg.to,
      name: msg.name || "",
      purpose: msg.purpose || "reset",
      code: msg.code,
      locale: "pt-BR",
    };

    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      /* rede/endpoint inexistente: nunca é sucesso */
      email.state.configured = null;
      const out = { sent: false, reason: "network", detail: e.message };
      email.state.last = out;
      email.lastStatus = out;
      console.error("[email] falha ao chamar a API de envio (" + endpoint + "):", e.message);
      return out;
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }

    if (res.ok && data && data.ok === true) {
      /* accepted pelo provedor — nunca "entregue" */
      email.state.configured = true;
      email.state.last = { sent: true, accepted: true, delivered: false };
      email.lastStatus = email.state.last;
      return { sent: true };
    }

    /* motivo determinado pela API — nunca chutamos "enviado" */
    const reason =
      (data && data.reason) ||
      (res.status === 404 || res.status === 501 ? "not-configured" : "provider-error");
    email.state.configured = reason === "not-configured" ? false : true;

    const out = {
      sent: false,
      reason: reason,
      status: res.status,
      detail: (data && (data.detail || data.error)) || "",
    };
    email.state.last = out;
    email.lastStatus = out;

    /* log técnico em desenvolvimento: status/erro, SEM código e
       SEM chave — segredo algum entra no console. */
    if (reason === "not-configured") {
      console.info(
        "[Nexo][DEMO] adaptador de e-mail em MODO DEMO — a API " + endpoint +
          " respondeu que nenhum provedor está conectado; nada foi enviado."
      );
    } else {
      console.error(
        "[email] envio recusado pela API → HTTP " + res.status +
          " reason=" + reason + (out.detail ? " detail=" + out.detail : "")
      );
    }

    devOutbox(msg, out);
    return out;
  };

  /* último estado lido pela tela (para o aviso honesto) */
  email.lastStatus = { sent: false, reason: "not-configured" };

  NX.email = email;

  /* =========================================================
     GOOGLE (OAuth 2.0)
     ========================================================= */
  const google = {};

  google.LOGO =
    '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">' +
    '<path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.6 2.5 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.3 13.3 17.6 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 6.9l7.2 5.6c4.2-3.9 6.6-9.6 6.6-16.4z"/>' +
    '<path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/>' +
    '<path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.6 2.2-8.7 2.2-6.4 0-11.7-3.8-13.5-9.1l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>' +
    "</svg>";

  google.clientId = function () {
    const cfg = readJSON(CFG_GOOGLE);
    if (cfg && cfg.clientId) return cfg.clientId;
    /* formato de configuração simples, se preferir */
    const plain = readJSON("nexo.google");
    if (plain && plain.clientId) return plain.clientId;
    return null;
  };

  google.configure = function (clientId) {
    try {
      localStorage.setItem(CFG_GOOGLE, JSON.stringify({ clientId: String(clientId || "") }));
      return true;
    } catch (e) {
      return false;
    }
  };

  google.isConfigured = function () {
    return !!google.clientId();
  };

  /* URL de autorização real do Google (usada quando houver client id) */
  google.authUrl = function (redirectUri, state) {
    const params = new URLSearchParams({
      client_id: google.clientId() || "",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      prompt: "select_account",
      state: state || "",
    });
    return "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
  };

  /**
   * Inicia o login com Google.
   * - configurado  → redireciona para o Google (fluxo real);
   * - não configurado → devolve {configured:false} e a interface
   *   explica o que falta, sem simular entrada.
   */
  google.begin = function (state) {
    if (!google.isConfigured()) return { configured: false };
    const redirect = location.origin + location.pathname + "#/login";
    try {
      location.assign(google.authUrl(redirect, state));
      return { configured: true, redirecting: true };
    } catch (e) {
      return { configured: true, error: e.message };
    }
  };

  /* retorno do Google: ?code= na URL → trocado no backend */
  google.pendingCode = function () {
    try {
      const url = new URL(location.href);
      return url.searchParams.get("code");
    } catch (e) {
      return null;
    }
  };

  /**
   * Perfil "de demonstração": representa o que o Google devolveria
   * após a autenticação. Marcado como simulação para a interface
   * não afirmar que houve login real do Google.
   */
  google.demoProfile = function (emailAddr, name) {
    const mail = String(emailAddr || "").trim().toLowerCase();
    const first = String(name || mail.split("@")[0] || "pessoa").trim();
    return {
      sub: "google-demo-" + mail,
      email: mail,
      email_verified: true,
      name: first,
      given_name: first,
      picture: null,
      simulated: true,
    };
  };

  NX.google = google;
})(window.NX);
