"""FastAPI analytics microservice.

POST /run/{user_id} — pull the user's raw docs from Mongo, clean them,
persist tidy posts to Postgres, and regenerate insights + 7-day forecast.
Called by the sync worker after every ingest; idempotent.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException
from psycopg2.extras import Json, execute_values

from . import cleaning, eda, forecast, sentiment
from .db import mongo_db, pg_conn

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("analytics")

app = FastAPI(title="Footprint Analytics", docs_url=None, redoc_url=None)

UPSERT_POSTS = """
    INSERT INTO posts (account_id, platform, external_id, content, topic, hashtags,
                       posted_at, likes, comments, shares, impressions,
                       engagement_rate, sentiment_label, sentiment_score)
    VALUES %s
    ON CONFLICT (platform, external_id) DO UPDATE SET
        likes = EXCLUDED.likes, comments = EXCLUDED.comments,
        shares = EXCLUDED.shares, impressions = EXCLUDED.impressions,
        engagement_rate = EXCLUDED.engagement_rate,
        sentiment_label = EXCLUDED.sentiment_label,
        sentiment_score = EXCLUDED.sentiment_score
"""


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/run/{user_id}")
def run(user_id: int):
    with pg_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT timezone FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "user not found")
        tz = row[0] or "Asia/Kolkata"
        cur.execute("SELECT id FROM social_accounts WHERE user_id = %s", (user_id,))
        account_ids = [r[0] for r in cur.fetchall()]

    if not account_ids:
        return {"status": "no_accounts"}

    raw_docs = list(mongo_db()["raw_posts"].find(
        {"account_id": {"$in": account_ids}}, {"_id": 0}))
    df, report = cleaning.clean(raw_docs)
    log.info("user=%s cleaning=%s", user_id, report)
    if df.empty:
        return {"status": "no_data", "cleaning": report}

    scores = df["content"].map(sentiment.score)
    df["sentiment_score"] = scores.round(3)
    df["sentiment_label"] = scores.map(sentiment.label)

    post_rows = [
        (int(r.account_id), r.platform, r.external_id, r.content, r.topic,
         list(r.hashtags or []), r.posted_at.to_pydatetime(),
         int(r.likes), int(r.comments), int(r.shares), int(r.impressions),
         float(r.engagement_rate), r.sentiment_label, float(r.sentiment_score))
        for r in df.itertuples(index=False)
    ]
    insights = eda.run_all(df, tz=tz)
    preds = forecast.forecast(df)

    with pg_conn() as conn, conn.cursor() as cur:
        execute_values(cur, UPSERT_POSTS, post_rows, page_size=500)
        cur.execute("DELETE FROM insights WHERE user_id = %s", (user_id,))
        execute_values(cur,
            "INSERT INTO insights (user_id, insight_type, payload) VALUES %s",
            [(user_id, i["type"], Json(i)) for i in insights])
        cur.execute("DELETE FROM predictions WHERE user_id = %s", (user_id,))
        if preds:
            execute_values(cur, """
                INSERT INTO predictions (user_id, platform, target_date,
                    predicted_low, predicted_high, confidence, model) VALUES %s""",
                [(user_id, "all", p["target_date"],
                  int(round(p["predicted_low"])), int(round(p["predicted_high"])),
                  0.80, p["model"][:30]) for p in preds])

    return {
        "status": "ok",
        "cleaning": report,
        "posts_upserted": len(post_rows),
        "insights": len(insights),
        "predictions": len(preds),
    }
