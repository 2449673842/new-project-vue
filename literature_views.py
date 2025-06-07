# backend/literature_views.py
from flask import Blueprint, request, jsonify, current_app
from sqlalchemy import func, or_ as sqlalchemy_or  # Explicitly import or_

# 从同级目录的 models.py 导入 db 和相关模型
from models import db, \
    LiteratureArticle  # Assuming User model is not directly used in these routes beyond user_id from token
# 从同级目录的 utils.py 导入需要的辅助函数
from utils import get_current_user_from_token, log_user_activity, find_key_for_model,find_pdf_link


# 导入在 app2.py 中定义的 find_pdf_link 函数 (这是一个临时措施)
# 理想情况下: find_pdf_link 和其辅助函数 (find_pdf_link_via_scihub等) 应移至
# 一个新的服务模块 (e.g., pdf_services.py) 或 utils.py (如果足够通用)
# 然后从那里导入。
# 为使当前步骤聚焦于蓝图，我们暂时接受从 app2 导入，但需注意潜在的循环依赖风险。
try:
    from utils import find_pdf_link, _build_cors_preflight_response
except ImportError:
    # 占位符，以防 app2 无法直接导入或 find_pdf_link 尚未完全准备好被这样调用
    def find_pdf_link(doi=None, title=None):
        if current_app:  # 确保 current_app 可用
            current_app.logger.warning(
                "[LiteratureBP] find_pdf_link function could not be imported from app2, using placeholder. "
                "PDF finding will not work."
            )
        else:  # 如果在没有应用上下文的情况下调用（不太可能在路由中）
            print("[LiteratureBP-Placeholder] find_pdf_link called without app context.")
        return None

import json  # get_user_literature_list_bp 和 add_literature_entries_to_list_bp 中用到了
import re  # get_pdf_link_api_route_bp 中用到了
from datetime import datetime, timezone  # update_literature_article_route_bp 中用到了

# 创建一个蓝图实例
literature_bp = Blueprint('literature_bp', __name__, url_prefix='/api')


# --- 文献列表获取 (GET /api/user/literature_list) ---
@literature_bp.route('/user/literature_list', methods=['GET'])
def get_user_literature_list_bp():
    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401
    user_id = current_user_info['user_id']
    log_prefix = f"[LiteratureBP][User:{user_id}]"  # 为日志添加前缀

    try:
        user_articles_db = LiteratureArticle.query.filter_by(user_id=user_id).order_by(
            LiteratureArticle.created_at.desc()).all()
        frontend_table_data = []
        for article_db in user_articles_db:
            unique_frontend_id = article_db.frontend_row_id if article_db.frontend_row_id else str(article_db.id)
            article_dict = {
                "id": article_db.id,  # 数据库主键
                "db_id": article_db.id,  # 兼容旧前端可能使用的 db_id
                "_id": unique_frontend_id,  # 前端表格可能使用的唯一行标识
                "title": article_db.title,
                "authors": article_db.authors,
                "year": article_db.year,
                "source": article_db.source_publication,  # 在模型中是 source_publication
                "doi": article_db.doi,
                "pdfLink": article_db.pdf_link,
                "status": article_db.status,
                "screenshots": []  # 截图通常是按需或单独加载，此处留空
            }
            if article_db.additional_data_json:
                try:
                    additional_data = json.loads(article_db.additional_data_json)
                    if isinstance(additional_data, dict):
                        column_mapping_config = current_app.config.get('APP_BACKEND_COLUMN_MAPPING', {})
                        # 构建排除列表时应更严谨，避免误排除
                        # 核心模型字段（已在上面明确映射的）通常不应被 additional_data 覆盖
                        # 这里简化为仅添加不在 article_dict 中的键
                        for key, value in additional_data.items():
                            if key not in article_dict:  # 简单检查，避免覆盖核心字段
                                article_dict[key] = value
                except json.JSONDecodeError:
                    current_app.logger.error(  # 使用 current_app.logger
                        f"{log_prefix} 解析文献 (DB ID: {article_db.id}) 的 additional_data_json 失败。")
            frontend_table_data.append(article_dict)

        current_app.logger.info(
            f"{log_prefix} 成功获取了 {len(frontend_table_data)} 条文献记录。")  # 使用 current_app.logger
        return jsonify(frontend_table_data), 200
    except Exception as e:
        current_app.logger.error(f"{log_prefix} 获取文献列表时发生严重错误: {e}",
                                 exc_info=True)  # 使用 current_app.logger
        return jsonify({"success": False, "message": "获取文献列表时发生服务器内部错误。"}), 500


