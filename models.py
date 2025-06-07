# backend/models.py
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timezone
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import text as sa_text  # 用于 server_default
import json  # Screenshot.to_dict() 中会用到

# 初始化 SQLAlchemy 实例，但先不关联到具体的 Flask app
# Flask app 将在 app2.py (或应用工厂) 中通过 db.init_app(app) 来关联
db = SQLAlchemy()


class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)  # 用户名加索引
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)  # 邮箱加索引
    password_hash = db.Column(db.String(256), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    # 存储配额相关字段
    storage_quota_bytes = db.Column(db.BigInteger, nullable=False, default=1 * 1024 * 1024 * 1024,
                                    server_default=sa_text('1073741824'))  # 默认1GB
    storage_used_bytes = db.Column(db.BigInteger, nullable=False, default=0, server_default=sa_text('0'))

    # 截图数量统计字段
    screenshot_count = db.Column(db.Integer, nullable=False, default=0, server_default=sa_text('0'))

    # 关系定义
    # 用户上传的文献列表 (一对多)
    literature_articles = db.relationship('LiteratureArticle', backref='user', lazy='dynamic',
                                          cascade="all, delete-orphan")
    # 用户的活动日志 (一对多)
    activity_logs = db.relationship('UserActivityLog', backref='user', lazy='dynamic', cascade="all, delete-orphan")
    # 用户的截图 (一对多)
    screenshots = db.relationship('Screenshot', backref=db.backref('user', lazy='joined'), lazy='dynamic',
                                  cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def __repr__(self):
        return f'<User {self.username} (ID: {self.id})>'


class LiteratureArticle(db.Model):
    __tablename__ = 'literature_articles'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False,
                        index=True)  # 用户删除时，其文献也应删除

    # 核心文献信息
    title = db.Column(db.String(500), nullable=True)  # 标题可能较长
    authors = db.Column(db.Text, nullable=True)  # 作者列表，可能很长，以文本存储（例如逗号分隔）
    year = db.Column(db.Integer, nullable=True)
    source_publication = db.Column(db.String(300), nullable=True)  # 期刊或会议名
    doi = db.Column(db.String(100), nullable=True, index=True)

    # 应用相关字段
    frontend_row_id = db.Column(db.String(50), nullable=True, index=True)  # 前端表格行ID，用于同步
    pdf_link = db.Column(db.String(2048), nullable=True)  # PDF链接，URL可能很长
    status = db.Column(db.String(50), nullable=True, default='待处理', index=True)  # 文献处理状态

    # 存储从CSV/Excel导入时，未被标准字段捕获的其他所有数据
    additional_data_json = db.Column(db.Text, nullable=True)  # 存储为JSON字符串

    # 时间戳
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc),
                           onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # 关系定义
    # 文献关联的截图 (一对多)
    # 如果文献被删除，其关联的截图记录中的 literature_article_id 会被设为 NULL (根据Screenshot模型中ForeignKey的ondelete='SET NULL')
    screenshots = db.relationship('Screenshot', backref=db.backref('literature_article', lazy='select'), lazy='dynamic')

    # 注意: literature_article 的 backref 在 Screenshot 模型中应该与此对应，lazy='joined' 或 'select' 都是常见选择

    def __repr__(self):
        return f'<LiteratureArticle {self.id} "{str(self.title)[:30]}..." by User {self.user_id}>'


