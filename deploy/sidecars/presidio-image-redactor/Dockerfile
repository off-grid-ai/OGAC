FROM python:3.11.15-slim-bookworm@sha256:b18992999dbe963a45a8a4da40ac2b1975be1a776d939d098c647482bcad5cba AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLCONFIGDIR=/tmp/matplotlib
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      fonts-dejavu-core=2.37-6 \
      libgl1=1.6.0-1 \
      libglib2.0-0=2.74.6-2+deb12u9 \
      tesseract-ocr=5.3.0-2 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --require-hashes -r requirements.txt
COPY app.py .

FROM runtime AS verification
COPY test_app.py test_real_engine.py ./
RUN python -m unittest -v test_app.py test_real_engine.py && touch /tmp/real-engine-verified

FROM runtime
COPY --from=verification /tmp/real-engine-verified /app/.real-engine-verified
EXPOSE 8004
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8004", "--workers", "1", "--no-access-log"]
