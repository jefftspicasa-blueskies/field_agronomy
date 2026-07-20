from datetime import date, datetime
import json
import os
import re
import sys
from uuid import UUID
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, TypeAdapter
from sqlalchemy import text

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    def load_dotenv(path: Optional[str] = None, *args, **kwargs):
        env_path = path or ".env"
        if not os.path.isfile(env_path):
            return False

        loaded = False
        with open(env_path, "r", encoding="utf-8") as fh:
            for line in fh:
                item = line.strip()
                if not item or item.startswith("#") or "=" not in item:
                    continue
                key, value = item.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
                    loaded = True
        return loaded


# Mantem imports e assets relativos a esta pasta de servico.
ROOT_DIR = os.path.dirname(__file__)
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)

load_dotenv(os.path.join(ROOT_DIR, ".env"))

from dal import get_engine


app = FastAPI(title="Blue Skies Offline Sync API", version="2.0.0")
PWA_DIR = os.path.join(ROOT_DIR, "agronomia_offline_pwa")
API_KEY_ENV_VAR = "AGRONOMIA_SYNC_API_KEY"


class AmostraItem(BaseModel):
    peso_gramas: float = Field(ge=0)
    maturacao: Optional[int] = Field(default=None, ge=1, le=5)
    materia_seca: Optional[float] = Field(default=None, ge=0, le=100)


class AnaliseDados(BaseModel):
    fornecedor_id: int
    talhao: Optional[str] = Field(default=None, max_length=80)
    variedade: Optional[str] = Field(default=None, max_length=80)
    data_analise: Optional[date] = None
    peso_pu: Optional[float] = Field(default=None, ge=0)
    numero_frutos_analisados: Optional[int] = Field(default=None, ge=0)
    defeitos_leves: int = Field(default=0, ge=0)
    defeitos_criticos: int = Field(default=0, ge=0)
    observacoes: Optional[str] = Field(default=None, max_length=1200)
    amostras: Optional[List[AmostraItem]] = None


class InspecaoDados(BaseModel):
    fornecedor_id: int
    talhao: str = Field(min_length=1, max_length=80)
    estagio_fenologico: str = Field(min_length=1, max_length=80)
    data_inspecao: Optional[date] = None
    pragas: Optional[str] = Field(default=None, max_length=240)
    doencas: Optional[str] = Field(default=None, max_length=240)
    irrigacao_escala: int = Field(default=0, ge=0, le=5)
    adubacao_escala: int = Field(default=0, ge=0, le=5)
    clima: Optional[str] = Field(default=None, max_length=80)
    acao_recomendada: Optional[str] = Field(default=None, max_length=240)
    observacoes: Optional[str] = Field(default=None, max_length=1200)


class OcorrenciaDados(BaseModel):
    tipo: str = Field(min_length=1, max_length=40)
    severidade: str = Field(min_length=1, max_length=20)
    fornecedor_id: int
    talhao: Optional[str] = Field(default=None, max_length=80)
    data_hora: Optional[datetime] = None
    coordenadas: Optional[str] = Field(default=None, max_length=80)
    descricao: str = Field(min_length=1, max_length=1200)


TIPO_ANALISE = "analise_campo"
TIPO_INSPECAO = "inspecao_talhao"
TIPO_OCORRENCIA = "ocorrencia_campo"

TIPOS_SUPORTADOS = (TIPO_ANALISE, TIPO_INSPECAO, TIPO_OCORRENCIA)


class RegistroIn(BaseModel):
    id_local: str
    tipo_registro: Literal["analise_campo", "inspecao_talhao", "ocorrencia_campo"] = TIPO_ANALISE
    criado_em_local: Optional[datetime] = None
    dados: Dict[str, Any]


class SyncLoteIn(BaseModel):
    dispositivo_id: str
    usuario: str
    registros: List[RegistroIn]


_analise_adapter = TypeAdapter(AnaliseDados)
_inspecao_adapter = TypeAdapter(InspecaoDados)
_ocorrencia_adapter = TypeAdapter(OcorrenciaDados)


