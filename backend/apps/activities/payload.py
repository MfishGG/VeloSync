"""为「上传到目标平台」准备文件字节。

三个来源，按优先级：

1. **本地原始 FIT**：用户导入过文件时留下的字节，无损，首选。
2. **来源平台下载**：来源支持导出文件时（iGPSPORT 这类）直接取原始文件。
3. **现场合成 TCX**：来源根本没有文件可给时（Strava 的 api/v3 没有导出端点），
   用本地已经存下的采样点拼一份。这是 Strava → 佳明这条链路的唯一走法。

**为什么单独成模块**：这条逻辑被两处需要 —— 同步任务引擎（批量）与
「矩阵里点单个补同步」。此前两处各自用 `adapter.download_fit()`，而那个
`adapter` 是**目标平台**的适配器：等于问佳明「把你的原始文件给我」，语义就是错的。
Strava 来源下更是必然失败 —— 它的适配器根本没有下载接口。
"""
from .models import ActivityFitDetail
from .tcx import build_tcx


def local_fit_bytes(activity):
    """导入 FIT 时留下的原始字节；没有则 None。

    `fit_file` 是 OneToOne 反向关系，不存在时 Django 抛
    RelatedObjectDoesNotExist —— 它同时继承 ObjectDoesNotExist 与 AttributeError，
    所以 getattr 的默认值能兜住，不需要 try。
    """
    fit_file = getattr(activity, "fit_file", None)
    if not fit_file or not fit_file.data:
        return None
    return bytes(fit_file.data)


def activity_file(activity, source_adapter=None, source_activity_id: str = ""):
    """返回 `(字节 | None, 类型, 失败原因)`。类型是 "fit" / "tcx"。

    失败原因只在真的没东西可传时才有意义，但也可以在「用了低精度回退」时
    带上说明，供日志记录。
    """
    data = local_fit_bytes(activity)
    if data:
        return data, "fit", ""

    error = ""
    if source_adapter is not None and getattr(source_adapter, "CAN_EXPORT_FILES", True):
        try:
            data = source_adapter.download_fit(source_activity_id or activity.id)
            if data:
                return data, "fit", ""
            error = "来源平台返回了空文件"
        except Exception as exc:  # noqa: BLE001 —— 下载失败不是终点，还有第三条路
            error = str(exc)

    detail = ActivityFitDetail.objects.filter(activity=activity).first()
    if detail is not None and detail.samples:
        try:
            return build_tcx(activity, detail).encode("utf-8"), "tcx", ""
        except ValueError as exc:
            error = error or str(exc)

    return None, "", error or "该活动既没有原始文件，也没有可合成 TCX 的采样点"
