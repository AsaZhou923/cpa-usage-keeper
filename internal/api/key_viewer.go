package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"cpa-usage-keeper/internal/auth"
	"cpa-usage-keeper/internal/entities"
	"cpa-usage-keeper/internal/quota"
	"cpa-usage-keeper/internal/service"
	servicedto "cpa-usage-keeper/internal/service/dto"
	"cpa-usage-keeper/internal/timeutil"
	"github.com/gin-gonic/gin"
)

const keyViewerSourceOptionPageSize = 10000

func requireActiveAPIKeyViewer(c *gin.Context, cpaAPIKeyProvider service.CPAAPIKeyProvider, authHandler *authHandler) (string, auth.Session, entities.CPAAPIKey, bool) {
	tokenValue, _ := c.Get("auth_token")
	token := fmt.Sprint(tokenValue)
	sessionValue, _ := c.Get("auth_session")
	session, ok := sessionValue.(auth.Session)
	if !ok || session.Role != auth.RoleAPIKeyViewer || session.CPAAPIKeyID <= 0 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return token, auth.Session{}, entities.CPAAPIKey{}, false
	}
	if cpaAPIKeyProvider == nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return token, auth.Session{}, entities.CPAAPIKey{}, false
	}
	apiKey, err := cpaAPIKeyProvider.FindActiveCPAAPIKeyByID(c.Request.Context(), session.CPAAPIKeyID)
	if err != nil {
		if authHandler != nil {
			authHandler.deleteSession(token)
			clearSessionCookie(c, authHandler.config.BasePath, resolveSessionToken(c).CookieKind)
		}
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return token, auth.Session{}, entities.CPAAPIKey{}, false
	}
	return token, session, apiKey, true
}

func forceViewerAPIKeyFilter(filter servicedto.UsageFilter, apiKey entities.CPAAPIKey) servicedto.UsageFilter {
	filter.APIKeyID = strconv.FormatInt(apiKey.ID, 10)
	return filter
}

