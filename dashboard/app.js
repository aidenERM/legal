const WORKER_URL = "https://chp-dashboard-api.aidenspearb.workers.dev";

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
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

  document.getElementById("overviewSkeleton").hidden = true;
  const cards = document.getElementById("overviewCards");
  cards.hidden = false;
  cards.innerHTML = `
    <div class="stat-card"><div class="label">Signed in as</div><div class="value">${me.username}</div></div>
    <div class="stat-card"><div class="label">Access tier</div><div class="value">${me.tier}</div></div>
    <div class="stat-card"><div class="label">Total duty time</div><div class="value">${formatDuration(shifts.totalSeconds)}</div></div>
    <div class="stat-card"><div class="label">Shifts logged</div><div class="value">${shifts.shiftCount}</div></div>
  `;
}

async function loadShifts() {
  const shifts = await apiGet("/api/shifts");
  if (!shifts) return;

  document.getElementById("shiftsSkeleton").hidden = true;
  const cards = document.getElementById("shiftsCards");
  cards.hidden = false;

  if (shifts.byType.length === 0) {
    cards.innerHTML = `<div class="empty-state">No completed shifts logged yet.</div>`;
    return;
  }

  cards.innerHTML = shifts.byType
    .map((row) => `
      <div class="stat-card"><div class="label">${row.type}</div><div class="value">${formatDuration(row.seconds)}</div></div>
    `)
    .join("");
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
      const avatarUrl = entry.avatar
        ? `https://cdn.discordapp.com/avatars/${entry.userId}/${entry.avatar}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/0.png`;
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
