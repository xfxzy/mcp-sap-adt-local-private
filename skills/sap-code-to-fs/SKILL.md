---
name: sap-code-to-fs
description: >
  根据 ABAP 源码自动生成功能规格说明书（FS）。当用户要求"输出 FS"、"分析程序并出规格"、
  "这个代码对应的功能说明书是什么"、"帮我把这个程序写成 FS"、"代码走查"、"看懂这个程序"
  时使用。也用分析 SAP 标准程序、自定义程序（Z/Y 开头）、Function Group、Class 的业务逻辑。
---
# ABAP 代码 → 功能规格说明书（FS）

> 从源码自动生成业务顾问能看懂的功能规格文档，不用读代码就能理解程序做什么。

---

## 核心原则

1. **用业务语言，不用技术语言** — "从 MARA 表取物料数据" ✅，"SELECT MATNR ERSDA MTART FROM MARA INTO TABLE GT_MARA" ❌
2. **先画数据流，再展开细节** — 数据流图是最重要的章节，业务顾问看这个就知道全局
3. **不确定的标注"待确认"** — 不要猜，源码里看不出来的就列到 §9 待确认
4. **用模板格式输出** — 从 [fs-template.md](references/fs-template.md) 读取模板，严格按 9 个章节输出

---

## 执行流程

### 第一步：收集信息

```
1. search_repository_object → 确认对象存在、获取 URI 和 type
2. ⚠️ 判断对象类型（CRITICAL — 不同类型的 URI 层级不同，读源码方式不同）
3. read_source_code → 获取完整源码（仅对可直接读的类型）
4. get_object_structure → 获取类/方法/函数签名
5. where_used → 获取引用关系（谁用了这个程序）
```

#### ⚠️ 对象类型判断（必读 — 这一步错了后面全错）

`search_repository_object` 返回的 `type` 字段决定了 URI 指向的层级。**不同层级读出来的内容完全不同：**

| type        | 含义               | URI 示例                               | 直接读源码？ | 不直接读怎么办                                                  |
| ----------- | ------------------ | -------------------------------------- | :----------: | --------------------------------------------------------------- |
| `CLAS/OC` | 类                 | `/oo/classes/zcl_xxx`                |      ✅      | —                                                              |
| `PROG/P`  | 程序               | `/programs/programs/zxxx`            |      ✅      | —                                                              |
| `PROG/I`  | Include            | `/programs/includes/zxxx`            |      ✅      | —                                                              |
| `INTF/OI` | 接口               | `/oo/interfaces/zif_xxx`             |      ✅      | —                                                              |
| `FUGR/FF` | **函数模块** | `/functions/groups/xxx/fmodules/yyy` |      ✅      | —                                                              |
| `FUGR/F`  | **函数组**   | `/functions/groups/xxx`              |      ❌      | 先用`get_object_structure` 拿到 FM 列表和 include，再逐个定位 |
| `TABL/DT` | 表                 | `/ddic/tables/xxx`                   |      ❌      | 用`read_table_structure` 查结构，用 `read_table` 查数据     |

**关键判断**：

- URI 里带 `/fmodules/` → 单个函数模块，可以读 ✅
- URI 里只有 `/functions/groups/<组名>` 但没有 `/fmodules/` → 这是函数组级别，读了会返回整个组的全部 include（几百到几千行）❌
- `TABL` / `DDLS` 类型 → 根本不调 `read_source_code`，调 `read_table_structure` 和 `read_table`

### 第二步：分析源码（思考过程，不输出给用户）

对照源码逐项分析，但不逐行翻译：

1. **程序类型判断**：报表（有 ALV 调用）？增强（有 EXIT/ENHANCEMENT）？接口（有 RFC/HTTP）？转换程序？
2. **选择屏幕提取**：`PARAMETERS` / `SELECT-OPTIONS` → 找到输入参数
3. **数据表提取**：搜 `FROM`、`INTO TABLE`、`INSERT`、`UPDATE`、`MODIFY`、`DELETE` → 剥离技术辅助表（如 WWWDATA/SMW0 模板存储），只列**业务相关**的表
4. **外围接口提取**：搜 `DESTINATION`、`cl_http_client`、`CALL FUNCTION` + DESTINATION、`OPEN DATASET`、`EXEC SQL`、IDoc 相关 FM → 如没有就写"无"
5. **业务逻辑理解**：找到 START-OF-SELECTION、MAIN 方法、核心 FORM → 理解主流程（不是逐行翻译，是业务层面的步骤）
6. **校验规则提取**：搜 `IF ... MESSAGE ... TYPE 'E'` 或 `TYPE 'S'` → 找到校验逻辑
7. **权限提取**：搜 `AUTHORITY-CHECK` → 找到权限对象

### 第三步：输出 FS

按 [fs-template.md](references/fs-template.md) 的 9 章模板输出：

```
1. 程序概要         → 一句话看懂
2. 业务场景         → 什么时候用、谁用、怎么用
3. 输入/输出        → 选择屏幕 + 输出字段表
4. 涉及数据表       → SAP 内部表（读/写分开）
5. 核心业务逻辑     → 主流程 + 关键计算
6. 数据流           → 端到端路径 + 外围系统交互（最重要的一章）
7. 外围系统接口     → 每个接口的详情
8. 关键规则         → 校验 + 权限
9. ⚠️ 待确认       → AI 不确定的列出来
```

---

## 数据流章节写法指南

