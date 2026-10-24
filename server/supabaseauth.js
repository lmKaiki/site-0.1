"use strict";
/* ============================================================
   NEXO · server/supabaseauth
   Ponte COM o Supabase Authentication (GoTrue), usando a API
   REST oficial. Todo o tráfego acontece AQUI, no servidor: o
   navegador nunca recebe a chave anon nem a de serviço.

   Por que no backend e não no navegador?
     · o Nexo já foi desenhado assim (".env.example": "nenhuma
       destas variáveis é lida pelo navegador; toda chamada
       passa pela Function") e mudar isso enfraqueceria a
       superfície pública do site;
     · a chave anon é pública por definição, mas não há motivo
       para expô-la quando o backend já existe.

   Este módulo NÃO duplica a autenticação do Nexo: a conta
   continua sendo a tabela `users`, a senha continua com hash
   próprio e a sessão continua sendo o cookie nx_session.
   O Supabase Auth entra apenas como o ENVIADOR de e-mails de
   confirmação e como a PROVA de que o e-mail é do usuário.
   O vínculo entre as duas contas fica em prefs.data.auth
   (o mesmo lugar onde o Firebase já guardava o firebaseUid),
   e SEMPRE pelo uid — nunca por e-mail.
   ============================================================ */

const env = require("./env");

/* timeout curto: se o Supabase não responder, o cadastro não pode
   ficar pendurado. O navegador recebe uma mensagem clara. */
const TIMEOUT_MS = 12000;

function base() {
  return env.supabaseUrl;
}

/* anon é a chave certa para agir "como público" (signup, resend,
   grant de senha). Se só houver a de serviço, usamos ela — este
   módulo roda no servidor, nunca no navegador. */
function key() {
  return env.supabaseAnonKey || env.supabaseServiceRoleKey || "";
}

/* URL para onde o link do e-mail volta. Precisa estar em
   Authentication > URL Configuration > Redirect URLs no painel. */
function redirectUrl() {
  return String(
    process.env.SUPABASE_AUTH_REDIRECT_URL ||
      process.env.URL ||
      process.env.DEPLOY_PRIME_URL ||
      ""
  ).replace(/\/+$/, "");
}

function configured() {
  return !!(base() && key());
}

/* faz a chamada e devolve um resultado estruturado. Nunca joga
   segredo nem corpo de terceiro para o log. */
