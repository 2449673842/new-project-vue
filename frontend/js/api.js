// js/api.js

// 这个文件将包含所有与后端交互的fetch调用。
// 它会依赖 main_index.js 中定义的全局变量 window.backendBaseUrl (由用户输入或localStorage初始化)
// 和用于获取 authToken 的 localStorage.getItem('authToken') 方法。
// 它也会调用全局的 showStatus 函数 (应由 utils.js 提供并在 main_index.js 中确保其可用性) 来显示用户反馈。
import { showStatus } from './utils.js'; // <-- 新增：确保导入 showStatus
/**
 * 获取当前用户的文献列表。
 * @returns {Promise<Array|null>} 返回文献对象数组，如果失败则返回null。
 */
async function fetchLiteratureList(params = null) {
    const currentAuthToken = localStorage.getItem('authToken');
    const backendApiUrl = window.backendBaseUrl;

    if (!currentAuthToken) {
        console.error('API/fetchLiteratureList: Auth token is missing.');
        if (typeof showStatus === "function") showStatus('认证失败：无法获取用户凭证。', 'text-red-500', 5000);
        return null;
    }
    if (!backendApiUrl) {
        console.error('API/fetchLiteratureList: Backend API URL is not configured.');
        if (typeof showStatus === "function") showStatus('错误：后端API链接未配置。', 'text-red-500', 5000);
        return null;
    }

    let getListApiUrl = `${backendApiUrl}/api/user/literature_list`;
    if (params) {
        getListApiUrl += `?${params.toString()}`;
    }

    try {
        const response = await fetch(getListApiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${currentAuthToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: `服务器响应错误，状态码: ${response.status}` }));
            throw new Error(errorData.message || `获取文献列表失败 (状态: ${response.status})`);
        }
        const serverData = await response.json();
        return serverData;
    } catch (error) {
        console.error('API/fetchLiteratureList: Error fetching literature list:', error);
        if (typeof showStatus === "function") showStatus(`从服务器加载文献列表失败: ${error.message}`, 'text-red-500', 7000);
        return null;
    }
}


/**
 * 保存/替换当前用户的整个文献列表到服务器。
 * @param {Array} literatureDataArray 要保存的文献数据数组。
 * @returns {Promise<boolean>} 操作是否成功。
 */
