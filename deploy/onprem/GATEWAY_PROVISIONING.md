# Off Grid — Gateway Node Provisioning

How to turn a bare macOS Apple-Silicon MacBook into an Off Grid inference gateway.
This is the battle-tested path — every gotcha is documented here.

> **Coordinator**: run every command from the coordinator Mac over SSH.
> Nodes are SSH-accessible: `sshpass -p 1234 ssh -tt -o PreferredAuthentications=password -o PubkeyAuthentication=no admin@<ip>`
> Always `ssh-keyscan <ip> >> ~/.ssh/known_hosts` first to avoid host-key prompts.

---

## Cluster topology (current)

| Node | IP | Role | Model |
|---|---|---|---|
| offgrid-s1 | 127.0.0.1 | Control plane (Console + Postgres + Keycloak + aggregator) | — |
| offgrid-s2 | 192.168.1.60 | Console standby | — |
| g1 | 192.168.1.57 | Gateway | qwythos-9b (vision) |
| g2 | 192.168.1.58 | Gateway | qwen3.5-9b (vision) |
| g3 | 192.168.1.32 | Gateway | gemma-4-e4b (vision) |
| g4 | 192.168.1.63 | Gateway | gemma-4-e4b (vision) |
| g5 | 192.168.1.65 | Gateway | qwen3.5-9b (vision) |
| g6 | 192.168.1.66 | Gateway | qwen3-coder-30b (text) |
| g7 | 192.168.1.62 | Gateway | qwen3-coder-30b (text) |
| g8 | 192.168.1.64 | Gateway | TBD — confirm model before pulling |

The aggregator at s1:8800 round-robins per model across all nodes that share it.
**s1 and s2 are control-plane only — never install a gateway on them.**

---

## Model reference

| Model tag | HF repo | Primary GGUF | mmproj | ctxSize |
|---|---|---|---|---|
| `gemma-4-e4b` | `unsloth/gemma-4-E4B-it-GGUF` | `gemma-4-E4B-it-Q4_K_M.gguf` | `mmproj-gemma-4-E4B-it-F16.gguf` | 65536 |
| `qwen3.5-9b` | `unsloth/Qwen3.5-9B-GGUF` | `Qwen3.5-9B-Q4_K_M.gguf` | `mmproj-Qwen3.5-9B-F16.gguf` | 65536 |
| `qwythos-9b` | `empero-ai/Qwythos-9B-Claude-Mythos-5-1M-GGUF` | `Qwythos-9B-Claude-Mythos-5-1M-Q4_K_M.gguf` | `mmproj-Qwythos-9B-Claude-Mythos-5-1M-f16.gguf` | 65536 |
| `qwen3-coder` | `unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF` | `Qwen3-Coder-30B-A3B-Instruct-UD-IQ3_XXS.gguf` | null | 8192 |

> **ctxSize for 30B models:** IQ3_XXS weights are ~12.8 GB on 16 GB RAM — very little
> headroom for KV cache. Keep ctxSize at 8192–16384. Symptom of too-high ctx:
> `failed to find free space in the KV cache` in `~/gateway.log` + requests hang (HTTP 000).
> A gateway restart clears accumulated stuck tasks.

---

## Step-by-step provisioning

### 0. No-sleep (do this first)

```bash
echo 1234 | sudo -S pmset -a disablesleep 1 && echo 1234 | sudo -S pmset -c sleep 0 disksleep 0
```

### 1. Copy the app (tar-over-ssh — avoids rsync path-with-spaces issues)

**From the coordinator Mac:**

```bash
tar -C "/path/to/desktop/dist/mac-arm64" -czf - "Off Grid AI.app" | \
  sshpass -p 1234 ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no \
    admin@<ip> 'mkdir -p ~/offgrid-app && tar -xzf - -C ~/offgrid-app/'
```

The app lives at `~/offgrid-app/Off Grid AI.app` on every gateway node.

### 2. Replace the llama backends

**Critical — the packaged `Contents/Resources/bin/llama` has split/version-mismatched ggml
backends that cause "no backends loaded" at startup. Always replace with the colocated set:**

```bash
tar -C "/path/to/desktop/resources/bin/llama" -czf - . | \
  sshpass -p 1234 ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no \
    admin@<ip> 'tar -xzf - -C ~/offgrid-app/"Off Grid AI.app"/Contents/Resources/bin/llama/'
```

### 3. Re-sign the app

**rsync/tar breaks the macOS code signature — always re-sign on the node after copying:**

```bash
# SSH into the node, then:
codesign --force --deep --sign - ~/offgrid-app/"Off Grid AI.app"
```

### 4. Create model directory and download GGUFs

