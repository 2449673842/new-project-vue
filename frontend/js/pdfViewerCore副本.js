// js/pdfViewerCore.js

// 这个文件包含所有与PDF.js渲染、导航、缩放、加载PDF文件以及截图选区相关的核心逻辑。
// 它会依赖 main_index.js 中定义的全局变量（如 pdfDoc, currentPageNum, currentPdfScale,
// currentPdfFileObject, currentViewingArticleRowId, isSelecting, selectionRect, selectionCtx）
// 和DOM元素引用（如 pdfViewerTitle, pdfCanvas, pageNumSpan, pageCountSpan, prevPageBtn,
// nextPageBtn, zoomInBtn, zoomOutBtn, zoomLevelSpan, selectionCanvas, captureSelectionBtn,
// pdfViewerModalContent, fullscreenBtn, pdfCanvasContainer）。
// 它也会调用 utils.js 中的函数（如 showStatus, updateZoomControls -- 后者可能移到这里）。
// 以及 config.js 中的常量 (如 DEFAULT_PDF_SCALE, MIN_PDF_SCALE, MAX_PDF_SCALE, PDF_SCALE_INCREMENT)
// 它还会调用 screenshotManager.js 中的 displayScreenshotsForCurrentArticle。
import { findHeader, truncateText, showStatus /* 其他需要的工具函数 */ } from './utils.js';
import { COLUMN_MAPPING, DEFAULT_PDF_SCALE /* 其他需要的配置 */ } from './config.js';
// 确保导入了 displayScreenshotsForCurrentArticle (来自 screenshotManager.js)
// 和 saveTableDataToLocalStorage (来自 dataManager.js) 如果在此文件直接调用
import { displayScreenshotsForCurrentArticle } from './screenshotManager.js';
import { saveTableDataToLocalStorage } from './dataManager.js';



/**
 * 初始化 PDF.js worker 的路径。
 * 应在 main_index.js 的 DOMContentLoaded 早期调用。
 */
function initializePdfJsWorker() {
    if (typeof pdfjsLib !== 'undefined') {
        // 确保路径相对于您的 HTML 文件是正确的
        pdfjsLib.GlobalWorkerOptions.workerSrc = '../pdf.js/build/pdf.worker.js';
        console.log("pdfViewerCore.js: PDF.js worker SRC configured to:", pdfjsLib.GlobalWorkerOptions.workerSrc);
    } else {
        console.error("pdfViewerCore.js: PDF.js library (pdfjsLib) not loaded! PDF functionality will be unavailable.");
        if (typeof showStatus === "function") showStatus("PDF.js核心库未能加载，PDF相关功能无法使用。", "text-red-500");
    }
}

/**
 * 渲染指定页码的PDF页面到Canvas上。
 * @param {number} num 要渲染的页码。
 * @returns {Promise<boolean>} 渲染是否成功。
 */
