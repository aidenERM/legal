const WORKER_URL = "https://chp-dashboard-api.aidenspearb.workers.dev";

// ── Session token (mobile third-party-cookie workaround) ────────────────
// iOS/Android block the chp_session cookie on cross-site fetch() calls from
// github.io to workers.dev, even though the cookie is set fine by the
// top-level OAuth redirect - so index.html's auth/callback redirect also
// hands the token over in the URL fragment (never sent to any server) and
// it's stashed here in localStorage, then attached as an Authorization
// header to every WORKER_URL fetch below. This works identically on every
// browser since header auth isn't subject to third-party cookie rules.
const SESSION_TOKEN_KEY = "chp_session_token";
(function bootstrapSessionToken() {
  const hash = window.location.hash;
  if (hash && hash.startsWith("#session=")) {
    localStorage.setItem(SESSION_TOKEN_KEY, decodeURIComponent(hash.slice("#session=".length)));
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
})();

const _nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input && input.url;
  if (url && url.startsWith(WORKER_URL)) {
    const token = localStorage.getItem(SESSION_TOKEN_KEY);
    if (token) {
      init = init ? { ...init } : {};
      init.headers = { ...(init.headers || {}), Authorization: `Bearer ${token}` };
    }
  }
  return _nativeFetch(input, init);
};

// ── Rotating community banners ──────────────────────────────────────────
// Community-submitted photos, hand-picked by the developer from the
// official-media Discord channel (credited photographer(s) shown in the
// corner). One shared manifest (assets/banners/manifest.json) drives every
// banner slot on the page - each slot gets its own independently-shuffled,
// independently-timed rotation (30s per image) so multiple banners on
// screen at once don't all flip in lockstep. Static content (developer adds
// entries to manifest.json as new photos are chosen), so no backend/API
// call is needed here beyond fetching that one JSON file.
const BANNERS_ENABLED_KEY = "chp_banners_enabled";
function bannersEnabled() {
  return localStorage.getItem(BANNERS_ENABLED_KEY) !== "false"; // default on
}

let _dashboardBannerManifestPromise = null;
function _loadBannerManifest() {
  if (!_dashboardBannerManifestPromise) {
    _dashboardBannerManifestPromise = fetch("assets/banners/manifest.json")
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  }
  return _dashboardBannerManifestPromise;
}

function _shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Which .dashboard-banner--* shape bucket an entry's real aspect ratio
// falls into (see the CSS comment above .dashboard-banner in app.css for
// the reasoning/thresholds - kept in sync with index.html's login-page
// twin of this function). Falls back to "standard" if width/height are
// missing from an older manifest entry rather than guessing further.
const BANNER_SHAPE_CLASSES = ["dashboard-banner--compact", "dashboard-banner--standard", "dashboard-banner--wide"];
function _bannerShapeClass(entry) {
  const w = entry && entry.width, h = entry && entry.height;
  if (!w || !h) return "dashboard-banner--standard";
  const ratio = w / h;
  if (ratio < 1.9) return "dashboard-banner--compact";
  if (ratio < 2.3) return "dashboard-banner--standard";
  return "dashboard-banner--wide";
}

async function initDashboardBanner(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!bannersEnabled()) {
    container.hidden = true;
    return;
  }
  const entries = await _loadBannerManifest();
  if (!entries || entries.length === 0) return;

  const order = _shuffle(entries);
  let index = 0;

  const imgA = document.createElement("img");
  const imgB = document.createElement("img");
  const credit = document.createElement("div");
  credit.className = "dashboard-banner-credit";
  container.append(imgA, imgB, credit);
  let showingA = true;

  const show = (entry) => {
    const incoming = showingA ? imgB : imgA;
    const outgoing = showingA ? imgA : imgB;
    // Bug fix: onload was attached AFTER setting .src. For an image already
    // in the browser's HTTP cache (very likely here, since multiple banner
    // slots on the page pull from the same shared image set), the load can
    // resolve before the handler is attached, so the "reveal" class never
    // gets added and that image stays invisible (opacity: 0) forever - the
    // banner looked "transparent"/empty even though the fetch succeeded.
    // Attaching onload first guarantees it can't be missed either way.
    incoming.onload = () => {
      incoming.classList.add("dashboard-banner-visible");
      outgoing.classList.remove("dashboard-banner-visible");
    };
    incoming.alt = "";
    incoming.src = `assets/banners/${entry.file}`;
    credit.innerHTML = `Credits: <strong>${entry.credits}</strong>`;
    // Shape bucket snaps immediately (no animated transition - see the
    // .dashboard-banner comment in app.css for why), so it doesn't matter
    // whether this runs now or in onload; done here to keep it next to the
    // rest of this entry's per-swap bookkeeping.
    container.classList.remove(...BANNER_SHAPE_CLASSES);
    container.classList.add(_bannerShapeClass(entry));
    showingA = !showingA;
  };

  show(order[index]);
  setInterval(() => {
    index = (index + 1) % order.length;
    show(order[index]);
  }, 30000);
}

// ── Liquid Glass pointer tracking (item 7) ──────────────────────────────
// Generalized version of the mouse-tracked specular highlight that used to
// live only in index.html's .login-card script. Moves --mx/--my custom
// properties on `el` so the `.liquid-glass` CSS highlight (app.css) follows
// the pointer, with a short debounce that drops `will-change: transform`
// again once the pointer stops moving (never left on permanently) and two
// escape hatches: prefers-reduced-motion, and a manual localStorage opt-out
// (Personal Settings > Appearance > "Reduce visual effects").
const GLASS_REDUCE_KEY = "chp_reduce_effects";

function glassEffectsDisabled() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  return localStorage.getItem(GLASS_REDUCE_KEY) === "true";
}

function attachGlassPointerTracking(el) {
  if (!el || el._glassTrackingAttached) return;
  if (glassEffectsDisabled()) return;
  el._glassTrackingAttached = true;

  let rafId = null;
  let willChangeTimeout = null;

  el.addEventListener("pointermove", (e) => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${((e.clientX - rect.left) / rect.width) * 100}%`);
      el.style.setProperty("--my", `${((e.clientY - rect.top) / rect.height) * 100}%`);
    });
    el.classList.add("glass-tracking");
    clearTimeout(willChangeTimeout);
    willChangeTimeout = setTimeout(() => el.classList.remove("glass-tracking"), 200);
  });

  el.addEventListener("mouseleave", () => {
    clearTimeout(willChangeTimeout);
    el.classList.remove("glass-tracking");
  });
}

// Apple-style overlay scrollbars: the CSS (.is-scrolling rules) hides the
// thumb at rest and only shows it during/just-after an actual scroll, same
// behavior as macOS/iOS "only appear while scrolling" scrollbars. This just
// toggles that class on scroll with a short hide-again timeout.
function attachAutoHideScrollbar(el) {
  if (!el || el._autoHideScrollbarAttached) return;
  el._autoHideScrollbarAttached = true;
  let hideTimeout = null;
  el.addEventListener(
    "scroll",
    () => {
      el.classList.add("is-scrolling");
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => el.classList.remove("is-scrolling"), 900);
    },
    { passive: true }
  );
}
["content", "sidebarNavScroll"].forEach((id) => attachAutoHideScrollbar(document.getElementById(id)));
document
  .querySelectorAll(".content, .sidebar-nav-scroll, .ai-messages, .sidebar-float-panel, .notif-dropdown-panel, .on-duty-list")
  .forEach(attachAutoHideScrollbar);

attachGlassPointerTracking(document.getElementById("sidebar"));

// ── Command palette (Cmd/Ctrl+K) ─────────────────────────────────────────
// Claude-style centered overlay: one input, fuzzy-filtered results below it,
// arrow keys + Enter to navigate, Esc/backdrop-click to close. Static index
// of pages + hub sub-tabs + a few common actions, filtered client-side -
// no API round trip, so results update on every keystroke with no debounce
// needed.
function initCommandPalette() {
  const backdrop = document.getElementById("cmdkBackdrop");
  const panel = document.getElementById("cmdkPanel");
  const input = document.getElementById("cmdkInput");
  const resultsEl = document.getElementById("cmdkResults");
  if (!backdrop || !input || !resultsEl) return;

  const ICONS = {
    page: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>`,
    tab: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`,
    action: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z"/></svg>`,
  };

  // Recent selections, most-recent first, capped - surfaced before you type
  // anything so the palette isn't a blank slate on open.
  const RECENT_KEY = "chp_cmdk_recent";
  function getRecent() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    } catch {
      return [];
    }
  }
  function pushRecent(id) {
    const recent = getRecent().filter((r) => r !== id);
    recent.unshift(id);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 5)));
  }

  function goToSection(section, hubTab) {
    const navItem = document.querySelector(`.nav-item[data-section="${section}"]`);
    if (navItem) navItem.click();
    if (hubTab) {
      // Hub sub-tab buttons (data-hub-tab) live inside the panel regardless
      // of the panel's own crossfade transition, so this can fire in the
      // same tick as the nav click above - no need to wait for showPanel's
      // transition to finish.
      const tabBtn = document.querySelector(`[data-hub-tab="${hubTab}"]`);
      if (tabBtn) tabBtn.click();
    }
  }

  const items = [
    { id: "shift-management", group: "Pages", icon: "page", label: "Shift Management", run: () => goToSection("shift-management") },
    { id: "leaderboard", group: "Pages", icon: "page", label: "Leaderboard", run: () => goToSection("leaderboard", "rankings") },
    { id: "recognized-officers", group: "Pages", icon: "tab", label: "Recognized Officers", sub: "Leaderboard", run: () => goToSection("leaderboard", "recognized") },
    { id: "department-feed", group: "Pages", icon: "tab", label: "Department Feed", sub: "Leaderboard", run: () => goToSection("leaderboard", "feed") },
    { id: "loa", group: "Pages", icon: "page", label: "Leave of Absence", sub: "Leave & RA", run: () => goToSection("loa-ra", "loa") },
    { id: "ra", group: "Pages", icon: "tab", label: "RA Program", sub: "Leave & RA", run: () => goToSection("loa-ra", "ra") },
    { id: "history", group: "Pages", icon: "page", label: "History", run: () => goToSection("history") },
    { id: "profile", group: "Pages", icon: "page", label: "Profile", run: () => goToSection("profile") },
    { id: "settings", group: "Pages", icon: "page", label: "Personal Settings", run: () => goToSection("settings") },
    { id: "contact", group: "Pages", icon: "page", label: "Contact", sub: "Contact & Feedback", run: () => goToSection("contact", "contact") },
    { id: "anonymous-feedback", group: "Pages", icon: "tab", label: "Anonymous Feedback", sub: "Contact & Feedback", run: () => goToSection("contact", "anonymous") },
    {
      id: "toggle-theme", group: "Actions", icon: "action", label: "Toggle Light / Dark Mode",
      run: () => document.getElementById("sidebarThemeToggleBtn")?.click(),
    },
    {
      id: "open-ai", group: "Actions", icon: "action", label: "Open AI Assistant",
      run: () => document.getElementById("aiFab")?.click(),
    },
    {
      id: "switch-accounts", group: "Actions", icon: "action", label: "Switch Accounts",
      run: () => document.getElementById("sidebarSwitchAccountsBtn")?.click(),
    },
    {
      id: "log-out", group: "Actions", icon: "action", label: "Log Out",
      run: () => document.getElementById("sidebarLogoutBtn")?.click(),
    },
  ];

  let activeIndex = 0;
  let visible = [];

  function render(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      const recentIds = getRecent();
      const recentItems = recentIds.map((id) => items.find((i) => i.id === id)).filter(Boolean);
      visible = recentItems.length ? recentItems : items.slice(0, 8);
      renderGroups(recentItems.length ? [["Recent", recentItems]] : groupBy(visible));
      return;
    }
    // Simple substring match across label + sub + group - not true fuzzy
    // matching, but fast and predictable for a ~15-item static index.
    visible = items.filter(
      (i) => i.label.toLowerCase().includes(q) || (i.sub && i.sub.toLowerCase().includes(q)) || i.group.toLowerCase().includes(q)
    );
    renderGroups(groupBy(visible));
  }

  function groupBy(list) {
    const groups = [];
    for (const item of list) {
      let g = groups.find(([name]) => name === item.group);
      if (!g) {
        g = [item.group, []];
        groups.push(g);
      }
      g[1].push(item);
    }
    return groups;
  }

  function renderGroups(groups) {
    activeIndex = 0;
    if (visible.length === 0) {
      resultsEl.innerHTML = `<div class="cmdk-empty">No matches</div>`;
      return;
    }
    let html = "";
    let flatIndex = 0;
    for (const [groupName, groupItems] of groups) {
      html += `<div class="cmdk-group-label">${groupName}</div>`;
      for (const item of groupItems) {
        html += `
          <button class="cmdk-item${flatIndex === 0 ? " active" : ""}" type="button" data-cmdk-index="${flatIndex}">
            <span class="cmdk-item-icon">${ICONS[item.icon] || ICONS.page}</span>
            <span>${item.label}</span>
            ${item.sub ? `<span class="cmdk-item-sub">${item.sub}</span>` : ""}
          </button>
        `;
        flatIndex++;
      }
    }
    resultsEl.innerHTML = html;
  }

  function setActive(index) {
    if (visible.length === 0) return;
    activeIndex = (index + visible.length) % visible.length;
    resultsEl.querySelectorAll(".cmdk-item").forEach((el, i) => {
      el.classList.toggle("active", i === activeIndex);
    });
    resultsEl.querySelector(".cmdk-item.active")?.scrollIntoView({ block: "nearest" });
  }

  function selectActive() {
    const item = visible[activeIndex];
    if (!item) return;
    pushRecent(item.id);
    close();
    item.run();
  }

  let isOpen = false;
  function open() {
    if (isOpen) return;
    isOpen = true;
    backdrop.hidden = false;
    backdrop.classList.remove("closing");
    input.value = "";
    render("");
    // Re-trigger the CSS entrance animations (they run via `animation`, not
    // `transition`, so simply un-hiding isn't enough after the first open -
    // forcing a reflow lets the animation replay every time).
    void panel.offsetWidth;
    input.focus();
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    backdrop.classList.add("closing");
    window.setTimeout(() => {
      backdrop.hidden = true;
      backdrop.classList.remove("closing");
    }, 160);
  }

  document.addEventListener("keydown", (e) => {
    const isK = e.key === "k" || e.key === "K";
    if ((e.ctrlKey || e.metaKey) && isK) {
      e.preventDefault();
      isOpen ? close() : open();
      return;
    }
    if (!isOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(activeIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(activeIndex - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectActive();
    }
  });

  input.addEventListener("input", () => render(input.value));
  resultsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cmdk-index]");
    if (!btn) return;
    activeIndex = Number(btn.dataset.cmdkIndex);
    selectActive();
  });
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  document.getElementById("sidebarCmdkTrigger")?.addEventListener("click", open);

  attachAutoHideScrollbar(resultsEl);
}
initCommandPalette();

// ── Collapsed-sidebar flyout submenu ─────────────────────────────────────
// Hovering a rail icon (desktop collapsed mode) shows that category's real
// nav-items as a floating flyout instead of forcing a full sidebar
// re-expand just to pick a page. Reparents the actual .nav-category-items
// node to <body> (reusing its real buttons/click handlers - no separate
// flyout markup to keep in sync) and puts it back where it came from on
// mouseleave. Delegated on #sidebarIconRail itself (not individual
// buttons) since refreshSidebarCategories rebuilds the rail's innerHTML
// on every tier/category change - a listener on the container survives
// that; one on the buttons wouldn't.
function initSidebarFlyout() {
  const rail = document.getElementById("sidebarIconRail");
  const shell = document.getElementById("shell");
  if (!rail || !shell) return;

  let closeTimeout = null;
  let activeItems = null;
  let activeParent = null;
  let activeNextSibling = null;

  function closeFlyout() {
    clearTimeout(closeTimeout);
    if (activeItems && activeParent) {
      activeItems.classList.remove("nav-flyout");
      activeItems.style.top = "";
      activeItems.style.left = "";
      activeParent.insertBefore(activeItems, activeNextSibling);
    }
    activeItems = null;
    activeParent = null;
    activeNextSibling = null;
  }

  function scheduleClose() {
    clearTimeout(closeTimeout);
    closeTimeout = window.setTimeout(closeFlyout, 200);
  }

  rail.addEventListener("mouseover", (e) => {
    if (!shell.classList.contains("collapsed")) return;
    const btn = e.target.closest(".rail-icon-btn");
    if (!btn) return;
    const group = document.querySelector(`.nav-group[data-category="${btn.dataset.category}"]`);
    const items = group?.querySelector(".nav-category-items");
    if (!items || items === activeItems) {
      clearTimeout(closeTimeout);
      return;
    }
    closeFlyout();
    activeParent = items.parentElement;
    activeNextSibling = items.nextSibling;
    const rect = btn.getBoundingClientRect();
    items.classList.add("nav-flyout");
    items.style.top = `${Math.round(rect.top)}px`;
    items.style.left = `${Math.round(rect.right + 8)}px`;
    document.body.appendChild(items);
    activeItems = items;
  });

  rail.addEventListener("mouseleave", scheduleClose);

  document.addEventListener("mouseover", (e) => {
    if (!activeItems) return;
    if (activeItems.contains(e.target) || rail.contains(e.target)) {
      clearTimeout(closeTimeout);
    } else {
      scheduleClose();
    }
  });

  // Clicking a nav-item inside the flyout navigates away - close it
  // immediately rather than leaving it floating over the new page.
  document.addEventListener("click", (e) => {
    if (activeItems && activeItems.contains(e.target)) closeFlyout();
  });
}
initSidebarFlyout();

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatHms(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

// Guild nicknames follow "HP-XXX | XX | Username" (callsign | rank code | name) -
// the display name is whatever comes after the last "|". Falls back to the
// Discord username if the member has no guild nickname set.
function displayNameFor(me) {
  if (!me.nick) return me.username;
  const parts = me.nick.split("|");
  const last = parts[parts.length - 1].trim();
  return last || me.username;
}

function avatarUrlFor(userId, avatarHash, size) {
  return avatarHash
    ? `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=${size}`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;
}

async function apiGet(path) {
  const response = await fetch(`${WORKER_URL}${path}`, { credentials: "include" });
  if (response.status === 401) {
    window.location.href = "index.html";
    return null;
  }
  if (!response.ok) return null;
  return response.json();
}

async function apiPost(path, body) {
  const response = await fetch(`${WORKER_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (response.status === 401) {
    window.location.href = "index.html";
    return null;
  }
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

// ── Undo toast (item 1): small reusable bottom-of-screen snackbar shown
// after a non-destructive self-service action succeeds. If `undoFn` is
// passed, an "Undo" button is shown that calls it; otherwise it's a plain
// auto-dismissing confirmation toast. Only one toast is shown at a time.
let activeUndoToastEl = null;
function showUndoToast(message, undoFn) {
  if (activeUndoToastEl) activeUndoToastEl.remove();
  const toast = document.createElement("div");
  toast.className = "undo-toast liquid-glass";
  toast.innerHTML = `
    <span class="undo-toast-msg">${message}</span>
    ${undoFn ? `<button class="undo-toast-btn" type="button">Undo</button>` : ""}
    <button class="undo-toast-close" type="button" aria-label="Dismiss">&times;</button>
  `;
  document.body.appendChild(toast);
  activeUndoToastEl = toast;

  const dismiss = () => {
    if (activeUndoToastEl === toast) activeUndoToastEl = null;
    toast.remove();
  };
  const timer = setTimeout(dismiss, 5000);
  toast.querySelector(".undo-toast-close").addEventListener("click", () => {
    clearTimeout(timer);
    dismiss();
  });
  if (undoFn) {
    toast.querySelector(".undo-toast-btn").addEventListener("click", () => {
      clearTimeout(timer);
      dismiss();
      undoFn();
    });
  }
}

// ── Confirm-action modal (item 2): one small reusable centered modal used
// in front of every write action that previously fired immediately (or used
// the ad-hoc click-twice pattern). Styled with the existing .liquid-glass
// surface + button classes rather than new heavy CSS.
function confirmAction(message, onConfirm) {
  const existing = document.getElementById("confirmActionOverlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "confirm-action-overlay";
  overlay.id = "confirmActionOverlay";
  overlay.innerHTML = `
    <div class="confirm-action-modal liquid-glass">
      <p class="confirm-action-message">${message}</p>
      <div class="confirm-action-buttons">
        <button class="confirm-action-cancel" type="button">Cancel</button>
        <button class="confirm-action-confirm" type="button">Confirm</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".confirm-action-cancel").addEventListener("click", close);
  overlay.querySelector(".confirm-action-confirm").addEventListener("click", () => {
    close();
    onConfirm();
  });
}

async function apiDelete(path, body) {
  const response = await fetch(`${WORKER_URL}${path}`, {
    method: "DELETE",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (response.status === 401) {
    window.location.href = "index.html";
    return null;
  }
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

const TIER_BADGE_COPY = {
  staff: "CHP Patrol Operations",
  admin: "CHP Human Resources & Command",
  management: "Board of Commissioners",
  developer: "Developer Access",
};

// Shared tier-rank helper (Bug 4 fix): every place in this file that needs to
// know "does this viewer's tier meet-or-exceed some required tier" should go
// through this, instead of ad-hoc `tier === "admin"` checks that don't treat
// "developer" as satisfying every lower tier's gate. `tester` is a parallel
// flag (see loadBoc's confidential-panel check) and deliberately NOT part of
// this ordering - it doesn't rank above or below any tier.
const TIER_ORDER = ["staff", "admin", "command-team", "management", "developer"];
function tierAtLeast(userTier, requiredTier) {
  const userRank = TIER_ORDER.indexOf(userTier);
  const requiredRank = TIER_ORDER.indexOf(requiredTier);
  if (userRank === -1 || requiredRank === -1) return false;
  return userRank >= requiredRank;
}

function formatDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function renderHistoryEntries(entries) {
  if (!entries.length) {
    return `<li class="empty-state">No history entries yet.</li>`;
  }
  return entries
    .map(
      (entry) => `
        <li class="history-row">
          <span class="history-desc">${entry.description}</span>
          <span class="history-date">${formatDate(entry.timestamp)}</span>
        </li>
      `
    )
    .join("");
}

// Buckets flat /api/history entries by the bot-supplied "category" field
// ("promotion" | "infraction" | "other") - anything unrecognized falls back
// to "other" so nothing silently disappears if a category is ever missing.
function categorizeHistoryEntries(entries) {
  const buckets = { promotion: [], infraction: [], other: [] };
  (entries || []).forEach((entry) => {
    const cat = buckets[entry.category] ? entry.category : "other";
    buckets[cat].push(entry);
  });
  return buckets;
}

// Builds a dev-tabs/dev-panel tab switcher (same classes/markup pattern as
// FTO/IA Tools) for history sub-tabs. When includeShifts is true, an extra
// leading "Shifts" tab is rendered from shiftsHtml (already-fetched shift
// summary markup) alongside the 3 category tabs derived from /api/history.
function renderHistoryTabsHtml(idPrefix, buckets, includeShifts, shiftsHtml) {
  const tabs = [];
  if (includeShifts) tabs.push(["shifts", "Shifts"]);
  tabs.push(["promotion", "Promotions"], ["infraction", "Infractions"], ["other", "Other"]);
  const tabsHtml = tabs
    .map(([key, label], i) => `<button class="dev-tab${i === 0 ? " active" : ""}" data-history-subtab="${key}">${label}</button>`)
    .join("");
  const panelsHtml = tabs
    .map(([key], i) => {
      const inner = key === "shifts" ? shiftsHtml || "" : `<ol class="history-list" style="margin: 0;">${renderHistoryEntries(buckets[key])}</ol>`;
      return `<div class="dev-panel${i === 0 ? " active" : ""}" id="${idPrefix}Panel-${key}">${inner}</div>`;
    })
    .join("");
  return `<div class="dev-tabs liquid-glass" id="${idPrefix}Tabs">${tabsHtml}</div>${panelsHtml}`;
}

// Generic tab switcher for the merged "hub" panels (Leaderboard/Recognized
// Officers/Department Feed, Leave of Absence/RA, Contact/Anonymous Feedback)
// - static markup (unlike renderHistoryTabsHtml's dynamically-built tabs), so
// this just wires the delegated click once at boot. `tabsId`'s element must
// carry data-panel-prefix matching its sibling `.dev-panel` ids
// (`${prefix}-${tab.dataset.hubTab}`).
function wireHubTabs(tabsId) {
  const tabsEl = document.getElementById(tabsId);
  if (!tabsEl) return;
  const prefix = tabsEl.dataset.panelPrefix;
  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-hub-tab]");
    if (!btn) return;
    tabsEl.querySelectorAll("[data-hub-tab]").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(`[id^="${prefix}-"]`).forEach((panel) => {
      panel.classList.toggle("active", panel.id === `${prefix}-${btn.dataset.hubTab}`);
    });
  });
}
["loaRaHubTabs", "contactHubTabs", "leaderboardHubTabs", "loaRaMgmtHubTabs"].forEach(wireHubTabs);

// Wires click delegation for a renderHistoryTabsHtml()-produced tab group.
// Must be (re-)called after every innerHTML replacement since the buttons
// are freshly created DOM nodes each time.
function wireHistorySubTabs(idPrefix) {
  document.getElementById(`${idPrefix}Tabs`)?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-history-subtab]");
    if (!btn) return;
    document.querySelectorAll(`#${idPrefix}Tabs [data-history-subtab]`).forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(`[id^="${idPrefix}Panel-"]`).forEach((panel) => {
      panel.classList.toggle("active", panel.id === `${idPrefix}Panel-${btn.dataset.historySubtab}`);
    });
  });
}

function renderShiftsSummaryHtml(shifts) {
  if (shifts.byType.length === 0) {
    return `<div class="empty-state">No completed shifts logged yet.</div>`;
  }
  const maxSeconds = Math.max(...shifts.byType.map((row) => row.seconds));
  const typeRows = shifts.byType
    .map((row) => {
      const pct = maxSeconds > 0 ? Math.round((row.seconds / maxSeconds) * 100) : 0;
      return `
        <div class="shifts-type-row">
          <span class="shifts-type-name">${row.type}</span>
          <span class="shifts-type-bar-track"><span class="shifts-type-bar-fill" style="--bar-pct: ${pct}%"></span></span>
          <span class="shifts-type-time">${formatDuration(row.seconds)}</span>
        </div>
      `;
    })
    .join("");

  return `
    <div class="shifts-summary">
      <div class="shifts-summary-stat">
        <div class="label">Total duty time</div>
        <div class="value">${formatDuration(shifts.totalSeconds)}</div>
      </div>
      <div class="shifts-summary-divider"></div>
      <div class="shifts-summary-stat">
        <div class="label">Shifts logged</div>
        <div class="value">${shifts.shiftCount}</div>
      </div>
    </div>

    <div>
      <p class="shifts-type-heading">By shift type</p>
      <div class="shifts-type-list">${typeRows}</div>
    </div>
  `;
}

// Crossfades between panels instead of the old instant class-swap (which cut
// the outgoing panel away with no transition at all, only ever animating the
// incoming one). Guarded by a token so a rapid second nav click cancels the
// in-flight leave animation cleanly rather than fighting over which panel
// ends up "active".
let _panelTransitionToken = 0;
function showPanel(section) {
  const next = document.getElementById(`panel-${section}`);
  if (!next) return;
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.section === section);
  });

  const current = document.querySelector(".panel.active");
  const token = ++_panelTransitionToken;
  const reduceMotion = document.body.classList.contains("reduce-motion");

  if (!current || current === next || reduceMotion) {
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active", "leaving"));
    next.classList.add("active");
    return;
  }

  current.classList.add("leaving");
  current.classList.remove("active");
  window.setTimeout(() => {
    if (token !== _panelTransitionToken) return; // superseded by a newer nav click
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active", "leaving"));
    next.classList.add("active");
  }, 160);
}

let currentMe = null;

function showAccessRestrictedScreen() {
  document.getElementById("shell").innerHTML = `
    <div class="access-restricted-screen">
      <h1>Dashboard Access Restricted</h1>
      <p>A developer has temporarily limited who can access the CHP Dashboard right now.
      Your current access tier isn't included. Check back later, or contact a developer if
      you believe this is a mistake.</p>
    </div>
  `;
}

