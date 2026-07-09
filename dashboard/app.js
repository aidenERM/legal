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
  document.getElementById("welcomeHero").hidden = false;

  document.getElementById("overviewSkeleton").hidden = true;
  const cards = document.getElementById("overviewCards");
  cards.hidden = false;
  cards.innerHTML = `
    <div class="stat-card"><div class="label">Access tier</div><div class="value">${me.tier}</div></div>
    <div class="stat-card"><div class="label">Total duty time</div><div class="value">${formatDuration(shifts.totalSeconds)}</div></div>
    <div class="stat-card"><div class="label">Shifts logged</div><div class="value">${shifts.shiftCount}</div></div>
  `;
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
  });
});

document.getElementById("sidebarToggle").addEventListener("click", () => {
  document.getElementById("shell").classList.toggle("collapsed");
});

loadOverview();