# --- 文献列表添加 (POST /api/user/literature_list) ---
@literature_bp.route('/user/literature_list', methods=['POST'])
def add_literature_entries_to_list_bp():
    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401
    user_id = current_user_info['user_id']
    log_prefix = f"[LiteratureBP][User:{user_id}]"
    articles_data_from_frontend = request.get_json()

    current_app.logger.info(  # 使用 current_app.logger
        f"{log_prefix} 收到批量添加文献请求，共 {len(articles_data_from_frontend) if isinstance(articles_data_from_frontend, list) else 'N/A'} 条。")

    if not isinstance(articles_data_from_frontend, list):
        current_app.logger.error(f"{log_prefix} 添加文献列表失败，请求体不是一个列表。")  # 使用 current_app.logger
        return jsonify({"success": False, "message": "请求数据格式错误，应为一个列表。"}), 400

    added_count = 0
    skipped_count = 0
    new_articles_to_add_to_db = []
    backend_column_mapping = current_app.config.get('APP_BACKEND_COLUMN_MAPPING', {})

    try:
        existing_dois_query = db.session.query(func.lower(LiteratureArticle.doi)).filter(
            LiteratureArticle.user_id == user_id,
            LiteratureArticle.doi.isnot(None),  # SQLAlchemy way to check for not None
            LiteratureArticle.doi != ''
        ).all()
        existing_dois_set = {doi_tuple[0] for doi_tuple in existing_dois_query}
        current_batch_no_doi_identifiers = set()

        for article_obj_from_frontend in articles_data_from_frontend:
            if not isinstance(article_obj_from_frontend, dict):
                current_app.logger.warning(
                    f"{log_prefix} 列表中的一项不是字典对象，已跳过: {article_obj_from_frontend}")  # 使用 current_app.logger
                skipped_count += 1
                continue

            title_original = find_key_for_model(article_obj_from_frontend, 'title')
            authors_original = find_key_for_model(article_obj_from_frontend, 'authors')
            year_str = find_key_for_model(article_obj_from_frontend, 'year')
            doi_value_original = find_key_for_model(article_obj_from_frontend, 'doi')

            title_cleaned_lower = str(title_original).strip().lower() if title_original and str(
                title_original).strip() else ""
            authors_cleaned_lower_str = ""
            if isinstance(authors_original, list):
                authors_cleaned_lower_str = ", ".join(
                    sorted([str(a).strip().lower() for a in authors_original if str(a).strip()]))
            elif isinstance(authors_original, str):
                authors_cleaned_lower_str = str(authors_original).strip().lower()

            year_cleaned = None
            if year_str and str(year_str).strip():
                try:
                    year_cleaned = int(float(str(year_str).strip()))
                except ValueError:
                    current_app.logger.warning(
                        f"{log_prefix} 无法将年份 '{year_str}' 转换为整数。标题: {title_original}")  # 使用 current_app.logger

            doi_value_cleaned_lower = str(doi_value_original).strip().lower() if doi_value_original and str(
                doi_value_original).strip() else None

            is_duplicate = False
            if doi_value_cleaned_lower:
                if doi_value_cleaned_lower in existing_dois_set: is_duplicate = True
            else:
                no_doi_identifier_tuple = (title_cleaned_lower, authors_cleaned_lower_str, year_cleaned)
                if no_doi_identifier_tuple in current_batch_no_doi_identifiers:
                    is_duplicate = True
                else:
                    query_for_no_doi = LiteratureArticle.query.filter(
                        LiteratureArticle.user_id == user_id,
                        sqlalchemy_or(LiteratureArticle.doi.is_(None), LiteratureArticle.doi == ''),
                        # 使用导入的 sqlalchemy_or
                        func.lower(LiteratureArticle.title) == title_cleaned_lower
                    )
                    if authors_cleaned_lower_str:
                        query_for_no_doi = query_for_no_doi.filter(
                            func.lower(LiteratureArticle.authors) == authors_cleaned_lower_str)
                    if year_cleaned is not None:
                        query_for_no_doi = query_for_no_doi.filter(LiteratureArticle.year == year_cleaned)
                    if query_for_no_doi.first(): is_duplicate = True

            if is_duplicate:
                skipped_count += 1
                current_app.logger.info(
                    f"{log_prefix} 跳过重复文献 (DOI: {doi_value_cleaned_lower}, 标题: {str(title_original)[:30]}...).")  # 使用 current_app.logger
                continue

            source_pub = find_key_for_model(article_obj_from_frontend, 'source_publication')
            frontend_row_id = article_obj_from_frontend.get('_id')
            pdf_link = article_obj_from_frontend.get('pdfLink')
            status = article_obj_from_frontend.get('status', '待处理')

            additional_data = {}
            # 修正 additional_data 的排除逻辑 (从 get_user_literature_list_bp 借鉴并调整)
            standard_keys_to_exclude_from_additional = ['_id', 'pdfLink', 'status', 'db_id', 'screenshots',
                                                        'localPdfFileObject', 'isSelected', 'user_id', 'created_at',
                                                        'updated_at', 'frontend_row_id']
            for mapped_key_name in backend_column_mapping:
                standard_keys_to_exclude_from_additional.extend(backend_column_mapping[mapped_key_name])  # 添加所有可能的原始列名
            # 添加模型字段的直接名称 (小写，因为 find_key_for_model 会返回原始值，但我们比较时通常用小写)
            standard_keys_to_exclude_from_additional.extend(['title', 'authors', 'year', 'source_publication', 'doi'])
            standard_keys_to_exclude_from_additional = list(
                set(key.lower().strip() for key in standard_keys_to_exclude_from_additional if key))

            for key, value in article_obj_from_frontend.items():
                if str(key).lower().strip() not in standard_keys_to_exclude_from_additional:
                    additional_data[key] = value
            additional_data_json_str = json.dumps(additional_data, ensure_ascii=False) if additional_data else None

            new_article_db_entry = LiteratureArticle(
                user_id=user_id, title=str(title_original) if title_original is not None else None,
                authors=str(authors_original) if authors_original is not None else None, year=year_cleaned,
                source_publication=str(source_pub) if source_pub is not None else None,
                doi=str(doi_value_original).strip() if doi_value_original and str(doi_value_original).strip() else None,
                frontend_row_id=frontend_row_id, pdf_link=pdf_link, status=status,
                additional_data_json=additional_data_json_str
            )
            new_articles_to_add_to_db.append(new_article_db_entry)
            added_count += 1
            if doi_value_cleaned_lower:
                existing_dois_set.add(doi_value_cleaned_lower)
            else:
                current_batch_no_doi_identifiers.add(no_doi_identifier_tuple)

        if new_articles_to_add_to_db:
            db.session.bulk_save_objects(new_articles_to_add_to_db)
            db.session.commit()
            current_app.logger.info(
                f"{log_prefix} 成功向数据库批量添加了 {len(new_articles_to_add_to_db)} 条新文献记录。")  # 使用 current_app.logger

        log_description = f"处理了 {len(articles_data_from_frontend)} 条文献记录：新增 {added_count} 条"
        log_description += f"，跳过 {skipped_count} 条重复或无效记录。" if skipped_count > 0 else "。"
        log_user_activity(user_id, "upload_literature_list", log_description)

        current_app.logger.info(
            f"{log_prefix} 文献列表处理完成。新增: {added_count}, 跳过: {skipped_count}")  # 使用 current_app.logger
        return jsonify({"success": True,
                        "message": f"文献列表处理完成。新增 {added_count} 条，跳过 {skipped_count} 条重复或无效记录。",
                        "added": added_count, "skipped": skipped_count}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"{log_prefix} 添加文献列表到数据库时发生严重错误: {e}",
                                 exc_info=True)  # 使用 current_app.logger
        return jsonify({"success": False, "message": "处理文献列表时发生服务器内部错误。"}), 500


