import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
if (existsSync(path.join(root, "local-history.mjs"))) {
  for (const file of ["app.mjs", "core.mjs", "poster.mjs", "local-history.mjs", "cloud-sync.mjs", "snapshot.mjs", "state-content.mjs", "styles.css", "public/pku-football-logo.png"]) {
    const dest = path.resolve("public", file); mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(root, file), dest);
  }
  copyFileSync(path.join(root, "index.html"), path.resolve("index.html"));
  mkdirSync("tests", { recursive: true });
  for (const file of ["core.test.mjs", "local-history.test.mjs"]) {
    let source = readFileSync(path.join(root, file), "utf8");
    for (const module of ["core", "poster", "local-history", "state-content"]) source = source.replaceAll(`'./${module}.mjs'`, `'../public/${module}.mjs'`);
    writeFileSync(path.resolve("tests", file), source);
  }
}
