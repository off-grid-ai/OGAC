# @offgrid/gateway

The **local, OpenAI-compatible gateway** behind [Off Grid AI](https://getoffgridai.co) —
run open models (text, vision, image, voice, speech) entirely **on-device**, behind one API.
No cloud, no account, no API key.

It runs two ways from one codebase:

- **Embedded** — Off Grid AI Desktop injects its Electron paths and runs the gateway in-process.
- **Standalone** — `offgrid-gateway` (or the Docker image) runs it headless on its own box.

```bash
# standalone (Node)
OFFGRID_DATA_DIR=~/.offgrid OFFGRID_BIN_DIR=/opt/offgrid/bin npx @offgrid/gateway
# → http://127.0.0.1:7878  (OpenAI-compatible: /v1/chat/completions, /v1/images, …)
```

```bash
# Docker (mount your models + platform binaries)
docker run -p 7878:7878 \
  -v /models:/data/models -v /opt/offgrid/bin:/bin/offgrid \
  -e OFFGRID_DATA_DIR=/data -e OFFGRID_BIN_DIR=/bin/offgrid \
  ghcr.io/off-grid-ai/gateway
```

## Configuration

All host-specific paths resolve through one seam (`runtime-env`):

| Env var                | Meaning                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `OFFGRID_DATA_DIR`     | writable dir for models, caches, generated output                         |
| `OFFGRID_BIN_DIR`      | dir holding the platform binaries (llama-server, sd-cli, whisper, ffmpeg) |
| `OFFGRID_RESOURCE_DIR` | dir holding bundled resources (tts worker, …)                             |
| `OFFGRID_GATEWAY_PORT` | listen port (default `7878`)                                              |

Embedded hosts call `configureRuntime({ dataDir, binRoots, resourceDirs })` instead.

## Status

`v0.1` — the host-agnostic config seam + deployment surface (CLI, Docker, CI for
GitHub Packages + GHCR) are in place. The OpenAI-compatible inference handlers
(chat/vision/image/audio/embeddings) are migrating from the desktop runtime; until
then the standalone server exposes `/healthz` and `/v1/models`.

## License

[Off Grid AI Source-Available License 1.0](LICENSE). Free community use is limited to 25 users.
© Off Grid AI / Wednesday Solutions, Inc.
