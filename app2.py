# backend/app2.py
import os
import logging  # 用于 Flask app logger 完全配置前的早期日志记录
from flask import Flask
from flask_cors import CORS

# 从我们创建的模块中导入
from config import config as app_configs  # 重命名导入的 config 字典以避免名称冲突
from models import db  # 从 models.py 导入 SQLAlchemy 实例
# utils.py 中的函数通常在蓝图或需要它们的地方按需导入，而不是在 app.py 全局导入所有
# 但如果 app2.py 自身（例如 CLI 命令或特定钩子）需要，则可以导入

# 导入所有蓝图
from auth_views import auth_bp
from literature_views import literature_bp
from screenshot_views import screenshot_bp
from batch_views import batch_bp
from user_stats_views import user_stats_bp  # 使用直接导入，而非相对导入
from main_views import main_bp  # 使用直接导入，而非相对导入


# --- 不应再在此处定义全局 app 实例或全局常量如 ARTICLE_DATA_ROOT_DIR 等 ---
# --- BACKEND_COLUMN_MAPPING, REQUEST_SESSION, 路径常量等已移至 config.py 或 utils.py ---

def create_app(config_name=None):
    """
    应用工厂函数。
    创建并配置Flask应用实例。
    """
    if config_name is None:
        config_name = os.environ.get('FLASK_CONFIG') or 'default'

    app = Flask(__name__)  # 在工厂内部创建 Flask 应用实例

    # 1. 从配置对象加载配置
    try:
        app.config.from_object(app_configs[config_name])
        # 配置加载后，app.logger 才完全可用
        app.logger.info(f"应用配置已从 '{config_name}' ({app_configs[config_name].__name__}) 成功加载。")
    except KeyError:
        # 如果 FLASK_CONFIG 指定了一个无效的名称，回退到默认配置并记录错误
        logging.error(f"配置名称 '{config_name}' 无效。将使用 'default' 配置。", exc_info=True)  # 使用标准logging
        config_name = 'default'
        app.config.from_object(app_configs[config_name])
        app.logger.info(f"应用配置已从 'default' ({app_configs[config_name].__name__}) 加载。")

    # (可选) 调用配置对象中的 init_app (如果Config类中有具体实现)
    # app_configs[config_name].init_app(app)

    # 2. 生产环境关键配置项运行时检查
    if config_name == 'production':
        if not app.config.get('SQLALCHEMY_DATABASE_URI'):
            app.logger.critical("生产环境致命错误：SQLALCHEMY_DATABASE_URI 未配置！")
            raise ValueError("生产环境配置错误：数据库URI未设置。")
        if not app.config.get('SECRET_KEY') or \
                app.config.get('SECRET_KEY') == app_configs['development'].SECRET_KEY or \
                app.config.get('SECRET_KEY') == 'default_hardcoded_secret_key_for_config_class':
            app.logger.critical("生产环境致命错误：SECRET_KEY 未配置或不安全！")
            raise ValueError("生产环境配置错误：应用密钥未设置或不安全。")
        if not app.config.get('MY_EMAIL_FOR_APIS'):
            app.logger.error("生产环境错误：MY_EMAIL_FOR_APIS 未配置，相关API功能可能失败。")
        if not app.config.get('SCI_HUB_DOMAINS'):
            app.logger.warning("生产环境警告：APP_SCI_HUB_DOMAINS 未有效配置，Sci-Hub相关功能可能受限。")

    # 3. 初始化Flask扩展
    db.init_app(app)  # 将 SQLAlchemy 实例与 app 关联



    # 4. 注册蓝图
    app.register_blueprint(auth_bp)
    app.register_blueprint(literature_bp)
    app.register_blueprint(screenshot_bp)
    app.register_blueprint(batch_bp)
    app.register_blueprint(user_stats_bp)
    app.register_blueprint(main_bp)
    app.logger.info("所有蓝图已成功注册。")

    # 5. 创建必要的应用目录 (使用从 app.config 获取的路径)
    required_dirs = [
        app.config.get('ARTICLE_DATA_ROOT_DIR'),
        app.config.get('BATCH_TEMP_ROOT_DIR'),
        app.config.get('ZIPPED_FILES_DIR')
    ]
    for dir_path in required_dirs:
        if dir_path:  # 确保路径配置存在
            if not os.path.exists(dir_path):
                try:
                    os.makedirs(dir_path, exist_ok=True)
                    app.logger.info(f"应用目录已创建 (如果不存在): '{dir_path}'")
                except OSError as e:
                    app.logger.error(f"创建应用目录 '{dir_path}' 失败: {e}", exc_info=True)
            else:
                app.logger.debug(f"应用目录已存在: '{dir_path}'")
        else:
            app.logger.warning(f"路径配置项缺失，无法创建相关目录 (检查config.py)。")

    # --- 移除 app2.py 中全局的 DIRECTORY SETUP 循环 ---
    # --- 因为该逻辑已移入 create_app() 并使用 app.config ---

    # 6. (可选) 定义Flask CLI命令，例如用于初始化数据库
    @app.cli.command("init-db")
    def init_db_command():
        """
        (仅限开发/测试) 清除并使用 SQLAlchemy模型重新初始化数据库表。
        在生产中，应始终使用 Alembic 迁移。
        """
        if app.debug:  # 强烈建议只在调试模式下允许此操作
            db_uri = app.config.get('SQLALCHEMY_DATABASE_URI')
            db_file_path = None
            if db_uri and db_uri.startswith('sqlite:///'):
                db_file_path = db_uri.replace('sqlite:///', '', 1)
                # 如果是相对路径，转换为基于应用根目录的绝对路径
                if not os.path.isabs(db_file_path):
                    db_file_path = os.path.join(app.root_path, db_file_path)

            if db_file_path and os.path.exists(db_file_path):
                app.logger.info(f"开发模式：准备通过 init-db 命令删除旧数据库文件 '{db_file_path}'...")
                try:
                    os.remove(db_file_path)
                    app.logger.info(f"开发模式：旧数据库文件 '{db_file_path}' 已删除。")
                except OSError as e:
                    app.logger.error(f"开发模式：删除数据库文件 '{db_file_path}' 失败: {e}", exc_info=True)
                    return

            with app.app_context():  # 确保在应用上下文中执行
                db.create_all()
            # (可选) 在通过 db.create_all() 创建表后，将Alembic版本标记为最新
            # from alembic.config import Config as AlembicConfig
            # from alembic import command
            # alembic_cfg = AlembicConfig("alembic.ini") # 确保alembic.ini路径正确
            # command.stamp(alembic_cfg, "head")
            # app.logger.info("开发模式：数据库已通过 db.create_all() 重新初始化，并已使用 Alembic stamp head。")
            app.logger.info("开发模式：数据库已通过 db.create_all() 重新初始化。")
        else:
            app.logger.warning("init-db 命令仅应在开发模式下使用，且当前未执行。")

    app.logger.info(f"Flask 应用 '{app.name}' (模式: {config_name}) 创建并配置完成。")
    return app


