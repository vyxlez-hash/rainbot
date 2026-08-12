async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,

    headers: {
      "content-type":
        "application/json",

      ...(options.headers || {})
    }
  });

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

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    character =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[character])
  );
}

function formatStatus(account) {
  if (account.online) {
    return "Watching";
  }

  if (account.connected) {
    return "Connected";
  }

  return "Not connected";
}

async function refresh() {
  try {
    const state =
      await api(
        "/api/state"
      );

    const accounts =
      state.accounts || [];

    const watching =
      accounts.filter(
        account =>
          account.online
      ).length;

    document.querySelector(
      "#count"
    ).textContent =
      accounts.length;

    document.querySelector(
      "#watching"
    ).textContent =
      watching;

    document.querySelector(
      "#auto"
    ).textContent =
      state.settings.autoJoin
        ? "ON"
        : "OFF";

    document.querySelector(
      "#system"
    ).textContent =
      "● SYSTEM ONLINE";

    document.querySelector(
      "#autoToggle"
    ).checked =
      !!state.settings.autoJoin;

    document.querySelector(
      "#webhookToggle"
    ).checked =
      !!state.settings
        .webhookEnabled;

    const accountsBox =
      document.querySelector(
        "#accounts"
      );

    if (!accounts.length) {
      accountsBox.innerHTML =
        `<div class="empty">
          No accounts connected yet.
        </div>`;
    } else {
      accountsBox.innerHTML =
        accounts
          .map(
            account => `
              <div class="account">
                <div>
                  <div class="name">
                    ${esc(account.name)}
                  </div>

                  <div class="meta">
                    ${esc(
                      formatStatus(
                        account
                      )
                    )}
                  </div>
                </div>

                <div class="status">
                  <span class="dot ${
                    account.online
                      ? "on"
                      : ""
                  }"></span>

                  <button
                    data-connect="${esc(
                      account.id
                    )}"
                  >
                    ${
                      account.connected
                        ? "Reconnect"
                        : "Connect"
                    }
                  </button>

                  <button
                    class="secondary"
                    data-toggle="${esc(
                      account.id
                    )}"
                  >
                    ${
                      account.enabled
                        ? "Disable"
                        : "Enable"
                    }
                  >

                  <button
                    class="secondary"
                    data-delete="${esc(
                      account.id
                    )}"
                  >
                    Delete
                  </button>
                </div>
              </div>
            `
          )
          .join("");
    }

    const activity =
      state.activity || [];

    document.querySelector(
      "#activity"
    ).innerHTML =
      activity.length
        ? activity
            .map(
              item => `
                <div class="activity">
                  <small>
                    ${new Date(
                      item.time
                    ).toLocaleTimeString()}
                  </small>

                  ${
                    item.account
                      ? `${esc(
                          item.account
                        )}: `
                      : ""
                  }

                  ${esc(
                    String(
                      item.type ||
                        ""
                    )
                      .replaceAll(
                        "_",
                        " "
                      )
                  )}

                  ${
                    item.error
                      ? ` — ${esc(
                          item.error
                        )}`
                      : ""
                  }
                </div>
              `
            )
            .join("")
        : `<div class="empty">
             No activity yet.
           </div>`;

    document
      .querySelectorAll(
        "[data-connect]"
      )
      .forEach(button => {
        button.onclick =
          async () => {
            try {
              const result =
                await api(
                  `/api/accounts/${button.dataset.connect}/connect`,
                  {
                    method: "POST"
                  }
                );

              alert(
                [
                  result.message,
                  "",
                  "Run this command on the computer that will keep the BloxBlitz account online:",
                  "",
                  result.command
                ].join("\n")
              );
            } catch (error) {
              alert(
                error.message
              );
            }
          };
      });

    document
      .querySelectorAll(
        "[data-toggle]"
      )
      .forEach(button => {
        button.onclick =
          async () => {
            const account =
              accounts.find(
                item =>
                  item.id ===
                  button.dataset
                    .toggle
              );

            if (!account) {
              return;
            }

            await api(
              `/api/accounts/${account.id}/toggle`,
              {
                method: "POST",

                body:
                  JSON.stringify({
                    enabled:
                      !account.enabled
                  })
              }
            );

            await refresh();
          };
      });

    document
      .querySelectorAll(
        "[data-delete]"
      )
      .forEach(button => {
        button.onclick =
          async () => {
            if (
              !confirm(
                "Delete this account?"
              )
            ) {
              return;
            }

            await api(
              `/api/accounts/${button.dataset.delete}`,
              {
                method: "DELETE"
              }
            );

            await refresh();
          };
      });
  } catch (error) {
    document.querySelector(
      "#system"
    ).textContent =
      "● API ERROR";

    console.error(error);
  }
}

document.querySelector(
  "#add"
).onclick = async () => {
  const name =
    prompt(
      "Enter a name for this connected BloxBlitz account:"
    );

  if (!name) {
    return;
  }

  try {
    const account =
      await api(
        "/api/accounts",
        {
          method: "POST",

          body:
            JSON.stringify({
              name
            })
        }
      );

    alert(
      [
        "Account created.",
        "",
        "Now click Connect on that account.",
        "",
        account.connectorCommand
      ].join("\n")
    );

    await refresh();
  } catch (error) {
    alert(
      error.message
    );
  }
};

document.querySelector(
  "#autoToggle"
).onchange =
  async event => {
    await api(
      "/api/settings",
      {
        method: "POST",

        body:
          JSON.stringify({
            autoJoin:
              event.target.checked
          })
      }
    );

    await refresh();
  };

document.querySelector(
  "#webhookToggle"
).onchange =
  async event => {
    await api(
      "/api/settings",
      {
        method: "POST",

        body:
          JSON.stringify({
            webhookEnabled:
              event.target.checked
          })
      }
    );

    await refresh();
  };

document.querySelector(
  "#testWebhook"
).onclick =
  async () => {
    try {
      await api(
        "/api/webhook/test",
        {
          method: "POST"
        }
      );

      alert(
        "Webhook sent."
      );
    } catch (error) {
      alert(
        error.message
      );
    }
  };

refresh();

setInterval(
  refresh,
  3000
);
