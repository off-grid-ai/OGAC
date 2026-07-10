# Off Grid AI gateway — headless, self-hostable.
# The platform inference binaries (llama-server, sd-cli, whisper, ffmpeg) are
# large and OS-specific, so they're mounted at runtime rather than baked in:
#   docker run -p 7878:7878 \
#     -v /models:/data/models -v /opt/offgrid/bin:/bin/offgrid \
#     -e OFFGRID_DATA_DIR=/data -e OFFGRID_BIN_DIR=/bin/offgrid \
#     ghcr.io/off-grid-ai/gateway
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production OFFGRID_DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 7878
ENTRYPOINT ["node", "dist/cli.js"]