# --- 主执行块 ---
if __name__ == '__main__':
    # 通过工厂函数创建应用实例
    app = create_app(os.environ.get('FLASK_CONFIG') or 'default')

    # --- 移除旧的 init_db_tables() 的直接调用 ---
    # 数据库模式现在主要由 Alembic 管理 (`alembic upgrade head`)

    # 记录最终加载的应用配置信息 (用于调试和确认)
    app.logger.info(f"--- 应用启动，最终有效配置如下 ---")
    app.logger.info(f"运行模式 (来自 FLASK_CONFIG 或默认): '{os.environ.get('FLASK_CONFIG') or 'default'}'")
    app.logger.info(f"Flask 调试模式 (app.debug): {app.debug}")
    app.logger.info(f"数据库URI: {app.config.get('SQLALCHEMY_DATABASE_URI')}")
    # 更安全的 SECRET_KEY 日志
    secret_key_status = "已设置"
    if not app.config.get('SECRET_KEY') or \
            app.config.get('SECRET_KEY') == app_configs['development'].SECRET_KEY or \
            app.config.get('SECRET_KEY') == 'default_hardcoded_secret_key_for_config_class':
        secret_key_status = "否或为不安全的开发/默认密钥 - 生产环境风险!"
    app.logger.info(f"SECRET_KEY 状态: {secret_key_status}")
    app.logger.info(f"API邮箱 (MY_EMAIL_FOR_APIS): {app.config.get('MY_EMAIL_FOR_APIS')}")
    app.logger.info(f"Sci-Hub域名 (SCI_HUB_DOMAINS): {app.config.get('SCI_HUB_DOMAINS')}")
    app.logger.info(f"截图存储根目录: {app.config.get('ARTICLE_DATA_ROOT_DIR')}")
    app.logger.info(f"批量ZIP临时存储: {app.config.get('BATCH_TEMP_ROOT_DIR')}")
    app.logger.info(f"批量ZIP最终存储: {app.config.get('ZIPPED_FILES_DIR')}")
    app.logger.info(f"下载记录文件: {app.config.get('DOWNLOAD_RECORDS_FILE')}")
    app.logger.info(f"--- 配置详情结束 ---")

    # 运行Flask应用 (debug 参数由加载的配置对象中的 app.debug 控制)
    app.run(host='0.0.0.0', port=5000, debug=app.debug)  # 使用 app.debug