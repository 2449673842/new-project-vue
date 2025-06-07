# backend/utils.py
import os
import re
import math
import json # 虽然 response.json() 不需要，但如果其他地方手动解析JSON则可能需要
import jwt
from datetime import datetime, timezone, timedelta
from flask import request, current_app, make_response, jsonify # jsonify 可能在这里用不到，但在蓝图中会用
import requests
from bs4 import BeautifulSoup
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, quote_plus, urlparse
import hashlib # <--- generate_task_id 需要
import json    # <--- load/save_download_records 需要
from models import db, UserActivityLog # 确保路径正确

# --- 将 REQUEST_SESSION 移到 utils.py ---
REQUEST_SESSION = requests.Session()
REQUEST_SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36 LitFinderBot/1.1"
})


# 注意：现在 BACKEND_COLUMN_MAPPING 将从 current_app.config 中获取

def get_current_user_from_token():
    # 使用 current_app 访问 logger 和 config
    auth_header = request.headers.get('Authorization')

    if auth_header:
        if auth_header.startswith('Bearer '):
            current_app.logger.debug("[AuthUtil] Received 'Bearer' type Authorization header.")
            token_value = auth_header.split(" ")[1]
            current_app.logger.debug("[AuthUtil] Token extracted from header.")

            try:
                secret_key = current_app.config.get('SECRET_KEY')
                if not secret_key:
                    current_app.logger.error("[AuthUtil] SECRET_KEY not configured in the application!")
                    return None

                payload = jwt.decode(token_value, secret_key, algorithms=['HS256'])

                log_payload_keys = list(payload.keys())
                log_payload_exp = payload.get('exp')
                current_app.logger.debug(
                    f"[AuthUtil] Token decoded successfully. Payload keys: {log_payload_keys}, Expiration (exp): {log_payload_exp}")

                user_id = payload.get('user_id')
                username = payload.get('username', 'UnknownUser')

                if not user_id:
                    current_app.logger.warning("[AuthUtil] Token payload does not contain 'user_id'.")
                    return None

                return {"user_id": user_id, "username": username}

            except jwt.ExpiredSignatureError:
                current_app.logger.warning("[AuthUtil] Token has expired.")
                return None
            except jwt.InvalidTokenError as e:
                current_app.logger.warning(f"[AuthUtil] Invalid token during decode: {e}")
                return None
            except Exception as e:
                current_app.logger.error(f"[AuthUtil] An unexpected error occurred during token decoding: {e}",
                                         exc_info=True)
                return None
        else:
            current_app.logger.debug(
                f"[AuthUtil] Received Authorization header, but not 'Bearer' type. Header: {auth_header[:30]}...")
            return None
    else:
        current_app.logger.debug("[AuthUtil] Authorization header missing.")
    return None


def log_user_activity(user_id, activity_type, description, related_article_db_id=None):
    # 使用 current_app 访问 logger
    if not user_id or not activity_type or not description:
        current_app.logger.warning(
            f"[ActivityLogUtil] 尝试记录活动失败：缺少必要参数 (user_id, activity_type, description)。")
        return

    try:
        log_entry = UserActivityLog(  # UserActivityLog 从 .models 导入
            user_id=user_id,
            activity_type=activity_type,
            description=description,
            related_article_db_id=related_article_db_id
        )
        db.session.add(log_entry)  # db 从 .models 导入
        db.session.commit()
        current_app.logger.info(
            f"[ActivityLogUtil] 活动已记录 - User: {user_id}, Type: {activity_type}, Desc: {description[:60]}...")
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(
            f"[ActivityLogUtil] 记录用户活动时发生数据库错误 (User: {user_id}, Type: {activity_type}): {e}",
            exc_info=True)


def find_key_for_model(article_data_dict, target_model_key):
    # 从 current_app.config 获取 BACKEND_COLUMN_MAPPING
    backend_column_mapping = current_app.config.get('APP_BACKEND_COLUMN_MAPPING', {})  # 提供默认空字典以防万一

    normalized_article_data_dict = {str(k).lower().strip(): v for k, v in article_data_dict.items()}

    if target_model_key not in backend_column_mapping:
        # 如果目标键不在映射中，直接尝试按原样（小写、去空格）查找
        return normalized_article_data_dict.get(str(target_model_key).lower().strip())

    possible_frontend_keys = backend_column_mapping.get(target_model_key, [])  # 安全获取
    for key_variant in possible_frontend_keys:
        normalized_key_variant = str(key_variant).lower().strip()
        if normalized_key_variant in normalized_article_data_dict:
            return normalized_article_data_dict[normalized_key_variant]
    return None


