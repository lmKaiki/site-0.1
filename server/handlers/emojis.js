"use strict";
/* ============================================================
   NEXO · server/handlers/emojis
   EMOJIS e FIGURINHAS personalizados POR SERVIDOR.

   Antes desta camada a aba "Emojis" de js/admin.js gravava em
   db().emojis -- um objeto que existe SÓ no navegador. O emoji
   morria no reload e nunca chegava a outro membro; as figurinhas
   não existiam. Aqui os dois viram REAIS: tabela própria, rota e
   verificação de permissão no servidor.

   Regras desta camada (quem recusa é AQUI, não o botão escondido):
     · listar  -> precisa ser membro do servidor;
     · criar/editar/apagar -> precisa da permissão dedicada
       (manageEmojis / manageStickers). Dono e administrador têm
       tudo (acl.js aplica administrator = todas as chaves);
     · usar    -> useCustomEmojis / useStickers, checado no chat.

   A IMAGEM é data URL validado AQUI (tipo, estrutura e tamanho),
   MESMO padrão do avatar/banner/ícone do Nexo. Nada é enviado ao
   banco sem passar por sanitizeImage.
   ============================================================ */

const db = require("../db");
const auth = require("../auth");
const u = require("../util");
const P = require("../patch");
const acl = require("../acl");
const { ApiError, bad, forbidden, notFound } = require("../errors");

function now() {
  return Date.now();
}

/* ------------------------------------------------------------
   Limites de arquivo. O Nexo guarda mídia como data URL dentro
   da própria linha (não usa Storage), então o teto é o que
   protege o banco e o sync. Emojis ficam pequenos (128 px);
   figurinhas são maiores mas continuam enxutas.
   SVG é recusado de propósito, igual ao avatar: carrega script
   em contexto de imagem e nunca foi aceito aqui.
   ------------------------------------------------------------ */
const EMOJI_LIMITS = { png: 262144, gif: 524288 };
const STICKER_LIMITS = { png: 524288, gif: 1048576 };
const IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i;

function sanitizeImage(raw, kind) {
  const limits = kind === "sticker" ? STICKER_LIMITS : EMOJI_LIMITS;
  if (raw === null || raw === undefined || raw === "") throw bad("Escolha uma imagem.");
  if (typeof raw !== "string") throw bad("Imagem inválida.");
  if (!IMAGE_RE.test(raw))
    throw bad("Envie uma imagem PNG, WEBP ou GIF.");
  /* base64 puro ~= 4/3 do tamanho do binário; medimos o corpo todo */
  const isGif = /^data:image\/gif/i.test(raw);
  const cap = isGif ? limits.gif : limits.png;
  if (raw.length > cap)
    throw bad(
      "Esta imagem é grande demais. " +
        (isGif ? "GIF até " : "Até ") +
        Math.round(cap / 1024) + " KB."
    );
  return raw;
}

/* Nome do emoji/figurinha: o que vira <:nome:>. Só letras,
   números e sublinhado, minúsculas, 2–24. Normaliza igual ao
   cliente (u.slug) para o mesmo arquivo nunca virar dois. */
function normalizeName(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (s.length < 2) throw bad("Dê um nome com pelo menos 2 caracteres.");
  if (s.length > 24) throw bad("O nome pode ter no máximo 24 caracteres.");
  return s;
}

function sanitizeDescription(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s ? s.slice(0, 120) : null;
}

/* nome já usado neste servidor? (índice único é só rede de
   segurança — a checagem amigável é aqui) */
async function nameTaken(table, serverId, name, exceptId) {
  const rows = (await db.select(table, { where: { server_id: serverId } })) || [];
  return rows.some(
    (r) => r.name === name && String(r.id) !== String(exceptId || "")
  );
}

/* A migração 0006 pode ainda não estar aplicada no banco online.
   Nesse caso respondemos o 503 "schema_pending" que o projeto já usa
   para migração aditiva pendente — em vez de deixar o PostgREST
   estourar num 500 com texto técnico que ninguém entende.
   `db.schemaFor` é memoizado por processo: uma introspecção e pronto. */
