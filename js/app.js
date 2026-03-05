// 从已存题目中重建/补齐小分类，确保批量导入/数据导入后筛选项立即可见
function rebuildSubcategoriesFromStore() {
    try {
        if (!store || !store.questions) return;
        Object.keys(store.questions).forEach(function(qid) {
            var q = store.questions[qid];
            if (!q) return;
            var sec = q.section || q.category;
            var sub = q.subcategory;
            if (sec && sub) ensureSubcategory(sec, sub);
        });
    } catch (e) {}
}
// 应用远程题库数据（GitHub 上的 store.json），在本地保留个人做题统计字段和用户本地添加的题目
function applyRemoteStore(remote) {
    if (!remote || !Array.isArray(remote.sets) || !remote.questions) return;
    var oldQuestions = store.questions || {};
    var oldSets = store.sets || [];
    var mergedQuestions = {};
    var mergedSets = [];
    
    // 先处理远程题目，保留本地统计信息
    Object.keys(remote.questions).forEach(function(qid) {
        var rq = remote.questions[qid];
        var lq = oldQuestions[qid] || {};
        // 保留本地个人统计
        rq.totalAttempts = lq.totalAttempts || 0;
        rq.correctCount = lq.correctCount || 0;
        rq.done = lq.done || false;
        mergedQuestions[qid] = rq;
    });
    
    // 保留用户本地添加的题目（不在远程数据中的题目）
    Object.keys(oldQuestions).forEach(function(qid) {
        if (!mergedQuestions[qid]) {
            // 这是用户本地添加的题目，保留它
            mergedQuestions[qid] = oldQuestions[qid];
        }
    });
    
    // 合并套卷：先添加远程套卷，然后添加本地独有的套卷
    var remoteSetIds = {};
    remote.sets.forEach(function(rs) {
        remoteSetIds[rs.id] = true;
        // 查找本地是否有同名套卷
        var localSet = oldSets.find(function(ls) { return ls.id === rs.id || (ls.name && ls.name.trim() === (rs.name || '').trim()); });
        if (localSet) {
            // 合并题目ID：保留远程的题目ID列表，但也要检查是否有本地独有的题目
            var mergedSet = { id: rs.id, name: rs.name || localSet.name, category: rs.category || localSet.category || '' };
            (MAIN_SECTIONS || []).forEach(function(sec) { mergedSet[sec] = []; });
            // 先添加远程题目
            MAIN_SECTIONS.forEach(function(sec) {
                (rs[sec] || []).forEach(function(qid) {
                    if (mergedQuestions[qid]) {
                        mergedSet[sec].push(qid);
                    }
                });
            });
            // 再添加本地独有的题目（不在远程套卷中的）
            MAIN_SECTIONS.forEach(function(sec) {
                (localSet[sec] || []).forEach(function(qid) {
                    if (mergedQuestions[qid] && mergedSet[sec].indexOf(qid) === -1) {
                        mergedSet[sec].push(qid);
                    }
                });
            });
            mergedSets.push(mergedSet);
        } else {
            // 远程新套卷，直接添加
            mergedSets.push(rs);
        }
    });
    
    // 添加本地独有的套卷（不在远程数据中的）
    oldSets.forEach(function(ls) {
        var isRemote = remoteSetIds[ls.id] || remote.sets.some(function(rs) { return (rs.name || '').trim() === (ls.name || '').trim(); });
        if (!isRemote) {
            // 这是用户本地添加的套卷，保留它
            mergedSets.push(ls);
        }
    });
    
    store.sets = mergedSets;
    store.questions = mergedQuestions;

    // 同步试卷“分类”选项（左侧套卷分类管理）
    if (typeof getSetCategories === 'function' && typeof saveSetCategories === 'function') {
        var cats = getSetCategories();
        var beforeLen = cats.length;
        store.sets.forEach(function(s) {
            if (s.category && cats.indexOf(s.category) < 0) cats.push(s.category);
        });
        if (cats.length > beforeLen) saveSetCategories(cats);
    }

    store.save();
    rebuildSubcategoriesFromStore();
    // 刷新各个依赖题库的界面
    renderTree();
    fillCategorySelects();
    renderCategoryList();
    fillSetSelects();
    if (typeof filterSetList === 'function') filterSetList();
    if (typeof updateSingleSub === 'function') updateSingleSub();
    if (typeof updateManageSub === 'function') updateManageSub();
    if (typeof updatePracticeSub === 'function') updatePracticeSub();
    if (typeof renderPracticePointsCheckboxes === 'function') renderPracticePointsCheckboxes();
    if (document.getElementById('exportCategoryFilter')) updateExportSubcategoryOptions();
    if (typeof checkExportState === 'function') checkExportState();
}

function normalizeRemoteBaseUrl(u) {
    u = (u || '').trim();
    if (!u) return '';
    u = u.replace(/\s+/g, '');
    u = u.replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(u)) return '';
    return u;
}
function getRemoteBaseUrl() {
    try { return normalizeRemoteBaseUrl(localStorage.getItem('xingce_remote_base') || ''); } catch (e) { return ''; }
}
function setRemoteBaseUrl(u) {
    var v = normalizeRemoteBaseUrl(u);
    try { if (v) localStorage.setItem('xingce_remote_base', v); else localStorage.removeItem('xingce_remote_base'); } catch (e) {}
    return v;
}
function getDataFileUrl(filename) {
    filename = (filename || '').replace(/^\/+/, '');
    var base = getRemoteBaseUrl();
    if (base) return base + '/data/' + filename;
    return './data/' + filename;
}
function saveRemoteBaseUrl() {
    var input = document.getElementById('remoteBaseInput');
    var v = setRemoteBaseUrl(input ? input.value : '');
    if (input) input.value = v;
    showMsg('dataStatus', v ? ('已保存题库站点地址：' + v) : '已清空题库站点地址（将使用当前网站）', 'success');
}
// 从 GitHub 上拉取远程题库（store.json），用于“管理员上传即可在线更新”
function loadRemoteStore() {
    if (!ENABLE_REMOTE_STORE || !window.fetch) return;
    var url = getDataFileUrl('store.json') + '?t=' + Date.now();
    fetch(url)
        .then(function(resp) { if (!resp.ok) throw new Error('remote store not found'); return resp.json(); })
        .then(function(data) { applyRemoteStore(data); })
        .catch(function() { /* 静默失败，保留本地题库 */ });
}
/**
 * 在“数据”页面手动刷新题库：
 * 一次性读取 data 目录下配置好的所有 TXT/JSON 文件并导入题库。
 *
 * 需要在 data 目录下提供一个 files.json 清单，例如：
 * {
 *   "txt": ["batch1.txt", "batch2.txt"],
 *   "json": ["store.json", "extra1.json"]
 * }
 * 或简单数组：["batch1.txt", "store.json"]
 */
function refreshFromRemoteStore() {
    // 个人中心：改为与管理员「从 data 加载」一致的选择式加载（全部/部分 JSON）
    if (typeof profileShowLoadFromDataModal === 'function') {
        profileShowLoadFromDataModal();
        return;
    }

    if (!window.fetch) {
        showMsg('dataStatus', '当前浏览器不支持在线刷新题库（缺少 fetch）。', 'error');
        return;
    }
    // 重要：如果用 file:// 直接打开网页，fetch 读取 ./data/* 会被浏览器拦截，表现为 Failed to fetch
    if (location && location.protocol === 'file:') {
        showMsg(
            'dataStatus',
            '刷新题库失败：当前通过 file:// 打开页面，浏览器禁止 fetch 读取本地 data 文件（会报 Failed to fetch）。请使用本地 HTTP 服务打开（如 VSCode Live Server / http-server / python http.server），或访问已部署的网站再刷新。',
            'error'
        );
        return;
    }
    showMsg('dataStatus', '正在扫描 data 目录下的 TXT / JSON 文件，请稍候...', 'info');
    // 约定 files.json 列出需要导入的所有文件；支持“题库站点地址”
    var manifestUrl = getDataFileUrl('files.json') + '?t=' + Date.now();
    var fallbackStoreUrl = getDataFileUrl('store.json') + '?t=' + Date.now();
    fetch(manifestUrl)
        .then(function(resp) {
            if (!resp.ok) throw new Error('files.json 未找到，请在 data 目录下创建。');
            return resp.json();
        })
        .then(function(manifest) {
            var txtFiles = [];
            var jsonFiles = [];
            if (Array.isArray(manifest)) {
                manifest.forEach(function(p) {
                    if (typeof p !== 'string') return;
                    if (/\.txt$/i.test(p)) txtFiles.push(p);
                    else if (/\.json$/i.test(p)) jsonFiles.push(p);
                });
            } else {
                (manifest.txt || []).forEach(function(p) { if (typeof p === 'string') txtFiles.push(p); });
                (manifest.json || []).forEach(function(p) { if (typeof p === 'string') jsonFiles.push(p); });
            }
            if (!txtFiles.length && !jsonFiles.length) {
                showMsg('dataStatus', 'files.json 中未配置任何 TXT/JSON 文件。', 'error');
                return;
            }
            var txtPromises = txtFiles.map(function(p) {
                return fetch(getDataFileUrl(p) + '?t=' + Date.now())
                    .then(function(r) {
                        if (!r.ok) throw new Error('无法读取 TXT：' + p);
                        return r.text();
                    })
                    .then(function(text) {
                        importTxtFileToSetAuto(p, text);
                    });
            });
            var jsonPromises = jsonFiles.map(function(p) {
                return fetch(getDataFileUrl(p) + '?t=' + Date.now())
                    .then(function(r) {
                        if (!r.ok) throw new Error('无法读取 JSON：' + p);
                        return r.json();
                    })
                    .catch(function(err) {
                        console.error(err);
                        showMsg('dataStatus', '读取 JSON 失败：' + p + '，原因：' + (err && (err.message || String(err)) ? (err.message || String(err)) : '未知错误'), 'error');
                        return null;
                    });
            });
            return Promise.all(txtPromises.concat(jsonPromises)).then(function(results) {
                // 合并所有 JSON 数据（导出格式：{ sets, questions }）
                var jsonResults = results.slice(txtPromises.length).filter(Boolean);
                var mergedSets = [];
                var mergedQuestions = {};
                jsonResults.forEach(function(d) {
                    if (!d) return;
                    if (Array.isArray(d.sets)) mergedSets = mergedSets.concat(d.sets);
                    if (d.questions && typeof d.questions === 'object') {
                        Object.keys(d.questions).forEach(function(qid) {
                            mergedQuestions[qid] = d.questions[qid];
                        });
                    }
                });
                // 按“合并”模式导入所有 JSON
                if (mergedSets.length || Object.keys(mergedQuestions).length) {
                    // 反向索引：通过 sets 中的题号列表推断每题所属套卷/大类
                    // 用于修复某些同步场景下 questions.setId 缺失/不匹配导致“套卷有题但显示 0 题”
                    var qToSetId = {};
                    var qToSection = {};
                    mergedSets.forEach(function(s) {
                        if (!s || !s.id) return;
                        MAIN_SECTIONS.forEach(function(sec) {
                            (s[sec] || []).forEach(function(qid) {
                                if (!qid) return;
                                qToSetId[qid] = s.id;
                                qToSection[qid] = sec;
                            });
                        });
                    });

                    var setIds = {};
                    mergedSets.forEach(function(s) {
                        var name = (s.name || '').trim();
                        var existing = store.sets.find(function(x) { return (x.name || '').trim() === name; });
                        if (existing) {
                            setIds[s.id] = existing.id;
                            MAIN_SECTIONS.forEach(function(sec) {
                                var incoming = s[sec] || [];
                                incoming.forEach(function(qid) {
                                    if (mergedQuestions[qid] && existing[sec].indexOf(qid) === -1) existing[sec].push(qid);
                                });
                            });
                        } else {
                            var id = genId();
                            setIds[s.id] = id;
                            store.sets.push({
                                id: id,
                                name: name || '未命名',
                                category: s.category || '',
                                '言语理解': s['言语理解'] || [],
                                '数量关系': s['数量关系'] || [],
                                '判断推理': s['判断推理'] || [],
                                '资料分析': s['资料分析'] || []
                            });
                        }
                    });
                    Object.keys(mergedQuestions).forEach(function(qid) {
                        var q = mergedQuestions[qid];
                        if (!q) return;
                        // 优先使用 q.setId；若缺失/不匹配，则用反向索引推断
                        var srcSetId = q.setId;
                        if (!srcSetId || !setIds[srcSetId]) {
                            srcSetId = qToSetId[qid];
                        }
                        if (srcSetId && setIds[srcSetId]) {
                            q.setId = setIds[srcSetId];
                            // 补齐 section（避免 UI 侧分类统计异常）
                            if (!q.section && qToSection[qid]) q.section = qToSection[qid];
                            q.knowledgePoints = q.knowledgePoints || (q.knowledgePoint ? [q.knowledgePoint] : []);
                            store.questions[qid] = q;
                        }
                    });
                }
                // 统一刷新分类、统计和界面
                var cats = getSetCategories();
                var beforeLen = cats.length;
                store.sets.forEach(function(s) {
                    if (s.category && cats.indexOf(s.category) < 0) cats.push(s.category);
                });
                if (cats.length > beforeLen) saveSetCategories(cats);
                store.save();
                rebuildSubcategoriesFromStore();
                renderTree();
                fillCategorySelects();
                renderCategoryList();
                fillSetSelects();
                if (typeof filterSetList === 'function') filterSetList();
                if (typeof updateManageSub === 'function') updateManageSub();
                if (typeof updatePracticeSub === 'function') updatePracticeSub();
                if (typeof renderPracticePointsCheckboxes === 'function') renderPracticePointsCheckboxes();
                if (typeof checkExportState === 'function') checkExportState();
                showMsg('dataStatus', '已从 data 目录刷新题库：当前共有 ' + store.sets.length + ' 个套卷、' + Object.keys(store.questions).length + ' 道题目', 'success');
            });
        })
        .catch(function(err) {
            console.error(err);
            // 兜底：files.json 拉取失败时，至少尝试读取 store.json
            fetch(fallbackStoreUrl)
                .then(function(r) {
                    if (!r.ok) throw new Error('无法读取 store.json（HTTP ' + r.status + '）');
                    return r.json();
                })
                .then(function(data) {
                    // 复用远程题库应用逻辑
                    applyRemoteStore(data);
                    showMsg('dataStatus', 'files.json 获取失败，已仅从 store.json 刷新题库（仍可使用）。', 'success');
                })
                .catch(function(err2) {
                    console.error(err2);
                    var m1 = (err && (err.message || String(err))) ? (err.message || String(err)) : '未知错误';
                    var m2 = (err2 && (err2.message || String(err2))) ? (err2.message || String(err2)) : '未知错误';
                    showMsg(
                        'dataStatus',
                        '刷新题库失败：' + m1 + '；兜底读取 store.json 也失败：' + m2 +
                        '。请检查：1）网络是否正常 2）是否被浏览器插件/隐私模式拦截 3）是否能直接访问 `data/files.json` 与 `data/store.json`。',
                        'error'
                    );
                });
        });
}
function getCurrentUser() { try { return localStorage.getItem('xingce_current_user') || ''; } catch (e) { return ''; } }
function setCurrentUser(username) { try { if (username) localStorage.setItem('xingce_current_user', username); else localStorage.removeItem('xingce_current_user'); } catch (e) {} }
function getUserData() {
    var u = getCurrentUser();
    if (!u) return null;
    try {
        var raw = localStorage.getItem('xingce_userdata_' + u);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}
function saveUserData(data) {
    var u = getCurrentUser();
    if (!u) return;
    try { localStorage.setItem('xingce_userdata_' + u, JSON.stringify(data)); } catch (e) {}
}
function getHistory() {
    var d = getUserData();
    if (d && d.history !== undefined) return Array.isArray(d.history) ? d.history : [];
    try { var h = localStorage.getItem('xingce_history'); return h ? JSON.parse(h) : []; } catch (e) { return []; }
}
function saveHistory(arr) {
    var d = getUserData();
    if (d !== null) { d.history = arr; saveUserData(d); return; }
    try { localStorage.setItem('xingce_history', JSON.stringify(arr)); } catch (e) {}
}

/** 对容器内题目/选项实时渲染 LaTeX：支持 $$ 块级公式、\\( \\) 行内公式，以及分数 \\frac、根号 \\sqrt 等 */
function renderLaTeXInElement(el) {
    if (!el || !window.renderMathInElement) return;
    try {
        renderMathInElement(el, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\(', right: '\\)', display: false },
                { left: '$', right: '$', display: false }
            ],
            throwOnError: false
        });
    } catch (e) {}
}

/* ========== PK 对战（基于 GitHub JSON） ========== */
// 将匹配信息存放在 data/user 目录下，方便与用户数据一并管理
var PK_FILE_PATH = 'data/user/pk-matches.json';
var pkPlayerToken = null;
var pkCurrentRoomId = null;
var pkPollingTimer = null;
var pkQuestions = [];
var pkIndex = 0;
var pkSelections = {};
var pkLastWriteTime = 0;
var PK_WRITE_INTERVAL_MS = 1000;
var PK_POLL_INTERVAL_MS = 800;
var PK_409_RETRY_MAX = 4;

function pkGetUserId() {
    var u = getCurrentUser();
    if (u) return u;
    try {
        var gid = localStorage.getItem('xingce_pk_guest_id');
        if (!gid) {
            gid = 'guest_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            localStorage.setItem('xingce_pk_guest_id', gid);
        }
        return gid;
    } catch (e) {
        return 'guest_' + Date.now();
    }
}
function pkGetNick() {
    var u = getCurrentUser();
    if (u) return u;
    return '游客';
}
function pkSetStatus(msg, type) {
    var el = document.getElementById('pkStatus');
    if (!el) return;
    el.style.color = type === 'error' ? '#dc3545' : (type === 'success' ? '#28a745' : '#6c757d');
    el.textContent = msg || '';
}
function pkUpdateCurrentUserLabel() {
    var el = document.getElementById('pkCurrentUser');
    if (!el) return;
    var u = getCurrentUser();
    el.textContent = u ? ('已登录账号：' + u) : '未登录（在个人中心登录后可显示用户名）';
    if (u) {
        // 登录账号后自动在 pk.json 里登记一条用户信息
        pkEnsureUser();
    }
}
function pkGetSectionsFromUi() {
    var boxes = document.querySelectorAll('#pkSectionsWrap input[name="pkSection"]:checked');
    var arr = [];
    boxes.forEach(function(cb) { if (cb.value) arr.push(cb.value); });
    return arr;
}
function pkGetCountFromUi() {
    var el = document.getElementById('pkCount');
    var n = el && el.value ? parseInt(el.value, 10) : 5;
    if (!(n >= 1)) n = 5;
    if (n > 20) n = 20;
    return n;
}
function pkApiHeaders() {
    if (!GITHUB_CONFIG || !GITHUB_CONFIG.token || !GITHUB_CONFIG.owner || !GITHUB_CONFIG.repo) return null;
    return { 'Authorization': 'token ' + GITHUB_CONFIG.token, 'Accept': 'application/vnd.github.v3+json' };
}
function pkEnsureUser() {
    var headers = pkApiHeaders();
    if (!headers) return;
    var userId = pkGetUserId();
    var nick = pkGetNick();
    var now = Date.now();
    pkSaveState(function(state) {
        if (!state.users || typeof state.users !== 'object') state.users = {};
        var u = state.users[userId] || {};
        u.nick = nick || u.nick || '';
        if (u.matching === undefined) u.matching = false;
        if (u.roomId === undefined) u.roomId = null;
        u.lastSeen = now;
        state.users[userId] = u;
    }, 'pk ensure user').catch(function() {});
}
function pkFetchState() {
    var headers = pkApiHeaders();
    if (!headers) return Promise.reject(new Error('未配置 GitHub Token 或仓库信息'));
    var branch = GITHUB_CONFIG.branch || 'main';
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/' + PK_FILE_PATH;
    return fetch(apiUrl + '?ref=' + branch, { method: 'GET', headers: headers })
        .then(function(resp) {
            if (resp.status === 404) {
                return { sha: null, data: { users: {}, rooms: {} } };
            }
            if (!resp.ok) throw new Error('获取 PK 数据失败：HTTP ' + resp.status);
            return resp.json().then(function(info) {
                var text = typeof base64ToUtf8 === 'function' ? base64ToUtf8(info.content || '') : atob(info.content || '');
                var obj;
                try { obj = text ? JSON.parse(text) : {}; } catch (e) { obj = {}; }
                if (!obj || typeof obj !== 'object') obj = {};
                if (!obj.users || typeof obj.users !== 'object') obj.users = {};
                if (!obj.rooms || typeof obj.rooms !== 'object') obj.rooms = {};
                return { sha: info.sha, data: obj };
            });
        });
}
function pkSaveState(mutator, commitMessage) {
    var headers = pkApiHeaders();
    if (!headers) return Promise.reject(new Error('未配置 GitHub Token 或仓库信息'));
    var branch = GITHUB_CONFIG.branch || 'main';
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/' + PK_FILE_PATH;
    function doPut(res) {
        var state = res.data || { queue: [], rooms: {} };
        mutator(state);
        var content = JSON.stringify(state, null, 2);
        var encoded = typeof utf8ToBase64 === 'function'
            ? utf8ToBase64(content)
            : btoa(unescape(encodeURIComponent(content)));
        var body = {
            message: commitMessage || ('update pk matches - ' + new Date().toLocaleString('zh-CN')),
            content: encoded,
            branch: branch
        };
        if (res.sha) body.sha = res.sha;
        return fetch(apiUrl, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify(body)
        });
    }
    function attempt(retriesLeft) {
        var now = Date.now();
        var elapsed = now - pkLastWriteTime;
        if (elapsed < PK_WRITE_INTERVAL_MS && pkLastWriteTime > 0) {
            return new Promise(function(resolve, reject) {
                setTimeout(function() {
                    attempt(retriesLeft).then(resolve).catch(reject);
                }, PK_WRITE_INTERVAL_MS - elapsed);
            });
        }
        return pkFetchState().then(function(res) {
            return doPut(res).then(function(resp) {
                if (resp.status === 409 && retriesLeft > 0) {
                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            pkFetchState().then(function(newRes) {
                                var state = newRes.data || { queue: [], rooms: {} };
                                mutator(state);
                                var content = JSON.stringify(state, null, 2);
                                var encoded = typeof utf8ToBase64 === 'function'
                                    ? utf8ToBase64(content)
                                    : btoa(unescape(encodeURIComponent(content)));
                                var body = {
                                    message: commitMessage || ('update pk matches - ' + new Date().toLocaleString('zh-CN')),
                                    content: encoded,
                                    branch: branch,
                                    sha: newRes.sha
                                };
                                return fetch(apiUrl, { method: 'PUT', headers: headers, body: JSON.stringify(body) });
                            }).then(function(r) {
                                if (!r.ok) {
                                    if (r.status === 409 && retriesLeft - 1 > 0) {
                                        return attempt(retriesLeft - 1);
                                    }
                                    throw new Error('保存 PK 数据失败：HTTP ' + r.status);
                                }
                                pkLastWriteTime = Date.now();
                                return r.json();
                            }).then(resolve).catch(reject);
                        }, PK_WRITE_INTERVAL_MS);
                    });
                }
                if (!resp.ok) throw new Error('保存 PK 数据失败：HTTP ' + resp.status);
                pkLastWriteTime = Date.now();
                return resp.json();
            });
        });
    }
    return attempt(PK_409_RETRY_MAX);
}
function pkPickQuestions(sections, count) {
    var allQids = [];
    if (!window.store || !store.questions) return [];
    Object.keys(store.questions).forEach(function(qid) {
        var q = store.questions[qid];
        if (!q) return;
        var sec = q.section || q.category || '';
        if (sections && sections.length && sections.indexOf(sec) === -1) return;
        allQids.push(qid);
    });
    if (!allQids.length) return [];
    allQids.sort(function() { return Math.random() - 0.5; });
    return allQids.slice(0, Math.max(1, count || 5));
}
function pkStartMatch() {
    pkUpdateCurrentUserLabel();
    var headers = pkApiHeaders();
    if (!headers) { pkSetStatus('未配置 GitHub Token，无法进行在线 PK，请在个人中心配置。', 'error'); return; }
    var userId = pkGetUserId();
    var nick = pkGetNick();
    var sections = pkGetSectionsFromUi();
    var count = pkGetCountFromUi();
    if (!sections.length) {
        sections = ['言语理解','数量关系','判断推理','资料分析','政治理论','常识判断','策略选择'];
    }
    pkPlayerToken = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    document.getElementById('btnPkStart').disabled = true;
    var btnCancel = document.getElementById('btnPkCancel');
    if (btnCancel) btnCancel.style.display = 'inline-flex';
    pkSetStatus('正在匹配对手，请在另一设备上用不同账号点击“开始匹配”…', null);
    pkCurrentRoomId = null;
    pkQuestions = [];
    pkIndex = 0;
    pkSelections = {};
    var now = Date.now();
    pkSaveState(function(state) {
        if (!state.users || typeof state.users !== 'object') state.users = {};
        if (!state.rooms || typeof state.rooms !== 'object') state.rooms = {};
        // 若已在某个房间中，则不重复加入匹配
        var existingRoomId = null;
        Object.keys(state.rooms).forEach(function(rid) {
            var r = state.rooms[rid];
            if (r && Array.isArray(r.players) && r.players.indexOf(userId) !== -1) {
                existingRoomId = rid;
            }
        });
        if (existingRoomId) return;
        // 当前用户标记为正在匹配
        var me = state.users[userId] || { nick: nick };
        me.nick = nick || me.nick || '';
        me.matching = true;
        me.roomId = null;
        me.ts = now;
        state.users[userId] = me;
        // 在其它用户中寻找 matching=true 的对手
        var opponentId = null;
        Object.keys(state.users).forEach(function(uid) {
            if (uid === userId) return;
            var u = state.users[uid];
            if (!u || !u.matching) return;
            // 只匹配尚未在房间里的用户
            var inRoom = false;
            Object.keys(state.rooms).forEach(function(rid) {
                var r = state.rooms[rid];
                if (r && Array.isArray(r.players) && r.players.indexOf(uid) !== -1) inRoom = true;
            });
            if (!inRoom && !opponentId) opponentId = uid;
        });
        if (opponentId) {
            var opp = state.users[opponentId];
            var roomId = 'room_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            var qids = pkPickQuestions(sections, count);
            state.rooms[roomId] = {
                id: roomId,
                createdAt: now,
                sections: sections,
                count: count,
                questionIds: qids,
                players: [userId, opponentId],
                answers: {}
            };
            // 双方从匹配状态中移除，记录各自当前 roomId
            me.matching = false;
            me.roomId = roomId;
            state.users[userId] = me;
            opp.matching = false;
            opp.roomId = roomId;
            state.users[opponentId] = opp;
        }
    }, 'pk match join').then(function() {
        pkStartPolling();
        setTimeout(pkPollRoom, 120);
    }).catch(function(err) {
        document.getElementById('btnPkStart').disabled = false;
        if (btnCancel) btnCancel.style.display = 'none';
        pkSetStatus(err && err.message ? err.message : '匹配失败，请稍后重试。', 'error');
    });
}
function pkCancelMatch() {
    if (pkPollingTimer) {
        clearInterval(pkPollingTimer);
        pkPollingTimer = null;
    }
    var btnStart = document.getElementById('btnPkStart');
    if (btnStart) btnStart.disabled = false;
    var btnCancel = document.getElementById('btnPkCancel');
    if (btnCancel) btnCancel.style.display = 'none';
    pkSetStatus('已取消匹配。', null);
    pkSaveState(function(state) {
        if (!state.users || typeof state.users !== 'object') state.users = {};
        var userId = pkGetUserId();
        var me = state.users[userId];
        if (me) {
            me.matching = false;
            if (!me.roomId) me.roomId = null;
            state.users[userId] = me;
        }
    }, 'pk cancel').catch(function() {});
}
function pkStartPolling() {
    if (pkPollingTimer) clearInterval(pkPollingTimer);
    pkPollingTimer = setInterval(pkPollRoom, PK_POLL_INTERVAL_MS);
}
function pkPollRoom() {
    if (!pkPlayerToken) return;
    pkFetchState().then(function(res) {
        var state = res.data || { users: {}, rooms: {} };
        var userId = pkGetUserId();
        var users = state.users || {};
        var me = users[userId];
        var rooms = state.rooms || {};
        var myRoom = null;
        if (me && me.roomId && rooms[me.roomId]) {
            myRoom = rooms[me.roomId];
        } else {
            Object.keys(rooms).forEach(function(rid) {
                var room = rooms[rid];
                if (!room || !Array.isArray(room.players)) return;
                if (room.players.indexOf(userId) !== -1) myRoom = room;
            });
        }
        if (!myRoom) {
            if (me && me.matching) {
                pkSetStatus('正在匹配对手…（如长时间无结果，可取消后重试）', null);
            } else {
                pkSetStatus('未处于匹配状态。', null);
            }
            return;
        }
        if (!pkCurrentRoomId) {
            pkCurrentRoomId = myRoom.id;
            pkEnterRoom(myRoom);
        } else {
            pkSyncScores(myRoom);
        }
    }).catch(function(err) {
        pkSetStatus(err && err.message ? err.message : '轮询 PK 状态失败。', 'error');
    });
}
function pkEnterRoom(room) {
    var btnStart = document.getElementById('btnPkStart');
    if (btnStart) btnStart.disabled = true;
    var btnCancel = document.getElementById('btnPkCancel');
    if (btnCancel) btnCancel.style.display = 'none';
    pkSetStatus('已匹配到对手，开始 PK！', 'success');
    var wrap = document.getElementById('pkBattle');
    if (wrap) wrap.style.display = 'block';
    var infoEl = document.getElementById('pkRoomInfo');
    var meId = pkGetUserId();
    var opponentNick = '';
    if (room && Array.isArray(room.players)) {
        room.players.forEach(function(p) {
            if (!p) return;
            if (p.userId !== meId) opponentNick = p.nick || '对手';
        });
    }
    if (infoEl) infoEl.textContent = '对手：' + (opponentNick || '对手') + ' ｜ 题数：' + (room.count || (room.questionIds ? room.questionIds.length : 0) || 5);
    var resultEl = document.getElementById('pkResult');
    if (resultEl) resultEl.innerHTML = '<span style="color:#6c757d; font-size:0.85rem;">双方提交后在此查看结果</span>';
    var count = room.count || (room.questionIds ? room.questionIds.length : 0) || 5;
    pkQuestions = [];
    pkIndex = 0;
    pkSelections = {};
    if (room.questionIds && room.questionIds.length && window.store && store.questions) {
        room.questionIds.forEach(function(qid) {
            var q = store.questions[qid];
            if (q) pkQuestions.push(q);
        });
    }
    if (!pkQuestions.length && window.store && store.questions) {
        var secs = room.sections || [];
        var qids = pkPickQuestions(secs, count);
        qids.forEach(function(qid) {
            var q = store.questions[qid];
            if (q) pkQuestions.push(q);
        });
    }
    if (!pkQuestions.length) {
        pkSetStatus('当前题库中没有可用于 PK 的题目。', 'error');
        return;
    }
    pkRenderQuestion();
}
function pkRenderQuestion() {
    var total = pkQuestions.length;
    var progressEl = document.getElementById('pkQuestionProgress');
    if (progressEl) progressEl.textContent = '第 ' + (pkIndex + 1) + ' / ' + total + ' 题';
    var q = pkQuestions[pkIndex];
    var container = document.getElementById('pkQuestionContainer');
    if (!container || !q) return;
    var opts = q.options || [];
    var html = '<div class="question-item" style="border:2px solid #eaeaea; border-radius:8px; padding:12px; background:#fff;">';
    html += '<div style="font-weight:600; margin-bottom:8px;">' + (q.content || '') + '</div>';
    html += '<div>';
    ['A','B','C','D'].forEach(function(label) {
        var o = opts.filter(function(x) { return x.label === label; })[0] || {};
        var text = o.text || '';
        var key = String(q.id || q.qid || '');
        var selected = pkSelections[key] === label;
        html += '<div style="margin:4px 0; padding:6px 8px; border-radius:6px; cursor:pointer; border:1px solid ' + (selected ? '#4a6baf' : '#e0e0e0') + ';" onclick="pkSelectOption(\'' + key.replace(/'/g, "\\'") + '\',\'' + label + '\')">';
        html += '<strong>' + label + '.</strong> ' + text + '</div>';
    });
    html += '</div></div>';
    container.innerHTML = html;
    renderLaTeXInElement(container);
    var btnNext = document.getElementById('btnPkNext');
    var btnSubmit = document.getElementById('btnPkSubmit');
    if (btnNext) btnNext.style.display = (pkIndex < pkQuestions.length - 1) ? 'inline-flex' : 'none';
    if (btnSubmit) btnSubmit.style.display = (pkIndex === pkQuestions.length - 1) ? 'inline-flex' : 'none';
}
function pkSelectOption(qid, label) {
    pkSelections[qid] = label;
    pkRenderQuestion();
}
function pkNextQuestion() {
    if (pkIndex < pkQuestions.length - 1) {
        pkIndex++;
        pkRenderQuestion();
    }
}
function pkSubmitBattle() {
    var meId = pkGetUserId();
    var score = 0;
    pkQuestions.forEach(function(q) {
        var key = String(q.id || '');
        var sel = pkSelections[key];
        if (sel && sel === q.answer) score++;
    });
    pkSetStatus('已提交答案，正在等待对手完成…', null);
    var resultEl = document.getElementById('pkResult');
    if (resultEl) resultEl.textContent = '你的得分：' + score + ' / ' + pkQuestions.length + '，正在等待对手…';
    pkSaveState(function(state) {
        var rooms = state.rooms || {};
        var room = rooms[pkCurrentRoomId];
        if (!room) return;
        room.scores = room.scores || {};
        room.scores[meId] = { score: score, total: pkQuestions.length, finishedAt: Date.now() };
    }, 'pk submit').then(function() {
        // 提交后继续通过轮询同步比分
    }).catch(function(err) {
        pkSetStatus(err && err.message ? err.message : '提交得分失败。', 'error');
    });
}
function pkSyncScores(room) {
    var meId = pkGetUserId();
    var scores = room.scores || {};
    var myScore = scores[meId];
    var oppScore = null;
    var oppNick = '对手';
    if (room.players && room.players.length) {
        room.players.forEach(function(p) {
            if (!p) return;
            if (p.userId !== meId) {
                if (scores[p.userId]) oppScore = scores[p.userId];
                oppNick = p.nick || '对手';
            }
        });
    }
    var resultEl = document.getElementById('pkResult');
    if (myScore && resultEl && !/[\d]+\s*\/\s*[\d]+/.test(resultEl.textContent)) {
        resultEl.innerHTML = '你的得分：' + myScore.score + ' / ' + myScore.total + '，正在等待对手提交…';
    }
    if (myScore && oppScore && resultEl) {
        var total = myScore.total || 5;
        var msg = '<strong>本局结果</strong><br>你：' + myScore.score + ' / ' + total + ' &nbsp;|&nbsp; ' + oppNick + '：' + oppScore.score + ' / ' + total + '<br>';
        if (myScore.score > oppScore.score) msg += '<span style="color:#28a745;">恭喜，你赢了！</span>';
        else if (myScore.score < oppScore.score) msg += '<span style="color:#6c757d;">' + oppNick + ' 获胜。</span>';
        else msg += '<span style="color:#6c757d;">平局，再战一场吧！</span>';
        resultEl.innerHTML = msg;
        pkSetStatus('双方已提交，本局 PK 已结束。', 'success');
        if (pkPollingTimer) {
            clearInterval(pkPollingTimer);
            pkPollingTimer = null;
        }
    }
}

/* ========== 积分与闯关 ========== */
function getTodayStr() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function getPoints() {
    var d = getUserData();
    if (d !== null && d.points !== undefined) { var n = parseInt(d.points, 10); return (n === n && n >= 0) ? n : 0; }
    try { var p = localStorage.getItem('xingce_points'); var n = parseInt(p, 10); return (n === n && n >= 0) ? n : 0; } catch (e) { return 0; }
}
function setPoints(n) {
    var d = getUserData();
    if (d !== null) { d.points = Math.max(0, n); saveUserData(d); return; }
    try { localStorage.setItem('xingce_points', String(Math.max(0, n))); } catch (e) {}
}
function logPointsUsage(type, amount, desc) {
    var d = getUserData();
    if (d !== null) { d.pointsLog = d.pointsLog || []; d.pointsLog.unshift({ t: type, amount: amount, desc: desc || '', date: new Date().toISOString() }); d.pointsLog = d.pointsLog.slice(0, 200); saveUserData(d); return; }
    try { var log = []; var s = localStorage.getItem('xingce_points_log'); log = s ? JSON.parse(s) : []; log.unshift({ t: type, amount: amount, desc: desc || '', date: new Date().toISOString() }); log = log.slice(0, 200); localStorage.setItem('xingce_points_log', JSON.stringify(log)); } catch (e) {}
}
function getSignInDate() { var d = getUserData(); if (d !== null && d.signInDate !== undefined) return d.signInDate; try { return localStorage.getItem('xingce_signin_date') || ''; } catch (e) { return ''; } }
function setSignInDate(s) { var d = getUserData(); if (d !== null) { d.signInDate = s; saveUserData(d); return; } try { localStorage.setItem('xingce_signin_date', s); } catch (e) {} }
function getChallengeDate() { var d = getUserData(); if (d !== null && d.challengeDate !== undefined) return d.challengeDate; try { return localStorage.getItem('xingce_challenge_date') || ''; } catch (e) { return ''; } }
function setChallengeDate(s) { var d = getUserData(); if (d !== null) { d.challengeDate = s; saveUserData(d); return; } try { localStorage.setItem('xingce_challenge_date', s); } catch (e) {} }
function getChallengeCache() { var d = getUserData(); if (d !== null && d.challengeCache !== undefined) return d.challengeCache || {}; try { var c = localStorage.getItem('xingce_challenge_cache'); return c ? JSON.parse(c) : {}; } catch (e) { return {}; } }
function setChallengeCache(obj) { var d = getUserData(); if (d !== null) { d.challengeCache = obj; saveUserData(d); return; } try { localStorage.setItem('xingce_challenge_cache', JSON.stringify(obj)); } catch (e) {} }
function getChallengePassedLevels() { var d = getUserData(); if (d !== null && d.challengePassed !== undefined) return Array.isArray(d.challengePassed) ? d.challengePassed : []; try { var c = localStorage.getItem('xingce_challenge_passed'); return c ? JSON.parse(c) : []; } catch (e) { return []; } }
function setChallengePassedLevels(arr) { var d = getUserData(); if (d !== null) { d.challengePassed = arr; saveUserData(d); return; } try { localStorage.setItem('xingce_challenge_passed', JSON.stringify(arr)); } catch (e) {} }
function getUnlockedByPoints() { var d = getUserData(); if (d !== null && d.challengeUnlocked !== undefined) return Array.isArray(d.challengeUnlocked) ? d.challengeUnlocked : []; try { var c = localStorage.getItem('xingce_challenge_unlocked'); return c ? JSON.parse(c) : []; } catch (e) { return []; } }
function setUnlockedByPoints(arr) { var d = getUserData(); if (d !== null) { d.challengeUnlocked = arr; saveUserData(d); return; } try { localStorage.setItem('xingce_challenge_unlocked', JSON.stringify(arr)); } catch (e) {} }
function extractQuestionStatsFromStore() {
    var stats = {};
    if (!store || !store.questions) return stats;
    Object.keys(store.questions).forEach(function(qid) {
        var q = store.questions[qid];
        if (!q) return;
        var ta = q.totalAttempts, cc = q.correctCount, done = q.done;
        if ((ta && ta > 0) || cc || done) stats[qid] = { totalAttempts: ta || 0, correctCount: cc || 0, done: !!done };
    });
    return stats;
}
function mergeUserQuestionStatsIntoStore() {
    var d = getUserData();
    if (!d || !d.questionStats || !store || !store.questions) return;
    Object.keys(d.questionStats).forEach(function(qid) {
        var q = store.questions[qid];
        if (!q) return;
        var s = d.questionStats[qid];
        if (s) { q.totalAttempts = s.totalAttempts || 0; q.correctCount = s.correctCount || 0; q.done = !!s.done; }
    });
}
function persistUserQuestionStats() {
    var u = getCurrentUser();
    if (!u) return;
    var d = getUserData();
    d.questionStats = extractQuestionStatsFromStore();
    saveUserData(d);
}
function verifyUserPassword(username, password, users) {
    return hashPassword(username, password).then(function(ph) {
        return users && users.some(function(u) { return u.username === username && u.passwordHash === ph; });
    });
}
function profileUserLogin() {
    var username = (document.getElementById('profileLoginUsername').value || '').trim();
    var password = document.getElementById('profileLoginPassword').value || '';
    if (!username || !password) { showMsg('profileLoginStatus', '请输入用户名和密码', 'error'); return; }
    var statusEl = document.getElementById('profileLoginStatus');
    statusEl.textContent = '正在验证…';
    statusEl.className = 'status-message info';
    var base = getRemoteBaseUrl() ? (getRemoteBaseUrl().replace(/\/+$/, '') + '/') : (window.location.origin + (window.location.pathname.replace(/[^/]+$/, '') || '/'));
    fetch(base + 'data/users.json?t=' + Date.now()).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; })
        .then(function(data) {
            var users = (data && data.users) ? data.users : getAdminUsers();
            return verifyUserPassword(username, password, users);
        })
        .then(function(ok) {
            if (ok) {
                setCurrentUser(username);
                mergeUserQuestionStatsIntoStore();
                profileUpdateLoginUI();
                document.getElementById('profileLoginUsername').value = '';
                document.getElementById('profileLoginPassword').value = '';
                showMsg('profileLoginStatus', '登录成功', 'success');
                if (typeof renderProfileTab === 'function') renderProfileTab();
            } else { showMsg('profileLoginStatus', '用户名或密码错误', 'error'); }
        })
        .catch(function() { showMsg('profileLoginStatus', '验证失败，请检查网络或联系管理员', 'error'); });
}
function profileUserLogout() {
    setCurrentUser('');
    profileUpdateLoginUI();
    showMsg('profileLoginStatus', '已退出登录', 'info');
    if (typeof renderProfileTab === 'function') renderProfileTab();
}
function profileUpdateLoginUI() {
    var u = getCurrentUser();
    var formEl = document.getElementById('profileLoginForm');
    var infoEl = document.getElementById('profileLoggedInInfo');
    var nameEl = document.getElementById('profileLoggedInUsername');
    var pasteWrap = document.getElementById('profilePasteSyncWrap');
    if (u) { if (formEl) formEl.style.display = 'none'; if (infoEl) { infoEl.style.display = 'block'; if (nameEl) nameEl.textContent = u; } if (pasteWrap) pasteWrap.style.display = 'block'; }
    else { if (formEl) formEl.style.display = 'flex'; if (infoEl) infoEl.style.display = 'none'; if (pasteWrap) pasteWrap.style.display = 'none'; }
}
var MAX_USER_JSON_BYTES = 800 * 1024;
function profileSyncUserDataToCloud() {
    var u = getCurrentUser();
    if (!u) { showMsg('profileLoginStatus', '请先登录', 'error'); return; }
    if (!GITHUB_CONFIG.token) { showMsg('profileLoginStatus', '管理员尚未配置 GitHub Token，无法同步', 'error'); return; }
    var d = getUserData();
    d.questionStats = extractQuestionStatsFromStore();
    var questionStats = d.questionStats || {};
    delete d.questionStats;
    d.questionStatsFiles = [];
    var mainStr = JSON.stringify(d, null, 2);
    var qids = Object.keys(questionStats);
    var chunkSize = MAX_USER_JSON_BYTES - 500;
    var filesToUpload = [];
    var single = {};
    for (var k in d) if (d.hasOwnProperty(k)) single[k] = d[k];
    single.questionStats = questionStats;
    var content = JSON.stringify(single, null, 2);
    if (content.length <= MAX_USER_JSON_BYTES) {
        filesToUpload.push({ path: 'data/user/' + encodeURIComponent(u) + '.json', content: content, message: '用户 ' + u + ' 数据同步' });
    } else {
        filesToUpload = buildSplitUserFiles(u, d, questionStats, qids, chunkSize);
    }
    showMsg('profileLoginStatus', '正在同步到云端…', 'info');
    uploadUserFiles(filesToUpload, 0, function() { showMsg('profileLoginStatus', '已同步到 data/user/' + u + '.json', 'success'); }, function(err) { showMsg('profileLoginStatus', '同步失败：' + (err.message || '未知错误'), 'error'); });
}
/** 从小程序复制的数据：粘贴后同步到云端（免后端） */
function profileSyncPastedUserDataToCloud() {
    var u = getCurrentUser();
    if (!u) { showMsg('profileLoginStatus', '请先登录', 'error'); return; }
    if (!GITHUB_CONFIG.token) { showMsg('profileLoginStatus', '管理员尚未配置 GitHub Token，无法同步', 'error'); return; }
    var input = document.getElementById('profilePasteSyncInput');
    var text = (input && input.value) ? input.value.trim() : '';
    if (!text) { showMsg('profileLoginStatus', '请先粘贴小程序复制的数据', 'error'); return; }
    var d;
    try { d = JSON.parse(text); } catch (e) { showMsg('profileLoginStatus', '粘贴的不是有效 JSON', 'error'); return; }
    if (!d || typeof d !== 'object') { showMsg('profileLoginStatus', '数据格式错误', 'error'); return; }
    var questionStats = d.questionStats || {};
    delete d.questionStats;
    d.questionStatsFiles = [];
    var qids = Object.keys(questionStats);
    var chunkSize = MAX_USER_JSON_BYTES - 500;
    var filesToUpload = [];
    var single = {};
    for (var k in d) if (d.hasOwnProperty(k)) single[k] = d[k];
    single.questionStats = questionStats;
    var content = JSON.stringify(single, null, 2);
    if (content.length <= MAX_USER_JSON_BYTES) {
        filesToUpload.push({ path: 'data/user/' + encodeURIComponent(u) + '.json', content: content, message: '用户 ' + u + ' 数据同步（从小程序）' });
    } else {
        filesToUpload = buildSplitUserFiles(u, d, questionStats, qids, chunkSize);
    }
    showMsg('profileLoginStatus', '正在同步到云端…', 'info');
    uploadUserFiles(filesToUpload, 0, function() { showMsg('profileLoginStatus', '已同步到 data/user/' + u + '.json', 'success'); if (input) input.value = ''; }, function(err) { showMsg('profileLoginStatus', '同步失败：' + (err.message || '未知错误'), 'error'); });
}
function buildSplitUserFiles(u, mainObj, questionStats, qids, chunkSize) {
    var list = [];
    var main = {};
    for (var k in mainObj) if (mainObj.hasOwnProperty(k)) main[k] = mainObj[k];
    main.questionStatsFiles = [];
    var extraIndex = 1;
    var chunk = {};
    var chunkLen = 2;
    for (var i = 0; i < qids.length; i++) {
        var qid = qids[i];
        var entry = questionStats[qid];
        var seg = '"' + qid.replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '":' + JSON.stringify(entry);
        if (chunkLen + seg.length + 2 > chunkSize && Object.keys(chunk).length) {
            var fname = extraIndex === 1 ? (u + '_data.json') : (u + '_data_' + extraIndex + '.json');
            main.questionStatsFiles.push(fname);
            list.push({ path: 'data/user/' + encodeURIComponent(fname), content: JSON.stringify({ questionStats: chunk }, null, 2), message: '用户 ' + u + ' 数据分片' });
            chunk = {};
            chunkLen = 2;
            extraIndex++;
        }
        chunk[qid] = entry;
        chunkLen += seg.length + 2;
    }
    if (Object.keys(chunk).length) {
        var fname = extraIndex === 1 ? (u + '_data.json') : (u + '_data_' + extraIndex + '.json');
        main.questionStatsFiles.push(fname);
        list.push({ path: 'data/user/' + encodeURIComponent(fname), content: JSON.stringify({ questionStats: chunk }, null, 2), message: '用户 ' + u + ' 数据分片' });
    }
    list.unshift({ path: 'data/user/' + encodeURIComponent(u) + '.json', content: JSON.stringify(main, null, 2), message: '用户 ' + u + ' 数据同步' });
    return list;
}
function uploadUserFiles(files, index, onDone, onErr) {
    if (index >= files.length) { onDone(); return; }
    var f = files[index];
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/' + f.path;
    var headers = { 'Authorization': 'token ' + GITHUB_CONFIG.token, 'Accept': 'application/vnd.github.v3+json' };
    fetch(apiUrl + '?ref=' + GITHUB_CONFIG.branch, { method: 'GET', headers: headers })
        .then(function(r) { if (r.status === 404) return null; if (!r.ok) throw new Error('获取失败'); return r.json(); })
        .then(function(fileInfo) {
            var commitData = { message: f.message, content: btoa(unescape(encodeURIComponent(f.content))), branch: GITHUB_CONFIG.branch };
            if (fileInfo && fileInfo.sha) commitData.sha = fileInfo.sha;
            return fetch(apiUrl, { method: 'PUT', headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }), body: JSON.stringify(commitData) });
        })
        .then(function(r) { if (!r.ok) return r.json().then(function(e) { throw new Error(e.message || '同步失败'); }); uploadUserFiles(files, index + 1, onDone, onErr); })
        .catch(onErr);
}
function profileLoadUserDataFromCloud() {
    var u = getCurrentUser();
    if (!u) { showMsg('profileLoginStatus', '请先登录', 'error'); return; }
    var rawBase = 'https://raw.githubusercontent.com/' + (GITHUB_CONFIG.owner || '') + '/' + (GITHUB_CONFIG.repo || '') + '/' + (GITHUB_CONFIG.branch || 'main') + '/';
    var base = getRemoteBaseUrl() ? (getRemoteBaseUrl().replace(/\/+$/, '') + '/') : (window.location.origin + (window.location.pathname.replace(/[^/]+$/, '') || '/'));
    var mainUrl = rawBase + 'data/user/' + encodeURIComponent(u) + '.json';
    showMsg('profileLoginStatus', '正在从云端加载…', 'info');
    function tryBaseUrl() {
        fetch(base + 'data/user/' + encodeURIComponent(u) + '.json?t=' + Date.now()).then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
            if (d) { mergeLoadedUserData(d, mainUrl, base, u, true); }
            else showMsg('profileLoginStatus', '云端暂无数据', 'error');
        }).catch(function() { showMsg('profileLoginStatus', '加载失败', 'error'); });
    }
    fetch(mainUrl).then(function(r) {
        if (!r.ok) throw new Error('未找到云端数据');
        return r.json();
    }).then(function(d) {
        mergeLoadedUserData(d, mainUrl, base, u, false);
    }).catch(function() { tryBaseUrl(); });
}
function mergeLoadedUserData(d, rawBase, base, u, fromBase) {
    var baseUrl = fromBase ? (base + 'data/user/') : (rawBase.replace(/[^/]+\.json.*$/, ''));
    var merged = {};
    if (d.questionStats) { for (var qid in d.questionStats) if (d.questionStats.hasOwnProperty(qid)) merged[qid] = d.questionStats[qid]; }
    var files = d.questionStatsFiles;
    if (files && Array.isArray(files) && files.length) {
        var i = 0;
        function next() {
            if (i >= files.length) {
                d.questionStats = merged;
                delete d.questionStatsFiles;
                saveUserData(d);
                mergeUserQuestionStatsIntoStore();
                showMsg('profileLoginStatus', '已从云端加载数据', 'success');
                if (typeof renderProfileTab === 'function') renderProfileTab();
                return;
            }
            var url = fromBase ? (base + 'data/user/' + encodeURIComponent(files[i]) + '?t=' + Date.now()) : (baseUrl + encodeURIComponent(files[i]) + '?t=' + Date.now());
            fetch(url).then(function(r) { return r.ok ? r.json() : null; }).then(function(part) {
                if (part && part.questionStats) { for (var qid in part.questionStats) if (part.questionStats.hasOwnProperty(qid)) merged[qid] = part.questionStats[qid]; }
                i++; next();
            }).catch(function() { i++; next(); });
        }
        next();
    } else {
        saveUserData(d);
        mergeUserQuestionStatsIntoStore();
        showMsg('profileLoginStatus', '已从云端加载数据', 'success');
        if (typeof renderProfileTab === 'function') renderProfileTab();
    }
}
function isChallengeLevelUnlocked(L) {
    var passed = getChallengePassedLevels(), unlocked = getUnlockedByPoints();
    if (L === 1) return true;
    return passed.indexOf(L - 1) !== -1 || unlocked.indexOf(L) !== -1;
}
function getNextChallengeUnlockLevel() {
    var passed = getChallengePassedLevels(), unlocked = getUnlockedByPoints();
    for (var L = 1; L <= 6; L++) { if (!isChallengeLevelUnlocked(L)) return L; }
    return null;
}
function getFavorites() {
    var d = getUserData();
    if (d !== null && d.favorites !== undefined) return Array.isArray(d.favorites) ? d.favorites : [];
    try { var f = localStorage.getItem('xingce_favorites'); return f ? JSON.parse(f) : []; } catch (e) { return []; }
}
function setFavorites(arr) {
    var d = getUserData();
    if (d !== null) { d.favorites = arr; saveUserData(d); return; }
    try { localStorage.setItem('xingce_favorites', JSON.stringify(arr)); } catch (e) {}
}
function isFavorite(qid) { return (getFavorites() || []).indexOf(qid) !== -1; }
function addFavorite(qid) { var f = getFavorites(); if (f.indexOf(qid) === -1) { f.push(qid); setFavorites(f); } }
function removeFavorite(qid) { var f = getFavorites().filter(function(id) { return id !== qid; }); setFavorites(f); }
function toggleFavorite(qid) { if (isFavorite(qid)) removeFavorite(qid); else addFavorite(qid); }
function seededRandom(seed) { var x = Math.sin(seed) * 10000; return x - Math.floor(x); }
function seededShuffle(arr, seed) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
        seed = (seed * 9301 + 49297) % 233280;
        var j = Math.floor(seededRandom(seed) * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}
// 处理资料分析捆绑题型：如果题目有ziliaoBlockId，则包含同一材料下的所有题目
function expandZiliaoBlockQuestions(questions) {
    var result = [];
    var addedBlockIds = {};
    var addedQids = {};
    questions.forEach(function(q) {
        if (q.ziliaoBlockId && !addedBlockIds[q.ziliaoBlockId]) {
            // 这是一个资料分析捆绑题，需要包含所有相关题目
            var blockQs = store.getQuestionsByZiliaoBlockId ? store.getQuestionsByZiliaoBlockId(q.ziliaoBlockId) : null;
            if (blockQs && blockQs.length > 1) {
                addedBlockIds[q.ziliaoBlockId] = true;
                blockQs.forEach(function(bq) {
                    if (bq && !addedQids[bq.id]) {
                        result.push(bq);
                        addedQids[bq.id] = true;
                    }
                });
            } else {
                // 单个题目或找不到捆绑题，直接添加
                if (!addedQids[q.id]) {
                    result.push(q);
                    addedQids[q.id] = true;
                }
            }
        } else {
            // 普通题目，直接添加
            if (!addedQids[q.id]) {
                result.push(q);
                addedQids[q.id] = true;
            }
        }
    });
    return result;
}
function generateChallengeQuestions(level, opts) {
    opts = opts || {};
    var l4Count = parseInt((opts.l4Count || 10), 10) || 10;
    var l5Count = parseInt((opts.l5Count || 5), 10) || 5;
    var seed = (opts.dateStr || getTodayStr()).split('').reduce(function(a, c) { return a + c.charCodeAt(0); }, 0) + level * 1000;
    var result = [];
    if (level === 1) {
        var ids = store.getQuestionIdsByCategory('言语理解', '逻辑填空');
        ids = seededShuffle(ids, seed);
        result = ids.slice(0, 15).map(function(qid) { return store.questions[qid]; }).filter(Boolean);
    } else if (level === 2) {
        var ids = store.getQuestionIdsByCategory('言语理解', '片段阅读');
        ids = seededShuffle(ids, seed);
        result = ids.slice(0, 10).map(function(qid) { return store.questions[qid]; }).filter(Boolean);
    } else if (level === 3) {
        var subs = [{ sub: '语句排序', n: 3 }, { sub: '接语选择', n: 2 }, { sub: '标题填入', n: 2 }, { sub: '细节判断', n: 3 }];
        subs.forEach(function(s, idx) {
            var ids = store.getQuestionIdsByCategory('言语理解', s.sub);
            ids = seededShuffle(ids, seed + idx);
            result = result.concat(ids.slice(0, s.n).map(function(qid) { return store.questions[qid]; }).filter(Boolean));
        });
    } else if (level === 4) {
        var kps = ['经济利润', '排列组合', '行程问题', '和差倍比', '概率问题', '工程问题', '几何问题', '不定方程'];
        var per = Math.ceil(l4Count / kps.length);
        var used = {};
        kps.forEach(function(kp, idx) {
            var ids = store.getQuestionIdsByKnowledgePoints([kp]);
            ids = seededShuffle(ids, seed + idx);
            ids.slice(0, per).forEach(function(qid) { if (!used[qid]) { used[qid] = true; result.push(store.questions[qid]); } });
        });
        if (result.length < l4Count) {
            var allIds = store.getQuestionIdsByCategory('数量关系', '数量关系');
            allIds = seededShuffle(allIds, seed + 99);
            for (var i = 0; result.length < l4Count && i < allIds.length; i++) {
                if (!used[allIds[i]]) { used[allIds[i]] = true; var q = store.questions[allIds[i]]; if (q) result.push(q); }
            }
        }
        result = result.slice(0, l4Count);
    } else if (level === 5) {
        var ids = store.getQuestionIdsByCategory('判断推理', '图形推理');
        ids = seededShuffle(ids, seed);
        result = ids.slice(0, l5Count).map(function(qid) { return store.questions[qid]; }).filter(Boolean);
    } else if (level === 6) {
        var subs = [{ sub: '定义判断', n: 8 }, { sub: '翻译推理', n: 5 }, { sub: '类比推理', n: 5 }, { sub: '加强题型', n: 3 }, { sub: '削弱题型', n: 3 }, { sub: '真假推理', n: 1 }];
        subs.forEach(function(s, idx) {
            var ids = store.getQuestionIdsByCategory('判断推理', s.sub);
            ids = seededShuffle(ids, seed + idx);
            result = result.concat(ids.slice(0, s.n).map(function(qid) { return store.questions[qid]; }).filter(Boolean));
        });
    }
    // 处理资料分析捆绑题型
    result = expandZiliaoBlockQuestions(result);
    return result;
}
function ensureChallengeCache() {
    var now = new Date();
    var today = getTodayStr();
    var hour = now.getHours();
    // 如果当前时间已经过了6点，使用今天的日期；否则使用昨天的日期（因为6点前还是算昨天的题目）
    var effectiveDate = (hour >= 6) ? today : (function() {
        var d = new Date(now);
        d.setDate(d.getDate() - 1);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
    var cached = getChallengeCache();
    var cachedDate = getChallengeDate();
    // 检查是否需要刷新：日期不同或缓存为空，或者当前时间已经过了6点且缓存日期不是今天的有效日期
    var shouldRefresh = false;
    if (!cachedDate || !cached['1']) {
        shouldRefresh = true;
    } else {
        // 如果当前时间>=6点，且缓存日期不是今天的有效日期，需要刷新
        if (hour >= 6 && cachedDate !== effectiveDate) {
            shouldRefresh = true;
        } else if (hour < 6) {
            // 如果当前时间<6点，检查缓存日期是否是昨天的有效日期
            var yesterday = (function() {
                var d = new Date(now);
                d.setDate(d.getDate() - 1);
                return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            })();
            if (cachedDate !== yesterday && cachedDate !== effectiveDate) {
                shouldRefresh = true;
            }
        }
    }
    if (shouldRefresh) {
        var l4 = (document.querySelector('input[name="challengeL4Count"]:checked') || {}).value || '10';
        var l5 = (document.querySelector('input[name="challengeL5Count"]:checked') || {}).value || '5';
        cached = {};
        for (var L = 1; L <= 6; L++) {
            var qs = generateChallengeQuestions(L, { dateStr: effectiveDate, l4Count: l4, l5Count: l5 });
            cached[String(L)] = qs.map(function(q) { return q.id; });
        }
        setChallengeCache(cached);
        setChallengeDate(effectiveDate);
    }
    return cached;
}
function doSignIn() {
    var today = getTodayStr();
    if (getSignInDate() === today) { alert('今日已签到'); return; }
    setSignInDate(today);
    setPoints(getPoints() + 5);
    logPointsUsage('signin', 5, '每日签到');
    renderChallengeTab();
}
function doRefreshChallenge() {
    var pts = getPoints();
    if (pts < 1) { alert('积分不足，无法提前刷新。每日签到可得 5 积分。'); return; }
    if (!confirm('确定消耗 1 积分提前刷新今日闯关题库？')) return;
    setPoints(pts - 1);
    logPointsUsage('refresh', -1, '提前刷新闯关');
    setChallengeDate('');
    setChallengeCache({});
    ensureChallengeCache();
    renderChallengeTab();
}
function unlockChallengeWithPoints(level) {
    var pts = getPoints();
    if (pts < 1) { alert('积分不足'); return; }
    var nextUnlock = getNextChallengeUnlockLevel();
    if (nextUnlock !== level) { alert('请按顺序解锁，先完成第' + (level - 1) + '关'); return; }
    if (!confirm('确定消耗 1 积分开启第 ' + level + ' 关？解锁后可重复练习。')) return;
    setPoints(pts - 1);
    logPointsUsage('unlock', -1, '解锁第' + level + '关');
    var unlocked = getUnlockedByPoints();
    if (unlocked.indexOf(level) === -1) { unlocked.push(level); unlocked.sort(function(a,b){ return a-b; }); setUnlockedByPoints(unlocked); }
    renderChallengeTab();
}
function startChallengeLevel(level) {
    var cache = ensureChallengeCache();
    var qids = cache[String(level)] || [];
    var questions = qids.map(function(qid) { return store.questions[qid]; }).filter(Boolean);
    if (!questions.length) { alert('该关暂无题目，请先导入对应分类的题目。'); return; }
    var setNames = {};
    store.sets.forEach(function(s) { setNames[s.id] = s.name || ''; });
    try {
        sessionStorage.setItem('xingce_practice_session', JSON.stringify({ questions: questions, setNames: setNames, practiceMode: 'practice', challengeLevel: level }));
    } catch (e) { alert('无法保存'); return; }
    window.open('practice.html', '_blank');
}
function renderChallengeTab() {
    document.getElementById('challengePoints').textContent = (getPoints() || 0);
    var today = getTodayStr();
    document.getElementById('btnSignIn').disabled = getSignInDate() === today;
    document.getElementById('btnRefreshChallenge').disabled = getPoints() < 1;
    document.getElementById('challengeRefreshHint').textContent = '闯关题库每日 ' + today + ' 更新';
    var cache = ensureChallengeCache();
    var passed = getChallengePassedLevels();
    var nextUnlock = getNextChallengeUnlockLevel();
    var levelNames = ['', '第一关：逻辑填空 15题', '第二关：片段阅读 10题', '第三关：语句排序/接语/标题/细节 10题', '第四关：数量关系（选10或15题）', '第五关：图形推理（选5或10题）', '第六关：定义/逻辑/类比/加强/削弱/真假 25题'];
    var container = document.getElementById('challengeLevelList');
    var html = '';
    for (var L = 1; L <= 6; L++) {
        var qids = cache[String(L)] || [];
        var count = qids.length;
        var isUnlock = isChallengeLevelUnlocked(L);
        var canUnlockWithPoints = (nextUnlock === L) && !isUnlock && getPoints() >= 1;
        html += '<div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; background:' + (isUnlock ? '#fff' : '#f5f5f5') + '; border-radius:8px; border:1px solid #eee;">';
        html += '<span>' + levelNames[L] + '（' + count + ' 题）</span>';
        if (passed.indexOf(L) !== -1) html += '<span style="color:var(--success-color);">✓ 已完成</span>';
        else if (isUnlock) html += '<button class="btn btn-primary btn-sm" onclick="startChallengeLevel(' + L + ')">开始</button>';
        else if (canUnlockWithPoints) html += '<button class="btn btn-info btn-sm" onclick="unlockChallengeWithPoints(' + L + ')">1 积分解锁</button>';
        else html += '<span style="color:#6c757d; font-size:0.85rem;">请先完成第' + (L - 1) + '关</span>';
        html += '</div>';
    }
    container.innerHTML = html || '<p style="color:#6c757d;">暂无闯关题目</p>';
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
    document.querySelectorAll('.nav-item').forEach(function(t) { t.classList.remove('active'); });
    var content = document.getElementById('tab-' + tabName);
    if (content) content.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(function(t) { if (t.getAttribute('data-tab') === tabName) t.classList.add('active'); });
    if (tabName === 'manage') filterManage();
    if (tabName === 'single') { updateSinglePreview(); renderSingleHistory(); }
    if (tabName === 'practice') { updatePracticeSub(); onPracticeTypeChange(); }
    if (tabName === 'challenge') { renderChallengeTab(); }
    if (tabName === 'pk') { pkUpdateCurrentUserLabel(); }
    if (tabName === 'history') { renderHistoryList(); }
    if (tabName === 'points') { renderPointsList(); }
    if (tabName === 'export') { checkExportState(); onExportScopeChange(); }
    if (tabName === 'profile') {
        renderProfileTab();
        renderTree();
        renderWrongList();
        renderFavoritesTab();
        var importEl = document.getElementById('importDataFile');
        if (importEl) importEl.value = '';
        var dataStatusEl = document.getElementById('dataStatus');
        if (dataStatusEl) dataStatusEl.style.display = 'none';
        renderExportSetList();
        toggleExportSetList();
    }
    if (tabName === 'admin') {
        // 切换到管理员页面时，如果未登录则显示登录界面
        if (!adminAuthenticated) {
            document.getElementById('adminLogin').style.display = 'block';
            document.getElementById('adminContent').style.display = 'none';
        } else {
            document.getElementById('adminLogin').style.display = 'none';
            document.getElementById('adminContent').style.display = 'block';
            initAdminPage();
        }
    }
}
function renderProfileTab() {
    var el = document.getElementById('profilePoints');
    if (el) el.textContent = getPoints();
    var log = []; try { var s = localStorage.getItem('xingce_points_log'); log = s ? JSON.parse(s) : []; } catch (e) {}
    var container = document.getElementById('profilePointsLog');
    if (!container) return;
    if (!log.length) { container.innerHTML = '<p style="color:#6c757d;">暂无记录</p>'; return; }
    container.innerHTML = log.slice(0, 100).map(function(x) {
        var d = x.date ? new Date(x.date).toLocaleString('zh-CN') : '';
        var amt = x.amount >= 0 ? '+' + x.amount : x.amount;
        var cls = x.amount >= 0 ? 'color:var(--success-color)' : 'color:#dc3545';
        return '<div style="padding:8px 0; border-bottom:1px solid #eee; display:flex; justify-content:space-between;"><span>' + d + ' ' + (x.desc || '') + '</span><span style="' + cls + '">' + amt + '</span></div>';
    }).join('');
}

// 管理员版本的 GitHub Token 管理函数
function adminSaveGitHubToken() {
    var input = document.getElementById('adminGithubTokenInput');
    if (!input) return;
    var token = (input.value || '').trim();
    if (!token) {
        showMsg('adminGithubStatus', '请输入 Token', 'error');
        return;
    }
    try {
        // 加密后保存
        var encryptedToken = encryptToken(token);
        localStorage.setItem('github_token', encryptedToken);
        GITHUB_CONFIG.token = token; // 使用原始 token
        showMsg('adminGithubStatus', 'Token 已保存（已加密存储）', 'success');
        updateAdminGithubTokenStatus();
    } catch (e) {
        showMsg('adminGithubStatus', '保存失败：' + (e.message || '未知错误'), 'error');
    }
}

function adminClearGitHubToken() {
    if (!confirm('确定要清除 GitHub Token 吗？清除后将无法自动同步到 GitHub。')) return;
    try {
        localStorage.removeItem('github_token');
        GITHUB_CONFIG.token = '';
        var input = document.getElementById('adminGithubTokenInput');
        if (input) {
            input.value = '';
            input.placeholder = '输入 Token（需要 repo 权限，将加密存储）';
        }
        showMsg('adminGithubStatus', 'Token 已清除', 'success');
        updateAdminGithubTokenStatus();
    } catch (e) {
        showMsg('adminGithubStatus', '清除失败：' + (e.message || '未知错误'), 'error');
    }
}

function adminTestGitHubConnection() {
    if (!GITHUB_CONFIG.token) {
        showMsg('adminGithubStatus', '请先配置 Token', 'error');
        return;
    }
    showMsg('adminGithubStatus', '正在测试连接...', 'info');
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo;
    fetch(apiUrl, {
        headers: {
            'Authorization': 'token ' + GITHUB_CONFIG.token,
            'Accept': 'application/vnd.github.v3+json'
        }
    })
    .then(function(resp) {
        if (!resp.ok) {
            if (resp.status === 401) {
                throw new Error('Token 无效或已过期');
            } else if (resp.status === 404) {
                throw new Error('仓库不存在或无访问权限');
            } else {
                throw new Error('连接失败：' + resp.status);
            }
        }
        return resp.json();
    })
    .then(function(data) {
        showMsg('adminGithubStatus', '连接成功！仓库：' + (data.full_name || GITHUB_CONFIG.repo), 'success');
    })
    .catch(function(err) {
        showMsg('adminGithubStatus', '连接失败：' + (err.message || '未知错误'), 'error');
    });
}

function updateAdminGithubTokenStatus() {
    var tokenStatusEl = document.getElementById('adminGithubTokenStatus');
    var tokenInputEl = document.getElementById('adminGithubTokenInput');
    if (tokenStatusEl) {
        var token = GITHUB_CONFIG.token || '';
        if (token) {
            // 显示加密后的值（前12个字符）而不是原始值，保护真实 token
            var encryptedToken = encryptToken(token);
            var displayValue = encryptedToken.substring(0, 12) + '...';
            tokenStatusEl.textContent = '已配置（加密存储：' + displayValue + '）';
            tokenStatusEl.style.color = 'var(--success-color)';
            // 输入框不显示原始 token，让用户输入新的 token 来更换
            if (tokenInputEl) {
                // 如果输入框为空或者是原始 token，清空让用户输入新的
                if (!tokenInputEl.value || tokenInputEl.value === token) {
                    tokenInputEl.value = ''; // 清空，让用户输入新的 token
                    tokenInputEl.placeholder = '输入新的 Token 以更换（将加密存储）';
                }
            }
        } else {
            tokenStatusEl.textContent = '未配置';
            tokenStatusEl.style.color = 'var(--text-secondary)';
            if (tokenInputEl) {
                tokenInputEl.value = '';
                tokenInputEl.placeholder = '输入 Token（需要 repo 权限，将加密存储）';
            }
        }
    }
}
function toggleExportSetList() {
    var scope = (document.querySelector('input[name="exportScope"]:checked') || {}).value || 'all';
    document.getElementById('exportSetListWrap').style.display = scope === 'selected' ? 'block' : 'none';
}
function renderExportSetList() {
    var container = document.getElementById('exportSetList');
    if (!container) return;
    if (!store.sets.length) { container.innerHTML = '<span style="color:#6c757d;">暂无套卷</span>'; return; }
    container.innerHTML = store.sets.map(function(s) {
        var n = (s.name || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        return '<label style="display:inline-flex; align-items:center; gap:4px; cursor:pointer;"><input type="checkbox" name="exportSetId" value="' + s.id + '"> ' + n + '</label>';
    }).join('');
}
function exportSelectAllSets(checked) {
    document.querySelectorAll('input[name="exportSetId"]').forEach(function(cb) { cb.checked = checked; });
}
var detailQid = null;
function showQuestionDetail(qid) {
    detailQid = qid;
    var q = store.getQuestion(qid);
    if (!q) return;
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function imgTag(src) { return '<img src="' + src + '" style="max-width:100%; margin:6px 0;" />'; }
    var blockId = q.ziliaoBlockId;
    var blockQs = blockId ? store.getQuestionsByZiliaoBlockId(blockId) : null;
    var isZiliaoBlock = blockQs && blockQs.length > 1;
    var html = '';
    if (isZiliaoBlock) {
        var first = blockQs[0];
        var hist = (first.totalAttempts || 0) > 0 ? ((first.correctCount || 0) + '/' + first.totalAttempts + ' (' + Math.round(100 * (first.correctCount || 0) / first.totalAttempts) + '%)') : '暂无';
        html += '<p style="margin-bottom:8px;"><strong>资料分析 · 一材料多题（共' + blockQs.length + '小题）</strong></p>';
        html += '<div class="page-question-header">【' + esc(first.section) + '-' + esc(first.subcategory || first.section) + '】 ' + esc(first.source || first.timeRegion || '') + '</div>';
        var matHtml = (first.material ? '<p>' + esc(first.material) + '</p>' : '') + (first.materialImages || []).map(imgTag).join('');
        if (matHtml) html += '<div style="margin-bottom:16px; padding:12px; background:#f8f9fa; border-radius:8px; border-left:4px solid var(--primary-color);"><strong>材料：</strong>' + matHtml + '</div>';
        blockQs.forEach(function(sq, idx) {
            html += '<div class="ziliao-sub-question" style="margin-bottom:20px; padding:16px; border:1px solid #eaeaea; border-radius:8px;">';
            html += '<div style="margin-bottom:8px; font-weight:600; color:var(--primary-color);">第' + (idx + 1) + '题</div>';
            html += '<div class="question-content">' + esc(sq.content || '') + (sq.stemImages || []).map(imgTag).join('') + '</div>';
            html += '<div class="options-grid" style="margin-top:12px;">' + (sq.options || []).map(function(o) {
                var c = o.label === sq.answer ? 'correct' : '';
                return '<div class="option ' + c + '"><span class="option-label">' + o.label + '.</span> ' + esc(o.text) + (o.images || []).map(imgTag).join('') + '</div>';
            }).join('') + '</div>';
            if (sq.explanation) html += '<div class="answer-block" style="margin-top:12px;">解析：<div class="explanation-body">' + explanationToHtml(sq.explanation) + '</div></div>';
            html += '</div>';
        });
    } else {
        var hist = (q.totalAttempts || 0) > 0 ? ((q.correctCount || 0) + '/' + q.totalAttempts + ' (' + Math.round(100 * (q.correctCount || 0) / q.totalAttempts) + '%)') : '暂无';
        var materialHtml = (q.material ? '<p>' + esc(q.material) + '</p>' : '') + (q.materialImages || []).map(imgTag).join('');
        var stemHtml = esc(q.content || '') + (q.stemImages || []).map(imgTag).join('');
        var optHtml = (q.options || []).map(function(o) {
            var c = o.label === q.answer ? 'correct' : '';
            return '<div class="option ' + c + '"><span class="option-label">' + o.label + '.</span> ' + esc(o.text) + (o.images || []).map(imgTag).join('') + '</div>';
        }).join('');
        html = '<p style="margin-bottom:8px;"><strong>历史正确率：</strong>' + hist + '</p><div class="page-question-header">【' + esc(q.section) + '-' + esc(q.subcategory || q.section) + '】</div>' + (materialHtml ? '<div style="margin-bottom:12px;">' + materialHtml + '</div>' : '') + '<div class="question-content">' + stemHtml + '</div><div class="options-grid" style="margin-top:12px;">' + optHtml + '</div>' + (q.explanation ? '<div class="answer-block" style="margin-top:12px;">解析：<div class="explanation-body">' + explanationToHtml(q.explanation) + '</div></div>' : '');
    }
    document.getElementById('questionDetailBody').innerHTML = html;
    renderLaTeXInElement(document.getElementById('questionDetailBody'));
    var ptsQ = isZiliaoBlock && blockQs.length ? blockQs[0] : q;
    var pts = (ptsQ && (ptsQ.knowledgePoints || [])) ? (ptsQ.knowledgePoints || []).join('、') : (q.knowledgePoints || []).join('、');
    document.getElementById('questionDetailPoints').textContent = pts || '暂无';
    document.getElementById('questionDetailPointsEdit').style.display = 'none';
    document.getElementById('btnEditFromDetail').onclick = function() {
        openEditQuestion(qid);
    };
    updateFavoriteButtonState();
    document.getElementById('questionDetailOverlay').style.display = 'block';
}
function closeQuestionDetail() { 
    document.getElementById('questionDetailOverlay').style.display = 'none'; 
    detailQid = null;
    // 保留之前选择的大类和小类，不重置
    // 不再调用 filterManage()，因为选择已经保留
}
function openEditPoints() {
    var q = detailQid && store.getQuestion(detailQid);
    var inputEl = document.getElementById('questionDetailPointsInput');
    if (inputEl) inputEl.value = (q && (q.knowledgePoints || []).length) ? (q.knowledgePoints || []).join('，') : '';
    document.getElementById('questionDetailPointsEdit').style.display = 'block';
    var hist = [];
    try { var h = localStorage.getItem('xingce_knowledge_point_history'); if (h) hist = JSON.parse(h); } catch (e) {}
    var fromStore = store.getAllKnowledgePoints ? store.getAllKnowledgePoints() : [];
    var set = {};
    hist.forEach(function(p) { if (p && String(p).trim()) set[String(p).trim()] = true; });
    fromStore.forEach(function(p) { if (p && String(p).trim()) set[String(p).trim()] = true; });
    var list = Object.keys(set).sort();
    var html = list.length ? list.map(function(p) { return '<button type="button" class="btn btn-sm btn-point-history" style="background:var(--light-bg); border:1px solid var(--border-color); margin:2px;" data-point="' + (p.replace(/"/g, '&quot;').replace(/</g, '&lt;')) + '">' + (p.replace(/</g, '&lt;')) + '</button>'; }).join('') : '<span style="color:#6c757d;">暂无历史考点</span>';
    var histEl = document.getElementById('questionDetailPointsHistory');
    if (histEl) {
        histEl.innerHTML = html;
        histEl.querySelectorAll('.btn-point-history').forEach(function(btn) {
            btn.addEventListener('click', function() { appendPointToDetailInput(btn.getAttribute('data-point') || ''); });
        });
    }
}
function appendPointToDetailInput(point) {
    var inputEl = document.getElementById('questionDetailPointsInput');
    if (!inputEl) return;
    var cur = (inputEl.value || '').trim();
    var arr = cur ? cur.split(/[,，、\s]+/).map(function(s) { return s.trim(); }).filter(Boolean) : [];
    if (arr.indexOf(point) === -1) arr.push(point);
    inputEl.value = arr.join('、');
}
function saveQuestionPoints() {
    if (!detailQid) return;
    var raw = (document.getElementById('questionDetailPointsInput').value || '').trim();
    var arr = raw ? raw.split(/[,，、\s]+/).map(function(s) { return s.trim(); }).filter(Boolean) : [];
    var q = store.getQuestion(detailQid);
    if (q) {
        q.knowledgePoints = arr;
        store.save();
        try {
            var hist = []; var h = localStorage.getItem('xingce_knowledge_point_history'); if (h) hist = JSON.parse(h);
            var set = new Set(hist);
            arr.forEach(function(p) { if (p) set.add(p); });
            localStorage.setItem('xingce_knowledge_point_history', JSON.stringify([...set]));
        } catch (e) {}
        document.getElementById('questionDetailPoints').textContent = arr.join('、') || '暂无';
        document.getElementById('questionDetailPointsEdit').style.display = 'none';
        renderPointsList();
        if (typeof renderPracticePointsCheckboxes === 'function') renderPracticePointsCheckboxes();
    }
}
// DeepSeek AI 解析已移除
var editQid = null;
function editPreviewOnPaste() { setTimeout(updateEditPreview, 100); }
function openEditQuestion(qid) {
    editQid = qid;
    var q = store.getQuestion(qid);
    if (!q) return;
    function setEditableContent(id, text, images) {
        var el = document.getElementById(id);
        if (!el) return;
        var html = (text || '').replace(/\n/g, '<br>');
        if (images && images.length) {
            html += images.map(function(src) { return '<img src="' + src + '" style="max-width:100%; margin:8px 0;" />'; }).join('');
        }
        el.innerHTML = html;
    }
    setEditableContent('editMaterial', q.material || '', q.materialImages || []);
    setEditableContent('editQuestionContent', q.content || '', q.stemImages || []);
    var opts = q.options || [];
    setEditableContent('editOptA', (opts[0] && opts[0].text) || '', (opts[0] && opts[0].images) || []);
    setEditableContent('editOptB', (opts[1] && opts[1].text) || '', (opts[1] && opts[1].images) || []);
    setEditableContent('editOptC', (opts[2] && opts[2].text) || '', (opts[2] && opts[2].images) || []);
    setEditableContent('editOptD', (opts[3] && opts[3].text) || '', (opts[3] && opts[3].images) || []);
    document.getElementById('editAnswer').value = q.answer || 'A';
    var expEl = document.getElementById('editExplanation');
    if (expEl) expEl.innerHTML = explanationToHtml(q.explanation || '');
    document.getElementById('questionEditOverlay').style.display = 'block';
    updateEditPreview();
    ['editMaterial', 'editQuestionContent', 'editOptA', 'editOptB', 'editOptC', 'editOptD', 'editExplanation'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', updateEditPreview);
            el.addEventListener('paste', editPreviewOnPaste);
        }
    });
}
function closeEditQuestion() {
    document.getElementById('questionEditOverlay').style.display = 'none';
    editQid = null;
    ['editMaterial', 'editQuestionContent', 'editOptA', 'editOptB', 'editOptC', 'editOptD', 'editExplanation'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) {
            el.removeEventListener('input', updateEditPreview);
            el.removeEventListener('paste', editPreviewOnPaste);
        }
    });
}
var _editPreviewTimer = null;
function updateEditPreview() {
    if (_editPreviewTimer) clearTimeout(_editPreviewTimer);
    _editPreviewTimer = setTimeout(function() {
        _editPreviewTimer = null;
        var wrap = document.getElementById('editPreview');
        if (!wrap) return;
        function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
        var materialData = getEditableContent('editMaterial');
        var stemData = getEditableContent('editQuestionContent');
        var optA = getEditableContent('editOptA'), optB = getEditableContent('editOptB'), optC = getEditableContent('editOptC'), optD = getEditableContent('editOptD');
        var materialImgs = (materialData.images || []).map(function(src) { return '<img src="' + src + '" style="max-width:100%; margin:8px 0;" />'; }).join('');
        var stemImgs = (stemData.images || []).map(function(src) { return '<img src="' + src + '" style="max-width:100%; margin:8px 0;" />'; }).join('');
        var html = '';
        if (materialData.text || materialImgs) html += '<div style="margin-bottom:12px;"><strong>材料</strong><div>' + esc(materialData.text) + materialImgs + '</div></div>';
        html += '<div style="margin-bottom:12px;"><strong>题干</strong><div>' + esc(stemData.text) + stemImgs + '</div></div>';
        ['A','B','C','D'].forEach(function(lbl, i) {
            var o = [optA,optB,optC,optD][i];
            var imgs = (o.images || []).map(function(src) { return '<img src="' + src + '" style="max-width:100%; margin:4px 0;" />'; }).join('');
            html += '<div style="margin-bottom:8px;"><strong>选项' + lbl + '</strong> ' + esc(o.text) + imgs + '</div>';
        });
        var exp = getExplanationWithInlineImages('editExplanation') || '';
        if (exp) html += '<div style="margin-top:12px;"><strong>解析</strong><div class="explanation-preview">' + explanationToHtml(exp) + '</div></div>';
        wrap.innerHTML = html || '<span style="color:#6c757d;">输入题干或选项后此处显示预览</span>';
        renderLaTeXInElement(wrap);
    }, 200);
}
function saveEditQuestion() {
    if (!editQid) return;
    var q = store.getQuestion(editQid);
    if (!q) return;
    var materialData = getEditableContent('editMaterial');
    var stemData = getEditableContent('editQuestionContent');
    var optA = getEditableContent('editOptA'), optB = getEditableContent('editOptB'), optC = getEditableContent('editOptC'), optD = getEditableContent('editOptD');
    q.material = materialData.text;
    q.materialImages = materialData.images;
    q.content = stemData.text;
    q.stemImages = stemData.images;
    q.options = [
        { label: 'A', text: optA.text, images: optA.images },
        { label: 'B', text: optB.text, images: optB.images },
        { label: 'C', text: optC.text, images: optC.images },
        { label: 'D', text: optD.text, images: optD.images }
    ];
    q.answer = document.getElementById('editAnswer').value || 'A';
    q.explanation = getExplanationWithInlineImages('editExplanation') || '';
    store.save();
    closeEditQuestion();
    if (detailQid === editQid) showQuestionDetail(detailQid);
    filterManage();
    if (document.getElementById('tab-single') && document.getElementById('tab-single').classList.contains('active')) renderSingleHistory();
    showMsg('setStatus', '题目已更新（已保存到本地）', 'success');
    // 注意：首页的编辑题目不同步到 GitHub，只保存到本地
}
function renderHistoryList() {
    var list = getHistory();
    var container = document.getElementById('historyList');
    if (!container) return;
    if (!list.length) { container.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>暂无做题记录</p></div>'; return; }
    container.style.display = 'block';
    container.innerHTML = list.slice().reverse().map(function(h, revIdx) {
        var origIdx = list.length - 1 - revIdx;
        var rate = h.total ? Math.round(100 * (h.correctCount || 0) / h.total) : 0;
        var dateStr = h.date ? new Date(h.date).toLocaleString('zh-CN') : '';
        var totalMin = h.totalTime ? Math.floor(h.totalTime / 60000) : 0;
        var totalSec = h.totalTime ? Math.floor((h.totalTime % 60000) / 1000) : 0;
        var timeStr = totalMin + '分' + totalSec + '秒';
        return '<div class="set-item"><span>' + dateStr + '</span> <span style="color:#6c757d;">正确率 ' + (h.correctCount||0) + '/' + h.total + ' (' + rate + '%) 总用时 ' + timeStr + '</span> <button class="btn btn-info btn-sm" onclick="showHistoryDetail(' + origIdx + ')">查看详情</button></div>';
    }).join('');
}
function showHistoryDetail(origIndex) {
    var list = getHistory();
    var h = list[origIndex];
    if (!h) return;
    document.getElementById('historyList').style.display = 'none';
    document.getElementById('historyDetail').style.display = 'block';
    document.getElementById('historyDetailTitle').textContent = (h.date ? new Date(h.date).toLocaleString('zh-CN') : '') + ' 正确率 ' + (h.correctCount||0) + '/' + h.total + ' 总用时 ' + (h.totalTime ? (Math.floor(h.totalTime/60000) + '分' + Math.floor((h.totalTime%60000)/1000) + '秒') : '');
    var bySub = h.bySubcategory || {};
    var subHtml = Object.keys(bySub).map(function(k) { var v = bySub[k]; return k + ' ' + (v.correct||0) + '/' + (v.total||0); }).join('； ');
    var results = (h.questionResults || []).map(function(r, idx) {
        var q = store.getQuestion(r.qid);
        var name = q ? (q.section + '-' + (q.subcategory||'')) : '';
        var t = r.timeSpent ? (Math.floor(r.timeSpent/1000) + '秒') : '—';
        var status = r.correct === null ? '未作答' : (r.correct ? '✓正确' : '✗错误');
        return (idx+1) + '. ' + name + ' ' + status + ' 用时' + t + ' <a href="#" onclick="showQuestionDetail(\'' + r.qid + '\'); return false;">题目详情</a>';
    }).join('<br>');
    document.getElementById('historyDetailContent').innerHTML = '<p style="margin-bottom:8px;">小分类正确率：' + (subHtml || '—') + '</p><p style="margin-bottom:8px; color:#6c757d;">共 ' + (h.questionResults || []).length + ' 题（含未作答）</p><div>' + (results || '无') + '</div>';
}
function renderWrongList() {
    var ids = store.getWrongQuestionIds();
    var container = document.getElementById('wrongList');
    if (!container) return;
    if (!ids.length) { container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>暂无错题</p></div>'; return; }
    var list = ids.map(function(qid) { return store.getQuestion(qid); }).filter(Boolean);
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    container.innerHTML = '<div class="filter-controls" style="margin-bottom:12px;"><button class="btn btn-primary" onclick="startPracticeFromWrong()">从错题本刷题</button></div>' + list.map(function(q) {
        var hist = (q.totalAttempts || 0) > 0 ? ((q.correctCount || 0) + '/' + q.totalAttempts) : '—';
        return '<div class="question-item"><div class="question-header"><span class="question-category">' + esc(q.section) + '-' + esc(q.subcategory||q.section) + '</span> <span style="color:#6c757d;">历史 ' + hist + '</span> <button class="btn btn-info btn-sm" onclick="showQuestionDetail(\'' + q.id + '\')">题目详情</button></div><div class="question-content">' + esc((q.content||'').slice(0, 120)) + '…</div></div>';
    }).join('');
}
function startPracticeFromWrong() {
    var ids = store.getWrongQuestionIds();
    if (!ids.length) { alert('暂无错题'); return; }
    var questions = ids.slice(0, 50).map(function(qid) { return store.getQuestion(qid); }).filter(Boolean);
    for (var i = questions.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = questions[i]; questions[i] = questions[j]; questions[j] = t; }
    var setNames = {}; store.sets.forEach(function(s) { setNames[s.id] = s.name || ''; });
    try { sessionStorage.setItem('xingce_practice_session', JSON.stringify({ questions: questions, setNames: setNames, practiceMode: practiceMode })); } catch (e) { alert('无法保存'); return; }
    window.open('practice.html', '_blank');
}
function toggleFavoriteFromDetail() {
    if (!detailQid) return;
    toggleFavorite(detailQid);
    updateFavoriteButtonState();
    renderFavoritesTab();
}
function updateFavoriteButtonState() {
    var btn = document.getElementById('btnFavoriteFromDetail');
    if (btn) {
        var fav = detailQid && isFavorite(detailQid);
        btn.innerHTML = '<i class="fas fa-star' + (fav ? '' : '-o') + '"></i> <span id="btnFavoriteText">' + (fav ? '取消收藏' : '收藏') + '</span>';
    }
}
function renderFavoritesTab() {
    var ids = getFavorites();
    var container = document.getElementById('favoritesList');
    if (!container) return;
    var list = ids.map(function(qid) { return store.getQuestion(qid); }).filter(Boolean);
    if (!list.length) { container.innerHTML = '<div class="empty-state"><i class="fas fa-star"></i><p>暂无收藏题目</p></div>'; return; }
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    container.innerHTML = list.map(function(q) {
        return '<div class="question-item"><div class="question-header"><span class="question-category">' + esc(q.section) + '-' + esc(q.subcategory||q.section) + '</span> <button class="btn btn-info btn-sm" onclick="showQuestionDetail(\'' + q.id + '\')">题目详情</button> <button class="btn btn-default btn-sm" onclick="removeFavorite(\'' + q.id + '\'); renderFavoritesTab();">取消收藏</button></div><div class="question-content">' + esc((q.content||'').slice(0, 120)) + '…</div></div>';
    }).join('');
}
async function exportFavoritesToPDF() {
    var ids = getFavorites();
    var questions = ids.map(function(qid) { return store.getQuestion(qid); }).filter(Boolean);
    if (!questions.length) { alert('暂无收藏题目'); return; }
    await exportQuestionsToPDFInternal(questions, '收藏');
    showMsg('setStatus', '已下载：收藏.pdf、收藏_答案.pdf', 'success');
}
function renderPointsList() {
    var points = store.getAllKnowledgePoints();
    var container = document.getElementById('pointsList');
    if (!container) return;
    if (!points.length) { container.innerHTML = '<span style="color:#6c757d;">暂无考点，在题目详情中编辑考点</span>'; return; }
    container.innerHTML = points.map(function(p) {
        var count = store.getQuestionIdsByKnowledgePoints([p]).length;
        return '<a href="#" class="set-item" style="text-decoration:none; color:inherit;" data-kp="' + (p.replace(/"/g, '&quot;')) + '" onclick="showPointsQuestions(this.getAttribute(\'data-kp\')); return false;">' + p.replace(/</g, '&lt;') + ' <span class="tree-count">' + count + '</span></a>';
    }).join('');
}
function showPointsQuestions(kp) {
    if (!kp) return;
    var ids = store.getQuestionIdsByKnowledgePoints([kp]);
    document.getElementById('pointsQuestionsTitle').textContent = '考点「' + kp.replace(/</g, '&lt;') + '」共 ' + ids.length + ' 题';
    var list = ids.map(function(qid) { return store.getQuestion(qid); }).filter(Boolean);
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    document.getElementById('pointsQuestionsContent').innerHTML = list.map(function(q) {
        return '<div class="question-item"><span>' + esc(q.section) + '-' + esc(q.subcategory||'') + '</span> ' + esc((q.content||'').slice(0, 80)) + '… <button class="btn btn-info btn-sm" onclick="showQuestionDetail(\'' + q.id + '\')">题目详情</button> <button class="btn btn-primary btn-sm" data-kp="' + (kp.replace(/"/g, '&quot;')) + '" onclick="startPracticeByPoint(this.getAttribute(\'data-kp\'))">刷题</button></div>';
    }).join('');
    document.getElementById('pointsQuestions').style.display = 'block';
}
function startPracticeByPoint(kp) {
    if (!kp) return;
    var questions = store.getRandomQuestionsByKnowledgePoints([kp], 20);
    // 处理资料分析捆绑题型
    questions = expandZiliaoBlockQuestions(questions);
    if (!questions.length) { alert('该考点下暂无题目'); return; }
    var setNames = {}; store.sets.forEach(function(s) { setNames[s.id] = s.name || ''; });
    try { sessionStorage.setItem('xingce_practice_session', JSON.stringify({ questions: questions, setNames: setNames, practiceMode: practiceMode })); } catch (e) { alert('无法保存'); return; }
    window.open('practice.html', '_blank');
}
function clearAllCache() {
    if (!confirm('将清除所有题目的正确率、做题次数及历史做题记录，是否继续？\n\n注意：此操作仅影响普通用户数据，不会影响管理员题库数据或GitHub数据。')) return;
    // 只操作普通用户的store，不操作adminStore
    store.sets.forEach(function(set) {
        MAIN_SECTIONS.forEach(function(sec) {
            (set[sec] || []).forEach(function(qid) {
                var q = store.getQuestion(qid);
                if (q) { q.correctCount = 0; q.totalAttempts = 0; q.done = false; }
            });
        });
    });
    store.save();
    saveHistory([]);
    renderTree(); renderHistoryList(); renderWrongList();
    showMsg('dataStatus', '已清除所有缓存（仅影响普通用户数据）', 'success');
}
function resetAllDataAndCache() {
    var input = document.getElementById('resetConfirmInput');
    var val = (input && input.value || '').trim();
    if (val !== '确认') {
        showMsg('dataStatus', '请输入「确认」二字后再点击重置', 'error');
        return;
    }
    if (!confirm('确定要重置所有普通用户数据吗？\n\n注意：此操作仅影响普通用户数据，不会影响管理员题库数据（adminStore）或GitHub数据。')) {
        return;
    }
    var keysToRemove = [];
    try {
        // 只删除普通用户的localStorage，不删除管理员相关的
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf('xingce_') === 0 && k.indexOf('xingce_admin_') !== 0 && k.indexOf('xingce_github_token') !== 0) {
                keysToRemove.push(k);
            }
        }
        keysToRemove.forEach(function(k) { localStorage.removeItem(k); });
        keysToRemove = [];
        // 只删除普通用户的sessionStorage，不删除管理员相关的
        for (var j = 0; j < sessionStorage.length; j++) {
            var k = sessionStorage.key(j);
            if (k && k.indexOf('xingce_') === 0 && k.indexOf('xingce_admin_') !== 0) {
                keysToRemove.push(k);
            }
        }
        keysToRemove.forEach(function(k) { sessionStorage.removeItem(k); });
    } catch (e) {}
    // 只重置普通用户的store，不重置adminStore
    store.sets = [];
    store.questions = {};
    store.save();
    if (input) input.value = '';
    rebuildSubcategoriesFromStore();
    renderTree();
    fillSetSelects();
    fillCategorySelects();
    renderCategoryList();
    filterSetList();
    updateManageSub();
    updatePracticeSub();
    renderPracticePointsCheckboxes();
    checkExportState();
    renderWrongList();
    renderFavoritesTab();
    renderHistoryList();
    if (document.getElementById('tab-profile').classList.contains('active')) renderProfileTab();
    showMsg('dataStatus', '已重置：所有普通用户题目、套卷及浏览器缓存已删除（管理员数据和GitHub数据不受影响）', 'success');
}

function renderTree() {
    var stats = store.getMergedStats();
    var total = (store.getUniqueAllQuestionIds ? store.getUniqueAllQuestionIds() : store.getAllQuestionIds()).length;
    var container = document.getElementById('statsContent');
    if (total === 0) { container.innerHTML = '<div class="empty-state"><i class="fas fa-chart-pie"></i><p>暂无统计数据</p></div>'; return; }
    var html = '<ul class="tree-node">';
    MAIN_SECTIONS.forEach(function(section) {
        var subCounts = stats[section] || {};
        var sectionTotal = Object.keys(subCounts).reduce(function(a, k) { return a + subCounts[k]; }, 0);
        if (sectionTotal === 0) return;
        var subs = Object.keys(subCounts).sort(function(a, b) { return String(a).localeCompare(String(b)); });
        html += '<li class="tree-node collapsed"><div class="tree-toggle"><i class="fas fa-chevron-right"></i><i class="fas fa-chevron-down"></i><span>' + section + '</span><span class="tree-count">' + sectionTotal + '</span></div><ul class="tree-children">';
        subs.forEach(function(sub) { html += '<li class="tree-leaf"><span>' + sub + '</span><span class="tree-count">' + subCounts[sub] + '</span></li>'; });
        html += '</ul></li>';
    });
    html += '<li class="tree-leaf" style="margin-top:8px; font-weight:bold;"><span>题目总数（去重后）</span><span class="tree-count" style="background: var(--accent-color);">' + total + '</span></li></ul>';
    container.innerHTML = html;
    bindTreeToggles();
    renderDuplicates();
}
function renderDuplicates() {
    var container = document.getElementById('duplicatesContent');
    if (!container) return;
    var groups = store.getDuplicateGroups ? store.getDuplicateGroups() : {};
    var keys = Object.keys(groups);
    if (!keys.length) { container.innerHTML = '<p style="color:var(--text-secondary);">暂无重复题目</p>'; return; }
    var html = '<div style="margin-bottom:8px;"><strong>共 ' + keys.length + ' 组重复</strong></div><ul style="list-style:none; padding:0;">';
    keys.forEach(function(fp, idx) {
        var items = groups[fp];
        html += '<li style="margin-bottom:16px; padding:12px; background:var(--light-bg); border-radius:var(--border-radius); border:1px solid var(--border-color);">';
        html += '<div style="font-weight:600; margin-bottom:8px; color:var(--primary-color);">重复组 ' + (idx + 1) + '（' + items.length + ' 题）</div>';
        items.forEach(function(x) {
            var q = store.getQuestion(x.qid);
            var brief = q ? ((q.content || '').slice(0, 60) + ((q.content || '').length > 60 ? '…' : '')) : '';
            html += '<div style="margin-left:12px; margin-bottom:8px; cursor:pointer;" onclick="showQuestionDetail(\'' + x.qid + '\')" title="点击查看题目详情">';
            html += '<span style="font-size:0.85rem; color:var(--text-secondary);">' + (x.setName || '').replace(/</g, '&lt;') + ' · ' + (x.section || '') + (x.subcategory ? '-' + x.subcategory : '') + '</span><br>';
            html += '<span style="font-size:0.9rem;">' + (brief || '').replace(/</g, '&lt;') + '</span></div>';
        });
        html += '</li>';
    });
    html += '</ul>';
    container.innerHTML = html;
}
function bindTreeToggles() {
    var container = document.getElementById('statsContent');
    if (!container) return;
    if (window._onTreeClick) container.removeEventListener('click', window._onTreeClick);
    window._onTreeClick = function(e) {
        var toggle = e.target.closest('.tree-toggle');
        if (!toggle) return;
        var node = toggle.closest('li.tree-node');
        if (!node) return;
        e.preventDefault();
        node.classList.toggle('collapsed');
    };
    container.addEventListener('click', window._onTreeClick);
}

function getAdminSectionAliases() {
    try { return JSON.parse(localStorage.getItem('xingce_admin_section_alias') || '{}') || {}; } catch (e) { return {}; }
}
function saveAdminSectionAliases(obj) {
    try { localStorage.setItem('xingce_admin_section_alias', JSON.stringify(obj || {})); } catch (e) {}
}
function adminRenderSectionAliasEditor() {
    var wrap = document.getElementById('adminSectionAliasEditor');
    if (!wrap) return;
    var aliases = getAdminSectionAliases();
    wrap.innerHTML = MAIN_SECTIONS.map(function(sec) {
        var v = aliases[sec] || '';
        return '<div style="background:var(--surface); border:1px solid var(--border-color); border-radius:var(--border-radius); padding:10px;">' +
            '<div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:6px;">' + sec + '</div>' +
            '<input type="text" data-sec="' + sec.replace(/"/g, '&quot;') + '" value="' + (v || '') + '" placeholder="留空则使用默认名称" style="width:100%; padding:10px; border:1px solid var(--border-color); border-radius:var(--border-radius);">' +
        '</div>';
    }).join('');
}
function adminSaveSectionAliases() {
    var wrap = document.getElementById('adminSectionAliasEditor');
    if (!wrap) return;
    var obj = {};
    wrap.querySelectorAll('input[data-sec]').forEach(function(inp) {
        var sec = inp.getAttribute('data-sec');
        var val = (inp.value || '').trim();
        if (val) obj[sec] = val;
    });
    saveAdminSectionAliases(obj);
    showMsg('adminSectionAliasStatus', '已保存展示名称', 'success');
    renderAdminStatsTree();
}
function adminResetSectionAliases() {
    saveAdminSectionAliases({});
    adminRenderSectionAliasEditor();
    showMsg('adminSectionAliasStatus', '已还原默认展示名称', 'success');
    renderAdminStatsTree();
}

function adminComputeStats() {
    var tree = {};
    MAIN_SECTIONS.forEach(function(s) { tree[s] = {}; });
    if (!adminStore || !adminStore.sets || !adminStore.questions) return { tree: tree, total: 0 };
    var qidSet = {};
    adminStore.sets.forEach(function(set) {
        MAIN_SECTIONS.forEach(function(section) {
            (set[section] || []).forEach(function(qid) {
                qidSet[qid] = true;
                var q = adminStore.questions[qid];
                if (!q) return;
                var sub = q.subcategory || q.section || section;
                tree[section][sub] = (tree[section][sub] || 0) + 1;
            });
        });
    });
    return { tree: tree, total: Object.keys(qidSet).length };
}
function bindAdminTreeToggles() {
    var container = document.getElementById('adminStatsContent');
    if (!container) return;
    if (window._onAdminTreeClick) container.removeEventListener('click', window._onAdminTreeClick);
    window._onAdminTreeClick = function(e) {
        var toggle = e.target.closest('.tree-toggle');
        if (!toggle) return;
        var node = toggle.closest('li.tree-node');
        if (!node) return;
        e.preventDefault();
        node.classList.toggle('collapsed');
    };
    container.addEventListener('click', window._onAdminTreeClick);
}
function renderAdminStatsTree() {
    var container = document.getElementById('adminStatsContent');
    if (!container) return;
    var st = adminComputeStats();
    var stats = st.tree;
    var total = st.total;
    var aliases = getAdminSectionAliases();
    var order = (typeof ADMIN_STATS_ORDER !== 'undefined' && ADMIN_STATS_ORDER.length) ? ADMIN_STATS_ORDER.slice() : MAIN_SECTIONS.slice();
    (MAIN_SECTIONS || []).forEach(function(s) { if (order.indexOf(s) === -1) order.push(s); });
    var predefinedSubs = (typeof ADMIN_STATS_SUBS === 'object') ? ADMIN_STATS_SUBS : {};
    var html = '<ul class="tree-node">';
    order.forEach(function(section) {
        var subCounts = stats[section] || {};
        var sectionTotal = Object.keys(subCounts).reduce(function(a, k) { return a + subCounts[k]; }, 0);
        var baseSubs = predefinedSubs[section] || [];
        var extraSubs = Object.keys(subCounts).filter(function(k) { return baseSubs.indexOf(k) === -1; }).sort(function(a,b){ return String(a).localeCompare(String(b)); });
        var subs = baseSubs.concat(extraSubs);
        var label = aliases[section] || section;
        html += '<li class="tree-node collapsed"><div class="tree-toggle"><i class="fas fa-chevron-right"></i><i class="fas fa-chevron-down"></i><span>' + label + '</span><span class="tree-count">' + sectionTotal + '</span></div><ul class="tree-children">';
        subs.forEach(function(sub) { var cnt = subCounts[sub] || 0; html += '<li class="tree-leaf"><span>' + sub + '</span><span class="tree-count">' + cnt + '</span></li>'; });
        html += '</ul></li>';
    });
    html += '<li class="tree-leaf" style="margin-top:8px; font-weight:bold;"><span>题目总数</span><span class="tree-count" style="background: var(--accent-color);">' + total + '</span></li></ul>';
    container.innerHTML = html;
    bindAdminTreeToggles();
}

function getAdminSubcategoriesConfig() {
    try { return JSON.parse(localStorage.getItem('xingce_admin_subcategories') || '{}') || {}; } catch (e) { return {}; }
}
function saveAdminSubcategoriesConfig(obj) {
    try { localStorage.setItem('xingce_admin_subcategories', JSON.stringify(obj || {})); } catch (e) {}
}
function adminLoadSubcategoriesConfigIntoGlobal() {
    var cfg = getAdminSubcategoriesConfig();
    (MAIN_SECTIONS || []).forEach(function(sec) {
        var fromCfg = Array.isArray(cfg[sec]) ? cfg[sec] : [];
        var current = SUBCATEGORIES[sec] || [];
        if (fromCfg.length > 0) {
            var merged = fromCfg.slice();
            current.forEach(function(s) { if (merged.indexOf(s) === -1) merged.push(s); });
            SUBCATEGORIES[sec] = merged;
        }
    });
}
function adminPersistCurrentSubcategoriesConfig() {
    var cfg = {};
    MAIN_SECTIONS.forEach(function(sec) {
        cfg[sec] = (SUBCATEGORIES[sec] || []).slice();
    });
    saveAdminSubcategoriesConfig(cfg);
}

// 小类名称维护/合并：从 data 加载（与「从 data 加载」同源），不读 adminStore
var _adminSubcategoryPending = null;
var _adminSubcategoryDataCache = { questions: {} }; // 缓存从 data 合并后的题目，供合并目标列表使用
function adminRenderMainSectionsList() {
    var ul = document.getElementById('adminMainSectionsList');
    var statusEl = document.getElementById('adminMainSectionsStatus');
    if (!ul) return;
    var sections = MAIN_SECTIONS || [];
    ul.innerHTML = sections.map(function(sec) {
        var displayName = getSectionDisplayName(sec);
        var isDefault = DEFAULT_MAIN_SECTIONS && DEFAULT_MAIN_SECTIONS.indexOf(sec) !== -1;
        var delBtn = isDefault ? '' : ' <button type="button" class="btn btn-sm" style="margin-left:8px;" onclick="adminRemoveMainSection(\'' + (sec || '').replace(/'/g, "\\'") + '\')">删除</button>';
        return '<li style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border-color);"><span>' + (displayName || sec).replace(/</g, '&lt;') + ' <code style="font-size:0.85rem; color:var(--text-secondary);">' + (sec || '').replace(/</g, '&lt;') + '</code></span><span><button type="button" class="btn btn-sm btn-info" onclick="adminRenameMainSection(\'' + (sec || '').replace(/'/g, "\\'") + '\')">修改名称</button>' + delBtn + '</span></li>';
    }).join('');
    if (statusEl) statusEl.textContent = '';
}
function adminAddMainSection() {
    var input = document.getElementById('adminNewSectionName');
    var name = (input && input.value || '').trim();
    var statusEl = document.getElementById('adminMainSectionsStatus');
    if (!name) {
        if (statusEl) statusEl.textContent = '请输入新大类名称';
        if (statusEl) statusEl.className = 'status-message error';
        return;
    }
    if (MAIN_SECTIONS.indexOf(name) !== -1) {
        if (statusEl) statusEl.textContent = '该大类已存在';
        if (statusEl) statusEl.className = 'status-message error';
        return;
    }
    MAIN_SECTIONS.push(name);
    if (!SUBCATEGORIES[name]) SUBCATEGORIES[name] = [];
    SECTION_DISPLAY_NAMES[name] = name;
    saveMainSections(MAIN_SECTIONS);
    saveSectionDisplayNames();
    if (input) input.value = '';
    adminRenderMainSectionsList();
    refreshAllSectionSelects();
    if (statusEl) { statusEl.textContent = '已添加：' + name; statusEl.className = 'status-message success'; }
}
function adminRenameMainSection(sec) {
    var displayName = getSectionDisplayName(sec);
    var newName = prompt('修改「' + (displayName || sec) + '」的显示名称（仅影响界面显示，数据键不变）：', displayName || sec);
    if (newName == null || newName === '') return;
    newName = String(newName).trim();
    if (!newName) return;
    SECTION_DISPLAY_NAMES[sec] = newName;
    saveSectionDisplayNames();
    adminRenderMainSectionsList();
    refreshAllSectionSelects();
}
function adminRemoveMainSection(sec) {
    if (!sec || MAIN_SECTIONS.indexOf(sec) === -1) return;
    if (DEFAULT_MAIN_SECTIONS && DEFAULT_MAIN_SECTIONS.indexOf(sec) !== -1) return;
    if (!confirm('确定删除大类「' + (getSectionDisplayName(sec) || sec) + '」？将从列表中移除，不会删除已有题目数据。')) return;
    var idx = MAIN_SECTIONS.indexOf(sec);
    MAIN_SECTIONS.splice(idx, 1);
    saveMainSections(MAIN_SECTIONS);
    delete SECTION_DISPLAY_NAMES[sec];
    saveSectionDisplayNames();
    adminRenderMainSectionsList();
    refreshAllSectionSelects();
}
function adminLoadSubcategories() {
    var el = document.getElementById('adminSubcategoryList');
    if (!el) return;
    var section = (document.getElementById('adminSubcategorySection') && document.getElementById('adminSubcategorySection').value) || '言语理解';
    el.innerHTML = '<p style="color:var(--text-secondary); font-size:0.9rem;">正在从 data 加载…</p>';
    fetch(getDataFileUrl('files.json') + '?t=' + Date.now())
        .then(function(r) {
            if (!r.ok) throw new Error('files.json 未找到');
            return r.json();
        })
        .then(function(manifest) {
            var jsonFiles = Array.isArray(manifest && manifest.json) ? manifest.json : (manifest && manifest.json ? [manifest.json] : ['store.json']);
            jsonFiles = (jsonFiles || []).map(function(n) { return String(n || '').trim().replace(/^data\//i, ''); }).filter(Boolean);
            jsonFiles = jsonFiles.filter(function(p) {
                if (p === 'files.json' || p === 'users.json' || p === 'remark.json' || p === 'user.json') return false;
                if (/^user\//i.test(p)) return false;
                return /\.json$/i.test(p);
            });
            if (!jsonFiles.length) jsonFiles = ['store.json'];
            return Promise.all(jsonFiles.map(function(fileName) {
                return fetch(getDataFileUrl(fileName) + '?t=' + Date.now()).then(function(r) {
                    if (!r.ok) return null;
                    return r.json();
                });
            })).then(function(results) {
                var mergedQuestions = {};
                (results || []).forEach(function(data) {
                    if (!data || !data.questions) return;
                    Object.keys(data.questions).forEach(function(qid) {
                        if (data.questions[qid]) mergedQuestions[qid] = data.questions[qid];
                    });
                });
                _adminSubcategoryDataCache.questions = mergedQuestions;
                var counts = {};
                Object.keys(mergedQuestions).forEach(function(qid) {
                    var q = mergedQuestions[qid];
                    if (!q) return;
                    var sec = (q.section || q.category || '').trim();
                    if (sec !== section) return;
                    var sub = (q.subcategory || '').trim() || '未分类';
                    counts[sub] = (counts[sub] || 0) + 1;
                });
                var list = Object.keys(counts).map(function(name) { return { name: name, count: counts[name] }; });
                list.sort(function(a, b) {
                    if (b.count !== a.count) return b.count - a.count;
                    return String(a.name).localeCompare(String(b.name));
                });
                el.innerHTML = list.map(function(it) {
                    var name = (it.name || '').replace(/</g, '&lt;');
                    var nameRaw = (it.name || '').replace(/'/g, "\\'");
                    return '<span class="set-item" style="padding:8px 12px; display:inline-flex; align-items:center; gap:8px; border:1px solid var(--border-color); border-radius:var(--border-radius);">' +
                        '<span>' + name + '</span><span style="color:var(--text-secondary); font-size:0.9rem;">(' + it.count + ' 题)</span>' +
                        '<a href="javascript:void(0)" onclick="adminSubcategoryShowQuestionList(\'' + section.replace(/'/g, "\\'") + '\',\'' + nameRaw + '\')" style="font-size:0.9rem; color:var(--primary-color);">查看题目</a>' +
                        '<button type="button" class="btn btn-sm" style="padding:4px 8px; background:#e3f2fd;" onclick="adminSubcategoryShowRename(\'' + section.replace(/'/g, "\\'") + '\',\'' + nameRaw + '\')">重命名</button>' +
                        '<button type="button" class="btn btn-sm" style="padding:4px 8px; background:#f3e5f5;" onclick="adminSubcategoryShowMerge(\'' + section.replace(/'/g, "\\'") + '\',\'' + nameRaw + '\')">合并</button>' +
                        '</span>';
                }).join('');
                if (list.length === 0) el.innerHTML = '<p style="color:var(--text-secondary); font-size:0.9rem;">该大类暂无小类（请检查 data 目录下是否有题库 JSON 文件）</p>';
            });
        })
        .catch(function(err) {
            el.innerHTML = '<p style="color:#dc3545; font-size:0.9rem;">加载失败：' + (err && err.message || '未知错误') + '。请通过 HTTP 访问（非 file://）</p>';
        });
}

// 知识管理：data/zhishikaodian/ 文件夹，每小类一个 JSON
var _adminKnowledgeDataCache = { questions: {} };
var _adminKnowledgeQuill = null;
// 每页内容保存为 HTML（富文本编辑器的内容）；Markdown 仅作为可选输入方式
var _adminKnowledgePages = [''];
var _adminKnowledgePageTitles = [''];
var _adminKnowledgeCurrentPageIndex = 0;
var SLUG_MAP = { '逻辑填空':'luojitiankong','中心理解':'zhongxinlijie','语句表达':'yujubiaoda','篇章阅读':'pianzhangyuedu','图形推理':'tuxingtuili','定义判断':'dingyipanduan','类比推理':'leibituili','逻辑判断':'luojipanduan','数字推理':'shuzituili','数学运算':'shuxueyunsuan','未分类':'other' };
function toSlug(s) { return (SLUG_MAP[s] || (s || '').replace(/[\u4e00-\u9fa5]/g, function(c){ var x = {'逻':'luo','辑':'ji','填':'tian','空':'kong','中':'zhong','心':'xin','理':'li','解':'jie','语':'yu','句':'ju','表':'biao','达':'da','篇':'pian','章':'zhang','阅':'yue','读':'du','图':'tu','形':'xing','推':'tui','定':'ding','义':'yi','判':'pan','断':'duan','类':'lei','比':'bi','数':'shu','字':'zi','学':'xue','运':'yun','算':'suan','未':'wei','分':'fen','类':'lei'}; return x[c] || c; }).replace(/[^a-z0-9]/gi,'').toLowerCase() || 'note'); }
function getZhishikaodianUrl(path) { return getDataFileUrl('zhishikaodian/' + (path || '')); }
function adminKnowledgeLoadSubcategories() {
    var section = (document.getElementById('adminKnowledgeSection') && document.getElementById('adminKnowledgeSection').value) || '言语理解';
    var sel = document.getElementById('adminKnowledgeSubcategory');
    if (!sel) return;
    sel.innerHTML = '<option value="">加载中…</option>';
    fetch(getDataFileUrl('files.json') + '?t=' + Date.now())
        .then(function(r) { if (!r.ok) throw new Error('files.json 未找到'); return r.json(); })
        .then(function(manifest) {
            var jsonFiles = Array.isArray(manifest && manifest.json) ? manifest.json : (manifest && manifest.json ? [manifest.json] : ['store.json']);
            jsonFiles = (jsonFiles || []).map(function(n) { return String(n || '').trim().replace(/^data\//i, ''); }).filter(Boolean);
            jsonFiles = jsonFiles.filter(function(p) {
                if (p === 'files.json' || p === 'users.json' || p === 'remark.json' || p === 'user.json') return false;
                if (/^zhishikaodian\//i.test(p) || /^user\//i.test(p)) return false;
                return /\.json$/i.test(p);
            });
            if (!jsonFiles.length) jsonFiles = ['store.json'];
            return Promise.all(jsonFiles.map(function(f) { return fetch(getDataFileUrl(f) + '?t=' + Date.now()).then(function(r) { return r.ok ? r.json() : null; }); }))
                .then(function(results) {
                    var merged = {};
                    (results || []).forEach(function(data) {
                        if (data && data.questions) Object.keys(data.questions).forEach(function(qid) { if (data.questions[qid]) merged[qid] = data.questions[qid]; });
                    });
                    _adminKnowledgeDataCache.questions = merged;
                    var counts = {};
                    Object.keys(merged).forEach(function(qid) {
                        var q = merged[qid];
                        if (!q) return;
                        var sec = (q.section || q.category || '').trim();
                        if (sec !== section) return;
                        var sub = (q.subcategory || '').trim() || '未分类';
                        counts[sub] = (counts[sub] || 0) + 1;
                    });
                    var list = Object.keys(counts).sort(function(a,b){ return String(a).localeCompare(String(b)); });
                    sel.innerHTML = '<option value="">选择小类</option>' + list.map(function(n){ return '<option value="'+ (n||'').replace(/"/g,'&quot;') +'">'+ (n||'').replace(/</g,'&lt;') +'</option>'; }).join('');
                    adminKnowledgeLoadNote();
                });
        })
        .catch(function(err) { sel.innerHTML = '<option value="">加载失败</option>'; });
}
function adminKnowledgeInitQuill() {
    var el = document.getElementById('adminKnowledgeNoteEditor');
    if (!el || _adminKnowledgeQuill) return;
    _adminKnowledgeQuill = new Quill(el, {
        theme: 'snow',
        modules: {
            toolbar: [
                [{ 'header': [1, 2, 3, false] }, { 'size': ['small', false, 'large', 'huge'] }],
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'color': [] }, { 'background': [] }],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                ['blockquote', 'code-block'],
                ['link', 'image'],
                ['clean']
            ]
        }
    });
}
function adminKnowledgeGetQuillHtml() {
    if (!_adminKnowledgeQuill) return '';
    var root = _adminKnowledgeQuill.root;
    return root.innerHTML || '';
}
function adminKnowledgeSetQuillHtml(html) {
    if (!_adminKnowledgeQuill) return;
    _adminKnowledgeQuill.root.innerHTML = html || '';
}
function adminKnowledgeSaveCurrentToPages() {
    if (_adminKnowledgePages.length > _adminKnowledgeCurrentPageIndex && _adminKnowledgeQuill) {
        _adminKnowledgePages[_adminKnowledgeCurrentPageIndex] = _adminKnowledgeQuill.root.innerHTML || '';
    }
}
function adminKnowledgeUpdateCurrentPageTitle() {
    var input = document.getElementById('adminKnowledgePageTitleInput');
    if (!input) return;
    if (!_adminKnowledgePageTitles) _adminKnowledgePageTitles = [];
    _adminKnowledgePageTitles[_adminKnowledgeCurrentPageIndex] = (input.value || '').trim();
    adminKnowledgeRenderPageTabs();
}
function adminKnowledgeSyncPageTitleInput() {
    var input = document.getElementById('adminKnowledgePageTitleInput');
    if (!input) return;
    var t = (_adminKnowledgePageTitles && _adminKnowledgePageTitles[_adminKnowledgeCurrentPageIndex]) || '';
    input.value = t;
}
function adminKnowledgeAddPage() {
    adminKnowledgeSaveCurrentToPages();
    _adminKnowledgePages.push('');
    if (!_adminKnowledgePageTitles) _adminKnowledgePageTitles = [];
    _adminKnowledgePageTitles.push('');
    _adminKnowledgeCurrentPageIndex = _adminKnowledgePages.length - 1;
    adminKnowledgeRenderPageTabs();
    adminKnowledgeSetQuillHtml('');
    adminKnowledgeSyncPageTitleInput();
}
function adminKnowledgeRemovePage(idx) {
    if (_adminKnowledgePages.length <= 1) return;
    adminKnowledgeSaveCurrentToPages();
    _adminKnowledgePages.splice(idx, 1);
    if (_adminKnowledgePageTitles && _adminKnowledgePageTitles.length) _adminKnowledgePageTitles.splice(idx, 1);
    if (_adminKnowledgeCurrentPageIndex >= _adminKnowledgePages.length) _adminKnowledgeCurrentPageIndex = Math.max(0, _adminKnowledgePages.length - 1);
    adminKnowledgeRenderPageTabs();
    adminKnowledgeSetQuillHtml(_adminKnowledgePages[_adminKnowledgeCurrentPageIndex] || '');
    adminKnowledgeSyncPageTitleInput();
}
function adminKnowledgeSwitchPage(idx) {
    adminKnowledgeSaveCurrentToPages();
    _adminKnowledgeCurrentPageIndex = idx;
    adminKnowledgeRenderPageTabs();
    adminKnowledgeSetQuillHtml(_adminKnowledgePages[idx] || '');
    adminKnowledgeSyncPageTitleInput();
}
function adminKnowledgeRenderPageTabs() {
    var el = document.getElementById('adminKnowledgePageTabs');
    if (!el) return;
    el.innerHTML = _adminKnowledgePages.map(function(_, i) {
        var active = i === _adminKnowledgeCurrentPageIndex;
        var canDel = _adminKnowledgePages.length > 1;
        var title = (_adminKnowledgePageTitles && _adminKnowledgePageTitles[i]) ? _adminKnowledgePageTitles[i] : ('页面' + (i + 1));
        return '<button type="button" class="btn btn-sm ' + (active ? 'btn-primary' : '') + '" style="' + (active ? '' : 'background:var(--light-bg); border:1px solid var(--border-color);') + '" onclick="adminKnowledgeSwitchPage(' + i + ')">' + (title || ('页面' + (i + 1))).replace(/</g,'&lt;') + '</button>' +
            (canDel ? '<button type="button" class="btn btn-sm" style="padding:4px 8px; color:#dc3545; background:transparent; border:none;" onclick="event.stopPropagation(); adminKnowledgeRemovePage(' + i + ')" title="删除此页面"><i class="fas fa-times"></i></button>' : '');
    }).join('');
}
function adminKnowledgeLoadNote() {
    var section = (document.getElementById('adminKnowledgeSection') && document.getElementById('adminKnowledgeSection').value) || '言语理解';
    var sub = (document.getElementById('adminKnowledgeSubcategory') && document.getElementById('adminKnowledgeSubcategory').value) || '';
    var wrap = document.getElementById('adminKnowledgeNoteWrap');
    var fileInput = document.getElementById('adminKnowledgeFileName');
    if (!wrap) return;
    if (!sub) { wrap.style.display = 'none'; _adminKnowledgeQuill = null; return; }
    wrap.style.display = 'block';
    adminKnowledgeInitQuill();
    var slug = toSlug(sub);
    if (fileInput) fileInput.placeholder = slug + '.json';
    fetch(getZhishikaodianUrl('manifest.json') + '?t=' + Date.now())
        .then(function(r) { return r.ok ? r.json() : { topics: {}, updatedAt: '' }; })
        .catch(function() { return { topics: {}, updatedAt: '' }; })
        .then(function(manifest) {
            var key = section + '-' + sub;
            var files = (manifest.topics || {})[key];
            if (!files || !files.length) {
                _adminKnowledgePages = [''];
                _adminKnowledgePageTitles = [''];
                _adminKnowledgeCurrentPageIndex = 0;
                adminKnowledgeRenderPageTabs();
                adminKnowledgeSetQuillHtml('');
                adminKnowledgeSyncPageTitleInput();
                return;
            }
            return Promise.all((files || []).map(function(f) { return fetch(getZhishikaodianUrl(f) + '?t=' + Date.now()).then(function(r) { return r.ok ? r.json() : null; }); }))
                .then(function(parts) {
                    var byPage = {};
                    var titleByPage = {};
                    (parts || []).filter(Boolean).forEach(function(p) {
                        var pageNum = p.page != null ? p.page : 1;
                        var partNum = p.part != null ? p.part : 1;
                        if (!byPage[pageNum]) byPage[pageNum] = [];
                        byPage[pageNum].push({ part: partNum, content: p.content || '' });
                        if (p.title != null && String(p.title).trim()) {
                            titleByPage[pageNum] = String(p.title).trim();
                        }
                    });
                    var pageNums = Object.keys(byPage).map(Number).sort(function(a,b){ return a - b; });
                    _adminKnowledgePages = pageNums.map(function(n) {
                        var arr = byPage[n].sort(function(a,b){ return a.part - b.part; });
                        return arr.map(function(x){ return x.content; }).join('');
                    });
                    _adminKnowledgePageTitles = pageNums.map(function(n) { return titleByPage[n] || ''; });
                    if (_adminKnowledgePages.length === 0) _adminKnowledgePages = [''];
                    _adminKnowledgeCurrentPageIndex = 0;
                    adminKnowledgeRenderPageTabs();
                    adminKnowledgeSetQuillHtml(_adminKnowledgePages[0] || '');
                    adminKnowledgeSyncPageTitleInput();
                });
        })
        .catch(function() {
            _adminKnowledgePages = [''];
            _adminKnowledgePageTitles = [''];
            _adminKnowledgeCurrentPageIndex = 0;
            adminKnowledgeRenderPageTabs();
            adminKnowledgeSetQuillHtml('');
            adminKnowledgeSyncPageTitleInput();
        });
}
function adminKnowledgeGetCurrent() {
    var section = (document.getElementById('adminKnowledgeSection') && document.getElementById('adminKnowledgeSection').value) || '言语理解';
    var sub = (document.getElementById('adminKnowledgeSubcategory') && document.getElementById('adminKnowledgeSubcategory').value) || '';
    var fn = (document.getElementById('adminKnowledgeFileName') && document.getElementById('adminKnowledgeFileName').value || '').trim();
    var baseName = fn ? fn.replace(/\.json$/i, '') : toSlug(sub);
    return { section: section, subcategory: sub, baseName: baseName };
}
function processLatexInHtml(html) {
    if (!html) return '';
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    var LATEX_API = 'https://latex.codecogs.com/svg.image?';
    var re = /\$\$([\s\S]*?)\$\$|\$([^$]+)\$/g;
    return html.replace(re, function(m, d, i) {
        var raw = (d || i || '').trim().replace(/\s+/g, ' ');
        if (!raw) return m;
        try {
            var url = LATEX_API + encodeURIComponent('\\displaystyle ' + raw);
            return '<img src="' + url + '" style="max-width:100%;vertical-align:middle;margin:0 4px;" />';
        } catch (e) { return esc(m); }
    });
}

// 极简 Markdown 转 HTML：支持标题、段落、列表、图片与 LaTeX 协同
function markdownToHtml(md) {
    if (!md) return '';
    var text = String(md || '').replace(/\r\n?/g, '\n');
    var lines = text.split('\n');
    var html = [];
    var inUl = false, inOl = false;
    function closeLists() {
        if (inUl) { html.push('</ul>'); inUl = false; }
        if (inOl) { html.push('</ol>'); inOl = false; }
    }
    function processInline(s) {
        if (!s) return '';
        // 图片：![](url) 或 ![alt](url)
        s = s.replace(/!\[[^\]]*]\(([^)]+)\)/g, function(_, url) {
            return '<img src="' + url + '" style="max-width:100%;margin:8px 0;vertical-align:middle;" />';
        });
        return s;
    }
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var raw = line;
        line = line.replace(/\s+$/g, '');
        if (!line.trim()) {
            closeLists();
            continue;
        }
        // 标题
        var m = /^(#{1,6})\s+(.*)$/.exec(line);
        if (m) {
            closeLists();
            var level = m[1].length;
            var textPart = processInline(m[2]);
            html.push('<h' + level + '>' + textPart + '</h' + level + '>');
            continue;
        }
        // 无序列表
        m = /^[-*]\s+(.+)$/.exec(line);
        if (m) {
            if (!inUl) { closeLists(); html.push('<ul>'); inUl = true; }
            html.push('<li>' + processInline(m[1]) + '</li>');
            continue;
        }
        // 有序列表（1. 2.）
        m = /^(\d+)\.\s+(.+)$/.exec(line);
        if (m) {
            if (!inOl) { closeLists(); html.push('<ol>'); inOl = true; }
            html.push('<li>' + processInline(m[2]) + '</li>');
            continue;
        }
        // ①②… 列表：直接当作普通段落，字符本身已是有序标号
        m = /^([①②③④⑤⑥⑦⑧⑨⑩])\s*(.+)$/.exec(line);
        if (m) {
            closeLists();
            html.push('<p>' + m[1] + ' ' + processInline(m[2]) + '</p>');
            continue;
        }
        // 普通段落
        closeLists();
        html.push('<p>' + processInline(raw) + '</p>');
    }
    closeLists();
    return html.join('\n');
}

// 知识管理：Markdown 弹窗（仅作为可选输入方式，不影响富文本工具栏）
function adminKnowledgeOpenMarkdownModal() {
    var modal = document.getElementById('adminKnowledgeMarkdownModal');
    var input = document.getElementById('adminKnowledgeMarkdownInput');
    if (!modal || !input) return;
    // 默认把当前富文本内容转为纯文本（作为起点），避免清空
    var html = adminKnowledgeGetQuillHtml();
    try {
        var tmp = document.createElement('div');
        tmp.innerHTML = html || '';
        input.value = (tmp.innerText || '').trim();
    } catch (e) {
        input.value = '';
    }
    var wrap = document.getElementById('adminKnowledgeMarkdownPreview');
    if (wrap) wrap.innerHTML = '<p style="color:#6c757d;">点击“预览”查看渲染效果</p>';
    modal.style.display = 'block';
}
function adminKnowledgeCloseMarkdownModal() {
    var modal = document.getElementById('adminKnowledgeMarkdownModal');
    if (modal) modal.style.display = 'none';
}
function adminKnowledgeRenderMarkdownPreview() {
    var input = document.getElementById('adminKnowledgeMarkdownInput');
    var wrap = document.getElementById('adminKnowledgeMarkdownPreview');
    if (!input || !wrap) return;
    var md = input.value || '';
    var html = markdownToHtml(md);
    var processed = processLatexInHtml(html || '');
    wrap.innerHTML = processed || '<p style="color:#6c757d;">暂无内容</p>';
    if (typeof renderLaTeXInElement === 'function') renderLaTeXInElement(wrap);
}
function adminKnowledgeApplyMarkdownToEditor() {
    var input = document.getElementById('adminKnowledgeMarkdownInput');
    if (!input) return;
    var md = input.value || '';
    var html = markdownToHtml(md);
    // 写入富文本编辑器（保留 LaTeX 源文本，保存/上传时再统一转公式图片）
    adminKnowledgeSetQuillHtml(html || '');
    adminKnowledgeSaveCurrentToPages();
    adminKnowledgeCloseMarkdownModal();
    showMsg('adminKnowledgeStatus', '已将 Markdown 转为富文本并写入当前页', 'success');
}
function splitContentBy800k(content) {
    var MAX = 800 * 1024;
    var overhead = 500;
    var utf8Len = function(s){ return unescape(encodeURIComponent(s || '')).length; };
    if (utf8Len(content) <= MAX - overhead) return [content];
    var chunks = [];
    var rest = content;
    while (rest && utf8Len(rest) > 0) {
        if (utf8Len(rest) <= MAX - overhead) { chunks.push(rest); break; }
        var idx = Math.floor((MAX - overhead) * 0.95);
        var cut = rest.substring(0, idx);
        var lastP = Math.max(cut.lastIndexOf('</p>'), cut.lastIndexOf('</div>'), cut.lastIndexOf('<br>'), cut.lastIndexOf('<br/>'));
        var splitAt = idx;
        if (lastP > idx * 0.5) {
            if (rest.substring(lastP, lastP + 4) === '</p>') splitAt = lastP + 4;
            else if (rest.substring(lastP, lastP + 6) === '</div>') splitAt = lastP + 6;
            else if (rest.substring(lastP, lastP + 4) === '<br>') splitAt = lastP + 4;
            else if (rest.substring(lastP, lastP + 5) === '<br/>') splitAt = lastP + 5;
            else splitAt = lastP + 1;
        }
        chunks.push(rest.substring(0, splitAt));
        rest = rest.substring(splitAt);
    }
    return chunks;
}
function adminKnowledgeSave() {
    var cur = adminKnowledgeGetCurrent();
    if (!cur.subcategory) { showMsg('adminKnowledgeStatus', '请先选择小类', 'error'); return; }
    adminKnowledgeSaveCurrentToPages();
    var files = [];
    var toDownload = [];
    _adminKnowledgePages.forEach(function(rawHtml, pageIdx) {
        var content = processLatexInHtml(rawHtml || '');
        var chunks = splitContentBy800k(content);
        chunks.forEach(function(chunk, chunkIdx) {
            var fn = pageIdx === 0 && chunks.length === 1 ? cur.baseName + '.json'
                : pageIdx === 0 ? cur.baseName + '_' + (chunkIdx + 1) + '.json'
                : chunks.length === 1 ? cur.baseName + '_p' + (pageIdx + 1) + '.json'
                : cur.baseName + '_p' + (pageIdx + 1) + '_' + (chunkIdx + 1) + '.json';
            files.push(fn);
            var title = (_adminKnowledgePageTitles && _adminKnowledgePageTitles[pageIdx]) ? _adminKnowledgePageTitles[pageIdx] : '';
            toDownload.push({ name: fn, content: JSON.stringify({ section: cur.section, subcategory: cur.subcategory, title: title, content: chunk, page: pageIdx + 1, part: chunkIdx + 1, updatedAt: new Date().toISOString() }, null, 2) });
        });
    });
    var manifest = { topics: {}, updatedAt: new Date().toISOString() };
    manifest.topics[cur.section + '-' + cur.subcategory] = files;
    fetch(getZhishikaodianUrl('manifest.json') + '?t=' + Date.now())
        .then(function(r) { return r.ok ? r.json() : { topics: {}, updatedAt: '' }; })
        .catch(function() { return { topics: {}, updatedAt: '' }; })
        .then(function(existing) {
            var topics = existing.topics || {};
            topics[cur.section + '-' + cur.subcategory] = files;
            manifest.topics = topics;
            manifest.updatedAt = new Date().toISOString();
            toDownload.unshift({ name: 'manifest.json', content: JSON.stringify(manifest, null, 2) });
            toDownload.forEach(function(item, idx) {
                var a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([item.content], { type: 'application/json' }));
                a.download = item.name;
                a.click();
                URL.revokeObjectURL(a.href);
            });
            showMsg('adminKnowledgeStatus', '已生成 ' + toDownload.length + ' 个文件下载，请放入 data/zhishikaodian/ 文件夹', 'success');
        });
}
function adminKnowledgeUploadToGitHub() {
    var cur = adminKnowledgeGetCurrent();
    if (!cur.subcategory) { showMsg('adminKnowledgeStatus', '请先选择小类', 'error'); return; }
    if (!(GITHUB_CONFIG && GITHUB_CONFIG.token && GITHUB_CONFIG.owner && GITHUB_CONFIG.repo)) {
        showMsg('adminKnowledgeStatus', '请先配置 GitHub Token', 'error');
        return;
    }
    adminKnowledgeSaveCurrentToPages();
    var files = [];
    var toUpload = [];
    _adminKnowledgePages.forEach(function(rawHtml, pageIdx) {
        var content = processLatexInHtml(rawHtml || '');
        var chunks = splitContentBy800k(content);
        chunks.forEach(function(chunk, chunkIdx) {
            var fn = pageIdx === 0 && chunks.length === 1 ? cur.baseName + '.json'
                : pageIdx === 0 ? cur.baseName + '_' + (chunkIdx + 1) + '.json'
                : chunks.length === 1 ? cur.baseName + '_p' + (pageIdx + 1) + '.json'
                : cur.baseName + '_p' + (pageIdx + 1) + '_' + (chunkIdx + 1) + '.json';
            files.push(fn);
            var title = (_adminKnowledgePageTitles && _adminKnowledgePageTitles[pageIdx]) ? _adminKnowledgePageTitles[pageIdx] : '';
            toUpload.push({ fn: fn, payload: JSON.stringify({ section: cur.section, subcategory: cur.subcategory, title: title, content: chunk, page: pageIdx + 1, part: chunkIdx + 1, updatedAt: new Date().toISOString() }, null, 2) });
        });
    });
    var branch = GITHUB_CONFIG.branch || 'main';
    var headers = { 'Authorization': 'token ' + GITHUB_CONFIG.token, 'Accept': 'application/vnd.github.v3+json' };
    var baseApi = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/data/zhishikaodian/';
    function putFile(path, content) {
        var url = baseApi + path;
        function doPut(sha) {
            var body = { message: '知识管理 - ' + path, content: btoa(unescape(encodeURIComponent(content))), branch: branch };
            if (sha) body.sha = sha;
            return fetch(url, { method: 'PUT', headers: headers, body: JSON.stringify(body) });
        }
        return fetch(url + '?ref=' + branch + '&_=' + Date.now(), { method: 'GET', headers: headers, cache: 'no-store' })
            .then(function(r) { return r.status === 404 ? null : (r.ok ? r.json() : r.json().then(function(e){ throw new Error(e.message); })); })
            .then(function(info) {
                return doPut(info && info.sha).then(function(resp) {
                    if (resp.ok) return resp.json();
                    return resp.json().then(function(err) {
                        var msg = (err && err.message) ? err.message : '';
                        var isShaMismatch = resp.status === 409 || /does not match/i.test(msg);
                        if (!isShaMismatch) throw new Error(msg);
                        return fetch(url + '?ref=' + branch + '&_=' + Date.now(), { method: 'GET', headers: headers, cache: 'no-store' })
                            .then(function(r2) { return r2.ok ? r2.json() : r2.json().then(function(e){ throw new Error(e.message); }); })
                            .then(function(latest) { return doPut(latest && latest.sha); })
                            .then(function(r3) {
                                if (!r3.ok) return r3.json().then(function(e){ throw new Error(e.message); });
                                return r3.json();
                            });
                    });
                });
            });
    }
    showMsg('adminKnowledgeStatus', '正在上传…', 'info');
    fetch(getZhishikaodianUrl('manifest.json') + '?t=' + Date.now())
        .then(function(r) { return r.ok ? r.json() : { topics: {}, updatedAt: '' }; })
        .catch(function() { return { topics: {}, updatedAt: '' }; })
        .then(function(existing) {
            var topics = existing.topics || {};
            topics[cur.section + '-' + cur.subcategory] = files;
            var manifest = { topics: topics, updatedAt: new Date().toISOString() };
            var manifestStr = JSON.stringify(manifest, null, 2);
            var promises = [putFile('manifest.json', manifestStr)];
            toUpload.forEach(function(item) { promises.push(putFile(item.fn, item.payload)); });
            return Promise.all(promises);
        })
        .then(function() {
            showMsg('adminKnowledgeStatus', '已上传到 GitHub', 'success');
        })
        .catch(function(err) {
            showMsg('adminKnowledgeStatus', '上传失败：' + (err && err.message || '未知'), 'error');
        });
}
function adminKnowledgePreview() {
    var cur = adminKnowledgeGetCurrent();
    if (!cur.subcategory) { showMsg('adminKnowledgeStatus', '请先选择小类', 'error'); return; }
    var html = adminKnowledgeGetQuillHtml();
    var processed = processLatexInHtml(html || '');
    var wrap = document.getElementById('adminKnowledgePreviewContent');
    var modal = document.getElementById('adminKnowledgePreviewModal');
    if (wrap) wrap.innerHTML = processed || '<p style="color:#6c757d;">暂无内容</p>';
    if (typeof renderLaTeXInElement === 'function' && wrap) renderLaTeXInElement(wrap);
    if (modal) modal.style.display = 'block';
}

function adminSubcategoryShowQuestionList(section, subName) {
    var qs = _adminSubcategoryDataCache.questions || {};
    var list = [];
    Object.keys(qs).forEach(function(qid) {
        var q = qs[qid];
        if (!q) return;
        var sec = (q.section || q.category || '').trim();
        var sub = (q.subcategory || '').trim() || '未分类';
        if (sec === section && sub === subName) list.push({ id: qid, q: q });
    });
    list.sort(function(a, b) { return String(a.id).localeCompare(String(b.id)); });
    var titleEl = document.getElementById('adminSubcategoryQuestionListTitle');
    var bodyEl = document.getElementById('adminSubcategoryQuestionListBody');
    if (titleEl) titleEl.textContent = section + ' - ' + subName + '（共 ' + list.length + ' 题）';
    if (!bodyEl) return;
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    bodyEl.innerHTML = list.length === 0 ? '<p style="color:var(--text-secondary);">该小类下暂无题目</p>' : list.map(function(item, idx) {
        var q = item.q;
        var preview = (q.content || '').replace(/\s+/g, ' ').slice(0, 80);
        if ((q.content || '').length > 80) preview += '…';
        return '<div class="question-item" style="margin-bottom:12px; padding:12px; border:1px solid var(--border-color); border-radius:var(--border-radius);">' +
            '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">' +
            '<span style="color:var(--text-secondary); font-size:0.85rem;">' + (idx + 1) + '. ' + esc(preview) + '</span>' +
            '<a href="javascript:void(0)" onclick="adminSubcategoryShowQuestionDetail(\'' + (item.id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')" style="flex-shrink:0; font-size:0.9rem; color:var(--primary-color);">题目详情</a>' +
            '</div></div>';
    }).join('');
    document.getElementById('adminSubcategoryQuestionListModal').style.display = 'flex';
}
function adminSubcategoryShowQuestionDetail(qid) {
    var q = ( _adminSubcategoryDataCache.questions || {} )[qid];
    if (!q) return;
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function imgTag(src) { return '<img src="' + src + '" style="max-width:100%; margin:6px 0;" />'; }
    var materialHtml = (q.material ? '<p>' + esc(q.material) + '</p>' : '') + (q.materialImages || []).map(imgTag).join('');
    var stemHtml = esc(q.content || '') + (q.stemImages || []).map(imgTag).join('');
    var optHtml = (q.options || []).map(function(o) {
        var c = o.label === q.answer ? 'correct' : '';
        return '<div class="option ' + c + '"><span class="option-label">' + o.label + '.</span> ' + esc(o.text) + (o.images || []).map(imgTag).join('') + '</div>';
    }).join('');
    var html = '<div class="page-question-header">【' + esc(q.section) + '-' + esc(q.subcategory || q.section) + '】</div>' +
        (materialHtml ? '<div style="margin-bottom:12px;">' + materialHtml + '</div>' : '') +
        '<div class="question-content">' + stemHtml + '</div>' +
        '<div class="options-grid" style="margin-top:12px;">' + optHtml + '</div>' +
        (q.explanation ? '<div class="answer-block" style="margin-top:12px;">解析：<div class="explanation-body">' + explanationToHtml(q.explanation) + '</div></div>' : '');
    var bodyEl = document.getElementById('adminSubcategoryQuestionDetailBody');
    if (bodyEl) { bodyEl.innerHTML = html; renderLaTeXInElement(bodyEl); }
    document.getElementById('adminSubcategoryQuestionDetailModal').style.display = 'block';
}
function adminSubcategoryShowRename(section, oldName) {
    _adminSubcategoryPending = { type: 'rename', section: section, oldName: oldName };
    document.getElementById('adminSubcategoryModalTitle').textContent = '重命名小类';
    document.getElementById('adminSubcategoryModalBody').innerHTML =
        '<p style="margin-bottom:8px;">原小类：<strong>' + (oldName || '').replace(/</g, '&lt;') + '</strong></p>' +
        '<label>新小类名称</label><input type="text" id="adminSubcategoryNewName" value="' + (oldName || '').replace(/"/g, '&quot;') + '" placeholder="输入新小类名称" style="width:100%; padding:10px; margin-top:5px; border:1px solid var(--border-color); border-radius:var(--border-radius);">';
    document.getElementById('adminSubcategoryModal').style.display = 'flex';
}

function adminSubcategoryShowMerge(section, fromName) {
    var list = [];
    var qs = _adminSubcategoryDataCache.questions || {};
    var counts = {};
    Object.keys(qs).forEach(function(qid) {
        var q = qs[qid];
        if (!q) return;
        var sec = (q.section || q.category || '').trim();
        if (sec !== section) return;
        var sub = (q.subcategory || '').trim() || '未分类';
        if (sub !== fromName) counts[sub] = (counts[sub] || 0) + 1;
    });
    list = Object.keys(counts).sort(function(a, b) { return String(a).localeCompare(String(b)); });
    _adminSubcategoryPending = { type: 'merge', section: section, oldName: fromName };
    var opts = list.length ? list.map(function(n) { return '<option value="' + (n || '').replace(/"/g, '&quot;') + '">' + (n || '').replace(/</g, '&lt;') + '</option>'; }).join('') : '<option value="">无可合并目标</option>';
    document.getElementById('adminSubcategoryModalTitle').textContent = '合并小类';
    document.getElementById('adminSubcategoryModalBody').innerHTML =
        '<p style="margin-bottom:8px;">将「<strong>' + (fromName || '').replace(/</g, '&lt;') + '</strong>」合并到：</p>' +
        '<select id="adminSubcategoryMergeTarget" style="width:100%; padding:10px; margin-top:5px; border:1px solid var(--border-color); border-radius:var(--border-radius);">' + opts + '</select>';
    document.getElementById('adminSubcategoryModal').style.display = 'flex';
}

function adminSubcategoryModalClose() {
    document.getElementById('adminSubcategoryModal').style.display = 'none';
    _adminSubcategoryPending = null;
}

function adminSubcategoryApply() {
    if (!_adminSubcategoryPending) { adminSubcategoryModalClose(); return; }
    var section = _adminSubcategoryPending.section;
    var oldName = _adminSubcategoryPending.oldName;
    var newName;
    if (_adminSubcategoryPending.type === 'merge') {
        newName = (document.getElementById('adminSubcategoryMergeTarget') && document.getElementById('adminSubcategoryMergeTarget').value) || '';
    } else {
        newName = (document.getElementById('adminSubcategoryNewName') && document.getElementById('adminSubcategoryNewName').value) || '';
    }
    newName = (newName || '').trim();
    if (!newName) {
        showMsg('adminSubcategoryStatus', '请输入或选择目标小类名称', 'error');
        return;
    }
    if (newName === oldName) {
        showMsg('adminSubcategoryStatus', '新旧名称一致，无需修改', 'error');
        return;
    }
    adminSubcategoryModalClose();
    adminSyncSubcategoryToDataFiles(section, oldName, newName);
}

// 将小类修改同步到 data 目录下各源 JSON 文件（chaoge2026.json、fenbi.json 等），就地更新题目
// 读取数据从当前题库地址（getDataFileUrl），与「从 data 加载」同源，不保存到 adminStore
function adminSyncSubcategoryToDataFiles(section, oldName, newName) {
    var hasGitHub = !!(GITHUB_CONFIG && GITHUB_CONFIG.token && GITHUB_CONFIG.owner && GITHUB_CONFIG.repo);
    var progressWrap = document.getElementById('adminSubcategoryProgressWrap');
    if (progressWrap) progressWrap.style.display = 'block';
    showMsg('adminSubcategoryStatus', '正在替换…', 'info');
    function updateSubcategoryProgress(current, total, currentFile) {
        var percent = total > 0 ? Math.round((current / total) * 100) : 0;
        var txt = document.getElementById('adminSubcategoryProgressText');
        var pct = document.getElementById('adminSubcategoryProgressPercent');
        var bar = document.getElementById('adminSubcategoryProgressBar');
        if (txt) txt.textContent = '正在替换：' + current + ' / ' + total + (currentFile ? ' (' + currentFile + ')' : '');
        if (pct) pct.textContent = percent + '%';
        if (bar) bar.style.width = percent + '%';
    }
    updateSubcategoryProgress(0, 0, '');
    // 从当前题库地址读取 files.json（与「从 data 加载」同源）
    fetch(getDataFileUrl('files.json') + '?t=' + Date.now())
        .then(function(r) {
            if (!r.ok) throw new Error('获取 files.json 失败: ' + r.status + '（请确保通过 HTTP 访问，非 file://）');
            return r.json();
        })
        .then(function(manifest) {
            var jsonFiles = Array.isArray(manifest && manifest.json) ? manifest.json : (manifest && manifest.json ? [manifest.json] : ['store.json']);
            jsonFiles = (jsonFiles || []).map(function(n) { return String(n || '').trim().replace(/^data\//i, ''); }).filter(Boolean);
            jsonFiles = jsonFiles.filter(function(p) {
                if (p === 'files.json' || p === 'users.json' || p === 'remark.json' || p === 'user.json') return false;
                if (/^user\//i.test(p)) return false;
                return /\.json$/i.test(p);
            });
            if (!jsonFiles.length) jsonFiles = ['store.json'];
            var total = jsonFiles.length;
            var updatedFiles = 0;
            var totalChanged = 0;
            var idx = 0;
            var headers = hasGitHub ? { 'Authorization': 'token ' + GITHUB_CONFIG.token, 'Accept': 'application/vnd.github.v3+json' } : null;
            var apiBase = hasGitHub ? ('https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/') : '';
            updateSubcategoryProgress(0, total, '');
            function processNext() {
                if (idx >= total) {
                    if (progressWrap) progressWrap.style.display = 'none';
                    if (!hasGitHub && totalChanged > 0) {
                        showMsg('adminSubcategoryStatus', '已修改 ' + totalChanged + ' 道题目（未配置 GitHub，无法推送；可在本地 data 目录查看）', 'info');
                    } else if (updatedFiles > 0) {
                        showMsg('adminSubcategoryStatus', '已更新 ' + updatedFiles + ' 个文件，共 ' + totalChanged + ' 道题目的小类', 'success');
                    } else if (totalChanged > 0 && !hasGitHub) {
                        showMsg('adminSubcategoryStatus', '已修改 ' + totalChanged + ' 道题目（未配置 GitHub，无法推送）', 'info');
                    } else if (totalChanged > 0) {
                        showMsg('adminSubcategoryStatus', '已修改 ' + totalChanged + ' 道题目，但推送到 GitHub 失败', 'error');
                    } else {
                        showMsg('adminSubcategoryStatus', '未找到需要更新的题目（请确认所选大类+小类在当前 data 文件中存在）', 'info');
                    }
                    adminLoadSubcategories();
                    if (typeof renderAdminStatsTree === 'function') renderAdminStatsTree();
                    return;
                }
                var fileName = jsonFiles[idx];
                var filePath = 'data/' + fileName;
                updateSubcategoryProgress(idx, total, fileName);
                idx++;
                // 从当前题库地址读取文件内容（与「从 data 加载」同源）
                fetch(getDataFileUrl(fileName) + '?t=' + Date.now())
                    .then(function(r) {
                        if (!r.ok) throw new Error('获取 ' + fileName + ' 失败: ' + r.status);
                        return r.json();
                    })
                    .then(function(data) {
                        if (!data || !data.questions || typeof data.questions !== 'object') return null;
                        var changed = 0;
                        Object.keys(data.questions).forEach(function(qid) {
                            var q = data.questions[qid];
                            if (!q) return;
                            var sec = (q.section || q.category || '').trim();
                            if (sec !== section) return;
                            var sub = (q.subcategory || '').trim() || '未分类';
                            if (sub === oldName) {
                                q.subcategory = newName;
                                changed++;
                            }
                        });
                        if (changed === 0) return null;
                        totalChanged += changed;
                        if (!hasGitHub) return null; // 无 GitHub 无法推送，仅统计
                        var newContent = JSON.stringify(data, null, 2);
                        var encoded = utf8ToBase64 ? utf8ToBase64(newContent) : btoa(unescape(encodeURIComponent(newContent)));
                        return fetch(apiBase + filePath + '?ref=' + (GITHUB_CONFIG.branch || 'main'), { headers: headers })
                            .then(function(rSha) {
                                var sha = null;
                                if (rSha.ok) {
                                    return rSha.json().then(function(fi) { return fi && fi.sha ? fi.sha : null; });
                                }
                                return Promise.resolve(null);
                            })
                            .then(function(sha) {
                                var body = {
                                    message: '小类维护：' + oldName + ' → ' + newName + ' (' + filePath + ')',
                                    content: encoded,
                                    branch: GITHUB_CONFIG.branch || 'main'
                                };
                                if (sha) body.sha = sha;
                                return fetch(apiBase + filePath, {
                                    method: 'PUT',
                                    headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
                                    body: JSON.stringify(body)
                                });
                            })
                            .then(function(putResp) {
                                if (putResp && putResp.ok) updatedFiles++;
                                return putResp;
                            });
                    })
                    .then(function() { updateSubcategoryProgress(idx, total, fileName); processNext(); })
                    .catch(function(err) {
                        if (progressWrap) progressWrap.style.display = 'none';
                        showMsg('adminSubcategoryStatus', '同步失败: ' + (err && err.message || '未知错误'), 'error');
                        processNext();
                    });
            }
            processNext();
        })
        .catch(function(err) {
            if (progressWrap) progressWrap.style.display = 'none';
            showMsg('adminSubcategoryStatus', '读取失败: ' + (err && err.message || '未知错误') + '。请通过 HTTP 访问（非 file://）', 'error');
        });
}

function fillSetSelects() {
    var opts = store.sets.map(function(s) { return '<option value="' + s.id + '">' + (s.name || '').replace(/</g,'&lt;') + '</option>'; }).join('');
    var empty = '<option value="">请先新建套卷</option>';
    var html = store.sets.length ? opts : empty;
    ['batchSetId', 'singleSetId', 'manageSetId', 'practiceSetId'].forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        var cur = el.value;
        el.innerHTML = store.sets.length ? opts : empty;
        if (cur && store.getSet(cur)) el.value = cur; else if (store.sets[0]) el.value = store.sets[0].id;
    });
}
function onBatchTxtFileChange() {
    var input = document.getElementById('batchTxtFile');
    if (!input.files || !input.files.length) return;
    var files = Array.prototype.slice.call(input.files || []);
    var ps = files.map(function(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function() { resolve(String(reader.result || '')); };
            reader.onerror = function() { reject(new Error('读取失败：' + (file && file.name ? file.name : 'TXT'))); };
            reader.readAsText(file, 'UTF-8');
        });
    });
    Promise.all(ps).then(function(texts) {
        var merged = texts.map(function(t) { return (t || '').trim(); }).filter(Boolean).join('\n\n');
        document.getElementById('inputText').value = merged;
        showMsg('importStatus', '已填入 ' + files.length + ' 个 TXT 内容（已合并），可编辑后点击「预览」或「导入」', 'success');
    }).catch(function(err) {
        showMsg('importStatus', '读取 TXT 失败：' + (err && err.message || '未知错误'), 'error');
    });
}
var _adminPendingPdfFile = null;
function onAdminBatchPdfFileChange() {
    var input = document.getElementById('adminBatchPdfFile');
    if (!input.files || !input.files.length) return;
    var file = input.files[0];
    var maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
        showMsg('adminImportStatus', 'PDF 文件超过 100MB 限制，请选择较小的文件', 'error');
        input.value = '';
        return;
    }
    _adminPendingPdfFile = file;
    var statusEl = document.getElementById('adminPdfRecognizeStatus');
    if (statusEl) statusEl.textContent = '已选择：' + file.name + '，点击「开始识别」';
}
function adminStartPdfRecognize() {
    if (!_adminPendingPdfFile) { showMsg('adminImportStatus', '请先选择 PDF 文件', 'error'); return; }
    var btn = document.getElementById('btnAdminPdfRecognize');
    var statusEl = document.getElementById('adminPdfRecognizeStatus');
    btn.disabled = true;
    statusEl.textContent = '正在提取 PDF 文本…';
    statusEl.style.color = 'var(--primary-color)';
    var reader = new FileReader();
    reader.onload = function() {
        var arrayBuffer = reader.result;
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        }
        pdfjsLib.getDocument(arrayBuffer).promise.then(function(pdf) {
            var numPages = pdf.numPages;
            var pagePromises = [];
            for (var i = 1; i <= numPages; i++) {
                pagePromises.push(pdf.getPage(i).then(function(page) {
                    return page.getTextContent().then(function(textContent) {
                        return (textContent.items || []).map(function(item) { return item.str || ''; }).join('');
                    });
                }));
            }
            return Promise.all(pagePromises);
        }).then(function(pageTexts) {
            var rawText = pageTexts.join('\n\n');
            if (!rawText.trim()) {
                statusEl.textContent = '未能从 PDF 中提取到文本（可能是扫描件）';
                statusEl.style.color = '#dc3545';
                btn.disabled = false;
                return;
            }
            statusEl.textContent = 'PDF 识别导入已移除';
            statusEl.style.color = '#dc3545';
            showMsg('adminImportStatus', 'PDF 识别导入已移除', 'error');
            throw new Error('PDF 识别导入已移除');
        }).catch(function(err) {
            statusEl.textContent = '识别失败：' + (err && err.message || '未知错误');
            statusEl.style.color = '#dc3545';
            showMsg('adminImportStatus', 'PDF 识别失败：' + (err && err.message || '未知错误'), 'error');
        }).finally(function() { btn.disabled = false; });
    };
    reader.readAsArrayBuffer(_adminPendingPdfFile);
}
function onPracticeTypeChange() {
    var type = document.getElementById('practiceType').value;
    document.getElementById('practiceByCategory').style.display = type === 'category' ? 'flex' : 'none';
    document.getElementById('practiceByPoint').style.display = type === 'point' ? 'flex' : 'none';
    document.getElementById('practiceBySet').style.display = type === 'set' ? 'flex' : 'none';
    if (type === 'set') fillSetSelects();
    if (type === 'point') renderPracticePointsCheckboxes();
}
var DEFAULT_SET_CATEGORIES = ['', '国考', '省考', '模拟', '其他'];
function getSetCategories() {
    try {
        var saved = localStorage.getItem('xingce_set_categories');
        if (saved) { var arr = JSON.parse(saved); if (Array.isArray(arr) && arr.length) return arr; }
    } catch (e) {}
    return DEFAULT_SET_CATEGORIES.slice();
}
function saveSetCategories(arr) {
    localStorage.setItem('xingce_set_categories', JSON.stringify(arr));
}

// 管理员端“套卷分类”独立存储（与首页分类完全隔离）
// 兼容迁移：若管理员独立分类未初始化，则从旧的 xingce_set_categories 复制一份作为初始值
var DEFAULT_ADMIN_SET_CATEGORIES = ['', '国考', '省考', '模拟', '其他'];
function getAdminSetCategories() {
    try {
        var saved = localStorage.getItem('xingce_admin_set_categories');
        if (saved) {
            var arr = JSON.parse(saved);
            if (Array.isArray(arr) && arr.length) return arr;
        }
    } catch (e) {}
    // migration: copy once from old shared categories (avoid sudden "丢失")
    try {
        var old = localStorage.getItem('xingce_set_categories');
        if (old) {
            var arr2 = JSON.parse(old);
            if (Array.isArray(arr2) && arr2.length) {
                localStorage.setItem('xingce_admin_set_categories', JSON.stringify(arr2));
                return arr2;
            }
        }
    } catch (e) {}
    return DEFAULT_ADMIN_SET_CATEGORIES.slice();
}
function saveAdminSetCategories(arr) {
    try { localStorage.setItem('xingce_admin_set_categories', JSON.stringify(arr)); } catch (e) {}
}
function fillCategorySelects() {
    var cats = getSetCategories();
    var opts = cats.map(function(c) { return '<option value="' + (c||'') + '">' + (c || '不分类') + '</option>'; }).join('');
    ['newSetCategory', 'setFilterCategory'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) {
            var cur = el.value;
            el.innerHTML = (id === 'setFilterCategory' ? '<option value="">全部</option>' : '') + opts;
            if (cur !== undefined && cats.indexOf(cur) >= 0) el.value = cur;
        }
    });
    if (document.getElementById('exportCategoryFilter')) updateExportSubcategoryOptions();
}
function renderCategoryList() {
    var container = document.getElementById('categoryList');
    if (!container) return;
    var cats = getSetCategories().filter(function(c) { return c; });
    container.innerHTML = cats.map(function(c) {
        return '<span class="set-item" style="padding:8px 12px; display:inline-flex; align-items:center; gap:8px;">' +
            '<span>' + (c.replace(/</g,'&lt;')) + '</span>' +
            '<button class="btn" style="padding:4px 8px; font-size:0.85rem; background:#eaeaea;" onclick="renameCategory(\'' + (c.replace(/'/g,"\\'")) + '\')"><i class="fas fa-edit"></i></button>' +
            '<button class="btn" style="padding:4px 8px; font-size:0.85rem; background:#f8d7da; color:#721c24;" onclick="deleteCategory(\'' + (c.replace(/'/g,"\\'")) + '\')"><i class="fas fa-trash"></i></button>' +
            '</span>';
    }).join('');
}
function addCategory() {
    var name = (document.getElementById('newCategoryName').value || '').trim();
    if (!name) { showMsg('categoryStatus', '请输入分类名称', 'error'); return; }
    var cats = getSetCategories();
    if (cats.indexOf(name) >= 0) { showMsg('categoryStatus', '该分类已存在', 'error'); return; }
    cats.push(name);
    cats.sort(function(a,b) { return (a||'').localeCompare(b||''); });
    saveSetCategories(cats);
    document.getElementById('newCategoryName').value = '';
    fillCategorySelects();
    renderCategoryList();
    filterSetList();
    showMsg('categoryStatus', '已添加分类：' + name, 'success');
}
function deleteCategory(name) {
    var cats = getSetCategories();
    var idx = cats.indexOf(name);
    if (idx < 0) return;
    var used = store.sets.some(function(s) { return (s.category||'') === name; });
    if (used && !confirm('有套卷使用该分类，删除后这些套卷将变为「不分类」。确定删除？')) return;
    store.sets.forEach(function(s) { if ((s.category||'') === name) s.category = ''; });
    store.save();
    cats.splice(idx, 1);
    saveSetCategories(cats);
    fillCategorySelects();
    renderCategoryList();
    filterSetList();
    showMsg('categoryStatus', '已删除分类', 'success');
}
function renameCategory(oldName) {
    var newName = prompt('请输入新的分类名称：', oldName);
    if (newName == null || (newName = newName.trim()) === '') return;
    var cats = getSetCategories();
    if (cats.indexOf(newName) >= 0 && newName !== oldName) { alert('该分类名已存在'); return; }
    var idx = cats.indexOf(oldName);
    if (idx >= 0) cats[idx] = newName;
    store.sets.forEach(function(s) { if ((s.category||'') === oldName) s.category = newName; });
    store.save();
    saveSetCategories(cats);
    fillCategorySelects();
    renderCategoryList();
    filterSetList();
    showMsg('categoryStatus', '已重命名', 'success');
}
function addSet() {
    var name = (document.getElementById('newSetName').value || '').trim();
    if (!name) { showMsg('setStatus', '套卷名称不能为空', 'error'); return; }
    var category = (document.getElementById('newSetCategory').value || '').trim();
    var id = store.addSet(name, category);
    if (id == null) { showMsg('setStatus', '套卷名称已存在，不可重复', 'error'); return; }
    store.save();
    document.getElementById('newSetName').value = '';
    document.getElementById('newSetCategory').value = '';
    fillSetSelects();
    filterSetList();
    renderTree();
    showMsg('setStatus', '套卷已创建', 'success');
}
function filterSetList() {
    var container = document.getElementById('setList');
    if (!container) return;
    if (!store.sets.length) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-folder"></i><p>暂无套卷</p></div>';
        return;
    }
    var catFilter = (document.getElementById('setFilterCategory') && document.getElementById('setFilterCategory').value) || '';
    var nameFilter = (document.getElementById('setFilterName') && document.getElementById('setFilterName').value) || '';
    nameFilter = nameFilter.trim().toLowerCase();
    var list = store.sets.filter(function(s) {
        if (catFilter && (s.category || '') !== catFilter) return false;
        if (nameFilter && (s.name || '').toLowerCase().indexOf(nameFilter) === -1) return false;
        return true;
    });
    if (!list.length) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-search"></i><p>没有符合条件的套卷</p></div>';
        return;
    }
    container.innerHTML = list.map(function(s) {
        var secCounts = {};
        var total = 0;
        (MAIN_SECTIONS || []).forEach(function(sec) { var c = (s[sec]||[]).length; secCounts[sec] = c; total += c; });
        var catTag = (s.category) ? '<span class="set-category-tag">' + (s.category).replace(/</g,'&lt;') + '</span>' : '';
        var meta = (MAIN_SECTIONS || []).map(function(sec) { return sec + ' ' + (secCounts[sec]||0); }).join(' · ');
        var catOpts = getSetCategories().map(function(c) { return '<option value="' + (c||'') + '"' + ((s.category||'') === c ? ' selected' : '') + '>' + (c || '不分类') + '</option>'; }).join('');
        return '<div class="set-item" id="set-row-' + s.id + '">' +
            '<div class="set-view" id="set-view-' + s.id + '">' +
            '<span><strong>' + (s.name||'').replace(/</g,'&lt;') + '</strong> ' + catTag + '<span style="color:#6c757d;">(' + total + ' 题)</span></span>' +
            '<div class="set-meta">' + meta + '</div>' +
            '<div class="set-item-actions">' +
            '<div class="add-to-set-wrap"><button type="button" class="btn btn-primary" style="padding:6px 12px;" onclick="toggleAddToSetMenu(\'' + s.id + '\'); event.stopPropagation();"><i class="fas fa-plus"></i> 在此套卷添加题目</button>' +
            '<div id="add-to-set-menu-' + s.id + '" class="add-to-set-menu" onclick="event.stopPropagation();">' +
            '<a href="javascript:void(0)" onclick="closeAddToSetMenus(); batchImportToSet(\'' + s.id + '\');">批量导入</a>' +
            '<a href="javascript:void(0)" onclick="closeAddToSetMenus(); singleImportToSet(\'' + s.id + '\');">单题录入</a>' +
            '</div></div> ' +
            '<button class="btn btn-default set-toggle-manage" style="padding:6px 12px;" onclick="toggleSetManage(\'' + s.id + '\')"><i class="fas fa-cog"></i> 管理</button> ' +
            '<button class="btn btn-info btn-sm" style="padding:6px 12px;" onclick="window.open(\'set-manage.html?setId=' + s.id + '\', \'_blank\')"><i class="fas fa-list"></i> 管理题目</button> ' +
            '<span class="set-manage-btns" id="set-manage-btns-' + s.id + '" style="display:none;">' +
            '<button class="btn" style="padding:6px 12px; background:#fff3cd;" onclick="editSet(\'' + s.id + '\')"><i class="fas fa-edit"></i> 编辑</button> ' +
            '<button class="btn" style="padding:6px 12px; background:#f8d7da; color:#721c24;" onclick="deleteSet(\'' + s.id + '\')"><i class="fas fa-trash"></i> 删除</button>' +
            '</span></div></div>' +
            '<div class="set-item-edit" id="set-edit-' + s.id + '">' +
            '<div class="filter-controls"><div><label>名称</label><input type="text" id="set-edit-name-' + s.id + '" value="' + (s.name||'').replace(/"/g,'&quot;') + '" style="width:100%; padding:8px; margin-top:4px; border:2px solid #eaeaea; border-radius: var(--border-radius);"></div>' +
            '<div><label>分类</label><select id="set-edit-cat-' + s.id + '" style="width:100%; padding:8px; margin-top:4px; border:2px solid #eaeaea; border-radius: var(--border-radius);">' + catOpts + '</select></div>' +
            '<div style="align-self:flex-end;"><button class="btn btn-success" style="padding:8px 16px;" onclick="saveSetEdit(\'' + s.id + '\')">保存</button> <button class="btn" style="padding:8px 16px; background:#eaeaea;" onclick="cancelSetEdit(\'' + s.id + '\')">取消</button></div></div>' +
            '</div></div>';
    }).join('');
}
function renderSetList() { filterSetList(); }
function editSet(setId) {
    var view = document.getElementById('set-view-' + setId);
    var edit = document.getElementById('set-edit-' + setId);
    if (view) view.style.display = 'none';
    if (edit) { edit.classList.add('show'); edit.style.display = 'block'; }
}
function cancelSetEdit(setId) {
    var view = document.getElementById('set-view-' + setId);
    var edit = document.getElementById('set-edit-' + setId);
    if (view) view.style.display = '';
    if (edit) { edit.classList.remove('show'); edit.style.display = 'none'; }
}
function saveSetEdit(setId) {
    var nameEl = document.getElementById('set-edit-name-' + setId);
    var catEl = document.getElementById('set-edit-cat-' + setId);
    var name = (nameEl && nameEl.value) ? nameEl.value.trim() : '';
    var category = (catEl && catEl.value) ? catEl.value.trim() : '';
    if (!name) { showMsg('setStatus', '名称不能为空', 'error'); return; }
    if (!store.updateSet(setId, { name: name, category: category })) { showMsg('setStatus', '套卷名称已存在，不可重复', 'error'); return; }
    store.save();
    fillSetSelects();
    filterSetList();
    cancelSetEdit(setId);
    showMsg('setStatus', '套卷已更新', 'success');
}
function deleteSet(setId) {
    var set = store.getSet(setId);
    if (!set) return;
    var total = (MAIN_SECTIONS || []).reduce(function(sum, sec) { return sum + (set[sec]||[]).length; }, 0);
    if (!confirm('确定删除套卷「' + (set.name || '') + '」吗？将同时删除该套卷下 ' + total + ' 道题目，且不可恢复。')) return;
    store.deleteSet(setId);
    store.save();
    fillSetSelects();
    filterSetList();
    renderTree();
    checkExportState();
    showMsg('setStatus', '套卷已删除', 'success');
}
function toggleSetManage(setId) {
    var el = document.getElementById('set-manage-btns-' + setId);
    if (el) el.style.display = el.style.display === 'none' ? 'inline' : 'none';
}
function toggleAddToSetMenu(setId) {
    var menu = document.getElementById('add-to-set-menu-' + setId);
    var open = menu && menu.classList.contains('show');
    closeAddToSetMenus();
    if (!open && menu) menu.classList.add('show');
}
function closeAddToSetMenus() {
    document.querySelectorAll('.add-to-set-menu.show').forEach(function(el) { el.classList.remove('show'); });
}
document.addEventListener('click', function() { closeAddToSetMenus(); });
function batchImportToSet(setId) { document.getElementById('batchSetId').value = setId; switchTab('batch'); }
function singleImportToSet(setId) { document.getElementById('singleSetId').value = setId; switchTab('single'); }
function batchPreview() {
    var text = (document.getElementById('inputText').value || '').trim();
    var wrap = document.getElementById('batchPreviewWrap');
    var listEl = document.getElementById('batchPreviewList');
    var countEl = document.getElementById('batchPreviewCount');
    if (!text) { showMsg('importStatus', '请先填入题目内容', 'error'); return; }
    var list;
    try {
        list = typeof parseBatchText === 'function' ? parseBatchText(text) : [];
    } catch (e) {
        showMsg('importStatus', '解析出错：' + (e && e.message || String(e)), 'error');
        if (wrap) wrap.style.display = 'none';
        return;
    }
    if (!list || !list.length) { showMsg('importStatus', '未解析到有效题目，请检查格式：每道题需以 [大类] 或 [大类-小类] 开头，可加 (来源)，如 [政治理论](2026超格)题号1：...', 'error'); if (wrap) wrap.style.display = 'none'; return; }
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    listEl.innerHTML = list.map(function(q, i) {
        var optHtml = (q.options || []).map(function(o) { return '<div class="option"><span class="option-label">' + o.label + '.</span> ' + esc(o.text) + '</div>'; }).join('');
        var kp = (q.knowledgePoints && q.knowledgePoints.length) ? ('考点：' + q.knowledgePoints.join('、')) : '';
        return '<div class="question-item"><div class="question-header"><span class="question-category">' + esc(q.category) + (q.subcategory ? ' - ' + esc(q.subcategory) : '') + '</span> <span style="color:#6c757d;">' + (i+1) + '.</span>' + (kp ? ' <span style="font-size:0.9rem; color:var(--primary-color);">' + esc(kp) + '</span>' : '') + '</div><div class="question-content">' + esc(q.content || '') + '</div><div class="options-grid">' + optHtml + '</div>' + (q.explanation ? '<div class="answer-block">解析：<div class="explanation-body">' + explanationToHtml(q.explanation) + '</div></div>' : '') + '</div>';
    }).join('');
    if (countEl) countEl.textContent = list.length;
    wrap.style.display = 'block';
    renderLaTeXInElement(listEl);
    showMsg('importStatus', '已解析 ' + list.length + ' 题，公式已渲染；确认无误可点击「导入」', 'success');
}

/**
 * 通过 GitHub API 将数据同步到 GitHub 仓库的 data/store.json
 * 需要配置 GITHUB_CONFIG 中的 token
 */
function saveToGitHub() {
    if (!GITHUB_CONFIG.token) {
        console.log('GitHub Token 未配置，跳过同步到 GitHub');
        return Promise.resolve();
    }
    
    if (!window.fetch) {
        console.log('浏览器不支持 fetch，跳过同步到 GitHub');
        return Promise.resolve();
    }
    
    // 准备要上传的数据（格式与 exportData 一致）
    var data = {
        sets: store.sets,
        questions: store.questions,
        exportTime: new Date().toISOString()
    };
    var content = JSON.stringify(data, null, 2);
    var encodedContent = btoa(unescape(encodeURIComponent(content)));
    
    // GitHub API: 先获取文件信息（如果存在）以获取 SHA
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/' + GITHUB_CONFIG.path;
    var headers = {
        'Authorization': 'token ' + GITHUB_CONFIG.token,
        'Accept': 'application/vnd.github.v3+json'
    };
    
    return fetch(apiUrl + '?ref=' + GITHUB_CONFIG.branch, {
        method: 'GET',
        headers: headers
    })
    .then(function(resp) {
        if (resp.status === 404) {
            // 文件不存在，创建新文件
            return null;
        }
        if (!resp.ok) {
            throw new Error('获取文件信息失败: ' + resp.status);
        }
        return resp.json();
    })
    .then(function(fileInfo) {
        // 准备提交数据
        var commitData = {
            message: '更新题库数据 - ' + new Date().toLocaleString('zh-CN'),
            content: encodedContent,
            branch: GITHUB_CONFIG.branch
        };
        
        // 如果文件已存在，需要提供 SHA
        if (fileInfo && fileInfo.sha) {
            commitData.sha = fileInfo.sha;
        }
        
        // 提交更新
        return fetch(apiUrl, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify(commitData)
        });
    })
    .then(function(resp) {
        if (!resp.ok) {
            return resp.json().then(function(err) {
                throw new Error('同步到 GitHub 失败: ' + (err.message || resp.status));
            });
        }
        return resp.json();
    })
    .then(function(result) {
        console.log('成功同步到 GitHub:', result.commit.html_url);
        return result;
    })
    .catch(function(err) {
        console.error('同步到 GitHub 失败:', err);
        // 不抛出错误，避免影响正常流程
        return null;
    });
}

/**
 * 保存数据后同步到 GitHub（如果配置了 Token）
 * 这是一个辅助函数，可以在任何 store.save() 后调用
 */
function saveAndSyncToGitHub() {
    // 先保存到本地
    store.save();
    // 然后同步到 GitHub
    saveToGitHub().then(function() {
        // 同步成功
    }).catch(function() {
        // 同步失败已在 saveToGitHub 中处理
    });
}

function batchImport() {
    var setId = document.getElementById('batchSetId').value;
    if (!setId) { showMsg('importStatus', '请先选择或新建套卷', 'error'); return; }
    var text = (document.getElementById('inputText').value || '').trim();
    if (!text) { showMsg('importStatus', '请输入题目内容', 'error'); return; }
    var list = parseBatchText(text);
    if (!list.length) { showMsg('importStatus', '未解析到有效题目，请检查格式与分类', 'error'); return; }
    var added = 0;
    list.forEach(function(q) {
        var section = q.category;
        if (!section) return;
        var set = store.getSet(setId);
        if (set) {
            if (typeof ensureCategory === 'function') ensureCategory(section);
            if (!set[section]) set[section] = [];
            store.addQuestion(setId, section, Object.assign({}, q)); added++;
        }
    });
    store.save();
    renderTree();
    fillSetSelects();
    // 批量导入可能引入新“大类/小类”，需同步刷新各处
    rebuildSubcategoriesFromStore();
    if (typeof fillSectionDropdowns === 'function') fillSectionDropdowns();
    updateSingleSub();
    updateManageSub();
    updatePracticeSub();
    if (document.getElementById('exportCategoryFilter')) updateExportSubcategoryOptions();
    checkExportState();
    document.getElementById('inputText').value = '';
    document.getElementById('batchPreviewWrap').style.display = 'none';
    showMsg('importStatus', '成功导入 ' + added + ' 题（已保存到本地）', 'success');
    // 注意：首页的批量导入不同步到 GitHub，只保存到本地
}

/**
 * 将一个 TXT 文件（批量导入格式）自动导入到套卷：
 * - 套卷名称 = 文件名（不含扩展名）
 * - 若同名套卷已存在，则直接追加题目；否则新建套卷
 */
function importTxtFileToSetAuto(fileName, text) {
    text = (text || '').trim();
    if (!text) return;
    var base = fileName.replace(/^.*[\\/]/, ''); // 去掉路径，仅保留文件名
    var pure = base.replace(/\.[^.]+$/, '') || '未命名';
    var name = pure.trim() || '未命名';
    var existing = store.sets.find(function(s) { return (s.name || '').trim() === name; });
    var setId;
    if (existing) {
        setId = existing.id;
    } else {
        setId = store.addSet(name, '');
    }
    if (!setId) return;
    var list = parseBatchText(text);
    if (!list.length) return;
    list.forEach(function(q) {
        var section = q.category;
        if (!section) return;
        var set = store.getSet(setId);
        if (set) {
            if (typeof ensureCategory === 'function') ensureCategory(section);
            if (!set[section]) set[section] = [];
            store.addQuestion(setId, section, Object.assign({}, q));
        }
    });
}

var singleZiliaoQIndex = 0;
function addSingleZiliaoQuestion() {
    var idx = singleZiliaoQIndex++;
    var container = document.getElementById('singleZiliaoQuestions');
    if (!container) return;
    var qId = 'zq' + idx;
    var card = document.createElement('div');
    card.className = 'single-ziliao-q';
    card.setAttribute('data-zq-id', qId);
    card.style.cssText = 'margin-bottom:20px; padding:16px; border:1px solid var(--border-color); border-radius:var(--border-radius); background:var(--light-bg);';
    card.innerHTML =
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;"><strong>小题 ' + (container.querySelectorAll(".single-ziliao-q").length + 1) + '</strong> <button type="button" class="btn btn-sm" style="background:#f8d7da; color:#721c24;" onclick="removeSingleZiliaoQuestion(\'' + qId + '\')"><i class="fas fa-trash"></i> 删除</button></div>' +
        '<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:6px;"><label>题干</label><input type="text" id="' + qId + '_Points" placeholder="考点，多个用逗号分隔" style="flex:1; max-width:220px; padding:6px 10px; border:1px solid var(--border-color); border-radius:var(--border-radius); font-size:0.9rem;"></div>' +
        '<div style="margin-bottom:8px;"><div id="' + qId + '_Stem" class="editable-area" contenteditable="true" style="min-height:50px;"></div></div>' +
        '<div style="margin-bottom:6px;"><label>选项 A</label><div id="' + qId + '_OptA" class="editable-area" contenteditable="true" style="min-height:36px;"></div></div>' +
        '<div style="margin-bottom:6px;"><label>选项 B</label><div id="' + qId + '_OptB" class="editable-area" contenteditable="true" style="min-height:36px;"></div></div>' +
        '<div style="margin-bottom:6px;"><label>选项 C</label><div id="' + qId + '_OptC" class="editable-area" contenteditable="true" style="min-height:36px;"></div></div>' +
        '<div style="margin-bottom:6px;"><label>选项 D</label><div id="' + qId + '_OptD" class="editable-area" contenteditable="true" style="min-height:36px;"></div></div>' +
        '<div class="filter-controls" style="margin-top:8px;"><div><label>答案</label><select id="' + qId + '_Answer" style="padding:8px;"><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select></div>' +
        '<div style="flex:2;"><label>解析</label><textarea id="' + qId + '_Explanation" rows="2" style="width:100%; padding:8px; border:1px solid var(--border-color); border-radius:var(--border-radius);" placeholder="可选"></textarea></div></div>';
    container.appendChild(card);
    [qId + '_Stem', qId + '_OptA', qId + '_OptB', qId + '_OptC', qId + '_OptD'].forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        if (!el.dataset.pasteBound) {
            el.dataset.pasteBound = '1';
            el.addEventListener('paste', function(e) {
                var items = e.clipboardData && e.clipboardData.items;
                if (!items) return;
                for (var i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf('image') !== -1) {
                        e.preventDefault();
                        var file = items[i].getAsFile();
                        var reader = new FileReader();
                        reader.onload = function() {
                            var img = document.createElement('img');
                            img.src = reader.result;
                            img.style.maxWidth = '100%';
                            document.execCommand('insertHTML', false, img.outerHTML);
                        };
                        reader.readAsDataURL(file);
                        break;
                    }
                }
            });
        }
        el.addEventListener('input', updateSinglePreview);
        el.addEventListener('paste', function() { setTimeout(updateSinglePreview, 100); });
    });
}
function removeSingleZiliaoQuestion(qId) {
    var card = document.querySelector('.single-ziliao-q[data-zq-id="' + qId + '"]');
    if (card) card.remove();
}
function fillSectionDropdowns() {
    refreshAllSectionSelects();
}
function refreshAllSectionSelects() {
    var sections = MAIN_SECTIONS || [];
    function opt(s) {
        var label = (typeof getSectionDisplayName === 'function' ? getSectionDisplayName(s) : s) || s;
        return '<option value="' + (s || '').replace(/"/g, '&quot;') + '">' + (label || '').replace(/</g, '&lt;') + '</option>';
    }
    ['singleSection', 'adminSingleSection'].forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        var cur = el.value;
        el.innerHTML = sections.map(opt).join('');
        if (cur && sections.indexOf(cur) !== -1) el.value = cur; else if (sections.length) el.value = sections[0];
    });
    var manageSection = document.getElementById('manageSection');
    if (manageSection) {
        var curM = manageSection.value;
        manageSection.innerHTML = '<option value="">全部</option>' + sections.map(opt).join('');
        if (curM && sections.indexOf(curM) !== -1) manageSection.value = curM;
    }
    var practiceSectionsWrap = document.getElementById('practiceSectionsWrap');
    if (practiceSectionsWrap) {
        practiceSectionsWrap.innerHTML = sections.map(function(s) {
            var label = (typeof getSectionDisplayName === 'function' ? getSectionDisplayName(s) : s) || s;
            return '<label><input type="checkbox" name="practiceSection" value="' + (s || '').replace(/"/g, '&quot;') + '"> ' + (label || '').replace(/</g, '&lt;') + '</label>';
        }).join('');
        if (typeof updatePracticeSub === 'function') updatePracticeSub();
    }
    ['adminSubcategorySection', 'adminKnowledgeSection'].forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        var cur = el.value;
        el.innerHTML = sections.map(opt).join('');
        if (cur && sections.indexOf(cur) !== -1) el.value = cur; else if (sections.length) el.value = sections[0];
        if (id === 'adminSubcategorySection' && typeof adminLoadSubcategories === 'function') adminLoadSubcategories();
        if (id === 'adminKnowledgeSection' && typeof adminKnowledgeLoadSubcategories === 'function') adminKnowledgeLoadSubcategories();
    });
    if (typeof updateSingleSub === 'function') updateSingleSub();
    if (typeof updateAdminSingleSub === 'function') updateAdminSingleSub();
    if (typeof updateManageSub === 'function') updateManageSub();
}
function updateSingleSub() {
    var section = document.getElementById('singleSection').value;
    var sub = document.getElementById('singleSubcategory');
    var opts = SUBCATEGORIES[section] || [];
    var noSubAllowed = ['政治理论', '常识判断'];
    var html = (noSubAllowed.indexOf(section) !== -1 ? '<option value="">（无）</option>' : '') + opts.map(function(s) { return '<option value="' + s + '">' + s + '</option>'; }).join('');
    sub.innerHTML = html || '<option value="">（无）</option>';
    setSingleOptionDefaults();
}
function setSingleOptionDefaults() {
    var sub = document.getElementById('singleSubcategory');
    if (!sub) return;
    var isGraph = sub.value === '图形推理';
    var def = isGraph ? ['A', 'B', 'C', 'D'] : ['', '', '', ''];
    ['singleOptA', 'singleOptB', 'singleOptC', 'singleOptD'].forEach(function(id, i) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = def[i];
    });
}
function renderSingleHistory() {
    var container = document.getElementById('singleHistoryList');
    if (!container) return;
    var setId = document.getElementById('singleSetId') && document.getElementById('singleSetId').value;
    if (!setId) { container.innerHTML = '<p style="color:var(--text-secondary); font-size:0.9rem;">请先选择套卷</p>'; return; }
    var set = store.getSet(setId);
    if (!set) { container.innerHTML = '<p style="color:var(--text-secondary); font-size:0.9rem;">套卷不存在</p>'; return; }
    var ids = [];
    MAIN_SECTIONS.forEach(function(sec) { (set[sec] || []).forEach(function(qid) { ids.push(qid); }); });
    if (!ids.length) { container.innerHTML = '<p style="color:var(--text-secondary); font-size:0.9rem;">当前套卷暂无题目</p>'; return; }
    var list = ids.slice(-50).reverse().map(function(qid) { return store.getQuestion(qid); }).filter(Boolean);
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    container.innerHTML = list.map(function(q) {
        var preview = (q.content || '').slice(0, 60) + ((q.content || '').length > 60 ? '…' : '');
        return '<div class="single-history-item"><div class="hist-meta">' + esc(q.section) + ' - ' + esc(q.subcategory || '') + '</div><div>' + esc(preview) + '</div><div class="hist-actions"><button type="button" class="btn btn-sm btn-info" onclick="showQuestionDetail(\'' + q.id + '\')">查看</button><button type="button" class="btn btn-sm" style="background:var(--light-bg);" onclick="openEditQuestion(\'' + q.id + '\')">修改</button></div></div>';
    }).join('');
}
function bindEditablePaste() {
    ['singleMaterial', 'singleStem', 'singleOptA', 'singleOptB', 'singleOptC', 'singleOptD', 'singleExplanation', 'singleMaterialZiliao', 'editMaterial', 'editQuestionContent', 'editOptA', 'editOptB', 'editOptC', 'editOptD', 'editExplanation'].forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('paste', function(e) {
            var items = e.clipboardData && e.clipboardData.items;
            if (!items) return;
            for (var i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    e.preventDefault();
                    var file = items[i].getAsFile();
                    var reader = new FileReader();
                    reader.onload = function() {
                        var img = document.createElement('img');
                        img.src = reader.result;
                        img.style.maxWidth = '100%';
                        document.execCommand('insertHTML', false, img.outerHTML);
                    };
                    reader.readAsDataURL(file);
                    break;
                }
            }
        });
    });
}
function getEditableContent(id) {
    var el = document.getElementById(id);
    if (!el) return { text: '', images: [] };
    var images = [];
    function walk(node) {
        if (node.nodeName === 'IMG' && node.src) { images.push(node.src); return ''; }
        if (node.nodeType === 3) return node.textContent || '';
        if (node.nodeType === 1) return [].map.call(node.childNodes, walk).join('');
        return '';
    }
    return { text: walk(el).trim(), images: images };
}
function getExplanationWithInlineImages(id) {
    var el = document.getElementById(id);
    if (!el) return '';
    var parts = [];
    function walk(node) {
        if (node.nodeName === 'IMG' && node.src) { parts.push({ type: 'img', src: node.src }); return; }
        if (node.nodeType === 3) { parts.push({ type: 'text', value: node.textContent }); return; }
        if (node.nodeType === 1) {
            if (node.tagName === 'BR') parts.push({ type: 'text', value: '\n' });
            else [].forEach.call(node.childNodes, walk);
        }
    }
    walk(el);
    var s = '';
    parts.forEach(function(p) { if (p.type === 'text') s += p.value; else s += '[IMG:' + p.src + ']'; });
    return s.trim();
}
function explanationToHtml(explanation) {
    if (!explanation) return '';
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    var re = /\[IMG:(data:[^\]]+)\]/gi;
    var html = '';
    var last = 0;
    var match;
    while ((match = re.exec(explanation)) !== null) {
        html += esc(explanation.slice(last, match.index));
        html += '<img src="' + match[1].replace(/"/g, '&quot;') + '" style="max-width:100%; margin:6px 0;" />';
        last = re.lastIndex;
    }
    html += esc(explanation.slice(last));
    return html.replace(/\n/g, '<br>');
}
var _singlePreviewTimer = null;
function updateSinglePreview() {
    if (_singlePreviewTimer) clearTimeout(_singlePreviewTimer);
    _singlePreviewTimer = setTimeout(function() {
        _singlePreviewTimer = null;
        var wrap = document.getElementById('singlePreview');
        if (!wrap) return;
        function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
        var materialData = getEditableContent('singleMaterial');
        var stemData = getEditableContent('singleStem');
        var optA = getEditableContent('singleOptA'), optB = getEditableContent('singleOptB'), optC = getEditableContent('singleOptC'), optD = getEditableContent('singleOptD');
        var materialImgs = (materialData.images || []).map(function(src) { return '<img src="' + src + '" style="max-width:100%; margin:8px 0;" />'; }).join('');
        var stemImgs = (stemData.images || []).map(function(src) { return '<img src="' + src + '" style="max-width:100%; margin:8px 0;" />'; }).join('');
        var html = '';
        if (materialData.text || materialImgs) html += '<div style="margin-bottom:12px;"><strong>材料</strong><div>' + esc(materialData.text) + materialImgs + '</div></div>';
        html += '<div style="margin-bottom:12px;"><strong>题干</strong><div>' + esc(stemData.text) + stemImgs + '</div></div>';
        ['A','B','C','D'].forEach(function(lbl, i) {
            var o = [optA,optB,optC,optD][i];
            var imgs = (o.images || []).map(function(src) { return '<img src="' + src + '" style="max-width:100%; margin:4px 0;" />'; }).join('');
            html += '<div style="margin-bottom:8px;"><strong>选项' + lbl + '</strong> ' + esc(o.text) + imgs + '</div>';
        });
        var exp = getExplanationWithInlineImages('singleExplanation') || '';
        if (exp) html += '<div style="margin-top:12px;"><strong>解析</strong><div class="explanation-preview">' + explanationToHtml(exp) + '</div></div>';
        wrap.innerHTML = html || '<span style="color:#6c757d;">输入题干或选项后此处显示预览</span>';
        renderLaTeXInElement(wrap);
    }, 200);
}
function singleSave() {
    var setId = document.getElementById('singleSetId').value;
    if (!setId) { showMsg('singleStatus', '请先选择套卷', 'error'); return; }
    var section = document.getElementById('singleSection').value;
    var subCustom = (document.getElementById('singleSubcategoryCustom') && document.getElementById('singleSubcategoryCustom').value || '').trim();
    var subcategory = subCustom || (document.getElementById('singleSubcategory').value || '');
    if (subcategory) ensureSubcategory(section, subcategory);
    var source = (document.getElementById('singleSource').value || '').trim();
    var ziliaoMode = document.getElementById('singleZiliaoMode') && document.getElementById('singleZiliaoMode').checked;
    if (ziliaoMode) {
        var materialData = getEditableContent('singleMaterialZiliao');
        var cards = document.querySelectorAll('.single-ziliao-q');
        if (!cards.length) { showMsg('singleStatus', '请至少添加一道小题', 'error'); return; }
        var ziliaoBlockId = genId();
        var added = 0;
        cards.forEach(function(card, subIdx) {
            var qId = card.getAttribute('data-zq-id');
            var stemData = getEditableContent(qId + '_Stem');
            var optA = getEditableContent(qId + '_OptA'), optB = getEditableContent(qId + '_OptB'), optC = getEditableContent(qId + '_OptC'), optD = getEditableContent(qId + '_OptD');
            if (!stemData.text && !stemData.images.length) return;
            var options = [
                { label: 'A', text: optA.text, images: optA.images },
                { label: 'B', text: optB.text, images: optB.images },
                { label: 'C', text: optC.text, images: optC.images },
                { label: 'D', text: optD.text, images: optD.images }
            ];
            var answerEl = document.getElementById(qId + '_Answer');
            var expEl = document.getElementById(qId + '_Explanation');
            var pointsEl = document.getElementById(qId + '_Points');
            var kpStr = (pointsEl && pointsEl.value || '').trim();
            var knowledgePoints = kpStr ? kpStr.split(/[,，、\s]+/).map(function(s) { return s.trim(); }).filter(Boolean) : [];
            var q = { category: '资料分析', subcategory: subcategory, source: source, content: stemData.text, stemImages: stemData.images, material: materialData.text, materialImages: materialData.images, options: options, answer: answerEl ? answerEl.value : 'A', explanation: (expEl && expEl.value || '').trim(), knowledgePoints: knowledgePoints, ziliaoBlockId: ziliaoBlockId, ziliaoSubIndex: subIdx };
            store.addQuestion(setId, '资料分析', q);
            added++;
        });
        if (added === 0) { showMsg('singleStatus', '请至少填写一道小题的题干', 'error'); return; }
        store.save();
        renderTree();
        showMsg('singleStatus', '已保存 ' + added + ' 道小题（一材料多题，已保存到本地）', 'success');
        renderSingleHistory();
        // 注意：首页的单题录入不同步到 GitHub，只保存到本地
        document.getElementById('singleMaterialZiliao').innerHTML = '';
        cards.forEach(function(card) {
            var qId = card.getAttribute('data-zq-id');
            [qId + '_Stem', qId + '_OptA', qId + '_OptB', qId + '_OptC', qId + '_OptD'].forEach(function(id) { var e = document.getElementById(id); if (e) e.innerHTML = ''; });
            var e = document.getElementById(qId + '_Explanation'); if (e) e.value = '';
        });
        document.getElementById('singleZiliaoQuestions').innerHTML = '';
        singleZiliaoQIndex = 0;
        addSingleZiliaoQuestion();
    } else {
        var stemData = getEditableContent('singleStem');
        var materialData = getEditableContent('singleMaterial');
        var optA = getEditableContent('singleOptA'), optB = getEditableContent('singleOptB'), optC = getEditableContent('singleOptC'), optD = getEditableContent('singleOptD');
        if (!stemData.text && !stemData.images.length) { showMsg('singleStatus', '请填写题干', 'error'); return; }
        var options = [
            { label: 'A', text: optA.text, images: optA.images },
            { label: 'B', text: optB.text, images: optB.images },
            { label: 'C', text: optC.text, images: optC.images },
            { label: 'D', text: optD.text, images: optD.images }
        ];
        var explanationStr = getExplanationWithInlineImages('singleExplanation') || '';
        var question = { category: section, subcategory: subcategory, source: source, content: stemData.text, stemImages: stemData.images, material: materialData.text, materialImages: materialData.images, options: options, answer: document.getElementById('singleAnswer').value, explanation: explanationStr };
        store.addQuestion(setId, section, question);
        store.save();
        renderTree();
        showMsg('singleStatus', '题目已保存（已保存到本地）', 'success');
        renderSingleHistory();
        // 注意：首页的单题录入不同步到 GitHub，只保存到本地
        var expEl = document.getElementById('singleExplanation');
        if (expEl) expEl.innerHTML = '';
        ['singleMaterial', 'singleStem'].forEach(function(id) { var e = document.getElementById(id); if (e) e.innerHTML = ''; });
        setSingleOptionDefaults();
        updateSinglePreview();
    }
}
var _singleQueue = [];
var _singleQueueImportTimer = null;
function singleQueueUpdateUI() {
    var countEl = document.getElementById('singleQueueCount');
    var listEl = document.getElementById('singleQueueList');
    var n = _singleQueue.length;
    if (countEl) countEl.textContent = '队列中 ' + n + ' 题';
    if (!listEl) return;
    if (!n) {
        listEl.innerHTML = '<div class="empty" style="padding:16px; font-size:0.85rem; color:#6c757d;">当前队列为空，可先在上方录入题目后加入队列。</div>';
        return;
    }
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    listEl.innerHTML = _singleQueue.map(function(item, idx) {
        var q = item.question || {};
        var preview = (q.content || '').slice(0, 60) + ((q.content || '').length > 60 ? '…' : '');
        return '<div class="question-row">' +
            '<div class="q-main">' +
            '<div><span class="badge-sec">[' + esc(q.category || '') + (q.subcategory ? ' - ' + esc(q.subcategory) : '') + ']</span>' +
            '<span class="muted"> #' + (idx + 1) + '</span>' +
            (q.source ? ' <span class="muted">(' + esc(q.source) + ')</span>' : '') +
            '</div>' +
            '<div class="q-snippet">' + esc(preview || '(无题干)') + '</div>' +
            '</div>' +
            '</div>';
    }).join('');
}
function singleQueueBuildQuestion() {
    var section = document.getElementById('singleSection').value;
    var subCustom = (document.getElementById('singleSubcategoryCustom') && document.getElementById('singleSubcategoryCustom').value || '').trim();
    var subcategory = subCustom || (document.getElementById('singleSubcategory').value || '');
    var source = (document.getElementById('singleSource').value || '').trim();
    var stemData = getEditableContent('singleStem');
    var materialData = getEditableContent('singleMaterial');
    var optA = getEditableContent('singleOptA'), optB = getEditableContent('singleOptB'), optC = getEditableContent('singleOptC'), optD = getEditableContent('singleOptD');
    if (!stemData.text && !stemData.images.length) {
        return { ok: false, msg: '请先填写题干，再加入队列。' };
    }
    if (subcategory) ensureSubcategory(section, subcategory);
    var options = [
        { label: 'A', text: optA.text, images: optA.images },
        { label: 'B', text: optB.text, images: optB.images },
        { label: 'C', text: optC.text, images: optC.images },
        { label: 'D', text: optD.text, images: optD.images }
    ];
    var explanationStr = getExplanationWithInlineImages('singleExplanation') || '';
    var q = {
        category: section,
        subcategory: subcategory,
        source: source,
        content: stemData.text,
        stemImages: stemData.images,
        material: materialData.text,
        materialImages: materialData.images,
        options: options,
        answer: document.getElementById('singleAnswer').value,
        explanation: explanationStr
    };
    return { ok: true, question: q };
}
function singleQueueAdd() {
    var statusEl = document.getElementById('singleQueueStatus');
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'status-message'; }
    var setIdEl = document.getElementById('singleSetId');
    if (!setIdEl || !setIdEl.value) {
        if (statusEl) { statusEl.textContent = '请先选择套卷，再将题目加入队列。'; statusEl.className = 'status-message error'; }
        return;
    }
    var ziliaoModeEl = document.getElementById('singleZiliaoMode');
    if (ziliaoModeEl && ziliaoModeEl.checked) {
        if (statusEl) { statusEl.textContent = '当前为资料分析（一材料多题）模式，暂不支持加入单题队列，请关闭该模式后使用队列功能。'; statusEl.className = 'status-message error'; }
        return;
    }
    var built = singleQueueBuildQuestion();
    if (!built.ok) {
        if (statusEl) { statusEl.textContent = built.msg || '题目内容不完整，无法加入队列。'; statusEl.className = 'status-message error'; }
        return;
    }
    _singleQueue.push({ setId: setIdEl.value, question: built.question });
    singleQueueUpdateUI();
    if (statusEl) { statusEl.textContent = '已将当前题加入队列（未立即保存到题库）。'; statusEl.className = 'status-message success'; }
    // 不自动清空表单，方便基于上一题微调继续录入
}
function singleQueueImport() {
    var statusEl = document.getElementById('singleQueueStatus');
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'status-message'; }
    if (!_singleQueue.length) {
        if (statusEl) { statusEl.textContent = '队列为空，请先通过“将当前题加入队列”添加题目。'; statusEl.className = 'status-message error'; }
        return;
    }
    if (_singleQueueImportTimer) {
        if (statusEl) { statusEl.textContent = '正在导入中，请稍候…'; statusEl.className = 'status-message'; }
        return;
    }
    var items = _singleQueue.slice();
    var total = items.length;
    var index = 0;
    var imported = 0;
    var perDelay = 50; // 每题约 0.05s
    function step() {
        if (index >= total) {
            store.save();
            renderTree();
            renderSingleHistory();
            _singleQueue = [];
            singleQueueUpdateUI();
            if (statusEl) {
                statusEl.textContent = '已按队列顺序导入 ' + imported + ' 题到对应套卷（每题约 0.05 秒）。';
                statusEl.className = 'status-message success';
            }
            _singleQueueImportTimer = null;
            return;
        }
        var item = items[index];
        index++;
        if (item && item.setId && item.question && item.question.category) {
            var set = store.getSet(item.setId);
            var section = item.question.category;
            if (set) {
                if (typeof ensureCategory === 'function') ensureCategory(section);
                if (!set[section]) set[section] = [];
                store.addQuestion(item.setId, section, Object.assign({}, item.question));
                imported++;
            }
        }
        if (statusEl) {
            statusEl.textContent = '正在导入队列第 ' + index + ' / ' + total + ' 题…';
            statusEl.className = 'status-message';
        }
        _singleQueueImportTimer = setTimeout(step, perDelay);
    }
    step();
}

function updateManageSub() {
    var section = document.getElementById('manageSection').value;
    var sub = document.getElementById('manageSubcategory');
    var opts = section ? (SUBCATEGORIES[section] || []) : [];
    sub.innerHTML = '<option value="">全部</option>' + opts.map(function(s) { return '<option value="' + s + '">' + s + '</option>'; }).join('');
}
function filterManage() {
    var setId = document.getElementById('manageSetId').value;
    var section = document.getElementById('manageSection').value;
    var sub = document.getElementById('manageSubcategory').value;
    var search = (document.getElementById('searchInput').value || '').trim().toLowerCase();
    var ids = store.getAllQuestionIds();
    if (setId) { var set = store.getSet(setId); if (set) ids = MAIN_SECTIONS.reduce(function(a, s) { return a.concat(set[s] || []); }, []); }
    var list = ids.map(function(qid) { return store.getQuestion(qid); }).filter(Boolean);
    if (section) list = list.filter(function(q) { return q.section === section; });
    if (sub) list = list.filter(function(q) { return q.subcategory === sub; });
    if (search) list = list.filter(function(q) { return ((q.content || '') + (q.material || '')).toLowerCase().indexOf(search) !== -1; });
    var container = document.getElementById('questionsList');
    var showAnswer = document.getElementById('manageShowAnswer') && document.getElementById('manageShowAnswer').checked;
    if (!list.length) { container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>暂无题目</p></div>'; return; }
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function imgTag(src) { return '<img src="' + src + '" style="max-width:100%; margin:6px 0;" />'; }
    // 按大类分组
    var groupedBySection = {};
    list.forEach(function(q) {
        var sec = q.section || '未分类';
        if (!groupedBySection[sec]) groupedBySection[sec] = [];
        groupedBySection[sec].push(q);
    });
    var html = '';
    // 按照MAIN_SECTIONS的顺序显示，然后显示其他
    MAIN_SECTIONS.forEach(function(sec) {
        if (groupedBySection[sec] && groupedBySection[sec].length > 0) {
            html += '<div style="margin-bottom:24px;"><h3 style="margin-bottom:12px; padding:12px; background:var(--light-bg); border-left:4px solid var(--primary-color); border-radius:var(--border-radius); color:var(--primary-color); font-size:1.1rem;">' + esc(sec) + ' (' + groupedBySection[sec].length + '题)</h3>';
            groupedBySection[sec].forEach(function(q, i) {
                var histRate = (q.totalAttempts || 0) > 0 ? (q.correctCount || 0) + '/' + q.totalAttempts + ' (' + Math.round(100 * (q.correctCount || 0) / q.totalAttempts) + '%)' : '—';
                var pts = (q.knowledgePoints || []).join('、') || '—';
                var materialHtml = (q.material ? '<p>' + esc(q.material) + '</p>' : '') + (q.materialImages || []).map(imgTag).join('');
                var stemHtml = esc(q.content || '(无题干)') + (q.stemImages || []).map(imgTag).join('');
                var optHtml = (q.options || []).map(function(o) {
                    var optImgs = (o.images || []).map(imgTag).join('');
                    return '<div class="option ' + (showAnswer && o.label === q.answer ? 'correct' : '') + '"><span class="option-label">' + o.label + '.</span> ' + esc(o.text) + optImgs + '</div>';
                }).join('');
                html += '<div class="question-item" style="margin-left:16px; margin-bottom:16px;"><div class="question-header"><span class="question-category">' + esc(q.subcategory || q.section) + '</span> <span style="color:#6c757d;">' + esc(q.source || q.timeRegion || '') + '</span> <span style="font-size:0.9rem;">历史正确率 ' + histRate + '</span> 考点：' + esc(pts) + ' <button class="btn btn-info btn-sm" onclick="showQuestionDetail(\'' + q.id + '\')">题目详情</button> <button class="btn" style="padding:4px 10px; background:#f8d7da;" onclick="deleteQuestion(\'' + q.id + '\')"><i class="fas fa-trash"></i></button></div>' + (materialHtml ? '<div class="question-content" style="margin-bottom:8px;">材料：' + materialHtml + '</div>' : '') + '<div class="question-content">' + (i+1) + '. ' + stemHtml + '</div><div class="options-grid">' + optHtml + '</div>' + (showAnswer && q.explanation ? '<div class="answer-block">解析：<div class="explanation-body">' + explanationToHtml(q.explanation) + '</div></div>' : '') + (showAnswer ? '<div class="answer-block">答案：' + esc(q.answer) + '</div>' : '') + '</div>';
            });
            html += '</div>';
        }
    });
    // 显示其他未分类的
    Object.keys(groupedBySection).forEach(function(sec) {
        if (MAIN_SECTIONS.indexOf(sec) === -1 && groupedBySection[sec] && groupedBySection[sec].length > 0) {
            html += '<div style="margin-bottom:24px;"><h3 style="margin-bottom:12px; padding:12px; background:var(--light-bg); border-left:4px solid var(--primary-color); border-radius:var(--border-radius); color:var(--primary-color); font-size:1.1rem;">' + esc(sec) + ' (' + groupedBySection[sec].length + '题)</h3>';
            groupedBySection[sec].forEach(function(q, i) {
                var histRate = (q.totalAttempts || 0) > 0 ? (q.correctCount || 0) + '/' + q.totalAttempts + ' (' + Math.round(100 * (q.correctCount || 0) / q.totalAttempts) + '%)' : '—';
                var pts = (q.knowledgePoints || []).join('、') || '—';
                var materialHtml = (q.material ? '<p>' + esc(q.material) + '</p>' : '') + (q.materialImages || []).map(imgTag).join('');
                var stemHtml = esc(q.content || '(无题干)') + (q.stemImages || []).map(imgTag).join('');
                var optHtml = (q.options || []).map(function(o) {
                    var optImgs = (o.images || []).map(imgTag).join('');
                    return '<div class="option ' + (showAnswer && o.label === q.answer ? 'correct' : '') + '"><span class="option-label">' + o.label + '.</span> ' + esc(o.text) + optImgs + '</div>';
                }).join('');
                html += '<div class="question-item" style="margin-left:16px; margin-bottom:16px;"><div class="question-header"><span class="question-category">' + esc(q.subcategory || q.section) + '</span> <span style="color:#6c757d;">' + esc(q.source || q.timeRegion || '') + '</span> <span style="font-size:0.9rem;">历史正确率 ' + histRate + '</span> 考点：' + esc(pts) + ' <button class="btn btn-info btn-sm" onclick="showQuestionDetail(\'' + q.id + '\')">题目详情</button> <button class="btn" style="padding:4px 10px; background:#f8d7da;" onclick="deleteQuestion(\'' + q.id + '\')"><i class="fas fa-trash"></i></button></div>' + (materialHtml ? '<div class="question-content" style="margin-bottom:8px;">材料：' + materialHtml + '</div>' : '') + '<div class="question-content">' + (i+1) + '. ' + stemHtml + '</div><div class="options-grid">' + optHtml + '</div>' + (showAnswer && q.explanation ? '<div class="answer-block">解析：<div class="explanation-body">' + explanationToHtml(q.explanation) + '</div></div>' : '') + (showAnswer ? '<div class="answer-block">答案：' + esc(q.answer) + '</div>' : '') + '</div>';
            });
            html += '</div>';
        }
    });
    container.innerHTML = html;
    renderLaTeXInElement(container);
}
function deleteQuestion(qid) {
    if (!confirm('确定删除此题？')) return;
    var setId = store.getQuestion(qid) && store.getQuestion(qid).setId;
    store.removeQuestion(qid);
    store.save();
    renderTree();
    fillSetSelects();
    filterManage();
    checkExportState();
    // 注意：首页的删除题目不同步到 GitHub，只保存到本地
}

var practiceQuestions = [], practiceIndex = 0, practiceUserSelections = {}, practiceStartTime = 0, practiceMode = 'practice', practiceTimerInterval = null;
function updatePracticeSub() {
    var sections = [];
    document.querySelectorAll('input[name="practiceSection"]:checked').forEach(function(cb) { sections.push(cb.value); });
    if (sections.length === 0) sections = MAIN_SECTIONS.slice();
    var subMap = {};
    sections.forEach(function(sec) { (SUBCATEGORIES[sec] || []).forEach(function(s) { subMap[s] = true; }); });
    var opts = Object.keys(subMap).sort();
    var wrap = document.getElementById('practiceSubcategoriesWrap');
    if (wrap) wrap.innerHTML = opts.length ? opts.map(function(s) { return '<label><input type="checkbox" name="practiceSubcategory" value="' + s.replace(/"/g, '&quot;') + '"> ' + s.replace(/</g, '&lt;') + '</label>'; }).join('') : '<span style="color:#6c757d;">请先选择大类</span>';
}
function renderPracticePointsCheckboxes() {
    var wrap = document.getElementById('practicePointsWrap');
    if (!wrap) return;
    var points = store.getAllKnowledgePoints();
    wrap.innerHTML = points.length ? points.map(function(p) { return '<label><input type="checkbox" name="practicePoint" value="' + p.replace(/"/g, '&quot;') + '"> ' + p.replace(/</g, '&lt;') + '</label>'; }).join('') : '<span style="color:#6c757d;">暂无考点，请在题目详情中编辑考点</span>';
}
function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function setSetupPracticeMode(mode) {
    practiceMode = mode;  // 必须更新全局变量，startPractice 会把它传给 practice.html
    var elPractice = document.getElementById('setupModePractice');
    var elMemorize = document.getElementById('setupModeMemorize');
    var hint = document.getElementById('setupModeHint');
    if (elPractice) elPractice.classList.toggle('active', mode === 'practice');
    if (elMemorize) elMemorize.classList.toggle('active', mode === 'memorize');
    if (hint) {
        hint.textContent = mode === 'practice'
            ? '练习模式：选择答案后自动跳到下一题（最后一题除外），做完所有题后点击提交统一查看答案与正确率'
            : '背题模式：一边做一边看答案，选择答案后立刻显示本题答案，由你手动切换下一题，或点击提交查看整体情况';
    }
}
function startPractice() {
    var practiceType = document.getElementById('practiceType').value;
    var questions = [];
    if (practiceType === 'set') {
        var setId = document.getElementById('practiceSetId').value;
        if (!setId) { alert('请选择套卷'); return; }
        questions = store.getQuestionsBySet(setId);
    } else if (practiceType === 'point') {
        var selectedPoints = [];
        document.querySelectorAll('input[name="practicePoint"]:checked').forEach(function(cb) { selectedPoints.push(cb.value); });
        if (!selectedPoints.length) { alert('请至少选择一个考点'); return; }
        var count = parseInt(document.getElementById('practicePointCount').value, 10) || 10;
        questions = store.getRandomQuestionsByKnowledgePoints(selectedPoints, count);
        // 处理资料分析捆绑题型
        questions = expandZiliaoBlockQuestions(questions);
    } else {
        var sections = [];
        document.querySelectorAll('input[name="practiceSection"]:checked').forEach(function(cb) { sections.push(cb.value); });
        if (sections.length === 0) sections = MAIN_SECTIONS.slice();
        var subs = [];
        document.querySelectorAll('input[name="practiceSubcategory"]:checked').forEach(function(cb) { subs.push(cb.value); });
        var count = parseInt(document.getElementById('practiceCount').value, 10) || 10;
        questions = store.getRandomQuestionsBySectionsAndSubs(sections, subs.length ? subs : null, count);
        // 处理资料分析捆绑题型
        questions = expandZiliaoBlockQuestions(questions);
    }
    if (!questions.length) { alert('当前没有符合条件的题目'); return; }
    var setNames = {};
    store.sets.forEach(function(s) { setNames[s.id] = s.name || ''; });
    try {
        sessionStorage.setItem('xingce_practice_session', JSON.stringify({ questions: questions, setNames: setNames, practiceMode: practiceMode }));
    } catch (e) { alert('无法保存练习数据，请检查浏览器设置'); return; }
    window.open('practice.html', '_blank');
}
function onPracticeOptionClick(label) {
    var q = practiceQuestions[practiceIndex];
    if (!q) return;
    practiceUserSelections[practiceIndex] = label;
    renderPracticeQuestion();
    var allAnswered = practiceQuestions.every(function(_, i) { return practiceUserSelections[i]; });
    var doneMsg = document.getElementById('practiceDoneMsg');
    if (doneMsg) doneMsg.style.display = allAnswered ? 'block' : 'none';
}
function renderPracticeQuestion() {
    var q = practiceQuestions[practiceIndex];
    if (!q) return;
    var selected = practiceUserSelections[practiceIndex];
    var setName = '';
    var set = store.getSet(q.setId);
    if (set && set.name) setName = set.name;
    var sourceEl = document.getElementById('practiceQuestionSource');
    if (sourceEl) sourceEl.textContent = setName ? '题目出处：' + setName : '';
    var materialHtml = (q.material ? '<p>' + esc(q.material) + '</p>' : '') + (q.materialImages || []).map(function(src) { return '<img src="' + src + '" style="max-width:100%; margin:8px 0;" />'; }).join('');
    var stemHtml = esc(q.content || '') + (q.stemImages || []).map(function(src) { return '<img src="' + src + '" style="max-width:100%; margin:8px 0;" />'; }).join('');
    var practiceQuestionEl = document.getElementById('practiceQuestion');
    var srcLabel = (q.source || q.timeRegion || '').trim();
    var headerHtml = '<div class="page-question-header">【' + esc(q.section) + '-' + esc(q.subcategory || q.section) + '】' + (srcLabel ? ' <span class="page-question-source">(' + esc(srcLabel) + ')</span>' : '') + '</div>';
    practiceQuestionEl.innerHTML = headerHtml + (materialHtml ? '<div style="margin-bottom:12px;">' + materialHtml + '</div>' : '') + '<div class="question-content">' + stemHtml + '</div>';
    renderLaTeXInElement(practiceQuestionEl);
    var optWrap = document.getElementById('practiceOptionsWrap');
    var options = q.options || [];
    optWrap.innerHTML = options.map(function(o) {
        var text = esc(o.text || '');
        var imgs = (o.images && o.images.length) ? o.images.map(function(src) { return '<img src="' + src + '" style="max-width:100%; margin:4px 0;" />'; }).join('') : '';
        var isSelected = (selected === o.label);
        var cls = 'option-clickable' + (isSelected ? ' selected' : '');
        return '<div class="' + cls + '" data-option="' + o.label + '" onclick="onPracticeOptionClick(\'' + o.label + '\')"><span class="option-label">' + o.label + '.</span> ' + imgs + ' ' + text + (isSelected ? ' <i class="fas fa-check-circle option-check"></i>' : '') + '</div>';
    }).join('');
    renderLaTeXInElement(optWrap);
    document.getElementById('practiceProgress').textContent = (practiceIndex + 1) + ' / ' + practiceQuestions.length;
    document.getElementById('btnPrev').disabled = practiceIndex === 0;
    document.getElementById('btnNext').disabled = practiceIndex === practiceQuestions.length - 1;
    var allAnswered = practiceQuestions.every(function(_, i) { return practiceUserSelections[i]; });
    document.getElementById('practiceDoneMsg').style.display = allAnswered ? 'block' : 'none';
    var navWrap = document.getElementById('practiceQuestionNav');
    if (navWrap && navWrap.style.display !== 'none') renderPracticeQuestionNav();
}
function nextQuestion() { if (practiceIndex < practiceQuestions.length - 1) { practiceIndex++; document.getElementById('practiceDoneMsg').style.display = 'none'; renderPracticeQuestion(); renderPracticeQuestionNav(); } }
function prevQuestion() { if (practiceIndex > 0) { practiceIndex--; document.getElementById('practiceDoneMsg').style.display = 'none'; renderPracticeQuestion(); renderPracticeQuestionNav(); } }
function jumpToQuestion(idx) {
    if (idx < 0 || idx >= practiceQuestions.length) return;
    practiceIndex = idx;
    var allAnswered = practiceQuestions.every(function(_, i) { return practiceUserSelections[i]; });
    document.getElementById('practiceDoneMsg').style.display = allAnswered ? 'block' : 'none';
    renderPracticeQuestion();
    renderPracticeQuestionNav();
}
function renderPracticeQuestionNav() {
    var wrap = document.getElementById('practiceQuestionNav');
    var btns = document.getElementById('practiceQuestionNavBtns');
    if (!wrap || !btns || !practiceQuestions.length) return;
    wrap.style.display = 'block';
    btns.innerHTML = practiceQuestions.map(function(_, i) {
        var ans = practiceUserSelections[i];
        var cls = 'nav-btn' + (i === practiceIndex ? ' active' : '') + (ans ? ' answered' : '');
        return '<button class="' + cls + '" onclick="jumpToQuestion(' + i + ')" title="第' + (i+1) + '题' + (ans ? ' 已选' + ans : ' 未作答') + '">' + (i+1) + '</button>';
    }).join('');
}
var practiceResultIndex = 0;
function submitPractice() {
    practiceQuestions.forEach(function(q, i) {
        var sel = practiceUserSelections[i];
        if (sel != null) store.recordAnswer(q.id, sel, sel === q.answer);
    });
    store.save();
    persistUserQuestionStats();
    practiceResultIndex = 0;
    var total = practiceQuestions.length;
    var correctCount = practiceQuestions.filter(function(q, i) { var sel = practiceUserSelections[i]; return sel != null && sel === q.answer; }).length;
    var rateEl = document.getElementById('practiceCorrectRate');
    if (rateEl) rateEl.textContent = '正确率：' + correctCount + '/' + total + ' (' + (total ? Math.round(100 * correctCount / total) : 0) + '%)';
    document.getElementById('practiceCard').style.display = 'none';
    document.getElementById('practiceQuestionNav').style.display = 'none';
    document.getElementById('practiceResultWrap').style.display = 'block';
    renderResultQuestion();
    renderResultNav();
}
function renderResultQuestion() {
    var q = practiceQuestions[practiceResultIndex];
    if (!q) return;
    var sel = practiceUserSelections[practiceResultIndex] || '—';
    var correct = sel === q.answer;
    var materialHtml = (q.material ? '<p>' + esc(q.material) + '</p>' : '') + (q.materialImages || []).map(function(src) { return '<img src="' + src + '" style="max-width:100%; margin:8px 0;" />'; }).join('');
    var stemHtml = esc(q.content || '') + (q.stemImages || []).map(function(src) { return '<img src="' + src + '" style="max-width:100%; margin:8px 0;" />'; }).join('');
    var optHtml = (q.options || []).map(function(o) {
        var c = '';
        if (o.label === q.answer) c = 'correct';
        else if (o.label === sel && !correct) c = 'wrong';
        return '<div class="option ' + c + '"><span class="option-label">' + o.label + '.</span> ' + esc(o.text) + '</div>';
    }).join('');
    var resultQuestionEl = document.getElementById('practiceResultQuestion');
    var srcLabel2 = (q.source || q.timeRegion || '').trim();
    var headerHtml2 = '<div class="page-question-header">【' + esc(q.section) + '-' + esc(q.subcategory || q.section) + '】' + (srcLabel2 ? ' <span class="page-question-source">(' + esc(srcLabel2) + ')</span>' : '') + '</div>';
    resultQuestionEl.innerHTML =
        headerHtml2 +
        (materialHtml ? '<div style="margin-bottom:12px;">' + materialHtml + '</div>' : '') +
        '<div class="question-content">' + stemHtml + '</div>' +
        '<div class="options-grid" style="margin-top:12px;">' + optHtml + '</div>';
    renderLaTeXInElement(resultQuestionEl);
    var resultAnswerEl = document.getElementById('practiceResultAnswer');
    resultAnswerEl.innerHTML =
        '<div class="' + (correct ? 'correct' : 'wrong') + '" style="padding:12px; border-radius:8px; margin-bottom:12px;">' +
        '你的答案：' + sel + ' | 正确答案：' + q.answer + (correct ? ' <span style="color:var(--success-color);">✓</span>' : ' <span style="color:#dc3545;">✗</span>') +
        '</div>' +
        (q.explanation ? '<p><strong>解析：</strong></p><div class="explanation-body">' + explanationToHtml(q.explanation) + '</div>' : '');
    renderLaTeXInElement(resultAnswerEl);
    document.getElementById('practiceResultProgress').textContent = (practiceResultIndex + 1) + ' / ' + practiceQuestions.length;
    document.getElementById('btnResultPrev').disabled = practiceResultIndex === 0;
    document.getElementById('btnResultNext').disabled = practiceResultIndex === practiceQuestions.length - 1;
    renderResultNav();
}
function prevResultQuestion() { if (practiceResultIndex > 0) { practiceResultIndex--; renderResultQuestion(); } }
function nextResultQuestion() { if (practiceResultIndex < practiceQuestions.length - 1) { practiceResultIndex++; renderResultQuestion(); } }
function jumpToResultQuestion(idx) {
    if (idx < 0 || idx >= practiceQuestions.length) return;
    practiceResultIndex = idx;
    renderResultQuestion();
}
function renderResultNav() {
    var btns = document.getElementById('practiceResultNavBtns');
    if (!btns) return;
    btns.innerHTML = practiceQuestions.map(function(q, i) {
        var sel = practiceUserSelections[i];
        var correct = sel != null && sel === q.answer;
        var cls = 'nav-btn' + (i === practiceResultIndex ? ' active' : '');
        if (sel != null) { if (correct) cls += ' correct'; else cls += ' wrong'; }
        return '<button class="' + cls + '" onclick="jumpToResultQuestion(' + i + ')" title="第' + (i+1) + '题 ' + (sel != null ? (correct ? '正确' : '错误') : '未作答') + ' - 点击查看解析">' + (i+1) + '</button>';
    }).join('');
}
function closePracticeResult() {
    document.getElementById('practiceResultWrap').style.display = 'none';
    document.getElementById('practiceCard').style.display = 'block';
    if (practiceQuestions.length) {
        document.getElementById('practiceQuestionNav').style.display = 'block';
        renderPracticeQuestionNav();
    }
}
function exitPractice() {
    if (practiceTimerInterval) { clearInterval(practiceTimerInterval); practiceTimerInterval = null; }
    document.getElementById('practiceSetup').style.display = 'block';
    document.getElementById('practiceArea').style.display = 'none';
    document.getElementById('practiceCard').style.display = 'block';
    document.getElementById('practiceResultWrap').style.display = 'none';
    document.removeEventListener('keydown', window._practiceKeydown);
}
window._practiceKeydown = function(e) {
    if (document.getElementById('practiceArea').style.display === 'none') return;
    var resultVisible = document.getElementById('practiceResultWrap').style.display !== 'none';
    if (resultVisible) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); prevResultQuestion(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); nextResultQuestion(); }
    } else if (practiceMode === 'memorize') {
        if (e.key === 'ArrowLeft') { e.preventDefault(); prevQuestion(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); nextQuestion(); }
    }
};

function checkExportState() {
    var total = store.getAllQuestionIds().length;
    document.getElementById('exportNoQuestions').style.display = total ? 'none' : 'block';
    document.getElementById('exportControls').style.display = total ? 'block' : 'none';
}
function exportData() {
    var scope = (document.querySelector('input[name="exportScope"]:checked') || {}).value || 'all';
    var setsToExport = store.sets;
    var questionIdsToExport = {};
    if (scope === 'selected') {
        var selectedIds = [];
        document.querySelectorAll('input[name="exportSetId"]:checked').forEach(function(cb) { selectedIds.push(cb.value); });
        if (!selectedIds.length) { showMsg('dataStatus', '请至少勾选一个套卷', 'error'); return; }
        setsToExport = store.sets.filter(function(s) { return selectedIds.indexOf(s.id) !== -1; });
        setsToExport.forEach(function(s) {
            MAIN_SECTIONS.forEach(function(sec) {
                (s[sec] || []).forEach(function(qid) { questionIdsToExport[qid] = true; });
            });
        });
    }
    var questionsExport = {};
    if (scope === 'all') {
        questionsExport = store.questions;
    } else {
        for (var qid in questionIdsToExport) { if (store.questions[qid]) questionsExport[qid] = store.questions[qid]; }
    }
    var data = { sets: setsToExport, questions: questionsExport, exportTime: new Date().toISOString() };
    try {
        var notesRaw = localStorage.getItem('xingce_notes');
        if (notesRaw) { var notes = JSON.parse(notesRaw); if (notes && notes.length) data.notes = notes; }
        var kpHist = localStorage.getItem('xingce_knowledge_point_history');
        if (kpHist) data.knowledgePointHistory = JSON.parse(kpHist);
    } catch (e) {}
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'xingce_data_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showMsg('dataStatus', '已导出 ' + setsToExport.length + ' 个套卷', 'success');
}
var _pendingImportData = null;
function importData() {
    var input = document.getElementById('importDataFile');
    if (!input.files || !input.files.length) { showMsg('dataStatus', '请选择要导入的 JSON 文件', 'error'); return; }
    var mode = (document.querySelector('input[name="importMode"]:checked') || {}).value || 'merge';
    var file = input.files[0];
    var reader = new FileReader();
    reader.onload = function() {
        try {
            var data = JSON.parse(reader.result);
            var sets = data.sets || [];
            var questions = data.questions || {};
            if (!sets.length) { showMsg('dataStatus', 'JSON 中无套卷数据', 'error'); return; }
            _pendingImportData = { sets: sets, questions: questions, mode: mode, notes: data.notes, knowledgePointHistory: data.knowledgePointHistory };
            renderImportSelectSetsList();
            document.getElementById('importSelectSetsModal').style.display = 'flex';
            input.value = '';
        } catch (e) { showMsg('dataStatus', '导入失败：' + (e && e.message), 'error'); }
    };
    reader.readAsText(file);
}
function closeImportSelectSetsModal() {
    document.getElementById('importSelectSetsModal').style.display = 'none';
    _pendingImportData = null;
}
function renderImportSelectSetsList() {
    var listEl = document.getElementById('importSelectSetsList');
    if (!listEl || !_pendingImportData) return;
    var sets = _pendingImportData.sets;
    var questions = _pendingImportData.questions;
    var totalQuestions = 0;
    sets.forEach(function(s) {
        MAIN_SECTIONS.forEach(function(sec) {
            (s[sec] || []).forEach(function(qid) { if (questions[qid]) totalQuestions++; });
        });
    });
    listEl.innerHTML = sets.map(function(s) {
        var count = 0;
        MAIN_SECTIONS.forEach(function(sec) { count += (s[sec] || []).length; });
        return '<label style="display:flex; align-items:center; gap:10px; padding:10px; border-bottom:1px solid var(--border-color); cursor:pointer;"><input type="checkbox" class="import-select-set-cb" value="' + (s.id || '') + '" data-index="' + sets.indexOf(s) + '" checked> <span><strong>' + (s.name || '未命名') + '</strong> <span style="color:var(--text-secondary); font-size:0.9rem;">（' + count + ' 题）</span></span></label>';
    }).join('');
}
function importSelectAllSets(checked) {
    document.querySelectorAll('.import-select-set-cb').forEach(function(cb) { cb.checked = checked; });
}
function executeImportSelectedSets() {
    if (!_pendingImportData) { showMsg('importSelectSetsStatus', '无待导入数据', 'error'); return; }
    var selected = [];
    document.querySelectorAll('.import-select-set-cb:checked').forEach(function(cb) { selected.push(parseInt(cb.dataset.index, 10)); });
    if (!selected.length) { showMsg('importSelectSetsStatus', '请至少勾选一个套卷', 'error'); return; }
    var sets = _pendingImportData.sets;
    var questions = _pendingImportData.questions;
    var mode = _pendingImportData.mode;
    var setsToImport = selected.map(function(i) { return sets[i]; });
    if (mode === 'overwrite') {
        store.sets = [];
        store.questions = {};
    }
    var setIds = {};
    setsToImport.forEach(function(s) {
        var name = (s.name || '').trim();
        var existing = store.sets.find(function(x) { return (x.name || '').trim() === name; });
        if (existing) {
            setIds[s.id] = existing.id;
            MAIN_SECTIONS.forEach(function(sec) {
                var incoming = s[sec] || [];
                incoming.forEach(function(qid) {
                    if (questions[qid] && existing[sec].indexOf(qid) === -1) existing[sec].push(qid);
                });
            });
        } else {
            var id = genId();
            setIds[s.id] = id;
            var init = { id: id, name: name || '未命名', category: s.category || '' };
            (MAIN_SECTIONS || []).forEach(function(sec) { init[sec] = s[sec] || []; });
            store.sets.push(init);
        }
    });
    Object.keys(questions).forEach(function(qid) {
        var q = questions[qid];
        if (!q) return;
        var setId = setIds[q.setId];
        if (setId) {
            q.setId = setId;
            q.knowledgePoints = q.knowledgePoints || (q.knowledgePoint ? [q.knowledgePoint] : []);
            store.questions[qid] = q;
        }
    });
    var cats = getSetCategories();
    var beforeLen = cats.length;
    store.sets.forEach(function(s) {
        if (s.category && cats.indexOf(s.category) < 0) cats.push(s.category);
    });
    if (cats.length > beforeLen) saveSetCategories(cats);
    store.save();
    rebuildSubcategoriesFromStore();
    renderTree();
    fillCategorySelects();
    renderCategoryList();
    fillSetSelects();
    filterSetList();
    updateManageSub();
    updatePracticeSub();
    renderPracticePointsCheckboxes();
    if (_pendingImportData.notes && _pendingImportData.notes.length) {
        try {
            var list = [];
            try { var s = localStorage.getItem('xingce_notes'); list = s ? JSON.parse(s) : []; } catch (e) {}
            var byQid = {};
            list.forEach(function(n) { byQid[n.qid] = n; });
            _pendingImportData.notes.forEach(function(n) {
                if (n && n.qid) byQid[n.qid] = { qid: n.qid, content: n.content || '', images: n.images || [], createdAt: n.createdAt || Date.now() };
            });
            localStorage.setItem('xingce_notes', JSON.stringify(Object.values(byQid)));
        } catch (e) {}
    }
    if (_pendingImportData.knowledgePointHistory && _pendingImportData.knowledgePointHistory.length) {
        try {
            var hist = [];
            try { var h = localStorage.getItem('xingce_knowledge_point_history'); hist = h ? JSON.parse(h) : []; } catch (e) {}
            var set = new Set(hist);
            _pendingImportData.knowledgePointHistory.forEach(function(p) { if (p && String(p).trim()) set.add(String(p).trim()); });
            localStorage.setItem('xingce_knowledge_point_history', JSON.stringify([].slice.call(set)));
        } catch (e) {}
    }
    checkExportState();
    showMsg('dataStatus', '已导入 ' + setsToImport.length + ' 个套卷、共 ' + Object.keys(store.questions).length + ' 道题目', 'success');
    closeImportSelectSetsModal();
}
function onExportScopeChange() {
    var scope = document.getElementById('exportScope').value;
    document.getElementById('categoryExportControls').style.display = scope === 'category' ? 'flex' : 'none';
    document.getElementById('countExportControls').style.display = scope === 'count' ? 'flex' : 'none';
    document.getElementById('exportCountLimitWrap').style.display = (scope === 'all' || scope === 'category') ? 'flex' : 'none';
    if (scope === 'category') updateExportSubcategoryOptions();
}
function updateExportSubcategoryOptions() {
    var cat = document.getElementById('exportCategoryFilter').value;
    var sub = document.getElementById('exportSubcategoryFilter');
    var opts = (SUBCATEGORIES[cat] || []).map(function(s) { return '<option value="' + s + '">' + s + '</option>'; }).join('');
    sub.innerHTML = '<option value="all">全部</option>' + opts;
}
function getExportQuestions() {
    var scope = document.getElementById('exportScope') ? document.getElementById('exportScope').value : 'all';
    var countLimit = parseInt(document.getElementById('exportCount') && document.getElementById('exportCount').value, 10) || 0;
    var countMax = parseInt(document.getElementById('exportCountLimit') && document.getElementById('exportCountLimit').value, 10) || 0;
    var cat = document.getElementById('exportCategoryFilter') ? document.getElementById('exportCategoryFilter').value : '';
    var subEl = document.getElementById('exportSubcategoryFilter');
    var sub = (subEl && subEl.value && subEl.value !== 'all') ? subEl.value : null;
    var list = [];
    if (scope === 'category' && cat) {
        list = store.getQuestionIdsByCategory(cat, sub).map(function(qid) { return store.getQuestion(qid); }).filter(Boolean);
    } else {
        list = store.getAllQuestionIds().map(function(qid) { return store.getQuestion(qid); }).filter(Boolean);
    }
    if (scope === 'count' && countLimit > 0) list = list.slice(0, countLimit);
    else if (countMax > 0) list = list.slice(0, countMax);
    return list;
}
function showMsg(elId, msg, type) {
    var el = document.getElementById(elId);
    if (!el) return;
    // 支持 HTML 内容（如果消息包含 <br> 或 <strong> 等标签）
    if (msg.indexOf('<') >= 0) {
        el.innerHTML = msg;
    } else {
        el.textContent = msg;
    }
    el.className = 'status-message ' + type;
    el.style.display = 'block';
    // 对于包含详细信息的成功消息，延长显示时间
    var autoHideDelay = (type === 'success' && msg.indexOf('<br>') >= 0) ? 10000 : (type === 'success' ? 3000 : 0);
    if (autoHideDelay > 0) {
        setTimeout(function() { el.style.display = 'none'; }, autoHideDelay);
    }
}

function generatePageHTML(questions, mode, pageIndex, globalStartNum, fontSize, includeSource) {
    // 是否在题目页中包含解析 / 正确选项 / 分类信息
    var incExp = (document.getElementById('includeExplanation') && document.getElementById('includeExplanation').checked) !== false;
    var incAns = (document.getElementById('includeAnswer') && document.getElementById('includeAnswer').checked) !== false;
    var incCat = (document.getElementById('includeCategoryInfo') && document.getElementById('includeCategoryInfo').checked) !== false;
    fontSize = fontSize || 11;
    includeSource = includeSource !== false;
    var fs = fontSize + 'px';
    var fsSmall = Math.max(9, fontSize - 1) + 'px';

    var html = '<div class="page-content" style="font-size:' + fs + ';"><div class="page-title">' +
        (mode === 'practice' ? '行测练习题' : '行测学习题') + ' - 第' + pageIndex + '页</div>';

    questions.forEach(function(q, idx) {
        var num = (globalStartNum !== undefined ? globalStartNum + idx : (pageIndex - 1) * questions.length + idx + 1);
        var src = q.source || q.timeRegion || '';
        var setName = '';
        if (includeSource && q.setId) {
            var s = store.getSet(q.setId);
            if (s && s.name) setName = s.name;
        }
        var numPrefix = setName ? num + '（' + esc(setName) + '）：' : num + '. ';

        // 材料（文字 + 图片）
        var materialHtml = '';
        var hasMaterialText = !!(q.material && String(q.material).trim());
        var hasMaterialImages = Array.isArray(q.materialImages) && q.materialImages.length > 0;
        if (hasMaterialText || hasMaterialImages) {
            var materialImgsHtml = (q.materialImages || []).map(function(src) {
                return '<div><img src="' + src + '" style="max-width:100%; margin:4px 0;" /></div>';
            }).join('');
            materialHtml =
                '<div class="page-question-material" style="margin-bottom:8px; font-size:' + fsSmall + ';">' +
                    (hasMaterialText ? '<div>' + esc(q.material || '') + '</div>' : '') +
                    materialImgsHtml +
                '</div>';
        }

        // 题干（文字 + 图片）
        var stemText = esc(q.content || '');
        var stemImgsHtml = (q.stemImages || []).map(function(src) {
            return '<div><img src="' + src + '" style="max-width:100%; margin:4px 0;" /></div>';
        }).join('');
        var stemHtml =
            '<div class="page-question-content" style="font-size:' + fs + ';">' +
                '<strong>' + numPrefix + '</strong>' +
                stemText +
                stemImgsHtml +
            '</div>';

        // 选项（文字 + 图片）
        var optionsHtml = (q.options || []).map(function(o) {
            var imgs = (o.images || []).map(function(src) {
                return '<div><img src="' + src + '" style="max-width:100%; margin:4px 0;" /></div>';
            }).join('');
            if (mode === 'practice') {
                return '<div class="page-option">' + o.label + '. ' + esc(o.text || '') + imgs + '</div>';
            } else {
                var isCorrect = incAns && o.label === q.answer;
                return '<div class="page-option ' + (isCorrect ? 'correct' : '') + '">' +
                    (isCorrect ? '✓ ' : '') +
                    o.label + '. ' + esc(o.text || '') +
                    imgs +
                    '</div>';
            }
        }).join('');

        var headerHtml = '';
        if (incCat) {
            headerHtml =
                '<div class="page-question-header" style="font-size:' + fsSmall + ';">' +
                    '【' + esc(q.section) + '-' + esc(q.subcategory || q.section) + '】' +
                    (src ? '(' + esc(src) + ')' : '') +
                '</div>';
        }

        if (mode === 'practice') {
            html +=
                '<div class="page-question">' +
                    headerHtml +
                    materialHtml +
                    stemHtml +
                    '<div class="page-options" style="font-size:' + fsSmall + ';">' +
                        optionsHtml +
                    '</div>' +
                '</div>';
        } else {
            var expHtml = '';
            if (incExp && q.explanation) {
                expHtml =
                    '<div class="page-answer" style="font-size:' + fsSmall + ';"><strong>解析：</strong><div class="explanation-body">' +
                        explanationToHtml(q.explanation) +
                    '</div></div>';
            }
            html +=
                '<div class="page-question">' +
                    headerHtml +
                    materialHtml +
                    stemHtml +
                    '<div class="page-options" style="font-size:' + fsSmall + ';">' +
                        optionsHtml +
                    '</div>' +
                    expHtml +
                '</div>';
        }
    });

    return html + '</div>';
}
function generateAnswerPageHTML(questions, pageIndex, globalStartNum, fontSize) {
    var incExp = (document.getElementById('includeExplanation') && document.getElementById('includeExplanation').checked) !== false;
    fontSize = fontSize || 11;
    var fs = fontSize + 'px';
    var fsSmall = Math.max(9, fontSize - 1) + 'px';
    var html = '<div class="page-content" style="font-size:' + fs + ';"><div class="page-title">参考答案及解析 - 第' + pageIndex + '页</div>';
    questions.forEach(function(q, idx) {
        var num = (globalStartNum !== undefined ? globalStartNum + idx : (pageIndex - 1) * questions.length + idx + 1);
        html += '<div class="page-question"><div class="page-answer" style="font-size:' + fsSmall + ';"><strong>' + num + '. 答案：' + q.answer + '</strong>' + (incExp && q.explanation ? '<br><strong>解析：</strong><div class="explanation-body">' + explanationToHtml(q.explanation) + '</div>' : '') + '</div></div>';
    });
    return html + '</div>';
}
var PAGE_MAX_HEIGHT = 1050;
function measurePageHeight(html) {
    var temp = document.getElementById('tempContainer');
    if (!temp) return 0;
    temp.innerHTML = html;
    temp.style.visibility = 'visible';
    var pageContent = temp.querySelector('.page-content');
    if (pageContent) pageContent.style.minHeight = '0';
    var h = pageContent ? pageContent.offsetHeight : 0;
    temp.innerHTML = '';
    temp.style.visibility = 'hidden';
    return h;
}
function splitQuestionsIntoPages(questions, mode, fontSize, includeSource, maxPerPage) {
    maxPerPage = Math.min(maxPerPage || 10, Math.max(1, questions.length));
    var pages = [];
    var startIdx = 0;
    var pageNum = 1;
    var globalNum = 1;
    while (startIdx < questions.length) {
        var bestCount = 0;
        for (var n = 1; n <= Math.min(maxPerPage, questions.length - startIdx); n++) {
            var qs = questions.slice(startIdx, startIdx + n);
            var html = mode === 'answer' ? generateAnswerPageHTML(qs, pageNum, globalNum, fontSize) : generatePageHTML(qs, mode, pageNum, globalNum, fontSize, includeSource);
            var h = measurePageHeight(html);
            if (h <= PAGE_MAX_HEIGHT) bestCount = n;
            else break;
        }
        if (bestCount === 0) bestCount = 1;
        pages.push({ questions: questions.slice(startIdx, startIdx + bestCount), pageIndex: pageNum, globalStartNum: globalNum });
        globalNum += bestCount;
        startIdx += bestCount;
        pageNum++;
    }
    return pages;
}
function htmlToImage(html, quality) {
    return new Promise(function(resolve, reject) {
        var temp = document.getElementById('tempContainer');
        temp.innerHTML = html;
        temp.style.visibility = 'visible';
        if (window.renderMathInElement) try { renderMathInElement(temp, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\(', right: '\\)', display: false }, { left: '$', right: '$', display: false }], throwOnError: false }); } catch (e) {}
        setTimeout(function() {
            html2canvas(temp, { scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#fff', logging: false, width: 794, height: 1123 }).then(function(canvas) {
                temp.innerHTML = '';
                temp.style.visibility = 'hidden';
                resolve(canvas.toDataURL('image/jpeg', quality || 0.6));
            }).catch(function(err) { temp.innerHTML = ''; temp.style.visibility = 'hidden'; reject(err); });
        }, 150);
    });
}
async function exportQuestionsToPDFInternal(questions, namePrefix) {
    if (!questions || !questions.length) return;
    namePrefix = namePrefix || '';
    var fontSize = 11;
    var includeSource = true;
    var quality = 0.6;
    var btn = document.getElementById('exportBtn');
    var progressEl = document.getElementById('progressContainer');
    var fillEl = document.getElementById('progressFill');
    var textEl = progressEl ? progressEl.querySelector('.progress-text') : null;
    if (btn) { btn.disabled = true; }
    if (progressEl) { progressEl.style.display = 'block'; }
    try {
        var questionPages = splitQuestionsIntoPages(questions, 'practice', fontSize, includeSource, 10);
        var answerPages = splitQuestionsIntoPages(questions, 'answer', fontSize, includeSource, 20);
        var totalSteps = questionPages.length + answerPages.length;
        var step = 0;
        var jsPDF = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : window.jspdf;
        var pdfQuestions = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        for (var i = 0; i < questionPages.length; i++) {
            var p = questionPages[i];
            if (fillEl) fillEl.style.width = Math.round((++step / totalSteps) * 100) + '%';
            if (textEl) textEl.textContent = '正在生成题目 ' + step + '/' + totalSteps;
            var dataUrl = await htmlToImage(generatePageHTML(p.questions, 'practice', p.pageIndex, p.globalStartNum, fontSize, includeSource), quality);
            if (i > 0) pdfQuestions.addPage();
            pdfQuestions.addImage(dataUrl, 'JPEG', 0, 0, 210, 297);
        }
        pdfQuestions.save((namePrefix || '题目') + '.pdf');
        var pdfAnswers = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        for (var i = 0; i < answerPages.length; i++) {
            var p = answerPages[i];
            if (fillEl) fillEl.style.width = Math.round((++step / totalSteps) * 100) + '%';
            if (textEl) textEl.textContent = '正在生成答案 ' + step + '/' + totalSteps;
            var dataUrl = await htmlToImage(generateAnswerPageHTML(p.questions, p.pageIndex, p.globalStartNum, fontSize), quality);
            if (i > 0) pdfAnswers.addPage();
            pdfAnswers.addImage(dataUrl, 'JPEG', 0, 0, 210, 297);
        }
        pdfAnswers.save((namePrefix ? namePrefix + '_' : '') + '答案.pdf');
    } catch (e) { alert('导出失败：' + (e && e.message)); }
    if (btn) btn.disabled = false;
    if (progressEl) { progressEl.style.display = 'none'; }
    if (fillEl) fillEl.style.width = '0%';
}
async function exportWrongToPDF() {
    var ids = store.getWrongQuestionIds();
    var questions = ids.map(function(qid) { return store.getQuestion(qid); }).filter(Boolean);
    if (!questions.length) { alert('错题本暂无题目'); return; }
    await exportQuestionsToPDFInternal(questions, '错题');
    showMsg('setStatus', '已下载：错题.pdf、错题_答案.pdf', 'success');
}
async function exportPointsToPDF() {
    var ids = store.getAllQuestionIds();
    var questions = ids.map(function(qid) { return store.getQuestion(qid); }).filter(function(q) { return q && (q.knowledgePoints || []).length; });
    if (!questions.length) { alert('暂无带考点的题目'); return; }
    await exportQuestionsToPDFInternal(questions, '考点题目');
    showMsg('setStatus', '已下载：考点题目.pdf、考点题目_答案.pdf', 'success');
}
async function exportToPDF() {
    var questions = getExportQuestions();
    if (!questions.length) { showMsg('exportStatus', '没有可导出的题目', 'error'); return; }
    var fontSize = parseInt(document.getElementById('exportFontSize').value, 10) || 11;
    var includeSource = document.getElementById('exportQuestionSource') && document.getElementById('exportQuestionSource').checked;
    var quality = parseFloat(document.getElementById('imageQuality').value);
    var btn = document.getElementById('exportBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在生成...';
    var progressEl = document.getElementById('progressContainer');
    var fillEl = document.getElementById('progressFill');
    var textEl = document.querySelector('.progress-text');
    progressEl.style.display = 'block';
    try {
        var questionPages = splitQuestionsIntoPages(questions, 'practice', fontSize, includeSource, 10);
        var answerPages = splitQuestionsIntoPages(questions, 'answer', fontSize, includeSource, 20);
        var totalSteps = questionPages.length + answerPages.length;
        var step = 0;
        var jsPDF = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : window.jspdf;
        var pdfQuestions = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        for (var i = 0; i < questionPages.length; i++) {
            var p = questionPages[i];
            fillEl.style.width = Math.round((++step / totalSteps) * 100) + '%';
            if (textEl) textEl.textContent = '正在生成题目 ' + step + '/' + totalSteps;
            var dataUrl = await htmlToImage(generatePageHTML(p.questions, 'practice', p.pageIndex, p.globalStartNum, fontSize, includeSource), quality);
            if (i > 0) pdfQuestions.addPage();
            pdfQuestions.addImage(dataUrl, 'JPEG', 0, 0, 210, 297);
        }
        pdfQuestions.save('题目.pdf');
        var pdfAnswers = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        for (var i = 0; i < answerPages.length; i++) {
            var p = answerPages[i];
            fillEl.style.width = Math.round((++step / totalSteps) * 100) + '%';
            if (textEl) textEl.textContent = '正在生成答案 ' + step + '/' + totalSteps;
            var dataUrl = await htmlToImage(generateAnswerPageHTML(p.questions, p.pageIndex, p.globalStartNum, fontSize), quality);
            if (i > 0) pdfAnswers.addPage();
            pdfAnswers.addImage(dataUrl, 'JPEG', 0, 0, 210, 297);
        }
        pdfAnswers.save('答案.pdf');
        showMsg('exportStatus', '已下载：题目.pdf、答案.pdf', 'success');
    } catch (e) { showMsg('exportStatus', '导出失败：' + (e && e.message), 'error'); }
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-download"></i> 生成并下载（题目 + 答案 两个PDF）';
    progressEl.style.display = 'none';
    fillEl.style.width = '0%';
}
async function previewPDF() {
    var questions = getExportQuestions();
    if (!questions.length) { showMsg('exportStatus', '没有可预览的题目', 'error'); return; }
    var fontSize = parseInt(document.getElementById('exportFontSize').value, 10) || 11;
    var includeSource = document.getElementById('exportQuestionSource') && document.getElementById('exportQuestionSource').checked;
    var quality = parseFloat(document.getElementById('imageQuality').value);
    var container = document.getElementById('imagePreviewContainer');
    var box = document.getElementById('pdfPreview');
    container.innerHTML = '<p>生成预览中…</p>';
    box.style.display = 'block';
    try {
        var questionPages = splitQuestionsIntoPages(questions, 'practice', fontSize, includeSource, 10);
        var answerPages = splitQuestionsIntoPages(questions, 'answer', fontSize, includeSource, 20);
        var html = '<h4>题目</h4>';
        for (var i = 0; i < questionPages.length; i++) {
            var p = questionPages[i];
            var dataUrl = await htmlToImage(generatePageHTML(p.questions, 'practice', p.pageIndex, p.globalStartNum, fontSize, includeSource), quality);
            html += '<div class="image-preview-item"><div class="image-preview-header">题目页 ' + (i+1) + '</div><div class="image-preview-content"><img src="' + dataUrl + '" class="preview-image" alt="页' + (i+1) + '"/></div></div>';
        }
        html += '<h4 style="margin-top:24px;">答案</h4>';
        for (var i = 0; i < answerPages.length; i++) {
            var p = answerPages[i];
            var dataUrl = await htmlToImage(generateAnswerPageHTML(p.questions, p.pageIndex, p.globalStartNum, fontSize), quality);
            html += '<div class="image-preview-item"><div class="image-preview-header">答案页 ' + (i+1) + '</div><div class="image-preview-content"><img src="' + dataUrl + '" class="preview-image" alt="答案' + (i+1) + '"/></div></div>';
        }
        container.innerHTML = html;
        showMsg('exportStatus', '预览已生成', 'success');
    } catch (e) { container.innerHTML = '<div class="empty-state"><p>预览失败：' + (e && e.message) + '</p></div>'; showMsg('exportStatus', '预览失败', 'error'); }
    box.scrollIntoView({ behavior: 'smooth' });
}

// ==================== 管理员题库管理功能 ====================
var ADMIN_PASSWORD = '0710';
var adminAuthenticated = false;

// 管理员独立的数据存储（与首页的store分离）
var adminStore = {
    sets: [],
    questions: {},
    setExistsByName: function(name, excludeSetId) {
        var n = (name || '').trim();
        return this.sets.some(function(s) { return (s.name || '').trim() === n && s.id !== excludeSetId; });
    },
    addSet: function(name, category) {
        var n = (name || '未命名套卷').trim();
        if (this.setExistsByName(n, null)) return null;
        var id = genId();
        var init = { id: id, name: n || '未命名套卷', category: category || '' };
        MAIN_SECTIONS.forEach(function(s) { init[s] = []; });
        this.sets.push(init);
        return id;
    },
    getSet: function(setId) { return this.sets.find(function(s) { return s.id === setId; }); },
    updateSet: function(setId, obj) {
        var set = this.getSet(setId);
        if (!set) return;
        if (obj.name !== undefined && this.setExistsByName(obj.name, setId)) return false;
        if (obj.name !== undefined) set.name = (obj.name || '').trim() || set.name;
        if (obj.category !== undefined) set.category = obj.category;
        return true;
    },
    deleteSet: function(setId) {
        var set = this.getSet(setId);
        if (!set) return;
        var self = this;
        MAIN_SECTIONS.forEach(function(section) {
            (set[section] || []).forEach(function(qid) { delete self.questions[qid]; });
        });
        this.sets = this.sets.filter(function(s) { return s.id !== setId; });
    },
    addQuestion: function(setId, section, q) {
        if (!q.id) q.id = genId();
        q.setId = setId;
        q.section = section;
        q.createdAt = q.createdAt != null ? q.createdAt : Date.now();
        q.done = q.done || false;
        q.correctCount = q.correctCount != null ? q.correctCount : 0;
        q.totalAttempts = q.totalAttempts != null ? q.totalAttempts : 0;
        q.knowledgePoints = Array.isArray(q.knowledgePoints) ? q.knowledgePoints : (q.knowledgePoint ? [q.knowledgePoint] : []);
        this.questions[q.id] = q;
        var set = this.getSet(setId);
        if (set && set[section]) set[section].push(q.id);
        return q.id;
    },
    removeQuestion: function(qid) {
        var q = this.questions[qid];
        if (!q || !q.setId) return;
        var set = this.getSet(q.setId);
        if (set && set[q.section]) set[q.section] = set[q.section].filter(function(id) { return id !== qid; });
        delete this.questions[qid];
    },
    getQuestion: function(qid) { return this.questions[qid]; },
    save: function() {
        if (typeof XingceAdminIDB !== 'undefined' && XingceAdminIDB.set) {
            XingceAdminIDB.set({ sets: this.sets, questions: this.questions }).catch(function() {});
        } else {
            try {
                localStorage.setItem('xingce_admin_sets', JSON.stringify(this.sets));
                localStorage.setItem('xingce_admin_questions', JSON.stringify(this.questions));
            } catch (e) {}
        }
    },
    load: function() {
        var self = this;
        if (typeof XingceAdminIDB !== 'undefined' && XingceAdminIDB.load) {
            return XingceAdminIDB.load().then(function(data) {
                self.sets = data.sets || [];
                self.questions = data.questions || {};
                if (self.sets && MAIN_SECTIONS) {
                    self.sets.forEach(function(set) {
                        MAIN_SECTIONS.forEach(function(sec) {
                            if (!Array.isArray(set[sec])) set[sec] = [];
                        });
                    });
                }
                return self;
            });
        }
        try {
            var s = localStorage.getItem('xingce_admin_sets');
            var q = localStorage.getItem('xingce_admin_questions');
            if (s) this.sets = JSON.parse(s);
            if (q) this.questions = JSON.parse(q);
            if (this.sets && MAIN_SECTIONS) {
                this.sets.forEach(function(set) {
                    MAIN_SECTIONS.forEach(function(sec) {
                        if (!Array.isArray(set[sec])) set[sec] = [];
                    });
                });
            }
        } catch (e) {}
        return Promise.resolve(this);
    }
};

function adminLogin() {
    var password = document.getElementById('adminPassword').value;
    if (password === ADMIN_PASSWORD) {
        adminAuthenticated = true;
        document.getElementById('adminLogin').style.display = 'none';
        document.getElementById('adminContent').style.display = 'block';
        initAdminPage();
        showMsg('adminLoginStatus', '登录成功', 'success');
    } else {
        adminAuthenticated = false;
        showMsg('adminLoginStatus', '密码错误', 'error');
        document.getElementById('adminPassword').value = '';
    }
}

function initAdminPage() {
    if (!adminAuthenticated) return;
    adminStore.load().then(function() {
        if (typeof adminRenderUserList === 'function') adminRenderUserList();
    updateAdminGithubTokenStatus();
    // 读取 data 目录下的 JSON 文件列表（用于选择同步/重置目标）
    try { adminRefreshDataJsonFileList(); } catch (e) {}
    try { adminRefreshSelectedSetsJsonList(); } catch (e) {}
    if (typeof adminRenderSelectedSetsList === 'function') adminRenderSelectedSetsList();
    fillAdminSetSelects();
    fillAdminCategorySelects();
    renderAdminCategoryList();
    adminFilterSetList();
    adminRenderSectionAliasEditor();
    // 加载管理员端小类配置（避免刷新后回到默认/被重建）
    adminLoadSubcategoriesConfigIntoGlobal();
    renderAdminStatsTree();
    updateAdminSingleSub();
    // 初始化大类管理列表
    if (typeof adminRenderMainSectionsList === 'function') adminRenderMainSectionsList();
    refreshAllSectionSelects();
    // 初始化小类名称维护列表
    if (typeof adminLoadSubcategories === 'function') adminLoadSubcategories();
    // 初始化知识管理小类列表
    if (typeof adminKnowledgeLoadSubcategories === 'function') adminKnowledgeLoadSubcategories();
    // 设置默认值：判断推理、图形推理
    document.getElementById('adminSingleSection').value = '判断推理';
    updateAdminSingleSub();
    document.getElementById('adminSingleSubcategory').value = '图形推理';
    setAdminSingleOptionDefaults();
    // 确保批量导入和单题录入区域默认隐藏
    var batchCard = document.getElementById('adminBatchImportCard');
    var singleCard = document.getElementById('adminSingleImportCard');
    if (batchCard) batchCard.style.display = 'none';
    if (singleCard) singleCard.style.display = 'none';
    adminCurrentImportType = null;

    // 若从 admin-set-manage.html 跳回，自动预选套卷并打开录入区
    try {
        if (window.__adminAddToSetId) {
            var setId = window.__adminAddToSetId;
            var t = window.__adminImportType || 'single';
            window.__adminAddToSetId = null;
            window.__adminImportType = null;
            if (t === 'batch') adminBatchImportToSet(setId);
            else adminSingleImportToSet(setId);
        }
    } catch (e) {}

    var adminZiliaoCb = document.getElementById('adminSingleZiliaoMode');
    if (adminZiliaoCb) {
        adminZiliaoCb.addEventListener('change', function() {
            var on = adminZiliaoCb.checked;
            document.getElementById('adminSingleNormalFields').style.display = on ? 'none' : 'block';
            document.getElementById('adminSingleAnswerRow').style.display = on ? 'none' : 'flex';
            var zf = document.getElementById('adminSingleZiliaoFields');
            zf.style.display = on ? 'block' : 'none';
            if (on) {
                document.getElementById('adminSingleSection').value = '资料分析';
                updateAdminSingleSub();
                document.getElementById('adminSingleZiliaoQuestions').innerHTML = '';
                adminSingleZiliaoQIndex = 0;
                for (var i = 0; i < 5; i++) addAdminSingleZiliaoQuestion();
            } else {
                document.getElementById('adminSingleSection').value = '判断推理';
                updateAdminSingleSub();
            }
        });
    }
    document.getElementById('adminSingleSection').addEventListener('change', updateAdminSingleSub);
    });
}

function adminClearLocalStore() {
    if (!confirm('确定要清空本地管理员题库吗？\n\n将删除 IndexedDB 及本地缓存中的套卷与题目数据，不影响云端 JSON。清空后可重新从「从 data 加载」拉取。')) return;
    if (typeof XingceAdminIDB !== 'undefined' && XingceAdminIDB.clear) {
        XingceAdminIDB.clear().then(function() {
            adminStore.sets = [];
            adminStore.questions = {};
            adminFilterSetList();
            fillAdminSetSelects();
            renderAdminStatsTree();
            showMsg('adminSetStatus', '已清空本地储存', 'success');
        }).catch(function() {
            showMsg('adminSetStatus', '清空失败', 'error');
        });
    } else {
        try {
            localStorage.removeItem('xingce_admin_sets');
            localStorage.removeItem('xingce_admin_questions');
            adminStore.sets = [];
            adminStore.questions = {};
            adminFilterSetList();
            fillAdminSetSelects();
            renderAdminStatsTree();
            showMsg('adminSetStatus', '已清空本地储存', 'success');
        } catch (e) {
            showMsg('adminSetStatus', '清空失败', 'error');
        }
    }
}

function getAdminSelectedGitHubJsonPath() {
    var sel = document.getElementById('adminTargetJsonSelect');
    var v = sel ? (sel.value || '').trim() : '';
    // 兜底：如果没有选择器或为空，仍使用默认 data/store.json
    return v || (GITHUB_CONFIG && GITHUB_CONFIG.path) || 'data/store.json';
}

// 刷新 data 目录下的 json 文件列表（使用 GitHub Contents API，确保与仓库一致）
function adminRefreshDataJsonFileList() {
    var sel = document.getElementById('adminTargetJsonSelect');
    if (!sel) return Promise.resolve([]);
    if (!GITHUB_CONFIG.token) {
        // Token 未配置时，仅展示默认项
        sel.innerHTML = '<option value="data/store.json">data/store.json</option>';
        sel.value = 'data/store.json';
        return Promise.resolve(['data/store.json']);
    }
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/data?ref=' + GITHUB_CONFIG.branch;
    var headers = {
        'Authorization': 'token ' + GITHUB_CONFIG.token,
        'Accept': 'application/vnd.github.v3+json'
    };
    var cur = (sel.value || '').trim() || 'data/store.json';
    // 先放一个“加载中…”
    sel.innerHTML = '<option value="' + cur + '">加载中…</option>';
    sel.value = cur;
    return fetch(apiUrl, { method: 'GET', headers: headers })
        .then(function(resp) {
            if (!resp.ok) throw new Error('读取 data 目录失败: ' + resp.status);
            return resp.json();
        })
        .then(function(items) {
            var jsonPaths = [];
            (items || []).forEach(function(it) {
                if (!it || it.type !== 'file' || !it.path) return;
                if (!/\.json$/i.test(it.path)) return;
                // files.json / users.json / remark.json / user.json 不是题库数据文件，排除
                if (it.path === 'data/files.json' || it.path === 'data/users.json' || it.path === 'data/user.json' || it.path === 'data/remark.json') return;
                // data/user/*.json 为用户数据，也不参与题库同步
                if (/^data\/user\//i.test(it.path)) return;
                jsonPaths.push(it.path);
            });
            // 兜底确保包含 data/store.json
            if (jsonPaths.indexOf('data/store.json') === -1) jsonPaths.unshift('data/store.json');
            jsonPaths.sort(function(a, b) { return a.localeCompare(b); });
            sel.innerHTML = jsonPaths.map(function(p) {
                return '<option value="' + p + '">' + p + '</option>';
            }).join('');
            sel.value = (jsonPaths.indexOf(cur) >= 0) ? cur : 'data/store.json';
            return jsonPaths;
        })
        .catch(function(err) {
            // 保底：至少留 store.json
            sel.innerHTML = '<option value="data/store.json">data/store.json</option>';
            sel.value = 'data/store.json';
            showMsg('adminSyncStatus', '刷新 JSON 列表失败：' + (err.message || '未知错误') + '（已使用默认 data/store.json）', 'error');
            return ['data/store.json'];
        });
}

function fillAdminSetSelects() {
    var selects = ['adminBatchSetId', 'adminSingleSetId'];
    selects.forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '<option value="">请选择套卷</option>';
        adminStore.sets.forEach(function(s) {
            var opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name || '未命名';
            el.appendChild(opt);
        });
    });
}

function fillAdminCategorySelects() {
    var el = document.getElementById('adminNewSetCategory');
    if (!el) return;
    var cats = getAdminSetCategories();
    el.innerHTML = '<option value="">不分类</option>';
    cats.forEach(function(c) {
        var opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        el.appendChild(opt);
    });
    var filterEl = document.getElementById('adminSetFilterCategory');
    if (filterEl) {
        filterEl.innerHTML = '<option value="">全部</option>';
        cats.forEach(function(c) {
            var opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            filterEl.appendChild(opt);
        });
    }
}

function renderAdminCategoryList() {
    var container = document.getElementById('adminCategoryList');
    if (!container) return;
    var cats = getAdminSetCategories().filter(function(c) { return c; });
    if (!cats.length) {
        container.innerHTML = '<span style="color: var(--text-secondary);">暂无分类</span>';
        return;
    }
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    container.innerHTML = cats.map(function(c) {
        return '<span class="set-item" style="padding:8px 12px; display:inline-flex; align-items:center; gap:8px; background:var(--surface); border:1px solid var(--border-color); border-radius:var(--border-radius);">' +
            '<span>' + esc(c) + '</span>' +
            '<button class="btn" style="padding:4px 8px; font-size:0.85rem; background:#eaeaea;" onclick="adminRenameCategory(\'' + (c.replace(/'/g,"\\'")) + '\')" title="重命名"><i class="fas fa-edit"></i></button>' +
            '<button class="btn" style="padding:4px 8px; font-size:0.85rem; background:#f8d7da; color:#721c24;" onclick="adminDeleteCategory(\'' + (c.replace(/'/g,"\\'")) + '\')" title="删除"><i class="fas fa-trash"></i></button>' +
            '</span>';
    }).join('');
}

function getAdminUsers() { try { var raw = localStorage.getItem('xingce_admin_users'); return raw ? JSON.parse(raw) : []; } catch (e) { return []; } }
function saveAdminUsers(users) { try { localStorage.setItem('xingce_admin_users', JSON.stringify(users)); } catch (e) {} }
// SHA-256 纯 JavaScript 实现（与小程序端保持一致）
function sha256Hex(str) {
    if (typeof str !== 'string') str = '';
    var utf8 = unescape(encodeURIComponent(str));
    var bytes = [];
    for (var i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i));
    var K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    function rightRotate(x, n) { return (x >>> n) | (x << (32 - n)); }
    function toHex(n) { var s = (n >>> 0).toString(16); return s.length < 8 ? ('00000000' + s).slice(-8) : s; }
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) bytes.push(0);
    var bitLen = (utf8.length * 8);
    for (var i = 7; i >= 0; i--) bytes.push((bitLen >>> (i * 8)) & 0xff);
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    for (var chunk = 0; chunk < bytes.length / 64; chunk++) {
        var W = [];
        for (var t = 0; t < 16; t++) {
            var i = chunk * 64 + t * 4;
            W[t] = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
        }
        for (var t = 16; t < 64; t++) {
            var s0 = rightRotate(W[t - 15], 7) ^ rightRotate(W[t - 15], 18) ^ (W[t - 15] >>> 3);
            var s1 = rightRotate(W[t - 2], 17) ^ rightRotate(W[t - 2], 19) ^ (W[t - 2] >>> 10);
            W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
        }
        var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (var t = 0; t < 64; t++) {
            var S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
            var ch = (e & f) ^ ((~e) & g);
            var t1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
            var S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
            var maj = (a & b) ^ (a & c) ^ (b & c);
            var t2 = (S0 + maj) >>> 0;
            h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        H = [(H[0] + a) >>> 0, (H[1] + b) >>> 0, (H[2] + c) >>> 0, (H[3] + d) >>> 0, (H[4] + e) >>> 0, (H[5] + f) >>> 0, (H[6] + g) >>> 0, (H[7] + h) >>> 0];
    }
    return H.map(toHex).join('');
}
function hashPassword(username, password) {
    var str = (username || '') + ':' + (password || '');
    // 统一使用纯 JavaScript SHA-256 实现，确保与小程序端一致
    return Promise.resolve(sha256Hex(str));
}
function adminAddUser() {
    var username = (document.getElementById('adminNewUserName').value || '').trim();
    var password = document.getElementById('adminNewUserPassword').value || '';
    if (!username) { showMsg('adminUserStatus', '请输入用户名', 'error'); return; }
    if (!password) { showMsg('adminUserStatus', '请输入密码', 'error'); return; }
    var users = getAdminUsers();
    if (users.some(function(u) { return u.username === username; })) { showMsg('adminUserStatus', '该用户名已存在', 'error'); return; }
    hashPassword(username, password).then(function(ph) {
        users.push({ username: username, passwordHash: ph, createdAt: new Date().toISOString() });
        saveAdminUsers(users);
        document.getElementById('adminNewUserName').value = '';
        document.getElementById('adminNewUserPassword').value = '';
        adminRenderUserList();
        showMsg('adminUserStatus', '已添加用户：' + username, 'success');
    }).catch(function() { showMsg('adminUserStatus', '加密失败', 'error'); });
}
function adminEditUser(username) {
    var newPassword = prompt('请输入新密码（留空则不修改）：');
    if (newPassword === null) return;
    if (!newPassword.trim()) return;
    var users = getAdminUsers();
    var idx = users.findIndex(function(u) { return u.username === username; });
    if (idx < 0) return;
    hashPassword(username, newPassword).then(function(ph) {
        users[idx].passwordHash = ph;
        users[idx].updatedAt = new Date().toISOString();
        saveAdminUsers(users);
        adminRenderUserList();
        showMsg('adminUserStatus', '已修改用户：' + username + ' 的密码', 'success');
    }).catch(function() { showMsg('adminUserStatus', '加密失败', 'error'); });
}
function adminDeleteUser(username) {
    if (!confirm('确定删除用户 ' + username + '？')) return;
    var users = getAdminUsers().filter(function(u) { return u.username !== username; });
    saveAdminUsers(users);
    adminRenderUserList();
    showMsg('adminUserStatus', '已删除用户：' + username, 'success');
}
function adminRenderUserList() {
    var listEl = document.getElementById('adminUserList');
    if (!listEl) return;
    var users = getAdminUsers();
    if (!users.length) { listEl.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-secondary);">暂无用户</div>'; return; }
    listEl.innerHTML = users.map(function(u) {
        return '<div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--border-color);"><span><strong>' + (u.username || '') + '</strong> <span style="color:var(--text-secondary); font-size:0.85rem;">' + (u.createdAt ? '创建于 ' + u.createdAt.slice(0,10) : '') + '</span></span><div><button class="btn btn-sm" style="background:var(--light-bg); border:1px solid var(--border-color); margin-right:8px;" onclick="adminEditUser(\'' + (u.username||'').replace(/'/g,"\\'") + '\')"><i class="fas fa-edit"></i> 修改密码</button><button class="btn btn-sm" style="background:#f8d7da; color:#721c24; border-color:#f5c6cb;" onclick="adminDeleteUser(\'' + (u.username||'').replace(/'/g,"\\'") + '\')"><i class="fas fa-trash"></i> 删除</button></div></div>';
    }).join('');
}
function adminSyncUsersToGitHub() {
    if (!GITHUB_CONFIG.token) { showMsg('adminUserStatus', '请先配置 GitHub Token', 'error'); return; }
    if (!GITHUB_CONFIG.owner || !GITHUB_CONFIG.repo) { showMsg('adminUserStatus', '请先配置 GitHub 仓库 owner 与 repo', 'error'); return; }
    var users = getAdminUsers();
    var data = { users: users, exportTime: new Date().toISOString() };
    var content = JSON.stringify(data, null, 2);
    var branch = GITHUB_CONFIG.branch || 'main';
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/data/users.json';
    var headers = { 'Authorization': 'token ' + GITHUB_CONFIG.token, 'Accept': 'application/vnd.github.v3+json' };
    showMsg('adminUserStatus', '正在同步用户列表到 GitHub (分支: ' + branch + ')...', 'info');
    fetch(apiUrl + '?ref=' + branch, { method: 'GET', headers: headers })
        .then(function(r) { if (r.status === 404) return null; if (!r.ok) throw new Error('获取文件失败 ' + r.status); return r.json(); })
        .then(function(fileInfo) {
            var encodedContent;
            try { encodedContent = utf8ToBase64(content); } catch (e) { encodedContent = btoa(unescape(encodeURIComponent(content))); }
            var commitData = { message: 'Sync users list - ' + new Date().toISOString(), content: encodedContent, branch: branch };
            if (fileInfo && fileInfo.sha) commitData.sha = fileInfo.sha;
            return fetch(apiUrl, { method: 'PUT', headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }), body: JSON.stringify(commitData) });
        })
        .then(function(r) {
            if (r.status === 422) {
                return r.json().then(function(body) {
                    if (body && body.message && body.message.indexOf('same') !== -1) {
                        showMsg('adminUserStatus', '用户列表无变化，已与 GitHub 一致', 'success');
                        return { _noNewCommit: true };
                    }
                    throw new Error(body.message || '同步失败(422)');
                });
            }
            if (!r.ok) return r.json().then(function(e) { throw new Error(e.message || '同步失败 ' + r.status); });
            return r.json();
        })
        .then(function(result) {
            if (result && result._noNewCommit) return;
            if (result && result.commit) showMsg('adminUserStatus', '已同步用户列表到 data/users.json（分支: ' + branch + '），小程序可登录', 'success');
            else if (!result || !result._noNewCommit) showMsg('adminUserStatus', '已同步用户列表到 data/users.json', 'success');
        })
        .catch(function(err) { showMsg('adminUserStatus', '同步失败：' + (err.message || '未知错误') + '。请确认 Token 有 repo 权限、仓库与分支正确。', 'error'); });
}
function adminPullUsersFromGitHub() {
    if (!GITHUB_CONFIG.token) { showMsg('adminUserStatus', '请先配置 GitHub Token', 'error'); return; }
    var branch = GITHUB_CONFIG.branch || 'main';
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/data/users.json?ref=' + branch;
    var headers = { 'Authorization': 'token ' + GITHUB_CONFIG.token, 'Accept': 'application/vnd.github.v3+json' };
    showMsg('adminUserStatus', '正在从 GitHub 拉取用户列表...', 'info');
    fetch(apiUrl, { method: 'GET', headers: headers })
        .then(function(r) {
            if (r.status === 404) { showMsg('adminUserStatus', 'GitHub 上暂无 data/users.json，请先同步', 'error'); return null; }
            if (!r.ok) throw new Error('获取失败 ' + r.status);
            return r.json();
        })
        .then(function(fileInfo) {
            if (!fileInfo) return;
            var raw = (fileInfo.content || '').replace(/\s/g, '');
            if (!raw) { showMsg('adminUserStatus', '文件内容为空', 'error'); return; }
            var jsonStr = typeof base64ToUtf8 === 'function' ? base64ToUtf8(raw) : decodeURIComponent(escape(atob(raw)));
            var data = JSON.parse(jsonStr);
            var remote = Array.isArray(data && data.users) ? data.users : [];
            var local = getAdminUsers();
            var byName = {};
            local.forEach(function(u) { if (u && u.username) byName[u.username] = u; });
            remote.forEach(function(u) { if (u && u.username) byName[u.username] = u; });
            var merged = Object.keys(byName).map(function(k) { return byName[k]; });
            merged.sort(function(a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });
            saveAdminUsers(merged);
            adminRenderUserList();
            showMsg('adminUserStatus', '已从 GitHub 拉取并合并用户列表，共 ' + merged.length + ' 个用户', 'success');
        })
        .catch(function(err) { showMsg('adminUserStatus', '拉取失败：' + (err.message || '未知错误'), 'error'); });
}
function getAdminRemarkLocal() {
    try {
        var raw = localStorage.getItem('xingce_admin_remark');
        return raw ? JSON.parse(raw) : { text: '', updatedAt: '' };
    } catch (e) { return { text: '', updatedAt: '' }; }
}
function saveAdminRemarkLocal(data) {
    try { localStorage.setItem('xingce_admin_remark', JSON.stringify(data || {})); } catch (e) {}
}
function adminOpenRemark() {
    var modal = document.getElementById('adminRemarkModal');
    if (!modal) return;
    var d = getAdminRemarkLocal();
    var ta = document.getElementById('adminRemarkText');
    if (ta) ta.value = d.text || '';
    var ua = document.getElementById('adminRemarkUpdatedAt');
    if (ua) ua.textContent = d.updatedAt ? ('最近更新：' + d.updatedAt) : '';
    var st = document.getElementById('adminRemarkStatus');
    if (st) { st.textContent = ''; st.style.display = 'none'; }
    modal.style.display = 'flex';
}
function adminCloseRemark() {
    var modal = document.getElementById('adminRemarkModal');
    if (modal) modal.style.display = 'none';
}
function adminSaveRemarkLocal() {
    var ta = document.getElementById('adminRemarkText');
    if (!ta) return;
    var text = ta.value || '';
    var now = new Date().toLocaleString('zh-CN');
    var data = { text: text, updatedAt: now };
    saveAdminRemarkLocal(data);
    var ua = document.getElementById('adminRemarkUpdatedAt');
    if (ua) ua.textContent = '最近更新：' + now;
    showMsg('adminRemarkStatus', '已保存到本地', 'success');
}
/** 追加一条「套卷→JSON」记录到管理员记事本并实时同步到 GitHub */
function appendSetSyncLogToRemarkAndSyncToGitHub(setNames, targetPath) {
    var now = new Date().toLocaleString('zh-CN');
    var namesStr = (setNames || '').trim() || '未命名';
    var line = '[' + now + '] 套卷「' + namesStr + '」已同步到 ' + (targetPath || '');
    var d = getAdminRemarkLocal();
    var newText = (line + '\n' + (d.text || '')).trim();
    var data = { text: newText, updatedAt: now };
    saveAdminRemarkLocal(data);
    var ta = document.getElementById('adminRemarkText');
    if (ta) ta.value = data.text;
    if (!GITHUB_CONFIG.token) return;
    var payload = { text: newText, updatedAt: now, exportTime: new Date().toISOString() };
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/data/remark.json';
    var headers = { 'Authorization': 'token ' + GITHUB_CONFIG.token, 'Accept': 'application/vnd.github.v3+json' };
    fetch(apiUrl + '?ref=' + GITHUB_CONFIG.branch, { method: 'GET', headers: headers })
        .then(function(r) { if (r.status === 404) return null; if (!r.ok) throw new Error('获取失败 ' + r.status); return r.json(); })
        .then(function(fileInfo) {
            var commitData = { message: '管理员记事本：记录套卷同步 - ' + now, content: utf8ToBase64(JSON.stringify(payload, null, 2)), branch: GITHUB_CONFIG.branch };
            if (fileInfo && fileInfo.sha) commitData.sha = fileInfo.sha;
            return fetch(apiUrl, { method: 'PUT', headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }), body: JSON.stringify(commitData) });
        })
        .then(function(r) { if (!r.ok) return r.json().then(function(e) { throw new Error(e.message || '同步失败'); }); return r.json(); })
        .then(function() { showMsg('adminRemarkStatus', '已记录并同步到 data/remark.json', 'success'); })
        .catch(function(err) { showMsg('adminRemarkStatus', '记事本同步失败：' + (err.message || '未知错误'), 'error'); });
}
function adminSyncRemarkToGitHub() {
    if (!GITHUB_CONFIG.token) {
        showMsg('adminRemarkStatus', '请先配置 GitHub Token', 'error');
        return;
    }
    var ta = document.getElementById('adminRemarkText');
    if (!ta) return;
    var now = new Date().toLocaleString('zh-CN');
    var payload = { text: ta.value || '', updatedAt: now, exportTime: new Date().toISOString() };
    saveAdminRemarkLocal({ text: payload.text, updatedAt: now });
    var ua = document.getElementById('adminRemarkUpdatedAt');
    if (ua) ua.textContent = '最近更新：' + now;
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/data/remark.json';
    var headers = { 'Authorization': 'token ' + GITHUB_CONFIG.token, 'Accept': 'application/vnd.github.v3+json' };
    showMsg('adminRemarkStatus', '正在同步到 GitHub (data/remark.json)...', 'info');
    fetch(apiUrl + '?ref=' + GITHUB_CONFIG.branch, { method: 'GET', headers: headers })
        .then(function(r) { if (r.status === 404) return null; if (!r.ok) throw new Error('获取失败 ' + r.status); return r.json(); })
        .then(function(fileInfo) {
            var content = JSON.stringify(payload, null, 2);
            var commitData = {
                message: '更新管理员备注 - ' + now,
                content: utf8ToBase64(content),
                branch: GITHUB_CONFIG.branch
            };
            if (fileInfo && fileInfo.sha) commitData.sha = fileInfo.sha;
            return fetch(apiUrl, {
                method: 'PUT',
                headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
                body: JSON.stringify(commitData)
            });
        })
        .then(function(r) { if (!r.ok) return r.json().then(function(e) { throw new Error(e.message || '同步失败'); }); return r.json(); })
        .then(function() { showMsg('adminRemarkStatus', '已同步管理员备注到 data/remark.json', 'success'); })
        .catch(function(err) { showMsg('adminRemarkStatus', '同步失败：' + (err.message || '未知错误'), 'error'); });
}
function adminApplySelectedSetsJsonFilter() {
    var sel = document.getElementById('adminSelectedSetsTargetJson');
    if (!sel) return;
    var all = window._adminSelectedSetsJsonAllPaths || ['data/store.json'];
    var searchEl = document.getElementById('adminSelectedSetsJsonSearch');
    var kw = (searchEl && searchEl.value || '').trim().toLowerCase();
    var filtered = all.filter(function(p) {
        if (!kw) return true;
        return String(p).toLowerCase().indexOf(kw) !== -1;
    });
    if (!filtered.length) filtered = all.slice();
    var current = sel.value || '';
    sel.innerHTML = filtered.map(function(p) { return '<option value="' + p + '">' + p + '</option>'; }).join('');
    if (current && filtered.indexOf(current) >= 0) {
        sel.value = current;
    } else if (filtered.length) {
        sel.value = filtered[0];
    }
}
function adminFilterSelectedSetsJsonList() {
    adminApplySelectedSetsJsonFilter();
}
function adminRefreshSelectedSetsJsonList() {
    var sel = document.getElementById('adminSelectedSetsTargetJson');
    if (!sel) return Promise.resolve([]);
    if (!GITHUB_CONFIG.token) {
        window._adminSelectedSetsJsonAllPaths = ['data/store.json'];
        adminApplySelectedSetsJsonFilter();
        return Promise.resolve(['data/store.json']);
    }
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/data?ref=' + GITHUB_CONFIG.branch;
    var headers = { 'Authorization': 'token ' + GITHUB_CONFIG.token, 'Accept': 'application/vnd.github.v3+json' };
    return fetch(apiUrl, { method: 'GET', headers: headers })
        .then(function(r) { if (!r.ok) throw new Error('获取失败'); return r.json(); })
        .then(function(items) {
            var jsonPaths = [];
            items.forEach(function(it) {
                if (!it || it.type !== 'file' || !it.path) return;
                if (!/\.json$/i.test(it.path)) return;
                if (it.path === 'data/files.json' || it.path === 'data/users.json' || it.path === 'data/user.json' || it.path === 'data/remark.json') return;
                if (/^data\/user\//i.test(it.path)) return;
                jsonPaths.push(it.path);
            });
            if (jsonPaths.indexOf('data/store.json') === -1) jsonPaths.unshift('data/store.json');
            jsonPaths.sort(function(a, b) { return a.localeCompare(b); });
            window._adminSelectedSetsJsonAllPaths = jsonPaths.slice();
            adminApplySelectedSetsJsonFilter();
            return jsonPaths;
        })
        .catch(function() {
            window._adminSelectedSetsJsonAllPaths = ['data/store.json'];
            adminApplySelectedSetsJsonFilter();
            return ['data/store.json'];
        });
}
function adminRenderSelectedSetsList() {
    var listEl = document.getElementById('adminSelectedSetsList');
    if (!listEl) return;
    var src = adminStore;
    var sets = (src && src.sets) ? src.sets : [];
    var keywordEl = document.getElementById('adminSelectedSetsSearch');
    var kw = (keywordEl && keywordEl.value || '').trim().toLowerCase();
    var catEl = document.getElementById('adminSelectedSetsCategoryFilter');
    var cat = (catEl && catEl.value) || '';
    // 构建分类下拉
    if (catEl) {
        var catMap = {};
        sets.forEach(function(s) {
            if (s && s.category) catMap[s.category] = true;
        });
        var cats = Object.keys(catMap).sort(function(a, b) { return String(a).localeCompare(String(b)); });
        var prev = catEl.value;
        catEl.innerHTML = '<option value=\"\">全部分类</option>' + cats.map(function(c) { return '<option value=\"' + esc(c) + '\">' + esc(c) + '</option>'; }).join('');
        if (prev && cats.indexOf(prev) >= 0) {
            catEl.value = prev;
            cat = prev;
        } else {
            catEl.value = '';
            cat = '';
        }
    }
    if (!sets.length) {
        listEl.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-secondary);">暂无套卷（请先在管理员题库中添加）</div>';
        return;
    }
    var MAIN_SECTIONS = window.MAIN_SECTIONS || ['言语理解', '数量关系', '判断推理', '资料分析', '政治理论', '常识判断'];
    var filtered = sets.filter(function(s) {
        if (!s) return false;
        var name = String(s.name || '').toLowerCase();
        if (kw && name.indexOf(kw) === -1) return false;
        if (cat && String(s.category || '') !== cat) return false;
        return true;
    });
    if (!filtered.length) {
        listEl.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-secondary);">暂无匹配的套卷，请调整搜索或分类筛选。</div>';
        return;
    }
    listEl.innerHTML = filtered.map(function(s) {
        var count = 0;
        MAIN_SECTIONS.forEach(function(sec) { count += (s[sec] || []).length; });
        return '<label style="display:flex; align-items:center; gap:10px; padding:10px; border-bottom:1px solid var(--border-color); cursor:pointer;"><input type="checkbox" class="admin-selected-set-cb" value="' + (s.id || '') + '" data-set-id="' + (s.id || '') + '"> <span><strong>' + (s.name || '未命名') + '</strong> <span style="color:var(--text-secondary); font-size:0.85rem;">（' + count + ' 题' + (s.category ? '，' + s.category : '') + '）</span></span></label>';
    }).join('');
}
function adminSelectAllSetsForSync(checked) {
    document.querySelectorAll('.admin-selected-set-cb').forEach(function(cb) { cb.checked = checked; });
}
function adminCompressImageDataUrl(dataUrl, maxWidth, quality) {
    maxWidth = maxWidth || 720;
    quality = quality || 0.7;
    if (!dataUrl || typeof dataUrl !== 'string' || dataUrl.indexOf('data:image') !== 0) return Promise.resolve(dataUrl);
    return new Promise(function(resolve) {
        var img = new Image();
        img.onload = function() {
            var w = img.width, h = img.height, maxPixels = 720 * 720;
            if (w <= maxWidth && w * h <= maxPixels) {
                try {
                    var c = document.createElement('canvas'); c.width = w; c.height = h;
                    var ctx = c.getContext('2d');
                    if (ctx) { ctx.drawImage(img, 0, 0, w, h); resolve(c.toDataURL('image/jpeg', quality) || dataUrl); return; }
                } catch (e) {}
                resolve(dataUrl);
                return;
            }
            if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
            if (w * h > maxPixels) { var s = Math.sqrt(maxPixels / (w * h)); w = Math.round(w * s); h = Math.round(h * s); }
            try {
                var c = document.createElement('canvas'); c.width = w; c.height = h;
                c.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(c.toDataURL('image/jpeg', quality) || dataUrl);
            } catch (e) { resolve(dataUrl); }
        };
        img.onerror = function() { resolve(dataUrl); };
        img.src = dataUrl;
    });
}
function adminCompressQuestionImages(q) {
    if (!q) return Promise.resolve(q);
    var out = {};
    for (var k in q) if (Object.prototype.hasOwnProperty.call(q, k)) out[k] = q[k];
    var promises = [];
    if (Array.isArray(out.stemImages)) {
        out.stemImages = out.stemImages.slice();
        out.stemImages.forEach(function(src, i) {
            promises.push(adminCompressImageDataUrl(src).then(function(c) { out.stemImages[i] = c; }));
        });
    }
    if (Array.isArray(out.materialImages)) {
        out.materialImages = out.materialImages.slice();
        out.materialImages.forEach(function(src, i) {
            promises.push(adminCompressImageDataUrl(src).then(function(c) { out.materialImages[i] = c; }));
        });
    }
    if (Array.isArray(out.options)) {
        out.options = out.options.slice();
        out.options.forEach(function(opt, oi) {
            if (Array.isArray(opt.images)) {
                out.options[oi] = { label: opt.label, text: opt.text, images: opt.images.slice() };
                opt.images.forEach(function(src, i) {
                    promises.push(adminCompressImageDataUrl(src).then(function(c) { out.options[oi].images[i] = c; }));
                });
            } else { out.options[oi] = opt; }
        });
    }
    return Promise.all(promises).then(function() { return out; });
}
function adminCompressQuestionsObject(questions) {
    var qids = Object.keys(questions || {});
    if (!qids.length) return Promise.resolve(questions || {});
    return Promise.all(qids.map(function(qid) {
        return adminCompressQuestionImages(questions[qid]).then(function(c) { return { qid: qid, q: c }; });
    })).then(function(results) {
        var out = {};
        results.forEach(function(r) { out[r.qid] = r.q; });
        return out;
    });
}
function adminSyncSelectedSetsToJson() {
    if (!GITHUB_CONFIG.token) {
        showMsg('adminSelectedSetsSyncStatus', '请先配置 GitHub Token', 'error');
        return;
    }
    var selected = [];
    document.querySelectorAll('.admin-selected-set-cb:checked').forEach(function(cb) { selected.push(cb.dataset.setId); });
    if (!selected.length) {
        showMsg('adminSelectedSetsSyncStatus', '请至少勾选一个套卷', 'error');
        return;
    }
    var targetPath = document.getElementById('adminSelectedSetsTargetJson').value || 'data/store.json';
    var mode = (document.querySelector('input[name="adminSelectedSetsSyncMode"]:checked') || {}).value || 'merge';
    // 数据来源：当前仅支持从管理员题库同步
    // 这里不再使用 :checked 选择器，而是直接读取隐藏字段的值，
    // 确保使用 adminStore 作为数据源，避免出现“已勾选套卷但同步为 0 套”的问题。
    var sourceInput = document.querySelector('input[name="adminSyncSource"]') || {};
    var sourceValue = sourceInput.value || 'admin';
    var useStore = sourceValue !== 'admin';
    var MAIN_SECTIONS = window.MAIN_SECTIONS || ['言语理解', '数量关系', '判断推理', '资料分析', '政治理论', '常识判断'];
    function doSync(src) {
        if (!src || !src.sets) {
            showMsg('adminSelectedSetsSyncStatus', '数据源不可用', 'error');
            return;
        }
        showMsg('adminSelectedSetsSyncStatus', '正在压缩题目图片以减小 JSON 体积…', 'info');
        var selectedSets = src.sets.filter(function(s) { return selected.indexOf(s.id) !== -1; });
        var selectedQuestionIds = {};
        selectedSets.forEach(function(s) {
            MAIN_SECTIONS.forEach(function(sec) {
                (s[sec] || []).forEach(function(qid) { selectedQuestionIds[qid] = true; });
            });
        });
        var selectedQuestions = {};
        Object.keys(selectedQuestionIds).forEach(function(qid) {
            if (src.questions && src.questions[qid]) selectedQuestions[qid] = src.questions[qid];
        });
        var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/' + targetPath;
        var headers = { 'Authorization': 'token ' + GITHUB_CONFIG.token, 'Accept': 'application/vnd.github.v3+json' };
        adminCompressQuestionsObject(selectedQuestions).then(function(compressedQuestions) {
            selectedQuestions = compressedQuestions;
            showMsg('adminSelectedSetsSyncStatus', '正在同步选中套卷到 ' + targetPath + ' ...', 'info');
            var exportData = { sets: selectedSets, questions: selectedQuestions, exportTime: new Date().toISOString() };
            return fetch(apiUrl + '?ref=' + GITHUB_CONFIG.branch, { method: 'GET', headers: headers })
        .then(function(resp) {
            if (resp.status === 404) return null;
            if (!resp.ok) throw new Error('获取文件信息失败: ' + resp.status);
            return resp.json();
        })
        .then(function(fileInfo) {
            var finalData;
            if (mode === 'overwrite') {
                finalData = exportData;
            } else {
                if (fileInfo && fileInfo.content) {
                    try {
                        var existingContent = base64ToUtf8(fileInfo.content);
                        var existingData = deepRepairMojibake(JSON.parse(existingContent));
                        var mergedSets = [];
                        var setIdMap = {};
                        (existingData.sets || []).forEach(function(s) {
                            var existing = selectedSets.find(function(ss) { return (ss.name || '').trim() === (s.name || '').trim(); });
                            if (existing) {
                                setIdMap[s.id] = existing.id;
                                mergedSets.push(existing);
                            } else {
                                setIdMap[s.id] = s.id;
                                mergedSets.push(s);
                            }
                        });
                        selectedSets.forEach(function(s) {
                            if (!mergedSets.find(function(ms) { return ms.id === s.id; })) mergedSets.push(s);
                        });
                        var mergedQuestions = {};
                        Object.keys(existingData.questions || {}).forEach(function(qid) {
                            var q = existingData.questions[qid];
                            if (q.setId && setIdMap[q.setId]) {
                                q.setId = setIdMap[q.setId];
                                mergedQuestions[qid] = q;
                            }
                        });
                        Object.keys(selectedQuestions).forEach(function(qid) {
                            mergedQuestions[qid] = selectedQuestions[qid];
                        });
                        finalData = { sets: mergedSets, questions: mergedQuestions, exportTime: new Date().toISOString() };
                    } catch (e) {
                        finalData = exportData;
                    }
                } else {
                    finalData = exportData;
                }
            }
            var content = JSON.stringify(finalData, null, 2);
            var encodedContent = utf8ToBase64(content);
            var commitData = { message: '同步选中套卷到 ' + targetPath + ' - ' + new Date().toLocaleString('zh-CN') + ' (' + mode + ')', content: encodedContent, branch: GITHUB_CONFIG.branch };
            if (fileInfo && fileInfo.sha) commitData.sha = fileInfo.sha;
            return fetch(apiUrl, { method: 'PUT', headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }), body: JSON.stringify(commitData) });
        })
        .then(function(resp) {
            if (!resp.ok) return resp.json().then(function(err) { throw new Error(err.message || '同步失败'); });
            return resp.json();
        })
        .then(function(result) {
            showMsg('adminSelectedSetsSyncStatus', '成功同步 ' + selectedSets.length + ' 个套卷到 ' + targetPath + ' (' + (result.commit.html_url || '') + ')', 'success');
            var setNames = selectedSets.map(function(s) { return s.name || '未命名'; }).join('」「');
            appendSetSyncLogToRemarkAndSyncToGitHub(setNames, targetPath);
        });
    }).catch(function(err) {
        showMsg('adminSelectedSetsSyncStatus', '同步失败：' + (err && err.message ? err.message : '未知错误'), 'error');
    });
    }
    if (useStore) {
        doSync(store);
    } else {
        showMsg('adminSelectedSetsSyncStatus', '正在从本地管理员题库重新加载…', 'info');
        adminStore.load().then(function() {
            doSync(adminStore);
        }).catch(function(err) {
            showMsg('adminSelectedSetsSyncStatus', '加载管理员题库失败：' + (err && err.message ? err.message : '未知错误'), 'error');
        });
    }
}
/** 从小程序复制的题库数据：粘贴后保存到 data/store.json（免后端） */
function adminSyncPastedStoreToGitHub() {
    if (!GITHUB_CONFIG.token) {
        showMsg('adminPasteStoreStatus', '请先配置 GitHub Token', 'error');
        return;
    }
    var input = document.getElementById('adminPasteStoreInput');
    var text = (input && input.value) ? input.value.trim() : '';
    if (!text) { showMsg('adminPasteStoreStatus', '请先粘贴小程序复制的题库数据', 'error'); return; }
    var d;
    try { d = JSON.parse(text); } catch (e) { showMsg('adminPasteStoreStatus', '粘贴的不是有效 JSON', 'error'); return; }
    if (!d || typeof d !== 'object') {
        showMsg('adminPasteStoreStatus', '数据格式错误，需包含 sets 数组和 questions/question 对象', 'error');
        return;
    }
    // 兼容老版本/小程序端字段：支持 d.questions 或 d.question
    var sets = Array.isArray(d.sets) ? d.sets : [];
    var questions = d.questions || d.question || {};
    if (!Array.isArray(sets) || !questions || typeof questions !== 'object') {
        showMsg('adminPasteStoreStatus', '数据格式错误，需包含 sets 数组和 questions/question 对象', 'error');
        return;
    }
    var content = JSON.stringify({ sets: sets, questions: questions, exportTime: d.exportTime || new Date().toISOString() }, null, 2);
    var files = [{ path: 'data/store.json', content: content, message: '小程序管理员保存题库 - ' + new Date().toLocaleString('zh-CN') }];
    showMsg('adminPasteStoreStatus', '正在保存到 GitHub…', 'info');
    uploadUserFiles(files, 0, function() {
        showMsg('adminPasteStoreStatus', '已保存到 data/store.json', 'success');
        if (input) input.value = '';
    }, function(err) {
        showMsg('adminPasteStoreStatus', '保存失败：' + (err.message || '未知错误'), 'error');
    });
}
function adminAddCategory() {
    var name = (document.getElementById('adminNewCategoryName').value || '').trim();
    if (!name) {
        showMsg('adminCategoryStatus', '请输入分类名称', 'error');
        return;
    }
    var cats = getAdminSetCategories();
    if (cats.indexOf(name) >= 0) {
        showMsg('adminCategoryStatus', '该分类已存在', 'error');
        return;
    }
    cats.push(name);
    cats.sort(function(a,b) { return (a||'').localeCompare(b||''); });
    saveAdminSetCategories(cats);
    document.getElementById('adminNewCategoryName').value = '';
    fillAdminCategorySelects();
    renderAdminCategoryList();
    adminFilterSetList();
    showMsg('adminCategoryStatus', '已添加分类：' + name, 'success');
}

function adminDeleteCategory(name) {
    var cats = getAdminSetCategories();
    var idx = cats.indexOf(name);
    if (idx < 0) return;
    var used = adminStore.sets.some(function(s) { return (s.category||'') === name; });
    if (used && !confirm('有套卷使用该分类，删除后这些套卷将变为「不分类」。确定删除？')) return;
    adminStore.sets.forEach(function(s) { if ((s.category||'') === name) s.category = ''; });
    adminStore.save();
    cats.splice(idx, 1);
    saveAdminSetCategories(cats);
    fillAdminCategorySelects();
    renderAdminCategoryList();
    adminFilterSetList();
    showMsg('adminCategoryStatus', '已删除分类', 'success');
}

function adminRenameCategory(oldName) {
    var newName = prompt('请输入新的分类名称：', oldName);
    if (newName == null || (newName = newName.trim()) === '') return;
    var cats = getAdminSetCategories();
    if (cats.indexOf(newName) >= 0 && newName !== oldName) {
        alert('该分类名已存在');
        return;
    }
    var idx = cats.indexOf(oldName);
    if (idx >= 0) cats[idx] = newName;
    adminStore.sets.forEach(function(s) { if ((s.category||'') === oldName) s.category = newName; });
    adminStore.save();
    saveAdminSetCategories(cats);
    fillAdminCategorySelects();
    renderAdminCategoryList();
    adminFilterSetList();
    showMsg('adminCategoryStatus', '已重命名分类', 'success');
}

function adminAddSet() {
    var name = (document.getElementById('adminNewSetName').value || '').trim() || '未命名套卷';
    var category = (document.getElementById('adminNewSetCategory').value || '').trim();
    var id = adminStore.addSet(name, category);
    if (id == null) {
        showMsg('adminSetStatus', '套卷名称已存在，不可重复', 'error');
        return;
    }
    adminStore.save();
    document.getElementById('adminNewSetName').value = '';
    document.getElementById('adminNewSetCategory').value = '';
    fillAdminSetSelects();
    adminFilterSetList();
    if (typeof adminRenderSelectedSetsList === 'function') adminRenderSelectedSetsList();
    showMsg('adminSetStatus', '套卷已创建（已保存到管理员题库）', 'success');
}

function adminRefreshSetList() {
    adminStore.load();
    fillAdminSetSelects();
    adminFilterSetList();
    if (typeof adminRenderSelectedSetsList === 'function') adminRenderSelectedSetsList();
    showMsg('adminSetStatus', '已刷新套卷列表', 'success');
}

// 个人中心：显示/关闭/执行「从 data 加载」（选择 JSON）
function profileShowLoadFromDataModal() {
    var modal = document.getElementById('profileLoadFromDataModal');
    if (!modal) return;
    if (!window.fetch) {
        showMsg('dataStatus', '当前浏览器不支持在线刷新题库（缺少 fetch）。', 'error');
        return;
    }
    if (location && location.protocol === 'file:') {
        showMsg(
            'dataStatus',
            '从 data 加载失败：当前通过 file:// 打开页面，浏览器禁止 fetch 读取本地 data 文件。请使用本地 HTTP 服务打开（如 VSCode Live Server / http-server / python http.server），或访问已部署的网站。',
            'error'
        );
        return;
    }
    modal.style.display = 'flex';
    var listEl = document.getElementById('profileLoadJsonFileList');
    if (listEl) listEl.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:20px;">正在加载文件列表...</p>';
    var st = document.getElementById('profileLoadFromDataStatus');
    if (st) st.style.display = 'none';
    profileLoadJsonFileList();
}
function profileCloseLoadFromDataModal() {
    var modal = document.getElementById('profileLoadFromDataModal');
    if (modal) modal.style.display = 'none';
}
function profileRenderLoadJsonFileList(jsonNames) {
    var listEl = document.getElementById('profileLoadJsonFileList');
    if (!listEl) return;
    if (!jsonNames || !jsonNames.length) {
        listEl.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:20px;">没有找到 JSON 文件</p>';
        return;
    }
    listEl.innerHTML = jsonNames.map(function(name) {
        var safe = String(name || '').replace(/^data\//, '').trim();
        var display = 'data/' + safe;
        return '<label style="display:flex; align-items:center; gap:8px; padding:8px; border-bottom:1px solid var(--border-color); cursor:pointer;">' +
            '<input type="checkbox" class="profile-load-json-checkbox" value="' + safe.replace(/"/g, '&quot;') + '" onchange="profileUpdateLoadJsonSelection()">' +
            '<span>' + display.replace(/</g, '&lt;') + '</span></label>';
    }).join('');
}
function profileLoadJsonFileList() {
    var manifestUrl = getDataFileUrl('files.json') + '?t=' + Date.now();
    fetch(manifestUrl)
        .then(function(resp) {
            if (!resp.ok) throw new Error('files.json 未找到');
            return resp.json();
        })
        .then(function(manifest) {
            var jsonList = Array.isArray(manifest && manifest.json) ? manifest.json : (manifest && manifest.json ? [manifest.json] : ['store.json']);
            jsonList = (jsonList || []).map(function(n) { return String(n || '').replace(/^data\//, '').trim(); }).filter(Boolean);
            if (!jsonList.length) jsonList = ['store.json'];
            profileRenderLoadJsonFileList(jsonList);
        })
        .catch(function(err) {
            var listEl = document.getElementById('profileLoadJsonFileList');
            if (listEl) {
                // 兜底：files.json 不可用时，至少允许加载 store.json
                listEl.innerHTML =
                    '<p style="color:#dc3545; text-align:center; padding:12px;">加载文件列表失败：' + ((err && err.message) ? err.message : '未知错误') + '；已兜底为 store.json</p>' +
                    '<label style="display:flex; align-items:center; gap:8px; padding:8px; border-top:1px solid var(--border-color); cursor:pointer;">' +
                    '<input type="checkbox" class="profile-load-json-checkbox" value="store.json" onchange="profileUpdateLoadJsonSelection()">' +
                    '<span>data/store.json</span></label>';
            }
        });
}
function profileToggleLoadAllJson(checked) {
    var loadAll = arguments.length > 0 ? !!checked : (document.getElementById('profileLoadAllJson') && document.getElementById('profileLoadAllJson').checked);
    var checkboxes = document.querySelectorAll('.profile-load-json-checkbox');
    checkboxes.forEach(function(cb) {
        cb.checked = loadAll;
    });
    profileUpdateLoadJsonSelection();
}
function profileUpdateLoadJsonSelection() {
    var checkboxes = document.querySelectorAll('.profile-load-json-checkbox');
    var allChecked = Array.from(checkboxes).length > 0 && Array.from(checkboxes).every(function(cb) { return cb.checked; });
    var allEl = document.getElementById('profileLoadAllJson');
    if (allEl) allEl.checked = allChecked;
}
function profileApplyJsonPayloadsToStore(payloads) {
    var mergedSets = [];
    var mergedQuestions = {};
    var incomingSetIds = new Set();
    (payloads || []).forEach(function(data) {
        if (!data) return;
        (data.sets || []).forEach(function(s) {
            if (s && s.id && !incomingSetIds.has(s.id)) {
                mergedSets.push(s);
                incomingSetIds.add(s.id);
            }
        });
        var qs = data.questions || {};
        if (qs && typeof qs === 'object') {
            Object.keys(qs).forEach(function(qid) { if (qs[qid]) mergedQuestions[qid] = qs[qid]; });
        }
    });

    if (mergedSets.length || Object.keys(mergedQuestions).length) {
        // 反向索引：通过 sets 中的题号列表推断每题所属套卷/大类
        var qToSetId = {};
        var qToSection = {};
        mergedSets.forEach(function(s) {
            if (!s || !s.id) return;
            MAIN_SECTIONS.forEach(function(sec) {
                (s[sec] || []).forEach(function(qid) {
                    if (!qid) return;
                    qToSetId[qid] = s.id;
                    qToSection[qid] = sec;
                });
            });
        });

        // 按套卷名称合并
        var setIdMap = {};
        mergedSets.forEach(function(s) {
            var name = (s.name || '').trim();
            var existing = store.sets.find(function(x) { return (x.name || '').trim() === name; });
            if (existing) {
                setIdMap[s.id] = existing.id;
                MAIN_SECTIONS.forEach(function(sec) {
                    if (!Array.isArray(existing[sec])) existing[sec] = [];
                    (s[sec] || []).forEach(function(qid) {
                        if (mergedQuestions[qid] && existing[sec].indexOf(qid) === -1) existing[sec].push(qid);
                    });
                });
            } else {
                var id = genId();
                setIdMap[s.id] = id;
                var newSet = { id: id, name: name || '未命名', category: s.category || '' };
                (MAIN_SECTIONS || []).forEach(function(sec) { newSet[sec] = (s[sec] || []).slice(); });
                store.sets.push(newSet);
            }
        });

        // 题目按 qid 覆盖，并修复 setId/section
        Object.keys(mergedQuestions).forEach(function(qid) {
            var q = mergedQuestions[qid];
            if (!q) return;
            var srcSetId = q.setId;
            if (!srcSetId || !setIdMap[srcSetId]) srcSetId = qToSetId[qid];
            if (srcSetId && setIdMap[srcSetId]) {
                q.setId = setIdMap[srcSetId];
                if (!q.section && qToSection[qid]) q.section = qToSection[qid];
                q.knowledgePoints = q.knowledgePoints || (q.knowledgePoint ? [q.knowledgePoint] : []);
                store.questions[qid] = q;
            }
        });
    }

    // 刷新分类、统计和界面
    var cats = getSetCategories();
    var beforeLen = cats.length;
    store.sets.forEach(function(s) { if (s.category && cats.indexOf(s.category) < 0) cats.push(s.category); });
    if (cats.length > beforeLen) saveSetCategories(cats);
    // 写入 localStorage 时可能因浏览器配额不足失败，此时仅提示用户，继续保留内存中的题库
    try {
        store.save();
    } catch (e) {
        showMsg(
            'profileLoadFromDataStatus',
            '题库已加载到当前页面，但保存到浏览器本地缓存失败：' +
                (e && e.message ? e.message : '超过浏览器存储配额') +
                '。建议减少单次加载的 JSON 数量，或在刷新题库前清理浏览器本地存储。',
            'warning'
        );
    }
    rebuildSubcategoriesFromStore();
    renderTree();
    fillCategorySelects();
    renderCategoryList();
    fillSetSelects();
    if (typeof filterSetList === 'function') filterSetList();
    if (typeof updateManageSub === 'function') updateManageSub();
    if (typeof updatePracticeSub === 'function') updatePracticeSub();
    if (typeof renderPracticePointsCheckboxes === 'function') renderPracticePointsCheckboxes();
    if (typeof checkExportState === 'function') checkExportState();
}
function profileLoadFromDataExecute() {
    var selectedFiles = Array.from(document.querySelectorAll('.profile-load-json-checkbox:checked')).map(function(cb) { return cb.value; });
    if (!selectedFiles.length) {
        showMsg('profileLoadFromDataStatus', '请至少选择一个 JSON 文件', 'error');
        return;
    }
    if (!window.fetch) {
        showMsg('profileLoadFromDataStatus', '当前浏览器不支持 fetch', 'error');
        return;
    }
    if (location && location.protocol === 'file:') {
        showMsg('profileLoadFromDataStatus', '请通过 HTTP 服务访问（非 file://）', 'error');
        return;
    }

    var statusEl = document.getElementById('profileLoadFromDataStatus');
    var total = selectedFiles.length;
    var completed = 0;

    function renderProgress() {
        var percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        if (!statusEl) {
            showMsg('profileLoadFromDataStatus', '正在从 ' + completed + '/' + total + ' 个文件加载题库…', 'info');
            return;
        }
        var text = '正在从 ' + completed + '/' + total + ' 个文件加载题库… ' + percent + '%';
        statusEl.innerHTML =
            '<div style="margin-bottom:4px; font-size:0.9rem; color:var(--text-secondary);">' + text + '</div>' +
            '<div style="width:100%; height:6px; background:#e9ecef; border-radius:4px; overflow:hidden;">' +
            '<div style="width:' + percent + '%; height:100%; background:var(--primary-color); transition:width .2s;"></div>' +
            '</div>';
    }

    renderProgress();

    var urls = selectedFiles.map(function(name) { return getDataFileUrl(name) + '?t=' + Date.now(); });
    Promise.all(urls.map(function(url) {
        return fetch(url)
            .then(function(r) {
                if (!r.ok) throw new Error('无法读取：' + url);
                return r.json();
            })
            .then(function(data) {
                completed++;
                renderProgress();
                return data;
            });
    }))
        .then(function(results) {
            profileApplyJsonPayloadsToStore(results);
            showMsg(
                'profileLoadFromDataStatus',
                '加载成功：当前共有 ' + store.sets.length + ' 个套卷、' + Object.keys(store.questions).length + ' 道题目',
                'success'
            );
            showMsg(
                'dataStatus',
                '已加载题库：当前共有 ' + store.sets.length + ' 个套卷、' + Object.keys(store.questions).length + ' 道题目',
                'success'
            );
            setTimeout(function() { profileCloseLoadFromDataModal(); }, 900);
        })
        .catch(function(err) {
            showMsg(
                'profileLoadFromDataStatus',
                '加载失败：' + (err && err.message || '未知错误') + '。请确保通过 HTTP 服务访问（非 file://）',
                'error'
            );
        });
}

// 显示从 data 加载模态框
function adminShowLoadFromDataModal() {
    var modal = document.getElementById('adminLoadFromDataModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('adminLoadAllJson').checked = false;
    document.getElementById('adminLoadJsonFileList').innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:20px;">正在加载文件列表...</p>';
    adminLoadJsonFileList();
}

// 关闭从 data 加载模态框
function adminCloseLoadFromDataModal() {
    var modal = document.getElementById('adminLoadFromDataModal');
    if (modal) modal.style.display = 'none';
}

// 加载 JSON 文件列表
function adminLoadJsonFileList() {
    if (!GITHUB_CONFIG.token) {
        // 如果没有 Token，尝试从 files.json 读取
        var base = window.location.origin + (window.location.pathname.replace(/[^/]+$/, '') || '/');
        var manifestUrl = base + 'data/files.json?t=' + Date.now();
        fetch(manifestUrl)
            .then(function(resp) {
                if (!resp.ok) throw new Error('files.json 未找到');
                return resp.json();
            })
            .then(function(manifest) {
                var jsonList = Array.isArray(manifest.json) ? manifest.json : (manifest.json ? [manifest.json] : ['store.json']);
                renderLoadJsonFileList(jsonList.map(function(name) { return 'data/' + name.replace(/^data\//, ''); }));
            })
            .catch(function(err) {
                document.getElementById('adminLoadJsonFileList').innerHTML = '<p style="color:#dc3545; text-align:center; padding:20px;">加载文件列表失败：' + (err.message || '未知错误') + '</p>';
            });
    } else {
        // 使用 GitHub API 获取文件列表
        adminRefreshDataJsonFileList().then(function(jsonPaths) {
            renderLoadJsonFileList(jsonPaths);
        });
    }
}

// 获取JSON文件分类
function getJsonFileCategories() {
    try {
        var cats = localStorage.getItem('xingce_json_file_categories');
        return cats ? JSON.parse(cats) : {};
    } catch (e) { return {}; }
}
// 保存JSON文件分类
function saveJsonFileCategories(cats) {
    try {
        localStorage.setItem('xingce_json_file_categories', JSON.stringify(cats));
    } catch (e) {}
}
// 渲染 JSON 文件列表（带分类）
function renderLoadJsonFileList(jsonPaths) {
    var listEl = document.getElementById('adminLoadJsonFileList');
    if (!listEl) return;
    if (!jsonPaths || jsonPaths.length === 0) {
        listEl.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:20px;">没有找到 JSON 文件</p>';
        return;
    }
    var categories = getJsonFileCategories();
    var filesByCategory = {};
    var uncategorized = [];
    jsonPaths.forEach(function(path) {
        var fileName = path.replace(/^data\//, '');
        var cat = categories[fileName] || '';
        if (cat) {
            if (!filesByCategory[cat]) filesByCategory[cat] = [];
            filesByCategory[cat].push(path);
        } else {
            uncategorized.push(path);
        }
    });
    var html = '<div style="margin-bottom:12px;"><label style="display:inline-flex; align-items:center; gap:8px;"><select id="adminJsonCategoryFilter" onchange="adminFilterJsonFilesByCategory()" style="padding:8px; border:1px solid var(--border-color); border-radius:var(--border-radius);"><option value="">全部分类</option>';
    Object.keys(filesByCategory).sort().forEach(function(cat) {
        html += '<option value="' + cat.replace(/"/g, '&quot;') + '">' + cat.replace(/</g, '&lt;') + '</option>';
    });
    html += '</select> <button class="btn btn-sm" style="background:var(--light-bg); border:1px solid var(--border-color);" onclick="adminShowJsonCategoryManager()">管理分类</button></label></div>';
    html += '<div id="adminJsonFileListContent">';
    // 按分类显示
    Object.keys(filesByCategory).sort().forEach(function(cat) {
        html += '<div class="json-category-group" data-category="' + cat.replace(/"/g, '&quot;') + '"><div style="font-weight:600; padding:8px; background:var(--light-bg); border-radius:var(--border-radius); margin-bottom:4px; color:var(--primary-color);">' + cat.replace(/</g, '&lt;') + ' (' + filesByCategory[cat].length + ')</div>';
        filesByCategory[cat].forEach(function(path) {
            var fileName = path.replace(/^data\//, '');
            html += '<label style="display:flex; align-items:center; gap:8px; padding:8px; border-bottom:1px solid var(--border-color); cursor:pointer;"><input type="checkbox" class="admin-load-json-checkbox" value="' + path + '" onchange="adminUpdateLoadJsonSelection()"> <span>' + path + '</span></label>';
        });
        html += '</div>';
    });
    // 未分类的文件
    if (uncategorized.length > 0) {
        html += '<div class="json-category-group" data-category=""><div style="font-weight:600; padding:8px; background:var(--light-bg); border-radius:var(--border-radius); margin-bottom:4px; color:#6c757d;">未分类 (' + uncategorized.length + ')</div>';
        uncategorized.forEach(function(path) {
            var fileName = path.replace(/^data\//, '');
            html += '<label style="display:flex; align-items:center; gap:8px; padding:8px; border-bottom:1px solid var(--border-color); cursor:pointer;"><input type="checkbox" class="admin-load-json-checkbox" value="' + path + '" onchange="adminUpdateLoadJsonSelection()"> <span>' + path + '</span></label>';
        });
        html += '</div>';
    }
    html += '</div>';
    listEl.innerHTML = html;
}
// 按分类筛选文件
function adminFilterJsonFilesByCategory() {
    var filter = document.getElementById('adminJsonCategoryFilter').value;
    var groups = document.querySelectorAll('.json-category-group');
    groups.forEach(function(group) {
        var cat = group.getAttribute('data-category') || '';
        if (!filter || cat === filter) {
            group.style.display = 'block';
        } else {
            group.style.display = 'none';
        }
    });
}
// 显示分类管理对话框
function adminShowJsonCategoryManager() {
    var categories = getJsonFileCategories();
    var jsonPaths = Array.from(document.querySelectorAll('.admin-load-json-checkbox')).map(function(cb) { return cb.value.replace(/^data\//, ''); });
    var html = '<div style="max-height:60vh; overflow-y:auto;"><p style="margin-bottom:12px; color:var(--text-secondary);">为JSON文件设置分类，方便查找和管理。</p>';
    jsonPaths.forEach(function(fileName) {
        var currentCat = categories[fileName] || '';
        html += '<div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; padding:8px; background:var(--light-bg); border-radius:var(--border-radius);"><span style="flex:1; font-size:0.9rem;">' + fileName.replace(/</g, '&lt;') + '</span><input type="text" data-file="' + fileName.replace(/"/g, '&quot;') + '" value="' + currentCat.replace(/"/g, '&quot;').replace(/</g, '&lt;') + '" placeholder="分类名称（留空=未分类）" style="flex:1; padding:6px; border:1px solid var(--border-color); border-radius:var(--border-radius);"></div>';
    });
    html += '</div><div style="margin-top:16px; display:flex; gap:8px; justify-content:flex-end;"><button class="btn" style="background:var(--light-bg); border:1px solid var(--border-color);" onclick="adminCloseJsonCategoryManager()">取消</button><button class="btn btn-success" onclick="adminSaveJsonCategories()">保存</button></div>';
    var modal = document.getElementById('adminJsonCategoryManagerModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'adminJsonCategoryManagerModal';
        modal.style.cssText = 'display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:10001; align-items:center; justify-content:center;';
        modal.innerHTML = '<div class="card" style="max-width:700px; max-height:80vh; overflow-y:auto; margin:20px; position:relative;"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; padding-bottom:16px; border-bottom:2px solid var(--border-color);"><h2 style="margin:0; color:var(--primary-color);">JSON文件分类管理</h2><button onclick="adminCloseJsonCategoryManager()" style="background:none; border:none; font-size:32px; color:var(--text-secondary); cursor:pointer; line-height:1;">×</button></div><div id="adminJsonCategoryManagerContent"></div></div>';
        document.body.appendChild(modal);
    }
    document.getElementById('adminJsonCategoryManagerContent').innerHTML = html;
    modal.style.display = 'flex';
}
function adminCloseJsonCategoryManager() {
    var modal = document.getElementById('adminJsonCategoryManagerModal');
    if (modal) modal.style.display = 'none';
}
function adminSaveJsonCategories() {
    var categories = {};
    var inputs = document.querySelectorAll('#adminJsonCategoryManagerContent input[data-file]');
    inputs.forEach(function(inp) {
        var fileName = inp.getAttribute('data-file');
        var cat = (inp.value || '').trim();
        if (cat) categories[fileName] = cat;
    });
    saveJsonFileCategories(categories);
    adminCloseJsonCategoryManager();
    adminLoadJsonFileList(); // 重新加载文件列表
    showMsg('adminLoadFromDataStatus', '分类已保存', 'success');
}

// 切换"加载全部"
function adminToggleLoadAllJson() {
    var loadAll = document.getElementById('adminLoadAllJson').checked;
    var checkboxes = document.querySelectorAll('.admin-load-json-checkbox');
    checkboxes.forEach(function(cb) {
        cb.checked = loadAll;
        cb.disabled = loadAll;
    });
}

// 更新选择状态
function adminUpdateLoadJsonSelection() {
    var checkboxes = document.querySelectorAll('.admin-load-json-checkbox');
    var allChecked = Array.from(checkboxes).every(function(cb) { return cb.checked || cb.disabled; });
    document.getElementById('adminLoadAllJson').checked = allChecked;
}

// 执行从 data 加载
function adminLoadFromDataExecute() {
    var loadAll = document.getElementById('adminLoadAllJson').checked;
    var selectedFiles = [];
    
    if (loadAll) {
        // 加载全部
        var checkboxes = document.querySelectorAll('.admin-load-json-checkbox');
        selectedFiles = Array.from(checkboxes).map(function(cb) { return cb.value; });
    } else {
        // 加载选中的
        var checkboxes = document.querySelectorAll('.admin-load-json-checkbox:checked');
        selectedFiles = Array.from(checkboxes).map(function(cb) { return cb.value; });
    }
    
    if (selectedFiles.length === 0) {
        showMsg('adminLoadFromDataStatus', '请至少选择一个 JSON 文件', 'error');
        return;
    }
    
    if (!window.fetch) {
        showMsg('adminLoadFromDataStatus', '当前浏览器不支持 fetch', 'error');
        return;
    }
    
    var base = window.location.origin + (window.location.pathname.replace(/[^/]+$/, '') || '/');
    showMsg('adminLoadFromDataStatus', '正在从 ' + selectedFiles.length + ' 个文件加载数据…', 'info');
    
    var urls = selectedFiles.map(function(path) {
        var fileName = path.replace(/^data\//, '');
        return base + 'data/' + fileName + '?t=' + Date.now();
    });
    
    Promise.all(urls.map(function(url) {
        return fetch(url).then(function(r) {
            if (!r.ok) throw new Error('无法读取：' + url);
            return r.json();
        });
    }))
    .then(function(results) {
        var mergedSets = [];
        var mergedQuestions = {};
        var setIds = new Set();
        results.forEach(function(data, idx) {
            if (!data) return;
            var originFile = (selectedFiles[idx] || '').replace(/^data\//, '').trim() || 'store.json';
            // 在管理员题库中记录来源 JSON 文件，便于后续按文件粒度回写
            (data.sets || []).forEach(function(s) {
                if (!s) return;
                s._originFile = originFile;
                if (s.id && !setIds.has(s.id)) {
                    mergedSets.push(s);
                    setIds.add(s.id);
                }
            });
            // 合并题目（后面的覆盖前面的），并记录来源文件
            var qs = data.questions || {};
            Object.keys(qs).forEach(function(qid) {
                var q = qs[qid];
                if (!q) return;
                q._originFile = originFile;
                mergedQuestions[qid] = q;
            });
        });
        adminStore.sets = mergedSets;
        if (adminStore.sets && MAIN_SECTIONS) {
            adminStore.sets.forEach(function(set) {
                MAIN_SECTIONS.forEach(function(sec) {
                    if (!Array.isArray(set[sec])) set[sec] = [];
                });
            });
        }
        adminStore.questions = mergedQuestions;
        adminStore.save();
        fillAdminSetSelects();
        adminFilterSetList();
        renderAdminStatsTree();
        showMsg('adminLoadFromDataStatus', '已从 ' + selectedFiles.length + ' 个文件加载：' + mergedSets.length + ' 个套卷，' + Object.keys(mergedQuestions).length + ' 道题目', 'success');
        setTimeout(function() {
            adminCloseLoadFromDataModal();
        }, 2000);
    })
    .catch(function(err) {
        showMsg('adminLoadFromDataStatus', '加载失败：' + (err && err.message || '未知错误') + '。请确保通过 HTTP 服务访问（非 file://）', 'error');
    });
}

// 保留原函数名作为兼容
function adminLoadFromData() {
    adminShowLoadFromDataModal();
}

function adminFilterSetList() {
    var category = document.getElementById('adminSetFilterCategory').value;
    var nameFilter = (document.getElementById('adminSetFilterName').value || '').trim().toLowerCase();
    var filtered = adminStore.sets.filter(function(s) {
        if (category && s.category !== category) return false;
        if (nameFilter && !(s.name || '').toLowerCase().includes(nameFilter)) return false;
        return true;
    });
    var container = document.getElementById('adminSetList');
    if (!container) return;
    if (!filtered.length) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-folder-open"></i><p>暂无套卷</p></div>';
        return;
    }
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    container.innerHTML = '<div class="admin-set-list-toolbar" style="display:flex; align-items:center; gap:8px; margin-bottom:12px; font-size:0.9rem; color:var(--text-secondary);"><i class="fas fa-info-circle"></i> 共 ' + filtered.length + ' 个套卷，点击套卷名可查看题目详情</div>' +
        filtered.map(function(s) {
        var secCounts = {};
        var total = 0;
        (MAIN_SECTIONS || []).forEach(function(sec) { var c = (s[sec]||[]).length; secCounts[sec] = c; total += c; });
        var meta = (MAIN_SECTIONS || []).map(function(sec) { return sec + ' ' + (secCounts[sec]||0); }).join(' · ');
        var catOpts = (getAdminSetCategories() || []).filter(Boolean).map(function(c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
        var moveHtml = catOpts ? '<select class="admin-set-move-category" data-set-id="' + esc(s.id) + '" style="max-width:140px; padding:4px 8px; font-size:0.85rem; border-radius:4px; border:1px solid var(--border-color);" onchange="adminMoveSetToCategory(\'' + esc(s.id) + '\', this.value); this.value=\'\';"><option value="">移至分类…</option>' + catOpts + '</select>' : '';
        return '<div class="admin-set-card set-item" style="padding:14px 16px; border:1px solid var(--border-color); border-radius:var(--border-radius); margin-bottom:10px; background:var(--surface); transition:var(--transition);">' +
            '<div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">' +
            '<div style="flex:1; min-width:200px;">' +
            '<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;"><strong style="font-size:1rem;"><a href="javascript:void(0)" onclick="adminViewSetDetails(\'' + esc(s.id) + '\')" style="color:var(--primary-color); text-decoration:none;">' + esc(s.name) + '</a></strong>' +
            '<span class="set-category-tag" style="display:inline-block; padding:2px 8px; border-radius:4px; background:var(--light-bg); color:var(--text-secondary); font-size:0.8rem;">' + esc(s.category || '不分类') + '</span>' +
            '<span style="color:var(--primary-color); font-size:0.9rem;">共 ' + total + ' 题</span></div>' +
            '<div style="font-size:0.8rem; color:var(--text-secondary); line-height:1.5;">' + meta + '</div></div>' +
            '<div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">' +
            (moveHtml ? moveHtml + ' ' : '') +
            '<button class="btn btn-sm btn-info" onclick="window.open(\'admin-set-manage.html?setId=' + s.id + '&t=' + Date.now() + '\', \'_blank\')" title="在新页查看/管理题目"><i class="fas fa-list"></i> 查看题目</button>' +
            '<button class="btn btn-sm btn-primary" onclick="adminBatchImportToSet(\'' + s.id + '\')" title="批量导入到此套卷"><i class="fas fa-file-import"></i> 批量导入</button>' +
            '<button class="btn btn-sm btn-success" onclick="adminSingleImportToSet(\'' + s.id + '\')" title="单题录入"><i class="fas fa-edit"></i> 单题录入</button>' +
            '<button class="btn btn-sm" style="background:#eaeaea;" onclick="adminEditSet(\'' + s.id + '\')" title="编辑套卷名"><i class="fas fa-pen"></i> 编辑</button>' +
            '<button class="btn btn-sm" style="background:#dc3545; color:#fff;" onclick="adminDeleteSet(\'' + s.id + '\')" title="删除套卷及题目"><i class="fas fa-trash"></i> 删除</button>' +
            '</div></div></div>';
    }).join('');
}

var adminCurrentImportType = null; // 'batch' 或 'single' 或 null
function adminBatchImportToSet(setId) {
    var batchCard = document.getElementById('adminBatchImportCard');
    var singleCard = document.getElementById('adminSingleImportCard');
    
    // 如果当前显示的是批量导入，则隐藏；否则显示批量导入并隐藏单题录入
    if (adminCurrentImportType === 'batch') {
        batchCard.style.display = 'none';
        adminCurrentImportType = null;
        return;
    }
    
    document.getElementById('adminBatchSetId').value = setId;
    batchCard.style.display = 'block';
    if (singleCard) singleCard.style.display = 'none';
    adminCurrentImportType = 'batch';
    
    // 滚动到批量导入区域
    setTimeout(function() {
        batchCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    showMsg('adminImportStatus', '已选择套卷，请在下方输入题目内容', 'info');
}

function adminSingleImportToSet(setId) {
    var batchCard = document.getElementById('adminBatchImportCard');
    var singleCard = document.getElementById('adminSingleImportCard');
    
    // 如果当前显示的是单题录入，则隐藏；否则显示单题录入并隐藏批量导入
    if (adminCurrentImportType === 'single') {
        singleCard.style.display = 'none';
        adminCurrentImportType = null;
        return;
    }
    
    document.getElementById('adminSingleSetId').value = setId;
    // 设置默认值：判断推理、图形推理
    document.getElementById('adminSingleSection').value = '判断推理';
    updateAdminSingleSub();
    document.getElementById('adminSingleSubcategory').value = '图形推理';
    setAdminSingleOptionDefaults();
    
    singleCard.style.display = 'block';
    if (batchCard) batchCard.style.display = 'none';
    adminCurrentImportType = 'single';
    
    // 滚动到单题录入区域
    setTimeout(function() {
        singleCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    showMsg('adminSingleStatus', '已选择套卷，请填写题目内容', 'info');
}

function setAdminSingleOptionDefaults() {
    var sub = document.getElementById('adminSingleSubcategory');
    if (!sub) return;
    var isGraph = sub.value === '图形推理';
    var def = isGraph ? ['A', 'B', 'C', 'D'] : ['', '', '', ''];
    ['adminSingleOptA', 'adminSingleOptB', 'adminSingleOptC', 'adminSingleOptD'].forEach(function(id, i) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = def[i];
    });
}

function adminMoveSetToCategory(setId, category) {
    if (!category || !setId) return;
    var set = adminStore.getSet(setId);
    if (!set) return;
    adminStore.updateSet(setId, { category: category });
    adminStore.save();
    fillAdminSetSelects();
    adminFilterSetList();
    if (typeof adminRenderSelectedSetsList === 'function') adminRenderSelectedSetsList();
    showMsg('adminSetStatus', '已移至分类「' + category + '」，数据已保存，同步到 GitHub 时将更新', 'success');
}
function adminEditSet(setId) {
    var set = adminStore.getSet(setId);
    if (!set) return;
    var newName = prompt('请输入新的套卷名称：', set.name || '');
    if (newName == null) return;
    newName = newName.trim();
    if (!newName) {
        showMsg('adminSetStatus', '套卷名称不能为空', 'error');
        return;
    }
    if (!adminStore.updateSet(setId, { name: newName })) {
        showMsg('adminSetStatus', '套卷名称已存在，不可重复', 'error');
        return;
    }
    adminStore.save();
    fillAdminSetSelects();
    adminFilterSetList();
    showMsg('adminSetStatus', '套卷已更新', 'success');
}

var adminCurrentViewSetId = null;
function adminViewSetDetails(setId) {
    adminCurrentViewSetId = setId;
    var set = adminStore.getSet(setId);
    if (!set) return;
    // 隐藏套卷列表，显示题目详情页面
    var setListContainer = document.getElementById('adminSetList');
    var setListCard = setListContainer ? setListContainer.closest('.card') : null;
    if (setListCard) {
        setListCard.style.display = 'none';
    }
    // 创建或显示题目详情页面
    var detailContainer = document.getElementById('adminSetDetailView');
    if (!detailContainer) {
        detailContainer = document.createElement('div');
        detailContainer.id = 'adminSetDetailView';
        detailContainer.className = 'card';
        detailContainer.style.marginBottom = '20px';
        // 插入到套卷管理card内部，在adminSetList之后
        if (setListContainer && setListContainer.parentElement) {
            setListContainer.parentElement.insertBefore(detailContainer, setListContainer.nextSibling);
        }
    }
    detailContainer.style.display = 'block';
    
    var allQids = [];
    MAIN_SECTIONS.forEach(function(sec) {
        (set[sec] || []).forEach(function(qid) { allQids.push({ qid: qid, section: sec }); });
    });
    allQids.sort(function(a, b) {
        var qa = adminStore.getQuestion(a.qid);
        var qb = adminStore.getQuestion(b.qid);
        var ta = (qa && qa.createdAt != null) ? qa.createdAt : 0;
        var tb = (qb && qb.createdAt != null) ? qb.createdAt : 0;
        return ta - tb;
    });
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function imgTag(src) { return '<img src="' + src + '" style="max-width:100%; margin:6px 0;" />'; }
    var html = '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">' +
        '<h2 style="margin:0; color:var(--primary-color);"><i class="fas fa-list"></i> ' + esc(set.name) + ' - 题目列表（共 ' + allQids.length + ' 题）</h2>' +
        '<div style="display:flex; gap:8px;">' +
        '<button class="btn btn-primary" onclick="adminBatchImportToSet(\'' + setId + '\')"><i class="fas fa-file-import"></i> 批量导入</button>' +
        '<button class="btn btn-success" onclick="adminSingleImportToSet(\'' + setId + '\')"><i class="fas fa-edit"></i> 单题导入</button>' +
        '<button class="btn" onclick="adminBackToSetList()"><i class="fas fa-arrow-left"></i> 返回列表</button>' +
        '</div></div>';
    
    if (!allQids.length) {
        html += '<div class="empty-state"><i class="fas fa-inbox"></i><p>该套卷暂无题目</p></div>';
    } else {
        html += '<div id="adminSetDetailQuestions" style="max-height:70vh; overflow-y:auto;">';
        html += allQids.map(function(item, idx) {
            var q = adminStore.getQuestion(item.qid);
            if (!q) return '';
            var materialHtml = (q.material ? '<p>' + esc(q.material) + '</p>' : '') + (q.materialImages || []).map(imgTag).join('');
            var stemHtml = esc(q.content || '(无题干)') + (q.stemImages || []).map(imgTag).join('');
            var optHtml = (q.options || []).map(function(o) {
                var optImgs = (o.images || []).map(imgTag).join('');
                return '<div class="option"><span class="option-label">' + o.label + '.</span> ' + esc(o.text) + optImgs + '</div>';
            }).join('');
            return '<div class="question-item" style="margin-bottom:16px; padding:12px; border:1px solid var(--border-color); border-radius:var(--border-radius);">' +
                '<div class="question-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' +
                '<span class="question-category">' + esc(item.section) + ' - ' + esc(q.subcategory || item.section) + '</span> ' +
                '<div style="display:flex; gap:8px;">' +
                '<button class="btn btn-sm btn-info" onclick="adminShowQuestionDetail(\'' + item.qid + '\')" title="查看详情"><i class="fas fa-eye"></i> 详情</button>' +
                '<button class="btn btn-sm" style="background:#eaeaea;" onclick="adminEditQuestion(\'' + item.qid + '\')" title="编辑"><i class="fas fa-edit"></i> 编辑</button>' +
                '<button class="btn btn-sm" style="background:#dc3545; color:#fff;" onclick="adminDeleteQuestion(\'' + item.qid + '\', \'' + setId + '\')" title="删除"><i class="fas fa-trash"></i> 删除</button>' +
                '</div></div>' +
                (materialHtml ? '<div style="margin-bottom:8px; padding:8px; background:var(--light-bg); border-radius:var(--border-radius);"><strong>材料：</strong>' + materialHtml + '</div>' : '') +
                '<div class="question-content">' + (idx+1) + '. ' + stemHtml + '</div>' +
                '<div class="options-grid">' + optHtml + '</div>' +
                (q.explanation ? '<div class="answer-block">解析：<div class="explanation-body">' + explanationToHtml(q.explanation) + '</div></div>' : '') +
                '<div class="answer-block">答案：' + esc(q.answer) + '</div>' +
                '</div>';
        }).join('');
        html += '</div>';
    }
    detailContainer.innerHTML = html;
    renderLaTeXInElement(detailContainer);
}

function adminBackToSetList() {
    adminCurrentViewSetId = null;
    var detailContainer = document.getElementById('adminSetDetailView');
    if (detailContainer) {
        detailContainer.style.display = 'none';
    }
    var setListContainer = document.getElementById('adminSetList');
    var setListCard = setListContainer ? setListContainer.closest('.card') : null;
    if (setListCard) {
        setListCard.style.display = 'block';
    }
    adminFilterSetList();
}

function adminDeleteSet(setId) {
    var set = adminStore.getSet(setId);
    if (!set) return;
    var total = (MAIN_SECTIONS || []).reduce(function(sum, sec) { return sum + (set[sec]||[]).length; }, 0);
    if (!confirm('确定删除套卷「' + (set.name || '') + '」吗？将同时删除该套卷下 ' + total + ' 道题目，且不可恢复。')) return;
    adminStore.deleteSet(setId);
    adminStore.save();
    fillAdminSetSelects();
    adminFilterSetList();
    if (typeof adminRenderSelectedSetsList === 'function') adminRenderSelectedSetsList();
    showMsg('adminSetStatus', '套卷已删除', 'success');
}

function adminDeleteQuestion(qid, setId) {
    if (!confirm('确定删除此题吗？')) return;
    adminStore.removeQuestion(qid);
    adminStore.save();
    if (adminCurrentViewSetId === setId) {
        adminViewSetDetails(setId);
    } else {
        adminFilterSetList();
    }
    fillAdminSetSelects();
    showMsg('adminSetStatus', '题目已删除', 'success');
}

var adminDetailQid = null;
function adminShowQuestionDetail(qid) {
    adminDetailQid = qid;
    var q = adminStore.getQuestion(qid);
    if (!q) return;
    var set = adminStore.getSet(q.setId);
    var html = '<div style="position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:10000; display:flex; align-items:center; justify-content:center; padding:20px;">' +
        '<div style="background:var(--surface); border-radius:var(--border-radius); padding:24px; max-width:800px; max-height:90vh; overflow-y:auto; width:100%; position:relative;">' +
        '<button onclick="document.getElementById(\'adminQuestionDetailModal\').remove()" style="position:absolute; top:12px; right:12px; background:#dc3545; color:#fff; border:none; border-radius:50%; width:32px; height:32px; cursor:pointer; font-size:18px;">×</button>' +
        '<h3 style="margin-bottom:16px;">题目详情</h3>';
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function imgTag(src) { return '<img src="' + src + '" style="max-width:100%; margin:8px 0;" />'; }
    var materialHtml = (q.material ? '<p>' + esc(q.material) + '</p>' : '') + (q.materialImages || []).map(imgTag).join('');
    var stemHtml = esc(q.content || '') + (q.stemImages || []).map(imgTag).join('');
    var optHtml = (q.options || []).map(function(o) {
        var optImgs = (o.images || []).map(imgTag).join('');
        var isCorrect = o.label === q.answer;
        return '<div class="option ' + (isCorrect ? 'correct' : '') + '"><span class="option-label">' + o.label + '.</span> ' + esc(o.text) + optImgs + (isCorrect ? ' <span style="color:var(--success-color);">✓</span>' : '') + '</div>';
    }).join('');
    html += '<div class="page-question-header">【' + esc(q.section) + '-' + esc(q.subcategory || q.section) + '】 ' + esc(q.source || '') + '</div>';
    if (materialHtml) html += '<div style="margin-bottom:16px; padding:12px; background:var(--light-bg); border-radius:8px;"><strong>材料：</strong>' + materialHtml + '</div>';
    html += '<div class="question-content">' + stemHtml + '</div>';
    html += '<div class="options-grid">' + optHtml + '</div>';
    html += '<div class="answer-block">答案：<strong>' + esc(q.answer) + '</strong></div>';
    if (q.explanation) html += '<div class="answer-block">解析：<div class="explanation-body">' + explanationToHtml(q.explanation) + '</div></div>';
    if (q.knowledgePoints && q.knowledgePoints.length) html += '<div class="answer-block">考点：' + esc(q.knowledgePoints.join('、')) + '</div>';
    html += '</div></div>';
    var modal = document.createElement('div');
    modal.id = 'adminQuestionDetailModal';
    modal.innerHTML = html;
    document.body.appendChild(modal);
    renderLaTeXInElement(modal);
}

function adminEditQuestion(qid) {
    adminDetailQid = qid;
    var q = adminStore.getQuestion(qid);
    if (!q) return;
    // 打开编辑界面（可以复用首页的编辑功能，但使用adminStore）
    // 这里简化处理，直接跳转到单题录入页面并填充数据
    document.getElementById('adminSingleSetId').value = q.setId;
    document.getElementById('adminSingleSection').value = q.section;
    updateAdminSingleSub();
    document.getElementById('adminSingleSubcategory').value = q.subcategory || '';
    document.getElementById('adminSingleSource').value = q.source || '';
    var materialEl = document.getElementById('adminSingleMaterial');
    if (materialEl) {
        materialEl.innerHTML = q.material || '';
        if (q.materialImages && q.materialImages.length) {
            q.materialImages.forEach(function(src) {
                var img = document.createElement('img');
                img.src = src;
                img.style.maxWidth = '100%';
                materialEl.appendChild(img);
            });
        }
    }
    var stemEl = document.getElementById('adminSingleStem');
    if (stemEl) {
        stemEl.innerHTML = q.content || '';
        if (q.stemImages && q.stemImages.length) {
            q.stemImages.forEach(function(src) {
                var img = document.createElement('img');
                img.src = src;
                img.style.maxWidth = '100%';
                stemEl.appendChild(img);
            });
        }
    }
    ['A', 'B', 'C', 'D'].forEach(function(label, idx) {
        var opt = q.options[idx];
        if (opt) {
            var optEl = document.getElementById('adminSingleOpt' + label);
            if (optEl) {
                optEl.innerHTML = opt.text || '';
                if (opt.images && opt.images.length) {
                    opt.images.forEach(function(src) {
                        var img = document.createElement('img');
                        img.src = src;
                        img.style.maxWidth = '100%';
                        optEl.appendChild(img);
                    });
                }
            }
        }
    });
    document.getElementById('adminSingleAnswer').value = q.answer || 'A';
    var expEl = document.getElementById('adminSingleExplanation');
    if (expEl) expEl.innerHTML = q.explanation || '';
    // 删除原题目
    adminStore.removeQuestion(qid);
    adminStore.save();
    adminFilterSetList();
    // 滚动到单题录入区域
    document.getElementById('tab-admin').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function() {
        document.getElementById('adminSingleStem').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
    showMsg('adminSingleStatus', '题目数据已填充到单题录入区域，请修改后保存', 'info');
}

/**
 * 保存管理员题库数据到新的JSON文件
 * 并自动将该文件名写入 data/files.json 里，避免手动维护清单
 */
function adminSaveToNewJsonFile() {
    if (!GITHUB_CONFIG.token) {
        showMsg('adminNewFileStatus', 'GitHub Token 未配置', 'error');
        return Promise.reject(new Error('GitHub Token 未配置'));
    }
    if (!window.fetch) {
        showMsg('adminNewFileStatus', '浏览器不支持 fetch', 'error');
        return Promise.reject(new Error('浏览器不支持 fetch'));
    }
    var fileNameInput = document.getElementById('adminNewJsonFileName');
    var fileName = (fileNameInput && fileNameInput.value || '').trim();
    if (!fileName) {
        showMsg('adminNewFileStatus', '请输入文件名', 'error');
        return;
    }
    // 验证文件名格式（只允许字母、数字、下划线、连字符）
    if (!/^[a-zA-Z0-9_-]+$/.test(fileName)) {
        showMsg('adminNewFileStatus', '文件名只能包含字母、数字、下划线和连字符', 'error');
        return;
    }
    var filePath = 'data/' + fileName + '.json';
    showMsg('adminNewFileStatus', '正在新建文件 ' + filePath + ' 并写入 files.json...', 'info');

    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/' + filePath;
    var headers = {
        'Authorization': 'token ' + GITHUB_CONFIG.token,
        'Accept': 'application/vnd.github.v3+json'
    };

    // 仅“新建空 JSON 文件 + 写入 files.json”，不保存任何管理员题库数据
    var emptyPayload = { sets: [], questions: {}, exportTime: new Date().toISOString() };
    var encodedContent = utf8ToBase64(JSON.stringify(emptyPayload, null, 2));

    return fetch(apiUrl + '?ref=' + GITHUB_CONFIG.branch, { method: 'GET', headers: headers })
        .then(function(resp) {
            if (resp.status === 404) return null; // 不存在则创建
            if (!resp.ok) throw new Error('检查文件状态失败: ' + resp.status);
            return resp.json();
        })
        .then(function(fileInfo) {
            if (fileInfo && fileInfo.sha) {
                // 已存在：不改动内容，只确保写入 files.json
                return { existed: true, fileInfo: fileInfo };
            }
            var commitData = {
                message: '创建空题库文件: ' + filePath + ' - ' + new Date().toLocaleString('zh-CN'),
                content: encodedContent,
                branch: GITHUB_CONFIG.branch
            };
            return fetch(apiUrl, { method: 'PUT', headers: headers, body: JSON.stringify(commitData) })
                .then(function(resp) {
                    if (!resp.ok) {
                        return resp.json().then(function(err) {
                            throw new Error('创建 ' + filePath + ' 失败: ' + (err.message || resp.status));
                        });
                    }
                    return resp.json().then(function(res) { return { existed: false, result: res }; });
                });
        })
        .then(function(info) {
            return adminEnsureFileInManifest(fileName + '.json')
                .then(function() {
                    if (fileNameInput) fileNameInput.value = '';
                    showMsg(
                        'adminNewFileStatus',
                        (info && info.existed ? ('文件已存在：' + filePath + '；已确保写入 files.json') : ('已创建文件：' + filePath + '；并已写入 files.json')),
                        'success'
                    );
                    return info;
                })
                .catch(function(err) {
                    showMsg(
                        'adminNewFileStatus',
                        '文件处理完成，但更新 files.json 失败：' + (err && err.message ? err.message : '未知错误') + '。可手动在 files.json 的 json 数组中添加：\"' + (fileName + '.json') + '\"',
                        'error'
                    );
                    return info;
                });
        })
        .catch(function(err) {
            showMsg('adminNewFileStatus', '操作失败：' + (err && err.message ? err.message : '未知错误'), 'error');
            throw err;
        });
}

/**
 * 确保指定 JSON 文件名已经出现在 data/files.json 的 json 列表中
 * - 支持 object 形式：{ "json": ["store.json"] }
 * - 也支持数组形式：["store.json", "extra.json"]
 * - 若 PUT 因 SHA 不一致失败，会重新拉取最新 files.json 再重试一次
 */
function adminEnsureFileInManifest(jsonFileName) {
    if (!GITHUB_CONFIG.token || !window.fetch) {
        return Promise.reject(new Error('GitHub 配置不完整，无法更新 files.json'));
    }
    var manifestPath = 'data/files.json';
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/' + manifestPath;
    var headers = {
        'Authorization': 'token ' + GITHUB_CONFIG.token,
        'Accept': 'application/vnd.github.v3+json'
    };
    var branch = GITHUB_CONFIG.branch;
    
    function buildManifestFromFileInfo(fileInfo) {
        var manifest;
        if (!fileInfo) {
            manifest = { json: ['store.json', jsonFileName] };
        } else {
            try {
                var existingContent = base64ToUtf8(fileInfo.content);
                manifest = JSON.parse(existingContent);
            } catch (e) {
                manifest = { json: ['store.json', jsonFileName] };
            }
            if (Array.isArray(manifest)) {
                var txtFiles = [], jsonFiles = [];
                manifest.forEach(function(p) {
                    if (typeof p !== 'string') return;
                    if (/\.txt$/i.test(p)) txtFiles.push(p);
                    else if (/\.json$/i.test(p)) jsonFiles.push(p);
                });
                manifest = { txt: txtFiles, json: jsonFiles };
            }
            manifest.txt = manifest.txt || [];
            manifest.json = manifest.json || [];
            if (manifest.json.indexOf('store.json') === -1) manifest.json.unshift('store.json');
            if (manifest.json.indexOf(jsonFileName) === -1) manifest.json.push(jsonFileName);
        }
        var newContent = JSON.stringify(manifest, null, 2);
        return { fileInfo: fileInfo, content: newContent, encoded: utf8ToBase64(newContent) };
    }
    
    function getFileInfo(noCache) {
        var url = apiUrl + '?ref=' + branch;
        if (noCache) url += '&_=' + Date.now();
        return fetch(url, { method: 'GET', headers: headers, cache: noCache ? 'no-store' : 'default' })
            .then(function(resp) {
                if (resp.status === 404) return null;
                if (!resp.ok) throw new Error('获取 files.json 失败: ' + resp.status);
                return resp.json();
            });
    }
    
    function doPut(sha, encodedContent) {
        var body = {
            message: '管理员更新 files.json，加入 ' + jsonFileName + ' - ' + new Date().toLocaleString('zh-CN'),
            content: encodedContent,
            branch: branch
        };
        if (sha) body.sha = sha;
        return fetch(apiUrl, { method: 'PUT', headers: headers, body: JSON.stringify(body) });
    }
    
    return getFileInfo(false)
        .then(function(fileInfo) {
            var built = buildManifestFromFileInfo(fileInfo);
            return doPut(fileInfo && fileInfo.sha, built.encoded).then(function(resp) {
                if (resp.ok) return resp.json();
                return resp.json().then(function(err) {
                    var msg = (err && err.message) ? err.message : String(resp.status || '');
                    var isShaMismatch = resp.status === 409 || /does not match/i.test(msg) || /sha/i.test(msg);
                    if (!isShaMismatch) throw new Error('更新 files.json 失败: ' + msg);
                    // 重新拉取最新 files.json 再重试一次
                    return getFileInfo(true).then(function(latestInfo) {
                        var built2 = buildManifestFromFileInfo(latestInfo);
                        return doPut(latestInfo && latestInfo.sha, built2.encoded).then(function(r2) {
                            if (r2.ok) return r2.json();
                            return r2.json().then(function(e2) {
                                throw new Error('更新 files.json 失败: ' + ((e2 && e2.message) || r2.status));
                            });
                        });
                    });
                });
            });
        });
}

/**
 * 将管理员题库数据同步到GitHub（支持合并和覆盖模式）
 */
function adminSyncToGitHub() {
    if (!GITHUB_CONFIG.token) {
        return Promise.reject(new Error('GitHub Token 未配置'));
    }
    if (!window.fetch) {
        return Promise.reject(new Error('浏览器不支持 fetch'));
    }
    var targetPath = getAdminSelectedGitHubJsonPath();
    var mode = (document.querySelector('input[name="adminSyncMode"]:checked') || {}).value || 'merge';
    showMsg('adminSyncStatus', '正在同步到 GitHub：' + targetPath + ' ...', 'info');
    
    // 准备要上传的数据
    var adminData = {
        sets: adminStore.sets,
        questions: adminStore.questions,
        exportTime: new Date().toISOString()
    };
    
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/' + targetPath;
    var headers = {
        'Authorization': 'token ' + GITHUB_CONFIG.token,
        'Accept': 'application/vnd.github.v3+json'
    };
    
    // 先获取现有文件
    return fetch(apiUrl + '?ref=' + GITHUB_CONFIG.branch, {
        method: 'GET',
        headers: headers
    })
    .then(function(resp) {
        if (resp.status === 404) {
            // 文件不存在，直接创建
            return null;
        }
        if (!resp.ok) {
            throw new Error('获取文件信息失败: ' + resp.status);
        }
        return resp.json();
    })
    .then(function(fileInfo) {
        var finalData;
        if (mode === 'overwrite') {
            // 覆盖模式：直接使用管理员数据
            finalData = adminData;
        } else {
            // 合并模式：合并现有数据和管理员数据
            if (fileInfo && fileInfo.content) {
                try {
                    var existingContent = base64ToUtf8(fileInfo.content);
                    var existingData = deepRepairMojibake(JSON.parse(existingContent));
                    // 合并sets
                    var mergedSets = [];
                    var setIdMap = {}; // 映射旧ID到新ID
                    (existingData.sets || []).forEach(function(s) {
                        var existing = adminStore.sets.find(function(as) { return (as.name || '').trim() === (s.name || '').trim(); });
                        if (existing) {
                            setIdMap[s.id] = existing.id;
                            mergedSets.push(existing);
                        } else {
                            setIdMap[s.id] = s.id;
                            mergedSets.push(s);
                        }
                    });
                    adminStore.sets.forEach(function(s) {
                        if (!mergedSets.find(function(ms) { return ms.id === s.id; })) {
                            mergedSets.push(s);
                        }
                    });
                    // 合并questions
                    var mergedQuestions = {};
                    Object.keys(existingData.questions || {}).forEach(function(qid) {
                        var q = existingData.questions[qid];
                        if (q.setId && setIdMap[q.setId]) {
                            q.setId = setIdMap[q.setId];
                            mergedQuestions[qid] = q;
                        }
                    });
                    Object.keys(adminStore.questions).forEach(function(qid) {
                        mergedQuestions[qid] = adminStore.questions[qid];
                    });
                    finalData = { sets: mergedSets, questions: mergedQuestions, exportTime: new Date().toISOString() };
                } catch (e) {
                    // 解析失败，使用覆盖模式
                    finalData = adminData;
                }
            } else {
                finalData = adminData;
            }
        }
        
        var content = JSON.stringify(finalData, null, 2);
        var encodedContent = utf8ToBase64(content);
        
        var commitData = {
            message: '管理员同步题库数据 - ' + new Date().toLocaleString('zh-CN') + ' (' + mode + ')',
            content: encodedContent,
            branch: GITHUB_CONFIG.branch
        };
        
        if (fileInfo && fileInfo.sha) {
            commitData.sha = fileInfo.sha;
        }

        // PUT：若遇到 sha 不匹配冲突，自动重新获取 sha 并重试一次
        function doPutWithSha(sha) {
            var data = Object.assign({}, commitData);
            if (sha) data.sha = sha;
            return fetch(apiUrl, {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify(data)
            });
        }
        return doPutWithSha(commitData.sha).then(function(resp) {
            if (resp.ok) return resp;
            return resp.json().then(function(err) {
                var msg = (err && err.message) ? err.message : String(resp.status || '');
                var isShaMismatch = resp.status === 409 || /does not match/i.test(msg) || /sha/i.test(msg);
                if (!isShaMismatch) throw new Error('同步到 GitHub 失败: ' + msg);
                // 重新 GET 一次拿到最新 sha，再重试
                return fetch(apiUrl + '?ref=' + GITHUB_CONFIG.branch, { method: 'GET', headers: headers })
                    .then(function(r2) {
                        if (!r2.ok) throw new Error('同步冲突后重新获取文件信息失败: ' + r2.status);
                        return r2.json();
                    })
                    .then(function(latest) {
                        return doPutWithSha(latest && latest.sha).then(function(r3) {
                            if (r3.ok) return r3;
                            return r3.json().then(function(err2) {
                                throw new Error('同步到 GitHub 失败: ' + ((err2 && err2.message) || r3.status));
                            });
                        });
                    });
            });
        });
    })
    .then(function(resp) {
        if (!resp.ok) {
            return resp.json().then(function(err) {
                throw new Error('同步到 GitHub 失败: ' + (err.message || resp.status));
            });
        }
        return resp.json();
    })
    .then(function(result) {
        showMsg('adminSyncStatus', '成功同步到 GitHub（' + targetPath + '）: ' + (result.commit.html_url || ''), 'success');
        // 若同步目标不是默认 store.json，也确保写入 files.json 清单，避免“个人中心刷新题库读不到”
        try {
            if (targetPath && /^data\/[^\/]+\.json$/i.test(targetPath) && targetPath !== 'data/files.json') {
                var base = targetPath.replace(/^data\//, '');
                adminEnsureFileInManifest(base).catch(function() { /* 不阻塞主流程 */ });
            }
        } catch (e) {}
        return result;
    })
    .catch(function(err) {
        showMsg('adminSyncStatus', '同步失败：' + (err.message || '未知错误'), 'error');
        throw err;
    });
}

/**
 * 重置GitHub数据（需要三次确认）
 */
var adminResetConfirmCount = 0;
function adminResetGitHubData() {
    var targetPath = getAdminSelectedGitHubJsonPath();
    // 不允许重置 files.json
    if (targetPath === 'data/files.json') {
        showMsg('adminResetStatus', '不能重置 files.json 清单文件', 'error');
        return;
    }
    adminResetConfirmCount++;
    if (adminResetConfirmCount === 1) {
        var confirm1 = prompt('危险操作！这将重置 GitHub 仓库中的文件：' + targetPath + '\n\n请输入"确认"继续（第1次确认）：');
        if (confirm1 !== '确认') {
            adminResetConfirmCount = 0;
            showMsg('adminResetStatus', '已取消重置操作', 'info');
            return;
        }
        showMsg('adminResetStatus', '第1次确认通过，还需要2次确认', 'info');
    } else if (adminResetConfirmCount === 2) {
        var confirm2 = prompt('第2次确认：将重置 ' + targetPath + '，请输入"确认"继续：');
        if (confirm2 !== '确认') {
            adminResetConfirmCount = 0;
            showMsg('adminResetStatus', '已取消重置操作', 'info');
            return;
        }
        showMsg('adminResetStatus', '第2次确认通过，还需要1次确认', 'info');
    } else if (adminResetConfirmCount === 3) {
        var confirm3 = prompt('最后一次确认：请输入"确认"以重置 ' + targetPath + '：');
        if (confirm3 !== '确认') {
            adminResetConfirmCount = 0;
            showMsg('adminResetStatus', '已取消重置操作', 'info');
            return;
        }
        adminResetConfirmCount = 0;
        // 执行重置
        adminResetGitHubDataExecute(targetPath);
    }
}

/**
 * 删除GitHub JSON文件（需要三次确认）
 */
var adminDeleteConfirmCount = 0;
function adminDeleteGitHubJsonFile() {
    var targetPath = getAdminSelectedGitHubJsonPath();
    // 不允许删除 files.json 和 store.json
    if (targetPath === 'data/files.json') {
        showMsg('adminDeleteStatus', '不能删除 files.json 清单文件', 'error');
        return;
    }
    if (targetPath === 'data/store.json') {
        showMsg('adminDeleteStatus', '不能删除默认的 store.json 文件', 'error');
        return;
    }
    adminDeleteConfirmCount++;
    if (adminDeleteConfirmCount === 1) {
        var confirm1 = prompt('危险操作！这将删除 GitHub 仓库中的文件：' + targetPath + '\n\n请输入"确认"继续（第1次确认）：');
        if (confirm1 !== '确认') {
            adminDeleteConfirmCount = 0;
            showMsg('adminDeleteStatus', '已取消删除操作', 'info');
            return;
        }
        showMsg('adminDeleteStatus', '第1次确认通过，还需要2次确认', 'info');
    } else if (adminDeleteConfirmCount === 2) {
        var confirm2 = prompt('第2次确认：将删除 ' + targetPath + '，请输入"确认"继续：');
        if (confirm2 !== '确认') {
            adminDeleteConfirmCount = 0;
            showMsg('adminDeleteStatus', '已取消删除操作', 'info');
            return;
        }
        showMsg('adminDeleteStatus', '第2次确认通过，还需要1次确认', 'info');
    } else if (adminDeleteConfirmCount === 3) {
        var confirm3 = prompt('最后一次确认：请输入"确认"以删除 ' + targetPath + '：');
        if (confirm3 !== '确认') {
            adminDeleteConfirmCount = 0;
            showMsg('adminDeleteStatus', '已取消删除操作', 'info');
            return;
        }
        adminDeleteConfirmCount = 0;
        // 执行删除
        adminDeleteGitHubJsonFileExecute(targetPath);
    }
}

/**
 * 执行删除 GitHub JSON 文件
 */
function adminDeleteGitHubJsonFileExecute(targetPath) {
    if (!GITHUB_CONFIG.token) {
        showMsg('adminDeleteStatus', 'GitHub Token 未配置', 'error');
        return;
    }
    if (!window.fetch) {
        showMsg('adminDeleteStatus', '浏览器不支持 fetch', 'error');
        return;
    }
    targetPath = targetPath || getAdminSelectedGitHubJsonPath();
    showMsg('adminDeleteStatus', '正在删除 GitHub 文件：' + targetPath + ' ...', 'info');
    
    // 先获取文件信息以获取 SHA
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/' + targetPath;
    var headers = {
        'Authorization': 'token ' + GITHUB_CONFIG.token,
        'Accept': 'application/vnd.github.v3+json'
    };
    
    fetch(apiUrl + '?ref=' + GITHUB_CONFIG.branch, {
        method: 'GET',
        headers: headers
    })
    .then(function(resp) {
        if (resp.status === 404) {
            throw new Error('文件不存在：' + targetPath);
        }
        if (!resp.ok) {
            return resp.json().then(function(err) {
                throw new Error('获取文件信息失败: ' + (err.message || resp.status));
            });
        }
        return resp.json();
    })
    .then(function(fileInfo) {
        // 删除文件（需要 SHA）
        return fetch(apiUrl, {
            method: 'DELETE',
            headers: headers,
            body: JSON.stringify({
                message: '删除文件：' + targetPath,
                sha: fileInfo.sha,
                branch: GITHUB_CONFIG.branch
            })
        });
    })
    .then(function(resp) {
        if (!resp.ok) {
            return resp.json().then(function(err) {
                throw new Error('删除文件失败: ' + (err.message || resp.status));
            });
        }
        return resp.json();
    })
    .then(function(result) {
        showMsg('adminDeleteStatus', '成功删除文件：' + targetPath + ' ' + (result.commit ? ('(' + result.commit.html_url + ')') : ''), 'success');
        // 刷新文件列表
        adminRefreshDataJsonFileList();
        // 从 files.json 中移除该文件（如果存在）
        var fileName = targetPath.replace(/^data\//, '');
        adminRemoveFileFromManifest(fileName).catch(function() { /* 不阻塞主流程 */ });
    })
    .catch(function(err) {
        showMsg('adminDeleteStatus', '删除失败：' + (err.message || '未知错误'), 'error');
    });
}

/**
 * 从 files.json 中移除指定文件。
 * 若 PUT 因 SHA 不一致失败，会重新拉取最新 files.json 再重试一次。
 */
function adminRemoveFileFromManifest(jsonFileName) {
    if (!GITHUB_CONFIG.token || !window.fetch) {
        return Promise.reject(new Error('配置不完整'));
    }
    var manifestPath = 'data/files.json';
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/' + manifestPath;
    var headers = {
        'Authorization': 'token ' + GITHUB_CONFIG.token,
        'Accept': 'application/vnd.github.v3+json'
    };
    var branch = GITHUB_CONFIG.branch;
    
    function getFileInfo(noCache) {
        var url = apiUrl + '?ref=' + branch;
        if (noCache) url += '&_=' + Date.now();
        return fetch(url, { method: 'GET', headers: headers, cache: noCache ? 'no-store' : 'default' })
            .then(function(resp) {
                if (resp.status === 404) return null;
                if (!resp.ok) throw new Error('获取 files.json 失败: ' + resp.status);
                return resp.json();
            });
    }
    
    function buildRemovePayload(fileInfo) {
        if (!fileInfo) return null;
        var existingContent = base64ToUtf8(fileInfo.content);
        var manifest = JSON.parse(existingContent);
        var updated = false;
        if (Array.isArray(manifest.json)) {
            var idx = manifest.json.indexOf(jsonFileName);
            if (idx >= 0) { manifest.json.splice(idx, 1); updated = true; }
        } else if (manifest.json && typeof manifest.json === 'object' && Array.isArray(manifest.json.list)) {
            var idx = manifest.json.list.indexOf(jsonFileName);
            if (idx >= 0) { manifest.json.list.splice(idx, 1); updated = true; }
        }
        if (!updated) return null;
        var newContent = JSON.stringify(manifest, null, 2);
        return { sha: fileInfo.sha, encoded: utf8ToBase64(newContent) };
    }
    
    function doPut(sha, encodedContent) {
        return fetch(apiUrl, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify({
                message: '从 files.json 移除：' + jsonFileName,
                content: encodedContent,
                sha: sha,
                branch: branch
            })
        });
    }
    
    return getFileInfo(false).then(function(fileInfo) {
        var payload = buildRemovePayload(fileInfo);
        if (!payload) return null;
        return doPut(payload.sha, payload.encoded).then(function(resp) {
            if (resp.ok) return resp.json();
            return resp.json().then(function(err) {
                var msg = (err && err.message) ? err.message : String(resp.status || '');
                var isShaMismatch = resp.status === 409 || /does not match/i.test(msg) || /sha/i.test(msg);
                if (!isShaMismatch) throw new Error('更新 files.json 失败: ' + msg);
                return getFileInfo(true).then(function(latestInfo) {
                    var payload2 = buildRemovePayload(latestInfo);
                    if (!payload2) return null;
                    return doPut(payload2.sha, payload2.encoded).then(function(r2) {
                        if (r2.ok) return r2.json();
                        return r2.json().then(function(e2) {
                            throw new Error('更新 files.json 失败: ' + ((e2 && e2.message) || r2.status));
                        });
                    });
                });
            });
        });
    });
}

function adminResetGitHubDataExecute(targetPath) {
    if (!GITHUB_CONFIG.token) {
        showMsg('adminResetStatus', 'GitHub Token 未配置', 'error');
        return;
    }
    if (!window.fetch) {
        showMsg('adminResetStatus', '浏览器不支持 fetch', 'error');
        return;
    }
    targetPath = targetPath || getAdminSelectedGitHubJsonPath();
    showMsg('adminResetStatus', '正在重置 GitHub 文件：' + targetPath + ' ...', 'info');
    
    var emptyData = {
        sets: [],
        questions: {},
        exportTime: new Date().toISOString()
    };
    var content = JSON.stringify(emptyData, null, 2);
    var encodedContent = btoa(unescape(encodeURIComponent(content)));
    
    var apiUrl = 'https://api.github.com/repos/' + GITHUB_CONFIG.owner + '/' + GITHUB_CONFIG.repo + '/contents/' + targetPath;
    var headers = {
        'Authorization': 'token ' + GITHUB_CONFIG.token,
        'Accept': 'application/vnd.github.v3+json'
    };
    
    // 先获取文件SHA
    fetch(apiUrl + '?ref=' + GITHUB_CONFIG.branch, {
        method: 'GET',
        headers: headers
    })
    .then(function(resp) {
        if (resp.status === 404) {
            throw new Error('GitHub仓库中不存在该文件');
        }
        if (!resp.ok) {
            throw new Error('获取文件信息失败: ' + resp.status);
        }
        return resp.json();
    })
    .then(function(fileInfo) {
        var commitData = {
            message: '管理员重置：删除所有题目和数据 - ' + new Date().toLocaleString('zh-CN'),
            content: encodedContent,
            sha: fileInfo.sha,
            branch: GITHUB_CONFIG.branch
        };
        
        return fetch(apiUrl, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify(commitData)
        });
    })
    .then(function(resp) {
        if (!resp.ok) {
            return resp.json().then(function(err) {
                throw new Error('重置失败: ' + (err.message || resp.status));
            });
        }
        return resp.json();
    })
    .then(function(result) {
        showMsg('adminResetStatus', '已重置：' + targetPath + '（已清空）', 'success');
    })
    .catch(function(err) {
        showMsg('adminResetStatus', '重置失败：' + (err.message || '未知错误'), 'error');
    });
}

function updateAdminSingleSub() {
    var section = document.getElementById('adminSingleSection').value;
    var subEl = document.getElementById('adminSingleSubcategory');
    if (!subEl) return;
    var subs = SUBCATEGORIES[section] || [];
    subEl.innerHTML = '';
    subs.forEach(function(s) {
        var opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        subEl.appendChild(opt);
    });
    setAdminSingleOptionDefaults();
}

function onAdminBatchTxtFileChange() {
    var input = document.getElementById('adminBatchTxtFile');
    if (!input.files || !input.files.length) return;
    var files = Array.prototype.slice.call(input.files || []);
    var ps = files.map(function(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function() { resolve(String(reader.result || '')); };
            reader.onerror = function() { reject(new Error('读取失败：' + (file && file.name ? file.name : 'TXT'))); };
            reader.readAsText(file, 'UTF-8');
        });
    });
    Promise.all(ps).then(function(texts) {
        var merged = texts.map(function(t) { return (t || '').trim(); }).filter(Boolean).join('\n\n');
        document.getElementById('adminInputText').value = merged;
        showMsg('adminImportStatus', '已填入 ' + files.length + ' 个 TXT 内容（已合并），可点击「预览」或「导入」', 'success');
    }).catch(function(err) {
        showMsg('adminImportStatus', '读取 TXT 失败：' + (err && err.message || '未知错误'), 'error');
    });
}

function adminBatchPreview() {
    var text = (document.getElementById('adminInputText').value || '').trim();
    var wrap = document.getElementById('adminBatchPreviewWrap');
    var listEl = document.getElementById('adminBatchPreviewList');
    var countEl = document.getElementById('adminBatchPreviewCount');
    if (!text) { showMsg('adminImportStatus', '请先填入题目内容', 'error'); return; }
    var list;
    try {
        list = typeof parseBatchText === 'function' ? parseBatchText(text) : [];
    } catch (e) {
        showMsg('adminImportStatus', '解析出错：' + (e && e.message || String(e)), 'error');
        if (wrap) wrap.style.display = 'none';
        return;
    }
    if (!list || !list.length) { showMsg('adminImportStatus', '未解析到有效题目，请检查格式：每道题需以 [大类] 或 [大类-小类] 开头，可加 (来源)，如 [政治理论](2026超格)题号1：...', 'error'); if (wrap) wrap.style.display = 'none'; return; }
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    listEl.innerHTML = list.map(function(q, i) {
        var optHtml = (q.options || []).map(function(o) { return '<div class="option"><span class="option-label">' + o.label + '.</span> ' + esc(o.text) + '</div>'; }).join('');
        var kp = (q.knowledgePoints && q.knowledgePoints.length) ? ('考点：' + q.knowledgePoints.join('、')) : '';
        return '<div class="question-item"><div class="question-header"><span class="question-category">' + esc(q.category) + (q.subcategory ? ' - ' + esc(q.subcategory) : '') + '</span> <span style="color:#6c757d;">' + (i+1) + '.</span>' + (kp ? ' <span style="font-size:0.9rem; color:var(--primary-color);">' + esc(kp) + '</span>' : '') + '</div><div class="question-content">' + esc(q.content || '') + '</div><div class="options-grid">' + optHtml + '</div>' + (q.explanation ? '<div class="answer-block">解析：<div class="explanation-body">' + explanationToHtml(q.explanation) + '</div></div>' : '') + '</div>';
    }).join('');
    if (countEl) countEl.textContent = list.length;
    wrap.style.display = 'block';
    renderLaTeXInElement(listEl);
    showMsg('adminImportStatus', '已解析 ' + list.length + ' 题，公式已渲染；确认无误可点击「导入」', 'success');
}

function adminBatchImport() {
    var setId = document.getElementById('adminBatchSetId').value;
    if (!setId) { showMsg('adminImportStatus', '请先选择或新建套卷', 'error'); return; }
    var text = (document.getElementById('adminInputText').value || '').trim();
    if (!text) { showMsg('adminImportStatus', '请输入题目内容', 'error'); return; }
    var list = parseBatchText(text);
    if (!list.length) { showMsg('adminImportStatus', '未解析到有效题目，请检查格式与分类', 'error'); return; }
    var added = 0;
    list.forEach(function(q) {
        var section = q.category;
        if (!section) return;
        var set = adminStore.getSet(setId);
        if (set) {
            if (typeof ensureCategory === 'function') ensureCategory(section);
            if (!set[section]) set[section] = [];
            adminStore.addQuestion(setId, section, Object.assign({}, q)); added++;
        }
    });
    adminStore.save();
    fillAdminSetSelects();
    adminFilterSetList();
    if (typeof fillSectionDropdowns === 'function') fillSectionDropdowns();
    // 如果当前正在查看该套卷的详情页，刷新详情页
    if (adminCurrentViewSetId === setId) {
        adminViewSetDetails(setId);
    }
    document.getElementById('adminInputText').value = '';
    document.getElementById('adminBatchTxtFile').value = '';
    document.getElementById('adminBatchPreviewWrap').style.display = 'none';
    showMsg('adminImportStatus', '成功导入 ' + added + ' 题（已保存到本地）', 'success');
}

function adminBatchImportSequential() {
    var setId = document.getElementById('adminBatchSetId').value;
    if (!setId) { showMsg('adminImportStatus', '请先选择或新建套卷', 'error'); return; }
    var text = (document.getElementById('adminInputText').value || '').trim();
    if (!text) { showMsg('adminImportStatus', '请输入题目内容', 'error'); return; }
    var list = parseBatchText(text);
    if (!list.length) { showMsg('adminImportStatus', '未解析到有效题目，请检查格式与分类', 'error'); return; }
    var total = list.length;
    var progressWrap = document.getElementById('adminBatchProgressWrap');
    var progressBar = document.getElementById('adminBatchProgressBar');
    var progressText = document.getElementById('adminBatchProgressText');
    var progressPercent = document.getElementById('adminBatchProgressPercent');
    if (progressWrap) progressWrap.style.display = 'block';
    var intervalMs = 50;
    var added = 0;
    function updateProgress(n) {
        var pct = total ? Math.round((n / total) * 100) : 0;
        if (progressBar) progressBar.style.width = pct + '%';
        if (progressText) progressText.textContent = '正在录入：' + n + ' / ' + total;
        if (progressPercent) progressPercent.textContent = pct + '%';
    }
    updateProgress(0);
    function doOne(index) {
        if (index >= total) {
            adminStore.save();
            fillAdminSetSelects();
            adminFilterSetList();
            if (adminCurrentViewSetId === setId) adminViewSetDetails(setId);
            if (progressWrap) progressWrap.style.display = 'none';
            showMsg('adminImportStatus', '按顺序成功导入 ' + added + ' 题（已保存到本地，题目按录入顺序显示）', 'success');
            document.getElementById('adminInputText').value = '';
            document.getElementById('adminBatchTxtFile').value = '';
            document.getElementById('adminBatchPreviewWrap').style.display = 'none';
            return;
        }
        var q = list[index];
        var section = q.category;
        if (section) {
            var set = adminStore.getSet(setId);
            if (set) {
                if (typeof ensureCategory === 'function') ensureCategory(section);
                if (!set[section]) set[section] = [];
                adminStore.addQuestion(setId, section, Object.assign({}, q));
                added++;
            }
        }
        updateProgress(index + 1);
        setTimeout(function() { doOne(index + 1); }, intervalMs);
    }
    doOne(0);
}

var adminSingleZiliaoQIndex = 0;
function addAdminSingleZiliaoQuestion() {
    var idx = adminSingleZiliaoQIndex++;
    var container = document.getElementById('adminSingleZiliaoQuestions');
    if (!container) return;
    var qId = 'admin_zq_' + idx;
    var card = document.createElement('div');
    card.className = 'ziliao-question-card';
    card.setAttribute('data-zq-id', qId);
    card.innerHTML = '<div style="border:1px solid var(--border-color); border-radius:var(--border-radius); padding:12px; margin-bottom:12px; background:var(--light-bg);"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;"><strong>小题 ' + (idx + 1) + '</strong><button class="btn btn-sm" style="background:#dc3545; color:#fff; padding:4px 8px;" onclick="removeAdminZiliaoQuestion(\'' + qId + '\')"><i class="fas fa-times"></i></button></div>' +
        '<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:6px;"><label>小类</label><select id="' + qId + '_Subcategory" style="flex:1; padding:6px 10px;"></select></div>' +
        '<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:6px;"><label>来源</label><input type="text" id="' + qId + '_Source" placeholder="可选" style="flex:1; padding:6px 10px; border:1px solid var(--border-color); border-radius:var(--border-radius);"></div>' +
        '<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:6px;"><label>题干</label><input type="text" id="' + qId + '_Points" placeholder="考点，多个用逗号分隔" style="flex:1; max-width:220px; padding:6px 10px; border:1px solid var(--border-color); border-radius:var(--border-radius); font-size:0.9rem;"></div>' +
        '<div style="margin-bottom:8px;"><div id="' + qId + '_Stem" class="editable-area" contenteditable="true" style="min-height:50px;"></div></div>' +
        '<div style="margin-bottom:6px;"><label>选项 A</label><div id="' + qId + '_OptA" class="editable-area" contenteditable="true" style="min-height:36px;"></div></div>' +
        '<div style="margin-bottom:6px;"><label>选项 B</label><div id="' + qId + '_OptB" class="editable-area" contenteditable="true" style="min-height:36px;"></div></div>' +
        '<div style="margin-bottom:6px;"><label>选项 C</label><div id="' + qId + '_OptC" class="editable-area" contenteditable="true" style="min-height:36px;"></div></div>' +
        '<div style="margin-bottom:6px;"><label>选项 D</label><div id="' + qId + '_OptD" class="editable-area" contenteditable="true" style="min-height:36px;"></div></div>' +
        '<div class="filter-controls" style="margin-top:8px;"><div><label>答案</label><select id="' + qId + '_Answer" style="padding:8px;"><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select></div>' +
        '<div style="flex:2;"><label>解析</label><textarea id="' + qId + '_Explanation" rows="2" style="width:100%; padding:8px; border:1px solid var(--border-color); border-radius:var(--border-radius);" placeholder="可选"></textarea></div></div>';
    container.appendChild(card);
    var subEl = document.getElementById(qId + '_Subcategory');
    if (subEl) {
        var subs = SUBCATEGORIES['资料分析'] || [];
        subs.forEach(function(s) {
            var opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            subEl.appendChild(opt);
        });
    }
    [qId + '_Stem', qId + '_OptA', qId + '_OptB', qId + '_OptC', qId + '_OptD'].forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        if (!el.dataset.pasteBound) {
            el.dataset.pasteBound = '1';
            el.addEventListener('paste', function(e) {
                handleImagePaste(e, el);
            });
        }
    });
}

function removeAdminZiliaoQuestion(qId) {
    var card = document.querySelector('[data-zq-id="' + qId + '"]');
    if (card) card.remove();
}

function adminSingleSave() {
    if (!adminAuthenticated) {
        showMsg('adminSingleStatus', '请先登录管理员', 'error');
        return;
    }
    var setId = document.getElementById('adminSingleSetId').value;
    if (!setId) { showMsg('adminSingleStatus', '请先选择或新建套卷', 'error'); return; }
    var ziliaoMode = document.getElementById('adminSingleZiliaoMode') && document.getElementById('adminSingleZiliaoMode').checked;
    if (ziliaoMode) {
        var materialData = getEditableContent('adminSingleMaterialZiliao');
        var cards = document.querySelectorAll('#adminSingleZiliaoQuestions [data-zq-id]');
        if (!cards.length) { showMsg('adminSingleStatus', '请至少添加一道小题', 'error'); return; }
        var ziliaoBlockId = genId();
        var added = 0;
        cards.forEach(function(card, idx) {
            var qId = card.getAttribute('data-zq-id');
            var stemData = getEditableContent(qId + '_Stem');
            if (!stemData.text && !stemData.images.length) return;
            var optA = getEditableContent(qId + '_OptA'), optB = getEditableContent(qId + '_OptB'), optC = getEditableContent(qId + '_OptC'), optD = getEditableContent(qId + '_OptD');
            var subcategory = document.getElementById(qId + '_Subcategory').value || '资料分析';
            var source = (document.getElementById(qId + '_Source') && document.getElementById(qId + '_Source').value || '').trim();
            var pointsEl = document.getElementById(qId + '_Points');
            var kpStr = (pointsEl && pointsEl.value || '').trim();
            var knowledgePoints = kpStr ? kpStr.split(/[,，、\s]+/).map(function(s) { return s.trim(); }).filter(Boolean) : [];
            var options = [
                { label: 'A', text: optA.text, images: optA.images },
                { label: 'B', text: optB.text, images: optB.images },
                { label: 'C', text: optC.text, images: optC.images },
                { label: 'D', text: optD.text, images: optD.images }
            ];
            var answerEl = document.getElementById(qId + '_Answer');
            var expEl = document.getElementById(qId + '_Explanation');
            var q = { category: '资料分析', subcategory: subcategory, source: source, content: stemData.text, stemImages: stemData.images, material: materialData.text, materialImages: materialData.images, options: options, answer: answerEl ? answerEl.value : 'A', explanation: (expEl && expEl.value || '').trim(), knowledgePoints: knowledgePoints, ziliaoBlockId: ziliaoBlockId, ziliaoSubIndex: idx };
            adminStore.addQuestion(setId, '资料分析', q);
            added++;
        });
        if (added === 0) { showMsg('adminSingleStatus', '请至少填写一道小题的题干', 'error'); return; }
        adminStore.save();
        fillAdminSetSelects();
        adminFilterSetList();
        // 如果当前正在查看该套卷的详情页，刷新详情页
        if (adminCurrentViewSetId === setId) {
            adminViewSetDetails(setId);
        }
        showMsg('adminSingleStatus', '已保存 ' + added + ' 道小题（已保存到本地）', 'success');
        document.getElementById('adminSingleMaterialZiliao').innerHTML = '';
        cards.forEach(function(card) {
            var qId = card.getAttribute('data-zq-id');
            [qId + '_Stem', qId + '_OptA', qId + '_OptB', qId + '_OptC', qId + '_OptD'].forEach(function(id) { var e = document.getElementById(id); if (e) e.innerHTML = ''; });
            var e = document.getElementById(qId + '_Explanation'); if (e) e.value = '';
        });
        document.getElementById('adminSingleZiliaoQuestions').innerHTML = '';
        adminSingleZiliaoQIndex = 0;
        addAdminSingleZiliaoQuestion();
    } else {
        var built = adminSingleQueueBuildQuestion();
        if (!built.ok) { showMsg('adminSingleStatus', built.msg || '题目内容不完整', 'error'); return; }
        var question = built.question;
        adminStore.addQuestion(setId, section, question);
        adminStore.save();
        fillAdminSetSelects();
        adminFilterSetList();
        showMsg('adminSingleStatus', '题目已保存（已保存到本地）', 'success');
        var expEl = document.getElementById('adminSingleExplanation');
        if (expEl) expEl.innerHTML = '';
        ['adminSingleMaterial', 'adminSingleStem'].forEach(function(id) { var e = document.getElementById(id); if (e) e.innerHTML = ''; });
        // 重置默认值：判断推理、图形推理、A/B/C/D
        document.getElementById('adminSingleSection').value = '判断推理';
        updateAdminSingleSub();
        document.getElementById('adminSingleSubcategory').value = '图形推理';
        setAdminSingleOptionDefaults();
    }
}

var _adminSingleQueue = [];
var _adminSingleQueueImportTimer = null;
function adminSingleQueueUpdateUI() {
    var countEl = document.getElementById('adminSingleQueueCount');
    var listEl = document.getElementById('adminSingleQueueList');
    var n = _adminSingleQueue.length;
    if (countEl) countEl.textContent = '队列中 ' + n + ' 题';
    if (!listEl) return;
    if (!n) {
        listEl.innerHTML = '<div class="empty" style="padding:16px; font-size:0.85rem; color:#6c757d;">当前队列为空，可先在上方录入题目后加入队列。</div>';
        return;
    }
    function esc(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    listEl.innerHTML = _adminSingleQueue.map(function(item, idx) {
        var q = item.question || {};
        var preview = (q.content || '').slice(0, 60) + ((q.content || '').length > 60 ? '…' : '');
        return '<div class="question-row">' +
            '<div class="q-main">' +
            '<div><span class="badge-sec">[' + esc(q.category || '') + (q.subcategory ? ' - ' + esc(q.subcategory) : '') + ']</span>' +
            '<span class="muted"> #' + (idx + 1) + '</span>' +
            (q.source ? ' <span class="muted">(' + esc(q.source) + ')</span>' : '') +
            '</div>' +
            '<div class="q-snippet">' + esc(preview || '(无题干)') + '</div>' +
            '</div>' +
            '</div>';
    }).join('');
}
function adminSingleQueueBuildQuestion() {
    var stemData = getEditableContent('adminSingleStem');
    var materialData = getEditableContent('adminSingleMaterial');
    var optA = getEditableContent('adminSingleOptA'), optB = getEditableContent('adminSingleOptB'), optC = getEditableContent('adminSingleOptC'), optD = getEditableContent('adminSingleOptD');
    if (!stemData.text && !stemData.images.length) {
        return { ok: false, msg: '请填写题干后再加入队列或保存。' };
    }
    var section = document.getElementById('adminSingleSection').value;
    var subCustom = (document.getElementById('adminSingleSubcategoryCustom') && document.getElementById('adminSingleSubcategoryCustom').value || '').trim();
    var subcategory = subCustom || (document.getElementById('adminSingleSubcategory').value || '');
    if (subcategory) ensureSubcategory(section, subcategory);
    var source = (document.getElementById('adminSingleSource').value || '').trim();
    var options = [
        { label: 'A', text: optA.text, images: optA.images },
        { label: 'B', text: optB.text, images: optB.images },
        { label: 'C', text: optC.text, images: optC.images },
        { label: 'D', text: optD.text, images: optD.images }
    ];
    var explanationStr = getExplanationWithInlineImages('adminSingleExplanation') || '';
    var question = {
        category: section,
        subcategory: subcategory,
        source: source,
        content: stemData.text,
        stemImages: stemData.images,
        material: materialData.text,
        materialImages: materialData.images,
        options: options,
        answer: document.getElementById('adminSingleAnswer').value,
        explanation: explanationStr
    };
    return { ok: true, question: question };
}
function adminSingleQueueAdd() {
    var statusEl = document.getElementById('adminSingleQueueStatus');
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'status-message'; }
    if (!adminAuthenticated) {
        if (statusEl) { statusEl.textContent = '请先登录管理员。'; statusEl.className = 'status-message error'; }
        return;
    }
    var setIdEl = document.getElementById('adminSingleSetId');
    if (!setIdEl || !setIdEl.value) {
        if (statusEl) { statusEl.textContent = '请先选择或新建套卷，再将题目加入队列。'; statusEl.className = 'status-message error'; }
        return;
    }
    var ziliaoModeEl = document.getElementById('adminSingleZiliaoMode');
    if (ziliaoModeEl && ziliaoModeEl.checked) {
        if (statusEl) { statusEl.textContent = '当前为资料分析（一材料多题）模式，暂不支持加入单题队列，请关闭该模式后使用队列功能。'; statusEl.className = 'status-message error'; }
        return;
    }
    var built = adminSingleQueueBuildQuestion();
    if (!built.ok) {
        if (statusEl) { statusEl.textContent = built.msg || '题目内容不完整，无法加入队列。'; statusEl.className = 'status-message error'; }
        return;
    }
    _adminSingleQueue.push({ setId: setIdEl.value, question: built.question });
    adminSingleQueueUpdateUI();
    if (statusEl) { statusEl.textContent = '已将当前题加入队列（未立即保存到题库）。'; statusEl.className = 'status-message success'; }
}
function adminSingleQueueImport() {
    var statusEl = document.getElementById('adminSingleQueueStatus');
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'status-message'; }
    if (!adminAuthenticated) {
        if (statusEl) { statusEl.textContent = '请先登录管理员。'; statusEl.className = 'status-message error'; }
        return;
    }
    if (!_adminSingleQueue.length) {
        if (statusEl) { statusEl.textContent = '队列为空，请先通过“将当前题加入队列”添加题目。'; statusEl.className = 'status-message error'; }
        return;
    }
    if (_adminSingleQueueImportTimer) {
        if (statusEl) { statusEl.textContent = '正在导入中，请稍候…'; statusEl.className = 'status-message'; }
        return;
    }
    var items = _adminSingleQueue.slice();
    var total = items.length;
    var index = 0;
    var imported = 0;
    var perDelay = 50; // 每题约 0.05s
    function step() {
        if (index >= total) {
            adminStore.save();
            fillAdminSetSelects();
            adminFilterSetList();
            if (adminCurrentViewSetId) {
                adminViewSetDetails(adminCurrentViewSetId);
            }
            _adminSingleQueue = [];
            adminSingleQueueUpdateUI();
            if (statusEl) {
                statusEl.textContent = '已按队列顺序导入 ' + imported + ' 题到对应套卷（每题约 0.05 秒）。';
                statusEl.className = 'status-message success';
            }
            _adminSingleQueueImportTimer = null;
            return;
        }
        var item = items[index];
        index++;
        if (item && item.setId && item.question && item.question.category) {
            var set = adminStore.getSet(item.setId);
            var section = item.question.category;
            if (set) {
                if (typeof ensureCategory === 'function') ensureCategory(section);
                if (!set[section]) set[section] = [];
                adminStore.addQuestion(item.setId, section, Object.assign({}, item.question));
                imported++;
            }
        }
        if (statusEl) {
            statusEl.textContent = '正在导入队列第 ' + index + ' / ' + total + ' 题…';
            statusEl.className = 'status-message';
        }
        _adminSingleQueueImportTimer = setTimeout(step, perDelay);
    }
    step();
}



// ==================== 管理员题库管理功能结束 ====================

document.addEventListener('DOMContentLoaded', function() {
    store.load();
    // 题库站点地址：初始化输入框回显
    try {
        var rb = document.getElementById('remoteBaseInput');
        if (rb) rb.value = getRemoteBaseUrl() || '';
    } catch (e) {}
    if (typeof profileUpdateLoginUI === 'function') profileUpdateLoginUI();
    if (getCurrentUser()) mergeUserQuestionStatsIntoStore();
    rebuildSubcategoriesFromStore();
    if (typeof fillSectionDropdowns === 'function') fillSectionDropdowns();
    if (!store.sets.length) { store.addSet('默认套卷'); store.save(); }
    document.getElementById('tab-home').classList.add('active');
    renderTree();
    fillCategorySelects();
    fillSetSelects();
    var addToSetId = (function() { var m = /[?&]addToSetId=([^&]+)/.exec(location.search); return m ? decodeURIComponent(m[1]) : null; })();
    if (!addToSetId) { try { addToSetId = localStorage.getItem('xingce_add_to_set_id') || sessionStorage.getItem('xingce_add_to_set_id'); } catch (e) {} }
    if (addToSetId) {
        document.getElementById('singleSetId').value = addToSetId;
        document.getElementById('batchSetId').value = addToSetId;
        try { localStorage.removeItem('xingce_add_to_set_id'); sessionStorage.removeItem('xingce_add_to_set_id'); } catch (e) {}
    }
    // 管理员：从套卷题目管理页跳回时，预选套卷并打开录入区
    var adminAddToSetId = (function() { var m = /[?&]adminAddToSetId=([^&]+)/.exec(location.search); return m ? decodeURIComponent(m[1]) : null; })();
    var adminImportType = (function() { var m = /[?&]adminImportType=([^&]+)/.exec(location.search); return m ? decodeURIComponent(m[1]) : null; })();
    if (!adminAddToSetId) { try { adminAddToSetId = localStorage.getItem('xingce_admin_add_to_set_id') || sessionStorage.getItem('xingce_admin_add_to_set_id'); } catch (e) {} }
    if (adminAddToSetId) {
        window.__adminAddToSetId = adminAddToSetId;
        window.__adminImportType = adminImportType || 'single';
        try { localStorage.removeItem('xingce_admin_add_to_set_id'); sessionStorage.removeItem('xingce_admin_add_to_set_id'); } catch (e) {}
    }
    if (location.hash === '#single') switchTab('single');
    else if (location.hash === '#batch') switchTab('batch');
    else if (location.hash === '#admin') {
        switchTab('admin');
        if (window.self !== window.top) document.body.classList.add('admin-iframe-loaded');
    }
    var singleSec = document.getElementById('singleSection');
    if (singleSec && MAIN_SECTIONS.indexOf('判断推理') !== -1) singleSec.value = '判断推理';
    updateSingleSub();
    document.getElementById('singleSubcategory').value = '图形推理';
    document.getElementById('singleSection').addEventListener('change', updateSingleSub);
    var ziliaoCb = document.getElementById('singleZiliaoMode');
    if (ziliaoCb) ziliaoCb.addEventListener('change', function() {
        var on = ziliaoCb.checked;
        document.getElementById('singleNormalFields').style.display = on ? 'none' : 'block';
        document.getElementById('singleAnswerRow').style.display = on ? 'none' : 'flex';
        var zf = document.getElementById('singleZiliaoFields');
        zf.style.display = on ? 'block' : 'none';
        if (on) {
            document.getElementById('singleSection').value = '资料分析';
            updateSingleSub();
            document.getElementById('singleZiliaoQuestions').innerHTML = '';
            singleZiliaoQIndex = 0;
            for (var i = 0; i < 5; i++) addSingleZiliaoQuestion();
        } else {
            document.getElementById('singleSection').value = '判断推理';
            updateSingleSub();
            document.getElementById('singleSubcategory').value = '图形推理';
            setSingleOptionDefaults();
        }
    });
    bindEditablePaste();
    ['singleMaterial', 'singleStem', 'singleOptA', 'singleOptB', 'singleOptC', 'singleOptD', 'singleExplanation'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) { el.addEventListener('input', updateSinglePreview); el.addEventListener('paste', function() { setTimeout(updateSinglePreview, 100); }); }
    });
    updateManageSub();
    updatePracticeSub();
    var practiceSectionsWrap = document.getElementById('practiceSectionsWrap');
    if (practiceSectionsWrap) practiceSectionsWrap.addEventListener('change', function(e) { if (e.target.name === 'practiceSection') updatePracticeSub(); });
    checkExportState();
    bindBatchInputPaste();
    // 页面初始化后，尝试从 GitHub 上拉取最新题库（data/store.json）
    loadRemoteStore();
});
var _batchLivePreviewTimer = null;
function updateBatchLivePreview() {
    var ta = document.getElementById('inputText');
    var wrap = document.getElementById('batchLivePreview');
    if (!ta || !wrap) return;
    var raw = (ta.value || '');
    if (!raw.trim()) { wrap.innerHTML = '<span style="color:var(--text-secondary);">输入内容后将在此实时显示图片与公式</span>'; return; }
    var html = raw
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\[IMG:(data:[^\]]+)\]/gi, function(_, src) { return '<img src="' + src + '" style="max-width:100%; height:auto; margin:4px 0; vertical-align:middle;" />'; })
        .replace(/\[IMG:([A-Za-z0-9+/=]+)\]/g, function(_, b64) { return '<img src="data:image/png;base64,' + b64 + '" style="max-width:100%; height:auto; margin:4px 0; vertical-align:middle;" />'; })
        .replace(/!\[[^\]]*\]\((data:[^)]+)\)/g, function(_, src) { return '<img src="' + src + '" style="max-width:100%; height:auto; margin:4px 0; vertical-align:middle;" />'; });
    wrap.innerHTML = html.replace(/\n/g, '<br>');
    if (typeof renderLaTeXInElement === 'function') renderLaTeXInElement(wrap);
}
function scheduleBatchLivePreview() {
    if (_batchLivePreviewTimer) clearTimeout(_batchLivePreviewTimer);
    _batchLivePreviewTimer = setTimeout(function() { _batchLivePreviewTimer = null; updateBatchLivePreview(); }, 150);
}
function bindBatchInputPaste() {
    var ta = document.getElementById('inputText');
    if (!ta) return;
    ta.addEventListener('input', scheduleBatchLivePreview);
    ta.addEventListener('paste', function(e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        var imageFiles = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) imageFiles.push(items[i].getAsFile());
        }
        if (!imageFiles.length) return;
        e.preventDefault();
        var start = ta.selectionStart, end = ta.selectionEnd;
        var text = ta.value;
        var inserted = 0;
        function insertNext(idx) {
            if (idx >= imageFiles.length) {
                ta.selectionStart = ta.selectionEnd = start + inserted;
                ta.focus();
                return;
            }
            var file = imageFiles[idx];
            var reader = new FileReader();
            reader.onload = function() {
                var token = '[IMG:' + reader.result + ']';
                text = text.slice(0, start + inserted) + token + text.slice(start + inserted);
                inserted += token.length;
                ta.value = text;
                insertNext(idx + 1);
            };
            reader.readAsDataURL(file);
        }
        insertNext(0);
    });
    ta.addEventListener('paste', function() { scheduleBatchLivePreview(); });
}