// js/api_config.js
export const API_BASE_URL = 'http://127.0.0.1:5000'; // 您的后端基础URL
export const REGISTER_API = `${API_BASE_URL}/api/auth/register`;
export const LOGIN_API = `${API_BASE_URL}/api/auth/login`;
// 如果 auth.js 中有 LOGOUT_API，也在这里定义
// export const LOGOUT_API = `${API_BASE_URL}/api/auth/logout`; // 假设的登出API