// js/pdfViewerCore.js

// ==========================================================================
// 1. IMPORTS (Minimal, as this core might be used by various pages)
// ==========================================================================
// Assuming utils.js and config.js are available globally or imported where needed by calling functions
// For example, showStatus, truncateText, DEFAULT_PDF_SCALE etc. are expected to be available.
// If screenshotManager's displayScreenshotsForCurrentArticle is called from here, it should be imported.
import { showStatus, truncateText } from './utils.js'; // Assuming utils.js provides these
import { DEFAULT_PDF_SCALE, MIN_PDF_SCALE, MAX_PDF_SCALE, PDF_SCALE_INCREMENT } from './config.js';
import { displayScreenshotsForCurrentArticle } from './screenshotManager.js'; // If called from here


// ==========================================================================
// 2. GLOBAL PDF.JS WORKER INITIALIZATION
// ==========================================================================
let pdfJsWorkerInitialized = false;

/**
 * Initializes the PDF.js worker. Should be called once per application load.
 */
export function initializePdfJsWorker() {
    if (pdfJsWorkerInitialized) {
        console.log("[PdfCore] PDF.js worker already initialized.");
        return;
    }
    if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
        try {
            // 重要: 确保此路径相对于HTML文件的位置是正确的。
            // 如果 HTML 在根目录，而 pdf.js 在 'pdf.js/build/', worker 在 'pdf.js/build/',
            // 那么路径可能是 './pdf.js/build/pdf.worker.js' 或 '../pdf.js/build/pdf.worker.js'
            // 取决于此 JS 文件相对于 HTML 的位置。
            // 假设HTML在根，js在js/，pdf.js在根/pdf.js/
            pdfjsLib.GlobalWorkerOptions.workerSrc = '../pdf.js/build/pdf.worker.js';// 调整此路径!
            pdfJsWorkerInitialized = true;
            console.log("[PdfCore] PDF.js worker SRC configured to:", pdfjsLib.GlobalWorkerOptions.workerSrc);
        } catch (e) {
            console.error("[PdfCore] Error setting PDF.js worker SRC:", e);
            if(typeof showStatus === "function") showStatus("PDF.js核心工作线程配置失败，PDF功能可能受限。", "text-red-500", 0);
        }
    } else {
        console.error("[PdfCore] PDF.js library (pdfjsLib) or GlobalWorkerOptions not available!");
        if(typeof showStatus === "function") showStatus("PDF.js核心库未能加载，PDF相关功能无法使用。", "text-red-500", 0);
    }
}

// ==========================================================================
// 3. GLOBAL FULLSCREEN EVENT LISTENERS
// ==========================================================================
// Tracks which instance initiated a fullscreen request to correctly update its button icon.
window.currentlyAttemptingFullscreenInstanceSuffix = "";

/**
 * Sets up global event listeners for fullscreen changes.
 * This allows updating the correct instance's fullscreen button icon.
 */
