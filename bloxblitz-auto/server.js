app.post("/api/accounts/:id/connect", async (req, res) => {
  const accounts = readJson(ACCOUNTS, []);
  const account = accounts.find(a => a.id === req.params.id);

  if (!account) {
    return res.status(404).json({
      error: "Account not found."
    });
  }

  try {
    const result = await startWatcher(account, {
      interactive: true,
      loginOnly: true
    });

    /*
     * The browser session is stored in:
     *
     * profiles/<account-id>/
     *
     * Complete BloxBlitz's normal phrase-to-bio
     * login there.
     */

    account.connected = true;

    writeJson(ACCOUNTS, accounts);

    addActivity({
      type: "account_connection_started",
      accountId: account.id,
      account: account.name
    });

    res.json({
      ok: true,
      message:
        "BloxBlitz connection session started."
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});
