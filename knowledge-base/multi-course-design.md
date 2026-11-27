# 多课程学习支持 · 轻量技术方案与实施规划（M6）

本文档给出在不引入外部或本地大语言模型（LLM）、不新增前端运行时依赖、且 100% 向后兼容既有 M1～M5 单课程数据与自动化测试的前提下，将“个人期末复习助手”升级为支持多门课程独立学习的全栈技术方案。

本方案已完成源码审查并经用户确认，实施与验收记录见文末，登记状态见[知识库索引](index.json)，对应的产品范围与 M6-01～M6-08 验收条件见[多课程需求与验收](multi-course-requirements.md)，背景痛点与选型取舍记录见[开发问题与性能优化记录](development-notes.md)。已核验的单课基线遵循[首版需求](personal-review-requirements.md)、[M2](m2-acceptance.md)～[M5](m5-acceptance.md) 及[前端重构开发规划](frontend-refactor-plan.md)。

---

## 1. 总体架构与零破坏兼容设计

### 1.1 现有架构可复用基线与改造面

```text
+-----------------------------------------------------------------------------------+
| React 工作台 (web/)                                                               |
| [新增] 顶栏课程切换器 + 新建课程弹层 | [改造] api.ts / sessionStorage 按课程隔离   |
| [直接复用] ImportWorkspace / Analysis / TopicCard / EvidenceDrawer / Study / Videos|
+-----------------------------------------+-----------------------------------------+
                                          |
                 默认课: /api/course/*     |     多课程: /api/courses/{courseId}/*
                 课程管理: GET/POST /api/courses
                                          v
+-----------------------------------------------------------------------------------+
| Spring Boot 业务后端 (server/)                                                    |
| [新增] CourseApi + CourseMapper + V5__courses.sql (默认种子 id='default')          |
| [改造] 双路径映射控制器、资源归属 course_id 校验、动态导出标题、动态视频检索课程名 |
| [直接复用] Parser / MinerU / PageText / Worker / Store(MinIO) / Redis 版本缓存    |
|            StudyPlan(动态拓扑排序) / VideoRules(热度逐级排序)                     |
+-----------------------------------------+-----------------------------------------+
                                          | ProcessBuilder (input.json 含 course/profile)
                                          v
+-----------------------------------------------------------------------------------+
| Python 轻量分析器 (m2/agent.py + m2/concepts.py)                                  |
| - profile="database"（默认）：完整保留现有数据库词表、SQL 子句与同义词规则         |
| - profile="general"（新建课程）：两趟扫描自举 DYNAMIC_KNOWN/ALIASES + 通用学术后缀 |
|   + PPT 标题要点聚合 + 试卷“名词解释”题型感知 + 复用 m0/agent.py BGE 向量兜底      |
+-----------------------------------------------------------------------------------+
```

### 1.2 保证 M1～M5 测试与存量数据 100% 兼容的三项关键机制

1. **默认种子课程 `id = 'default'` 与独立 `topic_ns` 命名空间**
   - Flyway `V5__courses.sql` 初始化写入默认课程：`id = 'default'`，`name = '数据库原理'`，`topic_ns = '数据库原理'`，`profile = 'database'`。
   - 存量表 `files`、`jobs`、`analysis_versions`、`study_states` 的历史行通过 `DEFAULT 'default'` 自动归属默认课程。
   - 知识点持久 ID 计算公式统一为：`UUID.nameUUIDFromBytes((course.topicNs() + "/" + name).getBytes(UTF_8))`。
     - 对默认课程，`topic_ns` 为 `'数据库原理'`，生成的 UUID 与旧版 `"数据库原理/" + name` **逐字节一致**，历史 `study_states` 笔记在重分析后无损对齐；
     - 对新建课程，`topic_ns` 固定取创建时生成的 `course.id`（UUID），既保证两门课同名考点（如“死锁”）UUID 绝不碰撞，也保证未来若支持课程改名不会导致已有笔记失效。
