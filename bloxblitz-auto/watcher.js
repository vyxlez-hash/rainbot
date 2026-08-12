const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const ROOT = __dirname;
const PROFILES_DIR = path.join(ROOT, "profiles");
const DATA_DIR = path.join(ROOT, "data");

const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const ACTIVITY_FILE = path.join(DATA_DIR, "activity.json");

const BLOXBLITZ_URL =
  process.env.BLOXBLITZ_URL || "https://bloxblitz.com";

const CHECK_INTERVAL =
  Number(process.env.CHECK_INTERVAL_MS || 750);

const RECONNECT_DELAY = 5000;

// One worker per connected account.
const workers = new Map();

function ensureFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PROFILES_DIR, { recursive: true });

  if (!fs.existsSync(ACCOUNTS_FILE)) {
    fs.writeFileSync(ACCOUNTS_FILE, "[]");
  }

  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify(
        {
          autoJoin: true,
          webhookEnabled: false
        },
        null,
        2
      )
    );
  }

  if (!fs.existsSync(ACTIVITY_FILE)) {
    fs.writeFileSync(ACTIVITY_FILE, "[]");
  }
}

ensureFiles();

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(
    file,
    JSON.stringify(value, null, 2)
  );
}

function addActivity(data) {
  const activity = readJson(ACTIVITY_FILE, []);

  activity.unshift({
    id:
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 7),

    time: new Date().toISOString(),

    ...data
  });

  writeJson(
    ACTIVITY_FILE,
    activity.slice(0, 500)
  );
}

async function sendWebhook(message) {
  const settings = readJson(
    SETTINGS_FILE,
    {}
  );

  const webhook =
    process.env.DISCORD_WEBHOOK_URL;

  if (!settings.webhookEnabled) {
    return;
  }

  if (!webhook) {
    return;
  }

  try {
    const response = await fetch(webhook, {
      method: "POST",

      headers: {
        "content-type": "application/json"
      },

      body: JSON.stringify({
        content: message
      })
    });

    if (!response.ok) {
      throw new Error(
        `Discord HTTP ${response.status}`
      );
    }
  } catch (error) {
    console.error(
      "[WEBHOOK ERROR]",
      error.message
    );
  }
}

/*
 * Finds the green BloxBlitz Join button.
 *
 * The important part here is that we're looking for the actual
 * accessible button named "Join", rather than using screen
 * coordinates.
 */
async function findJoinButton(page) {
  try {
    const buttons = page.getByRole(
      "button",
      {
        name: /^Join$/i
      }
    );

    const count = await buttons.count();

    if (!count) {
      return null;
    }

    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);

      try {
        if (
          await button.isVisible({
            timeout: 250
          })
        ) {
          return button;
        }
      } catch {
        // Element disappeared while checking it.
      }
    }
  } catch {
    // DOM changed while searching.
  }

  return null;
}

/*
 * Attempts to determine whether the Join button is still usable.
 */
