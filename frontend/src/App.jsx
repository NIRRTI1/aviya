import { useState } from 'react'
import './style.css'
import { browserRequest } from './webllm.js'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const roles = ['Curious expert', 'Senior Python Dev', 'History Scholar', 'MCAT Tutor', 'Product Strategist']

async function fetchJson(path, body, timeoutMs = 35000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${API}${path}`, path === '/health'
      ? { method: 'GET', signal: controller.signal }
      : body instanceof FormData
      ? { method: 'POST', body, signal: controller.signal }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.detail || `API request failed (${response.status})`)
    return data
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The server took too long to respond. Check that Ollama is running and the model is loaded, then try again.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export default function App() {
  const [topic, setTopic] = useState('')
  const [role, setRole] = useState(roles[0])
  const [material, setMaterial] = useState(null)
  const [session, setSession] = useState(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('topic')
  const [useBrowserAI, setUseBrowserAI] = useState(false)
  const [engine, setEngine] = useState('api')
  const [engineLabel, setEngineLabel] = useState('')
  const [loadingText, setLoadingText] = useState('')
  const [loadingPercent, setLoadingPercent] = useState(null)

  async function upload(file) {
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      setMaterial(await fetchJson('/upload-material', form, 60000))
    } catch (e) { setError(e.message) }
  }

  async function start(event) {
    event?.preventDefault()
    if (!topic.trim() || busy) return
    setBusy(true)
    setError('')
    setLoadingPercent(null)
    setLoadingText('Checking for a local Ollama model…')
    const payload = { topic: topic.trim(), role, material_id: material?.material_id }
    let selectedEngine = 'api'
    try {
      let health = null
      try { health = await fetchJson('/health', {}, 5000) } catch { health = null }
      if (material && !health?.ollama_available) {
        throw new Error('Study-material quizzes require a local FastAPI backend with Ollama running. Choose a topic for the hosted quick mode, or start the local setup.')
      }
      if (health?.ollama_available) {
        selectedEngine = 'api'
        setLoadingText('Preparing a question with your local model…')
        const result = await fetchJson('/start-quiz', payload)
        setEngineLabel(result.inference === 'ollama' ? `Local Ollama · ${health.model || 'installed model'}` : 'Quick mode · Ollama unavailable')
        setSession(result)
      } else if (useBrowserAI && !material && typeof navigator !== 'undefined' && navigator.gpu) {
        selectedEngine = 'browser'
        setEngineLabel('On-device WebGPU model')
        setLoadingText('Starting the on-device model. First use downloads model files; progress is shown below.')
        const result = await browserRequest('/start-quiz', payload, progress => {
          setLoadingText(progress.text || 'Loading the on-device model…')
          setLoadingPercent(Number.isFinite(progress.progress) ? Math.round(progress.progress * 100) : null)
        })
        setSession(result)
      } else {
        selectedEngine = 'api'
        setEngineLabel(health ? 'Quick mode · no model download' : 'Server mode · checking connection')
        setLoadingText(useBrowserAI && !navigator.gpu ? 'WebGPU is unavailable on this device. Starting quick mode without a model download…' : 'Starting quick mode. This does not download or run an AI model…')
        setSession(await fetchJson('/start-quiz', payload))
      }
      setEngine(selectedEngine)
    } catch (e) {
      if (selectedEngine === 'browser') {
        setLoadingText('On-device AI could not start. Trying the server quick mode…')
        try {
          setSession(await fetchJson('/start-quiz', payload))
          setEngine('api')
          setEngineLabel('Quick mode · on-device model unavailable')
        } catch (serverError) {
          setError(`${e.message} Server fallback also failed: ${serverError.message}`)
        }
      } else setError(e.message)
    } finally {
      setBusy(false)
      setLoadingText('')
      setLoadingPercent(null)
    }
  }

  async function submit(event) {
    event.preventDefault()
    if (!answer.trim() || busy) return
    setBusy(true)
    setError('')
    setLoadingText(engine === 'browser' ? 'Evaluating on this device…' : 'Evaluating your answer…')
    try {
      const payload = { session_id: session.session_id, answer: answer.trim() }
      const data = engine === 'browser'
        ? await browserRequest('/submit-answer', payload)
        : await fetchJson('/submit-answer', payload)
      setFeedback(data)
      setAnswer('')
      if (data.inference === 'fallback') setEngineLabel('Quick mode · model unavailable')
      setSession(current => ({ ...current, question: data.next_question || current.question, difficulty: data.difficulty, answered: data.answered, average_score: data.average_score, done: data.done }))
    } catch (e) { setError(e.message) }
    finally { setBusy(false); setLoadingText('') }
  }

  function reset() {
    setSession(null)
    setFeedback(null)
    setError('')
    setLoadingText('')
    setEngineLabel('')
  }

  const progress = session ? Math.min(100, (session.answered || 0) * 10) : 0
  return <main className="shell">
    <header className="top"><a className="brand" href="#"><span className="brand-mark">a</span> AVIYA</a><span className="top-note"><i /> YOUR PERSONAL AI QUIZ MASTER</span><a className="github" href="https://github.com/NIRRTI1/aviya" target="_blank" rel="noreferrer">Open source ↗</a></header>
    {!session ? <section className="hero">
      <div className="intro"><div className="eyebrow"><span className="spark">✳</span> LEARN BY THINKING</div><h1>Knowledge that<br /><em>sticks with you.</em></h1><p className="lede">One thoughtful question at a time. Your AI quiz master listens, adapts, and helps you go deeper.</p><div className="steps"><span><b>01</b> Pick a subject</span><span><b>02</b> Think it through</span><span><b>03</b> Level up</span></div><div className="mascot-card"><div className="orbit o1" /><div className="orbit o2" /><div className="mascot">a<span>✦</span></div><div className="mascot-copy"><b>Meet AVIYA</b><small>Curious by design. Built for your pace.</small></div><div className="live"><i /> READY</div></div></div>
      <form className="setup" onSubmit={start}><div className="setup-head"><span className="eyebrow">YOUR NEXT DEEP DIVE</span><span className="step-count">01 <span>/ 03</span></span></div><h2>What are we exploring?</h2><p className="sub">Choose a topic and AVIYA will meet you where you are.</p><div className="tabs"><button type="button" className={tab === 'topic' ? 'active' : ''} onClick={() => setTab('topic')}>A topic</button><button type="button" className={tab === 'material' ? 'active' : ''} onClick={() => setTab('material')}>Study material</button></div>
        <label className="field-label">{tab === 'topic' ? 'TOPIC OR SUBJECT' : 'TOPIC (OPTIONAL)'}</label><input className="input" value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Photosynthesis, Python decorators…" required /><label className="field-label role-label">YOUR QUIZ MASTER</label><select className="input select" value={role} onChange={e => setRole(e.target.value)}>{roles.map(item => <option key={item}>{item}</option>)}</select>
        {tab === 'material' && <label className="upload">{material ? <><b>✓ {material.filename}</b><small>{material.characters.toLocaleString()} characters ready</small></> : <><b>＋ Add your notes or PDF</b><small>PDF, TXT, or Markdown · up to 10 MB · needs local API + Ollama</small></>}<input type="file" accept=".pdf,.txt,.md" onChange={e => e.target.files[0] && upload(e.target.files[0])} /></label>}
        {tab === 'topic' && <fieldset className="engine-choice"><legend className="field-label">AI MODE</legend><label><input type="radio" name="ai-mode" checked={!useBrowserAI} onChange={() => setUseBrowserAI(false)} /><span><b>Fast start</b><small>No browser model download. Uses local Ollama if available; otherwise a basic, non-AI fallback.</small></span></label><label><input type="radio" name="ai-mode" checked={useBrowserAI} onChange={() => setUseBrowserAI(true)} /><span><b>On-device AI</b><small>Uses WebGPU. First use downloads model files and may take several minutes.</small></span></label></fieldset>}
        {error && <div className="error" role="alert">{error}</div>}
        {busy && <div className="load-status" role="status" aria-live="polite"><span>{loadingText}</span>{loadingPercent !== null && <><progress max="100" value={loadingPercent} /><small>{loadingPercent}% loaded. First startup may take longer on slower connections.</small></>}</div>}
        <button className="start" disabled={busy || !topic.trim()}>{busy ? 'Working…' : <>Start exploring <span>↗</span></>}</button><div className="private"><span>◉</span> Your selected inference path is shown during the quiz.</div>
      </form>
    </section> : <section className="quiz"><div className="quiz-top"><button className="back" onClick={reset}>← New quiz</button><div className="progress-meta"><span>QUESTION {Math.min((session.answered || 0) + 1, 10)} <i>/ 10</i></span><span>LEVEL {session.difficulty}/10</span></div><div className="progress"><span style={{ width: `${progress}%` }} /></div></div><div className="quiz-card"><div className="question-avatar">a<span>✦</span></div><div className="question-overline">{role} <span>·</span> {topic}</div><h2>{session.done ? 'Beautiful work.' : session.question}</h2>{session.done ? <><p className="sub">{session.average_score === null ? 'This round ran without an AI scoring model. Your answers were not scored.' : `You completed this round with an average score of ${session.average_score}/10.`}</p><button className="start" onClick={reset}>Explore another topic ↗</button></> : <form onSubmit={submit}><label className="field-label">YOUR ANSWER</label><textarea autoFocus value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Take your time. Explain it in your own words…" rows="4" /><button className="start" disabled={busy || !answer.trim()}>{busy ? 'Thinking…' : <>Send answer <span>↗</span></>}</button></form>}{busy && <div className="load-status" role="status" aria-live="polite">{loadingText}</div>}{error && <div className="error" role="alert">{error}</div>}{feedback && <div className={`feedback ${feedback.score >= 7 ? 'good' : ''}`}><div className="feedback-score">{feedback.inference === 'fallback' ? '—' : feedback.score}<small>{feedback.inference === 'fallback' ? 'N/A' : '/10'}</small></div><div><b>{feedback.inference === 'fallback' ? 'Not AI-evaluated' : feedback.score >= 8 ? 'Excellent thinking' : feedback.score >= 5 ? 'Good start' : 'A chance to grow'}</b><p>{feedback.feedback}</p></div></div>}<div className="quiz-foot"><span>✳ Adaptive difficulty</span><span>{engineLabel}</span></div></div></section>}
    <footer><span>AVIYA <i>·</i> LEARN AT YOUR OWN PACE</span><span>LOCAL-FIRST AI <i>✳</i> OPEN WEIGHTS</span></footer>
  </main>
}
