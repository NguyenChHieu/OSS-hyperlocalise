package phrase

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/antihax/optional"
	phraseapi "github.com/phrase/phrase-go/v4"
)

var phraseUploadIDRE = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// UploadCleanupInput deletes or lists keys unmentioned in one processed upload.
type UploadCleanupInput struct {
	ProjectID string
	APIToken  string
	UploadID  string
	Branch    string
}

// UnmentionedKey is a translation key absent from an upload.
type UnmentionedKey struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// UploadCleanupResult is the count of keys matching unmentioned_in_upload.
type UploadCleanupResult struct {
	UploadID        string `json:"upload_id"`
	State           string `json:"state"`
	RecordsAffected int    `json:"records_affected"`
}

// ListUnmentionedKeys returns keys in the project that the upload did not mention.
func (c *HTTPClient) ListUnmentionedKeys(ctx context.Context, in UploadCleanupInput) ([]UnmentionedKey, error) {
	query, err := unmentionedUploadQuery(in.UploadID)
	if err != nil {
		return nil, err
	}
	if err := validateUploadLookup(in.ProjectID, in.APIToken, in.UploadID); err != nil {
		return nil, err
	}
	authCtx := context.WithValue(ctx, phraseapi.ContextAPIKey, phraseapi.APIKey{Key: strings.TrimSpace(in.APIToken), Prefix: "token"})
	keys := make([]UnmentionedKey, 0)
	for page := int32(1); ; page++ {
		opts := phraseapi.KeysListOpts{
			Page:    optional.NewInt32(page),
			PerPage: optional.NewInt32(defaultPageSize),
			Q:       optional.NewString(query),
		}
		if branch := strings.TrimSpace(in.Branch); branch != "" {
			opts.Branch = optional.NewString(branch)
		}
		items, err := c.listUnmentionedKeysPage(authCtx, strings.TrimSpace(in.ProjectID), &opts)
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			keys = append(keys, UnmentionedKey{ID: strings.TrimSpace(item.Id), Name: strings.TrimSpace(item.Name)})
		}
		if len(items) < defaultPageSize {
			break
		}
	}
	return keys, nil
}

// DeleteUnmentionedKeys deletes keys in the project that the upload did not mention.
func (c *HTTPClient) DeleteUnmentionedKeys(ctx context.Context, in UploadCleanupInput) (UploadCleanupResult, error) {
	query, err := unmentionedUploadQuery(in.UploadID)
	if err != nil {
		return UploadCleanupResult{}, err
	}
	if err := validateUploadLookup(in.ProjectID, in.APIToken, in.UploadID); err != nil {
		return UploadCleanupResult{}, err
	}
	upload, err := c.GetUpload(ctx, UploadGetInput(in))
	if err != nil {
		return UploadCleanupResult{}, err
	}
	if !IsProcessedUploadState(upload.State) {
		return UploadCleanupResult{}, fmt.Errorf("phrase uploads cleanup: upload %s is not processed (state=%s); wait until state=success before deleting keys", strings.TrimSpace(in.UploadID), upload.State)
	}
	authCtx := context.WithValue(ctx, phraseapi.ContextAPIKey, phraseapi.APIKey{Key: strings.TrimSpace(in.APIToken), Prefix: "token"})
	opts := &phraseapi.KeysDeleteCollectionOpts{Q: optional.NewString(query)}
	if branch := strings.TrimSpace(in.Branch); branch != "" {
		opts.Branch = optional.NewString(branch)
	}
	affected, err := c.deleteUnmentionedKeys(authCtx, strings.TrimSpace(in.ProjectID), opts)
	if err != nil {
		return UploadCleanupResult{}, err
	}
	return UploadCleanupResult{
		UploadID:        strings.TrimSpace(in.UploadID),
		RecordsAffected: int(affected.RecordsAffected),
	}, nil
}

func (c *HTTPClient) listUnmentionedKeysPage(ctx context.Context, projectID string, opts *phraseapi.KeysListOpts) ([]phraseapi.TranslationKey, error) {
	attempt := 0
	for {
		keys, resp, err := c.phraseClient.KeysApi.KeysList(ctx, projectID, opts)
		if err == nil {
			return keys, nil
		}
		if keys, ok := decodeSuccessfulAPIBody[[]phraseapi.TranslationKey](resp, err); ok {
			return keys, nil
		}
		if !shouldRetry(apiResponseHTTPResponse(resp), err) || attempt >= maxRetries {
			return nil, phraseAPIError("GET", fmt.Sprintf("/projects/%s/keys", projectID), resp, err)
		}
		delay := retryDelay(attempt, apiResponseHTTPResponse(resp))
		attempt++
		if err := sleepWithContext(ctx, delay); err != nil {
			return nil, err
		}
	}
}

func (c *HTTPClient) deleteUnmentionedKeys(ctx context.Context, projectID string, opts *phraseapi.KeysDeleteCollectionOpts) (phraseapi.AffectedResources, error) {
	if opts == nil || !opts.Q.IsSet() || !strings.HasPrefix(strings.TrimSpace(opts.Q.Value()), "unmentioned_in_upload:") {
		return phraseapi.AffectedResources{}, fmt.Errorf("phrase uploads cleanup: refusing to delete keys without an unmentioned_in_upload query")
	}
	attempt := 0
	for {
		affected, resp, err := c.phraseClient.KeysApi.KeysDeleteCollection(ctx, projectID, opts)
		if err == nil {
			return affected, nil
		}
		if affected, ok := decodeSuccessfulAPIBody[phraseapi.AffectedResources](resp, err); ok {
			return affected, nil
		}
		if !shouldRetry(apiResponseHTTPResponse(resp), err) || attempt >= maxRetries {
			return phraseapi.AffectedResources{}, phraseAPIError("DELETE", fmt.Sprintf("/projects/%s/keys", projectID), resp, err)
		}
		delay := retryDelay(attempt, apiResponseHTTPResponse(resp))
		attempt++
		if err := sleepWithContext(ctx, delay); err != nil {
			return phraseapi.AffectedResources{}, err
		}
	}
}

func unmentionedUploadQuery(uploadID string) (string, error) {
	id := strings.TrimSpace(uploadID)
	if id == "" {
		return "", fmt.Errorf("phrase uploads cleanup: upload id is required")
	}
	if !phraseUploadIDRE.MatchString(id) {
		return "", fmt.Errorf("phrase uploads cleanup: upload id is invalid")
	}
	return "unmentioned_in_upload:" + id, nil
}
