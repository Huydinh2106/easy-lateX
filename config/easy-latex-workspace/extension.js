const vscode = require("vscode");

const LATEX_LANGUAGE_IDS = new Set([
  "latex",
  "latex-expl3",
  "context",
  "doctex",
  "rsweave",
  "jlweave",
  "pweave",
]);

async function closeRestoredPdfTabs() {
  const pdfTabs = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.filter((tab) => {
      if (typeof tab.label === "string" && tab.label.toLowerCase().endsWith(".pdf")) {
        return true;
      }

      const input = tab.input;
      return Boolean(input && input.uri && input.uri.path.toLowerCase().endsWith(".pdf"));
    }),
  );

  if (pdfTabs.length > 0) {
    await vscode.window.tabGroups.close(pdfTabs, true);
  }
}

async function openMainDocument() {
  if (vscode.window.activeTextEditor) return;

  const [mainDocument] = await vscode.workspace.findFiles(
    "**/main.tex",
    "**/{.git,node_modules}/**",
    1,
  );

  if (mainDocument) {
    await vscode.window.showTextDocument(mainDocument, {
      preview: false,
      preserveFocus: false,
      viewColumn: vscode.ViewColumn.One,
    });
  }
}

async function prepareWorkspace() {
  await vscode.commands.executeCommand("workbench.view.explorer");
  await closeRestoredPdfTabs();
  await openMainDocument();
}

async function compileAndPreview() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !LATEX_LANGUAGE_IDS.has(editor.document.languageId)) {
    vscode.window.showInformationMessage("Open a LaTeX file before compiling.");
    return;
  }

  const availableCommands = await vscode.commands.getCommands(true);
  if (!availableCommands.includes("latex-workshop.build")) {
    vscode.window.showErrorMessage("LaTeX Workshop is not available in this workspace.");
    return;
  }

  await vscode.workspace.saveAll(false);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Compiling LaTeX…",
      cancellable: false,
    },
    async () => {
      await vscode.commands.executeCommand("latex-workshop.build");
    },
  );

  await vscode.commands.executeCommand("latex-workshop.view");
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "easy-latex.compileAndPreview",
      compileAndPreview,
    ),
  );

  void prepareWorkspace();
}

function deactivate() {}

module.exports = { activate, deactivate };