def sanitize_filename(filename_base, extension=".pdf"):
    if not filename_base:
        filename_base = "untitled_document"
    filename_base = str(filename_base)
    filename_base = re.sub(r'[/\\]', '_', filename_base)
    filename_base = re.sub(r'[<>:"|?*]', '_', filename_base)
    filename_base = re.sub(r'[\s_]+', '_', filename_base)  # 将多个空格或下划线替换为单个下划线
    filename_base = filename_base.strip('_.')  # 移除首尾的下划线或点
    max_len_base = 50  # 文件名基础部分的最大长度
    if len(filename_base) > max_len_base:
        filename_base = filename_base[:max_len_base]
        # 尝试在截断后，从后向前找到最后一个下划线，以避免切断单词
        last_underscore = filename_base.rfind('_')
        if last_underscore > max_len_base / 2:  # 仅当有意义时才截断到下划线
            filename_base = filename_base[:last_underscore]
    if not filename_base:  # 如果处理后变为空（例如，原始输入只有特殊字符）
        filename_base = "document"
    return filename_base + extension


def sanitize_directory_name(name_str):
    if not name_str:
        name_str = "untitled_article_data"
    name_str = str(name_str)
    name_str = re.sub(r'[<>:"/\\|?*]', '_', name_str)  # 移除或替换目录名中的非法字符
    name_str = re.sub(r'\s+', '_', name_str)  # 将空格替换为下划线
    name_str = name_str.strip('._ ')  # 移除首尾的下划线、点或空格
    max_len = 50  # 目录名的最大长度
    if len(name_str) > max_len:
        name_str = name_str[:max_len]
        last_underscore = name_str.rfind('_')
        if last_underscore > max_len / 2:
            name_str = name_str[:last_underscore]
    if not name_str:  # 如果处理后变为空
        name_str = "article_data_fallback"
    return name_str


def _build_cors_preflight_response():
    """构建一个用于CORS预检请求的响应。"""
    response = make_response(
        jsonify({"status": "success", "message": "CORS preflight successful"}))  # 通常预检成功返回200或204空内容
    response.headers.add("Access-Control-Allow-Origin", "*")  # 应与主CORS配置一致或更具体
    response.headers.add('Access-Control-Allow-Headers', "Content-Type,Authorization")  # 确保包含所有前端可能发送的头部
    response.headers.add('Access-Control-Allow-Methods', "GET,POST,PUT,PATCH,DELETE,OPTIONS")  # 包含所有支持的方法
    # response.headers.add('Access-Control-Max-Age', "86400") # 可选：预检请求的缓存时间
    return response  # 通常返回 200 OK 或 204 No Content，由Flask-CORS或手动设置


def format_bytes(size_bytes: int) -> str:
    """将字节大小格式化为易读的字符串 (B, KB, MB, GB等)"""
    if not isinstance(size_bytes, (int, float)) or size_bytes < 0:
        return "N/A"
    if size_bytes == 0:
        return "0 B"
    size_name = ("B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB")
    i = 0
    if size_bytes > 0:  # 只有当 size_bytes 大于0时才计算log，避免 math domain error
        i = int(math.floor(math.log(abs(size_bytes), 1024)))

    if i >= len(size_name):  # 防止索引超出范围
        i = len(size_name) - 1

    p = math.pow(1024, i)
    s = round(size_bytes / p, 2)
    return f"{s} {size_name[i]}"


