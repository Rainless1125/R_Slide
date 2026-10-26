# R Slide 的 Docker 映像檔：FastAPI + uvicorn，資料庫存在 /app/data（以 volume 保存）
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# 先只複製 requirements.txt，程式碼改動時不必重新安裝套件
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# 以非 root 帳號執行；data/ 是 SQLite 資料庫所在目錄
RUN useradd --create-home --uid 1000 rslide \
    && mkdir -p /app/data \
    && chown -R rslide:rslide /app/data
USER rslide

EXPOSE 8000

# 容器內須監聽 0.0.0.0，主機才連得到；不用 python app.py（開發模式只監聽 127.0.0.1）
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