export function setupGlobalPdfViewerListeners() {
    const handleGlobalFullscreenChange = () => {
        const isFs = !!(document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
        const trackedSuffix = window.currentlyAttemptingFullscreenInstanceSuffix; // Get the suffix of instance that requested fullscreen

        console.log(`[PdfCore] Fullscreen change detected. Is fullscreen: ${isFs}. Tracked suffix for button update: '${trackedSuffix}'`);
        updateFullscreenButtonIcon(isFs, trackedSuffix); // Update specific instance's button

        // Reset tracker if exiting fullscreen globally or if no specific instance was tracked
        if (!isFs) {
            window.currentlyAttemptingFullscreenInstanceSuffix = "";
        }
    };

    // Remove any existing listeners to prevent duplicates if called multiple times
    document.removeEventListener('fullscreenchange', handleGlobalFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', handleGlobalFullscreenChange);
    document.removeEventListener('mozfullscreenchange', handleGlobalFullscreenChange);
    document.removeEventListener('MSFullscreenChange', handleGlobalFullscreenChange);

    document.addEventListener('fullscreenchange', handleGlobalFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleGlobalFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleGlobalFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleGlobalFullscreenChange);
    console.log("[PdfCore] Global fullscreen change listeners have been set up.");
}

// ==========================================================================
// 4. INSTANCE-SPECIFIC PDF RENDERING & STATE MANAGEMENT
// ==========================================================================

/**
 * Renders a specific page of a loaded PDF document into the canvas of a given instance.
 * @param {number} pageNumToRender - The page number to render.
 * @param {string} instanceSuffix - The suffix identifying the PDF viewer instance.
 * @returns {Promise<boolean>} True if rendering was successful, false otherwise.
 */
export async function renderPdfPage(pageNumToRender, instanceSuffix = "") {
    const suffixLog = `[PdfCore/${instanceSuffix || 'default'}]`;
    console.log(`${suffixLog} Attempting to render page ${pageNumToRender}.`);

    const pdfDoc = window[`pdfDoc${instanceSuffix}`];
    const currentScale = window[`currentPdfScale${instanceSuffix}`] || DEFAULT_PDF_SCALE;
    const pdfCanvas = document.getElementById(`pdfCanvas${instanceSuffix}`);
    const pageNumSpan = document.getElementById(`pageNum${instanceSuffix}`);
    const selectionCanvas = document.getElementById(`selectionCanvas${instanceSuffix}`);
    const captureBtn = document.getElementById(`captureSelectionBtn${instanceSuffix}`);
    const pdfCanvasContainer = document.getElementById(`pdfCanvasContainer${instanceSuffix}`);

    if (!pdfDoc) {
        console.error(`${suffixLog} pdfDoc object is null. Cannot render page.`);
        showPdfPlaceholder('未加载PDF文档。', instanceSuffix);
        window[`pageRendering${instanceSuffix}`] = false;
        updateZoomControls(instanceSuffix); // Ensure controls are correctly disabled
        return false;
    }
    if (!pdfCanvas || typeof pdfCanvas.getContext !== 'function') {
        console.error(`${suffixLog} PDF canvas element (id: pdfCanvas${instanceSuffix}) not found or not a canvas. Cannot render.`);
        window[`pageRendering${instanceSuffix}`] = false;
        updateZoomControls(instanceSuffix);
        return false;
    }

    // Cancel any ongoing render task for this instance
    const existingRenderTask = window[`currentRenderTask${instanceSuffix}`];
    if (existingRenderTask && typeof existingRenderTask.cancel === 'function') {
        existingRenderTask.cancel();
        console.log(`${suffixLog} Previous render task for page ${window[`currentPageNum${instanceSuffix}`]} cancelled.`);
    }

    window[`pageRendering${instanceSuffix}`] = true;
    if (pageNumSpan) pageNumSpan.textContent = pageNumToRender;

    // Reset scroll position of the canvas container
    if (pdfCanvasContainer) {
        pdfCanvasContainer.scrollTop = 0;
        pdfCanvasContainer.scrollLeft = 0;
    }

    try {
        const page = await pdfDoc.getPage(pageNumToRender);
        const viewport = page.getViewport({ scale: currentScale });
        const canvasContext = pdfCanvas.getContext('2d');

        pdfCanvas.height = viewport.height;
        pdfCanvas.width = viewport.width;
        console.log(`${suffixLog} Canvas dimensions set to ${pdfCanvas.width}x${pdfCanvas.height} for page ${pageNumToRender}.`);

        // Prepare selection canvas
        if (selectionCanvas) {
            const selCtx = selectionCanvas.getContext('2d');
            if (selCtx) selCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
            selectionCanvas.width = pdfCanvas.width;
            selectionCanvas.height = pdfCanvas.height;
            window[`selectionCtx${instanceSuffix}`] = selCtx; // Ensure context is updated
        }

        if (captureBtn) captureBtn.classList.add('hidden'); // Hide capture button until new selection
        window[`isSelecting${instanceSuffix}`] = false;
        window[`selectionRect${instanceSuffix}`] = { startX:0, startY:0, endX:0, endY:0, pageNum: pageNumToRender, finalX:0, finalY:0, finalWidth:0, finalHeight:0 };

        const renderContext = { canvasContext, viewport };
        const renderTask = page.render(renderContext);
        window[`currentRenderTask${instanceSuffix}`] = renderTask;

        await renderTask.promise;
        console.log(`${suffixLog} Page ${pageNumToRender} rendered successfully.`);

        window[`pageRendering${instanceSuffix}`] = false;
        window[`currentRenderTask${instanceSuffix}`] = null;
        window[`currentPageNum${instanceSuffix}`] = pageNumToRender; // Update current page number *after* successful render

        const pendingPage = window[`pageNumPending${instanceSuffix}`];
        if (pendingPage !== null && pendingPage !== undefined) {
            window[`pageNumPending${instanceSuffix}`] = null;
            console.log(`${suffixLog} Found pending page ${pendingPage}, queuing it now.`);
            queueCoreRenderPage(pendingPage, instanceSuffix); // Use queueCoreRenderPage consistently
        }

        updatePdfNavButtons(instanceSuffix);
        updateZoomControls(instanceSuffix);
        return true;

    } catch (error) {
        window[`pageRendering${instanceSuffix}`] = false;
        window[`currentRenderTask${instanceSuffix}`] = null;
        if (error.name === 'RenderingCancelledException' || error.message?.includes('Rendering cancelled')) {
            console.log(`${suffixLog} Rendering of page ${pageNumToRender} was cancelled.`);
        } else {
            console.error(`${suffixLog} Error rendering page ${pageNumToRender}:`, error);
            if(typeof showStatus === "function") showStatus(`渲染PDF页面 ${pageNumToRender} (实例: ${instanceSuffix}) 失败: ${error.message || '未知渲染错误'}`, "text-red-500", 5000);
            showPdfPlaceholder(`渲染页面 ${pageNumToRender} 失败。请尝试重新加载PDF。`, instanceSuffix);
        }
        updatePdfNavButtons(instanceSuffix); // Still update nav buttons in case of error
        updateZoomControls(instanceSuffix);
        return false;
    }
}

/**
 * Queues a page to be rendered. If not already rendering, renders immediately.
 * @param {number} pageNumToQueue - The page number to queue/render.
 * @param {string} instanceSuffix - The PDF viewer instance suffix.
 */
export function queueRenderPage(pageNumToQueue, instanceSuffix = "") { // Renamed from queueCoreRenderPage for clarity
    const suffixLog = `[PdfCore/${instanceSuffix || 'default'}]`;
    console.log(`${suffixLog} Request to queue/render page ${pageNumToQueue}. Current rendering state: ${window[`pageRendering${instanceSuffix}`]}`);

    if (window[`pageRendering${instanceSuffix}`]) {
        window[`pageNumPending${instanceSuffix}`] = pageNumToQueue;
        console.log(`${suffixLog} Page ${pageNumToQueue} queued as pending.`);
        // Optionally, cancel current task if new page is different and immediate switch is desired.
        // For now, it waits for current render to finish or be cancelled by a new direct renderPdfPage call.
    } else {
        renderPdfPage(pageNumToQueue, instanceSuffix).catch(err => {
            console.warn(`${suffixLog} Error from direct render in queueRenderPage for page ${pageNumToQueue}:`, err.message);
        });
    }
}


/**
 * Cleans up the state of a specific PDF viewer instance.
 * @param {boolean} destroyPdfDoc - Whether to destroy the pdfDoc object (releases memory).
 * @param {string} instanceSuffix - The PDF viewer instance suffix.
 */
export async function cleanupPdfViewerState(destroyPdfDoc = true, instanceSuffix = "") {
    const suffixLog = `[PdfCore/${instanceSuffix || 'default'}]`;
    console.log(`${suffixLog} Cleaning up PDF viewer state. Destroy pdfDoc: ${destroyPdfDoc}`);

    const currentRenderTask = window[`currentRenderTask${instanceSuffix}`];
    if (currentRenderTask && typeof currentRenderTask.cancel === 'function') {
        currentRenderTask.cancel();
        console.log(`${suffixLog} Active render task cancelled during cleanup.`);
    }
    window[`currentRenderTask${instanceSuffix}`] = null;

    const pdfDocToClean = window[`pdfDoc${instanceSuffix}`];
    if (destroyPdfDoc && pdfDocToClean && typeof pdfDocToClean.destroy === 'function') {
        try {
            await pdfDocToClean.destroy();
            console.log(`${suffixLog} pdfDoc object destroyed successfully.`);
        } catch (err) {
            console.error(`${suffixLog} Error destroying pdfDoc object:`, err);
        }
    }
    window[`pdfDoc${instanceSuffix}`] = null;
    window[`currentPageNum${instanceSuffix}`] = 1;
    window[`currentPdfScale${instanceSuffix}`] = DEFAULT_PDF_SCALE;
    window[`currentPdfFileObject${instanceSuffix}`] = null;
    // currentViewingArticleRowId and currentViewingRecordDbId are typically reset by the calling logic
    // when a new PDF is loaded or viewer is closed, not necessarily here.
    window[`pageRendering${instanceSuffix}`] = false;
    window[`pageNumPending${instanceSuffix}`] = null;

    // Reset UI elements for this instance
    const pageNumSpan = document.getElementById(`pageNum${instanceSuffix}`);
    const pageCountSpan = document.getElementById(`pageCount${instanceSuffix}`);
    const pdfCanvas = document.getElementById(`pdfCanvas${instanceSuffix}`);
    const selectionCanvas = document.getElementById(`selectionCanvas${instanceSuffix}`);
    const captureBtn = document.getElementById(`captureSelectionBtn${instanceSuffix}`);
    const pdfCanvasContainer = document.getElementById(`pdfCanvasContainer${instanceSuffix}`);

    if (pageNumSpan) pageNumSpan.textContent = '0';
    if (pageCountSpan) pageCountSpan.textContent = '0';
    if (pdfCanvas && typeof pdfCanvas.getContext === 'function') {
        const ctx = pdfCanvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
        pdfCanvas.width = 0; // Effectively hide/reset canvas content
        pdfCanvas.height = 0;
    }
    if (selectionCanvas && typeof selectionCanvas.getContext === 'function') {
        const selCtx = selectionCanvas.getContext('2d');
        if (selCtx) selCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
        selectionCanvas.width = 0;
        selectionCanvas.height = 0;
    }
    if (captureBtn) captureBtn.classList.add('hidden');

    const existingPlaceholder = pdfCanvasContainer?.querySelector('.pdf-placeholder-message');
    if (existingPlaceholder) existingPlaceholder.remove(); // Remove any old placeholder

    updatePdfNavButtons(instanceSuffix);
    updateZoomControls(instanceSuffix);
    console.log(`${suffixLog} PDF viewer state cleanup complete.`);
}


// ==========================================================================
// 5. INSTANCE-SPECIFIC UI CONTROL UPDATERS (Zoom, Nav, Fullscreen Button)
// ==========================================================================

/**
 * Updates the zoom control buttons and display for a given instance.
 * @param {string} instanceSuffix - The PDF viewer instance suffix.
 * @param {boolean|null} zoomIn - True to zoom in, false to zoom out, null to just update display.
 */
export function updateZoomControls(instanceSuffix = "", zoomIn = null) {
    const suffixLog = `[PdfCore/${instanceSuffix || 'default'}]`;
    const pdfDoc = window[`pdfDoc${instanceSuffix}`];
    const pageRendering = window[`pageRendering${instanceSuffix}`];
    let currentScale = window[`currentPdfScale${instanceSuffix}`] || DEFAULT_PDF_SCALE;

    const zoomLevelSpan = document.getElementById(`zoomLevelSpan${instanceSuffix}`);
    const zoomInBtn = document.getElementById(`zoomInBtn${instanceSuffix}`);
    const zoomOutBtn = document.getElementById(`zoomOutBtn${instanceSuffix}`);

    if (!zoomLevelSpan || !zoomInBtn || !zoomOutBtn) {
        console.warn(`${suffixLog} Zoom control DOM elements not found for instance '${instanceSuffix}'.`);
        return;
    }

    if (zoomIn !== null && pdfDoc && !pageRendering) {
        if (zoomIn && currentScale < MAX_PDF_SCALE) {
            currentScale = parseFloat(Math.min(MAX_PDF_SCALE, currentScale + PDF_SCALE_INCREMENT).toFixed(2));
        } else if (!zoomIn && currentScale > MIN_PDF_SCALE) {
            currentScale = parseFloat(Math.max(MIN_PDF_SCALE, currentScale - PDF_SCALE_INCREMENT).toFixed(2));
        }
        window[`currentPdfScale${instanceSuffix}`] = currentScale;
        queueRenderPage(window[`currentPageNum${instanceSuffix}`] || 1, instanceSuffix);
    }

    zoomLevelSpan.textContent = `${Math.round(currentScale * 100)}%`;
    zoomInBtn.disabled = (!pdfDoc || pageRendering || currentScale >= MAX_PDF_SCALE);
    zoomOutBtn.disabled = (!pdfDoc || pageRendering || currentScale <= MIN_PDF_SCALE);
}

/**
 * Updates the enabled/disabled state of PDF navigation buttons (prev/next page) for an instance.
 * @param {string} instanceSuffix - The PDF viewer instance suffix.
 */
export function updatePdfNavButtons(instanceSuffix = "") {
    // ... (Implementation from previous response, ensure it correctly uses getElementById with suffix)
    const suffixLog = `[PdfCore/${instanceSuffix || 'default'}]`;
    const pdfDoc = window[`pdfDoc${instanceSuffix}`];
    const currentPageNum = window[`currentPageNum${instanceSuffix}`] || 1;

    const prevBtn = document.getElementById(`prevPageBtn${instanceSuffix}`);
    const nextBtn = document.getElementById(`nextPageBtn${instanceSuffix}`);

    if (!prevBtn || !nextBtn) {
        // console.warn(`${suffixLog} Navigation buttons not found for instance '${instanceSuffix}'.`);
        return;
    }

    if (!pdfDoc || typeof pdfDoc.numPages !== 'number' || pdfDoc.numPages <= 0) {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }
    prevBtn.disabled = (currentPageNum <= 1);
    nextBtn.disabled = (currentPageNum >= pdfDoc.numPages);
}

/**
 * Updates the fullscreen button icon (expand/compress) for a given instance.
 * @param {boolean} isCurrentlyFullscreen - Whether the viewer is currently in fullscreen mode.
 * @param {string} instanceSuffix - The PDF viewer instance suffix.
 */
export function updateFullscreenButtonIcon(isCurrentlyFullscreen, instanceSuffix = "") {
    // ... (Implementation from previous response, ensure it correctly uses getElementById with suffix)
    const suffixLog = `[PdfCore/${instanceSuffix || 'default'}]`;
    const fullscreenBtn = document.getElementById(`fullscreenBtn${instanceSuffix}`);
    if (!fullscreenBtn) {
        // console.warn(`${suffixLog} Fullscreen button not found for instance '${instanceSuffix}'. This might be normal if called by global listener for an inactive instance.`);
        return;
    }
    fullscreenBtn.innerHTML = isCurrentlyFullscreen ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
    fullscreenBtn.title = isCurrentlyFullscreen ? '退出全屏' : '切换全屏';
}


// ==========================================================================
// 6. INSTANCE-SPECIFIC EVENT HANDLERS & INPUT PROCESSING
// ==========================================================================

/**
 * Handles the selection of a local PDF file for a specific instance.
 * @param {Event} event - The file input change event.
 * @param {string} instanceSuffix - The PDF viewer instance suffix.
 */
export function handlePdfFileSelected(event, instanceSuffix = "") {
    // ... (Implementation from previous response, ensure calling loadPdfFileObjectIntoViewer with suffix)
    const file = event.target.files[0];
    if (file) {
        if (file.type === "application/pdf") {
            loadPdfFileObjectIntoViewer(file, instanceSuffix);
        } else {
            alert("请选择一个有效的PDF文件 (文件类型应为 .pdf)。");
            if(typeof showStatus === "function") showStatus("选择的文件不是有效的PDF格式。", "text-red-500", 3000);
        }
    }
    if (event.target) event.target.value = null; // Reset file input
}

/**
 * Loads a PDF from a File object into a specific viewer instance.
 * @param {File} fileObject - The PDF File object.
 * @param {string} instanceSuffix - The PDF viewer instance suffix.
 */
export async function loadPdfFileObjectIntoViewer(fileObject, instanceSuffix = "") {
    // ... (Implementation from previous response, ensure all state and DOM uses suffix)
    // ... Ensure cleanupPdfViewerState, renderPdfPage, displayScreenshotsForCurrentArticle are called with suffix.
    const suffixLog = `[PdfCore/${instanceSuffix || 'default'}]`;
    const pdfViewerTitle = document.getElementById(`pdfViewerTitle${instanceSuffix}`);
    const pageCountSpan = document.getElementById(`pageCount${instanceSuffix}`);
    const pageNumSpan = document.getElementById(`pageNum${instanceSuffix}`);

    if (!fileObject || fileObject.type !== "application/pdf") {
        if(typeof showStatus === "function") showStatus(`加载本地PDF失败${suffixLog}：提供的文件无效或非PDF格式。`, "text-red-500", 4000);
        updateZoomControls(instanceSuffix); // Reset zoom controls if file is invalid
        return;
    }

    window[`currentPdfFileObject${instanceSuffix}`] = fileObject;
    if(typeof showStatus === "function") showStatus(`正在加载本地PDF: ${truncateText(fileObject.name, 30)}${suffixLog}...`, 'text-blue-500', 0);

    if (pdfViewerTitle) pdfViewerTitle.textContent = `PDF: ${truncateText(fileObject.name, 40)}`;
    window[`currentPdfScale${instanceSuffix}`] = DEFAULT_PDF_SCALE;

    const fileReader = new FileReader();
    fileReader.onload = async function() {
        const typedarray = new Uint8Array(this.result);
        try {
            await cleanupPdfViewerState(true, instanceSuffix); // Clean previous state for this instance

            const loadingTask = pdfjsLib.getDocument({ data: typedarray });
            const pdfDoc = await loadingTask.promise;
            window[`pdfDoc${instanceSuffix}`] = pdfDoc;
            console.log(`${suffixLog} New pdfDoc loaded from File object. Pages: ${pdfDoc.numPages}`);

            if (pageCountSpan) pageCountSpan.textContent = pdfDoc.numPages;
            window[`currentPageNum${instanceSuffix}`] = 1;
            if (pageNumSpan) pageNumSpan.textContent = '1';

            updatePdfNavButtons(instanceSuffix);
            updateZoomControls(instanceSuffix);

            const renderSuccess = await renderPdfPage(1, instanceSuffix);
            if(renderSuccess) {
                if(typeof showStatus === "function") showStatus(`本地PDF ${truncateText(fileObject.name, 20)}${suffixLog} 加载完成。`, 'text-green-500', 3000);
                if (typeof displayScreenshotsForCurrentArticle === "function") {
                     // Uses window[`currentViewingArticleRowId${instanceSuffix}`]
                    displayScreenshotsForCurrentArticle(window[`currentViewingArticleRowId${instanceSuffix}`], instanceSuffix);
                }
            } // renderPdfPage handles its own error messages
        } catch (error) {
            console.error(`${suffixLog} Error loading PDF from File object:`, error);
            if(typeof showStatus === "function") showStatus(`加载本地PDF ${truncateText(fileObject.name, 20)}${suffixLog} 失败: ${error.message || '未知错误'}`, 'text-red-500', 5000);
            await cleanupPdfViewerState(false, instanceSuffix); // Clean up but don't try to destroy a potentially non-existent doc
        }
    };
    fileReader.onerror = (error) => {
        console.error(`${suffixLog} FileReader error for ${fileObject.name}:`, error);
        if(typeof showStatus === "function") showStatus(`读取文件 ${truncateText(fileObject.name, 20)}${suffixLog} 失败。文件可能已损坏。`, "text-red-500", 5000);
        updateZoomControls(instanceSuffix);
    };
    fileReader.readAsArrayBuffer(fileObject);
}

/**
 * Loads a PDF from a URL into a specific viewer instance.
 * @param {string} pdfUrl - The URL of the PDF.
 * @param {string} instanceSuffix - The PDF viewer instance suffix.
 */
export async function loadPdfFromUrl(pdfUrl, instanceSuffix = "") {
    // ... (Implementation from previous response, ensure all state and DOM uses suffix)
    // ... Ensure cleanupPdfViewerState, renderPdfPage, displayScreenshotsForCurrentArticle are called with suffix.
    // ... Uses proxyPdfDownloadApi for external URLs.
    const suffixLog = `[PdfCore/${instanceSuffix || 'default'}]`;
    if (!pdfUrl || typeof pdfUrl !== 'string' || pdfUrl.trim() === '') {
        if(typeof showStatus === "function") showStatus("无效的PDF链接提供。", "text-red-500", 3000);
        showPdfPlaceholder('无效的PDF链接。', instanceSuffix);
        return;
    }
    if(typeof showStatus === "function") showStatus(`正在从链接加载PDF ${suffixLog}...`, 'text-blue-500', 0);
    window[`currentPdfFileObject${instanceSuffix}`] = null; // Clear any local file object

    const pdfViewerTitle = document.getElementById(`pdfViewerTitle${instanceSuffix}`);
    const pageCountSpan = document.getElementById(`pageCount${instanceSuffix}`);
    const pageNumSpan = document.getElementById(`pageNum${instanceSuffix}`);

    if (pdfViewerTitle) {
        try {
            const urlFilename = new URL(pdfUrl).pathname.split('/').pop();
            pdfViewerTitle.textContent = `PDF: ${truncateText(decodeURIComponent(urlFilename) || '远程文件', 40)}`;
        } catch (e) {
            pdfViewerTitle.textContent = `PDF: ${truncateText(pdfUrl, 40)}`;
        }
    }
    window[`currentPdfScale${instanceSuffix}`] = DEFAULT_PDF_SCALE;

    let pdfDataSource;
    const isExternalHttpUrl = pdfUrl.toLowerCase().startsWith('http://') || pdfUrl.toLowerCase().startsWith('https://');

    try {
        await cleanupPdfViewerState(true, instanceSuffix); // Clean instance state

        if (isExternalHttpUrl) {
            if(typeof showStatus === "function") showStatus(`通过后端代理加载PDF: ${truncateText(pdfUrl,30)}${suffixLog}...`, 'text-blue-500', 0);
            const pdfBlob = await proxyPdfDownloadApi(pdfUrl); // From api.js
            if (!pdfBlob) {
                throw new Error("未能通过代理获取PDF文件数据。检查网络和服务器日志。");
            }
            const arrayBuffer = await pdfBlob.arrayBuffer();
            pdfDataSource = new Uint8Array(arrayBuffer);
        } else {
            // For non-http(s) URLs (e.g., blob:, data:), pass URL directly if pdf.js supports it.
            // Or handle specific schemes if needed. Assume pdf.js handles common ones.
            pdfDataSource = { url: pdfUrl };
             console.log(`${suffixLog} Attempting to load PDF directly from non-HTTP(S) URL: ${pdfUrl}`);
        }

        const loadingTask = pdfjsLib.getDocument(pdfDataSource);
        const pdfDoc = await loadingTask.promise;
        window[`pdfDoc${instanceSuffix}`] = pdfDoc;
        console.log(`${suffixLog} New pdfDoc loaded from URL. Pages: ${pdfDoc.numPages}`);

        if (pageCountSpan) pageCountSpan.textContent = pdfDoc.numPages;
        window[`currentPageNum${instanceSuffix}`] = 1;
        if (pageNumSpan) pageNumSpan.textContent = '1';

        updatePdfNavButtons(instanceSuffix);
        updateZoomControls(instanceSuffix);

        const renderSuccess = await renderPdfPage(1, instanceSuffix);
        if (renderSuccess) {
            if(typeof showStatus === "function") showStatus(`PDF从链接 ${truncateText(pdfUrl,20)}${suffixLog} 加载完成。`, 'text-green-500', 3000);
            if (typeof displayScreenshotsForCurrentArticle === "function") {
                displayScreenshotsForCurrentArticle(window[`currentViewingArticleRowId${instanceSuffix}`], instanceSuffix);
            }
        }
    } catch (error) {
        console.error(`${suffixLog} Error loading PDF from URL '${pdfUrl}':`, error);
        if(typeof showStatus === "function") showStatus(`从链接加载PDF ${truncateText(pdfUrl,20)}${suffixLog} 失败: ${error.message || '未知错误'}`, 'text-red-500', 7000);
        await cleanupPdfViewerState(false, instanceSuffix);
        showPdfPlaceholder(`加载PDF失败: ${error.message || '请检查链接或网络。'}`, instanceSuffix);
    }
}

/**
 * Toggles fullscreen mode for the PDF viewer content of a specific instance.
 * @param {string} instanceSuffix - The PDF viewer instance suffix.
 */
export function togglePdfViewerFullscreen(instanceSuffix = "") {
    // ... (Implementation from previous response, ensure it targets `pdfViewerModalContent${instanceSuffix}`)
    // ... And uses window.currentlyAttemptingFullscreenInstanceSuffix = instanceSuffix;
    const suffixLog = `[PdfCore/${instanceSuffix || 'default'}]`;
    // Target the modal content area for fullscreen for better control
    const elemToFullscreen = document.getElementById(`pdfViewerModalContent${instanceSuffix}`) || document.getElementById(`pdfViewerModal${instanceSuffix}`);

    if (!elemToFullscreen) {
        console.error(`${suffixLog} Fullscreen target element (pdfViewerModalContent${instanceSuffix} or pdfViewerModal${instanceSuffix}) not found.`);
        return;
    }

    const isInFullscreen = !!(document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement);

    if (!isInFullscreen) {
        window.currentlyAttemptingFullscreenInstanceSuffix = instanceSuffix; // Track which instance requested it
        console.log(`${suffixLog} Requesting fullscreen for element. Stored suffix for button update: '${instanceSuffix}'`);
        if (elemToFullscreen.requestFullscreen) elemToFullscreen.requestFullscreen().catch(err => console.error(`${suffixLog} Error requesting fullscreen: ${err.message}`, err));
        else if (elemToFullscreen.webkitRequestFullscreen) elemToFullscreen.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT); // Safari
        else if (elemToFullscreen.mozRequestFullScreen) elemToFullscreen.mozRequestFullScreen(); // Firefox
        else if (elemToFullscreen.msRequestFullscreen) elemToFullscreen.msRequestFullscreen(); // IE/Edge
        else console.error(`${suffixLog} Fullscreen API not supported by this browser.`);
    } else {
        console.log(`${suffixLog} Exiting fullscreen.`);
        if (document.exitFullscreen) document.exitFullscreen().catch(err => console.error(`${suffixLog} Error exiting fullscreen: ${err.message}`, err));
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
        else console.error(`${suffixLog} Exit fullscreen API not supported by this browser.`);
        // window.currentlyAttemptingFullscreenInstanceSuffix = ""; // Reset on explicit exit, though global listener also handles this.
    }
}


// ==========================================================================
// 7. INSTANCE-SPECIFIC SELECTION CANVAS LISTENERS
// ==========================================================================
/**
 * 初始化PDF查看器的选择画布事件监听器。
 * @param {string} instanceSuffix - PDF查看器实例的后缀。
 */
export function initializeSelectionCanvasListeners(instanceSuffix = "") {
    const suffixLog = `[PdfCore/${instanceSuffix || 'default'}]`;
    const selectionCanvas = document.getElementById(`selectionCanvas${instanceSuffix}`);
    const captureBtn = document.getElementById(`captureSelectionBtn${instanceSuffix}`);

    if (!selectionCanvas || !captureBtn) {
        console.warn(`${suffixLog} Selection canvas or capture button not found for instance '${instanceSuffix}'. Selection will not work.`);
        return;
    }

    // 获取鼠标在画布上的相对位置
    const getMousePos = (canvas, evt) => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: evt.clientX - rect.left,
            y: evt.clientY - rect.top
        };
    };

    // 处理鼠标按下事件
    selectionCanvas.addEventListener('mousedown', (e) => {
        if (!window[`pdfDoc${instanceSuffix}`]) return; // 如果没有加载PDF，不处理

        const pos = getMousePos(selectionCanvas, e);
        window[`isSelecting${instanceSuffix}`] = true;
        window[`selectionRect${instanceSuffix}`] = {
            startX: pos.x,
            startY: pos.y,
            endX: pos.x,
            endY: pos.y,
            pageNum: window[`currentPageNum${instanceSuffix}`],
            finalX: 0,
            finalY: 0,
            finalWidth: 0,
            finalHeight: 0
        };
        captureBtn.classList.add('hidden');
    });

    // 处理鼠标移动事件
    selectionCanvas.addEventListener('mousemove', (e) => {
        if (!window[`isSelecting${instanceSuffix}`]) return;

        const pos = getMousePos(selectionCanvas, e);
        const rect = window[`selectionRect${instanceSuffix}`];
        rect.endX = pos.x;
        rect.endY = pos.y;

        // 计算最终的选择区域
        rect.finalX = Math.min(rect.startX, rect.endX);
        rect.finalY = Math.min(rect.startY, rect.endY);
        rect.finalWidth = Math.abs(rect.endX - rect.startX);
        rect.finalHeight = Math.abs(rect.endY - rect.startY);

        // 重绘选择区域
        const ctx = window[`selectionCtx${instanceSuffix}`];
        if (ctx) {
            ctx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
            ctx.strokeStyle = '#00f';
            ctx.lineWidth = 2;
            ctx.strokeRect(rect.finalX, rect.finalY, rect.finalWidth, rect.finalHeight);
            ctx.fillStyle = 'rgba(0, 0, 255, 0.1)';
            ctx.fillRect(rect.finalX, rect.finalY, rect.finalWidth, rect.finalHeight);
        }
    });

    // 处理鼠标释放或离开事件
    const handleMouseUpOrLeave = (e) => {
        if (!window[`isSelecting${instanceSuffix}`]) return;

        const rect = window[`selectionRect${instanceSuffix}`];
        if (rect.finalWidth > 10 && rect.finalHeight > 10) {
            captureBtn.classList.remove('hidden');
        } else {
            // 如果选择区域太小，清除选择
            const ctx = window[`selectionCtx${instanceSuffix}`];
            if (ctx) {
                ctx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
            }
            window[`selectionRect${instanceSuffix}`] = {
                startX: 0,
                startY: 0,
                endX: 0,
                endY: 0,
                pageNum: window[`currentPageNum${instanceSuffix}`],
                finalX: 0,
                finalY: 0,
                finalWidth: 0,
                finalHeight: 0
            };
        }
        window[`isSelecting${instanceSuffix}`] = false;
    };

    selectionCanvas.addEventListener('mouseup', handleMouseUpOrLeave);
    selectionCanvas.addEventListener('mouseleave', handleMouseUpOrLeave);

    // 初始化选择上下文
    window[`selectionCtx${instanceSuffix}`] = selectionCanvas.getContext('2d');
    window[`isSelecting${instanceSuffix}`] = false;
    window[`selectionRect${instanceSuffix}`] = {
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
        pageNum: window[`currentPageNum${instanceSuffix}`],
        finalX: 0,
        finalY: 0,
        finalWidth: 0,
        finalHeight: 0
    };

    console.log(`${suffixLog} Selection canvas listeners initialized successfully.`);
}


