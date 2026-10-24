-- ============================================================
-- 0007 · ALINHA A TABELA `emojis` QUE JÁ EXISTIA NO BANCO
-- ------------------------------------------------------------
-- Motivo: a tabela `emojis` NÃO nasceu da 0006. Ela já existia
-- no esquema base do projeto com outra forma -- tinha `url` no
-- lugar de `image` e não tinha `updated_at`. Como a 0006 usa
-- CREATE TABLE IF NOT EXISTS, ela NÃO mexe numa tabela que já
-- existe: a 0006 sozinha nunca converte esta tabela.
--
-- Sem esta migração o Nexo recusa a criação de emoji com 503
-- "schema_pending" (server/handlers/emojis.js confere a coluna
-- `image`). Antes desta checagem o campo era descartado em
-- silêncio na gravação e o emoji nascia SEM FOTO -- por isso a
-- coluna agora é exigida em vez de ignorada.
--
-- Impacto: aditivo e retrocompatível.
--   · duas colunas novas, anuláveis, sem constraint;
--   · NADA é apagado: `url` permanece no lugar;
--   · as linhas antigas têm a imagem copiada para `image`
--     (backfill abaixo), então nenhum emoji antigo fica sem foto.
--
-- Antes de aplicar, faça backup do banco (pg_dump).
-- ============================================================

-- colunas que a 0006 declara e que esta tabela antiga não tinha --
ALTER TABLE emojis ADD COLUMN IF NOT EXISTS image      text;
ALTER TABLE emojis ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- backfill: o que já foi gravado em `url` passa a valer como
-- imagem. Só linhas em que `image` ainda está vazia são tocadas,
-- então re-executar é seguro e não sobrescreve nada.
UPDATE emojis
   SET image = url
 WHERE (image IS NULL OR image = '')
   AND url IS NOT NULL
   AND url <> '';

COMMENT ON COLUMN emojis.image IS
  'data URL validada no backend (server/handlers/emojis.js), mesmo padrão de avatar/banner/icone do Nexo';

-- ------------------------------------------------------------
-- VERIFICAÇÃO (rode depois de aplicando — as duas devem ser true)
-- ------------------------------------------------------------
-- SELECT EXISTS (SELECT 1 FROM information_schema.columns
--                  WHERE table_name = 'emojis' AND column_name = 'image'),
--        EXISTS (SELECT 1 FROM information_schema.columns
--                  WHERE table_name = 'emojis' AND column_name = 'updated_at');
