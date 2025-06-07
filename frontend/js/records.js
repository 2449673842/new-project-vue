/**
 * @file 文献记录业务逻辑
 * @description 处理文献记录相关的业务逻辑，包括数据获取、处理等
 */

// 从 api.js 导入需要的具体函数
import {
    fetchLiteratureList,
    findPdfLinkApi,
    batchProcessAndZipApi, // 假设这个用于下载多个PDF的ZIP包
    // deleteRecordsApi,      // 假设您会在 api.js 中创建并导出此函数
    // processRecordsApi,     // 假设您会在 api.js 中创建并导出此函数
    // exportRecordsApi,      // 假设您会在 api.js 中创建并导出此函数
    // fetchStatisticsApi,    // 假设您会在 api.js 中创建并导出此函数
    // downloadRecordScreenshotsZipApi // 假设您会在 api.js 中创建并导出此函数 (用于单个文献的截图ZIP)
} from './api.js';

import { showLoading, hideLoading, showMessage } from './ui.js';

/**
 * 获取并处理文献记录
 * @param {number} page 页码
 * @param {string} filter 筛选条件
 * @param {string} search 搜索关键字
 * @returns {Promise<Object|null>}
 */
export async function fetchAndProcessRecords(page = 1, filter = 'all', search = '') {
    try {
        showLoading('正在获取文献记录...');
        // 直接调用导入的函数
        // 确保 fetchLiteratureList 的参数与此处的调用匹配，或者根据需要调整
        const data = await fetchLiteratureList(page, filter, search);
        return data;
    } catch (error) {
        showMessage('获取记录失败: ' + error.message, 'error');
        // throw error; // 可以选择抛出错误让调用者处理，或者返回null/特定错误对象
        return null;
    } finally {
        hideLoading();
    }
}

/**
 * 批量下载选定文献的PDF文件 (通过后端打包成ZIP)
 * @param {Array<Object>} articlesToZip 需要包含pdfLink等信息的文献对象数组
 */
