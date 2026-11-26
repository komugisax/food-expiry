let editingItemId = null;

let candidateMap = Object.create(null);

const STORAGE_OPTIONS = [
  ['冷蔵', '🧃'], ['冷凍', '🧊'], ['常温', '🌡️']
];

function storageChoices_(name, selected = '') {
  return `<fieldset class="storage-choices">
    <legend>保管場所</legend>
    <div class="storage-choices__options">
      ${STORAGE_OPTIONS.map(([value, icon]) => `
        <label class="storage-choices__option">
          <input type="radio" name="${name}" value="${value}" ${value === selected ? 'checked' : ''}>
          <span aria-hidden="true">${icon}</span><span>${value}</span>
        </label>`).join('')}
    </div>
  </fieldset>`;
}

function selectInputStorage_(value) {
  document.querySelectorAll('#storage input[type="radio"]').forEach(radio => {
    radio.checked = radio.value === value;
  });
}

function updateStockTabDots_(items, now = new Date()) {
  const today = localDay(now);
  const nextDay = new Date(now);
  nextDay.setDate(nextDay.getDate() + 1);
  const tomorrow = localDay(nextDay);
  const dueTypes = new Set(items
    .filter(item => item.expiryDate === today || item.expiryDate === tomorrow)
    .map(item => item.expiryType));

  const button = document.querySelector('[data-tab="tab-stock"]');
  const labels = ['在庫'];
  for (const [type, dot] of [['消費', 'use-by'], ['賞味', 'best-before']]) {
    const active = dueTypes.has(type);
    button.querySelector('.stock-tab-dot--' + dot).hidden = !active;
    if (active) labels.push(type + '期限が近い商品あり');
  }
  if (labels.length > 1) button.setAttribute('aria-label', labels.join('、'));
  else button.removeAttribute('aria-label');
}

function refreshStockTabDots_() {
  try {
    updateStockTabDots_(getActiveItems());
  } catch (error) {
    reportStorageError_(error);
  }
}

let stockTabRefreshTimer;
function scheduleStockTabRefresh_() {
  clearTimeout(stockTabRefreshTimer);
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  stockTabRefreshTimer = setTimeout(() => {
    refreshStockTabDots_();
    scheduleStockTabRefresh_();
  }, Math.max(1, midnight.getTime() - Date.now()));
}

function loadCandidates_() {
  Promise.resolve().then(() => getOutOfStockList()).then(list => {
    const dl = document.getElementById('productCandidates');
    if (!dl) {
      console.warn('productCandidates not found');
      return;
    }

    dl.innerHTML = '';
    candidateMap = Object.create(null);

    list.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.productName;
      dl.appendChild(opt);

      candidateMap[item.productName] = item;
    });
  }).catch(reportStorageError_);
}

function clearFormForNext_() {
  // 商品ごとに変わるものだけリセット
  document.getElementById('productName').value = '';
  document.getElementById('emoji').value = '';
  document.getElementById('expiryDate').value = '';
  document.getElementById('note').value = '';
}


