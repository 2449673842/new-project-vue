/**
 * @file UI渲染与交互
 * @description 处理所有UI相关的操作，包括表格渲染、loading、消息提示等
 */

/**
 * Loading遮罩层
 */
let loadingCount = 0;
const loadingEl = document.createElement('div');
loadingEl.className = 'fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 hidden';
loadingEl.innerHTML = `
    <div class="bg-white p-4 rounded-lg shadow-lg flex items-center space-x-3">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span class="text-gray-700" id="loadingText">加载中...</span>
    </div>
`;
document.body.appendChild(loadingEl);

/**
 * 显示loading
 * @param {string} text 加载提示文本
 */
export function showLoading(text = '加载中...') {
    loadingCount++;
    document.getElementById('loadingText').textContent = text;
    loadingEl.classList.remove('hidden');
}

/**
 * 隐藏loading
 */
export function hideLoading() {
    loadingCount--;
    if (loadingCount <= 0) {
        loadingCount = 0;
        loadingEl.classList.add('hidden');
    }
}

/**
 * 消息提示
 */

// Loading遮罩层 (保持不变)

//const loadingEl = document.createElement('div');
// ... (loadingEl 的innerHTML和样式不变) ...
document.body.appendChild(loadingEl);



// 消息提示容器
const messageEl = document.createElement('div');
// 默认隐藏且不响应事件
messageEl.className = 'fixed inset-0 flex flex-col items-center justify-start pt-10 z-50 hidden pointer-events-none';
// ^^^ 修改了类名：默认 hidden, pointer-events-none, flex-col, items-center, justify-start, pt-10 (让消息从顶部出现)
document.body.appendChild(messageEl);

let messageTimeouts = []; // 用于管理消息的清除

export function showMessage(message, type = 'info', duration = 3000) {
    const colors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        info: 'bg-blue-500',
        warning: 'bg-yellow-500'
    };

    // 当有消息时，使 messageEl 可见并能让其子元素响应事件
    messageEl.classList.remove('hidden');
    messageEl.classList.remove('pointer-events-none'); // 允许其子元素（消息框）接收事件
    // 注意：messageEl 本身仍然可以是 pointer-events-none，只要它的子消息框是 pointer-events-auto

    const alertWrapper = document.createElement('div'); // 为每个alert创建一个wrapper，方便管理
    alertWrapper.className = 'w-auto max-w-md mb-4'; // 限制消息宽度，并添加底部间距

    const alert = document.createElement('div');
    alert.className = `${colors[type]} text-white px-6 py-4 rounded-lg shadow-lg transform transition-all duration-300 opacity-0 scale-95`;
    alert.style.pointerEvents = 'auto'; // 确保单个消息框可以被交互
    alert.innerHTML = message;

    alertWrapper.appendChild(alert);
    messageEl.appendChild(alertWrapper);


    // 动画显示
    setTimeout(() => {
        alert.classList.remove('opacity-0', 'scale-95');
        alert.classList.add('opacity-100', 'scale-100');
    }, 10);

    // 自动关闭
    const timeoutId = setTimeout(() => {
        alert.classList.add('opacity-0', 'scale-95');
        alert.classList.remove('opacity-100', 'scale-100');
        setTimeout(() => {
            if (messageEl.contains(alertWrapper)) {
                messageEl.removeChild(alertWrapper);
            }
            // 如果所有消息都已移除，隐藏 messageEl 并禁用其事件
            if (messageEl.childElementCount === 0) {
                messageEl.classList.add('hidden');
                messageEl.classList.add('pointer-events-none');
            }
        }, 300); // 动画时间
        messageTimeouts = messageTimeouts.filter(id => id !== timeoutId); // 从数组中移除
    }, duration);
    messageTimeouts.push(timeoutId);
}
/**
 * 渲染表格
 * @param {Array} records 记录数组
 * @param {string} tableId 表格ID
 */
