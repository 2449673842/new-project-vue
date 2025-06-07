// js/fileProcessing.js
import { COLUMN_MAPPING } from './config.js';
// 直接从 config.js 导入
import { showStatus, findHeader, escapeCsvCell, sanitizeFilenameForMatching } from './utils.js'; // 假设这些函数在 utils.js 中并已导出
import {  loadTableDataFromServer, saveTableDataToLocalStorage } from './dataManager.js'; // 假设这些函数在 dataManager.js 中并已导出
import { applyFiltersAndSort } from './uiHandlers.js'; // 假设这个函数在 uiHandlers.js 中并已导出
import { saveFullLiteratureList } from './api.js'; // <--- 修改/添加这一行
console.log('[Debug] fileProcessing.js starting to execute. Imported COLUMN_MAPPING is:', typeof COLUMN_MAPPING !== 'undefined' ? COLUMN_MAPPING : 'undefined', COLUMN_MAPPING);
// 这个文件将包含文件处理相关的函数：文件选择、解析、本地PDF关联等。
// 它会依赖 main_index.js 中定义的全局变量/DOM元素（如 fileInput, disclaimerAccepted）
// 以及 dataManager.js 中的函数 (如 saveFullLiteratureList 来保存解析后的数据)
// 和 utils.js 中的函数 (如 showStatus, findHeader, escapeCsvCell)
// 以及 config.js 中的 COLUMN_MAPPING (通过 window.COLUMN_MAPPING 访问)


/**
 * 处理用户选择的文件（CSV或Excel）。
 * @param {File} file 用户选择的文件对象。
 */
function handleFile(file) {
    // 依赖全局变量: window.disclaimerAccepted
    // 依赖DOM元素: window.resultsSection, window.batchActionsSection, window.resultsTableBody, window.noResultsMessage
    // 依赖全局变量: window.tableData, window.displayedTableData (会清空它们)
    // 调用函数: showStatus (from utils.js), Papa.parse, XLSX.read, parseComplete, parseError (本文件内)

    if (!window.disclaimerAccepted) {
        alert('请先接受免责声明。');
        const disclaimerModalElem = document.getElementById('disclaimerModal');
        if (disclaimerModalElem) disclaimerModalElem.style.display = 'block';
        return;
    }

    if (typeof showStatus === "function") showStatus('正在处理文件...', 'text-blue-500');

    // 清理UI和现有数据，准备处理新文件
    if (window.resultsSection) window.resultsSection.classList.add('hidden');
    if (window.batchActionsSection) window.batchActionsSection.classList.add('hidden');
    if (window.resultsTableBody) window.resultsTableBody.innerHTML = '';
    if (window.noResultsMessage) window.noResultsMessage.classList.add('hidden');

    window.tableData = []; // 清空当前表格数据
    window.displayedTableData = []; // 清空当前显示的表格数据

    const fileName = file.name.toLowerCase();
    const reader = new FileReader();

    if (fileName.endsWith('.csv')) {
        // 确保 PapaParse 已加载
        if (typeof Papa === 'undefined') {
            if (typeof showStatus === "function") showStatus('错误: CSV解析库(PapaParse)未能加载。请检查网络连接或刷新页面。', 'text-red-500', 5000);
            console.error("fileProcessing.js/handleFile: PapaParse is not defined!");
            return;
        }
        Papa.parse(file, {
            header: true, // 将第一行作为表头，并将行数据转换为对象
            skipEmptyLines: true, // 跳过空行
            complete: (results) => {
                // results.meta.fields 包含CSV的表头数组
                parseComplete(results.data, results.meta.fields || [], [], 'CSV');
            },
            error: (error) => {
                parseError(error, 'CSV');
            }
        });
    } else if (fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
        // 确保 XLSX 已加载
        if (typeof XLSX === 'undefined') {
            if (typeof showStatus === "function") showStatus('错误: Excel解析库(XLSX)未能加载。请检查网络连接或刷新页面。', 'text-red-500', 5000);
            console.error("fileProcessing.js/handleFile: XLSX is not defined!");
            return;
        }
        reader.onload = (e) => {
            try {
                const data = e.target.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                // defval: "" 确保空单元格被解析为空字符串而不是被忽略
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
                const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];
                parseComplete(jsonData, headers, [], 'Excel');
            } catch (error) {
                parseError(error, 'Excel');
            }
        };
        reader.onerror = (error) => {
            parseError(error, 'FileReader (Excel)');
        };
        reader.readAsBinaryString(file);
    } else {
        if (typeof showStatus === "function") showStatus('不支持的文件类型。请上传CSV, XLS, 或 XLSX 文件。', 'text-red-500', 4000);
    }
}

/**
 * 文件解析成功后的回调处理函数。
 * @param {Array<object>} data 解析出的数据行对象数组。
 * @param {Array<string>} headers 文件中的原始表头数组。
 * @param {Array<object>} errors 解析过程中可能出现的错误（通常PapaParse会提供）。
 * @param {string} type 文件类型 ('CSV' 或 'Excel')。
 */
