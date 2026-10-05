/* ============================================================
   NEXO · primitivas de UI
   Modais, confirmações, menus suspensos, popouts e toasts.
   ============================================================ */

window.NX = window.NX || {};

(function (NX) {
  "use strict";

  const u = () => NX.util;
  const modalStack = [];
  let menuEl = null;
  let popoutEl = null;

  function onOutside(ev, fn) {
    const handler = (e) => {
      if (!ev.target.contains(e.target)) {
        fn();
        document.removeEventListener("mousedown", handler, true);
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }

  function place(el, anchor, opts) {
    opts = opts || {};
    const gap = opts.gap === undefined ? 8 : opts.gap;
    const r = anchor.getBoundingClientRect();
    el.style.visibility = "hidden";
    el.style.left = "0px";
    el.style.top = "0px";
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left;
    if (opts.align === "end") left = r.right - w;
    else if (opts.align === "center") left = r.left + r.width / 2 - w / 2;
    else left = r.left;
    left = Math.max(8, Math.min(left, vw - w - 8));

    let top;
    if (opts.side === "top") top = r.top - h - gap;
    else top = r.bottom + gap;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - gap);
    if (top < 8) top = 8;

    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(top) + "px";
    el.style.visibility = "";
  }

  const ui = {};

  /* ---------------- toast ---------------- */
  ui.toast = function (message, type, ms) {
    const root = document.getElementById("toast-root");
    if (!root) return;
    const kind = type || "info";
    const icons = { info: "info", success: "check", error: "alert", warn: "alert" };
    const el = u().el(
      '<div class="toast toast--' + kind + '" role="alert">' +
        NX.icon(icons[kind] || "info", "toast__ico", 18) +
        '<span class="toast__msg">' + u().h(message) + "</span>" +
        "</div>"
    );
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add("is-in"));
    setTimeout(() => {
      el.classList.remove("is-in");
      el.classList.add("is-out");
      setTimeout(() => el.remove(), 260);
    }, ms || 3400);
  };

  ui.error = (msg) => ui.toast(msg, "error", 4200);
  ui.success = (msg) => ui.toast(msg, "success");

  /* ---------------- botão ocupado ---------------- */
  ui.busy = function (btn) {
    if (!btn) return () => {};
    const html = btn.innerHTML;
    const disabled = btn.disabled;
    btn.disabled = true;
    btn.classList.add("is-loading");
    btn.innerHTML =
      '<span class="spinner"></span>' + (btn.dataset.busyLabel ? " " + u().h(btn.dataset.busyLabel) : "");
    return () => {
      btn.disabled = disabled;
      btn.classList.remove("is-loading");
      btn.innerHTML = html;
    };
  };

  /* ---------------- modal ---------------- */
  ui.modal = function (opts) {
    opts = opts || {};
    const size = opts.size || "md";
    const body = u().el('<div class="modal__body"></div>');
    const backdrop = u().el(
      '<div class="modal-backdrop" data-modal>' +
        '<div class="modal modal--' + size + '" role="dialog" aria-modal="true" aria-label="' +
        u().h(opts.title || "Diálogo") + '">' +
        '<header class="modal__head">' +
        '<div class="modal__title-wrap">' +
        (opts.eyebrow ? '<span class="modal__eyebrow">' + u().h(opts.eyebrow) + "</span>" : "") +
        '<h2 class="modal__title">' + u().h(opts.title || "") + "</h2>" +
        "</div>" +
        '<button class="icon-btn" data-modal-close aria-label="Fechar">' + NX.icon("x", "", 18) + "</button>" +
        "</header>" +
        "</div>" +
        "</div>"
    );
    const modal = backdrop.firstElementChild;
    modal.appendChild(body);
    if (opts.footer) {
      const foot = u().el('<footer class="modal__foot"></footer>');
      foot.appendChild(opts.footer);
      modal.appendChild(foot);
    }

    document.getElementById("modal-root").appendChild(backdrop);
    document.body.classList.add("has-modal");

    const close = (result) => {
      const i = modalStack.indexOf(api);
      if (i === -1) return;
      modalStack.splice(i, 1);
      if (!modalStack.length) document.body.classList.remove("has-modal");
      backdrop.classList.add("is-out");
      setTimeout(() => backdrop.remove(), 180);
      document.removeEventListener("keydown", onKey, true);
      if (opts.onClose) opts.onClose(result);
    };

    function onKey(e) {
      if (modalStack[modalStack.length - 1] !== api) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }

    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop && opts.dismissible !== false) close();
    });
    modal.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-modal-close]");
      if (btn) {
        e.preventDefault();
        close();
      }
    });
    document.addEventListener("keydown", onKey, true);

    requestAnimationFrame(() => backdrop.classList.add("is-in"));

    const api = { el: modal, body: body, close: close };
    modalStack.push(api);

    setTimeout(() => {
      const target = body.querySelector("[data-autofocus]") || body.querySelector("input, textarea, button");
      if (target) target.focus();
    }, 60);

    return api;
  };

  /* ---------------- confirmação ---------------- */
  ui.confirm = function (opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let done = false;
      const footer = u().el('<div class="modal__actions"></div>');
      const cancelBtn = u().el(
        '<button class="btn btn--ghost" type="button">' + u().h(opts.cancelLabel || "Cancelar") + "</button>"
      );
      const okBtn = u().el(
        '<button class="btn ' + (opts.danger ? "btn--danger" : "btn--primary") + '" type="button">' +
          u().h(opts.confirmLabel || "Confirmar") +
          "</button>"
      );
      footer.appendChild(cancelBtn);
      footer.appendChild(okBtn);

      const m = ui.modal({
        title: opts.title || "Tem certeza?",
        size: "sm",
        footer: footer,
        onClose: () => {
          if (!done) resolve(false);
        },
      });

      m.body.innerHTML =
        (opts.icon ? '<div class="confirm__icon ' + (opts.danger ? "is-danger" : "") + '">' + NX.icon(opts.icon, "", 24) + "</div>" : "") +
        '<p class="confirm__text">' + u().h(opts.message || "") + "</p>" +
        (opts.note ? '<p class="confirm__note">' + u().h(opts.note) + "</p>" : "");

      cancelBtn.addEventListener("click", () => {
        done = true;
        resolve(false);
        m.close();
      });
      okBtn.addEventListener("click", () => {
        done = true;
        resolve(true);
        m.close();
      });
      okBtn.focus();
    });
  };

  /* ---------------- menu suspenso ---------------- */
  ui.closeMenu = function () {
    if (menuEl) {
      menuEl.classList.remove("is-in");
      const el = menuEl;
      menuEl = null;
      setTimeout(() => el.remove(), 140);
    }
  };

  ui.menu = function (anchor, items, opts) {
    opts = opts || {};
    ui.closeMenu();
    ui.closePopout();
    const list = u().el(
      '<div class="menu" role="menu">' +
        items
          .map((it) => {
            if (it.divider) return '<div class="menu__divider" role="separator"></div>';
            if (it.heading)
              return '<div class="menu__heading">' + u().h(it.heading) + "</div>";
            const cls = ["menu__item"];
            if (it.danger) cls.push("is-danger");
            if (it.disabled) cls.push("is-disabled");
            return (
              '<button type="button" class="' + cls.join(" ") + '" role="menuitem"' +
              (it.disabled ? " disabled" : "") +
              ">" +
              (it.icon ? NX.icon(it.icon, "menu__ico", 17) : '<span class="menu__ico"></span>') +
              '<span class="menu__label">' + u().h(it.label) + "</span>" +
              (it.check ? '<span class="menu__check">' + NX.icon("check", "", 15) + "</span>" : "") +
              (it.hint ? '<span class="menu__hint">' + u().h(it.hint) + "</span>" : "") +
              "</button>"
            );
          })
          .join("") +
        "</div>"
    );
    document.getElementById("popout-root").appendChild(list);
    menuEl = list;
    place(list, anchor, opts);

    requestAnimationFrame(() => list.classList.add("is-in"));

    list.addEventListener("click", (e) => {
      const btn = e.target.closest(".menu__item");
      if (!btn || btn.disabled) return;
      const idx = Array.prototype.indexOf.call(list.querySelectorAll(".menu__item"), btn);
      const real = items.filter((x) => !x.divider && !x.heading)[idx];
      ui.closeMenu();
      if (real && real.onClick) real.onClick(e);
    });

    const off = onOutside({ target: list }, () => ui.closeMenu());
    const onKey = (e) => {
      if (e.key === "Escape") {
        ui.closeMenu();
        document.removeEventListener("keydown", onKey, true);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return list;
  };

  /* ---------------- popout / cartão ---------------- */
  ui.closePopout = function () {
    if (popoutEl) {
      const el = popoutEl;
      popoutEl = null;
      el.classList.remove("is-in");
      setTimeout(() => el.remove(), 140);
    }
  };

  ui.popout = function (anchor, html, opts) {
    opts = opts || {};
    ui.closeMenu();
    ui.closePopout();
    const el = u().el('<div class="popout' + (opts.cls ? " " + opts.cls : "") + '">' + html + "</div>");
    document.getElementById("popout-root").appendChild(el);
    popoutEl = el;
    place(el, anchor, opts);
    requestAnimationFrame(() => el.classList.add("is-in"));
    onOutside({ target: el }, () => ui.closePopout());
    const onKey = (e) => {
      if (e.key === "Escape") {
        ui.closePopout();
        document.removeEventListener("keydown", onKey, true);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return el;
  };

  ui.isOpen = () => modalStack.length > 0 || !!menuEl || !!popoutEl;
  ui.closeEverything = function () {
    ui.closeMenu();
    ui.closePopout();
  };

  NX.ui = ui;
})(window.NX);