async function renderPdfPage(num, instanceSuffix = "") {
    // 依赖全局变量: window.pdfDoc, window.currentPageNum, window.currentPdfScale,
    //               window.pageRendering, window.pageNumPending, window.currentRenderTask,
    //               window.isSelecting, window.selectionRect, window.selectionCtx
    // 依赖DOM元素: window.pdfCanvas, window.pageNumSpan, window.selectionCanvas,
    //              window.captureSelectionBtn, window.pdfCanvasContainer
    // 调用函数: updatePdfNavButtons (本文件), updateZoomControls (本文件), queueRenderPage (本文件)

    const pdfDocInstance = window[`pdfDoc${instanceSuffix}`];
    const currentPdfScaleInstance = window[`currentPdfScale${instanceSuffix}`];
    // ... 其他实例特定的状态变量 ...

    // 获取特定实例的DOM元素
    const pdfCanvasElem = document.getElementById(`pdfCanvas${instanceSuffix}`);
    const pageNumSpanElem = document.getElementById(`pageNum${instanceSuffix}`);
    const selectionCanvasElem = document.getElementById(`selectionCanvas${instanceSuffix}`);
    const captureSelectionBtnElem = document.getElementById(`captureSelectionBtn${instanceSuffix}`);
    const pdfCanvasContainerElem = document.getElementById(`pdfCanvasContainer${instanceSuffix}`);

    console.log(`renderPdfPage[${instanceSuffix}]: num=${num}, pdfDocInstance is:`, pdfDocInstance, "pdfCanvasElem is:", pdfCanvasElem);

    if (!pdfDocInstance || !pdfCanvasElem || typeof pdfCanvasElem.getContext !== 'function') {
        console.error(`renderPdfPage[${instanceSuffix}]: pdfDocInstance or pdfCanvas${instanceSuffix} element not available or not a canvas.`);
        window[`pageRendering${instanceSuffix}`] = false;
        if (typeof updateZoomControls === "function") updateZoomControls(instanceSuffix);
        return Promise.reject(new Error("PDF document or canvas not ready for instance " + instanceSuffix));
    }

    // 取消特定实例的渲染任务
    const currentRenderTaskInstance = window[`currentRenderTask${instanceSuffix}`];
    if (currentRenderTaskInstance && typeof currentRenderTaskInstance.cancel === 'function') {
        currentRenderTaskInstance.cancel();
        window[`pageRendering${instanceSuffix}`] = false;
    }

    window[`pageRendering${instanceSuffix}`] = true;
    if (pageNumSpanElem) pageNumSpanElem.textContent = num;

    if (pdfCanvasContainerElem) {
        pdfCanvasContainerElem.scrollTop = 0;
        pdfCanvasContainerElem.scrollLeft = 0;
    }

    try {
        const page = await pdfDocInstance.getPage(num);
        const viewport = page.getViewport({ scale: currentPdfScaleInstance });
        const canvasContext = pdfCanvasElem.getContext('2d');
        pdfCanvasElem.height = viewport.height;
        pdfCanvasElem.width = viewport.width;

        // 更新实例特定的选框画布
        if (selectionCanvasElem) {
            window[`selectionCtx${instanceSuffix}`] = window[`selectionCtx${instanceSuffix}`] || selectionCanvasElem.getContext('2d');
            if(window[`selectionCtx${instanceSuffix}`]) window[`selectionCtx${instanceSuffix}`].clearRect(0, 0, selectionCanvasElem.width, selectionCanvasElem.height);
            selectionCanvasElem.width = pdfCanvasElem.width;
            selectionCanvasElem.height = pdfCanvasElem.height;
        }

        if (captureSelectionBtnElem) captureSelectionBtnElem.classList.add('hidden');
        window[`isSelecting${instanceSuffix}`] = false;
        window[`selectionRect${instanceSuffix}`] = { /* ... initial state ... */ pageNum: num };


        const renderContext = { canvasContext: canvasContext, viewport: viewport };
        window[`currentRenderTask${instanceSuffix}`] = page.render(renderContext);
        await window[`currentRenderTask${instanceSuffix}`].promise;

        window[`pageRendering${instanceSuffix}`] = false;
        window[`currentRenderTask${instanceSuffix}`] = null;
        console.log(`pdfViewerCore/renderPdfPage[${instanceSuffix}]: Page rendered successfully:`, num);

        const pageNumPendingInstance = window[`pageNumPending${instanceSuffix}`];
        if (pageNumPendingInstance !== null) {
            window[`pageNumPending${instanceSuffix}`] = null;
            // queueRenderPage 也需要参数化
            return queueRenderPage(pageNumPendingInstance, instanceSuffix);
        }

        if (typeof updatePdfNavButtons === "function") updatePdfNavButtons(instanceSuffix);
        if (typeof updateZoomControls === "function") updateZoomControls(instanceSuffix);
        return true;

    } catch (error) {
        window[`pageRendering${instanceSuffix}`] = false;
        window[`currentRenderTask${instanceSuffix}`] = null;
        console.error(`pdfViewerCore/renderPdfPage[${instanceSuffix}]: Error rendering page ${num}:`, error);
        // ... (错误处理) ...
        return Promise.reject(error);
    }
}

/**
 * 更新PDF导航按钮（上一页/下一页）的禁用状态。
 */
function updatePdfNavButtons() {
    // 依赖全局变量: window.pdfDoc, window.currentPageNum
    // 依赖DOM元素: window.prevPageBtn, window.nextPageBtn (在 main_index.js 中初始化)
    const prevPageBtnElem = window.prevPageBtn || document.getElementById('prevPageBtn');
    const nextPageBtnElem = window.nextPageBtn || document.getElementById('nextPageBtn');

    if (!window.pdfDoc || !prevPageBtnElem || !nextPageBtnElem) return;
    prevPageBtnElem.disabled = (window.currentPageNum <= 1);
    nextPageBtnElem.disabled = (window.currentPageNum >= window.pdfDoc.numPages);
}


