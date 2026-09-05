package phrase

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/antihax/optional"
	phraseapi "github.com/phrase/phrase-go/v4"
)

const defaultUploadPollInterval = time.Second

// UploadGetInput identifies one Phrase upload.
type UploadGetInput struct {
	ProjectID string
	APIToken  string
	UploadID  string
	Branch    string
}

// UploadWaitInput polls one Phrase upload until it reaches a terminal state.
type UploadWaitInput struct {
	ProjectID string
	APIToken  string
	UploadID  string
	Branch    string
	Interval  time.Duration
}

func validateUploadLookup(projectID, token, uploadID string) error {
	if strings.TrimSpace(projectID) == "" {
		return fmt.Errorf("phrase upload: project id is required")
	}
	if strings.TrimSpace(token) == "" {
		return fmt.Errorf("phrase upload: api token is required")
	}
	if strings.TrimSpace(uploadID) == "" {
		return fmt.Errorf("phrase upload: upload id is required")
	}
	return nil
}

func normalizeUploadState(state string) string {
	return strings.ToLower(strings.TrimSpace(state))
}

// IsUploadSuccessState reports whether Phrase finished importing the upload.
func IsUploadSuccessState(state string) bool {
	return normalizeUploadState(state) == "success"
}

// IsProcessedUploadState reports whether an upload finished successfully and is safe for key cleanup.
func IsProcessedUploadState(state string) bool {
	return IsUploadSuccessState(state)
}

// IsUploadFailedState reports whether Phrase finished the upload in a failed state.
func IsUploadFailedState(state string) bool {
	switch normalizeUploadState(state) {
	case "error", "failed":
		return true
	default:
		return false
	}
}

func isUploadInProgressState(state string) bool {
	switch normalizeUploadState(state) {
	case "", "initialized", "waiting_for_preview", "waiting", "processing", "enqueued", "pending":
		return true
	default:
		return false
	}
}

// GetUpload returns the current Phrase upload record.
func (c *HTTPClient) GetUpload(ctx context.Context, in UploadGetInput) (SourceUploadResult, error) {
	if err := validateUploadLookup(in.ProjectID, in.APIToken, in.UploadID); err != nil {
		return SourceUploadResult{}, err
	}

	authCtx := context.WithValue(ctx, phraseapi.ContextAPIKey, phraseapi.APIKey{Key: strings.TrimSpace(in.APIToken), Prefix: "token"})
	opts := &phraseapi.UploadShowOpts{}
	if branch := strings.TrimSpace(in.Branch); branch != "" {
		opts.Branch = optional.NewString(branch)
	}

	upload, err := c.uploadShow(authCtx, strings.TrimSpace(in.ProjectID), strings.TrimSpace(in.UploadID), opts)
	if err != nil {
		return SourceUploadResult{}, err
	}
	return sourceUploadResultFromPhrase(upload), nil
}

// WaitForUpload polls until the upload succeeds, fails, or the context deadline is reached.
func (c *HTTPClient) WaitForUpload(ctx context.Context, in UploadWaitInput) (SourceUploadResult, error) {
	interval := in.Interval
	if interval <= 0 {
		interval = defaultUploadPollInterval
	}
	getInput := UploadGetInput{
		ProjectID: in.ProjectID,
		APIToken:  in.APIToken,
		UploadID:  in.UploadID,
		Branch:    in.Branch,
	}

	result, err := c.GetUpload(ctx, getInput)
	if err != nil {
		return SourceUploadResult{ID: strings.TrimSpace(in.UploadID)}, err
	}
	if IsUploadSuccessState(result.State) {
		return result, nil
	}
	if IsUploadFailedState(result.State) {
		return result, fmt.Errorf("phrase upload %s failed: state=%s", result.ID, result.State)
	}
	if !isUploadInProgressState(result.State) {
		return result, fmt.Errorf("phrase upload %s is in unknown state %q", result.ID, result.State)
	}

	for {
		if err := sleepWithContext(ctx, interval); err != nil {
			return result, fmt.Errorf("phrase upload %s wait timed out: state=%s: %w", result.ID, result.State, err)
		}
		next, err := c.GetUpload(ctx, getInput)
		if err != nil {
			return result, err
		}
		result = next
		if IsUploadSuccessState(result.State) {
			return result, nil
		}
		if IsUploadFailedState(result.State) {
			return result, fmt.Errorf("phrase upload %s failed: state=%s", result.ID, result.State)
		}
		if !isUploadInProgressState(result.State) {
			return result, fmt.Errorf("phrase upload %s is in unknown state %q", result.ID, result.State)
		}
	}
}

func (c *HTTPClient) uploadShow(ctx context.Context, projectID, uploadID string, opts *phraseapi.UploadShowOpts) (phraseapi.Upload, error) {
	attempt := 0
	for {
		upload, resp, err := c.phraseClient.UploadsApi.UploadShow(ctx, projectID, uploadID, opts)
		if err == nil {
			return upload, nil
		}
		if upload, ok := successfulUploadFromError(resp, err); ok {
			return upload, nil
		}
		if !shouldRetry(apiResponseHTTPResponse(resp), err) || attempt >= maxRetries {
			return phraseapi.Upload{}, phraseAPIError("GET", fmt.Sprintf("/projects/%s/uploads/%s", projectID, uploadID), resp, err)
		}
		delay := retryDelay(attempt, apiResponseHTTPResponse(resp))
		attempt++
		if err := sleepWithContext(ctx, delay); err != nil {
			return phraseapi.Upload{}, err
		}
	}
}
