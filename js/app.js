/**
 * 应用控制器 — 状态机、鼠标/键盘交互、UI 绑定与启动
 */
(function () {

    // ---------- DOM 引用 ----------
    const canvas = document.getElementById('board');
    const statusMsg = document.getElementById('statusMsg');
    const snapIndicator = document.getElementById('snapIndicator');
    const zoomIndicator = document.getElementById('zoomIndicator');
    const toolCompass = document.getElementById('toolCompass');
    const toolRuler = document.getElementById('toolRuler');
    const toolEraser = document.getElementById('toolEraser');
    const toolFill = document.getElementById('toolFill');
    const toolVertex = document.getElementById('toolVertex');
    const fillPalette = document.getElementById('fillPalette');
    const customColor = document.getElementById('customColor');
    const lineStyleCard = document.getElementById('lineStyleCard');
    const fillCard = document.getElementById('fillCard');
    const swatchBtns = fillPalette ? Array.from(fillPalette.querySelectorAll('.swatch:not(.swatch-custom)')) : [];
    const lineStyleGroup = document.getElementById('lineStyleGroup');
    const styleBtns = lineStyleGroup ? Array.from(lineStyleGroup.querySelectorAll('.seg-btn')) : [];
    const rulerKindPanel = document.getElementById('rulerKindPanel');
    const blueprintToggle = document.getElementById('blueprintToggle');
    const clearBtn = document.getElementById('clearBtn');
    const importBtn = document.getElementById('importBtn');
    const exportBtn = document.getElementById('exportBtn');
    const importFile = document.getElementById('importFile');
    const undoBtn = document.getElementById('undoBtn');
    const resetViewBtn = document.getElementById('resetViewBtn');
    const circleSnapToggle = document.getElementById('circleSnapToggle');
    const axisSnapToggle = document.getElementById('axisSnapToggle');
    const fullBtn = document.getElementById('fullBtn');
    const rulerKindGroup = document.getElementById('rulerKindGroup');
    const kindBtns = rulerKindGroup ? Array.from(rulerKindGroup.querySelectorAll('.kind-btn')) : [];

    // ---------- 应用状态 ----------
    const state = {
        currentTool: 'ruler',       // 默认线段
        rulerKind: 'segment',       // 直尺模式: segment | ray | line
        lineStyle: 'solid',         // 实线 / 虚线
        theme: 'blueprint',        // 默认蓝图配色
        phase: 'idle',              // idle | started
        startPoint: null,           // 世界坐标
        mouseWorld: { x: 0, y: 0 }, // 鼠标世界坐标
        mouseScreen: { x: 0, y: 0 },// 鼠标屏幕坐标
        previewCurve: null,         // 预览曲线 (统一曲线结构，无 id)
        snappedPoint: null,         // 世界坐标
        snappedType: null,
        snappedLabel: '',
        currentColor: Config.FILL_COLORS[0],   // 油漆桶当前颜色
        vertexHover: null,          // 顶点工具 hover 的节点 (世界坐标)
        hidePoints: false           // 隐藏点开关: 仅不显示点与标签，不影响吸附等逻辑
    };

    // 拖拽平移状态
    let isPanning = false;
    let panStart = null;            // { screenX, screenY, offsetX, offsetY }

    // 橡皮擦笔画状态
    const erase = {
        active: false,
        lastWorld: null,            // 上次采样点 (世界坐标)
        hits: new Map()             // curveId -> { curve, params: [] }
    };

    // 拾取曲线 (光圈半径内最近者)：返回 { curve, t, dScreen } 或 null
    function pickCurve(world, radiusScreen) {
        let best = null;
        const mScreen = View.worldToScreen(world.x, world.y);
        Store.getCurves().forEach(c => {
            const cp = Geometry.closestPointOnCurve(c, world.x, world.y);
            const cpScreen = View.worldToScreen(cp.x, cp.y);
            const dScreen = Math.hypot(cpScreen.x - mScreen.x, cpScreen.y - mScreen.y);
            if (dScreen <= radiusScreen && (!best || dScreen < best.dScreen)) {
                best = { curve: c, t: cp.t, dScreen: dScreen };
            }
        });
        return best;
    }

    // ---------- 节点区间擦除 ----------
    // 擦除语义: 曲线被「节点」(真实端点 + 与其他曲线的交点) 分成若干段，
    // 擦除整段移除 — 两个点之间删那段；射线/直线无点的一侧删整侧

    // 曲线的节点参数 (升序去重)
    function curveNodes(c) {
        const ts = [];
        if (c.type === 'line') {
            if (c.kind === 'segment' || c.kind === 'piece') ts.push(c.tMin, c.tMax);
            else if (c.kind === 'ray') ts.push(c.tMin);
        } else if (!Geometry.isFullCircle(c)) {
            ts.push(c.a0, c.a1);
        }
        Store.getCurves().forEach(o => {
            if (o.id === c.id) return;
            Geometry.curveIntersection(c, o).forEach(p => ts.push(p.t1));
        });
        ts.sort((a, b) => a - b);
        const out = [];
        ts.forEach(t => {
            if (!out.length || t - out[out.length - 1] > 1e-6) out.push(t);
        });
        return out;
    }

    // 合并重叠/相接的参数区间
    function mergeRanges(ranges) {
        if (!ranges.length) return [];
        const sorted = ranges.slice().sort((a, b) => a.from - b.from);
        const out = [{ from: sorted[0].from, to: sorted[0].to }];
        for (let i = 1; i < sorted.length; i++) {
            const last = out[out.length - 1];
            if (sorted[i].from <= last.to + 1e-9) {
                if (sorted[i].to > last.to) last.to = sorted[i].to;
            } else {
                out.push({ from: sorted[i].from, to: sorted[i].to });
            }
        }
        return out;
    }

    // 把采样参数扩展为所在的节点区间 (整段移除)，返回合并后的擦除区间
    function nodeIntervals(c, params) {
        const dom = c.type === 'line' ? { from: c.tMin, to: c.tMax } : { from: c.a0, to: c.a1 };
        const span = dom.to - dom.from;
        const full = c.type === 'circle' && Geometry.isFullCircle(c);
        const nodes = curveNodes(c);
        const cuts = [];
        params.forEach(t => {
            let prev = null, next = null;
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i] <= t + 1e-9) prev = nodes[i];
                if (next === null && nodes[i] >= t - 1e-9) next = nodes[i];
            }
            let from = prev === null ? dom.from : prev;
            let to = next === null ? dom.to : next;
            if (full && nodes.length) {
                if (prev === null) from = nodes[nodes.length - 1] - span;   // 环绕
                if (next === null) to = nodes[0] + span;
            }
            if (to - from >= span - 1e-9) {
                cuts.push({ from: dom.from, to: dom.to });                  // 无节点 → 整条
            } else if (from < dom.from - 1e-9) {
                cuts.push({ from: dom.from, to: to });                      // 环绕区间拆两段
                cuts.push({ from: from + span, to: dom.to });
            } else if (to > dom.to + 1e-9) {
                cuts.push({ from: from, to: dom.to });
                cuts.push({ from: dom.from, to: to - span });
            } else {
                cuts.push({ from: from, to: to });
            }
        });
        return mergeRanges(cuts).filter(r => r.to - r.from > 1e-9);
    }

    // 汇总当前擦除预览数据
    function eraserView(cursor) {
        const hits = [];
        erase.hits.forEach((v, curveId) => {
            hits.push({ curveId: curveId, ranges: nodeIntervals(v.curve, v.params) });
        });
        return { hits: hits, hover: null, cursor: cursor || null };
    }

    // 悬浮预览: 光圈下曲线将被整段移除的节点区间
    function hoverEraseView() {
        const pick = pickCurve(state.mouseWorld, Config.ERASER_RADIUS_SCREEN);
        let hover = null;
        if (pick) {
            hover = { curveId: pick.curve.id, ranges: nodeIntervals(pick.curve, [pick.t]) };
        }
        return { hits: [], hover: hover, cursor: { x: state.mouseScreen.x, y: state.mouseScreen.y } };
    }

    // 记录一个擦除采样点
    function addEraseSample(world) {
        const pick = pickCurve(world, Config.ERASER_RADIUS_SCREEN);
        if (!pick) return;
        let entry = erase.hits.get(pick.curve.id);
        if (!entry) {
            entry = { curve: pick.curve, params: [] };
            erase.hits.set(pick.curve.id, entry);
        }
        entry.params.push(pick.t);
    }

    // 参数补采: 笔画两端都落在同一曲线上、且曲线弧长不超过鼠标位移预算时，
    // 线性补齐中间参数 (避免折线弦偏离弧线造成的采样空洞)
    function fillParamGaps(entry, budgetWorld) {
        const ps = entry.params;
        if (ps.length < 2) return;
        const t1 = ps[ps.length - 2], t2 = ps[ps.length - 1];
        const arc = entry.curve.type === 'line'
            ? Math.abs(t2 - t1)
            : Math.abs(t2 - t1) * entry.curve.r;
        if (arc > budgetWorld) return;
        const scale = View.getState().scale;
        const n = Math.max(1, Math.min(200, Math.ceil(arc * scale / 4)));
        for (let i = 1; i < n; i++) ps.push(t1 + (t2 - t1) * i / n);
    }

    function resetErase() {
        erase.active = false;
        erase.lastWorld = null;
        erase.hits.clear();
        state.eraserView = null;
    }

    function render() {
        Renderer.render(state);
    }

    // ---------- UI 提示 ----------
    function updateStatus(text) {
        statusMsg.innerHTML = text;
    }

    function updateStatusForTool() {
        if (state.currentTool === 'eraser') { updateStatus(Config.TEXT.statusEraser); return; }
        if (state.currentTool === 'fill') { updateStatus(Config.TEXT.statusFill); return; }
        if (state.currentTool === 'vertex') { updateStatus('顶点: 点击节点命名 / 已命名点可改名或留空删除'); return; }
        updateStatus(state.currentTool === 'compass' ? Config.TEXT.statusCompass : Config.TEXT.statusRuler);
    }

    function updateZoomIndicator() {
        if (zoomIndicator) zoomIndicator.textContent = Math.round(View.getState().scale * 100) + '%';
    }

    function showSnapIndicator(type, label) {
        snapIndicator.className = 'snap-indicator show ' + type;
        snapIndicator.textContent = label + Config.TEXT.snapSuffix;
    }

    function hideSnapIndicator() {
        snapIndicator.classList.remove('show');
    }

    // ---------- 状态操作 ----------
    // 取消进行中的绘制
    function cancelDrawing() {
        state.phase = 'idle';
        state.startPoint = null;
        state.previewCurve = null;
    }

    // 应用吸附结果
    function applySnap(snap) {
        if (snap) {
            state.snappedPoint = { x: snap.x, y: snap.y };
            state.snappedType = snap.type;
            state.snappedLabel = snap.label;
        } else {
            state.snappedPoint = null;
            state.snappedType = null;
        }
    }

    function undo() {
        if (!Store.undo()) return;
        cancelDrawing();
        updateStatusForTool();
        render();
    }

    function clearAll() {
        if (Store.isEmpty()) return;
        if (!window.confirm(Config.TEXT.clearConfirm)) return;
        Store.saveHistory();
        Store.clear();
        cancelDrawing();
        applySnap(null);
        hideSnapIndicator();
        updateStatusForTool();
        render();
    }

    function setTool(tool) {
        if (state.phase === 'started') cancelDrawing();
        resetErase();
        state.currentTool = tool;
        state.vertexHover = null;
        toolCompass.classList.toggle('active', tool === 'compass');
        toolRuler.classList.toggle('active', tool === 'ruler');
        toolEraser.classList.toggle('active', tool === 'eraser');
        toolFill.classList.toggle('active', tool === 'fill');
        if (toolVertex) toolVertex.classList.toggle('active', tool === 'vertex');
        // 右侧堆叠面板 (工具栏下方): 线段射线直线(直尺) / 填充色板(填充) / 实线虚线(直尺·圆规) / 连续(直尺+线段)
        const showKind = (tool === 'ruler');
        const showLine = (tool === 'compass' || tool === 'ruler');
        const showFill = (tool === 'fill');
        rulerKindGroup.style.display = showKind ? 'flex' : 'none';
        if (rulerKindPanel) rulerKindPanel.style.display = (showKind || showLine || showFill) ? 'flex' : 'none';
        if (lineStyleCard) lineStyleCard.style.display = showLine ? '' : 'none';
        if (fillCard) fillCard.style.display = showFill ? '' : 'none';
        updateStatusForTool();
        render();
    }

