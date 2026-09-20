/**
 * 渲染模块 — 负责把曲线数据与交互状态绘制到画布
 *
 * 坐标约定：所有几何数据使用世界坐标，绘制前经 View 转为屏幕坐标
 * 绘制层次：网格 → 填充 → 曲线 → 交点标记 → 预览 → 吸附高亮 → 起点标记
 */
const Renderer = (() => {

    let ctx = null;       // 2D 绘图上下文
    let canvasEl = null;  // 画布元素引用
    let W = 0;            // 画布宽 (CSS 像素，坐标计算均基于此)
    let H = 0;            // 画布高 (CSS 像素)
    let currentState = null;  // 最近一次 render 传入的状态，供各 draw* 子函数读取

    function init(canvas) {
        canvasEl = canvas;
        ctx = canvas.getContext('2d');
    }

    // 设置画布尺寸 (CSS 像素)，backing store 按 dpr 放大保证 HiDPI 清晰
    function setSize(cssW, cssH, dpr) {
        W = Math.max(1, Math.round(cssW));
        H = Math.max(1, Math.round(cssH));
        if (!canvasEl || !ctx) return;
        canvasEl.width = Math.round(W * dpr);
        canvasEl.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /**
     * 主渲染入口
     * @param {Object} state 应用状态
     *   { phase, startPoint, previewCurve, snappedPoint, snappedType,
     *     mouseWorld, currentTool, ... } (后续阶段扩展选中/橡皮等字段)
     */
    function render(state) {
        currentState = state;
        const theme = Config.THEME[state.theme || 'default'];
        ctx.fillStyle = theme.background;
        ctx.fillRect(0, 0, W, H);

        drawGrid();
        drawFills();
        drawCurves();
        drawErase(state);
        drawIntersectionMarkers();
        drawVertexLabels(state);
        drawPreview(state);
        drawSnapHighlight(state);
        drawVertexHover(state);
        drawStartMarker(state);
    }

    // 世界坐标下的当前视口矩形
    function worldViewport() {
        const v = View.getState();
        return {
            x0: v.offsetX,
            y0: v.offsetY,
            x1: v.offsetX + W / v.scale,
            y1: v.offsetY + H / v.scale
        };
    }

    // ---------- 动态网格 ----------
    function drawGrid() {
        const view = View.getState();
        const theme = Config.THEME[(currentState && currentState.theme) || 'default'];
        ctx.save();

        // 决定网格间距 (根据缩放自动调整)
        let spacing = Config.GRID_BASE_SPACING;
        // 让屏幕上的间距保持在合理范围 (20~200 px)
        while (spacing * view.scale < 20) spacing *= 5;
        while (spacing * view.scale > 200) spacing /= 5;

        // 视口在世界坐标中的范围
        const worldLeft = view.offsetX;
        const worldTop = view.offsetY;
        const worldRight = view.offsetX + W / view.scale;
        const worldBottom = view.offsetY + H / view.scale;

        // 起始网格线坐标
        const startX = Math.floor(worldLeft / spacing) * spacing;
        const startY = Math.floor(worldTop / spacing) * spacing;

        // 垂直线
        for (let wx = startX; wx <= worldRight; wx += spacing) {
            const sp = View.worldToScreen(wx, 0);
            ctx.beginPath();
            ctx.moveTo(sp.x, 0);
            ctx.lineTo(sp.x, H);
            ctx.strokeStyle = theme.grid;
            ctx.lineWidth = 0.8;
            ctx.stroke();
        }
        // 水平线
        for (let wy = startY; wy <= worldBottom; wy += spacing) {
            const sp = View.worldToScreen(0, wy);
            ctx.beginPath();
            ctx.moveTo(0, sp.y);
            ctx.lineTo(W, sp.y);
            ctx.strokeStyle = theme.grid;
            ctx.lineWidth = 0.8;
            ctx.stroke();
        }

        // 世界坐标轴 (x=0, y=0)
        const originScreen = View.worldToScreen(0, 0);
        ctx.beginPath();
        ctx.moveTo(originScreen.x, 0);
        ctx.lineTo(originScreen.x, H);
        ctx.strokeStyle = theme.axis;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, originScreen.y);
        ctx.lineTo(W, originScreen.y);
        ctx.strokeStyle = theme.axis;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.restore();
    }

    // ---------- 单条曲线绘制核心 ----------
    function drawCurve(c, strokeStyle, lineWidth, theme) {
        const view = View.getState();
        ctx.save();
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        if (c.lineStyle === 'dashed') ctx.setLineDash([6, 5]);
        else ctx.setLineDash([]);

        if (c.type === 'line') {
            // 裁剪到视口 (对线段也无害，可裁掉屏外部分)
            const clip = Geometry.clipLineToView(c, worldViewport());
            if (!clip) { ctx.restore(); return; }
            const a = Geometry.curvePointAt(c, clip.tA);
            const b = Geometry.curvePointAt(c, clip.tB);
            const sa = View.worldToScreen(a.x, a.y);
            const sb = View.worldToScreen(b.x, b.y);
            ctx.beginPath();
            ctx.moveTo(sa.x, sa.y);
            ctx.lineTo(sb.x, sb.y);
            ctx.stroke();

            // 真实端点圆点 (屏幕尺寸固定)
            ctx.fillStyle = theme.lineEndpoint;
            Geometry.curveEndpoints(c).forEach(e => {
                const sp = View.worldToScreen(e.x, e.y);
                ctx.beginPath();
                ctx.arc(sp.x, sp.y, 3.5, 0, 2 * Math.PI);
                ctx.fill();
            });
        } else {
            const cScreen = View.worldToScreen(c.cx, c.cy);
            const rScreen = c.r * view.scale;
            if (rScreen >= 0.5) {
                ctx.beginPath();
                ctx.arc(cScreen.x, cScreen.y, rScreen, c.a0, c.a1);
                ctx.stroke();
            }

            // 圆心
            ctx.fillStyle = theme.circle;
            ctx.beginPath();
            ctx.arc(cScreen.x, cScreen.y, 4, 0, 2 * Math.PI);
            ctx.fill();

            // 半径虚线 (仅完整圆)
            if (Geometry.isFullCircle(c)) {
                ctx.beginPath();
                ctx.moveTo(cScreen.x, cScreen.y);
                ctx.lineTo(cScreen.x + rScreen, cScreen.y);
                ctx.strokeStyle = theme.circleRadiusLine;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    // ---------- 所有曲线 ----------
    function drawCurves() {
        const theme = Config.THEME[(currentState && currentState.theme) || 'default'];
        Store.getCurves().forEach(c => {
            const color = c.type === 'line' ? theme.line : theme.circle;
            drawCurve(c, color, 2, theme);
        });
    }

    // ---------- 填充层 (网格之上、曲线之下) ----------
    // fill.poly 为世界坐标采样多边形 (几何变化后由 Store.refillFills 重新提取)
    function drawFills() {
        const fills = Store.getFills();
        if (!fills.length) return;
        ctx.save();
        fills.forEach(f => {
            const poly = f.poly;
            if (!poly || poly.length < 3) return;
            ctx.beginPath();
            poly.forEach((p, i) => {
                const sp = View.worldToScreen(p.x, p.y);
                if (i === 0) ctx.moveTo(sp.x, sp.y);
                else ctx.lineTo(sp.x, sp.y);
            });
            ctx.closePath();
            ctx.fillStyle = f.color;
            ctx.fill();
        });
        ctx.restore();
    }

    // ---------- 橡皮擦: 区间高亮 + 光圈 ----------
    // 画出曲线参数子区间的加粗高亮折线
    function drawCurveRange(c, from, to, style, width) {
        const view = View.getState();
        const span = to - from;
        if (span <= 0) return;
        const screenLen = c.type === 'line'
            ? span * view.scale
            : span * c.r * view.scale;
        const n = Math.max(2, Math.min(200, Math.ceil(screenLen / 6)));
        ctx.save();
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const p = Geometry.curvePointAt(c, from + span * i / n);
            const sp = View.worldToScreen(p.x, p.y);
            if (i === 0) ctx.moveTo(sp.x, sp.y);
            else ctx.lineTo(sp.x, sp.y);
        }
        ctx.stroke();
        ctx.restore();
    }

    // state.eraserView = { hits: [{ curveId, ranges }], hover: { curveId, ranges }, cursor: {x,y}|null }
    function drawErase(state) {
        const ev = state.eraserView;
        if (!ev) return;

        (ev.hits || []).forEach(h => {
            const c = Store.curveById(h.curveId);
            if (!c) return;
            h.ranges.forEach(r => drawCurveRange(c, r.from, r.to, Config.COLORS.eraserHighlight, 8));
        });
        if (ev.hover) {
            const c = Store.curveById(ev.hover.curveId);
            if (c) ev.hover.ranges.forEach(r => drawCurveRange(c, r.from, r.to, Config.COLORS.eraserHighlight, 6));
        }
        if (ev.cursor) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(ev.cursor.x, ev.cursor.y, Config.ERASER_RADIUS_SCREEN, 0, 2 * Math.PI);
            ctx.strokeStyle = Config.COLORS.eraserRing;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }
    }

    // ---------- 交点标记 (任意两类曲线之间) ----------
    function drawIntersectionMarkers() {
        const curves = Store.getCurves();
        const theme = Config.THEME[(currentState && currentState.theme) || 'default'];
        ctx.save();
        ctx.fillStyle = theme.intersection;
        for (let i = 0; i < curves.length; i++) {
            for (let j = i + 1; j < curves.length; j++) {
                Geometry.curveIntersection(curves[i], curves[j]).forEach(p => {
                    const sp = View.worldToScreen(p.x, p.y);
                    ctx.beginPath();
                    ctx.arc(sp.x, sp.y, 3, 0, 2 * Math.PI);
                    ctx.fill();
                });
            }
        }
        ctx.restore();
    }

    // ---------- 顶点命名标签 ----------
    // 收集所有"节点"(端点+交点+圆心)，按 EPS_NODE 去重后绘制 Store 中已命名的标签
    function drawVertexLabels(state) {
        const labels = Store.getVertexLabels();
        if (!labels || !Object.keys(labels).length) return;
        const theme = Config.THEME[(currentState && currentState.theme) || 'default'];
        const curves = Store.getCurves();
        const EPS = 1e-6;
        const seen = [];   // { x, y, key }
        const keyOf = (x, y) => Math.round(x / EPS) + ',' + Math.round(y / EPS);
        const pushIfNew = (x, y) => {
            const k = keyOf(x, y);
            if (seen.some(s => s.key === k)) return;
            seen.push({ x: x, y: y, key: k });
        };
        curves.forEach(c => {
            if (c.type === 'line') {
                pushIfNew(c.p0.x + c.dir.x * c.tMin, c.p0.y + c.dir.y * c.tMin);
                pushIfNew(c.p0.x + c.dir.x * c.tMax, c.p0.y + c.dir.y * c.tMax);
            } else {
                pushIfNew(c.cx, c.cy);
            }
        });
        for (let i = 0; i < curves.length; i++) {
            for (let j = i + 1; j < curves.length; j++) {
                Geometry.curveIntersection(curves[i], curves[j]).forEach(p => pushIfNew(p.x, p.y));
            }
        }
        ctx.save();
        ctx.font = '600 12px system-ui, "Segoe UI", sans-serif';
        ctx.textBaseline = 'middle';
        seen.forEach(n => {
            const mapKey = keyOf(n.x, n.y);
            const name = labels[mapKey];
            if (!name) return;
            const sp = View.worldToScreen(n.x, n.y);
            const w = ctx.measureText(name).width;
            ctx.fillStyle = theme.vertexLabelBg;
            const padX = 5, h = 18;
            const rx = sp.x + 8, ry = sp.y - h / 2, rw = w + padX * 2;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(rx, ry, rw, h, 4);
            else ctx.rect(rx, ry, rw, h);
            ctx.fill();
            ctx.fillStyle = theme.vertexLabel;
            ctx.fillText(name, rx + padX, sp.y);
        });
        ctx.restore();
    }

    // ---------- 进行中的预览图形 ----------
    function drawPreview(state) {
        if (state.phase !== 'started' || !state.startPoint || !state.previewCurve) return;

        ctx.save();
        const pc = state.previewCurve;

        if (pc.type === 'circle') {
            const startScreen = View.worldToScreen(state.startPoint.x, state.startPoint.y);
            const targetWorld = state.snappedPoint ? state.snappedPoint : state.mouseWorld;
            const targetScreen = View.worldToScreen(targetWorld.x, targetWorld.y);
            const view = View.getState();
            const pcScreen = View.worldToScreen(pc.cx, pc.cy);
            const prScreen = pc.r * view.scale;

            ctx.strokeStyle = Config.COLORS.preview;
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 6]);
            ctx.beginPath();
            ctx.arc(pcScreen.x, pcScreen.y, prScreen, 0, 2 * Math.PI);
            ctx.stroke();

            // 圆心到鼠标的辅助线
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = Config.COLORS.previewLine;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(startScreen.x, startScreen.y);
            ctx.lineTo(targetScreen.x, targetScreen.y);
            ctx.stroke();

            ctx.setLineDash([]);
            ctx.fillStyle = Config.COLORS.preview;
            ctx.beginPath();
            ctx.arc(startScreen.x, startScreen.y, 4, 0, 2 * Math.PI);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(targetScreen.x, targetScreen.y, 3, 0, 2 * Math.PI);
            ctx.fill();
        } else {
            // 线型预览: 复用曲线绘制 (含视口裁剪)，虚线样式
            const clip = Geometry.clipLineToView(pc, worldViewport());
            if (clip) {
                const a = Geometry.curvePointAt(pc, clip.tA);
                const b = Geometry.curvePointAt(pc, clip.tB);
                const sa = View.worldToScreen(a.x, a.y);
                const sb = View.worldToScreen(b.x, b.y);
                ctx.strokeStyle = Config.COLORS.preview;
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 6]);
                ctx.beginPath();
                ctx.moveTo(sa.x, sa.y);
                ctx.lineTo(sb.x, sb.y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            // 预览端点 (仅真实端点)
            ctx.fillStyle = Config.COLORS.preview;
            Geometry.curveEndpoints(pc).forEach(e => {
                const sp = View.worldToScreen(e.x, e.y);
                ctx.beginPath();
                ctx.arc(sp.x, sp.y, 4, 0, 2 * Math.PI);
                ctx.fill();
            });
        }
        ctx.restore();
    }

    // ---------- 吸附点高亮 ----------
    function drawSnapHighlight(state) {
        if (!state.snappedPoint) return;

        const sp = View.worldToScreen(state.snappedPoint.x, state.snappedPoint.y);
        const scheme = Config.COLORS.snap[state.snappedType] || Config.COLORS.snap.default;

        ctx.save();
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 12, 0, 2 * Math.PI);
        ctx.fillStyle = scheme.fill;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 8, 0, 2 * Math.PI);
        ctx.strokeStyle = scheme.color;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = scheme.color;
        ctx.fill();
        ctx.restore();
    }

    // ---------- 顶点工具 hover 高亮 ----------
    function drawVertexHover(state) {
        if (!state || state.currentTool !== 'vertex' || !state.vertexHover) return;
        const sp = View.worldToScreen(state.vertexHover.x, state.vertexHover.y);
        const theme = Config.THEME[(currentState && currentState.theme) || 'default'];
        ctx.save();
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 11, 0, 2 * Math.PI);
        ctx.strokeStyle = theme.lineEndpoint;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    // ---------- 绘制起点标记 ----------
    function drawStartMarker(state) {
        if (state.phase !== 'started' || !state.startPoint) return;

        const sp = View.worldToScreen(state.startPoint.x, state.startPoint.y);
        ctx.save();
        ctx.fillStyle = Config.COLORS.startPoint;
        ctx.shadowColor = Config.COLORS.startPoint;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
    }

    return Object.freeze({ init, setSize, render });
})();
