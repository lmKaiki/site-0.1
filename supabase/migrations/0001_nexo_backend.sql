-- ============================================================
--  NEXO · migração aditiva 0001
--  Apenas ADICIONA colunas ausentes. NÃO altera, NÃO renomeia,
--  NÃO apaga coluna, tabela, registro ou conta.
--
--  ESTADO: **NÃO APLICADA**. Este arquivo é a preparação da
--  migração; ele só passa a valer quando for executado no
--  Supabase (SQL Editor ou CLI) e for comprovado que as colunas
--  passaram a existir. Enquanto isso, o backend continua
--  respondendo 503 "schema_pending" nestas operações — é o
--  comportamento esperado, e os avisos NÃO devem ser removidos.
--
--  O que foi verificado antes de escrever isto: o esquema real
--  foi lido do PostgREST (OpenAPI) e comparado, coluna a coluna,
--  com server/map.js. As colunas abaixo são exatamente as que o
--  mapa classifica como "drop" (existentes só após a migração).
--
--  Depois de aplicar, rode:  node tools/_tmp-schema.js
--  Ele imprime "nenhum — schema completo" quando estiver tudo.
--
--  SEGURANÇA:
--   · IF NOT EXISTS em todos os ADD COLUMN → rodar 2x é seguro;
--   · valores DEFAULT são constantes → PostgreSQL 11+ não reescreve a tabela;
--   · nenhuma constraint NOT NULL é adicionada a coluna já existente;
--   · nenhum dado existente é lido, alterado ou descartado,
--     exceto o backfill explícito de roles.is_default (ver nota).
-- ============================================================

-- ------------------------------------------------------------
-- messages — fixação, anexos, reações e tipo
-- ------------------------------------------------------------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned      boolean     NOT NULL DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS type        text        NOT NULL DEFAULT 'user';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments jsonb       NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reactions   jsonb       NOT NULL DEFAULT '{}'::jsonb;

-- ------------------------------------------------------------
-- dm_messages — mesmos campos nas conversas diretas
-- ------------------------------------------------------------
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS pinned      boolean     NOT NULL DEFAULT false;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS type        text        NOT NULL DEFAULT 'user';
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS attachments jsonb       NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS reactions   jsonb       NOT NULL DEFAULT '{}'::jsonb;

-- ------------------------------------------------------------
-- servers — aparência e descoberta (explorar)
-- ------------------------------------------------------------
ALTER TABLE servers ADD COLUMN IF NOT EXISTS appearance   jsonb NOT NULL DEFAULT
  '{"primary":"#35e0a8","secondary":"#8f83ff","backgroundImage":null,"theme":"dark"}'::jsonb;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- memberships — permissões por membro e cargos extras
-- ------------------------------------------------------------
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS permissions     jsonb       NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS extra_role_ids  jsonb       NOT NULL DEFAULT '[]'::jsonb;
--  created_at é novo para esta tabela: existentes ficam NULL,
--  o que o mapa lê como null (mesmo valor que o padrão atual).
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS created_at      timestamptz;

-- ------------------------------------------------------------
-- categories — recolhimento e permissões por categoria
-- ------------------------------------------------------------
ALTER TABLE categories ADD COLUMN IF NOT EXISTS collapsed boolean NOT NULL DEFAULT false;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS perms      jsonb   NOT NULL DEFAULT '{}'::jsonb;

-- ------------------------------------------------------------
-- channels — herança, sobrescritas e atualização
-- ------------------------------------------------------------
--  DEFAULT true reproduz exatamente o que o código já devolve
--  quando a coluna não existe (defaultFor → inheritPerms: true),
--  portanto nenhuma permissão visível muda após a migração.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS inherit_perms boolean   NOT NULL DEFAULT true;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS overrides      jsonb     NOT NULL DEFAULT '{"view":"all","send":"all"}'::jsonb;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS updated_at     timestamptz;

-- ------------------------------------------------------------
-- roles — cargo padrão
-- ------------------------------------------------------------
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

--  NOTA (única escrita em dado existente, e é necessária):
--  enquanto a coluna não existe, o servidor trata o cargo de
--  position = 0 como o padrão (server/db.js → joinRoles).
--  Se apenas criássemos a coluna com DEFAULT false, todos os
--  servidores ficariam SEM cargo padrão após a migração e as
--  permissões herdadas mudariam de comportamento. O backfill
--  abaixo preserva exatamente a semântica atual.
UPDATE roles SET is_default = true
 WHERE is_default = false
   AND position = 0
   AND id IN (SELECT DISTINCT ON (server_id) id
                FROM roles ORDER BY server_id, position, created_at, id);

-- ------------------------------------------------------------
-- VERIFICAÇÃO (rode depois de aplicar — tudo deve ser true)
-- ------------------------------------------------------------
-- SELECT table_name, column_name FROM information_schema.columns
--  WHERE table_name IN ('messages','dm_messages','servers','memberships',
--                       'categories','channels','roles')
--    AND column_name IN ('pinned','type','attachments','reactions',
--                        'appearance','discoverable','permissions',
--                        'extra_role_ids','created_at','collapsed','perms',
--                        'inherit_perms','overrides','updated_at','is_default')
--  ORDER BY 1, 2;