2. **Spring MVC 双路径映射（零重复 Controller 代码）**
   - 在 `ImportApi`、`AnalysisApi`、`StudyApi`、`VideoApi` 上使用 `@RequestMapping({"/api/course", "/api/courses/{course}"})`，方法参数通过 `@PathVariable(name = "course", required = false) String course` 接收，辅助方法 ` resolveCourseId(course)` 将 `null` 归一为 `"default"` 并校验课程存在性（不存在返回 `404`）。
   - 前端 `api.ts` 对 `courseId === "default"` 继续请求 `/api/course/...`，对其他课程请求 `/api/courses/{courseId}/...`；且当 `GET /api/courses` 在纯前端路由拦截测试（如 `m5-tests/ui-refactor.mjs`）中未被显式 mock 或不可达时，前端兜底回退到单元素默认课程 `[{ id: "default", name: "数据库原理" }]`。这样 **`m1-tests`～`m5-tests`（含 `ui-refactor.mjs` 的路由拦截与 `/api/course/files/.../original` 链接断言）无需重写即可全部原样通过**。
3. **Python `analyze(payload)` 默认 `profile="database"`**
   - 当 `payload` 未传 `profile` 字段（如 `m2-tests/test_agent.py` 的 8 个单元测试和 `holdout.py` 直接调用 `analyze({"batch": ..., "files": ...})`）或 `profile == "database"` 时，加载数据库词包；当 `profile == "general"` 时，启用无数据库词表污染的通用两趟自举提取。

---

## 2. 数据库迁移与存储设计（`V5__courses.sql`）

新建 `server/src/main/resources/db/migration/V5__courses.sql`：

```sql
CREATE TABLE courses (
  seq BIGINT AUTO_INCREMENT PRIMARY KEY,
  id VARCHAR(36) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL UNIQUE,
  topic_ns VARCHAR(80) NOT NULL,
  profile VARCHAR(32) NOT NULL
);
INSERT INTO courses (id,name,topic_ns,profile)
VALUES ('default','数据库原理','数据库原理','database');

ALTER TABLE files
  ADD course_id VARCHAR(36) NOT NULL DEFAULT 'default',
  ADD INDEX idx_files_course (course_id,name,id),
  ADD CONSTRAINT fk_files_course FOREIGN KEY (course_id) REFERENCES courses(id);

ALTER TABLE jobs
  ADD course_id VARCHAR(36) NOT NULL DEFAULT 'default',
  ADD INDEX idx_jobs_course (course_id,seq),
  ADD CONSTRAINT fk_jobs_course FOREIGN KEY (course_id) REFERENCES courses(id);

ALTER TABLE analysis_versions
  ADD course_id VARCHAR(36) NOT NULL DEFAULT 'default',
  ADD INDEX idx_analysis_versions_course (course_id,seq),
  ADD CONSTRAINT fk_analysis_versions_course FOREIGN KEY (course_id) REFERENCES courses(id);

ALTER TABLE study_states
  ADD course_id VARCHAR(36) NOT NULL DEFAULT 'default',
  ADD INDEX idx_study_states_course (course_id,topic),
  ADD CONSTRAINT fk_study_states_course FOREIGN KEY (course_id) REFERENCES courses(id);
```

### 2.1 确定性标识与共享存储细节

- **`files.id` 计算**（`ImportApi.upload`）：
  - `courseId.equals("default")` 时保持 `sha256(role + "\0" + name + "\0" + digest)`（与 V1 存量主键一致）；
  - 其他课程使用 `sha256(courseId + "\0" + role + "\0" + name + "\0" + digest)`，使不同课程可独立上传同名同内容文件并各自展示在所属课程的“已上传文件”抽屉中。
  - MinIO 对象键保持 `original/{digest}` 与 `preview/{job}/{file}/...` 不变，跨课程相同原件自动共享底层存储块。
- **`jobs.id` 计算**（`ImportApi.submit`）：
  - 校验提交的所有 `file` 均存在且 `file.courseId().equals(courseId)`（格式错误返回 `400`，跨课返回 `404`）；
  - `courseId.equals("default")` 时保持 `UUID.nameUUIDFromBytes(manifest)`；其他课程使用 `UUID.nameUUIDFromBytes(courseId + ":" + manifest)`，确保不同课程的批次 UUID 独立。
