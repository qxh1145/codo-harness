# CODO HARNESS for Linux hosts and Docker on a Mac.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash bubblewrap ca-certificates g++ gh git make python3 ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

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