// 初始同步右侧堆叠面板可见性 (默认 ruler 工具: 线段射线直线 + 实线虚线 + 连续)
if (rulerKindGroup) rulerKindGroup.style.display = state.currentTool === 'ruler' ? 'flex' : 'none';
if (rulerKindPanel) rulerKindPanel.style.display = 'flex';
if (lineStyleCard) lineStyleCard.style.display = (state.currentTool === 'compass' || state.currentTool === 'ruler') ? '' : 'none';
if (fillCard) fillCard.style.display = state.currentTool === 'fill' ? '' : 'none';

    // 切换填充颜色 (预设色板 / 自定义取色器)
    // 选 'transparent' 进入擦除模式：填充工具点击 → 删除该区域的填充
    function setFillColor(color, activeBtn) {
        state.currentColor = color;
        swatchBtns.forEach(b => b.classList.toggle('active', b === activeBtn));
    }

    // 擦除指定区域内的所有填充 (透明色点击时调用)
    function eraseFillAt(wx, wy) {
        const face = Geometry.extractFace(Store.getCurves(), wx, wy);
        if (!face) return false;
        // 找到包含种子点的所有填充，多边形相交判定
        let removed = 0;
        Store.getFills().forEach(f => {
            if (Geometry.pointInPoly(f.seed.x, f.seed.y, face.poly)) removed++;
        });
        if (removed === 0) return false;
        Store.saveHistory();
        Store.setFills(Store.getFills().filter(f => {
            // 保留：种子不在 face 内的填充；删除：种子在 face 内的填充
            return !Geometry.pointInPoly(f.seed.x, f.seed.y, face.poly);
        }));
        return true;
    }

    // 切换直尺模式 (线段/射线/直线)
    function setRulerKind(kind) {
        state.rulerKind = kind;
        kindBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.kind === kind));
        if (state.phase === 'started') updatePreview();
        render();
    }

    // 切换线型 (实线/虚线)
    function setLineStyle(style) {
        state.lineStyle = style;
        styleBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.style === style));
    }

    // 切换主题 (default/blueprint)
    function setTheme(theme) {
        state.theme = theme;
        document.documentElement.style.setProperty('--canvas-bg', Config.THEME[theme].background);
        render();
    }

    // ---------- 顶点工具：节点拾取 ----------
    // 独立点实体拾取 (屏幕距离最近，可命中已无曲线依附的自由点)
    function pickPoint(world, radiusScreen) {
        const mScreen = View.worldToScreen(world.x, world.y);
        let best = null;
        Store.getPoints().forEach(p => {
            const sp = View.worldToScreen(p.x, p.y);
            const d = Math.hypot(sp.x - mScreen.x, sp.y - mScreen.y);
            if (d <= radiusScreen && (!best || d < best.d)) best = { point: p, d: d };
        });
        return best;
    }

    // 收集所有节点 (独立点 + 端点 + 交点 + 圆心)，按屏幕距离返回最近的 (距离, worldX, worldY)
    function pickVertex(world, radiusScreen) {
        const mScreen = View.worldToScreen(world.x, world.y);
        const EPS = 1e-6;
        const seen = new Map();
        const add = (x, y) => {
            const k = Math.round(x / EPS) + ',' + Math.round(y / EPS);
            if (!seen.has(k)) seen.set(k, { x: x, y: y });
        };
        Store.getPoints().forEach(p => add(p.x, p.y));
        Store.getCurves().forEach(c => {
            if (c.type === 'line') {
                add(c.p0.x + c.dir.x * c.tMin, c.p0.y + c.dir.y * c.tMin);
                add(c.p0.x + c.dir.x * c.tMax, c.p0.y + c.dir.y * c.tMax);
            } else {
                add(c.cx, c.cy);
            }
        });
        const curves = Store.getCurves();
        for (let i = 0; i < curves.length; i++) {
            for (let j = i + 1; j < curves.length; j++) {
                Geometry.curveIntersection(curves[i], curves[j]).forEach(p => add(p.x, p.y));
            }
        }
        let best = null;
        seen.forEach(v => {
            const sp = View.worldToScreen(v.x, v.y);
            const d = Math.hypot(sp.x - mScreen.x, sp.y - mScreen.y);
            if (d <= radiusScreen && (!best || d < best.d)) best = { d: d, x: v.x, y: v.y };
        });
        return best;
    }

    // ---------- 坐标换算 ----------
    // 屏幕坐标 = 画布内 CSS 像素坐标 (backing store 已按 dpr 放大，逻辑坐标不变)
    function getMouseScreenCoords(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    function updateMouseWorld(e) {
        const screen = getMouseScreenCoords(e);
        state.mouseScreen.x = screen.x;
        state.mouseScreen.y = screen.y;
        const world = View.screenToWorld(screen.x, screen.y);
        state.mouseWorld.x = world.x;
        state.mouseWorld.y = world.y;
    }

    // ---------- 预览更新 ----------
    function updatePreview() {
        if (state.phase !== 'started' || !state.startPoint) {
            state.previewCurve = null;
            return;
        }

        const target = state.snappedPoint ? state.snappedPoint : state.mouseWorld;
        const sx = state.startPoint.x, sy = state.startPoint.y;

        if (state.currentTool === 'compass') {
            const r = Math.hypot(target.x - sx, target.y - sy);
            state.previewCurve = r < 1 ? null : { type: 'circle', cx: sx, cy: sy, r: r, a0: 0, a1: Math.PI * 2, lineStyle: state.lineStyle };
        } else {
            const dist = Math.hypot(target.x - sx, target.y - sy);
            state.previewCurve = dist < 1 ? null : Object.assign(Geometry.makeLineCurveData(state.startPoint, target, state.rulerKind), { lineStyle: state.lineStyle });
        }
    }

    // ---------- 鼠标事件 ----------
    // 滚轮缩放
    function onWheel(e) {
        e.preventDefault();
        const screen = getMouseScreenCoords(e);
        View.zoomAt(screen.x, screen.y, e.deltaY);
    }

    function onMouseDown(e) {
        updateMouseWorld(e);

        // 中键拖拽 → 平移视野
        if (e.button === 1) {
            e.preventDefault();
            isPanning = true;
            panStart = {
                lastX: state.mouseScreen.x,
                lastY: state.mouseScreen.y
            };
            canvas.classList.add('grabbing');
            return;
        }

        // 只处理左键
        if (e.button !== 0) return;
        e.preventDefault();

        // 橡皮擦: 优先命中独立点 → 单击只删该点 (不影响线)；否则开始曲线擦除笔画
        if (state.currentTool === 'eraser') {
            const pp = pickPoint(state.mouseWorld, Config.ERASER_RADIUS_SCREEN);
            if (pp) {
                Store.saveHistory();
                Store.removePoint(pp.point.id);
                updateStatus('已删除点 "' + pp.point.name + '"');
                render();
                return;
            }
            const pick = pickCurve(state.mouseWorld, Config.ERASER_RADIUS_SCREEN);
            if (pick) {
                erase.active = true;
                erase.lastWorld = { x: state.mouseWorld.x, y: state.mouseWorld.y };
                addEraseSample(state.mouseWorld);
                state.eraserView = eraserView({ x: state.mouseScreen.x, y: state.mouseScreen.y });
            }
            render();
            return;
        }

        // 油漆桶: 点击封闭区域填色 (种子点 + 一次性面提取)
        if (state.currentTool === 'fill') {
            // 透明色 = 擦除该区域的填充
            if (state.currentColor === 'transparent') {
                const ok = eraseFillAt(state.mouseWorld.x, state.mouseWorld.y);
                updateStatus(ok ? '已取消该区域的填充' : (Config.TEXT.fillFail));
                render();
                return;
            }
            const face = Geometry.extractFace(Store.getCurves(), state.mouseWorld.x, state.mouseWorld.y);
            if (face) {
                Store.saveHistory();
                Store.addFill({
                    color: state.currentColor,
                    seed: { x: state.mouseWorld.x, y: state.mouseWorld.y },
                    poly: face.poly
                });
                updateStatusForTool();
            } else {
                updateStatus(Config.TEXT.fillFail);
            }
            render();
            return;
        }

        // 顶点工具: 优先命中独立点实体 (改名/删除)，否则命中派生节点 → 新建点实体
        if (state.currentTool === 'vertex') {
            const pp = pickPoint(state.mouseWorld, Config.SNAP_DIST_SCREEN);
            if (pp) {
                const name = window.prompt(Config.TEXT.vertexLabelPrompt, pp.point.name || '');
                if (name !== null) {
                    Store.saveHistory();
                    const trimmed = name.trim();
                    if (trimmed) pp.point.name = trimmed;   // 改名
                    else Store.removePoint(pp.point.id);    // 留空 → 删除该点
                    render();
                }
                return;
            }
            const pick = pickVertex(state.mouseWorld, Config.SNAP_DIST_SCREEN);
            if (pick) {
                const name = window.prompt(Config.TEXT.vertexLabelPrompt, '');
                if (name !== null && name.trim()) {
                    Store.saveHistory();
                    Store.addPoint(pick.x, pick.y, name.trim());
                    render();
                }
            }
            return;
        }

        // 在当前位置重新检测吸附 (不依赖上次 mousemove 的旧值)
        const snap = Snap.find(state.mouseWorld.x, state.mouseWorld.y, drawCtx());
        applySnap(snap);
        if (snap) showSnapIndicator(snap.type, snap.label);
        else hideSnapIndicator();

        // 使用吸附点 (若有) 作为操作坐标
        const useX = state.snappedPoint ? state.snappedPoint.x : state.mouseWorld.x;
        const useY = state.snappedPoint ? state.snappedPoint.y : state.mouseWorld.y;
        state.mouseWorld.x = useX;
        state.mouseWorld.y = useY;

        if (state.phase === 'idle') {
            state.startPoint = { x: useX, y: useY };
            state.phase = 'started';

            if (state.snappedPoint) {
                updateStatus(`已吸附${state.snappedLabel} → 选择终点`);
            } else {
                updateStatus(`起点 → 选择终点`);
            }
        } else if (state.phase === 'started' && state.startPoint) {
            finishDrawing(useX, useY);
        }

        render();
    }

    // 第二次点击：确定半径 / 终点，生成曲线
    function finishDrawing(useX, useY) {
        const scale = View.getState().scale;
        const sx = state.startPoint.x, sy = state.startPoint.y;
        let created = null;

        if (state.currentTool === 'compass') {
            const r = Math.hypot(useX - sx, useY - sy);
            // 最小半径 (屏幕像素，避免过小)
            if (r * scale >= Config.MIN_SHAPE_SCREEN) {
                Store.saveHistory();
                created = Store.makeCircleCurve(sx, sy, r);
                if (created) created.lineStyle = state.lineStyle;
            }
        } else {
            const dist = Math.hypot(useX - sx, useY - sy);
            if (dist * scale >= Config.MIN_SHAPE_SCREEN) {
                Store.saveHistory();
                created = Store.makeLineCurve(state.startPoint, { x: useX, y: useY }, state.rulerKind);
                if (created) created.lineStyle = state.lineStyle;
            }
        }
        // 新曲线可能把已有填充区域分割 → 重新提取并补建被分开的部分
        if (created) Store.refillFills(Geometry.extractFace, [created]);
        // 连续画线 (默认开启): 直尺+线段模式下，上一段终点自动作为下一段起点 (右键/ESC 结束链条)
        if (created && state.currentTool === 'ruler' && state.rulerKind === 'segment') {
            state.startPoint = { x: useX, y: useY };
            state.previewCurve = null;
            updateStatus('连续画线: 点击下一点 (右键/ESC 结束)');
        } else {
            cancelDrawing();
            updateStatusForTool();
        }
    }

    function onMouseMove(e) {
        // 平移中：用「上次坐标 → 本次坐标」的增量，避免依赖 mousedown 初始点
        if (isPanning && panStart) {
            const screen = getMouseScreenCoords(e);
            const dx = screen.x - panStart.lastX;
            const dy = screen.y - panStart.lastY;
            if (dx !== 0 || dy !== 0) {
                View.panBy(dx, dy);
                panStart.lastX = screen.x;
                panStart.lastY = screen.y;
            }
            return;
        }

        // 普通移动
        updateMouseWorld(e);

        // 顶点工具 hover
        if (state.currentTool === 'vertex') {
            state.vertexHover = pickVertex(state.mouseWorld, Config.SNAP_DIST_SCREEN);
            render();
            return;
        }

        // 橡皮擦移动: 笔画采样 / 悬浮预览
        if (state.currentTool === 'eraser') {
            if (erase.active) {
                const dxw = state.mouseWorld.x - erase.lastWorld.x;
                const dyw = state.mouseWorld.y - erase.lastWorld.y;
                const stepScreen = Math.hypot(dxw, dyw) * View.getState().scale;
                const n = Math.max(1, Math.min(60, Math.ceil(stepScreen / 4)));
                for (let i = 1; i <= n; i++) {
                    addEraseSample({ x: erase.lastWorld.x + dxw * i / n, y: erase.lastWorld.y + dyw * i / n });
                }
                // 对本段笔画碰到的曲线做参数补采 (预算 = 2 倍鼠标位移 + 余量)
                const budget = stepScreen * 2 / View.getState().scale + 30;
                erase.hits.forEach(entry => fillParamGaps(entry, budget));
                erase.lastWorld = { x: state.mouseWorld.x, y: state.mouseWorld.y };
                state.eraserView = eraserView({ x: state.mouseScreen.x, y: state.mouseScreen.y });
            } else {
                state.eraserView = hoverEraseView();
            }
            render();
            return;
        }

        const snap = Snap.find(state.mouseWorld.x, state.mouseWorld.y, drawCtx());
        applySnap(snap);
        if (snap) {
            showSnapIndicator(snap.type, snap.label);
        } else {
            hideSnapIndicator();
        }

        if (state.phase === 'started') {
            updatePreview();
        }
        render();
    }

    function onMouseUp(e) {
        // 中键/平移结束：无论 button 如何（mouseleave 时 button 不可靠），只要不再按下就清状态
        if (isPanning) {
            isPanning = false;
            panStart = null;
            canvas.classList.remove('grabbing');
            if (e.button === 1) return;   // 真的是中键释放，直接返回
        }

        // 橡皮擦结束 → 整段移除所有被涂抹的节点区间 (单击与拖动同规则)
        if (erase.active && e.button === 0) {
            const plan = [];
            erase.hits.forEach((v, curveId) => {
                const ranges = nodeIntervals(v.curve, v.params);
                if (ranges.length) plan.push({ curveId: curveId, ranges: ranges });
            });
            if (plan.length) {
                Store.saveHistory();
                const scale = View.getState().scale;
                plan.forEach(p => Store.splitCurve(p.curveId, p.ranges, Config.MIN_SHAPE_SCREEN / scale));
                // 擦除后重新提取填充: 包围线被擦开 → 填充消失; 仍封闭 → 更新边界
                Store.refillFills(Geometry.extractFace, []);
            }
            resetErase();
            updateStatusForTool();
            render();
        }
    }

    // 阻止中键默认行为 (比如滚动)
    function onAuxClick(e) {
        if (e.button === 1) e.preventDefault();
    }

    // ---------- 事件绑定 ----------
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseUp);
    canvas.addEventListener('auxclick', onAuxClick);
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // 右击 = 取消正在进行的绘制，等同 ESC
        if (state.phase === 'started') {
            cancelDrawing();
            updateStatusForTool();
            render();
        }
    });

    toolCompass.addEventListener('click', () => setTool('compass'));
    toolRuler.addEventListener('click', () => setTool('ruler'));
    toolEraser.addEventListener('click', () => setTool('eraser'));
    toolFill.addEventListener('click', () => setTool('fill'));
    if (toolVertex) toolVertex.addEventListener('click', () => setTool('vertex'));
    kindBtns.forEach(btn => btn.addEventListener('click', () => setRulerKind(btn.dataset.kind)));
    styleBtns.forEach(btn => btn.addEventListener('click', () => setLineStyle(btn.dataset.style)));
    swatchBtns.forEach(btn => btn.addEventListener('click', () => setFillColor(btn.dataset.color, btn)));
    customColor.addEventListener('input', (e) => setFillColor(e.target.value, null));
    clearBtn.addEventListener('click', clearAll);

    // ---------- 导入 / 导出 (图形数据 JSON) ----------
    if (exportBtn) exportBtn.addEventListener('click', () => {
        const json = JSON.stringify(Store.serialize(), null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        a.href = URL.createObjectURL(blob);
        a.download = '图形数据-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
                     '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
    });
    if (importBtn) importBtn.addEventListener('click', () => importFile.click());
    if (importFile) importFile.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        importFile.value = '';   // 允许重复选择同一文件
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            let data;
            try { data = JSON.parse(reader.result); }
            catch (err) { alert('导入失败: 不是合法的 JSON 文件'); return; }
            Store.saveHistory();   // 快照「导入前」状态 → Ctrl+Z 可撤销本次导入
            if (!Store.deserialize(data)) { alert('导入失败: 文件不是本应用的图形数据格式'); return; }
            cancelDrawing();
            render();
            updateStatus('导入成功: ' + file.name);
        };
        reader.readAsText(file);
    });
    undoBtn.addEventListener('click', undo);
    resetViewBtn.addEventListener('click', () => View.reset());
    circleSnapToggle.addEventListener('change', (e) => Snap.setCircleSnapEnabled(e.target.checked));
    axisSnapToggle.addEventListener('change', (e) => Snap.setAxisSnapEnabled(e.target.checked));
    // 蓝图模式与网格吸附合并为同一开关: 蓝图开 → 蓝底配色 + 网格显示 + 网格吸附
    if (blueprintToggle) blueprintToggle.addEventListener('change', (e) => {
        const on = e.target.checked;
        setTheme(on ? 'blueprint' : 'default');
        Snap.setGridSnapEnabled(on);
    });
    const hidePointsToggle = document.getElementById('hidePointsToggle');
    if (hidePointsToggle) hidePointsToggle.addEventListener('change', (e) => {
        state.hidePoints = e.target.checked;
        render();
    });

    // 绘制中启用水平/垂直吸附的上下文
    function drawCtx() {
        return state.phase === 'started' && state.startPoint ? { startPoint: state.startPoint } : null;
    }

    // 原生全屏切换
    // 注意：浏览器在 file:// 协议下会拒绝 requestFullscreen (SecurityError)，
    // 此时回退到「沉浸式模式」：隐藏所有悬浮面板，让画布真正占满视口。
    function goFullscreen() {
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (!req) { immersiveOn(); return; }
        req.call(el).catch(err => {
            console.warn('requestFullscreen 失败，回退沉浸式模式:', err && err.message);
            immersiveOn();
        });
    }

    function exitFullscreen() {
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        if (exit) exit.call(document).catch(() => {});
    }

    function immersiveOn() {
        document.body.classList.add('immersive');
        updateFullscreenLabel(true);
    }
    function immersiveOff() {
        document.body.classList.remove('immersive');
        updateFullscreenLabel(false);
    }
    function isImmersive() { return document.body.classList.contains('immersive'); }
    function updateFullscreenLabel(active) {
        if (!fullBtn) return;
        fullBtn.textContent = active ? '⛶ 退出' : '⛶ 全屏';
        fullBtn.title = active ? '退出全屏/沉浸模式' : '切换全屏';
    }

    fullBtn.addEventListener('click', () => {
        const inFs = document.fullscreenElement || document.webkitFullscreenElement;
        // 先处理原生全屏退出（包括请求失败被 reject 的回退场景）
        if (inFs) {
            exitFullscreen();
            // 异步保证退出完成后再清 immersive (fullscreenchange 会触发，但万一事件没收到)
            setTimeout(() => {
                if (!document.fullscreenElement && !document.webkitFullscreenElement) immersiveOff();
            }, 100);
            return;
        }
        if (isImmersive()) {
            immersiveOff();
            return;
        }
        goFullscreen();
    });

    // 监听原生全屏状态变化（如用户按 Esc 退出）
    ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach(ev => {
        document.addEventListener(ev, () => {
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                immersiveOff();
            } else {
                updateFullscreenLabel(true);
            }
        });
    });

    const exitImmersiveBtn = document.getElementById('exitImmersiveBtn');
    if (exitImmersiveBtn) {
        exitImmersiveBtn.addEventListener('click', () => {
            if (document.fullscreenElement || document.webkitFullscreenElement) exitFullscreen();
            else immersiveOff();
        });
    }

    // 窗口尺寸变化 → 画布自适应 (铺满视口 + HiDPI)
    const resizeObserver = new ResizeObserver(() => {
        const dpr = Math.min(window.devicePixelRatio || 1, Config.MAX_DPR);
        Renderer.setSize(canvas.clientWidth, canvas.clientHeight, dpr);
        render();
    });
    resizeObserver.observe(canvas);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (erase.active) {
                resetErase();
                updateStatusForTool();
                render();
                return;
            }
            if (state.phase === 'started') {
                cancelDrawing();
                updateStatusForTool();
                render();
            }
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undo();
        }
        if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            View.reset();
        }
    });

    // ---------- 启动 ----------
    Renderer.init(canvas);

    // 视图任何变化 (缩放/平移/重置) → 更新指示器并重绘
    View.setOnChange(() => {
        updateZoomIndicator();
        render();
    });

    // 画布初始为空 (todo: 初始不要有任何东西)
updateZoomIndicator();
// 初始同步主题 CSS 变量 (默认蓝图时背景已是蓝色)
document.documentElement.style.setProperty('--canvas-bg', Config.THEME[state.theme].background);
// 初始同步: 网格吸附跟随蓝图模式开关 (两者合并为同一逻辑)
Snap.setGridSnapEnabled(blueprintToggle ? blueprintToggle.checked : true);
render();
updateStatusForTool();
})();
