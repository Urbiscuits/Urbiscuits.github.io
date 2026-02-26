/**
 * 批量导入解析器
 * 依赖全局：SUBCATEGORIES, genId, ensureSubcategory
 * 部署时（GitHub Pages）确保 MAIN_SECTIONS/SUBCATEGORIES 存在，避免预览/解析失败
 */
(function(window) {
    'use strict';

    var DEFAULT_SECTIONS = ['言语理解', '数量关系', '判断推理', '资料分析', '政治理论', '常识判断', '策略选择'];
    if (!window.MAIN_SECTIONS || !Array.isArray(window.MAIN_SECTIONS) || window.MAIN_SECTIONS.length < 6) {
        window.MAIN_SECTIONS = DEFAULT_SECTIONS.slice();
    }
    if (!window.SUBCATEGORIES || typeof window.SUBCATEGORIES !== 'object') {
        window.SUBCATEGORIES = window.SUBCATEGORIES || {};
    }
    DEFAULT_SECTIONS.forEach(function(s) {
        if (!window.SUBCATEGORIES[s] || !Array.isArray(window.SUBCATEGORIES[s])) {
            window.SUBCATEGORIES[s] = window.SUBCATEGORIES[s] || [];
        }
    });
    function ensureCategoryFallback(category) {
        if (!category || typeof category !== 'string') return;
        var c = category.trim();
        if (!c) return;
        try {
            if (!window.MAIN_SECTIONS || !Array.isArray(window.MAIN_SECTIONS)) {
                window.MAIN_SECTIONS = DEFAULT_SECTIONS.slice();
            }
            var main = window.MAIN_SECTIONS;
            if (main.indexOf(c) === -1) { main.push(c); }
            if (window.SUBCATEGORIES) {
                if (!window.SUBCATEGORIES[c]) window.SUBCATEGORIES[c] = [];
            }
        } catch (e) {}
    }

    function extractImagesFromText(s) {
        if (!s || typeof s !== 'string') return { text: '', images: [] };
        var images = [];
        var text = String(s)
            .replace(/!\[[^\]]*\]\((data:[^)]+)\)/g, function(_, src) { images.push(src); return ' '; })
            .replace(/\[IMG:(data:[^\]]+)\]/gi, function(_, src) { images.push(src); return ' '; })
            .replace(/\[IMG:([A-Za-z0-9+/=]+)\]/g, function(_, b64) { images.push('data:image/png;base64,' + b64); return ' '; });
        var normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n').trim();
        return { text: normalized, images: images };
    }

    function parseOne(text) {
        var ensureSubcategory = window.ensureSubcategory;
        var extract = extractImagesFromText;
        var lines = text.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
        if (lines.length < 3) return null;
        var m = lines[0].match(/\[([^\]]+)-([^\]]+)\](?:\(([^)]*)\))?\s*(.*)/);
        var category, subcategory, source, startIdx, contentPrefix;
        if (m) {
            category = m[1].trim();
            subcategory = m[2].trim();
            source = (m[3] || '').trim();
            contentPrefix = (m[4] || '').trim();
            if (!category) return null;
            try { (window.ensureCategory || ensureCategoryFallback)(category); } catch (e) {}
            try { if (subcategory && ensureSubcategory) ensureSubcategory(category, subcategory); } catch (e) {}
            startIdx = 1;
        } else {
            var m2 = lines[0].match(/\[([^\]]+)\](?:\(([^)]*)\))?\s*(.*)/);
            if (m2) {
                category = m2[1].trim();
                if (!category) return null;
                try { (window.ensureCategory || ensureCategoryFallback)(category); } catch (e) {}
                subcategory = '';
                source = (m2[2] || '').trim();
                contentPrefix = (m2[3] || '').trim();
                startIdx = 1;
            } else return null;
        }
        var content = contentPrefix, options = [], answer = '', explanation = '', knowledgePoints = [], inContent = true;
        for (var i = startIdx; i < lines.length; i++) {
            var line = lines[i], om = line.match(/^([A-D])[\.:：、]\s*(.+)$/);
            if (om && options.length < 4) {
                var optRes = extract(om[2].trim());
                options.push({ label: om[1], text: optRes.text, images: optRes.images || [] });
                inContent = false;
                continue;
            }
            if (line.indexOf('答案') === 0 && (line.indexOf(':') !== -1 || line.indexOf('：') !== -1)) { var am = line.match(/答案[：:]\s*([A-D])/); if (am) answer = am[1]; continue; }
            if (line.indexOf('解析') === 0 && (line.indexOf(':') !== -1 || line.indexOf('：') !== -1)) { explanation = line.replace(/^解析[：:]\s*/, '').trim(); continue; }
            if (line.indexOf('考点') === 0 && (line.indexOf(':') !== -1 || line.indexOf('：') !== -1)) {
                var kpStr = line.replace(/^考点[：:]\s*/, '').trim().replace(/[。]$/, '');
                if (kpStr) knowledgePoints = kpStr.split(/[、，,。;；\s]+/).map(function(s) { return s.trim(); }).filter(Boolean);
                continue;
            }
            if (inContent && line.match(/^\[[^\]]+\](?:\([^)]*\))?\s*$/)) continue;
            if (inContent) content += (content ? '\n' : '') + line;
        }
        var stemRes = extract(content.trim());
        if (!stemRes.text && stemRes.images.length === 0) return null;
        if (options.length === 0) return null;
        return { category: category, subcategory: subcategory, source: source, content: stemRes.text, options: options, answer: answer, explanation: explanation, material: '', materialImages: [], stemImages: stemRes.images || [], optionImages: [], knowledgePoints: knowledgePoints };
    }

    function parseZiliaoBlock(block, subcategory, source) {
        var ensureSubcategory = window.ensureSubcategory;
        var genId = window.genId || function() { return 'zblk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); };
        var extract = extractImagesFromText;
        var results = [];
        var lines = block.split('\n');
        try { if (ensureSubcategory) ensureSubcategory('资料分析', subcategory); } catch (e) {}
        var material = '', materialImages = [];
        var ziliaoBlockId = genId ? genId() : 'zblk_' + Date.now();
        var subIndex = 0;
        var i = 0;
        while (i < lines.length) {
            var line = lines[i];
            var matM = line.match(/^材料\d*[：:]\s*(.*)$/);
            if (matM) {
                var mr = extract(matM[1].trim());
                material = mr.text;
                materialImages = mr.images || [];
                i++;
                continue;
            }
            var titM = line.match(/^题目\d*[：:]\s*(.*)$/);
            if (titM) {
                var content = titM[1].trim();
                i++;
                var options = [], answer = '', explanation = '', knowledgePoints = [];
                while (i < lines.length) {
                    var l = lines[i];
                    var om = l.match(/^([A-D])[\.:：、]\s*(.+)$/);
                    if (om && options.length < 4) {
                        var optRes = extract(om[2].trim());
                        options.push({ label: om[1], text: optRes.text, images: optRes.images || [] });
                        i++;
                        continue;
                    }
                    if (l.indexOf('答案') === 0) { var am = l.match(/答案[：:]\s*([A-D])/); if (am) answer = am[1]; i++; continue; }
                    if (l.indexOf('解析') === 0) { explanation = l.replace(/^解析[：:]\s*/, '').trim(); i++; continue; }
                    if (l.indexOf('考点') === 0 && (l.indexOf(':') !== -1 || l.indexOf('：') !== -1)) {
                        var kpStr = l.replace(/^考点[：:]\s*/, '').trim().replace(/[。]$/, '');
                        if (kpStr) knowledgePoints = kpStr.split(/[、，,。;；\s]+/).map(function(s) { return s.trim(); }).filter(Boolean);
                        i++;
                        continue;
                    }
                    if (/^\s*\[[^\]]+-[^\]]+\]/.test(l)) break;
                    if (/^题目\d*[：:]/.test(l)) break;
                    content += (content ? '\n' : '') + l.trim();
                    i++;
                }
                var stemRes = extract(content);
                if (options.length >= 1) {
                    results.push({
                        category: '资料分析', subcategory: subcategory, source: source,
                        content: stemRes.text, options: options, answer: answer, explanation: explanation,
                        material: material, materialImages: materialImages, stemImages: stemRes.images || [],
                        optionImages: [], knowledgePoints: knowledgePoints,
                        ziliaoBlockId: ziliaoBlockId, ziliaoSubIndex: subIndex
                    });
                    subIndex++;
                }
                continue;
            }
            i++;
        }
        return results;
    }

    /**
     * 智能识别：遇到 [资料分析-xxx] 按一材料多题解析；遇到 [言语理解-xx] 等其他题型则结束资料分析，按单题解析
     * 对粘贴文本做兼容处理：BOM、CRLF、全角方括号
     */
    function parseBatchText(text) {
        if (!text || typeof text !== 'string') return [];
        var normalized = String(text)
            .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
            .replace(/^\uFEFF/, '')  // BOM
            .replace(/【/g, '[').replace(/】/g, ']');  // 全角方括号转半角
        var results = [];
        var lines = normalized.split('\n');
        var headerRegex = /^\s*\[[^\]]+\](?:\([^)]*\))?/;
        var blocks = [];
        var currentStart = -1;
        for (var i = 0; i < lines.length; i++) {
            if (headerRegex.test(lines[i])) {
                if (currentStart >= 0) blocks.push(lines.slice(currentStart, i).join('\n').trim());
                currentStart = i;
            }
        }
        if (currentStart >= 0) blocks.push(lines.slice(currentStart).join('\n').trim());
        for (var i = 0; i < blocks.length; i++) {
            var block = blocks[i];
            var m = block.match(/^\[资料分析-([^\]]+)\](?:\(([^)]*)\))?/);
            if (m) {
                var zqs = parseZiliaoBlock(block, m[1].trim(), (m[2] || '').trim());
                if (zqs.length > 0) {
                    zqs.forEach(function(q) { if (q) results.push(q); });
                } else {
                    var q = parseOne(block);
                    if (q) results.push(q);
                }
            } else {
                var q = parseOne(block);
                if (q) results.push(q);
            }
        }
        return results;
    }

    window.extractImagesFromText = extractImagesFromText;
    window.parseOne = parseOne;
    window.parseZiliaoBlock = parseZiliaoBlock;
    window.parseBatchText = parseBatchText;
})(window);
