"""
Voice-chat module — RAG-powered legal Q&A without requiring a document upload.
Used by the /voice-chat endpoint to power the browser-based "phone call" demo.
"""

import os
from groq import Groq
from knowledge_base import retrieve_relevant_rules
from dotenv import load_dotenv

load_dotenv()

_client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
_MODEL = "openai/gpt-oss-120b"

GREETING = (
    "Hello! I am ClearClause, your legal helpline assistant. "
    "You can ask me any question about tenancy laws, rental agreements, "
    "or your rights as a tenant in India. How can I help you today?"
)

_SYSTEM_PROMPT_TEMPLATE = """You are ClearClause, a friendly legal-literacy voice assistant on a phone helpline for people in India.
The caller may not have a smartphone or internet — they are calling you for help.
Speak naturally as if on a phone call. Keep answers short: 2-4 sentences maximum.
Do not use markdown, bullet points, emojis, or special formatting — this will be read aloud.

Note: The caller's question was transcribed from speech. If a word sounds phonetically similar to a legal term (e.g. 'loss' instead of 'laws', 'cause' instead of 'clause'), understand their underlying legal intent.
CRITICAL: The caller might speak in English, Hindi, or Malayalam (or Manglish/Hinglish). If you detect the user is speaking Malayalam/Manglish, you MUST reply entirely in Malayalam script. If Hindi/Hinglish, reply in Hindi script (Devanagari). Otherwise, reply in English.

RELEVANT LEGAL RULES FROM OUR DATABASE:
{rules_text}

Ground your answers in these rules and mention the specific law or act when relevant.
If you do not know something or the question is outside Indian law, say so honestly.
Never give definitive legal advice — you provide legal information and literacy.
For important decisions, suggest consulting a lawyer.
Always be warm, patient, and use simple everyday language."""


import re

def _clean_speech_transcript(text: str) -> str:
    """
    Pre-correct common phonetic speech-to-text mishearings in Indian legal/tenancy domain.
    Basic browser STT often mishears 'laws' as 'loss', 'clause' as 'cause', 'rent' as 'red', etc.
    """
    corrections = [
        (r"\btenancy loss\b", "tenancy laws"),
        (r"\brental loss\b", "rental laws"),
        (r"\bproperty loss\b", "property laws"),
        (r"\brent loss\b", "rent laws"),
        (r"\bthe loss\b", "the laws"),
        (r"\bindian loss\b", "Indian laws"),
        (r"\bloss\b", "laws"),
        (r"\bplease cause\b", "lease clause"),
        (r"\bred deposit\b", "rent deposit"),
        (r"\bland lord\b", "landlord"),
    ]
    cleaned = text
    for pattern, replacement in corrections:
        cleaned = re.sub(pattern, replacement, cleaned, flags=re.IGNORECASE)
    return cleaned


def voice_chat(message: str, history: list[dict]) -> str:
    """
    Process a single voice-chat turn.
    Returns the AI's text response (to be spoken aloud by the frontend).
    """
    # Clean phonetic STT mishearings (e.g. 'loss' -> 'laws')
    cleaned_message = _clean_speech_transcript(message)

    # Retrieve relevant rules via RAG
    try:
        rules = retrieve_relevant_rules(cleaned_message, n=5)
        rules_text = ""
        for rule in rules:
            rules_text += f"- {rule['rule']}\n  Source: {rule['source']}\n"
    except Exception:
        rules_text = "No specific rules found in database for this query."

    system_prompt = _SYSTEM_PROMPT_TEMPLATE.format(rules_text=rules_text)

    messages = [{"role": "system", "content": system_prompt}]

    # Include recent conversation history (last 6 turns)
    for msg in history[-6:]:
        messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": message})

    response = _client.chat.completions.create(
        model=_MODEL,
        messages=messages,
        temperature=0.3,
        max_tokens=300,  # Keep responses short for voice
        timeout=30,
    )

    return response.choices[0].message.content.strip()


def voice_chat_audio(audio_bytes: bytes, history: list[dict]) -> dict:
    """
    Transcribes audio using Groq Whisper, then processes the turn.
    Returns dict with transcription and ai_response.
    """
    import io
    # Create a file-like object for the groq client
    audio_file = ("audio.webm", io.BytesIO(audio_bytes), "audio/webm")
    
    transcription = _client.audio.transcriptions.create(
        model="whisper-large-v3-turbo",
        file=audio_file,
    )
    
    user_text = transcription.text
    ai_response = voice_chat(user_text, history)
    return {"user_text": user_text, "ai_response": ai_response}


def _detect_voice_for_text(text: str) -> str:
    """Auto-detects the best edge-tts voice based on Unicode characters in text."""
    for char in text:
        code = ord(char)
        if 0x0D00 <= code <= 0x0D7F:
            return "ml-IN-SobhanaNeural" # Malayalam
        elif 0x0900 <= code <= 0x097F:
            return "hi-IN-SwaraNeural"   # Hindi
        elif 0x0B80 <= code <= 0x0BFF:
            return "ta-IN-PallaviNeural" # Tamil
    return "en-IN-NeerjaNeural"          # Default English


async def generate_tts_base64(text: str, voice: str = None) -> str:
    """
    Generate hyper-realistic human voice audio. Auto-detects language if voice is not provided.
    Returns base64-encoded MP3 string.
    """
    import base64
    import edge_tts

    if not voice:
        voice = _detect_voice_for_text(text)

    try:
        communicate = edge_tts.Communicate(text, voice)
        mp3_data = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                mp3_data += chunk["data"]

        return base64.b64encode(mp3_data).decode("utf-8")
    except Exception as e:
        print("Neural TTS generation warning:", e)
        return ""
