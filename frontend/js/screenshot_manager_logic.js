// js/screenshot_manager_logic.js

// 导入所有必要的模块和函数
import { showStatus, closeModal } from './utils.js'; // 假设 closeModal 和 showStatus 从 utils.js 导出
import { fetchAllMyScreenshotsApi } from './api.js'; // 假设这个 API 用于获取所有截图
// 您可能还需要其他模块，例如用于上传的 API 函数，或者用于批量处理的函数

// --- 页面作用域变量和 DOM 元素引用（如果需要缓存）---
let searchInputElem;
let filterTypeElem;
let filterSortElem;
let screenshotGridElem; // 截图网格容器
let uploadModalElem;
let batchProcessModalElem;
let fileInputElem;
let uploadFormElem;

// --- 模态框操作函数 ---
// 这些函数在 HTML 中被 onclick 调用，为了最佳实践，应该将事件绑定移到 JS 中
// 但为了兼容旧 HTML，暂时将它们导出
export function openUploadModal() {
    if (uploadModalElem) uploadModalElem.classList.remove('hidden');
    if (uploadModalElem) uploadModalElem.classList.add('flex');
}

export function closeUploadModal() {
    if (uploadModalElem) uploadModalElem.classList.add('hidden');
    if (uploadModalElem) uploadModalElem.classList.remove('flex');
}

export async function submitUpload() {
    // 实际上传逻辑
    showStatus('上传功能待实现。', 'text-yellow-500', 3000);
    console.log('Uploading files...');
    closeUploadModal();
}

export function openBatchProcessModal() {
    if (batchProcessModalElem) batchProcessModalElem.classList.remove('hidden');
    if (batchProcessModalElem) batchProcessModalElem.classList.add('flex');
}

export function closeBatchProcessModal() {
    if (batchProcessModalElem) batchProcessModalElem.classList.add('hidden');
    if (batchProcessModalElem) batchProcessModalElem.classList.remove('flex');
}

// --- 截图操作占位函数（如果 HTML 中有 onclick 调用）---
export function editScreenshot(id) {
    showStatus(`编辑截图 ${id} 功能待实现。`, 'text-yellow-500', 3000);
    console.log('Editing screenshot:', id);
}

export function downloadScreenshot(id) {
    showStatus(`下载截图 ${id} 功能待实现。`, 'text-yellow-500', 3000);
    console.log('Downloading screenshot:', id);
}

export function upgradeToPro() {
    showStatus('升级到专业版功能待实现，正在跳转到订阅页面。', 'text-blue-500', 3000);
    window.location.href = 'subscription.html';
}

// --- 主要初始化函数 ---
export async function initializeScreenshotManagerPage() {
    console.log("Initializing Screenshot Manager page...");

    // 缓存 DOM 元素引用
    searchInputElem = document.getElementById('searchInput');
    filterTypeElem = document.getElementById('filterType');
    filterSortElem = document.getElementById('filterSort');
    screenshotGridElem = document.getElementById('screenshotGrid');
    uploadModalElem = document.getElementById('uploadModal');
    batchProcessModalElem = document.getElementById('batchProcessModal');
    fileInputElem = document.getElementById('fileInput');
    uploadFormElem = document.getElementById('uploadForm');

    // --- 事件监听器绑定（最佳实践）---
    // 移除 HTML 中的 onclick，在这里绑定事件
    document.querySelector('button[onclick="openUploadModal()"]')?.addEventListener('click', openUploadModal);
    document.querySelector('button[onclick="openBatchProcessModal()"]')?.addEventListener('click', openBatchProcessModal);
    document.querySelector('#uploadModal button[onclick="closeUploadModal()"]')?.addEventListener('click', closeUploadModal);
    document.querySelector('#uploadModal button[onclick="submitUpload()"]')?.addEventListener('click', submitUpload);
    document.querySelector('#batchProcessModal button[onclick="closeBatchProcessModal()"]')?.addEventListener('click', closeBatchProcessModal);
    document.querySelector('button[onclick="upgradeToPro()"]')?.addEventListener('click', upgradeToPro);

    // 示例截图卡片中的事件绑定（通常由 JS 动态渲染时绑定）
    // 如果这些卡片是静态 HTML，需要为它们也绑定事件
    // 为了简化，这里假定这些按钮会被动态渲染，并在渲染函数中绑定事件
    // 或者需要一个通用的事件委托机制

    // 文件上传处理
    if (fileInputElem) {
        fileInputElem.addEventListener('change', (e) => {
            console.log('Files selected:', e.target.files);
            // 这里可以添加实际的文件上传逻辑，例如调用一个 uploadFile 函数
        });
    }

    if (uploadFormElem) {
        uploadFormElem.addEventListener('submit', (e) => {
            e.preventDefault();
            submitUpload(); // 调用上传函数
        });
    }

    // 搜索和筛选功能
    searchInputElem?.addEventListener('input', debounce(() => {
        console.log('Searching:', searchInputElem.value);
        // 实现搜索逻辑，例如调用一个 renderScreenshots 函数
        renderScreenshots();
    }, 300)); // 防抖

    filterTypeElem?.addEventListener('change', () => {
        console.log('Filtering by type:', filterTypeElem.value);
        // 实现筛选逻辑
        renderScreenshots();
    });

    filterSortElem?.addEventListener('change', () => {
        console.log('Sorting by:', filterSortElem.value);
        // 实现排序逻辑
        renderScreenshots();
    });

    // --- 初始加载截图数据（占位）---
    await renderScreenshots(); // 首次加载时渲染截图

    console.log("Screenshot Manager page initialized.");
}

