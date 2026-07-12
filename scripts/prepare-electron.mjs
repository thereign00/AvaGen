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
