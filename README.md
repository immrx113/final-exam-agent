# final-exam-agent
期末保命

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
