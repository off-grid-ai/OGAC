FROM python:3.11-slim

WORKDIR /app

# System deps: ragas/langchain pull in native wheels that build cleanly on slim; keep image lean.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8002

# Single worker — evals are sequential and LLM-bound; concurrency is bounded by the gateway anyway.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8002"]
