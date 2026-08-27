from google import genai
import json
import os
from supabase_client import supabase
from dotenv import load_dotenv

load_dotenv()

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

def get_embedding(text: str) -> list:
    result = client.models.embed_content(
        model="gemini-embedding-001",
        contents=text
    )
    return result.embeddings[0].values

def load_rules_to_supabase(json_path: str):
    with open(json_path) as f:
        rules = json.load(f)

    for rule in rules:
        embedding = get_embedding(rule["rule"])
        supabase.table("legal_rules").insert({
            "clause_type": rule["clause_type"],
            "rule": rule["rule"],
            "source": rule["source"],
            "state": rule.get("state", "Kerala"),
            "risk_level": rule["risk_level"],
            "embedding": embedding
        }).execute()
        print(f"Inserted: {rule['clause_type']}")

def retrieve_relevant_rules(query: str, n: int = 3) -> list:
    query_embedding = get_embedding(query)

    result = supabase.rpc(
        "match_legal_rules",
        {
            "query_embedding": query_embedding,
            "match_count": n
        }
    ).execute()

    return result.data
def chunk_text(text: str, target_chars: int = 900, max_chars: int = 1400) -> list:
    """Split raw document text into embeddable chunks, roughly by paragraph,
    merging small paragraphs together and hard-splitting anything too long."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if len(paragraphs) <= 1:
        paragraphs = [p.strip() for p in text.split("\n") if p.strip()]

    chunks = []
    current = ""
    for p in paragraphs:
        if len(current) + len(p) + 1 <= target_chars:
            current = (current + "\n" + p).strip()
        else:
            if current:
                chunks.append(current)
            if len(p) > max_chars:
                for i in range(0, len(p), max_chars):
                    chunks.append(p[i:i + max_chars])
                current = ""
            else:
                current = p
    if current:
        chunks.append(current)
    return chunks

def insert_rule(clause_type: str, rule: str, source: str, state: str, risk_level: str) -> dict:
    """Used by the admin panel to add a single rule on demand (same embedding path as bulk load)."""
    embedding = get_embedding(rule)
    result = supabase.table("legal_rules").insert({
        "clause_type": clause_type,
        "rule": rule,
        "source": source,
        "state": state,
        "risk_level": risk_level,
        "embedding": embedding
    }).execute()
    return result.data[0]


def list_rules() -> list:
    result = (
        supabase.table("legal_rules")
        .select("id, clause_type, rule, source, state, risk_level")
        .order("id", desc=True)
        .execute()
    )
    return result.data


def delete_rule(rule_id: int) -> None:
    supabase.table("legal_rules").delete().eq("id", rule_id).execute()