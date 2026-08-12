# 支持的进程白名单

当 macOS 辅助功能或 Windows 窗口枚举暂时看不到演示窗口时，DeckTap 会使用这份白名单做兜底识别。兜底模式只暴露已知演示、PDF 和媒体播放软件，避免把无关进程加入可锁定目标。

## 快捷目标

| 规则 | macOS 进程名 | Windows 进程名 | macOS Bundle ID |
| --- | --- | --- | --- |
| PowerPoint | `Microsoft PowerPoint`, `PowerPoint` | `POWERPNT`, `PPTVIEW` | `com.microsoft.Powerpoint`, `com.microsoft.powerpoint` |
| Keynote | `Keynote` | 不适用 | `com.apple.Keynote`, `com.apple.iWork.Keynote` |
| WPS 演示 | `WPS Office`, `WPS`, `WPP`, `WPPShow`, `WPSShow`, `WPPPlay` | `wps`, `wpp`, `wppshow`, `wpsshow`, `wppplay` | `com.kingsoft.wpsoffice.mac`, `com.kingsoft.wpsoffice` |
| ProPresenter | `ProPresenter`, `ProPresenter 6`, `ProPresenter 7` | `ProPresenter`, `ProPresenter 6`, `ProPresenter 7` | `com.renewedvision.ProPresenter`, `com.renewedvision.ProPresenter6`, `com.renewedvision.ProPresenter7` |
| 极演投影 / PerfectCast | `PerfectCast`, `极演投影`, `極演投影` | `PerfectCast`, `极演投影`, `極演投影` | `net.perfectcast.perfectcast`, `com.perfectcast.perfectcast` |

## 额外识别软件

| 规则 | macOS 进程名 | Windows 进程名 | macOS Bundle ID |
| --- | --- | --- | --- |
| Adobe Acrobat Reader | `Adobe Acrobat Reader`, `Adobe Acrobat`, `Acrobat` | `AcroRd32`, `Acrobat` | `com.adobe.Reader` |
| 预览 | `Preview` | 不适用 | `com.apple.Preview` |
| VLC | `VLC` | `vlc` | `org.videolan.vlc` |
| IINA | `IINA` | 不适用 | `com.colliderli.iina` |
| PotPlayer | 不适用 | `PotPlayer`, `PotPlayerMini`, `PotPlayerMini64` | 不适用 |

## 说明

- Microsoft Office for Mac 以独立应用包分发，PowerPoint 可执行进程通常显示为 `Microsoft PowerPoint`。
- ProPresenter 6、ProPresenter 7 和当前 ProPresenter 版本都保留 `ProPresenter` 系列进程名。
- WPS Office for Mac 使用 `com.kingsoft.wpsoffice.mac` 相关 Bundle ID；历史演示或播放进程名包含 `WPP`、`WPPShow`、`WPSShow` 和 `WPPPlay`。
- macOS 上 DeckTap 优先使用 Bundle ID 识别应用；系统 API 无法返回窗口时，才回退到受控进程名匹配。
