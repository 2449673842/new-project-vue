// js/batchOperations.js

// 步骤 1: 从其他模块导入依赖
import { COLUMN_MAPPING } from './config.js';
import { showStatus, findHeader } from './utils.js';
import { findPdfLinkApi, batchProcessAndZipApi, deleteBatchRecordApi } from './api.js';
import { updateTableDataEntry } from './dataManager.js';


/**
 * 更新批量操作的进度条和文本显示。
 * (这个函数主要被本模块内部调用，通常不需要导出)
 * @param {number} current 当前已处理的数量。
 * @param {number} total 总共需要处理的数量。
 */
function updateBatchProgress(current, total) {
    const container = window.batchProgressContainer || document.getElementById('batchProgressContainer');
    const bar = window.batchProgressBar || document.getElementById('batchProgressBar');
    const text = window.batchProgressText || document.getElementById('batchProgressText');

    if (!container || !bar || !text) {
        console.warn("batchOperations/updateBatchProgress: Progress UI elements not found.");
        return;
    }

    if (total > 0 && current >= 0 && current <= total) {
        const percentage = (current / total) * 100;
        bar.style.width = `${percentage}%`;
        text.textContent = `已处理: ${current} / ${total}`;
        container.classList.remove('hidden');
        text.classList.remove('hidden');
    } else {
        bar.style.width = '0%';
        text.textContent = '';
        container.classList.add('hidden');
        text.classList.add('hidden');
    }
}

/**
 * 为单条文献自动查找PDF链接（由API处理）。
 * (这个函数主要被本模块的 autoFindAllPdfs 调用，通常不需要单独导出)
 * @param {string|null} doi 文献的DOI。
 * @param {string|null} title 文献的标题。
 * @param {string} rowId 该文献在前端tableData中的唯一ID (_id)。
 */
export async function handleAutoFindPdfLink(doi, title, rowId) {
    const backendApiUrlInputElem = document.getElementById('backendApiUrlInput');
    if (!backendApiUrlInputElem || !backendApiUrlInputElem.value.trim()) {
        showStatus('错误：后端API链接未配置。', 'text-red-500', 3000);
        if(typeof updateTableDataEntry === "function") updateTableDataEntry(rowId, 'status', '自动查找失败');
        return;
    }
    if (!window.backendBaseUrl) {
        window.backendBaseUrl = backendApiUrlInputElem.value.trim().replace(/\/$/, "");
    }

    const rowData = window.tableData.find(r => r._id === rowId);
    if (!rowData) {
        console.error(`batchOperations/handleAutoFindPdfLink: RowData not found for ${rowId}`);
        if(typeof updateTableDataEntry === "function") updateTableDataEntry(rowId, 'status', '自动查找失败');
        return;
    }

    let finalDoi = doi;
    // 确保 findHeader 函数可用 (应从 utils.js 导入或全局)
    if (!finalDoi && typeof findHeader === "function") { // 这里的 typeof 检查可以移除，因为 findHeader 已经导入了
        const doiHeaderName = findHeader(Object.keys(rowData), COLUMN_MAPPING.doi || ['doi']);
        if (doiHeaderName && rowData[doiHeaderName]) finalDoi = String(rowData[doiHeaderName]).trim();
    }
    let finalTitle = title;
    if (!finalTitle && typeof findHeader === "function") { // 这里的 typeof 检查可以移除，因为 findHeader 已经导入了
        const titleHeaderName = findHeader(Object.keys(rowData), COLUMN_MAPPING.title || ['title']);
        if (titleHeaderName && rowData[titleHeaderName]) finalTitle = String(rowData[titleHeaderName]).trim();
    }

    if (!finalDoi && !finalTitle) {
        console.error('batchOperations/handleAutoFindPdfLink: DOI and Title both missing for RowID:', rowId);
        if(typeof updateTableDataEntry === "function") updateTableDataEntry(rowId, 'status', '自动查找失败');
        return;
    }

    if(typeof updateTableDataEntry === "function") updateTableDataEntry(rowId, 'status', '自动查找中...');

    let apiResult = null;
    // 确保 findPdfLinkApi 函数可用 (应从 api.js 导入或全局)
    if (typeof findPdfLinkApi === "function") { // 这里的 typeof 检查可以移除，因为 findPdfLinkApi 已经导入了
        apiResult = await findPdfLinkApi(finalDoi, finalTitle);
    } else {
        console.error("batchOperations/handleAutoFindPdfLink: findPdfLinkApi function not found.");
        showStatus("错误: API服务(findPdfLinkApi)未就绪。", "text-red-500", 3000);
        if(typeof updateTableDataEntry === "function") updateTableDataEntry(rowId, 'status', '自动查找失败');
        return;
    }

    if (apiResult && apiResult.pdfLink) {
        if(typeof updateTableDataEntry === "function") {
            updateTableDataEntry(rowId, 'pdfLink', apiResult.pdfLink);
            if (rowData.status !== '链接已找到 (自动)') {
                 updateTableDataEntry(rowId, 'status', '链接已找到 (自动)');
            }
        }
    } else {
        if(typeof updateTableDataEntry === "function") updateTableDataEntry(rowId, 'status', '自动查找失败');
    }
}

