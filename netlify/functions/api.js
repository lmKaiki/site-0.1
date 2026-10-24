"use strict";
/* ============================================================
   NEXO · Netlify Function única: /api/*
   Frontend → Netlify Functions → Supabase (PostgreSQL).

   A SERVICE_ROLE_KEY existe SOMENTE no ambiente desta função
   (variável de ambiente do Netlify). Ela nunca é devolvida em
   resposta, nem aparece em HTML, JS do navegador ou console.
   ============================================================ */

const { register, dispatch } = require("../../server/router");

const handlers = [
  require("../../server/handlers/auth"),
  require("../../server/handlers/social"),
  require("../../server/handlers/servers"),
  require("../../server/handlers/messages"),
  require("../../server/handlers/emojis"),
  require("../../server/handlers/sync"),
  require("../../server/handlers/apps"),
  require("../../server/handlers/calls"),
  require("../../server/handlers/custom"),
  require("../../server/handlers/support"),
  require("../../server/handlers/tickets"),
];

register(handlers);

exports.handler = async function (event) {
  try {
    return await dispatch(event);
  } catch (err) {
    console.error("[nexo/api] falha no roteador:", err && err.message);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: false,
        error: "Ocorreu um erro inesperado no servidor. Tente novamente.",
        code: "server_error",
      }),
    };
  }
};
