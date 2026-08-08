// A small embedded PNG keeps the tray available before platform icon assets
// are copied into a packaged app. NativeImage documents PNG data URLs on all
// supported desktop platforms.
const TRAY_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUEAYAAADdGcFOAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAHdElNRQfqCAgEDRrBCt6BAAACA0lEQVRIx2NgGAWUAUZCCpSVMzJevLCph/AyYyB0lAp1rF92B0JPX3L37owZEhJHGol2IMRhk65BeLma9AmvydchDs3Tgokw4Q8xejkMBnI1Ue3H4kAIgEXlQAGE/TgcSK00Ri5A2M9CqtZbztPOiV9kYGCayXiSwY2B4V/6f3OGXQwM3yp/lv1nZGB4tP610d+rDAzbHc4J/EhlYJjTvpv7Wz0Dw+9zf/P/l5LuVCbStaCChbv2zfnGzcCww/6c4M9UBgaZHcJszM8YGIoN/QV5uBkYZmlnXRSQY2BgvMc4g0F8ABw4LWxH1dcvDAwVrItXfzzJwODp0Dzx7VMGhk/u357+L2NgsK3XMmXLY2Cwt9JOY58zAA5EBy/nfvj8t4+B4VDjtdO/JiHEjSWVhVkjBoED4QbvYTRg0EPw/yv/T2d4OQgcKJ4swMtcxMBgu0BrLls4QvzckXttv/eTbh7JuRgdZK3yaOPmYWDgUeAMZlJgYHA/YLCfPZeBgfcOpzRjMQPDYWhUHzx2ddbPPAYGBiWGDFJCkmIHxrs5pXB9ZWD4Hv5L4f8pBobHvW+0/r5hYJizZk/lTx4GhtlXdxV9zWBg+K/0nySHwQBGXQypapbehvAGqsBedgdSJ0er4kiD05cMjMMw7R96rRkYQFVo2wChYe03agGYebYN6A4bMgAA9YS8/KUQF2YAAAAASUVORK5CYII=';

function createTrayController(options = {}) {
  const Tray = options.Tray;
  const Menu = options.Menu;
  const nativeImage = options.nativeImage;
  const platform = options.platform || process.platform;
  const showWindow = options.showWindow || (() => {});
  const toggleService = options.toggleService || (() => {});
  const quit = options.quit || (() => {});

  if (typeof Tray !== 'function' || !Menu?.buildFromTemplate || !nativeImage?.createFromDataURL) {
    throw new TypeError('Electron tray dependencies are required');
  }

  let tray = null;

  function buildMenu(snapshot) {
    const running = snapshot.serviceState === 'running';
    const targetLabel = snapshot.target?.status === 'locked'
      ? `控制目标：${snapshot.target.appName || '已锁定软件'}`
      : snapshot.target?.status === 'lost' ? '控制目标：已丢失' : '控制目标：未锁定';
    return [
      { label: '打开 DeckTap', click: showWindow },
      { type: 'separator' },
      { label: running ? '局域网服务运行中' : '局域网服务已停止', enabled: false },
      { label: running ? '停止控制服务' : '启动控制服务', click: () => toggleService(running) },
      { label: `已连接设备：${snapshot.connectedClients || 0} 台`, enabled: false },
      { label: targetLabel, enabled: false },
      { type: 'separator' },
      { label: '退出 DeckTap', click: quit },
    ];
  }

  function refresh(snapshot) {
    if (!tray || !snapshot) return;
    tray.setToolTip(`DeckTap · ${snapshot.serviceState === 'running' ? '服务运行中' : '服务已停止'} · ${snapshot.connectedClients || 0} 台设备`);
    tray.setContextMenu(Menu.buildFromTemplate(buildMenu(snapshot)));
  }

  function start(snapshot) {
    if (tray) {
      refresh(snapshot);
      return;
    }
    const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
    if (typeof icon.isEmpty === 'function' && icon.isEmpty()) {
      throw new Error('The DeckTap tray icon could not be decoded');
    }
    if (platform === 'darwin' && typeof icon.setTemplateImage === 'function') icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.on('click', showWindow);
    refresh(snapshot);
  }

  function destroy() {
    if (!tray) return;
    tray.destroy();
    tray = null;
  }

  return {
    destroy,
    isStarted: () => tray !== null,
    refresh,
    start,
  };
}

module.exports = { TRAY_ICON_DATA_URL, createTrayController };
