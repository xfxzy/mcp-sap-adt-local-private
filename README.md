# mcp-sap-adt-local

本项目是本地运行的 SAP ADT + allowlisted OData MCP server。它保留旧的 `mcp-sap-assistant`，使用独立的 MCP 名称和独立配置，不包含试用期、激活码、机器码或远程 license 校验。

## 快速开始（Windows）

```powershell
cd C:\path\to\mcp-sap-adt-local
npm.cmd ci
npm.cmd run check
npm.cmd run build
.\scripts\install-local.ps1
.\scripts\register-codex.ps1
```

配置系统：`config/systems.yaml`。配置标准 OData API：`config/business-apis.yaml`。密码只通过 DPAPI 凭据存储，不写入 YAML、日志或 MCP 返回值。

```powershell
mcp-sap-adt-local.cmd login SAH
mcp-sap-adt-local.cmd list-systems
mcp-sap-adt-local.cmd doctor SAH
mcp-sap-adt-local.cmd logout SAH
mcp-sap-adt-local.cmd trust-certificate SAH
mcp-sap-adt-local.cmd install-skills
```

旧服务器配置 `[mcp_servers.mcp-sap-assistant]` 不会被删除。注册后重启 Codex desktop，新的 server 名称是 `mcp-sap-adt-local`。

## 能力边界

- 16 个既有只读工具，以及 `list_business_apis`、`inspect_business_api`、`read_business_entity`。
- Z/Y 程序只能按 prepare -> apply -> verify 流程创建、修改、激活和验证。
- 标准 OData 主数据按管理员 allowlist 读取和修改；每次写入都要求精确计划和 `approveWrite: true`，带 ETag 并独立回读。
- 生产系统强制只读；不支持直接写标准表、任意 URL、generic DELETE、标准对象修改、transport release。

详细操作见 `docs/install-and-operations.md`、`docs/tls-and-certificates.md`、`docs/read-tools.md`、`docs/zy-development.md`、`docs/odata-business-manual.md` 和 `docs/migration-and-rollback.md`。