async function saveFullLiteratureList(literatureDataArray) {
    const currentAuthToken = localStorage.getItem('authToken');
    const backendApiUrl = window.backendBaseUrl;

    if (!currentAuthToken) {
        console.error('API/saveFullLiteratureList: Auth token is missing.');
        if (typeof showStatus === "function") showStatus('认证失败：无法获取用户凭证。', 'text-red-500', 5000);
        return { success: false, message: '认证失败' }; // 返回错误对象
    }
    if (!backendApiUrl) {
        console.error('API/saveFullLiteratureList: Backend API URL is not configured.');
        if (typeof showStatus === "function") showStatus('错误：后端API链接未配置。', 'text-red-500', 5000);
        return { success: false, message: '后端API未配置' }; // 返回错误对象
    }

    const saveListApiUrl = `${backendApiUrl}/api/user/literature_list`;
    try {
        // 移除前端不应发送到后端的临时字段，如 localPdfFileObject
        const serializableData = literatureDataArray.map(row => {
            const { localPdfFileObject, isSelected, ...restOfRow } = row; // 移除 isSelected
            // 确保 screenshots 数组中的对象也是可序列化的（如果它们包含复杂对象）
            if (restOfRow.screenshots && Array.isArray(restOfRow.screenshots)) {
                restOfRow.screenshots = restOfRow.screenshots.map(ss => ({ ...ss })); // 浅拷贝
            }
            return restOfRow;
        });

        const response = await fetch(saveListApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentAuthToken}`
            },
            body: JSON.stringify(serializableData)
        });
        const responseData = await response.json(); // 获取完整的JSON响应

        if (response.ok) { // 后端成功时（例如200 OK）
            // responseData 应该包含 { success: true, message: "...", added: X, skipped: Y }
            return responseData;
        } else {
            // 即便HTTP状态码不是2xx，后端也可能返回包含错误信息的JSON
            throw new Error(responseData.message || `同步文献列表到服务器失败 (状态: ${response.status})`);
        }
    } catch (error) {
        console.error('API/saveFullLiteratureList: Error syncing literature list:', error);
        if (typeof showStatus === "function") showStatus(`同步到服务器失败: ${error.message}`, 'text-red-500', 7000);
        return { success: false, message: error.message, added: 0, skipped: 0 }; // 返回包含错误信息的对象
    }
}

// js/api.js

// ... (其他函数定义，如 fetchLiteratureList, saveFullLiteratureList) ...

/**
 * 更新服务器上单条文献记录的指定字段。
 * @param {string|number} articleDbId 文献在数据库中的ID。
 * @param {object} updatesToSync 要更新的字段和值，例如 { status: "链接已找到 (自动)" }。
 * @returns {Promise<boolean>} 操作是否成功。
 */
async function updateSingleLiteratureArticle(articleDbId, updatesToSync) {
    const currentAuthToken = localStorage.getItem('authToken');
    const backendApiUrl = window.backendBaseUrl;

    if (!currentAuthToken || !backendApiUrl || !articleDbId || !updatesToSync || Object.keys(updatesToSync).length === 0) {
        const errorMsg = '更新失败：参数错误或配置缺失。';
        console.error('API/updateSingleLiteratureArticle:', errorMsg, { articleDbId, updatesToSync, backendApiUrl, currentAuthToken });
        if (typeof showStatus === "function") showStatus(errorMsg, 'text-red-500', 4000);
        return false;
    }

    // *** 关键修改：使用新的RESTful API路径和PATCH方法 ***
    const updateApiUrl = `${backendApiUrl}/api/literature_articles/${articleDbId}`; // 使用复数 articles 并将ID放入路径
    const payload = updatesToSync; // 请求体直接是包含更新内容的对象

    try {
        const response = await fetch(updateApiUrl, {
            method: 'PATCH', // *** 修改：使用 PATCH 方法 ***
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentAuthToken}`
            },
            body: JSON.stringify(payload) // 发送不嵌套的更新对象
        });

        const responseData = await response.json();
        if (response.ok && responseData.success) {
            // 后端成功更新的日志和用户提示通常由后端自己处理，前端可以只关心成功与否
            // 但如果需要，也可以在这里显示成功消息
            // console.log(`[API] Successfully updated article ${articleDbId}`);
            return true;
        } else {
            // 抛出错误，让调用者（例如 dataManager.js）可以捕获并处理
            throw new Error(responseData.message || `更新文献记录失败 (状态: ${response.status})`);
        }
    } catch (error) {
        console.error(`API/updateSingleLiteratureArticle: Error updating DB ID ${articleDbId}:`, error);
        if (typeof showStatus === "function") {
             // 避免显示 "TypeError: Failed to fetch"，而是显示更具体的错误
            if (error.message.includes('Failed to fetch')) {
                 showStatus(`同步更新失败: 无法连接到后端服务。请检查网络和后端运行状态。`, 'text-red-500', 7000);
            } else {
                 showStatus(`同步更新失败: ${error.message}`, 'text-red-500', 7000);
            }
        }
        return false;
    }
}

// ... (其他函数定义) ...

/**
 * 向后端请求查找PDF链接。
 * @param {string|null} doi 文献的DOI。
 * @param {string|null} title 文献的标题。
 * @returns {Promise<object|null>} 包含pdfLink的对象，或在失败时返回null。
 */
