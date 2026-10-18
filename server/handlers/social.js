"use strict";
/* ============================================================
   NEXO · server/handlers/social
   Amigos, solicitações, bloqueios e mensagens diretas.
   Cada mutação devolve { data, patch }: o data é o valor que a
   view já espera e o patch é o que o cache local precisa
   aplicar para a tela continuar coerente sem recarregar.
   ============================================================ */

const db = require("../db");
const auth = require("../auth");
const u = require("../util");
const P = require("../patch");
const R = require("../relations");
const handlersAuth = require("./auth");
const { ApiError, bad, forbidden, notFound } = require("../errors");

function now() {
  return Date.now();
}

async function getUser(id) {
  const rows = await db.select("users", { where: { id }, limit: 1 });
  return rows && rows[0] ? rows[0] : null;
}

async function friendListOf(userId, viewerId, friendOfViewer) {
  const a = await db.select("friendships", { where: { user_a_id: userId }, limit: 2000 });
  const b = await db.select("friendships", { where: { user_b_id: userId }, limit: 2000 });
  const all = (a || []).concat(b || []);
  const ids = all.map((fr) => (fr.userAId === userId ? fr.userBId : fr.userAId));
  if (!ids.length) return [];
  const users = await db.select("users", { where: { id: ids }, limit: 2000 });
  const byId = {};
  (users || []).forEach((x) => (byId[x.id] = x));
  return ids
    .map((id) => byId[id])
    .filter(Boolean)
    .map((x) => auth.publicUser(x, viewerId, { friend: !!friendOfViewer }))
    .sort((a2, b2) => String(a2.displayName || "").localeCompare(String(b2.displayName || "")));
}

/* ============================ ROTAS ============================ */
function routes() {
  return [
    ["GET", "/friends", listFriends],
    ["GET", "/friends/requests", listFriendRequests],
    ["GET", "/friends/state", friendStateRoute],
    ["POST", "/friends/request", sendFriendRequest],
    ["POST", "/friends/accept", acceptFriendRequest],
    ["POST", "/friends/reject", rejectFriendRequest],
    ["POST", "/friends/cancel", cancelFriendRequest],
    ["POST", "/friends/remove", removeFriend],
    ["POST", "/blocks", blockUser],
    ["POST", "/blocks/remove", unblockUser],
    ["GET", "/dms", listDMs],
    ["POST", "/dms", openDM],
    ["POST", "/dms/groups", createGroup],
    ["GET", "/dms/:id/messages", dmMessages],
    ["POST", "/dms/:id/messages", dmSendMessage],
    ["POST", "/dms/:id/read", dmMarkRead],
    ["POST", "/dms/:id/mute", dmMute],
    ["POST", "/dms/:id/archive", dmArchive],
    ["GET", "/dms/:id/members", groupMembers],
    ["POST", "/dms/:id/members", groupAddMember],
    ["DELETE", "/dms/:id/members/:userId", groupRemoveMember],
    ["POST", "/dms/:id/leave", groupLeave],
    ["PATCH", "/dms/:id/group", groupEdit],
  ];
}

async function listFriends(ctx) {
  const me = await auth.requireUser(ctx.event);
  const ownerId = (ctx.query && ctx.query.userId) || me.id;
  const owner = ownerId === me.id ? me : await getUser(ownerId);
  if (!owner) throw notFound("Usuário não encontrado.");

  if (owner.id !== me.id && !(await R.areFriends(me.id, owner.id))) {
    /* sem amizade só vemos os amigos em comum */
    const mine = await friendListOf(me.id, me.id, true);
    const theirs = await friendListOf(owner.id, me.id, false);
    const have = {};
    mine.forEach((x) => (have[x.id] = true));
    return { data: theirs.filter((x) => have[x.id]) };
  }
  return { data: await friendListOf(owner.id, me.id, owner.id === me.id) };
}

async function listFriendRequests(ctx) {
  const me = await auth.requireUser(ctx.event);
  const kind = (ctx.query && ctx.query.kind) === "sent" ? "sent" : "received";
  const column = kind === "sent" ? "sender_id" : "receiver_id";
  const rows = await db.select("friend_requests", {
    where: { [column]: me.id, status: "pending" },
    order: "createdAt",
    limit: 100,
  });
  const out = [];
  for (const r of rows || []) {
    const otherId = kind === "sent" ? r.receiverId : r.senderId;
    const other = await getUser(otherId);
    if (!other) continue;
    out.push({ request: r, user: auth.publicUser(other, me.id) });
  }
  return { data: out };
}

