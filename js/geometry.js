/**
 * 几何计算模块 — 纯函数集合，全部使用世界坐标
 */
const Geometry = (() => {

    // 线段与线段交点 (不在两线段范围内返回 null)
    function segSegIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
        const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
        if (Math.abs(d) < 1e-10) return null;
        const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
        const u = -((x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1)) / d;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
            return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
        }
        return null;
    }

    // 线段与圆交点 (返回 0~2 个点)
    function segCircleIntersection(x1, y1, x2, y2, cx, cy, r) {
        const dx = x2 - x1, dy = y2 - y1;
        const fx = x1 - cx, fy = y1 - cy;
        const a = dx * dx + dy * dy;
        const b = 2 * (fx * dx + fy * dy);
        const c = fx * fx + fy * fy - r * r;
        const disc = b * b - 4 * a * c;
        if (disc < 0) return [];
        const sqrtDisc = Math.sqrt(disc);
        const t1 = (-b - sqrtDisc) / (2 * a);
        const t2 = (-b + sqrtDisc) / (2 * a);
        const results = [];
        if (t1 >= -1e-9 && t1 <= 1 + 1e-9) results.push({ x: x1 + t1 * dx, y: y1 + t1 * dy });
        if (t2 >= -1e-9 && t2 <= 1 + 1e-9) results.push({ x: x1 + t2 * dx, y: y1 + t2 * dy });
        return results;
    }

    // 圆与圆交点 (返回 0~2 个点，相切返回 1 个)
    function circleCircleIntersection(c1x, c1y, r1, c2x, c2y, r2) {
        const d = Math.hypot(c2x - c1x, c2y - c1y);
        if (d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9 || d < 1e-9) return [];
        const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
        const hSq = r1 * r1 - a * a;
        if (hSq < -1e-9) return [];
        const h = Math.sqrt(Math.max(0, hSq));
        const mx = c1x + a * (c2x - c1x) / d;
        const my = c1y + a * (c2y - c1y) / d;
        if (h < 1e-9) return [{ x: mx, y: my }];
        const rx = -(c2y - c1y) * h / d;
        const ry = (c2x - c1x) * h / d;
        return [
            { x: mx + rx, y: my + ry },
            { x: mx - rx, y: my - ry }
        ];
    }

    // 点到线段的最近点 (onSegment 表示垂足是否落在线段内)
    function closestPointOnSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return { x: x1, y: y1, t: 0, onSegment: false };
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        const clampedT = Math.max(0, Math.min(1, t));
        return {
            x: x1 + clampedT * dx,
            y: y1 + clampedT * dy,
            t: t,
            onSegment: t >= 0 && t <= 1
        };
    }

    // 点到圆周的最近点 (沿圆心与该点的连线方向)
    function closestPointOnCircle(px, py, cx, cy, r) {
        const dx = px - cx, dy = py - cy;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) return { x: cx + r, y: cy };
        return {
            x: cx + dx / dist * r,
            y: cy + dy / dist * r
        };
    }

    return Object.freeze({
        segSegIntersection,
        segCircleIntersection,
        circleCircleIntersection,
        closestPointOnSegment,
        closestPointOnCircle
    });
})();
