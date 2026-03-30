# ─────────────────────────────────────────────────────────────────────────────
# Investment Agent — Dockerfile
#
# Multi-stage build:
#   Stage 1 (deps)  — install only production dependencies
#   Stage 2 (final) — lean runtime image with Chromium for WhatsApp support
#
# Build:
#   docker build -t investment-agent .
#
# Run:
#   docker run -d --env-file .env -v $(pwd)/data:/app/data \
#     -v $(pwd)/logs:/app/logs -v $(pwd)/.wwebjs_auth:/app/.wwebjs_auth \
#     --name investment-agent investment-agent
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:22-slim AS deps

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production deps only.
# PUPPETEER_SKIP_DOWNLOAD=true — we install Chromium from the OS package manager
# in the final stage instead of using puppeteer's bundled binary.
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev --no-audit --no-fund

# ── Stage 2: Runtime image ────────────────────────────────────────────────────
FROM node:22-slim AS final

# Install Chromium + system deps required by whatsapp-web.js / puppeteer
# and better-sqlite3 native bindings (already compiled in node_modules,
# but needs libstdc++ at runtime).
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    ca-certificates \
    tzdata \
  && rm -rf /var/lib/apt/lists/*

# Tell puppeteer (and whatsapp-web.js) to use the system Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Set timezone to IST by default (overridable via TZ env var)
ENV TZ=Asia/Kolkata

WORKDIR /app

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY src/        ./src/
COPY index.js    ./index.js
COPY package.json ./package.json

# Create persistent directories that will be volume-mounted
RUN mkdir -p data uploads logs .wwebjs_auth .wwebjs_cache

# Run as non-root user for security
RUN groupadd -r agent && useradd -r -g agent -d /app agent \
  && chown -R agent:agent /app
USER agent

# Expose no ports — this is a background agent, not a web server
# (Telegram/WhatsApp communicate outbound only)

# Health check — verifies the process is still alive
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('./src/db'); process.exit(0)" || exit 1

CMD ["node", "index.js"]
