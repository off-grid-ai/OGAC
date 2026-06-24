#!/usr/bin/env python3
# Generate an architecture diagram via OpenRouter (Gemini image model), the same pipeline the reel
# generator uses. Reads the API key from env (LLM_API_KEY or OPENROUTER_API_KEY) or a .env file —
# never hardcoded. Model override via DIAGRAM_MODEL. Usage:
#   LLM_API_KEY=... python3 scripts/gen-diagram.py docs/diagrams/01-five-planes.txt
import base64, json, os, pathlib, sys, urllib.error, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = os.environ.get("DIAGRAM_MODEL", "google/gemini-3-pro-image-preview")


def load_key() -> str:
    for name in ("LLM_API_KEY", "OPENROUTER_API_KEY"):
        if os.environ.get(name):
            return os.environ[name]
    for env_path in (ROOT / ".env", ROOT / ".env.local"):
        if not env_path.exists():
            continue
        for line in env_path.read_text().splitlines():
            line = line.strip()
            for name in ("LLM_API_KEY", "OPENROUTER_API_KEY"):
                if line.startswith(name) and "=" in line:
                    v = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if v:
                        return v
    sys.exit("missing LLM_API_KEY / OPENROUTER_API_KEY (export it or put it in .env)")


def extract_image(msg: dict):
    # Shape A: message.images = [{"image_url": {"url": "data:..."}}]
    for img in msg.get("images") or []:
        url = img.get("image_url", {}).get("url") if isinstance(img, dict) else None
        if url and url.startswith("data:"):
            return url.split(",", 1)[1]
    # Shape B: content is a list of parts with image_url
    content = msg.get("content")
    if isinstance(content, list):
        for part in content:
            if part.get("type") == "image_url":
                url = part.get("image_url", {}).get("url", "")
                if url.startswith("data:"):
                    return url.split(",", 1)[1]
    # Shape C: content is a data URL string
    if isinstance(content, str) and content.startswith("data:"):
        return content.split(",", 1)[1]
    return None


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("usage: gen-diagram.py <prompt.txt> [out_basename]")
    prompt_path = pathlib.Path(sys.argv[1])
    if not prompt_path.is_absolute():
        prompt_path = ROOT / prompt_path
    out_base = sys.argv[2] if len(sys.argv) > 2 else prompt_path.stem
    prompt = prompt_path.read_text()

    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        "modalities": ["image", "text"],
    }
    req = urllib.request.Request(
        URL,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {load_key()}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://offgrid.ai",
            "X-Title": "Off Grid Console Diagrams",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} ({MODEL}): {e.read().decode()[:1000]}")

    choices = body.get("choices", [])
    b64 = extract_image(choices[0].get("message", {})) if choices else None
    if not b64:
        print(json.dumps(body, indent=2)[:2000])
        sys.exit("no image returned")
    out = prompt_path.parent / f"{out_base}.png"
    out.write_bytes(base64.b64decode(b64))
    print(f"saved: {out} ({out.stat().st_size} bytes)  model={MODEL}")


if __name__ == "__main__":
    main()
