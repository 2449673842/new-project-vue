/// js/my_records_logic.js

// ==========================================================================
// 1. IMPORTS - 依赖模块导入
// ==========================================================================
import { API_BASE_URL as DEFAULT_API_URL } from './api_config.js';
import { Header } from './components/header.js';
import { Navbar } from './components/navbar.js';
import {
    showStatus,
    closeModal,
    truncateText,
    findHeader,
    escapeCsvCell,
    sanitizeFilenameForMatching,
    sanitizeFilenameForImage,
    updateToggleScreenshotsPanelButton,
    toggleScreenshotsPanelLayout,
    stripHtmlTags // 确保已从 utils.js 导出并在此导入
} from './utils.js';
import { handleLocalPdfFolderSelection } from './fileProcessing.js';
import { checkAuthState, isAuthenticated, setupUserMenu, handleLogout } from './auth.js';
import { COLUMN_MAPPING, DEFAULT_PDF_SCALE, MIN_PDF_SCALE, MAX_PDF_SCALE, PDF_SCALE_INCREMENT } from './config.js';
import {
    updateSingleLiteratureArticle,
    batchProcessAndZipApi,
    fetchDashboardStats,
    fetchRecentActivity,
    downloadRecordScreenshotsZipApi,
    saveFullLiteratureList,
    deleteLiteratureArticleApi,
    batchDeleteLiteratureArticlesApi,
    fetchAllMyScreenshotsApi,
    proxyPdfDownloadApi
} from './api.js';
import {
    initializePdfJsWorker as initPdfWorker,
    loadPdfFileObjectIntoViewer,
    loadPdfFromUrl,
    showPdfPlaceholder,
    cleanupPdfViewerState,
    initializeSelectionCanvasListeners,
    onPrevPage as onPdfPrevPage,
    onNextPage as onPdfNextPage,
    handlePdfFileSelected as handleCorePdfFileSelected,
    updateZoomControls as updatePdfZoomControls,
    queueRenderPage as queueCoreRenderPage,
    togglePdfViewerFullscreen as toggleCorePdfFullscreen,
    updateFullscreenButtonIcon as updateCoreFullscreenIcon
} from './pdfViewerCore.js';
import {
    handleCaptureScreenshot,
    handleSaveScreenshotChanges,
    displayScreenshotsForCurrentArticle,
    handleScreenshotItemClick,
    handleDeleteScreenshot
} from './screenshotManager.js';
import {
    loadTableDataFromServer,
    saveTableDataToLocalStorage,
    updateTableDataEntry
} from './dataManager.js';

// ==========================================================================
// 2. PAGE SCOPE VARIABLES & CONFIGURATION
// ==========================================================================
let domElementsMR = {}; // Cached DOM Elements for this page
let rawServerDataCurrentPage = [];
let currentPageMyRecords = 1;
const PAGE_SIZE_MY_RECORDS = 15;
let totalRecordsMyRecords = 0;
let totalPagesMyRecords = 1;
let currentMyRecordsSearch = '';
let currentMyRecordsSortKey = 'created_at';
let currentMyRecordsSortDirection = 'desc';
let currentMyRecordsFilter = 'all';


const PDF_INSTANCE_SUFFIX = "_MyRecords";

window[`pdfDoc${PDF_INSTANCE_SUFFIX}`] = null;
window[`currentPageNum${PDF_INSTANCE_SUFFIX}`] = 1;
window[`currentPdfScale${PDF_INSTANCE_SUFFIX}`] = DEFAULT_PDF_SCALE;
window[`currentPdfFileObject${PDF_INSTANCE_SUFFIX}`] = null;
window[`currentViewingRecordDbId${PDF_INSTANCE_SUFFIX}`] = null;
window[`currentViewingArticleRowId${PDF_INSTANCE_SUFFIX}`] = null;
window[`pageRendering${PDF_INSTANCE_SUFFIX}`] = false;
window[`pageNumPending${PDF_INSTANCE_SUFFIX}`] = null;
window[`currentRenderTask${PDF_INSTANCE_SUFFIX}`] = null;
window[`isSelecting${PDF_INSTANCE_SUFFIX}`] = false;
window[`selectionRect${PDF_INSTANCE_SUFFIX}`] = { startX: 0, startY: 0, endX: 0, endY: 0, pageNum: 0, finalX: 0, finalY: 0, finalWidth: 0, finalHeight: 0 };
window[`selectionCtx${PDF_INSTANCE_SUFFIX}`] = null;
window[`isScreenshotsPanelVisible${PDF_INSTANCE_SUFFIX}`] = true;


// ==========================================================================
// 3. INITIALIZATION
// ==========================================================================
export async function initializeMyRecordsPage() {
    console.log("[MyRecords] Initializing My Records page (Upgraded - ID Unified)...");

    // DOM Element ID Mapping: JS Key -> HTML ID String
    // 【关键】确保这里的JS Key与后续代码中 domElementsMR.key 的使用完全一致
    // 【关键】确保这里的HTML ID String与 my_records.html 中的实际ID完全一致
    const requiredDomIdsMap = {
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
    recordScreenshotsViewerModal: 'recordScreenshotsViewerModal_MyRecords',
    recordScreenshotsViewerArticleTitle: 'recordScreenshotsViewerArticleTitle_MyRecords',
    screenshotsGridContainer: 'screenshotsGridContainer_MyRecords',
    noScreenshotsForRecordMessage: 'noScreenshotsForRecordMessage_MyRecords',
    recordScreenshotsViewerCloseBtn: 'recordScreenshotsViewerCloseBtn_MyRecords',
    recordScreenshotsViewerCloseFooterBtn: 'recordScreenshotsViewerCloseFooterBtn_MyRecords',
    deleteConfirmModal: 'deleteConfirmModal',
    deleteConfirmModalTitle: 'deleteConfirmModalTitle',
    deleteConfirmModalMessage: 'deleteConfirmModalMessage',
    deleteConfirmModalCancelBtn: 'deleteConfirmModalCancelBtn',
    deleteConfirmModalConfirmBtn: 'deleteConfirmModalConfirmBtn',
    deleteConfirmModalCloseIcon: 'deleteConfirmModalCloseIcon',
    pdfViewerModal: 'pdfViewerModal_MyRecords',
    pdfViewerTitle: 'pdfViewerTitle_MyRecords',
    zoomOutBtn: 'zoomOutBtn_MyRecords',
    zoomLevelSpan: 'zoomLevelSpan_MyRecords',
    zoomInBtn: 'zoomInBtn_MyRecords',
    pdfPageInfo: 'pdfPageInfo_MyRecords',
    prevPageBtn: 'prevPageBtn_MyRecords',
    nextPageBtn: 'nextPageBtn_MyRecords',
    pdfFilePicker: 'pdfFilePicker_MyRecords',
    openPdfFileBtn: 'openPdfFileBtn_MyRecords',
    captureSelectionBtn: 'captureSelectionBtn_MyRecords',
    fullscreenBtn: 'fullscreenBtn_MyRecords',
    toggleScreenshotsPanelBtn: 'toggleScreenshotsPanelBtn_MyRecords',
    pdfViewerModalCloseBtn: 'pdfViewerModalCloseBtn_MyRecords',
    pdfViewColumn: 'pdfViewColumn_MyRecords',
    pdfCanvasContainer: 'pdfCanvasContainer_MyRecords',
    pdfCanvas: 'pdfCanvas_MyRecords',
    selectionCanvas: 'selectionCanvas_MyRecords',
    screenshotsColumn: 'screenshotsColumn_MyRecords',
    screenshotsListContainer: 'screenshotsListContainer_MyRecords',
    noScreenshotsMessage: 'noScreenshotsMessage_MyRecords',
    editScreenshotModal: 'editScreenshotModal_MyRecords',
    editScreenshotModalTitle: 'editScreenshotModalTitle_MyRecords',
    editSsArticleId: 'editSsArticleId_MyRecords',
    editSsId: 'editSsId_MyRecords',
    editSsFilename: 'editSsFilename_MyRecords',
    editingScreenshotArticleId: 'editingScreenshotArticleId_MyRecords',
    editingScreenshotId: 'editingScreenshotId_MyRecords',
    editSsChartType: 'editSsChartType_MyRecords',
    editSsDescription: 'editSsDescription_MyRecords',
    wpdDataTextarea: 'wpdDataTextarea_MyRecords',
    cancelEditSsButton: 'cancelEditSsButton_MyRecords',
    saveEditSsButton: 'saveEditSsButton_MyRecords',
    aiFeaturesModal: 'aiFeaturesModal_MyRecords',
    aiFeaturesModalTitle: 'aiFeaturesModalTitle_MyRecords',
    aiFeatureRecordTitle: 'aiFeatureRecordTitle_MyRecords',
    aiAbstractInput: 'aiAbstractInput_MyRecords',
    aiGenerateSummaryBtn: 'aiGenerateSummaryBtn_MyRecords',
    aiGenerateKeywordsBtn: 'aiGenerateKeywordsBtn_MyRecords',
    aiResultContainer: 'aiResultContainer_MyRecords',
    aiLoadingSpinner: 'aiLoadingSpinner_MyRecords',
    aiResultTextarea: 'aiResultTextarea_MyRecords',
    aiFeaturesModalCloseBtn: 'aiFeaturesModalCloseBtn_MyRecords'
};

    let allCriticalElementsFound = true;
    console.log("[MyRecords] Caching DOM elements defined in requiredDomIdsMap...");
for (const jsKeyToUse in requiredDomIdsMap) {
    const htmlIdToFind = requiredDomIdsMap[jsKeyToUse];
    const element = document.getElementById(htmlIdToFind);
    domElementsMR[jsKeyToUse] = element; // 使用map的键名作为domElementsMR的属性名

    if (!element) {
        console.warn(`[MyRecords] DOM CACHING WARNING: Element with HTML ID '<span class="math-inline">\{htmlIdToFind\}' \(intended for domElementsMR\.</span>{jsKeyToUse}) was NOT FOUND.`);
        // 根据元素的重要性决定是否将 allCriticalElementsFound 设为 false
        if (jsKeyToUse === 'myRecordsTableBody' || jsKeyToUse === `selectionCanvas${PDF_INSTANCE_SUFFIX}` || jsKeyToUse === `pdfCanvas${PDF_INSTANCE_SUFFIX}`) {
            allCriticalElementsFound = false;
        }
    }
}
    

    if (!allCriticalElementsFound) {
        const errorMessage = "页面初始化失败：部分核心界面元素缺失，导致功能无法正常运行。请检查HTML文件中的ID是否与JS代码预期一致，或联系技术支持。";
        showStatus(errorMessage, "text-red-500", 0); // Persistent error
        console.error("[MyRecords] CRITICAL FAILURE: One or more essential DOM elements are missing. Aborting further initialization of this page's core functionalities.");
        return; // Stop further page-specific initialization if critical elements are gone
    }
    console.log("[MyRecords] DOM element caching phase complete. Found elements will be used via domElementsMR object.");

    // Specific check for selectionCanvas context
    if (domElementsMR.selectionCanvas && typeof domElementsMR.selectionCanvas.getContext === 'function') {
        window[`selectionCtx${PDF_INSTANCE_SUFFIX}`] = domElementsMR.selectionCanvas.getContext('2d');
        console.log(`[MyRecords] selectionCtx${PDF_INSTANCE_SUFFIX} initialized.`);
    } else {
        console.warn(`[MyRecords] domElementsMR.selectionCanvas (ID: 'selectionCanvas${PDF_INSTANCE_SUFFIX}') is not a valid canvas or was not found. Screenshot selection will be unavailable.`);
    }

    // Setup Backend API URL
    const savedBackendApiUrl = localStorage.getItem('litfinderBackendApiUrl');
    window.backendBaseUrl = savedBackendApiUrl ? savedBackendApiUrl.trim().replace(/\/$/, "") : DEFAULT_API_URL.trim().replace(/\/$/, "");
    if (!window.backendBaseUrl) {
        console.error("[MyRecords] CRITICAL: Backend API URL is not set.");
        showStatus("严重错误：后端服务链接未配置，数据加载将失败。", "text-red-500", 0);
    }
    console.log("[MyRecords] Backend API URL set to:", window.backendBaseUrl);

    // Initialize Header & Navbar
    Header.init('我的记录', true);
    const navbarContainer = document.getElementById('navbar-container');
    if (navbarContainer) {
        const navbar = new Navbar();
        navbar.init(navbarContainer);
        if (isAuthenticated()) setupUserMenu();
    } else {
        console.error("[MyRecords] Navbar container ('navbar-container') not found.");
    }

    // Authentication
    checkAuthState("my_records.html");
    if (!isAuthenticated()) {
        console.log("[MyRecords] User not authenticated. Halting further initialization.");
        return;
    }

    // PDF.js Worker and Listeners
    if (typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc && typeof initPdfWorker === 'function') {
        initPdfWorker();
    }
    if (typeof initializeSelectionCanvasListeners === 'function' && domElementsMR.selectionCanvas) {
        initializeSelectionCanvasListeners(PDF_INSTANCE_SUFFIX);
    } else {
        console.warn("[MyRecords] Could not initialize selection canvas listeners: function or canvas element (domElementsMR.selectionCanvas) missing.");
    }

    bindMyRecordsEventListeners(); // Bind all static event listeners

    // Initial Data Load Sequence
    showStatus("正在准备“我的记录”页面并加载数据...", "text-blue-500", 0);
    try {
        await loadAndRenderMyRecords();     // This will populate window.tableData and render table
        await loadAndRenderStatisticsMR();  // Uses window.tableData or fetches fresh stats
        await loadAndDisplayRecentActivityMR(); // Fetches fresh activity
    } catch (e) {
        console.error("[MyRecords] Error during initial data loading sequence:", e);
        showStatus(`页面初始化时数据加载失败: ${e.message || '请检查网络和控制台日志。'}`, "text-red-500", 0);
    }

    // Final status based on whether table body was successfully populated
    if (domElementsMR.myRecordsTableBody && domElementsMR.myRecordsTableBody.querySelector('tr')) { // Check if rows were added
         if (totalRecordsMyRecords > 0) { // Check if there was actual data
            showStatus("“我的记录”页面已准备就绪。", "text-green-500", 3000);
         } else {
            // Handled by loadAndRenderMyRecords's "No records" message
         }
    } else if (domElementsMR.myRecordsTableBody) {
        // No rows, but table body exists, loadAndRenderMyRecords should show "No records"
    } else {
        // This case should have been caught by allCriticalElementsFound if myRecordsTableBody is critical
        showStatus("无法渲染文献列表，表格结构可能不完整。", "text-red-500", 5000);
    }
    console.log("[MyRecords] Page initialization attempt finished. Review console for detailed status.");
}
/**
 * Binds all static event listeners for the "My Records" page.
 */