// Shared icon set for every dynamically-generated nav-item (admin/command-
// team/BOC/developer/FTO/IA groups) - the static Dashboard group's items
// have their icons hand-written in app.html, but everything built here in
// JS previously rendered as plain text with no icon at all. One shared map
// keyed by concept instead of hand-writing SVG markup at each of the ~20
// call sites below.
const NAV_ICON_PATHS = {
  users: `<circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5"/><circle cx="17" cy="8" r="2.6"/><path d="M16 14.5c2.7.4 5 2.3 5 5.5"/>`,
  calendarCheck: `<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4M9 15l2 2 4-4"/>`,
  cap: `<path d="M22 10L12 4 2 10l10 6 10-6z"/><path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>`,
  exchange: `<path d="M7 3l4 4-4 4"/><path d="M3 7h8"/><path d="M17 21l-4-4 4-4"/><path d="M21 17h-8"/>`,
  target: `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.5"/>`,
  clipboardCheck: `<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2"/><path d="M9 12l2 2 4-4"/>`,
  eye: `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>`,
  trophy: `<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4z"/><path d="M7 5H4a3 3 0 003 3M17 5h3a3 3 0 01-3 3"/>`,
  calendarClock: `<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/><circle cx="15.5" cy="15.5" r="3.5"/><path d="M15.5 14v1.5l1 1"/>`,
  inbox: `<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.4 5h13.2L22 12v7a2 2 0 01-2 2H4a2 2 0 01-2-2v-7L5.4 5z"/>`,
  userX: `<circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.3 3.1-5.5 7-5.5.9 0 1.7.13 2.5.37"/><path d="M17 9l4 4M21 9l-4 4"/>`,
  scroll: `<path d="M8 3h11a2 2 0 012 2v3H10"/><path d="M8 3a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2v-3"/><path d="M4 8a2 2 0 012-2v14a2 2 0 01-2-2z"/>`,
  mail: `<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 6 10-6"/>`,
  megaphone: `<path d="M3 11v2a2 2 0 002 2h1l3 5h2l-1-5h4l6 4V6l-6 4H6a2 2 0 00-2 2z"/>`,
  barChart: `<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>`,
  gear: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  code: `<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l2.1-2.1a4 4 0 01-5.3 5.3l-6.4 6.4a2 2 0 01-2.8-2.8l6.4-6.4a4 4 0 015.3-5.3l-2.1 2.1z"/>`,
  shield: `<path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z"/>`,
};
function navIconSvg(key) {
  const path = NAV_ICON_PATHS[key];
  if (!path) return "";
  return `<svg class="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

// Fetched once at boot so both the sidebar (admin/management/developer group)
// and the Profile panel can use it without re-fetching /api/me repeatedly.
async function bootMe() {
  // Raw fetch (not apiGet) so a 403 access_restricted response can be told
  // apart from any other failure and shown its own clear full-page message,
  // instead of apiGet's generic "return null" for any non-401 non-ok status.
  const rawResponse = await fetch(`${WORKER_URL}/api/me`, { credentials: "include" });
  if (rawResponse.status === 403) {
    const body = await rawResponse.json().catch(() => null);
    if (body?.reason === "access_restricted") {
      showAccessRestrictedScreen();
      return null;
    }
  }
  const me = await apiGet("/api/me");
  if (!me) return null;
  currentMe = me;
  buildSidebarFooter(me);

  // Bug 4 fix: previously this built ONE shared nav-group whose header label
  // was picked from the VIEWER's own tier (`developer` -> header "Developer"),
  // so a developer saw the High Ranks + Board of Commissioners items real
  // enough, but both ended up crammed under a single "Developer"-labeled
  // group indistinguishable from the actual Developer Tools group below -
  // it looked like "High Ranks" and "Board of Commissioners" didn't exist.
  // Fix: build each tier's group under its own fixed label, gated by
  // tierAtLeast so "developer" (which is >= every other tier) always gets
  // every group, each correctly named.
  if (tierAtLeast(me.tier, "admin")) {
    const sidebar = document.getElementById("sidebarNavScroll");
    const group = document.createElement("div");
    group.className = "nav-group";
    group.dataset.category = "high-ranks";
    group.innerHTML = `
      <button class="nav-category-header" type="button" data-category="high-ranks" aria-expanded="true">
        <span class="nav-category-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.2-5.4 3.2 1.3-6-4.6-4.1 6.1-.6L12 3z"/></svg>
        </span>
        <span class="nav-category-label">High Ranks</span>
        <svg class="nav-category-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="nav-category-items">
        <button class="nav-item" data-section="lookup">Member Lookup</button>
      </div>
    `;
    sidebar.appendChild(group);
    const itemsWrap = group.querySelector(".nav-category-items");
    const lookupBtn = group.querySelector(".nav-item");
    lookupBtn.addEventListener("click", () => showPanel("lookup"));

    // Phase 4 - High Ranks tier (admin and above): LOA Management,
    // Transfer Requests, RA Oversight, and the Officers roster/action panel.
    // Not confidential-only, so visible to High Ranks and above (not gated
    // further like the BOC group below).
    //
    // Bug 1 fix: Promotion Quota used to live here (admin tier), but the
    // user flagged that "only Board of Commissioners should know stuff
    // about promotion, promotion quota, quota enforcement, etc." - admin
    // ("High Ranks") should NOT see quota data. Moved to the BOC nav group
    // below; the Worker route (routes/promotionQuota.js) was updated to
    // require management+ to match.
    // Cleanup fix: LOA Management/RA Oversight are also listed in the
    // Command Team nav group below, and tierAtLeast is cumulative (admin,
    // command-team, management, developer all pass tierAtLeast(..., "admin")),
    // so anyone command-team+ was seeing these two items twice in the
    // sidebar. Scope them to the admin tier exactly here; Command Team's own
    // group remains the single copy for command-team and above. Officers and
    // Transfer Requests stay visible for every admin+ tier as before.
    const phase4Items = [
      { section: "officers-mgmt", label: "Officers", icon: "users", onOpen: loadOfficersRoster },
      ...(me.tier === "admin"
        ? [
            {
              section: "loa-ra-mgmt",
              label: "Leave & RA Oversight",
              icon: "calendarCheck",
              onOpen: () => {
                loadLoaManagement();
                loadRaOversight();
              },
            },
          ]
        : []),
      { section: "transfers", label: "Transfer Requests", icon: "exchange", onOpen: loadTransfersQueue },
    ];
    phase4Items.forEach(({ section, label, icon, onOpen }) => {
      const btn = document.createElement("button");
      btn.className = "nav-item";
      btn.dataset.section = section;
      btn.innerHTML = `${navIconSvg(icon)}${label}`;
      btn.addEventListener("click", () => {
        showPanel(section);
        onOpen();
      });
      itemsWrap.appendChild(btn);
    });
  }

  // Command Team tier (Chief / Assistant Chief role) - sits between High
  // Ranks (admin) and Board of Commissioners (management). Gets LOA
  // Management + RA Oversight only (same panels/sections as the High Ranks
  // group above, not duplicated) - no Officers roster, no Transfer Requests,
  // no quota/HR per the plan.
  if (tierAtLeast(me.tier, "command-team")) {
    const sidebar = document.getElementById("sidebarNavScroll");
    const group = document.createElement("div");
    group.className = "nav-group";
    group.dataset.category = "command-team";
    group.innerHTML = `
      <button class="nav-category-header" type="button" data-category="command-team" aria-expanded="true">
        <span class="nav-category-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.2-5.4 3.2 1.3-6-4.6-4.1 6.1-.6L12 3z"/></svg>
        </span>
        <span class="nav-category-label">Command Team</span>
        <svg class="nav-category-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="nav-category-items"></div>
    `;
    sidebar.appendChild(group);
    const ctItemsWrap = group.querySelector(".nav-category-items");
    const commandTeamItems = [
      {
        section: "loa-ra-mgmt",
        label: "Leave & RA Oversight",
        icon: "calendarCheck",
        onOpen: () => {
          loadLoaManagement();
          loadRaOversight();
        },
      },
    ];
    commandTeamItems.forEach(({ section, label, icon, onOpen }) => {
      const btn = document.createElement("button");
      btn.className = "nav-item";
      btn.dataset.section = section;
      btn.innerHTML = `${navIconSvg(icon)}${label}`;
      btn.addEventListener("click", () => {
        showPanel(section);
        onOpen();
      });
      ctItemsWrap.appendChild(btn);
    });
  }

  // Phase 5 - Board of Commissioners tier: management and above (developer
  // included, since developer must be treated as >= every tier). Gets its
  // own group with its own header, distinct from the High Ranks group above.
  if (tierAtLeast(me.tier, "management")) {
    const sidebar = document.getElementById("sidebarNavScroll");
    const group = document.createElement("div");
    group.className = "nav-group";
    group.dataset.category = "boc";
    group.innerHTML = `
      <button class="nav-category-header" type="button" data-category="boc" aria-expanded="true">
        <span class="nav-category-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l5 5M4 14l5-5 5 5-5 5-5-5z"/><path d="M14 10l6-6M18 6l2 2"/><path d="M4 19h6"/></svg>
        </span>
        <span class="nav-category-label">Board of Commissioners</span>
        <span class="nav-badge" id="bocPendingBadge" hidden></span>
        <svg class="nav-category-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="nav-category-items"></div>
    `;
    sidebar.appendChild(group);
    const bocItemsWrap = group.querySelector(".nav-category-items");

    // Bug report: "the board of commissioners tab doesn't show like all the
    // subcategories" - panel-boc has always had all 8 sub-views wired as an
    // internal tab bar (#bocTabs), but the sidebar only ever exposed a single
    // generic "Board of Commissioners" nav item, so unless someone happened
    // to notice the in-panel tab strip after clicking in, the other 7
    // sections were effectively invisible. Give each sub-view its own
    // sidebar entry (same pattern already used for Promotion Quota below),
    // wired via bocSwitchToTab so nav-click and tab-click stay in sync.
    // Grouped into the same 3 clusters the in-panel #bocTabs strip already
    // uses (user request: 13 flat sidebar items read as clutter even though
    // the underlying panels are each distinct bot-integrated data/actions
    // that aren't safe to merge together - grouping the navigation instead
    // of the content gets the minimalism win without touching working
    // load/action logic).
    const bocSubGroups = [
      {
        label: "Personnel & Oversight",
        items: [
          { tab: "quota-enforcement", label: "Quota Enforcement", icon: "target" },
          { section: "promotion-quota", label: "Promotion Quota", icon: "target", onOpen: loadPromotionQuota },
          { tab: "hr-review", label: "HR Promotion Review", icon: "clipboardCheck" },
          { tab: "hr-oversight", label: "HR Oversight", icon: "eye" },
          { tab: "applications", label: "Applications", icon: "inbox" },
          { tab: "watch-list", label: "Watch List", icon: "eye" },
          { tab: "inactive-officers", label: "Inactive Officers", icon: "userX" },
        ],
      },
      {
        label: "Leaderboard & Scheduling",
        items: [
          { tab: "leaderboard-control", label: "Leaderboard Control", icon: "trophy" },
          { tab: "schedules", label: "Scheduled Actions", icon: "calendarClock" },
          { tab: "ra-stats", label: "RA Program Stats", icon: "barChart" },
        ],
      },
      {
        label: "Communications & Admin",
        items: [
          { tab: "dm-officers", label: "DM Officers", icon: "mail" },
          { tab: "announcement", label: "Announcement", icon: "megaphone" },
          { tab: "audit-log", label: "Audit Log", icon: "scroll" },
          { tab: "activity-log", label: "Activity Log", icon: "eye" },
          { tab: "settings", label: "Settings", icon: "gear" },
        ],
      },
    ];
    bocSubGroups.forEach(({ label: groupLabel, items }) => {
      const divider = document.createElement("div");
      divider.className = "nav-subgroup-label";
      divider.textContent = groupLabel;
      bocItemsWrap.appendChild(divider);
      items.forEach(({ tab, section, label, icon, onOpen }) => {
        const btn = document.createElement("button");
        btn.className = "nav-item";
        btn.dataset.section = section || "boc";
        if (tab) btn.dataset.bocNavTab = tab;
        btn.innerHTML = `${navIconSvg(icon)}${label}`;
        btn.addEventListener("click", () => {
          if (tab) {
            showPanel("boc");
            bocSwitchToTab(tab);
          } else {
            showPanel(section);
            onOpen();
          }
        });
        bocItemsWrap.appendChild(btn);
      });
    });

    // Pending-count badge (user request): turns the sidebar into an actual
    // to-do glance for HR instead of something you click into just to find
    // out whether anything needs attention. Applications pending count is
    // already tracked by the existing stats endpoint - reused here rather
    // than adding a new one.
    bocGet("/api/boc/applications/stats").then((res) => {
      const pending = res?.stats?.pending;
      const badge = document.getElementById("bocPendingBadge");
      if (!badge || !pending) return;
      badge.textContent = pending > 99 ? "99+" : String(pending);
      badge.hidden = false;
    });
  }

  // Developer Tools nav item - Developer tier only, per the Phase 6 plan
  // ("this page itself must be visible ONLY to the developer tier").
  if (tierAtLeast(me.tier, "developer")) {
    const sidebar = document.getElementById("sidebarNavScroll");
    const group = document.createElement("div");
    group.className = "nav-group";
    group.dataset.category = "developer";
    group.innerHTML = `
      <button class="nav-category-header" type="button" data-category="developer" aria-expanded="true">
        <span class="nav-category-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l2.1-2.1a4 4 0 01-5.3 5.3l-6.4 6.4a2 2 0 01-2.8-2.8l6.4-6.4a4 4 0 015.3-5.3l-2.1 2.1z"/></svg>
        </span>
        <span class="nav-category-label">Developer</span>
        <svg class="nav-category-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="nav-category-items">
        <button class="nav-item" data-section="developer">${navIconSvg("code")}Developer Tools</button>
      </div>
    `;
    sidebar.appendChild(group);
    const devBtn = group.querySelector(".nav-item");
    devBtn.addEventListener("click", () => {
      showPanel("developer");
      loadDevKillSwitches();
    });
  }

  // FTO Tools / IA Tools - role-based (not tier-based): shown to whoever
  // holds the FTO/IA Discord role, regardless of tier, so these get their
  // own nav groups instead of living inside any tier group above.
  if (me.isFto) {
    const sidebar = document.getElementById("sidebarNavScroll");
    const group = document.createElement("div");
    group.className = "nav-group";
    group.dataset.category = "fto-tools";
    group.innerHTML = `
      <button class="nav-category-header" type="button" data-category="fto-tools" aria-expanded="true">
        <span class="nav-category-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14a4 4 0 100-8 4 4 0 000 8z"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"/></svg>
        </span>
        <span class="nav-category-label">FTO Tools</span>
        <svg class="nav-category-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="nav-category-items">
        <button class="nav-item" data-section="fto-tools">${navIconSvg("users")}FTO Tools</button>
      </div>
    `;
    sidebar.appendChild(group);
    group.querySelector(".nav-item").addEventListener("click", () => {
      showPanel("fto-tools");
      loadFtoTools("host");
    });
  }

  if (me.isIa) {
    const sidebar = document.getElementById("sidebarNavScroll");
    const group = document.createElement("div");
    group.className = "nav-group";
    group.dataset.category = "ia-tools";
    group.innerHTML = `
      <button class="nav-category-header" type="button" data-category="ia-tools" aria-expanded="true">
        <span class="nav-category-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z"/></svg>
        </span>
        <span class="nav-category-label">IA Tools</span>
        <svg class="nav-category-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="nav-category-items">
        <button class="nav-item" data-section="ia-tools">${navIconSvg("shield")}IA Tools</button>
      </div>
    `;
    sidebar.appendChild(group);
    group.querySelector(".nav-item").addEventListener("click", () => {
      showPanel("ia-tools");
      switchIaToolsTab("detect");
    });
  }

  refreshSidebarCategories();
  return me;
}

// Tier 3 #13: renders a small SVG line chart of weekly worked hours from
// /api/lookup/{userId}/weekly-trend's `points` array. Plain inline SVG (no
// charting library) to keep this dependency-free - the dashboard has no
// build step, so pulling in a chart package isn't worth it for one graph.
function renderWeeklyTrendChart(points) {
  if (!points || points.length === 0) {
    return `<div class="empty-state">No shift history yet to chart.</div>`;
  }
  const width = 560;
  const height = 200;
  const padding = 28;
  const hours = points.map((p) => p.totalSeconds / 3600);
  const maxHours = Math.max(...hours, 1);
  const stepX = (width - padding * 2) / Math.max(points.length - 1, 1);

  const coords = hours.map((h, i) => {
    const x = padding + i * stepX;
    const y = height - padding - (h / maxHours) * (height - padding * 2);
    return [x, y];
  });
  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${height - padding} L${padding},${height - padding} Z`;

  const dots = coords
    .map(([x, y], i) => {
      const weekLabel = points[i].weekStart ? new Date(points[i].weekStart * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
      const delay = (0.5 + i * 0.06).toFixed(2);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" class="weekly-trend-dot" style="animation-delay:${delay}s"><title>${weekLabel}: ${hours[i].toFixed(1)}h</title></circle>`;
    })
    .join("");

  // pathLength="1" normalizes the line's length to exactly 1 regardless of
  // its actual on-screen pixel length, so the draw-in animation (CSS below)
  // can use a fixed stroke-dasharray/dashoffset of 1 -> 0 instead of having
  // to compute real SVG path length in JS.
  return `
    <svg viewBox="0 0 ${width} ${height}" class="weekly-trend-svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="weeklyTrendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--chp-gold-bright, #e0bf80)" stop-opacity="0.45"></stop>
          <stop offset="100%" stop-color="var(--chp-gold-bright, #e0bf80)" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <path d="${areaPath}" class="weekly-trend-area" fill="url(#weeklyTrendFill)"></path>
      <path d="${linePath}" class="weekly-trend-line" pathLength="1"></path>
      ${dots}
    </svg>
  `;
}

async function loadWeeklyTrendChart(userId) {
  const skeleton = document.getElementById("weeklyTrendSkeleton");
  const wrap = document.getElementById("weeklyTrendWrap");
  if (!wrap) return;
  const res = await apiGet(`/api/lookup/${encodeURIComponent(userId)}/weekly-trend?weeks=10`);
  if (skeleton) skeleton.hidden = true;
  wrap.hidden = false;
  wrap.innerHTML = res ? renderWeeklyTrendChart(res.points) : `<div class="empty-state">Trend data is unavailable right now.</div>`;
}

async function loadProfile() {
  const me = currentMe || (await bootMe());
  const [shifts, badgesRes] = await Promise.all([apiGet("/api/shifts"), apiGet("/api/profile")]);
  if (!me || !shifts) return;

  document.getElementById("welcomeSkeleton").hidden = true;
  document.getElementById("welcomeAvatar").src = avatarUrlFor(me.userId, me.avatar, 96);
  document.getElementById("welcomeName").textContent = displayNameFor(me);
  document.getElementById("accessBadge").textContent = TIER_BADGE_COPY[me.tier] || me.tier;
  document.getElementById("welcomeHero").hidden = false;

  // Bug fix: this card grid used to lead with an "Access tier" stat card
  // showing the exact same value as the accessBadge pill in welcomeHero
  // directly above it - the same tier rendered twice on screen a few pixels
  // apart read as a visual glitch/duplicate ("shows like a double thing").
  // Dropped the redundant card; the two remaining cards are each unique info.
  document.getElementById("overviewSkeleton").hidden = true;
  const cards = document.getElementById("overviewCards");
  cards.hidden = false;
  cards.innerHTML = `
    <div class="stat-card"><div class="label">Total duty time</div><div class="value">${formatDuration(shifts.totalSeconds)}</div></div>
    <div class="stat-card"><div class="label">Shifts logged</div><div class="value">${shifts.shiftCount}</div></div>
  `;

  document.getElementById("shiftsSkeleton").hidden = true;
  const body = document.getElementById("shiftsBody");
  body.hidden = false;
  body.innerHTML = renderShiftsSummaryHtml(shifts);

  loadWeeklyTrendChart(me.userId);

  document.getElementById("badgesSkeleton").hidden = true;
  const badgesGrid = document.getElementById("badgesGrid");
  badgesGrid.hidden = false;
  if (!badgesRes || badgesRes.ok === false) {
    badgesGrid.innerHTML = `<div class="empty-state">Badge data is unavailable right now.</div>`;
  } else {
    const badges = badgesRes.badges || [];
    const extra = `
      <div class="badge-card badge-card-stat"><span class="badge-icon" aria-hidden="true">🔥</span><span class="badge-label">Streak: ${badgesRes.streak ?? 0} day${badgesRes.streak === 1 ? "" : "s"}</span></div>
      <div class="badge-card badge-card-stat"><span class="badge-icon" aria-hidden="true">📅</span><span class="badge-label">Tenure: ${badgesRes.tenureDays != null ? `${badgesRes.tenureDays}d` : "N/A"}</span></div>
      <div class="badge-card badge-card-stat"><span class="badge-icon" aria-hidden="true">🎖️</span><span class="badge-label">Rank: ${badgesRes.rank || "Unranked"}</span></div>
    `;
    // Bug fix: compute_badges() (bot-side) prefixes every badge with a raw
    // Discord custom-emoji markdown token (e.g. "<:badge_name:123456789>
    // 10 Shifts Logged") for rendering inside Discord embeds - on a web page
    // that markup can't resolve to an image and was showing as ugly literal
    // text instead of a medal/ribbon icon. Strip it and render a real
    // medal-style badge card (icon + label) instead.
    const badgeCards = badges
      .map((b) => (b || "").replace(/^<a?:\w+:\d+>\s*/, "").trim())
      .filter(Boolean)
      .map(
        (label) =>
          `<div class="badge-card badge-card-earned"><span class="badge-icon" aria-hidden="true">🏅</span><span class="badge-label">${label}</span></div>`
      )
      .join("");
    badgesGrid.innerHTML = extra + (badgeCards || `<div class="badge-card empty-state">No badges earned yet.</div>`);
  }
}

async function loadHistory() {
  const [shifts, history] = await Promise.all([apiGet("/api/shifts"), apiGet("/api/history")]);

  document.getElementById("historySkeleton").hidden = true;
  const list = document.getElementById("historyList");
  list.hidden = false;

  if (!history) {
    list.innerHTML = `<div class="empty-state">Failed to load history.</div>`;
    return;
  }

  const buckets = categorizeHistoryEntries(history.entries);
  const shiftsHtml = shifts ? renderShiftsSummaryHtml(shifts) : `<div class="empty-state">Shift data unavailable right now.</div>`;
  list.innerHTML = renderHistoryTabsHtml("history", buckets, true, shiftsHtml);
  wireHistorySubTabs("history");
}

let lookupSelectedUserId = null;

// Live as-you-type search (server-backed, roster-scoped via /member/search).
// Every call gets a fresh sequence number so a slow response for an earlier,
// shorter query (e.g. "f") can never overwrite the results of a newer query
// that already resolved (e.g. "fin") - classic out-of-order-response race
// when someone types faster than the round-trip.
let lookupSearchSeq = 0;

async function performLookupSearch() {
  const input = document.getElementById("lookupSearchInput");
  await runLookupSearch(input.value.trim());
}

async function runLookupSearch(query) {
  const resultsWrap = document.getElementById("lookupResultsWrap");
  document.getElementById("lookupDetailWrap").innerHTML = "";

  const seq = ++lookupSearchSeq;

  if (!query) {
    resultsWrap.innerHTML = "";
    return;
  }

  resultsWrap.innerHTML = `<div class="skeleton" style="height: 60px;"></div>`;

  const res = await apiPost("/api/lookup/search", { query });
  if (seq !== lookupSearchSeq) return; // a newer query already resolved (or superseded this one)

  if (!res || !res.ok) {
    resultsWrap.innerHTML = `<div class="empty-state">Search failed. Try again.</div>`;
    return;
  }
  const results = res.data.results || [];
  if (results.length === 0) {
    resultsWrap.innerHTML = `<div class="empty-state">No matching members found.</div>`;
    return;
  }

  resultsWrap.innerHTML = `
    <ul class="lookup-results-list">
      ${results
        .map(
          (r) => `
        <li class="lookup-result-row" data-user-id="${r.userId}">
          <span class="lookup-result-name">${r.username}</span>
          ${r.nickname ? `<span class="lookup-result-nick">${r.nickname}</span>` : ""}
          <span class="lookup-result-nick">${r.topRole || "No rank"}</span>
        </li>
      `
        )
        .join("")}
    </ul>
  `;

  resultsWrap.querySelectorAll(".lookup-result-row").forEach((row) => {
    row.addEventListener("click", () => loadLookupDetail(row.dataset.userId));
  });
}

async function loadLookupDetail(userId) {
  lookupSelectedUserId = userId;
  const detailWrap = document.getElementById("lookupDetailWrap");
  detailWrap.innerHTML = `<div class="skeleton" style="height: 120px; margin-top: 20px;"></div>`;

  const [shifts, history, roblox, live, weeklyTrend] = await Promise.all([
    apiGet(`/api/lookup/${userId}/shifts`),
    apiGet(`/api/lookup/${userId}/history`),
    apiGet(`/api/lookup/${userId}/roblox`),
    apiGet(`/api/lookup/${userId}/live`),
    apiGet(`/api/lookup/${userId}/weekly-trend?weeks=10`),
  ]);

  if (!shifts || !history) {
    detailWrap.innerHTML = `<div class="empty-state" style="margin-top: 20px;">Failed to load member details.</div>`;
    return;
  }

  // Phase 4: linked-Roblox display, wrapping utils/bloxlink.py via the bot
  // proxy - shown as best-effort (linked/unavailable), never blocking the
  // rest of the detail panel if Bloxlink itself is down.
  let robloxHtml = `<div class="empty-state">Roblox link status unavailable right now.</div>`;
  if (roblox && roblox.ok) {
    robloxHtml = roblox.linked
      ? `<div class="badge-card">Linked Roblox ID: <code>${roblox.robloxId}</code></div>`
      : `<div class="empty-state">No linked Roblox account found.</div>`;
  }

  // Bug 5 fix: live nickname/top-role from the bot's guild.members cache
  // (see /member/live), shown ahead of the historically-derived sections so
  // Member Lookup never looks stale on rename/promotion.
  let liveHtml = `<div class="empty-state">Live member data unavailable right now.</div>`;
  if (live && live.ok) {
    const l = live;
    liveHtml = `
      <div class="badge-card">Current rank: <strong>${l.topRole || "No rank"}</strong></div>
      <div class="badge-card">Current nickname: <strong>${l.nickname || l.username}</strong></div>
    `;
  }

  detailWrap.innerHTML = `
    <h2 class="lookup-detail-heading">Current Info</h2>
    ${liveHtml}
    <h2 class="lookup-detail-heading" style="margin-top: 22px;">Shifts</h2>
    ${renderShiftsSummaryHtml(shifts)}
    <h2 class="lookup-detail-heading" style="margin-top: 22px;">Weekly Hours Trend</h2>
    <div class="weekly-trend-chart-wrap liquid-glass">${weeklyTrend ? renderWeeklyTrendChart(weeklyTrend.points) : `<div class="empty-state">Trend data is unavailable right now.</div>`}</div>
    <h2 class="lookup-detail-heading" style="margin-top: 22px;">Recent Shifts</h2>
    <div id="lookupRecentShiftsWrap">${renderLookupRecentShiftsHtml(shifts.recent || [])}</div>
    <h2 class="lookup-detail-heading" style="margin-top: 22px;">Linked Roblox</h2>
    ${robloxHtml}
    <h2 class="lookup-detail-heading" style="margin-top: 22px;">History</h2>
    <div id="lookupHistoryWrap"></div>
    <div class="lookup-actions">
      <button class="lookup-action-btn" data-action="force_end">Force End Shift</button>
      <button class="lookup-action-btn" data-action="force_start">Start Shift</button>
      <button class="lookup-action-btn" data-action="toggle_break">Toggle Break</button>
      <button class="lookup-action-btn" data-action="reset">Reset Period</button>
    </div>
    <div id="lookupActionMessage"></div>
    ${tierAtLeast(me.tier, "admin") || me.isIa ? `
    <h2 class="lookup-detail-heading" style="margin-top: 22px;">HR Notes</h2>
    <div id="hrNotesWrap"></div>
    ` : ""}
  `;

  // Shifts already have their own section above (via /api/lookup/:id/shifts),
  // so History here only needs the 3 category sub-tabs derived from the
  // flat /api/history-style entries, not a redundant Shifts tab.
  const lookupBuckets = categorizeHistoryEntries(history.entries);
  document.getElementById("lookupHistoryWrap").innerHTML = renderHistoryTabsHtml("lookupHistory", lookupBuckets, false);
  wireHistorySubTabs("lookupHistory");

  detailWrap.querySelectorAll(".lookup-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleAdminActionClick(btn));
  });
  wireLookupRecentShiftActions(detailWrap);

  // HR Notes (client-side render gate only - the real access gate is the
  // Worker's /api/hr-notes route, isAdminPlus-or-isIa, same as officersRoster.js).
  if (document.getElementById("hrNotesWrap")) {
    await loadHrNotes(userId);
  }
}

// Private HR case notes for Member Lookup's detail view. The Worker gates
// both /api/hr-notes routes server-side (admin+ tier OR session.isIa) - this
// client check only decides whether to render the section at all.
async function loadHrNotes(userId) {
  const wrap = document.getElementById("hrNotesWrap");
  if (!wrap) return;
  wrap.innerHTML = `<div class="skeleton" style="height: 60px;"></div>`;

  const result = await apiGet(`/api/hr-notes?target_user_id=${encodeURIComponent(userId)}`);
  const notes = result && result.ok ? result.notes || [] : [];

  wrap.innerHTML = `
    <ul class="lookup-recent-shifts-list" id="hrNotesList">
      ${
        notes.length
          ? notes
              .map(
                (n) => `
        <li class="lookup-recent-shift-row" style="flex-direction: column; align-items: flex-start; gap: 4px;">
          <span><strong>${n.author_name || n.author_id || "Unknown"}</strong> &middot; ${new Date(n.created_at).toLocaleString()}</span>
          <span>${(n.note || "").replace(/</g, "&lt;")}</span>
        </li>
      `
              )
              .join("")
          : `<li class="empty-state">No HR notes yet.</li>`
      }
    </ul>
    <textarea id="hrNotesInput" placeholder="Add a private HR note..." rows="3" style="width: 100%; margin-top: 10px;"></textarea>
    <button class="lookup-action-btn" id="hrNotesAddBtn" style="margin-top: 8px;">Add Note</button>
    <div id="hrNotesMessage"></div>
  `;

  document.getElementById("hrNotesAddBtn").addEventListener("click", async () => {
    const input = document.getElementById("hrNotesInput");
    const note = input.value.trim();
    const msg = document.getElementById("hrNotesMessage");
    if (!note) return;
    const addResult = await apiPost("/api/hr-notes", { targetUserId: userId, note });
    if (!addResult || !addResult.ok) {
      if (msg) msg.innerHTML = `<div class="form-message error">Failed to add note.</div>`;
      return;
    }
    await loadHrNotes(userId);
  });
}

// Per-shift Void/Edit admin picker for Member Lookup - lists the target's
// recent shifts (from the same /api/lookup/:id/shifts fetch the summary
// above already uses, now extended with a `recent` array of individual
// shift docs) with a Void button and an inline Edit form for StartEpoch/
// EndEpoch.
function renderLookupRecentShiftsHtml(recent) {
  if (!recent.length) {
    return `<div class="empty-state">No recent shifts found.</div>`;
  }
  return `
    <ul class="lookup-recent-shifts-list">
      ${recent
        .map((shift) => {
          const status = !shift.endEpoch
            ? "In progress"
            : shift.voided
            ? "Voided"
            : new Date(shift.endEpoch * 1000).toLocaleString();
          return `
        <li class="lookup-recent-shift-row" data-shift-id="${shift.shiftId}">
          <span>${shift.type || "Default"}</span>
          <span>${new Date((shift.startEpoch || 0) * 1000).toLocaleString()}</span>
          <span>${status}</span>
          <button class="lookup-shift-void-btn" data-shift-id="${shift.shiftId}" ${shift.voided ? "disabled" : ""}>Void</button>
          <button class="lookup-shift-edit-btn" data-shift-id="${shift.shiftId}" data-start="${shift.startEpoch || ""}" data-end="${shift.endEpoch || ""}">Edit</button>
          <div class="lookup-shift-edit-form" data-shift-id="${shift.shiftId}" hidden>
            <input type="number" class="lookup-shift-edit-start" placeholder="Start epoch" value="${shift.startEpoch || ""}" />
            <input type="number" class="lookup-shift-edit-end" placeholder="End epoch" value="${shift.endEpoch || ""}" />
            <button class="lookup-shift-edit-save-btn" data-shift-id="${shift.shiftId}">Save</button>
          </div>
        </li>
      `;
        })
        .join("")}
    </ul>
  `;
}

function wireLookupRecentShiftActions(detailWrap) {
  detailWrap.querySelectorAll(".lookup-shift-void-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      confirmAction("Void this shift?", async () => {
        await fireAdminAction("void_shift", { shiftId: btn.dataset.shiftId });
        loadLookupDetail(lookupSelectedUserId);
      });
    });
  });

  detailWrap.querySelectorAll(".lookup-shift-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const form = detailWrap.querySelector(`.lookup-shift-edit-form[data-shift-id="${btn.dataset.shiftId}"]`);
      if (form) form.hidden = !form.hidden;
    });
  });

  detailWrap.querySelectorAll(".lookup-shift-edit-save-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const form = btn.closest(".lookup-shift-edit-form");
      const startEpoch = Number(form.querySelector(".lookup-shift-edit-start").value) || null;
      const endEpoch = Number(form.querySelector(".lookup-shift-edit-end").value) || null;
      confirmAction("Save these shift time changes?", async () => {
        await fireAdminAction("edit_shift_time", { shiftId: btn.dataset.shiftId, startEpoch, endEpoch });
        loadLookupDetail(lookupSelectedUserId);
      });
    });
  });
}

