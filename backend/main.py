import asyncio
import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Literal
import pymupdf
from google import genai
from google.genai import types
from groq import AsyncGroq
from clause_analyzer_poc import analyze_clause, analyze_document
from admin_auth import create_admin_token, verify_password, require_admin
from knowledge_base import insert_rule, list_rules, delete_rule,chunk_text
from voice_chat import voice_chat, voice_chat_audio, generate_tts_base64, GREETING as VOICE_GREETING


app = FastAPI()

cors_origins = [origin.strip() for origin in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client = AsyncGroq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None
API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
gemini_client = (
    genai.Client(api_key=API_KEY, http_options=types.HttpOptions(timeout=30000))
    if API_KEY else None
)

class ClauseRequest(BaseModel):
    text: str = Field(min_length=1, max_length=50000)
    language: Literal["English", "Malayalam"] = "English"

class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    document_context: str = Field(min_length=1, max_length=50000)
    history: list = Field(default_factory=list, max_length=12)
    language: Literal["English", "Malayalam"] = "English"

class VoiceChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list = Field(default_factory=list, max_length=20)

class AdminLoginRequest(BaseModel):
    password: str

class RuleCreateRequest(BaseModel):
    clause_type: str
    rule: str
    source: str
    state: str
    risk_level: str  # "Green" | "Yellow" | "Red"


async def read_upload(file: UploadFile, max_bytes: int = 15 * 1024 * 1024) -> bytes:
    contents = await file.read(max_bytes + 1)
    if len(contents) > max_bytes:
        raise HTTPException(status_code=413, detail="PDF file is too large (maximum 15 MB)")
    return contents


@app.get("/health")
async def health():
    return {"status": "ok"}


def extract_pdf_text(doc, language: str = "English") -> str:
    page_texts = [page.get_text("text", sort=True).strip() for page in doc]
    native_text = "\n".join(page_texts).strip()
    has_broken_text = "\ufffd" in native_text or native_text.count("") > 2
    needs_ocr = not native_text or has_broken_text
    if gemini_client is None or not needs_ocr:
        return native_text

    try:
        pdf_part = types.Part.from_bytes(data=doc.tobytes(), mime_type="application/pdf")
        response = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[
                pdf_part,
                "Transcribe this legal agreement exactly. It may be in Malayalam or English. Preserve every word, number, punctuation mark, clause number, and page order. Do not translate or summarize. Return only the complete document text.",
            ],
            config=types.GenerateContentConfig(
                temperature=0,
                max_output_tokens=8192,
            ),
        )
        if response.text and response.text.strip():
            return response.text.strip()
    except Exception:
        if native_text and not has_broken_text:
            return native_text

    ocr_parts = []
    for page_number, page in enumerate(doc):
        if page_number >= 20:
            break
        force_ocr = language == "Malayalam" or has_broken_text
        if page_texts[page_number] and not force_ocr:
            ocr_parts.append(page_texts[page_number])
            continue
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
        image_part = types.Part.from_bytes(data=pixmap.tobytes("png"), mime_type="image/png")
        try:
            response = gemini_client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[
                    image_part,
                    "Transcribe this legal agreement page exactly. It may be in Malayalam or English. Preserve the original wording, numbers, punctuation, and line order. Do not translate or summarize. Return only the transcribed text.",
                ],
            )
            if response.text:
                ocr_parts.append(response.text.strip())
            elif page_texts[page_number]:
                ocr_parts.append(page_texts[page_number])
        except Exception:
            if page_texts[page_number]:
                ocr_parts.append(page_texts[page_number])
    return "\n\n".join(ocr_parts).strip()

def get_chat_lang_instruction(language: str) -> str:
    if language == "Malayalam":
        return """Answer in Malayalam (മലയാളം) script only. Use natural conversational Malayalam that a person in Kerala would use. Do not use English words except for legal terms with no Malayalam equivalent. Do not mix Korean, Chinese, or any other script."""
    else:
        return "Answer clearly in simple English."

