# -*- coding: utf-8 -*-
"""
data/llm.py - LLM provider / API connector.

Currently backed by Groq (openai/gpt-oss-120b). Kept behind a thin provider
class so a future non-Groq API is a drop-in replacement.
"""

import os
from typing import List, Dict

# pyrefly: ignore [import-error, missing-import]
from groq import Groq

from core.config import GROQ_MODEL


class LLMProvider:
    """Thin wrapper around the Groq chat completions API."""

    def __init__(self, model: str = GROQ_MODEL):
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise EnvironmentError("GROQ_API_KEY not set in .env")
        self.client = Groq(api_key=api_key)
        self.model = model

    def call(
        self,
        messages: List[Dict],
        temperature: float = 0.2,
        max_tokens: int = 1024,
    ) -> str:
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return resp.choices[0].message.content.strip()
