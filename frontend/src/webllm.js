let enginePromise
const sessions = new Map()
const MODEL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'
async function generate(system, user) {
  if (!enginePromise) enginePromise = import('@mlc-ai/web-llm').then(async ({ CreateMLCEngine }) => CreateMLCEngine(MODEL, { initProgressCallback: (p) => console.info('AVIYA WebLLM:', p.text) }))
  const engine = await enginePromise
  const result = await engine.chat.completions.create({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.65, max_tokens: 260,
  })
  return result.choices?.[0]?.message?.content?.trim() || ''
}
export async function browserRequest(path, body) {
  if (path === '/upload-material') throw new Error('Browser-only quiz does not yet support document uploads. Use a topic or connect the local API.')
  if (path === '/start-quiz') {
    const id = `browser-${crypto.randomUUID()}`
    const question = await generate('You are AVIYA, a supportive adaptive quiz master. Ask exactly one clear question and no other text.', `Role: ${body.role}. Topic: ${body.topic}. Ask a suitable first question at difficulty 3/10.`)
    const s = { topic: body.topic, role: body.role, question, difficulty: 3, answered: 0, score: 0 }
    sessions.set(id, s)
    return { session_id: id, question, difficulty: 3, total_questions: 10 }
  }
  if (path === '/submit-answer') {
    const s = sessions.get(body.session_id)
    if (!s) throw new Error('Browser quiz session has expired.')
    const raw = await generate('You are an expert, encouraging quiz evaluator. Return exactly three lines: SCORE: an integer 0-10; FEEDBACK: a short constructive explanation; NEXT: one targeted next question. Increase difficulty after a strong answer and decrease it after a weak answer.', `Role: ${s.role}. Topic: ${s.topic}. Difficulty: ${s.difficulty}/10. Question: ${s.question}. Learner answer: ${body.answer}`)
    const score = Math.max(0, Math.min(10, Number(raw.match(/SCORE:\s*(\d+)/i)?.[1] || 5)))
    const feedback = raw.match(/FEEDBACK:\s*([^\n]+)/i)?.[1]?.trim() || 'Thanks for thinking that through. Keep building on this idea.'
    const next = raw.match(/NEXT:\s*([\s\S]+)/i)?.[1]?.trim() || `What is another important idea about ${s.topic}?`
    s.answered++; s.score += score; s.difficulty = Math.max(1, Math.min(10, s.difficulty + (score >= 8 ? 1 : score <= 3 ? -1 : 0))); s.question = next
    const done = s.answered >= 10
    return { score, feedback, next_question: done ? null : next, difficulty: s.difficulty, answered: s.answered, total_questions: 10, done, average_score: Math.round(s.score / s.answered * 10) / 10 }
  }
  if (path === '/end-quiz') {
    const s = sessions.get(body.session_id)
    if (!s) throw new Error('Browser quiz session has expired.')
    sessions.delete(body.session_id)
    return { answered: s.answered, average_score: s.answered ? Math.round(s.score / s.answered * 10) / 10 : 0, history: [] }
  }
  throw new Error(`Browser fallback does not support ${path}`)
}
