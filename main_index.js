// js/main_index.js

// ==========================================================================
// 1. IMPORTS - 依赖模块导入
// ==========================================================================
import { checkAuthState, isAuthenticated, setupUserMenu } from './auth.js';
import { API_BASE_URL } from './api_config.js';
import {
    COLUMN_MAPPING,
    LOCAL_STORAGE_KEY_TABLE_DATA,
    DEFAULT_PDF_SCALE,
    MAX_PDF_SCALE,
    MIN_PDF_SCALE,
    PDF_SCALE_INCREMENT,
    THUMBNAIL_MAX_HEIGHT,
    THUMBNAIL_MAX_WIDTH
} from './config.js';
import {
    showStatus,
    closeModal,
    closeModalAndAcceptDisclaimer,
    truncateText,
    sanitizeFilenameForImage,
    findHeader,
    toggleScreenshotsPanelLayout,
    updateToggleScreenshotsPanelButton,
    escapeCsvCell,
    stripHtmlTags
} from './utils.js';
import {
    loadTableDataFromServer,
    saveTableDataToLocalStorage,
    updateTableDataEntry
} from './dataManager.js';
import {
    handleFile,
    downloadUploadTemplate,
    handleLocalPdfFolderSelection
} from './fileProcessing.js';
import {
    initializePdfJsWorker,
    initializeSelectionCanvasListeners,
    onPrevPage,
    onNextPage,
    handlePdfFileSelected,
    updateZoomControls,
    queueRenderPage,
    togglePdfViewerFullscreen,
    updateFullscreenButtonIcon,
    setupGlobalPdfViewerListeners,
    cleanupPdfViewerState,
    showPdfPlaceholder,
    loadPdfFileObjectIntoViewer,
    loadPdfFromUrl
} from './pdfViewerCore.js';
import {
    handleCaptureScreenshot,
    handleSaveScreenshotChanges,
    displayScreenshotsForCurrentArticle,
    handleScreenshotItemClick,
    handleDeleteScreenshot
} from './screenshotManager.js';
import {
    downloadAllAvailablePdfs,
    autoFindAllPdfs,
    handleAutoFindPdfLink // 确保导入此函数，如果表格操作按钮需要直接调用
} from './batchOperations.js';
import {
    showFailedItemsModal,
    applyFiltersAndSort,
    exportTableDataToCSV,
    updateActionButtonsForRow, // uiHandlers 现在只负责创建按钮结构和数据属性
    makeTableResizable,
    handleSort,

} from './uiHandlers.js';
import {
    fetchDashboardStats,
    fetchRecentActivity,
    fetchLiteratureClassificationStats
    // 其他 API 函数由 dataManager 或 batchOperations 内部调用
} from './api.js';

// ==========================================================================
// 2. GLOBAL STATE & CONFIGURATION (Dashboard Specific)
// ==========================================================================
// window.tableData 和 window.displayedTableData 由 dataManager 管理，此处不重复声明，通过 window 访问

window.currentStatusFilter = 'all';
window.currentSortColumn = null;
window.currentSortDirection = 'asc';
window.disclaimerAccepted = localStorage.getItem('disclaimerAccepted_litfinder') === 'true';
window.isScreenshotsPanelVisible = true;

const DASHBOARD_INSTANCE_SUFFIX = ""; // 仪表盘PDF查看器实例的后缀 (通常为空字符串)

// PDF Viewer State (Dashboard Instance)
window[`pdfDoc${DASHBOARD_INSTANCE_SUFFIX}`] = null;
window[`currentPageNum${DASHBOARD_INSTANCE_SUFFIX}`] = 1;
window[`currentPdfScale${DASHBOARD_INSTANCE_SUFFIX}`] = DEFAULT_PDF_SCALE;
window[`currentPdfFileObject${DASHBOARD_INSTANCE_SUFFIX}`] = null;
window[`currentViewingArticleRowId${DASHBOARD_INSTANCE_SUFFIX}`] = null; // 存储当前查看文献的 _id
window[`pageRendering${DASHBOARD_INSTANCE_SUFFIX}`] = false;
window[`pageNumPending${DASHBOARD_INSTANCE_SUFFIX}`] = null;
window[`currentRenderTask${DASHBOARD_INSTANCE_SUFFIX}`] = null;

// Screenshot Selection State (Dashboard Instance)
window[`isSelecting${DASHBOARD_INSTANCE_SUFFIX}`] = false;
window[`selectionRect${DASHBOARD_INSTANCE_SUFFIX}`] = { startX: 0, startY: 0, endX: 0, endY: 0, pageNum: 0, finalX: 0, finalY: 0, finalWidth: 0, finalHeight: 0 };
window[`selectionCtx${DASHBOARD_INSTANCE_SUFFIX}`] = null;

// Cached DOM Elements (initialized in DOMContentLoaded)
let domElements = {};

// ==========================================================================
// 3. HELPER FUNCTIONS (Dashboard Specific)
// ==========================================================================

/**
 * 打开PDF查看器并加载指定文献的PDF（仪表盘实例）。
 * 此函数现在由表格的事件委托处理程序调用。
 * @param {object} articleData - 要查看的文献对象 (来自 window.tableData)。
 * @param {string} instanceSuffix - PDF查看器实例的后缀。
 */
