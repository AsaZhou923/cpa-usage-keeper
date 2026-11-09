# 开发指南

[返回 README](../README.zh.md) · [English](./development.md)

项目结构和启动步骤见 README 的[项目结构](../README.zh.md#项目结构)与[本地开发](../README.zh.md#本地开发)。

## 测试

在仓库根目录运行完整验证：

```bash
make verify
```

也可以分别运行：

```bash
go test ./cmd/... ./internal/...
npm --prefix ./web run test
npm --prefix ./web run lint
npm --prefix ./web run typecheck
npm --prefix ./web run build
```

## 图表时间处理

### 基本原则

- 业务时间统一为东京时间（`Asia/Tokyo`，JST，UTC+9）。启动时统一 `TZ`，前端业务页面使用同一时区，避免取浏览器本地时区。UTC 存储及 RFC3339 协议时间戳保持不变。通用日历工具仍支持显式指定时区及夏令时跳时、回拨，滚动窗口按实际经过时长计算。
- 用真实时刻或完整日期标识时间桶，按真实时间排序；格式化的钟面标签仅用于展示。
- 查询修复不应改变已有聚合的写入边界。Overview、Latency 的小时起点不同，Activity 的 364 格布局及已有桶结束时间也应保留，避免改变历史数据含义。

### 复用代码

- 自然日计算：`internal/timeutil.CivilDate`、`DayBounds`；聚合读取使用 repository 的桶适配方法。
- 原始事件过滤：`internal/repository/usage_event_time_read.go`。普通查询使用有界分段，近期缓存启动或重载使用开放上界；字段选择和缓存生命周期仍由调用方处理。
- 前端标签：`web/src/utils/usage/timeLabels.ts`。仅为存在歧义的当地钟面补充时区偏移，保留现有语言、精度、回退及补点规则。

### 验证要求

覆盖东京午夜边界、无时区时间戳、浏览器时区与东京不同的情况，以及通用工具显式指定时区时的夏令时跳时与回拨。确认改动未影响图表样式和生命周期行为。
