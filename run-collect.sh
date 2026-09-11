#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")"

# Also reads /root/.config/roomgap.env for existing root installs.
config="${ROOMGAP_CONFIG:-${XDG_CONFIG_HOME:-${HOME}/.config}/roomgap.env}"
if [[ -f "$config" ]]; then
  set -a
  source "$config"
  set +a
elif [[ -n "${ROOMGAP_CONFIG:-}" ]]; then
  echo "ERROR: config file not found: $config" >&2
  exit 1
fi

notify() {
  [[ -z "${ROOMGAP_BARK_URL:-}" ]] && return 0
  curl -fsS --connect-timeout 5 --max-time 10 -G \
    --data-urlencode "title=$1" --data-urlencode "body=$2" \
    "$ROOMGAP_BARK_URL" >/dev/null || echo "WARN: Bark notification failed" >&2
}

stage="依赖检查"
on_exit() {
  local code=$?
  if [[ $code -ne 0 ]]; then
    echo "ERROR: ${stage} failed (exit ${code})" >&2
    notify "RoomGap 任务失败" "阶段：${stage}；退出码 ${code}。请查看本次运行日志。"
  fi
}
trap on_exit EXIT

# Serialize cron and manual runs that use this checkout.
command -v flock >/dev/null || { echo 'ERROR: install util-linux (flock)' >&2; exit 1; }
exec 9>.roomgap-collect.lock
if ! flock -n 9; then
  echo 'SKIPPED: another collection is already running in this checkout'
  exit 0
fi

# Compatibility with the original ARM64 installation; normal installs use PATH.
if [[ -x /opt/node20/bin/node ]]; then export PATH="/opt/node20/bin:${PATH}"; fi
command -v node >/dev/null || { echo 'ERROR: Node.js 20+ is required' >&2; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<20)throw Error("Node.js 20+ is required")'
for file in collect-api.mjs build-dataset.mjs verify-dataset.mjs semester-model.mjs; do
  [[ -f "$file" ]] || { echo "ERROR: missing $file; deploy the complete repository" >&2; exit 1; }
  node --check "$file"
done
node --input-type=module -e 'import {pathToFileURL} from "node:url"; await import(process.env.ROOMGAP_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.ROOMGAP_PLAYWRIGHT_MODULE).href : "playwright")'

export ROOMGAP_HEADLESS="${ROOMGAP_HEADLESS:-1}"
export ROOMGAP_REFRESH="${ROOMGAP_REFRESH:-0}"
export ROOMGAP_BROWSER_PROFILE="${ROOMGAP_BROWSER_PROFILE:-$PWD/.roomgap-browser}"
if [[ -z "${ROOMGAP_COOKIES_FILE:-}" && -f .roomgap-auth.json ]]; then
  export ROOMGAP_COOKIES_FILE="$PWD/.roomgap-auth.json"
fi
if [[ -n "${ROOMGAP_COOKIES_FILE:-}" && ! -r "$ROOMGAP_COOKIES_FILE" ]]; then
  echo 'ERROR: ROOMGAP_COOKIES_FILE is not readable' >&2
  exit 1
fi
if [[ -n "${ROOMGAP_BROWSER_EXECUTABLE:-}" ]]; then
  [[ -x "$ROOMGAP_BROWSER_EXECUTABLE" ]] || { echo 'ERROR: browser executable not found' >&2; exit 1; }
  export ROOMGAP_BROWSER_EXECUTABLE
elif [[ -z "${ROOMGAP_BROWSER_CHANNEL:-}" ]]; then
  for browser in chromium chromium-browser google-chrome; do
    if command -v "$browser" >/dev/null; then
      export ROOMGAP_BROWSER_EXECUTABLE="$(command -v "$browser")"
      break
    fi
  done
fi

mode="断点续采"
if [[ "$ROOMGAP_REFRESH" == 1 ]]; then mode="完整刷新"; fi
notify "RoomGap 开始采集" "$(date '+%F %T %Z')，${mode}"
stage="采集"
node collect-api.mjs
stage="数据构建"
node build-dataset.mjs
stage="完整性校验"
node verify-dataset.mjs
if [[ "${ROOMGAP_GIT_PUSH:-0}" == "1" ]]; then
  stage="GitHub 推送"
  git add data/semester data/dataset
  if ! git diff --cached --quiet; then
    git commit -m "Update collected classroom data"
    git push origin main
    notify "RoomGap 网站更新" "数据已推送到 GitHub，等待网站自动部署"
  else
    notify "RoomGap 网站无需更新" "采集完成，数据没有变化"
  fi
fi
echo 'SUCCESS: collection, dataset build and verification completed'
notify "RoomGap 采集完成" "$(date '+%F %T %Z')，数据已通过完整性校验。"
