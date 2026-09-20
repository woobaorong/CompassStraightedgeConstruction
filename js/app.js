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
    const clearBtn = document.getElementById('clearBtn');
    const undoBtn = document.getElementById('undoBtn');
    const resetViewBtn = document.getElementById('resetViewBtn');
    const circleSnapToggle = document.getElementById('circleSnapToggle');

    // ---------- 应用状态 ----------
    const state = {
        currentTool: 'compass',
        phase: 'idle',              // idle | started
        startPoint: null,           // 世界坐标
        mouseWorld: { x: 0, y: 0 }, // 鼠标世界坐标
        mouseScreen: { x: 0, y: 0 },// 鼠标屏幕坐标
        previewCircle: null,
        previewLine: null,
        snappedPoint: null,         // 世界坐标
        snappedType: null,
        snappedLabel: ''
    };

    // 拖拽平移状态
    let isPanning = false;
    let panStart = null;            // { screenX, screenY, offsetX, offsetY }

    function render() {
        Renderer.render(state);
    }

    // ---------- UI 提示 ----------
    function updateStatus(text) {
        statusMsg.innerHTML = text;
    }

    function updateStatusForTool() {
        updateStatus(state.currentTool === 'compass' ? Config.TEXT.statusCompass : Config.TEXT.statusRuler);
    }

    function updateZoomIndicator() {
        zoomIndicator.textContent = Math.round(View.getState().scale * 100) + '%';
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
        state.previewCircle = null;
        state.previewLine = null;
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
        state.currentTool = tool;
        toolCompass.classList.toggle('active', tool === 'compass');
        toolRuler.classList.toggle('active', tool === 'ruler');
        updateStatusForTool();
        render();
    }

    // ---------- 坐标换算 ----------
    function getMouseScreenCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
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
            state.previewCircle = null;
            state.previewLine = null;
            return;
        }

        const target = state.snappedPoint ? state.snappedPoint : state.mouseWorld;
        const sx = state.startPoint.x, sy = state.startPoint.y;

        if (state.currentTool === 'compass') {
            const r = Math.hypot(target.x - sx, target.y - sy);
            state.previewCircle = r < 1 ? null : { x: sx, y: sy, r: r };
            state.previewLine = null;
        } else {
            const dist = Math.hypot(target.x - sx, target.y - sy);
            state.previewLine = dist < 1 ? null : { x1: sx, y1: sy, x2: target.x, y2: target.y };
            state.previewCircle = null;
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
                screenX: state.mouseScreen.x,
                screenY: state.mouseScreen.y,
                offsetX: View.getState().offsetX,
                offsetY: View.getState().offsetY
            };
            canvas.classList.add('grabbing');
            return;
        }

        // 只处理左键
        if (e.button !== 0) return;
        e.preventDefault();

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

        // 重新检测吸附
        applySnap(Snap.find(state.mouseWorld.x, state.mouseWorld.y));
        render();
    }

    // 第二次点击：确定半径 / 终点，生成图形
    function finishDrawing(useX, useY) {
        const scale = View.getState().scale;
        const sx = state.startPoint.x, sy = state.startPoint.y;

        if (state.currentTool === 'compass') {
            const r = Math.hypot(useX - sx, useY - sy);
            // 最小半径 (屏幕像素，避免过小)
            if (r * scale >= Config.MIN_SHAPE_SCREEN) {
                Store.saveHistory();
                Store.addCircle(sx, sy, r);
            }
        } else {
            const dist = Math.hypot(useX - sx, useY - sy);
            if (dist * scale >= Config.MIN_SHAPE_SCREEN) {
                Store.saveHistory();
                Store.addLine(sx, sy, useX, useY);
            }
        }
        cancelDrawing();
        updateStatusForTool();
    }

    function onMouseMove(e) {
        // 平移中
        if (isPanning && panStart) {
            const screen = getMouseScreenCoords(e);
            View.panBy(screen.x - panStart.screenX, screen.y - panStart.screenY);
            return;
        }

        // 普通移动
        updateMouseWorld(e);

        const snap = Snap.find(state.mouseWorld.x, state.mouseWorld.y);
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
        if (e.button === 1) {
            isPanning = false;
            panStart = null;
            canvas.classList.remove('grabbing');
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
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    toolCompass.addEventListener('click', () => setTool('compass'));
    toolRuler.addEventListener('click', () => setTool('ruler'));
    clearBtn.addEventListener('click', clearAll);
    undoBtn.addEventListener('click', undo);
    resetViewBtn.addEventListener('click', () => View.reset());
    circleSnapToggle.addEventListener('change', (e) => Snap.setCircleSnapEnabled(e.target.checked));

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.phase === 'started') {
            cancelDrawing();
            updateStatusForTool();
            render();
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

    // 演示图形
    Store.addCircle(320, 320, 150);
    Store.addCircle(520, 350, 130);
    Store.addLine(180, 200, 780, 520);
    Store.addLine(220, 540, 720, 180);

    updateZoomIndicator();
    render();
    updateStatusForTool();
})();
