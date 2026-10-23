# TProxy — Windows setup and daily use

TProxy connects your existing Claude Code CLI to account-entitled GitHub Copilot models. It listens only on 127.0.0.1. It does not need administrator rights, a permanent PATH change, Node, Bun, VS Code in a fixed location, or an Anthropic login. Claude Code itself must already be installed and usable from your normal account.

It uses the normal Windows PowerShell and .NET Framework desktop components supplied with Windows. If your organization blocks those or unsigned applications, administrator/IT policy still applies; this package does not bypass it.

## 1. Put the utility on your C drive

1. Open File Explorer and enter `%LOCALAPPDATA%\Programs` in the address bar.
2. Create a folder named `TProxy` and copy the complete package into it. Keep these six files together:

   ```text
   TProxy\
     tproxy.exe
     tproxy-desktop.exe
     Open-TProxy-Terminal.cmd
     SETUP-INSTRUCTIONS.md
     icons\tproxy-on.ico
     icons\tproxy-off.ico
   ```

   This normally resolves to `C:\Users\<your-user>\AppData\Local\Programs\TProxy` and is writable without administrator access. Do not use `C:\Program Files` or a shared/public directory.
3. Double-click `Open-TProxy-Terminal.cmd`. In that terminal run:

   ```cmd
   tproxy setup
   ```

   This creates the **TProxy** desktop shortcut and a per-user login shortcut for the status monitor. It does not change registry settings, permanent environment variables, firewall settings, machine services, or Claude permissions.
4. Alternatively, double-click `tproxy-desktop.exe` to open the controls without registering shortcuts.

If corporate policy blocks unsigned executables, Windows scripting/shortcut COM components, or startup programs, contact your administrator. Do not disable those protections. The CLI can still be used where permitted. A blocked login shortcut means you should open TProxy once after signing into Windows to start its monitor.

## 2. Start and stop from the desktop

1. Double-click the **TProxy** desktop icon.
2. Click **Start server**. The controller starts the proxy in the background.
3. **Green power icon / ON** means the local TProxy health endpoint is responding. **Grey / OFF** means it is not responding. This is proxy status, not proof that your account has quota or model access.
4. Click **Stop server** to stop it. This will interrupt Claude sessions using the proxy; finish those sessions first.
5. Closing the control window leaves the small status monitor in the notification area. Right-click its tray icon for controls. CLI starts/stops are detected too, normally within about 3–5 seconds.
6. **Exit status monitor** closes only the monitor. It leaves a running proxy alone. While the monitor is not running, the desktop icon cannot update; reopen TProxy to synchronize it. Windows Explorer may briefly cache the previous icon.

The login shortcut starts the monitor only. The proxy does not automatically start on login. Multiple clicks reuse one controller instance. TProxy will not stop an unrelated program occupying its port.

## 3. Authentication and dashboard

1. Sign into GitHub Copilot in VS Code, or use an existing GitHub CLI login or token environment if one is already configured. You do not need to create an Anthropic account.
2. Start TProxy and click **Open dashboard**. The controller opens an authenticated localhost link.
3. Check the account, auth source, token TTL, selected model and available quota. If no reusable login is found, the dashboard offers GitHub device authorization.
4. Keep dashboard links and `tproxy env` output private: both provide local access credentials.

The bare `http://127.0.0.1:4141` page does not grant management access. To get a private link from the terminal, run `tproxy dashboard`.

## 4. Launch Claude without permanent environment changes

Open `Open-TProxy-Terminal.cmd`, move to your project, and launch:

```cmd
cd /d "C:\path\to\your\project"
tproxy claude
```

Use this launcher rather than plain `claude`. It prepares local provider routing and first-run onboarding for that child process. Normal workspace trust, safety classification, tool permissions, hooks and local MCP remain active. Starting the server alone cannot change an unrelated shell's environment.

The terminal launcher adds the utility directory to PATH for that terminal and its child processes only. Closing it removes that session-only change. Your existing Windows PATH is not edited.

