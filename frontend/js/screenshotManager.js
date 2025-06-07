// js/screenshotManager.js

// ==========================================================================
// 1. IMPORTS
// ==========================================================================
import {
    showStatus,
    truncateText,
    sanitizeFilenameForImage,
    closeModal,
    findHeader // findHeader might be used if article title needs to be retrieved robustly
} from './utils.js';
import {
    saveScreenshotApi,
    updateScreenshotMetadataApi,
    deleteScreenshotFromServerApi
} from './api.js';
import { saveTableDataToLocalStorage } from './dataManager.js'; // Crucial for data persistence
import { togglePdfViewerFullscreen } from './pdfViewerCore.js'; // For resuming fullscreen
import { COLUMN_MAPPING, THUMBNAIL_MAX_WIDTH, THUMBNAIL_MAX_HEIGHT } from './config.js';

// ==========================================================================
// 2. CORE SCREENSHOT CAPTURE AND MANAGEMENT FUNCTIONS
// ==========================================================================

/**
 * 处理“截取选中”按钮点击，捕获截图，生成缩略图，并发送到服务器。
 * 成功后更新前端数据模型 (window.tableData) 和UI。
 * @param {string} instanceSuffix - 调用此函数的PDF查看器实例的后缀。
 */
export async function handleCaptureScreenshot(instanceSuffix = "") {
    const suffixLog = `[ScreenshotMgr/${instanceSuffix || 'default'}/Capture]`;
    console.log(`${suffixLog} Initiating screenshot capture.`);

    // 获取当前实例相关的DOM元素和状态变量
    const pdfCanvas = document.getElementById(`pdfCanvas${instanceSuffix}`);
    const currentViewingArticleRowId = window[`currentViewingArticleRowId${instanceSuffix}`]; // 前端 _id
    const selectionRect = window[`selectionRect${instanceSuffix}`];
    const pdfDoc = window[`pdfDoc${instanceSuffix}`]; // PDFDocumentProxy instance
    const currentPageNum = window[`currentPageNum${instanceSuffix}`];
    const currentPdfScale = window[`currentPdfScale${instanceSuffix}`];
    const selectionCanvas = document.getElementById(`selectionCanvas${instanceSuffix}`);
    const captureBtn = document.getElementById(`captureSelectionBtn${instanceSuffix}`);

    if (!pdfCanvas || typeof pdfCanvas.getContext !== 'function') {
        if(typeof showStatus === "function") showStatus(`截图失败${suffixLog}：PDF渲染画布丢失或无效。`, 'text-red-500', 4000);
        console.error(`${suffixLog} pdfCanvas (id: pdfCanvas${instanceSuffix}) is not valid.`);
        return;
    }
    if (!selectionRect || !selectionRect.finalWidth || !selectionRect.finalHeight || selectionRect.finalWidth <= 0 || selectionRect.finalHeight <= 0) {
        if(typeof showStatus === "function") showStatus("请先在PDF页面上框选一个有效的截图区域。", "text-yellow-500", 3000);
        return;
    }
    if (!currentViewingArticleRowId) {
        if(typeof showStatus === "function") showStatus(`截图失败${suffixLog}：无法确定当前操作的文献。请重新打开PDF。`, 'text-red-500', 4000);
        console.error(`${suffixLog} currentViewingArticleRowId for instance is not set.`);
        return;
    }

    const articleIndex = window.tableData.findIndex(r => r._id === currentViewingArticleRowId);
    if (articleIndex === -1) {
        if(typeof showStatus === "function") showStatus(`截图失败${suffixLog}：在数据模型中未找到当前文献。`, 'text-red-500', 4000);
        console.error(`${suffixLog} Article data not found in window.tableData for _id: ${currentViewingArticleRowId}`);
        return;
    }
    const currentArticleRow = window.tableData[articleIndex];

    if(typeof showStatus === "function") showStatus(`正在处理截图并准备上传${suffixLog}...`, 'text-blue-500', 0);

    try {
        // 1. 创建截图主图像 Data URL
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = selectionRect.finalWidth;
        tempCanvas.height = selectionRect.finalHeight;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) throw new Error("无法创建临时画布上下文用于截图。");
        tempCtx.drawImage(
            pdfCanvas,
            selectionRect.finalX, selectionRect.finalY,
            selectionRect.finalWidth, selectionRect.finalHeight,
            0, 0, selectionRect.finalWidth, selectionRect.finalHeight
        );
        const imageDataUrlForApi = tempCanvas.toDataURL('image/png');

        // 2. 创建缩略图 Data URL
        const thumbnailCanvas = document.createElement('canvas');
        const aspectRatio = selectionRect.finalWidth / selectionRect.finalHeight;
        if (aspectRatio > THUMBNAIL_MAX_WIDTH / THUMBNAIL_MAX_HEIGHT) {
            thumbnailCanvas.width = THUMBNAIL_MAX_WIDTH;
            thumbnailCanvas.height = Math.max(1, Math.round(THUMBNAIL_MAX_WIDTH / aspectRatio));
        } else {
            thumbnailCanvas.height = THUMBNAIL_MAX_HEIGHT;
            thumbnailCanvas.width = Math.max(1, Math.round(THUMBNAIL_MAX_HEIGHT * aspectRatio));
        }
        const thumbCtx = thumbnailCanvas.getContext('2d');
        if (!thumbCtx) throw new Error("无法创建缩略图画布上下文。");
        if (tempCanvas.width > 0 && tempCanvas.height > 0) { // Ensure source canvas has dimensions
             thumbCtx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
        } else { // Fallback for empty selection if not caught earlier
            thumbCtx.fillStyle = '#f0f0f0';
            thumbCtx.fillRect(0,0,thumbnailCanvas.width, thumbnailCanvas.height);
            thumbCtx.fillStyle = '#888';
            thumbCtx.textAlign = 'center';
            thumbCtx.fillText('No Preview', thumbnailCanvas.width/2, thumbnailCanvas.height/2);
        }
        const thumbnailDataUrlForStorage = thumbnailCanvas.toDataURL('image/png');

        // 3. 获取原始页面尺寸 (在100%缩放时)
        let originalPageDimensions = null;
        if (pdfDoc && currentPageNum && typeof pdfDoc.getPage === 'function') {
            try {
                const page = await pdfDoc.getPage(currentPageNum);
                const viewportScale1 = page.getViewport({ scale: 1.0 });
                originalPageDimensions = {
                    width: viewportScale1.width,
                    height: viewportScale1.height,
                    scale: 1.0 // This 'scale' indicates these are original dimensions at 100%
                };
            } catch (pageError) {
                console.warn(`${suffixLog} Error getting original page dimensions:`, pageError.message);
            }
        }

        // 4. 准备文件名和API载荷
        const titleHeaderKey = findHeader(Object.keys(currentArticleRow), COLUMN_MAPPING.title || ['title']);
        const articleTitle = currentArticleRow[titleHeaderKey] ? String(currentArticleRow[titleHeaderKey]).trim() : '未知文献';
        const baseFilename = truncateText(sanitizeFilenameForImage(articleTitle), 30);
        const existingScreenshotsCount = currentArticleRow.screenshots ? currentArticleRow.screenshots.length : 0;
        const suggestedFilename = `${baseFilename}_P${selectionRect.pageNum}_Sel${existingScreenshotsCount + 1}.png`;

        const payload = {
            articleId: currentViewingArticleRowId,        // 前端 _id
            db_id: currentArticleRow.db_id || null,     // 后端数据库 ID
            articleTitle: articleTitle,
            pageNumber: selectionRect.pageNum,
            selectionRect: { // 截图在当前渲染的PDF画布中的坐标和大小
                x: selectionRect.finalX, y: selectionRect.finalY,
                width: selectionRect.finalWidth, height: selectionRect.finalHeight
            },
            imageData: imageDataUrlForApi, // 主截图的Base64数据
            suggestedFilename: suggestedFilename,
            chartType: "未指定", // 默认
            description: "",     // 默认
            originalPageDimensions: originalPageDimensions, // PDF原始页面尺寸 (at scale 1.0)
            captureScale: currentPdfScale,                // 截图时PDF的实际缩放比例
            thumbnailDataUrl: thumbnailDataUrlForStorage    // 缩略图的Base64数据
        };

        console.log(`${suffixLog} Payload for saveScreenshotApi:`, { ...payload, imageData: payload.imageData.substring(0,50)+"...", thumbnailDataUrl: payload.thumbnailDataUrl.substring(0,50)+"..."});


        // 5. 调用API保存截图
        const serverResponse = await saveScreenshotApi(payload);

        if (serverResponse && serverResponse.success) {
            const newScreenshotRecord = {
                id: serverResponse.metadataFilePath || `local-${Date.now()}`, // 使用服务器元数据路径作ID，或生成本地临时ID
                db_id: serverResponse.screenshot_id,
                pageNumber: selectionRect.pageNum,
                rect: payload.selectionRect, // Store the selection rect relative to the captured canvas viewport
                filenameSuggested: serverResponse.serverFilePath ? serverResponse.serverFilePath.split('/').pop() : suggestedFilename,

                chartType: "未指定",
                description: "",
                timestamp: new Date().toISOString(), // 客户端时间戳
                thumbnailDataUrl: thumbnailDataUrlForStorage,
                wpdData: null,
                serverFilePath: serverResponse.serverFilePath,     // 服务器保存的图片相对路径
                serverMetadataPath: serverResponse.metadataFilePath, // 服务器保存的元数据相对路径
                originalPageDimensions: originalPageDimensions,
                captureScale: currentPdfScale,
                lastUpdated_client: new Date().toISOString(), // 客户端最后更新时间
                image_relative_path: serverResponse.image_relative_path, // 使用服务器返回的图片路径
                image_size_bytes: serverResponse.image_size_bytes, // 使用服务器返回的大小
                // created_at_iso 和 updated_at_iso 也可以由服务器返回
            };

            // 找到正确的文献记录并更新
            const articleIndex = window.tableData.findIndex(r => r.db_id == payload.db_id || r._id == payload.articleId);
            if (articleIndex === -1) {
                showStatus("错误：无法在前端数据中找到要关联截图的文献。", "text-red-500", 5000);
                return;
            }

            if (!window.tableData[articleIndex].screenshots) {
                window.tableData[articleIndex].screenshots = [];
            }
            window.tableData[articleIndex].screenshots.push(newScreenshotRecord);

            // 更新用户统计数据（如果API返回了新值）
            const user = window.tableData.find(u => u.id === current_user_info.user_id); // 假设可以这样找到用户
            if(user) {
                user.storage_used_bytes = serverResponse.new_storage_used_bytes;
                user.screenshot_count = serverResponse.new_screenshot_count;
            }

            saveTableDataToLocalStorage(); // 更新本地存储
            displayScreenshotsForCurrentArticle(articleIndex); // 使用索引或ID刷新侧边栏截图列表

            showStatus(serverResponse.message || '截图已成功保存！', 'text-green-500', 4000);
            console.log(`${suffixLog} Screenshot saved. Server response:`, serverResponse);
        } else {
            // saveScreenshotApi 内部应已调用 showStatus
            const errorMsg = serverResponse?.message || `截图保存到服务器失败${suffixLog}，请检查网络或服务器日志。`;
            if(typeof showStatus === "function") showStatus(errorMsg, 'text-red-500', 7000);
            console.error(`${suffixLog} Failed to save screenshot. Server response:`, serverResponse);
        }
    } catch (error) {
        console.error(`${suffixLog} Error during screenshot capture process:`, error);
        if(typeof showStatus === "function") showStatus(`截图处理或上传时发生错误${suffixLog}: ${error.message || '未知问题'}`, 'text-red-500', 5000);
    } finally {
        // 清理选区并隐藏“截取选中”按钮
        const currentSelectionCtx = window[`selectionCtx${instanceSuffix}`];
        if (selectionCanvas && currentSelectionCtx && typeof currentSelectionCtx.clearRect === 'function') {
             currentSelectionCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
        }
        if (captureBtn) captureBtn.classList.add('hidden');
        window[`isSelecting${instanceSuffix}`] = false; // 确保重置选择状态
    }
}

