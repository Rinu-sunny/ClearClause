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