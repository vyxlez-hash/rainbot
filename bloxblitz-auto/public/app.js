async function api(url, options) {
  const r = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

async function refresh() {
  const state = await api("/api/state");
  const accounts = state.accounts || [];
  const watching = accounts.filter(a => a.status?.running).length;

  document.querySelector("#count").textContent = accounts.length;
  document.querySelector("#watching").textContent = watching;
  document.querySelector("#auto").textContent = state.settings.autoJoin ? "ON" : "OFF";
  document.querySelector("#system").textContent = "● SYSTEM ONLINE";

  document.querySelector("#autoToggle").checked = !!state.settings.autoJoin;
  document.querySelector("#webhookToggle").checked = !!state.settings.webhookEnabled;

  const box = document.querySelector("#accounts");

  if (!accounts.length) {
    box.innerHTML = `<div class="empty">No accounts connected yet.</div>`;
  } else {
    box.innerHTML = accounts.map(a => `
      <div class="account">
        <div>
          <div class="name">${esc(a.name)}</div>
          <div class="meta">${a.status?.running ? "Watching BloxBlitz" : "Not running"}</div>
        </div>
        <div class="status">
          <span class="dot ${a.status?.running ? "on" : ""}"></span>
          <button data-toggle="${esc(a.id)}">${a.enabled ? "Disable" : "Enable"}</button>
          <button class="secondary" data-delete="${esc(a.id)}">Delete</button>
        </div>
      </div>
    `).join("");
  }

  document.querySelector("#activity").innerHTML =
    state.activity.length
      ? state.activity.map(x =>
          `<div class="activity"><small>${new Date(x.time).toLocaleTimeString()}</small>${esc(
            x.account ? `${x.account}: ` : ""
          )}${esc(x.type.replaceAll("_", " "))}${x.error ? ` — ${esc(x.error)}` : ""}</div>`
        ).join("")
      : `<div class="empty">No activity yet.</div>`;

  document.querySelectorAll("[data-toggle]").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.toggle;
      const account = accounts.find(x => x.id === id);
      await api(`/api/accounts/${id}/toggle`, {
        method: "POST",
        body: JSON.stringify({ enabled: !account.enabled })
      });
      refresh();
    };
  });

  document.querySelectorAll("[data-delete]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("Delete this account?")) return;
      await api(`/api/accounts/${btn.dataset.delete}`, { method: "DELETE" });
      refresh();
    };
  });
}

document.querySelector("#add").onclick = async () => {
  const name = prompt("BloxBlitz account name:");
  if (!name) return;

  const account = await api("/api/accounts", {
    method: "POST",
    body: JSON.stringify({ name })
  });

  /*
    This opens a visible browser on the server so the account owner can
    complete BloxBlitz's normal phrase-to-bio login flow.
  */
  try {
    await api(`/api/accounts/${account.id}/connect`, { method: "POST" });
    alert("BloxBlitz login browser opened. Complete the normal login/phrase-to-bio flow there, then leave the browser session running.");
  } catch (e) {
    alert(e.message);
  }

  refresh();
};

document.querySelector("#autoToggle").onchange = async e => {
  await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({ autoJoin: e.target.checked })
  });
  refresh();
};

document.querySelector("#webhookToggle").onchange = async e => {
  await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({ webhookEnabled: e.target.checked })
  });
  refresh();
};

document.querySelector("#testWebhook").onclick = async () => {
  try {
    await api("/api/webhook/test", { method: "POST" });
    alert("Webhook sent.");
  } catch (e) {
    alert(e.message);
  }
};

refresh();
setInterval(refresh, 3000);
