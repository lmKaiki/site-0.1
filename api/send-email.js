/**
 * NEXO · API de envio de e-mail (function serverless)
 * ============================================================
 *   FRONTEND  →  ESTA API  →  PROVEDOR  →  GMAIL DO USUÁRIO
 *
 * O navegador manda apenas { to, name, purpose, code }.
 * Aqui (e só aqui) ficam as credenciais, montados o assunto e o
 * corpo do e-mail, e a chamada ao provedor.
 *
 * NUNCA faça destas coisas:
 *   - expor EMAIL_PROVIDER_API_KEY no frontend;
 *   - imprimir `code` (ou a mensagem completa) em log;
 *   - devolver o código na resposta.
 *
 * Variáveis de ambiente (Vercel → Settings → Environment Variables):
 *   EMAIL_PROVIDER        resend (padrão) | brevo
 *   EMAIL_PROVIDER_API_KEY  chave privada do provedor
 *   EMAIL_FROM            remetente verificado, ex.: "codigo@seudominio.com"
 *   EMAIL_FROM_NAME       remetente exibido (padrão "Segurança da Nexo")
 *   EMAIL_REPLY_TO        opcional
 *
 * ENTREGABILIDADE (SPF / DKIM / DMARC) — ver docs/EMAIL.md:
 *   - domínio verificado no provedor (Resend → Domains → DNS);
 *   - SPF/DKIM/DMARC publicados no DNS DO REMETENTE;
 *   - remetente sempre no domínio autenticado (nunca gmail.com);
 *   - sem links, sem imagens externas e sem rastreamento.
 *
 * O QUE ESTA API GARANTE:
 *   aceite ou recusa PELO PROVEDOR. A entrega na caixa de entrada
 *   (Inbox, Spam, Promoções) é decisão do Gmail — nunca prometemos
 *   isso na interface nem aqui.
 *
 * Respostas:
 *   200 { ok:true, accepted:true }             ACEITO pelo provedor
 *   400 { ok:false, reason:"invalid" }         payload inválido
 *   429 { ok:false, reason:"rate-limit" }      excesso de envios
 *   501 { ok:false, reason:"not-configured" }  sem credenciais
 *   502 { ok:false, reason:"provider-error" }  provedor recusou
 */

const RECIPIENT_LIMIT = 4;
const RECIPIENT_WINDOW_MS = 15 * 60 * 1000;

/* janela por instância da function (melhor esforço; o limite real
   de abuso é o do provedor + o do frontend) */
const hits = new Map();

function rateOk(email) {
  const now = Date.now();
  const rec = hits.get(email);
  if (!rec || now - rec.first > RECIPIENT_WINDOW_MS) {
    hits.set(email, { first: now, count: 1 });
    return true;
  }
  rec.count += 1;
  return rec.count <= RECIPIENT_LIMIT;
}

function mask(email) {
  const [user, domain] = String(email).split("@");
  if (!domain) return "***";
  return (user.slice(0, 2) + "***@" + domain).slice(0, 40);
}

function isValidEmail(v) {
  return /^[^\s@,;:<>()[\]\\"]+@[^\s@,;:<>()[\]\\"]+\.[a-z]{2,}$/i.test(String(v || "").trim());
}

function subjectFor(purpose) {
  return purpose === "verify" ? "Seu código de verificação" : "Seu código de recuperação";
}

/* remetente exibido: identidade autenticada, não um endereço genérico */
function fromName() {
  const n = String(process.env.EMAIL_FROM_NAME || "").trim();
  return n || "Segurança da Nexo";
}

function textBody({ name, code, purpose }) {
  const nome = String(name || "").trim() || "usuário";
  const platform = "NEXO";
  if (purpose === "verify") {
    return (
      "Olá, " + nome + ".\n\n" +
      "Recebemos uma solicitação para verificar o seu e-mail no " + platform + ".\n\n" +
      "Seu código de verificação é:\n\n" + code + "\n\n" +
      "Esse código expira em alguns minutos.\n\n" +
      "Se você não solicitou isso, ignore este e-mail.\n\n" +
      "Atenciosamente,\n" + platform
    );
  }
  return (
    "Olá, " + nome + ".\n\n" +
    "Recebemos uma solicitação para recuperar sua conta.\n\n" +
    "Seu código de verificação é:\n\n" + code + "\n\n" +
    "Esse código expira em alguns minutos.\n\n" +
    "Se você não solicitou essa recuperação, ignore este e-mail.\n\n" +
    "Atenciosamente,\n" + platform
  );
}

