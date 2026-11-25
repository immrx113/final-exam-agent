# final-exam-agent
期末保命

## M2 章节、真题频次与原题回看

在三个上传区选择本次要分析的全部材料，点击“提交处理”。已导入的文件可从“已上传文件”勾选复用。批次解析结束后点击“分析本批资料”，在“真题频次”和“章节目录”之间切换。展开知识点可以逐题打开原页、原图或 Markdown 原行。只上传教学材料也可以生成目录。分析期间和失败后，页面保留上次发布的结果并标明批次。

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
