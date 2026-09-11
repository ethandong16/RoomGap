#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ -f "/root/.config/roomgap.env" ]]; then
  set -a
  source "/root/.config/roomgap.env"
  set +a
fi

notify() {
  [[ -z "${ROOMGAP_BARK_URL:-}" ]] && return 0
  local title="$1" body="$2"
  curl -fsS --max-time 10 -G --data-urlencode "title=${title}" --data-urlencode "body=${body}" "${ROOMGAP_BARK_URL}" >/dev/null || true
}

notify "RoomGap 开始采集" "$(date '+%F %T')，开始断点续采"
trap 'code=$?; if [[ $code -ne 0 ]]; then notify "RoomGap 采集失败" "退出码 ${code}，请查看 /var/log/roomgap-collect.log"; fi; exit $code' EXIT

# Prefer the standalone Node 20 installed on the test machine.
if [[ -x "/opt/node20/bin/node" ]]; then
  export PATH="/opt/node20/bin:${PATH}"
fi
if [[ "$(uname -s)" == "Linux" ]]; then
  export ROOMGAP_BROWSER_PROFILE="${ROOMGAP_BROWSER_PROFILE:-/tmp/roomgap-browser-linux}"
fi

# Set ROOMGAP_HEADLESS=0 for the first run so the account can be logged in.
export ROOMGAP_HEADLESS="${ROOMGAP_HEADLESS:-1}"
export ROOMGAP_REFRESH="${ROOMGAP_REFRESH:-0}"
if [[ -z "${ROOMGAP_COOKIES_FILE:-}" && -f ".roomgap-auth.json" ]]; then
  export ROOMGAP_COOKIES_FILE="$(pwd)/.roomgap-auth.json"
fi

if [[ -n "${ROOMGAP_BROWSER_EXECUTABLE:-}" ]]; then
  export ROOMGAP_BROWSER_EXECUTABLE
elif command -v chromium >/dev/null 2>&1; then
  export ROOMGAP_BROWSER_EXECUTABLE="$(command -v chromium)"
elif command -v chromium-browser >/dev/null 2>&1; then
  export ROOMGAP_BROWSER_EXECUTABLE="$(command -v chromium-browser)"
elif command -v google-chrome >/dev/null 2>&1; then
  export ROOMGAP_BROWSER_EXECUTABLE="$(command -v google-chrome)"
fi

node collect-api.mjs
node build-dataset.mjs
node verify-dataset.mjs
notify "RoomGap 采集完成" "$(date '+%F %T')，数据已通过完整性校验"
