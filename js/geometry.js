/**
 * 几何计算模块 — 纯函数集合，全部使用世界坐标
 *
 * 统一曲线模型:
 *   线型: { type:'line', kind, p0:{x,y}, dir:{x,y}(单位向量), tMin, tMax }  t 为沿 dir 的有符号距离
 *   圆型: { type:'circle', cx, cy, r, a0, a1 }                              t 为角度(弧度)，a1-a0 ≤ 2π
 */
const Geometry = (() => {

    const TAU = Math.PI * 2;
    const EPS = 1e-9;

    // 取模到 [0, m)
    function mod(x, m) {
        return ((x % m) + m) % m;
    }

    // ---------- 曲线基本量 ----------

    // 是否为完整圆 (非弧)
    function isFullCircle(c) {
        return c.type === 'circle' && (c.a1 - c.a0) >= TAU - 1e-6;
    }

    // 参数 t 对应的坐标点
    function curvePointAt(c, t) {
        if (c.type === 'line') {
            return { x: c.p0.x + c.dir.x * t, y: c.p0.y + c.dir.y * t };
        }
        return { x: c.cx + Math.cos(t) * c.r, y: c.cy + Math.sin(t) * c.r };
    }

    // 点在曲线上的自然参数 (投影/角度，不保证落在定义域内)
    function curveParamOf(c, x, y) {
        if (c.type === 'line') {
            return (x - c.p0.x) * c.dir.x + (y - c.p0.y) * c.dir.y;
        }
        return Math.atan2(y - c.cy, x - c.cx);
    }

    // 圆型曲线: 把任意角等价映射到定义域 [a0, a1] 附近
    function normalizeCircleParam(c, a) {
        const span = c.a1 - c.a0;
        if (span >= TAU - EPS) {
            return c.a0 + mod(a - c.a0, TAU);   // 全圆: 归一化到 [a0, a0+2π)
        }
        const mid = (c.a0 + c.a1) / 2;
        return a + TAU * Math.round((mid - a) / TAU);   // 弧: 取离弧中点最近的等价角
    }

    // 参数是否在定义域内
    function inDomain(c, t, eps) {
        eps = eps || 1e-6;
        if (c.type === 'line') {
            return t >= c.tMin - eps && t <= c.tMax + eps;
        }
        return t >= c.a0 - eps && t <= c.a1 + eps;
    }

    // 点到曲线的最近点 (域外投影截断到端点)，返回 { x, y, t }
    function closestPointOnCurve(c, x, y) {
        if (c.type === 'line') {
            let t = curveParamOf(c, x, y);
            t = Math.max(c.tMin, Math.min(c.tMax, t));
            const p = curvePointAt(c, t);
            return { x: p.x, y: p.y, t: t };
        }
        const t = Math.max(c.a0, Math.min(c.a1, normalizeCircleParam(c, curveParamOf(c, x, y))));
        const p = curvePointAt(c, t);
        return { x: p.x, y: p.y, t: t };
    }

    // 曲线的真实端点 (供吸附/端点圆点使用；射线/直线只返回有限端)
    // 返回 [{ t, x, y }]
    function curveEndpoints(c) {
        const out = [];
        if (c.type === 'line') {
            const ends = [];
            if (c.kind === 'segment' || c.kind === 'piece') { ends.push(c.tMin, c.tMax); }
            else if (c.kind === 'ray') { ends.push(c.tMin); }
            ends.forEach(t => {
                const p = curvePointAt(c, t);
                out.push({ t: t, x: p.x, y: p.y });
            });
        }
        return out;
    }

    // ---------- 广义交点 ----------
    // 返回 [{ x, y, t1, t2 }]，t1/t2 与入参曲线顺序对应 (角度已归一化到定义域)

    // 直线(无限) 与 直线(无限) 交点参数
    function lineLineParams(l1, l2) {
        const den = l1.dir.x * l2.dir.y - l1.dir.y * l2.dir.x;
        if (Math.abs(den) < 1e-12) return null;   // 平行或重合
        const dx = l2.p0.x - l1.p0.x, dy = l2.p0.y - l1.p0.y;
        return {
            t1: (dx * l2.dir.y - dy * l2.dir.x) / den,
            t2: (dx * l1.dir.y - dy * l1.dir.x) / den
        };
    }

    // 直线(无限，dir 为单位向量) 与 圆 交点参数 (t 为线参数)
    function lineCircleParams(l, c) {
        const fx = l.p0.x - c.cx, fy = l.p0.y - c.cy;
        const b = 2 * (fx * l.dir.x + fy * l.dir.y);
        const cc = fx * fx + fy * fy - c.r * c.r;
        const disc = b * b - 4 * cc;
        if (disc < 0) return [];
        const sq = Math.sqrt(disc);
        return [(-b - sq) / 2, (-b + sq) / 2];
    }

    // 圆与圆交点坐标 (0~2 个；相切 1 个)
    function circleCirclePoints(c1, c2) {
        const d = Math.hypot(c2.cx - c1.cx, c2.cy - c1.cy);
        if (d > c1.r + c2.r + EPS || d < Math.abs(c1.r - c2.r) - EPS || d < EPS) return [];
        const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
        const hSq = c1.r * c1.r - a * a;
        if (hSq < -EPS) return [];
        const h = Math.sqrt(Math.max(0, hSq));
        const mx = c1.cx + a * (c2.cx - c1.cx) / d;
        const my = c1.cy + a * (c2.cy - c1.cy) / d;
        if (h < EPS) return [{ x: mx, y: my }];
        const rx = -(c2.cy - c1.cy) * h / d;
        const ry = (c2.cx - c1.cx) * h / d;
        return [
            { x: mx + rx, y: my + ry },
            { x: mx - rx, y: my - ry }
        ];
    }

    function curveIntersection(c1, c2) {
        const out = [];
        if (c1.type === 'line' && c2.type === 'line') {
            const r = lineLineParams(c1, c2);
            if (!r) return out;
            if (inDomain(c1, r.t1) && inDomain(c2, r.t2)) {
                const p = curvePointAt(c1, r.t1);
                out.push({ x: p.x, y: p.y, t1: r.t1, t2: r.t2 });
            }
        } else if (c1.type === 'circle' && c2.type === 'circle') {
            circleCirclePoints(c1, c2).forEach(p => {
                const t1 = normalizeCircleParam(c1, Math.atan2(p.y - c1.cy, p.x - c1.cx));
                const t2 = normalizeCircleParam(c2, Math.atan2(p.y - c2.cy, p.x - c2.cx));
                if (inDomain(c1, t1) && inDomain(c2, t2)) {
                    out.push({ x: p.x, y: p.y, t1: t1, t2: t2 });
                }
            });
        } else {
            const l = c1.type === 'line' ? c1 : c2;
            const ci = c1.type === 'circle' ? c1 : c2;
            lineCircleParams(l, ci).forEach(tl => {
                const p = curvePointAt(l, tl);
                const tc = normalizeCircleParam(ci, Math.atan2(p.y - ci.cy, p.x - ci.cx));
                if (inDomain(l, tl) && inDomain(ci, tc)) {
                    if (c1.type === 'line') out.push({ x: p.x, y: p.y, t1: tl, t2: tc });
                    else out.push({ x: p.x, y: p.y, t1: tc, t2: tl });
                }
            });
        }
        return out;
    }

    // ---------- 线型曲线构造 ----------
    // 返回曲线数据 (不含 id/attach)，dir 归一化；射线/直线用大有限数代替 Infinity (可 JSON 序列化)
    function makeLineCurveData(p0, p1, kind) {
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const L = Math.hypot(dx, dy) || 1e-12;
        const data = {
            type: 'line',
            kind: kind || 'segment',
            p0: { x: p0.x, y: p0.y },
            dir: { x: dx / L, y: dy / L }
        };
        if (data.kind === 'ray') { data.tMin = 0; data.tMax = Config.LINE_EXTENT; }
        else if (data.kind === 'line') { data.tMin = -Config.LINE_EXTENT; data.tMax = Config.LINE_EXTENT; }
        else { data.tMin = 0; data.tMax = L; }   // segment / piece
        return data;
    }

    // ---------- 视口裁剪 ----------
    // 把线型曲线裁剪到世界坐标视口矩形，返回可见参数区间 { tA, tB } 或 null (Liang-Barsky)
    function clipLineToView(l, rect) {
        let t0 = l.tMin, t1 = l.tMax;
        const constraints = [
            { p: -l.dir.x, q: l.p0.x - rect.x0 },
            { p: l.dir.x,  q: rect.x1 - l.p0.x },
            { p: -l.dir.y, q: l.p0.y - rect.y0 },
            { p: l.dir.y,  q: rect.y1 - l.p0.y }
        ];
        for (let i = 0; i < constraints.length; i++) {
            const cn = constraints[i];
            if (Math.abs(cn.p) < 1e-12) {
                if (cn.q < 0) return null;   // 平行于边界且在界外
                continue;
            }
            const r = cn.q / cn.p;
            if (cn.p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
            else          { if (r < t0) return null; if (r < t1) t1 = r; }
        }
        return t1 > t0 ? { tA: t0, tB: t1 } : null;
    }

    // ---------- 曲线采样 (弧多边形化，供填充) ----------
    // maxStepPx: 屏幕像素级最大步长；返回世界坐标点数组 (首尾均含)
    function sampleCurve(c, scale, maxStepPx) {
        const out = [];
        if (c.type === 'line') {
            out.push(curvePointAt(c, c.tMin), curvePointAt(c, c.tMax));
            return out;
        }
        const span = c.a1 - c.a0;
        const arcLenScreen = span * c.r * scale;
        const n = Math.max(8, Math.min(720, Math.ceil(arcLenScreen / Math.max(1, maxStepPx))));
        for (let i = 0; i <= n; i++) {
            out.push(curvePointAt(c, c.a0 + span * i / n));
        }
        return out;
    }

    // ---------- 参数区间运算 ----------
    // 从定义域 domain {from,to} 中减去 cuts [{from,to}] (可乱序/重叠)，返回剩余区间数组
    function subtractIntervals(domain, cuts) {
        const sorted = cuts
            .map(r => ({ from: Math.max(domain.from, r.from), to: Math.min(domain.to, r.to) }))
            .filter(r => r.to > r.from)
            .sort((a, b) => a.from - b.from);
        const out = [];
        let cur = domain.from;
        sorted.forEach(s => {
            if (s.from > cur) out.push({ from: cur, to: Math.min(s.from, domain.to) });
            cur = Math.max(cur, s.to);
        });
        if (cur < domain.to) out.push({ from: cur, to: domain.to });
        return out;
    }

    return Object.freeze({
        isFullCircle,
        curvePointAt,
        curveParamOf,
        normalizeCircleParam,
        inDomain,
        closestPointOnCurve,
        curveEndpoints,
        curveIntersection,
        makeLineCurveData,
        clipLineToView,
        sampleCurve,
        subtractIntervals
    });
})();
