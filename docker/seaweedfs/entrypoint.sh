#!/bin/sh
# Starts SeaweedFS as a single-node S3-compatible store (decision D25).
#
# - S3 API on port 8333; credentials come from S3_ACCESS_KEY_ID and
#   S3_SECRET_ACCESS_KEY. With an identity configured, anonymous requests
#   are refused, so the bucket is private; files are only reachable through
#   the app's signed links.
# - File contents are encrypted at rest. S3 uploads need -s3.encryptVolumeData;
#   -filer.encryptVolumeData alone leaves them in plain text (checked).
#
# WEED_BIN, WEED_DIR and WEED_CONFIG can be overridden to run this outside
# the container (local testing).
set -eu

: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"
case "$S3_ACCESS_KEY_ID$S3_SECRET_ACCESS_KEY" in
  *[!A-Za-z0-9_+=/.-]*) echo "S3 credentials may only contain letters, digits and _+=/.-" >&2; exit 1 ;;
esac

WEED_BIN="${WEED_BIN:-weed}"
WEED_DIR="${WEED_DIR:-/data}"
WEED_CONFIG="${WEED_CONFIG:-/tmp/s3.json}"

mkdir -p "$WEED_DIR"
umask 077
cat > "$WEED_CONFIG" <<JSON
{"identities":[{"name":"awdrent","credentials":[{"accessKey":"$S3_ACCESS_KEY_ID","secretKey":"$S3_SECRET_ACCESS_KEY"}],"actions":["Admin","Read","Write","List","Tagging"]}]}
JSON

exec "$WEED_BIN" server \
  -dir="$WEED_DIR" \
  -s3 -s3.port=8333 -s3.config="$WEED_CONFIG" \
  -s3.encryptVolumeData \
  -filer.encryptVolumeData \
  -master.volumeSizeLimitMB=1024 \
  -volume.max=0
