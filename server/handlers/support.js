"use strict";
/* ============================================================
   NEXO · server/handlers/support
   Chamados de suporte da página pública #/suporte.

   Regras do sistema:
   · a página é pública, mas o FORMULÁRIO exige sessão: sem
     autenticidade não há como a equipe devolver a resposta, e
     o chamado sem autor não tem dono;
   · toda validação acontece AQUI, no backend — a interface só
     espelha as mensagens, nunca é a única barreira;
   · a tabela é NOVA (migração 0002, ainda não aplicada). Enquanto
     ela não existir, a operação responde 503 "schema_pending" e o
     formulário mostra esse estado — nada de fingir que o chamado
     foi enviado;
   · leitura restrita ao autor, conferida no backend: uma pessoa
     não enxerga chamados de outra, mesmo se chamar a API direto;
   · limite de abertura por janela de tempo, contado no banco
     (não no navegador) — cliques repetidos não viram spam.
   ============================================================ */

const db = require("../db");
const auth = require("../auth");
const map = require("../map");
const { ApiError, bad } = require("../errors");

/* espelho FECHADO das categorias do formulário: o valor vem do
   backend, não da interface — um campo adulterado é recusado. */
const CATEGORIES = ["login", "email", "social", "call", "bug"];
const SUBJECT_MIN = 3;
const SUBJECT_MAX = 120;
const DESC_MIN = 20;
const DESC_MAX = 4000;
const MAX_TICKETS_PER_USER = 500;

/* anti-spam: janela curta, poucos chamados dentro dela */
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 3;

const TABLE = "support_tickets";

function now() {
  return Date.now();
}

function msOf(v) {
  if (typeof v === "number" && isFinite(v)) return v;
  const t = Date.parse(String(v || ""));
  return isNaN(t) ? 0 : t;
}

/* A tabela ainda não existe enquanto a migração 0002 não for
   aplicada. `db.assertWritable` só cobre coluna faltando em
   tabela JÁ existente (para tabela ausente ele devolve true), e
   aqui a tabela é inteiramente nova — então a existência é
   conferida de fato, e a ausência vira o mesmo 503
   "schema_pending" que o projeto já usa para migrações
   aditivas pendentes. */
async function assertTable() {
  let schema = null;
  try {
    schema = await db.schemaFor(TABLE);
  } catch (e) {
    schema = null;
  }
  if (schema && schema.size) return;
  throw new ApiError(
    503,
    "O canal de atendimento ainda não foi implantado no banco: falta executar a migração supabase/migrations/0002_support_tickets.sql no Supabase. Enquanto isso nenhum chamado é gravado — e nenhum é fingido como enviado.",
    "schema_pending"
  );
}

function cleanCategory(raw) {
  const v = String(raw || "").trim();
  return CATEGORIES.indexOf(v) !== -1 ? v : "";
}

/* normaliza a linha devolvida pelo banco para o modelo do app */
function toTicket(row) {
  const app = map.toApp(TABLE, row);
  return {
    id: app.id,
    subject: app.subject,
    category: app.category,
    status: app.status || "open",
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}

/* ------------------------------------------------------------
   POST /api/support — abre um chamado
   ------------------------------------------------------------ */
async function createTicket(ctx) {
  const me = await auth.requireUser(ctx.event);
  const body = ctx.body || {};

  const subject = String(body.subject || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, SUBJECT_MAX);
  if (subject.length < SUBJECT_MIN)
    throw bad("Escreva um assunto com pelo menos " + SUBJECT_MIN + " caracteres.");

  const category = cleanCategory(body.category);
  if (!category)
    throw bad("Escolha uma das categorias oferecidas: " + CATEGORIES.join(", ") + ".");

  const description = String(body.description || "").trim().slice(0, DESC_MAX);
  if (description.length < DESC_MIN)
    throw bad("Descreva o que aconteceu com pelo menos " + DESC_MIN + " caracteres.");

  /* a validação vem ANTES da checagem de schema: um pedido mal
     formado é 400 de qualquer estado do banco — não se troca um
     "campo inválido" por "tabela ausente", que confundiria quem
     lê o erro e esconderia o defeito do envio. */
  await assertTable();

  /* limite de frequência lido do BANCO: não depende do relógio
     do navegador nem de contagem guardada no cliente */
  const recent = (await db.select(TABLE, { where: { userId: me.id }, limit: 50 })) || [];
  if (recent.length >= MAX_TICKETS_PER_USER)
    throw bad("Você atingiu o limite de chamados desta conta. A equipe já deve ter os anteriores.");

  const cutoff = now() - RATE_WINDOW_MS;
  const opened = recent.filter((r) => msOf(r.createdAt) >= cutoff);
  if (opened.length >= RATE_MAX)
    throw bad(
      "Você abriu " + RATE_MAX + " chamados nos últimos 10 minutos. Aguarde um pouco antes de abrir outro."
    );

  const created = await db.insert(TABLE, {
    userId: me.id,
    subject: subject,
    category: category,
    description: description,
    status: "open",
    createdAt: now(),
    updatedAt: now(),
  });

  return { data: toTicket(created) };
}

/* ------------------------------------------------------------
   GET /api/support — só os chamados de quem perguntou
   A lista é sempre filtrada pela SESSÃO: o corpo do pedido não
   pode escolher de quem ver os chamados.
   ------------------------------------------------------------ */
async function listMine(ctx) {
  const me = await auth.requireUser(ctx.event);
  await assertTable();
  const rows = (await db.select(TABLE, { where: { userId: me.id }, limit: 50 })) || [];
  const out = rows.map(toTicket);
  out.sort((a, b) => msOf(b.createdAt) - msOf(a.createdAt));
  return { data: out };
}

function routes() {
  return [
    ["GET", "/support", listMine],
    ["POST", "/support", createTicket],
  ];
}

module.exports = { routes };
