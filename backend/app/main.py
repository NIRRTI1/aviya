from __future__ import annotations

import io
import json
import os
import re
import uuid
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")
OLLAMA_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "15m")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "35"))
OLLAMA_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", "2048"))
OLLAMA_NUM_PREDICT = int(os.getenv("OLLAMA_NUM_PREDICT", "180"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    timeout = httpx.Timeout(connect=3.0, read=OLLAMA_TIMEOUT, write=10.0, pool=3.0)
    app.state.ollama_client = httpx.AsyncClient(timeout=timeout)
    yield
    await app.state.ollama_client.aclose()


app = FastAPI(title="AVIYA API", version="0.2.0", lifespan=lifespan)
origins = [origin.strip() for origin in os.getenv(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

SESSIONS: dict[str, dict[str, Any]] = {}
MATERIALS: dict[str, str] = {}


class StartRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=500)
    role: str = Field(default="Curious expert", max_length=100)
    material_id: str | None = None


class AnswerRequest(BaseModel):
    session_id: str
    answer: str = Field(min_length=1, max_length=5000)


async def ask_model(system: str, prompt: str, fallback: dict[str, Any], *, max_tokens: int | None = None) -> tuple[dict[str, Any], bool]:
    """Call the configured local Ollama model and return (result, model_was_used)."""
    try:
        response = await app.state.ollama_client.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "stream": False,
                "keep_alive": OLLAMA_KEEP_ALIVE,
                "format": "json",
                "options": {
                    "num_ctx": OLLAMA_NUM_CTX,
                    "num_predict": max_tokens or OLLAMA_NUM_PREDICT,
                    "temperature": 0.35,
                },
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
            },
        )
        response.raise_for_status()
        content = response.json().get("message", {}).get("content", "")
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", content, re.S)
            if not match:
                return fallback, False
            parsed = json.loads(match.group())
        return (parsed, True) if isinstance(parsed, dict) else (fallback, False)
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return fallback, False


def safe_int(value: Any, default: int, low: int, high: int) -> int:
    try:
        return max(low, min(high, int(value)))
    except (ValueError, TypeError):
        return default


async def get_ollama_status() -> tuple[bool, str]:
    try:
        response = await app.state.ollama_client.get(f"{OLLAMA_URL}/api/tags", timeout=4.0)
        response.raise_for_status()
        names = {str(model.get("name", "")) for model in response.json().get("models", [])}
        available = OLLAMA_MODEL in names
        return available, "model_ready" if available else "model_not_pulled"
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return False, "ollama_unreachable"


@app.get("/health")
async def health():
    available, reason = await get_ollama_status()
    return {
        "status": "ok",
        "ollama_available": available,
        "model_available": available,
        "model": OLLAMA_MODEL,
        "inference": "ollama" if available else "quick_fallback",
        "reason": reason,
    }


@app.post("/upload-material")
async def upload_material(file: UploadFile = File(...)):
    name = file.filename or "material.txt"
    raw = await file.read(10_000_001)
    if len(raw) > 10_000_000:
        raise HTTPException(413, "File exceeds 10 MB limit")
    if name.lower().endswith(".pdf"):
        try:
            from pypdf import PdfReader
            text = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(raw)).pages)
        except Exception as exc:
            raise HTTPException(400, f"Could not read PDF: {exc}") from exc
    elif name.lower().endswith((".txt", ".md")):
        text = raw.decode("utf-8", errors="replace")
    else:
        raise HTTPException(415, "Upload a PDF, TXT, or Markdown file")
    if not text.strip():
        raise HTTPException(400, "No readable text found in this file")
    key = str(uuid.uuid4())
    MATERIALS[key] = text[:100_000]
    return {"material_id": key, "filename": name, "characters": len(text)}