def find_pdf_link(doi=None, title=None):
    pdf_url = None  # 初始化为 None
    log_prefix = "[FindPdfLinkUtil]"
    current_app.logger.info(f"{log_prefix} Initiating PDF link search. DOI: '{doi}', Title: '{title}'")

    sci_hub_domains_list = current_app.config.get('SCI_HUB_DOMAINS', [])

    if doi:
        current_app.logger.info(
            f"{log_prefix} Attempting Sci-Hub search for DOI: '{doi}'. Domains: {sci_hub_domains_list}")
        for domain in sci_hub_domains_list:
            pdf_url = find_pdf_link_via_scihub(doi, domain)  # find_pdf_link_via_scihub 会返回URL或None
            if pdf_url:
                current_app.logger.info(f"{log_prefix} PDF link found via Sci-Hub domain '{domain}'.")
                break

    if not pdf_url and doi:
        current_app.logger.info(f"{log_prefix} Sci-Hub unsuccessful. Attempting Unpaywall for DOI: '{doi}'.")
        pdf_url = find_pdf_on_unpaywall_by_doi(doi)  # find_pdf_on_unpaywall_by_doi 会返回URL或None
        if pdf_url:
            current_app.logger.info(f"{log_prefix} PDF link found via Unpaywall.")

    if not pdf_url and title:
        current_app.logger.info(f"{log_prefix} Previous methods unsuccessful. Attempting arXiv for Title: '{title}'.")
        pdf_url = find_pdf_on_arxiv_by_title(title)  # find_pdf_on_arxiv_by_title 会返回URL或None
        if pdf_url:
            current_app.logger.info(f"{log_prefix} PDF link found via arXiv.")

    if pdf_url:
        current_app.logger.info(
            f"{log_prefix} Search complete. PDF link found: {pdf_url} (DOI: '{doi}', Title: '{title}')")
    else:
        current_app.logger.info(
            f"{log_prefix} Search complete. No PDF link found after exhausting all strategies (DOI: '{doi}', Title: '{title}')")

    return pdf_url
# --- 其他您希望移到 utils.py 的通用辅助函数可以放在这里 ---


def find_pdf_on_unpaywall_by_doi(doi):
    pdf_url_found = None
    log_prefix = "[UnpaywallSearchUtil]"

    # 使用 current_app.config 获取配置
    my_email_for_apis = current_app.config.get('MY_EMAIL_FOR_APIS')  # <--- 修改点

    if not doi:
        current_app.logger.warning(f"{log_prefix} DOI参数缺失，无法执行搜索。")  # <--- 修改点
        return None

    if not my_email_for_apis or not my_email_for_apis.strip() or \
            "example.com" in my_email_for_apis or \
            "YOUR_DEBUG_EMAIL@example.com" in my_email_for_apis:
        current_app.logger.warning(  # <--- 修改点
            f"{log_prefix} 未配置有效的 MY_EMAIL_FOR_APIS (环境变量 MY_API_EMAIL)。"
            f"Unpaywall 搜索将被跳过。当前内部值: '{my_email_for_apis}'"
        )
        return None

    current_app.logger.info(f"{log_prefix} 正在为 DOI '{doi}' 尝试 Unpaywall 服务。")  # <--- 修改点
    api_url = f"https://api.unpaywall.org/v2/{quote_plus(doi)}?email={my_email_for_apis}"

    try:
        response = REQUEST_SESSION.get(api_url, timeout=25)
        response.raise_for_status()
        data = response.json()
        best_oa_location = data.get('best_oa_location')

        if best_oa_location and best_oa_location.get('url_for_pdf'):
            pdf_url_found = best_oa_location['url_for_pdf']
            current_app.logger.info(
                f"{log_prefix} 成功通过 Unpaywall 为 DOI '{doi}' 找到OA PDF链接: {pdf_url_found}")  # <--- 修改点
        else:
            oa_status = data.get('is_oa', 'N/A')
            current_app.logger.info(  # <--- 修改点
                f"{log_prefix} 未通过 Unpaywall 为 DOI '{doi}' 找到直接的OA PDF ('url_for_pdf')。文献OA状态: {oa_status}.")
            if best_oa_location and best_oa_location.get('url') and not best_oa_location.get('url_for_pdf'):
                current_app.logger.info(  # <--- 修改点
                    f"{log_prefix} Unpaywall 为 DOI '{doi}' 提供的最佳OA位置是一个落地页: {best_oa_location.get('url')}")
    # ... (异常捕获块中的 app.logger 全部改为 current_app.logger) ...
    except requests.exceptions.HTTPError as http_err:
        current_app.logger.warning(
            f"{log_prefix} 访问 Unpaywall API 时发生 HTTP 错误 (DOI: '{doi}'). URL: {api_url}. 状态码: {http_err.response.status_code if http_err.response else 'N/A'}. 错误: {http_err}")
    except requests.exceptions.Timeout:
        current_app.logger.warning(f"{log_prefix} 访问 Unpaywall API 超时 (DOI: '{doi}'). URL: {api_url}")
    except requests.exceptions.ConnectionError as conn_err:
        current_app.logger.warning(
            f"{log_prefix} 访问 Unpaywall API 时发生连接错误 (DOI: '{doi}'). URL: {api_url}. 错误: {conn_err}")
    except requests.exceptions.RequestException as req_err:
        current_app.logger.warning(
            f"{log_prefix} 访问 Unpaywall API 时发生请求错误 (DOI: '{doi}'). URL: {api_url}. 错误: {req_err}")
    except json.JSONDecodeError as json_err:
        current_app.logger.error(
            f"{log_prefix} 解析来自 Unpaywall 的 JSON 响应失败 (DOI: '{doi}'). URL: {api_url}. 错误: {json_err}")
    except Exception as e:
        current_app.logger.error(
            f"{log_prefix} 处理 Unpaywall API (DOI: '{doi}') 时发生未知错误. URL: {api_url}. 错误: {e}", exc_info=True)

    return pdf_url_found


