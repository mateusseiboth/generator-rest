#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const tsxBinary = path.join(currentDir, "node_modules", ".bin", "tsx");
const entrypoint = path.join(currentDir, "index.ts");

const result = spawnSync(tsxBinary, [entrypoint], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
