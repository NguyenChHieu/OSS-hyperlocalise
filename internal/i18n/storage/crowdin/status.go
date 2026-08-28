package crowdin

import (
	"context"
	"fmt"
	"strings"

	"github.com/crowdin/crowdin-api-client-go/crowdin/model"
)

const translationStatusPageLimit = 500

// LanguageProgress is opaque Crowdin translation and approval progress for one language.
type LanguageProgress struct {
	LanguageID          string `json:"languageId"`
	TranslationProgress int    `json:"translationProgress"`
	ApprovalProgress    int    `json:"approvalProgress"`
}

// TranslationStatusRequest selects project-level or branch-level progress.
type TranslationStatusRequest struct {
	ProjectID string
	Branch    string
	Languages []string
}

// GetTranslationStatus returns per-language translation and approval progress.
func (c *HTTPClient) GetTranslationStatus(ctx context.Context, req TranslationStatusRequest) ([]LanguageProgress, error) {
	if c == nil || c.client == nil {
		return nil, fmt.Errorf("crowdin status: client is nil")
	}
	projectID, err := parseProjectID(req.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("crowdin status: %w", err)
	}

	languageIDs := make([]string, 0, len(req.Languages))
	for _, language := range req.Languages {
		language = strings.TrimSpace(language)
		if language != "" {
			languageIDs = append(languageIDs, language)
		}
	}

	branch := strings.TrimSpace(req.Branch)
	var branchID int
	if branch != "" {
		branchID, err = c.ResolveBranch(ctx, req.ProjectID, branch)
		if err != nil {
			return nil, fmt.Errorf("crowdin status: %w", err)
		}
	}

	var rows []LanguageProgress
	offset := 0
	for {
		opts := &model.TranslationProgressListOptions{
			LanguageIDs: languageIDs,
			ListOptions: model.ListOptions{
				Limit:  translationStatusPageLimit,
				Offset: offset,
			},
		}
		var page []*model.TranslationProgress
		if branchID > 0 {
			page, _, err = c.client.TranslationStatus.GetBranchProgress(ctx, projectID, branchID, opts)
		} else {
			page, _, err = c.client.TranslationStatus.GetProjectProgress(ctx, projectID, opts)
		}
		if err != nil {
			return nil, fmt.Errorf("crowdin status: list progress: %w", err)
		}
		for _, item := range page {
			if item == nil {
				continue
			}
			rows = append(rows, LanguageProgress{
				LanguageID:          languageIDFromProgress(item),
				TranslationProgress: item.TranslationProgress,
				ApprovalProgress:    item.ApprovalProgress,
			})
		}
		if len(page) < translationStatusPageLimit {
			break
		}
		offset += translationStatusPageLimit
	}
	return rows, nil
}

func languageIDFromProgress(item *model.TranslationProgress) string {
	if item == nil {
		return ""
	}
	if item.Language != nil && strings.TrimSpace(item.Language.ID) != "" {
		return item.Language.ID
	}
	if item.LanguageID != nil {
		return strings.TrimSpace(*item.LanguageID)
	}
	return ""
}