- **后台解析队列 `Worker.java`**：
  - `items` 与 `segments` 通过 `job` 关联到所属课程，`Worker.runOne()` 按 `jobs.seq` 全局公平消费所有课程待解析文件，**无需改动 `Worker`、`Parser`、`MinerU`、`PageText`、`Store`**。

---

## 3. Spring Boot 后端模块改造清单

### 3.1 新增课程管理模块（`CourseMapper.java` + `CourseApi.java`）

- **`CourseMapper`**：
  - `record CourseRow(String id, String name, String topicNs, String profile) {}`
  - `record CourseSummary(String id, String name, boolean hasPublished) {}`（左连接 `analysis_versions` 判断是否已有发布结果，按 `courses.seq ASC` 排序使默认课排首位或最近创建可见）。
  - 提供 `findById(id)`、`listSummaries()`、`insert(row)`。
- **`CourseApi`（`@RequestMapping("/api/courses")`）**：
  - `GET /api/courses` → `200`，返回 `List<CourseSummary>`；
  - `POST /api/courses`（需请求头 `X-Review-Request: 1`）→ 请求体 `{"name": "操作系统"}`。
    - 校验：`name == null`、去除首尾空格后为空、长度 `> 80`、含控制字符或 `/`、`\` 时返回 `400 BAD_REQUEST`；
    - 生成 `id = UUID.randomUUID().toString()`，`topicNs = id`，新建课统一使用 `profile = "general"`，种子课名称已受唯一键保护；
    - 捕获唯一键冲突 `DuplicateKeyException` 返回 `409 CONFLICT`；成功返回 `201 CREATED` 及新建的 `CourseSummary`。

### 3.2 改造现有四个业务控制器与 Mapper

1. **`ImportApi` & `Catalog`**：
   - 挂载路径改为 `@RequestMapping({"/api/course", "/api/courses/{course}"})`。
   - `Catalog.files(courseId)`、`Catalog.jobs(courseId)` 增加 `WHERE course_id=#{courseId}`。
   - `Catalog.fileInCourse(courseId, id)`、`Catalog.jobInCourse(courseId, job)`：用于 `items`、`retry`、`recheck`、`segments`、`preview`、`original` 入口校验资源归属，跨课访问一律抛 `404 NOT_FOUND`。
   - `segments(...)` 生成预览 URL 时：默认课前缀仍为 `/api/course/jobs/...`，非默认课前缀为 `/api/courses/{courseId}/jobs/...`（保证页内对照与新窗口打开均携带正确课程路径）。
2. **`AnalysisApi` & `AnalysisMapper`**：
   - `latest(courseId)`：按 `course_id` 查询最新 `version_id`；Redis 键维持 `review:m2:{version}`。
   - `analyze(course, job)`：
     - 先校验 `courseRow` 存在且 `job` 归属该 `courseId`（否则 `404`）；
     - 并发控制由全局方法级 `synchronized` 改为按 `courseId` 分桶锁（`ConcurrentHashMap<String, Object>`）或保持轻量串行锁防止本机 CPU 过载；
     - `runAgent` 写入 `input.json` 时传入 `Map.of("batch", version, "course", courseRow.name(), "profile", courseRow.profile(), "files", files)`；
     - `topicId(courseRow.topicNs(), name)` 替代硬编码 `"数据库原理/" + name`；
     - `AnalysisMapper.begin(courseId, version, job)` 写入 `course_id`。
3. **`StudyApi` & `StudyMapper`**：
   - 校验 `version` 存在且 `analysis_versions.course_id = courseId`（否则 `404`）。
   - `states(course, version)` 查询 `WHERE course_id=#{courseId}`；`save(...)` 在 `create` 时写入 `course_id`，`update` 时匹配 `topic`、`course_id` 与 `revision`。
   - `export(course, version)`：
     - 附件名中的 Windows 非法字符替换为下划线，正文保留课名。附件文件名模板为 `courseRow.name() + "-" + version + ".md"`；
     - `markdown(courseRow.name(), result)` 首行标题改为 `"# " + plain(courseRow.name()) + "\n\n..."`。