const REQUIRED_COLS = { emojis: ["image"], stickers: ["image"] };

async function assertGallery(table) {
  let schema = null;
  try {
    schema = await db.schemaFor(table);
  } catch (e) {
    schema = null;
  }
  const missing = [];
  if (!schema || !schema.size) {
    missing.push("tabela `" + table + "`");
  } else {
    (REQUIRED_COLS[table] || []).forEach((c) => {
      if (!schema.has(c)) missing.push("coluna `" + c + "`");
    });
  }
  if (!missing.length) return;
  /* Tabela presente porém com outra forma (por exemplo `url` em vez
     de `image`) também cai aqui: sem esta checagem a imagem seria
     DESCARTADA em silêncio na gravação e o emoji nasceria sem foto. */
  throw new ApiError(
    503,
    "Emojis e figurinhas personalizados ainda não estão disponíveis neste banco (" +
      missing.join(", ") +
      "): falta executar a migração supabase/migrations/0006_emojis_stickers.sql. " +
      "Enquanto isso o acervo fica vazio — e nada é fingido como salvo.",
    "schema_pending"
  );
}

/* carrega o servidor e exige membro + permissão de gestão */
async function requireManager(ctx, serverId, perm, msg, table) {
  const me = await auth.requireUser(ctx.event);
  const ctxS = await acl.loadServer(serverId);
  acl.requireMember(ctxS, me.id);
  acl.requirePerm(ctxS, me.id, perm, msg);
  /* a checagem vem DEPOIS da permissão: quem não pode gerenciar o
     acervo não descobre a disponibilidade da feature por ela */
  await assertGallery(table);
  return { me, ctxS };
}

/* ============================ EMOJIS ============================ */

async function listEmojis(ctx) {
  const me = await auth.requireUser(ctx.event);
  const ctxS = await acl.loadServer(ctx.params.id);
  acl.requireMember(ctxS, me.id);
  await assertGallery("emojis");
  const rows = (await db.select("emojis", { where: { server_id: ctx.params.id } })) || [];
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { data: rows };
}

async function createEmoji(ctx) {
  const { me } = await requireManager(
    ctx, ctx.params.id, "manageEmojis",
    "Você não tem permissão para adicionar emojis.", "emojis"
  );
  const body = ctx.body || {};
  const name = normalizeName(body.name);
  const image = sanitizeImage(body.image, "emoji");
  if (await nameTaken("emojis", ctx.params.id, name))
    throw bad("Já existe um emoji com esse nome neste servidor.");

  const emoji = {
    id: u.uid("em"),
    serverId: ctx.params.id,
    name,
    image,
    createdBy: me.id,
    createdAt: now(),
    updatedAt: null,
  };
  await db.insert("emojis", emoji);
  const patch = P.createPatch();
  P.set(patch, "emojis", emoji.id, emoji);
  return { status: 201, data: emoji, patch };
}

async function updateEmoji(ctx) {
  const rows = await db.select("emojis", { where: { id: ctx.params.id }, limit: 1 });
  const emoji = rows && rows[0];
  if (!emoji) throw notFound("Emoji não encontrado.");
  const { me } = await requireManager(
    ctx, emoji.serverId, "manageEmojis",
    "Você não tem permissão para editar emojis.", "emojis"
  );

  const body = ctx.body || {};
  const update = {};
  if (body.name !== undefined) {
    const name = normalizeName(body.name);
    if (await nameTaken("emojis", emoji.serverId, name, emoji.id))
      throw bad("Já existe um emoji com esse nome neste servidor.");
    update.name = name;
  }
  if (body.image !== undefined) update.image = sanitizeImage(body.image, "emoji");
  update.updatedAt = now();

  await db.update("emojis", { where: { id: emoji.id } }, update);
  const fresh = (await db.select("emojis", { where: { id: emoji.id }, limit: 1 }))[0];
  const patch = P.createPatch();
  P.set(patch, "emojis", emoji.id, fresh);
  return { data: fresh, patch };
}

