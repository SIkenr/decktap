# DeckTap 本地开发环境

本文档用于把 DeckTap 从 Codex 云端工作区迁移到 macOS 或 Windows 上的本地 Codex。仓库通过锁文件固定 JavaScript 依赖，并通过 `.nvmrc` 记录已验证的 Node.js 版本。

## 可随仓库迁移的内容

- 源代码、测试、构建脚本和 Electron Forge 配置
- 根项目与手机 Web 控制器的 `package-lock.json`
- 已验证的 Node.js 版本：`24.14.0`
- Codex 本地环境的 Setup 和常用 Actions

以下内容必须在目标电脑重新生成或重新授权：

- `node_modules`、`.vite`、`out` 和其他构建缓存
- macOS 辅助功能权限、Windows 防火墙权限
- GitHub 登录、签名证书、公证凭据和其他密钥
- `.env`、`.env.local` 等未纳入 Git 的本机配置

## 首次创建本地项目

```bash
mkdir -p ~/Projects
cd ~/Projects
git clone --branch codex/media-target-recognition --single-branch \
  https://github.com/SIkenr/decktap.git DeckTap
cd DeckTap
```

如果使用 `nvm`：

```bash
nvm install
nvm use
```

安装锁定依赖并完成打包前验证：

```bash
npm ci
npm --prefix decktap-web ci
npm run verify:prepack
```

## 配置 Codex 本地环境

在 ChatGPT 桌面端选择 **Codex**，打开 `~/Projects/DeckTap`，然后在项目设置中创建本地环境。

Setup 脚本：

```bash
npm ci
npm --prefix decktap-web ci
npm run build
```

建议添加以下 Actions：

| 名称 | 命令 | 用途 |
| --- | --- | --- |
| 启动 DeckTap | `npm start` | 构建 Web 控制器并启动 Electron 客户端 |
| 运行测试 | `npm test` | 运行 Node.js 单元与集成测试 |
| 完整验证 | `npm run verify:prepack` | 测试、Lint、构建和打包前检查 |
| 本机打包 | `npm run package` | 生成当前操作系统和架构的应用目录 |

Codex 桌面端生成环境文件后，可以将根目录 `.codex` 中不含凭据的配置提交到 Git，使后续工作树自动复用相同 Setup 和 Actions。

## 本地运行注意事项

macOS 首次运行 DeckTap 后，需要在 **系统设置 → 隐私与安全性 → 辅助功能** 中授权 DeckTap；命令行模式则授权正在使用的终端。权限、Developer ID 证书和公证凭据不应提交到仓库。

Windows 首次启动局域网服务时，仅允许 DeckTap 通过专用网络防火墙。打包和原生键盘控制必须在目标系统和目标架构上验证，不能用其他平台的构建结果代替。
