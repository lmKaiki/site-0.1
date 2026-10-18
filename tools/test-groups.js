"use strict";
/* ============================================================
   NEXO · teste dos GRUPOS PRIVADOS nas DMs
   Comprovo, com contas REAIS, cada requisito do sistema:
   1. criar grupo com 2 participantes (criador + 1);
   2. adicionar até 10 no total, com memberCount verdadeiro;
   3. contagem "N/10" vem do backend (memberCount);
   4. o 11.º participante é bloqueado (400);
   5. entradas SIMULTÂNEAS com 1 vaga: exatamente 1 vence;
   6. sair/remover libera vaga (volta a aceitar);
   7. quem não está no grupo não lê nem escreve (404) e não vê
      o grupo no sync; membro removido perde acesso na hora;
   8. persistência: estado bate no banco depois de cada operação;
   9. permissões: só o administrador adiciona/remove/edita; mensagens
      de sistema vêm do servidor (type "system") e não são forjáveis;
   10. admin que sai transfere a administração; último não sai;
       conversas 1:1 continuam intactas (regressão).
   Roda com NEXO_DB=sqlite (colunas da migração 0004 no DDL local).
   Uso:  node tools/test-groups.js
   ============================================================ */

process.env.NEXO_DB = process.env.NEXO_DB || "sqlite";

const { register, dispatch } = require("../server/router");

register([
  require("../server/handlers/auth"),
  require("../server/handlers/social"),
  require("../server/handlers/servers"),
  require("../server/handlers/messages"),
  require("../server/handlers/sync"),
]);

let pass = 0;
let fail = 0;
const created = { users: [], dms: [] };

function ok(label, condition, detail) {
  if (condition) {
    pass++;
    console.log("  ✔ " + label);
  } else {
    fail++;
    console.log("  ✘ " + label + (detail ? "  → " + detail : ""));
  }
}

async function call(method, path, body, cookie) {
  const res = await dispatch({
    httpMethod: method,
    path: path.indexOf("/api") === 0 ? path : "/api" + path,
    queryStringParameters: {},
    headers: cookie ? { cookie: cookie } : {},
    body: body === undefined ? null : JSON.stringify(body),
    isBase64Encoded: false,
  });
  let json = {};
  try {
    json = JSON.parse(res.body);
  } catch (e) {}
  let cookieOut = null;
  const sc = res.multiValueHeaders && res.multiValueHeaders["Set-Cookie"];
  if (sc && sc.length) cookieOut = sc[0].split(";")[0];
  return { status: res.statusCode, json, cookie: cookieOut };
}

function rnd(n) {
  return Math.random().toString(36).slice(2, 2 + (n || 6));
}

function err(r) {
  return String((r.json && r.json.error) || "");
}

async function signup(name) {
  const r = await call("POST", "/auth/signup", {
    username: name,
    password: "SenhaForte#123",
    confirm: "SenhaForte#123",
  });
  created.users.push(r.json.data.user);
  return { user: r.json.data.user, cookie: r.cookie, status: r.status };
}

/* contagem REAL no banco (linhas de dm_members) */
async function actualMembers(dmId) {
  const db = require("../server/db");
  return db.count("dm_members", { where: { conversationId: dmId } });
}

/* memberCount guardado na conversa (o que a interface mostra) */
async function storedCount(dmId) {
  const db = require("../server/db");
  const rows = await db.select("dms", { where: { id: dmId }, limit: 1 });
  return rows && rows[0] && rows[0].memberCount != null
    ? Number(rows[0].memberCount)
    : null;
}

async function expectCount(label, dmId, expected) {
  const real = await actualMembers(dmId);
  const stored = await storedCount(dmId);
  ok(
    label + " (real=" + real + ", guardado=" + stored + ", esperado=" + expected + ")",
    real === expected && stored === expected,
    "divergência de contagem"
  );
}