4. **`VideoApi`、`VideoMapper` & `VideoSource`**：
   - `VideoApi.read` / `retry` 先校验 `version` 归属当前 `courseId`（否则 `404`）。
   - `VideoMapper.next()` 联表 `courses` 返回待检索任务的 `(versionId, courseName)`。
   - `VideoSource` 移除静态常量 `COURSE = "数据库原理"`，改为 `lookup(String courseName, List<String> topics)`：
     - 搜索词拼接 `courseName + " " + topic`；
     - `resolve(..., String courseName)` 中整套课程相关性判断改为：`name.contains(courseName)` 或命中内置可选同义课名映射（保留 `"数据库原理" -> Set.of("数据库系统概论")` 以兼容真实 B 站课程《数据库系统概论》）；
     - 目录后备改为读取 `catalog.path(courseName)`（若该课程在 `video-catalog.json` 无条目则自然跳过目录后备，有考点、成功搜索无匹配且无本课目录的结果允许手动重试，刷新复用已保存结果。其他情况按既有状态机返回 `failed` 或 `"暂无匹配视频"`）。

---

## 4. Python Agent 轻量跨课程提取设计（`m2/concepts.py` + `m2/agent.py`）

### 4.1 课程词包分流（`CourseProfile`）

将当前全局常量重构为按 `profile` 构造的配置对象，确保零跨课污染：

- **`profile == "database"`（未传 `profile` 时的默认值）**：
  - 完整启用现有的 `DB_CORE`、`DB_SUBJECTS`、`DB_ALIASES`（主码/候选码/1NF～5NF 等）、范式重复括号清洗与 `SQL_CLAUSE` 子句归一，行为与当前版本 100% 一致。
- **`profile == "general"`（所有新建非数据库课程）**：
  - `core = ()`，`preset_known = set()`，关闭 `SQL_CLAUSE` 与范式特化正则；
  - 启用下述**两趟扫描自举 + 通用学术构词规则**。

### 4.2 通用学术构词与防误提护栏（`concepts.py`）

1. **术语字符集放宽与边界约束**：
   - 允许概念名包含中文、字母、数字及学科内部符号 `+`、`#`、`/`、`.`、`-`（支持 `B+树`、`C++虚函数`、`I/O多路复用`、`TCP/IP协议`、`IEEE 802.11`），总长 `2～22` 字符，且必须包含至少 2 个汉字或至少 2 个连续英文字母，或有教学结构依据的混合符号术语如 B+树（拒绝 `0`、`D`、`4v02` 等纯编号/单字母噪声）。
2. **扩充通用学术中心词后缀 `GENERAL_NOUN`**：
   - 在原后缀基础上补充跨理工与专业课高频学术中心词：`原理|定理|引理|定律|公式|方程|法则|规则|准则|机制|策略|方法|算法|协议|模型|结构|体系|架构|模式|过程|周期|条件|性质|特征|问题|树|图|栈|队列|链表|堆|哈希|散列|排序|查找|复杂度|进程|线程|信号量|管程|死锁|中断|内存|虚存|缓存|页表|分页|分段|置换|调度|磁盘|文件|帧|报文|分组|路由|拥塞|窗口|套接字|寄存器|流水线|总线|接口|自动机|文法|内聚|耦合|测试|矩阵|向量|空间|变换|极限|导数|积分|分布|检验|回归|熵`。
3. **教学结构与图表噪声黑名单 `NOISE`（守住 `test_agent.py` 全部负向约束）**：
   - 在现有 `NOISE` 基础上补充过滤：`^(?:图|表|公式|算法|定理|定义)\s*[0-9一二三四五六七八九十]+$`（防 `### 图 2`、`表 1` 误入）、`^(?:复习|思考|课后|本章|本节|课程|学习|教学|实验|作业|参考|知识)(?:题|思考题|练习|小结|总结|目标|要求|重点|难点|回顾|导读|大纲|提纲|内容|概述|简介)?$`、`^(?:引言|绪论|概述|简介|总结|小结|目录|致谢|参考文献)$`，以及泛化无指代词 `^(?:基本|主要|常见|一般|核心|重要)(?:概念|定义|原理|方法|特点|性质|过程|步骤|问题|优缺点)$`。

