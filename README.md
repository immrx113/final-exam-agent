# final-exam-agent
期末保命

## M1 课程资料导入

打开《数据库原理》，在课件、资料、试卷三个区选择文件，可在提交前调整用途。按文件查看处理状态、下载原件，并从文本打开 PDF 原页图像、Office 转换预览、Markdown 原行或上传的原图。受损扫描页保留核对入口。相同名称、用途和内容的文件复用同一记录；再次提交同一组文件会打开已有批次。

在 Windows 上使用 PowerShell 7.4+、JDK 21、Maven 3.9、Node.js 22.12+ 和运行中的 Docker Desktop（Linux 容器）。Office 预览需要 LibreOffice，中文扫描识别使用 Windows 简体中文 OCR 语言包。首次启动会下载构建依赖和镜像。在仓库或 M1 worktree 根目录运行：

```powershell
./m1.ps1
```

浏览器打开 [本机课程页](http://127.0.0.1:8080)。脚本先构建 React 和 Java，再启动 MySQL 与 MinIO，并在前台运行 Spring Boot。可用 `-Office '<soffice.com 的完整路径>'`、`-Maven '<mvn.cmd 的完整路径>'` 指定工具；脚本也会查找主工作区已准备好的 M0 LibreOffice。已有构建产物时用 `./m1.ps1 -SkipBuild`。按 Ctrl+C 结束 Java，再用 `docker compose stop` 停止存储。下次运行脚本可恢复课程。

本机服务分别占用 8080、33306、39000 端口。首次运行生成的 `.env` 保存访问本机存储的随机凭据，请与 Docker 数据卷一同保留。MinIO 使用固定摘要的 Bitnami 归档镜像。每份文件上限 50 MB；图片解码上限 4000 万像素。Office 预览采用转换后的页序。OCR 的短文本会标记待核对，公式或下标误识别仍需对照原图。

[M1 测试用例生成输入](knowledge-base/m1-acceptance.md) 可独立交给测试设计者。生成含三页扫描卷的 M0 样例后，在专用测试课程运行以下命令；它会向当前本机实例导入 11 份自制材料并核对结果。

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
- [编码规范](coding-standards/README.md) 记录需求完成后的文档维护和 GitHub 发布安全检查。
