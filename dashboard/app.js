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

const TIER_BADGE_COPY = {
  staff: "CHP Patrol Operations",
  admin: "CHP Human Resources & Command",
  management: "Board of Commissioners",
  developer: "Developer Access",
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

let currentMe = null;

// Fetched once at boot so both the sidebar (admin/management/developer group)
// and the Profile panel can use it without re-fetching /api/me repeatedly.
async function bootMe() {
  const me = await apiGet("/api/me");
  if (!me) return null;
  currentMe = me;

  if (me.tier === "admin" || me.tier === "management" || me.tier === "developer") {
    const categoryLabel =
      me.tier === "developer" ? "Developer" : me.tier === "management" ? "Board of Commissioners" : "High Ranks";
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

let currentLeaderboardPeriod = "weekly";
let customRangeValues = null; // { start, end } unix seconds, set once "Apply" is clicked

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
          <span class="leaderboard-time">${liveBadge}${formatDuration(entry.totalSeconds)}</span>
        </li>
      `;
    })
    .join("");
}

function leaderboardQueryFor(period) {
  if (period !== "custom") return `/api/leaderboard?period=${period}`;
  if (!customRangeValues) return null;
  return `/api/leaderboard?period=custom&start=${customRangeValues.start}&end=${customRangeValues.end}`;
}

async function loadLeaderboard(period) {
  if (period) currentLeaderboardPeriod = period;
  const path = leaderboardQueryFor(currentLeaderboardPeriod);
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
  list.innerHTML = renderLeaderboardRows((leaderboard.entries || []).slice(0, 5), "weekly");
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
  return ftos
    .map((fto) => {
      const userId = fto.user || fto.user_id || "unknown";
      return `
        <div class="ra-fto-chip">
          <img src="${avatarUrlFor(userId, null, 32)}" alt="">
          <span>${userId}</span>
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

  const entries = Object.entries(res).filter(([key]) => key !== "ok");
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

document.querySelectorAll(".nav-item[data-section]").forEach((item) => {
  item.addEventListener("click", () => {
    const section = item.dataset.section;
    showPanel(section);
    if (section === "shift-management") loadShiftManagement();
    if (section === "loa") loadLoa();
    if (section === "ra") loadRa();
    if (section === "history") loadHistory();
    if (section === "profile") loadProfile();
    if (section === "settings") loadSettings();
    if (section === "leaderboard") loadLeaderboard();
  });
});

document.getElementById("sidebarToggle").addEventListener("click", () => {
  document.getElementById("shell").classList.toggle("collapsed");
});

document.getElementById("lookupSearchBtn").addEventListener("click", performLookupSearch);
document.getElementById("lookupSearchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") performLookupSearch();
});

bootMe().then(() => loadShiftManagement());
