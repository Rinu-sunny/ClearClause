from chat_engine import get_chat_response

response = get_chat_response(
    user_question="Can my landlord enter without notice?",
    document_context="The Landlord shall have the right to enter the premises at any time for inspection without prior notice to the Tenant.",
    chat_history=[],
    language="English"
)
print(response)