async function findPdfLinkApi(doi, title) {
    const backendApiUrl = window.backendBaseUrl;
    if (!backendApiUrl) {
        console.error('API/findPdfLinkApi: Backend API URL is not configured.');
        if (typeof showStatus === "function") showStatus('错误：后端API链接未配置。', 'text-red-500', 5000);
        return null;
    }
    if (!doi && !title) {
        console.error('API/findPdfLinkApi: DOI and Title both missing.');
        return null;
    }

    const queryParams = new URLSearchParams();
    if (doi) queryParams.append('doi', doi);
    if (title) queryParams.append('title', title);

    const apiUrl = `${backendApiUrl}/api/find-pdf?${queryParams.toString()}`;
    try {
        const response = await fetch(apiUrl, {
             headers: {'Authorization': `Bearer ${localStorage.getItem('authToken')}`}
        });
        const responseData = await response.json();
        if (!response.ok) {
            throw new Error(responseData.error || responseData.message || `后端错误: ${response.status}`);
        }
        return responseData;
    } catch (error) {
        console.error('API/findPdfLinkApi: Error finding PDF link:', error);
        if (typeof showStatus === "function") showStatus(`通过API查找PDF链接失败: ${error.message}`, 'text-red-500', 4000);
        return { pdfLink: null, message: error.message };
    }
}

/**
 * 请求后端批量处理文献并打包为ZIP。
 * @param {Array} articlesToProcess 要处理的文章对象数组。
 * @returns {Promise<object|null>} 后端返回的JSON响应，或在失败时返回null。
 */
async function batchProcessAndZipApi(articlesToProcess) {
    const backendApiUrl = window.backendBaseUrl;
    if (!backendApiUrl) {
        console.error('API/batchProcessAndZipApi: Backend API URL is not configured.');
        if (typeof showStatus === "function") showStatus('错误：后端API链接未配置。', 'text-red-500', 5000);
        return null;
    }

    const batchApiUrl = `${backendApiUrl}/api/batch_process_and_zip`;
    const payload = { articles: articlesToProcess };
    try {
        const response = await fetch(batchApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify(payload)
        });
        const responseData = await response.json();
        if (!response.ok) {
            throw new Error(responseData.error || responseData.message || `服务器错误: ${response.status}`);
        }
        return responseData;
    } catch (error) {
        console.error('API/batchProcessAndZipApi: Error during batch processing:', error);
        if (typeof showStatus === "function") showStatus(`批量下载出错: ${error.message}`, 'text-red-500', 7000);
        return null;
    }
}

/**
 * 请求删除旧的批量下载记录。
 * @param {string} taskId 要删除记录的任务ID。
 * @returns {Promise<boolean>} 操作是否成功。
 */
async function deleteBatchRecordApi(taskId) {
    const backendApiUrl = window.backendBaseUrl;
    if (!backendApiUrl || !taskId) {
        console.error('API/deleteBatchRecordApi: Backend URL or Task ID missing.');
        if (typeof showStatus === "function") showStatus('删除失败: 配置或参数缺失。', 'text-red-500', 4000);
        return false;
    }
    try {
        const resp = await fetch(`${backendApiUrl}/api/delete_batch_record`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ task_id: taskId })
        });
        const data = await resp.json();
        return resp.ok && data.success;
    } catch (err) {
        console.error(`API/deleteBatchRecordApi: Network error for task ${taskId}`, err);
        if (typeof showStatus === "function") showStatus(`删除旧记录时发生网络错误。`, 'text-red-500', 4000);
        return false;
    }
}

/**
 * 保存截图及其元数据到服务器。
 * @param {object} screenshotPayload 包含截图所有信息的对象。
 * @returns {Promise<object|null>} 服务器响应，或在失败时返回null。
 */