async function friendStateRoute(ctx) {
  const me = await auth.requireUser(ctx.event);
  const otherId = (ctx.query && ctx.query.userId) || "";
  return { data: await R.friendState(me.id, otherId) };
}

async function sendFriendRequest(ctx) {
  const me = await auth.requireUser(ctx.event);
  const target = String((ctx.body || {}).userId || "").trim();
  if (!target) throw bad("Não encontramos ninguém com esse @username.");

  let other = null;
  if (target.indexOf("u_") === 0) other = await getUser(target);
  if (!other) {
    const rows = await db.select("users", {
      where: { username: u.normalizeUsername(target.replace(/^@/, "")) },
      limit: 1,
    });
    other = rows && rows[0] ? rows[0] : null;
  }
  if (!other) throw bad("Não encontramos ninguém com esse @username.");
  /* conta de SISTEMA da plataforma não é pessoa: não recebe pedido */
  if (other.system === true) throw bad("Não encontramos ninguém com esse @username.");

  const check = await R.canSendFriendRequest(me.id, other.id);
  if (!check.ok) throw bad(check.reason);

  const req = {
    id: u.uid("frq"),
    senderId: me.id,
    receiverId: other.id,
    status: "pending",
    createdAt: now(),
    updatedAt: now(),
  };
  await db.insert("friend_requests", req);

  const note = await handlersAuth.createNotification(
    other.id,
    "friend",
    "@" + me.username + " enviou uma solicitação de amizade.",
    { href: "#/amigos/recebidas", actorId: me.id, requestId: req.id }
  );

  const patch = P.createPatch();
  P.set(patch, "friendRequests", req.id, req);
  P.set(patch, "users", other.id, auth.publicUser(other, me.id));
  P.set(patch, "notifications", note.id, note);
  return { status: 201, data: req, patch };
}

async function loadPendingRequest(id, userId, asReceiver) {
  const rows = await db.select("friend_requests", { where: { id }, limit: 1 });
  const req = rows && rows[0];
  if (!req || req.status !== "pending")
    throw notFound("Esta solicitação de amizade não existe mais.");
  const expected = asReceiver ? req.receiverId : req.senderId;
  if (expected !== userId) {
    throw forbidden(
      asReceiver ? "Esta solicitação não é para você." : "Você não pode executar esta ação."
    );
  }
  return req;
}

async function acceptFriendRequest(ctx) {
  const me = await auth.requireUser(ctx.event);
  const req = await loadPendingRequest((ctx.body || {}).requestId, me.id, true);

  const key = R.friendKey(req.senderId, req.receiverId);
  const existing = await db.select("friendships", { where: { id: key }, limit: 1 });
  let friendship = existing && existing[0];
  if (!friendship) {
    friendship = {
      id: key,
      userAId: req.senderId,
      userBId: req.receiverId,
      createdAt: now(),
    };
    await db.insert("friendships", friendship);
  }
  await db.update(
    "friend_requests",
    { where: { id: req.id } },
    { status: "accepted", acceptedAt: now(), updatedAt: now() }
  );
  const updated = Object.assign({}, req, { status: "accepted", acceptedAt: now() });

  const note = await handlersAuth.createNotification(
    req.senderId,
    "friend",
    "Agora você e @" + me.username + " são amigos!",
    { href: "#/amigos", actorId: me.id }
  );

  const other = await getUser(req.senderId);
  const patch = P.createPatch();
  P.set(patch, "friendships", key, friendship);
  P.set(patch, "friendRequests", req.id, updated);
  P.set(patch, "users", other.id, auth.publicUser(other, me.id, { friend: true }));
  P.set(patch, "notifications", note.id, note);
  return { data: { friendship, user: other ? auth.publicUser(other, me.id, { friend: true }) : null }, patch };
}

async function rejectFriendRequest(ctx) {
  const me = await auth.requireUser(ctx.event);
  const req = await loadPendingRequest((ctx.body || {}).requestId, me.id, true);
  await db.update(
    "friend_requests",
    { where: { id: req.id } },
    { status: "rejected", rejectedAt: now(), updatedAt: now() }
  );
  const patch = P.createPatch();
  P.del(patch, "friendRequests", [req.id]);
  return { data: true, patch };
}

async function cancelFriendRequest(ctx) {
  const me = await auth.requireUser(ctx.event);
  const req = await loadPendingRequest((ctx.body || {}).requestId, me.id, false);
  await db.remove("friend_requests", { where: { id: req.id } });
  const patch = P.createPatch();
  P.del(patch, "friendRequests", [req.id]);
  return { data: true, patch };
}

