const express = require("express");
const path = require("path");
const fs = require("fs");
const { startWatcher, stopWatcher, getWatcherStatus } = require("./watcher");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const DATA = path.join(__dirname, "data");
const ACCOUNTS = path.join(DATA, "accounts.json");
const SETTINGS = path.join(DATA, "settings.json");
const ACTIVITY = path.join(DATA, "activity.json");

function ensureFiles() {
  fs.mkdirSync(DATA, { recursive: true });
  if (!fs.existsSync(ACCOUNTS)) fs.writeFileSync(ACCOUNTS, "[]");
  if (!fs.existsSync(SETTINGS)) fs.writeFileSync(SETTINGS, JSON.stringify({ autoJoin: true, webhookEnabled: false }, null, 2));
  if (!fs.existsSync(ACTIVITY)) fs.writeFileSync(ACTIVITY, "[]");
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function addActivity(item) {
  const list = readJson(ACTIVITY, []);
  list.unshift({ id: Date.now().toString(36), time: new Date().toISOString(), ...item });
  writeJson(ACTIVITY, list.slice(0, 500));
}

ensureFiles();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/state", (_req, res) => {
  const accounts = readJson(ACCOUNTS, []);
  const settings = readJson(SETTINGS, {});
  res.json({
    accounts: accounts.map(a => ({
      id: a.id,
      name: a.name,
      enabled: a.enabled !== false,
      connected: !!a.connected,
      status: getWatcherStatus(a.id)
    })),
    settings,
    activity: readJson(ACTIVITY, []).slice(0, 100)
  });
});

/*
  Adds an account shell. The actual BloxBlitz login is deliberately completed
  by the account owner in that account's isolated browser profile.
*/
app.post("/api/accounts", async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Account name is required." });

  const accounts = readJson(ACCOUNTS, []);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const account = {
    id,
    name,
    enabled: true,
    connected: false,
    createdAt: new Date().toISOString()
  };

  accounts.push(account);
  writeJson(ACCOUNTS, accounts);

  addActivity({ type: "account_created", accountId: id, account: name });
  res.json(account);
});

app.post("/api/accounts/:id/connect", async (req, res) => {
  const accounts = readJson(ACCOUNTS, []);
  const account = accounts.find(a => a.id === req.params.id);
  if (!account) return res.status(404).json({ error: "Account not found." });

  try {
    const result = await startWatcher(account, { interactive: true });
    account.connected = true;
    writeJson(ACCOUNTS, accounts);
    addActivity({ type: "account_connected", accountId: account.id, account: account.name });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/accounts/:id/toggle", (req, res) => {
  const accounts = readJson(ACCOUNTS, []);
  const account = accounts.find(a => a.id === req.params.id);
  if (!account) return res.status(404).json({ error: "Account not found." });

  account.enabled = req.body.enabled !== false;
  writeJson(ACCOUNTS, accounts);

  if (account.enabled) startWatcher(account).catch(() => {});
  else stopWatcher(account.id);

  addActivity({
    type: account.enabled ? "account_enabled" : "account_disabled",
    accountId: account.id,
    account: account.name
  });

  res.json({ ok: true });
});

app.delete("/api/accounts/:id", (req, res) => {
  const accounts = readJson(ACCOUNTS, []);
  const account = accounts.find(a => a.id === req.params.id);
  if (!account) return res.status(404).json({ error: "Account not found." });

  stopWatcher(account.id);
  writeJson(ACCOUNTS, accounts.filter(a => a.id !== req.params.id));
  addActivity({ type: "account_deleted", accountId: account.id, account: account.name });
  res.json({ ok: true });
});

app.post("/api/settings", (req, res) => {
  const settings = readJson(SETTINGS, {});
  if (typeof req.body.autoJoin === "boolean") settings.autoJoin = req.body.autoJoin;
  if (typeof req.body.webhookEnabled === "boolean") settings.webhookEnabled = req.body.webhookEnabled;
  writeJson(SETTINGS, settings);
  res.json(settings);
});

app.post("/api/webhook/test", async (_req, res) => {
  try {
    const settings = readJson(SETTINGS, {});
    if (!settings.webhookEnabled || !process.env.DISCORD_WEBHOOK_URL) {
      return res.status(400).json({ error: "Webhook is not enabled/configured." });
    }

    const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "✅ BloxBlitz Auto Joiner webhook test."
      })
    });

    if (!response.ok) throw new Error(`Discord returned HTTP ${response.status}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
});
