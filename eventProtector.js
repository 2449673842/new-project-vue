/**
 * 事件监听器保护器
 * 防止事件监听器被覆盖或移除
 */

// 保存原始的事件监听器方法
const originalAddEventListener = EventTarget.prototype.addEventListener;
const originalRemoveEventListener = EventTarget.prototype.removeEventListener;

// 存储所有添加的事件监听器
const eventListeners = new WeakMap();

// 初始化事件保护
export function initEventProtection() {
    console.log('初始化事件保护...');
    
    // 重写addEventListener
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (!eventListeners.has(this)) {
            eventListeners.set(this, new Map());
        }
        const listeners = eventListeners.get(this);
        if (!listeners.has(type)) {
            listeners.set(type, new Set());
        }
        listeners.get(type).add(listener);
        return originalAddEventListener.call(this, type, listener, options);
    };
    
    // 重写removeEventListener
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
        const listeners = eventListeners.get(this);
        if (listeners && listeners.has(type)) {
            listeners.get(type).delete(listener);
        }
        return originalRemoveEventListener.call(this, type, listener, options);
    };
    
    // 添加基础事件监听器
    document.querySelectorAll('button, a, [role="button"], [tabindex="0"]').forEach(element => {
        const originalOnClick = element.getAttribute('onclick');
        if (originalOnClick) {
            element.removeAttribute('onclick');
            element.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                    new Function(originalOnClick.replace(/^javascript:/, '')).call(element);
                } catch (error) {
                    console.error('执行点击事件时出错:', error);
                }
            });
        }
    });
    
    // 添加全局点击事件调试
    document.addEventListener('click', (e) => {
        console.log('点击事件触发:', e.target);
        console.log('元素样式:', window.getComputedStyle(e.target));
    }, true);
    
    console.log('事件保护初始化完成');
}

// 恢复原始事件监听器方法
export function restoreEventListeners() {
    EventTarget.prototype.addEventListener = originalAddEventListener;
    EventTarget.prototype.removeEventListener = originalRemoveEventListener;
    console.log('事件监听器已恢复');
} 