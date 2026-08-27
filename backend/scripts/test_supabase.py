from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()

supabase = create_client(
    os.environ.get("SUPABASE_URL"),
    os.environ.get("SUPABASE_KEY")
)

result = supabase.table("legal_rules").select("id").limit(1).execute()
print("Supabase connected ✓")
print("Rows in legal_rules:", len(result.data))