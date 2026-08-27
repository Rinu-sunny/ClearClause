import { useState, useRef, useCallback, useEffect } from "react"
import "./VoiceCallPage.css"

/* ──────────────────────────  Types  ────────────────────────── */
interface VoiceMessage {
    role: "user" | "assistant"
    content: string
}

type CallState = "ringing" | "active" | "ended"

const getApiBaseUrl = () => {
    const envUrl = import.meta.env.VITE_API_BASE_URL
    if (envUrl) return envUrl
    const hostname = typeof window !== "undefined" ? window.location.hostname : "localhost"
    return `http://${hostname}:8000`
}

/* ────────────── Web Audio Chime Helper ────────────── */
const playTurnChime = () => {
    try {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
        /* eslint-enable @typescript-eslint/no-explicit-any */
        if (!AudioCtx) return
        const ctx = new AudioCtx()
        const now = ctx.currentTime
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()

        osc.type = "sine"
        osc.frequency.setValueAtTime(523.25, now)
        osc.frequency.setValueAtTime(783.99, now + 0.08)

        gain.gain.setValueAtTime(0.08, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)

        osc.connect(gain)
        gain.connect(ctx.destination)

        osc.start(now)
        osc.stop(now + 0.25)
    } catch {
        /* Ignore audio restrictions */
    }
}

/* ────────────── Goodbye Intent Detection ────────────── */
const isGoodbyeIntent = (text: string): boolean => {
    const lower = text.toLowerCase().trim()
    const questionWords = ["what", "how", "is it", "can i", "where", "why", "tell me", "explain"]
    const hasQuestion = questionWords.some(q => lower.includes(q))
    if (hasQuestion && lower.length > 25) return false

    const triggers = [
        "thank you", "thanks", "thankyou",
        "that's enough", "thats enough", "that is enough",
        "goodbye", "good bye", "bye", "bye bye",
        "that's all", "thats all", "that is all",
        "no more questions", "nothing else", "exit", "have a good day"
    ]
    return triggers.some(t => lower.includes(t))
}

