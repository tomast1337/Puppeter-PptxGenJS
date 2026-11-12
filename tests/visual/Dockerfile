# Pinned environment for `bun run test:visual`. LibreOffice renders the
# reference PDFs, and its output depends on installed fonts: with identical
# LibreOffice 26.2.6.3, Carlito vs Noto Sans fallback moved the chart page
# reference by 0.092 RMSE. Pin everything so references are reproducible.
FROM ubuntu:26.04@sha256:6a06111c3b0a8600feadb270aec771dc239bf407b25625f93f44ab00e11f4d3c
LABEL org.opencontainers.image.source=https://github.com/tomast1337/Puppeter-PptxGenJS

ARG APT_SNAPSHOT=20261110T000000Z
ARG BUN_VERSION=1.4.0
ENV DEBIAN_FRONTEND=noninteractive

# snapshot.ubuntu.com intermittently fails TLS/fetches; retry instead of failing the build.
RUN echo 'Acquire::Retries "5";' > /etc/apt/apt.conf.d/80-retries \
    && apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && apt-get update --snapshot "$APT_SNAPSHOT" \
    && apt-get install --yes --no-install-recommends --snapshot "$APT_SNAPSHOT" \
        curl unzip \
        imagemagick libreoffice-impress poppler-utils \
        fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation fonts-dejavu-core \
        libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 \
        libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" -o /tmp/bun.zip \
    && unzip -q /tmp/bun.zip -d /tmp \
    && install -m 755 /tmp/bun-linux-x64/bun /usr/local/bin/bun \
    && rm -rf /tmp/bun.zip /tmp/bun-linux-x64

# Dependencies (and Puppeteer's Chromium) come from the lockfile; source is mounted at run time.
ENV PUPPETEER_CACHE_DIR=/opt/puppeteer
WORKDIR /deps
COPY package.json bun.lock ./
# Only chrome-headless-shell is used (src/browser.ts); skipping full Chrome saves ~360MB.
RUN PUPPETEER_CHROME_SKIP_DOWNLOAD=true bun ci && chmod -R a+rX /deps /opt/puppeteer

# Runs as the host user so artifacts stay owned by them.
RUN mkdir -m 1777 /work
ENV HOME=/tmp TMPDIR=/out
WORKDIR /work
CMD ["sh", "-c", "tar -C /repo --exclude=./node_modules --exclude=./.git --exclude=./dist --exclude=./.visual-parity -cf - . | tar --no-overwrite-dir -xf - && ln -s /deps/node_modules node_modules && bun run test:visual"]