function cleanupPdfViewerState(forMyRecordsInstance = false, instanceSuffix = "") {
    console.log(`Cleaning up PDF state for instance: ${instanceSuffix || 'global'}`);
    if (forMyRecordsInstance) {
        window.pdfDocMyRecords = null;
        window.currentPageNumMyRecords = 1;
        window.currentPdfScaleMyRecords = window.DEFAULT_PDF_SCALE || 1.5; // Use your default scale
        window.currentPdfFileObjectMyRecords = null;
        // Reset other MyRecords-specific state variables...
    } else {
        // Reset global PDF viewer state variables
        window.pdfDoc = null;
        window.currentPageNum = 1;
        window.currentPdfScale = window.DEFAULT_PDF_SCALE || 1.5;
        window.currentPdfFileObject = null;
        window.currentViewingArticleRowId = null;
        // Reset other global state variables...
    }
    // Common cleanup
    const pageNumSpan = document.getElementById(forMyRecordsInstance ? `pageNum${instanceSuffix}` : 'page_num');
    const pageCountSpan = document.getElementById(forMyRecordsInstance ? `pageCount${instanceSuffix}` : 'page_count');
    if (pageNumSpan) pageNumSpan.textContent = '0';
    if (pageCountSpan) pageCountSpan.textContent = '0';
    // ... any other UI cleanup ...
}

/**
 * 更新缩放控件（按钮禁用状态和缩放级别显示）。
 */
function updateZoomControls() {
    // 依赖全局变量: window.pdfDoc, window.pageRendering, window.currentPdfScale
    // 依赖常量: window.MIN_PDF_SCALE, window.MAX_PDF_SCALE (from config.js, set globally in main_index.js)
    // 依赖DOM元素: window.zoomLevelSpan, window.zoomInBtn, window.zoomOutBtn (in main_index.js)
    const zoomLevelSpanElem = window.zoomLevelSpan || document.getElementById('zoomLevelSpan');
    const zoomInBtnElem = window.zoomInBtn || document.getElementById('zoomInBtn');
    const zoomOutBtnElem = window.zoomOutBtn || document.getElementById('zoomOutBtn');
    const minScale = window.MIN_PDF_SCALE || 0.25;
    const maxScale = window.MAX_PDF_SCALE || 4.0;


    if (zoomLevelSpanElem) {
        zoomLevelSpanElem.textContent = `${Math.round((window.currentPdfScale || (window.DEFAULT_PDF_SCALE || 1.5)) * 100)}%`;
    }
    if (zoomInBtnElem) {
        zoomInBtnElem.disabled = (!window.pdfDoc || window.pageRendering || (window.currentPdfScale || 1.5) >= maxScale);
    }
    if (zoomOutBtnElem) {
        zoomOutBtnElem.disabled = (!window.pdfDoc || window.pageRendering || (window.currentPdfScale || 1.5) <= minScale);
    }
}

/**
 * 如果当前页面正在渲染，则将请求的页面加入队列；否则直接渲染。
 * @param {number} num 要渲染的页码。
 */
function queueRenderPage(num) {
    // 依赖全局变量: window.pageRendering, window.pageNumPending, window.currentRenderTask
    // 调用: renderPdfPage (本文件)
    if (window.pageRendering) {
        window.pageNumPending = num;
        console.log(`pdfViewerCore/queueRenderPage: Queued page ${num} for rendering.`);
        // 如果有当前渲染任务，尝试取消它以加速队列处理
        if (window.currentRenderTask && typeof window.currentRenderTask.cancel === 'function') {
            window.currentRenderTask.cancel();
        }
    } else {
        renderPdfPage(num).catch(err => {
            console.warn("pdfViewerCore/queueRenderPage: Queued page render eventually failed:", err.name, err.message);
        });
    }
}

/**
 * 导航到上一页。
 */
function onPrevPage() {
    // 依赖全局变量: window.currentPageNum, window.pdfDoc
    // 调用: queueRenderPage (本文件)
    if (!window.pdfDoc || window.currentPageNum <= 1) return;
    window.currentPageNum--;
    queueRenderPage(window.currentPageNum);
}

/**
 * 导航到下一页。
 */
function onNextPage() {
    // 依赖全局变量: window.currentPageNum, window.pdfDoc
    // 调用: queueRenderPage (本文件)
    if (!window.pdfDoc || window.currentPageNum >= window.pdfDoc.numPages) return;
    window.currentPageNum++;
    queueRenderPage(window.currentPageNum);
}

/**
 * 处理用户通过文件选择器选择PDF文件的事件。
 * @param {Event} event 文件选择器的change事件对象。
 */
