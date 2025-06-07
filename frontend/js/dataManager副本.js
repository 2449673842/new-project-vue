// js/dataManager.js

// 这个文件将管理 tableData 的状态、本地存储以及与服务器的数据同步。
// 它会依赖于 main_index.js 中定义的全局变量 tableData, LOCAL_STORAGE_KEY_TABLE_DATA,
// 以及 api.js 中定义的 API 调用函数 (如 fetchLiteratureList, saveFullLiteratureList, updateSingleLiteratureArticle)。
// 它也可能调用 utils.js 中的 showStatus。

// --- 导入依赖 (如果这些函数不是全局可用的，或者我们希望更明确地管理依赖) ---
// import { LOCAL_STORAGE_KEY_TABLE_DATA } from './config.js'; // 理想情况下
// import { showStatus, findHeader, truncateText } from './utils.js';  // 理想情况下
// import { fetchLiteratureList, updateSingleLiteratureArticle } from './api.js'; // 理想情况下
// 注意：由于您目前很多变量和函数是通过 window 全局访问的，下面的代码将继续这种方式，
// 但理想情况下，这些依赖应该通过 import 明确导入。
import { fetchLiteratureList, updateSingleLiteratureArticle } from './api.js';
import { showStatus, findHeader, truncateText } from './utils.js'; // 假设这些是 dataManager 需要的
import { applyFiltersAndSort } from './uiHandlers.js';
import { LOCAL_STORAGE_KEY_TABLE_DATA, COLUMN_MAPPING } from './config.js'; // 假设这些是 dataManager 需要的

/**
 * 将当前的 tableData 保存到 localStorage (不包含 File 对象)。
 */
export function saveTableDataToLocalStorage() { // <--- 添加 export
    // window.tableData 和 window.LOCAL_STORAGE_KEY_TABLE_DATA 预期在 main_index.js 中初始化/定义
    // 或者从 config.js 导入 LOCAL_STORAGE_KEY_TABLE_DATA
    const localStorageKey = LOCAL_STORAGE_KEY_TABLE_DATA;

    if (window.tableData && localStorageKey) {
        try {
            const serializableTableData = window.tableData.map(row => {
                const { localPdfFileObject, ...restOfRow } = row;
                if (restOfRow.screenshots && Array.isArray(restOfRow.screenshots)) {
                    restOfRow.screenshots = restOfRow.screenshots.map(ss => ({ ...ss }));
                }
                return restOfRow;
            });
            const dataToSave = JSON.stringify(serializableTableData);
            localStorage.setItem(localStorageKey, dataToSave);
            console.log('[DataManager/LocalStorage] Saved tableData (excluding File objects). Items:', serializableTableData.length);
        } catch (error) {
            console.error('[DataManager/LocalStorage] Error saving tableData:', error);
            if (typeof showStatus === "function") showStatus('保存文献列表到本地存储失败！', 'text-red-500', 3000);
        }
    } else {
        console.warn('[DataManager/LocalStorage] tableData or LOCAL_STORAGE_KEY_TABLE_DATA not available for saving.');
    }
}

/**
 * 从 localStorage 加载 tableData。
 * (这个函数主要被 loadTableDataFromServer 调用，或者在 dataManager 内部使用，通常不需要直接从 main_index 导出给外部)
 * 但如果其他模块可能需要直接调用它，也可以导出。
 * @returns {boolean} 如果成功从 localStorage 加载了数据则返回 true，否则返回 false。
 */
