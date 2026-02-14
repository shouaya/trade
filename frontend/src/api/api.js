import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    console.error('API Error:', error);
    return Promise.reject(error);
  }
);

// K 线数据相关 API
export const klinesAPI = {
  // 获取 K 线数据
  getKlines: (params = {}) => {
    return api.get('/klines', { params });
  },

  // 获取统计信息
  getStats: () => {
    return api.get('/klines/stats');
  },

  // 批量插入 K 线数据
  bulkInsert: (data) => {
    return api.post('/klines/bulk', data);
  },
};

// 交易记录相关 API
export const tradesAPI = {
  // 获取交易列表
  getTrades: (params = {}) => {
    return api.get('/trades', { params });
  },

  // 获取单个交易详情
  getTrade: (id) => {
    return api.get(`/trades/${id}`);
  },

  // 创建交易记录
  createTrade: (tradeData) => {
    return api.post('/trades', tradeData);
  },

  // 更新交易记录
  updateTrade: (id, tradeData) => {
    return api.put(`/trades/${id}`, tradeData);
  },

  // 获取交易统计
  getStats: () => {
    return api.get('/trades/stats/summary');
  },
};

// 策略相关 API
export const strategiesAPI = {
  // 获取所有策略
  getStrategies: (params = {}) => {
    return api.get('/strategies', { params });
  },

  // 获取单个策略
  getStrategy: (id) => {
    return api.get(`/strategies/${id}`);
  },

  // 创建策略
  createStrategy: (strategyData) => {
    return api.post('/strategies', strategyData);
  },
};

export default api;
