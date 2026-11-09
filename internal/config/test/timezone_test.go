package test

import (
	"os"
	"testing"
	"time"

	"cpa-usage-keeper/internal/config"
)

func TestDefaultTimeZoneIsLoadable(t *testing.T) {
	if config.DefaultTimeZone != "Asia/Tokyo" {
		t.Fatalf("default timezone = %q, want Asia/Tokyo", config.DefaultTimeZone)
	}
	location, err := time.LoadLocation(config.DefaultTimeZone)
	if err != nil {
		t.Fatalf("expected default timezone %s to be loadable: %v", config.DefaultTimeZone, err)
	}
	if location.String() != config.DefaultTimeZone {
		t.Fatalf("expected location %s, got %s", config.DefaultTimeZone, location)
	}
}

func TestLoadFromEnvNormalizesProjectTimeZone(t *testing.T) {
	for _, value := range []string{"", "Asia/Tokyo", "Asia/Shanghai", "UTC", "America/New_York", "Local", "Not/AZone"} {
		t.Run(value, func(t *testing.T) {
			isolateConfigEnv(t)
			setRequiredConfig(t)
			t.Setenv("TZ", value)
			if _, err := config.LoadFromEnv(); err != nil {
				t.Fatalf("LoadFromEnv: %v", err)
			}
			if got := time.Local.String(); got != "Asia/Tokyo" {
				t.Fatalf("time.Local = %q, want Asia/Tokyo", got)
			}
			if got := os.Getenv("TZ"); got != "Asia/Tokyo" {
				t.Fatalf("TZ = %q, want Asia/Tokyo", got)
			}
			instant := time.Date(2026, 11, 8, 15, 0, 0, 0, time.UTC)
			if got := instant.In(time.Local).Format(time.RFC3339); got != "2026-11-09T00:00:00+09:00" {
				t.Fatalf("project day boundary = %q, want Tokyo midnight", got)
			}
		})
	}
}
