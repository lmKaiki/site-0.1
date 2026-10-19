"use strict";
/* ============================================================
   NEXO · server/env
   Carrega variáveis de ambiente (arquivo .env no dev local,
   env vars do Netlify em produção). Nenhum segredo é gravado
   aqui: o arquivo .env é ignorado pelo git.
   ============================================================ */

const fs = require("fs");
const path = require("path");

let loaded = false;

function loadDotEnv() {
  if (loaded) return;
  loaded = true;
  const candidates = [
    process.env.NEXO_ENV_FILE,
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "..", ".env"),
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      text.split(/\r?\n/).forEach((line) => {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
        if (!m) return;
        let value = m[2];
        if (/^"(.*)"$/.test(value) || /^'(.*)'$/.test(value)) value = value.slice(1, -1);
        if (process.env[m[1]] === undefined || process.env[m[1]] === "") {
          process.env[m[1]] = value;
        }
      });
      break; /* o primeiro .env encontrado manda */
    } catch (e) {
      /* arquivo ilegível: segue com o ambiente do processo */
    }
  }
}

loadDotEnv();

const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const anonKey = process.env.SUPABASE_ANON_KEY || "";

/* driver escolhido:
   · NEXO_DB explícito vence;
   · com SERVICE_ROLE  → supabase (banco online);
   · sem SERVICE_ROLE  → sqlite  (dev local, não usa rede). */
let driver = String(process.env.NEXO_DB || "").toLowerCase();
if (!driver) driver = serviceRoleKey && supabaseUrl ? "supabase" : "sqlite";
if (driver === "postgres" || driver === "postgrest") driver = "supabase";

module.exports = {
  loadDotEnv,
  supabaseUrl,
  supabaseAnonKey: anonKey,
  supabaseServiceRoleKey: serviceRoleKey,
  /* anon é pública por definição; a secreta tem prioridade no backend */
  supabaseKey: serviceRoleKey || anonKey,
  keyIsSecret: !!serviceRoleKey,
  driver,
  sqliteFile:
    process.env.NEXO_SQLITE_FILE || path.join("tools", ".nexo-local.db"),
  isProduction:
    process.env.CONTEXT === "production" || process.env.NODE_ENV === "production",
  port: Number(process.env.PORT) || 8087,
};
