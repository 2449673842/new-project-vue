# backend/screenshot_views.py
from flask import Blueprint, request, jsonify, current_app, send_file, send_from_directory  # send_file 添加在此处
# 从同级目录的 models.py 导入 db 和相关模型
from models import db, User, LiteratureArticle, Screenshot  # User 用于配额，LiteratureArticle 可能用于关联
# 从同级目录的 utils.py 导入需要的辅助函数
from utils import get_current_user_from_token, log_user_activity, sanitize_directory_name, sanitize_filename

import os
import base64
import json
import time
import uuid
import io  # download_article_screenshots_zip_route_bp 需要
import zipfile  # download_article_screenshots_zip_route_bp 需要
from datetime import datetime, timezone  # save_screenshot_route_bp 需要
from sqlalchemy import or_ as sqlalchemy_or  # 导入 or_ 以便在查询中使用

screenshot_bp = Blueprint('screenshot_bp', __name__, url_prefix='/api')


@screenshot_bp.route('/save_screenshot', methods=['POST'])
def save_screenshot_route_bp():
    # --- 1. 用户认证与基本信息获取 (保持不变) ---
    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401
    user_id = current_user_info['user_id']
    username_for_log = current_user_info.get('username', 'UnknownUser')
    log_prefix = f"[ScreenshotBP][User:{user_id}]"
    current_app.logger.info(f"{log_prefix} 收到截图保存请求。")

    try:
        # --- 2. 获取并验证请求数据 (保持不变) ---
        data = request.get_json()
        # ... (提取 article_id_from_payload, article_db_id_from_payload, article_title, page_number,
        #          selection_rect, image_data_base64, suggested_filename_from_payload, chart_type,
        #          description, original_page_dimensions, capture_scale, thumbnail_data_url 等)
        if not data:  # 基本检查
            current_app.logger.warning(f"{log_prefix} 请求体为空或不是JSON格式。")
            return jsonify({"success": False, "message": "无效的请求：未收到JSON数据。"}), 400

        article_id_from_payload = data.get('articleId')
        article_db_id_from_payload = data.get('db_id')
        article_title = data.get('articleTitle', '未知文献')
        page_number = data.get('pageNumber')
        selection_rect = data.get('selectionRect')  # 这是一个字典对象
        image_data_base64 = data.get('imageData')
        suggested_filename_from_payload = data.get('suggestedFilename', 'screenshot.png')
        chart_type = data.get('chartType', '未指定')
        description = data.get('description', '')
        original_page_dimensions = data.get('originalPageDimensions')  # 这是一个字典 {"width": w, "height": h}
        capture_scale = data.get('captureScale')
        thumbnail_data_url = data.get('thumbnailDataUrl')  # Base64 Data URL
        wpd_data = data.get('wpdData')  # WPD数据, 可能是JSON对象或字符串

        required_fields_check = {
            'articleId_or_db_id': article_id_from_payload or article_db_id_from_payload,
            'imageData': image_data_base64,
            'pageNumber': page_number
        }
        missing = [k for k, v in required_fields_check.items() if v is None]
        if missing:
            current_app.logger.warning(f"{log_prefix} 请求参数缺失: {', '.join(missing)}")
            return jsonify({"success": False, "message": f"请求参数缺失: {', '.join(missing)}"}), 400

        # --- 3. 处理图像数据并计算大小 (保持不变) ---
        current_app.logger.debug(f"{log_prefix} 准备解码Base64图像数据。")
        try:
            header, encoded_data = image_data_base64.split(',', 1) if ',' in image_data_base64 else (
            '', image_data_base64)
            image_bytes = base64.b64decode(encoded_data)
            image_size_bytes = len(image_bytes)
            current_app.logger.debug(f"{log_prefix} 图像数据解码成功，字节长度: {image_size_bytes}。")
        except Exception as e_b64:
            current_app.logger.error(f"{log_prefix} Base64解码截图数据失败: {e_b64}", exc_info=True)
            return jsonify({"success": False, "message": f"图像数据解码失败: {str(e_b64)}"}), 400

        # --- 4. 存储配额检查 (保持不变) ---
        current_user = User.query.get(user_id)
        if not current_user:  # ... (错误处理)
            current_app.logger.error(f"{log_prefix} 无法从数据库获取用户信息 (User ID: {user_id}) 以进行配额检查。")
            return jsonify({"success": False, "message": "无法获取用户信息以进行配额检查。"}), 500
        if (current_user.storage_used_bytes + image_size_bytes) > current_user.storage_quota_bytes:
            # ... (空间不足的错误处理)
            current_app.logger.warning(f"{log_prefix} 用户存储空间不足。")
            return jsonify({"success": False, "message": "您的存储空间不足，无法保存此截图。",
                            "error_code": "INSUFFICIENT_STORAGE"}), 413

        # --- 5. 确定截图关联的文献数据库ID (保持不变) ---
        final_literature_article_db_id = None  # 初始化为 None
        if article_db_id_from_payload:
            # 确保 ID 能转换为整数
            try:
                final_literature_article_db_id = int(article_db_id_from_payload)
            except ValueError:
                current_app.logger.warning(f"{log_prefix} 提供的 db_id '{article_db_id_from_payload}' 不是有效整数。")
        elif article_id_from_payload:
            try:
                numeric_article_id = int(article_id_from_payload) if str(article_id_from_payload).isdigit() else -1
                matched_article = LiteratureArticle.query.filter(
                    LiteratureArticle.user_id == user_id,
                    sqlalchemy_or(  # 确保 sqlalchemy_or 已从 sqlalchemy 导入
                        LiteratureArticle.frontend_row_id == str(article_id_from_payload),
                        LiteratureArticle.id == numeric_article_id
                    )
                ).first()
                if matched_article:
                    final_literature_article_db_id = matched_article.id
                else:
                    current_app.logger.warning(
                        f"{log_prefix} 未能通过 articleId ('{article_id_from_payload}') 找到匹配的文献数据库记录。截图将不关联特定文献。")
            except ValueError:
                current_app.logger.warning(
                    f"{log_prefix} articleId ('{article_id_from_payload}') 格式无法识别为数字ID，且作为 frontend_row_id 未找到匹配。截图将不关联特定文献。")
        else:
            current_app.logger.info(f"{log_prefix} 请求中未提供文献关联ID。截图将不关联特定文献。")
        current_app.logger.debug(f"{log_prefix} 截图将关联到的文献数据库ID: {final_literature_article_db_id}")

        # --- 6. 创建用户专属的、(如果有关联文献则)文献专属的截图存储目录 (基本保持不变) ---
        #    目录结构: ARTICLE_DATA_ROOT_DIR / user_{user_id} / {sanitized_article_folder_name} /
        #    如果 final_literature_article_db_id 为 None，可以考虑一个 "unfiled_screenshots" 或基于日期/UUID的子目录
        article_folder_name_segment = f"article_{final_literature_article_db_id}" if final_literature_article_db_id else "unassociated_screenshots"
        if article_title and article_title.strip() != '未知文献' and final_literature_article_db_id:  # 仅当有关联文献时才考虑用标题
            folder_name_base_for_dir = article_title
        else:
            folder_name_base_for_dir = article_folder_name_segment

        sanitized_article_folder_name = sanitize_directory_name(folder_name_base_for_dir)
        article_data_root_dir_from_config = current_app.config.get('ARTICLE_DATA_ROOT_DIR')
        if not article_data_root_dir_from_config:  # ... (错误处理)
            current_app.logger.error(f"{log_prefix} ARTICLE_DATA_ROOT_DIR 未在应用配置中设置！")
            return jsonify({"success": False, "message": "服务器配置错误：存储路径未定义。"}), 500
        user_specific_root_dir = os.path.join(article_data_root_dir_from_config, f"user_{user_id}")
        # 如果截图不关联特定文献，可以将其直接存储在 user_specific_root_dir 下，或一个通用的 "general_screenshots" 子目录
        # 为保持一致性，即使不关联文献，也创建一个基于唯一性的目录，或一个固定的 "unfiled" 目录
        # 此处我们简化，如果文献ID无效，则sanitize_directory_name会处理fallback
        image_storage_dir = os.path.abspath(os.path.join(user_specific_root_dir, sanitized_article_folder_name))
        try:
            os.makedirs(image_storage_dir, exist_ok=True)
            current_app.logger.info(f"{log_prefix} 用户截图目录已确认或创建: '{image_storage_dir}'")
        except OSError as e_mkdir:  # ... (错误处理)
            current_app.logger.error(f"{log_prefix} 创建目录 '{image_storage_dir}' 失败: {e_mkdir}", exc_info=True)
            return jsonify({"success": False, "message": "服务器内部错误：无法创建存储目录。"}), 500

        # --- 7. 生成唯一的截图文件名 (保持不变) ---
        base_name_from_suggestion, ext_from_suggestion = os.path.splitext(suggested_filename_from_payload)
        if not ext_from_suggestion: ext_from_suggestion = ".png"
        safe_filename_base = sanitize_filename(base_name_from_suggestion, extension="")
        timestamp_str = time.strftime("%Y%m%d_%H%M%S")
        unique_suffix = str(uuid.uuid4())[:6]
        unique_image_filename = f"{safe_filename_base}_{timestamp_str}_{unique_suffix}{ext_from_suggestion}"
        image_file_path_on_server = os.path.join(image_storage_dir, unique_image_filename)  # 图片的绝对路径
        current_app.logger.debug(f"{log_prefix} 生成的截图文件路径: '{image_file_path_on_server}'")

        # --- 8. 保存截图图片文件到服务器 (保持不变) ---
        try:
            with open(image_file_path_on_server, 'wb') as f:
                f.write(image_bytes)
            current_app.logger.info(f"{log_prefix} 截图图片已成功保存。路径: '{image_file_path_on_server}'")
        except IOError as e_io_img:  # ... (错误处理)
            current_app.logger.error(f"{log_prefix} 保存截图文件时发生IO错误 ({image_file_path_on_server}): {e_io_img}",
                                     exc_info=True)
            return jsonify({"success": False, "message": "服务器内部错误：无法写入截图文件。"}), 500

        # --- 9. *** 修改：准备并保存截图元数据到数据库 *** ---
        #    不再创建单独的.json元数据文件
        current_app.logger.debug(f"{log_prefix} 准备将截图元数据保存到数据库。")

        # 图片路径应相对于 ARTICLE_DATA_ROOT_DIR 存储
        image_relative_path_for_db = os.path.join(f"user_{user_id}", sanitized_article_folder_name,
                                                  unique_image_filename).replace("\\", "/")

        new_screenshot_db_entry = Screenshot(
            user_id=user_id,
            literature_article_id=final_literature_article_db_id,  # 可能为 None
            image_relative_path=image_relative_path_for_db,
            image_size_bytes=image_size_bytes,
            page_number=page_number,
            selection_rect_json=json.dumps(selection_rect) if selection_rect else None,  # 将字典转为JSON字符串
            chart_type=chart_type,
            description=description,
            wpd_data_json=json.dumps(wpd_data) if wpd_data else None,  # 将WPD数据转为JSON字符串
            thumbnail_data_url=thumbnail_data_url,
            original_page_width=original_page_dimensions.get('width') if original_page_dimensions else None,
            original_page_height=original_page_dimensions.get('height') if original_page_dimensions else None,
            capture_scale=capture_scale
            # created_at 和 updated_at 会由数据库模型 default/onupdate 自动处理
        )

        try:
            db.session.add(new_screenshot_db_entry)
            # 先不 commit，等待用户存储空间更新也成功后再一起commit，或分步commit并处理回滚

            # --- 10. 更新用户已用存储空间和截图计数 ---
            # current_user 是之前查询的用户对象，但为确保数据最新，尤其在并发环境下，重新获取或使用原子操作
            user_for_update = User.query.with_for_update().get(user_id)  # 加悲观锁（如果数据库支持）
            if not user_for_update:
                current_app.logger.error(f"{log_prefix} 在尝试更新存储和计数时未能找到用户 (ID: {user_id})。")
                db.session.rollback()  # 回滚之前add的screenshot
                # 尝试删除已保存的图片文件
                if os.path.exists(image_file_path_on_server): os.remove(image_file_path_on_server)
                return jsonify({"success": False, "message": "服务器内部错误：更新用户信息失败。"}), 500

            user_for_update.storage_used_bytes = (user_for_update.storage_used_bytes or 0) + image_size_bytes
            user_for_update.screenshot_count = (user_for_update.screenshot_count or 0) + 1
            db.session.add(user_for_update)  # 标记更改

            db.session.commit()  # 同时提交新截图和用户更新
            current_app.logger.info(f"{log_prefix} 截图元数据已保存到数据库 (ID: {new_screenshot_db_entry.id})。")
            current_app.logger.info(
                f"{log_prefix} 用户 (ID: {user_id}) 的 storage_used_bytes 更新为: {user_for_update.storage_used_bytes}，screenshot_count 更新为: {user_for_update.screenshot_count}")

        except Exception as e_db_save:
            db.session.rollback()  # 发生任何数据库错误都回滚
            current_app.logger.error(f"{log_prefix} 保存截图元数据到数据库或更新用户统计时失败: {e_db_save}",
                                     exc_info=True)
            # 如果数据库保存失败，关键：尝试删除已保存的图片文件，以维护数据一致性
            if os.path.exists(image_file_path_on_server):
                try:
                    os.remove(image_file_path_on_server)
                    current_app.logger.info(
                        f"{log_prefix} 由于数据库保存失败，已成功删除之前保存的图片文件: {image_file_path_on_server}")
                except Exception as del_err:
                    current_app.logger.error(
                        f"{log_prefix} 尝试删除图片文件 {image_file_path_on_server} (在数据库保存失败后) 失败: {del_err}",
                        exc_info=True)
            return jsonify({"success": False, "message": "服务器内部错误：保存截图信息失败。"}), 500

        # --- 11. 记录用户活动 (保持不变，但 related_article_db_id 现在是确定的数据库ID) ---
        log_user_activity(user_id, "create_screenshot",
                          f"为文献 (DB ID: {final_literature_article_db_id if final_literature_article_db_id else '无关联'}) 创建了截图 '{unique_image_filename}' (DB ID: {new_screenshot_db_entry.id})。",
                          related_article_db_id=final_literature_article_db_id)

        # --- 12. 返回最终的成功响应 ---
        current_app.logger.info(f"{log_prefix} 截图保存流程全部成功完成。")
        return jsonify({
            "success": True,
            "message": "截图已成功保存。",
            "screenshot_id": new_screenshot_db_entry.id,  # 返回新截图的数据库ID
            "image_relative_path": image_relative_path_for_db,  # 图片的相对路径
            "image_size_bytes": image_size_bytes,
            "new_storage_used_bytes": user_for_update.storage_used_bytes,
            "new_screenshot_count": user_for_update.screenshot_count,
            "storage_quota_bytes": user_for_update.storage_quota_bytes
        }), 201

    except Exception as e_main:
        user_id_for_log_main_exc = user_id if 'user_id' in locals() and user_id else "UnknownUserInMainException"
        current_app.logger.error(
            f"[ScreenshotBP][User:{user_id_for_log_main_exc}] 处理 /save_screenshot 时发生未捕获的严重错误: {e_main}",
            exc_info=True)
        return jsonify({"success": False, "message": "服务器在保存截图过程中发生内部未知错误。"}), 500


