// js/screenshotManager.js
import { showStatus, truncateText, sanitizeFilenameForImage, closeModal, findHeader } from './utils.js';
import { saveScreenshotApi, updateScreenshotMetadataApi } from './api.js';
import { saveTableDataToLocalStorage } from './dataManager.js';
import { togglePdfViewerFullscreen } from './pdfViewerCore.js';
import { COLUMN_MAPPING, THUMBNAIL_MAX_WIDTH, THUMBNAIL_MAX_HEIGHT } from './config.js';

import { deleteScreenshotFromServerApi } from './api.js'; // 导入新的删除API


/**
 * 处理“截取选中”按钮的点击事件，捕获截图并发送到服务器。
 * @param {string} instanceSuffix - 调用此函数的PDF查看器实例的后缀 (e.g., "", "_MyRecords").
 */
export async function handleCaptureScreenshot(instanceSuffix = "") {
    const suffixLog = `[${instanceSuffix || 'global'}]`; // 用于日志，区分实例
    console.log(`handleCaptureScreenshot${suffixLog}: Attempting capture.`);

    // 根据 instanceSuffix 获取正确的DOM元素和全局变量
    const pdfCanvasElem = document.getElementById(`pdfCanvas${instanceSuffix}`);
    const selectionCanvasElem = document.getElementById(`selectionCanvas${instanceSuffix}`);
    const captureSelectionBtnElem = document.getElementById(`captureSelectionBtn${instanceSuffix}`);

    const currentViewingArticleRowId = window[`currentViewingArticleRowId${instanceSuffix}`];
    const selectionRect = window[`selectionRect${instanceSuffix}`];
    const pdfDoc = window[`pdfDoc${instanceSuffix}`];
    const currentPageNum = window[`currentPageNum${instanceSuffix}`];
    const currentPdfScale = window[`currentPdfScale${instanceSuffix}`];

    console.log(`handleCaptureScreenshot${suffixLog}: currentViewingArticleRowId: ${currentViewingArticleRowId}`);
    console.log(`handleCaptureScreenshot${suffixLog}: selectionRect: ${JSON.stringify(selectionRect)}`);

    if (!pdfCanvasElem || typeof pdfCanvasElem.getContext !== 'function') {
        alert("PDF渲染画布未找到或无效，无法截图。");
        showStatus(`截图失败${suffixLog}：PDF渲染画布丢失或无效。`, 'text-red-500', 3000);
        console.error(`handleCaptureScreenshot${suffixLog}: pdfCanvasElem is not a valid canvas element or not found.`);
        return;
    }

    if (!selectionRect || !selectionRect.finalWidth || !selectionRect.finalHeight ||
        selectionRect.finalWidth <= 0 || selectionRect.finalHeight <= 0) {
        alert("请先在PDF页面上框选一个有效的区域。");
        return;
    }
    if (!currentViewingArticleRowId) {
        alert("无法确定当前操作的文献，请重新打开PDF查看器并选择文献。");
        return;
    }

    // currentArticleRow 仍然从全局 tableData 获取，因为截图数据最终要存回那里
    const currentArticleRow = window.tableData.find(r => r._id === currentViewingArticleRowId);
    if (!currentArticleRow) {
        console.error(`handleCaptureScreenshot${suffixLog}: Critical - Could not find article data for rowId: ${currentViewingArticleRowId}`);
        alert("无法找到当前文献数据来保存截图记录，操作失败。");
        return;
    }

    showStatus(`正在处理截图并上传到服务器${suffixLog}...`, 'text-blue-500');

    // 创建临时canvas用于绘制截图
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = selectionRect.finalWidth;
    tempCanvas.height = selectionRect.finalHeight;
    const tempCtx = tempCanvas.getContext('2d');

    // 从主PDF画布绘制选区到临时canvas
    tempCtx.drawImage(
        pdfCanvasElem,
        selectionRect.finalX, selectionRect.finalY,
        selectionRect.finalWidth, selectionRect.finalHeight,
        0, 0, selectionRect.finalWidth, selectionRect.finalHeight
    );
    const imageDataUrlForApi = tempCanvas.toDataURL('image/png'); // 获取截图的Base64数据

    // 创建缩略图
    const thumbMaxWidth = THUMBNAIL_MAX_WIDTH; // 直接使用导入的常量
    const thumbMaxHeight = THUMBNAIL_MAX_HEIGHT; // 直接使用导入的常量
    const thumbnailCanvas = document.createElement('canvas');
    const aspectRatio = selectionRect.finalWidth / selectionRect.finalHeight;

    if (selectionRect.finalWidth === 0 || selectionRect.finalHeight === 0) {
        showStatus(`截图失败${suffixLog}：选区大小无效。`, 'text-red-500', 3000);
        return;
    }

    if (aspectRatio > thumbMaxWidth / thumbMaxHeight) {
        thumbnailCanvas.width = thumbMaxWidth;
        thumbnailCanvas.height = Math.max(1, thumbMaxWidth / aspectRatio);
    } else {
        thumbnailCanvas.height = thumbMaxHeight;
        thumbnailCanvas.width = Math.max(1, thumbMaxHeight * aspectRatio);
    }
    const thumbCtx = thumbnailCanvas.getContext('2d');
    if (tempCanvas.width > 0 && tempCanvas.height > 0) {
        thumbCtx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
    }
    const thumbnailDataUrlForStorage = thumbnailCanvas.toDataURL('image/png'); // 缩略图的Base64数据

    // 获取原始页面尺寸和捕获时的缩放比例
    let originalPageDimensions = null;
    if (pdfDoc && currentPageNum) {
        try {
            const page = await pdfDoc.getPage(currentPageNum);
            const viewportScale1 = page.getViewport({ scale: 1.0 });
            originalPageDimensions = {
                width: viewportScale1.width,
                height: viewportScale1.height,
                scale: 1.0 // 记录的是原始未缩放的尺寸
            };
        } catch (pageError) {
            console.error(`handleCaptureScreenshot${suffixLog}: Error getting original page dimensions:`, pageError);
        }
    }

    // 准备文件名和API载荷
    let baseFilename = '图表截图';
    const titleHeaderKey = findHeader(Object.keys(currentArticleRow), COLUMN_MAPPING.title); // 直接使用导入的 COLUMN_MAPPING
    const articleTitle = currentArticleRow[titleHeaderKey] ? String(currentArticleRow[titleHeaderKey]).trim() : '';
    if (articleTitle) {
        baseFilename = truncateText(sanitizeFilenameForImage(articleTitle), 30);
    }
    const existingScreenshotsCount = currentArticleRow.screenshots ? currentArticleRow.screenshots.length : 0;
    const suggestedFilename = `${baseFilename}_P${selectionRect.pageNum}_Sel${existingScreenshotsCount + 1}.png`;

    const payload = {
        articleId: currentViewingArticleRowId, // 前端行ID
        db_id: currentArticleRow.db_id || null, // 后端数据库ID (如果存在)
        articleTitle: articleTitle || "Untitled Article",
        pageNumber: selectionRect.pageNum,
        selectionRect: { // 截图在当前视口中的坐标和大小
            x: selectionRect.finalX,
            y: selectionRect.finalY,
            width: selectionRect.finalWidth,
            height: selectionRect.finalHeight
        },
        imageData: imageDataUrlForApi,
        suggestedFilename: suggestedFilename,
        chartType: "未指定", // 默认图表类型
        description: "",     // 默认描述
        originalPageDimensions: originalPageDimensions, // PDF原始页面尺寸
        captureScale: currentPdfScale // 截图时的PDF缩放比例
    };

    // 调用API保存截图
    const serverResponse = await saveScreenshotApi(payload);

    if (serverResponse && serverResponse.success) {
        // API调用成功，更新前端数据
        const newScreenshotRecord = {
            id: serverResponse.metadataFilePath,
            pageNumber: selectionRect.pageNum,
            rect: payload.selectionRect,
            filenameSuggested: serverResponse.serverFilePath ? serverResponse.serverFilePath.split('/').pop() : suggestedFilename,
            chartType: "未指定",
            description: "",
            timestamp: new Date().toISOString(),
            thumbnailDataUrl: thumbnailDataUrlForStorage, // 保存缩略图数据
            wpdData: null, // WebPlotDigitizer 数据，初始为空
            serverFilePath: serverResponse.serverFilePath, // 服务器保存的图片路径
            serverMetadataPath: serverResponse.metadataFilePath, // 服务器保存的元数据路径
            originalPageDimensions: originalPageDimensions,
            captureScale: currentPdfScale,
            lastUpdated_client: new Date().toISOString()
        };

        if (!currentArticleRow.screenshots) {
            currentArticleRow.screenshots = [];
        }
        currentArticleRow.screenshots.push(newScreenshotRecord);

        saveTableDataToLocalStorage(); // 保存更新后的 tableData 到 localStorage
        displayScreenshotsForCurrentArticle(currentViewingArticleRowId, instanceSuffix); // 刷新截图列表显示

        showStatus(serverResponse.message || `截图已成功保存到服务器${suffixLog}！`, 'text-green-500', 4000);
        console.log(`handleCaptureScreenshot${suffixLog}: Screenshot saved. Server response:`, serverResponse);
    } else if (serverResponse && !serverResponse.success) {
        showStatus(serverResponse.message || `截图保存到服务器失败${suffixLog}。`, 'text-red-500', 7000);
    }
    // 如果 serverResponse 为 null, api.js 中的 saveScreenshotApi 内部应该已经调用过 showStatus

    // 清理选区并隐藏“截取选中”按钮
    const currentSelectionCtx = window[`selectionCtx${instanceSuffix}`];
    if (selectionCanvasElem && currentSelectionCtx) {
         currentSelectionCtx.clearRect(0, 0, selectionCanvasElem.width, selectionCanvasElem.height);
    }
    if (captureSelectionBtnElem) captureSelectionBtnElem.classList.add('hidden');
}

