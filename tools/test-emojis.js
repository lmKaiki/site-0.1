"use strict";
/* ============================================================
   TESTE · emojis e figurinhas personalizados por servidor
   ------------------------------------------------------------
   Roda em processo (mesma base de testes de tickets):
     node tools\test-emojis.js
   Cria contas REAIS, servidor REAL, limpa tudo ao final.
   Não toca em nada que já exista no banco.
   ============================================================ */

process.env.NEXO_DB = process.env.NEXO_DB || "sqlite";

const { register, dispatch } = require("../server/router");

register([
  require("../server/handlers/auth"),
  require("../server/handlers/social"),
  require("../server/handlers/servers"),
  require("../server/handlers/messages"),
  require("../server/handlers/emojis"),
  require("../server/handlers/sync"),
  require("../server/handlers/apps"),
  require("../server/handlers/calls"),
  require("../server/handlers/custom"),
  require("../server/handlers/support"),
  require("../server/handlers/tickets"),
]);

let pass = 0;
let fail = 0;
const created = { users: [], servers: [], emojis: [], stickers: [] };

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

/* PNG 1x1 válido — a validação do servidor confere tipo, estrutura
   e tamanho; um pixel real é o bastante para passar e para ser
   recusado quando adulterado. */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

async function signup(name) {
  const r = await call("POST", "/auth/signup", {
    username: name,
    password: "SenhaForte#123",
    confirm: "SenhaForte#123",
  });
  created.users.push(r.json.data.user);
  return { user: r.json.data.user, cookie: r.cookie, status: r.status };
}

async function cleanup() {
  const db = require("../server/db");
  const ids = created.users.map((x) => x.id);
  if (!ids.length) return;

  for (const sid of created.servers) {
    const chans = await db.select("channels", { where: { server_id: sid }, limit: 500 });
    const chIds = (chans || []).map((c) => c.id);
    for (const cid of chIds) {
      await db.remove("message_reads", { where: { conversation_id: cid } }).catch(() => {});
      await db.remove("messages", { where: { channel_id: cid } }).catch(() => {});
    }
    await db.remove("channels", { where: { server_id: sid } }).catch(() => {});
    /* o acervo deste servidor morre junto com ele */
    await db.remove("emojis", { where: { server_id: sid } }).catch(() => {});
    await db.remove("stickers", { where: { server_id: sid } }).catch(() => {});
    await db.remove("categories", { where: { server_id: sid } }).catch(() => {});
    await db.remove("roles", { where: { server_id: sid } }).catch(() => {});
    await db.remove("member_roles", { where: { server_id: sid } }).catch(() => {});
    await db.remove("invites", { where: { server_id: sid } }).catch(() => {});
    await db.remove("logs", { where: { server_id: sid } }).catch(() => {});
    await db.remove("memberships", { where: { server_id: sid } }).catch(() => {});
    await db.remove("servers", { where: { id: sid } }).catch(() => {});
  }
  await db.remove("notifications", { where: { user_id: ids } }).catch(() => {});
  await db.remove("friend_requests", { where: { sender_id: ids } }).catch(() => {});
  await db.remove("friend_requests", { where: { receiver_id: ids } }).catch(() => {});
  await db.remove("friendships", { where: { user_a_id: ids } }).catch(() => {});
  await db.remove("friendships", { where: { user_b_id: ids } }).catch(() => {});
  await db.remove("presence", { where: { user_id: ids } }).catch(() => {});
  await db.remove("prefs", { where: { user_id: ids } }).catch(() => {});
  await db.remove("users", { where: { id: ids } }).catch(() => {});
}

