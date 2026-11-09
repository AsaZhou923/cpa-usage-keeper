package test

import (
	"testing"
	"time"

	"cpa-usage-keeper/internal/timeutil"
)

func TestFormatStorageTimeUsesProjectTimezoneOffset(t *testing.T) {
	useTimezone(t, "Asia/Shanghai")

	input := time.Date(2026, 5, 12, 13, 59, 18, 353569620, time.UTC)

	got := timeutil.FormatStorageTime(input)

	if got != "2026-05-12T21:59:18.35356962+08:00" {
		t.Fatalf("expected Asia/Shanghai RFC3339Nano storage time, got %q", got)
	}
}

func TestParseStorageTime(t *testing.T) {
	useTimezone(t, "Asia/Shanghai")
	for _, test := range []struct{ input, want string }{
		{"2026-05-12 13:47:39.744240399+00:00", "2026-05-12T21:47:39.744240399+08:00"},
		{"2026-05-12T13:47:39.744240399Z", "2026-05-12T21:47:39.744240399+08:00"},
		{"2026-05-12 13:47:39.744240399", "2026-05-12T13:47:39.744240399+08:00"},
		{"2026-05-12T13:47:39.744240399", "2026-05-12T13:47:39.744240399+08:00"},
	} {
		t.Run(test.input, func(t *testing.T) {
			parsed, err := timeutil.ParseStorageTime(test.input)
			if err != nil {
				t.Fatal(err)
			}
			if got := timeutil.FormatStorageTime(parsed); got != test.want {
				t.Fatalf("formatted time = %q, want %q", got, test.want)
			}
		})
	}
}

func TestTokyoBusinessTimePreservesStoredInstants(t *testing.T) {
	useTimezone(t, "Asia/Tokyo")
	instant := time.Date(2026, 11, 8, 15, 30, 0, 123, time.UTC)
	if got := timeutil.FormatStorageTime(instant); got != "2026-11-09T00:30:00.000000123+09:00" {
		t.Fatalf("Tokyo storage time = %q", got)
	}
	if got := timeutil.FormatSortableStorageTime(instant); got != "2026-11-08T15:30:00.000000123Z" {
		t.Fatalf("sortable UTC time = %q", got)
	}
	for _, stored := range []string{"2026-11-08T15:30:00.000000123Z", "2026-11-08T23:30:00.000000123+08:00"} {
		parsed, err := timeutil.ParseStorageTime(stored)
		if err != nil || !parsed.Equal(instant) {
			t.Fatalf("parse existing %q = %v, %v", stored, parsed, err)
		}
	}
	day, err := timeutil.ParseUsageQueryRange("today", "", "", "", instant)
	if err != nil {
		t.Fatal(err)
	}
	if got := day.StartTime.Format(time.RFC3339); got != "2026-11-09T00:00:00+09:00" {
		t.Fatalf("Tokyo business day start = %q", got)
	}
}