@app.post("/analyze")
async def analyze(req: ClauseRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    return await analyze_clause(req.text, req.language, API_KEY)

@app.post("/analyze-document")
async def analyze_document_endpoint(req: ClauseRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Document text cannot be empty")
    return await analyze_document(req.text, req.language, API_KEY)

@app.post("/upload")
async def upload(file: UploadFile = File(...), language: Literal["English", "Malayalam"] = "English"):
    contents = await read_upload(file)
    try:
        doc = pymupdf.open(stream=contents, filetype="pdf")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid PDF file")

    try:
        text = await asyncio.wait_for(asyncio.to_thread(extract_pdf_text, doc, language), timeout=45)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="PDF reading timed out")
    except Exception:
        raise HTTPException(status_code=502, detail="Could not read PDF text or run OCR")
    finally:
        doc.close()
    if not text.strip():
        if language == "Malayalam":
            raise HTTPException(status_code=502, detail="Malayalam OCR returned no text. Check the Gemini API key and quota, then try again.")
        raise HTTPException(status_code=400, detail="No readable text found in PDF")
    return {"text": text.strip()}

@app.post("/chat")
async def chat(req: ChatRequest):
    from knowledge_base import retrieve_relevant_rules
    lang_instruction = get_chat_lang_instruction(req.language)

    # Retrieve relevant rules for this question
    try:
        rules = retrieve_relevant_rules(req.message, n=3)
        rules_text = ""
        for rule in rules:
            rules_text += f"- {rule['rule']}\n  Source: {rule['source']}\n"
    except Exception:
        rules_text = ""

    system_prompt = f"""You are ClearClause, a legal literacy assistant for India.
The user has uploaded a document and you have already analyzed it.
{lang_instruction}

RELEVANT LEGAL RULES FROM OUR DATABASE:
{rules_text}

Ground your answers in these rules and cite the source when relevant.
Always end with ✅ Low Risk, ⚠️ Review Carefully, or 🔴 High Risk if relevant.
Never give legal advice — suggest a lawyer for important decisions.
Keep responses concise — 3-5 sentences unless more detail is asked for.

DOCUMENT:
{req.document_context[:4000]}"""

    messages = [{"role": "system", "content": system_prompt}]
    for msg in req.history[-6:]:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": req.message})

    try:
        if groq_client is None:
            raise HTTPException(status_code=500, detail="GROQ_API_KEY is not configured")
        response = await groq_client.chat.completions.create(
            model=MODEL,
            messages=messages,
            temperature=0.3,
            max_tokens=1024,
            timeout=60,
        )
        return {"response": response.choices[0].message.content}
    except Exception as e:
        raise HTTPException(status_code=502, detail="AI service is temporarily unavailable")


@app.get("/voice-chat/greeting")
async def voice_greeting():
    audio_base64 = await generate_tts_base64(VOICE_GREETING)
    return {"greeting": VOICE_GREETING, "audio": audio_base64}


@app.post("/voice-chat")
async def voice_chat_endpoint(req: VoiceChatRequest):
    try:
        response = await asyncio.to_thread(voice_chat, req.message, req.history)
        audio_base64 = await generate_tts_base64(response)
        return {"response": response, "audio": audio_base64}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Voice chat error: {str(e)}")


@app.post("/voice-chat/audio")
async def voice_chat_audio_endpoint(audio: UploadFile = File(...), history: str = Form("[]")):
    import json
    try:
        history_list = json.loads(history)
        audio_bytes = await audio.read()
        
        result = await asyncio.to_thread(voice_chat_audio, audio_bytes, history_list)
        response_text = result["ai_response"]
        user_text = result["user_text"]
        
        audio_base64 = await generate_tts_base64(response_text)
        return {"response": response_text, "audio": audio_base64, "user_text": user_text}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Voice chat audio error: {str(e)}")


@app.post("/admin/login")
async def admin_login(req: AdminLoginRequest):
    if not verify_password(req.password):
        raise HTTPException(status_code=401, detail="Incorrect password")
    return {"token": create_admin_token()}


@app.get("/admin/rules")
async def get_rules(_: bool = Depends(require_admin)):
    return {"rules": await asyncio.to_thread(list_rules)}


@app.post("/admin/rules")
async def add_rule(req: RuleCreateRequest, _: bool = Depends(require_admin)):
    new_rule = await asyncio.to_thread(
        insert_rule, req.clause_type, req.rule, req.source, req.state, req.risk_level
    )
    return {"rule": new_rule}


@app.delete("/admin/rules/{rule_id}")
async def remove_rule(rule_id: int, _: bool = Depends(require_admin)):
    await asyncio.to_thread(delete_rule, rule_id)
    return {"deleted": rule_id}

@app.post("/admin/upload-document")
async def upload_document(
    file: UploadFile = File(...),
    source: str = Form(...),
    state: str = Form("All India"),
    risk_level: str = Form("Reference"),
    _: bool = Depends(require_admin),
):
    contents = await read_upload(file)
    doc = pymupdf.open(stream=contents, filetype="pdf")
    try:
        full_text = "\n".join(page.get_text("text", sort=True) for page in doc)
    finally:
        doc.close()

    if not full_text.strip():
        raise HTTPException(status_code=400, detail="No extractable text found in PDF")

    chunks = chunk_text(full_text)
    inserted = 0
    for chunk in chunks:
        if len(chunk.strip()) < 50:
            continue
        await asyncio.to_thread(
            insert_rule,
            clause_type="Reference Text",
            rule=chunk.strip(),
            source=source,
            state=state,
            risk_level=risk_level,
        )
        inserted += 1

    return {"chunks_inserted": inserted, "total_chunks_found": len(chunks)}