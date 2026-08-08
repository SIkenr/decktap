# DeckTap 1.0.5 test builds

These packages are unsigned test builds. Use them only on computers you control.

- Release: [DeckTap v1.0.5](https://github.com/SIkenr/decktap/releases/tag/v1.0.5)
- Source commit: `f24c6c4a17a40f9ac72d030a39d833031432d256`

## Package files

| Package | SHA-256 |
| --- | --- |
| [`DeckTap-1.0.5-test-win32-x64-portable-unsigned.zip`](https://github.com/SIkenr/decktap/releases/download/v1.0.5/DeckTap-1.0.5-test-win32-x64-portable-unsigned.zip) | `dc28a8d5616879ebc7142986b7cc730e6864ebe0bff789adefe7448837a8a734` |
| [`DeckTap-1.0.5-test-macos-arm64-crossbuilt-unsigned.zip`](https://github.com/SIkenr/decktap/releases/download/v1.0.5/DeckTap-1.0.5-test-macos-arm64-crossbuilt-unsigned.zip) | `de608df1401bdc50d0ea8af86e13d836b9218a50422bf054a06592d1c0b98ae1` |

A matching `.sha256` file accompanies each archive. Verify it before extraction with `sha256sum -c <filename>.sha256` (or the platform equivalent).

## Windows x64 portable build

1. Extract the entire ZIP archive before running it.
2. Start `DeckTap/decktap.exe`; do not move the executable away from its adjacent files.
3. If Microsoft Defender SmartScreen appears, confirm that the file came from this project before choosing **More info** and **Run anyway**.
4. Allow DeckTap through Windows Firewall only on **Private networks**.
5. Test startup, QR plus six-digit pairing, trusted-IP browser recovery, new-device replacement, page turns, the five preset quick targets, custom target rules, startup target restoration, target-window recovery, tray behavior, and clean exit.
6. For PowerPoint and WPS, start a slideshow, edit the document so the playback window closes, then start the slideshow again. Confirm DeckTap enters a safe waiting state and automatically re-locks the new playback window without focusing the editor.

## macOS ARM64 cross-built app

This `.app` was assembled on Linux and is not signed or notarized. It targets Apple Silicon Macs.

1. Extract the ZIP archive.
2. In Terminal, ad-hoc sign the extracted application:

   ```bash
   codesign --force --deep --sign - /path/to/DeckTap.app
   ```

3. Right-click `DeckTap.app` and choose **Open**. If macOS still blocks it, use **System Settings > Privacy & Security > Open Anyway** only after verifying the archive checksum.
4. Grant DeckTap Accessibility permission when prompted, then restart the app.
5. Test QR plus six-digit pairing, trusted-IP browser recovery, new-device replacement, Keynote/PowerPoint/PDF page turns, the preset quick targets, custom target rules, startup target restoration, permission denial and recovery, target-window focus recovery, tray behavior, and clean exit.
6. Close and restart a slideshow while keeping its editor open. Confirm DeckTap blocks page-turn commands while waiting and automatically re-locks the replacement playback window.

## Pairing acceptance checks

- Scanning the QR code opens the numeric pairing screen, not the controller.
- The phone reaches the controller only after the six-digit code succeeds; the desktop immediately shows the connected state.
- Reopening or switching browsers on the same trusted private-LAN address can recover without another code while trust remains valid.
- Pairing a different device immediately disconnects and revokes the previous device; the old entry remains only as anonymous history.
- Rotating the pairing code revokes the current authorization and requires a fresh numeric pairing.

## Limitations

- No Windows Authenticode signature.
- No Apple Developer ID signature or notarization.
- No installer or automatic update flow.
- Cross-built packages still require launch and real-keyboard verification on matching hardware.
- The desktop quick-target grid uses local product icons; the packaged application itself still uses Electron's default executable icon.
