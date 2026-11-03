"""用命令行验证佳明账号密码登录，必要时顺手把账号绑到某个本地用户上。

用途有两层：

1. **排查**：「绑定失败」在小程序里只有一句用户话术，而这条链路有 5 个步骤
   （登录 → 二次验证 → 换 OAuth1 → 换 OAuth2 → 读资料）。哪一步失败、平台回了
   什么，只有跑这个命令才看得清。云托管的 WebShell 里可以直接执行。
2. **兜底**：界面出问题时，`--bind-user` 能把账号直接写好，同步照样能用。

用法：

    # 只验证登录能不能过（密码交互输入，不留在 shell 历史里）
    python manage.py garmin_login --email me@example.com

    # 中国区账号
    python manage.py garmin_login --platform garmin_cn --email me@example.com

    # 验证 + 绑到本地用户 mfish，之后小程序里就能直接看到这个账号
    python manage.py garmin_login --email me@example.com --bind-user mfish

    # 开了两步验证：验证码也可以从参数给
    python manage.py garmin_login --email me@example.com --mfa 123456

注意：这里的密码/验证码只在本进程内存里用，不落库、不打印。
"""
import getpass

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.platforms import garmin_sso
from apps.platforms.models import Platform, PlatformAccount


class Command(BaseCommand):
    help = "用账号密码验证佳明登录（可选：把账号绑定到本地用户）"

    def add_arguments(self, parser):
        parser.add_argument("--platform", default="garmin", help="garmin（国际区）或 garmin_cn（中国区）")
        parser.add_argument("--email", required=True, help="佳明账号（邮箱/手机号）")
        parser.add_argument("--password", default="", help="不传则交互输入（更安全，不会留在命令历史里）")
        parser.add_argument("--mfa", default="", help="两步验证码（不传则提示输入）")
        parser.add_argument("--bind-user", default="", help="把登录结果绑定到该本地用户名上")

    def handle(self, *args, **options):
        code = options["platform"]
        platform = Platform.objects.filter(code=code, is_active=True).first()
        if platform is None:
            raise CommandError(f"平台 {code} 不存在，可用：garmin / garmin_cn")
        if platform.code not in garmin_sso.DOMAINS:
            raise CommandError(f"{platform.name} 没有接入账号密码登录")

        email = options["email"].strip()
        password = options["password"] or getpass.getpass(f"{email} 的密码（不会显示、不保存）：")
        if not password:
            raise CommandError("密码为空")

        domain = garmin_sso.platform_domain(platform)
        self.stdout.write(f"① 登录 sso.{domain} …")
        try:
            oauth1, oauth2 = garmin_sso.login(email, password, domain)
        except garmin_sso.MfaRequired as need:
            self.stdout.write(f"② 需要二次验证（方式：{need.method}）")
            verify_code = options["mfa"] or input("验证码：").strip()
            if not verify_code:
                raise CommandError("没有输入验证码")
            state = dict(need.state)
            state["mfa_method"] = need.method
            try:
                oauth1, oauth2 = garmin_sso.verify_mfa(state, verify_code)
            except garmin_sso.GarminError as exc:
                raise CommandError(f"二次验证失败（{exc.step}）：{exc}")
        except garmin_sso.GarminError as exc:
            raise CommandError(f"登录失败（{exc.step}）：{exc}")

        access = oauth2.get("access_token") or ""
        self.stdout.write(
            self.style.SUCCESS(
                f"③ 已换到访问令牌（有效期 {oauth2.get('expires_in')} 秒），"
                f"OAuth1 可用约一年"
            )
        )

        profile = garmin_sso.profile(access, domain)
        name = profile.get("displayName") or profile.get("userName") or "(读不到资料)"
        self.stdout.write(f"④ 账号资料：{name}")

        bind_user = options["bind_user"].strip()
        if not bind_user:
            self.stdout.write(
                self.style.WARNING("未指定 --bind-user：只验证了链路，没有写入任何账号")
            )
            return

        user = get_user_model().objects.filter(username=bind_user).first()
        if user is None:
            raise CommandError(f"本地用户 {bind_user} 不存在")

        platform_user_id = str(
            profile.get("profileId") or profile.get("userName") or email
        )[:128]
        account, created = PlatformAccount.objects.update_or_create(
            user=user,
            platform=platform,
            platform_user_id=platform_user_id,
            defaults={"status": "active", "display_name": name[:128]},
        )
        account.set_tokens(
            access, oauth2.get("refresh_token") or "", expires_in=oauth2.get("expires_in")
        )
        account.set_session({"oauth1": oauth1})
        account.save()
        self.stdout.write(
            self.style.SUCCESS(
                f"⑤ 已{'绑定' if created else '更新'}账号 #{account.id} 到用户 {bind_user}"
            )
        )
