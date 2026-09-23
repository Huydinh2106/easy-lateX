import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#047857", fontWeight: "500" },
  { tag: tags.heading, color: "#171717", fontWeight: "600" },
  { tag: tags.string, color: "#1d4ed8" },
  { tag: tags.comment, color: "#737373", fontStyle: "italic" },
  { tag: tags.atom, color: "#7c3aed" },
  { tag: tags.bracket, color: "#525252" }
]);

export const easyLatexEditorTheme = [
  EditorView.theme({
    "&": {
      height: "100%",
      color: "var(--color-text-primary)",
      backgroundColor: "var(--color-bg-surface)",
      fontFamily: "var(--font-mono)",
      fontSize: "13px"
    },
    ".cm-scroller": { overflow: "auto", lineHeight: "1.65" },
    ".cm-content": { padding: "16px 0 40px" },
    ".cm-line": { padding: "0 16px" },
    ".cm-gutters": {
      color: "var(--color-text-disabled)",
      backgroundColor: "var(--color-bg-surface)",
      borderRight: "1px solid var(--color-border-subtle)"
    },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--color-bg-subtle)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--color-selection) !important" },
    ".cm-cursor": { borderLeftColor: "var(--color-accent)" },
    ".cm-tooltip": {
      backgroundColor: "var(--color-bg-surface)",
      border: "1px solid var(--color-border-default)",
      borderRadius: "var(--radius-panel)",
      boxShadow: "var(--shadow-popover)"
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      color: "var(--color-text-primary)",
      backgroundColor: "var(--color-accent-soft)"
    },
    "&.cm-focused": { outline: "none" }
  }),
  syntaxHighlighting(highlightStyle)
];