# backend/screenshot_views.py
# ... (确保顶部的导入包含了 Blueprint, request, jsonify, current_app,
#      Screenshot, User, db from models, get_current_user_from_token, log_user_activity from utils,
#      json, time, datetime, timezone) ...

# 新的路由，用于部分更新一个截图资源
@screenshot_bp.route('/screenshots/<int:screenshot_id>', methods=['PATCH'])
def update_screenshot_metadata_route_bp(screenshot_id): # 函数名可保持或更新
    # 1. 用户认证
    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401

    user_id = current_user_info['user_id']
    log_prefix = f"[ScreenshotBP][User:{user_id}]"

    # 2. 获取并验证请求体
    updates = request.get_json()
    if not updates or not isinstance(updates, dict):
        current_app.logger.warning(f"{log_prefix} PATCH /screenshots/{screenshot_id} 请求体无效。")
        return jsonify({"success": False, "message": "无效的请求：需要一个包含更新内容的JSON对象作为请求体。"}), 400

    current_app.logger.info(f"{log_prefix} 尝试 PATCH 更新截图元数据 (DB ID: {screenshot_id})，更新内容: {updates}")

    try:
        # 3. 从数据库查询截图记录，并验证所有权
        # 使用 .with_for_update() 可以尝试在支持的数据库上加锁，防止并发修改
        screenshot_to_update = Screenshot.query.with_for_update().filter_by(id=screenshot_id, user_id=user_id).first()
        if not screenshot_to_update:
            current_app.logger.warning(f"{log_prefix} 尝试更新不存在或无权限的截图记录 (DB ID: {screenshot_id})。")
            return jsonify({"success": False, "message": "截图不存在或无权操作。"}), 404

        # 4. 遍历请求体中的字段并更新模型对象
        # 定义允许通过此API更新的字段，以增加安全性
        # allowed_fields_to_update = ['chartType', 'description', 'wpdData']
        fields_updated_count = 0

        # 前端发送的字段名 (camelCase) 可能与后端模型字段名 (snake_case) 不同
        # 我们在 Screenshot 模型中定义的字段是 chart_type, description, wpd_data_json
        if 'chartType' in updates:
            screenshot_to_update.chart_type = updates['chartType']
            fields_updated_count += 1

        if 'description' in updates:
            screenshot_to_update.description = updates['description']
            fields_updated_count += 1

        if 'wpdData' in updates:
            # 将WPD数据（可能是JSON对象或字符串）序列化为JSON字符串再存入数据库
            screenshot_to_update.wpd_data_json = json.dumps(updates['wpdData']) if updates['wpdData'] else None
            fields_updated_count += 1

        if fields_updated_count > 0:
            # 模型中的 onupdate=lambda: datetime.now(timezone.utc) 会自动处理 updated_at
            # 所以我们只需要提交即可
            db.session.commit()

            log_user_activity(user_id, "update_screenshot_metadata", f"更新了截图的元数据 (DB ID: {screenshot_id})。")
            current_app.logger.info(f"{log_prefix} 成功更新了截图记录 (DB ID: {screenshot_id}) 的 {fields_updated_count} 个字段。")

            # 返回更新后的完整截图对象数据，方便前端刷新
            return jsonify({
                "success": True,
                "message": "截图元数据已成功更新。",
                "screenshot": screenshot_to_update.to_dict(include_thumbnail=True) # 使用 to_dict() 方法
            }), 200
        else:
            # 如果请求体中没有包含任何允许更新的字段
            current_app.logger.info(f"{log_prefix} 尝试更新截图 (DB ID: {screenshot_id})，但没有提供任何允许更新的字段。")
            return jsonify({"success": True, "message": "请求已收到，但没有有效字段被更新。", "updated_fields_count": 0}), 200

    except Exception as e:
        db.session.rollback() # 如果发生任何错误，回滚数据库更改
        current_app.logger.error(f"{log_prefix} 更新截图元数据 (DB ID: {screenshot_id}) 时发生数据库错误: {e}", exc_info=True)
        return jsonify({"success": False, "message": "更新截图元数据时发生服务器内部错误。"}), 500


