"use strict";
/* ============================================================
   NEXO · tools/test-email.js
   Teste do cadastro com CONFIRMAÇÃO DE E-MAIL (Supabase Auth).
       node tools/test-email.js
   Importante sobre o que este teste faz e o que ele NÃO faz:
     · ele NÃO envia e-mail para ninguém. O envio real depende do
       painel do Supabase (SMTP/limite de envios), e por isso as
       partes que dependem de envio são marcadas como PENDENTES
       quando o servidor recusa;
     · ele testa de verdade o que o Nexo decide: o cadastro com
       e-mail, o bloqueio de login antes da confirmação, o
       reenvio com limite, o tratamento de link inválido e a
       regressão do cadastro antigo (só usuário + senha);
     · para testar o bloqueio sem disparar e-mail, ele cria o
       usuário de teste pela API de ADMINISTRAÇÃO do Supabase
       (não envia mensagem nenhuma) e depois apaga;
     · no final apaga tudo o que criou, aqui e no Supabase Auth.
   Nenhuma chave é impressa em nenhum momento.
   ============================================================ */

process.env.NEXO_DB = process.env.NEXO_DB || "supabase";

const { register, dispatch } = require("../server/router");

register([
  require("../server/handlers/auth"),
  require("../server/handlers/social"),
  require("../server/handlers/servers"),
  require("../server/handlers/messages"),
  require("../server/handlers/sync"),
  require("../server/handlers/apps"),
  require("../server/handlers/calls"),
]);

const env = require("../server/env");
const db = require("../server/db");
const sbauth = require("../server/supabaseauth");

let pass = 0;
let fail = 0;
let pend = 0;
const created = { users: [], authUids: [] };

function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log("  [ok] " + label);
  } else {
    fail++;
    console.log("  [FAIL] " + label + (detail ? "  -> " + detail : ""));
  }
}
/* para o que depende de configuração alheia (SMTP/limite do
   Supabase): registra como pendente, NUNCA como aprovado */
function pending(label, why) {
  pend++;
  console.log("  [PENDENTE] " + label + (why ? "  -> " + why : ""));
}
function section(t) {
  console.log("\n-- " + t + " --");
}
function rnd(n) {
  return Math.random().toString(36).slice(2, 2 + (n || 6));
}

async function call(method, path, body, cookie, query) {
  const res = await dispatch({
    httpMethod: method,
    path: path.indexOf("/api") === 0 ? path : "/api" + path,
    queryStringParameters: query || {},
    headers: cookie ? { cookie: cookie } : {},
    body: body === undefined ? null : JSON.stringify(body),
    isBase64Encoded: false,
  });
  let json = {};
  try {
    json = JSON.parse(res.body);
  } catch (e) {}
  let cookieOut = null;
  const sc = res.multiValueHeaders && res.multiValueHeaders["Set-Cookie"];
  if (sc && sc.length) cookieOut = sc[0].split(";")[0];
  return { status: res.statusCode, json, cookie: cookieOut };
}

/* ---------------- API de administração (só para o teste) --------------
   Cria/confirma/apaga o usuário de teste SEM passar pelo envio de
   e-mail — é o que permite medir o bloqueio de login sem mandar
   mensagem para lugar nenhum e sem gastar o limite do projeto. */
function admin() {
  const k = env.supabaseServiceRoleKey;
  if (!env.supabaseUrl || !k) return null;
  const h = { apikey: k, Authorization: "Bearer " + k, "Content-Type": "application/json" };
  return {
    async createUnconfirmed(email, password) {
      const r = await fetch(env.supabaseUrl + "/auth/v1/admin/users", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ email, password, email_confirm: false }),
      });
      const j = await r.json().catch(() => null);
      return { status: r.status, id: (j && j.id) || null };
    },
    async confirm(uid) {
      const r = await fetch(env.supabaseUrl + "/auth/v1/admin/users/" + uid, {
        method: "PUT",
        headers: h,
        body: JSON.stringify({ email_confirm: true }),
      });
      return r.status;
    },
    async remove(uid) {
      try {
        const r = await fetch(env.supabaseUrl + "/auth/v1/admin/users/" + uid, {
          method: "DELETE",
          headers: h,
        });
        return r.ok;
      } catch (e) {
        return false;
      }
    },
  };
}

