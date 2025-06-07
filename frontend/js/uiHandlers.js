// js/uiHandlers.js

// 确保导入所有需要的函数和配置
import { findHeader, truncateText, showStatus, escapeCsvCell } from './utils.js';
import { COLUMN_MAPPING, LOCAL_STORAGE_KEY_TABLE_DATA } from './config.js'; // 明确导入配置
import { updateTableDataEntry } from './dataManager.js';
import { loadPdfFileObjectIntoViewer, loadPdfFromUrl, showPdfPlaceholder } from './pdfViewerCore.js';
import { handleAutoFindPdfLink } from './batchOperations.js';

/**
 * 根据筛选和排序条件处理全局的 tableData，并更新 displayedTableData，然后调用 displayResults。
 */
export function applyFiltersAndSort() { // <--- 添加 export
    // 依赖全局变量: window.tableData, window.currentStatusFilter, window.currentSortColumn, window.currentSortDirection
    // 更新全局变量: window.displayedTableData
    // 调用: displayResults (本文件内的函数)
    // 调用: findHeader (应从 utils.js 导入或确保全局可用)

    if (!window.tableData) {
        console.warn("uiHandlers/applyFiltersAndSort: window.tableData is not defined.");
        window.displayedTableData = [];
    } else {
        let processedData = [...window.tableData];

        if (window.currentStatusFilter && window.currentStatusFilter !== 'all') {
            processedData = processedData.filter(row => row.status === window.currentStatusFilter);
        }

        if (window.currentSortColumn) {
            const sampleRowForHeaders = window.tableData.length > 0 ? window.tableData[0] : (processedData.length > 0 ? processedData[0] : null);
            let sortHeaderKey = null;
            if (sampleRowForHeaders) { // 移除了 typeof findHeader 检查
                sortHeaderKey = findHeader(Object.keys(sampleRowForHeaders), COLUMN_MAPPING[window.currentSortColumn] || [window.currentSortColumn]);
            }

            if (sortHeaderKey) {
                processedData.sort((a, b) => {
                    let valA = a[sortHeaderKey];
                    let valB = b[sortHeaderKey];

                    if (window.currentSortColumn === 'year') {
                        let numA = parseInt(valA, 10);
                        let numB = parseInt(valB, 10);
                        const aIsNaN = isNaN(numA);
                        const bIsNaN = isNaN(numB);
                        if (aIsNaN && bIsNaN) return 0;
                        if (aIsNaN) return window.currentSortDirection === 'asc' ? 1 : -1;
                        if (bIsNaN) return window.currentSortDirection === 'asc' ? -1 : 1;
                        return window.currentSortDirection === 'asc' ? numA - numB : numB - numA;
                    } else if (typeof valA === 'string' || typeof valB === 'string') {
                        valA = String(valA || '').toLowerCase();
                        valB = String(valB || '').toLowerCase();
                        return window.currentSortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
                    } else {
                        if (valA < valB) return window.currentSortDirection === 'asc' ? -1 : 1;
                        if (valA > valB) return window.currentSortDirection === 'asc' ? 1 : -1;
                        return 0;
                    }
                });
            }
        }
        window.displayedTableData = processedData;
    }

    let headersForDisplay = [];
    if (window.tableData && window.tableData.length > 0 && window.tableData[0]) {
        headersForDisplay = Object.keys(window.tableData[0]).filter(
            key => !['_id', 'pdfLink', 'status', 'screenshots', 'localPdfFileObject', 'db_id', 'additional_data_json', 'frontend_row_id', 'user_id', 'created_at', 'updated_at'].includes(key) && !key.startsWith('_')
        );
    }

    displayResults(window.displayedTableData, headersForDisplay); // 调用本文件内的 displayResults
}


/**
 * 在HTML表格中显示处理后的文献数据。
 * (这个函数主要由 applyFiltersAndSort 调用，通常不需要单独导出，除非有其他模块直接用它)
 * @param {Array} dataToDisplay 要在表格中显示的数据数组。
 * @param {Array} originalHeadersFromFile 解析文件时获取的原始表头数组。
 */
