# Phase 5 Delivery Verification

交付包含三个 skill：`sap-code-to-fs`、`sap-dump-diagnose`、`sap-interface-diagnose`。入口统一为 `SKILL.md`，FS skill 保留 `references/fs-template.md`、`templates.json` 和 Word 模板资产。

`install-skills` 默认拒绝覆盖已有目录；传入 `--overwrite` 时先移动到 timestamp backup。`install-local.ps1` 会执行依赖安装、完整 check、npm pack 和本地全局安装。`register-codex.ps1` 使用独立的 `[mcp_servers.mcp-sap-adt-local]` 区块，保留旧的 `mcp-sap-assistant`。

最终门禁：

```powershell
npm.cmd run test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test:mcp
npm.cmd pack --dry-run
```

不要把 npm 的 MIT `LICENSE` 文件误判为试用限制；源码、依赖和构建产物中没有 activation、trial、machine-id 或远程 license enforcement 逻辑。
