package crowdin

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestGetTranslationStatusListsProjectProgress(t *testing.T) {
	client, mux, teardown := newCrowdinHTTPClientForTest(t)
	defer teardown()

	mux.HandleFunc("/api/v2/projects/123/languages/progress", func(w http.ResponseWriter, r *http.Request) {
		assertRequest(t, r, http.MethodGet, "/api/v2/projects/123/languages/progress?languageIds=es&limit=500")
		writeJSON(t, w, map[string]any{
			"data": []any{
				map[string]any{"data": map[string]any{
					"translationProgress": 86,
					"approvalProgress":    40,
					"languageId":          "es",
					"language":            map[string]any{"id": "es"},
				}},
			},
			"pagination": map[string]any{"offset": 0, "limit": 500},
		})
	})

	rows, err := client.GetTranslationStatus(context.Background(), TranslationStatusRequest{
		ProjectID: "123",
		Languages: []string{"es"},
	})
	if err != nil {
		t.Fatalf("get translation status: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	if rows[0].LanguageID != "es" || rows[0].TranslationProgress != 86 || rows[0].ApprovalProgress != 40 {
		t.Fatalf("row = %#v", rows[0])
	}
}

func TestGetTranslationStatusUsesBranchProgress(t *testing.T) {
	client, mux, teardown := newCrowdinHTTPClientForTest(t)
	defer teardown()

	mux.HandleFunc("/api/v2/projects/123/branches", func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.RawQuery, "name=release") {
			t.Fatalf("unexpected branch list query: %s", r.URL.RawQuery)
		}
		writeJSON(t, w, map[string]any{
			"data": []any{
				map[string]any{"data": map[string]any{"id": 9, "name": "release"}},
			},
			"pagination": map[string]any{"offset": 0, "limit": 500},
		})
	})
	mux.HandleFunc("/api/v2/projects/123/branches/9/languages/progress", func(w http.ResponseWriter, r *http.Request) {
		assertRequest(t, r, http.MethodGet, "/api/v2/projects/123/branches/9/languages/progress?limit=500")
		writeJSON(t, w, map[string]any{
			"data": []any{
				map[string]any{"data": map[string]any{
					"translationProgress": 100,
					"approvalProgress":    100,
					"languageId":          "fr",
				}},
			},
			"pagination": map[string]any{"offset": 0, "limit": 500},
		})
	})

	rows, err := client.GetTranslationStatus(context.Background(), TranslationStatusRequest{
		ProjectID: "123",
		Branch:    "release",
	})
	if err != nil {
		t.Fatalf("get translation status: %v", err)
	}
	if len(rows) != 1 || rows[0].LanguageID != "fr" {
		t.Fatalf("rows = %#v", rows)
	}
}
