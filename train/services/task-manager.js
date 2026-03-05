/**
 * 训练任务管理器
 * 防止后台进程污染数据
 */

const mysql = require('mysql2/promise');

class TaskManager {
  constructor(db) {
    this.db = db;
  }

  /**
   * 创建新任务
   */
  async createTask(configName, description) {
    const taskId = this.generateTaskId();
    const pid = process.pid;

    await this.db.query(`
      INSERT INTO tasks (task_id, config_name, description, pid, status)
      VALUES (?, ?, ?, ?, 'running')
    `, [taskId, configName, description, pid]);

    console.log(`✅ 任务已注册: ${taskId} (PID: ${pid})`);
    return taskId;
  }

  /**
   * 标记任务完成
   */
  async completeTask(taskId) {
    await this.db.query(`
      UPDATE tasks
      SET status = 'completed', completed_at = NOW()
      WHERE task_id = ?
    `, [taskId]);

    console.log(`✅ 任务完成: ${taskId}`);
  }

  /**
   * 标记任务失败
   */
  async failTask(taskId, error) {
    await this.db.query(`
      UPDATE tasks
      SET status = 'failed', completed_at = NOW(), description = CONCAT(description, ' | Error: ', ?)
      WHERE task_id = ?
    `, [error.message || String(error), taskId]);

    console.log(`❌ 任务失败: ${taskId}`);
  }

  /**
   * 清理僵尸任务并清空trades表
   */
  async cleanupZombieTasks() {
    // 1. 查找所有running状态的任务
    const [zombies] = await this.db.query(`
      SELECT * FROM tasks
      WHERE status = 'running'
      ORDER BY started_at DESC
    `);

    if (zombies.length === 0) {
      console.log('✅ 没有发现僵尸任务');
      return { cleaned: 0, tradesCleared: false };
    }

    console.log(`\n⚠️  发现 ${zombies.length} 个僵尸任务:`);
    console.table(zombies.map(z => ({
      task_id: z.task_id,
      config: z.config_name,
      pid: z.pid,
      started: z.started_at
    })));

    // 2. 标记为失败
    await this.db.query(`
      UPDATE tasks
      SET status = 'failed', completed_at = NOW()
      WHERE status = 'running'
    `);

    console.log(`✅ 已标记 ${zombies.length} 个僵尸任务为失败状态`);

    // 3. 清空trades表（因为可能被污染）
    console.log('\n🧹 清空trades表以移除可能的污染数据...');
    await this.db.query('TRUNCATE TABLE trades');
    console.log('✅ trades表已清空');

    return {
      cleaned: zombies.length,
      tradesCleared: true,
      tasks: zombies
    };
  }

  /**
   * 获取当前运行的任务
   */
  async getRunningTasks() {
    const [tasks] = await this.db.query(`
      SELECT * FROM tasks
      WHERE status = 'running'
      ORDER BY started_at DESC
    `);
    return tasks;
  }

  /**
   * 生成任务ID
   */
  generateTaskId() {
    // 生成类似 "train-2026-03-05-abc123" 的ID
    const timestamp = new Date().toISOString().split('T')[0];
    const random = Math.random().toString(36).substring(2, 8);
    return `train-${timestamp}-${random}`;
  }

  /**
   * 清理旧任务记录（保留最近30天）
   */
  async cleanupOldTasks() {
    const [result] = await this.db.query(`
      DELETE FROM tasks
      WHERE completed_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);

    if (result.affectedRows > 0) {
      console.log(`🧹 清理了 ${result.affectedRows} 条30天前的任务记录`);
    }
  }
}

/**
 * 创建TaskManager实例
 */
async function createTaskManager() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'trading'
  });

  return new TaskManager(db);
}

module.exports = {
  TaskManager,
  createTaskManager
};
