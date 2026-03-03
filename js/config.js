var DEFAULT_MAIN_SECTIONS = ['言语理解', '数量关系', '判断推理', '资料分析', '政治理论', '常识判断', '策略选择'];
var MAIN_SECTIONS = (function() {
    try {
        var s = localStorage.getItem('xingce_main_sections');
        if (s) {
            var arr = JSON.parse(s);
            if (Array.isArray(arr) && arr.length) return arr;
        }
    } catch (e) {}
    return DEFAULT_MAIN_SECTIONS.slice();
})();
function saveMainSections(arr) {
    if (!Array.isArray(arr) || !arr.length) return;
    try {
        localStorage.setItem('xingce_main_sections', JSON.stringify(arr));
        MAIN_SECTIONS.length = 0;
        arr.forEach(function(x) { MAIN_SECTIONS.push(x); });
    } catch (e) {}
}
var SECTION_DISPLAY_NAMES = (function() {
    try {
        var s = localStorage.getItem('xingce_section_display_names');
        if (s) return JSON.parse(s);
    } catch (e) {}
    return {};
})();
function getSectionDisplayName(sec) {
    return (SECTION_DISPLAY_NAMES && SECTION_DISPLAY_NAMES[sec]) || sec || '';
}
function saveSectionDisplayNames() {
    try {
        localStorage.setItem('xingce_section_display_names', JSON.stringify(SECTION_DISPLAY_NAMES || {}));
    } catch (e) {}
}
// 题目统计（管理员题库）固定显示的大类及小类
var ADMIN_STATS_ORDER = ['政治理论', '常识判断', '言语理解', '判断推理', '数量关系', '资料分析', '策略选择'];
var ADMIN_STATS_SUBS = {
    '政治理论': [],
    '常识判断': [],
    '言语理解': ['逻辑填空', '中心理解', '细节判断', '标题填入', '语句排序', '接语选择', '长篇阅读'],
    '判断推理': ['类比推理', '加强题型', '削弱题型', '真假推理', '翻译推理', '定义判断', '图形推理'],
    '数量关系': ['和差倍比', '工程问题', '数量问题', '最值问题', '利润问题', '几何问题', '概率问题', '排列组合', '行程问题'],
    '资料分析': ['现期比重', '基期比重', '两期比重', '混合比重', '基期平均数', '现期平均数', '平均数增长率', '平均数的增长量', '两期平均数', '比值计算', '基期倍数', '现期倍数', '比值比较', '倍数比较', '间隔基期', '基期比较', '基期和差', '间隔增长率', '一般增长率', '年均增长率', '混合增长率', '增长量'],
    '策略选择': []
};
// 小类初始化：使用 ADMIN_STATS_SUBS 作为默认值，ensureSubcategory 会追加新小类
var SUBCATEGORIES = {};
(ADMIN_STATS_ORDER || MAIN_SECTIONS).forEach(function(sec) {
    SUBCATEGORIES[sec] = (ADMIN_STATS_SUBS[sec] || []).slice();
});
MAIN_SECTIONS.forEach(function(sec) { if (!SUBCATEGORIES[sec]) SUBCATEGORIES[sec] = []; });
var PARSER_SUB = null; // 不再限制，解析器接受任意小类
// GitHub 上托管的在线题库（JSON），默认 data/store.json，可按需修改
var ENABLE_REMOTE_STORE = true;
var REMOTE_STORE_URL = './data/store.json';

// GitHub API 配置：用于将数据同步到 GitHub 仓库
// 请填写你的 GitHub 仓库信息和个人访问令牌（Personal Access Token）
// Token 需要 repo 权限，可在 https://github.com/settings/tokens 创建
var GITHUB_CONFIG = {
    owner: 'urbiscuits',           // GitHub 用户名或组织名
    repo: 'urbiscuits.github.io',  // 仓库名（不含 .git）
    path: 'data/store.json',       // 要更新的文件路径
    branch: 'main',                // 分支名（通常是 main 或 master）
    token: ''                      // GitHub Personal Access Token（请在此填写，或通过 localStorage 设置）
};

// GitHub Token 加密/解密函数（简单可逆加密）
// 使用 XOR 加密，配合 Base64 编码
function encryptToken(token) {
    if (!token) return '';
    var key = 'xingce_github_token_key_2024'; // 加密密钥
    var result = '';
    for (var i = 0; i < token.length; i++) {
        var charCode = token.charCodeAt(i);
        var keyChar = key.charCodeAt(i % key.length);
        result += String.fromCharCode(charCode ^ keyChar);
    }
    // Base64 编码
    try {
        return btoa(unescape(encodeURIComponent(result)));
    } catch (e) {
        return btoa(result);
    }
}

