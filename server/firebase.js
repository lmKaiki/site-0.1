"use strict";
/* ============================================================
   NEXO · server/firebase
   Verificação do ID token do Firebase Authentication no SERVIDOR.

   O navegador só entrega o token; quem decide se ele é verdadeiro
   é aqui, com a chave pública do Google (RS256). Nenhum segredo do
   Firebase é necessário: os certs são públicos por definição.

   Nada de dependência nova: Node >= 18 traz `fetch`, X509Certificate
   e crypto.verify — os mesmos caminhos usados pelo scrypt da sessão.

   O Supabase continua sendo o BANCO: o Firebase só prova identidade
   (quem é o dono do e-mail/Google), a conta Nexo segue nas mesmas
   tabelas de sempre, com a mesma RLS e as mesmas permissões.
   ============================================================ */

const crypto = require("crypto");
const env = require("./env");
const { ApiError } = require("./errors");

const CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const CERT_TTL = 6 * 60 * 60 * 1000; /* Google rota as chaves: 6h é folgado */
const CLOCK_SKEW = 60 * 1000;

let certCache = { at: 0, keys: null };
/* injeta certs em testes (só testes usam; produção nunca chama) */
let testCertStore = null;

function projectId() {
  return String(env.firebaseProjectId || "").trim();
}

function configured() {
  return !!projectId();
}

/* certs públicos do Google, com cache em memória (warm start repete) */
async function certs() {
  if (testCertStore) return testCertStore;
  if (certCache.keys && Date.now() - certCache.at < CERT_TTL) return certCache.keys;
  let res;
  try {
    res = await fetch(CERTS_URL, { headers: { accept: "application/json" } });
  } catch (e) {
    throw new ApiError(
      502,
      "Não foi possível consultar as chaves públicas do Firebase. Tente novamente em instantes.",
      "firebase_network"
    );
  }
  if (!res.ok) {
    throw new ApiError(
      502,
      "Firebase indisponível no momento. Tente novamente em instantes.",
      "firebase_network"
    );
  }
  const json = await res.json();
  certCache = { at: Date.now(), keys: json };
  return json;
}

function b64urlDecode(part) {
  const s = String(part).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64");
}

function tokenError(msg, code) {
  return new ApiError(401, msg, code || "firebase_token");
}

/* Valida o ID token e devolve a identidade CONFIAVEL extraída dele.
   Todo campo vem do payload assinado — o navegador nunca envia
   uid/e-mail como palavra, só o token que o Google assinou.
   `testCerts` existe só para os testes automatizados: injeta as
   chaves públicas sem bater no Google (produção nunca passa isso). */
async function verifyIdToken(idToken, testCerts) {
  const pid = projectId();
  if (!pid) {
    throw new ApiError(
      503,
      "Login com Firebase não está configurado no servidor (FIREBASE_PROJECT_ID ausente).",
      "firebase_config"
    );
  }

  const token = String(idToken || "").trim();
  if (!token) throw tokenError("Sessão do Firebase ausente. Entre novamente.");
  const parts = token.split(".");
  if (parts.length !== 3) throw tokenError("Sessão do Firebase inválida.");

  let header;
  let payload;
  try {
    header = JSON.parse(b64urlDecode(parts[0]).toString("utf8"));
    payload = JSON.parse(b64urlDecode(parts[1]).toString("utf8"));
  } catch (e) {
    throw tokenError("Sessão do Firebase inválida.");
  }
  if (!header || header.alg !== "RS256" || !header.kid)
    throw tokenError("Sessão do Firebase inválida.");

  const store = testCerts || (await certs());
  const pem = store[header.kid];
  if (!pem) throw tokenError("Sessão do Firebase expirada. Entre novamente.");

  const signed = Buffer.from(parts[0] + "." + parts[1]);
  let ok = false;
  try {
    /* PEM pode vir como certificado X.509 (Google) ou chave pública
       direta (testes) — os dois são aceitos aqui */
    let key;
    try {
      key = new crypto.X509Certificate(pem).publicKey;
    } catch (e) {
      key = crypto.createPublicKey(pem);
    }
    ok = crypto.verify(
      "RSA-SHA256",
      signed,
      key,
      b64urlDecode(parts[2])
    );
  } catch (e) {
    ok = false;
  }
  if (!ok) throw tokenError("Sessão do Firebase inválida.");

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= nowSec - CLOCK_SKEW / 1000)
    throw tokenError("Sessão do Firebase expirada. Entre novamente.");
  if (payload.iss !== "https://securetoken.google.com/" + pid)
    throw tokenError("Sessão do Firebase inválida.");
  if (payload.aud !== pid) throw tokenError("Sessão do Firebase inválida.");
  const sub = String(payload.sub || "");
  if (!sub || sub.length > 128) throw tokenError("Sessão do Firebase inválida.");

  const provider =
    (payload.firebase && payload.firebase.sign_in_provider) || null;

  return {
    uid: sub,
    email: payload.email ? String(payload.email) : null,
    emailVerified: payload.email_verified === true,
    name: payload.name ? String(payload.name).slice(0, 64) : null,
    picture: payload.picture ? String(payload.picture).slice(0, 2048) : null,
    provider: provider,
  };
}

module.exports = {
  configured,
  projectId,
  verifyIdToken,
  /* teste only: troca a fonte de certs (produção usa os do Google) */
  _setTestCerts(store) {
    testCertStore = store || null;
  },
};
