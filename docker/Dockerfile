# syntax=docker/dockerfile:1
# grok-box: box-exec + box-host + Xvfb desktop + Chromium + CUA tools.

FROM rust:1.85-bookworm AS builder
WORKDIR /src

COPY Cargo.toml rust-toolchain.toml ./
COPY crates ./crates
COPY Cargo.lock* ./

RUN cargo build --release -p box-exec -p box-host \
    && strip target/release/box-exec target/release/box-host

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        tini \
        xvfb \
        x11vnc \
        novnc \
        websockify \
        openbox \
        x11-utils \
        xfonts-base \
        fonts-liberation \
        xdotool \
        imagemagick \
        scrot \
        chromium \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 --shell /bin/bash box \
    && mkdir -p /workspace /home/box/chrome-profile /home/box/.vnc \
    && chown -R box:box /workspace /home/box

COPY --from=builder /src/target/release/box-exec /usr/local/bin/box-exec
COPY --from=builder /src/target/release/box-host /usr/local/bin/box-host
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh /usr/local/bin/box-exec /usr/local/bin/box-host

ENV WORKSPACE_ROOT=/workspace \
    BOX_EXEC_BIND=0.0.0.0:1337 \
    BOX_HOST_BIND=0.0.0.0:1340 \
    BOX_EXEC_URL=http://127.0.0.1:1337 \
    BOX_DESKTOP=1 \
    BOX_DESKTOP_REQUIRED=1 \
    BOX_DISPLAY=:1 \
    BOX_DISPLAY_GEOM=1280x800x24 \
    BOX_VNC_BIND=127.0.0.1:5900 \
    BOX_NOVNC_PORT=6080 \
    BOX_NOVNC_WEB=/usr/share/novnc \
    BOX_CHROME=1 \
    BOX_CHROME_PROFILE=/home/box/chrome-profile \
    BOX_CDP_PORT=9222 \
    BOX_CUA=1 \
    DISPLAY=:1 \
    HOME=/home/box \
    RUST_LOG=info

USER box
WORKDIR /workspace
EXPOSE 1337 1340 6080

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
