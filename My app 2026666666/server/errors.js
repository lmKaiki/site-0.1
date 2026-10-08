"use strict";
/* ============================================================
   NEXO · server/errors
   Erros com mensagem amigável em PT-BR. O cliente mostra a
   mensagem direto — nada de erro engolido em silêncio.
   ============================================================ */

class ApiError extends Error {
  constructor(status, message, code) {
    super(message || "Não foi possível concluir a operação.");
    this.name = "ApiError";
    this.status = status || 400;
    this.friendly = true;
    this.code = code || null;
  }
}

const bad = (msg) => new ApiError(400, msg);
const unauthorized = (msg) =>
  new ApiError(401, msg || "Sua sessão expirou. Entre novamente.", "session");
const forbidden = (msg) =>
  new ApiError(
    403,
    msg || "Você não tem permissão para realizar esta ação.",
    "permission"
  );
const notFound = (msg) => new ApiError(404, msg || "Registro não encontrado.");
const conflict = (msg) => new ApiError(409, msg);

module.exports = { ApiError, bad, unauthorized, forbidden, notFound, conflict };
