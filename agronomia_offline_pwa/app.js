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

const AMOSTRAS_POR_PAGINA = 1;
const AMOSTRA_DECIMAIS = 3;
const MATURITY_LEVELS = [
  { key: "maturity_level_1", label: "Level 1", value: 1 },
  { key: "maturity_level_1_5", label: "Level 1.5", value: 1.5 },
  { key: "maturity_level_2", label: "Level 2", value: 2 },
  { key: "maturity_level_2_5", label: "Level 2.5", value: 2.5 },
  { key: "maturity_level_3", label: "Level 3", value: 3 },
  { key: "maturity_level_3_5", label: "Level 3.5", value: 3.5 },
];

const pesoPtFormatter = new Intl.NumberFormat("pt-BR", {
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
const amostrasMeta = document.getElementById("amostrasMeta");
const amostrasProgressBar = document.getElementById("amostrasProgressBar");
const amostrasPrevBtn = document.getElementById("amostrasPrev");
const amostrasNextBtn = document.getElementById("amostrasNext");
const amostrasAddBtn = document.getElementById("amostrasAdd");
const amostrasDelBtn = document.getElementById("amostrasDel");
const coletaImagensInput = document.getElementById("coletaImagens");
const imagensResumo = document.getElementById("imagensResumo");
const analiseDetalheVoltarBtn = document.getElementById("analiseDetalheVoltar");
const analiseDetalheContent = document.getElementById("analiseDetalheContent");

const state = {
  editAnaliseId: null,
  editInspecaoId: null,
  editOcorrenciaId: null,
  editFornecedorId: null,
  editAnaliseImagens: [],
  amostrasItens: [],
  amostrasPaginaAtual: 1,
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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function humanizeSyncError(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Unknown synchronization error";

  const normalized = raw.toLowerCase();
  const byCode = {
    servico_indisponivel: "Service unavailable",
    banco_indisponivel: "Database unavailable",
    catalogo_indisponivel: "Catalog unavailable",
    dados_invalidos: "Invalid data",
    dados_obrigatorios_ausentes: "Missing required data",
    referencia_invalida: "Invalid reference",
    falha_no_processamento: "Processing failure",
    nao_autorizado: "Unauthorized",
    service_unavailable: "Service unavailable",
    database_unavailable: "Database unavailable",
    catalog_unavailable: "Catalog unavailable",
    invalid_data: "Invalid data",
    missing_required_data: "Missing required data",
    invalid_reference: "Invalid reference",
    processing_failure: "Processing failure",
    unauthorized: "Unauthorized",
    invalid_local_id: "Invalid local ID",
  };

  if (byCode[normalized]) return byCode[normalized];
  return raw;
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
  const raw = String(value ?? "").trim();
  if (!raw) return NaN;

  const commaIndex = raw.lastIndexOf(",");
  const dotIndex = raw.lastIndexOf(".");

  let normalized = raw;
  if (commaIndex > dotIndex) {
    // pt-BR style: 1.234,567
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (dotIndex > commaIndex) {
    // en-US style: 1,234.567
    normalized = raw.replace(/,/g, "");
  }

  normalized = normalized.replace(/[^0-9.-]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function getColetaPesoInput() {
  return coletaForm?.querySelector("input[name='peso_pu']") || null;
}

function getColetaQtdInput() {
  return coletaForm?.querySelector("input[name='numero_frutos_analisados']") || null;
}

function getColetaMateriaSecaInput() {
  return coletaForm?.querySelector("input[name='materia_seca']") || null;
}

function getColetaMaturacaoInput() {
  return coletaForm?.querySelector("input[name='maturacao']") || null;
}

function getMaturityLevelInput(levelKey) {
  return coletaForm?.querySelector(`input[name='${levelKey}']`) || null;
}

function collectMaturityLevelsFromInputs() {
  const levels = {};
  let total = 0;
  let weighted = 0;

  for (const level of MATURITY_LEVELS) {
    const input = getMaturityLevelInput(level.key);
    const count = Math.max(0, Number.parseInt(String(input?.value || "0"), 10) || 0);
    levels[level.key] = count;
    total += count;
    weighted += count * level.value;
  }

  return {
    levels,
    total,
    average: total > 0 ? (weighted / total) : 0,
  };
}

function parseMaturityLevelsFromForm() {
  const data = collectMaturityLevelsFromInputs();
  if (data.total <= 0) {
    throw new Error("Fill Ripeness (maturity) levels with the quantity of analyzed fruits.");
  }
  return data;
}

function getMaturityLevelsFromPayload(payload) {
  const candidate = payload?.maturity_levels || payload?.maturacao_niveis || {};
  const levels = {};
  let hasAny = false;

  for (const level of MATURITY_LEVELS) {
    const value = Math.max(0, Number.parseInt(String(candidate[level.key] ?? "0"), 10) || 0);
    levels[level.key] = value;
    if (value > 0) hasAny = true;
  }

  if (!hasAny) {
    const total = Math.max(0, Number.parseInt(String(payload?.numero_frutos_analisados ?? "0"), 10) || 0);
    const maturity = Number(payload?.maturity ?? payload?.maturacao);
    if (total > 0 && Number.isFinite(maturity)) {
      const nearest = MATURITY_LEVELS.reduce((prev, curr) => (
        Math.abs(curr.value - maturity) < Math.abs(prev.value - maturity) ? curr : prev
      ), MATURITY_LEVELS[0]);
      levels[nearest.key] = total;
    }
  }

  return levels;
}

function fillMaturityLevels(levels) {
  for (const level of MATURITY_LEVELS) {
    const input = getMaturityLevelInput(level.key);
    if (!input) continue;
    const value = Math.max(0, Number.parseInt(String(levels?.[level.key] ?? "0"), 10) || 0);
    input.value = String(value);
  }
}

function formatMaturityLevelsSummary(payload) {
  const levels = getMaturityLevelsFromPayload(payload);
  return MATURITY_LEVELS
    .map((level) => `${level.label}: ${levels[level.key] ?? 0}`)
    .join(" | ");
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

function createEmptyAmostraItem() {
  return {
    peso_pu: "",
  };
}

function normalizeAmostrasItens(initialItems = null) {
  if (Array.isArray(initialItems) && initialItems.length > 0) {
    return initialItems.map((item) => ({
      peso_pu: Number.isFinite(Number(item?.peso_pu)) ? Number(item.peso_pu).toFixed(AMOSTRA_DECIMAIS) : "",
    }));
  }
  return [createEmptyAmostraItem()];
}

function ensureAmostrasPaginaLimite() {
  const totalPaginas = Math.max(1, Math.ceil(state.amostrasItens.length / AMOSTRAS_POR_PAGINA));
  state.amostrasPaginaAtual = Math.min(Math.max(state.amostrasPaginaAtual, 1), totalPaginas);
  return totalPaginas;
}

function updateAmostrasResumoAndMedia() {
  const total = state.amostrasItens.length;
  const validas = state.amostrasItens.filter((item) => {
    const peso = Number(item.peso_pu);
    return Number.isFinite(peso) && peso > 0;
  });

  if (amostrasResumo) {
    amostrasResumo.textContent = `Completed: ${validas.length} of ${total}`;
  }

  if (amostrasProgressBar) {
    const percent = total > 0 ? (validas.length / total) * 100 : 0;
    amostrasProgressBar.style.width = `${Math.max(0, Math.min(100, percent)).toFixed(1)}%`;
  }

  const pesoInput = getColetaPesoInput();
  const qtdInput = getColetaQtdInput();
  const maturacaoInput = getColetaMaturacaoInput();
  const maturityData = collectMaturityLevelsFromInputs();

  if (qtdInput) qtdInput.value = String(maturityData.total || 0);
  if (maturacaoInput) {
    maturacaoInput.value = maturityData.total > 0 ? maturityData.average.toFixed(2) : "";
  }

  if (!validas.length) {
    if (pesoInput) pesoInput.value = "";
    return;
  }

  const mediaPeso = validas.reduce((acc, item) => acc + Number(item.peso_pu), 0) / validas.length;

  if (pesoInput) pesoInput.value = mediaPeso.toFixed(4);
}

function renderAmostrasInputs(initialItems = null) {
  if (!amostrasPesosContainer) return;

  if (initialItems !== null) {
    state.amostrasItens = normalizeAmostrasItens(initialItems);
    state.amostrasPaginaAtual = 1;
  }

  if (!state.amostrasItens.length) {
    state.amostrasItens = [createEmptyAmostraItem()];
  }

  const totalPaginas = ensureAmostrasPaginaLimite();
  const inicio = (state.amostrasPaginaAtual - 1) * AMOSTRAS_POR_PAGINA;
  const fim = Math.min(inicio + AMOSTRAS_POR_PAGINA, state.amostrasItens.length);
  const pagina = state.amostrasItens.slice(inicio, fim);

  amostrasPesosContainer.innerHTML = "";

  pagina.forEach((item, idx) => {
    const idxGlobal = inicio + idx;
    const wrap = document.createElement("div");
    wrap.className = "amostra-item";
    wrap.innerHTML = `
      <div class="amostra-title">Item ${idxGlobal + 1}</div>
      <label>
        Weight (Kg)
        <input type="text" inputmode="numeric" data-amostra-peso="${idxGlobal}" placeholder="0,000" required />
      </label>
    `;

    const pesoInput = wrap.querySelector("input[data-amostra-peso]");

    if (pesoInput) {
      pesoInput.value = item.peso_pu ? formatPesoMascara(Number(item.peso_pu)) : "";
      pesoInput.addEventListener("input", () => {
        pesoInput.value = aplicarMascaraPeso(pesoInput.value);
        const parsed = parsePesoMascara(pesoInput.value);
        state.amostrasItens[idxGlobal].peso_pu = Number.isFinite(parsed) ? parsed.toFixed(AMOSTRA_DECIMAIS) : "";
        updateAmostrasResumoAndMedia();
      });
      pesoInput.addEventListener("blur", () => {
        const parsed = parsePesoMascara(pesoInput.value);
        if (Number.isFinite(parsed) && parsed > 0) {
          pesoInput.value = formatPesoMascara(parsed);
          state.amostrasItens[idxGlobal].peso_pu = parsed.toFixed(AMOSTRA_DECIMAIS);
        } else {
          pesoInput.value = "";
          state.amostrasItens[idxGlobal].peso_pu = "";
        }
        updateAmostrasResumoAndMedia();
      });
    }

    amostrasPesosContainer.appendChild(wrap);
  });

  if (amostrasMeta) {
    amostrasMeta.textContent = `Item ${state.amostrasPaginaAtual} of ${totalPaginas}`;
  }
  if (amostrasPrevBtn) amostrasPrevBtn.disabled = state.amostrasPaginaAtual <= 1;
  if (amostrasNextBtn) amostrasNextBtn.disabled = state.amostrasPaginaAtual >= totalPaginas;
  if (amostrasDelBtn) amostrasDelBtn.disabled = state.amostrasItens.length <= 1;

  updateAmostrasResumoAndMedia();
}

function coletarAmostrasItens() {
  if (!state.amostrasItens.length) {
    throw new Error("Add at least one sample item.");
  }

  return state.amostrasItens.map((item, idx) => {
    const peso = Number(item.peso_pu);

    if (!Number.isFinite(peso) || peso <= 0) {
      throw new Error(`Provide a valid weight for item ${idx + 1}.`);
    }

    return {
      peso_pu: Number(peso.toFixed(AMOSTRA_DECIMAIS)),
    };
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
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      out.push({
        nome: file.name,
        tipo_original: file.type || "image/*",
        tamanho_bytes: file.size,
        data_url: dataUrl,
      });
    } catch {
      // Image errors should not block record save.
      continue;
    }
  }
  return out;
}

function resetColetaExtras() {
  const qtdInput = getColetaQtdInput();
  if (qtdInput) qtdInput.value = "0";
  fillMaturityLevels({});
  state.editAnaliseImagens = [];
  state.amostrasItens = [createEmptyAmostraItem()];
  state.amostrasPaginaAtual = 1;
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

  // Backward compatibility: older records may have short id_local values.
  // The backend expects UUID, so migrate local IDs before sending.
  for (const rec of pendentes) {
    if (isUuid(rec.id_local)) continue;
    const oldId = rec.id_local;
    rec.id_local = uuid();
    rec.status_sync = "pendente";
    rec.erro = "";
    await putQueueRecord(rec);
    await deleteQueueRecord(oldId);
  }

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
      const results = json.results || json.resultados || [];
      const backendWarning = humanizeSyncError(json.warning || json.aviso || "");
      const backendDetail = String(json.detail || json.detalhe || "").trim();

      for (const r of lote) {
        const found = results.find((x) => x.id_local === r.id_local);
        if (found?.status === "enviado") {
          r.status_sync = "enviado";
          r.erro = "";
          r.sincronizado_em = new Date().toISOString();
        } else {
          r.status_sync = "erro";
          const baseError = humanizeSyncError(found?.error_message || found?.mensagem_erro || backendWarning || "Failed to send");
          r.erro = backendDetail ? `${baseError}: ${truncateText(backendDetail, 120)}` : baseError;
          totalErros += 1;
        }
        r.tentativas_envio = (r.tentativas_envio || 0) + 1;
        await putQueueRecord(r);
      }
    } catch (err) {
      totalErros += lote.length;
      for (const r of lote) {
        r.status_sync = "erro";
        r.erro = humanizeSyncError(String(err));
        r.tentativas_envio = (r.tentativas_envio || 0) + 1;
        await putQueueRecord(r);
      }
    }
  }

  localStorage.setItem("bs_last_sync", new Date().toISOString());
  updateLastSyncUi();
  if (totalErros) {
    feedback(`Sync finished with ${totalErros} error(s). Records remain saved offline in the queue.`, true);
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
    return `
      <tr>
        <td>${escapeHtml(p.data_analise || "-")}</td>
        <td>${escapeHtml(fornecedor)}</td>
        <td class="col-optional">${escapeHtml(p.talhao || "-")}</td>
        <td class="col-optional">${escapeHtml(p.variedade || "-")}</td>
        <td>${toStatusPill(r.status_sync)}</td>
        <td class="actions">
          <button class="ghost" data-ac="view-analise" data-id="${escapeHtml(r.id_local)}" type="button">View</button>
          <button class="ghost" data-ac="pdf-analise" data-id="${escapeHtml(r.id_local)}" type="button">PDF</button>
          <button class="ghost" data-ac="edit-analise" data-id="${escapeHtml(r.id_local)}" type="button">Edit</button>
          <button class="ghost" data-ac="del-registro" data-id="${escapeHtml(r.id_local)}" type="button">Delete</button>
        </td>
      </tr>
    `;
  });
}

function buildAnaliseReportHtml(rec, fornecedorNome) {
  const p = rec.payload_json || {};

  let itens = Array.isArray(p.amostras_itens) ? p.amostras_itens : [];
  if (!itens.length && Array.isArray(p.amostras_pesos_gramas)) {
    itens = p.amostras_pesos_gramas.map((peso) => ({
      peso_pu: peso,
    }));
  }

  const maturityLevels = formatMaturityLevelsSummary(p);

  const rows = itens.map((item, idx) => {
    const peso = Number(item?.peso_pu);
    return `
      <tr>
        <td>${idx + 1}</td>
        <td>${Number.isFinite(peso) ? peso.toFixed(3) : "-"}</td>
      </tr>
    `;
  }).join("");

  return `
    <!doctype html>
    <html lang="en-US">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Analysis Report</title>
      <style>
        body { font-family: Arial, sans-serif; color: #102133; margin: 24px; }
        h1 { margin: 0 0 12px 0; }
        .meta { margin: 0 0 18px 0; line-height: 1.6; }
        .meta b { display: inline-block; min-width: 180px; }
        table { border-collapse: collapse; width: 100%; margin-top: 12px; }
        th, td { border: 1px solid #cfd8e3; padding: 8px; text-align: left; font-size: 13px; }
        th { background: #eef4fb; }
        .section-title { margin-top: 20px; font-size: 16px; font-weight: 700; }
        .small { color: #4e6478; font-size: 12px; }
        @media print { body { margin: 10mm; } }
      </style>
    </head>
    <body>
      <h1>Analysis Report</h1>
      <p class="small">Local ID: ${escapeHtml(rec.id_local || "-")}</p>
      <div class="meta">
        <div><b>Date:</b> ${escapeHtml(p.data_analise || "-")}</div>
        <div><b>Supplier:</b> ${escapeHtml(fornecedorNome || "-")}</div>
        <div><b>Plot:</b> ${escapeHtml(p.talhao || "-")}</div>
        <div><b>Variety:</b> ${escapeHtml(p.variedade || "-")}</div>
        <div><b>Average Weight (g):</b> ${Number.isFinite(Number(p.peso_pu)) ? Number(p.peso_pu).toFixed(4) : "-"}</div>
        <div><b>Maturity:</b> ${Number.isFinite(Number(p.maturity ?? p.maturacao)) ? Number(p.maturity ?? p.maturacao).toFixed(2) : "-"}</div>
        <div><b>Ripeness (maturity):</b> ${escapeHtml(maturityLevels)}</div>
        <div><b>Dry Matter Avg (%):</b> ${Number.isFinite(Number(p.dry_matter_avg ?? p.materia_seca)) ? Number(p.dry_matter_avg ?? p.materia_seca).toFixed(4) : "-"}</div>
        <div><b>Fruit Count:</b> ${escapeHtml(p.numero_frutos_analisados ?? "-")}</div>
        <div><b>Minor Defects:</b> ${escapeHtml(p.defeitos_leves ?? 0)}</div>
        <div><b>Critical Defects:</b> ${escapeHtml(p.defeitos_criticos ?? 0)}</div>
        <div><b>Notes:</b> ${escapeHtml(p.observacoes || "-")}</div>
      </div>

      <div class="section-title">Collected Samples</div>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Weight (g)</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="2">No sample items found.</td></tr>'}
        </tbody>
      </table>
    </body>
    </html>
  `;
}

function openAnaliseReport(rec, fornecedorNome, autoPrint = false) {
  const html = buildAnaliseReportHtml(rec, fornecedorNome);
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) {
    feedback("Could not open report window. Allow pop-ups for this site.", true);
    return;
  }

  win.document.open();
  win.document.write(html);
  win.document.close();

  if (autoPrint) {
    win.addEventListener("load", () => {
      win.focus();
      win.print();
    });
  }
}

function escapePdfText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\r\n\t]/g, " ");
}

