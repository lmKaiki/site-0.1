-- ============================================================
--  NEXO · migração aditiva 0002
--  Cria a tabela de chamados de suporte usada pela página
--  #/suporte. ADICIONA uma tabela nova; NÃO altera, NÃO renomeia,
--  NÃO apaga coluna, tabela, registro ou conta existente.
--
--  ESTADO: **NÃO APLICADA**. Este arquivo é a preparação da
--  migração; ele só passa a valer quando for executado no
--  Supabase (SQL Editor ou CLI). Enquanto isso, o endpoint
--  POST /api/support responde 503 "schema_pending" — é o
--  comportamento esperado, e o formulário mostra esse estado de
--  forma explícita em vez de fingir que o chamado foi enviado.
--
--  O que foi verificado antes de escrever isto: o esquema real
--  foi lido do PostgREST (OpenAPI) e confirmou que NÃO existe
--  hoje nenhuma tabela de chamados (tickets/chamados/support).
--  A tabela reports foi descartada como alternativa: ela é o
--  modelo de denúncias de conteúdo (target_user_id, server_id)
--  e não comporta um chamado sem sujar o schema.
--
--  SEGURANÇA:
--   · IF NOT EXISTS → rodar 2x é seguro;
--   · nenhuma tabela ou registro existente é tocado;
--   · RLS fica habilitada com leitura restrita ao próprio autor:
--     mesmo que a chave errada vaze para o navegador, um chamado
--     não pode ser lido por outra pessoa;
--   · o backend grava e lê com a service_role (server-side),
--     que continua passando pela RLS como superusuário — a
--     política abaixo é defesa em profundidade, não caminho único.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  subject     text NOT NULL,
  category    text NOT NULL,
  description text NOT NULL,
  status      text NOT NULL DEFAULT 'open',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- quem abriu enxerga os próprios chamados. Ninguém mais.
-- (a service_role do backend não é afetada por esta política)
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_tickets_select_own" ON support_tickets;
CREATE POLICY "support_tickets_select_own"
  ON support_tickets FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "support_tickets_insert_own" ON support_tickets;
CREATE POLICY "support_tickets_insert_own"
  ON support_tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- índice para listar os chamados de uma pessoa sem varrer a tabela
CREATE INDEX IF NOT EXISTS support_tickets_user_created_idx
  ON support_tickets (user_id, created_at DESC);