class Screenshot(db.Model):
    __tablename__ = 'screenshots'  # 定义表名

    id = db.Column(db.Integer, primary_key=True)  # 主键
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    literature_article_id = db.Column(db.Integer, db.ForeignKey('literature_articles.id', ondelete='SET NULL'),
                                      nullable=True, index=True)

    # 文件存储信息
    # 存储相对于 ARTICLE_DATA_ROOT_DIR 的路径，例如 "user_123/article_folder_abc/screenshot_xyz.png"
    image_relative_path = db.Column(db.String(512), nullable=False, unique=True)
    image_size_bytes = db.Column(db.BigInteger, nullable=False, default=0, server_default=sa_text('0'))

    # 核心元数据
    page_number = db.Column(db.Integer, nullable=True)
    selection_rect_json = db.Column(db.String(255),
                                    nullable=True)  # 存储截图时的选区坐标 (JSON字符串格式，例如 '{"x":10,"y":20,"width":100,"height":50}')

    chart_type = db.Column(db.String(100), nullable=True, index=True)  # 用户标注的图表类型
    description = db.Column(db.Text, nullable=True)  # 用户对截图的描述

    wpd_data_json = db.Column(db.Text, nullable=True)  # 存储WebPlotDigitizer的校准和数据点 (JSON字符串格式)

    # 辅助元数据
    thumbnail_data_url = db.Column(db.Text, nullable=True)  # 截图缩略图的Base64 Data URL (如果过大，考虑只存路径)
    original_page_width = db.Column(db.Float, nullable=True)
    original_page_height = db.Column(db.Float, nullable=True)
    capture_scale = db.Column(db.Float, nullable=True)

    # 时间戳
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc),
                           onupdate=lambda: datetime.now(timezone.utc))

    def __repr__(self):
        return f'<Screenshot {self.id} by User {self.user_id} for Article {self.literature_article_id}>'

    def to_dict(self, include_thumbnail=False):  # 添加一个参数控制是否包含可能很大的缩略图
        try:
            sel_rect = json.loads(self.selection_rect_json) if self.selection_rect_json else None
        except json.JSONDecodeError:
            sel_rect = None  # 或记录错误

        try:
            wpd_data = json.loads(self.wpd_data_json) if self.wpd_data_json else None
        except json.JSONDecodeError:
            wpd_data = None  # 或记录错误

        data = {
            "id": self.id,
            "db_id": self.id,  # 兼容前端可能使用的 db_id
            "user_id": self.user_id,
            "literature_article_id": self.literature_article_id,
            "image_relative_path": self.image_relative_path,  # 前端会用这个来构造下载URL
            "image_size_bytes": self.image_size_bytes,
            "page_number": self.page_number,
            "selection_rect": sel_rect,  # 已解析的JSON对象
            "chart_type": self.chart_type,
            "description": self.description,
            "wpd_data_present": bool(self.wpd_data_json and self.wpd_data_json.strip() not in ["null", "{}", "[]"]),
            "wpd_data": wpd_data,  # 已解析的JSON对象
            "original_page_width": self.original_page_width,
            "original_page_height": self.original_page_height,
            "capture_scale": self.capture_scale,
            "created_at_iso": self.created_at.isoformat() + "Z" if self.created_at else None,
            "updated_at_iso": self.updated_at.isoformat() + "Z" if self.updated_at else None,
        }
        if include_thumbnail:
            data["thumbnail_data_url"] = self.thumbnail_data_url
        return data


class UserActivityLog(db.Model):
    __tablename__ = 'user_activity_logs'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    activity_type = db.Column(db.String(50), nullable=False, index=True)
    description = db.Column(db.Text, nullable=True)
    timestamp = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    related_article_db_id = db.Column(db.Integer, db.ForeignKey('literature_articles.id', ondelete='SET NULL'),
                                      nullable=True, index=True)
    # 关联的文献，如果文献被删除，此字段设为NULL

    related_literature_article = db.relationship('LiteratureArticle',
                                                 backref=db.backref('activity_logs_related_to_article', lazy='dynamic'))

    def __repr__(self):
        return f'<UserActivityLog {self.id} User {self.user_id} - Type {self.activity_type}>'

    def to_dict(self):
        icon_class = "fas fa-info-circle"  # Default icon
        if self.activity_type == "register_success":
            icon_class = "fas fa-user-plus"
        elif self.activity_type == "login_success":
            icon_class = "fas fa-sign-in-alt"
        elif self.activity_type == "create_screenshot":
            icon_class = "fas fa-camera"
        elif self.activity_type == "update_screenshot_metadata":
            icon_class = "fas fa-edit"
        elif self.activity_type == "delete_screenshot":
            icon_class = "fas fa-trash-alt"
        elif self.activity_type == "upload_literature_list":
            icon_class = "fas fa-file-upload"
        elif self.activity_type == "delete_literature_article":
            icon_class = "fas fa-file-excel"  # Placeholder, could be more specific
        elif self.activity_type == "batch_delete_literature_articles":
            icon_class = "fas fa-dumpster-fire"  # Placeholder
        elif self.activity_type == "update_article_details":
            icon_class = "fas fa-file-signature"
        elif "batch_zip" in self.activity_type:
            icon_class = "fas fa-file-archive"

        return {
            "id": self.id,
            "user_id": self.user_id,
            "activity_type": self.activity_type,
            "description": self.description,
            "timestamp_iso": self.timestamp.isoformat() + "Z" if self.timestamp else None,
            "related_article_db_id": self.related_article_db_id,
            "icon_class": icon_class
        }