function displayResults(dataToDisplay, originalHeadersFromFile) {
    // 依赖全局DOM元素: window.resultsSection, window.resultsTableBody, window.noResultsMessage, window.batchActionsSection
    // 依赖全局变量: window.currentSortColumn, window.currentSortDirection, window.tableData, window.LOCAL_STORAGE_KEY_TABLE_DATA, window.fileInput
    // 依赖函数: findHeader, truncateText, updateTableDataEntry, updateActionButtonsForRow, makeTableResizable, showStatus

    const resultsSectionElem = document.getElementById('resultsSection');
    if (resultsSectionElem) resultsSectionElem.classList.remove('hidden');
    const resultsTableBodyElem = document.getElementById('resultsTableBody');
    if (resultsTableBodyElem) resultsTableBodyElem.innerHTML = '';

    const noResultsMsgElem = document.getElementById('noResultsMessage');
    if (noResultsMsgElem) noResultsMsgElem.classList.add('hidden');

    const columnMapping = COLUMN_MAPPING; // 移除了 window.

    if (!columnMapping || typeof findHeader !== "function") {
        console.error("uiHandlers/displayResults: COLUMN_MAPPING or findHeader is not available.");
        if (noResultsMsgElem) {
            noResultsMsgElem.textContent = '表格渲染配置错误。';
            noResultsMsgElem.classList.remove('hidden');
        }
        return;
    }

    const actualHeaders = {
        title: findHeader(originalHeadersFromFile, columnMapping.title || ['title']),
        authors: findHeader(originalHeadersFromFile, columnMapping.authors || ['authors']),
        year: findHeader(originalHeadersFromFile, columnMapping.year || ['year']),
        source: findHeader(originalHeadersFromFile, columnMapping.source || ['source_publication', 'source']),
        doi: findHeader(originalHeadersFromFile, columnMapping.doi || ['doi'])
    };

    const tableHeaders = document.querySelectorAll('#mainResultsTable thead th.sortable-header');
    tableHeaders.forEach(th => {
        const columnKey = th.dataset.columnKey;
        const existingArrow = th.querySelector('.sort-arrow');
        if (existingArrow) existingArrow.remove();
        if (window.currentSortColumn === columnKey) {
            const arrow = document.createElement('span');
            arrow.className = 'sort-arrow ml-1';
            arrow.innerHTML = window.currentSortDirection === 'asc' ? '▲' : '▼';
            th.appendChild(arrow);
        }
    });

    const fileInputElem = document.getElementById('fileInput'); // 直接通过 ID 获取
    const fileWasProcessed = fileInputElem && fileInputElem.files && fileInputElem.files.length > 0;
    if (!actualHeaders.doi && window.tableData && window.tableData.length > 0 && fileWasProcessed) {
        const errorMsg = '错误：文件中未找到可识别的DOI列。';
        showStatus(errorMsg, 'text-red-500 font-bold', 5000); // 移除了 typeof showStatus 检查
        if (noResultsMsgElem) {
            noResultsMsgElem.textContent = errorMsg + ' 请确保DOI列名匹配以下任一: ' + (columnMapping.doi ? columnMapping.doi.join(', ') : 'DOI');
            noResultsMsgElem.classList.remove('hidden');
        }
        const batchActionsSectionElem = document.getElementById('batchActionsSection'); // 直接通过 ID 获取
        if (batchActionsSectionElem) batchActionsSectionElem.classList.add('hidden');
        return;
    }

    if (dataToDisplay.length === 0) {
        if (noResultsMsgElem) {
            const isInitialLoadWithoutData = window.tableData.length === 0 && !fileWasProcessed && !(localStorage.getItem(LOCAL_STORAGE_KEY_TABLE_DATA)); // 移除了 window.
            noResultsMsgElem.textContent = isInitialLoadWithoutData ? '请上传文献列表文件开始。' : (window.tableData.length === 0 ? '无数据或文件为空。' : '无符合筛选条件的文献。');
            noResultsMsgElem.classList.remove('hidden');
        }
    }

    const batchActionsSectionElem = document.getElementById('batchActionsSection'); // 直接通过 ID 获取
    if (window.tableData && window.tableData.length > 0) {
        if (batchActionsSectionElem) batchActionsSectionElem.classList.remove('hidden');
    } else {
        if (batchActionsSectionElem) batchActionsSectionElem.classList.add('hidden');
    }

    dataToDisplay.forEach((rowData) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition';
        tr.dataset.id = rowData._id;
        tr.dataset.dbId = rowData.db_id || '';

        const title = String(rowData[actualHeaders.title] || rowData.title || 'N/A');
        const authors = String(rowData[actualHeaders.authors] || rowData.authors || 'N/A');
        const year = String(rowData[actualHeaders.year] || rowData.year || 'N/A');
        const sourceVal = String(rowData[actualHeaders.source] || rowData.source_publication || rowData.source || 'N/A');
        const doiValue = actualHeaders.doi && rowData[actualHeaders.doi] ? String(rowData[actualHeaders.doi]).trim() : (rowData.doi ? String(rowData.doi).trim() : null);

        const cellsInfo = [
            { content: truncateText(title, 60), classes: 'px-2 py-1 text-sm text-gray-700 ws-normal break-words' },
            { content: truncateText(authors, 40), classes: 'px-2 py-1 text-sm text-gray-700 ws-normal break-words' },
            { content: year, classes: 'px-1 py-1 text-sm text-gray-500' },
            { content: truncateText(sourceVal, 50), classes: 'px-2 py-1 text-sm text-gray-500 ws-normal break-words' },
            { content: doiValue || '无', classes: 'px-2 py-1 text-sm text-gray-500 font-mono break-all' }
        ];
        cellsInfo.forEach(cellInfo => {
            const td = document.createElement('td');
            td.className = cellInfo.classes;
            td.textContent = cellInfo.content;
            tr.appendChild(td);
        });

        const pdfLinkCell = document.createElement('td');
        pdfLinkCell.className = 'px-2 py-1 text-sm text-gray-700';
        const pdfLinkInput = document.createElement('input');
        pdfLinkInput.type = 'url';
        pdfLinkInput.className = 'pdf-link-input w-full p-1 border border-gray-300 rounded text-xs';
        pdfLinkInput.placeholder = '粘贴链接...';
        pdfLinkInput.value = rowData.pdfLink || '';
        pdfLinkInput.addEventListener('change', (e) => {
            updateTableDataEntry(rowData._id, 'pdfLink', e.target.value); // 移除了 typeof 检查
        });
        pdfLinkCell.appendChild(pdfLinkInput);
        tr.appendChild(pdfLinkCell);

        const statusCell = document.createElement('td');
        statusCell.className = 'px-2 py-1 text-sm text-gray-500';
        const statusSelect = document.createElement('select');
        statusSelect.className = 'status-select w-full p-1 border border-gray-300 rounded text-xs';
        const statusOptions = ['待处理', '已搜索', '自动查找中...', '链接已找到', '链接已找到 (自动)', '链接无效', '未找到', '自动查找失败', '下载成功', '打开/下载尝试', '打开/下载失败'];
        statusOptions.forEach(s => {
            const option = document.createElement('option');
            option.value = s; option.textContent = s;
            if (s === rowData.status) option.selected = true;
            statusSelect.appendChild(option);
        });
        statusSelect.addEventListener('change', (e) => {
            updateTableDataEntry(rowData._id, 'status', e.target.value); // 移除了 typeof 检查
        });
        statusCell.appendChild(statusSelect);
        tr.appendChild(statusCell);

        const actionCell = document.createElement('td');
        actionCell.className = 'px-2 py-1 text-sm text-gray-500 whitespace-nowrap space-y-1';
        tr.appendChild(actionCell);

        updateActionButtonsForRow(tr, doiValue, rowData.pdfLink, rowData.status); // 调用本文件内的函数

        if (resultsTableBodyElem) resultsTableBodyElem.appendChild(tr); // 移除了 window.
    });

    const mainTable = document.getElementById('mainResultsTable');
    if (mainTable) {
        makeTableResizable(mainTable); // 调用本文件内的函数
    }
}

