# epi-watch-web

流行病学 / 传染病建模文献嗅探的 **GitHub Pages 前端**（公开仓）。

数据在私有仓 [`shalom-lab/epi-watch`](https://github.com/shalom-lab/epi-watch)。本站采用 **BYOK**：在浏览器 localStorage 写入 `gh-repo`、`gh-token` 后，用你的密钥拉取 `data/articles.json`。未配置则不展示列表。

## 使用

1. 打开 Pages 站点。
2. 填写仓库（默认 `shalom-lab/epi-watch`）与 GitHub Token。
3. 按期刊、彩色标签、相关度筛选；卡片可展开中文摘要，并链到原文 / PubMed。

Token 建议：fine-grained PAT，仅授权目标仓 **Contents: Read**。密钥只存在本机，不会写入本仓库。

## 本地

直接用静态服务器打开根目录即可，例如：

```bash
python3 -m http.server 8080
```

## Pages

仓库 Settings → Pages → Deploy from branch：`main` / root（已含 `.nojekyll`）。
