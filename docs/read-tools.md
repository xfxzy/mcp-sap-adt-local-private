# 只读工具清单

既有 16 个只读工具保持不变：系统列表和健康检查、repository/source 查询、runtime/dump/HTTP 日志、table 结构和读取、搜索、where-used、transport 查询。它们不会写 SAP。

业务 API 只读工具：

- `list_business_apis`：列出当前 active system 启用的 profile、service 和 entity。
- `inspect_business_api`：读取 `$metadata`，校验 entity set、key、字段、类型和 allowlisted action。
- `read_business_entity`：只按配置的 typed keys 和字段 projection 读取，不接受原始 `$filter`、`$expand`、URL 或 fragment。

空 dump、空日志和无匹配搜索结果都是有效的空结果，不是连接失败。