# --- 更新单条文献记录 (PATCH /api/literature_articles/<int:article_db_id>) ---
@literature_bp.route('/literature_articles/<int:article_db_id>', methods=['PATCH', 'OPTIONS'])
def update_literature_article_route_bp(article_db_id): # 函数名可以保持或加 _bp
    if request.method == 'OPTIONS':
        # _build_cors_preflight_response 已移至 utils.py 并被导入
        return _build_cors_preflight_response()

    # --- 如果是 PATCH 请求，则执行更新逻辑 ---
    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401

    user_id = current_user_info['user_id']
    log_prefix = f"[LiteratureBP][User:{user_id}]"

    updates = request.get_json()
    if not updates or not isinstance(updates, dict):
        current_app.logger.warning(f"{log_prefix} PATCH /literature_articles/{article_db_id} 请求体无效。")
        return jsonify({"success": False, "message": "无效的请求：需要一个包含更新内容的JSON对象作为请求体。"}), 400

    current_app.logger.info(f"{log_prefix} 尝试 PATCH 更新文献记录 ID: {article_db_id}，更新内容: {updates}")

    try:
        article_to_update = LiteratureArticle.query.filter_by(id=article_db_id, user_id=user_id).first()
        if not article_to_update:
            current_app.logger.warning(f"{log_prefix} 尝试更新不存在或无权限的文献记录 (DB ID: {article_db_id})。")
            return jsonify({"success": False, "message": "未找到指定的文献记录或无权操作。"}), 404

        allowed_fields_to_update = ['pdf_link', 'status', 'title', 'authors', 'year', 'source_publication', 'doi']
        fields_updated_count = 0
        for field, value in updates.items():
            if field in allowed_fields_to_update:
                if field == 'year' and value is not None:
                    try:
                        setattr(article_to_update, field, int(value) if str(value).strip() else None)
                    except ValueError:
                        current_app.logger.warning(f"{log_prefix} 更新文献 (DB ID: {article_db_id}) 时，年份字段 '{value}' 无法转换为整数，已跳过。")
                        continue
                else:
                    setattr(article_to_update, field, value)
                fields_updated_count += 1
                current_app.logger.debug(f"{log_prefix} 文献 (DB ID: {article_db_id}) 字段 '{field}' 更新为 '{value}'")
            else:
                current_app.logger.warning(f"{log_prefix} 尝试更新不允许的字段 '{field}' (文献 DB ID: {article_db_id})。")

        if fields_updated_count > 0:
            article_to_update.updated_at = datetime.now(timezone.utc) # 确保 datetime, timezone 已导入
            db.session.commit()
            log_user_activity(user_id, "update_article_details",
                              f"更新了文献 '{str(article_to_update.title)[:30]}...' (DB ID: {article_db_id}) 的 {fields_updated_count} 个字段。",
                              related_article_db_id=article_db_id)
            current_app.logger.info(f"{log_prefix} 成功更新了文献记录 (DB ID: {article_db_id}) 的 {fields_updated_count} 个字段。")
            return jsonify({"success": True, "message": "文献记录已成功更新。" }), 200
        else:
            current_app.logger.info(f"{log_prefix} 尝试更新文献 (DB ID: {article_db_id})，但没有提供任何有效或允许更新的字段。")
            return jsonify({"success": True, "message": "请求已收到，但没有有效字段被更新。", "updated_fields_count": 0}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"{log_prefix} 更新文献记录 (DB ID: {article_db_id}) 时发生数据库错误: {e}", exc_info=True)
        return jsonify({"success": False, "message": "更新文献记录时发生服务器内部错误。"}), 500