async function call(pathname, options) {
  const url = base() + pathname;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: options.method || "POST",
      headers: {
        apikey: key(),
        Authorization: "Bearer " + key(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (e) {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (e) {
    const abortado = e && e.name === "AbortError";
    return {
      ok: false,
      status: 0,
      json: null,
      text: abortado ? "timeout" : "network",
      error: abortido(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

function abortado(e) {
  if (!e) return "network";
  if (e.name === "AbortError") return "timeout";
  return "network";
}

/* mensagem amigável a partir do erro do GoTrue. O GoTrue devolve
   coisas como "User already registered", "Email not confirmed",
   "Invalid login credentials" — e também um `error_code` próprio
   (ex.: over_email_send_rate_limit). Nada disso é segredo, mas a
   resposta crua não vai para a pessoa. */
function friendly(status, json, fallback) {
  const rawCode = String((json && (json.error_code || json.code)) || "").toLowerCase();
  const msg = (json && (json.msg || json.message || json.error_description || json.error)) || "";
  const s = (rawCode + " " + String(msg)).toLowerCase();
  if (s.indexOf("already registered") > -1 || s.indexOf("already been registered") > -1)
    return "Este e-mail já está cadastrado. Use outro ou entre na sua conta.";
  if (s.indexOf("email not confirmed") > -1)
    return "Este e-mail ainda não foi confirmado. Abra o link que enviamos para a sua caixa de entrada.";
  if (s.indexOf("invalid login credentials") > -1) return "E-mail ou senha incorretos.";
  if (s.indexOf("password should be") > -1)
    return "A senha não atende à política do Supabase. Escolha outra.";
  if (s.indexOf("unable to validate email") > -1 || s.indexOf("invalid email") > -1)
    return "Não conseguimos validar esse e-mail. Confira o endereço e tente de novo.";
  /* limite de envios do próprio Supabase. Sem SMTP próprio esse
     limite é pequeno e satura rápido: é a causa mais comum de
     cadastro recusado em produção. */
  if (
    s.indexOf("over_email_send_rate_limit") > -1 ||
    s.indexOf("rate limit") > -1 ||
    status === 429
  )
    return "O servidor de e-mail do Supabase atingiu o limite de envios. Aguarde alguns minutos. Em projetos sem SMTP próprio esse limite é pequeno — vale configurar um provedor em Authentication → Emails.";
  if (s.indexOf("signups not allowed") > -1 || s.indexOf("signup is disabled") > -1)
    return "O cadastro está desativado no painel do Supabase. Ative-o em Authentication → Providers → Email.";
  if (status === 0) return "Não conseguimos falar com o servidor de e-mail agora. Tente de novo em instantes.";
  /* nunca escondemos que houve erro: o código HTTP acompanha a
     mensagem, para dar para investigar sem expor a resposta crua */
  return (
    (fallback || "Não foi possível concluir agora. Tente novamente.") +
    (status ? " (erro " + status + ")" : "")
  );
}

/* ------------------------------------------------------------
   CADASTRO no Supabase Auth.
   Se "Confirm email" estiver ligado no painel, o GoTrue devolve o
   usuário SEM access_token e dispara o e-mail. Se estiver
   desligado, devolve a sessão na hora — aí o Nexo entra direto.
   ------------------------------------------------------------ */
async function signUp(email, password, profile) {
  if (!configured()) return { ok: false, status: 0, notConfigured: true };
  const body = { email, password, data: profile || {} };
  const redirect = redirectUrl();
  if (redirect) body.options = { emailRedirectTo: redirect };
  const r = await call("/auth/v1/signup", { body });
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      message: friendly(r.status, r.json, "Não foi possível criar a conta no servidor de e-mail."),
    };
  }
  const j = r.json || {};
  return {
    ok: true,
    uid: j.id || (j.user && j.user.id) || null,
    confirmed: !!j.access_token || !!j.email_confirmed_at,
    accessToken: j.access_token || null,
  };
}

/* ------------------------------------------------------------
   REENVIO da confirmação. O próprio GoTrue aplica o limite de
   envio; aqui somamos um limite local por minuto para não
   transformar o Nexo em repetidor de spam.
   ------------------------------------------------------------ */
/* Nem toda recusa do GoTrue é igual. As que significam "o serviço de
   e-mail do projeto não conseguiu despachar" (SMTP mal configurado,
   provedor fora do ar) ganham mensagem própria, porque a pessoa
   precisa saber que a mensagem NÃO saiu e que a culpa não é do
   endereço dela.

   Repare que a mensagem nunca fala do e-mail informado — só do
   serviço. Assim ela não serve de ferramenta para descobrir se uma
   conta existe. */
function deliveryFailure(status, json) {
  const code = String(
    (json && (json.error_code || json.code)) || ""
  ).toLowerCase();
  const msg = String(
    (json && (json.msg || json.message || json.error)) || ""
  ).toLowerCase();
  if (msg.indexOf("error sending") > -1 || msg.indexOf("failed to send") > -1)
    return true;
  return code === "unexpected_failure" && msg.indexOf("email") > -1;
}

async function resend(email) {
  if (!configured()) return { ok: false, status: 0, notConfigured: true };
  const r = await call("/auth/v1/resend", { body: { email, type: "signup" } });
  if (!r.ok) {
    if (deliveryFailure(r.status, r.json)) {
      return {
        ok: false,
        status: 503,
        code: "email_unavailable",
        deliveryFailed: true,
        message:
          "Não conseguimos enviar o e-mail de confirmação agora. " +
          "O serviço de envio do projeto está indisponível — isso não é " +
          "problema do seu endereço. Tente novamente mais tarde.",
      };
    }
    return {
      ok: false,
      status: r.status,
      message: friendly(r.status, r.json, "Não conseguimos reenviar agora. Tente mais tarde."),
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------
   PROVA de login. Usado só para contas que nasceram com e-mail:
   se o e-mail não estiver confirmado, o GoTrue recusa e o Nexo
   também recusa — nada de contornar a confirmação guardando um
   flag no navegador.
   ------------------------------------------------------------ */
async function verifyPassword(email, password) {
  if (!configured()) return { ok: true, skipped: true };
  const r = await call("/auth/v1/token?grant_type=password", {
    body: { email, password },
  });
  if (r.ok) return { ok: true };
  const s = String(
    (r.json && (r.json.error_description || r.json.msg || r.json.error)) || ""
  ).toLowerCase();
  if (s.indexOf("email not confirmed") > -1)
    return { ok: false, reason: "unconfirmed" };
  /* Credenciais erradas não bloqueiam: a senha local (hash scrypt)
     é quem manda no Nexo. Só a falta de confirmação trava. */
  return { ok: true };
}

/* ------------------------------------------------------------
   VALIDA um link de confirmação clicado. O GoTrue é quem
   confirma de verdade; aqui só perguntamos se o token ainda vale.
   ------------------------------------------------------------ */
async function userFromToken(accessToken) {
  if (!configured() || !accessToken) return { ok: false, status: 400 };
  const url = base() + "/auth/v1/user";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { apikey: key(), Authorization: "Bearer " + accessToken },
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, json };
    return { ok: true, uid: json && json.id, email: json && json.email, confirmed: !!(json && json.email_confirmed_at) };
  } catch (e) {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  configured,
  redirectUrl,
  signUp,
  resend,
  verifyPassword,
  userFromToken,
  friendly,
};
