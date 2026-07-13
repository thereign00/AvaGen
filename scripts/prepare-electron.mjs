// scripts/prepare-electron.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// 1. Copy static assets into standalone folder (.next/standalone/.next/static)
const staticSrc = path.join(root, ".next", "static");
const staticDest = path.join(root, ".next", "standalone", ".next", "static");

if (fs.existsSync(staticSrc)) {
  fs.cpSync(staticSrc, staticDest, { recursive: true });
  console.log("✓ Copied .next/static → standalone");
} else {
  console.error("✗ .next/static not found — did `next build` run?");
  process.exit(1);
}

// 2. Copy public directory if your app uses static files in /public
const publicSrc = path.join(root, "public");
const publicDest = path.join(root, ".next", "standalone", "public");

if (fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, publicDest, { recursive: true });
  console.log("✓ Copied public/ → standalone");
}

// 2.5 Remove dist-electron bloat from standalone directory
const distElectronInStandalone = path.join(root, ".next", "standalone", "dist-electron");
if (fs.existsSync(distElectronInStandalone)) {
  fs.rmSync(distElectronInStandalone, { recursive: true, force: true });
  console.log("✓ Removed dist-electron from standalone to reduce size");
}

// 3. Resolve all symlinks in standalone folder so electron-builder unpack works on Windows non-admin accounts
function dereferenceSymlinks(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (fs.lstatSync(fullPath).isSymbolicLink()) {
      try {
        const real = fs.realpathSync(fullPath);
        fs.unlinkSync(fullPath);
        fs.cpSync(real, fullPath, { recursive: true });
        console.log(`✓ Resolved symlink: ${path.relative(root, fullPath)}`);
      } catch (e) {
        console.warn(`! Could not resolve symlink ${fullPath}:`, e.message);
      }
    } else if (entry.isDirectory()) {
      dereferenceSymlinks(fullPath);
    }
  }
}

const standaloneDir = path.join(root, ".next", "standalone");
dereferenceSymlinks(standaloneDir);
console.log("✓ Dereferenced symlinks in .next/standalone");

// 4. Download standalone node.exe into standalone folder to match ABI 137
import https from "https";
const nodeExeUrl = "https://nodejs.org/dist/v24.16.0/win-x64/node.exe";
const nodeExePath = path.join(standaloneDir, "node.exe");

if (!fs.existsSync(nodeExePath)) {
  console.log("Downloading standalone node.exe (v24.16.0) to match ABI 137...");
  await new Promise((resolve, reject) => {
    https.get(nodeExeUrl, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download node.exe: ${res.statusCode}`));
      }
      const stream = fs.createWriteStream(nodeExePath);
      res.pipe(stream);
      stream.on("finish", () => {
        stream.close();
        resolve();
      });
      stream.on("error", reject);
    }).on("error", reject);
  });
  console.log("✓ Downloaded node.exe successfully");
} else {
  console.log("✓ node.exe already exists");
}
