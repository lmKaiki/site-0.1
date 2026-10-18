-- ============================================================
-- 0004 · GRUPOS PRIVADOS NAS MENSAGENS DIRETAS
-- ------------------------------------------------------------
-- Motivo: o Nexo passa a permitir grupos de até 10 participantes
-- dentro da MESMA estrutura de DMs (dms + dm_members +
-- dm_messages). Nenhuma tabela nova é criada e nenhuma linha
-- existente é apagada — apenas colunas novas e um índice.
--
-- Impacto: aditivo e retrocompatível. Conversas 1:1 continuam com
-- is_group = false e funcionam exatamente como antes. Enquanto
-- esta migração não for aplicada, os endpoints de grupo respondem
-- 503 "schema_pending" (nada é fingido na interface).
--
-- Antes de aplicar, faça backup do banco (pg_dump).
-- ============================================================

-- colunas do grupo na própria tabela de conversas ---------------
ALTER TABLE dms ADD COLUMN IF NOT EXISTS is_group     boolean     NOT NULL DEFAULT false;
ALTER TABLE dms ADD COLUMN IF NOT EXISTS name         text;
ALTER TABLE dms ADD COLUMN IF NOT EXISTS icon         jsonb;
ALTER TABLE dms ADD COLUMN IF NOT EXISTS admin_id     text;
ALTER TABLE dms ADD COLUMN IF NOT EXISTS member_count integer;

-- integridade: o mesmo usuário nunca conta duas vezes ----------
-- (linhas duplicadas EXATAS são dados inválidos de corrida
--  antiga; manter UMA linha de cada participação, sem sair de
--  ninguém do grupo)
DELETE FROM dm_members a
 USING dm_members b
 WHERE a.conversation_id = b.conversation_id
   AND a.user_id = b.user_id
   AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS ux_dm_members_conv_user
  ON dm_members (conversation_id, user_id);

-- backfill honesto: contagem real de cada conversa existente ----
UPDATE dms
   SET member_count = (
         SELECT COUNT(*) FROM dm_members m
         WHERE m.conversation_id = dms.id
       )
 WHERE member_count IS NULL;

-- conferência final (aparece como aviso se algo sair do esperado)
DO $$
DECLARE bad_rows integer;
BEGIN
  SELECT COUNT(*) INTO bad_rows
    FROM dms d
   WHERE d.is_group
     AND d.member_count IS DISTINCT FROM (
           SELECT COUNT(*) FROM dm_members m WHERE m.conversation_id = d.id
         );
  IF bad_rows > 0 THEN
    RAISE NOTICE '0004: % grupo(s) com contagem divergente — rode o recount no Nexo', bad_rows;
  END IF;
END $$;