export function loadTableDataFromLocalStorage() { // <--- 添加 export (如果其他模块也需要直接调用)
    const localStorageKey = window.LOCAL_STORAGE_KEY_TABLE_DATA || 'litFinderTableDataV1';
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
                    localPdfFileObject: null,
                    screenshots: row.screenshots ? row.screenshots.map(ss => ({ ...ss })) : []
                }));
                console.log('[DataManager/LocalStorage] Loaded tableData from localStorage. Total items:', window.tableData.length);
                if (window.statusMessage && window.tableData.length > 0 && typeof showStatus === "function") {
                    showStatus(`已从本地缓存恢复列表 (${window.tableData.length} 条)。本地PDF需通过“关联”功能重新指定。`, 'text-green-500', 5000);
                }
                return true;
            } else {
                console.warn("[DataManager/LocalStorage] Parsed data from localStorage is not an array.");
                localStorage.removeItem(localStorageKey);
            }
        } else {
            console.log("[DataManager/LocalStorage] No data found in localStorage for key:", localStorageKey);
        }
    } catch (error) {
        console.error('[DataManager/LocalStorage] Error loading or parsing tableData from localStorage:', error);
        if (window.statusMessage && typeof showStatus === "function") {
            showStatus('加载本地列表失败！数据可能已损坏或格式不兼容。', 'text-red-500', 4000);
        }
        localStorage.removeItem(localStorageKey);
    }
    window.tableData = [];
    console.log("[DataManager/LocalStorage] tableData initialized as empty array due to load failure or no data.");
    return false;
}

/**
 * 从服务器加载文献列表，如果失败则尝试从本地存储加载。
 * 会更新全局的 window.tableData。
 * @param {boolean} forceRefresh - 是否强制从服务器刷新。
 * @returns {Promise<boolean>} 数据是否成功加载。
 */
export async function loadTableDataFromServer(forceRefresh = false) { // <--- 添加 export
    console.log(`[DataManager/ServerLoad] Attempting to load literature list from server. Force refresh: ${forceRefresh}`);
    let serverData = null;
    // 确保 fetchLiteratureList 是可用的 (应从 api.js 导入，或全局)
    if (typeof fetchLiteratureList === "function") {
        serverData = await fetchLiteratureList();
        console.log('[DataManager/ServerLoad] Data received from server (fetchLiteratureList):', JSON.parse(JSON.stringify(serverData))); // 打印服务器原始数据
    } else {
        console.error("DataManager/ServerLoad: fetchLiteratureList function is not available (api.js not loaded or error).");
        if (typeof showStatus === "function") showStatus("错误：API服务(fetchLiteratureList)未就绪，无法从服务器加载数据。", "text-red-500", 5000);
        return loadTableDataFromLocalStorage();
    }

    if (serverData !== null && Array.isArray(serverData)) {
        let oldLocalTableDataForMerge = [];
        const localStorageKey = window.LOCAL_STORAGE_KEY_TABLE_DATA || 'litFinderTableDataV1';
        try {
            const saved = localStorage.getItem(localStorageKey);
            if (saved) oldLocalTableDataForMerge = JSON.parse(saved);
            if (!Array.isArray(oldLocalTableDataForMerge)) oldLocalTableDataForMerge = [];
        } catch (e) { oldLocalTableDataForMerge = []; }

        window.tableData = serverData.map(serverArticle => {
            const populatedArticle = {
                ...serverArticle,
                _id: serverArticle.frontend_row_id || serverArticle._id || `row-${Date.now()}-${Math.random().toString(36).substr(2,5)}`,
                pdfLink: serverArticle.pdf_link || serverArticle.pdfLink || '',
                status: serverArticle.status || '待处理',
                screenshots: [],
                localPdfFileObject: null
            };
            const oldArticleMatch = oldLocalTableDataForMerge.find(localArticle =>
                localArticle._id === populatedArticle._id ||
                (populatedArticle.db_id && localArticle.db_id && localArticle.db_id === populatedArticle.db_id)
            );
            if (oldArticleMatch && oldArticleMatch.screenshots && oldArticleMatch.screenshots.length > 0) {
                populatedArticle.screenshots = oldArticleMatch.screenshots;
            }
            return populatedArticle;
        });
        console.log('[DataManager/ServerLoad] window.tableData after processing server data:', JSON.parse(JSON.stringify(window.tableData))); // 打印处理后的数据

        if (window.statusMessage && typeof showStatus === "function") {
            if (window.tableData.length > 0) {
                showStatus(`已从服务器加载 ${window.tableData.length} 条文献记录 (并合并本地截图信息)。`, 'text-green-500', 4000);
            } else {
                showStatus('您的服务器文献列表为空。', 'text-blue-500', 3000);
            }
        }
        saveTableDataToLocalStorage();
        return true;
    } else {
        console.warn('[DataManager/ServerLoad] Failed to load from server or server data was invalid. Falling back to localStorage.');
        // showStatus 已经在 fetchLiteratureList 内部或此处 catch 中调用过了
        return loadTableDataFromLocalStorage();
    }
}