function handlePdfFileSelected(event) {
    // 调用: loadPdfFileObjectIntoViewer (本文件), showStatus (from utils.js)
    const file = event.target.files[0];
    if (file) {
        if (file.type === "application/pdf") {
            console.log("pdfViewerCore/handlePdfFileSelected: PDF file selected by user:", file.name);
            loadPdfFileObjectIntoViewer(file);
        } else {
            alert("请选择一个有效的PDF文件 (文件类型应为 .pdf)。");
            if(typeof showStatus === "function") showStatus("选择的文件不是有效的PDF格式。", "text-red-500", 3000);
        }
    }
    // 重置文件选择器，以便可以再次选择相同的文件
    if (event.target) {
        event.target.value = null;
    }
}

/**
 * 加载指定的本地File对象（应为PDF）到特定实例的PDF查看器中。
 * @param {File} fileObject 要加载的PDF的File对象。
 * @param {string} instanceSuffix 实例后缀 (例如 "_myRecords")，用于区分DOM元素和状态变量。
 */
async function loadPdfFileObjectIntoViewer(fileObject, instanceSuffix = "") {
    const pdfViewerTitleElem = document.getElementById(`pdfViewerTitle${instanceSuffix}`);
    const pageCountSpanElem = document.getElementById(`pageCount${instanceSuffix}`);
    const pageNumSpanElem = document.getElementById(`pageNum${instanceSuffix}`);
    const pdfCanvasElem = document.getElementById(`pdfCanvas${instanceSuffix}`); // 先获取，确保它存在

    // 依赖的状态变量也应该加上实例后缀
    // 例如，不直接用 window.pdfDoc，而是 window[`pdfDoc${instanceSuffix}`]
    // 或者更好的方式是，如果这些函数属于一个类，则使用 this.pdfDoc

    if (!fileObject || fileObject.type !== "application/pdf") {
        alert("提供的文件无效或不是PDF。");
        if (typeof showStatus === "function") showStatus("加载本地PDF文件失败：文件无效。", "text-red-500", 3000);
        if (typeof updateZoomControls === "function") updateZoomControls(instanceSuffix); // 传递后缀
        return;
    }

    // 为特定实例存储当前文件对象
    window[`currentPdfFileObject${instanceSuffix}`] = fileObject;

    // 将File对象关联到tableData中的当前文献条目
    // 注意: window.tableData 和 window.currentViewingArticleRowId 是全局的，这可能不是理想的，
    // 最好是通过参数传递这些信息，或者此逻辑移到调用此函数的地方 (如 my_records_logic.js)
    const currentViewingId = window[`currentViewingArticleRowId${instanceSuffix}`] || window.currentViewingArticleRowId; // 优先用实例特定的ID
    if (currentViewingId && window.tableData) {
        const currentArticleIndex = window.tableData.findIndex(row => row._id === currentViewingId);
        if (currentArticleIndex > -1) {
            window.tableData[currentArticleIndex].localPdfFileObject = fileObject;
            console.log(`[PDFLoad${instanceSuffix}] Associated local file "${fileObject.name}" with articleId: ${currentViewingId}`);
            if (typeof saveTableDataToLocalStorage === "function") {
                saveTableDataToLocalStorage();
            }
        } else {
            console.warn(`[PDFLoad${instanceSuffix}] Could not find current article in tableData to associate local file.`);
        }
    }

    if (typeof showStatus === "function") showStatus(`正在加载本地PDF文件 (实例: ${instanceSuffix || 'global'})...`, 'text-blue-500');

    if (pdfViewerTitleElem) {
        // ... (设置标题的逻辑，确保 findHeader, COLUMN_MAPPING, truncateText 可用或已导入) ...
        // 同样，这里的 window.tableData 和 currentViewingId 的依赖需要注意实例
        let titleToSet = `PDF: ${truncateText(fileObject.name, 30)}`;
        if (currentViewingId && window.tableData) {
            const rowData = window.tableData.find(r => r._id === currentViewingId);
            if (rowData) {
                const titleH = findHeader(Object.keys(rowData), (window.COLUMN_MAPPING && window.COLUMN_MAPPING.title) || ['title']);
                const actualTitle = rowData[titleH] ? String(rowData[titleH]).trim() : null;
                if (actualTitle) titleToSet = truncateText(actualTitle, 50);
            }
        }
        pdfViewerTitleElem.textContent = titleToSet;
    }

    // 重置特定实例的缩放比例
    window[`currentPdfScale${instanceSuffix}`] = window.DEFAULT_PDF_SCALE || 1.5;
    if (typeof updateZoomControls === "function") updateZoomControls(instanceSuffix); // 传递后缀

    const fileReader = new FileReader();
    fileReader.onload = async function() {
        const typedarray = new Uint8Array(this.result);
        try {
            // 清理上一个特定实例的PDF文档对象
            const prevPdfDoc = window[`pdfDoc${instanceSuffix}`];
            if (prevPdfDoc && typeof prevPdfDoc.destroy === 'function') {
                await prevPdfDoc.destroy();
                window[`pdfDoc${instanceSuffix}`] = null;
                console.log(`pdfViewerCore/loadPdfFileObject[${instanceSuffix}]: Previous pdfDoc${instanceSuffix} destroyed.`);
            }

            const loadingTask = pdfjsLib.getDocument({ data: typedarray });
            window[`pdfDoc${instanceSuffix}`] = await loadingTask.promise; // 赋值给实例特定的变量
            console.log(`pdfViewerCore/loadPdfFileObject[${instanceSuffix}]: New pdfDoc${instanceSuffix} loaded from File object.`);

            if (pageCountSpanElem) pageCountSpanElem.textContent = window[`pdfDoc${instanceSuffix}`].numPages;
            window[`currentPageNum${instanceSuffix}`] = 1; // 特定实例的当前页码

            if (typeof updatePdfNavButtons === "function") updatePdfNavButtons(instanceSuffix); // 传递后缀
            if (typeof updateZoomControls === "function") updateZoomControls(instanceSuffix);   // 传递后缀

            // 初始渲染特定实例的页面
            renderPdfPage(window[`currentPageNum${instanceSuffix}`], instanceSuffix) // 传递页码和后缀
                .then(() => {
                    if (typeof showStatus === "function") showStatus(`本地PDF (实例: ${instanceSuffix || 'global'}) 加载完成。`, 'text-green-500', 2000);
                    // 加载完PDF后，显示该文献的截图列表 (确保 displayScreenshotsForCurrentArticle 也支持实例)
                    if (typeof displayScreenshotsForCurrentArticle === "function") {
                        // displayScreenshotsForCurrentArticle 需要知道是哪个文献以及哪个实例的截图列表
                        displayScreenshotsForCurrentArticle(currentViewingId, instanceSuffix);
                    }
                })
                .catch(error => { /* renderPdfPage 内部已处理错误显示，并应使用 instanceSuffix 记录日志 */ });
        } catch (error) {
            console.error(`pdfViewerCore/loadPdfFileObject[${instanceSuffix}]: Error loading PDF from File object:`, error);
            if (typeof showStatus === "function") showStatus(`加载本地PDF (实例: ${instanceSuffix || 'global'}) 失败: ${error.message}`, 'text-red-500', 4000);
            window[`pdfDoc${instanceSuffix}`] = null;
            if (pdfCanvasElem && pdfCanvasElem.getContext) {
                const ctx = pdfCanvasElem.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, pdfCanvasElem.width, pdfCanvasElem.height);
            }
            if (pageNumSpanElem) pageNumSpanElem.textContent = '0';
            if (pageCountSpanElem) pageCountSpanElem.textContent = '0';
            if (typeof updatePdfNavButtons === "function") updatePdfNavButtons(instanceSuffix);
            if (typeof updateZoomControls === "function") updateZoomControls(instanceSuffix);
        }
    };
    fileReader.onerror = (error) => {
        console.error(`pdfViewerCore/loadPdfFileObject[${instanceSuffix}]: FileReader error:`, error);
        if (typeof showStatus === "function") showStatus(`读取文件 (实例: ${instanceSuffix || 'global'}) 失败: ${error.message || '未知错误'}`, "text-red-500", 4000);
        if (typeof updateZoomControls === "function") updateZoomControls(instanceSuffix);
    };
    fileReader.readAsArrayBuffer(fileObject);
}

