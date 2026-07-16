import {
  putQueueRecord,
  deleteQueueRecord,
  listQueueRecords,
  getPendingQueue,
  clearSentQueue,
  listFornecedoresLocal,
  upsertFornecedoresLocal,
  deleteFornecedorLocal,
} from "./db.js";

const DEFAULT_API_URL = "/api/agronomia/sync/lote";
const DEFAULT_CATALOGO_URL = "/api/agronomia/catalogos/fornecedores";
const DEFAULT_API_KEY = "";
const TIPO_ANALISE = "analise_campo";
const TIPO_INSPECAO = "inspecao_talhao";
const TIPO_OCORRENCIA = "ocorrencia_campo";

const TOTAL_AMOSTRAS = 30;
const AMOSTRA_DECIMAIS = 3;

const pesoPtFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: AMOSTRA_DECIMAIS,
  maximumFractionDigits: AMOSTRA_DECIMAIS,
});

const coletaForm = document.getElementById("coletaForm");
const inspecaoForm = document.getElementById("inspecaoForm");
const ocorrenciaForm = document.getElementById("ocorrenciaForm");
const fornecedorForm = document.getElementById("fornecedorForm");

const analisesBody = document.getElementById("analisesBody");
const inspecoesBody = document.getElementById("inspecoesBody");
const ocorrenciasBody = document.getElementById("ocorrenciasBody");
const fornecedoresBody = document.getElementById("fornecedoresBody");
const queueBody = document.getElementById("queueBody");

const netStatus = document.getElementById("netStatus");
const lastSync = document.getElementById("lastSync");
const formFeedback = document.getElementById("formFeedback");
const globalFeedback = document.getElementById("globalFeedback");

const apiUrlInput = document.getElementById("apiUrl");
const apiKeyInput = document.getElementById("apiKey");
const saveApiUrlBtn = document.getElementById("saveApiUrl");
const refreshFornecedoresBtn = document.getElementById("refreshFornecedores");
const clearEnviadosBtn = document.getElementById("clearEnviados");
const exportQueueBtn = document.getElementById("exportQueue");
const importQueueFile = document.getElementById("importQueueFile");

const kpiPendentes = document.getElementById("kpiPendentes");
const kpiErros = document.getElementById("kpiErros");
const kpiEnviados = document.getElementById("kpiEnviados");

const amostrasPesosContainer = document.getElementById("amostrasPesos");
const amostrasResumo = document.getElementById("amostrasResumo");
const coletaImagensInput = document.getElementById("coletaImagens");
const imagensResumo = document.getElementById("imagensResumo");

const state = {
  editAnaliseId: null,
  editInspecaoId: null,
  editOcorrenciaId: null,
  editFornecedorId: null,
  editAnaliseImagens: [],
  feedbackTimer: null,
};

function uuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function feedback(msg, isError = false) {
  if (formFeedback) {
    formFeedback.textContent = msg;
    formFeedback.className = `feedback ${isError ? "err" : "ok"}`;
  }

  if (!globalFeedback) return;
  globalFeedback.textContent = msg;
  globalFeedback.className = `global-feedback show ${isError ? "err" : "ok"}`;

  if (state.feedbackTimer) {
    clearTimeout(state.feedbackTimer);
  }
  state.feedbackTimer = setTimeout(() => {
    globalFeedback.className = "global-feedback";
  }, 2600);
}

function toStatusPill(status) {
  const css = `status-pill status-${status || "pendente"}`;
  const labels = {
    pendente: "pending",
    enviado: "sent",
    erro: "error",
  };
  return `<span class="${css}">${escapeHtml(labels[status] || status || "pending")}</span>`;
}

