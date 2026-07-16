from datetime import date, datetime
import json
import os
import sys
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from pydantic import BaseModel, Field, TypeAdapter
from sqlalchemy import text


# Mantem imports e assets relativos a esta pasta de servico.
ROOT_DIR = os.path.dirname(__file__)
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)

load_dotenv(os.path.join(ROOT_DIR, ".env"))

from dal import get_engine


app = FastAPI(title="Blue Skies Offline Sync API", version="2.0.0")
PWA_DIR = os.path.join(ROOT_DIR, "agronomia_offline_pwa")
API_KEY_ENV_VAR = "AGRONOMIA_SYNC_API_KEY"


class AnaliseDados(BaseModel):
    fornecedor_id: int
    talhao: Optional[str] = Field(default=None, max_length=80)
    variedade: Optional[str] = Field(default=None, max_length=80)
    data_analise: Optional[date] = None
    maturacao: Optional[int] = Field(default=None, ge=1, le=5)
    materia_seca: float = Field(ge=0, le=30)
    brix: Optional[float] = Field(default=None, ge=0, le=30)
    ph: Optional[float] = Field(default=None, ge=0, le=14)
    peso_pu: Optional[float] = Field(default=None, ge=0)
    numero_frutos_analisados: int = Field(ge=1)
    defeitos_leves: int = Field(default=0, ge=0)
    defeitos_criticos: int = Field(default=0, ge=0)
    observacoes: Optional[str] = Field(default=None, max_length=1200)


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


def upsert_sync_sucesso(conn, payload: SyncLoteIn, reg: RegistroIn, payload_json: Dict[str, Any], id_servidor: Optional[int]):
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
        {
            "id_local": reg.id_local,
            "dispositivo_id": payload.dispositivo_id,
            "usuario": payload.usuario,
            "payload_json": json.dumps(payload_json, ensure_ascii=False),
            "criado_em_local": reg.criado_em_local,
            "id_servidor": id_servidor,
        },
    )


def upsert_sync_erro(conn, payload: SyncLoteIn, reg: RegistroIn, payload_json: Dict[str, Any], erro: str):
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
        {
            "id_local": reg.id_local,
            "dispositivo_id": payload.dispositivo_id,
            "usuario": payload.usuario,
            "payload_json": json.dumps(payload_json, ensure_ascii=False),
            "erro": erro,
            "criado_em_local": reg.criado_em_local,
        },
    )


def inserir_analise(conn, dados: AnaliseDados) -> int:
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
            "materia_seca": dados.materia_seca,
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
    inserted = conn.execute(
        text(
            """
            INSERT INTO trusted.tb_ocorrencia_campo_agronomia
            (tipo, severidade, fornecedor_id, talhao, data_hora, coordenadas, descricao)
            VALUES (:tipo, :severidade, :fornecedor_id, :talhao, COALESCE(:data_hora, NOW()), :coordenadas, :descricao)
            RETURNING id
            """
        ),
        {
            "tipo": dados.tipo,
            "severidade": dados.severidade,
            "fornecedor_id": dados.fornecedor_id,
            "talhao": dados.talhao,
            "data_hora": dados.data_hora,
            "coordenadas": dados.coordenadas,
            "descricao": dados.descricao,
        },
    ).scalar()
    return int(inserted)


def erro_cliente_seguro(exc: Exception) -> str:
    txt = str(exc or "").strip()
    txt_lower = txt.lower()

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
    _auth=Depends(require_sync_api_key),
):
    like = f"%{termo}%" if termo else None

    with get_engine().begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, nome, cnpj, cidade, uf
                FROM trusted.fornecedores_agronomia
                WHERE (:like IS NULL OR nome ILIKE :like OR cnpj ILIKE :like)
                ORDER BY nome
                LIMIT :limite
                """
            ),
            {"like": like, "limite": limite},
        ).mappings().all()

    return {"registros": [dict(r) for r in rows], "total": len(rows)}


@app.post("/api/agronomia/sync/lote")
def sync_lote(payload: SyncLoteIn, _auth=Depends(require_sync_api_key)):
    resultados = []

    with get_engine().begin() as conn:
        for reg in payload.registros:
            payload_json = {
                "id_local": reg.id_local,
                "tipo_registro": reg.tipo_registro,
                "criado_em_local": reg.criado_em_local.isoformat() if reg.criado_em_local else None,
                "dados": reg.dados,
            }

            try:
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
                upsert_sync_erro(conn, payload, reg, payload_json, erro_completo)
                resultados.append(
                    {
                        "id_local": reg.id_local,
                        "tipo_registro": reg.tipo_registro,
                        "status": "erro",
                        "mensagem_erro": erro_cliente_seguro(exc),
                    }
                )

    return {"resultados": resultados}


if os.path.isdir(PWA_DIR):
    app.mount("/", StaticFiles(directory=PWA_DIR, html=True), name="pwa")