async function parseComplete(data, headers, errors, type) {
    // 依赖全局变量: window.tableData, window.currentStatusFilter, window.currentSortColumn, window.currentSortDirection
    // 依赖DOM元素: statusFilterSelect (在 main_index.js 中初始化为 window.statusFilterSelect)
    // 调用函数: showStatus (from utils.js), saveFullLiteratureList (from api.js via dataManager.js),
    //           loadTableDataFromServer (from dataManager.js), applyFiltersAndSort (from uiHandlers.js),
    //           saveTableDataToLocalStorage (from dataManager.js)

    if (errors && errors.length > 0) {
        console.error(`fileProcessing.js/${type} Parsing Errors:`, errors);
        if (typeof showStatus === "function") showStatus(`解析${type}文件时发生错误: ${errors[0].message || '未知解析错误'}.`, 'text-red-500', 5000);
        return;
    }

    if (!data || data.length === 0) {
        if (typeof showStatus === "function") showStatus(`${type}文件为空或无有效数据。`, 'text-yellow-500', 3000);
        window.tableData = []; // 确保清空
        if(typeof applyFiltersAndSort === "function") applyFiltersAndSort(); // 更新UI显示为空
        // 考虑是否也在此处尝试清空服务器列表（如果这是期望行为）
        // if (typeof saveFullLiteratureList === "function") await saveFullLiteratureList([]);
        return;
    }

    // 将解析的数据转换为内部 tableData 格式
    window.tableData = data.map((row, index) => {
        // 为确保所有截图相关字段存在，特别是 screenshots 数组
        const screenshotsArray = (row.screenshots && Array.isArray(row.screenshots)) ? row.screenshots.map(ss => ({ ...ss })) : [];
        return {
            ...row, // 保留所有从文件中解析出来的原始列数据
            _id: `row-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`, // 生成更唯一的前端行ID
            pdfLink: row.pdfLink || '',       // 确保 pdfLink 字段存在
            status: row.status || '待处理',   // 确保 status 字段存在，默认为 "待处理"
            screenshots: screenshotsArray,    // 确保 screenshots 字段是一个数组
            localPdfFileObject: null          // 本地文件对象不会从上传的文件中来
        };
    });

    // 重置前端的筛选和排序状态
    window.currentStatusFilter = 'all';
    if (window.statusFilterSelect) window.statusFilterSelect.value = 'all'; // statusFilterSelect 是 DOM 元素
    window.currentSortColumn = null;
    window.currentSortDirection = 'asc';

    if (typeof showStatus === "function") showStatus(`成功从${type}文件处理了 ${window.tableData.length} 条记录。正在尝试同步到服务器...`, 'text-blue-500');

    let syncSuccess = false;
    if (typeof saveFullLiteratureList === "function") {
        syncSuccess = await saveFullLiteratureList(window.tableData);
    } else {
        console.error("fileProcessing.js/parseComplete: saveFullLiteratureList function not defined.");
        if (typeof showStatus === "function") showStatus("错误：API服务未就绪，无法保存列表到服务器。", "text-red-500", 5000);
    }

    if (syncSuccess) {
        if (typeof showStatus === "function") showStatus('列表已上传，正在从服务器获取最新数据以包含数据库ID...', 'text-blue-500');
        let serverDataLoaded = false;
        if (typeof loadTableDataFromServer === "function") {
            serverDataLoaded = await loadTableDataFromServer(true); // forceRefresh=true
        } else {
             console.error("fileProcessing.js/parseComplete: loadTableDataFromServer function not defined.");
        }

        // ***** 关键修改：无论 loadTableDataFromServer 是否成功，都尝试刷新UI *****
        // 因为 loadTableDataFromServer 失败时会回退到本地数据，也需要刷新
        if (typeof applyFiltersAndSort === "function") {
            applyFiltersAndSort(); // 用最新的 window.tableData 刷新表格
        }
        // saveTableDataToLocalStorage 应该在 loadTableDataFromServer 内部或之后被调用，以保存从服务器获取的数据
        // 如果 loadTableDataFromServer 失败并回退到本地，本地数据应已是最新的（来自文件解析）

    } else {
        // 如果同步到服务器失败，仍然显示从文件解析的数据，并保存到本地存储
        if (typeof showStatus === "function") showStatus(`同步到服务器失败。列表数据已保存在本地浏览器中。`, 'text-yellow-600', 6000);
        if(typeof applyFiltersAndSort === "function") applyFiltersAndSort();
        if(typeof saveTableDataToLocalStorage === "function") saveTableDataToLocalStorage();
    }
}

/**
 * 文件解析失败时的回调处理函数。
 * @param {Error} error 解析错误对象。
 * @param {string} type 文件类型 ('CSV' 或 'Excel' 或 'FileReader (Excel)')。
 */
function parseError(error, type) {
    // 调用 utils.js 中的 showStatus
    console.error(`fileProcessing.js/${type} Error:`, error);
    if (typeof showStatus === "function") showStatus(`读取${type}文件失败: ${error.message || '未知错误，请检查文件格式和内容。'}.`, 'text-red-500', 7000);
}

/**
 * 下载文献列表上传模板 (CSV格式)。
 */