/* ───────── Web Speech API types (vendor-prefixed in Chrome) ─────────── */
interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList
    resultIndex: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function getSpeechRecognition(): any | null {
    const w = window as any
    return w.SpeechRecognition || w.webkitSpeechRecognition || null
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ═══════════════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════════════ */
export default function VoiceCallPage() {
    const [callState, setCallState] = useState<CallState>("ringing")
    const [history, setHistory] = useState<VoiceMessage[]>([])
    const [liveTranscript, setLiveTranscript] = useState("")
    const [aiSpeaking, setAiSpeaking] = useState(false)
    const [listening, setListening] = useState(false)
    const [callDuration, setCallDuration] = useState(0)
    const [error, setError] = useState("")
    const [processing, setProcessing] = useState(false)

    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const historyRef = useRef<VoiceMessage[]>([])
    const transcriptRef = useRef<HTMLDivElement>(null)
    const abortRef = useRef(false)
    const handleUserAudioRef = useRef<(blob: Blob) => void>(() => { })
    const processingRef = useRef(false)
    const ttsWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioContextRef = useRef<AudioContext | null>(null)
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const silenceStartRef = useRef<number>(0)
    const reqFrameRef = useRef<number | null>(null)

    // Keep historyRef in sync
    useEffect(() => {
        historyRef.current = history
    }, [history])

    // Auto-scroll transcript
    useEffect(() => {
        transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" })
    }, [history, liveTranscript])

    /* ────────────── Neural Audio Playback (Primary) ────────────── */
    const playAudioBase64 = useCallback((base64: string): Promise<void> => {
        return new Promise<void>((resolve) => {
            if (!base64 || abortRef.current) { resolve(); return }
            try {
                const audio = new Audio(`data:audio/mp3;base64,${base64}`)
                audio.onended = () => resolve()
                audio.onerror = () => resolve()
                setAiSpeaking(true)
                audio.play().catch(() => resolve())
            } catch {
                resolve()
            }
        }).finally(() => setAiSpeaking(false))
    }, [])

    /* ────────────── Fallback Browser TTS ────────────── */
    const speakFallback = useCallback((text: string): Promise<void> => {
        return new Promise<void>((resolve) => {
            if (abortRef.current) { resolve(); return }
            window.speechSynthesis.cancel()

            if (ttsWatchdogRef.current) {
                clearTimeout(ttsWatchdogRef.current)
                ttsWatchdogRef.current = null
            }

            const utt = new SpeechSynthesisUtterance(text)
            utt.rate = 0.98
            utt.pitch = 1.05
            utt.lang = "en-IN"

            const voices = window.speechSynthesis.getVoices()
            const preferred = voices.find(
                (v) => v.lang.startsWith("en") && (
                    v.name.includes("Natural") ||
                    v.name.includes("Online") ||
                    v.name.includes("Neural") ||
                    v.name.includes("Google") ||
                    v.name.includes("Samantha") ||
                    v.name.includes("Siri") ||
                    v.name.includes("Aria")
                )
            ) || voices.find(
                (v) => v.lang.startsWith("en-IN") && v.name.toLowerCase().includes("female")
            ) || voices.find(
                (v) => v.lang.startsWith("en") && v.name.toLowerCase().includes("female")
            ) || voices.find(
                (v) => v.lang.startsWith("en")
            )
            if (preferred) utt.voice = preferred

            let resolved = false
            const done = () => {
                if (resolved) return
                resolved = true
                if (ttsWatchdogRef.current) {
                    clearTimeout(ttsWatchdogRef.current)
                    ttsWatchdogRef.current = null
                }
                resolve()
            }

            utt.onend = done
            utt.onerror = done

            setAiSpeaking(true)
            window.speechSynthesis.speak(utt)

            const estimatedMs = Math.max(3000, text.length * 80 + 2000)
            ttsWatchdogRef.current = setTimeout(() => {
                if (!resolved) {
                    window.speechSynthesis.cancel()
                    done()
                }
            }, estimatedMs)
        }).finally(() => setAiSpeaking(false))
    }, [])

    /* ────────────── Master Voice Speaker (Neural MP3 preferred) ────────────── */
    const speakAudioOrText = useCallback(async (text: string, audioBase64?: string) => {
        if (audioBase64) {
            await playAudioBase64(audioBase64)
        } else {
            await speakFallback(text)
        }
    }, [playAudioBase64, speakFallback])

    /* ────────────── STT helpers ────────────── */
    const stopListening = useCallback(() => {
        if (reqFrameRef.current) cancelAnimationFrame(reqFrameRef.current)
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
        
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            try { mediaRecorderRef.current.stop() } catch { /* ignore */ }
        }
        
        if (audioContextRef.current) {
            audioContextRef.current.close().catch(() => {})
            audioContextRef.current = null
        }
        setListening(false)
    }, [])

    const startListening = useCallback(async () => {
        if (abortRef.current) return
        if (mediaRecorderRef.current?.state === "recording") return
        if (processingRef.current) return

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                }
            })

            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
            audioContextRef.current = audioCtx
            const source = audioCtx.createMediaStreamSource(stream)
            const analyser = audioCtx.createAnalyser()
            source.connect(analyser)
            analyser.fftSize = 512
            const bufferLength = analyser.frequencyBinCount
            const dataArray = new Uint8Array(bufferLength)

            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
            mediaRecorderRef.current = mediaRecorder
            let audioChunks: Blob[] = []

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.push(e.data)
            }

            mediaRecorder.onstart = () => {
                setListening(true)
                setLiveTranscript("Listening (auto-detecting language)...")
                silenceStartRef.current = performance.now()
                
                const checkSilence = () => {
                    if (mediaRecorder.state !== "recording") return
                    analyser.getByteFrequencyData(dataArray)
                    let sum = 0
                    for (let i = 0; i < bufferLength; i++) sum += dataArray[i]
                    let avg = sum / bufferLength

                    if (avg > 15) { 
                        silenceStartRef.current = performance.now()
                    } else {
                        if (performance.now() - silenceStartRef.current > 1800) {
                            if (!processingRef.current) {
                                mediaRecorder.stop()
                                return 
                            }
                        }
                    }
                    reqFrameRef.current = requestAnimationFrame(checkSilence)
                }
                checkSilence()
            }

            mediaRecorder.onstop = () => {
                setListening(false)
                stream.getTracks().forEach(t => t.stop())
                if (reqFrameRef.current) cancelAnimationFrame(reqFrameRef.current)

                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })
                if (audioBlob.size > 1000 && !processingRef.current && !abortRef.current) {
                    handleUserAudioRef.current(audioBlob)
                } else if (!abortRef.current && !processingRef.current) {
                    setTimeout(() => startListening(), 300)
                }
            }

            mediaRecorder.start()
        } catch (err) {
            console.error("Mic error:", err)
            setError("Could not access microphone.")
            setListening(false)
        }
    }, [stopListening])

    const startListeningWithChime = useCallback(() => {
        playTurnChime()
        startListening()
    }, [startListening])

    const hangUp = useCallback(() => {
        abortRef.current = true
        processingRef.current = false
        window.speechSynthesis.cancel()
        if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current)
        stopListening()
        if (timerRef.current) clearInterval(timerRef.current)
        setCallState("ended")
        setAiSpeaking(false)
        setProcessing(false)
    }, [stopListening])

    /* ────────────── Core conversation turn ────────────── */
    const handleUserAudio = useCallback(async (audioBlob: Blob) => {
        if (abortRef.current) return
        processingRef.current = true
        stopListening()
        setProcessing(true)
        setLiveTranscript("Processing...")

        const formData = new FormData()
        formData.append("audio", audioBlob, "audio.webm")
        formData.append("history", JSON.stringify(historyRef.current))

        const apiBase = getApiBaseUrl()
        try {
            const res = await fetch(`${apiBase}/voice-chat/audio`, {
                method: "POST",
                body: formData,
            })
            if (!res.ok) {
                const errData = await res.json().catch(() => null)
                throw new Error(errData?.detail || `Server error ${res.status}`)
            }
            const data = await res.json()
            
            const userText = data.user_text || "[Inaudible]"
            const aiText = data.response || "I'm sorry, I didn't catch that."
            const aiAudio = data.audio || ""

            const userMsg: VoiceMessage = { role: "user", content: userText }
            const aiMsg: VoiceMessage = { role: "assistant", content: aiText }
            
            const updated = [...historyRef.current, userMsg, aiMsg]
            setHistory(updated)
            setProcessing(false)
            processingRef.current = false
            setLiveTranscript("")

            if (abortRef.current) return

            if (isGoodbyeIntent(userText) || isGoodbyeIntent(aiText)) {
                await speakAudioOrText(aiText, aiAudio)
                hangUp()
                return
            }

            await speakAudioOrText(aiText, aiAudio)
            if (!abortRef.current) startListeningWithChime()

        } catch (err) {
            setProcessing(false)
            processingRef.current = false
            setLiveTranscript("")
            const detailMsg = err instanceof Error ? err.message : "Connection failed"
            console.error("Voice chat error:", detailMsg)
            
            const errMsg: VoiceMessage = {
                role: "assistant",
                content: `Sorry, I had trouble connecting (${detailMsg}). Please try again.`
            }
            setHistory([...historyRef.current, errMsg])
            if (!abortRef.current) {
                await speakAudioOrText(errMsg.content)
                if (!abortRef.current) startListeningWithChime()
            }
        }
    }, [stopListening, hangUp, speakAudioOrText, startListeningWithChime])

    useEffect(() => {
        handleUserAudioRef.current = handleUserAudio
    }, [handleUserAudio])

    /* ────────────── Call controls ────────────── */
    const answerCall = useCallback(async () => {
        abortRef.current = false
        processingRef.current = false
        setCallState("active")
        setHistory([])
        setError("")
        setCallDuration(0)

        // EXPLICIT USER GESTURE: Request mic permission so mobile browsers trigger the permission dialog!
        try {
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    }
                })
                stream.getTracks().forEach(t => t.stop())
            }
        } catch (micErr) {
            console.warn("Mobile microphone permission error:", micErr)
            setError("Mobile browser mic access was blocked. If using an IP address (http://192.168.x.x), mobile browsers block mic by default on HTTP. Open Chrome settings or use ngrok/HTTPS.")
        }

        timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000)

        const apiBase = getApiBaseUrl()
        let greeting = "Hello! I am ClearClause, your legal helpline assistant. You can ask me any question about tenancy laws or your rights as a tenant in India. How can I help you today?"
        let greetingAudio = ""

        try {
            const res = await fetch(`${apiBase}/voice-chat/greeting`)
            if (res.ok) {
                const data = await res.json()
                if (data.greeting) greeting = data.greeting
                if (data.audio) greetingAudio = data.audio
            }
        } catch { /* use default */ }

        const greetMsg: VoiceMessage = { role: "assistant", content: greeting }
        setHistory([greetMsg])

        await speakAudioOrText(greeting, greetingAudio)
        if (!abortRef.current) startListeningWithChime()
    }, [speakAudioOrText, startListeningWithChime])

    const resetCall = useCallback(() => {
        setCallState("ringing")
        setHistory([])
        setLiveTranscript("")
        setCallDuration(0)
        setError("")
    }, [])

    useEffect(() => {
        return () => {
            abortRef.current = true
            window.speechSynthesis.cancel()
            if (recognitionRef.current) try { recognitionRef.current.stop() } catch { /* */ }
            if (timerRef.current) clearInterval(timerRef.current)
            if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current)
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
        }
    }, [])

    useEffect(() => {
        window.speechSynthesis.getVoices()
        window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices()
    }, [])

    const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`

    /* ═══════════════════════════════════════════════════════
       Render
       ═══════════════════════════════════════════════════════ */

    if (callState === "ringing") {
        return (
            <div className="voice-call-root voice-ringing">
                <div className="voice-bg-glow" />
                <div className="voice-incoming">
                    <div className="voice-avatar">
                        <div className="voice-avatar-ring" />
                        <div className="voice-avatar-ring voice-avatar-ring-2" />
                        <div className="voice-avatar-inner">
                            <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                            </svg>
                        </div>
                    </div>

                    <h1 className="voice-caller-name">ClearClause Legal Helpline</h1>
                    <p className="voice-caller-label">Incoming call…</p>

                    {error && <p className="voice-error">{error}</p>}

                    <div className="voice-call-actions">
                        <button className="voice-btn voice-btn-decline" onClick={() => window.history.back()} title="Decline">
                            <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                        <button className="voice-btn voice-btn-answer" onClick={answerCall} title="Answer">
                            <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    if (callState === "ended") {
        return (
            <div className="voice-call-root voice-ended">
                <div className="voice-bg-glow" />
                <div className="voice-incoming">
                    <div className="voice-avatar">
                        <div className="voice-avatar-inner voice-avatar-ended">
                            <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                            </svg>
                        </div>
                    </div>
                    <h1 className="voice-caller-name">Call Ended</h1>
                    <p className="voice-caller-label">{formatTime(callDuration)}</p>

                    <div className="voice-call-actions" style={{ marginTop: "2rem" }}>
                        <button className="voice-btn voice-btn-answer" onClick={resetCall} title="Call Again">
                            <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="voice-call-root voice-active">
            <div className="voice-bg-glow voice-bg-glow-active" />

            <div className="voice-topbar">
                <span className="voice-dot-live" />
                <span className="voice-timer">{formatTime(callDuration)}</span>
            </div>

            <div className="voice-active-header">
                <div className="voice-mini-avatar">
                    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                    </svg>
                </div>
                <div>
                    <h2 className="voice-active-name">ClearClause Helpline</h2>
                    <p className="voice-active-status">
                        {aiSpeaking ? "Speaking…" : listening ? "Listening…" : processing ? "Thinking…" : "Connected"}
                    </p>
                </div>
            </div>

            <div className="voice-waveform">
                {[...Array(7)].map((_, i) => (
                    <div
                        key={i}
                        className={`voice-wave-bar ${aiSpeaking ? "voice-wave-speaking" : listening ? "voice-wave-listening" : ""}`}
                        style={{ animationDelay: `${i * 0.12}s` }}
                    />
                ))}
            </div>

            <div className="voice-transcript" ref={transcriptRef}>
                {history.map((msg, i) => (
                    <div key={i} className={`voice-msg ${msg.role === "user" ? "voice-msg-user" : "voice-msg-ai"}`}>
                        <span className="voice-msg-label">{msg.role === "user" ? "You" : "ClearClause"}</span>
                        <p>{msg.content}</p>
                    </div>
                ))}
                {liveTranscript && (
                    <div className="voice-msg voice-msg-user voice-msg-live">
                        <span className="voice-msg-label">You</span>
                        <p>{liveTranscript}<span className="voice-cursor">|</span></p>
                    </div>
                )}
                {processing && (
                    <div className="voice-msg voice-msg-ai">
                        <span className="voice-msg-label">ClearClause</span>
                        <p className="voice-thinking">
                            <span className="voice-dot" style={{ animationDelay: "0ms" }} />
                            <span className="voice-dot" style={{ animationDelay: "200ms" }} />
                            <span className="voice-dot" style={{ animationDelay: "400ms" }} />
                        </p>
                    </div>
                )}
            </div>

            <div className="voice-bottom-bar">
                <button className="voice-btn voice-btn-hangup" onClick={hangUp} title="Hang Up">
                    <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                    </svg>
                </button>
            </div>
        </div>
    )
}
