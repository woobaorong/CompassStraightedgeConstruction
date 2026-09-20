/**
 * 视图模块 — 世界坐标 <-> 屏幕坐标变换、缩放与平移
 *
 * world (x, y)  ->  screen ((x - offsetX) * scale, (y - offsetY) * scale)
 */
const View = (() => {

    const state = {
        scale: 1,
        offsetX: 0,   // 世界坐标中，视口左上角对应的 x
        offsetY: 0
    };

    let onChange = null;   // 视图变化回调 (更新缩放指示器 / 重绘)

    function setOnChange(cb) { onChange = cb; }
    function notify() { if (onChange) onChange(); }

    function worldToScreen(wx, wy) {
        return {
            x: (wx - state.offsetX) * state.scale,
            y: (wy - state.offsetY) * state.scale
        };
    }

    function screenToWorld(sx, sy) {
        return {
            x: sx / state.scale + state.offsetX,
            y: sy / state.scale + state.offsetY
        };
    }

    // 重置为初始视野
    function reset() {
        state.scale = 1;
        state.offsetX = 0;
        state.offsetY = 0;
        notify();
    }

    // 以屏幕点 (sx, sy) 为锚点缩放，deltaY 为滚轮增量
    function zoomAt(sx, sy, deltaY) {
        // 缩放前鼠标对应的世界坐标
        const worldBefore = screenToWorld(sx, sy);

        const factor = Math.exp(-deltaY * 0.0015);
        let newScale = state.scale * factor;
        newScale = Math.max(Config.MIN_SCALE, Math.min(Config.MAX_SCALE, newScale));

        // 调整 offset 使鼠标位置保持不动
        state.scale = newScale;
        state.offsetX = worldBefore.x - sx / state.scale;
        state.offsetY = worldBefore.y - sy / state.scale;

        notify();
    }

    // 按屏幕像素位移平移视野
    function panBy(dxScreen, dyScreen) {
        state.offsetX -= dxScreen / state.scale;
        state.offsetY -= dyScreen / state.scale;
        notify();
    }

    return Object.freeze({
        setOnChange,
        worldToScreen,
        screenToWorld,
        reset,
        zoomAt,
        panBy,
        getState: () => state
    });
})();
