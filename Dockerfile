# CODO HARNESS for Linux hosts and Docker on a Mac.
FROM eclipse-temurin:25-jdk AS jdk

FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash bubblewrap ca-certificates curl g++ gh git make python3 ripgrep unzip zstd \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# Language servers for the lsp tool. jdtls runs on JDK 25 or newer.
COPY --from=jdk /opt/java/openjdk /opt/java
ENV JAVA_HOME=/opt/java
ENV PATH=/opt/java/bin:$PATH
RUN npm install -g typescript-language-server@6.0.3 typescript@6.0.3 \
  && curl -fsSL -o /tmp/jdtls.conda https://conda.anaconda.org/conda-forge/noarch/jdtls-1.63.0-hc364b38_0.conda \
  && echo 'c5e92b6acf4cb4514f164384c9644d98c6ecb8ac6fd49a4d2bb6d94812be0ae6  /tmp/jdtls.conda' | sha256sum -c - \
  && mkdir -p /tmp/jdtls \
  && unzip -p /tmp/jdtls.conda 'pkg-jdtls-*.tar.zst' | zstd -dc | tar -xf - -C /tmp/jdtls \
  && mv /tmp/jdtls/libexec/jdtls /opt/jdtls \
  && ln -s /opt/jdtls/bin/jdtls /usr/local/bin/jdtls \
  && rm -rf /tmp/jdtls /tmp/jdtls.conda

WORKDIR /app
COPY . .

ENV DSH_CLIENT_COMMIT_HASH=0000000
RUN pnpm install --frozen-lockfile && pnpm run build --scope artifacts

RUN useradd --create-home --uid 1001 codo && mkdir -p /data/home /data/team /home/codo/.config/gh \
  && chown -R codo:codo /data /home/codo/.config
USER codo

ENV DSH_HOME=/data/home \
    CODO_TEAM_DATA_DIR=/data/team \
    CODO_REPOS_DIR=/repos

EXPOSE 3080
ENTRYPOINT ["/app/docker/entrypoint.sh"]
