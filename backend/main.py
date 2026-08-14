from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import fitz  # PyMuPDF
import os
from dotenv import load_dotenv
load_dotenv()
from clause_analyzer_poc import analyze_clause

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY = os.environ.get("GEMINI_API_KEY", "your-key-here")

class ClauseRequest(BaseModel):
    text: str
    language: str = "English"

@app.post("/analyze")
async def analyze(req: ClauseRequest):
    result = analyze_clause(req.text, req.language, API_KEY)
    return result

@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    contents = await file.read()
    doc = fitz.open(stream=contents, filetype="pdf")
    text = ""
    for page in doc:
        text += page.get_text()
    return {"text": text.strip()}