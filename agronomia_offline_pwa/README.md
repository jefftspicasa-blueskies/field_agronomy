# Agronomia de Campo Offline (PWA)

Este modulo roda em paralelo ao app principal e NAO altera o app.py.

## Escopo do app offline completo

O app agora cobre o fluxo inteiro de campo em modo offline:

1. Coleta agronomica (materia seca, peso, frutas, defeitos, observacoes)
2. Inspecao de talhao (pragas, doencas, irrigacao, adubacao, clima, acao)
3. Ocorrencias de campo (tipo, severidade, descricao, coordenadas)
4. Catalogo local de fornecedores (atualizado da API ou manual)
5. Fila de sincronizacao com exportacao/importacao JSON

Todos os registros sao gravados localmente no IndexedDB e sincronizados depois.

## 1) Rodar API + frontend juntos na porta 8010

O frontend PWA e servido pela propria API, entao basta iniciar um unico processo:

```powershell
cd \\192.168.0.24\blue_skies_app\agronomia_offline_sync_api
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8010
```

Acesse:

1. Desktop: http://localhost:8010/index.html
2. Celular (mesma rede): http://IP_DA_MAQUINA:8010/index.html

Com ngrok free, abra apenas um tunel:

```powershell
ngrok http 8010
```

Use o mesmo dominio HTTPS para instalar o app e sincronizar dados.

Opcional (recomendado em producao): proteger API com token.

```powershell
$env:AGRONOMIA_SYNC_API_KEY="SEU_TOKEN_FORTE_AQUI"
uvicorn main:app --host 0.0.0.0 --port 8010
```

Depois, no app PWA em "Sincronizacao", preencher o campo "Token da API" e salvar.

Endpoints principais:

1. GET /health
2. GET /api/agronomia/catalogos/fornecedores
3. POST /api/agronomia/sync/lote

## 2) Ajustar banco

Execute:

1. [sql/setup_offline_sync_agronomia.sql](../sql/setup_offline_sync_agronomia.sql)

## 3) Fluxo recomendado de uso em campo

1. Abrir app e ir em "Sincronizacao"
2. Configurar URL da API como /api/agronomia/sync/lote (mesma origem)
3. Atualizar catalogo de fornecedores
4. Registrar coletas/inspecoes/ocorrencias no campo
5. No retorno da internet, clicar "Sincronizar agora"

## 4) Observacoes tecnicas

1. A fila offline usa id_local (UUID) para idempotencia.
2. Registros tipo analise_campo geram insercao em trusted.tb_analise_detalhada_agronomia.
3. Registros tipo inspecao_talhao e ocorrencia_campo tambem sao persistidos nas tabelas de dominio:
	trusted.tb_inspecao_talhao_agronomia e trusted.tb_ocorrencia_campo_agronomia.
4. Todos os tipos continuam com trilha em trusted.tb_sync_offline_agronomia para auditoria de sincronizacao.
5. O Service Worker faz cache local dos assets para uso sem internet e nao cacheia /api/*.
6. /health e /api/* continuam na API; /index.html e assets sao servidos pela mesma porta 8010.
