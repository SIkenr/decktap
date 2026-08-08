# DeckTap

<p align="center">
  <a href="https://youtu.be/pNgNUWSf7C4">
    <img src="./images/hero.png" alt="DeckTap 演示" width="720" />
  </a>
</p>

DeckTap 是一款局域网投屏演示遥控器：电脑运行桌面客户端，手机连接同一 Wi-Fi 或热点后扫描二维码，即可在浏览器里控制 PowerPoint、Keynote、WPS、ProPresenter、极演投影及其他演示软件。手机无需安装 App，控制数据不经过云端。

> 当前测试版本：**1.0.5**。现有安装包均为未签名测试构建，仅建议在自己控制的电脑和可信私人网络中测试。

[下载测试版](https://github.com/SIkenr/decktap/releases) · [版本记录](./CHANGELOG.md) · [测试包说明](./docs/TEST-BUILDS.md)

## 核心能力

- **手机浏览器遥控**：支持上一页、下一页、上下键或左右键翻页、演讲计时与电脑时间同步。
- **安全数字配对**：扫描二维码后仍需输入电脑端显示的六位数字码，配对完成前不能发送控制命令。
- **单设备信任**：同一时间只保留一台已授权设备；新设备配对后立即断开并撤销历史设备权限，同时保留匿名历史记录。
- **六宫格快捷锁定**：内置 Keynote、PowerPoint、WPS、ProPresenter、极演投影和自定义软件入口。
- **放映窗口保护**：PowerPoint 与 WPS 的编辑窗口不会被当作翻页目标，避免手机按键误送到编辑界面。
- **自动重新锁定**：编辑 PPT 导致放映窗口关闭时，DeckTap 进入安全等待状态并阻止按键；重新开始放映后会自动锁定新的播放窗口。
- **目标焦点保护**：每次翻页前恢复并验证目标窗口焦点；目标丢失或无法聚焦时不会向其他前台应用发送按键。
- **桌面管理能力**：提供服务状态、二维码、设备管理、目标控制、主题、托盘、开机启动和脱敏诊断日志。

## 快速开始

### 1. 下载测试包

| 平台 | 文件 | SHA-256 |
| --- | --- | --- |
| Windows x64 | `DeckTap-1.0.5-test-win32-x64-portable-unsigned.zip` | `dc28a8d5616879ebc7142986b7cc730e6864ebe0bff789adefe7448837a8a734` |
| macOS Apple Silicon | `DeckTap-1.0.5-test-macos-arm64-crossbuilt-unsigned.zip` | `de608df1401bdc50d0ea8af86e13d836b9218a50422bf054a06592d1c0b98ae1` |

测试包由提交 `f24c6c4a17a40f9ac72d030a39d833031432d256` 构建。Release 中同时提供对应的 `.sha256` 文件；解压前请先验证校验值：

```bash
sha256sum -c DeckTap-1.0.5-test-win32-x64-portable-unsigned.zip.sha256
sha256sum -c DeckTap-1.0.5-test-macos-arm64-crossbuilt-unsigned.zip.sha256
```

### 2. 启动电脑客户端

#### Windows x64

1. 完整解压 ZIP，不要只把 `decktap.exe` 单独移出目录。
2. 运行 `DeckTap/decktap.exe`。
3. 如果 SmartScreen 提示风险，请先确认文件来源和 SHA-256，再选择继续运行。
4. Windows 防火墙询问时，仅允许 **专用网络**。

#### macOS Apple Silicon

该 `.app` 在 Linux 上交叉组装，未使用 Apple Developer ID 签名，也未经过公证。解压后先在终端执行临时签名：

```bash
codesign --force --deep --sign - /path/to/DeckTap.app
```

然后右键 `DeckTap.app` 选择 **打开**。首次运行时，在 **系统设置 → 隐私与安全性 → 辅助功能** 中允许 DeckTap，并重新启动应用。

### 3. 连接手机

1. 电脑和手机连接同一个可信的私人 Wi-Fi 或手机热点。
2. 在电脑端启动 DeckTap 局域网服务。
3. 用手机扫描电脑端二维码。
4. 在手机页面输入电脑端显示的六位数字配对码。
5. 电脑显示连接成功后，手机才会进入控制页面。

企业、校园或访客网络可能启用 VLAN、客户端隔离或防火墙策略，导致手机无法访问电脑。此时建议改用私人路由器或手机热点。

### 4. 选择演示软件

首页提供六个快捷目标：

- Keynote
- PowerPoint
- WPS
- ProPresenter
- 极演投影（PerfectCast）
- 自定义应用

点击预设图标后，DeckTap 会根据进程和窗口规则查找正在运行的放映窗口。只有一个匹配项时会直接锁定；存在多个候选窗口时会要求明确选择。点击自定义入口可扫描其他软件，并保存自己的识别规则。

### 5. 开始演示

目标锁定后，在手机页面使用上一页、下一页和计时器。默认使用 `↑` / `↓` 翻页，也可在手机端切换为 `←` / `→`，选择会保存在浏览器本地。

## PowerPoint 与 WPS 自动重锁

PowerPoint 和 WPS 的编辑窗口与放映窗口可能属于不同进程或不同窗口类型。DeckTap 1.0.5 按以下方式处理：

1. 快捷识别规则排除编辑窗口，只接受符合条件的播放窗口。
2. 编辑 PPT 导致放映窗口关闭时，目标状态切换为等待。
3. 等待期间手机翻页命令被阻止，不会落到编辑器或其他前台软件。
4. DeckTap 持续监控已记住的应用规则。
5. 新的放映窗口出现且匹配唯一时，DeckTap 自动重新锁定，无需再次选择。

## 配对与安全模型

- 每次服务启动会生成一个 256 位随机二维码令牌，以及独立的六位数字配对码。
- 二维码令牌放在 URL Fragment 中，不进入初始 HTTP 请求或 Referrer。
- 数字码有效期为 10 分钟；未认证连接最多允许 5 次尝试，并有 2 分钟认证超时。
- 成功配对后，仅在本机保存一条私人局域网地址信任，最长 24 小时。
- 新设备完成数字配对后，旧设备立即断开并失去权限；历史记录不保存完整 IP 或浏览器 User-Agent。
- WebSocket 命令经过类型、大小、状态、速率和允许列表校验，认证前的命令不会触发键盘控制。
- Electron 渲染进程不直接获得文件系统、Shell、网络、原生窗口句柄或进程 ID。
- 日志会过滤令牌、密码、Cookie、Authorization、完整 URL 和敏感路径信息。

配对用于保护局域网控制权限，但当前版本没有为局域网 HTTP/WebSocket 增加 TLS。请勿在公共 Wi-Fi、开放热点或不可信网络中使用。

## 从源码运行

### 环境要求

- Node.js 18 或更高版本
- npm
- Windows x64，或 macOS（Intel/Apple Silicon 的原生依赖仍需按目标架构验证）
- macOS 需要辅助功能权限

### 安装与启动

```bash
npm install
npm --prefix decktap-web install
npm start
```

`npm start` 会先构建手机控制页面，再启动 Electron 桌面客户端。原始命令行局域网模式仍然可用：

```bash
npm run build:web
npm run start:cli
```

自定义命令行端口：

```bash
PORT=10000 npm run start:cli
```

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `npm test` | 运行 Node.js 单元与集成测试 |
| `npm run lint` | 检查手机端代码并执行桌面端 TypeScript 类型检查 |
| `npm run build` | 构建手机端并验证桌面端类型 |
| `npm run verify:prepack` | 运行测试、Lint、构建及打包前安全/原生模块检查 |
| `npm run package` | 使用 Electron Forge 生成当前平台应用目录 |
| `npm run make` | 在目标操作系统上生成 Forge 分发包 |
| `npm run verify:package -- <app-path>` | 验证打包后的应用结构、原生模块和安全配置 |

1.0.5 当前自动化验证结果为 **92 项通过，0 项失败**。自动化测试不会发送真实键盘事件，也不能替代目标硬件上的启动、权限、焦点、翻页和防火墙验收。

## 项目结构

```text
decktap/
├── client/                  # LAN 服务、配对、日志、键盘与窗口目标控制
│   ├── lan.js               # 命令行入口
│   ├── lan-service.js       # HTTP/WebSocket 服务生命周期
│   ├── media-targets.js     # 软件识别规则与候选目标
│   ├── target-monitor.js    # 放映窗口持续监控与自动重锁
│   ├── target-window.js     # 焦点保护和目标状态
│   └── trusted-client-store.js
├── electron/                # Electron 主进程、Preload 与 IPC
├── desktop/                 # React 桌面管理界面
├── decktap-web/             # React 手机控制页面
├── scripts/                 # 打包前与打包后验证脚本
├── test/                    # Node.js 单元和集成测试
├── docs/TEST-BUILDS.md      # 未签名测试包说明
├── forge.config.js          # Electron Forge 与 Fuses 配置
└── package.json
```

## 日志与故障排查

桌面客户端提供脱敏日志查看器和 **打开日志目录** 操作。命令行模式默认写入 `logs/decktap.log`，日志使用 JSON Lines 格式，单文件达到 2 MiB 后轮换，默认保留 5 个文件。

```bash
DECKTAP_LOG_LEVEL=debug npm run start:cli
DECKTAP_LOG_DIR=/path/to/logs npm run start:cli
```

遇到问题时，建议依次确认：

1. 手机与电脑是否处于同一私人局域网，且网络没有客户端隔离。
2. Windows 防火墙是否允许 DeckTap 访问专用网络。
3. macOS 是否已授予 DeckTap 辅助功能权限并重新启动应用。
4. 演示软件是否已经进入放映状态，而不是停留在编辑窗口。
5. 目标状态是否显示等待、丢失或锁定。
6. 将应用内复制的脱敏诊断摘要连同复现步骤提交给开发者。

## 测试版限制

- Windows 包没有 Authenticode 签名，目前仅提供便携 ZIP，没有安装器或自动更新。
- macOS 包没有 Developer ID 签名或 Apple 公证，并且是在 Linux 上交叉组装。
- 两个平台仍需在匹配硬件上完成真实启动、键盘控制、权限、防火墙、托盘和退出验证。
- PowerPoint/WPS 播放进程识别与自动重锁仍需结合不同 Office/WPS 版本进行真机验收。
- 桌面快捷目标已使用本地软件图标，但打包应用本身仍使用 Electron 默认可执行文件图标。

公开发行前，macOS 构建必须在 macOS 上完成 Developer ID 签名、Hardened Runtime 与公证；Windows 构建应完成 Authenticode 签名，并测试安装、升级、卸载和 SmartScreen 行为。

## 版本与许可

- [CHANGELOG.md](./CHANGELOG.md)：版本更新记录
- [docs/TEST-BUILDS.md](./docs/TEST-BUILDS.md)：测试包下载、校验与验收清单
- [docs/LOCAL-DEVELOPMENT.md](./docs/LOCAL-DEVELOPMENT.md)：本地 Codex 开发环境迁移与恢复
- [LICENSE](./LICENSE)：项目许可证

第三方软件名称、商标和图标归各自权利人所有。DeckTap 仅在本地快捷目标选择器中使用这些图标进行软件识别展示。
