# Airplane PWA

一个完全本地存储的轻量记账与预算控制 PWA。

## Ubuntu 本地预览

在本目录执行：

```bash
python3 -m http.server 8080
```

浏览器打开 `http://localhost:8080`。请不要直接双击 `index.html`，Service Worker 需要通过 HTTP/HTTPS 工作。

## iPhone 安装

部署到任意 HTTPS 静态站点后，用 Safari 打开页面：分享 → 添加到主屏幕。

## 数据与备份

账单、分类和每月预算默认只保存在当前设备的浏览器本地存储中。换手机或清除 Safari 网站数据前，请在“设置 → 完整备份”导出 JSON。CSV 仅用于查看，不用于完整恢复。
