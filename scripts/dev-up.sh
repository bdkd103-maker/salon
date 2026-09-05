#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/.devcontainer/docker-compose.postgres.yml"
BACKEND_DIR="$ROOT_DIR/backend"
BACKEND_LOG="${TMPDIR:-/tmp}/salon-backend.log"
BACKEND_PID_FILE="${TMPDIR:-/tmp}/salon-backend.pid"
LEGACY_POSTGRES_CONTAINER="salon-postgres"

log() {
  printf '[salon-dev] %s\n' "$*"
}

wait_for_docker() {
  local attempts=30
  while (( attempts > 0 )); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 2
  done

  log "Docker is not ready."
  return 1
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

backend_healthcheck() {
  curl -fsS --max-time 5 http://127.0.0.1:4000/health >/dev/null 2>&1
}

wait_for_postgres() {
  local container_id
  local attempts=30

  container_id="$(get_postgres_container_id)"
  if [[ -z "$container_id" ]]; then
    log "Postgres container was not created."
    return 1
  fi

  while (( attempts > 0 )); do
    if docker exec "$container_id" pg_isready -U postgres -d salon >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 2
  done

  local compose_container_id
  compose_container_id="$(compose ps -q postgres 2>/dev/null || true)"
  if [[ -n "$compose_container_id" ]]; then
    compose logs --no-color postgres
  else
    docker logs --tail 80 "$container_id" || true
  fi
  return 1
}

get_running_postgres_container_id() {
  docker ps --filter publish=5432 --format '{{.ID}} {{.Image}}' | awk '$2 ~ /^postgres(:|$)/ { print $1; exit }'
}

get_postgres_container_id() {
  local container_id

  container_id="$(get_running_postgres_container_id)"
  if [[ -n "$container_id" ]]; then
    printf '%s\n' "$container_id"
    return 0
  fi

  container_id="$(compose ps -q postgres 2>/dev/null || true)"
  if [[ -n "$container_id" ]]; then
    printf '%s\n' "$container_id"
    return 0
  fi

  if docker container inspect "$LEGACY_POSTGRES_CONTAINER" >/dev/null 2>&1; then
    printf '%s\n' "$LEGACY_POSTGRES_CONTAINER"
    return 0
  fi

  return 1
}

ensure_postgres() {
  wait_for_docker
  if [[ -n "$(get_running_postgres_container_id)" ]]; then
    log "Using running PostgreSQL container on port 5432."
  elif docker container inspect "$LEGACY_POSTGRES_CONTAINER" >/dev/null 2>&1; then
    log "Starting existing PostgreSQL container."
    docker start "$LEGACY_POSTGRES_CONTAINER" >/dev/null 2>&1 || true
  else
    log "Starting PostgreSQL container."
    compose up -d postgres >/dev/null
  fi
  wait_for_postgres
}

ensure_database_schema() {
  log "Applying Prisma migrations."
  (
    cd "$BACKEND_DIR"
    npm run db:deploy >/dev/null
  )
}

stop_workspace_backend_on_port_4000() {
  local pids
  pids="$(lsof -ti tcp:4000 -sTCP:LISTEN 2>/dev/null || true)"

  [[ -z "$pids" ]] && return 0

  for pid in $pids; do
    local args
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"

    case "$args" in
      *"/workspaces/salon/backend/"*|*"tsx watch src/server.ts"*|*"node dist/server.js"*)
        log "Stopping stale backend process on port 4000 (pid $pid)."
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" >/dev/null 2>&1; then
          kill -9 "$pid" >/dev/null 2>&1 || true
        fi
        ;;
      *)
        log "Port 4000 is occupied by a non-salon process: $args"
        return 1
        ;;
    esac
  done
}

ensure_backend() {
  if backend_healthcheck; then
    log "Backend already healthy on port 4000."
    return 0
  fi

  stop_workspace_backend_on_port_4000

  if backend_healthcheck; then
    log "Backend became healthy on port 4000."
    return 0
  fi

  log "Starting backend on port 4000."
  (
    cd "$BACKEND_DIR"
    nohup npm run dev >"$BACKEND_LOG" 2>&1 &
    echo $! >"$BACKEND_PID_FILE"
  )

  local attempts=30
  while (( attempts > 0 )); do
    if backend_healthcheck; then
      log "Backend is healthy on port 4000."
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 2
  done

  log "Backend failed to start. Recent log output:"
  tail -n 80 "$BACKEND_LOG" || true
  return 1
}

main() {
  ensure_postgres
  ensure_database_schema
  ensure_backend
}

main "$@"