function escapeHtml(value) {
  const text = String(value ?? "");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateText(value, maxLen = 34) {
  const text = String(value ?? "");
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function getApiUrl() {
  return localStorage.getItem("bs_api_url") || DEFAULT_API_URL;
}

function getCatalogoUrl() {
  return localStorage.getItem("bs_catalogo_fornecedores_url") || DEFAULT_CATALOGO_URL;
}

function getApiKey() {
  return localStorage.getItem("bs_api_key") || DEFAULT_API_KEY;
}

function buildCatalogoUrlFromApi(url) {
  const base = String(url || "").trim();
  if (!base) return DEFAULT_CATALOGO_URL;

  if (base.startsWith("/")) {
    return "/api/agronomia/catalogos/fornecedores";
  }

  try {
    const parsed = new URL(base);
    parsed.pathname = "/api/agronomia/catalogos/fornecedores";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return base.replace("/api/agronomia/sync/lote", "/api/agronomia/catalogos/fornecedores");
  }
}

function setApiUrl(url) {
  localStorage.setItem("bs_api_url", url);
  localStorage.setItem("bs_catalogo_fornecedores_url", buildCatalogoUrlFromApi(url));
}

function setApiKey(value) {
  localStorage.setItem("bs_api_key", String(value || "").trim());
}

function buildAuthHeaders() {
  const apiKey = getApiKey();
  if (!apiKey) return {};
  return {
    "X-API-Key": apiKey,
    Authorization: `Bearer ${apiKey}`,
  };
}

function loadApiUrlUi() {
  if (apiUrlInput) apiUrlInput.value = getApiUrl();
  if (apiKeyInput) apiKeyInput.value = getApiKey();
}

function updateNetStatus() {
  if (netStatus) netStatus.textContent = navigator.onLine ? "Online" : "Offline";
}

function updateLastSyncUi() {
  const raw = localStorage.getItem("bs_last_sync");
  if (!lastSync) return;
  if (!raw) {
    lastSync.textContent = "Last sync: -";
    return;
  }
  lastSync.textContent = `Last sync: ${new Date(raw).toLocaleString("en-US")}`;
}

function showView(viewId) {
  const views = [...document.querySelectorAll(".view")];
  for (const v of views) {
    v.classList.toggle("active", v.id === viewId);
  }
}

function setupNavigation() {
  const openers = [...document.querySelectorAll("[data-view]")];
  for (const btn of openers) {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  }

  const backBtns = [...document.querySelectorAll("[data-back-home]")];
  for (const btn of backBtns) {
    btn.addEventListener("click", () => showView("view-home"));
  }
}

function ensureDeviceId() {
  let id = localStorage.getItem("bs_dispositivo_id");
  if (!id) {
    id = `BS-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    localStorage.setItem("bs_dispositivo_id", id);
  }
  for (const input of [...document.querySelectorAll("[data-device-id]")]) {
    input.value = id;
  }
}

function ensureUsuarioPadrao() {
  const saved = localStorage.getItem("bs_usuario") || "field";
  for (const input of [...document.querySelectorAll("[data-usuario]")]) {
    input.value = saved;
    input.addEventListener("change", () => {
      localStorage.setItem("bs_usuario", input.value.trim() || "field");
    });
  }
}

function todayDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nowLocalInputDateTime() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function applyDefaultDates() {
  const dataAnalise = coletaForm?.querySelector("input[name='data_analise']");
  const dataInspecao = inspecaoForm?.querySelector("input[name='data_inspecao']");
  const dataHora = ocorrenciaForm?.querySelector("input[name='data_hora']");
  if (dataAnalise && !dataAnalise.value) dataAnalise.value = todayDate();
  if (dataInspecao && !dataInspecao.value) dataInspecao.value = todayDate();
  if (dataHora && !dataHora.value) dataHora.value = nowLocalInputDateTime();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatPesoMascara(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return pesoPtFormatter.format(0);
  return pesoPtFormatter.format(n);
}

function aplicarMascaraPeso(rawValue) {
  const digits = String(rawValue ?? "").replace(/\D/g, "");
  const scaled = digits ? Number(digits) / (10 ** AMOSTRA_DECIMAIS) : 0;
  return formatPesoMascara(scaled);
}

function parsePesoMascara(value) {
  const normalized = String(value ?? "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function getColetaPesoInput() {
  return coletaForm?.querySelector("input[name='peso_pu']") || null;
}

function getColetaQtdInput() {
  return coletaForm?.querySelector("input[name='numero_frutos_analisados']") || null;
}

function updateImagensResumo() {
  if (!imagensResumo || !coletaImagensInput) return;
  const qtd = coletaImagensInput.files?.length || 0;
  if (qtd) {
    imagensResumo.textContent = `${qtd} image(s) selected.`;
    return;
  }
  if (state.editAnaliseImagens?.length) {
    imagensResumo.textContent = `No new images. Keeping ${state.editAnaliseImagens.length} from the record.`;
    return;
  }
  imagensResumo.textContent = "No images selected.";
}

function renderAmostrasInputs(initialValues = null) {
  if (!amostrasPesosContainer) return;
  amostrasPesosContainer.innerHTML = "";

  const values = Array.isArray(initialValues) && initialValues.length === TOTAL_AMOSTRAS
    ? initialValues
    : Array.from({ length: TOTAL_AMOSTRAS }, () => "");

  for (let i = 1; i <= TOTAL_AMOSTRAS; i += 1) {
    const wrap = document.createElement("div");
    wrap.className = "amostra-item";
    wrap.innerHTML = `
      <span>Sample ${i}</span>
      <input type="text" inputmode="numeric" data-amostra-peso="${i}" placeholder="0.000" required />
    `;
    const input = wrap.querySelector("input");
    const valorInicial = values[i - 1] === "" ? 0 : Number(values[i - 1]);
    input.value = formatPesoMascara(valorInicial);
    input?.addEventListener("input", () => {
      input.value = aplicarMascaraPeso(input.value);
      updateAmostrasResumoAndMedia();
    });
    input?.addEventListener("blur", () => {
      input.value = formatPesoMascara(parsePesoMascara(input.value));
      updateAmostrasResumoAndMedia();
    });
    amostrasPesosContainer.appendChild(wrap);
  }

  updateAmostrasResumoAndMedia();
}

function updateAmostrasResumoAndMedia() {
  if (!amostrasPesosContainer) return;
  const inputs = [...amostrasPesosContainer.querySelectorAll("input[data-amostra-peso]")];
  const values = inputs.map((el) => parsePesoMascara(el.value)).filter((v) => Number.isFinite(v) && v > 0);

  if (amostrasResumo) {
    amostrasResumo.textContent = `${values.length}/${TOTAL_AMOSTRAS} filled`;
  }

  const pesoInput = getColetaPesoInput();
  if (!pesoInput) return;
  if (values.length === TOTAL_AMOSTRAS) {
    pesoInput.value = (values.reduce((acc, v) => acc + v, 0) / TOTAL_AMOSTRAS).toFixed(AMOSTRA_DECIMAIS);
  } else {
    pesoInput.value = "";
  }
}

function coletarAmostrasPesos() {
  if (!amostrasPesosContainer) throw new Error("Samples container not found.");
  const inputs = [...amostrasPesosContainer.querySelectorAll("input[data-amostra-peso]")];
  if (inputs.length !== TOTAL_AMOSTRAS) throw new Error(`Expected ${TOTAL_AMOSTRAS} samples.`);

  return inputs.map((el, idx) => {
    const n = parsePesoMascara(el.value);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`Provide a valid weight for sample ${idx + 1}.`);
    }
    return Number(n.toFixed(AMOSTRA_DECIMAIS));
  });
}

function resizeImageToDataUrl(file, maxWidth = 1280, maxHeight = 1280, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not process image."));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      URL.revokeObjectURL(objectUrl);
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to read image ${file.name}.`));
    };
    img.src = objectUrl;
  });
}

