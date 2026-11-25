# 个人期末复习助手 · 首版接口设计

学生在 React 中上传文件、开始分析，随后可以从某个知识点的频次点回原题和原页。此流程涉及两组 HTTP 接口：面向浏览器的 Spring Boot 业务 API，以及仅供 Java 后台任务调用的 Python Agent API。本文是待联调的设计草案。产品口径以知识库登记的 PRD 核验范围为依据；任务重试、版本读取和并发编辑等是本次提出的接口约定。[首版 PRD](personal-review-requirements.md) · [架构提案](architect.md)

## 1. 公共约定

- 业务根路径为 `/api/v1`。下文课程内的相对路径均接在 `/api/v1/courses/{course_id}` 后。ID 为不透明字符串，服务端校验资源归属。个人版由同源 React 调用本机 Java 服务。
- 除文件上传、二进制响应和文档下载外，请求、响应采用 UTF-8 JSON，字段使用 `snake_case`。列表放在 `items` 数组，空列表返回 `[]`。首版一次读取单门课的结果；时间为带时区的 ISO 8601 字符串。
- `job_id` 用于轮询某次分析，`version_id` 标识一次已经发布的课程结果，`topic_id` 是跨分析保留的知识点 ID。React 进入结果页时固定版本，后续请求沿用该版本。笔记和完成状态始终读取最近保存值。
- 失败响应统一包含 `code`、面向用户的 `message`、布尔值 `retryable`、`request_id`；字段校验失败还返回 `fields` 数组，元素含 `field`、`reason`。常用状态码如下。

| HTTP | 典型 code | 客户端行为 |
| --- | --- | --- |
| 400 / 422 | MALFORMED_REQUEST / INVALID_INPUT | 修正请求结构或标出的字段再提交。 |
| 404 | RESOURCE_NOT_FOUND | 检查课程、文件、版本、知识点等资源是否存在且属于该课程。 |
| 409 | JOB_ACTIVE、REVISION_CONFLICT、PREVIEW_PENDING | 分别表示同课有另一任务执行、笔记版本落后、预览尚在生成。响应可带对应的 job_id 或当前 revision。 |
| 413 / 415 | FILE_TOO_LARGE / UNSUPPORTED_FORMAT | 显示该文件的原因，其他文件可继续上传。 |
| 503 | STORAGE_UNAVAILABLE、AGENT_UNAVAILABLE | 保留当前操作；按 retryable 处理临时依赖故障。 |

## 2. 课程、上传与原页

| 操作 | 请求 | 成功响应 |
| --- | --- | --- |
| 新建课程 | `POST /api/v1/courses`，JSON 含非空字符串 name | 201，Course。 |
| 列出课程 / 打开一门课 | `GET /api/v1/courses` 或 `GET /api/v1/courses/{course_id}` | 200，前者返回含 Course 的 items，后者返回一个 Course。Course 包含 course_id、name、current_version_id、latest_job_id；后两项初始为 null。 |
| 上传单份文件 | `POST /files`，multipart/form-data，二进制字段 file，文本字段 role | 201，File；同一课程重传相同内容、名称与用途时返回 200 和已有 File。多选时 React 逐文件提交，分别显示结果与重试。 |
| 恢复上传列表 | `GET /files` | 200，items 为 File 数组。File 含 file_id、name、role、media_type、size_bytes。 |
| 调整上传区域 | `PATCH /files/{file_id}`，JSON 含 role | 200，更新后的 File。只影响下一次提交清单，已提交任务继续使用提交时的用途。 |
| 下载原件 | `GET /files/{file_id}/content` | 200，文件二进制流、原始 Content-Type 和附件文件名。 |
| 打开某处证据 | `GET /versions/{version_id}/sources/{source_id}/preview` | 200，返回此来源对应的 PDF、图片或 UTF-8 纯文本，按类型内联显示。前端用来源记录的 locator 跳页或定位行。 |

role 只取 `courseware`（课件）、`material`（资料）、`exam`（试卷）。三区允许同样的格式：PPT/PPTX、DOC/DOCX、PDF、Markdown、JPG/PNG。Java 核验文件后写入私有 MinIO 桶，并经 MyBatis 登记元数据；上传成功即可取得稳定 file_id。转换预览缺失且无法生成时，前端仍可通过 file_id 提取原件。上传暂存清单与本次分析选择分开，学生可取消选中某个文件再提交。

**Source 数据结构。** 每条来源含 source_id、file_id、file_name、locator。locator 按 kind 区分：`page` 含从 1 开始的 page 和 page_basis（original 或 rendered）；`lines` 含从 1 开始且含首尾的 start_line、end_line；`paragraph` 含从 1 开始的 paragraph；`image` 表示整幅原图。paragraph 定位返回按段落排列的文本预览。证据跨页时返回多个 Source。桶名、对象键和本机路径留在服务端。

## 3. 启动分析、轮询与恢复

