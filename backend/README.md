# AVIYA API

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Set `OLLAMA_MODEL`, `OLLAMA_URL`, or `CORS_ORIGINS` as needed. API docs: `http://localhost:8000/docs`.
