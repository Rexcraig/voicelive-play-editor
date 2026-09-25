// The editor's Cloudflare Worker. Static files (the editor itself) are served from ./public as before; this script
// only answers /vlp/api/community/*, the shared preset library, backed by the D1 database bound as DB.
//
// Who is asking: everyone reaching the site has signed in through Cloudflare Access, which puts a signed token in
// the Cf-Access-Jwt-Assertion header. We verify that token ourselves (never just trust an email header), and use
// its email as the person's identity. Emails are never sent to other users; posts show a display name.
import spec from "../src/spec.json";
import tcHashes from "./tc-hashes.json";

const API = "/vlp/api/community/";
const LIST_LIMIT = 500;
const SHARES_PER_DAY = 20;
const DESCRIPTION_MAX = 300;
const TC_PRESETS = new Set(tcHashes);
const NAME_CHARS = new Set(spec.name_chars);
const PARAMS = new Map(spec.params.map((p) => [p.slot, p]));
const PARAM_COUNT = 50;
const INT28 = 1 << 27;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(API)) return env.ASSETS.fetch(request);
    if (!env.DB) return json({ ok: false, enabled: false, message: "Community isn't switched on yet." }, 503);
    try {
      if (request.method === "POST" && !sameOriginJson(request, url)) {
        return json({ ok: false, message: "Refused: requests must come from the editor itself." }, 403);
      }
      const email = await identify(request, env, url);
      if (!email) return json({ ok: false, message: "Sign in again: your session has expired." }, 401);
      const route = url.pathname.slice(API.length);
      let body = request.method === "POST" ? await request.json().catch(() => null) : null;
      if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
      const handler = ROUTES[`${request.method} ${route}`];
      if (!handler) return json({ ok: false, message: "Not found." }, 404);
      return json(await handler({ env, email, admin: isAdmin(env, email), body, url }));
    } catch (e) {
      console.error(e);
      return json({ ok: false, message: "Community is having trouble right now. Try again in a minute." }, 500);
    }
  },
};

const ROUTES = {
  "GET status": async ({ admin }) => ({ ok: true, enabled: true, admin }),
  "GET list": list,
  "POST share": share,
  "POST delete": remove,
  "POST report": report,
  "POST hide": hide,
  "POST ban": ban,
};

// --- routes --------------------------------------------------------------------------------------------------

async function list({ env, email, admin }) {
  const rows = await env.DB.prepare(
    `SELECT p.id, p.name, p.tags, p.params, p.description, p.author_name, p.author_email, p.created_at, p.hidden,
            (SELECT COUNT(*) FROM reports r WHERE r.preset_id = p.id) AS reports
       FROM presets p ${admin ? "" : "WHERE p.hidden = 0 OR p.author_email = ?1"}
      ORDER BY p.created_at DESC LIMIT ${LIST_LIMIT}`,
  ).bind(...(admin ? [] : [email])).all();
  const mine = await env.DB.prepare("SELECT author_name FROM presets WHERE author_email = ? ORDER BY created_at DESC LIMIT 1")
    .bind(email).first();
  return {
    ok: true,
    me: { admin, name: mine?.author_name || "" },
    presets: rows.results.map((r) => ({
      id: r.id, name: r.name, tags: r.tags, params: JSON.parse(r.params), description: r.description,
      author: r.author_name, created: r.created_at, mine: r.author_email === email, hidden: !!r.hidden,
      ...(admin ? { reports: r.reports } : {}),
    })),
  };
}

async function share({ env, email, body }) {
  const name = pedalName(body.name);
  const author = clean(body.author, 30);
  const description = clean(body.description, DESCRIPTION_MAX);
  const tags = Math.trunc(Number(body.tags)) & ((1 << spec.genres.length) - 1);
  const params = body.params;
  if (!name) return fail("Give the preset a name first.");
  if (author.length < 2) return fail("Add the name to show with your preset (at least 2 characters).");
  if (!body.rights) return fail("Tick the box to confirm you made this preset or have the right to share it.");
  const banned = await env.DB.prepare("SELECT 1 FROM banned WHERE email = ?").bind(email).first();
  if (banned) return fail("Sharing has been turned off for your account. If you think that's a mistake, contact us.");
  const problem = checkParams(params);
  if (problem) return fail(problem);

  const fingerprint = await sha256(params.join(","));
  if (TC_PRESETS.has(fingerprint)) {
    return fail("This is one of TC-Helicon's own presets, so it can't be shared here: it already comes in their preset packs. Change it to make it your own, then share that.");
  }
  const dup = await env.DB.prepare("SELECT name, hidden FROM presets WHERE fingerprint = ? LIMIT 1").bind(fingerprint).first();
  if (dup?.hidden) return fail("This preset was removed from Community by a moderator, so it can't be shared again.");
  if (dup) return fail(`Exactly this preset is already in Community, as ${dup.name}.`);
  // Counted from a log that deleting presets doesn't touch, so delete-and-reshare can't get round the limit.
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM share_log WHERE email = ? AND created_at > ?")
    .bind(email, Date.now() - 24 * 3600e3).first();
  if (today.n >= SHARES_PER_DAY) return fail(`You've shared ${SHARES_PER_DAY} presets today. Try again tomorrow.`);

  const id = randomId();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO presets (id, name, tags, params, fingerprint, description, author_name, author_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, name, tags, JSON.stringify(params), fingerprint, description, author, email, now),
    env.DB.prepare("INSERT INTO share_log (email, created_at) VALUES (?, ?)").bind(email, now),
    env.DB.prepare("DELETE FROM share_log WHERE created_at < ?").bind(now - 2 * 24 * 3600e3),  // only needed for a day
  ]);
  return { ok: true, id, message: `Shared ${name} with the community.` };
}