### 4.3 两趟扫描自举流程（`agent.py`）

对 `profile == "general"` 的批次，在处理试卷前对教学材料执行两趟内存扫描（纯正则与集合运算，耗时按测试批次实测登记）：

1. **动态缩写与同义词抽取（`extract_dynamic_aliases`）**：
   - 在去除粗体和括号前，扫描课件与讲义中的括号对照模式：
     `([\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9+/.-]{1,15})\s*[（(]\s*(?:又称|亦称|简称|即|英文简称)?\s*([A-Za-z][A-Za-z0-9+/.-]{1,15}|[\u4e00-\u9fff]{2,10})\s*[)）]`
   - 排除 `（1）`、`（a）`、`（选学）`、`（了解）`、`（掌握）`、`（重点）`、`（续）`、`（图1）` 等非术语括号注记；
   - 建立 `alias -> canonical_name` 映射（例如 `LRU -> 最近最少使用置换算法`、`监控器 -> 管程`），供后续教学归并与考题匹配统一归一化（注意英文短缩写匹配考题时强制使用 `\b` / `(?<![A-Za-z0-9_])...(?![A-Za-z0-9_])` 词边界，防止 `OS` 误命中 `POST`）。
2. **第 1 趟（Pass 1）：收集本课自举词表 `DYNAMIC_KNOWN`**：
   - 从非 `review`、非 `SKIP_LINE` 的教学片段中收集高置信概念名加入 `DYNAMIC_KNOWN`：
     - **结构化小节标题**：`### ...` / `#### ...` 剥离前导章节序号（如 `2.3.1`、`二、`）和尾部英文注记括号后，通过非噪声词校验（`valid_heading_term`）的名称；
     - **排版强调术语**：Markdown 行首或列表项中的 `**术语**`、`【术语】`；
     - **显式定义左值**：满足 `teaching_definition(line)` 的概念名（在通用模式下，若冒号右侧满足 `explanatory` 且含定义谓词 `PROSE`，允许非 `NOISE`、不含句中虚词 `的是不则与将因为所以如果` 的 2～14 字学术短语通过）。
3. **第 2 趟（Pass 2）：四级提取 + PPT 标题要点聚合**：
   - 将 `KNOWN = preset_known | DYNAMIC_KNOWN` 注入四级提取器：
     - `rank = 3`：单行显式定义句；
     - `rank = 2`：标题 `### 概念名` + 紧邻下一行承接解释句；**新增 PPT 列表聚合分支**：若标题下方同页版面列表也可能已被 MinerU 转成无项目符号的短行，按页边界聚合并保持 M1 原文契约。若紧跟 2～4 行以列表符（`•` / `-` / `1.` / `(1)`）开头的非噪声要点且尚无更高 `rank` 定义，将前 3 条要点以 `"；"` 拼接作为 `rank = 2`（或 `rank = 1.5`）的简要说明；
     - `rank = 1`：`KNOWN` 术语在讲义正文句首的陈述解释；
     - `rank = 0`：仅在结构化标题出现、正文仅含图表或公式而无长句解释的术语，保留 `"教学资料列出“{name}”，可打开出处查看上下文。"` 并关联原页预览。
4. **试卷侧题型感知增强**：
   - 跟踪试卷中的大题题型头（匹配 `^[一二三四五六七八九十]+[、.．\s]*(名词解释|概念题|术语解释)` 置 `section_mode = "term"`，遇到下一大题如 `简答题|计算题|综合题|选择题|填空题` 时复位）；
   - 当 `section_mode == "term"` 时，小题题干剥离分值注记（如 `（3分）`、`[4 pts]`）后若为合法术语名，直接作为该题考查的知识点（若教学资料未出现则按既有规则归入 `"待归类"`）；
   - 扩展 `ASKED_CONCEPT` 支持 `(?:什么是|解释|简述|试述|说明|分析)([\w·+/.-]{2,20}?)(?:的概念|的定义|的含义|的作用|的原理|的过程|的机制|的必要条件|的特点|的区别)?`；
   - 未命中题干继续走 `semantic_matches`（`REVIEW_SEMANTIC=1` 时调用 `m0/agent.py` BGE 模型与本课有教学出处的 `topics` 匹配）。