/**
 * 处理表格列的排序请求。
 * 这个函数通常由表头的点击事件调用 (在 main_index.js 中绑定或由 displayResults 动态绑定)。
 * 如果 main_index.js 直接调用它，它需要被导出。
 */
export function handleSort(columnKey) { // <--- 添加 export
    // 依赖全局变量: window.currentSortColumn, window.currentSortDirection
    // 调用: applyFiltersAndSort (本文件内的函数)

    if (window.currentSortColumn === columnKey) {
        window.currentSortDirection = window.currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        window.currentSortColumn = columnKey;
        window.currentSortDirection = 'asc';
    }
    applyFiltersAndSort();
}

/**
 * 更新指定表格行内的操作按钮。
 * 这个函数由 displayResults 调用，通常不需要单独导出，除非其他模块也需要动态更新单行按钮。
 * 为了安全和明确，如果 main_index.js 中的事件委托需要调用，也可以导出。
 */
export function updateActionButtonsForRow(trElement, doi, pdfLink, currentStatus) { // <--- 添加 export
    // 依赖全局变量: window.tableData, window.sciHubDomainSelect, window.customSciHubUrlInput
    // 依赖函数: findHeader, truncateText (from utils.js)
    // 依赖函数: updateTableDataEntry (from dataManager.js)
    // 依赖函数: loadPdfFileObjectIntoViewer, loadPdfFromUrl, showPdfPlaceholder (from pdfViewerCore.js)
    // 依赖函数: handleAutoFindPdfLink (from batchOperations.js)

    const actionCell = trElement.querySelector('td:last-child');
    if (!actionCell) return;
    actionCell.innerHTML = '';

    const rowId = trElement.dataset.id;
    const rowData = window.tableData.find(r => r._id === rowId);
    if (!rowData) return;

    const columnMapping = COLUMN_MAPPING; // 移除了 window.
    if (!columnMapping || typeof findHeader !== "function" || typeof truncateText !== "function") {
        console.error("uiHandlers/updateActionButtonsForRow: COLUMN_MAPPING or helper functions (findHeader, truncateText) not available.");
        actionCell.innerHTML = `<span class="text-xs text-gray-400">配置错误</span>`;
        return;
    }

    const titleHeader = findHeader(Object.keys(rowData), columnMapping.title || ['title']);
    const currentTitle = rowData[titleHeader] ? String(rowData[titleHeader]).trim() : null;
    const sourceHeaderKey = findHeader(Object.keys(rowData), columnMapping.source || ['source_publication', 'source']);
    const currentJournal = rowData[sourceHeaderKey] ? String(rowData[sourceHeaderKey]).trim() : null;

    const btnClasses = 'action-button text-white text-xs py-1 px-2 rounded-md shadow block w-full text-left my-0.5';

    if (doi) {
        const btn = document.createElement('button');
        btn.innerHTML = `<i class="fas fa-search mr-1"></i> Sci-Hub`;
        btn.className = `${btnClasses} bg-blue-500 hover:bg-blue-600`;
        btn.title = "通过Sci-Hub查找文献";
        btn.onclick = () => {
            const sciHubDomainSelectElem = document.getElementById('sciHubDomainSelect'); // 直接通过 ID 获取
            const customSciHubUrlInputElem = document.getElementById('customSciHubUrlInput'); // 直接通过 ID 获取
            let url = sciHubDomainSelectElem ? sciHubDomainSelectElem.value : '';
            if (url === 'custom') url = customSciHubUrlInputElem ? customSciHubUrlInputElem.value.trim() : '';
            if (!url) { alert('请选择或输入有效的Sci-Hub链接。'); return; }
            if (!url.startsWith('http')) url = 'https://' + url;
            if (!url.endsWith('/')) url += '/';
            window.open(url + encodeURIComponent(doi), '_blank');
            updateTableDataEntry(rowId, 'status', '已搜索'); // 移除了 typeof 检查
        };
        actionCell.appendChild(btn);
    }
    if (doi || currentTitle) {
        const btnWoS = document.createElement('button');
        btnWoS.innerHTML = `<i class="fas fa-flask mr-1"></i> WoS (CN)`;
        btnWoS.className = `${btnClasses} bg-purple-500 hover:bg-purple-600`;
        btnWoS.title = "在 Web of Science (中国版) 中搜索";
        btnWoS.onclick = () => {
            let searchUrl = '';
            const baseWoSUrl = 'https://webofscience.clarivate.cn/wos/alldb';
            if (doi) {
                searchUrl = `${baseWoSUrl}/basic-search;search_mode=BasicSearch;action=search;value=${encodeURIComponent(doi)};option=DOI`;
            } else if (currentTitle && currentJournal) {
                searchUrl = `${baseWoSUrl}/advanced-search;search_mode=AdvancedSearch;action=search;query=TI%3D(${encodeURIComponent(currentTitle)})%20AND%20SO%3D(${encodeURIComponent(currentJournal)})`;
            } else if (currentTitle) {
                searchUrl = `${baseWoSUrl}/basic-search;search_mode=BasicSearch;action=search;value=${encodeURIComponent(currentTitle)};option=Title`;
            }
            if (searchUrl) window.open(searchUrl, '_blank');
            else alert('无足够信息在WoS中搜索（需要DOI或标题）。');
        };
        actionCell.appendChild(btnWoS);
    }
    if (currentTitle) {
        const btnXmol = document.createElement('button');
        btnXmol.innerHTML = `<i class="fas fa-atom mr-1"></i> X-MOL`;
        btnXmol.className = `${btnClasses} bg-orange-500 hover:bg-orange-600`;
        btnXmol.title = "在 X-MOL 中通过标题搜索";
        btnXmol.onclick = () => window.open(`https://www.x-mol.com/paper/search/q?option=${encodeURIComponent(currentTitle)}`, '_blank');
        actionCell.appendChild(btnXmol);

        const btnSd = document.createElement('button');
        btnSd.innerHTML = `<i class="fas fa-book-reader mr-1"></i> ScienceDirect`;
        btnSd.className = `${btnClasses} bg-red-500 hover:bg-red-600`;
        btnSd.title = "在 ScienceDirect 中通过标题搜索";
        btnSd.onclick = () => window.open(`https://www.sciencedirect.com/search?qs=${encodeURIComponent(currentTitle)}`, '_blank');
        actionCell.appendChild(btnSd);

        const btnArxiv = document.createElement('button'); // arXiv 按钮
        btnArxiv.innerHTML = `<i class="fas fa-archive mr-1"></i> arXiv`;
        btnArxiv.className = `${btnClasses} bg-green-700 hover:bg-green-800`;
        btnArxiv.title = "通过标题在arXiv中搜索";
        btnArxiv.onclick = () => { window.open(`https://arxiv.org/search/?searchtype=title&query=${encodeURIComponent(currentTitle)}`, '_blank'); };
        actionCell.appendChild(btnArxiv);
    }
    if (pdfLink && pdfLink.trim() !== '') {
        const openLinkBtn = document.createElement('button');
        openLinkBtn.innerHTML = `<i class="fas fa-external-link-alt mr-1"></i> 打开链接`;
        openLinkBtn.className = `${btnClasses} bg-gray-500 hover:bg-gray-600`;
        openLinkBtn.title = "在新标签页中打开此PDF链接";
        openLinkBtn.onclick = (event) => {
            event.stopPropagation();
            window.open(pdfLink, '_blank');
        };
        actionCell.appendChild(openLinkBtn);
    }

    const viewPdfBtn = document.createElement('button');
    viewPdfBtn.innerHTML = `<i class="fas fa-file-pdf mr-1"></i> 查看/处理PDF`;
    viewPdfBtn.className = `${btnClasses} bg-indigo-500 hover:bg-indigo-600`;
    viewPdfBtn.title = "打开PDF查看器处理此文献";
    viewPdfBtn.onclick = () => {
        window.currentViewingArticleRowId = rowId;
        const rowDataForViewer = window.tableData.find(r => r._id === rowId);
        let articleTitleForViewer = `PDF 查看器`;
        if (rowDataForViewer) {
            const titleH = findHeader(Object.keys(rowDataForViewer), columnMapping.title || ['title']);
            const actualTitle = rowDataForViewer[titleH] ? String(rowDataForViewer[titleH]).trim() : null;
            if (actualTitle) articleTitleForViewer = truncateText(actualTitle, 50);
        }
        const pdfViewerTitleElem = document.getElementById('pdfViewerTitle');
        if(pdfViewerTitleElem) pdfViewerTitleElem.textContent = articleTitleForViewer;

        if (window.pdfDoc && typeof window.pdfDoc.destroy === 'function') {
            window.pdfDoc.destroy().then(() => {
                window.pdfDoc = null; openPdfForViewingInternal(rowDataForViewer);
            }).catch(e => {window.pdfDoc = null; openPdfForViewingInternal(rowDataForViewer);});
        } else {
            window.pdfDoc = null; openPdfForViewingInternal(rowDataForViewer);
        }
    };
    actionCell.appendChild(viewPdfBtn);

    if (doi || currentTitle) {
        const btnAutoFind = document.createElement('button');
        btnAutoFind.innerHTML = `<i class="fas fa-robot mr-1"></i> 自动查找`;
        btnAutoFind.className = `${btnClasses} bg-teal-500 hover:bg-teal-600`;
        btnAutoFind.title = "通过后端服务自动查找PDF链接";
        btnAutoFind.disabled = currentStatus === '自动查找中...';
        btnAutoFind.onclick = () => {
            handleAutoFindPdfLink(doi, currentTitle, rowId); // 移除了 typeof 检查
        };
        actionCell.appendChild(btnAutoFind);
    }

    if (actionCell.children.length === 0) {
        actionCell.innerHTML = `<span class="text-xs text-gray-400">无可用操作</span>`;
    }
}