async function coletarImagensColeta(existingImages = []) {
  const files = [...(coletaImagensInput?.files || [])];
  if (!files.length && existingImages.length) return existingImages;
  if (!files.length) return [];

  const out = [];
  for (const file of files) {
    const dataUrl = await resizeImageToDataUrl(file);
    out.push({
      nome: file.name,
      tipo_original: file.type || "image/*",
      tamanho_bytes: file.size,
      data_url: dataUrl,
    });
  }
  return out;
}

function resetColetaExtras() {
  const qtdInput = getColetaQtdInput();
  if (qtdInput) qtdInput.value = String(TOTAL_AMOSTRAS);
  state.editAnaliseImagens = [];
  renderAmostrasInputs();
  if (coletaImagensInput) coletaImagensInput.value = "";
  updateImagensResumo();
}

async function readJsonResponse(res, contextLabel) {
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();
  const body = await res.text();
  if (!res.ok) throw new Error(`${contextLabel}: HTTP ${res.status}`);
  if (!contentType.includes("application/json")) {
    const trecho = body.slice(0, 80).replace(/\s+/g, " ").trim();
    throw new Error(`${contextLabel}: non-JSON response. Snippet: ${trecho}`);
  }
  return JSON.parse(body);
}

async function syncNow() {
  if (!navigator.onLine) return;
  const apiUrl = getApiUrl();
  if (location.protocol === "https:" && apiUrl.startsWith("http://")) {
    feedback("Invalid API URL for HTTPS.", true);
    return;
  }

  const pendentes = await getPendingQueue(100);
  if (!pendentes.length) {
    feedback("No pending records to sync.");
    return;
  }

  const groups = new Map();
  for (const rec of pendentes) {
    const key = `${String(rec.dispositivo_id || "")}|${String(rec.usuario || "")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  }

  let totalErros = 0;
  for (const [, lote] of groups.entries()) {
    const first = lote[0];
    const payload = {
      dispositivo_id: first.dispositivo_id,
      usuario: first.usuario,
      registros: lote.map((r) => ({
        id_local: r.id_local,
        tipo_registro: r.tipo_registro,
        criado_em_local: r.criado_em_local,
        dados: r.payload_json,
      })),
    };

    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "ngrok-skip-browser-warning": "true",
          ...buildAuthHeaders(),
        },
        body: JSON.stringify(payload),
      });
      const json = await readJsonResponse(res, "Sync error");
      const results = json.resultados || [];

      for (const r of lote) {
        const found = results.find((x) => x.id_local === r.id_local);
        if (found?.status === "enviado") {
          r.status_sync = "enviado";
          r.erro = "";
          r.sincronizado_em = new Date().toISOString();
        } else {
          r.status_sync = "erro";
          r.erro = found?.mensagem_erro || "Failed to send";
          totalErros += 1;
        }
        r.tentativas_envio = (r.tentativas_envio || 0) + 1;
        await putQueueRecord(r);
      }
    } catch (err) {
      totalErros += lote.length;
      for (const r of lote) {
        r.status_sync = "erro";
        r.erro = String(err);
        r.tentativas_envio = (r.tentativas_envio || 0) + 1;
        await putQueueRecord(r);
      }
    }
  }

  localStorage.setItem("bs_last_sync", new Date().toISOString());
  updateLastSyncUi();
  if (totalErros) {
    feedback(`Synchronization finished with ${totalErros} error(s).`, true);
  } else {
    feedback("Synchronization finished.");
  }

  await refreshAll();
}

async function upsertOfflineRecord(tipo, form, payload, editId = null) {
  const fd = new FormData(form);
  const old = editId ? (await listQueueRecords()).find((r) => r.id_local === editId) : null;
  const rec = {
    id_local: editId || uuid(),
    tipo_registro: tipo,
    dispositivo_id: String(fd.get("dispositivo_id") || localStorage.getItem("bs_dispositivo_id") || ""),
    usuario: String(fd.get("usuario") || localStorage.getItem("bs_usuario") || "field"),
    criado_em_local: old?.criado_em_local || new Date().toISOString(),
    payload_json: payload,
    status_sync: "pendente",
    tentativas_envio: 0,
    erro: "",
  };
  await putQueueRecord(rec);
  await refreshAll();
  if (navigator.onLine) {
    syncNow().catch(() => {});
  }
}

async function getFornecedorMap() {
  const fornecedores = await listFornecedoresLocal();
  return new Map(fornecedores.map((f) => [Number(f.id), f.nome]));
}

function getSearchValue(id) {
  return String(document.getElementById(id)?.value || "").trim().toLowerCase();
}

async function renderFornecedorSelects() {
  const fornecedores = await listFornecedoresLocal();
  const options = fornecedores.length
    ? fornecedores.map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.id)} - ${escapeHtml(truncateText(f.nome, 30))}</option>`).join("")
    : `<option value="" disabled selected>No local suppliers</option>`;

  for (const select of [...document.querySelectorAll("[data-fornecedor-select]")]) {
    const current = select.value;
    select.innerHTML = options;
    if (current && select.querySelector(`option[value="${current}"]`)) {
      select.value = current;
    }
  }
}