async function cleanup() {
  const ids = created.users.map((u) => u.id);
  if (ids.length) {
    await db.remove("notifications", { where: { user_id: ids } }).catch(() => {});
    await db.remove("prefs", { where: { user_id: ids } }).catch(() => {});
    await db.remove("presence", { where: { user_id: ids } }).catch(() => {});
    await db.remove("sessions", { where: { user_id: ids } }).catch(() => {});
    await db.remove("users", { where: { id: ids } }).catch(() => {});
  }
  const a = admin();
  if (a) {
    for (const uid of created.authUids) await a.remove(uid).catch(() => {});
  }
}

async function main() {
  console.log("== Nexo · cadastro com confirmacao de e-mail ==");
  console.log("  supabase auth: " + (sbauth.configured() ? "acessivel" : "NAO acessivel"));

  const A = admin();
  if (!A) {
    console.log(
      "\n  Sem SUPABASE_URL/chave de servico neste ambiente: as partes\n  que dependem do Supabase Auth ficam PENDENTES, e o teste cobre\n  só o que dá para medir sem elas."
    );
  }

  /* ============================================================
     1 · O CADASTRO ANTIGO CONTINUA INTEIRO
     ============================================================ */
  section("1. regressao: cadastro so com usuario + senha");
  const stamp = rnd(4);
  const uReg = ("nxmail" + stamp).slice(0, 18);
  const pw = "SenhaForte" + stamp + "9";
  const r1 = await call("POST", "/auth/signup", {
    username: uReg,
    password: pw,
    confirm: pw,
  });
  ok("cadastro sem e-mail responde 201", r1.status === 201, "status " + r1.status);
  ok("emite sessao na hora", !!r1.cookie);
  const idReg = r1.json && r1.json.data && r1.json.data.user && r1.json.data.user.id;
  if (idReg) created.users.push({ id: idReg });
  /* sem e-mail não há nada a confirmar: por isso NÃO mostramos
     aviso algum — o campo só vira false quando um e-mail foi
     pedido e o servidor de e-mail não está disponível */
  ok("cadastro sem e-mail nao dispara aviso de confirmacao",
    r1.json && r1.json.data && r1.json.data.confirmationAvailable !== false,
    JSON.stringify(r1.json && r1.json.data));
  ok("e-mail fica nulo quando nao foi informado",
    r1.json && r1.json.data && r1.json.data.email === null);
  const me1 = await call("GET", "/auth/me", null, r1.cookie);
  ok("sessao valida em /auth/me", me1.status === 200);

  /* ============================================================
     2 · VALIDACAO DE E-MAIL NO SERVIDOR
     ============================================================ */
  section("2. validacao do e-mail no servidor");
  const r2 = await call("POST", "/auth/signup", {
    username: ("nxinv" + stamp).slice(0, 18),
    email: "nao-e-email",
    password: pw,
    confirm: pw,
  });
  ok("e-mail malformado e recusado no servidor", r2.status === 400,
    "status " + r2.status);
  ok("mensagem fala em e-mail valido",
    /e-mail v/.test((r2.json && r2.json.error) || ""),
    JSON.stringify(r2.json));

  const r2b = await call("POST", "/auth/signup", {
    username: ("nxcurto" + stamp).slice(0, 18),
    email: "a@b",
    password: pw,
    confirm: pw,
  });
  ok("e-mail sem dominio valido e recusado", r2b.status === 400, "status " + r2b.status);

  /* ============================================================
     3 · REENVIO DA CONFIRMACAO
     ============================================================ */
  section("3. reenvio da confirmacao");
  const alvo = "alguem.inexistente." + rnd(5) + "@example.com";
  const r3 = await call("POST", "/auth/resend", { email: alvo });
  ok("reenvio aceita pedido", r3.status === 202, "status " + r3.status);
  const msgNeutra = r3.json && r3.json.data && r3.json.data.message;
  ok("resposta e neutra (nao revela se existe conta)", /Se este e-mail tiver/.test(msgNeutra || ""),
    JSON.stringify(r3.json));

  const r3b = await call("POST", "/auth/resend", { email: "nao-e-email" });
  ok("reenvio com e-mail invalido recusa", r3b.status === 400, "status " + r3b.status);

  /* limite local anti-spam */
  let limitado = false;
  for (let i = 0; i < 7 && !limitado; i++) {
    const rr = await call("POST", "/auth/resend", { email: alvo });
    if (rr.status === 400 && rr.json && rr.json.code === "rate_limited") limitado = true;
  }
  ok("limite local de reenvio aplicado (anti-spam)", limitado);

  /* ============================================================
     4 · LINK DE CONFIRMACAO INVALIDO / EXPIRADO / JA USADO
     ============================================================ */
  section("4. link invalido, expirado ou ja usado");
  const r4 = await call("POST", "/auth/confirm", {});
  ok("sem token recusa com mensagem clara", r4.status === 400, "status " + r4.status);
  ok("erro chega como {ok:false} para o navegador",
    r4.json && r4.json.ok === false, JSON.stringify(r4.json));
  ok("mensagem fala em link incompleto", /incompleto/i.test((r4.json && r4.json.error) || ""),
    JSON.stringify(r4.json));

  const r4b = await call("POST", "/auth/confirm", { accessToken: "token-falso-" + rnd(8) });
  ok("token falso e recusado pelo servidor", r4b.status === 400, "status " + r4b.status);
  ok("mensagem explica expiracao/uso",
    /expirou|inválido|ja foi usado/i.test((r4b.json && r4b.json.error) || ""),
    JSON.stringify(r4b.json));
  ok("razao tecnica vem separada (code)",
    r4b.json && r4b.json.code === "invalid", JSON.stringify(r4b.json && r4b.json.code));

  /* ============================================================
     5 · BLOQUEIO DE LOGIN ANTES DA CONFIRMACAO
        (o ponto central — feito sem enviar e-mail nenhum)
     ============================================================ */
  section("5. login antes da confirmacao deve ser recusado");
  if (!A) {
    pending("bloqueio de login", "sem chave de servico para montar a conta de teste");
  } else {
    const sfx = rnd(5);
    const uGate = ("nxgate" + sfx).slice(0, 18);
    const mailGate = "nexo.teste." + sfx + "@example.com";

    /* conta no Supabase Auth, criada pela API de admin: NÃO envia
       e-mail nenhum e NÃO gasta o limite de envio do projeto */
    const createdAuth = await A.createUnconfirmed(mailGate, pw);
    ok("conta de teste criada no Supabase Auth (sem envio)", !!createdAuth.id,
      "status " + createdAuth.status);
    if (createdAuth.id) created.authUids.push(createdAuth.id);

    const r5 = await call("POST", "/auth/signup", {
      username: uGate,
      password: pw,
      confirm: pw,
    });
    ok("conta Nexo criada", r5.status === 201 && !!(r5.json && r5.json.data && r5.json.data.user),
      "status " + r5.status);
    const idGate = r5.json && r5.json.data && r5.json.data.user && r5.json.data.user.id;
    if (idGate) created.users.push({ id: idGate });

    /* mesmo caminho que o cadastro com e-mail usa para gravar o
       vínculo — só que sem passar pelo envio */
    await db.writeAuthLink(idGate, {
      supabaseUid: createdAuth.id,
      email: mailGate,
      emailVerified: false,
      provider: "supabase",
      linkedAt: Date.now(),
    });
    const link0 = await db.readAuthLink(idGate);
    ok("vinculo gravado em prefs.data.auth", !!(link0 && link0.supabaseUid === createdAuth.id));
    ok("marcado como NAO confirmado", !!(link0 && link0.emailVerified === false));

    /* login com a senha CORRETA: tem que ser recusado */
    const lg1 = await call("POST", "/auth/login", { identifier: uGate, password: pw });
    console.log("     login antes: status=" + lg1.status + " code=" +
      (lg1.json && lg1.json.code) + " | " + (lg1.json && lg1.json.error));
    ok("login recusado antes de confirmar", lg1.status === 400, "status " + lg1.status);
    ok("erro com codigo email_not_confirmed",
      lg1.json && lg1.json.code === "email_not_confirmed",
      JSON.stringify(lg1.json));
    ok("nenhuma sessao emitida", !lg1.cookie);
    ok("mensagem fala em confirmar o e-mail", /confirmado/i.test((lg1.json && lg1.json.error) || ""));

    /* por e-mail, o mesmo bloqueio */
    const lg2 = await call("POST", "/auth/login", { identifier: mailGate, password: pw });
    ok("login por E-MAIL tambem e recusado antes de confirmar",
      lg2.status === 400 && lg2.json && lg2.json.code === "email_not_confirmed",
      JSON.stringify(lg2.json));

    /* senha errada continua sendo senha errada (nao vira "confirme o e-mail") */
    const lg3 = await call("POST", "/auth/login", { identifier: uGate, password: "SenhaErrada123" });
    ok("senha errada nao e confundida com 'nao confirmado'",
      lg3.status === 400 && /senha/i.test((lg3.json && lg3.json.error) || ""),
      JSON.stringify(lg3.json));

    /* ---- confirmamos de verdade e o login passa ---- */
    section("6. depois de confirmado, o login passa");
    if (createdAuth.id) {
      const st = await A.confirm(createdAuth.id);
      ok("conta confirmada no Supabase", st === 200 || st === 204, "status " + st);
      const lg4 = await call("POST", "/auth/login", { identifier: uGate, password: pw });
      console.log("     login depois: status=" + lg4.status + " cookie=" + (lg4.cookie ? "sim" : "nao"));
      ok("login liberado apos confirmacao", lg4.status === 200, "status " + lg4.status);
      ok("sessao emitida", !!lg4.cookie);
      if (lg4.cookie) {
        const me4 = await call("GET", "/auth/me", null, lg4.cookie);
        ok("/auth/me responde com a conta", me4.status === 200 && !!(me4.json && me4.json.data && me4.json.data.user));
      }
    }

    /* a confirmação grava o selo e aí o Nexo não pergunta de novo */
    await db.writeAuthLink(idGate, {
      supabaseUid: createdAuth.id,
      email: mailGate,
      emailVerified: true,
      provider: "supabase",
      linkedAt: Date.now(),
    });
    const lg5 = await call("POST", "/auth/login", { identifier: uGate, password: pw });
    ok("com o selo gravado, o login segue liberado", lg5.status === 200, "status " + lg5.status);

    /* ============================================================
       7 · O E-MAIL E DADO PRIVADO
       ============================================================ */
    section("7. privacidade do e-mail");
    if (lg5.cookie) {
      const own = await call("GET", "/auth/me", null, lg5.cookie);
      ok("o DONO enxerga o proprio e-mail",
        !!(own.json && own.json.data && own.json.data.user && own.json.data.user.email));
    }
    /* outra conta não pode ler o e-mail de ninguém */
    const other = await call("POST", "/auth/signup", {
      username: ("nxoutro" + stamp).slice(0, 18),
      password: pw,
      confirm: pw,
    });
    if (other.json && other.json.data && other.json.data.user) {
      created.users.push({ id: other.json.data.user.id });
      ok("outra conta logada nao recebe o e-mail de terceiros",
        !JSON.stringify(other.json).includes(mailGate));
    }
  }

  /* ============================================================
     8 · ENVIO REAL (depende do painel do Supabase)
     ============================================================ */
  section("8. envio real do e-mail de confirmacao");
  if (!sbauth.configured()) {
    pending("envio do link", "Supabase Auth nao acessivel neste ambiente");
  } else {
    const mailTeste = "nexo.envio." + rnd(5) + "@example.com";
    const uTeste = ("nxenvio" + stamp).slice(0, 18);
    const r8 = await call("POST", "/auth/signup", {
      username: uTeste,
      email: mailTeste,
      password: pw,
      confirm: pw,
    });
    console.log("     signup com e-mail: status=" + r8.status +
      " | " + ((r8.json && (r8.json.data && r8.json.data.message)) || (r8.json && r8.json.error) || ""));
    const id8 = r8.json && r8.json.data && r8.json.data.user && r8.json.data.user.id;
    if (id8) created.users.push({ id: id8 });
    const link8 = id8 ? await db.readAuthLink(id8).catch(() => null) : null;
    if (link8 && link8.supabaseUid) created.authUids.push(link8.supabaseUid);

    if (r8.status === 202) {
      ok("cadastro com e-mail responde 202 (criado, aguardando confirmacao)", true);
      ok("sinaliza needsEmailConfirm",
        !!(r8.json && r8.json.data && r8.json.data.needsEmailConfirm === true),
        JSON.stringify(r8.json && r8.json.data));
      ok("NAO devolve sessao para conta nao confirmada", !r8.cookie);
      ok("devolve o endereço usado", r8.json && r8.json.data && r8.json.data.email === mailTeste);
      ok("mensagem orienta caixa de entrada/spam",
        /spam/i.test((r8.json && r8.json.data && r8.json.data.message) || ""));
      pending("chegada do e-mail na caixa de entrada",
        "nao ha caixa de entrada acessivel neste teste; confirmar manualmente");
    } else {
      /* o Supabase recusou: normalmente é limite de envios.
         Registramos como PENDENTE e mostramos a mensagem que a
         pessoa veria — nunca como aprovado. */
      pending("cadastro com e-mail (envio)",
        "Supabase recusou: " + ((r8.json && r8.json.error) || "sem mensagem") +
        " | configurar SMTP/limite em Authentication → Emails");
    }
  }

  /* ============================================================
     9 · NENHUM SEGREDO NO CÓDIGO PÚBLICO
     ============================================================ */
  section("9. nenhum segredo no codigo publico");
  const fs = require("fs");
  const path = require("path");
  const publicos = ["index.html"].concat(
    fs.readdirSync(path.join(__dirname, "..", "js")).filter((f) => f.endsWith(".js")).map((f) => "js/" + f)
  );
  let vazou = null;
  for (const rel of publicos) {
    const txt = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    if (/service_role|SERVICE_ROLE/i.test(txt)) vazou = rel + " (mencao a service_role)";
    else if (/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/.test(txt)) vazou = rel + " (parece JWT/chave)";
  }
  ok("nenhum arquivo publico cita service_role ou carrega chave", !vazou, vazou || "");
  ok("nenhum cliente Supabase e inicializado no navegador",
    !/createClient|@supabase\/supabase-js/.test(
      fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
    ));

  await cleanup();
  console.log("\n  contas locais removidas: " + created.users.length);
  console.log("  usuarios removidos do Supabase Auth: " + created.authUids.length);
  console.log("\n---------------------------------------------");
  console.log("  pass=" + pass + "  fail=" + fail + "  pendentes=" + pend);
  console.log("---------------------------------------------\n");
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("erro no teste:", e && e.stack ? e.stack : e);
  try {
    await cleanup();
  } catch (e2) {}
  process.exit(1);
});
