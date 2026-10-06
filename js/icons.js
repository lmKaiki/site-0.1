/* ============================================================
   NEXO · ícones
   Conjunto SVG próprio (traço 1.8, cantos arredondados).
   NX.icon(nome, classe, tamanho) -> string SVG
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const P = {
    /* navegação */
    home:
      '<path d="M3.2 11.4 12 4l8.8 7.4"/><path d="M5.6 10v9.4a1 1 0 0 0 1 1h10.8a1 1 0 0 0 1-1V10"/><path d="M9.8 20.4v-5.2h4.4v5.2"/>',
    chat:
      '<path d="M4 6.6A2.6 2.6 0 0 1 6.6 4h10.8A2.6 2.6 0 0 1 20 6.6v7.2a2.6 2.6 0 0 1-2.6 2.6H9.4L5 20.2v-3.8a2.6 2.6 0 0 1-1-2.6z"/>',
    compass:
      '<circle cx="12" cy="12" r="8.6"/><path d="m15.2 8.8-2 5.4-5.4 2 2-5.4z"/>',

    /* ações */
    plus: '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
    x: '<path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6"/>',
    check: '<path d="m5 12.6 4.6 4.6L19.2 7"/>',
    dash: '<path d="M7.6 12h8.8"/>',
    circle: '<circle cx="12" cy="12" r="7.6"/>',
    chevronDown: '<path d="m6.5 9.4 5.5 5.6 5.5-5.6"/>',
    chevronRight: '<path d="m9.4 6.4 5.6 5.6-5.6 5.6"/>',
    chevronLeft: '<path d="m14.6 6.4-5.6 5.6 5.6 5.6"/>',
    arrowLeft: '<path d="M19.4 12H4.6"/><path d="m10.6 5.8-6 6.2 6 6.2"/>',
    arrowRight: '<path d="M4.6 12h14.8"/><path d="m13.4 5.8 6 6.2-6 6.2"/>',
    send: '<path d="M21.2 3.4 3.2 10.1l7 3.1 3.1 7z"/><path d="m10.2 13.2 5.4-5.4"/>',
    search: '<circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.4"/><path d="M15.4 6.4V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.4a2 2 0 0 0 2 2h.4"/>',
    link: '<path d="M10.2 13.4a4.4 4.4 0 0 0 6.6.4l2.6-2.6a4.4 4.4 0 0 0-6.2-6.2l-1.5 1.5"/><path d="M13.8 10.6a4.4 4.4 0 0 0-6.6-.4l-2.6 2.6a4.4 4.4 0 0 0 6.2 6.2l1.5-1.5"/>',
    share: '<circle cx="18" cy="5.6" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="18.4" r="2.6"/><path d="m8.3 10.8 7.4-3.9M8.3 13.2l7.4 3.9"/>',
    trash: '<path d="M4.4 6.8h15.2"/><path d="M9.4 6.8V5.4a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.4"/><path d="m6.6 6.8.9 12.1a2 2 0 0 0 2 1.9h5a2 2 0 0 0 2-1.9l.9-12.1"/>',
    pencil: '<path d="M4.4 19.6h4L19 9a2.2 2.2 0 0 0-3.1-3.1L5.3 16.5z"/><path d="m14.6 7.2 2.9 2.9"/>',
    settings:
      '<circle cx="12" cy="12" r="3.1"/><path d="M19.1 14.4a1.5 1.5 0 0 0 .3 1.7l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.5 1.5 0 0 0-1.7-.3 1.5 1.5 0 0 0-.9 1.4v.2a1.9 1.9 0 1 1-3.8 0v-.1a1.5 1.5 0 0 0-1-1.4 1.5 1.5 0 0 0-1.7.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.5 1.5 0 0 0 .3-1.7 1.5 1.5 0 0 0-1.4-.9h-.2a1.9 1.9 0 1 1 0-3.8h.1a1.5 1.5 0 0 0 1.4-1 1.5 1.5 0 0 0-.3-1.7l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4v-.2a1.9 1.9 0 1 1 3.8 0v.1a1.5 1.5 0 0 0 .9 1.4 1.5 1.5 0 0 0 1.7-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.5 1.5 0 0 0-.3 1.7v.1a1.5 1.5 0 0 0 1.4.9h.2a1.9 1.9 0 1 1 0 3.8h-.1a1.5 1.5 0 0 0-1.4.9z"/>',
    logout: '<path d="M14.6 4.4h3.8a1.6 1.6 0 0 1 1.6 1.6v12a1.6 1.6 0 0 1-1.6 1.6h-3.8"/><path d="m9.4 8.2-3.8 3.8 3.8 3.8"/><path d="M5.6 12h9.2"/>',
    enter: '<path d="M9.4 4.4H5.6A1.6 1.6 0 0 0 4 6v12a1.6 1.6 0 0 0 1.6 1.6h3.8"/><path d="M14.4 8.2 18.2 12l-3.8 3.8"/><path d="M18.4 12H9.2"/>',
    power: '<path d="M12 3.8v8.4"/><path d="M7.4 6.6a7.4 7.4 0 1 0 9.2 0"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20.4 4.6v4.6h-4.6"/>',
    more: '<circle cx="5.6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.4" cy="12" r="1.5" fill="currentColor" stroke="none"/>',

    /* pessoas */
    users:
      '<circle cx="9.4" cy="8.4" r="3.6"/><path d="M3.4 19.6a6 6 0 0 1 12 0"/><path d="M16.2 5.2a3.4 3.4 0 0 1 0 6.5"/><path d="M17.6 14.4a5.6 5.6 0 0 1 3 5.2"/>',
    user:
      '<circle cx="12" cy="8.2" r="3.8"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
    userPlus:
      '<circle cx="10" cy="8.2" r="3.6"/><path d="M3.6 19.8a6.6 6.6 0 0 1 12.8 0"/><path d="M18.4 7.6v5.2M15.8 10.2h5.2"/>',
    shield: '<path d="M12 3.4 19 6.2v5.4c0 4.2-2.9 7.4-7 9.2-4.1-1.8-7-5-7-9.2V6.2z"/>',
    star: '<path d="m12 4.2 2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-4 5.6-.8z"/>',
    heart:
      '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/>',
    heartFill:
      '<path fill="currentColor" stroke="none" d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/>',
    comment: '<path d="M20.5 11.6a8.4 8.4 0 0 1-9.1 8.4 9.6 9.6 0 0 1-3.3-.6L3.5 21l1.7-4.4a8.2 8.2 0 0 1-1.1-4.1A8.4 8.4 0 0 1 12.5 4a8.4 8.4 0 0 1 8 7.6Z"/>',
    reply: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4.5"/>',
    video:
      '<rect x="2.6" y="6" width="13.2" height="12" rx="2.6"/><path d="m15.8 11 5.6-3.2v8.4L15.8 13"/>',
    atSign: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a2.6 2.6 0 0 0 5.2 0V12A9.2 9.2 0 1 0 18 19.3"/>',
    crown:
      '<path d="M4.4 8.4 8 12l4-6 4 6 3.6-3.6 -1.4 9.4H5.8z"/><path d="M6.2 20.4h11.6"/>',

    /* canais */
    hash:
      '<path d="M9.6 4 7.4 20M16.6 4l-2.2 16M4.4 9.2h15.2M3.9 14.8h15.2"/>',
    voice:
      '<path d="M11.2 5.6 6.8 9.4H4.2a1.2 1.2 0 0 0-1.2 1.2v2.8a1.2 1.2 0 0 0 1.2 1.2h2.6l4.4 3.8z"/><path d="M15.2 9.6a3.6 3.6 0 0 1 0 4.8"/><path d="M17.9 7.2a7.2 7.2 0 0 1 0 9.6"/>',
    folder:
      '<path d="M3.4 7.4a2.4 2.4 0 0 1 2.4-2.4h3.1a2 2 0 0 1 1.5.7l1 1.3h7.2a2.4 2.4 0 0 1 2.4 2.4v7.2a2.4 2.4 0 0 1-2.4 2.4H5.8a2.4 2.4 0 0 1-2.4-2.4z"/>',
    folderPlus:
      '<path d="M3.4 7.4a2.4 2.4 0 0 1 2.4-2.4h3.1a2 2 0 0 1 1.5.7l1 1.3h7.2a2.4 2.4 0 0 1 2.4 2.4v7.2a2.4 2.4 0 0 1-2.4 2.4H5.8a2.4 2.4 0 0 1-2.4-2.4z"/><path d="M12 11.4v4.6M9.7 13.7h4.6"/>',
    grid:
      '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',

    /* status / objetos */
    bell:
      '<path d="M18 9.4a6 6 0 1 0-12 0c0 5.2-2.2 6.6-2.2 6.6h16.4S18 14.6 18 9.4"/><path d="M13.8 19.4a2.1 2.1 0 0 1-3.6 0"/>',
    mic:
      '<rect x="9.2" y="3.4" width="5.6" height="10.4" rx="2.8"/><path d="M5.6 11.6a6.4 6.4 0 0 0 12.8 0"/><path d="M12 18v2.6"/>',
    headset:
      '<path d="M4.4 14.4v-2.2a7.6 7.6 0 0 1 15.2 0v2.2"/><path d="M4.4 13.6h2.2a1.4 1.4 0 0 1 1.4 1.4v3a1.4 1.4 0 0 1-1.4 1.4H5.8A1.4 1.4 0 0 1 4.4 18z"/><path d="M19.6 13.6h-2.2a1.4 1.4 0 0 0-1.4 1.4v3a1.4 1.4 0 0 0 1.4 1.4h.8a1.4 1.4 0 0 0 1.4-1.4z"/>',
    smile:
      '<circle cx="12" cy="12" r="8.6"/><path d="M8.6 14.2a4.2 4.2 0 0 0 6.8 0"/><path d="M9.4 9.6h.01M14.6 9.6h.01" stroke-width="2.4"/>',
    image:
      '<rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2.6"/><circle cx="9" cy="9.6" r="1.6"/><path d="m4.4 17 4.6-4.6 4.4 4.4 2.6-2.6 3.6 3.6"/>',
    mail: '<rect x="3.4" y="5.4" width="17.2" height="13.2" rx="2.6"/><path d="m4.4 7.6 7.6 5.4 7.6-5.4"/>',
    lock:
      '<rect x="4.6" y="10.4" width="14.8" height="9.4" rx="2.4"/><path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6"/>',
    eye: '<path d="M2.6 12S6 6.4 12 6.4 21.4 12 21.4 12 18 17.6 12 17.6 2.6 12 2.6 12"/><circle cx="12" cy="12" r="2.8"/>',
    eyeOff:
      '<path d="M6.2 6.6C4 8.2 2.6 12 2.6 12s3.4 5.6 9.4 5.6a9.6 9.6 0 0 0 4.4-1.1"/><path d="M9.8 7a9.9 9.9 0 0 1 2.2-.3c6 0 9.4 5.3 9.4 5.3s-1 1.7-2.8 3.1"/><path d="m4 4 16 16"/>',
    info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11.2v5"/><path d="M12 7.8h.01" stroke-width="2.4"/>',
    alert:
      '<path d="M10.6 4.6 2.9 18.2A1.6 1.6 0 0 0 4.3 20.6h15.4a1.6 1.6 0 0 0 1.4-2.4L13.4 4.6a1.6 1.6 0 0 0-2.8 0"/><path d="M12 9.6v4"/><path d="M12 16.6h.01" stroke-width="2.4"/>',
    calendar:
      '<rect x="3.6" y="5.4" width="16.8" height="15" rx="2.6"/><path d="M3.6 10h16.8M8.4 3.6v3.4M15.6 3.6v3.4"/>',
    palette:
      '<path d="M12 3.4a8.6 8.6 0 0 0 0 17.2 1.9 1.9 0 0 0 1.5-3.1 1.9 1.9 0 0 1 1.5-3.1h2.2a3.9 3.9 0 0 0 3.9-3.9c0-4-3.9-7.1-9.1-7.1"/><circle cx="7.8" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="9.6" cy="8.2" r="1.1" fill="currentColor" stroke="none"/><circle cx="14" cy="7.6" r="1.1" fill="currentColor" stroke="none"/>',
    sparkles:
      '<path d="m11 3.6 1.7 4.4 4.4 1.7-4.4 1.7L11 15.8l-1.7-4.4L4.9 9.7l4.4-1.7z"/><path d="m18.4 14.6.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    edit: '<path d="M4.4 19.6h4L19 9a2.2 2.2 0 0 0-3.1-3.1L5.3 16.5z"/><path d="m14.6 7.2 2.9 2.9"/>',
    clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3 1.8"/>',
    bolt: '<path d="M13.4 3.4 5.8 13.6h5.2l-.4 7 7.6-10.2h-5.2z"/>',
    sparkle: '<path d="M12 4.2 13.7 9l4.8 1.7-4.8 1.7L12 17.2l-1.7-4.8L5.5 10.7 10.3 9z"/>',
    construction: '<path d="M4 20h16"/><path d="M6.4 20V9.6l5.6-4.2 5.6 4.2V20"/><path d="M10.4 20v-4.6h3.2V20"/>',
    send2: '<path d="M21.2 3.4 3.2 10.1l7 3.1 3.1 7z"/><path d="m10.2 13.2 5.4-5.4"/>',
  };

  const ALIAS = {
    cog: "settings",
    people: "users",
    hash2: "hash",
    close: "x",
    add: "plus",
    leave: "logout",
    msg: "chat",
  };

  NX.icon = (name, cls, size) => {
    const key = ALIAS[name] || name;
    const body = P[key];
    const s = size || 20;
    const klass = "ico" + (cls ? " " + cls : "");
    if (!body) {
      return (
        '<svg class="' + klass + '" width="' + s + '" height="' + s +
        '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>'
      );
    }
    return (
      '<svg class="' + klass + '" width="' + s + '" height="' + s +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body +
      "</svg>"
    );
  };

  /* Marca do Nexo (monograma N em squircle) */
  NX.brandMark = (size) => {
    const s = size || 34;
    return (
      '<span class="brand-mark" style="--bs:' + s + 'px" aria-hidden="true">' +
      '<svg viewBox="0 0 64 64" width="' + s + '" height="' + s + '">' +
      '<rect width="64" height="64" rx="19" fill="url(#nxg)"/>' +
      '<path d="M18 45V19l28 26V19" stroke="#06231a" stroke-width="6.5" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>' +
      '<defs><linearGradient id="nxg" x1="0" y1="0" x2="64" y2="64">' +
      '<stop offset="0" stop-color="#35e0a8"/><stop offset=".55" stop-color="#4cc9f0"/><stop offset="1" stop-color="#8f83ff"/>' +
      "</linearGradient></defs></svg></span>"
    );
  };
})(window.NX);
