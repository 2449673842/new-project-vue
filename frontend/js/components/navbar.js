// js/components/navbar.js

/**
 * @file 导航栏组件
 * @description 提供可复用的导航栏组件，根据用户登录状态显示不同内容。
 */

class Navbar {
    constructor() {
        this.isMenuOpen = false;        // 用于移动端菜单的展开状态
        this.isUserMenuOpen = false;    // 用于用户下拉菜单的展开状态
        this.isLoggedIn = false;        // 用户登录状态
        this.username = '';             // 用户名
    }

    /**
     * 初始化导航栏
     * @param {HTMLElement} container - 导航栏容器元素 (例如 <div id="navbar-container"></div>)
     */
    init(container) {
        if (!container) {
            console.error("Navbar init: Container element not provided.");
            return;
        }
        // 先清空容器，防止重复渲染 (例如，在页面部分更新或PJAX场景下)
        container.innerHTML = '';

        this.checkLoginStatusAndUser(); // 检查登录状态并获取用户名
        const navbarElement = this.createNavbarElement();
        container.appendChild(navbarElement);

        // 导航栏的DOM完全构建并插入到页面后，再绑定事件监听器
        this.bindEventListeners();
        this.highlightCurrentPage();

        console.log("Navbar initialized.");
    }

    /**
     * 检查登录状态并获取用户名
     */
    checkLoginStatusAndUser() {
        const token = localStorage.getItem('authToken');
        this.isLoggedIn = !!token;
        if (this.isLoggedIn) {
            this.username = localStorage.getItem('username') || '用户';
        }
    }

    /**
     * 创建导航栏的根 <nav> 元素及其内部 HTML
     * @returns {HTMLElement}
     */
    createNavbarElement() {
        const navElement = document.createElement('nav');
        // 使用现代、美观的样式，粘性定位在顶部
        navElement.className = 'bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-50 border-b border-gray-200';

        // 根据登录状态动态构建内部HTML
        navElement.innerHTML = `
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex justify-between items-center h-16">
                    <div class="flex items-center space-x-6">
                        <a href="index.html" class="text-2xl font-bold text-blue-600 hover:text-blue-700 transition-colors">
                            <i class="fas fa-book-reader mr-2"></i>文献助手
                        </a>
                        <div class="hidden md:flex md:space-x-1 items-center">
                            ${this.isLoggedIn ? this.getAuthenticatedDesktopNavLinks() : this.getPublicDesktopNavLinks()}
                        </div>
                    </div>

                    <div class="flex items-center space-x-3">
                        ${this.isLoggedIn ? this.getUserMenuHTML() : this.getAuthButtonsHTML()}
                        <div class="flex items-center md:hidden">
                            <button type="button" class="nav-icon-btn" id="mobile-menu-button" aria-expanded="false" aria-controls="mobile-menu">
                                <span class="sr-only">打开主菜单</span>
                                <i class="fas fa-bars text-xl"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="md:hidden hidden bg-white border-t border-gray-200 shadow-md" id="mobile-menu">
                <div class="px-2 pt-2 pb-3 space-y-1 sm:px-3">
                    ${this.isLoggedIn ? this.getAuthenticatedMobileNavLinks() : this.getPublicMobileNavLinks()}
                </div>
                ${this.isLoggedIn ? `
                    <div class="pt-4 pb-3 border-t border-gray-200">
                        <div class="flex items-center px-5">
                            <div class="flex-shrink-0">
                                <div class="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white text-lg">
                                    <i class="fas fa-user"></i>
                                </div>
                            </div>
                            <div class="ml-3">
                                <div class="text-base font-medium text-gray-800">${this.username}</div>
                                </div>
                        </div>
                        <div class="mt-3 px-2 space-y-1">
                            <a href="profile.html" class="mobile-nav-link">
                                <i class="fas fa-user-cog mr-2 w-5 text-center"></i>个人中心
                            </a>
                            <button id="mobile-logout-btn" class="mobile-nav-link text-red-600 w-full text-left">
                                <i class="fas fa-sign-out-alt mr-2 w-5 text-center"></i>退出登录
                            </button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
        return navElement;
    }

    /**
     * 获取已登录用户在桌面端显示的导航链接 HTML
     * @returns {string} HTML字符串
     */
    getAuthenticatedDesktopNavLinks() {
        return `
            <a href="app_dashboard.html" class="nav-link"><i class="fas fa-tachometer-alt mr-1"></i>仪表盘</a>
            <a href="my_records.html" class="nav-link"><i class="fas fa-folder-open mr-1"></i>我的记录</a>
            <a href="screenshot_manager.html" class="nav-link"><i class="fas fa-camera mr-1"></i>截图管理</a>
            `;
    }