/**
 * 从给定的URL加载PDF到查看器中。
 * @param {string} pdfUrl 要加载的PDF的URL。
 */
async function loadPdfFromUrl(pdfUrl) {
    // (与 loadPdfFileObjectIntoViewer 类似，但使用 URL 加载)
    // 依赖全局变量, DOM元素, 调用函数等基本一致
    if (!pdfUrl) {
        if(typeof showStatus === "function") showStatus("无效的PDF链接。", "text-red-500", 3000);
        return;
    }
    if(typeof showStatus === "function") showStatus('正在从链接加载PDF...', 'text-blue-500');
    window.currentPdfFileObject = null; // 从URL加载时，没有本地File对象

    // 更新查看器标题 (如果需要，基于URL或当前文献)
    const pdfViewerTitleElem = window.pdfViewerTitle || document.getElementById('pdfViewerTitle');
    if (pdfViewerTitleElem) {
        // 可以尝试从URL中提取文件名，或者使用当前文献标题
        try {
            const urlFilename = new URL(pdfUrl).pathname.split('/').pop();
            pdfViewerTitleElem.textContent = `PDF: ${truncateText(decodeURIComponent(urlFilename) || '远程文件', 40)}`;
        } catch (e) {
            pdfViewerTitleElem.textContent = `PDF: 远程文件`;
        }
    }

    window.currentPdfScale = window.DEFAULT_PDF_SCALE || 1.5;
    if(typeof updateZoomControls === "function") updateZoomControls();

    try {
        if (window.pdfDoc && typeof window.pdfDoc.destroy === 'function') {
            await window.pdfDoc.destroy();
            window.pdfDoc = null;
        }
        // 注意：从URL加载PDF需要服务器支持CORS，否则会失败
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        window.pdfDoc = await loadingTask.promise;
        console.log("pdfViewerCore/loadPdfFromUrl: New pdfDoc loaded from URL.");

        const pageCountSpanElem = window.pageCountSpan || document.getElementById('page_count');
        if (pageCountSpanElem) pageCountSpanElem.textContent = window.pdfDoc.numPages;
        window.currentPageNum = 1;

        if(typeof updatePdfNavButtons === "function") updatePdfNavButtons();
        if(typeof updateZoomControls === "function") updateZoomControls();

        renderPdfPage(window.currentPageNum)
            .then(() => {
                if(typeof showStatus === "function") showStatus('PDF从链接加载完成。', 'text-green-500', 2000);
                if (typeof displayScreenshotsForCurrentArticle === "function") {
                    displayScreenshotsForCurrentArticle();
                }
            })
            .catch(error => { /* renderPdfPage handles its own error display */ });
    } catch (error) {
        console.error('pdfViewerCore/loadPdfFromUrl: Error loading PDF from URL:', error);
        if(typeof showStatus === "function") showStatus(`从链接加载PDF失败: ${error.message}. 请检查链接是否有效以及服务器是否允许跨域访问。`, 'text-red-500', 7000);
        window.pdfDoc = null;
        // ... (UI清理逻辑同 loadPdfFileObjectIntoViewer 的错误处理) ...
        const pdfCanvasElem = window.pdfCanvas || document.getElementById('pdfCanvas');
        const pageNumSpanElem = window.pageNumSpan || document.getElementById('page_num');
        const pageCountSpanElem = window.pageCountSpan || document.getElementById('page_count');
        if (pdfCanvasElem) { const ctx = pdfCanvasElem.getContext('2d'); if (ctx) ctx.clearRect(0, 0, pdfCanvasElem.width, pdfCanvasElem.height); }
        if (pageNumSpanElem) pageNumSpanElem.textContent = '0';
        if (pageCountSpanElem) pageCountSpanElem.textContent = '0';
        if(typeof updatePdfNavButtons === "function") updatePdfNavButtons();
        if(typeof updateZoomControls === "function") updateZoomControls();
    }
}