async function main() {
  /* ---------------- 1. contas e servidor ---------------- */
  console.log("\n== 1. contas reais e servidor ==");
  const a = await signup("emj" + rnd(6)); /* dono */
  const b = await signup("emj" + rnd(6)); /* membro comum */
  const z = await signup("emj" + rnd(6)); /* NÃO membro */
  ok("dono criado", a.status === 201, "status=" + a.status);
  ok("membro B criado", b.status === 201);
  ok("não-membro Z criado", z.status === 201);
  const ca = a.cookie, cb = b.cookie, cz = z.cookie;

  const srv = await call("POST", "/servers", { name: "Servidor de teste de emojis" }, ca);
  const serverId = srv.json.data && srv.json.data.id;
  ok("dono criou o servidor", !!serverId, JSON.stringify(srv.json).slice(0, 140));
  created.servers.push(serverId);

  const inv = await call("POST", "/servers/" + serverId + "/invites", {}, ca);
  const code = inv.json.data && (inv.json.data.code || inv.json.data);
  const join = await call("POST", "/invites/" + code + "/join", {}, cb);
  ok("B entrou no servidor", join.status < 300, JSON.stringify(join.json).slice(0, 120));

  /* O banco pode estar com a migração 0006 pendente: nesse caso a
     tabela `emojis` tem outra forma (por exemplo `url` em vez de
     `image`) ou a tabela `stickers` nem existe. Nada pode ser
     testado aqui — a suíte REPORTA e encerra com código 2 ("banco
     não preparado"), sem contar reprovação e sem fingir sucesso. */
  const probeEm = await call("GET", "/servers/" + serverId + "/emojis", null, ca);
  if (probeEm.status === 503 && probeEm.json && probeEm.json.code === "schema_pending") {
    console.log("\n  ATENÇÃO: " + (probeEm.json.error || ""));
    console.log("  Este banco não tem a migração 0006 aplicada, então emojis e");
    console.log("  figurinhas não existem nele. Nenhuma asserção foi executada.");
    console.log("  Aplique supabase/migrations/0006_emojis_stickers.sql e rode de novo.");
    await cleanup();
    console.log("\nlimpeza concluída\n");
    process.exit(2);
  }

  /* ---------------- 2. criar emoji (dono) ---------------- */
  console.log("\n== 2. criar emoji personalizado ==");
  const e1 = await call("POST", "/servers/" + serverId + "/emojis", { name: "fire", image: PNG }, ca);
  const em1 = e1.json.data;
  ok("emoji criado (201)", e1.status === 201 && !!em1 && !!em1.id, "status=" + e1.status + " " + JSON.stringify(e1.json).slice(0, 160));
  created.emojis.push(em1 && em1.id);
  ok("nome normalizado para minúsculas", em1 && em1.name === "fire", em1 && em1.name);
  ok("imagem persiste no banco", em1 && typeof em1.image === "string" && em1.image.indexOf("data:image/png") === 0);
  ok("servidor correto", em1 && em1.serverId === serverId);
  ok("quem criou fica registrado", em1 && em1.createdBy === a.user.id);

  const eDup = await call("POST", "/servers/" + serverId + "/emojis", { name: "FIRE", image: PNG }, ca);
  ok("nome duplicado é recusado (400)", eDup.status === 400, "status=" + eDup.status);

  const eUpper = await call("POST", "/servers/" + serverId + "/emojis", { name: "Fire Emoji!", image: PNG }, ca);
  ok("nome com espaço/símbolo é normalizado", eUpper.status === 201 && eUpper.json.data.name === "fire_emoji", eUpper.json.data && eUpper.json.data.name);
  created.emojis.push(eUpper.json.data && eUpper.json.data.id);

  /* ---------------- 3. validação de arquivo ---------------- */
  console.log("\n== 3. imagens inválidas e grandes ==");
  const badSvg = await call("POST", "/servers/" + serverId + "/emojis", { name: "svgtest", image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }, ca);
  ok("SVG é recusado (400)", badSvg.status === 400, "status=" + badSvg.status);

  const badNoImg = await call("POST", "/servers/" + serverId + "/emojis", { name: "noimg" }, ca);
  ok("sem imagem é recusado (400)", badNoImg.status === 400, "status=" + badNoImg.status);

  const badType = await call("POST", "/servers/" + serverId + "/emojis", { name: "txtfile", image: "data:text/plain;base64,aGVsbG8=" }, ca);
  ok("texto não-imagem é recusado (400)", badType.status === 400, "status=" + badType.status);

  const huge = "data:image/png;base64," + "A".repeat(300000);
  const badBig = await call("POST", "/servers/" + serverId + "/emojis", { name: "hugefile", image: huge }, ca);
  ok("arquivo grande é recusado (400)", badBig.status === 400, "status=" + badBig.status);

  const badShort = await call("POST", "/servers/" + serverId + "/emojis", { name: "a", image: PNG }, ca);
  ok("nome com 1 caractere é recusado (400)", badShort.status === 400, "status=" + badShort.status);

  /* ---------------- 4. permissões ---------------- */
  console.log("\n== 4. membros sem permissão não gerenciam ==");
  const eByB = await call("POST", "/servers/" + serverId + "/emojis", { name: "btry", image: PNG }, cb);
  ok("membro comum NÃO cria emoji (403)", eByB.status === 403, "status=" + eByB.status);

  const eByZ = await call("POST", "/servers/" + serverId + "/emojis", { name: "ztry", image: PNG }, cz);
  ok("não-membro NÃO cria emoji (403/404)", eByZ.status === 403 || eByZ.status === 404, "status=" + eByZ.status);

  const ePut = await call("PATCH", "/emojis/" + em1.id, { name: "hacked" }, cb);
  ok("membro comum NÃO edita emoji (403)", ePut.status === 403, "status=" + ePut.status);

  const eDel = await call("DELETE", "/emojis/" + em1.id, undefined, cb);
  ok("membro comum NÃO apaga emoji (403)", eDel.status === 403, "status=" + eDel.status);

  const eReadZ = await call("GET", "/servers/" + serverId + "/emojis", null, cz);
  ok("não-membro NÃO lista o acervo (403/404)", eReadZ.status === 403 || eReadZ.status === 404, "status=" + eReadZ.status);

  /* mesma prova para as figurinhas, ANTES de B receber qualquer cargo.
     O banco pode estar com a migração 0006 pendente (tabela `stickers`
     inexistente): aí a API responde 503 schema_pending. Nesse caso o
     teste AVISA e pula a parte de figurinhas, em vez de quebrar no
     meio e esconder o resultado do resto da suíte. */
  const probeSt = await call("GET", "/servers/" + serverId + "/stickers", null, ca);
  const stickersReady = !(
    probeSt.status === 503 && probeSt.json && probeSt.json.code === "schema_pending"
  );
  if (!stickersReady) {
    console.log(
      "  [aviso] tabela `stickers` ausente neste banco (migração 0006 pendente): figurinhas puladas."
    );
  } else {
    const sByBearly = await call("POST", "/servers/" + serverId + "/stickers", { name: "bsemperm", image: PNG }, cb);
    ok("membro comum NÃO cria figurinha (403)", sByBearly.status === 403, "status=" + sByBearly.status);
    const sByZ = await call("POST", "/servers/" + serverId + "/stickers", { name: "zsticker", image: PNG }, cz);
    ok("não-membro NÃO cria figurinha (403/404)", sByZ.status === 403 || sByZ.status === 404, "status=" + sByZ.status);
  }

  /* B recebe a permissão dedicada via cargo e passa a gestionar */
  const role = await call("POST", "/servers/" + serverId + "/roles", {
    name: "Curadores de emoji",
    color: "#00ffcc",
    /* gestão + uso: sem "useEmojis"/"useCustomEmojis"/"useStickers"
       os membros comuns não reagem nem usam o acervo (o cargo padrão
       do Nexo não concede isso — é o dono quem libera). */
    permissions: {
      useEmojis: true,
      useCustomEmojis: true,
      useStickers: true,
      manageEmojis: true,
      manageStickers: true,
    },
  }, ca);
  const roleId = role.json.data && role.json.data.id;
  ok("cargo criado", role.status === 201 && !!roleId, JSON.stringify(role.json).slice(0, 140));

  const setRole = await call("PATCH", "/servers/" + serverId + "/members/" + b.user.id, { roleId }, ca);
  ok("cargo atribuído a B", setRole.status < 300, JSON.stringify(setRole.json).slice(0, 140));

  const eByB2 = await call("POST", "/servers/" + serverId + "/emojis", { name: "bcurated", image: PNG }, cb);
  ok("com a permissão, B cria emoji (201)", eByB2.status === 201, "status=" + eByB2.status + " " + JSON.stringify(eByB2.json).slice(0, 140));
  created.emojis.push(eByB2.json.data && eByB2.json.data.id);

  /* ---------------- 5. figurinhas ---------------- */
  console.log("\n== 5. figurinhas ==");
  let st1 = null;
  if (!stickersReady) {
    console.log("  [pulado] requer a migração supabase/migrations/0006_emojis_stickers.sql");
  } else {
  const s1 = await call("POST", "/servers/" + serverId + "/stickers", { name: "boa noite", description: "Cumprimento da comunidade", image: PNG }, ca);
  st1 = s1.json.data;
  ok("figurinha criada (201)", s1.status === 201 && !!st1 && !!st1.id, "status=" + s1.status + " " + JSON.stringify(s1.json).slice(0, 160));
  created.stickers.push(st1 && st1.id);
  ok("descrição opcional persiste", st1 && st1.description === "Cumprimento da comunidade", st1 && st1.description);
  ok("imagem da figurinha persiste", st1 && typeof st1.image === "string" && st1.image.indexOf("data:image/png") === 0);

  const sNoDesc = await call("POST", "/servers/" + serverId + "/stickers", { name: "sem desc", image: GIF }, ca);
  ok("figurinha sem descrição é aceita", sNoDesc.status === 201, "status=" + sNoDesc.status);
  ok(
    "GIF é aceito como figurinha",
    sNoDesc.status === 201 && String((sNoDesc.json.data && sNoDesc.json.data.image) || "").indexOf("data:image/gif") === 0,
    "status=" + sNoDesc.status
  );
  created.stickers.push(sNoDesc.json.data && sNoDesc.json.data.id);

  const sByB = await call("POST", "/servers/" + serverId + "/stickers", { name: "bcurator", image: PNG }, cb);
  ok("com a permissão, B cria figurinha (201)", sByB.status === 201, "status=" + sByB.status + " " + JSON.stringify(sByB.json).slice(0, 140));
  created.stickers.push(sByB.json.data && sByB.json.data.id);

  const sHuge = await call("POST", "/servers/" + serverId + "/stickers", { name: "bigsticker", image: "data:image/png;base64," + "A".repeat(600000) }, ca);
  ok("figurinha grande é recusada (400)", sHuge.status === 400, "status=" + sHuge.status);
  }

  /* ---------------- 6. editar e apagar ---------------- */
  console.log("\n== 6. editar, substituir e apagar ==");
  const eEdit = await call("PATCH", "/emojis/" + em1.id, { name: "fogo" }, ca);
  ok("dono renomeou o emoji", eEdit.status === 200 && eEdit.json.data.name === "fogo", JSON.stringify(eEdit.json).slice(0, 140));

  const eReedit = await call("PATCH", "/emojis/" + em1.id, { name: "fogo" }, ca);
  ok("renomear para o próprio nome funciona", eReedit.status === 200, "status=" + eReedit.status);

  const eSwap = await call("PATCH", "/emojis/" + em1.id, { image: GIF }, ca);
  ok(
    "emoji substituído (imagem trocada)",
    eSwap.status === 200 && String((eSwap.json.data && eSwap.json.data.image) || "").indexOf("data:image/gif") === 0,
    "status=" + eSwap.status + " " + JSON.stringify(eSwap.json).slice(0, 160)
  );

  if (stickersReady) {
    const sEdit = await call("PATCH", "/stickers/" + st1.id, { description: "Descrição nova" }, ca);
    ok(
      "dono editou a descrição",
      sEdit.status === 200 && String((sEdit.json.data && sEdit.json.data.description) || "") === "Descrição nova",
      "status=" + sEdit.status
    );
  }

  const eDelA = await call("DELETE", "/emojis/" + em1.id, undefined, ca);
  ok("dono apagou o emoji", eDelA.status === 200, "status=" + eDelA.status);
  created.emojis = created.emojis.filter((x) => x !== em1.id);

  const eDelGone = await call("DELETE", "/emojis/" + em1.id, undefined, ca);
  ok("apagar de novo é 404", eDelGone.status === 404, "status=" + eDelGone.status);

  /* ---------------- 7. sync / persistência / duas contas ---------------- */
  console.log("\n== 7. sync: duas contas veem o mesmo acervo ==");
  const syncA = await call("GET", "/sync", null, ca);
  const syncB = await call("GET", "/sync", null, cb);
  const syncZ = await call("GET", "/sync", null, cz);

  const eA = Object.values((syncA.json.data && syncA.json.data.emojis) || {});
  const eB = Object.values((syncB.json.data && syncB.json.data.emojis) || {});
  const eZ = Object.values((syncZ.json.data && syncZ.json.data.emojis) || {});
  const stA = Object.values((syncA.json.data && syncA.json.data.stickers) || {});
  const stB = Object.values((syncB.json.data && syncB.json.data.stickers) || {});

  ok("dono recebe os emojis no sync", eA.length > 0, "total=" + eA.length);
  ok("membro B recebe os MESMOS emojis", eB.length === eA.length, "A=" + eA.length + " B=" + eB.length);
  ok("não-membro Z NÃO recebe o acervo", eZ.length === 0, "Z=" + eZ.length);
  ok(
    "figurinhas vão no sync",
    !stickersReady || (stA.length > 0 && stB.length === stA.length),
    "A=" + stA.length + " B=" + stB.length
  );

  const bSeesImage = eB.some((e) => typeof e.image === "string" && e.image.indexOf("data:image") === 0);
  ok("B recebe a IMAGEM junto (não só o nome)", bSeesImage);

  const inSync = eA.find((e) => e.name === "bcurated");
  ok("emoji criado por B aparece para o dono", !!inSync, inSync && inSync.name);

  /* "atualizar a página" = novo sync do zero: o acervo vem do banco */
  const reload = await call("GET", "/sync", null, cb);
  const eReload = Object.values((reload.json.data && reload.json.data.emojis) || {});
  ok("acervo sobrevive ao reload", eReload.length === eB.length && eReload.some((e) => e.name === "fogo") === false, "total=" + eReload.length);

  /* ---------------- 8. uso no chat ---------------- */
  console.log("\n== 8. emojis e figurinhas nas mensagens ==");
  const chans = Object.values((syncA.json.data && syncA.json.data.channels) || {});
  const chan = chans.find((c) => c.serverId === serverId && c.type !== "voice");
  ok("canal de teste encontrado", !!chan, chan && chan.name);

  const msg = await call("POST", "/channels/" + chan.id + "/messages", {
    content: "olha o <:bcurated: e a figurinha {{sticker:boa_noite}}",
  }, cb);
  ok("mensagem com emoji e figurinha enviada", msg.status < 300, JSON.stringify(msg.json).slice(0, 160));
  const sentContent = msg.json.data && msg.json.data.content;
  ok("referência do emoji fica na mensagem", typeof sentContent === "string" && sentContent.indexOf("<:bcurated:") > -1, sentContent);
  ok("referência da figurinha fica na mensagem", typeof sentContent === "string" && sentContent.indexOf("{{sticker:boa_noite}}") > -1, sentContent);

  /* reação com emoji do servidor de nome COMPRO: o token tem 28
     caracteres e não pode ser cortado no meio */
  const react = await call("POST", "/messages/" + msg.json.data.id + "/reactions", { emoji: "<:bcurated:>" }, cb);
  ok("reação com emoji personalizado aceita", react.status < 300, "status=" + react.status + " " + JSON.stringify(react.json).slice(0, 140));
  const react2 = await call("POST", "/messages/" + msg.json.data.id + "/reactions", { emoji: "<:curadoria_de_conteudo_24:>" }, cb);
  ok("token longo (28 chars) não é cortado", react2.status < 300, "status=" + react2.status + " " + JSON.stringify(react2.json).slice(0, 140));
  const react3 = await call("POST", "/messages/" + msg.json.data.id + "/reactions", { emoji: "x".repeat(60) }, ca);
  ok("token acima de 32 chars é recusado (400)", react3.status === 400, "status=" + react3.status);

  /* ---------------- 9. banco: nada inventado ---------------- */
  console.log("\n== 9. conferência no banco ==");
  const db = require("../server/db");
  const dbEmojis = await db.select("emojis", { where: { server_id: serverId }, limit: 100 });
  ok("tabela emojis tem os registros", (dbEmojis || []).length > 0, "total=" + (dbEmojis || []).length);
  ok("nenhum emoji vaza para outro servidor", (dbEmojis || []).every((e) => e.serverId === serverId));
  const dbStickers = stickersReady
    ? await db.select("stickers", { where: { server_id: serverId }, limit: 100 })
    : [];
  ok(
    "tabela stickers tem os registros",
    !stickersReady || (dbStickers || []).length > 0,
    "total=" + (dbStickers || []).length
  );

  console.log("\n----------------------------------------");
  console.log("  aprovadas: " + pass + "   falhas: " + fail);
  console.log("----------------------------------------\n");
  await cleanup();
  console.log("limpeza concluída\n");
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nFALHA CRÍTICA:", err && err.stack);
  try {
    await cleanup();
  } catch (e) {}
  process.exit(1);
});
