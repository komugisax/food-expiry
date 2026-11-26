'use strict';

const STORAGE_KEY = 'food-expiry:' + location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '');
const DEFAULT_EMOJI = [
  ['野菜', '🥬🥕🍅'], ['果物', '🍎🍌🍊'], ['肉', '🥩🍗🥓'],
  ['魚介', '🐟🦐🦪'], ['卵・乳製品', '🥚🥛🧀'], ['主食', '🍚🍞🍜'],
  ['惣菜', '🍱🥗🍲'], ['飲料', '🧃☕🍵'], ['その他', '🍽️📦']
].flatMap(([category, icons]) =>
  Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(icons),
    ({ segment }) => ({ category, emoji: segment, label: '' }))
);

function emptyDatabase() {
  return { version: 1, items: [], archive: [], emojiMaster: DEFAULT_EMOJI };
}

function readDatabase() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === null ? emptyDatabase() : validateBackup(saved);
}

function writeDatabase(db) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function changeDatabase(change) {
  // 同一URLを開いたタブ間で読み込みから保存までを直列化する。
  const commit = () => {
    const db = readDatabase();
    change(db);
    writeDatabase(db);
  };
  return navigator.locks ? navigator.locks.request(STORAGE_KEY, commit) : commit();
}

function validateBackup(source) {
  let data;
  try {
    data = JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('JSONファイルを読み取れませんでした。');
  }
  if (data?.version !== 1 || !['items', 'archive', 'emojiMaster'].every(key => Array.isArray(data[key]))) {
    throw new Error('このアプリのバックアップ形式（version 1）を選んでください。');
  }

  function rows(key, fields, id, validate) {
    const ids = new Set();
    return data[key].map((row, i) => {
      if (!row || !fields.every(field => typeof row[field] === 'string') ||
          (id && (!row[id].trim() || ids.has(row[id]))) || !validate(row)) {
        throw new Error(key + ' の ' + (i + 1) + ' 件目の形式を確認してください。');
      }
      if (id) ids.add(row[id]);
      return Object.fromEntries(fields.map(field => [field, row[field]]));
    });
  }

  const day = value => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
  const timestamp = value => !value || !Number.isNaN(Date.parse(value));
  return {
    version: 1,
    items: rows('items',
      'id purchaseDate category productName emoji expiryType expiryDate storage stockStatus note createdAt updatedAt'.split(' '),
      'id', row => ['◯', '△'].includes(row.stockStatus) && day(row.purchaseDate) &&
        day(row.expiryDate) && timestamp(row.createdAt) && timestamp(row.updatedAt)),
    archive: rows('archive',
      'archive_id archived_at item_id buy_date category product_name emoji expiry_type expiry_date storage stock_state memo product_key'.split(' '),
      'archive_id', row => day(row.buy_date) && day(row.expiry_date) && timestamp(row.archived_at)),
    emojiMaster: rows('emojiMaster', ['category', 'emoji', 'label'], null, row => row.category.trim())
  };
}

function productKey(category, name, storage) {
  return [category, name, storage].map(value => value.trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
}

function localDay(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}

function addItemFromHtml(data) {
  const productName = data.productName.trim();
  if (!productName) throw new Error('商品名を入力してください。');
  const now = new Date().toISOString();
  return changeDatabase(db => {
    db.items.push({
      ...data, productName, purchaseDate: data.purchaseDate || localDay(),
      id: crypto.randomUUID(), stockStatus: '◯', createdAt: now, updatedAt: now
    });
  });
}

function findItem(db, id) {
  const item = db.items.find(row => row.id === id);
  if (!item) throw new Error('商品が見つかりません。一覧を再読み込みしてください。');
  return item;
}

function updateItemFromEdit(data) {
  return changeDatabase(db => {
    const item = findItem(db, data.id);
    Object.assign(item, data, {
      purchaseDate: data.purchaseDate || item.purchaseDate,
      updatedAt: new Date().toISOString()
    });
  });
}

function updateStockStatusById(id, stockStatus) {
  return changeDatabase(db => {
    const item = findItem(db, id);
    const updatedAt = new Date().toISOString();
    if (stockStatus !== '×') {
      Object.assign(item, { stockStatus, updatedAt });
      return;
    }
    db.archive.push({
      archive_id: crypto.randomUUID(), archived_at: updatedAt, item_id: item.id,
      buy_date: item.purchaseDate, category: item.category, product_name: item.productName,
      emoji: item.emoji, expiry_type: item.expiryType, expiry_date: item.expiryDate,
      storage: item.storage, stock_state: stockStatus, memo: item.note,
      product_key: productKey(item.category, item.productName, item.storage)
    });
    db.items = db.items.filter(row => row.id !== id);
  });
}

function getActiveItems() {
  return readDatabase().items;
}

function getOutOfStockList() {
  const { items, archive } = readDatabase();
  const keysInStock = new Set(items.map(item => productKey(item.category, item.productName, item.storage)));
  const results = new Map();
  for (const row of archive) {
    const key = productKey(row.category, row.product_name, row.storage);
    if (keysInStock.has(key)) continue;
    if (!results.has(key)) {
      results.set(key, {
        productName: row.product_name, emoji: row.emoji,
        category: row.category, storage: row.storage, count: 0, lastArchivedAt: 0
      });
    }
    const entry = results.get(key);
    entry.count++;
    entry.lastArchivedAt = Math.max(entry.lastArchivedAt, Date.parse(row.archived_at) || 0);
  }
  return [...results.values()].sort((a, b) => b.count - a.count || b.lastArchivedAt - a.lastArchivedAt);
}

function getEmojiMaster() {
  const { items, archive, emojiMaster } = readDatabase();
  const master = emojiMaster.length ? emojiMaster : DEFAULT_EMOJI;
  const categories = new Set(master.map(row => row.category));
  return master.concat([...new Set([...items, ...archive].map(row => row.category))]
    .filter(category => category && !categories.has(category))
    .map(category => ({ category, emoji: '', label: '' })));
}
