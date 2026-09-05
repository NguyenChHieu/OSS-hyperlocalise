package phrase

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWaitForUploadSucceedsAfterProcessing(t *testing.T) {
	shows := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/projects/p/uploads/u1" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "token secret" {
			t.Fatalf("unexpected auth: %q", r.Header.Get("Authorization"))
		}
		shows++
		state := "processing"
		if shows > 1 {
			state = "success"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "u1", "state": state, "summary": map[string]int{}})
	}))
	defer server.Close()

	client, err := NewHTTPClientWithBaseURL(Config{}, server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.WaitForUpload(context.Background(), UploadWaitInput{
		ProjectID: "p",
		APIToken:  "secret",
		UploadID:  "u1",
		Interval:  time.Millisecond,
	})
	if err != nil {
		t.Fatalf("wait: %v", err)
	}
	if result.State != "success" || shows < 2 {
		t.Fatalf("result=%+v shows=%d", result, shows)
	}
}

func TestWaitForUploadFailsOnErrorState(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "u1", "state": "error"})
	}))
	defer server.Close()
	client, _ := NewHTTPClientWithBaseURL(Config{}, server.URL, server.Client())
	_, err := client.WaitForUpload(context.Background(), UploadWaitInput{
		ProjectID: "p",
		APIToken:  "secret",
		UploadID:  "u1",
	})
	if err == nil || !strings.Contains(err.Error(), "state=error") {
		t.Fatalf("expected failed-state error, got %v", err)
	}
}

func TestWaitForUploadFailsClosedOnUnknownState(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "u1", "state": "cancelled"})
	}))
	defer server.Close()
	client, _ := NewHTTPClientWithBaseURL(Config{}, server.URL, server.Client())
	_, err := client.WaitForUpload(context.Background(), UploadWaitInput{
		ProjectID: "p",
		APIToken:  "secret",
		UploadID:  "u1",
	})
	if err == nil || !strings.Contains(err.Error(), "unknown state") {
		t.Fatalf("expected unknown-state error, got %v", err)
	}
}

func TestWaitForUploadTimesOutWhileProcessing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "u1", "state": "processing"})
	}))
	defer server.Close()
	client, _ := NewHTTPClientWithBaseURL(Config{}, server.URL, server.Client())
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err := client.WaitForUpload(ctx, UploadWaitInput{
		ProjectID: "p",
		APIToken:  "secret",
		UploadID:  "u1",
		Interval:  5 * time.Millisecond,
	})
	if err == nil || !strings.Contains(err.Error(), "wait timed out") {
		t.Fatalf("expected timeout, got %v", err)
	}
}

func TestWaitForUploadKeepsIDWhenShowFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer server.Close()
	client, _ := NewHTTPClientWithBaseURL(Config{}, server.URL, server.Client())
	result, err := client.WaitForUpload(context.Background(), UploadWaitInput{
		ProjectID: "p",
		APIToken:  "secret",
		UploadID:  "u1",
	})
	if err == nil {
		t.Fatal("expected show error")
	}
	if result.ID != "u1" {
		t.Fatalf("expected upload id to be preserved, got %+v", result)
	}
}
