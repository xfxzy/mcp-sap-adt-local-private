# Z/Y 程序受控修改手册

只允许系统配置中的 Z/Y 名称、指定 package 和 transport。`prepare_z_program_change` 读取当前对象并生成十分钟计划；`apply_z_program_change` 必须传入精确 plan ID 和 `approveWrite: true`，成功后激活并独立回读；`verify_z_program` 可单独检查 active 状态和源码 hash。

不支持删除、重命名、创建 package、释放 transport、任意 ADT URL 或直接写标准表。写请求不自动重试。当前 SAH 已验证过 `ZR_MCP_ADT_LOCAL_SMOKE` 的创建、激活和 hash 回读。
