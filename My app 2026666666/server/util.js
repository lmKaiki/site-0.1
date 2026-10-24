"use strict";
/* ============================================================
   NEXO · server/util
   Utilitários do backend espelhando js/core.js (util.uid,
   normalizeUsername, emojiFor, colorFor…) para que o que a
   interface mostra e o que o banco grava sejam a mesma coisa.
   ============================================================ */

const crypto = require("crypto");

const PALETTE = [
  "#35e0a8", "#4cc9f0", "#8f83ff", "#ff7ab6", "#ffc857",
  "#ff6b7a", "#5ad1a3", "#a0e548", "#f0956b", "#7c9cff",
];

const EMOJI_POOL = [
  "🌙", "⚡", "🎧", "🔥", "🌊", "🌱", "🎲", "🚀", "🐙", "🎯",
  "🧩", "🪐", "🌵", "🦉", "🎸", "🧭", "🤖", "💎", "🌈", "🧠",
];

/* mesmo formato do NX.util.uid: prefixo_base36 */
function uid(prefix) {
  return (
    (prefix || "id") +
    "_" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

function normalizeUsername(v) {
  return String(v || "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeIdentifier(v) {
  return normalizeUsername(String(v || "").replace(/^@/, ""));
}

function usernameOk(v) {
  return /^[a-z0-9._]{3,18}$/i.test(String(v || "").trim());
}

function emojiFor(name) {
  const s = String(name || "");
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
  return EMOJI_POOL[sum % EMOJI_POOL.length];
}

function colorFor(key) {
  const s = String(key || "");
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum = (sum * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[sum % PALETTE.length];
}

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/* código de convite: alfabeto sem 0/O/1/I (dado técnico, nunca traduzir) */
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function inviteCode() {
  let out = "";
  const bytes = crypto.randomBytes(5);
  for (let i = 0; i < 5; i++) out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return out;
}

function now() {
  return Date.now();
}

module.exports = {
  uid,
  normalizeUsername,
  normalizeIdentifier,
  usernameOk,
  emojiFor,
  colorFor,
  slug,
  inviteCode,
  now,
  PALETTE,
};