async function saveScreenshotApi(screenshotPayload) {
    const backendApiUrl = window.backendBaseUrl;
    const currentAuthToken = localStorage.getItem('authToken');
    if (!backendApiUrl || !currentAuthToken) {
        console.error('API/saveScreenshotApi: Backend URL or Auth Token missing.');
        if (typeof showStatus === "function") showStatus('截图保存失败: 配置或认证缺失。', 'text-red-500', 4000);
        return null;
    }

    const saveScreenshotApiUrl = `${backendApiUrl}/api/save_screenshot`;
    try {
        const response = await fetch(saveScreenshotApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentAuthToken}`
            },
            body: JSON.stringify(screenshotPayload)
        });
        const responseData = await response.json();
        if (response.ok && responseData.success) {
            return responseData;
        } else {
            throw new Error(responseData.message || `服务器保存截图失败 (状态: ${response.status})`);
        }
    } catch (error) {
        console.error('API/saveScreenshotApi: Error saving screenshot:', error);
        if (typeof showStatus === "function") showStatus(`截图保存到服务器失败: ${error.message}`, 'text-red-500', 7000);
        return null;
    }
}

/**
 * 更新服务器上现有截图的元数据。
 * @param {object} metadataUpdatePayload 包含 serverMetadataPath 和要更新的字段。
 * @returns {Promise<boolean>} 操作是否成功。
 */
async function updateScreenshotMetadataApi(metadataUpdatePayload) {
    const currentAuthToken = localStorage.getItem('authToken');
    const backendApiUrl = window.backendBaseUrl;

    console.log(`DEBUG: updateScreenshotMetadataApi: Called with payload:`, metadataUpdatePayload); // <--- 新增调试
    console.log(`DEBUG: updateScreenshotMetadataApi: Target URL: ${backendApiUrl}/api/screenshot_metadata/update`); // <--- 新增调试

    if (!currentAuthToken || !backendApiUrl) {
        console.error('API/updateScreenshotMetadataApi: Backend URL or Auth Token missing.');
        showStatus('元数据更新失败: 配置或认证缺失。', 'text-red-500', 4000);
        return false;
    }

    const updateMetadataApiUrl = `${backendApiUrl}/api/screenshot_metadata/update`;
    try {
        const response = await fetch(updateMetadataApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentAuthToken}`
            },
            body: JSON.stringify(metadataUpdatePayload)
        });
        const responseData = await response.json();
        console.log(`DEBUG: updateScreenshotMetadataApi: Server responded with status ${response.status}, data:`, responseData); // <--- 新增调试

        if (response.ok && responseData.success) {
            showStatus(responseData.message || '截图元数据已成功更新。', 'text-green-500', 3000);
            return true;
        } else {
            const errorMessage = responseData.message || `服务器更新截图元数据失败 (状态: ${response.status})`;
            console.error(`ERROR: updateScreenshotMetadataApi: Server reported failure: ${errorMessage}`); // <--- 新增错误日志
            throw new Error(errorMessage); // 抛出错误以被调用者捕获
        }
    } catch (error) {
        console.error('API/updateScreenshotMetadataApi: Error updating metadata:', error);
        showStatus(`截图元数据更新失败: ${error.message}`, 'text-red-500', 7000);
        return false;
    }
}

/**
 * 获取当前用户的所有截图元数据 (用于 my_records.html 或其他截图管理页面)。
 * @param {string|null} filterArticleId 可选，按文献的前端ID筛选。
 * @param {string|null} filterChartType 可选，按图表类型筛选。
 * @returns {Promise<Array|null>} 截图元数据数组，或在失败时返回null。
 */
