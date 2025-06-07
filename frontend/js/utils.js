// js/utils.js

// ==========================================================================
// 1. DOM MANIPULATION & UI FEEDBACK
// ==========================================================================

/**
 * 关闭指定ID的模态框。
 * @param {string} modalId - 要关闭的模态框的ID。
 * @param {function} [onCloseCallback] - 可选的回调函数，在模态框关闭后执行。
 */
export function closeModal(modalId, onCloseCallback) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = "none";
        console.log(`[Utils] Modal with ID '${modalId}' closed.`);
        if (typeof onCloseCallback === 'function') {
            try {
                onCloseCallback();
            } catch (e) {
                console.error(`[Utils] Error executing onCloseCallback for modal '${modalId}':`, e);
            }
        }
    } else {
        console.warn(`[Utils] Attempted to close modal with ID '${modalId}', but it was not found.`);
    }
}

/**
 * 显示状态消息。
 * 依赖全局的 window.statusMessage DOM 元素。
 * @param {string} message - 要显示的消息内容 (可以包含HTML，但需谨慎确保来源安全)。
 * @param {string} styleClass - 应用于消息的Tailwind CSS类 (例如 'text-green-500')。
 * @param {number} [duration=0] - 消息显示持续时间（毫秒）。0或负数表示一直显示直到下次调用。
 */
export function showStatus(message, styleClass = 'text-gray-700', duration = 0) {
    if (!window.statusMessage || typeof window.statusMessage.innerHTML === 'undefined') {
        console.warn(`[Utils/showStatus] statusMessage element not found or invalid. Message: "${message}"`);
        // Fallback for critical messages if UI element is missing
        if (styleClass.includes('red') || styleClass.includes('error')) {
            alert(`错误: ${message.replace(/<[^>]*>?/gm, '')}`); // Strip HTML for alert
        }
        return;
    }

    // 清除之前的延时器（如果有）
    if (window.statusMessageTimeoutId) {
        clearTimeout(window.statusMessageTimeoutId);
        window.statusMessageTimeoutId = null;
    }

    window.statusMessage.innerHTML = message; // 允许HTML，调用者需确保内容安全
    window.statusMessage.className = `mb-6 text-center text-sm font-medium ${styleClass}`;
    window.statusMessage.style.display = 'block';

    if (duration > 0) {
        window.statusMessageTimeoutId = setTimeout(() => {
            if (window.statusMessage) { // 再次检查元素是否存在
                window.statusMessage.innerHTML = '';
                window.statusMessage.className = 'mb-6 text-center min-h-[20px]'; // Reset to default/placeholder class
                window.statusMessage.style.display = 'none';
            }
            window.statusMessageTimeoutId = null;
        }, duration);
    }
}

/**
 * 当用户接受免责声明后调用。
 * 依赖全局的 window.disclaimerAccepted 和 closeModal, showStatus 函数。
 */
export function closeModalAndAcceptDisclaimer() {
    window.disclaimerAccepted = true; // 更新全局状态
    localStorage.setItem('disclaimerAccepted_litfinder', 'true'); // 持久化状态

    // closeModal 和 showStatus 都是从本文件导出的，所以可以直接调用
    closeModal('disclaimerModal');
    showStatus('免责声明已接受。您现在可以处理文件了。', 'text-green-500', 3000);
}

// ==========================================================================
// 2. TEXT & STRING MANIPULATION
// ==========================================================================

/**
 * 截断文本字符串到指定的最大长度，如果超出则附加省略号。
 * @param {string | number | null | undefined} text - 要截断的文本。
 * @param {number} maxLength - 最大长度，默认为50。
 * @returns {string} 截断后的文本，或在输入为空/无效时返回 'N/A'。
 */
export function truncateText(text, maxLength = 50) {
    if (text === null || typeof text === 'undefined') {
        return 'N/A';
    }
    const strText = String(text).trim();
    if (strText === '') {
        return 'N/A';
    }
    if (strText.length > maxLength) {
        return strText.substring(0, maxLength) + '...';
    }
    return strText;
}

/**
 * 净化字符串，移除或替换文件名中的非法字符，使其适合用作文件名的一部分（用于匹配或建议）。
 * @param {string | null | undefined} filenameBase - 原始文件名基础部分。
 * @param {number} [targetLength=50] - 净化后文件名的目标最大长度。
 * @param {string} [fallbackName="document"] - 如果净化后为空或原始输入无效时使用的回退名称。
 * @returns {string} 净化后的文件名字符串。
 */
