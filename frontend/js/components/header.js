// js/components/header.js

/**
 * @file 通用头部处理逻辑
 * @description 设置页面标题和执行认证检查。
 */

// Header 类依赖于 auth.js 中的 checkAuthState 函数
// 我们应该通过 import 来明确这个依赖
import { checkAuthState, isAuthenticated } from '../auth.js'; // 假设 auth.js 在上一级 js/ 目录

class Header {
    /**
     * 初始化页面头部相关的逻辑
     * @param {string} title - 页面标题 (例如 "仪表盘", "登录")
     * @param {boolean} requiresAuth - 当前页面是否需要用户登录才能访问
     */
    static init(title, requiresAuth = false) {
        console.log(`Header.init called with title: "${title}", requiresAuth: ${requiresAuth}`);

        // 1. 设置页面标题
        if (title) {
            document.title = `${title} - 文献助手`;
        } else {
            document.title = '文献助手'; // 默认标题
        }

        // 2. 如果页面需要登录验证，则执行检查
        // checkAuthState 函数会处理未登录时重定向到登录页的逻辑
        if (requiresAuth) {
            console.log(`Header.init: Page requires authentication. Calling checkAuthState.`);
            if (typeof checkAuthState === 'function') {
                checkAuthState(title); // 可以传递页面标识符给 checkAuthState
                                     // checkAuthState 内部会判断是否已登录并处理重定向
            } else {
                console.error("Header.init: checkAuthState function is not available or not imported correctly from auth.js.");
                // 作为一个备用方案，如果 checkAuthState 导入失败，可以进行简单的本地 token 检查并重定向
                // 但这不如下面的 isAuthenticated() 检查，并且 checkAuthState 本身就包含这个逻辑
                if (!localStorage.getItem('authToken')) {
                     console.warn("Header.init: Fallback - No authToken found, redirecting to login.html");
                     window.location.href = 'login.html';
                     return; // 必须 return，阻止后续执行
                }
            }
        }

        // 3. 导航栏的初始化应该在页面的主脚本 (如 main_index.js 或内联模块脚本) 的
        //    DOMContentLoaded 事件中进行，而不是在这里。
        //    Header.init 的职责不应包括初始化 Navbar。
        //    Navbar 的初始化通常是：
        //    import { Navbar } from './components/navbar.js';
        //    const navbarContainer = document.getElementById('navbar-container');
        //    if (navbarContainer) { new Navbar().init(navbarContainer); }

        console.log(`Header.init for "${title}" completed.`);
    }
}

// 标准的 ES6 模块导出
export { Header };

// 【移除】之前用于全局挂载的逻辑，因为我们期望通过 import 使用 Header：
// if (typeof module !== 'undefined' && module.exports) {
//     module.exports = Header;
// } else {
//     window.Header = Header;
// }