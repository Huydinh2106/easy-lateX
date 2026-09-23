import type { SyncTeXForwardInput, SyncTeXInverseInput, SyncTeXResult } from "@easy-latex/shared-types";

export class SyncTeXManager {
  forward(input: SyncTeXForwardInput): Promise<SyncTeXResult> {
    void input;
    return Promise.resolve({ available: false, reason: "SyncTeX navigation is not enabled in this release" });
  }

  inverse(input: SyncTeXInverseInput): Promise<SyncTeXResult> {
    void input;
    return Promise.resolve({ available: false, reason: "SyncTeX navigation is not enabled in this release" });
  }
}
