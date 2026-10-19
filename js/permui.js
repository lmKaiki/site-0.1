/* ============================================================
   NEXO · permissões por canal e categoria (UI)
   Matriz de três estados por alvo (@everyone, cargos, usuários):
     🟢 Permitir · 🔴 Negar · ⚪ Herdar
   Contrato:
     NX.permUI.channelPanel(channelId, containerEl)
     NX.permUI.categoryPanel(categoryId, containerEl)
     NX.permUI.openChannel(channelId)
     NX.permUI.openCategory(categoryId)
     NX.permUI.targets(ref)
   Todas as classes CSS são prefixadas com `pm-`.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const u = () => NX.util;
  const S = () => NX.selectors;

  /* ---------------- abas de alvo ---------------- */
  const TABS = [
    { id: "everyone", kind: "everyone", label: "@everyone", icon: "users" },
    { id: "roles", kind: "role", label: (NX.i18n.get("adm.cargos", "Cargos")), icon: "shield" },
    { id: "users", kind: "user", label: (NX.i18n.get("ex.usuarios", "Usuários")), icon: "user" },
  ];

  /* ---------------- os três estados ---------------- */
  const STATES = [
    { id: "allow", value: true, ico: "\uD83D\uDFE2", label: NX.i18n.get("perm.permitir", "Permitir"), hint: NX.i18n.get("perm.permiteAquiMesmoOutro", "Permite aqui, mesmo que outro cargo negue.") },
    { id: "deny", value: false, ico: "\uD83D\uDD34", label: (NX.i18n.get("perm.negar", "Negar")), hint: "Nega aqui; negar sempre vence permitir." },
    { id: "inherit", value: null, ico: "\u26AA", label: NX.i18n.get("perm.herdar", "Herdar"), hint: NX.i18n.get("perm.regraPropriaHerdaNivel", "Sem regra própria: herda do nível anterior.") },
  ];

  const GROUP_ICON = { "Geral": "settings", "Chat": "chat", "Modera\u00e7\u00e3o": "shield", "Voz": "mic" };

  /* ============================================================
     utilidades
     ============================================================ */
  const h = (s) => u().h(s);

  function permGroups() {
    const order = [];
    const map = {};
    (NX.PERMS || []).forEach((p) => {
      const g = p.group || (NX.i18n.get("core.geral", "Geral"));
      if (!map[g]) {
        map[g] = [];
        order.push(g);
      }
      map[g].push(p);
    });
    return order.map((name) => ({ name: name, perms: map[name] }));
  }

  function permDef(key) {
    return (NX.PERMS || []).find((p) => p.key === key) || { key: key, label: key, desc: "", group: "" };
  }

  /* estado de uma permissão dentro do container: true | false | null */
  function getPerm(container, targetKey, permKey) {
    const box = container && container.perms ? container.perms[targetKey] : null;
    if (!box) return null;
    const v = box[permKey];
    return v === true ? true : v === false ? false : null;
  }

  function overrideKeys(container, targetKey) {
    const box = container && container.perms ? container.perms[targetKey] : null;
    if (!box) return [];
    return Object.keys(box).filter((k) => box[k] === true || box[k] === false);
  }

  function canManage(serverId) {
    const me = S().me();
    if (!me || !serverId) return false;
    return !!S().can(serverId, me.id, "manageChannels");
  }

  /* aceita um canal, uma categoria, um container ou um id de servidor */
  function serverIdOf(ref) {
    if (!ref) return null;
    if (typeof ref === "string") {
      const ch = S().channel(ref);
      if (ch) return ch.serverId;
      const cat = S().category(ref);
      if (cat) return cat.serverId;
      return null;
    }
    if (ref.serverId) return ref.serverId;
    if (ref.id) {
      const ch = S().channel(ref.id);
      if (ch) return ch.serverId;
      const cat = S().category(ref.id);
      if (cat) return cat.serverId;
    }
    return null;
  }

  /* ---------------- alvos ---------------- */
  function membersOf(serverId) {
    try {
      return S().membersOf(serverId) || [];
    } catch (e) {
      return [];
    }
  }

  function rolesOf(serverId) {
    try {
      return S().rolesOf(serverId) || [];
    } catch (e) {
      return [];
    }
  }

  function holdersOfRole(serverId, roleId) {
    return membersOf(serverId).filter((m) => {
      const mem = m.membership;
      if (!mem) return false;
      if (mem.roleId === roleId) return true;
      return (mem.extraRoleIds || []).indexOf(roleId) !== -1;
    });
  }

  function buildTargets(serverId) {
    const out = [];
    out.push({
      key: "everyone",
      kind: "everyone",
      label: "@everyone",
      sub: NX.i18n.get("perm.todosMembrosServidor", "Todos os membros do servidor"),
      icon: "users",
    });
    rolesOf(serverId).forEach((r) => {
      const n = holdersOfRole(serverId, r.id).length;
      out.push({
        key: "role:" + r.id,
        kind: "role",
        id: r.id,
        label: r.name,
        color: r.color || "#93a8a4",
        icon: r.icon || "",
        sub: (r.isDefault ? NX.i18n.get("perm.cargoPadrao", "Cargo padrão") : (NX.i18n.get("adm.cargo", "Cargo"))) + " \u00b7 " + u().plural(n, "membro", "membros"),
      });
    });
    membersOf(serverId).forEach((m) => {
      const usr = m.user;
      if (!usr) return;
      out.push({
        key: "user:" + usr.id,
        kind: "user",
        id: usr.id,
        label: usr.displayName || usr.username,
        sub: "@" + usr.username + (m.role ? " \u00b7 " + m.role.name : ""),
        user: usr,
      });
    });
    return out;
  }

  /* membro de exemplo usado no resumo de efeito real */
  function exampleUser(serverId, t) {
    if (!serverId) return null;
    const members = membersOf(serverId);
    if (!members.length) return null;
    if (t && t.kind === "user") {
      const hit = members.find((m) => m.user.id === t.id);
      if (hit) return hit.user;
    }
    if (t && t.kind === "role") {
      const hit = holdersOfRole(serverId, t.id)[0];
      if (hit) return hit.user;
    }
    const server = S().server(serverId);
    const pool = members.filter((m) => !server || m.user.id !== server.ownerId);
    const list = pool.length ? pool : members;
    const def = S().defaultRole(serverId);
    const withDefault = def ? list.find((m) => m.membership && m.membership.roleId === def.id) : null;
    return (withDefault || list[0]).user;
  }

  /* ============================================================
     painel
     ============================================================ */
  function createPanel(kind, id, host) {
    const groups = permGroups();
    const st = {
      tab: "everyone",
      sel: { everyone: "everyone", roles: null, users: null },
      q: "",
      busy: {},
      restoreBusy: false,
      search: "",
    };

    let container = null;
    let targets = [];
    let serverId = null;
    let permitted = false;
    let alive = true;

    const root = u().el('<div class="pm-panel" data-pm-panel></div>');
    const detached = host === null || host === undefined;
    const mount = detached ? null : host;

    if (mount) {
      Array.prototype.slice.call(mount.querySelectorAll(".pm-panel")).forEach((n) => n.remove());
      mount.appendChild(root);
    }

    /* ---------------- leitura ---------------- */
    function sync() {
      container = kind === "channel" ? S().channel(id) : S().category(id);
      serverId = container ? container.serverId : null;
      permitted = !!container && canManage(serverId);
      if (!container) return;
      targets = buildTargets(serverId);
      TABS.forEach((t) => {
        const kindNow = t.kind;
        const chosen = st.sel[t.id];
        const stillThere = chosen && targets.some((x) => x.key === chosen && x.kind === kindNow);
        if (!stillThere) {
          const first = targets.find((x) => x.kind === kindNow);
          st.sel[t.id] = first ? first.key : null;
        }
      });
    }

    function currentTarget() {
      const tab = TABS.find((t) => t.id === st.tab) || TABS[0];
      const chosen = st.sel[st.tab];
      return (
        targets.find((x) => x.key === chosen) ||
        targets.find((x) => x.kind === tab.kind) ||
        null
      );
    }

    /* ---------------- HTML · cabeçalho ---------------- */
    function inheritHTML(cat) {
      if (!cat) {
        return (
          '<div class="pm-inherit is-off">' +
          '<div class="pm-inherit__row">' +
          ("<span class=\"pm-inherit__txt\"><strong>" + NX.i18n.get("perm.herdarpermissoesdacategoria", "Herdar permissões da categoria") + "</strong>") +
          ("<small>" + NX.i18n.get("perm.estecanalnaoestadentrode", "Este canal não está dentro de uma categoria, então usa permissões próprias.") + "</small></span>") +
          '<span class="switch"><input type="checkbox" data-pm-inherit disabled /><i></i></span>' +
          "</div>" +
          ("<div class=\"pm-chips\"><span class=\"pm-chip pm-chip--own\">" + NX.i18n.get("perm.permissoesproprias", "⚙ Permissões próprias") + "</span></div>") +
          "</div>"
        );
      }
      const on = container.inheritPerms !== false;
      return (
        '<div class="pm-inherit' + (on ? "" : " is-own") + '">' +
        '<div class="pm-inherit__row">' +
        ("<span class=\"pm-inherit__txt\"><strong>" + NX.i18n.get("perm.herdarpermissoesdacategoria", "Herdar permissões da categoria") + "</strong>") +
        "<small>" +
        (on
          ? (NX.i18n.get("perm.osajustesabaixocomecamnosde", "Os ajustes abaixo começam nos de") + " ") + h(cat.name) + "."
          : (NX.i18n.get("perm.estecanalignoraaspermissoesde", "Este canal ignora as permissões de") + " ") + h(cat.name) + (" " + NX.i18n.get("perm.eusaasproprias", "e usa as próprias."))) +
        "</small></span>" +
        '<span class="switch"><input type="checkbox" data-pm-inherit' + (on ? " checked" : "") + " /><i></i></span>" +
        "</div>" +
        '<div class="pm-chips">' +
        (on
          ? ("<span class=\"pm-chip pm-chip--on\">" + NX.i18n.get("perm.herdandode", "↻ Herdando de") + " ") + h(cat.name) + "</span>"
          : ("<span class=\"pm-chip pm-chip--own\">" + NX.i18n.get("perm.permissoespropriasignora", "⚙ Permissões próprias · ignora") + " ") + h(cat.name) + "</span>") +
        (on ? ("<span class=\"pm-chip\">" + NX.i18n.get("perm.servidorcategoriacanal", "servidor → categoria → canal") + "</span>") : "") +
        "</div>" +
        "</div>"
      );
    }

    function categoryNoteHTML() {
      const chans = S().channelsOfCategory(id) || [];
      const MAX = 16;
      const shown = chans.slice(0, MAX);
      const chips = shown
        .map((c) => {
          const own = c.inheritPerms === false;
          return (
            '<span class="pm-chip ' + (own ? "pm-chip--own" : "pm-chip--on") + '">' +
            NX.icon(c.type === "voice" ? "voice" : "hash", "", 13) +
            h(c.name) + " \u00b7 " + (own ? (NX.i18n.get("perm.proprias", "próprias")) : "herda") +
            "</span>"
          );
        })
        .join("");
      const more =
        chans.length > shown.length
          ? '<span class="pm-chip">+' + (chans.length - shown.length) + "</span>"
          : "";
      return (
        '<div class="pm-note">' +
        NX.icon("info", "", 17) +
        '<div class="pm-note__txt">' +
        ("<strong>" + NX.i18n.get("perm.oscanaisdestacategoriaherdamestas", "Os canais desta categoria herdam estas permissões.") + "</strong>") +
        ("<span>" + NX.i18n.get("perm.quemcriarumcanalaquicomeca", "Quem criar um canal aqui começa com esta matriz. Canais marcados como próprios ignoram a categoria.") + "</span>") +
        (chans.length
          ? '<div class="pm-chips">' + chips + more + "</div>"
          : ("<span class=\"pm-hint\">" + NX.i18n.get("perm.nenhumcanalnestacategoriaainda", "Nenhum canal nesta categoria ainda.") + "</span>")) +
        "</div>" +
        "</div>"
      );
    }

    function headHTML() {
      if (!container) return "";
      const server = S().server(serverId);
      let icon = "hash";
      let title = "";
      let sub = server ? server.name : "";
      if (kind === "channel") {
        icon = container.type === "voice" ? "voice" : "hash";
        title = (container.type === "voice" ? "" : "#") + container.name;
        const cat = container.categoryId ? S().category(container.categoryId) : null;
        sub = (server ? server.name : "") + (cat ? " \u00b7 " + cat.name : (" " + NX.i18n.get("perm.semcategoria", "· sem categoria")));
        return (
          '<div class="pm-head">' +
          '<span class="pm-head__ico">' + NX.icon(icon, "", 18) + "</span>" +
          '<span class="pm-head__txt"><strong>' + h(title) + "</strong><small>" + h(sub) + "</small></span>" +
          "</div>" +
          inheritHTML(cat)
        );
      }
      icon = "folder";
      title = container.name;
      const n = (S().channelsOfCategory(id) || []).length;
      sub = (server ? server.name : "") + " \u00b7 " + u().plural(n, "canal", "canais");
      return (
        '<div class="pm-head">' +
        '<span class="pm-head__ico">' + NX.icon(icon, "", 18) + "</span>" +
        '<span class="pm-head__txt"><strong>' + h(title) + "</strong><small>" + h(sub) + "</small></span>" +
        "</div>" +
        categoryNoteHTML()
      );
    }

    /* ---------------- HTML · seletor de alvo ---------------- */
    function counts() {
      return {
        everyone: 1,
        roles: targets.filter((x) => x.kind === "role").length,
        users: targets.filter((x) => x.kind === "user").length,
      };
    }

    function controlsHTML() {
      const c = counts();
      return (
        '<div class="pm-tabs" role="tablist" aria-label="' + NX.i18n.get("ui.tipodealvo", "Tipo de alvo") + '">' +
        TABS.map((t) => {
          const on = st.tab === t.id;
          return (
            '<button type="button" class="pm-tab' + (on ? " is-on" : "") + '" role="tab" aria-selected="' + on +
            '" data-pm-tab="' + t.id + '">' +
            NX.icon(t.icon, "", 15) +
            "<span>" + h(t.label) + "</span><em>" + c[t.id] + "</em></button>"
          );
        }).join("") +
        "</div>" +
        '<div class="pm-picker">' +
        (st.tab === "everyone"
          ? ""
          : '<span class="input-affix pm-picker__search">' +
            '<span class="input-affix__ico">' + NX.icon("search", "", 16) + "</span>" +
            '<input class="input" type="search" data-pm-search autocomplete="off" placeholder="' +
            (st.tab === "roles"
              ? NX.i18n.get("ui.a11ybuscarcargo", "Buscar cargo…")
              : NX.i18n.get("ui.a11ybuscarmembro", "Buscar membro…")) +
            '" value="' + h(st.q) + '" /></span>') +
        '<div class="pm-picker__list" data-pm-list>' + listHTML() + "</div>" +
        "</div>"
      );
    }

    function pickHTML(t) {
      const on = st.sel[st.tab] === t.key;
      const n = overrideKeys(container, t.key).length;
      const badge = n ? '<span class="pm-pick__n">' + n + "</span>" : "";
      if (t.kind === "everyone") {
        return (
          '<button type="button" class="pm-pick pm-pick--wide' + (on ? " is-on" : "") + '" data-pm-target="' + h(t.key) + '">' +
          '<span class="pm-pick__ico">' + NX.icon("users", "", 18) + "</span>" +
          ("<span class=\"pm-pick__txt\"><strong>" + NX.i18n.get("perm.everyone", "@everyone") + "</strong><small>") + h(t.sub) + "</small></span>" +
          badge +
          "</button>"
        );
      }
      if (t.kind === "role") {
        return (
          '<button type="button" class="pm-pick' + (on ? " is-on" : "") + '" data-pm-target="' + h(t.key) + '" title="' + h(t.sub) + '">' +
          '<span class="pm-pick__dot" style="--rc:' + h(t.color || "#93a8a4") + '"></span>' +
          '<span class="pm-pick__txt"><strong>' + h(t.label) + "</strong><small>" + h(t.sub) + "</small></span>" +
          badge +
          "</button>"
        );
      }
      return (
        '<button type="button" class="pm-pick' + (on ? " is-on" : "") + '" data-pm-target="' + h(t.key) + '" title="' + h(t.sub) + '">' +
        u().avatarHTML(t.user, "xs") +
        '<span class="pm-pick__txt"><strong>' + h(t.label) + "</strong><small>" + h(t.sub) + "</small></span>" +
        badge +
        "</button>"
      );
    }

    function listHTML() {
      const tab = TABS.find((t) => t.id === st.tab) || TABS[0];
      const items = targets.filter((x) => x.kind === tab.kind);
      if (!items.length) {
        return ("<div class=\"pm-empty\">" + NX.i18n.get("perm.eprecisotermembrosecargos", "É preciso ter membros e cargos neste servidor.") + "</div>");
      }
      if (tab.kind === "everyone") return pickHTML(items[0]);
      const q = u().normalize(st.q.trim());
      const shown = q
        ? items.filter((x) => u().normalize(x.label + " " + (x.sub || "")).indexOf(q) !== -1)
        : items;
      if (!shown.length) {
        return ("<div class=\"pm-empty\">" + NX.i18n.get("perm.nenhumresultadopara", "Nenhum resultado para “")) + h(st.q.trim()) + "\u201d.</div>";
      }
      return shown.map(pickHTML).join("");
    }

    /* ---------------- HTML · resumo ---------------- */
    function targetVisual(t) {
      if (t.kind === "user") return u().avatarHTML(t.user, "sm");
      if (t.kind === "role")
        return '<span class="pm-target__dot" style="--rc:' + h(t.color || "#93a8a4") + '"></span>';
      return '<span class="pm-target__ico">' + NX.icon("users", "", 18) + "</span>";
    }

    function targetBarInner() {
      const t = currentTarget();
      if (!t) return ("<div class=\"pm-empty\">" + NX.i18n.get("perm.nenhumalvodisponivelnesteservidor", "Nenhum alvo disponível neste servidor.") + "</div>");
      const n = overrideKeys(container, t.key).length;
      return (
        targetVisual(t) +
        '<span class="pm-target__txt"><strong>' + h(t.label) + "</strong><small>" + h(t.sub || "") +
        (n ? " \u00b7 " + u().plural(n, "ajuste", "ajustes") : (" " + NX.i18n.get("perm.nadapersonalizado", "· nada personalizado"))) +
        "</small></span>" +
        '<button type="button" class="btn btn--soft btn--sm" data-pm-restore' + (n ? "" : " disabled") +
        (">" + NX.i18n.get("perm.atomarpadrao", "Átomar padrão") + "</button>")
      );
    }

    function targetBarHTML() {
      return '<div class="pm-target" data-pm-targetbar>' + targetBarInner() + "</div>";
    }

    function summaryHTML() {
      const t = currentTarget();
      if (!t) return "";
      const user = exampleUser(serverId, t);
      if (!user) {
        return ("<div class=\"pm-summary__empty\">" + NX.i18n.get("perm.semmembrosparasimularoefeito", "Sem membros para simular o efeito real.") + "</div>");
      }
      let eff = null;
      let where = "";
      if (kind === "channel") {
        eff = S().effectiveChannelPerms(container, user.id);
        where = (container.type === "voice" ? "" : "#") + container.name;
      } else {
        const chans = S().channelsOfCategory(id) || [];
        const ch = chans.filter((c) => c.inheritPerms !== false)[0] || chans[0];
        if (!ch) {
          return ("<div class=\"pm-summary__empty\">" + NX.i18n.get("perm.crieumcanalnestacategoriapara", "Crie um canal nesta categoria para ver o efeito real.") + "</div>");
        }
        eff = S().effectiveChannelPerms(ch, user.id);
        where = "#" + ch.name;
      }
      const base = S().effectivePerms(serverId, user.id);
      const keys = [];
      ["viewChannels", "sendMessages"].forEach((k) => {
        if (NX.PERM_KEYS.indexOf(k) !== -1 && keys.indexOf(k) === -1) keys.push(k);
      });
      NX.PERM_KEYS.forEach((k) => {
        if (eff[k] !== base[k] && keys.indexOf(k) === -1) keys.push(k);
      });
      const MAX = 9;
      const shown = keys.slice(0, MAX);
      const chips = shown
        .map((k) => {
          const on = !!eff[k];
          return (
            '<span class="pm-chip pm-chip--res ' + (on ? "is-yes" : "is-no") + '">' +
            h(permDef(k).label) + " " + (on ? "\u2705" : "\u274c") +
            "</span>"
          );
        })
        .join("");
      const more =
        keys.length > shown.length
          ? '<span class="pm-chip pm-chip--res is-more">+' + (keys.length - shown.length) + "</span>"
          : "";
      const owner = S().isOwner(serverId, user.id);
      const role = (membersOf(serverId).find((m) => m.user.id === user.id) || {}).role;
      const who = (user.displayName || user.username) + (role ? " \u00b7 " + role.name : "");
      return (
        '<div class="pm-summary__head">' +
        NX.icon("eye", "", 15) +
        ("<strong>" + NX.i18n.get("perm.efeitoreal", "Efeito real") + ("</strong><span>" + NX.i18n.get("perm.simuladoem", "simulado em") + " ")) + h(where) + "</span></div>" +
        '<div class="pm-summary__who">' + u().avatarHTML(user, "xs") + "<span>" + h(who) + "</span></div>" +
        '<div class="pm-chips pm-chips--res">' + chips + more + "</div>" +
        '<p class="pm-summary__note">' +
        (owner
          ? NX.i18n.get("perm.donoServidorTemAcesso", "Dono do servidor tem acesso total — overrides não o afetam.")
          : (NX.i18n.get("perm.valoresjaresolvidosservidor", "Valores já resolvidos: servidor →") + " ") + (kind === "category" ? (NX.i18n.get("perm.categoria2", "categoria →") + " ") : "") + "canal.") +
        "</p>"
      );
    }

    /* ---------------- HTML · matriz ---------------- */
    function segHTML(p, state) {
      return (
        '<span class="pm-seg" role="group" aria-label="' + h(p.label) + '">' +
        STATES.map((s) => {
          const on = state === s.value;
          return (
            '<button type="button" class="pm-seg__btn is-' + s.id + (on ? " is-on" : "") +
            '" data-pm-perm="' + h(p.key) + '" data-pm-val="' + s.id +
            '" aria-pressed="' + on + '" title="' + h(s.hint) + '">' +
            '<span class="pm-seg__ico">' + s.ico + "</span>" +
            '<span class="pm-seg__lbl">' + h(s.label) + "</span></button>"
          );
        }).join("") +
        "</span>"
      );
    }

    function rowHTML(p, i) {
      const t = currentTarget();
      const state = t ? getPerm(container, t.key, p.key) : null;
      return (
        '<div class="pm-row' + (state !== null ? " is-set" : "") + '" data-pm-row="' + h(p.key) +
        '" style="--i:' + Math.min(i, 14) + '">' +
        '<span class="pm-row__txt"><strong title="' + h(p.desc) + '">' + h(p.label) + "</strong>" +
        "<small>" + h(p.desc) + "</small></span>" +
        segHTML(p, state) +
        "</div>"
      );
    }

    function matrixHTML() {
      let i = 0;
      return groups
        .map((g) => {
          const icon = GROUP_ICON[g.name] || "shield";
          return (
            '<section class="pm-group">' +
            '<h4 class="pm-group__title">' + NX.icon(icon, "", 15) +
            "<span>" + h(g.name) + "</span><i></i><em>" + g.perms.length + "</em></h4>" +
            g.perms.map((p) => rowHTML(p, i++)).join("") +
            "</section>"
          );
        })
        .join("");
    }

    function legendHTML() {
      return (
        '<div class="pm-legend">' +
        STATES.map((s) => '<span class="pm-legend__item"><b>' + s.ico + "</b> " + h(s.label) + "</span>").join("") +
        '<span class="pm-legend__note">Negar vence permitir; sem regra pr\u00f3pria, vale o n\u00edvel anterior.</span>' +
        "</div>"
      );
    }

    function mainHTML() {
      return (
        '<div class="pm-main">' +
        targetBarHTML() +
        '<div class="pm-summary" data-pm-summary>' + summaryHTML() + "</div>" +
        '<div class="pm-groups" data-pm-groups>' + matrixHTML() + "</div>" +
        legendHTML() +
        "</div>"
      );
    }

    function lockedHTML() {
      return (
        '<div class="pm-locked">' +
        '<span class="pm-locked__ico">' + NX.icon("lock", "", 22) + "</span>" +
        ("<strong>" + NX.i18n.get("perm.vocenaotempermissaoparagerenciar", "Você não tem permissão para gerenciar permissões.") + "</strong>") +
        ("<p>" + NX.i18n.get("perm.precisadocargo", "Precisa do cargo") + " " + "<b>" + NX.i18n.get("core.gerenciarCanais", "Gerenciar canais") + ("</b>" + " " + NX.i18n.get("perm.paraalteraramatriz", "para alterar a matriz") + " ")) +
        (kind === "channel" ? NX.i18n.get("perm.desteCanal", "deste canal") : NX.i18n.get("perm.destaCategoria", "desta categoria")) +
        ".</p>" +
        "</div>"
      );
    }

    function missingHTML() {
      return (
        '<div class="pm-locked">' +
        '<span class="pm-locked__ico">' + NX.icon("alert", "", 22) + "</span>" +
        "<strong>" + (kind === "channel" ? NX.i18n.get("perm.esteCanalNaoExisteMais", "Este canal não existe mais.") : NX.i18n.get("perm.estaCategoriaNaoExisteMais", "Esta categoria não existe mais.")) + "</strong>" +
        ("<p>" + NX.i18n.get("perm.fechaeabreasconfiguracoesde", "Fecha e abre as configurações de novo para recarregar.") + "</p>") +
        "</div>"
      );
    }

    /* ---------------- render ---------------- */
    function render() {
      if (!alive) return;
      sync();
      let html = "";
      if (!container) html = missingHTML();
      else if (!permitted) html = headHTML() + lockedHTML();
      else html = headHTML() + controlsHTML() + mainHTML();
      root.innerHTML = html;
    }

    function paintRow(key, state) {
      const row = root.querySelector('.pm-row[data-pm-row="' + key + '"]');
      if (!row) return;
      row.classList.toggle("is-set", state !== null);
      Array.prototype.forEach.call(row.querySelectorAll(".pm-seg__btn"), (b) => {
        const val = b.getAttribute("data-pm-val");
        const v = val === "allow" ? true : val === "deny" ? false : null;
        const on = v === state;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", String(on));
      });
    }

    function paintTargetBar() {
      const box = root.querySelector("[data-pm-targetbar]");
      if (box) box.innerHTML = targetBarInner();
    }

    function paintSummary() {
      const box = root.querySelector("[data-pm-summary]");
      if (box) box.innerHTML = summaryHTML();
    }

    function refreshAfterChange(tk) {
      const t = targets.find((x) => x.key === tk) || currentTarget();
      paintTargetBar();
      if (t) {
        const n = overrideKeys(container, t.key).length;
        const pick = root.querySelector('.pm-pick[data-pm-target="' + t.key + '"]');
        if (pick) {
          let badge = pick.querySelector(".pm-pick__n");
          if (n && !badge) {
            badge = u().el('<span class="pm-pick__n"></span>');
            pick.appendChild(badge);
          }
          if (badge) {
            if (n) badge.textContent = String(n);
            else badge.remove();
          }
        }
      }
      paintSummary();
    }

    /* ---------------- ações ---------------- */
    async function onSet(btn) {
      if (!permitted || !container) return;
      const permKey = btn.getAttribute("data-pm-perm");
      const valId = btn.getAttribute("data-pm-val");
      if (!permKey || st.busy[permKey]) return;
      const t = currentTarget();
      if (!t) return;
      const state = valId === "allow" ? true : valId === "deny" ? false : null;
      const before = getPerm(container, t.key, permKey);
      if (before === state) return;
      const tk = t.key;
      st.busy[permKey] = true;
      btn.classList.add("is-busy");
      paintRow(permKey, state); /* estado local imediato, sem fechar o painel */
      paintSummary();
      try {
        if (kind === "channel") await NX.api.setChannelPerm(id, tk, permKey, state);
        else await NX.api.setCategoryPerm(id, tk, permKey, state);
        sync();
        paintRow(permKey, getPerm(container, tk, permKey));
        refreshAfterChange(tk);
      } catch (e) {
        sync();
        paintRow(permKey, getPerm(container, tk, permKey));
        refreshAfterChange(tk);
        NX.ui.error((e && e.message) || NX.i18n.get("perm.naoFoiPossivelAlterarPermissao", "Não foi possível alterar esta permissão."));
      } finally {
        delete st.busy[permKey];
        btn.classList.remove("is-busy");
      }
    }

    async function onRestore() {
      if (!permitted || !container || st.restoreBusy) return;
      const t = currentTarget();
      if (!t) return;
      const keys = overrideKeys(container, t.key);
      if (!keys.length) {
        NX.ui.toast(NX.i18n.get("perm.esteAlvoJaEstaHerdandoTudo", "Este alvo já está herdando tudo."), "info");
        return;
      }
      const what = kind === "channel" ? NX.i18n.get("perm.canal", "do canal") : NX.i18n.get("perm.categoria", "da categoria");
      const ok = await NX.ui.confirm({
        title: NX.i18n.get("perm.restaurarPadrao", "Restaurar padrão"),
        message:
          (NX.i18n.get("perm.os", "Os") + " ") + keys.length + (" " + NX.i18n.get("perm.ajustesde", "ajustes de") + " ") + t.label + " " + what +
          (" " + NX.i18n.get("perm.voltaraoaherdardonivelanterior", "voltarão a herdar do nível anterior. Dá para mudar de ideia depois.")),
        confirmLabel: (NX.i18n.get("perm.restaurar", "Restaurar")),
        icon: "refresh",
      });
      if (!ok) return;
      st.restoreBusy = true;
      try {
        for (let i = 0; i < keys.length; i++) {
          if (kind === "channel") await NX.api.setChannelPerm(id, t.key, keys[i], null);
          else await NX.api.setCategoryPerm(id, t.key, keys[i], null);
        }
        sync();
        render();
        NX.ui.success((NX.i18n.get("adm.permissoesde", "Permissões de") + " ") + t.label + " restauradas.");
      } catch (e) {
        sync();
        render();
        NX.ui.error((e && e.message) || NX.i18n.get("perm.naoFoiPossivelRestaurar", "Não foi possível restaurar."));
      } finally {
        st.restoreBusy = false;
      }
    }

    async function onInherit(input) {
      if (!permitted || !container || kind !== "channel") return;
      const want = !!input.checked;
      input.disabled = true;
      try {
        await NX.api.setChannelInheritance(id, want);
        sync();
        const cat = container.categoryId ? S().category(container.categoryId) : null;
        const wrap = root.querySelector(".pm-inherit");
        if (wrap) {
          const tmp = u().el("<div>" + inheritHTML(cat) + "</div>").firstElementChild;
          wrap.replaceWith(tmp);
        }
        paintSummary();
        NX.ui.toast(
          want ? NX.i18n.get("perm.canalVoltaHerdarCategoria", "O canal volta a herdar da categoria.") : NX.i18n.get("perm.canalAgoraUsaPermiss", "O canal agora usa permissões próprias."),
          "info"
        );
      } catch (e) {
        input.checked = !want;
        NX.ui.error((e && e.message) || NX.i18n.get("perm.naoFoiPossivelAlterarHeranca", "Não foi possível alterar a herança."));
      } finally {
        input.disabled = false;
      }
    }

    function onSearch(input) {
      st.q = input.value || "";
      const list = root.querySelector("[data-pm-list]");
      if (list) list.innerHTML = listHTML();
    }

    function selectTarget(key) {
      if (!key) return;
      st.sel[st.tab] = key;
      st.q = "";
      const search = root.querySelector("[data-pm-search]");
      if (search) search.value = "";
      const list = root.querySelector("[data-pm-list]");
      if (list) list.innerHTML = listHTML();
      Array.prototype.forEach.call(root.querySelectorAll(".pm-pick"), (b) => {
        b.classList.toggle("is-on", b.getAttribute("data-pm-target") === key);
      });
      const main = root.querySelector(".pm-main");
      if (main) main.innerHTML = mainHTML();
    }

    function selectTab(tabId) {
      if (st.tab === tabId) return;
      st.tab = tabId;
      st.q = "";
      const controls = root.querySelector(".pm-tabs");
      if (controls) {
        Array.prototype.forEach.call(controls.querySelectorAll(".pm-tab"), (b) => {
          const on = b.getAttribute("data-pm-tab") === tabId;
          b.classList.toggle("is-on", on);
          b.setAttribute("aria-selected", String(on));
        });
      }
      const picker = root.querySelector(".pm-picker");
      if (picker) {
        const tmp = u().el("<div>" + controlsHTML() + "</div>").firstElementChild;
        picker.replaceWith(tmp);
      }
      const main = root.querySelector(".pm-main");
      if (main) main.innerHTML = mainHTML();
    }

    /* ---------------- eventos ---------------- */
    function bind() {
      root.addEventListener("click", (e) => {
        if (!permitted) return;
        const tab = e.target.closest("[data-pm-tab]");
        if (tab) {
          selectTab(tab.getAttribute("data-pm-tab"));
          return;
        }
        const pick = e.target.closest("[data-pm-target]");
        if (pick) {
          selectTarget(pick.getAttribute("data-pm-target"));
          return;
        }
        const seg = e.target.closest("[data-pm-perm]");
        if (seg) {
          onSet(seg);
          return;
        }
        if (e.target.closest("[data-pm-restore]")) onRestore();
      });

      root.addEventListener("input", (e) => {
        if (!permitted) return;
        if (e.target.matches("[data-pm-search]")) onSearch(e.target);
      });

      root.addEventListener("change", (e) => {
        if (!permitted) return;
        if (e.target.matches("[data-pm-inherit]")) onInherit(e.target);
      });
    }

    sync();
    render();
    if (permitted) bind();

    return {
      root: root,
      kind: kind,
      id: id,
      refresh: render,
      destroy() {
        alive = false;
        root.remove();
      },
    };
  }

  /* ============================================================
     contrato público
     ============================================================ */
  function panelInto(kind, id, el) {
    if (!el) return null;
    return createPanel(kind, id, el);
  }

  function openModal(kind, id) {
    const holder = { panel: null };
    const container = kind === "channel" ? S().channel(id) : S().category(id);
    if (!container) {
      NX.ui.error(kind === "channel" ? NX.i18n.get("perm.canalNaoEncontrado", "Canal não encontrado.") : NX.i18n.get("perm.categoriaNaoEncontrada", "Categoria não encontrada."));
      return null;
    }
    const server = S().server(container.serverId);
    const title = kind === "channel" ? NX.i18n.get("perm.permissoesDoCanal", "Permissões do canal") : NX.i18n.get("perm.permissoesDaCategoria", "Permissões da categoria");
    const label =
      kind === "channel"
        ? (container.type === "voice" ? "" : "#") + container.name
        : container.name;
    const m = NX.ui.modal({
      title: title,
      eyebrow: (server ? server.name : "") + " \u00b7 " + label,
      size: "lg",
      footer: u().el(
        '<div class="modal__actions">' +
          ("<button class=\"btn btn--ghost\" type=\"button\" data-modal-close>" + NX.i18n.get("common.close", "Fechar") + "</button>") +
          ("<button class=\"btn btn--primary\" type=\"button\" data-modal-close>" + NX.i18n.get("perm.concluir", "Concluir") + "</button>") +
          "</div>"
      ),
      onClose: () => {
        if (holder.panel) holder.panel.destroy();
      },
    });
    m.el.classList.add("modal--perm");
    const host = u().el('<div class="pm-host"></div>');
    m.body.appendChild(host);
    holder.panel = createPanel(kind, id, host);
    return m;
  }

  const permUI = {
    channelPanel: (channelId, el) => panelInto("channel", channelId, el),
    categoryPanel: (categoryId, el) => panelInto("category", categoryId, el),
    openChannel: (channelId) => openModal("channel", channelId),
    openCategory: (categoryId) => openModal("category", categoryId),
    targets: (ref) => buildTargets(serverIdOf(ref)),
    states: STATES.map((s) => ({ id: s.id, value: s.value, label: s.label, ico: s.ico })),
  };

  NX.permUI = permUI;
})(window.NX);
