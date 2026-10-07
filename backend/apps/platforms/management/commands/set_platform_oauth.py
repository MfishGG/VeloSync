"""配置平台 OAuth 凭证的命令行入口。

用法：

    # 查看所有平台的凭证状态与申请入口
    python manage.py set_platform_oauth --list

    # 写入凭证（拿到 client_id / client_secret 之后）
    python manage.py set_platform_oauth strava \
        --authorize-url https://www.strava.com/oauth/authorize \
        --token-url https://www.strava.com/oauth/token \
        --api-base https://www.strava.com/api/v3 \
        --client-id 12345 --client-secret abcdef \
        --scopes read,activity:read_all,activity:write

    # 清空凭证（回到"只能演示绑定"状态）
    python manage.py set_platform_oauth strava --clear

凭证也随时可以在 Django Admin（/admin/platforms/platform/）里改。
"""

from django.core.management.base import BaseCommand, CommandError

from apps.platforms.models import Platform

#: 各平台开放平台申请入口（仅作提示，凭证需自行申请）
DOCS = {
    "igpsport": "iGPSPORT APP Open Platform —— www.igpsport.com/support/app/openapi（OAuth2.0，邮件申请 global@igpsport.com）",
    "garmin": "Garmin Connect Developer Program —— developer.garmin.com",
    "strava": "Strava API Settings —— www.strava.com/settings/api",
    "coros": "COROS 开放平台 —— open.coros.com",
}

FIELDS = ("authorize_url", "token_url", "api_base", "client_id", "client_secret")


class Command(BaseCommand):
    help = "查看 / 写入平台的 OAuth 凭证（authorize_url / token_url / client_id / client_secret / scopes）"

    def add_arguments(self, parser):
        parser.add_argument("code", nargs="?", help="平台标识，如 igpsport / garmin / strava / coros")
        parser.add_argument("--list", action="store_true", help="列出所有平台及其凭证状态")
        parser.add_argument("--authorize-url", dest="authorize_url")
        parser.add_argument("--token-url", dest="token_url")
        parser.add_argument("--api-base", dest="api_base")
        parser.add_argument("--client-id", dest="client_id")
        parser.add_argument("--client-secret", dest="client_secret")
        parser.add_argument("--scopes", help="逗号分隔，如 read,activity:write")
        parser.add_argument("--clear", action="store_true", help="清空该平台的凭证字段")

    def handle(self, *args, **options):
        if options["list"] or not options["code"]:
            return self._list()

        code = options["code"]
        platform = Platform.objects.filter(code=code).first()
        if platform is None:
            known = ", ".join(Platform.objects.values_list("code", flat=True))
            raise CommandError(f"平台 {code} 不存在。已有平台：{known}")

        if options["clear"]:
            for f in FIELDS:
                setattr(platform, f, "")
            platform.scopes = []
            platform.save()
            self.stdout.write(self.style.WARNING(f"已清空 {platform.name} 的凭证"))
            return self._list()

        changed = []
        for f in FIELDS:
            value = options.get(f)
            if value is not None:
                setattr(platform, f, value)
                changed.append(f)
        if options["scopes"]:
            platform.scopes = [s.strip() for s in options["scopes"].split(",") if s.strip()]
            changed.append("scopes")

        if not changed:
            raise CommandError("没有要写入的字段。可用参数见 python manage.py set_platform_oauth --help")

        platform.save()
        self.stdout.write(self.style.SUCCESS(f"已更新 {platform.name}：{', '.join(changed)}"))
        if platform.oauth_ready:
            self.stdout.write(self.style.SUCCESS("凭证齐备，账号页即可跳转真实授权页。"))
        else:
            self.stdout.write(
                self.style.WARNING("凭证仍不完整，缺失：" + "、".join(platform.oauth_missing))
            )
        self._list()

    def _list(self):
        self.stdout.write("")
        for p in Platform.objects.all().order_by("id"):
            if p.auth_type == "mock":
                state = "演示平台（无需凭证）"
            elif p.oauth_ready:
                state = f"已配置（client_id={p.client_id[:12]}…）" if p.client_id else "已配置"
            else:
                state = "未配置：" + "、".join(p.oauth_missing)
            self.stdout.write(f"[{p.code}] {p.name} · {state}")
            if p.code in DOCS and not p.oauth_ready:
                self.stdout.write(f"    申请入口：{DOCS[p.code]}")
        self.stdout.write("")
        self.stdout.write(
            "提示：未配置凭证的平台仍可在「账号管理」页以【演示身份】绑定，用于本地跑通全链路。"
        )