/**
 * 在PDF查看器的侧边栏显示当前选中文献的截图列表。
 * @param {string} articleRowIdToDisplay - 要显示截图的文献的前端 _id。
 * @param {string} instanceSuffix - 调用此函数的PDF查看器实例的后缀.
 */
export function displayScreenshotsForCurrentArticle(articleRowIdToDisplay, instanceSuffix = "") {
    const suffixLog = `[${instanceSuffix || 'global'}]`;
    const screenshotsListContainerEl = document.getElementById(`screenshotsListContainer${instanceSuffix}`);
    const noScreenshotsMessageEl = document.getElementById(`noScreenshotsMessage${instanceSuffix}`);
    // currentArticleScreenshotsDivEl 是仪表盘页面特有的截图列表父容器，my_records 页面没有这个ID
    const currentArticleScreenshotsDivEl = (instanceSuffix === "") ? document.getElementById(`currentArticleScreenshots`) : null;


    if (!screenshotsListContainerEl || !noScreenshotsMessageEl) {
        console.warn(`displayScreenshotsForCurrentArticle${suffixLog}: Critical UI elements for screenshots panel are missing (screenshotsListContainer or noScreenshotsMessage).`);
        return;
    }
    // 对于仪表盘，确保父容器可见
    if (instanceSuffix === "" && currentArticleScreenshotsDivEl) {
        currentArticleScreenshotsDivEl.classList.remove('hidden');
    }


    screenshotsListContainerEl.innerHTML = ''; // 清空现有列表

    if (!articleRowIdToDisplay) {
        noScreenshotsMessageEl.textContent = "请先选择一篇文献。";
        noScreenshotsMessageEl.classList.remove('hidden');
        return;
    }

    const article = window.tableData.find(row => row._id === articleRowIdToDisplay);

    if (article && article.screenshots && article.screenshots.length > 0) {
        noScreenshotsMessageEl.classList.add('hidden'); // 隐藏“无截图”消息
        const ul = document.createElement('ul');
        ul.className = 'list-none space-y-2 p-1'; // 列表样式

        // 按页码和时间戳排序截图
        article.screenshots.sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0) || (a.timestamp || "").localeCompare(b.timestamp || ""));

        article.screenshots.forEach((ss, index) => {
            const li = document.createElement('li');
            li.className = 'hover:bg-gray-200 p-2 rounded transition-colors duration-150 flex justify-between items-start border border-gray-200 shadow-sm';
            li.dataset.screenshotId = ss.id; // 截图的前端ID
            li.dataset.articleId = article._id; // 文献的前端ID

            // 缩略图容器
            const imgContainer = document.createElement('div');
            imgContainer.className = 'flex-shrink-0 mr-3 w-24 h-auto'; // 固定宽度以保持一致性
            if (ss.thumbnailDataUrl) {
                const img = document.createElement('img');
                img.src = ss.thumbnailDataUrl;
                img.alt = `截图 ${index + 1} (P${ss.pageNumber})`;
                img.className = 'w-full h-full object-contain border border-gray-300 rounded'; // 保持图片比例
                imgContainer.appendChild(img);
            } else {
                // 如果没有缩略图，显示占位符
                const placeholder = document.createElement('div');
                placeholder.className = 'w-full h-16 border border-dashed border-gray-300 rounded flex items-center justify-center text-gray-400 text-xs';
                placeholder.textContent = '无预览';
                imgContainer.appendChild(placeholder);
            }
            li.appendChild(imgContainer);

            // 文本信息和控制按钮容器
            const textAndControlsContainer = document.createElement('div');
            textAndControlsContainer.className = 'flex-grow flex flex-col min-w-0'; // min-w-0 确保文本截断生效

            // 截图基本信息（文件名、页码、类型、WPD指示）
            const textInfo = document.createElement('div');
            textInfo.className = 'cursor-pointer mb-1'; // 点击可编辑
            let displayText = `P${ss.pageNumber} - "${truncateText(ss.filenameSuggested || ss.serverFilePath?.split('/').pop() || '截图', 15)}"`;
            if (ss.chartType && ss.chartType !== "未指定") {
                displayText += ` <span class="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full whitespace-nowrap">${ss.chartType}</span>`;
            }
            if (ss.wpdData && ss.wpdData.trim() !== "") { // 检查是否有WPD数据
                displayText += ` <i class="fas fa-ruler-combined text-purple-500 ml-1" title="包含已提取的WebPlotDigitizer数据"></i>`;
            }
            if (ss.serverFilePath) { // 如果已同步到服务器
                displayText += ` <i class="fas fa-cloud-upload-alt text-green-500 ml-1" title="已同步到服务器"></i>`;
            }
            textInfo.innerHTML = displayText;
            textInfo.addEventListener('click', function() {
                handleScreenshotItemClick(article._id, ss.id, instanceSuffix); // 点击打开编辑模态框
            });
            textAndControlsContainer.appendChild(textInfo);

            // 截图描述 (如果存在)
            if (ss.description) {
                const descP = document.createElement('p');
                descP.className = 'text-xs text-gray-500 italic truncate'; // 截断长描述
                descP.title = ss.description; // 完整描述作为tooltip
                descP.textContent = truncateText(ss.description, 30);
                textAndControlsContainer.appendChild(descP);
            }

            // 控制按钮组 (下载原图、删除)
            const controlsDiv = document.createElement('div');
            controlsDiv.className = 'mt-auto pt-1 flex items-center space-x-2'; // 确保按钮在底部

            // “下载原图用于WebPlotDigitizer”按钮
            if (ss.serverFilePath) { // 仅当截图已同步到服务器时显示
                  const downloadForWpdButton = document.createElement('button');
                  downloadForWpdButton.innerHTML = `<i class="fas fa-draw-polygon text-blue-500"></i>`;
                  downloadForWpdButton.className = 'p-1 rounded hover:bg-blue-100 text-xs';
                  downloadForWpdButton.title = `下载原图 (${ss.serverFilePath.split('/').pop()}) 并准备用于WebPlotDigitizer`;
                  downloadForWpdButton.onclick = (event) => {
                      event.stopPropagation(); // 防止触发父元素的点击事件
                      const backendApiUrl = (window.backendBaseUrl || document.getElementById('backendApiUrlInput')?.value)?.trim().replace(/\/$/, "");
                      if (!backendApiUrl) { showStatus('错误：后端API链接未配置。', 'text-red-500', 4000); return; }
                      const downloadUrl = `${backendApiUrl}/api/download_screenshot_image?path=${encodeURIComponent(ss.image_server_path)}`;
                      showStatus(`准备下载原图: ${ss.image_server_path.split('/').pop()}...`, 'text-blue-500', 3000);
                      // 创建临时链接并点击以下载文件
                      const tempLink = document.createElement('a'); tempLink.href = downloadUrl;
                      document.body.appendChild(tempLink); tempLink.click(); document.body.removeChild(tempLink);
                      // 提示用户打开WPD
                      setTimeout(() => { showStatus(`原图已开始下载。请打开 WebPlotDigitizer。 <a href="https://automeris.io/WebPlotDigitizer/" target="_blank" class="text-blue-600 hover:underline">打开WPD</a>`, 'text-green-500', 10000); }, 1000);
                  };
                  controlsDiv.appendChild(downloadForWpdButton);
            }

            // 删除按钮
            const deleteButton = document.createElement('button');
            deleteButton.innerHTML = `<i class="fas fa-trash-alt text-red-500 hover:text-red-700"></i>`;
            deleteButton.className = 'p-1 rounded hover:bg-red-100 text-xs';
            deleteButton.title = "删除此截图记录";
            deleteButton.onclick = (event) => {
                event.stopPropagation(); // 防止触发父元素的点击事件
                handleDeleteScreenshot(article._id, ss.id, instanceSuffix); // 调用删除函数
            };
            controlsDiv.appendChild(deleteButton);
            textAndControlsContainer.appendChild(controlsDiv);
            li.appendChild(textAndControlsContainer);
            ul.appendChild(li);
        });
        screenshotsListContainerEl.appendChild(ul);
    } else {
        // 如果没有截图，显示提示信息
        noScreenshotsMessageEl.textContent = (article && articleRowIdToDisplay) ? '此文献尚无截图记录。' : '请先从文献列表中选择一篇文献。';
        noScreenshotsMessageEl.classList.remove('hidden');
    }
}


