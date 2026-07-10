const WORKER_URL = "https://chp-dashboard-api.aidenspearb.workers.dev";

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
const TIER_ORDER = ["staff", "admin", "management", "developer"];
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

// Fetched once at boot so both the sidebar (admin/management/developer group)
// and the Profile panel can use it without re-fetching /api/me repeatedly.
async function bootMe() {
  const me = await apiGet("/api/me");
  if (!me) return null;
  currentMe = me;

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
    const sidebar = document.getElementById("sidebar");
    const group = document.createElement("div");
    group.className = "nav-group";
    group.innerHTML = `
      <p class="nav-category">High Ranks</p>
      <button class="nav-item" data-section="lookup">Member Lookup</button>
    `;
    sidebar.appendChild(group);
    const lookupBtn = group.querySelector(".nav-item");
    lookupBtn.addEventListener("click", () => showPanel("lookup"));

    // Phase 4 - High Ranks tier (admin and above): LOA Management,
    // Transfer Requests, RA Oversight, Promotion Quota, and the Officers
    // roster/action panel. Not confidential-only, so visible to High Ranks
    // and above (not gated further like the BOC group below).
    const phase4Items = [
      { section: "officers-mgmt", label: "Officers", onOpen: loadOfficersRoster },
      { section: "loa-mgmt", label: "LOA Management", onOpen: loadLoaManagement },
      { section: "transfers", label: "Transfer Requests", onOpen: loadTransfersQueue },
      { section: "ra-oversight", label: "RA Oversight", onOpen: loadRaOversight },
      { section: "promotion-quota", label: "Promotion Quota", onOpen: loadPromotionQuota },
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
      group.appendChild(btn);
    });
  }

  // Phase 5 - Board of Commissioners tier: management and above (developer
  // included, since developer must be treated as >= every tier). Gets its
  // own group with its own header, distinct from the High Ranks group above.
  if (tierAtLeast(me.tier, "management")) {
    const sidebar = document.getElementById("sidebar");
    const group = document.createElement("div");
    group.className = "nav-group";
    group.innerHTML = `<p class="nav-category">Board of Commissioners</p>`;
    sidebar.appendChild(group);
    const bocBtn = document.createElement("button");
    bocBtn.className = "nav-item";
    bocBtn.dataset.section = "boc";
    bocBtn.textContent = "Board of Commissioners";
    bocBtn.addEventListener("click", () => {
      showPanel("boc");
      loadBocActiveTab();
    });
    group.appendChild(bocBtn);
  }

  // Developer Tools nav item - Developer tier only, per the Phase 6 plan
  // ("this page itself must be visible ONLY to the developer tier").
  if (tierAtLeast(me.tier, "developer")) {
    const sidebar = document.getElementById("sidebar");
    const group = document.createElement("div");
    group.className = "nav-group";
    group.innerHTML = `
      <p class="nav-category">Developer</p>
      <button class="nav-item" data-section="developer">Developer Tools</button>
    `;
    sidebar.appendChild(group);
    const devBtn = group.querySelector(".nav-item");
    devBtn.addEventListener("click", () => {
      showPanel("developer");
      loadDevKillSwitches();
    });
  }

  return me;
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

  document.getElementById("overviewSkeleton").hidden = true;
  const cards = document.getElementById("overviewCards");
  cards.hidden = false;
  cards.innerHTML = `
    <div class="stat-card"><div class="label">Access tier</div><div class="value">${me.tier}</div></div>
    <div class="stat-card"><div class="label">Total duty time</div><div class="value">${formatDuration(shifts.totalSeconds)}</div></div>
    <div class="stat-card"><div class="label">Shifts logged</div><div class="value">${shifts.shiftCount}</div></div>
  `;

  document.getElementById("shiftsSkeleton").hidden = true;
  const body = document.getElementById("shiftsBody");
  body.hidden = false;
  body.innerHTML = renderShiftsSummaryHtml(shifts);

  document.getElementById("badgesSkeleton").hidden = true;
  const badgesGrid = document.getElementById("badgesGrid");
  badgesGrid.hidden = false;
  if (!badgesRes || badgesRes.ok === false) {
    badgesGrid.innerHTML = `<div class="empty-state">Badge data is unavailable right now.</div>`;
  } else {
    const badges = badgesRes.badges || [];
    const extra = `
      <div class="badge-card">Streak: ${badgesRes.streak ?? 0}</div>
      <div class="badge-card">Tenure: ${badgesRes.tenureDays != null ? `${badgesRes.tenureDays}d` : "N/A"}</div>
      <div class="badge-card">Rank: ${badgesRes.rank || "Unranked"}</div>
    `;
    const badgeCards = badges.map((b) => `<div class="badge-card">${b}</div>`).join("");
    badgesGrid.innerHTML = extra + badgeCards || `<div class="empty-state">No badges yet.</div>`;
  }
}

