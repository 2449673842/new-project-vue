# backend/user_stats_views.py
from flask import Blueprint, request, jsonify, current_app
from sqlalchemy import func # get_literature_classification_stats_route_bp 需要

# 从同级目录的 models.py 导入相关模型
from models import db, User, LiteratureArticle, UserActivityLog
# 从同级目录的 utils.py 导入需要的辅助函数
from utils import get_current_user_from_token, _build_cors_preflight_response, format_bytes

import os # get_dashboard_stats_route_bp 需要

# 创建蓝图实例，URL前缀为 /api/user
user_stats_bp = Blueprint('user_stats_bp', __name__, url_prefix='/api/user')


# backend/user_stats_views.py
# ... (确保顶部的导入包含了 Blueprint, request, jsonify, current_app,
#      User, LiteratureArticle, db from models, get_current_user_from_token, format_bytes from utils, os, sqlalchemy.func) ...

@user_stats_bp.route('/dashboard_stats', methods=['GET', 'OPTIONS'])
def get_dashboard_stats_route_bp():
    if request.method == 'OPTIONS':
        from utils import _build_cors_preflight_response  # 确保导入
        return _build_cors_preflight_response()

    # 1. 用户认证
    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401

    user_id = current_user_info['user_id']
    log_prefix = f"[UserStatsBP][User:{user_id}]"
    current_app.logger.info(f"{log_prefix} 用户请求仪表盘统计数据。")

    try:
        # 2. 从数据库获取用户对象
        current_user = User.query.get(user_id)
        if not current_user:
            current_app.logger.error(f"{log_prefix} 无法从数据库获取用户信息 (User ID: {user_id})。")
            return jsonify({"success": False, "message": "无法获取用户统计信息。"}), 500

        # 3. 从用户对象直接获取存储和截图统计信息
        user_storage_used_bytes = current_user.storage_used_bytes or 0
        user_storage_quota_bytes = current_user.storage_quota_bytes or 0
        total_screenshots = current_user.screenshot_count or 0  # <--- 核心优化点

        # 4. 计算存储百分比
        if user_storage_quota_bytes > 0:
            storage_percentage = round((user_storage_used_bytes / user_storage_quota_bytes) * 100, 2)
        else:
            storage_percentage = 0 if user_storage_used_bytes == 0 else 100

        # 5. 格式化存储字符串
        storage_used_str = format_bytes(user_storage_used_bytes)
        storage_quota_str = format_bytes(user_storage_quota_bytes)

        # 6. 查询其他统计信息（保持不变）
        total_literature = LiteratureArticle.query.filter_by(user_id=user_id).count()
        downloaded_pdfs = LiteratureArticle.query.filter(
            LiteratureArticle.user_id == user_id,
            LiteratureArticle.pdf_link.isnot(None),
            LiteratureArticle.pdf_link != ''
        ).count()

        # 7. 构造响应数据
        stats_data = {
            "totalLiterature": total_literature,
            "downloadedPdfs": downloaded_pdfs,
            "totalScreenshots": total_screenshots,  # <-- 现在直接来自数据库计数字段
            "storageUsedRawBytes": user_storage_used_bytes,
            "storageQuotaRawBytes": user_storage_quota_bytes,
            "storageUsedFormatted": storage_used_str,
            "storageQuotaFormatted": storage_quota_str,
            "storagePercentage": storage_percentage
        }

        current_app.logger.info(f"{log_prefix} 仪表盘统计数据准备完毕: {stats_data}")
        return jsonify({"success": True, "stats": stats_data}), 200

    except Exception as e:
        current_app.logger.error(f"{log_prefix} 获取仪表盘统计数据时发生错误: {e}", exc_info=True)
        return jsonify({"success": False, "message": "获取统计数据时发生服务器内部错误。"}), 500


# ... (user_stats_views.py 中的其他路由) ...

@user_stats_bp.route('/recent_activity', methods=['GET', 'OPTIONS'])
def get_recent_activity_route_bp(): # 重命名
    if request.method == 'OPTIONS':
        return _build_cors_preflight_response()

    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401
    user_id = current_user_info['user_id']
    log_prefix = f"[UserStatsBP][User:{user_id}]"
    current_app.logger.info(f"{log_prefix} 用户请求最近活动。")
    try:
        limit = request.args.get('limit', 5, type=int)
        if limit <= 0 or limit > 20: # 限制limit范围
            limit = 5

        recent_activities_db = UserActivityLog.query.filter_by(user_id=user_id)\
            .order_by(UserActivityLog.timestamp.desc())\
            .limit(limit).all()

        activities_list = [log_entry.to_dict() for log_entry in recent_activities_db] if recent_activities_db else []
        current_app.logger.info(f"{log_prefix} 成功获取 {len(activities_list)} 条最近活动。")
        return jsonify({"success": True, "activities": activities_list}), 200
    except Exception as e:
        current_app.logger.error(f"{log_prefix} 获取最近活动时发生错误: {e}", exc_info=True)
        return jsonify({"success": False, "message": "获取最近活动时发生服务器内部错误。"}), 500

@user_stats_bp.route('/literature_classification_stats', methods=['GET', 'OPTIONS'])
def get_literature_classification_stats_route_bp(): # 重命名
    if request.method == 'OPTIONS':
        return _build_cors_preflight_response()

    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401
    user_id = current_user_info['user_id']
    log_prefix = f"[UserStatsBP][User:{user_id}]"
    current_app.logger.info(f"{log_prefix} 用户请求文献分类统计。")
    try:
        status_counts_query = db.session.query(
            LiteratureArticle.status,
            func.count(LiteratureArticle.id).label('count') # func 从 sqlalchemy 导入
        ).filter(LiteratureArticle.user_id == user_id).group_by(LiteratureArticle.status).all()

        status_map = {status if status else "未分类": count for status, count in status_counts_query}
        total_articles = LiteratureArticle.query.filter_by(user_id=user_id).count() # 或 sum(status_map.values())

        # 分类统计逻辑 (保持不变，或根据需要调整)
        download_statuses = ['下载成功', '链接已找到', '链接已找到 (自动)']
        pending_statuses = ['待处理', '已搜索', '自动查找中...']
        failed_statuses = ['处理失败', '链接无效', '自动查找失败', '打开/下载失败']
        downloaded_count, pending_count, failed_count, other_classified_count = 0, 0, 0, 0

        for status, count in status_map.items():
            if status in download_statuses: downloaded_count += count
            elif status in pending_statuses: pending_count += count
            elif status in failed_statuses: failed_count += count
            elif status != "未分类": # 统计其他已明确分类但不在上述列表中的状态
                other_classified_count += count

        # "未分类" 的数量可以直接从 status_map 获取
        unclassified_count = status_map.get("未分类", 0)

        classification_data = {
            "total": total_articles,
            "downloaded": downloaded_count,
            "pending": pending_count,
            "failed": failed_count,
            "other_classified": other_classified_count, # 新增
            "unclassified": unclassified_count,         # 新增
            "statuses_breakdown": status_map # 返回原始的状态->数量映射
        }
        current_app.logger.info(f"{log_prefix} 文献分类统计准备完毕: {classification_data}")
        return jsonify({"success": True, "classification": classification_data}), 200
    except Exception as e:
        current_app.logger.error(f"{log_prefix} 获取文献分类统计时发生严重错误: {e}", exc_info=True)
        return jsonify({"success": False, "message": "获取文献分类统计时发生服务器内部错误。"}), 500