async function isJoinButtonUsable(button) {
  try {
    if (!(await button.isVisible())) {
      return false;
    }

    if (await button.isDisabled()) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/*
 * Wait briefly after clicking and try to determine whether
 * the button disappeared/changed.
 *
 * We don't assume a particular success message because the
 * exact BloxBlitz DOM has not been inspected.
 */
async function verifyJoin(page) {
  try {
    await page.waitForTimeout(800);

    const button = await findJoinButton(page);

    if (!button) {
      return true;
    }

    return !(await button.isVisible().catch(() => false));
  } catch {
    return false;
  }
}

/*
 * Main watcher for one account.
 */
async function watchAccount(account, page, worker) {
  console.log(
    `[${account.name}] watcher started`
  );

  let lastClickTime = 0;

  while (worker.running) {
    try {
      const settings = readJson(
        SETTINGS_FILE,
        {}
      );

      /*
       * Global auto-join switch.
       */
      if (!settings.autoJoin) {
        await page.waitForTimeout(1500);
        continue;
      }

      /*
       * Find the actual visible Join button.
       */
      const joinButton =
        await findJoinButton(page);

      if (!joinButton) {
        await page.waitForTimeout(
          CHECK_INTERVAL
        );

        continue;
      }

      /*
       * Make sure it is actually clickable.
       */
      if (
        !(await isJoinButtonUsable(
          joinButton
        ))
      ) {
        await page.waitForTimeout(
          CHECK_INTERVAL
        );

        continue;
      }

      /*
       * Prevent multiple clicks on the same
       * visible giveaway.
       */
      const now = Date.now();

      if (
        now - lastClickTime <
        5000
      ) {
        await page.waitForTimeout(
          CHECK_INTERVAL
        );

        continue;
      }

      /*
       * Capture some information before clicking.
       */
      let pageText = "";

      try {
        pageText = await page.locator("body").innerText({
          timeout: 1000
        });
      } catch {}

      const rainDetected =
        /RAIN/i.test(pageText);

      /*
       * If there is no RAIN text anywhere on the page,
       * don't blindly click a Join control.
       *
       * This protects against unrelated Join buttons.
       */
      if (!rainDetected) {
        await page.waitForTimeout(
          CHECK_INTERVAL
        );

        continue;
      }

      /*
       * Lock this worker before clicking.
       */
      lastClickTime = now;

      console.log(
        `[${account.name}] RAIN + Join detected`
      );

      addActivity({
        type: "join_detected",

        accountId: account.id,

        account: account.name
      });

      /*
       * Click Join.
       */
      try {
        await joinButton.click({
          timeout: 3000
        });

        console.log(
          `[${account.name}] Join clicked`
        );

        addActivity({
          type: "join_clicked",

          accountId: account.id,

          account: account.name
        });

        /*
         * Give BloxBlitz a moment to update the UI.
         */
        const verified =
          await verifyJoin(page);

        if (verified) {
          console.log(
            `[${account.name}] Join appears successful`
          );

          addActivity({
            type: "join_success",

            accountId: account.id,

            account: account.name
          });

          await sendWebhook(
            [
              "🌧️ **RAIN JOINED**",
              "",
              `Account: \`${account.name}\``,
              "Status: ✅ Joined"
            ].join("\n")
          );
        } else {
          console.log(
            `[${account.name}] Join clicked`
          );

          addActivity({
            type: "join_clicked_unverified",

            accountId: account.id,

            account: account.name
          });

          await sendWebhook(
            [
              "🌧️ **RAIN JOIN CLICKED**",
              "",
              `Account: \`${account.name}\``,
              "Status: ⚠️ Clicked; result not confirmed"
            ].join("\n")
          );
        }
      } catch (error) {
        console.error(
          `[${account.name}] Join error:`,
          error.message
        );

        addActivity({
          type: "join_error",

          accountId: account.id,

          account: account.name,

          error: error.message
        });

        await sendWebhook(
          [
            "❌ **RAIN JOIN FAILED**",
            "",
            `Account: \`${account.name}\``,
            `Error: ${error.message}`
          ].join("\n")
        );
      }

      /*
       * Don't immediately scan/click the same giveaway again.
       */
      await page.waitForTimeout(1500);
    } catch (error) {
      console.error(
        `[${account.name}] watcher error:`,
        error.message
      );

      addActivity({
        type: "watch_error",

        accountId: account.id,

        account: account.name,

        error: error.message
      });

      /*
       * Check whether the page/browser is still alive.
       */
      try {
        if (page.isClosed()) {
          throw new Error(
            "BloxBlitz page closed"
          );
        }

        await page.waitForTimeout(2000);
      } catch {
        throw error;
      }
    }
  }

  console.log(
    `[${account.name}] watcher stopped`
  );
}

/*
 * Creates/reuses the persistent BloxBlitz browser session.
 */
async function launchAccount(account, interactive = false) {
  const profileDir = path.join(
    PROFILES_DIR,
    account.id
  );

  fs.mkdirSync(
    profileDir,
    {
      recursive: true
    }
  );

  const headless =
    interactive
      ? false
      : String(
          process.env.HEADLESS || "true"
        ).toLowerCase() !== "false";

  console.log(
    `[${account.name}] launching browser`
  );

  const context =
    await chromium.launchPersistentContext(
      profileDir,
      {
        headless,

        viewport: {
          width: 1440,
          height: 900
        },

        args: [
          "--disable-dev-shm-usage"
        ]
      }
    );

  let page =
    context.pages()[0];

  if (!page) {
    page =
      await context.newPage();
  }

  /*
   * Keep the worker alive if BloxBlitz opens a new tab.
   */
  context.on(
    "page",
    newPage => {
      console.log(
        `[${account.name}] new page opened`
      );
    }
  );

  /*
   * Navigate to BloxBlitz.
   */
  if (
    !page.url().startsWith(
      BLOXBLITZ_URL
    )
  ) {
    await page.goto(
      BLOXBLITZ_URL,
      {
        waitUntil:
          "domcontentloaded",

        timeout: 60000
      }
    );
  }

  /*
   * Let the page settle.
   */
  await page.waitForTimeout(3000);

  return {
    context,
    page
  };
}

/*
 * Starts a worker.
 */
async function startWatcher(
  account,
  options = {}
) {
  const existing =
    workers.get(account.id);

  if (
    existing &&
    existing.running
  ) {
    return {
      ok: true,
      message:
        "Watcher already running."
    };
  }

  const worker = {
    running: true,

    context: null,

    page: null,

    startedAt: Date.now()
  };

  workers.set(
    account.id,
    worker
  );

  /*
   * Run independently so the API doesn't
   * have to wait for the watcher.
   */
  runWorker(
    account,
    worker,
    options
  ).catch(error => {
    console.error(
      `[${account.name}] worker stopped:`,
      error.message
    );
  });

  return {
    ok: true,

    message:
      "BloxBlitz watcher started."
  };
}

/*
 * Full worker lifecycle including automatic reconnect.
 */
async function runWorker(
  account,
  worker,
  options
) {
  while (worker.running) {
    try {
      const browser =
        await launchAccount(
          account,
          !!options.interactive
        );

      worker.context =
        browser.context;

      worker.page =
        browser.page;

      addActivity({
        type: "worker_started",

        accountId: account.id,

        account: account.name
      });

      /*
       * Once the interactive login has been opened,
       * don't repeatedly launch visible browsers.
       */
      options.interactive = false;

      await watchAccount(
        account,
        worker.page,
        worker
      );

      /*
       * Normal stop.
       */
      if (!worker.running) {
        break;
      }
    } catch (error) {
      console.error(
        `[${account.name}] connection error:`,
        error.message
      );

      addActivity({
        type: "connection_error",

        accountId: account.id,

        account: account.name,

        error: error.message
      });

      await sendWebhook(
        [
          "⚠️ **BLOXBLITZ CONNECTION ERROR**",
          "",
          `Account: \`${account.name}\``,
          `Error: ${error.message}`,
          "",
          `Reconnecting in ${RECONNECT_DELAY / 1000}s...`
        ].join("\n")
      );
    }

    /*
     * Close the current browser before reconnecting.
     */
    try {
      if (worker.context) {
        await worker.context.close();
      }
    } catch {}

    worker.context = null;
    worker.page = null;

    if (worker.running) {
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            RECONNECT_DELAY
          )
      );
    }
  }

  try {
    if (worker.context) {
      await worker.context.close();
    }
  } catch {}

  worker.context = null;
  worker.page = null;
}

