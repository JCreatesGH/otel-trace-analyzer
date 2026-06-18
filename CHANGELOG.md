# Changelog

All notable changes are documented here, following
[Keep a Changelog](https://keepachangelog.com/) and [SemVer](https://semver.org/).

## [0.2.0]

### Added
- `byService()` — self-time grouped by service, surfaced in `analyze` output.
- `buildForest()` — retains every root of a multi-root trace (fixing data loss
  where all but the widest tree was dropped); `analyze` now counts and aggregates
  across the whole forest and reports `rootCount`.
- An `otel-trace-analyzer` CLI (critical path / slowest / by-service / N+1;
  `--json`; `--check` exits 1 on an N+1 pattern).

## [0.1.0]

### Added
- Load an OpenTelemetry trace and compute total duration, the critical path, the
  slowest span by self-time (merging overlapping children), and N+1 patterns.