/**
 * 批量为当前文献列表中所有符合条件的条目自动查找PDF链接。
 */
async function autoFindAllPdfs() { // <--- 添加 export
    const backendApiUrlInputElem = document.getElementById('backendApiUrlInput');
    if (!backendApiUrlInputElem || !backendApiUrlInputElem.value.trim()) {
        alert('请输入后端API链接。');
        if(backendApiUrlInputElem) backendApiUrlInputElem.focus();
        return;
    }
    if (!window.backendBaseUrl) {
        window.backendBaseUrl = backendApiUrlInputElem.value.trim().replace(/\/$/, "");
    }

    let itemsToProcess = [];
    // 确保 findHeader 函数和 COLUMN_MAPPING 可用
    // 这里的 typeof 检查可以移除，因为 findHeader 和 COLUMN_MAPPING 已经导入了
    if (window.tableData && typeof findHeader === "function" && COLUMN_MAPPING) {
        itemsToProcess = window.tableData.filter((row) => {
            let doiValue = null;
            const doiHeaderKey = findHeader(Object.keys(row), COLUMN_MAPPING.doi || ['doi']);
            if (doiHeaderKey && row[doiHeaderKey] != null) {
                doiValue = String(row[doiHeaderKey]).trim();
                if (doiValue === "") doiValue = null;
            }
            let titleValue = null;
            const titleHeaderKey = findHeader(Object.keys(row), COLUMN_MAPPING.title || ['title']);
            if (titleHeaderKey && row[titleHeaderKey] != null) {
                titleValue = String(row[titleHeaderKey]).trim();
                if (titleValue === "") titleValue = null;
            }
            return (doiValue || titleValue) &&
                   (!row.pdfLink || row.pdfLink.trim() === '') &&
                   !['自动查找中...', '链接已找到', '链接已找到 (自动)', '下载成功'].includes(row.status);
        });
    } else {
         // 修改这里的错误信息，更精确地指出哪个依赖缺失
        let missingDeps = [];
        if (!window.tableData) missingDeps.push("window.tableData");
        if (!COLUMN_MAPPING) missingDeps.push("COLUMN_MAPPING (from config.js)");
        if (typeof findHeader !== "function") missingDeps.push("findHeader (from utils.js)");
        console.error(`batchOperations/autoFindAllPdfs: Missing dependencies: ${missingDeps.join(', ')}.`);
        showStatus(`自动查找功能初始化失败，缺少核心依赖: ${missingDeps.join(', ')}。`, 'text-red-500', 4000);
        return;

    }

    const itemsToSearchCount = itemsToProcess.length;
    if (itemsToSearchCount === 0) {
        showStatus('没有需要自动查找链接的条目。', 'text-yellow-500', 4000);
        updateBatchProgress(0, 0);
        return;
    }

    showStatus(`开始批量自动查找 ${itemsToSearchCount} 个文献的PDF链接...`, 'text-blue-500');
    updateBatchProgress(0, itemsToSearchCount);

    let completedCount = 0;
    for (const row of itemsToProcess) {
        // 确保 findHeader 和 COLUMN_MAPPING 可用
        const doiHeaderKey = findHeader(Object.keys(row), COLUMN_MAPPING.doi || ['doi']);
        let doiForApi = null;
        if (doiHeaderKey && row[doiHeaderKey] != null) doiForApi = String(row[doiHeaderKey]).trim();

        const titleHeaderKey = findHeader(Object.keys(row), COLUMN_MAPPING.title || ['title']);
        let titleForApi = null;
        if (titleHeaderKey && row[titleHeaderKey] != null) titleForApi = String(row[titleHeaderKey]).trim();

        await handleAutoFindPdfLink(doiForApi, titleForApi, row._id)
            .finally(() => {
                completedCount++;
                updateBatchProgress(completedCount, itemsToSearchCount);
            });
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    showStatus(`批量自动查找完成 ${itemsToSearchCount} 项尝试。请检查列表状态。`, 'text-green-500', 5000);
}


/**
 * 批量下载所有可用的文献PDF，通过后端打包成ZIP。
 */
async function downloadAllAvailablePdfs() { // <--- 添加 export
    const backendApiUrlInputElem = document.getElementById('backendApiUrlInput');
    if (!backendApiUrlInputElem || !backendApiUrlInputElem.value.trim()) {
        alert('请输入后端API链接。');
        if(backendApiUrlInputElem) backendApiUrlInputElem.focus();
        return;
    }
    if (!window.backendBaseUrl) {
        window.backendBaseUrl = backendApiUrlInputElem.value.trim().replace(/\/$/, "");
    }

    const articlesToProcess = [];
    // 确保 findHeader 和 COLUMN_MAPPING 可用
    // 这里的 typeof 检查可以移除，因为 findHeader 和 COLUMN_MAPPING 已经导入了
    if (window.tableData && typeof findHeader === "function" && COLUMN_MAPPING) {
        window.tableData.forEach(row => {
            if (row.pdfLink && row.pdfLink.trim() !== '' &&
                !['自动查找中...', '自动查找失败', '链接无效', '下载失败'].includes(row.status)) {
                const titleHeaderKey = findHeader(Object.keys(row), COLUMN_MAPPING.title || ['title']);
                const currentTitle = (row[titleHeaderKey] ? String(row[titleHeaderKey]).trim() : '') || 'Untitled_Document_' + row._id.slice(-5);
                const doiHeaderKey = findHeader(Object.keys(row), COLUMN_MAPPING.doi || ['doi']);
                const currentDoi = row[doiHeaderKey] ? String(row[doiHeaderKey]).trim() : null;
                articlesToProcess.push({
                    pdfLink: row.pdfLink,
                    title: currentTitle,
                    doi: currentDoi,
                    db_id: row.db_id || null
                });
            }
        });
    } else {
        console.error("batchOperations/downloadAllPdfs: tableData, findHeader, or COLUMN_MAPPING not available.");
        showStatus('批量下载功能初始化失败，缺少核心数据或配置。', 'text-red-500', 4000);
        return;
    }


    if (articlesToProcess.length === 0) {
        showStatus('没有可供批量下载的有效PDF链接。', 'text-yellow-500', 4000);
        return;
    }

    const batchZipProcessingLoaderElem = window.batchZipProcessingLoader || document.getElementById('batchZipProcessingLoader');
    if (batchZipProcessingLoaderElem) batchZipProcessingLoaderElem.classList.remove('hidden');
    showStatus(`后端正在处理 ${articlesToProcess.length} 个文献并打包ZIP，请稍候...`, 'text-blue-500');

    const downloadAllButtonElem = window.downloadAllButton || document.getElementById('downloadAllButton');
    if (downloadAllButtonElem) downloadAllButtonElem.disabled = true;

    let responseData = null;
    // 确保 batchProcessAndZipApi 函数可用 (应从 api.js 导入或全局)
    if (typeof batchProcessAndZipApi === "function") { // 这里的 typeof 检查可以移除，因为 batchProcessAndZipApi 已经导入了
        responseData = await batchProcessAndZipApi(articlesToProcess);
    } else {
        console.error("batchOperations/downloadAllPdfs: batchProcessAndZipApi function not defined.");
        showStatus("错误: API服务(batchProcessAndZipApi)未就绪。", "text-red-500", 3000);
    }

    if (batchZipProcessingLoaderElem) batchZipProcessingLoaderElem.classList.add('hidden');

    if (responseData) {
        if (responseData.status === "previously_processed") {
            const userChoice = confirm(`此文献集合之前已被处理并打包为 "${responseData.zip_download_filename}" (时间: ${responseData.original_record_timestamp || '未知'}).\n\n[确定] 重新下载这个旧的ZIP包。\n[取消] 删除旧记录并为此集合重新生成新的ZIP包?`);
            if (userChoice) {
                showStatus(`准备重新下载之前生成的ZIP包: ${responseData.zip_download_filename}`, 'text-blue-500', 3000);
                triggerZipDownload(window.backendBaseUrl, responseData.zip_download_filename);
            } else {
                const confirmDelete = confirm(`您确定要删除旧的打包记录 (任务ID: ${responseData.task_id}, 文件名: ${responseData.zip_download_filename}) 并重新处理吗？`);
                if (confirmDelete) {
                    showStatus(`正在请求删除旧的打包记录 (ID: ${responseData.task_id})...`, 'text-orange-500');
                    let deleteSuccess = false;
                    // 确保 deleteBatchRecordApi 可用 (应从 api.js 导入或全局)
                    if (typeof deleteBatchRecordApi === "function") { // 这里的 typeof 检查可以移除，因为 deleteBatchRecordApi 已经导入了
                        deleteSuccess = await deleteBatchRecordApi(responseData.task_id);
                    } else {
                        console.error("batchOperations/downloadAllPdfs: deleteBatchRecordApi function not defined.");
                    }
                    if (deleteSuccess) {
                        alert("旧记录已删除。请再次点击“批量下载为ZIP”按钮以重新生成。");
                        showStatus('旧记录已删除，请重试批量下载。', 'text-green-500', 4000);
                    } else {
                        showStatus('删除旧记录失败，请检查后端或稍后再试。', 'text-red-500', 5000);
                    }
                } else {
                    showStatus('操作已取消。', 'text-gray-500', 3000);
                }
            }
        } else if (responseData.success && responseData.zip_download_filename) {
            triggerZipDownload(window.backendBaseUrl, responseData.zip_download_filename);
            setTimeout(() => {
                let finalMsg = `新的ZIP包 "${responseData.zip_download_filename}" 已开始下载。成功处理 ${responseData.successfully_processed || 0} / ${responseData.total_requested || 0} 个文件。`;
                const failedCount = (responseData.failed_items && responseData.failed_items.length > 0) ? responseData.failed_items.length : ((responseData.total_requested || 0) - (responseData.successfully_processed || 0));

                if (failedCount > 0) {
                    finalMsg += ` <strong class="text-red-600">${failedCount} 个文件处理失败。</strong>详情请查看“查看失败/未找到”列表。`;
                    // 确保 updateTableDataEntry 和 findHeader 可用
                    if (responseData.failed_items && window.tableData && typeof updateTableDataEntry === "function" && typeof findHeader === "function" && COLUMN_MAPPING) {
                        responseData.failed_items.forEach(item => {
                            const orgRow = window.tableData.find(r => {
                                const doiH = findHeader(Object.keys(r), COLUMN_MAPPING.doi || ['doi']);
                                const titleH = findHeader(Object.keys(r), COLUMN_MAPPING.title || ['title']);
                                return (item.doi && r[doiH] === item.doi) || (!item.doi && item.title && r[titleH] === item.title);
                            });
                            if (orgRow) updateTableDataEntry(orgRow._id, 'status', '下载失败');
                        });
                    }
                    const showFailedButtonElem = window.showFailedButton || document.getElementById('showFailedButton');
                    if (showFailedButtonElem) {
                        showFailedButtonElem.classList.add('animate-pulse', 'bg-red-700', 'ring-2', 'ring-red-300');
                        setTimeout(() => showFailedButtonElem.classList.remove('animate-pulse', 'bg-red-700', 'ring-2', 'ring-red-300'), 7000);
                    }
                    showStatus(finalMsg, 'text-orange-600', 10000);
                } else {
                    finalMsg += ` 全部成功！`;
                    showStatus(finalMsg, 'text-green-500', 5000);
                }
            }, 500);
        } else {
             showStatus(responseData.error || responseData.message || '批量下载响应无效或处理失败。', 'text-red-500', 7000);
        }
    }

    if (downloadAllButtonElem) downloadAllButtonElem.disabled = false;
}

/**
 * 触发浏览器下载ZIP文件。
 * (这个函数主要被本模块内部调用，通常不需要导出)
 * @param {string} baseBackendUrl 后端API的基础URL。
 * @param {string} zipFileName 要下载的ZIP文件名。
 */
function triggerZipDownload(baseBackendUrl, zipFileName) {
    const zipDownloadUrl = `${baseBackendUrl}/api/download_zip_package/${encodeURIComponent(zipFileName)}`;
    const downloadLink = document.createElement('a');
    downloadLink.href = zipDownloadUrl;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    console.log(`batchOperations/triggerZipDownload: Triggered ZIP download for: ${zipFileName} from ${zipDownloadUrl}`);
}


console.log("batchOperations.js loaded: Batch operation functions are available.");

// 在文件末尾添加导出语句
export {
    autoFindAllPdfs,
    downloadAllAvailablePdfs
    // 如果还需要从外部调用 handleAutoFindPdfLink (通常不需要，因为 autoFindAllPdfs 会调用它)
    // handleAutoFindPdfLink
};