const WORKER_URL = "https://chp-dashboard-api.aidenspearb.workers.dev";

// ── Rotating community banners ──────────────────────────────────────────
// Community-submitted photos, hand-picked by the developer from the
// official-media Discord channel (credited photographer(s) shown in the
// corner). One shared manifest (assets/banners/manifest.json) drives every
// banner slot on the page - each slot gets its own independently-shuffled,
// independently-timed rotation (30s per image) so multiple banners on
// screen at once don't all flip in lockstep. Static content (developer adds
// entries to manifest.json as new photos are chosen), so no backend/API
// call is needed here beyond fetching that one JSON file.
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

async function initDashboardBanner(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
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
    incoming.src = `assets/banners/${entry.file}`;
    incoming.alt = "";
    incoming.onload = () => {
      incoming.classList.add("dashboard-banner-visible");
      outgoing.classList.remove("dashboard-banner-visible");
    };
    credit.textContent = `Credits: ${entry.credits}`;
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

attachGlassPointerTracking(document.getElementById("sidebar"));

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
          <span class="shifts-type-bar-track"><span class="shifts-type-bar-fill" style="width: ${pct}%"></span></span>
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

function showPanel(section) {
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
  document.getElementById(`panel-${section}`).classList.add("active");
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.section === section);
  });
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
      { section: "officers-mgmt", label: "Officers", onOpen: loadOfficersRoster },
      ...(me.tier === "admin"
        ? [
            { section: "loa-mgmt", label: "LOA Management", onOpen: loadLoaManagement },
            { section: "ra-oversight", label: "RA Oversight", onOpen: loadRaOversight },
          ]
        : []),
      { section: "transfers", label: "Transfer Requests", onOpen: loadTransfersQueue },
    ];
    phase4Items.forEach(({ section, label, onOpen }) => {
      const btn = document.createElement("button");
      btn.className = "nav-item";
      btn.dataset.section = section;
      btn.textContent = label;
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
      { section: "loa-mgmt", label: "LOA Management", onOpen: loadLoaManagement },
      { section: "ra-oversight", label: "RA Oversight", onOpen: loadRaOversight },
    ];
    commandTeamItems.forEach(({ section, label, onOpen }) => {
      const btn = document.createElement("button");
      btn.className = "nav-item";
      btn.dataset.section = section;
      btn.textContent = label;
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
    const bocSubItems = [
      { tab: "quota-enforcement", label: "Quota Enforcement" },
      { tab: "hr-review", label: "HR Promotion Review" },
      { tab: "hr-oversight", label: "HR Oversight" },
      { tab: "leaderboard-control", label: "Leaderboard Control" },
      { tab: "schedules", label: "Scheduled Actions" },
      { tab: "applications", label: "Applications" },
      { tab: "audit-log", label: "Audit Log" },
      { tab: "dm-officers", label: "DM Officers" },
      { tab: "announcement", label: "Announcement" },
      { tab: "ra-stats", label: "RA Program Stats" },
      { tab: "settings", label: "Settings" },
    ];
    bocSubItems.forEach(({ tab, label }) => {
      const btn = document.createElement("button");
      btn.className = "nav-item";
      btn.dataset.section = "boc";
      btn.dataset.bocNavTab = tab;
      btn.textContent = label;
      btn.addEventListener("click", () => {
        showPanel("boc");
        bocSwitchToTab(tab);
      });
      bocItemsWrap.appendChild(btn);
    });

    // Bug 1 fix: Promotion Quota moved here from the High Ranks (admin)
    // group - promotion/quota data is BOC-only.
    const quotaBtn = document.createElement("button");
    quotaBtn.className = "nav-item";
    quotaBtn.dataset.section = "promotion-quota";
    quotaBtn.textContent = "Promotion Quota";
    quotaBtn.addEventListener("click", () => {
      showPanel("promotion-quota");
      loadPromotionQuota();
    });
    bocItemsWrap.appendChild(quotaBtn);
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
        <button class="nav-item" data-section="developer">Developer Tools</button>
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
        <button class="nav-item" data-section="fto-tools">FTO Tools</button>
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
        <button class="nav-item" data-section="ia-tools">IA Tools</button>
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
  const height = 160;
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
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="weekly-trend-dot"><title>${weekLabel}: ${hours[i].toFixed(1)}h</title></circle>`;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" class="weekly-trend-svg" preserveAspectRatio="xMidYMid meet">
      <path d="${areaPath}" class="weekly-trend-area"></path>
      <path d="${linePath}" class="weekly-trend-line"></path>
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

function renderLeaderboardRows(entries, period) {
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
          <span class="leaderboard-rank">${index + 1}</span>
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

  // Smooth transition: fade the existing list out, fetch, then fade+slide the
  // fresh rows in (extends the .panel-in / .leaderboard-row animation pattern
  // already used elsewhere rather than introducing a new one).
  if (!list.hidden) {
    list.classList.add("is-loading");
    skeleton.hidden = false;
  }

  const leaderboard = await apiGet(path);
  skeleton.hidden = true;
  list.classList.remove("is-loading");
  list.hidden = false;

  if (!leaderboard) {
    list.innerHTML = `<li class="empty-state">Failed to load leaderboard. Try again.</li>`;
    return;
  }

  list.innerHTML = renderLeaderboardRows(leaderboard.entries, currentLeaderboardPeriod);
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

function renderDepartmentFeedRows(entries) {
  if (entries.length === 0) {
    return `<li class="empty-state">No recent department activity.</li>`;
  }
  return entries
    .map((entry) => {
      const avatarUrl = avatarUrlFor(entry.userId, entry.avatar, 32);
      return `
        <li class="department-feed-row">
          <img class="department-feed-avatar" src="${avatarUrl}" alt="" width="28" height="28">
          <span class="department-feed-icon department-feed-icon-${entry.kind}">${DEPARTMENT_FEED_ICON[entry.kind] || "•"}</span>
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
      <span class="quick-stat-value">${formatDuration(weekSeconds)}</span>
      <span class="quick-stat-label">This week</span>
    </div>
    <div class="quick-stat">
      <span class="quick-stat-value">${totalShiftCount}</span>
      <span class="quick-stat-label">Total shifts</span>
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

function renderShiftState(shift) {
  currentShiftState = shift;
  const off = document.getElementById("currentShiftOff");
  const on = document.getElementById("currentShiftOn");

  if (!shift || !shift.active) {
    off.hidden = false;
    on.hidden = true;
    if (shiftTimerInterval) {
      clearInterval(shiftTimerInterval);
      shiftTimerInterval = null;
    }
    return;
  }

  off.hidden = true;
  on.hidden = false;
  document.getElementById("currentShiftType").textContent = shift.shiftType;
  const breakBtn = document.getElementById("shiftBreakBtn");
  breakBtn.textContent = shift.onBreak ? "End Break" : "Start Break";
  breakBtn.classList.toggle("on-break", !!shift.onBreak);

  const timerEl = document.getElementById("currentShiftTimer");
  const tick = () => {
    timerEl.textContent = formatHms(computeElapsedSeconds(currentShiftState));
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
  const entries = Object.entries(settings);
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
    tipEl.textContent = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];
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
    if (section === "loa") withLoadingOverlay(loadLoa);
    if (section === "ra") withLoadingOverlay(loadRa);
    if (section === "history") withLoadingOverlay(loadHistory);
    if (section === "profile") withLoadingOverlay(loadProfile);
    if (section === "settings") withLoadingOverlay(loadSettings, loadSessionInfo);
    if (section === "leaderboard") {
      withLoadingOverlay(loadLeaderboard);
      startLeaderboardAutoRefresh();
    } else {
      stopLeaderboardAutoRefresh();
    }
    if (section === "recognized-officers") withLoadingOverlay(loadRecognizedOfficers);
    if (section === "department-feed") withLoadingOverlay(loadDepartmentFeed);
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
    window.location.href = "index.html?switch=1";
  });
  document.getElementById("sidebarLogoutBtn")?.addEventListener("click", async () => {
    await apiPost("/api/logout", {});
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

const AI_CONVERSATIONS_KEY = "chp_ai_conversations";
const AI_ACTIVE_CONVERSATION_KEY = "chp_ai_active_conversation_id";
let aiConversations = []; // [{id, title, messages: [{role, content, timestamp}]}]
let aiActiveConversationId = null;
let aiPendingProposal = null; // { proposalId } for the most recent unconfirmed proposal
let aiTypingSlowTimer = null; // pending "Still working..." swap for the in-flight request

function aiLoadConversations() {
  try {
    const raw = localStorage.getItem(AI_CONVERSATIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length) {
      aiConversations = parsed;
      return;
    }
  } catch (e) {
    // corrupt/unreadable storage - fall through to a fresh conversation
  }
  aiConversations = [aiCreateConversationObject()];
}

function aiSaveConversations() {
  try {
    localStorage.setItem(AI_CONVERSATIONS_KEY, JSON.stringify(aiConversations));
  } catch (e) {
    // storage full/unavailable - conversations still work for this page load
  }
}

function aiCreateConversationObject() {
  return { id: crypto.randomUUID(), title: "New Chat", messages: [] };
}

function aiGetActiveConversation() {
  return aiConversations.find((c) => c.id === aiActiveConversationId) || aiConversations[0];
}

function aiPopulateConvoSelect() {
  const select = document.getElementById("aiConvoSelect");
  if (!select) return;
  select.innerHTML = "";
  aiConversations.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.title || "New Chat";
    // Full title on hover - the closed select box now truncates with an
    // ellipsis (see .ai-convo-select in app.css), so long auto-generated
    // titles are still fully readable via tooltip instead of just being cut.
    opt.title = c.title || "New Chat";
    select.appendChild(opt);
  });
  select.value = aiActiveConversationId;
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
  convo.messages.forEach((m) => {
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

function aiInitConversations() {
  aiLoadConversations();
  let savedActiveId = null;
  try {
    savedActiveId = localStorage.getItem(AI_ACTIVE_CONVERSATION_KEY);
  } catch (e) {
    savedActiveId = null;
  }
  if (savedActiveId && aiConversations.some((c) => c.id === savedActiveId)) {
    aiActiveConversationId = savedActiveId;
  } else if (!aiActiveConversationId || !aiConversations.some((c) => c.id === aiActiveConversationId)) {
    aiActiveConversationId = aiConversations[0].id;
  }
  aiPopulateConvoSelect();
  aiRenderActiveConversation();
}

function aiNewChat() {
  const convo = aiCreateConversationObject();
  aiConversations.push(convo);
  aiActiveConversationId = convo.id;
  aiSaveConversations();
  aiSaveActiveConversationId();
  aiPopulateConvoSelect();
  aiRenderActiveConversation();
  const input = document.getElementById("aiInput");
  if (input) input.focus();
}

function aiSwitchConversation(id) {
  if (!aiConversations.some((c) => c.id === id)) return;
  aiActiveConversationId = id;
  aiSaveActiveConversationId();
  aiRenderActiveConversation();
}

function aiAppendBubble(role, text) {
  const messages = document.getElementById("aiMessages");
  const empty = messages ? messages.querySelector(".ai-empty-state") : null;
  if (empty) empty.remove();
  const bubble = document.createElement("div");
  bubble.className = `ai-bubble ${role}`;
  bubble.textContent = text;
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
  typing.innerHTML = '<span class="ai-typing-label">Thinking...</span><span></span><span></span><span></span>';
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

async function aiSendMessage(message) {
  const convo = aiGetActiveConversation();
  aiAppendBubble("user", message);
  if (convo) {
    convo.messages.push({ role: "user", content: message, timestamp: Date.now() });
    if ((!convo.title || convo.title === "New Chat") && convo.messages.filter((m) => m.role === "user").length === 1) {
      const trimmed = message.trim();
      convo.title = trimmed.length > 40 ? `${trimmed.slice(0, 37).trim()}…` : trimmed;
      aiPopulateConvoSelect();
    }
    aiSaveConversations();
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
        aiSendMessage(message);
      });
      bubble.appendChild(document.createElement("br"));
      bubble.appendChild(retryBtn);
      const messagesEl = document.getElementById("aiMessages");
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
    if (convo) {
      convo.messages.push({ role: "assistant", content: errText, timestamp: Date.now() });
      aiSaveConversations();
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
      body: JSON.stringify({ message, conversationId: aiActiveConversationId, history: historyPayload }),
    });
  } catch {
    onError("Sorry, the assistant is unavailable right now. Please try again later.");
    return;
  }

  if (response.status === 401) {
    window.location.href = "index.html";
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
    aiSaveConversations();
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
const AI_PANEL_DEFAULT_WIDTH = 500;
const AI_PANEL_DEFAULT_HEIGHT = 650;
const AI_PANEL_MIN_WIDTH = 300;
const AI_PANEL_MIN_HEIGHT = 360;
const AI_PANEL_MAX_WIDTH = 720;

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
  aiInitConversations();
  document.getElementById("aiPanel").classList.add("open");
  attachGlassPointerTracking(document.getElementById("aiPanel"));
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

document.getElementById("aiNewChatBtn").addEventListener("click", aiNewChat);

document.getElementById("aiConvoSelect").addEventListener("change", (e) => {
  aiSwitchConversation(e.target.value);
});

document.getElementById("aiInputForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("aiInput");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  aiSendMessage(message);
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
  if (bocActiveTab === "audit-log") return loadBocAuditLog();
  if (bocActiveTab === "anonymous-feedback") return loadBocAnonymousFeedback();
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
  });
});

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

bootMe().then(() => loadShiftManagement());
initNotificationsCenter();

// Rotating community banners - each panel's slot rotates independently.
// Harmless to start all of them at once even though only one panel is
// visible at a time (hidden panels just rotate quietly in the background).
["shift-management", "loa", "ra", "history", "profile", "contact", "leaderboard", "recognized-officers", "department-feed"].forEach(
  (section) => initDashboardBanner(`banner-${section}`)
);
