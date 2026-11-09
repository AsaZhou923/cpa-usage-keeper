package test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	api "cpa-usage-keeper/internal/api"
	"cpa-usage-keeper/internal/auth"
	"cpa-usage-keeper/internal/entities"
	"cpa-usage-keeper/internal/repository"
	"cpa-usage-keeper/internal/service"
)

func TestKeyViewerLiveScopesSnapshotReplayAndRevokesInactiveKey(t *testing.T) {
	db := openAPITestDatabase(t)
	now := time.Now()
	if err := repository.SyncCPAAPIKeys(db, []string{"viewer-live-key", "other-live-key"}, now); err != nil {
		t.Fatal(err)
	}
	key, err := repository.FindActiveCPAAPIKeyByValue(db, "viewer-live-key")
	if err != nil {
		t.Fatal(err)
	}
	other, err := repository.FindActiveCPAAPIKeyByValue(db, "other-live-key")
	if err != nil {
		t.Fatal(err)
	}
	liveTestInsert(t, db, []entities.UsageEvent{
		{Timestamp: now.Add(-time.Minute), APIGroupKey: key.APIKey, Model: "mine"},
		{Timestamp: now.Add(-time.Minute), APIGroupKey: other.APIKey, Model: "private"},
	})
	sessions := auth.NewSessionManager(time.Hour)
	token, _, err := sessions.CreateAPIKeyViewer(key.ID)
	if err != nil {
		t.Fatal(err)
	}
	keys := &countingLiveCPAAPIKeyProvider{CPAAPIKeyProvider: service.NewCPAAPIKeyService(db), failure: errors.New("viewer must never list all API keys")}
	notifier := service.NewUsageEventsNotifier()
	gate := service.NewCostReadGate()
	config := api.AuthConfig{Enabled: true, LoginPassword: "secret", SessionTTL: time.Hour}
	router := api.NewRouter(nil, nil, service.NewUsageService(db, emptyPricingCatalogForTest()), nil, config, api.NewAuthHandler(config, sessions), "", api.OptionalProviders{CPAAPIKeys: keys, UsageEventsLive: notifier, CostReadGate: gate})
	server := httptest.NewServer(router)
	defer server.Close()
	headers := http.Header{"Cookie": []string{(&http.Cookie{Name: standardSessionCookieName, Value: token}).String()}}
	target := server.URL + "/api/v1/key-overview/events/live?range=24h&api_key_id=" + strconv.FormatInt(other.ID, 10)
	response, reader := liveTestConnect(t, &http.Client{Timeout: 8 * time.Second}, target, headers)
	defer response.Body.Close()
	snapshot := liveTestReadKind(t, reader, "snapshot")
	rows := snapshot.data["events"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["model"] != "mine" || snapshot.data["total_count"] != float64(1) {
		t.Fatalf("viewer snapshot leaked another key: %+v", snapshot.data)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	resume, err := gate.BlockAndDrain(ctx)
	if err != nil {
		t.Fatalf("idle viewer stream retained cost permit: %v", err)
	}
	resume()
	added := liveTestInsert(t, db, []entities.UsageEvent{
		{Timestamp: now.Add(-2 * time.Minute), APIGroupKey: key.APIKey, Model: "mine-late"},
		{Timestamp: now.Add(-2 * time.Minute), APIGroupKey: other.APIKey, Model: "private-late"},
	})
	notifier.NotifyUsageEventsCommitted(added)
	rows = liveTestReadKind(t, reader, "append").data["events"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["model"] != "mine-late" || keys.calls.Load() != 0 {
		t.Fatalf("viewer replay leaked another key or enumerated keys: %+v calls=%d", rows, keys.calls.Load())
	}
	if err := db.Model(&entities.CPAAPIKey{}).Where("id = ?", key.ID).Update("is_deleted", true).Error; err != nil {
		t.Fatal(err)
	}
	// Notifications coalesce at the committed ID high-water mark. A new commit
	// wakes the idle stream; replaying the previous notification does not.
	afterRevocation := liveTestInsert(t, db, []entities.UsageEvent{
		{Timestamp: now, APIGroupKey: key.APIKey, Model: "revoked-private"},
	})
	notifier.NotifyUsageEventsCommitted(afterRevocation)
	remaining, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("inactive key stream must close, got %v", err)
	}
	if strings.Contains(string(remaining), "revoked-private") {
		t.Fatalf("revoked key received a live event: %s", remaining)
	}
	if sessions.Validate(token) {
		t.Fatal("inactive key retained viewer session")
	}
}