function bindMyRecordsEventListeners() {
    domElementsMR.searchInput?.addEventListener('input', debounceMR(() => {
        currentMyRecordsSearch = domElementsMR.searchInput.value.trim();
        currentPageMyRecords = 1; // Reset to first page on new search
        loadAndRenderMyRecords();
    }, 500));

    if (domElementsMR.recordFilterSelect) {
        domElementsMR.recordFilterSelect.value = currentMyRecordsFilter; // Restore previous filter
        domElementsMR.recordFilterSelect.addEventListener('change', () => {
            currentMyRecordsFilter = domElementsMR.recordFilterSelect.value;
            currentPageMyRecords = 1; // Reset to first page on filter change
            loadAndRenderMyRecords();
        });
    }

    domElementsMR.prevPageBtn?.addEventListener('click', goToPrevPageMR);
    domElementsMR.nextPageBtn?.addEventListener('click', goToNextPageMR);

    const sortableHeaders = document.querySelectorAll(`#myRecordsTable thead th.sortable-header[data-sort-key]`);
    sortableHeaders.forEach(th => {
        th.addEventListener('click', () => handleSortRequestMR(th.dataset.sortKey));
    });

    domElementsMR.deleteSelectedRecordsBtn?.addEventListener('click', handleDeleteSelectedRequestMR);
    domElementsMR.exportSelectedRecordsBtn?.addEventListener('click', handleExportSelectedMR);
    domElementsMR.batchDownloadSelectedBtn?.addEventListener('click', handleBatchDownloadSelectedMR);
    domElementsMR.selectAllRecordsHeaderCheckbox?.addEventListener('change', handleSelectAllChangeMR);

    // Event delegation for actions within the dynamically rendered table
    domElementsMR.recordsTableBody?.addEventListener('click', handleTableActionsMR);

    // Quick Action Buttons
    document.getElementById('quickActionImportNew')?.addEventListener('click', () => {
        window.location.href = 'app_dashboard.html#fileInputSection';
    });
    document.getElementById('quickActionManageScreenshots')?.addEventListener('click', () => {
        window.location.href = 'screenshot_manager.html'; // Ensure this page exists and is functional
    });
    document.getElementById('quickActionClearAll')?.addEventListener('click', handleClearAllRecordsRequestMR);

    if (domElementsMR.linkLocalPdfsButton && domElementsMR.localPdfFolderPicker) {
        domElementsMR.linkLocalPdfsButton.addEventListener('click', () => {
            domElementsMR.localPdfFolderPicker.value = null; // Reset picker
            domElementsMR.localPdfFolderPicker.click();
        });
        domElementsMR.localPdfFolderPicker.addEventListener('change', (event) => {
            if (event.target.files.length > 0) {
                handleLocalPdfFolderSelection(event.target.files); // From fileProcessing.js
            }
        });
    }

    // Modal Close Buttons
    domElementsMR.deleteConfirmModalCloseIcon?.addEventListener('click', () => closeModal('deleteConfirmModal'));
    domElementsMR.deleteConfirmModalCancelBtn?.addEventListener('click', () => closeModal('deleteConfirmModal'));
    // Confirm button for delete is bound dynamically in handleDeleteSingle/SelectedRequestMR

    domElementsMR.pdfViewerCloseBtn?.addEventListener('click', () => {
        closeModal(`pdfViewerModal${PDF_INSTANCE_SUFFIX}`);
        cleanupPdfViewerState(true, PDF_INSTANCE_SUFFIX);
    });
    domElementsMR.editScreenshotModalCloseIcon?.addEventListener('click', () => closeModal(`editScreenshotModal${PDF_INSTANCE_SUFFIX}`));
    domElementsMR.cancelEditSsButton?.addEventListener('click', () => closeModal(`editScreenshotModal${PDF_INSTANCE_SUFFIX}`));
    domElementsMR.saveEditSsButton?.addEventListener('click', () => handleSaveScreenshotChanges(false, PDF_INSTANCE_SUFFIX));

    domElementsMR.editLiteratureModalCloseIcon?.addEventListener('click', () => closeModal(`editLiteratureModal${PDF_INSTANCE_SUFFIX}`));
    domElementsMR.cancelEditLitButton?.addEventListener('click', () => closeModal(`editLiteratureModal${PDF_INSTANCE_SUFFIX}`));
    domElementsMR.saveEditLitButton?.addEventListener('click', handleSaveLiteratureChangesMR);

    domElementsMR.recordScreenshotsViewerCloseBtn?.addEventListener('click', () => closeModal(`recordScreenshotsViewerModal${PDF_INSTANCE_SUFFIX}`));
    domElementsMR.recordScreenshotsViewerCloseFooterBtn?.addEventListener('click', () => closeModal(`recordScreenshotsViewerModal${PDF_INSTANCE_SUFFIX}`));

    // PDF Viewer Controls (MyRecords Instance)
    domElementsMR.pdfViewerZoomOutBtn?.addEventListener('click', () => updatePdfZoomControls(PDF_INSTANCE_SUFFIX, false));
    domElementsMR.pdfViewerZoomInBtn?.addEventListener('click', () => updatePdfZoomControls(PDF_INSTANCE_SUFFIX, true));
    domElementsMR.pdfViewerPrevPageBtn?.addEventListener('click', () => onPdfPrevPage(PDF_INSTANCE_SUFFIX));
    domElementsMR.pdfViewerNextPageBtn?.addEventListener('click', () => onPdfNextPage(PDF_INSTANCE_SUFFIX));
    domElementsMR.pdfViewerFilePicker?.addEventListener('change', (event) => handleCorePdfFileSelected(event, PDF_INSTANCE_SUFFIX));
    domElementsMR.pdfViewerOpenFileBtn?.addEventListener('click', () => domElementsMR.pdfViewerFilePicker?.click());
    domElementsMR.pdfViewerFullscreenBtn?.addEventListener('click', () => toggleCorePdfFullscreen(PDF_INSTANCE_SUFFIX));
    domElementsMR.captureSelectionBtn?.addEventListener('click', () => handleCaptureScreenshot(PDF_INSTANCE_SUFFIX));

    if (domElementsMR.pdfViewerToggleScreenshotsPanelBtn) {
        domElementsMR.pdfViewerToggleScreenshotsPanelBtn.addEventListener('click', () => {
            window[`isScreenshotsPanelVisible${PDF_INSTANCE_SUFFIX}`] = !window[`isScreenshotsPanelVisible${PDF_INSTANCE_SUFFIX}`];
            toggleScreenshotsPanelLayout(window[`isScreenshotsPanelVisible${PDF_INSTANCE_SUFFIX}`], false, PDF_INSTANCE_SUFFIX);
            updateToggleScreenshotsPanelButton(window[`isScreenshotsPanelVisible${PDF_INSTANCE_SUFFIX}`], PDF_INSTANCE_SUFFIX);
        });
    }
    console.log("[MyRecords] All static event listeners bound.");
}


// ==========================================================================
// 4. DATA FETCHING AND RENDERING
// ==========================================================================
/**
 * Loads literature records (now leveraging dataManager which pre-populates screenshots)
 * and then applies client-side filtering, sorting, and pagination for display.
 */
async function loadAndRenderMyRecords() {
    if (!domElementsMR.recordsTableBody) {
        console.error("[MyRecords] Records table body element not found. Cannot render.");
        return;
    }
    domElementsMR.recordsTableBody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-gray-500 animate-pulse">正在加载您的文献记录... <i class="fas fa-spinner fa-spin ml-2"></i></td></tr>`;
    showStatus("正在加载您的文献记录...", "text-blue-500", 0); // Persistent message until data is loaded or fails

    try {
        // Step 1: Ensure window.tableData is up-to-date from the server (or local cache if server fails)
        // loadTableDataFromServer from dataManager.js now fetches literature AND their screenshots.
        const dataLoadSuccess = await loadTableDataFromServer(); // Parameter 'forceRefresh' can be added if needed

        if (!dataLoadSuccess && (!window.tableData || window.tableData.length === 0)) {
            // This means server fetch failed AND local storage was empty or also failed.
            throw new Error("无法从服务器或本地缓存加载任何文献数据。请检查网络连接或联系支持。");
        }

        // Step 2: Apply client-side filtering, sorting, and pagination to the global window.tableData
        let processedData = [...window.tableData]; // Work with a copy for processing

        // Filtering
        if (currentMyRecordsSearch) {
            const searchTerm = currentMyRecordsSearch.toLowerCase();
            processedData = processedData.filter(r =>
                (r.title && String(r.title).toLowerCase().includes(searchTerm)) ||
                (r.authors && String(r.authors).toLowerCase().includes(searchTerm)) ||
                (r.doi && String(r.doi).toLowerCase().includes(searchTerm)) ||
                (r.source_publication && String(r.source_publication).toLowerCase().includes(searchTerm)) ||
                (r.source && String(r.source).toLowerCase().includes(searchTerm))
            );
        }
        if (currentMyRecordsFilter !== 'all') {
            processedData = processedData.filter(r => r.status === currentMyRecordsFilter);
        }

        // Sorting
        if (currentMyRecordsSortKey && currentMyRecordsSortDirection) {
             processedData.sort((a, b) => {
                let valA = a[currentMyRecordsSortKey];
                let valB = b[currentMyRecordsSortKey];

                // Handle undefined or null values by treating them as "lesser" or empty strings
                valA = (valA === undefined || valA === null) ? '' : valA;
                valB = (valB === undefined || valB === null) ? '' : valB;

                if (currentMyRecordsSortKey === 'year') {
                    valA = parseInt(valA, 10) || 0; // Default to 0 if not a number
                    valB = parseInt(valB, 10) || 0;
                } else if (typeof valA === 'string') { // Ensure consistent string comparison
                    valA = valA.toLowerCase();
                    valB = String(valB).toLowerCase();
                }
                // For other types, direct comparison might be okay, or add more specific type handling

                if (valA < valB) return currentMyRecordsSortDirection === 'asc' ? -1 : 1;
                if (valA > valB) return currentMyRecordsSortDirection === 'asc' ? 1 : -1;
                return 0;
            });
        }

        totalRecordsMyRecords = processedData.length;
        totalPagesMyRecords = Math.max(1, Math.ceil(totalRecordsMyRecords / PAGE_SIZE_MY_RECORDS)); // Ensure at least 1 page
        currentPageMyRecords = Math.max(1, Math.min(currentPageMyRecords, totalPagesMyRecords)); // Ensure current page is valid

        const startIndex = (currentPageMyRecords - 1) * PAGE_SIZE_MY_RECORDS;
        rawServerDataCurrentPage = processedData.slice(startIndex, startIndex + PAGE_SIZE_MY_RECORDS);

        if (rawServerDataCurrentPage.length === 0 && totalRecordsMyRecords > 0 && currentPageMyRecords > 1) {
            // If current page is empty but there's data, go to last available page (e.g., after deleting all items on last page)
            currentPageMyRecords = totalPagesMyRecords;
            const newStartIndex = (currentPageMyRecords - 1) * PAGE_SIZE_MY_RECORDS;
            rawServerDataCurrentPage = processedData.slice(newStartIndex, newStartIndex + PAGE_SIZE_MY_RECORDS);
        }

        showStatus(`加载了 ${rawServerDataCurrentPage.length} 条记录 (共 ${totalRecordsMyRecords} 条符合筛选)。`, "text-green-500", 3000);

        renderMyRecordsTableDOM(rawServerDataCurrentPage);
        updatePaginationControlsMR();
        updateSelectedCountDisplayMR();

    } catch (e) {
        console.error('[MyRecords] CRITICAL ERROR in loadAndRenderMyRecords:', e);
        showStatus(`加载文献记录时发生严重错误: ${e.message || '未知问题'}`, 'text-red-500', 0);
        if (domElementsMR.recordsTableBody) domElementsMR.recordsTableBody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-red-500"><strong>加载失败!</strong> ${e.message || '请刷新页面或联系技术支持。'}</td></tr>`;
    }
}