| 接口 | 请求和结果 |
| --- | --- |
| `POST /analyses` | 请求含 files 数组，每项含 file_id 和 role，完整列出本轮分析的输入；至少一项，file_id 唯一。同一逻辑试卷的多张图片用相同 paper_group 和不同的正整数 page_order 表示。两字段只用于 exam 分组，省略时一个文件视为一卷。新任务返回 202 及 Job，Location 指向其查询地址。 |
| `GET /analyses/{job_id}` | 200，Job。刷新页面可从 Course.latest_job_id 恢复轮询。 |
| `POST /analyses/{job_id}/retry` | 空请求体。failed 或 partial 任务可用原输入重试失败阶段，返回 202 和新 Job；同一源任务的重复重试请求复用已有重试任务，其 job_id 随响应返回。 |

同一课程、文件内容、用途、试卷分组与分析配置生成同一输入指纹，文件在上传列表中的展示顺序不参与计算。同批重复提交返回已有 Job（执行中 202，终态 200）。追加试卷时提交旧文件和新文件的完整清单。不同输入已有任务执行时返回 409 JOB_ACTIVE。重试保留旧版结果，只有当新结果完整提交到 MySQL 时才切换 current_version_id；Redis 按已发布版本缓存。

以下是一次完成了部分文件分析的轮询响应。files 中的 issue 用于回到存疑页；尚无可用预览时可通过 file_id 打开原件。

```json
{
  "job_id": "j1",
  "status": "partial",
  "stage": "publish",
  "version_id": "v1",
  "files": [
    {"file_id": "f1", "status": "ready", "issues": []},
    {"file_id": "f2", "status": "ready", "issues": [
      {"code": "UNCERTAIN_OCR", "message": "第 2 页公式下标待核对", "locator": {"kind": "page", "page": 2, "page_basis": "original"}}
    ]},
    {"file_id": "f3", "status": "failed", "issues": [
      {"code": "PARSE_FAILED", "message": "文档转换失败", "locator": null}
    ]}
  ],
  "error": null
}
```

Job.status 依次为 queued、running，再进入 succeeded、partial 或 failed。partial 表示已发布可用结果且仍有失败部分；单纯识别存疑可以随成功结果展示。stage 为 queued、parse、extract、match、publish 之一；文件状态为 queued、processing、ready 或 failed。version_id 在结果发布前为 null；无法发布时 error 包含 code、message、retryable。视频检索在发布后独立执行。

## 4. 读取复习结果

本节各路径均以课程内的 `/versions/{version_id}` 为前缀。所有 JSON 查询返回 version_id；未分析时 Course.current_version_id 为 null，前端展示上传入口。已发布版本的知识结构和统计为快照，复习状态与视频检索状态可以继续更新。

| 方法与相对路径 | 返回字段及行为（查询成功为 200） |
| --- | --- |
| `GET /chapters` | items 为有序章节，各含 chapter_id、name、topics。topics 每项含 topic_id、name。待归类知识点放在 chapter_id 为 null、name 为“待归类”的组。 |
| `GET /frequencies` | 返回 exam_paper_count 及有序 items。每项含 topic_id、name、chapter_id、question_count、matched_paper_count。先按命中题数降序，同题数按覆盖卷数降序，再按章节和知识点顺序。 |
| `GET /topics/{topic_id}` | 返回 topic_id、name、chapter_id、text、question_count、matched_paper_count、exam_paper_count、sources、exam_evidence。sources 为教学资料的 Source 数组；exam_evidence 每项含 paper_id、paper_name、question_id、question_label、sources。 |
| `GET /review-plan` | items 按建议学习顺序排列，每项含 position（从 1 起）、topic_id、reason。理由可以引用前置概念或考查频次。 |
| `GET /todos` | 返回 exam_paper_count 和按频次排列的 items。每项含对应频次行的全部字段及 state。首次读取默认 state 为 completed=false、note 为空字符串、revision=0。 |
| `GET /videos` | 返回 status、items、reason、retrieved_at。status 取 pending、running、ready、empty、failed；可用结果来自上次成功查询时，以 retrieved_at 标注时间。首次无结果时 items 为空、retrieved_at 为 null。 |
| `POST /videos/retry` | 空请求体，202，返回与视频查询相同结构，调用方继续轮询。仅重跑该版本的视频查询，执行中的重复请求复用该次检索。 |
| `GET /export` | 有已确认命中时返回 200 和 `text/markdown; charset=utf-8` 附件，文件名包含课程和版本，以 `.md` 结尾。按 PRD 第 6 节组织正文，仅写入命中题数大于零的知识点。没有符合条件的知识点时返回 204，无附件。 |

**统计。** 同一题同一知识点只计一次，独立小问计入后父题不再重复计。只有 exam 类型中已采信的题目关联进入分子，覆盖数按不同试卷计。未纳入的卷不进入分母。无可用卷时分母为 0、两项命中数为 null；有卷但未命中时两项均为 0。知识点详情、待办与导出共用该版本的统计。导出来源映射为文件名及页码或其他定位，真题映射为试卷名、题号与定位；文件中的稳定 id 对应业务接口的 topic_id。导出字段采用白名单，仅含课程知识与依据。

