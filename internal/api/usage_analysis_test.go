package api

import (
	"testing"

	"cpa-usage-keeper/internal/helper"
	servicedto "cpa-usage-keeper/internal/service/dto"
)

func TestBuildAnalysisHeatmapPayloadSortsKeysByRequests(t *testing.T) {
	payload := buildAnalysisHeatmapPayload([]servicedto.AnalysisHeatmapCell{
		{APIKey: "sk-low123456", Model: "model-low", Requests: 1, TotalTokens: 100},
		{APIKey: "sk-high654321", Model: "model-high", Requests: 5, TotalTokens: 50},
		{APIKey: "sk-high654321", Model: "model-low", Requests: 2, TotalTokens: 20},
	}, nil)

	if got := payload.APIKeys; len(got) != 2 || got[0] != helper.RedactSensitiveValue("sk-high654321") || got[1] != helper.RedactSensitiveValue("sk-low123456") {
		t.Fatalf("expected api keys sorted by total requests desc, got %+v", got)
	}
	if got := payload.Models; len(got) != 2 || got[0] != "model-high" || got[1] != "model-low" {
		t.Fatalf("expected models sorted by total requests desc, got %+v", got)
	}
}

func TestBuildAnalysisHeatmapPayloadKeepsDuplicateAPIKeyLabelsSeparate(t *testing.T) {
	payload := buildAnalysisHeatmapPayload([]servicedto.AnalysisHeatmapCell{
		{APIKey: "sk-alpha123456", Model: "model", Requests: 1, TotalTokens: 100},
		{APIKey: "sk-beta654321", Model: "model", Requests: 2, TotalTokens: 200},
	}, map[string]analysisAPIKeyInfo{
		"sk-alpha123456": {Label: "Shared"},
		"sk-beta654321":  {Label: "Shared"},
	})

	alphaKey := helper.RedactSensitiveValue("sk-alpha123456")
	betaKey := helper.RedactSensitiveValue("sk-beta654321")
	if got := payload.APIKeys; len(got) != 2 || got[0] != betaKey || got[1] != alphaKey {
		t.Fatalf("expected heatmap API keys to use redacted response keys sorted by requests, got %+v", got)
	}
	if payload.APIKeyLabels[alphaKey] != "Shared" || payload.APIKeyLabels[betaKey] != "Shared" {
		t.Fatalf("expected duplicate labels to be stored separately by response key, got %+v", payload.APIKeyLabels)
	}
	if len(payload.Cells) != 2 || payload.Cells[0].APIKey != alphaKey || payload.Cells[1].APIKey != betaKey {
		t.Fatalf("expected heatmap cells to use redacted response keys, got %+v", payload.Cells)
	}
}
