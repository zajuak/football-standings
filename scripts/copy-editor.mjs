import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
// Synchronize the original local editor when present. Standalone source checkouts
// already contain these synchronized files and build without the parent project.
if (existsSync(path.join(root, "records-api.mjs"))) {
  for (const file of ["app.mjs", "core.mjs", "poster.mjs", "sync.mjs", "snapshot.mjs", "styles.css", "public/pku-football-logo.png"]) {
    const dest = path.resolve("public", file);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(root, file), dest);
  }
  mkdirSync("lib/server", { recursive: true });
  for (const file of ["records-api.mjs", "core.mjs", "snapshot.mjs"]) copyFileSync(path.join(root, file), path.resolve("lib/server", file));
  copyFileSync(path.join(root, "index.html"), path.resolve("editor.html"));
  mkdirSync("tests", { recursive: true });
  for (const file of ["core.test.mjs", "records.test.mjs"]) {
    let source = readFileSync(path.join(root, file), "utf8");
    for (const module of ["core", "poster", "sync"]) source = source.replaceAll(`'./${module}.mjs'`, `'../public/${module}.mjs'`);
    source = source.replaceAll("'./records-api.mjs'", "'../lib/server/records-api.mjs'");
    writeFileSync(path.resolve("tests", file), source);
  }
}
