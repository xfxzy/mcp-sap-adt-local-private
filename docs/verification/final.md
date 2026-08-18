# 最终交付记录

本地实现位于 `mcp-sap-adt-local` 独立目录，旧 `mcp-sap-assistant` 不删除、不覆盖。SAH Client 400 的 ADT Z/Y smoke program 已创建、激活并独立验证；业务 OData 只读 discovery 与可逆写入流程已实现，真实主数据写入必须在用户针对精确计划的单独批准后进行。

交付前运行 `npm.cmd run check`、`npm.cmd run test:mcp` 和 `npm.cmd pack --dry-run`，把测试数量、Node 版本、包文件数量和 tarball SHA-256 记录在本文件或发布记录中。密码、session cookie、authorization header 和敏感字段不得进入记录。
