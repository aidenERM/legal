const WORKER_URL = "https://chp-dashboard-api.aidenspearb.workers.dev";

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
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

const TIER_BADGE_COPY = {
  staff: "CHP Patrol Operations",
  admin: "CHP Human Resources & Command",
  management: "Board of Commissioners",
};

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

async function loadOverview() {
  const me = await apiGet("/api/me");
  const shifts = await apiGet("/api/shifts");
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

  if (me.tier === "admin" || me.tier === "management") {
    const categoryLabel = me.tier === "management" ? "Board of Commissioners" : "High Ranks";
    const sidebar = document.getElementById("sidebar");
    const group = document.createElement("div");
    group.className = "nav-group";
    group.innerHTML = `
      <p class="nav-category">${categoryLabel}</p>
      <button class="nav-item" data-section="lookup">Member Lookup</button>
    `;
    sidebar.appendChild(group);
    const lookupBtn = group.querySelector(".nav-item");
    lookupBtn.addEventListener("click", () => showPanel("lookup"));
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

  const [shifts, history] = await Promise.all([
    apiGet(`/api/lookup/${userId}/shifts`),
    apiGet(`/api/lookup/${userId}/history`),
  ]);

  if (!shifts || !history) {
    detailWrap.innerHTML = `<div class="empty-state" style="margin-top: 20px;">Failed to load member details.</div>`;
    return;
  }

  detailWrap.innerHTML = `
    <h2 class="lookup-detail-heading">Shifts</h2>
    ${renderShiftsSummaryHtml(shifts)}
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

async function loadShifts() {
  const shifts = await apiGet("/api/shifts");
  if (!shifts) return;

  document.getElementById("shiftsSkeleton").hidden = true;
  const body = document.getElementById("shiftsBody");
  body.hidden = false;

  if (shifts.byType.length === 0) {
    body.innerHTML = `<div class="empty-state">No completed shifts logged yet.</div>`;
    return;
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

  body.innerHTML = `
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

async function loadLeaderboard() {
  const leaderboard = await apiGet("/api/leaderboard");
  if (!leaderboard) return;

  document.getElementById("leaderboardSkeleton").hidden = true;
  const list = document.getElementById("leaderboardList");
  list.hidden = false;

  if (leaderboard.entries.length === 0) {
    list.innerHTML = `<li class="empty-state">No leaderboard data yet.</li>`;
    return;
  }

  list.innerHTML = leaderboard.entries
    .map((entry, index) => {
      const avatarUrl = avatarUrlFor(entry.userId, entry.avatar, 64);
      return `
        <li class="leaderboard-row">
          <span class="leaderboard-rank">${index + 1}</span>
          <img class="leaderboard-avatar" src="${avatarUrl}" alt="" width="32" height="32">
          <span class="leaderboard-name">${entry.username}</span>
          <span class="leaderboard-time">${formatDuration(entry.totalSeconds)}</span>
        </li>
      `;
    })
    .join("");
}

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    const section = item.dataset.section;
    showPanel(section);
    if (section === "shifts") loadShifts();
    if (section === "leaderboard") loadLeaderboard();
    if (section === "history") loadHistory();
  });
});

document.getElementById("sidebarToggle").addEventListener("click", () => {
  document.getElementById("shell").classList.toggle("collapsed");
});

document.getElementById("lookupSearchBtn").addEventListener("click", performLookupSearch);
document.getElementById("lookupSearchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") performLookupSearch();
});

loadOverview();