def find_pdf_link_via_scihub(doi, domain):
    pdf_url_found = None
    sci_hub_url = f"{domain.rstrip('/')}/{doi}"
    log_prefix = "[SciHubSearchUtil]"  # 使用统一的前缀
    current_app.logger.info(f"{log_prefix} Attempting Sci-Hub domain '{domain}' for DOI '{doi}'. URL: {sci_hub_url}")

    try:
        response = REQUEST_SESSION.get(sci_hub_url, timeout=30, allow_redirects=True)
        response.raise_for_status()
        content_type_header = response.headers.get("Content-Type", "").lower()
        if "application/pdf" in content_type_header:
            current_app.logger.info(
                f"{log_prefix} Success! Direct PDF response from Sci-Hub URL: {response.url}. Content-Type: {content_type_header}")
            return response.url

        soup = BeautifulSoup(response.content, 'html.parser')
        selectors = [
            '#pdf', 'iframe#viewer', 'embed#viewer',
            'div#viewer iframe', 'div#viewer embed',
            'div.buttons > ul > li > a[onclick*=".pdf"]',
            'div.download-buttons a[href*=".pdf"]',
            'a#download',
            'button[onclick*="location.href=location.origin"]'
        ]

        for selector in selectors:
            element = soup.select_one(selector)
            if element:
                potential_url = None
                if element.get('src'):
                    potential_url = element.get('src')
                elif element.get('href') and ('.pdf' in element.get('href').lower() or 'sci-hub' in element.get(
                        'href').lower() or 'doi.org' in element.get('href').lower()):
                    potential_url = element.get('href')
                elif 'onclick' in element.attrs:
                    match = re.search(r"location\.href=['\"]([^'\"]+\.pdf[^'\"]*)['\"]", element['onclick'])
                    if match: potential_url = match.group(1)

                if potential_url:
                    if potential_url.startswith('//'): potential_url = "https:" + potential_url
                    if not potential_url.startswith('http'): potential_url = urljoin(response.url, potential_url)
                    current_app.logger.debug(
                        f"{log_prefix} Potential PDF URL extracted: {potential_url} using selector: '{selector}'")
                    try:
                        head_response = REQUEST_SESSION.head(potential_url, timeout=15, allow_redirects=True)
                        head_content_type = head_response.headers.get("Content-Type", "").lower()
                        if head_response.ok and (
                                "application/pdf" in head_content_type or ".pdf" in potential_url.lower()):
                            current_app.logger.info(
                                f"{log_prefix} Verified PDF link via HEAD request for {potential_url}. Content-Type: '{head_content_type}'.")
                            return potential_url
                        else:
                            current_app.logger.warning(
                                f"{log_prefix} Link {potential_url} from selector '{selector}' does not seem to be a PDF or request failed. HEAD Status: {head_response.status_code}, Content-Type: '{head_content_type}'.")
                    except requests.exceptions.RequestException as head_err:
                        current_app.logger.warning(
                            f"{log_prefix} HEAD request error for {potential_url}: {head_err}. Proceeding cautiously if URL contains '.pdf'.")
                        if ".pdf" in potential_url.lower(): return potential_url

        current_app.logger.info(
            f"{log_prefix} No PDF link found through HTML parsing on Sci-Hub domain '{domain}' for DOI '{doi}'.")

    except requests.exceptions.RequestException as req_err:
        current_app.logger.warning(
            f"{log_prefix} Request error for Sci-Hub '{domain}', DOI '{doi}', URL '{sci_hub_url}': {req_err}")
    except Exception as e:
        current_app.logger.error(
            f"{log_prefix} Unexpected error parsing Sci-Hub response from '{domain}' for DOI '{doi}'. URL: {sci_hub_url}. Error: {e}",
            exc_info=True)

    return None