/**
 * Renders the actual DOM table for literature records.
 * @param {Array<object>} recordsToDisplay - Data for the current page.
 */
function renderMyRecordsTableDOM(recordsToDisplay) {
    // ... (Implementation from previous response, ensure using domElementsMR for table body)
    // ... Key change: Action buttons only set data-action and data-record-id (using record._id)
    // ... The actual event handling is done by handleTableActionsMR via event delegation.
    if (!domElementsMR.recordsTableBody) {
        console.error("[MyRecords] Table body for records not found during render.");
        return;
    }
    domElementsMR.recordsTableBody.innerHTML = '';

    if (!recordsToDisplay || recordsToDisplay.length === 0) {
        domElementsMR.recordsTableBody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-gray-500">没有符合条件的文献记录。</td></tr>`;
        updateSelectedCountDisplayMR();
        return;
    }

    document.querySelectorAll('#myRecordsTable thead th.sortable-header').forEach(th => {
        const sortKey = th.dataset.sortKey;
        let currentText = th.textContent.replace(/[▲▼\s]*$/g, '').trim();
        th.innerHTML = currentText + (currentMyRecordsSortKey === sortKey ? ` <span class="sort-arrow">${currentMyRecordsSortDirection === 'asc' ? '▲' : '▼'}</span>` : '');
    });

    recordsToDisplay.forEach(record => {
        const tr = document.createElement('tr');
        tr.className = `hover:bg-gray-50 transition-colors ${record.isSelected ? 'bg-blue-100' : ''}`;
        tr.dataset.recordId = record._id; // Store frontend _id for event delegation

        const checkboxTd = document.createElement('td');
        checkboxTd.className = 'px-2 py-3 w-10 text-center';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'record-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500';
        checkbox.value = record._id;
        checkbox.checked = record.isSelected || false;
        // Event listener for individual checkbox changes (not delegation, direct binding ok here)
        checkbox.addEventListener('change', (e) => handleRowSelectionChangeMR(record._id, e.target.checked));
        checkboxTd.appendChild(checkbox);
        tr.appendChild(checkboxTd);

        const title = record.title || 'N/A';
        const authors = record.authors || 'N/A';
        const year = record.year || 'N/A';
        const doi = record.doi || 'N/A';
        const status = record.status || '待处理';
        const pdfLink = record.pdf_link || record.pdfLink || '';
        const source = record.source_publication || record.source || 'N/A';

        const createCell = (content, titleTooltip = '', classes = 'px-3 py-3 text-sm') => {
            const td = document.createElement('td');
            td.className = `${classes} ${!content || content === 'N/A' ? 'text-gray-400' : 'text-gray-700'}`;
            td.textContent = content;
            if (titleTooltip) td.title = titleTooltip;
            return td;
        };

        tr.appendChild(createCell(truncateText(title, 70), title, 'px-3 py-3 text-sm text-gray-700 whitespace-normal break-words max-w-xs'));
        tr.appendChild(createCell(truncateText(authors, 50), authors, 'px-3 py-3 text-sm text-gray-500 whitespace-normal break-words max-w-xs'));
        tr.appendChild(createCell(year, year, 'px-3 py-3 text-sm text-gray-500'));
        tr.appendChild(createCell(truncateText(doi,30), doi, 'px-3 py-3 text-sm text-gray-500 font-mono break-all'));

        const statusTd = document.createElement('td');
        statusTd.className = 'px-3 py-3 text-sm';
        statusTd.innerHTML = `<span class="status-badge status-badge-${String(status).toLowerCase().replace(/[\s/()]+/g, '-')} px-2 inline-flex text-xs leading-5 font-semibold rounded-full">${status}</span>`;
        tr.appendChild(statusTd);

        const pdfLinkTd = document.createElement('td');
        pdfLinkTd.className = 'px-3 py-3 text-sm';
        pdfLinkTd.innerHTML = pdfLink
            ? `<a href="${pdfLink}" target="_blank" class="text-blue-600 hover:underline action-open-pdf-link" title="打开外部PDF链接 (${pdfLink})">${truncateText(pdfLink, 25)}</a>`
            : '<span class="text-gray-400">无链接</span>';
        tr.appendChild(pdfLinkTd);

        const actionsTd = document.createElement('td');
        actionsTd.className = 'px-3 py-3 text-sm space-x-1 whitespace-nowrap';
        actionsTd.innerHTML = `
            <button data-action="viewProcessPdf" title="查看/处理PDF及截图" class="text-indigo-600 hover:text-indigo-800 action-btn p-1"><i class="fas fa-file-pdf"></i></button>
            <button data-action="editMeta" title="编辑文献元数据" class="text-blue-600 hover:text-blue-800 action-btn p-1"><i class="fas fa-edit"></i></button>
            ${(record.db_id || record.id) ? `
                <button data-action="manageScreenshots" title="管理此文献的截图" class="text-green-600 hover:text-green-800 action-btn p-1"><i class="fas fa-images"></i></button>
                <button data-action="downloadScreenshotsZip" title="下载此文献的截图集" class="text-purple-600 hover:text-purple-800 action-btn p-1"><i class="fas fa-camera-retro"></i></button>
            ` : '<span title="记录未与服务器同步，部分操作不可用" class="text-gray-400 p-1"><i class="fas fa-exclamation-circle"></i></span>'}
            <button data-action="deleteRecord" title="删除此记录" class="text-red-600 hover:text-red-800 action-btn p-1"><i class="fas fa-trash-alt"></i></button>
        `; // Added a placeholder if db_id is missing for some server-dependent actions
        tr.appendChild(actionsTd);
        domElementsMR.recordsTableBody.appendChild(tr);
    });

    if (domElementsMR.selectAllRecordsHeaderCheckbox) {
       domElementsMR.selectAllRecordsHeaderCheckbox.checked = false;
       domElementsMR.selectAllRecordsHeaderCheckbox.indeterminate = false;
    }
    updateSelectedCountDisplayMR();
}

// ==========================================================================
// 5. EVENT HANDLERS & UI LOGIC
// ==========================================================================
// --- Pagination, Sorting, Selection ---
function goToPrevPageMR() {
    if (currentPageMyRecords > 1) {
        currentPageMyRecords--;
        // Since data is already loaded in window.tableData, we just re-slice and re-render
        const startIndex = (currentPageMyRecords - 1) * PAGE_SIZE_MY_RECORDS;
        const dataToSortAndFilter = [...window.tableData]; // Apply filters and sort again if needed or just use pre-processed
        // Re-apply filter and sort before slicing for pagination (if not relying on backend for all)
        let processedData = [...window.tableData];
        if (currentMyRecordsSearch) { /* apply search */ }
        if (currentMyRecordsFilter !== 'all') { /* apply filter */ }
        if (currentMyRecordsSortKey) { /* apply sort */ }
        // Then slice:
        rawServerDataCurrentPage = processedData.slice(startIndex, startIndex + PAGE_SIZE_MY_RECORDS);

        renderMyRecordsTableDOM(rawServerDataCurrentPage);
        updatePaginationControlsMR();
    }
}

function goToNextPageMR() {
    if (currentPageMyRecords < totalPagesMyRecords) {
        currentPageMyRecords++;
        // Similar to goToPrevPageMR, re-slice and re-render from potentially re-processed window.tableData
        const startIndex = (currentPageMyRecords - 1) * PAGE_SIZE_MY_RECORDS;
        let processedData = [...window.tableData]; // Placeholder for full filter/sort logic
        rawServerDataCurrentPage = processedData.slice(startIndex, startIndex + PAGE_SIZE_MY_RECORDS);

        renderMyRecordsTableDOM(rawServerDataCurrentPage);
        updatePaginationControlsMR();
    }
}

function handleSortRequestMR(sortKey) {
    if (!sortKey) return;
    if (currentMyRecordsSortKey === sortKey) {
        currentMyRecordsSortDirection = currentMyRecordsSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentMyRecordsSortKey = sortKey;
        currentMyRecordsSortDirection = 'asc'; // Default to ascending on new column sort
    }
    currentPageMyRecords = 1; // Reset to first page on sort
    loadAndRenderMyRecords(); // Re-load and re-render will apply new sort (client or server-side)
}

function handleRowSelectionChangeMR(recordFrontendId, isChecked) {
    const recordInAllData = window.tableData.find(r => r._id === recordFrontendId);
    if (recordInAllData) {
        recordInAllData.isSelected = isChecked;
    }
    // Also update in rawServerDataCurrentPage if the record is present there, for immediate UI reflection if needed
    const recordInPage = rawServerDataCurrentPage.find(r => r._id === recordFrontendId);
    if (recordInPage) {
        recordInPage.isSelected = isChecked;
    }
    saveTableDataToLocalStorage(); // Save selection state if it's considered persistent across sessions
    updateSelectedCountDisplayMR();
}

function handleSelectAllChangeMR(event) {
    const isChecked = event.target.checked;
    // Update all records currently visible in the table (rawServerDataCurrentPage)
    rawServerDataCurrentPage.forEach(recordInView => {
        recordInView.isSelected = isChecked;
        // Find and update the same record in the master list (window.tableData)
        const masterRecord = window.tableData.find(r => r._id === recordInView._id);
        if (masterRecord) {
            masterRecord.isSelected = isChecked;
        }
    });
    renderMyRecordsTableDOM(rawServerDataCurrentPage); // Re-render to update checkbox states in DOM
    updateSelectedCountDisplayMR();
    saveTableDataToLocalStorage(); // Persist changes
}

function updateSelectedCountDisplayMR() {
    const selectedCount = (window.tableData || []).filter(r => r.isSelected).length;
    if (domElementsMR.selectedRecordsCountDisplay) {
        domElementsMR.selectedRecordsCountDisplay.textContent = selectedCount;
    }
    const showBatchButtons = selectedCount > 0;
    domElementsMR.deleteSelectedRecordsBtn?.classList.toggle('hidden', !showBatchButtons);
    domElementsMR.exportSelectedRecordsBtn?.classList.toggle('hidden', !showBatchButtons);
    domElementsMR.batchDownloadSelectedBtn?.classList.toggle('hidden', !showBatchButtons);

    if (domElementsMR.selectAllRecordsHeaderCheckbox) {
        const totalVisibleOnPage = (rawServerDataCurrentPage || []).length;
        if (totalVisibleOnPage === 0) {
            domElementsMR.selectAllRecordsHeaderCheckbox.checked = false;
            domElementsMR.selectAllRecordsHeaderCheckbox.indeterminate = false;
        } else {
            const selectedOnCurrentPage = (rawServerDataCurrentPage || []).filter(r => r.isSelected).length;
            domElementsMR.selectAllRecordsHeaderCheckbox.checked = selectedOnCurrentPage === totalVisibleOnPage;
            domElementsMR.selectAllRecordsHeaderCheckbox.indeterminate = selectedOnCurrentPage > 0 && selectedOnCurrentPage < totalVisibleOnPage;
        }
    }
}

