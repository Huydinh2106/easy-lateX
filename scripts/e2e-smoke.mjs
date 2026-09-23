#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

const api = (process.env.E2E_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const repo = new URL("..", import.meta.url).pathname;
const terminal = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"]);
let projectId;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, init = {}, expected = 200) {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers
  });
  if (response.status !== expected) {
    throw new Error(`${init.method ?? "GET"} ${path}: expected ${expected}, got ${response.status}: ${await response.text()}`);
  }
  if (response.status === 204) return undefined;
  const type = response.headers.get("content-type") ?? "";
  return type.includes("application/json") ? response.json() : response;
}

const putSource = (version, content) => request(`/projects/${projectId}/files/content`, {
  method: "PUT", body: JSON.stringify({ path: "main.tex", expectedVersion: version, content })
});

async function buildUntil(expected, timeoutMs = 180_000) {
  const created = await request(`/projects/${projectId}/builds`, { method: "POST" }, 201);
  const maxPolls = Math.ceil(timeoutMs / 800);
  let current = created;
  for (let poll = 0; !terminal.has(current.status) && poll < maxPolls; poll += 1) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    current = await request(`/projects/${projectId}/builds/${created.id}`);
  }
  assert(current.status === expected, `build ${created.id} ended as ${current.status}; expected ${expected}`);
  return current;
}

async function waitReady() {
  const maxPolls = Math.ceil(90_000 / 800);
  for (let poll = 0; poll < maxPolls; poll += 1) {
    try { await request("/health/ready"); return; } catch { await new Promise((resolve) => setTimeout(resolve, 800)); }
  }
  throw new Error("API did not become ready after restart");
}

async function main() {
  await waitReady();
  const preflight = await fetch(`${api}/projects/example/files/content`, {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:3000",
      "access-control-request-method": "PUT",
      "access-control-request-headers": "content-type"
    }
  });
  assert(preflight.status === 204, `CORS preflight returned ${preflight.status}`);
  const methods = preflight.headers.get("access-control-allow-methods") ?? "";
  assert(["PUT", "PATCH", "DELETE"].every((method) => methods.includes(method)), `CORS methods are incomplete: ${methods}`);
  const project = await request("/projects", { method: "POST", body: JSON.stringify({ name: `E2E smoke ${new Date().toISOString()}` }) }, 201);
  projectId = project.id;
  console.log(`project=${projectId}`);

  const files = await request(`/projects/${projectId}/files`);
  assert(files.some((file) => file.path === "main.tex" && file.currentVersion === 1), "main.tex v1 was not created");
  const initial = await request(`/projects/${projectId}/files/content?path=main.tex`);
  assert(initial.content.includes("Start writing your document here."), "default canonical source is missing");

  const valid = String.raw`\documentclass{article}
\usepackage[utf8]{inputenc}
\begin{document}
\section{Real compile smoke test}
This source survived storage, revisioning, queueing, and a containerized LaTeX build.
\end{document}
`;
  const saved = await putSource(1, valid);
  assert(saved.version === 2 && !saved.deduplicated, "save did not create immutable version 2");
  const deduplicated = await putSource(2, valid);
  assert(deduplicated.version === 2 && deduplicated.deduplicated, "checksum deduplication failed");
  await request(`/projects/${projectId}/files/content`, { method: "PUT", body: JSON.stringify({ path: "main.tex", expectedVersion: 1, content: "stale" }) }, 409);

  await request(`/projects/${projectId}/files`, { method: "POST", body: JSON.stringify({ path: "chapters", kind: "DIRECTORY" }) }, 201);
  await request(`/projects/${projectId}/files`, { method: "POST", body: JSON.stringify({ path: "chapters/intro.tex", kind: "FILE", content: "Intro" }) }, 201);
  await request(`/projects/${projectId}/files`, { method: "PATCH", body: JSON.stringify({ path: "chapters", newPath: "content" }) });
  assert((await request(`/projects/${projectId}/files`)).some((file) => file.path === "content/intro.tex"), "folder move did not include descendants");

  const successful = await buildUntil("SUCCEEDED");
  const pdfResponse = await request(`/projects/${projectId}/builds/${successful.id}/pdf`);
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  assert(pdf.subarray(0, 4).toString() === "%PDF", "build artifact read from object storage is not a PDF");
  assert((await request(`/projects/${projectId}/revisions`)).some((revision) => revision.id === successful.revisionId), "immutable revision was not recorded");
  assert((await request(`/projects/${projectId}/history`)).some((operation) => operation.operationType === "REPLACE_FILE"), "document history is missing save metadata");
  console.log(`first_success=${successful.id} revision=${successful.revisionId} pdf_bytes=${pdf.length}`);

  const restarted = spawnSync("docker", ["compose", "restart", "api", "compile-worker"], { cwd: repo, stdio: "inherit" });
  assert(restarted.status === 0, "docker compose restart failed");
  await waitReady();
  assert((await request(`/projects/${projectId}/files/content?path=main.tex`)).content === valid, "source did not survive API/worker restart");
  const persistedPdf = await request(`/projects/${projectId}/builds/${successful.id}/pdf`);
  assert(Buffer.from(await persistedPdf.arrayBuffer()).subarray(0, 4).toString() === "%PDF", "PDF did not survive API/worker restart");

  const invalid = String.raw`\documentclass{article}
\begin{document}
\thiscommanddoesnotexist
\end{document}
`;
  await putSource(2, invalid);
  const failed = await buildUntil("FAILED");
  const log = await (await request(`/projects/${projectId}/builds/${failed.id}/log`)).text();
  assert(/Undefined control sequence|thiscommanddoesnotexist/i.test(log), "real LaTeX failure was not present in stored compile log");
  console.log(`expected_failure=${failed.id} log_bytes=${Buffer.byteLength(log)}`);

  await putSource(3, valid.replace("smoke test", "smoke test fixed"));
  const fixed = await buildUntil("SUCCEEDED");
  const fixedPdf = Buffer.from(await (await request(`/projects/${projectId}/builds/${fixed.id}/pdf`)).arrayBuffer());
  assert(fixedPdf.subarray(0, 4).toString() === "%PDF", "fixed source did not compile back to PDF");
  console.log(`fixed_success=${fixed.id} revision=${fixed.revisionId} pdf_bytes=${fixedPdf.length}`);

  if (process.env.E2E_KEEP_PROJECT !== "1") {
    await request(`/projects/${projectId}`, { method: "DELETE" }, 204);
    console.log("cleanup=project_deleted");
  } else console.log("cleanup=kept_by_E2E_KEEP_PROJECT");
  console.log("E2E_SMOKE_PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  console.error(projectId ? `failed_project=${projectId}` : "failed_before_project_creation");
  process.exitCode = 1;
});
