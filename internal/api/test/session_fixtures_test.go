package test

import (
	"net/http"
	"time"

	keeperapi "cpa-usage-keeper/internal/api"
	"cpa-usage-keeper/internal/auth"
)

func newManagedSessionRouter(manager *auth.SessionManager) http.Handler {
	config := keeperapi.AuthConfig{Enabled: true, LoginPassword: "secret", SessionTTL: time.Hour}
	return keeperapi.NewRouter(nil, nil, nil, nil, config, keeperapi.NewAuthHandler(config, manager), "")
}