# 别忘了从 screenshot_views.py 中删除或注释


# backend/screenshot_views.py
# ... (确保顶部的导入包含了 Blueprint, request, jsonify, current_app,
#      Screenshot from models, get_current_user_from_token from utils) ...

@screenshot_bp.route('/ml/screenshots', methods=['GET'])
def get_ml_screenshots_data_route_bp():
    # 1. 用户认证 (保持不变)
    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401

    user_id = current_user_info['user_id']
    log_prefix = f"[ScreenshotBP][User:{user_id}]"

    # 2. 获取并验证筛选和分页参数
    try:
        # 分页参数
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        # 对 per_page 进行范围限制，防止客户端请求过大的页面
        if per_page > 100: per_page = 100
        if per_page <= 0: per_page = 20

        # 筛选参数 (保持不变)
        filter_article_id = request.args.get('frontend_article_id', type=int, default=None)
        filter_chart_type = request.args.get('chart_type', type=str, default=None)
    except ValueError:
        return jsonify({"success": False, "message": "分页或筛选参数类型错误。"}), 400

    log_message = f"{log_prefix} 用户请求截图数据 (for ML). Page: {page}, PerPage: {per_page}."
    if filter_article_id: log_message += f" 筛选文献ID: '{filter_article_id}'."
    if filter_chart_type: log_message += f" 筛选图表类型: '{filter_chart_type}'."
    current_app.logger.info(log_message)

    try:
        # 3. 构建数据库查询 (保持不变)
        query = Screenshot.query.filter_by(user_id=user_id)
        if filter_article_id is not None:
            query = query.filter_by(literature_article_id=filter_article_id)
        if filter_chart_type is not None and filter_chart_type.strip():
            query = query.filter_by(chart_type=filter_chart_type)

        # 4. *** 修改：使用 SQLAlchemy 的 paginate() 方法执行分页查询 ***
        #    不再使用 .all()
        pagination_obj = query.order_by(Screenshot.created_at.desc()).paginate(
            page=page,
            per_page=per_page,
            error_out=False # 当请求的页码超出范围时，返回空列表而不是404错误
        )

        # 获取当前页的项目
        screenshots_for_current_page = pagination_obj.items

        # 使用 Screenshot 模型中的 to_dict() 方法来序列化数据
        # 对于机器学习数据获取，通常不需要缩略图，所以 include_thumbnail=False
        paginated_screenshots_data = [
            screenshot.to_dict(include_thumbnail=False) for screenshot in screenshots_for_current_page
        ]

        # 5. 构造包含分页元数据的响应体
        response_data = {
            "success": True,
            "message": "截图数据获取成功。",
            "screenshots": paginated_screenshots_data, # 当前页的截图数据
            "pagination": {
                "page": pagination_obj.page,           # 当前页码
                "per_page": pagination_obj.per_page,   # 每页项目数
                "total_pages": pagination_obj.pages,   # 总页数
                "total_items": pagination_obj.total,   # 符合筛选条件的总项目数
                "has_next": pagination_obj.has_next,   # 是否有下一页
                "has_prev": pagination_obj.has_prev    # 是否有上一页
            }
        }

        current_app.logger.info(f"{log_prefix} 根据数据库查询，成功获取了第 {page} 页的 {len(paginated_screenshots_data)} 条截图记录 (总计 {pagination_obj.total} 条)。")
        return jsonify(response_data), 200

    except Exception as e:
        current_app.logger.error(f"{log_prefix} 从数据库获取截图数据时发生严重错误: {e}", exc_info=True)
        return jsonify({"success": False, "message": "获取截图数据时发生服务器内部错误。"}), 500


