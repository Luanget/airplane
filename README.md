# Airplane PWA

一个完全本地存储的轻量记账与预算控制 PWA。

## 当前核心逻辑

- 当前余额 = 初始余额 + 所有收入 - 所有支出 + 余额调整。
- 收入只增加余额，不会自动提高月预算。
- 支出会减少余额，同时计入当月预算使用。
- 当前月“今日不宜超过”会根据此前真实支出动态计算：剩余预算 ÷ 包含今天在内的剩余天数。当天已经发生的支出只会减少“今日还可支出”，不会在当天反复改写当天额度。
- “本月较计划”继续按月预算均匀摊到截至今日的计划进度计算，低于计划显示“节省”，高于计划显示“多支出”。

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


## 0.6 交互完善
- 默认/自定义分类支持拖动排序；记账页同步顺序。
- 记账 Sheet 支持下拉关闭，并保留 30 分钟未完成草稿。
- 明细点整行编辑、左滑删除并支持撤销。
- 记住最近使用的收入/支出分类。
- 月份支持左右快捷切换；扩大触控区域并改善键盘遮挡。
