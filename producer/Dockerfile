FROM python:3.11-slim
WORKDIR /app
RUN pip install fastapi uvicorn redis pydantic --no-cache-dir
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]