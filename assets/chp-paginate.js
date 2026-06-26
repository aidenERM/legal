/*
 * Shared "liquid glass" smooth pagination for the legal pages. Splits a
 * container into pages at each element matching `breakSelector`, then shows
 * one page at a time with a fixed glass dock (Prev / page count / Next) and
 * a fade+slide transition between pages. Works the same way for ToS, the
 * Privacy Policy, and the changelog - only the break selector differs.
 *
 * Deliberately DOM-based (group existing elements into pages at runtime)
 * rather than requiring the HTML to be hand-restructured into <section>
 * blocks - far less risk of accidentally altering the legal text while
 * adding pagination.
 */
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

  // Wrap each page's elements in a .chp-page div, in place.
  const pageDivs = pages.map((page) => {
    const div = document.createElement("div");
    div.className = "chp-page chp-glass";
    page.els.forEach((el) => div.appendChild(el));
    container.appendChild(div);
    return div;
  });

  const dock = document.createElement("div");
  dock.className = "chp-dock";
  dock.innerHTML = `
    <button type="button" class="chp-dock-prev" aria-label="Previous page">&#8249;</button>
    <span class="chp-dock-label"></span>
    <button type="button" class="chp-dock-next" aria-label="Next page">&#8250;</button>
  `;
  document.body.appendChild(dock);

  const label = dock.querySelector(".chp-dock-label");
  const prevBtn = dock.querySelector(".chp-dock-prev");
  const nextBtn = dock.querySelector(".chp-dock-next");

  let index = 0;

  function render() {
    pageDivs.forEach((div, i) => div.classList.toggle("is-active", i === index));
    label.textContent = `${index + 1} / ${pageDivs.length}`;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === pageDivs.length - 1;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goTo(i) {
    index = Math.max(0, Math.min(pageDivs.length - 1, i));
    render();
  }

  prevBtn.addEventListener("click", () => goTo(index - 1));
  nextBtn.addEventListener("click", () => goTo(index + 1));

  // Any in-page link that targets an element now living inside a page
  // (e.g. the table-of-contents anchors) jumps straight to that page
  // instead of doing a normal same-document scroll.
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

  render();
  return { goTo, pageCount: pageDivs.length };
}