function updatePaginationControlsMR() {
    if (domElementsMR.currentPageDisp) domElementsMR.currentPageDisp.textContent = totalRecordsMyRecords > 0 ? currentPageMyRecords : 0;
    if (domElementsMR.totalPagesDisp) domElementsMR.totalPagesDisp.textContent = totalPagesMyRecords;
    if (domElementsMR.totalRecordsDisp) domElementsMR.totalRecordsDisp.textContent = totalRecordsMyRecords;
    if (domElementsMR.prevPageBtn) domElementsMR.prevPageBtn.disabled = currentPageMyRecords <= 1;
    if (domElementsMR.nextPageBtn) domElementsMR.nextPageBtn.disabled = currentPageMyRecords >= totalPagesMyRecords;
}

/**
* 处理表格行内操作按钮的点击事件（通过事件委托）。
 * @param {Event} event - 点击事件对象。
 */
async function handleTableActionsMR(event) {
    const targetButton = event.target.closest('button.action-btn[data-action]');
    if (!targetButton) {
        return; // 不是我们关心的按钮点击，提前退出
    }

    // 在操作开始时禁用按钮，防止重复点击
    targetButton.disabled = true;

    const action = targetButton.dataset.action;
    const tr = targetButton.closest('tr');

    if (!tr) {
        console.warn("[MyRecords/TableActions] Could not find parent <tr> for action button.");
        targetButton.disabled = false; // 恢复按钮
        return;
    }

    const recordFrontendId = tr.dataset.recordId; // 获取存储在行上的前端 _id
    if (!recordFrontendId) {
        console.warn("[MyRecords/TableActions] Missing 'data-record-id' on table row.");
        if (typeof showStatus === "function") showStatus("操作失败：无法识别文献记录。", "text-red-500");
        targetButton.disabled = false;
        return;
    }

    const record = window.tableData.find(r => r._id === recordFrontendId);

    if (!record) {
        if (typeof showStatus === "function") showStatus("操作失败：未能在数据中找到对应的文献记录。", "text-red-500");
        console.error(`[MyRecords/TableActions] Record not found for frontend ID: ${recordFrontendId} in window.tableData`);
        targetButton.disabled = false;
        return;
    }

    // 从 record 对象中安全地获取字段值
    // 依赖 COLUMN_MAPPING 和 findHeader 已被正确导入并在全局/模块作用域可用
    const doi = record.doi || (COLUMN_MAPPING?.doi && typeof findHeader === 'function' ? record[findHeader(Object.keys(record), COLUMN_MAPPING.doi)] : null);
    const title = record.title || (COLUMN_MAPPING?.title && typeof findHeader === 'function' ? record[findHeader(Object.keys(record), COLUMN_MAPPING.title)] : '未知标题');
    const recordDbId = record.db_id || record.id; // 后端数据库ID

    console.log(`[MyRecords/TableActions] Action '${action}' triggered for record _id: ${recordFrontendId}, db_id: ${recordDbId}`);

    try {
        switch (action) {
            case "viewProcessPdf":
                // openPdfViewerForRecordMR 内部应处理其错误和DOM元素检查
                openPdfViewerForRecordMR(record);
                break;
            case "editMeta":
                // handleEditMetaActionMR 内部应处理其错误和DOM元素检查
                handleEditMetaActionMR(record);
                break;
            case "manageScreenshots":
                if (!recordDbId && !recordFrontendId) {
                    if (typeof showStatus === "function") showStatus("无法管理截图：文献记录缺少有效ID。", "text-red-500");
                    break;
                }
                // openRecordScreenshotsViewerModal 内部应处理其错误和DOM元素检查
                openRecordScreenshotsViewerModal(record);
                break;
            case "downloadScreenshotsZip":
                if (!recordDbId) {
                    if (typeof showStatus === "function") showStatus("此文献记录缺少数据库ID，无法下载截图集。", "text-yellow-500");
                    break;
                }
                if (typeof showStatus === "function") showStatus(`准备下载文献 "${truncateText(title, 30)}" 的截图集...`, 'text-blue-500', 0);

                const blob = await downloadRecordScreenshotsZipApi(recordDbId); // API 调用

                if (blob && blob instanceof Blob) {
                    const filename = `${sanitizeFilenameForImage(title || `article_${recordDbId}`)}_screenshots.zip`;
                    // 假设 utils.js 中导出了 triggerBrowserDownload (或者使用下面的fallback)
                    if (typeof triggerBrowserDownload === "function") { //  确保 triggerBrowserDownload 函数存在
                        triggerBrowserDownload(blob, filename);
                    } else {
                        console.warn("[MyRecords/TableActions] triggerBrowserDownload function not found in utils.js. Using fallback download method.");
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = url;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                    }
                    if (typeof showStatus === "function") showStatus(`截图集 "${filename}" 已开始下载。`, 'text-green-500', 5000);
                } else {
                    console.error("[MyRecords/TableActions] downloadRecordScreenshotsZipApi did not return a valid Blob object.");
                    if (typeof showStatus === "function") showStatus(`下载截图集失败：服务器未返回有效的文件数据。`, 'text-red-500', 5000);
                }
                break;
            case "deleteRecord":
                // handleDeleteSingleRecordRequestMR 是 async 并且会处理自己的 showStatus 和 UI 更新
                await handleDeleteSingleRecordRequestMR(record);
                break;
            default:
                console.warn(`[MyRecords/TableActions] Unknown action encountered: '${action}'`);
                if (typeof showStatus === "function") showStatus(`未知的操作指令: ${action}`, "text-yellow-500");
        }
    } catch (error) {
        // 这个catch块主要捕获 await 调用的函数（如 downloadRecordScreenshotsZipApi）中未被捕获并重新抛出的错误，
        // 或者是在此switch语句内部直接发生的同步错误。
        console.error(`[MyRecords/TableActions] Error handling action '${action}' for record _id ${recordFrontendId}:`, error);
        if (typeof showStatus === "function") showStatus(`执行操作 "${action}" 时发生严重错误: ${error.message || '未知服务器或客户端错误'}`, 'text-red-500');
    } finally {
        // 确保在所有操作（包括出错）后恢复按钮状态
        targetButton.disabled = false;
    }
}
/**
 * 打开编辑文献元数据的模态框并填充数据。
 * @param {object} record - 要编辑的文献对象 (应包含 ._id, .db_id, .title 等属性)。
 */
// 替换 my_records_logic.js中的 handleEditMetaActionMR 函数
f// 替换 my_records_logic.js中的 handleEditMetaActionMR 函数
f// In my_records_logic.js, replace the existing handleEditMetaActionMR function
function handleEditMetaActionMR(record) {
    const functionName = "[MyRecords/EditMeta]";

    // Keys to check in domElementsMR, these must match the keys in requiredDomIdsMap
    const requiredKeys = [
        'editLiteratureModal',
        'editLiteratureModalTitle',
        'editingLiteratureDbId',
        'editLitTitle',
        'editLitAuthors',
        'editLitYear',
        'editLitDoi',
        'editLitPdfLink',
        'editLitStatus',
        'editLitSource',
        // Note: Button elements (save, cancel, close icon) are typically handled by
        // event listeners set up in bindMyRecordsEventListeners.
        // This check focuses on the modal container and its form fields.
    ];

    for (const key of requiredKeys) {
        if (!domElementsMR[key]) {
            const htmlId = requiredDomIdsMap[key] || `(HTML ID for ${key} not specified in requiredDomIdsMap)`;
            console.error(`${functionName} CRITICAL: DOM element for key 'domElementsMR.${key}' (expected HTML ID: '${htmlId}') was not found or not cached. Cannot open edit modal.`);
            if (typeof showStatus === "function") showStatus("编辑功能初始化失败：界面关键元素缺失，请联系管理员。", "text-red-500", 0);
            return;
        }
    }

    if (!record || typeof record._id === 'undefined') { // Check if record and record._id exist
        console.error(`${functionName} Invalid 'record' object or missing '_id'. Record:`, record);
        if (typeof showStatus === "function") showStatus("无法编辑：选择的文献记录数据无效。", "text-red-500");
        return;
    }

    const recordDbId = record.db_id || record.id;
    // It's okay if recordDbId is null/undefined if the record hasn't been synced with the server yet.
    // The UI should ideally handle this (e.g., by not allowing saving to server or by creating a new record on save).

    console.log(`${functionName} Opening edit modal for record _id: ${record._id}, db_id: ${recordDbId}`);

    // Populate the modal form fields using the cached DOM elements
    domElementsMR.editingLiteratureDbId.value = recordDbId || ''; // hidden input for DB ID
    domElementsMR.editLitTitle.value = record.title || '';
    domElementsMR.editLitAuthors.value = record.authors || '';
    domElementsMR.editLitYear.value = record.year || '';
    domElementsMR.editLitDoi.value = record.doi || '';
    domElementsMR.editLitPdfLink.value = record.pdf_link || record.pdfLink || ''; // Handles both possible property names
    domElementsMR.editLitStatus.value = record.status || '待处理';
    domElementsMR.editLitSource.value = record.source_publication || record.source || ''; // Handles both possible property names

    const displayTitle = record.title ? truncateText(record.title, 30) : '无标题文献';
    domElementsMR.editLiteratureModalTitle.textContent = `编辑文献: ${displayTitle}`;

    // Display the modal
    domElementsMR.editLiteratureModal.style.display = 'flex';
    if (typeof showStatus === "function") showStatus("请编辑文献信息。", "text-blue-500", 3000);
}

// 替换 my_records_logic.js中的 handleSaveLiteratureChangesMR 函数

/**
 * 处理保存文献元数据更改的逻辑。
 * 从编辑模态框获取数据，调用API更新，然后更新本地数据和UI。
 */
async function handleSaveLiteratureChangesMR() {
    const functionName = "[MyRecords/SaveLitChanges]";

    // 1. 检查并获取关键的模态框表单元素是否已缓存 (使用 domElementsMR.键名)
    // 这些键名应与 requiredDomIdsMap 中的键名一致
    const requiredFormElementKeys = [
        'editingLiteratureDbId',
        'editLitTitle',
        'editLitAuthors',
        'editLitYear',
        'editLitDoi',
        'editLitPdfLink',
        'editLitStatus',
        'editLitSource'
    ];

    for (const key of requiredFormElementKeys) {
        if (!domElementsMR[key]) {
            const expectedHtmlId = requiredDomIdsMap[key] || `(ID for key '${key}' not in requiredDomIdsMap)`;
            console.error(`${functionName} CRITICAL: Form element for key 'domElementsMR.${key}' (expected HTML ID: '${expectedHtmlId}') not found or not cached. Cannot save changes.`);
            if (typeof showStatus === "function") showStatus("保存失败：编辑表单的关键元素缺失，请联系管理员。", "text-red-500", 0);
            return;
        }
    }

    // 2. 从表单元素中获取数据 (使用 domElementsMR.键名)
    const dbId = domElementsMR.editingLiteratureDbId.value;
    if (!dbId) {
        if (typeof showStatus === "function") showStatus("保存失败：文献的数据库ID丢失，无法确定要更新的记录。", "text-red-500", 5000);
        console.error(`${functionName} Cannot save: editingLiteratureDbId input has no value.`);
        return;
    }

    const updates = {
        title: domElementsMR.editLitTitle.value.trim(),
        authors: domElementsMR.editLitAuthors.value.trim(),
        year: domElementsMR.editLitYear.value ? (parseInt(domElementsMR.editLitYear.value, 10) || null) : null,
        doi: domElementsMR.editLitDoi.value.trim(),
        pdf_link: domElementsMR.editLitPdfLink.value.trim(),
        status: domElementsMR.editLitStatus.value,
        source_publication: domElementsMR.editLitSource.value.trim()
    };

    // 检查是否有实际更改 (这部分逻辑保持不变)
    const originalRecordIndex = window.tableData.findIndex(r => String(r.db_id || r.id) === String(dbId));
    let hasChanges = false;
    if (originalRecordIndex > -1) {
        const originalRecord = window.tableData[originalRecordIndex];
        for (const key in updates) {
            const frontendKey = (key === 'pdf_link') ? 'pdfLink' : ((key === 'source_publication') ? 'source' : key);
            if (updates[key] !== (originalRecord[frontendKey] || originalRecord[key] || '')) {
                 if (!(updates[key] === null && (originalRecord[frontendKey] === '' || originalRecord[frontendKey] === null || typeof originalRecord[frontendKey] === 'undefined'))) {
                    hasChanges = true;
                    break;
                 }
            }
        }
        if (!hasChanges && String(originalRecord.status) === updates.status) {
             if (typeof showStatus === "function") showStatus("信息未发生变化，无需保存。", "text-yellow-500", 3000);
             closeModal('editLiteratureModal_MyRecords'); // 关闭时使用HTML ID
             return;
        }
    }


    if (typeof showStatus === "function") showStatus("正在保存文献更改，请稍候...", "text-blue-500", 0);

    try {
        // 3. 调用API更新文献信息
        const success = await updateSingleLiteratureArticle(dbId, updates);

        if (success) {
            // 4. 更新前端数据 (这部分逻辑保持不变)
            if (originalRecordIndex > -1) {
                window.tableData[originalRecordIndex] = {
                    ...window.tableData[originalRecordIndex],
                    title: updates.title,
                    authors: updates.authors,
                    year: updates.year,
                    doi: updates.doi,
                    pdfLink: updates.pdf_link,
                    status: updates.status,
                    source: updates.source_publication,
                };
            } else {
                console.warn(`${functionName} Record with db_id ${dbId} not found in window.tableData after successful API update.`);
            }

            saveTableDataToLocalStorage();
            if (typeof showStatus === "function") showStatus("文献信息已成功更新！正在刷新列表...", "text-green-500", 3000);
            closeModal('editLiteratureModal_MyRecords'); // 关闭时使用HTML ID

            // 5. 刷新UI
            await loadAndRenderMyRecords();
            if (typeof loadAndRenderStatisticsMR === "function") {
                 await loadAndRenderStatisticsMR();
            }
        } else {
            if (typeof showStatus === "function") showStatus("保存文献更改失败。服务器未能成功处理请求。", "text-red-500", 5000);
        }
    } catch (error) {
        console.error(`${functionName} Error saving literature changes for db_id ${dbId}:`, error);
        if (typeof showStatus === "function") showStatus(`保存文献更改时发生严重错误: ${error.message || '未知问题'}`, "text-red-500", 5000);
    }
}