# --- 删除单条文献记录 (DELETE /api/literature_articles/<int:article_db_id>) ---
# 注意：路径已从 /api/literature_article/... 调整为 /api/literature_articles/... 以保持一致性
@literature_bp.route('/literature_articles/<int:article_db_id>', methods=['DELETE'])
def delete_literature_article_bp(article_db_id):
    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401
    user_id = current_user_info['user_id']
    log_prefix = f"[LiteratureBP][User:{user_id}]"

    current_app.logger.info(f"{log_prefix} 尝试删除文献记录 ID: {article_db_id}")  # 使用 current_app.logger
    article_to_delete = LiteratureArticle.query.filter_by(id=article_db_id, user_id=user_id).first()
    if not article_to_delete:
        current_app.logger.warning(
            f"{log_prefix} 尝试删除不存在或无权限的文献记录 (DB ID: {article_db_id})。")  # 使用 current_app.logger
        return jsonify({"success": False, "message": "文献不存在或无权删除。"}), 404

    try:
        # 在删除文献前，需要考虑关联的截图和活动日志的处理：
        # 1. 截图：是否需要级联删除服务器上的截图文件和元数据？并更新用户存储空间？
        #    这会使此删除操作变复杂，可能需要调用截图删除的逻辑。
        #    暂时先不处理截图的级联删除，仅删除文献记录本身。
        # 2. 活动日志：UserActivityLog 中有 related_article_db_id 外键。
        #    如果外键设置了 ON DELETE SET NULL，则删除文献后，相关日志的此字段会变NULL。
        #    如果设置了 ON DELETE CASCADE，则相关日志也会被删除。
        #    如果什么都没设置且有约束，可能会删除失败。
        #    SQLAlchemy 默认的外键行为可能需要检查，或者在模型中明确定义。
        #    当前 UserActivityLog 模型中没有明确定义 ondelete 行为，SQLite默认为NO ACTION。

        title_for_log = str(article_to_delete.title)[:50]  # 获取标题用于日志
        db.session.delete(article_to_delete)
        db.session.commit()
        log_user_activity(user_id, "delete_literature_article",
                          f"删除了文献 '{title_for_log}...' (DB ID: {article_db_id})。",
                          related_article_db_id=article_db_id)  # 此处 related_article_db_id 在文献删除后可能意义不大
        current_app.logger.info(f"{log_prefix} 成功删除文献记录 (DB ID: {article_db_id})。")  # 使用 current_app.logger
        return jsonify({"success": True, "message": "文献已成功删除。"}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"{log_prefix} 删除文献 (DB ID: {article_db_id}) 时发生错误: {e}",
                                 exc_info=True)  # 使用 current_app.logger
        return jsonify({"success": False, "message": "删除失败，服务器内部错误。"}), 500


