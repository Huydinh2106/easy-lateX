import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";

export const latexLanguage = StreamLanguage.define(stex);
