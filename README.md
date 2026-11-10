# e5-webapp-esim

E5 信息屏的 eSIM 管理 WebApp，适用于 OpenWrt 25.12.5 和信息屏插件 API v2。安装包携带配套的 LuCI APK，安装应用后自动安装 LuCI 面板及其依赖。

## 功能

- SIM 1 / SIM 2 配置文件列表、详情、启用、停用、重命名与删除。
- eSTK 多 SE 选择、EID 和芯片信息。
- 激活码下载、确认码、配置文件预览、写入进度与取消。
- 通知查看、上报和删除。
- 触屏及方向键操作，中英文界面，跟随信息屏主题。

信息屏与 LuCI 共用后台任务和操作锁。关闭应用后任务继续执行，再次打开可恢复任务显示。配置文件操作会影响对应卡槽的网络连接。

## 安装

将构建生成的 `dist/esim-1.0.1.tar.gz` 上传到信息屏的「应用管理」，或复制到设备后执行：

```sh
/usr/libexec/e5-infoscreen/plugin install /tmp/esim-1.0.1.tar.gz
```

每个新安装包会在信息屏首次加载后端时启动一次配套安装，包括应用尚未打开时的通知轮询。打开应用后，安装日志在独立区域滚动显示并跟随最新输出；向上滚动可查看历史。失败时保留日志和重试按钮。安装需要设备能够访问配置的软件源。LuCI 面板位于「蜂窝 → eSIM 管理」。

打开应用时进行一次实际包检查；安装期间每秒读取进度和日志，完成或失败后停止轮询。通知轮询只读取安装尝试标记，由新包触发一次安装。普通 eSIM 请求直接调用后台。

LuCI APK 保留 `luci-base`、`rpcd`、`python3`、`lpac`、`libcurl-gnutls4` 依赖声明。LuCI 页面还会检查 `/usr/lib/lpac` 和 `/usr/lib/libcurl-gnutls.so.4`，缺失时给出安装命令和软件包管理入口。

应用卸载后，LuCI 面板及已安装的系统依赖继续保留，可单独通过软件包管理卸载。

## 源码与构建

`luci-app-e5-esim/` 是 Git 子模块，固定配套后台与 LuCI 面板版本：

```sh
git submodule update --init --recursive
```

在 x86_64 Linux 安装 SDK 所需工具后构建：

```sh
sudo apt-get update
sudo apt-get install -y zstd build-essential rsync file gawk python3 libncurses-dev git unzip wget
python3 tools/build.py
```

脚本下载并校验固定的 OpenWrt 25.12.5 SDK，生成一个 noarch LuCI APK 和包含它的 WebApp 压缩包。已有 SDK 可传入 `--sdk /path/to/sdk`。下载与 SDK 工作目录保存在 `.cache/`，产物位于 `dist/`。

| 路径 | 用途 |
| --- | --- |
| `esim/` | 信息屏界面、ucode 后端与安装脚本 |
| `luci-app-e5-esim/` | 配套 LuCI 应用和 Python eSIM 后台子模块 |
| `tools/build.py` | 固定 SDK 构建及应用打包 |
| `tests/` | 界面流程与后台安装回归测试 |

安装器在独立工作目录保存 APK 快照、校验 SHA-256，通过 `apk add --allow-untrusted` 安装本地 APK，软件源依赖仍由 apk 解析。成功后记录所安装包的摘要；升级 WebApp 时自动安装新的配套包。

## 验证

```sh
python3 -m unittest discover -s tests
npm install --no-save playwright-core
CHROME_BIN=/usr/bin/google-chrome node tests/frontend.cjs
cd luci-app-e5-esim
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests
node tests/frontend.cjs
```

设备调试可使用相邻 `infoscreen-plugins/tools/device.py --host root@192.168.8.1` 的截图、触屏及按键命令。

参考 [CharlesGool/e5-webapps](https://github.com/CharlesGool/e5-webapps) 的信息屏插件与 LuCI 配套安装方式，以及 [infoscreen-plugins](https://github.com/XiaoMengXinX/infoscreen-plugins) 的插件 SDK。运行 eSIM 的桥接与后台逻辑由 LuCI 子模块提供。
