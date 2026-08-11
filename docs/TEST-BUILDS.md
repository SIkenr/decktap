# DeckTap 1.0.6 测试包说明

这些包是未签名测试构建，只建议在自己控制的电脑和可信私人网络中使用。

- Release：[DeckTap v1.0.6](https://github.com/SIkenr/decktap/releases/tag/v1.0.6)
- 源码提交：`2900db08798b`
- 命名规则：`DeckTap-<版本>-<平台>-<架构>.zip`

## 包文件

| 平台 | 文件 | SHA-256 |
| --- | --- | --- |
| Windows x64 | [`DeckTap-1.0.6-win-x64.zip`](https://github.com/SIkenr/decktap/releases/download/v1.0.6/DeckTap-1.0.6-win-x64.zip) | `1b7a1110ce22fdd7909a579d57ce667c030e27d58840795433b8a5a215dffffd` |
| macOS Apple Silicon | [`DeckTap-1.0.6-mac-arm64.zip`](https://github.com/SIkenr/decktap/releases/download/v1.0.6/DeckTap-1.0.6-mac-arm64.zip) | `5a00e1fcb7100e431c9c901f7b8c408d8fc99700d5db703c0ad5ec229e456a83` |

Release 中同时提供 `.sha256` 文件。解压前请先验证：

```bash
shasum -a 256 -c DeckTap-1.0.6-win-x64.zip.sha256
shasum -a 256 -c DeckTap-1.0.6-mac-arm64.zip.sha256
```

## Windows x64

1. 完整解压 ZIP，不要只把 `decktap.exe` 单独移出目录。
2. 运行 `DeckTap/decktap.exe`。
3. 如果 Microsoft Defender SmartScreen 提示风险，请先确认文件来源和 SHA-256，再选择继续运行。
4. Windows 防火墙询问时，只允许 **专用网络**。
5. 测试启动、扫码、6 位数字配对、浏览器恢复、新设备替换、翻页、快捷目标、自定义目标、目标恢复、托盘和退出。
6. PowerPoint/WPS 场景下，关闭并重开放映窗口，确认 DeckTap 会进入安全等待状态并自动重新锁定。

## macOS ARM64

该 `.app` 未使用 Apple Developer ID 签名，也未经过公证。

1. 解压 ZIP。
2. 在终端对应用做临时签名：

   ```bash
   codesign --force --deep --sign - /path/to/DeckTap.app
   ```

3. 右键 `DeckTap.app` 选择 **打开**。如果 macOS 仍拦截，请在验证校验值后使用 **系统设置 -> 隐私与安全性 -> 仍要打开**。
4. 授予 DeckTap 辅助功能权限，然后重启应用。
5. 测试扫码、6 位数字配对、浏览器恢复、新设备替换、Keynote/PowerPoint/PDF 翻页、快捷目标、自定义目标、权限恢复、托盘和退出。
6. 保持编辑器打开并重开放映窗口，确认等待期间手机命令被阻止，新的放映窗口出现后自动重新锁定。

## 配对验收清单

- 扫码后先进入数字配对页，而不是直接进入控制器。
- 输入正确 6 位数字码后，手机进入控制页，桌面端显示已连接。
- 同一可信私人局域网地址在信任有效期内可恢复连接。
- 另一台手机完成配对后，旧设备立即断开并失去权限。
- 刷新配对码会撤销当前授权，需要重新配对。

## 已知限制

- Windows 包没有 Authenticode 签名。
- macOS 包没有 Apple Developer ID 签名或公证。
- 当前没有安装器和自动更新。
- 跨平台包仍需在真实硬件上验证启动、权限、键盘控制、防火墙、托盘和退出。
- 桌面快捷目标已使用本地软件图标，但应用自身图标仍需后续完善。
