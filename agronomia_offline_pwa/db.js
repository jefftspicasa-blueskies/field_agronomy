const DB_NAME = "bs_agronomia_offline";
const DB_VERSION = 2;
const STORE_QUEUE = "queue";
const STORE_CATALOGOS = "catalogos";

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const queue = db.createObjectStore(STORE_QUEUE, { keyPath: "id_local" });
        queue.createIndex("status_sync", "status_sync", { unique: false });
        queue.createIndex("tipo_registro", "tipo_registro", { unique: false });
        queue.createIndex("criado_em_local", "criado_em_local", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_CATALOGOS)) {
        db.createObjectStore(STORE_CATALOGOS, { keyPath: "chave" });
      }

      if (db.objectStoreNames.contains("analises_queue")) {
        const oldStore = req.transaction.objectStore("analises_queue");
        const newStore = req.transaction.objectStore(STORE_QUEUE);
        oldStore.getAll().onsuccess = (evt) => {
          const rows = evt.target.result || [];
          for (const row of rows) {
            if (!row.tipo_registro) {
              row.tipo_registro = "analise_campo";
            }
            newStore.put(row);
          }
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putQueueRecord(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readwrite");
    tx.objectStore(STORE_QUEUE).put(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteQueueRecord(idLocal) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readwrite");
    tx.objectStore(STORE_QUEUE).delete(idLocal);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function listQueueRecords() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readonly");
    const req = tx.objectStore(STORE_QUEUE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingQueue(limit = 50) {
  const all = await listQueueRecords();
  return all
    .filter((r) => r.status_sync === "pendente" || r.status_sync === "erro")
    .sort((a, b) => new Date(a.criado_em_local) - new Date(b.criado_em_local))
    .slice(0, limit);
}

export async function clearSentQueue() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readwrite");
    const store = tx.objectStore(STORE_QUEUE);
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = req.result || [];
      for (const row of rows) {
        if (row.status_sync === "enviado") {
          store.delete(row.id_local);
        }
      }
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function setCatalogo(chave, valor) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CATALOGOS, "readwrite");
    tx.objectStore(STORE_CATALOGOS).put({ chave, valor, atualizado_em: new Date().toISOString() });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCatalogo(chave) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CATALOGOS, "readonly");
    const req = tx.objectStore(STORE_CATALOGOS).get(chave);
    req.onsuccess = () => resolve(req.result?.valor || null);
    req.onerror = () => reject(req.error);
  });
}

export async function upsertFornecedoresLocal(registros) {
  const atual = (await getCatalogo("fornecedores")) || [];
  const map = new Map(atual.map((r) => [String(r.id), r]));

  for (const reg of registros || []) {
    if (!reg || reg.id === undefined || reg.id === null) {
      continue;
    }
    map.set(String(reg.id), {
      id: Number(reg.id),
      nome: String(reg.nome || "Sem nome"),
      cnpj: reg.cnpj ? String(reg.cnpj) : "",
      cidade: reg.cidade ? String(reg.cidade) : "",
      uf: reg.uf ? String(reg.uf) : "",
    });
  }

  const merged = [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  await setCatalogo("fornecedores", merged);
  return merged;
}

export async function listFornecedoresLocal() {
  return (await getCatalogo("fornecedores")) || [];
}

export async function deleteFornecedorLocal(id) {
  const atual = (await getCatalogo("fornecedores")) || [];
  const filtrado = atual.filter((r) => Number(r.id) !== Number(id));
  await setCatalogo("fornecedores", filtrado);
  return filtrado;
}
