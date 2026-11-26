// 元のスプレッドシートに紐づく Apps Script プロジェクトで実行する。
function exportExpiryBackup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const timezone = spreadsheet.getSpreadsheetTimeZone();
  const dateFields = new Set(['purchaseDate', 'expiryDate', 'buy_date', 'expiry_date']);

  function readSheet(name, fields) {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      if (name === 'EmojiMaster') return [];
      throw new Error(name + ' シートがありません。');
    }

    const [header, ...rows] = sheet.getDataRange().getValues();
    const indices = name === 'EmojiMaster' ? [0, 1, 2] :
      fields.map(field => header.findIndex(cell => String(cell).trim() === field));
    if (indices.includes(-1)) {
      throw new Error(name + ' シートの見出しを確認してください。');
    }

    return rows.filter(row => indices.some(index => row[index] != null && row[index] !== ''))
      .map(row => Object.fromEntries(fields.map((field, position) => {
        const value = row[indices[position]];
        if (value instanceof Date) {
          return [field, dateFields.has(field)
            ? Utilities.formatDate(value, timezone, 'yyyy-MM-dd') : value.toISOString()];
        }
        const text = String(value == null ? '' : value);
        if (dateFields.has(field)) {
          const date = text.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
          if (date) return [field, [date[1], date[2].padStart(2, '0'), date[3].padStart(2, '0')].join('-')];
        }
        return [field, text];
      })));
  }

  const backup = {
    version: 1,
    items: readSheet('Items',
      'id purchaseDate category productName emoji expiryType expiryDate storage stockStatus note createdAt updatedAt'.split(' ')),
    archive: readSheet('Archive',
      'archive_id archived_at item_id buy_date category product_name emoji expiry_type expiry_date storage stock_state memo product_key'.split(' ')),
    emojiMaster: readSheet('EmojiMaster', ['category', 'emoji', 'label']).filter(row => row.category.trim())
  };

  const filename = 'food-expiry-migration-' +
    Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd') + '.json';
  const file = DriveApp.createFile(Utilities.newBlob(JSON.stringify(backup, null, 2), 'application/json', filename));
  Logger.log('移行用JSONを保存しました: %s', file.getUrl());
}
