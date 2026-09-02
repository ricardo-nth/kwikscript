#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error(
    "ReScript Punchy now requires an Apple-Silicon Mac for Core ML transcription."
  );
}

const project = join(process.cwd(), "native", "coreml-transcriber");
const sdk = execFileSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], {
  encoding: "utf8",
}).trim();
const result = spawnSync("swift", ["build", "-c", "release"], {
  cwd: project,
  env: {
    ...process.env,
    CPLUS_INCLUDE_PATH: join(sdk, "usr", "include", "c++", "v1"),
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
