# Unstream API — FastAPI + yt-dlp + ffmpeg
# uv is a build-time dependency only; keeping it in a separate stage avoids
# shipping its ~50 MB binary in the production image.
FROM ghcr.io/astral-sh/uv:latest AS uv

FROM python:3.12-slim AS runtime

# ffmpeg for audio conversion, dumb-init for clean signal handling, gosu to
# drop from root to PUID/PGID once the mounts have been handed over.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg dumb-init gosu ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

# A JavaScript runtime, because YouTube's player now hands out challenges that
# have to be *run* to get a stream URL. yt-dlp shells out to one of deno / bun
# / node / quickjs to do that and ships the solver script itself; with none
# installed it silently falls back to the one client that asks no questions
# (android_vr), which is also the client a datacenter IP gets bot-checked on
# first. That fallback is why this works from a laptop and 502s from a VPS.
ARG DENO_VERSION=v2.9.5
ARG TARGETARCH
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
        amd64) DENO_ARCH=x86_64-unknown-linux-gnu ;; \
        arm64) DENO_ARCH=aarch64-unknown-linux-gnu ;; \
        *) echo "no deno build for ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/deno.zip \
        "https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-${DENO_ARCH}.zip"; \
    unzip -q /tmp/deno.zip -d /usr/local/bin; \
    chmod 755 /usr/local/bin/deno; \
    rm /tmp/deno.zip; \
    deno --version

# Install Python dependencies in a throwaway build stage. The final stage
# copies only the resulting virtualenv, not uv or the lockfile tooling.
FROM runtime AS builder
WORKDIR /app
COPY --from=uv /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

FROM runtime
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY app ./app

# /app/cache is created here rather than left to the volume: Docker seeds a
# named volume's ownership from the image's directory, and with no directory
# to copy it lands root-owned, which appuser cannot write the solver into.
RUN useradd -u 1001 -m appuser \
    && mkdir -p /app/downloads /app/data /app/cache \
    && chown -R appuser:appuser /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# No USER here, deliberately. The container starts as root, hands the mounted
# directories to PUID/PGID and immediately drops to them — which is what lets
# a bind mount to someone's own music folder work at all. The server itself
# never runs as root; see docker-entrypoint.sh. Set `user:` in compose to
# skip the root step entirely, and the entrypoint gets out of the way.
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"

ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
