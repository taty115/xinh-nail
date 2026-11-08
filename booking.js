// ===== Xinh Nail – trang đặt lịch =====
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => n.toLocaleString("vi-VN") + "đ";
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : `${m} phút`);
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const initials = (name) => name.split(" ").pop()[0];

let cfg;
const st = { step: 1, branch: null, services: new Set(), staff: "any", date: null, time: null, slots: null };
let slotReq = 0;

async function api(path, opts = {}) {
  // Web tĩnh (GitHub Pages) hoặc máy chủ không phản hồi → dùng chế độ demo trong trình duyệt
  const demo = () => { window.DemoAPI.active = true; return window.DemoAPI.handle(path, opts); };
  if (window.DemoAPI?.active) return demo();
  let res;
  try { res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json" } }); }
  catch { if (window.DemoAPI) return demo(); throw new Error("Không kết nối được máy chủ"); }
  if (!(res.headers.get("content-type") || "").includes("json") && window.DemoAPI) return demo();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || "Có lỗi xảy ra, thử lại nhé"); e.status = res.status; throw e; }
  return data;
}

const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const wdOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const fmtDate = (date) => { const [y, m, d] = date.split("-"); return `${WD[wdOf(date)]}, ${d}/${m}/${y}`; };

const selectedServices = () => cfg.services.filter((s) => st.services.has(s.id));
const totalDuration = () => { const m = selectedServices().reduce((a, s) => a + s.duration, 0); return Math.ceil(m / cfg.slotMinutes) * cfg.slotMinutes; };
const totalPrice = () => selectedServices().reduce((a, s) => a + s.price, 0);
const branchObj = () => cfg.branches.find((b) => b.id === st.branch);
const staffObj = () => cfg.staff.find((s) => s.id === st.staff);
const isOff = (staffId, date) => staffId !== "any" && (cfg.staff.find((s) => s.id === staffId)?.offDays || []).includes(wdOf(date));

// ---------- Render ----------
function renderBranches() {
  $("#branchList").innerHTML = cfg.branches.map((b) => `
    <button type="button" class="opt ${st.branch === b.id ? "is-selected" : ""}" data-branch="${b.id}">
      <span class="opt__icon">📍</span>
      <span><strong>${esc(b.name)}</strong><small>${esc(b.address)}</small><small>🕘 ${b.open} – ${b.close}</small></span>
    </button>`).join("");
}

function renderServices() {
  const groups = [...new Set(cfg.services.map((s) => s.category))];
  $("#serviceList").innerHTML = groups.map((g) => `
    <div class="svc-group"><h3>${esc(g)}</h3>
      ${cfg.services.filter((s) => s.category === g).map((s) => `
        <label class="svc">
          <input type="checkbox" value="${s.id}" ${st.services.has(s.id) ? "checked" : ""} />
          <span class="svc__check">✓</span>
          <span class="svc__name">${esc(s.name)}<small>⏱ ${dur(s.duration)}</small></span>
          <span class="svc__price">${money(s.price)}</span>
        </label>`).join("")}
    </div>`).join("");
}

function renderStaff() {
  const list = cfg.staff.filter((s) => s.branch === st.branch);
  $("#staffList").innerHTML = `
    <button type="button" class="opt ${st.staff === "any" ? "is-selected" : ""}" data-staff="any">
      <span class="opt__icon opt__icon--any">✦</span>
      <span><strong>Thợ bất kỳ</strong><small>Tiệm xếp thợ đang trống – nhiều giờ trống nhất</small></span>
    </button>` + list.map((s) => `
    <button type="button" class="opt ${st.staff === s.id ? "is-selected" : ""}" data-staff="${s.id}">
      <span class="opt__icon">${esc(initials(s.name))}</span>
      <span><strong>${esc(s.name)}</strong><small>${esc(s.title || "")}</small>
      ${s.offDays?.length ? `<small>Nghỉ: ${s.offDays.map((d) => WD[d]).join(", ")}</small>` : ""}</span>
    </button>`).join("");
}

const WD_FULL = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

function renderDates() {
  const days = Array.from({ length: cfg.maxDaysAhead + 1 }, (_, i) => addDays(cfg.today, i));
  $("#dateList").innerHTML = days.map((d, i) => {
    const off = isOff(st.staff, d);
    const [y, m, day] = d.split("-");
    return `<button type="button" class="date ${st.date === d ? "is-selected" : ""}" data-date="${d}" ${off ? "disabled title='Thợ nghỉ'" : ""}>
      <small>${i === 0 ? "Hôm nay" : WD_FULL[wdOf(d)]}</small><strong>${day}</strong><small>${off ? "Nghỉ" : `${m}/${y}`}</small></button>`;
  }).join("");
  if (st.date) { const [y, m, d] = st.date.split("-"); $("#dateLabel").textContent = `${WD_FULL[wdOf(st.date)]}, ${d}/${m}/${y}`; }
  $("#dateList .is-selected")?.scrollIntoView({ block: "nearest", inline: "center" });
}

