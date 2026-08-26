import json
import os
from dotenv import load_dotenv
load_dotenv()
from fastapi import HTTPException
from groq import Groq

client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
MODEL = "openai/gpt-oss-120b"

SAMPLE_CLAUSE = (
    "The Landlord shall have the right to enter the premises at any time "
    "for inspection or maintenance purposes without prior notice to the Tenant."
)

def get_lang_instruction(language: str, fields: str) -> str:
    if language == "Malayalam":
        return f"""Write the {fields} in Malayalam (മലയാളം) script only.
Use natural conversational Malayalam that a person in Kerala would use.
Do not use English words except for proper legal terms that have no Malayalam equivalent.
Do not mix Korean, Chinese, or any other script. Only Malayalam unicode characters and essential English legal terms."""
    elif language == "Hindi":
        return f"""Write the {fields} in Hindi (हिंदी) script only.
Use natural conversational Hindi. Do not mix other scripts."""
    elif language == "Tamil":
        return f"""Write the {fields} in Tamil (தமிழ்) script only.
Use natural conversational Tamil. Do not mix other scripts."""
    elif language == "Telugu":
        return f"""Write the {fields} in Telugu (తెలుగు) script only.
Use natural conversational Telugu. Do not mix other scripts."""
    else:
        return f"Write the {fields} in clear, simple English."


def analyze_clause(clause_text: str, language: str, api_key: str = None) -> dict:
    lang_instruction = get_lang_instruction(language, "plain_explanation, flag, and disclaimer")
    prompt = f"""You are a legal-literacy assistant for tier-2 and tier-3 India.
A person is about to sign a document and needs to understand one clause from it.

{lang_instruction}
Ensure risk_rating is exactly one of: Green, Yellow, Red.
Keep statement text faithful to the original document.

Clause to analyze:
\"\"\"{clause_text}\"\"\"

Respond ONLY with valid JSON, no other text:
{{
  "clause_type": "short label for what kind of clause this is",
  "plain_explanation": "1-3 sentences in simple everyday language",
  "risk_rating": "Green" or "Yellow" or "Red",
  "flag": "specific legal norm violated if Yellow/Red, empty string otherwise",
  "disclaimer": "standard disclaimer"
}}"""

    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=1024,
        )
        text = response.choices[0].message.content.strip()
        text = text.replace("```json", "").replace("```", "").strip()
        return json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Failed to parse model response")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


def analyze_document(document_text: str, language: str, api_key: str = None) -> dict:
    lang_instruction = get_lang_instruction(language, "summary, explanation, flag, and disclaimer")
    prompt = f"""You are ClearClause, a legal literacy assistant for people in India.
Analyze this document and split it into its meaningful individual statements or clauses.
Return every meaningful statement including low-risk ones. Do not invent text.
For each statement classify risk as exactly Green, Yellow, or Red.

{lang_instruction}
Keep the statement field faithful to the original document text.
Use empty string for flag when there is no concern.
This is legal information, not legal advice.

DOCUMENT:
{document_text[:8000]}

Respond ONLY with valid JSON, no other text:
{{
  "summary": "2-3 sentence overview of the document",
  "statements": [
    {{
      "statement": "exact text of the clause from document",
      "risk_rating": "Green" or "Yellow" or "Red",
      "explanation": "plain language explanation",
      "flag": "specific legal concern or empty string"
    }}
  ],
  "disclaimer": "standard disclaimer"
}}"""

    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=4096,
        )
        text = response.choices[0].message.content.strip()
        text = text.replace("```json", "").replace("```", "").strip()
        result = json.loads(text)
        if not result.get("summary") or not isinstance(result.get("statements"), list):
            raise HTTPException(status_code=502, detail="Incomplete response from model")
        return result
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Failed to parse model response")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--clause", default=SAMPLE_CLAUSE)
    parser.add_argument("--language", default="English")
    args = parser.parse_args()
    result = analyze_clause(args.clause, args.language)
    print(json.dumps(result, ensure_ascii=False, indent=2))