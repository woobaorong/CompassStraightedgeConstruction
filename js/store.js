/**
 * 数据仓库 — 统一曲线数据 (世界坐标) + 填充区域 + 历史记录 (撤销)
 *
 * 曲线模型见 geometry.js 头注释；attach = { curveId, t } 表示端点/圆心附着在某曲线上
 */
const Store = (() => {

    let curves = [];    // 统一曲线数组
    let fills = [];     // 填充区域 (P7 引入)
    let nextId = 1;
    let history = [];   // 快照栈 { curves, fills }

    function snapshot() {
        return JSON.parse(JSON.stringify({ curves: curves, fills: fills }));
    }

    function saveHistory() {
        history.push(snapshot());
        if (history.length > Config.MAX_HISTORY) history.shift();
    }

    // 撤销：恢复到上一次快照，无历史时返回 false
    function undo() {
        if (history.length === 0) return false;
        const s = history.pop();
        curves = s.curves;
        fills = s.fills || [];
        return true;
    }

    function addCurve(data) {
        const c = Object.assign({ id: nextId++ }, data);
        curves.push(c);
        return c;
    }

    // 线型曲线 (segment/ray/line)；attach0/attach1 为两端附着约束
    function makeLineCurve(p0, p1, kind, attach0, attach1) {
        return addCurve(Object.assign(Geometry.makeLineCurveData(p0, p1, kind), {
            attach0: attach0 || null,
            attach1: attach1 || null
        }));
    }

    // 圆型曲线 (完整圆)；centerAttach 为圆心附着约束
    function makeCircleCurve(cx, cy, r, centerAttach) {
        return addCurve({
            type: 'circle', cx: cx, cy: cy, r: r,
            a0: 0, a1: Math.PI * 2,
            centerAttach: centerAttach || null
        });
    }

    // 删除曲线并级联清理：引用它的 attach 置空 (填充由 refillFills 统一重提取)
    function removeCurve(id) {
        curves = curves.filter(c => c.id !== id);
        curves.forEach(c => {
            ['attach0', 'attach1'].forEach(k => {
                if (c[k] && c[k].curveId === id) c[k] = null;
            });
            if (c.type === 'circle' && c.centerAttach && c.centerAttach.curveId === id) {
                c.centerAttach = null;
            }
        });
    }

    const EPS_T = 1e-7;

    // 线型碎片生成：把原曲线的 [from,to] 区间规范化为射线/线段碎片
    function spawnLinePiece(c, from, to) {
        const EXT = Config.LINE_EXTENT;
        const infMin = c.tMin <= -EXT / 2;   // 原曲线负向无限 (直线)
        const infMax = c.tMax >= EXT / 2;    // 原曲线正向无限 (射线/直线)
        const touchesMin = Math.abs(from - c.tMin) < EPS_T;
        const touchesMax = Math.abs(to - c.tMax) < EPS_T;

        if (infMin && touchesMin) {
            // 负向无限碎片 → 规范化为起点在 to、方向取反的射线
            const p = Geometry.curvePointAt(c, to);
            addCurve({
                type: 'line', kind: 'ray',
                p0: { x: p.x, y: p.y },
                dir: { x: -c.dir.x, y: -c.dir.y },
                tMin: 0, tMax: to - c.tMin,
                attach0: touchesMax ? c.attach1 : null,
                attach1: null
            });
            return;
        }
        if (infMax && touchesMax) {
            // 正向无限碎片 → 规范化为起点在 from 的射线
            const p = Geometry.curvePointAt(c, from);
            addCurve({
                type: 'line', kind: 'ray',
                p0: { x: p.x, y: p.y },
                dir: { x: c.dir.x, y: c.dir.y },
                tMin: 0, tMax: c.tMax - from,
                attach0: touchesMin ? c.attach0 : null,
                attach1: null
            });
            return;
        }
        // 有界碎片 → 线段
        addCurve({
            type: 'line', kind: 'piece',
            p0: { x: c.p0.x, y: c.p0.y },
            dir: { x: c.dir.x, y: c.dir.y },
            tMin: from, tMax: to,
            attach0: touchesMin ? c.attach0 : null,
            attach1: touchesMax ? c.attach1 : null
        });
    }

    // 圆弧碎片生成
    function spawnArcPiece(c, from, to) {
        addCurve({
            type: 'circle', cx: c.cx, cy: c.cy, r: c.r,
            a0: from, a1: to, centerAttach: null
        });
    }

    // 按擦除参数区间切碎曲线 (橡皮擦核心)
    // eraseRanges: [{ from, to }]；minPieceWorld: 碎屑判定的最小世界长度
    // 全擦除 / 全成碎屑 → 删除原曲线；无有效擦除 → 保持不变
    function splitCurve(curveId, eraseRanges, minPieceWorld) {
        const c = curveById(curveId);
        if (!c) return;

        const dom = c.type === 'line'
            ? { from: c.tMin, to: c.tMax }
            : { from: c.a0, to: c.a1 };
        const keeps = Geometry.subtractIntervals(dom, eraseRanges);
        if (keeps.length === 0) { removeCurve(curveId); return; }   // 全擦除

        let whole = false, created = 0;
        keeps.forEach(k => {
            const isWhole = (k.from - dom.from) < EPS_T && (dom.to - k.to) < EPS_T;
            if (isWhole) { whole = true; return; }
            const len = c.type === 'line' ? (k.to - k.from) : (k.to - k.from) * c.r;
            if (len < minPieceWorld) return;   // 碎屑丢弃
            created++;
            if (c.type === 'line') spawnLinePiece(c, k.from, k.to);
            else spawnArcPiece(c, k.from, k.to);
        });

        if (whole && created === 0) return;          // 没擦到有效区间
        if (!whole && created === 0) { removeCurve(curveId); return; }   // 全成碎屑
        removeCurve(curveId);                        // 碎片替换原曲线
    }

    function curveById(id) {
        return curves.find(c => c.id === id) || null;
    }

    // ---------- 填充区域 (P7 油漆桶) ----------
    // fill = { id, color, seed:{x,y}, poly:[{x,y}...] }  poly 为最近一次提取的封闭面

    function addFill(data) {
        const f = Object.assign({ id: nextId++ }, data);
        fills.push(f);
        return f;
    }

    // 分裂见证点：新曲线把填充区域一分为二时，沿新曲线在「失去种子的那一部分」
    // 里找候选种子点 —— 取落在旧区域内的相邻样本对，用中点 (必要时向两侧偏移)
    function splitWitnesses(newCurves, oldPoly, seedPoly) {
        const out = [];
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        oldPoly.forEach(p => {
            x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
            x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
        });
        const STEP = 4;   // 采样步长 (世界单位)
        newCurves.forEach(c => {
            const samples = [];
            if (c.type === 'line') {
                const clip = Geometry.clipLineToView(c, { x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 });
                if (!clip) return;
                const len = clip.tB - clip.tA;
                const n = Math.max(1, Math.min(2000, Math.ceil(len / STEP)));
                for (let k = 0; k <= n; k++) {
                    samples.push({
                        p: Geometry.curvePointAt(c, clip.tA + len * k / n),
                        d: c.dir
                    });
                }
            } else {
                const span = c.a1 - c.a0;
                const n = Math.max(2, Math.min(2000, Math.ceil(span * c.r / STEP)));
                for (let k = 0; k <= n; k++) {
                    const a = c.a0 + span * k / n;
                    samples.push({ p: Geometry.curvePointAt(c, a), d: { x: -Math.sin(a), y: Math.cos(a) } });
                }
            }
            for (let k = 0; k + 1 < samples.length; k++) {
                const s1 = samples[k].p, s2 = samples[k + 1].p;
                if (!Geometry.pointInPoly(s1.x, s1.y, oldPoly)) continue;
                if (!Geometry.pointInPoly(s2.x, s2.y, oldPoly)) continue;
                const mx = (s1.x + s2.x) / 2, my = (s1.y + s2.y) / 2;
                if (Geometry.pointInPoly(mx, my, oldPoly) && !Geometry.pointInPoly(mx, my, seedPoly)) {
                    out.push({ x: mx, y: my });
                    continue;
                }
                // 中点可能恰在分割线上 → 沿法线向两侧偏移再试
                const dl = Math.hypot(s2.x - s1.x, s2.y - s1.y) || 1;
                const nx = -(s2.y - s1.y) / dl, ny = (s2.x - s1.x) / dl;
                [1.5, -1.5].forEach(off => {
                    const q = { x: mx + nx * off, y: my + ny * off };
                    if (Geometry.pointInPoly(q.x, q.y, oldPoly) && !Geometry.pointInPoly(q.x, q.y, seedPoly)) {
                        out.push(q);
                    }
                });
            }
        });
        return out;
    }

    // 几何变化后统一维护填充：
    //  1) 每个填充按种子点重新提取封闭面 —— 提取失败 (包围线被擦开) → 删除该填充
    //  2) 新增曲线使区域面积缩小 (被分割) → 为失去种子的部分补建同色填充
    function refillFills(extractFn, newCurves) {
        if (!fills.length) return;
        const curves = getCurves();
        const dead = [];
        const born = [];
        fills.forEach(f => {
            const oldPoly = f.poly || null;
            const face = extractFn(curves, f.seed.x, f.seed.y);
            if (!face) { dead.push(f); return; }
            if (oldPoly && newCurves && newCurves.length &&
                Math.abs(Geometry.polyArea(oldPoly)) > Math.abs(face.area) + 1e-6) {
                splitWitnesses(newCurves, oldPoly, face.poly).forEach(q => {
                    if (Geometry.pointInPoly(q.x, q.y, face.poly)) return;      // 种子面已覆盖
                    if (born.some(b => Geometry.pointInPoly(q.x, q.y, b.poly))) return;   // 已补建
                    const f2 = extractFn(curves, q.x, q.y);
                    if (f2) born.push({ color: f.color, seed: { x: q.x, y: q.y }, poly: f2.poly });
                });
            }
            f.poly = face.poly;
        });
        fills = fills.filter(f => dead.indexOf(f) < 0);
        born.forEach(b => addFill(b));
    }

    function clear() {
        curves = [];
        fills = [];
    }

    function isEmpty() {
        return curves.length === 0 && fills.length === 0;
    }

    // 返回内部数组引用（渲染/吸附高频访问，避免拷贝；外部只读，勿直接修改）
    function getCurves() { return curves; }
    function getFills() { return fills; }

    return Object.freeze({
        saveHistory, undo,
        addCurve, makeLineCurve, makeCircleCurve, removeCurve, curveById, splitCurve,
        addFill, refillFills,
        clear, isEmpty, getCurves, getFills
    });
})();