function handleAdminActionClick(btn) {
  confirmAction(`Run "${btn.textContent.trim()}" on this member?`, () => {
    fireAdminAction(btn.dataset.action);
  });
}

async function fireAdminAction(action, extra) {
  const messageEl = document.getElementById("lookupActionMessage");
  const res = await apiPost("/api/admin/shift-action", { userId: lookupSelectedUserId, action, ...(extra || {}) });
  if (!res || !res.ok || !res.data || !res.data.ok) {
    messageEl.innerHTML = `<div class="lookup-action-message error">Action failed. Please try again.</div>`;
    return;
  }
  messageEl.innerHTML = `<div class="lookup-action-message success">Action completed successfully.</div>`;
}

let currentLeaderboardPeriod = "weekly";
let currentLeaderboardShiftType = "all";
let customRangeValues = null; // { start, end } unix seconds, set once "Apply" is clicked
let leaderboardAutoRefreshInterval = null;
let onDutyPollInterval = null;

// Animates a number counting up from 0 to `endValue` inside `el`, formatting
// each intermediate frame with `formatFn` (e.g. formatDuration). Runs once
// per fresh render - re-renders (period/filter changes) simply call this
// again since each row is freshly created.
function animateCountUp(el, endValue, formatFn, duration) {
  const start = performance.now();
  function frame(now) {
    const progress = Math.min((now - start) / (duration || 600), 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out-cubic
    const value = Math.round(endValue * eased);
    el.textContent = formatFn(value);
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function renderLeaderboardRows(entries, period, startRank = 0) {
  if (entries.length === 0) {
    return `<li class="empty-state">No leaderboard data yet.</li>`;
  }
  return entries
    .map((entry, index) => {
      const avatarUrl = avatarUrlFor(entry.userId, entry.avatar, 64);
      const rankTitle = entry.rank
        ? `<span class="leaderboard-rank-title">${entry.rank}</span>`
        : `<span class="leaderboard-rank-title unranked">Unranked</span>`;
      const liveBadge = period === "live" ? `<span class="live-badge">LIVE</span>` : "";
      return `
        <li class="leaderboard-row" style="animation-delay: ${Math.min(index, 20) * 0.02}s">
          <span class="leaderboard-rank">${startRank + index + 1}</span>
          <img class="leaderboard-avatar" src="${avatarUrl}" alt="" width="32" height="32">
          <span class="leaderboard-identity">
            <span class="leaderboard-name">${entry.username}</span>
            ${rankTitle}
          </span>
          <span class="leaderboard-time">${liveBadge}<span class="count-target" data-seconds="${entry.totalSeconds}">0h 0m</span></span>
        </li>
      `;
    })
    .join("");
}

// Podium for the top 3 - visually promoted above the flat ranked list
// (center-raised #1, gold/silver/bronze rings) instead of everyone reading
// as equally-weighted rows. Only used by the main Leaderboard panel; the
// sidebar "This Week - Top 15" mini widget stays a plain list, it's too
// small a card for a podium to read well.
const PODIUM_ORDER = [2, 1, 3]; // display order: #2, #1 (center, raised), #3
function renderLeaderboardPodium(top3, period) {
  if (!top3 || top3.length === 0) return "";
  const liveBadge = period === "live" ? `<span class="live-badge">LIVE</span>` : "";
  const slots = PODIUM_ORDER
    .map((place) => {
      const entry = top3[place - 1];
      if (!entry) return "";
      const avatarUrl = avatarUrlFor(entry.userId, entry.avatar, 96);
      const rankTitle = entry.rank
        ? `<span class="leaderboard-rank-title">${entry.rank}</span>`
        : "";
      return `
        <div class="podium-slot podium-place-${place}" style="animation-delay: ${(place === 1 ? 0.05 : place === 2 ? 0.15 : 0.25).toFixed(2)}s">
          <span class="podium-medal">${place === 1 ? "&#129351;" : place === 2 ? "&#129352;" : "&#129353;"}</span>
          <img class="podium-avatar" src="${avatarUrl}" alt="" width="72" height="72">
          <span class="podium-name">${entry.username}</span>
          ${rankTitle}
          <span class="podium-time">${liveBadge}<span class="count-target" data-seconds="${entry.totalSeconds}">0h 0m</span></span>
          <div class="podium-stand podium-stand-${place}"><span class="podium-stand-rank">${place}</span></div>
        </div>
      `;
    })
    .join("");
  return slots;
}

// Kicks off the count-up animation for every `.count-target` span inside
// `container` - called right after innerHTML is set so the rows already
// exist in the DOM.
function animateLeaderboardCounts(container) {
  container.querySelectorAll(".count-target").forEach((el) => {
    const seconds = Number(el.dataset.seconds || 0);
    animateCountUp(el, seconds, formatDuration, 700);
  });
}

function leaderboardQueryFor(period, shiftType) {
  const typeParam = shiftType && shiftType !== "all" ? `&shiftType=${shiftType}` : "";
  if (period !== "custom") return `/api/leaderboard?period=${period}${typeParam}`;
  if (!customRangeValues) return null;
  return `/api/leaderboard?period=custom&start=${customRangeValues.start}&end=${customRangeValues.end}${typeParam}`;
}

async function loadLeaderboard(period) {
  if (period) currentLeaderboardPeriod = period;
  const path = leaderboardQueryFor(currentLeaderboardPeriod, currentLeaderboardShiftType);
  if (!path) return; // custom period selected but no range applied yet

  const skeleton = document.getElementById("leaderboardSkeleton");
  const list = document.getElementById("leaderboardList");
  const podium = document.getElementById("leaderboardPodium");

  // Smooth transition: fade the existing list out, fetch, then fade+slide the
  // fresh rows in (extends the .panel-in / .leaderboard-row animation pattern
  // already used elsewhere rather than introducing a new one).
  if (!list.hidden) {
    list.classList.add("is-loading");
    podium.classList.add("is-loading");
    skeleton.hidden = false;
  }

  const leaderboard = await apiGet(path);
  skeleton.hidden = true;
  list.classList.remove("is-loading");
  podium.classList.remove("is-loading");
  list.hidden = false;
  podium.hidden = false;

  if (!leaderboard) {
    podium.innerHTML = "";
    list.innerHTML = `<li class="empty-state">Failed to load leaderboard. Try again.</li>`;
    return;
  }

  const top3 = leaderboard.entries.slice(0, 3);
  const rest = leaderboard.entries.slice(3);
  podium.innerHTML = renderLeaderboardPodium(top3, currentLeaderboardPeriod);
  list.innerHTML = renderLeaderboardRows(rest, currentLeaderboardPeriod, 3);
  animateLeaderboardCounts(podium);
  animateLeaderboardCounts(list);

  refreshOnDutyBadge();
}

async function refreshOnDutyBadge() {
  const badge = document.getElementById("onDutyBadge");
  const countEl = document.getElementById("onDutyCount");
  const typeParam = currentLeaderboardShiftType !== "all" ? `?shiftType=${currentLeaderboardShiftType}` : "";
  const res = await apiGet(`/api/leaderboard/on-duty${typeParam}`);
  if (!res || typeof res.count !== "number") {
    badge.hidden = true;
    return;
  }
  countEl.textContent = res.count;
  badge.hidden = false;
}

// "Live" leaderboard period + the on-duty badge both auto-refresh every 45s
// while the Leaderboard panel is open, per the plan's "this-week auto-refresh
// every 30-60s" requirement (the on-duty badge is always kept fresh too,
// since it's meaningful regardless of which period is selected).
function startLeaderboardAutoRefresh() {
  stopLeaderboardAutoRefresh();
  leaderboardAutoRefreshInterval = setInterval(() => {
    loadLeaderboard();
  }, 45000);
}

function stopLeaderboardAutoRefresh() {
  if (leaderboardAutoRefreshInterval) {
    clearInterval(leaderboardAutoRefreshInterval);
    leaderboardAutoRefreshInterval = null;
  }
}

// ── Recognized Officers ──

function renderOfficerOfWeekHtml(officer) {
  if (!officer) return "";
  const avatarUrl = avatarUrlFor(officer.userId, officer.avatar, 64);
  return `
    <img class="leaderboard-avatar" src="${avatarUrl}" alt="" width="40" height="40">
    <span class="leaderboard-identity">
      <span class="leaderboard-name">${officer.username}</span>
    </span>
    <span class="leaderboard-time"><span class="count-target" data-seconds="${officer.weeklySeconds}">0h 0m</span> this week</span>
  `;
}

function renderRecognizedOfficerRows(officers) {
  if (officers.length === 0) {
    return `<li class="empty-state">No officers currently meet the 100+ hour / 6+ month bar.</li>`;
  }
  return officers
    .map((officer, index) => {
      const avatarUrl = avatarUrlFor(officer.userId, officer.avatar, 64);
      const rankTitle = officer.rank
        ? `<span class="leaderboard-rank-title">${officer.rank}</span>`
        : `<span class="leaderboard-rank-title unranked">Unranked</span>`;
      return `
        <li class="leaderboard-row" style="animation-delay: ${Math.min(index, 20) * 0.02}s">
          <span class="leaderboard-rank">${index + 1}</span>
          <img class="leaderboard-avatar" src="${avatarUrl}" alt="" width="32" height="32">
          <span class="leaderboard-identity">
            <span class="leaderboard-name">${officer.username}</span>
            ${rankTitle}
          </span>
          <span class="leaderboard-time">
            <span class="tenure-pill">${Math.floor(officer.tenureDays / 30)}mo tenure</span>
            <span class="count-target" data-seconds="${officer.totalSeconds}">0h 0m</span>
          </span>
        </li>
      `;
    })
    .join("");
}

async function loadRecognizedOfficers() {
  const skeleton = document.getElementById("recognizedOfficersSkeleton");
  const list = document.getElementById("recognizedOfficersList");
  const weekCard = document.getElementById("officerOfWeekCard");
  const weekBody = document.getElementById("officerOfWeekBody");

  const res = await apiGet("/api/officers/recognized");
  skeleton.hidden = true;
  list.hidden = false;

  if (!res) {
    list.innerHTML = `<li class="empty-state">Failed to load recognized officers. Try again.</li>`;
    weekCard.hidden = true;
    return;
  }

  if (res.officerOfTheWeek) {
    weekBody.innerHTML = renderOfficerOfWeekHtml(res.officerOfTheWeek);
    weekCard.hidden = false;
    animateLeaderboardCounts(weekCard);
  } else {
    weekCard.hidden = true;
  }

  list.innerHTML = renderRecognizedOfficerRows(res.officers || []);
  animateLeaderboardCounts(list);
}

// ── Department Feed ──

const DEPARTMENT_FEED_ICON = {
  promotion: "★",
  application_accepted: "✓",
};
const DEPARTMENT_FEED_LABEL = {
  promotion: "Promotion",
  application_accepted: "Accepted",
};

function renderDepartmentFeedRows(entries) {
  if (entries.length === 0) {
    return `<li class="empty-state">No recent department activity.</li>`;
  }
  return entries
    .map((entry) => {
      const avatarUrl = avatarUrlFor(entry.userId, entry.avatar, 34);
      return `
        <li class="department-feed-row">
          <img class="department-feed-avatar" src="${avatarUrl}" alt="" width="34" height="34">
          <span class="department-feed-icon department-feed-icon-${entry.kind}">
            <span>${DEPARTMENT_FEED_ICON[entry.kind] || "•"}</span>${DEPARTMENT_FEED_LABEL[entry.kind] || ""}
          </span>
          <span class="department-feed-desc">
            ${entry.username ? `<span class="department-feed-name">${entry.username}</span> — ` : ""}${entry.description}
          </span>
          <span class="department-feed-date">${formatDate(entry.timestamp)}</span>
        </li>
      `;
    })
    .join("");
}

async function loadDepartmentFeed() {
  const skeleton = document.getElementById("departmentFeedSkeleton");
  const list = document.getElementById("departmentFeedList");

  const res = await apiGet("/api/officers/department-feed?limit=20");
  skeleton.hidden = true;
  list.hidden = false;

  if (!res) {
    list.innerHTML = `<li class="empty-state">Failed to load the department feed. Try again.</li>`;
    return;
  }

  list.innerHTML = renderDepartmentFeedRows(res.entries || []);
}

async function loadMiniLeaderboard() {
  const skeleton = document.getElementById("miniLeaderboardSkeleton");
  const list = document.getElementById("miniLeaderboardList");
  const leaderboard = await apiGet("/api/leaderboard?period=weekly");
  skeleton.hidden = true;
  list.hidden = false;
  if (!leaderboard) {
    list.innerHTML = `<li class="empty-state">Failed to load leaderboard.</li>`;
    return;
  }
  list.innerHTML = renderLeaderboardRows((leaderboard.entries || []).slice(0, 15), "weekly");
  animateLeaderboardCounts(list);
}

// ── Quota progress ring + quick stats (Shift Management right column) ──

async function loadQuotaRing() {
  const skeleton = document.getElementById("quotaRingSkeleton");
  const body = document.getElementById("quotaRingBody");
  const res = await apiGet("/api/shift/quota");
  skeleton.hidden = true;
  body.hidden = false;

  const detailEl = document.getElementById("quotaRingDetail");
  const ring = document.getElementById("quotaRing");
  const pctEl = document.getElementById("quotaRingPct");

  if (!res || res.ok === false) {
    detailEl.textContent = "Quota data is unavailable right now.";
    ring.style.setProperty("--quota-pct", 0);
    pctEl.textContent = "--";
    return;
  }

  const { quotaSeconds, currentSeconds } = res;
  if (!quotaSeconds || quotaSeconds <= 0) {
    detailEl.textContent = "No quota configured for your role.";
    ring.style.setProperty("--quota-pct", 0);
    pctEl.textContent = "--";
    return;
  }

  const pct = Math.min(100, Math.round((currentSeconds / quotaSeconds) * 100));
  ring.style.setProperty("--quota-pct", pct);
  pctEl.textContent = `${pct}%`;
  detailEl.textContent = `${formatDuration(currentSeconds)} of ${formatDuration(quotaSeconds)} this week`;

  const miniQuota = document.getElementById("sidebarMiniStatsQuota");
  if (miniQuota) miniQuota.textContent = `${pct}%`;
  document.getElementById("sidebarMiniStats")?.removeAttribute("hidden");
}

async function loadQuickStats() {
  const skeleton = document.getElementById("quickStatsSkeleton");
  const grid = document.getElementById("quickStatsGrid");
  const [shifts, liveBoard] = await Promise.all([
    apiGet("/api/shifts"),
    apiGet("/api/leaderboard?period=live"),
  ]);
  skeleton.hidden = true;
  grid.hidden = false;

  const myLiveEntry = (liveBoard && liveBoard.entries || []).find(
    (e) => currentMe && e.userId === currentMe.userId
  );
  const weekSeconds = myLiveEntry ? myLiveEntry.totalSeconds : 0;
  const totalShiftCount = shifts ? shifts.shiftCount || 0 : 0;

  grid.innerHTML = `
    <div class="quick-stat">
      <span class="quick-stat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 3"></path></svg>
      </span>
      <span class="quick-stat-text">
        <span class="quick-stat-value">${formatDuration(weekSeconds)}</span>
        <span class="quick-stat-label">This week</span>
      </span>
    </div>
    <div class="quick-stat">
      <span class="quick-stat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M3 10h18M8 2v4M16 2v4"></path></svg>
      </span>
      <span class="quick-stat-text">
        <span class="quick-stat-value">${totalShiftCount}</span>
        <span class="quick-stat-label">Total shifts</span>
      </span>
    </div>
  `;
}

// ── Shift Management ──

let shiftTimerInterval = null;
let shiftPollInterval = null;
let currentShiftState = null; // { active, startEpoch, shiftType, breaks, onBreak }

function computeElapsedSeconds(shift) {
  if (!shift || !shift.active) return 0;
  const now = Date.now() / 1000;
  let elapsed = now - shift.startEpoch;
  for (const brk of shift.breaks || []) {
    const end = brk.EndEpoch && brk.EndEpoch > 0 ? brk.EndEpoch : now;
    elapsed -= end - brk.StartEpoch;
  }
  return Math.max(0, elapsed);
}

// Live duty-status dot on the Shift Management nav item itself (user
// request): glanceable from any page without opening Shift Management -
// green + pulsing while on duty, amber while on break, hidden entirely
// when off duty.
function updateNavShiftStatusDot(shift) {
  const dot = document.getElementById("navShiftStatusDot");
  if (!dot) return;
  if (!shift || !shift.active) {
    dot.hidden = true;
    dot.classList.remove("on-break");
    return;
  }
  dot.hidden = false;
  dot.classList.toggle("on-break", !!shift.onBreak);
}

function renderShiftState(shift) {
  currentShiftState = shift;
  updateNavShiftStatusDot(shift);
  const off = document.getElementById("currentShiftOff");
  const on = document.getElementById("currentShiftOn");

  if (!shift || !shift.active) {
    off.hidden = false;
    on.hidden = true;
    if (shiftTimerInterval) {
      clearInterval(shiftTimerInterval);
      shiftTimerInterval = null;
    }
    const miniShiftOffEl = document.getElementById("sidebarMiniStatsShift");
    if (miniShiftOffEl) miniShiftOffEl.textContent = "Off duty";
    document.getElementById("sidebarMiniStats")?.removeAttribute("hidden");
    return;
  }

  off.hidden = true;
  on.hidden = false;
  document.getElementById("currentShiftType").textContent = shift.shiftType;
  const breakBtn = document.getElementById("shiftBreakBtn");
  breakBtn.textContent = shift.onBreak ? "End Break" : "Start Break";
  breakBtn.classList.toggle("on-break", !!shift.onBreak);

  const timerEl = document.getElementById("currentShiftTimer");
  const breakTimerEl = document.getElementById("currentShiftBreakTimer");
  const breakElapsedEl = document.getElementById("currentShiftBreakElapsed");
  const miniShiftEl = document.getElementById("sidebarMiniStatsShift");
  const tick = () => {
    const elapsed = computeElapsedSeconds(currentShiftState);
    timerEl.textContent = formatHms(elapsed);
    if (miniShiftEl) miniShiftEl.textContent = formatHms(elapsed);

    // Live-ticking break duration ("On break 0:03" -> "0:04" -> ...) instead
    // of just the Start/End Break button with no indication of how long the
    // current break has actually run. The open break is whichever entry in
    // `breaks` has no EndEpoch yet.
    const openBreak = currentShiftState.onBreak
      ? (currentShiftState.breaks || []).find((b) => !b.EndEpoch || b.EndEpoch <= 0)
      : null;
    if (openBreak) {
      breakTimerEl.hidden = false;
      const breakSeconds = Math.max(0, Date.now() / 1000 - openBreak.StartEpoch);
      const m = Math.floor(breakSeconds / 60);
      const s = Math.floor(breakSeconds % 60);
      breakElapsedEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
    } else {
      breakTimerEl.hidden = true;
    }
  };
  tick();
  if (shiftTimerInterval) clearInterval(shiftTimerInterval);
  shiftTimerInterval = setInterval(tick, 1000);
}

async function refreshCurrentShift() {
  const shift = await apiGet("/api/shift/current");
  if (!shift) return;
  renderShiftState(shift);
}

function showShiftMessage(text, kind) {
  const el = document.getElementById("shiftActionMessage");
  el.innerHTML = `<div class="form-message ${kind}">${text}</div>`;
}

// ── Currently On Duty (Shift Management right column) ──

function renderOnDutyRows(entries) {
  if (entries.length === 0) {
    return `<li class="empty-state">Nobody is currently on duty.</li>`;
  }
  return entries
    .map((e) => {
      const meta = e.onBreak ? "On break" : (e.shiftType || "On duty");
      return `
        <li class="on-duty-row ${e.onBreak ? "on-break" : ""}">
          <img src="${avatarUrlFor(e.userId, e.avatar, 28)}" alt="">
          <div class="on-duty-row-body">
            <span class="on-duty-row-name">${e.displayName}</span>
            <span class="on-duty-row-meta">${meta}</span>
          </div>
          <span class="on-duty-row-elapsed">${formatHms(e.elapsedSeconds || 0)}</span>
        </li>
      `;
    })
    .join("");
}

async function loadOnDutyCard() {
  const skeleton = document.getElementById("onDutyCardSkeleton");
  const list = document.getElementById("onDutyCardList");
  const countEl = document.getElementById("onDutyCardCount");
  const res = await apiGet("/api/shift/on-duty");
  skeleton.hidden = true;
  list.hidden = false;

  if (!res || res.ok === false) {
    list.innerHTML = `<li class="empty-state">On-duty list is unavailable right now.</li>`;
    countEl.textContent = "";
    return;
  }

  const onDuty = res.onDuty || [];
  countEl.textContent = onDuty.length ? `(${onDuty.length})` : "";
  list.innerHTML = renderOnDutyRows(onDuty);
}

async function loadShiftManagement() {
  document.getElementById("shiftMgmtSkeleton").hidden = true;
  document.getElementById("shiftMgmtBody").hidden = false;

  // Await every sub-load together, not just the first one - previously only
  // refreshCurrentShift() was awaited, so the returned promise resolved (and
  // withLoadingOverlay hid its spinner) long before the slower loads below
  // (in particular the leaderboard-backed mini leaderboard) had actually
  // finished, decoupling the overlay from real page-load state.
  await Promise.allSettled([
    refreshCurrentShift(),
    loadMiniLeaderboard(),
    loadQuotaRing(),
    loadQuickStats(),
    loadOnDutyCard(),
  ]);

  if (shiftPollInterval) clearInterval(shiftPollInterval);
  shiftPollInterval = setInterval(() => {
    refreshCurrentShift();
    loadOnDutyCard();
  }, 45000);
}

async function startShift(shiftType) {
  const res = await apiPost("/api/shift/start", { shiftType });
  if (!res || !res.ok || !res.data || res.data.ok === false) {
    showShiftMessage(`Could not start shift: ${(res && res.data && res.data.error) || "unknown error"}`, "error");
    return;
  }
  showShiftMessage("Shift started.", "success");
  refreshCurrentShift();
}

async function endShift() {
  const endedShiftType = currentShiftState && currentShiftState.shiftType;
  const res = await apiPost("/api/shift/end", {});
  if (!res || !res.ok || !res.data || res.data.ok === false) {
    showShiftMessage(`Could not end shift: ${(res && res.data && res.data.error) || "unknown error"}`, "error");
    return;
  }
  showShiftMessage("Shift ended.", "success");
  refreshCurrentShift();
  // "Undo" here isn't a true undo (there's no undo API for ending a shift) -
  // it just re-starts a shift of the same type, which is safe since it's the
  // user's own shift they just ended.
  if (endedShiftType) {
    showUndoToast("Shift ended.", async () => {
      await startShift(endedShiftType);
    });
  }
}

async function toggleBreak() {
  const action = currentShiftState && currentShiftState.onBreak ? "end" : "start";
  const res = await apiPost("/api/shift/break", { action });
  if (!res || !res.ok || !res.data || res.data.ok === false) {
    showShiftMessage(`Break action failed: ${(res && res.data && res.data.error) || "unknown error"}`, "error");
    return;
  }
  refreshCurrentShift();
}

document.getElementById("shiftTypePicker").addEventListener("click", (e) => {
  const btn = e.target.closest(".shift-type-btn");
  if (!btn) return;
  startShift(btn.dataset.shiftType);
});
document.getElementById("shiftBreakBtn").addEventListener("click", toggleBreak);
document.getElementById("shiftEndBtn").addEventListener("click", () => {
  confirmAction("End your current shift?", endShift);
});

// ── Leave of Absence ──

const LOA_STATUS_ICON = { pending: "⏳", accepted: "✅", denied: "❌", expired: "\u{1F5D3}" };

function loaStatusFor(entry) {
  if (entry.voided || entry.denied) return "denied";
  if (entry.expired) return "expired";
  if (entry.accepted) return "accepted";
  return "pending";
}

function renderLoaHistory(entries) {
  if (!entries.length) return `<li class="empty-state">No LOA/RA requests yet.</li>`;
  return entries
    .map((entry) => {
      const status = loaStatusFor(entry);
      return `
        <li class="loa-history-row">
          <span>${entry.type || "LOA"} - ${entry.reason || "No reason given"}</span>
          <span class="status-chip ${status}">${LOA_STATUS_ICON[status]} ${status}</span>
        </li>
      `;
    })
    .join("");
}

async function loadLoaHistory() {
  const res = await apiGet("/api/loa/mine");
  document.getElementById("loaHistorySkeleton").hidden = true;
  const list = document.getElementById("loaHistoryList");
  list.hidden = false;
  if (!res) {
    list.innerHTML = `<li class="empty-state">Failed to load LOA history.</li>`;
    return;
  }
  list.innerHTML = renderLoaHistory(res.entries || []);
}

document.getElementById("loaForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const type = document.getElementById("loaType").value;
  const days = Number(document.getElementById("loaDuration").value) || 1;
  const reason = document.getElementById("loaReason").value.trim();
  const messageEl = document.getElementById("loaFormMessage");

  const res = await apiPost("/api/loa/request", {
    type,
    durationSeconds: days * 86400,
    reason,
  });

  if (!res || !res.ok || !res.data || res.data.ok === false) {
    const reason = (res && res.data && res.data.error) || "unknown_error";
    messageEl.innerHTML = `<div class="form-message error">Request denied: ${reason.replace(/_/g, " ")}</div>`;
    return;
  }
  messageEl.innerHTML = `<div class="form-message success">Request submitted successfully.</div>`;
  loadLoaHistory();
});

async function loadLoa() {
  loadLoaHistory();
}

// ── RA ──

function renderRaSessions(entries, userId) {
  if (!entries.length) return `<li class="empty-state">No RA sessions yet.</li>`;
  return entries
    .map((entry) => {
      const role = entry.fto_id === userId ? "FTO" : "Trainee";
      return `
        <li class="ra-session-row">
          <span>${role} - ${entry.type || "session"}</span>
          <span class="status-chip ${entry.status === "finished" ? "accepted" : entry.status === "expired" ? "expired" : "pending"}">${entry.status || "open"}</span>
        </li>
      `;
    })
    .join("");
}

async function loadRaSessions() {
  const res = await apiGet("/api/ra/mine");
  document.getElementById("raSessionsSkeleton").hidden = true;
  const list = document.getElementById("raSessionsList");
  list.hidden = false;
  if (!res) {
    list.innerHTML = `<li class="empty-state">Failed to load RA sessions.</li>`;
    return;
  }
  list.innerHTML = renderRaSessions(res.entries || [], currentMe && currentMe.userId);
}

function renderRaFtos(ftos) {
  if (!ftos.length) return `<div class="empty-state">No FTOs currently online.</div>`;
  // /api/ra/ftos now resolves each FTO's real guild display name + avatar
  // through the bot (see ERM-main/cogs/DashboardAPI.py's handle_ra_ftos) -
  // previously this rendered the raw numeric userId as the "name".
  return ftos
    .map((fto) => {
      const userId = fto.userId || fto.user || "unknown";
      const displayName = fto.displayName || `User ${userId}`;
      return `
        <div class="ra-fto-chip">
          <img src="${avatarUrlFor(userId, fto.avatar, 32)}" alt="">
          <span>${displayName}</span>
        </div>
      `;
    })
    .join("");
}

async function loadRaFtos() {
  const res = await apiGet("/api/ra/ftos");
  document.getElementById("raFtosSkeleton").hidden = true;
  const list = document.getElementById("raFtosList");
  list.hidden = false;
  if (!res) {
    list.innerHTML = `<div class="empty-state">Failed to load FTO availability.</div>`;
    return;
  }
  list.innerHTML = renderRaFtos(res.ftos || []);
}

let raCooldownInterval = null;

document.getElementById("raRequestBtn").addEventListener("click", async () => {
  const messageEl = document.getElementById("raRequestMessage");
  const res = await apiPost("/api/ra/request", {});
  if (!res || !res.ok || !res.data || res.data.ok === false) {
    const data = res && res.data;
    if (data && data.error === "cooldown" && data.remainingSeconds != null) {
      let remaining = data.remainingSeconds;
      if (raCooldownInterval) clearInterval(raCooldownInterval);
      const render = () => {
        messageEl.innerHTML = `<div class="form-message error">On cooldown - try again in ${formatHms(remaining)}</div>`;
        remaining -= 1;
        if (remaining < 0) clearInterval(raCooldownInterval);
      };
      render();
      raCooldownInterval = setInterval(render, 1000);
      return;
    }
    messageEl.innerHTML = `<div class="form-message error">Request denied: ${(data && data.error) || "unknown error"}</div>`;
    return;
  }
  messageEl.innerHTML = `<div class="form-message success">RA session requested.</div>`;
  loadRaSessions();
});

async function loadRa() {
  loadRaSessions();
  loadRaFtos();
}

// ── Personal Settings ──
// Real fields come from ERM-main/utils/user_settings.py's DEFAULT_SETTINGS -
// grouped into cards (mirrors the Shift Management page's card-grid
// convention) with a friendly label/description and a proper control per
// field, instead of one flat auto-generated list of raw key names.

const DAY_OPTIONS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

const SETTING_META = {
  nudge_opt_out: {
    card: "Notifications", label: "Opt out of nudges",
    desc: "Stop receiving reminder nudges from the bot.", type: "toggle",
  },
  report_card_opt_out: {
    card: "Notifications", label: "Opt out of report card",
    desc: "Don't receive your periodic performance report card DM.", type: "toggle",
  },
  shift_reports_enabled: {
    card: "Notifications", label: "Shift reports",
    desc: "Receive a DM summary after ending a shift.", type: "toggle",
  },
  dm_on_claim: {
    card: "Notifications", label: "DM on RA claim",
    desc: "Get DM'd when an FTO claims your RA request.", type: "toggle",
  },
  trainee_result_alert: {
    card: "Notifications", label: "Trainee result alerts",
    desc: "FTO setting - DM you when a trainee's RA result posts.", type: "toggle",
  },
  weekly_digest_day: {
    card: "Notifications", label: "Weekly digest day",
    desc: "Day for your personal weekly summary DM (hours, rank, streak).",
    type: "select-day",
  },
  weekly_digest_hour: {
    card: "Notifications", label: "Weekly digest hour",
    desc: "Hour (Eastern) for the weekly digest DM.", type: "select-hour",
  },

  shift_reminder_minutes: {
    card: "Shift Reminders", label: "Shift reminder",
    desc: "Minutes into a shift before a reminder DM. Blank = off.", type: "number",
  },
  quota_reminder_day: {
    card: "Shift Reminders", label: "Quota reminder day",
    desc: "Day for the weekly quota reminder DM.", type: "select-day",
  },
  quota_reminder_hour: {
    card: "Shift Reminders", label: "Quota reminder hour",
    desc: "Hour (Eastern) for the quota reminder DM.", type: "select-hour",
  },
  confirm_long_shifts: {
    card: "Shift Reminders", label: "Confirm long shifts",
    desc: "Ask for confirmation before ending an unusually long shift.", type: "toggle",
  },
  long_shift_threshold_hours: {
    card: "Shift Reminders", label: "Long shift threshold",
    desc: "Hours before a shift is considered long.", type: "number",
  },
  auto_end_shift: {
    card: "Shift Reminders", label: "Auto-end at quota",
    desc: "Automatically end your shift once weekly quota is met.", type: "toggle",
  },
  default_shift_type: {
    card: "Shift Reminders", label: "Default shift type",
    desc: "Pre-selected shift type when starting duty.", type: "text",
  },
  default_max_trainees: {
    card: "Shift Reminders", label: "Default max trainees",
    desc: "FTO setting - default trainee cap when hosting RA.", type: "number",
  },
  auto_toggle_ra_availability: {
    card: "Shift Reminders", label: "Auto-toggle RA availability",
    desc: "FTO setting - mark available/unavailable automatically with duty status.",
    type: "toggle",
  },

  profile_visibility: {
    card: "Profile & Privacy", label: "Profile visibility",
    desc: "Who can see your duty data on lookups.", type: "select",
    options: [["everyone", "Everyone (Deputy+)"], ["staff", "Staff only (data hidden)"], ["command", "Command Team only"]],
  },
  embed_accent_color: {
    card: "Profile & Privacy", label: "DM embed accent color",
    desc: "Accent color name used on DM embeds sent to you.", type: "text",
  },
  profile_widgets: {
    card: "Profile & Privacy", label: "Profile widgets",
    desc: "Widgets shown on your profile page.", type: "readonly",
  },
  roblox_auto_start_enabled: {
    card: "Profile & Privacy", label: "Auto-start prompt",
    desc: "DM a start-shift prompt when you join ERLC off duty.", type: "toggle",
  },
  shift_notes_enabled: {
    card: "Profile & Privacy", label: "Shift notes prompt",
    desc: "Show a \"leave a note?\" prompt when ending a shift.", type: "toggle",
  },
  timezone: {
    card: "Profile & Privacy", label: "Timezone",
    desc: "Used for displaying times in your local zone.", type: "text",
  },
  mobile_friendly: {
    card: "Profile & Privacy", label: "Mobile-friendly embeds",
    desc: "Simplify embed layout for mobile Discord.", type: "toggle",
  },
};

const CARD_ORDER = ["Notifications", "Shift Reminders", "Profile & Privacy"];

function settingControlHtml(key, value, meta) {
  if (meta.type === "toggle") {
    return `<button class="settings-toggle ${value ? "on" : ""}" data-key="${key}" data-value="${!!value}"></button>`;
  }
  if (meta.type === "select-day" || meta.type === "select") {
    const options = meta.type === "select-day"
      ? DAY_OPTIONS.map((d, i) => [String(i), d])
      : meta.options;
    const optHtml = [`<option value="" ${value == null ? "selected" : ""}>Server default</option>`]
      .concat(options.map(([v, l]) => `<option value="${v}" ${String(value) === v ? "selected" : ""}>${l}</option>`))
      .join("");
    return `<select class="settings-select" data-key="${key}">${optHtml}</select>`;
  }
  if (meta.type === "select-hour") {
    const optHtml = [`<option value="" ${value == null ? "selected" : ""}>Server default</option>`]
      .concat(HOUR_OPTIONS.map((l, h) => `<option value="${h}" ${String(value) === String(h) ? "selected" : ""}>${l}</option>`))
      .join("");
    return `<select class="settings-select" data-key="${key}">${optHtml}</select>`;
  }
  if (meta.type === "readonly") {
    return `<span class="settings-row-status">${Array.isArray(value) ? (value.join(", ") || "(none)") : String(value ?? "")}</span>`;
  }
  if (meta.type === "number") {
    return `<input type="number" class="settings-input" data-key="${key}" value="${value ?? ""}">`;
  }
  return `<input type="text" class="settings-input" data-key="${key}" value="${value ?? ""}">`;
}

function renderSettingRow(key, value) {
  const meta = SETTING_META[key] || {
    card: "Other", label: key.replace(/_/g, " "), desc: "", type: Array.isArray(value) ? "readonly" : typeof value === "boolean" ? "toggle" : typeof value === "number" ? "number" : "text",
  };
  return `
    <div class="settings-row" data-key="${key}">
      <div class="settings-row-text">
        <span class="settings-row-label">${meta.label}</span>
        ${meta.desc ? `<span class="settings-row-desc">${meta.desc}</span>` : ""}
      </div>
      ${settingControlHtml(key, value, meta)}
      <span class="settings-row-status" data-status></span>
    </div>
  `;
}

async function saveSetting(row, key, value) {
  const statusEl = row.querySelector("[data-status]");
  statusEl.textContent = "Saving...";
  statusEl.className = "settings-row-status";
  const res = await apiPost("/api/settings", { key, value });
  if (!res || !res.ok || !res.data || res.data.ok === false) {
    statusEl.textContent = "Failed to save";
    statusEl.className = "settings-row-status error";
    return;
  }
  statusEl.textContent = "Saved";
  statusEl.className = "settings-row-status saved";
}

async function loadSettings() {
  const res = await apiGet("/api/settings");
  document.getElementById("settingsSkeleton").hidden = true;
  const grid = document.getElementById("settingsCardGrid");
  grid.hidden = false;

  if (!res || res.ok === false) {
    grid.innerHTML = `<div class="empty-state">Settings are unavailable right now.</div>`;
    return;
  }

  // handleSettingsGet (workers/dashboard-api/src/routes/settings.js) returns
  // {ok, settings: {...}} - the actual per-key toggles live one level down
  // under "settings", not at the top level. Reading straight off `res` here
  // used to render a single broken "[object Object]" row instead of one row
  // per real setting, which is why this panel looked empty/useless.
  const settings = res.settings || {};
  // dashboard_onboarding_seen is an internal welcome-tour flag, not a
  // user-facing toggle - the "Replay Welcome Tour" button below handles it.
  const entries = Object.entries(settings).filter(([key]) => key !== "dashboard_onboarding_seen");
  if (entries.length === 0) {
    grid.innerHTML = `<div class="empty-state">No settings to show.</div>`;
    return;
  }

  const byCard = new Map();
  for (const [key, value] of entries) {
    const card = (SETTING_META[key] || {}).card || "Other";
    if (!byCard.has(card)) byCard.set(card, []);
    byCard.get(card).push([key, value]);
  }

  const orderedCards = CARD_ORDER.filter((c) => byCard.has(c)).concat(
    [...byCard.keys()].filter((c) => !CARD_ORDER.includes(c))
  );

  grid.innerHTML = orderedCards
    .map((card) => `
      <div class="settings-card">
        <h2 class="settings-section-heading">${card}</h2>
        <div class="settings-list">
          ${byCard.get(card).map(([key, value]) => renderSettingRow(key, value)).join("")}
        </div>
      </div>
    `)
    .join("");

  grid.querySelectorAll(".settings-toggle").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const newValue = toggle.dataset.value !== "true";
      toggle.classList.toggle("on", newValue);
      toggle.dataset.value = String(newValue);
      saveSetting(toggle.closest(".settings-row"), toggle.dataset.key, newValue);
    });
  });

  grid.querySelectorAll(".settings-input").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.key;
      const value = input.type === "number" ? Number(input.value) : input.value;
      saveSetting(input.closest(".settings-row"), key, value);
    });
  });

  grid.querySelectorAll(".settings-select").forEach((select) => {
    select.addEventListener("change", () => {
      const key = select.dataset.key;
      const value = select.value === "" ? null : Number(select.value);
      saveSetting(select.closest(".settings-row"), key, value);
    });
  });
}