/**
 * 处理PDF查看器全屏切换。
 */
function togglePdfViewerFullscreen() {
    // 依赖DOM元素: window.pdfViewerModalContent (在main_index.js中初始化)
    const pdfViewerModalContentElem = window.pdfViewerModalContent || document.getElementById('pdfViewerModalContent');
    if (!pdfViewerModalContentElem) return;

    if (!document.fullscreenElement &&
        !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) { // 当前非全屏
        if (pdfViewerModalContentElem.requestFullscreen) {
            pdfViewerModalContentElem.requestFullscreen();
        } else if (pdfViewerModalContentElem.msRequestFullscreen) {
            pdfViewerModalContentElem.msRequestFullscreen();
        } else if (pdfViewerModalContentElem.mozRequestFullScreen) {
            pdfViewerModalContentElem.mozRequestFullScreen();
        } else if (pdfViewerModalContentElem.webkitRequestFullscreen) {
            pdfViewerModalContentElem.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
        }
    } else { // 当前是全屏
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }
}

/**
 * 更新全屏按钮的图标和标题。
 * @param {boolean} isCurrentlyFullscreen 当前是否处于全屏状态。
 */
function updateFullscreenButtonIcon(isCurrentlyFullscreen) {
    // 依赖DOM元素: window.fullscreenBtn (在main_index.js中初始化)
    const fullscreenBtnElem = window.fullscreenBtn || document.getElementById('fullscreenBtn');
    if (!fullscreenBtnElem) return;
    if (isCurrentlyFullscreen) {
        fullscreenBtnElem.innerHTML = '<i class="fas fa-compress"></i>';
        fullscreenBtnElem.title = '退出全屏';
    } else {
        fullscreenBtnElem.innerHTML = '<i class="fas fa-expand"></i>';
        fullscreenBtnElem.title = '切换全屏';
    }
}

