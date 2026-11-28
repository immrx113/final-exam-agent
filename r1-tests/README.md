# R1 专用验收

在仓库根目录使用 PowerShell 7、JDK 21、Edge 和 Docker Desktop。先按项目 README 构建前端和后端，再用 `m5-tests/samples.ps1` 生成自制课程样本。若 LibreOffice 位于项目工具目录，传入 `-Office m0/.tools/office/program/soffice.com`。第一个终端运行以下命令，保留其前台 Java 进程。

```powershell
./r1-tests/trial.ps1
```

脚本使用 Docker 项目 `final-review-r1`、专用端口和独立卷，首次启动在被 Git 忽略的 `.local/r1.env` 生成随机凭据。第二个终端运行以下命令。浏览器用两门自建课对照同一套材料，核对逐文件执行次数、统计和逐题出处，计时从点击提交到解析就绪，含上传与排队。

```powershell
$env:REVIEW_TEST_URL = 'http://127.0.0.1:18126'
$env:REVIEW_R1_LOG = '.local/r1-trial.log'
node r1-tests/incremental.mjs
```

以下用例只向专用库的自制样本注入损坏或写入失败。测试工具使用项目已打包的 MinIO 与 MySQL 客户端。

```powershell
New-Item -ItemType Directory -Force .local/r1-test-libs | Out-Null
Push-Location .local/r1-test-libs
jar xf ../../server/target/review-import-1.0.0.jar BOOT-INF/lib
Pop-Location
javac -encoding UTF-8 -cp '.local/r1-test-libs/BOOT-INF/lib/*' -d .local/r1-test-libs r1-tests/StorageFault.java
node r1-tests/recovery.mjs
node r1-tests/restart.mjs prepare
docker compose -p final-review-r1 --env-file .local/r1.env stop minio
node r1-tests/restart.mjs offline
docker compose -p final-review-r1 --env-file .local/r1.env up -d --wait minio
node r1-tests/restart.mjs restored
```

在第一个终端结束 Java，修改 `REVIEW_PARSER_REVISION` 为本次尚未使用的值，重新运行 `./r1-tests/trial.ps1`。在第二个终端运行 `node r1-tests/restart.mjs verify`，检查新批次重建、旧批次及原链接可读。结束试用时退出 Java，再运行 `docker compose -p final-review-r1 --env-file .local/r1.env stop`。