// ── Reviews ──

function reviewStarsHtml(rating) {
  let out = "";
  for (let i = 1; i <= 5; i++) {
    out += `<span class="review-star-display${i <= rating ? " filled" : ""}">&#9733;</span>`;
  }
  return out;
}

(function initReviewStarPicker() {
  const picker = document.getElementById("reviewStarPicker");
  if (!picker) return;
  const stars = Array.from(picker.querySelectorAll(".review-star"));

  const paint = (value) => {
    stars.forEach((s) => s.classList.toggle("filled", Number(s.dataset.star) <= value));
  };

  stars.forEach((star) => {
    star.addEventListener("click", () => {
      picker.dataset.value = star.dataset.star;
      paint(Number(star.dataset.star));
    });
    star.addEventListener("mouseenter", () => paint(Number(star.dataset.star)));
  });
  picker.addEventListener("mouseleave", () => paint(Number(picker.dataset.value)));
})();

document.getElementById("reviewText")?.addEventListener("input", (e) => {
  document.getElementById("reviewCharCount").textContent = `${e.target.value.length} / 500`;
});

document.getElementById("reviewForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const messageEl = document.getElementById("reviewFormMessage");
  const successEl = document.getElementById("reviewFormSuccess");
  const formEl = document.getElementById("reviewForm");
  const picker = document.getElementById("reviewStarPicker");
  const rating = Number(picker.dataset.value);
  const text = document.getElementById("reviewText").value.trim();

  messageEl.innerHTML = "";
  if (!rating) {
    messageEl.innerHTML = `<div class="form-message error">Pick a star rating first.</div>`;
    return;
  }
  if (!text) {
    messageEl.innerHTML = `<div class="form-message error">Write a review before submitting.</div>`;
    return;
  }

  const res = await apiPost("/api/reviews", { rating, text });
  if (!res || !res.ok || !res.data || res.data.ok === false) {
    messageEl.innerHTML = `<div class="form-message error">Could not submit your review. Please try again.</div>`;
    return;
  }

  document.getElementById("reviewText").value = "";
  document.getElementById("reviewCharCount").textContent = "0 / 500";
  picker.dataset.value = "0";
  picker.querySelectorAll(".review-star").forEach((s) => s.classList.remove("filled"));
  formEl.hidden = true;
  successEl.hidden = false;
  setTimeout(() => {
    successEl.hidden = true;
    formEl.hidden = false;
  }, 3000);

  loadReviewFeed();
});

async function loadReviewFeed() {
  const skeleton = document.getElementById("reviewFeedSkeleton");
  const feed = document.getElementById("reviewFeed");
  if (!skeleton || !feed) return;
  skeleton.hidden = false;
  feed.hidden = true;

  const res = await apiGet("/api/reviews/public");
  skeleton.hidden = true;
  feed.hidden = false;

  if (!res || !res.entries || !res.entries.length) {
    feed.innerHTML = `<div class="empty-state">No reviews yet — be the first.</div>`;
    return;
  }

  feed.innerHTML = res.entries
    .map((r) => {
      const avatarUrl = avatarUrlFor(r.userId, r.avatar, 48);
      return `
    <div class="review-card liquid-glass">
      <img class="review-card-avatar" src="${avatarUrl}" alt="" width="40" height="40">
      <div class="review-card-body">
        <div class="review-card-top">
          <span class="review-card-name">${escapeHtml(r.username || "Unknown")}</span>
          <span class="review-card-stars">${reviewStarsHtml(r.rating)}</span>
        </div>
        <p class="review-card-text">&ldquo;${escapeHtml(r.text || "")}&rdquo;</p>
      </div>
    </div>
  `;
    })
    .join("");
}

async function loadBocReviews() {
  const skeleton = document.getElementById("bocReviewsSkeleton");
  const list = document.getElementById("bocReviewsList");
  skeleton.hidden = false;
  list.hidden = true;

  const res = await bocGet("/api/boc/reviews");
  if (!res) return;
  if (res.reason) return bocShowDenied(res.reason);

  skeleton.hidden = true;
  list.hidden = false;

  if (!res.ok || !res.entries || !res.entries.length) {
    list.innerHTML = `<div class="empty-state">No reviews submitted yet.</div>`;
    return;
  }

  list.innerHTML = res.entries
    .map((r) => {
      const avatarUrl = avatarUrlFor(r.userId, r.avatar, 48);
      return `
    <div class="review-card liquid-glass">
      <img class="review-card-avatar" src="${avatarUrl}" alt="" width="40" height="40">
      <div class="review-card-body">
        <div class="review-card-top">
          <span class="review-card-name">${escapeHtml(r.username || "Unknown")}</span>
          <span class="review-card-stars">${reviewStarsHtml(r.rating)}</span>
        </div>
        <p class="review-card-text">&ldquo;${escapeHtml(r.text || "")}&rdquo;</p>
        <div class="review-card-footer">
          <span class="notif-dropdown-item-time">${r.created_at ? new Date(r.created_at * 1000).toLocaleString() : ""}</span>
          <button class="lookup-action-btn review-delete-btn" data-review-id="${escapeHtml(r._id || "")}">Delete</button>
        </div>
      </div>
    </div>
  `;
    })
    .join("");

  list.querySelectorAll(".review-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const res = await apiPost("/api/boc/reviews/delete", { reviewId: btn.dataset.reviewId });
      if (res && res.ok && res.data && res.data.ok) {
        loadBocReviews();
      } else {
        btn.disabled = false;
      }
    });
  });
}

// ── Contact Us ──

document.getElementById("contactForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const messageEl = document.getElementById("contactFormMessage");
  const successEl = document.getElementById("contactFormSuccess");
  const formEl = document.getElementById("contactForm");
  const message = document.getElementById("contactMessage").value.trim();
  const category = document.getElementById("contactCategorySelect").value;
  const reason = document.getElementById("contactReason").value.trim();
  if (!message) return;

  const res = await apiPost("/api/contact", { message, page: "contact", category, reason });
  if (!res || !res.ok || !res.data || res.data.ok === false) {
    messageEl.innerHTML = `<div class="form-message error">Could not send your message. Please try again.</div>`;
    return;
  }
  messageEl.innerHTML = "";
  document.getElementById("contactMessage").value = "";
  document.getElementById("contactReason").value = "";
  formEl.hidden = true;
  successEl.hidden = false;
  setTimeout(() => {
    successEl.hidden = true;
    formEl.hidden = false;
  }, 3000);
});

// ── Anonymous Feedback ──

document.getElementById("anonFeedbackForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const messageEl = document.getElementById("anonFeedbackMessageResult");
  const successEl = document.getElementById("anonFeedbackSuccess");
  const formEl = document.getElementById("anonFeedbackForm");
  const message = document.getElementById("anonFeedbackMessage").value.trim();
  if (!message) return;

  const res = await apiPost("/api/feedback/anonymous", { message });
  if (!res || !res.ok || !res.data || res.data.ok === false) {
    messageEl.innerHTML = `<div class="form-message error">Could not submit feedback. Please try again.</div>`;
    return;
  }
  messageEl.innerHTML = "";
  document.getElementById("anonFeedbackMessage").value = "";
  formEl.hidden = true;
  successEl.hidden = false;
  setTimeout(() => {
    successEl.hidden = true;
    formEl.hidden = false;
  }, 3000);
});

// ── Nav wiring ──

document.querySelectorAll(".period-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const period = btn.dataset.period;
    document.querySelectorAll(".period-btn").forEach((b) => b.classList.toggle("active", b === btn));

    const customRow = document.getElementById("customRangeRow");
    if (period === "custom") {
      customRow.hidden = false;
      return; // wait for "Apply" before fetching
    }
    customRow.hidden = true;
    loadLeaderboard(period);
  });
});

// "Live" gets a small pulsing dot baked into its button label.
document.querySelector('.period-btn[data-period="live"]').insertAdjacentHTML(
  "afterbegin",
  `<span class="live-dot"></span>`
);

document.getElementById("customRangeApply").addEventListener("click", () => {
  const startInput = document.getElementById("customRangeStart").value;
  const endInput = document.getElementById("customRangeEnd").value;
  if (!startInput || !endInput) return;
  customRangeValues = {
    start: Math.floor(new Date(startInput).getTime() / 1000),
    end: Math.floor(new Date(endInput).getTime() / 1000) + 86399, // include the whole end day
  };
  loadLeaderboard("custom");
});

document.querySelectorAll(".shift-type-filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentLeaderboardShiftType = btn.dataset.shiftType;
    document
      .querySelectorAll(".shift-type-filter-btn")
      .forEach((b) => b.classList.toggle("active", b === btn));
    loadLeaderboard();
  });
});

// ── Bug 5: shared slow-load overlay ──
// Any panel load that takes longer than SLOW_LOAD_THRESHOLD_MS gets a
// spinner + rotating fun-fact/tip instead of just sitting on its bare
// skeleton. Wraps a panel's load call(s) rather than duplicating
// show/hide/timer logic in every individual load* function.
const SLOW_LOAD_THRESHOLD_MS = 600;
const LOADING_TIPS = [
  "Tip: you can start, break, and end a shift right from the Shift Management page - no need to touch a Discord command.",
  "Did you know? The AI Assistant (bottom-right) can start or end your shift for you if you just ask.",
  "Tip: the Leaderboard's \"Live\" filter tracks duty time since the last period reset, not just the last 7 days.",
  "Did you know? Your quota progress ring on Shift Management updates automatically as you rack up hours.",
  "Tip: check Recognized Officers for staff who've logged 100+ hours and 6+ months of tenure.",
  "Did you know? LOA and RA requests submitted here post the same embed the bot posts for in-Discord requests.",
  "Tip: Personal Settings lets you turn on Reduce Motion if the animations aren't your thing.",
  "Did you know? The Department Feed shows recent promotions and accepted applications in one place.",
  "Tip: online FTOs show up live on the RA page so you know who's available before requesting.",
  "Did you know? Your duty time is broken down by CHP and SEU shift type right on your Profile page.",
  "Tip: use the Custom range on the Leaderboard to pull duty totals for any specific date window.",
  "Did you know? Badges on your Profile page track streaks, tenure, and RA passes - keep showing up to earn more.",
  "Tip: the on-duty badge next to the Leaderboard filters shows exactly how many officers are active right now.",
  "Did you know? You can filter the Leaderboard to just CHP or just SEU duty time.",
  "Tip: Contact Us messages go straight to the developer as a Discord DM - use it for bugs or questions.",
  "Did you know? Session info in Personal Settings shows exactly when your login expires.",
  "Tip: shift streaks count consecutive days with at least one completed shift - today doesn't break yesterday's streak.",
];
// Contextual tips (user request): whatever's actually pending (see
// loadingOverlayPending, keyed by load-function name, same keys as
// LOAD_LABELS below) gets tips relevant to that page instead of a fully
// random pool that might show a Leaderboard tip while History is loading.
// Falls back to the full LOADING_TIPS pool when nothing pending has a
// specific list (e.g. loadHistory, loadSessionInfo).
const LOADING_TIPS_BY_FN = {
  loadShiftManagement: [
    "Tip: you can start, break, and end a shift right from the Shift Management page - no need to touch a Discord command.",
    "Did you know? Your quota progress ring on Shift Management updates automatically as you rack up hours.",
    "Did you know? The AI Assistant (bottom-right) can start or end your shift for you if you just ask.",
  ],
  loadMiniLeaderboard: [
    "Tip: the Leaderboard's \"Live\" filter tracks duty time since the last period reset, not just the last 7 days.",
  ],
  loadQuotaRing: [
    "Did you know? Your quota progress ring on Shift Management updates automatically as you rack up hours.",
  ],
  loadOnDutyCard: [
    "Tip: the on-duty badge next to the Leaderboard filters shows exactly how many officers are active right now.",
  ],
  loadLeaderboard: [
    "Tip: the Leaderboard's \"Live\" filter tracks duty time since the last period reset, not just the last 7 days.",
    "Tip: use the Custom range on the Leaderboard to pull duty totals for any specific date window.",
    "Did you know? You can filter the Leaderboard to just CHP or just SEU duty time.",
    "Tip: the on-duty badge next to the Leaderboard filters shows exactly how many officers are active right now.",
  ],
  loadRecognizedOfficers: [
    "Tip: check Recognized Officers for staff who've logged 100+ hours and 6+ months of tenure.",
  ],
  loadDepartmentFeed: [
    "Did you know? The Department Feed shows recent promotions and accepted applications in one place.",
  ],
  loadLoa: [
    "Did you know? LOA and RA requests submitted here post the same embed the bot posts for in-Discord requests.",
  ],
  loadRa: [
    "Tip: online FTOs show up live on the RA page so you know who's available before requesting.",
    "Tip: shift streaks count consecutive days with at least one completed shift - today doesn't break yesterday's streak.",
  ],
  loadProfile: [
    "Did you know? Your duty time is broken down by CHP and SEU shift type right on your Profile page.",
    "Did you know? Badges on your Profile page track streaks, tenure, and RA passes - keep showing up to earn more.",
  ],
  loadSettings: [
    "Tip: Personal Settings lets you turn on Reduce Motion if the animations aren't your thing.",
    "Did you know? Session info in Personal Settings shows exactly when your login expires.",
  ],
};
let loadingOverlayTimer = null;
let loadingOverlayTipInterval = null;
let loadingOverlayElapsedInterval = null;
let loadingOverlayStartedAt = null;
let loadingOverlayPending = new Set();

// Friendly names for whatever's still in-flight, shown in the status line
// instead of a mystery spinner. Falls back to the raw name if unlisted.
const LOAD_LABELS = {
  loadShiftManagement: "your shift, quota, and leaderboard",
  refreshCurrentShift: "your current shift",
  loadMiniLeaderboard: "this week's leaderboard",
  loadQuotaRing: "your quota progress",
  loadQuickStats: "your quick stats",
  loadOnDutyCard: "who's on duty",
  loadLeaderboard: "the leaderboard",
  loadLoa: "your LOA/RA history",
  loadRa: "the RA page",
  loadHistory: "your shift history",
  loadProfile: "your profile",
  loadSettings: "your settings",
  loadSessionInfo: "session info",
  loadRecognizedOfficers: "recognized officers",
  loadDepartmentFeed: "the department feed",
};

function _updateLoadingOverlayStatus() {
  const statusEl = document.getElementById("loadingOverlayStatus");
  if (!statusEl) return;
  const names = [...loadingOverlayPending].map((n) => LOAD_LABELS[n] || n);
  statusEl.textContent = names.length ? `Loading ${names.join(", ")}...` : "Loading...";
}

function _updateLoadingOverlayElapsed() {
  const elapsedEl = document.getElementById("loadingOverlayElapsed");
  if (!elapsedEl || !loadingOverlayStartedAt) return;
  const seconds = Math.max(0, Math.round((Date.now() - loadingOverlayStartedAt) / 1000));
  // Not a precise ETA (network conditions vary too much to promise one) -
  // gives the user a sense of "still working, not frozen" instead.
  elapsedEl.textContent = seconds < 8 ? `${seconds}s elapsed` : `${seconds}s elapsed - hang tight, this one's slow`;
}

function showLoadingOverlay() {
  const overlay = document.getElementById("loadingOverlay");
  const tipEl = document.getElementById("loadingOverlayTip");
  if (!overlay || !tipEl) return;
  const pickTip = () => {
    const relevant = [...loadingOverlayPending].flatMap((fn) => LOADING_TIPS_BY_FN[fn] || []);
    const pool = relevant.length ? relevant : LOADING_TIPS;
    tipEl.textContent = pool[Math.floor(Math.random() * pool.length)];
  };
  pickTip();
  _updateLoadingOverlayStatus();
  loadingOverlayStartedAt = Date.now();
  _updateLoadingOverlayElapsed();
  overlay.hidden = false;
  clearInterval(loadingOverlayTipInterval);
  clearInterval(loadingOverlayElapsedInterval);
  loadingOverlayTipInterval = setInterval(pickTip, 4000);
  loadingOverlayElapsedInterval = setInterval(_updateLoadingOverlayElapsed, 1000);
}

function hideLoadingOverlay() {
  clearTimeout(loadingOverlayTimer);
  clearInterval(loadingOverlayTipInterval);
  clearInterval(loadingOverlayElapsedInterval);
  loadingOverlayTimer = null;
  loadingOverlayStartedAt = null;
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.hidden = true;
}

// Runs `loadFns` (one or more load* functions, called immediately, may be
// async or fire-and-forget) and shows the overlay only if they're still
// running after SLOW_LOAD_THRESHOLD_MS. Safe to call with functions that
// don't return a promise - Promise.resolve() normalizes them. Tracks each
// individually so the overlay's status line can name exactly what's still
// pending, and drops items off that list as they finish rather than only
// showing a generic spinner until everything settles at once.
function withLoadingOverlay(...loadFns) {
  clearTimeout(loadingOverlayTimer);
  loadingOverlayPending = new Set(loadFns.map((fn) => fn.name || "data"));
  loadingOverlayTimer = setTimeout(showLoadingOverlay, SLOW_LOAD_THRESHOLD_MS);
  const results = loadFns.map((fn) => {
    const name = fn.name || "data";
    let promise;
    try {
      promise = Promise.resolve(fn());
    } catch (err) {
      promise = Promise.reject(err);
    }
    return promise.finally(() => {
      loadingOverlayPending.delete(name);
      _updateLoadingOverlayStatus();
    });
  });
  Promise.allSettled(results).then(hideLoadingOverlay);
}

document.querySelectorAll(".nav-item[data-section]").forEach((item) => {
  item.addEventListener("click", () => {
    const section = item.dataset.section;
    showPanel(section);
    if (section === "shift-management") withLoadingOverlay(loadShiftManagement);
    if (section === "loa-ra") withLoadingOverlay(loadLoa, loadRa);
    if (section === "history") withLoadingOverlay(loadHistory);
    if (section === "profile") withLoadingOverlay(loadProfile);
    if (section === "settings") withLoadingOverlay(loadSettings, loadSessionInfo);
    if (section === "reviews") withLoadingOverlay(loadReviewFeed);
    if (section === "leaderboard") {
      withLoadingOverlay(loadLeaderboard, loadRecognizedOfficers, loadDepartmentFeed);
      startLeaderboardAutoRefresh();
    } else {
      stopLeaderboardAutoRefresh();
    }
  });
});

// ── Reduce Motion + Accent Color + Background (client-only prefs,
// localStorage) ── Dashboard-rendering concerns only, per the plan: not a
// bot-side user_settings field, so these never touch the bridge/bot.
const REDUCE_MOTION_KEY = "chp_reduce_motion";
const ACCENT_COLOR_KEY = "chp_accent_color";
const BG_COLOR_KEY = "chp_bg_color";
const DEFAULT_ACCENT = "#c9a66b"; // matches --chp-gold in assets/chp-theme.css
const DEFAULT_BG = "#1c1708"; // matches html/body's default linear-gradient base

function applyReduceMotion(on) {
  document.body.classList.toggle("reduce-motion", on);
  const toggle = document.getElementById("reduceMotionToggle");
  if (toggle) {
    toggle.classList.toggle("on", on);
    toggle.dataset.value = String(on);
  }
}

function applyAccentColor(hex) {
  const root = document.documentElement.style;
  root.setProperty("--chp-gold", hex);
  root.setProperty("--chp-gold-bright", hex);
  root.setProperty("--chp-gold-dim", hex);
  root.setProperty("--chp-gold-soft", hex);
  const input = document.getElementById("accentColorInput");
  if (input) input.value = hex;
}

// Derives a subtle dark gradient from the user's chosen base color, kept
// dark enough (low lightness mix toward black) that the gold/white text and
// card contrast established elsewhere stays legible - never a literal bright
// wash across the whole dashboard.
function shadeHex(hex, targetMix) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const mix = (channel) => Math.round(channel * targetMix);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function applyBackgroundColor(hex) {
  const root = document.documentElement.style;
  root.setProperty("--chp-bg-glow", `${hex}2e`); // ~18% alpha, matches the default glow's opacity
  root.setProperty("--chp-bg-1", shadeHex(hex, 0.55));
  root.setProperty("--chp-bg-2", shadeHex(hex, 0.28));
  root.setProperty("--chp-bg-3", shadeHex(hex, 0.12));
  const input = document.getElementById("bgColorInput");
  if (input) input.value = hex;
}

// ── Bottom-left sidebar footer (item 4): Discord/Slack-style settings gear
// + account avatar, each opening a small floating panel instead of a full
// page nav. Wired once bootMe() has the logged-in `me` object.
const THEME_KEY = "chp_theme";

function closeSidebarFloatPanels(except) {
  ["sidebarGearPanel", "sidebarAccountPanel"].forEach((id) => {
    if (id === except) return;
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
}

function buildSidebarFooter(me) {
  const nameEl = document.getElementById("sidebarFooterName");
  const avatarImg = document.getElementById("sidebarFooterAvatarImg");
  if (nameEl) nameEl.textContent = displayNameFor(me);
  if (avatarImg) avatarImg.src = avatarUrlFor(me.userId, me.avatar, 64);

  const gearBtn = document.getElementById("sidebarGearBtn");
  const gearPanel = document.getElementById("sidebarGearPanel");
  const avatarBtn = document.getElementById("sidebarAvatarBtn");
  const accountPanel = document.getElementById("sidebarAccountPanel");

  gearBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = gearPanel.hidden;
    closeSidebarFloatPanels();
    gearPanel.hidden = !willOpen;
  });
  avatarBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = accountPanel.hidden;
    closeSidebarFloatPanels();
    accountPanel.hidden = !willOpen;
  });
  document.addEventListener("click", (e) => {
    if (!gearPanel?.hidden && !gearPanel.contains(e.target) && e.target !== gearBtn) gearPanel.hidden = true;
    if (!accountPanel?.hidden && !accountPanel.contains(e.target) && e.target !== avatarBtn) accountPanel.hidden = true;
  });

  // Quick Settings panel: mirrors the full Personal Settings accent-color +
  // reduce-effects controls (same localStorage keys), so changing either one
  // here or on the full Settings page stays in sync.
  const quickAccent = document.getElementById("quickAccentColorInput");
  if (quickAccent) {
    quickAccent.value = localStorage.getItem(ACCENT_COLOR_KEY) || DEFAULT_ACCENT;
    quickAccent.addEventListener("input", (e) => {
      localStorage.setItem(ACCENT_COLOR_KEY, e.target.value);
      applyAccentColor(e.target.value);
    });
  }
  const quickReduce = document.getElementById("quickReduceEffectsToggle");
  if (quickReduce) {
    const on = localStorage.getItem(GLASS_REDUCE_KEY) === "true";
    quickReduce.classList.toggle("on", on);
    quickReduce.dataset.value = String(on);
    quickReduce.addEventListener("click", () => {
      const next = localStorage.getItem(GLASS_REDUCE_KEY) !== "true";
      localStorage.setItem(GLASS_REDUCE_KEY, String(next));
      quickReduce.classList.toggle("on", next);
      quickReduce.dataset.value = String(next);
      document.querySelectorAll(".liquid-glass-distort").forEach((el) => {
        el.classList.toggle("liquid-glass-distort-off", next);
      });
      const fullToggle = document.getElementById("reduceEffectsToggle");
      if (fullToggle) {
        fullToggle.classList.toggle("on", next);
        fullToggle.dataset.value = String(next);
      }
    });
  }
  document.getElementById("sidebarGearFullSettingsBtn")?.addEventListener("click", () => {
    gearPanel.hidden = true;
    document.querySelector('.nav-item[data-section="settings"]')?.click();
  });

  // Account panel: theme toggle (persisted; a full light-mode stylesheet is
  // a separate, larger pass - this wires the mechanism and persists the
  // choice now rather than leaving it unbuilt), switch accounts (no
  // multi-session-in-one-browser concept exists, so this just logs out and
  // returns to login for a different Discord account), and log out.
  document.getElementById("sidebarThemeToggleBtn")?.addEventListener("click", () => {
    const current = localStorage.getItem(THEME_KEY) || "dark";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    document.documentElement.dataset.theme = next;
  });
  document.getElementById("sidebarSwitchAccountsBtn")?.addEventListener("click", async () => {
    await apiPost("/api/logout", {});
    localStorage.removeItem(SESSION_TOKEN_KEY);
    window.location.href = "index.html?switch=1";
  });
  document.getElementById("sidebarLogoutBtn")?.addEventListener("click", async () => {
    await apiPost("/api/logout", {});
    localStorage.removeItem(SESSION_TOKEN_KEY);
    window.location.href = "index.html";
  });

  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
}

