import asyncio
import json
import os
import re
import traceback

from dotenv import load_dotenv
from fastapi import HTTPException
from groq import AsyncGroq

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
MAX_DOCUMENT_CHARS = 12000
MAX_RULE_CONTEXT_CHARS = 1800
MAX_OUTPUT_TOKENS = 4096
client = AsyncGroq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None
_document_analysis_cache: dict[str, dict] = {}


def clean_extracted_text(text: str) -> str:
    text = text.replace("\x00", "")
    text = "".join(
        character for character in text
        if character in "\n\t" or not re.match(r"[\x00-\x1f\x7f-\x9f]", character)
    )
    return re.sub(r"\s+", " ", text).strip()[:MAX_DOCUMENT_CHARS]


def _contains_malayalam(text: str) -> bool:
    malayalam_characters = sum("\u0d00" <= character <= "\u0d7f" for character in text)
    return malayalam_characters >= 3


def _normalize_risk(value: object) -> str:
    normalized = str(value).strip().upper()
    return normalized if normalized in {"RED", "YELLOW", "GREEN"} else "GREEN"


def _rules_context(text: str) -> str:
    try:
        from knowledge_base import retrieve_relevant_rules
        rules = retrieve_relevant_rules(text, n=10)
        return "\n".join(
            f"- {rule['rule']} Source: {rule['source']} Risk: {rule['risk_level']}"
            for rule in rules
        )[:MAX_RULE_CONTEXT_CHARS]
    except Exception:
        return ""


def _extract_json_payload(content: str) -> dict:
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content).strip()
    try:
        return json.loads(content)
    except Exception:
        pass
    match = re.search(r"(\{.*\})", content, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except Exception:
            pass
    cleaned = re.sub(r",\s*([\]}])", r"\1", content)
    return json.loads(cleaned)


async def _call_groq(system_prompt: str, user_prompt: str) -> dict:
    if client is None:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY is not configured")
    try:
        response = await client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0,
            max_tokens=MAX_OUTPUT_TOKENS,
            response_format={"type": "json_object"},
            timeout=60,
        )
        return _extract_json_payload(response.choices[0].message.content)
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Groq standard call failed ({exc}), attempting unconstrained retry...")
        try:
            response = await client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": system_prompt + "\nReturn strictly a valid JSON object matching the required schema."},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0,
                max_tokens=MAX_OUTPUT_TOKENS,
                timeout=60,
            )
            return _extract_json_payload(response.choices[0].message.content)
        except Exception as retry_exc:
            print(f"Groq analysis error after retry: {retry_exc}")
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=str(exc))


async def analyze_document(document_text: str, language: str = "English", api_key: str = None) -> dict:
    cleaned_text = clean_extracted_text(document_text)
    if not cleaned_text:
        raise HTTPException(status_code=400, detail="Document text cannot be empty")
    output_language = "Malayalam" if language == "Malayalam" else "English"
    cache_key = cleaned_text
    if cache_key in _document_analysis_cache:
        result = json.loads(json.dumps(_document_analysis_cache[cache_key], ensure_ascii=False))
        return await _translate_result(result, output_language) if output_language == "Malayalam" else result

    rules = await asyncio.to_thread(_rules_context, cleaned_text)
    system_prompt = f"""You are ClearClause, a legal document analyst for India, including Kerala lease law.
Return only raw JSON matching this schema, with no Markdown or code fences:
{{"overall_risk":"RED|YELLOW|GREEN","summary":"Short overview of findings","clauses":[{{"clause_name":"Title or clause context","risk_level":"RED|YELLOW|GREEN","explanation":"Detailed explanation"}}]}}
Analyze every distinct clause independently. Do not merge clauses, omit later clauses, or change the number of clauses. Use retrieved rules as authoritative when applicable and cite their source in explanations. This canonical analysis must always be written in English. Keep risk_level and overall_risk as uppercase English values."""
    user_prompt = f"Relevant legal rules:\n{rules or 'No retrieved rules; apply Indian legal principles carefully.'}\n\nDocument:\n{cleaned_text}"
    result = await _call_groq(system_prompt, user_prompt)
    if isinstance(result, list):
        clauses = result
        result = {"clauses": clauses, "summary": "Document analysis completed.", "overall_risk": "GREEN"}
    else:
        clauses = result.get("clauses")

    if not isinstance(clauses, list) or not clauses:
        raise HTTPException(status_code=500, detail="Groq returned an incomplete analysis")
    for clause in clauses:
        if not isinstance(clause, dict) or not clause.get("clause_name") or not clause.get("explanation"):
            raise HTTPException(status_code=500, detail="Groq returned an invalid clause")
        clause["risk_level"] = _normalize_risk(clause.get("risk_level"))
    risk_order = {"GREEN": 0, "YELLOW": 1, "RED": 2}
    result["overall_risk"] = max(
        (clause["risk_level"] for clause in clauses),
        key=lambda risk: risk_order[risk],
    )
    result["summary"] = str(result.get("summary", "")).strip()
    if not result["summary"]:
        result["summary"] = "Legal review of document clauses."
    _document_analysis_cache[cache_key] = result
    return await _translate_result(result, output_language) if output_language == "Malayalam" else result


