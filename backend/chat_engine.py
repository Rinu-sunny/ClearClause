import warnings
warnings.filterwarnings("ignore")
from google import genai
from knowledge_base import retrieve_relevant_rules
import os
from dotenv import load_dotenv

load_dotenv()

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

MODELS = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
]

def get_chat_response(
    user_question: str,
    document_context: str,
    chat_history: list,
    language: str
) -> str:

    relevant_rules = retrieve_relevant_rules(user_question)

    rules_text = ""
    for rule in relevant_rules:
        rules_text += f"""
- {rule['rule']}
  Source: {rule['source']}
  Risk level: {rule['risk_level']}
"""

    history_text = ""
    for msg in chat_history[-6:]:
        history_text += f"{msg['role'].upper()}: {msg['content']}\n"

    prompt = f"""You are ClearClause, a friendly legal literacy assistant for people 
in India who need help understanding documents before signing them.
Speak like a knowledgeable, trustworthy friend — simple, clear, never condescending.

DOCUMENT THE USER UPLOADED:
{document_context[:3000]}

RELEVANT LEGAL RULES FROM OUR DATABASE (ground your answer in these):
{rules_text}

CONVERSATION SO FAR:
{history_text}

USER QUESTION: {user_question}

Instructions:
- Answer using the legal rules above as your primary source
- Cite the source when flagging something (e.g. "Under Kerala Rent Control Act...")
- Keep it conversational, 3-5 sentences max unless they ask for more detail
- Always end your response with a risk indicator: ✅ Low Risk, ⚠️ Review Carefully, or 🔴 High Risk
- Respond in {language}
- Never claim to give legal advice — suggest a lawyer for important decisions
- If the retrieved rules don't cover this question, say so honestly"""

    for model in MODELS:
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt
            )
            return response.text
        except Exception as e:
            if "503" in str(e) or "UNAVAILABLE" in str(e) or "429" in str(e):
                print(f"Model {model} unavailable, trying next...")
                continue
            raise

    raise Exception("All models unavailable. Try again in a moment.")