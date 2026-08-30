package spellcheck

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestSandboxImageVendoredDictionaryFetchFilesMatch(t *testing.T) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "../../.."))

	pairs := []struct {
		canonical string
		vendored  string
	}{
		{
			canonical: "internal/i18n/spellcheck/DICTIONARIES.md",
			vendored:  "apps/sandbox-image/DICTIONARIES.md",
		},
		{
			canonical: "apps/go-svc/build/fetch-dictionaries.sh",
			vendored:  "apps/sandbox-image/fetch-dictionaries.sh",
		},
	}

	for _, pair := range pairs {
		want, err := os.ReadFile(filepath.Join(repoRoot, filepath.FromSlash(pair.canonical)))
		if err != nil {
			t.Fatalf("read %s: %v", pair.canonical, err)
		}
		got, err := os.ReadFile(filepath.Join(repoRoot, filepath.FromSlash(pair.vendored)))
		if err != nil {
			t.Fatalf("read %s: %v", pair.vendored, err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s does not match %s; copy the canonical file into apps/sandbox-image so `vercel vcr build docker apps/sandbox-image` stays in sync", pair.vendored, pair.canonical)
		}
	}
}
