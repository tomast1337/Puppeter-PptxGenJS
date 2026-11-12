#!/usr/bin/env sh
# `bun fmt` for the fmt:ts scripts. Bun < 1.4.4 has no formatter: there `bun fmt` runs the
# package's "fmt" script, which calls this again, forever. Fail fast instead.
set -eu
bun -e 'if (Bun.semver.order(Bun.version, "1.4.4") < 0) { console.error(`bun fmt needs Bun >= 1.4.4 (have ${Bun.version}); run: bun upgrade`); process.exit(1); }'
exec bun fmt --no-script "$@"
