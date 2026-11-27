# final-exam-agent
期末保命

## Windows 多课程工作台

首次打开时会选中《数据库原理》。从旧版升级后，已有文件、批次、已发布分析和笔记归入这门课。点击页面右上角“当前课程”胶囊按钮展开下拉浮层，点击底部“新建课程”输入名称即可创建新课。课程名称最多 80 个字符，须唯一，且不能含控制字符或路径分隔符。自建课程在浮层列表中悬停或键盘聚焦时支持重命名与二次确认删除（内置默认课《数据库原理》锁定保留，不可改名或删除）；重命名不影响已有考点标识与学习笔记，确认删除会级联清理该课程下的文件记录、批次、分析版本与笔记并自动切回《数据库原理》。

在下拉浮层中点击其他课程即可切换，按 `Esc` 或点击浮层外部可收起列表。同一页面会话内切换课程时，工作台会自动关闭已打开的原文对照抽屉，同时在内存中按课程分别暂存未提交的本地上传草稿、已上传文件复用勾选与未保存的待办笔记草稿（切回原课程时自动恢复），并在同一浏览器标签页分别记住每门课上次选择的批次。两门课中同名的考点各自计数，完成状态和笔记独立保存。

新课程从本课标题、强调术语、定义及括号别名提取考点。例如课件写“最近最少使用置换算法（LRU）”，试卷写“LRU”即可关联。规则分析在本机运行，可以沿用 M0 的本地 BGE 模型辅助匹配。Markdown 下载只收录本版本的正命中考点，正文显示课名，附件名中的 Windows 非法字符替换为下划线。参考视频使用当前课名和优先考点检索。已有考点但搜索无匹配、也没有本课候选目录时，可以手动重试。

### 启动与独立试用

安装 PowerShell 7.4+、JDK 21、Maven 3.9、Node.js 22.12+、Python 3.10+、LibreOffice 和 Windows 简体中文 OCR 语言包。启动 Docker Desktop 并切换到 Linux 容器。将 `java`、`mvn`、`npm.cmd`、`python`、`docker` 放在 PATH 中。默认安装位置和 PATH 中的 LibreOffice 均可自动找到，其他位置用 `-Office` 指定。

在仓库根目录的 PowerShell 7 终端运行以下命令。首次启动需联网下载构建依赖和镜像。此路径使用 PDF 文本层、LibreOffice 固定版预览和 Windows OCR；规则分析可在没有语义模型的电脑上运行。

```powershell
$env:REVIEW_SEMANTIC = '0'
./m1.ps1 -Trial -BasicParsing
```