async def _translate_result(result: dict, language: str) -> dict:
    if language != "Malayalam":
        return result
    original_clauses = result.get("clauses", [])
    if not original_clauses:
        return result

    translation_prompt = f"""Translate the summary, each clause_name, and each explanation into natural, clear Malayalam (മലയാളം).

STRICT REQUIREMENTS:
1. Translate "summary" into natural Malayalam.
2. The output "clauses" list MUST contain EXACTLY {len(original_clauses)} items, one for each input clause in the same order. Do not merge, skip, or truncate any clause.
3. For every clause, translate "clause_name" and "explanation" into Malayalam.
4. Preserve "risk_level" as uppercase English.

Input to translate ({len(original_clauses)} clauses):
{json.dumps({"summary": result.get("summary", ""), "clauses": [{"index": i + 1, "clause_name": c.get("clause_name", ""), "risk_level": c.get("risk_level", ""), "explanation": c.get("explanation", "")} for i, c in enumerate(original_clauses)]}, ensure_ascii=False)}

Return JSON with schema:
{{
  "summary": "Malayalam translation of summary",
  "clauses": [
    {{
      "clause_name": "Malayalam clause title",
      "risk_level": "RED|YELLOW|GREEN",
      "explanation": "Malayalam explanation"
    }}
  ]
}}"""

    try:
        translated = await _call_groq(
            f"You are an expert Indian legal translator translating legal agreements into Malayalam (മലയാളം). You must output valid JSON with exactly {len(original_clauses)} translated clauses.",
            translation_prompt,
        )
    except Exception as exc:
        print(f"Translation call failed ({exc}), falling back to canonical English analysis")
        return result

    if isinstance(translated, list):
        translated_clauses = translated
        summary = result.get("summary", "")
    elif isinstance(translated, dict):
        translated_clauses = translated.get("clauses")
        summary = str(translated.get("summary") or result.get("summary", "")).strip()
    else:
        translated_clauses = []
        summary = result.get("summary", "")

    if not isinstance(translated_clauses, list):
        translated_clauses = []

    final_clauses = []
    for index, orig_clause in enumerate(original_clauses):
        trans_clause = translated_clauses[index] if index < len(translated_clauses) and isinstance(translated_clauses[index], dict) else {}
        clause_name = str(trans_clause.get("clause_name") or orig_clause.get("clause_name", "")).strip()
        explanation = str(trans_clause.get("explanation") or orig_clause.get("explanation", "")).strip()

        final_clauses.append({
            "clause_name": clause_name if clause_name else orig_clause.get("clause_name", ""),
            "risk_level": orig_clause.get("risk_level", "GREEN"),
            "explanation": explanation if explanation else orig_clause.get("explanation", ""),
        })

    if not summary:
        summary = result.get("summary", "")

    return {
        "overall_risk": result["overall_risk"],
        "summary": summary,
        "clauses": final_clauses,
    }


async def analyze_clause(clause_text: str, language: str = "English", api_key: str = None) -> dict:
    document = await analyze_document(clause_text, language, api_key)
    clause = document["clauses"][0]
    risk = clause["risk_level"]
    return {
        "clause_type": clause["clause_name"],
        "plain_explanation": clause["explanation"],
        "risk_rating": risk.title(),
        "flag": clause["explanation"] if risk != "GREEN" else "",
        "disclaimer": "This is legal information, not legal advice.",
    }
