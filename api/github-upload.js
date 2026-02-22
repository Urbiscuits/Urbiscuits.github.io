/**
 * 服务端接口：将单个文件内容上传到 GitHub 仓库。
 * 供小程序「同步到云端」（用户数据）与「保存到 GitHub」（管理员题库）调用。
 *
 * 部署说明（任选其一）：
 * - Vercel: 将本项目根目录部署到 Vercel，自动识别 api/ 目录。
 * - 其他: 需在服务器/云函数中实现相同逻辑（GET 获取 sha → PUT 更新）。
 *
 * 环境变量（必填）：
 *   GITHUB_TOKEN   - GitHub Personal Access Token（需 repo 权限）
 *   GITHUB_OWNER  - 仓库所属用户或组织
 *   GITHUB_REPO   - 仓库名
 *   GITHUB_BRANCH - 分支，默认 main
 *
 * 请求：POST application/json
 *  body: { path: string, content: string, message: string }
 * 响应：200 { ok: true } 或 4xx/5xx { ok: false, error: string }
 */

const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

function toBase64(str) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64');
  }
  return btoa(unescape(encodeURIComponent(str)));
}

async function uploadOne(path, content, message) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!token || !owner || !repo) {
    throw new Error('缺少环境变量 GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO');
  }
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json'
  };

  let sha = null;
  const getRes = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { method: 'GET', headers });
  if (getRes.ok) {
    const fileInfo = await getRes.json();
    sha = fileInfo.sha || null;
  } else if (getRes.status !== 404) {
    const err = await getRes.json().catch(() => ({}));
    throw new Error(err.message || `GET ${path} 失败: ${getRes.status}`);
  }

  const body = {
    message: message || 'update',
    content: toBase64(content),
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(err.message || `PUT ${path} 失败: ${putRes.status}`);
  }
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: '仅支持 POST' });
  }

  const { path, content, message } = req.body || {};
  if (!path || content === undefined) {
    return res.status(400).json({ ok: false, error: '缺少 path 或 content' });
  }

  try {
    await uploadOne(path, content, message || 'update');
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || '上传失败' });
  }
};
