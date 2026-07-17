"""Data cleaning: raw API docs -> one tidy frame.

Handles duplicates, mixed timestamp formats, missing metrics (common on
real APIs — e.g. Instagram doesn't return impressions without an extra
insights call), and bot/spam outliers.
"""
from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd

TWITTER_LEGACY_FMT = "%a %b %d %H:%M:%S %z %Y"

HASHTAG_TOPIC = {
    "gate2026": "gate_prep", "gatecse": "gate_prep", "engineering": "gate_prep",
    "dsa": "dsa", "leetcode": "dsa", "100daysofcode": "dsa",
    "buildinpublic": "project", "sideproject": "project",
    "reactjs": "react", "webdev": "react", "javascript": "react",
    "django": "django", "python": "django", "backend": "django",
    "machinelearning": "ai_ml", "ai": "ai_ml", "datascience": "ai_ml",
    "career": "career", "internship": "career", "placements": "career",
    "life": "personal", "college": "personal",
    "debugging": "bug_rant", "programmerlife": "bug_rant",
}


def parse_created_at(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    for parser in (
        lambda v: datetime.fromisoformat(v.replace("Z", "+00:00")),
        lambda v: datetime.strptime(v, TWITTER_LEGACY_FMT),
    ):
        try:
            return parser(value)
        except (ValueError, TypeError):
            continue
    return None


def infer_topic(hashtags) -> str | None:
    for tag in hashtags or []:
        topic = HASHTAG_TOPIC.get(str(tag).lower())
        if topic:
            return topic
    return None


def clean(raw_docs: list[dict]) -> tuple[pd.DataFrame, dict]:
    rows = []
    for d in raw_docs:
        m = d.get("metrics") or {}
        rows.append({
            "account_id": d.get("account_id"),
            "platform": d.get("platform"),
            "external_id": d.get("external_id"),
            "content": d.get("text") or "",
            "hashtags": d.get("hashtags") or [],
            "topic": infer_topic(d.get("hashtags")),
            "posted_at": parse_created_at(d.get("created_at")),
            "likes": m.get("like_count"),
            "comments": m.get("reply_count"),
            "shares": m.get("share_count"),
            "impressions": m.get("impression_count"),
        })
    df = pd.DataFrame(rows)
    report = {"raw_rows": len(df)}
    if df.empty:
        report.update(duplicates_removed=0, values_imputed=0,
                      outliers_removed=0, clean_rows=0)
        return df, report

    df = df.dropna(subset=["external_id", "posted_at", "likes"])

    df["completeness"] = df[["comments", "shares", "impressions"]].notna().sum(axis=1)
    df = (df.sort_values("completeness", ascending=False)
            .drop_duplicates(subset=["platform", "external_id"], keep="first")
            .drop(columns="completeness"))
    report["duplicates_removed"] = report["raw_rows"] - len(df)

    imputed = int(df[["comments", "shares", "impressions"]].isna().sum().sum())
    for col, ratio_default in (("comments", 0.10), ("shares", 0.15), ("impressions", 40.0)):
        for platform, grp in df.groupby("platform"):
            known = grp.dropna(subset=[col])
            ratio = (known[col] / known["likes"].clip(lower=1)).median() if len(known) else ratio_default
            if pd.isna(ratio) or ratio <= 0:
                ratio = ratio_default
            mask = (df["platform"] == platform) & df[col].isna()
            df.loc[mask, col] = (df.loc[mask, "likes"].clip(lower=1) * ratio).round()
    report["values_imputed"] = imputed

    df[["likes", "comments", "shares", "impressions"]] = (
        df[["likes", "comments", "shares", "impressions"]].astype(float))
    z = df.groupby("account_id")["likes"].transform(
        lambda s: (s - s.mean()) / (s.std() or 1))
    report["outliers_removed"] = int((np.abs(z) > 4).sum())
    df = df[np.abs(z) <= 4]

    df["engagement_rate"] = (
        100 * (df["likes"] + df["comments"] + df["shares"])
        / df["impressions"].clip(lower=1)).round(2)
    df["posted_at"] = pd.to_datetime(df["posted_at"], utc=True)
    report["clean_rows"] = len(df)
    return df.reset_index(drop=True), report