打开[独立试用课程](http://127.0.0.1:18085)。试用模式使用 Docker 项目 `final-review-m5`、独立数据卷和随机生成的 `.local/m5.env`。MySQL、MinIO、Redis 分别绑定本机 33315、39015、36385 端口。保留凭据文件和数据卷即可续用。常规课程仍从 8080 进入。

1. 在课件、资料、试卷三个区选取材料，点击“提交处理”，等解析结束后点“分析本批资料”。单张扫描图归属不明时可以打开原图核对；已知属于同一卷的扫描页可按原顺序整理为一份 PDF。
2. 在“真题频次”展开考点，按标签区分课件与资料出处并核对每道真题（既可新窗口打开，也可点“页内对照”在右侧面板或窄屏底部抽屉查看高亮原行、缩放原页或下载原件，关闭后保留“刚查看”标记）。切至“参考计划”页签看学习顺序，可原地“展开考点与依据”或点“去待办记笔记”直达对应输入框；在“复习待办”页签边对照原文边勾选、写笔记并保存。点击“下载 Markdown 复习文档”取得当前版本的正命中考点和逐题依据。
3. 追加材料时，在“已上传文件”勾选要复用的文件，与新材料一起提交。分析中断后，重开页面，在“处理批次”选择原批次，点“分析本批资料”重试。可继续查看上次成功发布的结果。
4. 前台按 Ctrl+C 结束 Java，再运行 `docker compose -p final-review-m5 --env-file .local/m5.env stop` 停止试用存储。代码未变时用 `./m1.ps1 -Trial -BasicParsing -SkipBuild` 重开。

**复跑自制课程验收。** 保持上述服务运行，在第二个 PowerShell 7 终端进入仓库根目录。浏览器测试需要 Edge。下列用例会向 18085 专用课程发布分析并写入试用笔记。恢复用例另用 18086，只中断自己启动的 Java，清除该版本的一个试用缓存键。样本生成器使用 `soffice.com`；如果它不在 PATH，给第一条命令追加 `-Office '<soffice.com 的完整路径>'`。

```powershell
./m5-tests/samples.ps1
$env:REVIEW_TEST_URL = 'http://127.0.0.1:18085'
node m5-tests/ui-refactor.mjs
node m5-tests/course.mjs
node m4-tests/course.mjs --live --current
node m5-tests/recovery.mjs
$env:REVIEW_SEMANTIC = '0'
python m5-tests/holdout.py
```

其中 `m5-tests/ui-refactor.mjs` 通过路由拦截验证双轨批次工作区、页内原文对照、四页签键盘切换、409 冲突核对、视频统计层级与宽窄屏防溢出，不向课程库写入数据。生成的课件、讲义、三份样卷和一张散页在 `.local/m5-samples`。人工答案和逐题断言在 [M5 课程用例](m5-tests/course.mjs)，机器配置、耗时、质量基线及视频服务限制见 [M5 逐项验收记录](knowledge-base/m5-acceptance.md)。

### M6 双课与重启验收

复跑多课程验收时，在独立试用环境启动前设置 `$env:REVIEW_VIDEO_API='http://127.0.0.1:18442'`，使后端使用测试脚本提供的模拟源。同一测试库只运行一个视频检索后端。在第二个终端执行以下命令，完成 prepare 后重启连接同一库的试用 Java，再执行 verify。

```powershell
$env:REVIEW_TEST_URL = 'http://127.0.0.1:18085'
python -m unittest discover -s m6-tests -v
mvn -q -f server/pom.xml dependency:build-classpath "-Dmdep.outputFile=$PWD/.local/cp.txt"
$cp = "server/target/classes;server/target/test-classes;" + (Get-Content -Raw .local/cp.txt).Trim()
javac -encoding UTF-8 -cp $cp -d server/target/test-classes m6-tests/CourseRulesTest.java
java -cp $cp local.review.CourseRulesTest
node m6-tests/multi-course.mjs prepare
# 重启独立试用 Java 后
node m6-tests/multi-course.mjs verify
```

## M4 课程参考视频

运行 `./m1.ps1`，发布一次课程分析后，复习页底部同级独立的“B 站参考视频”区域会自动按版本检索并标明归属批次与版本号。系统使用课程名和参考计划中最多三个优先知识点查询公开接口，同一查询最多取三个候选做详情匹配。整门课合计最多展示三条。可定位到分 P 或合集单集时直接打开对应的一讲。合集单集按`单集数据`展示指标，分 P、整套课程与独立视频按`整条视频`标注播放、点赞和收藏，共同可用的指标依次参与排序。

没有可用公开搜索候选时，系统会读取[课程 BV 目录](server/src/main/resources/video-catalog.json)，匹配实际标题或讲次，并在视频区状态栏标明“目录后备”来源。维护者可在课程名对应的数组中增补公开课程的 BV 号，重新构建服务后对失败或部分成功的查询点“重试视频检索”，或发布新分析。刷新会读取该版本已保存的结果。目录和搜索均不可用时，页面显示失败原因，其他复习操作仍可使用。

用专用测试服务验证公开来源时，设置 `REVIEW_TEST_URL` 后运行 `node m4-tests/course.mjs --live`。该用例会上传自制资料、发布分析，并在 Edge 打开推荐。验证固定样例时，确保同一测试库没有其他开启视频轮询的后端实例，为专用后端追加 `--review.video-api=http://127.0.0.1:18442`，运行 `node m4-tests/course.mjs`；测试脚本在此端口模拟搜索拒绝、详情不可读、缺失指标和迟到结果。规则测试可在完成 Maven 构建后运行：

```powershell
javac -encoding UTF-8 -cp server/target/classes -d server/target/test-classes m4-tests/VideoRulesTest.java
java -cp "server/target/classes;server/target/test-classes" local.review.VideoRulesTest
```

## M3 复习计划、待办与 Markdown 导出

运行下方的 `./m1.ps1` 并分析课程材料。在课程分析区页签栏切换至“参考计划”（支持点击或键盘方向键切换），可以看到每一步的理由，并可按需点击“展开考点与依据”原地核对出处与真题，或点击“去待办记笔记”跳转到对应待办笔记框。讲义或课件明确写出“先求候选键，再判断第三范式”等先后关系时，计划会优先安排可见的前置点，并给出原文入口。当前通过文字规则识别明确表述；缺少依据或关系成环时沿用频次或章节顺序。旧版分析结果可直接使用，重新分析后可生成有出处的前置关系。

切换至“复习待办”页签可同步查看完成进度徽章，逐项展开真题和教学出处，勾选完成状态，编辑或清空学习笔记后点“保存笔记”。记录保存在本机 MySQL，同名知识点重新分析、排名改变或暂时隐藏再出现时可恢复。两个页面同时编辑同一项时会展开冲突双栏核对框，并列展示已保存内容与当前草稿，支持一键“填入已保存内容”或手动合并后保存。

点击“下载 Markdown 复习文档”可下载页面所示版本的 UTF-8 `.md` 文件。文档按章节收录至少有一道已确认真题命中的知识点，包含说明、题数、覆盖卷数和逐题位置。个人笔记及完成状态只在课程内保存。没有有效试卷或全部零命中时，页面说明原因，导出接口不生成附件。

在专用测试课程上设置 `REVIEW_TEST_URL` 后运行 `node m3-tests/course.mjs`，用 Edge 验证实际导入、学习顺序、笔记冲突与重试、重分析和 Markdown 下载。用例会发布自制批次并修改测试课程的学习记录。

验收重启恢复时，先执行 `node m3-tests/restart.mjs prepare`，重启连接同一测试数据库的 Java 服务，再执行 `node m3-tests/restart.mjs verify`。如已按 M2 故障验收说明设置 `REVIEW_FAULT_URL`，还会核对分析失败时已发布版本的导出内容和学习记录。

## M2 章节、真题频次与原题回看

在三个上传区选择本次要分析的全部材料，点击“提交处理”。已导入的文件可从“已上传文件”勾选复用。批次解析结束后点击“分析本批资料”，在“真题频次”和“章节目录”之间切换。展开知识点可以区分课件/资料出处与真题列表，通过新窗口或“页内对照”面板逐题核对原页、缩放扫描图或定位 Markdown 高亮原行。只上传教学材料也可以生成目录。分析期间和失败后，页面保留上次发布的结果并标明批次。

有有效试卷时，真题频次和章节目录仅展示至少命中一题的知识点。排名按题数降序，每项显示覆盖卷数与有效卷总数。完整重复文件按内容去重，题号与来源随每次发布保存。“待核对”列出试卷分组不明、题干模糊或关联依据不足的材料和位置。现阶段可回看这些位置。若要修改归属，可整理原材料后重新提交完整批次。

本地 Python Agent 识别章节标题、定义、常见题号和编号小问，利用知识点名称和别名匹配题干。若本机已按 M0 步骤准备兼容的 BGE 模型和 Python 环境，启动脚本会对未直接命中的题干启用语义匹配。`REVIEW_SEMANTIC=0` 可关闭该步骤。复杂版式、隐含考点、未编号题目及重扫版同卷仍需人工复核；不同扫描件仅在提取文字一致等可判定情形下标疑。

使用专用测试课程运行以下命令。浏览器用例需要 Microsoft Edge，默认连接本机 8080 端口，其他测试地址通过 `REVIEW_TEST_URL` 指定。用例会向该课程导入自制材料并发布分析结果。

```powershell
node m2-tests/browser.mjs
node m2-tests/edges.mjs
python -m unittest discover -s m2-tests -v
python m2-tests/holdout.py
```

故障验收可在同一专用测试库上另启一个后端实例，追加启动参数 `--server.port=18083 --review.agent=m2-tests/fault_agent.py --review.agent-timeout-seconds=2`，将 `REVIEW_FAULT_URL` 设为该实例的本机地址后运行 `edges.mjs`。Redis 回退可在专用实例上停用缓存，比较停用前后 `GET /api/course/analysis` 的完整响应，再恢复缓存。

已准备 M0 模型时，直接运行 Python 测试前可设置 `$env:REVIEW_SEMANTIC='1'` 并使用兼容的 Python 3.12。四题独立抽查卷共标注 5 个考点关联，本机模型命中 4 个，无额外命中。隐含外键考点的一题进入待核对。该样例用于跟踪后续变化。

## M1 课程资料导入

PDF 和 Office 固定版预览优先使用本机 MinerU 的 `/file_parse` 接口，与 know-engine 共用 `pipeline` 解析方式。课程页按 MinerU 返回的页号读取标题、段落和列表；表格、公式和图示保留原页入口。旧批次点击“重新识别正文”会用 MinerU 从原件重新处理，完成后点击“分析本批资料”更新课程结果。本机接口不可用时，继续使用原有的文本层检查与 Windows 中文 OCR。重新识别失败会保留上一次已保存的内容。

知识点根据可定位的教学标题、术语及定义提取。冒号也常出现在页脚、图例和数据行中，分析器会检查名称与后续文字是否构成概念说明；同一知识点有多处依据时优先展示定义。明确出现在标题中但缺少完整说明的术语会提示查看原页。

默认 MinerU 地址为 `http://127.0.0.1:8000`，可用 `REVIEW_MINERU_URL` 指定其他本机 HTTP 端口。已有 know-engine 的本机 MinerU 服务可直接复用。在新机器上也可按以下步骤创建项目专用环境，之后运行 `./m1.ps1` 会在默认端口空闲时启动服务。首次解析需要下载模型，本地环境、模型和日志均存放在被 Git 忽略的 `.local` 下。

```powershell
py -3.12 -m venv .local/mineru-env
./.local/mineru-env/Scripts/python.exe -m pip install "numpy==1.26.4" "mineru[pipeline]==2.7.6" fastapi uvicorn python-multipart
```

M1 和 M2 共用下方启动命令与本机课程页。M2 另需 Python 3.10+，可用 `REVIEW_PYTHON` 指定解释器路径。启动脚本优先使用根目录的 `.env`，缺少时会复用已有 M1 worktree 的 `.worktrees/m1/.env`。也可用 `-EnvFile` 指定与现有卷配套的文件。启动会自动执行数据库迁移，并启动仅绑定本机 36379 端口的 Redis。

使用 worktree 的凭据时，停止存储的命令为 `docker compose --env-file .worktrees/m1/.env stop`。指定其他凭据文件时将路径换成对应文件。

打开《数据库原理》，在课件、资料、试卷三个区选择文件，可在提交前调整用途。按文件查看处理状态、下载原件，并从文本打开 PDF 原页图像、Office 转换预览、Markdown 原行或上传的原图。受损扫描页保留核对入口。相同名称、用途和内容的文件复用同一记录；再次提交同一组文件会打开已有批次。

在 Windows 上使用 PowerShell 7.4+、JDK 21、Maven 3.9、Node.js 22.12+ 和运行中的 Docker Desktop（Linux 容器）。Office 预览需要 LibreOffice，中文扫描识别使用 Windows 简体中文 OCR 语言包。首次启动会下载构建依赖和镜像。在仓库或 M1 worktree 根目录运行：

```powershell
./m1.ps1
```

浏览器打开 [本机课程页](http://127.0.0.1:8080)。脚本先构建 React 和 Java，再启动 MySQL 与 MinIO，并在前台运行 Spring Boot。可用 `-Office '<soffice.com 的完整路径>'`、`-Maven '<mvn.cmd 的完整路径>'` 指定工具；脚本也会查找主工作区已准备好的 M0 LibreOffice。已有构建产物时用 `./m1.ps1 -SkipBuild`。按 Ctrl+C 结束 Java，再用 `docker compose stop` 停止存储。下次运行脚本可恢复课程。

本机服务分别占用 8080、33306、39000 端口。首次运行生成的 `.env` 保存访问本机存储的随机凭据，请与 Docker 数据卷一同保留。MinIO 使用固定摘要的 Bitnami 归档镜像。每份文件上限 50 MB；图片解码上限 4000 万像素。Office 预览采用转换后的页序。OCR 的短文本会标记待核对，公式或下标误识别仍需对照原图。

[M1 需求与验收场景](knowledge-base/m1-acceptance.md) 列出了逐项核对的预期结果。生成含三页扫描卷的 M0 样例后，在专用测试课程运行以下命令，可向当前本机实例导入 11 份自制材料并核对结果。

```powershell
node m1-tests/import.mjs '<M0 样例输出目录>'
```

## M0 可行性原型

在 Windows 上生成《数据库原理》自制样卷和 Office 样例，运行中文 OCR 与本地考点匹配，再从演示页打开对应原页。人工答案位于 [样例清单](m0/fixtures/truth.json)，本机结果与局限见 [M0 实测记录](knowledge-base/m0-results.md)。

从仓库根目录用 PowerShell 7 运行。实测环境使用 64 位 JDK 21、Python 3.12（含 pip）、Windows PowerShell 5.1、简体中文 OCR 语言包和微软雅黑。首次准备需要联网，依赖存入 `m0/.tools/`。准备脚本会下载约 376 MB 的 LibreOffice 安装包并在该目录解包。

```powershell
./m0/prepare.ps1 -Python python
./m0/run.ps1 -Python python
```

两个脚本的 `-Python` 均可传入解释器绝对路径。已有 LibreOffice 时，准备阶段可加 `-SkipOffice`，运行阶段用 `-Office '<soffice.com 的完整路径>'` 指定程序。每次在 `m0/out/run-*/` 生成一份独立结果，控制台给出 `index.html` 的路径。`evaluation.json` 逐项对比人工标注，`request.json` 和 `response.json` 保存该批次的实际调用。验收不通过时脚本返回错误。

单独运行 `./m0/video.ps1` 可重新探测 B 站公开搜索、已知视频的分 P 目录及整条视频的互动指标。网络或接口失败会记入 `m0/out/video.json`。本地样卷验收可以离线重跑。

## 开发约定

- [项目知识库索引](knowledge-base/index.json) 记录文档状态、核验依据及适用范围。
- [开发问题与性能优化记录](knowledge-base/development-notes.md) 汇集问题背景、解决方案和验证结果，供整理项目亮点时查阅。
- [编码规范](coding-standards/README.md) 记录测试用例设计与执行、文档维护和 GitHub 发布安全检查的约定。
