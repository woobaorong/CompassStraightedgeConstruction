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

    // 删除曲线并级联清理：引用它的 attach 置空、相关 fill 丢弃
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
        fills = fills.filter(f => !f.boundary.some(b => b.curveId === id));
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
        clear, isEmpty, getCurves, getFills
    });
})();
