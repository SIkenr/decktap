# DeckTap

<a href="https://youtu.be/pNgNUWSf7C4" title="Link Title"><img src="./images/hero.png" alt="Alternate Text" width="600"/></a>

📡 DeckTap is a lightweight local-network remote for controlling presentations.  
Use your phone to wirelessly control PowerPoint, Keynote, PDF slideshows — no app installation needed.

Current test version: **1.0.4**. See [CHANGELOG.md](./CHANGELOG.md) for release history and [docs/TEST-BUILDS.md](./docs/TEST-BUILDS.md) for unsigned package instructions.

---

## ✨ Features

- 📱 Control slides via your phone browser
- 🌐 Works over local Wi-Fi/Hotspot network
- 🖥 Simulates keyboard arrow keys to navigate slides
- ↑↓ Uses up/down page turning by default, with an optional ←→ left/right mode saved on the phone
- 🕒 Desktop-synchronized network time and a presentation timer in the redesigned mobile controller
- ✅ Returns per-command success or a safe recovery message to the phone controller
- 🪟 Electron management client with a secure preload bridge
- 🌓 System, light, and dark desktop themes
- 📊 Live service state, QR connection, connected-device count, permissions, and diagnostics
- 📵 Anonymous connected-session list with per-device and disconnect-all controls
- 🧰 In-app diagnostic viewer with level filters and a sanitized copyable summary
- 🧭 System tray controls, configurable close-to-tray behavior, and packaged-app login startup
- 🎯 Six-tile quick targeting for Keynote, PowerPoint, WPS, ProPresenter, and PerfectCast, plus custom application rules
- 🔁 Startup restoration of the last locked application rule when exactly one matching window is running
- 🔐 Short-lived QR plus six-digit pairing, single-device LAN trust, and command rate limiting
- 🚀 Minimal setup: run a local Node.js server and scan a QR code
- 🔒 No internet required, **safe** and **private**

---

## 📦 Project Structure
```yaml
decktap/
├── client/
│    ├── lan.js          # Command-line entry point and signal handling
│    ├── lan-service.js  # Restartable HTTP/WebSocket service
│    ├── keyboard.js     # Native keyboard adapter
│    ├── logger.js       # Structured local logging and rotation
│    ├── pairing.js      # Short-lived QR tokens and numeric pairing codes
│    ├── trusted-client-store.js # Single-device trust and revoked history
│    ├── target-window.js # Presentation/media target focus controller
│    └── network.js      # Local network interface selection
├── electron/            # Electron main process, preload bridge, and IPC channels
├── desktop/             # React desktop management interface
├── decktap-web/         # React phone controller
├── test/                # Node.js unit and integration tests
├── README.md
├── LICENSE
├── package.json
└── .gitignore
```
---

## 🔧 Prerequisites

### macOS Permissions
DeckTap uses `@jitsi/robotjs` to simulate keyboard events. On macOS, grant Accessibility permission to the DeckTap application; grant it to your terminal only when using command-line mode:

1. Open **System Settings** > **Privacy & Security** > **Accessibility**
2. Click the lock icon 🔒 to make changes
3. Click the **+** button
4. Select `DeckTap.app` for the Electron client, or your terminal app for command-line mode
5. Enable the selected application

The Electron home screen shows **Open Accessibility settings** and **Check again** actions when this permission is missing. The settings action opens only the fixed macOS Accessibility pane; the renderer cannot provide an arbitrary external URL.

> **Note**: Without these permissions, DeckTap won't be able to control your presentations.

---

## 🚀 Getting Started (Electron desktop client)
1. Install dependencies:
   ```bash
   npm install
   npm --prefix decktap-web install
   ```

   > `@jitsi/robotjs` is a native dependency with prebuilt Windows and macOS binaries. Release builds must preserve the matching native binary outside ASAR, and keyboard control still requires target-platform verification.