/**
 * 在PDF查看器的侧边栏显示当前选中文献的截图列表。
 * 此函数现在依赖 window.tableData 中预加载的截图数据。
 * @param {string} articleRowIdToDisplay - 要显示截图的文献的前端 _id。
 * @param {string} instanceSuffix - 调用此函数的PDF查看器实例的后缀。
 */
export function displayScreenshotsForCurrentArticle(articleRowIdToDisplay, instanceSuffix = "") {
    const suffixLog = `[ScreenshotMgr/${instanceSuffix || 'default'}/Display]`;
    const screenshotsListContainerEl = document.getElementById(`screenshotsListContainer${instanceSuffix}`);
    const noScreenshotsMessageEl = document.getElementById(`noScreenshotsMessage${instanceSuffix}`);
    // 仪表盘页面特有的截图列表父容器ID为 currentArticleScreenshots
    const dashboardSpecificScreenshotPanel = (instanceSuffix === "") ? document.getElementById('currentArticleScreenshots') : null;

    if (!screenshotsListContainerEl || !noScreenshotsMessageEl) {
        console.warn(`${suffixLog} UI elements for screenshots panel (list container or no message element) are missing for instance '${instanceSuffix}'. Cannot display screenshots.`);
        return;
    }

    // 如果是仪表盘，确保父面板可见
    if (dashboardSpecificScreenshotPanel) {
        dashboardSpecificScreenshotPanel.classList.remove('hidden');
    }

    screenshotsListContainerEl.innerHTML = ''; // 清空现有列表

    if (!articleRowIdToDisplay) {
        noScreenshotsMessageEl.textContent = "请先选择一篇文献以查看其截图。";
        noScreenshotsMessageEl.classList.remove('hidden');
        console.log(`${suffixLog} No articleRowIdToDisplay provided.`);
        return;
    }

    const article = window.tableData.find(row => row._id === articleRowIdToDisplay);

    if (article && article.screenshots && Array.isArray(article.screenshots) && article.screenshots.length > 0) {
        noScreenshotsMessageEl.classList.add('hidden');
        const ul = document.createElement('ul');
        ul.className = 'list-none space-y-2 p-1';

        // 按页码和时间戳（如果存在）排序截图
        const sortedScreenshots = [...article.screenshots].sort((a, b) =>
            (a.pageNumber || 0) - (b.pageNumber || 0) ||
            (a.timestamp || "").localeCompare(b.timestamp || "")
        );

        sortedScreenshots.forEach((ss, index) => {
            const li = document.createElement('li');
            // screenshot.id 是服务器元数据文件的相对路径或本地生成的ID
            const screenshotId = ss.id || ss.serverMetadataPath || `local-ss-${index}`;
            li.className = 'hover:bg-gray-200 p-2 rounded transition-colors duration-150 flex justify-between items-start border border-gray-200 shadow-sm cursor-pointer';
            li.dataset.screenshotId = screenshotId;
            li.dataset.articleId = article._id; // 存储文献的前端 _id
            li.title = `编辑截图信息 (P${ss.pageNumber || 'N/A'})`;
            li.addEventListener('click', function() { // 点击列表项直接打开编辑模态框
                handleScreenshotItemClick(article._id, screenshotId, instanceSuffix);
            });

            const imgContainer = document.createElement('div');
            imgContainer.className = 'flex-shrink-0 mr-3 w-24 h-auto'; // 固定宽度
            if (ss.thumbnailDataUrl) {
                const img = document.createElement('img');
                img.src = ss.thumbnailDataUrl;
                img.alt = `截图 P${ss.pageNumber || index + 1}`;
                img.className = 'w-full h-full object-contain border border-gray-300 rounded';
                imgContainer.appendChild(img);
            } else {
                const placeholder = document.createElement('div');
                placeholder.className = 'w-full h-16 border border-dashed border-gray-300 rounded flex items-center justify-center text-gray-400 text-xs bg-gray-50';
                placeholder.textContent = '无预览';
                imgContainer.appendChild(placeholder);
            }
            li.appendChild(imgContainer);

            const textAndControlsContainer = document.createElement('div');
            textAndControlsContainer.className = 'flex-grow flex flex-col min-w-0';

            const textInfo = document.createElement('div');
            textInfo.className = 'mb-1';
            let filenameForDisplay = ss.filenameSuggested || ss.serverFilePath?.split('/').pop() || `截图${index+1}`;
            let displayText = `P${ss.pageNumber || '?'} - "${truncateText(filenameForDisplay, 15)}"`;
            if (ss.chartType && ss.chartType !== "未指定") {
                displayText += ` <span class="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full whitespace-nowrap">${ss.chartType}</span>`;
            }
            if (ss.wpdData && String(ss.wpdData).trim() !== "") {
                displayText += ` <i class="fas fa-ruler-combined text-purple-500 ml-1" title="包含WebPlotDigitizer数据"></i>`;
            }
            if (ss.serverFilePath) {
                displayText += ` <i class="fas fa-cloud text-green-500 ml-1" title="已同步到服务器"></i>`;
            } else {
                 displayText += ` <i class="fas fa-desktop text-gray-500 ml-1" title="仅本地缓存"></i>`;
            }
            textInfo.innerHTML = displayText;
            textAndControlsContainer.appendChild(textInfo);

            if (ss.description) {
                const descP = document.createElement('p');
                descP.className = 'text-xs text-gray-500 italic truncate';
                descP.title = ss.description;
                descP.textContent = truncateText(ss.description, 30);
                textAndControlsContainer.appendChild(descP);
            }

            const controlsDiv = document.createElement('div');
            controlsDiv.className = 'mt-auto pt-1 flex items-center space-x-2';

            if (ss.serverFilePath) { // 下载原图按钮仅当截图在服务器上时显示
                  const downloadForWpdButton = document.createElement('button');
                  downloadForWpdButton.innerHTML = `<i class="fas fa-draw-polygon text-blue-500 group-hover:text-blue-700"></i>`;
                  downloadForWpdButton.className = 'p-1 rounded hover:bg-blue-100 text-xs group';
                  downloadForWpdButton.title = `下载原图 (${filenameForDisplay}) 用于 WebPlotDigitizer`;
                  downloadForWpdButton.onclick = (event) => {
                      event.stopPropagation(); // 重要：阻止触发 li 的点击事件 (打开编辑模态框)
                      const backendApiUrl = window.backendBaseUrl;
                      if (!backendApiUrl) { if(typeof showStatus === "function") showStatus('错误：后端API链接未配置。', 'text-red-500', 4000); return; }
                      // 使用 screenshot.serverFilePath 而不是 image_server_path (如果前者是正确的元数据字段)
                      const imagePathForDownload = ss.serverFilePath || ss.image_server_path; // 确保使用正确的字段
                      if (!imagePathForDownload) { if(typeof showStatus === "function") showStatus('错误：截图文件路径未知。', 'text-red-500'); return; }
                      const downloadUrl = `${backendApiUrl}/api/download_screenshot_image?path=${encodeURIComponent(imagePathForDownload)}`;
                      if(typeof showStatus === "function") showStatus(`准备下载原图: ${filenameForDisplay}...`, 'text-blue-500', 3000);
                      const tempLink = document.createElement('a'); tempLink.href = downloadUrl; tempLink.download = filenameForDisplay;
                      document.body.appendChild(tempLink); tempLink.click(); document.body.removeChild(tempLink);
                  };
                  controlsDiv.appendChild(downloadForWpdButton);
            }

            const deleteButton = document.createElement('button');
            deleteButton.innerHTML = `<i class="fas fa-trash-alt text-red-500 group-hover:text-red-700"></i>`;
            deleteButton.className = 'p-1 rounded hover:bg-red-100 text-xs group';
            deleteButton.title = "删除此截图记录";
            deleteButton.onclick = async (event) => {
                event.stopPropagation(); // 重要：阻止触发 li 的点击事件
                await handleDeleteScreenshot(article._id, screenshotId, instanceSuffix);
            };
            controlsDiv.appendChild(deleteButton);
            textAndControlsContainer.appendChild(controlsDiv);
            li.appendChild(textAndControlsContainer);
            ul.appendChild(li);
        });
        screenshotsListContainerEl.appendChild(ul);
        console.log(`${suffixLog} Displayed ${sortedScreenshots.length} screenshots for article _id: ${articleRowIdToDisplay}`);
    } else {
        noScreenshotsMessageEl.textContent = (article && articleRowIdToDisplay) ? '此文献尚无截图记录。您可以在PDF预览中截取。' : '请先从文献列表中选择一篇文献。';
        noScreenshotsMessageEl.classList.remove('hidden');
        console.log(`${suffixLog} No screenshots to display for article _id: ${articleRowIdToDisplay}`);
    }
}

