from __future__ import annotations
import json, os, re, uuid
from pathlib import Path
from typing import Any
import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")
app = FastAPI(title="AVIYA API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","), allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
SESSIONS: dict[str, dict[str, Any]] = {}
MATERIALS: dict[str, str] = {}

class StartRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=500)
    role: str = "Curious expert"
    material_id: str | None = None

class AnswerRequest(BaseModel):
    session_id: str
    answer: str = Field(min_length=1, max_length=5000)

async def ask_model(system: str, prompt: str, fallback: dict) -> dict:
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.post(f"{OLLAMA_URL}/api/chat", json={"model": OLLAMA_MODEL, "stream": False, "format": "json", "messages": [{"role":"system","content":system},{"role":"user","content":prompt}]})
            r.raise_for_status()
            content = r.json().get("message", {}).get("content", "")
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", content, re.S)
            if not match: return fallback
            parsed = json.loads(match.group())
        return parsed if isinstance(parsed, dict) else fallback
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return fallback

def safe_int(value: Any, default: int, lo: int, hi: int) -> int:
    try: return max(lo, min(hi, int(value)))
    except (ValueError, TypeError): return default

@app.get("/health")
async def health():
    available = False
    try:
        async with httpx.AsyncClient(timeout=2) as c: available = (await c.get(f"{OLLAMA_URL}/api/tags")).status_code == 200
    except httpx.HTTPError: pass
    return {"status":"ok", "ollama_available":available, "model":OLLAMA_MODEL, "fallback":"deterministic"}

@app.post("/upload-material")
async def upload_material(file: UploadFile = File(...)):
    name = file.filename or "material.txt"
    raw = await file.read(10_000_001)
    if len(raw) > 10_000_000: raise HTTPException(413, "File exceeds 10 MB limit")
    if name.lower().endswith(".pdf"):
        try:
            from pypdf import PdfReader
            import io
            text = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(raw)).pages)
        except Exception as exc: raise HTTPException(400, f"Could not read PDF: {exc}")
    elif name.lower().endswith((".txt", ".md")):
        text = raw.decode("utf-8", errors="replace")
    else: raise HTTPException(415, "Upload a PDF, TXT, or Markdown file")
    if not text.strip(): raise HTTPException(400, "No readable text found in this file")
    key = str(uuid.uuid4()); MATERIALS[key] = text[:100_000]
    return {"material_id":key,"filename":name,"characters":len(text)}

@app.post("/start-quiz")
async def start_quiz(req: StartRequest):
    material = MATERIALS.get(req.material_id or "", "")
    context = material[:5000] if material else req.topic
    prompt = f"Create the first single targeted quiz question. Topic: {req.topic}. Context: {context}. Difficulty: 3/10. Return JSON {{question, difficulty}}. No answer or multiple questions."
    result = await ask_model("You are AVIYA, an adaptive quiz master. Ask exactly one clear, answerable question. Output JSON only.", prompt, {"question": f"In your own words, what is one important idea about {req.topic}?", "difficulty":3})
    session_id = str(uuid.uuid4())
    question = str(result.get("question", "")).strip()[:1000] or f"What is one important idea about {req.topic}?"
    SESSIONS[session_id] = {"topic":req.topic,"role":req.role,"context":context,"question":question,"difficulty":safe_int(result.get("difficulty"),3,1,10),"score":0,"answered":0,"history":[]}
    return {"session_id":session_id,"question":question,"difficulty":SESSIONS[session_id]["difficulty"],"total_questions":10}

@app.post("/submit-answer")
async def submit_answer(req: AnswerRequest):
    s = SESSIONS.get(req.session_id)
    if not s: raise HTTPException(404, "Quiz session not found or expired")
    fallback = {"score":5,"feedback":"Thanks for your answer. Ollama is unavailable, so this response could not be evaluated. Start Ollama to enable personalized feedback.","next_question":f"What is another key idea about {s['topic']}?","difficulty":s["difficulty"]}
    prompt = f"Role: {s['role']}. Topic/context: {s['context'][:4000]}. Previous question: {s['question']}. Learner answer: {req.answer}. Current difficulty: {s['difficulty']}/10. Evaluate fairly and constructively; award 0-10. If correct/strong increase difficulty by 1, if struggling decrease by 1, otherwise keep. Return JSON {{score, feedback, next_question, difficulty}}. Ask exactly ONE next question."
    result = await ask_model("You are AVIYA, a supportive expert quiz master. Evaluate the learner against the material; accept reasonable equivalent answers. Output valid JSON only.", prompt, fallback)
    score = safe_int(result.get("score"),5,0,10); difficulty = safe_int(result.get("difficulty"), s["difficulty"] + (1 if score >= 8 else -1 if score <= 3 else 0),1,10)
    feedback = str(result.get("feedback",fallback["feedback"]))[:1500]
    s["answered"] += 1; s["score"] += score; s["history"].append({"question":s["question"],"answer":req.answer,"score":score,"feedback":feedback})
    done = s["answered"] >= 10
    next_q = str(result.get("next_question",fallback["next_question"])).strip()[:1000] or fallback["next_question"]
    s["difficulty"] = difficulty; s["question"] = next_q
    return {"score":score,"feedback":feedback,"next_question":None if done else next_q,"difficulty":difficulty,"answered":s["answered"],"total_questions":10,"done":done,"average_score":round(s["score"]/s["answered"],1)}

@app.post("/end-quiz")
async def end_quiz(body: dict):
    session_id = body.get("session_id", ""); s = SESSIONS.pop(session_id, None)
    if not s: raise HTTPException(404,"Quiz session not found")
    return {"answered":s["answered"],"average_score":round(s["score"]/s["answered"],1) if s["answered"] else 0,"history":s["history"]}
