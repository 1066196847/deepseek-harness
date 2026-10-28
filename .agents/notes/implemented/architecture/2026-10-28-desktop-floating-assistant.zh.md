# Agent Note: 桌面悬浮助手置于其他应用之上

Status: implemented

[English](2026-10-28-desktop-floating-assistant.md) | 中文

## Problem

桌面端用户只能通过主窗口接触运行中的 Harness agent，而主窗口是一个普通窗口，会被前台应用遮挡。产品需要一个常驻界面，停留在所有其他窗口之上、覆盖 macOS 的每个空间与全屏应用，同时不引入第二套应用后端或第二套客户端组合。

## Decision

壳层以两个置顶窗口拥有悬浮助手。悬浮球是壳自有的 `dsh-app://shell/floating-ball.html` 文档，运行在无框、透明、不可调整尺寸的 `floating` 层级窗口中，在 macOS 上跨所有空间并覆盖全屏应用；拖动通过窄 preload IPC 移动窗口，点击则切换面板。面板是第二个置顶窗口，加载带 `?dshCompact=1` 的普通产品文档，因此已认证的 Web 应用、boot 注入、Host cookie 与 WebSocket 凭据注入全部原样生效。

主进程的 `ownedProductWindow` 只承认两个产品文档——主窗口与面板主帧——进入产品 IPC 守卫、启动失败上报、语言与主题同步以及 WebSocket 凭据注入。客户端 frame 读取 `dshCompact` 查询参数，只渲染一条壳拖拽条之下的中列，不渲染 sidebar、rightbar、底行与窗口 chrome 席位；URL 拥有该模式，面板重载无需壳状态即可恢复。

助手通过应用菜单复选项（以及 Windows 标题栏 Application 菜单）按需开启。启用标志与悬浮球位置持久化在 `userData/desktop/floating-assistant.json`；文件不可读时以关闭状态启动。Escape 隐藏面板，悬浮球点击与复选项在悬浮球旁重新显示面板并夹入悬浮球所在显示器的工作区，取消勾选销毁两个窗口，退出时随壳层其余部分一并释放。

## Alternatives considered

**单窗口在球与面板之间改变尺寸。** 收起时需要导航或缩放离开客户端文档，每次收起都会丢失草稿与滚动位置；否则球状态会在桌面上保留面板大小的透明命中区域。

**像更新对话框那样在主窗口上挂 WebContentsView overlay。** overlay 随属主窗口生灭，主窗口隐藏时助手也会消失；常驻需要不受主窗口生命周期拥有的窗口。

**仅用 macOS 菜单栏图标作为入口。** Windows 上没有常驻视觉锚点，且面板被绑定到菜单项而非用户可放置的悬浮球；托盘仍保持仅 Windows 存在。

**默认开启常驻。** 每次启动都出现悬浮球会进入无头资格验证运行与测试 harness 的窗口索引，先于任何用户选择；复选项使常驻成为显式且持久化的用户选择。

## Consequences

产品 IPC 与 WebSocket 凭据守卫从承认一个产品文档变为两个；每个新产品窗口都必须显式加入 `ownedProductWindow`。一个壳文档、一个沙箱 preload 及其打包文件清单项加入发布载荷。compact frame 是 `ui-layout` 的 URL 驱动布局模式，由 frame spec 与三列用例并列覆盖。悬浮窗口保持在快捷键 attach 与 overlay owner 机制之外，因此产品快捷键与更新 overlay 仍只作用于主窗口。
