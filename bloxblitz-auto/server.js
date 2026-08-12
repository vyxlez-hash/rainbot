require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const AGENT_KEY = process.env.AGENT_KEY || "";

const ROOT = __dirname;
const DATA = path.join(ROOT, "data");

const ACCOUNTS = path.join(DATA, "accounts.json");
const SETTINGS = path.join(DATA, "settings.json");
const ACTIVITY = path.join(DATA, "activity.json");

function ensureFiles() {
  fs.mkdirSync(DATA, { recursive: true });

  if (!fs.existsSync(ACCOUNTS)) {
    fs.writeFileSync(ACCOUNTS, "[]");
  }

  if (!fs.existsSync(SETTINGS)) {
    fs.writeFileSync(
      SETTINGS,
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

  if (!fs.existsSync(ACTIVITY)) {
    fs.writeFileSync(ACTIVITY, "[]");
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
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

function addActivity(item) {
  const activity = readJson(
    ACTIVITY,
    []
  );

  activity.unshift({
    id:
      Date.now().toString(36) +
      Math.random()
        .toString(36)
        .slice(2, 8),

    time: new Date().toISOString(),

    ...item
  });

  writeJson(
    ACTIVITY,
    activity.slice(0, 500)
  );
}

function requireAgent(req, res, next) {
  if (!AGENT_KEY) {
    return res.status(503).json({
      error: "AGENT_KEY is not configured on the server."
    });
  }

  const supplied =
    req.headers["x-agent-key"];

  if (
    !supplied ||
    supplied !== AGENT_KEY
  ) {
    return res.status(401).json({
      error: "Invalid agent key."
    });
  }

  next();
}

async function sendWebhook(message) {
  const settings = readJson(
    SETTINGS,
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
    const response = await fetch(
      webhook,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body: JSON.stringify({
          content: message
        })
      }
    );

    if (!response.ok) {
      throw new Error(
        `Discord HTTP ${response.status}`
      );
    }
  } catch (error) {
    console.error(
      "[WEBHOOK]",
      error.message
    );
  }
}

ensureFiles();

app.use(express.json());
app.use(
  express.static(
    path.join(ROOT, "public")
  )
);

/*
|--------------------------------------------------------------------------
| DASHBOARD STATE
|--------------------------------------------------------------------------
*/

app.get("/api/state", (req, res) => {
  const accounts =
    readJson(ACCOUNTS, []);

  const settings =
    readJson(SETTINGS, {});

  res.json({
    accounts: accounts.map(
      account => ({
        id: account.id,
        name: account.name,
        enabled:
          account.enabled !== false,
        connected:
          account.connected === true,
        online:
          account.online === true,
        lastSeen:
          account.lastSeen || null,
        status:
          account.online
            ? {
                running: true,
                lastSeen:
                  account.lastSeen
              }
            : {
                running: false
              }
      })
    ),

    settings,

    activity:
      readJson(
        ACTIVITY,
        []
      ).slice(0, 100)
  });
});

/*
|--------------------------------------------------------------------------
| CREATE ACCOUNT SHELL
|--------------------------------------------------------------------------
*/

app.post(
  "/api/accounts",
  (req, res) => {
    const name = String(
      req.body.name || ""
    ).trim();

    if (!name) {
      return res.status(400).json({
        error:
          "Account name is required."
      });
    }

    const accounts =
      readJson(
        ACCOUNTS,
        []
      );

    const id =
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    const account = {
      id,
      name,
      enabled: true,
      connected: false,
      online: false,
      lastSeen: null,
      createdAt:
        new Date().toISOString()
    };

    accounts.push(account);

    writeJson(
      ACCOUNTS,
      accounts
    );

    addActivity({
      type:
        "account_created",
      accountId: id,
      account: name
    });

    res.json({
      ...account,

      connectorCommand:
        `node connector.js "${name}"`
    });
  }
);

/*
|--------------------------------------------------------------------------
| CONNECT BUTTON
|
| Railway cannot open a browser on your Mac.
| This endpoint therefore gives the local connector
| instructions instead of trying to launch Chromium
| on Railway.
|--------------------------------------------------------------------------
*/

app.post(
  "/api/accounts/:id/connect",
  (req, res) => {
    const accounts =
      readJson(
        ACCOUNTS,
        []
      );

    const account =
      accounts.find(
        a =>
          a.id ===
          req.params.id
      );

    if (!account) {
      return res.status(404).json({
        error:
          "Account not found."
      });
    }

    addActivity({
      type:
        "connection_requested",
      accountId:
        account.id,
      account:
        account.name
    });

    res.json({
      ok: true,

      accountId:
        account.id,

      account:
        account.name,

      message:
        "Run connector.js locally to complete BloxBlitz's normal login flow.",

      command:
        `node connector.js "${account.name}"`
    });
  }
);

/*
|--------------------------------------------------------------------------
| ENABLE / DISABLE ACCOUNT
|--------------------------------------------------------------------------
*/

app.post(
  "/api/accounts/:id/toggle",
  (req, res) => {
    const accounts =
      readJson(
        ACCOUNTS,
        []
      );

    const account =
      accounts.find(
        a =>
          a.id ===
          req.params.id
      );

    if (!account) {
      return res.status(404).json({
        error:
          "Account not found."
      });
    }

    account.enabled =
      req.body.enabled !== false;

    writeJson(
      ACCOUNTS,
      accounts
    );

    addActivity({
      type:
        account.enabled
          ? "account_enabled"
          : "account_disabled",

      accountId:
        account.id,

      account:
        account.name
    });

    res.json({
      ok: true
    });
  }
);

/*
|--------------------------------------------------------------------------
| DELETE ACCOUNT
|--------------------------------------------------------------------------
*/

app.delete(
  "/api/accounts/:id",
  (req, res) => {
    const accounts =
      readJson(
        ACCOUNTS,
        []
      );

    const account =
      accounts.find(
        a =>
          a.id ===
          req.params.id
      );

    if (!account) {
      return res.status(404).json({
        error:
          "Account not found."
      });
    }

    writeJson(
      ACCOUNTS,
      accounts.filter(
        a =>
          a.id !==
          req.params.id
      )
    );

    addActivity({
      type:
        "account_deleted",

      accountId:
        account.id,

      account:
        account.name
    });

    res.json({
      ok: true
    });
  }
);

/*
|--------------------------------------------------------------------------
| SETTINGS
|--------------------------------------------------------------------------
*/

app.post(
  "/api/settings",
  (req, res) => {
    const settings =
      readJson(
        SETTINGS,
        {}
      );

    if (
      typeof req.body.autoJoin ===
      "boolean"
    ) {
      settings.autoJoin =
        req.body.autoJoin;
    }

    if (
      typeof req.body.webhookEnabled ===
      "boolean"
    ) {
      settings.webhookEnabled =
        req.body.webhookEnabled;
    }

    writeJson(
      SETTINGS,
      settings
    );

    res.json(settings);
  }
);

/*
|--------------------------------------------------------------------------
| WEBHOOK TEST
|--------------------------------------------------------------------------
*/

app.post(
  "/api/webhook/test",
  async (req, res) => {
    try {
      const settings =
        readJson(
          SETTINGS,
          {}
        );

      const webhook =
        process.env
          .DISCORD_WEBHOOK_URL;

      if (
        !settings.webhookEnabled
      ) {
        return res.status(400).json({
          error:
            "Webhook is disabled."
        });
      }

      if (!webhook) {
        return res.status(400).json({
          error:
            "DISCORD_WEBHOOK_URL is missing."
        });
      }

      await sendWebhook(
        "✅ **BloxBlitz Auto Joiner webhook test**"
      );

      res.json({
        ok: true
      });
    } catch (error) {
      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| AGENT: ACCOUNT CONNECTED
|--------------------------------------------------------------------------
*/

app.post(
  "/api/agent/accounts/:id/connected",
  requireAgent,
  (req, res) => {
    const accounts =
      readJson(
        ACCOUNTS,
        []
      );

    const account =
      accounts.find(
        a =>
          a.id ===
          req.params.id
      );

    if (!account) {
      return res.status(404).json({
        error:
          "Account not found."
      });
    }

    account.connected =
      true;

    account.online =
      true;

    account.lastSeen =
      new Date().toISOString();

    if (
      req.body.username
    ) {
      account.bloxblitzUsername =
        String(
          req.body.username
        );
    }

    writeJson(
      ACCOUNTS,
      accounts
    );

    addActivity({
      type:
        "account_connected",

      accountId:
        account.id,

      account:
        account.name
    });

    res.json({
      ok: true
    });
  }
);

/*
|--------------------------------------------------------------------------
| AGENT: ONLINE / OFFLINE STATUS
|--------------------------------------------------------------------------
*/

app.post(
  "/api/agent/accounts/:id/status",
  requireAgent,
  (req, res) => {
    const accounts =
      readJson(
        ACCOUNTS,
        []
      );

    const account =
      accounts.find(
        a =>
          a.id ===
          req.params.id
      );

    if (!account) {
      return res.status(404).json({
        error:
          "Account not found."
      });
    }

    account.online =
      req.body.online === true;

    account.lastSeen =
      new Date().toISOString();

    writeJson(
      ACCOUNTS,
      accounts
    );

    res.json({
      ok: true
    });
  }
);

/*
|--------------------------------------------------------------------------
| AGENT: ACTIVITY
|--------------------------------------------------------------------------
*/

app.post(
  "/api/agent/activity",
  requireAgent,
  async (req, res) => {
    const {
      type,
      accountId,
      account,
      error
    } = req.body;

    addActivity({
      type:
        type ||
        "agent_activity",

      accountId:
        accountId || null,

      account:
        account || null,

      error:
        error || null
    });

    /*
     * Webhook notifications for important events.
     */

    if (
      type ===
      "join_detected"
    ) {
      await sendWebhook(
        [
          "🌧️ **RAIN DETECTED**",
          "",
          `Account: \`${account || "Unknown"}\``
        ].join("\n")
      );
    }

    if (
      type ===
      "join_clicked"
    ) {
      await sendWebhook(
        [
          "🌧️ **RAIN JOINED**",
          "",
          `Account: \`${account || "Unknown"}\``,
          "Status: ✅ Join clicked"
        ].join("\n")
      );
    }

    if (
      type ===
      "agent_error"
    ) {
      await sendWebhook(
        [
          "⚠️ **BloxBlitz Agent Error**",
          "",
          `Account: \`${account || "Unknown"}\``,
          `Error: ${error || "Unknown error"}`
        ].join("\n")
      );
    }

    res.json({
      ok: true
    });
  }
);

/*
|--------------------------------------------------------------------------
| START
|--------------------------------------------------------------------------
*/

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `BloxBlitz dashboard listening on port ${PORT}`
    );
  }
);