// 内部辅助函数，不需要导出
function openPdfForViewingInternal(articleData) {
    // 依赖全局函数: loadPdfFileObjectIntoViewer, loadPdfFromUrl (from pdfViewerCore.js or global)
    // 依赖全局函数: showStatus, truncateText (from utils.js or global)
    // 依赖全局函数: showPdfPlaceholder (from pdfViewerCore.js or global)
    const pdfViewerModalElem = document.getElementById('pdfViewerModal');

    if (articleData && articleData.localPdfFileObject instanceof File) {
        loadPdfFileObjectIntoViewer(articleData.localPdfFileObject); // 移除了 typeof 检查
        if (pdfViewerModalElem) pdfViewerModalElem.style.display = 'block';
    } else if (articleData && articleData.pdfLink) {
        const linkToLoad = articleData.pdfLink;
        const isKnownProblematicDomain = linkToLoad.includes("sci.bban.top") || linkToLoad.includes("sci-hub");

        if (isKnownProblematicDomain) {
            showStatus(`此PDF链接 (${truncateText(linkToLoad,30)}) 来自可能存在访问限制的外部域。建议您下载该PDF后使用“打开PDF”按钮从本地加载。 <a href="${linkToLoad}" target="_blank" class="text-blue-600 hover:underline">尝试直接打开链接</a>`, 'text-yellow-600', 15000); // 移除了 typeof showStatus 检查
            if (pdfViewerModalElem) pdfViewerModalElem.style.display = 'block';
            showPdfPlaceholder(`请下载PDF后，使用“打开PDF”按钮从本地加载。`); // 移除了 typeof showPdfPlaceholder 检查
            return;
        }
        showStatus('正在尝试从网络链接加载PDF (可能因CORS失败)...', 'text-blue-500'); // 移除了 typeof showStatus 检查
        loadPdfFromUrl(linkToLoad); // 移除了 typeof 检查
        if (pdfViewerModalElem) pdfViewerModalElem.style.display = 'block';
    } else {
        if (pdfViewerModalElem) pdfViewerModalElem.style.display = 'block';
        showStatus('请点击“打开PDF”按钮选择一个本地PDF文件进行查看。', 'text-blue-500', 5000); // 移除了 typeof showStatus 检查
        showPdfPlaceholder('请选择一个本地PDF文件。'); // 移除了 typeof showPdfPlaceholder 检查
    }
}