# backend/screenshot_views.py
# ... (确保顶部的导入包含了 Blueprint, request, jsonify, current_app, send_file,
#      LiteratureArticle, Screenshot from models, get_current_user_from_token from utils,
#      sanitize_filename from utils, os, io, zipfile, time, json) ...

@screenshot_bp.route('/literature/<int:article_db_id>/screenshots_zip', methods=['GET'])
def download_article_screenshots_zip_route_bp(article_db_id):
    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401

    user_id = current_user_info['user_id']
    log_prefix = f"[ScreenshotBP][User:{user_id}]"
    current_app.logger.info(f"{log_prefix} 用户请求下载文献 (DB ID: {article_db_id}) 的截图ZIP包。")

    try:
        # 1. 查询文献记录，确保它属于当前用户
        article = LiteratureArticle.query.filter_by(id=article_db_id, user_id=user_id).first()
        if not article:
            current_app.logger.warning(
                f"{log_prefix} 请求下载截图ZIP包，但未找到文献记录 DB ID: {article_db_id} 或用户无权限。")
            return jsonify({"success": False, "message": "未找到指定的文献记录或无权操作。"}), 404

        # 2. *** 核心优化：从数据库查询与此文献关联的所有截图记录 ***
        #    不再遍历文件系统
        screenshots_to_zip = Screenshot.query.filter_by(
            user_id=user_id,
            literature_article_id=article_db_id
        ).order_by(Screenshot.page_number, Screenshot.created_at).all()

        if not screenshots_to_zip:
            current_app.logger.info(f"{log_prefix} 文献 (DB ID: {article_db_id}) 在数据库中没有关联的截图记录。")
            return jsonify({"success": False, "message": "该文献没有截图可供下载。"}), 404

        # 3. 在内存中创建ZIP文件
        memory_file = io.BytesIO()  # 需要 import io

        # --- (可选但推荐的增强功能) 生成元数据CSV文件 ---
        metadata_csv_string = "screenshot_db_id,image_filename_in_zip,page_number,chart_type,description,wpd_data_present\n"

        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:  # 需要 import zipfile
            current_app.logger.debug(f"{log_prefix} 准备打包 {len(screenshots_to_zip)} 个截图文件。")

            article_data_root_dir = current_app.config.get('ARTICLE_DATA_ROOT_DIR')
            if not article_data_root_dir:
                current_app.logger.error(f"{log_prefix} ARTICLE_DATA_ROOT_DIR 未在应用配置中设置！ZIP包下载失败。")
                return jsonify({"success": False, "message": "服务器配置错误：存储路径未定义。"}), 500

            for screenshot in screenshots_to_zip:
                # 从数据库记录中获取图片路径
                image_abs_path = os.path.join(article_data_root_dir, screenshot.image_relative_path)

                if os.path.exists(image_abs_path) and os.path.isfile(image_abs_path):
                    # arcname 只保留文件名，不带服务器上的目录结构
                    arcname = os.path.basename(screenshot.image_relative_path)
                    zf.write(image_abs_path, arcname=arcname)
                    current_app.logger.debug(f"{log_prefix} 已添加文件到ZIP: {arcname}")

                    # 为CSV准备一行数据
                    # 使用双引号来包裹可能含有逗号的字段
                    desc_cleaned = f'"{screenshot.description.replace("\"", "\"\"")}"' if screenshot.description else ""
                    wpd_present = "yes" if (
                                screenshot.wpd_data_json and screenshot.wpd_data_json.strip() not in ["null", "{}",
                                                                                                      "[]"]) else "no"
                    metadata_csv_string += f"{screenshot.id},\"{arcname}\",{screenshot.page_number or ''},\"{screenshot.chart_type or ''}\",{desc_cleaned},{wpd_present}\n"
                else:
                    current_app.logger.warning(
                        f"{log_prefix} 数据库记录 (ID: {screenshot.id}) 指向的图片文件不存在或不是一个文件: {image_abs_path}")

            # 将生成的CSV元数据字符串写入ZIP包
            zf.writestr("metadata_summary.csv", metadata_csv_string.encode('utf-8'))
            current_app.logger.info(f"{log_prefix} metadata_summary.csv 已添加到ZIP包。")

        memory_file.seek(0)  # 将内存文件的指针移到开头，以便 send_file 从头读取

        # 4. 准备并发送ZIP文件
        zip_filename_base = sanitize_filename(article.title or f"article_{article_db_id}",
                                              extension="")  # 从 utils.py 导入
        final_zip_filename = f"{zip_filename_base}_screenshots_{time.strftime('%Y%m%d')}.zip"  # 需要 import time

        current_app.logger.info(f"{log_prefix} 准备发送文献 (DB ID: {article_db_id}) 的截图ZIP包: {final_zip_filename}")
        return send_file(  # 需要 from flask import send_file
            memory_file,
            mimetype='application/zip',
            as_attachment=True,
            download_name=final_zip_filename
        )

    except Exception as e:
        current_app.logger.error(f"{log_prefix} 打包下载文献 (DB ID: {article_db_id}) 截图时发生严重错误: {e}",
                                 exc_info=True)
        return jsonify({"success": False, "message": "打包下载截图时发生服务器内部错误。"}), 500