def find_pdf_on_arxiv_by_title(title):
    pdf_url_found = None
    log_prefix = "[ArXivSearchUtil]"

    if not title or not title.strip():
        current_app.logger.warning(f"{log_prefix} 标题参数缺失或为空，无法执行搜索。") # <--- 修改点
        return None

    cleaned_title = title.replace('\u00A0', ' ').strip()
    current_app.logger.info(f"{log_prefix} 正在为标题 '{cleaned_title}' 尝试 arXiv 服务。") # <--- 修改点
    api_url = ''
    try:
        encoded_title = quote_plus(cleaned_title)
        api_url = f'http://export.arxiv.org/api/query?search_query=ti:"{encoded_title}"&start=0&max_results=1'
        current_app.logger.debug(f"{log_prefix} 查询API URL: {api_url}") # <--- 修改点
        response = REQUEST_SESSION.get(api_url, timeout=20)
        response.raise_for_status()
        root = ET.fromstring(response.content)
        atom_ns = '{http://www.w3.org/2005/Atom}'
        entries = root.findall(f'{atom_ns}entry')
        if not entries:
            current_app.logger.info(f"{log_prefix} 对于标题 '{cleaned_title}'，arXiv API响应中未找到任何条目。") # <--- 修改点
            return None
        # ... (后续的XML解析逻辑和日志也应将 app.logger 改为 current_app.logger) ...
        # ... (为了简洁，此处省略，请确保您在实际代码中替换所有 app.logger)
        entry = entries[0]
        for link_tag in entry.findall(f'{atom_ns}link[@title="pdf"]'):
            if link_tag.get('href'):
                pdf_url_found = link_tag.get('href')
                current_app.logger.info(f"{log_prefix} 找到直接的 arXiv PDF 链接 (link title='pdf'): {pdf_url_found}")
                return pdf_url_found
        abs_link_text = None # ... (获取abs_link_text的逻辑) ...
        id_tag = entry.find(f'{atom_ns}id')
        if id_tag is not None and id_tag.text and '/abs/' in id_tag.text:
            abs_link_text = id_tag.text.strip()
        # ... (构造PDF链接的逻辑) ...
        if abs_link_text:
            current_app.logger.debug(f"{log_prefix} 找到 arXiv 摘要页链接: {abs_link_text}")
            parsed_url = urlparse(abs_link_text)
            path_components = parsed_url.path.strip('/').split('/')
            arxiv_id_part = None
            if 'abs' in path_components and len(path_components) > path_components.index('abs') + 1:
                arxiv_id_part = "/".join(path_components[path_components.index('abs')+1:])
            if arxiv_id_part:
                constructed_pdf_link = f"https://arxiv.org/pdf/{arxiv_id_part}"
                if not re.search(r'v\d+$', arxiv_id_part) and not constructed_pdf_link.endswith('.pdf'):
                    constructed_pdf_link += ".pdf"
                current_app.logger.info(f"{log_prefix} 根据摘要页链接构造的 arXiv PDF 链接为: {constructed_pdf_link}")
                return constructed_pdf_link # 返回构造的链接
            else:
                current_app.logger.warning(f"{log_prefix} 无法从摘要页链接 '{abs_link_text}' 中解析出有效的 arXiv ID。")
        else:
             current_app.logger.info(f"{log_prefix} 在标题为 '{cleaned_title}' 的 arXiv 条目中未找到合适的摘要页链接。")


    # ... (异常捕获块中的 app.logger 全部改为 current_app.logger) ...
    except requests.exceptions.HTTPError as http_err:
        current_app.logger.warning(f"{log_prefix} 访问 arXiv API 时发生 HTTP 错误 (标题: '{cleaned_title}'). URL: {api_url if 'api_url' in locals() else 'N/A'}. 状态码: {http_err.response.status_code if http_err.response else 'N/A'}. 错误: {http_err}")
    except requests.exceptions.Timeout:
        current_app.logger.warning(f"{log_prefix} 访问 arXiv API 超时 (标题: '{cleaned_title}'). URL: {api_url if 'api_url' in locals() else 'N/A'}")
    # ... (其他异常类型)
    except ET.ParseError as xml_err:
        current_app.logger.error(f"{log_prefix} 解析来自 arXiv API 的 XML 响应失败 (标题: '{cleaned_title}'). URL: {api_url if 'api_url' in locals() else 'N/A'}. 错误: {xml_err}")
        if 'response' in locals() and response.content:
             current_app.logger.debug(f"{log_prefix} arXiv 响应内容 (前200字符): {response.content[:200]}")
    except Exception as e:
        current_app.logger.error(f"{log_prefix} 处理 arXiv API (标题: '{cleaned_title}') 时发生未知错误. URL: {api_url if 'api_url' in locals() else 'N/A'}. 错误: {e}", exc_info=True)

    if not pdf_url_found:
        current_app.logger.info(f"{log_prefix} 尝试所有策略后，未能为标题 '{cleaned_title}' 找到 arXiv PDF 链接。")
    return pdf_url_found