数据流是 FS 的灵魂——它把程序内部逻辑 + 外围系统调用串联成一条线。

**用表格代替 ASCII 图**：ASCII 图在 Word 里只是一段代码块，不专业。用步骤表+说明表来表示数据流，在 Word 里渲染为原生表格。

### 数据流总览表

先给一张全景表，5 秒看懂完整链路：

| 阶段 | 步骤 | 数据从哪来   | 做了什么   | 数据到哪去     |
| ---- | ---- | ------------ | ---------- | -------------- |
| 输入 | 1    | `<来源>`   | `<动作>` | `<去向>`     |
| 处理 | 2    | `<上一步>` | `<动作>` | `<下一步>`   |
| 输出 | 3    | `<上一步>` | `<动作>` | `<最终目标>` |

### 分步骤详细说明

| 步骤 | 动作      | 数据来源        | 数据去向        | 说明                   |
| ---- | --------- | --------------- | --------------- | ---------------------- |
| 1    | 读取      | `<表名/文件>` | 内存            | 根据条件读取什么数据   |
| 2    | 校验/转换 | 内存            | 内存            | 做了什么校验或格式转换 |
| 3    | 调用/写入 | 内存            | `<表名/接口>` | 最终写到哪里或调了什么 |

### 多程序/多系统协作时

如果涉及多个程序或系统之间的数据传递，单独画一张协作表：

| 阶段 | 谁执行                 | 做什么                         | 传给谁                  |
| ---- | ---------------------- | ------------------------------ | ----------------------- |
| 1    | ZMMC001A               | Excel 上载 + 校验 + 写入中间表 | ZMMT001A                |
| 2    | ZMMC001B               | 读中间表 + 调 FM 创建物料      | ZFMMD_MANTAIN_MATERIAL  |
| 3    | ZFMMD_MANTAIN_MATERIAL | 差异对比 + 调 BAPI             | MARA/MARC/MVKE 等标准表 |

### 外围系统交互

对业务顾问来说这个最关键——**数据有没有成功传给外部系统**：

| 接口 | 方向 | 传什么 | 怎么确认成功 | 失败了怎么办 |
| ---- | ---- | ------ | ------------ | ------------ |

---

## 写作规范

### 表格 vs 段落

- 对比类信息用表格（"读的表 vs 写的表"、"必填 vs 可选"）
- 流程类信息用编号列表
- 背景描述用段落

### 字段说明

- 每个字段必须写**业务含义**，不是 SAP 技术名称
  - ✅ "物料号（系统中唯一标识）"
  - ❌ "MATNR, CHAR40"

### 不确定的处理

源码里看不出来的信息，标注到 §9 待确认：

- 接口的实际目标系统名（RFC Destination 名不等于业务系统名）
- 事务码（源码里可能没有关联事务码）
- 执行频率（定时 JOB 还是手动）
- 使用者 / 部门
- 外部系统的准确名称（MES、PLM、WMS 应该叫哪个系统名）

---

## 程序类型识别

从源码特征自动判断程序类型，在 §1 程序概要中标注：

| 特征                                                                | 类型      | 标签     |
| ------------------------------------------------------------------- | --------- | -------- |
| `REUSE_ALV_GRID_DISPLAY`、`cl_salv_table`、`cl_gui_alv_grid`  | ALV 报表  | 报表     |
| `CALL CUSTOMER-FUNCTION`、`EXIT_`、`ENHANCEMENT-POINT`        | 增强      | 增强     |
| `CALL FUNCTION ... DESTINATION`、`cl_http_client`、`cl_proxy` | 接口      | 接口     |
| `BDC_`、`CALL TRANSACTION`、`BATCH_INPUT`                     | 批导      | 数据导入 |
| IDoc 相关 FM（`MASTER_IDOC_DISTRIBUTE`等）                        | IDoc      | 接口     |
| `SUBMIT`                                                          | 调度程序  | 调度     |
| `AUTHORITY-CHECK` 多 + 少量数据读写                               | 配置/管理 | 配置     |

---

## Debug 检查（输出前自检）

写完 FS 后自检以下问题，有违反就修正：

1. ❌ 有没有技术术语没翻译？（MATNR → 改为"物料号"）
2. ❌ 有没有 SQL 关键字出现在业务描述里？（SELECT → 改为"读取"）
3. ❌ 数据流图表有没有缺失环节？（输入 → 处理 → 输出必须链路完整）
4. ❌ 有没有外围接口没有写失败处理？（每个接口必须说明"失败了会怎样"）
5. ❌ §9 待确认是否空着？（如果源码里看不出来，就和用户说需要确认）
6. ❌ 有没有代码行号出现？（FS 不关心第几行，只关心业务逻辑）

---

## 完成后的下一步

FS 以 Markdown 格式输出到 `output/fs/<程序名>-功能规格说明书.md`。

**结束后主动提示用户转 Word：**

> FS 已保存为 `output/fs/<程序名>.md`。需要转成 Word 发给客户吗？
> 先查 `templates.json` 确认客户对应的 Word 模板（未指定客户则用 `default`），再用以下命令转换：
>
> ```bash
> pandoc output/fs/<程序名>.md -o output/fs/<程序名>.docx \
>   --reference-doc=skills/sap-code-to-fs/assets/word-templates/default.docx
> ```
> 转换后会自动套用统一模板（微软雅黑、标题居中、表格全边框+表头底色、页脚页码）。
