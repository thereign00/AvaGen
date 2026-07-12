import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.GH_TOKEN || process.argv[2];
const OWNER = "thereign00";
const REPO = "AvaGen";

if (!TOKEN) {
  console.error("Error: GH_TOKEN is required to publish a GitHub Release.");
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
const version = pkg.version;
const tag = `v${version}`;

const distDir = path.resolve("dist-electron");
if (!fs.existsSync(distDir)) {
  console.error("Error: dist-electron directory not found. Build the app first.");
  process.exit(1);
}

const filesToUpload = fs.readdirSync(distDir).filter(f => 
  f.endsWith(".exe") || f.endsWith(".yml") || f.endsWith(".blockmap")
);

if (filesToUpload.length === 0) {
  console.error("No installer (.exe or .yml) files found in dist-electron.");
  process.exit(1);
}

async function run() {
  console.log(`[GitHub Release] Checking if release ${tag} exists on ${OWNER}/${REPO}...`);
  
  let releaseId = null;
  let uploadUrlTemplate = null;

  // Check if release exists
  const checkRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${tag}`, {
    headers: {
      Authorization: `token ${TOKEN}`,
      "User-Agent": "AvaGen-Publisher",
    },
  });

  if (checkRes.ok) {
    const existing = await checkRes.json();
    console.log(`[GitHub Release] Release ${tag} already exists (ID: ${existing.id}).`);
    releaseId = existing.id;
    uploadUrlTemplate = existing.upload_url;
  } else {
    console.log(`[GitHub Release] Creating new release ${tag}...`);
    const createRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
      method: "POST",
      headers: {
        Authorization: `token ${TOKEN}`,
        "User-Agent": "AvaGen-Publisher",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tag_name: tag,
        name: `AvaGen ${tag} Standalone AI Video Studio`,
        body: `Official Standalone Desktop Release of AvaGen ${tag}.\n\n### Installation:\n- Download and run **AvaGen Setup ${version}.exe** to install or update AvaGen.`,
        draft: false,
        prerelease: false,
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create release: ${createRes.status} ${err}`);
    }

    const created = await createRes.json();
    console.log(`[GitHub Release] Created release ${tag} (ID: ${created.id}).`);
    releaseId = created.id;
    uploadUrlTemplate = created.upload_url;
  }

  // Clean upload URL (remove {?name,label})
  const baseUploadUrl = uploadUrlTemplate.split("{")[0];

  // Upload each file
  for (const file of filesToUpload) {
    const filePath = path.join(distDir, file);
    const stats = fs.statSync(filePath);
    console.log(`[GitHub Release] Uploading ${file} (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`);

    const fileStream = fs.readFileSync(filePath);
    const contentType = file.endsWith(".exe") ? "application/octet-stream" : "text/plain";

    const uploadRes = await fetch(`${baseUploadUrl}?name=${encodeURIComponent(file)}`, {
      method: "POST",
      headers: {
        Authorization: `token ${TOKEN}`,
        "User-Agent": "AvaGen-Publisher",
        "Content-Type": contentType,
        "Content-Length": String(stats.size),
      },
      body: fileStream,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.warn(`[Warning] Failed to upload ${file}: ${uploadRes.status} ${errText}`);
    } else {
      console.log(`[GitHub Release] Successfully uploaded ${file}!`);
    }
  }

  console.log(`\n🎉 Release ${tag} published successfully!`);
  console.log(`👉 https://github.com/${OWNER}/${REPO}/releases/tag/${tag}`);
}

run().catch(err => {
  console.error("[Fatal Error]", err);
  process.exit(1);
});
