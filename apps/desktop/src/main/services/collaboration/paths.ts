export function validateSharedDirectory(value:string): string {
  const parts=value.split('/');
  if (!value || value.length>512 || value.includes('\\') || ([...value].some(c => c.charCodeAt(0) < 32) || /[<>:"|?*]/.test(value)) || parts.some(p=>!p || p==='.' || p==='..' || ['.git','.easy-latex','node_modules'].includes(p.toLowerCase()) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('Invalid project path');
  return value;
}
export function validateSourcePath(value:string, attachments=false): string {
  validateSharedDirectory(value);
  if (!(attachments?/\.(tex|bib|sty|cls|bst|ltx|md|txt|png|jpg|jpeg|svg|pdf|eps|otf|ttf|woff|woff2)$/i:/\.(tex|bib|sty|cls|bst|ltx|md|txt)$/i).test(value)) throw new Error(`Invalid source file path: ${value}. This file type is not supported for collaboration.`);
  return value;
}