function setDefaultDates_() {
  const today = localDay();
  const purchase = document.getElementById('purchaseDate');
  if (purchase) purchase.value = today;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('productForm').addEventListener('submit', event => event.preventDefault());
  document.getElementById('storage').innerHTML = storageChoices_('stock-storage');
  scheduleStockTabRefresh_();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refreshStockTabDots_();
    scheduleStockTabRefresh_();
  });
  // 初期値
  setDefaultDates_();

  // 候補読み込み
  loadCandidates_();

  // 在庫読み込み
  loadStockList_();

  // 在庫切れ読み込み
  loadOutOfStockList_();

  // 候補選択で自動入力
  const productNameEl = document.getElementById('productName');
  productNameEl.addEventListener('change', e => {
    const item = candidateMap[e.target.value];
    if (!item) return;

    document.getElementById('category').value = item.category || '';
    selectInputStorage_(item.storage);
    document.getElementById('emoji').value = item.emoji || '';

    renderEmojiPalette(item.category);
  });
  loadEmojiMaster_();
  const categoryEl = document.getElementById('category');
  categoryEl.addEventListener('change', e => {
    renderEmojiPalette(e.target.value);
  });

  // 登録
  // 二重登録防止
  let submitting = false;
  const saveBtn = document.getElementById('saveBtn');

  saveBtn.addEventListener('click', () => {
    if (submitting) return;
    submitting = true;
    saveBtn.disabled = true;
    saveBtn.textContent = '登録中...';

    const resetSubmitState_ = () => {
      submitting = false;
      saveBtn.disabled = false;
      saveBtn.textContent = '登録';
    };

    const data = {
      productName: document.getElementById('productName').value,
      purchaseDate: document.getElementById('purchaseDate').value,
      category: document.getElementById('category').value,
      storage: document.querySelector('#storage input:checked')?.value || '',
      emoji: document.getElementById('emoji').value,
      expiryType: document.getElementById('expiryType').value,
      expiryDate: document.getElementById('expiryDate').value,
      note: document.getElementById('note').value
    };

    if (!data.productName.trim()) {
      alert('商品名を入力してください');
      resetSubmitState_();
      return;
    }

    if (!data.category) {
      alert('カテゴリを選択してください');
      resetSubmitState_();
      return;
    }

    if (!data.storage) {
      alert('保管場所を選択してください');
      resetSubmitState_();
      return;
    }

    Promise.resolve().then(() => addItemFromHtml(data))
      .then(() => {
        try {
          clearStorageError_();
          showToast('登録しました ✅');
          clearFormForNext_();
          loadCandidates_();
          loadStockList_();
          loadOutOfStockList_();
        } finally {
          resetSubmitState_();
        }
      })
      .catch(err => {
        reportStorageError_(err);
        resetSubmitState_();
      })
      ;
  });
  renderEmojiPalette(document.getElementById('category').value);
  // setTimeout(softReload_, 500);
});

