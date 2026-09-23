import { readConfig } from "../src/common/config";

describe("authentication configuration", () => {
  it("allows credential-free development auth outside production", () => {
    expect(readConfig({ DATABASE_URL: "postgresql://test", NODE_ENV: "development", AUTH_MODE: "development" }).authMode).toBe("development");
  });

  it("fails startup when development auth is selected in production", () => {
    expect(() => readConfig({ DATABASE_URL: "postgresql://test", NODE_ENV: "production", AUTH_MODE: "development" })).toThrow(/forbidden/i);
  });
});
