import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pymupdf
from groq import Groq
from clause_analyzer_poc import analyze_clause, analyze_document

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
API_KEY = os.environ.get("GEMINI_API_KEY")
MODEL = "openai/gpt-oss-120b"

class ClauseRequest(BaseModel):
    text: str
    language: str = "English"

class ChatRequest(BaseModel):
    message: str
    document_context: str
    history: list
    language: str = "English"

def get_chat_lang_instruction(language: str) -> str:
    if language == "Malayalam":
        return """Answer in Malayalam (മലയാളം) script only. Use natural conversational Malayalam that a person in Kerala would use. Do not use English words except for legal terms with no Malayalam equivalent. Do not mix Korean, Chinese, or any other script."""
    elif language == "Hindi":
        return "Answer in Hindi (हिंदी) script only. Use natural conversational Hindi. Do not mix other scripts."
    elif language == "Tamil":
        return "Answer in Tamil (தமிழ்) script only. Use natural conversational Tamil. Do not mix other scripts."
    elif language == "Telugu":
        return "Answer in Telugu (తెలుగు) script only. Use natural conversational Telugu. Do not mix other scripts."
    else:
        return "Answer clearly in simple English."

@app.post("/analyze")
async def analyze(req: ClauseRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    return analyze_clause(req.text, req.language, API_KEY)

@app.post("/analyze-document")
async def analyze_document_endpoint(req: ClauseRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Document text cannot be empty")
    return analyze_document(req.text, req.language, API_KEY)

@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    contents = await file.read()
    doc = pymupdf.open(stream=contents, filetype="pdf")
    text = ""
    for page in doc:
        text += page.get_text()
    return {"text": text.strip()}

@app.post("/chat")
async def chat(req: ChatRequest):
    lang_instruction = get_chat_lang_instruction(req.language)

    system_prompt = f"""You are ClearClause, a legal literacy assistant for India.
The user has uploaded a document and you have already analyzed it.
{lang_instruction}
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
        response = groq_client.chat.completions.create(
            model=MODEL,
            messages=messages,
            temperature=0.3,
            max_tokens=1024,
        )
        return {"response": response.choices[0].message.content}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))