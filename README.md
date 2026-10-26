# AVIYA — your personal AI quiz master

An adaptive, single-question-at-a-time quiz MVP powered by an open-weight model served locally through Ollama, with an automatic WebLLM browser fallback. React + Vite frontend, FastAPI backend. No paid API keys or cloud LLM calls.

## Requirements

- Python 3.10+
- Node.js 20+
- Ollama (optional for launch; required for model-generated questions and personalized evaluation)

## Run locally

In one terminal, install/start Ollama and pull the compact default model:

```bash
ollama serve                  # if Ollama is not already running
ollama pull llama3.2:1b
```

In another terminal, start FastAPI:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate     # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
cp .env.example .env          # optional; defaults work on local Ollama
uvicorn app.main:app --reload --port 8000
```

In a third terminal, start the UI:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The API docs are at <http://localhost:8000/docs>; health/model status at <http://localhost:8000/health>. If Ollama is unavailable, the API uses a clear deterministic fallback instead of failing. If the browser cannot reach FastAPI (for example, a static-only deployment), the frontend dynamically loads WebLLM and runs quiz inference in-browser.

## Configuration

Backend environment variables: `OLLAMA_URL` (default `http://localhost:11434`), `OLLAMA_MODEL` (default `llama3.2:1b`), and `CORS_ORIGINS` (comma-separated allowed frontend origins). Frontend `VITE_API_URL` selects the API origin (default `http://localhost:8000`). For example, models supported by your Ollama installation may be selected with `OLLAMA_MODEL=phi3:mini` or `gemma2:2b` after pulling the model.

## API

- `POST /upload-material` — multipart file field `file`; PDF, TXT, and Markdown; 10 MB maximum. PDF text extraction uses pypdf.
- `POST /start-quiz` — JSON `{ "topic": "...", "role": "...", "material_id": "optional upload id" }`.
- `POST /submit-answer` — JSON `{ "session_id": "...", "answer": "..." }`; returns 0–10 score, feedback, next question, adaptive difficulty, progress and completion.
- `POST /end-quiz` — JSON `{ "session_id": "..." }`; returns summary and answer history, and deletes the in-memory session.
- `GET /health` — API and Ollama readiness.

Sessions and uploaded materials are in process memory, not persisted. Restarting the API clears them. This MVP is intended for one local user/development use; add durable storage, authentication and request limits before a shared production deployment.

## Architecture and deployment

`frontend/` contains the React/Vite SPA and WebLLM browser fallback; `backend/` contains FastAPI routes, ephemeral quiz state, PDF extraction and Ollama integration. Model output requests Ollama JSON mode, validates response shape defensively, and falls back on malformed/unavailable responses. WebLLM downloads the `Llama-3.2-1B-Instruct-q4f16_1-MLC` model on first use (several GB of browser assets may be downloaded/cached); it requires a compatible WebGPU-enabled browser and sufficient device memory. Browser-only fallback supports topic quizzes; document upload remains available through the FastAPI API.

**Static frontend hosting alone does not provide FastAPI or Ollama.** A Vercel/GitHub Pages deployment (`cd frontend && npm run build`, output `frontend/dist`) works for topic quizzes using the WebLLM browser fallback; users need a compatible WebGPU browser and make a large first-run model download. To use the server model and upload documents, separately host FastAPI and an Ollama-compatible model service over HTTPS, set `VITE_API_URL` at frontend build time, and configure backend `CORS_ORIGINS` for the deployed frontend origin. Do not expose an unauthenticated Ollama endpoint directly to the public internet. The app is usable locally with API + Ollama without paid API keys.

## Contributing

Issues and pull requests are welcome. Keep model inference on local/open-weight runtimes and avoid adding paid API dependencies. See [LICENSE](LICENSE).
