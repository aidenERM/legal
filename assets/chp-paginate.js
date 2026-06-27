/*
 * CHP Management — Liquid Glass Paginator
 * Splits a container into pages at each element matching `breakSelector`,
 * animates transitions with spring-eased fade+slide, and shows a floating
 * glass dock. Shared by ToS, Privacy Policy, and Changelog.
 */

// Drives the --mx/--my specular highlight on .chp-glass surfaces so the
// reflection tracks the pointer, like light moving across real glass.
function initChpGlassHighlight() {
  let raf = null;
  document.addEventListener("pointermove", (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const target = e.target.closest(".chp-glass, .latest-hero");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--mx", `${((e.clientX - rect.left) / rect.width) * 100}%`);
      target.style.setProperty("--my", `${((e.clientY - rect.top) / rect.height) * 100}%`);
    });
  });
}
initChpGlassHighlight();

function initChpPaginator({ containerSelector, breakSelector, introLabel = "Overview" }) {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  const children = Array.from(container.children);
  const pages = [];
  let current = null;
  let currentLabel = introLabel;

  for (const el of children) {
    if (el.matches(breakSelector)) {
      if (current) pages.push({ label: currentLabel, els: current });
      current = [];
      currentLabel = (el.textContent || "").trim().slice(0, 60) || `Page ${pages.length + 1}`;
    }
    if (!current) current = [];
    current.push(el);
  }
  if (current && current.length) pages.push({ label: currentLabel, els: current });
  if (pages.length === 0) return;

  // Wrap each page's elements in a .chp-page div
  const pageDivs = pages.map((page) => {
    const div = document.createElement("div");
    div.className = "chp-page chp-glass chp-glass-card";
    page.els.forEach((el) => div.appendChild(el));
    container.appendChild(div);
    return div;
  });

  // Build dock
  const dock = document.createElement("div");
  dock.className = "chp-dock";
  dock.innerHTML = `
    <button type="button" class="chp-dock-prev" aria-label="Previous page">&#8249;</button>
    <span class="chp-dock-label"></span>
    <button type="button" class="chp-dock-next" aria-label="Next page">&#8250;</button>
  `;
  document.body.appendChild(dock);

  const label   = dock.querySelector(".chp-dock-label");
  const prevBtn = dock.querySelector(".chp-dock-prev");
  const nextBtn = dock.querySelector(".chp-dock-next");

  let index = 0;
  let animating = false;

  function render(newIndex, direction) {
    if (animating) return;
    animating = true;

    const oldDiv = pageDivs[index];
    const newDiv = pageDivs[newIndex];

    // Animate out
    oldDiv.classList.add("is-leaving");
    oldDiv.addEventListener("animationend", () => {
      oldDiv.classList.remove("is-active", "is-leaving");
      oldDiv.style.display = "none";

      // Animate in
      newDiv.style.display = "block";
      newDiv.classList.add("is-active");
      animating = false;
    }, { once: true });

    index = newIndex;
    label.textContent = `${index + 1} / ${pageDivs.length}`;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === pageDivs.length - 1;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goTo(i) {
    const newIndex = Math.max(0, Math.min(pageDivs.length - 1, i));
    if (newIndex === index) return;
    render(newIndex, newIndex > index ? 1 : -1);
  }

  // Initial state
  pageDivs[0].classList.add("is-active");
  pageDivs[0].style.display = "block";
  label.textContent = `1 / ${pageDivs.length}`;
  prevBtn.disabled = true;
  nextBtn.disabled = pageDivs.length === 1;

  prevBtn.addEventListener("click", () => goTo(index - 1));
  nextBtn.addEventListener("click", () => goTo(index + 1));

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") goTo(index + 1);
    if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   goTo(index - 1);
  });

  // In-page anchor links jump to the correct page
  document.querySelectorAll('a[href^="#"], button[data-chp-goto]').forEach((link) => {
    const targetId = link.getAttribute("data-chp-goto") || link.getAttribute("href").slice(1);
    link.addEventListener("click", (event) => {
      const targetEl = document.getElementById(targetId);
      if (!targetEl) return;
      const pageIndex = pageDivs.findIndex((div) => div.contains(targetEl));
      if (pageIndex === -1) return;
      event.preventDefault();
      goTo(pageIndex);
    });
  });

  return { goTo, pageCount: pageDivs.length };
}