// 占位函数：渲染截图网格（需要根据您的数据结构和后端 API 来实现）
async function renderScreenshots() {
    if (!screenshotGridElem) return;
    screenshotGridElem.innerHTML = '<p class="text-gray-500 text-center py-8">正在加载截图...</p>';

    try {
        const screenshots = await fetchAllMyScreenshotsApi(); // 调用 API 获取截图数据
        if (screenshots && screenshots.length > 0) {
            screenshotGridElem.innerHTML = ''; // 清空加载提示
            screenshots.forEach(screenshot => {
                // 这里应该根据实际的截图数据结构来动态创建卡片 HTML
                // 为了演示，我们只显示一个简单的卡片
                const card = document.createElement('div');
                card.className = 'screenshot-card';
                card.innerHTML = `
                    <img src="path/to/your/image/${screenshot.image_server_path}" alt="${screenshot.description || '截图'}">
                    <div class="screenshot-overlay"></div>
                    <div class="p-4">
                        <h3 class="font-semibold text-gray-900">${screenshot.article_title || '未知文献'} - P${screenshot.page_number}</h3>
                        <div class="screenshot-tags">
                            <span class="screenshot-tag">${screenshot.chart_type_annotation || '未指定类型'}</span>
                        </div>
                        <div class="screenshot-stats">
                            <span class="screenshot-stat">
                                <i class="fas fa-eye"></i>
                                <span>预览</span>
                            </span>
                            <span class="screenshot-stat">
                                <i class="fas fa-download"></i>
                                <span>下载</span>
                            </span>
                        </div>
                    </div>
                    <div class="screenshot-actions">
                        <button class="modern-btn modern-btn-secondary" data-action="edit" data-id="${screenshot.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="modern-btn modern-btn-primary" data-action="download" data-path="${screenshot.image_server_path}">
                            <i class="fas fa-download"></i>
                        </button>
                    </div>
                `;
                screenshotGridElem.appendChild(card);

                // 在这里绑定动态创建的按钮事件（最佳实践）
                card.querySelector('button[data-action="edit"]')?.addEventListener('click', (e) => editScreenshot(e.currentTarget.dataset.id));
                card.querySelector('button[data-action="download"]')?.addEventListener('click', (e) => downloadScreenshot(e.currentTarget.dataset.path));
            });
        } else {
            screenshotGridElem.innerHTML = '<p class="text-gray-500 text-center py-8">没有找到任何截图。</p>';
        }
    } catch (error) {
        console.error("加载截图失败:", error);
        screenshotGridElem.innerHTML = '<p class="text-red-500 text-center py-8">加载截图时发生错误。</p>';
        showStatus('加载截图失败，请检查网络或后端服务。', 'text-red-500', 5000);
    }
}

// 辅助函数：防抖
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}