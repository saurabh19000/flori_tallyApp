#!/usr/bin/env bash
# push-helper.sh — Notify the Tally Backend after a successful CPI push
#
# Usage:
#   ./push-helper.sh <syncId> <dataType> <company> <totalRecords> <jsonSummary> <jsonDataFile>
#
# Example:
#   ./push-helper.sh "8507b297-a635-45fd-996f-aaf9a9650fb6" \
#     "Ledgers" "My Company" 42 \
#     '{"totalLedgers":42,"partyLedgers":10,"withGstin":5,"withEmail":3,"totalBalance":500000}' \
#     /path/to/data.json

BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"

if [ $# -lt 5 ]; then
  echo "Usage: $0 <syncId> <dataType> <company> <totalRecords> <summaryJSON> [dataFile]"
  echo ""
  echo "  dataFile — optional path to JSON file with data array"
  echo "             if omitted, data will be empty"
  echo ""
  echo "Examples:"
  echo "  BACKEND_URL=http://my-server:3001 $0 \"\$CPI_MESSAGE_ID\" Ledgers \"Acme\" 5 '{\"totalLedgers\":5}' ./data.json"
  exit 1
fi

SYNC_ID="$1"
DATA_TYPE="$2"
COMPANY="$3"
TOTAL_RECORDS="$4"
SUMMARY="$5"
DATA_FILE="$6"

if [ -n "$DATA_FILE" ] && [ -f "$DATA_FILE" ]; then
  DATA_JSON=$(cat "$DATA_FILE")
else
  DATA_JSON="[]"
fi

PAYLOAD=$(cat <<EOF
{
  "syncId": "$SYNC_ID",
  "dataType": "$DATA_TYPE",
  "company": "$COMPANY",
  "totalRecords": $TOTAL_RECORDS,
  "summary": $SUMMARY,
  "data": $DATA_JSON
}
EOF
)

echo "Notifying backend at $BACKEND_URL/api/push ..."
curl -s -X POST "$BACKEND_URL/api/push" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"
echo ""
