// electron/main.cjs
const { app, BrowserWindow, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");

const isDev = !app.isPackaged;
let mainWindow = null;
let serverProcess = null;

function getAppRoot() {
  return isDev ? path.join(__dirname, "..") : app.getAppPath();
}

// Dynamically find an available port on 127.0.0.1
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr !== "string") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("Could not determine port"));
      }
    });
    srv.on("error", reject);
  });
}

// Wait until the server is responsive
async function waitForServer(port, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}`);
      if (r.ok || r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server did not respond within ${timeout / 1000}s`);
}

// Spawn the Next.js standalone server
async function startServer() {
  const port = await findFreePort();
  const serverJs = path.join(getAppRoot(), ".next", "standalone", "server.js");

  const env = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
  };

  // Try spawning with 'node' first so native C++ modules (better-sqlite3) match system Node ABI.
  // If 'node' is unavailable on the machine, fallback to Electron's embedded Node runtime.
  let execBin = "node";
  console.log(`[Electron] Starting standalone server via ${execBin} (${serverJs}) on port ${port}`);

  serverProcess = spawn(execBin, [serverJs], {
    env,
    cwd: path.dirname(serverJs),
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.on("error", (err) => {
    console.warn(`[Electron] 'node' command not found or failed, falling back to embedded Node runtime:`, err.message);
    env.ELECTRON_RUN_AS_NODE = "1";
    serverProcess = spawn(process.execPath, [serverJs], {
      env,
      cwd: path.dirname(serverJs),
      stdio: ["ignore", "pipe", "pipe"],
    });
  });

  serverProcess.stdout.on("data", (data) => {
    console.log(`[Server] ${data.toString().trim()}`);
  });
  serverProcess.stderr.on("data", (data) => {
    console.error(`[Server Error] ${data.toString().trim()}`);
  });

  return port;
}

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "AvaGen",
    backgroundColor: "#0d0f12",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  // Open external links in user's default web browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.show();
}

app.whenReady().then(async () => {
  if (isDev) {
    // In dev mode, check if Next standalone exists or fall back to port 3001/3000
    const standaloneJs = path.join(getAppRoot(), ".next", "standalone", "server.js");
    if (fs.existsSync(standaloneJs)) {
      const port = await startServer();
      await waitForServer(port);
      await createWindow(port);
    } else {
      await createWindow(3001);
    }
  } else {
    // In production (.exe), start standalone server and connect
    const port = await startServer();
    await waitForServer(port);
    await createWindow(port);
    setupAutoUpdater();
  }
});

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    console.log(`[AutoUpdater] Update available: v${info.version}`);
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[AutoUpdater] Update downloaded: v${info.version}`);
    dialog
      .showMessageBox({
        type: "info",
        title: "Update Ready",
        message: `A new version of AvaGen (v${info.version}) has been downloaded. Would you like to restart and install the update now?`,
        buttons: ["Restart & Install", "Later"],
      })
      .then((res) => {
        if (res.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on("error", (err) => {
    console.error("[AutoUpdater Error]", err.message || err);
  });

  // Check for updates silently
  autoUpdater.checkForUpdatesAndNotify();
}

app.on("window-all-closed", () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== "darwin") app.quit();
});