@app.post("/start-quiz")
async def start_quiz(req: StartRequest):
    material = MATERIALS.get(req.material_id or "", "")
    if req.material_id and not material:
        raise HTTPException(404, "Uploaded study material expired. Upload the file again.")
    if material:
        model_ready, _ = await get_ollama_status()
        if not model_ready:
            raise HTTPException(503, "Study-material quizzes need a running local Ollama service with the configured model pulled. Switch to a topic quiz or start Ollama locally.")
    context = material[:5000] if material else req.topic
    prompt = (
        f"Create the first single targeted quiz question. Topic: {req.topic}. "
        f"Context: {context}. Difficulty: 3/10. Return JSON {{question, difficulty}}. "
        "No answer or multiple questions."
    )
    fallback = {"question": f"In your own words, what is one important idea about {req.topic}?", "difficulty": 3}
    result, model_used = await ask_model(
        "You are AVIYA, an adaptive quiz master. Ask exactly one clear, answerable question. Output JSON only.",
        prompt,
        fallback,
        max_tokens=100,
    )
    session_id = str(uuid.uuid4())
    question = str(result.get("question", "")).strip()[:1000] or fallback["question"]
    SESSIONS[session_id] = {
        "topic": req.topic,
        "role": req.role,
        "context": context,
        "question": question,
        "difficulty": safe_int(result.get("difficulty"), 3, 1, 10),
        "score": 0,
        "scored": 0,
        "answered": 0,
        "history": [],
    }
    return {
        "session_id": session_id,
        "question": question,
        "difficulty": SESSIONS[session_id]["difficulty"],
        "total_questions": 10,
        "inference": "ollama" if model_used else "fallback",
    }


@app.post("/submit-answer")
async def submit_answer(req: AnswerRequest):
    session = SESSIONS.get(req.session_id)
    if not session:
        raise HTTPException(404, "Quiz session not found or expired")
    fallback = {
        "score": 5,
        "feedback": "Ollama is unavailable, so this answer was not evaluated by an AI model. Start Ollama locally for personalized scoring and feedback.",
        "next_question": f"What is another key idea about {session['topic']}?",
        "difficulty": session["difficulty"],
    }
    prompt = (
        f"Role: {session['role']}. Topic/context: {session['context'][:4000]}. "
        f"Previous question: {session['question']}. Learner answer: {req.answer}. "
        f"Current difficulty: {session['difficulty']}/10. Evaluate fairly and constructively; "
        "award 0-10. Increase difficulty by 1 for a strong answer, decrease by 1 if struggling, "
        "otherwise keep it steady. Return JSON {score, feedback, next_question, difficulty}. "
        "Ask exactly ONE next question."
    )
    result, model_used = await ask_model(
        "You are AVIYA, a supportive expert quiz master. Accept reasonable equivalent answers. Output valid JSON only.",
        prompt,
        fallback,
        max_tokens=OLLAMA_NUM_PREDICT,
    )
    score = safe_int(result.get("score"), 5, 0, 10) if model_used else None
    default_difficulty = session["difficulty"] + (1 if score is not None and score >= 8 else -1 if score is not None and score <= 3 else 0)
    difficulty = safe_int(result.get("difficulty"), default_difficulty, 1, 10)
    feedback = str(result.get("feedback", fallback["feedback"]))[:1500]
    session["answered"] += 1
    if score is not None:
        session["score"] += score
        session["scored"] += 1
    session["history"].append({"question": session["question"], "answer": req.answer, "score": score, "feedback": feedback})
    done = session["answered"] >= 10
    next_question = str(result.get("next_question", fallback["next_question"])).strip()[:1000] or fallback["next_question"]
    session["difficulty"] = difficulty
    session["question"] = next_question
    return {
        "score": score,
        "feedback": feedback,
        "next_question": None if done else next_question,
        "difficulty": difficulty,
        "answered": session["answered"],
        "total_questions": 10,
        "done": done,
        "average_score": round(session["score"] / session["scored"], 1) if session["scored"] else None,
        "inference": "ollama" if model_used else "fallback",
    }


@app.post("/end-quiz")
async def end_quiz(body: dict[str, Any]):
    session_id = str(body.get("session_id", ""))
    session = SESSIONS.pop(session_id, None)
    if not session:
        raise HTTPException(404, "Quiz session not found")
    return {
        "answered": session["answered"],
        "average_score": round(session["score"] / session["scored"], 1) if session["scored"] else None,
        "history": session["history"],
    }
