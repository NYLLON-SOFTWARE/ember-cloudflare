import { app, BrowserWindow, nativeImage, nativeTheme, type NativeImage } from "electron";
import path from "node:path";

/** The app's icon in each appearance, as its windows show it on Windows and Linux. */
const ICONS = { light: path.join(import.meta.dirname, "icons", "app-icon-light.png"), dark: path.join(import.meta.dirname, "icons", "app-icon-dark.png") };

/**
 * Gives each window the app's icon in the system's appearance, light or dark, and changes every window's
 * as the appearance does, on Windows and Linux, where the title bar, the taskbar and the window switcher
 * show a window's own icon. A Mac's Dock shows the app's icon, which macOS draws in each appearance itself.
 */
export function followAppearance(): void {
  if (process.platform === "darwin") return;
  app.on("browser-window-created", (_event, window) => window.setIcon(iconNow()));
  nativeTheme.on("updated", () => {
    const icon = iconNow();
    for (const window of BrowserWindow.getAllWindows()) window.setIcon(icon);
  });
}

function iconNow(): NativeImage {
  return nativeImage.createFromPath(nativeTheme.shouldUseDarkColors ? ICONS.dark : ICONS.light);
}
