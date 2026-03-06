const assert = require('node:assert/strict');

const { test } = require('./harness.ts');
const taskManagerModulePath = require.resolve('../dist/services/task-manager.js');

function loadTaskManagerModule() {
  delete require.cache[taskManagerModulePath];
  return require('../dist/services/task-manager.js');
}

test('cleanupZombieTasks marks zombies failed without truncating trades', async () => {
  const queries: string[] = [];
  const fakeDb = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes('SELECT * FROM tasks')) {
        return [[{ task_id: 'train-2026-03-06-abc123', config_name: 'cfg', pid: 123, started_at: new Date() }]];
      }
      return [{}];
    }
  };

  const { TaskManager } = loadTaskManagerModule();
  const manager = new TaskManager(fakeDb as never);
  const result = await manager.cleanupZombieTasks();

  assert.equal(result.cleaned, 1);
  assert.equal(result.tradesCleared, false);
  assert.ok(queries.some(sql => sql.includes("SET status = 'failed'")));
  assert.ok(queries.every(sql => !sql.includes('TRUNCATE TABLE trades')));
});

test('TaskManager CRUD methods issue expected queries', async () => {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const fakeDb = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (sql.includes('SELECT * FROM tasks')) {
        return [[{ task_id: 'a', config_name: 'b', description: 'c', pid: 1, status: 'running' }]];
      }
      if (sql.includes('DELETE FROM tasks')) {
        return [{ affectedRows: 2 }];
      }
      return [{}];
    }
  };

  const { TaskManager } = loadTaskManagerModule();
  const manager = new TaskManager(fakeDb as never);

  const taskId = await manager.createTask('cfg', 'desc');
  assert.match(taskId, /^train-\d{4}-\d{2}-\d{2}-/);

  await manager.completeTask(taskId);
  await manager.failTask(taskId, new Error('boom'));
  const running = await manager.getRunningTasks();
  await manager.cleanupOldTasks();

  assert.equal(running.length, 1);
  assert.ok(queries.some(entry => entry.sql.includes("INSERT INTO tasks")));
  assert.ok(queries.some(entry => entry.sql.includes("SET status = 'completed'")));
  assert.ok(queries.some(entry => entry.sql.includes("SET status = 'failed'") && entry.sql.includes("description = CONCAT")));
  assert.ok(queries.some(entry => entry.sql.includes("WHERE status = 'running'")));
  assert.ok(queries.some(entry => entry.sql.includes('DELETE FROM tasks')));
});

test('cleanupZombieTasks returns clean state when no zombies exist', async () => {
  const fakeDb = {
    async query(sql: string) {
      if (sql.includes('SELECT * FROM tasks')) {
        return [[]];
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  const { TaskManager } = loadTaskManagerModule();
  const manager = new TaskManager(fakeDb as never);
  const result = await manager.cleanupZombieTasks();
  assert.deepEqual(result, { cleaned: 0, tradesCleared: false });
});

test('createTaskManager builds mysql connection from env defaults and overrides', async () => {
  const mysqlModulePath = require.resolve('mysql2/promise');
  const originalMysqlModule = require.cache[mysqlModulePath];
  const originalEnv = {
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_NAME: process.env.DB_NAME
  };

  try {
    let capturedConfig;
    require.cache[mysqlModulePath] = {
      exports: {
        createConnection: async (config) => {
          capturedConfig = config;
          return { fake: true };
        }
      }
    };

    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_NAME;

    let moduleRef = loadTaskManagerModule();
    let manager = await moduleRef.createTaskManager();
    assert.deepEqual(capturedConfig, {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: '',
      database: 'trading'
    });
    assert.ok(manager);

    process.env.DB_HOST = 'mysql';
    process.env.DB_PORT = '3307';
    process.env.DB_USER = 'trader';
    process.env.DB_PASSWORD = 'secret';
    process.env.DB_NAME = 'trade_test';

    moduleRef = loadTaskManagerModule();
    manager = await moduleRef.createTaskManager();
    assert.deepEqual(capturedConfig, {
      host: 'mysql',
      port: 3307,
      user: 'trader',
      password: 'secret',
      database: 'trade_test'
    });
    assert.ok(manager);
  } finally {
    if (originalMysqlModule) {
      require.cache[mysqlModulePath] = originalMysqlModule;
    } else {
      delete require.cache[mysqlModulePath];
    }

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
