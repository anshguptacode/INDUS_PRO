"""Tiny lexicon sentiment scorer (dependency-free)."""
from __future__ import annotations

import re

POSITIVE = {
    "love", "great", "awesome", "excited", "happy", "proud", "amazing", "win",
    "success", "cleared", "shipped", "launched", "milestone", "finally",
    "beautiful", "best", "achieved", "grateful", "fun", "improved", "solved",
    "passed", "selected", "cracked", "yay", "congrats", "thrilled",
}
NEGATIVE = {
    "hate", "stuck", "bug", "failed", "frustrating", "tired", "worst",
    "annoying", "broke", "broken", "crash", "error", "rejected", "sad",
    "pain", "ugh", "wasted", "difficult", "impossible", "rant", "sucks",
}
NEGATORS = {"not", "no", "never", "hardly", "isnt", "dont", "cant", "wont"}

_word_re = re.compile(r"[a-z']+")


def score(text: str) -> float:
    words = _word_re.findall((text or "").lower())
    total = 0.0
    for i, w in enumerate(words):
        s = 1.0 if w in POSITIVE else -1.0 if w in NEGATIVE else 0.0
        if s and i and words[i - 1] in NEGATORS:
            s = -s
        total += s
    return max(-1.0, min(1.0, total / max(len(words) ** 0.5, 1)))


def label(value: float) -> str:
    if value > 0.15:
        return "positive"
    if value < -0.15:
        return "negative"
    return "neutral"