# --- 批量删除文献记录 (POST /api/literature_articles/batch_delete) ---
@literature_bp.route('/literature_articles/batch_delete', methods=['POST'])
def batch_delete_literature_articles_bp():
    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401
    user_id = current_user_info['user_id']
    log_prefix = f"[LiteratureBP][User:{user_id}]"
    data = request.get_json()
    ids_to_delete = data.get('ids', [])

    if not isinstance(ids_to_delete, list) or not ids_to_delete:
        current_app.logger.warning(f"{log_prefix} 批量删除请求缺少 'ids' 列表或列表为空。")  # 使用 current_app.logger
        return jsonify({"success": False, "message": "请求体应包含一个非空的 'ids' 列表。"}), 400

    # 将ID转换为整数，并过滤掉无效的ID
    valid_ids_to_delete = []
    for item_id in ids_to_delete:
        try:
            valid_ids_to_delete.append(int(item_id))
        except ValueError:
            current_app.logger.warning(f"{log_prefix} 批量删除时遇到无效ID: {item_id}，已忽略。")  # 使用 current_app.logger

    if not valid_ids_to_delete:
        return jsonify({"success": False, "message": "提供的ID列表无效或为空。"}), 400

    current_app.logger.info(
        f"{log_prefix} 尝试批量删除 {len(valid_ids_to_delete)} 条文献记录。IDs: {valid_ids_to_delete}")  # 使用 current_app.logger
    try:
        # 同样，需要考虑关联截图和活动日志的处理
        # 此处仅删除文献记录本身
        deleted_count = LiteratureArticle.query.filter(
            LiteratureArticle.user_id == user_id,
            LiteratureArticle.id.in_(valid_ids_to_delete)  # 使用 SQLAlchemy 的 in_()
        ).delete(synchronize_session=False)  # synchronize_session=False 通常在批量删除时推荐

        db.session.commit()

        if deleted_count > 0:
            log_user_activity(user_id, "batch_delete_literature_articles", f"批量删除了 {deleted_count} 条文献记录。")
            current_app.logger.info(f"{log_prefix} 成功批量删除了 {deleted_count} 条文献记录。")  # 使用 current_app.logger
        else:
            current_app.logger.info(
                f"{log_prefix} 批量删除操作完成，但没有符合条件的文献被删除（可能ID不存在或不属于该用户）。")  # 使用 current_app.logger

        return jsonify({"success": True, "message": f"成功从数据库中移除了 {deleted_count} 条文献。",
                        "deleted_count": deleted_count}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"{log_prefix} 批量删除文献时发生错误: {e}", exc_info=True)  # 使用 current_app.logger
        return jsonify({"success": False, "message": "批量删除失败，服务器内部错误。"}), 500