/*
 * Stops one account.
 */
async function stopWatcher(
  accountId
) {
  const worker =
    workers.get(accountId);

  if (!worker) {
    return;
  }

  console.log(
    `Stopping worker ${accountId}`
  );

  worker.running = false;

  try {
    if (worker.context) {
      await worker.context.close();
    }
  } catch {}

  worker.context = null;
  worker.page = null;

  workers.delete(accountId);
}

/*
 * Returns dashboard status.
 */
function getWatcherStatus(
  accountId
) {
  const worker =
    workers.get(accountId);

  if (
    !worker ||
    !worker.running
  ) {
    return {
      running: false
    };
  }

  return {
    running: true,

    startedAt:
      worker.startedAt,

    uptime:
      Date.now() -
      worker.startedAt
  };
}

/*
 * Start all accounts that were already connected.
 */
async function boot() {
  const accounts =
    readJson(
      ACCOUNTS_FILE,
      []
    );

  console.log(
    `Found ${accounts.length} saved account(s).`
  );

  for (const account of accounts) {
    if (
      account.enabled !== false &&
      account.connected === true
    ) {
      startWatcher(account).catch(
        error => {
          console.error(
            `[${account.name}] startup error:`,
            error.message
          );
        }
      );
    }
  }
}

module.exports = {
  startWatcher,
  stopWatcher,
  getWatcherStatus
};

boot().catch(
  console.error
);