/**
 * 初始化截图选区相关的Canvas事件监听器。
 */
function initializeSelectionCanvasListeners() {
    // 依赖全局变量: window.pdfDoc, window.pageRendering, window.isSelecting, window.selectionRect, window.selectionCtx, window.currentPageNum
    // 依赖DOM元素: window.selectionCanvas, window.captureSelectionBtn (在main_index.js中初始化)
    const selectionCanvasElem = window.selectionCanvas || document.getElementById('selectionCanvas');
    const captureSelectionBtnElem = window.captureSelectionBtn || document.getElementById('captureSelectionBtn');

    if (!selectionCanvasElem || !captureSelectionBtnElem) {
        console.error("pdfViewerCore/initializeSelectionCanvasListeners: selectionCanvas or captureSelectionBtn not found.");
        return;
    }

    // 确保 selectionCtx 已初始化
    window.selectionCtx = window.selectionCtx || selectionCanvasElem.getContext('2d');
    if (!window.selectionCtx) {
        console.error("pdfViewerCore/initializeSelectionCanvasListeners: Failed to get 2D context for selectionCanvas.");
        return;
    }

    selectionCanvasElem.addEventListener('mousedown', (e) => {
        if (!window.pdfDoc || window.pageRendering) return;
        window.isSelecting = true;
        const rect = selectionCanvasElem.getBoundingClientRect();
        window.selectionRect.startX = e.clientX - rect.left;
        window.selectionRect.startY = e.clientY - rect.top;
        window.selectionRect.endX = window.selectionRect.startX; // Initialize end points
        window.selectionRect.endY = window.selectionRect.startY;
        window.selectionRect.pageNum = window.currentPageNum; // Record current page

        window.selectionCtx.clearRect(0, 0, selectionCanvasElem.width, selectionCanvasElem.height); // Clear previous selection
        captureSelectionBtnElem.classList.add('hidden'); // Hide capture button until selection is valid
    });

    selectionCanvasElem.addEventListener('mousemove', (e) => {
        if (!window.isSelecting || !window.selectionCtx) return;
        const rect = selectionCanvasElem.getBoundingClientRect();
        window.selectionRect.endX = e.clientX - rect.left;
        window.selectionRect.endY = e.clientY - rect.top;

        window.selectionCtx.clearRect(0, 0, selectionCanvasElem.width, selectionCanvasElem.height);
        window.selectionCtx.strokeStyle = 'red';
        window.selectionCtx.lineWidth = 1;
        window.selectionCtx.strokeRect(
            window.selectionRect.startX, window.selectionRect.startY,
            window.selectionRect.endX - window.selectionRect.startX,
            window.selectionRect.endY - window.selectionRect.startY
        );
    });

    selectionCanvasElem.addEventListener('mouseup', (e) => {
        if (!window.isSelecting) return;
        window.isSelecting = false;
        const rect = selectionCanvasElem.getBoundingClientRect(); // Recalculate bounds just in case
        window.selectionRect.endX = e.clientX - rect.left;
        window.selectionRect.endY = e.clientY - rect.top;

        const x = Math.min(window.selectionRect.startX, window.selectionRect.endX);
        const y = Math.min(window.selectionRect.startY, window.selectionRect.endY);
        const width = Math.abs(window.selectionRect.endX - window.selectionRect.startX);
        const height = Math.abs(window.selectionRect.endY - window.selectionRect.startY);

        if (width > 5 && height > 5) { // Only consider valid selections
            window.selectionRect.finalX = x;
            window.selectionRect.finalY = y;
            window.selectionRect.finalWidth = width;
            window.selectionRect.finalHeight = height;
            captureSelectionBtnElem.classList.remove('hidden'); // Show capture button
        } else {
            if (window.selectionCtx) window.selectionCtx.clearRect(0, 0, selectionCanvasElem.width, selectionCanvasElem.height); // Clear invalid selection drawing
            captureSelectionBtnElem.classList.add('hidden');
        }
    });

    selectionCanvasElem.addEventListener('mouseleave', (e) => {
        if (window.isSelecting) { // If mouse leaves canvas while still selecting
            window.isSelecting = false; // Finalize selection
            // Use last known mouse position on canvas if available, or current endX/endY
            const x = Math.min(window.selectionRect.startX, window.selectionRect.endX);
            const y = Math.min(window.selectionRect.startY, window.selectionRect.endY);
            const width = Math.abs(window.selectionRect.endX - window.selectionRect.startX);
            const height = Math.abs(window.selectionRect.endY - window.selectionRect.startY);

            if (width > 5 && height > 5) {
                window.selectionRect.finalX = x;
                window.selectionRect.finalY = y;
                window.selectionRect.finalWidth = width;
                window.selectionRect.finalHeight = height;
                captureSelectionBtnElem.classList.remove('hidden');
            } else {
                if (window.selectionCtx) window.selectionCtx.clearRect(0, 0, selectionCanvasElem.width, selectionCanvasElem.height);
                captureSelectionBtnElem.classList.add('hidden');
            }
        }
    });
}

