from __future__ import annotations

import os
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine


def _normalize_db_url(url: str) -> str:
    """Normaliza URLs legadas do Postgres para formato aceito pelo SQLAlchemy."""
    raw = (url or "").strip()
    if raw.startswith("postgres://"):
        return raw.replace("postgres://", "postgresql://", 1)
    return raw


def get_db_url() -> str:
    """
    Resolve a URL do banco para a API offline.

    Prioridade:
    1) DB_URL
    2) DATABASE_URL
    3) Componentes separados DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASS
    """
    url = _normalize_db_url(os.getenv("DB_URL", ""))
    if url:
        return url

    url = _normalize_db_url(os.getenv("DATABASE_URL", ""))
    if url:
        return url

    host = os.getenv("DB_HOST", "").strip()
    port = os.getenv("DB_PORT", "5432").strip() or "5432"
    name = os.getenv("DB_NAME", "").strip()
    user = os.getenv("DB_USER", "").strip()
    password = os.getenv("DB_PASS", "").strip()

    if all([host, name, user, password]):
        return f"postgresql+psycopg://{user}:{password}@{host}:{port}/{name}"

    raise RuntimeError(
        "Banco nao configurado. Defina DB_URL ou DATABASE_URL "
        "(ou DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS)."
    )


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """Cria um engine SQLAlchemy reutilizavel para toda a API."""
    return create_engine(
        get_db_url(),
        pool_pre_ping=True,
        pool_recycle=1800,
        future=True,
    )
