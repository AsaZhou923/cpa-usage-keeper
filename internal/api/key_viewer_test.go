package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"cpa-usage-keeper/internal/auth"
	"cpa-usage-keeper/internal/entities"
	"cpa-usage-keeper/internal/quota"
	"cpa-usage-keeper/internal/service"
	servicedto "cpa-usage-keeper/internal/service/dto"
)

func newKeyViewerRouteTestRouter(t *testing.T, usageProvider service.UsageProvider, providers OptionalProviders) (*httptest.ResponseRecorder, *http.Cookie, http.Handler) {
	t.Helper()
	sessions := auth.NewSessionManager(time.Hour)
	token, _, err := sessions.CreateAPIKeyViewer(42)
	if err != nil {
		t.Fatalf("CreateAPIKeyViewer returned error: %v", err)
	}
	config := AuthConfig{Enabled: true, LoginPassword: "secret", SessionTTL: time.Hour}
	handler := NewAuthHandler(config, sessions)
	providers.CPAAPIKeys = &authCPAAPIKeyStub{row: entities.CPAAPIKey{
		ID:         42,
		APIKey:     "raw-viewer-key",
		DisplayKey: "sk-*********viewer",
		KeyAlias:   "Viewer Key",
	}}
	return httptest.NewRecorder(), &http.Cookie{Name: sessionCookieName, Value: token}, NewRouter(nil, nil, usageProvider, nil, config, handler, "", providers)
}

func TestKeyOverviewEventsForceCurrentViewerAPIKey(t *testing.T) {
	eventTime := time.Date(2026, 6, 29, 8, 57, 49, 0, time.UTC)
	usageProvider := &usageFilterStub{eventsPage: &servicedto.UsageEventsPage{
		Events: []servicedto.UsageEventRecord{{
			ID:          7,
			Timestamp:   eventTime,
			APIGroupKey: "raw-viewer-key",
			Model:       "gpt-5.5",
			Endpoint:    "/responses",
			AuthType:    "oauth",
			Source:      "xavierzhou23@gmail.com",
			AuthIndex:   "auth-1",
			TotalTokens: 121443,
		}},
		TotalCount: 1,
		Page:       1,
		PageSize:   20,
		TotalPages: 1,
	}}
	identityProvider := usageIdentitiesStub{items: []entities.UsageIdentity{{
		ID:           1,
		Name:         "Codex Account",
		AuthType:     entities.UsageIdentityAuthTypeAuthFile,
		AuthTypeName: "oauth",
		Identity:     "auth-1",
		Type:         "codex",
		Provider:     "Codex",
	}}}
	resp, cookie, router := newKeyViewerRouteTestRouter(t, usageProvider, OptionalProviders{UsageIdentity: identityProvider})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/key-overview/events?range=24h&api_key_id=999&page=1&page_size=20&source=auth-1", nil)
	req.AddCookie(cookie)
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d %s", resp.Code, resp.Body.String())
	}
	if usageProvider.lastEvents.APIKeyID != "42" {
		t.Fatalf("expected events route to force viewer API key id, got %+v", usageProvider.lastEvents)
	}
	if usageProvider.lastEvents.AuthIndex != "auth-1" {
		t.Fatalf("expected source filter to become auth index filter, got %+v", usageProvider.lastEvents)
	}
	body := resp.Body.String()
	if !contains(body, `"total_count":1`) || !contains(body, `"api_key":"Viewer Key"`) || !contains(body, `"auth_index":"auth-1"`) {
		t.Fatalf("unexpected events response body: %s", body)
	}
}

func TestKeyOverviewEventModelFiltersForceCurrentViewerAPIKey(t *testing.T) {
	usageProvider := &usageFilterStub{filterOptions: &servicedto.UsageEventFilterOptions{Models: []string{"gpt-5.5"}}}
	resp, cookie, router := newKeyViewerRouteTestRouter(t, usageProvider, OptionalProviders{})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/key-overview/events/filters/models?api_key_id=999", nil)
	req.AddCookie(cookie)
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d %s", resp.Code, resp.Body.String())
	}
	if usageProvider.lastOptions.APIKeyID != "42" {
		t.Fatalf("expected model filter route to force viewer API key id, got %+v", usageProvider.lastOptions)
	}
	if !contains(resp.Body.String(), `"models":["gpt-5.5"]`) {
		t.Fatalf("unexpected model filters response body: %s", resp.Body.String())
	}
}

func TestKeyOverviewAuthFilesPageScopesToCurrentAPIGroupKey(t *testing.T) {
	authType := entities.UsageIdentityAuthTypeAuthFile
	var captured service.ListUsageIdentitiesRequest
	identityProvider := usageIdentitiesStub{
		pagedActiveReq:   &captured,
		pagedActiveTotal: 1,
		pagedActiveItems: []entities.UsageIdentity{{
			ID:           1,
			Name:         "Codex Account",
			AuthType:     authType,
			AuthTypeName: "oauth",
			Identity:     "auth-1",
			Type:         "codex",
			Provider:     "Codex",
		}},
		pagedTypeCounts: []service.UsageIdentityTypeCount{{Type: "codex", Count: 1}},
	}
	resp, cookie, router := newKeyViewerRouteTestRouter(t, nil, OptionalProviders{UsageIdentity: identityProvider})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/key-overview/usage/identities/page?auth_type=1&api_key_id=999&page=1&page_size=10", nil)
	req.AddCookie(cookie)
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d %s", resp.Code, resp.Body.String())
	}
	if captured.APIGroupKey != "raw-viewer-key" || captured.AuthType == nil || *captured.AuthType != authType {
		t.Fatalf("expected auth files page to scope by viewer API group key, got %+v", captured)
	}
	if !contains(resp.Body.String(), `"total_count":1`) || !contains(resp.Body.String(), `"type_counts":[{"type":"codex","count":1}]`) {
		t.Fatalf("unexpected auth files response body: %s", resp.Body.String())
	}
}

func TestKeyOverviewQuotaCacheRejectsUnauthorizedAuthIndex(t *testing.T) {
	quotaProvider := &quotaProviderStub{cacheResponse: quota.CacheResponse{}}
	identityProvider := usageIdentitiesStub{items: []entities.UsageIdentity{{Identity: "auth-1"}}}
	resp, cookie, router := newKeyViewerRouteTestRouter(t, nil, OptionalProviders{Quota: quotaProvider, UsageIdentity: identityProvider})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/key-overview/quota/cache", strings.NewReader(`{"auth_indexes":["auth-1","auth-2"]}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d %s", resp.Code, resp.Body.String())
	}
	if len(quotaProvider.cacheRequest.AuthIndexes) != 0 {
		t.Fatalf("expected forbidden quota request not to reach provider, got %+v", quotaProvider.cacheRequest.AuthIndexes)
	}
}