async function remove({ env, email, admin, body }) {
  const row = await env.DB.prepare("SELECT author_email, name FROM presets WHERE id = ?").bind(String(body.id)).first();
  if (!row) return fail("That preset isn't in Community any more.");
  if (row.author_email !== email && !admin) return fail("You can only delete presets you shared.");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM presets WHERE id = ?").bind(String(body.id)),
    env.DB.prepare("DELETE FROM reports WHERE preset_id = ?").bind(String(body.id)),
  ]);
  return { ok: true, message: `Deleted ${row.name} from Community.` };
}

async function report({ env, email, body }) {
  const row = await env.DB.prepare("SELECT name FROM presets WHERE id = ?").bind(String(body.id)).first();
  if (!row) return fail("That preset isn't in Community any more.");
  await env.DB.prepare("INSERT OR IGNORE INTO reports (preset_id, reporter_email, reason, created_at) VALUES (?, ?, ?, ?)")
    .bind(String(body.id), email, clean(body.reason, 300), Date.now()).run();
  return { ok: true, message: `Thanks. ${row.name} has been reported and will be reviewed.` };
}

async function hide({ env, admin, body }) {
  if (!admin) return fail("Only moderators can hide presets.");
  const hidden = body.hidden ? 1 : 0;
  await env.DB.prepare("UPDATE presets SET hidden = ? WHERE id = ?").bind(hidden, String(body.id)).run();
  return { ok: true, message: hidden ? "Hidden from Community." : "Visible in Community again." };
}

// Stop the author of a preset from sharing again, and hide everything they shared. Moderators only.
async function ban({ env, admin, email, body }) {
  if (!admin) return fail("Only moderators can stop someone sharing.");
  const row = await env.DB.prepare("SELECT author_email, author_name FROM presets WHERE id = ?").bind(String(body.id)).first();
  if (!row) return fail("That preset isn't in Community any more.");
  if (row.author_email === email) return fail("That's your own preset.");
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO banned (email, created_at) VALUES (?, ?)").bind(row.author_email, Date.now()),
    env.DB.prepare("UPDATE presets SET hidden = 1 WHERE author_email = ?").bind(row.author_email),
  ]);
  return { ok: true, message: `${row.author_name} can no longer share, and their presets are hidden.` };
}

// --- validation ----------------------------------------------------------------------------------------------

// The same rule as tch.pedal_name: what the pedal will actually store.
function pedalName(raw) {
  return [...String(raw || "").toUpperCase().slice(0, spec.name_length)]
    .map((c) => (NAME_CHARS.has(c) ? c : " ")).join("").trimEnd();
}

function clean(raw, max) {
  return String(raw || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// Every value must be a whole number the pedal can hold; values the editor knows must also be in range.
function checkParams(params) {
  if (!Array.isArray(params) || params.length !== PARAM_COUNT) return "That preset is incomplete.";
  for (let i = 0; i < PARAM_COUNT; i++) {
    const v = params[i];
    if (!Number.isInteger(v) || v < -INT28 || v >= INT28) return "That preset has a value the pedal can't store.";
    const p = PARAMS.get(i);
    if (!p) continue;
    const max = p.kind === "state" ? 2 : p.options ? p.options.length - 1 : p.max;
    const min = p.kind === "state" || p.options ? 0 : p.min;
    if ((min != null && v < min) || (max != null && v > max)) return `${p.label} is out of range in that preset.`;
  }
  return null;
}

// --- identity ------------------------------------------------------------------------------------------------

async function identify(request, env, url) {
  // `wrangler dev` only: honoured on this machine's own address and nowhere else, whatever the config says.
  if (env.DEV_EMAIL && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return env.DEV_EMAIL;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  const claims = await verifyAccessJwt(token, env).catch(() => null);  // a malformed token is a sign-in problem, not a 500
  return claims?.email ? String(claims.email).toLowerCase() : null;
}

// A browser POST from the editor's own page: JSON, and marked same-origin by the browser. A form or script on another
// site can't produce both, so a signed-in person's cookie can't be used against them from elsewhere.
function sameOriginJson(request, url) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) return false;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site) return site === "same-origin";
  return request.headers.get("Origin") === url.origin;  // older browsers without Sec-Fetch-Site
}

const isAdmin = (env, email) => String(env.ADMINS || "").toLowerCase().split(",").map((s) => s.trim()).includes(email);

let certs = { keys: null, at: 0 };

async function loadCerts(env) {
  const res = await fetch(`https://${env.ACCESS_TEAM}/cdn-cgi/access/certs`);
  certs = { keys: (await res.json()).keys || [], at: Date.now() };
}

async function verifyAccessJwt(token, env) {
  const [h, p, s] = token.split(".");
  if (!s) return null;
  const header = JSON.parse(b64text(h));
  const claims = JSON.parse(b64text(p));
  if (header.alg !== "RS256") return null;
  if (!certs.keys || Date.now() - certs.at > 3600e3) await loadCerts(env);
  let jwk = certs.keys.find((k) => k.kid === header.kid);
  // Cloudflare rotates its signing keys: an unknown key id means fetch the current ones (at most once a minute).
  if (!jwk && Date.now() - certs.at > 60e3) {
    await loadCerts(env);
    jwk = certs.keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64bytes(s), new TextEncoder().encode(`${h}.${p}`));
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Date.now() / 1000;
  if (!ok || !aud.includes(env.ACCESS_AUD) || claims.iss !== `https://${env.ACCESS_TEAM}`) return null;
  if (typeof claims.exp !== "number" || claims.exp < now) return null;
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) return null;
  return claims;
}

// --- helpers -------------------------------------------------------------------------------------------------

function b64bytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const b64text = (s) => new TextDecoder().decode(b64bytes(s));

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
}

const fail = (message) => ({ ok: false, message });

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
