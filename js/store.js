/* 線工房 Web — 作品の保存（IndexedDB `senkobo-web`）。
   works: {id, name, updated, thumb(dataURL), doc(pack した JSON), images({id: ArrayBuffer})}
   iPad の WebKit は Blob の保存に失敗することがあるので ArrayBuffer で持つ（彩工房 Web の教訓）。
*/
'use strict';

const DB_NAME = 'senkobo-web';
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('works')) db.createObjectStore('works', { keyPath: 'id' });
    };
    rq.onsuccess = () => { _db = rq.result; _db.onclose = () => { _db = null; }; resolve(_db); };
    rq.onerror = () => reject(rq.error);
  });
}
async function tx(mode, fn) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const t = db.transaction('works', mode);
        const st = t.objectStore('works');
        let out;
        Promise.resolve(fn(st)).then((v) => { out = v; });
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    } catch (e) {
      _db = null;                          // 接続が切れていたら開き直してもう一度
      if (attempt) throw e;
    }
  }
}
function req2p(rq) { return new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); }

const Store = {
  async list() {
    const all = await tx('readonly', (st) => req2p(st.getAll()));
    return (all || []).filter((w) => !w.template).map((w) => ({ id: w.id, name: w.name, updated: w.updated, thumb: w.thumb }))
      .sort((a, b) => b.updated - a.updated);
  },
  /** テンプレートとして保存した物（作品の一覧には出さない） */
  async templates() {
    const all = await tx('readonly', (st) => req2p(st.getAll()));
    return (all || []).filter((w) => w.template).map((w) => ({ id: w.id, name: w.name, updated: w.updated, thumb: w.thumb }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  },
  async load(id) {
    const w = await tx('readonly', (st) => req2p(st.get(id)));
    if (!w) throw new Error('作品が見つかりません');
    const images = {};
    for (const [k, v] of Object.entries(w.images || {})) images[k] = new Uint8Array(v);
    const doc = new Doc(JSON.parse(w.doc), images);
    doc.workId = id;
    doc.name = w.name;
    doc.template = !!w.template;
    return doc;
  },
  async save(doc, thumb) {
    const id = doc.workId || ('w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const images = {};
    const used = new Set([...doc.iterTree()].filter((x) => x.kind === 'image').map((x) => x.image));
    for (const k of used) if (doc.images[k]) images[k] = doc.images[k].buffer.slice(doc.images[k].byteOffset, doc.images[k].byteOffset + doc.images[k].byteLength);
    const rec = { id, name: doc.name || '名称未設定', updated: Date.now(), thumb, doc: JSON.stringify(doc.pack()), images, template: !!doc.template };
    await tx('readwrite', (st) => req2p(st.put(rec)));
    doc.workId = id;
    return id;
  },
  async remove(id) { await tx('readwrite', (st) => req2p(st.delete(id))); },
  async rename(id, name) {
    const w = await tx('readonly', (st) => req2p(st.get(id)));
    if (!w) return;
    w.name = name;
    await tx('readwrite', (st) => req2p(st.put(w)));
  },
};
