async function tableExists(db, tableName) {
  const [rows] = await db.query('SHOW TABLES LIKE ?', [tableName]);
  return rows.length > 0;
}

async function allTablesExist(db, tableNames) {
  for (const tableName of tableNames) {
    if (!await tableExists(db, tableName)) {
      return false;
    }
  }

  return true;
}

module.exports = {
  allTablesExist,
  tableExists
};
