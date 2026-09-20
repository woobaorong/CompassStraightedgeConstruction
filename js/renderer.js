/**
 * 渲染模块 — 负责把图形数据与交互状态绘制到画布
 *
 * 坐标约定：所有几何数据使用世界坐标，绘制前经 View 转为屏幕坐标
 */
const Renderer = (() => {

    let ctx = null;   // 2D 绘图上下文
    let W = 0;        // 画布宽 (px)
    let H = 0;        // 画布高 (px)

    function init(canvas) {
        ctx = canvas.getContext('2d');
        W = canvas.width;
        H = canvas.height;
    }

    /**
     * 主渲染入口
     * @param {Object} state 应用状态
     *   { phase, startPoint, previewCircle, previewLine,
     *     snappedPoint, snappedType, mouseWorld, currentTool }
     */
    function render(state) {
        ctx.clearRect(0, 0, W, H);

        drawGrid();
        drawLines(Store.getLines());
        drawCircles(Store.getCircles());
        drawIntersectionMarkers();
        drawPreview(state);
        drawSnapHighlight(state);
        drawStartMarker(state);
    }

    // ---------- 动态网格 ----------
    function drawGrid() {
        const view = View.getState();
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
            ctx.strokeStyle = Config.COLORS.grid;
            ctx.lineWidth = 0.8;
            ctx.stroke();
        }
        // 水平线
        for (let wy = startY; wy <= worldBottom; wy += spacing) {
            const sp = View.worldToScreen(0, wy);
            ctx.beginPath();
            ctx.moveTo(0, sp.y);
            ctx.lineTo(W, sp.y);
            ctx.strokeStyle = Config.COLORS.grid;
            ctx.lineWidth = 0.8;
            ctx.stroke();
        }

        // 世界坐标轴 (x=0, y=0)
        const originScreen = View.worldToScreen(0, 0);
        ctx.beginPath();
        ctx.moveTo(originScreen.x, 0);
        ctx.lineTo(originScreen.x, H);
        ctx.strokeStyle = Config.COLORS.axis;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, originScreen.y);
        ctx.lineTo(W, originScreen.y);
        ctx.stroke();

        ctx.restore();
    }

    // ---------- 线段与端点 ----------
    function drawLines(lines) {
        ctx.save();
        ctx.lineCap = 'round';
        lines.forEach(line => {
            const p1 = View.worldToScreen(line.x1, line.y1);
            const p2 = View.worldToScreen(line.x2, line.y2);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = Config.COLORS.line;
            ctx.lineWidth = 2;
            ctx.stroke();

            // 端点 (屏幕尺寸固定)
            ctx.fillStyle = Config.COLORS.lineEndpoint;
            ctx.beginPath();
            ctx.arc(p1.x, p1.y, 3.5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(p2.x, p2.y, 3.5, 0, 2 * Math.PI);
            ctx.fill();
        });
        ctx.restore();
    }

    // ---------- 圆 / 圆心 / 半径线 ----------
    function drawCircles(circles) {
        const view = View.getState();
        ctx.save();
        circles.forEach(circle => {
            const cScreen = View.worldToScreen(circle.x, circle.y);
            const rScreen = circle.r * view.scale;
            if (rScreen < 0.5) return; // 太小不画

            ctx.beginPath();
            ctx.arc(cScreen.x, cScreen.y, rScreen, 0, 2 * Math.PI);
            ctx.strokeStyle = Config.COLORS.circle;
            ctx.lineWidth = 2;
            ctx.stroke();

            // 圆心
            ctx.fillStyle = Config.COLORS.circle;
            ctx.beginPath();
            ctx.arc(cScreen.x, cScreen.y, 4, 0, 2 * Math.PI);
            ctx.fill();

            // 半径线
            ctx.beginPath();
            ctx.moveTo(cScreen.x, cScreen.y);
            ctx.lineTo(cScreen.x + rScreen, cScreen.y);
            ctx.strokeStyle = Config.COLORS.circleRadiusLine;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
        });
        ctx.restore();
    }

    // ---------- 交点标记 (线-线 / 线-圆 / 圆-圆) ----------
    function drawIntersectionMarkers() {
        const lines = Store.getLines();
        const circles = Store.getCircles();

        const interPts = [];
        for (let i = 0; i < lines.length; i++) {
            for (let j = i + 1; j < lines.length; j++) {
                const p = Geometry.segSegIntersection(lines[i].x1, lines[i].y1, lines[i].x2, lines[i].y2,
                                                      lines[j].x1, lines[j].y1, lines[j].x2, lines[j].y2);
                if (p) interPts.push(p);
            }
        }
        lines.forEach(line => {
            circles.forEach(circle => {
                Geometry.segCircleIntersection(line.x1, line.y1, line.x2, line.y2, circle.x, circle.y, circle.r)
                    .forEach(p => interPts.push(p));
            });
        });
        for (let i = 0; i < circles.length; i++) {
            for (let j = i + 1; j < circles.length; j++) {
                Geometry.circleCircleIntersection(circles[i].x, circles[i].y, circles[i].r,
                                                  circles[j].x, circles[j].y, circles[j].r)
                    .forEach(p => interPts.push(p));
            }
        }

        ctx.save();
        ctx.fillStyle = Config.COLORS.intersection;
        interPts.forEach(p => {
            const sp = View.worldToScreen(p.x, p.y);
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, 3, 0, 2 * Math.PI);
            ctx.fill();
        });
        ctx.restore();
    }

    // ---------- 进行中的预览图形 ----------
    function drawPreview(state) {
        if (state.phase !== 'started' || !state.startPoint) return;

        const view = View.getState();
        const startScreen = View.worldToScreen(state.startPoint.x, state.startPoint.y);
        const targetWorld = state.snappedPoint ? state.snappedPoint : state.mouseWorld;
        const targetScreen = View.worldToScreen(targetWorld.x, targetWorld.y);

        if (state.currentTool === 'compass' && state.previewCircle) {
            ctx.save();
            const pcScreen = View.worldToScreen(state.previewCircle.x, state.previewCircle.y);
            const prScreen = state.previewCircle.r * view.scale;
            ctx.strokeStyle = Config.COLORS.preview;
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 6]);
            ctx.beginPath();
            ctx.arc(pcScreen.x, pcScreen.y, prScreen, 0, 2 * Math.PI);
            ctx.stroke();

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
            ctx.restore();
        } else if (state.currentTool === 'ruler' && state.previewLine) {
            ctx.save();
            const p1 = View.worldToScreen(state.previewLine.x1, state.previewLine.y1);
            const p2 = View.worldToScreen(state.previewLine.x2, state.previewLine.y2);
            ctx.strokeStyle = Config.COLORS.preview;
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 6]);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = Config.COLORS.preview;
            ctx.beginPath();
            ctx.arc(p1.x, p1.y, 4, 0, 2 * Math.PI);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(p2.x, p2.y, 4, 0, 2 * Math.PI);
            ctx.fill();
            ctx.restore();
        }
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

    return Object.freeze({ init, render });
})();
