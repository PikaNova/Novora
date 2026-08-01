const { rmSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

const outputDir = ".backfill-check";
rmSync(outputDir, { recursive: true, force: true });

try {
  const compile = spawnSync(
    process.execPath,
    ["./node_modules/typescript/bin/tsc", "-p", "tsconfig.backfill.json"],
    { stdio: "inherit" },
  );
  if (compile.error || compile.status !== 0) {
    if (compile.error) console.error(compile.error);
    process.exitCode = compile.status || 1;
  } else {
    const run = spawnSync(
      process.execPath,
      [".backfill-check/scripts/backfillTrackClassIds.js", ...process.argv.slice(2)],
      { stdio: "inherit", env: process.env },
    );
    if (run.error) console.error(run.error);
    process.exitCode = run.status || (run.error ? 1 : 0);
  }
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}