async function deleteEmoji(ctx) {
  const rows = await db.select("emojis", { where: { id: ctx.params.id }, limit: 1 });
  const emoji = rows && rows[0];
  if (!emoji) throw notFound("Emoji não encontrado.");
  await requireManager(
    ctx, emoji.serverId, "manageEmojis",
    "Você não tem permissão para apagar emojis.", "emojis"
  );

  await db.remove("emojis", { where: { id: emoji.id } });
  const patch = P.createPatch();
  P.del(patch, "emojis", [emoji.id]);
  return { data: true, patch };
}

/* =========================== FIGURINHAS =========================== */

async function listStickers(ctx) {
  const me = await auth.requireUser(ctx.event);
  const ctxS = await acl.loadServer(ctx.params.id);
  acl.requireMember(ctxS, me.id);
  await assertGallery("stickers");
  const rows = (await db.select("stickers", { where: { server_id: ctx.params.id } })) || [];
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { data: rows };
}

async function createSticker(ctx) {
  const { me } = await requireManager(
    ctx, ctx.params.id, "manageStickers",
    "Você não tem permissão para adicionar figurinhas.", "stickers"
  );
  const body = ctx.body || {};
  const name = normalizeName(body.name);
  const image = sanitizeImage(body.image, "sticker");
  if (await nameTaken("stickers", ctx.params.id, name))
    throw bad("Já existe uma figurinha com esse nome neste servidor.");

  const sticker = {
    id: u.uid("st"),
    serverId: ctx.params.id,
    name,
    description: sanitizeDescription(body.description),
    image,
    createdBy: me.id,
    createdAt: now(),
    updatedAt: null,
  };
  await db.insert("stickers", sticker);
  const patch = P.createPatch();
  P.set(patch, "stickers", sticker.id, sticker);
  return { status: 201, data: sticker, patch };
}

async function updateSticker(ctx) {
  const rows = await db.select("stickers", { where: { id: ctx.params.id }, limit: 1 });
  const sticker = rows && rows[0];
  if (!sticker) throw notFound("Figurinha não encontrada.");
  const { me } = await requireManager(
    ctx, sticker.serverId, "manageStickers",
    "Você não tem permissão para editar figurinhas.", "stickers"
  );

  const body = ctx.body || {};
  const update = {};
  if (body.name !== undefined) {
    const name = normalizeName(body.name);
    if (await nameTaken("stickers", sticker.serverId, name, sticker.id))
      throw bad("Já existe uma figurinha com esse nome neste servidor.");
    update.name = name;
  }
  if (body.description !== undefined) update.description = sanitizeDescription(body.description);
  if (body.image !== undefined) update.image = sanitizeImage(body.image, "sticker");
  update.updatedAt = now();

  await db.update("stickers", { where: { id: sticker.id } }, update);
  const fresh = (await db.select("stickers", { where: { id: sticker.id }, limit: 1 }))[0];
  const patch = P.createPatch();
  P.set(patch, "stickers", sticker.id, fresh);
  return { data: fresh, patch };
}

async function deleteSticker(ctx) {
  const rows = await db.select("stickers", { where: { id: ctx.params.id }, limit: 1 });
  const sticker = rows && rows[0];
  if (!sticker) throw notFound("Figurinha não encontrada.");
  await requireManager(
    ctx, sticker.serverId, "manageStickers",
    "Você não tem permissão para apagar figurinhas.", "stickers"
  );

  await db.remove("stickers", { where: { id: sticker.id } });
  const patch = P.createPatch();
  P.del(patch, "stickers", [sticker.id]);
  return { data: true, patch };
}

function routes() {
  return [
    ["GET", "/servers/:id/emojis", listEmojis],
    ["POST", "/servers/:id/emojis", createEmoji],
    ["PATCH", "/emojis/:id", updateEmoji],
    ["DELETE", "/emojis/:id", deleteEmoji],

    ["GET", "/servers/:id/stickers", listStickers],
    ["POST", "/servers/:id/stickers", createSticker],
    ["PATCH", "/stickers/:id", updateSticker],
    ["DELETE", "/stickers/:id", deleteSticker],
  ];
}

module.exports = {
  routes,
  sanitizeImage,
  normalizeName,
};
