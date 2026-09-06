# syntax=docker/dockerfile:1
# Multi-stage image for grok-box Phase 1: box-exec + box-host.

FROM rust:1.85-bookworm AS builder
WORKDIR /src

COPY Cargo.toml rust-toolchain.toml ./
COPY crates ./crates

# Lockfile is copied when present so CI and local builds stay reproducible.
COPY Cargo.lock* ./

RUN cargo build --release -p box-exec -p box-host \
    && strip target/release/box-exec target/release/box-host

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 --shell /bin/bash box \
    && mkdir -p /workspace /home/box/chrome-profile \
    && chown -R box:box /workspace /home/box

COPY --from=builder /src/target/release/box-exec /usr/local/bin/box-exec
COPY --from=builder /src/target/release/box-host /usr/local/bin/box-host
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh /usr/local/bin/box-exec /usr/local/bin/box-host

ENV WORKSPACE_ROOT=/workspace \
    BOX_EXEC_BIND=0.0.0.0:1337 \
    BOX_HOST_BIND=0.0.0.0:1340 \
    BOX_EXEC_URL=http://127.0.0.1:1337 \
    HOME=/home/box \
    RUST_LOG=info

USER box
WORKDIR /workspace
EXPOSE 1337 1340

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
