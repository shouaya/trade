function loadEnvFiles(dotenv, envPaths) {
  for (const envPath of envPaths) {
    dotenv.config({ path: envPath });
  }
}

function getMysqlConnectionOptions(options = {}) {
  const defaults = options.defaults || {};
  const overrides = options.overrides || {};

  return {
    host: process.env.DB_HOST || defaults.host || 'localhost',
    port: Number(process.env.DB_PORT || defaults.port || 3306),
    user: process.env.DB_USER || defaults.user || 'trader',
    password: process.env.DB_PASSWORD || defaults.password || 'traderpass',
    database: process.env.DB_NAME || defaults.database || 'trading',
    charset: 'utf8mb4',
    ...overrides
  };
}

function createMysqlPromisePool(mysql, options = {}) {
  const pool = mysql.createPool(getMysqlConnectionOptions(options));
  return typeof pool.promise === 'function' ? pool.promise() : pool;
}

async function warmupMysqlConnection(db, options = {}) {
  try {
    const connection = await db.getConnection();
    await connection.query("SET NAMES 'utf8mb4'");

    if (options.successMessage) {
      console.log(options.successMessage);
    }

    if (typeof connection.release === 'function') {
      connection.release();
    }
  } catch (error) {
    if (options.failureMessage) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(options.failureMessage, message);
      return;
    }

    throw error;
  }
}

async function createMysqlConnectionWithFallback(mysql, options = {}) {
  const fallbackHost = options.fallbackHost || '127.0.0.1';
  const primaryOptions = getMysqlConnectionOptions({
    defaults: options.defaults,
    overrides: options.overrides
  });

  try {
    return await mysql.createConnection(primaryOptions);
  } catch (error) {
    if (primaryOptions.host === fallbackHost) {
      throw error;
    }

    return mysql.createConnection({
      ...primaryOptions,
      host: fallbackHost
    });
  }
}

module.exports = {
  createMysqlConnectionWithFallback,
  createMysqlPromisePool,
  getMysqlConnectionOptions,
  loadEnvFiles,
  warmupMysqlConnection
};