/**
 * 使HTML表格的列宽可以通过拖拽表头边缘来调整。
 */
export function makeTableResizable(tableElement) { // <--- 添加 export
    if (!tableElement) return;
    const headers = Array.from(tableElement.querySelectorAll('thead th'));
    let currentlyResizingHeader = null;
    let startX;
    let startWidth;

    headers.forEach((header) => {
        if(header.classList.contains('sortable-header') || header.dataset.columnKey) {
            let resizeHandle = header.querySelector('.resize-handle');
            if (!resizeHandle) {
                resizeHandle = document.createElement('div');
                resizeHandle.className = 'resize-handle';
                header.appendChild(resizeHandle);
                if(getComputedStyle(header).position === 'static') {
                    header.style.position = 'relative';
                }
            }
            resizeHandle.addEventListener('mousedown', (e) => {
                e.preventDefault(); e.stopPropagation();
                currentlyResizingHeader = header;
                startX = e.pageX;
                startWidth = currentlyResizingHeader.offsetWidth;
                document.documentElement.style.cursor = 'col-resize';
                header.style.cursor = 'col-resize';
                document.addEventListener('mousemove', onMouseMoveResizable);
                document.addEventListener('mouseup', onMouseUpResizable);
            });
        }
    });
    function onMouseMoveResizable(e) {
        if (!currentlyResizingHeader) return;
        e.preventDefault();
        const diffX = e.pageX - startX;
        let newWidth = startWidth + diffX;
        const minWidth = 50;
        if (newWidth < minWidth) newWidth = minWidth;
        currentlyResizingHeader.style.width = `${newWidth}px`;
    }
    function onMouseUpResizable(e) {
        if (!currentlyResizingHeader) return;
        e.preventDefault();
        document.documentElement.style.cursor = '';
        currentlyResizingHeader.style.cursor = '';
        document.removeEventListener('mousemove', onMouseMoveResizable);
        document.removeEventListener('mouseup', onMouseUpResizable);
        currentlyResizingHeader = null;
    }
}

