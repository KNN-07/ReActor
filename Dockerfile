# syntax=docker/dockerfile:1.7-labs
###############################################################################
# ReActor runtime image
#
# Stages:
#   natives-builder — Rust + Bun → reactor_natives.linux-<arch>.node
#   wheel-builder   — reactor_rpc Python wheel
#   reactor-base         — python + bun + rustup launcher + natives + reactor_rpc
#                     + /usr/local/bin/reactor shim
#   reactor-runtime      — reactor-base + ReActor source + bun install      (DEFAULT, runnable)
#
# Build:
#     docker build -t reactor/reactor:dev .                          # default = reactor-runtime
#     docker build --target reactor-base -t reactor/reactor-base:dev .    # base for derived images
#
# Run:
#     docker run --rm reactor/reactor:dev --help
#     docker run --rm -it -v "$PWD":/work reactor/reactor:dev cli    # interactive reactor
#
# Consume as a base in another Dockerfile (see Dockerfile.reactor-worker):
#     ARG REACTOR_BASE=reactor/reactor:dev
#     FROM ${REACTOR_BASE} AS reactor-base
###############################################################################

ARG BUN_VERSION=1.3.14

############################
# 1) natives-builder — Rust + Bun → reactor_natives.linux-<arch>.node
############################
FROM rust:1.86-slim-bookworm AS natives-builder

ARG BUN_VERSION
ENV BUN_INSTALL=/opt/bun \
    PATH=/opt/bun/bin:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin \
    CARGO_TERM_COLOR=never

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl ca-certificates pkg-config libssl-dev unzip git \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
    && /opt/bun/bin/bun --version

WORKDIR /reactor

# Layer 1 — manifests + lockfiles only. Source edits under packages/*/src and
# crates/*/src won't bust `bun install` below. `--parents` preserves the
# matched path under /reactor/ (requires syntax 1.7-labs).
COPY --parents \
    package.json bun.lock bunfig.toml \
    patches/*.patch \
    tsconfig.base.json tsconfig.json \
    Cargo.toml Cargo.lock rust-toolchain.toml \
    packages/*/package.json \
    packages/tsconfig.workspace.json \
    python/reactor-worker/web/package.json \
    crates/*/Cargo.toml \
    /reactor/

# Layer 2 — hydrate node_modules from the manifests above.
RUN bun install --frozen-lockfile --ignore-scripts

# Layer 3 — full source. `Dockerfile.dockerignore` keeps target/, node_modules/,
# dist/, runs/, editor noise, etc. out of the context. node_modules from Layer 2
# is preserved across this COPY because it's never in the build context.
COPY . /reactor/

# Layer 4 — compile reactor-natives to a Linux N-API addon. Persistent caches keep
# repeat builds incremental: cargo's package index + git-deps + the workspace
# target dir.
RUN --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/root/.cargo/git \
    --mount=type=cache,target=/reactor/target \
    set -eux; \
    rustup show; \
    bun --cwd=packages/natives run build; \
    mkdir -p /out; \
    cp packages/natives/native/reactor_natives.linux-*.node /out/

############################
# 2) wheel-builder — reactor-rpc wheel
############################
FROM python:3.12-slim-bookworm AS wheel-builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade pip build

WORKDIR /src
COPY python/reactor-rpc /src
RUN python -m build --wheel --outdir /out

############################
# 3) reactor-base — python + bun + rustup + natives + reactor_rpc + reactor shim
#
# Sharable runtime base. Derived images (reactor-runtime below, Dockerfile.reactor-worker)
# extend this and overlay their own source tree. Default REACTOR_ROOT=/work/reactor is
# friendly to derived images that mount a host ReActor checkout there; reactor-runtime
# overrides it to /reactor because its source is baked in.
############################
FROM python:3.12-slim-bookworm AS reactor-base

ARG BUN_VERSION
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    BUN_INSTALL=/opt/bun \
    REACTOR_ROOT=/work/reactor \
    CARGO_HOME=/data/cache/cargo \
    CARGO_TARGET_DIR=/data/cache/cargo-target \
    RUSTUP_HOME=/data/cache/rustup \
    PATH=/opt/bun/bin:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git curl ca-certificates unzip openssh-client tini sqlite3 \
        build-essential pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
    && /opt/bun/bin/bun --version

# Rustup launcher only — the real toolchain is fetched lazily into RUSTUP_HOME
# on first cargo invocation, driven by ReActor's `rust-toolchain.toml`. Keeps the
# image small while sharing the toolchain across reboots when /data is mounted.
RUN curl -fsSL https://sh.rustup.rs -o /tmp/rustup-init.sh \
    && CARGO_HOME=/usr/local/cargo RUSTUP_HOME=/usr/local/rustup-bootstrap \
       sh /tmp/rustup-init.sh -y --no-modify-path --default-toolchain none --profile minimal \
    && rm -f /tmp/rustup-init.sh \
    && rm -rf /usr/local/rustup-bootstrap \
    && /usr/local/cargo/bin/rustup --version

# reactor-natives addon: ReActor's loader probes /opt/bun/bin as a fallback path.
COPY --from=natives-builder /out/reactor_natives.linux-*.node /opt/bun/bin/

# reactor-rpc Python wheel.
COPY --from=wheel-builder /out/*.whl /tmp/wheels/
RUN pip install /tmp/wheels/reactor_rpc-*.whl && rm -rf /tmp/wheels

# `reactor` shim — runs the coding-agent CLI against $REACTOR_ROOT via Bun. Derived
# images override REACTOR_ROOT to point at wherever their ReActor source lives.
RUN printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    ': "${REACTOR_ROOT:=/work/reactor}"' \
    'if [ ! -d "$REACTOR_ROOT/packages/coding-agent" ]; then' \
    '  echo "reactor: REACTOR_ROOT=$REACTOR_ROOT does not look like a ReActor checkout" >&2' \
    '  exit 127' \
    'fi' \
    'exec bun "$REACTOR_ROOT/packages/coding-agent/src/cli.ts" "$@"' \
    > /usr/local/bin/reactor \
    && chmod +x /usr/local/bin/reactor

############################
# 4) reactor-runtime — reactor-base + ReActor source + bun install (DEFAULT)
#
# A self-contained, runnable reactor image. `docker run reactor/reactor:dev --help`
# Just Works without a host checkout.
############################
FROM reactor-base AS reactor-runtime

ENV REACTOR_ROOT=/reactor
WORKDIR /reactor

# Same manifests-only layered install pattern as natives-builder — `bun install`
# only re-runs when a package.json / lockfile changes.
COPY --parents \
    package.json bun.lock bunfig.toml \
    patches/*.patch \
    tsconfig.base.json tsconfig.json \
    packages/*/package.json \
    packages/tsconfig.workspace.json \
    python/reactor-worker/web/package.json \
    /reactor/

RUN bun install --frozen-lockfile --ignore-scripts

# ReActor source. `Dockerfile.dockerignore` keeps **/node_modules out of the context
# so stale isolated-linker symlinks from a host install can't shadow the
# hoisted node_modules that `bun install` just produced.
COPY . /reactor/

# Regenerate the tool views that `--ignore-scripts` skipped above. The root
# package.json's `prepare` script normally handles these on a vanilla install.
RUN bun --cwd=packages/coding-agent run gen:tool-views

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/reactor"]
CMD ["--help"]
