<div align="center">

<img src="./resources/logo.jpg" alt="Rosetta Logo" width="108" style="border-radius: 22px;" />

# Rosetta

[![CI Build](https://img.shields.io/github/actions/workflow/status/LycorisNeko/rosetta/build.yml?branch=main&style=flat-square&label=build)](https://github.com/LycorisNeko/rosetta/actions)
[![Electron](https://img.shields.io/badge/Electron-33.2.1-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7.2-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3.1-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-3.4.16-38B2AC?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078D6?style=flat-square&logo=windows&logoColor=white)](https://github.com/LycorisNeko/rosetta/releases)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

<br />

<b>一个用 Electron 与 TypeScript 雕琢的无头协议社交同步中枢与实时镜像工作台。</b>

<br />

[简体中文](README.md) • [English](README_EN.md)

<br />

<img src="./docs/preview.png" alt="Rosetta Preview" width="860" style="border-radius: 12px; box-shadow: 0 12px 36px rgba(0,0,0,0.12);" />

</div>

---

## 它都会些什么

### **镜像监听与频道转推这件事**
- **MTProto 原生二进制常驻**：基于长连接协议静默驻留，零轮询开销；电报频道一有新动作，消息毫秒级直达管道，无需给官方买付费商业 Bot 席位。
- **动态相册防抖聚合**：精准咬住 Telegram 的 `groupedId` 组图标记；开出 2500ms 弹性聚合缓冲池，等齐碎片后整包打包，推特端绝不七零八落发碎图。
- **自适应 Thread 连载串**：推特单推优先塞满 6 张相片；遇上图集超标或长文溢出，自动切分首推与后续推文，挂上回复节点链式织成推文串。
- **高清视频分片排队转码**：自动提取电报消息中的 MP4 视频流；在推特端走完整的 Chunked Media 协议（`INIT` → `APPEND` → `FINALIZE`），分片上传并等待转码状态回落后再点亮推文。
- **出处与时区精准盖印**：自动嗅探转发源头并追溯原作者；带用户名的注上 `RT: t.me/<channel>`，私密转发注上昵称，末尾统一打上西元年月日与分秒时间戳。

### **一键广播与统一发帖这件小事**
- **双端同发或各走各路**：发帖器里单选或同时勾选 X 与 Telegram；敲下一次回车，推文与电报频道广播瞬时同步就绪。
- **长文本智能无损切块**：输入框超过字符限制时自动在标点断句处分流；实时预览切片后的序号与段落分布，发出去的文字不被平台腰斩。
- **官方机器人私聊交互**：人在外头用手机打开电报私聊机器人，发送 `/start` 就能直接把图文塞进中枢；确认后自动落到推特主页，无需开启远程桌面。

### **界面手感与双语质感这件事**
- **Claude 暖色纸质视觉**：摒弃刺眼的纯白与高饱和荧光色，全界面采用低对比温润纸质基底；排版疏朗呼吸，长时间盯盘不累眼。
- **中英双语瞬时穿梭**：顶栏药丸按键就地切换语言，词条覆盖全站 9 个工作子面板；不重新载入页面，当前编辑中的推文草稿不丢。
- **全链路实时活动流水**：状态指示灯实时反馈长连接心跳；发帖瞬间即刻弹出处理态指示，推文一出就地呈现直达链接。

### **细节与工程偏执这件事**
- **逆向 GraphQL 动态签名**：深度还原推特前端签名逻辑，纯 TypeScript 无头实现 `x-client-transaction-id` 算法；告别每月数百美元的官方 API 账单。
- **双重保底数据管道**：主进程与渲染层之间采用高频 IPC 广播配合 3 秒状态看门狗轮询；偶遇操作系统睡眠唤醒，界面流水自动补齐不漏单。
- **凭证锁死在本地沙箱**：不设任何外部云端中转服务器；所有 Session 会话串、Auth Token、账号元数据与过滤规则，全部落在本机的加密与应用存储目录内。
- **双端历史回溯与撤回**：提供独立删帖中枢面板；按需拉取最近 5 条历史存根，误发内容在界面一点即向远端下发真删除。

---

## 开始折腾

### 运行环境
- Node.js `>= 18.0.0`（开发环境推荐 `20.x`）
- pnpm `>= 9.0.0`
- Windows 10 / 11 64-bit（当前预编译安装包支持平台）
- Telegram 官方开发者凭证（前往 [my.telegram.org](https://my.telegram.org) 申请免费的 `API_ID` 与 `API_HASH`）

### 最简运行命令

```bash
# 1. 抓取代码并进入目录
git clone https://github.com/LycorisNeko/rosetta.git
cd rosetta

# 2. 安装项目依赖
pnpm install

# 3. 启动开发模式热重载
pnpm dev
```

### 生产实战构建与踩坑考量
- **国内环境 Electron 镜像加速**：项目已在 `.npmrc` 中内置官方镜像重定向：
  ```ini
  electron_mirror=https://npmmirror.com/mirrors/electron/
  electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
  ```
- **纯 TypeScript 签名算子零 DOM 依赖**：为规避打包后生产环境缺少真实浏览器 DOM 导致 `linkedom` 或 `jsdom` 报错崩掉，签名引擎已改为纯数学 Bézier 曲线重放求解，体积精简且完全兼容 CJS/ESM 运行时。
- **本地凭证重置**：调试时若需清空所有本地状态，直接移除系统用户目录下的配置即可重置为出厂状态：
  ```bash
  # Windows 运行环境
  rmdir /s /q "%APPDATA%\rosetta"
  ```

---

## 发行版本

### CI/CD 流程与 Release 策略
- 代码推入 `main` 分支或触发 `v*.*.*` 标签时，GitHub Actions 自动执行 `pnpm run typecheck` 类型校验与生产编译。
- 自动化构建矩阵产出 Windows 安装程序（NSIS）与免安装便携版（Portable），并就地创建 GitHub Release 发行说明。

### 平台产物对照

| 产物文件名 | 目标架构 | 格式类型 | 附带说明 |
| :--- | :--- | :--- | :--- |
| `Rosetta-Setup-0.2.12-x64.exe` | Windows x64 | NSIS 安装向导 | 支持自定义安装路径，自动创建桌面及开始菜单快捷方式 |
| `Rosetta-Portable-0.2.12-x64.exe` | Windows x64 | 单文件便携版 | 免安装解压即用，配置伴随执行目录或系统 `%APPDATA%` |

### 避坑与运行说明
- **SmartScreen 提示拦截**：开源构建尚未挂载昂贵的商业 EV 签名证书；初次启动如遇 Windows 蓝屏安全拦截弹窗，点击「更多信息」→「仍要运行」即可正常开启。
- **代理与网络穿透**：由于需要直连 Telegram MTProto 与 Twitter GraphQL 端点，请确保本地系统代理（或 Clash / v2ray TUN 虚拟网卡模式）已接管 Electron 主进程流量。

---

## 参考与致谢

- [GramJS (telegram)](https://github.com/gram-js/gramjs) - 扎实的原生 MTProto 协议栈实现
- [electron-vite](https://github.com/alex8088/electron-vite) - 飞速且清晰的现代 Electron 开发体验
- [Lucide Icons](https://lucide.dev/) - 干净利落的界面系统线性图标
- [Tailwind CSS](https://tailwindcss.com/) - 构筑舒缓视觉手感的原子化样式引擎
- 还有屏幕前的你

---

<div align="center">

<img src="./resources/logo.jpg" alt="Rosetta Logo" width="44" style="border-radius: 10px;" />

<sub>Rosetta 根据 MIT 许可证开源开放。所涉及之第三方平台（Telegram、X/Twitter）商标与权利归原作者及公司所有。</sub>

</div>