async function renderFornecedoresTable() {
  const fornecedores = await listFornecedoresLocal();
  const query = getSearchValue("fornecedorBusca");
  const rows = fornecedores.filter((f) => {
    if (!query) return true;
    const txt = `${f.id} ${f.nome} ${f.cnpj || ""} ${f.cidade || ""} ${f.uf || ""}`.toLowerCase();
    return txt.includes(query);
  });

  fornecedoresBody.innerHTML = rows.length
    ? rows.map((f) => `
      <tr>
        <td>${escapeHtml(f.id)}</td>
        <td>${escapeHtml(f.nome)}</td>
        <td>${escapeHtml(f.cnpj || "-")}</td>
        <td>${escapeHtml((f.cidade || "-") + (f.uf ? `/${f.uf}` : ""))}</td>
        <td class="actions">
          <button class="ghost" data-ac="edit-fornecedor" data-id="${escapeHtml(f.id)}" type="button">Edit</button>
          <button class="ghost" data-ac="del-fornecedor" data-id="${escapeHtml(f.id)}" type="button">Delete</button>
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="5" class="muted">No suppliers found.</td></tr>`;
}

async function renderHistorico(tipo, bodyEl, searchInputId, formatRow) {
  const all = await listQueueRecords();
  const fornecedores = await getFornecedorMap();
  const query = getSearchValue(searchInputId);

  const rows = all
    .filter((r) => r.tipo_registro === tipo)
    .filter((r) => {
      if (!query) return true;
      const payload = r.payload_json || {};
      const fornecedorNome = fornecedores.get(Number(payload.fornecedor_id)) || "";
      const text = `${r.status_sync || ""} ${fornecedorNome} ${JSON.stringify(payload)}`.toLowerCase();
      return text.includes(query);
    })
    .sort((a, b) => new Date(b.criado_em_local) - new Date(a.criado_em_local));

  bodyEl.innerHTML = rows.length
    ? rows.map((r) => formatRow(r, fornecedores)).join("")
    : `<tr><td colspan="6" class="muted">No history records.</td></tr>`;
}

async function renderAnalisesTable() {
  await renderHistorico(TIPO_ANALISE, analisesBody, "analiseBusca", (r, fornecedores) => {
    const p = r.payload_json || {};
    const fornecedor = fornecedores.get(Number(p.fornecedor_id)) || `ID ${p.fornecedor_id || "-"}`;
    const canEdit = r.status_sync !== "enviado";
    return `
      <tr>
        <td>${escapeHtml(p.data_analise || "-")}</td>
        <td>${escapeHtml(fornecedor)}</td>
        <td class="col-optional">${escapeHtml(p.talhao || "-")}</td>
        <td class="col-optional">${escapeHtml(p.variedade || "-")}</td>
        <td>${toStatusPill(r.status_sync)}</td>
        <td class="actions">
          <button class="ghost" data-ac="edit-analise" data-id="${escapeHtml(r.id_local)}" type="button" ${canEdit ? "" : "disabled"}>Edit</button>
          <button class="ghost" data-ac="del-registro" data-id="${escapeHtml(r.id_local)}" type="button">Delete</button>
        </td>
      </tr>
    `;
  });
}

async function renderInspecoesTable() {
  await renderHistorico(TIPO_INSPECAO, inspecoesBody, "inspecaoBusca", (r, fornecedores) => {
    const p = r.payload_json || {};
    const fornecedor = fornecedores.get(Number(p.fornecedor_id)) || `ID ${p.fornecedor_id || "-"}`;
    const canEdit = r.status_sync !== "enviado";
    return `
      <tr>
        <td>${escapeHtml(p.data_inspecao || "-")}</td>
        <td>${escapeHtml(fornecedor)}</td>
        <td>${escapeHtml(p.talhao || "-")}</td>
        <td>${escapeHtml(p.estagio_fenologico || "-")}</td>
        <td>${toStatusPill(r.status_sync)}</td>
        <td class="actions">
          <button class="ghost" data-ac="edit-inspecao" data-id="${escapeHtml(r.id_local)}" type="button" ${canEdit ? "" : "disabled"}>Edit</button>
          <button class="ghost" data-ac="del-registro" data-id="${escapeHtml(r.id_local)}" type="button">Delete</button>
        </td>
      </tr>
    `;
  });
}

async function renderOcorrenciasTable() {
  await renderHistorico(TIPO_OCORRENCIA, ocorrenciasBody, "ocorrenciaBusca", (r, fornecedores) => {
    const p = r.payload_json || {};
    const fornecedor = fornecedores.get(Number(p.fornecedor_id)) || `ID ${p.fornecedor_id || "-"}`;
    const canEdit = r.status_sync !== "enviado";
    return `
      <tr>
        <td>${escapeHtml((p.data_hora || "-").replace("T", " "))}</td>
        <td>${escapeHtml(p.tipo || "-")}</td>
        <td>${escapeHtml(p.severidade || "-")}</td>
        <td>${escapeHtml(fornecedor)}</td>
        <td>${toStatusPill(r.status_sync)}</td>
        <td class="actions">
          <button class="ghost" data-ac="edit-ocorrencia" data-id="${escapeHtml(r.id_local)}" type="button" ${canEdit ? "" : "disabled"}>Edit</button>
          <button class="ghost" data-ac="del-registro" data-id="${escapeHtml(r.id_local)}" type="button">Delete</button>
        </td>
      </tr>
    `;
  });
}

async function renderQueueTable() {
  const all = await listQueueRecords();
  const pend = all.filter((r) => r.status_sync === "pendente").length;
  const err = all.filter((r) => r.status_sync === "erro").length;
  const env = all.filter((r) => r.status_sync === "enviado").length;
  kpiPendentes.textContent = `Pending: ${pend}`;
  kpiErros.textContent = `Errors: ${err}`;
  kpiEnviados.textContent = `Sent: ${env}`;

  queueBody.innerHTML = all.length
    ? all
      .sort((a, b) => new Date(b.criado_em_local) - new Date(a.criado_em_local))
      .map((r) => `
        <tr>
          <td>${escapeHtml((r.id_local || "").slice(0, 8))}</td>
          <td>${escapeHtml(r.tipo_registro)}</td>
          <td>${toStatusPill(r.status_sync)}</td>
          <td>${escapeHtml(r.tentativas_envio || 0)}</td>
          <td>${escapeHtml(r.erro || "-")}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="5" class="muted">Queue is empty.</td></tr>`;
}

async function refreshAll() {
  await renderFornecedorSelects();
  await renderFornecedoresTable();
  await renderAnalisesTable();
  await renderInspecoesTable();
  await renderOcorrenciasTable();
  await renderQueueTable();
}

async function fetchFornecedoresApi() {
  const url = getCatalogoUrl();
  if (!navigator.onLine) {
    feedback("No internet to refresh catalog.", true);
    return;
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "ngrok-skip-browser-warning": "true",
        ...buildAuthHeaders(),
      },
    });
    const json = await readJsonResponse(res, "Catalog refresh error");
    const rows = json.registros || [];
    await upsertFornecedoresLocal(rows);
    await refreshAll();
    feedback(`Catalog refreshed: ${rows.length} suppliers.`);
  } catch (err) {
    feedback(`Failed to refresh catalog: ${String(err)}`, true);
  }
}