func registerKeyUsageEventsRoute(
	router gin.IRoutes,
	usageProvider service.UsageProvider,
	usageIdentityProvider service.UsageIdentityProvider,
	cpaAPIKeyProvider service.CPAAPIKeyProvider,
	authHandler *authHandler,
) {
	router.GET("/key-overview/events/filters/models", func(c *gin.Context) {
		token, _, apiKey, ok := requireActiveAPIKeyViewer(c, cpaAPIKeyProvider, authHandler)
		if !ok {
			return
		}
		if authHandler != nil && !authHandler.allowKeyOverviewRequest(token, "events_models") {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "too many requests"})
			return
		}
		options, err := loadUsageEventModelFilterOptions(c, usageProvider, forceViewerAPIKeyFilter(servicedto.UsageFilter{}, apiKey))
		if err != nil {
			writeInternalError(c, "list usage event model filter options failed", err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"models": options})
	})

	router.GET("/key-overview/events/filters/sources", func(c *gin.Context) {
		token, _, apiKey, ok := requireActiveAPIKeyViewer(c, cpaAPIKeyProvider, authHandler)
		if !ok {
			return
		}
		if authHandler != nil && !authHandler.allowKeyOverviewRequest(token, "events_sources") {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "too many requests"})
			return
		}
		sources, err := loadKeyUsageEventSourceFilterOptions(c, usageIdentityProvider, apiKey.APIKey)
		if err != nil {
			writeInternalError(c, "list usage event source filter options failed", err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"sources": sources})
	})

	router.GET("/key-overview/events", func(c *gin.Context) {
		token, _, apiKey, ok := requireActiveAPIKeyViewer(c, cpaAPIKeyProvider, authHandler)
		if !ok {
			return
		}
		if usageProvider == nil {
			c.JSON(http.StatusOK, usageEventsResponse{Events: []usageEventPayload{}, Page: 1, PageSize: servicedto.DefaultUsageEventsLimit})
			return
		}
		filter, err := parseUsageFilterQuery(c.Request, timeutil.NormalizeStorageTime(time.Now()))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := applyUsageEventsSourceFilter(&filter); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if authHandler != nil && !authHandler.allowKeyOverviewRequest(token, "events") {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "too many requests"})
			return
		}
		filter = forceViewerAPIKeyFilter(filter, apiKey)
		rows, err := usageProvider.ListUsageEvents(c.Request.Context(), filter)
		if err != nil {
			writeInternalError(c, "list usage events failed", err)
			return
		}
		identities, err := loadKeyUsageResolutionData(c, usageIdentityProvider, apiKey.APIKey)
		if err != nil {
			writeInternalError(c, "load usage resolution data failed", err)
			return
		}
		resolver := newUsageIdentityResolver(identities)
		apiKeyInfos := map[string]analysisAPIKeyInfo{strings.TrimSpace(apiKey.APIKey): {
			ID:    strconv.FormatInt(apiKey.ID, 10),
			Label: keyViewerAPIKeyLabel(apiKey),
		}}
		c.JSON(http.StatusOK, usageEventsResponse{
			Events:     buildUsageEventsPayload(rows.Events, resolver, apiKeyInfos),
			TotalCount: rows.TotalCount,
			Page:       rows.Page,
			PageSize:   rows.PageSize,
			TotalPages: rows.TotalPages,
		})
	})

	router.GET("/key-overview/events/export", func(c *gin.Context) {
		token, _, apiKey, ok := requireActiveAPIKeyViewer(c, cpaAPIKeyProvider, authHandler)
		if !ok {
			return
		}
		if authHandler != nil && !authHandler.allowKeyOverviewRequest(token, "events_export") {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "too many requests"})
			return
		}
		format := strings.ToLower(strings.TrimSpace(c.Query("format")))
		if format == "" {
			format = "csv"
		}
		if format != "csv" && format != "json" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid export format"})
			return
		}
		filter, err := parseUsageFilterQuery(c.Request, timeutil.NormalizeStorageTime(time.Now()))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := applyUsageEventsSourceFilter(&filter); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		filter = forceViewerAPIKeyFilter(filter, apiKey)
		filter.Limit = 0
		filter.Page = 0
		filter.PageSize = 0
		filter.Offset = 0
		identities, err := loadKeyUsageResolutionData(c, usageIdentityProvider, apiKey.APIKey)
		if err != nil {
			writeInternalError(c, "load usage resolution data failed", err)
			return
		}
		resolver := newUsageIdentityResolver(identities)
		apiKeyInfos := map[string]analysisAPIKeyInfo{strings.TrimSpace(apiKey.APIKey): {
			ID:    strconv.FormatInt(apiKey.ID, 10),
			Label: keyViewerAPIKeyLabel(apiKey),
		}}
		streamEvents := func(emit func(servicedto.UsageEventRecord) error) error {
			if usageProvider == nil {
				return nil
			}
			return usageProvider.StreamUsageEvents(c.Request.Context(), filter, emit)
		}
		if format == "json" {
			if err := writeUsageEventsJSONExport(c, streamEvents, resolver, apiKeyInfos); err != nil {
				writeUsageEventsExportError(c, err)
			}
			return
		}
		if err := writeUsageEventsCSVExport(c, streamEvents, resolver, apiKeyInfos); err != nil {
			writeUsageEventsExportError(c, err)
		}
	})
}

func registerKeyUsageIdentityRoutes(
	router gin.IRoutes,
	usageIdentityProvider service.UsageIdentityProvider,
	cpaAPIKeyProvider service.CPAAPIKeyProvider,
	authHandler *authHandler,
) {
	router.GET("/key-overview/usage/identities/page", func(c *gin.Context) {
		token, _, apiKey, ok := requireActiveAPIKeyViewer(c, cpaAPIKeyProvider, authHandler)
		if !ok {
			return
		}
		if usageIdentityProvider == nil {
			c.JSON(http.StatusOK, usageIdentitiesPageResponse{Identities: []usageIdentityResponse{}, Page: 1, PageSize: 10, TypeCounts: []usageIdentityTypeCount{}})
			return
		}
		if authHandler != nil && !authHandler.allowKeyOverviewRequest(token, "identities_page") {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "too many requests"})
			return
		}
		request, ok := parseUsageIdentitiesPageRequest(c)
		if !ok {
			return
		}
		if request.AuthType == nil || *request.AuthType != entities.UsageIdentityAuthTypeAuthFile {
			c.JSON(http.StatusBadRequest, gin.H{"error": "auth_type must be 1"})
			return
		}
		request.APIGroupKey = apiKey.APIKey
		result, err := usageIdentityProvider.ListActiveUsageIdentitiesPage(c.Request.Context(), request)
		if err != nil {
			writeInternalError(c, "list active usage identities page failed", err)
			return
		}
		response := make([]usageIdentityResponse, 0, len(result.Items))
		for index, item := range result.Items {
			var health *service.UsageCredentialHealthSnapshot
			if index < len(result.CredentialHealth) {
				health = &result.CredentialHealth[index]
			}
			response = append(response, mapUsageIdentityResponseWithHealth(item, health))
		}
		typeCounts := make([]usageIdentityTypeCount, 0, len(result.TypeCounts))
		for _, item := range result.TypeCounts {
			typeCounts = append(typeCounts, usageIdentityTypeCount{Type: item.Type, Count: item.Count})
		}
		c.JSON(http.StatusOK, usageIdentitiesPageResponse{
			Identities: response,
			TotalCount: result.Total,
			Page:       request.Page,
			PageSize:   request.PageSize,
			TotalPages: totalPages(result.Total, request.PageSize),
			TypeCounts: typeCounts,
		})
	})
}