// ==========================================================================
// 8. INSTANCE-SPECIFIC UTILITY (Placeholder, Error Display)
// ==========================================================================
/**
 * Displays a placeholder message on the PDF canvas area for a specific instance.
 * @param {string} message - The message to display.
 * @param {string} instanceSuffix - The PDF viewer instance suffix.
 */
export function showPdfPlaceholder(message, instanceSuffix = "") {
    const suffixLog = `[PdfCore/${instanceSuffix || 'default'}]`;
    const pdfCanvasContainer = document.getElementById(`pdfCanvasContainer${instanceSuffix}`);
    const pdfCanvas = document.getElementById(`pdfCanvas${instanceSuffix}`);

    if (!pdfCanvasContainer || !pdfCanvas) {
        console.error(`${suffixLog} Cannot show placeholder: pdfCanvasContainer (id: pdfCanvasContainer${instanceSuffix}) or pdfCanvas (id: pdfCanvas${instanceSuffix}) not found.`);
        return;
    }

    // Clear main canvas
    if (typeof pdfCanvas.getContext === 'function') {
        const ctx = pdfCanvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
    }

    // Remove any existing placeholder
    const existingPlaceholder = pdfCanvasContainer.querySelector('.pdf-placeholder-message');
    if (existingPlaceholder) existingPlaceholder.remove();

    // Create and append new placeholder
    const placeholderDiv = document.createElement('div');
    placeholderDiv.className = 'pdf-placeholder-message text-gray-500 text-center p-4 absolute inset-0 flex items-center justify-center bg-gray-100'; // Added bg for visibility
    placeholderDiv.style.zIndex = "5"; // Ensure it's above canvas if canvas still has dimensions
    placeholderDiv.textContent = message;
    pdfCanvasContainer.appendChild(placeholderDiv);
    console.log(`${suffixLog} Displaying PDF placeholder: "${message}"`);

    // Hide capture button as there's no PDF content to capture from
    const captureBtn = document.getElementById(`captureSelectionBtn${instanceSuffix}`);
    if (captureBtn) captureBtn.classList.add('hidden');

    // Reset page/count display
    const pageNumSpan = document.getElementById(`pageNum${instanceSuffix}`);
    const pageCountSpan = document.getElementById(`pageCount${instanceSuffix}`);
    if (pageNumSpan) pageNumSpan.textContent = '0';
    if (pageCountSpan) pageCountSpan.textContent = '0';

    updatePdfNavButtons(instanceSuffix); // Disable nav buttons
    updateZoomControls(instanceSuffix);   // Disable zoom buttons
}