/**
 * 打开特定文献的截图管理模态框。
 * 会获取该文献最新的截图数据，更新全局数据模型，并渲染截图列表。
 * @param {object} record - 要为其显示截图的文献对象 (应包含 ._id, .title 等属性)。
 */
// In my_records_logic.js, replace the existing openRecordScreenshotsViewerModal function
async function openRecordScreenshotsViewerModal(record) {
    const functionName = "[MyRecords/ScreenshotsViewer]";

    const requiredKeys = [
        'recordScreenshotsViewerModal',
        'recordScreenshotsViewerArticleTitle',
        'screenshotsGridContainer',
        'noScreenshotsForRecordMessage'
    ];

    for (const key of requiredKeys) {
        if (!domElementsMR[key]) {
            const htmlId = requiredDomIdsMap[key] || `(HTML ID for ${key} not specified in requiredDomIdsMap)`;
            console.error(`${functionName} CRITICAL: DOM element for key 'domElementsMR.${key}' (expected HTML ID: '${htmlId}') was not found or not cached. Cannot open screenshots viewer.`);
            if (typeof showStatus === "function") showStatus("截图管理界面初始化失败：关键界面元素缺失。", "text-red-500", 0);
            return;
        }
    }

    if (!record || typeof record._id === 'undefined') {
        console.error(`${functionName} Invalid 'record' object or missing '_id'. Record:`, record);
        if (typeof showStatus === "function") showStatus("无法管理截图：选择的文献记录数据无效。", "text-red-500");
        return;
    }
    const recordFrontendId = String(record._id); // Ensure it's a string for consistency if used in API calls as param

    console.log(`${functionName} Opening for record _id: ${recordFrontendId}, Title: "${record.title || 'N/A'}"`);

    domElementsMR.recordScreenshotsViewerArticleTitle.textContent = truncateText(record.title || '无标题文献', 70);
    domElementsMR.screenshotsGridContainer.innerHTML = `<p class="text-gray-500 col-span-full text-center py-4 animate-pulse">正在加载文献 "${truncateText(record.title, 20)}" 的截图...</p>`;
    domElementsMR.noScreenshotsForRecordMessage.classList.add('hidden'); // Hide initially
    domElementsMR.recordScreenshotsViewerModal.style.display = 'flex'; // Show the modal

    if (typeof showStatus === "function") showStatus(`正在加载 "${truncateText(record.title, 25)}" 的截图列表...`, 'text-blue-500', 0);

    try {
        // fetchAllMyScreenshotsApi expects the frontend_article_id
        const freshScreenshots = await fetchAllMyScreenshotsApi(recordFrontendId);

        const articleIndex = window.tableData.findIndex(r => String(r._id) === recordFrontendId);
        if (articleIndex > -1) {
            window.tableData[articleIndex].screenshots = freshScreenshots || []; // Update local data
            saveTableDataToLocalStorage(); // Persist
            console.log(`${functionName} Updated screenshots in window.tableData for article _id ${recordFrontendId}. Count: ${freshScreenshots ? freshScreenshots.length : 0}`);
        } else {
            console.warn(`${functionName} Could not find article _id ${recordFrontendId} in window.tableData to update its screenshots. This might indicate a data consistency issue.`);
        }

        domElementsMR.screenshotsGridContainer.innerHTML = ''; // Clear loading message
        if (freshScreenshots && freshScreenshots.length > 0) {
            freshScreenshots.forEach(screenshot => {
                const screenshotCard = document.createElement('div');
                screenshotCard.className = 'record-screenshot-item border p-3 rounded-lg shadow-sm bg-gray-50 flex flex-col items-center justify-between space-y-2';
                // Ensure screenshotId is unique and suitable for dataset attribute
                const screenshotId = String(screenshot.id || screenshot.serverMetadataPath || `temp-ss-${Date.now()}-${Math.random().toString(36).substr(2,5)}`);
                screenshotCard.dataset.screenshotId = screenshotId;

                const imgElement = document.createElement('img');
                let imageUrl = screenshot.thumbnailDataUrl;
                if (!imageUrl && screenshot.image_server_path && window.backendBaseUrl) {
                    imageUrl = `${window.backendBaseUrl}/api/download_screenshot_image?path=${encodeURIComponent(screenshot.image_server_path)}`;
                } else if (!imageUrl) {
                    // Provide a placeholder if no image URL is available
                    imageUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // Transparent 1x1 GIF
                }
                imgElement.src = imageUrl;
                imgElement.alt = screenshot.description || '截图预览';
                imgElement.className = 'w-full h-auto max-w-[150px] max-h-[100px] object-contain border border-gray-200 rounded cursor-pointer';
                imgElement.title = "点击查看原图";
                imgElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (screenshot.image_server_path && window.backendBaseUrl) {
                        window.open(`${window.backendBaseUrl}/api/download_screenshot_image?path=${encodeURIComponent(screenshot.image_server_path)}`, '_blank');
                    } else {
                        if(typeof showStatus === "function") showStatus("此截图无有效的服务器原图路径。", "text-yellow-500");
                    }
                });
                screenshotCard.appendChild(imgElement);

                const infoDiv = document.createElement('div');
                infoDiv.className = 'text-center text-xs text-gray-700 w-full truncate pt-1';
                const filenameDisplay = screenshot.savedImageFilenameOnServer?.split('/').pop() || screenshot.filenameSuggested || '未命名截图';
                infoDiv.title = `${filenameDisplay}\n类型: ${screenshot.chart_type_annotation || '未指定'}\n描述: ${truncateText(screenshot.description, 100) || '无'}`;
                infoDiv.innerHTML = `P${screenshot.page_number || '?'} - ${truncateText(filenameDisplay, 20)}<br>
                                     <span class="text-gray-500">${screenshot.chart_type_annotation || '未指定类型'}</span>`;
                screenshotCard.appendChild(infoDiv);

                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'flex space-x-2 mt-2';

                const editBtn = document.createElement('button');
                editBtn.className = 'modern-btn modern-btn-secondary p-1 text-xs';
                editBtn.title = '编辑此截图信息';
                editBtn.innerHTML = '<i class="fas fa-edit"></i>';
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // handleScreenshotItemClick is from screenshotManager.js
                    handleScreenshotItemClick(recordFrontendId, screenshotId, PDF_INSTANCE_SUFFIX);
                });
                actionsDiv.appendChild(editBtn);

                if (screenshot.image_server_path && window.backendBaseUrl) {
                    const downloadWpdBtn = document.createElement('button');
                    downloadWpdBtn.className = 'modern-btn modern-btn-primary p-1 text-xs';
                    downloadWpdBtn.title = `下载原图 (${filenameDisplay}) 用于数据提取`;
                    downloadWpdBtn.innerHTML = '<i class="fas fa-draw-polygon"></i>'; // Icon for data extraction/digitizing
                    downloadWpdBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const dlUrl = `${window.backendBaseUrl}/api/download_screenshot_image?path=${encodeURIComponent(screenshot.image_server_path)}`;
                        const a = document.createElement('a'); a.href = dlUrl; a.download = filenameDisplay;
                        document.body.appendChild(a); a.click(); document.body.removeChild(a);
                        if(typeof showStatus === "function") showStatus(`开始下载截图: ${filenameDisplay}`, 'text-green-500', 3000);
                    });
                    actionsDiv.appendChild(downloadWpdBtn);
                }

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'modern-btn modern-btn-danger p-1 text-xs';
                deleteBtn.title = '删除此截图';
                deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    // handleDeleteScreenshot is from screenshotManager.js
                    const deleteSuccess = await handleDeleteScreenshot(recordFrontendId, screenshotId, PDF_INSTANCE_SUFFIX);
                    if (deleteSuccess) {
                        openRecordScreenshotsViewerModal(record); // Refresh the modal content
                    }
                });
                actionsDiv.appendChild(deleteBtn);
                screenshotCard.appendChild(actionsDiv);
                domElementsMR.screenshotsGridContainer.appendChild(screenshotCard);
            });
            if(typeof showStatus === "function") showStatus(`已成功加载 ${freshScreenshots.length} 张截图。`, 'text-green-500', 3000);
            domElementsMR.noScreenshotsForRecordMessage.classList.add('hidden');
        } else {
            domElementsMR.noScreenshotsForRecordMessage.textContent = '此文献尚无截图记录。您可以从PDF查看器中创建截图。';
            domElementsMR.noScreenshotsForRecordMessage.classList.remove('hidden');
            if(typeof showStatus === "function") showStatus('此文献没有截图。', 'text-yellow-500', 3000);
        }
    } catch (error) {
        console.error(`${functionName} Error loading or rendering screenshots for article _id ${recordFrontendId}:`, error);
        if (domElementsMR.screenshotsGridContainer) {
            domElementsMR.screenshotsGridContainer.innerHTML = `<p class="text-red-500 col-span-full text-center py-4">加载截图列表失败: ${error.message || '未知错误'}</p>`;
        }
        if (typeof showStatus === "function") showStatus(`加载截图列表失败: ${error.message || '未知错误'}`, 'text-red-500');
        domElementsMR.noScreenshotsForRecordMessage.classList.remove('hidden'); // Ensure it's visible on error too
    }
}
/**
 * 请求删除单条文献记录。
 * @param {object} record - 要删除的文献对象。
 */
/**
 * 处理删除单条文献记录的请求，包括用户确认、API调用和UI更新。
 * @param {object} record - 要删除的文献对象 (应至少包含 _id, db_id/id, title)。
 */
