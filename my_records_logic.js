/**
 * 我的文献记录页面主逻辑模块
 * @module my_records_logic
 * @description 管理文献记录的核心功能模块，包括文献列表展示、PDF查看、截图管理等功能
 * @author 文献助手开发团队
 * @version 1.0.0
 */

// 导入必要的模块
import { Header } from '../js/components/header.js';
import { Navbar } from '../js/components/navbar.js';
import {
    fetchLiteratureList,
    deleteLiteratureArticleApi,
    updateSingleLiteratureArticle,
    findPdfLinkApi,
    batchProcessAndZipApi,
    deleteScreenshotFromServerApi,
    updateScreenshotMetadataApi,
    fetchAllMyScreenshotsApi
} from './api.js';
import {
    showStatus,
    truncateText,
    sanitizeFilenameForImage
} from './utils.js';
import {
    initializePdfJsWorker,
    loadPdfFromUrl,
    showPdfPlaceholder,
    initializeSelectionCanvasListeners,
    updateZoomControls,
    updatePdfNavButtons
} from './pdfViewerCore.js';

// 常量定义
const PAGE_SIZE = 15; // 每页显示的记录数
const PDF_INSTANCE_SUFFIX = "_MyRecords"; // PDF查看器实例后缀
const DEBOUNCE_DELAY = 300; // 防抖延迟时间（毫秒）
const STATUS_DISPLAY_DURATION = {
    SUCCESS: 2000, // 成功提示显示时间
    ERROR: 3000,   // 错误提示显示时间
    WARNING: 3000  // 警告提示显示时间
};

// DOM元素ID映射
const DOM_IDS = {
    // 编辑文献模态框相关元素
    editLiteratureModal: 'editLiteratureModal_MyRecords',
    editLiteratureModalTitle: 'editLiteratureModalTitle_MyRecords',
    editingLiteratureDbId: 'editingLiteratureDbId_MyRecords',
    editLitTitle: 'editLitTitle_MyRecords',
    editLitAuthors: 'editLitAuthors_MyRecords',
    editLitYear: 'editLitYear_MyRecords',
    editLitDoi: 'editLitDoi_MyRecords',
    editLitPdfLink: 'editLitPdfLink_MyRecords',
    editLitStatus: 'editLitStatus_MyRecords',
    editLitSource: 'editLitSource_MyRecords',
    saveEditLitButton: 'saveEditLitButton_MyRecords',
    cancelEditLitButton: 'cancelEditLitButton_MyRecords',
    editLiteratureModalCloseIcon: 'editLiteratureModalCloseIcon_MyRecords',

    // 截图查看器模态框相关元素
    recordScreenshotsViewerModal: 'recordScreenshotsViewerModal_MyRecords',
    recordScreenshotsViewerArticleTitle: 'recordScreenshotsViewerArticleTitle_MyRecords',
    screenshotsGridContainer: 'screenshotsGridContainer_MyRecords',
    noScreenshotsForRecordMessage: 'noScreenshotsForRecordMessage_MyRecords',
    recordScreenshotsViewerCloseBtn: 'recordScreenshotsViewerCloseBtn_MyRecords',
    recordScreenshotsViewerCloseFooterBtn: 'recordScreenshotsViewerCloseFooterBtn_MyRecords',

    // PDF查看器相关元素
    pdfViewerModal: 'pdfViewerModal_MyRecords',
    pdfViewerTitle: 'pdfViewerTitle_MyRecords',
    pdfCanvas: 'pdfCanvas_MyRecords',
    selectionCanvas: 'selectionCanvas_MyRecords',
    captureSelectionBtn: 'captureSelectionBtn_MyRecords',
    pdfPageInfo: 'pdfPageInfo_MyRecords',
    pageCount: 'pageCount_MyRecords',

    // 截图编辑相关元素
    screenshotEditForm: 'screenshotEditForm_MyRecords',
    screenshotEditChartType: 'screenshotEditChartType_MyRecords',
    screenshotEditDescription: 'screenshotEditDescription_MyRecords',
    screenshotEditModal: 'screenshotEditModal_MyRecords',
    screenshotEditPreview: 'screenshotEditPreview_MyRecords'
};

