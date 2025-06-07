/**
 * 脚本加载器
 * 处理在不同环境下（本地文件/HTTP服务器）的脚本加载
 */

// 动态加载脚本
export function loadScript(src, type = 'text/javascript') {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        // 根据运行环境调整脚本路径
        script.src = window.isLocalServer ? src : window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + '/' + src;
        script.type = type;
        script.onload = resolve;
        script.onerror = (e) => {
            console.error(`加载脚本失败: ${src}`, e);
            reject(e);
        };
        document.head.appendChild(script);
    });
}

// 按顺序加载所有必需的脚本
export async function loadAllScripts() {
    const scripts = [
        {src: 'js/components/navbar.js', type: 'module'},
        {src: 'js/auth.js', type: 'module'},
        {src: 'js/config.js'},
        {src: 'js/utils.js'},
        {src: 'js/api.js', type: 'module'},
        {src: 'js/dataManager.js', type: 'module'},
        {src: 'js/fileProcessing.js', type: 'module'},
        {src: 'js/pdfViewerCore.js'},
        {src: 'js/screenshotManager.js'},
        {src: 'js/uiHandlers.js'},
        {src: 'js/batchOperations.js'},
        {src: 'js/process.js', type: 'module'}
    ];
    
    for (const script of scripts) {
        try {
            await loadScript(script.src, script.type);
            console.log(`成功加载脚本: ${script.src}`);
        } catch (error) {
            console.error(`加载脚本失败: ${script.src}`, error);
            throw error;
        }
    }
}

// 初始化应用
export async function initializeApp() {
    try {
        console.log('开始初始化应用...');
        await loadAllScripts();
        
        // 导入必要的模块
        const { Navbar } = await import('../js/components/navbar.js');
        const { initProcessHandlers, initSelectAllHandler } = await import('./process.js');
        
        // 初始化导航栏
        const navbar = new Navbar();
        navbar.init(document.getElementById('navbar-container'));
        
        // 初始化其他功能
        initProcessHandlers();
        initSelectAllHandler();
        
        // 获取用户信息
        const username = localStorage.getItem('username');
        if (username) {
            const userGreeting = document.getElementById('user-greeting');
            if (userGreeting) {
                userGreeting.textContent = username;
            }
        }
        
        // 检查登录状态
        const authToken = localStorage.getItem('authToken');
        if (!authToken) {
            window.location.href = 'login.html';
            return;
        }
        
        console.log('应用初始化完成');
    } catch (error) {
        console.error('应用初始化失败:', error);
        alert('页面加载失败，请刷新重试');
    }
} 