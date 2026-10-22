import type { ForgeConfig } from "@electron-forge/shared-types";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { normalizeApiUrl } from './src/main/services/account/ApiConfiguration';

let releaseConfiguration=path.resolve(__dirname,'resources/desktop-config.json');
if(process.env.EASY_LATEX_RELEASE_API_URL){
  releaseConfiguration=path.resolve(__dirname,'../../.local/desktop-release/desktop-config.json');
  mkdirSync(path.dirname(releaseConfiguration),{recursive:true});
  writeFileSync(releaseConfiguration,JSON.stringify({apiUrl:normalizeApiUrl(process.env.EASY_LATEX_RELEASE_API_URL)}));
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Sign after Packager has finalized Info.plist and ASAR integrity. The fuse
    // plugin's early arm64 ad-hoc signature is otherwise invalidated later.
    // Local ad-hoc signing is not a substitute for Developer ID/notarization.
    osxSign: process.env.EASY_LATEX_MAC_SIGN_IDENTITY?.trim()
      ? { identity: process.env.EASY_LATEX_MAC_SIGN_IDENTITY.trim() }
      : { identity: '-', identityValidation: false, preAutoEntitlements: false, preEmbedProvisioningProfile: false,
          // Hardened runtime requires a shared Developer ID team for dylibs.
          // Ad-hoc local builds have no team; signed releases keep the default.
          optionsForFile: () => ({ hardenedRuntime: false }) },
    extraResource: [releaseConfiguration,path.resolve(__dirname,'resources/licenses'),path.join(path.dirname(createRequire(__filename).resolve('dugite/package.json')),'git')],
    executableName: "easy-latex",
    name: "Easy LaTeX"
  },
  rebuildConfig: {},
  makers: [
    { name: "@electron-forge/maker-squirrel", config: { name: "easy_latex" } },
    { name: "@electron-forge/maker-zip", platforms: ["darwin"], config: {} },
    { name: "@electron-forge/maker-deb", config: {} }
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: "src/main/index.ts", config: "vite.main.config.ts", target: "main" },
        { entry: "src/preload/index.ts", config: "vite.preload.config.ts", target: "preload" }
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }]
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
};

export default config;
