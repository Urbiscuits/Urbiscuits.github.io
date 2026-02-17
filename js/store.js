/**
 * 题库数据存储
 * 依赖全局：MAIN_SECTIONS, genId
 */
(function(window) {
    'use strict';
    var MAIN_SECTIONS = window.MAIN_SECTIONS || ['言语理解', '数量关系', '判断推理', '资料分析'];
    var genId = window.genId || function() { return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); };

    var store = {
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
            this.sets.push({ id: id, name: n || '未命名套卷', category: category || '', '言语理解': [], '数量关系': [], '判断推理': [], '资料分析': [] });
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
            q.done = q.done || false;
            q.correctCount = q.correctCount != null ? q.correctCount : 0;
            q.totalAttempts = q.totalAttempts != null ? q.totalAttempts : 0;
            q.knowledgePoints = Array.isArray(q.knowledgePoints) ? q.knowledgePoints : (q.knowledgePoint ? [q.knowledgePoint] : []);
            this.questions[q.id] = q;
            var set = this.getSet(setId);
            if (set && set[section]) set[section].push(q.id);
            return q.id;
        },
        recordAnswer: function(qid, selected, correct) {
            var q = this.questions[qid];
            if (!q) return;
            q.totalAttempts = (q.totalAttempts || 0) + 1;
            q.correctCount = (q.correctCount || 0) + (correct ? 1 : 0);
            q.done = true;
        },
        removeQuestion: function(qid) {
            var q = this.questions[qid];
            if (!q || !q.setId) return;
            var set = this.getSet(q.setId);
            if (set && set[q.section]) set[q.section] = set[q.section].filter(function(id) { return id !== qid; });
            delete this.questions[qid];
        },
        setQuestionDone: function(qid, done) { if (this.questions[qid]) this.questions[qid].done = !!done; },
        getMergedStats: function() {
            var tree = {};
            MAIN_SECTIONS.forEach(function(s) { tree[s] = {}; });
            var self = this;
            this.sets.forEach(function(set) {
                MAIN_SECTIONS.forEach(function(section) {
                    (set[section] || []).forEach(function(qid) {
                        var q = self.questions[qid];
                        if (!q) return;
                        var sub = q.subcategory || q.section || section;
                        tree[section][sub] = (tree[section][sub] || 0) + 1;
                    });
                });
            });
            return tree;
        },
        getAllQuestionIds: function() {
            var ids = new Set();
            this.sets.forEach(function(set) {
                MAIN_SECTIONS.forEach(function(s) { (set[s] || []).forEach(function(qid) { ids.add(qid); }); });
            });
            return Array.from(ids);
        },
        getQuestionIdsByCategory: function(category, subcategory) {
            var ids = [];
            var self = this;
            this.sets.forEach(function(set) {
                (set[category] || []).forEach(function(qid) {
                    var q = self.questions[qid];
                    if (!q) return;
                    if (!subcategory || subcategory === 'all' || q.subcategory === subcategory) ids.push(qid);
                });
            });
            return ids;
        },
        getRandomQuestions: function(category, subcategory, count) {
            var ids = category ? this.getQuestionIdsByCategory(category, subcategory) : this.getAllQuestionIds();
            var self = this;
            var undone = ids.filter(function(qid) { var q = self.questions[qid]; return q && (q.totalAttempts || 0) === 0; });
            var done = ids.filter(function(qid) { var q = self.questions[qid]; return q && (q.totalAttempts || 0) > 0; });
            for (var i = undone.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = undone[i]; undone[i] = undone[j]; undone[j] = t; }
            done.sort(function(a, b) {
                var qa = self.questions[a], qb = self.questions[b];
                var ra = (qa.totalAttempts && qa.totalAttempts > 0) ? (qa.correctCount || 0) / qa.totalAttempts : 0;
                var rb = (qb.totalAttempts && qb.totalAttempts > 0) ? (qb.correctCount || 0) / qb.totalAttempts : 0;
                return ra - rb;
            });
            ids = undone.concat(done);
            return ids.slice(0, count).map(function(qid) { return self.questions[qid]; }).filter(Boolean);
        },
        getQuestionsBySet: function(setId) {
            var set = this.getSet(setId);
            if (!set) return [];
            var self = this;
            var ids = MAIN_SECTIONS.reduce(function(a, s) { return a.concat(set[s] || []); }, []);
            var undone = ids.filter(function(qid) { var q = self.questions[qid]; return q && (q.totalAttempts || 0) === 0; });
            var done = ids.filter(function(qid) { var q = self.questions[qid]; return q && (q.totalAttempts || 0) > 0; });
            for (var i = undone.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = undone[i]; undone[i] = undone[j]; undone[j] = t; }
            done.sort(function(a, b) {
                var qa = self.questions[a], qb = self.questions[b];
                var ra = (qa.totalAttempts && qa.totalAttempts > 0) ? (qa.correctCount || 0) / qa.totalAttempts : 0;
                var rb = (qb.totalAttempts && qb.totalAttempts > 0) ? (qb.correctCount || 0) / qb.totalAttempts : 0;
                return ra - rb;
            });
            ids = undone.concat(done);
            return ids.map(function(qid) { return self.questions[qid]; }).filter(Boolean);
        },
        getRandomQuestionsBySections: function(sections, subcategory, count) {
            var subs = (!subcategory || subcategory === 'all') ? [] : [subcategory];
            return this.getRandomQuestionsBySectionsAndSubs(sections, subs, count);
        },
        getRandomQuestionsBySectionsAndSubs: function(sections, subcategories, count) {
            if (!sections || !sections.length) return this.getRandomQuestions(null, null, count);
            var ids = [];
            var self = this;
            var subSet = (subcategories && subcategories.length) ? {} : null;
            if (subSet) subcategories.forEach(function(s) { subSet[s] = true; });
            this.sets.forEach(function(set) {
                (sections || []).forEach(function(section) {
                    (set[section] || []).forEach(function(qid) {
                        var q = self.questions[qid];
                        if (!q) return;
                        if (!subSet || subSet[q.subcategory]) ids.push(qid);
                    });
                });
            });
            ids = Array.from(new Set(ids));
            var undone = ids.filter(function(qid) { var q = self.questions[qid]; return q && (q.totalAttempts || 0) === 0; });
            var done = ids.filter(function(qid) { var q = self.questions[qid]; return q && (q.totalAttempts || 0) > 0; });
            for (var i = undone.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = undone[i]; undone[i] = undone[j]; undone[j] = t; }
            done.sort(function(a, b) {
                var qa = self.questions[a], qb = self.questions[b];
                var ra = (qa.totalAttempts && qa.totalAttempts > 0) ? (qa.correctCount || 0) / qa.totalAttempts : 0;
                var rb = (qb.totalAttempts && qb.totalAttempts > 0) ? (qb.correctCount || 0) / qb.totalAttempts : 0;
                return ra - rb;
            });
            ids = undone.concat(done);
            return ids.slice(0, count).map(function(qid) { return self.questions[qid]; }).filter(Boolean);
        },
        getQuestionIdsByKnowledgePoints: function(kps) {
            if (!kps || !kps.length) return this.getAllQuestionIds();
            var kpSet = kps.length ? (typeof kps === 'string' ? [kps] : kps) : [];
            var ids = [];
            var self = this;
            this.sets.forEach(function(set) {
                MAIN_SECTIONS.forEach(function(s) {
                    (set[s] || []).forEach(function(qid) {
                        var q = self.questions[qid];
                        if (!q) return;
                        var arr = q.knowledgePoints || q.knowledgePoint ? [q.knowledgePoint] : [];
                        if (kpSet.some(function(kp) { return arr.indexOf(kp) !== -1; })) ids.push(qid);
                    });
                });
            });
            return Array.from(new Set(ids));
        },
        getRandomQuestionsByKnowledgePoints: function(kps, count) {
            var self = this;
            var ids = this.getQuestionIdsByKnowledgePoints(kps);
            var undone = ids.filter(function(qid) { var q = self.questions[qid]; return q && (q.totalAttempts || 0) === 0; });
            var done = ids.filter(function(qid) { var q = self.questions[qid]; return q && (q.totalAttempts || 0) > 0; });
            for (var i = undone.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = undone[i]; undone[i] = undone[j]; undone[j] = t; }
            done.sort(function(a, b) {
                var qa = self.questions[a], qb = self.questions[b];
                var ra = (qa.totalAttempts && qa.totalAttempts > 0) ? (qa.correctCount || 0) / qa.totalAttempts : 0;
                var rb = (qb.totalAttempts && qb.totalAttempts > 0) ? (qb.correctCount || 0) / qb.totalAttempts : 0;
                return ra - rb;
            });
            ids = undone.concat(done);
            return ids.slice(0, count).map(function(qid) { return self.questions[qid]; }).filter(Boolean);
        },
        getAllKnowledgePoints: function() {
            var set = {};
            var self = this;
            this.sets.forEach(function(s) {
                MAIN_SECTIONS.forEach(function(sec) {
                    (s[sec] || []).forEach(function(qid) {
                        var q = self.questions[qid];
                        if (q && (q.knowledgePoints || []).length) (q.knowledgePoints || []).forEach(function(kp) { if (kp) set[kp] = true; });
                    });
                });
            });
            return Object.keys(set).sort();
        },
        getWrongQuestionIds: function() {
            var ids = [];
            var self = this;
            this.sets.forEach(function(set) {
                MAIN_SECTIONS.forEach(function(s) {
                    (set[s] || []).forEach(function(qid) {
                        var q = self.questions[qid];
                        if (q && (q.totalAttempts || 0) > 0 && (q.correctCount || 0) < q.totalAttempts) ids.push(qid);
                    });
                });
            });
            return ids;
        },
        getQuestion: function(qid) { return this.questions[qid]; },
        getQuestionsByZiliaoBlockId: function(blockId) {
            var self = this;
            return Object.keys(this.questions).filter(function(qid) { var q = self.questions[qid]; return q && q.ziliaoBlockId === blockId; }).sort(function(a, b) { var qa = self.questions[a], qb = self.questions[b]; return (qa.ziliaoSubIndex || 0) - (qb.ziliaoSubIndex || 0); }).map(function(qid) { return self.questions[qid]; });
        },
        save: function() { localStorage.setItem('xingce_sets', JSON.stringify(this.sets)); localStorage.setItem('xingce_questions', JSON.stringify(this.questions)); },
        load: function() { try { var s = localStorage.getItem('xingce_sets'); var q = localStorage.getItem('xingce_questions'); if (s) this.sets = JSON.parse(s); if (q) this.questions = JSON.parse(q); } catch (e) {} }
    };

    window.store = store;
})(window);
