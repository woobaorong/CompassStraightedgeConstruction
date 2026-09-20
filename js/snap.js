/**
 * 吸附系统 — 收集候选点 (交点/端点/圆心/圆周/线上) 并按优先级选出最佳吸附点
 */
const Snap = (() => {

    let circleSnapEnabled = true;   // 圆周吸附开关 (由 UI 控制)

    function setCircleSnapEnabled(enabled) { circleSnapEnabled = enabled; }

    // 收集所有吸附候选点 (世界坐标)
    function collectAllCandidates(wx, wy) {
        const candidates = [];
        const circles = Store.getCircles();
        const lines = Store.getLines();

        // 交点 — 最高优先级
        for (let i = 0; i < lines.length; i++) {
            for (let j = i + 1; j < lines.length; j++) {
                const l1 = lines[i], l2 = lines[j];
                const p = Geometry.segSegIntersection(l1.x1, l1.y1, l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2);
                if (p) candidates.push({ x: p.x, y: p.y, type: 'intersection', label: '线线交点', priority: Config.PRIORITY.intersection });
            }
        }
        lines.forEach(line => {
            circles.forEach(circle => {
                Geometry.segCircleIntersection(line.x1, line.y1, line.x2, line.y2, circle.x, circle.y, circle.r)
                    .forEach(p => candidates.push({ x: p.x, y: p.y, type: 'intersection', label: '线圆交点', priority: Config.PRIORITY.intersection }));
            });
        });
        for (let i = 0; i < circles.length; i++) {
            for (let j = i + 1; j < circles.length; j++) {
                const c1 = circles[i], c2 = circles[j];
                Geometry.circleCircleIntersection(c1.x, c1.y, c1.r, c2.x, c2.y, c2.r)
                    .forEach(p => candidates.push({ x: p.x, y: p.y, type: 'intersection', label: '圆圆交点', priority: Config.PRIORITY.intersection }));
            }
        }

        // 端点
        lines.forEach(line => {
            candidates.push({ x: line.x1, y: line.y1, type: 'endpoint', label: '端点', priority: Config.PRIORITY.endpoint });
            candidates.push({ x: line.x2, y: line.y2, type: 'endpoint', label: '端点', priority: Config.PRIORITY.endpoint });
        });

        // 圆心
        circles.forEach(circle => {
            candidates.push({ x: circle.x, y: circle.y, type: 'center', label: '圆心', priority: Config.PRIORITY.center });
        });

        // 动态: 圆周
        if (circleSnapEnabled) {
            circles.forEach(circle => {
                const cp = Geometry.closestPointOnCircle(wx, wy, circle.x, circle.y, circle.r);
                candidates.push({ x: cp.x, y: cp.y, type: 'circle', label: '圆周', priority: Config.PRIORITY.circle });
            });
        }

        // 动态: 线段
        lines.forEach(line => {
            const cp = Geometry.closestPointOnSegment(wx, wy, line.x1, line.y1, line.x2, line.y2);
            if (cp.onSegment) {
                candidates.push({ x: cp.x, y: cp.y, type: 'line', label: '线上', priority: Config.PRIORITY.line });
            }
        });

        return candidates;
    }

    // 找出最佳吸附点：屏幕距离阈值内，按「距离 - 优先级加分」评分
    function find(wx, wy) {
        const mScreen = View.worldToScreen(wx, wy);
        const candidates = collectAllCandidates(wx, wy);

        let best = null;
        let bestScore = Infinity;

        candidates.forEach(p => {
            const pScreen = View.worldToScreen(p.x, p.y);
            const dScreen = Math.hypot(pScreen.x - mScreen.x, pScreen.y - mScreen.y);
            if (dScreen > Config.SNAP_DIST_SCREEN) return;

            const priorityBonus = p.priority * 0.15;
            const score = dScreen - priorityBonus;

            if (score < bestScore) {
                bestScore = score;
                best = p;
            }
        });

        return best;
    }

    return Object.freeze({ setCircleSnapEnabled, find, collectAllCandidates });
})();