/**
 * 更新 tableData 中的特定行记录的特定字段，并可选地同步到服务器。
 * @param {string} rowId 要更新的行的前端唯一ID (_id)。
 * @param {string} field 要更新的字段名。
 * @param {*} value 新的字段值。
 * @param {boolean} syncToServer 是否尝试将此更改同步到服务器 (默认为 true，但只对特定字段)。
 */
export async function updateTableDataEntry(rowId, field, value, syncToServer = true) { // <--- 添加 export
    console.log(`[DataManager/UpdateEntry] Called: rowId='${rowId}', field='${field}', value='${value}', sync:${syncToServer}`);
    const rowIndex = window.tableData.findIndex(row => row._id === rowId);
    if (rowIndex === -1) {
        console.error(`[DataManager/UpdateEntry] Row with _id ${rowId} not found in tableData.`);
        return false;
    }

    let dataWasModified = false;
    if (window.tableData[rowIndex][field] !== value) {
        window.tableData[rowIndex][field] = value;
        dataWasModified = true;
    }

    if (dataWasModified || (syncToServer && ['pdfLink', 'status'].includes(field))) {
        saveTableDataToLocalStorage();
        const articleDbId = window.tableData[rowIndex].db_id;
        if (syncToServer && articleDbId && ['pdfLink', 'status'].includes(field)) {
            let updatesPayload = {};
            if (field === 'pdfLink') updatesPayload['pdf_link'] = value;
            else if (field === 'status') updatesPayload['status'] = value;

            if (Object.keys(updatesPayload).length > 0) {
                // 确保依赖的函数可用
                if (typeof showStatus === "function" && typeof truncateText === "function" && typeof findHeader === "function" && window.COLUMN_MAPPING && typeof updateSingleLiteratureArticle === "function") {
                    showStatus(`正在同步 "${truncateText(window.tableData[rowIndex].title || window.tableData[rowIndex][findHeader(Object.keys(window.tableData[rowIndex]), window.COLUMN_MAPPING.title)] || '文献', 20)}" 的更改...`, 'text-blue-500');
                    await updateSingleLiteratureArticle(articleDbId, updatesPayload);
                } else {
                    console.error("DataManager/UpdateEntry: Missing required functions (showStatus, truncateText, findHeader, updateSingleLiteratureArticle) or COLUMN_MAPPING for server sync status update.");
                }
            }
        }
    }
    if (dataWasModified) {
        // 现在 applyFiltersAndSort 应该是通过 import 导入的函数了
        console.log('[DataManager/UpdateEntry] Data was modified, attempting to call imported applyFiltersAndSort to refresh UI.');
        if (typeof applyFiltersAndSort === "function") {
            applyFiltersAndSort();
        } else {
            // 这条日志理论上不应该再出现了，除非导入失败或函数名不匹配
            console.error("[DataManager/UpdateEntry] applyFiltersAndSort (imported from uiHandlers.js) function is not defined! UI will not refresh.");
            // 作为备用，如果 main_index.js 将其挂载到了 window
            if (typeof window.applyFiltersAndSort === "function") {
                console.warn("[DataManager/UpdateEntry] Fallback: Calling window.applyFiltersAndSort.");
                window.applyFiltersAndSort();
            }
        }
    }
    return dataWasModified;
}

console.log("dataManager.js loaded: Data management functions are available and exported.");

// 如果您想使用集中的导出块，可以移除函数前的 export，然后在末尾添加：
// export {
//     saveTableDataToLocalStorage,
//     loadTableDataFromLocalStorage,
//     loadTableDataFromServer,
//     updateTableDataEntry
// };