# ... (screenshot_views.py 中的其他路由) ...


# backend/screenshot_views.py
# ... (确保顶部的导入包含了 Blueprint, request, jsonify, current_app, send_from_directory,
#      Screenshot from models, get_current_user_from_token from utils, os) ...

# 新的路由，使用截图的数据库ID作为路径参数来获取图片
@screenshot_bp.route('/screenshots/<int:screenshot_id>/image', methods=['GET'])
def download_screenshot_image_route_bp(screenshot_id):
    # 1. 用户认证
    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401

    user_id = current_user_info['user_id']
    log_prefix = f"[ScreenshotBP][User:{user_id}]"
    current_app.logger.info(f"{log_prefix} 用户请求下载截图图片，数据库ID: {screenshot_id}")

    try:
        # 2. 从数据库查询截图记录，并验证所有权
        screenshot = Screenshot.query.filter_by(id=screenshot_id, user_id=user_id).first()

        if not screenshot:
            current_app.logger.warning(f"{log_prefix} 请求下载的截图记录未找到 (ID: {screenshot_id}) 或无权访问。")
            return jsonify({"success": False, "message": "截图不存在或无权访问。"}), 404

        # 3. 从数据库记录中获取图片文件的相对路径
        image_relative_path = screenshot.image_relative_path

        # 4. 获取截图存储的根目录配置
        article_data_root_dir_from_config = current_app.config.get('ARTICLE_DATA_ROOT_DIR')
        if not article_data_root_dir_from_config:
            current_app.logger.error(f"{log_prefix} ARTICLE_DATA_ROOT_DIR 未在应用配置中设置！下载失败。")
            return jsonify({"success": False, "message": "服务器配置错误：存储路径未定义。"}), 500

        # 构造绝对目录路径
        # 注意：send_from_directory 的第一个参数是目录，不是完整的文件路径
        directory = os.path.abspath(article_data_root_dir_from_config)
        # 文件名是相对路径的最后一部分
        filename = os.path.basename(image_relative_path)
        # send_from_directory 需要的目录是包含用户和文章子文件夹的完整路径的一部分
        # image_relative_path 已经是 "user_X/article_Y/image.png" 的形式，
        # send_from_directory 内部会将 directory 和 filename 拼接，所以我们需要提供正确的父目录。
        # 正确的做法是，send_from_directory 的第一个参数应该是 ARTICLE_DATA_ROOT_DIR 的绝对路径，
        # 而第二个参数应该是完整的相对路径 image_relative_path

        current_app.logger.info(f"{log_prefix} 准备从目录 '{directory}' 发送文件: '{image_relative_path}'")
        # 5. 使用 send_from_directory 安全地发送文件
        return send_from_directory(
            directory,
            image_relative_path, # send_from_directory 会安全地处理这个相对路径
            as_attachment=True # 作为附件下载
        )

    except FileNotFoundError:
        # send_from_directory 在文件不存在时会抛出 Werkzeug 的 NotFound 异常，Flask会转为404响应
        # 但我们在这里也捕获它以记录更明确的日志
        current_app.logger.warning(f"{log_prefix} 请求下载的截图文件在磁盘上未找到，尽管数据库中存在记录。路径: {image_relative_path}")
        return jsonify({"success": False, "message": "请求的截图文件在服务器上未找到。"}), 404
    except Exception as e_send_img:
        current_app.logger.error(f"{log_prefix} 下载截图文件时发生未知错误 (ID: {screenshot_id}): {e_send_img}", exc_info=True)
        return jsonify({"success": False, "message": "下载截图文件时发生服务器内部错误。"}), 500

