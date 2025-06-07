
// js/auth.js
// import { API_BASE_URL, REGISTER_API, LOGIN_API } from './api.js'; // 原来的行
import { API_BASE_URL, REGISTER_API, LOGIN_API } from './api_config.js'; // 修改为新的配置文件名

// ...
// --- 辅助函数：显示消息 (可以根据需要在具体页面实现，或传入消息元素ID) ---
// 为了简化，我们假设每个页面（login, register）有自己的消息显示区域
function showAuthMessage(message, type, errorTextElementId = 'error-text', errorMessageContainerId = 'error-message', successMessageContainerId = 'success-message') {
    const errorTextElem = document.getElementById(errorTextElementId);
    const errorContainerElem = document.getElementById(errorMessageContainerId);
    const successContainerElem = document.getElementById(successMessageContainerId);

    if (errorContainerElem) errorContainerElem.classList.add('hidden');
    if (successContainerElem) successContainerElem.classList.add('hidden');
    if (errorTextElem) errorTextElem.textContent = '';

    if (type === 'success' && successContainerElem) {
        const successTextElem = successContainerElem.querySelector('p'); // 假设成功消息在p标签内
        if (successTextElem) successTextElem.textContent = message;
        successContainerElem.classList.remove('hidden');
    } else if (type === 'error' && errorContainerElem && errorTextElem) {
        errorTextElem.textContent = message;
        errorContainerElem.classList.remove('hidden');
    } else if (type === 'clear' && errorContainerElem && successContainerElem) {
        // Just clear, already done at the top
    } else {
        // Fallback for pages without specific success/error containers
        console.log(`AuthMessage (${type}): ${message}`);
        // alert(message); // 可以用alert作为简单替代
    }
}

// --- 核心认证函数 ---

/**
 * 处理用户注册
 * @param {Event} event - 表单提交事件
 */
export async function handleRegister(event) {
    event.preventDefault();
    const form = event.target;
    const registerButton = form.querySelector('button[type="submit"]');
    const originalButtonText = registerButton.querySelector('span')?.textContent || 'Create Account';
    const spinnerIcon = registerButton.querySelector('i');

    showAuthMessage('', 'clear', 'error-text', 'error-message', 'success-message'); // 清除旧消息

    const username = form.username.value;
    const email = form.email.value;
    const password = form.password.value;
    const confirmPassword = form['confirm-password'] ? form['confirm-password'].value : password; // confirm-password ID来自新HTML
    const termsCheckbox = form['terms-checkbox']; // terms-checkbox ID来自新HTML

    // 前端校验
    if (!username || !email || !password) {
        showAuthMessage('所有必填字段都不能为空。', 'error', 'error-text-register', 'error-message-register'); // 假设注册页有特定ID
        return;
    }
    if (password.length < 6) {
        showAuthMessage('密码长度至少为6位。', 'error', 'error-text-register', 'error-message-register');
        return;
    }
    if (form['confirm-password'] && password !== confirmPassword) {
        showAuthMessage('两次输入的密码不匹配。', 'error', 'error-text-register', 'error-message-register');
        if(form['confirm-password'].setCustomValidity) form['confirm-password'].setCustomValidity('Passwords do not match'); // 利用浏览器原生校验提示
        return;
    } else if (form['confirm-password'] && form['confirm-password'].setCustomValidity) {
        form['confirm-password'].setCustomValidity('');
    }
    if (termsCheckbox && !termsCheckbox.checked) {
         showAuthMessage('请同意服务条款和隐私政策。', 'error', 'error-text-register', 'error-message-register');
         return;
    }


    if (registerButton && spinnerIcon) {
        registerButton.disabled = true;
        registerButton.querySelector('span').textContent = 'Creating Account...';
        spinnerIcon.classList.remove('hidden');
    }

    try {
        const response = await fetch(REGISTER_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password }),
        });
        const data = await response.json();

        if (response.ok && data.success) {
            showAuthMessage(data.message + ' 即将跳转到登录页面...', 'success', 'error-text', 'error-message', 'success-message'); // 使用通用的ID
            setTimeout(() => {
                window.location.href = 'login.html'; // 确保 login.html 存在
            }, 3000);
        } else {
            showAuthMessage(data.message || '注册失败，请稍后再试。', 'error', 'error-text', 'error-message', 'success-message');
        }
    } catch (error) {
        console.error('注册请求失败:', error);
        showAuthMessage('注册请求发生网络错误，请检查您的网络连接。', 'error', 'error-text', 'error-message', 'success-message');
    } finally {
        if (registerButton && spinnerIcon) {
            registerButton.disabled = false;
            registerButton.querySelector('span').textContent = originalButtonText;
            spinnerIcon.classList.add('hidden');
        }
    }
}

