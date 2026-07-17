import os

import psycopg2
from pymongo import MongoClient

PG_DSN = dict(
    host=os.getenv("PGHOST", "localhost"),
    port=int(os.getenv("PGPORT", "5432")),
    user=os.getenv("PGUSER", "footprint"),
    password=os.getenv("PGPASSWORD", "footprint"),
    dbname=os.getenv("PGDATABASE", "footprint"),
)

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")

_mongo_client = None


def pg_conn():
    return psycopg2.connect(**PG_DSN)


def mongo_db():
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = MongoClient(MONGO_URL, maxPoolSize=10)
    return _mongo_client["footprint"]
