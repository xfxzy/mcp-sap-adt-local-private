# TLS 与证书手册

`strict` 使用系统信任链；`custom-ca` 使用指定 CA 文件；`pinned` 同时检查 hostname 和精确 SHA-256 fingerprint。SAH Client 400 的证书长期过期时，只有 `allowExpired: true` 且 fingerprint 精确匹配才允许连接。TLS session cache 已关闭，避免复用连接时拿不到 peer certificate。

证书检查失败时先运行 `mcp-sap-adt-local.cmd doctor SAH`，不要把校验改为任意跳过。`insecure` 明确是只读模式，不能用于 ADT 或业务 API 写入。