---

## 5. React + TypeScript 前端改造清单（`web/`）

遵循已有的“霁蓝考卷·康奈尔笔记”视觉系统，`package.json` 零新增依赖：

1. **`web/src/types.ts`**：
   - 新增 `CourseSummary = { id: string; name: string; hasPublished: boolean }`。
2. **`web/src/api.ts`**：
   - 新增 `courseBase(courseId: string): string`：`courseId === "default" ? "/api/course" : "/api/courses/" + encodeURIComponent(courseId)`；
   - 新增 `listCourses(): Promise<CourseSummary[]>`（若请求失败或非数组时兜底返回 `[{ id: "default", name: "数据库原理", hasPublished: false }]`）与 `createCourse(name: string): Promise<CourseSummary>`（精细翻译 `400` 名称格式错误与 `409` `"同名课程已存在"`）；
   - 将 `courseApi`、`fetchPublishedAnalysis`、`runBatchAnalysis` 增加 `courseId` 参数（默认 `"default"`）。
3. **`web/src/main.tsx`（及可选抽离 `CourseBar.tsx`）**：
   - 维护 `courses: CourseSummary[]` 与 `currentCourseId: string`（初始从 `sessionStorage.getItem("selected-course") || "default"` 恢复，校验存在于 `courses` 列表中，否则回退首项 `"default"`）。
   - 顶栏 `.masthead` 改造：
     - 副标题由 `本机单课程工作台` 升级为 `本机多课程工作台`；
     - 右侧原静态 `<span className="course-pill">数据库原理</span>` 升级为：
       1. `<select aria-label="当前课程">`（列出全部课程，切换时调用 `switchCourse(nextId)`）；
       2. `<button type="button" className="sub">新建课程</button>`（点击展开轻量内联表单或模态框：含 `<input aria-label="新课程名称" maxLength={80}>`、`创建课程`、`取消`、错误提示 `role="alert"` 及 `Esc` 关闭）。
   - `<h1>` 与 `document.title` 动态绑定 `currentCourse.name`。
   - **切换课程时的干净重置契约**：
     - 递增 `analysisGeneration.current` 使上一门课在途请求全部失效；
     - 清空 `draft`、`picked`、`jobs`、`items`、`publishedSnapshot`、`importError`、`pollError`、`analysisError`；
     - 批次记忆键改为 `sessionStorage.getItem("selected-job:" + currentCourseId)`（对 `"default"` 兼容回读旧键 `"selected-job"`）；
     - 为 `<Analysis key={currentCourseId} courseId={currentCourseId} ... />` 与 `<Videos key={currentCourseId + ":" + publishedSnapshot.version} courseId={currentCourseId} ... />` 传入 `courseId`，确保切换课程时自动关闭上一门课的 `EvidenceDrawer`、重置草稿并请求对应课程前缀下的 `/states`、`/export`、`/videos`、`/files/{id}/original`。
4. **保持全部既有无障碍与测试选择器不变**：
   - `选择课件`、`选择资料`、`选择试卷`、`提交处理`、`[aria-label="处理批次"]`、`分析本批资料`、四页签 `role="tab"`、`页内对照`、`学习笔记 · {考点}`、`保存笔记`、`下载 Markdown 复习文档`、`重试视频检索` 文案与 DOM 层级全部保持不变。
   - 在 `390×844` 与 `1280×800` 视口下校验顶栏课程选择器与超长课程名折行/截断，确保 `scrollWidth <= innerWidth` 零横向溢出。

---

## 6. 分步实施顺序与测试用例设计

遵循[项目编码规范](../coding-standards/README.md)，按模块边界分层设计测试，分 4 步推进：

### Step 1：数据库 V5 迁移与 Spring Boot 多课程后端接口
- **开发内容**：落地 `V5__courses.sql`、`CourseMapper`、`CourseApi`，完成 `ImportApi`、`AnalysisApi`、`StudyApi`、`VideoApi`、`VideoSource` 双路径映射、归属校验、动态 `topicId`/导出标题/视频关键词改造。
- **验证层**：Maven 编译打包；空库 V1～V5 迁移与带数据旧库升级验证；接口级验证 `GET/POST /api/courses`（含空名 `400`、重名 `409`）及跨课访问 `file`/`job`/`version` 返回 `404`（覆盖 **M6-01、M6-02、M6-07**）。