function base64DataUrlToBytes(dataUrl) {
  const raw = String(dataUrl || "");
  const comma = raw.indexOf(",");
  if (comma < 0) return null;
  const base64 = raw.slice(comma + 1);
  try {
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function getJpegDimensions(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    offset += 2;

    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 1 >= bytes.length) break;

    const blockLen = (bytes[offset] << 8) + bytes[offset + 1];
    if (!blockLen || offset + blockLen > bytes.length) break;

    const isSof = (
      marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 ||
      marker === 0xc5 || marker === 0xc6 || marker === 0xc7 || marker === 0xc9 ||
      marker === 0xca || marker === 0xcb || marker === 0xcd || marker === 0xce || marker === 0xcf
    );

    if (isSof && blockLen >= 7) {
      const height = (bytes[offset + 3] << 8) + bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) + bytes[offset + 6];
      if (width > 0 && height > 0) return { width, height };
    }

    offset += blockLen;
  }

  return null;
}

function concatUint8Arrays(parts) {
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function buildAnaliseReportPdfBytes(rec, fornecedorNome) {
  const p = rec.payload_json || {};

  let itens = Array.isArray(p.amostras_itens) ? p.amostras_itens : [];
  if (!itens.length && Array.isArray(p.amostras_pesos_gramas)) {
    itens = p.amostras_pesos_gramas.map((peso) => ({
      peso_pu: peso,
    }));
  }

  const imagens = (Array.isArray(p.imagens_coleta) ? p.imagens_coleta : [])
    .map((img) => ({
      nome: String(img?.nome || "image"),
      data_url: String(img?.data_url || ""),
    }))
    .filter((img) => img.data_url.startsWith("data:image/jpeg") || img.data_url.startsWith("data:image/jpg"))
    .slice(0, 3)
    .map((img) => {
      const bytes = base64DataUrlToBytes(img.data_url);
      const dim = bytes ? getJpegDimensions(bytes) : null;
      if (!bytes || !dim) return null;
      return {
        nome: img.nome,
        bytes,
        width: dim.width,
        height: dim.height,
      };
    })
    .filter(Boolean);

  const content = [];
  const pushText = (fontAlias, size, x, y, value, color = [0.08, 0.12, 0.18]) => {
    const txt = escapePdfText(value).slice(0, 140);
    content.push("BT");
    content.push(`${color[0]} ${color[1]} ${color[2]} rg`);
    content.push(`${fontAlias} ${size} Tf`);
    content.push(`1 0 0 1 ${x} ${y} Tm`);
    content.push(`(${txt}) Tj`);
    content.push("ET");
  };

  // Header band
  content.push("0.09 0.36 0.65 rg");
  content.push("40 785 515 35 re f");
  content.push("1 1 1 rg");
  pushText("/F2", 18, 52, 798, "Analysis Report", [1, 1, 1]);
  pushText("/F1", 10, 400, 798, `ID: ${rec.id_local || "-"}`, [1, 1, 1]);

  // Summary title
  content.push("0.12 0.2 0.3 rg");
  pushText("/F2", 12, 50, 765, "Summary", [0.1, 0.16, 0.24]);

  const summary = [
    ["Date", p.data_analise || "-"],
    ["Supplier", fornecedorNome || "-"],
    ["Plot", p.talhao || "-"],
    ["Variety", p.variedade || "-"],
    ["Average Weight (g)", Number.isFinite(Number(p.peso_pu)) ? Number(p.peso_pu).toFixed(4) : "-"],
    ["Maturity", Number.isFinite(Number(p.maturity ?? p.maturacao)) ? Number(p.maturity ?? p.maturacao).toFixed(2) : "-"],
    ["Ripeness (maturity)", formatMaturityLevelsSummary(p)],
    ["Dry Matter Avg (%)", Number.isFinite(Number(p.dry_matter_avg ?? p.materia_seca)) ? Number(p.dry_matter_avg ?? p.materia_seca).toFixed(4) : "-"],
    ["Fruit Count", String(p.numero_frutos_analisados ?? "-")],
    ["Minor Defects", String(p.defeitos_leves ?? 0)],
    ["Critical Defects", String(p.defeitos_criticos ?? 0)],
  ];

  let y = 748;
  for (const [label, value] of summary) {
    pushText("/F2", 10, 50, y, `${label}:`, [0.1, 0.16, 0.24]);
    pushText("/F1", 10, 210, y, String(value), [0.08, 0.12, 0.18]);
    y -= 16;
  }

  pushText("/F2", 10, 50, y, "Notes:", [0.1, 0.16, 0.24]);
  const notes = String(p.observacoes || "-");
  const notesChunks = notes.match(/.{1,88}/g) || ["-"];
  let notesY = y;
  for (const chunk of notesChunks.slice(0, 2)) {
    pushText("/F1", 10, 210, notesY, chunk, [0.08, 0.12, 0.18]);
    notesY -= 14;
  }

  // Samples section title
  const tableTop = notesY - 22;
  content.push("0.12 0.2 0.3 rg");
  pushText("/F2", 12, 50, tableTop + 8, "Collected Samples", [0.1, 0.16, 0.24]);

  // Table layout
  const x0 = 50;
  const y0 = tableTop - 8;
  const colW = [70, 430];
  const rowH = 18;
  const maxRows = 18;
  const rowsToShow = Math.min(itens.length, maxRows);
  const tableWidth = colW.reduce((a, b) => a + b, 0);
  const totalRows = rowsToShow + 1; // header + data

  // Header background
  content.push("0.9 0.94 0.98 rg");
  content.push(`${x0} ${y0 - rowH} ${tableWidth} ${rowH} re f`);

  // Grid
  content.push("0.75 0.82 0.9 RG");
  content.push("0.7 w");
  for (let r = 0; r <= totalRows; r += 1) {
    const yy = y0 - r * rowH;
    content.push(`${x0} ${yy} m ${x0 + tableWidth} ${yy} l S`);
  }

  let xLine = x0;
  content.push(`${xLine} ${y0} m ${xLine} ${y0 - totalRows * rowH} l S`);
  for (const w of colW) {
    xLine += w;
    content.push(`${xLine} ${y0} m ${xLine} ${y0 - totalRows * rowH} l S`);
  }

  // Header text
  const headers = ["Item", "Weight (g)"];
  let hx = x0 + 6;
  for (let i = 0; i < headers.length; i += 1) {
    pushText("/F2", 10, hx, y0 - 13, headers[i], [0.08, 0.12, 0.18]);
    hx += colW[i];
  }

  // Data rows
  for (let i = 0; i < rowsToShow; i += 1) {
    const item = itens[i] || {};
    const peso = Number(item.peso_pu);
    const rowVals = [
      String(i + 1),
      Number.isFinite(peso) ? peso.toFixed(3) : "-",
    ];

    let cx = x0 + 6;
    const cy = y0 - rowH * (i + 1) - 13;
    for (let c = 0; c < rowVals.length; c += 1) {
      pushText("/F1", 10, cx, cy, rowVals[c], [0.06, 0.08, 0.1]);
      cx += colW[c];
    }
  }

  if (itens.length > maxRows) {
    pushText("/F1", 9, 50, y0 - rowH * (totalRows + 1), `Showing first ${maxRows} of ${itens.length} samples.`, [0.28, 0.32, 0.36]);
  }

  // Images section
  const imageTitleY = y0 - rowH * (totalRows + 2);
  if (imagens.length) {
    pushText("/F2", 12, 50, imageTitleY, "Collected Images", [0.1, 0.16, 0.24]);

    const startY = imageTitleY - 10;
    const boxes = [
      { x: 50, w: 160, h: 100 },
      { x: 220, w: 160, h: 100 },
      { x: 390, w: 160, h: 100 },
    ];

    for (let i = 0; i < imagens.length && i < boxes.length; i += 1) {
      const box = boxes[i];
      const img = imagens[i];
      const ratio = img.width / img.height;
      let drawW = box.w;
      let drawH = drawW / ratio;
      if (drawH > box.h) {
        drawH = box.h;
        drawW = drawH * ratio;
      }

      const x = box.x + (box.w - drawW) / 2;
      const yImg = startY - drawH;

      // frame
      content.push("0.82 0.87 0.93 RG");
      content.push("0.6 w");
      content.push(`${box.x} ${startY - box.h} ${box.w} ${box.h} re S`);

      // image
      content.push("q");
      content.push(`${drawW} 0 0 ${drawH} ${x} ${yImg} cm`);
      content.push(`/Im${i + 1} Do`);
      content.push("Q");

      pushText("/F1", 8, box.x, startY - box.h - 10, `${i + 1}. ${img.nome}`, [0.24, 0.28, 0.32]);
    }
  }

  const contentStream = `${content.join("\n")}\n`;
  const encoder = new TextEncoder();
  const contentBytes = encoder.encode(contentStream);
  const contentLength = contentBytes.length;

  const xObjectsDict = imagens.length
    ? `/XObject << ${imagens.map((_, idx) => `/Im${idx + 1} ${7 + idx} 0 R`).join(" ")} >>`
    : "";

  const obj1 = encoder.encode("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  const obj2 = encoder.encode("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  const obj3 = encoder.encode(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> ${xObjectsDict} >> /Contents 4 0 R >>\nendobj\n`
  );
  const obj4 = concatUint8Arrays([
    encoder.encode(`4 0 obj\n<< /Length ${contentLength} >>\nstream\n`),
    contentBytes,
    encoder.encode("endstream\nendobj\n"),
  ]);
  const obj5 = encoder.encode("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  const obj6 = encoder.encode("6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n");

  const imageObjects = imagens.map((img, idx) =>
    concatUint8Arrays([
      encoder.encode(
        `${7 + idx} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`
      ),
      img.bytes,
      encoder.encode("\nendstream\nendobj\n"),
    ])
  );

  const objects = [obj1, obj2, obj3, obj4, obj5, obj6, ...imageObjects];
  const header = encoder.encode("%PDF-1.4\n");

  const parts = [header];
  const offsets = [0];
  let bytePos = header.length;
  for (const objBytes of objects) {
    offsets.push(bytePos);
    parts.push(objBytes);
    bytePos += objBytes.length;
  }

  const xrefOffset = bytePos;
  const xrefLines = [];
  xrefLines.push(`xref\n0 ${objects.length + 1}\n`);
  xrefLines.push("0000000000 65535 f \n");
  for (let i = 1; i <= objects.length; i += 1) {
    xrefLines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  xrefLines.push("trailer\n");
  xrefLines.push(`<< /Size ${objects.length + 1} /Root 1 0 R >>\n`);
  xrefLines.push("startxref\n");
  xrefLines.push(`${xrefOffset}\n`);
  xrefLines.push("%%EOF");

  parts.push(encoder.encode(xrefLines.join("")));
  return concatUint8Arrays(parts);
}

function downloadAnaliseReport(rec, fornecedorNome) {
  const pdfBytes = buildAnaliseReportPdfBytes(rec, fornecedorNome);
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeId = String(rec?.id_local || "analysis").replace(/[^a-z0-9_-]/gi, "").slice(0, 12);
  const datePart = String(rec?.payload_json?.data_analise || new Date().toISOString().slice(0, 10));
  a.href = url;
  a.download = `analysis_report_${datePart}_${safeId}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function openAnaliseImagePopup(imageSrc, imageAlt = "Collected image") {
  const popup = document.getElementById("analiseImagemPopup");
  const popupImg = document.getElementById("analiseImagemPopupImg");
  if (!popup || !popupImg || !imageSrc) return;

  popupImg.src = imageSrc;
  popupImg.alt = imageAlt;
  popup.classList.add("open");
  popup.setAttribute("aria-hidden", "false");
}

function closeAnaliseImagePopup() {
  const popup = document.getElementById("analiseImagemPopup");
  const popupImg = document.getElementById("analiseImagemPopupImg");
  if (!popup || !popupImg) return;

  popup.classList.remove("open");
  popup.setAttribute("aria-hidden", "true");
  popupImg.src = "";
}

function renderAnaliseDetailView(rec, fornecedorNome) {
  if (!analiseDetalheContent) return;
  const p = rec.payload_json || {};

  let itens = Array.isArray(p.amostras_itens) ? p.amostras_itens : [];
  if (!itens.length && Array.isArray(p.amostras_pesos_gramas)) {
    itens = p.amostras_pesos_gramas.map((peso) => ({
      peso_pu: peso,
    }));
  }

  const maturityLevels = formatMaturityLevelsSummary(p);

  const rows = itens.map((item, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${Number.isFinite(Number(item?.peso_pu)) ? Number(item.peso_pu).toFixed(3) : "-"}</td>
    </tr>
  `).join("");

  const imagens = (Array.isArray(p.imagens_coleta) ? p.imagens_coleta : [])
    .filter((img) => String(img?.data_url || "").startsWith("data:image/"));

  const imagensHtml = imagens.length
    ? `
      <div class="analise-images-block">
        <h4 class="analise-images-title">Collected Images</h4>
        <div class="analise-images-grid">
          ${imagens.map((img, idx) => `
            <figure class="analise-image-card">
              <button type="button" class="analise-image-thumb" data-ac="open-image-popup" aria-label="Expand image ${idx + 1}">
                <img src="${escapeHtml(img.data_url || "")}" alt="Image ${idx + 1}" />
              </button>
              <figcaption>${escapeHtml(img.nome || `Image ${idx + 1}`)}</figcaption>
            </figure>
          `).join("")}
        </div>
      </div>
    `
    : '<div class="muted" style="margin-top:12px;">No images attached.</div>';

  analiseDetalheContent.innerHTML = `
    <div class="ux-card" style="margin-bottom:12px;">
      <div><strong>Date:</strong> ${escapeHtml(p.data_analise || "-")}</div>
      <div><strong>Supplier:</strong> ${escapeHtml(fornecedorNome || "-")}</div>
      <div><strong>Plot:</strong> ${escapeHtml(p.talhao || "-")}</div>
      <div><strong>Variety:</strong> ${escapeHtml(p.variedade || "-")}</div>
      <div><strong>Average Weight (g):</strong> ${Number.isFinite(Number(p.peso_pu)) ? Number(p.peso_pu).toFixed(4) : "-"}</div>
      <div><strong>Maturity:</strong> ${Number.isFinite(Number(p.maturity ?? p.maturacao)) ? Number(p.maturity ?? p.maturacao).toFixed(2) : "-"}</div>
      <div><strong>Ripeness (maturity):</strong> ${escapeHtml(maturityLevels)}</div>
      <div><strong>Dry Matter Avg (%):</strong> ${Number.isFinite(Number(p.dry_matter_avg ?? p.materia_seca)) ? Number(p.dry_matter_avg ?? p.materia_seca).toFixed(4) : "-"}</div>
      <div><strong>Fruit Count:</strong> ${escapeHtml(p.numero_frutos_analisados ?? "-")}</div>
      <div><strong>Minor Defects:</strong> ${escapeHtml(p.defeitos_leves ?? 0)}</div>
      <div><strong>Critical Defects:</strong> ${escapeHtml(p.defeitos_criticos ?? 0)}</div>
      <div><strong>Notes:</strong> ${escapeHtml(p.observacoes || "-")}</div>
    </div>
    <div class="table-wrap">
      <table class="analises-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Weight (g)</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="2" class="muted">No sample items found.</td></tr>'}
        </tbody>
      </table>
    </div>
    ${imagensHtml}
    <div id="analiseImagemPopup" class="analise-image-popup" aria-hidden="true">
      <div class="analise-image-popup-content" role="dialog" aria-modal="true" aria-label="Expanded image preview">
        <button type="button" class="analise-image-popup-close" data-ac="close-image-popup" aria-label="Close image preview">&times;</button>
        <img id="analiseImagemPopupImg" src="" alt="Expanded collected image" />
      </div>
    </div>
  `;

  showView("view-analise-detalhe");
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
    const rows = json.records || json.registros || [];
    await upsertFornecedoresLocal(rows);
    await refreshAll();
    feedback(`Catalog refreshed: ${rows.length} suppliers.`);
  } catch (err) {
    feedback(`Failed to refresh catalog: ${String(err)}`, true);
  }
}

async function upsertFornecedorApi(fornecedor) {
  const url = getCatalogoUrl();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "ngrok-skip-browser-warning": "true",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({ records: [fornecedor] }),
  });
  const json = await readJsonResponse(res, "Supplier save error");
  const saved = Number(json?.saved || 0);
  if (saved < 1) {
    const reason = humanizeSyncError(json?.warning || json?.aviso || "processing_failure");
    throw new Error(reason);
  }
  return json;
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
  coletaForm.querySelector("input[name='maturacao']").value = Number.isFinite(Number(p.maturity ?? p.maturacao)) ? Number(p.maturity ?? p.maturacao).toFixed(2) : "";
  coletaForm.querySelector("input[name='materia_seca']").value = p.dry_matter_avg ?? p.materia_seca ?? "";
  coletaForm.querySelector("input[name='defeitos_leves']").value = p.defeitos_leves ?? 0;
  coletaForm.querySelector("input[name='defeitos_criticos']").value = p.defeitos_criticos ?? 0;
  coletaForm.querySelector("textarea[name='observacoes']").value = p.observacoes || "";
  fillMaturityLevels(getMaturityLevelsFromPayload(p));

  let itens = p.amostras_itens;
  if (!Array.isArray(itens) || !itens.length) {
    const pesos = Array.isArray(p.amostras_pesos_gramas) ? p.amostras_pesos_gramas : [];
    itens = pesos.map((peso) => ({
      peso_pu: peso,
    }));
  }
  renderAmostrasInputs(itens || null);
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

  analiseDetalheVoltarBtn?.addEventListener("click", () => {
    closeAnaliseImagePopup();
    showView("view-analises");
  });

  analiseDetalheContent?.addEventListener("click", (e) => {
    const target = e.target;
    const openBtn = target.closest?.("button[data-ac='open-image-popup']");
    if (openBtn) {
      const img = openBtn.querySelector("img");
      if (img) {
        openAnaliseImagePopup(img.getAttribute("src"), img.getAttribute("alt") || "Collected image");
      }
      return;
    }

    const closeBtn = target.closest?.("button[data-ac='close-image-popup']");
    if (closeBtn) {
      closeAnaliseImagePopup();
      return;
    }

    const popup = target.closest?.("#analiseImagemPopup");
    if (popup && target === popup) {
      closeAnaliseImagePopup();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAnaliseImagePopup();
    }
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

  for (const input of [...document.querySelectorAll("[data-maturity-level]")]) {
    input.addEventListener("input", () => {
      const normalized = Math.max(0, Number.parseInt(String(input.value || "0"), 10) || 0);
      input.value = String(normalized);
      updateAmostrasResumoAndMedia();
    });
  }

  amostrasPrevBtn?.addEventListener("click", () => {
    state.amostrasPaginaAtual = Math.max(1, state.amostrasPaginaAtual - 1);
    renderAmostrasInputs();
  });

  amostrasNextBtn?.addEventListener("click", () => {
    state.amostrasPaginaAtual += 1;
    renderAmostrasInputs();
  });

  amostrasAddBtn?.addEventListener("click", () => {
    state.amostrasItens.push(createEmptyAmostraItem());
    state.amostrasPaginaAtual = Math.ceil(state.amostrasItens.length / AMOSTRAS_POR_PAGINA);
    renderAmostrasInputs();
  });

  amostrasDelBtn?.addEventListener("click", () => {
    if (state.amostrasItens.length <= 1) return;
    state.amostrasItens.pop();
    renderAmostrasInputs();
  });

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

    if (ac === "view-analise") {
      const fornecedores = await getFornecedorMap();
      const nomeFornecedor = fornecedores.get(Number(rec?.payload_json?.fornecedor_id)) || `ID ${rec?.payload_json?.fornecedor_id || "-"}`;
      renderAnaliseDetailView(rec, nomeFornecedor);
      return;
    }

    if (ac === "pdf-analise") {
      const fornecedores = await getFornecedorMap();
      const nomeFornecedor = fornecedores.get(Number(rec?.payload_json?.fornecedor_id)) || `ID ${rec?.payload_json?.fornecedor_id || "-"}`;
      downloadAnaliseReport(rec, nomeFornecedor);
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
    try {
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

      let msg = "Supplier saved locally.";
      if (navigator.onLine) {
        try {
          await upsertFornecedorApi(fornecedor);
          msg = "Supplier saved locally and sent to server.";
        } catch (apiErr) {
          msg = `Supplier saved locally, but failed to send to server: ${String(apiErr)}`;
        }
      }

      state.editFornecedorId = null;
      fornecedorForm.reset();
      document.getElementById("fornecedorFormTitle").textContent = "Create supplier";
      await refreshAll();
      feedback(msg, msg.includes("failed to send"));
      showView("view-fornecedores");
    } catch (err) {
      feedback(`Failed to save supplier: ${String(err)}`, true);
    }
  });

  coletaForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(coletaForm);
      const amostrasItens = coletarAmostrasItens();
      const maturityData = parseMaturityLevelsFromForm();
      const dryMatterAvg = Number(fd.get("materia_seca"));
      const imagensColeta = await coletarImagensColeta(state.editAnaliseImagens);
      const totalItens = amostrasItens.length;
      const pesoMedio = amostrasItens.reduce((acc, v) => acc + v.peso_pu, 0) / totalItens;

      if (!Number.isFinite(dryMatterAvg) || dryMatterAvg < 0 || dryMatterAvg > 30) {
        throw new Error("Provide Dry Matter Avg between 0 and 30.");
      }

      const payload = {
        fornecedor_id: Number(fd.get("fornecedor_id")),
        talhao: String(fd.get("talhao") || ""),
        variedade: String(fd.get("variedade") || ""),
        data_analise: String(fd.get("data_analise") || todayDate()),
        maturity: Number(maturityData.average.toFixed(2)),
        maturacao: Number(maturityData.average.toFixed(2)),
        dry_matter_avg: Number(dryMatterAvg.toFixed(4)),
        materia_seca: Number(dryMatterAvg.toFixed(4)),
        peso_pu: Number(pesoMedio.toFixed(4)),
        numero_frutos_analisados: maturityData.total,
        defeitos_leves: Number(fd.get("defeitos_leves") || 0),
        defeitos_criticos: Number(fd.get("defeitos_criticos") || 0),
        observacoes: String(fd.get("observacoes") || ""),
        maturity_levels: maturityData.levels,
        amostras_itens: amostrasItens,
        amostras_qtd: totalItens,
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
