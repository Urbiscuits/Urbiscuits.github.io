# 小程序同步到 GitHub 所用接口（可选）

**默认方式（推荐，免部署）**：小程序点击「同步到云端」或「复制并到网页保存」后，数据会复制到剪贴板。用户打开 [https://urbiscuits.github.io/](https://urbiscuits.github.io/) 网页，登录同一账号/管理员，在个人中心或数据同步操作处粘贴并点击「粘贴并同步到云端」即可。网页端已配置 GitHub Token，可直接上传。

**可选：直接上传接口**：若希望小程序端一键上传而不需要打开网页，可部署本目录下的接口。  
需将本接口部署到与「题库地址」同域或在小程序后台配置的 request 合法域名下。

## 部署方式（任选其一）

### Vercel

1. 将本项目根目录部署到 Vercel（会识别 `api/` 目录）。
2. 在 Vercel 项目 → Settings → Environment Variables 中配置：
   - `GITHUB_TOKEN`：GitHub Personal Access Token（需 repo 权限）
   - `GITHUB_OWNER`：仓库所属用户或组织
   - `GITHUB_REPO`：仓库名
   - `GITHUB_BRANCH`：分支（可选，默认 `main`）
3. 若题库地址使用 GitHub Pages，可单独部署一个 Vercel 项目，将接口域名填到小程序的「题库地址」或「同步接口地址」中。

### 其他平台

在任意能运行 Node 的 serverless/云函数中实现相同逻辑：  
接收 `POST application/json`，body 为 `{ path, content, message }`，用环境变量中的 GitHub 信息调用 GitHub Contents API（GET 取 sha → PUT 更新）。

## 接口说明

- **路径**：`POST /api/github-upload`
- **请求体**：`{ "path": "data/store.json", "content": "...", "message": "提交说明" }`
- **响应**：`200 { "ok": true }` 或 `4xx/5xx { "ok": false, "error": "错误信息" }`

小程序会逐文件调用该接口（用户同步可能多文件），并显示上传/保存进度条。
