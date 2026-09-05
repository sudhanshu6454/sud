FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    AUTOPUB_CONFIG=/app/config/sites.yaml \
    AUTOPUB_DATA_DIR=/data

RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY autopub ./autopub
COPY config ./config

VOLUME ["/data"]
HEALTHCHECK --interval=5m --timeout=30s CMD python -c "import sqlite3,os,sys; sys.exit(0 if os.path.exists('/data/autopub.db') else 1)"

CMD ["python", "-m", "autopub", "serve"]
