// ===== Chế độ DEMO (web tĩnh, không có máy chủ) =====
// Dùng khi đưa lên GitHub Pages / mở file trực tiếp: giả lập API ngay trong trình duyệt.
// - Lịch "đã có khách" được sinh ngẫu nhiên nhưng cố định theo ngày + thợ (để thấy khung FULL).
// - Lịch khách đặt thử chỉ lưu trong trình duyệt của người xem (localStorage), tiệm không nhận được.
(function () {
  const STORE = "xinh-demo-bookings";
  let cfgCache;

  const pad = (n) => String(n).padStart(2, "0");
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const toHHMM = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
  const now = () => { const d = new Date(); return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, min: d.getHours() * 60 + d.getMinutes() }; };

  const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; } };
  const save = (list) => { try { localStorage.setItem(STORE, JSON.stringify(list)); } catch {} };

  // Số ngẫu nhiên cố định theo chuỗi (cùng ngày + thợ → cùng kết quả mỗi lần tải trang)
  function seeded(str) {
    let h = 2166136261;
    for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
  }

  function fakeBusy(cfg, branch, date) {
    const open = toMin(branch.open), close = toMin(branch.close), step = cfg.slotMinutes;
    const out = [];
    cfg.staff.filter((s) => s.branch === branch.id).forEach((s) => {
      const rnd = seeded(`${date}|${s.id}`);
      const count = 2 + Math.floor(rnd() * 3); // 2–4 khách/thợ/ngày
      for (let i = 0; i < count; i++) {
        const len = [60, 90, 120][Math.floor(rnd() * 3)];
        const start = open + Math.floor(rnd() * ((close - open - len) / step)) * step;
        out.push({ staff_id: s.id, start_min: start, end_min: start + len });
      }
      // buổi sáng thường kín hơn để thấy rõ "Hết chỗ"
      if (rnd() < 0.7) out.push({ staff_id: s.id, start_min: open, end_min: open + 90 });
    });
    return out;
  }

  class DemoError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

  function pickServices(cfg, ids) {
    if (!ids.length) throw new DemoError(400, "Chưa chọn dịch vụ");
    const list = [...new Set(ids)].map((id) => cfg.services.find((s) => s.id === id)).filter(Boolean);
    const duration = Math.ceil(list.reduce((a, s) => a + s.duration, 0) / cfg.slotMinutes) * cfg.slotMinutes;
    return { list, duration, price: list.reduce((a, s) => a + s.price, 0) };
  }

  function computeSlots(cfg, branchId, date, staffId, duration) {
    const branch = cfg.branches.find((b) => b.id === branchId);
    if (!branch) throw new DemoError(400, "Chi nhánh không tồn tại");
    let staff = cfg.staff.filter((s) => s.branch === branchId);
    if (staffId && staffId !== "any") staff = staff.filter((s) => s.id === staffId);
    const working = staff.filter((s) => !(s.offDays || []).includes(weekday(date)));
    if (!working.length) return { slots: [], dayOff: true };

    const busy = fakeBusy(cfg, branch, date).concat(load().filter((b) => b.branch === branchId && b.date === date));
    const t0 = now(); const earliest = date === t0.date ? t0.min + cfg.minLeadMinutes : -1;
    const slots = [];
    for (let t = toMin(branch.open); t + duration <= toMin(branch.close); t += cfg.slotMinutes) {
      if (t < earliest) continue;
      const free = working.filter((s) => !busy.some((b) => b.staff_id === s.id && b.start_min < t + duration && t < b.end_min));
      slots.push({ time: toHHMM(t), start: t, free: free.map((s) => s.id) });
    }
    return { slots, dayOff: false };
  }

  async function getConfig() {
    if (!cfgCache) {
      const res = await fetch("demo-config.json");
      cfgCache = await res.json();
    }
    return { ...cfgCache, today: now().date };
  }

  async function handle(path, opts = {}) {
    const url = new URL(path, location.href);
    const p = url.pathname.replace(/^.*\/api\//, "/api/");
    const cfg = await getConfig();

    if (p === "/api/config") return cfg;

    if (p === "/api/availability") {
      const q = url.searchParams;
      const { duration } = pickServices(cfg, (q.get("services") || "").split(",").filter(Boolean));
      const { slots, dayOff } = computeSlots(cfg, q.get("branch"), q.get("date"), q.get("staff") || "any", duration);
      return { dayOff, duration, slots: slots.map((s) => ({ time: s.time, status: s.free.length ? "available" : "full", freeCount: s.free.length })) };
    }

    if (p === "/api/bookings" && opts.method === "POST") {
      const b = JSON.parse(opts.body || "{}");
      const phone = String(b.phone || "").replace(/[\s.]/g, "");
      if (!String(b.name || "").trim()) throw new DemoError(400, "Vui lòng nhập họ tên");
      if (!/^0\d{9,10}$/.test(phone)) throw new DemoError(400, "Số điện thoại không hợp lệ");
      const svc = pickServices(cfg, b.services || []);
      const { slots } = computeSlots(cfg, b.branch, b.date, b.staff || "any", svc.duration);
      const slot = slots.find((s) => s.time === b.time);
      if (!slot || !slot.free.length) throw new DemoError(409, "Rất tiếc, khung giờ này vừa có người đặt. Bạn chọn giờ khác nhé!");
      const staffId = slot.free[0];
      const code = "DEMO" + Math.random().toString(36).slice(2, 6).toUpperCase();
      const list = load();
      list.push({ id: Date.now(), code, branch: b.branch, staff_id: staffId, date: b.date, start_min: slot.start, end_min: slot.start + svc.duration,
        services: svc.list.map((s) => s.id), total_price: svc.price, name: String(b.name).trim(), phone, note: b.note || "", status: "confirmed" });
      save(list);
      const branch = cfg.branches.find((x) => x.id === b.branch);
      return { demo: true, code, date: b.date, time: b.time, end: toHMMSafe(slot.start + svc.duration), staff: cfg.staff.find((s) => s.id === staffId).name,
        branch: branch.name, address: branch.address, branchPhone: branch.phone, services: svc.list.map((s) => s.name), total: svc.price };
    }

    // Trang quản lý (demo): mật khẩu bất kỳ, xem lịch giả + lịch đã đặt thử
    if (p === "/api/admin/bookings") {
      const branchId = url.searchParams.get("branch"), date = url.searchParams.get("date");
      const branch = cfg.branches.find((b) => b.id === branchId);
      const svcName = (id) => cfg.services.find((s) => s.id === id)?.name || id;
      const fake = fakeBusy(cfg, branch, date).map((b, i) => ({ ...b, id: -(i + 1), code: "MAU" + (100 + i), name: ["Ngọc Anh", "Thu Trang", "Minh Thư", "Bảo Ngọc", "Lan Chi", "Hà My"][i % 6],
        phone: "09xx xxx xxx", services: [svcName(cfg.services[i % cfg.services.length].id)], total_price: cfg.services[i % cfg.services.length].price, status: "confirmed", note: "" }));
      const mine = load().filter((b) => b.branch === branchId && b.date === date).map((b) => ({ ...b, services: b.services.map(svcName) }));
      const rows = [...fake, ...mine].sort((a, c) => a.start_min - c.start_min).map((r) => ({ ...r, start: toHHMM(r.start_min), end: toHHMM(r.end_min) }));
      return { bookings: rows };
    }
    const m = p.match(/^\/api\/admin\/bookings\/(-?\d+)\/status$/);
    if (m) {
      const list = load(); const it = list.find((x) => String(x.id) === m[1]);
      if (it) { it.status = JSON.parse(opts.body).status; save(list); }
      return { ok: true };
    }
    throw new DemoError(404, "Không tìm thấy");
  }
  const toHMMSafe = toHHMM;

  // Tự nhận biết khi nào chạy demo: GitHub Pages, mở file trực tiếp, hoặc khi máy chủ không phản hồi API
  const forced = location.protocol === "file:" || /github\.io$/.test(location.hostname) || /[?&]demo\b/.test(location.search);
  window.DemoAPI = { handle, forced, active: forced };
})();
