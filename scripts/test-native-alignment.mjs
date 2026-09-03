import { execFileSync } from "node:child_process";
import { join } from "node:path";

const project = join(process.cwd(), "native", "coreml-transcriber");
const sdk = execFileSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], {
  encoding: "utf8",
}).trim();
const environment = {
  ...process.env,
  CPLUS_INCLUDE_PATH: join(sdk, "usr", "include", "c++", "v1"),
};

execFileSync(
  "swift",
  ["build", "--package-path", project, "--product", "acoustic-alignment-test"],
  { env: environment, stdio: "inherit" }
);

const executable = join(project, ".build", "debug", "acoustic-alignment-test");
execFileSync("codesign", ["--force", "--sign", "-", executable], {
  stdio: "inherit",
});
execFileSync(executable, [], { stdio: "inherit" });