async function removeFriend(ctx) {
  const me = await auth.requireUser(ctx.event);
  const otherId = (ctx.body || {}).userId;
  const fr = await R.friendshipOf(me.id, otherId);
  if (!fr) throw bad("Vocês não são amigos.");
  await db.remove("friendships", { where: { id: fr.id } });
  const patch = P.createPatch();
  P.del(patch, "friendships", [fr.id]);
  return { data: true, patch };
}

async function blockUser(ctx) {
  const me = await auth.requireUser(ctx.event);
  const otherId = (ctx.body || {}).userId;
  if (!otherId || otherId === me.id) throw bad("Você não pode bloquear a si mesmo.");
  const other = await getUser(otherId);
  if (!other) throw notFound("Usuário não encontrado.");

  const existing = await db.select("blocks", {
    where: { blocker_id: me.id, blocked_id: otherId },
    limit: 1,
  });
  if (!existing || !existing.length) {
    await db.insert("blocks", {
      id: me.id + ":" + otherId,
      blockerId: me.id,
      blockedId: otherId,
      createdAt: now(),
    });
  }
  const list = await R.blocksOf(me.id);
  const patch = P.createPatch();
  const mine = await getUser(me.id);
  const shape = auth.publicUser(mine);
  shape.blocks = list;
  P.set(patch, "users", me.id, shape);
  return { data: true, patch };
}

async function unblockUser(ctx) {
  const me = await auth.requireUser(ctx.event);
  const otherId = (ctx.body || {}).userId;
  await db.remove("blocks", { where: { blocker_id: me.id, blocked_id: otherId } });
  const list = await R.blocksOf(me.id);
  const mine = await getUser(me.id);
  const shape = auth.publicUser(mine);
  shape.blocks = list;
  const patch = P.createPatch();
  P.set(patch, "users", me.id, shape);
  return { data: true, patch };
}

/* ---------------------------- DMs ---------------------------- */
/* Uma "pessoa de verdade": apps e bots têm identidade em `apps` /
   `server_apps` e NUNCA em `users`, mas defendemos na porta mesmo
   assim (ids de app/bot e qualquer flag de máquina são recusados). */
function isPerson(u) {
  if (!u || !u.id) return false;
  if (u.isBot === true || u.kind === "app" || u.type === "app" || u.bot === true) return false;
  /* conta de SISTEMA da plataforma (ex.: dono do Servidor Oficial):
     não conversa, não recebe pedido nem DM */
  if (u.system === true) return false;
  if (/^(app|bot)_/i.test(String(u.id))) return false;
  return true;
}

async function dmRowsFor(userId) {
  const list = await db.select("dms", { limit: 500 });
  return (list || []).filter(
    (d) => Array.isArray(d.participants) && d.participants.indexOf(userId) !== -1
  );
}

async function listDMs(ctx) {
  const me = await auth.requireUser(ctx.event);
  const list = await dmRowsFor(me.id);
  const muted = await db.mutedDms(me.id);
  const hidden = await db.hiddenDms(me.id);
  list.forEach((dm) => {
    dm.muted = muted.indexOf(dm.id) !== -1;
    dm.hidden = hidden.indexOf(dm.id) !== -1;
  });
  /* conversas que EU ocultei não aparecem na lista normal. A conversa
     e as mensagens continuam intactas — `?all=1` devolve todas,
     inclusive as ocultas (é por aí que a tela de restaurar usa). */
  const all = ctx.query && (ctx.query.all === "1" || ctx.query.all === "true");
  if (!all) return { data: list.filter((d) => !d.hidden) };
  return { data: list };
}

/* tira a conversa da MINHA lista — não apaga mensagens nem toca nas
   conversas de outras pessoas */
async function dmArchive(ctx) {
  const me = await auth.requireUser(ctx.event);
  const id = ctx.params.id;
  const dm = await loadDM(id, me.id);
  const hidden = (ctx.body || {}).hidden !== false;
  const list = await db.setHiddenDm(me.id, dm.id, hidden);
  return { data: { dmId: dm.id, hidden: hidden, hiddenDms: list } };
}

async function loadDM(id, userId) {
  const rows = await db.select("dms", { where: { id }, limit: 1 });
  const dm = rows && rows[0];
  if (!dm || !Array.isArray(dm.participants) || dm.participants.indexOf(userId) === -1)
    throw notFound("Conversa não encontrada.");
  return dm;
}