def generate_task_id(articles_data_list):
    # 这个函数不直接依赖 app 或 current_app 上下文，可以直接使用
    if not articles_data_list:
        return None
    # 为了保证任务ID的一致性，对文献列表进行排序，并选择关键信息
    key_strings = []
    for article in sorted(articles_data_list, key=lambda x: (
                            str(x.get('pdfLink', '')).lower(),
                            str(x.get('title', '')).lower()
                          )):
        # 使用更稳定的字段组合，例如 pdfLink 和 title 的组合
        # 如果 doi 存在且唯一，也可以考虑加入 doi
        key_strings.append(f"{str(article.get('pdfLink', '')).strip()}|{str(article.get('title', '')).strip()}")

    task_id_source_string = "||".join(key_strings)
    task_id = hashlib.md5(task_id_source_string.encode('utf-8')).hexdigest()
    # 可以在这里用 current_app.logger.debug 记录生成的 task_id，但需要确保在有应用上下文时调用
    # print(f"[Util/GenerateTaskID] Generated Task ID: {task_id} for {len(articles_data_list)} articles from source string: '{task_id_source_string[:100]}...'") # 临时用print
    return task_id

def load_download_records():
    log_prefix = "[Util/LoadRecords]"
    download_records_file_path = current_app.config.get('DOWNLOAD_RECORDS_FILE')
    if not download_records_file_path:
        current_app.logger.error(f"{log_prefix} DOWNLOAD_RECORDS_FILE 未在应用配置中定义！")
        return {}

    backup_file_path = download_records_file_path + ".bak" # 备份文件名

    # 优先尝试加载主文件
    if os.path.exists(download_records_file_path):
        try:
            with open(download_records_file_path, 'r', encoding='utf-8') as f:
                records = json.load(f)
            current_app.logger.debug(f"{log_prefix} 成功从主文件 '{download_records_file_path}' 加载记录。")
            return records
        except (IOError, json.JSONDecodeError) as e:
            current_app.logger.error(f"{log_prefix} 加载主下载记录文件 '{download_records_file_path}' 失败: {e}。尝试从备份加载...", exc_info=True)
    else:
        current_app.logger.info(f"{log_prefix} 主下载记录文件 '{download_records_file_path}' 不存在。尝试从备份加载...")

    # 如果主文件加载失败或不存在，尝试加载备份文件
    if os.path.exists(backup_file_path):
        try:
            with open(backup_file_path, 'r', encoding='utf-8') as f:
                records = json.load(f)
            current_app.logger.warning(f"{log_prefix} 成功从备份文件 '{backup_file_path}' 加载记录。主文件可能已损坏或丢失。")
            return records
        except (IOError, json.JSONDecodeError) as e_bak:
            current_app.logger.error(f"{log_prefix} 加载备份下载记录文件 '{backup_file_path}' 也失败: {e_bak}", exc_info=True)
    else:
        current_app.logger.info(f"{log_prefix} 备份下载记录文件 '{backup_file_path}' 也不存在。")

    current_app.logger.warning(f"{log_prefix} 无法加载任何下载记录。将返回空记录。")
    return {} # 所有尝试失败后，返回空字典