// ==========================================================================
// 9. NAVIGATION (Instance-Specific) - Prev/Next Page
// ==========================================================================
/**
 * Navigates to the previous page for a given PDF instance.
 * @param {string} instanceSuffix - The PDF viewer instance suffix.
 */
export function onPrevPage(instanceSuffix = "") {
    const suffixLog = `[PdfCore/${instanceSuffix || 'default'}]`;
    const pdfDoc = window[`pdfDoc${instanceSuffix}`];
    let currentPageNum = window[`currentPageNum${instanceSuffix}`] || 1;

    if (!pdfDoc || currentPageNum <= 1) {
        console.warn(`${suffixLog} Cannot go to previous page. pdfDoc: ${!!pdfDoc}, currentPage: ${currentPageNum}`);
        return;
    }
    currentPageNum--;
    // window[`currentPageNum${instanceSuffix}`] = currentPageNum; // renderPdfPage will update this upon success
    console.log(`${suffixLog} Navigating to previous page: ${currentPageNum}.`);
    queueRenderPage(currentPageNum, instanceSuffix);
}

/**
 * Navigates to the next page for a given PDF instance.
 * @param {string} instanceSuffix - The PDF viewer instance suffix.
 */
export function onNextPage(instanceSuffix = "") {
    const suffixLog = `[PdfCore/${instanceSuffix || 'default'}]`;
    const pdfDoc = window[`pdfDoc${instanceSuffix}`];
    let currentPageNum = window[`currentPageNum${instanceSuffix}`] || 1;

    if (!pdfDoc || !pdfDoc.numPages || currentPageNum >= pdfDoc.numPages) {
        console.warn(`${suffixLog} Cannot go to next page. pdfDoc: ${!!pdfDoc}, numPages: ${pdfDoc?.numPages}, currentPage: ${currentPageNum}`);
        return;
    }
    currentPageNum++;
    // window[`currentPageNum${instanceSuffix}`] = currentPageNum; // renderPdfPage will update this upon success
    console.log(`${suffixLog} Navigating to next page: ${currentPageNum}.`);
    queueRenderPage(currentPageNum, instanceSuffix);
}

// ==========================================================================
// FINAL LOG
// ==========================================================================
console.log("pdfViewerCore.js (Production Grade) loaded: PDF viewing core functions are available.");