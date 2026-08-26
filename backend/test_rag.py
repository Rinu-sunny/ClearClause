from knowledge_base import retrieve_relevant_rules

results = retrieve_relevant_rules("landlord entering without notice")
for r in results:
    print(f"Clause: {r['clause_type']}")
    print(f"Rule: {r['rule'][:100]}...")
    print(f"Risk: {r['risk_level']}")
    print("---")