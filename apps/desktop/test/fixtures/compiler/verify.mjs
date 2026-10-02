import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const image = process.env.EASY_LATEX_DOCKER_IMAGE?.trim() || "easy-latex-compiler:2026.09.15";
const docker = process.env.EASY_LATEX_DOCKER_EXECUTABLE?.trim() || "docker";
const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));
const user = typeof process.getuid === "function" && typeof process.getgid === "function"
  ? `${process.getuid()}:${process.getgid()}`
  : undefined;

const validFixtures = [
  ["pdflatex-basic", "-pdf"],
  ["pdflatex-vietnamese", "-pdf"],
  ["xelatex-unicode", "-xelatex"],
  ["lualatex-unicode", "-lualatex"],
  ["bibtex", "-pdf"],
  ["biber", "-pdf"],
  ["packages", "-pdf"],
  ["multifile", "-pdf"]
];

function dockerRunArguments(workspace, output, containerName, engine) {
  return [
    "run", "--rm", "--name", containerName,
    "--network", "none",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", "256",
    "--memory", "2g",
    "--cpus", "2",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=256m,mode=1777",
    "--tmpfs", "/var/cache/biber:rw,nosuid,nodev,exec,size=256m,mode=1777",
    "--env", "HOME=/tmp",
    "--env", "PAR_GLOBAL_TMPDIR=/var/cache/biber",
    ...(user ? ["--user", user] : []),
    "--mount", `type=bind,source=${workspace},target=/workspace,readonly`,
    "--mount", `type=bind,source=${output},target=/output`,
    "--workdir", "/workspace",
    image,
    engine,
    "-interaction=nonstopmode",
    "-file-line-error",
    "-halt-on-error",
    "-synctex=1",
    "-no-shell-escape",
    "-outdir=/output",
    "main.tex"
  ];
}

function run(args, { timeout = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(docker, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Docker command timed out: ${args.join(" ")}`));
    }, timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function withOutput(callback) {
  const output = await mkdtemp(path.join(os.tmpdir(), "easy-latex-fixture-"));
  try {
    return await callback(output);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}

async function compileFixture(name, engine, expectSuccess = true) {
  return withOutput(async (output) => {
    const workspace = path.join(fixtureRoot, name);
    const containerName = `easy-latex-fixture-${randomUUID()}`;
    const result = await run(dockerRunArguments(workspace, output, containerName, engine));
    const log = await readFile(path.join(output, "main.log"), "utf8").catch(() => `${result.stdout}\n${result.stderr}`);
    const hasPdf = await access(path.join(output, "main.pdf")).then(() => true).catch(() => false);
    if (expectSuccess && (result.code !== 0 || !hasPdf)) {
      const details = `${log}\n${result.stdout}\n${result.stderr}`;
      throw new Error(`${name} failed (exit ${String(result.code)}):\n${details.slice(-12_000)}`);
    }
    if (!expectSuccess && (result.code === 0 || hasPdf)) {
      throw new Error(`${name} unexpectedly compiled successfully`);
    }
    process.stdout.write(`PASS ${name} (${engine})\n`);
    return log;
  });
}

async function waitUntilRunning(containerName) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const inspected = await run(["inspect", "--format", "{{.State.Running}}", containerName], { timeout: 5_000 });
    if (inspected.code === 0 && inspected.stdout.trim() === "true") return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Cancellation fixture container did not start");
}

async function verifyCancellation() {
  await withOutput(async (output) => {
    const workspace = path.join(fixtureRoot, "cancel");
    const containerName = `easy-latex-cancel-${randomUUID()}`;
    const started = Date.now();
    const compile = run(dockerRunArguments(workspace, output, containerName, "-pdf"), { timeout: 30_000 });
    await waitUntilRunning(containerName);
    const stopped = await run(["stop", "--time", "2", containerName], { timeout: 10_000 });
    if (stopped.code !== 0) throw new Error(`Could not stop compile container: ${stopped.stderr}`);
    const result = await compile;
    if (result.code === 0) throw new Error("Cancelled compile exited successfully");
    if (Date.now() - started > 15_000) throw new Error("Cancellation took too long");
    process.stdout.write("PASS cancel (active container stopped)\n");
  });
}

const imageStatus = await run(["image", "inspect", image], { timeout: 30_000 });
if (imageStatus.code !== 0) {
  throw new Error(`Compiler image ${image} is unavailable. Run npm run compiler:build first.\n${imageStatus.stderr}`);
}

for (const [name, engine] of validFixtures) await compileFixture(name, engine);
const brokenLog = await compileFixture("broken", "-pdf", false);
if (!/easy-latex-intentionally-missing\.sty[^\n]*not found/i.test(brokenLog)) {
  throw new Error("Broken fixture did not retain its missing-package root cause");
}
await verifyCancellation();
