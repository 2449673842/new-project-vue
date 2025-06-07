# backend/auth_views.py
from flask import Blueprint, request, jsonify, current_app # 导入 current_app 用于访问 app.config 和 app.logger
from werkzeug.security import generate_password_hash, check_password_hash # User模型方法可能内部使用
from models import db, User # 从同级目录的 models.py 导入
import jwt
from datetime import datetime, timedelta, timezone
from flask_cors import CORS

# 导入在 app2.py 中定义的辅助函数 (这是一个临时的做法，理想情况下这些辅助函数也应模块化)
# 为了让这个步骤能进行，假设 log_user_activity 仍在 app2.py 中且可被导入
# 稍后我们可以讨论如何更好地组织这些辅助函数。
try:
    from utils import log_user_activity
except ImportError:
    # 如果直接从 app2 导入有困难（例如循环导入），或者 log_user_activity 尚未使用 current_app
    # 我们暂时定义一个占位符，或提醒需要重构 log_user_activity
    def log_user_activity(user_id, activity_type, description, related_article_db_id=None):
        # current_app.logger.info(f"占位符 Log: User {user_id}, Type: {activity_type}, Desc: {description}")
        print(f"占位符 Log: User {user_id}, Type: {activity_type}, Desc: {description}") # 使用 print 以避免依赖 current_app.logger

# 创建一个蓝图实例
# 'auth_bp' 是蓝图的名称，__name__ 是模块名，url_prefix 会给此蓝图下的所有路由加上 '/api/auth' 前缀
auth_bp = Blueprint('auth_bp', __name__, url_prefix='/api/auth')
CORS(auth_bp, supports_credentials=True, origins=["http://localhost:5173", "http://127.0.0.1:5173"])
@auth_bp.route('/register', methods=['POST'])
def register_user_route_bp(): # 函数名可以加上 _bp 后缀以区分
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "message": "请求体不能为空"}), 400
    username = data.get('username')
    email = data.get('email')
    password = data.get('password')

    if not username or not email or not password:
        missing = [field for field in ['username', 'email', 'password'] if not data.get(field)]
        return jsonify({"success": False, "message": f"必填字段缺失: {', '.join(missing)}"}), 400

    if User.query.filter_by(username=username).first():
        return jsonify({"success": False, "message": "用户名已存在"}), 409
    if User.query.filter_by(email=email).first():
        return jsonify({"success": False, "message": "邮箱已被注册"}), 409

    new_user = User(username=username, email=email)
    new_user.set_password(password) # User模型中的方法
    try:
        db.session.add(new_user)
        db.session.commit()
        # 使用 current_app.logger 记录日志
        current_app.logger.info(f"[AuthBP] 新用户注册成功: {username} ({email})")
        # 调用 log_user_activity (需要确保它能被正确调用)
        log_user_activity(new_user.id, "register_success", f"用户 {new_user.username} 成功注册。")
        return jsonify({"success": True, "message": "用户注册成功！请登录。"}), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"[AuthBP] 注册用户时发生数据库错误: {e}", exc_info=True)
        return jsonify({"success": False, "message": f"注册失败，服务器内部错误。"}), 500 # 避免泄露 str(e)

@auth_bp.route('/login', methods=['POST'])
def login_user_route_bp(): # 函数名可以加上 _bp 后缀
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "message": "请求体不能为空"}), 400

    identifier = data.get('identifier') # 用户名或邮箱
    password = data.get('password')

    if not identifier or not password:
        return jsonify({"success": False, "message": "用户名/邮箱和密码均为必填项"}), 400

    user = User.query.filter_by(email=identifier).first()
    if not user:
        user = User.query.filter_by(username=identifier).first()

    if user and user.check_password(password): # User模型中的方法
        try:
            token_payload = {
                'user_id': user.id,
                'username': user.username,
                # Token有效期，从 current_app.config 获取 SECRET_KEY
                'exp': datetime.now(timezone.utc) + timedelta(hours=current_app.config.get('TOKEN_EXPIRATION_HOURS', 24))
            }
            # 使用 current_app.config 获取 SECRET_KEY
            secret_key_for_jwt = current_app.config.get('SECRET_KEY')
            if not secret_key_for_jwt:
                current_app.logger.error("[AuthBP] JWT SECRET_KEY 未在应用配置中设置！")
                return jsonify({"success": False, "message": "登录失败，服务器配置错误。"}), 500

            token = jwt.encode(token_payload, secret_key_for_jwt, algorithm='HS256')

            current_app.logger.info(f"[AuthBP] 用户登录成功: {user.username}")
            log_user_activity(user.id, "login_success", f"用户 {user.username} 成功登录。")
            return jsonify({
                "success": True,
                "message": "登录成功！",
                "token": token, # 在Python 3.x中，jwt.encode默认返回bytes，如果前端期望str，可能需要 .decode('utf-8')
                "username": user.username
            }), 200
        except Exception as e:
            current_app.logger.error(f"[AuthBP] 生成Token时出错: {e}", exc_info=True)
            return jsonify({"success": False, "message": "登录失败，服务器内部错误。"}), 500
    else:
        current_app.logger.warning(f"[AuthBP] 登录失败，无效的凭据: {identifier}")
        return jsonify({"success": False, "message": "用户名/邮箱或密码错误。"}), 401