export function renderTable(records, tableId = 'recordsTableBody') {
    const tbody = document.getElementById(tableId);
    if (!tbody) return;

    tbody.innerHTML = '';
    records.forEach(record => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50';
        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm text-gray-900">${record.title || ''}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm text-gray-500">${record.authors || ''}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm text-gray-500">${record.year || ''}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm text-gray-500">${record.doi || ''}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusClass(record.status)}">
                    ${record.status || ''}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <div class="flex space-x-2 justify-end">
                    <button onclick="window.open('${record.pdf_link}','_blank')" 
                            class="modern-btn modern-btn-primary">
                        打开PDF
                    </button>
                    <button onclick="window.PDFOperations.takeScreenshot('${record.id}')"
                            class="modern-btn modern-btn-secondary">
                        截图
                    </button>
                    <button onclick="window.deleteRecord('${record.id}')"
                            class="modern-btn modern-btn-danger">
                        删除
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * 获取状态样式类
 * @param {string} status 状态
 * @returns {string} 样式类名
 */
function getStatusClass(status) {
    const classes = {
        '已下载': 'bg-green-100 text-green-800',
        '待处理': 'bg-yellow-100 text-yellow-800',
        '处理失败': 'bg-red-100 text-red-800',
        '处理中': 'bg-blue-100 text-blue-800'
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
}

/**
 * 渲染分页控件
 * @param {Object} pagination 分页信息
 */
export function renderPagination(pagination) {
    const container = document.getElementById('pagination');
    if (!container) return;

    const { current, total, size } = pagination;
    const totalPages = Math.ceil(total / size);

    container.innerHTML = `
        <div class="flex items-center justify-between px-4 py-3 sm:px-6">
            <div class="flex-1 flex justify-between sm:hidden">
                <button onclick="changePage(${current - 1})" 
                        class="modern-btn ${current === 1 ? 'opacity-50 cursor-not-allowed' : ''}"
                        ${current === 1 ? 'disabled' : ''}>
                    上一页
                </button>
                <button onclick="changePage(${current + 1})"
                        class="modern-btn ${current === totalPages ? 'opacity-50 cursor-not-allowed' : ''}"
                        ${current === totalPages ? 'disabled' : ''}>
                    下一页
                </button>
            </div>
            <div class="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                    <p class="text-sm text-gray-700">
                        显示第 <span class="font-medium">${(current - 1) * size + 1}</span> 到 
                        <span class="font-medium">${Math.min(current * size, total)}</span> 条，
                        共 <span class="font-medium">${total}</span> 条
                    </p>
                </div>
                <div>
                    <nav class="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                        ${generatePaginationButtons(current, totalPages)}
                    </nav>
                </div>
            </div>
        </div>
    `;
}

/**
 * 生成分页按钮
 * @param {number} current 当前页
 * @param {number} total 总页数
 * @returns {string} 按钮HTML
 */
function generatePaginationButtons(current, total) {
    let buttons = [];
    
    // 上一页
    buttons.push(`
        <button onclick="changePage(${current - 1})" 
                class="modern-btn rounded-l-md ${current === 1 ? 'opacity-50 cursor-not-allowed' : ''}"
                ${current === 1 ? 'disabled' : ''}>
            上一页
        </button>
    `);

    // 页码按钮
    for (let i = 1; i <= total; i++) {
        if (i === current) {
            buttons.push(`
                <button class="modern-btn bg-blue-500 text-white">
                    ${i}
                </button>
            `);
        } else if (i === 1 || i === total || (i >= current - 1 && i <= current + 1)) {
            buttons.push(`
                <button onclick="changePage(${i})" class="modern-btn">
                    ${i}
                </button>
            `);
        } else if (i === current - 2 || i === current + 2) {
            buttons.push(`
                <span class="modern-btn">...</span>
            `);
        }
    }

    // 下一页
    buttons.push(`
        <button onclick="changePage(${current + 1})"
                class="modern-btn rounded-r-md ${current === total ? 'opacity-50 cursor-not-allowed' : ''}"
                ${current === total ? 'disabled' : ''}>
            下一页
        </button>
    `);

    return buttons.join('');
}

/**
 * 渲染统计信息
 * @param {Object} stats 统计数据
 */
export function renderStatistics(stats) {
    const containers = {
        total: document.querySelector('.stat-total'),
        downloaded: document.querySelector('.stat-downloaded'),
        screenshots: document.querySelector('.stat-screenshots')
    };

    if (containers.total) containers.total.textContent = stats.total || 0;
    if (containers.downloaded) containers.downloaded.textContent = stats.downloaded || 0;
    if (containers.screenshots) containers.screenshots.textContent = stats.screenshots || 0;

    // 更新进度条
    const progressBars = document.querySelectorAll('.progress-bar');
    progressBars.forEach(bar => {
        const type = bar.dataset.type;
        const value = stats[type] || 0;
        const total = stats.total || 1;
        const percentage = Math.round((value / total) * 100);
        bar.style.width = `${percentage}%`;
        bar.setAttribute('aria-valuenow', percentage);
    });
}

/**
 * 确认对话框
 * @param {string} message 提示信息
 * @returns {Promise<boolean>}
 */
export function confirm(message) {
    return new Promise(resolve => {
        const dialog = document.createElement('div');
        dialog.className = 'fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50';
        dialog.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-sm mx-auto">
                <p class="text-gray-700 mb-4">${message}</p>
                <div class="flex justify-end space-x-2">
                    <button class="modern-btn modern-btn-secondary" onclick="this.closest('.fixed').remove(); resolve(false)">
                        取消
                    </button>
                    <button class="modern-btn modern-btn-primary" onclick="this.closest('.fixed').remove(); resolve(true)">
                        确定
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
    });
}

// 导出工具函数
export const utils = {
    formatDate: (date) => {
        if (!date) return '';
        const d = new Date(date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    truncateText: (text, length = 50) => {
        if (!text) return '';
        return text.length > length ? text.substring(0, length) + '...' : text;
    }
};

window.showMessage = showMessage; 