async function fetchAllMyScreenshotsApi(filterArticleId = null, filterChartType = null) {
    const currentAuthToken = localStorage.getItem('authToken');
    const backendApiUrl = window.backendBaseUrl_my_records || window.backendBaseUrl; // Allow page-specific override

    if (!currentAuthToken) {
        console.error('API/fetchAllMyScreenshotsApi: Auth token is missing.');
        return null;
    }
    if (!backendApiUrl) {
        console.error('API/fetchAllMyScreenshotsApi: Backend API URL is not configured.');
        return null;
    }

    const queryParams = new URLSearchParams();
    if (filterArticleId) queryParams.append('frontend_article_id', filterArticleId);
    if (filterChartType) queryParams.append('chart_type', filterChartType);

    // ***** 关键修改：使用正确的后端端点 /api/ml/screenshots *****
    const apiUrl = `${backendApiUrl}/api/ml/screenshots${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    console.log(`API/fetchAllMyScreenshotsApi: Fetching from URL: ${apiUrl}`); // 调试日志

    try {
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${currentAuthToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: `服务器响应错误，状态码: ${response.status}` }));
            console.error(`API/fetchAllMyScreenshotsApi: Server error ${response.status}`, errorData); // 调试日志
            throw new Error(errorData.message || `获取截图数据失败 (状态: ${response.status})`);
        }
        const data = await response.json();
        // 后端 /api/ml/screenshots 直接返回一个数组
        return Array.isArray(data) ? data : null;
    } catch (error) {
        console.error('API/fetchAllMyScreenshotsApi: Error fetching screenshots:', error);
        if (typeof showStatus === "function") showStatus(`加载截图列表出错: ${error.message}`, 'text-red-500', 5000);
        return null;
    }
}



/**
 * Fetches dashboard statistics for the current user.
 * @returns {Promise<Object|null>} An object containing dashboard stats, or null on failure.
 */
async function fetchDashboardStats() {
    const currentAuthToken = localStorage.getItem('authToken');
    const backendApiUrl = window.backendBaseUrl;

    if (!currentAuthToken) {
        console.error('API/fetchDashboardStats: Auth token is missing.');
        if (typeof showStatus === "function") showStatus('获取统计数据失败：用户未认证。', 'text-red-500', 5000);
        return null;
    }
    if (!backendApiUrl) {
        console.error('API/fetchDashboardStats: Backend API URL is not configured.');
        if (typeof showStatus === "function") showStatus('获取统计数据失败：后端API链接未配置。', 'text-red-500', 5000);
        return null;
    }

    const statsApiUrl = `${backendApiUrl}/api/user/dashboard_stats`;
    try {
        const response = await fetch(statsApiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${currentAuthToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: `服务器响应错误，状态码: ${response.status}` }));
            throw new Error(errorData.message || `获取仪表盘统计失败 (状态: ${response.status})`);
        }
        const responseData = await response.json();
        if (responseData.success && responseData.stats) {
            console.log("[API/fetchDashboardStats] Received stats:", responseData.stats);
            return responseData.stats;
        } else {
            throw new Error(responseData.message || "获取仪表盘统计数据格式不正确或操作未成功。");
        }
    } catch (error) {
        console.error('API/fetchDashboardStats: Error fetching dashboard stats:', error);
        if (typeof showStatus === "function") showStatus(`获取仪表盘统计失败: ${error.message}`, 'text-red-500', 7000);
        return null;
    }
}

/**
 * Fetches the recent activity list for the current user.
 * @param {number} limit - Optional. The maximum number of activities to fetch.
 * @returns {Promise<Array|null>} An array of activity objects, or null on failure.
 */
async function fetchRecentActivity(limit = 5) { // Default limit to 5
    const currentAuthToken = localStorage.getItem('authToken');
    const backendApiUrl = window.backendBaseUrl;

    if (!currentAuthToken) {
        console.error('API/fetchRecentActivity: Auth token is missing.');
        if (typeof showStatus === "function") showStatus('获取最近活动失败：用户未认证。', 'text-red-500', 5000);
        return null;
    }
    if (!backendApiUrl) {
        console.error('API/fetchRecentActivity: Backend API URL is not configured.');
        if (typeof showStatus === "function") showStatus('获取最近活动失败：后端API链接未配置。', 'text-red-500', 5000);
        return null;
    }

    const activityApiUrl = `${backendApiUrl}/api/user/recent_activity?limit=${limit}`;
    try {
        const response = await fetch(activityApiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${currentAuthToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: `服务器响应错误，状态码: ${response.status}` }));
            throw new Error(errorData.message || `获取最近活动失败 (状态: ${response.status})`);
        }
        const responseData = await response.json();
        if (responseData.success && Array.isArray(responseData.activities)) {
            console.log("[API/fetchRecentActivity] Received activities:", responseData.activities);
            return responseData.activities;
        } else {
            throw new Error(responseData.message || "获取最近活动数据格式不正确或操作未成功。");
        }
    } catch (error) {
        console.error('API/fetchRecentActivity: Error fetching recent activity:', error);
        if (typeof showStatus === "function") showStatus(`获取最近活动失败: ${error.message}`, 'text-red-500', 7000);
        return null;
    }
}

/**
 * Fetches literature classification statistics for the current user.
 * @returns {Promise<Object|null>} An object containing classification stats, or null on failure.
 */
async function fetchLiteratureClassificationStats() {
    const currentAuthToken = localStorage.getItem('authToken');
    const backendApiUrl = window.backendBaseUrl;

    if (!currentAuthToken) {
        console.error('API/fetchLiteratureClassificationStats: Auth token is missing.');
        if (typeof showStatus === "function") showStatus('获取文献分类统计失败：用户未认证。', 'text-red-500', 5000);
        return null;
    }
    if (!backendApiUrl) {
        console.error('API/fetchLiteratureClassificationStats: Backend API URL is not configured.');
        if (typeof showStatus === "function") showStatus('获取文献分类统计失败：后端API链接未配置。', 'text-red-500', 5000);
        return null;
    }

    const classificationApiUrl = `${backendApiUrl}/api/user/literature_classification_stats`;
    try {
        const response = await fetch(classificationApiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${currentAuthToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: `服务器响应错误，状态码: ${response.status}` }));
            throw new Error(errorData.message || `获取文献分类统计失败 (状态: ${response.status})`);
        }
        const responseData = await response.json();
        if (responseData.success && responseData.classification) {
            console.log("[API/fetchLiteratureClassificationStats] Received classification stats:", responseData.classification);
            return responseData.classification;
        } else {
            throw new Error(responseData.message || "获取文献分类统计数据格式不正确或操作未成功。");
        }
    } catch (error) {
        console.error('API/fetchLiteratureClassificationStats: Error fetching classification stats:', error);
        if (typeof showStatus === "function") showStatus(`获取文献分类统计失败: ${error.message}`, 'text-red-500', 7000);
        return null;
    }
}



/**
 * 下载指定文献记录的所有截图及其元数据为一个ZIP包。
 * @param {string|number} articleDbId 文献在数据库中的ID。
 * @returns {Promise<Blob|null>} 返回包含ZIP数据的Blob对象，如果失败则返回null。
 */
async function downloadRecordScreenshotsZipApi(articleDbId) {
    const currentAuthToken = localStorage.getItem('authToken');
    const backendApiUrl = window.backendBaseUrl; // 确保这个全局变量已正确设置

    if (!currentAuthToken) {
        console.error('API/downloadRecordScreenshotsZipApi: Auth token is missing.');
        if (typeof showStatus === "function") showStatus('认证失败：无法获取用户凭证。', 'text-red-500', 5000);
        return null;
    }
    if (!backendApiUrl) {
        console.error('API/downloadRecordScreenshotsZipApi: Backend API URL is not configured.');
        if (typeof showStatus === "function") showStatus('错误：后端API链接未配置。', 'text-red-500', 5000);
        return null;
    }
    if (!articleDbId) {
        console.error('API/downloadRecordScreenshotsZipApi: articleDbId is required.');
        if (typeof showStatus === "function") showStatus('错误：缺少文献ID，无法下载截图集。', 'text-red-500', 4000);
        return null;
    }

    const apiUrl = `${backendApiUrl}/api/literature/${articleDbId}/screenshots_zip`;

    try {
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${currentAuthToken}`
                // Content-Type 不是必须的，因为GET请求通常没有body
            }
        });

        if (!response.ok) {
            // 尝试解析错误信息，如果后端返回JSON格式的错误
            try {
                const errorData = await response.json();
                throw new Error(errorData.message || `下载截图ZIP包失败 (状态: ${response.status})`);
            } catch (e) { // 如果错误不是JSON，或者解析JSON失败
                throw new Error(`下载截图ZIP包失败 (状态: ${response.status}, ${response.statusText})`);
            }
        }
        // 成功时，响应体应该是ZIP文件的blob
        const blob = await response.blob();
        if (blob.type !== 'application/zip') {
            console.warn('API/downloadRecordScreenshotsZipApi: Received content is not application/zip. Type:', blob.type);
            // 也许后端在出错时返回了非ZIP内容，例如一个JSON错误消息但状态码是200（不规范）
            // 尝试将其作为文本读取以查看错误
            const textError = await blob.text();
            throw new Error(`服务器返回的不是ZIP文件，可能是错误信息: ${textError.substring(0,100)}`);
        }
        return blob;
    } catch (error) {
        console.error('API/downloadRecordScreenshotsZipApi: Error downloading screenshots zip:', error);
        if (typeof showStatus === "function") showStatus(`下载截图ZIP包时出错: ${error.message}`, 'text-red-500', 7000);
        return null;
    }
}


