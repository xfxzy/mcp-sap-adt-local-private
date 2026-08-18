# OData 主数据读写手册

在 `config/business-apis.yaml` 中只配置目标系统确实存在的标准 OData V2 service、entity set、keys、operations、mutable/immutable/sensitive/verify fields。`serviceRoot` 必须是相对 `/sap/opu/odata/sap/.../` 路径，不能写 host、凭据、query、fragment 或 traversal。

写入流程固定为：

1. `prepare_business_change` 读取 `$metadata` 和当前实体，返回 typed before/after diff、ETag、keys、系统、API 和过期时间。
2. 把精确计划展示给用户，获得针对该计划的单独批准。
3. `apply_business_change` 一次提交 POST/PATCH，使用 CSRF token、cookie 和 `If-Match`，随后独立 GET 回读并比较 verify fields。
4. 需要恢复时，先用原值生成第二个 restore plan，再单独批准和验证；不自动补偿写入。

敏感字段可以在 allowlist 中显式允许修改，但审计始终脱敏。未知字段、不可变字段、主键、空验证字段、类型/长度/nullability 不匹配和 stale ETag 都会在写入前拒绝。
