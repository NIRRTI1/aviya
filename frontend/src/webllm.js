let enginePromise = null
const sessions = new Map()
const MODEL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'

async function getEngine(onProgress) {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new Error('This browser does not support WebGPU. Use a current Chrome or Edge browser, or run AVIYA locally with Ollama.')
  }
  const adapter = await navigator.gpu.requestAdapter().catch(() => null)
  if (!adapter) throw new Error('This device did not provide a WebGPU adapter. Try an updated browser or use local Ollama.')
  if (!enginePromise) {
    enginePromise = import('@mlc-ai/web-llm')
      .then(({ CreateMLCEngine }) => CreateMLCEngine(MODEL, {
        initProgressCallback: progress => {
          console.info('AVIYA WebLLM:', progress.text)
          onProgress?.({ text: progress.text, progress: progress.progress })
        },
        logLevel: 'WARN',
      }))
      .catch(error => {
        enginePromise = null
        throw new Error(`Could not load the on-device AI model: ${error.message || error}`)
      })
  }
  return enginePromise
}

async function generate(system, user, onProgress) {
  const engine = await getEngine(onProgress)
  const result = await engine.chat.completions.create({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.45,
    max_tokens: 180,
  })
  return result.choices?.[0]?.message?.content?.trim() || ''
}

export async function browserRequest(path, body, onProgress) {
  if (path === '/upload-material') throw new Error('Browser-only quiz does not support document uploads. Use a local API with Ollama.')
  if (path === '/start-quiz') {
    const id = `browser-${crypto.randomUUID()}`
    const question = await generate('You are AVIYA, a supportive adaptive quiz master. Ask exactly one clear question and no other text.', `Role: ${body.role}. Topic: ${body.topic}. Ask one suitable first question at difficulty 3/10.`, onProgress)
    const session = { topic: body.topic, role: body.role, question, difficulty: 3, answered: 0, score: 0 }
    sessions.set(id, session)
    return { session_id: id, question, difficulty: 3, total_questions: 10, inference: 'webllm' }
  }
  if (path === '/submit-answer') {
    const session = sessions.get(body.session_id)
    if (!session) throw new Error('Browser quiz session has expired. Start a new quiz.')
    const raw = await generate('You are an expert, encouraging quiz evaluator. Return exactly three lines: SCORE: an integer 0-10; FEEDBACK: one concise constructive sentence; NEXT: exactly one targeted question. Increase difficulty after a strong answer and decrease it after a weak answer.', `Role: ${session.role}. Topic: ${session.topic}. Difficulty: ${session.difficulty}/10. Question: ${session.question}. Learner answer: ${body.answer}`)
    const score = Math.max(0, Math.min(10, Number(raw.match(/SCORE:\s*(\d+)/i)?.[1] || 5)))
    const feedback = raw.match(/FEEDBACK:\s*([^\n]+)/i)?.[1]?.trim() || 'Thanks for thinking that through. Keep building on this idea.'
    const next = raw.match(/NEXT:\s*([\s\S]+)/i)?.[1]?.trim() || `What is another important idea about ${session.topic}?`
    session.answered++
    session.score += score
    session.difficulty = Math.max(1, Math.min(10, session.difficulty + (score >= 8 ? 1 : score <= 3 ? -1 : 0)))
    session.question = next
    const done = session.answered >= 10
    return { score, feedback, next_question: done ? null : next, difficulty: session.difficulty, answered: session.answered, total_questions: 10, done, average_score: Math.round(session.score / session.answered * 10) / 10, inference: 'webllm' }
  }
  if (path === '/end-quiz') {
    const session = sessions.get(body.session_id)
    if (!session) throw new Error('Browser quiz session has expired.')
    sessions.delete(body.session_id)
    return { answered: session.answered, average_score: session.answered ? Math.round(session.score / session.answered * 10) / 10 : 0, history: [] }
  }
  throw new Error(`Browser fallback does not support ${path}`)
}