function initPersonalPrefs() {
  applyReduceMotion(localStorage.getItem(REDUCE_MOTION_KEY) === "true");
  applyAccentColor(localStorage.getItem(ACCENT_COLOR_KEY) || DEFAULT_ACCENT);
  applyBackgroundColor(localStorage.getItem(BG_COLOR_KEY) || DEFAULT_BG);

  document.getElementById("reduceMotionToggle")?.addEventListener("click", () => {
    const next = localStorage.getItem(REDUCE_MOTION_KEY) !== "true";
    localStorage.setItem(REDUCE_MOTION_KEY, String(next));
    applyReduceMotion(next);
  });

  const reduceEffectsToggle = document.getElementById("reduceEffectsToggle");
  if (reduceEffectsToggle) {
    const on = localStorage.getItem(GLASS_REDUCE_KEY) === "true";
    reduceEffectsToggle.classList.toggle("on", on);
    reduceEffectsToggle.dataset.value = String(on);
    if (on) {
      document.querySelectorAll(".liquid-glass-distort").forEach((el) => el.classList.add("liquid-glass-distort-off"));
    }
    reduceEffectsToggle.addEventListener("click", () => {
      const next = localStorage.getItem(GLASS_REDUCE_KEY) !== "true";
      localStorage.setItem(GLASS_REDUCE_KEY, String(next));
      reduceEffectsToggle.classList.toggle("on", next);
      reduceEffectsToggle.dataset.value = String(next);
      document.querySelectorAll(".liquid-glass-distort").forEach((el) => {
        el.classList.toggle("liquid-glass-distort-off", next);
      });
    });
  }

  const bannersToggle = document.getElementById("bannersToggle");
  if (bannersToggle) {
    const enabled = bannersEnabled();
    bannersToggle.classList.toggle("on", enabled);
    bannersToggle.dataset.value = String(enabled);
    bannersToggle.addEventListener("click", () => {
      const next = !bannersEnabled();
      localStorage.setItem(BANNERS_ENABLED_KEY, String(next));
      bannersToggle.classList.toggle("on", next);
      bannersToggle.dataset.value = String(next);
      document.querySelectorAll(".dashboard-banner").forEach((el) => { el.hidden = !next; });
    });
  }

  document.getElementById("accentColorInput")?.addEventListener("input", (e) => {
    localStorage.setItem(ACCENT_COLOR_KEY, e.target.value);
    applyAccentColor(e.target.value);
  });

  document.getElementById("accentColorReset")?.addEventListener("click", () => {
    localStorage.removeItem(ACCENT_COLOR_KEY);
    applyAccentColor(DEFAULT_ACCENT);
  });

  document.getElementById("bgColorInput")?.addEventListener("input", (e) => {
    localStorage.setItem(BG_COLOR_KEY, e.target.value);
    applyBackgroundColor(e.target.value);
  });

  document.getElementById("bgColorReset")?.addEventListener("click", () => {
    localStorage.removeItem(BG_COLOR_KEY);
    applyBackgroundColor(DEFAULT_BG);
  });
}
initPersonalPrefs();

async function loadSessionInfo() {
  const statusEl = document.getElementById("sessionInfoStatus");
  if (!statusEl) return;
  const res = await apiGet("/api/session");
  if (!res || res.ok === false) {
    statusEl.textContent = "Unavailable";
    return;
  }
  const issued = res.issuedAt ? new Date(res.issuedAt * 1000).toLocaleString() : "unknown";
  const expires = res.expiresAt ? new Date(res.expiresAt * 1000).toLocaleString() : "unknown";
  statusEl.textContent = res.remember
    ? `On - signed in ${issued}, expires ${expires}`
    : `Off - signed in ${issued}, expires ${expires} (this session)`;
}
loadSessionInfo();

async function loadSessionDevices() {
  const skeleton = document.getElementById("sessionDevicesSkeleton");
  const list = document.getElementById("sessionDevicesList");
  if (!list) return;
  const res = await apiGet("/api/sessions");
  if (skeleton) skeleton.hidden = true;
  list.hidden = false;
  if (!res || !res.sessions || res.sessions.length === 0) {
    list.innerHTML = `<div class="empty-state">No other devices on record.</div>`;
    return;
  }
  list.innerHTML = res.sessions
    .map(
      (s) => `
      <div class="settings-row" data-sid="${s.sid}">
        <div class="settings-row-text">
          <span class="settings-row-label">${s.device || "Unknown device"}</span>
          <span class="settings-row-desc">Last seen ${s.lastSeenAt ? new Date(s.lastSeenAt * 1000).toLocaleString() : "unknown"}</span>
        </div>
        <button class="lookup-action-btn" type="button" data-revoke="${s.sid}">Revoke</button>
      </div>`
    )
    .join("");
  list.querySelectorAll("[data-revoke]").forEach((btn) => {
    btn.addEventListener("click", () => {
      confirmAction("Revoke this device's access?", async () => {
        await apiPost("/api/sessions/revoke", { sid: btn.dataset.revoke });
        loadSessionDevices();
      });
    });
  });
}
loadSessionDevices();

// Two toggle buttons, one state: the in-sidebar chevron (visible while open,
// rides the sidebar's own edge so it never overlaps the brand logo) and the
// content-pinned chevron (visible only once collapsed, per .shell.collapsed
// .content-sidebar-toggle in app.css) - both just flip the same class.
function toggleSidebar() {
  document.getElementById("shell").classList.toggle("collapsed");
}
document.getElementById("sidebarToggle").addEventListener("click", toggleSidebar);
document.getElementById("sidebarToggleCollapsed").addEventListener("click", toggleSidebar);

// ── Sidebar categories: per-category accordion collapse (persisted) +
// collapsed-sidebar icon rail (one icon per category, click to jump/expand).
// Runs once for the static "My CHP"/"Officers" groups on load, then again
// after bootMe() appends the tier-gated groups (High Ranks/BOC/Developer) -
// idempotent via data-wired flags so re-running never double-binds.
const NAV_CAT_COLLAPSE_KEY = (cat) => `chp_nav_cat_collapsed_${cat}`;

function setCategoryCollapsed(group, collapsed) {
  const header = group.querySelector(".nav-category-header");
  group.classList.toggle("cat-collapsed", collapsed);
  if (header) header.setAttribute("aria-expanded", String(!collapsed));
}

function refreshSidebarCategories() {
  // Wire each category header's chevron toggle (skip already-wired ones).
  document.querySelectorAll(".nav-group[data-category]").forEach((group) => {
    const category = group.dataset.category;
    const header = group.querySelector(".nav-category-header");
    if (!header || header.dataset.wired) return;
    header.dataset.wired = "1";

    const stored = localStorage.getItem(NAV_CAT_COLLAPSE_KEY(category));
    setCategoryCollapsed(group, stored === "1");

    header.addEventListener("click", () => {
      const collapsed = !group.classList.contains("cat-collapsed");
      setCategoryCollapsed(group, collapsed);
      localStorage.setItem(NAV_CAT_COLLAPSE_KEY(category), collapsed ? "1" : "0");
    });
  });

  // Rebuild the collapsed-state icon rail from whatever categories currently
  // exist in the DOM (varies by tier - a regular member only ever sees
  // My CHP + Officers, a developer sees all five).
  const rail = document.getElementById("sidebarIconRail");
  if (!rail) return;
  rail.innerHTML = "";
  document.querySelectorAll(".nav-group[data-category]").forEach((group) => {
    const category = group.dataset.category;
    const iconSvg = group.querySelector(".nav-category-icon")?.innerHTML || "";
    const label = group.querySelector(".nav-category-label")?.textContent || category;
    const btn = document.createElement("button");
    btn.className = "rail-icon-btn";
    btn.type = "button";
    btn.dataset.category = category;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = `<span class="nav-category-icon" aria-hidden="true">${iconSvg}</span>`;
    btn.addEventListener("click", () => {
      // Expand the sidebar, make sure this category's items are open, then
      // scroll it into view - "go somewhere about that category" from the
      // rail without having to hunt through a fully-open list first.
      document.getElementById("shell").classList.remove("collapsed");
      setCategoryCollapsed(group, false);
      localStorage.setItem(NAV_CAT_COLLAPSE_KEY(category), "0");
      group.scrollIntoView({ block: "nearest" });
    });
    rail.appendChild(btn);
  });
}
refreshSidebarCategories();

document.getElementById("lookupSearchBtn").addEventListener("click", performLookupSearch);
document.getElementById("lookupSearchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") performLookupSearch();
});
// Live, incremental, narrowing search-as-you-type (matches the Officers
// roster's live-filter feel). Debounced lightly since this one is
// server-backed - the Officers roster filter is local so it needs none.
let lookupSearchDebounceTimer = null;
document.getElementById("lookupSearchInput").addEventListener("input", (e) => {
  const query = e.target.value.trim();
  if (lookupSearchDebounceTimer) clearTimeout(lookupSearchDebounceTimer);
  lookupSearchDebounceTimer = setTimeout(() => {
    runLookupSearch(query);
  }, 200);
});

// ── AI Assistant (floating panel, present on every page) ──

// Item requested: chats should follow the ACCOUNT, not just this browser's
// localStorage (which meant a different device/browser saw no history at
// all) - conversations now live server-side per user (see /api/ai/
// conversations*), fetched lazily. localStorage keeps exactly one thing:
// which conversation was last open on THIS device, purely a UX convenience.
const AI_ACTIVE_CONVERSATION_KEY = "chp_ai_active_conversation_id";
let aiConversations = []; // [{id, title, messages: [...] | undefined (not fetched yet)}]
let aiActiveConversationId = null;
let aiPendingProposal = null; // { proposalId } for the most recent unconfirmed proposal
let aiTypingSlowTimer = null; // pending "Still working..." swap for the in-flight request

const MAX_AI_MESSAGES_PER_CONVERSATION = 300;

async function aiFetchConversationsList() {
  try {
    const res = await apiGet("/api/ai/conversations");
    return (res && res.entries) || [];
  } catch (e) {
    return [];
  }
}

async function aiFetchConversationMessages(id) {
  try {
    const res = await apiGet(`/api/ai/conversations/${id}`);
    return res && res.conversation ? res.conversation.messages || [] : null;
  } catch (e) {
    return null;
  }
}

// Fire-and-forget - a save hiccup shouldn't block the chat UI from
// continuing to work locally for the rest of this page load.
function aiPersistConversation(convo) {
  if (!convo) return;
  if (convo.messages.length > MAX_AI_MESSAGES_PER_CONVERSATION) {
    convo.messages = convo.messages.slice(-MAX_AI_MESSAGES_PER_CONVERSATION);
  }
  apiPost("/api/ai/conversations", {
    conversationId: convo.id,
    title: convo.title || "New Chat",
    messages: convo.messages,
  }).catch(() => {});
}

function aiCreateConversationObject() {
  // `persisted: false` until the first message actually sends - avoids
  // littering the sidebar with empty drafts from every "New Chat" click.
  return { id: crypto.randomUUID(), title: "New Chat", messages: [], persisted: false };
}

function aiGetActiveConversation() {
  return aiConversations.find((c) => c.id === aiActiveConversationId) || aiConversations[0];
}

function aiPopulateConvoMenu() {
  const list = document.getElementById("aiSidebarList");
  if (!list) return;

  list.innerHTML = "";
  aiConversations.forEach((c) => {
    const row = document.createElement("div");
    row.className = "ai-convo-row" + (c.id === aiActiveConversationId ? " active" : "");
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(c.id === aiActiveConversationId));
    row.title = c.title || "New Chat";

    const title = document.createElement("span");
    title.className = "ai-convo-row-title";
    title.textContent = c.title || "New Chat";
    row.appendChild(title);

    // Only offer delete when there's more than one conversation - always
    // keeping at least one avoids an empty-sidebar dead end.
    if (aiConversations.length > 1) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "ai-convo-row-delete";
      del.setAttribute("aria-label", `Delete "${c.title || "New Chat"}"`);
      del.textContent = "×";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        aiDeleteConversation(c.id);
      });
      row.appendChild(del);
    }

    row.addEventListener("click", () => {
      aiSwitchConversation(c.id);
      if (aiPanelIsMobile()) document.getElementById("aiPanel").classList.add("sidebar-collapsed");
    });
    list.appendChild(row);
  });
}

function aiToggleSidebar() {
  const panel = document.getElementById("aiPanel");
  if (panel) panel.classList.toggle("sidebar-collapsed");
}

function aiDeleteConversation(id) {
  const idx = aiConversations.findIndex((c) => c.id === id);
  if (idx === -1 || aiConversations.length <= 1) return;
  const [removed] = aiConversations.splice(idx, 1);
  if (removed.persisted) {
    apiDelete(`/api/ai/conversations/${id}`).catch(() => {});
  }
  if (aiActiveConversationId === id) {
    aiActiveConversationId = aiConversations[0].id;
    aiSaveActiveConversationId();
    aiEnsureConversationLoaded(aiActiveConversationId).then(aiRenderActiveConversation);
  }
  aiPopulateConvoMenu();
}

function aiUpdateEmptyState() {
  const messages = document.getElementById("aiMessages");
  if (!messages) return;
  const hasContent = messages.querySelector(".ai-bubble, .ai-typing, .ai-proposal-actions");
  let empty = messages.querySelector(".ai-empty-state");
  if (hasContent) {
    if (empty) empty.remove();
    return;
  }
  if (!empty) {
    empty = document.createElement("div");
    empty.className = "empty-state ai-empty-state";
    empty.textContent = "Ask me anything about CHP — shifts, ranks, quota, and more.";
    messages.appendChild(empty);
  }
}

function aiRenderActiveConversation() {
  const messages = document.getElementById("aiMessages");
  if (!messages) return;
  messages.innerHTML = "";
  const convo = aiGetActiveConversation();
  if (!convo) return;
  (convo.messages || []).forEach((m) => {
    aiAppendBubble(m.role, m.content);
  });
  aiUpdateEmptyState();
}

function aiSaveActiveConversationId() {
  try {
    localStorage.setItem(AI_ACTIVE_CONVERSATION_KEY, aiActiveConversationId || "");
  } catch (e) {
    // ignore storage errors (e.g. private mode quota)
  }
}

// Fetches a conversation's messages the first time it's opened, caching
// them on the in-memory object afterward - switching back and forth is
// then instant, only ever hitting the network once per conversation per
// page load.
async function aiEnsureConversationLoaded(id) {
  const convo = aiConversations.find((c) => c.id === id);
  if (!convo || convo.messages !== undefined) return;
  const fetched = await aiFetchConversationMessages(id);
  convo.messages = fetched || [];
}

async function aiInitConversations() {
  const entries = await aiFetchConversationsList();
  aiConversations = entries.map((e) => ({ id: e._id, title: e.title || "New Chat", messages: undefined, persisted: true }));

  if (aiConversations.length === 0) {
    aiConversations = [aiCreateConversationObject()];
  }

  let savedActiveId = null;
  try {
    savedActiveId = localStorage.getItem(AI_ACTIVE_CONVERSATION_KEY);
  } catch (e) {
    savedActiveId = null;
  }
  aiActiveConversationId = (savedActiveId && aiConversations.some((c) => c.id === savedActiveId))
    ? savedActiveId
    : aiConversations[0].id;

  await aiEnsureConversationLoaded(aiActiveConversationId);
  aiPopulateConvoMenu();
  aiRenderActiveConversation();
}

function aiNewChat() {
  const convo = aiCreateConversationObject();
  aiConversations.unshift(convo);
  aiActiveConversationId = convo.id;
  aiSaveActiveConversationId();
  aiPopulateConvoMenu();
  aiRenderActiveConversation();
  const input = document.getElementById("aiInput");
  if (input) input.focus();
}

async function aiSwitchConversation(id) {
  if (!aiConversations.some((c) => c.id === id)) return;
  aiActiveConversationId = id;
  aiSaveActiveConversationId();
  aiPopulateConvoMenu();
  await aiEnsureConversationLoaded(id);
  // The user could have switched again while the fetch above was in
  // flight - only render if this is still the active conversation.
  if (aiActiveConversationId === id) aiRenderActiveConversation();
}