// 状态管理对象
const state = {
    currentPage: 1,           // 当前页码
    totalRecords: 0,         // 总记录数
    totalPages: 1,           // 总页数
    currentSearch: '',       // 当前搜索关键词
    currentSortKey: 'created_at', // 当前排序字段
    currentSortDirection: 'desc', // 当前排序方向
    currentFilter: 'all',    // 当前筛选条件
    selectedRecords: new Set(), // 选中的记录集合
    domElements: {},         // DOM元素缓存
    tableData: [],           // 表格数据
    isLoading: false,        // 加载状态标志
    currentPdfRecord: null,  // 当前查看的PDF记录
    currentScreenshotRecord: null // 当前查看的截图记录
};

/**
 * 初始化页面
 * @async
 * @function initializeMyRecordsPage
 * @returns {Promise<void>}
 * @description 初始化文献记录页面的所有功能，包括DOM元素、事件监听器、数据加载等
 */
async function initializeMyRecordsPage() {
    try {
        console.log("[我的文献] 开始初始化页面...");

        // 初始化DOM元素缓存
        initializeDomElements();

        // 初始化事件监听器
        initializeEventListeners();

        // 加载初始数据
        await loadAndRenderMyRecords();

        // 加载统计数据
        await loadAndRenderStatistics();

        // 加载最近活动
        await loadAndDisplayRecentActivity();

        console.log("[我的文献] 页面初始化完成");
    } catch (error) {
        console.error("[我的文献] 页面初始化失败:", error);
        showStatus("页面初始化失败: " + (error.message || "未知错误"), "text-red-500");
    }
}

/**
 * 初始化DOM元素缓存
 * @function initializeDomElements
 * @description 缓存所有需要的DOM元素，提高访问效率
 */
function initializeDomElements() {
    Object.entries(DOM_IDS).forEach(([key, id]) => {
        state.domElements[key] = document.getElementById(id);
        if (!state.domElements[key]) {
            console.warn(`[我的文献] 未找到DOM元素: ${id}`);
        }
    });
}

/**
 * 初始化事件监听器
 * @function initializeEventListeners
 * @description 为页面上的各种交互元素添加事件监听器
 */
function initializeEventListeners() {
    // 搜索和筛选相关事件
    const searchInput = document.getElementById('myRecordsSearchInput');
    const filterSelect = document.getElementById('myRecordsFilterSelect');

    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            state.currentSearch = searchInput.value.trim();
            state.currentPage = 1;
            loadAndRenderMyRecords();
        }, DEBOUNCE_DELAY));
    }

    if (filterSelect) {
        filterSelect.addEventListener('change', () => {
            state.currentFilter = filterSelect.value;
            state.currentPage = 1;
            loadAndRenderMyRecords();
        });
    }

    // 分页控制相关事件
    const prevPageBtn = document.getElementById('myRecordsPrevPageBtn');
    const nextPageBtn = document.getElementById('myRecordsNextPageBtn');

    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', goToPrevPage);
    }

    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', goToNextPage);
    }

    // 表格排序相关事件
    document.querySelectorAll('.sortable-header').forEach(header => {
        header.addEventListener('click', () => {
            const sortKey = header.dataset.sortKey;
            handleSortRequest(sortKey);
        });
    });

    // 全选/取消全选相关事件
    const selectAllCheckbox = document.getElementById('selectAllRecordsHeaderCheckbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', handleSelectAllChange);
    }

    // 批量操作按钮相关事件
    const deleteSelectedBtn = document.getElementById('deleteSelectedRecordsBtn');
    const exportSelectedBtn = document.getElementById('exportSelectedRecordsBtn');
    const batchDownloadBtn = document.getElementById('batchDownloadSelectedBtn');

    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', handleDeleteSelected);
    }
    if (exportSelectedBtn) {
        exportSelectedBtn.addEventListener('click', handleExportSelected);
    }
    if (batchDownloadBtn) {
        batchDownloadBtn.addEventListener('click', handleBatchDownloadSelected);
    }

    // 初始化截图相关事件监听器
    initializeScreenshotEventListeners();
}

/**
 * 加载并渲染文献记录
 * @async
 * @function loadAndRenderMyRecords
 * @returns {Promise<void>}
 * @description 从服务器加载文献记录数据并渲染到表格中
 */
