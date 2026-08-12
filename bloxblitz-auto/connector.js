require("dotenv").config();

const path = require("path");
const fs = require("fs");
const readline = require("readline");
const { chromium } = require("playwright");

const DASHBOARD_URL =
  (process.env.DASHBOARD_URL || "").replace(
    /\/$/,
    ""
  );

const AGENT_KEY =
  process.env.AGENT_KEY || "";

const BLOXBLITZ_URL =
  process.env.BLOXBLITZ_URL ||
  "https://bloxblitz.com";

const CHECK_INTERVAL_MS =
  Number(
    process.env.CHECK_INTERVAL_MS ||
      750
  );

const PROFILE_DIR =
  path.join(
    __dirname,
    "agent-profiles"
  );

if (!DASHBOARD_URL) {
  console.error(
    "DASHBOARD_URL is missing."
  );

  process.exit(1);
}

if (!AGENT_KEY) {
  console.error(
    "AGENT_KEY is missing."
  );

  process.exit(1);
}

fs.mkdirSync(
  PROFILE_DIR,
  {
    recursive: true
  }
);

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

async function api(
  endpoint,
  options = {}
) {
  const response =
    await fetch(
      `${DASHBOARD_URL}${endpoint}`,
      {
        ...options,

        headers: {
          "content-type":
            "application/json",

          "x-agent-key":
            AGENT_KEY,

          ...(options.headers || {})
        }
      }
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error ||
        `HTTP ${response.status}`
    );
  }

  return data;
}

async function createAccount(
  name
) {
  const response =
    await fetch(
      `${DASHBOARD_URL}/api/accounts`,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify({
            name
          })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ||
        "Unable to create account."
    );
  }

  return data;
}

function ask(
  question
) {
  const rl =
    readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

  return new Promise(
    resolve => {
      rl.question(
        question,
        answer => {
          rl.close();
          resolve(answer);
        }
      );
    }
  );
}

async function findJoinButton(
  page
) {
  try {
    const buttons =
      page.getByRole(
        "button",
        {
          name: /^Join$/i
        }
      );

    const count =
      await buttons.count();

    for (
      let i = 0;
      i < count;
      i++
    ) {
      const button =
        buttons.nth(i);

      const visible =
        await button
          .isVisible()
          .catch(
            () => false
          );

      if (!visible) {
        continue;
      }

      const disabled =
        await button
          .isDisabled()
          .catch(
            () => true
          );

      if (!disabled) {
        return button;
      }
    }
  } catch {}

  return null;
}

async function hasRain(
  page
) {
  try {
    const text =
      await page
        .locator("body")
        .innerText({
          timeout: 1000
        });

    return /\bRAIN\b/i.test(
      text
    );
  } catch {
    return false;
  }
}

