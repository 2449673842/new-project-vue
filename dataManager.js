// js/dataManager.js
import {
    fetchLiteratureList,
    fetchAllMyScreenshotsApi,
    updateSingleLiteratureArticle
} from './api.js';
import { showStatus, findHeader, truncateText } from './utils.js';
import { applyFiltersAndSort } from './uiHandlers.js';
import { LOCAL_STORAGE_KEY_TABLE_DATA, COLUMN_MAPPING } from './config.js';

/**
 * 将当前的 window.tableData（包含截图信息）保存到 localStorage。
 * 确保所有存储的数据都是可序列化的。
 */
export function saveTableDataToLocalStorage() {
    const localStorageKey = LOCAL_STORAGE_KEY_TABLE_DATA;
    if (!window.tableData || !localStorageKey) {
        console.warn('[DataManager/LocalStorage] tableData or LOCAL_STORAGE_KEY_TABLE_DATA not available for saving.');
        return;
    }

    try {
        // 确保所有嵌套对象（如截图对象）都是简单对象，移除 File 等不可序列化对象
        const serializableTableData = window.tableData.map(row => {
            const { localPdfFileObject, ...restOfRow } = row; // 移除 File 对象
            const serializedScreenshots = (restOfRow.screenshots && Array.isArray(restOfRow.screenshots))
                ? restOfRow.screenshots.map(ss => ({ ...ss })) // 确保截图对象也是可序列化的
                : [];
            return { ...restOfRow, screenshots: serializedScreenshots };
        });

        const dataToSave = JSON.stringify(serializableTableData);
        localStorage.setItem(localStorageKey, dataToSave);
        console.log(`[DataManager/LocalStorage] Saved tableData (including screenshots). Items: ${serializableTableData.length}`);
    } catch (error) {
        console.error('[DataManager/LocalStorage] Error saving tableData:', error);
        if (typeof showStatus === "function") {
            showStatus('保存文献列表到本地存储失败！错误详情请查看控制台。', 'text-red-500', 5000);
        }
    }
}

/**
 * 从 localStorage 加载 tableData（包含截图信息）。
 * @returns {boolean} 如果成功从 localStorage 加载了数据则返回 true，否则返回 false。
 */
export function loadTableDataFromLocalStorage() {
    const localStorageKey = LOCAL_STORAGE_KEY_TABLE_DATA;
    if (!localStorageKey) {
        console.warn("[DataManager/LocalStorage] LOCAL_STORAGE_KEY_TABLE_DATA not available.");
        window.tableData = [];
        return false;
    }

    try {
        const savedData = localStorage.getItem(localStorageKey);
        if (savedData) {
            const parsedData = JSON.parse(savedData);
            if (Array.isArray(parsedData)) {
                window.tableData = parsedData.map(row => ({
                    ...row,
                    localPdfFileObject: null, // File 对象不能从 JSON 恢复，始终设为 null
                    // 截图数据应该已经是可序列化的格式
                    screenshots: (row.screenshots && Array.isArray(row.screenshots))
                                 ? row.screenshots.map(ss => ({ ...ss }))
                                 : []
                }));
                console.log(`[DataManager/LocalStorage] Loaded tableData from localStorage (with screenshots). Total items: ${window.tableData.length}`);
                if (window.statusMessage && window.tableData.length > 0 && typeof showStatus === "function") {
                    showStatus(`已从本地缓存恢复列表 (${window.tableData.length} 条文献，含截图信息)。本地PDF需通过“关联”功能重新指定。`, 'text-green-500', 5000);
                }
                return true;
            } else {
                console.warn("[DataManager/LocalStorage] Parsed data from localStorage is not an array. Clearing invalid data.");
                localStorage.removeItem(localStorageKey); // 清除无效数据
            }
        } else {
            console.log("[DataManager/LocalStorage] No data found in localStorage for key:", localStorageKey);
        }
    } catch (error) {
        console.error('[DataManager/LocalStorage] Error loading or parsing tableData from localStorage:', error);
        if (typeof showStatus === "function") {
            showStatus('加载本地列表失败！数据可能已损坏或格式不兼容。将尝试从服务器重新加载。', 'text-red-500', 5000);
        }
        localStorage.removeItem(localStorageKey); // 清除损坏数据
    }

    window.tableData = []; // 初始化为空数组
    console.log("[DataManager/LocalStorage] tableData initialized as empty array due to load failure or no data.");
    return false;
}

