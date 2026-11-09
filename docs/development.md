# Development Guide

[Back to README](../README.md) · [简体中文](./development.zh.md)

See the README's [project structure](../README.md#project-structure) and [local development](../README.md#local-development) sections for layout and setup.

## Tests

Run the full verification baseline from the repository root:

```bash
make verify
```

Or run checks individually:

```bash
go test ./cmd/... ./internal/...
npm --prefix ./web run test
npm --prefix ./web run lint
npm --prefix ./web run typecheck
npm --prefix ./web run build
```

## Chart time handling

### Principles

- Business time is Tokyo (`Asia/Tokyo`, JST, UTC+9). Startup normalizes `TZ`; frontend business views use the same zone instead of the browser timezone. Keep canonical UTC storage and RFC3339 protocol timestamps unchanged. Generic calendar utilities still support explicit zones, including DST gaps and folds; rolling windows use elapsed durations.
- Identify buckets by an instant or full date and sort by instant. Formatted clock labels are for display only.
- Query fixes must not change stored aggregation boundaries. Preserve Overview and Latency's different hourly anchors, plus Activity's 364-block grid and stored bucket ends, to avoid changing the meaning of historical data.

### Shared Code

- Calendar-day calculations: `internal/timeutil.CivilDate` and `DayBounds`. Read aggregates through repository bucket adapters.
- Raw-event filtering: `internal/repository/usage_event_time_read.go`. Use bounded segments for ordinary queries and the open-ended reader for recent-cache startup/reload; callers retain field selection and cache lifecycle handling.
- Frontend labels: `web/src/utils/usage/timeLabels.ts`. Add timezone offsets only to ambiguous local clock labels, preserving locale, precision, fallback, and empty-point rules.

### Validation

Cover Tokyo midnight boundaries, offsetless timestamps, browser timezones that differ from Tokyo, and explicit-zone DST gaps and folds in generic utilities. Confirm that chart styles and lifecycle behavior remain unchanged.
