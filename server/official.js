"use strict";
/* ============================================================
   NEXO · server/official
   O "Servidor Oficial Nexo" — REMOVIDO DA PLATAFORMA.

   O que este módulo ERA e deixou de ser:
     · tinha `ensureOfficial()`, que provisionava o servidor com id
       fixo `sv_oficial_nexo`, a conta de sistema `u_sistema_nexo`
       e a estrutura de canais — chamado a cada CADASTRO (dois
       caminhos em handlers/auth.js) e na rota pública
       GET /servers/official;
     · tinha `publicView()`/`officialServer()` (a vista pública).

   O que ESTA versão faz (e nada além disso):
     · NÃO cria servidor, conta, canal, cargo ou notificação;
     · mantém as GUARDAS de segurança, que continuam valendo para o
       registro legado que permanece no banco:
         - isOfficialName()  → nome reservado em criar/renomear
           (ninguém se passa pelo oficial);
         - isOfficial()      → bloqueio de exclusão/edição da marca;
         - isSystemUser()    → a conta de sistema nunca recebe
           notificação de "fulano entrou";
     · hideOfficialNotes()  → FILTRO DE LEITURA: as notificações de
       cadastro antigas ("O Servidor Oficial Nexo está no ar…")
       deixam de ser entregues pela API. Nada é apagado do banco —
       é um filtro reversível na camada de leitura.

   DADO NO BANCO (intocado — exclusão exige autorização explícita):
     · linha `sv_oficial_nexo` em `servers` (is_official, official_key);
     · conta `u_sistema_nexo`;
     · 3 categorias / 8 canais / 1 cargo / 2 memberships;
     · notificações antigas já gravadas.
   ============================================================ */

const OFFICIAL_ID = "sv_oficial_nexo";
const OFFICIAL_KEY = "nexo-oficial";
const OFFICIAL_NAME = "🏠 Servidor Oficial Nexo";
const SYSTEM_ID = "u_sistema_nexo";

function isOfficial(server) {
  if (!server) return false;
  return server.id === OFFICIAL_ID || server.officialKey === OFFICIAL_KEY || server.isOfficial === true;
}

/* nomes que se passam pelo oficial: bloqueados para quem não é o
   próprio servidor oficial (o emoji na frente não muda o nome) */
function isOfficialName(name) {
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const a = norm(name);
  return (
    a === norm(OFFICIAL_NAME) ||
    a === "servidor oficial nexo" ||
    a === "servidor oficial" ||
    a === "nexo oficial"
  );
}

function isSystemUser(id) {
  return String(id || "") === SYSTEM_ID;
}

/* meta pode chegar como objeto (supabase jsonb) ou como string
   JSON (sqlite) — tratamos os dois formatos. */
function metaOf(n) {
  let m = n ? n.meta : null;
  if (typeof m === "string") {
    try {
      m = JSON.parse(m);
    } catch (e) {
      m = null;
    }
  }
  return m && typeof m === "object" ? m : null;
}

/* filtro de LEITURA das notificações do oficial legado.
   Mantém a ordem e não remove nada do banco. */
function hideOfficialNotes(list) {
  if (!Array.isArray(list) || !list.length) return list || [];
  return list.filter((n) => {
    const m = metaOf(n);
    if (!m) return true;
    if (m.official === true) return false;
    if (m.serverId && isOfficial({ id: m.serverId })) return false;
    if (String(m.href || "").indexOf(OFFICIAL_ID) !== -1) return false;
    return true;
  });
}

module.exports = {
  OFFICIAL_ID,
  OFFICIAL_KEY,
  OFFICIAL_NAME,
  SYSTEM_ID,
  isOfficial,
  isOfficialName,
  isSystemUser,
  hideOfficialNotes,
};