function openPdfViewerForDashboard(articleData, instanceSuffix) {
    if (!articleData || !articleData._id) {
        console.error(`[DashboardViewer] Invalid article data provided for _id:`, articleData);
        showPdfPlaceholder('无法加载PDF：文献数据无效。', instanceSuffix);
        if (domElements.pdfViewerModal) domElements.pdfViewerModal.style.display = 'flex';
        return;
    }

    window[`currentViewingArticleRowId${instanceSuffix}`] = articleData._id; // 设置当前查看的文献 _id

    cleanupPdfViewerState(true, instanceSuffix); // 清理上一个PDF的状态

    if (domElements.pdfViewerTitle) {
        const titleHeader = findHeader(Object.keys(articleData), COLUMN_MAPPING.title || ['title']);
        const actualTitle = articleData[titleHeader] ? String(articleData[titleHeader]).trim() : '未知文献';
        domElements.pdfViewerTitle.textContent = truncateText(actualTitle, 50);
    }

    if (domElements.captureSelectionBtn) domElements.captureSelectionBtn.classList.remove('hidden');

    if (articleData.localPdfFileObject instanceof File) {
        loadPdfFileObjectIntoViewer(articleData.localPdfFileObject, instanceSuffix);
    } else if (articleData.pdfLink) {
        loadPdfFromUrl(articleData.pdfLink, instanceSuffix);
    } else {
        showPdfPlaceholder('此文献没有关联的PDF链接或本地文件。请尝试自动查找或手动添加链接。', instanceSuffix);
        if (domElements.captureSelectionBtn) domElements.captureSelectionBtn.classList.add('hidden');
    }

    if (domElements.pdfViewerModal) domElements.pdfViewerModal.style.display = 'flex';

    // displayScreenshotsForCurrentArticle 将使用 window[`currentViewingArticleRowId${instanceSuffix}`]
    // 从 window.tableData 中获取已包含截图的文献对象
    displayScreenshotsForCurrentArticle(window[`currentViewingArticleRowId${instanceSuffix}`], instanceSuffix);
}

// ==========================================================================
// 4. DASHBOARD DATA LOADING FUNCTIONS
// ==========================================================================
async function loadAndDisplayDashboardStats() {
    try {
        const stats = await fetchDashboardStats();
        if (stats && domElements.statTotalLiterature) { // Check for one critical element
            domElements.statTotalLiterature.textContent = stats.totalLiterature || 0;
            if (domElements.statDownloadedPdfs) domElements.statDownloadedPdfs.textContent = stats.downloadedPdfs || 0;
            if (domElements.statTotalScreenshots) domElements.statTotalScreenshots.textContent = stats.totalScreenshots || 0;
            if (domElements.statStorageUsed) domElements.statStorageUsed.textContent = stats.storageUsed || '0 GB';
            if (domElements.statStorageProgress && typeof stats.storagePercentage === 'number') {
                domElements.statStorageProgress.style.width = `${stats.storagePercentage}%`;
            } else if (domElements.statStorageProgress) { domElements.statStorageProgress.style.width = '0%'; }
            if (domElements.statStoragePercentageText && typeof stats.storagePercentage === 'number') {
                domElements.statStoragePercentageText.textContent = `已使用 ${stats.storagePercentage}%`;
            } else if (domElements.statStoragePercentageText) { domElements.statStoragePercentageText.textContent = '已使用 0%';}
            console.log("[Dashboard] Dashboard stats updated in UI:", stats);
        } else if (stats) {
            console.warn("[Dashboard] Dashboard stat DOM elements not fully found, but stats received:", stats);
        } else {
            console.warn("[Dashboard] Failed to load dashboard stats or stats were null.");
        }
    } catch (error) {
        console.error("[Dashboard] Error loading and displaying dashboard stats:", error);
        if(typeof showStatus === "function") showStatus("加载仪表盘统计数据失败。", "text-red-500");
    }
}

async function loadAndDisplayRecentActivity() {
    if (!domElements.recentActivityList || !domElements.noRecentActivityMessage) {
        console.warn("[Dashboard] Recent activity DOM elements not found.");
        return;
    }
    domElements.recentActivityList.innerHTML = '<p class="text-sm text-gray-500 animate-pulse">正在加载最近活动...</p>';
    domElements.noRecentActivityMessage.classList.add('hidden');

    try {
        const activities = await fetchRecentActivity(); // Default limit is 5
        domElements.recentActivityList.innerHTML = ''; // Clear loading message
        if (activities && activities.length > 0) {
            activities.forEach(activity => {
                const activityItem = document.createElement('div');
                activityItem.className = 'flex items-start space-x-3 p-2 hover:bg-gray-50 rounded-md transition-colors';
                const iconContainer = document.createElement('div');
                iconContainer.className = 'flex-shrink-0 w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mt-0.5';
                const iconElement = document.createElement('i');
                iconElement.className = `${activity.icon_class || "fas fa-info-circle text-gray-500"} text-lg`;
                iconContainer.appendChild(iconElement);
                activityItem.appendChild(iconContainer);

                const textContainer = document.createElement('div');
                textContainer.className = 'flex-1 min-w-0';
                const descriptionElem = document.createElement('h3');
                descriptionElem.className = 'font-medium text-gray-800 text-sm leading-tight';
                descriptionElem.textContent = activity.description; // Assume description is safe
                textContainer.appendChild(descriptionElem);

                const timeElem = document.createElement('p');
                timeElem.className = 'text-xs text-gray-500 mt-0.5';
                let formattedTime = activity.timestamp;
                try {
                    const date = new Date(activity.timestamp);
                    if (!isNaN(date.valueOf())) {
                        formattedTime = date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
                    }
                } catch (e) { /* Use raw timestamp if parsing fails */ }
                timeElem.textContent = formattedTime;
                textContainer.appendChild(timeElem);
                activityItem.appendChild(textContainer);
                domElements.recentActivityList.appendChild(activityItem);
            });
            domElements.noRecentActivityMessage.classList.add('hidden');
        } else {
            domElements.noRecentActivityMessage.textContent = activities === null ? '无法加载最近活动。' : '暂无最近活动。';
            domElements.noRecentActivityMessage.classList.remove('hidden');
        }
    } catch (error) {
        console.error("[Dashboard] Error loading recent activity:", error);
        if (domElements.recentActivityList) domElements.recentActivityList.innerHTML = '';
        if (domElements.noRecentActivityMessage) {
            domElements.noRecentActivityMessage.textContent = '加载最近活动失败。';
            domElements.noRecentActivityMessage.classList.remove('hidden');
        }
        if(typeof showStatus === "function") showStatus("加载最近活动失败。", "text-red-500");
    }
}