// 在 pdfViewerCore.js 文件中添加或修改此函数

// (确保此函数也被导出，如果它是在本文件中定义)
function showPdfPlaceholder(message, instanceSuffix = "") {
    const pdfCanvasElem = window.pdfCanvas || document.getElementById('pdfCanvas');
    const pdfCanvasContainerElem = window.pdfCanvasContainer || document.getElementById('pdfCanvasContainer');

    if (pdfCanvasElem && pdfCanvasContainerElem) {
        const ctx = pdfCanvasElem.getContext('2d');
        // 清除画布
        ctx.clearRect(0, 0, pdfCanvasElem.width, pdfCanvasElem.height);

        // 移除可能存在的旧占位符
        const existingPlaceholder = pdfCanvasContainerElem.querySelector('.pdf-placeholder-message');
        if (existingPlaceholder) {
            existingPlaceholder.remove();
        }

        // 创建新的占位符消息元素
        const placeholderDiv = document.createElement('div');
        placeholderDiv.className = 'pdf-placeholder-message text-gray-500 text-center p-4'; // 添加一些样式
        placeholderDiv.textContent = message;

        // 将占位符添加到画布容器中，并确保它居中或以其他方式适当显示
        // 一种简单的方式是让画布容器本身支持flex布局居中其子元素
        // 或者，如果画布本身占据了全部空间，可以在画布上绘制文本（但这会随画布清除而消失）
        // 更稳妥的是在画布的父容器中添加一个HTML元素作为占位符

        // 假设 pdfCanvasContainerElem 是可以用来放置这个消息的容器
        // 清空 pdfCanvasElem 之外的任何内容（如果需要）
        // 例如，如果 pdfCanvasContainerElem 内部只有 canvas 和 selectionCanvas:
        // 清理 pdfCanvas 本身的内容已在上面完成。

        // 将占位符消息添加到 Canvas 的父容器中（通常是 pdfCanvasContainer）
        // 确保 placeholderDiv 不会与 canvas 重叠得很难看
        // 这里简单地添加到容器末尾，您可能需要调整CSS使其居中显示在画布区域
        pdfCanvasContainerElem.appendChild(placeholderDiv);

         // **这里是修正后的日志输出**
        console.log(`pdfViewerCore/showPdfPlaceholder[${instanceSuffix || 'global'}]: Displaying placeholder - "${message}"`);
    } else {
        // **这里是修正后的错误日志输出**
        console.error(`pdfViewerCore/showPdfPlaceholder[${instanceSuffix || 'global'}]: pdfCanvas${instanceSuffix} or pdfCanvasContainer${instanceSuffix} not found.`);
    }
}


export{
    renderPdfPage,
    updatePdfNavButtons,
    updateZoomControls,
    queueRenderPage,
    initializePdfJsWorker,
    onPrevPage,
    onNextPage,
    handlePdfFileSelected,
    loadPdfFromUrl,
    loadPdfFileObjectIntoViewer,
    togglePdfViewerFullscreen,
    updateFullscreenButtonIcon,
    initializeSelectionCanvasListeners,
    showPdfPlaceholder,
    cleanupPdfViewerState

}


console.log("pdfViewerCore.js loaded: PDF viewing core functions are available.");