"""
ClearClause — Proof of Concept: Single Clause Analyzer
--------------------------------------------------------
Analyzes a single legal clause using the Gemini API with native JSON schema enforcement.

SETUP (2 minutes):
1. Get a free Gemini API key: https://aistudio.google.com/apikey
2. pip install requests
3. Set your key:   export GEMINI_API_KEY="your-key-here"   (Mac/Linux)
                   set GEMINI_API_KEY=your-key-here        (Windows cmd)
4. Run:   python clause_analyzer_poc.py
"""

import argparse
import json
import os
import sys
from dotenv import load_dotenv
load_dotenv()
import requests
from fastapi import HTTPException

MODEL = "gemini-flash-latest"
API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

SAMPLE_CLAUSE = (
    "The Landlord shall have the right to enter the premises at any time "
    "for inspection or maintenance purposes without prior notice to the Tenant."
)

# JSON Schema for Gemini structured output enforcement
RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "clause_type": {
            "type": "STRING",
            "description": "Short label for what kind of clause this is"
        },
        "plain_explanation": {
            "type": "STRING",
            "description": "1-3 sentences in simple, everyday language explaining what this clause means"
        },
        "risk_rating": {
            "type": "STRING",
            "enum": ["Green", "Yellow", "Red"],
            "description": "Risk assessment level"
        },
        "flag": {
            "type": "STRING",
            "description": "Specific statutory right or legal norm violated if Yellow/Red; empty string otherwise"
        },
        "disclaimer": {
            "type": "STRING",
            "description": "Standard legal disclaimer text"
        }
    },
    "required": ["clause_type", "plain_explanation", "risk_rating", "flag", "disclaimer"]
}


def build_prompt(clause_text: str, language: str) -> str:
    return f"""You are a legal-literacy assistant for tier-2 and tier-3 India.
A person is about to sign a document and needs to understand one clause from it.

Analyze the following clause and respond in {language} where requested:
- Write the 'plain_explanation' and 'flag' fields in {language}.
- Ensure 'risk_rating' strictly matches one of: Green, Yellow, Red.

Clause to analyze:
\"\"\"{clause_text}\"\"\""""


def analyze_clause(clause_text: str, language: str, api_key: str) -> dict:
    payload = {
        "contents": [{"parts": [{"text": build_prompt(clause_text, language)}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
            "temperature": 0.2  # Low temperature for precise legal analysis
        }
    }

    try:
        resp = requests.post(f"{API_URL}?key={api_key}", json=payload, timeout=30)
        resp.raise_for_status()
    except requests.exceptions.HTTPError:
        body = resp.text[:500]
        status_map = {
            400: "Gemini rejected the request (400). Often means a bad API key or malformed request.",
            403: "Access denied (403). Check if your API key is active.",
            404: f"Model '{MODEL}' not found (404). Check current model names in AI Studio.",
            429: "Rate limit hit (429). Free tier rate cap reached — wait a moment and retry."
        }
        msg = status_map.get(resp.status_code, f"Gemini API returned HTTP {resp.status_code}.")
        print(f"ERROR: {msg}\nDetails: {body}")
        raise HTTPException(status_code=500, detail=msg)
    except requests.exceptions.RequestException as e:
        print(f"ERROR: Could not reach Gemini API (network issue): {e}")
        raise HTTPException(status_code=500, detail=msg)

    data = resp.json()

    if not data.get("candidates"):
        reason = data.get("promptFeedback", {}).get("blockReason", "unknown")
        print(f"ERROR: Gemini returned no result (blockReason: {reason}).")
        raise HTTPException(status_code=500, detail=msg)

    raw_text = data["candidates"][0]["content"]["parts"][0]["text"].strip()

    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        print(f"ERROR: Failed to parse JSON response:\n{raw_text}")
        raise HTTPException(status_code=500, detail=msg)


def main():
    parser = argparse.ArgumentParser(description="ClearClause single-clause analyzer PoC")
    parser.add_argument("--clause", default=SAMPLE_CLAUSE, help="The legal clause text to analyze")
    parser.add_argument("--language", default="English", help="Output language (e.g., Malayalam, Hindi, Tamil, Telugu, English)")
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: Set the GEMINI_API_KEY environment variable first.")
        print('  export GEMINI_API_KEY="your-key-here"')
        sys.exit(1)

    print(f"Analyzing clause (output language: {args.language})...\n")
    print(f"Clause: {args.clause}\n")

    result = analyze_clause(args.clause, args.language, api_key)

    print("=" * 60)
    print(f"Clause type   : {result.get('clause_type')}")
    print(f"Risk rating   : {result.get('risk_rating')}")
    print(f"Explanation   : {result.get('plain_explanation')}")
    if result.get("flag"):
        print(f"Flag          : {result.get('flag')}")
    print(f"Disclaimer    : {result.get('disclaimer')}")
    print("=" * 60)


if __name__ == "__main__":
    main()