2. Grant accessibility permissions (macOS only):
   - Follow the steps in [macOS Permissions](#macos-permissions)
   - Restart DeckTap after granting permissions

3. Start the Electron client:
   ```bash
   npm start
   ```

   The client starts the LAN service automatically, displays the phone QR code, and provides service start/stop controls.

4. Connect with your phone:
   - Connect your phone to the same WiFi network(only support private WiFi without vlan, not working on campus network) as your computer
   - Scan the QR code displayed in the Electron home screen
   - The QR code contains a short-lived random secret. The phone must also enter the six-digit code shown on the desktop before controls are enabled.
   - The successfully paired private LAN address is trusted locally for at most 24 hours, so reopening or switching browsers on that phone does not require another pairing.
   - <img src="./images/computer-client.png" width="600">
   - Start controlling your presentation (Use 👉 to switch left and right hand mode)
   - <img src="./images/phone-controller.png" width="300" >

5. Select **Follow system**, **Light**, or **Dark** from the appearance control in the top-right corner.

   Use **Rotate pairing code** if a QR code or numeric code was exposed, or you want to revoke the current phone. Rotation immediately disconnects the controller, removes its trust, and invalidates the old pairing credentials.

   DeckTap permits one trusted phone at a time. When a new phone completes numeric pairing, every previous controller session is disconnected and its authorization is revoked. The **Device connections** page displays anonymous active sessions and revoked history only; it never shows a complete IP address or browser user agent. The current private LAN address is stored only in the local app-data directory and expires within 24 hours. Revoked history contains no IP address and has no control permission.

6. Use **Control settings** to review the active arrow-key mapping and focus-protection state. Use **Application settings** to choose whether the LAN service starts with DeckTap, whether closing the main window keeps DeckTap running in the tray, and whether a packaged Windows/macOS client launches at system login. Login startup is deliberately unavailable in development builds so Electron itself is never registered as a login item.

   The tray menu exposes only fixed actions: show DeckTap, start or stop the LAN service, inspect a safe device/target summary, and quit. It does not expose pairing URLs, native identifiers, files, or arbitrary commands.

7. Run all checks up to, but not including, Electron packaging:
   ```bash
   npm run verify:prepack
   ```

   This repeats the tests, type checks, and web build, then validates the Forge security configuration, stable Bundle ID, installer makers, and the Windows x64 / macOS universal RobotJS prebuilds. It does not create a package or run signing and notarization.

   A Linux build host may set `DECKTAP_DARWIN_CROSS_PACKAGE=1` to assemble a macOS `.app` for testing only. The switch skips only the final ad-hoc `codesign` step that Linux cannot execute; it does not disable Electron Fuses. After extracting the archive, run `codesign --force --deep --sign - DeckTap.app` on the destination Mac before launch and Accessibility testing. A release build must still be created on macOS, signed with Developer ID, and notarized by Apple.

### Command-line LAN mode

The original command-line service remains available:

```bash
npm run build:web
npm run start:cli
```

To use a different CLI port:

```bash
PORT=10000 npm run start:cli
```

### Window focus behavior

Keyboard commands are delivered to the foreground application. The desktop client provides an optional **Lock target window** mode: it briefly hides DeckTap, captures the presentation or media window that returns to the foreground, restores that window immediately before each command, verifies focus, and only then sends the key. If the target closes or cannot be focused, DeckTap marks it as lost and does not send the command to another application.

Windows window activation uses a fixed PowerShell command backed by Win32 window APIs. macOS uses the system `osascript` JavaScript bridge and System Events, which can request Accessibility and Automation permission. Both adapters keep process and window identifiers in the Electron main process.

The home screen provides six quick target tiles for Keynote, PowerPoint, WPS, ProPresenter, PerfectCast (极演投影), and a custom application. Clicking a built-in tile scans with that application's preset rules and locks it when exactly one matching window is found; ambiguous matches are shown for explicit selection. The custom tile opens **Control target**, where an unrecognized window can be locked temporarily or saved as a custom rule. On startup, DeckTap checks the most recently locked built-in or custom rule and restores it only when exactly one window matches.

The **Control target** page also supports broader discovery with built-in rules for the five quick targets plus Acrobat Reader, Preview, VLC, IINA, and PotPlayer. The renderer receives only opaque temporary candidate IDs and safe display labels; native handles, process IDs, bundle IDs, and raw window titles remain in the main process. DeckTap does not continuously steal focus when no command is being sent.

### Diagnostic logs

DeckTap writes newline-delimited JSON logs to `logs/decktap.log` in command-line mode. Logs include a session ID, timestamp, severity, stable event name, component, and sanitized diagnostic context. Files rotate at 2 MiB and retain up to five files by default.

```bash
# Include debug events
DECKTAP_LOG_LEVEL=debug npm run start:cli

# Override the log directory
DECKTAP_LOG_DIR=/path/to/logs npm run start:cli
```

Supported levels are `debug`, `info`, `warn`, `error`, and `silent`. Pairing tokens, passwords, cookies, authorization values, and sensitive URL parameters are redacted before both file and console output. The Electron client writes to the operating system's standard application log directory and exposes an **Open log folder** action.

The **Log diagnostics** page reads only DeckTap's fixed active and rotated log files. It displays an allowlisted summary—time, severity, component, event, and short message—and excludes process IDs, session IDs, raw stacks, arbitrary context, and full paths. Records are sanitized again while reading, malformed lines are ignored, and **Copy sanitized summary** places only the safe diagnostic view on the clipboard.

### Secure pairing model

- Each service start creates a 256-bit QR token and an independent six-digit numeric code with a ten-minute lifetime.
- The secret is carried in the QR URL fragment, so it is not sent in the initial HTTP request or referrer.
- An untrusted WebSocket connection has two minutes and at most five numeric-code attempts to authenticate. Commands sent before authentication are rejected.
- A successful numeric pairing trusts one private LAN address for at most 24 hours. Trusted reconnects replace an older socket from that address; numeric pairing from a new device revokes and disconnects the previous device.
- Only supported versioned commands are accepted. Payload size, pending connections, and command rate are bounded.
- New controllers attach a bounded request ID to each command. The desktop returns success or an allowlisted failure reason without exposing native errors; legacy commands without an ID remain accepted without acknowledgements.
- Automatic credential expiry updates the QR code and number without interrupting an active presentation. Manual rotation revokes the active session and stored trust.
- Pairing protects control access on the local network; this phase does not add TLS. Use DeckTap only on a trusted private Wi-Fi or hotspot.
  

---

## 🖱️ Distribution status

Version 1.0.4 has unsigned portable test packages for Windows x64 and macOS ARM64. They are intended for controlled testing, not public release:

- Windows: portable ZIP; no Authenticode signature or installer.
- macOS: Linux cross-built `.app`; no Developer ID signature or notarization and requires local ad-hoc signing before testing.
- Both platforms still require real-device verification of startup, native keyboard control, target focus recovery, pairing, firewall/permissions, tray behavior, and clean exit.

Build locally with `npm run package`, or run `npm run make` when creating Forge distributables on the target operating system. Follow [the test-build guide](./docs/TEST-BUILDS.md) before launching an unsigned package. Public macOS releases must be built on macOS, signed with Developer ID, hardened, and notarized; public Windows releases should be Authenticode-signed.

---

> If you encounter issues such as failure to run, insufficient permissions, or cannot access the page, please send the terminal error message to the developer for help.