async function handleDeleteSingleRecordRequestMR(record) {
    const functionName = "[MyRecords/DeleteSingle]"; // 用于日志和错误消息

    // 1. 参数校验
    if (!record || !record._id) {
        console.error(`${functionName} Invalid record object or missing frontend _id. Record:`, record);
        if (typeof showStatus === "function") showStatus("删除操作失败：提供的文献数据无效。", "text-red-500");
        return;
    }

    const recordDbId = record.db_id || record.id; // 后端数据库ID
    const recordFrontendId = record._id;      // 前端唯一ID

    if (!recordDbId) {
        // 如果记录只存在于前端（例如，未成功保存到服务器），则只从本地删除
        if (typeof showStatus === "function") showStatus("提示：此记录可能仅存在于本地，尚未与服务器同步。", "text-yellow-500", 4000);
        // 仍然需要用户确认是否从本地列表中移除
    }

    // 2. 检查必要的模态框DOM元素是否已缓存
    const requiredModalElements = [
        'deleteConfirmModal',
        'deleteConfirmModalTitle',
        'deleteConfirmModalMessage',
        'deleteConfirmModalConfirmBtn',
        'deleteConfirmModalCancelBtn', // 虽然关闭由 closeModal 处理，但最好确认其存在
        'deleteConfirmModalCloseIcon'  // 同上
    ];
    for (const key of requiredModalElements) {
        if (!domElementsMR[key]) {
            console.error(`${functionName} CRITICAL: Confirmation modal DOM element 'domElementsMR.${key}' (HTML ID: '${key}') not found or not cached. Cannot proceed with delete confirmation.`);
            if (typeof showStatus === "function") showStatus("删除操作失败：确认对话框关键元素缺失。", "text-red-500", 0);
            return;
        }
    }

    // 3. 设置并显示确认模态框
    if (domElementsMR.deleteConfirmModalTitle) {
        domElementsMR.deleteConfirmModalTitle.textContent = "确认删除文献";
    }
    if (domElementsMR.deleteConfirmModalMessage) {
        const titleToShow = truncateText(record.title || '该文献', 40);
        domElementsMR.deleteConfirmModalMessage.innerHTML =
            `<p>您确定要永久删除文献 <strong class="text-gray-800">"${titleToShow}"</strong> 吗？</p>
             <p class="mt-2 text-sm text-red-600">此操作将从您的列表中移除该记录。${recordDbId ? '如果已同步，它也将从服务器删除。' : '此记录似乎仅存在于本地。'} </p>
             <p class="mt-1 text-sm text-gray-500">相关的截图文件和元数据（如果已在服务器）也可能被删除（取决于服务器配置）。此操作通常不可恢复。</p>`;
    }

    // 为了防止累积事件监听器，推荐的做法是克隆并替换确认按钮，然后在新按钮上绑定事件
    const oldConfirmBtn = domElementsMR.deleteConfirmModalConfirmBtn;
    const newConfirmBtn = oldConfirmBtn.cloneNode(true);
    oldConfirmBtn.parentNode.replaceChild(newConfirmBtn, oldConfirmBtn);
    domElementsMR.deleteConfirmModalConfirmBtn = newConfirmBtn; // 更新domElementsMR中的引用

    // 清除可能存在的旧监听器 (通过替换按钮的方式已经隐式清除了)
    // newConfirmBtn.replaceWith(newConfirmBtn.cloneNode(true)); // 另一种清除方式
    // domElementsMR.deleteConfirmModalConfirmBtn = document.getElementById(requiredDomIdsMap.deleteConfirmModalConfirmBtn);


    domElementsMR.deleteConfirmModalConfirmBtn.onclick = async () => {
        closeModal('deleteConfirmModal'); // 来自 utils.js
        if (typeof showStatus === "function") showStatus(`正在删除文献 "${truncateText(record.title, 30)}"...`, "text-blue-500", 0);

        let deleteSuccess = false;
        try {
            if (recordDbId) { // 如果有数据库ID，则尝试从服务器删除
                deleteSuccess = await deleteLiteratureArticleApi(recordDbId); // 来自 api.js
            } else {
                // 如果没有数据库ID，我们认为“服务器删除”是“成功的”（因为无需操作）
                // 以便继续进行本地删除。
                deleteSuccess = true;
                console.log(`${functionName} Record _id ${recordFrontendId} has no db_id. Will only be removed locally.`);
            }

            if (deleteSuccess) {
                // 4. 从前端的 window.tableData 中移除该记录
                const initialLength = window.tableData.length;
                window.tableData = window.tableData.filter(r => r._id !== recordFrontendId);

                if (window.tableData.length < initialLength) { // 确认记录已从本地数组移除
                    saveTableDataToLocalStorage(); // 更新本地存储

                    if (typeof showStatus === "function") {
                        const serverMsg = recordDbId ? "已从服务器和本地列表删除。" : "已从本地列表移除。";
                        showStatus(`文献 "${truncateText(record.title, 30)}" ${serverMsg} 正在刷新列表...`, "text-green-500", 4000);
                    }

                    // 5. 刷新UI
                    // 如果删除的是当前页的最后一条，并且不是第一页，可能需要调整 currentPageMyRecords
                    if (rawServerDataCurrentPage.length === 1 && currentPageMyRecords > 1 && rawServerDataCurrentPage.some(r => r._id === recordFrontendId)) {
                        currentPageMyRecords--;
                    }
                    await loadAndRenderMyRecords(); // 重新加载并渲染当前页 (或调整后的页)

                    if (typeof loadAndRenderStatisticsMR === "function") await loadAndRenderStatisticsMR();
                    if (typeof loadAndDisplayRecentActivityMR === "function") await loadAndDisplayRecentActivityMR();
                } else {
                    console.warn(`${functionName} Record _id ${recordFrontendId} was not found in window.tableData for local removal, though server operation might have succeeded.`);
                    if (typeof showStatus === "function" && recordDbId && deleteSuccess) {
                        showStatus(`文献已从服务器删除，但本地列表未找到对应项。建议刷新页面。`, "text-orange-500", 5000);
                    } else if (typeof showStatus === "function") {
                        showStatus(`操作完成，但本地列表未找到对应项。`, "text-yellow-500", 4000);
                    }
                }
            } else {
                // deleteLiteratureArticleApi 内部应该已经调用 showStatus 显示具体的API失败信息
                // 此处的 showStatus 是一个备用，以防API函数没有充分报告错误
                if (typeof showStatus === "function") {
                     showStatus(`删除文献 "${truncateText(record.title, 30)}" 失败。服务器可能返回了错误或拒绝了请求。`, "text-red-500", 5000);
                }
            }
        } catch (error) {
            console.error(`${functionName} Error during delete operation for record (db_id: ${recordDbId}, _id: ${recordFrontendId}):`, error);
            if (typeof showStatus === "function") showStatus(`删除文献时发生严重错误: ${error.message || '未知客户端或网络问题'}`, "text-red-500", 5000);
        }
    };

    if (domElementsMR.deleteConfirmModal) {
        domElementsMR.deleteConfirmModal.style.display = 'flex';
    }
}

/**
 * 请求批量删除选中的文献记录。
 */
async function handleDeleteSelectedRequestMR() {
    const selectedDbIds = getSelectedRecordDbIdsMR(); // 获取选中记录的数据库ID
    const selectedFrontendIds = getSelectedRecordFrontendIdsMR(); // 获取选中记录的前端ID

    if (selectedDbIds.length === 0) {
        showStatus("请先选择要删除的文献记录。", "text-yellow-500");
        return;
    }
    if (selectedDbIds.some(id => !id)) { // 检查是否有选中的记录缺少数据库ID
        showStatus("部分选中的记录未与服务器同步（缺少数据库ID），无法批量删除。请先确保所有选中的记录都已保存到服务器。", "text-orange-500", 6000);
        return;
    }
     if (!domElementsMR.deleteConfirmModal || !domElementsMR.deleteConfirmModalTitle || !domElementsMR.deleteConfirmModalMessage || !domElementsMR.deleteConfirmModalConfirmBtn) {
        console.error("[MyRecords] Delete confirmation modal elements not found for batch delete.");
        alert("批量删除确认对话框未能正确加载，请刷新页面重试。");
        return;
    }

    domElementsMR.deleteConfirmModalTitle.textContent = `确认批量删除 ${selectedDbIds.length} 条文献`;
    domElementsMR.deleteConfirmModalMessage.innerHTML = `<p>您确定要永久删除选中的 ${selectedDbIds.length} 条文献记录吗？</p><p class="mt-2 text-sm text-red-600">此操作将从服务器和您的本地列表中移除这些记录。相关活动日志和截图可能也会受影响。</p><p class="mt-1 text-sm text-red-600">此操作通常不可恢复。</p>`;

    const newConfirmBtn = domElementsMR.deleteConfirmModalConfirmBtn.cloneNode(true);
    domElementsMR.deleteConfirmModalConfirmBtn.parentNode.replaceChild(newConfirmBtn, domElementsMR.deleteConfirmModalConfirmBtn);
    domElementsMR.deleteConfirmModalConfirmBtn = newConfirmBtn;

    domElementsMR.deleteConfirmModalConfirmBtn.onclick = async () => {
        closeModal('deleteConfirmModal');
        showStatus(`正在批量删除 ${selectedDbIds.length} 条文献...`, "text-blue-500", 0);
        try {
            const success = await batchDeleteLiteratureArticlesApi(selectedDbIds);
            if (success) {
                window.tableData = window.tableData.filter(r => !selectedFrontendIds.includes(r._id));
                saveTableDataToLocalStorage();
                showStatus(`${selectedDbIds.length} 条文献已成功删除。正在刷新列表...`, "text-green-500", 4000);
                currentPageMyRecords = 1; // 删除后通常回到第一页或最后一页有数据的页
                await loadAndRenderMyRecords();
                await loadAndRenderStatisticsMR();
                await loadAndDisplayRecentActivityMR();
            } else {
                 showStatus(`批量删除文献失败。服务器可能返回了错误或部分操作未成功。`, "text-red-500", 5000);
            }
        } catch (error) {
            console.error(`[MyRecords] Error batch deleting records:`, error);
            showStatus(`批量删除文献时发生严重错误: ${error.message || '未知问题'}`, "text-red-500", 5000);
        }
    };
    domElementsMR.deleteConfirmModal.style.display = 'flex';
}

// js/my_records_logic.js
// ... (确保所有必要的 import 和 domElementsMR 的定义在此函数之前) ...

/**
 * 导出选中的文献记录为CSV文件。
 */
function handleExportSelectedMR() {
    const functionName = "[MyRecords/ExportSelected]"; // 用于日志

    // 1. 获取选中的记录 (基于前端 _id)
    // getSelectedRecordFrontendIdsMR 应该返回一个包含所有选中记录 _id 的数组
    const selectedFrontendIds = getSelectedRecordFrontendIdsMR();

    if (selectedFrontendIds.length === 0) {
        if (typeof showStatus === "function") showStatus("请先选择要导出的文献记录。", "text-yellow-500", 3000);
        return;
    }

    // 从 window.tableData 中筛选出实际的记录对象
    const recordsToExport = window.tableData.filter(r => selectedFrontendIds.includes(r._id));

    if (recordsToExport.length === 0) {
        // 这种情况理论上不应该发生，如果 selectedFrontendIds 不为空
        console.warn(`${functionName} No records found in window.tableData for selected frontend IDs. IDs:`, selectedFrontendIds);
        if (typeof showStatus === "function") showStatus("未找到与所选ID匹配的记录进行导出。", "text-orange-500", 4000);
        return;
    }

    if (typeof showStatus === "function") showStatus(`正在准备导出 ${recordsToExport.length} 条文献记录为CSV...`, "text-blue-500", 0);

    try {
        // 2. 定义CSV表头 (确保与下面提取数据的顺序和字段一致)
        // 这些表头是CSV文件中的第一行，应该是用户易于理解的名称。
        const headers = [
            'Title',
            'Authors',
            'Year',
            'Source/Journal',
            'DOI',
            'PDF Link',
            'Status',
            'Database ID (from server)',
            'Frontend ID (local)',
            'Screenshots Count',
            'Abstract/Notes' // 假设您可能想导出摘要或备注 (如果该字段存在于record对象中)
        ];
        const csvRows = [];
        csvRows.push(headers.map(header => escapeCsvCell(header)).join(',')); // 转义表头并加入CSV

        // 3. 遍历选中的记录，构建CSV数据行
        recordsToExport.forEach(record => {
            // 从 record 对象中安全地获取数据，并进行转义
            // 注意：这里的属性名 (record.title, record.authors等) 需要与 window.tableData 中对象的实际属性名一致
            const rowValues = [
                escapeCsvCell(record.title || ''),
                escapeCsvCell(record.authors || ''),
                escapeCsvCell(record.year || ''),
                escapeCsvCell(record.source_publication || record.source || ''), // 兼容后端和前端可能的字段名
                escapeCsvCell(record.doi || ''),
                escapeCsvCell(record.pdf_link || record.pdfLink || ''), // 兼容后端和前端可能的字段名
                escapeCsvCell(record.status || ''),
                escapeCsvCell(record.db_id || record.id || ''), // 数据库ID
                escapeCsvCell(record._id || ''),                // 前端ID
                escapeCsvCell(record.screenshots ? record.screenshots.length : 0),
                escapeCsvCell(record.abstract || record.notes || '') // 示例：导出摘要或备注字段
            ];
            csvRows.push(rowValues.join(','));
        });

        // 4. 生成CSV内容并触发下载
        const csvContent = "\uFEFF" + csvRows.join('\r\n'); // 添加BOM以便Excel正确识别UTF-8
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-').replace('T', '_');
        const filename = `my_literature_records_export_${timestamp}.csv`;

        // 使用 utils.js 中的 triggerBrowserDownload (如果已实现并导入)
        if (typeof triggerBrowserDownload === "function") {
            triggerBrowserDownload(blob, filename);
        } else { // Fallback download logic
            console.warn(`${functionName} triggerBrowserDownload function not available, using fallback.`);
            const link = document.createElement("a");
            if (link.download !== undefined) { // Check for browser support
                const url = URL.createObjectURL(blob);
                link.setAttribute("href", url);
                link.setAttribute("download", filename);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url); // 释放对象URL
            } else {
                // 对于不支持 download 属性的非常旧的浏览器
                console.error(`${functionName} Browser does not support direct download attribute.`);
                if (typeof showStatus === "function") showStatus('您的浏览器不支持直接下载CSV文件。请尝试更新浏览器或手动复制数据。', 'text-red-500', 5000);
                return; // 提前退出，不显示成功消息
            }
        }

        if (typeof showStatus === "function") showStatus(`已成功导出 ${recordsToExport.length} 条记录到CSV文件 "${filename}"。`, 'text-green-500', 5000);
        console.log(`${functionName} Successfully exported ${recordsToExport.length} records to ${filename}.`);

    } catch (error) {
        console.error(`${functionName} Error exporting selected records to CSV:`, error);
        if (typeof showStatus === "function") showStatus(`导出CSV时发生错误: ${error.message || '未知错误，请检查控制台。'}`, "text-red-500", 5000);
    }
}

