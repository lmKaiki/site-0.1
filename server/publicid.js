"use strict";
/* ============================================================
   NEXO · server/publicid
   ID PÚBLICO NUMÉRICO de cada conta (ex.: 2344).

   · O identificador interno `u_…` continua sendo a CHAVE de
     banco, sessão e relacionamento — ele nunca muda. Este número
     é só um APELIDO público: curto, único, permanente e fácil de
     digitar para achar alguém.
   · Onde vive: `prefs.data.publicId`, o mesmo lugar dos extras de
     perfil (theme, profileColor, birth…). Por isso NÃO existe
     migração de tabela: o backfill das contas antigas é a própria
     varredura, que apenas ADICIONA o campo. Nenhuma conta é
     apagada, recriada ou renomeada, e nenhum dado existente muda.
   · Colisão: o número é sorteado no servidor, conferido contra os
     já usados e RECONFIRMADO depois de gravar. Como a tabela não
     tem índice único sobre esse campo, uma corrida entre dois
     processos é resolvida de forma determinística: fica com o
     número quem tem o id interno MENOR (ordem estável) e o outro
     recebe outro número — sempre acrescentando, nunca
     sobrescrevendo.
   ============================================================ */

const db = require("./db");
const map = require("./map");

const MIN = 1000; /* 4 dígitos: curto o bastante para digitar */
const MAX = 9999;
const SWEEP_MS = 10 * 60 * 1000;

let sweepAt = 0;
let sweeping = null;

function isValid(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= MIN && n <= 999999;
}

/* lê contas + prefs de uma vez: daí sai quem já tem número e quais
   números estão em uso (inclusive os duplicados, se a corrida
   entre processos alguma vez criar uma) */
async function readAll() {
  let users = [];
  let prefs = [];
  try {
    users = (await db.select("users", { limit: 5000 })) || [];
    prefs = (await db.select("prefs", { limit: 5000 })) || [];
  } catch (e) {
    return { users: [], used: {}, mine: {} };
  }
  const used = {};
  const mine = {};
  prefs.forEach((p) => {
    const uid = p.userId || p.user_id; /* db.select devolve camelCase */
    if (!uid) return;
    const data = map.parseJSON(p.data, null) || {};
    if (!isValid(data.publicId)) return;
    mine[uid] = data.publicId;
    (used[data.publicId] = used[data.publicId] || []).push(uid);
  });
  return { users, used, mine };
}

/* sorteia um número livre; quando o espaço de 4 dígitos enche,
   cresce sozinho em vez de travar */
function pick(used) {
  const busy = Object.keys(used).length;
  const span = MAX - MIN + 1;
  const limit = busy > span * 0.85 ? 999999 : MAX;
  for (let i = 0; i < 500; i++) {
    const n = MIN + Math.floor(Math.random() * (limit - MIN + 1));
    if (!used[n]) return n;
  }
  for (let n = MIN; n <= limit; n++) if (!used[n]) return n;
  return null;
}

/* grava em prefs.data.publicId preservando todo o resto do JSON */
async function save(userId, publicId) {
  try {
    const data = await db.readPrefs(userId);
    data.publicId = publicId;
    await db.writePrefs(userId, data);
  } catch (e) {
    /* banco indisponível: a conta continua funcionando sem número */
    return null;
  }
  return publicId;
}

/* dá um número para UMA conta e confirma depois de gravar */
async function assignOne(userId) {
  if (!userId) return null;
  const first = await readAll();
  if (isValid(first.mine[userId])) {
    /* já tem número: só confere se alguém acabou de roubar ele */
    const owners = first.used[first.mine[userId]] || [];
    if (owners.length < 2) return first.mine[userId];
  }
  const n = first.mine[userId] || pick(first.used);
  if (n === null) return null;
  const saved = await save(userId, n);
  if (saved === null) return null;

  /* reconfirmação: se outra conta sorteou o mesmo número no meio
     tempo, quem tem o id interno maior recua e sorteia outro */
  try {
    const after = await readAll();
    if (isValid(after.mine[userId]) && (after.used[after.mine[userId]] || []).length === 1)
      return after.mine[userId];
    const owners = after.used[n] || [];
    if (owners.length > 1) {
      const keep = owners.slice().sort()[0];
      if (keep !== userId) {
        const m = pick(after.used);
        if (m === null) return null;
        return await save(userId, m);
      }
    }
  } catch (e) {
    /* sem conseguir reconfirmar: o número gravado segue válido */
  }
  return n;
}

/* varredura: dá número às contas que ainda não têm (as antigas,
   criadas antes deste recurso) e resolve duplicados. Nunca apaga
   nem recria conta — só acrescenta o campo em prefs.data. */
async function sweep(force) {
  if (!force && Date.now() - sweepAt < SWEEP_MS) return null; /* throttled */
  if (sweeping) return sweeping;
  sweepAt = Date.now();
  sweeping = (async function () {
    try {
      const state = await readAll();
      const jobs = [];
      const already = {};
      /* 1) duplicados: determinístico, fica o menor id interno */
      Object.keys(state.used).forEach((key) => {
        const list = (state.used[key] || []).slice().sort();
        for (let i = 1; i < list.length; i++) {
          jobs.push({ userId: list[i], drop: Number(key) });
          already[list[i]] = true;
        }
      });
      /* 2) contas sem número (inclusive as antigas) */
      state.users.forEach((u) => {
        if (!u || !u.id || state.mine[u.id] || already[u.id]) return;
        jobs.push({ userId: u.id });
      });
      if (!jobs.length) return { total: state.users.length, assigned: 0, healed: 0 };

      const used = state.used;
      let assigned = 0;
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const n = pick(used);
        if (n === null) break;
        used[n] = (used[n] || []).concat([job.userId]);
        if (job.drop !== undefined) {
          const list = used[job.drop] || [];
          used[job.drop] = list.filter((id) => id !== job.userId);
          if (!used[job.drop].length) delete used[job.drop];
        }
        if ((await save(job.userId, n)) !== null) assigned++;
      }
      return {
        total: state.users.length,
        assigned: assigned,
        healed: jobs.filter((j) => j.drop !== undefined).length,
      };
    } catch (e) {
      return null;
    } finally {
      sweeping = null;
    }
  })();
  return sweeping;
}

module.exports = {
  MIN,
  MAX,
  isValid,
  forUser: assignOne,
  sweep,
  /* sorteia um número livre sem gravar (usado no cadastro, para o
     número já nascer junto com a conta) */
  pickFree: async function () {
    const state = await readAll();
    return pick(state.used);
  },
  /* só para teste/diagnóstico */
  _readAll: readAll,
};
