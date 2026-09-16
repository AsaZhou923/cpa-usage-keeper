package test

import (
	"reflect"
	"testing"
	"time"

	"cpa-usage-keeper/internal/service"
)

func TestDecodeRedisUsageMessagePreservesOptionalMetadata(t *testing.T) {
	type metadata struct {
		client       [3]*string
		requestTier  string
		responseTier string
	}
	for _, tc := range []struct {
		name    string
		message string
		want    metadata
	}{
		{
			name:    "populated",
			message: `{"request_id":"req-metadata","client_ip":"192.0.2.10","x_forwarded_for":"203.0.113.5, 198.51.100.8","user_agent":"test-client/1.0","service_tier":"auto","response_service_tier":"default","tokens":{}}`,
			want:    metadata{client: [3]*string{new("192.0.2.10"), new("203.0.113.5, 198.51.100.8"), new("test-client/1.0")}, requestTier: "auto", responseTier: "default"},
		},
		{
			name:    "missing",
			message: `{"request_id":"req-metadata-missing","service_tier":"auto","tokens":{}}`,
			want:    metadata{requestTier: "auto"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			event, _, err := service.DecodeRedisUsageMessage(tc.message, time.Date(2026, 7, 29, 1, 0, 0, 0, time.UTC))
			if err != nil {
				t.Fatalf("DecodeRedisUsageMessage: %v", err)
			}
			got := metadata{[3]*string{event.ClientIP, event.XForwardedFor, event.UserAgent}, event.ServiceTier, event.ResponseServiceTier}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("metadata = %+v, want %+v", got, tc.want)
			}
		})
	}
}
