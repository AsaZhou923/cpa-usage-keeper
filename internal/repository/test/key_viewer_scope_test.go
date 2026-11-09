package test

import (
	"context"
	"testing"
	"time"

	"cpa-usage-keeper/internal/entities"
	"cpa-usage-keeper/internal/repository"
)

func TestViewerIdentityScopeAppliesToRowsCountsAndQuotaAuthIndexes(t *testing.T) {
	db := openTestDatabase(t)
	identities := []entities.UsageIdentity{
		{Identity: "mine", AuthType: entities.UsageIdentityAuthTypeCredential, Type: "codex"},
		{Identity: "other", AuthType: entities.UsageIdentityAuthTypeCredential, Type: "claude"},
		{Identity: "wrong-auth-type", AuthType: entities.UsageIdentityAuthTypeCredential, Type: "kimi"},
	}
	if err := db.Create(&identities).Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := repository.InsertUsageEvents(db, requestEventFixtureWithZeroFees([]entities.UsageEvent{
		{EventKey: "scope-mine", Timestamp: time.Now(), APIGroupKey: "viewer-key", AuthIndex: "mine", AuthType: "oauth"},
		{EventKey: "scope-other", Timestamp: time.Now(), APIGroupKey: "other-key", AuthIndex: "other", AuthType: "oauth"},
		{EventKey: "scope-wrong-auth", Timestamp: time.Now(), APIGroupKey: "viewer-key", AuthIndex: "wrong-auth-type", AuthType: "apikey"},
	})); err != nil {
		t.Fatal(err)
	}
	authType := entities.UsageIdentityAuthTypeCredential
	request := repository.ListUsageIdentitiesPageRequest{AuthType: &authType, APIGroupKey: "viewer-key", Page: 1, PageSize: 10}
	rows, total, counts, err := repository.ListActiveUsageIdentitiesPage(context.Background(), db, request)
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(rows) != 1 || rows[0].Identity != "mine" || len(counts) != 1 || counts[0].Type != "codex" || counts[0].Count != 1 {
		t.Fatalf("viewer identity scope leaked rows or counts: rows=%+v total=%d counts=%+v", rows, total, counts)
	}
	indexes, err := repository.ListActiveUsageIdentityAuthIndexes(context.Background(), db, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(indexes) != 1 || indexes[0] != "mine" {
		t.Fatalf("viewer quota auth indexes escaped scope: %v", indexes)
	}
}