/**
 * 从服务器加载文献列表，并为每篇文献加载其关联的截图元数据。
 * 更新全局的 window.tableData。
 * @param {boolean} forceRefresh - 是否强制从服务器刷新（目前此参数未直接改变行为，因为总是先尝试服务器）。
 * @returns {Promise<boolean>} 数据是否成功从服务器加载并处理。
 */
export async function loadTableDataFromServer(forceRefresh = false) {
    console.log(`[DataManager/ServerLoad] Attempting to load literature list and screenshots from server. Force refresh: ${forceRefresh}`);
    let serverArticlesData = null;

    // 1. 获取基础文献列表
    if (typeof fetchLiteratureList !== "function") {
        console.error("DataManager/ServerLoad: fetchLiteratureList function is not available from api.js.");
        if (typeof showStatus === "function") showStatus("错误：核心API服务(fetchLiteratureList)缺失，无法从服务器加载数据。", "text-red-500", 0); // 持续显示错误
        return loadTableDataFromLocalStorage(); // 尝试从本地加载作为最终回退
    }

    try {
        serverArticlesData = await fetchLiteratureList();
    } catch (error) { // fetchLiteratureList 内部应该已经处理过 showStatus
        console.error("[DataManager/ServerLoad] Failed to fetch base literature list from server:", error);
        // 如果 fetchLiteratureList 内部没有返回 null 或抛出错误，这里可能不会执行
        return loadTableDataFromLocalStorage(); // 获取基础列表失败，回退到本地
    }

    // 2. 处理从服务器获取的文献列表
    if (serverArticlesData !== null && Array.isArray(serverArticlesData)) {
        console.log('[DataManager/ServerLoad] Base literature data received from server. Count:', serverArticlesData.length);
        if (serverArticlesData.length === 0) {
            console.log('[DataManager/ServerLoad] Server returned an empty literature list.');
            window.tableData = [];
            saveTableDataToLocalStorage(); // 保存空列表以覆盖旧的本地缓存
            if (typeof showStatus === "function") showStatus('您的服务器文献列表为空。', 'text-blue-500', 3000);
            return true; // 成功获取了空列表
        }

        if (typeof fetchAllMyScreenshotsApi !== "function") {
            console.error("DataManager/ServerLoad: fetchAllMyScreenshotsApi function is not available from api.js. Screenshots will not be loaded.");
            // 加载基础文献数据，但不加载截图
            window.tableData = serverArticlesData.map(serverArticle => {
                let primaryId = String(serverArticle.frontend_row_id || serverArticle.id || serverArticle.db_id);
                if (!primaryId || primaryId === 'undefined' || primaryId === 'null') {
                    primaryId = `fallback-id-${Date.now()}-${Math.random().toString(36).substr(2,5)}`;
                }
                return {
                    ...serverArticle,
                    _id: primaryId,
                    db_id: serverArticle.id || serverArticle.db_id,
                    pdfLink: serverArticle.pdf_link || serverArticle.pdfLink || '',
                    status: serverArticle.status || '待处理',
                    isSelected: false,
                    localPdfFileObject: null,
                    screenshots: [] // 截图为空
                };
            });
            saveTableDataToLocalStorage();
            if (typeof showStatus === "function") showStatus(`已从服务器加载 ${window.tableData.length} 条文献记录 (截图功能受限)。`, 'text-orange-500', 4000);
            return true; // 基础数据加载成功
        }

        // 为每篇文献异步获取其截图数据
        const articlesWithScreenshotsPromises = serverArticlesData.map(async (serverArticle) => {
            // ID 确定逻辑：优先使用 frontend_row_id，其次是 id 或 db_id。
            // 这个 ID (作为 populatedArticle._id) 将传递给 fetchAllMyScreenshotsApi。
            // 后端 get_ml_screenshots_data_route 应该能通过此 ID (作为 frontend_article_id) 筛选。
            let frontendId = String(serverArticle.frontend_row_id || serverArticle.id || serverArticle.db_id);
            if (!frontendId || frontendId === 'undefined' || frontendId === 'null') {
                frontendId = `fid-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
                console.warn(`[DataManager] Missing valid frontend_row_id, id, or db_id for server article. Generated fallback _id: ${frontendId}`, serverArticle);
            }

            const populatedArticle = {
                ...serverArticle,
                _id: frontendId, // 前端唯一ID，用于截图API调用
                db_id: serverArticle.id || serverArticle.db_id, // 实际数据库ID
                pdfLink: serverArticle.pdf_link || serverArticle.pdfLink || '',
                status: serverArticle.status || '待处理',
                isSelected: false,
                localPdfFileObject: null,
                screenshots: [] // 初始化
            };

            try {
                const screenshotsForArticle = await fetchAllMyScreenshotsApi(populatedArticle._id); // 使用 _id
                if (screenshotsForArticle && Array.isArray(screenshotsForArticle)) {
                    populatedArticle.screenshots = screenshotsForArticle;
                    // console.log(`[DataManager/ServerLoad] Fetched ${screenshotsForArticle.length} screenshots for article _id: ${populatedArticle._id}`);
                }
            } catch (screenshotError) {
                console.error(`[DataManager/ServerLoad] Error fetching screenshots for article _id ${populatedArticle._id}:`, screenshotError);
                // 即使单篇文章截图获取失败，也让整体流程继续
            }
            return populatedArticle;
        });

        try {
            window.tableData = await Promise.all(articlesWithScreenshotsPromises);
            console.log('[DataManager/ServerLoad] window.tableData populated with articles and their screenshots. Total:', window.tableData.length);

            if (typeof showStatus === "function") {
                showStatus(`已从服务器加载 ${window.tableData.length} 条文献记录 (包括截图信息)。`, 'text-green-500', 4000);
            }
            saveTableDataToLocalStorage(); // 保存包含截图的完整数据
            return true; // 完全成功
        } catch (error) {
            console.error('[DataManager/ServerLoad] Error processing all articles with screenshots (Promise.all failed):', error);
            if (typeof showStatus === "function") showStatus('加载文献的截图信息时发生严重错误。列表可能不完整。', 'text-red-500', 6000);
            // 紧急回退：只加载基础文献数据，不包含截图
            window.tableData = serverArticlesData.map(sa => {
                 let fid = String(sa.frontend_row_id || sa.id || sa.db_id);
                 if (!fid || fid === 'undefined' || fid === 'null') fid = `fid-err-${Date.now()}-${Math.random().toString(36).substring(2,7)}`;
                 return { ...sa, _id: fid, db_id: sa.id || sa.db_id, screenshots: [] };
            });
            saveTableDataToLocalStorage(); // 保存基础数据
            return false; // 表示加载不完全或失败
        }

    } else {
        // serverArticlesData 为 null 或不是数组 (fetchLiteratureList 调用失败或返回无效数据)
        console.warn('[DataManager/ServerLoad] Failed to load base literature from server or server data was invalid. Falling back to localStorage.');
        if (typeof showStatus === "function" && serverArticlesData !== null) { // 仅当不是 fetch 本身网络错误时提示这个
            showStatus('从服务器获取的文献列表格式不正确。尝试从本地缓存加载。', 'text-orange-500', 5000);
        }
        return loadTableDataFromLocalStorage(); // 回退到本地存储
    }
}

/**
 * 更新 window.tableData 中的特定文献条目的特定字段，并可选地同步到服务器。
 * @param {string} rowId 要更新的行的前端唯一ID (_id)。
 * @param {string} field 要更新的字段名 (前端使用的字段名)。
 * @param {*} value 新的字段值。
 * @param {boolean} syncToServer 是否尝试将此更改同步到服务器 (默认为 true)。
 * @returns {Promise<boolean>} 数据是否被修改 (无论是否同步成功)。
 */
export async function updateTableDataEntry(rowId, field, value, syncToServer = true) {
    if (!rowId || typeof field !== 'string') {
        console.error(`[DataManager/UpdateEntry] Invalid parameters: rowId or field missing/invalid. RowId: ${rowId}, Field: ${field}`);
        return false;
    }

    console.log(`[DataManager/UpdateEntry] Request to update rowId='${rowId}', field='${field}', value='${value}', sync:${syncToServer}`);
    const rowIndex = window.tableData.findIndex(row => row._id === rowId);

    if (rowIndex === -1) {
        console.error(`[DataManager/UpdateEntry] Row with _id '${rowId}' not found in window.tableData.`);
        return false;
    }

    let dataWasModified = false;
    if (window.tableData[rowIndex][field] !== value) {
        window.tableData[rowIndex][field] = value;
        dataWasModified = true;
        console.log(`[DataManager/UpdateEntry] Field '${field}' for rowId '${rowId}' updated locally to:`, value);
    } else {
        console.log(`[DataManager/UpdateEntry] Field '${field}' for rowId '${rowId}' already has value:`, value, ". No local change.");
    }

    if (dataWasModified) {
        saveTableDataToLocalStorage(); // 只要本地数据有变动，就保存
    }

    // 定义允许同步到服务器的前端字段名及其到后端字段名的映射
    const syncConfig = {
        'pdfLink': 'pdf_link',
        'status': 'status',
        'title': 'title',
        'authors': 'authors',
        'year': 'year',
        'source': 'source_publication', // 前端使用 'source' (来自 COLUMN_MAPPING)，后端是 'source_publication'
        'doi': 'doi'
    };

    if (syncToServer && dataWasModified && Object.keys(syncConfig).includes(field)) {
        const articleDbId = window.tableData[rowIndex].db_id; // 使用数据库ID进行同步
        if (!articleDbId) {
            console.warn(`[DataManager/UpdateEntry] Cannot sync field '${field}' for rowId '${rowId}' to server: missing db_id.`);
        } else {
            const backendFieldName = syncConfig[field];
            const updatesPayload = { [backendFieldName]: value };

            if (typeof updateSingleLiteratureArticle !== "function") {
                console.error("DataManager/UpdateEntry: updateSingleLiteratureArticle function is not available for server sync.");
            } else {
                if (typeof showStatus === "function") {
                    const titleToDisplay = window.tableData[rowIndex].title ||
                                         (COLUMN_MAPPING && COLUMN_MAPPING.title && typeof findHeader === "function" ? window.tableData[rowIndex][findHeader(Object.keys(window.tableData[rowIndex]), COLUMN_MAPPING.title)] : null) ||
                                         '该文献';
                    showStatus(`正在同步 "${truncateText(titleToDisplay, 20)}" 的 "${field}" 字段更改...`, 'text-blue-500', 0);
                }
                try {
                    const syncSuccess = await updateSingleLiteratureArticle(articleDbId, updatesPayload);
                    // updateSingleLiteratureArticle 内部应处理其自身的成功/失败 showStatus 消息
                    if (!syncSuccess && typeof showStatus === "function") {
                         // 如果 updateSingleLiteratureArticle 返回 false 但未显示消息，这里可以补充一个通用失败消息
                         // 通常，API函数应自行处理其反馈
                    }
                } catch (syncError) { // 以防 updateSingleLiteratureArticle 抛出错误而不是返回false
                    console.error(`[DataManager/UpdateEntry] Error syncing field '${field}' for db_id '${articleDbId}':`, syncError);
                    if (typeof showStatus === "function") showStatus(`同步字段 "${field}" 失败: ${syncError.message}`, 'text-red-500', 5000);
                }
            }
        }
    }

    // 无论同步是否成功，只要本地数据修改了，就尝试刷新UI
    if (dataWasModified) {
        console.log('[DataManager/UpdateEntry] Data was modified, requesting UI refresh via applyFiltersAndSort.');
        if (typeof applyFiltersAndSort === 'function') {
            applyFiltersAndSort();
        } else {
            console.warn('[DataManager/UpdateEntry] applyFiltersAndSort function not available to refresh UI.');
        }
    }
    return dataWasModified; // 返回数据是否在本地被修改
}

console.log("dataManager.js (Enhanced Version) loaded: Data management functions are available.");