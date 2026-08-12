# DeckTap 1.0.15 测试包说明

这些包是未签名测试构建，只建议在自己控制的电脑和可信私人网络中使用。

- Release：[DeckTap v1.0.15](https://github.com/SIkenr/decktap/releases/tag/v1.0.15)
- 源码提交：`v1.0.15` 标签对应提交
- 命名规则：`DeckTap-<版本>-<平台>-<架构>.zip`

## 包文件

| 平台 | 文件 | SHA-256 |
| --- | --- | --- |
| Windows x64 | [`DeckTap-1.0.15-win-x64.zip`](https://github.com/SIkenr/decktap/releases/download/v1.0.15/DeckTap-1.0.15-win-x64.zip) | `5eb3b10f1bbade2f72f712f7acb428df15db4ee7e4cd6d70b64a356e998d3ffa` |
| macOS Apple Silicon | [`DeckTap-1.0.15-mac-arm64.zip`](https://github.com/SIkenr/decktap/releases/download/v1.0.15/DeckTap-1.0.15-mac-arm64.zip) | `091af9a98616d309150f6aca76066933c10cf5b51aaf480f39dde675b5b780fe` |

Release 中同时提供 `.sha256` 文件。解压前请先验证：

```bash
shasum -a 256 -c DeckTap-1.0.15-win-x64.zip.sha256
shasum -a 256 -c DeckTap-1.0.15-mac-arm64.zip.sha256
```

## Windows x64

1. 完整解压 ZIP，不要只把 `decktap.exe` 单独移出目录。
2. 运行 `DeckTap/decktap.exe`。
3. 如果 Microsoft Defender SmartScreen 提示风险，请先确认文件来源和 SHA-256，再选择继续运行。
4. Windows 防火墙询问时，只允许 **专用网络**。
5. 测试启动、扫码、6 位数字配对、浏览器恢复、新设备替换、翻页、快捷目标、自定义目标、目标恢复、托盘和退出。
6. PowerPoint/WPS/ProPresenter/PDF 或媒体播放场景下，确认 DeckTap 只展示白名单内目标；窗口枚举失败时，允许通过进程兜底目标继续锁定。

## macOS ARM64

该 `.app` 未使用 Apple Developer ID 签名，也未经过公证。

1. 解压 ZIP。
2. 在终端对应用做临时签名：

   ```bash
   codesign --force --deep --sign - /path/to/DeckTap.app
   ```

3. 右键 `DeckTap.app` 选择 **打开**。如果 macOS 仍拦截，请在验证校验值后使用 **系统设置 -> 隐私与安全性 -> 仍要打开**。
4. 授予 DeckTap 辅助功能权限，然后重启应用。
5. 测试扫码、6 位数字配对、浏览器恢复、新设备替换、Keynote/PowerPoint/PDF 翻页、快捷目标、自定义目标、权限恢复、托盘、图标显示和退出。
6. 最小化或重开放映窗口，确认 DeckTap 会先恢复目标窗口，再执行锁定、焦点验证和翻页。

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
- 当前白名单进程兜底只覆盖常见演示、PDF 和媒体播放软件；未列入的软件请使用自定义目标或提交补充规则。
