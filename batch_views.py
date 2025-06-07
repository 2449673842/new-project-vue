# backend/batch_views.py
from urllib.parse import urlparse

import requests
from flask import Blueprint, request, jsonify, current_app, send_from_directory, send_file, make_response, Response, \
    stream_with_context
import os
import shutil
import zipfile
import time
import uuid # batch_process_and_zip_route_bp 中模拟job_id时使用
import io   # proxy_pdf_bp 和 download_article_screenshots_zip_route (后者在screenshot_views.py)
from filelock import FileLock, Timeout

# 从同级目录的 utils.py 导入需要的辅助函数
from utils import (
    generate_task_id,
    load_download_records,
    save_download_records,
    sanitize_filename,
    get_current_user_from_token,  # proxy_pdf_bp 需要
    REQUEST_SESSION,  # proxy_pdf_bp 和 perform_batch_processing_logic 中的 download_pdf_to_server 会用
    download_pdf_to_server, log_user_activity  # perform_batch_processing_logic 需要
)
# 注意：download_pdf_to_server 内部也使用 REQUEST_SESSION，这没问题，因为它们都在 utils.py 中定义或被正确导入

batch_bp = Blueprint('batch_bp', __name__, url_prefix='/api')

# === 核心批量处理逻辑 (原 perform_batch_processing_logic) ===
# 此函数现在是 batch_views.py 的一部分，因为它与 batch_process_and_zip_route_bp 紧密相关
def _perform_batch_processing_for_blueprint(articles_to_process, content_based_task_id):
    log_prefix = f"[BatchWorkerBP:{content_based_task_id}]"
    current_app.logger.info(f"{log_prefix} 开始执行批量处理任务，共 {len(articles_to_process)} 篇文章。")

    batch_temp_root_dir = current_app.config.get('BATCH_TEMP_ROOT_DIR')
    zipped_files_dir = current_app.config.get('ZIPPED_FILES_DIR')

    if not batch_temp_root_dir or not zipped_files_dir:
        current_app.logger.error(f"{log_prefix} 关键路径配置 BATCH_TEMP_ROOT_DIR 或 ZIPPED_FILES_DIR 未找到！")
        _temp_update_final_record_for_blueprint(content_based_task_id, "FAILED", error_message="服务器路径配置错误")
        return {"status": "FAILED", "message": "服务器路径配置错误"}

    current_task_temp_dir = os.path.join(batch_temp_root_dir, content_based_task_id)
    if os.path.exists(current_task_temp_dir):
        current_app.logger.info(f"{log_prefix} 检测到旧的临时目录，正在移除: {current_task_temp_dir}")
        shutil.rmtree(current_task_temp_dir)
    try:
        os.makedirs(current_task_temp_dir)
        current_app.logger.info(f"{log_prefix} 已创建临时目录: {current_task_temp_dir}")
    except OSError as e:
        current_app.logger.error(f"{log_prefix} 创建临时目录 '{current_task_temp_dir}' 失败: {e}", exc_info=True)
        _temp_update_final_record_for_blueprint(content_based_task_id, "FAILED", error_message=f"创建临时目录失败: {e}", num_requested=len(articles_to_process))
        return {"status": "FAILED", "message": f"创建临时目录失败: {e}"}

    downloaded_files_paths = []
    failed_articles_info = []
    download_success_count = 0

    for index, article_data in enumerate(articles_to_process):
        pdf_url = article_data.get('pdfLink')
        title = article_data.get('title')
        doi = article_data.get('doi', 'N/A')

        if not pdf_url or not title:
            current_app.logger.warning(f"{log_prefix} 第 {index+1} 篇文章 (标题: {title or '未知'}, DOI: {doi}) 缺少PDF链接或标题。跳过。")
            failed_articles_info.append({"title": title or "未知", "doi": doi, "reason": "缺少PDF链接或标题"})
            continue

        current_app.logger.info(f"{log_prefix} 正在下载第 {index+1}/{len(articles_to_process)} 篇文章: '{title}' (URL: '{pdf_url}')")
        saved_path = download_pdf_to_server(pdf_url, title, current_task_temp_dir) # 从 utils.py 导入

        if saved_path:
            current_app.logger.info(f"{log_prefix} 成功下载: {saved_path}")
            downloaded_files_paths.append(saved_path)
            download_success_count += 1
        else:
            current_app.logger.warning(f"{log_prefix} 下载失败: 文章 '{title}' (URL: '{pdf_url}')")
            failed_articles_info.append({"title": title, "doi": doi, "pdfLink_attempted": pdf_url, "reason": "下载或保存失败"})

    if not downloaded_files_paths:
        current_app.logger.warning(f"{log_prefix} 此批量任务中没有PDF文件被成功下载。")
        if os.path.exists(current_task_temp_dir):
            shutil.rmtree(current_task_temp_dir)
            current_app.logger.info(f"{log_prefix} 已移除空的临时目录: {current_task_temp_dir}")
        _temp_update_final_record_for_blueprint(content_based_task_id, "FAILED_NO_DOWNLOADS", message="没有PDF被成功下载。", num_requested=len(articles_to_process), failed_items=failed_articles_info)
        return {"status": "FAILED", "message": "没有PDF被成功下载。", "failed_items": failed_articles_info}

    zip_filename_base = sanitize_filename(f"文献包_{content_based_task_id[:8]}", extension="")
    final_zip_filename = f"{zip_filename_base}.zip"
    final_zip_file_path = os.path.join(zipped_files_dir, final_zip_filename)

    try:
        current_app.logger.info(f"{log_prefix} 正在创建ZIP文件: {final_zip_file_path}，包含 {len(downloaded_files_paths)} 个文件。")
        with zipfile.ZipFile(final_zip_file_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for file_to_zip in downloaded_files_paths:
                zipf.write(file_to_zip, os.path.basename(file_to_zip))
        current_app.logger.info(f"{log_prefix} ZIP文件创建成功: {final_zip_filename}")
    except Exception as e_zip:
        current_app.logger.error(f"{log_prefix} 创建ZIP包 '{final_zip_file_path}' 失败: {e_zip}", exc_info=True)
        if os.path.exists(final_zip_file_path):
            try: os.remove(final_zip_file_path)
            except OSError as e_rm_zip: current_app.logger.error(f"{log_prefix} 删除部分创建的ZIP包 '{final_zip_file_path}' 失败: {e_rm_zip}")
        _temp_update_final_record_for_blueprint(content_based_task_id, "FAILED_ZIP_CREATION", error_message=str(e_zip), num_requested=len(articles_to_process), num_success=download_success_count, failed_items=failed_articles_info)
        return {"status": "FAILED", "message": f"创建ZIP包失败: {e_zip}"}
    finally:
        if os.path.exists(current_task_temp_dir):
            shutil.rmtree(current_task_temp_dir)
            current_app.logger.info(f"{log_prefix} 已清理临时下载目录: {current_task_temp_dir}")

    _temp_update_final_record_for_blueprint(content_based_task_id, "COMPLETED",
                              zip_filename=final_zip_filename,
                              num_requested=len(articles_to_process),
                              num_success=download_success_count,
                              failed_items=failed_articles_info)

    current_app.logger.info(f"{log_prefix} 批量处理任务成功完成。ZIP包: {final_zip_filename}, 处理统计: {download_success_count}/{len(articles_to_process)}")
    return {
        "status": "COMPLETED", "zip_download_filename": final_zip_filename,
        "task_id": content_based_task_id, "total_requested": len(articles_to_process),
        "successfully_processed": download_success_count, "failed_items": failed_articles_info
    }

# === 临时辅助函数 (原 _temp_update_final_record) ===
# 此函数现在是 batch_views.py 的一部分
def _temp_update_final_record_for_blueprint(task_id, status, zip_filename=None, message=None, error_message=None, num_requested=0, num_success=0, failed_items=None):
    log_prefix = f"[BatchWorkerBP:{task_id}]" # 使用与任务处理函数一致的前缀
    download_records_file_path = current_app.config.get('DOWNLOAD_RECORDS_FILE')
    if not download_records_file_path:
        current_app.logger.error(f"{log_prefix} DOWNLOAD_RECORDS_FILE 未在应用配置中定义！无法更新最终记录。")
        return

    lock_path = download_records_file_path + ".lock" # 为记录文件定义一个锁文件路径

    try:
        # 获取文件锁，超时时间设为例如10秒 (根据实际情况调整)
        with FileLock(lock_path, timeout=10):
            current_app.logger.debug(f"{log_prefix} 获取到下载记录文件锁: {lock_path}")
            records = load_download_records() # utils.py 中的函数

            record_data = records.get(task_id, {}) # 获取现有记录或创建新记录
            record_data.update({ # 更新或添加字段
                "timestamp_processed": time.strftime("%Y-%m-%d %H:%M:%S"),
                "status": status,
                "zip_filename": zip_filename,
                "message": message,
                "error_message": error_message,
                # 如果是初始记录，这些可能还不存在，所以要安全地更新
                "num_requested": num_requested if num_requested > 0 else record_data.get("num_requested", 0),
                "num_success": num_success if num_success > 0 else record_data.get("num_success", 0),
                "failed_items": failed_items if failed_items is not None else record_data.get("failed_items", [])
            })
            # 确保初始提交信息（如果存在）不会被覆盖
            if "timestamp_submitted" not in record_data:
                 record_data["timestamp_submitted"] = record_data.get("timestamp_processed") # 如果是新失败记录，提交时间就是处理时间
            if "job_id" not in record_data:
                 record_data["job_id"] = record_data.get("job_id") # 保留可能存在的 job_id

            records[task_id] = record_data

            if save_download_records(records): # utils.py 中的函数
                current_app.logger.info(f"{log_prefix} 已更新并保存下载记录。状态: {status}, ZIP: {zip_filename}")
            else:
                current_app.logger.error(f"{log_prefix} 保存更新后的下载记录失败！")
        current_app.logger.debug(f"{log_prefix} 已释放下载记录文件锁: {lock_path}")
    except Timeout: # FileLock 超时异常
        current_app.logger.error(f"{log_prefix} 获取下载记录文件锁超时 ({lock_path})。记录可能未更新。")
    except Exception as e_lock:
         current_app.logger.error(f"{log_prefix} 处理下载记录时发生文件锁相关错误: {e_lock}", exc_info=True)


# === 路由定义 ===
@batch_bp.route('/batch_process_and_zip', methods=['POST'])
def batch_process_and_zip_route_bp():
    # ... (前面的请求验证和 content_based_task_id 生成逻辑不变) ...
    log_prefix = "[BatchRouteBP]"
    # (data validation and content_based_task_id generation...)
    data = request.get_json()
    if not data or 'articles' not in data or not isinstance(data['articles'], list):
        return jsonify({"success": False, "message": "请求体必须是包含 'articles' 列表的JSON。"}), 400
    articles_to_process = data['articles']
    if not articles_to_process:
        return jsonify({"success": False, "message": "'articles' 列表不能为空。"}), 400

    content_based_task_id = generate_task_id(articles_to_process)
    if not content_based_task_id:
        current_app.logger.error(f"{log_prefix} 无法为批量任务生成基于内容的标识符。")
        return jsonify({"success": False, "message": "无法生成任务标识符。"}), 500

    # --- 文件锁应用于读取和写入 download_records.json ---
    download_records_file_path = current_app.config.get('DOWNLOAD_RECORDS_FILE')
    if not download_records_file_path:
        current_app.logger.error(f"{log_prefix} DOWNLOAD_RECORDS_FILE 未在应用配置中定义！")
        return jsonify({"success": False, "message": "服务器配置错误。"}), 500
    lock_path = download_records_file_path + ".lock"

    try:
        with FileLock(lock_path, timeout=10): # 获取文件锁
            current_app.logger.debug(f"{log_prefix} 获取到下载记录文件锁 (for task submission): {lock_path}")
            download_records = load_download_records()

            if content_based_task_id in download_records:
                record = download_records[content_based_task_id]
                current_status = record.get('status')
                # ... (处理 previously_processed_completed 和 already_processing_or_submitted 的逻辑不变) ...
                if current_status == "COMPLETED":
                    # ... (省略，与之前相同，确保此部分代码也在此 with FileLock块内，虽然它只读)
                    zipped_files_dir_config = current_app.config.get('ZIPPED_FILES_DIR')
                    if not zipped_files_dir_config:
                        current_app.logger.error(f"{log_prefix} ZIPPED_FILES_DIR 未在应用配置中设置！")
                        # 释放锁
                        current_app.logger.debug(f"{log_prefix} 释放下载记录文件锁 (因配置错误): {lock_path}")
                        return jsonify({"success": False, "message": "服务器配置错误：存储路径未定义。"}), 500

                    zip_filename_from_record = record.get('zip_filename')
                    if zip_filename_from_record:
                        zip_path_to_check = os.path.join(zipped_files_dir_config, zip_filename_from_record)
                        if os.path.exists(zip_path_to_check):
                            current_app.logger.info(f"{log_prefix} 内容ID '{content_based_task_id}' 的任务之前已成功处理。返回缓存结果。")
                            current_app.logger.debug(f"{log_prefix} 释放下载记录文件锁 (previously_processed): {lock_path}")
                            return jsonify({
                                "success": True, "status": "previously_processed_completed",
                                # ... (其他字段)
                            }), 200
                elif current_status in ["PROCESSING", "SUBMITTED", "PENDING"]:
                    current_app.logger.info(f"{log_prefix} 内容ID '{content_based_task_id}' 的任务当前状态为 '{current_status}'。")
                    current_app.logger.debug(f"{log_prefix} 释放下载记录文件锁 (already_processing): {lock_path}")
                    return jsonify({
                        "success": True, "status": "already_processing_or_submitted",
                        # ... (其他字段)
                    }), 202

            # 如果记录不存在，或状态允许重新提交，则创建/更新初始记录
            current_app.logger.info(f"{log_prefix} 准备提交/重新提交新的异步批量处理任务。内容ID: '{content_based_task_id}', 文章数: {len(articles_to_process)}")
            simulated_celery_job_id = str(uuid.uuid4())

            initial_task_record = {
                "timestamp_submitted": time.strftime("%Y-%m-%d %H:%M:%S"),
                "job_id": simulated_celery_job_id, "status": "SUBMITTED",
                "num_requested": len(articles_to_process), "zip_filename": None,
                "message": "任务已提交，等待后台处理。", "failed_items": []
            }
            download_records[content_based_task_id] = initial_task_record # 在锁内修改

            if not save_download_records(download_records): # 在锁内保存
                current_app.logger.error(f"{log_prefix} 保存初始任务记录失败！")
                current_app.logger.debug(f"{log_prefix} 释放下载记录文件锁 (因保存失败): {lock_path}")
                return jsonify({"success": False, "message": "保存任务初始记录时发生错误。"}), 500

            current_app.logger.info(f"{log_prefix} 已为任务 '{content_based_task_id}' 创建/更新初始状态记录 (SUBMITTED)，模拟Job ID: {simulated_celery_job_id}.")
            # === Celery 任务提交逻辑（异步）应在释放锁之后，或者确保任务提交本身不依赖此锁 ===
            # _perform_batch_processing_for_blueprint.delay(...)

        current_app.logger.debug(f"{log_prefix} 释放下载记录文件锁 (task submission): {lock_path}")
        # 异步任务的提交（如果适用）应该在锁之外，或者提交一个不直接操作此JSON文件的任务
        # 如果 _perform_batch_processing_for_blueprint 是同步调用（仅用于测试），它内部的 _temp_update_final_record_for_blueprint 也需要处理锁
        # 我们当前的 _perform_batch_processing_for_blueprint 调用是被注释掉的，所以这里没问题

        return jsonify({
            "success": True, "status": "processing_submitted",
            "message": "批量处理任务已成功提交到后台队列。",
            "task_id": content_based_task_id, "job_id": simulated_celery_job_id
        }), 202

    except Timeout: # FileLock 超时异常
        current_app.logger.error(f"{log_prefix} 获取下载记录文件锁超时 ({lock_path})。任务提交可能失败。")
        return jsonify({"success": False, "message": "服务器繁忙，请稍后再试。"}), 503 # Service Unavailable
    except Exception as e:
        current_app.logger.error(f"{log_prefix} 准备或提交批量任务时（锁内操作）发生错误 (内容ID: '{content_based_task_id}'): {e}", exc_info=True)
        return jsonify({"success": False, "message": "准备或提交批量处理任务失败。"}), 500


@batch_bp.route('/delete_batch_record', methods=['POST'])
def delete_batch_record_route_bp():
    log_prefix = "[BatchRouteBP]"  # 可以保持或改为 [BatchDeleteBP]
    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401
    user_id = current_user_info['user_id']

    data = request.get_json()
    task_id_to_delete = data.get('task_id') if data else None
    if not task_id_to_delete:
        current_app.logger.warning(f"{log_prefix}[User:{user_id}] 删除批量记录请求缺少 'task_id'。")
        return jsonify({"success": False, "message": "请求参数 'task_id' 缺失。"}), 400

    current_app.logger.info(f"{log_prefix}[User:{user_id}] 尝试删除批量记录，Task ID: {task_id_to_delete}")

    download_records_file_path = current_app.config.get('DOWNLOAD_RECORDS_FILE')
    if not download_records_file_path:
        current_app.logger.error(f"{log_prefix}[User:{user_id}] DOWNLOAD_RECORDS_FILE 未在应用配置中定义！无法删除记录。")
        return jsonify({"success": False, "message": "服务器配置错误。"}), 500
    lock_path = download_records_file_path + ".lock"

    try:
        with FileLock(lock_path, timeout=10):  # 获取文件锁
            current_app.logger.debug(
                f"{log_prefix}[User:{user_id}] 获取到下载记录文件锁 (for deleting record {task_id_to_delete}): {lock_path}")
            records = load_download_records()  # 从 utils.py 导入

            if task_id_to_delete in records:
                record_to_delete = records.pop(task_id_to_delete)

                if not save_download_records(records):  # 保存更新后的记录字典 (在锁内)
                    current_app.logger.error(
                        f"{log_prefix}[User:{user_id}] 保存删除 '{task_id_to_delete}' 后的记录失败！记录可能未完全删除。")
                    # 即使保存失败，也应该尝试继续删除ZIP文件（如果存在），但要告知用户可能的不一致
                    # 或者，更安全的做法是如果保存失败，则不进行ZIP删除，并返回错误
                    # 此处我们选择如果保存失败，则返回错误，不删除ZIP
                    current_app.logger.debug(
                        f"{log_prefix}[User:{user_id}] 释放下载记录文件锁 (因保存失败): {lock_path}")
                    return jsonify({"success": False, "message": "删除任务记录时保存更新失败。"}), 500

                # 如果记录保存成功，则继续尝试删除关联的ZIP文件
                msg = f"任务ID '{task_id_to_delete}' 的记录已从JSON中删除。"
                zip_to_delete_path = os.path.join(current_app.config.get('ZIPPED_FILES_DIR', 'zipped_downloads'),
                                                  record_to_delete.get('zip_filename', ''))
                if record_to_delete.get('zip_filename') and os.path.exists(zip_to_delete_path):
                    try:
                        os.remove(zip_to_delete_path)
                        msg += f" 关联的ZIP文件 '{record_to_delete.get('zip_filename')}' 已删除。"
                        current_app.logger.info(
                            f"{log_prefix}[User:{user_id}] 关联的ZIP文件 '{zip_to_delete_path}' 已删除。")
                    except OSError as e_rm_zip:
                        msg += f" 但删除关联的ZIP文件失败: {e_rm_zip}."  # 即使ZIP删除失败，记录也已删除
                        current_app.logger.error(
                            f"{log_prefix}[User:{user_id}] 删除ZIP文件 '{zip_to_delete_path}' 失败: {e_rm_zip}",
                            exc_info=True)

                log_user_activity(user_id, "delete_batch_zip_record",
                                  f"删除了批量下载任务记录 (Task ID: {task_id_to_delete}). ZIP文件状态: {'已删除' if record_to_delete.get('zip_filename') and not os.path.exists(zip_to_delete_path) else ('无关联ZIP' if not record_to_delete.get('zip_filename') else '删除失败或未找到')}.")
                current_app.logger.debug(
                    f"{log_prefix}[User:{user_id}] 释放下载记录文件锁 (record deleted): {lock_path}")
                return jsonify({"success": True, "message": msg}), 200
            else:
                current_app.logger.warning(
                    f"{log_prefix}[User:{user_id}] 未找到要删除的批量记录，Task ID: {task_id_to_delete}")
                current_app.logger.debug(
                    f"{log_prefix}[User:{user_id}] 释放下载记录文件锁 (record not found): {lock_path}")
                return jsonify({"success": False, "message": f"任务ID '{task_id_to_delete}' 未找到。"}), 404
    except Timeout:
        current_app.logger.error(f"{log_prefix}[User:{user_id}] 获取下载记录文件锁超时 ({lock_path})。删除操作未执行。")
        return jsonify({"success": False, "message": "服务器繁忙，请稍后再试。"}), 503
    except Exception as e_lock_del:
        current_app.logger.error(
            f"{log_prefix}[User:{user_id}] 处理删除记录时发生文件锁相关或其他错误 (Task ID: {task_id_to_delete}): {e_lock_del}",
            exc_info=True)
        return jsonify({"success": False, "message": "删除记录时发生内部错误。"}), 500


@batch_bp.route('/download_zip_package/<path:filename>', methods=['GET'])  # 使用 <path:filename> 以允许文件名中包含点号等
def download_zip_package_route_bp(filename):  # 重命名函数以示区分
    # 即使这个接口目前不严格校验文件是否属于特定用户（因为文件名本身是基于任务ID生成的，不易猜测），
    # 但进行用户认证仍然是一个好习惯，可以防止匿名访问和潜在的扫描行为。
    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401
    user_id = current_user_info['user_id']
    log_prefix = f"[BatchViewsBP][User:{user_id}]"  # 包含用户ID的日志前缀

    current_app.logger.info(f"{log_prefix} 用户请求下载ZIP包: '{filename}'")

    # 1. 安全性：净化文件名，防止路径遍历
    # os.path.basename() 会移除路径信息，只留下文件名部分。
    # 这是防止用户尝试输入如 "../../secret_file.txt" 这样的路径遍历攻击的重要步骤。
    safe_filename = os.path.basename(filename)

    # 再次检查净化后的文件名是否仍包含不应有的路径分隔符 (双重保险)
    if ".." in safe_filename or "/" in safe_filename or "\\" in safe_filename:
        current_app.logger.error(
            f"{log_prefix} 下载ZIP包请求包含无效或恶意的文件名: '{filename}' (净化后: '{safe_filename}')")
        return jsonify({"success": False, "message": "无效的文件名。"}), 400

    # 2. 获取ZIP文件存储目录的配置
    zipped_files_dir_from_config = current_app.config.get('ZIPPED_FILES_DIR')
    if not zipped_files_dir_from_config:
        current_app.logger.error(f"{log_prefix} ZIPPED_FILES_DIR 未在应用配置中设置！ZIP包下载失败。")
        return jsonify({"success": False, "message": "服务器配置错误：存储路径未定义。"}), 500

    # 确保目录是绝对路径（config.py中应该已经处理了）
    absolute_zipped_files_dir = os.path.abspath(zipped_files_dir_from_config)

    current_app.logger.info(f"{log_prefix} 尝试从目录 '{absolute_zipped_files_dir}' 发送ZIP文件: '{safe_filename}'")

    # 3. 使用 send_from_directory 安全地发送文件
    try:
        # send_from_directory 会自动处理文件的存在性检查，如果文件不存在会抛出 NotFound (404) 异常。
        # 它也会根据文件扩展名设置合适的MIME类型。
        return send_from_directory(
            absolute_zipped_files_dir,
            safe_filename,
            as_attachment=True  # 确保浏览器提示用户下载，而不是尝试显示内容
            # download_name 参数可以用来指定浏览器下载对话框中显示的文件名，
            # 如果您希望覆盖原始文件名（safe_filename），可以在这里设置。
            # 例如，可以添加一个更友好的时间戳或前缀：
            # download_name=f"文献集_{time.strftime('%Y%m%d')}_{safe_filename}"
        )
    except FileNotFoundError:  # Werkzeug 的 NotFound 异常，通常被 Flask 转换为404响应
        current_app.logger.warning(
            f"{log_prefix} 请求下载的ZIP文件未找到: '{safe_filename}' 在目录 '{absolute_zipped_files_dir}'")
        return jsonify({"success": False, "message": "请求的ZIP文件未找到。"}), 404
    except Exception as e_send_zip:
        current_app.logger.error(f"{log_prefix} 发送ZIP包 '{safe_filename}' 时发生未知服务器错误: {e_send_zip}",
                                 exc_info=True)
        return jsonify({"success": False, "message": "发送ZIP包时发生服务器错误。"}), 500


# backend/batch_views.py
# ... (确保顶部的导入包含了 Blueprint, request, jsonify, current_app, Response, stream_with_context from flask;
#      os, urlparse from urllib.parse; get_current_user_from_token, REQUEST_SESSION, sanitize_filename from utils) ...
from flask import Response, stream_with_context  # 确保导入
from urllib.parse import urlparse  # 确保导入
import os  # 确保导入


@batch_bp.route('/proxy-pdf', methods=['GET'])
def proxy_pdf_bp():
    # 1. 用户认证 (防止滥用代理功能)
    current_user_info = get_current_user_from_token()
    if not current_user_info:
        return jsonify({"success": False, "message": "认证失败或Token无效。"}), 401

    user_id = current_user_info['user_id']
    log_prefix = f"[ProxyPdfBP][User:{user_id}]"

    # 2. 获取要代理的PDF的外部URL
    pdf_url_to_proxy = request.args.get('url')
    if not pdf_url_to_proxy:
        current_app.logger.warning(f"{log_prefix} PDF代理请求缺少 'url' 参数。")
        return jsonify({"success": False, "message": "缺少 'url' 参数。"}), 400

    current_app.logger.info(f"{log_prefix} 正在尝试通过流式代理获取PDF: {pdf_url_to_proxy}")

    try:
        # 3. 使用 REQUEST_SESSION (从 utils.py 导入) 发送GET请求，并启用流模式
        proxied_response = REQUEST_SESSION.get(pdf_url_to_proxy, stream=True, timeout=60)
        proxied_response.raise_for_status()  # 检查HTTP错误

        # 4. 获取原始响应的 Content-Type，默认为 application/pdf
        response_content_type = proxied_response.headers.get('Content-Type', 'application/pdf')
        if 'application/pdf' not in response_content_type.lower():
            current_app.logger.warning(
                f"{log_prefix} 代理的URL '{pdf_url_to_proxy}' 返回的Content-Type不是PDF: '{response_content_type}'。仍将尝试以流式发送。"
            )

        # 5. 定义一个生成器函数，用于逐块读取和产生数据
        def generate_pdf_chunks():
            try:
                for chunk in proxied_response.iter_content(chunk_size=8192):  # 8KB的块大小
                    if chunk:
                        yield chunk
            except Exception as e_chunk:
                current_app.logger.error(
                    f"{log_prefix} 在流式传输PDF数据块时发生错误 (URL: {pdf_url_to_proxy}): {e_chunk}", exc_info=True)
            finally:
                proxied_response.close()  # 确保在流结束后关闭原始响应连接

        # 6. 构造响应头
        original_filename_from_url = os.path.basename(urlparse(pdf_url_to_proxy).path)
        if not original_filename_from_url or not original_filename_from_url.lower().endswith('.pdf'):
            original_filename_from_url = "proxied_document.pdf"

        headers = {
            'Content-Type': response_content_type,
            'Content-Disposition': f'inline; filename="{sanitize_filename(original_filename_from_url, extension="")}.pdf"',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        }

        # 7. 返回流式响应
        return Response(stream_with_context(generate_pdf_chunks()), headers=headers)

    except requests.exceptions.Timeout:
        current_app.logger.error(f"{log_prefix} 代理请求超时: {pdf_url_to_proxy}", exc_info=False)
        return jsonify({"success": False, "message": "代理请求超时: 目标服务器未在规定时间内响应。"}), 504
    except requests.exceptions.HTTPError as e_http:
        status_code = e_http.response.status_code if e_http.response is not None else 502
        current_app.logger.error(f"{log_prefix} 代理请求遇到HTTP错误: {pdf_url_to_proxy} - 状态码: {status_code}",
                                 exc_info=False)
        error_message_from_upstream = f"目标服务器返回错误: {status_code}"
        if status_code == 404:
            error_message_from_upstream = "无法在目标服务器上找到请求的PDF资源。"
        return jsonify(
            {"success": False, "message": error_message_from_upstream}), status_code if status_code >= 400 else 502
    except requests.exceptions.ConnectionError as e_conn:
        current_app.logger.error(f"{log_prefix} 代理请求连接错误: {pdf_url_to_proxy} - {e_conn}", exc_info=False)
        return jsonify({"success": False, "message": "无法连接到目标PDF服务器。"}), 502
    except Exception as e_unknown:
        current_app.logger.error(f"{log_prefix} 后端代理PDF时发生未知错误: {e_unknown}", exc_info=True)
        return jsonify({"success": False, "message": "后端代理PDF时发生内部错误。"}), 500

# ... (batch_views.py 中的其他路由) ...