**视频。** 每项含 title、url、topic_ids、target_type（video、collection、episode 或 part）、views、likes、favorites、metrics_scope（video 或 episode）。三个指标为非负整数或 null。首次分析后自动检索，标题相关的候选去重后按可比较的播放量、点赞数、收藏数依次降序，整门课最多 3 条；reason 说明降级或失败原因。分 P 使用整条视频的指标时 metrics_scope 为 video。

## 5. 待办勾选与笔记保存

`PATCH /topics/{topic_id}/study-state` 使用课程前缀，独立于分析版本。请求必填 expected_revision，completed（布尔值）和 note（字符串）至少提供一个。省略的字段保留，空字符串表示清空笔记。保存成功返回 200 和更新后的 state；读取单项使用 `GET /topics/{topic_id}/study-state`，返回 200 和同一结构。两页同时编辑时，Java 在 MySQL 条件更新中比较 revision，发生冲突返回 409 REVISION_CONFLICT 及当前 state，前端保留未保存的文本供核对。

请求与响应示例：

```json
{"expected_revision": 0, "completed": true, "note": "先求候选键，再判断范式。"}
```

```json
{"completed": true, "note": "先求候选键，再判断范式。", "revision": 1}
```

重分析保留稳定 topic_id 对应的 state。课程内 `GET /study-states?archived=true` 返回当前版本中已消失且保存过学习状态的 items，每项含 topic_id、name 和 state，供学生找回旧笔记。

## 6. Spring Boot 调用 Python Agent

拟采用内部同步批次接口 `POST /internal/v1/batches`。Java 在异步分析任务中分批调用它。请求固定含 contract_version（首版为 1）、job_id、batch_id、operation 和 segments。每个片段含 segment_id、text、role；Java 保管 segment_id 到原件位置的映射。两种操作的有效载荷如下。

| operation | 输入 | 200 响应的结果数组 |
| --- | --- | --- |
| extract_topics | 课件和资料片段 | topics，每项含临时 local_id、name、chapter_name（可为 null）、text、aliases、evidence_ids、review_reason（可为 null）。Java 核对证据、归并并分配稳定 topic_id。 |
| match_questions | 同一试卷的连续片段、paper_id、候选 candidate_topics（每项含 topic_id、name、aliases） | questions，每项含批内 local_id、label、parent_local_id（可为 null）、independent（布尔值）、evidence_ids、matches。matches 含 topic_id、evidence_ids、review_reason；试卷独有考点以 topic_id=null、proposed_name 和证据返回，进入待归类。 |

匹配请求示例：

```json
{
  "contract_version": 1, "job_id": "j2", "batch_id": "b2", "operation": "match_questions",
  "paper_id": "paper_a",
  "segments": [{"segment_id": "s9", "role": "exam", "text": "第2题：写出关系模式中的函数依赖。"}],
  "candidate_topics": [{"topic_id": "t1", "name": "函数依赖", "aliases": []}]
}
```

对应的 Agent 响应：

```json
{
  "contract_version": 1, "job_id": "j2", "batch_id": "b2", "operation": "match_questions",
  "questions": [{
    "local_id": "q2", "label": "2", "parent_local_id": null, "independent": true,
    "evidence_ids": ["s9"],
    "matches": [{"topic_id": "t1", "evidence_ids": ["s9"], "review_reason": null}]
  }]
}
```

Java 校验回传标识、非空证据数组、证据是否属于输入片段，以及已有知识点是否来自候选集。待核对关联暂不计数。契约或输入非法返回 422，模型暂不可用返回 503。超时或可重试的 503 沿用同一批次键和输入有限重试；Java 按 job_id、batch_id 唯一接纳一次结果。过期任务的迟到结果不能发布。Python 只返回语义候选，业务计数与发布由 Java 完成。

## 7. 联调验收

1. 同课程上传两份同为 PDF 的讲义和试卷，交换用途再提交。任务按提交时清单计数，上传重试后只保留一份相同卷的命中。
2. 用三份试卷复现“函数依赖 4 题、1/3 份卷”与“关系代数 3 题、3/3 份卷”的排序。逐题从 exam_evidence 打开对应原页，导出后用稳定 ID 比对两个计数。
3. 上传一个坏文件和一个可用文件，验证 partial、失败原因、原件下载和任务重试。轮询到新版本后仍可按旧版本 ID 获取旧统计。
4. 创建无试卷的分析，再加入一份未命中某知识点的试卷，验证 null 与 0；切换版本后笔记与勾选仍在。模拟并发改笔记，过期 revision 返回 409。
5. 模拟 Agent 返回未知片段 ID、重复批次和超时迟到响应，确认错误关联不会进入计数。模拟视频查询失败，核对原页、保存笔记及 Markdown 导出仍可使用。