// Item requested: users can export a chat. Plain markdown transcript,
// downloaded client-side - no backend involved.
function aiExportActiveConversation() {
  const convo = aiGetActiveConversation();
  if (!convo || !(convo.messages || []).length) return;
  const lines = [`# ${convo.title || "CHP AI Assistant chat"}`, ""];
  for (const m of convo.messages) {
    const who = m.role === "user" ? "You" : "CHP Assistant";
    const when = m.timestamp ? new Date(m.timestamp).toLocaleString() : "";
    lines.push(`**${who}**${when ? ` — ${when}` : ""}`);
    lines.push(m.content || "");
    lines.push("");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeTitle = (convo.title || "chat").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 50);
  a.download = `chp-ai-chat-${safeTitle || "export"}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function aiAppendBubble(role, text, imageDataUrl) {
  const messages = document.getElementById("aiMessages");
  const empty = messages ? messages.querySelector(".ai-empty-state") : null;
  if (empty) empty.remove();
  const bubble = document.createElement("div");
  bubble.className = `ai-bubble ${role}`;
  if (imageDataUrl) {
    const img = document.createElement("img");
    img.className = "ai-bubble-image";
    img.src = imageDataUrl;
    img.alt = "Attached image";
    bubble.appendChild(img);
    if (text) {
      const textEl = document.createElement("div");
      textEl.className = "ai-bubble-text";
      textEl.textContent = text;
      bubble.appendChild(textEl);
    }
  } else {
    bubble.textContent = text;
  }
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

// Client-side "typewriter" reveal for assistant replies. This is NOT real
// token streaming (the bot's Bedrock client only does a single blocking
// converse() call) - it just reveals already-received text progressively so
// the transition from the typing indicator doesn't feel jarring.
function typewriterReveal(bubbleEl, fullText, onComplete) {
  const text = fullText || "";
  if (!text) {
    bubbleEl.textContent = "";
    if (onComplete) onComplete();
    return;
  }
  // Tuned so a ~200-char message takes ~1.5-3s while still reading as
  // distinct letter-by-letter typing rather than word-sized chunks: reveal
  // 1 character per tick whenever the overall duration clamp allows it,
  // only growing the chunk size for very long messages that would
  // otherwise blow past the outer duration bound.
  const CHUNK_MS = 32;
  const totalDurationMs = Math.min(3000, Math.max(1500, text.length * 12));
  const chunkSize = Math.max(1, Math.ceil(text.length / (totalDurationMs / CHUNK_MS)));

  const messages = document.getElementById("aiMessages");
  let i = 0;
  const timer = setInterval(() => {
    i = Math.min(text.length, i + chunkSize);
    bubbleEl.textContent = text.slice(0, i);
    if (messages) messages.scrollTop = messages.scrollHeight;
    if (i >= text.length) {
      clearInterval(timer);
      if (onComplete) onComplete();
    }
  }, CHUNK_MS);
}

function aiAppendNote(text) {
  const messages = document.getElementById("aiMessages");
  const note = document.createElement("div");
  note.className = "ai-bubble note";
  note.textContent = text;
  messages.appendChild(note);
  messages.scrollTop = messages.scrollHeight;
}

function aiShowTyping() {
  const messages = document.getElementById("aiMessages");
  const typing = document.createElement("div");
  typing.className = "ai-typing";
  typing.id = "aiTypingIndicator";
  typing.innerHTML =
    '<span class="ai-typing-label">Thinking...</span>' +
    '<span class="ai-typing-dots"><span></span><span></span><span></span></span>';
  messages.appendChild(typing);
  messages.scrollTop = messages.scrollHeight;
}

// Live status text pushed by SSE `status` events from the backend (e.g.
// "Thinking...", "Looking up your shift history...") - replaces the old
// timeout-based "Still working..." guess now that the backend actually
// tells us what it's doing.
function aiUpdateTypingText(text) {
  const indicator = document.getElementById("aiTypingIndicator");
  const label = indicator ? indicator.querySelector(".ai-typing-label") : null;
  if (label && text) label.textContent = text;
  const messages = document.getElementById("aiMessages");
  if (messages) messages.scrollTop = messages.scrollHeight;
}

function aiHideTyping() {
  if (aiTypingSlowTimer) {
    clearTimeout(aiTypingSlowTimer);
    aiTypingSlowTimer = null;
  }
  const typing = document.getElementById("aiTypingIndicator");
  if (typing) typing.remove();
}

function aiAppendProposalActions(proposalId) {
  const messages = document.getElementById("aiMessages");
  const wrap = document.createElement("div");
  wrap.className = "ai-proposal-actions";
  wrap.innerHTML = `
    <button class="ai-confirm-btn">Yes, do it</button>
    <button class="ai-dismiss-btn">Dismiss</button>
  `;
  wrap.querySelector(".ai-confirm-btn").addEventListener("click", () => aiConfirmProposal(proposalId, wrap));
  wrap.querySelector(".ai-dismiss-btn").addEventListener("click", () => {
    wrap.remove();
    aiAppendNote("okay, not doing that");
    aiPendingProposal = null;
  });
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
}

async function aiConfirmProposal(proposalId, actionsEl) {
  actionsEl.remove();
  aiShowTyping();
  const res = await apiPost("/api/ai/confirm", { proposalId });
  aiHideTyping();
  aiPendingProposal = null;
  if (!res) return; // 401 redirect already handled by apiPost
  if (!res.ok || !res.data) {
    typewriterReveal(aiAppendBubble("assistant", ""), "Something went wrong confirming that action. Please try again.");
    return;
  }
  typewriterReveal(
    aiAppendBubble("assistant", ""),
    res.data.text || (res.data.ok ? "Done." : "That action could not be completed.")
  );
}

async function aiSendMessage(message, attachedImage) {
  const convo = aiGetActiveConversation();
  aiAppendBubble("user", message, attachedImage && attachedImage.dataUrl);
  if (convo) {
    // Deliberately NOT storing the image data URL here - a single attached
    // image can be several MB of base64, which would blow through
    // localStorage's ~5-10MB quota in one message. The image only applies
    // to this one request (see historyPayload below); on reload, past
    // turns show the text with a "(image attached)" note instead of the
    // image itself.
    const storedContent = attachedImage ? `${message} (image attached)`.trim() : message;
    convo.messages.push({ role: "user", content: storedContent, timestamp: Date.now() });
    if ((!convo.title || convo.title === "New Chat") && convo.messages.filter((m) => m.role === "user").length === 1) {
      const trimmed = message.trim();
      convo.title = trimmed.length > 40 ? `${trimmed.slice(0, 37).trim()}…` : trimmed;
      aiPopulateConvoMenu();
    }
    convo.persisted = true;
    aiPersistConversation(convo);
  }
  aiShowTyping();

  // UX fix: error bubbles used to be a dead end - the user had to retype
  // their whole message to try again. Now every error bubble gets a
  // "Retry" action that just re-sends the same `message` we already have
  // in scope, wired up after the bubble is revealed below.
  const onError = (errText) => {
    aiHideTyping();
    const bubble = aiAppendBubble("assistant", "");
    bubble.classList.add("error");
    typewriterReveal(bubble, errText, () => {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "ai-retry-btn";
      retryBtn.textContent = "Retry";
      retryBtn.addEventListener("click", () => {
        retryBtn.remove();
        aiSendMessage(message, attachedImage);
      });
      bubble.appendChild(document.createElement("br"));
      bubble.appendChild(retryBtn);
      const messagesEl = document.getElementById("aiMessages");
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
    if (convo) {
      convo.messages.push({ role: "assistant", content: errText, timestamp: Date.now() });
      aiPersistConversation(convo);
    }
  };

  // Fix 1 (conversation memory): send the active conversation's prior turns
  // (excluding the just-pushed new user message) so the bot can build a
  // multi-turn Bedrock request. Capped client-side to the last 15 turns -
  // full history already lives in localStorage for display, but only a
  // bounded tail needs to go over the wire on every request.
  const historyPayload = convo
    ? convo.messages
        .slice(0, -1) // drop the user message we just pushed above - it's sent as `message`
        .slice(-15)
        .map((m) => ({ role: m.role, content: m.content }))
    : [];

  let response;
  try {
    response = await fetch(`${WORKER_URL}/api/ai/chat`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        conversationId: aiActiveConversationId,
        history: historyPayload,
        image: attachedImage ? attachedImage.dataUrl : undefined,
        imageFormat: attachedImage ? attachedImage.format : undefined,
      }),
    });
  } catch {
    onError("Sorry, the assistant is unavailable right now. Please try again later.");
    return;
  }

  if (response.status === 401) {
    window.location.href = "index.html";
    return;
  }
  if (response.status === 429) {
    const data = await response.json().catch(() => null);
    onError((data && data.text) || "Slow down a bit — try again in a moment.");
    return;
  }
  if (!response.ok || !response.body) {
    onError("Sorry, the assistant is unavailable right now. Please try again later.");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneData = null;

  // Fix 3 (real streaming) SSE consumer contract, for whoever builds chat UI
  // polish (section 6) on top of this next:
  //   - {"type": "status", "text": "..."}  -> checkpoint text only (no bubble content yet)
  //   - {"type": "chunk",  "text": "..."}  -> incremental text delta; append directly to the
  //                                            assistant bubble as it arrives (see below) - this
  //                                            REPLACES the old single-shot typewriter reveal
  //   - {"type": "done", ...fullResultPayload}  -> stream complete; same payload shape as
  //                                            before (text/type/proposalId/conversationId) for
  //                                            proposal/tool-result finalization
  // On the first "chunk" we swap the typing indicator for a live assistant
  // bubble and append into it incrementally; if no "chunk" events arrive at
  // all (e.g. the whole answer came back as tool-call JSON with no visible
  // text), we fall back to revealing "done"'s text via the old typewriter
  // effect so there's still a smooth reveal instead of a jarring pop-in.
  let streamingBubble = null;
  let streamedText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);

        const dataLine = rawEvent
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!dataLine) continue;

        let evt;
        try {
          evt = JSON.parse(dataLine.slice(5).trim());
        } catch {
          continue;
        }

        if (evt.type === "status") {
          aiUpdateTypingText(evt.text);
        } else if (evt.type === "chunk") {
          if (!streamingBubble) {
            aiHideTyping();
            streamingBubble = aiAppendBubble("assistant", "");
          }
          streamedText += evt.text || "";
          streamingBubble.textContent = streamedText;
          const messagesEl = document.getElementById("aiMessages");
          if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
        } else if (evt.type === "done") {
          doneData = evt;
        }
      }
    }
  } catch {
    onError("Sorry, something went wrong while the assistant was responding. Please try again.");
    return;
  }

  aiHideTyping();

  if (!doneData) {
    onError("Sorry, the assistant is unavailable right now. Please try again later.");
    return;
  }

  const data = doneData;
  if (convo) {
    convo.messages.push({ role: "assistant", content: data.text || "", timestamp: Date.now() });
    aiPersistConversation(convo);
  }

  const finalize = () => {
    // The SSE envelope's own "type" is always "done" here (see the matching
    // backend fix) - the result's semantic type (message/proposal) travels
    // under "resultType" instead, since both used to collide on "type".
    if (data.resultType === "proposal" && data.proposalId) {
      aiPendingProposal = { proposalId: data.proposalId };
      aiAppendProposalActions(data.proposalId);
    }
  };

  if (streamingBubble) {
    // Chunks already streamed the text in live - just make sure the final
    // bubble matches the authoritative "done" text exactly (covers e.g. the
    // one-shot confidentiality-retry answer, whose text never went through
    // the delta path), then finalize.
    streamingBubble.textContent = data.text || streamedText;
    finalize();
  } else {
    // No chunk events arrived at all - fall back to the old typewriter
    // reveal of "done"'s full text instead of a jarring instant pop-in.
    typewriterReveal(aiAppendBubble("assistant", ""), data.text || "", finalize);
  }
}

const AI_PANEL_GEOMETRY_KEY = "chp-dashboard-ai-panel-geometry";
const AI_PANEL_DEFAULT_WIDTH = 580;
const AI_PANEL_DEFAULT_HEIGHT = 650;
// Kept in sync with .ai-panel's min/max-width in app.css - the sidebar
// layout needs more room than the old dropdown-in-header did.
const AI_PANEL_MIN_WIDTH = 340;
const AI_PANEL_MIN_HEIGHT = 360;
const AI_PANEL_MAX_WIDTH = 760;

function aiPanelIsMobile() {
  return window.innerWidth <= 480;
}

function aiPanelMaxHeight() {
  return window.innerHeight * 0.9;
}

function aiClampGeometry(geo) {
  const width = Math.min(Math.max(geo.width, AI_PANEL_MIN_WIDTH), AI_PANEL_MAX_WIDTH, window.innerWidth);
  const height = Math.min(Math.max(geo.height, AI_PANEL_MIN_HEIGHT), aiPanelMaxHeight(), window.innerHeight);
  const maxLeft = Math.max(0, window.innerWidth - width);
  const maxTop = Math.max(0, window.innerHeight - height);
  const left = Math.min(Math.max(geo.left, 0), maxLeft);
  const top = Math.min(Math.max(geo.top, 0), maxTop);
  return { left, top, width, height };
}

function aiLoadGeometry() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(AI_PANEL_GEOMETRY_KEY));
  } catch (e) {
    saved = null;
  }
  const width = (saved && typeof saved.width === "number") ? saved.width : AI_PANEL_DEFAULT_WIDTH;
  const height = (saved && typeof saved.height === "number") ? saved.height : AI_PANEL_DEFAULT_HEIGHT;
  let left, top;
  if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
    left = saved.left;
    top = saved.top;
  } else {
    left = window.innerWidth - width - 22;
    top = window.innerHeight - height - 88;
  }
  return aiClampGeometry({ left, top, width, height });
}

function aiSaveGeometry(geo) {
  try {
    localStorage.setItem(AI_PANEL_GEOMETRY_KEY, JSON.stringify(geo));
  } catch (e) {
    // ignore storage errors (e.g. private mode quota)
  }
}

function aiApplyGeometry(panel, geo) {
  panel.style.left = geo.left + "px";
  panel.style.top = geo.top + "px";
  panel.style.width = geo.width + "px";
  panel.style.height = geo.height + "px";
}

function aiRestorePanelGeometry() {
  const panel = document.getElementById("aiPanel");
  if (aiPanelIsMobile()) return;
  const geo = aiLoadGeometry();
  aiApplyGeometry(panel, geo);
}

function aiInitPanelDragResize() {
  const panel = document.getElementById("aiPanel");
  const header = document.getElementById("aiPanelHeader");
  const resizeHandle = document.getElementById("aiPanelResizeHandle");

  function currentGeometry() {
    const rect = panel.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  header.addEventListener("pointerdown", (e) => {
    if (aiPanelIsMobile()) return;
    if (e.target.closest(".ai-panel-close")) return;
    e.preventDefault();
    const startGeo = currentGeometry();
    const startX = e.clientX;
    const startY = e.clientY;
    panel.classList.add("dragging");
    header.setPointerCapture(e.pointerId);

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const geo = aiClampGeometry({
        left: startGeo.left + dx,
        top: startGeo.top + dy,
        width: startGeo.width,
        height: startGeo.height,
      });
      aiApplyGeometry(panel, geo);
    }
    function onUp(ev) {
      header.releasePointerCapture(ev.pointerId);
      header.removeEventListener("pointermove", onMove);
      header.removeEventListener("pointerup", onUp);
      panel.classList.remove("dragging");
      aiSaveGeometry(currentGeometry());
    }
    header.addEventListener("pointermove", onMove);
    header.addEventListener("pointerup", onUp);
  });

  resizeHandle.addEventListener("pointerdown", (e) => {
    if (aiPanelIsMobile()) return;
    e.preventDefault();
    const startGeo = currentGeometry();
    const startX = e.clientX;
    const startY = e.clientY;
    panel.classList.add("resizing");
    resizeHandle.setPointerCapture(e.pointerId);

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const geo = aiClampGeometry({
        left: startGeo.left,
        top: startGeo.top,
        width: startGeo.width + dx,
        height: startGeo.height + dy,
      });
      aiApplyGeometry(panel, geo);
    }
    function onUp(ev) {
      resizeHandle.releasePointerCapture(ev.pointerId);
      resizeHandle.removeEventListener("pointermove", onMove);
      resizeHandle.removeEventListener("pointerup", onUp);
      panel.classList.remove("resizing");
      aiSaveGeometry(currentGeometry());
    }
    resizeHandle.addEventListener("pointermove", onMove);
    resizeHandle.addEventListener("pointerup", onUp);
  });

  window.addEventListener("resize", () => {
    if (aiPanelIsMobile()) return;
    aiSaveGeometry(aiClampGeometry(currentGeometry()));
    aiApplyGeometry(panel, aiClampGeometry(currentGeometry()));
  });
}

aiInitPanelDragResize();

function aiOpenPanel() {
  aiRestorePanelGeometry();
  const panel = document.getElementById("aiPanel");
  // Sidebar starts collapsed on phone-width panels (it would otherwise
  // overlay most of the message list on first open) - desktop keeps it
  // open, matching the pre-existing "always visible" sidebar behavior.
  panel.classList.toggle("sidebar-collapsed", aiPanelIsMobile());
  aiInitConversations();
  panel.classList.add("open");
  attachGlassPointerTracking(panel);
  document.getElementById("aiInput").focus();
}

function aiClosePanel() {
  document.getElementById("aiPanel").classList.remove("open");
}

document.getElementById("aiFab").addEventListener("click", () => {
  const panel = document.getElementById("aiPanel");
  if (panel.classList.contains("open")) {
    aiClosePanel();
  } else {
    aiOpenPanel();
  }
});

document.getElementById("aiPanelClose").addEventListener("click", aiClosePanel);
document.getElementById("aiSidebarToggle").addEventListener("click", aiToggleSidebar);
document.getElementById("aiExportBtn").addEventListener("click", aiExportActiveConversation);
document.getElementById("aiNewChatBtn").addEventListener("click", () => {
  aiNewChat();
  // On a phone-width panel the sidebar overlays the chat - collapse it
  // back after picking "New Chat" so the fresh conversation is visible.
  if (aiPanelIsMobile()) document.getElementById("aiPanel").classList.add("sidebar-collapsed");
});

// ── AI Assistant: attach-an-image ──
// Same 8 MB cap the bridge/bot enforce server-side (AI_CHAT_MAX_IMAGE_BYTES)
// - checked here too so a too-large file never even gets base64-encoded and
// sent over the wire.
const AI_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
let aiPendingImage = null; // { dataUrl, format, name } | null

function aiSetPendingImage(file) {
  if (!file.type.startsWith("image/")) {
    return alert("Please attach an image file.");
  }
  if (file.size > AI_IMAGE_MAX_BYTES) {
    return alert("That image is too large (over 8 MB) - please compress or re-screenshot it.");
  }
  const reader = new FileReader();
  reader.onload = () => {
    const format = (file.type.split("/")[1] || "png").toLowerCase();
    aiPendingImage = { dataUrl: reader.result, format, name: file.name };
    const preview = document.getElementById("aiImagePreview");
    document.getElementById("aiImagePreviewThumb").src = aiPendingImage.dataUrl;
    document.getElementById("aiImagePreviewName").textContent = file.name;
    preview.hidden = false;
    document.getElementById("aiAttachBtn").classList.add("active");
  };
  reader.readAsDataURL(file);
}

function aiClearPendingImage() {
  aiPendingImage = null;
  document.getElementById("aiImagePreview").hidden = true;
  document.getElementById("aiImagePreviewThumb").src = "";
  document.getElementById("aiAttachBtn").classList.remove("active");
  document.getElementById("aiImageInput").value = "";
}

document.getElementById("aiAttachBtn").addEventListener("click", () => {
  document.getElementById("aiImageInput").click();
});
document.getElementById("aiImageInput").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) aiSetPendingImage(file);
});
document.getElementById("aiImagePreviewRemove").addEventListener("click", aiClearPendingImage);

document.getElementById("aiInputForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("aiInput");
  const message = input.value.trim();
  if (!message && !aiPendingImage) return;
  input.value = "";
  const image = aiPendingImage;
  aiClearPendingImage();
  aiSendMessage(message || "(no message - see attached image)", image);
});

// ── Board of Commissioners tier (Phase 5) ──
// Confidential: a tester on the "management" tier gets 403
// {reason:"confidential"} from every /api/boc/* route (never real data),
// even though testers otherwise see every nav item. Every panel here checks
// for that reason and swaps in a plain denial message instead of guessing.

let bocActiveTab = "quota-enforcement";
let bocHrActiveSubTab = "promotion-list";

function bocShowDenied(reason) {
  const denied = document.getElementById("bocDenied");
  document.querySelectorAll("#panel-boc .dev-panel").forEach((p) => (p.hidden = true));
  denied.hidden = false;
  denied.textContent =
    reason === "confidential"
      ? "This section is confidential and unavailable in tester mode."
      : "This section is unavailable right now.";
}

function bocClearDenied() {
  document.getElementById("bocDenied").hidden = true;
  document.querySelectorAll("#panel-boc .dev-panel").forEach((p) => (p.hidden = false));
}

// Board of Commissioners routes return a meaningful body on 403 (reason:
// "confidential"|"forbidden") that the panel needs to render a denial
// message - apiGet() discards the body on any non-2xx status, so this uses
// its own fetch instead of apiGet for every boc/* call.
async function bocGet(path) {
  const response = await fetch(`${WORKER_URL}${path}`, { credentials: "include" });
  if (response.status === 401) {
    window.location.href = "index.html";
    return null;
  }
  return response.json().catch(() => null);
}

function loadBocActiveTab() {
  bocClearDenied();
  if (bocActiveTab === "quota-enforcement") return loadBocQuotaEnforcement();
  if (bocActiveTab === "hr-review") return loadBocHrSubTab();
  if (bocActiveTab === "promotion-recommendations") return loadBocPromotionRecommendations();
  if (bocActiveTab === "hr-oversight") return loadBocHrOversight();
  if (bocActiveTab === "leaderboard-control") return; // static panel, no data to load
  if (bocActiveTab === "schedules") return loadBocSchedules();
  if (bocActiveTab === "applications") return loadBocApplications();
  if (bocActiveTab === "watch-list") return loadBocWatchList();
  if (bocActiveTab === "inactive-officers") return loadBocInactiveOfficers();
  if (bocActiveTab === "audit-log") return loadBocAuditLog();
  if (bocActiveTab === "activity-log") return loadBocActivityLog();
  if (bocActiveTab === "anonymous-feedback") return loadBocAnonymousFeedback();
  if (bocActiveTab === "reviews") return loadBocReviews();
  if (bocActiveTab === "ra-stats") return loadBocRaStats();
  if (bocActiveTab === "settings") return loadBocSettings();
}

async function loadBocPromotionRecommendations() {
  const skeleton = document.getElementById("bocPromotionRecsSkeleton");
  const list = document.getElementById("bocPromotionRecsList");
  skeleton.hidden = false;
  list.hidden = true;

  const res = await bocGet("/api/boc/promotion-recommendations");
  if (!res) return;
  if (res.reason) return bocShowDenied(res.reason);

  skeleton.hidden = true;
  list.hidden = false;

  if (!res.ok || !res.recommendations || !res.recommendations.length) {
    list.innerHTML = `<div class="empty-state">No promotion recommendations right now.</div>`;
    return;
  }

  list.innerHTML = `<ul class="loa-history-list">${res.recommendations
    .map(
      (r) => `
    <li class="loa-history-item">
      <strong>${escapeHtml(r.username || "Unknown")}</strong>
      <span>${formatDuration(r.totalSeconds || 0)} total duty time</span>
      <span>Current rank: ${escapeHtml(r.currentRank || "Unknown")}</span>
      <span>${r.daysSinceLastPromotion != null ? `${r.daysSinceLastPromotion} days since last promotion` : "No prior promotion on record"}</span>
    </li>
  `
    )
    .join("")}</ul>`;
}

async function loadBocAnonymousFeedback() {
  const skeleton = document.getElementById("bocAnonFeedbackSkeleton");
  const list = document.getElementById("bocAnonFeedbackList");
  skeleton.hidden = false;
  list.hidden = true;

  const res = await bocGet("/api/boc/anonymous-feedback");
  if (!res) return;
  if (res.reason) return bocShowDenied(res.reason);

  skeleton.hidden = true;
  list.hidden = false;

  if (!res.ok || !res.entries || !res.entries.length) {
    list.innerHTML = `<div class="empty-state">No anonymous feedback submitted yet.</div>`;
    return;
  }

  const sorted = [...res.entries].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  list.innerHTML = sorted
    .map(
      (e) => `
    <li class="loa-history-item">
      <span>${escapeHtml(e.message || "")}</span>
      <span class="notif-dropdown-item-time">${e.createdAt ? new Date(e.createdAt).toLocaleString() : ""}</span>
    </li>
  `
    )
    .join("");
}

// Shared by the in-panel #bocTabs strip and the sidebar's per-subcategory
// nav items (added under bootMe's BOC group) so both stay in sync no matter
// which one the user actually clicks.
function bocSwitchToTab(tabName) {
  bocActiveTab = tabName;
  document.querySelectorAll("#bocTabs .dev-tab").forEach((t) => t.classList.toggle("active", t.dataset.bocTab === tabName));
  document
    .querySelectorAll("#panel-boc > .dev-panel")
    .forEach((p) => p.classList.toggle("active", p.id === `bocPanel-${tabName}`));
  document
    .querySelectorAll('.nav-item[data-boc-nav-tab]')
    .forEach((btn) => btn.classList.toggle("active", btn.dataset.bocNavTab === tabName));
  loadBocActiveTab();
}

document.querySelectorAll("#bocTabs .dev-tab").forEach((tab) => {
  tab.addEventListener("click", () => bocSwitchToTab(tab.dataset.bocTab));
});

document.querySelectorAll("#bocHrSubTabs .dev-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    bocHrActiveSubTab = tab.dataset.bocHrTab;
    document.querySelectorAll("#bocHrSubTabs .dev-tab").forEach((t) => t.classList.toggle("active", t === tab));
    document
      .querySelectorAll("#bocPanel-hr-review > .dev-panel")
      .forEach((p) => p.classList.toggle("active", p.id === `bocHrPanel-${bocHrActiveSubTab}`));
    loadBocHrSubTab();
  });
});

function loadBocHrSubTab() {
  if (bocHrActiveSubTab === "promotion-list") return loadBocPromotionList();
  return loadBocHrReview();
}

async function loadBocQuotaEnforcement() {
  const skeleton = document.getElementById("bocQuotaSkeleton");
  const list = document.getElementById("bocQuotaList");
  skeleton.hidden = false;
  list.hidden = true;

  const res = await bocGet("/api/boc/quota-enforcement");
  skeleton.hidden = true;
  if (!res) return bocShowDenied();
  if (res.reason === "confidential" || res.reason === "forbidden") return bocShowDenied(res.reason);
  if (!res.ok) {
    list.hidden = false;
    list.innerHTML = `<div class="empty-state">Quota enforcement data is unavailable right now.</div>`;
    return;
  }

  list.hidden = false;
  const entries = res.entries || [];
  const rows = entries
    .map((e) => `<li>${e.displayName} — ${formatDuration(e.seconds)}</li>`)
    .join("");
  list.innerHTML = `
    <p class="panel-subtitle">${entries.length} staff below quota this period. ${res.loaExemptCount || 0} exempt (LOA).</p>
    <ul class="history-list">${rows || `<li class="empty-state">Everyone has met quota.</li>`}</ul>
  `;
}

async function loadBocPromotionList() {
  const skeleton = document.getElementById("bocPromotionSkeleton");
  const list = document.getElementById("bocPromotionList");
  skeleton.hidden = false;
  list.hidden = true;

  const res = await bocGet("/api/boc/hr/promotion-list");
  skeleton.hidden = true;
  if (!res) return bocShowDenied();
  if (res.reason === "confidential" || res.reason === "forbidden") return bocShowDenied(res.reason);
  if (!res.ok) {
    list.hidden = false;
    list.innerHTML = `<div class="empty-state">Promotion list is unavailable right now.</div>`;
    return;
  }

  list.hidden = false;
  const entries = res.entries || [];
  const rows = entries.map((e) => `<li>${e.displayName} — ${formatDuration(e.seconds)}</li>`).join("");
  list.innerHTML = `
    <p class="panel-subtitle">Weekly promotion quota: ${formatDuration(res.promotionQuota || 0)}</p>
    <ul class="history-list">${rows || `<li class="empty-state">No one is eligible this period.</li>`}</ul>
  `;
}

async function loadBocHrReview() {
  const skeleton = document.getElementById("bocHrReviewSkeleton");
  const list = document.getElementById("bocHrReviewList");
  skeleton.hidden = false;
  list.hidden = true;

  const res = await bocGet("/api/boc/hr/review");
  skeleton.hidden = true;
  if (!res) return bocShowDenied();
  if (res.reason === "confidential" || res.reason === "forbidden") return bocShowDenied(res.reason);
  if (!res.ok || !res.hrRoleConfigured) {
    list.hidden = false;
    list.innerHTML = `<div class="empty-state">No High Rank role is configured, or review data is unavailable.</div>`;
    return;
  }

  list.hidden = false;
  const members = res.members || [];
  const rows = members
    .map(
      (m) =>
        `<li>${m.displayName}${m.isSsgt ? " (SSGT)" : ""} — ${m.classification} (${m.weeksMet}/${m.weeksChecked} weeks met)</li>`
    )
    .join("");
  list.innerHTML = `<ul class="history-list">${rows || `<li class="empty-state">No High Rank/SSGT members found.</li>`}</ul>`;
}

async function loadBocHrOversight() {
  const skeleton = document.getElementById("bocHrOversightSkeleton");
  const list = document.getElementById("bocHrOversightList");
  skeleton.hidden = false;
  list.hidden = true;

  const res = await bocGet("/api/boc/hr-oversight");
  skeleton.hidden = true;
  if (!res) return bocShowDenied();
  if (res.reason === "confidential" || res.reason === "forbidden") return bocShowDenied(res.reason);
  if (!res.ok) {
    list.hidden = false;
    list.innerHTML = `<div class="empty-state">HR oversight data is unavailable right now (${res.note || res.error || "unknown"}).</div>`;
    return;
  }

  list.hidden = false;
  const officers = res.officers || [];
  const rows = officers
    .map((o) => {
      const quotaLabel = o.quotaConfigured
        ? `${formatDuration(o.seconds)} / ${formatDuration(o.quotaSeconds)} ${o.quotaMet ? "(met)" : "(not met)"}`
        : "no quota configured";
      const watches = (o.watchHistory || [])
        .map((w) => `${w.active ? "Active watch" : "Watch"} started ${new Date((w.startedAt || 0) * 1000).toLocaleString()}`)
        .join("; ");
      return `<li>
        <strong>${o.displayName}</strong> — ${o.onDuty ? "on duty" : "off duty"}, quota: ${quotaLabel}
        ${watches ? `<br><span class="panel-subtitle">${watches}</span>` : ""}
      </li>`;
    })
    .join("");
  list.innerHTML = `<ul class="history-list">${rows || `<li class="empty-state">No High Rank role is configured, or no members hold it.</li>`}</ul>`;
}

async function loadBocSchedules() {
  const container = document.getElementById("bocScheduleGroups");
  const kinds = [
    { kind: "scheduled_period_reset", label: "Scheduled Leaderboard Reset" },
    { kind: "scheduled_quota_enforcement", label: "Scheduled Quota Enforcement" },
    { kind: "scheduled_promotion_review", label: "Scheduled Promotion Review" },
  ];
  container.innerHTML = kinds.map(({ kind, label }) => `
    <div class="card" data-schedule-kind="${kind}" style="margin-bottom:16px;">
      <h3>${label}</h3>
      <div class="schedule-status" data-role="status">Loading...</div>
      <div class="dev-diagnostics-form">
        <select data-role="type">
          <option value="weekly">Weekly</option>
          <option value="interval">Every N days</option>
        </select>
        <input type="number" data-role="weekday" min="0" max="6" placeholder="Weekday (0=Mon..6=Sun)">
        <input type="number" data-role="hour" min="0" max="23" placeholder="Hour (0-23, UTC)">
        <input type="number" data-role="minute" min="0" max="59" placeholder="Minute (0-59)">
        <input type="number" data-role="days" min="1" placeholder="Every N days">
        <input type="text" data-role="channelId" placeholder="Notify channel ID (optional; else DMs you)">
        <button data-role="save">Save Schedule</button>
        <button data-role="cancel">Cancel Schedule</button>
      </div>
      <div data-role="result"></div>
    </div>
  `).join("");

  for (const { kind } of kinds) {
    const card = container.querySelector(`[data-schedule-kind="${kind}"]`);
    const statusEl = card.querySelector('[data-role="status"]');
    const res = await bocGet(`/api/boc/schedule?kind=${kind}`);
    if (!res) {
      statusEl.textContent = "Unavailable.";
    } else if (res.reason === "confidential" || res.reason === "forbidden") {
      return bocShowDenied(res.reason);
    } else if (res.ok && res.active) {
      const next = res.nextRun ? new Date(res.nextRun * 1000).toLocaleString() : "unknown";
      statusEl.textContent = `Active — next run: ${next}`;
    } else {
      statusEl.textContent = "Not scheduled.";
    }

    card.querySelector('[data-role="save"]').addEventListener("click", async () => {
      const type = card.querySelector('[data-role="type"]').value;
      const channelId = card.querySelector('[data-role="channelId"]').value.trim();
      const config = { type };
      if (type === "weekly") {
        config.weekday = Number(card.querySelector('[data-role="weekday"]').value);
        config.hour = Number(card.querySelector('[data-role="hour"]').value);
        config.minute = Number(card.querySelector('[data-role="minute"]').value) || 0;
      } else {
        config.days = Number(card.querySelector('[data-role="days"]').value);
      }
      if (channelId) config.notify = { channelId };

      const resultEl = card.querySelector('[data-role="result"]');
      const setRes = await apiPost("/api/boc/schedule", { kind, config });
      if (!setRes || !setRes.ok || !setRes.data || setRes.data.ok === false) {
        resultEl.innerHTML = `<div class="lookup-action-message error">Failed to save schedule.</div>`;
        return;
      }
      resultEl.innerHTML = `<div class="lookup-action-message success">Schedule saved.</div>`;
      statusEl.textContent = `Active — next run: ${new Date(setRes.data.nextRun * 1000).toLocaleString()}`;
    });

    card.querySelector('[data-role="cancel"]').addEventListener("click", async () => {
      const resultEl = card.querySelector('[data-role="result"]');
      const cancelRes = await fetch(`${WORKER_URL}/api/boc/schedule`, {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      if (!cancelRes.ok) {
        resultEl.innerHTML = `<div class="lookup-action-message error">Failed to cancel schedule.</div>`;
        return;
      }
      resultEl.innerHTML = `<div class="lookup-action-message success">Schedule cancelled.</div>`;
      statusEl.textContent = "Not scheduled.";
    });
  }
}

// Manual "Reset Period" - destructive-feeling action, so it reuses the same
// click-again-to-confirm pattern as the High Ranks Lookup panel's admin
// action buttons (handleAdminActionClick) rather than inventing a new one.
document.getElementById("bocResetPeriodBtn").addEventListener("click", () => {
  confirmAction("Reset the leaderboard period? This cannot be undone.", fireBocPeriodReset);
});

async function fireBocPeriodReset() {
  const resultEl = document.getElementById("bocResetPeriodResult");
  resultEl.innerHTML = `<div class="lookup-action-message">Resetting...</div>`;
  const res = await apiPost("/api/boc/leaderboard/reset", {});
  if (!res || !res.ok || !res.data || res.data.ok === false) {
    const reason = res && res.data ? res.data.reason || res.data.error : "request_failed";
    resultEl.innerHTML = `<div class="lookup-action-message error">Failed: ${reason}</div>`;
    return;
  }
  resultEl.innerHTML = `<div class="lookup-action-message success">Leaderboard period reset. New period started.</div>`;
}

async function loadBocApplications() {
  const skeleton = document.getElementById("bocApplicationsSkeleton");
  const body = document.getElementById("bocApplicationsBody");
  skeleton.hidden = false;
  body.hidden = true;

  const [pendingRes, statsRes] = await Promise.all([
    bocGet("/api/boc/applications/pending"),
    bocGet("/api/boc/applications/stats"),
  ]);
  skeleton.hidden = true;
  if (!pendingRes || !statsRes) return bocShowDenied();
  if (pendingRes.reason === "confidential") return bocShowDenied("confidential");

  body.hidden = false;
  const stats = statsRes.stats || { accepted: 0, denied: 0, pending: 0 };
  const entries = pendingRes.entries || [];
  const rows = entries
    .map((a) => `<li>${a.discord_id} — applied ${new Date((a.created_at || 0) * 1000).toLocaleDateString()}</li>`)
    .join("");
  body.innerHTML = `
    <div class="overview-cards">
      <div class="stat-card"><div class="label">Pending</div><div class="value">${stats.pending}</div></div>
      <div class="stat-card"><div class="label">Accepted</div><div class="value">${stats.accepted}</div></div>
      <div class="stat-card"><div class="label">Denied</div><div class="value">${stats.denied}</div></div>
    </div>
    <h2 class="lookup-detail-heading">Pending Queue</h2>
    <ul class="history-list">${rows || `<li class="empty-state">No pending applications.</li>`}</ul>
  `;
}

async function loadBocWatchList() {
  const skeleton = document.getElementById("bocWatchListSkeleton");
  const list = document.getElementById("bocWatchList");
  skeleton.hidden = false;
  list.hidden = true;

  const res = await bocGet("/api/hr/officers/watch/list");
  skeleton.hidden = true;
  if (!res) return bocShowDenied();
  if (res.reason === "forbidden" || res.reason === "unauthenticated") return bocShowDenied(res.reason);

  list.hidden = false;
  const watches = res.watches || [];
  if (watches.length === 0) {
    list.innerHTML = `<li class="empty-state">Nobody is currently being watched.</li>`;
    return;
  }
  list.innerHTML = watches
    .map(
      (w, i) => `
      <li class="leaderboard-row" style="animation-delay: ${Math.min(i, 20) * 0.03}s">
        <span class="leaderboard-identity">
          <span class="leaderboard-name">${w.targetName}</span>
          <span class="leaderboard-rank-title">Started by ${w.startedByName}</span>
        </span>
        <span class="leaderboard-time">${formatDuration(w.secondsRemaining)} left</span>
      </li>
    `
    )
    .join("");
}

async function loadBocInactiveOfficers() {
  const skeleton = document.getElementById("bocInactiveOfficersSkeleton");
  const list = document.getElementById("bocInactiveOfficersList");
  skeleton.hidden = false;
  list.hidden = true;

  const res = await bocGet("/api/hr/officers/inactive");
  skeleton.hidden = true;
  if (!res) return bocShowDenied();
  if (res.reason === "forbidden" || res.reason === "unauthenticated") return bocShowDenied(res.reason);

  list.hidden = false;
  const officers = res.officers || [];
  const thresholdLabel = document.getElementById("bocInactiveThresholdLabel");
  if (thresholdLabel && res.thresholdDays) thresholdLabel.textContent = res.thresholdDays;

  if (officers.length === 0) {
    list.innerHTML = `<li class="empty-state">Everyone has logged a shift recently.</li>`;
    return;
  }
  list.innerHTML = officers
    .map((o, i) => {
      const avatarUrl = avatarUrlFor(o.userId, o.avatar, 32);
      return `
        <li class="leaderboard-row" style="animation-delay: ${Math.min(i, 20) * 0.02}s">
          <img class="leaderboard-avatar" src="${avatarUrl}" alt="" width="32" height="32">
          <span class="leaderboard-identity">
            <span class="leaderboard-name">${o.username}</span>
            <span class="leaderboard-rank-title">${o.rank || "Unranked"}</span>
          </span>
          <span class="leaderboard-time">${o.daysSinceLastShift}d inactive</span>
        </li>
      `;
    })
    .join("");
}

async function loadBocAuditLog(actionFilter) {
  const skeleton = document.getElementById("bocAuditSkeleton");
  const list = document.getElementById("bocAuditList");
  skeleton.hidden = false;
  list.hidden = true;

  const query = actionFilter ? `?action=${encodeURIComponent(actionFilter)}` : "";
  const res = await bocGet(`/api/boc/audit-log${query}`);
  skeleton.hidden = true;
  if (!res) return bocShowDenied();
  if (res.reason === "confidential" || res.reason === "forbidden") return bocShowDenied(res.reason);

  list.hidden = false;
  const entries = res.entries || [];
  const rows = entries
    .map((e) => `<li>[${e.source}] ${e.actorId} — ${e.action}${e.detail ? `: ${e.detail}` : ""}</li>`)
    .join("");
  list.innerHTML = `<ul class="history-list">${rows || `<li class="empty-state">No audit entries found.</li>`}</ul>`;
}

// Everyday self-service activity (user request) - shift starts/ends, Member
// Lookup searches, AI Assistant queries. Separate tab/collection from Audit
// Log above (that's admin/officer-panel actions taken on someone else).
async function loadBocActivityLog() {
  const skeleton = document.getElementById("bocActivitySkeleton");
  const list = document.getElementById("bocActivityList");
  skeleton.hidden = false;
  list.hidden = true;

  const res = await bocGet("/api/boc/activity-log");
  skeleton.hidden = true;
  if (!res) return bocShowDenied();
  if (res.reason === "confidential" || res.reason === "forbidden") return bocShowDenied(res.reason);

  list.hidden = false;
  const entries = res.entries || [];
  const rows = entries
    .map(
      (e) => `
        <li class="history-row">
          <span class="history-desc"><strong>User ${e.actorId}</strong> — ${e.detail || e.action}</span>
          <span class="history-date">${formatDate(e.timestamp)}</span>
        </li>
      `
    )
    .join("");
  list.innerHTML = `<ul class="history-list">${rows || `<li class="empty-state">No activity logged yet.</li>`}</ul>`;
}

document.getElementById("bocAuditFilterBtn").addEventListener("click", () => {
  const value = document.getElementById("bocAuditActionFilter").value.trim();
  loadBocAuditLog(value || undefined);
});

document.getElementById("bocDmPreviewBtn").addEventListener("click", () => {
  const message = document.getElementById("bocDmMessage").value;
  const preview = document.getElementById("bocDmPreview");
  preview.hidden = false;
  preview.textContent = message || "(empty message)";
});

document.getElementById("bocDmSendBtn").addEventListener("click", async () => {
  const targetType = document.getElementById("bocDmTargetType").value;
  const targetId = document.getElementById("bocDmTargetId").value.trim();
  const message = document.getElementById("bocDmMessage").value.trim();
  const resultEl = document.getElementById("bocDmResult");

  if (!message) {
    resultEl.innerHTML = `<div class="lookup-action-message error">Message is required.</div>`;
    return;
  }

  const target = { type: targetType };
  if (targetType === "role") target.roleId = targetId;
  if (targetType === "user") target.userId = targetId;

  confirmAction("Send this DM to the selected target(s)?", async () => {
    const res = await apiPost("/api/boc/dm-officers", { target, message });
    if (!res || !res.ok || !res.data || res.data.ok === false) {
      const reason = res && res.data ? res.data.reason || res.data.error : "request_failed";
      resultEl.innerHTML = `<div class="lookup-action-message error">Failed: ${reason}</div>`;
      return;
    }
    resultEl.innerHTML = `<div class="lookup-action-message success">Sent to ${res.data.sent} officer(s), ${res.data.failed} failed.</div>`;
  });
});

document.getElementById("bocAnnPreviewBtn").addEventListener("click", () => {
  const title = document.getElementById("bocAnnTitle").value;
  const description = document.getElementById("bocAnnDescription").value;
  const preview = document.getElementById("bocAnnPreview");
  preview.hidden = false;
  preview.innerHTML = `<strong>${title || "(no title)"}</strong><br>${description || "(empty body)"}`;
});

document.getElementById("bocAnnSendBtn").addEventListener("click", async () => {
  const channelId = document.getElementById("bocAnnChannelId").value.trim();
  const title = document.getElementById("bocAnnTitle").value.trim();
  const description = document.getElementById("bocAnnDescription").value.trim();
  const pingRoleId = document.getElementById("bocAnnPingRole").value.trim() || undefined;
  const resultEl = document.getElementById("bocAnnResult");

  if (!channelId || !description) {
    resultEl.innerHTML = `<div class="lookup-action-message error">Channel and body are required.</div>`;
    return;
  }

  confirmAction("Post this announcement?", async () => {
    const res = await apiPost("/api/boc/announcement", { channelId, title, description, pingRoleId });
    if (!res || !res.ok || !res.data || res.data.ok === false) {
      const reason = res && res.data ? res.data.reason || res.data.error : "request_failed";
      resultEl.innerHTML = `<div class="lookup-action-message error">Failed: ${reason}</div>`;
      return;
    }
    resultEl.innerHTML = `<div class="lookup-action-message success">Posted (message ${res.data.messageId}).</div>`;
  });
});

async function loadBocRaStats() {
  const skeleton = document.getElementById("bocRaStatsSkeleton");
  const body = document.getElementById("bocRaStatsBody");
  skeleton.hidden = false;
  body.hidden = true;

  const res = await bocGet("/api/boc/ra-program-stats");
  skeleton.hidden = true;
  if (!res) return bocShowDenied();
  if (res.reason === "confidential" || res.reason === "forbidden") return bocShowDenied(res.reason);

  body.hidden = false;
  const statusCounts = res.statusCounts || {};
  const topFtos = res.topFtos || [];
  const statusRows = Object.entries(statusCounts)
    .map(([status, count]) => `<div class="stat-card"><div class="label">${status}</div><div class="value">${count}</div></div>`)
    .join("");
  const ftoRows = topFtos.map((f) => `<li>${f.userId} — ${f.sessionsHosted} session(s)</li>`).join("");
  body.innerHTML = `
    <div class="overview-cards">${statusRows || `<div class="empty-state">No RA session data yet.</div>`}</div>
    <h2 class="lookup-detail-heading">Top FTOs</h2>
    <ul class="history-list">${ftoRows || `<li class="empty-state">No completed sessions yet.</li>`}</ul>
  `;
}

async function loadBocSettings() {
  const skeleton = document.getElementById("bocSettingsSkeleton");
  const body = document.getElementById("bocSettingsBody");
  const fields = document.getElementById("bocSettingsFields");
  skeleton.hidden = false;
  body.hidden = true;
  fields.hidden = true;

  const res = await bocGet("/api/boc/settings");
  skeleton.hidden = true;
  if (!res) return bocShowDenied();
  if (res.reason === "confidential" || res.reason === "forbidden") return bocShowDenied(res.reason);

  const shiftMgmt = (res.settings && res.settings.shift_management) || {};
  const hoursInput = document.getElementById("bocRecognizedHoursThreshold");
  const tenureInput = document.getElementById("bocRecognizedTenureDays");
  hoursInput.value = shiftMgmt.recognized_hours_threshold ?? "";
  tenureInput.value = shiftMgmt.recognized_tenure_days ?? "";
  fields.hidden = false;

  body.hidden = false;
  body.textContent = res.settings ? JSON.stringify(res.settings, null, 2) : "No settings document found.";
}

document.getElementById("bocSettingsSaveBtn")?.addEventListener("click", () => {
  confirmAction("Save these BOC settings?", fireBocSettingsSave);
});

async function fireBocSettingsSave() {
  const resultEl = document.getElementById("bocSettingsSaveResult");
  const hoursInput = document.getElementById("bocRecognizedHoursThreshold");
  const tenureInput = document.getElementById("bocRecognizedTenureDays");
  const recognizedHoursThreshold = Number(hoursInput.value);
  const recognizedTenureDays = Number(tenureInput.value);

  resultEl.innerHTML = `<div class="lookup-action-message">Saving...</div>`;

  if (!Number.isFinite(recognizedHoursThreshold) || !Number.isFinite(recognizedTenureDays)) {
    resultEl.innerHTML = `<div class="lookup-action-message error">Both fields must be numbers.</div>`;
    return;
  }

  const res = await apiPost("/api/boc/settings/update", { recognizedHoursThreshold, recognizedTenureDays });
  if (!res || !res.ok || !res.data || res.data.ok === false) {
    const reason = res && res.data ? res.data.error || res.data.reason : "request_failed";
    resultEl.innerHTML = `<div class="lookup-action-message error">Failed: ${reason}</div>`;
    return;
  }
  resultEl.innerHTML = `<div class="lookup-action-message success">Saved.</div>`;
}


// ── Developer Tools (Phase 6) ──

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

document.querySelectorAll(".dev-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".dev-tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".dev-panel").forEach((p) => p.classList.remove("active"));
    document.getElementById(`devPanel-${tab.dataset.devTab}`).classList.add("active");

    if (tab.dataset.devTab === "kill-switches") loadDevKillSwitches();
    if (tab.dataset.devTab === "system-health") loadDevSystemHealth();
    if (tab.dataset.devTab === "deployment-info") loadDevDeploymentInfo();
    if (tab.dataset.devTab === "testers") loadDevTesters();
    if (tab.dataset.devTab === "access-control") loadDevAccessControl();
    if (tab.dataset.devTab === "anomalous-logins") loadDevAnomalousLogins();
    if (tab.dataset.devTab === "dashboard-logins") loadDevDashboardLogins();
  });
});

async function loadDevDashboardLogins() {
  const skeleton = document.getElementById("dashboardLoginsSkeleton");
  const list = document.getElementById("dashboardLoginsList");
  skeleton.hidden = false;
  list.hidden = true;

  const res = await apiGet("/api/dev/dashboard-logins");
  skeleton.hidden = true;
  list.hidden = false;

  if (!res || !res.ok) {
    list.innerHTML = `<li class="empty-state">Failed to load dashboard logins.</li>`;
    return;
  }

  const entries = res.entries || [];
  list.innerHTML = entries.length
    ? entries
        .map(
          (e) => `
    <li class="loa-history-row">
      <span class="history-desc">User <code>${escapeHtml(e.userId || "unknown")}</code> - ${e.loginCount || 1} login${e.loginCount === 1 ? "" : "s"}, last from ${escapeHtml(e.lastCountry || "??")}</span>
      <span class="history-date">${e.lastLoginAt ? formatDate(e.lastLoginAt) : "?"}</span>
    </li>
  `
        )
        .join("")
    : `<li class="empty-state">No dashboard logins recorded yet.</li>`;
}

async function loadDevAnomalousLogins() {
  const skeleton = document.getElementById("anomalousLoginsSkeleton");
  const list = document.getElementById("anomalousLoginsList");
  skeleton.hidden = false;
  list.hidden = true;

  const res = await apiGet("/api/anomalous-logins");
  skeleton.hidden = true;
  list.hidden = false;

  if (!res || !res.ok) {
    list.innerHTML = `<li class="empty-state">Failed to load anomalous logins.</li>`;
    return;
  }

  const entries = res.entries || [];
  list.innerHTML = entries.length
    ? entries
        .map(
          (e) => `
    <li class="loa-history-row">
      <span class="history-desc">User <code>${escapeHtml(e.userId || e.targetId || "unknown")}</code>: ${escapeHtml(e.detail || "Login country changed.")}</span>
      <span class="history-date">${e.timestamp ? formatDate(e.timestamp) : "?"}</span>
    </li>
  `
        )
        .join("")
    : `<li class="empty-state">No anomalous logins recorded.</li>`;
}

async function loadDevAccessControl() {
  const skeleton = document.getElementById("accessControlSkeleton");
  const body = document.getElementById("accessControlBody");
  const msgEl = document.getElementById("accessControlMessage");
  skeleton.hidden = false;
  body.hidden = true;
  msgEl.textContent = "";

  const res = await apiGet("/api/dev/access-control");
  skeleton.hidden = true;
  body.hidden = false;
  if (!res || !res.ok) {
    msgEl.textContent = "Failed to load access control settings.";
    return;
  }

  document.querySelectorAll('input[name="accessControlTier"]').forEach((box) => {
    if (box.disabled) return; // developer - always checked, never toggled
    box.checked = (res.allowedTiers || []).includes(box.value);
  });
  document.getElementById("accessControlTesters").checked = !!res.allowTesters;
}

document.getElementById("accessControlSaveBtn").addEventListener("click", async () => {
  const msgEl = document.getElementById("accessControlMessage");
  const allowedTiers = [...document.querySelectorAll('input[name="accessControlTier"]:checked')].map((b) => b.value);
  const allowTesters = document.getElementById("accessControlTesters").checked;

  msgEl.textContent = "Saving...";
  const res = await apiPost("/api/dev/access-control", { allowedTiers, allowTesters });
  if (!res || !res.ok || !res.data?.ok) {
    msgEl.textContent = "Failed to save.";
    return;
  }
  msgEl.textContent = "Saved.";
});

// ── Emergency Lockdown (Dev Tools) — a single big-hammer toggle that blocks
// all writes dashboard-wide. Assumes GET mirrors the kill-switches pattern
// (loadDevKillSwitches above) for reading current state on load; if no such
// GET route exists yet, this just falls back to tracking state locally from
// the button's own data-enabled attribute after the first successful POST.
async function loadEmergencyLockdownState() {
  const btn = document.getElementById("emergencyLockdownBtn");
  if (!btn) return;
  const res = await apiGet("/api/dev/emergency-lockdown");
  if (res && res.ok && typeof res.enabled === "boolean") {
    setEmergencyLockdownBtnState(res.enabled);
  }
}

function setEmergencyLockdownBtnState(enabled) {
  const btn = document.getElementById("emergencyLockdownBtn");
  if (!btn) return;
  btn.dataset.enabled = String(enabled);
  btn.textContent = enabled ? "Disable Lockdown" : "Enable Lockdown";
}

document.getElementById("emergencyLockdownBtn")?.addEventListener("click", () => {
  const btn = document.getElementById("emergencyLockdownBtn");
  const nextEnabled = btn.dataset.enabled !== "true";
  const message = nextEnabled
    ? "Enable EMERGENCY LOCKDOWN? This immediately blocks ALL writes dashboard-wide for everyone."
    : "Disable emergency lockdown and restore normal write access?";
  confirmAction(message, async () => {
    btn.disabled = true;
    const res = await apiPost("/api/dev/emergency-lockdown", { enabled: nextEnabled });
    btn.disabled = false;
    if (res && res.ok && res.data && res.data.ok) {
      setEmergencyLockdownBtnState(typeof res.data.enabled === "boolean" ? res.data.enabled : nextEnabled);
    }
  });
});

async function loadDevKillSwitches() {
  loadEmergencyLockdownState();
  const skeleton = document.getElementById("killSwitchesSkeleton");
  const list = document.getElementById("killSwitchesList");
  skeleton.hidden = false;
  list.hidden = true;

  const res = await apiGet("/api/dev/kill-switches");
  skeleton.hidden = true;
  list.hidden = false;

  if (!res || !res.ok) {
    list.innerHTML = `<div class="empty-state">Failed to load kill switches.</div>`;
    return;
  }

  list.innerHTML = res.sections
    .map(
      (s) => `
    <div class="dev-kill-switch-row" data-key="${escapeHtml(s.key)}">
      <span>${escapeHtml(s.key)}</span>
      <button class="dev-kill-switch-toggle" data-enabled="${s.enabled}">${s.enabled ? "Enabled" : "Disabled"}</button>
    </div>
  `
    )
    .join("");

  list.querySelectorAll(".dev-kill-switch-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".dev-kill-switch-row");
      const key = row.dataset.key;
      const nextEnabled = btn.dataset.enabled !== "true";
      btn.disabled = true;
      const res = await apiPost("/api/dev/kill-switches", { key, enabled: nextEnabled });
      btn.disabled = false;
      if (res && res.ok) {
        btn.dataset.enabled = String(nextEnabled);
        btn.textContent = nextEnabled ? "Enabled" : "Disabled";
      }
    });
  });
}

async function loadDevSystemHealth() {
  const skeleton = document.getElementById("systemHealthSkeleton");
  const grid = document.getElementById("systemHealthGrid");
  skeleton.hidden = false;
  grid.hidden = true;

  const res = await apiGet("/api/dev/system-health");
  skeleton.hidden = true;
  grid.hidden = false;

  if (!res || !res.ok) {
    grid.innerHTML = `<div class="empty-state">Failed to load system health.</div>`;
    return;
  }

  grid.innerHTML = Object.values(res.checks)
    .map(
      (check) => `
    <div class="dev-health-card ${check.ok ? "ok" : "down"}">
      <div class="label">${escapeHtml(check.name)}</div>
      <div class="value">${check.ok ? "Healthy" : "Down"}</div>
      ${check.latencyMs != null ? `<div class="dev-health-latency">${check.latencyMs}ms</div>` : ""}
    </div>
  `
    )
    .join("");
}

async function runDevDiagnosticsQuery() {
  const op = document.getElementById("diagOp").value;
  const collection = document.getElementById("diagCollection").value.trim();
  const rawBody = document.getElementById("diagBody").value.trim();
  const resultEl = document.getElementById("diagResult");

  if (!collection) {
    resultEl.textContent = "Collection name is required.";
    return;
  }

  let parsed;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : op === "aggregate" ? [] : {};
  } catch {
    resultEl.textContent = "Invalid JSON.";
    return;
  }

  const payload = { op, collection };
  if (op === "findOne") payload.filter = parsed;
  else payload.pipeline = parsed;

  resultEl.textContent = "Running...";
  const res = await apiPost("/api/dev/diagnostics/query", payload);
  if (!res || !res.ok) {
    resultEl.textContent = `Error: ${res?.data?.reason || "request failed"}`;
    return;
  }
  resultEl.textContent = JSON.stringify(res.data, null, 2);
}

document.getElementById("diagRunBtn").addEventListener("click", runDevDiagnosticsQuery);

async function loadDevDeploymentInfo() {
  const skeleton = document.getElementById("deploymentInfoSkeleton");
  const body = document.getElementById("deploymentInfoBody");
  skeleton.hidden = false;
  body.hidden = true;

  const [info, versionRes] = await Promise.all([
    apiGet("/api/dev/deployment-info"),
    fetch("version.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  skeleton.hidden = true;
  body.hidden = false;

  if (!info || !info.ok) {
    body.innerHTML = `<div class="empty-state">Failed to load deployment info.</div>`;
    return;
  }

  body.innerHTML = `
    <div class="dev-kill-switch-row"><span>Worker version</span><span>${escapeHtml(info.workerVersionId || "unknown")}</span></div>
    <div class="dev-kill-switch-row"><span>Bridge git hash</span><span>${escapeHtml(info.bridgeGitHash || "unknown")}</span></div>
    <div class="dev-kill-switch-row"><span>Frontend commit</span><span>${escapeHtml((versionRes && versionRes.commit) || "unknown")}</span></div>
  `;
}

async function loadDevTesters() {
  const skeleton = document.getElementById("testersSkeleton");
  const list = document.getElementById("testersList");
  skeleton.hidden = false;
  list.hidden = true;

  const res = await apiGet("/api/dev/testers");
  skeleton.hidden = true;
  list.hidden = false;

  if (!res || !res.ok) {
    list.innerHTML = `<div class="empty-state">Failed to load testers.</div>`;
    return;
  }

  const testers = res.testers || [];
  list.innerHTML = testers.length
    ? testers
        .map(
          (t) => `
    <div class="dev-tester-row" data-user-id="${escapeHtml(t._id)}">
      <span>${escapeHtml(t._id)} (added by ${escapeHtml(t.added_by || "unknown")})</span>
      <button class="dev-tester-remove-btn">Remove</button>
    </div>
  `
        )
        .join("")
    : `<div class="empty-state">No testers enrolled.</div>`;

  list.querySelectorAll(".dev-tester-remove-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".dev-tester-row");
      const userId = row.dataset.userId;
      btn.disabled = true;
      const res = await apiDelete("/api/dev/testers", { userId });
      if (res && res.ok) loadDevTesters();
      else btn.disabled = false;
    });
  });
}

document.getElementById("testerAddBtn").addEventListener("click", async () => {
  const input = document.getElementById("testerAddInput");
  const userId = input.value.trim();
  if (!userId) return;
  const res = await apiPost("/api/dev/testers", { userId });
  if (res && res.ok) {
    input.value = "";
    loadDevTesters();
  }
});

// ── Phase 4: High Ranks tier - LOA Management, Transfer Requests,
// RA Oversight, Promotion Quota, and the Officers roster/action panel. ──

function renderLoaRow(item, { withActions } = {}) {
  const started = item.started_at ? formatDate(item.started_at) : "?";
  const ends = item.expiry ? formatDate(item.expiry) : "?";
  const actions = withActions
    ? `
      <div class="lookup-actions">
        <button class="lookup-action-btn" data-loa-id="${item._id}" data-decision="accept">Accept</button>
        <button class="lookup-action-btn" data-loa-id="${item._id}" data-decision="deny">Deny</button>
      </div>
    `
    : "";
  return `
    <li class="loa-history-row">
      <span class="history-desc">${item.type || "LOA"} — user <code>${item.user_id}</code>: ${item.reason || "No reason given."}</span>
      <span class="history-date">${started} → ${ends}</span>
      ${actions}
    </li>
  `;
}

async function loadLoaManagement() {
  const pendingSkeleton = document.getElementById("loaPendingSkeleton");
  const pendingList = document.getElementById("loaPendingList");
  const activeSkeleton = document.getElementById("loaActiveSkeleton");
  const activeList = document.getElementById("loaActiveList");

  const [pending, active] = await Promise.all([
    apiGet("/api/hr/loa/pending"),
    apiGet("/api/hr/loa/active"),
  ]);

  pendingSkeleton.hidden = true;
  pendingList.hidden = false;
  if (!pending || !pending.entries || pending.entries.length === 0) {
    pendingList.innerHTML = `<li class="empty-state">No pending requests.</li>`;
  } else {
    pendingList.innerHTML = pending.entries.map((item) => renderLoaRow(item, { withActions: true })).join("");
    pendingList.querySelectorAll(".lookup-action-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const res = await apiPost("/api/hr/loa/decide", { loaId: btn.dataset.loaId, decision: btn.dataset.decision });
        if (res && res.ok && res.data && res.data.ok) loadLoaManagement();
        else btn.disabled = false;
      });
    });
  }

  activeSkeleton.hidden = true;
  activeList.hidden = false;
  activeList.innerHTML = !active || !active.entries || active.entries.length === 0
    ? `<li class="empty-state">No active LOAs/RAs.</li>`
    : active.entries.map((item) => renderLoaRow(item)).join("");
}

// ── Transfer Requests ──

async function loadTransfersQueue() {
  const skeleton = document.getElementById("transfersQueueSkeleton");
  const list = document.getElementById("transfersQueueList");
  const queue = await apiGet("/api/hr/transfers/queue");
  skeleton.hidden = true;
  list.hidden = false;
  if (!queue || !queue.entries || queue.entries.length === 0) {
    list.innerHTML = `<li class="empty-state">No pending transfer requests.</li>`;
    return;
  }
  list.innerHTML = queue.entries
    .map(
      (t) => `
      <li class="loa-history-row">
        <span class="history-desc">${t.direction || "?"} transfer — user <code>${t.discord_id}</code> (${t.department || "?"}), status: ${t.status}</span>
        <div class="lookup-actions">
          <button class="lookup-action-btn transfer-deny-btn" data-id="${t._id}">Deny</button>
        </div>
      </li>
    `
    )
    .join("");
  // Accept requires a calculated rank string the reviewer must supply (the
  // bot's do_accept mirrors the same department role ladder the review
  // buttons use) - kept as a prompt() rather than a full rank picker for
  // this phase; denies need no extra input so get a one-click button.
  list.querySelectorAll(".transfer-deny-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reason = prompt("Deny reason (short category):", "policy");
      if (reason === null) return;
      btn.disabled = true;
      const res = await apiPost("/api/hr/transfers/decide", { transferId: btn.dataset.id, decision: "deny", reason });
      if (res && res.ok && res.data && res.data.ok) loadTransfersQueue();
      else btn.disabled = false;
    });
  });
}

// ── RA Oversight ──

let currentRaOversightTab = "sessions";

function renderRaOversightRow(entry) {
  const label = entry.session_id ? `Session #${entry.session_id}` : entry._id;
  return `
    <li class="loa-history-row">
      <span class="history-desc">${label} — type: ${entry.type || "?"}, status: ${entry.status || "?"}, FTO: <code>${entry.fto_id ?? "unassigned"}</code></span>
      <span class="history-date">${entry.created_at ? formatDate(entry.created_at) : ""}</span>
    </li>
  `;
}

