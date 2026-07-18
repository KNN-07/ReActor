#!/usr/bin/env bash
# reactor-worker container entrypoint. No per-boot pip installs — everything is baked
# into the image; we only sanity-check the runtime mount and create state dirs.
#
# Used by both the orchestrator (CMD: `python -m reactor_worker serve`) and the
# sibling gh-proxy (compose command: `python -m reactor_worker.proxy serve`). The
# proxy role does NOT need a $REACTOR_ROOT ReActor checkout — it never runs reactor.
set -euo pipefail

# Shared git metadata under /data/workspaces/_pool is intentionally group
# writable by the `reactor` group so interrupted work can resume on a different
# slot user. Keep new files and directories compatible with that model.
umask 0002

# Detect the proxy role by inspecting the command. Compose passes `command:`
# as $@ here (after tini --), so $1=python, $2=-m, $3=reactor_worker.proxy is the
# canonical shape; we also accept a single concatenated arg for safety.
is_proxy_role=0
if [ "${1:-}" = "python" ] && [ "${2:-}" = "-m" ] && [[ "${3:-}" == reactor_worker.proxy* ]]; then
    is_proxy_role=1
elif [[ "${1:-}" == *"reactor_worker.proxy"* ]]; then
    is_proxy_role=1
fi

/usr/sbin/groupadd -f -g 2000 reactor
max_slots="${REACTOR_WORKER_MAX_CONCURRENCY:-8}"
for i in $(seq 1 "$max_slots"); do
    user="reactor-$i"
    slot_group="reactor-$i"
    slot_id=$((2000 + i))
    /usr/sbin/groupadd -f -g "$slot_id" "$slot_group"
    id -u "$user" >/dev/null 2>&1 || /usr/sbin/useradd -u "$slot_id" -g "$slot_group" -G reactor -M -N -s /usr/sbin/nologin "$user"
    /usr/sbin/usermod -g "$slot_group" -a -G reactor "$user"
done

if [ "$is_proxy_role" -eq 1 ]; then
    exec "$@"
fi

: "${REACTOR_ROOT:=/work/reactor}"
if [ ! -d "$REACTOR_ROOT/packages/coding-agent" ]; then
    echo "reactor-worker: REACTOR_ROOT=$REACTOR_ROOT does not look like a ReActor checkout (no packages/coding-agent/)" >&2
    exit 1
fi

mkdir -p /data/workspaces /data/workspaces/_pool /data/logs
# Persistent build caches under the /data volume. CARGO_HOME,
# CARGO_TARGET_DIR, and RUSTUP_HOME are pinned to these paths in the image ENV
# so every per-issue worktree shares one cargo target/toolchain. Bun install
# cache is workspace-private; a shared cache is unsafe across slot users
# because bun may chmod/chown its cache root to the first writer.
mkdir -p /data/cache/cargo /data/cache/cargo-target /data/cache/rustup /data/cache/reactor-natives
chown -R root:reactor /data/cache /data/workspaces/_pool
find /data/cache /data/workspaces/_pool -type d -exec chmod 2770 {} +
find /data/cache /data/workspaces/_pool -type f -perm /111 -exec chmod 0770 {} +
find /data/cache /data/workspaces/_pool -type f ! -perm /111 -exec chmod 0660 {} +
chmod 0700 /data/logs


rm -rf /srv/agent-home/.agent /srv/agent-home/.reactor/agent
mkdir -p /srv/agent-home/.agent /srv/agent-home/.reactor/agent
if [ -e /srv/agent-home-stage/.agent ]; then
    cp -a /srv/agent-home-stage/.agent/. /srv/agent-home/.agent/
fi
if [ -e /srv/agent-home-stage/.reactor/agent ]; then
    cp -a /srv/agent-home-stage/.reactor/agent/. /srv/agent-home/.reactor/agent/
fi
chown -R root:root /srv/agent-home || true
find /srv/agent-home -type d -exec chmod 0755 {} +
find /srv/agent-home -type f -exec chmod 0644 {} +

# reactor registers daemon project presence under ~/.reactor/run at startup, nesting
# per-project dirs (daemons/<hash>/clients) that any slot user must be able to
# create and enter regardless of which slot first made them: setgid + group
# reactor keeps the whole tree group-writable (entrypoint umask 0002 carries into
# slot processes, so new entries stay group-writable too).
mkdir -p /srv/agent-home/.reactor/run
chgrp -R reactor /srv/agent-home/.reactor/run
chmod -R g+rwX /srv/agent-home/.reactor/run
find /srv/agent-home/.reactor/run -type d -exec chmod g+s {} +
chmod 2770 /srv/agent-home/.reactor/run

touch /data/reactor_worker.sqlite
chown root:root /data/reactor_worker.sqlite
chmod 0600 /data/reactor_worker.sqlite
for db_file in /data/reactor_worker.sqlite-wal /data/reactor_worker.sqlite-shm; do
    if [ -e "$db_file" ]; then
        chown root:root "$db_file"
        chmod 0600 "$db_file"
    fi
done

exec "$@"
