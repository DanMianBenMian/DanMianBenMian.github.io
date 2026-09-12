# 单面本面 · 个人主页

用纯 HTML 手写、零外部 CDN 的静态站点，部署在 GitHub Pages。

## 文件结构

- `index.html` —— 主页（产品 + 联系）
- `html-app-build.html` —— 「Html App Build」产品子页（下载 + 说明）
- `downloads/HtmlAppBuild.exe` —— Windows 桌面工具安装包（下载时建议文件名仍为「Html App Build.exe」）
- `deploy_github_pages.py` —— 走 GitHub REST API 发布到 Pages 的脚本（绕过本机 git 的代理卡死）

## 发布

```bat
set GITHUB_PAT=ghp_xxxx
python deploy_github_pages.py
```

或直接传 PAT：`python deploy_github_pages.py ghp_xxxx`

默认发布到 `<用户名>.github.io` 仓库。