# 别忘了从 screenshot_views.py 中删除或注释掉旧的 download_screenshot_image_route 函数
# @screenshot_bp.route('/download_screenshot_image', methods=['GET']) ...

# backend/screenshot_views.py
# ... (确保顶部的导入包含了 Blueprint, request, jsonify, current_app, User, Screenshot, db,
#      get_current_user_from_token, log_user_activity, os) ...

# 新的路由，使用截图的数据库ID作为路径参数
@screenshot_bp.route('/screenshots/<int:screenshot_id>', methods=['DELETE'])
def delete_screenshot_route_bp(screenshot_id):  # 函数名也已更新
    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401

    user_id = current_user_info['user_id']
    log_prefix = f"[ScreenshotBP][User:{user_id}]"
    current_app.logger.info(f"{log_prefix} 用户请求删除截图，数据库ID: {screenshot_id}")

    try:
        # 1. 从数据库查询截图记录，并验证所有权
        screenshot_to_delete = Screenshot.query.filter_by(id=screenshot_id, user_id=user_id).first()

        if not screenshot_to_delete:
            current_app.logger.warning(f"{log_prefix} 未找到要删除的截图记录 (ID: {screenshot_id}) 或无权操作。")
            return jsonify({"success": False, "message": "截图不存在或无权删除。"}), 404

        # 2. 获取文件信息，准备进行文件删除和配额更新
        image_relative_path = screenshot_to_delete.image_relative_path
        image_size_bytes_to_delete = screenshot_to_delete.image_size_bytes

        article_data_root_dir = current_app.config.get('ARTICLE_DATA_ROOT_DIR')
        if not article_data_root_dir:
            current_app.logger.error(f"{log_prefix} ARTICLE_DATA_ROOT_DIR 未在应用配置中设置！删除操作无法继续。")
            return jsonify({"success": False, "message": "服务器配置错误：存储路径未定义。"}), 500

        image_abs_path = os.path.abspath(os.path.join(article_data_root_dir, image_relative_path))

        # 安全检查，确保构造的路径没有逃逸
        if not image_abs_path.startswith(os.path.abspath(article_data_root_dir)):
            current_app.logger.error(f"{log_prefix} 安全警告 - 解析后的截图绝对路径逃逸: '{image_abs_path}'")
            return jsonify({"success": False, "message": "无效的文件路径。"}), 400

        # 3. 执行数据库和文件系统的删除操作（在一个事务中）

        # 获取 User 对象以供更新，使用 with_for_update() 尝试加锁
        user_for_update = User.query.with_for_update().get(user_id)
        if not user_for_update:
            current_app.logger.error(f"{log_prefix} 在尝试更新配额时未能找到用户 (ID: {user_id})。")
            return jsonify({"success": False, "message": "服务器内部错误：无法更新用户信息。"}), 500

        # 从数据库会话中删除截图记录
        db.session.delete(screenshot_to_delete)

        # 更新用户统计信息
        user_for_update.storage_used_bytes = max(0,
                                                 (user_for_update.storage_used_bytes or 0) - image_size_bytes_to_delete)
        user_for_update.screenshot_count = max(0, (user_for_update.screenshot_count or 0) - 1)
        db.session.add(user_for_update)

        # 删除物理文件
        file_was_deleted = False
        if os.path.exists(image_abs_path) and os.path.isfile(image_abs_path):
            try:
                os.remove(image_abs_path)
                file_was_deleted = True
                current_app.logger.info(f"{log_prefix} 截图图片文件已从磁盘删除: {image_abs_path}")
            except OSError as e_rm:
                current_app.logger.error(f"{log_prefix} 从磁盘删除截图文件 '{image_abs_path}' 时发生IO错误: {e_rm}",
                                         exc_info=True)
                # 文件删除失败，这是一个严重问题，应回滚数据库操作
                db.session.rollback()
                return jsonify({"success": False, "message": "删除截图文件时发生错误，操作已取消。"}), 500
        else:
            # 文件在磁盘上已不存在，但数据库记录存在。这是一种数据不一致状态。
            # 但对于删除操作，我们可以认为目标（让文件消失）已达到，继续删除数据库记录。
            current_app.logger.warning(
                f"{log_prefix} 数据库中存在截图记录 (ID: {screenshot_id})，但对应的物理文件未在磁盘上找到: {image_abs_path}。将仅删除数据库记录。")
            file_was_deleted = True  # 视作文件“被删除”成功

        # 提交数据库事务（删除Screenshot记录，更新User记录）
        db.session.commit()

        # 记录用户活动
        log_user_activity(user_id, "delete_screenshot",
                          f"删除了截图 (原路径: {image_relative_path}, DB ID: {screenshot_id})。")

        return jsonify({
            "success": True,
            "message": "截图已成功删除。",
            "new_storage_used_bytes": user_for_update.storage_used_bytes,
            "new_screenshot_count": user_for_update.screenshot_count
        }), 200

    except Exception as e:
        db.session.rollback()  # 确保在任何未知异常时回滚
        current_app.logger.error(f"{log_prefix} 删除截图 (ID: {screenshot_id}) 过程中发生严重错误: {e}", exc_info=True)
        return jsonify({"success": False, "message": "删除截图时发生服务器内部错误。"}), 500