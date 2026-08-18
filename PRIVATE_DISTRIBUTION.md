# 私有分发与使用说明

本仓库仅供仓库所有者明确授权的 GitHub 协作者下载和使用，禁止转发、公开发布、镜像、销售或向未授权人员提供源码及安装包。完整授权条款见 `LICENSE`。

## GitHub 权限边界

- 仓库必须保持为 Private。
- 只有仓库所有者邀请并授权的 GitHub 账号可以查看、克隆或下载。
- 移除协作者后，该账号不能继续访问仓库或下载后续版本。
- GitHub 无法收回对方此前已经下载的副本，因此访问控制需要与授权条款共同使用。

## 安装前准备

1. 安装 Node.js 20.18.1 或更高版本。
2. 下载本仓库 ZIP，或使用 Git 克隆私有仓库。
3. 在项目目录执行：

```powershell
npm.cmd ci
npm.cmd run check
./scripts/install-local.ps1
```

4. 从 `config/systems.example.yaml` 复制生成本机的 `config/systems.yaml`，填写自己的 SAP 系统信息。
5. 使用 `mcp-sap-adt-local.cmd login <SYSTEM_ID>` 在本机输入密码。密码由 Windows DPAPI 加密，不得写入配置文件或上传 GitHub。
6. 执行 `./scripts/register-codex.ps1`，然后重启 Codex Desktop。

## 不得上传的内容

- `config/systems.yaml` 中的真实客户系统参数
- SAP 密码、令牌、Cookie、Authorization Header
- `%LOCALAPPDATA%/mcp-sap-adt-local/credentials.json`
- 审计日志、SAP 数据导出、客户主数据和生产数据
- `node_modules`、本机临时文件和开发工作树

仓库中的示例主机、用户、公司代码、证书指纹和传输请求均为虚构值，使用前必须替换为各自环境的真实配置。
