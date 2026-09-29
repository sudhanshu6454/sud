#!/bin/sh
# Build step shared by Dockerfile.api, Dockerfile.redirect and Dockerfile.workers.
#
#   sh docker/build-service.sh <api|redirect|workers>
#
# 1. compiles @paparazzi/shared (TypeScript-source-only in the repo) to
#    packages/shared/dist with declarations (docker/tsconfig.shared.json);
# 2. repoints packages/shared/package.json at dist/ — INSIDE THE IMAGE ONLY. The
#    repo keeps main = ./src/index.ts so tsx and vitest keep consuming TypeScript;
# 3. type-checks the service and emits it to packages/<name>/dist (CommonJS, the
#    module kind NodeNext picks for these packages), so `node dist/index.js` runs
#    with @paparazzi/shared resolved through the ordinary node_modules symlink.
set -eu
name="${1:?usage: build-service.sh <api|redirect|workers>}"
cd /app

pnpm --filter @paparazzi/shared exec tsc -p ../../docker/tsconfig.shared.json

node -e '
  const fs = require("node:fs");
  const file = "packages/shared/package.json";
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  pkg.main = "./dist/index.js";
  pkg.types = "./dist/index.d.ts";
  pkg.exports = {
    ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    "./package.json": "./package.json",
  };
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
'

pnpm --filter "@paparazzi/${name}" typecheck
pnpm --filter "@paparazzi/${name}" exec tsc -p tsconfig.json --noEmit false --rootDir src --outDir dist
test -f "packages/${name}/dist/index.js"