function htmlBody(text, senderLabel) {
  return (
    '<div style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;' +
    'margin:0 auto;padding:28px 22px;color:#12211e;line-height:1.6">' +
    '<div style="font-size:20px;font-weight:700;color:#0b9e75;margin-bottom:18px">' +
    escapeHtml(senderLabel || "Nexo") +
    "</div>" +
    "<p>" +
    text
      .split("\n\n")
      .map((p) =>
        p === code_paragraph(p)
          ? '<div style="font-family:ui-monospace,Consolas,monospace;font-size:30px;letter-spacing:.22em;' +
            'font-weight:700;text-align:center;background:#eef3f2;border:1px dashed rgba(11,158,117,.45);' +
            'border-radius:12px;padding:16px 10px;margin:14px 0">' +
            p.replace(/\s+/g, "") +
            "</div>"
          : "<span>" + escapeHtml(p).replace(/\n/g, "<br>") + "</span>"
      )
      .join("</p><p>") +
    "</p></div>"
  );
}

/* o parágrafo que contém só o código de 6 dígitos */
function code_paragraph(p) {
  return /^\s*\d{6}\s*$/.test(p) ? p : null;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sendViaResend(key, payload) {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function sendViaBrevo(key, payload) {
  return fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { email: payload.from.email, name: payload.from.name },
      to: payload.to.map((e) => ({ email: e })),
      subject: payload.subject,
      textContent: payload.text,
      htmlContent: payload.html,
    }),
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, reason: "method-not-allowed" });
    return;
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const to = String(body.to || "").trim().toLowerCase();
  const name = String(body.name || "").slice(0, 64);
  const purpose = body.purpose === "verify" ? "verify" : "recover";
  const code = String(body.code || "").trim();

  if (!isValidEmail(to) || !/^\d{6}$/.test(code)) {
    /* log técnico sem segredo: nunca imprimimos o código */
    console.error("[email] payload inválido (to=" + mask(to) + ")");
    res.status(400).json({ ok: false, reason: "invalid" });
    return;
  }

  if (!rateOk(to)) {
    console.error("[email] limite de envios atingido para " + mask(to));
    res.status(429).json({ ok: false, reason: "rate-limit" });
    return;
  }

  const provider = (process.env.EMAIL_PROVIDER || "resend").toLowerCase();
  const key = process.env.EMAIL_PROVIDER_API_KEY;
  const from = process.env.EMAIL_FROM || "onboarding@resend.dev";
  const label = fromName();

  if (!key) {
    /* sem credencial: dizemos a verdade e não fingimos envio */
    console.error(
      "[email] EMAIL_PROVIDER_API_KEY ausente — nenhum e-mail enviado (provider=" + provider + ")"
    );
    res.status(501).json({ ok: false, reason: "not-configured" });
    return;
  }

  const fromParsed = parseFrom(from, label);
  const text = textBody({ name, code, purpose });
  const payload = {
    from: fromParsed,
    to: [to],
    subject: subjectFor(purpose),
    text: text,
    html: htmlBody(text, label),
    /* sem links e sem rastreamento: melhor para passar pelo Spam */
    headers: { "X-Nexo-Purpose": purpose },
  };
  if (process.env.EMAIL_REPLY_TO) payload.reply_to = process.env.EMAIL_REPLY_TO;

  try {
    const resp =
      provider === "brevo" ? await sendViaBrevo(key, payload) : await sendViaResend(key, payload);

    if (!resp.ok) {
      const detail = await safeText(resp);
      /* log técnico: status + detalhe do provedor, sem chave e sem código */
      console.error("[email] provedor recusou → HTTP " + resp.status + " " + detail);
      res.status(502).json({ ok: false, reason: "provider-error", detail: detail.slice(0, 200) });
      return;
    }

    console.log(
      "[email] provedor ACEITOU envio para " + mask(to) + " via " + provider +
        " (entrega é responsabilidade do provedor/Gmail)"
    );
    /* accepted = aceite do provedor. NÃO significa entregue na caixa. */
    res.status(200).json({ ok: true, accepted: true });
  } catch (e) {
    console.error("[email] falha ao falar com o provedor:", e.message);
    res.status(502).json({ ok: false, reason: "provider-error", detail: String(e.message).slice(0, 200) });
  }
};

function parseFrom(from, fallbackName) {
  const m = /^"?([^"<]+)"?\s*<([^>]+)>$/.exec(String(from).trim());
  if (m) return { name: m[1].trim() || fallbackName || "Nexo", email: m[2].trim() };
  /* sem nome no EMAIL_FROM → usa a identidade autenticada padrão */
  return { name: fallbackName || "Nexo", email: String(from).trim() };
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}

async function safeText(resp) {
  try {
    return (await resp.text()).replace(/\s+/g, " ").trim();
  } catch (e) {
    return "";
  }
}