// 一覧・編集
function loadStockList_() {
  Promise.resolve().then(() => getActiveItems())
    .then(items => {
      // 少し待ってから消す（UX安定用）
      setTimeout(hideLoading_, 300);

      if (!Array.isArray(items)) {
        console.error('items is not array:', items);
        items = [];
      }
      updateStockTabDots_(items);
      items = sortStockItems_(items);

      const area = document.getElementById('stockList');
      area.innerHTML = '';

      if (items.length === 0) {
        area.textContent = '在庫がありません';
        return;
      }

      items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'stock-item';

        const isEditing = editingItemId === item.id;

        // ===== 表示HTML =====
        div.innerHTML = isEditing
          ? `
            <div class="stock-name" style="width:100%">
              <div style="font-weight:bold;margin-bottom:8px;">
                ${escapeHtml_(item.emoji)} ${escapeHtml_(item.productName)}（編集中）
              </div>
              <label>
                カテゴリ
                ${buildCategorySelect_(item.category)}
              </label>
              <label>
                期限種別
                <select class="edit-expiryType">
                  <option value="賞味" ${item.expiryType === '賞味' ? 'selected' : ''}>賞味</option>
                  <option value="消費" ${item.expiryType === '消費' ? 'selected' : ''}>消費</option>
                </select>
              </label>

              <label>
                期限日⏳
                <input type="date" class="edit-expiryDate"
                  value="${item.expiryDate ? item.expiryDate : ''}">
              </label>

              ${storageChoices_('edit-stock-storage', item.storage)}

              <label>
                メモ
                <input class="edit-note" value="${escapeHtml_(item.note)}">
              </label>

              <label>
                購入日🛒
                <input type="date" class="edit-purchaseDate"
                  value="${item.purchaseDate ? item.purchaseDate : ''}">
              </label>


              <div class="edit-actions">
                <button type="button" class="primary-btn save-btn">保存</button>
                <button type="button" class="cancel-btn">キャンセル</button>
              </div>
            </div>
          `
          : `
            <div class="stock-name">
              <div>
                ${escapeHtml_(item.emoji)} ${escapeHtml_(item.productName)}
                <button type="button" class="edit-btn">📝編集</button>
                <button type="button" class="clone-btn">➕複製</button>
              </div>
              <div class="expiry-text"></div>
            </div>
            <div class="stock-buttons">
              <button type="button" class="btn-circle">◯</button>
              <button type="button" class="btn-triangle">△</button>
              <button type="button" class="btn-cross">×</button>
            </div>
          `;

        // ===== 編集中 =====
        if (isEditing) {
          div.querySelector('.save-btn').onclick = () => {
            const data = {
              id: item.id,
              purchaseDate: div.querySelector('.edit-purchaseDate').value,
              expiryType: div.querySelector('.edit-expiryType').value,
              expiryDate: div.querySelector('.edit-expiryDate').value,
              storage: div.querySelector('.storage-choices input:checked')?.value ?? item.storage,
              note: div.querySelector('.edit-note').value,
              category: div.querySelector('.edit-category').value
            };

            Promise.resolve().then(() => updateItemFromEdit(data))
              .then(() => {
                editingItemId = null;
                loadStockList_();
                loadCandidates_();
                loadOutOfStockList_();
                clearStorageError_();
                showToast('変更を保存しました');
              })
              .catch(reportStorageError_);
          };

          div.querySelector('.cancel-btn').onclick = () => {
            editingItemId = null;
            loadStockList_();
          };
        }

        // ===== 通常表示 =====
        if (!isEditing) {
          const expiryEl = div.querySelector('.expiry-text');
          expiryEl.textContent = formatExpiry(item, div);

          const btnO = div.querySelector('.btn-circle');
          const btnT = div.querySelector('.btn-triangle');
          const btnX = div.querySelector('.btn-cross');
          const editBtn = div.querySelector('.edit-btn');
          const cloneBtn = div.querySelector('.clone-btn');

          if (item.stockStatus === '◯') btnO.classList.add('active');
          if (item.stockStatus === '△') {
            btnT.classList.add('active');
            div.classList.add('warning');
          }

          btnO.onclick = () => updateStock_(item.id, '◯', div);
          btnT.onclick = () => updateStock_(item.id, '△', div);
          btnX.onclick = () => {
            if (!confirm('アーカイブに移しますか？')) return;
            updateStock_(item.id, '×', div);
          };

          editBtn.onclick = () => {
            editingItemId = item.id;
            loadStockList_();
          };

          cloneBtn.onclick = () => {
            // フォームにセット
            document.getElementById('productName').value = item.productName || '';
            document.getElementById('emoji').value = item.emoji || '';
            selectInputStorage_(item.storage);
            document.getElementById('expiryType').value = item.expiryType || '賞味';
            document.getElementById('category').value = item.category || '';
            // 日付系はクリア（or 今日にしたければここでセット）
            document.getElementById('expiryDate').value = '';
            document.getElementById('note').value = '';

            // 絵文字パレット更新
            renderEmojiPalette(item.category || '');

            // 入力タブへ切り替え
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('[data-tab="tab-input"]').classList.add('active');

            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById('tab-input').classList.add('active');

            document.getElementById('purchaseDate').value = localDay();

            // 上にスクロール
            window.scrollTo({ top: 0, behavior: 'smooth' });

            // トースト
            showToast('複製しました。日付を確認してください');
          };
        }

        area.appendChild(div);
      });
    })
    .catch(err => {
      reportStorageError_(err);
      const area = document.getElementById('stockList');
      if (area) area.textContent = '在庫一覧の取得に失敗しました';
    })
    ;
}

function updateStock_(id, status, itemDiv) {
  // ① 先にUIを反映（即レス）
  const buttons = itemDiv.querySelectorAll('button');
  buttons.forEach(b => b.classList.remove('active'));

  if (status === '◯') itemDiv.querySelector('.btn-circle').classList.add('active');
  if (status === '△') itemDiv.querySelector('.btn-triangle').classList.add('active');

  // 在庫を保存する
  Promise.resolve().then(() => updateStockStatusById(id, status))
    .then(() => {
      clearStorageError_();
      if (status === '×') {
        // 一覧から即消す
        itemDiv.remove();
        refreshStockTabDots_();
        loadOutOfStockList_();
        loadCandidates_();

      }
    })
    .catch(err => {
      reportStorageError_(err);
      // 失敗したら一覧を作り直す
      loadStockList_();
    })
    ;
}

