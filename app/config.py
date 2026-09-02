import os

from dotenv import load_dotenv

load_dotenv()

API_KEY = os.environ.get("API_KEY", "dev-key")
ANALYST_NAME = os.environ.get("ANALYST_NAME", "analyst")