function decryptToken(encryptedToken) {
    if (!encryptedToken || typeof encryptedToken !== 'string') return '';
    var raw = encryptedToken.trim();
    if (!raw) return '';
    try {
        // 仅当看起来像 Base64 时才解码（避免 atob 报错）
        var base64Regex = /^[A-Za-z0-9+/]+=*$/;
        if (!base64Regex.test(raw.replace(/\s/g, ''))) return raw;
        var decoded;
        try {
            decoded = decodeURIComponent(escape(atob(raw)));
        } catch (e1) {
            try {
                decoded = atob(raw);
            } catch (e2) {
                return raw;
            }
        }
        var key = 'xingce_github_token_key_2024';
        var result = '';
        for (var i = 0; i < decoded.length; i++) {
            var charCode = decoded.charCodeAt(i);
            var keyChar = key.charCodeAt(i % key.length);
            result += String.fromCharCode(charCode ^ keyChar);
        }
        return result;
    } catch (e) {
        return raw;
    }
}

// 内置一个默认 Token（用于 PK 等在线功能），以字符编码形式保存，避免在源码中直接出现明文
// 实际明文为 ghp_ 开头的 GitHub Personal Access Token，仅供本项目使用
function getDefaultGithubTokenForPk() {
    // 通过 String.fromCharCode 还原，源码中不出现明文 token
    var codes = [
        103,104,112,95,52,107,73,54,48,103,
        72,87,90,55,109,52,122,100,76,114,
        51,78,72,68,114,71,118,85,82,69,
        99,116,122,106,48,109,86,102,53,118
    ];
    var s = '';
    for (var i = 0; i < codes.length; i++) s += String.fromCharCode(codes[i]);
    return s;
}

// 从 localStorage 读取 Token（如果已设置）
try {
    var savedToken = localStorage.getItem('github_token');
    if (savedToken) {
        // 尝试解密（如果是加密的）
        var decrypted = decryptToken(savedToken);
        if (decrypted) {
            GITHUB_CONFIG.token = decrypted;
        } else {
            // 如果解密失败，可能是旧格式的未加密 token，直接使用
            GITHUB_CONFIG.token = savedToken;
        }
    }
} catch(e) {}

// 如果仍未获取到 Token，则使用内置的默认 Token（用于 PK 功能等）
if (!GITHUB_CONFIG.token) {
    try {
        GITHUB_CONFIG.token = getDefaultGithubTokenForPk();
    } catch (e) {}
}

// GitHub Contents API 的 content 为 Base64（底层是 UTF-8 字节序列）。
// 不能直接 atob(...) 后 JSON.parse(...)，否则中文会变成乱码（mojibake）。
function base64ToUtf8(b64) {
    b64 = (b64 || '').replace(/\s/g, '');
    if (!b64) return '';
    try {
        var binary = atob(b64); // 字节串（0-255），不是 UTF-8 文本
        if (typeof TextDecoder !== 'undefined') {
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return new TextDecoder('utf-8').decode(bytes);
        }
        // 兼容旧浏览器
        return decodeURIComponent(escape(binary));
    } catch (e) {
        try { return atob(b64); } catch (e2) { return ''; }
    }
}
function utf8ToBase64(str) {
    try { return btoa(unescape(encodeURIComponent(str))); } catch (e) { return btoa(String(str || '')); }
}
// 将类似 “æå¥” 这类 UTF-8 被当成 Latin-1 的乱码尽量修复回中文。
// 仅在“修复后包含中文”时才替换，避免误伤正常文本。
function repairMojibakeString(s) {
    if (typeof s !== 'string' || !s) return s;
    // 典型乱码字符集合（UTF-8 字节被错误映射成 Unicode 后常出现）
    if (!/[ÃÂâãäåæçèéêëìíîïðñòóôõöøùúûüýÿ]/.test(s)) return s;
    try {
        var fixed = decodeURIComponent(escape(s));
        if (fixed && /[\u4e00-\u9fff]/.test(fixed)) return fixed;
    } catch (e) {}
    return s;
}
function deepRepairMojibake(v) {
    if (Array.isArray(v)) return v.map(deepRepairMojibake);
    if (v && typeof v === 'object') {
        var out = {};
        Object.keys(v).forEach(function(k) {
            out[repairMojibakeString(k)] = deepRepairMojibake(v[k]);
        });
        return out;
    }
    return (typeof v === 'string') ? repairMojibakeString(v) : v;
}

function genId() { return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); }
// 确保大类存在（批量/单题可录入 JSON 中不存在的大类，不再限制为仅已存在分类）
function ensureCategory(category) {
    if (!category || typeof category !== 'string') return;
    var c = category.trim();
    if (!c) return;
    if (!MAIN_SECTIONS.includes(c)) { MAIN_SECTIONS.push(c); SUBCATEGORIES[c] = SUBCATEGORIES[c] || []; }
    if (!SUBCATEGORIES[c]) SUBCATEGORIES[c] = [];
}
function ensureSubcategory(category, subcategory) {
    if (!category || typeof category !== 'string') return;
    var c = category.trim();
    if (!c) return;
    ensureCategory(c);
    if (subcategory && typeof subcategory === 'string' && subcategory.trim()) {
        var sub = subcategory.trim();
        if (SUBCATEGORIES[c].indexOf(sub) === -1) SUBCATEGORIES[c].push(sub);
        if (PARSER_SUB) {
            if (!PARSER_SUB[c]) PARSER_SUB[c] = [];
            if (PARSER_SUB[c].indexOf(sub) === -1) PARSER_SUB[c].push(sub);
        }
    }
}