def _is_api_key_enabled() -> bool:
    return bool((os.getenv(API_KEY_ENV_VAR) or "").strip())


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2:
        return None
    if parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


def require_sync_api_key(
    x_api_key: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
):
    expected = (os.getenv(API_KEY_ENV_VAR) or "").strip()
    if not expected:
        return

    provided = (x_api_key or "").strip() or (_extract_bearer_token(authorization) or "").strip()
    if provided != expected:
        raise HTTPException(status_code=401, detail="Nao autorizado")


def validar_registro(tipo_registro: str, dados: Dict[str, Any]) -> BaseModel:
    if tipo_registro == TIPO_ANALISE:
        return _analise_adapter.validate_python(dados)
    if tipo_registro == TIPO_INSPECAO:
        return _inspecao_adapter.validate_python(dados)
    if tipo_registro == TIPO_OCORRENCIA:
        return _ocorrencia_adapter.validate_python(dados)
    raise ValueError(f"Tipo de registro nao suportado: {tipo_registro}")


def _sync_has_unique_id_local(conn) -> bool:
    return bool(
        conn.execute(
            text(
                """
                SELECT COUNT(*) > 0
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                WHERE tc.table_schema = 'trusted'
                  AND tc.table_name = 'tb_sync_offline_agronomia'
                  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
                  AND kcu.column_name = 'id_local'
                """
            )
        ).scalar()
    )


def _sync_id_has_default(conn) -> bool:
    return bool(
        conn.execute(
            text(
                """
                SELECT column_default IS NOT NULL
                FROM information_schema.columns
                WHERE table_schema = 'trusted'
                  AND table_name = 'tb_sync_offline_agronomia'
                  AND column_name = 'id'
                """
            )
        ).scalar()
    )


def _sync_next_id(conn) -> int:
    conn.execute(text("LOCK TABLE trusted.tb_sync_offline_agronomia IN SHARE ROW EXCLUSIVE MODE"))
    next_id = conn.execute(text("SELECT COALESCE(MAX(id), 0) + 1 FROM trusted.tb_sync_offline_agronomia")).scalar()
    return int(next_id)


