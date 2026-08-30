#!/usr/bin/env bash
#
# Publish app-data-v1.json (labels + announcements) to the public S3 bucket
# that installed extensions fetch remote config from (see app-data-manager.js).
#
# Usage:
#   scripts/publish-app-data.sh [file] [-y|--yes]
#
#   file    Path to the data file to publish. Defaults to app-data-v1.json
#           in the repo root. The S3 object key is derived from this file's
#           basename, so it must match the DATA_VERSION-based filename the
#           extension requests (e.g. app-data-v1.json).
#   -y      Skip the confirmation prompt (for scripted/non-interactive use).
#
# Requires: aws CLI, configured with credentials that can write to the
# bucket below (`aws configure`); jq; curl.

set -euo pipefail

BUCKET="wokemaps-public"
REGION="us-east-2"

FILE=""
ASSUME_YES=0
for arg in "$@"; do
    case "$arg" in
        -y|--yes)
            ASSUME_YES=1
            ;;
        -h|--help)
            grep '^#' "$0" | sed 's/^#//; s/^ //'
            exit 0
            ;;
        *)
            FILE="$arg"
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FILE="${FILE:-$REPO_ROOT/app-data-v1.json}"

if ! command -v aws >/dev/null 2>&1; then
    echo "Error: AWS CLI is not installed. Install it and run 'aws configure' with credentials that can write to s3://$BUCKET." >&2
    exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq is required (e.g. 'brew install jq')." >&2
    exit 1
fi

if [[ ! -f "$FILE" ]]; then
    echo "Error: file not found: $FILE" >&2
    exit 1
fi

KEY="$(basename "$FILE")"
S3_URI="s3://$BUCKET/$KEY"
PUBLIC_URL="https://$BUCKET.s3.$REGION.amazonaws.com/$KEY"

echo "Validating $FILE is valid JSON..."
if ! JQ_ERR="$(jq empty "$FILE" 2>&1)"; then
    echo "Error: $FILE is not valid JSON:" >&2
    echo "$JQ_ERR" >&2
    exit 1
fi
echo "OK"

TMP_CURRENT="$(mktemp)"
trap 'rm -f "$TMP_CURRENT"' EXIT

echo
echo "Fetching current live data from $PUBLIC_URL for comparison..."
if ! curl -fsS "$PUBLIC_URL" -o "$TMP_CURRENT" 2>/dev/null; then
    echo "Could not fetch current live data (first publish for this key?) - skipping diff."
else
    OLD_LABELS="$(jq -c -S '.labels[]' "$TMP_CURRENT" 2>/dev/null | sort || true)"
    NEW_LABELS="$(jq -c -S '.labels[]' "$FILE" 2>/dev/null | sort || true)"

    REMOVED="$(comm -23 <(printf '%s\n' "$OLD_LABELS") <(printf '%s\n' "$NEW_LABELS") | grep -v '^$' || true)"
    ADDED="$(comm -13 <(printf '%s\n' "$OLD_LABELS") <(printf '%s\n' "$NEW_LABELS") | grep -v '^$' || true)"

    REMOVED_TARGETS="$(printf '%s\n' "$REMOVED" | jq -r 'select(. != null) | .target' 2>/dev/null | sort -u || true)"
    ADDED_TARGETS="$(printf '%s\n' "$ADDED" | jq -r 'select(. != null) | .target' 2>/dev/null | sort -u || true)"

    CHANGED_TARGETS="$(comm -12 <(printf '%s\n' "$REMOVED_TARGETS") <(printf '%s\n' "$ADDED_TARGETS") | grep -v '^$' || true)"
    ADDED_ONLY="$(comm -23 <(printf '%s\n' "$ADDED_TARGETS") <(printf '%s\n' "$CHANGED_TARGETS") | grep -v '^$' || true)"
    REMOVED_ONLY="$(comm -23 <(printf '%s\n' "$REMOVED_TARGETS") <(printf '%s\n' "$CHANGED_TARGETS") | grep -v '^$' || true)"

    if [[ -z "$ADDED_ONLY" && -z "$CHANGED_TARGETS" && -z "$REMOVED_ONLY" ]]; then
        echo "No label changes detected."
    else
        echo "Label changes:"
        [[ -n "$ADDED_ONLY" ]] && printf '%s\n' "$ADDED_ONLY" | sed 's/^/  + added:   /'
        [[ -n "$CHANGED_TARGETS" ]] && printf '%s\n' "$CHANGED_TARGETS" | sed 's/^/  ~ changed: /'
        [[ -n "$REMOVED_ONLY" ]] && printf '%s\n' "$REMOVED_ONLY" | sed 's/^/  - removed: /'
    fi
fi

echo
if [[ "$ASSUME_YES" -ne 1 ]]; then
    read -r -p "Publish $FILE to $S3_URI? [y/N] " REPLY
    if [[ "$REPLY" != "y" && "$REPLY" != "Y" ]]; then
        echo "Aborted."
        exit 1
    fi
fi

aws s3 cp "$FILE" "$S3_URI" --content-type application/json
echo "Published to $PUBLIC_URL"
