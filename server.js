// Xinh Nail – máy chủ đặt lịch (không cần cài thư viện, dùng Node >= 22.5)
// Chạy: node server.js   →  http://localhost:3000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const CONFIG_PATH = path.join(ROOT, "data", "config.json");
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "xinh123";
if (!process.env.ADMIN_KEY) console.warn("⚠️  Đang dùng mật khẩu quản lý mặc định 'xinh123'. Đặt biến ADMIN_KEY khi chạy thật.");

// ---------- Database ----------
const db = new DatabaseSync(path.join(ROOT, "data", "bookings.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS bookings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,
    branch_id   TEXT NOT NULL,
    staff_id    TEXT NOT NULL,
    date        TEXT NOT NULL,
    start_min   INTEGER NOT NULL,
    end_min     INTEGER NOT NULL,
    services    TEXT NOT NULL,
    total_price INTEGER NOT NULL,
    name        TEXT NOT NULL,
    phone       TEXT NOT NULL,
    note        TEXT,
    status      TEXT NOT NULL DEFAULT 'confirmed',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bk_day ON bookings(branch_id, date);
`);
const q = {
  dayBookings: db.prepare(`SELECT * FROM bookings WHERE branch_id = ? AND date = ? AND status != 'cancelled' ORDER BY start_min`),
  allDay: db.prepare(`SELECT * FROM bookings WHERE branch_id = ? AND date = ? ORDER BY start_min`),
  activeByPhone: db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE phone = ? AND status = 'confirmed' AND date >= ?`),
  insert: db.prepare(`INSERT INTO bookings (code, branch_id, staff_id, date, start_min, end_min, services, total_price, name, phone, note)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  setStatus: db.prepare(`UPDATE bookings SET status = ? WHERE id = ?`),
};

// ---------- Helpers ----------
const readConfig = () => JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = CN
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function nowLocal(tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, min: Number(g("hour")) * 60 + Number(g("minute")) };
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function validDate(cfg, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new HttpError(400, "Ngày không hợp lệ");
  const today = nowLocal(cfg.timezone).date;
  if (date < today || date > addDays(today, cfg.maxDaysAhead)) throw new HttpError(400, "Ngày nằm ngoài khoảng cho phép đặt");
  return today;
}

function pickServices(cfg, ids) {
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, "Chưa chọn dịch vụ");
  const list = [...new Set(ids)].map((id) => cfg.services.find((s) => s.id === id));
  if (list.some((s) => !s)) throw new HttpError(400, "Dịch vụ không hợp lệ");
  const duration = list.reduce((a, s) => a + s.duration, 0);
  const slot = cfg.slotMinutes;
  return { list, duration: Math.ceil(duration / slot) * slot, price: list.reduce((a, s) => a + s.price, 0) };
}

/** Tính các khung giờ trong ngày: khung nào còn thợ trống, khung nào full. */
function computeSlots(cfg, branchId, date, staffId, duration) {
  const branch = cfg.branches.find((b) => b.id === branchId);
  if (!branch) throw new HttpError(400, "Chi nhánh không tồn tại");
  const today = validDate(cfg, date);
  const wd = weekday(date);

  let staff = cfg.staff.filter((s) => s.branch === branchId);
  if (staffId && staffId !== "any") {
    staff = staff.filter((s) => s.id === staffId);
    if (!staff.length) throw new HttpError(400, "Thợ không thuộc chi nhánh này");
  }
  const working = staff.filter((s) => !(s.offDays || []).includes(wd));
  if (!working.length) return { slots: [], dayOff: true };

  const bookings = q.dayBookings.all(branchId, date);
  const open = toMin(branch.open), close = toMin(branch.close);
  const earliest = date === today ? nowLocal(cfg.timezone).min + cfg.minLeadMinutes : -1;

  const slots = [];
  for (let t = open; t + duration <= close; t += cfg.slotMinutes) {
    if (t < earliest) continue;
    const free = working.filter((s) => !bookings.some((b) => b.staff_id === s.id && b.start_min < t + duration && t < b.end_min));
    slots.push({ time: toHHMM(t), start: t, free: free.map((s) => s.id) });
  }
  return { slots, dayOff: false };
}

// ---------- HTTP plumbing ----------
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".md": "text/plain; charset=utf-8" };

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 10_000) { reject(new HttpError(413, "Dữ liệu quá lớn")); req.destroy(); } });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new HttpError(400, "JSON không hợp lệ")); } });
  });
}

function isAdmin(req) {
  const given = Buffer.from(String(req.headers["x-admin-key"] || ""));
  const real = Buffer.from(ADMIN_KEY);
  return given.length === real.length && crypto.timingSafeEqual(given, real);
}

function serveStatic(req, res, pathname) {
  if (pathname === "/") pathname = "/index.html";
  const file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: "Forbidden" });
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Không tìm thấy trang"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

// ---------- Routes ----------
async function handleApi(req, res, url) {
  const cfg = readConfig(); // đọc lại mỗi lần → sửa config.json không cần khởi động lại
  const p = url.pathname;

  if (req.method === "GET" && p === "/api/config") {
    const { shopName, slotMinutes, maxDaysAhead, branches, staff, services } = cfg;
    return send(res, 200, { shopName, slotMinutes, maxDaysAhead, branches, staff, services, today: nowLocal(cfg.timezone).date });
  }

  if (req.method === "GET" && p === "/api/availability") {
    const branch = url.searchParams.get("branch");
    const date = url.searchParams.get("date");
    const staff = url.searchParams.get("staff") || "any";
    const { duration } = pickServices(cfg, (url.searchParams.get("services") || "").split(",").filter(Boolean));
    const { slots, dayOff } = computeSlots(cfg, branch, date, staff, duration);
    return send(res, 200, {
      dayOff, duration,
      slots: slots.map((s) => ({ time: s.time, status: s.free.length ? "available" : "full", freeCount: s.free.length })),
    });
  }

  if (req.method === "POST" && p === "/api/bookings") {
    const b = await readBody(req);
    const name = String(b.name || "").trim().slice(0, 60);
    const phone = String(b.phone || "").replace(/[\s.]/g, "");
    const note = String(b.note || "").trim().slice(0, 300);
    if (!name) throw new HttpError(400, "Vui lòng nhập họ tên");
    if (!/^0\d{9,10}$/.test(phone)) throw new HttpError(400, "Số điện thoại không hợp lệ");

    const svc = pickServices(cfg, b.services);
    const today = validDate(cfg, b.date);
    if (q.activeByPhone.get(phone, today).n >= cfg.maxActiveBookingsPerPhone)
      throw new HttpError(429, "Số điện thoại này đã có nhiều lịch hẹn sắp tới. Vui lòng gọi tiệm để được hỗ trợ.");

    // Kiểm tra lại & ghi trong cùng một bước đồng bộ → không thể bị 2 khách đặt trùng.
    const { slots } = computeSlots(cfg, b.branch, b.date, b.staff || "any", svc.duration);
    const slot = slots.find((s) => s.time === b.time);
    if (!slot || !slot.free.length) throw new HttpError(409, "Rất tiếc, khung giờ này vừa có người đặt. Bạn chọn giờ khác nhé!");

    // "Bất kỳ" → xếp thợ đang ít khách nhất trong ngày
    const dayLoad = (id) => q.dayBookings.all(b.branch, b.date).filter((x) => x.staff_id === id).length;
    const staffId = slot.free.sort((a, c) => dayLoad(a) - dayLoad(c))[0];

    const code = "XN" + crypto.randomBytes(3).toString("hex").toUpperCase();
    q.insert.run(code, b.branch, staffId, b.date, slot.start, slot.start + svc.duration,
      JSON.stringify(svc.list.map((s) => s.id)), svc.price, name, phone, note);

    const staff = cfg.staff.find((s) => s.id === staffId);
    const branch = cfg.branches.find((x) => x.id === b.branch);
    return send(res, 201, {
      code, date: b.date, time: b.time, end: toHHMM(slot.start + svc.duration),
      staff: staff.name, branch: branch.name, address: branch.address, branchPhone: branch.phone,
      services: svc.list.map((s) => s.name), total: svc.price,
    });
  }

  // ----- Admin -----
  if (p.startsWith("/api/admin/")) {
    if (!isAdmin(req)) throw new HttpError(401, "Sai mật khẩu quản lý");

    if (req.method === "GET" && p === "/api/admin/bookings") {
      const branch = url.searchParams.get("branch");
      const date = url.searchParams.get("date");
      const rows = q.allDay.all(branch, date).map((r) => ({
        ...r, start: toHHMM(r.start_min), end: toHHMM(r.end_min),
        services: JSON.parse(r.services).map((id) => cfg.services.find((s) => s.id === id)?.name || id),
      }));
      return send(res, 200, { bookings: rows });
    }

    const m = p.match(/^\/api\/admin\/bookings\/(\d+)\/status$/);
    if (req.method === "POST" && m) {
      const { status } = await readBody(req);
      if (!["confirmed", "done", "cancelled"].includes(status)) throw new HttpError(400, "Trạng thái không hợp lệ");
      q.setStatus.run(status, Number(m[1]));
      return send(res, 200, { ok: true });
    }
  }

  throw new HttpError(404, "Không tìm thấy");
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (!url.pathname.startsWith("/api/")) return serveStatic(req, res, url.pathname);
  try {
    await handleApi(req, res, url);
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    send(res, err.status || 500, { error: err instanceof HttpError ? err.message : "Lỗi máy chủ, vui lòng thử lại" });
  }
}).listen(PORT, () => {
  console.log(`💅 Xinh Nail đang chạy:  http://localhost:${PORT}`);
  console.log(`   Trang đặt lịch:       http://localhost:${PORT}/booking.html`);
  console.log(`   Trang quản lý:        http://localhost:${PORT}/admin.html`);
});