/**
 * 批量下载选中且有PDF链接的文献的PDF文件（通过后端打包成ZIP）。
 */
/**
 * 批量下载选中且有PDF链接的文献的PDF文件（通过后端打包成ZIP）。
 */
async function handleBatchDownloadSelectedMR() {
    const functionName = "[MyRecords/BatchDownloadSelected]"; // 用于日志

    // 1. 获取选中的记录的前端ID
    // getSelectedRecordFrontendIdsMR() 返回所有选中记录的 _id 列表
    const selectedFrontendIds = getSelectedRecordFrontendIdsMR();

    if (selectedFrontendIds.length === 0) {
        if (typeof showStatus === "function") showStatus("请先选择要批量下载PDF的文献记录。", "text-yellow-500", 3000);
        return;
    }

    // 2. 从 window.tableData 中筛选出实际的记录对象，并确保它们有有效的PDF链接
    const recordsToProcess = window.tableData.filter(r =>
        selectedFrontendIds.includes(r._id) &&
        (r.pdf_link || r.pdfLink) &&       // 确保 pdf_link 或 pdfLink 存在
        (r.pdf_link || r.pdfLink).trim() !== '' // 确保链接非空
    );

    if (recordsToProcess.length === 0) {
        if (typeof showStatus === "function") showStatus("选中的文献记录中没有有效的PDF链接可供下载。", "text-yellow-500", 4000);
        return;
    }

    // 3. 准备发送给API的文献数据
    const articlesForApi = recordsToProcess.map(r => ({
        pdfLink: r.pdf_link || r.pdfLink,                   // API通常期望 pdfLink
        title: r.title || `Untitled_Article_${r.db_id || r.id || r._id}`, // 提供一个回退标题
        doi: r.doi || null,                                 // 包含DOI（如果可用）
        db_id: r.db_id || r.id || null                      // 包含数据库ID（如果可用）
    }));

    if (typeof showStatus === "function") showStatus(`正在为 ${articlesForApi.length} 条选中文献准备批量PDF下载... 请稍候，这可能需要一些时间。`, "text-blue-500", 0);

    // 4. 禁用下载按钮，防止重复点击
    if (domElementsMR.batchDownloadSelectedBtn) {
        domElementsMR.batchDownloadSelectedBtn.disabled = true;
        // 可选：添加加载状态到按钮文本
        // domElementsMR.batchDownloadSelectedBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>处理中...';
    }

    try {
        // 5. 调用API进行批量处理和ZIP打包
        const responseData = await batchProcessAndZipApi(articlesForApi); // 来自 api.js

        if (responseData) {
            if (responseData.status === "previously_processed" && responseData.zip_download_filename) {
                // 处理后端返回“之前已处理过”的状态
                if (typeof showStatus === "function") showStatus(`此文献集合之前已处理为 "${responseData.zip_download_filename}". 正在尝试下载旧包...`, 'text-blue-300', 4000);
                 // (此处可以添加用户确认是否重新下载旧包或重新生成的逻辑，如 batchOperations.js 中所示)
                 // 为简化，我们直接触发下载
                triggerZipDownloadHelper(responseData.zip_download_filename, functionName);

            } else if (responseData.success && responseData.zip_download_filename) {
                // 正常成功，触发下载
                triggerZipDownloadHelper(responseData.zip_download_filename, functionName);
                if (typeof showStatus === "function") {
                    let successMsg = `ZIP包 "${responseData.zip_download_filename}" 已开始下载。`;
                    if (responseData.total_requested !== undefined && responseData.successfully_processed !== undefined) {
                        successMsg += ` 成功处理 ${responseData.successfully_processed}/${responseData.total_requested} 个文件。`;
                    }
                    if (responseData.failed_items && responseData.failed_items.length > 0) {
                        successMsg += ` <strong class="text-orange-500">${responseData.failed_items.length} 个文件处理失败。</strong>`;
                    }
                    showStatus(successMsg, 'text-green-500', 7000);
                }
            } else {
                // API调用成功但业务逻辑失败 (例如，success: false 或缺少文件名)
                throw new Error(responseData.message || responseData.error || "批量下载失败，服务器未能成功创建或提供ZIP文件。");
            }
        } else {
            // API调用本身可能返回null或undefined（例如网络错误在api.js中被捕获但未正确抛出）
            throw new Error("批量下载请求未能收到有效响应从服务器。");
        }
    } catch (error) {
        console.error(`${functionName} Error during batch PDF download:`, error);
        if (typeof showStatus === "function") showStatus(`批量下载PDF时发生错误: ${error.message || '未知服务器或客户端问题'}`, "text-red-500", 7000);
    } finally {
        // 6. 恢复下载按钮状态
        if (domElementsMR.batchDownloadSelectedBtn) {
            domElementsMR.batchDownloadSelectedBtn.disabled = false;
            // 可选：恢复按钮原始文本
            // domElementsMR.batchDownloadSelectedBtn.innerHTML = '<i class="fas fa-download mr-1"></i>批量下载选中PDF';
        }
    }
}

/**
 * 辅助函数，用于触发ZIP文件的浏览器下载。
 * @param {string} zipFileName - 要下载的ZIP文件名。
 * @param {string} [callerFunctionName="UnknownFunction"] - 调用此辅助函数的函数名，用于日志。
 */
