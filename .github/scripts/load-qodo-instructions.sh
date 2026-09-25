#!/bin/bash
set -euo pipefail

# Load Qodo AI instructions from repository file into GitHub Actions environment variables
# Version: 1.0.1 - Repo-agnostic script with version bump and documentation
#
# This script loads the entire .github/prompts/qodo-review.txt file
# and sets it as environment variables for both code suggestions and PR reviews
#
# RELATED FILES (Repo-Agnostic Template):
# - .github/scripts/load-qodo-instructions.sh (this file)
# - .github/workflows/qodo-review.yml (calls this script)
# - .github/prompts/qodo-review.txt (primary instructions file)
# - .github/prompts/qodo-review.md (fallback)
# - .github/qodo-prompts/repo-prompts.txt (fallback)
# - .github/qodo-instructions.md (fallback)
#
# This script is designed to work in any repository. It:
# - Automatically finds instruction files using fallback paths
# - Loads content into GitHub Actions environment variables
# - Uses heredoc syntax for safe multiline content handling
# - Gracefully handles missing files (doesn't fail workflow)
#
# IMPORTANT: This script writes content directly to GITHUB_ENV using heredoc syntax.
# Variables written to GITHUB_ENV are only available in SUBSEQUENT steps.

# Check if instructions file exists (prefer text format, then markdown fallback)
INSTRUCTIONS_FILE=".github/prompts/qodo-review.txt"
if [[ ! -f "$INSTRUCTIONS_FILE" ]]; then
    INSTRUCTIONS_FILE=".github/prompts/qodo-review.md"
    if [[ ! -f "$INSTRUCTIONS_FILE" ]]; then
        INSTRUCTIONS_FILE=".github/qodo-prompts/repo-prompts.txt"
        if [[ ! -f "$INSTRUCTIONS_FILE" ]]; then
            INSTRUCTIONS_FILE=".github/qodo-instructions.md"
        fi
    fi
fi

if [[ ! -f "$INSTRUCTIONS_FILE" ]]; then
    echo "⚠️ No Qodo instructions file found (checked: .github/prompts/qodo-review.txt, .md, .github/qodo-prompts/repo-prompts.txt, .github/qodo-instructions.md)"
    echo "ℹ️ Qodo will use default instructions"
    exit 0  # Don't fail, just use defaults
fi

echo "📖 Loading Qodo AI instructions from: $INSTRUCTIONS_FILE"

# Load entire file content
INSTRUCTIONS=$(cat "$INSTRUCTIONS_FILE")

# Validate that content was loaded
if [[ -z "$INSTRUCTIONS" ]]; then
    echo "⚠️ Instructions file is empty"
    exit 0  # Don't fail, just use defaults
fi

# Set as GitHub Actions environment variables
if [[ -n "${GITHUB_ENV:-}" ]]; then
    # Running in GitHub Actions
    # Use heredoc syntax for multiline content (handles special characters safely)
    {
        echo "PR_CODE_SUGGESTIONS_EXTRA_INSTRUCTIONS<<QODO_EOF"
        echo "$INSTRUCTIONS"
        echo "QODO_EOF"
        echo "PR_REVIEWER_EXTRA_INSTRUCTIONS<<QODO_EOF"
        echo "$INSTRUCTIONS"
        echo "QODO_EOF"
    } >> "$GITHUB_ENV"

    echo "✅ Instructions loaded directly (no base64 encoding needed)"
    echo "   - File: $INSTRUCTIONS_FILE"
    echo "   - Content: ${#INSTRUCTIONS} characters"
else
    # Running locally - just display the content
    echo "🔧 Running locally - would set environment variables in GitHub Actions:"
    echo "--- QODO INSTRUCTIONS ---"
    echo "$INSTRUCTIONS"
    echo "--- END INSTRUCTIONS ---"
fi

echo "✅ Loaded Qodo AI instructions:"
echo "   - Total content: ${#INSTRUCTIONS} characters"
echo "   - Environment variables set for Qodo AI jobs"