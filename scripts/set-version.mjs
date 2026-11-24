#!/usr/bin/env node
/**
 * Sets the release version everywhere it is recorded:
 *   package.json + package-lock.json (app), backend/package.json + lock,
 *   Android versionName/versionCode, iOS MARKETING_VERSION/CURRENT_PROJECT_VERSION.
 *
 * Usage: npm run version:set -- 0.2.0
 *
 * The native build number is derived from the version (major*10000 +
 * minor*100 + patch), so it always grows with the version. Minor and patch
 * must stay below 100 for that to hold.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
if (!match) {
  console.error("Usage: npm run version:set -- <major.minor.patch>");
  process.exit(1);
}
const [major, minor, patch] = match.slice(1).map(Number);
if (minor > 99 || patch > 99) {
  console.error("minor and patch must be below 100 (native build number)");
  process.exit(1);
}
const buildNumber = major * 10000 + minor * 100 + patch;

function edit(relative, change) {
  const path = join(root, relative);
  if (!existsSync(path)) {
    console.warn(`skip ${relative} (missing)`);
    return;
  }
  const before = readFileSync(path, "utf8");
  const after = change(before);
  if (after === before) {
    console.log(`unchanged ${relative}`);
    return;
  }
  writeFileSync(path, after);
  console.log(`updated ${relative}`);
}

function setPackageVersion(text) {
  const json = JSON.parse(text);
  json.version = version;
  if (json.packages?.[""]) json.packages[""].version = version;
  return JSON.stringify(json, null, 2) + "\n";
}

for (const file of ["package.json", "package-lock.json", "backend/package.json", "backend/package-lock.json"]) {
  edit(file, setPackageVersion);
}

edit("android/app/build.gradle", (text) =>
  text
    .replace(/versionCode \d+/, `versionCode ${buildNumber}`)
    .replace(/versionName "[^"]*"/, `versionName "${version}"`),
);

edit("ios/App/App.xcodeproj/project.pbxproj", (text) =>
  text
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${buildNumber};`),
);

console.log(`\nVersion ${version} (build ${buildNumber}). Next: update CHANGELOG.md, commit, open a PR.`);
