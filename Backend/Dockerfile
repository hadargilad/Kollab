FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --timeout 1000 --retries 10 torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir --timeout 600 --retries 5 -r requirements.txt

COPY . .

EXPOSE 8001

ENV AUDIO_INTEL_DB=/data/AudioIntelDB.db

CMD ["python", "-m", "uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8001", "--reload"]
