import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const SECRET = process.env.SECRET || "";
const ADMIN = process.env.ADMIN_PASSWORD || "";
const store = () => getStore({ name: "chemlab", consistency: "strong" });
const get = async (k, d) => (await store().get(k, { type: "json" })) ?? d;
const put = (k, v) => store().setJSON(k, v);
const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const err = (m, s = 400) => j({ error: m }, s);
const str = (x, n = 300) => String(x ?? "").slice(0, n);
const DAY = 864e5;

const DEF = {
  price: 30, wallet: "01XXXXXXXXX",
  stages: [{ id: "s1", name: "Preparatory" }, { id: "s2", name: "Secondary" }],
  grades: [
    { id: "g1", stage: "s1", name: "Grade 9 Science", c: "#00b8d9", i: "🔬" },
    { id: "g2", stage: "s2", name: "Grade 10 Chemistry", c: "#6c3df0", i: "⚗️" },
    { id: "g3", stage: "s2", name: "Grade 11 Chemistry", c: "#c026d3", i: "🧪" },
    { id: "g4", stage: "s2", name: "Grade 12 Chemistry", c: "#f59e0b", i: "⚛️" },
  ],
  units: [{ id: "u1", grade: "g2", name: "Unit 1: Atomic Structure" }],
  lessons: [{ id: "l1", unit: "u1", title: "Introduction to Atoms", yt: "" }],
};

const sign = (p) => {
  const b = Buffer.from(JSON.stringify(p)).toString("base64url");
  return b + "." + crypto.createHmac("sha256", SECRET).update(b).digest("base64url");
};
const verify = (t) => {
  try {
    const [b, s] = t.split(".");
    const e = crypto.createHmac("sha256", SECRET).update(b).digest("base64url");
    if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
    const p = JSON.parse(Buffer.from(b, "base64url"));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
};
const hash = (pw, salt = crypto.randomBytes(16).toString("hex")) => salt + ":" + crypto.scryptSync(pw, salt, 32).toString("hex");
const check = (pw, h) => { const x = hash(pw, h.split(":")[0]); return x.length === h.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(h)); };

async function state(u) {
  const cfg = await get("cfg", DEF), all = await get("quizzes", {});
  const out = { ...cfg, role: u?.role || "guest", quizzes: {}, students: [], qs: [], pays: [] };
  if (u?.role === "admin") {
    out.students = (await get("students", [])).map(({ pass, ...s }) => s);
    out.quizzes = all; out.qs = await get("qs", []); out.pays = await get("pays", []);
  } else if (u) {
    const s = (await get("students", [])).find((x) => x.id === u.id);
    if (s) {
      const { pass, ...m } = s; out.me = m;
      out.qs = (await get("qs", [])).filter((q) => q.sid === s.id);
      out.pays = (await get("pays", [])).filter((p) => p.sid === s.id);
      const ok = (unit, svc) => !s.blocked && (s.subs[unit + ":" + svc] || 0) > Date.now();
      for (const [k, v] of Object.entries(all)) {
        const [t, id] = k.split(":"); let allow = false;
        if (t === "lesson") { const l = cfg.lessons.find((x) => x.id === id); allow = !!l && ok(l.unit, "prac"); }
        else if (t === "unit") allow = ok(id, "prac");
        else allow = cfg.units.some((x) => x.grade === id && ok(x.id, "prac"));
        if (allow) out.quizzes[k] = v;
      }
    }
  }
  return out;
}

