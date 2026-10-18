-- ============================================================
--  NEXO · migração aditiva 0003
--  Bot Center de tickets: painel + tickets + participantes.
--
--  ESTADO: **NÃO APLICADA**. Este arquivo é a preparação; ele só
--  passa a valer quando for executado no Supabase (SQL Editor ou
--  CLI). Enquanto isso, o Bot Center responde 503 "schema_pending"
--  e a interface mostra esse estado de forma explícita — nada de
--  fingir que um ticket foi aberto.
--
--  O que foi verificado antes de escrever isto (leitura real do
--  PostgREST, sem alterar nada): as colunas de `channels` hoje são
--  category_id, created_at, id, name, permissions, position,
--  server_id, topic, type — NÃO existe overrides nem created_by, e
--  não há nenhuma tabela de tickets.
--
--  O que esta migração faz — ADICIONA, nunca altera/apaga:
--   1. colunas novas em `channels` (created_by, overrides) para que
--      um canal de ticket possa ser PRIVADO de verdade;
--   2. tabela `tickets` (cada chamado TICKET-000N, com motivo,
--      status, canal e auditoria);
--   3. tabela `ticket_participants` (quem pode ver o canal: o
--      abridor + quem o staff adicionou);
--   4. tabela `ticket_panels` (painel publicado como mensagem real
--      num canal, para membros abrirem chamados).
--
--  SEGURANÇA:
--   · IF NOT EXISTS em tudo → rodar 2x é seguro;
--   · nenhuma tabela, coluna ou registro existente é tocado;
--   · RLS habilitada com leitura restrita ao próprio autor nas
--     tabelas de ticket; o backend usa a service_role (server-side)
--     e passa pela RLS como superusuário — defesa em profundidade.
-- ============================================================

-- 1) colunas novas em channels (canal privado do ticket)
ALTER TABLE channels ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS overrides jsonb;

-- 2) tickets: um chamado por linha, com canal próprio
CREATE TABLE IF NOT EXISTS tickets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id    uuid NOT NULL,
  code         text NOT NULL,
  opener_id    uuid NOT NULL,
  subject      text NOT NULL,
  reason       text NOT NULL,
  status       text NOT NULL DEFAULT 'open',
  channel_id   uuid,
  assigned_to  uuid,
  closed_by    uuid,
  closed_at    timestamptz,
  close_reason text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tickets_server_status_idx ON tickets (server_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS tickets_server_code_idx ON tickets (server_id, code);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tickets_select_own" ON tickets;
CREATE POLICY "tickets_select_own" ON tickets FOR SELECT
  USING (auth.uid() = opener_id);

-- 3) participantes: quem enxerga o canal privado do ticket
CREATE TABLE IF NOT EXISTS ticket_participants (
  ticket_id uuid NOT NULL,
  user_id   uuid NOT NULL,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)
);

CREATE INDEX IF NOT EXISTS ticket_participants_user_idx ON ticket_participants (user_id);

ALTER TABLE ticket_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ticket_participants_select_own" ON ticket_participants;
CREATE POLICY "ticket_participants_select_own" ON ticket_participants FOR SELECT
  USING (auth.uid() = user_id);

-- 4) painel publicado num canal (mensagem real persistida)
CREATE TABLE IF NOT EXISTS ticket_panels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id  uuid NOT NULL,
  channel_id uuid NOT NULL,
  message_id uuid,
  title      text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_panels_server_idx ON ticket_panels (server_id);

ALTER TABLE ticket_panels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ticket_panels_select_members" ON ticket_panels;
CREATE POLICY "ticket_panels_select_members" ON ticket_panels FOR SELECT
  USING (true);
