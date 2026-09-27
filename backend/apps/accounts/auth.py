"""JWT 认证扩展：支持通过 URL 查询参数传递 access_token（用于 SSE / EventSource）。"""
from rest_framework_simplejwt.authentication import JWTAuthentication


class QueryParamJWTAuthentication(JWTAuthentication):
    """
    当请求带 ?access_token=xxx 时按 Bearer Token 处理。
    场景：EventSource 无法自定义请求头，前端 SSE 连接通过查询参数携带 JWT。
    """

    def authenticate(self, request):
        token = request.query_params.get("access_token")
        if not token:
            return None  # 交由后续认证器（标准 JWT）处理
        validated = self.get_validated_token(token)
        user = self.get_user(validated)
        return (user, validated)
