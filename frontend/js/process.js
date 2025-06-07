/**
 * @file 文件处理模块
 * @description 处理文件上传、批量处理等功能
 */

// 兜底：保证 showMessage 全局可用
if (typeof window.showMessage !== 'function') {
    window.showMessage = function(msg, type = 'info', duration = 3000) {
        alert(msg);
    };
}

/**
 * 初始化文件处理功能
 */
function initProcessHandlers() {
    // 处理文件按钮
    const processFileButton = document.getElementById('processFileButton');
    if (processFileButton) {
        processFileButton.addEventListener('click', handleProcessFile);
        processFileButton.style.pointerEvents = 'auto';
        processFileButton.style.position = 'relative';
        processFileButton.style.zIndex = '10';
        processFileButton.style.cursor = 'pointer';
    }
    
    // 批量处理按钮
    const batchProcessBtn = document.getElementById('batch-process-btn');
    if (batchProcessBtn) {
        batchProcessBtn.addEventListener('click', handleBatchProcess);
        batchProcessBtn.style.pointerEvents = 'auto';
    }
    
    // 批量下载按钮
    const batchDownloadBtn = document.getElementById('batch-download-btn');
    if (batchDownloadBtn) {
        batchDownloadBtn.addEventListener('click', handleBatchDownload);
        batchDownloadBtn.style.pointerEvents = 'auto';
    }
    
    // 导出CSV按钮
    const exportCsvBtn = document.getElementById('export-csv-btn');
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', handleExportCsv);
        exportCsvBtn.style.pointerEvents = 'auto';
    }
    
    // 自动查找链接按钮
    const autoFindLinkBtn = document.getElementById('auto-find-link-btn');
    if (autoFindLinkBtn) {
        autoFindLinkBtn.addEventListener('click', handleAutoFindLink);
        autoFindLinkBtn.style.pointerEvents = 'auto';
    }
    
    // 文件上传按钮
    const uploadFileBtn = document.getElementById('upload-file-btn');
    if (uploadFileBtn) {
        uploadFileBtn.addEventListener('click', () => {
            document.getElementById('file-upload-input')?.click();
        });
        uploadFileBtn.style.pointerEvents = 'auto';
    }
    
    // 文件上传输入框
    const fileUploadInput = document.getElementById('file-upload-input');
    if (fileUploadInput) {
        fileUploadInput.addEventListener('change', handleFileUpload);
        fileUploadInput.style.pointerEvents = 'auto';
    }

    // app_dashboard.html中的按钮
    const downloadAllButton = document.getElementById('downloadAllButton');
    if (downloadAllButton) {
        downloadAllButton.addEventListener('click', handleBatchDownload);
        downloadAllButton.style.pointerEvents = 'auto';
    }

    const exportCsvButton = document.getElementById('exportCsvButton');
    if (exportCsvButton) {
        exportCsvButton.addEventListener('click', handleExportCsv);
        exportCsvButton.style.pointerEvents = 'auto';
    }

    const autoFindAllButton = document.getElementById('autoFindAllButton');
    if (autoFindAllButton) {
        autoFindAllButton.addEventListener('click', handleAutoFindLink);
        autoFindAllButton.style.pointerEvents = 'auto';
    }
    
    // 下载模板按钮
    const downloadTemplateButton = document.getElementById('downloadTemplateButton');
    if (downloadTemplateButton) {
        downloadTemplateButton.addEventListener('click', handleDownloadTemplate);
        downloadTemplateButton.style.pointerEvents = 'auto';
    }
    
    // 关联本地PDF按钮
    const linkLocalPdfsButton = document.getElementById('linkLocalPdfsButton');
    if (linkLocalPdfsButton) {
        linkLocalPdfsButton.addEventListener('click', handleLinkLocalPdfs);
        linkLocalPdfsButton.style.pointerEvents = 'auto';
    }
    
    // 查看失败按钮
    const showFailedButton = document.getElementById('showFailedButton');
    if (showFailedButton) {
        showFailedButton.addEventListener('click', handleShowFailed);
        showFailedButton.style.pointerEvents = 'auto';
    }
    
    // 确保文件输入框可点击
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.style.pointerEvents = 'auto';
        fileInput.style.position = 'relative';
        fileInput.style.zIndex = '5';
    }
}

/**
 * 处理文件处理按钮点击
 */