def save_download_records(records):
    log_prefix = "[Util/SaveRecords]"
    download_records_file_path = current_app.config.get('DOWNLOAD_RECORDS_FILE')
    if not download_records_file_path:
        current_app.logger.error(f"{log_prefix} DOWNLOAD_RECORDS_FILE 未在应用配置中定义！无法保存记录。")
        return False

    # 定义临时文件名和备份文件名
    temp_file_path = download_records_file_path + ".tmp"
    backup_file_path = download_records_file_path + ".bak"

    try:
        # 1. 将数据写入临时文件
        with open(temp_file_path, 'w', encoding='utf-8') as f:
            json.dump(records, f, ensure_ascii=False, indent=4)
        current_app.logger.debug(f"{log_prefix} 记录已成功写入临时文件 '{temp_file_path}'。")

        # 2. 如果主文件存在，将其备份
        if os.path.exists(download_records_file_path):
            try:
                # shutil.copy2(download_records_file_path, backup_file_path) # 复制并保留元数据
                os.replace(download_records_file_path, backup_file_path) # 或者直接重命名为备份，如果旧备份不重要
                current_app.logger.info(f"{log_prefix} 原记录文件已备份至 '{backup_file_path}'。")
            except Exception as e_backup:
                current_app.logger.error(f"{log_prefix} 备份原记录文件 '{download_records_file_path}' 失败: {e_backup}", exc_info=True)
                # 备份失败是一个警告，但我们仍会尝试用新文件替换主文件

        # 3. 原子地将临时文件重命名为主文件
        # os.replace() 在多数情况下是原子性的，如果目标文件已存在，则覆盖它。
        os.replace(temp_file_path, download_records_file_path)
        current_app.logger.info(f"{log_prefix} 下载记录已成功保存到 '{download_records_file_path}' (通过替换临时文件)。")
        return True # 表示保存成功

    except (IOError, TypeError, Exception) as e: # TypeError for json.dump if records is not serializable
        current_app.logger.error(f"{log_prefix} 保存下载记录到 '{download_records_file_path}' (通过临时文件 '{temp_file_path}') 时发生错误: {e}", exc_info=True)
        # 如果发生错误，尝试删除可能已创建的临时文件
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                current_app.logger.info(f"{log_prefix} 已删除错误的临时文件 '{temp_file_path}'。")
            except OSError as e_rm_tmp:
                current_app.logger.error(f"{log_prefix} 删除错误的临时文件 '{temp_file_path}' 失败: {e_rm_tmp}", exc_info=True)
        return False # 表示保存失败