async function openDM(ctx) {
  const me = await auth.requireUser(ctx.event);
  const otherId = (ctx.body || {}).userId;
  if (!otherId || otherId === me.id) throw bad("Você não pode conversar consigo mesmo.");
  const other = await getUser(otherId);
  if (!other) throw notFound("Usuário não encontrado.");
  /* apps/bots nunca viram conversa pessoal: a identidade deles mora
     em `apps`/`server_apps`, e aqui só existe pessoa de verdade */
  if (!isPerson(other))
    throw notFound("Apps e bots não abrem conversas diretas.");
  if (await R.blocksOf(me.id).then((l) => l.indexOf(otherId) !== -1))
    throw bad("Desbloqueie esta pessoa primeiro.");

  const id = R.dmIdFor(me.id, otherId);
  const rows = await db.select("dms", { where: { id }, limit: 1 });
  if (rows && rows.length) {
    /* abrir de propósito tira a conversa da lista de ocultas */
    const hidden = await db.hiddenDms(me.id);
    if (hidden.indexOf(id) !== -1) await db.setHiddenDm(me.id, id, false);
    return { data: rows[0] };
  }

  if (!(await R.canDM(me.id, otherId)))
    throw bad(R.dmPrivacyMessage(other));

  const dm = {
    id,
    participants: [me.id, otherId],
    /* contagem coerente também na conversa 1:1 (a migração 0004
       já faz o mesmo backfill nas conversas antigas) */
    memberCount: 2,
    muted: false,
    reads: {},
    createdAt: now(),
    updatedAt: now(),
  };
  await db.insert("dms", dm);
  const patch = P.createPatch();
  P.set(patch, "dms", id, dm);
  /* entre amigos a atividade "só amigos" aparece no cabeçalho */
  P.set(patch, "users", other.id, auth.publicUser(other, me.id, { friend: await R.areFriends(me.id, otherId) }));
  return { status: 201, data: dm, patch };
}

/* ============================================================
   GRUPOS PRIVADOS NAS MENSAGENS DIRETAS
   ------------------------------------------------------------
   Um grupo É uma conversa da mesma tabela `dms` com is_group = true:
   participantes continuam em dm_members e o histórico continua em
   dm_messages — nenhuma tabela nova, nenhum caminho paralelo.
   Regras (aplicadas AQUI no servidor, nunca só na interface):
   · mínimo 2 participantes na criação, máximo RÍGIDO de 10;
   · a vaga é disputada com comparação-e-troca + guarda
     member_count < 10 no MESMO statement (Postgres serializa por
     row lock; sqlite por statement atômico) — duas entradas
     simultâneas nunca passam de 10;
   · o mesmo usuário nunca conta duas vezes (pré-checagem + índice
     único em dm_members + reconciliação da contagem);
   · só o administrador (quem criou, ou quem herdou a administração)
     adiciona, remove, edita nome/ícone;
   · sair é livre; se o administrador sair, a administração passa
     para quem entrou mais cedo (determinístico, sem escolha);
   · o último membro não sai (grupo órfão não existe);
   · eventos importantes viram mensagens de sistema (type "system"),
     geradas só pelo servidor — quem digita não pode forjar.
   ============================================================ */
const GROUP_MAX = 10;

/* migração 0004 aplicada? Sem as colunas novas, gravar o grupo
   seria um falha QUIETA (campos apagados na hora do insert).
   Aqui vira 503 honesto, igual ao Bot Center. */
async function assertGroups() {
  let schema = null;
  try {
    schema = await db.schemaFor("dms");
  } catch (e) {
    schema = null;
  }
  const need = ["is_group", "name", "icon", "admin_id", "member_count"];
  const missing = need.filter((c) => !schema || !schema.size || !schema.has(c));
  if (!missing.length) return;
  throw new ApiError(
    503,
    "Os grupos privados ainda não foram implantados no banco: execute a migração " +
      "supabase/migrations/0004_group_dms.sql no Supabase (faltando: " +
      missing.join(", ") +
      "). Enquanto isso nenhum grupo é aberto — e nenhum é fingido como enviado.",
    "schema_pending"
  );
}

async function loadGroup(dmId, userId) {
  const dm = await loadDM(dmId, userId); /* participante? senão 404 */
  if (!dm.isGroup) throw notFound("Isto não é um grupo.");
  return dm;
}

function isGroupAdmin(dm, userId) {
  return !!dm.adminId && dm.adminId === userId;
}

function requireGroupAdmin(dm, userId) {
  if (!isGroupAdmin(dm, userId))
    throw forbidden("Somente o administrador do grupo pode fazer isto.");
}