function fillAnaliseForm(rec) {
  const p = rec.payload_json || {};
  state.editAnaliseId = rec.id_local;
  state.editAnaliseImagens = p.imagens_coleta || [];
  document.getElementById("analiseFormTitle").textContent = `Edit analysis ${rec.id_local.slice(0, 8)}`;
  coletaForm.querySelector("select[name='fornecedor_id']").value = String(p.fornecedor_id || "");
  coletaForm.querySelector("input[name='talhao']").value = p.talhao || "";
  coletaForm.querySelector("input[name='variedade']").value = p.variedade || "";
  coletaForm.querySelector("input[name='data_analise']").value = p.data_analise || todayDate();
  coletaForm.querySelector("input[name='maturacao']").value = p.maturacao ?? "";
  coletaForm.querySelector("input[name='materia_seca']").value = p.materia_seca ?? "";
  coletaForm.querySelector("input[name='brix']").value = p.brix ?? "";
  coletaForm.querySelector("input[name='ph']").value = p.ph ?? "";
  coletaForm.querySelector("input[name='defeitos_leves']").value = p.defeitos_leves ?? 0;
  coletaForm.querySelector("input[name='defeitos_criticos']").value = p.defeitos_criticos ?? 0;
  coletaForm.querySelector("textarea[name='observacoes']").value = p.observacoes || "";
  renderAmostrasInputs(p.amostras_pesos_gramas || null);
  updateImagensResumo();
  showView("view-analise-form");
}