/**
 * 从服务器删除指定的文献记录。
 * @param {string} articleDbId 要删除的文献记录的数据库ID。
 * @returns {Promise<boolean>} 操作是否成功。
 */
async function deleteLiteratureArticleApi(articleDbId) {
    const currentAuthToken = localStorage.getItem('authToken');
    const backendApiUrl = window.backendBaseUrl;

    if (!currentAuthToken || !backendApiUrl || !articleDbId) {
        console.error('API/deleteLiteratureArticleApi: Invalid parameters or missing auth/config.');
        if (typeof showStatus === "function") showStatus('删除失败：参数错误或配置缺失。', 'text-red-500', 4000);
        return false;
    }

    const deleteApiUrl = `${backendApiUrl}/api/literature_article/${articleDbId}`;

    try {
        const response = await fetch(deleteApiUrl, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${currentAuthToken}`,
                'Content-Type': 'application/json'
            }
        });

        const responseData = await response.json();
        if (response.ok && responseData.success) {
            if (typeof showStatus === "function") showStatus(responseData.message || '文献记录已成功从服务器删除。', 'text-green-500', 3000);
            return true;
        } else {
            throw new Error(responseData.message || `删除文献记录失败 (状态: ${response.status})`);
        }
    } catch (error) {
        console.error(`API/deleteLiteratureArticleApi: Error deleting DB ID ${articleDbId}:`, error);
        if (typeof showStatus === "function") showStatus(`删除失败: ${error.message}`, 'text-red-500', 7000);
        return false;
    }
}

async function batchDeleteLiteratureArticlesApi(idsToDelete) {
    const currentAuthToken = localStorage.getItem('authToken');
    const backendApiUrl = window.backendBaseUrl;
    if (!currentAuthToken || !backendApiUrl || !idsToDelete || idsToDelete.length === 0) {
        console.error('API/batchDeleteLiteratureArticlesApi: Invalid parameters or missing auth/config.');
        if (typeof showStatus === "function") showStatus('批量删除失败：参数错误或配置缺失。', 'text-red-500', 4000);
        return false;
    }
    try {
        const response = await fetch(`${backendApiUrl}/api/literature_articles/batch_delete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentAuthToken}`
            },
            body: JSON.stringify({ ids: idsToDelete })
        });
        const responseData = await response.json();
        if (response.ok && responseData.success) {
            if (typeof showStatus === "function") showStatus(responseData.message || `成功删除了 ${responseData.deleted_count || idsToDelete.length} 条文献。`, 'text-green-500', 3000);
            return true;
        } else {
            throw new Error(responseData.message || `批量删除文献失败 (状态: ${response.status})`);
        }
    } catch (error) {
        console.error(`API/batchDeleteLiteratureArticlesApi: Error during batch delete:`, error);
        if (typeof showStatus === "function") showStatus(`批量删除失败: ${error.message}`, 'text-red-500', 7000);
        return false;
    }
}

/**
 * 通过后端代理下载 PDF。
 * @param {string} pdfUrl 原始 PDF 的 URL。
 * @returns {Promise<Blob|null>} PDF 文件的 Blob 对象，或在失败时返回 null。
 */
async function proxyPdfDownloadApi(pdfUrl) {
    const currentAuthToken = localStorage.getItem('authToken');
    const backendApiUrl = window.backendBaseUrl;

    if (!currentAuthToken || !backendApiUrl || !pdfUrl) {
        console.error('API/proxyPdfDownloadApi: Invalid parameters or missing auth/config.');
        if (typeof showStatus === "function") showStatus('代理下载失败：参数错误或配置缺失。', 'text-red-500', 4000);
        return null;
    }

    const proxyApiUrl = `<span class="math-inline">\{backendApiUrl\}/api/proxy\-pdf?url\=</span>{encodeURIComponent(pdfUrl)}`;
    try {
        const response = await fetch(proxyApiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${currentAuthToken}`,
                'Accept': 'application/pdf' // 告诉服务器我们期望 PDF
            }
        });

        if (!response.ok) {
            const errorText = await response.text(); // 尝试读取错误信息
            throw new Error(`代理下载失败 (状态: ${response.status}): ${errorText}`);
        }

        const contentType = response.headers.get('Content-Type');
        if (!contentType || !contentType.includes('application/pdf')) {
            console.warn('Proxy download: Expected PDF, but received content type:', contentType);
            throw new Error('代理下载的文件不是 PDF 格式。');
        }

        return await response.blob();

    } catch (error) {
        console.error('API/proxyPdfDownloadApi: Error during proxy download:', error);
        if (typeof showStatus === "function") showStatus(`代理下载PDF失败: ${error.message}`, 'text-red-500', 7000);
        return null;
    }
}