export default async (req) => {
  if (!SECRET || !ADMIN) return err("Server not configured: set SECRET and ADMIN_PASSWORD env vars", 500);
  const path = new URL(req.url).pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  const tok = (req.headers.get("authorization") || "").replace("Bearer ", "");
  const u = tok ? verify(tok) : null;
  if (req.method === "GET" && path === "state") return j(await state(u));
  if (req.method !== "POST") return err("Not found", 404);
  const b = await req.json().catch(() => ({}));
  const cfg = await get("cfg", DEF);

  if (path === "register") {
    const name = str(b.name, 80), phone = str(b.phone, 20).replace(/\s/g, ""), pass = str(b.pass, 100);
    if (!name || !/^\+?\d{8,15}$/.test(phone) || pass.length < 6) return err("Valid name, phone and a password of 6+ characters are required");
    const ss = await get("students", []);
    if (ss.some((s) => s.phone === phone)) return err("Phone already registered");
    const s = { id: crypto.randomUUID(), name, phone, pass: hash(pass), subs: {}, blocked: false };
    ss.push(s); await put("students", ss);
    return j({ token: sign({ role: "student", id: s.id, exp: Date.now() + 30 * DAY }) });
  }
  if (path === "login") {
    const s = (await get("students", [])).find((x) => x.phone === str(b.phone, 20).replace(/\s/g, ""));
    if (!s || !check(str(b.pass, 100), s.pass)) return err("Wrong phone or password", 401);
    return j({ token: sign({ role: "student", id: s.id, exp: Date.now() + 30 * DAY }) });
  }
  if (path === "alogin") {
    const a = Buffer.from(str(b.pass, 200)), e = Buffer.from(ADMIN);
    if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return err("Wrong password", 401);
    return j({ token: sign({ role: "admin", exp: Date.now() + 12 * 3600e3 }) });
  }
  if (!u) return err("Please log in", 401);

  if (u.role === "admin") {
    if (path === "save") {
      const pick = (a) => (Array.isArray(a) ? a.slice(0, 2000) : []);
      await put("cfg", { price: Number(b.price) || 30, wallet: str(b.wallet, 30), stages: pick(b.stages), grades: pick(b.grades), units: pick(b.units), lessons: pick(b.lessons) });
      await put("quizzes", b.quizzes && typeof b.quizzes === "object" ? b.quizzes : {});
      return j({ ok: 1 });
    }
    if (path === "admin") {
      const ss = await get("students", []), pays = await get("pays", []), qs = await get("qs", []);
      const bump = (s, k) => { s.subs[k] = Math.max(s.subs[k] || 0, Date.now()) + 30 * DAY; };
      if (b.op === "act") { const s = ss.find((x) => x.id === b.sid); if (!s) return err("No student"); bump(s, str(b.key, 50)); await put("students", ss); }
      else if (b.op === "blk") { const s = ss.find((x) => x.id === b.sid); if (!s) return err("No student"); s.blocked = !s.blocked; await put("students", ss); }
      else if (b.op === "ok") { const p = pays.find((x) => x.id === b.id); const s = p && ss.find((x) => x.id === p.sid); if (!s || p.st !== "pending") return err("Invalid request"); bump(s, p.unit + ":" + p.svc); p.st = "ok"; await put("students", ss); await put("pays", pays); }
      else if (b.op === "no") { const p = pays.find((x) => x.id === b.id); if (p) p.st = "no"; await put("pays", pays); }
      else if (b.op === "reply") { const q = qs.find((x) => x.id === b.id); if (q) q.a = str(b.a, 3000); await put("qs", qs); }
      else return err("Unknown op");
      return j({ ok: 1 });
    }
    return err("Not found", 404);
  }

  const ss = await get("students", []), s = ss.find((x) => x.id === u.id);
  if (!s) return err("Account not found", 401);
  if (path === "pay") {
    if (!cfg.units.some((x) => x.id === b.unit) || !["ask", "prac"].includes(b.svc)) return err("Invalid request");
    const pays = await get("pays", []);
    if (pays.some((p) => p.sid === s.id && p.unit === b.unit && p.svc === b.svc && p.st === "pending")) return err("Already pending");
    pays.push({ id: crypto.randomUUID(), sid: s.id, unit: b.unit, svc: b.svc, ref: str(b.ref, 60), st: "pending" });
    await put("pays", pays); return j({ ok: 1 });
  }
  if (path === "ask") {
    const l = cfg.lessons.find((x) => x.id === b.lid);
    if (!l || s.blocked || (s.subs[l.unit + ":ask"] || 0) < Date.now()) return err("Subscription required", 403);
    const qs = await get("qs", []); qs.push({ id: crypto.randomUUID(), lid: l.id, sid: s.id, t: str(b.t, 2000), a: "" });
    await put("qs", qs); return j({ ok: 1 });
  }
  return err("Not found", 404);
};
export const config = { path: "/api/*" };