def download_pdf_to_server(pdf_url, desired_title, target_directory):
    log_prefix = "[PdfDownloader]"
    file_path = None  # 初始化 file_path

    if not pdf_url or not desired_title:
        current_app.logger.error(f"{log_prefix} PDF URL ('{pdf_url}') 或文献标题 ('{desired_title}') 为空。下载中止。")
        return None

    if not os.path.exists(target_directory):
        try:
            os.makedirs(target_directory)
            current_app.logger.info(f"{log_prefix} 为PDF下载创建了目录 '{target_directory}'。")
        except OSError as e:
            current_app.logger.error(f"{log_prefix} 无法创建目标目录 '{target_directory}': {e}", exc_info=True)
            return None

    filename = sanitize_filename(desired_title)  # sanitize_filename 应确保生成有效的文件名
    file_path = os.path.join(target_directory, filename)

    try:
        current_app.logger.info(f"{log_prefix} 开始下载: '{pdf_url}' -> '{file_path}'")

        # 使用 with语句确保response对象被正确关闭
        with REQUEST_SESSION.get(pdf_url, stream=True, timeout=90, allow_redirects=True) as response:  # 增加超时时间
            response.raise_for_status()  # 提早检查HTTP错误

            content_type = response.headers.get('Content-Type', '').lower()
            # 初步检查Content-Type，如果不是明确的PDF或通用二进制流，则警告
            if 'application/pdf' not in content_type and 'application/octet-stream' not in content_type:
                current_app.logger.warning(
                    f"{log_prefix} URL '{pdf_url}' 的 Content-Type 是 '{content_type}'，可能不是PDF。谨慎下载。")

            downloaded_size = 0
            with open(file_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192 * 4):  # 略微增大块大小
                    if chunk:  # 过滤掉 keep-alive 的新块
                        f.write(chunk)
                        downloaded_size += len(chunk)

            current_app.logger.info(f"{log_prefix} 文件下载成功。大小: {downloaded_size} 字节。已保存至: '{file_path}'")

            # 下载后验证
            if downloaded_size == 0:
                current_app.logger.warning(f"{log_prefix} 下载的文件 '{file_path}' 为空 (0字节)。正在删除。")
                # os.remove(file_path) # 将在 finally 或异常处理中统一清理
                raise ValueError("Downloaded file is empty.")  # 抛出异常以便统一处理

            # 检查是否下载到了HTML页面 (基于服务器报告的Content-Type)
            if 'html' in content_type and 'application/pdf' not in content_type:
                current_app.logger.warning(
                    f"{log_prefix} 下载的文件 '{file_path}' 被服务器识别为HTML (Content-Type: '{content_type}')。这可能不是预期的PDF。正在删除。")
                raise ValueError("Downloaded file identified as HTML by server.")

            # 对于通用二进制流，检查PDF魔术字节
            if 'application/octet-stream' in content_type:
                with open(file_path, 'rb') as f_check:
                    magic_bytes = f_check.read(5)  # 读取前5个字节
                    if magic_bytes != b'%PDF-':  # PDF文件通常以 '%PDF-' 开头
                        current_app.logger.warning(
                            f"{log_prefix} 下载的文件 '{file_path}' (Content-Type: octet-stream) 开头不是PDF魔术字节 (%PDF-)。可能是错误的文件。正在删除。")
                        raise ValueError("Downloaded octet-stream file is not a PDF.")
                    else:
                        current_app.logger.info(f"{log_prefix} 文件 '{file_path}' (octet-stream) 通过魔术字节验证为PDF。")

            # 所有检查通过，返回文件路径
            return file_path

    except ValueError as ve:  # 捕获我们自己抛出的验证错误
        current_app.logger.error(f"{log_prefix} 下载后文件验证失败 for '{pdf_url}': {ve}")
        # 文件清理将在 finally 块或更高层异常处理中进行
    except requests.exceptions.HTTPError as http_err:
        current_app.logger.error(
            f"{log_prefix} 下载 '{pdf_url}' 时发生HTTP错误: {http_err.response.status_code if http_err.response else 'N/A'} - {http_err}",
            exc_info=False)  # 通常HTTPError信息已足够，无需完整traceback
    except requests.exceptions.Timeout:
        current_app.logger.error(f"{log_prefix} 下载 '{pdf_url}' 超时。", exc_info=False)
    except requests.exceptions.ConnectionError as conn_err:
        current_app.logger.error(f"{log_prefix} 下载 '{pdf_url}' 时发生连接错误: {conn_err}", exc_info=False)
    except requests.exceptions.RequestException as req_err:  # 更通用的网络请求相关错误
        current_app.logger.error(f"{log_prefix} 下载 '{pdf_url}' 时发生网络错误: {req_err}", exc_info=False)
    except IOError as io_err:  # 文件写入错误
        current_app.logger.error(f"{log_prefix} 写入文件 '{file_path if file_path else '路径未定义'}' 时发生IO错误: {io_err}",
                         exc_info=True)
    except Exception as e:  # 其他所有意外错误
        current_app.logger.error(
            f"{log_prefix} 下载 '{pdf_url}' 到 '{file_path if file_path else '路径未定义'}' 过程中发生未知错误: {e}",
            exc_info=True)

    # 统一的错误后清理逻辑：如果发生任何上述异常且文件已创建（或部分创建）
    if file_path and os.path.exists(file_path):
        try:
            current_app.logger.warning(f"{log_prefix} 因发生错误，正在删除可能不完整或错误的文件: '{file_path}'")
            os.remove(file_path)
        except OSError as e_rm:
            current_app.logger.error(f"{log_prefix} 在错误处理中删除文件 '{file_path}' 失败: {e_rm}", exc_info=True)

    return None  # 确保在所有失败路径上都返回None