async function cleanup() {
  const db = require("../server/db");
  for (const dmId of created.dms) {
    await db.remove("dm_members", { where: { conversation_id: dmId } }).catch(() => {});
    await db.remove("message_reads", { where: { conversation_id: dmId } }).catch(() => {});
    await db.remove("messages", { where: { channel_id: dmId } }).catch(() => {});
    await db.remove("dms", { where: { id: dmId } }).catch(() => {});
  }
  const ids = created.users.map((x) => x.id);
  if (!ids.length) return;
  await db.remove("notifications", { where: { user_id: ids } }).catch(() => {});
  await db.remove("presence", { where: { user_id: ids } }).catch(() => {});
  await db.remove("prefs", { where: { user_id: ids } }).catch(() => {});
  await db.remove("friendships", { where: { user_id: ids } }).catch(() => {});
  await db.remove("friend_requests", { where: { receiver_id: ids } }).catch(() => {});
  await db.remove("users", { where: { id: ids } }).catch(() => {});
}

async function main() {
  /* ---------------- 1. contas reais ---------------- */
  console.log("\n== 1. contas reais ==");
  const A = await signup("grp" + rnd(6)); /* criador/admin */
  const B = await signup("grp" + rnd(6)); /* segundo membro */
  const C = await signup("grp" + rnd(6));
  const D = await signup("grp" + rnd(6));
  const E = await signup("grp" + rnd(6));
  const F = await signup("grp" + rnd(6));
  const G = await signup("grp" + rnd(6));
  const H = await signup("grp" + rnd(6));
  const I = await signup("grp" + rnd(6));
  const J = await signup("grp" + rnd(6));
  const K = await signup("grp" + rnd(6));
  const L = await signup("grp" + rnd(6));
  const M = await signup("grp" + rnd(6));
  const P = await signup("grp" + rnd(6)); /* grupo de 2 (último membro) */
  const Z = await signup("grp" + rnd(6)); /* nunca entra em grupo algum */
  const cA = A.cookie, cB = B.cookie, cC = C.cookie;
  ok("15 contas criadas", [A, B, C, D, E, F, G, H, I, J, K, L, M, P, Z].every((x) => x.status === 201));

  /* ---------------- 2. criação ---------------- */
  console.log("\n== 2. criação do grupo ==");
  const noName = await call("POST", "/dms/groups", { name: "", userIds: [B.user.id] }, cA);
  ok("grupo sem nome é recusado (400)", noName.status === 400, "status=" + noName.status);
  const alone = await call("POST", "/dms/groups", { name: "Só eu", userIds: [] }, cA);
  ok("grupo com 1 participante é recusado (400)", alone.status === 400, "status=" + alone.status);
  const dup = await call("POST", "/dms/groups", { name: "Repetido", userIds: [B.user.id, B.user.id] }, cA);
  created.dms.push(dup.json.data && dup.json.data.id);
  ok(
    "mesmo usuário duas vezes é deduplicado (conta 1 vez)",
    dup.status === 201 &&
      !!(dup.json.data && Number(dup.json.data.memberCount) === 2) &&
      !!(dup.json.data && dup.json.data.participants.filter((p) => p === B.user.id).length === 1),
    "status=" + dup.status + " " + err(dup)
  );

  const cr = await call("POST", "/dms/groups", {
    name: "Time do teste",
    userIds: [B.user.id],
    icon: { emoji: "🎮", color: "#35e0a8" },
  }, cA);
  const g = cr.json.data;
  created.dms.push(g && g.id);
  ok("grupo criado (201)", cr.status === 201 && !!g && !!g.id, JSON.stringify(cr.json).slice(0, 160));
  ok("id é uma conversa dm_", !!(g && String(g.id).indexOf("dm_") === 0), g && g.id);
  ok("isGroup ligado", !!(g && g.isGroup));
  ok("admin é o criador", !!(g && g.adminId === A.user.id), g && g.adminId);
  ok("memberCount inicial = 2", g && Number(g.memberCount) === 2, g && g.memberCount);
  ok("participantes = criador + convidado", !!(g && g.participants.indexOf(A.user.id) > -1 && g.participants.indexOf(B.user.id) > -1));
  ok("ícone aceito", !!(g && g.icon && g.icon.emoji === "🎮"), JSON.stringify(g && g.icon));
  const gid = g.id;
  await expectCount("contagem real = 2", gid, 2);

  /* mensagem de sistema de criação */
  const msgs0 = await call("GET", "/dms/" + gid + "/messages", null, cA);
  const sys0 = (msgs0.json.data || []).filter((m) => m.type === "system");
  ok("criação gerou mensagem de sistema", sys0.length === 1 && /criou o grupo/.test(sys0[0].content), JSON.stringify(sys0).slice(0, 120));

  /* ---------------- 3. adicionar até 10 ---------------- */
  console.log("\n== 3. preencher até 10 participantes ==");
  const rest = [C, D, E, F, G, H, I];
  for (const who of rest) {
    const add = await call("POST", "/dms/" + gid + "/members", { userId: who.user.id }, cA);
    ok("admin adicionou @" + who.user.username, add.status < 300, "status=" + add.status + " " + err(add));
  }
  await expectCount("9 participantes (vaga única restante)", gid, 9);
  const dmNow = (await call("GET", "/dms", null, cB)).json.data.find((d) => d.id === gid);
  ok("B vê o grupo na lista com memberCount", !!(dmNow && Number(dmNow.memberCount) === 9), JSON.stringify(dmNow && dmNow.memberCount));

  /* ---------------- 4. corrida: 3 tentativas, 1 vaga ---------------- */
  console.log("\n== 4. entradas simultâneas com 1 vaga ==");
  const race = await Promise.all([
    call("POST", "/dms/" + gid + "/members", { userId: J.user.id }, cA),
    call("POST", "/dms/" + gid + "/members", { userId: K.user.id }, cA),
    call("POST", "/dms/" + gid + "/members", { userId: L.user.id }, cA),
  ]);
  const winners = race.filter((r) => r.status < 300);
  const blocked = race.filter((r) => r.status === 400);
  ok("exatamente 1 entrada venceu a corrida", winners.length === 1, "vencedores=" + winners.length);
  ok("as outras foram bloqueadas como 'cheio'", blocked.length === 2 && blocked.every((r) => /cheio/i.test(err(r))), blocked.map(err).join(" | "));
  await expectCount("contagem parou em 10 (nunca 11)", gid, 10);

  /* ---------------- 5. limite rígido ---------------- */
  console.log("\n== 5. o 11.º participante ==");
  const eleventh = await call("POST", "/dms/" + gid + "/members", { userId: M.user.id }, cA);
  ok("11.º bloqueado (400 cheio)", eleventh.status === 400 && /cheio/i.test(err(eleventh)), "status=" + eleventh.status + " " + err(eleventh));
  await expectCount("contagem continua 10", gid, 10);
  const again = await call("POST", "/dms/" + gid + "/members", { userId: C.user.id }, cA);
  ok("adicionar quem já está é idempotente (sem erro, sem +1)", again.status < 300, "status=" + again.status + " " + err(again));
  await expectCount("mesmo idempotente não infla a contagem", gid, 10);

  /* ---------------- 6. permissões de administrador ---------------- */
  console.log("\n== 6. só o administrador administra ==");
  const noAdd = await call("POST", "/dms/" + gid + "/members", { userId: M.user.id }, cB);
  ok("membro comum não adiciona (403)", noAdd.status === 403, "status=" + noAdd.status);
  const noRm = await call("DELETE", "/dms/" + gid + "/members/" + D.user.id, null, cB);
  ok("membro comum não remove (403)", noRm.status === 403, "status=" + noRm.status);
  const noEdit = await call("PATCH", "/dms/" + gid + "/group", { name: "Hackeado" }, cB);
  ok("membro comum não renomeia (403)", noEdit.status === 403, "status=" + noEdit.status);
  const rename = await call("PATCH", "/dms/" + gid + "/group", { name: "Squad do Nexo" }, cA);
  ok("admin renomeia (200)", rename.status === 200 && rename.json.data.name === "Squad do Nexo", err(rename));
  const badIcon = await call("PATCH", "/dms/" + gid + "/group", { icon: { image: "https://x.com/a.png" } }, cA);
  ok("ícone com URL externa é recusado (400)", badIcon.status === 400, "status=" + badIcon.status);
  const noName2 = await call("PATCH", "/dms/" + gid + "/group", { name: "   " }, cA);
  ok("nome vazio na edição é recusado (400)", noName2.status === 400, "status=" + noName2.status);

  /* ---------------- 7. fora do grupo não vê nada ---------------- */
  console.log("\n== 7. privacidade: quem não está, não vê ==");
  const zMembers = await call("GET", "/dms/" + gid + "/members", null, Z.cookie);
  ok("Z não lista membros (404)", zMembers.status === 404, "status=" + zMembers.status);
  const zMsgs = await call("GET", "/dms/" + gid + "/messages", null, Z.cookie);
  ok("Z não lê mensagens (404)", zMsgs.status === 404, "status=" + zMsgs.status);
  const zSend = await call("POST", "/dms/" + gid + "/messages", { content: "vazando" }, Z.cookie);
  ok("Z não envia mensagem (404)", zSend.status === 404, "status=" + zSend.status);
  const zLeave = await call("POST", "/dms/" + gid + "/leave", {}, Z.cookie);
  ok("Z não sai de grupo alheio (404)", zLeave.status === 404, "status=" + zLeave.status);
  const syncZ = await call("GET", "/sync", null, Z.cookie);
  const dmsZ = Object.values((syncZ.json.data && syncZ.json.data.dms) || {});
  ok("grupo NÃO aparece no sync de Z", !dmsZ.some((d) => d.id === gid), "vazou no sync");

  /* ---------------- 8. mensagens no grupo ---------------- */
  console.log("\n== 8. mensagens e eventos de sistema ==");
  const sendB = await call("POST", "/dms/" + gid + "/messages", { content: "bora treinar hoje?" }, cB);
  ok("membro comum envia no grupo (201)", sendB.status === 201, err(sendB));
  const forge = await call("POST", "/dms/" + gid + "/messages", { content: "evento falso", type: "system" }, cB);
  ok("conta não forja mensagem de sistema (type=user)", forge.status === 201 && forge.json.data.type === "user", forge.json.data && forge.json.data.type);
  const listMsgs = await call("GET", "/dms/" + gid + "/messages", null, cC);
  const all = listMsgs.json.data || [];
  ok("histórico tem eventos de sistema (type=system)", all.some((m) => m.type === "system" && /adicionou/.test(m.content)), "sem eventos de adição");
  ok("histórico tem a mensagem de pessoa", all.some((m) => m.type === "user" && m.content === "bora treinar hoje?"));
  const sysAll = all.filter((m) => m.type === "system");
  ok("sistema registrou renomear", sysAll.some((m) => /mudou o nome/.test(m.content)), "sem evento de renomear");

  /* notificação para cada membro (silêncio é por pessoa).
     No sqlite o meta vem como string JSON (quirk antigo do mapeamento
     jsonb × alias); no Supabase chega como objeto. O teste aceita os
     dois, como a interface já aceita. */
  const metaOf = (n) => {
    if (n.meta && typeof n.meta === "object") return n.meta;
    if (typeof n.meta === "string") {
      try {
        return JSON.parse(n.meta);
      } catch (e) {}
    }
    return {};
  };
  const notesOf = (syncJson, dmId) =>
    ((syncJson.data && syncJson.data.notifications) || []).filter(
      (n) => n.type === "dm" && metaOf(n).href === "#/mensagens/" + dmId
    ).length;
  /* A envia → C (que está no grupo) recebe a notificação */
  const sendA = await call("POST", "/dms/" + gid + "/messages", { content: "combinado" }, cA);
  ok("A envia no grupo (201)", sendA.status === 201, "status=" + sendA.status + " " + err(sendA));
  const syncC1 = await call("GET", "/sync", null, cC);
  ok(
    "C recebeu notificação da mensagem do grupo",
    notesOf(syncC1.json, gid) >= 1,
    "C tem " + notesOf(syncC1.json, gid) + " notificações do grupo"
  );
  /* B silencia → a próxima mensagem do grupo não notifica mais B
     (enviada por A, que é membro e não está silenciada) */
  await call("POST", "/dms/" + gid + "/mute", { muted: true }, cB);
  const syncB1 = await call("GET", "/sync", null, cB);
  const beforeB = notesOf(syncB1.json, gid);
  await call("POST", "/dms/" + gid + "/messages", { content: "depois do silencio" }, cA);
  const syncB2 = await call("GET", "/sync", null, cB);
  const afterB = notesOf(syncB2.json, gid);
  ok("grupo silenciado não notifica quem silenciou", beforeB === afterB, beforeB + " → " + afterB);
  /* C NÃO silenciou: a mesma mensagem notifica C */
  const syncC2 = await call("GET", "/sync", null, cC);
  ok("quem não silenciou continua sendo notificado", notesOf(syncC2.json, gid) >= notesOf(syncC1.json, gid) + 1);
  await call("POST", "/dms/" + gid + "/mute", { muted: false }, cB);

  /* ---------------- 9. remover libera vaga ---------------- */
  console.log("\n== 9. remoção e vaga liberada ==");
  const rm = await call("DELETE", "/dms/" + gid + "/members/" + E.user.id, null, cA);
  ok("admin removeu E (200)", rm.status < 300, err(rm));
  await expectCount("vaga liberada (9)", gid, 9);
  const eReads = await call("GET", "/dms/" + gid + "/messages", null, E.cookie);
  ok("E removido perdeu o acesso ao histórico (404)", eReads.status === 404, "status=" + eReads.status);
  const syncE = await call("GET", "/sync", null, E.cookie);
  const dmsE = Object.values((syncE.json.data && syncE.json.data.dms) || {});
  ok("grupo saiu do sync de E", !dmsE.some((d) => d.id === gid), "continuou no sync");
  const addM = await call("POST", "/dms/" + gid + "/members", { userId: M.user.id }, cA);
  ok("nova entrada aceita após a remoção (201)", addM.status === 201, "status=" + addM.status + " " + err(addM));
  await expectCount("contagem voltou a 10", gid, 10);
  const rmSelf = await call("DELETE", "/dms/" + gid + "/members/" + A.user.id, null, cA);
  ok("admin não se 'remove': usa sair (400)", rmSelf.status === 400, "status=" + rmSelf.status);

  /* ---------------- 10. sair e transferir administração ---------------- */
  console.log("\n== 10. sair do grupo e transferência ==");
  const hLeave = await call("POST", "/dms/" + gid + "/leave", {}, H.cookie);
  ok("H saiu (200)", hLeave.status < 300 && hLeave.json.data.left === true, err(hLeave));
  await expectCount("sair liberou vaga (9)", gid, 9);
  const aLeave = await call("POST", "/dms/" + gid + "/leave", {}, cA);
  ok("A (admin) saiu (200)", aLeave.status < 300, err(aLeave));
  await expectCount("admin saiu (8)", gid, 8);
  const afterLeave = (await call("GET", "/dms", null, cB)).json.data.find((d) => d.id === gid);
  ok("administração herdada por um membro restante", !!(afterLeave && afterLeave.adminId && afterLeave.adminId !== A.user.id && afterLeave.participants.indexOf(afterLeave.adminId) > -1), JSON.stringify(afterLeave && afterLeave.adminId));
  const msgsLeave = (await call("GET", "/dms/" + gid + "/messages", null, cC)).json.data.filter((m) => m.type === "system");
  ok("transferência registrada em sistema", msgsLeave.some((m) => /passou a administração/.test(m.content)), "sem registro");
  const exAdmin = await call("POST", "/dms/" + gid + "/members", { userId: P.user.id }, cA);
  ok(
    "ex-admin não adiciona mais (404/403)",
    exAdmin.status === 404 || exAdmin.status === 403,
    "status=" + exAdmin.status
  );
  const newAdminId = afterLeave.adminId;
  const cNewAdmin = { [B.user.id]: cB, [C.user.id]: cC, [D.user.id]: D.cookie, [F.user.id]: F.cookie, [G.user.id]: G.cookie, [I.user.id]: I.cookie, [J.user.id]: J.cookie, [K.user.id]: K.cookie, [L.user.id]: L.cookie, [M.user.id]: M.cookie }[newAdminId];
  const newAdd = await call("POST", "/dms/" + gid + "/members", { userId: P.user.id }, cNewAdmin);
  ok("novo admin continua administrando (201)", newAdd.status === 201, "status=" + newAdd.status + " " + err(newAdd));
  await expectCount("vaga usada pelo novo admin (9)", gid, 9);

  /* ---------------- 11. último membro não sai ---------------- */
  console.log("\n== 11. grupo de 2 e último membro ==");
  const cr2 = await call("POST", "/dms/groups", { name: "Duo", userIds: [P.user.id] }, cA);
  const g2 = cr2.json.data;
  created.dms.push(g2 && g2.id);
  ok("segundo grupo criado", cr2.status === 201, err(cr2));
  const pLeave = await call("POST", "/dms/" + g2.id + "/leave", {}, P.cookie);
  ok("P saiu do duo (200)", pLeave.status < 300, err(pLeave));
  await expectCount("A ficou sozinho (1)", g2.id, 1);
  const lastLeave = await call("POST", "/dms/" + g2.id + "/leave", {}, cA);
  ok("último membro não sai (400)", lastLeave.status === 400, "status=" + lastLeave.status);
  await expectCount("grupo de 1 intacto", g2.id, 1);

  /* ---------------- 12. regressão: conversa 1:1 ---------------- */
  console.log("\n== 12. conversa 1:1 continua intacta ==");
  const dm11 = await call("POST", "/dms", { userId: P.user.id }, cA);
  const dm11id = dm11.json.data && dm11.json.data.id;
  created.dms.push(dm11id);
  ok("1:1 aberta (201)", dm11.status === 201, err(dm11));
  ok("1:1 NÃO é grupo", !(dm11.json.data && dm11.json.data.isGroup), JSON.stringify(dm11.json.data && dm11.json.data.isGroup));
  const s11 = await call("POST", "/dms/" + dm11id + "/messages", { content: "alo" }, cA);
  ok("1:1 envia mensagem (201)", s11.status === 201 && s11.json.data.type === "user", err(s11));
  await expectCount("1:1 com 2 participantes", dm11id, 2);
}

main()
  .then(async () => {
    console.log("\n---------------------------------------------");
    console.log("  pass=" + pass + "  fail=" + fail);
    console.log("---------------------------------------------\n");
  })
  .catch((e) => {
    fail++;
    console.error("ERRO FATAL:", e && e.message, e && e.stack);
  })
  .finally(async () => {
    try {
      await cleanup();
      console.log("limpeza de dados de teste concluída.");
    } catch (e) {
      console.warn("cleanup:", e && e.message);
    }
    process.exit(fail ? 1 : 0);
  });