/**
 * 显示“未找到/失败的文献列表”模态框。
 */
export function showFailedItemsModal() { // <--- 添加 export
    const failedItemsTableContainerElem = document.getElementById('failedItemsTableContainer');
    const noFailedItemsMessageModalElem = document.getElementById('noFailedItemsMessage');
    const failedListModalElem = document.getElementById('failedListModal');

    if (!failedItemsTableContainerElem || !noFailedItemsMessageModalElem || !failedListModalElem) {
        console.error("uiHandlers/showFailedItemsModal: Modal elements not found!");
        return;
    }

    failedItemsTableContainerElem.innerHTML = '';
    const failedStatuses = ['未找到', '下载失败', '链接无效', '自动查找失败'];
    const failedEntries = window.tableData.filter(row => failedStatuses.includes(row.status));
    const columnMapping = COLUMN_MAPPING; // 移除了 window.

    if (failedEntries.length > 0) {
        const table = document.createElement('table');
        table.className = "min-w-full divide-y divide-gray-300";
        const thead = document.createElement('thead');
        thead.className = "bg-gray-100";
        thead.innerHTML = `<tr>
                             <th scope="col" class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">标题</th>
                             <th scope="col" class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">DOI</th>
                             <th scope="col" class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">原因(状态)</th>
                           </tr>`;
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        tbody.className = "bg-white divide-y divide-gray-200";
        failedEntries.forEach(row => {
            const tr = document.createElement('tr');
            const titleHeaderKey = findHeader(Object.keys(row), columnMapping.title); // 移除了 typeof 检查和 window.
            const doiHeaderKey = findHeader(Object.keys(row), columnMapping.doi); // 移除了 typeof 检查和 window.
            const title = row[titleHeaderKey] || row.title || 'N/A';
            const doi = row[doiHeaderKey] || row.doi || 'N/A';
            tr.innerHTML = `<td class="px-4 py-3 text-sm text-gray-700 whitespace-normal break-words max-w-xs">${truncateText(String(title), 100)}</td>
                            <td class="px-4 py-3 text-sm text-gray-500 whitespace-nowrap font-mono">${String(doi)}</td>
                            <td class="px-4 py-3 text-sm text-red-600 whitespace-nowrap">${row.status}</td>`;
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        failedItemsTableContainerElem.appendChild(table);
        noFailedItemsMessageModalElem.classList.add('hidden');
    } else {
        noFailedItemsMessageModalElem.textContent = '目前没有失败或未找到的条目。';
        noFailedItemsMessageModalElem.classList.remove('hidden');
    }
    failedListModalElem.style.display = 'block';
}

/**
 * 导出当前显示的表格数据为CSV文件。
 * (此函数在原 script.js 中有，这里是一个适配版本)
 */
export function exportTableDataToCSV() { // <--- 添加 export
    if (!window.displayedTableData || window.displayedTableData.length === 0) {
        showStatus('没有数据可供导出。', 'text-yellow-500', 3000); // 移除了 typeof showStatus 检查
        return;
    }
    showStatus('正在准备CSV文件...', 'text-blue-500'); // 移除了 typeof showStatus 检查

    const columnMapping = COLUMN_MAPPING; // 移除了 window.
    if (!columnMapping || typeof findHeader !== "function" || typeof escapeCsvCell !== "function") {
        console.error("uiHandlers/exportTableDataToCSV: COLUMN_MAPPING or helper functions (findHeader, escapeCsvCell) not available.");
        showStatus('导出CSV失败：配置或工具函数缺失。', 'text-red-500', 4000); // 移除了 typeof showStatus 检查
        return;
    }

    // 定义要导出的列及其显示名称
    const columnsToExportConfig = [
        { keyInMapping: 'title', displayName: 'Title' },
        { keyInMapping: 'authors', displayName: 'Authors' },
        { keyInMapping: 'year', displayName: 'Year' },
        { keyInMapping: 'source', displayName: 'Source/Journal' },
        { keyInMapping: 'doi', displayName: 'DOI' },
    ];

    // 获取数据中的实际表头（以第一行为准）
    const firstRowKeys = (window.displayedTableData.length > 0 && window.displayedTableData[0]) ? Object.keys(window.displayedTableData[0]) : [];

    // 构建CSV头部
    const csvHeaderDisplayNames = columnsToExportConfig.map(colConf => escapeCsvCell(colConf.displayName));
    csvHeaderDisplayNames.push(escapeCsvCell('PDF Link')); // 添加额外的列
    csvHeaderDisplayNames.push(escapeCsvCell('Status'));   // 添加额外的列
    let csvContent = "\uFEFF"; // BOM for UTF-8
    csvContent += csvHeaderDisplayNames.join(',') + '\r\n';

    // 构建CSV数据行
    window.displayedTableData.forEach(row => {
        const rowValues = columnsToExportConfig.map(colConf => {
            const actualHeaderKey = findHeader(firstRowKeys, columnMapping[colConf.keyInMapping] || [colConf.keyInMapping]); // 移除了 window.
            return escapeCsvCell(actualHeaderKey && row[actualHeaderKey] !== undefined ? row[actualHeaderKey] : '');
        });
        rowValues.push(escapeCsvCell(row.pdfLink || '')); // 添加 pdfLink
        rowValues.push(escapeCsvCell(row.status || ''));   // 添加 status
        csvContent += rowValues.join(',') + '\r\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        link.setAttribute("href", url);
        link.setAttribute("download", `literature_export_${timestamp}.csv`);
        link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
        showStatus('CSV文件已开始下载。', 'text-green-500', 4000); // 移除了 typeof showStatus 检查
    } else {
        showStatus('您的浏览器不支持直接下载。', 'text-red-500', 4000); // 移除了 typeof showStatus 检查
    }
}

console.log("uiHandlers.js loaded: UI handling functions are available.");