async function loadHistory() {
  const history = await apiGet("/api/history");
  if (!history) return;

  document.getElementById("historySkeleton").hidden = true;
  const list = document.getElementById("historyList");
  list.hidden = false;
  list.innerHTML = renderHistoryEntries(history.entries);
}

let lookupSelectedUserId = null;

async function performLookupSearch() {
  const input = document.getElementById("lookupSearchInput");
  const query = input.value.trim();
  const resultsWrap = document.getElementById("lookupResultsWrap");
  document.getElementById("lookupDetailWrap").innerHTML = "";
  if (!query) return;

  resultsWrap.innerHTML = `<div class="skeleton" style="height: 60px;"></div>`;

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
        <li class="lookup-result-row" data-user-id="${r.userId}">
          <span class="lookup-result-name">${r.username}</span>
          ${r.nickname ? `<span class="lookup-result-nick">${r.nickname}</span>` : ""}
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

  const [shifts, history, roblox] = await Promise.all([
    apiGet(`/api/lookup/${userId}/shifts`),
    apiGet(`/api/lookup/${userId}/history`),
    apiGet(`/api/lookup/${userId}/roblox`),
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

  detailWrap.innerHTML = `
    <h2 class="lookup-detail-heading">Shifts</h2>
    ${renderShiftsSummaryHtml(shifts)}
    <h2 class="lookup-detail-heading" style="margin-top: 22px;">Linked Roblox</h2>
    ${robloxHtml}
    <h2 class="lookup-detail-heading" style="margin-top: 22px;">History</h2>
    <ol class="history-list">${renderHistoryEntries(history.entries)}</ol>
    <div class="lookup-actions">
      <button class="lookup-action-btn" data-action="force_end">Force End Shift</button>
      <button class="lookup-action-btn" data-action="reset">Reset Period</button>
    </div>
    <div id="lookupActionMessage"></div>
  `;

  detailWrap.querySelectorAll(".lookup-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleAdminActionClick(btn));
  });
}

function handleAdminActionClick(btn) {
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
  fireAdminAction(btn.dataset.action);
}

async function fireAdminAction(action) {
  const messageEl = document.getElementById("lookupActionMessage");
  const res = await apiPost("/api/admin/shift-action", { userId: lookupSelectedUserId, action });
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
    .map(
      (entry) => `
        <li class="department-feed-row">
          <span class="department-feed-icon department-feed-icon-${entry.kind}">${DEPARTMENT_FEED_ICON[entry.kind] || "•"}</span>
          <span class="department-feed-desc">
            ${entry.username ? `<span class="department-feed-name">${entry.username}</span> — ` : ""}${entry.description}
          </span>
          <span class="department-feed-date">${formatDate(entry.timestamp)}</span>
        </li>
      `
    )
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

async function loadShiftManagement() {
  document.getElementById("shiftMgmtSkeleton").hidden = true;
  document.getElementById("shiftMgmtBody").hidden = false;

  await refreshCurrentShift();
  loadMiniLeaderboard();
  loadQuotaRing();
  loadQuickStats();

  if (shiftPollInterval) clearInterval(shiftPollInterval);
  shiftPollInterval = setInterval(refreshCurrentShift, 45000);
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
  const res = await apiPost("/api/shift/end", {});
  if (!res || !res.ok || !res.data || res.data.ok === false) {
    showShiftMessage(`Could not end shift: ${(res && res.data && res.data.error) || "unknown error"}`, "error");
    return;
  }
  showShiftMessage("Shift ended.", "success");
  refreshCurrentShift();
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
document.getElementById("shiftEndBtn").addEventListener("click", (e) => {
  const btn = e.target;
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
  endShift();
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

function renderSettingRow(key, value) {
  const label = key.replace(/_/g, " ");
  if (Array.isArray(value)) {
    // e.g. profile_widgets - no dedicated editor yet; show read-only rather
    // than risk overwriting an array field with a plain string on save.
    return `
      <div class="settings-row" data-key="${key}">
        <span class="settings-row-label">${label}</span>
        <span class="settings-row-status">${value.join(", ") || "(none)"}</span>
      </div>
    `;
  }
  if (typeof value === "boolean") {
    return `
      <div class="settings-row" data-key="${key}">
        <span class="settings-row-label">${label}</span>
        <button class="settings-toggle ${value ? "on" : ""}" data-key="${key}" data-value="${value}"></button>
        <span class="settings-row-status" data-status></span>
      </div>
    `;
  }
  if (typeof value === "number") {
    return `
      <div class="settings-row" data-key="${key}">
        <span class="settings-row-label">${label}</span>
        <input type="number" data-key="${key}" value="${value}">
        <span class="settings-row-status" data-status></span>
      </div>
    `;
  }
  return `
    <div class="settings-row" data-key="${key}">
      <span class="settings-row-label">${label}</span>
      <input type="text" data-key="${key}" value="${value ?? ""}">
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
  const list = document.getElementById("settingsList");
  list.hidden = false;

  if (!res || res.ok === false) {
    list.innerHTML = `<div class="empty-state">Settings are unavailable right now.</div>`;
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
    list.innerHTML = `<div class="empty-state">No settings to show.</div>`;
    return;
  }

  list.innerHTML = entries.map(([key, value]) => renderSettingRow(key, value)).join("");

  list.querySelectorAll(".settings-toggle").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const newValue = toggle.dataset.value !== "true";
      toggle.classList.toggle("on", newValue);
      toggle.dataset.value = String(newValue);
      saveSetting(toggle.closest(".settings-row"), toggle.dataset.key, newValue);
    });
  });

  list.querySelectorAll("input[type='number'], input[type='text']").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.key;
      const value = input.type === "number" ? Number(input.value) : input.value;
      saveSetting(input.closest(".settings-row"), key, value);
    });
  });
}

// ── Contact Us ──

document.getElementById("contactForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const messageEl = document.getElementById("contactFormMessage");
  const message = document.getElementById("contactMessage").value.trim();
  if (!message) return;

  const res = await apiPost("/api/contact", { message, page: "contact" });
  if (!res || !res.ok || !res.data || res.data.ok === false) {
    messageEl.innerHTML = `<div class="form-message error">Could not send your message. Please try again.</div>`;
    return;
  }
  messageEl.innerHTML = `<div class="form-message success">Message sent. We'll get back to you soon.</div>`;
  document.getElementById("contactMessage").value = "";
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

document.querySelectorAll(".nav-item[data-section]").forEach((item) => {
  item.addEventListener("click", () => {
    const section = item.dataset.section;
    showPanel(section);
    if (section === "shift-management") loadShiftManagement();
    if (section === "loa") loadLoa();
    if (section === "ra") loadRa();
    if (section === "history") loadHistory();
    if (section === "profile") loadProfile();
    if (section === "settings") { loadSettings(); loadSessionInfo(); }
    if (section === "leaderboard") {
      loadLeaderboard();
      startLeaderboardAutoRefresh();
    } else {
      stopLeaderboardAutoRefresh();
    }
    if (section === "recognized-officers") loadRecognizedOfficers();
    if (section === "department-feed") loadDepartmentFeed();
  });
});

// ── Reduce Motion + Accent Color (client-only prefs, localStorage) ──
// Dashboard-rendering concerns only, per the plan: not a bot-side
// user_settings field, so these never touch the bridge/bot.
const REDUCE_MOTION_KEY = "chp_reduce_motion";
const ACCENT_COLOR_KEY = "chp_accent_color";
const DEFAULT_ACCENT = "#c9a66b"; // matches --chp-gold in assets/chp-theme.css

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

function initPersonalPrefs() {
  applyReduceMotion(localStorage.getItem(REDUCE_MOTION_KEY) === "true");
  applyAccentColor(localStorage.getItem(ACCENT_COLOR_KEY) || DEFAULT_ACCENT);

  document.getElementById("reduceMotionToggle")?.addEventListener("click", () => {
    const next = localStorage.getItem(REDUCE_MOTION_KEY) !== "true";
    localStorage.setItem(REDUCE_MOTION_KEY, String(next));
    applyReduceMotion(next);
  });

  document.getElementById("accentColorInput")?.addEventListener("input", (e) => {
    localStorage.setItem(ACCENT_COLOR_KEY, e.target.value);
    applyAccentColor(e.target.value);
  });

  document.getElementById("accentColorReset")?.addEventListener("click", () => {
    localStorage.removeItem(ACCENT_COLOR_KEY);
    applyAccentColor(DEFAULT_ACCENT);
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

// Two toggle buttons, one state: the in-sidebar chevron (visible while open,
// rides the sidebar's own edge so it never overlaps the brand logo) and the
// content-pinned chevron (visible only once collapsed, per .shell.collapsed
// .content-sidebar-toggle in app.css) - both just flip the same class.
function toggleSidebar() {
  document.getElementById("shell").classList.toggle("collapsed");
}
document.getElementById("sidebarToggle").addEventListener("click", toggleSidebar);
document.getElementById("sidebarToggleCollapsed").addEventListener("click", toggleSidebar);

document.getElementById("lookupSearchBtn").addEventListener("click", performLookupSearch);
document.getElementById("lookupSearchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") performLookupSearch();
});

// ── AI Assistant (floating panel, present on every page) ──

const aiConversationId = crypto.randomUUID();
let aiPendingProposal = null; // { proposalId } for the most recent unconfirmed proposal

function aiAppendBubble(role, text) {
  const messages = document.getElementById("aiMessages");
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
  // Tuned so a ~200-char message takes ~1.5-3s: reveal a small chunk of
  // characters every ~20ms.
  const CHUNK_MS = 20;
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
  typing.innerHTML = "<span></span><span></span><span></span>";
  messages.appendChild(typing);
  messages.scrollTop = messages.scrollHeight;
}

function aiHideTyping() {
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
  aiAppendBubble("user", message);
  aiShowTyping();

  const res = await apiPost("/api/ai/chat", { message, conversationId: aiConversationId });
  aiHideTyping();
  if (!res) return; // 401 redirect already handled by apiPost
  if (!res.ok || !res.data) {
    typewriterReveal(aiAppendBubble("assistant", ""), "Sorry, the assistant is unavailable right now. Please try again later.");
    return;
  }

  const data = res.data;
  typewriterReveal(aiAppendBubble("assistant", ""), data.text || "", () => {
    if (data.type === "proposal" && data.proposalId) {
      aiPendingProposal = { proposalId: data.proposalId };
      aiAppendProposalActions(data.proposalId);
    }
  });
}

const AI_PANEL_GEOMETRY_KEY = "chp-dashboard-ai-panel-geometry";
const AI_PANEL_DEFAULT_WIDTH = 360;
const AI_PANEL_DEFAULT_HEIGHT = 480;
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
  document.getElementById("aiPanel").classList.add("open");
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
  if (bocActiveTab === "applications") return loadBocApplications();
  if (bocActiveTab === "audit-log") return loadBocAuditLog();
  if (bocActiveTab === "ra-stats") return loadBocRaStats();
  if (bocActiveTab === "settings") return loadBocSettings();
}

document.querySelectorAll("#bocTabs .dev-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    bocActiveTab = tab.dataset.bocTab;
    document.querySelectorAll("#bocTabs .dev-tab").forEach((t) => t.classList.toggle("active", t === tab));
    document
      .querySelectorAll("#panel-boc > .dev-panel")
      .forEach((p) => p.classList.toggle("active", p.id === `bocPanel-${bocActiveTab}`));
    loadBocActiveTab();
  });
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

  const res = await apiPost("/api/boc/dm-officers", { target, message });
  if (!res || !res.ok || !res.data || res.data.ok === false) {
    const reason = res && res.data ? res.data.reason || res.data.error : "request_failed";
    resultEl.innerHTML = `<div class="lookup-action-message error">Failed: ${reason}</div>`;
    return;
  }
  resultEl.innerHTML = `<div class="lookup-action-message success">Sent to ${res.data.sent} officer(s), ${res.data.failed} failed.</div>`;
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

  const res = await apiPost("/api/boc/announcement", { channelId, title, description, pingRoleId });
  if (!res || !res.ok || !res.data || res.data.ok === false) {
    const reason = res && res.data ? res.data.reason || res.data.error : "request_failed";
    resultEl.innerHTML = `<div class="lookup-action-message error">Failed: ${reason}</div>`;
    return;
  }
  resultEl.innerHTML = `<div class="lookup-action-message success">Posted (message ${res.data.messageId}).</div>`;
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
  skeleton.hidden = false;
  body.hidden = true;

  const res = await bocGet("/api/boc/settings");
  skeleton.hidden = true;
  if (!res) return bocShowDenied();
  if (res.reason === "confidential" || res.reason === "forbidden") return bocShowDenied(res.reason);

  body.hidden = false;
  body.textContent = res.settings ? JSON.stringify(res.settings, null, 2) : "No settings document found.";
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
  });
});

async function loadDevKillSwitches() {
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

async function loadOfficersRoster() {
  const skeleton = document.getElementById("officersRosterSkeleton");
  const list = document.getElementById("officersRosterList");
  document.getElementById("officerDetailWrap").innerHTML = "";
  const res = await apiGet("/api/hr/officers/roster");
  skeleton.hidden = true;
  list.hidden = false;
  if (!res || !res.ok || !res.officers || res.officers.length === 0) {
    list.innerHTML = `<li class="empty-state">No officers found (or the staff role isn't configured).</li>`;
    return;
  }
  const officersById = {};
  res.officers.forEach((o) => (officersById[o.userId] = o));
  window._officersById = officersById;

  list.innerHTML = res.officers
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

let officerDetailUserId = null;

function openOfficerDetail(userId) {
  officerDetailUserId = userId;
  const officer = (window._officersById || {})[userId];
  const wrap = document.getElementById("officerDetailWrap");
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

bootMe().then(() => loadShiftManagement());