/**
 * 处理用户登录
 * @param {Event} event - 表单提交事件
 */
export async function handleLogin(event) {
    event.preventDefault();
    const form = event.target;
    const loginButton = form.querySelector('button[type="submit"]'); // 假设登录按钮是表单内的submit按钮
    const originalButtonText = loginButton.querySelector('span')?.textContent || 'Sign In';
    const spinnerIcon = loginButton.querySelector('i#login-spinner'); // login-spinner ID 来自新HTML

    showAuthMessage('', 'clear', 'error-text', 'error-message'); // 清除旧消息 (登录页没有 success-message 容器)

    // 从新 login.html 获取 identifier (email) 和 password
    const identifier = form.email.value; // 新 login.html 中 email 输入框的 id 和 name 都是 'email'
    const password = form.password.value;

    if (!identifier || !password) {
        showAuthMessage('邮箱和密码都不能为空。', 'error', 'error-text', 'error-message');
        return;
    }

    if (loginButton && spinnerIcon) {
        loginButton.disabled = true;
        loginButton.querySelector('span').textContent = 'Signing In...';
        spinnerIcon.classList.remove('hidden');
    }

    try {
        const response = await fetch(LOGIN_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password }), // 后端期望 identifier 和 password
        });
        const data = await response.json();

        if (response.ok && data.success && data.token) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('username', data.username); // 存储用户名
            window.location.href = 'app_dashboard.html'; // <--- 修改跳转目标
        } else {
            showAuthMessage(data.message || '登录失败，请检查您的凭据。', 'error', 'error-text', 'error-message');
        }
    } catch (error) {
        console.error('登录请求失败:', error);
        showAuthMessage('登录请求发生网络错误，请检查您的网络连接。', 'error', 'error-text', 'error-message');
    } finally {
        if (loginButton && spinnerIcon) {
            loginButton.disabled = false;
            loginButton.querySelector('span').textContent = originalButtonText;
            spinnerIcon.classList.add('hidden');
        }
    }
}

/**
 * 检查用户是否已认证 (通过查看localStorage中是否有authToken)
 * @returns {boolean}
 */
export function isAuthenticated() {
    return !!localStorage.getItem('authToken');
}

/**
 * 检查当前页面的认证状态，如果未认证且当前页面需要认证，则重定向到登录页
 * 这个函数应该在需要登录才能访问的页面 (如 dashboard.html, my-records.html) 的JS开头调用
 */
export function checkAuthState(currentPageIdentifier = '') { // 接受一个页面标识参数
    const token = localStorage.getItem('authToken'); // isAuthenticated() 内部也是这么做的
    const currentPageFile = window.location.pathname.split('/').pop() || 'index.html';

    const publicPagesForRedirectIfLoggedIn = ['login.html', 'register.html'];
    const protectedPages = ['app_dashboard.html', 'my_records.html', 'dashboard.html']; // 'dashboard.html' 是原模板的，现在是 app_dashboard.html

    if (token) { // 用户已登录 (isAuthenticated() 返回 true)
        console.log("Auth: User is authenticated.");
        updateUserNavDisplay(); // 确保在任何已登录页面都更新导航栏

        if (publicPagesForRedirectIfLoggedIn.includes(currentPageFile)) {
            // 如果已登录用户访问登录页或注册页，重定向到应用主页
            window.location.href = 'app_dashboard.html';
            return; // 阻止后续执行
        }
        // 如果是 index.html (登陆页), dashboard.html, my-records.html, app_dashboard.html, 正常显示，UI已通过 updateUserNavDisplay 更新

    } else { // 用户未登录
        console.log(`Auth: User not authenticated. Current page: ${currentPageFile}.`);
        updateUserNavDisplay(); // 确保在任何未登录页面都更新导航栏（显示登录/注册按钮）

        if (protectedPages.includes(currentPageFile)) {
            // 如果尝试访问受保护页面但未登录，重定向到登录页
            window.location.href = 'login.html';
            return; // 阻止后续执行
        }
        // 如果是 index.html (登陆页) 或 login.html/register.html, 正常显示
    }
}
/**
 * 处理用户登出
 */
