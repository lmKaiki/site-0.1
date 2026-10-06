/* ============================================================
   NEXO · seed
   Dados de demonstração (conta demo, servidores, cargos,
   canais, mensagens, convites e conversas diretas).
   Roda apenas na primeira abertura, quando o banco está vazio.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  function seed() {
    /* ===== PRODUÇÃO · DEMO_MODE=false =====
       O seed só existe em modo demonstração explícito. Com o padrão
       (DEMO_MODE=false) nada é criado: banco vazio = servidor vazio,
       sem usuários, mensagens, amigos, seguidores ou curtidas
       fictícios. Os dados reais nunca são alterados aqui. */
    if (!NX.demoMode()) return false;

    const db = NX.store.db;
    if (Object.keys(db.users).length > 0) return false;

    const now = Date.now();
    const uid = (p) => NX.util.uid(p);

    /* ---------- usuários ---------- */
    function makeUser(o) {
      const id = o.id || uid("u");
      db.users[id] = {
        id: id,
        username: o.username,
        password: NX.util.hashPassword(o.password || "nexo123", NX.util.makeSalt()),
        displayName: o.displayName || o.username,
        avatar: { emoji: o.emoji || null, color: o.color || NX.util.colorFor(id), image: null },
        banner: o.banner || null,
        profileColor: o.color || NX.util.colorFor(id),
        statusEmoji: o.statusEmoji || "",
        customStatus: o.customStatus || "",
        theme: "",
        bio: o.bio || "",
        birth: o.birth || "1998-04-12",
        status: o.status || "offline",
        statusText: o.statusText || "",
        blocks: [],
        /* TODA conta criada pelo seed é marcada como fictícia —
           assim nenhuma delas passa por usuário real depois. */
        demo: true,
        createdAt: o.createdAt || now - 30 * DAY,
      };
      db.presence[id] = o.status || "offline";
      return db.users[id];
    }

    const demo = makeUser({
      username: "demo",
      email: "demo@nexo.chat",
      password: "nexo123",
      displayName: "Você",
      emoji: "🦊",
      color: "#35e0a8",
      bio: "Criando comunidades no Nexo.",
      status: "online",
      statusEmoji: "🎮",
      customStatus: "Jogando agora · Minecraft",
      demo: true,
      createdAt: now - 12 * DAY,
    });

    const luna = makeUser({
      username: "luna", displayName: "Luna Prado", emoji: "🌙", color: "#8f83ff",
      status: "online", bio: "Mestre de RPG e designer.",
    });
    const kai = makeUser({
      username: "kai", displayName: "Kai Nakamura", emoji: "⚡", color: "#ffc857",
      status: "online", bio: "Front-end e café.",
    });
    const maya = makeUser({
      username: "maya", displayName: "Maya Rocha", emoji: "🐙", color: "#ff7ab6",
      status: "dnd", bio: "Ilustradora.",
    });
    const bruno = makeUser({
      username: "bruno", displayName: "Bruno Alves", emoji: "🎧", color: "#4cc9f0",
      status: "idle", bio: "Som e trilhas.",
    });
    const teo = makeUser({
      username: "teo", displayName: "Téo Martins", emoji: "🎲", color: "#ff6b7a",
      status: "offline",
    });
    const ana = makeUser({
      username: "ana", displayName: "Ana Beatriz", emoji: "🌵", color: "#5ad1a3",
      status: "online",
    });
    const sofia = makeUser({
      username: "sofia", displayName: "Sofia Lima", emoji: "☕", color: "#f0956b",
      status: "offline",
    });
    const rafa = makeUser({
      username: "rafa", displayName: "Rafa Dantas", emoji: "🚀", color: "#7c9cff",
      status: "idle",
    });

    /* ---------- helpers de estrutura ---------- */
    function makeServer(o) {
      const id = o.id || uid("sv");
      db.servers[id] = {
        id: id,
        name: o.name,
        description: o.description || "",
        icon: { emoji: o.emoji || NX.util.emojiFor(o.name), color: o.color || NX.util.colorFor(id), image: null },
        banner: o.banner || null,
        appearance: {
          primary: o.color || "#35e0a8",
          secondary: o.secondary || "#8f83ff",
          backgroundImage: null,
          theme: "dark",
        },
        ownerId: o.ownerId,
        discoverable: o.discoverable !== false,
        createdAt: o.createdAt || now - 10 * DAY,
      };
      return id;
    }

    function makeRole(serverId, o) {
      const id = uid("rl");
      db.roles[id] = {
        id: id,
        serverId: serverId,
        name: o.name,
        color: o.color || "#93a8a4",
        icon: o.icon || "",
        description: o.description || "",
        position: o.position,
        isDefault: !!o.isDefault,
        permissions: NX.defaultPerms(o.perms),
        createdAt: now,
      };
      return id;
    }

    function join(serverId, userId, roleId, perms, daysAgo, nick) {
      const id = uid("mb");
      db.memberships[id] = {
        id: id,
        serverId: serverId,
        userId: userId,
        roleId: roleId,
        permissions: perms || {},
        nickname: nick || "",
        joinedAt: now - (daysAgo === undefined ? 8 : daysAgo) * DAY,
      };
      return id;
    }

    function category(serverId, name, order) {
      const id = uid("ct");
      db.categories[id] = {
        id: id, serverId: serverId, name: name, order: order, collapsed: false, perms: {},
      };
      return id;
    }

    function channel(serverId, catId, name, type, order, topic) {
      const id = uid("ch");
      db.channels[id] = {
        id: id,
        serverId: serverId,
        categoryId: catId,
        name: name,
        type: type,
        order: order,
        topic: topic || "",
        perms: {},
        inheritPerms: true,
        overrides: { view: "all", send: "all" },
        createdBy: db.servers[serverId].ownerId,
        createdAt: now - 9 * DAY,
      };
      return id;
    }

    let msgSeq = 0;
    function msg(ref, userId, text, ago, extra) {
      const id = uid("ms");
      msgSeq++;
      const authorId = typeof userId === "string" ? userId : userId.id;
      extra = extra || {};
      db.messages[id] = {
        id: id,
        channelId: ref,
        authorId: authorId,
        content: text,
        attachments: extra.attachments || [],
        reactions: extra.reactions || {},
        pinned: !!extra.pinned,
        createdAt: now - ago,
        updatedAt: null,
      };
      return id;
    }

    /* ============ SERVIDOR 1 · Estúdio Criativo (demo é dono) ============ */
    const s1 = makeServer({
      name: "Estúdio Criativo",
      description: "Espaço da galera para compartilhar arte, memes e novidades.",
      emoji: "🎨",
      color: "#35e0a8",
      ownerId: demo.id,
      createdAt: now - 12 * DAY,
    });

    const s1Default = makeRole(s1, {
      name: "Membro", isDefault: true, position: 0, color: "#93a8a4", icon: "👤",
      description: "Cargo padrão de todo mundo que entra.",
      perms: ["viewChannels", "sendMessages", "createInvite", "joinVoice"],
    });
    const s1Vip = makeRole(s1, {
      name: "VIP", position: 1, color: "#ff7ab6", icon: "⭐",
      description: "Apoiadores e colaboradores.",
      perms: ["viewChannels", "sendMessages", "createInvite", "attachFiles", "useGifs", "joinVoice", "speak"],
    });
    const s1Team = makeRole(s1, {
      name: "Equipe", position: 2, color: "#ffc857", icon: "🛠️",
      description: "Quem cuida do dia a dia do estúdio.",
      perms: ["viewChannels", "sendMessages", "createInvite", "joinVoice", "manageChannels", "pinMessages", "deleteMessages"],
    });
    const s1Mod = makeRole(s1, {
      name: "Moderador", position: 3, color: "#8f83ff", icon: "🔨",
      description: "Mantém a conversa saudável.",
      perms: ["viewChannels", "sendMessages", "createInvite", "joinVoice", "manageChannels",
        "manageMembers", "kickMembers", "banMembers", "unbanMembers", "timeoutMembers",
        "deleteMessages", "pinMessages", "editMessages", "viewLogs"],
    });
    const s1Admin = makeRole(s1, {
      name: "Admin", position: 4, color: "#35e0a8", icon: "🛡️",
      description: "Administra o servidor com o dono.",
      perms: ["administrator"],
    });

    join(s1, demo.id, s1Admin, {}, 12, "OSAK");
    join(s1, luna.id, s1Team, {}, 11, "Luna | ART");
    join(s1, kai.id, s1Team, {}, 10);
    join(s1, maya.id, s1Mod, {}, 9);
    join(s1, bruno.id, s1Vip, {}, 7);
    join(s1, ana.id, s1Default, {}, 6);
    join(s1, teo.id, s1Default, {}, 5);
    join(s1, sofia.id, s1Default, {}, 4);
    join(s1, rafa.id, s1Default, {}, 2);

    const c1 = category(s1, "INFORMAÇÕES", 0);
    const c2 = category(s1, "COMUNIDADE", 1);
    const c3 = category(s1, "SUPORTE", 2);
    const c4 = category(s1, "VOZ", 3);

    const chAnuncios = channel(s1, c1, "anúncios", "text", 0, "Novidades oficiais do estúdio.");
    const chRegras = channel(s1, c1, "regras", "text", 1, "Leia antes de participar.");
    const chGeral = channel(s1, c2, "geral", "text", 0, "Conversa livre da comunidade.");
    const chMemes = channel(s1, c2, "memes", "text", 1, "Só memes de qualidade duvidosa.");
    const chNovidades = channel(s1, c2, "novidades", "text", 2, "O que rolou na semana.");
    const chAjuda = channel(s1, c3, "ajuda", "text", 0, "Trava? Manda aqui.");
    const chChamados = channel(s1, c3, "chamados", "text", 1, "Acompanhe seus chamados.");
    const chVozGeral = channel(s1, c4, "Sala Geral", "voice", 0, "");
    const chVozJogo = channel(s1, c4, "Jogatina", "voice", 1, "");

    const artSvg =
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">' +
          '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" stop-color="#35e0a8"/><stop offset="1" stop-color="#8f83ff"/>' +
          "</linearGradient></defs>" +
          '<rect width="640" height="360" rx="18" fill="#0E1517"/>' +
          '<circle cx="500" cy="90" r="120" fill="url(#g)" opacity="0.55"/>' +
          '<rect x="48" y="200" width="360" height="18" rx="9" fill="#35e0a8"/>' +
          '<rect x="48" y="238" width="240" height="14" rx="7" fill="#33484a"/>' +
          '<rect x="48" y="272" width="300" height="14" rx="7" fill="#243335"/>' +
          '<text x="48" y="120" font-family="system-ui" font-size="54" font-weight="700" fill="#eafff7">capa v3</text>' +
          "</svg>"
      );

    msg(chAnuncios, luna, "Bem-vindos ao Estúdio Criativo! 🎉 Use #geral para se apresentar.", 26 * HOUR, {
      pinned: true,
      reactions: { "🎉": [kai.id, maya.id, ana.id, bruno.id], "❤️": [demo.id, teo.id] },
    });
    msg(chRegras, maya, "1) Respeite. 2) Sem spam. 3) Conteúdo NSFW = ban. 4) Divirta-se.", 25 * HOUR, {
      pinned: true,
      reactions: { "👍": [luna.id, kai.id, ana.id] },
    });
    msg(chGeral, luna, "Bom dia, pessoal! Alguém topa um café virtual hoje às 15h?", 5 * HOUR, {
      reactions: { "☕": [kai.id, demo.id, sofia.id], "👍": [ana.id] },
    });
    msg(chGeral, kai, "Conto comigo ☕ já vou preparar o código do novo site.", 4.6 * HOUR, {
      reactions: { "🚀": [luna.id, rafa.id] },
    });
    msg(chGeral, demo, "Boa! Vou levar o protótipo do Nexo pra mostrar.", 4.4 * HOUR);
    msg(chGeral, maya, "Fiz uma arte nova pra capa, olha só:", 4.3 * HOUR, {
      attachments: [{ type: "image", url: artSvg, name: "capa-v3.svg", size: 1240 }],
      reactions: { "🔥": [luna.id, kai.id, bruno.id, ana.id], "👏": [demo.id] },
    });
    msg(chGeral, ana, "Ansiosa pra ver 👀", 4.2 * HOUR);
    msg(chGeral, bruno, "Se puderem entrar na Sala Geral depois, gravei uma trilha nova.", 3.1 * HOUR);
    msg(chGeral, maya, "Pode deixar, terminando uma arte e já vou lá.", 3 * HOUR);
    msg(chGeral, luna, "Mandei o link do convite pro grupo da faculdade também.", 40 * MIN);
    msg(chMemes, teo, "Quando você abre o app e lembra que é segunda:", 6 * HOUR);
    msg(chMemes, rafa, "kkkkkk esse sou eu todo dia", 5.5 * HOUR);
    msg(chNovidades, kai, "Nova versão do site no ar — responsivo em celular agora 🚀", 20 * HOUR);
    msg(chNovidades, demo, "Fechou! Próximo passo: sistema de cargos.", 19 * HOUR);
    msg(chAjuda, sofia, "Como faço pra criar canal de voz?", 8 * HOUR);
    msg(chAjuda, demo, "No painel do servidor: + → Criar canal → Voz. Qualquer coisa me chama.", 7.6 * HOUR);
    msg(chChamados, ana, "Chamado #104: avatar não carrega no celular.", 30 * HOUR);
    msg(chChamados, maya, "Chamado #104 em análise ✔", 28 * HOUR);

    /* ============ SERVIDOR 2 · Mesa7 RPG (demo é dono) ============ */
    const s2 = makeServer({
      name: "Mesa7 · RPG",
      description: "Campanha de fantasia, sessões às sextas.",
      emoji: "🎲",
      color: "#8f83ff",
      ownerId: demo.id,
      createdAt: now - 6 * DAY,
    });
    const s2Default = makeRole(s2, {
      name: "Jogador", isDefault: true, position: 0, color: "#93a8a4", icon: "🎲",
      description: "Quem rola os dados.",
      perms: ["viewChannels", "sendMessages", "createInvite", "joinVoice"],
    });
    const s2Mestre = makeRole(s2, {
      name: "Mestre", position: 1, color: "#8f83ff", icon: "🧙",
      description: "Conduz a campanha.",
      perms: ["viewChannels", "sendMessages", "createInvite", "joinVoice", "manageChannels",
        "deleteMessages", "pinMessages", "manageMembers", "viewLogs"],
    });
    join(s2, demo.id, s2Default, {}, 6, "OSAK | BRUXA");
    join(s2, luna.id, s2Mestre, {}, 6);
    join(s2, bruno.id, s2Default, {}, 5);
    join(s2, ana.id, s2Default, {}, 3);

    const m1 = category(s2, "MESA", 0);
    const m2 = category(s2, "FORA DO JOGO", 1);
    const chSessao = channel(s2, m1, "sessão-atual", "text", 0, "Anotações da campanha.");
    const chFicha = channel(s2, m1, "fichas", "text", 1, "Personagens.");
    const chVozMesa = channel(s2, m1, "Sala da Mesa", "voice", 2, "");
    const chOffTopic = channel(s2, m2, "conversa", "text", 0, "");

    msg(chSessao, luna, "Sessão 7: chegam à cidade de Valdor. Preparem os dados 🎲", 30 * HOUR);
    msg(chSessao, demo, "Minha bruxa já está com saudade do grupo.", 29 * HOUR);
    msg(chFicha, bruno, "Atualizei o nível do bardo, agora canta melhor (e mente mais).", 22 * HOUR);
    msg(chOffTopic, ana, "Alguém viu o episódio novo?", 9 * HOUR);

    /* ============ SERVIDOR 3 · Café & Código (kai é dono, demo é membro) ============ */
    const s3 = makeServer({
      name: "Café & Código",
      description: "Programadores, cafés e conversa boa.",
      emoji: "☕",
      color: "#4cc9f0",
      ownerId: kai.id,
      createdAt: now - 20 * DAY,
    });
    const s3Default = makeRole(s3, {
      name: "Membros", isDefault: true, position: 0, color: "#93a8a4",
      perms: ["viewChannels", "sendMessages", "createInvite", "joinVoice"],
    });
    join(s3, kai.id, s3Default, {}, 20);
    join(s3, demo.id, s3Default, {}, 14);
    join(s3, sofia.id, s3Default, {}, 12);
    join(s3, rafa.id, s3Default, {}, 10);

    const k1 = category(s3, "CAFÉ", 0);
    const k2 = category(s3, "CÓDIGO", 1);
    const chCafe = channel(s3, k1, "bate-papo", "text", 0, "");
    const chDuvidas = channel(s3, k2, "dúvidas", "text", 0, "Perguntas de qualquer linguagem.");
    const chPair = channel(s3, k2, "pair-programming", "text", 1, "");
    const chVozCafe = channel(s3, k1, "Mesa Central", "voice", 1, "");

    msg(chCafe, kai, "Hoje o café é duplo ☕☕", 7 * HOUR);
    msg(chCafe, sofia, "Aprovado.", 6.8 * HOUR);
    msg(chDuvidas, demo, "Alguém sabe por que meu grid quebra no celular?", 2 * HOUR);
    msg(chDuvidas, rafa, "Quase sempre é o minmax. Coloca minmax(0, 1fr) 😅", 1.8 * HOUR);
    msg(chDuvidas, demo, "Era isso mesmo, valeu! 🙏", 1.6 * HOUR);

    /* ---------- convites de demonstração ---------- */
    db.invites["NOVO1"] = { code: "NOVO1", serverId: s1, creatorId: demo.id, createdAt: now - 5 * DAY, uses: 3 };
    db.invites["MESA7"] = { code: "MESA7", serverId: s2, creatorId: demo.id, createdAt: now - 4 * DAY, uses: 1 };
    db.invites["CAFE9"] = { code: "CAFE9", serverId: s3, creatorId: kai.id, createdAt: now - 9 * DAY, uses: 7 };

    /* ---------- conversas diretas ---------- */
    const dm1 = S_dm(demo.id, luna.id, now - 6 * DAY);
    msg(dm1, luna, "Oi! Viu o protótipo do Nexo?", 3 * HOUR);
    msg(dm1, demo, "Vi sim, tô terminando as permissões agora.", 2.9 * HOUR);
    msg(dm1, luna, "Ficou lindo. Manda o convite quando abrir pro pessoal 🚀", 2.8 * HOUR);
    msg(dm1, demo, "Já já mando! Testa o código NOVO1.", 2.7 * HOUR);

    const dm2 = S_dm(demo.id, kai.id, now - 3 * DAY);
    msg(dm2, kai, "Amanhã a gente revisa o layout juntos?", 30 * HOUR);
    msg(dm2, demo, "Combinado. 10h?", 29 * HOUR);

    function S_dm(a, b, created) {
      const id = "dm_" + [a, b].sort().join("_");
      db.dms[id] = { id: id, participants: [a, b], createdAt: created || now };
      return id;
    }

    /* ---------- usuário banido de demonstração ---------- */
    const gus = makeUser({
      username: "gus", displayName: "Gustavo", emoji: "💀", color: "#ff6b7a",
      status: "offline", bio: "Fui banido do estúdio...",
    });
    const banId = uid("bn");
    db.bans[banId] = {
      id: banId,
      serverId: s1,
      userId: gus.id,
      reason: "Spam de convites em #anúncios",
      byId: demo.id,
      at: now - 3 * DAY,
    };

    /* ---------- emojis personalizados do servidor ---------- */
    db.emojis = {};
    function seedEmoji(serverId, name, color, glyph, ago) {
      const id = uid("em");
      const svg =
        "data:image/svg+xml;utf8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">' +
            '<rect width="128" height="128" rx="28" fill="' + color + '"/>' +
            '<text x="64" y="86" font-size="66" text-anchor="middle" font-family="system-ui">' + glyph + "</text>" +
            "</svg>"
        );
      db.emojis[id] = {
        id: id, serverId: serverId, name: name, image: svg,
        createdBy: db.servers[serverId].ownerId, createdAt: now - ago,
      };
      return id;
    }
    seedEmoji(s1, "nexo", "#35e0a8", "🟩", 8 * DAY);
    seedEmoji(s1, "cafe", "#f0956b", "☕", 7 * DAY);
    seedEmoji(s1, "fire", "#ff6b7a", "🔥", 6 * DAY);
    seedEmoji(s2, "dado", "#8f83ff", "🎲", 5 * DAY);

    /* ---------- logs de moderação ---------- */
    db.logs = [];
    function seedLog(serverId, action, actorId, ago, meta) {
      db.logs.push({
        id: uid("lg"), serverId: serverId, action: action, actorId: actorId,
        at: now - ago, meta: meta || null,
      });
    }
    seedLog(s1, "channel.create", demo.id, 4 * DAY, { name: "#novidades" });
    seedLog(s1, "member.join", ana.id, 6 * DAY, { userId: ana.id });
    seedLog(s1, "role.create", demo.id, 5 * DAY, { name: "VIP" });
    seedLog(s1, "member.role", demo.id, 5 * DAY, { userId: bruno.id, role: "VIP" });
    seedLog(s1, "member.ban", demo.id, 3 * DAY, { userId: gus.id, reason: "Spam de convites" });
    seedLog(s1, "invite.create", demo.id, 2 * DAY, { code: "NOVO1" });
    seedLog(s1, "category.create", demo.id, 26 * HOUR, { name: "SUPORTE" });
    seedLog(s3, "member.join", demo.id, 14 * DAY, { userId: demo.id });
    seedLog(s3, "channel.create", kai.id, 11 * DAY, { name: "#pair-programming" });

    /* ---------- notificações da conta demo ---------- */
    db.notifications = [];
    function seedNotify(userId, type, text, ago, read) {
      db.notifications.push({
        id: uid("nt"), userId: userId, type: type, text: text,
        at: now - ago, read: !!read, meta: null,
      });
    }
    seedNotify(demo.id, "invite", "Luna Prado convidou o grupo da faculdade para o Estúdio Criativo.", 40 * MIN, false);
    seedNotify(demo.id, "mention", "@kai mencionou você em Café & Código.", 2 * HOUR, false);
    seedNotify(demo.id, "system", "Novo canal criado: #novidades em Estúdio Criativo.", 4 * HOUR, true);
    seedNotify(demo.id, "server", "Você foi banido de nada — apenas um teste do sistema. 😅", 6 * HOUR, true);

    /* ---------- rede social (demonstração) ----------
       Seguidores, publicações, curtidas e comentários.
       Tudo é marcado com demo:true para identificação fácil e nada
       substitui dados reais: este bloco só roda com o banco vazio. */
    function socialFollow(follower, target, ago) {
      const id = follower.id + ">" + target.id;
      if (db.follows[id]) return;
      db.follows[id] = {
        id: id, followerId: follower.id, followingId: target.id,
        state: "active", createdAt: now - ago, demo: true,
      };
    }
    function socialPost(author, content, ago, media) {
      const id = uid("po");
      db.posts[id] = {
        id: id, authorId: author.id, content: content, media: media || [],
        createdAt: now - ago, likesCount: 0, commentsCount: 0, demo: true,
      };
      return db.posts[id];
    }
    function socialComment(post, author, content, ago, parentId) {
      const id = uid("cm");
      db.comments[id] = {
        id: id, postId: post.id, parentId: parentId || null, authorId: author.id,
        content: content, createdAt: now - ago, likesCount: 0, demo: true,
      };
      return db.comments[id];
    }
    function socialLike(user, type, target, ago) {
      const id = [type, target.id, user.id].join(":");
      db.likes[id] = {
        id: id, userId: user.id, targetType: type, targetId: target.id,
        createdAt: now - ago, demo: true,
      };
    }
    /* imagem embutida (data URI) — o upload real usa o mesmo formato */
    function socialArt(label, c1, c2) {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/>' +
        "</linearGradient></defs>" +
        '<rect width="800" height="450" fill="url(#g)"/>' +
        '<circle cx="660" cy="110" r="70" fill="rgba(255,255,255,.18)"/>' +
        '<text x="56" y="384" font-family="Segoe UI,Arial" font-size="44" font-weight="700" fill="#06231a">' +
        label + "</text></svg>";
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    }

    /* quem segue quem */
    [luna, kai, maya, bruno].forEach((u, i) => socialFollow(demo, u, (i + 1) * DAY));
    [luna, kai, ana, sofia].forEach((u, i) => socialFollow(u, demo, (i + 1) * 6 * HOUR));
    socialFollow(kai, luna, 9 * DAY);
    socialFollow(maya, luna, 8 * DAY);
    socialFollow(bruno, kai, 7 * DAY);
    socialFollow(teo, maya, 6 * DAY);
    socialFollow(ana, luna, 5 * DAY);

    /* publicações */
    const pLuna = socialPost(
      luna,
      "Campanha de RPG nova começando sábado. Quem topa jogar? 🎲",
      2 * HOUR
    );
    const pKai = socialPost(
      kai,
      "Terminei o painel de membros hoje: cargos, permissões e busca em um lugar só. Ficou clean.",
      5 * HOUR,
      [{ kind: "image", url: socialArt("Painel de membros", "#35e0a8", "#8f83ff") }]
    );
    const pMaya = socialPost(
      maya,
      "Nova ilustração pra galeria do servidor 🐙",
      1 * DAY,
      [{ kind: "image", url: socialArt("Galeria Nexo", "#ff7ab6", "#ffc857") }]
    );
    const pDemo = socialPost(demo, "Olá pessoal! Testando o feed da Nexo por aqui.", 3 * HOUR);
    const pBruno = socialPost(bruno, "Playlist nova no #música 🎧 sobe hoje à noite.", 2 * DAY);

    /* comentários (inclusive resposta) */
    const cKai1 = socialComment(pLuna, kai, "Conto comigo! Levo os dados da campanha.", 100 * MIN);
    const cDemo1 = socialComment(pLuna, demo, "Fechado — me entram na lista.", 90 * MIN);
    const cLuna1 = socialComment(pKai, luna, "Ficou ótimo, o guia ficou muito mais rápido.", 4 * HOUR);
    const cDemo2 = socialComment(pMaya, demo, "Ficou incrível! Amei as cores.", 20 * HOUR);
    const cKai2 = socialComment(pMaya, kai, "Concordo — a paleta ficou perfeita.", 19 * HOUR, cDemo2.id);
    const cMaya1 = socialComment(pDemo, maya, "Bem-vinda ao feed! 👋", 2 * HOUR);

    /* curtidas (uma por pessoa por conteúdo) */
    socialLike(demo, "post", pLuna, 110 * MIN);
    socialLike(kai, "post", pLuna, 105 * MIN);
    socialLike(maya, "post", pLuna, 100 * MIN);
    socialLike(luna, "post", pKai, 4 * HOUR);
    socialLike(demo, "post", pKai, 3 * HOUR);
    socialLike(bruno, "post", pKai, 3 * HOUR);
    socialLike(demo, "post", pMaya, 22 * HOUR);
    socialLike(luna, "post", pMaya, 21 * HOUR);
    socialLike(kai, "post", pMaya, 20 * HOUR);
    socialLike(ana, "post", pMaya, 20 * HOUR);
    socialLike(bruno, "post", pMaya, 19 * HOUR);
    socialLike(luna, "post", pDemo, 2 * HOUR);
    socialLike(kai, "post", pDemo, 100 * MIN);
    socialLike(kai, "post", pBruno, 1 * DAY);
    socialLike(bruno, "comment", cKai1, 80 * MIN);
    socialLike(demo, "comment", cLuna1, 3 * HOUR);
    socialLike(maya, "comment", cDemo2, 18 * HOUR);

    /* contadores derivados (a fonte da verdade são as coleções) */
    Object.keys(db.posts).forEach((pid) => {
      db.posts[pid].likesCount = Object.keys(db.likes).filter(
        (k) => db.likes[k].targetType === "post" && db.likes[k].targetId === pid
      ).length;
      db.posts[pid].commentsCount = Object.keys(db.comments).filter(
        (c) => db.comments[c].postId === pid
      ).length;
    });
    Object.keys(db.comments).forEach((cid) => {
      db.comments[cid].likesCount = Object.keys(db.likes).filter(
        (k) => db.likes[k].targetType === "comment" && db.likes[k].targetId === cid
      ).length;
    });

    /* notificações sociais da conta demo — ao clicar, abrem o conteúdo */
    function socialNotify(userId, type, text, href, ago, actorId) {
      db.notifications.push({
        id: uid("nt"), userId: userId, type: type, text: text,
        at: now - ago, read: false, demo: true,
        meta: { href: href, actorId: actorId },
      });
    }
    socialNotify(demo.id, "like", "@luna curtiu sua publicação.", "#/feed/" + pDemo.id, 2 * HOUR, luna.id);
    socialNotify(demo.id, "follow", "@kai começou a seguir você.", "#/perfil/kai", 3 * HOUR, kai.id);
    socialNotify(demo.id, "comment", "@maya comentou sua publicação.", "#/feed/" + pDemo.id, 2 * HOUR, maya.id);
    socialNotify(demo.id, "reply", "@kai respondeu seu comentário.", "#/feed/" + pMaya.id, 19 * HOUR, kai.id);
    db.notifications.reverse();

    /* ---------- presença ---------- */
    Object.keys(db.users).forEach((id) => {
      db.presence[id] = db.users[id].status || "offline";
    });

    /* privacidade padrão + contadores recalculados a partir das
       coleções (o perfil nunca confia em número salvo sozinho) */
    NX.store.migrateSocial();

    NX.store.persist();
    return true;
  }

  NX.seed = seed;
})(window.NX);
