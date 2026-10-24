-- ============================================================
-- 0006 -- EMOJIS E FIGURINHAS PERSONALIZADOS POR SERVIDOR
-- ------------------------------------------------------------
-- Motivo: o Nexo já tinha uma ABA de "Emojis" nas configurações
-- (js/admin.js -> tabEmojis) que gravava em db().emojis -- um
-- objeto que existe SÓ no navegador. Não havia tabela, rota nem
-- handler no servidor: o emoji morria no reload e nunca chegava
-- a outro membro. As figurinhas não existiam de forma nenhuma.
--
-- Impacto: aditivo e retrocompatível. Duas tabelas novas, sem
-- tocar em nenhuma tabela existente e sem apagar dado algum.
-- A imagem vai como data URL validado no backend (server/handlers/
-- emojis.js), MESMO padrão de avatar/banner/ícone do Nexo.
--
-- Permissões: useStickers/manageEmojis/manageStickers foram
-- acrescentadas a server/acl.js PERM_KEYS. Quem já tem
-- administrator ou é dono continua com tudo (acl.js aplica
-- administrator = todas as chaves). Nenhum cargo perde permissão:
-- as chaves novas nascem em false para todos os cargos, e só o
-- dono (ou quem ele marcar) passa a gestir.
--
-- Antes de aplicar, faça backup do banco (pg_dump).
-- ============================================================

-- 1) emojis personalizados do servidor -------------------------
CREATE TABLE IF NOT EXISTS emojis (
  id         text PRIMARY KEY,
  server_id  text NOT NULL,
  name       text NOT NULL,           -- ex.: "fire" (sem <: :>)
  image      text NOT NULL,           -- data:image/... validado no backend
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_emojis_server_name
  ON emojis (server_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_emojis_server ON emojis (server_id);

-- 2) figurinhas do servidor ------------------------------------
CREATE TABLE IF NOT EXISTS stickers (
  id          text PRIMARY KEY,
  server_id   text NOT NULL,
  name        text NOT NULL,
  description text,                    -- opcional
  image       text NOT NULL,           -- data:image/... (PNG/WEBP/GIF)
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_stickers_server_name
  ON stickers (server_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_stickers_server ON stickers (server_id);

-- 3) Row Level Security ----------------------------------------
-- Nexo grava e lê pelo backend com a service_role (server-side),
-- que não é afetada por estas políticas. Seguimos o mesmo padrão
-- das tabelas de ticket (0003): leitura liberada, escrita NENHUMA
-- para o cliente anon. Assim quem tiver a chave pública não
-- altera o acervo de um servidor ao qual não pertence, e a
-- validação de permissão continua sendo do backend.
-- (Evitamos subquery em `memberships` aqui: o backend já filtra
-- por membership ao servir o sync, e uma política mais custosa em
-- toda linha de emoji não traz ganho — a escrita já está fechada.)

ALTER TABLE emojis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "emojis_select_all" ON emojis;
CREATE POLICY "emojis_select_all" ON emojis FOR SELECT
  USING (true);
-- nenhuma política de INSERT/UPDATE/DELETE para o cliente anon:
-- só o backend (service_role) gestiona o acervo.

ALTER TABLE stickers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stickers_select_all" ON stickers;
CREATE POLICY "stickers_select_all" ON stickers FOR SELECT
  USING (true);

-- 4) conferência final (aviso se algo sair do esperado) --------
DO $$
DECLARE
  tbl_count integer;
BEGIN
  SELECT COUNT(*) INTO tbl_count
    FROM information_schema.tables
   WHERE table_name IN ('emojis', 'stickers');
  IF tbl_count < 2 THEN
    RAISE NOTICE '0006: tabelas emojis/stickers ausentes -- rode o CREATE TABLE manualmente';
  END IF;
END $$;
