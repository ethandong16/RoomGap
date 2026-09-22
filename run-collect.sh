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
failure_detail=""
on_exit() {
  local code=$?
  if [[ $code -ne 0 ]]; then
    echo "ERROR: ${stage} failed (exit ${code})" >&2
    notify "RoomGap 任务失败" "阶段：${stage}；退出码 ${code}。${failure_detail} 请查看本次运行日志。"
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
for file in collect-api.mjs classroom-page.mjs cookie-header.mjs build-dataset.mjs verify-dataset.mjs semester-model.mjs scripts/check-space.mjs; do
  [[ -f "$file" ]] || { echo "ERROR: missing $file; deploy the complete repository" >&2; exit 1; }
  node --check "$file"
done
check_space() {
  stage="磁盘空间检查（$1）"
  local result
  if result=$(node scripts/check-space.mjs 2>&1); then
    echo "$result"
  else
    failure_detail="$result"
    echo "$result" >&2
    return 1
  fi
}

check_publish_repo() {
  command -v git >/dev/null || { echo 'ERROR: git is required for automatic publication' >&2; exit 1; }
  [[ "$(git rev-parse --show-toplevel)" == "$(pwd -P)" ]] || { echo 'ERROR: publication requires a complete Git checkout at the project root' >&2; exit 1; }
  [[ "$(git branch --show-current)" == main ]] || { echo 'ERROR: automatic publication requires the main branch' >&2; exit 1; }
  git remote get-url origin >/dev/null
  git var GIT_AUTHOR_IDENT >/dev/null
  git diff --cached --quiet || { echo 'ERROR: commit or unstage existing staged changes before automatic publication' >&2; exit 1; }
}
if [[ "${ROOMGAP_GIT_PUSH:-0}" == 1 ]]; then check_publish_repo; fi

export ROOMGAP_REFRESH="${ROOMGAP_REFRESH:-1}"
if [[ "$ROOMGAP_REFRESH" != 0 && "$ROOMGAP_REFRESH" != 1 ]]; then
  echo 'ERROR: ROOMGAP_REFRESH must be 0 (resume) or 1 (refresh)' >&2
  exit 1
fi
if [[ -z "${ROOMGAP_COOKIES_FILE:-}" && -f .roomgap-auth.json ]]; then
  export ROOMGAP_COOKIES_FILE="$PWD/.roomgap-auth.json"
fi
if [[ -n "${ROOMGAP_COOKIES_FILE:-}" && ! -r "$ROOMGAP_COOKIES_FILE" ]]; then
  echo 'ERROR: ROOMGAP_COOKIES_FILE is not readable' >&2
  exit 1
fi
mode="完整刷新"
if [[ "$ROOMGAP_REFRESH" == 0 ]]; then mode="断点续采"; fi
check_space "采集前"
notify "RoomGap 开始采集" "$(date '+%F %T %Z')，${mode}"
stage="采集"
node collect-api.mjs
check_space "构建前"
stage="数据构建"
node build-dataset.mjs
stage="完整性校验"
node verify-dataset.mjs
if [[ "${ROOMGAP_GIT_PUSH:-0}" == "1" ]]; then
  check_space "Git 推送前"
  stage="GitHub 推送"
  check_publish_repo
  git add -- data/semester data/dataset
  if ! git diff --cached --quiet; then
    git commit --only -m "Update collected classroom data" -- data/semester data/dataset
  fi
  # Retry a previously committed but unpushed snapshot even when this run has no diff.
  GIT_TERMINAL_PROMPT=0 git push origin main
  notify "RoomGap 数据已推送" "数据已同步到 GitHub；网站是否发布成功请查看托管平台状态。"
fi
echo 'SUCCESS: collection, dataset build and verification completed'
notify "RoomGap 采集完成" "$(date '+%F %T %Z')，数据已通过完整性校验。"