async function connect() {
  const name =
    process.argv
      .slice(2)
      .join(" ")
      .trim();

  if (!name) {
    console.log("");
    console.log(
      'Usage: node connector.js "Account Name"'
    );
    console.log("");

    process.exit(1);
  }

  console.log("");
  console.log(
    "Creating dashboard account..."
  );

  const account =
    await createAccount(name);

  console.log("");
  console.log(
    "Account created:"
  );

  console.log(
    `Name: ${account.name}`
  );

  console.log(
    `ID: ${account.id}`
  );

  const profile =
    path.join(
      PROFILE_DIR,
      account.id
    );

  fs.mkdirSync(
    profile,
    {
      recursive: true
    }
  );

  console.log("");
  console.log(
    "Opening BloxBlitz..."
  );

  const context =
    await chromium
      .launchPersistentContext(
        profile,
        {
          headless: false,

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

  await page.goto(
    BLOXBLITZ_URL,
    {
      waitUntil:
        "domcontentloaded",

      timeout: 60000
    }
  );

  console.log("");
  console.log(
    "============================================"
  );
  console.log(
    " BloxBlitz Login"
  );
  console.log(
    "============================================"
  );
  console.log("");
  console.log(
    "Complete the normal BloxBlitz login:"
  );
  console.log("");
  console.log(
    "1. Click Login."
  );
  console.log(
    "2. Enter the Roblox username."
  );
  console.log(
    "3. Click Continue."
  );
  console.log(
    "4. Copy the phrase."
  );
  console.log(
    "5. Put the phrase in that Roblox profile's bio."
  );
  console.log(
    "6. Return to BloxBlitz."
  );
  console.log(
    "7. Click Continue."
  );
  console.log("");
  console.log(
    "BloxBlitz will verify ownership."
  );
  console.log("");

  await ask(
    "When BloxBlitz shows that verification is complete, press ENTER here to continue..."
  );

  await api(
    `/api/agent/accounts/${account.id}/connected`,
    {
      method: "POST",

      body:
        JSON.stringify({
          username: name
        })
    }
  );

  await api(
    `/api/agent/accounts/${account.id}/status`,
    {
      method: "POST",

      body:
        JSON.stringify({
          online: true
        })
    }
  );

  console.log("");
  console.log(
    "✅ Account marked connected."
  );

  console.log("");
  console.log(
    "============================================"
  );
  console.log(
    " 24/7 RAIN WATCHER"
  );
  console.log(
    "============================================"
  );
  console.log("");

  let lastClick =
    0;

  while (true) {
    try {
      const state =
        await api(
          "/api/state",
          {
            method: "GET",
            headers: {
              "x-agent-key":
                AGENT_KEY
            }
          }
        );

      const current =
        state.accounts.find(
          a =>
            a.id ===
            account.id
        );

      if (
        current &&
        current.enabled === false
      ) {
        await sleep(1500);
        continue;
      }

      if (
        !state.settings.autoJoin
      ) {
        await sleep(1500);
        continue;
      }

      /*
       * BloxBlitz chat contains RAIN.
       */
      if (
        !(await hasRain(page))
      ) {
        await sleep(
          CHECK_INTERVAL_MS
        );

        continue;
      }

      /*
       * Look for the visible green Join button.
       */
      const join =
        await findJoinButton(
          page
        );

      if (!join) {
        await sleep(
          CHECK_INTERVAL_MS
        );

        continue;
      }

      /*
       * Prevent duplicate clicks.
       */
      if (
        Date.now() -
          lastClick <
        5000
      ) {
        await sleep(
          CHECK_INTERVAL_MS
        );

        continue;
      }

      lastClick =
        Date.now();

      console.log(
        `[${name}] 🌧️ RAIN Join detected`
      );

      await api(
        "/api/agent/activity",
        {
          method: "POST",

          body:
            JSON.stringify({
              type:
                "join_detected",

              accountId:
                account.id,

              account:
                name
            })
        }
      );

      try {
        await join.click({
          timeout: 3000
        });

        console.log(
          `[${name}] ✅ Join clicked`
        );

        await api(
          "/api/agent/activity",
          {
            method: "POST",

            body:
              JSON.stringify({
                type:
                  "join_clicked",

                accountId:
                  account.id,

                account:
                  name
              })
          }
        );
      } catch (error) {
        console.error(
          `[${name}] Join error:`,
          error.message
        );

        await api(
          "/api/agent/activity",
          {
            method: "POST",

            body:
              JSON.stringify({
                type:
                  "agent_error",

                accountId:
                  account.id,

                account:
                  name,

                error:
                  error.message
              })
          }
        );
      }

      await sleep(1500);
    } catch (error) {
      console.error(
        `[${name}] Watcher error:`,
        error.message
      );

      await api(
        "/api/agent/activity",
        {
          method: "POST",

          body:
            JSON.stringify({
              type:
                "agent_error",

              accountId:
                account.id,

              account:
                name,

              error:
                error.message
            })
        }
      ).catch(
        () => {}
      );

      await sleep(3000);
    }
  }
}

connect().catch(
  error => {
    console.error("");
    console.error(
      "Connector stopped:"
    );
    console.error(
      error.message
    );

    process.exit(1);
  }
);
