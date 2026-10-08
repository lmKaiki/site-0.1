"use strict";
/* ============================================================
   NEXO · server/patch
   Formato das respostas da API:
     { ok, data, patch }
   · data  → o valor de retorno que a view já espera;
   · patch → o que o cliente precisa aplicar no cache local
             (NX.store.db) para a tela continuar coerente.

   patch.set    → sobe linhas em coleções-map (users, dms, ...)
   patch.del    → remove chaves
   patch.list   → substitui listas (notifications, logs)
   ============================================================ */

function createPatch() {
  return { set: {}, del: {}, list: {} };
}

/* key = chave da coleção no cliente (ex.: id, código de convite) */
function set(patch, collection, key, row) {
  if (!row) return patch;
  const bucket = (patch.set[collection] = patch.set[collection] || {});
  bucket[key] = row;
  return patch;
}

function del(patch, collection, keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  if (!list.length) return patch;
  patch.del[collection] = (patch.del[collection] || []).concat(list);
  return patch;
}

function list(patch, collection, rows) {
  patch.list[collection] = rows || [];
  return patch;
}

function isEmpty(patch) {
  if (!patch) return true;
  return (
    !Object.keys(patch.set).length &&
    !Object.keys(patch.del).length &&
    !Object.keys(patch.list).length
  );
}

module.exports = { createPatch, set, del, list, isEmpty };