def upsert_sync_sucesso(conn, payload: SyncLoteIn, reg: RegistroIn, payload_json: Dict[str, Any], id_servidor: Optional[int]):
    params = {
        "id_local": reg.id_local,
        "dispositivo_id": payload.dispositivo_id,
        "usuario": payload.usuario,
        "payload_json": json.dumps(payload_json, ensure_ascii=False),
        "criado_em_local": reg.criado_em_local,
        "id_servidor": id_servidor,
    }

    has_unique_id_local = conn.execute(
        text(
            """
            SELECT COUNT(*) > 0
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.table_schema = 'trusted'
              AND tc.table_name = 'tb_sync_offline_agronomia'
              AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
              AND kcu.column_name = 'id_local'
            """
        )
    ).scalar()
    id_has_default = _sync_id_has_default(conn)

    if has_unique_id_local:
        if id_has_default:
            conn.execute(
                text(
                    """
                    INSERT INTO trusted.tb_sync_offline_agronomia
                    (id_local, dispositivo_id, usuario, payload_json, status_sync, tentativas, criado_em_local, recebido_em_servidor, sincronizado_em, id_servidor)
                    VALUES (:id_local, :dispositivo_id, :usuario, CAST(:payload_json AS jsonb), 'enviado', 1, :criado_em_local, NOW(), NOW(), :id_servidor)
                    ON CONFLICT (id_local)
                    DO UPDATE SET
                      status_sync = EXCLUDED.status_sync,
                      tentativas = trusted.tb_sync_offline_agronomia.tentativas + 1,
                      sincronizado_em = NOW(),
                      id_servidor = EXCLUDED.id_servidor,
                      erro_ultima_tentativa = NULL,
                      payload_json = EXCLUDED.payload_json
                    """
                ),
                params,
            )
        else:
            sync_id = _sync_next_id(conn)
            conn.execute(
                text(
                    """
                    INSERT INTO trusted.tb_sync_offline_agronomia
                    (id, id_local, dispositivo_id, usuario, payload_json, status_sync, tentativas, criado_em_local, recebido_em_servidor, sincronizado_em, id_servidor)
                    VALUES (:id, :id_local, :dispositivo_id, :usuario, CAST(:payload_json AS jsonb), 'enviado', 1, :criado_em_local, NOW(), NOW(), :id_servidor)
                    ON CONFLICT (id_local)
                    DO UPDATE SET
                      status_sync = EXCLUDED.status_sync,
                      tentativas = trusted.tb_sync_offline_agronomia.tentativas + 1,
                      sincronizado_em = NOW(),
                      id_servidor = EXCLUDED.id_servidor,
                      erro_ultima_tentativa = NULL,
                      payload_json = EXCLUDED.payload_json
                    """
                ),
                {**params, "id": sync_id},
            )
    else:
        updated = conn.execute(
            text(
                """
                UPDATE trusted.tb_sync_offline_agronomia
                SET status_sync = 'enviado',
                    tentativas = COALESCE(tentativas, 0) + 1,
                    sincronizado_em = NOW(),
                    id_servidor = :id_servidor,
                    erro_ultima_tentativa = NULL,
                    payload_json = CAST(:payload_json AS jsonb),
                    recebido_em_servidor = NOW()
                WHERE id_local = :id_local
                """
            ),
            params,
        )
        if updated.rowcount == 0:
            if id_has_default:
                conn.execute(
                    text(
                        """
                        INSERT INTO trusted.tb_sync_offline_agronomia
                        (id_local, dispositivo_id, usuario, payload_json, status_sync, tentativas, criado_em_local, recebido_em_servidor, sincronizado_em, id_servidor)
                        VALUES (:id_local, :dispositivo_id, :usuario, CAST(:payload_json AS jsonb), 'enviado', 1, :criado_em_local, NOW(), NOW(), :id_servidor)
                        """
                    ),
                    params,
                )
            else:
                sync_id = _sync_next_id(conn)
                conn.execute(
                    text(
                        """
                        INSERT INTO trusted.tb_sync_offline_agronomia
                        (id, id_local, dispositivo_id, usuario, payload_json, status_sync, tentativas, criado_em_local, recebido_em_servidor, sincronizado_em, id_servidor)
                        VALUES (:id, :id_local, :dispositivo_id, :usuario, CAST(:payload_json AS jsonb), 'enviado', 1, :criado_em_local, NOW(), NOW(), :id_servidor)
                        """
                    ),
                    {**params, "id": sync_id},
                )