export function sanitizeFilenameForMatching(filenameBase, targetLength = 50, fallbackName = "document") {
    if (!filenameBase || typeof filenameBase !== 'string' || filenameBase.trim() === '') {
        return fallbackName;
    }
    let sanitized = filenameBase.trim();
    // 替换路径分隔符和常见非法字符为下划线
    sanitized = sanitized.replace(/[/\\]|[<>:"|?*]/g, '_');
    // 替换多个连续空格或下划线为单个下划线
    sanitized = sanitized.replace(/[\s_]+/g, '_');
    // 移除开头和结尾的下划线或点
    sanitized = sanitized.replace(/^[_.]+|[_.]+$/g, '');

    // 截断到目标长度
    if (sanitized.length > targetLength) {
        sanitized = sanitized.substring(0, targetLength);
        // 尝试在截断处寻找最后一个有意义的词（通过下划线）
        const lastUnderscore = sanitized.lastIndexOf('_');
        // 如果下划线在后半部分，则在此截断，避免切断单词中间
        if (lastUnderscore > targetLength / 2) {
            sanitized = sanitized.substring(0, lastUnderscore);
        }
        // 再次移除可能因截断产生的结尾下划线
        sanitized = sanitized.replace(/[_.]+$/g, '');
    }

    return sanitized || fallbackName; // 如果净化后为空，返回回退名称
}

/**
 * 净化字符串，使其适合用作图片文件名的一部分（更严格的字符限制）。
 * @param {string | null | undefined} namePart - 文件名的原始部分。
 * @param {number} [targetLength=50] - 净化后文件名的目标最大长度。
 * @param {string} [fallbackName="image"] - 如果净化后为空或原始输入无效时使用的回退名称。
 * @returns {string} 净化后的字符串。
 */
export function sanitizeFilenameForImage(namePart, targetLength = 50, fallbackName = "image") {
     if (!namePart || typeof namePart !== 'string' || namePart.trim() === '') {
        return fallbackName;
    }
    let sanitized = namePart.trim();
    // 允许字母数字、下划线、连字符、点。替换其他所有为下划线。
    sanitized = sanitized.replace(/[^a-zA-Z0-9_.-]/g, '_');
    // 替换多个连续下划线为单个下划线
    sanitized = sanitized.replace(/[_]+/g, '_');
    // 移除开头和结尾的下划线或点
    sanitized = sanitized.replace(/^[_.]+|[_.]+$/g, '');

    // 截断文件名（不包括扩展名，如果适用）
    // 这里假设 namePart 不包含扩展名，如果包含，则需要先分离扩展名
    if (sanitized.length > targetLength) {
        sanitized = sanitized.substring(0, targetLength);
        sanitized = sanitized.replace(/[_.]+$/g, ''); // 清理结尾
    }
    return sanitized || fallbackName;
}


/**
 * 在给定的表头数组中查找与一组可能名称匹配的表头。
 * 搜索不区分大小写，并会去除表头和可能名称两边的空格。
 * @param {Array<string>} headers - 实际的表头数组。
 * @param {Array<string>} possibleNames - 可能的表头名称数组。
 * @returns {string | null} 找到的实际表头名称 (保留原始大小写)，如果未找到则返回 null。
 */
export function findHeader(headers, possibleNames) {
    if (!Array.isArray(headers) || headers.length === 0 || !Array.isArray(possibleNames) || possibleNames.length === 0) {
        return null;
    }
    // 创建一个映射：小写、去空格的表头 -> 原始表头
    const normalizedHeaderMap = new Map();
    headers.forEach(h => {
        if (typeof h === 'string') {
            normalizedHeaderMap.set(h.toLowerCase().trim(), h);
        }
    });

    for (const name of possibleNames) {
        if (typeof name === 'string') {
            const normalizedName = name.toLowerCase().trim();
            if (normalizedHeaderMap.has(normalizedName)) {
                return normalizedHeaderMap.get(normalizedName); // 返回原始大小写的表头
            }
        }
    }
    return null;
}

/**
 * 转义CSV单元格数据，以正确处理包含逗号、双引号或换行符的字符串。
 * @param {*} cellData - 要转义的单元格数据 (将被转换为字符串)。
 * @returns {string} 转义后的CSV单元格字符串。
 */
export function escapeCsvCell(cellData) {
    if (cellData === null || typeof cellData === 'undefined') {
        return ''; // 空值或未定义值视为空字符串
    }
    const stringData = String(cellData);
    // 如果数据包含逗号、双引号或换行符，则需要用双引号包裹，并将内部的双引号替换为两个双引号。
    if (stringData.includes(',') || stringData.includes('"') || stringData.includes('\n') || stringData.includes('\r')) {
        return `"${stringData.replace(/"/g, '""')}"`;
    }
    return stringData; // 无需转义
}


// ==========================================================================
// 3. PDF VIEWER UI HELPERS (Moved from original utils.js as they are UI specific to PDF viewer components)
//    These functions are now more generic, accepting element IDs or can be adapted
//    to be called from pdfViewerCore.js or page-specific logic scripts (main_index.js, my_records_logic.js)
//    if those scripts manage their own DOM elements.
//    For true "utils", these might be too specific. Consider refactoring them into the
//    respective viewer logic files if they always operate on known suffixed IDs.
// ==========================================================================

/**
 * 更新截图列表面板切换按钮的图标和标题。
 * @param {string} buttonId - 切换按钮的 DOM ID。
 * @param {boolean} isPanelVisible - 面板当前是否可见。
 */
export function updateToggleScreenshotsPanelButton(buttonId, isPanelVisible) {
    const btn = document.getElementById(buttonId);
    if (!btn) {
        console.warn(`[Utils] updateToggleScreenshotsPanelButton: Button with ID '${buttonId}' not found.`);
        return;
    }
    if (isPanelVisible) {
        btn.innerHTML = '<i class="fas fa-chevron-right"></i>';
        btn.title = '隐藏截图列表';
    } else {
        btn.innerHTML = '<i class="fas fa-chevron-left"></i>';
        btn.title = '显示截图列表';
    }
}

/**
 * 切换PDF查看器中截图列表面板的布局（显示/隐藏）。
 * @param {string} panelId - 截图面板的 DOM ID。
 * @param {boolean} shouldBeVisible - 面板是否应该可见。
 */
export function toggleScreenshotsPanelLayout(panelId, shouldBeVisible) {
    const screenshotsColElem = document.getElementById(panelId);
    if (!screenshotsColElem) {
        console.warn(`[Utils] toggleScreenshotsPanelLayout: Panel with ID '${panelId}' not found.`);
        return;
    }

    // 这些样式最好通过添加/移除CSS类来控制，而不是直接操作style属性，以增强可维护性。
    // 例如: screenshotsColElem.classList.toggle('panel-visible', shouldBeVisible);
    // screenshotsColElem.classList.toggle('panel-hidden', !shouldBeVisible);
    // CSS:
    // .panel-visible { width: 280px; border-left: 1px solid #cbd5e0; padding: 0.5rem; opacity: 1; }
    // .panel-hidden { width: 0px; border-left: none; padding: 0; opacity: 0; overflow: hidden; }
    // 添加 transition-all duration-300 ease-in-out 到面板元素以实现平滑过渡

    if (shouldBeVisible) {
        screenshotsColElem.style.width = '280px'; // Or use a CSS variable/class
        screenshotsColElem.style.opacity = '1';
        screenshotsColElem.style.padding = '0.5rem'; // Example padding
        screenshotsColElem.style.borderLeft = '1px solid #cbd5e0'; // Example border
    } else {
        screenshotsColElem.style.width = '0px';
        screenshotsColElem.style.opacity = '0';
        screenshotsColElem.style.padding = '0';
        screenshotsColElem.style.borderLeft = 'none';
    }
}

/**
 * 移除字符串中的HTML标签。
 * @param {string | number | null | undefined} str - 输入的字符串。
 * @returns {string} 移除了HTML标签的字符串，如果输入非字符串则返回原样或空字符串。
 */
export function stripHtmlTags(str) {
    if (typeof str !== 'string') {
        return (str === null || typeof str === 'undefined') ? '' : String(str);
    }
    try {
        const doc = new DOMParser().parseFromString(str, 'text/html');
        return doc.body.textContent || "";
    } catch (e) {
        console.warn("[Utils/stripHtmlTags] Error parsing string, returning original.", e);
        return str;
    }
}


// ==========================================================================
// FINAL LOG
// ==========================================================================
console.log("utils.js (Production Grade) loaded: Utility functions are available and exported.");