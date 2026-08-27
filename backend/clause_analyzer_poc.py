import json
import os
from dotenv import load_dotenv
load_dotenv()
from fastapi import HTTPException
from groq import Groq
from knowledge_base import retrieve_relevant_rules

client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
MODEL = "openai/gpt-oss-120b"
_document_analysis_cache = {}
_document_analysis_cache_version = "document-analysis-v8"
_rules_context_cache = {}

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
    else:
        return f"Write the {fields} in clear, simple English."


def build_rules_context(query: str) -> str:
    cached_context = _rules_context_cache.get(query)
    if cached_context is not None:
        return cached_context
    try:
        queries = [query]
        if len(query) > 1800:
            queries.extend(query[index:index + 1800] for index in range(0, len(query), 1800))

        rules = []
        seen_rule_ids = set()
        for rule_query in queries:
            for rule in retrieve_relevant_rules(rule_query, n=5):
                rule_id = rule.get("id", (rule.get("clause_type"), rule.get("rule")))
                if rule_id not in seen_rule_ids:
                    seen_rule_ids.add(rule_id)
                    rules.append(rule)
        rules = rules[:20]
        if not rules:
            return ""
        rules_text = "RELEVANT INDIAN LEGAL RULES (use these to ground your analysis — cite the source):\n"
        for rule in rules:
            rules_text += f"- {rule['rule']}\n  Source: {rule['source']}\n  Risk: {rule['risk_level']}\n"
        _rules_context_cache[query] = rules_text
        return rules_text
    except Exception:
        return ""


def _normalize_risk_rating(value: str) -> str:
    normalized = str(value).strip().lower()
    if normalized == "red":
        return "Red"
    if normalized == "yellow":
        return "Yellow"
    return "Green"


def _apply_rental_rule_overrides(result: dict) -> dict:
    known_rules = (
        ("deposit", "month", "Red", "Excessive security deposit; Kerala Buildings (Lease and Rent Control) Act 1965, Section 8"),
        ("enter", "notice", "Red", "Landlord entry without reasonable notice conflicts with the tenant's right to peaceful enjoyment; Kerala Buildings (Lease and Rent Control) Act 1965"),
        ("repair", "500", "Yellow", "Maintenance cost is shifted to the tenant; review under Model Tenancy Act 2021, Section 12"),
        ("court", "new delhi", "Red", "Exclusive New Delhi jurisdiction may be unfair and impractical for a Kerala tenant; Consumer Protection Act 2019"),
        ("rent", "any amount", "Red", "Unilateral rent increase without notice conflicts with Model Tenancy Act 2021, Section 8"),
    )
    for statement in result["statements"]:
        text = str(statement.get("statement", "")).lower()
        for first, second, rating, flag in known_rules:
            if first in text and second in text:
                statement["risk_rating"] = rating
                statement["flag"] = flag
                break
    return result


def _call_groq(prompt: str, max_tokens: int, temperature: float = 0.1) -> dict:
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=60,
    )
    text = response.choices[0].message.content.strip()
    text = text.replace("```json", "").replace("```", "").strip()
    return json.loads(text)


def analyze_clause(clause_text: str, language: str, api_key: str = None) -> dict:
    """
    Two-pass: classify risk in English first (deterministic-ish), then
    translate only the human-facing text if a non-English language was requested.
    This keeps the risk_rating consistent regardless of display language.
    """
    rules_context = build_rules_context(clause_text)

    english_prompt = f"""You are a legal-literacy assistant for tier-2 and tier-3 India.
A person is about to sign a document and needs to understand one clause from it.

{rules_context}

Write the plain_explanation, flag, and disclaimer in clear, simple English.
Ensure risk_rating is exactly one of: Green, Yellow, Red.
When flagging a risk, cite the specific law source provided above.

Clause to analyze:
\"\"\"{clause_text}\"\"\"

Respond ONLY with valid JSON, no other text:
{{
  "clause_type": "short label for what kind of clause this is",
  "plain_explanation": "1-3 sentences in simple everyday language",
  "risk_rating": "Green" or "Yellow" or "Red",
  "flag": "specific legal norm violated with source citation if Yellow/Red, empty string otherwise",
  "disclaimer": "standard disclaimer"
}}"""

    try:
        result = _call_groq(english_prompt, max_tokens=4096, temperature=0.1)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Failed to parse model response")
    except Exception as e:
        raise HTTPException(status_code=502, detail="AI service is temporarily unavailable")

    if language == "English":
        return result

    return _translate_clause_result(result, language)


def _translate_clause_result(result: dict, language: str) -> dict:
    lang_instruction = get_lang_instruction(language, "plain_explanation, flag, and disclaimer")
    prompt = f"""Translate the following legal-analysis fields into the requested language.
Do NOT change the meaning, do NOT change which law is cited, do NOT re-judge the risk.
Keep "clause_type" and "risk_rating" exactly as given (clause_type may be translated, risk_rating must NOT change).

{lang_instruction}

Source JSON:
{json.dumps(result, ensure_ascii=False)}

Respond ONLY with valid JSON in the same shape:
{{
  "clause_type": "...",
  "plain_explanation": "...",
  "risk_rating": "{result.get('risk_rating', 'Green')}",
  "flag": "...",
  "disclaimer": "..."
}}"""
    try:
        translated = _call_groq(prompt, max_tokens=1024, temperature=0.1)
        translated["risk_rating"] = result["risk_rating"]  # never trust translation to preserve this
        return translated
    except Exception:
        # Translation failed — better to return the correct English analysis than a wrong one
        return result


