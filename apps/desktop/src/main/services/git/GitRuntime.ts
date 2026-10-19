import path from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

/** Use the shipped Git and helpers, independently of PATH or inherited Git overrides. */
export function gitRuntime(inherited: NodeJS.ProcessEnv = process.env): { executable: string; env: NodeJS.ProcessEnv } {
  const clean = Object.fromEntries(Object.entries(inherited).filter(([key]) => !/^GIT_|^LOCAL_GIT_DIRECTORY$/i.test(key)));
  const resources=(process as NodeJS.Process & {resourcesPath?:string}).resourcesPath;
  const packaged=resources&&existsSync(path.join(resources,'app.asar'));
  const directory=packaged?path.join(resources,'git'):path.join(path.dirname(createRequire(path.join(process.cwd(),'package.json')).resolve('dugite/package.json')),'git');
  const windows=process.platform==='win32';
  const prefix=process.arch==='arm64'?'clangarm64':process.arch==='x64'?'mingw64':'mingw32';
  const env:NodeJS.ProcessEnv={...clean,GIT_EXEC_PATH:path.join(directory,...(windows?[prefix]:[]),'libexec','git-core')};
  if(windows)env.PATH=[path.join(directory,prefix,'bin'),path.join(directory,prefix,'usr','bin'),clean.PATH??''].join(path.delimiter);
  else {env.GIT_TEMPLATE_DIR=path.join(directory,'share','git-core','templates');env.GIT_CONFIG_SYSTEM=path.join(directory,'etc','gitconfig');}
  if (process.platform === 'linux') {env.GIT_SSL_CAINFO = path.join(directory, 'ssl', 'cacert.pem');env.PREFIX=directory;}
  return { executable: path.join(directory,windows?'cmd':'bin',windows?'git.exe':'git'), env };
}
