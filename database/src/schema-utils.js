async function columnExists(db, tableName, columnName) {
  const [columns] = await db.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
  return columns.length > 0;
}

async function indexExists(db, tableName, indexName) {
  const [indexes] = await db.query(`SHOW INDEX FROM ${tableName} WHERE Key_name = ?`, [indexName]);
  return indexes.length > 0;
}

async function ensureColumn(db, tableName, columnName, ddl) {
  if (!await columnExists(db, tableName, columnName)) {
    await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${ddl}`);
  }
}

async function ensureIndex(db, tableName, indexName, ddl) {
  if (!await indexExists(db, tableName, indexName)) {
    await db.query(`ALTER TABLE ${tableName} ADD ${ddl}`);
  }
}

async function modifyColumnIfExists(db, tableName, columnName, ddl) {
  if (await columnExists(db, tableName, columnName)) {
    await db.query(`ALTER TABLE ${tableName} MODIFY COLUMN ${columnName} ${ddl}`);
  }
}

async function dropColumnIfExists(db, tableName, columnName) {
  if (await columnExists(db, tableName, columnName)) {
    await db.query(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
  }
}

async function dropIndexIfExists(db, tableName, indexName) {
  if (await indexExists(db, tableName, indexName)) {
    await db.query(`ALTER TABLE ${tableName} DROP INDEX ${indexName}`);
  }
}

module.exports = {
  columnExists,
  dropColumnIfExists,
  dropIndexIfExists,
  ensureColumn,
  ensureIndex,
  indexExists,
  modifyColumnIfExists
};
