/**
 * 吸附系统 — 收集候选点 (交点/端点/圆心/圆周/线上) 并按优先级选出最佳吸附点
 */
const Snap = (() => {

    let circleSnapEnabled = true;   // 圆周吸附开关 (由 UI 控制)
    let axisSnapEnabled = true;     // 横平竖直吸附开关 (由 UI 控制)

    function setCircleSnapEnabled(enabled) { circleSnapEnabled = enabled; }
    function setAxisSnapEnabled(enabled) { axisSnapEnabled = enabled; }

    // 收集所有吸附候选点 (世界坐标)
    function collectAllCandidates(wx, wy) {
        const candidates = [];
        const curves = Store.getCurves();

        // 交点 — 最高优先级 (任意两类曲线之间)
        for (let i = 0; i < curves.length; i++) {
            for (let j = i + 1; j < curves.length; j++) {
                const c1 = curves[i], c2 = curves[j];
                Geometry.curveIntersection(c1, c2).forEach(p => {
                    let label;
                    if (c1.type === 'line' && c2.type === 'line') label = '线线交点';
                    else if (c1.type === 'circle' && c2.type === 'circle') label = '圆圆交点';
                    else label = '线圆交点';
                    candidates.push({ x: p.x, y: p.y, type: 'intersection', label: label, priority: Config.PRIORITY.intersection });
                });
            }
        }

        // 端点 / 圆心
        curves.forEach(c => {
            if (c.type === 'line') {
                Geometry.curveEndpoints(c).forEach(e => {
                    candidates.push({ x: e.x, y: e.y, type: 'endpoint', label: '端点', priority: Config.PRIORITY.endpoint });
                });
            } else {
                candidates.push({ x: c.cx, y: c.cy, type: 'center', label: '圆心', priority: Config.PRIORITY.center });
            }
        });

        // 动态: 圆周 (弧域内截断)
        if (circleSnapEnabled) {
            curves.forEach(c => {
                if (c.type !== 'circle') return;
                const cp = Geometry.closestPointOnCurve(c, wx, wy);
                candidates.push({ x: cp.x, y: cp.y, type: 'circle', label: Geometry.isFullCircle(c) ? '圆周' : '弧上', priority: Config.PRIORITY.circle });
            });
        }

        // 动态: 线上
        curves.forEach(c => {
            if (c.type !== 'line') return;
            const cp = Geometry.closestPointOnCurve(c, wx, wy);
            candidates.push({ x: cp.x, y: cp.y, type: 'line', label: '线上', priority: Config.PRIORITY.line });
        });

        return candidates;
    }

    // 绘制中的水平/垂直轴候选: start→mouse 方向与坐标轴夹角 ≤ 0.5° 时投影到轴线
    // 返回 null 或 { x, y, type:'axis', label, priority }
    function axisCandidate(startPoint, wx, wy) {
        if (!axisSnapEnabled || !startPoint) return null;
        const dx = wx - startPoint.x, dy = wy - startPoint.y;
        if (Math.hypot(dx, dy) < 1e-9) return null;

        const a = Math.atan2(dy, dx);
        const k = Math.round(a / (Math.PI / 2));
        const diff = Math.abs(a - k * Math.PI / 2);
        if (diff > Config.AXIS_SNAP_TOLERANCE && diff < Math.PI / 2 - Config.AXIS_SNAP_TOLERANCE) return null;

        // 投影到过起点的水平/垂直轴线 (屏幕距离足够近才触发)
        const horizontal = (k % 2 === 0);
        const px = horizontal ? wx : startPoint.x;
        const py = horizontal ? startPoint.y : wy;

        const pScreen = View.worldToScreen(px, py);
        const mScreen = View.worldToScreen(wx, wy);
        if (Math.hypot(pScreen.x - mScreen.x, pScreen.y - mScreen.y) > Config.SNAP_DIST_SCREEN * 40) return null;

        return {
            x: px, y: py, type: 'axis',
            label: horizontal ? '水平' : '垂直',
            priority: Config.PRIORITY.axis
        };
    }

    // 找出最佳吸附点：屏幕距离阈值内，按「距离 - 优先级加分」评分
    // drawCtx: { startPoint } 绘制中传入起点以启用水平/垂直吸附
    function find(wx, wy, drawCtx) {
        const mScreen = View.worldToScreen(wx, wy);
        const candidates = collectAllCandidates(wx, wy);

        const axis = axisCandidate(drawCtx && drawCtx.startPoint, wx, wy);
        if (axis) candidates.push(axis);

        let best = null;
        let bestScore = Infinity;

        candidates.forEach(p => {
            const pScreen = View.worldToScreen(p.x, p.y);
            const dScreen = Math.hypot(pScreen.x - mScreen.x, pScreen.y - mScreen.y);
            if (dScreen > Config.SNAP_DIST_SCREEN && p.type !== 'axis') return;

            const priorityBonus = p.priority * 0.15;
            const score = dScreen - priorityBonus;

            if (score < bestScore) {
                bestScore = score;
                best = p;
            }
        });

        return best;
    }

    return Object.freeze({ setCircleSnapEnabled, setAxisSnapEnabled, find, collectAllCandidates });
})();
