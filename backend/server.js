require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Trading API is running' });
});

// 导入路由
const klinesRouter = require('./routes/klines');
const tradesRouter = require('./routes/trades');
const strategiesRouter = require('./routes/strategies');
const importRouter = require('./routes/import');

app.use('/api/klines', klinesRouter);
app.use('/api/trades', tradesRouter);
app.use('/api/strategies', strategiesRouter);
app.use('/api/import', importRouter);

// 错误处理
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API Server is running on http://0.0.0.0:${PORT}`);
  console.log(`📊 Adminer available at http://localhost:8080`);
  console.log(`💾 Database: ${process.env.DB_NAME}`);
});
