import type { DesktopApi } from "@easy-latex/shared-types";

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}

export {};
