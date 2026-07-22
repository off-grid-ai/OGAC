"""Bounded private HTTP adapter over Microsoft Presidio image-redactor 0.0.59."""

import asyncio
import base64
import binascii
import io
import os
import re
import secrets
from functools import lru_cache
from importlib.metadata import version
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Request
from PIL import Image, UnidentifiedImageError
from presidio_analyzer import AnalyzerEngine
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_image_redactor import ImageAnalyzerEngine, ImageRedactorEngine

PROVIDER_VERSION = "0.0.59"
MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 20_000_000
MAX_DIMENSION = 10_000
MAX_ENTITIES = 32
OCR_TIMEOUT_SECONDS = 18
ENTITY_TYPE = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
MEDIA_FORMATS = {"image/png": ("PNG", "PNG"), "image/jpeg": ("JPEG", "JPEG")}

Image.MAX_IMAGE_PIXELS = MAX_PIXELS
app = FastAPI(title="Off Grid Presidio image redactor", docs_url=None, redoc_url=None, openapi_url=None)
_ocr_slot = asyncio.Semaphore(1)


def _service_token() -> str:
    token = os.environ.get("PRESIDIO_IMAGE_REDACTOR_TOKEN", "").strip()
    if len(token) < 24 or token == "change-me":
        raise RuntimeError("PRESIDIO_IMAGE_REDACTOR_TOKEN must be a non-default token of at least 24 characters")
    return token


def _authorize(authorization: str | None) -> None:
    expected = f"Bearer {_service_token()}"
    if authorization is None or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


@lru_cache(maxsize=1)
def _engine() -> ImageRedactorEngine:
    if version("presidio-image-redactor") != PROVIDER_VERSION:
        raise RuntimeError("incompatible presidio-image-redactor version")
    provider = NlpEngineProvider(
        nlp_configuration={
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
        }
    )
    analyzer = AnalyzerEngine(nlp_engine=provider.create_engine(), supported_languages=["en"])
    return ImageRedactorEngine(ImageAnalyzerEngine(analyzer_engine=analyzer))


async def _bounded_body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="image exceeds the configured limit")
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_BYTES:
            raise HTTPException(status_code=413, detail="image exceeds the configured limit")
        chunks.append(chunk)
    if total == 0:
        raise HTTPException(status_code=400, detail="image is required")
    return b"".join(chunks)


def _policy(entity_header: str, threshold_header: str) -> tuple[list[str], float]:
    entity_types = sorted({item.strip().upper() for item in entity_header.split(",") if item.strip()})
    if not entity_types or len(entity_types) > MAX_ENTITIES or any(not ENTITY_TYPE.fullmatch(item) for item in entity_types):
        raise HTTPException(status_code=400, detail="invalid entity policy")
    try:
        threshold = float(threshold_header)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="invalid score threshold") from error
    if not 0 <= threshold <= 1:
        raise HTTPException(status_code=400, detail="invalid score threshold")
    return entity_types, threshold


def _load_image(raw: bytes, media_type: str) -> Image.Image:
    expected_format = MEDIA_FORMATS.get(media_type)
    if expected_format is None:
        raise HTTPException(status_code=415, detail="only PNG and JPEG images are supported")
    try:
        image = Image.open(io.BytesIO(raw))
        if image.format != expected_format[0] or getattr(image, "n_frames", 1) != 1:
            raise HTTPException(status_code=415, detail="image bytes do not match the declared media type")
        width, height = image.size
        if width < 1 or height < 1 or width > MAX_DIMENSION or height > MAX_DIMENSION or width * height > MAX_PIXELS:
            raise HTTPException(status_code=413, detail="image exceeds the configured pixel limit")
        image.load()
        return image.convert("RGB")
    except HTTPException:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as error:
        raise HTTPException(status_code=415, detail="invalid image") from error


def _redact_sync(
    raw: bytes, media_type: str, entity_types: list[str], threshold: float
) -> tuple[bytes, int, int, list[dict[str, object]]]:
    image = _load_image(raw, media_type)
    redacted, boxes = _engine().redact_and_return_bbox(
        image,
        fill=(0, 0, 0),
        ocr_kwargs={"ocr_threshold": 30},
        entities=entity_types,
        score_threshold=threshold,
        language="en",
    )
    output = io.BytesIO()
    output_format = MEDIA_FORMATS[media_type][1]
    if output_format == "JPEG":
        redacted.save(output, format=output_format, quality=90, optimize=True)
    else:
        redacted.save(output, format=output_format, optimize=True)
    encoded = output.getvalue()
    if not encoded or len(encoded) > MAX_BYTES:
        raise RuntimeError("redacted image exceeds the configured output limit")
    detections = [
        {"entity_type": box.entity_type, "score": round(float(box.score), 6)}
        for box in boxes
    ]
    return encoded, redacted.width, redacted.height, detections


def _release_ocr_slot(task: asyncio.Task[object]) -> None:
    try:
        task.exception()
    except (asyncio.CancelledError, Exception):
        pass
    _ocr_slot.release()


async def _bounded_redaction(
    raw: bytes, media_type: str, entity_types: list[str], threshold: float
) -> tuple[bytes, int, int, list[dict[str, object]]]:
    await _ocr_slot.acquire()
    task = asyncio.create_task(asyncio.to_thread(_redact_sync, raw, media_type, entity_types, threshold))
    try:
        result = await asyncio.wait_for(asyncio.shield(task), timeout=OCR_TIMEOUT_SECONDS)
    except TimeoutError as error:
        task.add_done_callback(_release_ocr_slot)
        raise HTTPException(status_code=504, detail="image redaction timed out") from error
    except asyncio.CancelledError:
        # A disconnected caller must not release the slot while its non-cancellable OCR thread is
        # still running. The callback consumes that task and releases exactly when the worker exits.
        task.add_done_callback(_release_ocr_slot)
        raise
    except Exception:
        _ocr_slot.release()
        raise
    _ocr_slot.release()
    return result


@app.get("/health")
async def health(authorization: Annotated[str | None, Header()] = None) -> dict[str, str]:
    _authorize(authorization)
    try:
        await asyncio.wait_for(asyncio.to_thread(_engine), timeout=OCR_TIMEOUT_SECONDS)
    except TimeoutError as error:
        raise HTTPException(status_code=503, detail="engine initialization timed out") from error
    return {"status": "ok", "engine": "presidio-image-redactor", "version": PROVIDER_VERSION}


@app.post("/v1/redact")
async def redact(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    x_offgrid_entity_types: Annotated[str, Header()] = "",
    x_offgrid_score_threshold: Annotated[str, Header()] = "",
) -> dict[str, object]:
    _authorize(authorization)
    media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    entity_types, threshold = _policy(x_offgrid_entity_types, x_offgrid_score_threshold)
    raw = await _bounded_body(request)
    try:
        redacted, width, height, detections = await _bounded_redaction(raw, media_type, entity_types, threshold)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail="image redaction provider failed") from error
    try:
        encoded = base64.b64encode(redacted).decode("ascii")
    except (binascii.Error, UnicodeError) as error:
        raise HTTPException(status_code=503, detail="image redaction provider failed") from error
    return {
        "engine": "presidio-image-redactor",
        "engine_version": PROVIDER_VERSION,
        "ocr_engine": "tesseract",
        "media_type": media_type,
        "redacted_image_base64": encoded,
        "width": width,
        "height": height,
        "detections": detections,
    }
