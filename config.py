# backend/config.py
import os
import logging

# 配置一个简单的日志记录器，以便在Flask app的logger完全可用前记录配置加载信息
config_logger = logging.getLogger("app_config_loader")
if not config_logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    config_logger.addHandler(handler)
    config_logger.setLevel(logging.INFO)

class Config:
    """基础配置类"""
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = os.environ.get('SECRET_KEY') # 优先环境变量
    # --- 新增：后端列映射常量 ---
    APP_BACKEND_COLUMN_MAPPING = {
        'title': ['Article Title', 'Title', '标题', '篇名'],
        'authors': ['Authors', 'Author Full Names', '作者'],
        'year': ['Publication Year', 'Year', '年份', '出版年份'],
        # 'source_publication' 是模型字段名，前端或导入文件可能用 'source' 等
        'source_publication': ['Source Title', 'Journal', '期刊', '来源', '刊名', 'Source'],
        'doi': ['DOI', 'doi']
    }

    # --- 新增结束 ---
    # --- 新增：应用路径常量 ---
    # 这些路径通常相对于应用实例的根目录或项目根目录。
    # 为了与您当前 app2.py 中的定义保持一致，我们先用相对名称。
    # 在 app2.py 中，您可能需要确保这些路径在 app 创建后被正确地转换为绝对路径并存储，
    # 或者直接在这里定义为基于某个基准路径的绝对路径。
    # 为简单起见，我们先直接定义这些值，并假设 app2.py 在需要时会处理路径解析。

    # 获取当前 config.py 文件所在的目录 (即 backend 目录)
    _BACKEND_DIR = os.path.abspath(os.path.dirname(__file__))


    ARTICLE_DATA_ROOT_DIR = os.path.join(_BACKEND_DIR, "literature_screenshots_data")
    BATCH_TEMP_ROOT_DIR = os.path.join(_BACKEND_DIR, "batch_processing_temp")
    ZIPPED_FILES_DIR = os.path.join(_BACKEND_DIR, "zipped_downloads")
    DOWNLOAD_RECORDS_FILE = os.path.join(_BACKEND_DIR, "download_records.json")

    # --- 新增结束 ---

    @staticmethod
    def init_app(app):
        pass

class DevelopmentConfig(Config):
    """开发环境特定配置"""
    DEBUG = True
    SQLALCHEMY_DATABASE_URI = os.environ.get('DEV_DATABASE_URL') or \
        'sqlite:///litfinder_main_dev.db'

    CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

    if not Config.SECRET_KEY:
        SECRET_KEY = 'DEV_ONLY_!@#$_VERY_COMPLEX_AND_RANDOM_STRING_FOR_FLASK_!@#$'
        config_logger.warning(
            "开发模式警告：环境变量 SECRET_KEY 未设置。正在使用固定的开发密钥。"
        )
    else:
        config_logger.info("开发模式：SECRET_KEY 已从环境变量加载。")

    _my_api_email_env_dev = os.environ.get("MY_API_EMAIL")
    if _my_api_email_env_dev and _my_api_email_env_dev.strip() and \
       "YOUR_EMAIL@example.com" not in _my_api_email_env_dev and \
       "example.com" not in _my_api_email_env_dev:
        MY_EMAIL_FOR_APIS = _my_api_email_env_dev
        config_logger.info(f"开发模式：MY_EMAIL_FOR_APIS 已从环境变量配置。 (预览: "
                           f"{_my_api_email_env_dev[:3]}...{_my_api_email_env_dev.split('@')[1] if '@' in _my_api_email_env_dev else ''})")
    else:
        MY_EMAIL_FOR_APIS = "DEBUG_MODE_YOUR_EMAIL@example.com"
        config_logger.warning(
            f"开发模式警告：环境变量 MY_API_EMAIL 未设置或为占位符。"
            f"将使用调试模式默认邮箱: '{MY_EMAIL_FOR_APIS}'。"
        )

    _sci_hub_domains_env_dev = os.environ.get("APP_SCI_HUB_DOMAINS")
    _default_sci_hub_domains_dev = [
        "https://sci-hub.se", "https://sci-hub.st", "https://sci-hub.ru"
    ]
    if _sci_hub_domains_env_dev:
        _parsed_domains_dev = [domain.strip() for domain in _sci_hub_domains_env_dev.split(',') if domain.strip()]
        if _parsed_domains_dev:
            SCI_HUB_DOMAINS = _parsed_domains_dev
            config_logger.info(f"开发模式：Sci-Hub 域名已从环境变量 APP_SCI_HUB_DOMAINS 加载: {SCI_HUB_DOMAINS}")
        else:
            SCI_HUB_DOMAINS = _default_sci_hub_domains_dev
            config_logger.warning(f"开发模式警告：环境变量 APP_SCI_HUB_DOMAINS 内容无效，将使用默认域名: {SCI_HUB_DOMAINS}")
    else:
        SCI_HUB_DOMAINS = _default_sci_hub_domains_dev
        config_logger.info(f"开发模式：环境变量 APP_SCI_HUB_DOMAINS 未设置，将使用默认域名: {SCI_HUB_DOMAINS}")
    if not SCI_HUB_DOMAINS: SCI_HUB_DOMAINS = ["https://sci-hub.se"]


