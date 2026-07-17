"""EDA insight extraction.

Timing/topic effects are measured on ABSOLUTE engagement
(likes + comments + shares) — engagement *rate* normalises reach away and
hides them. Time-of-day is computed in the user's timezone.
"""
from __future__ import annotations

import pandas as pd

from . import sentiment

MIN_BUCKET = 8  # ignore buckets with fewer posts than this


def _fmt_window(hour: int) -> str:
    return f"{hour:02d}:00-{(hour + 2) % 24:02d}:00"


def run_all(df: pd.DataFrame, tz: str = "Asia/Kolkata") -> list[dict]:
    insights = []
    if df.empty:
        return insights

    df = df.copy()
    df["engagement"] = df["likes"] + df["comments"] + df["shares"]
    local = df["posted_at"].dt.tz_convert(tz)
    df["dow"] = local.dt.day_name()
    df["hour2"] = (local.dt.hour // 2) * 2
    overall = float(df["engagement"].mean()) or 1.0

    # --- optimal posting time -------------------------------------------
    buckets = (df.groupby(["dow", "hour2"])["engagement"]
                 .agg(["mean", "count"])
                 .query("count >= @MIN_BUCKET"))
    if len(buckets):
        (dow, hour2), row = max(buckets.iterrows(), key=lambda kv: kv[1]["mean"])
        # only report when meaningfully above average — sparse data otherwise
        if row["mean"] / overall >= 1.05:
            insights.append({
                "type": "optimal_time",
                "title": f"Best time to post: {dow} {_fmt_window(int(hour2))}",
                "detail": {
                    "day": dow, "window": _fmt_window(int(hour2)),
                    "lift": round(float(row["mean"]) / overall, 2),
                    "sample": int(row["count"]), "timezone": tz,
                },
            })

    # --- top topic ------------------------------------------------------
    topics = (df.dropna(subset=["topic"])
                .groupby("topic")["engagement"]
                .agg(["mean", "count"])
                .query("count >= @MIN_BUCKET"))
    if len(topics):
        topic, row = max(topics.iterrows(), key=lambda kv: kv[1]["mean"])
        if row["mean"] / overall >= 1.05:
            insights.append({
                "type": "top_topic",
                "title": f"'{topic}' posts outperform your average",
                "detail": {
                    "topic": topic,
                    "lift": round(float(row["mean"]) / overall, 2),
                    "sample": int(row["count"]),
                },
            })

    # --- sentiment ------------------------------------------------------
    scores = df["content"].map(sentiment.score)
    labels = scores.map(sentiment.label)
    pos = df.loc[labels == "positive", "engagement"].mean()
    insights.append({
        "type": "sentiment_summary",
        "title": "Tone of your recent posts",
        "detail": {
            "positive_pct": round(float((labels == "positive").mean()) * 100, 1),
            "neutral_pct": round(float((labels == "neutral").mean()) * 100, 1),
            "negative_pct": round(float((labels == "negative").mean()) * 100, 1),
            "positive_lift": round(float(pos) / overall, 2) if pd.notna(pos) else None,
        },
    })

    # --- keyword boost ---------------------------------------------------
    exploded = df.explode("hashtags").dropna(subset=["hashtags"])
    if len(exploded):
        tags = (exploded.groupby(exploded["hashtags"].str.lower())["engagement"]
                        .agg(["mean", "count"])
                        .query("count >= @MIN_BUCKET"))
        if len(tags):
            tag, row = max(tags.iterrows(), key=lambda kv: kv[1]["mean"])
            if row["mean"] / overall >= 1.05:
                insights.append({
                    "type": "keyword_boost",
                    "title": f"#{tag} is your highest-performing hashtag",
                    "detail": {
                        "hashtag": str(tag),
                        "lift": round(float(row["mean"]) / overall, 2),
                        "sample": int(row["count"]),
                    },
                })

    # --- influencer score -------------------------------------------------
    weekly = (df.set_index("posted_at")
                .resample("W")["engagement_rate"].mean().dropna())
    er_slope = 0.0
    if len(weekly) >= 4:
        x = pd.Series(range(len(weekly)), index=weekly.index, dtype=float)
        er_slope = float(((x - x.mean()) * (weekly - weekly.mean())).sum()
                         / max(((x - x.mean()) ** 2).sum(), 1e-9))
    span_weeks = max((df["posted_at"].max() - df["posted_at"].min()).days / 7, 1)
    avg_week = len(df) / span_weeks
    growth = max(er_slope, 0.0)
    score = round(min(100.0,
                      35 + min(er_slope * 150, 20)
                      + min(growth * 100, 15)
                      + min(avg_week * 4, 12)
                      + min(overall / 40, 18)), 1)
    insights.append({
        "type": "influencer_score",
        "title": f"Influencer score: {score}/100",
        "detail": {
            "score": float(score),
            "er_trend_per_week": round(er_slope, 4),
            "posts_per_week": round(float(avg_week), 1),
            "avg_engagement": round(overall, 1),
        },
    })
    return insights