# --- 查找PDF链接 (GET /api/find-pdf) ---
@literature_bp.route('/find-pdf', methods=['GET'])
def get_pdf_link_api_route_bp():
    # 注意：此路由不直接与特定用户数据关联，但其内部调用的 find_pdf_link
    # 可能会使用配置中的 MY_EMAIL_FOR_APIS (通过 current_app.config)
    # 以及 SCI_HUB_DOMAINS (通过 current_app.config)
    log_prefix = "[LiteratureBP]"
    doi = request.args.get('doi')
    title = request.args.get('title')

    if not doi and not title:
        current_app.logger.warning(f"{log_prefix} /find-pdf 请求缺少 DOI 和 Title 参数。")  # 使用 current_app.logger
        return jsonify({"success": False, "message": "DOI 或 Title 参数至少需要一个。"}), 400  # 返回 success: False

    if doi and not re.match(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+$", doi, re.IGNORECASE):  # re 模块已导入
        current_app.logger.warning(f"{log_prefix} /find-pdf 请求中的DOI格式无效: {doi}")  # 使用 current_app.logger
        return jsonify({"success": False, "message": "提供的DOI格式无效。"}), 400  # 返回 success: False

    # 调用 find_pdf_link 函数 (假设已正确导入或定义)
    # find_pdf_link 函数内部应使用 current_app.logger 和 current_app.config
    pdf_link_found = find_pdf_link(doi=doi, title=title)

    if pdf_link_found:
        current_app.logger.info(
            f"{log_prefix} /find-pdf 成功找到链接: {pdf_link_found} (查询DOI: '{doi}', 标题: '{title}')")  # 使用 current_app.logger
        return jsonify({"success": True, "pdfLink": pdf_link_found, "message": "PDF链接查找成功。"}), 200
    else:
        current_app.logger.info(
            f"{log_prefix} /find-pdf 未能找到链接 (查询DOI: '{doi}', 标题: '{title}')")  # 使用 current_app.logger
        return jsonify({"success": False, "pdfLink": None, "message": "未能找到PDF链接。"}), 404