/**
 * 处理截图列表项点击事件，打开编辑模态框并填充数据。
 * @param {string} articleFrontendId - 截图所属文献的前端ID (_id)。
 * @param {string} screenshotId - 被点击截图的ID (通常是 serverMetadataPath 或本地生成的ID)。
 * @param {string} instanceSuffix - 调用此函数的PDF查看器实例的后缀。
 */
export function handleScreenshotItemClick(articleFrontendId, screenshotId, instanceSuffix = "") {
    const suffixLog = `[ScreenshotMgr/${instanceSuffix || 'default'}/EditClick]`;
    console.log(`${suffixLog} Clicked screenshot item. Article _id: ${articleFrontendId}, Screenshot ID: ${screenshotId}`);

    const article = window.tableData.find(row => row._id === articleFrontendId);
    if (!article || !article.screenshots || !Array.isArray(article.screenshots)) {
        if(typeof showStatus === "function") showStatus("错误：未找到对应的文献记录或其截图列表。", "text-red-500", 4000);
        console.error(`${suffixLog} Article (ID: ${articleFrontendId}) or its screenshots array not found in window.tableData.`);
        return;
    }
    const screenshot = article.screenshots.find(ss => (ss.id === screenshotId || ss.serverMetadataPath === screenshotId));
    if (!screenshot) {
        if(typeof showStatus === "function") showStatus("错误：未找到要编辑的截图记录。", "text-red-500", 4000);
        console.error(`${suffixLog} Screenshot (ID: ${screenshotId}) not found in article (ID: ${articleFrontendId}).`);
        return;
    }

    // 获取对应实例的模态框DOM元素
    const editModal = document.getElementById(`editScreenshotModal${instanceSuffix}`);
    const titleEl = document.getElementById(`editScreenshotModalTitle${instanceSuffix}`);
    const articleIdSpan = document.getElementById(`editSsArticleId${instanceSuffix}`);
    const ssIdSpan = document.getElementById(`editSsId${instanceSuffix}`);
    const filenameSpan = document.getElementById(`editSsFilename${instanceSuffix}`);
    const hiddenArticleIdInput = document.getElementById(`editingScreenshotArticleId${instanceSuffix}`);
    const hiddenSsIdInput = document.getElementById(`editingScreenshotId${instanceSuffix}`);
    const chartTypeSelect = document.getElementById(`editSsChartType${instanceSuffix}`);
    const descriptionTextarea = document.getElementById(`editSsDescription${instanceSuffix}`);
    const wpdTextarea = document.getElementById(`wpdDataTextarea${instanceSuffix}`);
    const saveAndResumeBtn = document.getElementById(`saveAndResumeFullscreenBtn${instanceSuffix}`); // Assuming only one page uses this button

    if (!editModal || !chartTypeSelect /* ... etc. check all needed elements ... */) {
        console.error(`${suffixLog} One or more edit screenshot modal DOM elements are missing for instance '${instanceSuffix}'.`);
        if(typeof showStatus === "function") showStatus("错误：编辑截图对话框未能正确初始化。", "text-red-500", 5000);
        return;
    }

    // 填充模态框数据
    if(titleEl) {
        const articleTitleForModal = article.title ? truncateText(article.title, 20) : '未知文献';
        titleEl.textContent = `编辑截图 (来自: ${articleTitleForModal} - P${screenshot.pageNumber || '?'})`;
    }
    if(articleIdSpan) articleIdSpan.textContent = truncateText(articleFrontendId, 30);
    if(ssIdSpan) ssIdSpan.textContent = truncateText(screenshotId, 40);
    const filenameToDisplay = screenshot.serverFilePath ? screenshot.serverFilePath.split('/').pop() : (screenshot.filenameSuggested || 'N/A');
    if(filenameSpan) filenameSpan.textContent = truncateText(filenameToDisplay, 40);
    if(hiddenArticleIdInput) hiddenArticleIdInput.value = articleFrontendId;
    if(hiddenSsIdInput) hiddenSsIdInput.value = screenshotId; // Store the ID used to find the screenshot

    chartTypeSelect.value = screenshot.chartType || "未指定";
    if(descriptionTextarea) descriptionTextarea.value = screenshot.description || "";
    if(wpdTextarea) wpdTextarea.value = screenshot.wpdData || "";

    // 控制 "保存并返回全屏" 按钮的可见性 (通常只在主仪表盘PDF查看器全屏时有意义)
    const isInFullscreen = !!(document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    if (saveAndResumeBtn) { // This button might only exist on the main dashboard's modal
        saveAndResumeBtn.classList.toggle('hidden', !isInFullscreen || instanceSuffix !== ""); // Hide if not main dashboard or not fullscreen
    }

    // 显示模态框
    editModal.style.display = 'flex';
    if(typeof showStatus === "function") showStatus(`请编辑截图信息${suffixLog}。您可以按 ESC 键或点击“取消”关闭。`, 'text-blue-500', 7000);

    // 如果当前是全屏模式，并且是主仪表盘实例，提示用户可能需要先退出全屏来获得更好的编辑体验
    // (实际退出全屏的操作不在此函数处理，由用户或调用处决定)
    if (isInFullscreen && instanceSuffix === "") { // Example: only warn for main dashboard instance
        console.log(`${suffixLog} Edit modal opened. User is currently in fullscreen. Save & Resume button shown.`);
    }
}

/**
 * 处理保存截图元数据更改。
 * @param {boolean} isResumingFullscreen - 是否在保存后尝试恢复全屏 (通常仅用于主仪表盘实例)。
 * @param {string} instanceSuffix - 调用此函数的PDF查看器实例的后缀。
 * @returns {Promise<boolean>} 操作是否成功与服务器同步 (或本地更新成功)。
 */
export async function handleSaveScreenshotChanges(isResumingFullscreen = false, instanceSuffix = "") {
    const suffixLog = `[ScreenshotMgr/${instanceSuffix || 'default'}/SaveChanges]`;
    console.log(`${suffixLog} Attempting to save screenshot changes. Resume fullscreen: ${isResumingFullscreen}`);

    // 获取对应实例的模态框表单元素值
    const articleFrontendId = document.getElementById(`editingScreenshotArticleId${instanceSuffix}`)?.value;
    const screenshotIdToUpdate = document.getElementById(`editingScreenshotId${instanceSuffix}`)?.value; // This is the ID used to find it in the array
    const newChartType = document.getElementById(`editSsChartType${instanceSuffix}`)?.value;
    const newDescription = document.getElementById(`editSsDescription${instanceSuffix}`)?.value.trim();
    const newWpdData = document.getElementById(`wpdDataTextarea${instanceSuffix}`)?.value.trim();

    if (!articleFrontendId || !screenshotIdToUpdate) {
        if(typeof showStatus === "function") showStatus(`错误${suffixLog}：无法确定要更新哪个截图记录。表单数据不完整。`, "text-red-500", 5000);
        return false;
    }

    const articleIndex = window.tableData.findIndex(row => row._id === articleFrontendId);
    if (articleIndex === -1 || !window.tableData[articleIndex].screenshots) {
        if(typeof showStatus === "function") showStatus(`错误${suffixLog}：在前端数据中未找到文献 (ID: ${articleFrontendId}) 或其截图列表。`, "text-red-500", 5000);
        return false;
    }
    const screenshotIndex = window.tableData[articleIndex].screenshots.findIndex(ss => (ss.id === screenshotIdToUpdate || ss.serverMetadataPath === screenshotIdToUpdate));
    if (screenshotIndex === -1) {
        if(typeof showStatus === "function") showStatus(`错误${suffixLog}：在文献 (ID: ${articleFrontendId}) 中未找到截图 (ID: ${screenshotIdToUpdate})。`, "text-red-500", 5000);
        return false;
    }

    const targetScreenshot = window.tableData[articleIndex].screenshots[screenshotIndex];
    const serverMetadataPath = targetScreenshot.serverMetadataPath; // Get the path for API update
    let changesMade = false;

    // 检查是否有实际更改
    if (targetScreenshot.chartType !== newChartType) changesMade = true;
    if (targetScreenshot.description !== newDescription) changesMade = true;
    if (targetScreenshot.wpdData !== newWpdData) changesMade = true;

    if (!changesMade) {
        if(typeof showStatus === "function") showStatus(`信息未更改，无需保存${suffixLog}。`, "text-yellow-500", 3000);
        closeModal(`editScreenshotModal${instanceSuffix}`);
        if (isResumingFullscreen && instanceSuffix === "") { // Only for main dashboard instance potentially
            setTimeout(() => togglePdfViewerFullscreen(instanceSuffix), 150);
        }
        return true; // No changes, but operation is "complete" in a sense
    }

    let operationSuccess = false;
    if (!serverMetadataPath) {
        // 仅本地更新 (截图未同步到服务器或无元数据路径)
        console.warn(`${suffixLog} Screenshot (ID: ${screenshotIdToUpdate}) has no serverMetadataPath. Updating locally only.`);
        targetScreenshot.chartType = newChartType;
        targetScreenshot.description = newDescription;
        targetScreenshot.wpdData = newWpdData;
        targetScreenshot.lastUpdated_client = new Date().toISOString();
        operationSuccess = true;
        if(typeof showStatus === "function") showStatus(`截图信息已在本地更新${suffixLog} (此截图未与服务器元数据关联)。`, 'text-yellow-600', 4000);
    } else {
        // 尝试更新服务器上的元数据
        if(typeof showStatus === "function") showStatus(`正在更新服务器上的截图元数据${suffixLog}...`, 'text-blue-500', 0);
        const payload = {
            serverMetadataPath: serverMetadataPath, // 后端需要此路径来定位元数据文件
            chartType: newChartType,
            description: newDescription,
            wpdData: newWpdData
        };
        const serverUpdateSuccess = await updateScreenshotMetadataApi(payload);
        if (serverUpdateSuccess) {
            targetScreenshot.chartType = newChartType;
            targetScreenshot.description = newDescription;
            targetScreenshot.wpdData = newWpdData;
            targetScreenshot.lastUpdated_client = new Date().toISOString(); // Reflect client-side update time
            // API 内部应该已经调用了 showStatus 报告成功
            operationSuccess = true;
        } else {
            // API 内部应该已经调用了 showStatus 报告失败
            operationSuccess = false;
        }
    }

    if (operationSuccess) {
        saveTableDataToLocalStorage(); // 保存 window.tableData 的更改
        displayScreenshotsForCurrentArticle(articleFrontendId, instanceSuffix); // 刷新截图列表UI
    }

    closeModal(`editScreenshotModal${instanceSuffix}`);

    if (operationSuccess && isResumingFullscreen && instanceSuffix === "") { // 通常只对主仪表盘实例
        console.log(`${suffixLog} Screenshot changes saved. Attempting to resume fullscreen.`);
        setTimeout(() => togglePdfViewerFullscreen(instanceSuffix), 150); // 确保模态框关闭后再尝试全屏
    }
    return operationSuccess;
}

/**
 * 处理删除截图的逻辑，包括从服务器删除和从本地数据模型中移除。
 * @param {string|number} articleDbId - 截图所属文献的数据库ID。
 * @param {string|number} screenshotIdToDelete - 要删除截图的数据库ID。
 */
export async function handleDeleteScreenshot(articleDbId, screenshotIdToDelete) {
    const suffixLog = `[ScreenshotMgr/Delete]`;
    console.log(`${suffixLog} Request to delete screenshot. Article DB ID: ${articleDbId}, Screenshot DB ID: ${screenshotIdToDelete}`);

    const articleIndex = window.tableData.findIndex(row => row.db_id == articleDbId); // 使用 db_id 查找
    if (articleIndex === -1 || !window.tableData[articleIndex].screenshots) {
        if(typeof showStatus === "function") showStatus(`错误${suffixLog}：未找到文献 (ID: ${articleDbId}) 或其截图列表。`, "text-red-500", 4000);
        return;
    }

    const screenshotIndex = window.tableData[articleIndex].screenshots.findIndex(ss => ss.id == screenshotIdToDelete);
    if (screenshotIndex === -1) {
        if(typeof showStatus === "function") showStatus(`错误${suffixLog}：在文献 (ID: ${articleDbId}) 中未找到要删除的截图 (ID: ${screenshotIdToDelete})。`, "text-red-500", 4000);
        return;
    }

    const screenshotToDelete = window.tableData[articleIndex].screenshots[screenshotIndex];
    const filenameHint = truncateText(screenshotToDelete.image_relative_path?.split('/').pop() || '该截图', 30);

    if (!confirm(`您确定要删除截图 "${filenameHint}" 吗？\n此操作将从服务器和本地记录中永久删除此截图，不可恢复。`)) {
        if(typeof showStatus === "function") showStatus(`删除操作已取消${suffixLog}。`, 'text-gray-500', 2000);
        return;
    }

    let serverDeleteSuccess = false;

    // 尝试从服务器删除
    if(typeof showStatus === "function") showStatus(`正在尝试从服务器删除截图 "${filenameHint}"${suffixLog}...`, 'text-blue-500', 0);
    try {
        // *** 关键修改：调用新的API函数，并只传递 screenshotIdToDelete ***
        const response = await deleteScreenshotFromServerApi(screenshotIdToDelete);
        serverDeleteSuccess = response && response.success;

        // 更新前端的用户统计数据（如果API返回了新值）
        if (serverDeleteSuccess && response.new_storage_used_bytes !== undefined && response.new_screenshot_count !== undefined) {
             const userForUpdate = window.tableData.find(u => u.id == screenshotToDelete.user_id); // 假设可以这样找到用户，或者从localStorage
             if (userForUpdate) { // 这个逻辑可能需要调整，取决于你如何管理全局User状态
                 userForUpdate.storage_used_bytes = response.new_storage_used_bytes;
                 userForUpdate.screenshot_count = response.new_screenshot_count;
             }
             // 更好的做法是，在操作成功后，重新调用 fetchDashboardStats() 来刷新整个统计面板。
        }

    } catch (error) {
        console.error(`${suffixLog} Error calling deleteScreenshotFromServerApi:`, error);
        serverDeleteSuccess = false;
    }

    if (serverDeleteSuccess) {
        // 从前端数据模型中移除截图记录
        window.tableData[articleIndex].screenshots.splice(screenshotIndex, 1);
        saveTableDataToLocalStorage(); // 更新localStorage
        displayScreenshotsForCurrentArticle(articleDbId); // 刷新UI

        if(typeof showStatus === "function") showStatus(`截图 "${filenameHint}" 已成功删除。`, "text-green-500", 4000);
        console.log(`${suffixLog} Screenshot (ID: ${screenshotIdToDelete}) deleted from article (ID: ${articleDbId}) in frontend model.`);
    } else {
        // 如果服务器删除失败，API函数内部应该已经显示了错误消息
        if(typeof showStatus === "function") {
             showStatus(`从服务器删除截图 "${filenameHint}" 失败${suffixLog}。本地记录未更改。`, 'text-red-500', 5000);
        }
    }
}
// ==========================================================================
// FINAL LOG
// ==========================================================================
console.log("screenshotManager.js (Production Grade) loaded: Screenshot management functions are available.");