function fillInspecaoForm(rec) {
  const p = rec.payload_json || {};
  state.editInspecaoId = rec.id_local;
  document.getElementById("inspecaoFormTitle").textContent = `Edit inspection ${rec.id_local.slice(0, 8)}`;
  inspecaoForm.querySelector("select[name='fornecedor_id']").value = String(p.fornecedor_id || "");
  inspecaoForm.querySelector("input[name='talhao']").value = p.talhao || "";
  inspecaoForm.querySelector("input[name='estagio_fenologico']").value = p.estagio_fenologico || "";
  inspecaoForm.querySelector("input[name='data_inspecao']").value = p.data_inspecao || todayDate();
  inspecaoForm.querySelector("input[name='pragas']").value = p.pragas || "";
  inspecaoForm.querySelector("input[name='doencas']").value = p.doencas || "";
  inspecaoForm.querySelector("input[name='irrigacao_escala']").value = p.irrigacao_escala ?? 0;
  inspecaoForm.querySelector("input[name='adubacao_escala']").value = p.adubacao_escala ?? 0;
  inspecaoForm.querySelector("select[name='clima']").value = p.clima || "Sunny";
  inspecaoForm.querySelector("input[name='acao_recomendada']").value = p.acao_recomendada || "";
  inspecaoForm.querySelector("textarea[name='observacoes']").value = p.observacoes || "";
  showView("view-inspecao-form");
}

function fillOcorrenciaForm(rec) {
  const p = rec.payload_json || {};
  state.editOcorrenciaId = rec.id_local;
  document.getElementById("ocorrenciaFormTitle").textContent = `Edit occurrence ${rec.id_local.slice(0, 8)}`;
  ocorrenciaForm.querySelector("select[name='tipo']").value = p.tipo || "Other";
  ocorrenciaForm.querySelector("select[name='severidade']").value = p.severidade || "Low";
  ocorrenciaForm.querySelector("select[name='fornecedor_id']").value = String(p.fornecedor_id || "");
  ocorrenciaForm.querySelector("input[name='talhao']").value = p.talhao || "";
  ocorrenciaForm.querySelector("input[name='data_hora']").value = (p.data_hora || nowLocalInputDateTime()).slice(0, 16);
  ocorrenciaForm.querySelector("input[name='coordenadas']").value = p.coordenadas || "";
  ocorrenciaForm.querySelector("textarea[name='descricao']").value = p.descricao || "";
  showView("view-ocorrencia-form");
}

function resetAnaliseForm() {
  state.editAnaliseId = null;
  state.editAnaliseImagens = [];
  document.getElementById("analiseFormTitle").textContent = "New analysis";
  coletaForm.reset();
  ensureDeviceId();
  ensureUsuarioPadrao();
  applyDefaultDates();
  resetColetaExtras();
}

function resetInspecaoForm() {
  state.editInspecaoId = null;
  document.getElementById("inspecaoFormTitle").textContent = "New inspection";
  inspecaoForm.reset();
  ensureDeviceId();
  ensureUsuarioPadrao();
  applyDefaultDates();
}

function resetOcorrenciaForm() {
  state.editOcorrenciaId = null;
  document.getElementById("ocorrenciaFormTitle").textContent = "New occurrence";
  ocorrenciaForm.reset();
  ensureDeviceId();
  ensureUsuarioPadrao();
  applyDefaultDates();
}

