/**
 * 数据仓库 — 图形数据 (世界坐标) + 历史记录 (撤销)
 */
const Store = (() => {

    let circles = [];   // { x, y, r, id }
    let lines = [];     // { x1, y1, x2, y2, id }
    let nextId = 1;
    let history = [];   // 快照栈 { circles, lines }

    function saveHistory() {
        history.push({
            circles: JSON.parse(JSON.stringify(circles)),
            lines: JSON.parse(JSON.stringify(lines))
        });
        if (history.length > Config.MAX_HISTORY) history.shift();
    }

    // 撤销：恢复到上一次快照，无历史时返回 false
    function undo() {
        if (history.length === 0) return false;
        const state = history.pop();
        circles = state.circles;
        lines = state.lines;
        return true;
    }

    function addCircle(x, y, r) {
        const circle = { x, y, r, id: nextId++ };
        circles.push(circle);
        return circle;
    }

    function addLine(x1, y1, x2, y2) {
        const line = { x1, y1, x2, y2, id: nextId++ };
        lines.push(line);
        return line;
    }

    function clear() {
        circles = [];
        lines = [];
    }

    function isEmpty() {
        return circles.length === 0 && lines.length === 0;
    }

    // 返回内部数组引用（渲染/吸附高频访问，避免拷贝；外部只读，勿直接修改）
    function getCircles() { return circles; }
    function getLines() { return lines; }

    return Object.freeze({
        saveHistory, undo,
        addCircle, addLine, clear, isEmpty,
        getCircles, getLines
    });
})();