    /**
     * 获取未登录（公共）用户在桌面端显示的导航链接 HTML
     * @returns {string} HTML字符串
     */
    getPublicDesktopNavLinks() {
        // 确保这些链接指向 index.html 上的锚点或对应页面
        return `
            <a href="index.html#features" class="nav-link">特色功能</a>
            <a href="index.html#pricing" class="nav-link">价格方案</a>
            <a href="index.html#about" class="nav-link">关于我们</a>
        `;
    }

    /**
     * 获取已登录用户在移动端菜单显示的导航链接 HTML
     * @returns {string} HTML字符串
     */
    getAuthenticatedMobileNavLinks() {
        return `
            <a href="app_dashboard.html" class="mobile-nav-link"><i class="fas fa-tachometer-alt mr-2 w-5 text-center"></i>仪表盘</a>
            <a href="my_records.html" class="mobile-nav-link"><i class="fas fa-folder-open mr-2 w-5 text-center"></i>我的记录</a>
            <a href="screenshot_manager.html" class="mobile-nav-link"><i class="fas fa-camera mr-2 w-5 text-center"></i>截图管理</a>
        `;
    }

    /**
     * 获取未登录（公共）用户在移动端菜单显示的导航链接 HTML
     * @returns {string} HTML字符串
     */
    getPublicMobileNavLinks() {
        return `
            <a href="index.html#features" class="mobile-nav-link">特色功能</a>
            <a href="index.html#pricing" class="mobile-nav-link">价格方案</a>
            <a href="index.html#about" class="mobile-nav-link">关于我们</a>
            <hr class="my-2 border-gray-200">
            <a href="login.html" class="mobile-nav-link text-blue-600">登录</a>
            <a href="register.html" class="mobile-nav-link bg-blue-500 text-white hover:bg-blue-600">立即开始</a>
        `;
    }