async function setupActions() {
  document.getElementById("fornecedorNovo")?.addEventListener("click", () => {
    state.editFornecedorId = null;
    document.getElementById("fornecedorFormTitle").textContent = "Create supplier";
    fornecedorForm.reset();
    showView("view-fornecedor-form");
  });

  document.getElementById("fornecedorVoltarLista")?.addEventListener("click", () => {
    state.editFornecedorId = null;
    fornecedorForm.reset();
    document.getElementById("fornecedorFormTitle").textContent = "Create supplier";
    showView("view-fornecedores");
  });

  document.getElementById("analiseNovo")?.addEventListener("click", () => {
    resetAnaliseForm();
    showView("view-analise-form");
  });

  document.getElementById("analiseVoltarLista")?.addEventListener("click", () => {
    resetAnaliseForm();
    showView("view-analises");
  });

  document.getElementById("inspecaoNovo")?.addEventListener("click", () => {
    resetInspecaoForm();
    showView("view-inspecao-form");
  });

  document.getElementById("inspecaoVoltarLista")?.addEventListener("click", () => {
    resetInspecaoForm();
    showView("view-inspecoes");
  });

  document.getElementById("ocorrenciaNovo")?.addEventListener("click", () => {
    resetOcorrenciaForm();
    showView("view-ocorrencia-form");
  });

  document.getElementById("ocorrenciaVoltarLista")?.addEventListener("click", () => {
    resetOcorrenciaForm();
    showView("view-ocorrencias");
  });

  document.getElementById("analiseCancelar")?.addEventListener("click", () => {
    resetAnaliseForm();
    showView("view-analises");
  });

  document.getElementById("inspecaoCancelar")?.addEventListener("click", () => {
    resetInspecaoForm();
    showView("view-inspecoes");
  });

  document.getElementById("ocorrenciaCancelar")?.addEventListener("click", () => {
    resetOcorrenciaForm();
    showView("view-ocorrencias");
  });
  document.getElementById("fornecedorCancelar")?.addEventListener("click", () => {
    state.editFornecedorId = null;
    fornecedorForm.reset();
    document.getElementById("fornecedorFormTitle").textContent = "Create supplier";
    showView("view-fornecedores");
  });

  refreshFornecedoresBtn?.addEventListener("click", fetchFornecedoresApi);
  document.getElementById("syncNow")?.addEventListener("click", syncNow);

  saveApiUrlBtn?.addEventListener("click", () => {
    const url = String(apiUrlInput?.value || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      feedback("Enter a valid URL with http:// or https://", true);
      return;
    }
    setApiUrl(url);
    setApiKey(String(apiKeyInput?.value || "").trim());
    feedback("API URL and token saved.");
  });

  clearEnviadosBtn?.addEventListener("click", async () => {
    await clearSentQueue();
    await refreshAll();
    feedback("Sent records removed from queue.");
  });

  exportQueueBtn?.addEventListener("click", async () => {
    const rows = await listQueueRecords();
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `offline_queue_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  importQueueFile?.addEventListener("change", async () => {
    const file = importQueueFile.files?.[0];
    if (!file) return;
    try {
      const rows = JSON.parse(await file.text());
      let count = 0;
      for (const row of rows || []) {
        if (row?.id_local && row?.payload_json) {
          await putQueueRecord(row);
          count += 1;
        }
      }
      await refreshAll();
      feedback(`Import complete. ${count} records added.`);
    } catch (err) {
      feedback(`Import failed: ${String(err)}`, true);
    } finally {
      importQueueFile.value = "";
    }
  });

  const searchIds = ["fornecedorBusca", "analiseBusca", "inspecaoBusca", "ocorrenciaBusca"];
  for (const id of searchIds) {
    document.getElementById(id)?.addEventListener("input", refreshAll);
  }

  fornecedoresBody?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-ac]");
    if (!btn) return;
    const ac = btn.dataset.ac;
    const id = Number(btn.dataset.id);

    if (ac === "edit-fornecedor") {
      const rows = await listFornecedoresLocal();
      const f = rows.find((r) => Number(r.id) === id);
      if (!f) return;
      state.editFornecedorId = id;
      document.getElementById("fornecedorFormTitle").textContent = `Edit supplier ${id}`;
      document.getElementById("fornecedorId").value = String(f.id || "");
      document.getElementById("fornecedorNome").value = f.nome || "";
      document.getElementById("fornecedorCnpj").value = f.cnpj || "";
      document.getElementById("fornecedorCidade").value = f.cidade || "";
      document.getElementById("fornecedorUf").value = f.uf || "";
      showView("view-fornecedor-form");
      return;
    }

    if (ac === "del-fornecedor") {
      if (!confirm(`Delete supplier ${id}?`)) return;
      await deleteFornecedorLocal(id);
      await refreshAll();
      feedback("Supplier deleted locally.");
    }
  });

  const handleRegistroActions = async (e) => {
    const btn = e.target.closest("button[data-ac]");
    if (!btn) return;
    const ac = btn.dataset.ac;
    const id = btn.dataset.id;
    const rows = await listQueueRecords();
    const rec = rows.find((r) => r.id_local === id);
    if (!rec) return;

    if (ac === "del-registro") {
      if (!confirm("Delete this local record?")) return;
      await deleteQueueRecord(id);
      await refreshAll();
      feedback("Record deleted locally.");
      return;
    }

    if (ac === "edit-analise") fillAnaliseForm(rec);
    if (ac === "edit-inspecao") fillInspecaoForm(rec);
    if (ac === "edit-ocorrencia") fillOcorrenciaForm(rec);
  };

  analisesBody?.addEventListener("click", handleRegistroActions);
  inspecoesBody?.addEventListener("click", handleRegistroActions);
  ocorrenciasBody?.addEventListener("click", handleRegistroActions);

  fornecedorForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fornecedor = {
      id: Number(document.getElementById("fornecedorId")?.value || 0),
      nome: String(document.getElementById("fornecedorNome")?.value || "").trim(),
      cnpj: String(document.getElementById("fornecedorCnpj")?.value || "").trim(),
      cidade: String(document.getElementById("fornecedorCidade")?.value || "").trim(),
      uf: String(document.getElementById("fornecedorUf")?.value || "").trim(),
    };

    if (!fornecedor.id || !fornecedor.nome) {
      feedback("Supplier requires ID and name.", true);
      return;
    }

    await upsertFornecedoresLocal([fornecedor]);
    state.editFornecedorId = null;
    fornecedorForm.reset();
    document.getElementById("fornecedorFormTitle").textContent = "Create supplier";
    await refreshAll();
    feedback("Supplier saved locally.");
    showView("view-fornecedores");
  });

  coletaForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(coletaForm);
      const amostrasPesos = coletarAmostrasPesos();
      const imagensColeta = await coletarImagensColeta(state.editAnaliseImagens);
      const pesoMedio = amostrasPesos.reduce((acc, v) => acc + v, 0) / TOTAL_AMOSTRAS;

      const payload = {
        fornecedor_id: Number(fd.get("fornecedor_id")),
        talhao: String(fd.get("talhao") || ""),
        variedade: String(fd.get("variedade") || ""),
        data_analise: String(fd.get("data_analise") || todayDate()),
        maturacao: numberOrNull(fd.get("maturacao")),
        materia_seca: Number(fd.get("materia_seca")),
        brix: numberOrNull(fd.get("brix")),
        ph: numberOrNull(fd.get("ph")),
        peso_pu: Number(pesoMedio.toFixed(4)),
        numero_frutos_analisados: TOTAL_AMOSTRAS,
        defeitos_leves: Number(fd.get("defeitos_leves") || 0),
        defeitos_criticos: Number(fd.get("defeitos_criticos") || 0),
        observacoes: String(fd.get("observacoes") || ""),
        amostras_pesos_gramas: amostrasPesos,
        amostras_qtd: TOTAL_AMOSTRAS,
        imagens_coleta: imagensColeta,
        imagens_qtd: imagensColeta.length,
      };

      if (!payload.fornecedor_id || !payload.talhao || !payload.variedade) {
        feedback("Fill in the required analysis fields.", true);
        return;
      }

      await upsertOfflineRecord(TIPO_ANALISE, coletaForm, payload, state.editAnaliseId);
      resetAnaliseForm();
      feedback("Analysis saved offline successfully.");
      showView("view-analises");
    } catch (err) {
      feedback(`Failed to save analysis: ${String(err)}`, true);
    }
  });

  inspecaoForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(inspecaoForm);
      const payload = {
        fornecedor_id: Number(fd.get("fornecedor_id")),
        talhao: String(fd.get("talhao") || ""),
        estagio_fenologico: String(fd.get("estagio_fenologico") || ""),
        data_inspecao: String(fd.get("data_inspecao") || todayDate()),
        pragas: String(fd.get("pragas") || ""),
        doencas: String(fd.get("doencas") || ""),
        irrigacao_escala: Number(fd.get("irrigacao_escala") || 0),
        adubacao_escala: Number(fd.get("adubacao_escala") || 0),
        clima: String(fd.get("clima") || ""),
        acao_recomendada: String(fd.get("acao_recomendada") || ""),
        observacoes: String(fd.get("observacoes") || ""),
      };

      if (!payload.fornecedor_id || !payload.talhao || !payload.estagio_fenologico) {
        feedback("Fill in the required inspection fields.", true);
        return;
      }

      await upsertOfflineRecord(TIPO_INSPECAO, inspecaoForm, payload, state.editInspecaoId);
      resetInspecaoForm();
      feedback("Inspection saved offline successfully.");
      showView("view-inspecoes");
    } catch (err) {
      feedback(`Failed to save inspection: ${String(err)}`, true);
    }
  });

  ocorrenciaForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(ocorrenciaForm);
      const payload = {
        tipo: String(fd.get("tipo") || "Other"),
        severidade: String(fd.get("severidade") || "Low"),
        fornecedor_id: Number(fd.get("fornecedor_id")),
        talhao: String(fd.get("talhao") || ""),
        data_hora: String(fd.get("data_hora") || nowLocalInputDateTime()),
        coordenadas: String(fd.get("coordenadas") || ""),
        descricao: String(fd.get("descricao") || ""),
      };

      if (!payload.fornecedor_id || !payload.descricao) {
        feedback("Fill in the required occurrence fields.", true);
        return;
      }

      await upsertOfflineRecord(TIPO_OCORRENCIA, ocorrenciaForm, payload, state.editOcorrenciaId);
      resetOcorrenciaForm();
      feedback("Occurrence saved offline successfully.");
      showView("view-ocorrencias");
    } catch (err) {
      feedback(`Failed to save occurrence: ${String(err)}`, true);
    }
  });

  coletaImagensInput?.addEventListener("change", updateImagensResumo);
}

window.addEventListener("online", async () => {
  updateNetStatus();
  await syncNow();
});

window.addEventListener("offline", updateNetStatus);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

setupNavigation();
updateNetStatus();
updateLastSyncUi();
ensureDeviceId();
ensureUsuarioPadrao();
loadApiUrlUi();
applyDefaultDates();
resetColetaExtras();
await setupActions();
await refreshAll();

if (navigator.onLine) {
  await syncNow();
}
