/**
 * 管理员题库使用 IndexedDB 存储，容量远大于 localStorage（可视为“无限”），避免配额超限。
 * 首次使用时自动从 localStorage 迁移到 IndexedDB。
 */
(function(global) {
    'use strict';
    var DB_NAME = 'xingce_admin_db';
    var STORE_NAME = 'data';
    var KEY = 'store';

    function openDB() {
        return new Promise(function(resolve, reject) {
            try {
                var req = indexedDB.open(DB_NAME, 1);
                req.onerror = function() { reject(req.error); };
                req.onsuccess = function() { resolve(req.result); };
                req.onupgradeneeded = function() {
                    if (!req.result.objectStoreNames.contains(STORE_NAME)) {
                        req.result.createObjectStore(STORE_NAME);
                    }
                };
            } catch (e) {
                reject(e);
            }
        });
    }

    function get(db, key) {
        return new Promise(function(resolve, reject) {
            var tx = db.transaction(STORE_NAME, 'readonly');
            var store = tx.objectStore(STORE_NAME);
            var req = store.get(key);
            req.onsuccess = function() { resolve(req.result); };
            req.onerror = function() { reject(req.error); };
        });
    }

    function set(db, key, value) {
        return new Promise(function(resolve, reject) {
            var tx = db.transaction(STORE_NAME, 'readwrite');
            var store = tx.objectStore(STORE_NAME);
            var req = store.put(value, key);
            req.onsuccess = function() { resolve(); };
            req.onerror = function() { reject(req.error); };
        });
    }

    function clearStore(db) {
        return new Promise(function(resolve, reject) {
            var tx = db.transaction(STORE_NAME, 'readwrite');
            var store = tx.objectStore(STORE_NAME);
            var req = store.clear();
            req.onsuccess = function() { resolve(); };
            req.onerror = function() { reject(req.error); };
        });
    }

    /** 从 localStorage 读取旧数据（若存在）并写入 IndexedDB，然后删除 localStorage 中的键 */
    function migrateFromLocalStorage() {
        try {
            var s = localStorage.getItem('xingce_admin_sets');
            var q = localStorage.getItem('xingce_admin_questions');
            if (!s && !q) return Promise.resolve();
            var data = {
                sets: s ? JSON.parse(s) : [],
                questions: q ? JSON.parse(q) : {}
            };
            return openDB().then(function(db) {
                return set(db, KEY, data).then(function() {
                    try {
                        localStorage.removeItem('xingce_admin_sets');
                        localStorage.removeItem('xingce_admin_questions');
                    } catch (e) {}
                    db.close();
                });
            });
        } catch (e) {
            return Promise.resolve();
        }
    }

    /** 读取管理员题库数据 */
    function getAdminData() {
        return openDB().then(function(db) {
            return get(db, KEY).then(function(data) {
                db.close();
                if (data && typeof data === 'object') {
                    return { sets: data.sets || [], questions: data.questions || {} };
                }
                return { sets: [], questions: {} };
            });
        }).catch(function() {
            return { sets: [], questions: {} };
        });
    }

    /** 写入管理员题库数据 */
    function setAdminData(data) {
        var payload = {
            sets: data && data.sets ? data.sets : [],
            questions: data && data.questions ? data.questions : {}
        };
        return openDB().then(function(db) {
            return set(db, KEY, payload).then(function() {
                db.close();
            });
        });
    }

    /** 清空管理员题库（IndexedDB + 旧 localStorage 键） */
    function clearAdminStore() {
        return openDB().then(function(db) {
            return clearStore(db).then(function() {
                db.close();
                try {
                    localStorage.removeItem('xingce_admin_sets');
                    localStorage.removeItem('xingce_admin_questions');
                } catch (e) {}
            });
        });
    }

    /** 首次加载：先迁移再读取 */
    function loadAdminStore() {
        return migrateFromLocalStorage().then(function() {
            return getAdminData();
        });
    }

    global.XingceAdminIDB = {
        load: loadAdminStore,
        get: getAdminData,
        set: setAdminData,
        clear: clearAdminStore
    };
})(typeof window !== 'undefined' ? window : this);