def analyze_document(document_text: str, language: str, api_key: str = None) -> dict:
    rules_context = build_rules_context(document_text[:12000])
    lang_instruction = get_lang_instruction(language, "summary, explanation, flag, and disclaimer")
    cache_key = (_document_analysis_cache_version, document_text, rules_context)
    cached_result = _document_analysis_cache.get(cache_key)

    prompt = f"""You are ClearClause, a legal literacy assistant for people in India.
Analyze this document and split it into its meaningful individual statements or clauses.
Return every meaningful statement including low-risk ones. Do not invent text.
The source document may be written in Malayalam or English. Read Malayalam text directly; do not skip, transliterate, or treat Malayalam characters as unreadable. Review the entire document text provided below. Do not stop early, skip later sections, or merge separate numbered clauses.
Create one statement entry for every distinct sentence, numbered clause, obligation, prohibition, payment term, deadline, notice rule, termination rule, penalty, and party right or duty. For a document with ten distinct clauses, return ten statement entries, not a summary of them.
If a tenancy clause requires more than one month's rent as advance, flag it as Red and cite Section 8 of the Kerala Buildings (Lease and Rent Control) Act 1965 when that provision applies.
Evaluate every statement independently against every relevant rule. Do not mark only the clearest violation and do not merge multiple violations into one statement. Preserve the actual Green, Yellow, and Red classifications for all clauses. When a statement matches a retrieved rule, the rule's risk level is authoritative: RED means Red, YELLOW means Yellow, and GREEN means Green unless a more serious applicable rule also matches.
For each statement classify risk as exactly Green, Yellow, or Red.
This classification pass must always be in clear, simple English. Do not translate the response.

{rules_context}

Write the summary, explanation, flag, and disclaimer in clear, simple English.
Keep the statement field faithful to the original document text.
When flagging a risk, cite the specific law source provided above.
Use empty string for flag when there is no concern.
This is legal information, not legal advice.

DOCUMENT:
{document_text[:30000]}

Respond ONLY with valid JSON, no other text:
{{
  "summary": "2-3 sentence overview of the document",
  "statements": [
    {{
      "statement": "exact text of the clause from document",
      "risk_rating": "Green" or "Yellow" or "Red",
      "explanation": "plain language explanation",
      "flag": "specific legal concern with source citation or empty string"
    }}
  ],
  "disclaimer": "standard disclaimer"
}}"""

    if cached_result is not None:
        result = json.loads(json.dumps(cached_result, ensure_ascii=False))
    else:
        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=4096,
                timeout=60,
            )
            text = response.choices[0].message.content.strip()
            text = text.replace("```json", "").replace("```", "").strip()
            result = json.loads(text)
            if not result.get("summary") or not isinstance(result.get("statements"), list):
                raise HTTPException(status_code=502, detail="Incomplete response from model")
            for statement in result["statements"]:
                if not isinstance(statement, dict):
                    raise HTTPException(status_code=502, detail="Invalid statement in model response")
                statement["risk_rating"] = _normalize_risk_rating(statement.get("risk_rating", "Green"))
            result = _apply_rental_rule_overrides(result)
            _document_analysis_cache[cache_key] = result
        except json.JSONDecodeError:
            raise HTTPException(status_code=502, detail="Failed to parse model response")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail="AI service is temporarily unavailable")

    if language == "English":
        return result

    return _translate_document_result(result, language)


def _translate_document_result(result: dict, language: str) -> dict:
    lang_instruction = get_lang_instruction(language, "summary, explanation, and disclaimer")

    # Preserve statement text and risk_rating exactly; only translate prose fields.
    original_ratings = [_normalize_risk_rating(s["risk_rating"]) for s in result["statements"]]
    original_statements = [s["statement"] for s in result["statements"]]

    prompt = f"""Translate the following legal-analysis JSON's prose fields into the requested language.
Do NOT change which clause each entry refers to, do NOT change risk_rating values,
do NOT re-judge risk, do NOT add or remove statements. Keep the "statement" field
in its original wording (do not translate it — it's a quote from the source document).

{lang_instruction}

Source JSON:
{json.dumps(result, ensure_ascii=False)}

Respond ONLY with valid JSON in the exact same shape (same number of statements, same order):
{{
  "summary": "...",
  "statements": [
    {{"statement": "...", "risk_rating": "Green|Yellow|Red", "explanation": "...", "flag": "..."}}
  ],
  "disclaimer": "..."
}}"""

    try:
        translated = _call_groq(prompt, max_tokens=3072, temperature=0.1)
        if not isinstance(translated.get("statements"), list) or len(translated["statements"]) != len(original_ratings):
            return result  # translation reshaped the data unexpectedly — fall back to correct English
        # Keep translated prose, but force the canonical order, ratings, and quoted text.
        for i, s in enumerate(translated["statements"]):
            if not isinstance(s, dict):
                return result
            s["risk_rating"] = original_ratings[i]
            s["statement"] = original_statements[i]
        return translated
    except Exception:
        return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--clause", default=SAMPLE_CLAUSE)
    parser.add_argument("--language", default="English")
    args = parser.parse_args()
    result = analyze_clause(args.clause, args.language)
    print(json.dumps(result, ensure_ascii=False, indent=2))