### Step 2：Python 轻量两趟自举提取器与单元回归
- **开发内容**：重构 `m2/concepts.py` 与 `m2/agent.py`，实现 `database` / `general` 配置分流、两趟自举词表、括号缩写动态归一、PPT 标题要点聚合与试卷“名词解释”题型识别。
- **验证层**：
  1. 运行既有 `python -m unittest discover -s m2-tests -v`（规则模式与语义模式）及 `m2-tests/holdout.py`、`m5-tests/holdout.py`，确认《数据库原理》零退化；
  2. 新增跨课程单元用例（例如置于 `m6-tests/test_general_agent.py` 或扩展 `m2-tests`）：用自制《操作系统》与《计算机网络》材料验证标题自举、`LRU` 括号缩写归并、`B+树`/`TCP/IP` 符号术语、PPT 要点聚合、“名词解释”大题命中、教学噪声（`目录`/`本章小结`/`图 2`）过滤，以及确保不混入数据库 `CORE` 词汇（覆盖 **M6-03**）。

### Step 3：React 多课程顶栏工作台与前后端联调
- **开发内容**：完成 `types.ts`、`api.ts`、`main.tsx`、`ImportWorkspace.tsx`、`Analysis.tsx`、`EvidenceDrawer.tsx`、`Study.tsx`、`Videos.tsx`、`style.css` 的 `courseId` 透传、顶栏切换/新建课程组件及窄屏样式。
- **验证层**：`npm.cmd run build --prefix web` 零错误通过；运行 `m2-tests/visibility.mjs` 与 `m5-tests/ui-refactor.mjs` 验证默认课程 UI 契约与双视口无横向溢出。

### Step 4：端到端多课程验收（`m6-tests/`）与全量回归、文档及安全检查
- **开发内容**：编写 `m6-tests/multi-course.mjs`（在专用试用环境 `18085` 使用无头 Edge 端到端覆盖：验证默认《数据库原理》并发创建《操作系统》及重名冲突提示 → 两门课分别导入含同名考点“死锁”的自制材料并发布分析 → 验证“死锁”在两门课中的题数、待办勾选与笔记严格隔离 → 验证切换课程关闭对照抽屉并恢复各自批次 → 验证《操作系统》Markdown 导出文件名/标题与模拟视频源检索词 → 重启 Java 验证双课持久化恢复，完整覆盖 **M6-01 ～ M6-08**）。
- **回归与交付检查**：
  - 在专用测试环境复跑 M2～M5 核心回归套件（`StudyRulesTest`、`VideoRulesTest`、`m2-tests/browser.mjs`、`m3-tests/course.mjs`、`m4-tests/course.mjs`、`m5-tests/course.mjs`）；
  - 同步更新根目录 `README.md` 的多课程使用说明；
  - 按 `AGENTS.md` 更新知识库索引核验状态、日期、范围与实测依据，并在 `development-notes.md` 补齐实测数据；
  - 执行 GitHub 发布安全检查（确认无 `.env`、`.local/`、构建产物、工具目录或敏感信息混入）。

## 实施与验收记录

迁移脚本按上节 SQL 执行。后台沿用串行分析；控制器先按课程校验资源归属，再读取状态、触发视频检索或执行写操作。通用规则位于 `m2/general.py`，由 `m2/agent.py` 按批次调用，数据库路径继续使用 `m2/concepts.py`。React 通过 `CurrentCourse` 提供课程上下文，`useCourseBase()` 生成路由，整个工作区以课 ID 为 key 重挂载。原有版本快照及其中的默认课出处链接可直接读取。

空库迁移、旧库升级、两门课的完整学习流程、长课名双视口和真实 Java 重启均已实测。可复现步骤见[项目 README](../README.md)，测量条件与回归记录见[开发记录](development-notes.md)。