// 在庫切れ一覧
function loadOutOfStockList_() {
  Promise.resolve().then(() => getOutOfStockList())
    .then(list => {
      const area = document.getElementById('outOfStockList');
      if (!area) return;

      if (!Array.isArray(list)) {
        console.error('outOfStock is not array:', list);
        area.textContent = '取得に失敗しました';
        return;
      }

      area.innerHTML = '';
      if (list.length === 0) {
        area.textContent = '在庫切れはありません 👍';
        return;
      }

      list.forEach(item => {
        const div = document.createElement('div');
        div.className = 'oos-item';

        const name = `${item.emoji || ''} ${item.productName || ''}`.trim();
        const meta = `${item.category || ''} / ${item.storage || ''}`.trim();
        const count = item.count != null ? item.count : '';

        div.innerHTML = `
          <div class="oos-left">
            <div class="oos-name">
              ${escapeHtml_(name)}
              ${count !== '' ? `<span class="oos-badge">×${count}</span>` : ''}
            </div>
            <div class="oos-meta">${escapeHtml_(meta)}</div>
          </div>
          <button type="button" class="oos-btn">入力にセット</button>
        `;

        // 「入力にセット」押したらフォームに反映（買い物メモ的に使える）
        div.querySelector('.oos-btn').onclick = () => {
          // フォームに反映
          document.getElementById('productName').value = item.productName || '';
          document.getElementById('category').value = item.category || '';
          selectInputStorage_(item.storage);
          document.getElementById('emoji').value = item.emoji || '';
          renderEmojiPalette(item.category || '');

          // ★ 入力タブに切り替え
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          document.querySelector('[data-tab="tab-input"]').classList.add('active');

          document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
          document.getElementById('tab-input').classList.add('active');

          // ★ 画面を上へ
          window.scrollTo({ top: 0, behavior: 'smooth' });

          // ★ おまけ：トースト（あるなら）
          showToast('入力欄にセットしました');
        };
        area.appendChild(div);
      });
    })
    .catch(err => {
      reportStorageError_(err);
      const area = document.getElementById('outOfStockList');
      if (area) area.textContent = '取得に失敗しました';
    })
    ;
}

// HTMLエスケープ（念のため）
function escapeHtml_(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


// ソート
// items.sort((a, b) => {
//  if (!a.expiryDate || !b.expiryDate) return 0;
//  return new Date(a.expiryDate) - new Date(b.expiryDate);
// });

// 期限表示
function formatExpiry(item, div) {

  const today = new Date(localDay());

  div.classList.remove('overdue', 'today', 'soon');

  // ===== ① 期限がない場合 =====
  if (!item.expiryDate) {
    if (!item.purchaseDate) return '期限なし';

    const purchase = new Date(item.purchaseDate);

    const days = Math.floor((today - purchase) / (1000*60*60*24)) + 1;

    return `購入から${days}日目`;
  }

  // ===== ② 期限がある場合 =====
  const expiry = new Date(item.expiryDate);

  const diff = Math.floor((expiry - today) / (1000*60*60*24));
 

  let label = '';

  if (diff < 0) {
    div.classList.add('overdue');
    label = `期限切れ（${-diff}日過ぎ）`;
  } else if (diff === 0) {
    div.classList.add('today');
    label = '今日まで';
  } else if (diff <= 2) {
    div.classList.add('soon');
    label = `あと${diff}日`;
  } else {
    label = `あと${diff}日`;
  }

  // 購入日からの日数（あれば）
  let purchaseInfo = '';
  if (item.purchaseDate) {
    const purchase = new Date(item.purchaseDate);
    const daysFromPurchase =
      Math.floor((today - purchase) / (1000*60*60*24)) + 1;

    if (daysFromPurchase > 0) {
      purchaseInfo = `（購入から${daysFromPurchase}日目）`;
    }
  }

  return `${item.expiryType}：${label} ${purchaseInfo}`;

}


// カテゴリ別 絵文字定義
let EMOJI_BY_CATEGORY = {};

// 絵文字
function setEmoji(e) {
  document.getElementById('emoji').value = e;
}

function renderEmojiPalette(category) {
  const area = document.getElementById('emojiPalette');
  area.innerHTML = '';

  const list = emojiMaster.filter(e => e.category === category && e.emoji);

  if (list.length === 0) return;

  list.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.emoji;
    btn.onclick = () => setEmoji(item.emoji);
    area.appendChild(btn);
  });
}

// タブ
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // ボタン
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // 中身
    const id = btn.dataset.tab;
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(id).classList.add('active');

    // タブ切替時の再読込
    if (id === 'tab-stock') {
      // softReload_();
      loadStockList_();
    }
    if (id === 'tab-out') {
      loadOutOfStockList_();
    }
  });
});