export async function downloadSelectedPDFsAsZip(articlesToZip) {
    if (!articlesToZip || articlesToZip.length === 0) {
        showMessage('没有选择任何文献进行下载。', 'warning');
        return;
    }
    try {
        showLoading('正在准备批量下载PDF...');
        const responseData = await batchProcessAndZipApi(articlesToZip); // articlesToZip 应符合 batchProcessAndZipApi 的参数要求

        if (responseData && responseData.success && responseData.zip_download_filename) {
            // 假设您有一个全局的 backendBaseUrl 或能从某处获取
            const backendBaseUrl = window.backendBaseUrl || document.getElementById('backendApiUrlInput')?.value.trim().replace(/\/$/, "");
            if (!backendBaseUrl) {
                throw new Error("后端API基础URL未配置。");
            }
            const zipDownloadUrl = `${backendBaseUrl}/api/download_zip_package/${encodeURIComponent(responseData.zip_download_filename)}`;
            const downloadLink = document.createElement('a');
            downloadLink.href = zipDownloadUrl;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            showMessage('文献PDF打包下载已开始！', 'success');
        } else {
            throw new Error(responseData?.message || '无法获取ZIP文件进行下载。');
        }
    } catch (error) {
        showMessage('批量下载PDF失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}


/**
 * 批量处理记录 (具体处理逻辑依赖后端API)
 * @param {Array} ids 记录ID数组
 */
export async function processRecords(ids) {
    if (!ids || ids.length === 0) return true; // 没有要处理的，也算成功
    try {
        showLoading('正在批量处理记录...');
        // 假设您在 api.js 中有一个名为 processRecordsApi 的导出函数
        // await processRecordsApi(ids);
        console.warn("processRecords: 'processRecordsApi' not yet implemented or imported from api.js.");
        showMessage('批量处理功能 (占位符) 完成。', 'info'); // 占位符消息
        return true;
    } catch (error) {
        showMessage('批量处理记录失败: ' + error.message, 'error');
        return false;
    } finally {
        hideLoading();
    }
}

/**
 * 导出记录为CSV
 * @param {Array} ids 记录ID数组 (或者您可能想导出所有当前显示的记录)
 */
export async function exportToCSV(ids) {
    if (!ids || ids.length === 0) {
        showMessage('没有选择记录以供导出。', 'warning');
        return;
    }
    try {
        showLoading('正在导出CSV...');
        // 假设您在 api.js 中有一个名为 exportRecordsApi 的导出函数，它返回CSV的blob
        // const blob = await exportRecordsApi(ids);
        console.warn("exportToCSV: 'exportRecordsApi' not yet implemented or imported from api.js.");
        // 模拟一个blob下载
        const exampleCSV = "id,title\n1,Example Title\n";
        const blob = new Blob([exampleCSV], {type: 'text/csv;charset=utf-8;'});

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'literature_records.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showMessage('CSV导出成功 (占位逻辑)', 'success');
    } catch (error) {
        showMessage('导出CSV失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

/**
 * 删除记录
 * @param {Array} ids 记录ID数组
 */
export async function deleteSelectedRecords(ids) { // 重命名以更清晰表明是删除选中的
    if (!ids || ids.length === 0) return true;
    try {
        showLoading('正在删除记录...');
        // 假设您在 api.js 中有一个名为 deleteRecordsApi 的导出函数
        // await deleteRecordsApi(ids);
        console.warn("deleteSelectedRecords: 'deleteRecordsApi' not yet implemented or imported from api.js.");
        showMessage('记录删除成功 (占位逻辑)', 'success');
        return true;
    } catch (error) {
        showMessage('删除记录失败: ' + error.message, 'error');
        return false;
    } finally {
        hideLoading();
    }
}

/**
 * 自动查找单条文献链接
 * @param {string|number} recordId 记录ID (或传递DOI/Title给 findPdfLinkApi)
 * @param {string|null} doi
 * @param {string|null} title
 * @returns {Promise<object|null>} 后端返回的结果，包含pdfLink等
 */
export async function findSingleLink(recordId, doi, title) {
    try {
        showLoading('正在查找链接...');
        // findPdfLinkApi 是从 api.js 导入的
        const result = await findPdfLinkApi(doi, title);
        if (result && result.pdfLink) {
            showMessage(`已找到链接: ${result.pdfLink}`, 'success');
            // 这里您可能还需要更新前端 tableData 中对应 recordId 的 pdfLink 和 status
            // 例如: updateTableDataEntry(recordId, 'pdfLink', result.pdfLink);
            //       updateTableDataEntry(recordId, 'status', '链接已找到 (自动)');
        } else {
            showMessage(result?.message || '未找到链接。', 'info');
        }
        return result; // 返回API的完整结果
    } catch (error) {
        showMessage('链接查找失败: ' + error.message, 'error');
        return null;
    } finally {
        hideLoading();
    }
}

/**
 * 获取统计信息
 * @returns {Promise<Object|null>}
 */
export async function getStatistics() {
    try {
        showLoading('正在获取统计信息...');
        // 假设您在 api.js 中有一个名为 fetchStatisticsApi 的导出函数
        // const stats = await fetchStatisticsApi();
        console.warn("getStatistics: 'fetchStatisticsApi' not yet implemented or imported from api.js.");
        const stats = { total: 0, downloaded: 0, pending: 0 }; // 占位数据
        showMessage('获取统计信息成功 (占位逻辑)', 'success', 1500);
        return stats;
    } catch (error) {
        showMessage('获取统计信息失败: ' + error.message, 'error');
        // throw error;
        return null;
    } finally {
        hideLoading();
    }
}

/**
 * PDF相关操作的便捷方式 (主要用于UI调用，具体实现可能在其他模块)
 */
export const PDFOperations = {
    /**
     * 查看PDF (通常是打开一个已有的链接或本地文件对象)
     * @param {string} recordId 用于查找文献记录的ID
     * @param {string} pdfLink 直接的PDF链接 (可选)
     * @param {File} localPdfFileObject 本地PDF文件对象 (可选)
     */
    viewPDF: (recordId, pdfLink, localPdfFileObject) => {
        // 这个函数不直接调用API来“查看”，而是处理已有的资源
        // 实际的PDF加载和渲染由 pdfViewerCore.js 处理
        // main_index.js 中的 "查看/处理PDF" 按钮的点击事件应该调用 pdfViewerCore.js 的功能，
        // 并传递 recordId, pdfLink, 或 localPdfFileObject
        if (localPdfFileObject && typeof window.loadPdfFileObjectIntoViewer === 'function') {
            window.currentViewingArticleRowId = recordId; // 确保设置当前查看的文献
            window.loadPdfFileObjectIntoViewer(localPdfFileObject); // 假设此函数在全局 (由pdfViewerCore.js提供)
        } else if (pdfLink && typeof window.loadPdfFromUrl === 'function') {
            window.currentViewingArticleRowId = recordId;
            window.loadPdfFromUrl(pdfLink); // 假设此函数在全局 (由pdfViewerCore.js提供)
        } else if (recordId && typeof window.openPdfViewerForRecord === 'function') {
            // 假设有一个函数，它会根据 recordId 查找tableData中的信息，然后决定如何加载PDF
            window.openPdfViewerForRecord(recordId);
        }
        else {
            showMessage('无法查看PDF：未提供有效的PDF链接或文件对象，或相关查看函数未定义。', 'warning');
        }
        // 确保PDF查看器模态框被打开，这通常是 window.openPdfViewerForRecord 或类似函数的一部分
        const pdfModal = document.getElementById('pdfViewerModal');
        if (pdfModal) pdfModal.style.display = 'block'; else console.error("PDF Viewer Modal not found");
    },

    /**
     * 触发截图模式或调用截图功能 (核心实现在 screenshotManager.js)
     * @param {string} recordId
     */
    takeScreenshot: (recordId) => {
        // 实际的截图捕获和保存由 screenshotManager.js 中的 handleCaptureScreenshot 函数处理，
        // 该函数通常由PDF查看器内的“截取选中”按钮触发。
        // 如果希望从这里直接触发某种截图操作（例如，如果后端支持对已存PDF截图），
        // 那将需要一个专门的API调用。
        // 目前，这个函数更像是一个命令，提示用户使用PDF查看器内的截图工具。
        if (window.currentViewingArticleRowId === recordId && window.pdfDoc) {
            showMessage('请在PDF查看器中框选区域后，点击“截取选中”按钮。', 'info');
        } else {
            showMessage('请先在PDF查看器中打开对应文献的PDF以进行截图。', 'info');
        }
    },

    /**
     * 下载与指定文献记录关联的所有截图的ZIP包
     * @param {string} recordId 文献记录的ID
     */
    downloadScreenshots: async (recordId) => {
        if (!recordId) {
            showMessage('需要提供文献记录ID才能下载截图。', 'warning');
            return;
        }
        try {
            showLoading('正在打包截图...');
            // 假设您在 api.js 中创建并导出了 downloadRecordScreenshotsZipApi(recordId) 函数
            // const blob = await downloadRecordScreenshotsZipApi(recordId);
            console.warn("PDFOperations.downloadScreenshots: 'downloadRecordScreenshotsZipApi' not yet implemented or imported from api.js.");
            // 模拟Blob下载
            const exampleContent = "This is a fake zip for screenshots of " + recordId;
            const blob = new Blob([exampleContent], {type: 'application/zip'});

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `screenshots_${recordId}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showMessage('截图打包下载已开始 (占位逻辑)', 'success');
        } catch (error) {
            showMessage('截图打包下载失败: ' + error.message, 'error');
        } finally {
            hideLoading();
        }
    }
};

// 如果UI代码中（比如表格渲染的按钮）仍然通过 window.PDFOperations.takeScreenshot 调用，
// 那么需要将 PDFOperations 挂载到 window。
// 更好的做法是，在绑定事件时直接传递这个导出的 PDFOperations 对象或其方法。
// window.PDFOperations = PDFOperations; // 暂时保留，以兼容可能的旧HTML内联调用

console.log("records.js loaded: Record business logic functions are available.");