/**
 * 从服务器删除指定的截图记录及其物理文件。
 * @param {string|number} screenshotId - 要删除的截图在数据库中的ID。
 * @returns {Promise<object|null>} 服务器返回的JSON响应，或在失败时返回null。
 */
async function deleteScreenshotFromServerApi(screenshotId) {
    const currentAuthToken = localStorage.getItem('authToken');
    const backendApiUrl = window.backendBaseUrl;

    if (!currentAuthToken || !backendApiUrl || !screenshotId) {
        const errorMsg = '删除截图失败：参数错误或配置缺失。';
        console.error('API/deleteScreenshotFromServerApi:', errorMsg, { screenshotId, backendApiUrl, currentAuthToken });
        if (typeof showStatus === "function") showStatus(errorMsg, 'text-red-500', 4000);
        return null; // 返回 null 表示API调用前就失败了
    }

    // *** 关键修改：使用新的RESTful API路径和DELETE方法 ***
    const deleteApiUrl = `${backendApiUrl}/api/screenshots/${screenshotId}`;

    try {
        const response = await fetch(deleteApiUrl, {
            method: 'DELETE', // *** 修改：使用 DELETE 方法 ***
            headers: {
                'Authorization': `Bearer ${currentAuthToken}`,
                'Content-Type': 'application/json' // DELETE请求可以有Content-Type，但通常没有body
            }
            // DELETE 请求通常没有请求体 (body)
        });

        const responseData = await response.json();
        if (response.ok && responseData.success) {
            // 在调用处处理成功消息，以提供更具体的上下文
            // if (typeof showStatus === "function") showStatus(responseData.message || '截图已成功从服务器删除。', 'text-green-500', 3000);
            return responseData; // 返回完整的成功响应对象
        } else {
            throw new Error(responseData.message || `从服务器删除截图失败 (状态: ${response.status})`);
        }
    } catch (error) {
        console.error(`API/deleteScreenshotFromServerApi: Error deleting screenshot (ID: ${screenshotId}) from server:`, error);
        if (typeof showStatus === "function") {
             if (error.message.includes('Failed to fetch')) {
                 showStatus(`删除截图失败: 无法连接到后端服务。`, 'text-red-500', 7000);
             } else {
                 showStatus(`删除截图失败: ${error.message}`, 'text-red-500', 7000);
             }
        }
        return null; // 返回 null 表示API调用失败
    }
}



// =====================================================================
// ▲▲▲ 新增的函数结束 ▲▲▲
// =====================================================================


// js/api.js
// ... (所有函数定义，包括 async function batchProcessAndZipApi(...) { ... } ) ...

// 在文件末尾添加这个导出块
export {
    fetchLiteratureList,
    saveFullLiteratureList,
    updateSingleLiteratureArticle,
    findPdfLinkApi,
    batchProcessAndZipApi, // <--- 现在这个函数被导出了
    deleteBatchRecordApi,
    saveScreenshotApi,
    updateScreenshotMetadataApi,
    fetchAllMyScreenshotsApi,
    fetchDashboardStats,
    fetchRecentActivity,         // <--- 添加或确认这一行
    fetchLiteratureClassificationStats,
    downloadRecordScreenshotsZipApi,
    deleteLiteratureArticleApi,
    batchDeleteLiteratureArticlesApi,
    proxyPdfDownloadApi,
    deleteScreenshotFromServerApi
};

// console.log("api.js loaded: API communication functions are available and exported."); // 可以更新一下日志



console.log("api.js loaded: API communication functions are available.");