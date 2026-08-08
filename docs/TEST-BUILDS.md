# DeckTap 1.0.4 test builds

These packages are unsigned test builds. Use them only on computers you control.

## Package files

- `DeckTap-1.0.4-test-win32-x64-portable-unsigned.zip`
- `DeckTap-1.0.4-test-macos-arm64-crossbuilt-unsigned.zip`
- A matching `.sha256` file accompanies each archive. Verify it before extraction with `sha256sum -c <filename>.sha256` (or the platform equivalent).

## Windows x64 portable build

1. Extract the entire ZIP archive before running it.
2. Start `DeckTap/decktap.exe`; do not move the executable away from its adjacent files.
3. If Microsoft Defender SmartScreen appears, confirm that the file came from this project before choosing **More info** and **Run anyway**.
4. Allow DeckTap through Windows Firewall only on **Private networks**.
5. Test startup, QR plus six-digit pairing, trusted-IP browser recovery, new-device replacement, page turns, the five preset quick targets, custom target rules, startup target restoration, target-window recovery, tray behavior, and clean exit.

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
- The current packages use Electron's default application icon.
