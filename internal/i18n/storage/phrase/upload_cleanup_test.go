package phrase

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/antihax/optional"
	phraseapi "github.com/phrase/phrase-go/v4"
)

func TestListUnmentionedKeysUsesUploadQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/projects/p/keys" {
			t.Fatalf("unexpected %s %s", r.Method, r.URL.Path)
		}
		if got := r.URL.Query().Get("q"); got != "unmentioned_in_upload:u1" {
			t.Fatalf("q=%q", got)
		}
		_ = json.NewEncoder(w).Encode([]map[string]string{{"id": "k1", "name": "stale.key"}})
	}))
	defer server.Close()
	client, _ := NewHTTPClientWithBaseURL(Config{}, server.URL, server.Client())
	keys, err := client.ListUnmentionedKeys(context.Background(), UploadCleanupInput{
		ProjectID: "p",
		APIToken:  "secret",
		UploadID:  "u1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 1 || keys[0].Name != "stale.key" {
		t.Fatalf("keys=%+v", keys)
	}
}

func TestDeleteUnmentionedKeysDoesNotRunOnInvalidID(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))
	defer server.Close()
	client, _ := NewHTTPClientWithBaseURL(Config{}, server.URL, server.Client())
	_, err := client.DeleteUnmentionedKeys(context.Background(), UploadCleanupInput{
		ProjectID: "p",
		APIToken:  "secret",
		UploadID:  "u1,u2",
	})
	if err == nil || !strings.Contains(err.Error(), "invalid") {
		t.Fatalf("expected invalid id, got %v", err)
	}
	if called {
		t.Fatalf("must not call Phrase when upload id is invalid")
	}
}

func TestDeleteUnmentionedKeysRejectsQueryMetacharacters(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))
	defer server.Close()
	client, _ := NewHTTPClientWithBaseURL(Config{}, server.URL, server.Client())
	_, err := client.DeleteUnmentionedKeys(context.Background(), UploadCleanupInput{
		ProjectID: "p",
		APIToken:  "secret",
		UploadID:  "u1:unmentioned_in_upload:*",
	})
	if err == nil || !strings.Contains(err.Error(), "invalid") {
		t.Fatalf("expected invalid id, got %v", err)
	}
	if called {
		t.Fatalf("must not call Phrase when upload id can widen the keys query")
	}
}

func TestDeleteUnmentionedKeysRefusesUnprocessedUpload(t *testing.T) {
	deleted := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			deleted = true
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "u1", "state": "processing"})
	}))
	defer server.Close()
	client, _ := NewHTTPClientWithBaseURL(Config{}, server.URL, server.Client())
	_, err := client.DeleteUnmentionedKeys(context.Background(), UploadCleanupInput{
		ProjectID: "p",
		APIToken:  "secret",
		UploadID:  "u1",
	})
	if err == nil || !strings.Contains(err.Error(), "not processed") {
		t.Fatalf("expected fail-closed error, got %v", err)
	}
	if deleted {
		t.Fatalf("must not delete keys for an unprocessed upload")
	}
}

func TestDeleteUnmentionedKeysIssuesDeleteQuery(t *testing.T) {
	var method string
	var query string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/projects/p/uploads/u1":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "u1", "state": "success"})
		case r.Method == http.MethodDelete && r.URL.Path == "/projects/p/keys":
			method = r.Method
			query = r.URL.Query().Get("q")
			_ = json.NewEncoder(w).Encode(map[string]int{"records_affected": 3})
		default:
			t.Fatalf("unexpected %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()
	client, _ := NewHTTPClientWithBaseURL(Config{}, server.URL, server.Client())
	result, err := client.DeleteUnmentionedKeys(context.Background(), UploadCleanupInput{
		ProjectID: "p",
		APIToken:  "secret",
		UploadID:  "u1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if method != http.MethodDelete || query != "unmentioned_in_upload:u1" {
		t.Fatalf("method=%s q=%s", method, query)
	}
	if result.RecordsAffected != 3 {
		t.Fatalf("result=%+v", result)
	}
}

func TestDeleteUnmentionedKeysRefusesNonUploadQuery(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))
	defer server.Close()
	client, _ := NewHTTPClientWithBaseURL(Config{}, server.URL, server.Client())
	_, err := client.deleteUnmentionedKeys(context.Background(), "p", &phraseapi.KeysDeleteCollectionOpts{
		Q: optional.NewString("tags:all"),
	})
	if err == nil || !strings.Contains(err.Error(), "refusing to delete") {
		t.Fatalf("expected refuse, got %v", err)
	}
	if called {
		t.Fatalf("must not call Phrase without an unmentioned_in_upload query")
	}
}
