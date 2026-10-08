"use strict";
/* ============================================================
   NEXO · tools/cleanup-test-data
   Apaga no banco SOMENTE as linhas que pertencem às contas de
   teste informadas (contas, servidor de teste, mensagens, DMs,
   amizades, notificações e convites). Nada de SQL solto: usa a
   mesma fachada do servidor (server/db + server/map), na ordem
   em que as tabelas são dependentes, para não violar foreign key.

   Uso:
     node tools/cleanup-test-data.js                 # nexamigoteste1, nexamigoteste2
     node tools/cleanup-test-data.js user1,user2     # contas explícitas

   Ele NÃO toca em dados de quem não estiver na lista.
   ============================================================ */

const path = require("path");
const db = require(path.join(__dirname, "..", "server", "db"));

const PADRAO = "nexotesta1,nexotesta2";

function log(msg) {
  console.log("  · " + msg);
}

async function remover(tabela, where) {
  try {
    const n = await db.remove(tabela, { where: where });
    if (n) log(tabela + ": " + n + " linha(s) removida(s)");
    return n || 0;
  } catch (e) {
    console.warn("  ! " + tabela + ": " + e.message);
    return 0;
  }
}

async function main() {
  const nomes = String(process.argv[2] || PADRAO)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log("Nexo · limpeza de dados de teste (driver: " + db.name + ")");

  const users = [];
  for (const nome of nomes) {
    const rows = await db.select("users", { where: { username: nome }, limit: 5 });
    if (rows && rows.length) users.push(rows[0]);
    else log("conta não encontrada: " + nome);
  }
  if (!users.length) {
    console.log("Nada a limpar: nenhuma das contas existe no banco.");
    return 0;
  }

  const ids = users.map((u) => u.id);
  log("contas alvo: " + users.map((u) => "@" + u.username).join(", "));

  /* ---- mensagens (canal e DM) ---- */
  await remover("messages", { authorId: ids });

  /* ---- notificações e social ---- */
  await remover("notifications", { userId: ids });
  await remover("friend_requests", { senderId: ids });
  await remover("friend_requests", { receiverId: ids });
  await remover("friendships", { userAId: ids });
  await remover("friendships", { userBId: ids });
  await remover("blocks", { blockerId: ids });
  await remover("blocks", { blockedId: ids });

  /* ---- conversas diretas (remove dm_members e message_reads junto) ---- */
  const membros = await db
    .select("dm_members", { where: { userId: ids }, limit: 200 })
    .catch(() => []);
  const dmIds = (membros || []).map((m) => m.conversationId).filter(Boolean);
  if (dmIds.length) await remover("dms", { id: dmIds });

  /* ---- servidores de teste (criados por estas contas) ---- */
  const servers = await db
    .select("servers", { where: { ownerId: ids }, limit: 100 })
    .catch(() => []);
  for (const sv of servers || []) {
    log("servidor: " + (sv.name || sv.id));
    await remover("invites", { serverId: sv.id });
    await remover("bans", { serverId: sv.id });
    await remover("logs", { serverId: sv.id });
    await remover("channels", { serverId: sv.id });
    await remover("categories", { serverId: sv.id });
    await remover("roles", { serverId: sv.id });
    await remover("memberships", { serverId: sv.id }); /* limpa member_roles */
    await remover("servers", { id: sv.id });
  }

  /* ---- presença/preferências e, por fim, as contas ---- */
  await remover("presence", { userId: ids });
  await remover("prefs", { userId: ids });
  await remover("users", { id: ids });

  console.log("Limpeza concluída.");
  return 0;
}

main()
  .then((code) => process.exit(code || 0))
  .catch((e) => {
    console.error("Falha na limpeza: " + e.message);
    process.exit(1);
  });
