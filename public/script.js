// Nav: shadow on scroll + mobile toggle
const nav = document.getElementById("nav");
const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 20);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

document.getElementById("navToggle").addEventListener("click", () => nav.classList.toggle("is-open"));
document.querySelectorAll("#navLinks a").forEach((a) =>
  a.addEventListener("click", () => nav.classList.remove("is-open"))
);

// Price tabs
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".price-panel");
tabs.forEach((tab) =>
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
    panels.forEach((p) => p.classList.toggle("is-active", p.dataset.panel === tab.dataset.tab));
  })
);

// ===== Scroll reveal: hiện dần + trượt, chạy 1 lần =====
(() => {
  const root = document.documentElement;
  const els = [...document.querySelectorAll(".reveal")];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.__revealReady = true;
  if (reduce || !("IntersectionObserver" in window)) { root.classList.remove("js-reveal"); return; }

  // Stagger: các khối .reveal cùng một khung cha hiện lần lượt, mỗi khối trễ 70ms
  const STEP = 70, MAX = 8;
  els.forEach((el) => {
    const siblings = [...el.parentElement.children].filter((c) => c.classList.contains("reveal"));
    if (siblings.length > 1) el.style.setProperty("--reveal-delay", `${Math.min(siblings.indexOf(el), MAX) * STEP}ms`);
  });

  const io = new IntersectionObserver((entries) => {
    entries.forEach(({ isIntersecting, target: el }) => {
      if (!isIntersecting) return;
      io.unobserve(el);
      el.classList.add("is-visible");
      // Xong hiệu ứng thì gỡ class để hover/transition riêng của khối hoạt động bình thường
      const delay = parseFloat(el.style.getPropertyValue("--reveal-delay")) || 0;
      setTimeout(() => {
        el.classList.remove("reveal", "reveal--left", "reveal--right", "reveal--zoom", "is-visible");
        el.style.removeProperty("--reveal-delay");
      }, 900 + delay + 100);
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });

  els.forEach((el) => io.observe(el));
})();

// Footer year
document.getElementById("year").textContent = new Date().getFullYear();
