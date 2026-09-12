# Changelog

All notable changes to `@genoventures-labs/namethis` are documented here.

## 0.3.1

### Fixed

- Bound `--crawl` context to stay within smaller local model limits (token/char budgets, tighter crawl caps).
- Align ModelHitch credential routing with Dirgest: only pass an explicit `--key` to `chat()`, so gateway lanes use `AI_GATEWAY_API_KEY` instead of unrelated env keys (fixes `invalid-api-key` on Vercel AI Gateway).
- Clearer errors for context overflow vs credential failures.

## 0.3.0

### Added

- `--crawl` flag for bounded deep directory scans (depth, file count, and excerpt limits) for richer naming context.
- Programmatic `crawl` option on `generateNames()`.
