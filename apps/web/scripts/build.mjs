import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const assetsDir = path.join(distDir, "assets");
const publicDir = path.join(rootDir, "public");
const esbuildBin = path.join(rootDir, "node_modules", "esbuild", "bin", "esbuild");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });

const buildResult = spawnSync(
  process.execPath,
  [
    esbuildBin,
    "src/main.jsx",
    "--bundle",
    "--format=esm",
    "--platform=browser",
    "--target=es2020",
    "--jsx=automatic",
    "--outfile=dist/assets/app.js",
    "--loader:.js=jsx",
    "--loader:.jsx=jsx",
    "--loader:.css=css",
    "--loader:.png=file",
    "--loader:.jpg=file",
    "--loader:.jpeg=file",
    "--loader:.gif=file",
    "--loader:.svg=file",
    "--loader:.webp=file",
    "--loader:.woff=file",
    "--loader:.woff2=file",
    "--loader:.ttf=file",
    "--loader:.eot=file",
    '--define:process.env.NODE_ENV="production"',
  ],
  {
    cwd: rootDir,
    stdio: "inherit",
  }
);

if (buildResult.status !== 0) {
  throw new Error(`esbuild failed with exit code ${buildResult.status ?? "unknown"}`);
}

if (existsSync(publicDir)) {
  cpSync(publicDir, distDir, { recursive: true });
}

const jsPath = path.join(assetsDir, "app.js");
const cssPath = path.join(assetsDir, "app.css");

if (!existsSync(jsPath)) {
  throw new Error("entry bundle not found");
}
const jsHref = "/assets/app.js";
const cssHref = existsSync(cssPath) ? "/assets/app.css" : "";

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ANTA COMMERCE INTELLIGENCE</title>
  ${cssHref ? `<link rel="stylesheet" href="${cssHref}">` : ""}
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${jsHref}"></script>
</body>
</html>
`;

writeFileSync(path.join(distDir, "index.html"), html, "utf8");

console.log("build complete");
console.log(`entry: ${jsHref}`);
if (cssHref) {
  console.log(`css: ${cssHref}`);
}
