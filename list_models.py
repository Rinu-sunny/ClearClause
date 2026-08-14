import requests
import os
import sys
from dotenv import load_dotenv

load_dotenv()

api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
	print("ERROR: Set the GEMINI_API_KEY environment variable first.")
	print('  Windows (PowerShell): $env:GEMINI_API_KEY = "your-key-here"')
	print('  Windows (cmd): set GEMINI_API_KEY=your-key-here')
	print('  macOS/Linux: export GEMINI_API_KEY="your-key-here"')
	sys.exit(1)

r = requests.get(f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}")
print(r.status_code)
print(r.text)