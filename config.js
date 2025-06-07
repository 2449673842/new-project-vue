// js/config.js

// 列名映射配置，用于文件解析和数据显示
export const COLUMN_MAPPING = {
    title: ['Article Title', 'Title', '标题', '篇名'],
    authors: ['Authors', 'Author Full Names', '作者'],
    year: ['Publication Year', 'Year', '年份', '出版年份'],
    source: ['Source Title', 'Journal', '期刊', '来源', '刊名'], // 注意: my_records.html 中的 LiteratureArticle 模型字段名是 source_publication
    doi: ['DOI', 'doi']
};

export const LOCAL_STORAGE_KEY_TABLE_DATA = 'litFinderTableDataV1';

// PDF 查看器相关的固定配置
export const MIN_PDF_SCALE = 0.25;  // 最小缩放比例 (25%)
export const MAX_PDF_SCALE = 4.0;   // 最大缩放比例 (400%)
export const PDF_SCALE_INCREMENT = 0.25; // 每次缩放的步长 (25%)
export const DEFAULT_PDF_SCALE = 1.5; // 默认的PDF初始缩放比例 (150%)

// 截图缩略图的尺寸限制
export const THUMBNAIL_MAX_WIDTH = 100;
export const THUMBNAIL_MAX_HEIGHT = 80;

// 开发环境配置
const config = {
    isDevelopment: true,  // 开发环境标志
    apiBaseUrl: 'http://127.0.0.1:5000',
    useTailwindCDN: true, // 开发环境使用 CDN
    debug: true,          // 启用调试日志
};

export default config;

console.log("config.js loaded: Configurations exported as ES6 module.");