function downloadUploadTemplate() {
    // 修改这条日志，确认导入的 COLUMN_MAPPING 是否可用
    console.log('[Debug] Inside downloadUploadTemplate. About to use imported COLUMN_MAPPING. Value is:', typeof COLUMN_MAPPING !== 'undefined' ? COLUMN_MAPPING : 'undefined');

    if (!COLUMN_MAPPING) { // <--- 直接使用导入的 COLUMN_MAPPING
        console.error("fileProcessing.js/downloadUploadTemplate: Imported COLUMN_MAPPING is not defined.");
        if(typeof showStatus === "function") showStatus("无法下载模板：配置信息缺失。", "text-red-500", 3000);
        return;
    }
    // 使用导入的 COLUMN_MAPPING
    const templateHeaders = [
        COLUMN_MAPPING.doi[0],         // <--- 直接使用
        COLUMN_MAPPING.title[0],       // <--- 直接使用
        COLUMN_MAPPING.authors[0],     // <--- 直接使用
        COLUMN_MAPPING.year[0],        // <--- 直接使用
        COLUMN_MAPPING.source[0]       // <--- 直接使用
    ];

    // 确保 escapeCsvCell 是从 utils.js 导入的
    const headerRowString = templateHeaders.map(header => escapeCsvCell(header)).join(',');
    let csvContent = "\uFEFF";
    csvContent += headerRowString + "\r\n";

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");

    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "文献上传模板.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        if(typeof showStatus === "function") showStatus('上传模板文件已开始下载。', 'text-green-500', 3000);
    } else {
        alert('您的浏览器不支持直接下载。请手动复制以下表头并创建CSV文件：\n\n' + headerRowString);
        if(typeof showStatus === "function") showStatus('无法直接下载模板，请手动复制表头。', 'text-yellow-500', 5000);
    }
}

/**
 * 处理用户选择本地PDF文件夹后的逻辑，尝试将文件夹中的PDF与当前文献列表匹配。
 * @param {FileList} files 用户通过文件夹选择器选择的文件列表。
 */
async function handleLocalPdfFolderSelection(files) {
    if (!files || files.length === 0) {
        showStatus("您没有选择文件夹，或者文件夹为空。", "text-yellow-500", 3000);
        return;
    }

    showStatus(`正在处理选择的文件夹中的 ${files.length} 个文件，请稍候...`, "text-blue-500");
    await new Promise(resolve => setTimeout(resolve, 100));

    let matchedCount = 0;
    let unmatchedFileNames = [];
    const localFileMap = new Map();
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.toLowerCase().endsWith('.pdf')) {
            localFileMap.set(file.name, file);
        }
    }

    if (!window.tableData || window.tableData.length === 0) {
        showStatus("文献列表为空，无法关联本地PDF。", "text-yellow-500", 4000);
        return;
    }

    // 确保 COLUMN_MAPPING, findHeader, sanitizeFilenameForMatching 可用
    if (!COLUMN_MAPPING || typeof findHeader !== 'function' || typeof sanitizeFilenameForMatching !== 'function') {
        console.error("fileProcessing.js/handleLocalPdfFolderSelection: Missing COLUMN_MAPPING or helper functions.");
        showStatus("关联本地PDF失败：核心配置或函数缺失。", "text-red-500", 4000);
        return;
    }

    window.tableData.forEach(rowData => {
        const titleHeaderKey = findHeader(Object.keys(rowData), (COLUMN_MAPPING && COLUMN_MAPPING.title) || ['title']); // 使用导入的 COLUMN_MAPPING
        const articleTitle = rowData[titleHeaderKey] ? String(rowData[titleHeaderKey]).trim() : null;

        if (articleTitle) {
            const expectedFilenameBase = sanitizeFilenameForMatching(articleTitle); // 使用导入的 sanitizeFilenameForMatching
            const expectedFilename = expectedFilenameBase + ".pdf";
            if (localFileMap.has(expectedFilename)) {
                rowData.localPdfFileObject = localFileMap.get(expectedFilename);
                matchedCount++;
                localFileMap.delete(expectedFilename);
            }
        }
    });

    unmatchedFileNames = Array.from(localFileMap.keys());

    if (matchedCount > 0) {
        applyFiltersAndSort(); // 使用导入的 applyFiltersAndSort
        saveTableDataToLocalStorage(); // 使用导入的 saveTableDataToLocalStorage
    }

    let finalMessage = `成功自动关联了 ${matchedCount} 个本地PDF文件。`;
    if (unmatchedFileNames.length > 0) {
        finalMessage += ` 文件夹中还有 ${unmatchedFileNames.length} 个PDF文件未能自动匹配。`;
    }
    if (matchedCount === 0 && files.length > 0) {
         finalMessage = `您选择的文件夹中没有找到与当前列表文献标题匹配的PDF文件。请确保PDF文件名与文献标题（经净化处理后）一致。`;
    }
    showStatus(finalMessage, matchedCount > 0 ? "text-green-500" : "text-yellow-500", 8000);
}
export {
    downloadUploadTemplate,
    handleLocalPdfFolderSelection,
    parseError,
    handleFile

};


console.log("fileProcessing.js loaded: File processing functions are available.");