async function loadRaOversight(tab) {
  if (tab) currentRaOversightTab = tab;
  document.querySelectorAll('[data-ra-tab]').forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.raTab === currentRaOversightTab);
  });
  const skeleton = document.getElementById("raOversightSkeleton");
  const list = document.getElementById("raOversightList");
  skeleton.hidden = false;
  list.hidden = true;

  const paths = {
    sessions: "/api/hr/ra/sessions",
    leaderboard: "/api/hr/ra/leaderboard",
    history: "/api/hr/ra/history",
    results: "/api/hr/ra/results",
  };
  const data = await apiGet(paths[currentRaOversightTab] || paths.sessions);
  skeleton.hidden = true;
  list.hidden = false;

  const entries = (data && data.entries) || [];
  if (entries.length === 0) {
    list.innerHTML = `<li class="empty-state">No data for this view.</li>`;
    return;
  }
  if (currentRaOversightTab === "leaderboard") {
    list.innerHTML = entries
      .map((e) => `<li class="loa-history-row"><span class="history-desc">FTO <code>${e._id}</code></span><span class="history-date">${e.sessions} session(s)</span></li>`)
      .join("");
  } else {
    list.innerHTML = entries.map(renderRaOversightRow).join("");
  }
}

document.getElementById("raOversightTabs")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-ra-tab]");
  if (btn) loadRaOversight(btn.dataset.raTab);
});

// ── Promotion Quota (read-only) ──

async function loadPromotionQuota() {
  const skeleton = document.getElementById("promotionQuotaSkeleton");
  const cards = document.getElementById("promotionQuotaCards");
  const data = await apiGet("/api/hr/promotion-quota");
  skeleton.hidden = true;
  cards.hidden = false;
  if (!data) {
    cards.innerHTML = `<div class="empty-state">Failed to load promotion quota settings.</div>`;
    return;
  }
  const roleQuotaRows = (data.roleQuotas || [])
    .map((rq) => `<div class="badge-card">Role <code>${rq.role}</code>: ${rq.quota}s</div>`)
    .join("") || `<div class="empty-state">No per-role overrides configured.</div>`;
  cards.innerHTML = `
    <div class="stat-card"><div class="label">Weekly promotion quota</div><div class="value">${data.weeklyPromotionQuota != null ? formatDuration(data.weeklyPromotionQuota) : "Not set"}</div></div>
    <div class="stat-card"><div class="label">Weekly shift quota</div><div class="value">${data.quota != null ? formatDuration(data.quota) : "Not set"}</div></div>
    <div class="stat-card"><div class="label">Period start</div><div class="value">${data.periodStart ? formatDate(data.periodStart) : "Not set"}</div></div>
    ${roleQuotaRows}
  `;
}

// ── Officers roster + per-officer action panel ──

function renderOfficersRosterRows(officers) {
  const list = document.getElementById("officersRosterList");
  if (!officers.length) {
    list.innerHTML = `<li class="empty-state">No officers match that search.</li>`;
    return;
  }
  list.innerHTML = officers
    .map(
      (o) => `
      <li class="lookup-result-row officer-row" data-user-id="${o.userId}">
        <img class="officer-avatar" src="${o.avatarUrl || avatarUrlFor(o.userId, null, 40)}" alt="" width="36" height="36" />
        <span class="officer-row-info">
          <span class="lookup-result-name">${o.displayName}</span>
          <span class="lookup-result-nick">${o.topRole || "No rank"}</span>
        </span>
        <span class="officer-duty-dot ${o.onDuty ? "on" : "off"}" title="${o.onDuty ? "On duty" : "Off duty"}"></span>
        ${o.watched ? `<span class="officer-watch-badge" title="Currently being watched">Watched</span>` : ""}
      </li>
    `
    )
    .join("");
  list.querySelectorAll(".lookup-result-row").forEach((row) => {
    row.addEventListener("click", () => openOfficerDetail(row.dataset.userId));
  });
}

async function loadOfficersRoster() {
  const skeleton = document.getElementById("officersRosterSkeleton");
  const list = document.getElementById("officersRosterList");
  const searchInput = document.getElementById("officersRosterSearch");
  officerDetailUserId = null;
  const res = await apiGet("/api/hr/officers/roster");
  skeleton.hidden = true;
  list.hidden = false;
  if (searchInput) searchInput.value = "";
  if (!res || !res.ok || !res.officers || res.officers.length === 0) {
    window._officersRosterAll = [];
    list.innerHTML = `<li class="empty-state">No officers found (or the staff role isn't configured).</li>`;
    return;
  }
  const officersById = {};
  res.officers.forEach((o) => (officersById[o.userId] = o));
  window._officersById = officersById;
  window._officersRosterAll = res.officers;

  renderOfficersRosterRows(res.officers);
}

// Client-side substring filter over the roster already fetched by
// loadOfficersRoster - matches name/nickname, no network call, live as-you-type.
document.getElementById("officersRosterSearch")?.addEventListener("input", (e) => {
  const query = e.target.value.trim().toLowerCase();
  const all = window._officersRosterAll || [];
  if (!query) {
    renderOfficersRosterRows(all);
    return;
  }
  const filtered = all.filter((o) => {
    const name = (o.displayName || "").toLowerCase();
    const username = (o.username || "").toLowerCase();
    const nick = (o.nickname || "").toLowerCase();
    return name.includes(query) || username.includes(query) || nick.includes(query);
  });
  renderOfficersRosterRows(filtered);
});

let officerDetailUserId = null;

// Inserted as a sibling <li> directly after the clicked officer's row (not
// a single fixed container after the whole list), so the customize panel
// always appears right below the person you clicked - clicking the same
// officer again collapses it; clicking a different one moves it.
function openOfficerDetail(userId) {
  const list = document.getElementById("officersRosterList");
  const existing = list.querySelector(".officer-detail-row");
  const wasOpenForSameUser = officerDetailUserId === userId;
  if (existing) existing.remove();

  if (wasOpenForSameUser) {
    officerDetailUserId = null;
    return;
  }
  officerDetailUserId = userId;

  const clickedRow = list.querySelector(`.lookup-result-row[data-user-id="${userId}"]`);
  if (!clickedRow) return;

  const detailRow = document.createElement("li");
  detailRow.className = "officer-detail-row";
  const wrap = document.createElement("div");
  wrap.id = "officerDetailWrap";
  detailRow.appendChild(wrap);
  clickedRow.insertAdjacentElement("afterend", detailRow);

  const officer = (window._officersById || {})[userId];
  wrap.innerHTML = `
    <div class="officer-detail-header">
      <img class="officer-avatar" src="${(officer && officer.avatarUrl) || avatarUrlFor(userId, null, 56)}" alt="" width="48" height="48" />
      <div>
        <h2 class="lookup-detail-heading" style="margin: 0;">${(officer && officer.displayName) || userId}</h2>
        <p class="panel-subtitle" style="margin: 2px 0 0;">${(officer && officer.topRole) || "No rank"} · ${officer && officer.onDuty ? "On duty" : "Off duty"}</p>
      </div>
    </div>

    <h3 class="officer-action-group-heading">Shift</h3>
    <div class="lookup-actions">
      <button class="lookup-action-btn" data-kind="shift_end">End Shift</button>
    </div>

    <h3 class="officer-action-group-heading">LOA / RA</h3>
    <div class="lookup-actions">
      <button class="lookup-action-btn" data-kind="loa_create">File LOA (7d)</button>
    </div>

    <h3 class="officer-action-group-heading">Personnel</h3>
    <div class="lookup-actions">
      <button class="lookup-action-btn" data-kind="promote">Log Promotion Eligible</button>
      <button class="lookup-action-btn" id="officerBgCheckBtn">Background Check</button>
    </div>
    <div id="officerBgCheckWrap"></div>

    <h3 class="officer-action-group-heading">Watch</h3>
    <div class="field-row">
      <select id="officerWatchDuration">
        <option value="3600">1 hour</option>
        <option value="21600">6 hours</option>
        <option value="86400" selected>1 day</option>
        <option value="259200">3 days</option>
        <option value="604800">7 days</option>
      </select>
      <button class="lookup-action-btn" id="officerWatchStartBtn">Start Watch</button>
      <button class="lookup-action-btn" id="officerWatchSummaryBtn">View Summary</button>
    </div>
    <div id="officerWatchWrap"></div>

    <h3 class="officer-action-group-heading">Direct Message</h3>
    <div class="field-row">
      <textarea id="officerDmMessage" rows="3" placeholder="DM message to this officer..." style="flex: 1;"></textarea>
      <button class="lookup-action-btn" id="officerDmSendBtn">Send DM</button>
    </div>
    <div id="officerActionMessage"></div>
  `;
  wrap.querySelectorAll(".lookup-action-btn[data-kind]").forEach((btn) => {
    btn.addEventListener("click", () => handleOfficerActionClick(btn));
  });
  document.getElementById("officerDmSendBtn").addEventListener("click", () => sendOfficerDm());
  document.getElementById("officerBgCheckBtn").addEventListener("click", () => loadOfficerBackgroundCheck(userId));
  document.getElementById("officerWatchStartBtn").addEventListener("click", () => startOfficerWatch(userId));
  document.getElementById("officerWatchSummaryBtn").addEventListener("click", () => loadOfficerWatchSummary(userId));
}

async function loadOfficerBackgroundCheck(userId) {
  const wrap = document.getElementById("officerBgCheckWrap");
  wrap.innerHTML = `<div class="skeleton" style="height: 60px;"></div>`;
  const res = await apiGet(`/api/lookup/${encodeURIComponent(userId)}/history`);
  if (!res || !res.entries) {
    wrap.innerHTML = `<div class="empty-state">Failed to load background check.</div>`;
    return;
  }
  if (!res.entries.length) {
    wrap.innerHTML = `<div class="empty-state">No history on file (clean record).</div>`;
    return;
  }
  wrap.innerHTML = `
    <ol class="loa-history-list">
      ${res.entries
        .slice(0, 20)
        .map(
          (e) => `<li class="loa-history-row"><span class="history-desc">[${e.type}] ${e.description}</span><span class="history-date">${formatDate(e.timestamp)}</span></li>`
        )
        .join("")}
    </ol>
  `;
}

async function startOfficerWatch(userId) {
  const messageEl = document.getElementById("officerActionMessage");
  const durationSeconds = Number(document.getElementById("officerWatchDuration").value);
  const res = await apiPost("/api/hr/officers/watch/start", { targetUserId: userId, durationSeconds });
  if (!res || !res.ok || !res.data || !res.data.ok) {
    messageEl.innerHTML = `<div class="lookup-action-message error">Could not start watch${res && res.data && res.data.error ? `: ${res.data.error}` : ""}.</div>`;
    return;
  }
  messageEl.innerHTML = `<div class="lookup-action-message success">Watch started. You'll get a DM summary when it ends.</div>`;
}

async function loadOfficerWatchSummary(userId) {
  const wrap = document.getElementById("officerWatchWrap");
  wrap.innerHTML = `<div class="skeleton" style="height: 60px;"></div>`;
  const res = await apiPost("/api/hr/officers/watch/summary", { targetUserId: userId });
  if (!res || !res.ok || !res.data || !res.data.ok) {
    wrap.innerHTML = `<div class="empty-state">No watch session found for this officer.</div>`;
    return;
  }
  const s = res.data.summary;
  wrap.innerHTML = `
    <div class="stat-card"><div class="label">Status</div><div class="value">${res.data.active ? "Active" : "Closed"}</div></div>
    <div class="stat-card"><div class="label">Shifts started</div><div class="value">${s.shiftCount}</div></div>
    <div class="stat-card"><div class="label">LOA/RA requests</div><div class="value">${s.loaCount}</div></div>
    <div class="stat-card"><div class="label">Rank changes</div><div class="value">${s.rankChangeCount}</div></div>
    <div class="stat-card"><div class="label">Commands used</div><div class="value">${s.commandUseCount}</div></div>
  `;
}