function triggerZipDownloadHelper(zipFileName, callerFunctionName = "UnknownFunction") {
    if (!zipFileName || typeof zipFileName !== 'string') {
        console.error(`[${callerFunctionName}/ZipHelper] Invalid or missing ZIP filename for download.`);
        if (typeof showStatus === "function") showStatus("下载启动失败：无效的文件名。", "text-red-500");
        return;
    }
    if (!window.backendBaseUrl) {
        console.error(`[${callerFunctionName}/ZipHelper] Backend base URL not configured. Cannot build download link.`);
        if (typeof showStatus === "function") showStatus("下载启动失败：后端服务链接未配置。", "text-red-500");
        return;
    }

    const zipDownloadUrl = `${window.backendBaseUrl}/api/download_zip_package/${encodeURIComponent(zipFileName)}`;
    console.log(`[${callerFunctionName}/ZipHelper] Triggering download for: ${zipDownloadUrl}`);

    // 使用 utils.js 中的 triggerBrowserDownload (如果已实现并导入)
    if (typeof triggerBrowserDownload === "function") { // 检查是否导入了更通用的下载函数
        // 假设 triggerBrowserDownload 可以直接处理URL，或者需要先fetch blob
        // 如果 triggerBrowserDownload(url, filename) 是直接下载链接:
        // triggerBrowserDownload(zipDownloadUrl, zipFileName); // 可能需要调整，看triggerBrowserDownload如何设计
        // 为了与之前的 handleExportSelectedMR 保持一致的下载方式：
        const link = document.createElement('a');
        link.href = zipDownloadUrl;
        // link.download = zipFileName; // 后端会通过 Content-Disposition 设置文件名
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // URL.createObjectURL 和 revokeObjectURL 不适用于直接的下载链接
    } else {
        console.warn(`[${callerFunctionName}/ZipHelper] triggerBrowserDownload utility not found. Using direct link method.`);
        const link = document.createElement('a');
        link.href = zipDownloadUrl;
        // 对于服务器提供的下载，通常不需要设置 link.download，服务器会通过 Content-Disposition 头来指定文件名。
        // link.download = zipFileName;
        link.style.display = 'none'; // Ensure it's not visible
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}
/**
 * 请求清空所有文献记录。
 */
// js/my_records_logic.js
// ... (确保所有必要的 import 和 domElementsMR 的定义在此函数之前) ...

/**
 * 处理清空所有文献记录的请求。
 * 这是一个非常具有破坏性的操作，需要用户多次确认。
 */
async function handleClearAllRecordsRequestMR() {
    const functionName = "[MyRecords/ClearAllRecords]"; // 用于日志

    // 1. 检查必要的模态框DOM元素是否已缓存
    const requiredModalElements = [
        'deleteConfirmModal',
        'deleteConfirmModalTitle',
        'deleteConfirmModalMessage',
        'deleteConfirmModalConfirmBtn',
        'deleteConfirmModalCancelBtn',
        'deleteConfirmModalCloseIcon'
    ];
    for (const key of requiredModalElements) {
        if (!domElementsMR[key]) {
            console.error(`${functionName} CRITICAL: Confirmation modal DOM element 'domElementsMR.${key}' (HTML ID: '${key}') not found. Cannot proceed.`);
            if (typeof showStatus === "function") showStatus("清空操作失败：确认对话框关键元素缺失。", "text-red-500", 0);
            return;
        }
    }

    // 2. 设置并显示非常强烈的警告确认模态框
    if (domElementsMR.deleteConfirmModalTitle) {
        domElementsMR.deleteConfirmModalTitle.textContent = "！！警告：确认清空所有文献记录！！";
    }
    if (domElementsMR.deleteConfirmModalMessage) {
        domElementsMR.deleteConfirmModalMessage.innerHTML =
            `<p class="text-lg text-red-700 font-semibold">您确定要永久删除您账户下的【所有】文献记录吗？</p>
             <p class="mt-3 text-gray-700">此操作包括：</p>
             <ul class="list-disc list-inside text-gray-600 text-sm mt-1 mb-3">
                <li>所有已导入的文献条目。</li>
                <li>可能还包括所有相关的截图文件和元数据（取决于服务器配置）。</li>
                <li>所有相关的活动日志。</li>
             </ul>
             <p class="text-red-600 font-bold text-xl">此操作一旦执行，将无法恢复！</p>
             <p class="mt-2 text-sm text-gray-500">如果您确认，请输入 "DELETE" 以继续。</p>
             <input type="text" id="clearAllConfirmInput_MyRecords" class="modern-input w-full mt-2" placeholder="在此输入 DELETE">`;
    }

    // 动态绑定确认按钮事件
    const oldConfirmBtn = domElementsMR.deleteConfirmModalConfirmBtn;
    const newConfirmBtn = oldConfirmBtn.cloneNode(true);
    if (oldConfirmBtn.parentNode) {
        oldConfirmBtn.parentNode.replaceChild(newConfirmBtn, oldConfirmBtn);
    }
    domElementsMR.deleteConfirmModalConfirmBtn = newConfirmBtn; // 更新缓存的引用

    domElementsMR.deleteConfirmModalConfirmBtn.onclick = async () => {
        const confirmInput = document.getElementById('clearAllConfirmInput_MyRecords');
        if (!confirmInput || confirmInput.value !== "DELETE") {
            if (typeof showStatus === "function") showStatus("确认输入错误。操作已取消。", "text-orange-500", 4000);
            if (confirmInput) confirmInput.value = ''; // 清空输入
            // closeModal('deleteConfirmModal'); // 可选：如果输入错误是否关闭模态框
            return;
        }

        closeModal('deleteConfirmModal'); // 来自 utils.js
        if (typeof showStatus === "function") showStatus("正在清空所有文献记录... 请稍候。", "text-red-600 font-bold", 0);

        try {
            // 3. 调用API尝试清空服务器记录
            // 假设 saveFullLiteratureList([]) 会被后端理解为清空操作
            // 注意：这强烈依赖后端对此行为的正确实现。
            // 一个更稳健的方法是后端提供一个专门的 DELETE /api/user/literature/all 端点。
            const response = await saveFullLiteratureList([]); // from api.js

            // 检查响应是否表明操作成功。
            // 如果 saveFullLiteratureList 返回的是 { success: true, added: 0, skipped: 0 } 类似结构，则表示成功。
            let clearSuccess = false;
            if (response && response.success !== undefined) {
                // 假设后端在清空成功时，返回类似 { success: true, message: "...", added: 0, skipped: 0 }
                // 或者至少 success 为 true 且没有新增/跳过任何条目
                if (response.success || (response.added === 0 && response.skipped === 0)) {
                    clearSuccess = true;
                } else {
                     console.warn(`${functionName} Server responded, but clear operation might not be fully successful based on response:`, response);
                }
            } else if (response === null || response === undefined) { // API 调用本身可能因网络问题返回 null
                 throw new Error("服务器响应无效，无法确认清空操作是否成功。");
            }
            // 如果API明确返回错误，它应该抛出，由catch块处理

            if (clearSuccess) {
                // 4. 清空前端的 window.tableData
                window.tableData = [];
                saveTableDataToLocalStorage(); // 更新本地存储为空
                console.log(`${functionName} All records cleared locally from window.tableData and localStorage.`);

                if (typeof showStatus === "function") showStatus("所有文献记录已成功清空！正在刷新界面...", "text-green-500", 4000);

                // 5. 刷新UI
                currentPageMyRecords = 1; // 重置到第一页
                totalRecordsMyRecords = 0;
                totalPagesMyRecords = 1;
                rawServerDataCurrentPage = []; // 清空当前页数据

                renderMyRecordsTableDOM([]); // 用空数组渲染表格，会显示“无记录”
                updatePaginationControlsMR(); // 更新分页控件状态
                updateSelectedCountDisplayMR(); // 更新选中计数和批量按钮状态

                if (typeof loadAndRenderStatisticsMR === "function") await loadAndRenderStatisticsMR(); // 重新加载统计
                if (typeof loadAndDisplayRecentActivityMR === "function") await loadAndDisplayRecentActivityMR(); // 重新加载活动

            } else {
                // 如果 saveFullLiteratureList 返回了非成功状态，但没有抛出错误
                const errorMsg = response?.message || "服务器未能成功清空所有记录，但未返回明确错误。";
                console.error(`${functionName} Failed to clear all records on server. Response:`, response);
                if (typeof showStatus === "function") showStatus(errorMsg, "text-red-500", 0);
            }

        } catch (error) {
            console.error(`${functionName} Error during 'Clear All Records' operation:`, error);
            if (typeof showStatus === "function") showStatus(`清空所有记录时发生严重错误: ${error.message || '未知问题'}`, "text-red-500", 0);
        }
    };

    if (domElementsMR.deleteConfirmModal) {
        domElementsMR.deleteConfirmModal.style.display = 'flex';
    }
}

// --- Statistics and Recent Activity ---
// js/my_records_logic.js
// ... (确保所有必要的 import 和 domElementsMR 的定义在此函数之前) ...

/**
 * 加载并渲染“我的记录”页面的统计数据。
 * 这些数据通常包括总记录数、有PDF链接的记录数以及截图总数。
 */
async function loadAndRenderStatisticsMR() {
    const functionName = "[MyRecords/LoadStats]"; // 用于日志

    // 1. 检查必要的统计DOM元素是否已缓存
    // 确保这些键名与 initializeMyRecordsPage 中 requiredDomIdsMap 的键名一致
    const statElements = {
        total: domElementsMR.statTotalRecords,
        hasPdf: domElementsMR.statHasPdfLink,
        screenshots: domElementsMR.statTotalScreenshotsMyRecords
    };

    // 检查是否所有统计相关的DOM元素都已成功缓存
    // 如果任一元素未找到，只记录警告，但仍尝试更新存在的元素
    if (!statElements.total || !statElements.hasPdf || !statElements.screenshots) {
        console.warn(`${functionName} One or more statistics DOM elements (statTotalRecords, statHasPdfLink, statTotalScreenshotsMyRecords) are not found in domElementsMR. Statistics display may be incomplete.`);
        // 即使部分元素缺失，也尝试更新存在的元素，所以不在此处直接 return
    }

    console.log(`${functionName} Attempting to fetch and render statistics.`);

    try {
        // 2. 调用API获取统计数据
        // fetchDashboardStats 应该从 api.js 导入
        if (typeof fetchDashboardStats !== "function") {
            console.error(`${functionName} CRITICAL: fetchDashboardStats function is not available. Cannot load statistics.`);
            if (typeof showStatus === "function") showStatus("加载统计数据失败：核心API函数缺失。", "text-red-500");
            // 设置默认错误文本
            if (statElements.total) statElements.total.textContent = '错误';
            if (statElements.hasPdf) statElements.hasPdf.textContent = '错误';
            if (statElements.screenshots) statElements.screenshots.textContent = '错误';
            return;
        }

        const stats = await fetchDashboardStats();

        // 3. 更新DOM元素显示统计数据
        if (stats && typeof stats === 'object') { // 确保 stats 是一个有效的对象
            if (statElements.total) {
                statElements.total.textContent = `${stats.totalLiterature || 0}篇`;
            }
            if (statElements.hasPdf) {
                statElements.hasPdf.textContent = `${stats.downloadedPdfs || 0}篇`;
            }
            if (statElements.screenshots) {
                statElements.screenshots.textContent = `${stats.totalScreenshots || 0}张`;
            }
            console.log(`${functionName} Statistics updated in UI:`, stats);
        } else {
            // API调用可能成功，但返回的数据格式不正确或为空
            console.warn(`${functionName} Failed to load valid statistics data from server. Response:`, stats);
            if (typeof showStatus === "function") showStatus("未能加载有效的统计数据，或服务器未返回数据。", "text-orange-500", 4000);
            // 设置为 N/A 表示数据不可用
            if (statElements.total) statElements.total.textContent = 'N/A';
            if (statElements.hasPdf) statElements.hasPdf.textContent = 'N/A';
            if (statElements.screenshots) statElements.screenshots.textContent = 'N/A';
        }
    } catch (error) {
        console.error(`${functionName} Error loading statistics for 'My Records' page:`, error);
        if (typeof showStatus === "function") showStatus(`加载统计数据时发生错误: ${error.message || '未知问题'}`, "text-red-500", 5000);
        // 出错时，也在UI上明确提示
        if (statElements.total) statElements.total.textContent = '加载错误';
        if (statElements.hasPdf) statElements.hasPdf.textContent = '加载错误';
        if (statElements.screenshots) statElements.screenshots.textContent = '加载错误';
    }
}

// js/my_records_logic.js
// ... (确保所有必要的 import 和 domElementsMR 的定义在此函数之前) ...

/**
 * 加载并显示“我的记录”页面的最近用户活动列表。
 */
async function loadAndDisplayRecentActivityMR() {
    const functionName = "[MyRecords/LoadActivity]"; // 用于日志

    // 1. 检查必要的DOM元素是否已缓存
    // 确保这些键名与 initializeMyRecordsPage 中 requiredDomIdsMap 的键名一致
    const activityListElement = domElementsMR.recentActivityListMyRecords;
    const noActivityMessageElement = domElementsMR.noRecentActivityMessageMyRecords;

    if (!activityListElement || !noActivityMessageElement) {
        console.warn(`${functionName} DOM elements for recent activity (recentActivityListMyRecords or noRecentActivityMessageMyRecords) are not found in domElementsMR. Cannot display activity.`);
        // 即使元素缺失，也尝试继续执行其他初始化步骤，但此功能将不可用
        return;
    }

    console.log(`${functionName} Attempting to fetch and render recent activity.`);
    activityListElement.innerHTML = '<p class="text-sm text-gray-500 animate-pulse p-4">正在加载最近活动记录...</p>';
    noActivityMessageElement.classList.add('hidden'); // 初始隐藏“无活动”消息

    try {
        // 2. 调用API获取最近活动数据
        // fetchRecentActivity 应该从 api.js 导入，可以接受一个可选的 limit 参数
        if (typeof fetchRecentActivity !== "function") {
            console.error(`${functionName} CRITICAL: fetchRecentActivity function is not available. Cannot load activity.`);
            if (typeof showStatus === "function") showStatus("加载最近活动失败：核心API函数缺失。", "text-red-500");
            activityListElement.innerHTML = '<p class="text-sm text-red-500 p-4">无法加载活动记录：服务错误。</p>';
            return;
        }

        const activities = await fetchRecentActivity(5); // 例如，获取最新的5条活动

        // 3. 清空加载提示并渲染活动列表
        activityListElement.innerHTML = '';

        if (activities && Array.isArray(activities) && activities.length > 0) {
            activities.forEach(activity => {
                const activityItem = document.createElement('div');
                // 使用与仪表盘页面最近活动相似的样式，以保持一致性
                activityItem.className = 'flex items-start space-x-3 p-3 hover:bg-gray-100 rounded-lg transition-colors duration-150 border-b border-gray-100 last:border-b-0';

                const iconContainer = document.createElement('div');
                iconContainer.className = 'flex-shrink-0 w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mt-1';
                const iconElement = document.createElement('i');
                // 使用后端返回的 icon_class，或提供一个默认图标
                iconElement.className = `${activity.icon_class || "fas fa-info-circle text-gray-400"} fa-fw text-lg`;
                iconContainer.appendChild(iconElement);
                activityItem.appendChild(iconContainer);

                const textContainer = document.createElement('div');
                textContainer.className = 'flex-1 min-w-0'; // min-w-0 帮助处理文本截断

                const descriptionElem = document.createElement('p');
                descriptionElem.className = 'text-sm font-medium text-gray-800 break-words'; // break-words 防止长描述溢出
                descriptionElem.textContent = activity.description || '无活动描述';
                if (activity.description) descriptionElem.title = activity.description; // 完整描述作为tooltip
                textContainer.appendChild(descriptionElem);

                const timeElem = document.createElement('p');
                timeElem.className = 'text-xs text-gray-500 mt-0.5';
                let formattedTime = activity.timestamp; // 后端应返回 ISO 8601 格式的字符串
                try {
                    const date = new Date(activity.timestamp);
                    if (!isNaN(date.valueOf())) { // 检查日期是否有效
                        formattedTime = date.toLocaleString('zh-CN', {
                            year: 'numeric', month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit', hour12: false
                        });
                    }
                } catch (e) {
                    console.warn(`${functionName} Error formatting timestamp for activity:`, activity.timestamp, e);
                    // formattedTime 将保持为原始字符串
                }
                timeElem.textContent = formattedTime;
                textContainer.appendChild(timeElem);
                activityItem.appendChild(textContainer);
                activityListElement.appendChild(activityItem);
            });
            noActivityMessageElement.classList.add('hidden'); // 确保“无活动”消息被隐藏
            console.log(`${functionName} Displayed ${activities.length} recent activities.`);

        } else {
            // API调用成功，但没有活动数据，或者返回的数据格式不正确
            if (activities === null) { // API 调用可能因认证等问题返回 null
                 noActivityMessageElement.textContent = '无法加载最近活动记录（可能需要重新登录）。';
            } else { // activities 是空数组或非数组
                 noActivityMessageElement.textContent = '暂无最近活动记录。';
            }
            noActivityMessageElement.classList.remove('hidden');
            console.log(`${functionName} No recent activities to display or data was invalid. Response:`, activities);
        }
    } catch (error) {
        console.error(`${functionName} Error loading or rendering recent activity:`, error);
        if (typeof showStatus === "function") showStatus(`加载最近活动时发生错误: ${error.message || '未知问题'}`, "text-red-500", 5000);
        activityListElement.innerHTML = '<p class="text-sm text-red-500 p-4">加载最近活动失败，请稍后重试。</p>';
        noActivityMessageElement.classList.add('hidden');
    }
}

console.log("[MyRecords] my_records_logic.js (Production Grade) loaded. Waiting for DOMContentLoaded to initialize.");