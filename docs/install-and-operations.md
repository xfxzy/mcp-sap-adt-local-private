# 安装与启动手册

## 1. 安装依赖

在项目目录执行 `npm.cmd ci`、`npm.cmd run check`、`npm.cmd run build`。完整安装脚本会先执行这些检查，再 `npm pack` 并安装生成的 tarball。

## 2. 配置 SAP 系统

复制 `config/systems.example.yaml` 为 `config/systems.yaml`，填写每个客户测试机的 host、port、client、user、TLS policy、访问开关和 `businessApis.enabledProfiles`。系统 ID 可配置，不限制为 SAH Client 400。

非生产系统可打开 `adtDevelopmentWrite` 或 `businessApiWrite`。生产环境即使配置为 true 也会被 schema 拒绝。过期证书只应使用精确 SHA-256 fingerprint 的 `pinned` 模式，并保留 hostname 检查；不要使用 `insecure` 写入。

## 3. 保存密码和启动

```powershell
mcp-sap-adt-local.cmd login SAH
mcp-sap-adt-local.cmd list-systems
mcp-sap-adt-local.cmd doctor SAH
mcp-sap-adt-local.cmd serve
```

密码输入是终端 raw 模式，不回显字符；输入法切换由 Windows 控制，不要把密码粘贴到日志或配置文件。

## 4. Codex 注册

运行 `scripts/register-codex.ps1`。脚本会备份已有同名条目，默认保留已有 `mcp-sap-assistant`，写入 `MCP_SAP_SYSTEMS_CONFIG` 和 `MCP_SAP_BUSINESS_APIS_CONFIG`，然后重启 Codex desktop。
