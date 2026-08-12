// Keep this as a monochrome transparent PNG. macOS template tray icons use the
// image alpha mask and can render colorful app icons as blank in the menu bar.
const TRAY_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAAxklEQVR4Ae3BsUkDUQAA0JfvKaRI4wJWWlwZBN1AzAYOYOEOJyK5DbJAGnsbv7iBhY3NFRJSuIaNxRWfHF/4BCyUvGfn7xrJe8JML2KCKcZYI2KBlR/syXuQHOMIBxjhEGe4wSfeZQTlOjyi09vHEjMZlTK3aCUN5nr3iAaCMq1NLZ71TnFuINjei6Q2EPySYHsXks5AUKaxqcGl3hteDVTKzHGFD5ygltzJqJSrUUu+cI0oo5IXMdOLmGCKMdaIWGBl5//5BkbkH+g/3mWJAAAAAElFTkSuQmCC';

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