/* ícone do grupo: mesmo formato do avatar ({emoji,color,image}),
   validado aqui — imagem só data:image e tamanho de ícone */
function groupIconOf(raw) {
  const empty = { emoji: null, color: null, image: null };
  if (raw === null || raw === undefined) return empty;
  if (typeof raw !== "object") throw bad("Ícone do grupo inválido.");
  const out = { emoji: null, color: null, image: null };
  const emoji = typeof raw.emoji === "string" ? raw.emoji.trim().slice(0, 8) : "";
  if (emoji) out.emoji = emoji;
  if (typeof raw.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(raw.color))
    out.color = raw.color;
  const image = typeof raw.image === "string" ? raw.image : "";
  if (image) {
    if (!/^data:image\//i.test(image))
      throw bad("Formato de imagem não suportado para o ícone do grupo.");
    if (image.length > 250000)
      throw bad("A imagem do ícone é grande demais (máximo aproximadamente 190 KB).");
    out.image = image;
  }
  return out;
}

/* mensagem de sistema: gravada pelo SERVIDOR com type "system".
   O envio normal força type "user" — não existe como uma conta
   forjar um evento de grupo. */
async function groupSystemMsg(dm, actorId, content) {
  const message = {
    id: u.uid("ms"),
    channelId: dm.id,
    conversationId: dm.id,
    authorId: actorId,
    senderId: actorId,
    content: String(content || "").slice(0, 300),
    type: "system",
    reactions: {},
    pinned: false,
    attachments: [],
    createdAt: now(),
    updatedAt: null,
  };
  await db.insert("messages", message);
  return message;
}

/* contagem REAL (linhas de dm_members = usuários distintos, graças
   ao índice único) reescrita na conversa: corrige qualquer
   transiente e mantém a interface em "N/10" verdadeiro */
async function recountGroup(dmId) {
  const n = await db.count("dm_members", { where: { conversationId: dmId } });
  await db.update("dms", { where: { id: dmId } }, { memberCount: n, updatedAt: now() });
  return n;
}

/* vaga ATÔMICA: comparação-e-troca (member_count = N que acabamos
   de ler) E guarda N < 10 no MESMO update. Se outra entrada mexeu
   entre a leitura e a escrita, o update não casa nenhuma linha e
   tentamos de novo com o valor fresco. Nunca soma a partir de um
   valor lido tempos atrás — é isso que impede passar de 10. */
async function claimGroupSlot(dmId) {
  for (let i = 0; i < 8; i++) {
    const rows = await db.select("dms", { where: { id: dmId }, limit: 1 });
    const cur = rows && rows[0];
    if (!cur) return false;
    let count = cur.memberCount;
    if (count === null || count === undefined || isNaN(Number(count)))
      count = await recountGroup(dmId);
    count = Number(count);
    if (count >= GROUP_MAX) return false;
    const n = await db.update(
      "dms",
      {
        where: { id: dmId, memberCount: count },
        op: { memberCount: { lt: GROUP_MAX } },
      },
      { memberCount: count + 1, updatedAt: now() }
    );
    if (n > 0) return true;
  }
  return false;
}

/* valida a pessoa que vai entrar: existe, é conta de verdade,
   não há bloqueio e a privacidade de DM dela permite */
async function assertGroupTarget(me, targetId) {
  const person = await getUser(targetId);
  if (!person || !isPerson(person)) throw notFound("Uma das pessoas selecionadas não existe mais.");
  if (await R.blocksOf(me.id).then((l) => l.indexOf(targetId) !== -1))
    throw bad("Você bloqueou @" + person.username + " — desbloqueie antes de convidar.");
  if (await R.blocksOf(targetId).then((l) => l.indexOf(me.id) !== -1))
    throw bad("@" + person.username + " não pode receber mensagens suas.");
  if (!(await R.canDM(me.id, targetId))) throw bad(R.dmPrivacyMessage(person));
  return person;
}

async function freshGroupPatch(dmId, extra) {
  const rows = await db.select("dms", { where: { id: dmId }, limit: 1 });
  const fresh = rows && rows[0] ? rows[0] : null;
  const patch = P.createPatch();
  if (fresh) P.set(patch, "dms", dmId, fresh);
  (extra || []).forEach((msg) => P.set(patch, "messages", msg.id, msg));
  return { fresh, patch };
}

async function createGroup(ctx) {
  const me = await auth.requireUser(ctx.event);
  await assertGroups();
  const body = ctx.body || {};
  const name = String(body.name || "").trim().slice(0, 64);
  if (!name) throw bad("Dê um nome ao grupo.");
  let ids = Array.isArray(body.userIds) ? body.userIds.map(String) : [];
  ids = ids.filter((x) => x && x !== me.id);
  ids = ids.filter((x, i) => ids.indexOf(x) === i); /* sem repetido */
  if (!ids.length)
    throw bad("Adicione pelo menos uma pessoa — o grupo começa com 2 participantes.");
  if (ids.length + 1 > GROUP_MAX)
    throw bad(
      "O limite é " + GROUP_MAX + " participantes no total (você + " + ids.length + " selecionados)."
    );
  for (let i = 0; i < ids.length; i++) await assertGroupTarget(me, ids[i]);

  const id = u.uid("dm");
  const dm = {
    id,
    isGroup: true,
    name,
    icon: groupIconOf(body.icon),
    adminId: me.id,
    memberCount: ids.length + 1,
    participants: [me.id].concat(ids),
    muted: false,
    reads: {},
    createdAt: now(),
    updatedAt: now(),
  };
  await db.insert("dms", dm);
  const sys = await groupSystemMsg(dm, me.id, "criou o grupo.");
  const out = await freshGroupPatch(id, [sys]);
  return { status: 201, data: out.fresh || dm, patch: out.patch };
}

async function groupMembers(ctx) {
  const me = await auth.requireUser(ctx.event);
  await assertGroups();
  const dm = await loadGroup(ctx.params.id, me.id);
  const users = await db.select("users", { where: { id: dm.participants }, limit: GROUP_MAX });
  return {
    data: {
      dmId: dm.id,
      adminId: dm.adminId,
      memberCount: dm.memberCount,
      max: GROUP_MAX,
      participants: dm.participants,
      users: (users || []).map((x) => auth.publicUser(x, me.id, {})),
    },
  };
}

async function groupAddMember(ctx) {
  const me = await auth.requireUser(ctx.event);
  await assertGroups();
  const dm = await loadGroup(ctx.params.id, me.id);
  requireGroupAdmin(dm, me.id);
  const targetId = String((ctx.body || {}).userId || "");
  if (!targetId) throw bad("Escolha a pessoa que vai entrar no grupo.");
  if (targetId === me.id) throw bad("Você já está no grupo.");
  if (dm.participants.indexOf(targetId) !== -1) {
    /* idempotente: já é membro — nada muda e nada é contado duas vezes */
    const out = await freshGroupPatch(dm.id, []);
    return { data: out.fresh || dm, patch: out.patch };
  }
  await assertGroupTarget(me, targetId);

  const ok = await claimGroupSlot(dm.id);
  if (!ok) throw bad("O grupo já está cheio (10/10 participantes).");

  let joined = false;
  try {
    await db.insert("dm_members", {
      conversationId: dm.id,
      userId: targetId,
      joinedAt: now(),
    });
    joined = true;
  } catch (e) {
    /* corrida: o mesmo usuário acabou de entrar por outra requisição
       — o índice único segurou; a contagem é reconciliada abaixo */
  }
  await recountGroup(dm.id);

  const person = await getUser(targetId);
  const sys = joined
    ? await groupSystemMsg(
        dm,
        me.id,
        "adicionou @" + (person ? person.username : targetId) + " ao grupo."
      )
    : null;
  const out = await freshGroupPatch(dm.id, sys ? [sys] : []);
  return { status: joined ? 201 : 200, data: out.fresh || dm, patch: out.patch };
}

async function groupRemoveMember(ctx) {
  const me = await auth.requireUser(ctx.event);
  await assertGroups();
  const dm = await loadGroup(ctx.params.id, me.id);
  requireGroupAdmin(dm, me.id);
  const targetId = String(ctx.params.userId || "");
  if (!targetId) throw bad("Escolha a pessoa que vai sair.");
  if (targetId === me.id) throw bad("Use “Sair do grupo” para sair você mesmo.");
  if (dm.participants.indexOf(targetId) === -1)
    throw notFound("Esta pessoa não está no grupo.");

  await db.remove("dm_members", {
    where: { conversationId: dm.id, userId: targetId },
  });
  await recountGroup(dm.id);
  const person = await getUser(targetId);
  const sys = await groupSystemMsg(
    dm,
    me.id,
    "removeu @" + (person ? person.username : targetId) + " do grupo."
  );
  const out = await freshGroupPatch(dm.id, [sys]);
  return { data: out.fresh || dm, patch: out.patch };
}

async function groupLeave(ctx) {
  const me = await auth.requireUser(ctx.event);
  await assertGroups();
  const dm = await loadGroup(ctx.params.id, me.id);
  if (dm.participants.length <= 1)
    throw bad(
      "Você é o único membro do grupo. Oculte a conversa da lista em vez de sair — assim o histórico continua guardado."
    );

  const wasAdmin = isGroupAdmin(dm, me.id);
  /* sucessor DETERMINÍSTICO da administração: quem entrou mais cedo
     (empate de horário desempatado pelo id — igual para todos) */
  let successor = null;
  if (wasAdmin) {
    const rows = await db.select("dm_members", { where: { conversationId: dm.id } });
    const order = (rows || [])
      .filter((r) => r.userId !== me.id)
      .sort(
        (a, b) =>
          Number(a.joinedAt || 0) - Number(b.joinedAt || 0) ||
          String(a.userId).localeCompare(String(b.userId))
      );
    successor = order[0] || null;
  }

  await db.remove("dm_members", {
    where: { conversationId: dm.id, userId: me.id },
  });
  await recountGroup(dm.id);

  let sys = null;
  if (wasAdmin && successor) {
    await db.update("dms", { where: { id: dm.id } }, {
      adminId: successor.userId,
      updatedAt: now(),
    });
    const succUser = await getUser(successor.userId);
    sys = await groupSystemMsg(
      dm,
      me.id,
      "saiu do grupo e passou a administração para @" +
        (succUser ? succUser.username : successor.userId) +
        "."
    );
  } else {
    sys = await groupSystemMsg(dm, me.id, "saiu do grupo.");
  }

  /* quem saiu some da LISTA do próprio cache na hora; a conversa e
     as mensagens continuam intactas no servidor para os demais */
  const patch = P.createPatch();
  P.del(patch, "dms", [dm.id]);
  if (sys) P.set(patch, "messages", sys.id, sys);
  return { data: { left: true, dmId: dm.id }, patch };
}

async function groupEdit(ctx) {
  const me = await auth.requireUser(ctx.event);
  await assertGroups();
  const dm = await loadGroup(ctx.params.id, me.id);
  requireGroupAdmin(dm, me.id);
  const body = ctx.body || {};
  const patchIn = {};
  let renamed = null;
  if (body.name !== undefined) {
    const name = String(body.name || "").trim().slice(0, 64);
    if (!name) throw bad("O nome do grupo não pode ficar vazio.");
    if (name !== dm.name) {
      patchIn.name = name;
      renamed = name;
    }
  }
  if (body.icon !== undefined)
    patchIn.icon = body.icon === null
      ? { emoji: null, color: null, image: null }
      : groupIconOf(body.icon);
  if (!Object.keys(patchIn).length) return { data: dm, patch: P.createPatch() };
  patchIn.updatedAt = now();
  await db.update("dms", { where: { id: dm.id } }, patchIn);

  const sys = renamed
    ? await groupSystemMsg(dm, me.id, "mudou o nome do grupo para “" + renamed + "”.")
    : null;
  const out = await freshGroupPatch(dm.id, sys ? [sys] : []);
  return { data: out.fresh || dm, patch: out.patch };
}

async function dmMessages(ctx) {
  const me = await auth.requireUser(ctx.event);
  await loadDM(ctx.params.id, me.id);
  const rows = await db.select("messages", {
    where: { channel_id: ctx.params.id },
    order: "createdAt",
    limit: 500,
  });
  return { data: rows || [] };
}

function sanitizeAttachments(list) {
  if (!list || !list.length) return [];
  if (list.length > 4) throw bad("Envie no máximo 4 anexos por mensagem.");
  return list.slice(0, 4).map((a) => {
    const type = ["image", "video", "file", "gif"].indexOf(a.type) !== -1 ? a.type : "file";
    const url = String(a.url || "");
    if (url.length > 1600000) throw bad("Este arquivo é grande demais (máximo 1,5 MB).");
    if (!/^(data:image\/|data:video\/|blob:|https?:\/\/)/i.test(url))
      throw bad("Formato de arquivo não suportado.");
    return {
      type,
      url,
      name: String(a.name || "arquivo").slice(0, 80),
      size: Number(a.size) || 0,
    };
  });
}

async function dmSendMessage(ctx) {
  const me = await auth.requireUser(ctx.event);
  const dm = await loadDM(ctx.params.id, me.id);
  const body = ctx.body || {};
  const text = String(body.content || "").trim();
  const attachments = sanitizeAttachments(body.attachments);
  if (!text && !attachments.length) throw bad("");
  if (attachments.length)
    await db.assertWritable(
      "dm_messages",
      "attachments",
      "O envio de anexos está indisponível neste banco. Execute a migração do Nexo (supabase/migrations/0001_nexo_backend.sql) e tente novamente."
    );
  if (text.length > 2000)
    throw bad("As mensagens podem ter no máximo 2000 caracteres.");

  /* GRUPO: quem pode falar é quem está no grupo (loadGroup/loadDM
     acima). Bloqueio e privacidade 1:1 não se aplicam — valem nas
     mesmas regras dos canais de servidor compartilhados, e já foram
     conferidos no momento de criar o grupo ou de convidar alguém. */
  const otherId = dm.participants.find((p) => p !== me.id) || null;
  if (!dm.isGroup) {
    if (otherId && (await R.blockedBetween(otherId, me.id)))
      throw bad("Você não pode enviar mensagens para esta pessoa.");
    if (otherId && (await R.blockedBetween(me.id, otherId)))
      throw bad("Desbloqueie esta pessoa para voltar a conversar.");

    /* privacidade revalidada enquanto a conversa não tem histórico */
    const history = await db.select("messages", {
      where: { channel_id: dm.id },
      limit: 1,
    });
    if (otherId && (!history || !history.length) && !(await R.canDM(me.id, otherId)))
      throw bad(R.dmPrivacyMessage(await getUser(otherId)));
  }

  const createdAt = now();
  const message = {
    id: u.uid("ms"),
    channelId: dm.id,
    conversationId: dm.id,
    authorId: me.id,
    senderId: me.id,
    content: text.slice(0, 2000),
    attachments,
    type: "user",
    reactions: {},
    pinned: false,
    createdAt,
    updatedAt: null,
  };
  await db.insert("messages", message);

  const reads = Object.assign({}, dm.reads || {});
  reads[me.id] = createdAt;
  await db.update("dms", { where: { id: dm.id } }, { reads, updatedAt: now() });
  const updatedDM = Object.assign({}, dm, { reads });

  const patch = P.createPatch();
  P.set(patch, "messages", message.id, message);
  P.set(patch, "dms", dm.id, updatedDM);

  if (dm.isGroup) {
    /* GRUPO: cada participante recebe a notificação na própria conta,
       pulando quem silenciou esta conversa (silêncio é por pessoa) */
    const others = dm.participants.filter((p) => p !== me.id);
    for (let i = 0; i < others.length; i++) {
      const uid = others[i];
      const theirMuted = await db.mutedDms(uid);
      if (theirMuted.indexOf(dm.id) !== -1) continue;
      const note = await handlersAuth.createNotification(
        uid,
        "dm",
        "@" + me.username + " enviou uma mensagem.",
        { href: "#/mensagens/" + dm.id, actorId: me.id, messageId: message.id }
      );
      P.set(patch, "notifications", note.id, note);
    }
  } else {
    const mutedList = await db.mutedDms(me.id);
    if (otherId && mutedList.indexOf(dm.id) === -1) {
      const note = await handlersAuth.createNotification(
        otherId,
        "dm",
        "@" + me.username + " enviou uma mensagem.",
        { href: "#/mensagens/" + dm.id, actorId: me.id, messageId: message.id }
      );
      P.set(patch, "notifications", note.id, note);
    }
  }
  return { status: 201, data: message, patch };
}

async function dmMarkRead(ctx) {
  const me = await auth.requireUser(ctx.event);
  const dm = await loadDM(ctx.params.id, me.id);
  const reads = Object.assign({}, dm.reads || {});
  reads[me.id] = now();
  await db.update("dms", { where: { id: dm.id } }, { reads, updatedAt: now() });
  const hidden = await db.hiddenDms(me.id);
  const patch = P.createPatch();
  P.set(patch, "dms", dm.id, Object.assign({}, dm, { reads, hidden: hidden.indexOf(dm.id) !== -1 }));
  return { data: true, patch };
}

async function dmMute(ctx) {
  const me = await auth.requireUser(ctx.event);
  const dm = await loadDM(ctx.params.id, me.id);
  const muted = (ctx.body || {}).muted !== false;
  await db.setMutedDm(me.id, dm.id, muted);
  const hidden = await db.hiddenDms(me.id);
  const updated = Object.assign({}, dm, { muted, hidden: hidden.indexOf(dm.id) !== -1 });
  const patch = P.createPatch();
  P.set(patch, "dms", dm.id, updated);
  return { data: updated, patch };
}

module.exports = { routes, friendListOf, getUser, sanitizeAttachments, dmRowsFor };
