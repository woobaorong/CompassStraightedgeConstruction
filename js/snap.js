/**
 * 吸附系统 — 收集候选点 (交点/端点/圆心/圆周/线上) 并按优先级选出最佳吸附点
 */
const Snap = (() => {

    let circleSnapEnabled = true;   // 圆周吸附开关 (由 UI 控制)
    let axisSnapEnabled = true;     // 横平竖直吸附开关 (由 UI 控制)
    let gridSnapEnabled = true;     // 网格吸附开关 (由 UI 控制)

    function setCircleSnapEnabled(enabled) { circleSnapEnabled = enabled; }
    function setAxisSnapEnabled(enabled) { axisSnapEnabled = enabled; }
    function setGridSnapEnabled(enabled) { gridSnapEnabled = enabled; }

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

    // 找出最佳吸附点。
    // 核心思路：axis 与 grid 链式组合 —— axis 把鼠标拉到轴线，grid 再把轴投影点吸到最近网格点。
    //   这样两者"同时起效"：鼠标方向接近水平/垂直时，自动吸附到「轴线上的最近网格点」。
    // drawCtx: { startPoint } 绘制中传入起点以启用水平/垂直吸附
    function find(wx, wy, drawCtx) {
        const mScreen = View.worldToScreen(wx, wy);
        const startPoint = drawCtx && drawCtx.startPoint;

        // ---------- 第一步：axis 投影 (可选) ----------
        let baseX = wx, baseY = wy;
        let axisActive = null;
        if (axisSnapEnabled && startPoint) {
            const dx = wx - startPoint.x, dy = wy - startPoint.y;
            if (Math.hypot(dx, dy) >= 1e-9) {
                const a = Math.atan2(dy, dx);
                const k = Math.round(a / (Math.PI / 2));
                const diff = Math.abs(a - k * Math.PI / 2);
                if (diff <= Config.AXIS_SNAP_TOLERANCE) {
                    const horizontal = (k % 2 === 0);
                    const px = horizontal ? wx : startPoint.x;
                    const py = horizontal ? startPoint.y : wy;
                    const pScreen = View.worldToScreen(px, py);
                    const ms = View.worldToScreen(wx, wy);
                    if (Math.hypot(pScreen.x - ms.x, pScreen.y - ms.y) <= Config.SNAP_DIST_SCREEN * 1.5) {
                        baseX = px; baseY = py;
                        axisActive = { x: px, y: py, horizontal: horizontal };
                    }
                }
            }
        }

        // ---------- 第二步：在 base 点上叠加 grid 吸附 ----------
        let gridActive = false;
        const spacing = (function() {
            let s = Config.GRID_BASE_SPACING;
            const sc = View.getState().scale;
            while (s * sc < 20) s *= 5;
            while (s * sc > 200) s /= 5;
            return s;
        })();
        if (gridSnapEnabled) {
            const gx = Math.round(baseX / spacing) * spacing;
            const gy = Math.round(baseY / spacing) * spacing;
            const dWorld = Math.hypot(gx - baseX, gy - baseY);
            const scale = View.getState().scale;
            // grid 距离阈值按场景区分：
            //   链式 (axis 已触发) 10px —— axis 已把鼠标收窄到轴线上，再吸网格点更稳
            //   纯 grid 6px —— 避免"全域都吸附"的过敏感 (约为网格间距的 12%)
            const gridThresh = axisActive ? 10 : 6;
            if (dWorld * scale <= gridThresh) {
                baseX = gx; baseY = gy;
                gridActive = true;
            }
        }

        // ---------- 第三步：组合返回 ----------
        if (axisActive && gridActive) {
            return {
                x: baseX, y: baseY, type: 'axis_grid',
                label: (axisActive.horizontal ? '水平' : '垂直') + ' (网格)',
                priority: Config.PRIORITY.axis
            };
        }
        if (axisActive) {
            return {
                x: axisActive.x, y: axisActive.y,
                type: 'axis',
                label: axisActive.horizontal ? '水平' : '垂直',
                priority: Config.PRIORITY.axis
            };
        }
        if (gridActive) {
            return { x: baseX, y: baseY, type: 'grid', label: '网格', priority: 50 };
        }

        // ---------- 第四步：普通候选评分 ----------
        const candidates = collectAllCandidates(wx, wy);
        let best = null, bestScore = Infinity;
        candidates.forEach(p => {
            const pScreen = View.worldToScreen(p.x, p.y);
            const dScreen = Math.hypot(pScreen.x - mScreen.x, pScreen.y - mScreen.y);
            if (dScreen > Config.SNAP_DIST_SCREEN) return;
            const score = dScreen - p.priority * 0.15;
            if (score < bestScore) { bestScore = score; best = p; }
        });
        return best;
    }

    return Object.freeze({ setCircleSnapEnabled, setAxisSnapEnabled, setGridSnapEnabled, find, collectAllCandidates });
})();