func registerKeyQuotaRoutes(
	router gin.IRoutes,
	quotaProvider QuotaProvider,
	usageIdentityProvider service.UsageIdentityProvider,
	cpaAPIKeyProvider service.CPAAPIKeyProvider,
	authHandler *authHandler,
) {
	router.POST("/key-overview/quota/cache", func(c *gin.Context) {
		token, _, apiKey, ok := requireActiveAPIKeyViewer(c, cpaAPIKeyProvider, authHandler)
		if !ok {
			return
		}
		if quotaProvider == nil {
			writeInternalError(c, "quota provider is not configured", nil)
			return
		}
		if usageIdentityProvider == nil {
			writeInternalError(c, "usage identity provider is not configured", nil)
			return
		}
		if authHandler != nil && !authHandler.allowKeyOverviewRequest(token, "quota_cache") {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "too many requests"})
			return
		}
		var request quotaRequest
		if err := c.ShouldBindJSON(&request); err != nil || len(request.AuthIndexes) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "auth_indexes are required"})
			return
		}
		normalizedAuthIndexes := normalizeKeyViewerAuthIndexes(request.AuthIndexes)
		if len(normalizedAuthIndexes) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "auth_indexes are required"})
			return
		}
		authType := entities.UsageIdentityAuthTypeAuthFile
		allowedAuthIndexes, err := usageIdentityProvider.ListActiveUsageIdentityAuthIndexes(c.Request.Context(), service.ListUsageIdentitiesRequest{
			AuthType:    &authType,
			APIGroupKey: apiKey.APIKey,
		})
		if err != nil {
			writeInternalError(c, "list visible auth indexes failed", err)
			return
		}
		if !keyViewerAuthIndexesAllowed(normalizedAuthIndexes, allowedAuthIndexes) {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
		response, err := quotaProvider.GetCachedQuota(c.Request.Context(), quota.CacheRequest{AuthIndexes: normalizedAuthIndexes})
		if err != nil {
			writeInternalError(c, "quota cache lookup failed", err)
			return
		}
		c.JSON(http.StatusOK, response)
	})
}

func loadKeyUsageResolutionData(c *gin.Context, usageIdentityProvider service.UsageIdentityProvider, apiGroupKey string) ([]entities.UsageIdentity, error) {
	if usageIdentityProvider == nil {
		return []entities.UsageIdentity{}, nil
	}
	result, err := usageIdentityProvider.ListActiveUsageIdentitiesPage(c.Request.Context(), service.ListUsageIdentitiesRequest{
		APIGroupKey: strings.TrimSpace(apiGroupKey),
		Page:        1,
		PageSize:    keyViewerSourceOptionPageSize,
	})
	if err != nil {
		return nil, err
	}
	return result.Items, nil
}

func keyViewerAPIKeyLabel(apiKey entities.CPAAPIKey) string {
	if label := strings.TrimSpace(apiKey.KeyAlias); label != "" {
		return label
	}
	if label := strings.TrimSpace(apiKey.DisplayKey); label != "" {
		return label
	}
	return strconv.FormatInt(apiKey.ID, 10)
}

func loadKeyUsageEventSourceFilterOptions(c *gin.Context, usageIdentityProvider service.UsageIdentityProvider, apiGroupKey string) ([]usageSourceFilterOption, error) {
	identities, err := loadKeyUsageResolutionData(c, usageIdentityProvider, apiGroupKey)
	if err != nil {
		return nil, err
	}
	return buildUsageSourceFilterOptions(identities), nil
}

func normalizeKeyViewerAuthIndexes(values []string) []string {
	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	return normalized
}

func keyViewerAuthIndexesAllowed(requested []string, allowed []string) bool {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, value := range allowed {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		allowedSet[value] = struct{}{}
	}
	for _, value := range requested {
		if _, ok := allowedSet[value]; !ok {
			return false
		}
	}
	return true
}
