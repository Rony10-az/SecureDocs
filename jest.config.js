/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  setupFiles: ["<rootDir>/tests/setup-env.ts"],
  transform: {
    "^.+\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
  },
};
