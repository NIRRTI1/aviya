# AVIYA — your personal AI quiz master

An adaptive, single-question-at-a-time quiz MVP powered by an open-weight model served locally through Ollama, with an optional WebLLM browser mode. React + Vite frontend, FastAPI backend. No paid API keys or cloud LLM calls.

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

Open <http://localhost:5173>. The API docs are at <http://localhost:8000/docs>; health/model status at <http://localhost:8000/health>. For quicker repeat responses, AVIYA keeps the Ollama model loaded for 15 minutes by default and caps context/output sizes. The frontend checks model status once when a quiz starts, shows WebLLM initialization progress, and reports when it has to use quick fallback mode. Quick fallback mode does not claim to AI-grade answers and displays scores as unavailable.

## Configuration

Backend environment variables: `OLLAMA_URL` (default `http://localhost:11434`), `OLLAMA_MODEL` (default `llama3.2:1b`), `OLLAMA_KEEP_ALIVE` (default `15m`), `OLLAMA_TIMEOUT_SECONDS` (default `35`), `OLLAMA_NUM_CTX` (default `2048`), `OLLAMA_NUM_PREDICT` (default `180`), and `CORS_ORIGINS` (comma-separated allowed frontend origins). Frontend `VITE_API_URL` selects the API origin (default `http://localhost:8000`). For example, models supported by your Ollama installation may be selected with `OLLAMA_MODEL=phi3:mini` or `gemma2:2b` after pulling the model. If the model is missing, `/health` now reports that explicitly.

## API

- `POST /upload-material` — multipart file field `file`; PDF, TXT, and Markdown; 10 MB maximum. PDF text extraction uses pypdf.
- `POST /start-quiz` — JSON `{ "topic": "...", "role": "...", "material_id": "optional upload id" }`.
- `POST /submit-answer` — JSON `{ "session_id": "...", "answer": "..." }`; returns 0–10 score, feedback, next question, adaptive difficulty, progress and completion.
- `POST /end-quiz` — JSON `{ "session_id": "..." }`; returns summary and answer history, and deletes the in-memory session.
- `GET /health` — API and Ollama readiness.

Sessions and uploaded materials are in process memory, not persisted. Restarting the API clears them. This MVP is intended for one local user/development use; add durable storage, authentication and request limits before a shared production deployment.

## Architecture and deployment

`frontend/` contains the React/Vite SPA and WebLLM browser fallback; `backend/` contains FastAPI routes, in-memory quiz state, PDF extraction and Ollama integration. Ollama requests reuse an HTTP connection, ask Ollama to keep the model resident, and cap context and generated tokens. Model output uses JSON mode and is validated defensively. WebLLM initializes `Llama-3.2-1B-Instruct-q4f16_1-MLC` on first use, reports load progress in the UI, and requires a WebGPU-compatible browser/device and enough memory. Browser-only inference supports topic quizzes, not document upload. If WebGPU is unavailable, AVIYA can use a quick non-AI server fallback instead of hanging on model initialization.

**Static frontend hosting alone does not provide FastAPI or Ollama.** A Vercel/GitHub Pages deployment (`cd frontend && npm run build`, output `frontend/dist`) can run topic quizzes through WebLLM on supported devices, but each new browser profile needs to download/cache the model before its first inference. Unsupported devices are directed to the quick server fallback. To use local Ollama and document uploads, run FastAPI on the same computer as Ollama and open AVIYA through the local Vite server. Do not expose an unauthenticated Ollama endpoint directly to the public internet. The app does not require a paid LLM API key.

### Vercel + Render

The repository includes `render.yaml` for the FastAPI service. In Render, create a Blueprint from this repository and select `render.yaml`; its service root is `backend`. In Vercel, set Root Directory to `frontend` and `VITE_API_URL` to the Render service URL. A standard Render web service does not include Ollama. Visitors can choose WebLLM for topic quizzes on supported devices, or use the quick no-model fallback without downloading browser model files. Document-based generation requires a local API with Ollama and rejects unsupported hosted material quizzes rather than silently pretending to use the uploaded material. Render free services can take time to wake after inactivity.

## Contributing

Issues and pull requests are welcome. Keep model inference on local/open-weight runtimes and avoid adding paid API dependencies. See [LICENSE](LICENSE).
