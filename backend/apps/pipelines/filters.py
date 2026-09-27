"""过滤器注册表：管道 filter 节点按配置对活动流进行筛选。

node.config 示例：
  {"filter_type": "by_sport",     "sport": "cycling"}
  {"filter_type": "by_distance",  "min_distance": 10, "max_distance": 100}
  {"filter_type": "by_date_range","date_from": "2026-09-01", "date_to": "2026-09-30"}
"""
from datetime import datetime, time

from django.utils import timezone


class FilterRegistry:
    @staticmethod
    def by_sport(config: dict, activities: list):
        sport = (config or {}).get("sport")
        if not sport:
            return activities
        return [a for a in activities if a.activity_type == sport]

    @staticmethod
    def by_distance(config: dict, activities: list):
        cfg = config or {}
        min_d, max_d = cfg.get("min_distance"), cfg.get("max_distance")
        out = []
        for a in activities:
            d = a.distance or 0
            if min_d is not None and d < float(min_d):
                continue
            if max_d is not None and d > float(max_d):
                continue
            out.append(a)
        return out

    @staticmethod
    def by_date_range(config: dict, activities: list):
        cfg = config or {}
        date_from, date_to = cfg.get("date_from"), cfg.get("date_to")
        if not date_from and not date_to:
            return activities
        lower = (
            timezone.make_aware(datetime.combine(datetime.fromisoformat(date_from), time.min))
            if date_from
            else None
        )
        upper = (
            timezone.make_aware(datetime.combine(datetime.fromisoformat(date_to), time.max))
            if date_to
            else None
        )
        out = []
        for a in activities:
            if lower and a.start_timestamp < lower:
                continue
            if upper and a.start_timestamp > upper:
                continue
            out.append(a)
        return out

    FILTERS = {
        "by_sport": by_sport.__func__,
        "by_distance": by_distance.__func__,
        "by_date_range": by_date_range.__func__,
    }

    @classmethod
    def apply(cls, config: dict, activities: list):
        """按 config.filter_type 应用过滤器；未知类型直接放行。"""
        filter_type = (config or {}).get("filter_type")
        fn = cls.FILTERS.get(filter_type)
        return fn(config, activities) if fn else activities