async function loadAndDisplayClassificationStats() {
    if (!domElements.classificationDownloadedCount || !domElements.otherStatusesContainer) {
        console.warn("[Dashboard] Classification stats DOM elements not fully found.");
        return;
    }
    console.log("[Dashboard] Attempting to load literature classification stats...");
    domElements.classificationDownloadedCount.textContent = '加载中...';
    if(domElements.classificationDownloadedProgress) domElements.classificationDownloadedProgress.style.width = '0%';
    if(domElements.classificationPendingCount) domElements.classificationPendingCount.textContent = '加载中...';
    if(domElements.classificationPendingProgress) domElements.classificationPendingProgress.style.width = '0%';
    if(domElements.classificationFailedCount) domElements.classificationFailedCount.textContent = '加载中...';
    if(domElements.classificationFailedProgress) domElements.classificationFailedProgress.style.width = '0%';
    domElements.otherStatusesContainer.innerHTML = '';

    try {
        const classificationData = await fetchLiteratureClassificationStats();
        if (classificationData && typeof classificationData === 'object') {
            const total = classificationData.total || 0;
            if(domElements.classificationDownloadedCount) domElements.classificationDownloadedCount.textContent = `${classificationData.downloaded || 0}篇`;
            if(domElements.classificationDownloadedProgress) domElements.classificationDownloadedProgress.style.width = total > 0 ? `${Math.round(((classificationData.downloaded || 0) / total) * 100)}%` : '0%';
            if(domElements.classificationPendingCount) domElements.classificationPendingCount.textContent = `${classificationData.pending || 0}篇`;
            if(domElements.classificationPendingProgress) domElements.classificationPendingProgress.style.width = total > 0 ? `${Math.round(((classificationData.pending || 0) / total) * 100)}%` : '0%';
            if(domElements.classificationFailedCount) domElements.classificationFailedCount.textContent = `${classificationData.failed || 0}篇`;
            if(domElements.classificationFailedProgress) domElements.classificationFailedProgress.style.width = total > 0 ? `${Math.round(((classificationData.failed || 0) / total) * 100)}%` : '0%';

            if (classificationData.statuses && typeof classificationData.statuses === 'object') {
                // ... (渲染详细状态的逻辑，与之前版本相同，确保使用 domElements.otherStatusesContainer)
            }
            console.log("[Dashboard] Literature classification stats updated in UI.");
        } else {
            throw new Error("Invalid classification data format received from server.");
        }
    } catch (error) {
        console.error("[Dashboard] Error loading or displaying classification stats:", error);
        if(typeof showStatus === "function") showStatus(`加载文献分类统计失败: ${error.message || '未知错误'}`, "text-red-500");
        if(domElements.classificationDownloadedCount) domElements.classificationDownloadedCount.textContent = '错误';
    }
}

