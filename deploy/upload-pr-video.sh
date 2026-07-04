#!/usr/bin/env bash
# Upload an on-device PR verification video to SeaweedFS (S3).
#
# Layout: mobile/<pr-prefix>/<fix>/<filename>
# Usage:  ./upload-pr-video.sh <local.mp4> <fix> [pr-prefix]
# Example: ./upload-pr-video.sh /tmp/f24-android.mp4 f24
#          -> mobile/pr-425-llm-stability-and-perf/f24/f24-android.mp4
set -euo pipefail

S3="${OFFGRID_SEAWEEDFS_URL:-http://127.0.0.1:8333}"
BUCKET="mobile"
PR_PREFIX_DEFAULT="pr-425-llm-stability-and-perf"

FILE="${1:?usage: upload-pr-video.sh <local.mp4> <fix> [pr-prefix]}"
FIX="${2:?missing <fix> (e.g. f24, f-slot-leak, f8)}"
PR_PREFIX="${3:-$PR_PREFIX_DEFAULT}"

[ -f "$FILE" ] || { echo "no such file: $FILE" >&2; exit 1; }

KEY="$PR_PREFIX/$FIX/$(basename "$FILE")"
URL="$S3/$BUCKET/$KEY"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
  -H 'Content-Type: video/mp4' \
  --data-binary @"$FILE" "$URL")

if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
  echo "uploaded -> $BUCKET/$KEY  (HTTP $CODE)"
  echo "url: $URL"
else
  echo "upload failed (HTTP $CODE) for $URL" >&2
  exit 1
fi