export function handleLogout() {
    const token = localStorage.getItem('authToken');
    // 可选：向后端发送登出请求，使服务器端的Token失效（如果后端支持此功能）
     //if (token && LOGOUT_API) {
       // fetch(LOGOUT_API, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }})
      // .then(() => console.log("Logged out on server"))
      //  .catch(err => console.error("Server logout error:", err));}
    localStorage.removeItem('authToken');
    localStorage.removeItem('username');
    console.log("Auth: 用户已登出。正在重定向到首页。");
    window.location.href = 'index.html'; // <--- 修改跳转目标
}

/**
 * 更新导航栏中的用户显示状态和登出按钮 (如果导航栏在各个页面是共享的)
 */
export function updateUserNavDisplay() {
    const username = localStorage.getItem('username');
    const usernameDisplayElem = document.getElementById('username-display'); // 来自新HTML的ID
    const userMenuElem = document.getElementById('user-menu'); // 用户菜单整体，来自新HTML
    const authButtonsElem = document.getElementById('auth-buttons'); // 登录/注册按钮组，来自新着陆页 index.html

    if (username && usernameDisplayElem && userMenuElem) {
        usernameDisplayElem.textContent = username;
        userMenuElem.classList.remove('hidden');
        if (authButtonsElem) authButtonsElem.classList.add('hidden'); // 隐藏登录/注册按钮组
    } else if (authButtonsElem) { // 如果在 index.html (着陆页)
        authButtonsElem.classList.remove('hidden');
        if (userMenuElem) userMenuElem.classList.add('hidden');
    }
    // 其他依赖登录状态的UI更新可以放在这里
}

/**
 * 设置导航栏用户菜单的下拉行为
 */
export function setupUserMenu() {
    const userMenuButton = document.getElementById('user-menu-button');
    const dropdownMenu = document.getElementById('dropdown-menu');
    const logoutBtn = document.getElementById('logout-btn'); // 桌面版退出按钮
    const mobileLogoutBtn = document.getElementById('mobile-logout-btn'); // 移动版退出按钮

    if (userMenuButton && dropdownMenu) {
        userMenuButton.addEventListener('click', (event) => {
            event.stopPropagation();
            // 假设 isUserMenuOpen 变量在其他地方被正确管理，或者通过切换类名来控制显示
            dropdownMenu.classList.toggle('hidden');
            userMenuButton.setAttribute('aria-expanded', !dropdownMenu.classList.contains('hidden'));
        });

        // 点击页面其他地方关闭用户菜单
        document.addEventListener('click', (event) => {
            if (!userMenuButton.contains(event.target) && !dropdownMenu.contains(event.target)) {
                dropdownMenu.classList.add('hidden');
                userMenuButton.setAttribute('aria-expanded', 'false');
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    // 为移动版退出按钮添加事件监听
    if (mobileLogoutBtn) {
        mobileLogoutBtn.addEventListener('click', handleLogout);
    }
}


// 可以在这里添加一个初始化函数，在每个页面的JS中调用，
// 或者让每个页面根据需要自行调用 isAuthenticated, checkAuthState, updateUserNavDisplay, setupUserMenu 等
// 例如，在 dashboard.html 和 my-records.html 的JS中：
// import { checkAuthState, setupUserMenu } from './auth.js';
// document.addEventListener('DOMContentLoaded', () => {
//     checkAuthState('dashboard'); // 'dashboard' 作为页面标识，可选
//     setupUserMenu();
//     // ... 其他页面专属逻辑 ...
// });

// 在 index.html (着陆页) 的JS中：
// import { isAuthenticated, updateUserNavDisplay, setupUserMenu } from './auth.js';
// document.addEventListener('DOMContentLoaded', () => {
//     if (isAuthenticated()) { // 如果已登录，也许直接跳转到dashboard或更新导航栏
//         updateUserNavDisplay();
//     } else { // 未登录，显示登录/注册按钮
//         updateUserNavDisplay(); // 也会处理隐藏用户菜单
//     }
//     setupUserMenu(); // 导航栏的用户菜单按钮行为
// });