class ProductionConfig(Config):
    """生产环境特定配置"""
    DEBUG = False
    # 在类定义时，只尝试获取环境变量，不在此处 raise Error
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL')
    SECRET_KEY = os.environ.get('SECRET_KEY') # 如果基类已加载，这里会继承

    # 确保生产配置的SECRET_KEY不是从基类的硬编码默认值继承（如果基类有的话）
    # 并且如果环境变量未设置，其值为 None
    if Config.SECRET_KEY == 'default_hardcoded_secret_key_for_config_class' and not os.environ.get('SECRET_KEY'):
         SECRET_KEY = None # 强制为 None 如果环境变量未设且基类是硬编码
    elif os.environ.get('SECRET_KEY'):
        SECRET_KEY = os.environ.get('SECRET_KEY') # 确保优先使用环境变量
        config_logger.info("生产模式：SECRET_KEY 已从环境变量加载。")
    else: # 环境变量未设置，基类也未提供（或提供了不应在生产中使用的默认值）
        SECRET_KEY = None


    _my_api_email_env_prod = os.environ.get("MY_API_EMAIL")
    if _my_api_email_env_prod and _my_api_email_env_prod.strip() and \
       "example.com" not in _my_api_email_env_prod:
        MY_EMAIL_FOR_APIS = _my_api_email_env_prod
        config_logger.info(f"生产模式：MY_EMAIL_FOR_APIS 已从环境变量配置。 (预览: "
                           f"{_my_api_email_env_prod[:3]}...{_my_api_email_env_prod.split('@')[1] if '@' in _my_api_email_env_prod else ''})")
    else:
        MY_EMAIL_FOR_APIS = None
        config_logger.warning( # 改为警告，让应用能启动，但在app2.py中检查时可以决定是否中止
            "生产环境配置问题：环境变量 MY_API_EMAIL 未设置有效值或缺失。"
            "依赖此邮箱的外部API功能可能受限。"
        )

    _sci_hub_domains_env_prod = os.environ.get("APP_SCI_HUB_DOMAINS")
    _default_sci_hub_domains_prod = [] # 生产环境默认不提供Sci-Hub域名，强制通过环境变量配置
    if _sci_hub_domains_env_prod:
        _parsed_domains_prod = [domain.strip() for domain in _sci_hub_domains_env_prod.split(',') if domain.strip()]
        if _parsed_domains_prod:
            SCI_HUB_DOMAINS = _parsed_domains_prod
            config_logger.info(f"生产模式：Sci-Hub 域名已从环境变量 APP_SCI_HUB_DOMAINS 加载: {SCI_HUB_DOMAINS}")
        else:
            SCI_HUB_DOMAINS = _default_sci_hub_domains_prod
            config_logger.warning(f"生产模式警告：环境变量 APP_SCI_HUB_DOMAINS 内容无效，Sci-Hub功能将受限。")
    else:
        SCI_HUB_DOMAINS = _default_sci_hub_domains_prod
        config_logger.warning(f"生产模式警告：环境变量 APP_SCI_HUB_DOMAINS 未设置，Sci-Hub功能将受限。")


config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig
}