async function handleProcessFile() {
    const fileInput = document.getElementById('fileInput');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showMessage('请先选择文件', 'warning');
        return;
    }

    try {
        showLoading('正在处理文件...');
        
        document.getElementById('batchActionsSection')?.classList.remove('hidden');
        document.getElementById('resultsSection')?.classList.remove('hidden');
        
        const file = fileInput.files[0];
        console.log('处理文件:', file.name);
        
        // 调用文件处理函数
        if (typeof handleFile === 'function') {
            await handleFile(file);
        } else {
            throw new Error('文件处理函数未定义');
        }
        
        showMessage('文件处理完成', 'success');
    } catch (error) {
        showMessage('处理失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

/**
 * 处理批量处理按钮点击
 */
async function handleBatchProcess() {
    const selectedIds = getSelectedRecordIds();
    if (selectedIds.length === 0) {
        showMessage('请选择要处理的记录', 'warning');
        return;
    }
    
    const confirmed = await confirm(`确定要处理选中的 ${selectedIds.length} 条记录吗？`);
    if (!confirmed) return;
    
    try {
        showLoading('正在处理文件...');
        const result = await RecordsAPI.batchProcess(selectedIds);
        showMessage('处理完成', 'success');
        
        // 刷新记录列表
        if (typeof loadTableDataFromServer === 'function') {
            await loadTableDataFromServer(true);
        }
    } catch (error) {
        showMessage('处理失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

/**
 * 处理批量下载按钮点击
 */
async function handleBatchDownload() {
    const selectedIds = getSelectedRecordIds();
    if (selectedIds.length === 0) {
        showMessage('请选择要下载的记录', 'warning');
        return;
    }
    
    try {
        showLoading('正在准备下载...');
        const blob = await RecordsAPI.batchDownload(selectedIds);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `literature_pdfs_${new Date().toISOString().slice(0, 10)}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showMessage('下载已开始', 'success');
    } catch (error) {
        showMessage('下载失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

/**
 * 处理导出CSV按钮点击
 */
async function handleExportCsv() {
    const selectedIds = getSelectedRecordIds();
    if (selectedIds.length === 0) {
        showMessage('请选择要导出的记录', 'warning');
        return;
    }
    
    try {
        showLoading('正在导出...');
        const blob = await RecordsAPI.exportRecords(selectedIds);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `literature_records_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showMessage('导出成功', 'success');
    } catch (error) {
        showMessage('导出失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

/**
 * 处理自动查找链接按钮点击
 */
async function handleAutoFindLink() {
    const selectedIds = getSelectedRecordIds();
    if (selectedIds.length === 0) {
        showMessage('请选择要查找链接的记录', 'warning');
        return;
    }
    
    try {
        showLoading('正在查找链接...');
        
        const progressContainer = document.getElementById('batchProgressContainer');
        const progressBar = document.getElementById('batchProgressBar');
        const progressText = document.getElementById('batchProgressText');
        
        if (progressContainer) progressContainer.classList.remove('hidden');
        
        let progress = 0;
        const interval = setInterval(() => {
            progress += 5;
            if (progressBar) progressBar.style.width = `${Math.min(progress, 100)}%`;
            if (progressText) progressText.textContent = `处理中 ${Math.min(progress, 100)}%`;
            
            if (progress >= 100) {
                clearInterval(interval);
                setTimeout(() => {
                    if (progressContainer) progressContainer.classList.add('hidden');
                }, 1000);
            }
        }, 200);
        
        // 调用后端API进行自动查找
        await RecordsAPI.autoFindLinks(selectedIds);
        
        // 刷新数据
        if (typeof loadTableDataFromServer === 'function') {
            await loadTableDataFromServer(true);
        }
        
        showMessage('链接查找完成', 'success');
    } catch (error) {
        showMessage('查找失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

/**
 * 处理文件上传
 */
async function handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    
    try {
        showLoading('正在上传文件...');
        
        // 调用文件处理函数
        if (typeof handleFile === 'function') {
            await handleFile(file);
        } else {
            throw new Error('文件处理函数未定义');
        }
        
        showMessage('文件上传成功', 'success');
    } catch (error) {
        showMessage('上传失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

/**
 * 处理下载模板按钮点击
 */
function handleDownloadTemplate() {
    try {
        if (typeof downloadUploadTemplate === 'function') {
            downloadUploadTemplate();
        } else {
            throw new Error('模板下载函数未定义');
        }
    } catch (error) {
        showMessage('模板下载失败: ' + error.message, 'error');
    }
}

/**
 * 处理关联本地PDF按钮点击
 */
function handleLinkLocalPdfs() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = '.pdf';
    
    showMessage('请选择本地PDF文件', 'info');
    
    fileInput.addEventListener('change', async (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) {
            showMessage('未选择任何文件', 'warning');
            return;
        }
        
        showMessage(`已选择 ${files.length} 个PDF文件，正在关联...`, 'info');
        
        try {
            if (typeof handleLocalPdfFolderSelection === 'function') {
                await handleLocalPdfFolderSelection(files);
            } else {
                throw new Error('PDF关联函数未定义');
            }
        } catch (error) {
            showMessage('PDF关联失败: ' + error.message, 'error');
        }
    });
    
    fileInput.click();
}

/**
 * 处理查看失败按钮点击
 */
function handleShowFailed() {
    const statusFilterSelect = document.getElementById('statusFilterSelect');
    if (statusFilterSelect) {
        statusFilterSelect.value = '打开/下载失败';
        const event = new Event('change');
        statusFilterSelect.dispatchEvent(event);
        showMessage('已筛选出失败的记录', 'info');
    } else {
        showMessage('筛选功能不可用', 'error');
    }
}

/**
 * 获取选中的记录ID
 */
function getSelectedRecordIds() {
    const checkboxes = document.querySelectorAll('input[name="record-checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

/**
 * 切换全选/取消全选
 */
function toggleSelectAll(checked) {
    const checkboxes = document.querySelectorAll('input[name="record-checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = checked;
    });
}

/**
 * 初始化全选处理器
 */
function initSelectAllHandler() {
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            toggleSelectAll(e.target.checked);
        });
    }
}

console.log("process.js loaded: 处理功能已就绪。"); 