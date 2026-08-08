# Changelog

All notable DeckTap desktop changes are recorded here. The project is currently distributing unsigned test builds; entries describe development milestones rather than signed public releases.

## [Unreleased]

## [1.0.5](https://github.com/SIkenr/decktap/releases/tag/v1.0.5) - 2026-08-08

### Added

- Continuous monitoring of the remembered presentation rule, with automatic rebinding when one playback window reappears after editing.
- Real local application icons for the five built-in quick targets.

### Fixed

- PowerPoint and WPS editor windows are no longer selected as page-turn targets when a dedicated slideshow process or playback window is required.
- Phone controls remain blocked while DeckTap is waiting for a replacement playback window, preventing keys from reaching the editor or another foreground application.

### Test builds

- Published unsigned Windows x64 portable and macOS ARM64 cross-built archives with SHA-256 checksum files.
- Built from source commit `f24c6c4a17a40f9ac72d030a39d833031432d256`; see the [test-build guide](./docs/TEST-BUILDS.md) for verification and platform limitations.

## [1.0.4] - 2026-08-08

### Added

- Six-tile quick target grid for Keynote, PowerPoint, WPS, ProPresenter, PerfectCast (极演投影), and custom applications.
- Preset process/window recognition rules for the five built-in presentation applications.
- One-click locking when a preset has exactly one match, with explicit selection for ambiguous matches.
- Startup restoration of the last built-in or custom target rule when exactly one matching window is running.
- Custom tile navigation to the full target discovery and custom-rule workflow.

### Changed

- Prepared Windows x64 portable and macOS ARM64 cross-built unsigned test archives.
- Updated package verification metadata and test-build documentation for 1.0.4.

## [1.0.3] - 2026-08-08

### Added

- Six-digit numeric confirmation after QR discovery.
- Single-device private-LAN trust for browser reopen or browser switching.
- Automatic revocation and disconnection of all previously authorized devices when a new device pairs.
- Anonymous active-device and revoked-history views without complete IP addresses or user-agent strings.

### Changed

- Desktop and mobile connection states now advance only after successful secure pairing.
- Manual pairing rotation disconnects the active controller and invalidates its trust.

## [1.0.2] - 2026-08-08

### Added

- Redesigned mobile controller aligned with the desktop visual language.
- Desktop-synchronized network time above the presentation timer.
- Responsive timer and page-turn controls, including vertical and horizontal page-turn modes.

### Fixed

- Packaged WebSocket framing compatibility on Windows.
- Windows target-window activation and packaged native-module handling.

## [1.0.1] - 2026-08-08

### Added

- Electron desktop management client with secure preload/IPC boundaries.
- Target-window discovery, selection, focus restoration, and safe command acknowledgements.
- macOS Accessibility recovery actions and Windows/macOS platform adapters.
- Structured rotating logs and sanitized in-app diagnostics.
- Anonymous controller session management, tray lifecycle controls, themes, and pre-package validation.
- Unsigned cross-platform test packaging workflow.

## [1.0.0]

- Original local-network Node.js/WebSocket presentation controller and phone web interface.
