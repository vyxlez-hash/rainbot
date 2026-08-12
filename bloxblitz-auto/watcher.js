const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const ROOT = __dirname;
const PROFILES = path.join(ROOT, "profiles");
const SETTINGS = path.join(ROOT, "data", "settings.json");
const ACTIVITY = path.join(ROOT, "data", "activity.json");

const workers = new Map();

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function activity(item) {
  const list = readJson(ACTIVITY, []);
  list.unshift({ id: Date.now().toString(36), time: new Date().toISOString(), ...item });
  fs.writeFileSync(ACTIVITY, JSON.stringify(list.slice(0, 500), null, 2));
}

async function sendWebhook(payload) {
  const settings = readJson(SETTINGS, {});
  const url = process.env.DISCORD_WEBHOOK_URL;

  if (!settings.webhookEnabled || !url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: payload })
    });
  } catch (e) {
    console.error("Webhook error:", e.message);
  }
}

/*
  IMPORTANT:
  The selectors below are intentionally isolated. We have not been given
  BloxBlitz's actual DOM, so do not pretend these selectors are guaranteed.
  Replace findRainJoinButton() after inspecting the live Join element.
*/
async function findRainJoinButton(page) {
  // Generic accessibility attempt. This may work if BloxBlitz exposes
  // the button as an accessible button named "Join".
  const candidates = page.getByRole("button", { name: /^join$/i });

  if (await candidates.count()) {
    for (let i = 0; i < await candidates.count(); i++) {
      const button = candidates.nth(i);
      if (await button.isVisible().catch(() => false)) return button;
    }
  }

  return null;
}

async function watch(account, page) {
  const interval = Number(process.env.CHECK_INTERVAL_MS || 750);
  let lastJoinAt = 0;

  while (workers.get(account.id)?.running) {
    try {
      const settings = readJson(SETTINGS, {});
      if (!settings.autoJoin) {
        await page.waitForTimeout(1500);
        continue;
      }

      const joinButton = await findRainJoinButton(page);

      if (joinButton) {
        const now = Date.now();

        // Prevent repeated clicks on the same visible control.
        if (now - lastJoinAt > 5000) {
          lastJoinAt = now;

          activity({
            type: "join_detected",
            accountId: account.id,
            account: account.name
          });

          try {
            await joinButton.click({ timeout: 3000 });

            activity({
              type: "join_clicked",
              accountId: account.id,
              account: account.name
            });

            await sendWebhook(
              `🌧️ **RAIN Join clicked**\nAccount: \`${account.name}\``
            );
          } catch (err) {
            activity({
              type: "join_error",
              accountId: account.id,
              account: account.name,
              error: err.message
            });

            await sendWebhook(
              `❌ **RAIN join failed**\nAccount: \`${account.name}\`\nError: ${err.message}`
            );
          }
        }
      }

      await page.waitForTimeout(interval);
    } catch (err) {
      activity({
        type: "watch_error",
        accountId: account.id,
        account: account.name,
        error: err.message
      });

      await page.waitForTimeout(2000);
    }
  }
}

async function startWatcher(account, options = {}) {
  if (workers.has(account.id)?.running) {
    return { ok: true, message: "Already running." };
  }

  fs.mkdirSync(PROFILES, { recursive: true });
  const profileDir = path.join(PROFILES, account.id);

  /*
    Persistent browser context means BloxBlitz's own login/session can survive
    process restarts. The first connection is interactive so the account owner
    can complete BloxBlitz's normal login/phrase-to-bio process.
  */
  const headless = options.interactive ? false : String(process.env.HEADLESS || "true") !== "false";

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1440, height: 900 }
  });

  const pages = context.pages();
  const page = pages[0] || await context.newPage();

  await page.goto(process.env.BLOXBLITZ_URL || "https://bloxblitz.com", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  if (options.interactive) {
    console.log(`[${account.name}] Complete BloxBlitz's normal login flow in the opened browser.`);
    console.log(`[${account.name}] After login is complete, return to the dashboard.`);
  }

  const worker = {
    running: true,
    context,
    page,
    startedAt: Date.now()
  };

  workers.set(account.id, worker);

  watch(account, page).catch(err => {
    activity({
      type: "worker_crashed",
      accountId: account.id,
      account: account.name,
      error: err.message
    });
  });

  return { ok: true, message: "Browser worker started." };
}

async function stopWatcher(id) {
  const worker = workers.get(id);
  if (!worker) return;

  worker.running = false;
  workers.delete(id);

  try { await worker.context.close(); }
  catch {}
}

function getWatcherStatus(id) {
  const worker = workers.get(id);
  if (!worker) return { running: false };

  return {
    running: worker.running,
    startedAt: worker.startedAt
  };
}

async function boot() {
  const accountsFile = path.join(ROOT, "data", "accounts.json");
  const accounts = readJson(accountsFile, []);

  for (const account of accounts) {
    if (account.enabled !== false && account.connected) {
      startWatcher(account).catch(err => {
        activity({
          type: "worker_start_error",
          accountId: account.id,
          account: account.name,
          error: err.message
        });
      });
    }
  }
}

module.exports = {
  startWatcher,
  stopWatcher,
  getWatcherStatus
};

boot().catch(console.error);