```bash
mkdir -p ~/.offgrid/models

# Primary GGUF:
curl -L "https://huggingface.co/<repo>/resolve/main/<file.gguf>" \
  -o ~/.offgrid/models/<file.gguf> --progress-bar

# mmproj (if vision node):
curl -L "https://huggingface.co/<repo>/resolve/main/<mmproj.gguf>" \
  -o ~/.offgrid/models/<mmproj.gguf> --progress-bar
```

Use `-C -` to resume interrupted downloads.

### 5. Write active-model.json (use cat HEREDOC — never printf, it mangles JSON)

```bash
cat > ~/.offgrid/models/active-model.json <<'EOF'
{"id":"<hf-repo>","primary":"<file.gguf>","mmproj":"<mmproj.gguf or null>"}
EOF
```

### 6. Write llm-settings.json

For 9B / E4B nodes (plenty of headroom):
```bash
cat > ~/.offgrid/models/llm-settings.json <<'EOF'
{"performanceMode":"extreme","ctxSize":65536,"kvCacheType":"q8_0","flashAttn":true}
EOF
```

For 30B coder node (tight on RAM):
```bash
cat > ~/.offgrid/models/llm-settings.json <<'EOF'
{"performanceMode":"extreme","ctxSize":8192,"kvCacheType":"q8_0","flashAttn":true}
EOF
```

### 7. Install the LaunchAgent

```bash
mkdir -p ~/Library/LaunchAgents
cat > ~/Library/LaunchAgents/co.getoffgridai.gateway.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>EnvironmentVariables</key>
	<dict>
		<key>LLAMA_ARG_REASONING</key>
		<string>off</string>
		<key>OFFGRID_DATA_DIR</key>
		<string>/Users/admin/.offgrid</string>
		<key>OFFGRID_SERVER_ONLY</key>
		<string>1</string>
	</dict>
	<key>KeepAlive</key>
	<true/>
	<key>Label</key>
	<string>co.getoffgridai.gateway</string>
	<key>ProgramArguments</key>
	<array>
		<string>/Users/admin/offgrid-app/Off Grid AI.app/Contents/MacOS/Off Grid AI</string>
		<string>--server-only</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/admin/gateway.log</string>
	<key>StandardOutPath</key>
	<string>/Users/admin/gateway.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/co.getoffgridai.gateway.plist
launchctl kickstart -k gui/$(id -u)/co.getoffgridai.gateway
```

> **Must be a gui-domain LaunchAgent (not a root LaunchDaemon).** Headless Electron
> needs a WindowServer session — root daemons don't have one and the app dies silently.

> **LLAMA_ARG_REASONING=off** is required for reasoning models (Qwen3 etc.) — without it
> they burn all tokens "thinking" and return empty content.

### 8. Verify

```bash
# From coordinator:
curl http://<ip>:7878/health          # → 200 + JSON with modalities
curl http://<ip>:7878/v1/models       # → model id listed

# Real inference check:
curl -s http://<ip>:7878/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"ping"}],"max_tokens":5}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'])"
```

For vision nodes, `curl http://<ip>:7878/health | python3 -m json.tool` should show
`"vision_understanding": "ready"`.

---

## Adding a node to the aggregator

Edit `console/scripts/gateway-aggregator.mjs` on the coordinator Mac — add an entry to `POOL`:

```js
{ name: 'g9', host: '192.168.1.XX', port: 7878, vision: true, model: 'gemma-4-e4b' },
```

Then deploy to s1 and restart:

```bash
sshpass -p 1234 scp -o PreferredAuthentications=password -o PubkeyAuthentication=no \
  console/scripts/gateway-aggregator.mjs admin@127.0.0.1:~/offgrid/console/scripts/gateway-aggregator.mjs

sshpass -p 1234 ssh -tt -o PreferredAuthentications=password -o PubkeyAuthentication=no admin@127.0.0.1 \
  'echo 1234 | sudo -S launchctl kickstart -k system/co.getoffgridai.aggregator'
```

Verify: `curl http://127.0.0.1:8800/` — new node should appear in `gateways[]`.

---

## Round-robin verification

Fire two requests with the same model tag and check the `x-offgrid-gateway` response header alternates:

```bash
for i in 1 2; do
  curl -si http://127.0.0.1:8800/v1/chat/completions \
    -H 'content-type: application/json' \
    -d '{"model":"gemma-4-e4b","messages":[{"role":"user","content":"hi"}],"max_tokens":3}' \
    | grep x-offgrid-gateway
done
```

---

## OrbStack note

OrbStack is only on s1 (Postgres + Keycloak containers). Gateway nodes have no Docker.
If you later want to run distributed OSS services (OpenSearch, Langfuse, Temporal) on spare
nodes, OrbStack has a first-run GUI step that requires a logged-in session — SSH can drop
the .dmg but cannot click through the initial dialog. Plan for a one-time physical/screen-share
tap per node for that use-case. Pure colima/docker headless is an alternative.