async function loadAndRenderMyRecords() {
    if (state.isLoading) return;

    try {
        state.isLoading = true;
        showStatus("正在加载文献记录...", "text-blue-500");

        const response = await fetchLiteratureList({
            page: state.currentPage,
            pageSize: PAGE_SIZE,
            search: state.currentSearch,
            sortKey: state.currentSortKey,
            sortDirection: state.currentSortDirection,
            filter: state.currentFilter
        });

        if (response.success) {
            state.tableData = response.data.records;
            state.totalRecords = response.data.total;
            state.totalPages = Math.ceil(state.totalRecords / PAGE_SIZE);

            renderMyRecordsTable();
            updatePaginationControls();
            updateSelectedCountDisplay();
        } else {
            throw new Error(response.message || "加载失败");
        }
    } catch (error) {
        console.error("[我的文献] 加载文献记录失败:", error);
        showStatus("加载文献记录失败: " + (error.message || "未知错误"), "text-red-500");
    } finally {
        state.isLoading = false;
    }
}

/**
 * 渲染文献记录表格
 * @function renderMyRecordsTable
 * @description 将文献记录数据渲染到表格中
 */
function renderMyRecordsTable() {
    const tbody = document.getElementById('myRecordsTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    state.tableData.forEach(record => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50';
        tr.dataset.record = JSON.stringify(record);

        tr.innerHTML = `
            <td class="px-2 py-3 text-center">
                <input type="checkbox" class="record-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                       ${state.selectedRecords.has(record._id) ? 'checked' : ''}>
            </td>
            <td class="px-3 py-3 text-sm text-gray-900">${record.title || '无标题'}</td>
            <td class="px-3 py-3 text-sm text-gray-600">${record.authors || '未知作者'}</td>
            <td class="px-3 py-3 text-sm text-gray-600">${record.year || '未知年份'}</td>
            <td class="px-3 py-3 text-sm text-gray-600">${record.doi || '无DOI'}</td>
            <td class="px-3 py-3 text-sm">
                ${record.pdf_link ? 
                    `<button class="view-pdf-btn text-blue-600 hover:text-blue-800" data-action="view-pdf">
                        <i class="fas fa-file-pdf"></i>
                    </button>` : 
                    '<span class="text-gray-400">无PDF</span>'}
            </td>
            <td class="px-3 py-3 text-sm">
                <span class="status-badge status-badge-${record.status || 'default'}">
                    ${record.status || '未知状态'}
                </span>
            </td>
            <td class="px-3 py-3 text-sm text-right space-x-2">
                <button class="action-btn text-blue-600 hover:text-blue-800" data-action="view-pdf" title="查看PDF">
                    <i class="fas fa-file-pdf"></i>
                </button>
                <button class="action-btn text-purple-600 hover:text-purple-800" data-action="view-screenshots" title="查看截图">
                    <i class="fas fa-images"></i>
                </button>
                <button class="action-btn text-green-600 hover:text-green-800" data-action="editMeta" title="编辑信息">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="action-btn text-red-600 hover:text-red-800" data-action="delete" title="删除">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;

        // 添加事件监听器
        const checkbox = tr.querySelector('.record-checkbox');
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                handleRowSelectionChange(record._id, e.target.checked);
            });
        }

        const actionButtons = tr.querySelectorAll('.action-btn');
        actionButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                handleTableAction(e, record);
            });
        });

        tbody.appendChild(tr);
    });
}

/**
 * 处理表格操作
 * @async
 * @function handleTableAction
 * @param {Event} event - 事件对象
 * @param {Object} record - 文献记录对象
 * @returns {Promise<void>}
 * @description 处理表格中的各种操作，如查看PDF、查看截图、编辑信息、删除等
 */
async function handleTableAction(event, record) {
    const action = event.target.closest('.action-btn').dataset.action;

    try {
        switch (action) {
            case 'view-pdf':
                await openPdfViewerForRecord(record);
                break;
            case 'view-screenshots':
                await openRecordScreenshotsViewer(record);
                break;
            case 'editMeta':
                handleEditMetaAction(record);
                break;
            case 'delete':
                await handleDeleteSingleRecord(record);
                break;
            default:
                console.warn(`[我的文献] 未知操作: ${action}`);
        }
    } catch (error) {
        console.error(`[我的文献] 处理操作 ${action} 失败:`, error);
        showStatus(`操作失败: ${error.message || "未知错误"}`, "text-red-500");
    }
}

/**
 * 打开PDF查看器
 * @async
 * @function openPdfViewerForRecord
 * @param {Object} record - 文献记录对象
 * @returns {Promise<void>}
 * @description 打开PDF查看器并加载指定文献的PDF文件
 */
async function openPdfViewerForRecord(record) {
    if (!state.domElements.pdfViewerModal) {
        console.error("[我的文献/PDF查看器] PDF查看器模态框未找到");
        return;
    }

    try {
        showStatus("正在加载PDF...", "text-blue-500");

        if (state.domElements.pdfViewerTitle) {
            state.domElements.pdfViewerTitle.textContent = record.title || 'PDF查看器';
        }

        state.domElements.pdfViewerModal.classList.remove('hidden');
        state.currentPdfRecord = record;

        await initializePdfJsWorker();

        if (record.pdf_link) {
            try {
                await loadPdfFromUrl(record.pdf_link, PDF_INSTANCE_SUFFIX);
                showStatus("PDF加载成功", "text-green-500", STATUS_DISPLAY_DURATION.SUCCESS);

                await displayScreenshotsForCurrentArticle(record._id);
                initializeSelectionCanvasListeners(PDF_INSTANCE_SUFFIX);
                updateZoomControls(PDF_INSTANCE_SUFFIX);
                updatePdfNavButtons(PDF_INSTANCE_SUFFIX);
            } catch (error) {
                console.error("[我的文献/PDF查看器] PDF加载失败:", error);
                showStatus("PDF加载失败: " + (error.message || "未知错误"), "text-red-500", STATUS_DISPLAY_DURATION.ERROR);
                showPdfPlaceholder("PDF加载失败，请检查链接是否有效", PDF_INSTANCE_SUFFIX);
            }
        } else {
            console.warn("[我的文献/PDF查看器] 文献没有PDF链接:", record);
            showStatus("该文献没有PDF链接", "text-yellow-500", STATUS_DISPLAY_DURATION.WARNING);
            showPdfPlaceholder("该文献没有PDF链接", PDF_INSTANCE_SUFFIX);
        }
    } catch (error) {
        console.error("[我的文献/PDF查看器] 打开PDF查看器时发生错误:", error);
        showStatus("打开PDF查看器失败: " + (error.message || "未知错误"), "text-red-500", STATUS_DISPLAY_DURATION.ERROR);
    }
}

/**
 * 打开文献截图查看器
 * @async
 * @function openRecordScreenshotsViewer
 * @param {Object} record - 文献记录对象
 * @returns {Promise<void>}
 * @description 打开截图查看器并加载指定文献的所有截图
 */
async function openRecordScreenshotsViewer(record) {
    if (!state.domElements.recordScreenshotsViewerModal) {
        console.error("[我的文献/截图] 截图查看器模态框未找到");
        return;
    }

    try {
        showStatus("正在加载截图...", "text-blue-500");

        if (state.domElements.recordScreenshotsViewerArticleTitle) {
            state.domElements.recordScreenshotsViewerArticleTitle.textContent = record.title || '未知文献';
        }

        state.domElements.recordScreenshotsViewerModal.classList.remove('hidden');
        state.currentScreenshotRecord = record;

        const screenshots = await fetchAllMyScreenshotsApi(record._id);
        const container = state.domElements.screenshotsGridContainer;
        const noScreenshotsMessage = state.domElements.noScreenshotsForRecordMessage;

        if (!container) {
            console.error("[我的文献/截图] 截图容器未找到");
            return;
        }

        container.innerHTML = '';

        if (!screenshots || screenshots.length === 0) {
            if (noScreenshotsMessage) {
                noScreenshotsMessage.classList.remove('hidden');
            }
            showStatus("该文献暂无截图", "text-yellow-500", STATUS_DISPLAY_DURATION.WARNING);
            return;
        }

        screenshots.forEach(screenshot => {
            const screenshotCard = createScreenshotCard(screenshot);
            container.appendChild(screenshotCard);
        });

        if (noScreenshotsMessage) {
            noScreenshotsMessage.classList.add('hidden');
        }

        showStatus("截图加载完成", "text-green-500", STATUS_DISPLAY_DURATION.SUCCESS);
    } catch (error) {
        console.error("[我的文献/截图] 加载截图时发生错误:", error);
        showStatus("加载截图失败: " + (error.message || "未知错误"), "text-red-500", STATUS_DISPLAY_DURATION.ERROR);
    }
}

/**
 * 创建截图卡片
 * @function createScreenshotCard
 * @param {Object} screenshot - 截图对象
 * @returns {HTMLElement} 截图卡片元素
 * @description 创建单个截图的展示卡片
 */
function createScreenshotCard(screenshot) {
    const card = document.createElement('div');
    card.className = 'record-screenshot-item bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200';

    card.innerHTML = `
        <div class="relative">
            <img src="${screenshot.image_url}" alt="文献截图" class="w-full h-48 object-contain rounded-t-lg">
            <div class="absolute top-2 right-2 flex space-x-2">
                <button class="edit-screenshot-btn p-1 bg-blue-500 text-white rounded hover:bg-blue-600" 
                        data-screenshot-id="${screenshot._id}" title="编辑截图信息">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="delete-screenshot-btn p-1 bg-red-500 text-white rounded hover:bg-red-600" 
                        data-screenshot-id="${screenshot._id}" title="删除截图">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
        <div class="p-3">
            <p class="text-sm text-gray-600 mb-1">
                <span class="font-medium">类型:</span> ${screenshot.chart_type || '未指定'}
            </p>
            <p class="text-sm text-gray-600 line-clamp-2">
                <span class="font-medium">描述:</span> ${screenshot.description || '无描述'}
            </p>
        </div>
    `;

    const editBtn = card.querySelector('.edit-screenshot-btn');
    const deleteBtn = card.querySelector('.delete-screenshot-btn');

    if (editBtn) {
        editBtn.addEventListener('click', () => handleScreenshotItemClick(screenshot));
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => handleDeleteScreenshot(screenshot._id));
    }

    return card;
}

/**
 * 处理截图项点击事件
 * @async
 * @function handleScreenshotItemClick
 * @param {Object} screenshot - 截图对象
 * @returns {Promise<void>}
 * @description 处理截图卡片的点击事件，打开编辑表单
 */
async function handleScreenshotItemClick(screenshot) {
    try {
        const editForm = state.domElements.screenshotEditForm;
        if (!editForm) {
            console.error("[我的文献/截图] 截图编辑表单未找到");
            return;
        }

        if (state.domElements.screenshotEditChartType) {
            state.domElements.screenshotEditChartType.value = screenshot.chart_type || '';
        }
        if (state.domElements.screenshotEditDescription) {
            state.domElements.screenshotEditDescription.value = screenshot.description || '';
        }

        const editModal = state.domElements.screenshotEditModal;
        if (editModal) {
            editModal.classList.remove('hidden');
        }

        editForm.dataset.screenshotId = screenshot._id;

        const previewImg = state.domElements.screenshotEditPreview;
        if (previewImg) {
            previewImg.src = screenshot.image_url;
            previewImg.alt = "截图预览";
        }
    } catch (error) {
        console.error("[我的文献/截图] 打开截图编辑表单时发生错误:", error);
        showStatus("打开编辑表单失败: " + (error.message || "未知错误"), "text-red-500", STATUS_DISPLAY_DURATION.ERROR);
    }
}

/**
 * 处理截图删除
 * @async
 * @function handleDeleteScreenshot
 * @param {string} screenshotId - 截图ID
 * @returns {Promise<void>}
 * @description 处理截图的删除操作
 */
async function handleDeleteScreenshot(screenshotId) {
    try {
        if (!confirm("确定要删除这张截图吗？此操作不可恢复。")) {
            return;
        }

        showStatus("正在删除截图...", "text-blue-500");

        const response = await deleteScreenshotFromServerApi(screenshotId);

        if (response.success) {
            const screenshotCard = document.querySelector(`[data-screenshot-id="${screenshotId}"]`)?.closest('.record-screenshot-item');
            if (screenshotCard) {
                screenshotCard.remove();
            }

            const container = state.domElements.screenshotsGridContainer;
            if (container && container.children.length === 0) {
                const noScreenshotsMessage = state.domElements.noScreenshotsForRecordMessage;
                if (noScreenshotsMessage) {
                    noScreenshotsMessage.classList.remove('hidden');
                }
            }

            showStatus("截图删除成功", "text-green-500", STATUS_DISPLAY_DURATION.SUCCESS);
        } else {
            throw new Error(response.message || "删除失败");
        }
    } catch (error) {
        console.error("[我的文献/截图] 删除截图时发生错误:", error);
        showStatus("删除截图失败: " + (error.message || "未知错误"), "text-red-500", STATUS_DISPLAY_DURATION.ERROR);
    }
}

/**
 * 处理截图编辑表单提交
 * @async
 * @function handleScreenshotEditSubmit
 * @param {Event} event - 表单提交事件
 * @returns {Promise<void>}
 * @description 处理截图编辑表单的提交操作
 */
async function handleScreenshotEditSubmit(event) {
    event.preventDefault();

    const form = event.target;
    const screenshotId = form.dataset.screenshotId;

    if (!screenshotId) {
        console.error("[我的文献/截图] 未找到截图ID");
        return;
    }

    try {
        showStatus("正在保存截图信息...", "text-blue-500");

        const chartType = state.domElements.screenshotEditChartType?.value || '';
        const description = state.domElements.screenshotEditDescription?.value || '';

        const response = await updateScreenshotMetadataApi(screenshotId, {
            chart_type: chartType,
            description: description
        });

        if (response.success) {
            const screenshotCard = document.querySelector(`[data-screenshot-id="${screenshotId}"]`)?.closest('.record-screenshot-item');
            if (screenshotCard) {
                const typeElement = screenshotCard.querySelector('.text-gray-600:first-child');
                const descElement = screenshotCard.querySelector('.text-gray-600:last-child');

                if (typeElement) {
                    typeElement.innerHTML = `<span class="font-medium">类型:</span> ${chartType || '未指定'}`;
                }
                if (descElement) {
                    descElement.innerHTML = `<span class="font-medium">描述:</span> ${description || '无描述'}`;
                }
            }

            const editModal = state.domElements.screenshotEditModal;
            if (editModal) {
                editModal.classList.add('hidden');
            }

            showStatus("截图信息更新成功", "text-green-500", STATUS_DISPLAY_DURATION.SUCCESS);
        } else {
            throw new Error(response.message || "更新失败");
        }
    } catch (error) {
        console.error("[我的文献/截图] 更新截图信息时发生错误:", error);
        showStatus("更新截图信息失败: " + (error.message || "未知错误"), "text-red-500", STATUS_DISPLAY_DURATION.ERROR);
    }
}

/**
 * 初始化截图相关的事件监听器
 * @function initializeScreenshotEventListeners
 * @description 初始化所有与截图相关的事件监听器
 */
function initializeScreenshotEventListeners() {
    const editForm = state.domElements.screenshotEditForm;
    if (editForm) {
        editForm.addEventListener('submit', handleScreenshotEditSubmit);
    }

    const closeButtons = document.querySelectorAll('[data-close-screenshot-edit-modal]');
    closeButtons.forEach(button => {
        button.addEventListener('click', () => {
            const editModal = state.domElements.screenshotEditModal;
            if (editModal) {
                editModal.classList.add('hidden');
            }
        });
    });

    const cancelButtons = document.querySelectorAll('[data-cancel-screenshot-edit]');
    cancelButtons.forEach(button => {
        button.addEventListener('click', () => {
            const editModal = state.domElements.screenshotEditModal;
            if (editModal) {
                editModal.classList.add('hidden');
            }
        });
    });
}

/**
 * 防抖函数
 * @function debounce
 * @param {Function} func - 要执行的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} 防抖处理后的函数
 * @description 创建一个防抖函数，用于优化频繁触发的事件处理
 */
function debounce(func, wait = DEBOUNCE_DELAY) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * 触发浏览器下载
 * @function triggerBrowserDownload
 * @param {Blob|string} data - 要下载的数据（Blob对象或URL字符串）
 * @param {string} filename - 下载文件的名称
 * @description 处理文件下载，支持Blob和URL两种数据源
 */
function triggerBrowserDownload(data, filename) {
    try {
        let url;
        if (data instanceof Blob) {
            url = URL.createObjectURL(data);
        } else if (typeof data === 'string') {
            url = data;
        } else {
            throw new Error('不支持的数据类型');
        }

        const link = document.createElement('a');
        link.style.display = 'none';
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        if (data instanceof Blob) {
            URL.revokeObjectURL(url);
        }
    } catch (error) {
        console.error('[我的文献/下载] 下载失败:', error);
        showStatus('下载失败: ' + (error.message || '未知错误'), 'text-red-500', STATUS_DISPLAY_DURATION.ERROR);
    }
}