async function loadSlots() {
  const box = $("#slotList");
  if (!st.date) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="slots-loading">Đang tải khung giờ… ⏳</div>`;
  const id = ++slotReq;
  try {
    const qs = new URLSearchParams({ branch: st.branch, date: st.date, staff: st.staff, services: [...st.services].join(",") });
    const data = await api(`/api/availability?${qs}`);
    if (id !== slotReq) return; // đã có yêu cầu mới hơn
    st.slots = data.slots;
    renderSlots(data);
  } catch (e) {
    if (id === slotReq) box.innerHTML = `<div class="slots-empty">${esc(e.message)}</div>`;
  }
}

function renderSlots(data) {
  const box = $("#slotList");
  if (data.dayOff) {
    box.innerHTML = `<div class="slots-empty">${esc(staffObj()?.name || "Thợ")} nghỉ vào ngày này 🌙<br/><br/>
      <button type="button" class="btn btn--ghost btn--sm" data-action="any-staff">Chọn thợ bất kỳ</button></div>`;
    return;
  }
  if (!data.slots.length) { box.innerHTML = `<div class="slots-empty">Hôm nay đã hết khung giờ nhận khách. Bạn chọn ngày khác nhé 💗</div>`; return; }
  const allFull = data.slots.every((s) => s.status === "full");
  box.innerHTML = (allFull ? `<div class="slots-empty" style="margin-bottom:1rem">Ngày này đã kín lịch 😢 Bạn thử ngày khác hoặc thợ khác nhé.</div>` : "") +
    `<div class="slots">${data.slots.map((s) => {
      const full = s.status === "full", sel = st.time === s.time;
      const sub = full ? "Hết chỗ" : sel ? "Đã chọn ✓" : "Còn chỗ";
      return `<button type="button" class="slot ${sel ? "is-selected" : ""}" data-time="${s.time}" ${full ? "disabled" : ""}>
        <strong>${s.time}</strong><small>${sub}</small></button>`;
    }).join("")}</div>`;
}

function renderSummary() {
  const b = branchObj(), svc = selectedServices();
  const row = (icon, label, val) => `<div class="sum-row"><span>${icon}</span><div><small>${label}</small>${val || '<span class="empty">Chưa chọn</span>'}</div></div>`;
  $("#summary").innerHTML = `<h3>Lịch hẹn của bạn</h3>
    ${row("📍", "Chi nhánh", b && esc(b.name))}
    ${row("💅", "Dịch vụ", svc.length && svc.map((s) => esc(s.name)).join("<br/>"))}
    ${row("👩‍🎨", "Thợ", st.branch && (st.staff === "any" ? "Thợ bất kỳ" : esc(staffObj()?.name)))}
    ${row("🗓", "Thời gian", st.date && st.time && `${st.time} · ${fmtDate(st.date)}`)}
    ${svc.length ? `<div class="sum-total"><span>Tạm tính · ${dur(totalDuration())}</span><strong>${money(totalPrice())}</strong></div>` : ""}`;
}

function canNext() {
  return { 1: !!st.branch, 2: st.services.size > 0, 3: !!st.staff, 4: !!(st.date && st.time), 5: true }[st.step];
}

function renderStep() {
  document.querySelectorAll(".bk-step").forEach((s) => s.classList.toggle("is-active", Number(s.dataset.step) === st.step));
  document.querySelectorAll("#steps li").forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle("is-current", n === st.step);
    li.classList.toggle("is-done", n < st.step);
  });
  $("#backBtn").hidden = st.step === 1;
  $("#nextBtn").textContent = st.step === 5 ? "Xác nhận đặt lịch ✨" : "Tiếp tục →";
  $("#nextBtn").disabled = !canNext();
  $("#bkError").textContent = "";
  renderSummary();
}

function goto(step) {
  st.step = step;
  if (step === 1) renderBranches();
  if (step === 2) renderServices();
  if (step === 3) renderStaff();
  if (step === 4) {
    if (!st.date || isOff(st.staff, st.date)) st.date = firstWorkingDay();
    renderDates();
    loadSlots();
  }
  renderStep();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function firstWorkingDay() {
  for (let i = 0; i <= cfg.maxDaysAhead; i++) { const d = addDays(cfg.today, i); if (!isOff(st.staff, d)) return d; }
  return cfg.today;
}

// ---------- Events ----------
$("#branchList").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-branch]"); if (!btn) return;
  if (st.branch !== btn.dataset.branch) { st.branch = btn.dataset.branch; st.staff = "any"; st.time = null; }
  renderBranches(); renderStep();
});

$("#serviceList").addEventListener("change", (e) => {
  if (e.target.type !== "checkbox") return;
  e.target.checked ? st.services.add(e.target.value) : st.services.delete(e.target.value);
  st.time = null; renderStep();
});

$("#staffList").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-staff]"); if (!btn) return;
  st.staff = btn.dataset.staff; st.time = null;
  renderStaff(); renderStep();
});

$("#dateList").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-date]"); if (!btn || btn.disabled) return;
  st.date = btn.dataset.date; st.time = null;
  renderDates(); loadSlots(); renderStep();
});

$("#slotList").addEventListener("click", (e) => {
  if (e.target.closest("[data-action='any-staff']")) { st.staff = "any"; renderDates(); loadSlots(); renderStep(); return; }
  const btn = e.target.closest("[data-time]"); if (!btn || btn.disabled) return;
  st.time = btn.dataset.time;
  document.querySelectorAll(".slot:not(:disabled)").forEach((s) => {
    s.classList.toggle("is-selected", s === btn);
    s.querySelector("small").textContent = s === btn ? "Đã chọn ✓" : "Còn chỗ";
  });
  renderStep();
});

$("#backBtn").addEventListener("click", () => goto(st.step - 1));
$("#nextBtn").addEventListener("click", () => (st.step < 5 ? goto(st.step + 1) : submit()));

async function submit() {
  const f = $("#infoForm");
  const name = f.elements.namedItem("name").value.trim();
  const phone = f.elements.namedItem("phone").value.trim();
  if (!name) return ($("#bkError").textContent = "Vui lòng nhập họ tên 💗");
  if (!/^0\d{9,10}$/.test(phone.replace(/[\s.]/g, ""))) return ($("#bkError").textContent = "Số điện thoại chưa đúng (VD: 0909123456)");

  const btn = $("#nextBtn");
  btn.disabled = true; btn.textContent = "Đang gửi…";
  try {
    const r = await api("/api/bookings", {
      method: "POST",
      body: JSON.stringify({ branch: st.branch, services: [...st.services], staff: st.staff, date: st.date, time: st.time, name, phone, note: f.elements.namedItem("note").value }),
    });
    showDone(r);
  } catch (e) {
    if (e.status === 409) { // giờ vừa bị người khác đặt
      st.time = null; goto(4);
      $("#bkError").textContent = e.message;
    } else {
      $("#bkError").textContent = e.message;
      btn.disabled = false; btn.textContent = "Xác nhận đặt lịch ✨";
    }
  }
}

function showDone(r) {
  document.querySelector(".bk__panel").style.display = "none";
  const done = $("#done");
  done.hidden = false;
  done.innerHTML = `
    <div class="bk-done__icon">💖</div>
    <h2>Đặt lịch <em>thành công!</em></h2>
    <p class="muted">Mã lịch hẹn của bạn</p>
    <div class="bk-done__code">${esc(r.code)}</div>
    <dl>
      <dt>Chi nhánh</dt><dd>${esc(r.branch)}<br/><small class="muted">${esc(r.address)}</small></dd>
      <dt>Thời gian</dt><dd>${esc(r.time)} – ${esc(r.end)} · ${fmtDate(r.date)}</dd>
      <dt>Thợ</dt><dd>${esc(r.staff)}</dd>
      <dt>Dịch vụ</dt><dd>${r.services.map(esc).join("<br/>")}</dd>
      <dt>Tạm tính</dt><dd><strong>${money(r.total)}</strong></dd>
    </dl>
    ${r.demo ? `<p class="demo-note">Đây là bản demo nên tiệm chưa nhận lịch này.</p>` : ""}
    <p class="muted">Vui lòng đến đúng giờ nha. Nếu cần đổi / huỷ lịch, gọi tiệm: <a href="tel:${esc(r.branchPhone)}"><strong>${esc(r.branchPhone)}</strong></a></p>
    <div class="bk-done__actions">
      <a class="btn btn--primary" href="index.html">Về trang chủ</a>
      <a class="btn btn--ghost" href="booking.html">Đặt thêm lịch</a>
    </div>`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Init ----------
(async () => {
  try {
    cfg = await api("/api/config");
  } catch {
    $("#wizard").innerHTML = `<div class="bk__main slots-empty">Không kết nối được máy chủ đặt lịch. Vui lòng gọi tiệm để đặt lịch nhé 📞</div>`;
    return;
  }
  if (window.DemoAPI?.active) {
    document.querySelector(".bk__head").insertAdjacentHTML("beforeend",
      `<p class="demo-note">✨ Bản demo – bạn cứ bấm thử thoải mái, lịch chỉ lưu trên máy của bạn.</p>`);
  }
  const pre = new URLSearchParams(location.search).get("branch");
  if (cfg.branches.some((b) => b.id === pre)) st.branch = pre;
  else if (cfg.branches.length === 1) st.branch = cfg.branches[0].id;
  goto(1);
})();