function handleOfficerActionClick(btn) {
  if (!btn.classList.contains("confirming")) {
    btn.classList.add("confirming");
    const original = btn.textContent;
    btn.dataset.originalLabel = original;
    btn.textContent = "Are you sure? Click again to confirm";
    setTimeout(() => {
      if (btn.classList.contains("confirming")) {
        btn.classList.remove("confirming");
        btn.textContent = btn.dataset.originalLabel;
      }
    }, 4000);
    return;
  }
  btn.classList.remove("confirming");
  btn.textContent = btn.dataset.originalLabel;
  fireOfficerAction(btn.dataset.kind);
}

async function fireOfficerAction(kind) {
  const messageEl = document.getElementById("officerActionMessage");
  const body = { targetUserId: officerDetailUserId, kind };
  if (kind === "loa_create") {
    body.requestType = "loa";
    body.durationSeconds = 7 * 86400;
    body.reason = "Filed via Officers panel.";
  }
  const res = await apiPost("/api/hr/officers/action", body);
  if (!res || !res.ok || !res.data || !res.data.ok) {
    messageEl.innerHTML = `<div class="lookup-action-message error">Action failed${res && res.data && res.data.error ? `: ${res.data.error}` : ""}.</div>`;
    return;
  }
  messageEl.innerHTML = `<div class="lookup-action-message success">Action completed successfully.</div>`;
}

async function sendOfficerDm() {
  const messageEl = document.getElementById("officerActionMessage");
  const message = document.getElementById("officerDmMessage").value.trim();
  if (!message) return;
  const res = await apiPost("/api/hr/officers/action", { targetUserId: officerDetailUserId, kind: "dm", message });
  if (!res || !res.ok || !res.data || !res.data.ok) {
    messageEl.innerHTML = `<div class="lookup-action-message error">DM failed to send.</div>`;
    return;
  }
  messageEl.innerHTML = `<div class="lookup-action-message success">DM sent.</div>`;
  document.getElementById("officerDmMessage").value = "";
}

// ── FTO Tools (role-based - visible to anyone holding the FTO role) ──

let currentFtoToolsTab = "host";

function switchFtoToolsTab(tab) {
  currentFtoToolsTab = tab;
  document.querySelectorAll("#ftoToolsTabs [data-fto-tools-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.ftoToolsTab === tab);
  });
  document.querySelectorAll("#panel-fto-tools .dev-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `ftoToolsPanel-${tab}`);
  });
}

function loadFtoTools(tab) {
  switchFtoToolsTab(tab || currentFtoToolsTab);
  if (currentFtoToolsTab === "leaderboard") loadFtoLeaderboard();
}

document.getElementById("ftoToolsTabs")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-fto-tools-tab]");
  if (btn) loadFtoTools(btn.dataset.ftoToolsTab);
});

document.getElementById("ftoHostBtn")?.addEventListener("click", async () => {
  const resultEl = document.getElementById("ftoHostResult");
  const mode = document.getElementById("ftoHostMode").value;
  resultEl.innerHTML = `<div class="empty-state">Posting...</div>`;
  const res = await apiPost("/api/fto/host", { mode });
  if (!res || !res.data || !res.data.ok) {
    resultEl.innerHTML = `<div class="lookup-action-message error">Failed${res && res.data && res.data.error ? `: ${res.data.error}` : ""}.</div>`;
    return;
  }
  resultEl.innerHTML = `<div class="lookup-action-message success">Posted - session <code>${escapeHtml(res.data.sessionId)}</code>.</div>`;
});

document.getElementById("ftoResultsSubmitBtn")?.addEventListener("click", async () => {
  const resultEl = document.getElementById("ftoResultsResult");
  const traineeId = document.getElementById("ftoResultsTraineeId").value.trim();
  const performance = document.getElementById("ftoResultsPerformance").value.trim();
  const result = document.getElementById("ftoResultsOutcome").value;
  if (!traineeId || !performance) {
    resultEl.innerHTML = `<div class="lookup-action-message error">Trainee ID and performance notes are required.</div>`;
    return;
  }
  resultEl.innerHTML = `<div class="empty-state">Submitting...</div>`;
  const res = await apiPost("/api/fto/results", { traineeId, performance, result });
  if (!res || !res.data || !res.data.ok) {
    resultEl.innerHTML = `<div class="lookup-action-message error">Failed${res && res.data && res.data.error ? `: ${res.data.error}` : ""}.</div>`;
    return;
  }
  resultEl.innerHTML = `<div class="lookup-action-message success">Submitted - session <code>${escapeHtml(res.data.sessionId)}</code> (${escapeHtml(res.data.result)}).</div>`;
  document.getElementById("ftoResultsPerformance").value = "";
});

async function loadFtoLeaderboard() {
  const skeleton = document.getElementById("ftoLeaderboardSkeleton");
  const list = document.getElementById("ftoLeaderboardList");
  skeleton.hidden = false;
  list.hidden = true;
  const data = await apiGet("/api/fto/leaderboard");
  skeleton.hidden = true;
  list.hidden = false;
  const entries = (data && data.entries) || [];
  if (entries.length === 0) {
    list.innerHTML = `<li class="empty-state">No RA sessions logged this period yet.</li>`;
    return;
  }
  list.innerHTML = entries
    .map(
      (e, i) => `
      <li class="loa-history-row">
        <span class="history-desc">#${i + 1} - <code>${escapeHtml(e.displayName)}</code></span>
        <span class="history-date">${e.total} session(s) - ${e.pass} pass / ${e.fail} fail</span>
      </li>`
    )
    .join("");
}

document.getElementById("ftoHistorySearchBtn")?.addEventListener("click", async () => {
  const list = document.getElementById("ftoHistoryList");
  list.innerHTML = `<li class="empty-state">Searching...</li>`;
  const body = {
    ftoId: document.getElementById("ftoHistoryFtoId").value.trim() || undefined,
    traineeId: document.getElementById("ftoHistoryTraineeId").value.trim() || undefined,
    result: document.getElementById("ftoHistoryResult").value || undefined,
    sessionId: document.getElementById("ftoHistorySessionId").value.trim() || undefined,
  };
  const res = await apiPost("/api/fto/history", body);
  const entries = (res && res.data && res.data.entries) || [];
  if (entries.length === 0) {
    list.innerHTML = `<li class="empty-state">No matching sessions found.</li>`;
    return;
  }
  list.innerHTML = entries
    .map((doc) => {
      const ftoText = doc.fto_id ? `<@${doc.fto_id}>` : "Unclaimed";
      const traineeIds = doc.trainee_ids && doc.trainee_ids.length ? doc.trainee_ids : (doc.trainee_id ? [doc.trainee_id] : []);
      const traineeText = traineeIds.length ? traineeIds.map((t) => `<@${t}>`).join(", ") : "None";
      const resultText = doc.result === "pass" ? "Pass" : doc.result === "fail" ? "Fail" : "-";
      return `<li class="loa-history-row">
        <span class="history-desc"><code>${escapeHtml(doc.session_id)}</code> (${escapeHtml(doc.type)})</span>
        <span class="history-date">FTO: ${escapeHtml(ftoText)} - Trainee(s): ${escapeHtml(traineeText)} - Result: ${escapeHtml(resultText)}</span>
      </li>`;
    })
    .join("");
});

document.getElementById("ftoSessionLookupBtn")?.addEventListener("click", async () => {
  const resultEl = document.getElementById("ftoSessionLookupResult");
  const sessionId = document.getElementById("ftoSessionLookupId").value.trim();
  if (!sessionId) return;
  resultEl.innerHTML = `<div class="empty-state">Looking up...</div>`;
  const res = await apiPost("/api/fto/session", { sessionId });
  if (!res || !res.data || !res.data.ok) {
    resultEl.innerHTML = `<div class="empty-state">No matching session found.</div>`;
    return;
  }
  const s = res.data.session;
  resultEl.innerHTML = `<pre class="dev-diagnostics-output">${escapeHtml(JSON.stringify(s, null, 2))}</pre>`;
});

document.getElementById("ftoFeedbackViewBtn")?.addEventListener("click", async () => {
  const resultEl = document.getElementById("ftoFeedbackResult");
  const targetFtoId = document.getElementById("ftoFeedbackTargetId").value.trim() || undefined;
  resultEl.innerHTML = `<div class="empty-state">Loading...</div>`;
  const res = await apiPost("/api/fto/feedback", { targetFtoId });
  if (!res || !res.data || !res.data.ok) {
    resultEl.innerHTML = `<div class="lookup-action-message error">Failed${res && res.data && res.data.error ? `: ${res.data.error}` : ""}.</div>`;
    return;
  }
  if (!res.data.averages) {
    resultEl.innerHTML = `<div class="empty-state">No feedback submitted yet.</div>`;
    return;
  }
  const avg = res.data.averages;
  resultEl.innerHTML = `
    <div class="stat-card"><div class="label">Communication</div><div class="value">${avg.communication.toFixed(1)}/5</div></div>
    <div class="stat-card"><div class="label">Patience</div><div class="value">${avg.patience.toFixed(1)}/5</div></div>
    <div class="stat-card"><div class="label">Clarity</div><div class="value">${avg.clarity.toFixed(1)}/5</div></div>
    <p class="panel-subtitle">${res.data.count} response(s) - anonymous.</p>
  `;
});

// ── IA Tools (role-based - visible to anyone holding the IA role) ──

let currentIaToolsTab = "detect";

function switchIaToolsTab(tab) {
  currentIaToolsTab = tab;
  document.querySelectorAll("#iaToolsTabs [data-ia-tools-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.iaToolsTab === tab);
  });
  document.querySelectorAll("#panel-ia-tools .dev-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `iaToolsPanel-${tab}`);
  });
}

document.getElementById("iaToolsTabs")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-ia-tools-tab]");
  if (btn) switchIaToolsTab(btn.dataset.iaToolsTab);
});

// Shared "Find Member" search for IA Tools. NOTE: none of the IA endpoints
// (/api/ia/detect|summarize|rewrite|tone) take a target-user-id parameter -
// they operate purely on pasted text/screenshots, not a specific member - so
// there's no target-user text input to auto-fill here (unlike FTO Tools'
// traineeId/ftoId fields). Best-effort behavior: selecting a match inserts
// an "@Name: " mention prefix into the active tab's text field, so IA staff
// can quickly tag whose message they're analyzing without retyping it.
const IA_TAB_TEXT_INPUT_ID = {
  detect: "iaDetectText",
  summarize: "iaSummarizeText",
  rewrite: "iaRewriteText",
  tone: "iaToneText",
};

let iaFindMemberDebounce = null;
document.getElementById("iaFindMemberInput")?.addEventListener("input", (e) => {
  const query = e.target.value.trim();
  const resultsWrap = document.getElementById("iaFindMemberResultsWrap");
  clearTimeout(iaFindMemberDebounce);
  if (!query) {
    resultsWrap.innerHTML = "";
    return;
  }
  iaFindMemberDebounce = setTimeout(async () => {
    const res = await apiPost("/api/lookup/search", { query });
    if (!res || !res.ok) {
      resultsWrap.innerHTML = `<div class="empty-state">Search failed. Try again.</div>`;
      return;
    }
    const results = res.data.results || [];
    if (results.length === 0) {
      resultsWrap.innerHTML = `<div class="empty-state">No matching members found.</div>`;
      return;
    }
    resultsWrap.innerHTML = `
      <ul class="lookup-results-list">
        ${results
          .map(
            (r) => `
          <li class="lookup-result-row" data-user-id="${r.userId}" data-username="${escapeHtml(r.username)}">
            <span class="lookup-result-name">${r.username}</span>
            ${r.nickname ? `<span class="lookup-result-nick">${r.nickname}</span>` : ""}
            <span class="lookup-result-nick">${r.topRole || "No rank"}</span>
          </li>
        `
          )
          .join("")}
      </ul>
    `;
    resultsWrap.querySelectorAll(".lookup-result-row").forEach((row) => {
      row.addEventListener("click", () => {
        const inputId = IA_TAB_TEXT_INPUT_ID[currentIaToolsTab];
        const textEl = inputId && document.getElementById(inputId);
        if (textEl) {
          const prefix = `@${row.dataset.username}: `;
          textEl.value = textEl.value.startsWith(prefix) ? textEl.value : prefix + textEl.value;
          textEl.focus();
        }
        document.getElementById("iaFindMemberInput").value = "";
        resultsWrap.innerHTML = "";
      });
    });
  }, 0);
});

// Reads a <input type="file"> into {imageBase64, imageFormat}, or nulls if
// no file was chosen - shared by AI Detect and Tone Check, the two IA tools
// that accept a screenshot instead of/alongside typed text.
function readImageInput(inputEl) {
  return new Promise((resolve) => {
    const file = inputEl?.files?.[0];
    if (!file) return resolve({ imageBase64: null, imageFormat: null });
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result || "";
      const commaIdx = dataUrl.indexOf(",");
      const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : "";
      const fmt = (file.type.split("/")[1] || "png").toLowerCase();
      resolve({ imageBase64: base64, imageFormat: fmt });
    };
    reader.onerror = () => resolve({ imageBase64: null, imageFormat: null });
    reader.readAsDataURL(file);
  });
}

document.getElementById("iaDetectBtn")?.addEventListener("click", async () => {
  const resultEl = document.getElementById("iaDetectResult");
  const text = document.getElementById("iaDetectText").value.trim();
  const { imageBase64, imageFormat } = await readImageInput(document.getElementById("iaDetectImage"));
  if (!text && !imageBase64) {
    resultEl.innerHTML = `<div class="lookup-action-message error">Provide text or attach a screenshot.</div>`;
    return;
  }
  resultEl.innerHTML = `<div class="empty-state">Sending to AI model...</div>`;
  const res = await apiPost("/api/ia/detect", { text, imageBase64, imageFormat });
  if (!res || !res.data || !res.data.ok) {
    resultEl.innerHTML = `<div class="lookup-action-message error">Failed${res && res.data && res.data.error ? `: ${res.data.error}` : ""}.</div>`;
    return;
  }
  const d = res.data;
  resultEl.innerHTML = `
    <div class="stat-card"><div class="label">Score</div><div class="value">${d.score != null ? `${d.score}/100` : "N/A"}</div></div>
    <p class="panel-subtitle">${escapeHtml(d.confidence || "Unknown")} confidence - ${escapeHtml(d.reasoning || "")}</p>
  `;
});

document.getElementById("iaSummarizeBtn")?.addEventListener("click", async () => {
  const resultEl = document.getElementById("iaSummarizeResult");
  const text = document.getElementById("iaSummarizeText").value.trim();
  if (!text) return;
  resultEl.innerHTML = `<div class="empty-state">Sending to AI model...</div>`;
  const res = await apiPost("/api/ia/summarize", { text });
  if (!res || !res.data || !res.data.ok) {
    resultEl.innerHTML = `<div class="lookup-action-message error">Failed${res && res.data && res.data.error ? `: ${res.data.error}` : ""}.</div>`;
    return;
  }
  resultEl.innerHTML = `<div class="ai-panel-preview">${escapeHtml(res.data.summary).replace(/\n/g, "<br>")}</div>`;
});

document.getElementById("iaRewriteBtn")?.addEventListener("click", async () => {
  const resultEl = document.getElementById("iaRewriteResult");
  const text = document.getElementById("iaRewriteText").value.trim();
  if (!text) return;
  resultEl.innerHTML = `<div class="empty-state">Sending to AI model...</div>`;
  const res = await apiPost("/api/ia/rewrite", { text });
  if (!res || !res.data || !res.data.ok) {
    resultEl.innerHTML = `<div class="lookup-action-message error">Failed${res && res.data && res.data.error ? `: ${res.data.error}` : ""}.</div>`;
    return;
  }
  resultEl.innerHTML = `<div class="ai-panel-preview">${escapeHtml(res.data.rewritten).replace(/\n/g, "<br>")}</div>`;
});

document.getElementById("iaToneBtn")?.addEventListener("click", async () => {
  const resultEl = document.getElementById("iaToneResult");
  const text = document.getElementById("iaToneText").value.trim();
  const { imageBase64, imageFormat } = await readImageInput(document.getElementById("iaToneImage"));
  if (!text && !imageBase64) {
    resultEl.innerHTML = `<div class="lookup-action-message error">Provide text or attach a screenshot.</div>`;
    return;
  }
  resultEl.innerHTML = `<div class="empty-state">Sending to AI model...</div>`;
  const res = await apiPost("/api/ia/tone", { text, imageBase64, imageFormat });
  if (!res || !res.data || !res.data.ok) {
    resultEl.innerHTML = `<div class="lookup-action-message error">Failed${res && res.data && res.data.error ? `: ${res.data.error}` : ""}.</div>`;
    return;
  }
  const d = res.data;
  resultEl.innerHTML = `
    <div class="stat-card"><div class="label">Tone</div><div class="value">${escapeHtml(d.tone)}</div></div>
    <p class="panel-subtitle">${escapeHtml(d.summary || "")}</p>
    <div class="ai-panel-preview">${escapeHtml(d.concerns || "None noted.").replace(/\n/g, "<br>")}</div>
  `;
});

// ── Notifications Center - isolated addition. Bell + badge + dropdown are
// injected into the sidebar in app.html; this just wires them up. Kept
// self-contained (own fetch/render/toggle logic) so it doesn't touch any
// existing init flow beyond being called once after bootMe().
function notifRelativeTime(createdAt) {
  const ts = typeof createdAt === "number" ? createdAt * 1000 : new Date(createdAt).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function renderNotifDropdown(entries) {
  const list = document.getElementById("notifDropdownList");
  if (!list) return;
  if (!entries.length) {
    list.innerHTML = `<div class="notif-dropdown-empty">No notifications yet.</div>`;
    return;
  }
  list.innerHTML = entries
    .map(
      (n) => `
      <div class="notif-dropdown-item${n.read ? "" : " unread"}" data-id="${n._id ?? ""}">
        <span>${escapeHtml(n.message || "")}</span>
        <span class="notif-dropdown-item-time">${notifRelativeTime(n.created_at)}</span>
      </div>`
    )
    .join("");
}

function updateNotifBadge(count) {
  const badge = document.getElementById("notifBellBadge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

async function refreshNotifications() {
  const res = await apiGet("/api/notifications");
  if (!res || !res.ok) return;
  renderNotifDropdown(res.entries || []);
  updateNotifBadge(res.unreadCount || 0);
}

function initNotificationsCenter() {
  const bellBtn = document.getElementById("notifBellBtn");
  const panel = document.getElementById("notifDropdownPanel");
  const markAllBtn = document.getElementById("notifMarkAllReadBtn");
  const list = document.getElementById("notifDropdownList");
  if (!bellBtn || !panel) return;

  bellBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });

  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== bellBtn) {
      panel.hidden = true;
    }
  });

  markAllBtn?.addEventListener("click", async () => {
    await apiPost("/api/notifications/mark-read", {});
    await refreshNotifications();
  });

  list?.addEventListener("click", async (e) => {
    const item = e.target.closest(".notif-dropdown-item");
    if (!item || !item.dataset.id) return;
    await apiPost("/api/notifications/mark-read", { notificationId: item.dataset.id });
    await refreshNotifications();
  });

  refreshNotifications();
}

// ── Welcome tour (first-login onboarding) ────────────────────────────────
// Medium floating panel (not full-screen) shown automatically once - the
// very first time a user ever logs into the dashboard, tracked server-side
// via the dashboard_onboarding_seen user setting (see utils/user_settings.py)
// so it follows the account across browsers/devices instead of resetting
// whenever localStorage gets cleared. Reopenable anytime from Personal
// Settings ("Replay Welcome Tour").
const ONBOARDING_SLIDES = [
  {
    img: "assets/onboarding/01-shift-idle.png",
    title: "Shift Management",
    caption: "Clock in with one tap - pick CHP or SEU and you're on duty. No Discord command needed.",
    track: "you",
  },
  {
    img: "assets/onboarding/02-shift-active.png",
    title: "Live duty tracking",
    caption: "Your timer, break button, and weekly quota all update in real time while you're on shift.",
    track: "you",
  },
  {
    img: "assets/onboarding/03-leave-ra.png",
    title: "Leave & RA",
    caption: "Request an LOA or RA session right here, and track every past request's status in one place.",
    track: "you",
  },
  {
    img: "assets/onboarding/04-history.png",
    title: "History",
    caption: "Your full shift history, broken down by CHP vs SEU duty time.",
    track: "you",
  },
  {
    img: "assets/onboarding/05-profile-1.png",
    title: "Your Profile",
    caption: "Your personal hub - a welcome greeting and your weekly hours trend, right when you log in.",
    track: "you",
  },
  {
    img: "assets/onboarding/06-profile-2.png",
    title: "Badges & Streaks",
    caption: "Earn badges for streaks, tenure, and rank, plus a full breakdown of your duty time by shift type.",
    track: "you",
  },
  {
    img: "assets/onboarding/07-ai-assistant.png",
    title: "AI Assistant",
    caption: "Ask it anything - start your shift, check the leaderboard, or look up CHP info, all in chat.",
    track: "you",
  },
  {
    img: "assets/onboarding/08-leaderboard-rankings.png",
    title: "Leaderboard",
    caption: "See who's leading CHP this week. Filter by period, shift type, or a custom date range.",
    track: "officers",
  },
  {
    img: "assets/onboarding/09-leaderboard-recognized.png",
    title: "Recognized Officers",
    caption: "Officers with 100+ duty hours or 6+ months of tenure get recognized here automatically.",
    track: "officers",
  },
  {
    img: "assets/onboarding/10-leaderboard-feed.png",
    title: "Department Feed",
    caption: "Every promotion and accepted application, newest first, in one feed.",
    track: "officers",
  },
  {
    img: "assets/onboarding/11-command-palette.png",
    title: "Command Palette",
    caption: "Press Ctrl/Cmd+K anywhere to jump straight to any page - faster than clicking through the sidebar.",
    track: "you",
  },
  {
    img: "assets/onboarding/12-settings.png",
    title: "Personal Settings",
    caption: "Customize your experience - theme, accent color, notifications, and more - all synced to your account.",
    track: "you",
  },
];
const ONBOARDING_NEXT_GATE_MS = 5000;

function initOnboardingTour() {
  const backdrop = document.getElementById("onboardingBackdrop");
  const panel = document.getElementById("onboardingPanel");
  const trackLabel = document.getElementById("onboardingTrackLabel");
  const skipBtn = document.getElementById("onboardingSkipBtn");
  const imageEl = document.getElementById("onboardingImage");
  const titleEl = document.getElementById("onboardingTitle");
  const captionEl = document.getElementById("onboardingCaption");
  const dotsEl = document.getElementById("onboardingDots");
  const backBtn = document.getElementById("onboardingBackBtn");
  const nextBtn = document.getElementById("onboardingNextBtn");
  const ring = document.getElementById("onboardingNextRing");
  if (!backdrop || !panel) return;

  let slides = ONBOARDING_SLIDES;
  let index = 0;
  let gateTimer = null;
  let isOpen = false;

  function renderSlide() {
    const slide = slides[index];
    trackLabel.textContent = slide.track === "officers" ? "For Officers" : "For You";
    imageEl.src = slide.img;
    imageEl.alt = slide.title;
    // Re-trigger the fade-in animation on every slide change.
    imageEl.style.animation = "none";
    void imageEl.offsetWidth;
    imageEl.style.animation = "";
    titleEl.textContent = slide.title;
    captionEl.textContent = slide.caption;

    dotsEl.innerHTML = slides
      .map((_, i) => `<span class="onboarding-dot${i === index ? " active" : i < index ? " done" : ""}"></span>`)
      .join("");

    backBtn.disabled = index === 0;

    const isLast = index === slides.length - 1;
    nextBtn.setAttribute("aria-label", isLast ? "Finish" : "Next");
    nextBtn.innerHTML = isLast
      ? `<svg class="onboarding-nav-btn-ring" viewBox="0 0 36 36"><circle class="onboarding-nav-btn-ring-track" cx="18" cy="18" r="16"></circle><circle class="onboarding-nav-btn-ring-fill" id="onboardingNextRing" cx="18" cy="18" r="16"></circle></svg><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`
      : `<svg class="onboarding-nav-btn-ring" viewBox="0 0 36 36"><circle class="onboarding-nav-btn-ring-track" cx="18" cy="18" r="16"></circle><circle class="onboarding-nav-btn-ring-fill" id="onboardingNextRing" cx="18" cy="18" r="16"></circle></svg><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;

    startGate();
  }

  // 5-second read-gate before "Next" unlocks (per slide) - the ring around
  // the button animates its stroke-dashoffset over the same duration as a
  // visual countdown, purely cosmetic; the actual gate is the disabled
  // attribute + this timer.
  function startGate() {
    clearTimeout(gateTimer);
    nextBtn.disabled = true;
    const freshRing = document.getElementById("onboardingNextRing");
    if (freshRing) {
      freshRing.style.transition = "none";
      freshRing.style.strokeDashoffset = "100.5";
      void freshRing.getBoundingClientRect();
      freshRing.style.transition = `stroke-dashoffset ${ONBOARDING_NEXT_GATE_MS}ms linear`;
      freshRing.style.strokeDashoffset = "0";
    }
    gateTimer = window.setTimeout(() => {
      nextBtn.disabled = false;
    }, ONBOARDING_NEXT_GATE_MS);
  }

  function goNext() {
    if (nextBtn.disabled) return;
    if (index >= slides.length - 1) {
      closeTour();
      return;
    }
    index++;
    renderSlide();
  }

  function goBack() {
    if (index === 0) return;
    index--;
    renderSlide();
  }

  function openTour(me) {
    if (isOpen) return;
    isOpen = true;
    slides = ONBOARDING_SLIDES.filter((s) => s.track === "you" || tierAtLeast(me?.tier, "staff"));
    index = 0;
    backdrop.hidden = false;
    backdrop.classList.remove("closing");
    void panel.offsetWidth;
    renderSlide();
  }

  function closeTour() {
    if (!isOpen) return;
    isOpen = false;
    clearTimeout(gateTimer);
    backdrop.classList.add("closing");
    window.setTimeout(() => {
      backdrop.hidden = true;
      backdrop.classList.remove("closing");
    }, 180);
    apiPost("/api/settings", { key: "dashboard_onboarding_seen", value: true });
  }

  nextBtn.addEventListener("click", goNext);
  backBtn.addEventListener("click", goBack);
  skipBtn.addEventListener("click", closeTour);
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) closeTour();
  });
  document.addEventListener("keydown", (e) => {
    if (!isOpen) return;
    if (e.key === "Escape") closeTour();
    else if (e.key === "ArrowRight") goNext();
    else if (e.key === "ArrowLeft") goBack();
  });

  document.getElementById("settingsReplayTourBtn")?.addEventListener("click", () => {
    openTour(currentMe);
  });

  return { openTour };
}
const onboardingTour = initOnboardingTour();

async function maybeShowOnboardingTour(me) {
  if (!onboardingTour) return;
  const res = await apiGet("/api/settings");
  const seen = res && res.ok !== false && res.settings && res.settings.dashboard_onboarding_seen;
  if (!seen) onboardingTour.openTour(me);
}

bootMe().then((me) => {
  loadShiftManagement();
  maybeShowOnboardingTour(me);
});
initNotificationsCenter();

// Rotating community banners - each panel's slot rotates independently.
// Harmless to start all of them at once even though only one panel is
// visible at a time (hidden panels just rotate quietly in the background).
["shift-management", "loa-ra", "history", "profile", "contact", "leaderboard"].forEach(
  (section) => initDashboardBanner(`banner-${section}`)
);

// ── Unified search (header quick-jump: members / transfers / audit log) ──
// Deliberately separate from the Ctrl+K command palette (nav-only, defined
// above around goToSection) and from Member Lookup's own runLookupSearch
// (member-only, lives on the Lookup page). This one lives in the sidebar so
// it's reachable from every page, hits the new /api/search route, and only
// ever renders for tiers that route already gates server-side (non-admin
// tiers just get a 403 and an empty dropdown).
function initUnifiedSearch() {
  const input = document.getElementById("unifiedSearchInput");
  const results = document.getElementById("unifiedSearchResults");
  if (!input || !results) return;

  let seq = 0;
  let debounceTimer = null;

  function closeResults() {
    results.hidden = true;
    results.innerHTML = "";
  }

  function renderGroup(label, items, renderItem) {
    if (!items.length) return "";
    return `
      <div class="unified-search-group-label">${label}</div>
      ${items.map(renderItem).join("")}
    `;
  }

  async function runSearch(query) {
    const mySeq = ++seq;
    if (!query) {
      closeResults();
      return;
    }

    results.hidden = false;
    results.innerHTML = `<div class="unified-search-loading">Searching...</div>`;

    const res = await apiPost("/api/search", { query });
    if (mySeq !== seq) return; // superseded by a newer keystroke

    if (!res || !res.ok) {
      results.innerHTML = `<div class="unified-search-empty">Search unavailable right now.</div>`;
      return;
    }

    const members = res.data.members || [];
    const transfers = res.data.transfers || [];
    const auditEntries = res.data.auditEntries || [];

    if (!members.length && !transfers.length && !auditEntries.length) {
      results.innerHTML = `<div class="unified-search-empty">No matches found.</div>`;
      return;
    }

    results.innerHTML =
      renderGroup("Members", members, (m) => `
        <div class="unified-search-item" data-type="member" data-user-id="${escapeHtml(m.userId)}">
          <span class="unified-search-item-title">${escapeHtml(m.nickname || m.username || "Unknown")}</span>
          <span class="unified-search-item-sub">${escapeHtml(m.username || "")}</span>
        </div>
      `) +
      renderGroup("Transfer Requests", transfers, (t) => `
        <div class="unified-search-item" data-type="transfer" data-transfer-id="${escapeHtml(t.transferId)}">
          <span class="unified-search-item-title">Transfer ${escapeHtml((t.transferId || "").slice(-8))}</span>
          <span class="unified-search-item-sub">${escapeHtml(t.status || "unknown status")}</span>
        </div>
      `) +
      renderGroup("Audit Log", auditEntries, (a) => `
        <div class="unified-search-item" data-type="audit">
          <span class="unified-search-item-title">${escapeHtml(a.action || "Unknown action")}</span>
          <span class="unified-search-item-sub">${escapeHtml(a.detail || "")}</span>
        </div>
      `);

    results.querySelectorAll(".unified-search-item").forEach((item) => {
      item.addEventListener("click", () => {
        const type = item.dataset.type;
        if (type === "member") {
          showPanel("lookup");
          loadLookupDetail(item.dataset.userId);
        } else if (type === "transfer") {
          showPanel("transfers");
          loadTransfersQueue();
        } else if (type === "audit") {
          showPanel("boc");
          bocSwitchToTab("audit-log");
        }
        closeResults();
        input.value = "";
      });
    });
  }

  input.addEventListener("input", (e) => {
    const query = e.target.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(query), 200);
  });
  input.addEventListener("focus", () => {
    if (input.value.trim() && !results.hidden) results.hidden = false;
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#unifiedSearchWrap")) closeResults();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeResults();
  });
}
initUnifiedSearch();
