import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpc, disposeIpc } from "./ipc.js";
import { maybeRunAgentSdkSmoke } from "./agent-sdk-smoke.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0b0b0c",
    title: "Maestro",
    webPreferences: {
      preload: path.join(dirname, "../preload/index.js"),
      // The renderer is a plain SPA with no node access — every filesystem touch goes through
      // the typed IPC bridge in ../shared/ipc.ts. Both flags are asserted by a test.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.on("ready-to-show", () => win.show());

  // External links open in the user's browser, never inside the app frame.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(dirname, "../renderer/index.html"));
  }

  return win;
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  // Off unless MAESTRO_AGENT_SDK_SMOKE is set, and never awaited: the window must paint whether or
  // not a diagnostic query is in flight behind it.
  void maybeRunAgentSdkSmoke();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", disposeIpc);
