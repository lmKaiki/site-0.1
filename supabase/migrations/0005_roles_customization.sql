-- ============================================================
-- 0005 -- CARGOS PERSONALIZADOS (ícone e descrição)
-- ------------------------------------------------------------
-- Motivo: o editor de cargo do Nexo já pedia e exibia `icon` e
-- `description` desde sempre, mas a tabela `roles` nunca teve
-- essas colunas. O servidor (server/handlers/servers.js) montava
-- a linha SEM esses dois campos, então o que a pessoa escrevia
-- era descartado em silêncio -- e sumia ao recarregar.
--
-- Impacto: aditivo e retrocompatível. Duas colunas anuláveis, sem
-- DEFAULT, sem constraint, sem backfill e sem leitura de dado
-- existente. Cargo nenhum muda de nome, cor, posição ou
-- permissão; cargos já criados simplesmente passam a poder ter
-- ícone e descrição.
--
-- Enquanto esta migração não for aplicada, o mapa (server/map.js)
-- descarta `icon`/`description` ao ler e ao gravar: o cargo é
-- criado normalmente, sem ícone e sem descrição -- nada estoura e
-- nada é fingido na interface.
--
-- O TEMA DO SERVIDOR não precisa de migração: ele mora dentro do
-- JSONB `servers.appearance` (adicionado na 0001) e a preferência
-- individual de cada membro mora em `prefs.data`, que já existe.
--
-- Antes de aplicar, faça backup do banco (pg_dump).
-- ============================================================

ALTER TABLE roles ADD COLUMN IF NOT EXISTS icon        text;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS description text;

-- conferência final (aparece como aviso se algo sair do esperado)
DO $$
DECLARE
  col_count integer;
BEGIN
  SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
   WHERE table_name = 'roles'
     AND column_name IN ('icon', 'description');
  IF col_count < 2 THEN
    RAISE NOTICE '0005: roles ainda sem icon/description -- rode o ALTER TABLE manualmente';
  END IF;
END $$;
