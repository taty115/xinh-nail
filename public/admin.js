// ===== Xinh Nail – trang quản lý =====
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => n.toLocaleString("vi-VN") + "đ";
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const STATUS = { confirmed: "Đã đặt", done: "Đã xong", cancelled: "Đã huỷ" };

let cfg, key = "";
try { key = sessionStorage.getItem("xinh-admin") || ""; } catch {}

async function api(path, opts = {}) {
  // Web tĩnh (GitHub Pages) hoặc máy chủ không phản hồi → dùng chế độ demo trong trình duyệt
  const demo = () => { window.DemoAPI.active = true; return window.DemoAPI.handle(path, opts); };
  if (window.DemoAPI?.active) return demo();
  let res;
  try { res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", "x-admin-key": key } }); }
  catch { if (window.DemoAPI) return demo(); throw new Error("Không kết nối được máy chủ"); }
  if (!(res.headers.get("content-type") || "").includes("json") && window.DemoAPI) return demo();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || "Có lỗi xảy ra, thử lại nhé"); e.status = res.status; throw e; }
  return data;
}

async function start() {
  cfg = await api("/api/config");
  $("#fBranch").innerHTML = cfg.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
  $("#fDate").value = cfg.today;
  try {
    await load();
  } catch (e) {
    if (e.status === 401) return showLogin("Sai mật khẩu");
    throw e;
  }
  $("#login").hidden = true; $("#app").hidden = false; $("#logout").hidden = false;
  if (window.DemoAPI?.active && !document.querySelector("#app .demo-note"))
    $("#app").insertAdjacentHTML("afterbegin", `<p class="demo-note">✨ Bản demo – dữ liệu là lịch mẫu, kèm các lịch bạn đã đặt thử trên máy này.</p>`);
}

function showLogin(msg = "") {
  try { sessionStorage.removeItem("xinh-admin"); } catch {}
  $("#login").hidden = false; $("#app").hidden = true; $("#logout").hidden = true;
  $("#loginErr").textContent = msg;
}

async function load() {
  const branch = $("#fBranch").value, date = $("#fDate").value;
  const { bookings } = await api(`/api/admin/bookings?branch=${encodeURIComponent(branch)}&date=${encodeURIComponent(date)}`);
  const b = cfg.branches.find((x) => x.id === branch);
  const staff = cfg.staff.filter((s) => s.branch === branch);
  const staffName = (id) => staff.find((s) => s.id === id)?.name || id;
  const active = bookings.filter((x) => x.status !== "cancelled");

  $("#stats").innerHTML = [
    ["Lịch hẹn", active.length],
    ["Đã xong", bookings.filter((x) => x.status === "done").length],
    ["Đã huỷ", bookings.filter((x) => x.status === "cancelled").length],
    ["Doanh thu dự kiến", money(active.reduce((a, x) => a + x.total_price, 0))],
  ].map(([l, v]) => `<div class="ad__stat"><small>${l}</small><strong>${v}</strong></div>`).join("");

  // Grid: hàng = khung giờ, cột = thợ
  const step = cfg.slotMinutes, open = toMin(b.open), close = toMin(b.close);
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  const covered = new Set();
  let rows = "";
  for (let t = open; t < close; t += step) {
    rows += `<tr><td class="t">${toHHMM(t)}</td>`;
    for (const s of staff) {
      if ((s.offDays || []).includes(wd)) { if (t === open) rows += `<td class="off" rowspan="${Math.ceil((close - open) / step)}"></td>`; continue; }
      if (covered.has(`${s.id}@${t}`)) continue;
      const bk = active.find((x) => x.staff_id === s.id && x.start_min >= t && x.start_min < t + step);
      if (bk) {
        const span = Math.max(1, Math.ceil((Math.min(bk.end_min, close) - t) / step));
        for (let k = 1; k < span; k++) covered.add(`${s.id}@${t + k * step}`);
        rows += `<td rowspan="${span}"><div class="blk ${bk.status}"><strong>${esc(bk.name)}</strong>${esc(bk.start)}–${esc(bk.end)}<br/>${esc(bk.services.join(", "))}</div></td>`;
      } else rows += "<td></td>";
    }
    rows += "</tr>";
  }
  $("#grid").innerHTML = staff.length
    ? `<table class="grid"><thead><tr><th></th>${staff.map((s) => `<th>${esc(s.name)}${(s.offDays || []).includes(wd) ? " (nghỉ)" : ""}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="empty-note">Chi nhánh chưa có thợ.</p>`;

  $("#list").innerHTML = bookings.length ? `<table class="list"><thead><tr>
      <th>Giờ</th><th>Khách</th><th>Dịch vụ</th><th>Thợ</th><th>Giá</th><th>Mã</th><th>Trạng thái</th><th></th></tr></thead><tbody>
      ${bookings.map((x) => `<tr class="${x.status === "cancelled" ? "is-cancelled" : ""}">
        <td>${esc(x.start)}–${esc(x.end)}</td>
        <td><strong>${esc(x.name)}</strong><br/><a href="tel:${esc(x.phone)}">${esc(x.phone)}</a>${x.note ? `<br/><small class="muted">📝 ${esc(x.note)}</small>` : ""}</td>
        <td>${esc(x.services.join(", "))}</td>
        <td>${esc(staffName(x.staff_id))}</td>
        <td>${money(x.total_price)}</td>
        <td>${esc(x.code)}</td>
        <td><span class="badge ${x.status}">${STATUS[x.status]}</span></td>
        <td><div class="act">
          ${x.status === "confirmed" ? `<button data-id="${x.id}" data-s="done">✓ Xong</button><button data-id="${x.id}" data-s="cancelled">Huỷ</button>` : ""}
          ${x.status !== "confirmed" ? `<button data-id="${x.id}" data-s="confirmed">Khôi phục</button>` : ""}
        </div></td></tr>`).join("")}
    </tbody></table>` : `<p class="empty-note">Chưa có lịch hẹn nào trong ngày này.</p>`;
}

$("#login").addEventListener("submit", async (e) => {
  e.preventDefault();
  key = e.target.elements.namedItem("key").value;
  try { sessionStorage.setItem("xinh-admin", key); } catch {}
  $("#loginErr").textContent = "";
  start().catch((err) => ($("#loginErr").textContent = err.message));
});
$("#logout").addEventListener("click", () => { key = ""; showLogin(); });
$("#fBranch").addEventListener("change", load);
$("#fDate").addEventListener("change", load);
$("#refresh").addEventListener("click", load);
$("#prevDay").addEventListener("click", () => { $("#fDate").value = addDays($("#fDate").value, -1); load(); });
$("#nextDay").addEventListener("click", () => { $("#fDate").value = addDays($("#fDate").value, 1); load(); });

$("#list").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-id]"); if (!btn) return;
  if (btn.dataset.s === "cancelled" && !confirm("Huỷ lịch hẹn này? Khung giờ sẽ được mở lại cho khách khác.")) return;
  await api(`/api/admin/bookings/${btn.dataset.id}/status`, { method: "POST", body: JSON.stringify({ status: btn.dataset.s }) });
  load();
});

// Tự làm mới mỗi 60 giây khi đang mở
setInterval(() => { if (!$("#app").hidden) load().catch(() => {}); }, 60_000);

if (key) start().catch(() => showLogin());
