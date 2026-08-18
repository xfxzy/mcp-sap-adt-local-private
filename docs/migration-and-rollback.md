# 并行迁移与回退手册

新 server 使用 `mcp-sap-adt-local`，旧 `mcp-sap-assistant` 保持原配置和凭据。迁移时先运行本地 check、list-systems、doctor，再注册新 MCP；确认工具清单和 SAH 只读检查后再将日常任务切换到新名称。

回退只需在 Codex 配置中移除或注释新的 `[mcp_servers.mcp-sap-adt-local]` 区块并重启，旧区块无需恢复。覆盖 skill 前脚本会创建 timestamp backup；安装失败不删除现有 skill。