def upsert_sync_erro(conn, payload: SyncLoteIn, reg: RegistroIn, payload_json: Dict[str, Any], erro: str):
    params = {
        "id_local": reg.id_local,
        "dispositivo_id": payload.dispositivo_id,
        "usuario": payload.usuario,
        "payload_json": json.dumps(payload_json, ensure_ascii=False),
        "erro": erro,
        "criado_em_local": reg.criado_em_local,
    }

    has_unique_id_local = conn.execute(
        text(
            """
            SELECT COUNT(*) > 0
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.table_schema = 'trusted'
              AND tc.table_name = 'tb_sync_offline_agronomia'
              AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
              AND kcu.column_name = 'id_local'
            """
        )
    ).scalar()
    id_has_default = _sync_id_has_default(conn)

    if has_unique_id_local:
        if id_has_default:
            conn.execute(
                text(
                    """
                    INSERT INTO trusted.tb_sync_offline_agronomia
                    (id_local, dispositivo_id, usuario, payload_json, status_sync, tentativas, erro_ultima_tentativa, criado_em_local, recebido_em_servidor)
                    VALUES (:id_local, :dispositivo_id, :usuario, CAST(:payload_json AS jsonb), 'erro', 1, :erro, :criado_em_local, NOW())
                    ON CONFLICT (id_local)
                    DO UPDATE SET
                      status_sync = 'erro',
                      tentativas = trusted.tb_sync_offline_agronomia.tentativas + 1,
                      erro_ultima_tentativa = :erro,
                      payload_json = EXCLUDED.payload_json
                    """
                ),
                params,
            )
        else:
            sync_id = _sync_next_id(conn)
            conn.execute(
                text(
                    """
                    INSERT INTO trusted.tb_sync_offline_agronomia
                    (id, id_local, dispositivo_id, usuario, payload_json, status_sync, tentativas, erro_ultima_tentativa, criado_em_local, recebido_em_servidor)
                    VALUES (:id, :id_local, :dispositivo_id, :usuario, CAST(:payload_json AS jsonb), 'erro', 1, :erro, :criado_em_local, NOW())
                    ON CONFLICT (id_local)
                    DO UPDATE SET
                      status_sync = 'erro',
                      tentativas = trusted.tb_sync_offline_agronomia.tentativas + 1,
                      erro_ultima_tentativa = :erro,
                      payload_json = EXCLUDED.payload_json
                    """
                ),
                {**params, "id": sync_id},
            )
    else:
        updated = conn.execute(
            text(
                """
                UPDATE trusted.tb_sync_offline_agronomia
                SET status_sync = 'erro',
                    tentativas = COALESCE(tentativas, 0) + 1,
                    erro_ultima_tentativa = :erro,
                    payload_json = CAST(:payload_json AS jsonb),
                    recebido_em_servidor = NOW()
                WHERE id_local = :id_local
                """
            ),
            params,
        )
        if updated.rowcount == 0:
            if id_has_default:
                conn.execute(
                    text(
                        """
                        INSERT INTO trusted.tb_sync_offline_agronomia
                        (id_local, dispositivo_id, usuario, payload_json, status_sync, tentativas, erro_ultima_tentativa, criado_em_local, recebido_em_servidor)
                        VALUES (:id_local, :dispositivo_id, :usuario, CAST(:payload_json AS jsonb), 'erro', 1, :erro, :criado_em_local, NOW())
                        """
                    ),
                    params,
                )
            else:
                sync_id = _sync_next_id(conn)
                conn.execute(
                    text(
                        """
                        INSERT INTO trusted.tb_sync_offline_agronomia
                        (id, id_local, dispositivo_id, usuario, payload_json, status_sync, tentativas, erro_ultima_tentativa, criado_em_local, recebido_em_servidor)
                        VALUES (:id, :id_local, :dispositivo_id, :usuario, CAST(:payload_json AS jsonb), 'erro', 1, :erro, :criado_em_local, NOW())
                        """
                    ),
                    {**params, "id": sync_id},
                )


def inserir_analise(conn, dados: AnaliseDados) -> int:
    amostras = dados.amostras or []
    materia_seca_vals = [a.materia_seca for a in amostras if a.materia_seca is not None]
    materia_seca_media = (sum(materia_seca_vals) / len(materia_seca_vals)) if materia_seca_vals else None

    inserted = conn.execute(
        text(
            """
            INSERT INTO trusted.tb_analise_detalhada_agronomia
            (fornecedor_id, numero_frutos_analisados, defeitos_leves, defeitos_criticos, materia_seca, peso_pu, data_analise)
            VALUES (:fornecedor_id, :numero_frutos_analisados, :defeitos_leves, :defeitos_criticos, :materia_seca, :peso_pu, COALESCE(:data_analise, CURRENT_DATE))
            RETURNING id
            """
        ),
        {
            "fornecedor_id": dados.fornecedor_id,
            "numero_frutos_analisados": dados.numero_frutos_analisados,
            "defeitos_leves": dados.defeitos_leves,
            "defeitos_criticos": dados.defeitos_criticos,
            "materia_seca": materia_seca_media,
            "peso_pu": dados.peso_pu,
            "data_analise": dados.data_analise,
        },
    ).scalar()
    return int(inserted)