/**
 * 处理截图列表项点击事件，打开编辑模态框并填充数据。
 * @param {string} articleId 截图所属文献的前端ID (_id)。
 * @param {string} screenshotId 被点击截图的前端ID。
 * @param {string} instanceSuffix - 调用此函数的PDF查看器实例的后缀.
 */
export function handleScreenshotItemClick(articleId, screenshotId, instanceSuffix = "") {
    const suffixLog = `[${instanceSuffix || 'global'}]`;
    console.log(`DEBUG: handleSaveScreenshotChanges${suffixLog}: Function called.`);
    const article = window.tableData.find(row => row._id === articleId);
    if (!article || !article.screenshots) {
        alert("错误：未找到对应的文献记录或截图列表。");
        console.error(`handleScreenshotItemClick${suffixLog}: Article or screenshots array not found for articleId: ${articleId}`);
        return;
    }
    const screenshot = article.screenshots.find(ss => ss.id === screenshotId);
    if (!screenshot) {
        alert("错误：未找到要编辑的截图记录。");
        console.error(`handleScreenshotItemClick${suffixLog}: Screenshot not found for screenshotId: ${screenshotId} in articleId: ${articleId}`);
        return;
    }

    // 获取实例特定的DOM元素
    const editScreenshotModalElem = document.getElementById(`editScreenshotModal${instanceSuffix}`);
    const editSsArticleIdSpanElem = document.getElementById(`editSsArticleId${instanceSuffix}`);
    const editSsIdSpanElem = document.getElementById(`editSsId${instanceSuffix}`);
    const editSsFilenameSpanElem = document.getElementById(`editSsFilename${instanceSuffix}`);
    const editingScreenshotArticleIdInputElem = document.getElementById(`editingScreenshotArticleId${instanceSuffix}`);
    const editingScreenshotIdInputElem = document.getElementById(`editingScreenshotId${instanceSuffix}`);
    const editSsChartTypeSelectElem = document.getElementById(`editSsChartType${instanceSuffix}`);
    const editSsDescriptionTextareaElem = document.getElementById(`editSsDescription${instanceSuffix}`);
    const wpdDataTextareaElem = document.getElementById(`wpdDataTextarea${instanceSuffix}`);
    const editScreenshotModalTitleElem = document.getElementById(`editScreenshotModalTitle${instanceSuffix}`);
    const saveAndResumeFullscreenBtnElem = document.getElementById(`saveAndResumeFullscreenBtn${instanceSuffix}`);


    if (!editScreenshotModalElem || !editSsChartTypeSelectElem /* ... etc. */) {
        console.error(`handleScreenshotItemClick${suffixLog}: Modal elements not fully available.`);
        alert("错误：编辑对话框未能正确初始化。");
        return;
    }

    // 填充模态框数据
    if(editSsArticleIdSpanElem) editSsArticleIdSpanElem.textContent = articleId;
    if(editSsIdSpanElem) editSsIdSpanElem.textContent = screenshotId;
    const filenameToDisplay = screenshot.serverFilePath ? screenshot.serverFilePath.split('/').pop() : (screenshot.filenameSuggested || 'N/A');
    if(editSsFilenameSpanElem) editSsFilenameSpanElem.textContent = truncateText(filenameToDisplay, 40);
    if(editingScreenshotArticleIdInputElem) editingScreenshotArticleIdInputElem.value = articleId;
    if(editingScreenshotIdInputElem) editingScreenshotIdInputElem.value = screenshotId;

    editSsChartTypeSelectElem.value = screenshot.chartType || "未指定";
    if(editSsDescriptionTextareaElem) editSsDescriptionTextareaElem.value = screenshot.description || "";
    if(wpdDataTextareaElem) wpdDataTextareaElem.value = screenshot.wpdData || ""; // 填充WPD数据
    if(editScreenshotModalTitleElem) {
        // 模态框标题应显示文献的标题，而不是文献ID本身
        const articleTitleForModal = article.title ? truncateText(article.title, 20) : '未知文献';
        editScreenshotModalTitleElem.textContent = `编辑截图 (${articleTitleForModal} - P${screenshot.pageNumber})`;
    }
    // 控制 "保存并返回全屏" 按钮的可见性
    const isInFullscreen = !!(document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    if (saveAndResumeFullscreenBtnElem) {
        saveAndResumeFullscreenBtnElem.classList.toggle('hidden', !isInFullscreen);
    }

    // 显示模态框的函数
    function displayEditModal() {
        editScreenshotModalElem.style.display = 'flex'; // 使用flex以匹配HTML中的样式
        showStatus(`请编辑截图信息${suffixLog}。您可以按 ESC 键或点击“取消”关闭此对话框。`, 'text-blue-500', 5000);
    }

    // 如果当前是全屏模式，先退出全屏再显示模态框
    if (isInFullscreen) {
        showStatus(`正在退出全屏以编辑截图${suffixLog}...`, 'text-blue-500', 2000);
        const onFullscreenChange = () => {
            // 移除所有全屏变化监听器，确保只执行一次
            document.removeEventListener('fullscreenchange', onFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
            document.removeEventListener('mozfullscreenchange', onFullscreenChange);
            document.removeEventListener('MSFullscreenChange', onFullscreenChange);
            displayEditModal(); // 退出全屏后显示模态框
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);
        document.addEventListener('webkitfullscreenchange', onFullscreenChange);
        document.addEventListener('mozfullscreenchange', onFullscreenChange);
        document.addEventListener('MSFullscreenChange', onFullscreenChange);

        // 尝试退出全屏
        if (document.exitFullscreen) document.exitFullscreen().catch(err => console.error("Error exiting fullscreen:", err));
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
        else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
    } else {
        // 如果不是全屏，直接显示模态框
        displayEditModal();
    }
}

/**
 * 处理保存截图元数据更改的逻辑。
 * @param {boolean} isResumingFullscreen - 是否在保存后尝试恢复全屏。
 * @param {string} instanceSuffix - 调用此函数的PDF查看器实例的后缀.
 */
export async function handleSaveScreenshotChanges(isResumingFullscreen = false, instanceSuffix = "") {
    const suffixLog = `[${instanceSuffix || 'global'}]`;
    console.log(`handleSaveScreenshotChanges${suffixLog}: Called. isResumingFullscreen: ${isResumingFullscreen}`);

    // 获取实例特定的DOM元素值
    const articleId = document.getElementById(`editingScreenshotArticleId${instanceSuffix}`).value;
    const screenshotId = document.getElementById(`editingScreenshotId${instanceSuffix}`).value;
    const newChartType = document.getElementById(`editSsChartType${instanceSuffix}`).value;
    const newDescription = document.getElementById(`editSsDescription${instanceSuffix}`).value.trim();
    const newWpdData = document.getElementById(`wpdDataTextarea${instanceSuffix}`).value.trim();

    if (!articleId || !screenshotId) {
        alert("错误：无法确定要更新哪个截图。");
        return false; // 保存操作未成功启动
    }

    let targetScreenshot = null;
    let articleIndex = -1;
    let screenshotIndex = -1;

    // 在全局 tableData 中查找对应的文献和截图
    articleIndex = window.tableData.findIndex(row => row._id === articleId);
    if (articleIndex > -1 && window.tableData[articleIndex].screenshots) {
        screenshotIndex = window.tableData[articleIndex].screenshots.findIndex(ss => ss.id === screenshotId);
        if (screenshotIndex > -1) {
            targetScreenshot = window.tableData[articleIndex].screenshots[screenshotIndex];
        }
    }

    if (!targetScreenshot) {
        alert("错误：更新失败，在前端数据中未找到截图记录。");
        return false; // 保存操作因未找到记录而失败
    }

    const serverMetadataPathToUpdate = targetScreenshot.serverMetadataPath;
    let operationConsideredSuccess = false;

    if (!serverMetadataPathToUpdate) {
        // 情况1: 截图没有服务器元数据路径，只进行本地更新
        console.warn(`handleSaveScreenshotChanges${suffixLog}: Screenshot ${screenshotId} for article ${articleId} has no serverMetadataPath. Updating locally only.`);
        window.tableData[articleIndex].screenshots[screenshotIndex].chartType = newChartType;
        window.tableData[articleIndex].screenshots[screenshotIndex].description = newDescription;
        window.tableData[articleIndex].screenshots[screenshotIndex].wpdData = newWpdData;
        window.tableData[articleIndex].screenshots[screenshotIndex].lastUpdated_client = new Date().toISOString();
        saveTableDataToLocalStorage(); // 保存到localStorage
        displayScreenshotsForCurrentArticle(articleId, instanceSuffix); // 刷新截图列表
        showStatus(`截图信息已在本地更新${suffixLog}（此截图未与服务器完全关联）。`, 'text-yellow-600', 4000);
        operationConsideredSuccess = true;
    } else {
        // 情况2: 尝试更新服务器上的元数据
        showStatus(`正在更新服务器上的截图元数据${suffixLog}...`, 'text-blue-500');
        const payload = {
            serverMetadataPath: serverMetadataPathToUpdate,
            chartType: newChartType,
            description: newDescription,
            wpdData: newWpdData // 发送WPD数据到后端
        };
        console.log(`DEBUG: handleSaveScreenshotChanges${suffixLog}: Payload to API:`, payload); // <--- 新增调试
        const serverUpdateSuccess = await updateScreenshotMetadataApi(payload); // 调用API更新
        if (serverUpdateSuccess) {
            // 后端更新成功，同步更新前端的 tableData
            window.tableData[articleIndex].screenshots[screenshotIndex].chartType = newChartType;
            window.tableData[articleIndex].screenshots[screenshotIndex].description = newDescription;
            window.tableData[articleIndex].screenshots[screenshotIndex].wpdData = newWpdData;
            window.tableData[articleIndex].screenshots[screenshotIndex].lastUpdated_client = new Date().toISOString();
            saveTableDataToLocalStorage();
            displayScreenshotsForCurrentArticle(articleId, instanceSuffix);
            // showStatus 应该由 updateScreenshotMetadataApi 内部处理成功消息
            operationConsideredSuccess = true;
        } else {
            // 服务器更新失败，showStatus 应该由 updateScreenshotMetadataApi 内部处理错误消息
            operationConsideredSuccess = false;
        }
    }

    closeModal(`editScreenshotModal${instanceSuffix}`); // 关闭编辑模态框

    // 如果操作成功且需要恢复全屏
    if (operationConsideredSuccess && isResumingFullscreen) {
        console.log(`handleSaveScreenshotChanges${suffixLog}: Save successful, attempting to resume fullscreen.`);
        setTimeout(() => togglePdfViewerFullscreen(instanceSuffix), 150); // 延迟一点以确保模态框已关闭
    }
    return operationConsideredSuccess; // 返回操作是否被认为是成功的
}

/**
 * 处理删除截图的逻辑。
 * @param {string} articleId 截图所属文献的前端ID (_id)。
 * @param {string} screenshotId 要删除截图的前端ID。
 * @param {string} instanceSuffix - 调用此函数的PDF查看器实例的后缀.
 */
export async function handleDeleteScreenshot(articleId, screenshotId, instanceSuffix = "") {
    const suffixLog = `[${instanceSuffix || 'global'}]`;
    console.log(`handleDeleteScreenshot${suffixLog}: Request to delete screenshot. Article ID: ${articleId}, Screenshot ID: ${screenshotId}`);
    const articleIndex = window.tableData.findIndex(row => row._id === articleId);

    if (articleIndex > -1 && window.tableData[articleIndex].screenshots) {
        const screenshotIndex = window.tableData[articleIndex].screenshots.findIndex(ss => ss.id === screenshotId);
        if (screenshotIndex > -1) {
            const screenshotToDelete = window.tableData[articleIndex].screenshots[screenshotIndex];
            const filenameHint = truncateText(screenshotToDelete.filenameSuggested || screenshotToDelete.serverFilePath?.split('/').pop() || '该截图', 30);

            // 使用浏览器原生的 confirm
            if (confirm(`您确定要删除截图 "${filenameHint}" (页 ${screenshotToDelete.pageNumber}) 吗？此操作将从服务器删除文件。`)) {
                let serverDeleteSuccess = false;
                if (screenshotToDelete.serverFilePath && screenshotToDelete.serverMetadataPath) {
                    showStatus(`正在尝试从服务器删除截图 "${filenameHint}"${suffixLog}...`, 'text-blue-500');
                    serverDeleteSuccess = await deleteScreenshotFromServerApi(screenshotToDelete.serverFilePath, screenshotToDelete.serverMetadataPath);
                } else {
                    // 如果没有服务器路径，只进行本地删除，并警告用户
                    showStatus(`此截图无服务器路径，将只从本地记录中删除。`, 'text-yellow-500', 3000);
                    serverDeleteSuccess = true; // 视为本地删除成功，以继续移除本地记录
                }

                if (serverDeleteSuccess) {
                    // 从前端数据中移除截图记录
                    window.tableData[articleIndex].screenshots.splice(screenshotIndex, 1);
                    saveTableDataToLocalStorage(); // 更新localStorage
                    displayScreenshotsForCurrentArticle(articleId, instanceSuffix); // 刷新截图列表显示

                    if (screenshotToDelete.serverFilePath && screenshotToDelete.serverMetadataPath) {
                        showStatus(`截图 "${filenameHint}" 已从服务器和本地记录中删除${suffixLog}。`, "text-green-500", 3000);
                    } else {
                        showStatus(`截图 "${filenameHint}" 已从本地记录中删除${suffixLog}。`, "text-green-500", 3000);
                    }
                    console.log(`handleDeleteScreenshot${suffixLog}: Screenshot ${screenshotId} deleted locally from article ${articleId}.`);
                } else {
                    // 服务器删除失败，错误消息已由 deleteScreenshotFromServerApi 内部处理
                    showStatus(`从服务器删除截图 "${filenameHint}" 失败${suffixLog}。`, 'text-red-500', 5000);
                }
            } else {
                showStatus(`删除操作已取消${suffixLog}。`, 'text-gray-500', 2000);
            }
        } else {
            alert("错误：未找到要删除的截图记录（本地）。");
        }
    } else {
        alert("错误：未找到对应的文献记录（本地）。");
    }
}