In any other CMD or PowerShell window, use the full executable path:

```cmd
"%LOCALAPPDATA%\Programs\TProxy\tproxy.exe" status
"%LOCALAPPDATA%\Programs\TProxy\tproxy.exe" claude
```

In PowerShell use `& "$env:LOCALAPPDATA\Programs\TProxy\tproxy.exe" status`.

## 5. Useful commands

```cmd
tproxy --help
tproxy status
tproxy start
tproxy stop
tproxy auth
tproxy dashboard
tproxy desktop
tproxy claude
tproxy claude -- --model copilot-auto
tproxy licenses
```

`start` in a terminal runs in the foreground; Ctrl+C stops that foreground server. The desktop controller starts it in the background. `claude` can create an owned server if none is running; an owned server stops when that Claude session exits.

## 6. Your data and settings

- Executables and icons: `%LOCALAPPDATA%\Programs\TProxy`.
- Private config, local SQLite history and controller logs: `%LOCALAPPDATA%\TProxy`.
- Credentials: your Windows Credential Manager; oversized records use a CurrentUser-DPAPI encrypted file. No secret is stored in the desktop shortcut.
- No third-party dashboard telemetry or CDN assets. Prompts go to GitHub Copilot for inference.
- Model/window discovery comes from Copilot. Missing metadata is labeled fallback. Changing a window or routing setting requires relaunching Claude; restarting the proxy alone does not change an existing Claude process's environment.

Default port is 4141. You can change it in the dashboard/settings file and restart. The controller follows the active runtime port and the saved config; use the default profile for desktop controls. Separate custom `--data-dir` profiles should be managed from the CLI.

## 7. Upgrade from GHCP Bridge

Stop the old server first, using its existing stop command. From the TProxy terminal run:

```cmd
tproxy migrate
tproxy setup
```

Migration copies the legacy `%LOCALAPPDATA%\ghcp-bridge` SQLite history/config and protected credentials into TProxy, verifies database integrity, and preserves the old profile for rollback. It refuses to overwrite an existing TProxy database/config. It does not change the normal Claude conversation storage. No OAuth flow is required when your existing session remains valid.

Keep the original profile as a private rollback copy until you have verified the migrated account and history. Migration does not delete the original profile or start another service. Do not add either profile to source control.

When updating an existing TProxy installation, close its controller with `tproxy-desktop.exe --quit-monitor`, stop the server, replace only the six package files, and run `tproxy setup` again. Keep the private data directory. Do not replace a running executable.

## 8. Troubleshooting

- **Grey icon but server was started:** wait a few seconds and reopen TProxy. Inspect `%LOCALAPPDATA%\TProxy\desktop.log`. The monitor must be running for automatic icon changes.
- **Port in use:** do not kill an unrelated program. Choose another port in the TProxy config and restart.
- **GitHub login unavailable:** confirm the working VS Code account. Custom/portable VS Code storage can be configured with explicit paths. Free/paid/enterprise access follows the account's actual entitlements.
- **Safety classifier unavailable:** inspect the native Claude classifier diagnostic and TProxy's recent request errors. The known Responses stop-sequence bug is fixed; outages/quota/revocation can still prevent classification. Safety checks are not bypassed.
- **Managed routing conflict:** follow the named policy/settings error and contact the administrator where required. TProxy does not modify corporate policy.
- **Long context/model change:** restart through `tproxy claude` to rediscover limits. Cross-model encrypted reasoning and future Auto selections may require native compaction or a new conversation.

## 9. Remove TProxy

Stop the server, then run `tproxy-desktop.exe --unregister` to remove only TProxy-owned desktop/login shortcuts and close the monitor. Delete the utility folder afterward. Your data and stored credentials are retained unless you deliberately remove them separately. Do not delete your normal `.claude` folder.

Unsupported by GitHub. Use may violate Copilot terms or corporate policy, may be audit logged, and may risk seat enforcement. Keep usage interactive and low-volume. Provider outages, full process-level egress guarantees and future client compatibility are not eliminated by this package.
