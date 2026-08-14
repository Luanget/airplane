# Airplane PWA

一个完全本地存储的轻量记账与预算控制 PWA。

## 当前核心逻辑

- 当前余额 = 初始余额 + 所有收入 - 所有支出 + 余额调整。
- 收入只增加余额，不会自动提高月预算。
- 支出会减少余额，同时计入当月预算使用。
- 当前月“今日不宜超过”会根据此前真实支出动态计算：剩余预算 ÷ 包含今天在内的剩余天数。当天已经发生的支出只会减少“今日还可支出”，不会在当天反复改写当天额度。
- 当前月显示“当前较计划”，按月预算均匀摊到截至今日的计划进度计算；过去月份显示最终结果；未来月份显示“月份尚未开始”，不提前计算计划差额。

## Ubuntu 本地预览

在本目录执行：

```bash
python3 -m http.server 8080
```

浏览器打开 `http://localhost:8080`。请不要直接双击 `index.html`，Service Worker 需要通过 HTTP/HTTPS 工作。

## iPhone 安装

部署到任意 HTTPS 静态站点后，用 Safari 打开页面：分享 → 添加到主屏幕。

## 数据与备份

余额、账单、分类和每月预算默认只保存在当前设备的浏览器本地存储中。换手机或清除 Safari 网站数据前，请在“设置 → 完整备份”导出 JSON。CSV 仅用于查看，不用于完整恢复。


## 本地数据保护

启动时会自动请求浏览器持久化存储（Persistent Storage），设置页可查看状态。它用于降低 iOS 因普通存储压力自动回收 PWA 程序缓存和本地账本数据的风险；人为清除网站数据、删除主屏幕 App 或换机仍需要通过 JSON 备份恢复。

## Update safety

App updates keep the permanent `airplane-pwa-v1` data key, migrate schemas additively, and maintain an on-device recovery copy. Deploy new files to the same HTTPS origin/path; do not change the hosting domain if you expect existing browser data to follow automatically.


## 0.7 首页与交互重构
- 底部只保留“首页 / 记一笔 / 统计”，设置移动到首页右上角。
- 完整账单合并到首页，并支持“全部 / 收入 / 支出”筛选与按日期分组。
- 今日控制卡去掉重复状态文字，直接显示今日已支出和今日还可支出/已超支。
- 月份选择改成自绘的年份 + 12 个月网格，避免 iOS 原生月份控件错位。
- “记一笔”中的“添加分类”升级为“整理分类”，可新增、编辑、隐藏、删除和触摸拖动排序。
- 继续保留草稿、左滑删除/撤销、持久化存储和离线使用。
- Service Worker 更新后自动接管并刷新一次；设置页也提供手动检查更新。


## 0.7.2
- Normalize iOS month/date/time centering.
- Stop auto-focusing form fields when sheets open.
- Make sheet swipe-to-dismiss stable while the iOS keyboard is visible.


## 0.7.3

- 修复 iPhone 上点击金额输入后记账 sheet 因 visualViewport/scrollIntoView 联动而移出视口的问题。
- Sheet 打开期间锁定底层页面滚动，输入键盘出现时不再重算 sheet 高度。
- 下拉关闭改为 iOS Touch Events 优先，键盘打开时也可稳定下拉关闭。
- 继续改善日期/时间控件的居中显示。


## 0.7.5

- 记账金额支持本地算式计算。可以输入 `10+12`、`30-5`、`12×3`、`50÷2`，结果实时显示并以最终金额保存。
- iPhone 数字键盘下方提供 `+ / − / × / ÷` 快捷按钮，不需要切换到完整键盘。
- 金额算式使用本地解析器计算，不使用 `eval()`，不影响原有账本数据结构。
