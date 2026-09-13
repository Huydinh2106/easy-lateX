import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const extensionsRoot = "/home/coder/.local/share/code-server/extensions";
const extensionDirectories = (await readdir(extensionsRoot))
  .filter((entry) => entry.startsWith("james-yu.latex-workshop-"))
  .sort();

const extensionDirectory = extensionDirectories.at(-1);

if (!extensionDirectory) {
  console.warn("LaTeX Workshop is not installed; skipping toolbar customization.");
  process.exit(0);
}

const manifestPath = path.join(extensionsRoot, extensionDirectory, "package.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const editorTitle = manifest.contributes?.menus?.["editor/title"];

if (Array.isArray(editorTitle)) {
  manifest.contributes.menus["editor/title"] = editorTitle.filter(
    (item) =>
      item.command !== "latex-workshop.build" &&
      item.command !== "latex-workshop.view",
  );
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
