FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FFMPEG=ffmpeg \
    FFPROBE=ffprobe \
    UPLOAD_FOLDER=/app/backend_python/uploads \
    OUTPUT_CLIP_FOLDER=/app/backend_python/output_clips \
    ANOMALY_MODEL_FALLBACK_PATH=/app/backend_python/detector3.pth

WORKDIR /app/backend_python

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip \
    && pip install --index-url https://download.pytorch.org/whl/cpu \
        torch==2.5.1+cpu torchvision==0.20.1+cpu \
    && grep -v '^torch$' requirements.txt > requirements.docker.txt \
    && pip install -r requirements.docker.txt

COPY . .

RUN mkdir -p uploads output_clips

EXPOSE 5000

CMD ["python", "main.py"]