// ==========================================================================
// 5. DOMContentLoaded - MAIN INITIALIZATION LOGIC
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Dashboard (main_index.js): DOMContentLoaded event fired.");

    // Cache all critical DOM elements
    domElements = {
        statusMessage: document.getElementById('statusMessage'),
        resultsTableBody: document.getElementById('resultsTableBody'),
        resultsSection: document.getElementById('resultsSection'),
        batchActionsSection: document.getElementById('batchActionsSection'),
        noResultsMessage: document.getElementById('noResultsMessage'),
        // PDF Viewer (Dashboard Instance)
        pdfViewerModal: document.getElementById(`pdfViewerModal${DASHBOARD_INSTANCE_SUFFIX}`),
        pdfViewerTitle: document.getElementById(`pdfViewerTitle${DASHBOARD_INSTANCE_SUFFIX}`),
        pdfCanvas: document.getElementById(`pdfCanvas${DASHBOARD_INSTANCE_SUFFIX}`),
        pageNum: document.getElementById(`pageNum${DASHBOARD_INSTANCE_SUFFIX}`),
        pageCount: document.getElementById(`pageCount${DASHBOARD_INSTANCE_SUFFIX}`),
        prevPageBtn: document.getElementById(`prevPageBtn${DASHBOARD_INSTANCE_SUFFIX}`),
        nextPageBtn: document.getElementById(`nextPageBtn${DASHBOARD_INSTANCE_SUFFIX}`),
        zoomOutBtn: document.getElementById(`zoomOutBtn${DASHBOARD_INSTANCE_SUFFIX}`),
        zoomInBtn: document.getElementById(`zoomInBtn${DASHBOARD_INSTANCE_SUFFIX}`),
        zoomLevelSpan: document.getElementById(`zoomLevelSpan${DASHBOARD_INSTANCE_SUFFIX}`),
        selectionCanvas: document.getElementById(`selectionCanvas${DASHBOARD_INSTANCE_SUFFIX}`),
        captureSelectionBtn: document.getElementById(`captureSelectionBtn${DASHBOARD_INSTANCE_SUFFIX}`),
        pdfViewerModalContent: document.getElementById(`pdfViewerModalContent${DASHBOARD_INSTANCE_SUFFIX}`),
        fullscreenBtn: document.getElementById(`fullscreenBtn${DASHBOARD_INSTANCE_SUFFIX}`),
        pdfCanvasContainer: document.getElementById(`pdfCanvasContainer${DASHBOARD_INSTANCE_SUFFIX}`),
        toggleScreenshotsPanelBtn: document.getElementById(`toggleScreenshotsPanelBtn${DASHBOARD_INSTANCE_SUFFIX}`),
        pdfFilePicker: document.getElementById('pdfFilePicker'), // Assuming a single file picker for this page's PDF viewer
        openPdfFileBtn: document.getElementById('openPdfFileBtn'),
        // Edit Screenshot Modal (Dashboard Instance) - assuming one modal, suffix if multiple needed
        editScreenshotModal: document.getElementById('editScreenshotModal'),
        editScreenshotModalTitle: document.getElementById('editScreenshotModalTitle'),
        editSsArticleIdSpan: document.getElementById('editSsArticleId'),
        editSsIdSpan: document.getElementById('editSsId'),
        editSsFilenameSpan: document.getElementById('editSsFilename'),
        editingScreenshotArticleIdInput: document.getElementById('editingScreenshotArticleId'),
        editingScreenshotIdInput: document.getElementById('editingScreenshotId'),
        editSsChartTypeSelect: document.getElementById('editSsChartType'),
        editSsDescriptionTextarea: document.getElementById('editSsDescription'),
        wpdDataTextarea: document.getElementById('wpdDataTextarea'),
        saveEditSsButton: document.getElementById('saveEditSsButton'),
        saveAndResumeFullscreenBtn: document.getElementById('saveAndResumeFullscreenBtn'),
        cancelEditSsButton: document.getElementById('cancelEditSsButton'),
        editScreenshotModalCloseIcon: document.getElementById('editScreenshotModalCloseIcon'),
        // Main Page Controls
        fileInput: document.getElementById('fileInput'),
        processFileButton: document.getElementById('processFileButton'),
        downloadTemplateButton: document.getElementById('downloadTemplateButton'),
        linkLocalPdfsButton: document.getElementById('linkLocalPdfsButton'),
        localPdfFolderPicker: document.getElementById('localPdfFolderPicker'),
        sciHubDomainSelect: document.getElementById('sciHubDomainSelect'),
        customSciHubUrlInput: document.getElementById('customSciHubUrlInput'),
        customSciHubUrlInputContainer: document.getElementById('customSciHubUrlInputContainer'),
        backendApiUrlInput: document.getElementById('backendApiUrlInput'),
        // Batch Action Controls
        downloadAllButton: document.getElementById('downloadAllButton'),
        showFailedButton: document.getElementById('showFailedButton'),
        autoFindAllButton: document.getElementById('autoFindAllButton'),
        exportCsvButton: document.getElementById('exportCsvButton'),
        batchProgressContainer: document.getElementById('batchProgressContainer'),
        batchProgressBar: document.getElementById('batchProgressBar'),
        batchProgressText: document.getElementById('batchProgressText'),
        // Filters and Table
        statusFilterSelect: document.getElementById('statusFilterSelect'),
        resetFiltersButton: document.getElementById('resetFiltersButton'),
        mainResultsTable: document.getElementById('mainResultsTable'),
        // Modals
        disclaimerModal: document.getElementById('disclaimerModal'),
        disclaimerModalCloseButton: document.getElementById('disclaimerModalCloseButton'),
        acceptDisclaimerBtn: document.getElementById('acceptDisclaimerBtn'),
        failedListModal: document.getElementById('failedListModal'),
        failedListModalCloseIcon: document.getElementById('failedListModalCloseIcon'),
        closeFailedListModalFooterBtn: document.getElementById('closeFailedListModalFooterBtn'),
        deleteConfirmModal: document.getElementById('deleteConfirmModal'),
        // Dashboard Stats
        statTotalLiterature: document.getElementById('statTotalLiterature'),
        statDownloadedPdfs: document.getElementById('statDownloadedPdfs'),
        statTotalScreenshots: document.getElementById('statTotalScreenshots'),
        statStorageUsed: document.getElementById('statStorageUsed'),
        statStorageProgress: document.getElementById('statStorageProgress'),
        statStoragePercentageText: document.getElementById('statStoragePercentageText'),
        recentActivityList: document.getElementById('recentActivityList'),
        noRecentActivityMessage: document.getElementById('noRecentActivityMessage'),
        classificationDownloadedCount: document.getElementById('classificationDownloadedCount'),
        classificationDownloadedProgress: document.getElementById('classificationDownloadedProgress'),
        classificationPendingCount: document.getElementById('classificationPendingCount'),
        classificationPendingProgress: document.getElementById('classificationPendingProgress'),
        classificationFailedCount: document.getElementById('classificationFailedCount'),
        classificationFailedProgress: document.getElementById('classificationFailedProgress'),
        otherStatusesContainer: document.getElementById('classificationOtherStatusesContainer'),
        // Screenshot list container within PDF viewer
        screenshotsListContainer: document.getElementById(`screenshotsListContainer${DASHBOARD_INSTANCE_SUFFIX}`),
        noScreenshotsMessageViewer: document.getElementById(`noScreenshotsMessage${DASHBOARD_INSTANCE_SUFFIX}`), // If PDF viewer has its own no screenshot message
        currentArticleScreenshotsViewer: document.getElementById('currentArticleScreenshots'),// The panel itself
        templateInfoIcon: document.getElementById('templateInfoIcon'),
        templateTooltip: document.getElementById('templateTooltip'),
        tooltipContentList: document.getElementById('tooltipContentList'), // 确保这个ID也正确
        linkLocalPdfsInfoIcon: document.getElementById('linkLocalPdfsInfoIcon'), // 关键：确保ID正确
        linkLocalPdfsTooltip: document.getElementById('linkLocalPdfsTooltip'),   // 关键：确保ID正确

    };

    // Initialize selection context
    if (domElements.selectionCanvas && typeof domElements.selectionCanvas.getContext === 'function') {
        window[`selectionCtx${DASHBOARD_INSTANCE_SUFFIX}`] = domElements.selectionCanvas.getContext('2d');
    } else {
        console.warn(`[Dashboard] Element with ID 'selectionCanvas${DASHBOARD_INSTANCE_SUFFIX}' not found or is not a canvas.`);
    }

    // Setup Backend API URL
    const defaultApiUrl = API_BASE_URL || 'http://127.0.0.1:5000';
    if (domElements.backendApiUrlInput) {
        const savedBackendApiUrl = localStorage.getItem('litfinderBackendApiUrl');
        let initialUrlValue = savedBackendApiUrl ? savedBackendApiUrl : (domElements.backendApiUrlInput.value || defaultApiUrl);
        initialUrlValue = stripHtmlTags(initialUrlValue).trim().replace(/\/$/, "");
        domElements.backendApiUrlInput.value = initialUrlValue;
        window.backendBaseUrl = initialUrlValue;

        domElements.backendApiUrlInput.addEventListener('change', function() {
            let changedUrl = stripHtmlTags(this.value).trim().replace(/\/$/, "");
            window.backendBaseUrl = changedUrl;
            localStorage.setItem('litfinderBackendApiUrl', window.backendBaseUrl);
            showStatus('后端API链接已更新并保存。', 'text-blue-500', 3000);
        });
    } else {
        window.backendBaseUrl = defaultApiUrl;
        console.warn("[Dashboard] Backend API URL input element not found. Using default API URL:", window.backendBaseUrl);
    }

    // Page specific logic guard (this script is for app_dashboard.html)
    const currentPageFile = window.location.pathname.split('/').pop() || 'index.html';
    if (currentPageFile !== 'app_dashboard.html') {
        console.log(`[Dashboard] Script loaded on an unexpected page ('${currentPageFile}'). Aborting dashboard-specific initialization.`);
        return;
    }

    // Authentication & Authorization
    checkAuthState(currentPageFile); // Redirects if not authenticated and page requires auth
    if (!isAuthenticated()) {
        console.log("[Dashboard] User not authenticated. Halting further dashboard initialization.");
        // checkAuthState should have redirected. If execution reaches here, it's an anomaly.
        return;
    }

    // If authenticated, proceed with dashboard setup
    console.log("[Dashboard] User is authenticated. Proceeding with dashboard initialization.");
    if (typeof setupUserMenu === "function") setupUserMenu(); // From auth.js, if Navbar doesn't handle it fully

    // Initialize PDF.js worker and global listeners
    initializePdfJsWorker();
    setupGlobalPdfViewerListeners();
    initializeSelectionCanvasListeners(DASHBOARD_INSTANCE_SUFFIX);

    // Modal Event Listeners
    if (domElements.disclaimerModal) {
        domElements.disclaimerModalCloseButton?.addEventListener('click', () => closeModal('disclaimerModal'));
        domElements.acceptDisclaimerBtn?.addEventListener('click', closeModalAndAcceptDisclaimer);
        if (!window.disclaimerAccepted) {
            domElements.disclaimerModal.style.display = 'block';
        }
    }
    if (domElements.failedListModal) {
        domElements.failedListModalCloseIcon?.addEventListener('click', () => closeModal('failedListModal'));
        domElements.closeFailedListModalFooterBtn?.addEventListener('click', () => closeModal('failedListModal'));
    }
    domElements.pdfViewerModal?.querySelector('.close-button')?.addEventListener('click', () => { // More generic close button for PDF modal
        closeModal(`pdfViewerModal${DASHBOARD_INSTANCE_SUFFIX}`);
        cleanupPdfViewerState(true, DASHBOARD_INSTANCE_SUFFIX);
    });
    if (domElements.editScreenshotModal) {
        domElements.editScreenshotModalCloseIcon?.addEventListener('click', () => closeModal('editScreenshotModal'));
        domElements.cancelEditSsButton?.addEventListener('click', () => closeModal('editScreenshotModal'));
        domElements.saveEditSsButton?.addEventListener('click', () => handleSaveScreenshotChanges(false, DASHBOARD_INSTANCE_SUFFIX));
        domElements.saveAndResumeFullscreenBtn?.addEventListener('click', () => handleSaveScreenshotChanges(true, DASHBOARD_INSTANCE_SUFFIX));
    }
    // Delete confirm modal is generic, specific delete actions bind to its confirm button contextually

    // File Processing Event Listeners
    if (domElements.processFileButton && domElements.fileInput) {
        domElements.processFileButton.addEventListener('click', () => {
            if (!window.disclaimerAccepted && domElements.disclaimerModal) {
                alert('请先接受免责声明。');
                domElements.disclaimerModal.style.display = 'block';
                return;
            }
            if (!domElements.fileInput.files || domElements.fileInput.files.length === 0) {
                showStatus('请选择文件。', 'text-red-500', 3000); return;
            }
            handleFile(domElements.fileInput.files[0]);
        });
    }
    domElements.downloadTemplateButton?.addEventListener('click', downloadUploadTemplate);
    if (domElements.linkLocalPdfsButton && domElements.localPdfFolderPicker) {
        domElements.linkLocalPdfsButton.addEventListener('click', () => { domElements.localPdfFolderPicker.value = null; domElements.localPdfFolderPicker.click(); });
        domElements.localPdfFolderPicker.addEventListener('change', (event) => handleLocalPdfFolderSelection(event.target.files));
    }

    // Batch Action Event Listeners
    domElements.downloadAllButton?.addEventListener('click', downloadAllAvailablePdfs);
    domElements.showFailedButton?.addEventListener('click', showFailedItemsModal);
    domElements.autoFindAllButton?.addEventListener('click', autoFindAllPdfs);
    domElements.exportCsvButton?.addEventListener('click', exportTableDataToCSV);

    // Filter and Sort Event Listeners
    if (domElements.statusFilterSelect) {
        domElements.statusFilterSelect.addEventListener('change', function() {
            window.currentStatusFilter = this.value;
            applyFiltersAndSort();
        });
    }
    domElements.resetFiltersButton?.addEventListener('click', () => {
        window.currentStatusFilter = 'all';
        if (domElements.statusFilterSelect) domElements.statusFilterSelect.value = 'all';
        window.currentSortColumn = null; window.currentSortDirection = 'asc';
        applyFiltersAndSort();
        showStatus('筛选排序已重置。', 'text-blue-500', 2000);
    });
    domElements.mainResultsTable?.querySelectorAll('thead th.sortable-header').forEach(th => {
        if (th.dataset.columnKey && !th.getAttribute('data-sort-listener-added')) {
            th.addEventListener('click', () => handleSort(th.dataset.columnKey));
            th.setAttribute('data-sort-listener-added', 'true');
        }
    });

    // Table Action Event Delegation (Replaces direct onclick in uiHandlers.js)
    if (domElements.resultsTableBody) {
        domElements.resultsTableBody.addEventListener('click', (event) => {
            const button = event.target.closest('button[data-action]');
            if (!button) return;

            const rowElement = button.closest('tr');
            if (!rowElement) return;

            const rowId = rowElement.dataset.id;
            const articleData = window.tableData.find(r => r._id === rowId);
            if (!articleData) {
                console.error(`[DashboardTableActions] Article data not found for rowId: ${rowId}`);
                showStatus("操作失败：未找到对应的文献数据。", "text-red-500");
                return;
            }

            const action = button.dataset.action;
            const doi = articleData.doi || (COLUMN_MAPPING.doi && typeof findHeader === 'function' ? articleData[findHeader(Object.keys(articleData), COLUMN_MAPPING.doi)] : null);
            const title = articleData.title || (COLUMN_MAPPING.title && typeof findHeader === 'function' ? articleData[findHeader(Object.keys(articleData), COLUMN_MAPPING.title)] : null);

            switch (action) {
                case 'openSciHub':
                    if (doi && domElements.sciHubDomainSelect) {
                        let url = domElements.sciHubDomainSelect.value;
                        if (url === 'custom' && domElements.customSciHubUrlInput) url = domElements.customSciHubUrlInput.value.trim();
                        if (!url) { alert('请选择或输入有效的Sci-Hub链接。'); return; }
                        if (!url.startsWith('http')) url = 'https://' + url;
                        if (!url.endsWith('/')) url += '/';
                        window.open(url + encodeURIComponent(doi), '_blank');
                        updateTableDataEntry(rowId, 'status', '已搜索');
                    } else if (!doi) {
                        showStatus("此文献无DOI，无法通过Sci-Hub查找。", "text-yellow-500");
                    }
                    break;
                case 'searchWoSCN':
                    // ... (WoS search logic, similar to uiHandlers)
                    break;
                case 'searchXmol':
                    // ... (Xmol search logic)
                    break;
                // ... other external search buttons ...
                case 'openExternalPdf':
                    if (articleData.pdfLink) window.open(articleData.pdfLink, '_blank');
                    else showStatus("此文献没有外部PDF链接。", "text-yellow-500");
                    break;
                case 'viewProcessPdf': // This is the crucial one
                    openPdfViewerForDashboard(articleData, DASHBOARD_INSTANCE_SUFFIX);
                    break;
                case 'autoFindLink':
                    if (doi || title) {
                        button.disabled = true; // Disable button during search
                        handleAutoFindPdfLink(doi, title, rowId).finally(() => {
                            button.disabled = false; // Re-enable after attempt
                        });
                    } else {
                        showStatus("缺少DOI或标题，无法自动查找链接。", "text-yellow-500");
                    }
                    break;
                default:
                    console.warn(`[DashboardTableActions] Unknown action: ${action}`);
            }
        });
    }


    // PDF Viewer Controls (Dashboard Instance)
    domElements.prevPageBtn?.addEventListener('click', () => onPrevPage(DASHBOARD_INSTANCE_SUFFIX));
    domElements.nextPageBtn?.addEventListener('click', () => onNextPage(DASHBOARD_INSTANCE_SUFFIX));
    domElements.zoomInBtn?.addEventListener('click', () => updateZoomControls(DASHBOARD_INSTANCE_SUFFIX, true)); // true for zoom in
    domElements.zoomOutBtn?.addEventListener('click', () => updateZoomControls(DASHBOARD_INSTANCE_SUFFIX, false)); // false for zoom out
    domElements.pdfFilePicker?.addEventListener('change', (event) => handlePdfFileSelected(event, DASHBOARD_INSTANCE_SUFFIX));
    domElements.openPdfFileBtn?.addEventListener('click', () => { if(domElements.pdfFilePicker) { domElements.pdfFilePicker.value = null; domElements.pdfFilePicker.click(); }});
    domElements.captureSelectionBtn?.addEventListener('click', () => handleCaptureScreenshot(DASHBOARD_INSTANCE_SUFFIX));
    domElements.fullscreenBtn?.addEventListener('click', () => togglePdfViewerFullscreen(DASHBOARD_INSTANCE_SUFFIX));
    if (domElements.toggleScreenshotsPanelBtn) {
        domElements.toggleScreenshotsPanelBtn.addEventListener('click', () => {
            window.isScreenshotsPanelVisible = !window.isScreenshotsPanelVisible;
            const panelId = `screenshotsColumn${DASHBOARD_INSTANCE_SUFFIX}`;
            const buttonId = `toggleScreenshotsPanelBtn${DASHBOARD_INSTANCE_SUFFIX}`;
            toggleScreenshotsPanelLayout(panelId, window.isScreenshotsPanelVisible);
            updateToggleScreenshotsPanelButton(buttonId, window.isScreenshotsPanelVisible);
        });
    }

    // Sci-Hub Preferences
    if (domElements.sciHubDomainSelect && domElements.customSciHubUrlInputContainer) {
        // ... (Sci-Hub preference logic, same as before, ensure using domElements)
         domElements.sciHubDomainSelect.addEventListener('change', function() {
            const sel = this.value; localStorage.setItem('litfinderSciHubDomain', sel);
            if (sel === 'custom') {
                domElements.customSciHubUrlInputContainer.style.display = 'block';
                if (domElements.customSciHubUrlInput) domElements.customSciHubUrlInput.focus();
                if (domElements.customSciHubUrlInput && domElements.customSciHubUrlInput.value.trim()) {
                     localStorage.setItem('litfinderSciHubCustomUrl', domElements.customSciHubUrlInput.value.trim());
                }
            } else { domElements.customSciHubUrlInputContainer.style.display = 'none'; }
            showStatus('Sci-Hub偏好已保存。', 'text-blue-500', 3000);
        });
        const savedSciHubDomain = localStorage.getItem('litfinderSciHubDomain');
        const savedSciHubCustomUrl = localStorage.getItem('litfinderSciHubCustomUrl');
        if (savedSciHubDomain) domElements.sciHubDomainSelect.value = savedSciHubDomain;
        if (domElements.sciHubDomainSelect.value === 'custom') {
            domElements.customSciHubUrlInputContainer.style.display = 'block';
            if (domElements.customSciHubUrlInput && savedSciHubCustomUrl) domElements.customSciHubUrlInput.value = savedSciHubCustomUrl;
        } else {
            domElements.customSciHubUrlInputContainer.style.display = 'none';
        }
    }
    if (domElements.customSciHubUrlInput) {
        domElements.customSciHubUrlInput.addEventListener('change', function() {
            if (domElements.sciHubDomainSelect && domElements.sciHubDomainSelect.value === 'custom') {
                localStorage.setItem('litfinderSciHubCustomUrl', this.value.trim());
                showStatus('Sci-Hub自定义链接已保存。', 'text-blue-500', 3000);
            }
        });
    }


    // Tooltip Initializations (if any, example from previous code)
    // ... (Tooltip logic for templateInfoIcon and linkLocalPdfsInfoIcon, ensure using domElements)
    // 模板信息提示工具
    if (domElements.templateInfoIcon && domElements.templateTooltip && domElements.tooltipContentList) {
        let tooltipHTML = '';
        for (const key in COLUMN_MAPPING) {
            if (COLUMN_MAPPING.hasOwnProperty(key)) {
                let displayName = key.charAt(0).toUpperCase() + key.slice(1);
                if (key === 'doi') displayName = 'DOI'; if (key === 'source') displayName = '期刊/来源';
                tooltipHTML += `<div class="mb-1"><strong class="text-gray-900">${displayName}:</strong> ${COLUMN_MAPPING[key].map(name => `<code>${name}</code>`).join(', ')}</div>`;
            }
        }
        domElements.tooltipContentList.innerHTML = tooltipHTML; // Ensure domElements.tooltipContentList is correct
        let tooltipVisible = false; let tooltipTimeout;
        const showTooltipFunc = () => { clearTimeout(tooltipTimeout); domElements.templateTooltip.classList.remove('hidden'); domElements.templateTooltip.classList.add('active'); tooltipVisible = true; };
        const hideTooltipFunc = (imm = false) => { if (imm) { domElements.templateTooltip.classList.add('hidden'); domElements.templateTooltip.classList.remove('active'); tooltipVisible = false; } else { tooltipTimeout = setTimeout(() => { domElements.templateTooltip.classList.add('hidden'); domElements.templateTooltip.classList.remove('active'); tooltipVisible = false; }, 200); } };
        domElements.templateInfoIcon.addEventListener('mouseenter', showTooltipFunc);
        domElements.templateInfoIcon.addEventListener('mouseleave', () => hideTooltipFunc());
        domElements.templateTooltip.addEventListener('mouseenter', () => clearTimeout(tooltipTimeout));
        domElements.templateTooltip.addEventListener('mouseleave', () => hideTooltipFunc());
        domElements.templateInfoIcon.addEventListener('click', (e) => { e.stopPropagation(); tooltipVisible ? hideTooltipFunc(true) : showTooltipFunc(); });
        document.addEventListener('click', (e) => { if (tooltipVisible && domElements.templateTooltip && !domElements.templateTooltip.contains(e.target) && e.target !== domElements.templateInfoIcon) { hideTooltipFunc(true); } });
    }

    // 关联本地PDF信息提示
    if (domElements.linkLocalPdfsInfoIcon && domElements.linkLocalPdfsTooltip) {
        let linkTooltipVisible = false; let linkTooltipTimeout;
        const showLinkTooltip = () => { clearTimeout(linkTooltipTimeout); domElements.linkLocalPdfsTooltip.classList.remove('hidden'); domElements.linkLocalPdfsTooltip.classList.add('active'); linkTooltipVisible = true; };
        const hideLinkTooltip = (imm = false) => { if(imm){domElements.linkLocalPdfsTooltip.classList.add('hidden');domElements.linkLocalPdfsTooltip.classList.remove('active'); linkTooltipVisible = false;}else{linkTooltipTimeout = setTimeout(() => {domElements.linkLocalPdfsTooltip.classList.add('hidden');domElements.linkLocalPdfsTooltip.classList.remove('active');linkTooltipVisible = false;}, 200);}};
        domElements.linkLocalPdfsInfoIcon.addEventListener('mouseenter', showLinkTooltip);
        domElements.linkLocalPdfsInfoIcon.addEventListener('mouseleave', () => hideLinkTooltip());
        domElements.linkLocalPdfsTooltip.addEventListener('mouseenter', () => clearTimeout(linkTooltipTimeout));
        domElements.linkLocalPdfsTooltip.addEventListener('mouseleave', () => hideLinkTooltip());
        domElements.linkLocalPdfsInfoIcon.addEventListener('click', (e) => { e.stopPropagation(); linkTooltipVisible ? hideLinkTooltip(true) : showLinkTooltip(); });
        document.addEventListener('click', (e) => {if(linkTooltipVisible && domElements.linkLocalPdfsTooltip && !domElements.linkLocalPdfsTooltip.contains(e.target) && e.target !== domElements.linkLocalPdfsInfoIcon) hideLinkTooltip(true);});
    }

    // Initial Data Load and UI Setup
    showStatus("正在初始化应用和加载数据...", "text-blue-500", 0); // Persistent until data loaded

    const dataLoadedSuccessfully = await loadTableDataFromServer(); // dataManager.js will load literature & screenshots

    if (dataLoadedSuccessfully) {
        console.log("[Dashboard] Data (literature + screenshots) loaded successfully or from cache.");
        // Dashboard specific stats should be re-fetched or updated based on new tableData if necessary
        await loadAndDisplayDashboardStats();
        await loadAndDisplayRecentActivity();
        await loadAndDisplayClassificationStats();
    } else {
        showStatus("核心数据加载失败。请检查网络或后端服务，然后刷新页面。", "text-red-500", 0); // Persistent error
    }

    // Restore filter state and apply initial sort/filter
    if (domElements.statusFilterSelect) {
        domElements.statusFilterSelect.value = window.currentStatusFilter;
    }
    applyFiltersAndSort();

    // Setup initial PDF viewer UI states
    updateZoomControls(DASHBOARD_INSTANCE_SUFFIX);
    if (domElements.toggleScreenshotsPanelBtn) {
        const panelId = `screenshotsColumn${DASHBOARD_INSTANCE_SUFFIX}`;
        const buttonId = `toggleScreenshotsPanelBtn${DASHBOARD_INSTANCE_SUFFIX}`;

        toggleScreenshotsPanelLayout(panelId, window.isScreenshotsPanelVisible);
        updateToggleScreenshotsPanelButton(buttonId, window.isScreenshotsPanelVisible);
    }

    if (dataLoadedSuccessfully) { // Only show "ready" if data actually loaded
        showStatus("应用准备就绪。", "text-green-500", 3000);
    }
    console.log("[Dashboard] Dashboard application fully initialized.");
});

console.log("main_index.js (Dashboard - Industrial Grade) loaded and DOMContentLoaded listener is set.");