def inserir_inspecao(conn, dados: InspecaoDados) -> int:
    inserted = conn.execute(
        text(
            """
            INSERT INTO trusted.tb_inspecao_talhao_agronomia
            (fornecedor_id, talhao, estagio_fenologico, data_inspecao, pragas, doencas, irrigacao_escala, adubacao_escala, clima, acao_recomendada, observacoes)
            VALUES (:fornecedor_id, :talhao, :estagio_fenologico, COALESCE(:data_inspecao, CURRENT_DATE), :pragas, :doencas, :irrigacao_escala, :adubacao_escala, :clima, :acao_recomendada, :observacoes)
            RETURNING id
            """
        ),
        {
            "fornecedor_id": dados.fornecedor_id,
            "talhao": dados.talhao,
            "estagio_fenologico": dados.estagio_fenologico,
            "data_inspecao": dados.data_inspecao,
            "pragas": dados.pragas,
            "doencas": dados.doencas,
            "irrigacao_escala": dados.irrigacao_escala,
            "adubacao_escala": dados.adubacao_escala,
            "clima": dados.clima,
            "acao_recomendada": dados.acao_recomendada,
            "observacoes": dados.observacoes,
        },
    ).scalar()
    return int(inserted)


def inserir_ocorrencia(conn, dados: OcorrenciaDados) -> int:
    params = {
        "tipo": dados.tipo,
        "severidade": dados.severidade,
        "fornecedor_id": dados.fornecedor_id,
        "talhao": dados.talhao,
        "data_hora": dados.data_hora,
        "coordenadas": dados.coordenadas,
        "descricao": dados.descricao,
    }

    id_has_default = conn.execute(
        text(
            """
            SELECT column_default IS NOT NULL
            FROM information_schema.columns
            WHERE table_schema = 'trusted'
              AND table_name = 'tb_ocorrencia_campo_agronomia'
              AND column_name = 'id'
            """
        )
    ).scalar()

    if id_has_default:
        inserted = conn.execute(
            text(
                """
                INSERT INTO trusted.tb_ocorrencia_campo_agronomia
                (tipo, severidade, fornecedor_id, talhao, data_hora, coordenadas, descricao)
                VALUES (:tipo, :severidade, :fornecedor_id, :talhao, COALESCE(:data_hora, NOW()), :coordenadas, :descricao)
                RETURNING id
                """
            ),
            params,
        ).scalar()
    else:
        conn.execute(text("LOCK TABLE trusted.tb_ocorrencia_campo_agronomia IN SHARE ROW EXCLUSIVE MODE"))
        next_id = conn.execute(
            text("SELECT COALESCE(MAX(id), 0) + 1 FROM trusted.tb_ocorrencia_campo_agronomia")
        ).scalar()
        inserted = conn.execute(
            text(
                """
                INSERT INTO trusted.tb_ocorrencia_campo_agronomia
                (id, tipo, severidade, fornecedor_id, talhao, data_hora, coordenadas, descricao)
                VALUES (:id, :tipo, :severidade, :fornecedor_id, :talhao, COALESCE(:data_hora, NOW()), :coordenadas, :descricao)
                RETURNING id
                """
            ),
            {**params, "id": int(next_id)},
        ).scalar()

    return int(inserted)


def erro_cliente_seguro(exc: Exception) -> str:
    txt = str(exc or "").strip()
    txt_lower = txt.lower()

    if "id_local_invalido" in txt_lower or "invalid input syntax for type uuid" in txt_lower:
        return "id_local_invalido"
    if "validation" in txt_lower or "field required" in txt_lower:
        return "dados_invalidos"
    if "not null" in txt_lower:
        return "dados_obrigatorios_ausentes"
    if "foreign key" in txt_lower:
        return "referencia_invalida"

    return "falha_no_processamento"