// ローディングを消す
function hideLoading_() {
  const el = document.getElementById('loadingScreen');
  if (el) el.style.display = 'none';
}

// 絵文字読み込み
let emojiMaster = [];

function loadEmojiMaster_() {
  Promise.resolve().then(() => getEmojiMaster()).then(list => {
    emojiMaster = list;

    populateCategorySelect_();

    renderEmojiPalette(document.getElementById('category').value);
  }).catch(reportStorageError_);
}

// トースト
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 1500);
}

function sortStockItems_(items) {
  const today = new Date(localDay());

  return items.sort((a, b) => {
    // ===== Aの評価 =====
    const aEval = evaluateItem_(a, today);
    const bEval = evaluateItem_(b, today);

    // ① 優先度（小さいほど上）
    if (aEval.priority !== bEval.priority) {
      return aEval.priority - bEval.priority;
    }

    // ② 残り日数
    if (aEval.days !== bEval.days) {
      return aEval.days - bEval.days;
    }

    // ③ 購入日（古い方が上）
    return aEval.purchase - bEval.purchase;
  });
}

function evaluateItem_(item, today) {
  let priority;
  let days = 9999;

  if (!item.expiryDate) {
    // ★ 期限なし（野菜・果物など）
    priority = 2;
  } else {
    const expiry = new Date(item.expiryDate);

    days = Math.floor((expiry - today) / (1000*60*60*24));

    if (days < 0) priority = 0;        // 期限切れ
    else if (days === 0) priority = 1; // 今日まで
    else priority = 3;                 // 期限あり
  }

  const purchase = item.purchaseDate
    ? new Date(item.purchaseDate).getTime()
    : Number.MAX_SAFE_INTEGER;

  return { priority, days, purchase };
}

function softReload_() {
  hideLoading_();
  loadCandidates_();
  // document.getElementById('stockList').innerHTML = '';
  // document.getElementById('outOfStockList').innerHTML = '';
  loadStockList_();
  loadOutOfStockList_();
  // showToast('再読み込みしました');
}

/* カテゴリ */
function buildCategorySelect_(currentValue) {
  let html = `<select class="edit-category">`;

  const categories = [...new Set(emojiMaster.map(e => e.category))];

  categories.forEach(cat => {
    const selected = cat === currentValue ? 'selected' : '';
    html += `<option value="${escapeHtml_(cat)}" ${selected}>${escapeHtml_(cat)}</option>`;
  });

  html += `</select>`;
  return html;
}

function populateCategorySelect_() {
  const select = document.getElementById('category');
  if (!select) return;

  const previous = select.value;
  select.innerHTML = '<option value="">選択してください</option>';

  const categories = [...new Set(emojiMaster.map(e => e.category))];

  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
  select.value = categories.includes(previous) ? previous : '';
}


function reportStorageError_(error) {
  hideLoading_();
  const area = document.getElementById('storageError');
  area.textContent = 'データを処理できませんでした。' + (error.message || '');
  area.hidden = false;
}

function clearStorageError_() {
  document.getElementById('storageError').hidden = true;
}

document.getElementById('exportBackup').addEventListener('click', () => {
  try {
    const backup = JSON.stringify(readDatabase(), null, 2);
    const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'food-expiry-' + localDay() + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    clearStorageError_();
    showToast('JSONを書き出しました');
  } catch (error) {
    reportStorageError_(error);
  }
});

const backupFile = document.getElementById('backupFile');
document.getElementById('importBackup').addEventListener('click', () => backupFile.click());

backupFile.addEventListener('change', async () => {
  const file = backupFile.files[0];
  backupFile.value = '';
  if (!file) return;

  try {
    const backup = validateBackup(await file.text());
    if (!confirm('在庫 ' + backup.items.length + ' 件、履歴 ' + backup.archive.length +
      ' 件を復元します。現在のデータはすべて置き換わります。よろしいですか？')) return;

    const restore = () => writeDatabase(backup);
    if (navigator.locks) {
      await navigator.locks.request(STORAGE_KEY, restore);
    } else {
      restore();
    }
    editingItemId = null;
    clearStorageError_();
    loadEmojiMaster_();
    softReload_();
    showToast('JSONから復元しました');
  } catch (error) {
    reportStorageError_(error);
  }
});

window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  editingItemId = null;
  loadEmojiMaster_();
  softReload_();
});
