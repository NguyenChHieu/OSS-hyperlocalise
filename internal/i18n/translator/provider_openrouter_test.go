package translator

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenRouterProviderTranslateRequiresAPIKey(t *testing.T) {
	t.Setenv(defaultOpenRouterAPIKeyEnv, "")

	_, err := NewOpenRouterProvider().Translate(context.Background(), Request{
		Source:         "hello",
		TargetLanguage: "fr",
		Model:          "openai/gpt-4o",
		SystemPrompt:   "system",
		UserPrompt:     "user",
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "OPENROUTER_API_KEY") {
		t.Fatalf("expected API key error, got %v", err)
	}
}

func TestOpenRouterProviderTranslateSendsBearerAuthAndUnchangedModel(t *testing.T) {
	var gotAuth string
	var gotModel string
	var gotPath string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path

		var body struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		gotModel = body.Model

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id": "gen-1",
			"object": "chat.completion",
			"model": "anthropic/claude-opus-5",
			"choices": [{"index": 0, "message": {"role": "assistant", "content": "bonjour"}, "finish_reason": "stop"}]
		}`))
	}))
	defer srv.Close()

	t.Setenv(defaultOpenRouterBaseURLEnv, srv.URL)
	t.Setenv(defaultOpenRouterAPIKeyEnv, "sk-or-test-key")

	got, err := NewOpenRouterProvider().Translate(context.Background(), Request{
		Source:         "hello",
		TargetLanguage: "fr",
		Model:          "anthropic/claude-opus-5",
		SystemPrompt:   "system",
		UserPrompt:     "user",
	})
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	if got != "bonjour" {
		t.Fatalf("translate result = %q, want %q", got, "bonjour")
	}
	if gotAuth != "Bearer sk-or-test-key" {
		t.Fatalf("Authorization header = %q, want %q", gotAuth, "Bearer sk-or-test-key")
	}
	// OpenRouter model IDs (e.g. "anthropic/claude-opus-5") must pass through unchanged: no rewriting or catalogue lookup.
	if gotModel != "anthropic/claude-opus-5" {
		t.Fatalf("request model = %q, want unchanged %q", gotModel, "anthropic/claude-opus-5")
	}
	if gotPath != "/chat/completions" {
		t.Fatalf("request path = %q, want %q", gotPath, "/chat/completions")
	}
}

func TestOpenRouterProviderDefaultBaseURL(t *testing.T) {
	// No live network call here (other tests redirect via OPENROUTER_BASE_URL to a
	// local httptest.Server) -- this just pins the documented default host.
	const want = "https://openrouter.ai/api/v1"
	if defaultOpenRouterBaseURL != want {
		t.Fatalf("defaultOpenRouterBaseURL = %q, want %q", defaultOpenRouterBaseURL, want)
	}
}

// Error payload shapes below match OpenRouter's documented error format
// (https://openrouter.ai/docs/api-reference/errors): {"error": {"code": <int>, "message": <string>, "metadata": {...}}}.
// The "invalid model" message text mirrors what OpenRouter returns in practice
// ("<model> is not a valid model ID"), commonly reported by integrators.
func TestOpenRouterProviderTranslatePreservesUpstreamErrors(t *testing.T) {
	tests := []struct {
		name        string
		status      int
		body        string
		wantStatus  string
		wantMessage string
	}{
		{
			name:        "401 invalid api key",
			status:      http.StatusUnauthorized,
			body:        `{"error":{"code":401,"message":"Invalid credentials (OAuth session expired, disabled/invalid API key)","metadata":{"error_type":"authentication"}}}`,
			wantStatus:  "401",
			wantMessage: "Invalid credentials",
		},
		{
			name:        "400 invalid model",
			status:      http.StatusBadRequest,
			body:        `{"error":{"code":400,"message":"not-a-real-model is not a valid model ID","metadata":{"error_type":"invalid_request"}}}`,
			wantStatus:  "400",
			wantMessage: "not a valid model ID",
		},
		{
			name:        "429 rate limited",
			status:      http.StatusTooManyRequests,
			body:        `{"error":{"code":429,"message":"You are being rate limited","metadata":{"error_type":"rate_limit_exceeded"}}}`,
			wantStatus:  "429",
			wantMessage: "rate limited",
		},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()

			t.Setenv(defaultOpenRouterBaseURLEnv, srv.URL)
			t.Setenv(defaultOpenRouterAPIKeyEnv, "sk-or-test-key")

			_, err := NewOpenRouterProvider().Translate(context.Background(), Request{
				Source:         "hello",
				TargetLanguage: "fr",
				Model:          "not-a-real-model",
			})
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), tc.wantStatus) {
				t.Fatalf("error %q does not contain status %q", err.Error(), tc.wantStatus)
			}
			if !strings.Contains(err.Error(), tc.wantMessage) {
				t.Fatalf("error %q does not contain message %q", err.Error(), tc.wantMessage)
			}
		})
	}
}