@app.get("/health")
def health():
    return {
        "ok": True,
        "tipos_suportados": TIPOS_SUPORTADOS,
        "auth_api_key_habilitada": _is_api_key_enabled(),
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/api/agronomia/catalogos/fornecedores")
def catalogo_fornecedores(
    termo: Optional[str] = Query(default=None, min_length=1),
    limite: int = Query(default=1000, ge=1, le=5000),
    debug: bool = Query(default=False),
    _auth=Depends(require_sync_api_key),
):
    like = f"%{termo}%" if termo else ""
    aplicar_filtro = bool(termo)
    erros_debug: List[str] = []
    meta_debug: Dict[str, Any] = {}

    tabelas_catalogo = [
        "trusted.fornecedores_agronomia",
        "public.fornecedores_agronomia",
        "trusted.tb_fornecedores_agronomia",
        "public.tb_fornecedores_agronomia",
    ]

    def _nome_tabela_seguro(nome: str) -> bool:
        return bool(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*", nome))

    def _colunas_da_tabela(conn, tabela: str) -> set:
        if not _nome_tabela_seguro(tabela):
            return set()
        schema, nome = tabela.split(".", 1)
        rows = conn.execute(
            text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = :schema
                  AND table_name = :nome
                """
            ),
            {"schema": schema, "nome": nome},
        ).fetchall()
        return {r[0] for r in rows}

    def _consultar_tabela(conn, tabela: str, colunas: Optional[set] = None):
        if not _nome_tabela_seguro(tabela):
            return None

        def _executar(col_id: str, col_nome: str, col_cnpj: Optional[str], col_cidade: Optional[str], col_uf: Optional[str]):
            select_campos = [f"{col_id} AS id", f"{col_nome} AS nome"]
            for campo in ("cnpj", "cidade", "uf"):
                if campo == "cnpj" and col_cnpj:
                    select_campos.append(f"{col_cnpj}::text AS cnpj")
                elif campo == "cidade" and col_cidade:
                    select_campos.append(f"{col_cidade}::text AS cidade")
                elif campo == "uf" and col_uf:
                    select_campos.append(f"{col_uf}::text AS uf")
                else:
                    select_campos.append(f"NULL::text AS {campo}")

            rows = conn.execute(
                text(
                    f"""
                    SELECT {", ".join(select_campos)}
                    FROM {tabela}
                    WHERE (:aplicar_filtro = FALSE OR {col_nome} ILIKE :like OR COALESCE({col_cnpj if col_cnpj else "NULL"}::text, '') ILIKE :like)
                    ORDER BY nome
                    LIMIT :limite
                    """
                ),
                {"like": like, "limite": limite, "aplicar_filtro": aplicar_filtro},
            ).mappings().all()
            return {"registros": [dict(r) for r in rows], "total": len(rows)}

        colunas = colunas or set()
        col_id = next((c for c in ("id", "id_fornecedor", "fornecedor_id") if c in colunas), None)
        col_nome = next((c for c in ("nome", "nome_fornecedor", "fornecedor", "razao_social") if c in colunas), None)
        col_cnpj = next((c for c in ("cnpj", "cpf_cnpj") if c in colunas), None)
        col_cidade = next((c for c in ("cidade", "municipio") if c in colunas), None)
        col_uf = next((c for c in ("uf", "estado") if c in colunas), None)

        if col_id and col_nome:
            return _executar(col_id, col_nome, col_cnpj, col_cidade, col_uf)

        # Fallback: tenta o layout padrao mesmo sem metadados visiveis.
        return _executar("id", "nome", "cnpj", "cidade", "uf")

    try:
        with get_engine().begin() as conn:
            if debug:
                info = conn.execute(text("SELECT current_database(), current_user, current_schema()")).fetchone()
                meta_debug = {
                    "database": info[0] if info else None,
                    "user": info[1] if info else None,
                    "schema": info[2] if info else None,
                }

            for tabela in tabelas_catalogo:
                try:
                    out = _consultar_tabela(conn, tabela, _colunas_da_tabela(conn, tabela))
                    if out is not None:
                        if debug:
                            out["fonte"] = tabela
                            out["debug"] = {"meta": meta_debug, "erros": erros_debug}
                        return out
                except Exception as exc:
                    if debug:
                        erros_debug.append(f"{tabela}: {str(exc)[:180]}")
                    continue

            candidatos = conn.execute(
                text(
                    """
                    SELECT table_schema, table_name, array_agg(column_name) AS cols
                    FROM information_schema.columns
                    WHERE table_schema IN ('trusted', 'public')
                      AND table_name ILIKE '%fornecedor%'
                    GROUP BY table_schema, table_name
                    ORDER BY CASE WHEN table_schema = 'trusted' THEN 0 ELSE 1 END, table_name
                    """
                )
            ).mappings().all()

            for cand in candidatos:
                cols = set(cand["cols"] or [])
                if "id" not in cols or "nome" not in cols:
                    continue
                tabela = f"{cand['table_schema']}.{cand['table_name']}"
                try:
                    out = _consultar_tabela(conn, tabela, cols)
                    if out is not None:
                        if debug:
                            out["fonte"] = tabela
                            out["debug"] = {"meta": meta_debug, "erros": erros_debug}
                        return out
                except Exception as exc:
                    if debug:
                        erros_debug.append(f"{tabela}: {str(exc)[:180]}")
                    continue
    except Exception as exc:
        if debug:
            return {
                "registros": [],
                "total": 0,
                "aviso": "catalogo_indisponivel",
                "debug": {"meta": meta_debug, "erros": erros_debug + [str(exc)]},
            }
        return {"registros": [], "total": 0, "aviso": "catalogo_indisponivel"}

    if debug:
        return {
            "registros": [],
            "total": 0,
            "aviso": "catalogo_indisponivel",
            "debug": {"meta": meta_debug, "erros": erros_debug},
        }
    return {"registros": [], "total": 0, "aviso": "catalogo_indisponivel"}


@app.post("/api/agronomia/sync/lote")
def sync_lote(payload: SyncLoteIn, _auth=Depends(require_sync_api_key)):
    if not payload.registros:
        return {"resultados": [], "total": 0}

    resultados = []

    try:
        with get_engine().begin() as conn:
            for reg in payload.registros:
                payload_json = {
                    "id_local": reg.id_local,
                    "tipo_registro": reg.tipo_registro,
                    "criado_em_local": reg.criado_em_local.isoformat() if reg.criado_em_local else None,
                    "dados": reg.dados,
                }

                try:
                    try:
                        UUID(str(reg.id_local))
                    except Exception as exc:
                        raise ValueError("id_local_invalido") from exc

                    existe = conn.execute(
                        text(
                            """
                            SELECT id_servidor, status_sync
                            FROM trusted.tb_sync_offline_agronomia
                            WHERE id_local = :id_local
                            LIMIT 1
                            """
                        ),
                        {"id_local": reg.id_local},
                    ).fetchone()

                    if existe and existe[1] == "enviado":
                        resultados.append(
                            {
                                "id_local": reg.id_local,
                                "status": "enviado",
                                "id_servidor": existe[0],
                            }
                        )
                        continue

                    dados_validos = validar_registro(reg.tipo_registro, reg.dados)

                    id_servidor: Optional[int] = None
                    if reg.tipo_registro == TIPO_ANALISE:
                        id_servidor = inserir_analise(conn, dados_validos)
                    elif reg.tipo_registro == TIPO_INSPECAO:
                        id_servidor = inserir_inspecao(conn, dados_validos)
                    elif reg.tipo_registro == TIPO_OCORRENCIA:
                        id_servidor = inserir_ocorrencia(conn, dados_validos)

                    upsert_sync_sucesso(conn, payload, reg, payload_json, id_servidor)

                    resultados.append(
                        {
                            "id_local": reg.id_local,
                            "tipo_registro": reg.tipo_registro,
                            "status": "enviado",
                            "id_servidor": id_servidor,
                        }
                    )

                except Exception as exc:
                    erro_completo = str(exc)
                    try:
                        upsert_sync_erro(conn, payload, reg, payload_json, erro_completo)
                    except Exception:
                        # Se a trilha de erro falhar, ainda devolvemos erro por registro.
                        pass
                    resultados.append(
                        {
                            "id_local": reg.id_local,
                            "tipo_registro": reg.tipo_registro,
                            "status": "erro",
                            "mensagem_erro": erro_cliente_seguro(exc),
                        }
                    )
    except Exception as exc:
        return {
            "resultados": [
                {
                    "id_local": reg.id_local,
                    "tipo_registro": reg.tipo_registro,
                    "status": "erro",
                    "mensagem_erro": "servico_indisponivel",
                }
                for reg in payload.registros
            ],
            "aviso": "banco_indisponivel",
            "detalhe": str(exc),
        }

    return {"resultados": resultados}


if os.path.isdir(PWA_DIR):
    app.mount("/", StaticFiles(directory=PWA_DIR, html=True), name="pwa")
