import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const vitest = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const desktopDirectory = fileURLToPath(new URL("../../..", import.meta.url));
const child = spawn(process.execPath, [vitest, "run", "test/CompilerIntegration.spec.ts"], {
  cwd: desktopDirectory,
  env: { ...process.env, EASY_LATEX_COMPILER_INTEGRATION: "1" },
  shell: false,
  stdio: "inherit"
});
child.once("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.once("close", (code) => { process.exitCode = code ?? 1; });
