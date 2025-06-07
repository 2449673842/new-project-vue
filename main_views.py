# backend/main_views.py
from flask import Blueprint, jsonify # jsonify 可能不需要，取决于 health_check 的返回

# 创建一个蓝图实例
# 'main_bp' 是蓝图的名称。
# 这个蓝图下的路由通常是应用的根路径或通用页面。
main_bp = Blueprint('main_bp', __name__) # 注意，这里我们不需要 url_prefix

@main_bp.route('/')
def health_check_bp(): # 重命名函数以示区分
    # 这是您原来 app2.py 中的 health_check 函数逻辑
    # return "Backend is running! LitFinder vNext (with User Auth Setup)"
    # 为了与API风格保持一致，可以返回一个JSON
    return jsonify({
        "status": "running",
        "message": "Backend is running! LitFinder vNext (with User Auth Setup and Blueprints)"
    }), 200