    /**
     * 获取已登录用户的用户菜单 HTML (包含头像、用户名、下拉菜单)
     * @returns {string} HTML字符串
     */
    getUserMenuHTML() {
        console.log("[Navbar Debug] getUserMenuHTML called. this.isLoggedIn:", this.isLoggedIn, "this.username:", this.username);
        return `
            <button type="button" class="nav-icon-btn mr-1" id="notification-btn" aria-label="查看通知">
                <i class="fas fa-bell"></i>
                <span class="notification-badge">3</span>
            </button>

            <div class="relative">
                <button type="button" class="flex items-center space-x-2 p-1 rounded-full hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500" id="user-menu-button" aria-expanded="false" aria-haspopup="true">
                    <span class="sr-only">打开用户菜单</span>
                    <div class="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm">
                        ${this.username ? this.username.substring(0, 1).toUpperCase() : '<i class="fas fa-user"></i>'}
                    </div>
                    <span class="hidden lg:inline-block text-sm text-gray-700 font-medium" id="nav-username">${this.username}</span>
                    <i class="fas fa-chevron-down text-xs text-gray-500 hidden lg:inline-block"></i>
                </button>

                <div class="hidden origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none"
                     id="user-menu" role="menu" aria-orientation="vertical" aria-labelledby="user-menu-button" tabindex="-1">
                    <div class="py-1" role="none">
                        <div class="px-4 py-3">
                            <p class="text-sm text-gray-900 font-medium">Hi, ${this.username}</p>
                        </div>
                        
                        <a href="profile.html" class="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 w-full text-left" role="menuitem" tabindex="-1">
                            <i class="fas fa-user-cog mr-3 text-gray-400 group-hover:text-gray-500" style="width: 1.25rem; text-align: center;"></i>
                            <span>个人中心</span>
                        </a>
                        <button id="logout-btn" class="flex items-center px-4 py-2 text-sm text-red-600 hover:bg-gray-100 hover:text-red-700 w-full text-left" role="menuitem" tabindex="-1">
                            <i class="fas fa-sign-out-alt mr-3 text-red-400 group-hover:text-red-500" style="width: 1.25rem; text-align: center;"></i>
                            <span>退出登录</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 获取未登录用户的认证按钮 HTML (登录和注册)
     * @returns {string} HTML字符串
     */
    getAuthButtonsHTML() {
        return `
            <div class="flex items-center space-x-2">
                <a href="login.html" class="modern-btn modern-btn-secondary text-sm">登录</a>
                <a href="register.html" class="modern-btn modern-btn-primary text-sm">注册</a>
            </div>
        `;
    }

    /**
     * 为导航栏中的交互元素绑定事件监听器
     */
    bindEventListeners() {
        // 移动端菜单按钮
        const mobileMenuButton = document.getElementById('mobile-menu-button');
        const mobileMenu = document.getElementById('mobile-menu');
        
        if (mobileMenuButton && mobileMenu) {
            mobileMenuButton.addEventListener('click', () => {
                this.isMenuOpen = !this.isMenuOpen;
                mobileMenu.classList.toggle('hidden', !this.isMenuOpen);
                mobileMenuButton.setAttribute('aria-expanded', this.isMenuOpen);
            });
        }

        // 用户菜单按钮
        const userMenuButton = document.getElementById('user-menu-button');
        const userMenu = document.getElementById('user-menu');
        
        if (userMenuButton && userMenu) {
            userMenuButton.addEventListener('click', () => {
                this.isUserMenuOpen = !this.isUserMenuOpen;
                userMenu.classList.toggle('hidden', !this.isUserMenuOpen);
                userMenuButton.setAttribute('aria-expanded', this.isUserMenuOpen);
            });

            // 点击外部关闭用户菜单
            document.addEventListener('click', (event) => {
                if (!userMenuButton.contains(event.target) && !userMenu.contains(event.target)) {
                    this.isUserMenuOpen = false;
                    userMenu.classList.add('hidden');
                    userMenuButton.setAttribute('aria-expanded', 'false');
                }
            });
        }

        // 退出登录按钮
        const logoutBtn = document.getElementById('logout-btn');
        const mobileLogoutBtn = document.getElementById('mobile-logout-btn');
        
        const handleLogout = () => {
            localStorage.removeItem('authToken');
            localStorage.removeItem('username');
            window.location.href = 'index.html';
        };

        if (logoutBtn) {
            logoutBtn.addEventListener('click', handleLogout);
        }
        if (mobileLogoutBtn) {
            mobileLogoutBtn.addEventListener('click', handleLogout);
        }
    }

    /**
     * 高亮当前页面在导航栏中对应的链接
     */
    highlightCurrentPage() {
        const currentPath = window.location.pathname.split('/').pop() || 'index.html';
        // 桌面端导航链接
        const desktopNavLinks = document.querySelectorAll('nav .nav-link');
        desktopNavLinks.forEach(link => {
            const href = link.getAttribute('href');
            // 精确匹配或特殊处理首页 (index.html 可以匹配 href="app_dashboard.html" 如果那是登录后的主页)
            if (href) {
                const linkPage = href.split('/').pop().split('#')[0]; // 获取文件名部分
                if (linkPage === currentPath || (currentPath === 'index.html' && linkPage === 'app_dashboard.html' && this.isLoggedIn)) {
                    link.classList.add('active');
                } else if (href.startsWith('index.html#') && currentPath === 'index.html' && window.location.hash === href.substring(href.indexOf('#'))) {
                    link.classList.add('active'); // 匹配锚点
                }
                else {
                    link.classList.remove('active');
                }
            }
        });

        // 移动端导航链接
        const mobileNavLinks = document.querySelectorAll('#mobile-menu .mobile-nav-link');
        mobileNavLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
                const linkPage = href.split('/').pop().split('#')[0];
                if (linkPage === currentPath || (currentPath === 'index.html' && linkPage === 'app_dashboard.html' && this.isLoggedIn)) {
                    link.classList.add('active');
                } else if (href.startsWith('index.html#') && currentPath === 'index.html' && window.location.hash === href.substring(href.indexOf('#'))) {
                    link.classList.add('active');
                }
                else {
                    link.classList.remove('active');
                }
            }
        });
    }
}

// 标准的 ES6 模块导出方式
export { Navbar };

// 如果仍然需要在某些非模块化脚本中通过 window.Navbar 访问（不推荐长期做法）
// 可以在调用 Navbar 的主脚本 (如 main_index.js 或页面的内联 <script type="module">) 中，
// 在 import Navbar 之后，显式将其挂载到 window:
// import { Navbar } from './components/navbar.js';
// window.Navbar = Navbar; // 仅作为过渡或特殊情况处理